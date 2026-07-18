#!/usr/bin/env node
// ideas-bank.mjs — the automatic ideas bank + posting strategy.
// Deterministic (next-os rule R3: deterministic beats model): every run
// refreshes (1) a capped bank of post ideas as content items in the
// raw-idea stage, each with provenance and a rationale, and (2) the
// posting strategy document data/strategy.json — where and what to post
// over the next 7 days, per pillar and channel, with gaps flagged.
// The scheduled Claude layer (automation/daily-update.md) adds judgement
// on top; this script guarantees the bank never runs dry even with no
// API key and no model.
//
//   node scripts/ideas-bank.mjs [--dry-run] [--max 10]
//
// Idea sources: unrouted insights (core pillars jump the queue), pillar
// gap-fills via the angle library, repurpose candidates (pieces that
// created conversations but never travelled to another channel), dated
// predictions due a public revisit, and live engagement threads.
// Ideas carry a generatedKey: archiving one stops it being regenerated.

import { items, insert, read, write } from '../lib/store.mjs';
import { connectInsight, hasConnections } from '../lib/connect.mjs';

const DRY = process.argv.includes('--dry-run');
const maxArg = process.argv.indexOf('--max');
const MAX_OPEN = maxArg > -1 ? Number(process.argv[maxArg + 1]) : 10;

const now = new Date();
const today = now.toISOString().slice(0, 10);
const daysSince = (iso) => (iso ? (now.getTime() - new Date(iso).getTime()) / 86400000 : Infinity);
const plusDays = (n) => new Date(now.getTime() + n * 86400000).toISOString().slice(0, 10);

const lanes = items('lanes');
const laneByName = Object.fromEntries(lanes.map((l) => [l.name, l]));
const pillars = [...new Set(lanes.map((l) => l.pillar).filter(Boolean))];
const pillarLanes = (p) => lanes.filter((l) => l.pillar === p).map((l) => l.name);
const content = items('content');
const insights = items('insights');
const calendar = items('calendar');
const engagements = items('engagements');
const channels = items('channels');
const angles = items('knowledge').filter((k) => k.kind === 'angle');
const contacts = items('contacts');
const companies = items('companies');
const leads = items('leads');

// Connect an insight to the companies, contacts, lane-relevant readers and open
// leads it touches, so each generated idea carries its dots and the rationale
// says who/what it connects to. Internal drafting guidance only — publishing an
// idea still runs the confidentiality review before anything goes public.
const connOf = (insight) => connectInsight(insight, { companies, contacts, leads });
const connSuffix = (c) => (hasConnections(c) ? ` Connects to — ${c.line}.` : '');

const existingKeys = new Set(content.map((c) => c.generatedKey).filter(Boolean));
const openAutoIdeas = content.filter((c) => c.stage === 'raw-idea' && c.generatedKey);

// ---------------------------------------------------------------------------
// Candidate ideas, in priority order.
// ---------------------------------------------------------------------------
const candidates = [];
const push = (key, idea) => candidates.push({ key, ...idea });

// 1. Unrouted insights, core pillars first. Confidential material never
// enters the ideas bank; public-after-anonymisation is allowed but the
// rationale carries the warning.
const usable = (i) => !['private-operating-lesson', 'strictly-confidential'].includes(i.confidentiality?.classification);
const unrouted = insights
  .filter((i) => ['captured', 'distilled'].includes(i.status) && (i.commercialRelevance || 0) >= 3 && usable(i))
  .sort((a, b) => {
    const coreA = (a.lanes || []).some((l) => laneByName[l]?.tier === 'core') ? 1 : 0;
    const coreB = (b.lanes || []).some((l) => laneByName[l]?.tier === 'core') ? 1 : 0;
    return coreB - coreA || (b.commercialRelevance || 0) - (a.commercialRelevance || 0);
  });
for (const i of unrouted) {
  const conn = connOf(i);
  push(`insight:${i.id}`, {
    title: i.title, format: 'linkedin-post', lanes: i.lanes || [],
    sourceInsights: [i.id], evidence: [`insight:${i.id}`], connections: conn,
    rationale: `Unrouted insight (relevance ${i.commercialRelevance}/5${(i.lanes || []).some((l) => laneByName[l]?.tier === 'core') ? ', core pillar lane' : ''}). Distil, then draft.${i.confidentiality?.classification === 'public-after-anonymisation' ? ' ANONYMISE FIRST: source is public-after-anonymisation.' : ''}${connSuffix(conn)}`,
  });
}

