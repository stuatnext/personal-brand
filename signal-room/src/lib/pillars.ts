import { DEFAULT_PILLAR, PILLARS, type Pillar } from "@/lib/db/schema";

// Stuart's three authority pillars as configuration. One judgement engine
// runs everywhere; the pillar supplies the terms, lanes, lead rules, voice
// vocabulary and outreach positioning. Drops are deliberate: the pillar is
// chosen at ingest and carried on the ingestion and its opportunities.
//
// Honesty rules baked in here:
//  - Stuart-global voice rules (no em dashes, banned phrases, negative
//    parallelism) are NOT per-pillar; they live in the linter for all copy.
//  - Betting/gambling/sportsbook/casino vocabulary is banned only in
//    NEXTPredict (prediction markets) copy; it is normal vocabulary for the
//    iGaming pillar (mirrors lib/voice.mjs in the parent engine).
//  - Sign-off titles are facts. Only the NEXTPredict title is confirmed
//    ("Commercial Director, NEXTPredict"); other pillars carry a bracketed
//    [YOUR TITLE] slot rather than an invented one.

export interface EdgeTopic {
  pattern: RegExp;
  label: string;
}

export interface PillarConfig {
  key: Pillar;
  label: string;
  /** the brand voice this pillar writes under */
  brand: string;
  /** subject-level relevance: what makes content ON this pillar */
  relevanceTerms: RegExp;
  /** what the relevance dimension calls a hit in its reason strings */
  termNoun: string;
  /** lanes where Stuart has a real angle (feeds stuart_edge) */
  edgeTopics: EdgeTopic[];
  /** commercial category-entry language for sponsor-style leads */
  categoryEntryTerms: RegExp;
  /** consulting-style lead signals (sales_handoff), where they apply */
  consultingLeadTerms: RegExp | null;
  /** vocabulary banned in this brand's outreach copy (on top of the
   *  Stuart-global off-voice list) */
  outreachVocabularyBans: { phrase: string; message: string }[];
  /** the one-line "what Stuart is building/doing" for dm/email skeletons.
   *  Facts only; anything unconfirmed stays a bracketed slot. */
  outreachPositioningLine: string;
  /** sign-off lines after "All the best," / "Stuart" / blank */
  signoffLines: string[];
  /** how the angle text frames Stuart's seat at the table */
  angleFrame: string;
}

const PREDICTION_MARKETS: PillarConfig = {
  key: "prediction_markets",
  label: "Prediction markets",
  brand: "NEXTPredict",
  relevanceTerms:
    /\b(prediction markets?|event contracts?|kalshi|polymarket|forecastex|binary options?|forecasting|probability market|contract market)\b/i,
  termNoun: "prediction-market",
  edgeTopics: [
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
  ],
  categoryEntryTerms:
    /\b(launch\w*|enter\w* the|expand\w* into|list\w* (?:event|prediction)|(?:exclusive|global|strategic) partnership|partner\w* (?:with|to build))\b/i,
  consultingLeadTerms: null,
  outreachVocabularyBans: [
    { phrase: "betting", message: "category vocabulary: never betting/gambling in NEXTPredict copy" },
    { phrase: "gambling", message: "category vocabulary: never betting/gambling in NEXTPredict copy" },
    { phrase: "sportsbook", message: "category vocabulary: banned in NEXTPredict copy" },
    { phrase: "wagering", message: "category vocabulary: banned in NEXTPredict copy" },
    { phrase: "casino", message: "category vocabulary: banned in NEXTPredict copy" },
  ],
  outreachPositioningLine:
    "I'm building NEXTPredict around the serious operating layer of the category, and I'm still learning my way into parts of it.",
  signoffLines: ["Stuart Crowley", "Commercial Director, NEXTPredict"],
  angleFrame: "he can read the commercial mechanics rather than repeat the headline",
};

const IGAMING: PillarConfig = {
  key: "igaming",
  label: "iGaming & sports betting",
  brand: "NEXT.io",
  relevanceTerms:
    /\b(igaming|i-gaming|sports? betting|sportsbook|casino|gambling|bookmaker|betting operator|game studio|slot studio|odds (?:provider|feed)|UKGC|gambling commission|malta gaming|MGA\b|responsible gambling|safer gambling|wagering|affiliate (?:marketing|program|deal)s?|player acquisition)\b/i,
  termNoun: "iGaming",
  edgeTopics: [
    { pattern: /\bregulat\w+|licen[cs]\w+|UKGC|MGA\b|gambling commission|compliance|AML|responsible gambling|safer gambling\b/i, label: "regulation and licensing" },
    { pattern: /\bM&A|acquisition|merger|consolidat\w+|take-?over|buyout\b/i, label: "consolidation" },
    { pattern: /\bpayments?|PSP|fraud|chargebacks?|KYC\b/i, label: "payments and fraud" },
    { pattern: /\baffiliates?|acquisition cost|CPA|revenue share|SEO|traffic\b/i, label: "affiliates and acquisition" },
    { pattern: /\bgame studio|slots?|live casino|RGS|aggregat\w+|content deal\b/i, label: "content and studios" },
    { pattern: /\bodds|trading|risk management|in-play|pricing\b/i, label: "trading and risk" },
    { pattern: /\bhir\w+|recruit\w+|head of|joins? as|appoint\w+\b/i, label: "talent" },
    { pattern: /\bmedia|journalis\w+|coverage|conference|summit|expo\b/i, label: "media and events" },
    { pattern: /\bsponsor\w+|advertis\w+|brand deal|shirt deal\b/i, label: "sponsorship" },
    { pattern: /\bBrazil|LatAm|Africa|US states?|New Jersey|Ontario|market entry|regulated market\b/i, label: "market entry" },
  ],
  categoryEntryTerms:
    /\b(launch\w*|enter\w* (?:the )?\w{0,12} ?market|expand\w* into|go(?:es|ing)? live|(?:exclusive|global|strategic) partnership|content deal|licen[cs]e (?:granted|secured|awarded))\b/i,
  consultingLeadTerms: null,
  outreachVocabularyBans: [],
  outreachPositioningLine:
    "I'm at NEXT.io, working across the iGaming industry, and I'm always trying to sharpen how I read this market.",
  signoffLines: ["Stuart Crowley", "[YOUR TITLE], NEXT.io"],
  angleFrame: "he reads it from inside the industry, not from the press release",
};

