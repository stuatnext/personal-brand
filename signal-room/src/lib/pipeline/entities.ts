import type { EntityMentionDraft, ExtractedItem } from "./types";
import { GAZETTEER, type GazetteerEntry } from "./gazetteer";

export interface EntityIndexEntry extends GazetteerEntry {
  key: string;
}

function keyFor(kind: string, name: string): string {
  return `${kind}:${name}`;
}

/** Build a matcher over the gazetteer + any extra known entities. */
export function buildEntityIndex(extra: GazetteerEntry[] = []): {
  entries: EntityIndexEntry[];
  patterns: { entry: EntityIndexEntry; regex: RegExp; alias: string }[];
} {
  const entries: EntityIndexEntry[] = [...GAZETTEER, ...extra].map((e) => ({
    ...e,
    key: keyFor(e.kind, e.name),
  }));
  const patterns: { entry: EntityIndexEntry; regex: RegExp; alias: string }[] = [];
  for (const entry of entries) {
    for (const alias of [entry.name, ...(entry.aliases ?? [])]) {
      const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      // Short all-caps names (SEC, ICE, CME, FT) must match exact case to
      // avoid catching ordinary words; everything else is case-insensitive
      // but must start on a word boundary.
      const isAcronym = /^[A-Z]{2,6}$/.test(alias);
      const regex = isAcronym
        ? new RegExp(`\\b${escaped}\\b`, "g")
        : new RegExp(`\\b${escaped}\\b`, "gi");
      patterns.push({ entry, regex, alias });
    }
  }
  return { entries, patterns };
}

const ROLE_AT_ORG =
  /\b(CEO|CFO|COO|CTO|CMO|Chief [A-Z][a-z]+ Officer|founder|co-?founder|president|head of [\w &]+|VP of [\w &]+|general counsel|managing director|partner)\s+(?:of|at)\s+([A-Z][\w.&'-]*(?:\s+[A-Z][\w.&'-]*){0,3})/g;

/**
 * Extract entity mentions from content items: gazetteer matches, authors,
 * and role-at-company patterns for candidate discovery (never invented;
 * every mention carries its source text).
 */
export function extractEntities(items: ExtractedItem[]): EntityMentionDraft[] {
  const { patterns } = buildEntityIndex();
  const mentions: EntityMentionDraft[] = [];

  for (const item of items) {
    if (item.isNoise) continue;
    const text = item.originalText;

    // 1. Authors are entities.
    if (item.authorName && item.authorName.length >= 3 && item.authorName.length <= 60) {
      const isCompany = item.itemType === "company_announcement";
      mentions.push({
        entityKey: keyFor(isCompany ? "company" : "person", item.authorName),
        kind: isCompany ? "company" : "person",
        canonicalName: item.authorName,
        mentionText: item.authorName,
        role: "author",
        itemTempId: item.tempId,
        confidence: 0.85,
      });
      // Author headline often names their organisation ("Commercial Director,
      // NEXT.io" / "GenCap | Virtuals Protocol").
      if (item.authorMeta) {
        for (const { entry, regex } of patterns) {
          regex.lastIndex = 0;
          if ((entry.kind === "company" || entry.kind === "platform") && regex.test(item.authorMeta)) {
            mentions.push({
              entityKey: entry.key,
              kind: entry.kind,
              canonicalName: entry.name,
              mentionText: item.authorMeta.slice(0, 80),
              role: "organisation",
              itemTempId: item.tempId,
              confidence: 0.7,
            });
          }
        }
      }
    }

    // 2. Gazetteer matches in the body.
    const seenInItem = new Set<string>();
    for (const { entry, regex } of patterns) {
      regex.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = regex.exec(text)) !== null) {
        const dedupeKey = `${entry.key}`;
        if (seenInItem.has(dedupeKey)) break;
        seenInItem.add(dedupeKey);
        mentions.push({
          entityKey: entry.key,
          kind: entry.kind,
          canonicalName: entry.name,
          mentionText: m[0],
          role: "mentioned",
          itemTempId: item.tempId,
          startOffset: item.rawStartOffset,
          endOffset: item.rawEndOffset,
          confidence: 0.9,
        });
      }
    }

    // 3. Role-at-organisation discovery (candidate entities, lower confidence).
    ROLE_AT_ORG.lastIndex = 0;
    let rm: RegExpExecArray | null;
    while ((rm = ROLE_AT_ORG.exec(text)) !== null) {
      const org = rm[2].trim().replace(/[.,;:]$/, "");
      if (org.length >= 2 && org.length <= 50 && !seenInItem.has(keyFor("company", org))) {
        seenInItem.add(keyFor("company", org));
        mentions.push({
          entityKey: keyFor("company", org),
          kind: "company",
          canonicalName: org,
          mentionText: rm[0].slice(0, 100),
          role: "mentioned",
          itemTempId: item.tempId,
          confidence: 0.55,
        });
      }
    }
  }
  return mentions;
}

/** Entities flagged in the gazetteer as prospect-relevant, for lead detection. */
export function prospectFlags(entityKey: string): GazetteerEntry["flags"] | undefined {
  const entry = GAZETTEER.find((e) => keyFor(e.kind, e.name) === entityKey);
  return entry?.flags;
}