// 2. Pillar gap-fills: a pillar with nothing published in 30 days gets an
// angle-library assignment against its freshest insight (or a capture ask).
for (const p of pillars) {
  const pl = pillarLanes(p);
  const published30 = content.filter((c) => c.stage === 'published' && daysSince(c.publishedDate) <= 30 && (c.lanes || []).some((l) => pl.includes(l)));
  if (published30.length > 0) continue;
  const freshest = insights.filter((i) => usable(i) && (i.lanes || []).some((l) => pl.includes(l))).sort((a, b) => (a.date < b.date ? 1 : -1))[0];
  const angle = angles[(p.length + now.getUTCDate()) % Math.max(angles.length, 1)];
  if (freshest && angle) {
    const conn = connOf(freshest);
    push(`gapfill:${p}:${freshest.id}:${angle.id}`, {
      title: `${angle.title.replace('Angle: ', '')}: ${freshest.title}`,
      format: 'linkedin-post', lanes: (freshest.lanes || []).filter((l) => pl.includes(l)).slice(0, 2),
      sourceInsights: [freshest.id], evidence: [`insight:${freshest.id}`, `angle:${angle.id}`], connections: conn,
      rationale: `Pillar "${p}" has published nothing in 30 days. Run its freshest insight through the "${angle.title.replace('Angle: ', '')}" wedge.${connSuffix(conn)}`,
    });
  }
}

// 3. Repurpose candidates: pieces that created conversations but never
// travelled to another channel.
for (const c of content.filter((c) => c.stage === 'published' && (c.performance?.conversationsCreated || []).length >= 1)) {
  const travelled = content.some((x) => x.repurposedFrom === c.id);
  if (travelled) continue;
  const target = c.format === 'linkedin-post' ? 'substack-newsletter' : 'linkedin-post';
  push(`repurpose:${c.id}:${target}`, {
    title: `Repurpose for ${target}: ${c.title}`,
    format: target, lanes: c.lanes || [], sourceInsights: c.sourceInsights || [],
    evidence: [`content:${c.id} created ${(c.performance.conversationsCreated || []).length} conversation(s)`],
    rationale: `Proven idea (${(c.performance.conversationsCreated || []).length} conversations) that has only run on one channel. Rebuild it for ${target}; never paste.`,
    repurposeOf: c.id,
  });
}

// 4. Dated predictions due a public revisit (the revisit is a second post
// and compounding credibility, right or wrong).
for (const i of insights.filter((i) => i.type === 'prediction' && daysSince(i.date) >= 60)) {
  const conn = connOf(i);
  push(`revisit:${i.id}`, {
    title: `Revisit the prediction: ${i.title}`,
    format: 'linkedin-post', lanes: i.lanes || [], sourceInsights: [i.id],
    evidence: [`insight:${i.id} (${Math.round(daysSince(i.date))} days old)`], connections: conn,
    rationale: `A dated prediction on record. Revisiting it publicly, right or wrong, is the highest-trust format available.${connSuffix(conn)}`,
  });
}

// 5. Live engagement threads worth a post.
for (const e of engagements.filter((e) => e.status === 'open' && e.contactId && ['comment', 'dm'].includes(e.kind))) {
  const who = contacts.find((c) => c.id === e.contactId)?.name || e.personName;
  push(`engagement:${e.id}`, {
    title: `Develop the thread with ${who} into a post`,
    format: 'linkedin-post', lanes: contacts.find((c) => c.id === e.contactId)?.lanes || [],
    sourceInsights: [], evidence: [`engagement:${e.id}: "${(e.text || '').slice(0, 100)}"`],
    rationale: 'A real question from a real reader is a pre-validated post. Answer it properly in public, credit the question.',
  });
}

// ---------------------------------------------------------------------------
// Land new ideas up to the cap. Archived ideas never regenerate.
// ---------------------------------------------------------------------------
let slots = Math.max(0, MAX_OPEN - openAutoIdeas.length);
const added = [];
for (const cand of candidates) {
  if (slots <= 0) break;
  if (existingKeys.has(cand.key)) continue;
  existingKeys.add(cand.key);
  const item = {
    title: cand.title, format: cand.format, lanes: cand.lanes, objective: null,
    stage: 'raw-idea', sourceInsights: cand.sourceInsights, evidence: cand.evidence,
    pov: null, body: '', brand: 'brand-stuart', audiences: [], performance: null,
    versions: [], confidentiality: 'public', generatedKey: cand.key,
    generatedRationale: cand.rationale, generatedAt: now.toISOString(),
    ...(cand.connections && hasConnections(cand.connections) ? { connections: cand.connections } : {}),
    ...(cand.repurposeOf ? { repurposeCandidateOf: cand.repurposeOf } : {}),
  };
  if (!DRY) insert('content', item, { actor: 'ideas-bank' });
  added.push(cand);
  slots--;
}

