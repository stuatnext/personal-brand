// retrieval.mjs — the writing-assist layer. Turns the intel corpus into a
// query engine: given a draft topic (or an insight), it retrieves the most
// relevant older references to weave in AND the people/companies worth
// tagging — by meaning, not by exact name match. Pure JS, zero dependencies
// (local-first): a BM25 lexical index over insights + past posts + the
// calendar, plus a name co-mention graph built from the same corpus.
//
// Everything routes through the same gates the rest of the engine uses:
//   - confidentiality: private / strictly-confidential material is never
//     returned as a reference for public output (public-after-anonymisation
//     is returned but flagged).
//   - do-not-contact: those contacts are never suggested as tags.
//   - never fabricate: it only surfaces records that already exist.
//
// It is a retriever, not a writer. It returns ranked, sourced candidates for
// a human (or Claude) to use; it does not draft, send or publish.

import { items } from './store.mjs';
import { OFF_VOICE } from './voice.mjs';

// --------------------------------------------------------------------------
// Tokenisation
// --------------------------------------------------------------------------
const STOP = new Set((
  'the a an and or but of to in on for with at by from as is are was were be been being ' +
  'it its this that these those they them their there here what which who whom whose when ' +
  'where why how all any both each few more most other some such no nor not only own same ' +
  'so than too very can will just should now then also into out up down over under about ' +
  'after before between through during above below off again further once has have had do ' +
  'does did doing would could may might must shall we you your our us i he she his her'
).split(/\s+/));

