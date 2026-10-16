// Document workflows: generate/preview/issue PDFs, view stored PDFs, WhatsApp sharing.

import { icon } from './icons.js';
import { esc, fmtDateLong, fmtDateTime, fillTemplate, normPhone, fmtPhone, money } from './util.js';
import { DOC_TYPES, isConfirmed } from './models.js';
import {
  store, getEvent, getClient, eventDocs, nextVersionInfo, defaultNote, buildSnapshot, issueDocument,
  getDocBlob, cacheDocBlob, logShare, docVars, financials, countItems, setDocPublicUrl, occurrences, latestDoc, peekNext, logActivity,
} from './store.js';
import { renderPdf } from './pdf.js';
import { modal, toast, toastError, downloadBlob, autoGrow, h, busy } from './ui.js';

/* ---------------- generate / issue ---------------- */

export function openGenerate(type, eventId, { onIssued } = {}) {
  const ev = getEvent(eventId); const client = getClient(ev.clientId) || {};
  const t = DOC_TYPES[type];
  const info = nextVersionInfo(type, ev);
  const warnings = [];
  if (!client.name) warnings.push('Client name is missing.');
  if (!client.phone) warnings.push('WhatsApp number is missing — you can still generate the PDF.');
  if (!occurrences(ev).length) warnings.push('No event date has been set.');
  if (type === 'quotation' && !countItems(ev)) warnings.push('No requirements have been added yet.');
  if (type === 'quotation' && !ev.budget?.min && !ev.budget?.max && !ev.budget?.text) warnings.push('No amounts entered yet — the quotation will not show an approximate budget.');
  if (type === 'quotation' && ev.budget?.partial) warnings.push('Some items have no amount — the approximate budget covers the priced items only.');
  if (type === 'invoice' && !financials(ev).hasAgreed) warnings.push('Enter the final agreed amount before issuing the invoice.');
  const blocked = (type === 'confirmation' && !isConfirmed(ev.status)) || (type === 'invoice' && !financials(ev).hasAgreed);

  const numberText = info.number || `${peekNext(type)} (assigned when issued)`;
  const body = h(`<div class="gen">
    <div class="gen-head">
      <div class="gen-doc">${icon(t.icon)}</div>
      <div><div class="eyebrow">${info.version > 1 ? `Revision ${info.version - 1} · Version ${info.version}` : 'Version 1'}</div>
      <div class="gen-title">${esc(t.heading)}</div>
      <div class="muted">${esc(numberText)} · for ${esc(client.name || '—')} · ${esc(ev.title || '')}</div></div>
    </div>
    ${info.previous ? `<div class="callout callout-info">${icon('history')}<div>Version ${info.previous.version} (${esc(info.previous.number)}, issued ${esc(fmtDateTime(info.previous.issuedAt))}) will be kept in the history and marked as superseded.</div></div>` : ''}
    ${blocked && type === 'confirmation' ? `<div class="callout callout-warn">${icon('triangle-alert')}<div>The booking is not confirmed yet. Click <b>Confirm Booking</b> first — the letter only says CONFIRMED for confirmed bookings.</div></div>` : ''}
    ${warnings.length ? `<ul class="warn-list">${warnings.map((w) => `<li>${icon('circle-alert')}${esc(w)}</li>`).join('')}</ul>` : ''}
    <label class="field"><span>${type === 'quotation' ? 'Note' : type === 'confirmation' ? 'Confirmation note' : 'Payment terms'} <em>shown on this document — edit freely</em></span>
      <textarea class="input" id="gen-note" rows="5">${esc(defaultNote(type, ev))}</textarea></label>
    <p class="hint">${icon('info')} The PDF is built from the saved event record and today's company settings. Issued PDFs are stored and never altered.</p>
  </div>`);
  autoGrow(body.querySelector('#gen-note'));

  const m = modal({
    title: info.version > 1 ? `Revise ${t.label}` : `Generate ${t.label}`, icon: t.icon, body, size: 'md',
    actions: [
      { label: 'Preview', kind: 'secondary', icon: 'eye', run: async () => {
        const snap = buildSnapshot(type, getEvent(eventId), { number: info.number, version: info.version, note: body.querySelector('#gen-note').value, preview: true });
        const blob = await renderPdf(snap);
        openViewer({ blob, title: `Preview — ${t.label}`, fileName: 'preview.pdf', preview: true });
      } },
      ...(blocked ? [] : [{ label: info.version > 1 ? 'Issue Revised PDF' : 'Issue & Save PDF', kind: 'primary', icon: 'stamp', run: async (close) => {
        const { doc, blob } = await issueDocument(type, eventId, { note: body.querySelector('#gen-note').value, render: renderPdf });
        cacheDocBlob(doc.id, blob);
        close();
        toast(`${t.label} ${doc.number} issued and saved`);
        onIssued?.(doc);
        openViewer({ doc, blob });
      } }]),
    ],
  });
  return m;
}

