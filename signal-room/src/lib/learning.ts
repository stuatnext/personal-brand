import { desc, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { auditLog, feedback, opportunityScores, users } from "@/lib/db/schema";
import { uid } from "@/lib/ids";
import { DEFAULT_WEIGHTS } from "@/lib/pipeline/score";

// Feedback-driven weight learning: Stuart's Use / Save vs Ignore / Wrong-
// angle decisions teach the queue what he actually values. Each learning
// pass looks at how every score dimension separated his accepted
// opportunities from his rejected ones and nudges that dimension's weight,
// bounded and slow. Scores stay opinions; the weights just get opinionated
// in Stuart's direction.

const INVERTED = new Set(["saturation", "credibility_risk"]);
export const WEIGHT_MIN = 0.2;
export const WEIGHT_MAX = 2.5;
export const LEARNING_RATE = 0.15;
export const MIN_POSITIVE = 3;
export const MIN_NEGATIVE = 3;

export interface LearningSample {
  decision: string; // use | save | ignore | wrong_angle
  scores: Record<string, number>;
}

export interface WeightChange {
  dimension: string;
  from: number;
  to: number;
  signal: number; // -100..100: how strongly this dimension separated accepted from rejected
  positiveMean: number;
  negativeMean: number;
}

export interface LearningResult {
  applied: boolean;
  reason?: string;
  positives: number;
  negatives: number;
  changes: WeightChange[];
  weights: Record<string, number>;
}

const POSITIVE = new Set(["use", "save"]);
const NEGATIVE = new Set(["ignore", "wrong_angle"]);

/** Pure learning step over decision samples. */
export function computeWeightAdjustments(
  samples: LearningSample[],
  currentWeights: Record<string, number>,
  rate = LEARNING_RATE,
): LearningResult {
  const positives = samples.filter((s) => POSITIVE.has(s.decision));
  const negatives = samples.filter((s) => NEGATIVE.has(s.decision));
  const base: LearningResult = {
    applied: false,
    positives: positives.length,
    negatives: negatives.length,
    changes: [],
    weights: { ...currentWeights },
  };
  if (positives.length < MIN_POSITIVE || negatives.length < MIN_NEGATIVE) {
    return {
      ...base,
      reason: `not enough feedback yet (${positives.length} accepted / ${negatives.length} rejected; need ${MIN_POSITIVE}/${MIN_NEGATIVE})`,
    };
  }

  const effective = (dim: string, score: number) => (INVERTED.has(dim) ? 100 - score : score);
  const mean = (rows: LearningSample[], dim: string): number | null => {
    const vals = rows.filter((r) => dim in r.scores).map((r) => effective(dim, r.scores[dim]));
    return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
  };

  const changes: WeightChange[] = [];
  const weights = { ...currentWeights };
  for (const dimension of Object.keys(DEFAULT_WEIGHTS)) {
    const from = weights[dimension] ?? DEFAULT_WEIGHTS[dimension];
    const posMean = mean(positives, dimension);
    const negMean = mean(negatives, dimension);
    if (posMean === null || negMean === null) continue;
    const signal = posMean - negMean;
    // small, bounded multiplicative nudge in the signal's direction
    const to = Math.min(WEIGHT_MAX, Math.max(WEIGHT_MIN, +(from * (1 + rate * (signal / 100))).toFixed(3)));
    weights[dimension] = to;
    if (Math.abs(to - from) >= 0.005) {
      changes.push({
        dimension,
        from: +from.toFixed(3),
        to,
        signal: +signal.toFixed(1),
        positiveMean: +posMean.toFixed(1),
        negativeMean: +negMean.toFixed(1),
      });
    }
  }
  return { applied: changes.length > 0, positives: positives.length, negatives: negatives.length, changes, weights };
}

/** Gather samples: the latest decision per opportunity, joined to its
 *  component scores. */
export async function gatherSamples(): Promise<LearningSample[]> {
  const database = await db();
  const rows = await database
    .select({
      opportunityId: feedback.opportunityId,
      decision: feedback.decision,
      createdAt: feedback.createdAt,
    })
    .from(feedback)
    .orderBy(desc(feedback.createdAt))
    .limit(2000);
  const latestByOpp = new Map<string, string>();
  for (const r of rows) {
    if (!latestByOpp.has(r.opportunityId)) latestByOpp.set(r.opportunityId, r.decision);
  }
  const oppIds = [...latestByOpp.keys()];
  if (oppIds.length === 0) return [];
  const scoreRows = await database
    .select()
    .from(opportunityScores)
    .where(inArray(opportunityScores.opportunityId, oppIds));
  const scoresByOpp = new Map<string, Record<string, number>>();
  for (const s of scoreRows) {
    const rec = scoresByOpp.get(s.opportunityId) ?? {};
    rec[s.dimension] = s.score;
    scoresByOpp.set(s.opportunityId, rec);
  }
  return oppIds
    .map((id) => ({ decision: latestByOpp.get(id)!, scores: scoresByOpp.get(id) ?? {} }))
    .filter((s) => Object.keys(s.scores).length > 0);
}

/** Run a learning pass and persist the adjusted weights (unless dryRun). */
export async function learnWeights(options: { dryRun?: boolean; rate?: number } = {}): Promise<LearningResult> {
  const database = await db();
  const [owner] = await database.select().from(users).limit(1);
  if (!owner) {
    return { applied: false, reason: "no user seeded", positives: 0, negatives: 0, changes: [], weights: DEFAULT_WEIGHTS };
  }
  const settings = { ...(owner.settingsJson as Record<string, unknown>) };
  const currentWeights = {
    ...DEFAULT_WEIGHTS,
    ...((settings.scoreWeights as Record<string, number> | undefined) ?? {}),
  };
  const samples = await gatherSamples();
  const result = computeWeightAdjustments(samples, currentWeights, options.rate);
  if (result.applied && !options.dryRun) {
    settings.scoreWeights = result.weights;
    await database.update(users).set({ settingsJson: settings }).where(eq(users.id, owner.id));
    await database.insert(auditLog).values({
      id: uid(),
      actor: "system",
      action: "learn_weights",
      scopeType: "user",
      scopeId: owner.id,
      detailJson: {
        positives: result.positives,
        negatives: result.negatives,
        changes: result.changes,
      } as unknown as Record<string, unknown>,
    });
  }
  return result;
}
