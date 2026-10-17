// Client & event details page: everything about one event in one place.

import { icon } from '../icons.js';
import { moneyRange, parseAmount } from '../util.js';
import { esc, uid, clone, fmtDateLong, fmtDate, fmtDateTime, fmtTime, money, num, hasNum, fmtPhone, todayKey, relDays, lakhs } from '../util.js';
import { STATUS, SESSIONS, PAYMENT_METHODS, PAYMENT_KINDS, DOC_TYPES, isConfirmed } from '../models.js';
import {
  store, getEvent, getClient, subscribe, occurrences, eventDocs, latestDoc, eventPayments, eventActivity, financials,
  budgetText, budgetValue, setStatus, eventChecklist, isStale, saveRequirements, savePayment, deletePayment, saveBilling,
  deleteEvent, requirementTotals, sectionTotals, addressedAs, clientEvents, countItems, buildSnapshot, nextVersionInfo, defaultNote, lastDate,
} from '../store.js';
import { statusBadge, bookingBadge, sessionTag, emptyState, modal, confirmDialog, typedDeleteDialog, toast, toastError, busy, autoGrow, h } from '../ui.js';
import { openGenerate, openViewer, openWhatsApp, docRows, bindDocRows, whatsappLink } from '../docs.js';
import { renderPdf } from '../pdf.js';
import { mountReqEditor } from './reqEditor.js';

const TABS = [
  ['overview', 'Overview', 'layout-dashboard'],
  ['requirements', 'Requirements', 'list-checks'],
  ['quotations', 'Quotations', 'file-text'],
  ['confirmation', 'Booking Confirmation', 'file-check'],
  ['bill', 'Payments & Final Bill', 'receipt'],
  ['activity', 'Activity History', 'history'],
];

let editingGuard = () => false;
export const isDirty = () => editingGuard();
export async function canLeave() {
  if (!editingGuard()) return true;
  return confirmDialog({ title: 'Discard unsaved changes?', message: 'You have unsaved edits on this page.', confirm: 'Discard', kind: 'danger', icon: 'triangle-alert' });
}

