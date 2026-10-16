# Rita Arrangers · Event Manager

A private event, booking, quotation and billing app for **Rita Arrangers**. It replaces the paper diary: when a client calls, you open the calendar, click the date, type the enquiry, and the app produces the quotation, the booking confirmation letter and the final invoice as PDFs, all from the same saved record.

```
Enquiry → Requirements → Quotation (V1, V2, V3…) → Confirm Booking → Confirmation Letter → Payments → Final Invoice
```

---

## What it does

| # | Your requirement | Where it lives in the app |
|---|---|---|
| 1 | Client enquiry form | **New Enquiry**: click any calendar date, or the gold **+** button |
| 2 | Quotation PDF | **Save & generate quotation**, then preview, issue, download or WhatsApp |
| 3 | Calendar shows it as Not Confirmed | Automatic. Amber = not confirmed, green = confirmed, red = cancelled |
| 4 | Booking confirmation without retyping | **Confirm Booking**, then **Generate Booking Confirmation** |
| 5 | Revised quotations with history | **Edit Requirements**, then **Save & revise quotation**. V1/V2/V3 are all kept; the newest is marked *Latest* |
| 6 | Everything under one client & event | Event page tabs: *Overview, Requirements, Quotations, Booking Confirmation, Payments & Final Bill, Activity History* |
| 7 | Advance payments | **Record Advance Payment** on the event page (advance, part or final payment; amount, date, method, reference). Received and outstanding totals update automatically |
| 8 | Final invoice | **Payments & Final Bill** tab: agreed amount, extra charges, discounts, optional tax, payments deducted, balance |
| 9 | Pending tasks & payment status | **Documents & tasks** checklist on every event. It also warns when a document is out of date |
| 10 | Calendar by status | **Calendar** page: month or list view, filter by Enquiry / Quotation Sent / Changes Requested / Confirmed / Completed / Cancelled |
| 11 | Many events per client | **New event for this client** reuses saved contact details. Each event keeps its own documents and payments |
| 12 | Download & record keeping | Issued PDFs download to your device. Every version stays listed on the event page and can be downloaded again at any time, on any device, identical to the original |
| + | Reports & analytics | **Reports & Analytics**: filter by month, year, custom dates or all time, and by Day / Night and status. Shows money received until today, still to receive, confirmed business and possible business, a month-by-month chart, an event list, and a CSV download |

Other things that work the way you asked:

- **Several events on one date, even in the same session.** Nothing is ever blocked. The form and the calendar show a same-session overlap warning, and a date with many events shows a **+ more** link.
- **Each date is its own event.** In New Enquiry you enter the client once, then Date, Event Type, Day/Night and Venue. **Add Another Date** creates a separate event (for example a Roce Ceremony and a Wedding Ceremony), each with its own requirements, amounts, budget and quotation.
- **Fast requirement entry.** Press **Enter** to move from Description to Remarks to Amount and then to a new row. **Shift+Enter** adds a line break. You can drag rows to reorder them, move rows between sections, or paste a list copied from Excel or Word.
- **Optional amounts and an automatic budget.** Each item can have an amount: a figure (`25000`, `25k`, `1.5L`) or a range (`20000-45000`). Each section shows its total, and the approximate budget is worked out automatically. It becomes a range if any item is a range. Items left blank are not counted and never show as ₹0, and the quotation notes when some items are still unpriced.
- **Reference numbers** look like `RA/2026/047`, never repeat, and revisions add `-R1`, `-R2`. Quotations, confirmations (`RA/BC/…`) and invoices (`RA/INV/…`) each have their own sequence. In **Settings → Numbering** you can make the confirmation reuse the quotation reference instead, and continue from your existing paper numbers.
- **Settings** hold the company details, logo, signature, numbering, default notes, payment terms, bank/UPI details, WhatsApp messages and optional GST. Changes apply to new documents; PDFs already issued are never altered.
- **Tidy PDFs.** The Issued by / Authorisation block is a footer fixed to the bottom of every page. If a document would spill only a little onto an extra page, it tightens its spacing so the content fits on one page less.
- **Unsaved work is safe.** If a phone call interrupts you, the form keeps a recoverable draft on the device.

