#!/usr/bin/env node
// import-schedule.mjs — imports a master social schedule workbook (.xlsx)
// into the editorial calendar. Built for the NEXTPredict Master Social
// Schedule shape: a "Master Calendar" sheet whose header row contains
// Date / Channel / Topic (any sheet with those headers works). Re-import
// is safe: items dedupe on date + topic.
//
//   node scripts/import-schedule.mjs <xlsx> [--dry-run] [--clear-fictional]
//     --clear-fictional   remove seeded demo calendar slots when landing
//                         the first real schedule
//
// Pure Node; the xlsx is unzipped with the system unzip and the sheet XML
// parsed directly (inline strings + shared strings both supported).

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { items, insert, read, write } from '../lib/store.mjs';

const args = process.argv.slice(2);
const DRY = args.includes('--dry-run');
const CLEAR_FICTIONAL = args.includes('--clear-fictional');
const target = args.find((a) => !a.startsWith('--'));
if (!target || !fs.existsSync(target)) {
  console.error('Usage: node scripts/import-schedule.mjs <xlsx> [--dry-run] [--clear-fictional]');
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Minimal xlsx reading.
// ---------------------------------------------------------------------------
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sched-'));
execFileSync('unzip', ['-qo', path.resolve(target), '-d', tmp]);

// The sheet XML may or may not use a namespace prefix (<row> vs <x:row>).
const decode = (s) => s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'");
const T = /<(?:\w+:)?t[^>]*>([\s\S]*?)<\/(?:\w+:)?t>/g;
const sharedStrings = (() => {
  const f = path.join(tmp, 'xl/sharedStrings.xml');
  if (!fs.existsSync(f)) return [];
  return [...fs.readFileSync(f, 'utf8').matchAll(/<(?:\w+:)?si>([\s\S]*?)<\/(?:\w+:)?si>/g)]
    .map((m) => decode([...m[1].matchAll(T)].map((t) => t[1]).join('')));
})();

const colIndex = (ref) => {
  let n = 0;
  for (const ch of ref.replace(/\d+/g, '')) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
};

function sheetRows(file) {
  const xml = fs.readFileSync(file, 'utf8');
  const rows = [];
  for (const rowM of xml.matchAll(/<(?:\w+:)?row[^>]*>([\s\S]*?)<\/(?:\w+:)?row>/g)) {
    const cells = [];
    for (const cM of rowM[1].matchAll(/<(?:\w+:)?c ([^>]*?)\s*\/>|<(?:\w+:)?c ([^>]*?)>([\s\S]*?)<\/(?:\w+:)?c>/g)) {
      const attrs = cM[1] ?? cM[2];
      const body = cM[3] || '';
      const ref = /r="([A-Z]+\d+)"/.exec(attrs)?.[1];
      const type = /t="(\w+)"/.exec(attrs)?.[1];
      let val = '';
      const v = /<(?:\w+:)?v[^>]*>([\s\S]*?)<\/(?:\w+:)?v>/.exec(body);
      const is = /<(?:\w+:)?is>([\s\S]*?)<\/(?:\w+:)?is>/.exec(body);
      if (v) val = type === 's' ? (sharedStrings[Number(v[1])] ?? '') : decode(v[1]);
      else if (is) val = decode([...is[1].matchAll(T)].map((t) => t[1]).join(''));
      if (ref != null) cells[colIndex(ref)] = val;
    }
    rows.push(cells);
  }
  return rows;
}

const excelDate = (serial) => new Date(Date.UTC(1899, 11, 30) + Math.round(Number(serial)) * 86400000).toISOString().slice(0, 10);

// Find the sheet whose header row contains Date + Channel + Topic.
const sheetFiles = fs.readdirSync(path.join(tmp, 'xl/worksheets')).filter((f) => f.endsWith('.xml'));
let headerIdx = -1, headers = null, rows = null, foundSheet = null;
for (const f of sheetFiles.sort()) {
  const r = sheetRows(path.join(tmp, 'xl/worksheets', f));
  const idx = r.findIndex((row) => row?.includes('Date') && row?.includes('Channel') && row?.includes('Topic'));
  if (idx !== -1) { headerIdx = idx; headers = r[idx]; rows = r; foundSheet = f; break; }
}
if (!rows) { console.error('No sheet with Date/Channel/Topic headers found.'); process.exit(1); }
const col = (name) => headers.findIndex((h) => (h || '').toLowerCase().startsWith(name.toLowerCase()));
const C = {
  date: col('Date'), channel: col('Channel'), format: col('Format'), topic: col('Topic'),
  treatment: col('Treatment'), objective: col('Objective'), status: col('Status'),
  priority: col('Priority'), verification: col('Verification'), source: col('Source'), owner: col('Owner'),
};

const FORMAT_MAP = { 'stuart linkedin': 'linkedin-post', 'x': 'x-post', 'prediction markets forum': 'forum-post' };
const normStatus = (s) => (s || 'planned').toLowerCase().replace(/\s+/g, '-');

const existing = items('calendar');
const seen = new Set(existing.map((i) => `${i.date}|${(i.title || '').toLowerCase()}`));
let added = 0, skipped = 0, badRows = 0;
const summary = { byChannel: {}, byStatus: {}, unverified: [] };

for (const row of rows.slice(headerIdx + 1)) {
  const rawDate = row?.[C.date];
  const topic = row?.[C.topic];
  if (!rawDate || !topic) { if (topic || rawDate) badRows++; continue; }
  const date = /^\d+$/.test(String(rawDate)) ? excelDate(rawDate) : String(rawDate).slice(0, 10);
  const key = `${date}|${topic.toLowerCase()}`;
  if (seen.has(key)) { skipped++; continue; }
  seen.add(key);
  const channel = row[C.channel] || '';
  const status = normStatus(row[C.status]);
  const item = {
    date, title: topic,
    channel,
    format: FORMAT_MAP[channel.toLowerCase()] || 'linkedin-post',
    lane: 'Prediction markets',
    brand: 'brand-nextpredict',
    objective: row[C.objective] || null,
    treatment: row[C.treatment] || null,
    status, priority: row[C.priority] || null,
    verification: row[C.verification] || null,
    sourceNote: row[C.source] || null,
    owner: row[C.owner] || null,
    importedFrom: path.basename(target),
    contentId: null,
  };
  summary.byChannel[channel] = (summary.byChannel[channel] || 0) + 1;
  summary.byStatus[status] = (summary.byStatus[status] || 0) + 1;
  if (/unverified|conditional|confirm/.test(status)) summary.unverified.push(`${date} ${topic}`);
  if (!DRY) insert('calendar', item, { actor: 'import-schedule' });
  added++;
}

if (CLEAR_FICTIONAL && !DRY) {
  const doc = read('calendar');
  const before = doc.items.length;
  doc.items = doc.items.filter((i) => !i.fictional);
  write('calendar', doc);
  console.log(`Removed ${before - doc.items.length} fictional demo calendar slots.`);
}
fs.rmSync(tmp, { recursive: true, force: true });

console.log(`\nSCHEDULE IMPORT ${DRY ? '(dry run) ' : ''}from ${path.basename(target)} (sheet ${foundSheet})`);
console.log('='.repeat(64));
console.log(`imported: ${added} · duplicates skipped: ${skipped} · incomplete rows ignored: ${badRows}`);
console.log('by channel:', Object.entries(summary.byChannel).map(([k, v]) => `${k} ${v}`).join(' · '));
console.log('by status:', Object.entries(summary.byStatus).map(([k, v]) => `${k} ${v}`).join(' · '));
if (summary.unverified.length) {
  console.log(`\nVERIFICATION-GATED (${summary.unverified.length}) — these are monitoring tasks, not approved claims:`);
  for (const u of summary.unverified.slice(0, 12)) console.log(`  ! ${u}`);
  if (summary.unverified.length > 12) console.log(`  ... and ${summary.unverified.length - 12} more (see #/calendar)`);
}
console.log('\nView: #/calendar. Remember to commit data/ — git is the database.');
