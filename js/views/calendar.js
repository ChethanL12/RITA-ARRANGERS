// Month calendar component. Unlimited events per date; overlapping sessions are flagged, never blocked.

import { icon } from '../icons.js';
import { esc, toKey, todayKey, MONTHS, WEEKDAYS, fmtDateLong, fmtTime, parseKey } from '../util.js';
import { STATUS, SESSIONS } from '../models.js';
import { store, eventsOn, getClient, subscribe } from '../store.js';
import { modal, statusBadge, sessionTag } from '../ui.js';

const MAX_PILLS = 3;

export function overlapsOn(items) {
  const bySession = {};
  for (const { occ, ev } of items) {
    if (ev.status === 'cancelled' || !occ.session) continue;
    const k = occ.session === 'fullday' ? 'fullday' : occ.session;
    (bySession[k] ||= []).push(ev);
  }
  const full = bySession.fullday?.length || 0;
  return Object.entries(bySession).filter(([k, v]) => v.length > 1 || (full && k !== 'fullday' && v.length)).map(([k, v]) => ({ session: k, count: v.length + (k !== 'fullday' ? full : 0) }));
}

function pill(ev, occ) {
  const c = getClient(ev.clientId);
  const st = STATUS[ev.status] || STATUS.enquiry;
  const sess = SESSIONS[occ.session];
  const title = `${c?.name || 'Client'} — ${ev.title || 'Event'}${occ.label ? ` (${occ.label})` : ''}\n${st.label}${sess ? ' · ' + sess.label : ''}${occ.start ? ' · ' + fmtTime(occ.start) : ''}`;
  return `<button class="cal-pill tone-${st.tone}" data-event="${ev.id}" title="${esc(title)}">
    ${sess ? `<span class="pill-sess">${icon(sess.icon)}</span>` : '<i class="dot"></i>'}
    <span class="pill-text"><b>${esc(c?.name || 'Client')}</b><small>${esc(occ.label || ev.title || '')}</small></span>
  </button>`;
}

export function dayList(dateKey, { onEvent }) {
  const items = eventsOn(dateKey);
  if (!items.length) return '<p class="muted center">No events on this date yet.</p>';
  return `<div class="day-list">${items.map(({ ev, occ }) => {
    const c = getClient(ev.clientId);
    return `<button class="day-item tone-${STATUS[ev.status].tone}" data-event="${ev.id}">
      <span class="day-bar"></span>
      <span class="day-main"><b>${esc(c?.name || 'Client')}</b><span>${esc(ev.title || '')}${occ.label ? ` · ${esc(occ.label)}` : ''}</span>
      <small>${sessionTag(occ.session)}${occ.start ? `<span>${icon('clock')}${esc(fmtTime(occ.start))}${occ.end ? '–' + esc(fmtTime(occ.end)) : ''}</span>` : ''}${ev.venue ? `<span>${icon('map-pin')}${esc(ev.venue)}</span>` : ''}</small></span>
      ${statusBadge(ev.status)}
    </button>`;
  }).join('')}</div>`;
}

export function openDay(dateKey, { onEvent, onNew }) {
  const items = eventsOn(dateKey);
  const ov = overlapsOn(items);
  const body = `${ov.length ? `<div class="callout callout-warn">${icon('layers')}<div>${ov.map((o) => `${o.count} events in the ${SESSIONS[o.session]?.label || o.session} session`).join(' · ')} — check venues and team allocation.</div></div>` : ''}
    ${dayList(dateKey, { onEvent })}`;
  const m = modal({
    title: fmtDateLong(dateKey), subtitle: `${WEEKDAYS[parseKey(dateKey).getDay()]} · ${items.length} event${items.length === 1 ? '' : 's'}`,
    icon: 'calendar-days', body, size: 'md',
    actions: [{ label: 'New enquiry on this date', kind: 'primary', icon: 'calendar-plus', run: (close) => { close(); onNew(dateKey); } }],
  });
  m.el.querySelectorAll('[data-event]').forEach((b) => (b.onclick = () => { m.close(); onEvent(b.dataset.event); }));
}

/**
 * mountCalendar(el, { onEvent(id), onNew(dateKey), filter(ev) -> bool, month: 'YYYY-MM' })
 * Returns { setMonth, refresh, destroy }.
 */
