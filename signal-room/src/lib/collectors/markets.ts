import { desc, inArray, lt } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { marketSnapshots } from "@/lib/db/schema";
import { uid } from "@/lib/ids";
import { getCursor, setCursor } from "./cursors";
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
  return (json.markets ?? []).map((m) => {
    // Multi-outcome events repeat one title across candidate rows; the
    // yes_sub_title names the outcome ("Who will the next Pope be?" +
    // "Parolin"). Fold it in so rows are distinguishable in digests and
    // title matching pairs the right outcome, not just the right event.
    let title = String(m.title ?? "").slice(0, 260);
    const subTitle = String(m.yes_sub_title ?? "").trim();
    if (subTitle && subTitle.length <= 80 && !title.toLowerCase().includes(subTitle.toLowerCase())) {
      title = `${title} (${subTitle})`;
    }
    return {
      venue: "kalshi",
      marketId: String(m.ticker ?? ""),
      title,
      status: String(m.status ?? "open"),
      // the API has served both plain and _fp-suffixed volume fields
      volume24h: num(m.volume_24h) ?? num(m.volume_24h_fp) ?? num(m.volume) ?? num(m.volume_fp),
      liquidity: num(m.liquidity_dollars),
      lastPrice: num(m.last_price_dollars),
      closeTime: m.close_time ? String(m.close_time) : null,
      openTime: m.open_time ? String(m.open_time) : null,
      raw: m,
    };
  });
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

// --- Cross-venue market intelligence ----------------------------------------
// The same real-world question often trades on both Kalshi and Polymarket.
// Because both venues price contracts on 0..1, a matched pair whose prices
// disagree, or whose liquidity sits almost entirely on one venue, is
// editorial signal: where do the venues disagree, and where is the category's
// liquidity actually concentrating. Matching is deliberately conservative
// (wording overlap corroborated by shared figures or aligned resolution
// windows) — a missed paraphrase is fine, a false equivalence is not.

const TITLE_STOPWORDS = new Set([
  "will", "the", "a", "an", "be", "is", "are", "was", "were", "been", "do", "does",
  "in", "on", "of", "to", "for", "at", "by", "or", "and", "as", "with", "from",
  "before", "after", "during", "until", "than", "then", "there", "their", "this",
  "that", "these", "those", "it", "its", "any", "all", "more", "most", "how",
  "many", "much", "what", "which", "who", "when", "where", "not", "no", "yes",
  "out", "up", "down", "over", "under", "above", "below", "between", "into",
  "have", "has", "had", "get", "gets", "his", "her", "they", "them", "you",
]);

/** Distinctive lowercase tokens from a market title: words ≥3 chars minus
 *  stopwords, plus every number (years, thresholds, prices). */