const STRAIT_UP_GROWTH: PillarConfig = {
  key: "strait_up_growth",
  label: "Strait Up Growth",
  brand: "Strait Up Growth",
  relevanceTerms:
    /\b(AI adoption|generative AI|gen ?AI|LLMs?|agentic|automation|CRM|RevOps|HubSpot|Salesforce|go-to-market|GTM|marketing strateg\w+|commercial strateg\w+|operational efficiency|op(?:s|erations) transformation|Southeast Asia|South-?east Asia|Singapore|Indonesia|Vietnam|Philippines|Malaysia|Thailand|APAC|SEA (?:expansion|market|growth))\b/,
  termNoun: "AI/commercial-strategy",
  edgeTopics: [
    { pattern: /\bAI adoption|generative AI|gen ?AI|LLMs?|agentic|copilot|automation\b/i, label: "AI adoption" },
    { pattern: /\bCRM|RevOps|HubSpot|Salesforce|pipeline hygiene|data quality\b/i, label: "CRM and RevOps" },
    { pattern: /\bgo-to-market|GTM|positioning|ICP|segmentation|pricing|packaging\b/i, label: "go-to-market" },
    { pattern: /\bmarketing strateg\w+|brand|demand gen\w*|content strateg\w+|performance marketing\b/i, label: "marketing strategy" },
    { pattern: /\boperational efficiency|process|headcount|cost base|margin|productivity\b/i, label: "operational efficiency" },
    { pattern: /\bSingapore|Southeast Asia|South-?east Asia|Indonesia|Vietnam|Philippines|Malaysia|Thailand|APAC\b/i, label: "Singapore and SEA" },
    { pattern: /\bhir\w+|recruit\w+|head of|joins? as|appoint\w+|talent\b/i, label: "talent" },
    { pattern: /\braise[sd]?|funding|series [a-e]|expansion|new office|market entry\b/i, label: "expansion and funding" },
  ],
  categoryEntryTerms:
    /\b(launch\w*|expand\w* into|open\w* (?:an? )?(?:office|hub)|enter\w* (?:the )?\w{0,12} ?market|(?:exclusive|strategic) partnership)\b/i,
  // The consulting-lead signals mirror the parent engine's LEAD_SIGNALS:
  // buying signal + entity in the same drop.
  consultingLeadTerms:
    /\b(SEA expansion|expand\w* into (?:Southeast Asia|South-?east Asia|Singapore|Indonesia|Vietnam|APAC)|CRM (?:mess|pain|overhaul|migration|cleanup)|RevOps (?:gap|debt|overhaul)|raise[sd]? (?:a )?series [a-e]|new (?:CMO|CRO|CCO|head of (?:marketing|growth|revenue))|looking for (?:an? )?(?:agency|consultant|partner)|struggl\w+ with (?:attribution|pipeline|adoption))\b/i,
  outreachVocabularyBans: [],
  outreachPositioningLine:
    "I run Strait Up Growth, a consultancy focused on AI, commercial and marketing strategy in Singapore and SEA, and I'm always keen to hear how operators are actually seeing this.",
  signoffLines: ["Stuart Crowley", "[YOUR TITLE], Strait Up Growth"],
  angleFrame: "he advises operators on exactly this, so he can be specific where others stay general",
};

const CONFIGS: Record<Pillar, PillarConfig> = {
  prediction_markets: PREDICTION_MARKETS,
  igaming: IGAMING,
  strait_up_growth: STRAIT_UP_GROWTH,
};

export function pillarConfig(pillar?: string | null): PillarConfig {
  return CONFIGS[(pillar ?? DEFAULT_PILLAR) as Pillar] ?? CONFIGS[DEFAULT_PILLAR];
}

export function isPillar(value: string): value is Pillar {
  return (PILLARS as readonly string[]).includes(value);
}

export const PILLAR_OPTIONS = PILLARS.map((key) => ({ key, label: CONFIGS[key].label }));