export function mountCalendar(el, opts) {
  const today = new Date();
  let y = today.getFullYear(), m = today.getMonth();
  if (opts.month) { const [yy, mm] = opts.month.split('-').map(Number); y = yy; m = mm - 1; }
  let selected = todayKey();
  const filter = opts.filter || (() => true);

  function render() {
    const first = new Date(y, m, 1);
    const start = new Date(y, m, 1 - first.getDay());
    const weeks = Math.ceil((first.getDay() + new Date(y, m + 1, 0).getDate()) / 7);
    const tk = todayKey();
    let cells = '';
    for (let i = 0; i < weeks * 7; i++) {
      const d = new Date(start); d.setDate(start.getDate() + i);
      const k = toKey(d);
      const items = eventsOn(k).filter(({ ev }) => filter(ev));
      const ov = overlapsOn(items);
      const out = d.getMonth() !== m;
      const conf = items.filter(({ ev }) => ev.status === 'confirmed' || ev.status === 'completed').length;
      const pend = items.filter(({ ev }) => ['enquiry', 'quoted', 'changes'].includes(ev.status)).length;
      cells += `<div class="cal-cell${out ? ' out' : ''}${k === tk ? ' today' : ''}${k < tk ? ' past' : ''}${k === selected ? ' selected' : ''}${items.length ? ' has' : ''}" data-date="${k}" role="gridcell" tabindex="-1" aria-label="${esc(fmtDateLong(k))}, ${items.length} events">
        <div class="cal-date"><span class="num">${d.getDate()}</span>
          ${ov.length ? `<span class="ov" title="${esc(ov.map((o) => `${o.count} events in ${SESSIONS[o.session]?.label} session`).join(', '))}">${icon('layers')}</span>` : ''}
          <button class="cal-add" data-add="${k}" title="New enquiry on ${esc(fmtDateLong(k))}" aria-label="New enquiry on ${esc(fmtDateLong(k))}">${icon('plus')}</button>
        </div>
        <div class="cal-events">${items.slice(0, MAX_PILLS).map(({ ev, occ }) => pill(ev, occ)).join('')}
          ${items.length > MAX_PILLS ? `<button class="cal-more" data-more="${k}">+ ${items.length - MAX_PILLS} more</button>` : ''}</div>
        <div class="cal-dots">${conf ? `<i class="d green"></i>` : ''}${pend ? `<i class="d amber"></i>` : ''}${items.length ? `<em>${items.length}</em>` : ''}</div>
      </div>`;
    }
    el.innerHTML = `<div class="cal">
      <div class="cal-head">
        <div class="cal-title"><h2>${MONTHS[m]} <span>${y}</span></h2></div>
        <div class="cal-nav">
          <button class="btn btn-ghost btn-sm" data-nav="today">Today</button>
          <button class="icon-btn" data-nav="prev" aria-label="Previous month">${icon('chevron-left')}</button>
          <button class="icon-btn" data-nav="next" aria-label="Next month">${icon('chevron-right')}</button>
        </div>
      </div>
      <div class="cal-legend"><span><i class="d green"></i>Confirmed</span><span><i class="d amber"></i>Not confirmed</span><span><i class="d draft"></i>Enquiry</span><span><i class="d red"></i>Cancelled</span><span>${icon('layers')} Same-session overlap</span></div>
      <div class="cal-grid" role="grid">
        ${WEEKDAYS.map((w) => `<div class="cal-wd"><span class="long">${w.slice(0, 3)}</span><span class="short">${w[0]}</span></div>`).join('')}
        ${cells}
      </div>
      <div class="cal-agenda">
        <div class="agenda-head"><h3>${esc(fmtDateLong(selected))}</h3><button class="btn btn-primary btn-sm" data-add="${selected}">${icon('plus')}<span>Add</span></button></div>
        ${dayList(selected, opts)}
      </div>
    </div>`;
  }

  const mobile = () => window.matchMedia('(max-width: 760px)').matches;
  function onClick(e) {
    const nav = e.target.closest('[data-nav]');
    if (nav) {
      const a = nav.dataset.nav;
      if (a === 'today') { y = today.getFullYear(); m = today.getMonth(); selected = todayKey(); }
      else { m += a === 'next' ? 1 : -1; if (m < 0) { m = 11; y--; } if (m > 11) { m = 0; y++; } }
      render(); opts.onMonth?.(`${y}-${String(m + 1).padStart(2, '0')}`); return;
    }
    const add = e.target.closest('[data-add]');
    if (add) { e.stopPropagation(); opts.onNew(add.dataset.add); return; }
    const evb = e.target.closest('[data-event]');
    if (evb) { e.stopPropagation(); opts.onEvent(evb.dataset.event); return; }
    const more = e.target.closest('[data-more]');
    if (more) { e.stopPropagation(); openDay(more.dataset.more, opts); return; }
    const cell = e.target.closest('.cal-cell');
    if (cell) {
      const k = cell.dataset.date;
      if (mobile()) { selected = k; render(); el.querySelector('.cal-agenda')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); return; }
      if (cell.classList.contains('has')) openDay(k, opts); else opts.onNew(k);
    }
  }
  el.addEventListener('click', onClick);
  render();
  const unsub = subscribe(render);
  return {
    refresh: render,
    destroy() { unsub(); el.removeEventListener('click', onClick); },
  };
}
