import type { DedupeResult, ExtractedItem } from "./types";
import { sha256 } from "@/lib/ids";

/** Normalise text for duplicate detection: case, whitespace, punctuation,
 *  zero-width litter, ellipsis truncation markers. */
export function normaliseForDedupe(text: string): string {
  return text
    .toLowerCase()
    .replace(/[​‌‍﻿]/gu, "")
    .replace(/…more$|\.\.\.more$/i, "")
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function dedupeHash(text: string): string {
  return sha256(normaliseForDedupe(text)).slice(0, 24);
}

export function shingles(text: string, size = 4): Set<string> {
  const words = normaliseForDedupe(text).split(" ").filter(Boolean);
  const out = new Set<string>();
  if (words.length < size) {
    if (words.length > 0) out.add(words.join(" "));
    return out;
  }
  for (let i = 0; i + size <= words.length; i++) {
    out.add(words.slice(i, i + size).join(" "));
  }
  return out;
}

export function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  for (const s of small) if (large.has(s)) inter += 1;
  return inter / (a.size + b.size - inter);
}

/** Containment: how much of the smaller text is inside the larger one.
 *  Catches truncated reposts ("…more") that Jaccard under-scores. */
export function containment(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  let inter = 0;
  for (const s of small) if (large.has(s)) inter += 1;
  return inter / small.size;
}

export interface DedupeOptions {
  exactThreshold?: number; // jaccard >= -> duplicate_of
  nearThreshold?: number; // jaccard >= -> near_duplicate_of
  containmentThreshold?: number;
}

/**
 * Detect duplicates among content items. Exact duplicates share a
 * normalised hash; near duplicates exceed shingle similarity thresholds.
 * The canonical item is the earliest (lowest raw offset) with the longest
 * text among its group.
 */
export function detectDuplicates(items: ExtractedItem[], opts: DedupeOptions = {}): DedupeResult {
  const { exactThreshold = 0.9, nearThreshold = 0.55, containmentThreshold = 0.85 } = opts;
  const content = items.filter((i) => !i.isNoise && i.originalText.trim().length >= 30);
  const result: DedupeResult = { duplicateOf: new Map() };

  // Pass 1: exact hash groups.
  const byHash = new Map<string, ExtractedItem[]>();
  for (const item of content) {
    const h = dedupeHash(item.originalText);
    const group = byHash.get(h) ?? [];
    group.push(item);
    byHash.set(h, group);
  }
  const canonicalOf = new Map<string, string>();
  for (const group of byHash.values()) {
    if (group.length < 2) continue;
    const canonical = group.reduce((best, cur) =>
      cur.originalText.length > best.originalText.length ? cur : best,
    );
    for (const item of group) {
      if (item.tempId !== canonical.tempId) {
        result.duplicateOf.set(item.tempId, {
          canonical: canonical.tempId,
          kind: "duplicate_of",
          similarity: 1,
        });
        canonicalOf.set(item.tempId, canonical.tempId);
      }
    }
  }

  // Pass 2: near-duplicates among remaining canonicals (O(n²) with a length
  // pre-filter; fine at feed scale — a 50k-word paste yields low hundreds of
  // items).
  const canonicals = content.filter((i) => !canonicalOf.has(i.tempId));
  const shingleCache = new Map<string, Set<string>>();
  const sh = (item: ExtractedItem) => {
    let s = shingleCache.get(item.tempId);
    if (!s) {
      s = shingles(item.originalText);
      shingleCache.set(item.tempId, s);
    }
    return s;
  };
  for (let i = 0; i < canonicals.length; i++) {
    for (let j = i + 1; j < canonicals.length; j++) {
      const a = canonicals[i];
      const b = canonicals[j];
      if (result.duplicateOf.has(b.tempId)) continue;
      const lenRatio =
        Math.min(a.originalText.length, b.originalText.length) /
        Math.max(a.originalText.length, b.originalText.length);
      if (lenRatio < 0.15) continue;
      const sim = jaccard(sh(a), sh(b));
      const cont = containment(sh(a), sh(b));
      if (sim >= exactThreshold || cont >= containmentThreshold) {
        const canonical = a.originalText.length >= b.originalText.length ? a : b;
        const dup = canonical === a ? b : a;
        if (!result.duplicateOf.has(dup.tempId)) {
          result.duplicateOf.set(dup.tempId, {
            canonical: canonical.tempId,
            kind: "duplicate_of",
            similarity: Math.max(sim, cont),
          });
        }
      } else if (sim >= nearThreshold) {
        const canonical = a.originalText.length >= b.originalText.length ? a : b;
        const dup = canonical === a ? b : a;
        if (!result.duplicateOf.has(dup.tempId)) {
          result.duplicateOf.set(dup.tempId, {
            canonical: canonical.tempId,
            kind: "near_duplicate_of",
            similarity: sim,
          });
        }
      }
    }
  }
  return result;
}
