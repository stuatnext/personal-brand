import type { ClusterDraft, DedupeResult, EntityMentionDraft, ExtractedItem } from "./types";
import { jaccard } from "./dedupe";

const STOPWORDS = new Set(
  "the a an and or but of to in on for with at by from as is are was were be been it its this that these those i you he she we they what which who whom how when where why not no so if then than there here just about into over under again once more most other some such only own same very can will now new says said".split(
    " ",
  ),
);

/** Distinctive figures in a text: multi-digit numbers, money, percentages.
 *  Years and tiny counts are excluded; they fingerprint nothing. */
export function distinctiveNumbers(text: string): Set<string> {
  const out = new Set<string>();
  for (const m of text.match(/\$\s?[\d,.]+\s?(?:k|m|bn?|billion|million)?|\b\d+(?:\.\d+)?%|\b\d{2,}\b/gi) ?? []) {
    const clean = m.replace(/\s+/g, "").toLowerCase();
    if (/^(19|20)\d{2}$/.test(clean)) continue; // years
    out.add(clean);
  }
  return out;
}

export function significantWords(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/https?:\/\/\S+/g, " ")
      .replace(/[^\p{L}\p{N}\s]/gu, " ")
      .split(/\s+/)
      .filter((w) => w.length > 3 && !STOPWORDS.has(w)),
  );
}

/**
 * Group content items into story clusters:
 *  - duplicate/near-duplicate pairs always share a cluster (repetition)
 *  - items sharing >=2 named entities, or 1 entity plus lexical overlap,
 *    are the same story (relatedness)
 * Connected components over those edges. Repetition and thematic
 * relatedness stay distinguishable via cluster roles.
 */
