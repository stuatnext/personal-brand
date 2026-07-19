// Interface-noise recognition. Noise is classified and KEPT (isNoise=true,
// noiseReason set), never discarded — the processing report's "items
// ignored" is a filter over these, and everything stays traceable to raw
// offsets.

const NAV_LINES = new Set(
  [
    "home",
    "my network",
    "jobs",
    "messaging",
    "notifications",
    "me",
    "for business",
    "advertise",
    "posts",
    "latest",
    "past week",
    "past month",
    "past 24 hours",
    "content type",
    "from member",
    "all filters",
    "reset",
    "sort by",
    "top",
    "recent",
    "most relevant",
    "most recent",
    "follow",
    "following",
    "connect",
    "subscribe",
    "subscribed",
    "like",
    "comment",
    "repost",
    "send",
    "share",
    "save",
    "reply",
    "translate",
    "see translation",
    "show more",
    "show more results",
    "load more comments",
    "add a comment…",
    "add a comment...",
    "open emoji keyboard",
    "current selected sort order is top",
    "feed post",
    "search",
    "skip to search",
    "skip to main content",
    "close jump menu",
    "new posts",
    "explore",
    "bookmarks",
    "communities",
    "premium",
    "profile",
    "more",
    "post",
    "for you",
    "trending",
    "who to follow",
    "what's happening",
    "show this thread",
    "show probable spam",
    "upvote",
    "downvote",
    "award",
    "report",
    "hot",
    "new",
    "rising",
    "join",
    "joined",
    "members",
    "online",
    "view image",
    "play video",
    "see more",
    "…more",
    "...more",
  ].map((s) => s.toLowerCase()),
);

const NAV_PATTERNS: RegExp[] = [
  /^\d+ notifications?$/i,
  /^\d+[\d,.]*\s*(followers?|connections|members|online)$/i,
  /^page \d+( of \d+)?$/i,
  /^activate to view larger image/i,
  /^\d+\s*\/\s*\d+$/, // image carousel indicator "1/5"
  /^(❤️|👍|💡|🎉|😂|🙌|✨)+\s*\d*$/u,
  /^skip to /i,
  /^accessibility /i,
  /^visit my website$/i,
  /^view profile$/i,
  /^view full profile$/i,
  /^status is (reachable|offline)$/i,
  /^premium\b.*member$/i,
  /^promoted$/i,
  /^sponsored$/i,
  /^suggested$/i,
  /^people you may know$/i,
  /^get the app$/i,
  /^sign (in|up)$/i,
  /^log in$/i,
  /^terms of service$/i,
  /^privacy policy$/i,
  /^cookie policy$/i,
  /^© ?20\d\d/i,
];

export function isNavLine(line: string): boolean {
  const t = line.trim().toLowerCase();
  if (!t) return true;
  if (NAV_LINES.has(t)) return true;
  // zero-width-space litter and lone punctuation
  if (/^[​‌‍﻿·•|—\-–\s]+$/u.test(line)) return true;
  return NAV_PATTERNS.some((p) => p.test(line.trim()));
}

const AD_MARKERS = [/^promoted$/im, /^sponsored$/im, /\bad\s*·/i];

export function looksLikeAd(blockText: string): boolean {
  return AD_MARKERS.some((p) => p.test(blockText));
}

/** Promotional/affiliate content heuristics (kept as content, but scored down). */
const PROMO_PATTERNS: RegExp[] = [
  /\b(use|with)\s+(my|our|the)?\s*(promo|referral|bonus)\s*code\b/i,
  /\bsign.?up bonus\b/i,
  /\bdeposit match\b/i,
  /\baffiliate (link|program)\b/i,
  /\b(airdrops?|presale|pre-sale|whitelist)\b/i,
  /\b(100|1000)x\b/i,
  /\bto the moon\b/i,
  /\bDM (me|us) (for|to)\b/i,
  /\bpm me\b/i,
  /\blet'?s talk\b.*\bcatalogue\b/i,
  /\blink in (bio|comments?)\b/i,
  /\bjoin (my|our) (telegram|discord)\b/i,
  /\bguaranteed (profit|returns?|win)\b/i,
  /\bfree money\b/i,
];

export function promoScore(text: string): number {
  let hits = 0;
  for (const p of PROMO_PATTERNS) if (p.test(text)) hits += 1;
  const hashtags = (text.match(/#\w+/g) || []).length;
  if (hashtags >= 5) hits += 1;
  const emoji = (text.match(/[\u{1F300}-\u{1FAFF}☀-➿]/gu) || []).length;
  if (emoji >= 8) hits += 1;
  return Math.min(1, hits / 3);
}

/** Screenshot-of-profits / unverifiable-brag heuristics. */
export function looksLikeProfitBrag(text: string): boolean {
  return (
    /\b(turned|flipped)\s+\$?\d/i.test(text) ||
    (/\bprofit\b/i.test(text) && /\$\d/.test(text) && /\b(screenshot|proof|receipts)\b/i.test(text))
  );
}
