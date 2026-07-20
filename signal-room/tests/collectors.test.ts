import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import {
  mapKalshi,
  mapPolymarket,
  diffSnapshots,
  buildMarketDigest,
  isAutoComboMarket,
  type MarketRow,
  type PreviousSnapshot,
} from "@/lib/collectors/markets";
import { formatRedditPost, formatTweet } from "@/lib/collectors/social";
import { segment } from "@/lib/pipeline/segment";
import { runPurePipeline } from "@/lib/pipeline/pure";

const fixture = (name: string) =>
  JSON.parse(fs.readFileSync(path.join(__dirname, "../fixtures/collectors", name), "utf8"));

function row(overrides: Partial<MarketRow>): MarketRow {
  return {
    venue: "kalshi",
    marketId: "TEST-1",
    title: "Will the CFTC approve the framework by September?",
    status: "open",
    volume24h: 5000,
    liquidity: 10_000,
    lastPrice: 0.4,
    closeTime: null,
    openTime: null,
    raw: {},
    ...overrides,
  };
}

describe("market API mapping (real captured responses)", () => {
  it("maps Kalshi markets", () => {
    const rows = mapKalshi(fixture("kalshi-sample.json"));
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      expect(r.venue).toBe("kalshi");
      expect(r.marketId).toBeTruthy();
      expect(r.title).toBeTruthy();
    }
  });
  it("maps Polymarket markets with volume and open time", () => {
    const rows = mapPolymarket(fixture("polymarket-sample.json"));
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0].volume24h).toBeGreaterThan(0);
    expect(rows[0].openTime).toBeTruthy();
  });
});

describe("snapshot diffing", () => {
  const lastCapture = new Date("2026-07-19T12:00:00Z");
  const previous: PreviousSnapshot = {
    lastCapturedAt: lastCapture,
    byKey: new Map([
      ["kalshi:OLD-1", row({ marketId: "OLD-1", status: "open", volume24h: 2000 })],
      ["kalshi:OLD-2", row({ marketId: "OLD-2", status: "open", volume24h: 5000 })],
    ]),
  };

  it("calls a market new only when it opened after the last collection", () => {
    const diff = diffSnapshots(previous, [
      row({ marketId: "FRESH", openTime: "2026-07-19T14:00:00Z" }),
      row({ marketId: "STALE-BUT-UNSEEN", openTime: "2026-07-01T00:00:00Z" }), // page drift, not new
      row({ marketId: "OLD-1", openTime: "2026-07-01T00:00:00Z" }),
    ]);
    expect(diff.newListings.map((m) => m.marketId)).toEqual(["FRESH"]);
  });

  it("falls back to absence when a venue reports no open time", () => {
    const diff = diffSnapshots(previous, [row({ marketId: "NO-OPENTIME", openTime: null })]);
    expect(diff.newListings.map((m) => m.marketId)).toEqual(["NO-OPENTIME"]);
  });

  it("detects status changes and volume moves on matched markets", () => {
    const diff = diffSnapshots(previous, [
      row({ marketId: "OLD-1", status: "closed", openTime: "2026-07-01T00:00:00Z" }),
      row({ marketId: "OLD-2", volume24h: 40_000, openTime: "2026-07-01T00:00:00Z" }),
    ]);
    expect(diff.statusChanges).toHaveLength(1);
    expect(diff.volumeMoves).toHaveLength(1);
    expect(diff.volumeMoves[0].ratio).toBeGreaterThan(3);
  });
});

describe("market digest", () => {
  it("filters auto-generated parlay combos and reports the exclusion", () => {
    const combo = row({
      marketId: "KXMVESPORTSMULTIGAME-XYZ",
      title: "yes Boston,yes Atlanta,yes Texas",
      openTime: "2026-07-19T14:00:00Z",
    });
    expect(isAutoComboMarket(combo)).toBe(true);
    const real = row({ marketId: "KXCFTC-26", openTime: "2026-07-19T14:00:00Z" });
    const digest = buildMarketDigest({ newListings: [combo, real], statusChanges: [], volumeMoves: [] });
    expect(digest).toContain("New listing on Kalshi: \"Will the CFTC approve");
    expect(digest).not.toContain("yes Boston");
    expect(digest).toContain("auto-generated parlay");
  });

  it("segments into venue-attributed market_listing items that claim as primary source", () => {
    const digest = buildMarketDigest({
      newListings: [row({ marketId: "KXCFTC-26", openTime: "2026-07-19T14:00:00Z" })],
      statusChanges: [
        { prev: row({ marketId: "OLD-1" }), cur: row({ marketId: "OLD-1", status: "settled" }) },
      ],
      volumeMoves: [],
    });
    const items = segment(digest, "market_site");
    const listing = items.find((i) => i.itemType === "market_listing");
    expect(listing).toBeDefined();
    expect(listing!.authorName).toBe("Kalshi");

    const run = runPurePipeline(digest, "market_site");
    // venue API data is self-sourced: primary source for its own listings
    const claim = run.claims.find((c) => c.claimText.includes("Will the CFTC approve"));
    expect(claim?.status).toBe("primary_source_found");
  });
});

describe("social formatters produce segmenter-native shapes", () => {
  it("reddit posts round-trip through the reddit segmenter", () => {
    const text = formatRedditPost({
      title: "Kalshi surveillance hiring seems underdiscussed",
      selftext: "The listing asks for cross-market manipulation detection experience.",
      author: "quietsignal_9",
      subreddit_name_prefixed: "r/PredictionMarkets",
      ups: 41,
      num_comments: 12,
      created_utc: Date.now() / 1000 - 7200,
    });
    const items = segment(text, "reddit");
    const post = items.find((i) => i.itemType === "original_post");
    expect(post?.authorName).toBe("u/quietsignal_9");
    expect(post?.engagement.upvotes).toBe(41);
  });

  it("tweets round-trip through the X segmenter", () => {
    const text = formatTweet(
      {
        id: "1",
        text: "Robinhood's event contracts hub expansion is a distribution story, not a product story.",
        created_at: new Date(Date.now() - 3 * 3600_000).toISOString(),
        author_id: "u1",
        public_metrics: { reply_count: 3, retweet_count: 8, like_count: 55, impression_count: 9100 },
      },
      { id: "u1", name: "Jenna Ruiz", username: "jennaruiz_" },
    );
    const items = segment(text, "x");
    const post = items.find((i) => !i.isNoise);
    expect(post?.authorName).toBe("Jenna Ruiz");
    expect(post?.authorHandle).toBe("jennaruiz_");
    expect(post?.engagement.views).toBe(9100);
  });
});
