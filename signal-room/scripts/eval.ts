/* Signal Room evaluation runner.
 *
 * Runs the deterministic pipeline over the gold set (fixtures/gold/cases.json),
 * checks every expectation, and reports metrics per quality dimension.
 * Hard failures (exit 1): permission leakage, voice-rule errors in generated
 * drafts, evidence traceability below 100%, extraction below target.
 *
 * Usage: npm run eval  (writes eval-report.json)
 */
import fs from "fs";
import path from "path";
import { runPurePipeline, clusterByMarker, opportunityByMarker, draftContextFor, type PureRun } from "../src/lib/pipeline/pure";
import { MockProvider } from "../src/lib/ai/mock";
import { lintVoice } from "../src/lib/voice/lint";
import { detectLeaks, isPublishable } from "../src/lib/permissions";

interface GoldCase {
  id: string;
  category: string;
  input: { fixture?: string; text?: string; sourceType: string; pillar?: string };
  expect: {
    minContentItems?: number;
    maxContentItems?: number;
    item?: {
      authorContains?: string;
      textContains?: string;
      itemType?: string | string[];
      isNoise?: boolean;
    };
    clusterTogether?: [string, string];
    duplicates?: { marker: string; minCount: number };
    claim?: { textContains: string; statusOneOf: string[]; maxIndependent?: number };
    action?: { marker: string; oneOf: string[] };
    queued?: { marker: string; is: boolean };
    draft?: { marker: string; type: string; forbidden?: string[]; mustHedge?: boolean };
    permission?: { marker: string; publishable: boolean };
    singleCluster?: boolean;
  };
}

interface CheckResult {
  caseId: string;
  category: string;
  check: string;
  pass: boolean;
  detail: string;
}

