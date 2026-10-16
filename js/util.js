// Shared helpers: ids, escaping, dates, money and text formatting.

export const uid = (p = '') =>
  p + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

export const nowISO = () => new Date().toISOString();

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ESC[c]);

export const clone = (o) => (o == null ? o : JSON.parse(JSON.stringify(o)));

export function debounce(fn, ms = 250) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

/* ---------- Dates (all event dates are local "YYYY-MM-DD" strings) ---------- */

export const pad2 = (n) => String(n).padStart(2, '0');
export const toKey = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
export const todayKey = () => toKey(new Date());
export function parseKey(k) {
  if (!k) return null;
  const [y, m, d] = String(k).slice(0, 10).split('-').map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d);
}
export function addDays(k, n) { const d = parseKey(k); d.setDate(d.getDate() + n); return toKey(d); }
export function diffDays(a, b) { return Math.round((parseKey(a) - parseKey(b)) / 86400000); }

export const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export function ordinal(n) {
  const s = ['th', 'st', 'nd', 'rd'], v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}
/** "17th December 2026" — the style used in the reference documents */
export function fmtDateLong(k) {
  const d = parseKey(k); if (!d) return '';
  return `${ordinal(d.getDate())} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}
/** "Thu, 17 Dec 2026" */
export function fmtDate(k, { weekday = true, year = true } = {}) {
  const d = parseKey(k); if (!d) return '';
  const parts = [];
  if (weekday) parts.push(WEEKDAYS[d.getDay()].slice(0, 3) + ',');
  parts.push(d.getDate(), MONTHS[d.getMonth()].slice(0, 3));
  if (year) parts.push(d.getFullYear());
  return parts.join(' ');
}
export function fmtDateTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  let h = d.getHours(); const m = pad2(d.getMinutes()); const ap = h >= 12 ? 'pm' : 'am';
  h = h % 12 || 12;
  return `${d.getDate()} ${MONTHS[d.getMonth()].slice(0, 3)} ${d.getFullYear()}, ${h}:${m} ${ap}`;
}
export function fmtTime(t) {
  if (!t) return '';
  const [H, M] = t.split(':').map(Number);
  const ap = H >= 12 ? 'pm' : 'am';
  return `${H % 12 || 12}${M ? ':' + pad2(M) : ''} ${ap}`;
}
export function relDays(k) {
  const n = diffDays(k, todayKey());
  if (n === 0) return 'Today';
  if (n === 1) return 'Tomorrow';
  if (n === -1) return 'Yesterday';
  if (n > 1 && n < 7) return `In ${n} days`;
  if (n < 0) return `${-n} days ago`;
  return `In ${n} days`;
}

/* ---------- Money (INR, Indian digit grouping) ---------- */

export function num(v) {
  if (v === '' || v == null) return 0;
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/[^0-9.\-]/g, ''));
  return Number.isFinite(n) ? n : 0;
}
export function hasNum(v) { return v !== '' && v != null && Number.isFinite(num(v)) && String(v).trim() !== ''; }

export function groupIN(n, decimals = 0) {
  const neg = n < 0; n = Math.abs(n);
  const [int, dec] = n.toFixed(decimals).split('.');
  let last3 = int.slice(-3), rest = int.slice(0, -3);
  if (rest) last3 = ',' + last3;
  rest = rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',');
  return (neg ? '-' : '') + rest + last3 + (dec && Number(dec) ? '.' + dec : '');
}
export function money(n, sym = '₹') {
  const v = num(n);
  const hasPaise = Math.round(v * 100) % 100 !== 0;
  return sym + groupIN(v, hasPaise ? 2 : 0);
}
/** Compact lakhs helper, e.g. 850000 -> "8.5 lakhs" */
export function lakhs(n) {
  const v = num(n);
  if (v >= 1e7) return `${+(v / 1e7).toFixed(2)} crore`;
  if (v >= 1e5) return `${+(v / 1e5).toFixed(2)} lakh${v === 1e5 ? '' : 's'}`;
  return '';
}

const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
function words2(n) { return n < 20 ? ONES[n] : TENS[Math.floor(n / 10)] + (n % 10 ? ' ' + ONES[n % 10] : ''); }
function words3(n) {
  const h = Math.floor(n / 100), r = n % 100;
  return [h ? ONES[h] + ' Hundred' : '', r ? words2(r) : ''].filter(Boolean).join(' ');
}
/** Indian-system amount in words: "Rupees Eight Lakh Fifty Thousand Only" */
export function amountInWords(amount) {
  let n = Math.floor(Math.abs(num(amount)));
  const paise = Math.round((Math.abs(num(amount)) - n) * 100);
  if (n === 0 && !paise) return 'Rupees Zero Only';
  const parts = [];
  const crore = Math.floor(n / 1e7); n %= 1e7;
  const lakh = Math.floor(n / 1e5); n %= 1e5;
  const thousand = Math.floor(n / 1000); n %= 1000;
  if (crore) parts.push(words3(crore) + ' Crore');
  if (lakh) parts.push(words2(lakh) + ' Lakh');
  if (thousand) parts.push(words2(thousand) + ' Thousand');
  if (n) parts.push(words3(n));
  let s = 'Rupees ' + parts.join(' ');
  if (paise) s += ' and ' + words2(paise) + ' Paise';
  return s + ' Only';
}

/* ---------- Text ---------- */

export const initials = (name) =>
  String(name || '?').replace(/^(mr|mrs|ms|dr|miss)\.?\s+/i, '').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('') || '?';

export function normPhone(p, cc = '91') {
  let d = String(p || '').replace(/\D/g, '');
  if (!d) return '';
  if (d.length === 11 && d.startsWith('0')) d = d.slice(1);
  if (d.length === 10) d = cc + d;
  return d;
}
export function fmtPhone(p) {
  const d = String(p || '').replace(/\D/g, '');
  if (d.length === 12 && d.startsWith('91')) return `+91 ${d.slice(2, 7)} ${d.slice(7)}`;
  if (d.length === 10) return `${d.slice(0, 5)} ${d.slice(5)}`;
  return p || '';
}

export function fillTemplate(tpl, vars) {
  return String(tpl || '').replace(/\{(\w+)\}/g, (m, k) => (vars[k] != null && vars[k] !== '' ? vars[k] : m));
}

export function safeFileName(s) {
  return String(s).replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ').trim().slice(0, 120);
}

/** Small stable hash for "is this document out of date?" checks */
export function hashOf(obj) {
  const s = JSON.stringify(obj);
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(36);
}

export function blobToBase64(blob) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result).split(',')[1]);
    r.onerror = rej;
    r.readAsDataURL(blob);
  });
}
export function base64ToBlob(b64, type = 'application/pdf') {
  const bin = atob(b64); const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type });
}
export function fileToDataURL(file) {
  return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(file); });
}
/** Downscale an uploaded image to keep storage and PDFs light */
export async function shrinkImage(dataUrl, maxW = 1000) {
  const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = dataUrl; });
  if (img.width <= maxW) return dataUrl;
  const c = document.createElement('canvas');
  c.width = maxW; c.height = Math.round(img.height * (maxW / img.width));
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  return c.toDataURL('image/png');
}
