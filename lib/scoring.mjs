// scoring.mjs — every score in the engine is explainable: a total, the
// component factors, the evidence behind each factor, and what is missing.
// Weights and thresholds live in data/settings.json so Stuart can change
// them without touching code. No score is presented as objective truth.

import { items, settings } from './store.mjs';

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const daysSince = (iso) => (iso ? (Date.now() - new Date(iso).getTime()) / 86400000 : Infinity);

// Lane tiers: 'core' lanes are the two authority pillars (Strait Up
// Growth: AI / commercial & marketing strategy / operational efficiency
// for Singapore & SEA; and prediction markets). Weighted up everywhere.
export function laneInfo() {
  const lanes = items('lanes');
  return {
    byName: Object.fromEntries(lanes.map((l) => [l.name, l])),
    core: lanes.filter((l) => l.tier === 'core').map((l) => l.name),
    pillars: [...new Set(lanes.map((l) => l.pillar).filter(Boolean))],
  };
}
export const isCoreLane = (name) => laneInfo().byName[name]?.tier === 'core';

// ---------------------------------------------------------------------------
// Relationship strength — evidence-based, never a bare number.
// ---------------------------------------------------------------------------
export function relationshipStrength(contact, interactions) {
  const mine = interactions
    .filter((i) => i.contactId === contact.id)
    .sort((a, b) => (a.date < b.date ? 1 : -1));
  const evidence = [];
  let score = 0;

  const last = mine[0];
  const recency = last ? daysSince(last.date) : Infinity;
  if (recency <= 14) { score += 25; evidence.push(`Spoke within the last two weeks (${last.kind}, ${last.date.slice(0, 10)}).`); }
  else if (recency <= 45) { score += 18; evidence.push(`Interaction within six weeks (${last.kind}, ${last.date.slice(0, 10)}).`); }
  else if (recency <= 120) { score += 8; evidence.push(`Last interaction ${Math.round(recency)} days ago. Going quiet.`); }
  else if (mine.length) { evidence.push(`No interaction for ${Math.round(recency)} days. Cold.`); }
  else { evidence.push('No interactions on record.'); }

  const meaningful = mine.filter((i) => ['meeting', 'call', 'reply', 'intro', 'referral'].includes(i.kind));
  score += clamp(meaningful.length * 8, 0, 32);
  if (meaningful.length) evidence.push(`${meaningful.length} meaningful interaction(s): ${[...new Set(meaningful.map((i) => i.kind))].join(', ')}.`);

  const engagements = mine.filter((i) => ['comment', 'engagement', 'message'].includes(i.kind));
  score += clamp(engagements.length * 3, 0, 12);
  if (engagements.length >= 3) evidence.push(`Repeated engagement (${engagements.length} touches). Treat differently from a one-off like.`);

  if (contact.howKnown && /introduc|worked with|former colleague|client/i.test(contact.howKnown)) {
    score += 12; evidence.push(`Real shared history: ${contact.howKnown}.`);
  }
  const meetings = mine.filter((i) => i.kind === 'meeting').length;
  if (meetings) { score += clamp(meetings * 6, 0, 12); evidence.push(`${meetings} meeting(s) on record.`); }

  score = clamp(score, 0, 100);
  const band = score >= 60 ? 'strong' : score >= 30 ? 'warm' : score > 0 ? 'thin' : 'cold';
  const missing = [];
  if (!mine.length) missing.push('No logged interactions. Log history before trusting this score.');
  if (!contact.howKnown) missing.push('How Stuart knows them is not recorded.');

  return { score, band, evidence, missing, lastInteraction: last?.date || null, interactionCount: mine.length };
}

// ---------------------------------------------------------------------------
// Content quality scorecard — 12 criteria, 1-5 each (max 60).
// Thresholds editable in settings (default: >=48 strong, >=36 edit, <36 reject).
// The heuristic pre-scores; Stuart's own criterion edits always win.
// ---------------------------------------------------------------------------
export const CONTENT_CRITERIA = [
  ['operatorCredibility', 'Operator credibility'],
  ['practicalUsefulness', 'Practical usefulness'],
  ['distinctPointOfView', 'Distinct point of view'],
  ['evidence', 'Evidence'],
  ['confidentialitySafety', 'Confidentiality safety'],
  ['sugRelevance', 'Relevance to Strait Up Growth'],
  ['relationshipValue', 'Relationship value'],
  ['speakingPotential', 'Speaking potential'],
  ['industryRelevance', 'Industry relevance'],
  ['originality', 'Originality'],
  ['commercialRelevance', 'Commercial relevance'],
  ['toneMatch', 'Tone match'],
];

