import type { ExtractedItem, DeclaredSource } from "./types";
import type { ItemType } from "@/lib/db/schema";
import { isNavLine, looksLikeAd } from "./noise";

// ---------------------------------------------------------------------------
// Deterministic, platform-aware segmentation of select-all page dumps.
// Works on the full raw text with exact offsets. This is the extraction
// backbone; the LLM layer refines classification per chunk when a real
// provider is configured, but never replaces offset-preserving segmentation.
// ---------------------------------------------------------------------------

interface Line {
  text: string;
  start: number; // offset of first char
  end: number; // offset AFTER last char (excludes newline)
}

function toLines(raw: string): Line[] {
  // Captures often carry Windows line endings; strip the trailing \r from
  // the matchable text while keeping offsets valid for the raw string.
  const lines: Line[] = [];
  let offset = 0;
  for (const part of raw.split("\n")) {
    const hasCr = part.endsWith("\r");
    const text = hasCr ? part.slice(0, -1) : part;
    lines.push({ text, start: offset, end: offset + text.length });
    offset += part.length + 1;
  }
  return lines;
}

let tempCounter = 0;
function nextTempId(): string {
  tempCounter += 1;
  return `item-${tempCounter.toString(36)}-${Math.abs(hashCode(String(tempCounter))) % 9973}`;
}
function hashCode(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return h;
}