const HEDGE_MARKERS =
  /\b(appears? to|according to (?:the )?post|reported(?:ly)?|if (?:this|that|the) number is right|claims?|suggests?|unverified|\[STUART|\[COMMERCIAL|\[OPTIONAL|\[NO PUBLISHABLE)\b/i;

async function main() {
  const root = process.cwd();
  const goldPath = path.join(root, "fixtures/gold/cases.json");
  const { cases } = JSON.parse(fs.readFileSync(goldPath, "utf8")) as { cases: GoldCase[] };

  // one pipeline run per distinct input
  const runs = new Map<string, PureRun>();
  const runFor = (c: GoldCase): PureRun => {
    const key = c.input.fixture
      ? `f:${c.input.fixture}:${c.input.sourceType}:${c.input.pillar ?? ""}`
      : `t:${c.input.text}:${c.input.sourceType}:${c.input.pillar ?? ""}`;
    let run = runs.get(key);
    if (!run) {
      const raw = c.input.fixture
        ? fs.readFileSync(path.join(root, "fixtures", c.input.fixture), "utf8")
        : (c.input.text ?? "");
      run = runPurePipeline(raw, c.input.sourceType, undefined, c.input.pillar);
      runs.set(key, run);
    }
    return run;
  };

  const results: CheckResult[] = [];
  const provider = new MockProvider();
  const add = (caseId: string, category: string, check: string, pass: boolean, detail = "") =>
    results.push({ caseId, category, check, pass, detail });

  for (const c of cases) {
    const run = runFor(c);
    const e = c.expect;

    if (e.minContentItems !== undefined || e.maxContentItems !== undefined) {
      const n = run.items.filter((i) => !i.isNoise).length;
      const ok =
        (e.minContentItems === undefined || n >= e.minContentItems) &&
        (e.maxContentItems === undefined || n <= e.maxContentItems);
      add(c.id, c.category, "extraction_count", ok, `content items=${n}`);
    }

    if (e.item) {
      const match = run.items.find((i) => {
        if (e.item!.textContains && !(i.originalText + " " + (i.quotedText ?? "")).toLowerCase().includes(e.item!.textContains.toLowerCase())) return false;
        if (e.item!.authorContains && !(i.authorName ?? "").toLowerCase().includes(e.item!.authorContains.toLowerCase())) return false;
        return true;
      });
      let ok = Boolean(match);
      let detail = match ? `found ${match.itemType} by ${match.authorName ?? "?"}` : "no matching item";
      if (match && e.item.itemType) {
        const types = Array.isArray(e.item.itemType) ? e.item.itemType : [e.item.itemType];
        if (!types.includes(match.itemType)) {
          ok = false;
          detail = `itemType=${match.itemType}, expected ${types.join("|")}`;
        }
      }
      if (match && e.item.isNoise !== undefined && match.isNoise !== e.item.isNoise) {
        ok = false;
        detail = `isNoise=${match.isNoise}`;
      }
      add(c.id, c.category, "extraction_item", ok, detail);
    }

    if (e.clusterTogether) {
      const [a, b] = e.clusterTogether;
      const ca = clusterByMarker(run, a);
      const cb = clusterByMarker(run, b);
      const ok = Boolean(ca && cb && ca.key === cb.key);
      add(c.id, c.category, "cluster_together", ok, ca && cb ? `${ca.key} vs ${cb.key}` : "marker not found");
    }

    if (e.duplicates) {
      const markerItems = run.items.filter((i) =>
        i.originalText.toLowerCase().includes(e.duplicates!.marker.toLowerCase()),
      );
      const ids = new Set(markerItems.map((i) => i.tempId));
      let count = 0;
      for (const [dup, info] of run.dupes.duplicateOf) {
        if (ids.has(dup) || ids.has(info.canonical)) count += 1;
      }
      add(c.id, c.category, "duplicate_detection", count >= e.duplicates.minCount, `found ${count} dup relations`);
    }

    if (e.claim) {
      const claim = run.claims.find((cl) =>
        cl.claimText.toLowerCase().includes(e.claim!.textContains.toLowerCase()),
      );
      let ok = Boolean(claim);
      let detail = claim ? `status=${claim.status}` : "claim not found";
      if (claim && !e.claim.statusOneOf.includes(claim.status)) {
        ok = false;
        detail = `status=${claim.status}, expected ${e.claim.statusOneOf.join("|")}`;
      }
      if (claim && e.claim.maxIndependent !== undefined) {
        const independent = claim.evidence.filter((ev) => ev.independent).length;
        if (independent > e.claim.maxIndependent) {
          ok = false;
          detail = `independent=${independent} > max ${e.claim.maxIndependent} (repetition counted as corroboration)`;
        }
      }
      add(c.id, c.category, "claim_status", ok, detail);
      if (claim) {
        add(c.id, c.category, "evidence_traceability", claim.evidence.length > 0, `${claim.evidence.length} evidence rows`);
      }
    }

    if (e.action) {
      const opp = opportunityByMarker(run, e.action.marker);
      const ok = Boolean(opp && e.action.oneOf.includes(opp.recommendedAction));
      add(
        c.id,
        c.category,
        "action_classification",
        ok,
        opp ? `action=${opp.recommendedAction}, expected ${e.action.oneOf.join("|")}` : "no opportunity for marker",
      );
    }

    if (e.queued) {
      const opp = opportunityByMarker(run, e.queued.marker);
      const ok = Boolean(opp) && opp!.queued === e.queued.is;
      add(c.id, c.category, "queue_membership", ok, opp ? `queued=${opp.queued}` : "no opportunity for marker");
    }

    if (e.permission) {
      const cluster = clusterByMarker(run, e.permission.marker);
      const items = cluster
        ? cluster.memberTempIds.map((id) => run.items.find((i) => i.tempId === id)!).filter(Boolean)
        : [];
      const ok =
        items.length > 0 && items.every(() => isPublishable(run.permissionLevel) === e.permission!.publishable);
      add(c.id, c.category, "permission_level", ok, `ingestion permission=${run.permissionLevel}`);
    }

    if (e.singleCluster) {
      add(c.id, c.category, "single_cluster", run.clusters.length === 1, `clusters=${run.clusters.length}`);
    }

    if (e.draft) {
      const ctx = draftContextFor(run, e.draft.marker, e.draft.type);
      if (!ctx) {
        add(c.id, c.category, "draft_generated", false, "no draft context for marker");
      } else {
        const draft = await provider.generateDraft(ctx);
        const lint = lintVoice(draft, {
          hasUnverifiedClaims: ctx.hasUnverifiedClaims,
          outreach: ["dm", "email", "forum_post"].includes(e.draft.type),
          pillar: run.pillar,
        });
        add(c.id, c.category, "voice_compliance", lint.errors.length === 0, lint.errors.map((x) => x.rule).join(",") || "clean");
        if (e.draft.forbidden) {
          const restricted = run.items
            .filter(() => !isPublishable(run.permissionLevel))
            .map((i) => ({ id: i.tempId, kind: "source_item" as const, level: run.permissionLevel, text: i.originalText }));
          const leaks = detectLeaks(draft, restricted);
          const hits = e.draft.forbidden.filter((f) => draft.toLowerCase().includes(f.toLowerCase()));
          add(
            c.id,
            c.category,
            "permission_leakage",
            hits.length === 0 && leaks.length === 0,
            hits.length ? `forbidden strings present: ${hits.join(", ")}` : leaks.length ? `leak scanner: ${leaks[0].match}` : "no leakage",
          );
        }
        if (e.draft.mustHedge) {
          add(c.id, c.category, "uncertainty_preserved", HEDGE_MARKERS.test(draft), "hedge marker present?");
        }
      }
    }
  }

  // Global invariants across all runs -------------------------------------
  for (const [key, run] of runs) {
    // every claim traceable to evidence
    const untraceable = run.claims.filter((c) => c.evidence.length === 0).length;
    add("global", "evidence", "evidence_traceability_all", untraceable === 0, `${key}: ${untraceable} claims without evidence`);
    // queue never exceeds five
    const queued = run.opportunities.filter((o) => o.queued).length;
    add("global", "queue", "queue_cap", queued <= 5, `${key}: ${queued} queued`);
  }

  // ---- metrics -------------------------------------------------------------
  const byCheck = new Map<string, { pass: number; total: number }>();
  for (const r of results) {
    const rec = byCheck.get(r.check) ?? { pass: 0, total: 0 };
    rec.total += 1;
    if (r.pass) rec.pass += 1;
    byCheck.set(r.check, rec);
  }

  const failures = results.filter((r) => !r.pass);
  const report = {
    generatedAt: new Date().toISOString(),
    cases: cases.length,
    checks: results.length,
    passed: results.length - failures.length,
    metrics: Object.fromEntries(
      [...byCheck.entries()].map(([k, v]) => [k, { pass: v.pass, total: v.total, rate: +(v.pass / v.total).toFixed(3) }]),
    ),
    failures: failures.map((f) => ({ caseId: f.caseId, check: f.check, detail: f.detail })),
  };
  fs.writeFileSync(path.join(root, "eval-report.json"), JSON.stringify(report, null, 2));

  console.log("\nSIGNAL ROOM EVALUATION");
  console.log("=".repeat(64));
  for (const [check, v] of byCheck) {
    const rate = ((v.pass / v.total) * 100).toFixed(0).padStart(3);
    console.log(`${check.padEnd(28)} ${String(v.pass).padStart(3)}/${String(v.total).padEnd(3)} ${rate}%`);
  }
  console.log("=".repeat(64));
  if (failures.length) {
    console.log("\nFAILURES:");
    for (const f of failures) console.log(`  ✗ [${f.caseId}] ${f.check}: ${f.detail}`);
  }
  console.log(`\n${report.passed}/${report.checks} checks passed across ${cases.length} gold cases`);

  // ---- hard gates ---------------------------------------------------------
  const rate = (name: string) => {
    const m = byCheck.get(name);
    return m ? m.pass / m.total : 1;
  };
  const gates: { name: string; ok: boolean; requirement: string }[] = [
    { name: "permission_leakage", ok: rate("permission_leakage") === 1, requirement: "zero leakage" },
    { name: "voice_compliance", ok: rate("voice_compliance") === 1, requirement: "zero voice errors" },
    {
      name: "evidence_traceability",
      ok: rate("evidence_traceability") === 1 && rate("evidence_traceability_all") === 1,
      requirement: "100% claims linked to evidence",
    },
    { name: "extraction", ok: rate("extraction_item") >= 0.95 && rate("extraction_count") === 1, requirement: ">=95% extraction" },
    { name: "duplicates", ok: rate("duplicate_detection") >= 0.9, requirement: ">=90% duplicate detection" },
    { name: "clustering", ok: rate("cluster_together") >= 0.9, requirement: ">=90% cluster quality" },
    { name: "actions", ok: rate("action_classification") >= 0.7, requirement: ">=70% action accuracy" },
    { name: "queue", ok: rate("queue_membership") >= 0.85 && rate("queue_cap") === 1, requirement: "queue quality + cap" },
  ];
  const failedGates = gates.filter((g) => !g.ok);
  if (failedGates.length) {
    console.error(`\nGATES FAILED: ${failedGates.map((g) => `${g.name} (${g.requirement})`).join("; ")}`);
    process.exit(1);
  }
  console.log("\nAll quality gates passed.");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
