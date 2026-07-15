// confidentiality.mjs — the mandatory confidentiality filter.
// Mirrors next-os rule R8: NEXT.io-confidential material (deals, margins,
// people, pipeline) never enters public-safe or Strait Up Growth outputs.
// The filter SUGGESTS a classification with reasons; Stuart confirms.
// It never auto-blocks legitimate work, it makes the risk visible.

export const CLASSIFICATIONS = [
  'public',
  'public-after-anonymisation',
  'private-operating-lesson',
  'strictly-confidential',
];

// Signals that push a note toward confidential. Each carries the reason
// shown to Stuart so the decision is explainable, never a mystery flag.
const DETECTORS = [
  { re: /next\.io|nextio|next io/i, weight: 2, reason: 'Mentions NEXT.io. Employer material stays out of public and Strait Up Growth outputs unless anonymised (R8).' },
  { re: /[€£$]\s?\d[\d,.]*\s?(k|m|million|thousand)?/i, weight: 2, reason: 'Contains a specific commercial figure. Exact figures must be removed or bucketed before anything public.' },
  { re: /\b\d{1,3}\s?%\s?(margin|uplift|discount|commission|nrr|churn|win rate)/i, weight: 2, reason: 'Contains a specific margin/discount/retention percentage.' },
  { re: /\b(acv|nrr|arr|mrr|p&l|pipeline value|weighted pipeline)\b/i, weight: 1, reason: 'References internal commercial metrics.' },
  { re: /\b(deal|contract|renewal|proposal)\b.*\b(with|for)\b\s+[A-Z][a-zA-Z]+/, weight: 2, reason: 'Appears to name a counterparty on a live commercial deal.' },
  { re: /\b(salary|salaries|headcount|redundanc|fired|hiring freeze|performance review|underperform)/i, weight: 3, reason: 'Employee-sensitive information.' },
  { re: /\b(unannounced|confidential|internal only|not public|off the record|nda)\b/i, weight: 3, reason: 'Explicitly marked as not public.' },
  { re: /\b(disagree|pushed back|overruled|conflict) (with|between)\b/i, weight: 2, reason: 'Describes internal disagreement.' },
  { re: /\b(ceo|cfo|coo|board) (said|told|decided|wants|rejected)/i, weight: 2, reason: 'Attributes a private statement or decision to a named executive role.' },
];

// What anonymisation must strip before a "public-after-anonymisation"
// item is used publicly.
export const ANONYMISATION_CHECKLIST = [
  'Company names replaced with a role description (e.g. "a B2B events business").',
  'Individual names removed or replaced with roles.',
  'Exact commercial figures bucketed ("six figures", "double-digit uplift") or removed.',
  'Identifying project details generalised.',
  'Private internal decisions and disagreements removed.',
  'Sensitive timings blurred ("recently", "last year").',
  'Deal terms and counterparties removed.',
];

export function review(text, { context = '' } = {}) {
  const body = `${text || ''}\n${context || ''}`;
  const hits = DETECTORS.filter((d) => d.re.test(body));
  const score = hits.reduce((s, d) => s + d.weight, 0);

  let classification;
  if (score >= 5) classification = 'strictly-confidential';
  else if (score >= 3) classification = 'private-operating-lesson';
  else if (score >= 1) classification = 'public-after-anonymisation';
  else classification = 'public';

  const reasons = hits.length
    ? hits.map((d) => d.reason)
    : ['No confidentiality signals detected. Still confirm nothing identifies a client, colleague or live deal.'];

  return {
    classification,
    score,
    reasons,
    isSuggestion: true,
    note: 'This is a suggested classification for Stuart to confirm, not a verdict.',
    anonymisationChecklist: classification === 'public-after-anonymisation' ? ANONYMISATION_CHECKLIST : undefined,
  };
}

// Gate used before content or outreach leaves a brand workspace.
// Returns conflicts to surface, never a hard block.
export function brandGate({ text = '', brand = 'strait-up-growth', classification = 'public' }) {
  const flags = [];
  if (['private-operating-lesson', 'strictly-confidential'].includes(classification)) {
    flags.push(`Source material is classified "${classification}". It must not appear in ${brand} output in any recognisable form.`);
  }
  if (classification === 'public-after-anonymisation') {
    flags.push('Source requires anonymisation. Confirm the checklist has been applied before publishing.');
  }
  if (brand !== 'next-io' && /next\.io/i.test(text)) {
    flags.push('Draft mentions NEXT.io inside a non-NEXT.io workspace. Confirm this is public knowledge and the employer relationship is not being used inappropriately.');
  }
  if (brand === 'strait-up-growth' && /nextpredict/i.test(text)) {
    flags.push('Draft mentions NEXTPredict inside the Strait Up Growth workspace. Confirm no event-partner relationship is being borrowed.');
  }
  return { ok: flags.length === 0, flags };
}
