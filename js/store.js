// In-memory application state + all business operations.
// Every write goes through the active adapter, then updates the cache and notifies views.

import { DEFAULT_SETTINGS, STATUS, OPEN_STATUSES, isConfirmed, DOC_TYPES } from './models.js';
import { uid, nowISO, todayKey, clone, num, hasNum, money, fmtDateLong, fillTemplate, hashOf, safeFileName, pad2, fmtPhone, normPhone, parseAmount } from './util.js';

export const store = {
  adapter: null,
  settings: { ...DEFAULT_SETTINGS },
  counters: {},
  clients: [], events: [], documents: [], payments: [], activity: [],
  _subs: new Set(),
};

export function subscribe(fn) { store._subs.add(fn); return () => store._subs.delete(fn); }
function emit() { for (const fn of store._subs) { try { fn(); } catch (e) { console.error(e); } } }

export async function loadAll(adapter) {
  store.adapter = adapter;
  const d = await adapter.bootstrap();
  store.settings = { ...DEFAULT_SETTINGS, ...(d.settings || {}) };
  store.counters = d.counters || {};
  for (const t of ['clients', 'events', 'documents', 'payments', 'activity']) store[t] = d[t] || [];
  emit();
}

/* ---------------- low-level write helpers ---------------- */

function upsertLocal(table, rec) {
  const arr = store[table]; const i = arr.findIndex((r) => r.id === rec.id);
  if (i >= 0) arr[i] = rec; else arr.push(rec);
}
async function commit(ops) {
  await store.adapter.commit(ops);
  for (const o of ops) {
    if (o.op === 'put') upsertLocal(o.table, o.record);
    else store[o.table] = store[o.table].filter((r) => r.id !== o.id);
  }
  emit();
}
const put = (table, record) => ({ op: 'put', table, record });
function act(event, type, message) {
  return put('activity', { id: uid('a_'), eventId: event?.id || '', clientId: event?.clientId || '', type, message, at: nowISO() });
}

/* ---------------- lookups ---------------- */

export const getClient = (id) => store.clients.find((c) => c.id === id);
export const getEvent = (id) => store.events.find((e) => e.id === id);
export const getDoc = (id) => store.documents.find((d) => d.id === id);
export const clientEvents = (clientId) => store.events.filter((e) => e.clientId === clientId).sort(byDate);
export const eventPayments = (eventId) => store.payments.filter((p) => p.eventId === eventId).sort((a, b) => (a.date || '').localeCompare(b.date || '') || (a.createdAt || '').localeCompare(b.createdAt || ''));
export const eventActivity = (eventId) => store.activity.filter((a) => a.eventId === eventId).sort((a, b) => b.at.localeCompare(a.at));
export function eventDocs(eventId, type) {
  return store.documents.filter((d) => d.eventId === eventId && (!type || d.type === type))
    .sort((a, b) => (b.version - a.version) || b.issuedAt.localeCompare(a.issuedAt));
}
export function latestDoc(eventId, type) {
  return eventDocs(eventId, type).find((d) => d.status !== 'void') || null;
}
export function byDate(a, b) { return (a.primaryDate || '9999').localeCompare(b.primaryDate || '9999'); }

/** All calendar occurrences of an event (main date + additional dates) */
export function occurrences(ev) {
  const list = (ev.dates || []).filter((d) => d.date);
  if (!list.length && ev.primaryDate) return [{ id: 'main', date: ev.primaryDate, session: ev.session || '', label: '' }];
  // chronological, so a Roce ceremony is listed before the wedding that follows it
  return [...list].sort((a, b) => a.date.localeCompare(b.date) || (a.start || '').localeCompare(b.start || ''));
}
export function eventsOn(dateKey, { includeCancelled = true } = {}) {
  const out = [];
  for (const ev of store.events) {
    if (!includeCancelled && ev.status === 'cancelled') continue;
    for (const o of occurrences(ev)) if (o.date === dateKey) out.push({ ev, occ: o });
  }
  const order = { day: 1, fullday: 0, afternoon: 2, night: 3, '': 4 };
  return out.sort((a, b) => (order[a.occ.session] ?? 5) - (order[b.occ.session] ?? 5) || (a.occ.start || '').localeCompare(b.occ.start || ''));
}
export function lastDate(ev) {
  const ds = occurrences(ev).map((o) => o.date).sort();
  return ds[ds.length - 1] || ev.primaryDate || '';
}