// ---------------------------------------------------------------------------
// Posting strategy: next 7 days, per channel, from the real calendar plus
// gap suggestions. Regenerated in place (stable doc, no dated files).
// ---------------------------------------------------------------------------
const week = [...Array(7)].map((_, d) => plusDays(d));
const activeChannels = channels.filter((c) => c.status === 'active');
const channelPlan = [];
for (const date of week) {
  const scheduled = calendar.filter((i) => i.date === date && !i.fictional);
  for (const s of scheduled) {
    channelPlan.push({ date, channel: s.channel || s.format, what: s.title, status: s.status, source: 'master schedule', verification: s.verification || null });
  }
}
const gaps = [];
for (const ch of activeChannels) {
  const covered = channelPlan.some((r) => (r.channel || '').toLowerCase().includes(ch.name.split(' ')[0].toLowerCase()));
  if (!covered) {
    const idea = added[0] || openAutoIdeas[0];
    gaps.push({
      channel: ch.name,
      suggestion: idea
        ? `Nothing scheduled this week. Candidate from the ideas bank: "${idea.title}".`
        : 'Nothing scheduled this week and the ideas bank is empty for it. Capture an insight or pull from the angle library.',
    });
  }
}

const themeByPillar = {};
for (const p of pillars) {
  const pl = pillarLanes(p);
  const recent = insights.filter((i) => (i.lanes || []).some((l) => pl.includes(l))).sort((a, b) => (a.date < b.date ? 1 : -1));
  const laneCounts = {};
  for (const i of recent.slice(0, 8)) for (const l of i.lanes || []) if (pl.includes(l)) laneCounts[l] = (laneCounts[l] || 0) + 1;
  const top = Object.entries(laneCounts).sort((a, b) => b[1] - a[1])[0];
  themeByPillar[p] = top ? top[0] : pl[0];
}

const suggestions = [];
for (const p of pillars) {
  const pl = pillarLanes(p);
  const pub30 = content.filter((c) => c.stage === 'published' && daysSince(c.publishedDate) <= 30 && (c.lanes || []).some((l) => pl.includes(l))).length;
  if (pub30 === 0) suggestions.push(`Pillar "${p}" is starving: nothing published in 30 days. This week's theme for it: ${themeByPillar[p]}.`);
}
const gated = calendar.filter((i) => !i.fictional && week.includes(i.date) && /unverified|conditional|confirm/.test(i.status || ''));
for (const g of gated.slice(0, 5)) suggestions.push(`Verification gate due ${g.date}: "${g.title}" must not run without a primary source (${g.verification || 'see schedule'}).`);
for (const ch of channels.filter((c) => c.status === 'suggested').slice(0, 2)) {
  suggestions.push(`Channel watch: ${ch.name}. Adopt when: ${ch.watchSignal}`);
}

const strategy = {
  meta: { note: 'Posting strategy, regenerated in place by scripts/ideas-bank.mjs (+ the scheduled Claude layer). Suggestions, never verdicts.' },
  values: {
    generatedAt: now.toISOString(), weekOf: today,
    themeByPillar, channelPlan, gaps, suggestions,
    ideasBank: { open: openAutoIdeas.length + added.length, addedThisRun: added.length, cap: MAX_OPEN },
    claudeNotes: read('strategy').values?.claudeNotes || [],
  },
};
if (!DRY) write('strategy', strategy);

// ---------------------------------------------------------------------------
console.log(`\nIDEAS BANK ${DRY ? '(dry run) ' : ''}— ${today}`);
console.log('='.repeat(60));
console.log(`open auto-generated ideas: ${openAutoIdeas.length} + ${added.length} new (cap ${MAX_OPEN})`);
for (const a of added) console.log(`  + [${a.format}] ${a.title}\n      ${a.rationale}`);
console.log(`\nweek plan: ${channelPlan.length} scheduled item(s); gaps: ${gaps.map((g) => g.channel).join(', ') || 'none'}`);
for (const s of suggestions) console.log(`  · ${s}`);
console.log('\nFull plan: data/strategy.json → Today view. Commit data/ after.');
