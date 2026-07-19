import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { segment, detectPlatform, parseCount, dedupeConcatenatedTitle } from "@/lib/pipeline/segment";

const fixture = (name: string) => fs.readFileSync(path.join(__dirname, "../fixtures", name), "utf8");

describe("LinkedIn segmentation (real 2026-07-16 capture)", () => {
  const raw = fixture("linkedin-capture-2026-07-16.txt");
  const items = segment(raw, "linkedin");
  const content = items.filter((i) => !i.isNoise);

  it("extracts every feed post (29 in the slice) at >=95%", () => {
    expect(content.length).toBeGreaterThanOrEqual(28);
    expect(content.length).toBeLessThanOrEqual(31);
  });

  it("flags navigation chrome as noise, never drops it", () => {
    const nav = items.find((i) => i.itemType === "platform_navigation");
    expect(nav).toBeDefined();
    expect(nav!.isNoise).toBe(true);
    expect(nav!.rawStartOffset).toBe(0);
  });

  it("captures authors, timestamps and offsets exactly", () => {
    const tim = content.find((i) => i.originalText.includes("Goldman just barred"));
    expect(tim).toBeDefined();
    expect(tim!.authorName).toBe("Tim Ryan");
    expect(tim!.extractionConfidence).toBeGreaterThan(0.85);
    // offsets point back into the raw text
    const rawSlice = raw.slice(tim!.rawStartOffset, tim!.rawEndOffset);
    expect(rawSlice).toContain("Goldman just barred");
  });

  it("captures the CEO headline for the DAZN announcement", () => {
    const shay = content.find((i) => i.originalText.includes("ADI PredictStreet"));
    expect(shay?.authorName).toBe("Shay Segev");
    expect(shay?.authorMeta).toContain("Chief Executive Officer at DAZN Group");
  });

  it("recognises company-page posts", () => {
    const company = content.find((i) => i.authorName === "Crypto Breaking News");
    expect(company?.itemType).toBe("company_announcement");
  });

  it("extracts embedded article footers as quoted material", () => {
    const withArticle = content.find((i) => i.sourceUrl?.includes("dazngroup.com"));
    expect(withArticle).toBeDefined();
    expect(withArticle!.quotedText).toContain("DAZN and ADI Predictstreet Announce");
  });
});

describe("X segmentation", () => {
  const raw = fixture("x-dump.txt");
  const items = segment(raw, "x");
  const content = items.filter((i) => !i.isNoise);

  it("extracts posts with handles and engagement", () => {
    const marcus = content.find((i) => i.authorHandle === "mdelaney_mkts");
    expect(marcus).toBeDefined();
    expect(marcus!.originalText).toContain("congressional trading contracts");
    expect(marcus!.engagement.views).toBe(9400);
  });

  it("detects quote-posts and their quoted source", () => {
    const quote = content.find((i) => i.itemType === "quote_post");
    expect(quote?.authorName).toBe("Sam Okafor");
    expect(quote?.quotedText).toContain("Robinhood quietly expanded");
    const quoted = content.find((i) => i.itemType === "quoted_source");
    expect(quoted?.authorName).toBe("Jenna Ruiz");
  });
});

describe("Reddit segmentation", () => {
  const raw = fixture("reddit-thread.txt");
  const items = segment(raw, "reddit");
  const content = items.filter((i) => !i.isNoise);

  it("separates posts from comments", () => {
    const post = content.find((i) => i.itemType === "original_post" && i.originalText.includes("Market Surveillance"));
    expect(post?.authorName).toBe("u/quietsignal_9");
    const comments = content.filter((i) => i.itemType === "comment");
    expect(comments.length).toBeGreaterThanOrEqual(3);
  });
});

describe("Call transcript segmentation", () => {
  const raw = fixture("call-transcript.txt");
  const items = segment(raw, "call_transcript");

  it("captures speaker turns with timestamps", () => {
    const dana = items.filter((i) => i.authorName === "Dana");
    expect(dana.length).toBeGreaterThanOrEqual(3);
    expect(dana[0].itemType).toBe("transcript_segment");
    expect(items.some((i) => i.publishedAtText === "00:02:04")).toBe(true);
  });
});

describe("platform detection for mixed pastes", () => {
  it("detects linkedin, x, reddit and transcripts", () => {
    expect(detectPlatform(fixture("linkedin-capture-2026-07-16.txt"))).toBe("linkedin");
    expect(detectPlatform(fixture("x-dump.txt"))).toBe("x");
    expect(detectPlatform(fixture("reddit-thread.txt"))).toBe("reddit");
    expect(detectPlatform(fixture("call-transcript.txt"))).toBe("call_transcript");
  });
});

describe("helpers", () => {
  it("parses K/M counts", () => {
    expect(parseCount("9.4K")).toBe(9400);
    expect(parseCount("1,234")).toBe(1234);
    expect(parseCount("2M")).toBe(2_000_000);
  });
  it("dedupes LinkedIn's doubled article titles", () => {
    expect(dedupeConcatenatedTitle("Big Story HeadlineBig Story Headline")).toBe("Big Story Headline");
    expect(dedupeConcatenatedTitle("Not doubled")).toBe("Not doubled");
  });
});