export function buildClusters(
  items: ExtractedItem[],
  dedupe: DedupeResult,
  mentions: EntityMentionDraft[],
): ClusterDraft[] {
  const content = items.filter((i) => !i.isNoise && i.originalText.trim().length >= 30);
  if (content.length === 0) return [];

  const byId = new Map(content.map((i) => [i.tempId, i]));
  const parent = new Map<string, string>();
  const find = (x: string): string => {
    let r = x;
    while (parent.get(r) && parent.get(r) !== r) r = parent.get(r)!;
    parent.set(x, r);
    return r;
  };
  const union = (a: string, b: string) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  };
  for (const i of content) parent.set(i.tempId, i.tempId);

  // Edge source 1: duplicates.
  for (const [dup, info] of dedupe.duplicateOf) {
    if (byId.has(dup) && byId.has(info.canonical)) union(dup, info.canonical);
  }

  // A call is one conversation, not one story per sentence: unite the
  // speaker turns and the preamble metadata block.
  const transcriptItems = content.filter(
    (i) => i.itemType === "transcript_segment" || i.platform === "call",
  );
  for (let i = 1; i < transcriptItems.length; i++) {
    union(transcriptItems[0].tempId, transcriptItems[i].tempId);
  }

  // Edge source 2: shared entities + lexical overlap.
  const entitiesByItem = new Map<string, Set<string>>();
  for (const m of mentions) {
    if (m.role === "author") continue; // shared author is not shared story
    const set = entitiesByItem.get(m.itemTempId) ?? new Set();
    set.add(m.entityKey);
    entitiesByItem.set(m.itemTempId, set);
  }
  const wordCache = new Map<string, Set<string>>();
  const words = (i: ExtractedItem) => {
    let w = wordCache.get(i.tempId);
    if (!w) {
      w = significantWords(i.originalText + " " + (i.quotedText ?? ""));
      wordCache.set(i.tempId, w);
    }
    return w;
  };
  const numberCache = new Map<string, Set<string>>();
  const numbers = (i: ExtractedItem) => {
    let n = numberCache.get(i.tempId);
    if (!n) {
      n = distinctiveNumbers(i.originalText);
      numberCache.set(i.tempId, n);
    }
    return n;
  };
  for (let a = 0; a < content.length; a++) {
    for (let b = a + 1; b < content.length; b++) {
      const ia = content[a];
      const ib = content[b];
      if (find(ia.tempId) === find(ib.tempId)) continue;
      const ea = entitiesByItem.get(ia.tempId) ?? new Set();
      const eb = entitiesByItem.get(ib.tempId) ?? new Set();
      let shared = 0;
      for (const e of ea) if (eb.has(e)) shared += 1;
      if (shared === 0) continue;
      const lexical = jaccard(words(ia), words(ib));
      let sharedNumbers = 0;
      for (const n of numbers(ia)) if (numbers(ib).has(n)) sharedNumbers += 1;
      // In a single-category feed one shared entity is weak (everything
      // mentions Polymarket); demand two shared entities plus a lexical
      // echo, one entity with strong lexical overlap, or one entity plus a
      // shared distinctive figure ("12 states", "$14m"): numbers are strong
      // story fingerprints.
      if (
        (shared >= 2 && lexical >= 0.08) ||
        lexical >= 0.18 ||
        (shared >= 1 && sharedNumbers >= 1 && lexical >= 0.08)
      ) {
        union(ia.tempId, ib.tempId);
      }
    }
  }

  // Materialise components.
  const groups = new Map<string, ExtractedItem[]>();
  for (const i of content) {
    const root = find(i.tempId);
    const g = groups.get(root) ?? [];
    g.push(i);
    groups.set(root, g);
  }

  const clusters: ClusterDraft[] = [];
  let n = 0;
  for (const members of groups.values()) {
    n += 1;
    const roles = new Map<string, "primary" | "duplicate" | "commentary" | "quote" | "related" | "member">();
    // Primary: prefer an article/company announcement (likely original
    // source), else the item with the highest engagement, else the longest.
    const primary =
      members.find((m) => m.itemType === "article") ??
      members.find((m) => m.itemType === "company_announcement") ??
      [...members].sort((a, b) => engagementTotal(b) - engagementTotal(a) || b.originalText.length - a.originalText.length)[0];
    for (const m of members) {
      if (m.tempId === primary.tempId) roles.set(m.tempId, "primary");
      else if (dedupe.duplicateOf.has(m.tempId)) roles.set(m.tempId, "duplicate");
      else if (m.itemType === "quote_post" || m.itemType === "quoted_source") roles.set(m.tempId, "quote");
      else if (m.itemType === "comment" || m.itemType === "reply") roles.set(m.tempId, "commentary");
      else roles.set(m.tempId, "member");
    }
    const topics = [...new Set(members.flatMap((m) => m.topics))].slice(0, 8);
    clusters.push({
      key: `cluster-${n}`,
      canonicalTitle: makeTitle(primary),
      workingSummary: makeSummary(primary, members.length),
      topics,
      memberTempIds: members.map((m) => m.tempId),
      primaryTempId: primary.tempId,
      roles,
    });
  }
  // Stable order: biggest, most-engaged clusters first.
  clusters.sort((a, b) => b.memberTempIds.length - a.memberTempIds.length);
  return clusters;
}

export function engagementTotal(item: ExtractedItem): number {
  return Object.values(item.engagement).reduce<number>(
    (sum, v) => sum + (typeof v === "number" ? v : 0),
    0,
  );
}

function firstSentence(text: string, max = 110): string {
  const clean = text.replace(/\s+/g, " ").trim();
  const m = clean.match(/^.{20,}?[.!?](?=\s|$)/);
  const s = m ? m[0] : clean;
  return s.length > max ? s.slice(0, max - 1).trimEnd() + "…" : s;
}

function makeTitle(primary: ExtractedItem): string {
  if (primary.quotedText) return firstSentence(primary.quotedText, 100);
  return firstSentence(primary.originalText, 100);
}

function makeSummary(primary: ExtractedItem, memberCount: number): string {
  const who = primary.authorName ? `${primary.authorName} (${primary.platform})` : primary.platform;
  const excerpt = primary.originalText.replace(/\s+/g, " ").trim().slice(0, 220);
  const breadth = memberCount > 1 ? ` ${memberCount} related items in this paste.` : "";
  return `Primary source: ${who}. "${excerpt}${primary.originalText.length > 220 ? "…" : ""}"${breadth}`;
}