export function extractHashtags(text: string): string[] {
  return [...new Set((text.match(/#([A-Za-z][\w]{1,40})/g) || []).map((h) => h.slice(1).toLowerCase()))];
}

export function extractUrls(text: string): string[] {
  const full = text.match(/https?:\/\/[^\s)\]}"']+/g) || [];
  return [...new Set(full)];
}

const BARE_DOMAIN = /^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}(\/\S*)?$/i;

// --- LinkedIn ---------------------------------------------------------------

const LI_FEED_POST = /^feed post( number \d+)?$/i;
const LI_PROFILE = /^view (?:(.+?)['’]s profile(?:,.*)?|profile for (.+?))$/i;
const LI_COMPANY = /^view (?:company|organization|organisation|page):?\s*(.+)$/i;
const LI_DEGREE = /^\s*(?:•\s*)?(?:1st|2nd|3rd\+?|premium|out of network|following|verified)\s*$/i;
const LI_TIMESTAMP = /^(now|\d+\s?(?:m|h|d|w|mo|y)|yesterday)\s*•?\s*(edited)?\s*•?\s*$/i;
const LI_REPOSTED = /^(.+?) reposted this\s*$/i;
const LI_BODY_END = [
  /^view image$/i,
  /^play video$/i,
  /^activate to view larger image/i,
  /^\d[\d,.]*$/,
  /^\d[\d,.]*\s+comments?$/i,
  /^\d[\d,.]*\s+reposts?$/i,
  /^\d[\d,.]*\s+reactions?$/i,
  /^like$/i,
  /^comment$/i,
  /^repost$/i,
  /^send$/i,
  /^share$/i,
  /^\d+\s*\/\s*\d+$/,
  /^see translation$/i,
  /^…more$|^\.\.\.more$/i,
  /^show more$/i,
  /^load more comments$/i,
  /^most relevant$/i,
];

function isBodyEnd(line: string): boolean {
  const t = line.trim();
  return LI_BODY_END.some((p) => p.test(t));
}

function parseEngagementLines(lines: Line[], from: number, to: number): Record<string, number | string> {
  const engagement: Record<string, number | string> = {};
  for (let i = from; i < to; i++) {
    const t = lines[i].text.trim();
    let m = t.match(/^(\d[\d,.]*)\s+comments?$/i);
    if (m) engagement.comments = parseCount(m[1]);
    m = t.match(/^(\d[\d,.]*)\s+reposts?$/i);
    if (m) engagement.reposts = parseCount(m[1]);
    m = t.match(/^(\d[\d,.]*)\s+reactions?$/i);
    if (m) engagement.reactions = parseCount(m[1]);
    if (/^\d[\d,.]*$/.test(t) && engagement.reactions === undefined) {
      engagement.reactions = parseCount(t);
    }
  }
  return engagement;
}

export function parseCount(s: string): number {
  const t = s.trim().toLowerCase().replace(/,/g, "");
  const m = t.match(/^([\d.]+)\s*([km])?$/);
  if (!m) return 0;
  const n = parseFloat(m[1]);
  return Math.round(m[2] === "k" ? n * 1000 : m[2] === "m" ? n * 1_000_000 : n);
}

function segmentLinkedIn(raw: string, lines: Line[]): ExtractedItem[] {
  const items: ExtractedItem[] = [];
  const postStarts: number[] = [];
  lines.forEach((l, i) => {
    if (LI_FEED_POST.test(l.text.trim())) postStarts.push(i);
  });

  if (postStarts.length === 0) return segmentGeneric(raw, lines, "linkedin");

  // Everything before the first post is interface chrome.
  if (postStarts[0] > 0) {
    const navEnd = lines[postStarts[0] - 1].end;
    const navText = raw.slice(0, navEnd);
    if (navText.trim().length > 0) {
      items.push({
        tempId: nextTempId(),
        platform: "linkedin",
        itemType: "platform_navigation",
        originalText: navText.trim(),
        engagement: {},
        rawStartOffset: 0,
        rawEndOffset: navEnd,
        extractionConfidence: 0.95,
        isNoise: true,
        noiseReason: "LinkedIn navigation and filter chrome before the first feed post",
        topics: [],
      });
    }
  }

  for (let p = 0; p < postStarts.length; p++) {
    const startLine = postStarts[p];
    const endLine = p + 1 < postStarts.length ? postStarts[p + 1] : lines.length;
    const item = parseLinkedInPost(raw, lines, startLine, endLine);
    if (item) items.push(item);
  }
  return items;
}

function parseLinkedInPost(
  raw: string,
  lines: Line[],
  startLine: number,
  endLine: number,
): ExtractedItem | null {
  const rawStartOffset = lines[startLine].start;
  const rawEndOffset = lines[endLine - 1]?.end ?? raw.length;
  const blockText = raw.slice(rawStartOffset, rawEndOffset);
  if (!blockText.trim()) return null;

  let authorName: string | undefined;
  let authorMeta: string | undefined;
  let publishedAtText: string | undefined;
  let itemType: ItemType = "original_post";
  let repostedBy: string | undefined;
  let isCompany = false;
  let i = startLine + 1;

  // Header region: profile links, author, degree, headline, timestamp, buttons.
  let sawTimestamp = false;
  const headerLimit = Math.min(endLine, startLine + 14);
  const seenNameLines: string[] = [];
  for (; i < headerLimit; i++) {
    const t = lines[i].text.trim();
    if (!t || /^[​‌‍﻿\s]+$/u.test(t)) continue;
    const reposted = t.match(LI_REPOSTED);
    if (reposted) {
      repostedBy = reposted[1].trim();
      itemType = "repost";
      continue;
    }
    const prof = t.match(LI_PROFILE);
    if (prof) {
      authorName = (prof[1] || prof[2] || "").trim();
      continue;
    }
    const comp = t.match(LI_COMPANY);
    if (comp) {
      authorName = comp[1].trim();
      isCompany = true;
      continue;
    }
    if (LI_TIMESTAMP.test(t)) {
      publishedAtText = t.replace(/\s*•\s*$/, "").trim();
      sawTimestamp = true;
      i += 1;
      break;
    }
    if (/^promoted$/i.test(t)) {
      itemType = "advertisement";
      publishedAtText = undefined;
      i += 1;
      break;
    }
    if (LI_DEGREE.test(t) || /\s•\s*(1st|2nd|3rd\+?)\s*$/.test(t)) continue;
    if (/^(follow|connect|subscribe|following|\+ follow)$/i.test(t)) continue;
    if (authorName && t === authorName) continue; // duplicated name line
    if (!authorName) {
      seenNameLines.push(t);
      if (seenNameLines.length === 1) {
        authorName = t;
        continue;
      }
    }
    // A non-matching line after the author is the headline/meta line.
    if (authorName && !authorMeta && !LI_TIMESTAMP.test(t)) {
      authorMeta = t;
      continue;
    }
  }

  // Body: from after header until an end-marker. A line that is nothing
  // but a bare domain is an embedded article card's footer; the line above
  // it is the card title (LinkedIn doubles it: "TitleTitle").
  const bodyLines: string[] = [];
  let bodyEndLine = i;
  let quotedTitle: string | undefined;
  let sourceUrl: string | undefined;
  for (let j = i; j < endLine; j++) {
    const t = lines[j].text.trim();
    if (isBodyEnd(t)) {
      bodyEndLine = j;
      break;
    }
    if (BARE_DOMAIN.test(t) && !/^\d/.test(t)) {
      sourceUrl = t.startsWith("http") ? t : `https://${t}`;
      while (bodyLines.length > 0) {
        const candidate = bodyLines[bodyLines.length - 1].trim();
        if (!candidate) {
          bodyLines.pop();
          continue;
        }
        quotedTitle = dedupeConcatenatedTitle(candidate);
        bodyLines.pop();
        break;
      }
      bodyEndLine = j + 1;
      break;
    }
    if (/^(follow|connect|subscribe)$/i.test(t)) continue;
    bodyLines.push(lines[j].text);
    bodyEndLine = j + 1;
  }

  // Footer: engagement counts.
  const engagement = parseEngagementLines(lines, bodyEndLine, endLine);

  let body = bodyLines.join("\n").trim();
  // strip trailing UI litter inside body
  body = body.replace(/[​‌‍﻿]+/gu, "").trim();

  const urls = extractUrls(body);
  if (!sourceUrl && urls.length > 0) sourceUrl = urls[0];

  if (looksLikeAd(blockText) && itemType !== "advertisement") itemType = "advertisement";
  const noise = itemType === "advertisement" || body.length === 0;
  if (isCompany && itemType === "original_post") itemType = "company_announcement";

  const confidence = sawTimestamp && authorName ? 0.92 : authorName ? 0.75 : 0.5;

  return {
    tempId: nextTempId(),
    platform: "linkedin",
    itemType: noise && body.length === 0 ? "interface_text" : itemType,
    authorName,
    authorMeta: repostedBy ? `${authorMeta ?? ""}${authorMeta ? " · " : ""}reposted by ${repostedBy}` : authorMeta,
    originalText: body || blockText.trim().slice(0, 400),
    quotedText: quotedTitle,
    sourceUrl,
    publishedAtText,
    engagement,
    rawStartOffset,
    rawEndOffset,
    extractionConfidence: confidence,
    isNoise: noise,
    noiseReason: noise
      ? itemType === "advertisement"
        ? "Promoted/advertisement unit"
        : "No readable body text in this feed unit"
      : undefined,
    topics: extractHashtags(body),
  };
}

/** LinkedIn repeats article titles twice with no separator ("TitleTitle"). */
export function dedupeConcatenatedTitle(t: string): string {
  const half = Math.floor(t.length / 2);
  if (t.length >= 12 && t.length % 2 === 0 && t.slice(0, half) === t.slice(half)) {
    return t.slice(0, half);
  }
  return t;
}

// --- X / Twitter -------------------------------------------------------------

const X_HANDLE = /^@([A-Za-z0-9_]{1,15})$/;
const X_TIME = /^(\d+(?:s|m|h)|[A-Z][a-z]{2}\s+\d{1,2}(?:,\s*\d{4})?|\d{1,2}\s[A-Z][a-z]{2}(?:\s\d{4})?)$/;
const X_STATS_WORDS = /^(replies?|reposts?|likes?|views?|bookmarks?)$/i;

function segmentX(raw: string, lines: Line[]): ExtractedItem[] {
  const items: ExtractedItem[] = [];
  // Posts are recognised by a Name line followed by an @handle line
  // (optionally separated by "·"/time lines).
  const anchors: number[] = [];
  for (let i = 1; i < lines.length; i++) {
    if (X_HANDLE.test(lines[i].text.trim()) && lines[i - 1].text.trim().length > 0 && !X_HANDLE.test(lines[i - 1].text.trim())) {
      anchors.push(i - 1);
    }
  }
  if (anchors.length === 0) return segmentGeneric(raw, lines, "x");

  if (anchors[0] > 0) {
    const navEnd = lines[anchors[0] - 1].end;
    const navText = raw.slice(0, navEnd).trim();
    if (navText) {
      items.push({
        tempId: nextTempId(),
        platform: "x",
        itemType: "platform_navigation",
        originalText: navText,
        engagement: {},
        rawStartOffset: 0,
        rawEndOffset: navEnd,
        extractionConfidence: 0.9,
        isNoise: true,
        noiseReason: "X interface chrome before the first post",
        topics: [],
      });
    }
  }

  for (let a = 0; a < anchors.length; a++) {
    const startLine = anchors[a];
    const endLine = a + 1 < anchors.length ? anchors[a + 1] : lines.length;
    // Embedded quote blocks: an inner Name/@handle pair inside another post's
    // range was captured as its own anchor; handled naturally as quoted_source
    // when the previous item flagged a quote marker.
    const item = parseXPost(raw, lines, startLine, endLine);
    if (item) items.push(item);
  }

  // Mark quote relationships: a post whose trailing line was "Quote" quotes
  // the following item.
  for (let k = 0; k < items.length - 1; k++) {
    const cur = items[k];
    if (!cur.isNoise && /\nquote\s*$/i.test(cur.originalText)) {
      cur.originalText = cur.originalText.replace(/\nquote\s*$/i, "").trim();
      cur.itemType = "quote_post";
      const nxt = items[k + 1];
      if (!nxt.isNoise) {
        nxt.itemType = "quoted_source";
        cur.quotedText = `${nxt.authorName ?? ""} ${nxt.authorHandle ? "@" + nxt.authorHandle : ""}: ${nxt.originalText.slice(0, 280)}`.trim();
      }
    }
  }
  return items;
}

function parseXPost(raw: string, lines: Line[], startLine: number, endLine: number): ExtractedItem | null {
  const rawStartOffset = lines[startLine].start;
  const rawEndOffset = lines[endLine - 1]?.end ?? raw.length;
  const authorName = lines[startLine].text.trim();
  let authorHandle: string | undefined;
  let publishedAtText: string | undefined;
  let itemType: ItemType = "original_post";
  let i = startLine + 1;
  for (; i < Math.min(endLine, startLine + 6); i++) {
    const t = lines[i].text.trim();
    const h = t.match(X_HANDLE);
    if (h) {
      authorHandle = h[1];
      continue;
    }
    if (t === "·" || t === "") continue;
    if (X_TIME.test(t)) {
      publishedAtText = t;
      i += 1;
      break;
    }
    break;
  }

  const bodyLines: string[] = [];
  const engagement: Record<string, number | string> = {};
  let pendingNumber: number | undefined;
  for (let j = i; j < endLine; j++) {
    const t = lines[j].text.trim();
    if (/^replying to @/i.test(t)) {
      itemType = "reply";
      continue;
    }
    if (/^(.*) reposted$/i.test(t)) {
      itemType = "repost";
      continue;
    }
    if (/^\d[\d,.]*[KkMm]?$/.test(t)) {
      pendingNumber = parseCount(t);
      continue;
    }
    if (X_STATS_WORDS.test(t)) {
      if (pendingNumber !== undefined) {
        engagement[t.toLowerCase().replace(/s?$/, "s")] = pendingNumber;
        pendingNumber = undefined;
      }
      continue;
    }
    if (isNavLine(t) && !/^quote$/i.test(t)) continue;
    bodyLines.push(lines[j].text);
  }
  const body = bodyLines.join("\n").replace(/[​‌‍﻿]+/gu, "").trim();
  const noise = body.length === 0;
  return {
    tempId: nextTempId(),
    platform: "x",
    itemType: noise ? "interface_text" : itemType,
    authorName,
    authorHandle,
    originalText: body || raw.slice(rawStartOffset, rawEndOffset).trim().slice(0, 280),
    publishedAtText,
    engagement,
    sourceUrl: extractUrls(body)[0],
    rawStartOffset,
    rawEndOffset,
    extractionConfidence: authorHandle ? 0.9 : 0.6,
    isNoise: noise,
    noiseReason: noise ? "No readable post text" : undefined,
    topics: extractHashtags(body),
  };
}

// --- Reddit -------------------------------------------------------------------

const REDDIT_SUB = /^r\/[A-Za-z0-9_]{2,}$/;
const REDDIT_USER = /^u\/[A-Za-z0-9_-]{2,}/;

const REDDIT_COMMENT_ANCHOR = /^u\/[A-Za-z0-9_-]+\s*[·•]\s*\d+\s?(?:m|h|d|w|mo|y)\b/;

function segmentReddit(raw: string, lines: Line[]): ExtractedItem[] {
  const items: ExtractedItem[] = [];
  const anchors: number[] = [];
  lines.forEach((l, idx) => {
    const t = l.text.trim();
    // a subreddit header starts a post; a "u/name · 12h" line starts a comment
    if (REDDIT_SUB.test(t) || REDDIT_COMMENT_ANCHOR.test(t)) anchors.push(idx);
  });
  if (anchors.length === 0) return segmentGeneric(raw, lines, "reddit");

  for (let a = 0; a < anchors.length; a++) {
    const startLine = anchors[a];
    const endLine = a + 1 < anchors.length ? anchors[a + 1] : lines.length;
    const rawStartOffset = lines[startLine].start;
    const rawEndOffset = lines[endLine - 1]?.end ?? raw.length;
    let sub: string | undefined;
    let author: string | undefined;
    let publishedAtText: string | undefined;
    const bodyLines: string[] = [];
    const engagement: Record<string, number | string> = {};
    // anchor type decides the shape: subreddit header = post, user line = comment
    const isComment = REDDIT_COMMENT_ANCHOR.test(lines[startLine].text.trim());
    for (let j = startLine; j < endLine; j++) {
      const t = lines[j].text.trim();
      if (REDDIT_SUB.test(t)) {
        sub = t;
        continue;
      }
      const posted = t.match(/^posted by (u\/[A-Za-z0-9_-]+)\s*(.*)$/i);
      if (posted) {
        author = posted[1];
        if (posted[2]) publishedAtText = posted[2].trim();
        continue;
      }
      const userLine = t.match(/^(u\/[A-Za-z0-9_-]+)\s*(?:·|•)?\s*(.*)$/);
      if (userLine && REDDIT_USER.test(t)) {
        author = userLine[1];
        if (userLine[2]) publishedAtText = userLine[2].trim();
        continue;
      }
      let m = t.match(/^(\d[\d,.]*[Kk]?)\s*(upvotes?|points?)$/i);
      if (m) {
        engagement.upvotes = parseCount(m[1]);
        continue;
      }
      m = t.match(/^(\d[\d,.]*[Kk]?)\s*comments?$/i);
      if (m) {
        engagement.comments = parseCount(m[1]);
        continue;
      }
      if (isNavLine(t)) continue;
      bodyLines.push(lines[j].text);
    }
    const body = bodyLines.join("\n").replace(/[​‌‍﻿]+/gu, "").trim();
    items.push({
      tempId: nextTempId(),
      platform: "reddit",
      itemType: body ? (isComment ? "comment" : "original_post") : "interface_text",
      authorName: author,
      authorMeta: sub,
      originalText: body || raw.slice(rawStartOffset, rawEndOffset).trim().slice(0, 200),
      publishedAtText,
      engagement,
      sourceUrl: extractUrls(body)[0],
      rawStartOffset,
      rawEndOffset,
      extractionConfidence: author ? 0.85 : 0.6,
      isNoise: !body,
      noiseReason: body ? undefined : "No readable content",
      topics: extractHashtags(body),
    });
  }
  return items;
}

// --- News / jobs ---------------------------------------------------------------

const NEWS_TIME = /^\d+\s*(minutes?|hours?|days?|weeks?)\s+ago$/i;

function segmentNewsJobs(raw: string, lines: Line[], platform: "news" | "jobs"): ExtractedItem[] {
  // Blocks separated by blank lines: headline, source, time / job title,
  // company, location.
  const items: ExtractedItem[] = [];
  let blockStart: number | null = null;
  const flush = (from: number, to: number) => {
    if (from >= to) return;
    const rawStartOffset = lines[from].start;
    const rawEndOffset = lines[to - 1].end;
    const blockLines = lines.slice(from, to).map((l) => l.text.trim()).filter(Boolean);
    if (blockLines.length === 0) return;
    const text = blockLines.join("\n");
    if (blockLines.every((l) => isNavLine(l))) {
      items.push({
        tempId: nextTempId(),
        platform,
        itemType: "interface_text",
        originalText: text,
        engagement: {},
        rawStartOffset,
        rawEndOffset,
        extractionConfidence: 0.8,
        isNoise: true,
        noiseReason: "Interface text",
        topics: [],
      });
      return;
    }
    const isJob =
      platform === "jobs" ||
      /\b(hiring|apply|applicants?|full-time|part-time|remote|hybrid|on-site|salary|\bcareers?\b)\b/i.test(text);
    const headline = blockLines[0];
    const sourceLine = blockLines.find((l, idx) => idx > 0 && (BARE_DOMAIN.test(l) || /^[A-Z][\w\s.&']{1,40}$/.test(l)));
    const timeLine = blockLines.find((l) => NEWS_TIME.test(l));
    items.push({
      tempId: nextTempId(),
      platform,
      itemType: isJob && platform === "jobs" ? "job_listing" : isJob ? "job_listing" : "article",
      authorName: sourceLine,
      originalText: text,
      publishedAtText: timeLine,
      sourceUrl: extractUrls(text)[0] ?? (blockLines.find((l) => BARE_DOMAIN.test(l)) ? `https://${blockLines.find((l) => BARE_DOMAIN.test(l))}` : undefined),
      engagement: {},
      rawStartOffset,
      rawEndOffset,
      extractionConfidence: 0.75,
      isNoise: false,
      topics: extractHashtags(text),
      quotedText: undefined,
      authorMeta: headline !== text ? undefined : undefined,
    });
  };
  for (let i = 0; i <= lines.length; i++) {
    const blank = i === lines.length || lines[i].text.trim() === "";
    if (!blank && blockStart === null) blockStart = i;
    if (blank && blockStart !== null) {
      flush(blockStart, i);
      blockStart = null;
    }
  }
  return items;
}

// --- Call transcript / internal notes -------------------------------------------

const SPEAKER_TURN = /^(?:\[(\d{1,2}:\d{2}(?::\d{2})?)\]\s*)?([A-Z][\w .'-]{1,40}):\s+(.*)$/;
// transcript preamble labels are metadata, not speakers
const TRANSCRIPT_META_LABELS = new Set([
  "call",
  "participants",
  "attendees",
  "date",
  "subject",
  "meeting",
  "recording",
  "note",
  "notes",
  "location",
  "agenda",
]);

function segmentTranscript(raw: string, lines: Line[]): ExtractedItem[] {
  const items: ExtractedItem[] = [];
  let current: { speaker: string; time?: string; startLine: number; parts: string[] } | null = null;
  const flush = (endLineIdx: number) => {
    if (!current) return;
    const startOff = lines[current.startLine].start;
    const endOff = lines[Math.max(current.startLine, endLineIdx - 1)].end;
    const text = current.parts.join("\n").trim();
    if (text) {
      items.push({
        tempId: nextTempId(),
        platform: "call",
        itemType: "transcript_segment",
        authorName: current.speaker,
        originalText: text,
        publishedAtText: current.time,
        engagement: {},
        rawStartOffset: startOff,
        rawEndOffset: endOff,
        extractionConfidence: 0.9,
        isNoise: false,
        topics: extractHashtags(text),
      });
    }
    current = null;
  };
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].text;
    const m = t.match(SPEAKER_TURN);
    const isRealTurn = Boolean(m && !TRANSCRIPT_META_LABELS.has(m[2].trim().toLowerCase()));
    if (isRealTurn && m) {
      flush(i);
      current = { speaker: m[2].trim(), time: m[1], startLine: i, parts: [m[3]] };
    } else if (current) {
      current.parts.push(t);
    } else if (t.trim()) {
      // metadata header lines ("Call: …", "Participants: …") and any other
      // pre-conversation text form a preamble block
      current = { speaker: "Preamble", startLine: i, parts: [t] };
    }
  }
  flush(lines.length);
  // preamble/metadata blocks are context, not quotable speech
  for (const item of items) {
    if (item.authorName === "Preamble") {
      item.authorName = undefined;
      item.itemType = "note";
    }
  }
  return items;
}

// --- Market-site digests (from the markets collector) ---------------------

const MARKET_LINE = /^(New listing|Status change|Volume move) on ([A-Z][\w.-]*(?: [A-Z][\w.-]*)?):\s*(.+)$/;

function segmentMarketSite(raw: string, lines: Line[]): ExtractedItem[] {
  const items: ExtractedItem[] = [];
  let start: number | null = null;
  const flush = (from: number, to: number) => {
    const text = lines
      .slice(from, to)
      .map((l) => l.text)
      .join("\n")
      .trim();
    if (!text) return;
    const m = text.match(MARKET_LINE);
    items.push({
      tempId: nextTempId(),
      platform: "market_site",
      itemType: m ? "market_listing" : "note",
      authorName: m ? m[2] : undefined,
      authorMeta: m ? m[1].toLowerCase() : undefined,
      originalText: text,
      engagement: {},
      rawStartOffset: lines[from].start,
      rawEndOffset: lines[to - 1].end,
      extractionConfidence: m ? 0.95 : 0.7,
      isNoise: false,
      topics: [],
    });
  };
  for (let i = 0; i <= lines.length; i++) {
    const blank = i === lines.length || lines[i].text.trim() === "";
    if (!blank && start === null) start = i;
    if (blank && start !== null) {
      flush(start, i);
      start = null;
    }
  }
  return items;
}

function segmentNotes(raw: string, lines: Line[]): ExtractedItem[] {
  // paragraphs (blank-line separated) as notes
  const items: ExtractedItem[] = [];
  let start: number | null = null;
  for (let i = 0; i <= lines.length; i++) {
    const blank = i === lines.length || lines[i].text.trim() === "";
    if (!blank && start === null) start = i;
    if (blank && start !== null) {
      const text = lines
        .slice(start, i)
        .map((l) => l.text)
        .join("\n")
        .trim();
      if (text) {
        items.push({
          tempId: nextTempId(),
          platform: "notes",
          itemType: "note",
          originalText: text,
          engagement: {},
          rawStartOffset: lines[start].start,
          rawEndOffset: lines[i - 1].end,
          extractionConfidence: 0.85,
          isNoise: false,
          topics: extractHashtags(text),
        });
      }
      start = null;
    }
  }
  return items;
}

// --- Generic + mixed --------------------------------------------------------------

function segmentGeneric(raw: string, lines: Line[], platform: string): ExtractedItem[] {
  const items: ExtractedItem[] = [];
  let start: number | null = null;
  const flush = (from: number, to: number) => {
    const text = lines
      .slice(from, to)
      .map((l) => l.text)
      .join("\n")
      .trim();
    if (!text) return;
    const navOnly = lines
      .slice(from, to)
      .map((l) => l.text.trim())
      .filter(Boolean)
      .every((l) => isNavLine(l));
    items.push({
      tempId: nextTempId(),
      platform,
      itemType: navOnly ? "interface_text" : text.length > 700 ? "article" : "unknown",
      originalText: text,
      engagement: {},
      rawStartOffset: lines[from].start,
      rawEndOffset: lines[to - 1].end,
      extractionConfidence: 0.5,
      isNoise: navOnly,
      noiseReason: navOnly ? "Interface text" : undefined,
      sourceUrl: extractUrls(text)[0],
      topics: extractHashtags(text),
    });
  };
  for (let i = 0; i <= lines.length; i++) {
    const blank = i === lines.length || lines[i].text.trim() === "";
    if (!blank && start === null) start = i;
    if (blank && start !== null) {
      flush(start, i);
      start = null;
    }
  }
  return items;
}

/** Score how strongly the text matches each platform's structural markers. */
export function detectPlatform(text: string): DeclaredSource {
  const sample = text.slice(0, 60_000);
  const scores: Record<string, number> = {
    linkedin: (sample.match(/^feed post/gim) || []).length * 5 + (sample.match(/view .*profile/gi) || []).length,
    x: (sample.match(/^@[A-Za-z0-9_]{1,15}$/gm) || []).length * 2,
    reddit: (sample.match(/^r\/[A-Za-z0-9_]+/gm) || []).length * 3 + (sample.match(/^posted by u\//gim) || []).length * 3,
    call_transcript:
      (sample.match(/^[A-Z][\w .'-]{1,40}: /gm) || []).length +
      (sample.match(/^\[\d{1,2}:\d{2}(?::\d{2})?\]/gm) || []).length * 2,
    news: (sample.match(/^\d+ (hours?|minutes?|days?) ago$/gim) || []).length * 2,
  };
  let best: DeclaredSource = "mixed";
  let bestScore = 2; // require a minimum signal
  for (const [k, v] of Object.entries(scores)) {
    if (v > bestScore) {
      best = k as DeclaredSource;
      bestScore = v;
    }
  }
  return best;
}

/**
 * Segment a raw dump into extracted items with exact offsets.
 * `declared` is the user's stated source; "mixed" triggers detection.
 */
export function segment(raw: string, declared: DeclaredSource): ExtractedItem[] {
  tempCounter = 0;
  const lines = toLines(raw);
  const effective = declared === "mixed" ? detectPlatform(raw) : declared;
  switch (effective) {
    case "linkedin":
      return segmentLinkedIn(raw, lines);
    case "x":
      return segmentX(raw, lines);
    case "reddit":
      return segmentReddit(raw, lines);
    case "news":
      return segmentNewsJobs(raw, lines, "news");
    case "jobs":
      return segmentNewsJobs(raw, lines, "jobs");
    case "call_transcript":
      return segmentTranscript(raw, lines);
    case "internal_notes":
      return segmentNotes(raw, lines);
    case "market_site":
      return segmentMarketSite(raw, lines);
    case "youtube":
    case "mixed":
    default:
      return segmentGeneric(raw, lines, effective === "mixed" ? "unknown" : effective);
  }
}
