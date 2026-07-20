import { describe, expect, it } from "vitest";
import {
  computeWeightAdjustments,
  WEIGHT_MAX,
  WEIGHT_MIN,
  type LearningSample,
} from "@/lib/learning";
import { DEFAULT_WEIGHTS } from "@/lib/pipeline/score";

function sample(decision: string, scores: Record<string, number>): LearningSample {
  return { decision, scores };
}

describe("weight learning (pure step)", () => {
  it("does nothing without enough feedback in both classes", () => {
    const result = computeWeightAdjustments(
      [sample("use", { stuart_edge: 90 }), sample("ignore", { stuart_edge: 10 })],
      DEFAULT_WEIGHTS,
    );
    expect(result.applied).toBe(false);
    expect(result.reason).toContain("not enough feedback");
    expect(result.weights).toEqual(DEFAULT_WEIGHTS);
  });

  it("raises weights for dimensions that separate accepted from rejected", () => {
    const samples: LearningSample[] = [
      // Stuart consistently uses high-edge, low-heat items…
      sample("use", { stuart_edge: 90, conversation_heat: 20 }),
      sample("use", { stuart_edge: 85, conversation_heat: 30 }),
      sample("save", { stuart_edge: 80, conversation_heat: 25 }),
      // …and rejects low-edge, high-heat ones.
      sample("ignore", { stuart_edge: 20, conversation_heat: 90 }),
      sample("wrong_angle", { stuart_edge: 25, conversation_heat: 85 }),
      sample("ignore", { stuart_edge: 30, conversation_heat: 80 }),
    ];
    const result = computeWeightAdjustments(samples, DEFAULT_WEIGHTS);
    expect(result.applied).toBe(true);
    const edge = result.changes.find((c) => c.dimension === "stuart_edge");
    const heat = result.changes.find((c) => c.dimension === "conversation_heat");
    expect(edge).toBeDefined();
    expect(edge!.to).toBeGreaterThan(edge!.from);
    expect(heat).toBeDefined();
    expect(heat!.to).toBeLessThan(heat!.from);
  });

  it("handles inverted dimensions correctly (high credibility risk on rejected items raises the weight)", () => {
    const samples: LearningSample[] = [
      sample("use", { credibility_risk: 10 }),
      sample("use", { credibility_risk: 15 }),
      sample("use", { credibility_risk: 5 }),
      sample("ignore", { credibility_risk: 80 }),
      sample("ignore", { credibility_risk: 90 }),
      sample("wrong_angle", { credibility_risk: 85 }),
    ];
    const result = computeWeightAdjustments(samples, DEFAULT_WEIGHTS);
    const risk = result.changes.find((c) => c.dimension === "credibility_risk");
    // accepted items had LOW risk => inverted signal positive => weight up
    expect(risk).toBeDefined();
    expect(risk!.to).toBeGreaterThan(risk!.from);
  });

  it("keeps weights inside bounds however extreme the signal", () => {
    const positives = Array.from({ length: 10 }, () => sample("use", { urgency: 100 }));
    const negatives = Array.from({ length: 10 }, () => sample("ignore", { urgency: 0 }));
    let weights = { ...DEFAULT_WEIGHTS };
    for (let i = 0; i < 200; i++) {
      weights = computeWeightAdjustments([...positives, ...negatives], weights).weights;
    }
    expect(weights.urgency).toBeLessThanOrEqual(WEIGHT_MAX);
    let down = { ...DEFAULT_WEIGHTS };
    const posLow = Array.from({ length: 10 }, () => sample("use", { urgency: 0 }));
    const negHigh = Array.from({ length: 10 }, () => sample("ignore", { urgency: 100 }));
    for (let i = 0; i < 200; i++) {
      down = computeWeightAdjustments([...posLow, ...negHigh], down).weights;
    }
    expect(down.urgency).toBeGreaterThanOrEqual(WEIGHT_MIN);
  });

  it("moves slowly: one pass shifts a weight by at most rate", () => {
    const samples = [
      ...Array.from({ length: 5 }, () => sample("use", { originality: 100 })),
      ...Array.from({ length: 5 }, () => sample("ignore", { originality: 0 })),
    ];
    const result = computeWeightAdjustments(samples, DEFAULT_WEIGHTS);
    const change = result.changes.find((c) => c.dimension === "originality")!;
    expect(change.to / change.from).toBeLessThanOrEqual(1.16); // rate 0.15 + rounding
  });
});