export function scoreContent(content, { lintResult } = {}) {
  const s = settings();
  const thresholds = s.contentThresholds || { strong: 48, publishAfterEdits: 36 };
  const body = content.body || '';
  const c = {};
  const notes = {};

  const hasNumbers = /\d/.test(body);
  const hasFirstPerson = /\b(i|we|my|our)\b/i.test(body);
  const wordCount = body.split(/\s+/).filter(Boolean).length;

  c.operatorCredibility = hasFirstPerson && /\b(built|ran|managed|negotiated|priced|launched|sold|hired|fixed)\b/i.test(body) ? 4 : 2;
  notes.operatorCredibility = c.operatorCredibility >= 4 ? 'First-person operating experience present.' : 'No first-person operating experience in the draft. Add what Stuart actually did.';
  c.practicalUsefulness = /\b(how|step|start with|instead|check|ask yourself|the fix)\b/i.test(body) ? 4 : 2;
  notes.practicalUsefulness = c.practicalUsefulness >= 4 ? 'Contains something a reader can act on.' : 'Nothing actionable yet. What should the reader do differently?';
  c.distinctPointOfView = content.pov ? 4 : 2;
  notes.distinctPointOfView = content.pov ? `Stated view: "${content.pov}"` : 'No point of view recorded on the item.';
  c.evidence = (content.evidence || []).length ? clamp(2 + (content.evidence || []).length, 2, 5) : hasNumbers ? 3 : 1;
  notes.evidence = (content.evidence || []).length ? `${content.evidence.length} evidence item(s) attached.` : 'No evidence attached. Unverified claims must be marked.';
  c.confidentialitySafety = content.confidentiality === 'public' ? 5 : content.confidentiality === 'public-after-anonymisation' ? 3 : 1;
  notes.confidentialitySafety = `Source classification: ${content.confidentiality || 'unreviewed'}.`;
  const coreHits = (content.lanes || []).filter((l) => isCoreLane(l));
  c.sugRelevance = coreHits.length ? 5 : (content.lanes || []).length ? 3 : 2;
  notes.sugRelevance = coreHits.length
    ? `In core pillar lane(s): ${coreHits.join(', ')}.`
    : (content.lanes || []).length
      ? `Only supporting lanes (${content.lanes.join(', ')}). Fine as context, but the pillars are where authority compounds.`
      : 'Not linked to an authority lane.';
  c.relationshipValue = (content.relatedContacts || []).length ? 4 : 3;
  notes.relationshipValue = (content.relatedContacts || []).length ? 'Named contacts are relevant to this piece.' : 'No specific contacts linked.';
  c.speakingPotential = ['podcast-outline', 'speaking-proposal', 'article', 'newsletter'].includes(content.format) ? 4 : 3;
  notes.speakingPotential = 'Judged from format; adjust by hand if the idea carries a talk.';
  c.industryRelevance = (content.lanes || []).some((l) => /igaming|prediction|events|media/i.test(l)) ? 4 : 3;
  notes.industryRelevance = 'Judged from lane linkage.';
  c.originality = content.sourceInsights?.length ? 4 : 3;
  notes.originality = content.sourceInsights?.length ? 'Grounded in Stuart’s own captured insight.' : 'Not grounded in a captured insight; risks being generic commentary.';
  c.commercialRelevance = content.objective && /offer|opportunity|pipeline|client|commercial/i.test(content.objective) ? 4 : 3;
  notes.commercialRelevance = `Objective: ${content.objective || 'none set'}.`;
  c.toneMatch = lintResult ? (lintResult.ok ? (lintResult.warnings.length ? 4 : 5) : 2) : 3;
  notes.toneMatch = lintResult ? (lintResult.ok ? 'Passes the voice linter.' : `Voice linter problems: ${lintResult.problems.map((p) => p.rule).join(', ')}.`) : 'Not linted yet.';

  if (wordCount < 40) { c.practicalUsefulness = Math.min(c.practicalUsefulness, 2); notes.practicalUsefulness += ' Draft is very short.'; }

  // Stuart's manual per-criterion overrides always win.
  const manual = content.scoreOverrides || {};
  for (const [key] of CONTENT_CRITERIA) if (manual[key]) c[key] = clamp(manual[key], 1, 5);

  const total = CONTENT_CRITERIA.reduce((sum, [key]) => sum + (c[key] || 1), 0);
  const weakest = CONTENT_CRITERIA.filter(([key]) => (c[key] || 1) <= 2).map(([key, label]) => ({ key, label, note: notes[key] }));
  const recommendation = total >= thresholds.strong ? 'publish'
    : total >= thresholds.publishAfterEdits ? 'revise'
    : 'reject';

  return {
    criteria: c,
    notes,
    total,
    max: CONTENT_CRITERIA.length * 5,
    weakest,
    recommendation,
    recommendationText: recommendation === 'publish'
      ? `Strong authority piece (${total}/${CONTENT_CRITERIA.length * 5}).`
      : recommendation === 'revise'
        ? `Publish after targeted edits (${total}). Fix: ${weakest.map((w) => w.label).join(', ') || 'weakest criteria'}.`
        : `Do not publish (${total}). Below the editable threshold of ${thresholds.publishAfterEdits}.`,
    thresholds,
    isSuggestion: true,
  };
}

