import { desc, inArray, lt } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { marketSnapshots } from "@/lib/db/schema";
import { uid } from "@/lib/ids";
import type { Collector, CollectorOutput } from "./types";

// Market-data collectors: snapshot Kalshi and Polymarket listings, diff
// against the previous snapshot, and emit a digest of what actually
// changed (new listings, status changes, volume moves) as an ingestion.
// The digest format is deliberately structured so the market_site
// segmenter parses each line into a market_listing item attributed to the
// venue: the venue's own API is a primary source for its own listings.

export interface MarketRow {
  venue: string;
  marketId: string;
  title: string;
  status: string;
  volume24h: number | null;
  liquidity: number | null;
  lastPrice: number | null;
  closeTime: string | null;
  openTime: string | null;
  raw: Record<string, unknown>;
}

export interface PreviousSnapshot {
  byKey: Map<string, MarketRow>;
  lastCapturedAt: Date | null;
}

export interface MarketDiff {
  newListings: MarketRow[];
  statusChanges: { prev: MarketRow; cur: MarketRow }[];
  volumeMoves: { prev: MarketRow; cur: MarketRow; ratio: number }[];
}

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

export function mapKalshi(json: { markets?: Record<string, unknown>[] }): MarketRow[] {
  return (json.markets ?? []).map((m) => ({
    venue: "kalshi",
    marketId: String(m.ticker ?? ""),
    title: String(m.title ?? "").slice(0, 300),
    status: String(m.status ?? "open"),
    volume24h: num(m.volume_24h) ?? num(m.volume),
    liquidity: num(m.liquidity_dollars),
    lastPrice: num(m.last_price_dollars),
    closeTime: m.close_time ? String(m.close_time) : null,
    openTime: m.open_time ? String(m.open_time) : null,
    raw: m,
  }));
}

export function mapPolymarket(json: Record<string, unknown>[]): MarketRow[] {
  return (json ?? []).map((m) => ({
    venue: "polymarket",
    marketId: String(m.id ?? m.slug ?? ""),
    title: String(m.question ?? "").slice(0, 300),
    status: m.closed ? "closed" : m.active === false ? "inactive" : "open",
    volume24h: num(m.volume24hr),
    liquidity: num(m.liquidity),
    lastPrice: num(m.lastTradePrice),
    closeTime: m.endDate ? String(m.endDate) : null,
    openTime: m.startDate ? String(m.startDate) : null,
    raw: m,
  }));
}

/**
 * Diff current rows against the previous snapshot.
 *
 * "New listing" is decided by the market's own open time being after the
 * previous collection, NOT by absence from the previous snapshot: venues
 * hold thousands of open markets and a page-limited fetch drifts between
 * calls, so absence proves nothing. Markets without an open time fall back
 * to the absence test. Status/volume changes only apply to markets seen in
 * both snapshots.
 */
export function diffSnapshots(previous: PreviousSnapshot, current: MarketRow[]): MarketDiff {
  const diff: MarketDiff = { newListings: [], statusChanges: [], volumeMoves: [] };
  const since = previous.lastCapturedAt?.getTime() ?? 0;
  for (const cur of current) {
    if (!cur.marketId || !cur.title) continue;
    const prev = previous.byKey.get(`${cur.venue}:${cur.marketId}`);
    const openedAt = cur.openTime ? new Date(cur.openTime).getTime() : null;
    const isNew = openedAt !== null ? openedAt > since : !prev;
    if (isNew) {
      diff.newListings.push(cur);
      continue;
    }
    if (!prev) continue;
    if (prev.status !== cur.status) {
      diff.statusChanges.push({ prev, cur });
    }
    if (
      prev.volume24h !== null &&
      cur.volume24h !== null &&
      prev.volume24h > 1000 &&
      cur.volume24h / Math.max(prev.volume24h, 1) >= 3
    ) {
      diff.volumeMoves.push({ prev, cur, ratio: cur.volume24h / Math.max(prev.volume24h, 1) });
    }
  }
  return diff;
}

const money = (n: number | null): string =>
  n === null ? "n/a" : n >= 1_000_000 ? `$${(n / 1_000_000).toFixed(1)}m` : n >= 1_000 ? `$${Math.round(n / 1000)}k` : `$${Math.round(n)}`;

const venueName = (v: string) => (v === "kalshi" ? "Kalshi" : v === "polymarket" ? "Polymarket" : v);

/** Auto-generated parlay/combination markets (Kalshi multivariate events,
 *  "yes X,yes Y" leg lists) are venue plumbing, not category signal. */
export function isAutoComboMarket(m: MarketRow): boolean {
  if (/(^|-)KXMVE/i.test(m.marketId)) return true;
  return /^(yes|no) [^,]{1,60},(yes|no) /i.test(m.title);
}

/**
 * Digest text for an ingestion. One line per signal; the market_site
 * segmenter parses "<Kind> on <Venue>: …" lines into attributed items.
 */
