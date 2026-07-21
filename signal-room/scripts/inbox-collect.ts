/* Scheduled, database-free collection: gather fresh source material and
 * write it into git as dated drop files, so an ephemeral runner (GitHub
 * Actions) can collect daily while the real database stays on Stuart's
 * machine. His local Signal Room ingests the committed drops with
 * `npm run ingest:inbox` (sha-deduped, so re-runs are safe).
 *
 * State the collectors need across runs (feed cursors, the market snapshot
 * for diffing, the Kalshi long-dated rotation cursor, cross-venue pair
 * history) lives in a committed JSON file, NOT the database — this script
 * never touches PGlite.
 *
 *   npx tsx scripts/inbox-collect.ts            # collect into inbox/drops
 *   npx tsx scripts/inbox-collect.ts --dry-run  # print, write nothing
 */
import fs from "fs";
import path from "path";
import crypto from "crypto";
import {
  KALSHI_URL,
  polymarketUrl,
  kalshiLongDatedUrl,
  mapKalshi,
  mapPolymarket,
  diffSnapshots,
  buildMarketDigest,
  matchEquivalentMarkets,
  crossVenueSignals,
  buildCrossVenueDigest,
  observationFor,
  MAX_PAIR_OBSERVATIONS,
  type MarketRow,
  type PreviousSnapshot,
} from "../src/lib/collectors/markets";
import { parseFeed, newItemsSince, formatFeedItem, formatVideo } from "../src/lib/collectors/feeds";
import type { CrossVenueObservation } from "../src/lib/db/schema";

const ROOT = process.cwd();
const INBOX_ROOT = process.env.SIGNAL_ROOM_INBOX_DIR ?? path.join(ROOT, "inbox");
const DROPS_DIR = path.join(INBOX_ROOT, "drops");
const STATE_PATH = path.join(INBOX_ROOT, "state", "collect-state.json");
const CONFIG_PATH = path.join(ROOT, "config", "feeds.json");
const DRY = process.argv.includes("--dry-run");
const LONGDATED_PAGES = 4;

interface SlimRow {
  venue: string;
  marketId: string;
  title: string;
  status: string;
  volume24h: number | null;
  lastPrice: number | null;
  closeTime: string | null;
}

interface StoredPair {
  kalshiMarketId: string;
  polymarketMarketId: string;
  kalshiTitle: string;
  polymarketTitle: string;
  similarity: number;
  observations: CrossVenueObservation[];
  firstSeenAt: string;
  lastSeenAt: string;
}

interface CollectState {
  cursors: Record<string, string>;
  market: { capturedAt: string | null; rows: SlimRow[] };
  pairs: StoredPair[];
}

interface FeedConfig {
  feeds: { url: string; pillar: string; note?: string }[];
  youtubeChannels: { id: string; pillar: string; note?: string }[];
}

interface Drop {
  title: string;
  sourceType: string;
  pillar: string;
  text: string;
  note?: string;
  capturedAt: string;
  sha256: string;
}

const sha256 = (s: string) => crypto.createHash("sha256").update(s, "utf8").digest("hex");

function loadState(): CollectState {
  try {
    return JSON.parse(fs.readFileSync(STATE_PATH, "utf8")) as CollectState;
  } catch {
    return { cursors: {}, market: { capturedAt: null, rows: [] }, pairs: [] };
  }
}

function loadConfig(): FeedConfig {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8")) as FeedConfig;
  } catch {
    return { feeds: [], youtubeChannels: [] };
  }
}

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: { accept: "application/rss+xml, application/atom+xml, application/xml, text/xml, */*" },
    redirect: "follow",
  });
  if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
  return res.text();
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
  return (await res.json()) as T;
}

