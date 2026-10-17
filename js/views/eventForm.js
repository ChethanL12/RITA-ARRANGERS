// New enquiry / edit event form.
// Client information, then one or more events. "Add Another Date" creates a separate event
// (its own date, type, session, venue, requirements, amounts, budget and quotation).

import { icon } from '../icons.js';
import { esc, uid, clone, fmtDateLong, fmtDate, fmtDateTime, fmtPhone, debounce } from '../util.js';
import { SESSIONS, FORM_SESSIONS } from '../models.js';
import {
  store, getEvent, getClient, saveEnquiry, eventsOn, findClientByPhone, clientEvents, budgetText, computeBudget, defaultNote, latestDoc,
  requirementTotals,
} from '../store.js';
import { toast, toastError, busy, confirmDialog, autoGrow, statusBadge, sessionTag } from '../ui.js';
import { mountReqEditor } from './reqEditor.js';

let dirtyFn = () => false;
export const isDirty = () => dirtyFn();
export async function canLeave() {
  if (!dirtyFn()) return true;
  return confirmDialog({ title: 'Leave without saving?', message: 'You have unsaved changes on this form. They are kept as a recoverable draft on this device, but not saved.', confirm: 'Leave', kind: 'danger', icon: 'triangle-alert' });
}

/** Form-side shape of one event */
function toFormEvent(ev) {
  const d = ev?.dates?.[0] || {};
  return {
    key: uid('fe_'), id: ev?.id || '',
    date: d.date || ev?.primaryDate || '', session: FORM_SESSIONS.includes(d.session || ev?.session) ? (d.session || ev?.session) : '',
    title: ev?.title || '', venue: ev?.venue || '', crowd: ev?.crowd || '',
    sections: clone(ev?.sections || []), quoteNote: ev?.quoteNote || '',
    asDiscussed: ev?.budget?.asDiscussed ?? true,
  };
}
function fromFormEvent(fe) {
  const base = fe.id ? clone(getEvent(fe.id)) : {};
  const rest = (base.dates || []).slice(1);   // older records may hold extra dates; keep them untouched
  const firstId = base.dates?.[0]?.id || uid('dt_');
  return {
    ...base, id: fe.id || undefined, title: fe.title.trim(), venue: fe.venue.trim(), crowd: String(fe.crowd || '').trim(), quoteNote: fe.quoteNote,
    dates: [{ id: firstId, label: '', date: fe.date, session: fe.session, start: '', end: '' }, ...rest],
    sections: fe.sections, budget: { ...(base.budget || {}), asDiscussed: fe.asDiscussed },
  };
}

