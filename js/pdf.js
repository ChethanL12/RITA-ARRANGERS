// PDF engine (pdfmake). Renders a frozen document snapshot into an A4 PDF.
// Layout follows the Rita Arrangers reference documents: letterhead, centred title,
// reference bar, client & event details, sectioned requirement tables, budget/amount
// box, note, and the Issued-by / Authorisation footer.

import { store } from './store.js';
import { fmtDateLong, fmtTime, money, amountInWords, num } from './util.js';
import { SESSIONS } from './models.js';

const C = {
  gold: '#8C6A22', goldSoft: '#B8964A', champagne: '#F3E8CC', ivory: '#FBF8F2',
  alt: '#F6F1E6', line: '#E3D8C0', text: '#2A2622', muted: '#776E63', head: '#86651F', green: '#2F6B45',
};

let libPromise;
function loadScript(src) {
  return new Promise((res, rej) => {
    const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = () => rej(new Error('Could not load ' + src)); document.head.appendChild(s);
  });
}
export function loadPdfLib() {
  if (!libPromise) {
    libPromise = (async () => {
      if (!window.pdfMake) await loadScript('vendor/pdfmake.min.js');
      if (!window.RA_PDF_FONTS) await loadScript('vendor/pdf-fonts.js');
      window.pdfMake.vfs = window.RA_PDF_FONTS;
      window.pdfMake.fonts = {
        Inter: { normal: 'Inter_400Regular.ttf', bold: 'Inter_600SemiBold.ttf', italics: 'Inter_400Regular_Italic.ttf', bolditalics: 'Inter_400Regular_Italic.ttf' },
        InterStrong: { normal: 'Inter_500Medium.ttf', bold: 'Inter_700Bold.ttf', italics: 'Inter_400Regular_Italic.ttf', bolditalics: 'Inter_400Regular_Italic.ttf' },
        Serif: { normal: 'CormorantGaramond_600SemiBold.ttf', bold: 'CormorantGaramond_700Bold.ttf', italics: 'CormorantGaramond_500Medium_Italic.ttf', bolditalics: 'CormorantGaramond_600SemiBold_Italic.ttf' },
      };
      return window.pdfMake;
    })().catch((e) => { libPromise = null; throw e; });
  }
  return libPromise;
}

const imgCache = {};
async function urlToDataURL(url) {
  if (imgCache[url]) return imgCache[url];
  const blob = await (await fetch(url)).blob();
  const d = await new Promise((r) => { const f = new FileReader(); f.onload = () => r(f.result); f.readAsDataURL(blob); });
  imgCache[url] = d; return d;
}
async function logoData() {
  const s = store.settings;
  if (s.logo && s.logo.startsWith('data:')) return s.logo;
  return urlToDataURL('assets/logo-print.png');
}

/* ---------------- building blocks ---------------- */

const HEADINGS = { quotation: 'QUOTATION', confirmation: 'BOOKING CONFIRMATION LETTER', invoice: 'FINAL INVOICE' };

function letterhead(snap, logo) {
  const co = snap.company;
  return [
    {
      columns: [
        { image: logo, width: 138, fit: [138, 76] },
        {
          width: '*', alignment: 'right', margin: [16, 6, 0, 0],
          stack: [
            { text: (co.name || '').toUpperCase(), font: 'Serif', bold: true, fontSize: 20, color: C.gold, characterSpacing: 1.5 },
            co.tagline ? { text: co.tagline, font: 'Serif', italics: true, fontSize: 11.5, color: C.text, margin: [0, 0, 0, 3] } : null,
            { text: co.address || '', fontSize: 8.6, color: C.muted, lineHeight: 1.25 },
            { text: [co.phone, co.email].filter(Boolean).join('   ·   '), fontSize: 8.6, color: C.muted },
          ].filter(Boolean),
        },
      ],
    },
    { canvas: [
      { type: 'line', x1: 0, y1: 0, x2: 503, y2: 0, lineWidth: 1.4, lineColor: C.goldSoft },
      { type: 'line', x1: 0, y1: 3, x2: 503, y2: 3, lineWidth: 0.4, lineColor: C.goldSoft },
    ], margin: [0, 10, 0, 0] },
  ];
}

