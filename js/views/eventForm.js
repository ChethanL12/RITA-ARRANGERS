// New enquiry / edit event form: date & session, client, event details, requirements, budget & note.

import { icon } from '../icons.js';
import { esc, uid, clone, todayKey, fmtDateLong, fmtDateTime, money, lakhs, num, hasNum, fmtPhone, debounce } from '../util.js';
import { SESSIONS, STATUS } from '../models.js';
import {
  store, getEvent, getClient, saveEvent, eventsOn, findClientByPhone, clientEvents, budgetText, defaultNote, addressedAs, latestDoc,
} from '../store.js';
import { toast, toastError, busy, confirmDialog, autoGrow, statusBadge, sessionTag } from '../ui.js';
import { overlapsOn } from './calendar.js';
import { mountReqEditor } from './reqEditor.js';

const QUICK_FIELDS = ['Bride', 'Groom', 'Organisation', 'Contact Person', 'Guests'];
let dirtyFn = () => false;
export const isDirty = () => dirtyFn();
export async function canLeave() {
  if (!dirtyFn()) return true;
  return confirmDialog({ title: 'Leave without saving?', message: 'You have unsaved changes on this form. They are kept as a recoverable draft on this device, but not saved to the event.', confirm: 'Leave', kind: 'danger', icon: 'triangle-alert' });
}

function sessionSeg(name, value) {
  return `<div class="seg seg-session" data-seg="${name}">${Object.entries(SESSIONS).map(([k, s]) =>
    `<button type="button" data-v="${k}" class="${value === k ? 'on' : ''}">${icon(s.icon)}<span>${s.label}</span></button>`).join('')}</div>`;
}