/** Name used to address the client in documents, e.g. "Ms. Divya D'Costa and Mr. Xavier" */
export function addressedAs(ev, client = getClient(ev.clientId)) {
  if (ev.displayName) return ev.displayName;
  const f = (label) => (ev.customFields || []).find((c) => c.label.trim().toLowerCase() === label && c.value.trim())?.value.trim();
  const bride = f('bride'), groom = f('groom');
  if (bride && groom) return `${bride} and ${groom}`;
  return client?.name || '';
}

/* ---------------- money ---------------- */

const hasContent = (it) => !!(String(it.description || '').trim() || String(it.remarks || '').trim() || String(it.amount || '').trim());

/** Totals of the item amounts in one section. Blank amounts are simply not counted. */
export function sectionTotals(sec) {
  const t = { min: 0, max: 0, priced: 0, count: 0 };
  for (const it of sec?.items || []) {
    if (!hasContent(it)) continue;
    t.count++;
    const a = parseAmount(it.amount);
    if (a) { t.priced++; t.min += a.min; t.max += a.max; }
  }
  return t;
}
export function requirementTotals(sections) {
  const t = { min: 0, max: 0, priced: 0, count: 0 };
  for (const s of sections || []) { const x = sectionTotals(s); t.min += x.min; t.max += x.max; t.priced += x.priced; t.count += x.count; }
  return t;
}
/** The approximate budget is calculated from the requirement amounts (a range when any item is a range). */
export function computeBudget(sections, asDiscussed = true) {
  const t = requirementTotals(sections);
  if (!t.priced) return { min: '', max: '', text: '', asDiscussed, auto: true, partial: false };
  return { min: String(t.min), max: t.max !== t.min ? String(t.max) : '', text: '', asDiscussed, auto: true, partial: t.priced < t.count };
}

export function budgetText(b) {
  if (!b) return '';
  if (b.text && b.text.trim()) return b.text.trim();
  const sym = store.settings.currencySymbol || '₹';
  let s = '';
  if (hasNum(b.min) && hasNum(b.max) && num(b.max) !== num(b.min)) s = `${money(b.min, sym)} – ${money(b.max, sym)}`;
  else if (hasNum(b.min)) s = money(b.min, sym);
  else if (hasNum(b.max)) s = money(b.max, sym);
  if (s && b.asDiscussed) s += ' (as discussed)';
  return s;
}
export function budgetValue(b) {
  if (!b) return 0;
  return hasNum(b.max) ? num(b.max) : num(b.min);
}

export function financials(ev) {
  const b = ev.billing || {};
  const s = store.settings;
  const agreed = num(b.agreedAmount);
  const charges = (b.charges || []).filter((c) => c.label || hasNum(c.amount));
  const discounts = (b.discounts || []).filter((c) => c.label || hasNum(c.amount));
  const chargesTotal = charges.reduce((t, c) => t + num(c.amount), 0);
  const discountTotal = discounts.reduce((t, c) => t + num(c.amount), 0);
  const subtotal = agreed + chargesTotal - discountTotal;
  const applyTax = b.applyTax ?? !!s.taxEnabled;
  const taxRate = applyTax ? num(b.taxRate ?? s.taxRate) : 0;
  const tax = applyTax ? Math.round(subtotal * taxRate) / 100 : 0;
  const total = subtotal + tax;
  const pays = eventPayments(ev.id);
  const received = pays.reduce((t, p) => t + num(p.amount), 0);
  const hasAgreed = hasNum(b.agreedAmount);
  const reference = hasAgreed ? total : budgetValue(ev.budget);
  const balance = (hasAgreed ? total : reference) - received;
  let payStatus = 'Unpaid';
  if (hasAgreed && total > 0 && received >= total) payStatus = received > total ? 'Overpaid' : 'Paid in Full';
  else if (received > 0) payStatus = 'Partially Paid';
  return { agreed, hasAgreed, charges, discounts, chargesTotal, discountTotal, subtotal, applyTax, taxRate, taxLabel: b.taxLabel || s.taxLabel, tax, total, received, balance, payStatus, payments: pays, reference };
}

/* ---------------- document freshness ---------------- */

