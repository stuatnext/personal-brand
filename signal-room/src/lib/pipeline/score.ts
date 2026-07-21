import type { ClaimDraft, ClusterDraft, EntityMentionDraft, ExtractedItem, ScoreBreakdown } from "./types";
import { engagementTotal } from "./cluster";
import { promoScore, looksLikeProfitBrag } from "./noise";
import { prospectFlags } from "./entities";
import { pillarConfig, type PillarConfig } from "@/lib/pillars";

// Component scoring: every dimension is 0..100 with a stated reason, and the
// overall number is a visible weighted blend — never one unexplained score.

export const DEFAULT_WEIGHTS: Record<string, number> = {
  newness: 1.2,
  stuart_edge: 1.6,
  conversation_heat: 0.8,
  saturation: 1.0, // inverted: high saturation lowers overall
  credibility_risk: 1.1, // inverted
  relationship_value: 0.9,
  commercial_value: 0.9,
  shelf_life: 0.4,
  urgency: 0.7,
  originality: 1.2,
  evidence_quality: 1.0,
  nextpredict_relevance: 1.0,
  theme_relevance: 0.8,
};

const INVERTED = new Set(["saturation", "credibility_risk"]);

// Edge topics and relevance terms come from the ingestion's pillar
// (src/lib/pillars.ts); the engine itself is pillar-agnostic.

const RECENCY_STRONG = /\b(breaking|just (?:announced|launched|filed)|minutes? ago|hours? ago|today|this morning)\b/i;

export interface ClusterFeatures {
  cluster: ClusterDraft;
  members: ExtractedItem[];
  primary: ExtractedItem;
  claims: ClaimDraft[];
  mentions: EntityMentionDraft[];
  duplicateCount: number;
  edgeTopics: string[];
  totalEngagement: number;
  promo: number;
  allText: string;
  /** dedupe hashes already seen in previous ingestions */
  previouslySeen: boolean;
  currentThemes: string[];
  /** true when the cluster's evidence carries a non-publishable permission level */
  restricted: boolean;
  /** generic crypto/markets content with no real prediction-market substance */
  offTopic: boolean;
  /** digest/roundup/podcast-promo formats: source material, not a story */
  aggregation: boolean;
  /** cross-day continuity facts when this cluster joined a story thread */
  thread?: import("./threads").ThreadInfo;
  /** lowercased canonical name -> engagement strength, from the relationship graph */
  knownEngagement?: Map<string, number>;
  /** the authority pillar this ingestion was dropped into */
  pillar: PillarConfig;
}

/** Multi-story digests and episode promos are mined for what they contain,
 *  not commented on as stories in their own right. */
export function isAggregation(text: string): boolean {
  if (/\bthis week in\b|\bweekly (?:round-?up|recap|digest)\b/i.test(text)) return true;
  if ((text.match(/link to article/gi) || []).length >= 3) return true;
  if (/\bon the latest [^.\n]{0,60}podcast\b|\bin this episode\b|\btune in\b/i.test(text)) return true;
  return false;
}

/** Content with no substance on the drop's pillar. Crypto price roundups
 *  and generic finance noise pattern-match Stuart's feed whatever the
 *  pillar; they only survive when the pillar's own terms carry the text. */
export function isOffTopic(allText: string, pillar: PillarConfig = pillarConfig()): boolean {
  const hits = (allText.match(new RegExp(pillar.relevanceTerms.source, "gi")) || []).length;
  const cryptoPrice =
    /\b(bitcoin|btc|eth|ethereum|solana|xrp)\b[\s\S]{0,60}?(price|target|etf|inflows?|rally|breakout|\$\d)/i.test(
      allText,
    );
  const genericFinance = /\b(nifty|sensex|stock tips|real estate|functional safety|domain for sale)\b/i.test(allText);
  return (cryptoPrice && hits <= 1) || (genericFinance && hits <= 1) || hits === 0;
}