export function buildMarketDigest(diff: MarketDiff, capNew = 25): string {
  const lines: string[] = [];
  const realListings = diff.newListings.filter((m) => !isAutoComboMarket(m));
  const comboCount = diff.newListings.length - realListings.length;
  for (const m of realListings.slice(0, capNew)) {
    lines.push(
      `New listing on ${venueName(m.venue)}: "${m.title}" (${m.marketId}). Status ${m.status}, 24h volume ${money(m.volume24h)}, liquidity ${money(m.liquidity)}.`,
    );
  }
  if (realListings.length > capNew) {
    lines.push(`Plus ${realListings.length - capNew} further new listings not shown in this digest.`);
  }
  if (comboCount > 0) {
    lines.push(
      `Note: ${comboCount} auto-generated parlay/combination listings were excluded from this digest as venue plumbing.`,
    );
  }
  for (const { prev, cur } of diff.statusChanges.slice(0, 15)) {
    lines.push(
      `Status change on ${venueName(cur.venue)}: "${cur.title}" (${cur.marketId}) moved from ${prev.status} to ${cur.status}.`,
    );
  }
  for (const { prev, cur, ratio } of diff.volumeMoves.slice(0, 15)) {
    lines.push(
      `Volume move on ${venueName(cur.venue)}: "${cur.title}" (${cur.marketId}) 24h volume went from ${money(prev.volume24h)} to ${money(cur.volume24h)} (${ratio.toFixed(1)}x).`,
    );
  }
  return lines.join("\n\n");
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
  return (await res.json()) as T;
}

export async function loadPreviousSnapshot(venues: string[]): Promise<PreviousSnapshot> {
  const database = await db();
  // latest snapshot row per (venue, marketId)
  const rows = await database
    .select()
    .from(marketSnapshots)
    .where(inArray(marketSnapshots.venue, venues))
    .orderBy(desc(marketSnapshots.capturedAt))
    .limit(4000);
  const byKey = new Map<string, MarketRow>();
  let lastCapturedAt: Date | null = null;
  for (const r of rows) {
    if (!lastCapturedAt || (r.capturedAt && r.capturedAt > lastCapturedAt)) {
      lastCapturedAt = r.capturedAt ?? lastCapturedAt;
    }
    const key = `${r.venue}:${r.marketId}`;
    if (!byKey.has(key)) {
      byKey.set(key, {
        venue: r.venue,
        marketId: r.marketId,
        title: r.title,
        status: r.status,
        volume24h: r.volume24h,
        liquidity: r.liquidity,
        lastPrice: r.lastPrice,
        closeTime: r.closeTime?.toISOString() ?? null,
        openTime: null,
        raw: (r.rawJson ?? {}) as Record<string, unknown>,
      });
    }
  }
  return { byKey, lastCapturedAt };
}

export async function persistSnapshot(rows: MarketRow[]): Promise<void> {
  const database = await db();
  for (const m of rows) {
    if (!m.marketId) continue;
    await database.insert(marketSnapshots).values({
      id: uid(),
      venue: m.venue,
      marketId: m.marketId,
      title: m.title,
      status: m.status,
      volume24h: m.volume24h,
      liquidity: m.liquidity,
      lastPrice: m.lastPrice,
      closeTime: m.closeTime ? new Date(m.closeTime) : null,
      rawJson: m.raw,
    });
  }
}

/** Keep the table bounded: drop snapshot rows older than `days`. */
export async function pruneSnapshots(days = 30): Promise<void> {
  const database = await db();
  const cutoff = new Date(Date.now() - days * 24 * 3600 * 1000);
  await database.delete(marketSnapshots).where(lt(marketSnapshots.capturedAt, cutoff));
}

const KALSHI_URL = "https://api.elections.kalshi.com/trade-api/v2/markets?limit=200&status=open";
const POLYMARKET_URL =
  "https://gamma-api.polymarket.com/markets?limit=200&closed=false&order=volume24hr&ascending=false";

export function marketCollector(): Collector {
  return {
    name: "markets",
    description: "Kalshi + Polymarket listings snapshot: new listings, status changes, volume moves",
    available() {
      return { ok: true }; // public APIs, no credentials
    },
    async collect(): Promise<CollectorOutput[]> {
      const [kalshiJson, polyJson] = await Promise.all([
        fetchJson<{ markets?: Record<string, unknown>[] }>(KALSHI_URL),
        fetchJson<Record<string, unknown>[]>(POLYMARKET_URL),
      ]);
      const current = [...mapKalshi(kalshiJson), ...mapPolymarket(polyJson)];
      const previous = await loadPreviousSnapshot(["kalshi", "polymarket"]);
      const isFirstRun = previous.lastCapturedAt === null;
      const diff = diffSnapshots(previous, current);
      await persistSnapshot(current);
      await pruneSnapshots();

      // First run has no baseline: everything is "new", which is noise, not
      // signal. Record the baseline and report only a summary.
      if (isFirstRun) {
        return [
          {
            title: `Market baseline captured (${current.length} listings)`,
            sourceType: "market_site",
            text: `Baseline snapshot on ${venueName("kalshi")} and ${venueName("polymarket")}: ${current.length} open listings recorded. Diffs against this baseline start with the next collection run.`,
            note: `baseline only, no diff emitted`,
          },
        ];
      }

      const digest = buildMarketDigest(diff);
      if (!digest.trim()) return [];
      const date = new Date().toISOString().slice(0, 10);
      return [
        {
          title: `Market activity digest, Kalshi + Polymarket (${date})`,
          sourceType: "market_site",
          text: digest,
          note: `${diff.newListings.length} new, ${diff.statusChanges.length} status changes, ${diff.volumeMoves.length} volume moves`,
        },
      ];
    },
  };
}