/* ---------------- viewer ---------------- */

const isMobile = () => window.matchMedia('(max-width: 760px)').matches || /iPhone|iPad|Android/i.test(navigator.userAgent);

export async function openViewer({ doc, blob, title, fileName, preview = false }) {
  const body = h(`<div class="viewer"><div class="viewer-frame"><div class="loader">${icon('loader-circle', 'spin')} Loading PDF…</div></div></div>`);
  const label = doc ? `${DOC_TYPES[doc.type].label} · ${doc.number}` : title;
  const actions = [];
  const m = modal({
    title: label, subtitle: doc ? `Version ${doc.version} · issued ${fmtDateTime(doc.issuedAt)}${doc.status === 'superseded' ? ' · superseded' : ''}` : 'Not saved — preview only',
    icon: doc ? DOC_TYPES[doc.type].icon : 'eye', body, size: 'xl', actions,
  });
  try {
    if (!blob && doc) blob = await getDocBlob(doc);
    if (!blob) throw new Error('This PDF file could not be found in storage.');
    const url = URL.createObjectURL(blob);
    const frame = body.querySelector('.viewer-frame');
    if (isMobile()) {
      frame.innerHTML = `<div class="viewer-mobile">${icon('file-text')}<p>${esc(fileName || doc?.fileName || 'document.pdf')}</p>
        <a class="btn btn-secondary" href="${url}" target="_blank" rel="noopener">${icon('external-link')}<span>Open full screen</span></a></div>`;
    } else {
      frame.innerHTML = `<iframe title="PDF preview" src="${url}#view=FitH"></iframe>`;
    }
    const foot = h('<footer class="modal-foot"></footer>');
    const name = fileName || doc?.fileName || 'document.pdf';
    const addBtn = (html, fn, kind = 'secondary') => {
      const b = h(`<button class="btn btn-${kind}">${html}</button>`);
      b.onclick = () => busy(b, fn).catch(toastError); foot.appendChild(b); return b;
    };
    if (doc?.fileUrl) {
      const a = h(`<a class="btn btn-ghost" href="${esc(doc.fileUrl)}" target="_blank" rel="noopener">${icon('folder-open')}<span>Google Drive</span></a>`);
      foot.appendChild(a);
    }
    addBtn(`${icon('download')}<span>Download</span>`, async () => {
      downloadBlob(blob, name);
      if (doc) await logShare(doc, 'PDF downloaded');
    });
    if (doc) addBtn(`${icon('whatsapp')}<span>WhatsApp</span>`, async () => { openWhatsApp(doc.eventId, doc, blob); }, 'whatsapp');
    m.el.querySelector('.modal').appendChild(foot);
    const obs = new MutationObserver(() => { if (!document.body.contains(m.el)) { URL.revokeObjectURL(url); obs.disconnect(); } });
    obs.observe(document.body, { childList: true });
  } catch (e) {
    body.querySelector('.viewer-frame').innerHTML = `<div class="loader error">${icon('circle-alert')} ${esc(e.message)}</div>`;
  }
  return m;
}

/* ---------------- WhatsApp ---------------- */

const TPL_KEY = { quotation: 'waQuote', confirmation: 'waConfirmation', invoice: 'waInvoice' };

export function whatsappLink(phone, text) {
  const p = normPhone(phone, store.settings.countryCode || '91');
  return `https://wa.me/${p}${text ? `?text=${encodeURIComponent(text)}` : ''}`;
}

/**
 * Prepare a WhatsApp message (and the PDF, when a document is given).
 * Nothing is sent automatically: the user picks the action, and WhatsApp itself does the sending.
 */
