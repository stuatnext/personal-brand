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

const YT_CHANNELS = (process.env.SIGNAL_ROOM_YOUTUBE_CHANNELS ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

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
      const sections: string[] = [];
      let total = 0;
      for (const channelId of YT_CHANNELS) {
        const url = `https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`;
        const { feedTitle, items } = parseFeed(await fetchText(url));
        const cursor = await getCursor("youtube", channelId);
        const { fresh, nextCursor } = newItemsSince(items, cursor);
        if (nextCursor) await setCursor("youtube", channelId, nextCursor);
        total += fresh.length;
        sections.push(fresh.map((i) => formatVideo(i, feedTitle)).join("\n\n"));
      }
      const text = sections.filter(Boolean).join("\n\n");
      if (!text.trim() || total === 0) return [];
      const date = new Date().toISOString().slice(0, 10);
      return [
        {
          title: `YouTube sweep, ${YT_CHANNELS.length} channel(s) (${date})`,
          sourceType: "youtube",
          text,
          note: `${total} new video(s)`,
        },
      ];
    },
  };
}

const FEED_URLS = (process.env.SIGNAL_ROOM_FEEDS ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

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
      const sections: string[] = [];
      const failures: string[] = [];
      let total = 0;
      for (const feedUrl of FEED_URLS) {
        try {
          const { feedTitle, items } = parseFeed(await fetchText(feedUrl));
          const cursor = await getCursor("feeds", feedUrl);
          const { fresh, nextCursor } = newItemsSince(items, cursor);
          if (nextCursor) await setCursor("feeds", feedUrl, nextCursor);
          total += fresh.length;
          sections.push(fresh.map((i) => formatFeedItem(i, feedTitle)).join("\n\n"));
        } catch (err) {
          failures.push(`${feedUrl}: ${err instanceof Error ? err.message : err}`);
        }
      }
      if (failures.length === FEED_URLS.length && FEED_URLS.length > 0) {
        throw new Error(`all feeds failed (${failures.join("; ")})`);
      }
      const text = sections.filter(Boolean).join("\n\n");
      if (!text.trim() || total === 0) return [];
      const date = new Date().toISOString().slice(0, 10);
      return [
        {
          title: `Feed sweep, ${FEED_URLS.length} feed(s) (${date})`,
          sourceType: "news",
          text,
          note: `${total} new item(s)${failures.length ? `; ${failures.length} feed(s) failed` : ""}`,
        },
      ];
    },
  };
}