---

## Why this setup (Google Sheets + Apps Script + Vercel)

Your idea is the right one.

| Part | Role | Cost |
|---|---|---|
| **The app** (this repository: HTML, CSS, JavaScript) | What you see and use. Hosted on **Vercel** | Free |
| **Google Sheet** | The database: Clients, Events, Documents, Payments, Activity, Settings tabs. You can open it and read your records any time | Free |
| **Google Apps Script** (`backend/Code.gs`) | The small program inside the Sheet that saves and loads data, protected by your PIN | Free |

Reasons for this choice:

- **No subscriptions, no servers to maintain.** Google keeps the data and backs it up.
- **Phone and laptop see the same data.**
- **It stays "old-school friendly".** Your records are a normal Google Sheet you can open, print or export.

There is also a **"This device only"** mode. It needs no setup and stores everything in the browser, so you can try the app right away. Later, move to Google with *Settings → Download backup*, switch storage, then *Restore from backup*. Your records and PDFs come along.

---

## Google setup (one time, about 10 minutes)

1. Go to [sheets.google.com](https://sheets.google.com) and create a **blank spreadsheet**. Name it, for example, *Rita Arrangers – Records*.
2. In the sheet, open **Extensions → Apps Script**.
3. Delete what is in `Code.gs`, then paste the whole content of [`backend/Code.gs`](backend/Code.gs). Click **Save** (💾).
   *Optional:* under ⚙️ *Project Settings*, tick *Show "appsscript.json"*, then paste [`backend/appsscript.json`](backend/appsscript.json) to set the time zone to India.
4. Go back to the spreadsheet tab and **reload** the page. A new menu appears: **Rita Arrangers**.
5. Click **Rita Arrangers → Set up / change PIN**. Google asks for permission the first time: choose your account, then *Advanced → Go to (project) → Allow*. This is your own script asking to use your own Sheet. Enter a PIN of at least 6 characters, twice.
6. In the Apps Script tab, click **Deploy → New deployment**. Choose type **Web app** (⚙️ icon) and set:
   - *Execute as:* **Me**
   - *Who has access:* **Anyone**

   Click **Deploy** and copy the **Web app URL** (ends in `/exec`).

   "Anyone" only means the address can be reached. Every request still needs your PIN-based sign-in, and the Sheet itself stays private.
7. Open the app, choose **Google Sheets**, paste the URL, and enter your PIN.

On each new phone or laptop, open the app, paste the same URL and enter the PIN. To sign out every device, use **Rita Arrangers → Sign out all devices** in the Sheet.

**After updating `Code.gs` later:** use *Deploy → Manage deployments → ✏️ Edit → Version: New version → Deploy*. This keeps the same URL, so devices don't need to reconnect.

---

## Putting the app online with Vercel

1. Create a free account at [vercel.com](https://vercel.com) and choose **Add New → Project**.
2. Import this GitHub repository. Framework preset: **Other**. Leave the build command empty and the output directory as the root.
3. Click **Deploy**. You get an address like `rita-arrangers.vercel.app`. Bookmark it, and on your phone use **Add to Home Screen**: it opens like an app with the Rita Arrangers icon.

`vercel.json` adds strict security headers: Content-Security-Policy, no framing, no search-engine indexing. The site contains no client data. Data only arrives after you sign in with your PIN.

GitHub Pages or Netlify work too. The app is plain static files.

---

## WhatsApp: what is possible and what is not

A normal WhatsApp link (`wa.me`) can open a client's chat with a **typed message**, but it **cannot attach a PDF**. Fully automatic sending needs the **WhatsApp Business Platform (Cloud API)**. That requires Meta business verification, approved message templates, a server, and per-conversation charges, so it is not used here.

What the green **WhatsApp** button does instead (nothing is ever sent without you pressing send in WhatsApp):

- **On a phone:** **Share PDF…** opens the phone's share sheet with the PDF attached. You choose WhatsApp, then the client. The message is also copied, so you can paste it if WhatsApp drops the caption.
- **On a laptop:** **Download PDF & open chat** downloads the PDF and opens the client's WhatsApp chat with the message already typed. You drag the PDF into the chat and press send.

The message is always editable. Templates live in *Settings → WhatsApp*. The Activity History records "WhatsApp chat opened" or "shared", never "delivered", because WhatsApp doesn't report delivery to the app.

---

## Daily use, quick guide

- **Client calls (new enquiry):** Calendar, then click the date. Type the name and WhatsApp number, then the event type, Day or Night, and venue. Add sections and items, with amounts where you have them; the approximate budget is calculated for you. For another function on a different date, click **Add Another Date**. Then **Save & generate quotation**, **Issue**, and **WhatsApp**.
- **Client asks for changes:** open the event, go to **Requirements → Edit Requirements**, add or change items or amounts, then **Save & revise quotation**. V2 is issued and V1 is kept.
- **Client confirms:** **Confirm Booking** on the Overview tab (the calendar turns green), then **Booking Confirmation → Generate**, then **WhatsApp**.
- **Advance received:** **Record Advance Payment** at the top of the event page.
- **After the event:** **⋯ → Mark event completed**, then on **Payments & Final Bill** enter the final amount and any extra charges or discounts, then **Issue final invoice**. Payments already received are deducted automatically.
- **Booking cancelled:** **⋯ → Cancel booking**. The record stays (muted in the calendar) and can be restored later.

---

## Security & privacy

- **Google mode:** data stays in your private Google Sheet. The app signs in with your PIN; the PIN is stored only as a salted SHA-256 hash, and sessions last 30 days. After 5 wrong PINs, sign-in is locked for 15 minutes.
- **Device mode:** data stays in the browser. You can set an app PIN in *Settings → Storage & security*. Keep regular backups, because clearing browser data erases device-mode records.
- Values are stored in the Sheet as plain text, so phone numbers keep their format and nothing is treated as a formula.

---

## For developers

The app is plain HTML, CSS and ES modules, with no build step.

```
index.html            app shell
css/app.css           design system (ivory · charcoal · champagne gold; Cormorant Garamond + Inter)
js/app.js             storage selection, sign-in, router
js/store.js           state + all business rules (numbering, versions, finance, checklist)
js/adapters.js        GoogleAdapter (Apps Script) and LocalAdapter (IndexedDB), same interface
js/pdf.js             PDF engine (pdfmake): quotation, confirmation letter, final invoice
js/docs.js            issue / preview / view PDFs, WhatsApp sharing
js/views/*.js         dashboard, calendar, event form, requirements editor, event page, clients, settings
backend/Code.gs       Google Apps Script backend
vendor/               pdfmake 0.2.15 and subset fonts (Inter, Cormorant Garamond — SIL OFL)
tests/                end-to-end test + Apps Script emulator
```

Run locally:

```bash
npm run serve                       # http://localhost:8080 (device mode)
npm run serve:google-mock           # http://localhost:8090 runs the real Code.gs against an in-memory Google emulator (PIN 246810)
```

End-to-end tests (Playwright) cover these scenarios: multiple events on one date (including **+ more**), a 37-item, 3-section quotation across pages, quotation revisions, one client with several events, multi-date weddings, confirm / changes-requested / cancel / restore, payments, the final invoice, WhatsApp, settings persistence, and backup/restore:

```bash
npm install
npm test                                                     # device mode, needs `npm run serve`
MODE=google BASE=http://localhost:8090 npm test              # Google mode, needs `npm run serve:google-mock`
```