export function render(root, { params, query, navigate }) {
  const editing = params[0] ? getEvent(params[0]) : null;
  if (params[0] && !editing) { root.innerHTML = '<div class="page"><div class="empty"><h3>Event not found</h3></div></div>'; return; }
  const draftKey = `ra.formDraft.${editing?.id || 'new'}`;

  /* ---------- state ---------- */
  let events = [editing ? toFormEvent(editing) : { ...toFormEvent(null), date: query.get('date') || '' }];
  let active = 0;
  let client = editing ? clone(getClient(editing.clientId) || {}) : (query.get('clientId') ? clone(getClient(query.get('clientId')) || {}) : { name: '', phone: '', altPhone: '', email: '', address: '' });

  let restored = null;
  if (sessionStorage.getItem('ra.restore') === draftKey) {
    sessionStorage.removeItem('ra.restore');
    try { restored = JSON.parse(localStorage.getItem(draftKey) || 'null'); } catch { /* ignore */ }
    if (restored?.events?.length) { events = restored.events; client = restored.client || client; }
  }

  let req = null;
  const syncReq = () => { if (req) events[active].sections = req.get(); };
  const snapshotState = () => { syncReq(); return JSON.stringify({ events: events.map(({ key, ...e }) => e), client }); };
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
        <a href="#" data-step="s-client"><span>1</span>Client</a>
        <a href="#" data-step="s-event"><span>2</span>Event Details</a>
        <a href="#" data-step="s-req"><span>3</span>Requirements</a>
        <a href="#" data-step="s-budget"><span>4</span>Budget &amp; Note</a>
      </nav>
      <div class="form-main">
        <section class="card form-card" id="s-client">
          <div class="form-card-head"><span class="step-no">1</span><div><h2>Client Information</h2></div></div>
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

        <div class="event-tabs" id="event-tabs"></div>

        <section class="card form-card" id="s-event">
          <div class="form-card-head"><span class="step-no">2</span><div><h2>Event Details</h2></div><span class="ev-tag" id="tag-event"></span></div>
          <div class="grid-ev">
            <label class="field"><span>Date <b class="req">*</b></span><input class="input" type="date" id="e-date"></label>
            <label class="field"><span>Event type <b class="req">*</b></span><input class="input" id="e-title" list="dl-titles" placeholder="e.g. Wedding Ceremony"></label>
            <div class="field"><span>Session</span><div class="seg seg-dn" id="e-session">${FORM_SESSIONS.map((k) => `<button type="button" data-v="${k}">${SESSIONS[k].label}</button>`).join('')}</div></div>
            <label class="field"><span>Venue</span><input class="input" id="e-venue" list="dl-venues" placeholder="Venue name or location"></label>
            <label class="field"><span>Expected crowd</span><input class="input" id="e-crowd" inputmode="numeric" placeholder="e.g. 500"></label>
          </div>
          <div id="overlap"></div>
          <div class="row-gap">
            <button type="button" class="btn btn-secondary btn-sm" id="add-date">${icon('calendar-plus')}<span>Add Another Date</span></button>
            <button type="button" class="btn btn-ghost btn-sm" id="remove-event" hidden>${icon('trash-2')}<span>Remove this event</span></button>
          </div>
        </section>

        <section class="card form-card" id="s-req">
          <div class="form-card-head"><span class="step-no">3</span><div><h2>Event Requirements</h2></div><span class="ev-tag" id="tag-req"></span></div>
          <div id="req"></div>
        </section>

        <section class="card form-card" id="s-budget">
          <div class="form-card-head"><span class="step-no">4</span><div><h2>Approximate Budget &amp; Note</h2></div><span class="ev-tag" id="tag-budget"></span></div>
          <div class="budget-preview" id="b-prev"></div>
          <label class="check"><input type="checkbox" id="b-disc"><span>Add “(as discussed)”</span></label>
          <label class="field mt"><span>Note <em>leave empty to use the standard note from Settings</em></span>
            <textarea class="input" id="e-qnote" rows="3"></textarea></label>
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
  autoGrow($('#e-qnote'));
  const cur = () => events[active];
  const evLabel = (fe, i) => `${fe.title || `Event ${i + 1}`}${fe.date ? ` · ${fmtDate(fe.date, { weekday: false, year: false })}` : ''}`;

  /* ---------- event tabs (each date = its own event) ---------- */
  function renderTabs() {
    const multi = events.length > 1;
    $('#event-tabs').hidden = !multi;
    $('#event-tabs').innerHTML = multi ? `<span class="et-label">${events.length} separate events — each gets its own quotation</span>
      ${events.map((fe, i) => `<button type="button" class="et ${i === active ? 'on' : ''}" data-tab="${i}"><span class="et-no">${i + 1}</span>${esc(evLabel(fe, i))}</button>`).join('')}` : '';
    const tag = multi ? `Event ${active + 1} of ${events.length}: ${evLabel(cur(), active)}` : '';
    ['#tag-event', '#tag-req', '#tag-budget'].forEach((s) => { $(s).textContent = tag; $(s).hidden = !multi; });
    $('#remove-event').hidden = !(multi && !cur().id);
  }
  function showEvent(i) {
    syncReq();
    active = i;
    const fe = cur();
    $('#e-date').value = fe.date; $('#e-title').value = fe.title; $('#e-venue').value = fe.venue; $('#e-crowd').value = fe.crowd || '';
    root.querySelectorAll('#e-session button').forEach((b) => b.classList.toggle('on', b.dataset.v === fe.session));
    $('#e-qnote').value = fe.quoteNote; $('#b-disc').checked = !!fe.asDiscussed;
    req = mountReqEditor($('#req'), fe.sections, { onChange: () => { renderBudget(); onChange(); } });
    renderTabs(); renderOverlap(); renderBudget();
  }
  $('#event-tabs').addEventListener('click', (e) => { const b = e.target.closest('[data-tab]'); if (b) showEvent(+b.dataset.tab); });
  $('#add-date').onclick = () => {
    syncReq();
    events.push({ ...toFormEvent(null), venue: '' });
    showEvent(events.length - 1); onChange();
    $('#s-event').scrollIntoView({ behavior: 'smooth', block: 'start' });
    setTimeout(() => $('#e-date').focus(), 300);
  };
  $('#remove-event').onclick = async () => {
    const fe = cur();
    const filled = fe.title || fe.date || requirementTotals(req.get()).count;
    if (filled && !(await confirmDialog({ title: 'Remove this event?', message: `“${esc(evLabel(fe, active))}” and its requirements will be removed from this enquiry.`, confirm: 'Remove', kind: 'danger', icon: 'trash-2' }))) return;
    req = null; events.splice(active, 1); showEvent(Math.max(0, active - 1)); onChange();
  };

  /* ---------- event fields ---------- */
  const bindEv = (sel, key, after) => $(sel).addEventListener('input', (e) => { cur()[key] = e.target.value; renderTabs(); after?.(); onChange(); });
  bindEv('#e-date', 'date', renderOverlap); bindEv('#e-title', 'title'); bindEv('#e-venue', 'venue'); bindEv('#e-crowd', 'crowd'); bindEv('#e-qnote', 'quoteNote');
  $('#e-session').addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    cur().session = cur().session === b.dataset.v ? '' : b.dataset.v;
    root.querySelectorAll('#e-session button').forEach((x) => x.classList.toggle('on', x.dataset.v === cur().session));
    renderOverlap(); onChange();
  });
  $('#b-disc').addEventListener('input', (e) => { cur().asDiscussed = e.target.checked; renderBudget(); onChange(); });

  function renderOverlap() {
    const fe = cur();
    const ids = new Set(events.map((x) => x.id).filter(Boolean));
    const others = fe.date ? eventsOn(fe.date).filter(({ ev: o }) => !ids.has(o.id) && o.status !== 'cancelled') : [];
    const siblings = events.filter((x) => x !== fe && x.date && x.date === fe.date);
    if (!others.length && !siblings.length) { $('#overlap').innerHTML = ''; return; }
    const same = fe.session ? others.filter(({ occ }) => occ.session === fe.session || occ.session === 'fullday').length + siblings.filter((x) => x.session === fe.session).length : 0;
    $('#overlap').innerHTML = `<div class="callout ${same ? 'callout-warn' : 'callout-info'}">${icon(same ? 'layers' : 'info')}<div>
      <b>${esc(fmtDateLong(fe.date))}</b> already has ${others.length + siblings.length} event${others.length + siblings.length === 1 ? '' : 's'}${same ? ` — <b>${same} in the same session</b>` : ''}. You can still add this one.
      <ul class="mini-list">${others.map(({ ev: o, occ }) => `<li>${statusBadge(o.status)} ${esc(getClient(o.clientId)?.name || '')} — ${esc(o.title || '')} ${sessionTag(occ.session)}${o.venue ? ` · ${esc(o.venue)}` : ''}</li>`).join('')}</ul></div></div>`;
  }

  /* ---------- budget (calculated from the requirement amounts) ---------- */
  function renderBudget() {
    const sections = req ? req.get() : cur().sections;
    const b = computeBudget(sections, cur().asDiscussed);
    const t = requirementTotals(sections);
    const text = budgetText(b);
    $('#b-prev').innerHTML = text
      ? `<b>Approximate Budget</b><strong>${esc(text)}</strong>${t.priced < t.count ? `<span class="b-note">${icon('info')} Based on ${t.priced} of ${t.count} items — ${t.count - t.priced} item${t.count - t.priced === 1 ? ' has' : 's have'} no amount yet</span>` : ''}`
      : `<span class="muted">Calculated automatically from the amounts entered under Event Requirements.</span>`;
    $('#e-qnote').placeholder = defaultNote('quotation', { title: cur().title, quoteNote: '', clientId: client.id || '', dates: [{ date: cur().date }] }).replace(/\{clientName\}/, client.name || 'the client');
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
    try { syncReq(); localStorage.setItem(draftKey, JSON.stringify({ at: new Date().toISOString(), events, client })); } catch { /* storage full */ }
  }, 600);
  function onChange() { saveLocal(); }

  showEvent(0); renderClientLink();
  if (!restored) try {
    const d = JSON.parse(localStorage.getItem(draftKey) || 'null');
    if (d?.events && JSON.stringify({ events: d.events.map(({ key, ...e }) => e), client: d.client }) !== snapshotState()) {
      $('#draft-banner').innerHTML = `<div class="callout callout-info">${icon('history')}<div>Unsaved changes from <b>${esc(fmtDateTime(d.at))}</b> were found on this device.
        <button class="btn btn-secondary btn-sm" id="restore">Restore</button> <button class="btn btn-ghost btn-sm" id="discard">Discard</button></div></div>`;
      $('#restore').onclick = () => { sessionStorage.setItem('ra.restore', draftKey); dirtyFn = () => false; window.dispatchEvent(new HashChangeEvent('hashchange')); };
      $('#discard').onclick = () => { localStorage.removeItem(draftKey); $('#draft-banner').innerHTML = ''; };
    }
  } catch { /* ignore */ }
  initialState = restored ? '' : snapshotState();
  dirtyFn = () => snapshotState() !== initialState;

  /* ---------- save ---------- */
  function fail(sel, msg, eventIndex) {
    if (eventIndex != null && eventIndex !== active) showEvent(eventIndex);
    root.querySelectorAll('.invalid:not(.req-amt)').forEach((n) => n.classList.remove('invalid'));
    const el = root.querySelector(sel); el?.classList.add('invalid'); el?.focus(); el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    throw new Error(msg);
  }
  function validate(strict) {
    syncReq();
    if (!client.name?.trim() && !client.phone?.trim()) fail('#c-name', 'Enter the client name or phone number.');
    if (client.phone && String(client.phone).replace(/\D/g, '').length < 10) fail('#c-phone', 'Enter a valid WhatsApp / mobile number.');
    if (strict && !client.name?.trim()) fail('#c-name', 'Client name is required.');
    if (strict && !client.phone?.trim()) fail('#c-phone', 'Enter a valid WhatsApp / mobile number.');
    events.forEach((fe, i) => {
      if (strict && !fe.date) fail('#e-date', `Choose the date for event ${i + 1}.`, i);
      if (strict && !fe.title.trim()) fail('#e-title', `Enter the event type for event ${i + 1}.`, i);
      const bad = fe.sections.some((s) => (s.priceMode === 'section'
        ? String(s.amount || '').trim() && requirementTotals([{ priceMode: 'section', amount: s.amount, items: [] }]).priced === 0
        : s.items.some((it) => it.amount && requirementTotals([{ items: [it] }]).priced === 0)));
      if (bad) fail('.req-amt.invalid', `Event ${i + 1}: an amount is not understood. Use a figure like 25000 or a range like 20000-45000.`, i);
    });
  }
  async function save(strict, then) {
    validate(strict);
    if (events.some((fe) => !fe.date)) toast('Saved without a date — it will not appear on the calendar until a date is set.', { type: 'warn' });
    const { id: _cid, ...rest } = client;
    const { client: savedClient, events: saved } = await saveEnquiry(events.map(fromFormEvent), client.id ? client : rest);
    localStorage.removeItem(draftKey);
    initialState = snapshotState(); dirtyFn = () => false;
    const newCount = saved.length - (editing ? 1 : 0);
    toast(saved.length > 1 ? `${saved.length} separate events saved for ${savedClient.name}${then ? ' — open each one to issue its quotation' : ''}` : (editing ? 'Changes saved' : 'Enquiry saved'));
    const main = saved[0];
    if (saved.length > 1 && newCount > 0 && !editing) navigate(`#/clients/${savedClient.id}`);
    else navigate(`#/events/${main.id}${then ? `?generate=${then}` : ''}`);
  }
  const wire = (sel, strict, then) => { const b = $(sel); b.onclick = () => busy(b, () => save(strict, then)).catch(toastError); };
  wire('#save-draft', false); wire('#save-draft-2', false);
  wire('#save-quote', true, 'quotation'); wire('#save-quote-2', true, 'quotation');

  const onKey = (e) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); $('#save-draft').click(); } };
  document.addEventListener('keydown', onKey);

  if (query.get('step')) setTimeout(() => root.querySelector('#s-' + query.get('step'))?.scrollIntoView({ block: 'start' }), 50);
  else if (!editing) setTimeout(() => { if (!root.contains(document.activeElement)) $('#c-name')?.focus(); }, 60);

  return () => { io.disconnect(); document.removeEventListener('keydown', onKey); dirtyFn = () => false; };
}
