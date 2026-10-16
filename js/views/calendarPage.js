// Calendar page: month view or list view, filterable by status.

import { icon } from '../icons.js';
import { esc, fmtDate, todayKey, MONTHS, relDays, fmtTime, addDays } from '../util.js';
import { STATUS, SESSIONS } from '../models.js';
import { store, occurrences, getClient, subscribe, metrics, budgetText } from '../store.js';
import { statusBadge, sessionTag, emptyState } from '../ui.js';
import { mountCalendar } from './calendar.js';

const PRESETS = {
  upcoming: 'Upcoming', confirmed: 'Upcoming confirmed', pending: 'Pending / not confirmed',
  month: 'This month', awaiting: 'Awaiting confirmation', week: 'Next 7 days', past: 'Past events', all: 'All events',
};

export function render(root, { query, navigate }) {
  let view = query.get('view') || 'month';
  let preset = query.get('f') || 'upcoming';
  const statuses = new Set(Object.keys(STATUS).filter((s) => s !== 'cancelled'));
  if (query.get('f')) Object.keys(STATUS).forEach((s) => statuses.add(s));

  root.innerHTML = `<div class="page">
    <header class="page-head">
      <div><p class="eyebrow">Event calendar</p><h1>Calendar</h1></div>
      <div class="head-actions">
        <div class="seg" id="view-seg">
          <button data-v="month">${icon('layout-grid')}<span>Month</span></button>
          <button data-v="list">${icon('list')}<span>List</span></button>
        </div>
        <a class="btn btn-primary" href="#/events/new">${icon('calendar-plus')}<span>New Enquiry</span></a>
      </div>
    </header>
    <div class="filter-bar">
      <div class="chips" id="status-chips">${Object.entries(STATUS).map(([k, s]) => `<button class="chip tone-${s.tone}" data-s="${k}"><i class="dot"></i>${s.label}</button>`).join('')}</div>
      <select class="input input-sm" id="preset" ${view === 'month' ? 'hidden' : ''}>${Object.entries(PRESETS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select>
    </div>
    <div id="body"></div>
  </div>`;

  const body = root.querySelector('#body');
  let cal = null;
  const filter = (ev) => statuses.has(ev.status);

  function paintChips() {
    root.querySelectorAll('#status-chips .chip').forEach((c) => c.classList.toggle('on', statuses.has(c.dataset.s)));
    root.querySelectorAll('#view-seg button').forEach((b) => b.classList.toggle('on', b.dataset.v === view));
    const p = root.querySelector('#preset'); p.value = preset; p.hidden = view === 'month';
  }

  function listItems() {
    const t = todayKey(); const mt = metrics();
    const ym = t.slice(0, 7); const wk = addDays(t, 7);
    const rows = [];
    for (const ev of store.events) {
      if (!filter(ev)) continue;
      for (const o of occurrences(ev)) {
        let ok = true;
        if (preset === 'upcoming') ok = o.date >= t;
        if (preset === 'confirmed') ok = o.date >= t && ev.status === 'confirmed';
        if (preset === 'pending') ok = o.date >= t && ['enquiry', 'quoted', 'changes'].includes(ev.status);
        if (preset === 'month') ok = o.date.startsWith(ym);
        if (preset === 'awaiting') ok = ['quoted', 'changes'].includes(ev.status);
        if (preset === 'week') ok = o.date >= t && o.date <= wk;
        if (preset === 'past') ok = o.date < t;
        if (ok) rows.push({ ev, o });
      }
    }
    rows.sort((a, b) => (preset === 'past' ? b.o.date.localeCompare(a.o.date) : a.o.date.localeCompare(b.o.date)));
    return rows;
  }

  function paint() {
    paintChips();
    if (view === 'month') {
      if (!cal) { body.innerHTML = '<div class="card cal-card" id="cal"></div>'; cal = mountCalendar(body.querySelector('#cal'), { filter, onEvent: (id) => navigate(`#/events/${id}`), onNew: (k) => navigate(`#/events/new?date=${k}`) }); }
      else cal.refresh();
      return;
    }
    cal?.destroy(); cal = null;
    const rows = listItems();
    if (!rows.length) { body.innerHTML = `<div class="card">${emptyState({ icon: 'calendar', title: 'No events match', text: 'Try another status or period.' })}</div>`; return; }
    let html = ''; let month = '';
    for (const { ev, o } of rows) {
      const m = o.date.slice(0, 7);
      if (m !== month) { if (month) html += '</div>'; month = m; html += `<h3 class="list-month">${MONTHS[+m.slice(5) - 1]} ${m.slice(0, 4)}</h3><div class="card table-card">`; }
      const c = getClient(ev.clientId);
      html += `<a class="erow" href="#/events/${ev.id}">
        <span class="erow-date"><b>${+o.date.slice(8)}</b><small>${fmtDate(o.date, { year: false }).split(',')[0]}</small></span>
        <span class="erow-main"><b>${esc(c?.name || 'Client')}</b><span>${esc(ev.title || 'Event')}${o.label ? ` · ${esc(o.label)}` : ''}</span></span>
        <span class="erow-meta">${sessionTag(o.session)}${o.start ? `<span class="muted">${esc(fmtTime(o.start))}</span>` : ''}</span>
        <span class="erow-meta hide-sm">${ev.venue ? `${icon('map-pin')}${esc(ev.venue)}` : ''}</span>
        <span class="erow-amt hide-sm">${esc(budgetText(ev.budget))}</span>
        ${statusBadge(ev.status)}
      </a>`;
    }
    body.innerHTML = html + '</div>';
  }

  root.querySelector('#status-chips').onclick = (e) => {
    const c = e.target.closest('.chip'); if (!c) return;
    statuses.has(c.dataset.s) ? statuses.delete(c.dataset.s) : statuses.add(c.dataset.s);
    paint();
  };
  root.querySelector('#view-seg').onclick = (e) => { const b = e.target.closest('button'); if (!b) return; view = b.dataset.v; paint(); };
  root.querySelector('#preset').onchange = (e) => { preset = e.target.value; paint(); };
  paint();
  const unsub = subscribe(() => { if (view === 'list') paint(); });
  return () => { unsub(); cal?.destroy(); };
}
