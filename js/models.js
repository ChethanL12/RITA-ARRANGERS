// Data model: tables, field types, statuses and default settings.
// Both storage adapters (Google Sheets and this-device) use this schema.

export const SCHEMA = {
  clients: {
    sheet: 'Clients',
    fields: ['id', 'name', 'phone', 'altPhone', 'email', 'address', 'notes', 'createdAt', 'updatedAt'],
    json: [], num: [],
  },
  events: {
    sheet: 'Events',
    fields: ['id', 'clientId', 'title', 'service', 'status', 'primaryDate', 'session', 'venue', 'refNo',
      'displayName', 'dates', 'customFields', 'sections', 'budget', 'quoteNote', 'confirmationNote',
      'billing', 'notes', 'cancelReason', 'createdAt', 'updatedAt', 'confirmedAt', 'completedAt', 'cancelledAt'],
    json: ['dates', 'customFields', 'sections', 'budget', 'billing'], num: [],
  },
  documents: {
    sheet: 'Documents',
    fields: ['id', 'eventId', 'clientId', 'type', 'number', 'baseNumber', 'version', 'status', 'issuedAt',
      'title', 'total', 'fileName', 'fileId', 'fileUrl', 'publicUrl', 'hash', 'sharedAt', 'snapshot', 'createdAt', 'updatedAt'],
    json: ['snapshot'], num: ['version', 'total'],
  },
  payments: {
    sheet: 'Payments',
    fields: ['id', 'eventId', 'clientId', 'amount', 'date', 'kind', 'method', 'reference', 'notes', 'createdAt', 'updatedAt'],
    json: [], num: ['amount'],
  },
  activity: {
    sheet: 'Activity',
    fields: ['id', 'eventId', 'clientId', 'type', 'message', 'at'],
    json: [], num: [],
  },
};
export const TABLES = Object.keys(SCHEMA);

export function encodeRecord(table, rec) {
  const s = SCHEMA[table]; const out = {};
  const keys = [...s.fields, ...Object.keys(rec).filter((k) => !s.fields.includes(k))];
  for (const k of keys) {
    if (!(k in rec)) continue;
    const v = rec[k];
    if (s.json.includes(k)) out[k] = v == null ? '' : JSON.stringify(v);
    else out[k] = v == null ? '' : String(v);
  }
  return out;
}
export function decodeRecord(table, row) {
  const s = SCHEMA[table]; const out = {};
  for (const [k, v] of Object.entries(row)) {
    if (s.json.includes(k)) {
      try { out[k] = v ? JSON.parse(v) : null; } catch { out[k] = null; }
    } else if (s.num.includes(k)) out[k] = v === '' || v == null ? 0 : Number(v);
    else out[k] = v == null ? '' : String(v);
  }
  return out;
}

/* ---------- Statuses ---------- */

export const STATUS = {
  enquiry: { label: 'Enquiry', short: 'Enquiry', tone: 'draft', booking: 'Not Confirmed', icon: 'notebook-pen' },
  quoted: { label: 'Quotation Sent', short: 'Quoted', tone: 'amber', booking: 'Not Confirmed', icon: 'file-text' },
  changes: { label: 'Changes Requested', short: 'Changes', tone: 'orange', booking: 'Not Confirmed', icon: 'pen-line' },
  confirmed: { label: 'Confirmed', short: 'Confirmed', tone: 'green', booking: 'Confirmed', icon: 'badge-check' },
  completed: { label: 'Completed', short: 'Completed', tone: 'slate', booking: 'Confirmed', icon: 'flag' },
  cancelled: { label: 'Cancelled', short: 'Cancelled', tone: 'red', booking: 'Cancelled', icon: 'ban' },
};
export const OPEN_STATUSES = ['enquiry', 'quoted', 'changes'];
export const isConfirmed = (s) => s === 'confirmed' || s === 'completed';

export const FORM_SESSIONS = ['day', 'night'];
export const SESSIONS = {
  day: { label: 'Day', icon: 'sun' },
  afternoon: { label: 'Afternoon', icon: 'sunset' },
  night: { label: 'Night', icon: 'moon' },
  fullday: { label: 'Full Day', icon: 'sunrise' },
};