function writeDrop(drop: Drop, slug: string): boolean {
  if (DRY) {
    console.log(`[dry-run] drop ${slug}: "${drop.title}" (${drop.text.length} chars)`);
    return false;
  }
  fs.mkdirSync(DROPS_DIR, { recursive: true });
  // idempotent same-day reruns: identical content never lands twice
  for (const existing of fs.readdirSync(DROPS_DIR)) {
    if (!existing.endsWith(".json")) continue;
    try {
      const prior = JSON.parse(fs.readFileSync(path.join(DROPS_DIR, existing), "utf8")) as Drop;
      if (prior.sha256 === drop.sha256) {
        console.log(`[inbox] unchanged, already dropped: ${existing}`);
        return false;
      }
    } catch {
      /* unreadable prior drop never blocks a new one */
    }
  }
  const file = path.join(DROPS_DIR, `${slug}.json`);
  fs.writeFileSync(file, JSON.stringify(drop, null, 2));
  console.log(`[inbox] wrote ${path.relative(ROOT, file)} (${drop.text.length} chars)`);
  return true;
}

async function collectFeeds(cfg: FeedConfig, state: CollectState, date: string): Promise<number> {
  const byPillar = new Map<string, { sections: string[]; total: number; feeds: number }>();
  const failures: string[] = [];
  for (const { url, pillar } of cfg.feeds) {
    try {
      const { feedTitle, items } = parseFeed(await fetchText(url));
      const { fresh, nextCursor } = newItemsSince(items, state.cursors[`feeds:${url}`] ?? null);
      if (nextCursor && !DRY) state.cursors[`feeds:${url}`] = nextCursor;
      const bucket = byPillar.get(pillar) ?? { sections: [], total: 0, feeds: 0 };
      bucket.total += fresh.length;
      bucket.feeds += 1;
      bucket.sections.push(fresh.map((i) => formatFeedItem(i, feedTitle)).join("\n\n"));
      byPillar.set(pillar, bucket);
    } catch (err) {
      failures.push(`${url}: ${err instanceof Error ? err.message : err}`);
    }
  }
  for (const f of failures) console.error(`[inbox] feed failed: ${f}`);
  let written = 0;
  for (const [pillar, bucket] of byPillar) {
    const text = bucket.sections.filter(Boolean).join("\n\n");
    if (!text.trim() || bucket.total === 0) continue;
    const drop: Drop = {
      title: `Feed sweep, ${bucket.feeds} feed(s) (${date})`,
      sourceType: "news",
      pillar,
      text,
      note: `${bucket.total} new item(s)${failures.length ? `; ${failures.length} feed(s) failed` : ""}`,
      capturedAt: new Date().toISOString(),
      sha256: sha256(text),
    };
    if (writeDrop(drop, `${date}-feeds-${pillar}`)) written += 1;
  }
  return written;
}

async function collectYoutube(cfg: FeedConfig, state: CollectState, date: string): Promise<number> {
  const byPillar = new Map<string, { sections: string[]; total: number; channels: number }>();
  for (const { id, pillar } of cfg.youtubeChannels) {
    try {
      const { feedTitle, items } = parseFeed(
        await fetchText(`https://www.youtube.com/feeds/videos.xml?channel_id=${id}`),
      );
      const { fresh, nextCursor } = newItemsSince(items, state.cursors[`youtube:${id}`] ?? null);
      if (nextCursor && !DRY) state.cursors[`youtube:${id}`] = nextCursor;
      const bucket = byPillar.get(pillar) ?? { sections: [], total: 0, channels: 0 };
      bucket.total += fresh.length;
      bucket.channels += 1;
      bucket.sections.push(fresh.map((i) => formatVideo(i, feedTitle)).join("\n\n"));
      byPillar.set(pillar, bucket);
    } catch (err) {
      console.error(`[inbox] youtube channel ${id} failed: ${err instanceof Error ? err.message : err}`);
    }
  }
  let written = 0;
  for (const [pillar, bucket] of byPillar) {
    const text = bucket.sections.filter(Boolean).join("\n\n");
    if (!text.trim() || bucket.total === 0) continue;
    const drop: Drop = {
      title: `YouTube sweep, ${bucket.channels} channel(s) (${date})`,
      sourceType: "youtube",
      pillar,
      text,
      note: `${bucket.total} new video(s)`,
      capturedAt: new Date().toISOString(),
      sha256: sha256(text),
    };
    if (writeDrop(drop, `${date}-youtube-${pillar}`)) written += 1;
  }
  return written;
}