function docBasis(type, ev) {
  const c = getClient(ev.clientId) || {};
  const base = { name: c.name, phone: c.phone, title: ev.title, service: ev.service, venue: ev.venue, crowd: ev.crowd, dates: ev.dates, custom: ev.customFields, display: ev.displayName, session: ev.session };
  if (type === 'quotation') return { ...base, sections: ev.sections, budget: ev.budget, note: ev.quoteNote };
  if (type === 'confirmation') return { ...base, note: ev.confirmationNote };
  const f = financials(ev);
  return { ...base, sections: ev.billing?.includeScope ? ev.sections : null, billing: ev.billing, received: f.received, pays: f.payments.map((p) => [p.amount, p.date, p.method]) };
}
export const basisHash = (type, ev) => hashOf(docBasis(type, ev));
export function isStale(doc, ev) { return !!doc && !!doc.hash && doc.hash !== basisHash(doc.type, ev); }

/* ---------------- pending tasks (per event) ---------------- */

export function eventChecklist(ev) {
  const q = latestDoc(ev.id, 'quotation');
  const c = latestDoc(ev.id, 'confirmation');
  const inv = latestDoc(ev.id, 'invoice');
  const f = financials(ev);
  const cancelled = ev.status === 'cancelled';
  const past = lastDate(ev) && lastDate(ev) < todayKey();
  const items = [
    { key: 'quote', label: 'Quotation issued', done: !!q, stale: isStale(q, ev), detail: q ? `${q.number} · V${q.version}` : 'Not generated yet' },
    { key: 'confirm', label: 'Booking confirmed', done: isConfirmed(ev.status), detail: STATUS[ev.status]?.label },
    { key: 'letter', label: 'Confirmation letter issued', done: !!c, stale: isStale(c, ev), detail: c ? c.number : (isConfirmed(ev.status) ? 'Ready to generate' : 'After confirmation'), disabled: !isConfirmed(ev.status) && !c },
    { key: 'advance', label: 'Advance received', done: f.received > 0, detail: f.received > 0 ? money(f.received) : 'No payments yet' },
    { key: 'complete', label: 'Event completed', done: ev.status === 'completed', detail: ev.status === 'completed' ? 'Marked completed' : (past ? 'Event date has passed' : 'Upcoming') },
    { key: 'invoice', label: 'Final invoice issued', done: !!inv, stale: isStale(inv, ev), detail: inv ? inv.number : 'Not generated yet' },
    { key: 'paid', label: 'Balance cleared', done: f.hasAgreed && f.balance <= 0, detail: f.hasAgreed ? (f.balance > 0 ? `${money(f.balance)} outstanding` : 'Fully paid') : 'Final amount not set' },
  ];
  return cancelled ? items.map((i) => ({ ...i, disabled: !i.done })) : items;
}

/* ---------------- clients & events ---------------- */

export function findClientByPhone(phone, exceptId) {
  const d = String(phone || '').replace(/\D/g, '').slice(-10);
  if (d.length < 10) return null;
  return store.clients.find((c) => c.id !== exceptId && String(c.phone || '').replace(/\D/g, '').slice(-10) === d) || null;
}

export async function saveClient(data) {
  const prev = data.id ? getClient(data.id) : null;
  const rec = { ...(prev || {}), ...data, id: data.id || uid('c_'), createdAt: prev?.createdAt || nowISO(), updatedAt: nowISO() };
  await commit([put('clients', rec)]);
  return rec;
}

function normaliseEvent(ev) {
  ev.dates = (ev.dates || []).filter((d) => d.date || d.label);
  const dated = ev.dates.filter((d) => d.date).sort((a, b) => a.date.localeCompare(b.date));
  // primary date = first entry (the main date); fall back to earliest
  ev.primaryDate = ev.dates[0]?.date || dated[0]?.date || '';
  ev.session = ev.dates[0]?.session || '';
  ev.customFields = (ev.customFields || []).filter((c) => c.label.trim() || c.value.trim());
  ev.sections = (ev.sections || []).map((s) => ({ ...s, items: (s.items || []).filter(hasContent) }))
    .filter((s) => s.title.trim() || s.items.length);
  // budget follows the item amounts; an old hand-typed budget is kept only while no item has an amount
  const legacy = ev.budget && !ev.budget.auto && (ev.budget.min || ev.budget.max || ev.budget.text);
  if (!(legacy && !requirementTotals(ev.sections).priced)) ev.budget = computeBudget(ev.sections, ev.budget?.asDiscussed ?? true);
  return ev;
}

