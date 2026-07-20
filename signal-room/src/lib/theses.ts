import { eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { auditLog, theses, thesisEvidence } from "@/lib/db/schema";
import { uid } from "@/lib/ids";
import { significantWords } from "@/lib/pipeline/cluster";

// Thesis tracking v1 (the Oracle layer's first slice). Theses are Stuart's
// standing positions; the pipeline SUGGESTS claim evidence for them, and
// only Stuart confirms, sets stance, and moves confidence. The system
// never updates confidence on its own: it counts evidence, it doesn't
// pretend to forecast.

const OPEN_STATUSES = ["open", "strengthening", "weakening"];

/** Keyword overlap between a thesis statement and a claim sentence. */
export function matchesThesis(thesisKeywords: Set<string>, claimText: string): boolean {
  if (thesisKeywords.size === 0) return false;
  const claimWords = significantWords(claimText);
  let hits = 0;
  for (const w of thesisKeywords) if (claimWords.has(w)) hits += 1;
  // two shared significant words, or full coverage of a very short thesis
  return hits >= 2 || (hits >= 1 && thesisKeywords.size <= 2);
}

/**
 * Offer this run's claims as SUGGESTED evidence on open theses. Stance is
 * deliberately "context" until Stuart reads the claim: guessing
 * supports/counters automatically would put words in the thesis. Returns
 * the number of suggestions created.
 */
export async function suggestThesisEvidence(claimRows: { id: string; text: string }[]): Promise<number> {
  if (claimRows.length === 0) return 0;
  const database = await db();
  const open = (await database.select().from(theses)).filter((t) => OPEN_STATUSES.includes(t.status));
  if (open.length === 0) return 0;

  let created = 0;
  for (const thesis of open) {
    const keywords = significantWords(thesis.statement + " " + (thesis.tagsJson ?? []).join(" "));
    const existing = new Set(
      (
        await database
          .select({ claimId: thesisEvidence.claimId })
          .from(thesisEvidence)
          .where(eq(thesisEvidence.thesisId, thesis.id))
      ).map((r) => r.claimId),
    );
    for (const claim of claimRows) {
      if (existing.has(claim.id)) continue;
      if (!matchesThesis(keywords, claim.text)) continue;
      await database.insert(thesisEvidence).values({
        id: uid(),
        thesisId: thesis.id,
        claimId: claim.id,
        stance: "context",
        state: "suggested",
        note: "auto-suggested by keyword match; confirm or reject",
      });
      created += 1;
    }
  }
  return created;
}

export interface ThesisSummary {
  id: string;
  statement: string;
  status: string;
  confidence: number;
  supporting: number;
  countering: number;
  suggested: number;
  lastEvidenceAt: string | null;
  updatedAt: string;
}

export async function listTheses(): Promise<ThesisSummary[]> {
  const database = await db();
  const rows = await database.select().from(theses);
  const evidence = rows.length
    ? await database
        .select()
        .from(thesisEvidence)
        .where(inArray(thesisEvidence.thesisId, rows.map((r) => r.id)))
    : [];
  return rows
    .map((t) => {
      const ev = evidence.filter((e) => e.thesisId === t.id);
      const lastEvidenceAt = ev.length
        ? new Date(Math.max(...ev.map((e) => e.createdAt?.getTime() ?? 0))).toISOString()
        : null;
      return {
        id: t.id,
        statement: t.statement,
        status: t.status,
        confidence: t.confidence,
        supporting: ev.filter((e) => e.state === "confirmed" && e.stance === "supports").length,
        countering: ev.filter((e) => e.state === "confirmed" && e.stance === "counters").length,
        suggested: ev.filter((e) => e.state === "suggested").length,
        lastEvidenceAt,
        updatedAt: t.updatedAt?.toISOString() ?? "",
      };
    })
    .sort((a, b) => (b.lastEvidenceAt ?? "").localeCompare(a.lastEvidenceAt ?? ""));
}

/** Record a confidence move with its reason in the audit trail. */
export async function recordConfidenceChange(
  thesisId: string,
  from: number,
  to: number,
  note?: string,
): Promise<void> {
  const database = await db();
  await database.insert(auditLog).values({
    id: uid(),
    actor: "stuart",
    action: "thesis_confidence_change",
    scopeType: "thesis",
    scopeId: thesisId,
    detailJson: { from, to, note: note ?? null },
  });
}
