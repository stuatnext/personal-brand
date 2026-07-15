// store.mjs — JSON collection store. Git is the persistence layer (house
// pattern: next-os / nextpredict-engine). Every collection is one file in
// data/, shaped { meta: {...}, items: [...] }. Writes are atomic
// (tmp + rename) and append an audit entry.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DATA = path.join(ROOT, 'data');

export const COLLECTIONS = [
  'settings', 'brands', 'lanes', 'offers', 'voice', 'prompts',
  'insights', 'contacts', 'companies', 'interactions', 'content',
  'engagements', 'outreach', 'opportunities', 'tasks', 'knowledge',
  'calendar', 'reviews', 'audit',
];

const ID_PREFIX = {
  insights: 'ins', contacts: 'con', companies: 'com', interactions: 'int',
  content: 'cnt', engagements: 'eng', outreach: 'out', opportunities: 'opp',
  tasks: 'tsk', knowledge: 'kn', calendar: 'cal', reviews: 'rev',
  offers: 'off', lanes: 'lane', brands: 'brand', audit: 'aud',
};

export function newId(collection) {
  const prefix = ID_PREFIX[collection] || collection.slice(0, 3);
  return `${prefix}-${crypto.randomBytes(4).toString('hex')}`;
}

function file(collection) {
  if (!COLLECTIONS.includes(collection)) throw new Error(`unknown collection: ${collection}`);
  return path.join(DATA, `${collection}.json`);
}

export function read(collection) {
  const f = file(collection);
  if (!fs.existsSync(f)) return { meta: {}, items: [] };
  return JSON.parse(fs.readFileSync(f, 'utf8'));
}

export function items(collection, { includeDeleted = false } = {}) {
  const all = read(collection).items || [];
  return includeDeleted ? all : all.filter((i) => !i.deletedAt);
}

export function get(collection, id) {
  return items(collection, { includeDeleted: true }).find((i) => i.id === id) || null;
}

export function write(collection, doc) {
  fs.mkdirSync(DATA, { recursive: true });
  const f = file(collection);
  const tmp = `${f}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(doc, null, 2) + '\n');
  fs.renameSync(tmp, f);
}

export function insert(collection, item, { actor = 'stuart' } = {}) {
  const doc = read(collection);
  const now = new Date().toISOString();
  const full = { id: item.id || newId(collection), createdAt: now, updatedAt: now, ...item };
  doc.items = doc.items || [];
  doc.items.push(full);
  write(collection, doc);
  audit({ actor, action: 'insert', collection, id: full.id, summary: full.title || full.name || '' });
  return full;
}

export function update(collection, id, patch, { actor = 'stuart' } = {}) {
  const doc = read(collection);
  const idx = (doc.items || []).findIndex((i) => i.id === id);
  if (idx === -1) throw new Error(`${collection}/${id} not found`);
  const before = doc.items[idx];
  const after = { ...before, ...patch, id, updatedAt: new Date().toISOString() };
  doc.items[idx] = after;
  write(collection, doc);
  audit({ actor, action: 'update', collection, id, summary: Object.keys(patch).join(',') });
  return after;
}

export function softDelete(collection, id, { actor = 'stuart' } = {}) {
  return update(collection, id, { deletedAt: new Date().toISOString() }, { actor });
}

export function audit(entry) {
  const f = file('audit');
  fs.mkdirSync(DATA, { recursive: true });
  const doc = fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : { meta: {}, items: [] };
  doc.items.push({ id: newId('audit'), at: new Date().toISOString(), ...entry });
  // keep the audit log bounded so the file stays reviewable in git
  if (doc.items.length > 5000) doc.items = doc.items.slice(-5000);
  const tmp = `${f}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(doc, null, 2) + '\n');
  fs.renameSync(tmp, f);
}

export function settings() {
  const s = read('settings');
  return s.values || {};
}

export function state() {
  const out = {};
  for (const c of COLLECTIONS) {
    if (c === 'audit') continue;
    out[c] = c === 'settings' ? read('settings') : items(c);
  }
  return out;
}