export function tokenize(s) {
  const m = (s || '').toLowerCase().match(/[a-z0-9][a-z0-9'+.-]*/g);
  if (!m) return [];
  return m.map((t) => t.replace(/^[''`]+|[''`]+$/g, '').replace(/'s$/, ''))
    .filter((t) => t.length >= 2 && !STOP.has(t));
}

// Generic single words that must not, on their own, count as an entity mention.
const GENERIC = new Set((
  'markets market prediction predict data research world signal line network truth ' +
  'opinion people media forum events product events global digital capital group the'
).split(/\s+/));

// --------------------------------------------------------------------------
// BM25
// --------------------------------------------------------------------------
function makeBM25(docs) {
  const N = docs.length;
  const df = new Map();
  let totalLen = 0;
  const prepared = docs.map((d) => {
    const toks = d.tokens || tokenize(d.text);
    const tf = new Map();
    for (const t of toks) tf.set(t, (tf.get(t) || 0) + 1);
    for (const t of tf.keys()) df.set(t, (df.get(t) || 0) + 1);
    totalLen += toks.length;
    return { ...d, tf, len: toks.length };
  });
  const avgdl = totalLen / (N || 1);
  const idf = new Map();
  for (const [t, c] of df) idf.set(t, Math.log(1 + (N - c + 0.5) / (c + 0.5)));
  return { prepared, idf, avgdl, N };
}

function bm25Score(idx, qTokens, { k1 = 1.5, b = 0.75 } = {}) {
  const q = [...new Set(qTokens)];
  const scored = [];
  for (const d of idx.prepared) {
    let s = 0;
    for (const t of q) {
      const tf = d.tf.get(t);
      if (!tf) continue;
      const idf = idx.idf.get(t) || 0;
      s += idf * (tf * (k1 + 1)) / (tf + k1 * (1 - b + b * (d.len / (idx.avgdl || 1))));
    }
    if (s > 0) scored.push({ doc: d, score: s });
  }
  scored.sort((a, b2) => b2.score - a.score);
  return scored;
}

// --------------------------------------------------------------------------
// Corpus
// --------------------------------------------------------------------------
const CONFIDENTIAL = new Set(['private-operating-lesson', 'strictly-confidential']);

function referenceDocs() {
  const out = [];
  for (const i of items('insights')) {
    if (i.fictional) continue;
    const text = [i.title, i.raw, i.distilled?.summary,
      ...(Array.isArray(i.distilled?.angles) ? i.distilled.angles : [])].filter(Boolean).join(' ');
    out.push({
      id: i.id, kind: 'insight', title: i.title, date: i.date,
      classification: i.confidentiality?.classification || 'public',
      lanes: i.lanes || [], source: i.source || '', text,
    });
  }
  for (const c of items('content')) {
    if (c.fictional || ['archived', 'raw-idea', 'qualified-idea'].includes(c.stage)) continue;
    out.push({
      id: c.id, kind: 'post', title: c.title, date: c.publishedDate || c.plannedDate || c.updatedAt,
      classification: c.confidentiality || 'public', lanes: c.lanes || [],
      stage: c.stage, url: c.url || '', channel: c.channel || '',
      text: [c.title, c.body, c.objective].filter(Boolean).join(' '),
    });
  }
  for (const cal of items('calendar')) {
    if (cal.fictional) continue;
    out.push({
      id: cal.id, kind: 'calendar', title: cal.title, date: cal.date,
      classification: 'public', lanes: cal.lane ? [cal.lane] : [], channel: cal.channel || '',
      text: [cal.title, cal.treatment, cal.objective].filter(Boolean).join(' '),
    });
  }
  return out;
}

function entityDocs() {
  const out = [];
  for (const c of items('contacts')) {
    if (c.fictional || c.doNotContact || c.permissionStatus === 'opted-out') continue;
    out.push({
      id: c.id, coll: 'contacts', name: c.name, etype: c.entityType || 'Person',
      x: c.x || null, linkedin: c.linkedin || null, verification: c.verification || null,
      priority: c.priority || null,
      text: [c.name, c.role, c.company, c.sharedInterests, (c.notes || []).join(' '),
        (c.lanes || []).join(' ')].filter(Boolean).join(' '),
    });
  }
  for (const c of items('companies')) {
    if (c.fictional) continue;
    out.push({
      id: c.id, coll: 'companies', name: c.name, etype: c.entityType || 'Company',
      x: c.x || null, linkedin: c.linkedin || null, verification: c.verification || null,
      priority: c.priority || null,
      text: [c.name, c.industry, c.note, c.entityType].filter(Boolean).join(' '),
    });
  }
  return out;
}

// Name-based co-mention graph over the reference corpus, plus the per-doc
// entity presence used to boost tag suggestions.
function comention(refDocs, entDocs) {
  const ents = entDocs.map((e) => ({ name: e.name, toks: tokenize(e.name), lc: e.name.toLowerCase() }))
    .filter((e) => e.toks.length && !(e.toks.length === 1 && (e.toks[0].length < 5 || GENERIC.has(e.toks[0]))));
  const graph = new Map();
  const add = (a, b) => {
    if (!graph.has(a)) graph.set(a, new Map());
    graph.get(a).set(b, (graph.get(a).get(b) || 0) + 1);
  };
  for (const d of refDocs) {
    const set = new Set(tokenize(d.text));
    const lc = d.text.toLowerCase();
    const present = [];
    for (const e of ents) {
      const hit = e.toks.length >= 2 ? e.toks.every((t) => set.has(t)) && lc.includes(e.lc)
        : set.has(e.toks[0]);
      if (hit) present.push(e.name);
    }
    d._ents = present;
    for (let i = 0; i < present.length; i++) {
      for (let j = i + 1; j < present.length; j++) {
        add(present[i], present[j]);
        add(present[j], present[i]);
      }
    }
  }
  return graph;
}

// --------------------------------------------------------------------------
// Index (memoised per process; invalidated when record counts change)
// --------------------------------------------------------------------------
let _cache = null;
function signature() {
  return ['insights', 'content', 'calendar', 'contacts', 'companies']
    .map((c) => items(c).length).join('-');
}

export function buildIndex({ fresh = false } = {}) {
  const sig = signature();
  if (!fresh && _cache && _cache.sig === sig) return _cache;
  const refs = referenceDocs();
  const ents = entityDocs();
  const graph = comention(refs, ents);          // annotates refs with _ents
  const refIndex = makeBM25(refs.map((d) => ({ ...d, tokens: tokenize(d.text) })));
  const entIndex = makeBM25(ents.map((d) => ({ ...d, tokens: tokenize(d.text) })));
  _cache = { sig, refIndex, entIndex, graph, entByName: new Map(ents.map((e) => [e.name, e])) };
  return _cache;
}

const snippet = (text, n = 200) => {
  const s = (text || '').replace(/\s+/g, ' ').trim();
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
};

// --------------------------------------------------------------------------
// Public API
// --------------------------------------------------------------------------

// Relevant older references (insights, past posts, planned calendar items).
export function retrieveReferences(query, { k = 6, publicSafe = true, excludeId = null } = {}) {
  const idx = buildIndex();
  const ranked = bm25Score(idx.refIndex, tokenize(query));
  const out = [];
  for (const { doc, score } of ranked) {
    if (doc.id === excludeId) continue;
    if (publicSafe && CONFIDENTIAL.has(doc.classification)) continue;
    out.push({
      id: doc.id, kind: doc.kind, title: doc.title, date: doc.date || null,
      stage: doc.stage, channel: doc.channel, url: doc.url,
      classification: doc.classification,
      needsAnonymisation: doc.classification === 'public-after-anonymisation',
      lanes: doc.lanes, score: Number(score.toFixed(3)),
      why: `Matches on: ${topTerms(query, doc.text, idx.refIndex, 4).join(', ')}`,
      snippet: snippet(doc.text),
      source: doc.kind === 'insight' ? doc.source : (doc.channel || doc.kind),
    });
    if (out.length >= k) break;
  }
  return out;
}

// People / companies worth tagging, by meaning. Combines profile relevance
// with co-mention around the query's top references.
export function suggestTags(query, { k = 8, publicSafe = true } = {}) {
  const idx = buildIndex();
  const base = bm25Score(idx.entIndex, tokenize(query));
  const scores = new Map();
  const meta = new Map();
  for (const { doc, score } of base) {
    scores.set(doc.name, score);
    meta.set(doc.name, doc);
  }
  // Boost entities co-mentioned in the query's most relevant reference docs.
  const topRefs = bm25Score(idx.refIndex, tokenize(query)).slice(0, 6);
  const boost = new Map();
  for (const { doc } of topRefs) {
    for (const name of doc._ents || []) boost.set(name, (boost.get(name) || 0) + 1);
  }
  const maxBase = base[0]?.score || 1;
  for (const [name, b] of boost) {
    const cur = scores.get(name) || 0;
    scores.set(name, cur + (b / topRefs.length) * maxBase * 0.6);
    if (!meta.has(name)) meta.set(name, idx.entByName.get(name));
  }
  const ranked = [...scores.entries()]
    .filter(([name]) => meta.get(name))
    .sort((a, b) => b[1] - a[1])
    .slice(0, k);
  return ranked.map(([name, score]) => {
    const e = meta.get(name);
    const neighbours = [...(idx.graph.get(name) || new Map()).entries()]
      .sort((a, b) => b[1] - a[1]).slice(0, 3).map(([n]) => n);
    return {
      name, id: e.id, type: e.etype, collection: e.coll,
      handle: e.x || null, linkedin: e.linkedin || null,
      verification: e.verification || null,
      score: Number(score.toFixed(3)),
      alsoConsider: neighbours,
      why: snippet(e.text.replace(name, '').trim(), 120),
    };
  });
}

// Which query terms actually drove a match (for the "why").
function topTerms(query, docText, idx, n) {
  const q = [...new Set(tokenize(query))];
  const set = new Set(tokenize(docText));
  return q.filter((t) => set.has(t))
    .sort((a, b) => (idx.idf.get(b) || 0) - (idx.idf.get(a) || 0))
    .slice(0, n);
}

const VOICE_NOTE = `Draft in Stuart's voice. Hard-banned: ${OFF_VOICE.slice(0, 8).join(', ')}` +
  `${OFF_VOICE.length > 8 ? ', …' : ''}. No em dashes, no negative parallelism. ` +
  `Run the 'lint' action on the final draft.`;

// The writing-loop entry point: everything a drafter needs for one topic.
export function assist(query, { k = 6, tagK = 8, publicSafe = true, excludeId = null } = {}) {
  const references = retrieveReferences(query, { k, publicSafe, excludeId });
  const tags = suggestTags(query, { k: tagK, publicSafe });
  const flagged = references.filter((r) => r.needsAnonymisation)
    .map((r) => ({ id: r.id, title: r.title, note: 'public-after-anonymisation — apply the checklist before use.' }));
  return {
    query,
    references,
    tags,
    confidentiality: {
      publicSafe,
      note: publicSafe
        ? 'Private / strictly-confidential material was excluded from references.'
        : 'publicSafe is off — confidential references are included; do not use them in public output.',
      flagged,
    },
    voice: VOICE_NOTE,
    generatedAt: new Date().toISOString(),
  };
}