function toPreviousSnapshot(state: CollectState): PreviousSnapshot {
  const byKey = new Map<string, MarketRow>();
  for (const r of state.market.rows) {
    byKey.set(`${r.venue}:${r.marketId}`, {
      venue: r.venue,
      marketId: r.marketId,
      title: r.title,
      status: r.status,
      volume24h: r.volume24h,
      liquidity: null,
      lastPrice: r.lastPrice,
      closeTime: r.closeTime,
      openTime: null,
      raw: {},
    });
  }
  return { byKey, lastCapturedAt: state.market.capturedAt ? new Date(state.market.capturedAt) : null };
}

function updatePairHistory(state: CollectState, pairs: ReturnType<typeof matchEquivalentMarkets>, at: Date): void {
  for (const pair of pairs) {
    if (!pair.kalshi.marketId || !pair.polymarket.marketId) continue;
    const obs = observationFor(pair, at);
    const existing = state.pairs.find(
      (p) => p.kalshiMarketId === pair.kalshi.marketId && p.polymarketMarketId === pair.polymarket.marketId,
    );
    if (existing) {
      existing.kalshiTitle = pair.kalshi.title;
      existing.polymarketTitle = pair.polymarket.title;
      existing.similarity = pair.similarity;
      existing.observations = [...existing.observations, obs].slice(-MAX_PAIR_OBSERVATIONS);
      existing.lastSeenAt = at.toISOString();
    } else {
      state.pairs.push({
        kalshiMarketId: pair.kalshi.marketId,
        polymarketMarketId: pair.polymarket.marketId,
        kalshiTitle: pair.kalshi.title,
        polymarketTitle: pair.polymarket.title,
        similarity: pair.similarity,
        observations: [obs],
        firstSeenAt: at.toISOString(),
        lastSeenAt: at.toISOString(),
      });
    }
  }
  // prune pairs unseen for 45 days and cap the list, newest last-seen kept
  const cutoff = Date.now() - 45 * 24 * 3600 * 1000;
  state.pairs = state.pairs
    .filter((p) => new Date(p.lastSeenAt).getTime() >= cutoff)
    .sort((a, b) => a.lastSeenAt.localeCompare(b.lastSeenAt))
    .slice(-500);
}

