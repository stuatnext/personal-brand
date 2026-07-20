import type { VoiceLintResult } from "@/lib/db/schema";

// Stuart's voice rules as a linter, kept in lockstep with
// personal-brand/data/voice/llm-voice-pack-2026-07-15/ (the newest canon)
// and the OFF_VOICE lists in both repos. Violations are shown inline on
// every draft; the eval suite treats errors as automatic failures.

const BANNED_PHRASES: { phrase: string; message?: string }[] = [
  { phrase: "game changer" },
  { phrase: "game-changer" },
  { phrase: "exciting times ahead" },
  { phrase: "fascinating development" },
  { phrase: "great insights" },
  { phrase: "inflection point" },
  { phrase: "the future of" },
  { phrase: "we are witnessing" },
  { phrase: "we're witnessing" },
  { phrase: "the next evolution of" },
  { phrase: "this highlights", message: "hard-banned by the 2026-07-15 voice pack" },
  { phrase: "broader trend", message: "hard-banned by the 2026-07-15 voice pack" },
  { phrase: "the bit that stands out" },
  { phrase: "the part I keep coming back to" },
  { phrase: "the thing I keep coming back to" },
  { phrase: "paradigm shift" },
  { phrase: "revolutionary" },
  { phrase: "in today's fast-paced world" },
  { phrase: "buckle up" },
  { phrase: "hot take" },
  { phrase: "let that sink in" },
];

/** Additional bans for NEXTPredict-branded outreach (DM/email/forum): the
 *  engine's OFF_VOICE list + category-vocabulary rule. */
const OUTREACH_BANNED: { phrase: string; message: string }[] = [
  { phrase: "compare notes", message: "Stuart-flagged off-voice (2026-07-01); use 'hear how you are seeing it'" },
  { phrase: "betting", message: "category vocabulary: never betting/gambling in NEXTPredict copy" },
  { phrase: "gambling", message: "category vocabulary: never betting/gambling in NEXTPredict copy" },
  { phrase: "sportsbook", message: "category vocabulary: banned in NEXTPredict copy" },
  { phrase: "wagering", message: "category vocabulary: banned in NEXTPredict copy" },
  { phrase: "casino", message: "category vocabulary: banned in NEXTPredict copy" },
];

const NEGATIVE_PARALLELISM: RegExp[] = [
  /\bnot just\s+[^.;!?]{2,60}?,?\s+but\b/i,
  /\bnot only\s+[^.;!?]{2,60}?,?\s+but\b/i,
  /\bit(?:'s| is)n(?:'t|ot) about\s+[^.;!?]{2,60}?[,;]?\s*it(?:'s| is) about\b/i,
  /\bit(?:'s| is) not about\s+[^.;!?]{2,60}?[,;]?\s*it(?:'s| is) about\b/i,
  /\bthe question is(?:n't| not)\s+[^.;!?]{2,60}?[,;]?\s*(?:it(?:'s| is)|but)\b/i,
];

const FORCED_CTA: RegExp[] = [
  /\bregister (?:now|today)\b/i,
  /\bdon'?t miss\b/i,
  /\bgrab your (?:ticket|seat|spot)\b/i,
  /\bsign up (?:now|today)\b/i,
  /\blink in bio\b/i,
  /\bsecure your (?:place|spot|seat)\b/i,
  /\btickets? selling fast\b/i,
];

const FALSE_CERTAINTY: RegExp[] = [
  /\bthis (?:confirms|proves)\b/i,
  /\bdefinitely\b/i,
  /\bwithout (?:a )?doubt\b/i,
  /\bit'?s (?:clear|obvious) that\b/i,
  /\bguaranteed\b/i,
];

const HEDGE_MARKERS =
  /\b(appears? to|according to (?:the )?post|reported(?:ly)?|if (?:this|that|the) number is right|claims?|suggests?|seems?|apparently|unverified|reportedly)\b/i;

export interface LintOptions {
  /** outreach drafts (dm/email/forum) apply the NEXTPredict OFF_VOICE list */
  outreach?: boolean;
  /** the draft references unverified claims; figures need hedging */
  hasUnverifiedClaims?: boolean;
}

