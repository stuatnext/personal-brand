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
import { items, insert, update } from '../lib/store.mjs';
import { review as confReview } from '../lib/confidentiality.mjs';

const args = process.argv.slice(2);
const DRY = args.includes('--dry-run');
// --leads-only: mine buying signals and entities WITHOUT creating insight
// records. For high-volume social batches (hundreds of feed posts) where
// one-insight-per-post would drown the working collection; the lossless
// archive under intel/ remains the source of truth.
const LEADS_ONLY = args.includes('--leads-only');
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
  [/igaming|casino|slots|gaming operator|gaming supplier/i, 'iGaming commercial strategy'],
  [/sports ?betting|sportsbook|bookmaker|odds feed|in-play|wager/i, 'Sports betting & sportsbook strategy'],
  [/prediction market|event contract|kalshi|polymarket|cftc/i, 'Prediction markets'],
  [/singapore|\bsea\b|southeast asia|apac|malaysia|indonesia|vietnam|thailand|philippines|jakarta|kuala lumpur|bangkok|manila|ho chi minh|hanoi/i, 'Singapore & SEA commercial growth'],
  [/operational efficiency|process(es)? (broke|fix|map)|operating (drag|cadence|rhythm)|efficien(cy|t)|manual work|bottleneck/i, 'Operational efficiency'],
  [/newsletter|podcast|media revenue|affiliate|editorial/i, 'B2B media monetisation'],
  [/negotiat/i, 'Commercial negotiation'],
  [/gtm|go.to.market|launch|positioning/i, 'GTM execution'],
  [/founder|bottleneck|delegat/i, 'Founder-led operating drag'],
  [/sales and marketing|alignment|handoff/i, 'Sales and marketing alignment'],
  [/categor(y|ies) (formation|creation)|new category/i, 'Category creation'],
];

