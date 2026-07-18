#!/usr/bin/env node
// import-pack-leads.mjs — routes the curated people-leads shipped in an intel
// pack's *_LEADS.jsonl into the relationship base. These are speaker / sponsor
// / media / regulatory / institutional PEOPLE (not buying-signal leads), so
// they land as contacts. Fuzzy dedup against existing contacts (first+last /
// nickname / initial) enriches the existing record instead of duplicating.
//
//   node scripts/import-pack-leads.mjs <leads.jsonl> [--source "label"] [--dry-run]
//
// JSONL schema: name, role, company, lead_type, priority, confidence,
// why_they_matter, nexpredict_relevance[], suggested_action, sources[].
// Re-runnable; never overwrites an existing handle/role; never auto-contacts.

import fs from 'node:fs';
import path from 'node:path';
import { items, read, write, newId, update, audit } from '../lib/store.mjs';

const args = process.argv.slice(2);
const DRY = args.includes('--dry-run');
const source = (() => { const i = args.indexOf('--source'); return i !== -1 ? args[i + 1] : 'intel-pack'; })();
const target = args.find((a) => !a.startsWith('--') && a !== source);
if (!target || !fs.existsSync(target)) {
  console.error('Usage: node scripts/import-pack-leads.mjs <leads.jsonl> [--source "label"] [--dry-run]');
  process.exit(1);
}

const NICK = { mike: 'michael', rob: 'robert', bob: 'robert', bill: 'william', will: 'william',
  jim: 'james', jimmy: 'james', tom: 'thomas', tommy: 'thomas', dave: 'david', dan: 'daniel',
  danny: 'daniel', chris: 'christopher', matt: 'matthew', joe: 'joseph', jon: 'jonathan',
  nick: 'nicholas', tony: 'anthony', ben: 'benjamin', sam: 'samuel', alex: 'alexander',
  ed: 'edward', ted: 'edward', andy: 'andrew', greg: 'gregory', ron: 'ronald', rick: 'richard',
  dick: 'richard', steve: 'stephen', ken: 'kenneth', charlie: 'charles', kate: 'katherine',
  katie: 'katherine', liz: 'elizabeth', beth: 'elizabeth', jen: 'jennifer', jenny: 'jennifer' };
const canon = (t) => NICK[t] || t;
const norm = (s) => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
const toks = (s) => (s || '').toLowerCase().replace(/[.,]/g, '').split(/\s+/).filter(Boolean);
const clip = (s, n) => { s = (s || '').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; };
const prio = (p) => (p >= 10 ? 'Critical' : p >= 8 ? 'High' : p >= 5 ? 'Medium' : 'Low');

function samePerson(a, b) {
  const ta = toks(a), tb = toks(b);
  if (ta.length < 2 || tb.length < 2) return norm(a) === norm(b);
  if (ta[ta.length - 1] !== tb[tb.length - 1]) return false;           // last name must match
  const fa = canon(ta[0]), fb = canon(tb[0]);
  return fa === fb || (fa[0] === fb[0] && (fa.length === 1 || fb.length === 1)); // first: same/nickname/initial
}

const leads = fs.readFileSync(target, 'utf8').split('\n').filter((l) => l.trim())
  .map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);

const now = new Date().toISOString();
const existing = items('contacts');
const inserts = [];
const enrichments = [];

for (const l of leads) {
  if (!l.name) continue;
  const match = existing.find((c) => samePerson(c.name, l.name));
  const relevance = Array.isArray(l.nexpredict_relevance) ? l.nexpredict_relevance.join('; ') : (l.nexpredict_relevance || '');
  const srcNote = Array.isArray(l.sources) ? l.sources[0] : (l.sources || '');
  if (match) {
    const patch = {};
    if (!match.leadType) patch.leadType = l.lead_type;
    if (!match.nextpredictRelevance && relevance) patch.nextpredictRelevance = relevance;
    if (!match.suggestedAction && l.suggested_action) patch.suggestedAction = l.suggested_action;
    const note = clip(`${l.lead_type} lead (${source}): ${l.why_they_matter}${relevance ? ` — fit: ${relevance}.` : ''}`, 400);
    const notes = Array.isArray(match.notes) ? match.notes : [];
    if (!notes.some((n) => n.includes(source))) patch.notes = [...notes, note];
    if (Object.keys(patch).length) enrichments.push({ id: match.id, name: match.name, patch });
  } else {
    inserts.push({
      name: l.name,
      role: [l.role, l.company].filter(Boolean).join(', ') || null,
      company: l.company || null, companyId: null,
      relationshipType: 'category-lead', leadType: l.lead_type,
      lanes: ['Prediction markets'], howKnown: `Curated lead in the ${source} intel pack.`,
      location: null, permissionStatus: 'unverified', doNotContact: false,
      email: null, linkedin: null, x: null,
      sharedInterests: clip(l.why_they_matter, 300) || null,
      potentialValue: relevance || null,
      nextpredictRelevance: relevance || null,
      suggestedAction: l.suggested_action || null,
      priority: prio(l.priority || 0),
      verification: 'Verify identity and current role before outreach.',
      notes: [clip(`Why: ${l.why_they_matter}`, 400)].filter(Boolean),
      nextAction: l.suggested_action || 'Research and verify before outreach.',
      followUpDate: null, sourceNote: srcNote || null,
      source: 'workbook-directory', importedFrom: path.basename(target), fictional: false,
    });
  }
}

if (!DRY) {
  if (inserts.length) {
    const doc = read('contacts');
    doc.items.push(...inserts.map((r) => ({ id: newId('contacts'), createdAt: now, updatedAt: now, ...r })));
    write('contacts', doc);
    audit({ actor: 'import-pack-leads', action: 'bulk-insert', collection: 'contacts',
      id: `+${inserts.length}`, summary: `${inserts.length} curated leads from ${path.basename(target)}` });
  }
  for (const e of enrichments) update('contacts', e.id, e.patch, { actor: 'import-pack-leads' });
}

console.log(`\nPACK LEADS IMPORT ${DRY ? '(dry run) ' : ''}from ${path.basename(target)}`);
console.log('='.repeat(60));
console.log(`leads read: ${leads.length}`);
console.log(`new contacts: +${inserts.length}`);
console.log(`existing contacts enriched (speaker/panel fit + note): ${enrichments.length}`);
if (inserts.length) console.log('new:', inserts.map((r) => r.name).join(', '));
if (enrichments.length) console.log('enriched:', enrichments.map((e) => e.name).join(', '));
console.log('\nAll new records are real (fictional:false), unverified, never auto-contacted. Commit data/.');
