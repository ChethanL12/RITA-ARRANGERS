// Reports & Analytics: filter events by period (month / year / custom dates) and Day/Night,
// see how much has been received and how much is still to come, month by month.

import { icon } from '../icons.js';
import { esc, todayKey, pad2, MONTHS, fmtDate, money, debounce } from '../util.js';
import { STATUS, SESSIONS, OPEN_STATUSES, isConfirmed } from '../models.js';
import { store, occurrences, getClient, financials, budgetValue, subscribe } from '../store.js';
import { emptyState, statusBadge, downloadBlob } from '../ui.js';

// validated pair (dataviz validator: all checks pass on white)
const SERIES = { received: '#b8860b', due: '#2a78d6' };

/** What an event is worth: the final bill when set, otherwise the approximate budget (upper end). */
export function eventValue(ev) {
  const f = financials(ev);
  const value = f.hasAgreed ? f.total : budgetValue(ev.budget);
  return { value, final: f.hasAgreed, received: f.received, due: Math.max(0, value - f.received) };
}

const compact = (n) => {
  const a = Math.abs(n);
  if (a >= 1e7) return `₹${+(n / 1e7).toFixed(2)}Cr`;
  if (a >= 1e5) return `₹${+(n / 1e5).toFixed(1)}L`;
  if (a >= 1e3) return `₹${+(n / 1e3).toFixed(0)}k`;
  return `₹${Math.round(n)}`;
};
const monthKey = (d) => d.slice(0, 7);
const monthLabel = (k, short = false) => `${MONTHS[+k.slice(5) - 1].slice(0, short ? 3 : 20)}${short ? '' : ' ' + k.slice(0, 4)}`;
function lastDay(ym) { const [y, m] = ym.split('-').map(Number); return `${ym}-${pad2(new Date(y, m, 0).getDate())}`; }
function monthsBetween(a, b) {
  const out = []; let [y, m] = a.split('-').map(Number); const [y2, m2] = b.split('-').map(Number);
  while ((y < y2 || (y === y2 && m <= m2)) && out.length < 36) { out.push(`${y}-${pad2(m)}`); m++; if (m > 12) { m = 1; y++; } }
  return out;
}