export async function openWhatsApp(eventId, doc = null, blob = null) {
  const ev = getEvent(eventId); const client = getClient(ev.clientId) || {};
  const s = store.settings;
  const f = financials(ev);
  const vars = docVars(ev, {
    docNumber: doc?.number || '',
    total: money(doc?.snapshot?.finance?.total ?? f.total), received: money(f.received),
    balance: money((doc?.snapshot?.finance?.total ?? f.total) - f.received),
  });
  const msg = fillTemplate(doc ? s[TPL_KEY[doc.type]] : s.waGeneral, vars);
  const canFileShare = (() => {
    try { return !!navigator.canShare && navigator.canShare({ files: [new File([new Blob(['x'], { type: 'application/pdf' })], 'a.pdf', { type: 'application/pdf' })] }); } catch { return false; }
  })();
  const google = store.adapter.kind === 'google' && doc?.fileId;
  const phones = [client.phone, client.altPhone].filter(Boolean);

  const body = h(`<div class="wa">
    <label class="field"><span>Send to</span>
      <div class="wa-to">${icon('whatsapp')}<input class="input" id="wa-phone" inputmode="tel" value="${esc(fmtPhone(normPhone(client.phone || '', s.countryCode)) || '')}" placeholder="WhatsApp number"></div>
      ${phones.length > 1 ? `<div class="chips">${phones.map((p) => `<button type="button" class="chip" data-phone="${esc(p)}">${esc(fmtPhone(normPhone(p, s.countryCode)))}</button>`).join('')}</div>` : ''}
    </label>
    <label class="field"><span>Message <em>edit before sending</em></span><textarea class="input" id="wa-msg" rows="9">${esc(msg)}</textarea></label>
    ${doc ? `<div class="wa-doc">${icon(DOC_TYPES[doc.type].icon)}<div><b>${esc(doc.fileName)}</b><small>${esc(doc.number)} · V${doc.version}</small></div></div>` : ''}
    ${google ? `<label class="check"><input type="checkbox" id="wa-link" ${s.whatsappIncludeLink ? 'checked' : ''}><span>Add a view link to this PDF in the message <em>(makes this one file viewable by anyone who has the link)</em></span></label>` : ''}
    ${doc ? `<div class="callout callout-info">${icon('info')}<div>${canFileShare
      ? '<b>Share PDF</b> opens your phone\'s share sheet with the PDF attached — choose WhatsApp, then the client\'s chat. The message is also copied so you can paste it if WhatsApp drops it.'
      : '<b>Open chat</b> downloads the PDF and opens this client\'s WhatsApp chat with the message typed in. Attach the downloaded PDF (drag it into the chat or use the paperclip) and press send.'}
      A plain WhatsApp link cannot attach files by itself; fully automatic sending needs the paid WhatsApp Business API.</div></div>` : ''}
  </div>`);
  autoGrow(body.querySelector('#wa-msg'));
  body.querySelectorAll('[data-phone]').forEach((b) => (b.onclick = () => { body.querySelector('#wa-phone').value = fmtPhone(normPhone(b.dataset.phone, s.countryCode)); }));

  const getText = async () => {
    let text = body.querySelector('#wa-msg').value;
    const linkBox = body.querySelector('#wa-link');
    if (linkBox?.checked) {
      let url = doc.publicUrl;
      if (!url) { url = await store.adapter.makePublic(doc); await setDocPublicUrl(doc, url); doc = { ...doc, publicUrl: url }; }
      text += `\n\nView / download: ${url}`;
    }
    return text;
  };
  const getPhone = () => {
    const p = normPhone(body.querySelector('#wa-phone').value, s.countryCode);
    if (p.length < 10) throw new Error('Enter a valid WhatsApp number.');
    return p;
  };
  const ensureBlob = async () => blob || (blob = await getDocBlob(doc));

  const actions = [];
  if (doc && canFileShare) {
    actions.push({ label: 'Share PDF…', kind: 'whatsapp', icon: 'share-2', run: async (close) => {
      const text = await getText();
      const file = new File([await ensureBlob()], doc.fileName, { type: 'application/pdf' });
      try { await navigator.clipboard?.writeText(text); } catch { /* optional */ }
      try {
        await navigator.share({ files: [file], text, title: doc.fileName });
        await logShare(doc, 'shared from the device share sheet (delivery not tracked)');
        close();
      } catch (e) {
        if (e.name !== 'AbortError') throw e;
      }
    } });
  }
  actions.push({
    label: doc && !canFileShare ? 'Download PDF & open chat' : 'Open WhatsApp chat', kind: doc && canFileShare ? 'secondary' : 'whatsapp', icon: 'whatsapp',
    run: async (close) => {
      const phone = getPhone();
      const win = window.open('', '_blank');
      try {
        const text = await getText();
        if (doc && !canFileShare) downloadBlob(await ensureBlob(), doc.fileName);
        const url = whatsappLink(phone, text);
        if (win) win.location.href = url; else window.location.href = url;
        if (doc) await logShare(doc, `WhatsApp chat opened for ${fmtPhone(phone)}${doc && !canFileShare ? ' (PDF downloaded to attach)' : ''} — delivery not tracked`);
        else await logActivity(ev.id, 'share', `WhatsApp chat opened for ${fmtPhone(phone)}`);
        close();
      } catch (e) { win?.close(); throw e; }
    },
  });
  modal({ title: doc ? `Send ${DOC_TYPES[doc.type].label} on WhatsApp` : `WhatsApp ${client.name || ''}`, icon: 'whatsapp', body, actions, size: 'md' });
}

