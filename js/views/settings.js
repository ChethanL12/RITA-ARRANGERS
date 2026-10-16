// Settings: company details, logo & signature, numbering, document templates,
// WhatsApp templates, tax, storage/security and backup.

import { icon } from '../icons.js';
import { esc, fileToDataURL, shrinkImage, todayKey, nowISO, blobToBase64, base64ToBlob, uid } from '../util.js';
import { PLACEHOLDERS, DEFAULT_SETTINGS, TABLES } from '../models.js';
import { store, saveSettings, peekNext, setCounter, seriesKey, getDocBlob, loadAll } from '../store.js';
import { toast, toastError, busy, confirmDialog, autoGrow, modal, downloadBlob } from '../ui.js';
import { renderPdf } from '../pdf.js';
import { openViewer } from '../docs.js';

const SECTIONS = [
  ['company', 'Company', 'building-2'],
  ['numbering', 'Numbering', 'stamp'],
  ['templates', 'Document text', 'scroll-text'],
  ['whatsapp', 'WhatsApp', 'whatsapp'],
  ['tax', 'Currency & tax', 'indian-rupee'],
  ['storage', 'Storage & security', 'shield-check'],
];

let dirty = false;
export const isDirty = () => dirty;
export async function canLeave() {
  if (!dirty) return true;
  return confirmDialog({ title: 'Leave without saving settings?', message: 'Your changes to the settings have not been saved.', confirm: 'Leave', kind: 'danger', icon: 'triangle-alert' });
}

const field = (key, label, { type = 'text', hint = '', rows = 0, ph = '' } = {}) => {
  const v = store.settings[key] ?? '';
  return `<label class="field"><span>${label}${hint ? ` <em>${hint}</em>` : ''}</span>${rows
    ? `<textarea class="input" data-k="${key}" rows="${rows}" placeholder="${esc(ph)}">${esc(v)}</textarea>`
    : `<input class="input" data-k="${key}" type="${type}" value="${esc(v)}" placeholder="${esc(ph)}">`}</label>`;
};

function sampleSnapshot(type) {
  const s = store.settings;
  return {
    type, number: '', version: 1, preview: true, issuedAt: todayKey(),
    company: { name: s.companyName, tagline: s.tagline, address: s.address, phone: s.phone, email: s.email, proprietor: s.proprietor, signatoryTitle: s.signatoryTitle, signatureText: s.signatureText.replace('{proprietor}', s.proprietor), currencySymbol: s.currencySymbol, paymentDetails: s.paymentDetails, subtitle: (type === 'quotation' ? s.quoteSubtitle : type === 'confirmation' ? s.confirmationSubtitle : s.invoiceSubtitle).replace('{company}', s.companyName) },
    client: { name: 'Sample Client', phone: '+91 90000 00000' }, addressedAs: 'Sample Client',
    event: { title: 'Sample Event', service: 'Venue Decoration & Lighting', venue: 'Sample Venue', dates: [{ date: todayKey(), session: 'night', label: '' }], customFields: [] },
    sections: type === 'confirmation' ? [] : [{ title: 'Sample Section', items: [{ description: 'Sample requirement — replace with real items in each event', remarks: 'Remark' }, { description: 'Second sample item', remarks: '' }] }],
    budget: '₹1,00,000 (as discussed)',
    note: (type === 'quotation' ? s.quoteNote : type === 'confirmation' ? s.confirmationNote : s.invoiceTerms).replace(/\{clientName\}/g, 'Sample Client').replace(/\{eventName\}/g, 'Sample Event').replace(/\{company\}/g, s.companyName).replace(/\{service\}/g, 'event management'),
    finance: type === 'invoice' ? { agreed: 100000, charges: [], discounts: [], subtotal: 100000, applyTax: false, tax: 0, total: 100000, received: 40000, payments: [{ date: todayKey(), method: 'UPI', reference: '', amount: 40000 }], showPayments: true, dueDate: '', remarks: '' } : null,
  };
}

