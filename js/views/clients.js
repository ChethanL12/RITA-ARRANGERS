// Clients & Events: search clients by name/phone, search & filter events.

import { icon } from '../icons.js';
import { esc, fmtDate, todayKey, initials, fmtPhone, money, debounce } from '../util.js';
import { STATUS } from '../models.js';
import { store, clientEvents, getClient, financials, budgetText, occurrences, lastDate, subscribe, eventDocs } from '../store.js';
import { statusBadge, emptyState, sessionTag } from '../ui.js';

export function render(root, { query, navigate }) {
  let tab = query.get('tab') || 'clients';
  let q = query.get('q') || '';
  let status = 'all'; let when = 'all'; let from = ''; let to = '';

  root.innerHTML = `<div class="page">
    <header class="page-head">
      <div><p class="eyebrow">${store.clients.length} clients · ${store.events.length} events</p><h1>Clients &amp; Events</h1></div>
      <div class="head-actions"><a class="btn btn-primary" href="#/events/new">${icon('calendar-plus')}<span>New Enquiry</span></a></div>
    </header>
    <div class="filter-bar">
      <div class="seg" id="tab-seg"><button data-t="clients">${icon('users')}<span>Clients</span></button><button data-t="events">${icon('calendar-days')}<span>Events</span></button></div>
      <div class="search grow"><span>${icon('search')}</span><input class="input" id="q" placeholder="Search name, phone number or event…" value="${esc(q)}" autocomplete="off"></div>
    </div>
    <div class="filter-bar" id="ev-filters">
      <select class="input input-sm" id="f-status"><option value="all">All statuses</option><option value="open">Not confirmed</option>${Object.entries(STATUS).map(([k, s]) => `<option value="${k}">${s.label}</option>`).join('')}</select>
      <select class="input input-sm" id="f-when"><option value="all">Any date</option><option value="upcoming">Upcoming</option><option value="past">Past</option><option value="range">Date range…</option></select>
      <span id="range" hidden class="range"><input class="input input-sm" type="date" id="f-from"><span>to</span><input class="input input-sm" type="date" id="f-to"></span>
    </div>
    <div id="list"></div>
  </div>`;
  const $ = (s) => root.querySelector(s);

  const match = (txt) => !q || String(txt || '').toLowerCase().includes(q.toLowerCase());
  const matchPhone = (p) => { const d = q.replace(/\D/g, ''); return d.length >= 3 && String(p || '').replace(/\D/g, '').includes(d); };

  function clientsList() {
    const t = todayKey();
    const rows = store.clients.filter((c) => match(c.name) || matchPhone(c.phone) || matchPhone(c.altPhone) || match(c.email) || clientEvents(c.id).some((e) => match(e.title)))
      .map((c) => {
        const evs = clientEvents(c.id);
        const next = evs.filter((e) => lastDate(e) >= t && e.status !== 'cancelled').sort((a, b) => a.primaryDate.localeCompare(b.primaryDate))[0];
        const due = evs.reduce((s, e) => { const f = financials(e); return s + (e.status !== 'cancelled' && f.hasAgreed && f.balance > 0 ? f.balance : 0); }, 0);
        return { c, evs, next, due };
      })
      .sort((a, b) => (b.c.updatedAt || '').localeCompare(a.c.updatedAt || ''));
    if (!rows.length) return `<div class="card">${emptyState({ icon: 'users', title: q ? 'No matching clients' : 'No clients yet', text: q ? 'Try a different name or number.' : 'Clients are added automatically when you save an enquiry.', action: '<a class="btn btn-primary" href="#/events/new">New Enquiry</a>' })}</div>`;
    return `<div class="client-grid">${rows.map(({ c, evs, next, due }) => `<a class="client-card card" href="#/clients/${c.id}">
      <span class="avatar">${esc(initials(c.name))}</span>
      <span class="cc-main"><b>${esc(c.name || 'Unnamed client')}</b><small>${icon('phone')}${esc(fmtPhone(c.phone) || 'No phone')}</small></span>
      <span class="cc-stats"><span><b>${evs.length}</b> event${evs.length === 1 ? '' : 's'}</span>
        ${next ? `<span>${icon('calendar-days')}${esc(fmtDate(next.primaryDate, { weekday: false }))} · ${esc(next.title || '')}</span>` : '<span class="muted">No upcoming event</span>'}
        ${due > 0 ? `<span class="amber">${money(due)} outstanding</span>` : ''}</span>
    </a>`).join('')}</div>`;
  }

  function eventsList() {
    const t = todayKey();
    const rows = store.events.filter((e) => {
      const c = getClient(e.clientId) || {};
      if (q && !(match(e.title) || match(c.name) || matchPhone(c.phone) || match(e.venue) || match(e.service) || match(e.refNo) || (e.customFields || []).some((f) => match(f.value)))) return false;
      if (status === 'open' && !['enquiry', 'quoted', 'changes'].includes(e.status)) return false;
      if (status !== 'all' && status !== 'open' && e.status !== status) return false;
      const ds = occurrences(e).map((o) => o.date);
      if (when === 'upcoming' && !(lastDate(e) >= t)) return false;
      if (when === 'past' && !(lastDate(e) && lastDate(e) < t)) return false;
      if (when === 'range' && !ds.some((d) => (!from || d >= from) && (!to || d <= to))) return false;
      return true;
    }).sort((a, b) => (when === 'past' ? (b.primaryDate || '').localeCompare(a.primaryDate || '') : (a.primaryDate || '9999').localeCompare(b.primaryDate || '9999')));
    if (!rows.length) return `<div class="card">${emptyState({ icon: 'calendar', title: 'No matching events', text: 'Adjust the search or filters.' })}</div>`;
    return `<div class="card table-card">${rows.map((e) => {
      const c = getClient(e.clientId) || {}; const f = financials(e); const o = occurrences(e)[0];
      return `<a class="erow" href="#/events/${e.id}">
        <span class="erow-date">${o ? `<b>${+o.date.slice(8)}</b><small>${esc(fmtDate(o.date, { weekday: false }).split(' ').slice(1).join(' '))}</small>` : '<b>–</b>'}</span>
        <span class="erow-main"><b>${esc(c.name || 'Client')}</b><span>${esc(e.title || 'Event')}${occurrences(e).length > 1 ? ` · ${occurrences(e).length} dates` : ''}</span></span>
        <span class="erow-meta hide-sm">${sessionTag(o?.session)}${e.venue ? `<span>${icon('map-pin')}${esc(e.venue)}</span>` : ''}</span>
        <span class="erow-amt hide-sm">${f.hasAgreed ? money(f.total) : esc(budgetText(e.budget))}${f.received ? `<small class="green">${money(f.received)} received</small>` : ''}</span>
        <span class="erow-docs hide-sm" title="Documents issued">${icon('files')}${eventDocs(e.id).length}</span>
        ${statusBadge(e.status)}
      </a>`;
    }).join('')}</div>`;
  }

  function paint() {
    root.querySelectorAll('#tab-seg button').forEach((b) => b.classList.toggle('on', b.dataset.t === tab));
    $('#ev-filters').hidden = tab !== 'events';
    $('#range').hidden = when !== 'range';
    $('#list').innerHTML = tab === 'clients' ? clientsList() : eventsList();
  }
  $('#tab-seg').onclick = (e) => { const b = e.target.closest('button'); if (b) { tab = b.dataset.t; paint(); } };
  $('#q').addEventListener('input', debounce((e) => { q = e.target.value.trim(); paint(); }, 150));
  $('#f-status').onchange = (e) => { status = e.target.value; paint(); };
  $('#f-when').onchange = (e) => { when = e.target.value; paint(); };
  $('#f-from').onchange = (e) => { from = e.target.value; paint(); };
  $('#f-to').onchange = (e) => { to = e.target.value; paint(); };
  paint();
  if (window.matchMedia('(pointer:fine)').matches) $('#q').focus();
  return subscribe(paint);
}
