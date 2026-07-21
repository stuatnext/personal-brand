// Cross-venue history: matched pairs accumulate same-run observations, the
// trend reader turns them into "this gap has held for a week" statements,
// and the briefing carries them. Pure trend logic plus a hermetic DB pass.
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "signal-room-cvh-"));
process.env.SIGNAL_ROOM_DATA_DIR = scratch;
delete process.env.DATABASE_URL;
delete process.env.ANTHROPIC_API_KEY;

import { db, ensureMigrated } from "@/lib/db/client";
import { crossVenuePairs, type CrossVenueObservation } from "@/lib/db/schema";
import {
  computeTrend,
  crossVenueTrends,
  pruneCrossVenuePairs,
  recordPairObservations,
  type EquivalentPair,
  type MarketRow,
} from "@/lib/collectors/markets";
import { getBriefing } from "@/lib/briefing";
import { uid } from "@/lib/ids";

const daysAgo = (n: number): string => new Date(Date.now() - n * 24 * 3600 * 1000).toISOString();

function obs(atDaysAgo: number, kPrice: number, pPrice: number, kVol = 40_000, pVol = 40_000): CrossVenueObservation {
  return {
    at: daysAgo(atDaysAgo),
    kalshiPrice: kPrice,
    polymarketPrice: pPrice,
    gap: kPrice - pPrice,
    kalshiVolume24h: kVol,
    polymarketVolume24h: pVol,
  };
}

function mk(venue: string, marketId: string, title: string, price: number, vol: number): MarketRow {
  return { venue, marketId, title, status: "open", volume24h: vol, liquidity: null, lastPrice: price, closeTime: null, openTime: null, raw: {} };
}

function pair(kPrice: number, pPrice: number, kVol = 30_000, pVol = 60_000): EquivalentPair {
  return {
    kalshi: mk("kalshi", "KXLULA-26", "Will Lula win the 2026 Brazilian presidential election?", kPrice, kVol),
    polymarket: mk("polymarket", "601819", "Will Lula win the 2026 Brazilian presidential election?", pPrice, pVol),
    similarity: 1,
  };
}

describe("computeTrend", () => {
  it("needs at least two observations spanning a day", () => {
    expect(computeTrend([obs(1, 0.6, 0.5)])).toBeNull();
    expect(computeTrend([obs(0.5, 0.6, 0.5), obs(0.4, 0.6, 0.5)])).toBeNull(); // hours apart
  });

  it("reads a held gap", () => {
    const t = computeTrend([obs(7, 0.64, 0.58), obs(4, 0.63, 0.57), obs(1, 0.65, 0.6)]);
    expect(t?.kind).toBe("gap_held");
    expect(t?.headline).toContain("higher on Kalshi");
    expect(t?.headline).toContain("3 observations");
    expect(t?.spanDays).toBe(6);
  });

  it("reads widening and narrowing", () => {
    expect(computeTrend([obs(5, 0.52, 0.5), obs(1, 0.62, 0.5)])?.kind).toBe("gap_widened");
    const conv = computeTrend([obs(5, 0.62, 0.5), obs(1, 0.51, 0.5)]);
    expect(conv?.kind).toBe("gap_converged");
    expect(conv?.headline).toContain("narrowed from 12 to 1 points");
  });

  it("reads a volume-share shift when prices stay put", () => {
    const t = computeTrend([obs(6, 0.5, 0.5, 10_000, 40_000), obs(1, 0.5, 0.5, 40_000, 10_000)]);
    expect(t?.kind).toBe("share_shift");
    expect(t?.headline).toContain("20% to 80%");
  });

  it("stays silent on small mixed wobble", () => {
    expect(computeTrend([obs(5, 0.51, 0.5), obs(3, 0.49, 0.5), obs(1, 0.5, 0.5)])).toBeNull();
  });
});

describe("pair history in the database", () => {
  beforeAll(async () => {
    await ensureMigrated();
  }, 120_000);

  afterAll(() => {
    fs.rmSync(scratch, { recursive: true, force: true });
  });

  it("upserts one row per pair and accumulates observations", async () => {
    await recordPairObservations([pair(0.64, 0.58)], new Date(Date.now() - 6 * 24 * 3600 * 1000));
    await recordPairObservations([pair(0.65, 0.59)], new Date(Date.now() - 3 * 24 * 3600 * 1000));
    await recordPairObservations([pair(0.63, 0.57)], new Date());

    const database = await db();
    const rows = await database.select().from(crossVenuePairs);
    expect(rows).toHaveLength(1);
    expect(rows[0].observationCount).toBe(3);
    expect(rows[0].observationsJson).toHaveLength(3);
    expect(rows[0].kalshiMarketId).toBe("KXLULA-26");
  });

  it("turns the history into a briefing-ready trend", async () => {
    const trends = await crossVenueTrends();
    expect(trends).toHaveLength(1);
    expect(trends[0].kind).toBe("gap_held");
    expect(trends[0].title).toContain("Lula");
    expect(trends[0].observationCount).toBe(3);

    const briefing = await getBriefing();
    expect(briefing.crossVenue.some((t) => t.title.includes("Lula") && t.kind === "gap_held")).toBe(true);
  }, 60_000);

  it("prunes pairs that stopped being observed", async () => {
    const database = await db();
    const staleAt = new Date(Date.now() - 60 * 24 * 3600 * 1000);
    await database.insert(crossVenuePairs).values({
      id: uid(),
      kalshiMarketId: "KXSTALE",
      polymarketMarketId: "0xstale",
      kalshiTitle: "A market nobody matched again",
      polymarketTitle: "A market nobody matched again",
      similarity: 1,
      observationsJson: [obs(60, 0.5, 0.4)],
      observationCount: 1,
      firstSeenAt: staleAt,
      lastSeenAt: staleAt,
    });
    await pruneCrossVenuePairs(45);
    const rows = await database.select().from(crossVenuePairs);
    expect(rows.map((r) => r.kalshiMarketId)).toEqual(["KXLULA-26"]);
  });
});