// Lead signals — buying/relevance triggers matched to the two authority
// pillars. A signal + an entity in the same record = a detected lead,
// queued for RESEARCH (never auto-contacted, never enriched with invented
// details). Extend this list every time a real lead pattern repeats.
const LEAD_SIGNALS = [
  { re: /rais(ed|es|ing)\s+(a\s+)?(?:[$€£]\s?\d[\d.,]*\s?(m|k|million|billion)?|seed|series\s+[a-d])\b|seed round|funding round|closes? (a )?round/i, signal: 'funding', pillar: 'strait-up-growth', why: 'Fresh capital means growth targets and commercial chaos to fix; budget exists.' },
  { re: /(hiring|job opening|open role|we'?re looking for)\s+(an?\s+)?(?:[a-z]+\s+){0,3}(head|vp|director|chief|lead|officer)|appoint(s|ed)|joins? as|named (as )?(head|vp|director|chief|cmo|coo|cro)/i, signal: 'leadership-hire', pillar: 'strait-up-growth', why: 'New commercial leaders buy audits and systems in their first 90 days; hiring shows investment in the function.' },
  { re: /expand(s|ing)?\s+(to|into)\s+(singapore|southeast asia|sea|apac|asia)|(opens?|opening|launch(es|ing)?)\s+(an?\s+)?(office|hub|team)\s+in\s+(singapore|asia|apac)/i, signal: 'sea-expansion', pillar: 'strait-up-growth', why: 'Entering Singapore/SEA is exactly the moment the Strait Up Growth lens (local GTM, channel mix, trust dynamics) is worth money.' },
  { re: /(crm|pipeline|forecast)[^.\n]{0,40}(mess|chaos|nightmare|broken|unreliable|can'?t trust|don'?t trust)|migrat(e|ed|ing)[^.\n]{0,20}crm|three crms/i, signal: 'crm-pain', pillar: 'strait-up-growth', why: 'Stated CRM/pipeline pain is a direct Commercial Systems Audit trigger.' },
  { re: /looking for (a |an )?(consultant|advisor|adviser|fractional|agency|help with)/i, signal: 'explicit-demand', pillar: 'strait-up-growth', why: 'Explicitly asking for outside help.' },
  { re: /(struggling|drowning|overwhelmed)[^.\n]{0,50}(leads?|pipeline|follow.?ups?|marketing|sales)/i, signal: 'operating-pain', pillar: 'strait-up-growth', why: 'Voiced operating pain in the commercial engine.' },
  { re: /launch(es|ed|ing)?[^.\n]{0,50}(prediction market|event contracts?)|new (prediction[- ]market )?(venue|exchange)|dcm designation|cftc (approv|filing|designat)/i, signal: 'pm-venue-launch', pillar: 'prediction-markets', why: 'A new venue or regulatory step in prediction markets: worth knowing early, before the wire covers it.' },
  { re: /(head of|hiring)[^.\n]{0,30}(compliance|market integrity|surveillance)|compliance (hire|role|team)/i, signal: 'pm-compliance-hire', pillar: 'prediction-markets', why: 'Compliance-first hiring is the tell for serious prediction-markets operators (Stuart\'s own published read).' },
  { re: /(partnership|integrat(es|ion)|deal) with[^.\n]{0,40}(kalshi|polymarket|prediction market)/i, signal: 'pm-partnership', pillar: 'prediction-markets', why: 'Companies partnering into the category are forming their strategy now.' },
  { re: /(igaming|casino|sportsbook|sports betting|betting operator|slots? supplier)[^.\n]{0,70}(licen[cs]e|regulat(ed|ion|or)|goes live|enters?|launch|expand)|licen[cs]e (award|grant|approv)[^.\n]{0,60}(igaming|casino|sportsbook|betting|gaming)/i, signal: 'igaming-market-move', pillar: 'igaming', why: 'A licence, market opening or expansion in iGaming/sports betting: the operators and suppliers involved are NEXT.io\'s exact audience, and moving now.' },
  { re: /(igaming|casino|sportsbook|sports betting|gaming (group|operator))[^.\n]{0,80}(appoint|joins as|named|hires?)|(appoint(s|ed)|joins as|named)[^.\n]{0,80}(igaming|casino|sportsbook|sports betting)/i, signal: 'igaming-leadership', pillar: 'igaming', why: 'Senior moves in iGaming/sports betting: new leaders reset media, sponsorship and event budgets in their first quarter.' },
  { re: /(acquir(es|ed|ing)|merger|takeover|buys?)[^.\n]{0,70}(igaming|casino|sportsbook|betting|slots)|(igaming|casino|sportsbook|betting)[^.\n]{0,70}(acquir(es|ed|ing)|merger|takeover)/i, signal: 'igaming-ma', pillar: 'igaming', why: 'M&A reshapes commercial teams and budgets; both sides of the deal are conversations worth having early.' },
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
const detectedLeads = [];
const existingLeads = items('leads', { includeDeleted: true });
const leadByName = new Map(existingLeads.map((l) => [l.name.toLowerCase(), l]));

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
  const STOP = new Set(('the and but that this what when where which while with watched founder internal notes there their they then these those every most some people one two three after before because during however instead nothing something anything everyone someone monday tuesday wednesday thursday friday saturday sunday january february march april may june july august september october november december singapore asia europe london kuala lumpur bangkok jakarta manila hanoi here still just also over under about against between prediction markets separately meanwhile series director head chief commercial').split(' '));
  const recordCandidates = [];
  const addCandidate = (name) => {
    if (STOP.has(name.split(' ')[0].toLowerCase())) return;
    if (knownNames.some((k) => k.name.toLowerCase() === name.toLowerCase())) return;
    // A fragment of a known entity's name is not a new entity.
    if (!name.includes(' ') && knownNames.some((k) => k.name.toLowerCase().split(/\s+/).includes(name.toLowerCase()))) return;
    // A real name is never written lowercase elsewhere in the same text.
    if (new RegExp(`(?<![A-Za-z])${name.split(' ')[0].toLowerCase()}(?![A-Za-z])`).test(r.raw)) return;
    candidateEntities.set(name, (candidateEntities.get(name) || 0) + 1);
    if (!recordCandidates.some((c) => c.toLowerCase() === name.toLowerCase())) recordCandidates.push(name);
  };
  for (const m of r.raw.matchAll(/\b([A-Z][a-z]{2,}(?: [A-Z][a-z]{2,}){1,2})\b/g)) addCandidate(m[1]);
  for (const sentence of r.raw.split(/(?<=[.!?:])\s+|\n+/)) {
    const words = sentence.trim().split(/\s+/);
    for (let w = 0; w < words.length; w++) {
      const token = words[w].replace(/[^A-Za-z']/g, '');
      if (/^[A-Z][a-z]{2,}$/.test(token)) addCandidate(token);
    }
  }
  // Drop fragments: a candidate that is a word inside a longer candidate
  // ("Tigerlily", "Commerce" when "Tigerlily Commerce" was found).
  const fragments = new Set();
  for (const a of recordCandidates) for (const b of recordCandidates) {
    if (a !== b && b.split(' ').length > a.split(' ').length && b.split(' ').some((w) => w.toLowerCase() === a.toLowerCase())) fragments.add(a);
  }
  for (const f of fragments) {
    recordCandidates.splice(recordCandidates.indexOf(f), 1);
    if ((candidateEntities.get(f) || 0) <= 1) candidateEntities.delete(f);
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
  let insightId = LEADS_ONLY ? `batch:${r.sourceFile}` : '(dry-run)';
  if (!DRY && !LEADS_ONLY) {
    const saved = insert('insights', item, { actor: 'ingest' });
    insightId = saved.id;
  }
  if (!LEADS_ONLY) created.push({ id: insightId, title: r.title, lanes, classification: conf.classification });
  existing.set(h, insightId);

  // ----- Lead detection: signal + entity in the same record ------------------
  for (const sig of LEAD_SIGNALS) {
    const m = r.raw.match(sig.re);
    if (!m) continue;
    // The sentence containing the match is the evidence quote.
    const idx = r.raw.indexOf(m[0]);
    const sentStart = Math.max(r.raw.lastIndexOf('.', idx), r.raw.lastIndexOf('\n', idx)) + 1;
    const sentEnd = (() => { const e = r.raw.indexOf('.', idx + m[0].length); return e === -1 ? Math.min(r.raw.length, idx + 220) : e + 1; })();
    const quote = r.raw.slice(sentStart, sentEnd).trim().slice(0, 260);

    // Entities: pair the signal with names in the SAME SENTENCE first
    // (known companies/contacts, then multi-word candidates, then single
    // words); fall back to record-level names, then the record title.
    // Search rings: the sentence, then its paragraph, then the record.
    const paraStart = r.raw.lastIndexOf('\n\n', idx) + 1;
    const paraEndIdx = r.raw.indexOf('\n\n', idx);
    const paragraph = r.raw.slice(paraStart, paraEndIdx === -1 ? r.raw.length : paraEndIdx);
    const rings = [quote, paragraph, r.raw];
    let entities = [];
    for (const ring of rings) {
      const inRing = (name) => ring.toLowerCase().includes(name.toLowerCase());
      for (const cid of relatedCompanies) { const c = companies.find((x) => x.id === cid); if (c && inRing(c.name)) entities.push({ name: c.name, kind: 'company', linkedCompanyId: cid }); }
      for (const cid of relatedContacts) { const c = contacts.find((x) => x.id === cid); if (c && inRing(c.name)) entities.push({ name: c.name, kind: 'person', linkedContactId: cid }); }
      if (!entities.length) {
        const local = recordCandidates.filter(inRing).sort((a, b) => b.split(' ').length - a.split(' ').length);
        for (const name of local.slice(0, 2)) entities.push({ name, kind: 'unknown' });
      }
      if (entities.length) break;
    }
    if (!entities.length) entities.push({ name: r.title, kind: 'unknown' });

    for (const ent of entities) {
      if (!ent.name) continue;
      const key = ent.name.toLowerCase();
      const evidence = { insightId, quote, signal: sig.signal, date: new Date().toISOString().slice(0, 10) };
      const existingLead = leadByName.get(key);
      if (existingLead) {
        if (!DRY && !(existingLead.evidence || []).some((e) => e.quote === quote)) {
          update('leads', existingLead.id, { evidence: [...(existingLead.evidence || []), evidence] }, { actor: 'ingest' });
        }
        detectedLeads.push({ name: ent.name, signal: sig.signal, pillar: sig.pillar, why: sig.why, quote, merged: true });
        continue;
      }
      const lead = {
        name: ent.name, kind: ent.kind, pillar: sig.pillar, signal: sig.signal, why: sig.why,
        linkedCompanyId: ent.linkedCompanyId || null, linkedContactId: ent.linkedContactId || null,
        evidence: [evidence], status: 'detected',
        suggestedNextStep: ent.linkedContactId
          ? 'Known contact with a live trigger: draft outreach citing the signal.'
          : 'Research: verify the entity, find the named decision-maker (never invent details), then decide the route.',
      };
      if (!DRY) {
        const saved = insert('leads', lead, { actor: 'ingest' });
        leadByName.set(key, saved);
      } else {
        leadByName.set(key, { ...lead, id: '(dry-run)' });
      }
      detectedLeads.push({ name: ent.name, signal: sig.signal, pillar: sig.pillar, why: sig.why, quote, merged: false });
    }
  }
}

for (const d of tmpDirs) fs.rmSync(d, { recursive: true, force: true });

// ---------------------------------------------------------------------------
// Routing summary.
// ---------------------------------------------------------------------------
console.log(`\nINGEST ${DRY ? '(dry run) ' : ''}${LEADS_ONLY ? '(leads-only: no insight records created) ' : ''}— ${records.length} record(s) found in ${path.basename(target)}`);
console.log('='.repeat(64));
console.log(`created: ${created.length} · duplicates skipped: ${duplicates.length} · unsupported files: ${skipped.length}`);
for (const c of created) console.log(`  + ${c.id}  ${c.title}\n      lanes: ${c.lanes.join(', ') || '(none matched — tag by hand)'} · confidentiality: ${c.classification}`);
if (duplicates.length) for (const d of duplicates) console.log(`  = duplicate: "${d.title}" (already ${d.existingId})`);
if (skipped.length) console.log(`  ? skipped (unsupported type): ${skipped.join(', ')}`);
if (confidentialFlags.length) {
  console.log(`\nCONFIDENTIALITY: ${confidentialFlags.length} item(s) flagged non-public — confirm before any drafting:`);
  for (const f of confidentialFlags) console.log(`  ! ${f.classification}: ${f.title}`);
}
if (detectedLeads.length) {
  console.log(`\nLEADS DETECTED (${detectedLeads.length}) — queued for research, never auto-contacted:`);
  for (const l of detectedLeads) {
    console.log(`  → ${l.name} [${l.signal} · ${l.pillar}]${l.merged ? ' (evidence added to existing lead)' : ''}`);
    console.log(`      "${l.quote}"`);
    console.log(`      ${l.why}`);
  }
  console.log('  Work the queue in #/relationships (Prospects & leads).');
}
if (candidateEntities.size) {
  const top = [...candidateEntities.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12);
  console.log(`\nCANDIDATE ENTITIES (not in the relationship base — research before creating, never invent details):`);
  for (const [name, n] of top) console.log(`  ? ${name}${n > 1 ? ` (x${n})` : ''}`);
}
console.log(`\nNext: open the app (npm run dev) — ingested insights surface on Today and in #/insights for distillation into LinkedIn / X / Substack drafts.`);
if (!DRY) console.log('Remember to commit data/ — git is the database.');