export function render(root, { params, query, navigate }) {
  const editing = params[0] ? getEvent(params[0]) : null;
  if (params[0] && !editing) { root.innerHTML = '<div class="page"><div class="empty"><h3>Event not found</h3></div></div>'; return; }
  const draftKey = `ra.formDraft.${editing?.id || 'new'}`;

  /* ---------- state ---------- */
  let ev = editing ? clone(editing) : {
    title: '', service: '', venue: '', notes: '', displayName: '', quoteNote: '',
    dates: [{ id: uid('dt_'), label: '', date: query.get('date') || '', session: '', start: '', end: '' }],
    customFields: [], sections: [], budget: { min: '', max: '', text: '', asDiscussed: true },
  };
  if (!ev.dates?.length) ev.dates = [{ id: uid('dt_'), label: '', date: ev.primaryDate || '', session: ev.session || '', start: '', end: '' }];
  ev.budget = { min: '', max: '', text: '', asDiscussed: true, ...(ev.budget || {}) };
  let client = editing ? clone(getClient(editing.clientId) || {}) : (query.get('clientId') ? clone(getClient(query.get('clientId')) || {}) : { name: '', phone: '', altPhone: '', email: '', address: '' });

  let restored = null;
  if (sessionStorage.getItem('ra.restore') === draftKey) {
    sessionStorage.removeItem('ra.restore');
    try { restored = JSON.parse(localStorage.getItem(draftKey) || 'null'); } catch { /* ignore */ }
    if (restored) { ev = { ...ev, ...restored.ev }; client = restored.client || client; }
  }

  const snapshotState = () => JSON.stringify({ ev: { ...ev, sections: req ? req.get() : ev.sections }, client });
  let req = null;
  let initialState = '';

  /* ---------- markup ---------- */
  const title = editing ? `Edit — ${esc(client.name || 'Client')}` : 'New Enquiry';
  root.innerHTML = `<div class="page form-page">
    <header class="page-head">
      <div><p class="eyebrow">${editing ? esc(editing.title || 'Event') : 'Client is on the phone? Start here.'}</p><h1>${title}</h1></div>
      <div class="head-actions">
        <a class="btn btn-ghost" href="${editing ? `#/events/${editing.id}` : '#/'}">Cancel</a>
        <button class="btn btn-secondary" id="save-draft">${icon('save')}<span>${editing ? 'Save changes' : 'Save as draft'}</span></button>
        <button class="btn btn-primary" id="save-quote">${icon('file-text')}<span>Save &amp; ${editing && latestDoc(editing.id, 'quotation') ? 'revise' : 'generate'} quotation</span></button>
      </div>
    </header>
    <div id="draft-banner"></div>
    <div class="form-layout">
      <nav class="steps" id="steps">
        <a href="#" data-step="s-date"><span>1</span>Date &amp; Session</a>
        <a href="#" data-step="s-client"><span>2</span>Client</a>
        <a href="#" data-step="s-event"><span>3</span>Event Details</a>
        <a href="#" data-step="s-req"><span>4</span>Requirements</a>
        <a href="#" data-step="s-budget"><span>5</span>Budget &amp; Note</a>
      </nav>
      <div class="form-main">
        <section class="card form-card" id="s-date">
          <div class="form-card-head"><span class="step-no">1</span><div><h2>Event Date &amp; Session</h2><p>Several events can share a date — overlaps are shown, never blocked.</p></div></div>
          <div id="dates"></div>
          <button type="button" class="btn btn-ghost btn-sm" id="add-date">${icon('calendar-plus')}<span>Add another date (e.g. Roce Ceremony, Reception)</span></button>
          <div id="overlap"></div>
        </section>

        <section class="card form-card" id="s-client">
          <div class="form-card-head"><span class="step-no">2</span><div><h2>Client Information</h2><p>Type a name or number to reuse an existing client.</p></div></div>
          <div id="client-link"></div>
          <div class="grid-2">
            <label class="field ac-wrap"><span>Client / customer name <b class="req">*</b></span>
              <input class="input" id="c-name" autocomplete="off" value="${esc(client.name || '')}" placeholder="e.g. Ms. Divya D'Costa">
              <div class="ac" id="ac" hidden></div></label>
            <label class="field"><span>WhatsApp / mobile number <b class="req">*</b></span>
              <input class="input" id="c-phone" inputmode="tel" autocomplete="off" value="${esc(client.phone || '')}" placeholder="98765 43210"></label>
            <label class="field"><span>Additional contact number <em>optional</em></span>
              <input class="input" id="c-alt" inputmode="tel" value="${esc(client.altPhone || '')}"></label>
            <label class="field"><span>Email <em>optional</em></span>
              <input class="input" id="c-email" type="email" value="${esc(client.email || '')}"></label>
          </div>
          <label class="field"><span>Address <em>optional</em></span><input class="input" id="c-address" value="${esc(client.address || '')}"></label>
          <div id="phone-match"></div>
        </section>

        <section class="card form-card" id="s-event">
          <div class="form-card-head"><span class="step-no">3</span><div><h2>Event Details</h2><p>Everything is free text — write it exactly as it should appear.</p></div></div>
          <div class="grid-2">
            <label class="field"><span>Event name / type <b class="req">*</b></span>
              <input class="input" id="e-title" list="dl-titles" value="${esc(ev.title || '')}" placeholder="e.g. Wedding Reception"></label>
            <label class="field"><span>Event location / venue <em>optional</em></span>
              <input class="input" id="e-venue" list="dl-venues" value="${esc(ev.venue || '')}" placeholder="e.g. St. Anthony's Hall, Honnavar"></label>
          </div>
          <label class="field"><span>Service required</span>
            <textarea class="input" id="e-service" rows="2" placeholder="e.g. Venue Decoration, Lighting, Sound, Food Serving Area & Church Arrangements">${esc(ev.service || '')}</textarea></label>
          <div class="sub-head"><h3>Additional client / event fields</h3><p>Bride, Groom, organisation, guest count — only when needed.</p></div>
          <div id="custom"></div>
          <div class="chips">${QUICK_FIELDS.map((f) => `<button type="button" class="chip" data-quick="${f}">${icon('plus')}${f}</button>`).join('')}<button type="button" class="chip" data-quick="">${icon('plus')}Custom field</button></div>
          <label class="field mt"><span>Name used in documents <em>optional — e.g. “Ms. Divya D'Costa and Mr. Xavier”</em></span>
            <input class="input" id="e-display" value="${esc(ev.displayName || '')}" placeholder=""></label>
          <label class="field"><span>Internal notes <em>optional, never printed</em></span>
            <textarea class="input" id="e-notes" rows="2" placeholder="Anything to remember about this enquiry">${esc(ev.notes || '')}</textarea></label>
        </section>

        <section class="card form-card" id="s-req">
          <div class="form-card-head"><span class="step-no">4</span><div><h2>Event Requirements</h2><p>Sections and items appear in the quotation exactly as entered.</p></div></div>
          <div id="req"></div>
        </section>

        <section class="card form-card" id="s-budget">
          <div class="form-card-head"><span class="step-no">5</span><div><h2>Approximate Budget &amp; Note</h2><p>Quote a single figure or a range. No item-wise pricing needed.</p></div></div>
          <div class="grid-3">
            <label class="field"><span>Amount ${icon('indian-rupee')}</span><input class="input" id="b-min" inputmode="decimal" value="${esc(ev.budget.min)}" placeholder="850000"><small class="lakh" id="l-min"></small></label>
            <label class="field"><span>Up to <em>optional, for a range</em></span><input class="input" id="b-max" inputmode="decimal" value="${esc(ev.budget.max)}" placeholder="900000"><small class="lakh" id="l-max"></small></label>
            <label class="field"><span>Or custom wording <em>optional</em></span><input class="input" id="b-text" value="${esc(ev.budget.text)}" placeholder="Rs. 8.5 lakhs to Rs. 9 lakhs"></label>
          </div>
          <label class="check"><input type="checkbox" id="b-disc" ${ev.budget.asDiscussed ? 'checked' : ''}><span>Add “(as discussed)”</span></label>
          <div class="budget-preview" id="b-prev"></div>
          <label class="field mt"><span>Quotation note <em>leave empty to use the standard note from Settings</em></span>
            <textarea class="input" id="e-qnote" rows="3" placeholder="">${esc(ev.quoteNote || '')}</textarea></label>
        </section>

        <div class="form-actions">
          <button class="btn btn-secondary" id="save-draft-2">${icon('save')}<span>${editing ? 'Save changes' : 'Save as draft'}</span></button>
          <button class="btn btn-primary" id="save-quote-2">${icon('file-text')}<span>Save &amp; continue to quotation</span></button>
        </div>
      </div>
    </div>
    <datalist id="dl-titles">${[...new Set(store.events.map((e) => e.title).filter(Boolean))].slice(0, 50).map((t) => `<option value="${esc(t)}">`).join('')}</datalist>
    <datalist id="dl-venues">${[...new Set(store.events.map((e) => e.venue).filter(Boolean))].slice(0, 50).map((t) => `<option value="${esc(t)}">`).join('')}</datalist>
  </div>`;

  const $ = (s) => root.querySelector(s);
  root.querySelectorAll('textarea.input').forEach(autoGrow);

  /* ---------- dates ---------- */
  function renderDates() {
    $('#dates').innerHTML = ev.dates.map((d, i) => `<div class="date-row" data-d="${d.id}">
      <div class="date-row-head">${i === 0 ? '<b>Main date</b>' : `<b>Additional date ${i}</b>`}
        ${i > 0 ? `<button type="button" class="icon-btn sm danger" data-rm-date="${d.id}" title="Remove date">${icon('trash-2')}</button>` : ''}</div>
      <div class="grid-date">
        <label class="field"><span>Date ${i === 0 ? '<b class="req">*</b>' : ''}</span><input class="input" type="date" data-df="date" value="${esc(d.date)}"></label>
        <label class="field"><span>Label <em>optional</em></span><input class="input" data-df="label" value="${esc(d.label || '')}" placeholder="${i === 0 ? 'e.g. Wedding Ceremony' : 'e.g. Roce Ceremony'}"></label>
        <div class="field"><span>Session</span>${sessionSeg('session', d.session)}</div>
        <label class="field"><span>Start <em>optional</em></span><input class="input" type="time" data-df="start" value="${esc(d.start || '')}"></label>
        <label class="field"><span>End <em>optional</em></span><input class="input" type="time" data-df="end" value="${esc(d.end || '')}"></label>
      </div>
    </div>`).join('');
    renderOverlap();
  }
  $('#dates').addEventListener('input', (e) => {
    const row = e.target.closest('[data-d]'); const f = e.target.dataset.df; if (!row || !f) return;
    ev.dates.find((d) => d.id === row.dataset.d)[f] = e.target.value; onChange();
    if (f === 'date') renderOverlap();
  });
  $('#dates').addEventListener('click', (e) => {
    const seg = e.target.closest('.seg-session button');
    if (seg) {
      const d = ev.dates.find((x) => x.id === seg.closest('[data-d]').dataset.d);
      d.session = d.session === seg.dataset.v ? '' : seg.dataset.v;
      seg.parentElement.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.v === d.session));
      onChange(); renderOverlap(); return;
    }
    const rm = e.target.closest('[data-rm-date]');
    if (rm) { ev.dates = ev.dates.filter((d) => d.id !== rm.dataset.rmDate); renderDates(); onChange(); }
  });
  $('#add-date').onclick = () => { ev.dates.push({ id: uid('dt_'), label: '', date: '', session: '', start: '', end: '' }); renderDates(); onChange(); root.querySelector(`[data-d="${ev.dates.at(-1).id}"] input[type=date]`)?.focus(); };

  function renderOverlap() {
    const blocks = [];
    for (const d of ev.dates) {
      if (!d.date) continue;
      const others = eventsOn(d.date).filter(({ ev: o }) => o.id !== editing?.id && o.status !== 'cancelled');
      if (!others.length) continue;
      const same = d.session ? others.filter(({ occ }) => occ.session === d.session || occ.session === 'fullday' || d.session === 'fullday') : [];
      blocks.push(`<div class="callout ${same.length ? 'callout-warn' : 'callout-info'}">${icon(same.length ? 'layers' : 'info')}<div>
        <b>${esc(fmtDateLong(d.date))}</b> already has ${others.length} event${others.length === 1 ? '' : 's'}${same.length ? ` — <b>${same.length} in the same session</b>` : ''}. You can still add this one.
        <ul class="mini-list">${others.map(({ ev: o, occ }) => `<li>${statusBadge(o.status)} ${esc(getClient(o.clientId)?.name || '')} — ${esc(o.title || '')} ${sessionTag(occ.session)}${o.venue ? ` · ${esc(o.venue)}` : ''}</li>`).join('')}</ul></div></div>`);
    }
    $('#overlap').innerHTML = blocks.join('');
  }

  /* ---------- client ---------- */
  function renderClientLink() {
    const box = $('#client-link');
    if (client.id) {
      const n = clientEvents(client.id).filter((e) => e.id !== editing?.id).length;
      box.innerHTML = `<div class="linked">${icon('user')}<div><b>Existing client</b><small>${n ? `${n} other event${n === 1 ? '' : 's'} on record` : 'No other events'} · edits here update the client's profile</small></div>
        ${editing ? '' : `<button type="button" class="btn btn-ghost btn-sm" id="unlink">${icon('x')}<span>New client instead</span></button>`}</div>`;
      $('#unlink')?.addEventListener('click', () => { client = { name: client.name, phone: '', altPhone: '', email: '', address: '' }; fillClient(); renderClientLink(); onChange(); });
    } else box.innerHTML = '';
  }
  function fillClient() {
    $('#c-name').value = client.name || ''; $('#c-phone').value = client.phone || ''; $('#c-alt').value = client.altPhone || '';
    $('#c-email').value = client.email || ''; $('#c-address').value = client.address || '';
    $('#phone-match').innerHTML = '';
  }
  const bindClient = (sel, key) => $(sel).addEventListener('input', (e) => { client[key] = e.target.value; onChange(); });
  bindClient('#c-name', 'name'); bindClient('#c-phone', 'phone'); bindClient('#c-alt', 'altPhone'); bindClient('#c-email', 'email'); bindClient('#c-address', 'address');

  const ac = $('#ac');
  const suggest = () => {
    if (client.id) { ac.hidden = true; return; }
    const q = $('#c-name').value.trim().toLowerCase();
    if (q.length < 2) { ac.hidden = true; return; }
    const hits = store.clients.filter((c) => (c.name || '').toLowerCase().includes(q) || (c.phone || '').replace(/\D/g, '').includes(q.replace(/\D/g, '') || '§')).slice(0, 6);
    if (!hits.length) { ac.hidden = true; return; }
    ac.innerHTML = hits.map((c) => `<button type="button" data-cid="${c.id}">${icon('user')}<span><b>${esc(c.name)}</b><small>${esc(fmtPhone(c.phone))} · ${clientEvents(c.id).length} event(s)</small></span></button>`).join('');
    ac.hidden = false;
  };
  $('#c-name').addEventListener('input', suggest);
  $('#c-name').addEventListener('blur', () => setTimeout(() => (ac.hidden = true), 180));
  ac.addEventListener('mousedown', (e) => {
    const b = e.target.closest('[data-cid]'); if (!b) return;
    e.preventDefault();
    client = clone(getClient(b.dataset.cid)); fillClient(); renderClientLink(); ac.hidden = true; onChange();
    toast(`Using ${client.name}'s saved details`, { type: 'info' });
  });
  const checkPhone = () => {
    const m = findClientByPhone(client.phone, client.id);
    $('#phone-match').innerHTML = m ? `<div class="callout callout-info">${icon('user')}<div>This number belongs to <b>${esc(m.name)}</b> (${clientEvents(m.id).length} event(s)).
      ${editing ? '' : `<button type="button" class="btn btn-secondary btn-sm" id="use-match">Use existing client</button>`}</div></div>` : '';
    $('#use-match')?.addEventListener('click', () => { client = clone(m); fillClient(); renderClientLink(); onChange(); });
  };
  $('#c-phone').addEventListener('input', debounce(checkPhone, 300));

  /* ---------- custom fields ---------- */
  function renderCustom() {
    $('#custom').innerHTML = ev.customFields.map((c) => `<div class="kv-row" data-cf="${c.id}">
      <input class="input" data-cff="label" value="${esc(c.label)}" placeholder="Field (e.g. Bride)">
      <input class="input" data-cff="value" value="${esc(c.value)}" placeholder="Value (e.g. Ms. Divya D'Costa)">
      <button type="button" class="icon-btn sm danger" data-rm-cf="${c.id}" title="Remove">${icon('trash-2')}</button></div>`).join('');
    updateDisplayPlaceholder();
  }
  $('#custom').addEventListener('input', (e) => {
    const r = e.target.closest('[data-cf]'); if (!r) return;
    ev.customFields.find((c) => c.id === r.dataset.cf)[e.target.dataset.cff] = e.target.value; onChange(); updateDisplayPlaceholder();
  });
  $('#custom').addEventListener('click', (e) => { const b = e.target.closest('[data-rm-cf]'); if (b) { ev.customFields = ev.customFields.filter((c) => c.id !== b.dataset.rmCf); renderCustom(); onChange(); } });
  root.querySelectorAll('[data-quick]').forEach((b) => (b.onclick = () => {
    const c = { id: uid('cf_'), label: b.dataset.quick, value: '' }; ev.customFields.push(c); renderCustom(); onChange();
    root.querySelector(`[data-cf="${c.id}"] [data-cff="${c.label ? 'value' : 'label'}"]`)?.focus();
  }));
  function updateDisplayPlaceholder() { $('#e-display').placeholder = `Automatic: ${addressedAs({ ...ev, displayName: '' }, client) || 'client name'}`; }

  /* ---------- event fields ---------- */
  const bindEv = (sel, key) => $(sel).addEventListener('input', (e) => { ev[key] = e.target.value; onChange(); });
  bindEv('#e-title', 'title'); bindEv('#e-venue', 'venue'); bindEv('#e-service', 'service'); bindEv('#e-display', 'displayName'); bindEv('#e-notes', 'notes'); bindEv('#e-qnote', 'quoteNote');

  /* ---------- budget ---------- */
  function renderBudget() {
    $('#l-min').textContent = hasNum(ev.budget.min) ? `${money(ev.budget.min)}${lakhs(ev.budget.min) ? ' · ' + lakhs(ev.budget.min) : ''}` : '';
    $('#l-max').textContent = hasNum(ev.budget.max) ? `${money(ev.budget.max)}${lakhs(ev.budget.max) ? ' · ' + lakhs(ev.budget.max) : ''}` : '';
    const t = budgetText(ev.budget);
    $('#b-prev').innerHTML = t ? `<span>Shown on quotation as</span><b>Approximate Budget</b><strong>${esc(t)}</strong>` : '<span class="muted">Enter an amount, a range, or your own wording.</span>';
    $('#e-qnote').placeholder = defaultNote('quotation', { ...ev, quoteNote: '', clientId: client.id || '' }).replace(/\{clientName\}/, client.name || '');
  }
  const bindB = (sel, key, chk) => $(sel).addEventListener('input', (e) => { ev.budget[key] = chk ? e.target.checked : e.target.value; renderBudget(); onChange(); });
  bindB('#b-min', 'min'); bindB('#b-max', 'max'); bindB('#b-text', 'text'); bindB('#b-disc', 'asDiscussed', true);

  /* ---------- requirements ---------- */
  req = mountReqEditor($('#req'), ev.sections, { onChange: () => onChange(), excludeEventId: editing?.id });

  /* ---------- steps nav ---------- */
  $('#steps').addEventListener('click', (e) => {
    const a = e.target.closest('[data-step]'); if (!a) return; e.preventDefault();
    const t = root.querySelector('#' + a.dataset.step); window.scrollTo({ top: t.getBoundingClientRect().top + window.scrollY - 90, behavior: 'smooth' });
  });
  const io = new IntersectionObserver((entries) => {
    for (const en of entries) if (en.isIntersecting) root.querySelectorAll('#steps a').forEach((a) => a.classList.toggle('on', a.dataset.step === en.target.id));
  }, { rootMargin: '-30% 0px -60% 0px' });
  root.querySelectorAll('.form-card').forEach((c) => io.observe(c));

  /* ---------- local draft (recover after interruptions) ---------- */
  const saveLocal = debounce(() => {
    if (!dirtyFn()) return;
    try { localStorage.setItem(draftKey, JSON.stringify({ at: new Date().toISOString(), ev: { ...ev, sections: req.get() }, client })); } catch { /* storage full */ }
  }, 600);
  function onChange() { saveLocal(); }
  if (!restored) try {
    const d = JSON.parse(localStorage.getItem(draftKey) || 'null');
    if (d && JSON.stringify({ ev: d.ev, client: d.client }) !== snapshotState()) {
      $('#draft-banner').innerHTML = `<div class="callout callout-info">${icon('history')}<div>Unsaved changes from <b>${esc(fmtDateTime(d.at))}</b> were found on this device.
        <button class="btn btn-secondary btn-sm" id="restore">Restore</button> <button class="btn btn-ghost btn-sm" id="discard">Discard</button></div></div>`;
      $('#restore').onclick = () => { sessionStorage.setItem('ra.restore', draftKey); dirtyFn = () => false; window.dispatchEvent(new HashChangeEvent('hashchange')); };
      $('#discard').onclick = () => { localStorage.removeItem(draftKey); $('#draft-banner').innerHTML = ''; };
    }
  } catch { /* ignore */ }

  renderDates(); renderCustom(); renderClientLink(); renderBudget();
  initialState = restored ? '' : snapshotState();
  dirtyFn = () => snapshotState() !== initialState;

  /* ---------- save ---------- */
  function validate(strict) {
    const errs = [];
    if (!client.name?.trim() && !client.phone?.trim()) errs.push(['#c-name', 'Enter the client name or phone number.']);
    if (strict) {
      if (!client.name?.trim()) errs.push(['#c-name', 'Client name is required.']);
      if (String(client.phone || '').replace(/\D/g, '').length < 10) errs.push(['#c-phone', 'Enter a valid WhatsApp / mobile number.']);
      if (!ev.title?.trim()) errs.push(['#e-title', 'Event name is required.']);
      if (!ev.dates[0]?.date) errs.push(['#dates input[type=date]', 'Choose the event date.']);
    } else if (client.phone && String(client.phone).replace(/\D/g, '').length < 10) errs.push(['#c-phone', 'That phone number looks too short.']);
    root.querySelectorAll('.invalid').forEach((n) => n.classList.remove('invalid'));
    if (errs.length) {
      for (const [sel] of errs) root.querySelector(sel)?.classList.add('invalid');
      const first = root.querySelector(errs[0][0]); first?.focus(); first?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      throw new Error(errs[0][1]);
    }
  }
  async function save(strict, then) {
    validate(strict);
    if (!ev.dates[0]?.date) toast('Saved without a date — it will not appear on the calendar until a date is set.', { type: 'warn' });
    const { id: _cid, ...rest } = client;
    const saved = await saveEvent({ ...ev, sections: req.get() }, client.id ? client : rest);
    localStorage.removeItem(draftKey);
    initialState = snapshotState(); dirtyFn = () => false;
    toast(editing ? 'Changes saved' : 'Enquiry saved');
    navigate(`#/events/${saved.id}${then ? `?generate=${then}` : ''}`);
  }
  const wire = (sel, strict, then) => { const b = $(sel); b.onclick = () => busy(b, () => save(strict, then)).catch(toastError); };
  wire('#save-draft', false); wire('#save-draft-2', false);
  wire('#save-quote', true, 'quotation'); wire('#save-quote-2', true, 'quotation');

  // keyboard: Ctrl/Cmd+S saves
  const onKey = (e) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); $('#save-draft').click(); } };
  document.addEventListener('keydown', onKey);

  if (query.get('step')) setTimeout(() => root.querySelector('#s-' + query.get('step'))?.scrollIntoView({ block: 'start' }), 50);
  else if (!editing) setTimeout(() => (ev.dates[0].date ? $('#c-name') : root.querySelector('#dates input[type=date]'))?.focus(), 60);

  return () => { io.disconnect(); document.removeEventListener('keydown', onKey); dirtyFn = () => false; };
}
