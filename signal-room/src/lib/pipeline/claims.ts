import type { ClaimDraft, ClusterDraft, EntityMentionDraft, ExtractedItem } from "./types";
import { jaccard, shingles } from "./dedupe";

// Claims are first-class: every meaningful factual assertion gets a record,
// linked to the exact evidence excerpt, with an honest verification state.
// Twenty posts repeating one article are one underlying source, not twenty
// confirmations — independence is computed, not assumed.

const CLAIM_VERBS =
  /\b(announc\w+|launch\w+|rais\w+|fil\w+|approv\w+|ban(?:s|ned)?|barr?\w+|block\w+|hir\w+|join\w+|leav\w+|left|depart\w+|acquir\w+|partner\w+|list\w+|delist\w+|settl\w+|fin(?:e|ed|es)|su(?:e|ed|es|ing)|invest\w+|expand\w+|shut\w+|halt\w+|suspend\w+|resign\w+|appoint\w+|steps? (?:back|down)|stepp(?:ed|ing) (?:back|down)|report\w+|confirm\w+|den(?:y|ies|ied)|warn\w+|order\w+|rule[sd]?|grant\w+|reject\w+|surpass\w+|hit|reach\w+|clear\w+|register\w+|volume|revenue)\b/i;

const NUMBER_SIGNAL = /(\$\s?[\d,.]+\s?(?:k|m|b|bn|billion|million|thousand)?|\b\d{1,3}(?:,\d{3})+\b|\b\d+(?:\.\d+)?%|\b\d+(?:\.\d+)?x\b)/i;

const REGULATORY_TERMS =
  /\b(CFTC|SEC|FINRA|DOJ|FCA|regulat\w+|complian\w+|licen[cs]\w+|no-action|DCM|DCO|designation|subpoena|lawsuit|litigation|injunction|cease.and.desist|enforcement|MNPI|surveillance|KYC|AML)\b/;

const OPINION_MARKERS =
  /\b(I think|I believe|in my (?:view|opinion)|arguably|probably|seems? to me|my take|I suspect|feels like|IMO)\b/i;

