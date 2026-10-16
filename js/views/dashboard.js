// Dashboard: key figures, the main calendar, the week ahead and things needing attention.

import { icon } from '../icons.js';
import { esc, fmtDate, relDays, todayKey, money, MONTHS } from '../util.js';
import { store, metrics, getClient, occurrences, subscribe, financials, latestDoc, isStale, lastDate } from '../store.js';
import { statusBadge, sessionTag, emptyState } from '../ui.js';
import { mountCalendar } from './calendar.js';

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
}

function stat(ic, label, value, sub, href, tone = '') {
  return `<a class="stat ${tone ? 't-' + tone : ''}" href="${href}"><span class="stat-ic">${icon(ic)}</span>
    <span class="stat-val">${value}</span><span class="stat-label">${label}</span>${sub ? `<span class="stat-sub">${sub}</span>` : ''}</a>`;
}

function nextOcc(ev, from = todayKey()) {
  return occurrences(ev).filter((o) => o.date >= from).sort((a, b) => a.date.localeCompare(b.date))[0] || occurrences(ev)[0];
}

function eventLine(ev, occ = nextOcc(ev), tag = '') {
  const c = getClient(ev.clientId);
  return `<a class="line-item" href="#/events/${ev.id}">
    <span class="li-date"><b>${occ ? new Date(occ.date + 'T00:00').getDate() : '–'}</b><small>${occ ? MONTHS[+occ.date.slice(5, 7) - 1].slice(0, 3) : ''}</small></span>
    <span class="li-main"><b>${esc(c?.name || 'Client')}</b><span>${esc(ev.title || 'Event')}${occ?.label ? ` · ${esc(occ.label)}` : ''}</span>
      <small>${occ ? esc(relDays(occ.date)) : ''} ${sessionTag(occ?.session)}</small>${tag ? `<span class="li-tag">${tag}</span>` : ''}</span>
    ${tag ? '' : statusBadge(ev.status)}
  </a>`;
}

export function render(root, { navigate }) {
  root.innerHTML = `<div class="page dash">
    <header class="page-head">
      <div><p class="eyebrow">${esc(fmtDate(todayKey()))}</p><h1>${greeting()}</h1></div>
      <div class="head-actions">
        <form class="search" id="dash-search"><span>${icon('search')}</span><input class="input" name="q" placeholder="Search client, phone or event…" autocomplete="off"></form>
        <a class="btn btn-primary" href="#/events/new">${icon('calendar-plus')}<span>New Enquiry</span></a>
      </div>
    </header>
    <section class="stats" id="stats"></section>
    <section class="dash-grid">
      <div class="card cal-card" id="cal"></div>
      <aside class="dash-side">
        <div class="card"><div class="card-head"><h3>${icon('calendar-clock')} Next 7 days</h3></div><div id="week"></div></div>
        <div class="card"><div class="card-head"><h3>${icon('bell')} Needs attention</h3></div><div id="attention"></div></div>
      </aside>
    </section>
  </div>`;

  root.querySelector('#dash-search').onsubmit = (e) => {
    e.preventDefault(); const q = e.target.q.value.trim();
    navigate(`#/clients${q ? `?q=${encodeURIComponent(q)}` : ''}`);
  };

  const cal = mountCalendar(root.querySelector('#cal'), {
    onEvent: (id) => navigate(`#/events/${id}`),
    onNew: (k) => navigate(`#/events/new?date=${k}`),
  });

  function paint() {
    const mt = metrics();
    root.querySelector('#stats').innerHTML = [
      stat('calendar-days', 'Upcoming events', mt.upcoming.length, 'All not-yet-held events', '#/calendar?view=list&f=upcoming'),
      stat('badge-check', 'Confirmed bookings', mt.confirmed.length, 'Upcoming & confirmed', '#/calendar?view=list&f=confirmed', 'green'),
      stat('hourglass', 'Pending / not confirmed', mt.pending.length, 'Enquiries & quotations', '#/calendar?view=list&f=pending', 'amber'),
      stat('calendar-check', `This month`, mt.thisMonth.length, MONTHS[new Date().getMonth()], '#/calendar?view=list&f=month'),
      stat('file-text', 'Awaiting confirmation', mt.awaiting.length, 'Quotations sent', '#/calendar?view=list&f=awaiting', 'amber'),
      stat('clock', 'Next 7 days', mt.week.length, 'Coming up soon', '#/calendar?view=list&f=week', 'gold'),
    ].join('');

    const t = todayKey();
    const week = [];
    for (const ev of mt.week) for (const o of occurrences(ev)) {
      const diff = (new Date(o.date) - new Date(t)) / 864e5;
      if (diff >= 0 && diff <= 7) week.push({ ev, o });
    }
    week.sort((a, b) => a.o.date.localeCompare(b.o.date));
    root.querySelector('#week').innerHTML = week.length
      ? `<div class="lines">${week.map(({ ev, o }) => eventLine(ev, o)).join('')}</div>`
      : emptyState({ icon: 'sun', title: 'A quiet week', text: 'No events in the next seven days.' });

    const att = [];
    for (const ev of mt.toComplete) att.push({ ev, tag: `<span class="badge tone-slate">Mark completed</span>` });
    for (const ev of store.events) {
      if (ev.status === 'cancelled') continue;
      const q = latestDoc(ev.id, 'quotation');
      if (q && isStale(q, ev) && !['completed'].includes(ev.status)) att.push({ ev, tag: `<span class="badge tone-orange">Quotation outdated</span>` });
      if (ev.status === 'enquiry' && !q && lastDate(ev) >= t) att.push({ ev, tag: `<span class="badge tone-draft">Send quotation</span>` });
      if (ev.status === 'confirmed' && !latestDoc(ev.id, 'confirmation')) att.push({ ev, tag: `<span class="badge tone-green">Issue confirmation</span>` });
    }
    for (const ev of mt.outstanding) att.push({ ev, tag: `<span class="badge tone-red">${money(financials(ev).balance)} due</span>` });
    root.querySelector('#attention').innerHTML = att.length
      ? `<div class="lines">${att.slice(0, 12).map(({ ev, tag }) => eventLine(ev, undefined, tag)).join('')}</div>`
      : emptyState({ icon: 'circle-check', title: 'All caught up', text: 'No pending quotations, letters or balances.' });
  }
  paint();
  const unsub = subscribe(paint);
  return () => { unsub(); cal.destroy(); };
}
