#!/usr/bin/env node
// serve.mjs — the Strait Up Growth engine server. Pure Node, no
// dependencies. Serves the command centre (app/) and a JSON API over the
// data/ collections. Local-first: git is the persistence layer.
//
//   node scripts/serve.mjs            # http://localhost:4173
//   node scripts/serve.mjs --port 0   # ephemeral port (self-test)
//
// Safety invariants enforced HERE, not in the UI:
//   - nothing is ever sent or published by the system; Stuart acts, then
//     records the act (mark-sent / mark-published require prior approval)
//   - do-not-contact contacts cannot be drafted to, approved or sent
//   - generic PATCH cannot smuggle a record into sent/published/approved
//   - every write lands in the audit log

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { COLLECTIONS, items, get, insert, update, softDelete, read, write, audit, settings } from '../lib/store.mjs';
import { lint } from '../lib/voice.mjs';
import { review as confReview, brandGate, ANONYMISATION_CHECKLIST } from '../lib/confidentiality.mjs';
import { scoreContent, scoreOutreach, relationshipStrength, authorityScore } from '../lib/scoring.mjs';
import { todayBriefing } from '../lib/recommend.mjs';
import { analytics } from '../lib/analytics.mjs';
import { distillInsight, draftContent, draftOutreach, weeklyReviewDraft, providerName } from '../lib/ai.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const APP = path.join(ROOT, 'app');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png' };

// Fields only action endpoints may set; generic PATCH rejects them.
const GUARDED_FIELDS = {
  outreach: ['sentAt', 'approval', 'stage'],
  content: ['publishedDate', 'stage'],
};
const OUTREACH_STAGE_VIA_PATCH_OK = ['identified', 'researched', 'qualified', 'drafted', 'paused', 'do-not-contact'];
const CONTENT_STAGE_VIA_PATCH_OK = ['raw-idea', 'qualified-idea', 'outline', 'draft', 'review', 'repurposed', 'archived'];

function json(res, code, body) {
  const text = JSON.stringify(body, null, 2);
  res.writeHead(code, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(text) });
  res.end(text);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => { data += c; if (data.length > 2_000_000) reject(new Error('body too large')); });
    req.on('end', () => { try { resolve(data ? JSON.parse(data) : {}); } catch (e) { reject(new Error('invalid JSON body')); } });
    req.on('error', reject);
  });
}

function contactGuard(contactId) {
  const contact = get('contacts', contactId);
  if (!contact) throw httpError(404, `contact ${contactId} not found`);
  if (contact.doNotContact || contact.permissionStatus === 'opted-out') {
    throw httpError(409, `${contact.name} is marked do-not-contact / opted out. The engine will not draft, approve or record sends for this contact.`);
  }
  return contact;
}

function httpError(code, message) { const e = new Error(message); e.code = code; return e; }

