// recommend.mjs — the Today engine. Composes a small prioritised list of
// actions, each with the why, the why-now, the linked record, an expected
// value and a confidence. Direct recommendations, not passive reporting.

import { items } from './store.mjs';
import { relationshipStrength, laneInfo } from './scoring.mjs';

const daysSince = (iso) => (iso ? (Date.now() - new Date(iso).getTime()) / 86400000 : Infinity);
const daysUntil = (iso) => (iso ? (new Date(iso).getTime() - Date.now()) / 86400000 : Infinity);

export function todayBriefing({ limit = 7 } = {}) {
  const actions = [];
  const push = (a) => actions.push({ confidence: 'medium', ...a });

  const tasks = items('tasks').filter((t) => t.status !== 'done');
  const contacts = items('contacts');
  const interactions = items('interactions');
  const content = items('content');
  const outreach = items('outreach');
  const opps = items('opportunities');
  const insights = items('insights');
  const engagements = items('engagements');
  const byId = (list) => Object.fromEntries(list.map((x) => [x.id, x]));
  const contactById = byId(contacts);

  // 1. Follow-ups due or overdue.
  for (const t of tasks.filter((t) => daysUntil(t.due) <= 0.5)) {
    const overdue = Math.max(0, Math.round(-daysUntil(t.due)));
    push({
      kind: 'follow-up', priority: 90 + Math.min(overdue, 8),
      title: t.title,
      why: 'A committed follow-up. Missed follow-ups are the cheapest pipeline to lose.',
      whyNow: overdue ? `${overdue} day(s) overdue.` : 'Due today.',
      relatedType: t.relatedType, relatedId: t.relatedId,
      expectedValue: 'Keeps a live thread warm', confidence: 'high',
      nextStep: t.title, taskId: t.id,
    });
  }

  // 2. Content sitting in review — approval is the bottleneck Stuart owns.
  for (const c of content.filter((c) => c.stage === 'review')) {
    push({
      kind: 'approve-content', priority: 80,
      title: `Review and approve: "${c.title}"`,
      why: `Scored ${c.score?.total ?? '—'}/60 (${c.score?.recommendation || 'unscored'}). Publishing consistency is a component of the authority score.`,
      whyNow: `In review since ${ (c.updatedAt || '').slice(0, 10)}.`,
      relatedType: 'content', relatedId: c.id,
      expectedValue: 'One published authority piece', confidence: 'high',
      nextStep: 'Open the draft, apply the weakest-criteria edits, approve or reject.',
    });
  }

  // 3. Approved outreach waiting for Stuart to actually send.
  for (const o of outreach.filter((o) => o.stage === 'approved')) {
    const c = contactById[o.contactId];
    push({
      kind: 'send-outreach', priority: 78,
      title: `Send the approved message to ${c?.name || o.contactId}`,
      why: `Approved but not sent. Trigger: ${o.trigger || 'n/a'}. Score ${o.score?.total ?? '—'}/100.`,
      whyNow: 'Triggers decay. A timely reason to write expires within days.',
      relatedType: 'outreach', relatedId: o.id,
      expectedValue: 'A qualified conversation', confidence: 'medium',
      nextStep: 'Copy the message into LinkedIn/email, send it yourself, then mark it sent.',
    });
  }

  // 4. Drafted outreach that scored well and needs approval.
  for (const o of outreach.filter((o) => o.stage === 'drafted' && (o.score?.total || 0) >= 75)) {
    const c = contactById[o.contactId];
    push({
      kind: 'approve-outreach', priority: 70,
      title: `Approve or edit the draft to ${c?.name || o.contactId}`,
      why: `Qualification score ${o.score.total}/100 (recommend). Reason: ${o.reason || o.trigger || ''}`,
      whyNow: 'High-scoring drafts are the ones worth Stuart’s minutes.',
      relatedType: 'outreach', relatedId: o.id,
      expectedValue: 'A qualified conversation', confidence: 'medium',
      nextStep: 'Read the evidence panel, edit the message, approve.',
    });
  }

  // 5. Stale opportunities.
  for (const o of opps.filter((o) => !['won', 'lost', 'nurture'].includes(o.stage))) {
    const stale = daysSince(o.lastActivityAt || o.updatedAt);
    if (stale >= 10) {
      push({
        kind: 'unstick-opportunity', priority: 72 + Math.min(Math.round(stale / 10), 8),
        title: `Unstick: ${o.name} (${o.stage})`,
        why: `No activity for ${Math.round(stale)} days at stage "${o.stage}". Estimated value ${o.estimatedValue || 'unset'}.`,
        whyNow: 'Stalled deals die quietly. One specific next action restarts it or disqualifies it.',
        relatedType: 'opportunities', relatedId: o.id,
        expectedValue: o.estimatedValue || 'unknown', confidence: 'high',
        nextStep: o.nextAction || 'Set a concrete next action or move it to nurture/lost honestly.',
      });
    }
  }

  // 6. Warm relationships going cold.
  for (const c of contacts) {
    if (c.doNotContact) continue;
    const s = relationshipStrength(c, interactions);
    if (s.band === 'warm' && daysSince(s.lastInteraction) > 45 && daysSince(s.lastInteraction) < 200) {
      push({
        kind: 'reconnect', priority: 55,
        title: `Reconnect with ${c.name} (${c.role || ''}${c.company ? ', ' + c.company : ''})`,
        why: `A warm relationship going quiet: ${s.evidence[0] || ''}`,
        whyNow: `${Math.round(daysSince(s.lastInteraction))} days since the last touch. Warm decays to cold around 60-90 days.`,
        relatedType: 'contacts', relatedId: c.id,
        expectedValue: 'Preserves a real relationship', confidence: 'medium',
        nextStep: 'Find a genuine reason (their news, a shared theme) and draft a short reconnect.',
      });
    }
  }

  // 7. Repeated engagers not yet in the relationship base.
  const engCount = {};
  for (const e of engagements) {
    const key = e.contactId || e.personName;
    if (key) engCount[key] = (engCount[key] || 0) + 1;
  }
  for (const [key, n] of Object.entries(engCount)) {
    if (n >= 3) {
      const c = contactById[key];
      push({
        kind: 'promote-engager', priority: 60,
        title: `${c?.name || key} has engaged ${n} times`,
        why: 'Repeated meaningful engagement is the strongest inbound relationship evidence this system has.',
        whyNow: 'Momentum is live; a DM now lands as natural, in a month it lands as odd.',
        relatedType: c ? 'contacts' : 'engagements', relatedId: c?.id || null,
        expectedValue: 'A warm relationship, possibly a conversation', confidence: 'high',
        nextStep: c ? 'Draft a short DM referencing what they engaged with.' : 'Create the contact record, then draft a DM.',
      });
    }
  }

  // 8. Strong unprocessed insights — core-pillar lanes jump the queue.
  const lanesMeta = laneInfo();
  for (const i of insights.filter((i) => i.status === 'captured' && (i.commercialRelevance || 0) >= 4)) {
    const coreLanes = (i.lanes || []).filter((l) => lanesMeta.byName[l]?.tier === 'core');
    push({
      kind: 'develop-insight', priority: coreLanes.length ? 62 : 50,
      title: `Develop the insight: "${i.title}"`,
      why: `Commercial relevance ${i.commercialRelevance}/5, untouched since capture.${coreLanes.length ? ` Sits in core pillar lane(s): ${coreLanes.join(', ')} — the authority the positioning depends on.` : ''}`,
      whyNow: 'Captured but unrouted. Two of these a week keeps the content pipeline fed.',
      relatedType: 'insights', relatedId: i.id,
      expectedValue: 'One or more content pieces and outreach angles', confidence: 'medium',
      nextStep: 'Run the distillation and confidentiality review, then route it.',
    });
  }

  // 8b. Detected leads waiting for research or action.
  const leads = items('leads').filter((l) => ['detected', 'researched'].includes(l.status));
  for (const l of leads.slice(0, 6)) {
    const ev = (l.evidence || [])[0];
    push({
      kind: 'work-lead', priority: l.linkedContactId ? 68 : 58,
      title: `${l.status === 'detected' ? 'Research lead' : 'Act on lead'}: ${l.name} (${l.signal})`,
      why: `${l.why} Evidence: "${(ev?.quote || '').slice(0, 120)}"`,
      whyNow: 'Buying signals decay in days; a funding round or new hire is only a natural opener while it is news.',
      relatedType: 'leads', relatedId: l.id,
      expectedValue: l.pillar === 'prediction-markets' ? 'Category relationship or NEXTPredict-adjacent intel' : 'A Strait Up Growth prospect conversation',
      confidence: 'medium',
      nextStep: l.suggestedNextStep,
    });
  }

  // 9. Repeatedly deferred tasks — either do them or delete them.
  for (const t of tasks.filter((t) => (t.deferredCount || 0) >= 3)) {
    push({
      kind: 'deferred-task', priority: 45,
      title: `Deferred ${t.deferredCount} times: ${t.title}`,
      why: 'Anything snoozed three times is either important and avoided, or unimportant and clutter.',
      whyNow: 'Decide once: do it now, schedule it properly, or delete it.',
      relatedType: t.relatedType, relatedId: t.relatedId,
      expectedValue: 'Attention reclaimed', confidence: 'high',
      nextStep: 'Do, reschedule with a real date, or delete.', taskId: t.id,
    });
  }

  actions.sort((a, b) => b.priority - a.priority);

  // One thing to STOP doing — the cheapest strategic advice in the product.
  const laneCounts = {};
  for (const c of content) for (const l of c.lanes || []) laneCounts[l] = (laneCounts[l] || 0) + 1;
  const sorted = Object.entries(laneCounts).sort((a, b) => b[1] - a[1]);
  let stopDoing = null;
  // Supporting lanes must never dominate the pillars the positioning needs.
  const recentPublished = content.filter((c) => c.stage === 'published' && daysSince(c.publishedDate) <= 30);
  const supportingShare = recentPublished.length >= 4
    ? recentPublished.filter((c) => (c.lanes || []).every((l) => lanesMeta.byName[l]?.tier !== 'core')).length / recentPublished.length
    : 0;
  if (supportingShare > 0.5) {
    stopDoing = {
      title: 'Cut back the supporting-lane content this week',
      why: `${Math.round(supportingShare * 100)}% of the last 30 days' published pieces sit entirely outside the core pillars (Strait Up Growth / Singapore & SEA, prediction markets). Context lanes build colour, not authority; the pillars are starving.`,
    };
  } else if (sorted.length && content.length >= 5 && sorted[0][1] / content.length > 0.5) {
    stopDoing = {
      title: `Ease off "${sorted[0][0]}" for a week`,
      why: `${sorted[0][1]} of ${content.length} content items sit in one lane. Over-concentration reads as a one-note feed and starves the other lanes the positioning depends on.`,
    };
  } else {
    const noOutcome = content.filter((c) => c.stage === 'published' && !(c.performance?.conversationsCreated?.length)).length;
    if (noOutcome >= 3) stopDoing = {
      title: 'Stop publishing formats that create no conversations',
      why: `${noOutcome} published pieces produced no logged conversation. Check the analytics view for which formats those were and drop one.`,
    };
  }

  return {
    generatedAt: new Date().toISOString(),
    actions: actions.slice(0, Math.max(limit, 3)),
    allActions: actions,
    stopDoing,
    counts: {
      followUpsDue: tasks.filter((t) => daysUntil(t.due) <= 0.5).length,
      contentInReview: content.filter((c) => c.stage === 'review').length,
      outreachAwaitingApproval: outreach.filter((o) => o.stage === 'drafted').length,
      approvedUnsent: outreach.filter((o) => o.stage === 'approved').length,
      openOpportunities: opps.filter((o) => !['won', 'lost'].includes(o.stage)).length,
      unprocessedInsights: insights.filter((i) => i.status === 'captured').length,
      leadsToWork: leads.length,
    },
  };
}