const CONTRADICTION_MARKERS =
  /\b(denies|denied|not true|false|debunk\w+|refut\w+|dispute[sd]?|contradicts?|actually didn'?t|no evidence)\b/i;

export function splitSentences(text: string): { sentence: string; index: number }[] {
  const clean = text.replace(/\s+/g, " ").trim();
  const out: { sentence: string; index: number }[] = [];
  const re = /[^.!?]+[.!?]+(?:["')\]]+)?|\S[^.!?]*$/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(clean)) !== null) {
    const s = m[0].trim();
    if (s.length >= 25) out.push({ sentence: s, index: m.index });
  }
  return out;
}

export function isClaimSentence(s: string): boolean {
  if (OPINION_MARKERS.test(s)) return false;
  if (s.trim().endsWith("?")) return false;
  return CLAIM_VERBS.test(s) || NUMBER_SIGNAL.test(s) || REGULATORY_TERMS.test(s);
}

function publicationRiskFor(sentence: string, status: string): "low" | "medium" | "high" {
  const risky = REGULATORY_TERMS.test(sentence) || NUMBER_SIGNAL.test(sentence);
  if (status === "corroborated" || status === "verified") return "low";
  if (status === "primary_source_found") return risky ? "medium" : "low";
  if (risky) return status === "reported" ? "medium" : "high";
  return status === "social_claim_only" ? "medium" : "low";
}

const GENERIC_ORG_WORDS = new Set([
  "group",
  "inc",
  "llc",
  "ltd",
  "corp",
  "company",
  "holdings",
  "capital",
  "ventures",
  "partners",
  "labs",
  "media",
  "news",
  "daily",
  "the",
  "chief",
  "executive",
  "officer",
  "director",
  "president",
  "global",
  "solutions",
]);

/** Candidate organisation tokens from an author line. Person authors only
 *  contribute the org after "at"/"@" in their headline (never their own
 *  name); company accounts contribute their full name as ONE phrase, so an
 *  aggregator called "Crypto Breaking News" cannot match the word "crypto". */
export function extractOrgTokens(
  authorName: string | undefined,
  authorMeta: string | undefined,
  sourceUrl: string | undefined,
  isCompanyAuthor: boolean,
): string[] {
  const tokens = new Set<string>();
  const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const atOrg = authorMeta?.match(/\b(?:at|@)\s+([A-Z][\w.&' -]{2,40})/);
  if (atOrg) {
    for (const word of atOrg[1].split(/[\s,|·]+/)) {
      const clean = word.replace(/[^\w.&-]/g, "");
      if (clean.length >= 3 && /^[A-Z]/.test(clean) && !GENERIC_ORG_WORDS.has(clean.toLowerCase())) {
        tokens.add(escape(clean));
      }
    }
  }
  if (isCompanyAuthor && authorName && authorName.trim().length >= 4) {
    tokens.add(escape(authorName.trim()));
  }
  if (sourceUrl) {
    const host = sourceUrl.match(/^https?:\/\/(?:www\.)?([a-z0-9-]{4,})\./i)?.[1];
    if (host && !GENERIC_ORG_WORDS.has(host.toLowerCase())) tokens.add(escape(host));
  }
  return [...tokens];
}

const ARTICLE_TYPES = new Set(["article", "company_announcement"]);

/**
 * Extract claims per cluster. Each claim carries evidence rows pointing at
 * exact sentences in exact items; independence requires a genuinely
 * different origin (different author AND different platform-or-type AND not
 * a textual near-copy of existing evidence).
 */
export function extractClaims(
  items: ExtractedItem[],
  clusters: ClusterDraft[],
  mentions: EntityMentionDraft[],
  defaultPermission: string,
): ClaimDraft[] {
  const byId = new Map(items.map((i) => [i.tempId, i]));
  const mentionsByItem = new Map<string, EntityMentionDraft[]>();
  for (const m of mentions) {
    const arr = mentionsByItem.get(m.itemTempId) ?? [];
    arr.push(m);
    mentionsByItem.set(m.itemTempId, arr);
  }

  const claims: ClaimDraft[] = [];
  let claimCounter = 0;

  for (const cluster of clusters) {
    // Collect claim-candidate sentences across the cluster, grouped by
    // similarity so the same underlying claim in five posts becomes ONE
    // claim with five evidence rows.
    type Candidate = {
      sentence: string;
      item: ExtractedItem;
      shingleSet: Set<string>;
    };
    const candidates: Candidate[] = [];
    for (const tempId of cluster.memberTempIds) {
      const item = byId.get(tempId);
      if (!item) continue;
      for (const { sentence } of splitSentences(item.originalText)) {
        if (isClaimSentence(sentence)) {
          candidates.push({ sentence, item, shingleSet: shingles(sentence, 3) });
        }
      }
      if (item.quotedText && isClaimSentence(item.quotedText)) {
        candidates.push({
          sentence: item.quotedText,
          item,
          shingleSet: shingles(item.quotedText, 3),
        });
      }
    }

    const groups: Candidate[][] = [];
    for (const cand of candidates) {
      let placed = false;
      for (const group of groups) {
        if (jaccard(cand.shingleSet, group[0].shingleSet) >= 0.45) {
          group.push(cand);
          placed = true;
          break;
        }
      }
      if (!placed) groups.push([cand]);
    }

    for (const group of groups) {
      claimCounter += 1;
      // Representative: the longest phrasing (most information preserved).
      const rep = group.reduce((best, cur) =>
        cur.sentence.length > best.sentence.length ? cur : best,
      );
      const evidence: ClaimDraft["evidence"] = [];
      const seenOrigins: { author?: string; platform: string; sh: Set<string> }[] = [];
      let articleSources = 0;
      for (const cand of group) {
        const originAuthor = cand.item.authorName?.toLowerCase();
        const isTextCopy = seenOrigins.some((o) => jaccard(o.sh, cand.shingleSet) >= 0.7);
        const sameOriginSeen = seenOrigins.some(
          (o) => o.author && originAuthor && o.author === originAuthor,
        );
        const independent = seenOrigins.length === 0 ? true : !isTextCopy && !sameOriginSeen;
        if (independent && ARTICLE_TYPES.has(cand.item.itemType)) articleSources += 1;
        seenOrigins.push({ author: originAuthor, platform: cand.item.platform, sh: cand.shingleSet });
        // locate exact raw offsets when the sentence survives cleaning verbatim
        const rel = cand.item.originalText.replace(/\s+/g, " ").indexOf(cand.sentence);
        evidence.push({
          itemTempId: cand.item.tempId,
          excerpt: cand.sentence,
          kind: CONTRADICTION_MARKERS.test(cand.sentence) ? "contradicting" : "supporting",
          independent,
          excerptStartOffset: rel >= 0 ? cand.item.rawStartOffset : undefined,
          excerptEndOffset: rel >= 0 ? cand.item.rawEndOffset : undefined,
        });
      }

      const hasContradiction = evidence.some((e) => e.kind === "contradicting");
      // Self-sourced: the claim names the organisation whose own account or
      // named officer is making it. That is an official statement (primary
      // source for "the company says X"), not an unverified social rumour.
      const selfSourced = group.some((cand) => {
        // a venue's own API is the primary source for its own listings
        if (cand.item.itemType === "market_listing") return true;
        const orgTokens = extractOrgTokens(
          cand.item.authorName,
          cand.item.authorMeta,
          cand.item.sourceUrl,
          cand.item.itemType === "company_announcement",
        );
        return orgTokens.some((tok) => new RegExp(`\\b${tok}\\b`, "i").test(cand.sentence));
      });
      let status: string;
      if (hasContradiction) status = "disputed";
      else if (articleSources >= 2) status = "corroborated";
      else if (selfSourced) status = "primary_source_found";
      else if (articleSources === 1) status = "reported";
      else status = "social_claim_only";

      const itemMentions = mentionsByItem.get(rep.item.tempId) ?? [];
      const subject = itemMentions.find(
        (m) => m.role === "mentioned" && rep.sentence.toLowerCase().includes(m.canonicalName.toLowerCase()),
      );
      const claimant = itemMentions.find((m) => m.role === "author");

      const confidence =
        status === "corroborated"
          ? 0.8
          : status === "primary_source_found"
            ? 0.7
            : status === "reported"
              ? 0.6
              : status === "disputed"
                ? 0.3
                : 0.4;

      claims.push({
        tempId: `claim-${claimCounter}`,
        claimText: rep.sentence,
        claimantEntityKey: claimant?.entityKey,
        subjectEntityKey: subject?.entityKey,
        status,
        confidence,
        publicationRisk: publicationRiskFor(rep.sentence, status),
        permissionLevel: defaultPermission,
        clusterKey: cluster.key,
        evidence,
      });
    }
  }
  return claims;
}
