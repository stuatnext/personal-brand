import type { Collector, CollectorOutput } from "./types";
import { getCursor, setCursor } from "./cursors";

// Feed collectors: YouTube channel RSS (keyless) and generic RSS/Atom
// (newsletters, blogs, regulator press pages). Feeds vary wildly in
// strictness, so parsing is deliberately tolerant text extraction rather
// than a full XML parser; every parsed item keeps its link for provenance.
// A persisted cursor per feed means repeated runs only ingest new items.

export interface FeedItem {
  title: string;
  link: string;
  publishedAt: string | null; // ISO
  summary: string;
  id: string;
}

const strip = (s: string): string =>
  s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();

function tag(block: string, names: string[]): string | null {
  for (const name of names) {
    const m = block.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, "i"));
    if (m) return strip(m[1]);
  }
  return null;
}

function atomLink(block: string): string | null {
  const alt = block.match(/<link[^>]*rel=["']alternate["'][^>]*href=["']([^"']+)["']/i);
  if (alt) return alt[1];
  const any = block.match(/<link[^>]*href=["']([^"']+)["']/i);
  return any ? any[1] : null;
}

function toIso(dateText: string | null): string | null {
  if (!dateText) return null;
  const d = new Date(dateText);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** Parse RSS 2.0 <item> or Atom <entry> blocks out of a feed document. */
export function parseFeed(xml: string): { feedTitle: string; items: FeedItem[] } {
  const channelHead = xml.split(/<item[\s>]/i)[0].split(/<entry[\s>]/i)[0];
  const feedTitle = tag(channelHead, ["title"]) ?? "feed";
  const blocks = [
    ...xml.matchAll(/<item[\s>][\s\S]*?<\/item>/gi),
    ...xml.matchAll(/<entry[\s>][\s\S]*?<\/entry>/gi),
  ].map((m) => m[0]);
  const items: FeedItem[] = [];
  for (const block of blocks) {
    const title = tag(block, ["title"]);
    if (!title) continue;
    const link = tag(block, ["link"])?.startsWith("http")
      ? (tag(block, ["link"]) as string)
      : (atomLink(block) ?? "");
    const publishedAt = toIso(tag(block, ["pubDate", "published", "updated", "dc:date"]));
    const summary = (tag(block, ["description", "summary", "media:description", "content"]) ?? "").slice(0, 600);
    const id = tag(block, ["guid", "id", "yt:videoId"]) ?? link ?? title;
    items.push({ title, link, publishedAt, summary, id });
  }
  return { feedTitle, items };
}

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: { "user-agent": "signal-room/0.1 (private research tool)", accept: "application/rss+xml, application/atom+xml, application/xml, text/xml, */*" },
  });
  if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
  return await res.text();
}

/** Items newer than the cursor, oldest first, with the new cursor value. */
export function newItemsSince(items: FeedItem[], cursorIso: string | null): { fresh: FeedItem[]; nextCursor: string | null } {
  const dated = items.filter((i) => i.publishedAt);
  const cutoff = cursorIso ? new Date(cursorIso).getTime() : 0;
  const fresh = dated
    .filter((i) => new Date(i.publishedAt!).getTime() > cutoff)
    .sort((a, b) => a.publishedAt!.localeCompare(b.publishedAt!));
  const newest = dated.length
    ? dated.reduce((max, i) => (i.publishedAt! > max ? i.publishedAt! : max), dated[0].publishedAt!)
    : cursorIso;
  return { fresh, nextCursor: newest ?? cursorIso };
}

/** Block format the news segmenter parses: headline / source / ISO date /
 *  summary / link. */
export function formatFeedItem(item: FeedItem, sourceName: string): string {
  const lines = [item.title, sourceName];
  if (item.publishedAt) lines.push(item.publishedAt.slice(0, 10));
  if (item.summary) lines.push(item.summary);
  if (item.link) lines.push(item.link);
  return lines.join("\n");
}

/** Block format the youtube segmenter parses. */
export function formatVideo(item: FeedItem, channel: string): string {
  const lines = [`New video from ${channel}: "${item.title}"`];
  if (item.publishedAt) lines.push(item.publishedAt.slice(0, 10));
  if (item.summary) lines.push(item.summary.slice(0, 400));
  if (item.link) lines.push(item.link);
  return lines.join("\n");
}

/** Parse a comma list of sources with optional "pillar:" prefixes, e.g.
 *  "igaming:https://feed…, https://feed2" (no prefix = prediction_markets).
 *  Pillar keys never collide with URL schemes, so plain URLs parse as-is. */
export function parsePillarSources(raw: string | undefined): { source: string; pillar: string }[] {
  return (raw ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((entry) => {
      const m = entry.match(/^(prediction_markets|igaming|strait_up_growth):(.+)$/);
      return m ? { pillar: m[1], source: m[2].trim() } : { pillar: "prediction_markets", source: entry };
    });
}

const YT_CHANNELS = parsePillarSources(process.env.SIGNAL_ROOM_YOUTUBE_CHANNELS);

export function youtubeCollector(): Collector {
  return {
    name: "youtube",
    description: "New videos from configured channels via YouTube's keyless RSS feeds",
    available() {
      return YT_CHANNELS.length
        ? { ok: true }
        : { ok: false, reason: "set SIGNAL_ROOM_YOUTUBE_CHANNELS to a comma list of channel IDs" };
    },
    async collect(): Promise<CollectorOutput[]> {
      // one output per pillar so each drop lands in its own lane
      const byPillar = new Map<string, { sections: string[]; total: number; channels: number }>();
      for (const { source: channelId, pillar } of YT_CHANNELS) {
        const url = `https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`;
        const { feedTitle, items } = parseFeed(await fetchText(url));
        const cursor = await getCursor("youtube", channelId);
        const { fresh, nextCursor } = newItemsSince(items, cursor);
        if (nextCursor) await setCursor("youtube", channelId, nextCursor);
        const bucket = byPillar.get(pillar) ?? { sections: [], total: 0, channels: 0 };
        bucket.total += fresh.length;
        bucket.channels += 1;
        bucket.sections.push(fresh.map((i) => formatVideo(i, feedTitle)).join("\n\n"));
        byPillar.set(pillar, bucket);
      }
      const date = new Date().toISOString().slice(0, 10);
      const outputs: CollectorOutput[] = [];
      for (const [pillar, bucket] of byPillar) {
        const text = bucket.sections.filter(Boolean).join("\n\n");
        if (!text.trim() || bucket.total === 0) continue;
        outputs.push({
          title: `YouTube sweep, ${bucket.channels} channel(s) (${date})`,
          sourceType: "youtube",
          pillar,
          text,
          note: `${bucket.total} new video(s)`,
        });
      }
      return outputs;
    },
  };
}

const FEED_URLS = parsePillarSources(process.env.SIGNAL_ROOM_FEEDS);

export function rssCollector(): Collector {
  return {
    name: "feeds",
    description: "New items from configured RSS/Atom feeds (newsletters, blogs, regulator pages)",
    available() {
      return FEED_URLS.length
        ? { ok: true }
        : { ok: false, reason: "set SIGNAL_ROOM_FEEDS to a comma list of RSS/Atom URLs" };
    },
    async collect(): Promise<CollectorOutput[]> {
      const byPillar = new Map<string, { sections: string[]; total: number; feeds: number }>();
      const failures: string[] = [];
      for (const { source: feedUrl, pillar } of FEED_URLS) {
        try {
          const { feedTitle, items } = parseFeed(await fetchText(feedUrl));
          const cursor = await getCursor("feeds", feedUrl);
          const { fresh, nextCursor } = newItemsSince(items, cursor);
          if (nextCursor) await setCursor("feeds", feedUrl, nextCursor);
          const bucket = byPillar.get(pillar) ?? { sections: [], total: 0, feeds: 0 };
          bucket.total += fresh.length;
          bucket.feeds += 1;
          bucket.sections.push(fresh.map((i) => formatFeedItem(i, feedTitle)).join("\n\n"));
          byPillar.set(pillar, bucket);
        } catch (err) {
          failures.push(`${feedUrl}: ${err instanceof Error ? err.message : err}`);
        }
      }
      if (failures.length === FEED_URLS.length && FEED_URLS.length > 0) {
        throw new Error(`all feeds failed (${failures.join("; ")})`);
      }
      const date = new Date().toISOString().slice(0, 10);
      const outputs: CollectorOutput[] = [];
      for (const [pillar, bucket] of byPillar) {
        const text = bucket.sections.filter(Boolean).join("\n\n");
        if (!text.trim() || bucket.total === 0) continue;
        outputs.push({
          title: `Feed sweep, ${bucket.feeds} feed(s) (${date})`,
          sourceType: "news",
          pillar,
          text,
          note: `${bucket.total} new item(s)${failures.length ? `; ${failures.length} feed(s) failed` : ""}`,
        });
      }
      return outputs;
    },
  };
}
