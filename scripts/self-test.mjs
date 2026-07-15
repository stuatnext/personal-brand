#!/usr/bin/env node
// self-test.mjs — drives the full vertical slice end to end through the
// real HTTP API, plus the safety gates. Re-seeds before and after so it
// always runs against (and leaves behind) the clean fictional dataset.
//
//   node scripts/self-test.mjs

import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const seed = () => execFileSync('node', [path.join(ROOT, 'scripts/seed.mjs'), '--force'], { stdio: 'pipe' });

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
ok(today.status === 200 && today.data.actions.length >= 3, `13. Today briefing live (${today.data.actions.length} actions)`);
ok(today.data.actions.every((a) => a.why && a.whyNow && a.nextStep), '13b. every recommendation carries why / why-now / next step');
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

console.log('\n== Reviews ==');
const wk = await action('weekly-review', {});
ok(wk.status === 200 && wk.data.review.body.recommendedTheme, 'weekly review drafted from records');
ok(wk.data.review.status === 'draft', 'review is a draft until confirmed');

const auditLog = await get('/api/audit');
ok(auditLog.data.items.length > 10, `audit trail populated (${auditLog.data.items.length} entries visible)`);

server.close();
seed(); // leave the repo in the clean seeded state
console.log(`\n${passed} passed, ${failed} failed. Data re-seeded to clean fictional state.`);
process.exit(failed ? 1 : 0);
