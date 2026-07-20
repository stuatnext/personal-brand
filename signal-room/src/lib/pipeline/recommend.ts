import type { ClaimDraft, OpportunityDraft, ScoreBreakdown } from "./types";
import type { ClusterFeatures } from "./score";
import { scoreCluster, overallScore, DEFAULT_WEIGHTS } from "./score";
import { prospectFlags } from "./entities";

// The editorial layer: decide whether Stuart should act at all, pick ONE
// primary action, and explain why — grounded only in extracted evidence.
// Selectivity is the point: prefer no action over weak content.

const dim = (scores: ScoreBreakdown[], name: string) => scores.find((s) => s.dimension === name)?.score ?? 0;

interface ActionChoice {
  action: string;
  why: string;
  rejected: { action: string; whyNot: string }[];
}

function chooseAction(f: ClusterFeatures, scores: ScoreBreakdown[]): ActionChoice {
  const edge = dim(scores, "stuart_edge");
  const heat = dim(scores, "conversation_heat");
  const saturation = dim(scores, "saturation");
  const credRisk = dim(scores, "credibility_risk");
  const evidence = dim(scores, "evidence_quality");
  const commercial = dim(scores, "commercial_value");
  const relationship = dim(scores, "relationship_value");

  const hiring = /\bhir\w+|recruit\w+|joins? as|appoint\w+|head of prediction|head of (?:markets|compliance|trading)\b/i.test(
    f.allText,
  );
  const isJobCluster = f.members.some((m) => m.itemType === "job_listing");
  const promoHeavy = f.promo >= 0.6;
  const primaryIsPerson = Boolean(f.primary.authorName) && f.primary.itemType !== "company_announcement";
  const primaryOnX = f.primary.platform === "x";
  const regulatory = f.edgeTopics.includes("regulation") || f.edgeTopics.includes("compliance and surveillance");

  // Sponsor / speaker / media leads: someone or some company acting inside
  // the category with prospect flags.
  const sponsorMention = f.mentions.find((m) => prospectFlags(m.entityKey)?.prospectType === "sponsor");
  const speakerMention = f.mentions.find(
    (m) => prospectFlags(m.entityKey)?.prospectType === "speaker" && m.role !== "author",
  );
  const mediaMention = f.mentions.find((m) => prospectFlags(m.entityKey)?.prospectType === "media");
  const categoryEntry =
    /\b(launch\w*|enter\w* the|expand\w* into|list\w* (?:event|prediction)|(?:exclusive|global|strategic) partnership|partner\w* (?:with|to build))\b/i.test(
      f.allText,
    );
  const execAuthor = f.members.find((m) =>
    /\b(CEO|chief executive|founder|co-founder|president|chief [a-z]+ officer)\b/i.test(m.authorMeta ?? ""),
  );

  // Private material never routes to public content actions: the evidence
  // cannot be published, so the honest moves are internal.
  if (f.restricted) {
    const sponsorish = /\b(sponsor\w+|partnership|budget|pricing|rate|deal)\b/i.test(f.allText);
    if (sponsorish) {
      return {
        action: "sales_handoff",
        why: "Private conversation with live commercial substance; route it into the pipeline rather than the feed. The material is not publishable, but it sharpens what Stuart asks and offers next.",
        rejected: [
          { action: "linkedin_post", whyNot: "the evidence is private; a public draft cannot use it" },
          { action: "ignore", whyNot: "there is real commercial signal here" },
        ],
      };
    }
    return {
      action: "save",
      why: "Private material: not publishable, but worth keeping close. It gives Stuart questions and context the public conversation does not have.",
      rejected: [
        { action: "linkedin_post", whyNot: "the evidence is private; a public draft cannot use it" },
        { action: "investigate", whyNot: "nothing here needs verifying; it needs remembering" },
      ],
    };
  }

  if (f.offTopic) {
    return {
      action: "ignore",
      why: "Generic content wearing category vocabulary; no prediction-market substance for Stuart to work with.",
      rejected: [
        { action: "comment", whyNot: "engaging drags Stuart's feed further off-lane" },
        { action: "monitor", whyNot: "nothing category-specific to watch" },
      ],
    };
  }

  if (f.aggregation) {
    return {
      action: "save",
      why: "Digest/roundup format: useful as source material, wrong to engage with as a story. The stories inside it surface on their own items where they exist.",
      rejected: [
        { action: "comment", whyNot: "commenting on someone's digest adds nothing of Stuart's" },
        { action: "linkedin_post", whyNot: "a post about a roundup is content about content" },
      ],
    };
  }

  if (promoHeavy) {
    return {
      action: "ignore",
      why: "Reads as promotion/affiliate content; engaging would lend Stuart's credibility to it.",
      rejected: [
        { action: "comment", whyNot: "commenting amplifies promotional material" },
        { action: "quote_post", whyNot: "same amplification problem, in public" },
      ],
    };
  }

  if (isJobCluster || (hiring && commercial >= 40)) {
    return {
      action: "investigate",
      why: "Hiring is one of the most reliable category signals: a role posting is a budget commitment, not an opinion. Worth identifying who is staffing what before anyone writes about it.",
      rejected: [
        { action: "linkedin_post", whyNot: "a post is stronger after the hire/role is verified and patterned against other openings" },
        { action: "ignore", whyNot: "recruitment signals are exactly what the noise crowd misses" },
      ],
    };
  }

  if (speakerMention && (relationship >= 25 || edge >= 40)) {
    return {
      action: "speaker_lead",
      why: `${speakerMention.canonicalName} is active in this story and is a credible voice for the room; a relationship-first approach fits better than public commentary.`,
      rejected: [
        { action: "comment", whyNot: "a public comment spends the moment; a direct conversation compounds it" },
        { action: "dm", whyNot: "route via the NEXTPredict speaker process rather than an ad-hoc DM" },
      ],
    };
  }

  if ((sponsorMention || execAuthor) && categoryEntry && commercial >= 40) {
    const who = sponsorMention?.canonicalName ?? execAuthor?.authorName ?? "the company";
    return {
      action: "sponsor_lead",
      why: `${who} is committing money or product to the category in this story; that is a commercial conversation, not just content.`,
      rejected: [
        { action: "linkedin_post", whyNot: "public commentary can follow, but the commercial follow-up is the scarce move" },
        { action: "ignore", whyNot: "category entries are core sponsor-pipeline signals" },
      ],
    };
  }

  // Regulatory claims demand a primary source before Stuart engages
  // publicly; with weak evidence the move is to verify, not to post.
  if (regulatory && evidence < 50 && dim(scores, "nextpredict_relevance") >= 30) {
    return {
      action: "investigate",
      why: "A regulatory development sourced only from social posts: exactly the kind of claim Stuart never repeats unverified. Check the authority's own record, then decide whether to write.",
      rejected: [
        { action: "linkedin_post", whyNot: "publishing a regulatory claim without a primary source is a credibility bet" },
        { action: "ignore", whyNot: "if it verifies, regulation is one of Stuart's strongest lanes" },
      ],
    };
  }

  // Connector lane: a senior person writing thoughtfully in the category is
  // worth a direct, curiosity-led conversation.
  if (primaryIsPerson && execAuthor?.tempId === f.primary.tempId && relationship >= 30 && edge >= 45) {
    return {
      action: "dm",
      why: `${f.primary.authorName} is a senior operator writing directly about the category; a genuine, curiosity-led note earns more than a public reply.`,
      rejected: [
        { action: "comment", whyNot: "a public comment competes for attention; a direct note starts a relationship" },
        { action: "ignore", whyNot: "senior operators in the category are exactly who Stuart should know" },
      ],
    };
  }

  if (mediaMention && f.edgeTopics.includes("media")) {
    return {
      action: "media_lead",
      why: "Mainstream media attention on the category is itself the story; the journalist behind it is worth knowing before the next cycle.",
      rejected: [{ action: "comment", whyNot: "commenting on coverage is weaker than a relationship with the person writing it" }],
    };
  }

  // Leads are exempt from the verification gate (the conversation is the
  // verification); everything public-facing is not.
  if (credRisk >= 70 && evidence < 40) {
    return {
      action: "investigate",
      why: "The underlying claims are unverified and the credibility risk of engaging publicly is high; verify against a primary source first.",
      rejected: [
        { action: "x_post", whyNot: "posting now would put Stuart's name on an unverified claim" },
        { action: "monitor", whyNot: "the story is live enough that waiting passively loses the window" },
      ],
    };
  }

  if (edge < 35) {
    if (heat >= 60) {
      return {
        action: "monitor",
        why: "It is moving, but Stuart has no distinctive angle here; watching costs nothing, a generic take costs credibility.",
        rejected: [
          { action: "comment", whyNot: "no angle beyond what is already said in the thread" },
          { action: "x_post", whyNot: "would read as generic analyst noise" },
        ],
      };
    }
    return {
      action: "ignore",
      why: "Neither a Stuart angle nor meaningful momentum; attention is better spent elsewhere.",
      rejected: [{ action: "save", whyNot: "nothing here to come back to" }],
    };
  }

  // Genuine editorial territory from here.
  if (regulatory && evidence >= 50 && saturation < 60) {
    return {
      action: "linkedin_post",
      why: "A regulatory/market-structure development with decent sourcing and room before it saturates: exactly the fuller editorial read LinkedIn rewards from Stuart.",
      rejected: [
        { action: "x_post", whyNot: "X suits the fast take; the value here is the commercial interpretation, which needs paragraphs" },
        { action: "comment", whyNot: "no single post to anchor a comment to that outranks writing it properly" },
      ],
    };
  }

  if (primaryIsPerson && heat >= 55 && saturation < 70) {
    if (primaryOnX) {
      return {
        action: "quote_post",
        why: "A single strong post is carrying this conversation on X; quote-posting adds Stuart's commercial read while crediting the source.",
        rejected: [
          { action: "comment", whyNot: "a reply buries the angle under the original's audience" },
          { action: "x_post", whyNot: "an original post without the source loses the context that makes it interesting" },
        ],
      };
    }
    return {
      action: "comment",
      why: "The conversation is already live under a credible author on LinkedIn; a comment that adds the missing commercial angle earns more than a competing post.",
      rejected: [
        { action: "linkedin_post", whyNot: "posting the same story separately splits the conversation Stuart could join" },
        { action: "ignore", whyNot: "there is a real angle and a live thread" },
      ],
    };
  }

  if (saturation >= 70) {
    return {
      action: "save",
      why: "The story is everywhere right now; the better move is the second-wave piece once the first takes age.",
      rejected: [
        { action: "linkedin_post", whyNot: "day-one takes on saturated stories blend into the noise" },
        { action: "ignore", whyNot: "there is a durable angle worth returning to" },
      ],
    };
  }

  if (dim(scores, "urgency") >= 55 && primaryOnX) {
    return {
      action: "x_post",
      why: "Fast-moving and Stuart has the angle: a sharp, precise X post lands while it matters.",
      rejected: [{ action: "linkedin_post", whyNot: "by the time a fuller piece is polished the moment has moved" }],
    };
  }

  return {
    action: "linkedin_post",
    why: "Several signals combine into one thesis Stuart can develop properly; that is a LinkedIn editorial paragraph, not a quick reaction.",
    rejected: [
      { action: "x_post", whyNot: "the value is in the joined-up reading, which needs room" },
      { action: "monitor", whyNot: "enough evidence is already in hand to say something specific" },
    ],
  };
}

