// analytics.mjs — computed views over the committed data. Answers
// commercial questions (conversations, pipeline, attribution), treats
// impressions as a supporting indicator only. Attribution is classified,
// never faked as precise: direct-source | strong | supporting | none.

import { items } from './store.mjs';
import { relationshipStrength, authorityScore } from './scoring.mjs';

const daysSince = (iso) => (iso ? (Date.now() - new Date(iso).getTime()) / 86400000 : Infinity);
const sum = (arr, f) => arr.reduce((s, x) => s + (f(x) || 0), 0);

export function analytics() {
  const content = items('content');
  const published = content.filter((c) => c.stage === 'published');
  const contacts = items('contacts');
  const interactions = items('interactions');
  const outreach = items('outreach');
  const opps = items('opportunities');
  const engagements = items('engagements');
  const tasks = items('tasks');
  const lanes = items('lanes');

  // ----- Executive scorecard ------------------------------------------------
  const sent = outreach.filter((o) => o.sentAt);
  const replied = sent.filter((o) => o.reply?.text);
  const positive = replied.filter((o) => o.reply?.sentiment === 'positive');
  const conversations = outreach.filter((o) => ['conversation', 'meeting', 'opportunity'].includes(o.stage));
  const openOpps = opps.filter((o) => !['won', 'lost'].includes(o.stage));
  const won = opps.filter((o) => o.stage === 'won');
  const followUps = tasks.filter((t) => t.kind === 'follow-up');
  const followUpsDone = followUps.filter((t) => t.status === 'done');

  const scorecard = {
    qualifiedConversations: conversations.length,
    meetingsBooked: outreach.filter((o) => ['meeting', 'opportunity'].includes(o.stage)).length + items('interactions').filter((i) => i.kind === 'meeting' && daysSince(i.date) <= 90).length,
    openOpportunities: openOpps.length,
    pipelineValue: sum(openOpps, (o) => o.estimatedValue),
    weightedPipeline: Math.round(sum(openOpps, (o) => (o.estimatedValue || 0) * (o.probability || 0))),
    revenueWon: sum(won, (o) => o.revenue || o.estimatedValue),
    outreachSent: sent.length,
    replyRate: sent.length ? Math.round((replied.length / sent.length) * 100) : null,
    positiveReplyRate: sent.length ? Math.round((positive.length / sent.length) * 100) : null,
    followUpCompletion: followUps.length ? Math.round((followUpsDone.length / followUps.length) * 100) : null,
    publishedLast30d: published.filter((c) => daysSince(c.publishedDate) <= 30).length,
    warmRelationships: contacts.filter((c) => ['warm', 'strong'].includes(relationshipStrength(c, interactions).band)).length,
  };

  // ----- Content intelligence ------------------------------------------------
  const byLane = {};
  for (const lane of lanes) byLane[lane.name] = { lane: lane.name, items: 0, published: 0, conversations: 0, opportunities: 0 };
  for (const c of content) {
    for (const l of c.lanes || []) {
      byLane[l] = byLane[l] || { lane: l, items: 0, published: 0, conversations: 0, opportunities: 0 };
      byLane[l].items += 1;
      if (c.stage === 'published') byLane[l].published += 1;
      byLane[l].conversations += (c.performance?.conversationsCreated || []).length;
      byLane[l].opportunities += (c.performance?.opportunitiesInfluenced || []).length;
    }
  }
  const laneMeta = Object.fromEntries(lanes.map((l) => [l.name, l]));
  const laneRows = Object.values(byLane)
    .map((r) => ({ ...r, tier: laneMeta[r.lane]?.tier || 'supporting', pillar: laneMeta[r.lane]?.pillar || null }))
    .sort((a, b) => (a.tier === 'core' ? 0 : 1) - (b.tier === 'core' ? 0 : 1) || b.conversations - a.conversations || b.items - a.items);

  // Pillar rollup — is each authority pillar actually being fed?
  const leadsAll = items('leads');
  const pillars = {};
  const pillarNames = [...new Set(lanes.map((l) => l.pillar).filter(Boolean))];
  for (const p of pillarNames) {
    const pLanes = lanes.filter((l) => l.pillar === p).map((l) => l.name);
    const pContent = content.filter((c) => (c.lanes || []).some((l) => pLanes.includes(l)));
    pillars[p] = {
      pillar: p,
      lanes: pLanes,
      contentItems: pContent.length,
      published30d: pContent.filter((c) => c.stage === 'published' && daysSince(c.publishedDate) <= 30).length,
      conversations: pContent.reduce((s, c) => s + (c.performance?.conversationsCreated || []).length, 0),
      opportunities: opps.filter((o) => (o.lanes || []).some((l) => pLanes.includes(l)) || pContent.some((c) => (c.performance?.opportunitiesInfluenced || []).includes(o.id))).length,
      leadsDetected: leadsAll.filter((l) => l.pillar === p && !['dismissed'].includes(l.status)).length,
    };
  }
  const contentRows = published.map((c) => ({
    id: c.id, title: c.title, format: c.format, lanes: c.lanes || [],
    publishedDate: c.publishedDate,
    impressions: c.performance?.impressions ?? null,
    comments: c.performance?.comments ?? null,
    conversations: (c.performance?.conversationsCreated || []).length,
    opportunities: (c.performance?.opportunitiesInfluenced || []).length,
    score: c.score?.total ?? null,
  })).sort((a, b) => b.conversations - a.conversations);
  const deadContent = contentRows.filter((c) => !c.conversations && !c.opportunities && daysSince(c.publishedDate) > 14);

  // ----- Relationship intelligence -------------------------------------------
  const relRows = contacts.map((c) => {
    const s = relationshipStrength(c, interactions);
    return { id: c.id, name: c.name, company: c.company, type: c.relationshipType, band: s.band, score: s.score, last: s.lastInteraction, evidence: s.evidence[0] || '' };
  });
  const goingCold = relRows.filter((r) => r.band === 'warm' && daysSince(r.last) > 45);
  const engagerCounts = {};
  for (const e of engagements) {
    const key = e.contactId || e.personName || 'unknown';
    engagerCounts[key] = (engagerCounts[key] || 0) + 1;
  }

  // ----- Outreach intelligence ------------------------------------------------
  const byPurpose = {};
  for (const o of outreach) {
    const p = o.purpose || 'unspecified';
    byPurpose[p] = byPurpose[p] || { purpose: p, drafted: 0, sent: 0, replied: 0, positive: 0, conversations: 0 };
    byPurpose[p].drafted += 1;
    if (o.sentAt) byPurpose[p].sent += 1;
    if (o.reply?.text) byPurpose[p].replied += 1;
    if (o.reply?.sentiment === 'positive') byPurpose[p].positive += 1;
    if (['conversation', 'meeting', 'opportunity'].includes(o.stage)) byPurpose[p].conversations += 1;
  }

  // ----- Pipeline + attribution -----------------------------------------------
  const ATTRIBUTION = ['direct-source', 'strong-influence', 'supporting-influence', 'no-proven-influence'];
  const attributionRows = opps.map((o) => ({
    id: o.id, name: o.name, stage: o.stage, value: o.estimatedValue || 0,
    source: o.source || 'unknown',
    contentInfluence: o.contentInfluence || 'no-proven-influence',
    relatedContent: o.relatedContent || [], relatedOutreach: o.relatedOutreach || [],
  }));
  const contentInfluenced = attributionRows.filter((o) => ['direct-source', 'strong-influence', 'supporting-influence'].includes(o.contentInfluence));
  const bySource = {};
  for (const o of opps) {
    const src = o.source || 'unknown';
    bySource[src] = bySource[src] || { source: src, count: 0, value: 0, won: 0 };
    bySource[src].count += 1;
    bySource[src].value += o.estimatedValue || 0;
    if (o.stage === 'won') bySource[src].won += 1;
  }
  const byStage = {};
  for (const o of opps) {
    byStage[o.stage] = byStage[o.stage] || { stage: o.stage, count: 0, value: 0 };
    byStage[o.stage].count += 1;
    byStage[o.stage].value += o.estimatedValue || 0;
  }
  const stale = openOpps.filter((o) => daysSince(o.lastActivityAt || o.updatedAt) >= 10)
    .map((o) => ({ id: o.id, name: o.name, stage: o.stage, days: Math.round(daysSince(o.lastActivityAt || o.updatedAt)) }));

  return {
    generatedAt: new Date().toISOString(),
    scorecard,
    authority: authorityScore(),
    content: { byLane: laneRows, pieces: contentRows, noDownstreamAction: deadContent },
    pillars: Object.values(pillars),
    relationships: {
      rows: relRows.sort((a, b) => b.score - a.score),
      goingCold,
      repeatEngagers: Object.entries(engagerCounts).filter(([, n]) => n >= 2).map(([k, n]) => ({ key: k, count: n })),
    },
    outreach: { byPurpose: Object.values(byPurpose), records: outreach.length },
    pipeline: { byStage: Object.values(byStage), bySource: Object.values(bySource), stale, attribution: attributionRows, contentAssisted: contentInfluenced.length, attributionClasses: ATTRIBUTION },
    caveat: 'Attribution reflects the evidence Stuart logged, nothing more. Impressions are supporting indicators, not success metrics.',
  };
}