// ---------------------------------------------------------------------------
// Action handlers — the workflow verbs.
// ---------------------------------------------------------------------------
const actions = {
  async lint({ text = '', brand = 'stuart', kind = 'post' }) {
    return lint(text, { brand, kind });
  },

  async confidentiality({ text, insightId, confirm }) {
    if (insightId && confirm) {
      const ins = get('insights', insightId);
      if (!ins) throw httpError(404, 'insight not found');
      const updated = update('insights', insightId, {
        confidentiality: { ...(ins.confidentiality || {}), classification: confirm, confirmed: true, confirmedAt: new Date().toISOString() },
      });
      return { ok: true, insight: updated };
    }
    const source = insightId ? get('insights', insightId)?.raw : text;
    if (source == null) throw httpError(400, 'pass text or insightId');
    return confReview(source);
  },

  async 'brand-gate'({ text = '', brand = 'strait-up-growth', classification = 'public' }) {
    return { ...brandGate({ text, brand, classification }), anonymisationChecklist: ANONYMISATION_CHECKLIST };
  },

  async distill({ insightId }) {
    const ins = get('insights', insightId);
    if (!ins) throw httpError(404, 'insight not found');
    const distilled = await distillInsight(ins);
    const updated = update('insights', insightId, {
      distilled,
      confidentiality: { ...distilled.confidentiality, confirmed: ins.confidentiality?.confirmed || false },
      status: ins.status === 'captured' ? 'distilled' : ins.status,
    });
    return { insight: updated, provider: distilled.provider };
  },

  async 'draft-content'({ contentId, title, format = 'linkedin-post', insightId, pov, lanes = [], brand = 'stuart' }) {
    let item = contentId ? get('content', contentId) : null;
    const insight = insightId ? get('insights', insightId) : item?.sourceInsights?.[0] ? get('insights', item.sourceInsights[0]) : null;
    if (insight && ['private-operating-lesson', 'strictly-confidential'].includes(insight.confidentiality?.classification)) {
      throw httpError(409, `Source insight "${insight.title}" is classified ${insight.confidentiality.classification}. Run the confidentiality review and anonymise before drafting from it.`);
    }
    const result = await draftContent({
      title: title || item?.title, format: item?.format || format,
      insight, pov: pov || item?.pov, lanes: lanes.length ? lanes : item?.lanes || insight?.lanes || [], brand,
    });
    if (item) {
      const versions = [...(item.versions || []), { at: new Date().toISOString(), body: item.body, provider: item.draftProvider || 'stuart' }].filter((v) => v.body);
      item = update('content', item.id, { body: result.body, draftProvider: result.provider, stage: item.stage === 'raw-idea' || item.stage === 'qualified-idea' ? 'draft' : item.stage, versions });
    } else {
      item = insert('content', {
        title: title || insight?.title || 'Untitled', format, lanes: lanes.length ? lanes : insight?.lanes || [],
        objective: null, stage: 'draft', sourceInsights: insightId ? [insightId] : [],
        evidence: insightId ? [`insight:${insightId}`] : [], pov: pov || null,
        body: result.body, draftProvider: result.provider, brand: `brand-${brand === 'strait-up-growth' ? 'sug' : brand}`,
        confidentiality: insight?.confidentiality?.classification || 'public',
        audiences: [], performance: null, versions: [],
      });
      if (insight && insight.status !== 'routed') update('insights', insight.id, { status: 'routed' });
    }
    return { content: item, lint: result.lint, provider: result.provider, note: result.note };
  },

  // Repurpose an existing piece for a different channel. The idea travels;
  // the expression is rebuilt per CHANNEL_SPECS — never a verbatim copy.
  async repurpose({ contentId, format }) {
    const src = get('content', contentId);
    if (!src) throw httpError(404, 'content not found');
    if (!format) throw httpError(400, 'pass a target format');
    if (format === src.format) throw httpError(400, 'target format is the same as the source; repurposing must change the shape');
    if (['private-operating-lesson', 'strictly-confidential'].includes(src.confidentiality)) {
      throw httpError(409, `Source is classified ${src.confidentiality}; resolve confidentiality before repurposing.`);
    }
    const insight = src.sourceInsights?.[0] ? get('insights', src.sourceInsights[0]) : null;
    const result = await draftContent({
      title: src.title, format, insight, pov: src.pov,
      lanes: src.lanes || [], brand: 'stuart', sourceBody: src.body || '',
    });
    const item = insert('content', {
      title: src.title, format, lanes: src.lanes || [], objective: src.objective,
      stage: 'draft', sourceInsights: src.sourceInsights || [], repurposedFrom: contentId,
      evidence: src.evidence || [], pov: src.pov || null, body: result.body,
      draftProvider: result.provider, brand: src.brand, confidentiality: src.confidentiality || 'public',
      audiences: src.audiences || [], performance: null, versions: [],
    });
    return { content: item, lint: result.lint, provider: result.provider, note: result.note };
  },

  async 'score-content'({ contentId }) {
    const item = get('content', contentId);
    if (!item) throw httpError(404, 'content not found');
    const lintResult = lint(item.body || '', { brand: 'stuart', kind: 'post' });
    const score = scoreContent(item, { lintResult });
    return { content: update('content', contentId, { score }), lint: lintResult };
  },

  async 'draft-outreach'({ outreachId, contactId, purpose, trigger, valueToRecipient, evidence = [], channel }) {
    let record = outreachId ? get('outreach', outreachId) : null;
    const contact = contactGuard(record?.contactId || contactId);
    const result = await draftOutreach({
      contact, purpose: record?.purpose || purpose, trigger: record?.trigger || trigger,
      valueToRecipient: record?.valueToRecipient || valueToRecipient,
      evidence: record?.evidence?.length ? record.evidence : evidence,
      channel: record?.channel || channel || 'linkedin-dm',
    });
    if (record) {
      record = update('outreach', record.id, { message: result.body, draftProvider: result.provider, stage: ['identified', 'researched', 'qualified'].includes(record.stage) ? 'drafted' : record.stage });
    } else {
      record = insert('outreach', {
        contactId: contact.id, purpose, trigger: trigger || null, valueToRecipient: valueToRecipient || null,
        evidence, channel: channel || 'linkedin-dm', message: result.body, draftProvider: result.provider,
        stage: 'drafted', approval: { status: 'pending' }, sentAt: null, reply: null, followUpDate: null,
        lanes: contact.lanes || [], brand: 'brand-sug',
      });
    }
    const strength = relationshipStrength(contact, items('interactions'));
    const score = scoreOutreach(record, { contact, strength, lintResult: result.lint });
    record = update('outreach', record.id, { score });
    return { outreach: record, lint: result.lint, provider: result.provider, note: result.note };
  },

  async 'score-outreach'({ outreachId }) {
    const record = get('outreach', outreachId);
    if (!record) throw httpError(404, 'outreach not found');
    const contact = get('contacts', record.contactId);
    const strength = contact ? relationshipStrength(contact, items('interactions')) : null;
    const lintResult = lint(record.message || '', { brand: 'strait-up-growth', kind: 'outreach' });
    const score = scoreOutreach(record, { contact, strength, lintResult });
    return { outreach: update('outreach', outreachId, { score }), lint: lintResult };
  },

  // Approval gates. Only a human hits these endpoints; the response records who.
  async approve({ type, id, approvedBy = 'stuart' }) {
    if (type === 'outreach') {
      const record = get('outreach', id);
      if (!record) throw httpError(404, 'outreach not found');
      contactGuard(record.contactId);
      if (!record.message) throw httpError(409, 'No message drafted; nothing to approve.');
      if (record.score?.hardStops?.length) throw httpError(409, `Hard stop: ${record.score.hardStops[0]}`);
      return { outreach: update('outreach', id, { stage: 'approved', approval: { status: 'approved', approvedBy, approvedAt: new Date().toISOString() } }) };
    }
    if (type === 'content') {
      const item = get('content', id);
      if (!item) throw httpError(404, 'content not found');
      const gate = brandGate({ text: item.body || '', brand: item.brand === 'brand-sug' ? 'strait-up-growth' : 'stuart', classification: item.confidentiality || 'public' });
      return { content: update('content', id, { stage: 'approved', approval: { status: 'approved', approvedBy, approvedAt: new Date().toISOString() } }), brandGate: gate };
    }
    throw httpError(400, 'type must be outreach or content');
  },

  async reject({ type, id, reason = '' }) {
    const coll = type === 'outreach' ? 'outreach' : 'content';
    const record = get(coll, id);
    if (!record) throw httpError(404, `${type} not found`);
    const patch = type === 'outreach'
      ? { stage: 'qualified', approval: { status: 'rejected', reason } }
      : { stage: 'draft', approval: { status: 'rejected', reason } };
    return { [type]: update(coll, id, patch) };
  },

  // Stuart sent it himself (LinkedIn/email/WhatsApp); record the fact.
  async 'mark-sent'({ outreachId, sentAt }) {
    const record = get('outreach', outreachId);
    if (!record) throw httpError(404, 'outreach not found');
    if (record.approval?.status !== 'approved') throw httpError(409, 'Cannot record a send for an unapproved message. Approve it first (the system itself never sends).');
    contactGuard(record.contactId);
    const updated = update('outreach', outreachId, { stage: 'sent', sentAt: sentAt || new Date().toISOString() });
    insert('interactions', { contactId: record.contactId, kind: 'message', direction: 'outbound', note: `Outreach sent (${record.purpose}): ${record.id}`, date: updated.sentAt });
    const followUp = insert('tasks', {
      title: `Follow up on outreach to ${get('contacts', record.contactId)?.name || record.contactId}`,
      due: new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 10),
      kind: 'follow-up', relatedType: 'outreach', relatedId: outreachId, status: 'open', deferredCount: 0,
    });
    return { outreach: updated, followUpTask: followUp };
  },

  async 'record-reply'({ outreachId, text, sentiment = 'neutral', createOpportunity = false }) {
    const record = get('outreach', outreachId);
    if (!record) throw httpError(404, 'outreach not found');
    let updated = update('outreach', outreachId, {
      stage: sentiment === 'positive' ? 'conversation' : 'replied',
      reply: { text, sentiment, date: new Date().toISOString() },
    });
    insert('interactions', { contactId: record.contactId, kind: 'reply', direction: 'inbound', note: `Reply to ${outreachId}: ${String(text).slice(0, 140)}`, date: new Date().toISOString() });
    let opportunity = null;
    if (createOpportunity) {
      const contact = get('contacts', record.contactId);
      opportunity = insert('opportunities', {
        name: `${contact?.company || contact?.name || 'New'} conversation`, type: 'client',
        contactIds: [record.contactId], companyId: contact?.companyId || null,
        source: 'outreach', contentInfluence: 'no-proven-influence', stage: 'conversation',
        estimatedValue: null, probability: 0.2, nextAction: 'Qualify the conversation', nextActionDate: new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10),
        lastActivityAt: new Date().toISOString(), relatedOutreach: [outreachId], relatedContent: [], lanes: record.lanes || [],
        evidence: `Positive reply to ${outreachId}: "${String(text).slice(0, 120)}"`,
        note: 'Value and probability are Stuart\'s to set; the engine never invents pipeline numbers.',
      });
      updated = update('outreach', outreachId, { stage: 'opportunity' });
    }
    return { outreach: updated, opportunity };
  },

  // Stuart published it himself; record the fact.
  async 'mark-published'({ contentId, channel = 'linkedin', url = null, publishedDate }) {
    const item = get('content', contentId);
    if (!item) throw httpError(404, 'content not found');
    if (item.approval?.status !== 'approved' && item.stage !== 'approved' && item.stage !== 'scheduled') {
      throw httpError(409, 'Cannot record publication for unapproved content. Approve it first (the system itself never publishes).');
    }
    return { content: update('content', contentId, { stage: 'published', channel, url, publishedDate: publishedDate || new Date().toISOString().slice(0, 10) }) };
  },

  async 'log-performance'({ contentId, impressions, comments, conversationsCreated, opportunitiesInfluenced }) {
    const item = get('content', contentId);
    if (!item) throw httpError(404, 'content not found');
    const perf = { ...(item.performance || {}) };
    if (impressions != null) perf.impressions = impressions;
    if (comments != null) perf.comments = comments;
    if (conversationsCreated) perf.conversationsCreated = conversationsCreated;
    if (opportunitiesInfluenced) perf.opportunitiesInfluenced = opportunitiesInfluenced;
    return { content: update('content', contentId, { performance: perf }) };
  },

  async 'complete-task'({ taskId, verb = 'done', snoozeDays = 2 }) {
    const task = get('tasks', taskId);
    if (!task) throw httpError(404, 'task not found');
    if (verb === 'done') return { task: update('tasks', taskId, { status: 'done', completedAt: new Date().toISOString() }) };
    if (verb === 'snooze') return { task: update('tasks', taskId, { due: new Date(Date.now() + snoozeDays * 86400000).toISOString().slice(0, 10), deferredCount: (task.deferredCount || 0) + 1 }) };
    if (verb === 'skip') return { task: update('tasks', taskId, { status: 'skipped' }) };
    throw httpError(400, 'verb must be done, snooze or skip');
  },

  // Lead workflow: research happens outside; the engine records decisions.
  // Converting creates ONLY what the evidence supports (a name + the quote);
  // no invented titles, emails or details.
  async 'convert-lead'({ leadId }) {
    const lead = get('leads', leadId);
    if (!lead) throw httpError(404, 'lead not found');
    if (lead.status === 'converted') throw httpError(409, 'already converted');
    let companyId = lead.linkedCompanyId, contactId = lead.linkedContactId;
    if (!companyId && !contactId) {
      if (lead.kind === 'person') {
        const contact = insert('contacts', {
          name: lead.name, role: null, company: null, companyId: null,
          relationshipType: 'prospect', lanes: [],
          howKnown: `Detected as a lead (${lead.signal}): ${(lead.evidence?.[0]?.quote || '').slice(0, 140)}`,
          email: null, linkedin: null, permissionStatus: 'legitimate-contact', doNotContact: false,
          notes: [], nextAction: 'Verify identity and find the real context before any outreach', followUpDate: null,
        });
        contactId = contact.id;
      } else {
        const company = insert('companies', {
          name: lead.name, location: null, industry: null,
          note: `Prospect from lead detection (${lead.signal}): ${(lead.evidence?.[0]?.quote || '').slice(0, 140)}`,
        });
        companyId = company.id;
      }
    }
    const task = insert('tasks', {
      title: `Research ${lead.name}: verify the ${lead.signal} signal, find the named decision-maker`,
      due: new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10),
      kind: 'follow-up', relatedType: 'leads', relatedId: leadId, status: 'open', deferredCount: 0,
    });
    const updated = update('leads', leadId, { status: 'converted', linkedCompanyId: companyId || null, linkedContactId: contactId || null, convertedAt: new Date().toISOString() });
    return { lead: updated, companyId, contactId, task, note: 'Created a skeleton record from the evidence only. Research fills in the rest; nothing was invented.' };
  },

  async 'dismiss-lead'({ leadId, reason = '' }) {
    const lead = get('leads', leadId);
    if (!lead) throw httpError(404, 'lead not found');
    return { lead: update('leads', leadId, { status: 'dismissed', dismissReason: reason }) };
  },

  async 'weekly-review'() {
    const body = await weeklyReviewDraft({ briefing: todayBriefing({ limit: 20 }), analytics: analytics() });
    const review = insert('reviews', { kind: 'weekly', period: body.weekOf, body, status: 'draft' });
    return { review };
  },

  async 'extract-voice-rule'({ original, edited, note = '' }) {
    // Compare an AI draft with Stuart's edit and propose a durable rule.
    if (!original || !edited) throw httpError(400, 'pass original and edited');
    const proposals = [];
    if (original.length > edited.length * 1.3) proposals.push('Stuart cut this draft heavily. Default to shorter.');
    if (/—/.test(original) && !/—/.test(edited)) proposals.push('Stuart removed em dashes (already a hard rule; the draft should never have had them).');
    const origHas = (re) => re.test(original) && !re.test(edited);
    if (origHas(/\b(delighted|thrilled|excited to)\b/i)) proposals.push('Stuart strips enthusiasm words (delighted/thrilled/excited). State the fact instead.');
    if (origHas(/!\s*$/m)) proposals.push('Stuart removes exclamation marks.');
    if (!proposals.length) proposals.push(`No mechanical pattern detected. Note kept for review: ${note || '(none)'}`);
    const voice = read('voice');
    const pending = proposals.map((text, i) => ({ id: `vr-p${Date.now()}-${i}`, status: 'proposed', source: 'edit-comparison', text, note, original: original.slice(0, 400), edited: edited.slice(0, 400) }));
    voice.pendingExtractions = [...(voice.pendingExtractions || []), ...pending];
    write('voice', voice);
    audit({ actor: 'engine', action: 'voice-extraction', collection: 'voice', id: pending[0].id, summary: `${pending.length} proposed rule(s)` });
    return { proposed: pending, note: 'Proposed rules are inactive until Stuart approves them (move status to approved in the voice library).' };
  },

  async 'approve-voice-rule'({ ruleId }) {
    const voice = read('voice');
    const pending = (voice.pendingExtractions || []).find((r) => r.id === ruleId);
    if (!pending) throw httpError(404, 'proposed rule not found');
    voice.rules = [...(voice.rules || []), { ...pending, status: 'approved', approvedAt: new Date().toISOString() }];
    voice.pendingExtractions = voice.pendingExtractions.filter((r) => r.id !== ruleId);
    write('voice', voice);
    audit({ actor: 'stuart', action: 'approve-voice-rule', collection: 'voice', id: ruleId, summary: pending.text.slice(0, 80) });
    return { rule: pending };
  },
};

