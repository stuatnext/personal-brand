/* Live-provider shakedown: the first structured evaluation of Claude
 * drafting against Stuart's voice rules and the permission scanner.
 *
 *   ANTHROPIC_API_KEY=sk-... npm run shakedown          # run
 *   ANTHROPIC_API_KEY=sk-... npm run shakedown -- -n 3  # cap opportunities
 *
 * For each of the top queued opportunities it generates a live draft of
 * the recommended type (plus one LinkedIn post), then reports per draft:
 * voice-lint errors/warnings, permission-leak hits, latency, hedging
 * presence when claims are unverified, and a side-by-side size comparison
 * with the mock skeleton. Writes shakedown-report.json. Costs real tokens:
 * roughly (2 x opportunities) editorial-model calls, plus voice-retry
 * calls when the linter objects.
 */
import fs from "fs";
import path from "path";
import { ensureMigrated } from "../src/lib/db/client";
import { getProvider } from "../src/lib/ai/provider";
import { MockProvider } from "../src/lib/ai/mock";
import { getTodayQueue } from "../src/lib/queue";
import { generateDraft } from "../src/lib/drafts";
import { db } from "../src/lib/db/client";
import { drafts as draftsTable } from "../src/lib/db/schema";
import { eq } from "drizzle-orm";

const TYPE_BY_ACTION: Record<string, string> = {
  comment: "linkedin_comment",
  quote_post: "x_quote_post",
  x_post: "x_post",
  linkedin_post: "linkedin_post",
  forum_post: "forum_post",
  dm: "dm",
  email: "email",
  speaker_lead: "email",
  sponsor_lead: "email",
  media_lead: "email",
  sales_handoff: "email",
  investigate: "x_post",
  save: "linkedin_post",
  monitor: "x_post",
};

interface ShakedownRow {
  opportunity: string;
  draftType: string;
  latencyMs: number;
  lintErrors: string[];
  lintWarnings: string[];
  permissionLeaks: number;
  hedged: boolean;
  liveChars: number;
  mockChars: number;
  bracketedSlots: number;
}

const HEDGES = /\b(appears? to|according to|reported(?:ly)?|if (?:this|that|the) number is right|suggests?)\b/i;

async function main() {
  await ensureMigrated();
  const provider = getProvider();
  if (!provider.isReal) {
    console.error(
      "[shakedown] no ANTHROPIC_API_KEY in the environment: this run needs the live provider.\n" +
        "            Set the key and re-run. Nothing was generated.",
    );
    process.exit(1);
  }

  const nFlag = process.argv.indexOf("-n");
  const cap = nFlag >= 0 ? Number(process.argv[nFlag + 1]) || 3 : 3;
  const queue = (await getTodayQueue()).slice(0, cap);
  if (queue.length === 0) {
    console.error("[shakedown] the queue is empty; ingest something first.");
    process.exit(1);
  }
  console.log(`[shakedown] provider=${provider.name}, ${queue.length} opportunity(ies), ~${queue.length * 2} live drafts\n`);

  const database = await db();
  const mock = new MockProvider();
  const rows: ShakedownRow[] = [];

  for (const q of queue) {
    const types = [...new Set([TYPE_BY_ACTION[q.action] ?? "linkedin_post", "linkedin_post"])];
    for (const draftType of types) {
      const started = Date.now();
      try {
        const result = await generateDraft(q.opportunityId, draftType);
        const latencyMs = Date.now() - started;
        // mock comparison from the same stored context is impractical here;
        // regenerate the mock text from the persisted draft's opportunity via
        // a fresh call on the mock provider with minimal context
        const [row] = await database.select().from(draftsTable).where(eq(draftsTable.id, result.id));
        const mockText = await mock.generateDraft({
          draftType,
          opportunityTitle: q.title,
          whatHappened: q.whatHappened ?? "",
          stuartAngle: q.stuartAngle ?? "",
          editorialAngle: "",
          claimedSummary: "",
          confirmedSummary: "",
          allowedEvidence: [],
          hasUnverifiedClaims: true,
        });
        rows.push({
          opportunity: q.title.slice(0, 60),
          draftType,
          latencyMs,
          lintErrors: result.voiceLint.errors.map((e) => e.rule),
          lintWarnings: result.voiceLint.warnings.map((w) => w.rule),
          permissionLeaks: result.permissionWarnings.length,
          hedged: HEDGES.test(result.content),
          liveChars: result.content.length,
          mockChars: mockText.length,
          bracketedSlots: (row?.content.match(/\[[A-Z][A-Z ]+/g) ?? []).length,
        });
        console.log(
          `  ✓ ${draftType.padEnd(18)} ${String(latencyMs).padStart(6)}ms  errors=${result.voiceLint.errors.length} warnings=${result.voiceLint.warnings.length} leaks=${result.permissionWarnings.length}  :: ${q.title.slice(0, 48)}`,
        );
      } catch (err) {
        console.error(`  ✗ ${draftType} failed: ${err instanceof Error ? err.message : err}`);
        rows.push({
          opportunity: q.title.slice(0, 60),
          draftType,
          latencyMs: Date.now() - started,
          lintErrors: ["GENERATION_FAILED"],
          lintWarnings: [],
          permissionLeaks: 0,
          hedged: false,
          liveChars: 0,
          mockChars: 0,
          bracketedSlots: 0,
        });
      }
    }
  }

  const report = {
    generatedAt: new Date().toISOString(),
    provider: provider.name,
    drafts: rows.length,
    cleanDrafts: rows.filter((r) => r.lintErrors.length === 0 && r.permissionLeaks === 0).length,
    hedgedShare: rows.length ? rows.filter((r) => r.hedged).length / rows.length : 0,
    meanLatencyMs: rows.length ? Math.round(rows.reduce((s, r) => s + r.latencyMs, 0) / rows.length) : 0,
    rows,
  };
  fs.writeFileSync(path.resolve(process.cwd(), "shakedown-report.json"), JSON.stringify(report, null, 2));
  console.log(
    `\n[shakedown] ${report.cleanDrafts}/${report.drafts} drafts clean (voice + permissions), mean latency ${report.meanLatencyMs}ms`,
  );
  console.log("[shakedown] full report: shakedown-report.json; drafts are saved and editable under /drafts");
  process.exit(report.cleanDrafts === report.drafts ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