export function significantTitleTokens(title: string): string[] {
  return [
    ...new Set(
      title
        .toLowerCase()
        .replace(/(\d),(\d)/g, "$1$2") // 70,000 -> 70000
        .replace(/[’']s\b/g, "")
        .replace(/[^a-z0-9$%. ]+/g, " ")
        .split(/\s+/)
        .map((t) => t.replace(/^[$.]+|[.%$]+$/g, ""))
        .filter((t) => /^\d/.test(t) || (t.length >= 3 && !TITLE_STOPWORDS.has(t))),
    ),
  ];
}

export interface EquivalentPair {
  kalshi: MarketRow;
  polymarket: MarketRow;
  similarity: number;
}

function tokenJaccard(a: string[], b: string[]): number {
  const sb = new Set(b);
  let inter = 0;
  for (const t of a) if (sb.has(t)) inter++;
  const union = a.length + b.length - inter;
  return union === 0 ? 0 : inter / union;
}

/** true/false when both close times are known, null when either is missing. */
function closeTimesAligned(a: MarketRow, b: MarketRow, hours = 72): boolean | null {
  if (!a.closeTime || !b.closeTime) return null;
  const ta = new Date(a.closeTime).getTime();
  const tb = new Date(b.closeTime).getTime();
  if (!Number.isFinite(ta) || !Number.isFinite(tb)) return null;
  return Math.abs(ta - tb) <= hours * 3_600_000;
}

/**
 * Match markets that appear to be the same question on both venues.
 * Greedy one-to-one on descending score; a pair qualifies on strong wording
 * overlap alone, or moderate overlap corroborated by a shared number or an
 * aligned resolution window. Clearly different close times veto a moderate
 * match. Only open, priced, non-combo markets participate.
 */
export function matchEquivalentMarkets(kalshi: MarketRow[], polymarket: MarketRow[]): EquivalentPair[] {
  // Kalshi reports tradable markets as "active" (its API filter calls the
  // same state "open"); Polymarket maps to "open" in mapPolymarket.
  const tradable = new Set(["open", "active"]);
  const ks = kalshi.filter((m) => tradable.has(m.status) && m.lastPrice !== null && m.title && !isAutoComboMarket(m));
  const ps = polymarket.filter((m) => tradable.has(m.status) && m.lastPrice !== null && m.title);
  const kTokens = ks.map((m) => significantTitleTokens(m.title));
  const pTokens = ps.map((m) => significantTitleTokens(m.title));

  const candidates: { i: number; j: number; score: number; similarity: number }[] = [];
  for (let i = 0; i < ks.length; i++) {
    if (kTokens[i].length < 2) continue;
    for (let j = 0; j < ps.length; j++) {
      if (pTokens[j].length < 2) continue;
      const similarity = tokenJaccard(kTokens[i], pTokens[j]);
      if (similarity < 0.5) continue;
      const pSet = new Set(pTokens[j]);
      // A bare year is shared by thousands of unrelated markets, so it never
      // corroborates ("Walz nominee 2028" is NOT "Walz wins 2028" — a live
      // false match this rule exists to kill). Distinctive figures (25 bps,
      // 150000) do.
      const sharedNumber = kTokens[i].some(
        (t) => /^\d/.test(t) && !/^(19|20)\d{2}$/.test(t) && pSet.has(t),
      );
      const aligned = closeTimesAligned(ks[i], ps[j]);
      if (aligned === false && similarity < 0.8) continue; // different windows: not the same question
      const qualifies = similarity >= 0.6 || (sharedNumber && aligned !== false);
      if (!qualifies) continue;
      candidates.push({
        i,
        j,
        similarity,
        score: similarity + (sharedNumber ? 0.1 : 0) + (aligned === true ? 0.05 : 0),
      });
    }
  }

  candidates.sort((a, b) => b.score - a.score);
  const usedK = new Set<number>();
  const usedP = new Set<number>();
  const pairs: EquivalentPair[] = [];
  for (const c of candidates) {
    if (usedK.has(c.i) || usedP.has(c.j)) continue;
    usedK.add(c.i);
    usedP.add(c.j);
    pairs.push({ kalshi: ks[c.i], polymarket: ps[c.j], similarity: c.similarity });
  }
  return pairs;
}

export interface CrossVenueSignal {
  pair: EquivalentPair;
  kind: "price_divergence" | "liquidity_concentration";
  priceGap: number;
  combinedVolume: number;
  dominantVenue: string | null;
  dominantShare: number;
}

/**
 * Editorial signals from matched pairs: a price gap of ≥5 points with real
 * combined volume (stale prices on dead markets are noise, not divergence),
 * or ≥85% of a meaningful combined volume sitting on one venue.
 */
export function crossVenueSignals(
  pairs: EquivalentPair[],
  opts: { minGap?: number; minVolumeForGap?: number; minVolumeForConcentration?: number; concentration?: number } = {},
): CrossVenueSignal[] {
  const minGap = opts.minGap ?? 0.05;
  const minVolumeForGap = opts.minVolumeForGap ?? 10_000;
  const minVolumeForConcentration = opts.minVolumeForConcentration ?? 25_000;
  const concentration = opts.concentration ?? 0.85;

  const signals: CrossVenueSignal[] = [];
  for (const pair of pairs) {
    const gap = Math.abs((pair.kalshi.lastPrice ?? 0) - (pair.polymarket.lastPrice ?? 0));
    const vk = pair.kalshi.volume24h ?? 0;
    const vp = pair.polymarket.volume24h ?? 0;
    const combined = vk + vp;
    const dominantShare = combined > 0 ? Math.max(vk, vp) / combined : 0;
    const dominantVenue = combined > 0 ? (vk >= vp ? "Kalshi" : "Polymarket") : null;
    if (gap >= minGap && combined >= minVolumeForGap) {
      signals.push({ pair, kind: "price_divergence", priceGap: gap, combinedVolume: combined, dominantVenue, dominantShare });
    } else if (combined >= minVolumeForConcentration && dominantShare >= concentration) {
      signals.push({ pair, kind: "liquidity_concentration", priceGap: gap, combinedVolume: combined, dominantVenue, dominantShare });
    }
  }
  return signals.sort((a, b) =>
    a.kind === b.kind ? (a.kind === "price_divergence" ? b.priceGap - a.priceGap : b.combinedVolume - a.combinedVolume) : a.kind === "price_divergence" ? -1 : 1,
  );
}

// one decimal below 10c so longshot prices don't render as a bogus "0c"
const cents = (p: number | null): string =>
  p === null ? "n/a" : p < 0.095 ? `${(p * 100).toFixed(1)}c` : `${Math.round(p * 100)}c`;

/**
 * Digest text for cross-venue signals. Lines parse through the market_site
 * segmenter ("Cross-venue … on Kalshi vs Polymarket: …") and both prices
 * come straight from the venues' own APIs, so claims land as primary-source.
 */
export function buildCrossVenueDigest(signals: CrossVenueSignal[], cap = 8): string {
  const lines: string[] = [];
  for (const s of signals.slice(0, cap)) {
    const k = s.pair.kalshi;
    const p = s.pair.polymarket;
    const sameTitle = k.title.trim().toLowerCase() === p.title.trim().toLowerCase();
    // The quoted titles (usually questions) get their own sentence so the
    // price/volume facts survive sentence splitting as clean claims; the
    // equivalence itself is the matcher's inference, so it stays hedged.
    const listing = sameTitle
      ? `The market "${k.title}" is listed on both venues (Kalshi ${k.marketId}, Polymarket ${p.marketId}).`
      : `Kalshi lists "${k.title}" (${k.marketId}) and Polymarket lists "${p.title}" (${p.marketId}); these appear to be the same question.`;
    if (s.kind === "price_divergence") {
      lines.push(
        `Cross-venue divergence on Kalshi vs Polymarket: ${listing} It trades at ${cents(k.lastPrice)} on Kalshi and ${cents(p.lastPrice)} on Polymarket, a ${Math.round(s.priceGap * 100)} point gap. 24h volume ${money(k.volume24h)} on Kalshi and ${money(p.volume24h)} on Polymarket.`,
      );
    } else {
      lines.push(
        `Cross-venue liquidity on Kalshi vs Polymarket: ${listing} ${Math.round(s.dominantShare * 100)}% of the ${money(s.combinedVolume)} combined 24h volume is on ${s.dominantVenue}. It trades at ${cents(k.lastPrice)} on Kalshi and ${cents(p.lastPrice)} on Polymarket.`,
      );
    }
  }
  if (signals.length > cap) {
    lines.push(`Plus ${signals.length - cap} further cross-venue signals not shown in this digest.`);
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
// gamma serves at most 100 rows per call regardless of limit; page by offset
const polymarketUrl = (offset: number) =>
  `https://gamma-api.polymarket.com/markets?limit=100&offset=${offset}&closed=false&order=volume24hr&ascending=false`;

// Kalshi's unordered listing is dominated by auto-generated same-day sports
// combos (live check 2026-07-20: 3,000 consecutive rows, all parlay legs),
// which never cross-list. The questions that DO trade on both venues are
// longer-dated, so the cross-venue matching pool adds a slice filtered to
// markets closing 5+ days out — a structural filter, not a hand-picked
// category list. That long-dated set is itself 12,000+ markets (live count
// 2026-07-20), far beyond a bounded fetch, so the pool ROTATES: the
// pagination cursor persists across runs and each collection reads the next
// two pages, wrapping at the end. Coverage converges over successive runs
// while every compared price stays fresh from the same run — matching
// against stale stored quotes would manufacture divergences.
const LONGDATED_CURSOR_KEY = "kalshi-longdated-cursor";
const LONGDATED_PAGES_PER_RUN = 4; // 4k rows/run -> full rotation in ~a week of daily runs

function kalshiLongDatedUrl(cursor: string): string {
  const ts = Math.floor(Date.now() / 1000) + 5 * 86400;
  return (
    `https://api.elections.kalshi.com/trade-api/v2/markets?limit=1000&status=open&min_close_ts=${ts}` +
    (cursor ? `&cursor=${encodeURIComponent(cursor)}` : "")
  );
}

/** Fetch the next rotation window of long-dated Kalshi markets and persist
 *  the advanced cursor. A stale/expired stored cursor falls back to the
 *  start of the listing rather than failing the run. */
async function fetchLongDatedKalshiWindow(): Promise<MarketRow[]> {
  let cursor = (await getCursor("markets", LONGDATED_CURSOR_KEY)) ?? "";
  const rows: MarketRow[] = [];
  for (let page = 0; page < LONGDATED_PAGES_PER_RUN; page++) {
    let json: { markets?: Record<string, unknown>[]; cursor?: string };
    try {
      json = await fetchJson(kalshiLongDatedUrl(cursor));
    } catch (err) {
      if (cursor) {
        // stored cursor may have expired server-side: restart the rotation
        cursor = "";
        json = await fetchJson(kalshiLongDatedUrl(""));
      } else {
        throw err;
      }
    }
    rows.push(...mapKalshi(json));
    cursor = json.cursor ?? "";
    if (!cursor) break; // listing exhausted: wrap to the start next run
  }
  await setCursor("markets", LONGDATED_CURSOR_KEY, cursor);
  return rows;
}

export function marketCollector(): Collector {
  return {
    name: "markets",
    description: "Kalshi + Polymarket listings snapshot: new listings, status changes, volume moves",
    available() {
      return { ok: true }; // public APIs, no credentials
    },
    async collect(): Promise<CollectorOutput[]> {
      const [kalshiJson, polyPage1, polyPage2] = await Promise.all([
        fetchJson<{ markets?: Record<string, unknown>[] }>(KALSHI_URL),
        fetchJson<Record<string, unknown>[]>(polymarketUrl(0)),
        fetchJson<Record<string, unknown>[]>(polymarketUrl(100)),
      ]);
      const kalshiRows = mapKalshi(kalshiJson);
      const polyRows = mapPolymarket([...polyPage1, ...polyPage2]);
      const current = [...kalshiRows, ...polyRows];
      const previous = await loadPreviousSnapshot(["kalshi", "polymarket"]);
      const isFirstRun = previous.lastCapturedAt === null;
      const diff = diffSnapshots(previous, current);
      await persistSnapshot(current);
      await pruneSnapshots();

      // Cross-venue comparison works on the CURRENT fetch (both venues come
      // back together), so it runs on every collection — baseline included.
      // The Kalshi side widens to this run's rotation window over the
      // long-dated listing, where cross-listed questions actually live; a
      // failure of that auxiliary fetch degrades coverage, never the run.
      let kalshiPool = kalshiRows;
      let poolNote = "";
      try {
        const longDated = await fetchLongDatedKalshiWindow();
        const seen = new Set(kalshiRows.map((m) => m.marketId));
        kalshiPool = [...kalshiRows, ...longDated.filter((m) => m.marketId && !seen.has(m.marketId))];
      } catch (err) {
        poolNote = `; long-dated Kalshi window unavailable (${err instanceof Error ? err.message : "fetch failed"}), matched against the primary slice only`;
      }
      const pairs = matchEquivalentMarkets(kalshiPool, polyRows);
      const signals = crossVenueSignals(pairs);
      const crossDigest = buildCrossVenueDigest(signals);
      const date = new Date().toISOString().slice(0, 10);
      const crossOutput: CollectorOutput | null = crossDigest.trim()
        ? {
            title: `Cross-venue market comparison, Kalshi vs Polymarket (${date})`,
            sourceType: "market_site",
            text: crossDigest,
            note: `${signals.length} signal(s) across ${pairs.length} matched market pair(s)${poolNote}`,
          }
        : null;

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
          ...(crossOutput ? [crossOutput] : []),
        ];
      }

      const digest = buildMarketDigest(diff);
      const outputs: CollectorOutput[] = [];
      if (digest.trim()) {
        outputs.push({
          title: `Market activity digest, Kalshi + Polymarket (${date})`,
          sourceType: "market_site",
          text: digest,
          note: `${diff.newListings.length} new, ${diff.statusChanges.length} status changes, ${diff.volumeMoves.length} volume moves`,
        });
      }
      if (crossOutput) outputs.push(crossOutput);
      return outputs;
    },
  };
}