// --- Editorial field assembly (deterministic, evidence-grounded) ------------

function hedge(status: string): string {
  switch (status) {
    case "corroborated":
    case "verified":
      return "";
    case "reported":
      return "reported: ";
    case "disputed":
      return "disputed: ";
    default:
      return "according to the post: ";
  }
}

function summariseClaims(claims: ClaimDraft[], statuses: string[], max = 3): string {
  const rows = claims.filter((c) => statuses.includes(c.status)).slice(0, max);
  if (rows.length === 0) return "";
  return rows.map((c) => `${hedge(c.status)}"${truncate(c.claimText, 160)}"`).join(" · ");
}

function truncate(s: string, n: number): string {
  const clean = s.replace(/\s+/g, " ").trim();
  return clean.length > n ? clean.slice(0, n - 1).trimEnd() + "…" : clean;
}

function buildMissing(f: ClusterFeatures): string {
  const gaps: string[] = [];
  if (!f.claims.some((c) => c.status === "corroborated" || c.status === "reported"))
    gaps.push("no primary or press source in the paste, social accounts only");
  if (f.claims.some((c) => /\$|%|\d/.test(c.claimText) && c.status === "social_claim_only"))
    gaps.push("the numbers are uncorroborated");
  if (!f.edgeTopics.includes("liquidity") && /volume|traded/i.test(f.allText))
    gaps.push("volume is cited without fee/liquidity context, the executable reality may differ");
  if (f.members.length === 1) gaps.push("single source item, no second account of the event");
  const discussed = f.edgeTopics;
  if (!discussed.includes("distribution") && !discussed.includes("market structure"))
    gaps.push("nobody in the thread is asking the market-structure question yet");
  return gaps.length ? capitalise(gaps.join("; ") + ".") : "No obvious gap; the discussion covers the essentials.";
}

