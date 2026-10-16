// Requirements editor: unlimited sections, each with unlimited rows of
// Description / Remarks / optional Amount (a fixed figure or a range such as 20000-45000).
// Section totals and the overall total update as you type.
// Fast keyboard entry: Enter moves Description → Remarks → Amount → new row; Shift+Enter adds a line break.

import { icon } from '../icons.js';
import { esc, uid, clone, parseAmount, moneyRange } from '../util.js';
import { sectionTotals, requirementTotals } from '../store.js';
import { modal, autoGrow, confirmDialog, toast } from '../ui.js';

const blankItem = () => ({ id: uid('i_'), description: '', remarks: '', amount: '' });
const blankSection = (title = '') => ({ id: uid('s_'), title, items: [blankItem()] });
const FIELDS = ['description', 'remarks', 'amount'];

export function totalText(t, { empty = '' } = {}) {
  if (!t.priced) return empty;
  return moneyRange(t.min, t.max);
}

export function mountReqEditor(mountEl, initial, { onChange } = {}) {
  // own container per mount, so re-mounting (switching events) never stacks old listeners
  const el = document.createElement('div');
  mountEl.replaceChildren(el);
  let sections = clone(initial || []);
  for (const s of sections) for (const it of s.items || []) if (it.amount == null) it.amount = '';
  const changed = () => { paintTotals(); onChange?.(sections); };

  function itemRow(sec, it, i) {
    const bad = parseAmount(it.amount) === undefined;
    return `<div class="req-row" data-item="${it.id}">
      <span class="req-grip" draggable="true" title="Drag to reorder">${icon('grip-vertical')}</span>
      <span class="req-no">${i + 1}</span>
      <textarea class="req-in req-desc" rows="1" data-f="description" placeholder="Description of service / item">${esc(it.description)}</textarea>
      <textarea class="req-in req-rem" rows="1" data-f="remarks" placeholder="Remarks (optional)">${esc(it.remarks)}</textarea>
      <input class="req-in req-amt${bad ? ' invalid' : ''}" data-f="amount" inputmode="text" value="${esc(it.amount || '')}" placeholder="Amount" title="Optional. A figure (25000) or a range (20000-45000)">
      <span class="req-acts">
        <button type="button" class="icon-btn sm" data-a="up" title="Move up (Alt+↑)">${icon('arrow-up')}</button>
        <button type="button" class="icon-btn sm" data-a="down" title="Move down (Alt+↓)">${icon('arrow-down')}</button>
        <button type="button" class="icon-btn sm" data-a="insert" title="Insert row below">${icon('list-plus')}</button>
        <button type="button" class="icon-btn sm danger" data-a="del" title="Delete row">${icon('trash-2')}</button>
      </span>
    </div>`;
  }

  function sectionCard(sec, si) {
    const n = sec.items.length;
    return `<section class="req-sec${sec._collapsed ? ' collapsed' : ''}" data-sec="${sec.id}">
      <header class="req-sec-head">
        <span class="req-grip sec-grip" draggable="true" title="Drag section">${icon('grip-vertical')}</span>
        <span class="req-sec-no">${si + 1}</span>
        <input class="req-title" value="${esc(sec.title)}" placeholder="Section heading — e.g. Decoration, Lighting, Sound System" data-f="title">
        <span class="req-count">${n} item${n === 1 ? '' : 's'}</span>
        <span class="req-sec-acts">
          <button type="button" class="icon-btn sm" data-sa="up" title="Move section up">${icon('arrow-up')}</button>
          <button type="button" class="icon-btn sm" data-sa="down" title="Move section down">${icon('arrow-down')}</button>
          <button type="button" class="icon-btn sm" data-sa="collapse" title="Collapse / expand">${icon(sec._collapsed ? 'chevron-down' : 'chevron-up')}</button>
          <button type="button" class="icon-btn sm danger" data-sa="del" title="Remove section">${icon('trash-2')}</button>
        </span>
      </header>
      <div class="req-body">
        <div class="req-cols"><span></span><span>No.</span><span>Description</span><span>Remarks</span><span class="r">Amount</span><span></span></div>
        <div class="req-rows">${sec.items.map((it, i) => itemRow(sec, it, i)).join('')}</div>
        <div class="req-sec-foot">
          <button type="button" class="btn btn-ghost btn-sm" data-sa="add">${icon('plus')}<span>Add item</span></button>
          <button type="button" class="btn btn-ghost btn-sm" data-sa="paste">${icon('clipboard-list')}<span>Paste several</span></button>
          <span class="sec-total" data-total="${sec.id}"></span>
        </div>
      </div>
    </section>`;
  }

  function paintTotals() {
    for (const sec of sections) {
      const node = el.querySelector(`[data-total="${sec.id}"]`); if (!node) continue;
      const t = sectionTotals(sec);
      node.innerHTML = t.priced ? `<span>Section total</span><b>${esc(totalText(t))}</b>` : '';
    }
    const all = requirementTotals(sections);
    const g = el.querySelector('.req-total');
    if (g) g.innerHTML = `${all.count} item${all.count === 1 ? '' : 's'} · ${sections.length} section${sections.length === 1 ? '' : 's'}${all.priced ? ` · <b>Total ${esc(totalText(all))}</b>` : ''}`;
  }

  function render(focus) {
    el.innerHTML = `<div class="req">
      <div class="req-toolbar">
        <button type="button" class="btn btn-secondary" data-ta="add-sec">${icon('circle-plus')}<span>Add Section</span></button>
        <span class="req-total"></span>
      </div>
      <div class="req-secs">${sections.map(sectionCard).join('')}</div>
      ${sections.length ? `<p class="hint req-keys">${icon('corner-down-left')} <b>Enter</b> moves to the next box · <b>Shift+Enter</b> new line · Amount: <b>25000</b> or a range <b>20000-45000</b> (leave blank if not priced)</p>` : ''}
    </div>`;
    el.querySelectorAll('textarea.req-in').forEach(autoGrow);
    paintTotals();
    if (focus) {
      const f = el.querySelector(focus);
      if (f) { f.focus(); if (f.setSelectionRange) f.setSelectionRange(f.value.length, f.value.length); }
    }
  }

  const findSec = (id) => sections.find((s) => s.id === id);
  const locate = (node) => {
    const secEl = node.closest('[data-sec]'); const sec = secEl && findSec(secEl.dataset.sec);
    const rowEl = node.closest('[data-item]'); const idx = rowEl && sec ? sec.items.findIndex((i) => i.id === rowEl.dataset.item) : -1;
    return { sec, idx, si: sec ? sections.indexOf(sec) : -1 };
  };
  const focusSel = (itemId, f = 'description') => `[data-item="${itemId}"] [data-f="${f}"]`;

  function addSection() {
    const s = blankSection(); sections.push(s); changed();
    render(`[data-sec="${s.id}"] .req-title`);
  }

  /* ---- input & keyboard ---- */
  el.addEventListener('input', (e) => {
    const t = e.target; const f = t.dataset.f; if (!f) return;
    const { sec, idx } = locate(t);
    if (!sec) return;
    if (f === 'title') sec.title = t.value;
    else {
      sec.items[idx][f] = t.value;
      if (f === 'amount') t.classList.toggle('invalid', parseAmount(t.value) === undefined);
    }
    changed();
  });

  el.addEventListener('keydown', (e) => {
    const t = e.target; const f = t.dataset.f; if (!f) return;
    const { sec, idx } = locate(t);
    if (f === 'title' && e.key === 'Enter') {
      e.preventDefault();
      const first = sec.items[0]; if (first) el.querySelector(focusSel(first.id))?.focus();
      else { const it = blankItem(); sec.items.push(it); changed(); render(focusSel(it.id)); }
      return;
    }
    if (f === 'title') return;
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      const next = FIELDS[FIELDS.indexOf(f) + 1];
      if (next) { el.querySelector(focusSel(sec.items[idx].id, next))?.focus(); return; }
      const nextItem = sec.items[idx + 1];
      if (nextItem && !nextItem.description && !nextItem.remarks && !nextItem.amount) { el.querySelector(focusSel(nextItem.id))?.focus(); return; }
      const it = blankItem(); sec.items.splice(idx + 1, 0, it); changed(); render(focusSel(it.id));
      return;
    }
    if (e.key === 'Backspace' && f === 'description' && !t.value && !sec.items[idx].remarks && !sec.items[idx].amount && sec.items.length > 1) {
      e.preventDefault();
      const prev = sec.items[idx - 1] || sec.items[idx + 1];
      sec.items.splice(idx, 1); changed(); render(focusSel(prev.id, idx > 0 ? 'amount' : 'description'));
      return;
    }
    if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      e.preventDefault();
      moveItem(sec, idx, e.key === 'ArrowUp' ? -1 : 1, f);
    }
  });

  function moveItem(sec, idx, dir, f = 'description') {
    const j = idx + dir; if (j < 0 || j >= sec.items.length) return;
    const [it] = sec.items.splice(idx, 1); sec.items.splice(j, 0, it); changed();
    render(focusSel(it.id, f));
  }

  /* ---- buttons ---- */
  el.addEventListener('click', async (e) => {
    const b = e.target.closest('button'); if (!b) return;
    const { sec, idx, si } = locate(b);
    const a = b.dataset.a, sa = b.dataset.sa, ta = b.dataset.ta;
    if (ta === 'add-sec') return addSection();
    if (a === 'up' || a === 'down') return moveItem(sec, idx, a === 'up' ? -1 : 1);
    if (a === 'insert') { const it = blankItem(); sec.items.splice(idx + 1, 0, it); changed(); return render(focusSel(it.id)); }
    if (a === 'del') {
      const it = sec.items[idx];
      sec.items.splice(idx, 1); changed(); render();
      if (it.description || it.remarks || it.amount) toast('Row deleted', { type: 'info', action: { label: 'Undo', run: () => { sec.items.splice(idx, 0, it); changed(); render(); } } });
      return;
    }
    if (sa === 'add') { const it = blankItem(); sec.items.push(it); changed(); return render(focusSel(it.id)); }
    if (sa === 'paste') return pasteInto(sec);
    if (sa === 'collapse') { sec._collapsed = !sec._collapsed; return render(); }
    if (sa === 'up' || sa === 'down') {
      const j = si + (sa === 'up' ? -1 : 1); if (j < 0 || j >= sections.length) return;
      const [s] = sections.splice(si, 1); sections.splice(j, 0, s); changed(); return render();
    }
    if (sa === 'del') {
      const filled = sec.items.filter((i) => i.description || i.remarks || i.amount).length;
      if (filled && !(await confirmDialog({ title: 'Remove section?', message: `“${esc(sec.title || 'Untitled section')}” and its ${filled} item${filled === 1 ? '' : 's'} will be removed from this event.`, confirm: 'Remove section', kind: 'danger', icon: 'trash-2' }))) return;
      sections.splice(si, 1); changed(); render();
    }
  });

  /* ---- drag & drop (rows across sections, and sections) ---- */
  let drag = null;
  el.addEventListener('dragstart', (e) => {
    const g = e.target.closest('.req-grip'); if (!g) return;
    if (g.classList.contains('sec-grip')) drag = { type: 'sec', id: g.closest('[data-sec]').dataset.sec };
    else drag = { type: 'item', id: g.closest('[data-item]').dataset.item, from: g.closest('[data-sec]').dataset.sec };
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', drag.id);
    const node = drag.type === 'sec' ? g.closest('.req-sec') : g.closest('.req-row');
    e.dataTransfer.setDragImage(node, 20, 20);
    requestAnimationFrame(() => node.classList.add('dragging'));
  });
  el.addEventListener('dragover', (e) => {
    if (!drag) return;
    const target = drag.type === 'sec' ? e.target.closest('.req-sec') : (e.target.closest('.req-row') || e.target.closest('.req-sec'));
    if (!target) return;
    e.preventDefault();
    el.querySelectorAll('.drop-before,.drop-after').forEach((n) => n.classList.remove('drop-before', 'drop-after'));
    const r = target.getBoundingClientRect();
    target.classList.add(e.clientY < r.top + r.height / 2 ? 'drop-before' : 'drop-after');
  });
  el.addEventListener('dragend', () => { drag = null; el.querySelectorAll('.dragging,.drop-before,.drop-after').forEach((n) => n.classList.remove('dragging', 'drop-before', 'drop-after')); });
  el.addEventListener('drop', (e) => {
    if (!drag) return; e.preventDefault();
    const tgt = el.querySelector('.drop-before, .drop-after');
    const before = tgt?.classList.contains('drop-before');
    if (drag.type === 'sec' && tgt) {
      const from = sections.findIndex((s) => s.id === drag.id);
      const [s] = sections.splice(from, 1);
      let to = sections.findIndex((x) => x.id === tgt.dataset.sec); if (!before) to++;
      sections.splice(to, 0, s);
    } else if (drag.type === 'item' && tgt) {
      const fromSec = findSec(drag.from); const fi = fromSec.items.findIndex((i) => i.id === drag.id);
      const [it] = fromSec.items.splice(fi, 1);
      const toSec = findSec(tgt.closest('[data-sec]').dataset.sec);
      if (tgt.dataset.item) { let to = toSec.items.findIndex((i) => i.id === tgt.dataset.item); if (!before) to++; toSec.items.splice(to, 0, it); }
      else if (before) toSec.items.unshift(it); else toSec.items.push(it);
    }
    drag = null; changed(); render();
  });

  /* ---- bulk paste ---- */
  function pasteInto(sec) {
    const body = `<p class="muted">Paste or type one item per line. Separate columns with a <b>Tab</b> (as when copying from Excel/Word tables) or a <b>|</b>: <code>Description | Remarks | Amount</code> — e.g. <code>Box truss | 30 x 50 Ft | 25000</code>. Leading numbers are removed automatically.</p>
      <textarea class="input mono" id="paste-box" rows="10" placeholder="Stage decoration | Main stage | 25000&#10;Entrance decoration | Two entrances | 10000&#10;Selfie point"></textarea>`;
    modal({
      title: `Add several items to “${sec.title || 'section'}”`, icon: 'clipboard-list', body,
      actions: [{ label: 'Cancel', kind: 'ghost' }, { label: 'Add items', kind: 'primary', run: (close, m) => {
        const lines = m.querySelector('#paste-box').value.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
        const items = lines.map((l) => {
          l = l.replace(/^\(?\d{1,3}[.)\]]?\s+/, '');
          const parts = (l.includes('\t') ? l.split('\t') : l.split(/\s*\|\s*/)).map((p) => p.trim());
          let amount = '';
          if (parts.length > 2 || (parts.length === 2 && parseAmount(parts[1]))) amount = parseAmount(parts.at(-1)) ? parts.pop() : '';
          return { id: uid('i_'), description: parts[0] || '', remarks: parts.slice(1).join(' '), amount };
        }).filter((i) => i.description || i.remarks || i.amount);
        sec.items = sec.items.filter((i) => i.description || i.remarks || i.amount).concat(items);
        if (!sec.items.length) sec.items.push(blankItem());
        changed(); render(); close();
        toast(`${items.length} item${items.length === 1 ? '' : 's'} added`);
      } }],
    });
  }

  render();
  return {
    get: () => sections.map(({ _collapsed, ...s }) => s),
    set: (s) => { sections = clone(s); render(); },
  };
}
