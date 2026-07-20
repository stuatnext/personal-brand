import type { Collector, CollectorOutput } from "./types";

// Social collectors. Both format their output into the same select-all
// text shapes the platform segmenters already parse, so collected and
// hand-pasted material flows through identical extraction. Reddit's public
// JSON endpoints need no credentials; X requires X_BEARER_TOKEN.

const REDDIT_SUBS = (process.env.SIGNAL_ROOM_REDDIT_SUBS ?? "PredictionMarkets,Kalshi,Polymarket")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const X_QUERY =
  process.env.SIGNAL_ROOM_X_QUERY ??
  '("prediction markets" OR "event contracts" OR kalshi OR polymarket) -is:retweet lang:en';

interface RedditChild {
  data: {
    title?: string;
    selftext?: string;
    author?: string;
    subreddit_name_prefixed?: string;
    ups?: number;
    num_comments?: number;
    created_utc?: number;
    permalink?: string;
    stickied?: boolean;
  };
}

function hoursAgo(createdUtc?: number): string {
  if (!createdUtc) return "";
  const h = Math.max(1, Math.round((Date.now() / 1000 - createdUtc) / 3600));
  return h < 24 ? `${h}h` : `${Math.round(h / 24)}d`;
}

/** Format one reddit post the way the reddit segmenter expects. */
export function formatRedditPost(c: RedditChild["data"]): string {
  const lines = [
    c.subreddit_name_prefixed ?? "r/unknown",
    `Posted by u/${c.author ?? "unknown"} ${hoursAgo(c.created_utc)}`,
    c.title ?? "",
  ];
  if (c.selftext?.trim()) lines.push(c.selftext.trim());
  lines.push(`${c.ups ?? 0} upvotes`);
  lines.push(`${c.num_comments ?? 0} comments`);
  if (c.permalink) lines.push(`https://www.reddit.com${c.permalink}`);
  return lines.join("\n");
}

export function redditCollector(): Collector {
  return {
    name: "reddit",
    description: `New posts from r/${REDDIT_SUBS.join(", r/")} via the public JSON API`,
    available() {
      return { ok: true }; // public endpoints; a UA header is good manners
    },
    async collect(): Promise<CollectorOutput[]> {
      const sections: string[] = [];
      const failures: string[] = [];
      let total = 0;
      for (const sub of REDDIT_SUBS) {
        const url = `https://www.reddit.com/r/${sub}/new.json?limit=15`;
        const res = await fetch(url, {
          headers: { "user-agent": "signal-room/0.1 (private research tool)" },
        });
        if (!res.ok) {
          failures.push(`r/${sub}: HTTP ${res.status}`);
          continue;
        }
        const json = (await res.json()) as { data?: { children?: RedditChild[] } };
        const posts = (json.data?.children ?? []).filter((c) => !c.data.stickied);
        total += posts.length;
        sections.push(posts.map((c) => formatRedditPost(c.data)).join("\n\n"));
      }
      if (failures.length === REDDIT_SUBS.length) {
        // Every endpoint refused (reddit blocks many datacenter IPs): say so
        // loudly instead of pretending the feeds were quiet.
        throw new Error(
          `all subreddit fetches failed (${failures.join("; ")}). Reddit often blocks datacenter IPs; run from a residential network or add OAuth credentials later.`,
        );
      }
      const text = sections.filter(Boolean).join("\n\n");
      if (!text.trim() || total === 0) return [];
      const date = new Date().toISOString().slice(0, 10);
      return [
        {
          title: `Reddit sweep, r/${REDDIT_SUBS.join(" r/")} (${date})`,
          sourceType: "reddit",
          text,
          note: `${total} posts across ${REDDIT_SUBS.length} subreddits`,
        },
      ];
    },
  };
}

interface XTweet {
  id: string;
  text: string;
  created_at?: string;
  author_id?: string;
  public_metrics?: { reply_count?: number; retweet_count?: number; like_count?: number; impression_count?: number };
}
interface XUser {
  id: string;
  name: string;
  username: string;
}

/** Format one tweet the way the X segmenter expects. */
export function formatTweet(t: XTweet, user: XUser | undefined): string {
  const m = t.public_metrics ?? {};
  const age = t.created_at
    ? `${Math.max(1, Math.round((Date.now() - new Date(t.created_at).getTime()) / 3_600_000))}h`
    : "1h";
  return [
    user?.name ?? "Unknown",
    `@${user?.username ?? "unknown"}`,
    "·",
    age,
    t.text,
    String(m.reply_count ?? 0),
    String(m.retweet_count ?? 0),
    String(m.like_count ?? 0),
    String(m.impression_count ?? 0),
    "Views",
  ].join("\n");
}

export function xCollector(): Collector {
  return {
    name: "x",
    description: "Recent search via the X API v2 (requires X_BEARER_TOKEN)",
    available() {
      return process.env.X_BEARER_TOKEN
        ? { ok: true }
        : { ok: false, reason: "X_BEARER_TOKEN is not set; the X collector needs an API bearer token" };
    },
    async collect(): Promise<CollectorOutput[]> {
      const token = process.env.X_BEARER_TOKEN;
      if (!token) throw new Error("X_BEARER_TOKEN is not set");
      const url = new URL("https://api.x.com/2/tweets/search/recent");
      url.searchParams.set("query", X_QUERY);
      url.searchParams.set("max_results", "50");
      url.searchParams.set("tweet.fields", "created_at,public_metrics,author_id");
      url.searchParams.set("expansions", "author_id");
      url.searchParams.set("user.fields", "name,username");
      const res = await fetch(url, { headers: { authorization: `Bearer ${token}` } });
      if (!res.ok) throw new Error(`X API HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
      const json = (await res.json()) as { data?: XTweet[]; includes?: { users?: XUser[] } };
      const tweets = json.data ?? [];
      if (tweets.length === 0) return [];
      const users = new Map((json.includes?.users ?? []).map((u) => [u.id, u]));
      const text = tweets.map((t) => formatTweet(t, users.get(t.author_id ?? ""))).join("\n\n");
      const date = new Date().toISOString().slice(0, 10);
      return [
        {
          title: `X sweep, category search (${date})`,
          sourceType: "x",
          text,
          note: `${tweets.length} tweets`,
        },
      ];
    },
  };
}
