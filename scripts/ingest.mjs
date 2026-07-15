#!/usr/bin/env node
// ingest.mjs — the front door for Stuart's intel drops. One command turns
// whatever he hands over (a note, a folder of notes, a ZIP, an HTML
// capture, a JSONL export) into lossless insight records, each with a
// confidentiality review, heuristic lane tags, entity matches against the
// relationship base, and a routing summary. Nothing is drafted or sent
// automatically; ingested insights surface on Today for distillation.
//
//   node scripts/ingest.mjs <path> [--source "label"] [--dry-run] [--relevance 3]
//
// Formats: .txt .md (one insight per file) · .html (tags stripped, text
// kept lossless) · .json (array or object) · .jsonl (one record per line)
// · .zip (extracted, walked, nested zips too) · directories (walked).
// Duplicates are detected by content hash and skipped, never re-created.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { items, insert, read } from '../lib/store.mjs';
import { review as confReview } from '../lib/confidentiality.mjs';

const args = process.argv.slice(2);
const DRY = args.includes('--dry-run');
const target = args.find((a) => !a.startsWith('--'));
const flag = (name, dflt) => { const i = args.indexOf(name); return i > -1 ? args[i + 1] : dflt; };
const SOURCE = flag('--source', null);
const RELEVANCE = Number(flag('--relevance', 3));

if (!target || !fs.existsSync(target)) {
  console.error('Usage: node scripts/ingest.mjs <file|dir|zip> [--source "label"] [--dry-run] [--relevance 1-5]');
  process.exit(1);
}

// Lane tagging heuristics — keyword → authority lane. Extend freely.
const LANE_HINTS = [
  [/crm|hubspot|salesforce|pipeline hygiene|revops|lifecycle|mql/i, 'CRM and RevOps governance'],
  [/pric(e|ing)|discount|margin|packag|willingness.to.pay/i, 'Pricing and margin discipline'],
  [/\bai\b|prompt|llm|claude|gpt|automation|workflow/i, 'Practical AI implementation'],
  [/sponsor|exhibit|summit|conference|event/i, 'B2B events and sponsorship'],
  [/igaming|casino operator|slots|sportsbook industry/i, 'iGaming commercial strategy'],
  [/prediction market|event contract|kalshi|polymarket|cftc/i, 'Prediction markets'],
  [/singapore|\bsea\b|southeast asia|apac/i, 'Singapore SME AI adoption'],
  [/newsletter|podcast|media revenue|affiliate|editorial/i, 'B2B media monetisation'],
  [/negotiat/i, 'Commercial negotiation'],
  [/gtm|go.to.market|launch|positioning/i, 'GTM execution'],
  [/founder|bottleneck|delegat/i, 'Founder-led operating drag'],
  [/sales and marketing|alignment|handoff/i, 'Sales and marketing alignment'],
  [/categor(y|ies) (formation|creation)|new category/i, 'Category creation'],
];

const hash = (text) => crypto.createHash('sha1').update(text.replace(/\s+/g, ' ').trim().toLowerCase()).digest('hex');
const stripHtml = (html) => html
  .replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ')
  .replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|h\d|li|tr)>/gi, '\n')
  .replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"')
  .split('\n').map((l) => l.replace(/[ \t]+/g, ' ').trim()).filter(Boolean).join('\n');

// ---------------------------------------------------------------------------
// Collect candidate records {title, raw, sourceFile} from the drop.
// ---------------------------------------------------------------------------
const records = [];
const tmpDirs = [];

