#!/usr/bin/env node
// today.mjs — the daily briefing in the terminal, for when Stuart (or a
// Claude session) wants the priority list without starting the server.
//   node scripts/today.mjs

import { todayBriefing } from '../lib/recommend.mjs';
import { analytics } from '../lib/analytics.mjs';

const t = todayBriefing();
const a = analytics();

console.log(`\nSTUART CROWLEY — PERSONAL BRAND ENGINE — TODAY (${new Date().toDateString()})`);
console.log('='.repeat(60));
t.actions.forEach((x, i) => {
  console.log(`\n#${i + 1} [${x.kind}] ${x.title}`);
  console.log(`    why: ${x.why}`);
  console.log(`    now: ${x.whyNow}`);
  console.log(`    next: ${x.nextStep}`);
});
if (t.stopDoing) console.log(`\nSTOP DOING: ${t.stopDoing.title}\n    ${t.stopDoing.why}`);
const c = t.counts;
console.log(`\nQueue: ${c.followUpsDue} follow-ups due · ${c.contentInReview} content in review · ${c.outreachAwaitingApproval} drafts to approve · ${c.approvedUnsent} approved unsent · ${c.openOpportunities} open opps · ${c.unprocessedInsights} unprocessed insights`);
console.log(`Authority ${a.authority.total}/100 (${a.authority.confidence}) · pipeline ${a.scorecard.pipelineValue} · qualified conversations ${a.scorecard.qualifiedConversations}`);
console.log(`\nRun the full command centre:  npm run dev  ->  http://localhost:4173\n`);
