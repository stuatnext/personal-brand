import type { ThreadSignature } from "@/lib/db/schema";
import type { ClaimDraft, ClusterDraft, EntityMentionDraft, ExtractedItem } from "./types";
import { distinctiveNumbers, significantWords } from "./cluster";
import { dedupeHash, jaccard } from "./dedupe";

// Cross-day story continuity. A cluster from today's run is matched
// against recent story threads by entity agreement, distinctive figures
// and keyword overlap. Cross-day language drifts more than within-day, so
// matching leans on entities (who the story is about) over exact wording;
// claim hashes let the thread say precisely which claims are new.

export interface ClusterSignature extends ThreadSignature {
  title: string;
}

const CAP = { entities: 14, keywords: 40, numbers: 16, claimHashes: 400 } as const;

export function buildClusterSignature(
  cluster: ClusterDraft,
  items: Map<string, ExtractedItem>,
  mentions: EntityMentionDraft[],
  claims: ClaimDraft[],
): ClusterSignature {
  const memberIds = new Set(cluster.memberTempIds);
  const entities = [
    ...new Set(
      mentions
        .filter((m) => memberIds.has(m.itemTempId) && m.role !== "author")
        .map((m) => m.entityKey),
    ),
  ].slice(0, CAP.entities);
  const primary = items.get(cluster.primaryTempId);
  // Claims are the factual skeleton of a story; keying keywords on them
  // (not just prose) stops one author's commentary voice from masking the
  // same story told by a different author on a different day.
  const clusterClaimTexts = claims
    .filter((c) => c.clusterKey === cluster.key)
    .map((c) => c.claimText)
    .join(" ");
  const keywordSource = `${cluster.canonicalTitle} ${clusterClaimTexts} ${primary?.originalText.slice(0, 400) ?? ""}`;
  const keywords = [...significantWords(keywordSource)].slice(0, CAP.keywords);
  const numbers = [
    ...new Set(
      cluster.memberTempIds.flatMap((id) => [...distinctiveNumbers(items.get(id)?.originalText ?? "")]),
    ),
  ].slice(0, CAP.numbers);
  const claimHashes = claims
    .filter((c) => c.clusterKey === cluster.key)
    .map((c) => dedupeHash(c.claimText));
  return { title: cluster.canonicalTitle, entities, keywords, numbers, claimHashes };
}

export interface ThreadCandidate {
  id: string;
  signature: ThreadSignature;
}

export interface ThreadMatch {
  threadId: string;
  score: number;
  sharedEntities: number;
  sharedNumbers: number;
  keywordOverlap: number;
}

/**
 * Score a cluster signature against a thread. Match requires entity
 * agreement plus an echo (figures or wording), or near-identical wording:
 * the same two named entities in loosely similar coverage is the same
 * story; one shared entity alone (everything mentions Kalshi) is not.
 */
export function scoreThreadMatch(sig: ClusterSignature, thread: ThreadCandidate): ThreadMatch {
  const tEntities = new Set(thread.signature.entities);
  const tNumbers = new Set(thread.signature.numbers);
  const sharedEntities = sig.entities.filter((e) => tEntities.has(e)).length;
  const sharedNumbers = sig.numbers.filter((n) => tNumbers.has(n)).length;
  const keywordOverlap = jaccard(new Set(sig.keywords), new Set(thread.signature.keywords));
  const score = sharedEntities * 2 + sharedNumbers * 1.5 + keywordOverlap * 10;
  return { threadId: thread.id, score, sharedEntities, sharedNumbers, keywordOverlap };
}

export function isThreadMatch(m: ThreadMatch): boolean {
  if (m.sharedEntities >= 2 && m.keywordOverlap >= 0.12) return true;
  if (m.sharedEntities >= 3) return true;
  if (m.sharedEntities >= 1 && m.sharedNumbers >= 1 && m.keywordOverlap >= 0.12) return true;
  if (m.keywordOverlap >= 0.45) return true; // near-identical headline/coverage
  return false;
}

export function bestThreadMatch(
  sig: ClusterSignature,
  threads: ThreadCandidate[],
): ThreadMatch | null {
  let best: ThreadMatch | null = null;
  for (const t of threads) {
    const m = scoreThreadMatch(sig, t);
    if (!isThreadMatch(m)) continue;
    if (!best || m.score > best.score) best = m;
  }
  return best;
}

/** Union the cluster's signature into the thread's, bounded. */
export function mergeSignature(thread: ThreadSignature, sig: ClusterSignature): ThreadSignature {
  const union = (a: string[], b: string[], cap: number) => [...new Set([...a, ...b])].slice(-cap);
  return {
    entities: union(thread.entities, sig.entities, CAP.entities * 2),
    keywords: union(thread.keywords, sig.keywords, CAP.keywords * 2),
    numbers: union(thread.numbers, sig.numbers, CAP.numbers * 2),
    claimHashes: union(thread.claimHashes, sig.claimHashes, CAP.claimHashes),
  };
}

/** Which of the cluster's claims has this thread not seen before? */
export function newClaimsAgainstThread(
  thread: ThreadSignature,
  clusterClaims: ClaimDraft[],
): ClaimDraft[] {
  const seen = new Set(thread.claimHashes);
  return clusterClaims.filter((c) => !seen.has(dedupeHash(c.claimText)));
}

/** Continuity facts handed to scoring and editorial text. */
export interface ThreadInfo {
  threadId: string;
  /** including today's observation */
  observationCount: number;
  firstObservedAt: Date;
  lastSeenBefore: Date | null;
  newClaimCount: number;
  /** up to three new claims with their verification status, for hedged text */
  newClaims: { text: string; status: string }[];
  knownClaimCount: number;
}