/**
 * Create or update an event (and its client) in one atomic commit.
 * client: { id?, name, phone, ... } — reused when id given.
 */
function clientOps(clientIn) {
  const ops = [];
  let client = clientIn.id ? { ...getClient(clientIn.id), ...clientIn } : { ...clientIn, id: uid('c_'), createdAt: nowISO() };
  client.updatedAt = nowISO();
  const prevClient = clientIn.id ? getClient(clientIn.id) : null;
  if (!prevClient || JSON.stringify({ ...prevClient, updatedAt: 0 }) !== JSON.stringify({ ...client, updatedAt: 0 })) ops.push(put('clients', client));
  return { client, ops };
}

function eventOps(evIn, client) {
  const ops = [];
  const prev = evIn.id ? getEvent(evIn.id) : null;
  const ev = normaliseEvent({ ...(prev || {}), ...clone(evIn), clientId: client.id });
  if (!prev) {
    ev.id = uid('e_'); ev.createdAt = nowISO(); ev.status = ev.status || 'enquiry';
    ops.push(act(ev, 'created', `Enquiry created for ${ev.title || 'event'}`));
  } else {
    if (prev.primaryDate && ev.primaryDate && prev.primaryDate !== ev.primaryDate) {
      ops.push(act(ev, 'rescheduled', `Rescheduled from ${fmtDateLong(prev.primaryDate)} to ${fmtDateLong(ev.primaryDate)}`));
    }
    const reqChanged = JSON.stringify(prev.sections || []) !== JSON.stringify(ev.sections || []);
    const budgetChanged = JSON.stringify(prev.budget || {}) !== JSON.stringify(ev.budget || {});
    if (reqChanged) ops.push(act(ev, 'requirements', `Requirements updated (${countItems(ev)} items in ${ev.sections.length} section${ev.sections.length === 1 ? '' : 's'})`));
    if (budgetChanged) ops.push(act(ev, 'budget', `Approximate budget set to ${budgetText(ev.budget) || '—'}`));
    if (!reqChanged && !budgetChanged && prev.primaryDate === ev.primaryDate) ops.push(act(ev, 'updated', 'Event details updated'));
  }
  ev.updatedAt = nowISO();
  ops.push(put('events', ev));
  return { ev, ops };
}

export async function saveEvent(evIn, clientIn) {
  const c = clientOps(clientIn);
  const e = eventOps(evIn, c.client);
  await commit([...c.ops, ...e.ops]);
  return e.ev;
}

/** Save one client with one or more separate events (each date is its own event) in a single commit. */
export async function saveEnquiry(eventsIn, clientIn) {
  const c = clientOps(clientIn);
  const ops = [...c.ops]; const saved = [];
  for (const evIn of eventsIn) { const e = eventOps(evIn, c.client); ops.push(...e.ops); saved.push(e.ev); }
  await commit(ops);
  return { client: c.client, events: saved };
}
export const countItems = (ev) => (ev.sections || []).reduce((t, s) => t + (s.items || []).length, 0);

export async function saveRequirements(eventId, sections, budget) {
  const ev = getEvent(eventId);
  return saveEvent({ ...ev, sections, ...(budget !== undefined ? { budget } : {}) }, getClient(ev.clientId));
}

const STATUS_MSG = {
  confirmed: 'Booking confirmed', quoted: 'Marked as not confirmed', changes: 'Client requested changes',
  completed: 'Event marked as completed', cancelled: 'Booking cancelled', enquiry: 'Moved back to enquiry',
};
export async function setStatus(eventId, status, { reason = '' } = {}) {
  const ev = { ...getEvent(eventId) };
  const from = ev.status;
  if (from === status) return ev;
  ev.status = status; ev.updatedAt = nowISO();
  if (status === 'confirmed' && !ev.confirmedAt) ev.confirmedAt = nowISO();
  if (status === 'completed') ev.completedAt = nowISO();
  if (status === 'cancelled') { ev.cancelledAt = nowISO(); ev.cancelReason = reason; }
  let msg = STATUS_MSG[status] || `Status changed to ${STATUS[status].label}`;
  if (from === 'cancelled') msg = `Booking restored (${STATUS[status].label})`;
  if (status === 'cancelled' && reason) msg += ` — ${reason}`;
  await commit([put('events', ev), act(ev, from === 'cancelled' ? 'restored' : status, msg)]);
  return ev;
}

