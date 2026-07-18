#!/usr/bin/env node
// import-directory.mjs — imports the cleaned NEXTPredict people/company
// Directory (and workbook-derived leads) into the engine's relationship
// system. Companion to import-schedule.mjs.
//
//   node scripts/import-directory.mjs <directory.json> [--dry-run]
//
// Input JSON shape (produced from the cleaned master-schedule workbook):
//   { "entities": [ {name,type,category,priority,role,why,use,x,linkedin,
//                    email,website,verification,outreach,sources,people} ... ],
//     "leads":    [ {name,kind,pillar,signal,why,quote,date,source} ... ] }
//
// Mapping:
//   type "Person"                          -> contacts
//   type "Research / paper" | "Regulatory / policy item" -> skipped (sources, not relationships)
//   everything else (Company/Organisation/Event/Show/Community/Product) -> companies
//
// Re-import is safe: entities dedupe on normalised name within their
// collection; leads dedupe on normalised name + signal. Nothing is deleted
// and existing records are never overwritten. All imported records are real
// (fictional:false) and tagged source:"workbook-directory" so they can be
// filtered or rolled back as a batch. Remember to commit data/.

import fs from 'node:fs';
import path from 'node:path';
import { read, write, newId, audit } from '../lib/store.mjs';

const args = process.argv.slice(2);
const DRY = args.includes('--dry-run');
const target = args.find((a) => !a.startsWith('--'));
if (!target || !fs.existsSync(target)) {
  console.error('Usage: node scripts/import-directory.mjs <directory.json> [--dry-run]');
  process.exit(1);
}

const src = JSON.parse(fs.readFileSync(target, 'utf8'));
const entities = src.entities || [];
const leadRows = src.leads || [];
const norm = (s) => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
const clip = (s, n) => { s = (s || '').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; };
const now = new Date().toISOString();

const COMPANY_TYPES = new Set(['Company', 'Organisation', 'Community', 'Event',
  'Show / publication', 'Product / protocol']);
const SKIP_TYPES = new Set(['Research / paper', 'Regulatory / policy item']);

function bulkInsert(collection, records) {
  const doc = read(collection);
  doc.items = doc.items || [];
  const seen = new Set(doc.items.map((i) => norm(i.name)));
  const added = [];
  let skipped = 0;
  for (const r of records) {
    const key = norm(r.name);
    if (!key || seen.has(key)) { skipped++; continue; }
    seen.add(key);
    added.push({ id: newId(collection), createdAt: now, updatedAt: now, ...r });
  }
  if (!DRY && added.length) {
    doc.items.push(...added);
    write(collection, doc);
    audit({ actor: 'import-directory', action: 'bulk-insert', collection,
      id: `+${added.length}`, summary: `imported ${added.length} from ${path.basename(target)}` });
  }
  return { added: added.length, skipped };
}

// ---- entities -> contacts / companies --------------------------------------
const contactRecords = [], companyRecords = [];
let skippedType = 0;
for (const e of entities) {
  if (SKIP_TYPES.has(e.type)) { skippedType++; continue; }
  const common = {
    name: e.name,
    x: e.x || null,
    linkedin: e.linkedin || null,
    website: e.website || null,
    priority: e.priority || null,
    verification: e.verification || 'Verify before use',
    handleConfidence: e.handleConfidence || null,
    sourceSheets: e.sources || null,
    source: 'workbook-directory',
    importedFrom: path.basename(target),
    fictional: false,
  };
  if (e.type === 'Person') {
    contactRecords.push({
      ...common,
      role: clip(e.role, 300) || null,
      companyId: null,
      company: e.company || null,
      relationshipType: 'directory-research',
      lanes: ['Prediction markets'],
      howKnown: 'Imported from the NEXTPredict people/company directory (master-schedule workbook).',
      location: null,
      permissionStatus: 'unverified',
      doNotContact: false,
      email: e.email || null,
      sharedInterests: e.why ? clip(e.why, 300) : null,
      potentialValue: e.use ? clip(e.use, 300) : null,
      notes: [e.why, e.people ? `Related: ${e.people}` : ''].filter(Boolean).map((t) => clip(t, 400)),
      nextAction: 'Verify identity and current role before outreach.',
      followUpDate: null,
    });
  } else {
    companyRecords.push({
      ...common,
      location: null,
      industry: e.category || null,
      note: clip([e.role, e.why].filter(Boolean).join(' — '), 400) || null,
      entityType: e.type,
    });
  }
}

const cRes = bulkInsert('companies', companyRecords);
const pRes = bulkInsert('contacts', contactRecords);

// ---- leads -----------------------------------------------------------------
const existingLeads = read('leads').items || [];
const leadSeen = new Set(existingLeads.map((l) => `${norm(l.name)}|${l.signal}`));
const leadRecords = [];
for (const l of leadRows) {
  const key = `${norm(l.name)}|${l.signal}`;
  if (!l.name || leadSeen.has(key)) continue;
  leadSeen.add(key);
  leadRecords.push({
    name: l.name,
    kind: l.kind || 'company',
    pillar: l.pillar || 'prediction-markets',
    signal: l.signal,
    why: l.why || null,
    linkedCompanyId: null,
    linkedContactId: null,
    evidence: [{ insightId: null, quote: clip(l.quote, 500), signal: l.signal, date: l.date || now.slice(0, 10) }],
    status: 'detected',
    suggestedNextStep: `Research: verify the entity and signal against a primary source before acting. Source: ${l.source || 'workbook deep-dive additions'}.`,
    source: 'workbook-directory',
    importedFrom: path.basename(target),
    fictional: false,
  });
}
const lRes = DRY
  ? { added: leadRecords.length, skipped: leadRows.length - leadRecords.length }
  : (() => {
      const doc = read('leads');
      doc.items = doc.items || [];
      const stamped = leadRecords.map((r) => ({ id: newId('leads'), createdAt: now, updatedAt: now, ...r }));
      if (stamped.length) {
        doc.items.push(...stamped);
        write('leads', doc);
        audit({ actor: 'import-directory', action: 'bulk-insert', collection: 'leads',
          id: `+${stamped.length}`, summary: `imported ${stamped.length} leads from ${path.basename(target)}` });
      }
      return { added: stamped.length, skipped: leadRows.length - leadRecords.length };
    })();

// ---- report ----------------------------------------------------------------
console.log(`\nDIRECTORY IMPORT ${DRY ? '(dry run) ' : ''}from ${path.basename(target)}`);
console.log('='.repeat(64));
console.log(`companies: +${cRes.added} (skipped ${cRes.skipped} existing)`);
console.log(`contacts:  +${pRes.added} (skipped ${pRes.skipped} existing)`);
console.log(`leads:     +${lRes.added} (skipped ${lRes.skipped} existing/dup)`);
console.log(`skipped source-only entities (papers/regulatory items): ${skippedType}`);
console.log('\nAll imports are real records (fictional:false), tagged source:"workbook-directory".');
console.log('View: #/relationships. Remember to commit data/ — git is the database.');
