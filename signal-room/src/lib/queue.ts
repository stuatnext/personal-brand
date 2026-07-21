import { desc, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { ingestions, opportunities, recommendations, storyClusters, storyThreads } from "@/lib/db/schema";

const LEAD_ACTIONS = new Set(["speaker_lead", "sponsor_lead", "media_lead", "sales_handoff"]);

export interface QueueEntry {
  recommendationId: string;
  opportunityId: string;
  title: string;
  action: string;
  pillar: string;
  /** observation count of the story thread this opportunity continues (>1 = continuing story) */
  threadDay: number | null;
  overallScore: number;
  urgency: number;
  confidence: number;
  credibilityRisk: number;
  relationshipValue: number;
  commercialValue: number;
  whatHappened: string | null;
  rationale: string | null;
  stuartAngle: string | null;
  from: string;
  platform: string;
  queueDate: string;
}

/**
 * Today's queue: the strongest open recommendations across ingestions,
 * capped at five. Commercial leads are guaranteed at least one slot when
 * any are open; money conversations don't lose to content posts on a
 * score tiebreak.
 */
export async function getTodayQueue(): Promise<QueueEntry[]> {
  const database = await db();
  const rows = await database
    .select({
      rec: recommendations,
      opp: opportunities,
      ingestionTitle: ingestions.title,
      sourceType: ingestions.sourceType,
      threadObservations: storyThreads.observationCount,
    })
    .from(recommendations)
    .innerJoin(opportunities, eq(recommendations.opportunityId, opportunities.id))
    .innerJoin(ingestions, eq(recommendations.ingestionId, ingestions.id))
    .innerJoin(storyClusters, eq(opportunities.storyClusterId, storyClusters.id))
    .leftJoin(storyThreads, eq(storyClusters.threadId, storyThreads.id))
    .where(eq(recommendations.status, "open"))
    .orderBy(desc(opportunities.overallScore))
    .limit(60);
  const open = rows.filter((r) => r.opp.status === "proposed");
  // Pillar balance: when open recommendations span more than one pillar, no
  // single pillar takes more than 3 of the 5 slots — core pillars never
  // starve just because one drop was bigger.
  const pillarsPresent = new Set(open.map((r) => r.opp.pillar));
  const perPillarCap = pillarsPresent.size > 1 ? 3 : 5;
  const perPillar = new Map<string, number>();
  const top: typeof open = [];
  for (const r of open) {
    if (top.length >= 5) break;
    const n = perPillar.get(r.opp.pillar) ?? 0;
    if (n >= perPillarCap) continue;
    top.push(r);
    perPillar.set(r.opp.pillar, n + 1);
  }
  if (!top.some((r) => LEAD_ACTIONS.has(r.rec.primaryAction))) {
    const bestLead = open.find((r) => LEAD_ACTIONS.has(r.rec.primaryAction));
    if (bestLead && top.length === 5) top[4] = bestLead;
    else if (bestLead) top.push(bestLead);
  }
  return top.map((r) => ({
    recommendationId: r.rec.id,
    opportunityId: r.opp.id,
    title: r.opp.title,
    action: r.rec.primaryAction,
    pillar: r.opp.pillar,
    threadDay: r.threadObservations && r.threadObservations > 1 ? r.threadObservations : null,
    overallScore: r.opp.overallScore,
    urgency: r.opp.urgency,
    confidence: r.opp.confidence,
    credibilityRisk: r.opp.credibilityRisk,
    relationshipValue: r.opp.relationshipValue,
    commercialValue: r.opp.commercialValue,
    whatHappened: r.opp.whatHappened,
    rationale: r.opp.rationale,
    stuartAngle: r.opp.stuartAngle,
    from: r.ingestionTitle,
    platform: r.sourceType,
    queueDate: r.rec.queueDate,
  }));
}