export async function deleteEvent(eventId) {
  const ev = getEvent(eventId);
  const ops = [{ op: 'del', table: 'events', id: eventId }];
  for (const p of eventPayments(eventId)) ops.push({ op: 'del', table: 'payments', id: p.id });
  for (const a of store.activity.filter((x) => x.eventId === eventId)) ops.push({ op: 'del', table: 'activity', id: a.id });
  await commit(ops);
  return ev;
}

export async function saveBilling(eventId, billing) {
  const ev = { ...getEvent(eventId), billing: clone(billing), updatedAt: nowISO() };
  await commit([put('events', ev), act(ev, 'billing', `Final bill draft saved (total ${money(financials(ev).total)})`)]);
  return ev;
}

/* ---------------- payments ---------------- */

export async function savePayment(p) {
  const ev = getEvent(p.eventId);
  const prev = p.id ? store.payments.find((x) => x.id === p.id) : null;
  const rec = { ...(prev || {}), ...p, amount: num(p.amount), clientId: ev.clientId, id: p.id || uid('p_'), createdAt: prev?.createdAt || nowISO(), updatedAt: nowISO() };
  const kind = rec.kind || 'Payment';
  const msg = prev ? `${kind} updated: ${money(rec.amount)} (${rec.method})` : `${kind} received: ${money(rec.amount)} via ${rec.method} on ${fmtDateLong(rec.date)}`;
  await commit([put('payments', rec), act(ev, 'payment', msg)]);
  return rec;
}
export async function deletePayment(id) {
  const p = store.payments.find((x) => x.id === id); const ev = getEvent(p.eventId);
  await commit([{ op: 'del', table: 'payments', id }, act(ev, 'payment', `Payment removed: ${money(p.amount)} (${p.method}, ${fmtDateLong(p.date)})`)]);
}

/* ---------------- settings & numbering ---------------- */

export async function saveSettings(partial) {
  await store.adapter.saveSettings(partial);
  store.settings = { ...store.settings, ...partial };
  emit();
}

export function seriesKey(type, year) {
  const fmt = numberFormat(type);
  const t = type === 'confirmation' && store.settings.confirmationMode === 'quotation' ? 'quotation' : type;
  return fmt.includes('{YYYY}') || fmt.includes('{YY}') ? `${t}-${year}` : t;
}
function numberFormat(type) {
  const s = store.settings;
  if (type === 'invoice') return s.invoiceFormat;
  if (type === 'confirmation' && s.confirmationMode !== 'quotation') return s.confirmationFormat;
  return s.quoteFormat;
}
export function formatNumber(type, seq, year) {
  const s = store.settings;
  return numberFormat(type)
    .replace('{PREFIX}', s.numberPrefix || '')
    .replace('{YYYY}', year).replace('{YY}', String(year).slice(-2))
    .replace('{SEQ}', String(seq).padStart(Number(s.seqDigits) || 3, '0'));
}
export const peekNext = (type, year = new Date().getFullYear()) => formatNumber(type, (Number(store.counters[seriesKey(type, year)]) || 0) + 1, year);
export async function setCounter(type, nextValue, year = new Date().getFullYear()) {
  const key = seriesKey(type, year);
  await store.adapter.setCounter(key, Number(nextValue) - 1);
  store.counters[key] = Number(nextValue) - 1; emit();
}

async function allocate(type) {
  const year = new Date().getFullYear();
  const key = seriesKey(type, year);
  const used = new Set(store.documents.map((d) => d.baseNumber).concat(store.events.map((e) => e.refNo)).filter(Boolean));
  for (let guard = 0; guard < 500; guard++) {
    const seq = await store.adapter.nextNumber(key);
    store.counters[key] = seq;
    const n = formatNumber(type, seq, year);
    if (!used.has(n)) return n;
  }
  throw new Error('Could not allocate a unique number. Check the numbering settings.');
}

/* ---------------- documents ---------------- */