export function collectFeatures(
  cluster: ClusterDraft,
  items: Map<string, ExtractedItem>,
  claims: ClaimDraft[],
  mentions: EntityMentionDraft[],
  previouslySeen: boolean,
  currentThemes: string[],
  restricted = false,
  thread?: import("./threads").ThreadInfo,
  knownEngagement?: Map<string, number>,
  pillar: PillarConfig = pillarConfig(),
): ClusterFeatures {
  const members = cluster.memberTempIds.map((id) => items.get(id)!).filter(Boolean);
  const primary = items.get(cluster.primaryTempId)!;
  const allText = members.map((m) => m.originalText + " " + (m.quotedText ?? "")).join("\n");
  const edgeTopics = pillar.edgeTopics.filter((t) => t.pattern.test(allText)).map((t) => t.label);
  const duplicateCount = [...cluster.roles.values()].filter((r) => r === "duplicate").length;
  return {
    cluster,
    members,
    primary,
    claims: claims.filter((c) => c.clusterKey === cluster.key),
    mentions: mentions.filter((m) => cluster.memberTempIds.includes(m.itemTempId)),
    duplicateCount,
    edgeTopics,
    totalEngagement: members.reduce((s, m) => s + engagementTotal(m), 0),
    promo: Math.max(...members.map((m) => promoScore(m.originalText)), 0),
    allText,
    previouslySeen,
    currentThemes,
    restricted,
    offTopic: isOffTopic(allText, pillar),
    aggregation: isAggregation(allText),
    thread,
    knownEngagement,
    pillar,
  };
}

const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)));