function titleBlock(snap) {
  return {
    stack: [
      { text: HEADINGS[snap.type], font: 'Serif', bold: true, fontSize: 24, color: C.gold, alignment: 'center', characterSpacing: 2.2 },
      snap.company.subtitle ? { text: snap.company.subtitle, font: 'Serif', italics: true, fontSize: 11.5, color: C.muted, alignment: 'center', margin: [0, 1, 0, 0] } : null,
    ].filter(Boolean),
    margin: [0, 16, 0, 14],
  };
}

function refBar(snap) {
  const label = snap.type === 'invoice' ? 'Invoice No.' : 'Reference No.';
  const number = snap.preview && !snap.number ? 'Assigned on issue' : snap.number;
  const left = [{ text: label + '  ', bold: true, color: C.head }, { text: number, font: 'InterStrong' }];
  if (snap.version > 1) left.push({ text: `    Revision ${snap.version - 1}`, color: C.muted, fontSize: 8.5 });
  const right = [{ text: 'Date:  ', bold: true, color: C.head }, fmtDateLong(snap.issuedAt)];
  const rows = [[{ text: left, margin: [8, 7, 4, 7] }, { text: right, alignment: 'right', margin: [4, 7, 8, 7] }]];
  if (snap.type === 'invoice' && snap.finance?.dueDate) {
    rows.push([{ text: '' , margin: [8, 0, 4, 6] }, { text: [{ text: 'Payment due:  ', bold: true, color: C.head }, fmtDateLong(snap.finance.dueDate)], alignment: 'right', margin: [4, 0, 8, 7] }]);
  }
  return {
    table: { widths: ['*', 'auto'], body: rows },
    layout: {
      fillColor: () => C.ivory,
      hLineWidth: (i, n) => (i === 0 || i === n.table.body.length ? 0.6 : 0), vLineWidth: (i, n) => (i === 0 || i === n.table.widths.length ? 0.6 : 0),
      hLineColor: () => C.line, vLineColor: () => C.line, paddingLeft: () => 0, paddingRight: () => 0, paddingTop: () => 0, paddingBottom: () => 0,
    },
    fontSize: 9.5,
  };
}

function sectionHeading(text, extra = {}) {
  return { text: text.toUpperCase(), font: 'InterStrong', bold: true, fontSize: 10.2, color: C.head, characterSpacing: 0.6, margin: [0, 16, 0, 6], headlineLevel: 1, ...extra };
}

const zebra = (startRow = 0) => ({
  fillColor: (i) => (i < startRow ? null : ((i - startRow) % 2 === 0 ? C.alt : null)),
  hLineWidth: (i, n) => (i === 0 || i === n.table.body.length ? 0.6 : 0.4), vLineWidth: () => 0,
  hLineColor: () => C.line, paddingLeft: () => 8, paddingRight: () => 8, paddingTop: () => 6, paddingBottom: () => 6,
});

function sessionText(o) {
  const parts = [];
  if (o.session && SESSIONS[o.session]) parts.push(SESSIONS[o.session].label);
  if (o.start) parts.push(o.end ? `${fmtTime(o.start)} – ${fmtTime(o.end)}` : `from ${fmtTime(o.start)}`);
  return parts.join(', ');
}