export function docVars(ev, extra = {}) {
  const s = store.settings; const c = getClient(ev.clientId) || {};
  const occ = occurrences(ev);
  return {
    clientName: addressedAs(ev, c), eventName: ev.title || 'event', service: ev.service || 'event management',
    venue: ev.venue || '', company: s.companyName, proprietor: s.proprietor,
    eventDate: occ.map((o) => fmtDateLong(o.date)).join(', ') || 'the scheduled date',
    ...extra,
  };
}
export function defaultNote(type, ev) {
  const s = store.settings;
  const override = type === 'quotation' ? ev.quoteNote : type === 'confirmation' ? ev.confirmationNote : ev.billing?.terms;
  if (override && override.trim()) return override;
  const tpl = type === 'quotation' ? s.quoteNote : type === 'confirmation' ? s.confirmationNote : s.invoiceTerms;
  return fillTemplate(tpl, docVars(ev));
}

/** Everything the PDF needs, frozen at the moment of issue */
export function buildSnapshot(type, ev, { number, version, note, issuedAt = todayKey(), preview = false }) {
  const s = store.settings; const c = getClient(ev.clientId) || {};
  const f = financials(ev);
  return {
    type, number, version, preview, issuedAt, generatedAt: nowISO(),
    company: {
      name: s.companyName, tagline: s.tagline, address: s.address, phone: s.phone, email: s.email,
      proprietor: s.proprietor, signatoryTitle: s.signatoryTitle,
      signatureText: fillTemplate(s.signatureText, { proprietor: s.proprietor, company: s.companyName }),
      currencySymbol: s.currencySymbol || '₹', paymentDetails: s.paymentDetails,
      subtitle: fillTemplate(type === 'quotation' ? s.quoteSubtitle : type === 'confirmation' ? s.confirmationSubtitle : s.invoiceSubtitle, { company: s.companyName }),
    },
    client: { name: c.name, phone: c.phone ? fmtPhone(normPhone(c.phone, s.countryCode || '91')) : '', altPhone: c.altPhone, email: c.email, address: c.address },
    addressedAs: addressedAs(ev, c),
    event: clone({ title: ev.title, service: ev.service, venue: ev.venue, crowd: ev.crowd || '', dates: occurrences(ev), customFields: ev.customFields || [], status: ev.status }),
    sections: type === 'confirmation' ? [] : (type === 'invoice' && !ev.billing?.includeScope ? [] : clone(ev.sections || [])),
    budget: budgetText(ev.budget), budgetPartial: !!ev.budget?.partial,
    note,
    finance: type === 'invoice' ? {
      ...clone({ agreed: f.agreed, charges: f.charges, discounts: f.discounts, subtotal: f.subtotal, applyTax: f.applyTax, taxRate: f.taxRate, taxLabel: f.taxLabel, tax: f.tax, total: f.total, received: f.received, balance: f.total - f.received, payStatus: f.payStatus }),
      payments: f.payments.map((p) => ({ date: p.date, kind: p.kind || '', method: p.method, reference: p.reference, amount: num(p.amount) })),
      dueDate: ev.billing?.dueDate || '', remarks: ev.billing?.remarks || '', showPayments: ev.billing?.showPayments !== false,
    } : null,
  };
}

export function nextVersionInfo(type, ev) {
  const docs = eventDocs(ev.id, type);
  const version = (docs[0]?.version || 0) + 1;
  let base = docs.find((d) => d.version === 1)?.baseNumber || docs[0]?.baseNumber || '';
  if (!base && type === 'quotation' && ev.refNo) base = ev.refNo;
  if (!base && type === 'confirmation' && store.settings.confirmationMode === 'quotation' && ev.refNo) base = ev.refNo;
  const number = base ? (version === 1 ? base : `${base}-R${version - 1}`) : '';
  return { version, base, number, previous: docs[0] || null };
}

/**
 * Issue a document: allocate a number, render the PDF, store the file + record,
 * supersede older versions and update the event — all tied to the same event record.
 * render(snapshot) -> Promise<Blob>
 */