async function collectMarkets(state: CollectState, date: string): Promise<number> {
  const [kalshiJson, poly1, poly2] = await Promise.all([
    fetchJson<{ markets?: Record<string, unknown>[] }>(KALSHI_URL),
    fetchJson<Record<string, unknown>[]>(polymarketUrl(0)),
    fetchJson<Record<string, unknown>[]>(polymarketUrl(100)),
  ]);
  const kalshiRows = mapKalshi(kalshiJson);
  const polyRows = mapPolymarket([...poly1, ...poly2]);
  const current = [...kalshiRows, ...polyRows];
  const previous = toPreviousSnapshot(state);
  const isFirstRun = previous.lastCapturedAt === null;
  const diff = diffSnapshots(previous, current);

  // rotating long-dated window for the cross-venue matching pool
  let kalshiPool = kalshiRows;
  let poolNote = "";
  try {
    let cursor = state.cursors["markets:longdated"] ?? "";
    const longRows: MarketRow[] = [];
    for (let page = 0; page < LONGDATED_PAGES; page++) {
      let json: { markets?: Record<string, unknown>[]; cursor?: string };
      try {
        json = await fetchJson(kalshiLongDatedUrl(cursor));
      } catch (err) {
        if (cursor) {
          cursor = "";
          json = await fetchJson(kalshiLongDatedUrl(""));
        } else {
          throw err;
        }
      }
      longRows.push(...mapKalshi(json));
      cursor = json.cursor ?? "";
      if (!cursor) break;
    }
    if (!DRY) state.cursors["markets:longdated"] = cursor;
    const seen = new Set(kalshiRows.map((m) => m.marketId));
    kalshiPool = [...kalshiRows, ...longRows.filter((m) => m.marketId && !seen.has(m.marketId))];
  } catch (err) {
    poolNote = `; long-dated Kalshi window unavailable (${err instanceof Error ? err.message : "fetch failed"})`;
  }

  const at = new Date();
  const pairs = matchEquivalentMarkets(kalshiPool, polyRows);
  updatePairHistory(state, pairs, at);
  const signals = crossVenueSignals(pairs);
  const crossDigest = buildCrossVenueDigest(signals);

  if (!DRY) {
    state.market = {
      capturedAt: at.toISOString(),
      rows: current
        .filter((m) => m.marketId)
        .map((m) => ({
          venue: m.venue,
          marketId: m.marketId,
          title: m.title,
          status: m.status,
          volume24h: m.volume24h,
          lastPrice: m.lastPrice,
          closeTime: m.closeTime,
        })),
    };
  }

  let written = 0;
  if (isFirstRun) {
    const text = `Baseline snapshot on Kalshi and Polymarket: ${current.length} open listings recorded. Diffs against this baseline start with the next collection run.`;
    if (
      writeDrop(
        {
          title: `Market baseline captured (${current.length} listings)`,
          sourceType: "market_site",
          pillar: "prediction_markets",
          text,
          note: "baseline only, no diff emitted",
          capturedAt: at.toISOString(),
          sha256: sha256(text),
        },
        `${date}-markets-baseline`,
      )
    )
      written += 1;
  } else {
    const digest = buildMarketDigest(diff);
    if (digest.trim()) {
      if (
        writeDrop(
          {
            title: `Market activity digest, Kalshi + Polymarket (${date})`,
            sourceType: "market_site",
            pillar: "prediction_markets",
            text: digest,
            note: `${diff.newListings.length} new, ${diff.statusChanges.length} status changes, ${diff.volumeMoves.length} volume moves`,
            capturedAt: at.toISOString(),
            sha256: sha256(digest),
          },
          `${date}-markets-digest`,
        )
      )
        written += 1;
    }
  }
  if (crossDigest.trim()) {
    if (
      writeDrop(
        {
          title: `Cross-venue market comparison, Kalshi vs Polymarket (${date})`,
          sourceType: "market_site",
          pillar: "prediction_markets",
          text: crossDigest,
          note: `${signals.length} signal(s) across ${pairs.length} matched market pair(s)${poolNote}`,
          capturedAt: at.toISOString(),
          sha256: sha256(crossDigest),
        },
        `${date}-markets-crossvenue`,
      )
    )
      written += 1;
  }
  return written;
}

async function main() {
  const date = new Date().toISOString().slice(0, 10);
  const state = loadState();
  const cfg = loadConfig();
  console.log(
    `[inbox] collecting for ${date}: ${cfg.feeds.length} feed(s), ${cfg.youtubeChannels.length} channel(s), markets${DRY ? " (dry run)" : ""}`,
  );

  const results = await Promise.allSettled([
    collectFeeds(cfg, state, date),
    collectYoutube(cfg, state, date),
    collectMarkets(state, date),
  ]);
  const written = results.reduce((s, r) => s + (r.status === "fulfilled" ? r.value : 0), 0);
  const failures = results.filter((r) => r.status === "rejected");
  for (const f of failures) {
    console.error(`[inbox] collector failed: ${(f as PromiseRejectedResult).reason}`);
  }

  if (!DRY) {
    fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true });
    fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
  }
  console.log(`[inbox] done: ${written} drop(s) written, ${failures.length} collector failure(s)`);
  // every collector failing means the run produced nothing: fail loudly
  if (failures.length === results.length) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
