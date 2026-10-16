// Reusable UI pieces: toasts, modals, confirms, badges, busy buttons.

import { icon } from './icons.js';
import { esc } from './util.js';
import { STATUS, SESSIONS } from './models.js';

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function h(html) {
  const t = document.createElement('template'); t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

/* ---------------- toasts ---------------- */

export function toast(message, { type = 'success', timeout = 3600, action } = {}) {
  let wrap = $('#toasts');
  if (!wrap) { wrap = h('<div id="toasts" class="toasts" role="status" aria-live="polite"></div>'); document.body.appendChild(wrap); }
  const ic = { success: 'circle-check', error: 'circle-alert', info: 'info', warn: 'triangle-alert' }[type];
  const el = h(`<div class="toast toast-${type}">${icon(ic)}<span>${esc(message)}</span>${action ? `<button class="toast-act">${esc(action.label)}</button>` : ''}<button class="toast-x" aria-label="Dismiss">${icon('x')}</button></div>`);
  const close = () => { el.classList.add('out'); setTimeout(() => el.remove(), 250); };
  el.querySelector('.toast-x').onclick = close;
  if (action) el.querySelector('.toast-act').onclick = () => { action.run(); close(); };
  wrap.appendChild(el);
  while (wrap.children.length > 3) wrap.firstElementChild.remove();
  if (timeout) setTimeout(close, type === 'error' ? timeout * 2 : timeout);
}
export const toastError = (e) => {
  console.error(e);
  if (e?.code === 'AUTH' && window.__onAuth) return window.__onAuth();
  toast(e?.message || String(e), { type: 'error' });
};

/* ---------------- modal ---------------- */

/**
 * modal({ title, body (html|Element), actions: [{label, kind, run(close, el) }], size })
 * Returns { el, close }.
 */
export function modal({ title, subtitle = '', body = '', actions = [], size = 'md', onClose, icon: ic, dismissible = true }) {
  const back = h(`<div class="modal-back"><div class="modal modal-${size}" role="dialog" aria-modal="true" aria-label="${esc(title)}">
    <header class="modal-head">${ic ? `<span class="modal-ic">${icon(ic)}</span>` : ''}<div><h2>${esc(title)}</h2>${subtitle ? `<p>${esc(subtitle)}</p>` : ''}</div>
      ${dismissible ? `<button class="icon-btn modal-close" aria-label="Close">${icon('x')}</button>` : ''}</header>
    <div class="modal-body"></div>
    ${actions.length ? '<footer class="modal-foot"></footer>' : ''}
  </div></div>`);
  const bodyEl = back.querySelector('.modal-body');
  if (typeof body === 'string') bodyEl.innerHTML = body; else bodyEl.appendChild(body);
  let closed = false;
  const close = (v) => {
    if (closed) return; closed = true;
    back.classList.add('out'); document.removeEventListener('keydown', onKey);
    setTimeout(() => back.remove(), 200);
    document.body.classList.toggle('no-scroll', $$('.modal-back:not(.out)').length > 0);
    onClose?.(v);
  };
  const onKey = (e) => { if (e.key === 'Escape' && dismissible && back === $$('.modal-back').at(-1)) close(); };
  document.addEventListener('keydown', onKey);
  if (dismissible) {
    back.querySelector('.modal-close').onclick = () => close();
    back.addEventListener('mousedown', (e) => { if (e.target === back) close(); });
  }
  const foot = back.querySelector('.modal-foot');
  for (const a of actions) {
    const b = h(`<button class="btn btn-${a.kind || 'secondary'}">${a.icon ? icon(a.icon) : ''}<span>${esc(a.label)}</span></button>`);
    if (a.id) b.dataset.act = a.id;
    b.onclick = async () => {
      if (!a.run) return close();
      try { await busy(b, () => a.run(close, back)); } catch (e) { toastError(e); }
    };
    foot.appendChild(b);
  }
  document.body.appendChild(back);
  document.body.classList.add('no-scroll');
  requestAnimationFrame(() => {
    back.classList.add('in');
    const f = back.querySelector('[autofocus], .modal-body input:not([type=hidden]):not([type=checkbox]), .modal-body textarea');
    if (f && window.matchMedia('(pointer:fine)').matches) f.focus();
  });
  return { el: back, close };
}

export function confirmDialog({ title, message, confirm = 'Confirm', kind = 'primary', icon: ic = 'circle-alert', input }) {
  return new Promise((resolve) => {
    let result = false;
    const body = `<p class="confirm-msg">${message}</p>${input ? `<label class="field"><span>${esc(input.label)}</span><input class="input" id="confirm-input" placeholder="${esc(input.placeholder || '')}"></label>` : ''}`;
    modal({
      title, body, icon: ic, size: 'sm',
      actions: [
        { label: 'Go back', kind: 'ghost' },
        { label: confirm, kind, run: (close, el) => { result = input ? { value: el.querySelector('#confirm-input').value } : true; close(); } },
      ],
      onClose: () => resolve(result),
    });
  });
}

/* ---------------- busy state ---------------- */

export async function busy(btn, fn) {
  if (!btn) return fn();
  if (btn.disabled) return;
  btn.disabled = true; btn.classList.add('is-busy');
  try { return await fn(); } finally { btn.disabled = false; btn.classList.remove('is-busy'); }
}

/* ---------------- badges & bits ---------------- */

export function statusBadge(status, { size = '' } = {}) {
  const s = STATUS[status] || STATUS.enquiry;
  return `<span class="badge tone-${s.tone} ${size}"><i class="dot"></i>${esc(s.label)}</span>`;
}
export function bookingBadge(status) {
  const s = STATUS[status] || STATUS.enquiry;
  const tone = s.booking === 'Confirmed' ? 'green' : s.booking === 'Cancelled' ? 'red' : 'amber';
  return `<span class="badge tone-${tone}"><i class="dot"></i>${esc(s.booking)}</span>`;
}
export function sessionTag(session) {
  const s = SESSIONS[session]; if (!s) return '';
  return `<span class="session-tag">${esc(s.label)}</span>`;
}
export function emptyState({ icon: ic = 'sparkles', title, text = '', action = '' }) {
  return `<div class="empty"><div class="empty-ic">${icon(ic)}</div><h3>${esc(title)}</h3>${text ? `<p>${text}</p>` : ''}${action}</div>`;
}
export function autoGrow(ta) {
  const fit = () => { ta.style.height = 'auto'; ta.style.height = ta.scrollHeight + 2 + 'px'; };
  ta.addEventListener('input', fit); requestAnimationFrame(fit);
  return fit;
}
export function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}
