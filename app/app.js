// Strait Up Growth engine — command centre.
// Vanilla JS, hash routing, no dependencies. All writes go through the
// server API, which enforces the approval and suppression gates.

const $ = (sel, root = document) => root.querySelector(sel);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtMoney = (n, cur = 'SGD') => n == null ? '—' : `${cur} ${Number(n).toLocaleString('en-GB')}`;
const fmtDate = (d) => d ? String(d).slice(0, 10) : '—';
const daysAgo = (d) => d ? Math.round((Date.now() - new Date(d).getTime()) / 86400000) : null;

let S = null;        // /api/state cache
let TODAY = null;    // /api/today cache
let ANALYTICS = null;

async function api(path, opts = {}) {
  const res = await fetch(`/api${path}`, {
    method: opts.method || 'GET',
    headers: { 'content-type': 'application/json' },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `${res.status}`);
  return data;
}
const act = (name, body = {}) => api(`/actions/${name}`, { method: 'POST', body });

function toast(msg, isErr = false) {
  const t = $('#toast');
  t.textContent = msg; t.className = `toast${isErr ? ' err' : ''}`; t.hidden = false;
  clearTimeout(t._h); t._h = setTimeout(() => { t.hidden = true; }, isErr ? 5200 : 2600);
}

async function refresh() {
  [S, TODAY, ANALYTICS] = await Promise.all([api('/state'), api('/today?limit=7'), api('/analytics')]);
  document.documentElement.style.setProperty('--accent', S.settings.values?.accentColor || '#B34700');
  $('#provider-badge').textContent = `ai: ${S.provider}`;
  $('#demo-banner').hidden = !S.settings.values?.demoMode;
  renderNav();
}

const byId = (coll, id) => (S[coll] || []).find((x) => x.id === id);
const laneNames = () => (S.lanes || []).map((l) => l.name);
const contactName = (id) => byId('contacts', id)?.name || id || '—';

// ---------------------------------------------------------------------------
// Router + nav
// ---------------------------------------------------------------------------
const VIEWS = [
  ['today', 'Today'], ['insights', 'Insights'], ['content', 'Content'],
  ['calendar', 'Calendar'], ['relationships', 'Relationships'], ['outreach', 'Outreach'],
  ['opportunities', 'Opportunities'], ['offers', 'Offers'], ['analytics', 'Analytics'],
  ['reviews', 'Reviews'], ['knowledge', 'Knowledge'], ['settings', 'Settings'],
];

function renderNav() {
  const counts = TODAY?.counts || {};
  const badges = {
    today: TODAY?.actions?.length, insights: counts.unprocessedInsights,
    content: counts.contentInReview, outreach: (counts.outreachAwaitingApproval || 0) + (counts.approvedUnsent || 0),
  };
  const cur = location.hash.replace(/^#\/?/, '') || 'today';
  $('#nav').innerHTML = VIEWS.map(([id, label]) =>
    `<a href="#/${id}" class="${cur.startsWith(id) ? 'active' : ''}">${label}${badges[id] ? `<span class="count">${badges[id]}</span>` : ''}</a>`
  ).join('');
}

const routes = {};
async function render() {
  const cur = location.hash.replace(/^#\/?/, '') || 'today';
  const [view] = cur.split('/');
  renderNav();
  closePanel();
  const fn = routes[view] || routes.today;
  $('#main').innerHTML = '<div class="loading">Loading…</div>';
  try { await fn(); } catch (e) { $('#main').innerHTML = `<div class="card">Error: ${esc(e.message)}</div>`; }
}
window.addEventListener('hashchange', render);

// ---------------------------------------------------------------------------
// Panel (right-hand detail)
// ---------------------------------------------------------------------------
function openPanel(html) {
  const p = $('#panel');
  p.innerHTML = `<button class="btn btn-sm close" onclick="document.getElementById('panel').hidden=true">Close ✕</button>${html}`;
  p.hidden = false; p.scrollTop = 0;
}
function closePanel() { $('#panel').hidden = true; }

const kv = (pairs) => `<dl class="kv">${pairs.filter(([, v]) => v !== undefined).map(([k, v]) => `<dt>${esc(k)}</dt><dd>${v ?? '—'}</dd>`).join('')}</dl>`;
const fictionBadge = (item) => item.fictional ? '<span class="badge fiction">fictional demo</span>' : '';
const banded = (band) => ({ strong: 'good', warm: 'accent', thin: 'warn', cold: '' }[band] || '');
const meter = (val, max) => `<span class="meter"><span class="bar"><i style="width:${Math.round((val / max) * 100)}%"></i></span><span class="val">${val}/${max}</span></span>`;

// ---------------------------------------------------------------------------
// TODAY
// ---------------------------------------------------------------------------
routes.today = async () => {
  TODAY = await api('/today?limit=7');
  const c = TODAY.counts;
  const actionsHtml = TODAY.actions.map((a, i) => `
    <div class="card flag action">
      <div class="prio">#${i + 1}</div>
      <div>
        <div class="a-title">${esc(a.title)}</div>
        <div class="a-why">${esc(a.why)} <em>${esc(a.whyNow)}</em></div>
        <div class="a-next">Next: <b>${esc(a.nextStep)}</b></div>
        <div class="a-meta">expected value: ${esc(a.expectedValue)} · confidence: ${esc(a.confidence)} ${a.relatedId ? `· <a href="#" data-open="${esc(a.relatedType)}:${esc(a.relatedId)}">open record</a>` : ''}</div>
      </div>
      <div class="btn-row" style="margin:0">
        ${a.taskId ? `<button class="btn btn-sm" data-task-done="${a.taskId}">Done</button><button class="btn btn-sm btn-quiet" data-task-snooze="${a.taskId}">Snooze</button>` : ''}
      </div>
    </div>`).join('');

  $('#main').innerHTML = `
    <div class="view-head"><div><h1>Today</h1>
    <div class="h-sub">${new Date().toDateString()} · the few actions that matter most, each with its reasons</div></div>
    <div class="spacer"></div>
    <button class="btn btn-accent" id="btn-focus">Focus mode</button></div>
    <div class="tiles">
      ${tile('Follow-ups due', c.followUpsDue)}${tile('Content in review', c.contentInReview)}
      ${tile('Drafts to approve', c.outreachAwaitingApproval)}${tile('Approved, unsent', c.approvedUnsent)}
      ${tile('Open opportunities', c.openOpportunities)}${tile('Unprocessed insights', c.unprocessedInsights)}
    </div>
    ${actionsHtml || '<div class="card">Nothing urgent. Capture an insight or work the calendar.</div>'}
    ${TODAY.stopDoing ? `<div class="card stop-card"><strong>Stop doing:</strong> ${esc(TODAY.stopDoing.title)}<div class="small">${esc(TODAY.stopDoing.why)}</div></div>` : ''}
    <p class="caveat">Recommendations are derived from the records in this engine and nothing else. They are suggestions, not verdicts.</p>`;

  $('#btn-focus').onclick = focusMode;
  wireCommon($('#main'));
};

const tile = (label, value, note = '') => `<div class="tile"><div class="t-label">${esc(label)}</div><div class="t-value">${value ?? '—'}</div>${note ? `<div class="t-note">${esc(note)}</div>` : ''}</div>`;

function wireCommon(root) {
  root.querySelectorAll('[data-open]').forEach((el) => el.addEventListener('click', (e) => {
    e.preventDefault();
    const [type, id] = el.dataset.open.split(':');
    openRecord(type, id);
  }));
  root.querySelectorAll('[data-task-done]').forEach((el) => el.onclick = async () => {
    await act('complete-task', { taskId: el.dataset.taskDone, verb: 'done' });
    toast('Marked done'); await refresh(); render();
  });
  root.querySelectorAll('[data-task-snooze]').forEach((el) => el.onclick = async () => {
    await act('complete-task', { taskId: el.dataset.taskSnooze, verb: 'snooze' });
    toast('Snoozed 2 days'); await refresh(); render();
  });
}

function openRecord(type, id) {
  const map = { insights: panelInsight, content: panelContent, contacts: panelContact, outreach: panelOutreach, opportunities: panelOpportunity, offers: panelOffer, engagements: panelEngagement, tasks: null };
  const fn = map[type];
  if (fn) fn(id); else toast(`No detail view for ${type}`);
}

// ---------- Focus mode ----------
function focusMode() {
  const queue = [...TODAY.allActions];
  let idx = 0, handled = 0;
  const overlay = $('#overlay');
  const show = () => {
    if (idx >= queue.length) {
      overlay.innerHTML = `<div class="sheet"><h2>Done for now</h2>
        <p>${handled} action(s) handled, ${queue.length - handled} skipped or snoozed.</p>
        <p class="small">End-of-day habit: log any posts, replies and metrics so tomorrow's briefing is honest.</p>
        <div class="btn-row"><button class="btn btn-accent" id="f-close">Close</button></div></div>`;
      $('#f-close').onclick = closeFocus; return;
    }
    const a = queue[idx];
    overlay.innerHTML = `<div class="sheet">
      <div class="focus-count">Focus · ${idx + 1} of ${queue.length}</div>
      <h2>${esc(a.title)}</h2>
      <p>${esc(a.why)}</p><p class="small"><em>${esc(a.whyNow)}</em></p>
      <p>Next: <strong>${esc(a.nextStep)}</strong></p>
      <p class="small">expected value: ${esc(a.expectedValue)} · confidence: ${esc(a.confidence)}</p>
      <div class="btn-row">
        <button class="btn btn-accent" id="f-done">Done</button>
        <button class="btn" id="f-skip">Skip</button>
        ${a.taskId ? '<button class="btn btn-quiet" id="f-snooze">Snooze 2d</button>' : ''}
        ${a.relatedId ? `<button class="btn btn-quiet" id="f-open">Open record</button>` : ''}
        <button class="btn btn-quiet" id="f-exit">Exit</button>
      </div></div>`;
    $('#f-done').onclick = async () => { if (a.taskId) await act('complete-task', { taskId: a.taskId, verb: 'done' }).catch(() => {}); handled++; idx++; show(); };
    $('#f-skip').onclick = () => { idx++; show(); };
    if ($('#f-snooze')) $('#f-snooze').onclick = async () => { await act('complete-task', { taskId: a.taskId, verb: 'snooze' }).catch(() => {}); idx++; show(); };
    if ($('#f-open')) $('#f-open').onclick = () => { closeFocus(); openRecord(a.relatedType, a.relatedId); };
    $('#f-exit').onclick = closeFocus;
  };
  const closeFocus = async () => { overlay.hidden = true; await refresh(); render(); };
  overlay.hidden = false; show();
}

// ---------------------------------------------------------------------------
// INSIGHTS
// ---------------------------------------------------------------------------
routes.insights = async () => {
  const rows = [...S.insights].sort((a, b) => (a.date < b.date ? 1 : -1));
  $('#main').innerHTML = `
    <div class="view-head"><div><h1>Insights</h1><div class="h-sub">raw commercial material: capture, classify, distil, route. Press <kbd>c</kbd> to capture.</div></div></div>
    <div class="table-wrap"><table><thead><tr><th>Date</th><th>Insight</th><th>Type</th><th>Lanes</th><th class="num">Relevance</th><th>Confidentiality</th><th>Status</th></tr></thead>
    <tbody>${rows.map((i) => `<tr class="rowlink" data-open="insights:${i.id}">
      <td>${fmtDate(i.date)}</td>
      <td><strong>${esc(i.title)}</strong> ${fictionBadge(i)}</td>
      <td>${esc(i.type)}</td><td class="small">${(i.lanes || []).map(esc).join('<br>')}</td>
      <td class="num">${i.commercialRelevance ?? '—'}/5</td>
      <td><span class="badge ${i.confidentiality?.classification === 'public' ? 'good' : i.confidentiality?.classification === 'strictly-confidential' ? 'bad' : 'warn'}">${esc(i.confidentiality?.classification || 'unreviewed')}${i.confidentiality?.confirmed ? '' : ' (suggested)'}</span></td>
      <td>${esc(i.status)}</td></tr>`).join('')}</tbody></table></div>`;
  wireCommon($('#main'));
};

function panelInsight(id) {
  const i = byId('insights', id);
  if (!i) return;
  const d = i.distilled;
  openPanel(`
    <h2>${esc(i.title)} ${fictionBadge(i)}</h2>
    ${kv([['Date', fmtDate(i.date)], ['Type', esc(i.type)], ['Source', esc(i.source)], ['Lanes', (i.lanes || []).map(esc).join(', ')], ['Status', esc(i.status)], ['Relevance', `${i.commercialRelevance ?? '—'}/5`]])}
    <div class="section-t">Raw note (lossless)</div>
    <pre class="msg">${esc(i.raw)}</pre>
    <div class="section-t">Confidentiality — ${esc(i.confidentiality?.classification || 'unreviewed')} ${i.confidentiality?.confirmed ? '<span class="badge good">confirmed by Stuart</span>' : '<span class="badge warn">suggestion, unconfirmed</span>'}</div>
    <ul class="plain">${(i.confidentiality?.reasons || []).map((r) => `<li>${esc(r)}</li>`).join('')}</ul>
    <div class="btn-row">${['public', 'public-after-anonymisation', 'private-operating-lesson', 'strictly-confidential'].map((c) =>
      `<button class="btn btn-sm ${i.confidentiality?.classification === c && i.confidentiality?.confirmed ? 'btn-accent' : 'btn-quiet'}" data-conf="${c}">${c}</button>`).join('')}</div>
    ${d ? `
      <div class="section-t">Distillation <span class="badge">${esc(d.provider)}</span></div>
      ${kv([['Core insight', esc(d.coreInsight)], ['Strongest claim', esc(d.strongestClaim)], ['Public-safe version', esc(d.publicSafeVersion)], ['Outreach angle', esc(d.outreachAngle)], ['Speaking angle', esc(d.speakingAngle)], ['Commercial angle', esc(d.commercialAngle)]])}
      <div class="section-t">Content angles</div>
      <ul class="plain">${(d.contentAngles || []).map((a) => `<li><strong>${esc(a.format)}</strong>: ${esc(a.angle)}</li>`).join('')}</ul>
      ${d.note ? `<p class="small"><em>${esc(d.note)}</em></p>` : ''}` : ''}
    <div class="btn-row">
      <button class="btn btn-accent" id="p-distill">${d ? 'Re-distil' : 'Distil'}</button>
      <button class="btn" id="p-mkcontent">Create content draft</button>
    </div>
    <p class="small">Drafting from a private/confidential insight is blocked until it is reclassified or anonymised.</p>`);
  $('#panel').querySelectorAll('[data-conf]').forEach((b) => b.onclick = async () => {
    await act('confidentiality', { insightId: id, confirm: b.dataset.conf });
    toast(`Classified: ${b.dataset.conf}`); await refresh(); panelInsight(id);
  });
  $('#p-distill').onclick = async () => {
    toast('Distilling…');
    const r = await act('distill', { insightId: id });
    toast(`Distilled (${r.provider})`); await refresh(); panelInsight(id);
  };
  $('#p-mkcontent').onclick = async () => {
    try {
      const r = await act('draft-content', { insightId: id, format: 'linkedin-post' });
      toast(`Draft created (${r.provider})`); await refresh(); panelContent(r.content.id);
    } catch (e) { toast(e.message, true); }
  };
}

// ---------------------------------------------------------------------------
// CONTENT
// ---------------------------------------------------------------------------
const CONTENT_STAGES = ['raw-idea', 'qualified-idea', 'outline', 'draft', 'review', 'approved', 'scheduled', 'published', 'repurposed', 'archived'];
routes.content = async () => {
  const cols = CONTENT_STAGES.filter((s) => !['outline', 'scheduled', 'repurposed', 'archived'].includes(s) || S.content.some((c) => c.stage === s));
  $('#main').innerHTML = `
    <div class="view-head"><div><h1>Content</h1><div class="h-sub">idea to published, with the voice linter and the 12-criterion scorecard on the way through</div></div></div>
    <div class="board">${cols.map((stage) => {
      const items = S.content.filter((c) => c.stage === stage);
      return `<div class="col"><div class="col-h"><span>${esc(stage)}</span><span>${items.length}</span></div>
        ${items.map((c) => `<div class="item" data-open="content:${c.id}">
          <div class="i-t">${esc(c.title)}</div>
          <div class="i-m">${esc(c.format)} · ${(c.lanes || [])[0] ? esc(c.lanes[0]) : 'no lane'}${c.score ? ` · ${c.score.total}/60` : ''}${c.fictional ? ' · fictional' : ''}</div>
        </div>`).join('')}</div>`;
    }).join('')}</div>`;
  wireCommon($('#main'));
};

function panelContent(id) {
  const c = byId('content', id);
  if (!c) return;
  const s = c.score;
  openPanel(`
    <h2>${esc(c.title)} ${fictionBadge(c)}</h2>
    ${kv([['Stage', `<span class="badge accent">${esc(c.stage)}</span>`], ['Format', esc(c.format)], ['Lanes', (c.lanes || []).map(esc).join(', ')], ['Objective', esc(c.objective)], ['Brand', esc(c.brand)], ['Confidentiality', esc(c.confidentiality)], ['Published', fmtDate(c.publishedDate)]])}
    ${(c.sourceInsights || []).length ? `<div class="section-t">Source insights (provenance)</div><ul class="plain">${c.sourceInsights.map((sid) => `<li><a href="#" data-open="insights:${sid}">${esc(byId('insights', sid)?.title || sid)}</a></li>`).join('')}</ul>` : '<p class="small">No source insight linked; treat claims as unsupported until sourced.</p>'}
    <div class="section-t">Body</div>
    <textarea id="p-body">${esc(c.body || '')}</textarea>
    <div class="btn-row">
      <button class="btn" id="p-save">Save body</button>
      <button class="btn" id="p-lint">Lint voice</button>
      <button class="btn" id="p-score">Score</button>
      <button class="btn" id="p-redraft">AI draft</button>
    </div>
    <div id="p-lintout"></div>
    ${s ? `<div class="section-t">Scorecard — ${s.total}/${s.max} · <strong>${esc(s.recommendation)}</strong> <span class="badge">suggestion</span></div>
      <p class="small">${esc(s.recommendationText)}</p>
      <table><tbody>${Object.entries(s.criteria).map(([k, v]) => `<tr><td>${esc(k)}</td><td style="width:40%">${meter(v, 5)}</td><td class="small">${esc(s.notes?.[k] || '')}</td></tr>`).join('')}</tbody></table>` : ''}
    <div class="section-t">Workflow</div>
    <div class="btn-row">
      ${['draft', 'review'].includes(c.stage) ? `<button class="btn btn-accent" id="p-approve">Approve</button><button class="btn btn-quiet" id="p-reject">Reject to draft</button>` : ''}
      ${c.stage === 'draft' ? `<button class="btn" id="p-toreview">Send to review</button>` : ''}
      ${['approved', 'scheduled'].includes(c.stage) ? `<button class="btn btn-accent" id="p-published">Mark published (I posted it)</button>` : ''}
      ${c.stage === 'published' ? `<button class="btn" id="p-perf">Log performance</button>` : ''}
    </div>
    ${c.stage === 'published' && c.performance ? `<div class="small">impressions ${c.performance.impressions ?? '—'} · comments ${c.performance.comments ?? '—'} · conversations ${(c.performance.conversationsCreated || []).length} · opportunities ${(c.performance.opportunitiesInfluenced || []).length}</div>` : ''}
    ${(c.versions || []).length ? `<div class="section-t">Previous versions</div><ul class="plain">${c.versions.map((v) => `<li>${fmtDate(v.at)} · ${esc(v.provider)} · ${esc((v.body || '').slice(0, 90))}…</li>`).join('')}</ul>` : ''}
    <p class="small">The engine never publishes. Stuart posts manually, then records it here.</p>`);
  wireCommon($('#panel'));
  $('#p-save').onclick = async () => { await api(`/collections/content/${id}`, { method: 'PATCH', body: { body: $('#p-body').value } }); toast('Saved'); await refresh(); };
  $('#p-lint').onclick = async () => {
    const r = await act('lint', { text: $('#p-body').value, brand: 'stuart', kind: 'post' });
    $('#p-lintout').innerHTML = r.ok && !r.warnings.length ? '<p class="small" style="color:var(--good)">Clean: passes the voice linter.</p>'
      : `${r.problems.map((p) => `<div class="evidence-note" style="border-color:var(--bad)"><strong>${esc(p.rule)}</strong>: ${esc(p.detail)}</div>`).join('')}${r.warnings.map((w) => `<div class="evidence-note"><strong>${esc(w.rule)}</strong>: ${esc(w.detail)}</div>`).join('')}`;
  };
  $('#p-score').onclick = async () => { await api(`/collections/content/${id}`, { method: 'PATCH', body: { body: $('#p-body').value } }); await act('score-content', { contentId: id }); toast('Scored'); await refresh(); panelContent(id); };
  $('#p-redraft').onclick = async () => { const r = await act('draft-content', { contentId: id }); toast(`Drafted (${r.provider})`); await refresh(); panelContent(id); };
  if ($('#p-toreview')) $('#p-toreview').onclick = async () => { await api(`/collections/content/${id}`, { method: 'PATCH', body: { stage: 'review' } }); toast('In review'); await refresh(); panelContent(id); };
  if ($('#p-approve')) $('#p-approve').onclick = async () => { const r = await act('approve', { type: 'content', id }); toast(r.brandGate?.flags?.length ? `Approved with flags: ${r.brandGate.flags[0]}` : 'Approved'); await refresh(); panelContent(id); };
  if ($('#p-reject')) $('#p-reject').onclick = async () => { await act('reject', { type: 'content', id, reason: 'needs work' }); toast('Back to draft'); await refresh(); panelContent(id); };
  if ($('#p-published')) $('#p-published').onclick = async () => { await act('mark-published', { contentId: id }); toast('Recorded as published'); await refresh(); panelContent(id); };
  if ($('#p-perf')) $('#p-perf').onclick = async () => {
    const impressions = Number(prompt('Impressions?', c.performance?.impressions ?? '') || 0);
    const comments = Number(prompt('Comments?', c.performance?.comments ?? '') || 0);
    await act('log-performance', { contentId: id, impressions, comments });
    toast('Performance logged'); await refresh(); panelContent(id);
  };
}

// ---------------------------------------------------------------------------
// CALENDAR
// ---------------------------------------------------------------------------
routes.calendar = async () => {
  const items = [...S.calendar].sort((a, b) => a.date < b.date ? -1 : 1);
  const weeks = {};
  for (const it of items) {
    const wk = weekKey(it.date);
    (weeks[wk] = weeks[wk] || []).push(it);
  }
  $('#main').innerHTML = `
    <div class="view-head"><div><h1>Editorial calendar</h1><div class="h-sub">balance across lanes and formats; repeats within a week are flagged</div></div></div>
    ${Object.entries(weeks).map(([wk, its]) => {
      const laneCount = {};
      its.forEach((i) => laneCount[i.lane] = (laneCount[i.lane] || 0) + 1);
      const repeats = Object.entries(laneCount).filter(([, n]) => n > 1).map(([l]) => l);
      return `<h2>Week of ${esc(wk)} ${repeats.length ? `<span class="badge bad">lane repeated: ${repeats.map(esc).join(', ')}</span>` : ''}</h2>
      <div class="table-wrap"><table><thead><tr><th>Date</th><th>Slot</th><th>Format</th><th>Lane</th><th>Objective</th><th>Status</th></tr></thead>
      <tbody>${its.map((i) => `<tr${i.contentId ? ` class="rowlink" data-open="content:${i.contentId}"` : ''}>
        <td>${fmtDate(i.date)}</td><td>${esc(i.title)}</td><td>${esc(i.format)}</td><td>${esc(i.lane)}</td><td>${esc(i.objective)}</td><td>${esc(i.status)}</td></tr>`).join('')}</tbody></table></div>`;
    }).join('')}`;
  wireCommon($('#main'));
};
function weekKey(dateStr) {
  const d = new Date(dateStr);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// RELATIONSHIPS (contacts + engagement inbox)
// ---------------------------------------------------------------------------
routes.relationships = async () => {
  const rel = ANALYTICS.relationships.rows;
  const openEng = S.engagements.filter((e) => e.status === 'open');
  $('#main').innerHTML = `
    <div class="view-head"><div><h1>Relationships</h1><div class="h-sub">evidence-based strength, never a mystery number</div></div></div>
    ${openEng.length ? `<h2>Engagement inbox (${openEng.length} open)</h2>
    <div class="table-wrap"><table><thead><tr><th>Date</th><th>Who</th><th>What</th><th>Suggested</th><th></th></tr></thead>
    <tbody>${openEng.map((e) => `<tr class="rowlink" data-open="engagements:${e.id}">
      <td>${fmtDate(e.date)}</td><td>${esc(e.personName || contactName(e.contactId))}</td>
      <td class="small">${esc(e.text)}</td><td><span class="badge accent">${esc(e.recommendation)}</span></td>
      <td>${e.contentId ? `on <a href="#" data-open="content:${e.contentId}">${esc(byId('content', e.contentId)?.title || '')}</a>` : ''}</td></tr>`).join('')}</tbody></table></div>` : ''}
    <h2>Contacts (${rel.length})</h2>
    <div class="filter-row"><input type="text" id="c-search" placeholder="Search name, company, type…"><select id="c-band"><option value="">all strengths</option><option>strong</option><option>warm</option><option>thin</option><option>cold</option></select></div>
    <div class="table-wrap"><table><thead><tr><th>Name</th><th>Company</th><th>Type</th><th>Strength</th><th>Last touch</th><th>Why</th></tr></thead>
    <tbody id="c-rows"></tbody></table></div>`;
  const drawRows = () => {
    const q = ($('#c-search').value || '').toLowerCase();
    const band = $('#c-band').value;
    $('#c-rows').innerHTML = rel
      .filter((r) => (!q || `${r.name} ${r.company} ${r.type}`.toLowerCase().includes(q)) && (!band || r.band === band))
      .map((r) => {
        const c = byId('contacts', r.id);
        return `<tr class="rowlink" data-open="contacts:${r.id}">
        <td><strong>${esc(r.name)}</strong> ${c?.doNotContact ? '<span class="badge bad">do not contact</span>' : ''} ${fictionBadge(c || {})}</td>
        <td>${esc(r.company || '—')}</td><td>${esc(r.type)}</td>
        <td><span class="badge ${banded(r.band)}">${esc(r.band)}</span> <span class="mono">${r.score}</span></td>
        <td>${r.last ? `${daysAgo(r.last)}d ago` : 'never'}</td><td class="small">${esc(r.evidence)}</td></tr>`;
      }).join('');
    wireCommon($('#c-rows'));
  };
  $('#c-search').oninput = drawRows; $('#c-band').onchange = drawRows;
  drawRows(); wireCommon($('#main'));
};

function panelEngagement(id) {
  const e = byId('engagements', id);
  if (!e) return;
  openPanel(`
    <h2>Engagement ${fictionBadge(e)}</h2>
    ${kv([['Who', e.contactId ? `<a href="#" data-open="contacts:${e.contactId}">${esc(contactName(e.contactId))}</a>` : esc(e.personName)], ['Kind', esc(e.kind)], ['Date', fmtDate(e.date)], ['On content', e.contentId ? esc(byId('content', e.contentId)?.title || e.contentId) : '—'], ['Suggested', esc(e.recommendation)], ['Status', esc(e.status)]])}
    <pre class="msg">${esc(e.text)}</pre>
    <div class="btn-row">
      ${e.contactId ? `<button class="btn btn-accent" id="e-outreach">Draft DM / follow-up</button>` : `<button class="btn" id="e-mkcontact">Create contact</button>`}
      <button class="btn btn-quiet" id="e-handled">Mark handled</button>
    </div>`);
  wireCommon($('#panel'));
  if ($('#e-outreach')) $('#e-outreach').onclick = () => outreachForm(e.contactId, { purpose: 'follow-up-after-content-engagement', trigger: `Engaged: ${e.text.slice(0, 100)}`, evidence: [`${e.id}: ${e.text.slice(0, 120)}`] });
  if ($('#e-mkcontact')) $('#e-mkcontact').onclick = async () => {
    const created = await api('/collections/contacts', { method: 'POST', body: { name: e.personName, relationshipType: 'industry-peer', lanes: [], howKnown: `Engaged with content (${e.id})`, doNotContact: false, permissionStatus: 'legitimate-contact' } });
    await api(`/collections/engagements/${id}`, { method: 'PATCH', body: { contactId: created.id } });
    toast('Contact created'); await refresh(); panelEngagement(id);
  };
  $('#e-handled').onclick = async () => { await api(`/collections/engagements/${id}`, { method: 'PATCH', body: { status: 'handled' } }); toast('Handled'); await refresh(); render(); };
}

function panelContact(id) {
  const c = byId('contacts', id);
  if (!c) return;
  const rel = ANALYTICS.relationships.rows.find((r) => r.id === id);
  const timeline = S.interactions.filter((i) => i.contactId === id).sort((a, b) => a.date < b.date ? 1 : -1);
  const theirOutreach = S.outreach.filter((o) => o.contactId === id);
  const theirOpps = S.opportunities.filter((o) => (o.contactIds || []).includes(id));
  openPanel(`
    <h2>${esc(c.name)} ${fictionBadge(c)} ${c.doNotContact ? '<span class="badge bad">do not contact</span>' : ''}</h2>
    ${kv([['Role', esc(c.role)], ['Company', esc(c.company)], ['Location', esc(c.location)], ['Type', esc(c.relationshipType)], ['Lanes', (c.lanes || []).map(esc).join(', ')], ['How known', esc(c.howKnown)], ['Email', c.email ? esc(c.email) : '<span class="small">unknown (the engine never guesses addresses)</span>'], ['Permission', esc(c.permissionStatus)]])}
    ${rel ? `<div class="section-t">Relationship strength — <span class="badge ${banded(rel.band)}">${esc(rel.band)}</span> ${rel.score}/100</div>
    <ul class="plain">${(strengthEvidence(c) || []).map((e) => `<li>${esc(e)}</li>`).join('')}</ul>` : ''}
    <div class="section-t">Timeline (${timeline.length})</div>
    <ul class="plain">${timeline.map((i) => `<li><strong>${fmtDate(i.date)}</strong> · ${esc(i.kind)} — ${esc(i.note)}</li>`).join('') || '<li>No interactions logged.</li>'}</ul>
    <div class="btn-row"><button class="btn" id="ct-log">Log interaction</button>
    ${!c.doNotContact ? `<button class="btn btn-accent" id="ct-outreach">New outreach</button>` : ''}</div>
    ${theirOutreach.length ? `<div class="section-t">Outreach history</div><ul class="plain">${theirOutreach.map((o) => `<li><a href="#" data-open="outreach:${o.id}">${esc(o.purpose)} · ${esc(o.stage)}${o.score ? ` · ${o.score.total}/100` : ''}</a></li>`).join('')}</ul>` : ''}
    ${theirOpps.length ? `<div class="section-t">Opportunities</div><ul class="plain">${theirOpps.map((o) => `<li><a href="#" data-open="opportunities:${o.id}">${esc(o.name)} · ${esc(o.stage)}</a></li>`).join('')}</ul>` : ''}`);
  wireCommon($('#panel'));
  $('#ct-log').onclick = async () => {
    const note = prompt('What happened? (meeting / call / reply / comment / message)');
    if (!note) return;
    const kind = prompt('Kind (meeting, call, reply, comment, message, event, intro)', 'message') || 'message';
    await api('/collections/interactions', { method: 'POST', body: { contactId: id, kind, note, date: new Date().toISOString(), direction: 'two-way' } });
    toast('Logged'); await refresh(); panelContact(id);
  };
  if ($('#ct-outreach')) $('#ct-outreach').onclick = () => outreachForm(id, {});
}

function strengthEvidence(c) {
  // Rebuild the same evidence text the server computes, from local records.
  const rel = ANALYTICS.relationships.rows.find((r) => r.id === c.id);
  return rel ? [rel.evidence].filter(Boolean) : [];
}

// ---------- new outreach form ----------
function outreachForm(contactId, preset) {
  const c = byId('contacts', contactId);
  const purposes = ['warm-reconnection', 'event-follow-up', 'follow-up-after-content-engagement', 'podcast-pitch', 'media-pitch', 'speaking-outreach', 'referral-request', 'prospect-outreach', 'partnership-conversation', 'new-business-conversation', 'share-something-useful', 'follow-up-after-meeting'];
  $('#overlay').hidden = false;
  $('#overlay').innerHTML = `<div class="sheet">
    <h2>New outreach — ${esc(c.name)}</h2>
    <p class="small">Every message needs a real reason, a value exchange, evidence, and a reason to send it now. Thin evidence means a shorter message, never an invented one.</p>
    <label class="f">Purpose</label><select id="o-purpose">${purposes.map((p) => `<option ${p === preset.purpose ? 'selected' : ''}>${p}</option>`).join('')}</select>
    <label class="f">Trigger — why now?</label><input type="text" id="o-trigger" value="${esc(preset.trigger || '')}">
    <label class="f">Value to them — what do they get from replying?</label><input type="text" id="o-value">
    <label class="f">Evidence of relevance (one per line, from real records)</label><textarea id="o-evidence" style="min-height:4rem">${esc((preset.evidence || []).join('\n'))}</textarea>
    <label class="f">Channel</label><select id="o-channel"><option>linkedin-dm</option><option>email</option><option>whatsapp</option></select>
    <div class="btn-row"><button class="btn btn-accent" id="o-go">Draft it</button><button class="btn btn-quiet" id="o-cancel">Cancel</button></div></div>`;
  $('#o-cancel').onclick = () => { $('#overlay').hidden = true; };
  $('#o-go').onclick = async () => {
    try {
      const r = await act('draft-outreach', {
        contactId, purpose: $('#o-purpose').value, trigger: $('#o-trigger').value,
        valueToRecipient: $('#o-value').value,
        evidence: $('#o-evidence').value.split('\n').map((s) => s.trim()).filter(Boolean),
        channel: $('#o-channel').value,
      });
      $('#overlay').hidden = true;
      toast(`Drafted and scored ${r.outreach.score.total}/100 (${r.provider})`);
      await refresh(); location.hash = '#/outreach'; panelOutreach(r.outreach.id);
    } catch (e) { toast(e.message, true); }
  };
}

// ---------------------------------------------------------------------------
// OUTREACH
// ---------------------------------------------------------------------------
const OUTREACH_ORDER = ['identified', 'researched', 'qualified', 'drafted', 'approved', 'sent', 'replied', 'conversation', 'meeting', 'opportunity', 'closed', 'paused', 'do-not-contact'];
routes.outreach = async () => {
  const groups = OUTREACH_ORDER.map((stage) => [stage, S.outreach.filter((o) => o.stage === stage)]).filter(([, v]) => v.length);
  $('#main').innerHTML = `
    <div class="view-head"><div><h1>Outreach</h1><div class="h-sub">drafts only, always. Stuart approves, sends by hand, and records the send.</div></div></div>
    ${groups.map(([stage, items]) => `<h2>${esc(stage)} (${items.length})</h2>
    <div class="table-wrap"><table><thead><tr><th>Contact</th><th>Purpose</th><th>Trigger</th><th class="num">Score</th><th>Verdict</th><th>Reply</th></tr></thead>
    <tbody>${items.map((o) => `<tr class="rowlink" data-open="outreach:${o.id}">
      <td><strong>${esc(contactName(o.contactId))}</strong> ${fictionBadge(o)}</td>
      <td>${esc(o.purpose)}</td><td class="small">${esc(o.trigger || '—')}</td>
      <td class="num">${o.score ? `${o.score.total}` : '—'}</td>
      <td>${o.score ? `<span class="badge ${o.score.verdict === 'recommend' ? 'good' : o.score.verdict === 'improve-first' ? 'warn' : 'bad'}">${esc(o.score.verdict)}</span>` : ''}</td>
      <td class="small">${o.reply ? `${esc(o.reply.sentiment)}: ${esc((o.reply.text || '').slice(0, 60))}` : '—'}</td></tr>`).join('')}</tbody></table></div>`).join('')}`;
  wireCommon($('#main'));
};

function panelOutreach(id) {
  const o = byId('outreach', id);
  if (!o) return;
  const s = o.score;
  openPanel(`
    <h2>${esc(contactName(o.contactId))} — ${esc(o.purpose)} ${fictionBadge(o)}</h2>
    ${kv([['Stage', `<span class="badge accent">${esc(o.stage)}</span>`], ['Channel', esc(o.channel)], ['Trigger', esc(o.trigger || '—')], ['Value to them', esc(o.valueToRecipient || '—')], ['Approval', esc(o.approval?.status || 'pending')], ['Sent', o.sentAt ? fmtDate(o.sentAt) : 'not sent'], ['Follow-up', fmtDate(o.followUpDate)]])}
    <div class="section-t">Evidence used to personalise (provenance)</div>
    ${(o.evidence || []).map((e) => `<div class="evidence-note">${esc(e)}</div>`).join('') || '<p class="small">No evidence attached. The quality check will flag this.</p>'}
    <div class="section-t">Message</div>
    <textarea id="po-msg">${esc(o.message || '')}</textarea>
    <div class="btn-row">
      <button class="btn" id="po-save">Save</button>
      <button class="btn" id="po-redraft">AI draft</button>
      <button class="btn" id="po-score">Run quality check</button>
    </div>
    ${s ? `<div class="section-t">Qualification — ${s.total}/100 · <span class="badge ${s.verdict === 'recommend' ? 'good' : s.verdict === 'improve-first' ? 'warn' : 'bad'}">${esc(s.verdict)}</span></div>
      <p class="small">${esc(s.verdictText)}</p>
      ${(s.hardStops || []).map((h) => `<div class="evidence-note" style="border-color:var(--bad)">${esc(h)}</div>`).join('')}
      <table><tbody>${s.rows.map((r) => `<tr><td>${esc(r.label)}</td><td style="width:34%">${meter(r.points, r.weight)}</td><td class="small">${esc(r.why)}</td></tr>`).join('')}</tbody></table>` : ''}
    <div class="section-t">Workflow</div>
    <div class="btn-row">
      ${o.stage === 'drafted' ? `<button class="btn btn-accent" id="po-approve">Approve</button>` : ''}
      ${o.stage === 'approved' ? `<button class="btn btn-accent" id="po-sent">Mark sent (I sent it myself)</button>` : ''}
      ${['sent', 'replied'].includes(o.stage) ? `<button class="btn" id="po-reply">Record reply</button>` : ''}
      ${o.stage === 'conversation' ? `<button class="btn btn-accent" id="po-opp">Create opportunity</button>` : ''}
    </div>
    <label class="f">Learning (what this taught us)</label>
    <input type="text" id="po-learning" value="${esc(o.learning || '')}">
    <div class="btn-row"><button class="btn btn-sm btn-quiet" id="po-savelearn">Save learning</button></div>`);
  wireCommon($('#panel'));
  $('#po-save').onclick = async () => { await api(`/collections/outreach/${id}`, { method: 'PATCH', body: { message: $('#po-msg').value } }); toast('Saved'); await refresh(); };
  $('#po-redraft').onclick = async () => { try { const r = await act('draft-outreach', { outreachId: id }); toast(`Drafted (${r.provider})`); await refresh(); panelOutreach(id); } catch (e) { toast(e.message, true); } };
  $('#po-score').onclick = async () => { await api(`/collections/outreach/${id}`, { method: 'PATCH', body: { message: $('#po-msg').value } }); await act('score-outreach', { outreachId: id }); toast('Checked'); await refresh(); panelOutreach(id); };
  if ($('#po-approve')) $('#po-approve').onclick = async () => { try { await act('approve', { type: 'outreach', id }); toast('Approved. Send it yourself, then record the send.'); await refresh(); panelOutreach(id); } catch (e) { toast(e.message, true); } };
  if ($('#po-sent')) $('#po-sent').onclick = async () => { try { await act('mark-sent', { outreachId: id }); toast('Send recorded; follow-up task created'); await refresh(); panelOutreach(id); } catch (e) { toast(e.message, true); } };
  if ($('#po-reply')) $('#po-reply').onclick = async () => {
    const text = prompt('Reply text?'); if (!text) return;
    const sentiment = prompt('Sentiment: positive / neutral / negative', 'positive') || 'neutral';
    const mkOpp = confirm('Create an opportunity from this reply?');
    const r = await act('record-reply', { outreachId: id, text, sentiment, createOpportunity: mkOpp });
    toast(r.opportunity ? 'Reply recorded + opportunity created' : 'Reply recorded');
    await refresh(); panelOutreach(id);
  };
  if ($('#po-opp')) $('#po-opp').onclick = async () => { const r = await act('record-reply', { outreachId: id, text: o.reply?.text || '(already in conversation)', sentiment: 'positive', createOpportunity: true }); toast('Opportunity created'); await refresh(); panelOpportunity(r.opportunity.id); };
  $('#po-savelearn').onclick = async () => { await api(`/collections/outreach/${id}`, { method: 'PATCH', body: { learning: $('#po-learning').value } }); toast('Learning saved'); await refresh(); };
}

// ---------------------------------------------------------------------------
// OPPORTUNITIES
// ---------------------------------------------------------------------------
const OPP_STAGES = ['signal', 'conversation', 'qualified', 'diagnostic', 'proposal', 'decision', 'won', 'lost', 'nurture'];
routes.opportunities = async () => {
  $('#main').innerHTML = `
    <div class="view-head"><div><h1>Opportunities</h1><div class="h-sub">the Strait Up Growth pipeline: values and probabilities are Stuart's, never the engine's</div></div></div>
    <div class="board">${OPP_STAGES.map((stage) => {
      const items = S.opportunities.filter((o) => o.stage === stage);
      const total = items.reduce((s, o) => s + (o.estimatedValue || 0), 0);
      return `<div class="col"><div class="col-h"><span>${esc(stage)}</span><span>${items.length}${total ? ` · ${Math.round(total / 1000)}k` : ''}</span></div>
      ${items.map((o) => {
        const idle = daysAgo(o.lastActivityAt || o.updatedAt);
        return `<div class="item" data-open="opportunities:${o.id}">
        <div class="i-t">${esc(o.name)}</div>
        <div class="i-m">${esc(o.type)} · ${fmtMoney(o.estimatedValue, o.currency)} · p=${o.probability ?? '—'}${idle >= 10 ? ` · <span style="color:var(--bad)">${idle}d idle</span>` : ''}</div>
      </div>`;
      }).join('')}</div>`;
    }).join('')}</div>`;
  wireCommon($('#main'));
};

function panelOpportunity(id) {
  const o = byId('opportunities', id);
  if (!o) return;
  openPanel(`
    <h2>${esc(o.name)} ${fictionBadge(o)}</h2>
    ${kv([['Type', esc(o.type)], ['Company', esc(byId('companies', o.companyId)?.name || '—')],
      ['Contacts', (o.contactIds || []).map((cid) => `<a href="#" data-open="contacts:${cid}">${esc(contactName(cid))}</a>`).join(', ')],
      ['Offer', esc(byId('offers', o.offerId)?.name || '—')], ['Source', esc(o.source)],
      ['Content influence', `<span class="badge">${esc(o.contentInfluence || 'no-proven-influence')}</span>`],
      ['Evidence', esc(o.evidence || '—')], ['Last activity', `${daysAgo(o.lastActivityAt || o.updatedAt)}d ago`],
      ['Outcome', esc(o.outcome || 'open')], ['Lost reason', o.lostReason ? esc(o.lostReason) : undefined], ['Lessons', o.lessons ? esc(o.lessons) : undefined]])}
    <label class="f">Stage</label><select id="op-stage">${OPP_STAGES.map((s) => `<option ${s === o.stage ? 'selected' : ''}>${s}</option>`).join('')}</select>
    <label class="f">Estimated value (${esc(o.currency || 'SGD')})</label><input type="number" id="op-value" value="${o.estimatedValue ?? ''}">
    <label class="f">Probability (0-1)</label><input type="number" step="0.05" min="0" max="1" id="op-prob" value="${o.probability ?? ''}">
    <label class="f">Next action</label><input type="text" id="op-next" value="${esc(o.nextAction || '')}">
    <label class="f">Next action date</label><input type="date" id="op-date" value="${o.nextActionDate || ''}">
    <label class="f">Content influence (attribution honesty)</label>
    <select id="op-attr">${['direct-source', 'strong-influence', 'supporting-influence', 'no-proven-influence'].map((a) => `<option ${a === o.contentInfluence ? 'selected' : ''}>${a}</option>`).join('')}</select>
    <div class="btn-row"><button class="btn btn-accent" id="op-save">Save</button></div>
    ${(o.relatedContent || []).length ? `<div class="section-t">Related content</div><ul class="plain">${o.relatedContent.map((cid) => `<li><a href="#" data-open="content:${cid}">${esc(byId('content', cid)?.title || cid)}</a></li>`).join('')}</ul>` : ''}
    ${(o.relatedOutreach || []).length ? `<div class="section-t">Related outreach</div><ul class="plain">${o.relatedOutreach.map((oid) => `<li><a href="#" data-open="outreach:${oid}">${esc(oid)}</a></li>`).join('')}</ul>` : ''}`);
  wireCommon($('#panel'));
  $('#op-save').onclick = async () => {
    const stage = $('#op-stage').value;
    await api(`/collections/opportunities/${id}`, { method: 'PATCH', body: {
      stage, estimatedValue: $('#op-value').value ? Number($('#op-value').value) : null,
      probability: $('#op-prob').value ? Number($('#op-prob').value) : null,
      nextAction: $('#op-next').value || null, nextActionDate: $('#op-date').value || null,
      contentInfluence: $('#op-attr').value, lastActivityAt: new Date().toISOString(),
      outcome: stage === 'won' ? 'won' : stage === 'lost' ? 'lost' : null,
    } });
    toast('Saved'); await refresh(); panelOpportunity(id);
  };
}

// ---------------------------------------------------------------------------
// OFFERS
// ---------------------------------------------------------------------------
routes.offers = async () => {
  $('#main').innerHTML = `
    <div class="view-head"><div><h1>Offer library</h1><div class="h-sub">every offer is a draft assumption until Stuart confirms it. No invented clients, results or prices.</div></div></div>
    ${S.offers.map((o) => `<div class="card" style="cursor:pointer" data-open="offers:${o.id}">
      <strong>${esc(o.name)}</strong> ${o.draft ? '<span class="badge warn">draft assumption</span>' : '<span class="badge good">confirmed</span>'}
      <div class="small" style="margin-top:.3rem">${esc(o.problem)}</div>
      <div class="small" style="color:var(--muted)">lanes: ${(o.lanes || []).map(esc).join(', ')} · pricing: ${esc(o.pricingLogic)}</div>
    </div>`).join('')}`;
  wireCommon($('#main'));
};

function panelOffer(id) {
  const o = byId('offers', id);
  if (!o) return;
  const opps = S.opportunities.filter((x) => x.offerId === id);
  openPanel(`
    <h2>${esc(o.name)} ${o.draft ? '<span class="badge warn">draft assumption</span>' : ''}</h2>
    ${kv([['Target buyer', esc(o.targetBuyer)], ['Buyer trigger', esc(o.buyerTrigger)], ['Problem', esc(o.problem)], ['Primary artifacts', esc(o.primaryArtifacts)], ['Lanes', (o.lanes || []).map(esc).join(', ')], ['Proof', esc(o.proofRequired)]])}
    <label class="f">Pricing logic (Stuart's to set)</label><input type="text" id="of-pricing" value="${esc(o.pricingLogic || '')}">
    <div class="btn-row">
      <button class="btn" id="of-save">Save</button>
      ${o.draft ? `<button class="btn btn-accent" id="of-confirm">Confirm offer (no longer a draft)</button>` : ''}
    </div>
    ${opps.length ? `<div class="section-t">Linked opportunities</div><ul class="plain">${opps.map((x) => `<li><a href="#" data-open="opportunities:${x.id}">${esc(x.name)} · ${esc(x.stage)}</a></li>`).join('')}</ul>` : '<p class="small">No opportunities linked yet.</p>'}`);
  wireCommon($('#panel'));
  $('#of-save').onclick = async () => { await api(`/collections/offers/${id}`, { method: 'PATCH', body: { pricingLogic: $('#of-pricing').value } }); toast('Saved'); await refresh(); };
  if ($('#of-confirm')) $('#of-confirm').onclick = async () => { await api(`/collections/offers/${id}`, { method: 'PATCH', body: { draft: false, status: 'confirmed' } }); toast('Offer confirmed'); await refresh(); panelOffer(id); };
}

// ---------------------------------------------------------------------------
// ANALYTICS
// ---------------------------------------------------------------------------
routes.analytics = async () => {
  ANALYTICS = await api('/analytics');
  const a = ANALYTICS; const sc = a.scorecard; const au = a.authority;
  $('#main').innerHTML = `
    <div class="view-head"><div><h1>Analytics</h1><div class="h-sub">is the brand producing commercial conversations? Impressions are context, never the goal.</div></div></div>
    <div class="tiles">
      ${tile('Qualified conversations', sc.qualifiedConversations)}${tile('Meetings', sc.meetingsBooked)}
      ${tile('Open opportunities', sc.openOpportunities)}${tile('Pipeline', fmtMoney(sc.pipelineValue))}
      ${tile('Weighted pipeline', fmtMoney(sc.weightedPipeline))}${tile('Revenue won', fmtMoney(sc.revenueWon))}
      ${tile('Reply rate', sc.replyRate == null ? '—' : sc.replyRate + '%', `${sc.outreachSent} sent`)}
      ${tile('Positive replies', sc.positiveReplyRate == null ? '—' : sc.positiveReplyRate + '%')}
      ${tile('Follow-up completion', sc.followUpCompletion == null ? '—' : sc.followUpCompletion + '%')}
      ${tile('Published (30d)', sc.publishedLast30d)}${tile('Warm relationships', sc.warmRelationships)}
    </div>

    <h2>Authority score — ${au.total}/100 <span class="badge">confidence: ${esc(au.confidence)}</span></h2>
    <p class="small">${esc(au.note)}</p>
    <div class="table-wrap"><table><thead><tr><th>Component</th><th style="width:30%">Points</th><th>Evidence</th></tr></thead>
    <tbody>${au.components.map((c) => `<tr><td>${esc(c.label)}</td><td>${meter(c.points, c.weight)}</td><td class="small">${esc(c.why)}${c.missing ? `<br><em style="color:var(--warn)">missing: ${esc(c.missing)}</em>` : ''}</td></tr>`).join('')}</tbody></table></div>

    <div class="two-col">
      <div><h2>Authority lanes</h2>
      <div class="table-wrap"><table><thead><tr><th>Lane</th><th class="num">Items</th><th class="num">Published</th><th class="num">Conversations</th><th class="num">Opps</th></tr></thead>
      <tbody>${a.content.byLane.map((l) => `<tr><td>${esc(l.lane)}</td><td class="num">${l.items}</td><td class="num">${l.published}</td><td class="num">${l.conversations}</td><td class="num">${l.opportunities}</td></tr>`).join('')}</tbody></table></div></div>
      <div><h2>Outreach by purpose</h2>
      <div class="table-wrap"><table><thead><tr><th>Purpose</th><th class="num">Drafted</th><th class="num">Sent</th><th class="num">Replied</th><th class="num">Positive</th><th class="num">Conv.</th></tr></thead>
      <tbody>${a.outreach.byPurpose.map((p) => `<tr><td>${esc(p.purpose)}</td><td class="num">${p.drafted}</td><td class="num">${p.sent}</td><td class="num">${p.replied}</td><td class="num">${p.positive}</td><td class="num">${p.conversations}</td></tr>`).join('')}</tbody></table></div></div>
    </div>

    <h2>Published content — commercial outcomes</h2>
    <div class="table-wrap"><table><thead><tr><th>Piece</th><th>Format</th><th class="num">Score</th><th class="num">Impressions</th><th class="num">Conversations</th><th class="num">Opps</th></tr></thead>
    <tbody>${a.content.pieces.map((p) => `<tr class="rowlink" data-open="content:${p.id}"><td>${esc(p.title)}</td><td>${esc(p.format)}</td><td class="num">${p.score ?? '—'}</td><td class="num">${p.impressions ?? '—'}</td><td class="num"><strong>${p.conversations}</strong></td><td class="num">${p.opportunities}</td></tr>`).join('')}</tbody></table></div>
    ${a.content.noDownstreamAction.length ? `<p class="small" style="margin-top:.4rem">No downstream action: ${a.content.noDownstreamAction.map((p) => esc(p.title)).join(' · ')}</p>` : ''}

    <div class="two-col" style="margin-top:1rem">
      <div><h2>Pipeline by source</h2>
      <div class="table-wrap"><table><thead><tr><th>Source</th><th class="num">Count</th><th class="num">Value</th><th class="num">Won</th></tr></thead>
      <tbody>${a.pipeline.bySource.map((s) => `<tr><td>${esc(s.source)}</td><td class="num">${s.count}</td><td class="num">${fmtMoney(s.value)}</td><td class="num">${s.won}</td></tr>`).join('')}</tbody></table></div>
      <p class="small">Content-assisted opportunities: ${a.pipeline.contentAssisted} (classified, never guessed).</p></div>
      <div><h2>Going cold</h2>
      <div class="table-wrap"><table><thead><tr><th>Contact</th><th>Company</th><th class="num">Quiet for</th></tr></thead>
      <tbody>${a.relationships.goingCold.map((r) => `<tr class="rowlink" data-open="contacts:${r.id}"><td>${esc(r.name)}</td><td>${esc(r.company || '—')}</td><td class="num">${daysAgo(r.last)}d</td></tr>`).join('') || '<tr><td colspan="3" class="small">Nothing going cold.</td></tr>'}</tbody></table></div></div>
    </div>
    <p class="caveat">${esc(a.caveat)}</p>`;
  wireCommon($('#main'));
};

// ---------------------------------------------------------------------------
// REVIEWS
// ---------------------------------------------------------------------------
routes.reviews = async () => {
  const rows = [...S.reviews].sort((a, b) => a.createdAt < b.createdAt ? 1 : -1);
  $('#main').innerHTML = `
    <div class="view-head"><div><h1>Reviews</h1><div class="h-sub">weekly authority reviews and monthly strategic reviews, drafted from the records</div></div>
    <div class="spacer"></div><button class="btn btn-accent" id="rv-weekly">Draft this week's review</button></div>
    ${rows.map((r) => `<div class="card">
      <strong>${esc(r.kind)} review</strong> · ${esc(r.period)} · <span class="badge ${r.status === 'confirmed' ? 'good' : 'warn'}">${esc(r.status)}</span> ${fictionBadge(r)}
      ${Object.entries(r.body || {}).filter(([k]) => !['provider', 'note'].includes(k)).map(([k, v]) => `
        <div class="section-t">${esc(k.replace(/([A-Z])/g, ' $1').toLowerCase())}</div>
        ${Array.isArray(v) ? `<ul class="plain">${v.map((x) => `<li>${esc(typeof x === 'object' ? JSON.stringify(x) : x)}</li>`).join('') || '<li class="small">none</li>'}</ul>` : `<p class="small">${esc(String(v))}</p>`}`).join('')}
      ${r.status !== 'confirmed' ? `<div class="btn-row"><button class="btn btn-sm" data-confirm-review="${r.id}">Confirm (Stuart has read and edited)</button></div>` : ''}
    </div>`).join('')}`;
  $('#rv-weekly').onclick = async () => { toast('Drafting…'); await act('weekly-review'); toast('Weekly review drafted'); await refresh(); render(); };
  $('#main').querySelectorAll('[data-confirm-review]').forEach((b) => b.onclick = async () => {
    await api(`/collections/reviews/${b.dataset.confirmReview}`, { method: 'PATCH', body: { status: 'confirmed' } });
    toast('Confirmed'); await refresh(); render();
  });
};

// ---------------------------------------------------------------------------
// KNOWLEDGE + VOICE
// ---------------------------------------------------------------------------
routes.knowledge = async () => {
  const v = S.voiceDoc;
  $('#main').innerHTML = `
    <div class="view-head"><div><h1>Knowledge &amp; voice</h1><div class="h-sub">what the AI retrieves before it drafts anything; every generated output cites its sources</div></div></div>
    <div class="two-col">
      <div>
        <h2>Voice rules (approved — active in every draft)</h2>
        <ul class="plain">${(v.rules || []).map((r) => `<li>${esc(r.text)} <span class="badge">${esc(r.source || '')}</span>${r.status !== 'approved' ? ' <span class="badge warn">proposed</span>' : ''}</li>`).join('')}</ul>
        ${(v.pendingExtractions || []).length ? `<h2>Proposed rules (from Stuart's edits — inactive until approved)</h2>
        <ul class="plain">${v.pendingExtractions.map((r) => `<li>${esc(r.text)} <button class="btn btn-sm" data-approve-rule="${r.id}">Approve</button></li>`).join('')}</ul>` : ''}
        <h2>Teach the voice: compare a draft with your edit</h2>
        <label class="f">AI draft (original)</label><textarea id="vx-orig" style="min-height:5rem"></textarea>
        <label class="f">Stuart's edited version</label><textarea id="vx-edit" style="min-height:5rem"></textarea>
        <label class="f">What you disliked (optional)</label><input type="text" id="vx-note">
        <div class="btn-row"><button class="btn btn-accent" id="vx-go">Extract durable preferences</button></div>
        <p class="small">Extracted rules are proposals; nothing becomes active until approved above.</p>
      </div>
      <div>
        <h2>Knowledge base (${S.knowledge.length})</h2>
        ${S.knowledge.map((k) => `<div class="card"><strong>${esc(k.title)}</strong> <span class="badge">${esc(k.kind)}</span> ${k.fictional ? '<span class="badge fiction">fictional demo</span>' : ''}
          <div class="small" style="margin-top:.25rem">${esc(k.body)}</div></div>`).join('')}
      </div>
    </div>`;
  $('#vx-go').onclick = async () => {
    const r = await act('extract-voice-rule', { original: $('#vx-orig').value, edited: $('#vx-edit').value, note: $('#vx-note').value });
    toast(`${r.proposed.length} rule(s) proposed`); await refresh(); render();
  };
  $('#main').querySelectorAll('[data-approve-rule]').forEach((b) => b.onclick = async () => {
    await act('approve-voice-rule', { ruleId: b.dataset.approveRule });
    toast('Rule approved and active'); await refresh(); render();
  });
};

// ---------------------------------------------------------------------------
// SETTINGS
// ---------------------------------------------------------------------------
routes.settings = async () => {
  const v = S.settings.values || {};
  const auditRows = (await api('/audit')).items.slice(0, 40);
  $('#main').innerHTML = `
    <div class="view-head"><div><h1>Settings</h1><div class="h-sub">weights, thresholds and identity. Scores are configurable because they are opinions.</div></div></div>
    <div class="two-col">
      <div>
        <h2>Appearance</h2>
        <label class="f">Accent colour</label><input type="text" id="st-accent" value="${esc(v.accentColor || '#B34700')}">
        <label class="f">Demo mode banner</label>
        <select id="st-demo"><option value="true" ${v.demoMode ? 'selected' : ''}>on</option><option value="false" ${!v.demoMode ? 'selected' : ''}>off</option></select>
        <h2>Content thresholds</h2>
        <label class="f">Strong authority piece (of 60)</label><input type="number" id="st-strong" value="${v.contentThresholds?.strong ?? 48}">
        <label class="f">Publish after edits (of 60)</label><input type="number" id="st-edits" value="${v.contentThresholds?.publishAfterEdits ?? 36}">
        <h2>Outreach weights (sum 100)</h2>
        ${Object.entries(v.outreachWeights || {}).map(([k, val]) => `<label class="f">${esc(k)}</label><input type="number" data-ow="${esc(k)}" value="${val}">`).join('')}
        <h2>Authority weights (sum 100)</h2>
        ${Object.entries(v.authorityWeights || {}).map(([k, val]) => `<label class="f">${esc(k)}</label><input type="number" data-aw="${esc(k)}" value="${val}">`).join('')}
        <div class="btn-row"><button class="btn btn-accent" id="st-save">Save settings</button></div>
        <p class="small">AI provider: <span class="mono">${esc(S.provider)}</span>. Set <span class="mono">ANTHROPIC_API_KEY</span> in the environment for live drafting; without it the mock provider produces labelled scaffolds and never invents facts.</p>
      </div>
      <div>
        <h2>Audit log (latest 40)</h2>
        <div class="table-wrap"><table><thead><tr><th>When</th><th>Actor</th><th>Action</th><th>Record</th></tr></thead>
        <tbody>${auditRows.map((a) => `<tr><td class="mono">${esc((a.at || '').slice(5, 16).replace('T', ' '))}</td><td>${esc(a.actor)}</td><td>${esc(a.action)}</td><td class="small">${esc(a.collection)}/${esc(a.id)} ${esc(a.summary || '')}</td></tr>`).join('')}</tbody></table></div>
      </div>
    </div>`;
  $('#st-save').onclick = async () => {
    const outreachWeights = {}; const authorityWeights = {};
    $('#main').querySelectorAll('[data-ow]').forEach((i) => outreachWeights[i.dataset.ow] = Number(i.value));
    $('#main').querySelectorAll('[data-aw]').forEach((i) => authorityWeights[i.dataset.aw] = Number(i.value));
    await api('/settings', { method: 'PATCH', body: {
      accentColor: $('#st-accent').value, demoMode: $('#st-demo').value === 'true',
      contentThresholds: { strong: Number($('#st-strong').value), publishAfterEdits: Number($('#st-edits').value) },
      outreachWeights, authorityWeights,
    } });
    toast('Settings saved'); await refresh(); render();
  };
};

// ---------------------------------------------------------------------------
// Quick capture
// ---------------------------------------------------------------------------
function captureModal() {
  $('#overlay').hidden = false;
  $('#overlay').innerHTML = `<div class="sheet">
    <h2>Capture an insight</h2>
    <label class="f">Title</label><input type="text" id="cap-title" autofocus>
    <label class="f">Raw note (kept lossless)</label><textarea id="cap-raw"></textarea>
    <label class="f">Type</label><select id="cap-type">${['commercial-lesson', 'meeting-note', 'client-pattern', 'event-observation', 'industry-news', 'personal-experience', 'contrarian-opinion', 'framework', 'question', 'prediction', 'podcast-idea', 'speaking-idea', 'offer-insight'].map((t) => `<option>${t}</option>`).join('')}</select>
    <label class="f">Authority lanes</label>
    <select id="cap-lanes" multiple size="6">${laneNames().map((l) => `<option>${esc(l)}</option>`).join('')}</select>
    <label class="f">Commercial relevance (1-5)</label><input type="number" id="cap-rel" min="1" max="5" value="3">
    <div class="btn-row"><button class="btn btn-accent" id="cap-go">Capture</button><button class="btn btn-quiet" id="cap-cancel">Cancel</button></div>
    <p class="small">Capture runs the confidentiality review automatically; you confirm the classification in the insight panel.</p></div>`;
  $('#cap-cancel').onclick = () => { $('#overlay').hidden = true; };
  $('#cap-go').onclick = async () => {
    const title = $('#cap-title').value.trim();
    if (!title) return toast('Title required', true);
    const lanes = [...$('#cap-lanes').selectedOptions].map((o) => o.value);
    const created = await api('/collections/insights', { method: 'POST', body: {
      title, raw: $('#cap-raw').value, type: $('#cap-type').value, lanes,
      commercialRelevance: Number($('#cap-rel').value), date: new Date().toISOString().slice(0, 10),
      source: 'Stuart, direct capture', status: 'captured', audiences: [],
    } });
    const conf = await act('confidentiality', { text: $('#cap-raw').value || title });
    await api(`/collections/insights/${created.id}`, { method: 'PATCH', body: { confidentiality: { ...conf, confirmed: false } } });
    $('#overlay').hidden = true;
    toast(`Captured. Suggested classification: ${conf.classification}`);
    await refresh(); location.hash = '#/insights'; render(); panelInsight(created.id);
  };
}

// ---------------------------------------------------------------------------
// Keyboard + boot
// ---------------------------------------------------------------------------
document.addEventListener('keydown', (e) => {
  const typing = ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName);
  if (e.key === 'Escape') { closePanel(); $('#overlay').hidden = true; return; }
  if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.key === 'c') { e.preventDefault(); captureModal(); }
  const n = Number(e.key);
  if (n >= 1 && n <= VIEWS.length) location.hash = `#/${VIEWS[n - 1][0]}`;
});
$('#btn-capture').onclick = captureModal;

await refresh();
render();