export function render(root, { query }) {
  dirty = false;
  const pending = {};
  const year = new Date().getFullYear();
  const isGoogle = store.adapter.kind === 'google';
  const localPin = !!localStorage.getItem('ra.localPin');

  root.innerHTML = `<div class="page settings">
    <header class="page-head"><div><p class="eyebrow">Used automatically in every new document</p><h1>Settings</h1></div>
      <div class="head-actions"><button class="btn btn-primary" id="save" disabled>${icon('save')}<span>Save settings</span></button></div></header>
    <div class="settings-layout">
      <nav class="steps">${SECTIONS.map(([k, l, ic]) => `<a href="#" data-step="st-${k}">${icon(ic)}${l}</a>`).join('')}</nav>
      <div class="form-main">
        <section class="card form-card" id="st-company">
          <div class="form-card-head"><span class="step-no">${icon('building-2')}</span><div><h2>Company details</h2><p>Printed on the letterhead and footer of every document.</p></div></div>
          <div class="grid-2">${field('companyName', 'Company name')}${field('tagline', 'Tagline')}</div>
          ${field('address', 'Address')}
          <div class="grid-2">${field('phone', 'Contact number')}${field('email', 'Email', { hint: 'optional', type: 'email' })}</div>
          <div class="grid-3">${field('proprietor', 'Proprietor / authorised signatory')}${field('signatoryTitle', 'Title')}${field('signatureText', 'Digital-signature line', { hint: '{proprietor} = name' })}</div>
          <div class="grid-2 media">
            <div class="field"><span>Logo</span><div class="media-box"><img id="logo-prev" src="${esc(store.settings.logo || 'assets/logo.png')}" alt="Logo"></div>
              <div class="row-gap"><label class="btn btn-secondary btn-sm">${icon('upload')}<span>Upload logo</span><input type="file" accept="image/png,image/jpeg,image/webp" id="logo-file" hidden></label>
              <button class="btn btn-ghost btn-sm" id="logo-reset" ${store.settings.logo ? '' : 'hidden'}>Use Rita Arrangers logo</button></div>
              <small class="muted">PNG with transparent background works best on documents.</small></div>
            <div class="field"><span>Signature image <em>optional</em></span><div class="media-box"><img id="sig-prev" src="${esc(store.settings.signatureImage || '')}" alt="" ${store.settings.signatureImage ? '' : 'hidden'}><span class="muted" ${store.settings.signatureImage ? 'hidden' : ''} id="sig-none">No signature image — the digital-signature line is used.</span></div>
              <div class="row-gap"><label class="btn btn-secondary btn-sm">${icon('upload')}<span>Upload signature</span><input type="file" accept="image/png,image/jpeg" id="sig-file" hidden></label>
              <button class="btn btn-ghost btn-sm" id="sig-reset" ${store.settings.signatureImage ? '' : 'hidden'}>Remove</button></div></div>
          </div>
        </section>

        <section class="card form-card" id="st-numbering">
          <div class="form-card-head"><span class="step-no">${icon('stamp')}</span><div><h2>Reference numbering</h2><p>Numbers are allocated when a document is issued and never repeat. Revisions add <b>-R1</b>, <b>-R2</b>…</p></div></div>
          <div class="grid-3">${field('numberPrefix', 'Prefix', { ph: 'RA' })}${field('seqDigits', 'Digits in sequence', { type: 'number' })}</div>
          <div class="grid-3">
            ${field('quoteFormat', 'Quotation format', { hint: '{PREFIX} {YYYY} {YY} {SEQ}' })}
            <label class="field"><span>Booking confirmation reference</span><select class="input" data-k="confirmationMode">
              <option value="separate" ${store.settings.confirmationMode !== 'quotation' ? 'selected' : ''}>Separate sequence</option>
              <option value="quotation" ${store.settings.confirmationMode === 'quotation' ? 'selected' : ''}>Same as the event's quotation reference</option></select></label>
            ${field('confirmationFormat', 'Confirmation format')}
          </div>
          <div class="grid-3">${field('invoiceFormat', 'Final invoice format')}</div>
          <div class="sub-head"><h3>Next numbers for ${year}</h3><p>Set these once to continue from your existing paper records (e.g. 48 after RA/${year}/047).</p></div>
          <div class="grid-3" id="counters">
            ${['quotation', 'confirmation', 'invoice'].map((t) => `<label class="field"><span>${t === 'quotation' ? 'Quotation' : t === 'confirmation' ? 'Confirmation' : 'Invoice'} — next <em id="peek-${t}">${esc(peekNext(t))}</em></span>
              <div class="input-row"><input class="input" type="number" min="1" id="next-${t}" value="${(Number(store.counters[seriesKey(t, year)]) || 0) + 1}" ${t === 'confirmation' && store.settings.confirmationMode === 'quotation' ? 'disabled' : ''}>
              <button class="btn btn-ghost btn-sm" data-setnext="${t}">Set</button></div></label>`).join('')}
          </div>
        </section>

        <section class="card form-card" id="st-templates">
          <div class="form-card-head"><span class="step-no">${icon('scroll-text')}</span><div><h2>Document text</h2><p>Standard wording — filled in with each event's details. You can still override it per document.</p></div></div>
          <div class="placeholders">${PLACEHOLDERS.map(([k, d]) => `<span title="${esc(d)}"><code>${esc(k)}</code>${esc(d)}</span>`).join('')}</div>
          <div class="grid-3">${field('quoteSubtitle', 'Quotation subtitle')}${field('confirmationSubtitle', 'Confirmation subtitle')}${field('invoiceSubtitle', 'Invoice subtitle')}</div>
          ${field('quoteNote', 'Default quotation note', { rows: 4 })}
          ${field('confirmationNote', 'Default booking confirmation note', { rows: 4, hint: 'blank line = new paragraph' })}
          ${field('invoiceTerms', 'Default final invoice note / payment terms', { rows: 4 })}
          ${field('paymentDetails', 'Payment details printed on invoices', { rows: 3, hint: 'optional — bank, IFSC, UPI ID', ph: 'Bank: …\nA/C No: …  IFSC: …\nUPI: …' })}
          <div class="row-gap"><span class="muted small">Preview with sample data:</span>
            <button class="btn btn-ghost btn-sm" data-sample="quotation">${icon('eye')}<span>Quotation</span></button>
            <button class="btn btn-ghost btn-sm" data-sample="confirmation">${icon('eye')}<span>Confirmation</span></button>
            <button class="btn btn-ghost btn-sm" data-sample="invoice">${icon('eye')}<span>Invoice</span></button></div>
        </section>

        <section class="card form-card" id="st-whatsapp">
          <div class="form-card-head"><span class="step-no wa">${icon('whatsapp')}</span><div><h2>WhatsApp messages</h2><p>Pre-filled when you share — always editable before sending. <code>{docNumber}</code>, <code>{total}</code>, <code>{received}</code>, <code>{balance}</code> are available.</p></div></div>
          ${field('waQuote', 'Quotation message', { rows: 6 })}
          ${field('waConfirmation', 'Booking confirmation message', { rows: 5 })}
          ${field('waInvoice', 'Final invoice message', { rows: 6 })}
          ${field('waGeneral', 'General message', { rows: 3 })}
        </section>

        <section class="card form-card" id="st-tax">
          <div class="form-card-head"><span class="step-no">${icon('indian-rupee')}</span><div><h2>Currency &amp; tax</h2><p>No tax is added unless you switch it on here (or per invoice).</p></div></div>
          <div class="grid-3">${field('currencySymbol', 'Currency symbol')}${field('countryCode', 'WhatsApp country code', { hint: 'India = 91' })}</div>
          <label class="check"><input type="checkbox" data-k="taxEnabled" ${store.settings.taxEnabled ? 'checked' : ''}><span>Apply tax on final invoices by default</span></label>
          <div class="grid-3">${field('taxLabel', 'Tax label', { ph: 'GST' })}${field('taxRate', 'Rate %', { type: 'number' })}</div>
        </section>

        <section class="card form-card" id="st-storage">
          <div class="form-card-head"><span class="step-no">${icon('shield-check')}</span><div><h2>Storage, security &amp; backup</h2></div></div>
          <div class="storage-box ${isGoogle ? 'ok' : 'local'}">${icon(isGoogle ? 'cloud' : 'hard-drive')}<div>
            <b>${isGoogle ? 'Google Sheets' : 'This device only'}</b>
            <small>${isGoogle ? `Records are stored in your Google Sheet, shared by all your devices. PDFs download to the device you are using and can be re-downloaded any time from the event page. Access requires your PIN.<br><span class="mono">${esc(store.adapter.url)}</span>` : 'Records and PDFs are stored in this browser. Clearing browser data deletes them — keep backups, or move to Google Sheets.'}</small></div></div>
          <div class="row-gap">
            ${isGoogle ? `<button class="btn btn-secondary" id="change-pin">${icon('key-round')}<span>Change PIN</span></button>` : `<button class="btn btn-secondary" id="local-pin">${icon('lock')}<span>${localPin ? 'Change / remove app PIN' : 'Set an app PIN'}</span></button>`}
            <button class="btn btn-secondary" id="backup">${icon('download')}<span>Download backup</span></button>
            <label class="btn btn-secondary">${icon('upload')}<span>Restore from backup</span><input type="file" id="restore" accept="application/json,.json" hidden></label>
            <button class="btn btn-ghost" id="switch">${icon('refresh-cw')}<span>Switch storage…</span></button>
          </div>
          <p class="hint">${icon('info')} A backup file contains all clients, events, payments, history, settings and the issued PDFs. Restore merges it into the current storage — use it to move from “this device” to Google Sheets.</p>
        </section>
      </div>
    </div>
  </div>`;
  const $ = (s) => root.querySelector(s);
  root.querySelectorAll('textarea.input').forEach(autoGrow);
  const saveBtn = $('#save');
  const markDirty = () => { dirty = true; saveBtn.disabled = false; };

  root.addEventListener('input', (e) => {
    const k = e.target.dataset.k; if (!k) return;
    pending[k] = e.target.type === 'checkbox' ? e.target.checked : e.target.value; markDirty();
  });
  root.addEventListener('change', (e) => { const k = e.target.dataset.k; if (k && e.target.tagName === 'SELECT') { pending[k] = e.target.value; markDirty(); } });
  saveBtn.onclick = () => busy(saveBtn, async () => {
    await saveSettings({ ...pending }); for (const k in pending) delete pending[k];
    dirty = false; saveBtn.disabled = true; toast('Settings saved — new documents will use them');
    ['quotation', 'confirmation', 'invoice'].forEach((t) => { const p = $('#peek-' + t); if (p) p.textContent = peekNext(t); });
  }).catch(toastError);

  $('.steps').addEventListener('click', (e) => { const a = e.target.closest('[data-step]'); if (!a) return; e.preventDefault(); const t = root.querySelector('#' + a.dataset.step); window.scrollTo({ top: t.getBoundingClientRect().top + scrollY - 90, behavior: 'smooth' }); });

  // logo & signature
  const imgUpload = (inputSel, key, prevSel, resetSel, maxW) => {
    $(inputSel).onchange = async (e) => {
      const f = e.target.files[0]; if (!f) return;
      if (f.size > 5e6) return toastError(new Error('Please choose an image under 5 MB.'));
      const data = await shrinkImage(await fileToDataURL(f), maxW);
      pending[key] = data; markDirty();
      const img = $(prevSel); img.src = data; img.hidden = false; $(resetSel).hidden = false;
      if (key === 'signatureImage') $('#sig-none').hidden = true;
    };
    $(resetSel).onclick = () => {
      pending[key] = ''; markDirty(); $(resetSel).hidden = true;
      if (key === 'logo') $(prevSel).src = 'assets/logo.png'; else { $(prevSel).hidden = true; $('#sig-none').hidden = false; }
    };
  };
  imgUpload('#logo-file', 'logo', '#logo-prev', '#logo-reset', 700);
  imgUpload('#sig-file', 'signatureImage', '#sig-prev', '#sig-reset', 400);

  // counters
  root.querySelectorAll('[data-setnext]').forEach((b) => (b.onclick = () => busy(b, async () => {
    const t = b.dataset.setnext; const v = Number($('#next-' + t).value);
    if (!(v >= 1)) throw new Error('Enter a number of 1 or more.');
    const used = store.documents.filter((d) => d.type === t || (t === 'quotation' && d.type === 'confirmation' && store.settings.confirmationMode === 'quotation'));
    await setCounter(t, v);
    $('#peek-' + t).textContent = peekNext(t);
    toast(`Next ${t} number set — ${peekNext(t)}${used.length ? ' (numbers already used are skipped automatically)' : ''}`);
  }).catch(toastError)));

  // sample previews
  root.querySelectorAll('[data-sample]').forEach((b) => (b.onclick = () => busy(b, async () => {
    const prev = { ...store.settings }; Object.assign(store.settings, pending);
    try { const blob = await renderPdf(sampleSnapshot(b.dataset.sample)); await openViewer({ blob, title: 'Sample preview (not saved)', fileName: 'sample.pdf', preview: true }); }
    finally { store.settings = prev; }
  }).catch(toastError)));

  // security
  $('#change-pin')?.addEventListener('click', () => {
    modal({
      title: 'Change PIN', icon: 'key-round', size: 'sm',
      body: `<label class="field"><span>Current PIN</span><input class="input" type="password" id="op"></label><label class="field"><span>New PIN <em>at least 6 digits/characters</em></span><input class="input" type="password" id="np"></label><label class="field"><span>Repeat new PIN</span><input class="input" type="password" id="np2"></label>`,
      actions: [{ label: 'Cancel', kind: 'ghost' }, { label: 'Change PIN', kind: 'primary', run: async (close, el) => {
        const np = el.querySelector('#np').value; if (np.length < 6) throw new Error('Use at least 6 characters.');
        if (np !== el.querySelector('#np2').value) throw new Error('The new PINs do not match.');
        await store.adapter.changePin(el.querySelector('#op').value, np); close(); toast('PIN changed. Other devices must sign in again.');
      } }],
    });
  });
  $('#local-pin')?.addEventListener('click', () => {
    modal({
      title: 'App PIN for this device', icon: 'lock', size: 'sm',
      body: `<p class="muted small">Asks for a PIN when the app is opened in this browser. Leave empty to remove the PIN.</p><label class="field"><span>New PIN</span><input class="input" type="password" id="np" inputmode="numeric"></label><label class="field"><span>Repeat PIN</span><input class="input" type="password" id="np2" inputmode="numeric"></label>`,
      actions: [{ label: 'Cancel', kind: 'ghost' }, { label: 'Save', kind: 'primary', run: async (close, el) => {
        const np = el.querySelector('#np').value;
        if (np && np.length < 4) throw new Error('Use at least 4 digits.');
        if (np !== el.querySelector('#np2').value) throw new Error('The PINs do not match.');
        const { setLocalPin } = await import('../app.js');
        await setLocalPin(np); close(); toast(np ? 'App PIN set' : 'App PIN removed');
      } }],
    });
  });
  $('#switch').onclick = async () => {
    if (await confirmDialog({ title: 'Switch storage?', message: 'You will return to the storage choice screen. Nothing is deleted. To bring your records along, download a backup first and restore it after switching.', confirm: 'Switch storage', icon: 'refresh-cw' })) {
      localStorage.removeItem('ra.mode'); localStorage.removeItem('ra.token'); location.reload();
    }
  };

  // backup / restore
  $('#backup').onclick = () => busy($('#backup'), async () => {
    const data = { app: 'rita-arrangers', version: 1, exportedAt: nowISO(), settings: store.settings, counters: store.counters, files: {} };
    for (const t of TABLES) data[t] = store[t];
    // snapshots are fetched lazily from Google; include full records
    if (store.adapter.kind === 'google') data.documents = await Promise.all(store.documents.map(async (d) => (d.snapshot ? d : (await store.adapter.getRecord('documents', d.id)) || d)));
    let missing = 0;
    for (const d of store.documents) {
      try { const b = await getDocBlob(d); if (b) data.files[d.id] = await blobToBase64(b); else missing++; } catch { missing++; }
    }
    downloadBlob(new Blob([JSON.stringify(data)], { type: 'application/json' }), `rita-arrangers-backup-${todayKey()}.json`);
    toast(`Backup downloaded${missing ? ` (${missing} PDF file(s) could not be included)` : ''}`);
  }).catch(toastError);

  $('#restore').onchange = async (e) => {
    const f = e.target.files[0]; e.target.value = ''; if (!f) return;
    try {
      const data = JSON.parse(await f.text());
      if (data.app !== 'rita-arrangers') throw new Error('This is not a Rita Arrangers backup file.');
      const counts = TABLES.map((t) => `${(data[t] || []).length} ${t}`).join(', ');
      if (!(await confirmDialog({ title: 'Restore this backup?', message: `Backup from ${esc(data.exportedAt?.slice(0, 10))}: ${esc(counts)}.<br>Records with the same ID are replaced by the backup copy; everything else is kept.`, confirm: 'Restore', icon: 'upload' }))) return;
      toast('Restoring… please keep this page open', { type: 'info', timeout: 8000 });
      const docs = [];
      for (const d of data.documents || []) {
        const b64 = data.files?.[d.id];
        if (b64) {
          const doc = { ...d, _clientFolder: (data.clients || []).find((c) => c.id === d.clientId)?.name || 'Client' };
          const r = await store.adapter.saveFile(doc, base64ToBlob(b64));
          docs.push({ ...d, fileId: r.fileId || d.fileId, fileUrl: r.fileUrl || '' });
        } else docs.push(d);
      }
      const ops = [];
      for (const t of TABLES) for (const r of (t === 'documents' ? docs : data[t] || [])) ops.push({ op: 'put', table: t, record: r });
      for (let i = 0; i < ops.length; i += 200) await store.adapter.commit(ops.slice(i, i + 200));
      const { logo, signatureImage, ...rest } = data.settings || {};
      await store.adapter.saveSettings({ ...rest, logo: logo || '', signatureImage: signatureImage || '' });
      for (const [k, v] of Object.entries(data.counters || {})) {
        const cur = Number(store.counters[k]) || 0; if (Number(v) > cur) await store.adapter.setCounter(k, Number(v));
      }
      await loadAll(store.adapter);
      toast('Backup restored');
      render(root, { query });
    } catch (err) { toastError(err); }
  };

  if (query.get('s')) setTimeout(() => root.querySelector('#st-' + query.get('s'))?.scrollIntoView(), 50);
  return () => { dirty = false; };
}