export function render(root, { params, query, navigate }) {
  const id = params[0];
  let tab = query.get('tab') || 'overview';
  let reqEditing = false; let reqEditor = null;
  let billDraft = null; let billDirty = false;
  editingGuard = () => reqEditing || billDirty;

  const ev = () => getEvent(id);
  if (!ev()) { root.innerHTML = `<div class="page">${emptyState({ icon: 'circle-alert', title: 'Event not found', text: 'It may have been deleted.', action: '<a class="btn btn-primary" href="#/clients">Back to clients</a>' })}</div>`; return; }

  root.innerHTML = `<div class="page detail"><div id="hero"></div>
    <nav class="tabs" id="tabs" role="tablist">${TABS.map(([k, l, ic]) => `<button role="tab" data-tab="${k}">${icon(ic)}<span>${l}</span><i class="tab-count" data-count="${k}"></i></button>`).join('')}</nav>
    <div id="tab-body" class="tab-body"></div></div>`;
  const $ = (s) => root.querySelector(s);

  /* ======================= hero ======================= */
  function hero() {
    const e = ev(); const c = getClient(e.clientId) || {};
    const f = financials(e); const occ = occurrences(e);
    const q = latestDoc(e.id, 'quotation'); const conf = latestDoc(e.id, 'confirmation'); const inv = latestDoc(e.id, 'invoice');
    const confirmed = isConfirmed(e.status);
    $('#hero').innerHTML = `
    <div class="crumbs"><a href="#/clients">Clients &amp; Events</a>${icon('chevron-right')}<a href="#/clients/${c.id}">${esc(c.name || 'Client')}</a>${icon('chevron-right')}<span>${esc(e.title || 'Event')}</span></div>
    <section class="hero card">
      ${e.status === 'cancelled' ? `<div class="hero-banner red">${icon('ban')}<span>This booking was cancelled${e.cancelledAt ? ` on ${esc(fmtDateLong(e.cancelledAt.slice(0, 10)))}` : ''}${e.cancelReason ? ` — ${esc(e.cancelReason)}` : ''}. Records are kept.</span><button class="btn btn-secondary btn-sm" data-act="restore">${icon('rotate-ccw')}<span>Restore booking</span></button></div>` : ''}
      <div class="hero-top">
        <div class="hero-id">
          <div class="hero-badges">${statusBadge(e.status, { size: 'lg' })}${STATUS[e.status].booking !== STATUS[e.status].label && e.status !== 'completed' ? bookingBadge(e.status) : ''}${e.refNo ? `<span class="ref">${icon('stamp')}${esc(e.refNo)}</span>` : ''}</div>
          <h1>${esc(c.name || 'Client')} <span class="sep">—</span> <span class="ev-name">${esc(e.title || 'Untitled event')}</span></h1>
          <div class="hero-meta">
            ${c.phone ? `<span class="meta-phone"><a href="tel:${esc(c.phone)}">${icon('phone')}${esc(fmtPhone(c.phone))}</a><button class="wa-dot" data-act="wa" title="WhatsApp ${esc(c.name)}">${icon('whatsapp')}</button></span>` : `<span class="muted">${icon('phone')}No phone</span>`}
            ${occ.length ? occ.map((o) => `<span>${icon('calendar-days')}${esc(fmtDate(o.date))}${o.label ? ` <em>(${esc(o.label)})</em>` : ''} ${sessionTag(o.session)}${o.start ? `<small>${esc(fmtTime(o.start))}${o.end ? '–' + esc(fmtTime(o.end)) : ''}</small>` : ''}</span>`).join('') : `<span class="muted">${icon('calendar-x')}No date set</span>`}
            ${e.venue ? `<span>${icon('map-pin')}${esc(e.venue)}</span>` : ''}
            ${e.crowd ? `<span>${icon('users')}${esc(e.crowd)} guests</span>` : ''}
          </div>
          ${e.service ? `<p class="hero-service">${icon('sparkles')}<span>${esc(e.service)}</span></p>` : ''}
        </div>
      </div>
    </section>`;
    // tab counts
    const counts = { quotations: eventDocs(e.id, 'quotation').length, confirmation: eventDocs(e.id, 'confirmation').length, bill: eventPayments(e.id).length + eventDocs(e.id, 'invoice').length, requirements: countItems(e) };
    root.querySelectorAll('[data-count]').forEach((n) => { const v = counts[n.dataset.count]; n.textContent = v || ''; n.hidden = !v; });
  }
  const OPEN_ONLY = (e) => ['quoted', 'enquiry'].includes(e.status);

  /* ======================= actions ======================= */
  async function act(a, btn) {
    const e = ev(); const c = getClient(e.clientId) || {};
    switch (a) {
      case 'more': { const m = $('#more-menu'); m.hidden = !m.hidden; return; }
      case 'wa': {
        const docs = [latestDoc(e.id, 'invoice'), latestDoc(e.id, 'confirmation'), latestDoc(e.id, 'quotation')].filter(Boolean);
        if (!docs.length) return openWhatsApp(e.id);
        const body = `<p class="muted">Choose what to send to ${esc(c.name || 'the client')}.</p><div class="pick-list">
          ${docs.map((d) => `<button class="pick pick-btn" data-pick="${d.id}">${icon(DOC_TYPES[d.type].icon)}<span><b>${esc(DOC_TYPES[d.type].label)} — ${esc(d.number)}</b><small>Latest version (V${d.version}) · ${esc(fmtDateTime(d.issuedAt))}</small></span>${icon('chevron-right')}</button>`).join('')}
          <button class="pick pick-btn" data-pick="">${icon('message-circle')}<span><b>Just a message</b><small>Open the chat without a document</small></span>${icon('chevron-right')}</button></div>`;
        const m = modal({ title: 'WhatsApp', icon: 'whatsapp', body, size: 'sm' });
        m.el.querySelectorAll('[data-pick]').forEach((b) => (b.onclick = () => { m.close(); const d = store.documents.find((x) => x.id === b.dataset.pick); openWhatsApp(e.id, d || null); }));
        return;
      }
      case 'edit-req': setTab('requirements'); return startReqEdit();
      case 'gen-quote': return openGenerate('quotation', e.id, { onIssued: () => setTab('quotations') });
      case 'view-quote': { setTab('quotations'); const q = latestDoc(e.id, 'quotation'); if (isStale(q, e)) return openGenerate('quotation', e.id, { onIssued: () => setTab('quotations') }); return openViewer({ doc: q }); }
      case 'gen-conf': {
        setTab('confirmation');
        const conf = latestDoc(e.id, 'confirmation');
        if (conf && !isStale(conf, e)) return openViewer({ doc: conf });
        return openGenerate('confirmation', e.id);
      }
      case 'bill': return setTab('bill');
      case 'advance': return paymentDialog(null, { kind: 'Advance' });
      case 'confirm': {
        const ok = await confirmDialog({ title: 'Confirm this booking?', message: `<b>${esc(c.name)}</b> — ${esc(e.title)}${occurrences(e)[0] ? ` on <b>${esc(fmtDateLong(occurrences(e)[0].date))}</b>` : ''} will be marked <b>Confirmed</b> across the calendar and records.`, confirm: 'Confirm Booking', kind: 'confirm', icon: 'badge-check' });
        if (!ok) return;
        await setStatus(e.id, 'confirmed');
        toast('Booking confirmed', { action: { label: 'Generate confirmation letter', run: () => openGenerate('confirmation', e.id, { onIssued: () => setTab('confirmation') }) } });
        return;
      }
      case 'unconfirm': {
        const ok = await confirmDialog({ title: 'Mark as not confirmed?', message: 'The event stays in the calendar as <b>Not Confirmed</b>. Issued confirmation letters are kept in history.', confirm: 'Mark Not Confirmed', kind: 'secondary', icon: 'hourglass' });
        if (ok) { await setStatus(e.id, latestDoc(e.id, 'quotation') ? 'quoted' : 'enquiry'); toast('Marked as not confirmed', { type: 'info' }); }
        return;
      }
      case 'changes': await setStatus(e.id, 'changes'); toast('Marked as changes requested — edit requirements, then issue a revised quotation.', { type: 'info' }); return;
      case 'complete': await setStatus(e.id, 'completed'); toast('Event marked completed', { action: { label: 'Prepare final bill', run: () => setTab('bill') } }); return;
      case 'reopen': await setStatus(e.id, 'confirmed'); return;
      case 'cancel': {
        const r = await confirmDialog({ title: 'Cancel this booking?', message: 'The event stays on record (shown muted in the calendar). You can restore it later.', confirm: 'Cancel booking', kind: 'danger', icon: 'ban', input: { label: 'Reason (optional)', placeholder: 'e.g. Date changed by client' } });
        if (r) { await setStatus(e.id, 'cancelled', { reason: r.value }); toast('Booking cancelled', { type: 'info' }); }
        return;
      }
      case 'restore': await setStatus(e.id, isConfirmed(e.confirmedAt ? 'confirmed' : '') ? 'confirmed' : (latestDoc(e.id, 'quotation') ? 'quoted' : 'enquiry')); toast('Booking restored'); return;
      case 'delete': {
        const docs = eventDocs(e.id).length; const pays = eventPayments(e.id).length;
        const others = clientEvents(e.clientId).filter((x) => x.id !== e.id).length;
        const r = await typedDeleteDialog({
          title: 'Delete this booking permanently?',
          message: `<b>${esc(c.name || 'Client')} — ${esc(e.title || 'Event')}</b> will be removed for good from the app and the Google Sheet: requirements${docs ? `, ${docs} issued document${docs === 1 ? '' : 's'}` : ''}${pays ? `, ${pays} payment record${pays === 1 ? '' : 's'}` : ''} and history. This cannot be undone.${others ? `<br><br>The client's contact details are kept because they have ${others} other event${others === 1 ? '' : 's'}.` : ''}`,
          checkbox: others ? null : { label: `Also delete ${esc(c.name || 'the client')}'s contact details (name, phone, email, address)`, checked: true },
        });
        if (!r) return;
        editingGuard = () => false;
        await deleteEvent(e.id, { withClient: r.checked });
        toast(r.checked ? 'Booking and client details deleted' : 'Booking deleted', { type: 'info' });
        navigate(r.checked ? '#/clients' : `#/clients/${e.clientId}`);
        return;
      }
    }
  }
  root.addEventListener('click', (e) => {
    const b = e.target.closest('[data-act]');
    if (!b) { const m = $('#more-menu'); if (m && !e.target.closest('.menu-wrap')) m.hidden = true; return; }
    if (b.dataset.act !== 'more') { const m = $('#more-menu'); if (m) m.hidden = true; }
    busy(b, () => act(b.dataset.act, b)).catch(toastError);
  });

  /* ======================= tabs ======================= */
  async function setTab(t) {
    if (t === tab && $('#tab-body').childElementCount) return;
    if (tab === 'requirements' && reqEditing && t !== 'requirements') {
      if (!(await confirmDialog({ title: 'Discard requirement edits?', message: 'Your unsaved changes to the requirements will be lost.', confirm: 'Discard', kind: 'danger' }))) return;
      reqEditing = false;
    }
    if (tab === 'bill' && billDirty && t !== 'bill') {
      if (!(await confirmDialog({ title: 'Discard bill changes?', message: 'Your unsaved final bill changes will be lost.', confirm: 'Discard', kind: 'danger' }))) return;
      billDirty = false; billDraft = null;
    }
    tab = t;
    history.replaceState(null, '', `#/events/${id}${t === 'overview' ? '' : `?tab=${t}`}`);
    paintTab();
  }
  $('#tabs').onclick = (e) => { const b = e.target.closest('[data-tab]'); if (b) setTab(b.dataset.tab); };

  function paintTab() {
    root.querySelectorAll('[data-tab]').forEach((b) => b.classList.toggle('on', b.dataset.tab === tab));
    const host = $('#tab-body');
    // fresh container per paint so per-tab listeners never accumulate
    const body = document.createElement('div');
    host.replaceChildren(body);
    const fn = { overview, requirements, quotations, confirmation, bill, activity }[tab];
    fn(body);
  }

  /* ---------- overview ---------- */
  function overview(body) {
    const e = ev(); const c = getClient(e.clientId) || {}; const f = financials(e);
    const steps = ['enquiry', 'quoted', 'confirmed', 'completed'];
    const cur = e.status === 'changes' ? 'quoted' : e.status;
    const ci = steps.indexOf(cur);
    const list = eventChecklist(e);
    const pct = f.hasAgreed && f.total > 0 ? Math.min(100, Math.round((f.received / f.total) * 100)) : (f.reference ? Math.min(100, Math.round((f.received / f.reference) * 100)) : 0);
    const others = clientEvents(c.id).filter((x) => x.id !== e.id);
    body.innerHTML = `<div class="ov-grid">
      <div class="ov-main">
        <div class="card">
          <div class="card-head"><h3>${icon('circle-dot')} Booking status</h3>${statusBadge(e.status)}</div>
          <ol class="pipeline ${e.status === 'cancelled' ? 'is-cancelled' : ''}">${steps.map((s, i) => `<li class="${i < ci ? 'done' : ''} ${i === ci ? 'cur' : ''}"><span>${icon(i < ci ? 'check' : STATUS[s].icon)}</span><b>${s === 'quoted' && e.status === 'changes' ? 'Changes Requested' : STATUS[s].label}</b></li>`).join('')}</ol>
          ${moreActions(e, c)}
          ${e.status !== 'cancelled' ? `<div class="booking-toggle">
            <button class="bt ${!isConfirmed(e.status) ? 'on amber' : ''}" data-act="${isConfirmed(e.status) ? 'unconfirm' : ''}">${icon('hourglass')}<span><b>NOT CONFIRMED</b><small>Enquiry / quotation stage</small></span></button>
            <button class="bt ${isConfirmed(e.status) ? 'on green' : ''}" data-act="${isConfirmed(e.status) ? '' : 'confirm'}">${icon('badge-check')}<span><b>CONFIRM BOOKING</b><small>${e.confirmedAt && isConfirmed(e.status) ? 'Confirmed ' + esc(fmtDateTime(e.confirmedAt)) : 'Client agreed to proceed'}</small></span></button>
          </div>` : ''}
        </div>
        <div class="card">
          <div class="card-head"><h3>${icon('list-checks')} Documents &amp; tasks</h3></div>
          <ul class="checklist">${list.map((i) => `<li class="${i.done ? 'done' : ''} ${i.stale ? 'stale' : ''} ${i.disabled ? 'disabled' : ''}">
            <span class="ck">${icon(i.done ? (i.stale ? 'triangle-alert' : 'check') : 'circle-dot')}</span>
            <span class="ck-main"><b>${esc(i.label)}</b><small>${esc(i.detail || '')}${i.stale ? ' · details changed since this was issued' : ''}</small></span>
            ${taskButton(i, e)}</li>`).join('')}</ul>
        </div>
        <div class="card">
          <div class="card-head"><h3>${icon('calendar-days')} Event details</h3><a class="btn btn-ghost btn-sm" href="#/events/${e.id}/edit">${icon('pencil')}<span>Edit</span></a></div>
          <dl class="kv">
            <dt>Event</dt><dd>${esc(e.title || '—')}</dd>
            ${occurrences(e).map((o, i) => `<dt>${esc(o.label || (occurrences(e).length > 1 ? `Date ${i + 1}` : 'Date'))}</dt><dd>${esc(fmtDateLong(o.date))} ${sessionTag(o.session)} ${o.start ? `<span class="muted">${esc(fmtTime(o.start))}${o.end ? ' – ' + esc(fmtTime(o.end)) : ''}</span>` : ''} <span class="muted">· ${esc(relDays(o.date))}</span></dd>`).join('')}
            ${(e.customFields || []).map((cf) => `<dt>${esc(cf.label)}</dt><dd>${esc(cf.value)}</dd>`).join('')}
            <dt>Venue</dt><dd>${esc(e.venue || '—')}</dd>
            ${e.crowd ? `<dt>Expected crowd</dt><dd>${esc(e.crowd)}</dd>` : ''}
            ${e.service ? `<dt>Service</dt><dd>${esc(e.service)}</dd>` : ''}
            ${e.notes ? `<dt>Notes</dt><dd class="pre">${esc(e.notes)}</dd>` : ''}
          </dl>
        </div>
      </div>
      <div class="ov-side">
        <div class="card money-card">
          <div class="card-head"><h3>${icon('wallet')} Payments</h3><button class="btn btn-primary btn-sm" id="ov-pay">${icon('plus')}<span>Record advance / payment</span></button></div>
          <div class="money-rows">
            <div><span>${f.hasAgreed ? 'Final amount' : 'Approximate budget'}</span><b>${f.hasAgreed ? money(f.total) : esc(budgetText(e.budget) || '—')}</b></div>
            <div><span>Received</span><b class="green">${money(f.received)}</b></div>
            <div class="big"><span>${f.balance < 0 ? 'Excess received' : 'Outstanding'}</span><b class="${f.balance > 0 ? 'amber' : ''}">${f.hasAgreed || f.reference ? money(Math.abs(f.balance)) : '—'}</b></div>
          </div>
          <div class="progress"><i style="width:${pct}%"></i></div>
          <p class="muted small">${f.payStatus}${!f.hasAgreed && f.reference ? ' · measured against the approximate budget until the final amount is set' : ''}</p>
          ${f.payments.length ? `<ul class="pay-mini">${f.payments.slice(-4).reverse().map((p) => `<li><span>${esc(fmtDate(p.date, { weekday: false }))} · ${esc(p.method)}</span><b>${money(p.amount)}</b></li>`).join('')}</ul>` : ''}
        </div>
        <div class="card">
          <div class="card-head"><h3>${icon('user')} Client</h3><a class="btn btn-ghost btn-sm" href="#/clients/${c.id}">Profile</a></div>
          <div class="client-mini">
            <b>${esc(c.name || '—')}</b>
            ${c.phone ? `<a href="${esc(whatsappLink(c.phone, ''))}" target="_blank" rel="noopener" class="wa-link">${icon('whatsapp')}${esc(fmtPhone(c.phone))}</a>` : ''}
            ${c.altPhone ? `<a href="tel:${esc(c.altPhone)}">${icon('phone')}${esc(fmtPhone(c.altPhone))}</a>` : ''}
            ${c.email ? `<a href="mailto:${esc(c.email)}">${icon('mail')}${esc(c.email)}</a>` : ''}
            ${c.address ? `<span>${icon('map-pin')}${esc(c.address)}</span>` : ''}
          </div>
          ${others.length ? `<div class="sub-head"><h4>Other events</h4></div><div class="lines">${others.map((o) => `<a class="line-item compact" href="#/events/${o.id}"><span class="li-main"><b>${esc(o.title || 'Event')}</b><small>${esc(fmtDate(o.primaryDate))}</small></span>${statusBadge(o.status)}</a>`).join('')}</div>` : ''}
          <a class="btn btn-ghost btn-sm btn-block mt" href="#/events/new?clientId=${c.id}">${icon('calendar-plus')}<span>New event for this client</span></a>
        </div>
        <div class="card">
          <div class="card-head"><h3>${icon('files')} Latest documents</h3></div>
          ${['quotation', 'confirmation', 'invoice'].map((t) => latestDoc(e.id, t)).filter(Boolean).length
            ? docRows(['quotation', 'confirmation', 'invoice'].map((t) => latestDoc(e.id, t)).filter(Boolean))
            : '<p class="muted small">No documents issued yet.</p>'}
        </div>
      </div>
    </div>`;
    bindDocRows(body);
    body.querySelector('#ov-pay').onclick = () => paymentDialog();
    body.querySelectorAll('[data-task]').forEach((b) => (b.onclick = (x) => { x.stopPropagation(); busy(b, () => runTask(b.dataset.task)).catch(toastError); }));
  }
  function moreActions(e, c) {
    return `<div class="more-actions">
      ${OPEN_ONLY(e) && latestDoc(e.id, 'quotation') ? `<button class="btn btn-ghost btn-sm" data-act="changes">${icon('pen-line')}<span>Changes requested</span></button>` : ''}
      ${e.status === 'confirmed' ? `<button class="btn btn-ghost btn-sm" data-act="complete">${icon('flag')}<span>Mark completed</span></button>` : ''}
      ${e.status === 'completed' ? `<button class="btn btn-ghost btn-sm" data-act="reopen">${icon('rotate-ccw')}<span>Re-open</span></button>` : ''}
      <a class="btn btn-ghost btn-sm" href="#/events/${e.id}/edit">${icon('square-pen')}<span>Edit details</span></a>
      <a class="btn btn-ghost btn-sm" href="#/events/new?clientId=${c.id}">${icon('calendar-plus')}<span>New event for client</span></a>
      ${e.status !== 'cancelled' ? `<button class="btn btn-ghost btn-sm danger-text" data-act="cancel">${icon('ban')}<span>Cancel booking</span></button>` : ''}
      <button class="btn btn-ghost btn-sm danger-text" data-act="delete">${icon('trash-2')}<span>Delete</span></button>
    </div>`;
  }
  function taskButton(i, e) {
    const map = {
      quote: !i.done || i.stale ? ['gen-quote', i.done ? 'Revise' : 'Generate'] : null,
      confirm: !i.done && e.status !== 'cancelled' ? ['confirm', 'Confirm'] : null,
      letter: isConfirmed(e.status) && (!i.done || i.stale) ? ['gen-conf', i.done ? 'Revise' : 'Generate'] : null,
      advance: ['pay', 'Record'],
      complete: e.status === 'confirmed' ? ['complete', 'Mark done'] : null,
      invoice: !i.done || i.stale ? ['bill', i.done ? 'Revise' : 'Prepare'] : null,
      paid: null,
    }[i.key];
    return map ? `<button class="btn btn-ghost btn-sm" data-task="${map[0]}">${esc(map[1])}</button>` : '';
  }
  function runTask(t) {
    if (t === 'pay') return paymentDialog();
    return act(t);
  }

  /* ---------- requirements ---------- */
  function requirements(body) {
    const e = ev();
    if (reqEditing) {
      body.innerHTML = `<div class="card"><div class="card-head"><h3>${icon('square-pen')} Editing requirements</h3>
        <div class="row-gap"><button class="btn btn-ghost" id="req-cancel">Cancel</button><button class="btn btn-secondary" id="req-save">${icon('save')}<span>Save</span></button><button class="btn btn-primary" id="req-save-quote">${icon('file-text')}<span>Save &amp; ${latestDoc(e.id, 'quotation') ? 'revise' : 'generate'} quotation</span></button></div></div>
        <div class="budget-preview" id="req-budget"></div>
        <div id="req-ed"></div></div>`;
      const paintBudget = () => {
        const t = requirementTotals(reqEditor ? reqEditor.get() : e.sections);
        body.querySelector('#req-budget').innerHTML = t.priced ? `<b>Approximate Budget</b><strong>${esc(moneyRange(t.min, t.max))}${e.budget?.asDiscussed ? ' (as discussed)' : ''}</strong>${t.priced < t.count ? `<span class="b-note">${icon('info')} Based on ${t.priced} of ${t.count} items</span>` : ''}` : '<span class="muted">The approximate budget is calculated from the item amounts.</span>';
      };
      reqEditor = null;
      reqEditor = mountReqEditor(body.querySelector('#req-ed'), e.sections || [], { onChange: paintBudget });
      paintBudget();
      body.querySelector('#req-cancel').onclick = () => { reqEditing = false; paintTab(); };
      const save = async (thenQuote) => {
        await saveRequirements(e.id, reqEditor.get());
        reqEditing = false; toast('Requirements saved');
        paintTab();
        if (thenQuote) openGenerate('quotation', e.id, { onIssued: () => setTab('quotations') });
        else if (latestDoc(e.id, 'quotation') && isStale(latestDoc(e.id, 'quotation'), ev())) toast('The issued quotation no longer matches — generate a revised version when ready.', { type: 'info', action: { label: 'Revise now', run: () => openGenerate('quotation', e.id, { onIssued: () => setTab('quotations') }) } });
      };
      const sb = body.querySelector('#req-save'); sb.onclick = () => busy(sb, () => save(false)).catch(toastError);
      const sq = body.querySelector('#req-save-quote'); sq.onclick = () => busy(sq, () => save(true)).catch(toastError);
      return;
    }
    const secs = (e.sections || []).filter((s) => s.items?.length || s.amount);
    body.innerHTML = `<div class="card">
      <div class="card-head"><h3>${icon('list-checks')} Requirements <span class="muted">${countItems(e)} items · ${secs.length} sections</span></h3>
        <button class="btn btn-primary" id="req-edit">${icon('square-pen')}<span>Edit Requirements</span></button></div>
      ${secs.length ? secs.map((s) => `<div class="req-view"><h4>${esc(s.title || 'Untitled section')}</h4>
        <table class="tbl"><thead><tr><th class="no">No.</th><th>Description of Services and Items</th><th>Remarks</th><th class="amt">Amount</th></tr></thead>
        <tbody>${s.items.map((it, i) => { const a = s.priceMode === 'section' ? null : parseAmount(it.amount); return `<tr><td class="no">${i + 1}</td><td class="pre">${esc(it.description)}</td><td class="pre muted-dash">${esc(it.remarks || '-')}</td><td class="amt">${a ? esc(moneyRange(a.min, a.max)) : ''}</td></tr>`; }).join('')}
        ${sectionTotals(s).priced ? `<tr class="tot"><td colspan="3">Section total</td><td class="amt">${esc(moneyRange(sectionTotals(s).min, sectionTotals(s).max))}</td></tr>` : ''}</tbody></table></div>`).join('')
        : emptyState({ icon: 'list-checks', title: 'No requirements yet', text: 'Add sections like Venue Part or Church Arrangements and list every item.', action: '<button class="btn btn-primary" id="req-edit-2">Add requirements</button>' })}
      ${budgetText(e.budget) ? `<div class="budget-preview"><b>Approximate Budget</b><strong>${esc(budgetText(e.budget))}</strong></div>` : ''}
    </div>`;
    const go = () => startReqEdit();
    body.querySelector('#req-edit').onclick = go;
    body.querySelector('#req-edit-2')?.addEventListener('click', go);
  }
  function startReqEdit() { reqEditing = true; paintTab(); }

  /* ---------- quotations ---------- */
  function quotations(body) {
    const e = ev(); const docs = eventDocs(e.id, 'quotation'); const latest = docs[0];
    const stale = latest && isStale(latest, e);
    body.innerHTML = `<div class="card">
      <div class="card-head"><h3>${icon('file-text')} Quotations</h3>
        <div class="row-gap">${OPEN_ONLY(e) && latest ? `<button class="btn btn-ghost" data-act="changes">${icon('pen-line')}<span>Client requested changes</span></button>` : ''}
        <button class="btn btn-ghost" data-act="edit-req">${icon('list-checks')}<span>Edit requirements</span></button>
        <button class="btn btn-primary" id="q-gen">${icon(latest ? 'refresh-cw' : 'file-plus')}<span>${latest ? 'Generate revised quotation' : 'Generate quotation'}</span></button></div></div>
      ${stale ? `<div class="callout callout-warn">${icon('triangle-alert')}<div>The event details or requirements were changed after <b>${esc(latest.number)}</b> (V${latest.version}) was issued. Generate a revised quotation so the client receives the latest version.</div></div>` : ''}
      ${docs.length ? docRows(docs) : emptyState({ icon: 'file-text', title: 'No quotation yet', text: 'Generate a quotation from the saved requirements and approximate budget.' })}
      <p class="hint">${icon('shield-check')} Every issued version is stored permanently. A PDF already sent cannot change — revisions are issued as new versions (V2, V3…) and the latest is marked.</p>
    </div>`;
    bindDocRows(body);
    body.querySelector('#q-gen').onclick = () => openGenerate('quotation', e.id);
  }

  /* ---------- confirmation ---------- */
  function confirmation(body) {
    const e = ev(); const docs = eventDocs(e.id, 'confirmation'); const latest = docs[0];
    const confirmed = isConfirmed(e.status);
    body.innerHTML = `<div class="card">
      <div class="card-head"><h3>${icon('file-check')} Booking confirmation letters</h3>
        ${confirmed ? `<button class="btn btn-primary" id="c-gen">${icon(latest ? 'refresh-cw' : 'file-plus')}<span>${latest ? 'Generate revised letter' : 'Generate Booking Confirmation'}</span></button>` : ''}</div>
      ${!confirmed ? `<div class="callout callout-warn">${icon('hourglass')}<div>This booking is <b>${esc(STATUS[e.status].booking)}</b>. A confirmation letter can only be issued after you click <b>Confirm Booking</b> — it always states CONFIRMED.
        ${e.status !== 'cancelled' ? '<div class="mt"><button class="btn btn-confirm btn-sm" data-act="confirm">Confirm Booking</button></div>' : ''}</div></div>` : ''}
      ${latest && isStale(latest, e) ? `<div class="callout callout-warn">${icon('triangle-alert')}<div>Dates or details changed after ${esc(latest.number)} was issued — generate a revised confirmation letter.</div></div>` : ''}
      ${docs.length ? docRows(docs) : (confirmed ? emptyState({ icon: 'file-check', title: 'Ready to confirm in writing', text: 'All client and event details are filled in automatically from this event.' }) : '')}
    </div>`;
    bindDocRows(body);
    body.querySelector('#c-gen')?.addEventListener('click', () => openGenerate('confirmation', e.id));
  }

  /* ---------- final bill & payments ---------- */
  function bill(body) {
    const e = ev(); const s = store.settings;
    if (!billDraft) {
      billDraft = clone(e.billing || {});
      billDraft.charges ||= []; billDraft.discounts ||= [];
      if (billDraft.showPayments === undefined) billDraft.showPayments = true;
      if (billDraft.includeScope === undefined) billDraft.includeScope = true;
      if (billDraft.applyTax === undefined) billDraft.applyTax = !!s.taxEnabled;
      billDraft.taxLabel ||= s.taxLabel; billDraft.taxRate ??= s.taxRate;
    }
    const bv = budgetValue(e.budget);
    body.innerHTML = `<div class="bill-grid">
      <div class="card">
        <div class="card-head"><h3>${icon('receipt')} Final bill</h3><span class="muted small" id="bill-state"></span></div>
        <label class="field"><span>Final agreed amount ${icon('indian-rupee')} <b class="req">*</b></span>
          <div class="input-row"><input class="input input-lg" id="bl-agreed" inputmode="decimal" value="${esc(billDraft.agreedAmount ?? '')}" placeholder="e.g. 875000">
          ${bv ? `<button class="btn btn-ghost btn-sm" id="use-budget" type="button">Use ${money(bv)}</button>` : ''}</div>
          <small class="lakh" id="bl-words"></small></label>
        <div class="sub-head"><h4>Approved additional charges</h4><button class="btn btn-ghost btn-sm" data-add="charges">${icon('plus')}<span>Add charge</span></button></div>
        <div id="bl-charges"></div>
        <div class="sub-head"><h4>Discounts</h4><button class="btn btn-ghost btn-sm" data-add="discounts">${icon('plus')}<span>Add discount</span></button></div>
        <div id="bl-discounts"></div>
        <div class="grid-3 mt">
          <label class="check"><input type="checkbox" id="bl-tax" ${billDraft.applyTax ? 'checked' : ''}><span>Apply tax</span></label>
          <label class="field"><span>Tax label</span><input class="input" id="bl-taxlabel" value="${esc(billDraft.taxLabel || '')}" ${billDraft.applyTax ? '' : 'disabled'}></label>
          <label class="field"><span>Rate %</span><input class="input" id="bl-taxrate" inputmode="decimal" value="${esc(billDraft.taxRate ?? '')}" ${billDraft.applyTax ? '' : 'disabled'}></label>
        </div>
        <div class="grid-2">
          <label class="field"><span>Payment due date <em>optional</em></span><input class="input" type="date" id="bl-due" value="${esc(billDraft.dueDate || '')}"></label>
          <label class="field"><span>Payment remarks <em>optional</em></span><input class="input" id="bl-remarks" value="${esc(billDraft.remarks || '')}" placeholder="e.g. Balance to be paid by bank transfer"></label>
        </div>
        <label class="check"><input type="checkbox" id="bl-scope" ${billDraft.includeScope ? 'checked' : ''}><span>Include the requirements (scope of services) in the invoice</span></label>
        <label class="check"><input type="checkbox" id="bl-showpay" ${billDraft.showPayments ? 'checked' : ''}><span>List payments received on the invoice</span></label>
        <label class="field mt"><span>Final billing note / payment terms <em>leave empty for the standard terms from Settings</em></span>
          <textarea class="input" id="bl-terms" rows="3" placeholder="${esc(defaultNote('invoice', { ...e, billing: { ...billDraft, terms: '' } }))}">${esc(billDraft.terms || '')}</textarea></label>
        <div class="form-actions left">
          <button class="btn btn-secondary" id="bl-save">${icon('save')}<span>Save draft</span></button>
          <button class="btn btn-ghost" id="bl-preview">${icon('eye')}<span>Preview</span></button>
          <button class="btn btn-primary" id="bl-issue">${icon('stamp')}<span>${latestDoc(e.id, 'invoice') ? 'Issue revised invoice' : 'Issue final invoice'}</span></button>
        </div>
      </div>
      <div class="bill-side">
        <div class="card summary-card" id="bl-summary"></div>
        <div class="card"><div class="card-head"><h3>${icon('wallet')} Payments received</h3><button class="btn btn-primary btn-sm" id="pay-add">${icon('plus')}<span>Record advance / payment</span></button></div><div id="pay-list"></div></div>
        <div class="card"><div class="card-head"><h3>${icon('files')} Issued invoices</h3></div><div id="inv-list"></div></div>
      </div>
    </div>`;
    const $b = (q) => body.querySelector(q);
    autoGrow($b('#bl-terms'));

    const rowList = (key) => {
      $b('#bl-' + key).innerHTML = billDraft[key].length ? billDraft[key].map((r) => `<div class="kv-row" data-row="${r.id}" data-key="${key}">
        <input class="input" data-rf="label" value="${esc(r.label || '')}" placeholder="${key === 'charges' ? 'e.g. Extra 200 chairs' : 'e.g. Loyalty discount'}">
        <input class="input amt" data-rf="amount" inputmode="decimal" value="${esc(r.amount ?? '')}" placeholder="Amount">
        <button class="icon-btn sm danger" data-rm="${r.id}" type="button">${icon('trash-2')}</button></div>`).join('') : `<p class="muted small">None</p>`;
    };
    const markDirty = () => { billDirty = true; $b('#bill-state').textContent = 'Unsaved changes'; summary(); };
    rowList('charges'); rowList('discounts');

    body.addEventListener('input', (x) => {
      const t = x.target;
      const row = t.closest('[data-row]');
      if (row) { billDraft[row.dataset.key].find((r) => r.id === row.dataset.row)[t.dataset.rf] = t.value; return markDirty(); }
      const map = { 'bl-agreed': 'agreedAmount', 'bl-taxlabel': 'taxLabel', 'bl-taxrate': 'taxRate', 'bl-due': 'dueDate', 'bl-remarks': 'remarks', 'bl-terms': 'terms' };
      const chk = { 'bl-tax': 'applyTax', 'bl-scope': 'includeScope', 'bl-showpay': 'showPayments' };
      if (map[t.id]) { billDraft[map[t.id]] = t.value; markDirty(); }
      if (chk[t.id]) {
        billDraft[chk[t.id]] = t.checked; markDirty();
        if (t.id === 'bl-tax') { $b('#bl-taxlabel').disabled = !t.checked; $b('#bl-taxrate').disabled = !t.checked; }
      }
    });
    body.addEventListener('click', (x) => {
      const add = x.target.closest('[data-add]');
      if (add) { billDraft[add.dataset.add].push({ id: uid('r_'), label: '', amount: '' }); rowList(add.dataset.add); markDirty(); body.querySelector(`[data-key="${add.dataset.add}"]:last-child input`)?.focus(); return; }
      const rm = x.target.closest('[data-rm]');
      if (rm) { const key = rm.closest('[data-key]').dataset.key; billDraft[key] = billDraft[key].filter((r) => r.id !== rm.dataset.rm); rowList(key); markDirty(); }
    });
    $b('#use-budget')?.addEventListener('click', () => { $b('#bl-agreed').value = bv; billDraft.agreedAmount = String(bv); markDirty(); });

    function summary() {
      const f = financials({ ...ev(), billing: billDraft });
      $b('#bl-words').textContent = hasNum(billDraft.agreedAmount) ? `${money(billDraft.agreedAmount)}${lakhs(billDraft.agreedAmount) ? ' · ' + lakhs(billDraft.agreedAmount) : ''}` : '';
      const bal = f.total - f.received;
      $b('#bl-summary').innerHTML = `<div class="card-head"><h3>${icon('banknote')} Summary</h3><span class="badge ${bal <= 0 && f.hasAgreed ? 'tone-green' : f.received ? 'tone-amber' : 'tone-draft'}">${f.hasAgreed ? (bal <= 0 ? (bal < 0 ? 'Overpaid' : 'Paid in full') : f.received ? 'Partially paid' : 'Unpaid') : 'Draft'}</span></div>
        <div class="sum-rows">
          <div><span>Agreed amount</span><b>${money(f.agreed)}</b></div>
          ${f.charges.map((c) => `<div><span>+ ${esc(c.label || 'Additional charge')}</span><b>${money(c.amount)}</b></div>`).join('')}
          ${f.discounts.map((c) => `<div class="green"><span>– ${esc(c.label || 'Discount')}</span><b>– ${money(c.amount)}</b></div>`).join('')}
          ${f.applyTax ? `<div><span>${esc(f.taxLabel || 'Tax')} @ ${num(f.taxRate)}%</span><b>${money(f.tax)}</b></div>` : ''}
          <div class="total"><span>Total amount</span><b>${money(f.total)}</b></div>
          <div><span>Payments received</span><b class="green">– ${money(f.received)}</b></div>
          <div class="balance"><span>${bal < 0 ? 'Excess received' : 'Balance payable'}</span><b>${money(Math.abs(bal))}</b></div>
        </div>`;
    }
    function lists() {
      const pays = eventPayments(e.id);
      $b('#pay-list').innerHTML = pays.length ? `<div class="pay-list">${pays.map((p) => `<div class="pay-row" data-pay="${p.id}">
        <span class="pay-ic">${icon('banknote')}</span>
        <span class="pay-main"><b>${money(p.amount)}</b><small>${esc(p.kind || 'Payment')} · ${esc(fmtDateLong(p.date))} · ${esc(p.method)}${p.reference ? ' · ' + esc(p.reference) : ''}</small>${p.notes ? `<small>${esc(p.notes)}</small>` : ''}</span>
        <button class="icon-btn sm" data-pay-edit="${p.id}" title="Edit">${icon('pencil')}</button>
        <button class="icon-btn sm danger" data-pay-del="${p.id}" title="Delete">${icon('trash-2')}</button></div>`).join('')}
        <div class="pay-total"><span>Total received</span><b>${money(financials(ev()).received)}</b></div></div>` : '<p class="muted small">No payments recorded yet. Record advances as they arrive — the balance updates automatically.</p>';
      body.querySelectorAll('[data-pay-edit]').forEach((b) => (b.onclick = () => paymentDialog(store.payments.find((p) => p.id === b.dataset.payEdit))));
      body.querySelectorAll('[data-pay-del]').forEach((b) => (b.onclick = async () => {
        const p = store.payments.find((x) => x.id === b.dataset.payDel);
        if (await confirmDialog({ title: 'Delete payment?', message: `${money(p.amount)} received on ${esc(fmtDateLong(p.date))} (${esc(p.method)}) will be removed. This is logged in the activity history.`, confirm: 'Delete', kind: 'danger', icon: 'trash-2' })) {
          await deletePayment(p.id).catch(toastError); toast('Payment deleted', { type: 'info' });
        }
      }));
      const inv = eventDocs(e.id, 'invoice');
      $b('#inv-list').innerHTML = inv.length ? docRows(inv) : '<p class="muted small">No invoice issued yet. Save the draft any time; issue when the bill is final.</p>';
      bindDocRows($b('#inv-list'));
      summary();
    }
    bill.refresh = lists;
    lists(); $b('#bill-state').textContent = e.billing ? 'Saved' : 'Not saved yet';

    const saveDraft = async () => { await saveBilling(e.id, billDraft); billDirty = false; $b('#bill-state').textContent = 'Saved'; };
    const sv = $b('#bl-save'); sv.onclick = () => busy(sv, async () => { await saveDraft(); toast('Final bill draft saved'); }).catch(toastError);
    const pv = $b('#bl-preview'); pv.onclick = () => busy(pv, async () => {
      const tmp = { ...ev(), billing: billDraft };
      const info = nextVersionInfo('invoice', tmp);
      const snap = buildSnapshot('invoice', tmp, { number: info.number, version: info.version, note: defaultNote('invoice', tmp), preview: true });
      await openViewer({ blob: await renderPdf(snap), title: 'Preview — Final Invoice', fileName: 'invoice-preview.pdf', preview: true });
    }).catch(toastError);
    const is = $b('#bl-issue'); is.onclick = () => busy(is, async () => {
      if (!hasNum(billDraft.agreedAmount)) { $b('#bl-agreed').classList.add('invalid'); $b('#bl-agreed').focus(); throw new Error('Enter the final agreed amount first.'); }
      await saveDraft();
      openGenerate('invoice', e.id);
    }).catch(toastError);
    $b('#pay-add').onclick = () => paymentDialog();
  }

  function paymentDialog(p = null, { kind } = {}) {
    const e = ev(); const f = financials(e);
    const k0 = p?.kind || kind || (f.payments.length ? 'Part payment' : 'Advance');
    const body = `<div class="grid-2">
      <label class="field"><span>Amount ${icon('indian-rupee')} <b class="req">*</b></span><input class="input input-lg" id="p-amt" inputmode="decimal" value="${esc(p?.amount ?? '')}" placeholder="e.g. 100000" autofocus></label>
      <label class="field"><span>Date <b class="req">*</b></span><input class="input" type="date" id="p-date" value="${esc(p?.date || todayKey())}"></label>
    </div>
    <div class="field"><span>Payment type</span><div class="seg seg-wrap" id="p-kind">${PAYMENT_KINDS.map((k) => `<button type="button" data-v="${k}" class="${k0 === k ? 'on' : ''}">${k}</button>`).join('')}</div></div>
    <div class="field"><span>Payment method</span><div class="seg seg-wrap" id="p-method">${PAYMENT_METHODS.map((m) => `<button type="button" data-v="${m}" class="${(p?.method || 'UPI') === m ? 'on' : ''}">${m}</button>`).join('')}</div></div>
    <label class="field"><span>Reference <em>optional — UTR, cheque no., receipt no.</em></span><input class="input" id="p-ref" value="${esc(p?.reference || '')}"></label>
    <label class="field"><span>Notes <em>optional</em></span><input class="input" id="p-notes" value="${esc(p?.notes || '')}" placeholder="e.g. Advance at booking"></label>
    ${!p ? `<p class="muted small">Outstanding before this payment: <b>${money(Math.max(0, f.balance))}</b>${!f.hasAgreed ? ' (against the approximate budget)' : ''}</p>` : ''}`;
    const m = modal({
      title: p ? 'Edit payment' : (k0 === 'Advance' ? 'Record advance payment' : 'Record payment'), subtitle: `${getClient(e.clientId)?.name || ''} — ${e.title || ''}`, icon: 'banknote', body,
      actions: [{ label: 'Cancel', kind: 'ghost' }, { label: p ? 'Save payment' : 'Record payment', kind: 'primary', icon: 'check', run: async (close, el) => {
        const amount = num(el.querySelector('#p-amt').value);
        if (!(amount > 0)) { el.querySelector('#p-amt').classList.add('invalid'); throw new Error('Enter the amount received.'); }
        const date = el.querySelector('#p-date').value; if (!date) throw new Error('Choose the payment date.');
        await savePayment({ ...(p || {}), eventId: e.id, amount, date, kind: el.querySelector('#p-kind .on')?.dataset.v || 'Advance', method: el.querySelector('#p-method .on')?.dataset.v || 'Other', reference: el.querySelector('#p-ref').value.trim(), notes: el.querySelector('#p-notes').value.trim() });
        close(); toast(p ? 'Payment updated' : `Payment of ${money(amount)} recorded`);
      } }],
    });
    m.el.querySelector('#p-kind').onclick = (x) => { const b = x.target.closest('button'); if (!b) return; m.el.querySelectorAll('#p-kind button').forEach((n) => n.classList.toggle('on', n === b)); };
    m.el.querySelector('#p-method').onclick = (x) => { const b = x.target.closest('button'); if (!b) return; m.el.querySelectorAll('#p-method button').forEach((n) => n.classList.toggle('on', n === b)); };
  }

  /* ---------- activity ---------- */
  function activity(body) {
    const items = eventActivity(id);
    const ic = { created: 'notebook-pen', updated: 'pencil', requirements: 'list-checks', budget: 'indian-rupee', quotation: 'file-text', confirmation: 'file-check', invoice: 'receipt', confirmed: 'badge-check', quoted: 'hourglass', changes: 'pen-line', completed: 'flag', cancelled: 'ban', restored: 'rotate-ccw', rescheduled: 'calendar-clock', payment: 'banknote', share: 'share-2', billing: 'receipt', enquiry: 'notebook-pen' };
    body.innerHTML = `<div class="card"><div class="card-head"><h3>${icon('history')} Activity history</h3><span class="muted small">${items.length} entries</span></div>
      ${items.length ? `<ol class="timeline">${items.map((a) => `<li class="tl-${a.type}"><span class="tl-ic">${icon(ic[a.type] || 'circle-dot')}</span><div><b>${esc(a.message)}</b><small>${esc(fmtDateTime(a.at))}</small></div></li>`).join('')}</ol>` : emptyState({ icon: 'history', title: 'No activity yet' })}
      <p class="hint">${icon('info')} Shares are logged when you open WhatsApp or the share sheet — WhatsApp does not report whether a message was delivered or read.</p></div>`;
  }

  /* ======================= live updates ======================= */
  function refresh() {
    if (!ev()) return;
    hero();
    if (tab === 'bill' && bill.refresh) return bill.refresh();
    if (tab === 'requirements' && reqEditing) return;
    paintTab();
  }
  hero(); paintTab();
  const unsub = subscribe(refresh);

  const gen = query.get('generate');
  if (gen) { history.replaceState(null, '', `#/events/${id}`); setTimeout(() => openGenerate(gen, id, { onIssued: () => setTab(gen === 'quotation' ? 'quotations' : gen) }), 120); }

  return () => { unsub(); editingGuard = () => false; bill.refresh = null; };
}
