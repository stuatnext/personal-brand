import { describe, expect, it } from "vitest";
import { detectDuplicates, dedupeHash, jaccard, shingles, normaliseForDedupe } from "@/lib/pipeline/dedupe";
import type { ExtractedItem } from "@/lib/pipeline/types";

function item(tempId: string, text: string): ExtractedItem {
  return {
    tempId,
    platform: "x",
    itemType: "original_post",
    originalText: text,
    engagement: {},
    rawStartOffset: 0,
    rawEndOffset: text.length,
    extractionConfidence: 0.9,
    isNoise: false,
    topics: [],
  };
}

const STORY =
  "Kalshi has filed with the CFTC to self-certify contracts on quarterly GDP revisions, expanding its economic indicators category beyond CPI and payrolls data.";

describe("duplicate detection", () => {
  it("catches exact duplicates regardless of case/punctuation noise", () => {
    const a = item("a", STORY);
    const b = item("b", STORY.toUpperCase() + " ​"); // zero-width litter
    const result = detectDuplicates([a, b]);
    expect(result.duplicateOf.size).toBe(1);
    const dup = result.duplicateOf.get("a") ?? result.duplicateOf.get("b");
    expect(dup?.kind).toBe("duplicate_of");
  });

  it("catches truncated reposts via containment (…more)", () => {
    const full = item("full", STORY + " The company said the contracts are pending review by the commission staff.");
    const truncated = item("trunc", STORY.slice(0, 120) + "…more");
    const result = detectDuplicates([full, truncated]);
    expect(result.duplicateOf.has("trunc")).toBe(true);
  });

  it("does not merge different stories about the same company", () => {
    const a = item("a", "Kalshi announced a partnership with a major sports league to develop event contracts for championship outcomes.");
    const b = item("b", "Kalshi is hiring a market surveillance analyst in New York, according to its careers page listing posted this week.");
    const result = detectDuplicates([a, b]);
    expect(result.duplicateOf.size).toBe(0);
  });

  it("keeps the longest capture as canonical", () => {
    const short = item("short", STORY);
    const long = item("long", STORY + " Additional detail sentence follows here.");
    const result = detectDuplicates([short, long]);
    expect(result.duplicateOf.get("short")?.canonical).toBe("long");
  });
});

describe("primitives", () => {
  it("normalises consistently", () => {
    expect(normaliseForDedupe("Hello,   WORLD!")).toBe("hello world");
    expect(dedupeHash("Hello world")).toBe(dedupeHash("hello,  world!"));
  });
  it("jaccard behaves", () => {
    const a = shingles("one two three four five six seven eight");
    expect(jaccard(a, a)).toBe(1);
    expect(jaccard(a, shingles("totally different words entirely here right now yes"))).toBe(0);
  });
});