// ---------------------------------------------------------------------------
// Outreach qualification — 0-100 weighted, with the fastest improvement.
// Weights editable in settings.outreachWeights.
// ---------------------------------------------------------------------------
export function scoreOutreach(record, { contact, strength, lintResult } = {}) {
  const s = settings();
  const w = s.outreachWeights || {
    relationshipStrength: 15, triggerRelevance: 20, valueToRecipient: 20,
    strategicFit: 15, evidenceOfInterest: 10, timing: 10, messageSpecificity: 10,
  };
  const rows = [];
  const add = (key, label, fraction, why) => rows.push({ key, label, weight: w[key], points: Math.round(w[key] * clamp(fraction, 0, 1)), why });

  add('relationshipStrength', 'Relationship strength', strength ? strength.score / 100 : 0,
    strength ? `${strength.band} (${strength.score}/100): ${strength.evidence[0] || ''}` : 'No relationship evidence.');
  add('triggerRelevance', 'Relevance of trigger', record.trigger ? (record.trigger.length > 25 ? 1 : 0.6) : 0,
    record.trigger ? `Trigger: ${record.trigger}` : 'No trigger recorded. Why now?');
  add('valueToRecipient', 'Value to recipient', record.valueToRecipient ? (record.valueToRecipient.length > 25 ? 1 : 0.6) : 0,
    record.valueToRecipient ? `Stated value: ${record.valueToRecipient}` : 'No value exchange stated.');
  add('strategicFit', 'Strategic fit', (record.lanes || []).length ? 1 : contact?.lanes?.length ? 0.7 : 0.3,
    (record.lanes || []).length ? `Linked lanes: ${record.lanes.join(', ')}` : 'Not linked to an authority lane or offer.');
  add('evidenceOfInterest', 'Evidence of interest', (record.evidence || []).length ? 1 : 0,
    (record.evidence || []).length ? `${record.evidence.length} evidence item(s): ${record.evidence[0]}` : 'No evidence the recipient cares. Do not invent it.');
  add('timing', 'Timing', record.trigger && /this week|today|just|yesterday|announc|launch|new role|posted/i.test(record.trigger) ? 1 : record.trigger ? 0.5 : 0,
    'Judged from how current the trigger is.');
  const msg = record.message || '';
  add('messageSpecificity', 'Message specificity',
    msg.length > 80 && !lintResult?.problems?.length ? (/[A-Z][a-z]+/.test(msg) && msg.length < 1400 ? 1 : 0.6) : msg ? 0.4 : 0,
    lintResult?.problems?.length ? `Voice/quality problems: ${lintResult.problems.map((p) => p.rule).join(', ')}` : msg ? 'Message drafted.' : 'No message drafted yet.');

  const total = rows.reduce((sum, r) => sum + r.points, 0);
  const verdict = total >= 75 ? 'recommend' : total >= 55 ? 'improve-first' : 'do-not-send';
  const worst = [...rows].sort((a, b) => (a.points / a.weight) - (b.points / b.weight))[0];

  const hardStops = [];
  if (contact?.doNotContact) hardStops.push('Contact is marked do-not-contact. This outreach must not be sent regardless of score.');
  if (contact?.followUpDate && daysSince(contact.lastOutreachAt) < 10 && record.stage === 'drafted') hardStops.push('Contacted within the last 10 days.');

  return {
    total, verdict, rows, hardStops,
    verdictText: hardStops.length ? `Blocked: ${hardStops[0]}`
      : verdict === 'recommend' ? `Recommend outreach (${total}/100).`
      : verdict === 'improve-first' ? `Improve relevance before sending (${total}/100). Fastest gain: ${worst.label} (${worst.why})`
      : `Do not send (${total}/100). ${worst.label} is the biggest gap: ${worst.why}`,
    fastestImprovement: worst ? { key: worst.key, label: worst.label, why: worst.why } : null,
    isSuggestion: true,
  };
}

