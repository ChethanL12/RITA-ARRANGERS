// Client profile: contact details, every event, every document and every payment.

import { icon } from '../icons.js';
import { esc, fmtDate, fmtDateLong, initials, fmtPhone, money } from '../util.js';
import { store, getClient, clientEvents, financials, budgetText, occurrences, subscribe, saveClient, findClientByPhone, deleteClient } from '../store.js';
import { statusBadge, emptyState, modal, toast, sessionTag, typedDeleteDialog } from '../ui.js';
import { docRows, bindDocRows, openWhatsApp, whatsappLink } from '../docs.js';

export function render(root, { params, navigate }) {
  const id = params[0];
  function paint() {
    const c = getClient(id);
    if (!c) { root.innerHTML = `<div class="page">${emptyState({ icon: 'user', title: 'Client not found' })}</div>`; return; }
    const evs = clientEvents(id);
    const docs = store.documents.filter((d) => d.clientId === id).sort((a, b) => b.issuedAt.localeCompare(a.issuedAt));
    const pays = store.payments.filter((p) => p.clientId === id).sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    const tot = evs.filter((e) => e.status !== 'cancelled').reduce((s, e) => { const f = financials(e); s.billed += f.hasAgreed ? f.total : 0; s.received += f.received; s.due += f.hasAgreed && f.balance > 0 ? f.balance : 0; return s; }, { billed: 0, received: 0, due: 0 });
    root.innerHTML = `<div class="page">
      <div class="crumbs"><a href="#/clients">Clients &amp; Events</a>${icon('chevron-right')}<span>${esc(c.name)}</span></div>
      <section class="card client-hero">
        <span class="avatar lg">${esc(initials(c.name))}</span>
        <div class="ch-main">
          <h1>${esc(c.name || 'Unnamed client')}</h1>
          <div class="hero-meta">
            ${c.phone ? `<span class="meta-phone"><a href="tel:${esc(c.phone)}">${icon('phone')}${esc(fmtPhone(c.phone))}</a><a class="wa-dot" href="${esc(whatsappLink(c.phone, ''))}" target="_blank" rel="noopener" title="WhatsApp">${icon('whatsapp')}</a></span>` : ''}
            ${c.altPhone ? `<span>${icon('phone')}${esc(fmtPhone(c.altPhone))}</span>` : ''}
            ${c.email ? `<span>${icon('mail')}${esc(c.email)}</span>` : ''}
            ${c.address ? `<span>${icon('map-pin')}${esc(c.address)}</span>` : ''}
          </div>
          ${c.notes ? `<p class="muted pre">${esc(c.notes)}</p>` : ''}
        </div>
        <div class="ch-actions">
          <button class="btn btn-ghost danger-text" id="delete-client">${icon('trash-2')}<span>Delete client</span></button>
          <button class="btn btn-secondary" id="edit-client">${icon('pencil')}<span>Edit contact</span></button>
          <a class="btn btn-primary" href="#/events/new?clientId=${c.id}">${icon('calendar-plus')}<span>New event</span></a>
        </div>
        <div class="ch-stats">
          <div><small>Events</small><b>${evs.length}</b></div>
          <div><small>Billed</small><b>${money(tot.billed)}</b></div>
          <div><small>Received</small><b class="green">${money(tot.received)}</b></div>
          <div><small>Outstanding</small><b class="${tot.due ? 'amber' : ''}">${money(tot.due)}</b></div>
        </div>
      </section>
      <div class="two-col">
        <div>
          <h2 class="sec-title">${icon('calendar-days')} Events</h2>
          ${evs.length ? `<div class="event-cards">${evs.map((e) => { const f = financials(e); return `<a class="card event-card" href="#/events/${e.id}">
            <div class="ec-top">${statusBadge(e.status)}${e.refNo ? `<span class="ref">${esc(e.refNo)}</span>` : ''}</div>
            <h3>${esc(e.title || 'Untitled event')}</h3>
            <div class="ec-dates">${occurrences(e).map((o) => `<span>${icon('calendar-days')}${esc(fmtDate(o.date))}${o.label ? ` · ${esc(o.label)}` : ''} ${sessionTag(o.session)}</span>`).join('') || '<span class="muted">No date</span>'}</div>
            ${e.venue ? `<div class="muted small">${icon('map-pin')} ${esc(e.venue)}</div>` : ''}
            <div class="ec-money"><span>${f.hasAgreed ? 'Total' : 'Budget'} <b>${f.hasAgreed ? money(f.total) : esc(budgetText(e.budget) || '—')}</b></span><span>Received <b class="green">${money(f.received)}</b></span>${f.hasAgreed ? `<span>Balance <b class="${f.balance > 0 ? 'amber' : ''}">${money(f.balance)}</b></span>` : ''}</div>
          </a>`; }).join('')}</div>` : `<div class="card">${emptyState({ icon: 'calendar', title: 'No events yet' })}</div>`}
        </div>
        <div>
          <h2 class="sec-title">${icon('files')} Documents</h2>
          <div class="card">${docs.length ? docRows(docs, { showEvent: true }) : '<p class="muted small">No documents issued yet.</p>'}</div>
          <h2 class="sec-title">${icon('wallet')} Payment history</h2>
          <div class="card">${pays.length ? `<div class="pay-list">${pays.map((p) => `<div class="pay-row"><span class="pay-ic">${icon('banknote')}</span><span class="pay-main"><b>${money(p.amount)}</b><small>${esc(fmtDateLong(p.date))} · ${esc(p.method)} · ${esc(store.events.find((e) => e.id === p.eventId)?.title || '')}</small></span></div>`).join('')}</div>` : '<p class="muted small">No payments recorded.</p>'}</div>
        </div>
      </div>
    </div>`;
    bindDocRows(root);
    root.querySelector('#edit-client').onclick = () => editClient(c);
    root.querySelector('#delete-client').onclick = async () => {
      const r = await typedDeleteDialog({
        title: 'Delete this client permanently?',
        message: `<b>${esc(c.name || 'Client')}</b> and everything linked to them will be removed for good from the app and the Google Sheet: contact details, ${evs.length} event${evs.length === 1 ? '' : 's'}, ${docs.length} document${docs.length === 1 ? '' : 's'}, ${pays.length} payment record${pays.length === 1 ? '' : 's'} and all history. This cannot be undone.`,
      });
      if (!r) return;
      unsub();
      await deleteClient(c.id).catch((e) => { toast(e.message, { type: 'error' }); throw e; });
      toast('Client and all their records deleted', { type: 'info' });
      navigate('#/clients');
    };
  }

  function editClient(c) {
    const body = `<div class="grid-2">
      <label class="field"><span>Name <b class="req">*</b></span><input class="input" id="ec-name" value="${esc(c.name || '')}"></label>
      <label class="field"><span>WhatsApp / mobile <b class="req">*</b></span><input class="input" id="ec-phone" inputmode="tel" value="${esc(c.phone || '')}"></label>
      <label class="field"><span>Additional contact</span><input class="input" id="ec-alt" inputmode="tel" value="${esc(c.altPhone || '')}"></label>
      <label class="field"><span>Email</span><input class="input" id="ec-email" type="email" value="${esc(c.email || '')}"></label>
    </div>
    <label class="field"><span>Address</span><input class="input" id="ec-address" value="${esc(c.address || '')}"></label>
    <label class="field"><span>Notes</span><textarea class="input" id="ec-notes" rows="3">${esc(c.notes || '')}</textarea></label>
    <p class="muted small">${icon('info')} Updated details are used for all new documents. Already-issued PDFs keep the details they were issued with.</p>`;
    modal({
      title: 'Edit client', icon: 'user', body,
      actions: [{ label: 'Cancel', kind: 'ghost' }, { label: 'Save', kind: 'primary', run: async (close, el) => {
        const v = (s) => el.querySelector(s).value.trim();
        if (!v('#ec-name')) throw new Error('Client name is required.');
        if (v('#ec-phone').replace(/\D/g, '').length < 10) throw new Error('Enter a valid phone number.');
        const dup = findClientByPhone(v('#ec-phone'), c.id);
        if (dup) throw new Error(`That number already belongs to ${dup.name}.`);
        await saveClient({ id: c.id, name: v('#ec-name'), phone: v('#ec-phone'), altPhone: v('#ec-alt'), email: v('#ec-email'), address: v('#ec-address'), notes: v('#ec-notes') });
        close(); toast('Client updated');
      } }],
    });
  }

  paint();
  const unsub = subscribe(paint);
  return unsub;
}
