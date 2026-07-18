#!/usr/bin/env node
// draft-assist.mjs — the writing loop in the terminal. Given a topic (or an
// insight / content id), it returns the most relevant older references to
// weave in and the people/companies worth tagging, by meaning. Read-only.
//
//   node scripts/draft-assist.mjs "the teleprompter insider case"
//   node scripts/draft-assist.mjs --insight ins-xxxx
//   node scripts/draft-assist.mjs --content cnt-xxxx
//   node scripts/draft-assist.mjs --all "..."   # include confidential refs (never for public output)
//
// Nothing is drafted, sent or published; it hands you sourced candidates.

import { items, get } from '../lib/store.mjs';
import { assist } from '../lib/retrieval.mjs';

const argv = process.argv.slice(2);
const flag = (name) => { const i = argv.indexOf(name); return i !== -1 ? argv[i + 1] : null; };
const publicSafe = !argv.includes('--all');
const insightId = flag('--insight');
const contentId = flag('--content');
const topic = argv.filter((a, i) => !a.startsWith('--') && argv[i - 1] !== '--insight' && argv[i - 1] !== '--content').join(' ');

let query = topic, excludeId = null, label = topic;
if (insightId) {
  const ins = get('insights', insightId);
  if (!ins) { console.error(`insight ${insightId} not found`); process.exit(1); }
  query = [ins.title, ins.raw].filter(Boolean).join(' '); excludeId = insightId; label = ins.title;
} else if (contentId) {
  const c = get('content', contentId);
  if (!c) { console.error(`content ${contentId} not found`); process.exit(1); }
  query = [c.title, c.body, c.objective].filter(Boolean).join(' '); excludeId = contentId; label = c.title;
}
if (!query.trim()) {
  console.error('Usage: node scripts/draft-assist.mjs "<topic>"  |  --insight <id>  |  --content <id>  [--all]');
  process.exit(1);
}

const r = assist(query, { k: 8, tagK: 10, publicSafe, excludeId });

const dim = (s) => `\x1b[2m${s}\x1b[0m`;
const bold = (s) => `\x1b[1m${s}\x1b[0m`;
console.log(`\n${bold('WRITING ASSIST')} — ${label}`);
console.log('='.repeat(70));

console.log(`\n${bold('RELEVANT REFERENCES')} ${dim('(older material to weave in, with its source)')}`);
if (!r.references.length) console.log('  (none found)');
for (const x of r.references) {
  const flagn = x.needsAnonymisation ? '  [anonymise first]' : '';
  console.log(`  • [${x.kind}${x.date ? ' ' + String(x.date).slice(0, 10) : ''}] ${x.title}${flagn}`);
  console.log(dim(`      ${x.why} · score ${x.score}${x.source ? ' · ' + x.source : ''}`));
}

console.log(`\n${bold('PEOPLE / COMPANIES TO TAG')} ${dim('(by relevance; verify handle before tagging)')}`);
if (!r.tags.length) console.log('  (none found)');
for (const t of r.tags) {
  const handle = t.handle || t.linkedin || dim('(no handle — check Directory)');
  const also = t.alsoConsider.length ? dim(`  ~ also: ${t.alsoConsider.join(', ')}`) : '';
  const ver = t.verification && /verify/i.test(t.verification) ? dim('  ⚠ verify') : '';
  console.log(`  • ${t.name} ${dim('[' + t.type + ']')} ${handle}${ver}${also}`);
}

if (r.confidentiality.flagged.length) {
  console.log(`\n${bold('CONFIDENTIALITY')}`);
  for (const f of r.confidentiality.flagged) console.log(`  ! ${f.title}: ${f.note}`);
}
console.log(`\n${dim(r.confidentiality.note)}`);
console.log(dim(r.voice));
console.log(`\n${dim('Draft in the app (draft-content), then run the lint + confidentiality actions before approving.')}`);