function capitalise(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function buildAngle(f: ClusterFeatures, privateContextNotes: string[]): string {
  const parts: string[] = [];
  if (f.edgeTopics.length) {
    parts.push(
      `This sits in Stuart's ${f.edgeTopics.slice(0, 3).join(" / ")} lane, where he can read the commercial mechanics rather than repeat the headline.`,
    );
  }
  const senior = f.members.find((m) => /\b(CEO|founder|chief|head of|president)\b/i.test(m.authorMeta ?? ""));
  if (senior?.authorName) {
    parts.push(`The thread already has senior operators in it (${senior.authorName}), so a sharp reply is visible to the right people.`);
  }
  if (privateContextNotes.length) {
    parts.push(...privateContextNotes);
  }
  if (parts.length === 0) {
    return "No distinctive Stuart angle was found in the evidence; treat any draft here with suspicion.";
  }
  return parts.join(" ");
}

function buildJudgementChange(f: ClusterFeatures): string {
  const conditions: string[] = [];
  if (f.claims.some((c) => c.status === "social_claim_only"))
    conditions.push("a primary source contradicting the social claims");
  if (f.claims.some((c) => c.status === "disputed")) conditions.push("resolution of the disputed account either way");
  if (f.totalEngagement > 500) conditions.push("evidence the engagement is coordinated rather than organic");
  conditions.push("a bigger development in the same story landing before Stuart acts");
  return capitalise(conditions.join("; ") + " would change this judgement.");
}

export interface RecommendOptions {
  currentThemes?: string[];
  weights?: Record<string, number>;
  maxQueue?: number;
  privateContextNotes?: Map<string, string[]>; // clusterKey -> notes
}

/**
 * Score every cluster, build opportunity drafts with visible component
 * scores, and select a diverse queue of at most `maxQueue` recommendations.
 */
export function buildOpportunities(
  featuresByCluster: ClusterFeatures[],
  opts: RecommendOptions = {},
): OpportunityDraft[] {
  const { weights = DEFAULT_WEIGHTS, maxQueue = 5, privateContextNotes = new Map() } = opts;
  const drafts: OpportunityDraft[] = [];

  for (const f of featuresByCluster) {
    const scores = scoreCluster(f);
    const overall = overallScore(scores, weights);
    const choice = chooseAction(f, scores);

    const confirmed = summariseClaims(f.claims, ["corroborated", "verified", "primary_source_found"]);
    const claimed = summariseClaims(f.claims, ["social_claim_only", "reported", "disputed"]);
    const author = f.primary.authorName ? `${f.primary.authorName} on ${f.primary.platform}` : f.primary.platform;

    drafts.push({
      clusterKey: f.cluster.key,
      title: f.cluster.canonicalTitle,
      recommendedAction: choice.action,
      actionAlternatives: choice.rejected,
      rationale: choice.why,
      whyBetter: choice.rejected.length
        ? `Preferred over ${choice.rejected.map((r) => r.action.replace(/_/g, " ")).join(" and ")}: ${choice.rejected[0].whyNot}.`
        : choice.why,
      stuartAngle: buildAngle(f, privateContextNotes.get(f.cluster.key) ?? []),
      whatHappened: `${capitalise(author)}: "${truncate(f.primary.originalText, 240)}"`,
      whatChanged: f.claims.length
        ? capitalise(
            `${hedge(f.claims[0].status)}${truncate(f.claims[0].claimText, 200)}`,
          )
        : "No discrete factual change extracted; this cluster is conversation and colour.",
      whatsNew: scores.find((s) => s.dimension === "newness")?.reason ?? "",
      confirmedSummary: confirmed || "Nothing in this paste is independently confirmed.",
      claimedSummary: claimed || "No unverified factual claims detected.",
      missingSummary: buildMissing(f),
      editorialAngle: f.edgeTopics.length
        ? `Read it through ${f.edgeTopics[0]}: say the specific commercial thing others are missing, with the uncertainty kept honest.`
        : "If drafting anyway, stay at observation level; there is no structural angle to stand on.",
      judgementChange: buildJudgementChange(f),
      scores,
      overallScore: overall,
      urgency: dim(scores, "urgency"),
      confidence: Math.round(dim(scores, "evidence_quality") * 0.6 + (100 - dim(scores, "credibility_risk")) * 0.4),
      relationshipValue: dim(scores, "relationship_value"),
      commercialValue: dim(scores, "commercial_value"),
      credibilityRisk: dim(scores, "credibility_risk"),
      queued: false,
    });
  }

  // Queue selection: rank by overall score; skip pure ignores; enforce
  // action diversity (max 2 per action) so the queue is never five
  // variations of one move; hard cap at maxQueue.
  const ranked = [...drafts].sort((a, b) => b.overallScore - a.overallScore);
  const actionCount = new Map<string, number>();
  const relevanceOf = (d: OpportunityDraft) =>
    d.scores.find((s) => s.dimension === "nextpredict_relevance")?.score ?? 0;
  const LEAD_ACTIONS = new Set(["speaker_lead", "sponsor_lead", "media_lead", "sales_handoff"]);
  let queued = 0;
  for (const d of ranked) {
    if (queued >= maxQueue) break;
    if (d.recommendedAction === "ignore" || d.recommendedAction === "monitor") continue;
    // Commercial leads always compete for a slot; everything else must be
    // on-lane. "save" recommendations keep material without spending a slot.
    if (!LEAD_ACTIONS.has(d.recommendedAction)) {
      if (d.recommendedAction === "save") continue;
      if (relevanceOf(d) < 30 && d.relationshipValue < 50) continue;
      if (d.overallScore < 30) continue; // prefer no action over weak content
    }
    const count = actionCount.get(d.recommendedAction) ?? 0;
    if (count >= 2) continue;
    d.queued = true;
    actionCount.set(d.recommendedAction, count + 1);
    queued += 1;
  }
  return drafts;
}
