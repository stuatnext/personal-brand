#!/usr/bin/env node
// self-test.mjs — drives the full vertical slice end to end through the
// real HTTP API, plus the safety gates. Re-seeds before and after so it
// always runs against (and leaves behind) the clean fictional dataset.
//
//   node scripts/self-test.mjs

import { execFileSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// Hermetic: run against a scratch data dir so real data/ is never touched.
const TESTDATA = fs.mkdtempSync(path.join(os.tmpdir(), 'engine-test-data-'));
process.env.ENGINE_DATA_DIR = TESTDATA;
const seed = () => execFileSync('node', [path.join(ROOT, 'scripts/seed.mjs'), '--force'], { stdio: 'pipe', env: { ...process.env, ENGINE_DATA_DIR: TESTDATA } });

let passed = 0, failed = 0;
function ok(cond, name, detail = '') {
  if (cond) { passed++; console.log(`  ok  ${name}`); }
  else { failed++; console.error(`FAIL  ${name}${detail ? ` — ${detail}` : ''}`); }
}

seed();
const { start } = await import('../scripts/serve.mjs');
const server = await start({ port: 0 });
const BASE = `http://127.0.0.1:${server.address().port}`;

async function call(method, p, body) {
  const res = await fetch(`${BASE}${p}`, {
    method, headers: { 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, data: await res.json() };
}
const get = (p) => call('GET', p);
const post = (p, b) => call('POST', p, b);
const patch = (p, b) => call('PATCH', p, b);
const action = (name, b) => post(`/api/actions/${name}`, b);

console.log('\n== Workflow: insight -> confidentiality -> content -> score -> approve -> publish ==');
const cap = await post('/api/collections/insights', {
  title: 'Test: proposals stall where nobody owns the follow-up',
  raw: 'Watched three proposals stall this month. In each case the proposal was fine; the follow-up had no owner and no date. The fix was a rule: no proposal goes out without a named follow-up owner and a date in the diary.',
  type: 'commercial-lesson', lanes: ['Commercial systems', 'GTM execution'],
  commercialRelevance: 4, date: new Date().toISOString().slice(0, 10),
  source: 'self-test', status: 'captured', audiences: [],
});
ok(cap.status === 201 && cap.data.id, '1. capture an insight');
const insId = cap.data.id;

const conf = await action('confidentiality', { insightId: insId });
ok(conf.status === 200 && conf.data.classification === 'public', '2. confidentiality review suggests public', JSON.stringify(conf.data));
const confirm = await action('confidentiality', { insightId: insId, confirm: 'public' });
ok(confirm.status === 200 && confirm.data.insight.confidentiality.confirmed === true, '2b. Stuart confirms classification');

const dist = await action('distill', { insightId: insId });
ok(dist.status === 200 && dist.data.insight.distilled?.coreInsight, `3. distillation (provider: ${dist.data.provider})`);

const draft = await action('draft-content', { insightId: insId, format: 'linkedin-post' });
ok(draft.status === 200 && draft.data.content?.body, '4. content draft created from insight');
const cntId = draft.data.content.id;
ok((draft.data.content.sourceInsights || []).includes(insId), '4b. provenance: draft cites its source insight');

const linked = await patch(`/api/collections/content/${cntId}`, {
  lanes: ['Commercial systems'], audiences: ['founders'], relatedContacts: ['con-s01'],
  body: `Watched three proposals stall this month. The proposals were fine. The follow-up had no owner and no date, so the deal drifted.\n\nThe fix we landed on was boring and it worked: no proposal leaves the building without a named follow-up owner and a date already in the diary. Ownership beats optimism.\n\nThe useful question is: who owns the follow-up on the last proposal you sent, and would they say the same?`,
  pov: 'Proposals do not close deals; owned follow-ups do.', objective: 'start-conversations',
});
ok(linked.status === 200, '5/6. content linked to lane, audience and contact');

const score = await action('score-content', { contentId: cntId });
ok(score.status === 200 && score.data.content.score?.total >= 36, `score: ${score.data.content.score?.total}/60 (${score.data.content.score?.recommendation})`);
ok(Array.isArray(score.data.content.score.weakest), 'scorecard explains weakest criteria');

await patch(`/api/collections/content/${cntId}`, { stage: 'review' });
const approveC = await action('approve', { type: 'content', id: cntId });
ok(approveC.status === 200 && approveC.data.content.stage === 'approved', 'content approved by human');
const pub = await action('mark-published', { contentId: cntId });
ok(pub.status === 200 && pub.data.content.stage === 'published', 'publication recorded (Stuart posted it himself)');

console.log('\n== Workflow: relationship -> outreach -> approve -> send -> reply -> opportunity ==');
const oDraft = await action('draft-outreach', {
  contactId: 'con-s01', purpose: 'follow-up-after-meeting',
  trigger: 'Mabel asked for the follow-up ownership rule after our scoping call this week',
  valueToRecipient: 'The one-line follow-up rule she can apply to her own live proposals immediately',
  evidence: ['int-s01: intro call where proposal drift came up', 'eng-s12: her reply asking to talk scoping'],
  channel: 'email',
});
ok(oDraft.status === 200 && oDraft.data.outreach.message, '7. outreach drafted with evidence');
const outId = oDraft.data.outreach.id;
ok(oDraft.data.outreach.score?.total >= 55, `8. quality check: ${oDraft.data.outreach.score?.total}/100 (${oDraft.data.outreach.score?.verdict})`);
ok(oDraft.data.outreach.score.rows.length === 7, '8b. score shows all 7 weighted factors');

const premature = await action('mark-sent', { outreachId: outId });
ok(premature.status === 409, 'GATE: cannot record a send before approval', JSON.stringify(premature.data));

const approveO = await action('approve', { type: 'outreach', id: outId });
ok(approveO.status === 200 && approveO.data.outreach.stage === 'approved', '9. human approval');
const sent = await action('mark-sent', { outreachId: outId });
ok(sent.status === 200 && sent.data.followUpTask?.id, '10. send recorded manually + follow-up task created');

const reply = await action('record-reply', { outreachId: outId, text: 'Love it. Can we put 30 minutes in next week?', sentiment: 'positive', createOpportunity: true });
ok(reply.status === 200 && reply.data.opportunity?.id, '11. positive reply -> opportunity created');
const oppId = reply.data.opportunity.id;
ok(reply.data.opportunity.estimatedValue === null, '11b. engine did NOT invent a pipeline value');

const oppMove = await patch(`/api/collections/opportunities/${oppId}`, { stage: 'qualified', estimatedValue: 12000, probability: 0.4, contentInfluence: 'strong-influence', relatedContent: [cntId] });
ok(oppMove.status === 200 && oppMove.data.stage === 'qualified', '12. opportunity advanced with Stuart-entered value');

const today = await get('/api/today');
ok(today.status === 200 && today.data.actions.length === 3, `13. Today briefing defaults to 3 actions (${today.data.actions.length} actions)`);
ok(today.data.actions.every((a) => a.why && a.whyNow && a.nextStep), '13b. every recommendation carries why / why-now / next step');
const todayMore = await get('/api/today?limit=7');
ok(todayMore.status === 200 && todayMore.data.actions.length === 7, `13c. explicit ?limit= still honoured (${todayMore.data.actions.length} actions)`);
const analytics = await get('/api/analytics');
ok(analytics.status === 200 && analytics.data.pipeline.attribution.some((o) => o.id === oppId && o.contentInfluence === 'strong-influence'), '14. attribution reflected in analytics');
ok(analytics.data.authority.components.length === 8, '14b. authority score shows all 8 components with evidence');

console.log('\n== Safety gates ==');
const dnc = await action('draft-outreach', { contactId: 'con-s25', purpose: 'new-business-conversation' });
ok(dnc.status === 409, 'do-not-contact blocks drafting', JSON.stringify(dnc.data));
const secret = await action('draft-content', { insightId: 'ins-s08', format: 'linkedin-post' });
ok(secret.status === 409, 'confidential insight blocks content drafting', JSON.stringify(secret.data));
const smuggle = await patch('/api/collections/outreach/out-s05', { stage: 'sent' });
ok(smuggle.status === 409, 'generic PATCH cannot smuggle stage=sent');
const smuggle2 = await post('/api/collections/content', { title: 'x', stage: 'published' });
ok(smuggle2.status === 409, 'generic POST cannot create pre-published content');
const approvalSmuggle = await patch(`/api/collections/content/${cntId}`, { approval: { status: 'approved', approvedBy: 'attacker' } });
ok(approvalSmuggle.status === 409, 'generic PATCH cannot smuggle content approval', JSON.stringify(approvalSmuggle.data));
const approvalCreateSmuggle = await post('/api/collections/content', { title: 'approval bypass attempt', approval: { status: 'approved' } });
ok(approvalCreateSmuggle.status === 409, 'generic POST cannot create pre-approved content', JSON.stringify(approvalCreateSmuggle.data));
const lintRes = await action('lint', { text: 'This is a game changer — not just hype, but the next evolution of events.', brand: 'stuart', kind: 'post' });
ok(!lintRes.data.ok && lintRes.data.problems.length >= 3, `voice linter catches em dash + banned phrases + parallelism (${lintRes.data.problems.length} problems)`);
const npLint = await action('lint', { text: 'The betting industry will love this.', brand: 'nextpredict', kind: 'post' });
ok(!npLint.data.ok, 'NEXTPredict category-vocabulary rule enforced');
const gate = await action('brand-gate', { text: 'Our NEXT.io pipeline hit a record.', brand: 'strait-up-growth', classification: 'public' });
ok(gate.data.flags.length >= 1, 'brand gate flags NEXT.io material in Strait Up Growth output');

console.log('\n== Voice learning loop ==');
const vx = await action('extract-voice-rule', { original: 'I am thrilled and excited to share this fantastic news!', edited: 'Some news worth sharing.', note: 'too gushing' });
ok(vx.status === 200 && vx.data.proposed.length >= 1, 'edit comparison proposes rules (inactive)');
const vApprove = await action('approve-voice-rule', { ruleId: vx.data.proposed[0].id });
ok(vApprove.status === 200, 'Stuart approves a proposed rule -> active');

console.log('\n== Intel ingestion (the front door) ==');
{
  const os = await import('node:os');
  const fsm = await import('node:fs');
  const dir = fsm.mkdtempSync(path.join(os.tmpdir(), 'ingest-test-'));
  fsm.writeFileSync(path.join(dir, 'note-public.md'), 'Renewal pricing observation\n\nA supplier renegotiation this week showed the same pattern again: the buyer had no comparison anchor, so the incumbent price held without a fight. Anchors beat arguments in renewals.');
  fsm.writeFileSync(path.join(dir, 'note-secret.txt'), 'NEXT.io internal: the Q3 pipeline review showed €2.4M active with an 18% margin uplift from the new discount tiers. CEO decided to hold pricing.');
  fsm.writeFileSync(path.join(dir, 'capture.html'), '<html><body><h1>Prediction markets hiring watch</h1><p>Kalshi posted three compliance roles this &amp; last week.</p><script>ignore()</script></body></html>');
  const out1 = execFileSync('node', [path.join(ROOT, 'scripts/ingest.mjs'), dir, '--source', 'self-test drop'], { encoding: 'utf8' });
  ok(/created: 3/.test(out1), 'ingest creates one insight per record (3 files)', out1.split('\n')[2]);
  ok(/strictly-confidential|private-operating-lesson/.test(out1), 'ingest flags the NEXT.io note as confidential');
  ok(/Kalshi|CANDIDATE ENTITIES/.test(out1), 'ingest surfaces candidate entities without auto-creating them');
  const out2 = execFileSync('node', [path.join(ROOT, 'scripts/ingest.mjs'), dir], { encoding: 'utf8' });
  ok(/created: 0/.test(out2) && /duplicates skipped: 3/.test(out2), 'second ingest of the same drop is a no-op (dedupe by content hash)');
  const ingested = await get('/api/collections/insights');
  const mine = ingested.data.items.filter((i) => i.source === 'self-test drop' || (i.source || '').startsWith('ingest:'));
  ok(mine.some((i) => (i.raw || '').includes('Anchors beat arguments')), 'raw text kept lossless');
  ok(mine.some((i) => (i.lanes || []).includes('Prediction markets')), 'lane heuristics tag the hiring-watch note');
  fsm.rmSync(dir, { recursive: true, force: true });
}

console.log('\n== Lead detection (prospects from dropped intel) ==');
{
  const os = await import('node:os');
  const fsm = await import('node:fs');
  const dir = fsm.mkdtempSync(path.join(os.tmpdir(), 'leads-test-'));
  fsm.writeFileSync(path.join(dir, 'intel.md'), [
    'SEA funding brief',
    '',
    'Ampersand Freight Systems raised a $5M seed round and is expanding into Singapore next quarter.',
    'Meanwhile Harbourline Logistics is hiring a Head of RevOps to fix its reporting stack.',
    'Separately, Forecastly Exchange launched a prediction market venue and filed for DCM designation with the CFTC.',
    'And Nordlight Gaming Group was granted a sportsbook licence for the newly regulated Brazilian market.',
  ].join('\n'));
  const out = execFileSync('node', [path.join(ROOT, 'scripts/ingest.mjs'), dir, '--source', 'lead-test'], { encoding: 'utf8' });
  ok(/LEADS DETECTED/.test(out), 'ingest reports detected leads', out.split('\n').slice(-8).join(' | '));
  const leads = (await get('/api/collections/leads')).data.items;
  const harbourline = leads.find((l) => l.name === 'Harbourline Logistics');
  ok(harbourline && harbourline.linkedCompanyId === 'com-s01', 'known company matched to its existing record (no duplicate entity)');
  const pmLead = leads.find((l) => l.pillar === 'prediction-markets' && /Forecastly/i.test(l.name));
  ok(!!pmLead, 'prediction-markets pillar lead detected (venue launch)', JSON.stringify(leads.map((l) => `${l.name}:${l.pillar}`)));
  const funded = leads.find((l) => /Ampersand/i.test(l.name) && l.signal === 'funding');
  ok(!!funded, 'funding signal produced a Strait Up Growth lead');
  const igLead = leads.find((l) => l.pillar === 'igaming' && /Nordlight/i.test(l.name));
  ok(!!igLead, 'iGaming pillar lead detected (sportsbook licence)', JSON.stringify(leads.map((l) => `${l.name}:${l.pillar}:${l.signal}`)));
  ok(leads.every((l) => (l.evidence || []).every((e) => e.quote)), 'every lead carries its evidence quote (provenance)');
  const conv = await action('convert-lead', { leadId: funded.id });
  ok(conv.status === 200 && conv.data.companyId && conv.data.task, 'convert creates a skeleton company + research task');
  const company = (await get(`/api/collections/companies/${conv.data.companyId}`)).data;
  ok(company.industry === null && company.location === null, 'converted record contains ONLY evidence-backed fields (nothing invented)');
  const dis = await action('dismiss-lead', { leadId: pmLead.id, reason: 'test' });
  ok(dis.status === 200 && dis.data.lead.status === 'dismissed', 'dismiss works');
  const today2 = await get('/api/today');
  ok(today2.data.allActions.some((a) => a.kind === 'work-lead'), 'Today surfaces leads to work');
  fsm.rmSync(dir, { recursive: true, force: true });
}

console.log('\n== Authority pillars ==');
{
  const lanes = (await get('/api/collections/lanes')).data.items;
  ok(lanes.filter((l) => l.tier === 'core').length >= 11 && lanes.some((l) => l.name === 'Sports betting & sportsbook strategy'), 'lane taxonomy tiered with core pillar lanes across all three pillars');
  const an = (await get('/api/analytics')).data;
  ok(Array.isArray(an.pillars) && an.pillars.length === 3, 'analytics reports the three pillars (SUG/SEA, prediction markets, iGaming & sports betting)');
  ok(an.pillars.every((p) => 'leadsDetected' in p && 'conversations' in p), 'pillar rollup includes leads and conversations');
  const coreScore = await action('score-content', { contentId: 'cnt-s04' }); // SEA/AI lanes
  ok(coreScore.data.content.score.criteria.sugRelevance === 5, 'core-pillar content scores 5 on relevance');
}

console.log('\n== Multi-channel repurposing ==');
{
  const rep = await action('repurpose', { contentId: cntId, format: 'x-thread' });
  ok(rep.status === 200 && rep.data.content.format === 'x-thread', 'repurpose creates an X thread version');
  ok(rep.data.content.repurposedFrom === cntId, 'repurposed piece links back to its source (provenance)');
  const srcBody = (await get(`/api/collections/content/${cntId}`)).data.body;
  ok(rep.data.content.body && rep.data.content.body !== srcBody, 'repurposed body is not a verbatim copy');
  const same = await action('repurpose', { contentId: cntId, format: 'linkedin-post' });
  ok(same.status === 400, 'repurposing to the same format is rejected');
  const sub = await action('repurpose', { contentId: cntId, format: 'substack-newsletter' });
  ok(sub.status === 200 && /Subject:/.test(sub.data.content.body), 'Substack version carries newsletter structure (subject line)');
  const channels = await get('/api/collections/channels');
  ok(channels.data.items.some((c) => c.status === 'suggested' && c.watchSignal), 'channel strategy library served with adoption watch-signals');
}

console.log('\n== Ideas bank + posting strategy (the daily automation) ==');
{
  const run = () => execFileSync('node', [path.join(ROOT, 'scripts/ideas-bank.mjs')], { encoding: 'utf8' });
  run();
  const st = await get('/api/state');
  const ideas = st.data.content.filter((c) => c.generatedKey && c.stage === 'raw-idea');
  ok(ideas.length >= 5 && ideas.length <= 10, `ideas bank populated within cap (${ideas.length})`);
  ok(ideas.every((c) => c.generatedRationale), 'every generated idea explains its rationale');
  ok(!ideas.some((c) => c.generatedKey === 'insight:ins-s08'), 'confidential insight excluded from the ideas bank');
  ok(st.data.strategy && st.data.strategy.channelPlan && st.data.strategy.themeByPillar, 'strategy doc generated (channel plan + themes per pillar)');
  const countBefore = ideas.length;
  // Archive one idea; a re-run must not resurrect it or duplicate others.
  await patch(`/api/collections/content/${ideas[0].id}`, { stage: 'archived' });
  run();
  const after = (await get('/api/state')).data.content.filter((c) => c.generatedKey && c.stage === 'raw-idea');
  ok(!after.some((c) => c.generatedKey === ideas[0].generatedKey), 'archived idea is never regenerated');
  ok(after.length <= countBefore, `dedupe holds on re-run (${after.length} open)`);
}

console.log('\n== Reviews ==');
const wk = await action('weekly-review', {});
ok(wk.status === 200 && wk.data.review.body.recommendedTheme, 'weekly review drafted from records');
ok(wk.data.review.status === 'draft', 'review is a draft until confirmed');

const auditLog = await get('/api/audit');
ok(auditLog.data.items.length > 10, `audit trail populated (${auditLog.data.items.length} entries visible)`);

server.close();
fs.rmSync(TESTDATA, { recursive: true, force: true });
console.log(`\n${passed} passed, ${failed} failed. Ran against a scratch data dir; real data/ untouched.`);
process.exit(failed ? 1 : 0);