export function lintVoice(text: string, opts: LintOptions = {}): VoiceLintResult {
  const errors: VoiceLintResult["errors"] = [];
  const warnings: VoiceLintResult["warnings"] = [];

  // Em dashes: never.
  let idx = text.indexOf("—");
  while (idx !== -1) {
    errors.push({
      rule: "em_dash",
      match: text.slice(Math.max(0, idx - 20), idx + 20).trim(),
      message: "Never use em dashes. Use a comma, full stop or 'to'.",
    });
    idx = text.indexOf("—", idx + 1);
  }
  if (/[a-z0-9]\s–\s[a-z0-9]/i.test(text)) {
    warnings.push({
      rule: "en_dash",
      match: text.match(/.{0,16}–.{0,16}/)?.[0]?.trim() ?? "–",
      message: "En dash used as a pause; Stuart writes '22 to 23 October', commas or full stops.",
    });
  }

  for (const { phrase, message } of BANNED_PHRASES) {
    const re = new RegExp(`\\b${phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
    const m = text.match(re);
    if (m) {
      errors.push({
        rule: "banned_phrase",
        match: m[0],
        message: message ?? `"${phrase}" is on Stuart's banned list.`,
      });
    }
  }

  if (opts.outreach) {
    for (const { phrase, message } of OUTREACH_BANNED) {
      const re = new RegExp(`\\b${phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
      const m = text.match(re);
      if (m) errors.push({ rule: "outreach_banned", match: m[0], message });
    }
  }

  for (const re of NEGATIVE_PARALLELISM) {
    const m = text.match(re);
    if (m) {
      errors.push({
        rule: "negative_parallelism",
        match: m[0].slice(0, 80),
        message: "AI comparative construction (not just X, but Y). Say the one thing you mean.",
      });
    }
  }

  for (const re of FORCED_CTA) {
    const m = text.match(re);
    if (m) {
      warnings.push({
        rule: "forced_cta",
        match: m[0],
        message: "Forced call to action; NEXTPredict mentions stay soft unless the task is explicitly sales-led.",
      });
    }
  }

  for (const re of FALSE_CERTAINTY) {
    const m = text.match(re);
    if (m) {
      warnings.push({
        rule: "false_certainty",
        match: m[0],
        message: "Stuart does not sound falsely certain; keep the uncertainty honest.",
      });
    }
  }

  // Theatrical one-line stacking: three consecutive tiny paragraphs.
  const paragraphs = text.split(/\n{2,}| {0,2}\n/).map((p) => p.trim());
  let shortRun = 0;
  for (const p of paragraphs) {
    if (p.length > 0 && p.length < 35 && !p.endsWith("?")) {
      shortRun += 1;
      if (shortRun === 3) {
        warnings.push({
          rule: "one_line_stacking",
          match: p,
          message: "Theatrical one-sentence line breaks; use natural paragraphs.",
        });
      }
    } else if (p.length > 0) {
      shortRun = 0;
    }
  }

  // Unhedged figures against unverified claims.
  if (opts.hasUnverifiedClaims && /(\$\s?[\d,.]+|\b\d+(?:\.\d+)?%|\b\d{1,3}(?:,\d{3})+\b)/.test(text)) {
    if (!HEDGE_MARKERS.test(text)) {
      errors.push({
        rule: "unhedged_figure",
        match: text.match(/(\$\s?[\d,.]+|\b\d+(?:\.\d+)?%|\b\d{1,3}(?:,\d{3})+\b)/)?.[0] ?? "",
        message:
          "Figure presented without hedging while the underlying claim is unverified. Use 'reported', 'appears to', 'if this number is right'.",
      });
    }
  }

  // Emoji density (Stuart uses none to few).
  const emoji = text.match(/[\u{1F300}-\u{1FAFF}]/gu) ?? [];
  if (emoji.length > 2) {
    warnings.push({
      rule: "emoji_density",
      match: emoji.slice(0, 5).join(""),
      message: "More than a couple of emoji reads as hype-merchant, not Stuart.",
    });
  }

  return { errors, warnings };
}
