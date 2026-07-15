// voice.mjs — Stuart's voice linter. Rules imported from the
// nextpredict-engine voice bible (data/voice/stuart-voice.md) and the
// OFF_VOICE list in its lint-drafts.mjs, kept in lockstep by hand.
// Brand-scoped: some vocabulary rules only apply to NEXTPredict copy.

// Hard errors in every brand's copy.
export const OFF_VOICE = [
  'compare notes',
  'game changer',
  'game-changer',
  'exciting times ahead',
  'fascinating development',
  'great insights',
  'we are witnessing',
  "we're witnessing",
  'the next evolution of',
  'the thing i keep coming back to',
  'the part i keep coming back to',
  'the bit i keep coming back to',
  'pick your brain',
  'i hope this email finds you well',
  'touch base',
  'circle back',
  'synergy',
  'delve into',
  'in the ever-evolving',
  'in the fast-paced world of',
];

// Soft warnings — fine when specific, lazy as defaults.
export const SOFT_AVOID = ['inflection point', 'signal', 'landscape', 'ecosystem', 'leverage'];

// Negative-parallelism cadence Stuart never uses.
const PARALLELISM = [
  /not just \w[\w\s']* but /i,
  /not only \w[\w\s']* but /i,
  /it'?s not about [\w\s']+ it'?s about /i,
  /the question is not [\w\s']+ it is /i,
  /this isn'?t [\w\s']+ it'?s /i,
];

// NEXTPredict category copy only: category vocabulary, never these.
const NEXTPREDICT_BANNED = ['betting', 'gambling', 'casino', 'sportsbook', 'igaming', 'wagering', 'bookmaker'];

// Phrases that manufacture familiarity in outreach.
export const FAKE_FAMILIARITY = [
  'long-time follower',
  'long time follower',
  "i've been following you for years",
  'i have been following you for years',
  'big fan of yours',
  'love everything you do',
  'huge fan of your work',
];

export function lint(text, { brand = 'stuart', kind = 'post' } = {}) {
  const problems = [];
  const warnings = [];
  const lower = (text || '').toLowerCase();

  if (/—|–/.test(text)) {
    problems.push({ rule: 'no-em-dashes', detail: 'Contains an em or en dash. Stuart never uses them; rewrite with a comma, full stop or "and".' });
  }
  for (const phrase of OFF_VOICE) {
    if (lower.includes(phrase)) problems.push({ rule: 'off-voice-phrase', detail: `"${phrase}" is on the banned list (Stuart flagged it, or it is an AI tell).` });
  }
  for (const re of PARALLELISM) {
    if (re.test(text)) problems.push({ rule: 'negative-parallelism', detail: `Negative-parallelism cadence ("not just X but Y"). Stuart never writes this. Matched: ${String(re)}` });
  }
  if (brand === 'nextpredict') {
    for (const word of NEXTPREDICT_BANNED) {
      const re = new RegExp(`\\b${word}\\b`, 'i');
      if (re.test(text)) problems.push({ rule: 'category-vocabulary', detail: `"${word}" is banned in NEXTPredict copy. Use prediction markets / event contracts / market structure vocabulary.` });
    }
  }
  if (kind === 'outreach' || kind === 'dm' || kind === 'email') {
    for (const phrase of FAKE_FAMILIARITY) {
      if (lower.includes(phrase)) problems.push({ rule: 'fake-familiarity', detail: `"${phrase}" manufactures familiarity. Only claim history the record supports.` });
    }
  }
  for (const word of SOFT_AVOID) {
    const re = new RegExp(`\\b${word}\\b`, 'i');
    if (re.test(text)) warnings.push({ rule: 'soft-avoid', detail: `"${word}" is a lazy default. Keep it only if it is genuinely specific here.` });
  }
  // Theatrical LinkedIn formatting: many consecutive one-line paragraphs.
  const paras = (text || '').split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  const oneLiners = paras.filter((p) => !p.includes('\n') && p.length < 90).length;
  if (paras.length >= 6 && oneLiners / paras.length > 0.7) {
    warnings.push({ rule: 'staccato-formatting', detail: 'Mostly one-sentence paragraphs. Stuart writes in natural paragraphs; merge some lines.' });
  }
  if (kind === 'outreach' && (text || '').length > 1400) {
    warnings.push({ rule: 'too-long', detail: 'Outreach over ~1400 characters rarely gets read. Cut to the reason, the value and one low-pressure ask.' });
  }

  return { ok: problems.length === 0, problems, warnings };
}