/* ---------------- document list (used in tabs & client page) ---------------- */

export function docRows(docs, { showEvent = false } = {}) {
  if (!docs.length) return '';
  const latestIds = new Set();
  const seen = new Set();
  for (const d of [...docs].sort((a, b) => b.version - a.version)) {
    const k = d.eventId + d.type; if (!seen.has(k)) { seen.add(k); latestIds.add(d.id); }
  }
  return `<div class="doc-list">${docs.map((d) => {
    const ev = getEvent(d.eventId);
    const latest = latestIds.has(d.id);
    return `<div class="doc-row ${latest ? 'is-latest' : 'is-old'}" data-doc="${d.id}">
      <div class="doc-ic">${icon(DOC_TYPES[d.type].icon)}</div>
      <div class="doc-main">
        <div class="doc-title">${esc(DOC_TYPES[d.type].label)} <span class="ver">V${d.version}</span>
          ${latest ? '<span class="badge tone-gold">Latest</span>' : '<span class="badge tone-draft">Superseded</span>'}</div>
        <div class="doc-meta">${esc(d.number)} · ${esc(fmtDateTime(d.issuedAt))}${showEvent && ev ? ` · ${esc(ev.title)}` : ''}${d.sharedAt ? ` · <span title="Last shared/downloaded">${icon('share-2')} ${esc(fmtDateTime(d.sharedAt))}</span>` : ''}</div>
      </div>
      ${d.type === 'invoice' && d.total ? `<div class="doc-amt">${money(d.total)}</div>` : ''}
      <div class="doc-acts">
        <button class="icon-btn" data-doc-act="view" title="View">${icon('eye')}</button>
        <button class="icon-btn" data-doc-act="download" title="Download">${icon('download')}</button>
        <button class="icon-btn wa" data-doc-act="wa" title="WhatsApp">${icon('whatsapp')}</button>
      </div>
    </div>`;
  }).join('')}</div>`;
}

export function bindDocRows(root) {
  root.querySelectorAll('[data-doc-act]').forEach((b) => {
    b.onclick = (e) => {
      e.stopPropagation();
      const d = store.documents.find((x) => x.id === b.closest('[data-doc]').dataset.doc);
      const act = b.dataset.docAct;
      busy(b, async () => {
        if (act === 'view') return openViewer({ doc: d });
        const blob = await getDocBlob(d);
        if (!blob) throw new Error('PDF file not found in storage.');
        if (act === 'download') { downloadBlob(blob, d.fileName); await logShare(d, 'PDF downloaded'); }
        if (act === 'wa') openWhatsApp(d.eventId, d, blob);
      }).catch(toastError);
    };
  });
  root.querySelectorAll('.doc-row').forEach((r) => (r.onclick = () => openViewer({ doc: store.documents.find((x) => x.id === r.dataset.doc) })));
}

export { latestDoc, eventDocs };
