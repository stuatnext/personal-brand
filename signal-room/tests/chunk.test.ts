import { describe, expect, it } from "vitest";
import { chunkText, reconcileChunkItems } from "@/lib/pipeline/chunk";

describe("chunkText", () => {
  it("returns a single chunk for small input", () => {
    const chunks = chunkText("hello world");
    expect(chunks).toHaveLength(1);
    expect(chunks[0].text).toBe("hello world");
  });

  it("splits large input with overlap and full coverage", () => {
    const paragraph = "A paragraph of filler text about prediction markets.\n\n";
    const text = paragraph.repeat(2000); // ~110k chars
    const chunks = chunkText(text);
    expect(chunks.length).toBeGreaterThan(5);
    // coverage: first starts at 0, last ends at length
    expect(chunks[0].startOffset).toBe(0);
    expect(chunks[chunks.length - 1].endOffset).toBe(text.length);
    for (let i = 1; i < chunks.length; i++) {
      // overlap: each chunk starts before the previous ended
      expect(chunks[i].startOffset).toBeLessThan(chunks[i - 1].endOffset);
      // chunk text matches its offsets exactly
      expect(text.slice(chunks[i].startOffset, chunks[i].endOffset)).toBe(chunks[i].text);
    }
  });

  it("prefers blank-line boundaries", () => {
    const text = ("x".repeat(300) + "\n\n").repeat(100);
    const chunks = chunkText(text, { targetSize: 2000, maxSize: 3000, overlap: 100 });
    // every non-final chunk should end just after a blank line
    for (const c of chunks.slice(0, -1)) {
      expect(c.text.endsWith("\n\n")).toBe(true);
    }
  });
});

describe("reconcileChunkItems", () => {
  it("merges items duplicated across an overlap boundary, keeping the longer capture", () => {
    const items = [
      { rawStartOffset: 0, rawEndOffset: 100, id: "a" },
      { rawStartOffset: 10, rawEndOffset: 130, id: "b" }, // same underlying item, longer capture
      { rawStartOffset: 200, rawEndOffset: 300, id: "c" },
    ];
    const merged = reconcileChunkItems(items);
    expect(merged).toHaveLength(2);
    expect(merged[0].id).toBe("b");
    expect(merged[1].id).toBe("c");
  });
});