function collect(p) {
  const stat = fs.statSync(p);
  if (stat.isDirectory()) {
    for (const f of fs.readdirSync(p)) {
      if (f.startsWith('.') || f === '__MACOSX') continue;
      collect(path.join(p, f));
    }
    return;
  }
  const ext = path.extname(p).toLowerCase();
  const name = path.basename(p);
  if (ext === '.zip') {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ingest-'));
    tmpDirs.push(dir);
    execFileSync('unzip', ['-qo', p, '-d', dir]);
    collect(dir);
    return;
  }
  if (['.txt', '.md'].includes(ext)) {
    const raw = fs.readFileSync(p, 'utf8').trim();
    if (raw) records.push({ title: titleFrom(raw, name), raw, sourceFile: name });
  } else if (ext === '.html' || ext === '.htm') {
    const raw = stripHtml(fs.readFileSync(p, 'utf8')).trim();
    if (raw) records.push({ title: titleFrom(raw, name), raw, sourceFile: name, note: 'text extracted losslessly from HTML' });
  } else if (ext === '.jsonl') {
    for (const line of fs.readFileSync(p, 'utf8').split('\n').map((l) => l.trim()).filter(Boolean)) {
      try { pushJson(JSON.parse(line), name); } catch { records.push({ title: titleFrom(line, name), raw: line, sourceFile: name }); }
    }
  } else if (ext === '.json') {
    try {
      const data = JSON.parse(fs.readFileSync(p, 'utf8'));
      for (const row of Array.isArray(data) ? data : [data]) pushJson(row, name);
    } catch (e) { console.error(`  skip ${name}: ${e.message}`); }
  }
  // other extensions ignored, reported at the end
  else skipped.push(name);
}
const skipped = [];

function pushJson(row, name) {
  const raw = row.raw_text || row.raw || row.text || row.body || row.content || JSON.stringify(row);
  const title = row.title || row.headline || titleFrom(String(raw), name);
  records.push({ title, raw: String(raw), sourceFile: name, meta: { url: row.url || row.source_url, author: row.author, date: row.date } });
}