export function render(root) {
  const t = todayKey();
  const st = { period: 'month', month: t.slice(0, 7), year: t.slice(0, 4), from: `${t.slice(0, 7)}-01`, to: lastDay(t.slice(0, 7)), session: 'all', status: 'active' };
  const years = [...new Set([t.slice(0, 4), ...store.events.map((e) => (e.primaryDate || '').slice(0, 4)).filter(Boolean)])].sort();

  root.innerHTML = `<div class="page reports">
    <header class="page-head">
      <div><p class="eyebrow">Business overview</p><h1>Reports &amp; Analytics</h1></div>
      <div class="head-actions"><button class="btn btn-secondary" id="csv">${icon('file-spreadsheet')}<span>Download CSV</span></button></div>
    </header>
    <section class="overall" id="overall"></section>
    <div class="card filters-card">
      <div class="filter-row">
        <div class="seg" id="f-period">
          <button data-v="month">Month</button><button data-v="year">Year</button><button data-v="custom">Custom dates</button><button data-v="all">All time</button>
        </div>
        <span id="f-period-inputs" class="row-gap"></span>
      </div>
      <div class="filter-row">
        <div class="seg" id="f-session"><button data-v="all">Day &amp; Night</button><button data-v="day">Day</button><button data-v="night">Night</button></div>
        <select class="input input-sm" id="f-status">
          <option value="active">All bookings (excl. cancelled)</option>
          <option value="confirmed">Confirmed &amp; completed</option>
          <option value="open">Not confirmed</option>
          <option value="completed">Completed</option>
          <option value="cancelled">Cancelled</option>
          <option value="all">Everything</option>
        </select>
      </div>
    </div>
    <section class="kpis" id="kpis"></section>
    <section class="card chart-card">
      <div class="card-head"><h3>${icon('chart-column')} Confirmed bookings by event month</h3>
        <div class="legend"><span><i style="background:${SERIES.received}"></i>Received</span><span><i style="background:${SERIES.due}"></i>Still to receive</span></div></div>
      <div class="chart" id="chart"></div>
    </section>
    <section class="card table-card report-table" id="table"></section>
  </div>`;
  const $ = (s) => root.querySelector(s);

  /* ---------- filters ---------- */
  function range() {
    if (st.period === 'month') return [`${st.month}-01`, lastDay(st.month)];
    if (st.period === 'year') return [`${st.year}-01-01`, `${st.year}-12-31`];
    if (st.period === 'custom') return [st.from || '0000-01-01', st.to || '9999-12-31'];
    return ['0000-01-01', '9999-12-31'];
  }
  function periodInputs() {
    const box = $('#f-period-inputs');
    if (st.period === 'month') box.innerHTML = `<input class="input input-sm" type="month" id="f-month" value="${st.month}">`;
    else if (st.period === 'year') box.innerHTML = `<select class="input input-sm" id="f-year">${years.map((y) => `<option ${y === st.year ? 'selected' : ''}>${y}</option>`).join('')}</select>`;
    else if (st.period === 'custom') box.innerHTML = `<input class="input input-sm" type="date" id="f-from" value="${st.from}"><span class="muted">to</span><input class="input input-sm" type="date" id="f-to" value="${st.to}">`;
    else box.innerHTML = '';
    box.querySelector('#f-month')?.addEventListener('change', (e) => { st.month = e.target.value || st.month; paint(); });
    box.querySelector('#f-year')?.addEventListener('change', (e) => { st.year = e.target.value; paint(); });
    box.querySelector('#f-from')?.addEventListener('change', (e) => { st.from = e.target.value; paint(); });
    box.querySelector('#f-to')?.addEventListener('change', (e) => { st.to = e.target.value; paint(); });
  }
  const statusOk = (s) => ({ active: s !== 'cancelled', confirmed: isConfirmed(s), open: OPEN_STATUSES.includes(s), completed: s === 'completed', cancelled: s === 'cancelled', all: true }[st.status]);
  const sessionOk = (o) => st.session === 'all' || o.session === st.session;

  /** one row per event; uses the event's first date inside the period */
  function rows([from, to], { ignorePeriod = false } = {}) {
    const out = [];
    for (const ev of store.events) {
      if (!statusOk(ev.status)) continue;
      const occ = occurrences(ev).find((o) => (ignorePeriod || (o.date >= from && o.date <= to)) && sessionOk(o));
      if (!occ) continue;
      out.push({ ev, occ, client: getClient(ev.clientId), ...eventValue(ev) });
    }
    return out.sort((a, b) => a.occ.date.localeCompare(b.occ.date));
  }

  /* ---------- painting ---------- */
  function overall() {
    const live = store.events.filter((e) => e.status !== 'cancelled');
    const receivedToDate = store.payments.filter((p) => (p.date || '') <= t).reduce((s, p) => s + Number(p.amount || 0), 0);
    const toReceive = live.filter((e) => isConfirmed(e.status)).reduce((s, e) => s + eventValue(e).due, 0);
    const possible = live.filter((e) => OPEN_STATUSES.includes(e.status) && (occurrences(e).some((o) => o.date >= t) || !occurrences(e).length)).reduce((s, e) => s + eventValue(e).value, 0);
    $('#overall').innerHTML = `
      <div class="ov-tile"><span class="ov-ic">${icon('coins')}</span><small>Received until today</small><b>${money(receivedToDate)}</b><em>All payments recorded so far</em></div>
      <div class="ov-tile"><span class="ov-ic due">${icon('trending-up')}</span><small>Still to receive</small><b>${money(toReceive)}</b><em>From confirmed bookings</em></div>
      <div class="ov-tile"><span class="ov-ic muted-ic">${icon('hourglass')}</span><small>Possible business</small><b>${money(possible)}</b><em>Upcoming quotations not yet confirmed</em></div>`;
  }

  function kpis(list, [from, to]) {
    const conf = list.filter((r) => isConfirmed(r.ev.status));
    const open = list.filter((r) => OPEN_STATUSES.includes(r.ev.status));
    const day = list.filter((r) => r.occ.session === 'day').length;
    const night = list.filter((r) => r.occ.session === 'night').length;
    const other = list.length - day - night;
    const value = conf.reduce((s, r) => s + r.value, 0);
    const received = list.reduce((s, r) => s + r.received, 0);
    const due = conf.reduce((s, r) => s + r.due, 0);
    const pipeline = open.reduce((s, r) => s + r.value, 0);
    const cashIn = store.payments.filter((p) => p.date >= from && p.date <= to).reduce((s, p) => s + Number(p.amount || 0), 0);
    const pct = value ? Math.min(100, Math.round((conf.reduce((s, r) => s + r.received, 0) / value) * 100)) : 0;
    $('#kpis').innerHTML = `
      <div class="kpi"><small>Events</small><b>${list.length}</b>
        <div class="split"><span><i class="sq day"></i>Day <b>${day}</b></span><span><i class="sq night"></i>Night <b>${night}</b></span>${other ? `<span class="muted">No session ${other}</span>` : ''}</div></div>
      <div class="kpi"><small>Confirmed business</small><b>${money(value)}</b><em>${conf.length} confirmed event${conf.length === 1 ? '' : 's'}</em></div>
      <div class="kpi"><small>Received</small><b class="k-rec">${money(received)}</b><em>${pct}% of confirmed business collected</em><div class="meter"><i style="width:${pct}%"></i></div></div>
      <div class="kpi"><small>Still to receive</small><b class="k-due">${money(due)}</b><em>Balance on confirmed events</em></div>
      <div class="kpi"><small>Not yet confirmed</small><b>${money(pipeline)}</b><em>${open.length} enquir${open.length === 1 ? 'y' : 'ies'} / quotation${open.length === 1 ? '' : 's'}</em></div>
      ${st.period !== 'all' ? `<div class="kpi"><small>Cash received in this period</small><b>${money(cashIn)}</b><em>By payment date, all events</em></div>` : ''}`;
  }

  function chartMonths([from, to]) {
    if (st.period === 'month' || st.period === 'year') { const y = st.period === 'month' ? st.month.slice(0, 4) : st.year; return monthsBetween(`${y}-01`, `${y}-12`); }
    if (st.period === 'custom') return monthsBetween(monthKey(st.from || t), monthKey(st.to || t));
    const ds = store.events.map((e) => e.primaryDate).filter(Boolean).sort();
    return ds.length ? monthsBetween(monthKey(ds[0]), monthKey(ds.at(-1))).slice(-24) : monthsBetween(t.slice(0, 7), t.slice(0, 7));
  }

  function chart(range) {
    const months = chartMonths(range);
    const all = rows(range, { ignorePeriod: true }).filter((r) => isConfirmed(r.ev.status));
    const data = months.map((m) => {
      const rs = all.filter((r) => occurrences(r.ev).some((o) => o.date.startsWith(m) && sessionOk(o)));
      return { m, received: rs.reduce((s, r) => s + Math.min(r.received, r.value || r.received), 0), due: rs.reduce((s, r) => s + r.due, 0), n: rs.length };
    });
    const el = $('#chart');
    const max = Math.max(...data.map((d) => d.received + d.due), 0);
    if (!max) { el.innerHTML = emptyState({ icon: 'chart-column', title: 'No confirmed bookings in these months', text: 'Confirmed events appear here by the month they take place.' }); return; }
    const W = Math.max(320, el.clientWidth || 800), H = 260, P = { l: 52, r: 8, t: 12, b: 28 };
    const step = niceStep(max / 4); const top = Math.ceil(max / step) * step;
    const y = (v) => P.t + (H - P.t - P.b) * (1 - v / top);
    const band = (W - P.l - P.r) / data.length; const bw = Math.min(24, band * 0.6);
    const selected = st.period === 'month' ? st.month : null;
    const rounded = (x, y0, w, h) => { const r = Math.min(4, h, w / 2); return `M${x},${y0 + h}V${y0 + r}Q${x},${y0} ${x + r},${y0}H${x + w - r}Q${x + w},${y0} ${x + w},${y0 + r}V${y0 + h}Z`; };
    let svg = '';
    for (let v = 0; v <= top + 1e-6; v += step) svg += `<line x1="${P.l}" x2="${W - P.r}" y1="${y(v)}" y2="${y(v)}" class="grid${v === 0 ? ' base' : ''}"/><text x="${P.l - 8}" y="${y(v) + 4}" class="ytick">${compact(v)}</text>`;
    data.forEach((d, i) => {
      const cx = P.l + band * i + band / 2; const x = cx - bw / 2;
      const hRec = y(0) - y(d.received); const hDue = y(0) - y(d.due);
      if (selected === d.m) svg += `<rect x="${P.l + band * i}" y="${P.t}" width="${band}" height="${H - P.t - P.b}" class="sel"/>`;
      if (d.received > 0) svg += d.due > 0 ? `<rect x="${x}" y="${y(d.received)}" width="${bw}" height="${hRec}" fill="${SERIES.received}"/>` : `<path d="${rounded(x, y(d.received), bw, hRec)}" fill="${SERIES.received}"/>`;
      if (d.due > 0) { const yTop = y(d.received + d.due); const h = Math.max(0, hDue - (d.received > 0 ? 2 : 0)); svg += `<path d="${rounded(x, yTop, bw, h)}" fill="${SERIES.due}"/>`; }
      svg += `<text x="${cx}" y="${H - 8}" class="xtick">${monthLabel(d.m, true)}</text>`;
      svg += `<rect x="${P.l + band * i}" y="${P.t}" width="${band}" height="${H - P.t - P.b}" class="hit" data-i="${i}"/>`;
    });
    el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="100%" height="${H}" role="img" aria-label="Received and still to receive per month">${svg}</svg><div class="tip" hidden></div>`;
    const tip = el.querySelector('.tip');
    el.querySelectorAll('.hit').forEach((h) => {
      h.addEventListener('mouseenter', () => {
        const d = data[+h.dataset.i];
        tip.innerHTML = `<b>${esc(monthLabel(d.m))}</b><span><i style="background:${SERIES.received}"></i>Received<em>${money(d.received)}</em></span><span><i style="background:${SERIES.due}"></i>Still to receive<em>${money(d.due)}</em></span><span class="tt">Total<em>${money(d.received + d.due)}</em></span><small>${d.n} confirmed event${d.n === 1 ? '' : 's'}</small>`;
        tip.hidden = false;
        const bx = +h.getAttribute('x') + +h.getAttribute('width') / 2;
        const left = Math.min(Math.max(8, (bx / W) * el.clientWidth - 90), el.clientWidth - 188);
        tip.style.left = left + 'px';
        h.classList.add('on');
      });
      h.addEventListener('mouseleave', () => { tip.hidden = true; h.classList.remove('on'); });
    });
  }
  function niceStep(raw) { const p = 10 ** Math.floor(Math.log10(raw || 1)); const n = raw / p; return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p; }

  let current = [];
  function table(list) {
    current = list;
    if (!list.length) { $('#table').innerHTML = emptyState({ icon: 'calendar-range', title: 'No events match these filters', text: 'Try another month, date range or session.' }); return; }
    const tot = list.reduce((s, r) => ({ value: s.value + r.value, received: s.received + r.received, due: s.due + (isConfirmed(r.ev.status) ? r.due : 0) }), { value: 0, received: 0, due: 0 });
    $('#table').innerHTML = `<table class="rtbl"><thead><tr><th>Date</th><th>Session</th><th>Client</th><th>Event</th><th>Status</th><th class="num">Value</th><th class="num">Received</th><th class="num">To receive</th></tr></thead>
      <tbody>${list.map((r) => `<tr data-ev="${r.ev.id}"><td>${esc(fmtDate(r.occ.date))}</td><td>${esc(SESSIONS[r.occ.session]?.label || '—')}</td><td>${esc(r.client?.name || '')}</td><td>${esc(r.ev.title || '')}</td><td>${statusBadge(r.ev.status)}</td>
        <td class="num">${r.value ? money(r.value) : '—'}${r.value && !r.final ? '<small>est.</small>' : ''}</td><td class="num">${money(r.received)}</td><td class="num">${isConfirmed(r.ev.status) ? money(r.due) : '<span class="muted">—</span>'}</td></tr>`).join('')}</tbody>
      <tfoot><tr><td colspan="5">${list.length} event${list.length === 1 ? '' : 's'}</td><td class="num">${money(tot.value)}</td><td class="num">${money(tot.received)}</td><td class="num">${money(tot.due)}</td></tr></tfoot></table>
      <p class="hint">${icon('info')} Value is the final bill when it has been set, otherwise the approximate budget (<b>est.</b>, upper end of a range). “To receive” counts confirmed and completed bookings only.</p>`;
    root.querySelectorAll('tr[data-ev]').forEach((tr) => (tr.onclick = () => window.raNavigate(`#/events/${tr.dataset.ev}`)));
  }

  function paint() {
    root.querySelectorAll('#f-period button').forEach((b) => b.classList.toggle('on', b.dataset.v === st.period));
    root.querySelectorAll('#f-session button').forEach((b) => b.classList.toggle('on', b.dataset.v === st.session));
    $('#f-status').value = st.status;
    const r = range();
    const list = rows(r);
    overall(); kpis(list, r); chart(r); table(list);
  }

  $('#f-period').onclick = (e) => { const b = e.target.closest('button'); if (!b) return; st.period = b.dataset.v; periodInputs(); paint(); };
  $('#f-session').onclick = (e) => { const b = e.target.closest('button'); if (!b) return; st.session = b.dataset.v; paint(); };
  $('#f-status').onchange = (e) => { st.status = e.target.value; paint(); };
  $('#csv').onclick = () => {
    const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const lines = [['Date', 'Session', 'Client', 'Phone', 'Event', 'Venue', 'Status', 'Value', 'Value is final', 'Received', 'To receive'].map(q).join(',')];
    for (const r of current) lines.push([r.occ.date, SESSIONS[r.occ.session]?.label || '', r.client?.name, r.client?.phone, r.ev.title, r.ev.venue, STATUS[r.ev.status]?.label, r.value, r.final ? 'Yes' : 'Estimate', r.received, isConfirmed(r.ev.status) ? r.due : ''].map(q).join(','));
    downloadBlob(new Blob(['﻿' + lines.join('\n')], { type: 'text/csv' }), `rita-arrangers-report-${range()[0].replace(/^0000.*/, 'all')}.csv`);
  };
  periodInputs(); paint();
  const ro = new ResizeObserver(debounce(() => chart(range()), 150)); ro.observe($('#chart'));
  const unsub = subscribe(paint);
  return () => { unsub(); ro.disconnect(); };
}
