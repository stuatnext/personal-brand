import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { parseFeed, newItemsSince, formatFeedItem, formatVideo } from "@/lib/collectors/feeds";
import { segment } from "@/lib/pipeline/segment";

const fixture = (name: string) => fs.readFileSync(path.join(__dirname, "../fixtures/collectors", name), "utf8");

describe("feed parsing (real captured feeds)", () => {
  it("parses the CFTC press-release RSS (RSS 2.0)", () => {
    const { feedTitle, items } = parseFeed(fixture("cftc-rss-sample.xml"));
    expect(feedTitle).toContain("Press Releases");
    expect(items.length).toBeGreaterThanOrEqual(3);
    expect(items[0].title.length).toBeGreaterThan(10);
    expect(items[0].link).toContain("cftc.gov");
    expect(items[0].publishedAt).toMatch(/^\d{4}-/);
  });

  it("parses a YouTube channel feed (Atom)", () => {
    const { feedTitle, items } = parseFeed(fixture("youtube-feed-sample.xml"));
    expect(feedTitle.length).toBeGreaterThan(3);
    expect(items.length).toBe(2);
    expect(items[0].link).toContain("youtube.com/watch");
    expect(items[0].publishedAt).toBeTruthy();
  });
});

describe("cursor logic", () => {
  const items = [
    { title: "a", link: "", publishedAt: "2026-07-18T10:00:00.000Z", summary: "", id: "a" },
    { title: "b", link: "", publishedAt: "2026-07-19T10:00:00.000Z", summary: "", id: "b" },
    { title: "c", link: "", publishedAt: "2026-07-20T10:00:00.000Z", summary: "", id: "c" },
  ];
  it("returns only items newer than the cursor, oldest first, and advances it", () => {
    const { fresh, nextCursor } = newItemsSince(items, "2026-07-18T12:00:00.000Z");
    expect(fresh.map((i) => i.title)).toEqual(["b", "c"]);
    expect(nextCursor).toBe("2026-07-20T10:00:00.000Z");
  });
  it("first run (no cursor) takes everything and sets the cursor", () => {
    const { fresh, nextCursor } = newItemsSince(items, null);
    expect(fresh).toHaveLength(3);
    expect(nextCursor).toBe("2026-07-20T10:00:00.000Z");
  });
});

describe("formatted feed items round-trip through segmenters", () => {
  it("news items segment as articles with source and date", () => {
    const { feedTitle, items } = parseFeed(fixture("cftc-rss-sample.xml"));
    const text = items.map((i) => formatFeedItem(i, feedTitle)).join("\n\n");
    const segmented = segment(text, "news");
    const articles = segmented.filter((i) => i.itemType === "article");
    expect(articles.length).toBeGreaterThanOrEqual(3);
    expect(articles[0].originalText).toContain("CFTC");
    expect(articles[0].publishedAtText).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("videos segment with channel attribution", () => {
    const { feedTitle, items } = parseFeed(fixture("youtube-feed-sample.xml"));
    const text = items.map((i) => formatVideo(i, feedTitle)).join("\n\n");
    const segmented = segment(text, "youtube");
    const videos = segmented.filter((i) => i.itemType === "video");
    expect(videos.length).toBe(2);
    expect(videos[0].authorName).toBe(feedTitle);
    expect(videos[0].sourceUrl).toContain("youtube.com");
  });
});
