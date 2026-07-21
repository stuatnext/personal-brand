import { PUBLISHABLE_LEVELS, type PermissionWarning } from "@/lib/db/schema";
import { shingles, jaccard, normaliseForDedupe } from "@/lib/pipeline/dedupe";

// Two layers of protection:
//  1. Structural: restricted evidence is never included in the writing
//     agent's allowed-evidence set (see draft context assembly). Private
//     material may inform the ANGLE as context notes, never draft input.
//  2. Textual: every draft is scanned against restricted material anyway,
//     in case restricted text arrived via another path.

export function isPublishable(level: string): boolean {
  return PUBLISHABLE_LEVELS.has(level);
}

export interface RestrictedSource {
  id: string;
  kind: "source_item" | "claim";
  level: string;
  text: string;
}

// Function words and conversational filler: a 4-gram made ONLY of these is
// ordinary speech, not a fingerprint. Without this check, the outreach
// templates' own stock phrasing ("hear how you're seeing it") collides
// with any call transcript containing the same small talk and permanently
// blocks mark-final on boilerplate (live false positive, 2026-07-21).
const COMMON_WORDS = new Set([
  "the", "a", "an", "and", "or", "but", "if", "of", "to", "in", "on", "for", "at", "by",
  "with", "from", "as", "is", "are", "was", "were", "be", "been", "being", "it", "its",
  "this", "that", "these", "those", "i", "im", "you", "your", "youre", "we", "our",
  "they", "their", "he", "she", "his", "her", "them", "us", "me", "my", "how", "what",
  "when", "where", "which", "who", "why", "would", "could", "should", "can", "will",
  "just", "not", "no", "yes", "do", "does", "did", "done", "have", "has", "had", "get",
  "got", "see", "seeing", "hear", "hearing", "say", "said", "know", "think", "want",
  "re", "s", "t", "d", "ll", "m", "ve", "about", "into", "over", "under", "out", "up",
  "down", "all", "any", "some", "more", "most", "much", "many", "so", "very", "really",
  "then", "than", "there", "here", "now", "one", "two", "way", "thing", "things",
]);

/** True when the shingle carries at least one word that could identify a
 *  specific fact: a non-filler word of real length, or a multi-digit token. */
function isDistinctiveShingle(sh: string): boolean {
  return sh
    .split(" ")
    .some((w) => (!COMMON_WORDS.has(w) && w.length >= 4) || /\d{2,}/.test(w));
}

/** Distinctive fingerprints of restricted text: 4-word shingles, uncommon
 *  numbers, and Name-pair tokens. */
function fingerprints(text: string): { shingleSet: Set<string>; numbers: Set<string>; names: Set<string> } {
  const shingleSet = shingles(text, 4);
  const numbers = new Set(
    (text.match(/\$\s?[\d,.]+\s?(?:k|m|bn?|billion|million)?|\b\d{2,3}(?:,\d{3})+\b|\b\d+(?:\.\d+)?%/gi) ?? []).map(
      (n) => n.replace(/\s+/g, "").toLowerCase(),
    ),
  );
  const names = new Set(
    (text.match(/\b[A-Z][a-z]{2,}\s+[A-Z][a-z]{2,}\b/g) ?? []).map((n) => n.toLowerCase()),
  );
  return { shingleSet, numbers, names };
}

/**
 * Scan a draft for leakage from restricted sources. Returns a warning per
 * restricted source that appears to surface in the draft.
 */
export function detectLeaks(draftText: string, restricted: RestrictedSource[]): PermissionWarning[] {
  const warnings: PermissionWarning[] = [];
  const draftFp = fingerprints(draftText);
  const draftNorm = normaliseForDedupe(draftText);

  for (const source of restricted) {
    if (isPublishable(source.level)) continue;
    const fp = fingerprints(source.text);

    // Verbatim fragment: any DISTINCTIVE shingle of the restricted text
    // present in the draft (common-word-only shingles are ordinary speech).
    let shingleHit: string | undefined;
    for (const sh of fp.shingleSet) {
      if (sh.split(" ").length >= 4 && isDistinctiveShingle(sh) && draftNorm.includes(sh)) {
        shingleHit = sh;
        break;
      }
    }
    const overlap = jaccard(draftFp.shingleSet, fp.shingleSet);

    let numberHit: string | undefined;
    for (const n of fp.numbers) {
      if (draftFp.numbers.has(n)) {
        numberHit = n;
        break;
      }
    }

    if (shingleHit || overlap >= 0.12 || numberHit) {
      warnings.push({
        level: source.level,
        sourceItemId: source.kind === "source_item" ? source.id : undefined,
        claimId: source.kind === "claim" ? source.id : undefined,
        match: shingleHit ?? numberHit ?? `${Math.round(overlap * 100)}% phrase overlap`,
        message: `Draft appears to draw on ${source.level.replace(/_/g, " ")} material (${
          shingleHit ? `verbatim fragment "${shingleHit}"` : numberHit ? `distinctive figure ${numberHit}` : "substantial phrase overlap"
        }). That evidence is not publishable.`,
      });
    }
  }
  return warnings;
}

/** Default permission level by source type: private capture types are
 *  restricted from the start, social/news are public. */
export function defaultPermissionForSource(sourceType: string): string {
  switch (sourceType) {
    case "call_transcript":
      return "private";
    case "internal_notes":
      return "internal_only";
    default:
      return "public";
  }
}