function detailsTable(snap) {
  const ev = snap.event; const rows = [];
  const add = (k, v, opts = {}) => { if (v != null && String(v).trim() !== '') rows.push([{ text: k, bold: true, color: C.head, fontSize: 9.2 }, { text: v, ...opts }]); };
  const custom = ev.customFields || [];
  const customNames = custom.map((c) => c.label.trim().toLowerCase());
  if (snap.type === 'invoice') {
    add('Billed To', [snap.client.name, snap.client.phone, snap.client.address].filter(Boolean).join('\n'));
  } else if (!customNames.includes('bride') && !customNames.includes('client')) {
    add('Client', snap.client.name);
  }
  for (const c of custom) add(c.label, c.value);
  add('Event', ev.title);
  const dates = ev.dates || [];
  dates.forEach((o, i) => {
    const label = o.label?.trim() || (dates.length > 1 ? `Event Date ${i + 1}` : 'Event Date');
    const s = sessionText(o);
    add(label, fmtDateLong(o.date) + (s ? `  ·  ${s}` : ''));
  });
  add('Venue', ev.venue);
  add('Service', ev.service);
  if (snap.type === 'quotation') add('Approximate Budget', snap.budget);
  if (snap.type === 'confirmation') rows.push([
    { text: 'Booking Status', bold: true, color: C.head, fontSize: 9.2, fillColor: C.champagne },
    { text: 'CONFIRMED', font: 'InterStrong', bold: true, color: C.gold, characterSpacing: 1.2, fillColor: C.champagne },
  ]);
  return [sectionHeading('Client & Event Details'), { table: { widths: [138, '*'], body: rows, dontBreakRows: true }, layout: zebra(0), fontSize: 9.6 }];
}

function requirementTables(snap) {
  const out = [];
  for (const sec of snap.sections || []) {
    if (!sec.items?.length) continue;
    const body = [[
      { text: 'No.', style: 'th', alignment: 'center' },
      { text: 'Description of Services and Items', style: 'th' },
      { text: 'Remarks', style: 'th' },
    ]];
    sec.items.forEach((it, i) => body.push([
      { text: String(i + 1), alignment: 'center', color: C.muted },
      { text: it.description || '' },
      { text: it.remarks?.trim() ? it.remarks : '-', color: it.remarks?.trim() ? C.text : C.muted },
    ]));
    out.push(sectionHeading(sec.title || 'Requirements'));
    out.push({
      table: { headerRows: 1, keepWithHeaderRows: 1, dontBreakRows: true, widths: [30, '*', 168], body },
      layout: {
        ...zebra(1),
        fillColor: (i) => (i === 0 ? C.gold : ((i - 1) % 2 === 1 ? C.alt : null)),
        hLineColor: (i) => (i <= 1 ? C.gold : C.line),
      },
      fontSize: 9.3,
    });
  }
  return out;
}

function highlightBox(label, value, { sub } = {}) {
  return {
    table: {
      widths: ['*', 'auto'],
      body: [[
        { stack: [{ text: label, font: 'InterStrong', bold: true, color: C.head, fontSize: 10 }, sub ? { text: sub, fontSize: 8, italics: true, color: C.muted, margin: [0, 2, 0, 0] } : null].filter(Boolean), margin: [10, 9, 6, 9] },
        { text: value, font: 'InterStrong', bold: true, fontSize: 11.5, color: C.gold, alignment: 'right', margin: [6, 9, 10, 9] },
      ]],
    },
    layout: { fillColor: () => C.champagne, hLineWidth: () => 0, vLineWidth: () => 0, paddingLeft: () => 0, paddingRight: () => 0, paddingTop: () => 0, paddingBottom: () => 0 },
    margin: [0, 14, 0, 0], unbreakable: true,
  };
}