export const PAYMENT_METHODS = ['Cash', 'UPI', 'Bank Transfer', 'Cheque', 'Card', 'Other'];
export const PAYMENT_KINDS = ['Advance', 'Part payment', 'Final payment'];

export const DOC_TYPES = {
  quotation: { label: 'Quotation', icon: 'file-text', heading: 'QUOTATION' },
  confirmation: { label: 'Booking Confirmation', icon: 'file-check', heading: 'BOOKING CONFIRMATION LETTER' },
  invoice: { label: 'Final Invoice', icon: 'receipt', heading: 'FINAL INVOICE' },
};

/* ---------- Settings ---------- */

export const DEFAULT_SETTINGS = {
  companyName: 'Rita Arrangers',
  tagline: 'Event Planner',
  address: 'Rita Complex, Lower Kasarkod, Honnavar, Karnataka - 581342',
  phone: '+91 94481 67493',
  email: '',
  proprietor: 'Everest Fernandes',
  signatoryTitle: 'Proprietor',
  signatureText: 'Digitally Signed by {proprietor}',
  logo: '',            // data URL of an uploaded logo; empty = bundled Rita Arrangers logo
  signatureImage: '',  // optional data URL
  currencySymbol: '₹',
  countryCode: '91',

  numberPrefix: 'RA',
  seqDigits: '3',
  quoteFormat: '{PREFIX}/{YYYY}/{SEQ}',
  confirmationMode: 'separate', // 'separate' | 'quotation' (reuse the event's quotation reference)
  confirmationFormat: '{PREFIX}/BC/{YYYY}/{SEQ}',
  invoiceFormat: '{PREFIX}/INV/{YYYY}/{SEQ}',

  quoteSubtitle: 'Scope of services and approximate budget prepared for you',
  confirmationSubtitle: 'Confirming your event booking with {company}',
  invoiceSubtitle: 'Statement of final charges for services rendered',

  quoteNote: 'This document outlines the scope of services and items proposed by {company} for the {eventName} of {clientName}. Quantities and specifications are subject to final confirmation closer to the event date. For any queries, please reach us using the details below.',
  confirmationNote: 'This document serves as official confirmation that the above event has been booked with {company}. We look forward to providing our event planning and management services for the {eventName} of {clientName}.\n\nFor any queries regarding the event, please feel free to reach us using the details below.',
  invoiceTerms: 'This invoice reflects the final agreed amount for the services provided by {company}. All payments received to date have been adjusted against the total. Thank you for choosing {company}.',
  paymentDetails: '',

  taxEnabled: false,
  taxLabel: 'GST',
  taxRate: '18',

  waQuote: 'Dear {clientName},\n\nGreetings from {company}!\n\nPlease find the quotation ({docNumber}) for your upcoming {eventName} scheduled for {eventDate}.\n\nKindly review the proposed arrangements and approximate budget. Please feel free to contact us for any clarifications or additional requirements.\n\nThank you for considering {company}.\n\nWarm regards,\nTeam {company}',
  waConfirmation: 'Dear {clientName},\n\nGreetings from {company}!\n\nWe are delighted to confirm your booking for the {eventName} on {eventDate}. Please find your Booking Confirmation Letter ({docNumber}) attached.\n\nWe look forward to making your occasion memorable.\n\nWarm regards,\nTeam {company}',
  waInvoice: 'Dear {clientName},\n\nGreetings from {company}!\n\nThank you for choosing us for your {eventName}. Please find the final invoice ({docNumber}) attached.\n\nTotal amount: {total}\nReceived: {received}\nBalance payable: {balance}\n\nWarm regards,\nTeam {company}',
  waGeneral: 'Dear {clientName},\n\nGreetings from {company}!\n\n',
  whatsappIncludeLink: false,
};

export const PLACEHOLDERS = [
  ['{clientName}', 'Client / couple name as addressed in documents'],
  ['{eventName}', 'Event name'],
  ['{eventDate}', 'Event date(s)'],
  ['{service}', 'Service'],
  ['{venue}', 'Venue'],
  ['{company}', 'Company name'],
  ['{proprietor}', 'Proprietor name'],
  ['{docNumber}', 'Document number (WhatsApp messages)'],
  ['{total} {received} {balance}', 'Amounts (invoice messages)'],
];