export function scoreCluster(f: ClusterFeatures): ScoreBreakdown[] {
  const s: ScoreBreakdown[] = [];
  const push = (dimension: string, score: number, reason: string) =>
    s.push({ dimension, score: clamp(score), reason });

  // newness: a continuing story is judged by its DEVELOPMENT, not its topic.
  if (f.thread && f.thread.observationCount > 1) {
    const day = f.thread.observationCount;
    const lastSeen = f.thread.lastSeenBefore?.toISOString().slice(0, 10) ?? "earlier";
    if (f.thread.newClaimCount > 0) {
      push(
        "newness",
        Math.min(88, 52 + f.thread.newClaimCount * 9),
        `observation ${day} of a continuing story: ${f.thread.newClaimCount} new claim(s) since ${lastSeen}`,
      );
    } else {
      push(
        "newness",
        12,
        `continuing story with no new development since ${lastSeen}; it is repeating, not moving`,
      );
    }
  } else {
    let newness = 50;
    const newnessReasons: string[] = [];
    if (RECENCY_STRONG.test(f.allText)) {
      newness += 25;
      newnessReasons.push("recency language in the source items");
    }
    if (f.previouslySeen) {
      newness -= 45;
      newnessReasons.push("substantially seen in a previous ingestion");
    }
    if (/\bfirst\b|\bnever (?:before|previously)\b|\bworld first\b/i.test(f.allText)) {
      newness += 10;
      newnessReasons.push("claimed first-of-kind");
    }
    push("newness", newness, newnessReasons.join("; ") || "no strong recency markers either way");
  }

  // stuart_edge
  const edge = f.edgeTopics.length;
  push(
    "stuart_edge",
    f.aggregation ? Math.min(30, 15 + edge * 4) : edge === 0 ? 15 : 35 + edge * 12,
    f.aggregation
      ? "aggregated digest/promo format; the stories inside it are the signal, not the post"
      : edge
        ? `touches Stuart's lanes: ${f.edgeTopics.slice(0, 4).join(", ")}`
        : "no obvious market-architecture angle for Stuart",
  );

  // conversation_heat
  const heat = f.totalEngagement;
  push(
    "conversation_heat",
    heat > 2000 ? 90 : heat > 500 ? 75 : heat > 100 ? 60 : heat > 20 ? 45 : f.members.length > 2 ? 40 : 25,
    `${f.members.length} item(s), ~${heat} engagement units captured`,
  );

  // saturation (high = crowded, will be inverted in the overall)
  const dupRatio = f.members.length > 0 ? f.duplicateCount / f.members.length : 0;
  const mainstream = /\b(bloomberg|reuters|wsj|wall street journal|financial times|cnbc|new york times)\b/i.test(
    f.allText,
  );
  push(
    "saturation",
    clamp(dupRatio * 80 + (mainstream ? 30 : 0) + (f.members.length > 6 ? 20 : 0)),
    `${f.duplicateCount} duplicate/repeat item(s)${mainstream ? "; already in mainstream financial press" : ""}`,
  );

  // credibility_risk (inverted later)
  const unverified = f.claims.filter((c) => c.status === "social_claim_only").length;
  const disputed = f.claims.filter((c) => c.status === "disputed").length;
  const brag = f.members.some((m) => looksLikeProfitBrag(m.originalText));
  // superlative liquidity/market claims with no verification are the classic
  // trap: "deepest book", "most liquid venue", "free money"
  const superlative =
    unverified > 0 &&
    /\b(most liquid|deepest (?:book|market)|insane (?:depth|liquidity|volume)|free money|guaranteed|zero (?:spread|fees) )/i.test(
      f.allText,
    );
  push(
    "credibility_risk",
    clamp(unverified * 14 + disputed * 30 + f.promo * 40 + (brag ? 25 : 0) + (superlative ? 45 : 0)),
    [
      unverified ? `${unverified} unverified social claim(s)` : "",
      disputed ? `${disputed} disputed claim(s)` : "",
      f.promo > 0.3 ? "promotional markers present" : "",
      brag ? "profit-screenshot pattern" : "",
      superlative ? "unverified superlative liquidity/market claims" : "",
    ]
      .filter(Boolean)
      .join("; ") || "no specific credibility flags",
  );

  // relationship_value: flagged people weigh more than flagged companies
  const prospectMentions = f.mentions.filter((m) => {
    const flags = prospectFlags(m.entityKey);
    return flags?.prospectType || flags?.seniority === "exec";
  });
  const personProspects = prospectMentions.filter((m) => m.kind === "person");
  const otherProspects = prospectMentions.filter((m) => m.kind !== "person");
  const seniorAuthor = f.members.some((m) =>
    /\b(CEO|founder|co-founder|chief|president|head of|managing director|general counsel|partner)\b/i.test(
      m.authorMeta ?? "",
    ),
  );
  // graph feedback: people Stuart has engaged with before are worth more
  // when they reappear
  const engagedNames = f.knownEngagement
    ? [
        ...new Set(
          f.mentions
            .filter((m) => f.knownEngagement!.has(m.canonicalName.toLowerCase()))
            .map((m) => m.canonicalName),
        ),
      ]
    : [];
  push(
    "relationship_value",
    clamp(
      personProspects.length * 25 +
        otherProspects.length * 12 +
        (seniorAuthor ? 30 : 0) +
        Math.min(25, engagedNames.length * 15),
    ),
    [
      prospectMentions.length
        ? `involves ${[...new Set(prospectMentions.map((m) => m.canonicalName))].slice(0, 3).join(", ")}`
        : "",
      seniorAuthor ? "senior author in the thread" : "",
      engagedNames.length ? `Stuart has engaged with ${engagedNames.slice(0, 2).join(", ")} before` : "",
    ]
      .filter(Boolean)
      .join("; ") || "no notable people or prospects identified",
  );

  // commercial_value
  const commercialSignals: string[] = [];
  if (/\b(launch\w*|enter\w* the|expand\w* into|roll\w* out)\b/i.test(f.allText)) commercialSignals.push("category entry/launch");
  if (/\bhir\w+|recruit\w+|joins? as|appoint\w+|head of\b/i.test(f.allText)) commercialSignals.push("hiring");
  if (/\b(partnership|integration|white.?label|API)\b/i.test(f.allText)) commercialSignals.push("infrastructure/partnership");
  if (/\b(sponsor\w+|advertis\w+|brand)\b/i.test(f.allText)) commercialSignals.push("brand spend");
  if (/\b(raise[sd]?|funding|series [a-e]|seed round|valuation)\b/i.test(f.allText)) commercialSignals.push("funding");
  push(
    "commercial_value",
    clamp(commercialSignals.length * 22 + (f.edgeTopics.includes("institutional adoption") ? 15 : 0)),
    commercialSignals.length ? `signals: ${commercialSignals.join(", ")}` : "no direct commercial signal",
  );

  // shelf_life
  const evergreen = f.edgeTopics.some((t) =>
    ["market structure", "compliance and surveillance", "infrastructure", "category perception"].includes(t),
  );
  push(
    "shelf_life",
    evergreen ? 70 : RECENCY_STRONG.test(f.allText) ? 25 : 45,
    evergreen ? "structural theme, keeps for days" : "news-cycle bound",
  );

  // urgency
  push(
    "urgency",
    clamp((RECENCY_STRONG.test(f.allText) ? 45 : 20) + (heat > 500 ? 30 : heat > 100 ? 18 : 0)),
    RECENCY_STRONG.test(f.allText) ? "moving now" : "not time-critical",
  );

  // originality: quiet signals beat crowded takes
  const quiet = f.members.length <= 3 && !/\b(bloomberg|reuters|wsj)\b/i.test(f.allText);
  const contradiction = f.claims.some((c) => c.status === "disputed") ||
    /\bbut|yet|meanwhile|however\b/i.test(f.primary.originalText);
  push(
    "originality",
    f.aggregation ? 12 : clamp((quiet ? 35 : 10) + (contradiction ? 25 : 0) + f.edgeTopics.length * 6),
    f.aggregation
      ? "aggregation of other people's stories; nothing original to add by engaging with it"
      : [
          quiet ? "quiet signal, not yet crowded" : "already widely discussed",
          contradiction ? "contains a usable tension/contradiction" : "",
        ]
          .filter(Boolean)
          .join("; "),
  );

  // evidence_quality
  const claimStatuses = f.claims.map((c) => c.status);
  const good = claimStatuses.filter((c) => c === "corroborated" || c === "reported").length;
  push(
    "evidence_quality",
    f.claims.length === 0 ? 40 : clamp(20 + (good / f.claims.length) * 70),
    f.claims.length === 0
      ? "no extractable factual claims (opinion/colour)"
      : `${good}/${f.claims.length} claims reported or corroborated`,
  );

  // Pillar relevance (stored under the historical key nextpredict_relevance
  // so learned weights and score history stay valid): the pillar must be the
  // SUBJECT, not a passing mention. Position of the first hit separates the
  // two.
  const termRegex = new RegExp(f.pillar.relevanceTerms.source, "gi");
  const termHits = (f.allText.match(termRegex) || []).length;
  const primaryText = f.primary.originalText + " " + (f.primary.quotedText ?? "");
  const firstHit = primaryText.search(new RegExp(f.pillar.relevanceTerms.source, "i"));
  // Subject-level means the pillar appears in the opening (title/first
  // sentences), not somewhere deep inside an essay about something else.
  const subjectLevel = firstHit >= 0 && firstHit < 280;
  const passingMention = termHits <= 2 && !subjectLevel;
  push(
    "nextpredict_relevance",
    f.offTopic
      ? Math.min(15, termHits * 5)
      : passingMention
        ? Math.min(22, termHits * 10)
        : clamp(termHits * 12 + (subjectLevel ? 25 : 0) + (f.edgeTopics.length > 0 ? 15 : 0)),
    f.offTopic
      ? `generic content outside the ${f.pillar.label} lane`
      : passingMention
        ? `${f.pillar.label} is a passing mention here, not the subject`
        : termHits
          ? `${termHits} ${f.pillar.termNoun} term hit(s)${subjectLevel ? "; the pillar is the subject from the opening" : ""}`
          : "peripheral to the pillar",
  );

  // theme_relevance
  const themeHits = f.currentThemes.filter((t) => f.allText.toLowerCase().includes(t.toLowerCase()));
  push(
    "theme_relevance",
    themeHits.length ? clamp(45 + themeHits.length * 20) : 35,
    themeHits.length ? `matches current themes: ${themeHits.join(", ")}` : "no configured theme match",
  );

  return s;
}

export function overallScore(breakdown: ScoreBreakdown[], weights = DEFAULT_WEIGHTS): number {
  let total = 0;
  let weightSum = 0;
  for (const b of breakdown) {
    const w = weights[b.dimension] ?? 1;
    const value = INVERTED.has(b.dimension) ? 100 - b.score : b.score;
    total += value * w;
    weightSum += w;
  }
  return weightSum ? Math.round((total / weightSum) * 10) / 10 : 0;
}