function financeBlock(snap) {
  const f = snap.finance; const sym = snap.company.currencySymbol; const m = (v) => money(v, sym);
  const out = [sectionHeading('Billing Summary')];
  const body = [[{ text: 'Description', style: 'th' }, { text: 'Amount', style: 'th', alignment: 'right' }]];
  body.push([{ text: [`Agreed amount for services`, snap.event.title ? { text: ` — ${snap.event.title}`, color: C.muted } : ''] }, { text: m(f.agreed), alignment: 'right' }]);
  for (const c of f.charges) body.push([{ text: [{ text: 'Additional: ', color: C.muted }, c.label || 'Additional charge'] }, { text: m(c.amount), alignment: 'right' }]);
  for (const d of f.discounts) body.push([{ text: [{ text: 'Less: ', color: C.muted }, d.label || 'Discount'] }, { text: '– ' + m(d.amount), alignment: 'right', color: C.green }]);
  if (f.applyTax && f.tax) {
    body.push([{ text: 'Subtotal', bold: true }, { text: m(f.subtotal), alignment: 'right', bold: true }]);
    body.push([{ text: `${f.taxLabel || 'Tax'} @ ${num(f.taxRate)}%` }, { text: m(f.tax), alignment: 'right' }]);
  }
  out.push({
    table: { headerRows: 1, dontBreakRows: true, widths: ['*', 120], body },
    layout: { ...zebra(1), fillColor: (i) => (i === 0 ? C.gold : ((i - 1) % 2 === 1 ? C.alt : null)), hLineColor: (i) => (i <= 1 ? C.gold : C.line) },
    fontSize: 9.6,
  });
  out.push(highlightBox('Total Amount', m(f.total), { sub: amountInWords(f.total) }));

  if (f.showPayments && f.payments.length) {
    out.push(sectionHeading('Payments Received'));
    const pb = [[{ text: 'Date', style: 'th' }, { text: 'Mode', style: 'th' }, { text: 'Reference', style: 'th' }, { text: 'Amount', style: 'th', alignment: 'right' }]];
    for (const p of f.payments) pb.push([fmtDateLong(p.date), p.method || '', p.reference || '-', { text: m(p.amount), alignment: 'right' }]);
    pb.push([{ text: 'Total received', bold: true, colSpan: 3 }, {}, {}, { text: m(f.received), bold: true, alignment: 'right' }]);
    out.push({
      table: { headerRows: 1, dontBreakRows: true, widths: [110, 90, '*', 110], body: pb },
      layout: { ...zebra(1), fillColor: (i) => (i === 0 ? C.gold : ((i - 1) % 2 === 1 ? C.alt : null)), hLineColor: (i) => (i <= 1 ? C.gold : C.line) },
      fontSize: 9.4,
    });
  }
  const balance = f.total - f.received;
  const status = balance <= 0 ? (balance < 0 ? 'Overpaid' : 'Paid in Full') : (f.received > 0 ? 'Partially Paid' : 'Unpaid');
  out.push(highlightBox(balance < 0 ? 'Excess Received' : 'Balance Payable', m(Math.abs(balance)), { sub: `Payment status: ${status}${balance > 0 ? '  ·  ' + amountInWords(balance) : ''}` }));
  if (f.remarks) out.push({ text: [{ text: 'Remarks: ', bold: true, color: C.head }, f.remarks], fontSize: 9.2, margin: [0, 10, 0, 0] });
  if (snap.company.paymentDetails) {
    out.push({
      stack: [
        { text: 'PAYMENT DETAILS', font: 'InterStrong', bold: true, fontSize: 8.8, color: C.head, characterSpacing: 0.6, margin: [0, 0, 0, 3] },
        { text: snap.company.paymentDetails, fontSize: 9, lineHeight: 1.3 },
      ],
      margin: [0, 12, 0, 0], unbreakable: true,
    });
  }
  return out;
}