// ---------------------------------------------------------------------------
// Authority score — 0-100 composite. Weights in settings.authorityWeights.
// Conversations and commercial outcomes weigh far more than volume.
// ---------------------------------------------------------------------------
export function authorityScore() {
  const s = settings();
  const w = s.authorityWeights || {
    operatorCredibility: 20, publishedThinking: 15, distinctPointOfView: 15,
    relationshipQuality: 15, speakingMedia: 10, commercialOutcomes: 15,
    consistency: 5, marketRelevance: 5,
  };
  const content = items('content');
  const published = content.filter((x) => x.stage === 'published');
  const contacts = items('contacts');
  const interactions = items('interactions');
  const opps = items('opportunities');
  const outreach = items('outreach');

  const comps = [];
  const add = (key, label, fraction, why, missing) =>
    comps.push({ key, label, weight: w[key], points: Math.round(w[key] * clamp(fraction, 0, 1)), why, missing });

  const credPieces = published.filter((x) => (x.score?.criteria?.operatorCredibility || 0) >= 4).length;
  add('operatorCredibility', 'Operator credibility',
    published.length ? credPieces / Math.max(published.length, 4) + 0.4 : 0.2,
    `${credPieces}/${published.length} published pieces score 4+ on operator credibility.`,
    published.length < 4 ? 'Fewer than 4 published pieces. Score has low confidence.' : null);

  const avgQuality = published.length ? published.reduce((sum, x) => sum + (x.score?.total || 30), 0) / published.length / 60 : 0;
  add('publishedThinking', 'Quality of published thinking', avgQuality,
    published.length ? `Average scorecard ${Math.round(avgQuality * 60)}/60 across ${published.length} published pieces.` : 'Nothing published yet.',
    published.length ? null : 'No published content.');

  const povPieces = content.filter((x) => x.pov).length;
  add('distinctPointOfView', 'Distinct point of view', povPieces / Math.max(content.length, 6),
    `${povPieces}/${content.length} content items carry a stated view.`, null);

  const strong = contacts.filter((c) => relationshipStrength(c, interactions).band !== 'cold' && !c.fictionalOnly);
  add('relationshipQuality', 'Relationship quality', strong.length / Math.max(contacts.length, 10),
    `${strong.length}/${contacts.length} contacts have live (non-cold) relationships.`,
    contacts.length < 10 ? 'Small contact base; low confidence.' : null);

  const speaking = opps.filter((o) => ['speaking', 'podcast', 'media'].includes(o.type)).length;
  add('speakingMedia', 'Speaking and media evidence', clamp(speaking / 3, 0, 1),
    `${speaking} speaking/podcast/media opportunities on record.`,
    speaking ? null : 'No speaking or media evidence yet.');

  const won = opps.filter((o) => o.stage === 'won');
  const conversations = outreach.filter((o) => ['conversation', 'meeting', 'opportunity'].includes(o.stage)).length;
  add('commercialOutcomes', 'Commercial outcomes', clamp((won.length * 0.5 + conversations * 0.15), 0, 1),
    `${won.length} won, ${conversations} outreach records reached a real conversation.`,
    won.length ? null : 'No won commercial outcomes yet.');

  const recentPublished = published.filter((x) => daysSince(x.publishedDate) <= 30).length;
  add('consistency', 'Consistency', clamp(recentPublished / 4, 0, 1),
    `${recentPublished} pieces published in the last 30 days.`, null);

  const { core } = laneInfo();
  const coveredCore = core.filter((name) => content.some((x) => (x.lanes || []).includes(name)));
  add('marketRelevance', 'Market relevance', core.length ? coveredCore.length / core.length : 0,
    `Content covers ${coveredCore.length}/${core.length} core pillar lanes (uncovered: ${core.filter((n) => !coveredCore.includes(n)).join(', ') || 'none'}).`,
    coveredCore.length < core.length / 2 ? 'More than half the core pillar lanes have no content yet.' : null);

  const total = comps.reduce((sum, x) => sum + x.points, 0);
  const missing = comps.filter((x) => x.missing).map((x) => x.missing);
  return {
    total, components: comps, missing,
    confidence: missing.length >= 3 ? 'low' : missing.length ? 'medium' : 'reasonable',
    note: 'A composite indicator, not objective truth. Weights are editable in Settings.',
  };
}