export async function issueDocument(type, eventId, { note, render }) {
  let ev = { ...getEvent(eventId) };
  if (type === 'confirmation' && !isConfirmed(ev.status)) throw new Error('Confirm the booking before issuing a confirmation letter.');
  const info = nextVersionInfo(type, ev);
  let base = info.base;
  if (!base) {
    if (type === 'quotation' || (type === 'confirmation' && store.settings.confirmationMode === 'quotation')) {
      base = ev.refNo || await allocate('quotation');
      ev.refNo = base;
    } else base = await allocate(type);
  }
  const number = info.version === 1 ? base : `${base}-R${info.version - 1}`;
  const snapshot = buildSnapshot(type, ev, { number, version: info.version, note });
  const blob = await render(snapshot);
  const client = getClient(ev.clientId) || {};
  const label = DOC_TYPES[type].label;
  const doc = {
    id: uid('d_'), eventId: ev.id, clientId: ev.clientId, type, number, baseNumber: base, version: info.version,
    status: 'issued', issuedAt: nowISO(), title: `${label}${info.version > 1 ? ` (Revision ${info.version - 1})` : ''}`,
    total: type === 'invoice' ? snapshot.finance.total : budgetValue(ev.budget),
    fileName: safeFileName(`${label} ${number.replace(/\//g, '-')} - ${client.name || ev.title}.pdf`),
    hash: basisHash(type, ev), snapshot, createdAt: nowISO(), updatedAt: nowISO(),
  };
  doc._clientFolder = safeFileName(`${client.name || 'Client'} (${(client.phone || '').replace(/\D/g, '').slice(-4) || client.id})`);
  const file = await store.adapter.saveFile(doc, blob);
  delete doc._clientFolder;
  doc.fileId = file.fileId || ''; doc.fileUrl = file.fileUrl || '';

  const ops = [];
  if (info.previous && info.previous.status === 'issued') ops.push(put('documents', { ...info.previous, status: 'superseded', updatedAt: nowISO() }));
  ops.push(put('documents', doc));
  if (type === 'quotation' && ['enquiry', 'changes'].includes(ev.status)) ev.status = 'quoted';
  ev.updatedAt = nowISO();
  ops.push(put('events', ev));
  const verb = info.version > 1 ? `Revised ${label.toLowerCase()} generated` : `${label} generated`;
  ops.push(act(ev, type, `${verb}: ${number}${info.version > 1 ? ` (V${info.version}, replaces V${info.version - 1})` : ''}`));
  await commit(ops);
  return { doc, blob };
}

export async function logShare(doc, how) {
  const ev = getEvent(doc.eventId);
  const rec = { ...doc, sharedAt: nowISO(), updatedAt: nowISO() };
  await commit([put('documents', rec), act(ev, 'share', `${DOC_TYPES[doc.type].label} ${doc.number} — ${how}`)]);
}
export async function logActivity(eventId, type, message) {
  const ev = getEvent(eventId); await commit([act(ev, type, message)]);
}
export async function setDocPublicUrl(doc, url) {
  await commit([put('documents', { ...doc, publicUrl: url, updatedAt: nowISO() })]);
}

const fileCache = new Map();
export async function getDocBlob(doc) {
  if (fileCache.has(doc.id)) return fileCache.get(doc.id);
  let b = await store.adapter.getFile(doc).catch(() => null);
  if (!b) {
    // rebuild the issued PDF from its frozen snapshot (same number, date, items and amounts)
    const snap = doc.snapshot || (await store.adapter.getRecord('documents', doc.id))?.snapshot;
    if (!snap) return null;
    const { renderPdf } = await import('./pdf.js');
    b = await renderPdf(snap);
  }
  fileCache.set(doc.id, b);
  return b;
}
export function cacheDocBlob(id, blob) { fileCache.set(id, blob); }

/* ---------------- dashboard metrics ---------------- */

export function metrics() {
  const t = todayKey();
  const d = new Date(); const monthPrefix = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;
  const week = new Date(); week.setDate(week.getDate() + 7);
  const weekKey = `${week.getFullYear()}-${pad2(week.getMonth() + 1)}-${pad2(week.getDate())}`;
  const live = store.events.filter((e) => e.status !== 'cancelled');
  const upcoming = live.filter((e) => lastDate(e) >= t && e.status !== 'completed');
  return {
    upcoming,
    confirmed: upcoming.filter((e) => e.status === 'confirmed'),
    pending: upcoming.filter((e) => OPEN_STATUSES.includes(e.status)),
    thisMonth: live.filter((e) => occurrences(e).some((o) => o.date.startsWith(monthPrefix))),
    awaiting: live.filter((e) => ['quoted', 'changes'].includes(e.status)),
    week: upcoming.filter((e) => occurrences(e).some((o) => o.date >= t && o.date <= weekKey)),
    outstanding: store.events.filter((e) => e.status !== 'cancelled' && financials(e).hasAgreed && financials(e).balance > 0),
    toComplete: live.filter((e) => e.status === 'confirmed' && lastDate(e) && lastDate(e) < t),
  };
}