// ---------------------------------------------------------------------------
// HTTP routing.
// ---------------------------------------------------------------------------
async function handle(req, res) {
  const url = new URL(req.url, 'http://x');
  const p = url.pathname;
  try {
    if (p === '/api/state' && req.method === 'GET') {
      const { state } = await import('../lib/store.mjs');
      return json(res, 200, { ...state(), provider: providerName(), voiceDoc: read('voice') });
    }
    if (p === '/api/today' && req.method === 'GET') return json(res, 200, todayBriefing({ limit: Number(url.searchParams.get('limit')) || 7 }));
    if (p === '/api/analytics' && req.method === 'GET') return json(res, 200, analytics());
    if (p === '/api/authority' && req.method === 'GET') return json(res, 200, authorityScore());
    if (p === '/api/audit' && req.method === 'GET') return json(res, 200, { items: (read('audit').items || []).slice(-200).reverse() });

    const actionMatch = p.match(/^\/api\/actions\/([a-z-]+)$/);
    if (actionMatch && req.method === 'POST') {
      const name = actionMatch[1];
      if (!actions[name]) return json(res, 404, { error: `unknown action ${name}` });
      const body = await readBody(req);
      return json(res, 200, await actions[name](body));
    }

    const collMatch = p.match(/^\/api\/collections\/([a-z]+)(?:\/([\w-]+))?$/);
    if (collMatch) {
      const [, name, id] = collMatch;
      if (!COLLECTIONS.includes(name) || name === 'audit') return json(res, 404, { error: `unknown collection ${name}` });
      if (req.method === 'GET' && !id) return json(res, 200, { items: items(name) });
      if (req.method === 'GET' && id) {
        const item = get(name, id);
        return item ? json(res, 200, item) : json(res, 404, { error: 'not found' });
      }
      if (req.method === 'POST' && !id) {
        const body = await readBody(req);
        for (const f of GUARDED_FIELDS[name] || []) {
          if (f in body && !(f === 'stage' && (name === 'outreach' ? OUTREACH_STAGE_VIA_PATCH_OK : CONTENT_STAGE_VIA_PATCH_OK).includes(body.stage))) {
            return json(res, 409, { error: `"${f}" cannot be set directly on ${name}; use the action endpoints (approval is required before send/publish).` });
          }
        }
        return json(res, 201, insert(name, body));
      }
      if (req.method === 'PATCH' && id) {
        const body = await readBody(req);
        for (const f of GUARDED_FIELDS[name] || []) {
          if (f in body && !(f === 'stage' && (name === 'outreach' ? OUTREACH_STAGE_VIA_PATCH_OK : CONTENT_STAGE_VIA_PATCH_OK).includes(body.stage))) {
            return json(res, 409, { error: `"${f}" cannot be patched on ${name}; use the action endpoints (approve / mark-sent / mark-published).` });
          }
        }
        return json(res, 200, update(name, id, body));
      }
      if (req.method === 'DELETE' && id) return json(res, 200, softDelete(name, id));
    }

    // Settings and voice are documents, not item collections.
    if (p === '/api/settings' && req.method === 'PATCH') {
      const body = await readBody(req);
      const doc = read('settings');
      doc.values = { ...doc.values, ...body };
      write('settings', doc);
      audit({ actor: 'stuart', action: 'update', collection: 'settings', id: 'settings', summary: Object.keys(body).join(',') });
      return json(res, 200, doc);
    }

    // Static app.
    if (req.method === 'GET') {
      const rel = p === '/' ? 'index.html' : p.slice(1);
      const f = path.join(APP, path.normalize(rel));
      if (f.startsWith(APP) && fs.existsSync(f) && fs.statSync(f).isFile()) {
        res.writeHead(200, { 'content-type': MIME[path.extname(f)] || 'application/octet-stream' });
        return res.end(fs.readFileSync(f));
      }
    }
    json(res, 404, { error: 'not found' });
  } catch (err) {
    json(res, err.code && Number.isInteger(err.code) ? err.code : 500, { error: err.message });
  }
}

export function start({ port = 4173 } = {}) {
  const server = http.createServer(handle);
  return new Promise((resolve) => {
    server.listen(port, '127.0.0.1', () => resolve(server));
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const portArg = process.argv.indexOf('--port');
  const port = portArg > -1 ? Number(process.argv[portArg + 1]) : 4173;
  const server = await start({ port });
  const addr = server.address();
  console.log(`Stuart Crowley — personal brand engine  http://localhost:${addr.port}`);
  console.log(`AI provider: ${providerName()}${providerName() === 'mock' ? ' (set ANTHROPIC_API_KEY for live drafting)' : ''}`);
}
