// Cross-venue market intelligence: equivalent-market matching across
// Kalshi/Polymarket, divergence/concentration signals, and the digest's
// round trip through the market_site segmenter into primary-source claims.
import { describe, expect, it } from "vitest";
import {
  buildCrossVenueDigest,
  crossVenueSignals,
  matchEquivalentMarkets,
  significantTitleTokens,
  type MarketRow,
} from "@/lib/collectors/markets";
import { runPurePipeline } from "@/lib/pipeline/pure";

function mk(
  venue: string,
  marketId: string,
  title: string,
  opts: { price?: number | null; vol?: number | null; close?: string | null; status?: string } = {},
): MarketRow {
  return {
    venue,
    marketId,
    title,
    status: opts.status ?? "open",
    volume24h: opts.vol ?? 50_000,
    liquidity: null,
    lastPrice: opts.price ?? 0.5,
    closeTime: opts.close ?? null,
    openTime: null,
    raw: {},
  };
}

describe("significantTitleTokens", () => {
  it("keeps distinctive words and numbers, drops stopwords", () => {
    const tokens = significantTitleTokens("Will the Fed cut rates at the September 2026 meeting?");
    expect(tokens).toContain("fed");
    expect(tokens).toContain("september");
    expect(tokens).toContain("2026");
    expect(tokens).not.toContain("will");
    expect(tokens).not.toContain("the");
  });

  it("normalises separated thousands", () => {
    expect(significantTitleTokens("Bitcoin above $150,000 by March?")).toContain("150000");
  });
});

describe("matchEquivalentMarkets", () => {
  const fedK = mk("kalshi", "KXFED-26SEP", "Will the Fed cut rates at the September 2026 meeting?", {
    price: 0.62,
    vol: 80_000,
    close: "2026-09-17T18:00:00Z",
  });
  const fedP = mk("polymarket", "0xfed", "Fed rate cut at the September 2026 meeting?", {
    price: 0.48,
    vol: 45_000,
    close: "2026-09-17T20:00:00Z",
  });

  it("matches the same question phrased differently on both venues", () => {
    const pairs = matchEquivalentMarkets([fedK], [fedP]);
    expect(pairs).toHaveLength(1);
    expect(pairs[0].kalshi.marketId).toBe("KXFED-26SEP");
    expect(pairs[0].polymarket.marketId).toBe("0xfed");
  });

  it("does not match different questions", () => {
    const btc = mk("polymarket", "0xbtc", "Will Bitcoin close above 150000 in September 2026?", {
      close: "2026-09-30T00:00:00Z",
    });
    expect(matchEquivalentMarkets([fedK], [btc])).toHaveLength(0);
  });

  it("vetoes a moderate wording match whose resolution windows are far apart", () => {
    const shutdownK = mk("kalshi", "KXSHUT", "US government shutdown this year?", {
      close: "2026-10-01T00:00:00Z",
    });
    const shutdownP = mk("polymarket", "0xshut", "US government shutdown before 2027?", {
      close: "2027-06-30T00:00:00Z",
    });
    expect(matchEquivalentMarkets([shutdownK], [shutdownP])).toHaveLength(0);
  });

  it("matches one-to-one, keeping the strongest pairing", () => {
    const exactK = mk("kalshi", "KX-EXACT", "Fed rate cut at the September 2026 meeting?", {
      close: "2026-09-17T18:00:00Z",
    });
    const pairs = matchEquivalentMarkets([fedK, exactK], [fedP]);
    expect(pairs).toHaveLength(1);
    expect(pairs[0].kalshi.marketId).toBe("KX-EXACT"); // identical wording outranks the paraphrase
  });

  it("excludes closed, unpriced and auto-combo markets", () => {
    const closed = { ...fedK, status: "closed" };
    const unpriced = { ...fedK, lastPrice: null };
    const combo = { ...fedK, marketId: "KXMVE-FED-COMBO" };
    expect(matchEquivalentMarkets([closed, unpriced, combo], [fedP])).toHaveLength(0);
  });
});

describe("crossVenueSignals", () => {
  const pair = (kPrice: number, pPrice: number, kVol: number, pVol: number) => ({
    kalshi: mk("kalshi", "K1", "t", { price: kPrice, vol: kVol }),
    polymarket: mk("polymarket", "P1", "t", { price: pPrice, vol: pVol }),
    similarity: 1,
  });

  it("flags a price gap of 5+ points with real volume", () => {
    const signals = crossVenueSignals([pair(0.62, 0.48, 80_000, 45_000)]);
    expect(signals).toHaveLength(1);
    expect(signals[0].kind).toBe("price_divergence");
    expect(signals[0].priceGap).toBeCloseTo(0.14, 5);
  });

  it("ignores near-identical prices unless liquidity is concentrated", () => {
    expect(crossVenueSignals([pair(0.5, 0.52, 20_000, 20_000)])).toHaveLength(0);
    const concentrated = crossVenueSignals([pair(0.5, 0.52, 110_000, 10_000)]);
    expect(concentrated).toHaveLength(1);
    expect(concentrated[0].kind).toBe("liquidity_concentration");
    expect(concentrated[0].dominantVenue).toBe("Kalshi");
  });

  it("treats a gap on dead markets as stale-price noise, not divergence", () => {
    expect(crossVenueSignals([pair(0.6, 0.52, 2_000, 1_000)])).toHaveLength(0);
  });
});

describe("cross-venue digest round trip", () => {
  it("parses as attributed market items whose claims are primary-source", () => {
    const pairs = matchEquivalentMarkets(
      [
        mk("kalshi", "KXFED-26SEP", "Will the Fed cut rates at the September 2026 meeting?", {
          price: 0.62,
          vol: 80_000,
          close: "2026-09-17T18:00:00Z",
        }),
      ],
      [
        mk("polymarket", "0xfed", "Fed rate cut at the September 2026 meeting?", {
          price: 0.48,
          vol: 45_000,
          close: "2026-09-17T20:00:00Z",
        }),
      ],
    );
    const digest = buildCrossVenueDigest(crossVenueSignals(pairs));
    expect(digest).toContain("Cross-venue divergence on Kalshi vs Polymarket:");
    expect(digest).toContain("62c on Kalshi");
    expect(digest).toContain("48c on Polymarket");
    expect(digest).toContain("14 point gap");

    const run = runPurePipeline(digest, "market_site");
    const listing = run.items.find((i) => i.itemType === "market_listing");
    expect(listing).toBeDefined();
    expect(listing!.authorName).toBe("Kalshi vs Polymarket");

    // both venues are author entities (platforms), never a person
    const authors = run.mentions.filter((m) => m.role === "author");
    expect(authors.map((a) => a.canonicalName).sort()).toEqual(["Kalshi", "Polymarket"]);
    expect(authors.every((a) => a.kind === "platform")).toBe(true);

    // prices come from the venues' own APIs: primary source, not rumour
    const claim = run.claims.find((c) => c.claimText.includes("point gap"));
    expect(claim?.status).toBe("primary_source_found");
  });

  it("caps the digest and says what was left out", () => {
    const signals = Array.from({ length: 11 }, (_, i) =>
      crossVenueSignals([
        {
          kalshi: mk("kalshi", `K${i}`, `Question ${i} resolves yes?`, { price: 0.6, vol: 40_000 }),
          polymarket: mk("polymarket", `P${i}`, `Question ${i} resolves yes?`, { price: 0.4, vol: 40_000 }),
          similarity: 1,
        },
      ])[0],
    );
    const digest = buildCrossVenueDigest(signals);
    expect(digest).toContain("Plus 3 further cross-venue signals");
  });
});