function titleFrom(text, fallback) {
  const first = text.split('\n').map((l) => l.replace(/^#+\s*/, '').trim()).find(Boolean) || fallback;
  return first.length > 90 ? `${first.slice(0, 87)}...` : first;
}

collect(path.resolve(target));

// ---------------------------------------------------------------------------
// Dedupe against existing insights + within the drop, then enrich.
// ---------------------------------------------------------------------------
const existing = new Map(items('insights', { includeDeleted: true }).map((i) => [hash(i.raw || ''), i.id]));
const seenInDrop = new Set();
const contacts = items('contacts');
const companies = items('companies');
const knownNames = [
  ...contacts.map((c) => ({ kind: 'contact', id: c.id, name: c.name })),
  ...companies.map((c) => ({ kind: 'company', id: c.id, name: c.name })),
];

const created = [];
const duplicates = [];
const confidentialFlags = [];
const candidateEntities = new Map();

for (const r of records) {
  const h = hash(r.raw);
  if (existing.has(h)) { duplicates.push({ ...r, existingId: existing.get(h) }); continue; }
  if (seenInDrop.has(h)) { duplicates.push({ ...r, existingId: '(duplicate within this drop)' }); continue; }
  seenInDrop.add(h);

  const lanes = [...new Set(LANE_HINTS.filter(([re]) => re.test(r.raw)).map(([, lane]) => lane))].slice(0, 3);
  const conf = confReview(r.raw, { context: r.sourceFile });
  const relatedContacts = [], relatedCompanies = [];
  for (const k of knownNames) {
    if (r.raw.toLowerCase().includes(k.name.toLowerCase())) {
      (k.kind === 'contact' ? relatedContacts : relatedCompanies).push(k.id);
    }
  }
  // Capitalised names that are NOT known entities: candidates to research,
  // reported but never auto-created (no invented records). Multi-word
  // sequences anywhere; single words only mid-sentence (skips sentence-
  // starting ordinary words).
  const STOP = new Set(('the and but that this what when where which while with watched founder internal notes there their they then these those every most some people one two three after before because during however instead nothing something anything everyone someone monday tuesday wednesday thursday friday saturday sunday january february march april may june july august september october november december singapore asia europe london here still just also over under about against between').split(' '));
  const addCandidate = (name) => {
    if (STOP.has(name.split(' ')[0].toLowerCase())) return;
    if (knownNames.some((k) => k.name.toLowerCase() === name.toLowerCase())) return;
    // A real name is never written lowercase elsewhere in the same text.
    if (new RegExp(`(?<![A-Za-z])${name.split(' ')[0].toLowerCase()}(?![A-Za-z])`).test(r.raw)) return;
    candidateEntities.set(name, (candidateEntities.get(name) || 0) + 1);
  };
  for (const m of r.raw.matchAll(/\b([A-Z][a-z]{2,}(?: [A-Z][a-z]{2,}){1,2})\b/g)) addCandidate(m[1]);
  for (const sentence of r.raw.split(/(?<=[.!?:])\s+|\n+/)) {
    const words = sentence.trim().split(/\s+/);
    for (let w = 0; w < words.length; w++) {
      const token = words[w].replace(/[^A-Za-z']/g, '');
      if (/^[A-Z][a-z]{2,}$/.test(token)) addCandidate(token);
    }
  }

  const item = {
    title: r.title,
    raw: r.raw, // lossless, never truncated
    source: SOURCE || `ingest: ${r.sourceFile}${r.meta?.url ? ` (${r.meta.url})` : ''}`,
    sourceUrl: r.meta?.url || null,
    date: r.meta?.date || new Date().toISOString().slice(0, 10),
    type: 'ingested-intel',
    lanes, audiences: [],
    commercialRelevance: RELEVANCE, confidence: 'unreviewed',
    confidentiality: { ...conf, confirmed: false },
    distilled: null, relatedContacts, relatedCompanies, relatedOffers: [],
    nextAction: 'Distil and route', status: 'captured',
    contentHash: h,
  };
  if (conf.classification !== 'public') confidentialFlags.push({ title: r.title, classification: conf.classification });
  if (!DRY) {
    const saved = insert('insights', item, { actor: 'ingest' });
    created.push({ id: saved.id, title: r.title, lanes, classification: conf.classification });
  } else {
    created.push({ id: '(dry-run)', title: r.title, lanes, classification: conf.classification });
  }
  existing.set(h, 'just-created');
}

for (const d of tmpDirs) fs.rmSync(d, { recursive: true, force: true });

// ---------------------------------------------------------------------------
// Routing summary.
// ---------------------------------------------------------------------------
console.log(`\nINGEST ${DRY ? '(dry run) ' : ''}— ${records.length} record(s) found in ${path.basename(target)}`);
console.log('='.repeat(64));
console.log(`created: ${created.length} · duplicates skipped: ${duplicates.length} · unsupported files: ${skipped.length}`);
for (const c of created) console.log(`  + ${c.id}  ${c.title}\n      lanes: ${c.lanes.join(', ') || '(none matched — tag by hand)'} · confidentiality: ${c.classification}`);
if (duplicates.length) for (const d of duplicates) console.log(`  = duplicate: "${d.title}" (already ${d.existingId})`);
if (skipped.length) console.log(`  ? skipped (unsupported type): ${skipped.join(', ')}`);
if (confidentialFlags.length) {
  console.log(`\nCONFIDENTIALITY: ${confidentialFlags.length} item(s) flagged non-public — confirm before any drafting:`);
  for (const f of confidentialFlags) console.log(`  ! ${f.classification}: ${f.title}`);
}
if (candidateEntities.size) {
  const top = [...candidateEntities.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12);
  console.log(`\nCANDIDATE ENTITIES (not in the relationship base — research before creating, never invent details):`);
  for (const [name, n] of top) console.log(`  ? ${name}${n > 1 ? ` (x${n})` : ''}`);
}
console.log(`\nNext: open the app (npm run dev) — ingested insights surface on Today and in #/insights for distillation into LinkedIn / X / Substack drafts.`);
if (!DRY) console.log('Remember to commit data/ — git is the database.');
