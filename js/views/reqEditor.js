// Requirements editor: unlimited sections, each with unlimited "Description / Remarks" rows.
// Fast keyboard entry: Enter moves Description → Remarks → new row; Shift+Enter adds a line break.
// Rows and sections can be reordered by drag handle or arrow buttons; numbering is automatic.

import { icon } from '../icons.js';
import { esc, uid, clone, fmtDate } from '../util.js';
import { store, getClient, countItems } from '../store.js';
import { modal, autoGrow, confirmDialog, toast } from '../ui.js';

const blankItem = () => ({ id: uid('i_'), description: '', remarks: '' });
const blankSection = (title = '') => ({ id: uid('s_'), title, items: [blankItem()] });

export function mountReqEditor(el, initial, { onChange, excludeEventId } = {}) {
  let sections = clone(initial || []);
  const changed = () => onChange?.(sections);

  function itemRow(sec, it, i) {
    return `<div class="req-row" data-item="${it.id}">
      <span class="req-grip" draggable="true" title="Drag to reorder">${icon('grip-vertical')}</span>
      <span class="req-no">${i + 1}</span>
      <textarea class="req-in req-desc" rows="1" data-f="description" placeholder="Description of service / item">${esc(it.description)}</textarea>
      <textarea class="req-in req-rem" rows="1" data-f="remarks" placeholder="Remarks (size, qty, colour…)">${esc(it.remarks)}</textarea>
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
        <input class="req-title" value="${esc(sec.title)}" placeholder="Section heading — e.g. Venue Part, Church Arrangements" data-f="title">
        <span class="req-count">${n} item${n === 1 ? '' : 's'}</span>
        <span class="req-sec-acts">
          <button type="button" class="icon-btn sm" data-sa="up" title="Move section up">${icon('arrow-up')}</button>
          <button type="button" class="icon-btn sm" data-sa="down" title="Move section down">${icon('arrow-down')}</button>
          <button type="button" class="icon-btn sm" data-sa="collapse" title="Collapse / expand">${icon(sec._collapsed ? 'chevron-down' : 'chevron-up')}</button>
          <button type="button" class="icon-btn sm danger" data-sa="del" title="Remove section">${icon('trash-2')}</button>
        </span>
      </header>
      <div class="req-body">
        <div class="req-cols"><span></span><span>No.</span><span>Description of Services and Items</span><span>Remarks</span><span></span></div>
        <div class="req-rows">${sec.items.map((it, i) => itemRow(sec, it, i)).join('')}</div>
        <div class="req-sec-foot">
          <button type="button" class="btn btn-ghost btn-sm" data-sa="add">${icon('plus')}<span>Add item</span></button>
          <button type="button" class="btn btn-ghost btn-sm" data-sa="paste">${icon('clipboard-list')}<span>Paste several</span></button>
        </div>
      </div>
    </section>`;
  }

  function render(focus) {
    el.innerHTML = `<div class="req">
      <div class="req-toolbar">
        <button type="button" class="btn btn-secondary" data-ta="add-sec">${icon('circle-plus')}<span>Add Section</span></button>
        <button type="button" class="btn btn-ghost" data-ta="import">${icon('copy')}<span>Copy from another event</span></button>
        <span class="req-total">${countItems({ sections })} items · ${sections.length} section${sections.length === 1 ? '' : 's'}</span>
      </div>
      <div class="req-secs">${sections.length ? sections.map(sectionCard).join('') : `<div class="req-empty">${icon('list-checks')}<p>No requirements yet.</p><p class="muted">Add a section such as <i>Venue Part</i>, <i>Food Serving Area</i> or <i>Church Arrangements</i>, then list each item with its remarks.</p>
        <button type="button" class="btn btn-primary" data-ta="add-sec">${icon('circle-plus')}<span>Add first section</span></button></div>`}</div>
      <p class="hint req-keys">${icon('corner-down-left')} <b>Enter</b> moves to the next box and creates a new row · <b>Shift+Enter</b> new line · <b>Alt+↑/↓</b> move row · drag ${icon('grip-vertical')} to reorder</p>
    </div>`;
    el.querySelectorAll('textarea.req-in').forEach(autoGrow);
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
    if (f === 'title') sec.title = t.value; else sec.items[idx][f] = t.value;
    changed();
  });

  el.addEventListener('keydown', (e) => {
    const t = e.target; const f = t.dataset.f; if (!f) return;
    const { sec, idx, si } = locate(t);
    if (f === 'title' && e.key === 'Enter') {
      e.preventDefault();
      const first = sec.items[0]; if (first) el.querySelector(focusSel(first.id))?.focus();
      else { const it = blankItem(); sec.items.push(it); changed(); render(focusSel(it.id)); }
      return;
    }
    if (f === 'title') return;
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      if (f === 'description') { el.querySelector(focusSel(sec.items[idx].id, 'remarks'))?.focus(); return; }
      const next = sec.items[idx + 1];
      if (next && !next.description && !next.remarks) { el.querySelector(focusSel(next.id))?.focus(); return; }
      const it = blankItem(); sec.items.splice(idx + 1, 0, it); changed(); render(focusSel(it.id));
      return;
    }
    if (e.key === 'Backspace' && f === 'description' && !t.value && !sec.items[idx].remarks && sec.items.length > 1) {
      e.preventDefault();
      const prev = sec.items[idx - 1] || sec.items[idx + 1];
      sec.items.splice(idx, 1); changed(); render(focusSel(prev.id, idx > 0 ? 'remarks' : 'description'));
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
    if (ta === 'import') return importFrom();
    if (a === 'up' || a === 'down') return moveItem(sec, idx, a === 'up' ? -1 : 1);
    if (a === 'insert') { const it = blankItem(); sec.items.splice(idx + 1, 0, it); changed(); return render(focusSel(it.id)); }
    if (a === 'del') {
      const it = sec.items[idx];
      sec.items.splice(idx, 1); changed(); render();
      if (it.description || it.remarks) toast('Row deleted', { type: 'info', action: { label: 'Undo', run: () => { sec.items.splice(idx, 0, it); changed(); render(); } } });
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
      const filled = sec.items.filter((i) => i.description || i.remarks).length;
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
    const body = `<p class="muted">Paste or type one item per line. To add a remark, separate it with a <b>Tab</b> (as when copying from Excel/Word tables) or a <b>|</b> — e.g. <code>Box truss | 30 x 50 Ft</code>. Leading numbers are removed automatically.</p>
      <textarea class="input mono" id="paste-box" rows="10" placeholder="Stage decor | Main stage and backdrop&#10;Entrance decor | Two entrances&#10;Selfie point"></textarea>`;
    modal({
      title: `Add several items to “${sec.title || 'section'}”`, icon: 'clipboard-list', body,
      actions: [{ label: 'Cancel', kind: 'ghost' }, { label: 'Add items', kind: 'primary', run: (close, m) => {
        const lines = m.querySelector('#paste-box').value.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
        const items = lines.map((l) => {
          l = l.replace(/^\(?\d{1,3}[.)\]]?\s+/, '');
          const parts = l.includes('\t') ? l.split('\t') : l.split(/\s+\|\s+|\|/);
          return { id: uid('i_'), description: (parts[0] || '').trim(), remarks: parts.slice(1).join(' ').trim() };
        }).filter((i) => i.description || i.remarks);
        sec.items = sec.items.filter((i) => i.description || i.remarks).concat(items);
        if (!sec.items.length) sec.items.push(blankItem());
        changed(); render(); close();
        toast(`${items.length} item${items.length === 1 ? '' : 's'} added`);
      } }],
    });
  }

  /* ---- copy from another event ---- */
  function importFrom() {
    const evs = store.events.filter((e) => e.id !== excludeEventId && countItems(e)).sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
    if (!evs.length) return toast('No other events with requirements yet.', { type: 'info' });
    const body = `<p class="muted">Choose an event — its sections are copied into this event, where you can edit them freely. The original event is not changed.</p>
      <div class="pick-list">${evs.map((e) => `<label class="pick"><input type="radio" name="src" value="${e.id}"><span><b>${esc(getClient(e.clientId)?.name || 'Client')} — ${esc(e.title || 'Event')}</b>
      <small>${esc(fmtDate(e.primaryDate))} · ${(e.sections || []).map((s) => esc(s.title || 'Untitled')).join(', ')} · ${countItems(e)} items</small></span></label>`).join('')}</div>`;
    modal({
      title: 'Copy requirements from another event', icon: 'copy', body, size: 'md',
      actions: [{ label: 'Cancel', kind: 'ghost' }, { label: 'Copy sections', kind: 'primary', run: (close, m) => {
        const id = m.querySelector('input[name=src]:checked')?.value;
        if (!id) throw new Error('Choose an event first.');
        const src = store.events.find((e) => e.id === id);
        const copies = clone(src.sections).map((s) => ({ ...s, id: uid('s_'), items: s.items.map((i) => ({ ...i, id: uid('i_') })) }));
        sections = sections.filter((s) => s.title || s.items.some((i) => i.description || i.remarks)).concat(copies);
        changed(); render(); close();
        toast(`${copies.length} section${copies.length === 1 ? '' : 's'} copied`);
      } }],
    });
  }

  render();
  return {
    get: () => sections.map(({ _collapsed, ...s }) => s),
    set: (s) => { sections = clone(s); render(); },
  };
}
