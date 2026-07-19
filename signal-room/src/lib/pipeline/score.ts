import type { ClaimDraft, ClusterDraft, EntityMentionDraft, ExtractedItem, ScoreBreakdown } from "./types";
import { engagementTotal } from "./cluster";
import { promoScore, looksLikeProfitBrag } from "./noise";
import { prospectFlags } from "./entities";

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

/** Themes where Stuart genuinely has an angle (market architecture, not hype). */
const EDGE_TOPICS: { pattern: RegExp; label: string }[] = [
  { pattern: /\bregulat\w+|CFTC|SEC|FINRA|licen[cs]\w+|no-action|DCM\b/i, label: "regulation" },
  { pattern: /\bmarket structure|microstructure|order book|matching engine|clearing\b/i, label: "market structure" },
  { pattern: /\bdistribution|broker|brokerage|app store|super.?app|white.?label\b/i, label: "distribution" },
  { pattern: /\bliquidity|market mak\w+|spread|depth|open interest|volume\b/i, label: "liquidity" },
  { pattern: /\bfees?|take rate|rebate|pricing\b/i, label: "fees" },
  { pattern: /\bexecution|slippage|settlement|resolution|oracle\b/i, label: "execution and settlement" },
  { pattern: /\bcomplian\w+|surveillance|KYC|AML|MNPI|insider\b/i, label: "compliance and surveillance" },
  { pattern: /\bhir\w+|recruit\w+|head of|joins? as|talent|appoint\w+\b/i, label: "talent" },
  { pattern: /\binfrastructure|custody|API|data feed|market data\b/i, label: "infrastructure" },
  { pattern: /\bmedia|journalis\w+|coverage|documentary|newsletter\b/i, label: "media" },
  { pattern: /\bbrand risk|reputation\w*|advertis\w+|sponsor\w+\b/i, label: "brand risk" },
  { pattern: /\bperception|mainstream|normali[sz]\w+|vanity fair|60 minutes\b/i, label: "category perception" },
  { pattern: /\binstitution\w+|bank|hedge fund|asset manager|goldman|jpmorgan\b/i, label: "institutional adoption" },
];

const PM_TERMS =
  /\b(prediction markets?|event contracts?|kalshi|polymarket|forecastex|binary options?|forecasting|probability market|contract market)\b/i;

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
}

/** Multi-story digests and episode promos are mined for what they contain,
 *  not commented on as stories in their own right. */
export function isAggregation(text: string): boolean {
  if (/\bthis week in\b|\bweekly (?:round-?up|recap|digest)\b/i.test(text)) return true;
  if ((text.match(/link to article/gi) || []).length >= 3) return true;
  if (/\bon the latest [^.\n]{0,60}podcast\b|\bin this episode\b|\btune in\b/i.test(text)) return true;
  return false;
}

/** Crypto price roundups and generic markets content pattern-match Stuart's
 *  feed but are not category signal. */
export function isOffTopic(allText: string): boolean {
  const pmHits = (allText.match(new RegExp(PM_TERMS.source, "gi")) || []).length;
  const cryptoPrice =
    /\b(bitcoin|btc|eth|ethereum|solana|xrp)\b[\s\S]{0,60}?(price|target|etf|inflows?|rally|breakout|\$\d)/i.test(
      allText,
    );
  const genericFinance = /\b(nifty|sensex|stock tips|real estate|functional safety|domain for sale)\b/i.test(allText);
  return (cryptoPrice && pmHits <= 1) || (genericFinance && pmHits <= 1) || pmHits === 0;
}

export function collectFeatures(
  cluster: ClusterDraft,
  items: Map<string, ExtractedItem>,
  claims: ClaimDraft[],
  mentions: EntityMentionDraft[],
  previouslySeen: boolean,
  currentThemes: string[],
  restricted = false,
): ClusterFeatures {
  const members = cluster.memberTempIds.map((id) => items.get(id)!).filter(Boolean);
  const primary = items.get(cluster.primaryTempId)!;
  const allText = members.map((m) => m.originalText + " " + (m.quotedText ?? "")).join("\n");
  const edgeTopics = EDGE_TOPICS.filter((t) => t.pattern.test(allText)).map((t) => t.label);
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
    offTopic: isOffTopic(allText),
    aggregation: isAggregation(allText),
  };
}

const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)));

export function scoreCluster(f: ClusterFeatures): ScoreBreakdown[] {
  const s: ScoreBreakdown[] = [];
  const push = (dimension: string, score: number, reason: string) =>
    s.push({ dimension, score: clamp(score), reason });

  // newness
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
  push(
    "relationship_value",
    clamp(personProspects.length * 25 + otherProspects.length * 12 + (seniorAuthor ? 30 : 0)),
    [
      prospectMentions.length
        ? `involves ${[...new Set(prospectMentions.map((m) => m.canonicalName))].slice(0, 3).join(", ")}`
        : "",
      seniorAuthor ? "senior author in the thread" : "",
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

  // nextpredict_relevance: the category must be the SUBJECT, not a passing
  // mention. Position of the first hit separates the two.
  const pmRegex = new RegExp(PM_TERMS.source, "gi");
  const pmHits = (f.allText.match(pmRegex) || []).length;
  const primaryText = f.primary.originalText + " " + (f.primary.quotedText ?? "");
  const firstHit = primaryText.search(new RegExp(PM_TERMS.source, "i"));
  // Subject-level means the category appears in the opening (title/first
  // sentences), not somewhere deep inside an essay about something else.
  const subjectLevel = firstHit >= 0 && firstHit < 280;
  const passingMention = pmHits <= 2 && !subjectLevel;
  push(
    "nextpredict_relevance",
    f.offTopic
      ? Math.min(15, pmHits * 5)
      : passingMention
        ? Math.min(22, pmHits * 10)
        : clamp(pmHits * 12 + (subjectLevel ? 25 : 0) + (f.edgeTopics.length > 0 ? 15 : 0)),
    f.offTopic
      ? "generic crypto/markets content wearing category vocabulary"
      : passingMention
        ? "prediction markets are a passing mention here, not the subject"
        : pmHits
          ? `${pmHits} prediction-market term hit(s)${subjectLevel ? "; category is the subject from the opening" : ""}`
          : "peripheral to the category",
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