function noteAndSignoff(snap, signature) {
  const co = snap.company;
  const noteTitle = snap.type === 'quotation' ? 'Note' : snap.type === 'confirmation' ? 'Confirmation Note' : 'Payment Terms';
  const paragraphs = String(snap.note || '').split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  const sigStack = [
    { text: 'AUTHORISATION', font: 'InterStrong', bold: true, fontSize: 8.6, color: C.head, characterSpacing: 0.6 },
  ];
  if (signature) sigStack.push({ image: signature, fit: [120, 40], alignment: 'right', margin: [0, 3, 0, 0] });
  sigStack.push(
    { text: co.signatureText, bold: true, color: C.gold, fontSize: 9.6, margin: [0, 2, 0, 0] },
    { text: `${co.signatoryTitle} – ${co.name}`, fontSize: 9 },
    { text: `Generated on ${fmtDateLong(snap.issuedAt)}`, italics: true, fontSize: 8, color: C.muted, margin: [0, 1, 0, 0] },
  );
  return {
    unbreakable: true,
    stack: [
      paragraphs.length ? sectionHeading(noteTitle, { margin: [0, 20, 0, 5] }) : null,
      ...paragraphs.map((p) => ({ text: p, fontSize: 9.5, lineHeight: 1.38, margin: [0, 0, 0, 5], alignment: 'justify' })),
      { canvas: [{ type: 'line', x1: 0, y1: 0, x2: 503, y2: 0, lineWidth: 0.8, lineColor: C.goldSoft }], margin: [0, 16, 0, 12] },
      {
        columns: [
          { width: '*', stack: [
            { text: 'ISSUED BY', font: 'InterStrong', bold: true, fontSize: 8.6, color: C.head, characterSpacing: 0.6 },
            { text: co.name, bold: true, fontSize: 9.8, margin: [0, 2, 0, 0] },
            { text: `${co.signatoryTitle}: ${co.proprietor}`, fontSize: 9 },
            { text: `Contact: ${co.phone}`, fontSize: 9 },
          ] },
          { width: '*', alignment: 'right', stack: sigStack },
        ],
      },
    ].filter(Boolean),
  };
}

/* ---------------- document definition ---------------- */

export async function buildDefinition(snap) {
  const logo = await logoData();
  const signature = store.settings.signatureImage?.startsWith('data:') ? store.settings.signatureImage : null;
  const co = snap.company;
  const content = [...letterhead(snap, logo), titleBlock(snap), refBar(snap), ...detailsTable(snap), ...requirementTables(snap)];
  if (snap.type === 'quotation' && snap.budget) content.push(highlightBox('Approximate Budget', snap.budget));
  if (snap.type === 'invoice') content.push(...financeBlock(snap));
  content.push(noteAndSignoff(snap, signature));

  return {
    pageSize: 'A4',
    pageMargins: [46, 54, 46, 54],
    info: { title: `${HEADINGS[snap.type]} ${snap.number || ''}`.trim(), author: co.name, creator: co.name, subject: snap.event.title },
    watermark: snap.preview ? { text: 'PREVIEW', color: C.goldSoft, opacity: 0.08, bold: true, fontSize: 90 } : undefined,
    background: (page, size) => ({ canvas: [{ type: 'rect', x: 0, y: 0, w: size.width, h: 5, color: C.goldSoft }] }),
    header: (page) => (page === 1 ? null : {
      margin: [46, 22, 46, 0],
      columns: [
        { text: (co.name || '').toUpperCase(), font: 'Serif', bold: true, color: C.gold, fontSize: 11, characterSpacing: 1 },
        { text: `${HEADINGS[snap.type]}  ·  ${snap.number || 'Preview'}`, alignment: 'right', fontSize: 8, color: C.muted, margin: [0, 2, 0, 0] },
      ],
    }),
    footer: (page, pages) => ({
      margin: [46, 18, 46, 0],
      columns: [
        { text: `${co.name}  ·  ${co.phone}`, fontSize: 7.5, color: C.muted },
        { text: `Page ${page} of ${pages}`, alignment: 'right', fontSize: 7.5, color: C.muted },
      ],
    }),
    content,
    pageBreakBefore: (node, followingOnPage) => node.headlineLevel === 1 && followingOnPage.length === 0,
    defaultStyle: { font: 'Inter', fontSize: 9.6, color: C.text, lineHeight: 1.18 },
    styles: { th: { bold: true, color: '#FFFFFF', fontSize: 9 } },
  };
}

export async function renderPdf(snap) {
  const pdfMake = await loadPdfLib();
  const dd = await buildDefinition(snap);
  return new Promise((res, rej) => {
    try { pdfMake.createPdf(dd).getBlob((b) => res(b)); } catch (e) { rej(e); }
  });
}
