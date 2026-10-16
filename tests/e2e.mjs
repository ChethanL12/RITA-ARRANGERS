// End-to-end test of the full business workflow in a real browser.
//   Local mode:  python3 -m http.server 8080            then  npm test
//   Google mode: node tests/server.cjs 8090              then  MODE=google BASE=http://localhost:8090 npm test
import { chromium } from 'playwright';
import { mkdirSync } from 'fs';
const S = process.env.OUT_DIR || new URL('./output', import.meta.url).pathname; mkdirSync(S + '/shots', { recursive: true }); const MODE = process.env.MODE || 'local'; const BASE = process.env.BASE || 'http://localhost:8080'; const OUT = S + '/shots/' + (MODE === 'google' ? 'g-' : '');
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 950 }, acceptDownloads: true });
const page = await ctx.newPage();
const errs = [];
page.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
page.on('pageerror', (e) => errs.push('pageerror: ' + e.message + '\n' + e.stack));
const step = async (name, fn) => { try { await fn(); console.log('ok  ', name); } catch (e) { console.log('FAIL', name, e.message.split('\n')[0]); console.log(errs.join('\n')); await page.screenshot({ path: OUT + 'fail-' + name.replace(/\W+/g, '_') + '.png' }); throw e; } };
const shot = (n) => page.screenshot({ path: OUT + n + '.png', fullPage: false });
const save = async (clickSel, name) => { const [d] = await Promise.all([page.waitForEvent('download'), page.click(clickSel)]); await d.saveAs(OUT + name); };

await page.goto(BASE + '/');
if (MODE === 'google') {
  await page.click('#pick-google'); await page.fill('#gurl', BASE + '/exec'); await page.click('#url-form button');
  await page.fill('#pin', '000000'); await page.click('#pin-form button'); await page.waitForSelector('#pin-err:not([hidden])');
  await page.fill('#pin', '246810'); await page.click('#pin-form button');
} else await page.click('#pick-local');
await page.waitForSelector('.cal-grid');

await step('calendar navigate & click date', async () => {
  await page.click('[data-nav="next"]'); await page.click('[data-nav="next"]');
  await page.click('.cal-cell[data-date="2026-12-20"]');
  await page.waitForSelector('#c-name');
  if (!page.url().includes('date=2026-12-20')) throw new Error('date not passed: ' + page.url());
});

// fills the client once, then one event per entry; "Add Another Date" creates each further event
async function fillEnquiry({ name, phone, events }) {
  await page.fill('#c-name', name); await page.fill('#c-phone', phone);
  for (const [i, ev] of events.entries()) {
    if (i > 0) await page.click('#add-date');
    if (ev.date) await page.fill('#e-date', ev.date);
    await page.fill('#e-title', ev.title);
    if (ev.session) await page.click(`#e-session button[data-v="${ev.session}"]`);
    if (ev.venue) await page.fill('#e-venue', ev.venue);
    if (ev.crowd) await page.fill('#e-crowd', String(ev.crowd));
    for (const sec of ev.sections || []) {
      await page.locator('[data-ta="add-sec"]').first().click();
      await page.keyboard.type(sec.title);
      await page.keyboard.press('Enter');
      for (const [d, r, a] of sec.items) {
        await page.keyboard.type(d); await page.keyboard.press('Enter');
        if (r) await page.keyboard.type(r);
        await page.keyboard.press('Enter');
        if (a) await page.keyboard.type(String(a));
        await page.keyboard.press('Enter');
      }
    }
  }
}

const venue = [
  ["Stage decor - includes main decor and decor for parent's photo frame", ''], ['Entrance decor - First entrance and second entrance', ''],
  ['Aisle decor from second entrance to the dance floor', '6 Ft wide'], ['Ceiling decor with on truss', 'White cloth work, warm lights, centre zoomer and chandeliers'],
  ['Venue side decor with warm lights and arcs', ''], ['Welcome board with couple pictures and name', ''], ['Tree hanging lights as applicable', ''],
  ['Box truss', '30 x 50 Ft'], ['Lights on truss', '16 moving heads, 20 par cans, 12 warm par cans, 8 strobes'],
  ['Sounds', 'British Acoustics - 8 line arrays, 6 subwoofers, 3 monitors, 2 cordless mics'], ['DJ platform and decor', '8 x 6 Ft'],
  ['Dance floor with flex print with couple name on it', '40 x 20 Ft'], ['Main stage', '40 x 20 Ft, 3 Ft height'], ['Platform for aisle', '6 x 80 Ft, 10 inches height'],
  ['White cushion sofa', '40'], ['Acrylic chairs with tie ups', '100'], ['Round table with centre piece', '20'], ['Generator with diesel', '120 Kva min'],
  ['Chairs with white cover and tie ups', '1000'], ['Ground mat covering venue', 'Camel yellow colour'], ['Illumination for venue as required', ''],
  ['Cake stand, Champagne stand', ''], ['Low fog machine', ''], ['Candles and box shape golden stand with flowers for the aisle', ''], ['Selfie point', 'Needs to be decided'],
];
await step('fill enquiry: 2 separate events (wedding + roce), 30+ items, amounts & ranges', async () => {
  await fillEnquiry({
    name: "Mr. Joseph D'Costa", phone: '98450 12345',
    events: [
      { title: 'Wedding Ceremony', session: 'day', venue: 'Rita Gardens, Honnavar', crowd: 800, sections: [
        { title: 'Venue Part', items: venue.map(([d, r], i) => [d, r, i % 4 === 0 ? 25000 : i % 4 === 1 ? '10000-15000' : '']) },
        { title: 'Food Serving Area Part', items: [['Buffet counters', '8', 40000], ['Tables', '20', 8000], ['Chairs', ''], ['Veg counters', "Will be decided after Divya's arrival"]] },
        { title: 'Church Part', items: [['Entrance Arc', '', 12000], ['Bench veils', '', '5k-8k']] },
      ] },
      { date: '2026-12-18', title: 'Roce Ceremony', session: 'night', venue: 'Home, Kasarkod', sections: [
        { title: 'Decoration', items: [['Stage Decoration', '', 25000], ['Entrance Decoration', '', 10000], ['Lighting', '', 5000]] },
      ] },
    ],
  });
  await page.waitForSelector('#b-prev strong');
  const roceBudget = await page.innerText('#b-prev strong');
  if (!roceBudget.includes('40,000')) throw new Error('roce budget ' + roceBudget);
  const secTotal = await page.innerText('.sec-total b');
  if (!secTotal.includes('40,000')) throw new Error('section total ' + secTotal);
  await shot('03-form');
  await page.click('#event-tabs [data-tab="0"]');
  const wedBudget = await page.innerText('#b-prev strong');
  if (!/–/.test(wedBudget)) throw new Error('wedding budget should be a range: ' + wedBudget);
  await page.screenshot({ path: OUT + '03-form-full.png', fullPage: true });
});

await step('save creates two separate events; quotation V1 for the wedding', async () => {
  await page.click('#save-quote');
  await page.waitForSelector('.client-hero');
  const n = await page.locator('.event-card').count(); if (n !== 2) throw new Error('event cards ' + n);
  await page.click('.event-card:has-text("Wedding Ceremony")'); await page.waitForSelector('.hero');
  await page.click('[data-tab="quotations"]'); await page.click('#q-gen');
  await page.waitForSelector('#gen-note');
  await shot('04-generate');
  await page.click('.modal-foot button:has-text("Issue & Save PDF")');
  await page.waitForSelector('.viewer iframe', { timeout: 20000 });
  await save('.modal-foot button:has-text("Download")', 'quotation-v1.pdf');
  await page.waitForTimeout(400); await shot('05-viewer');
  await page.keyboard.press('Escape');
});
const weddingUrl = page.url();

await step('detail page overview', async () => {
  await page.waitForTimeout(400); await shot('06-detail');
  await page.screenshot({ path: OUT + '06-detail-full.png', fullPage: true });
});

await step('add two more events on same date', async () => {
  await page.goto(BASE + '/#/events/new?date=2026-12-20');
  await page.waitForSelector('#c-name');
  await fillEnquiry({ name: 'Ms. Anita Naik', phone: '9900112233', events: [{ title: 'Wedding Reception', session: 'night', sections: [{ title: 'Stage', items: [['Stage decor', 'Floral', 250000]] }] }] });
  await page.click('#save-draft');
  await page.waitForSelector('.hero');
  await page.click('.booking-toggle [data-act="confirm"]'); await page.click('.modal-foot button:has-text("Confirm Booking")');
  await page.waitForSelector('.bt.on.green');
  await page.goto(BASE + '/#/events/new?date=2026-12-20');
  await page.waitForSelector('#c-name');
  await page.click('#e-session button[data-v="night"]');
  await page.waitForSelector('#overlap .callout');
  await shot('07-overlap');
  await page.click('#e-session button[data-v="night"]'); // toggle off; fillEnquiry sets it again
  await fillEnquiry({ name: 'Rahul Shetty', phone: '9988776655', events: [{ title: "Aarav's 1st Birthday", session: 'night' }] });
  await page.click('#save-draft');
  await page.waitForSelector('.hero');
});

await step('calendar shows 3 events on 20 Dec', async () => {
  await page.goto(BASE + '/#/');
  await page.waitForSelector('.cal-grid');
  await page.click('[data-nav="next"]'); await page.click('[data-nav="next"]');
  const n = await page.locator('.cal-cell[data-date="2026-12-20"] .cal-pill').count();
  if (n !== 3) throw new Error('pills: ' + n);
  await shot('08-calendar');
  await page.click('.cal-cell[data-date="2026-12-20"] .cal-pill >> nth=0');
  await page.waitForSelector('.hero');
});

await step('revise quotation (V2) from requirements tab', async () => {
  await page.goto(weddingUrl.split('?')[0]);
  await page.waitForSelector('.hero');
  await page.click('[data-tab="requirements"]'); await page.click('#req-edit');
  await page.waitForSelector('#req-ed .req-sec');
  await page.locator('#req-ed [data-sa="add"]').nth(2).click();
  await page.keyboard.type('Flower decoration on altar'); await page.keyboard.press('Enter'); await page.keyboard.type('Fresh white roses');
  await page.keyboard.press('Enter'); await page.keyboard.type('18000');
  await page.click('#req-save-quote');
  await page.waitForSelector('#gen-note');
  await page.click('.modal-foot button:has-text("Issue Revised PDF")');
  await page.waitForSelector('.viewer iframe', { timeout: 20000 });
  await save('.modal-foot button:has-text("Download")', 'quotation-v2.pdf');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  const rows = await page.locator('.doc-row').count();
  const latest = await page.locator('.doc-row.is-latest').count();
  if (rows !== 2 || latest !== 1) throw new Error(`docs ${rows} latest ${latest}`);
  await shot('09-quotations');
});

await step('confirm booking + confirmation letter', async () => {
  await page.click('[data-tab="overview"]');
  await page.click('.booking-toggle [data-act="confirm"]');
  await page.click('.modal-foot button:has-text("Confirm Booking")');
  await page.waitForSelector('.bt.on.green');
  await page.click('[data-tab="confirmation"]'); await page.click('#c-gen');
  await page.waitForSelector('#gen-note');
  await page.click('.modal-foot button:has-text("Issue & Save PDF")');
  await page.waitForSelector('.viewer iframe', { timeout: 20000 });
  await save('.modal-foot button:has-text("Download")', 'confirmation.pdf');
  await page.keyboard.press('Escape');
});

await step('record advance payments', async () => {
  await page.click('[data-tab="bill"]');
  for (const [amt, method, date] of [[200000, 'UPI', '2026-10-16'], [150000, 'Bank Transfer', '2026-11-20']]) {
    if (amt === 200000) { await page.click('[data-tab="overview"]'); await page.click('#ov-pay'); await page.waitForSelector('.modal:has-text("Record advance payment")'); }
    else { await page.click('[data-tab="bill"]'); await page.click('#pay-add'); }
    await page.fill('#p-amt', String(amt)); await page.fill('#p-date', date);
    await page.click(`#p-method button[data-v="${method}"]`);
    await page.click('.modal-foot button:has-text("Record payment")');
    await page.waitForTimeout(300);
  }
  const n = await page.locator('.pay-row').count(); if (n !== 2) throw new Error('payments ' + n);
});

await step('final invoice', async () => {
  await page.fill('#bl-agreed', '875000');
  await page.click('[data-add="charges"]');
  await page.locator('#bl-charges [data-rf="label"]').fill('Additional 200 chairs with covers');
  await page.locator('#bl-charges [data-rf="amount"]').fill('12000');
  await page.click('[data-add="discounts"]');
  await page.locator('#bl-discounts [data-rf="label"]').fill('Goodwill discount');
  await page.locator('#bl-discounts [data-rf="amount"]').fill('7000');
  await page.fill('#bl-due', '2026-12-28');
  await page.fill('#bl-remarks', 'Balance payable by bank transfer');
  await shot('10-bill');
  await page.click('#bl-issue');
  await page.waitForSelector('#gen-note');
  await page.click('.modal-foot button:has-text("Issue & Save PDF")');
  await page.waitForSelector('.viewer iframe', { timeout: 20000 });
  await save('.modal-foot button:has-text("Download")', 'invoice.pdf');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  await page.screenshot({ path: OUT + '11-bill-full.png', fullPage: true });
});

await step('whatsapp dialog', async () => {
  await page.click('.hero [data-act="wa"]');
  await page.waitForSelector('[data-pick]');
  await page.locator('[data-pick]').first().click();
  await page.waitForSelector('#wa-msg');
  await shot('12-whatsapp');
  await page.keyboard.press('Escape');
});

await step('activity & overview', async () => {
  await page.click('[data-tab="activity"]'); await page.waitForTimeout(200); await shot('13-activity');
  await page.click('[data-tab="overview"]'); await page.waitForTimeout(200); await page.screenshot({ path: OUT + '14-overview-full.png', fullPage: true });
});

await step('clients page & profile, persistence after reload', async () => {
  await page.goto(BASE + '/#/clients'); await page.reload();
  await page.waitForSelector('.client-card');
  const n = await page.locator('.client-card').count(); if (n !== 3) throw new Error('clients ' + n);
  await shot('15-clients');
  await page.fill('#q', '9845'); await page.waitForTimeout(300);
  if (await page.locator('.client-card').count() !== 1) throw new Error('phone search');
  await page.click('.client-card');
  await page.waitForSelector('.client-hero'); await shot('16-client');
});

await step('old PDF re-downloads after reload (rebuilt from saved details)', async () => {
  await page.goto(weddingUrl.split('?')[0]); await page.reload(); await page.waitForSelector('.hero');
  await page.click('[data-tab="quotations"]'); await page.waitForSelector('.doc-row');
  const [d] = await Promise.all([page.waitForEvent('download'), page.locator('.doc-row.is-old [data-doc-act="download"]').first().click()]);
  const p = OUT + 'redownload-v1.pdf'; await d.saveAs(p);
  const head = (await import('fs')).readFileSync(p).subarray(0, 5).toString();
  if (head !== '%PDF-') throw new Error('not a pdf: ' + head);
  await page.click('.crumbs a:nth-of-type(2)'); await page.waitForSelector('.client-hero');
});

await step('second event for existing client', async () => {
  await page.click('a:has-text("New event")');
  await page.waitForSelector('.linked');
  await page.fill('#e-title', 'Christening Ceremony');
  await page.fill('#e-date', '2027-03-14');
  await page.click('#save-draft');
  await page.waitForSelector('.hero');
  const c = await page.evaluate(() => 1);
});

await step('settings page + logo upload persists', async () => {
  await page.goto(BASE + '/#/settings'); await page.waitForSelector('#st-company'); await shot('17-settings');
  await page.setInputFiles('#logo-file', new URL('../assets/logo.png', import.meta.url).pathname);
  await page.fill('[data-k="proprietor"]', 'Everest Fernandes');
  await page.fill('[data-k="paymentDetails"]', 'UPI: ritaarrangers@upi');
  await page.waitForTimeout(300);
  await page.click('#save'); await page.waitForTimeout(800);
  await page.reload(); await page.waitForSelector('#st-company');
  const src = await page.getAttribute('#logo-prev', 'src');
  if (!src.startsWith('data:image')) throw new Error('logo not persisted');
  if (await page.inputValue('[data-k="paymentDetails"]') !== 'UPI: ritaarrangers@upi') throw new Error('setting not persisted');
});


await step('4 events on one date shows "+ more"', async () => {
  await page.goto(BASE + '/#/events/new?date=2026-12-20'); await page.waitForSelector('#c-name');
  await fillEnquiry({ name: 'Canara Bank Ltd', phone: '08385 222333', events: [{ title: 'Corporate Annual Day', session: 'day' }] });
  await page.click('#save-draft'); await page.waitForSelector('.hero');
  await page.goto(BASE + '/#/calendar?'); await page.waitForSelector('.cal-grid');
  await page.click('[data-nav="next"]'); await page.click('[data-nav="next"]');
  await page.click('.cal-cell[data-date="2026-12-20"] .cal-more');
  await page.waitForSelector('.modal .day-item');
  const n = await page.locator('.modal .day-item').count(); if (n !== 4) throw new Error('day items ' + n);
  if (!(await page.locator('.modal .callout-warn').count())) throw new Error('no overlap warning');
  await shot('18-day'); await page.keyboard.press('Escape');
});

await step('changes requested, cancel with reason, restore, delete guard', async () => {
  await page.goto(BASE + '/#/clients?tab=events'); await page.waitForSelector('.erow');
  await page.click('.erow:has-text("Birthday")'); await page.waitForSelector('.hero');
  await page.click('[data-tab="quotations"]'); await page.click('#q-gen'); await page.click('.modal-foot button:has-text("Issue & Save PDF")');
  await page.waitForSelector('.viewer'); await page.keyboard.press('Escape'); await page.waitForTimeout(200);
  await page.click('[data-tab="overview"]'); await page.click('.more-actions [data-act="changes"]');
  await page.waitForSelector('.hero .badge:has-text("Changes Requested")');
  await page.click('.more-actions [data-act="cancel"]');
  await page.fill('#confirm-input', 'Client postponed'); await page.click('.modal-foot button:has-text("Cancel booking")');
  await page.waitForSelector('.hero-banner.red:has-text("Client postponed")');
  await page.click('.hero-banner [data-act="restore"]');
  await page.waitForSelector('.hero .badge:has-text("Quotation Sent")');
  await page.click('[data-tab="overview"]'); await page.click('.more-actions [data-act="delete"]');
  await page.waitForSelector('.modal:has-text("issued documents")'); await page.keyboard.press('Escape');
  await page.click('[data-tab="activity"]'); await page.waitForSelector('.timeline');
  const t = await page.locator('.timeline').innerText();
  for (const w of ['Client requested changes', 'Booking cancelled — Client postponed', 'Booking restored']) if (!t.includes(w)) throw new Error('missing activity: ' + w);
});

await step('reports: month / year / custom, day-night filter, money', async () => {
  await page.goto(BASE + '/#/reports'); await page.waitForSelector('#kpis .kpi');
  await page.click('#f-period button[data-v="month"]'); await page.fill('#f-month', '2026-12'); await page.dispatchEvent('#f-month', 'change');
  await page.waitForTimeout(200);
  const evs = await page.innerText('#kpis .kpi >> nth=0');
  if (!/Day\s*2/.test(evs) || !/Night\s*3/.test(evs)) throw new Error('day/night split: ' + evs);
  await page.click('#f-session button[data-v="night"]'); await page.waitForTimeout(150);
  const rows = await page.locator('.rtbl tbody tr').count(); if (rows !== 3) throw new Error('night rows ' + rows);
  await page.click('#f-session button[data-v="all"]');
  await page.click('#f-period button[data-v="custom"]'); await page.fill('#f-from', '2026-12-18'); await page.dispatchEvent('#f-from', 'change'); await page.fill('#f-to', '2026-12-19'); await page.dispatchEvent('#f-to', 'change');
  await page.waitForTimeout(150);
  const r2 = await page.locator('.rtbl tbody tr').count(); if (r2 !== 1) throw new Error('custom range rows ' + r2);
  await page.click('#f-period button[data-v="year"]'); await page.waitForTimeout(200);
  const rec = await page.innerText('.overall'); if (!rec.includes('2,00,000')) throw new Error('received to date: ' + rec);
  await page.hover('#chart .hit >> nth=11'); await page.waitForSelector('#chart .tip:not([hidden])');
  await shot('19-reports'); await page.screenshot({ path: OUT + '19-reports-full.png', fullPage: true });
  const [d] = await Promise.all([page.waitForEvent('download'), page.click('#csv')]); await d.saveAs(S + '/report.csv');
});

if (MODE === 'local') await step('backup download', async () => {
  await page.setViewportSize({ width: 1440, height: 950 });
  await page.goto(BASE + '/#/settings'); await page.waitForSelector('#backup');
  const [d] = await Promise.all([page.waitForEvent('download'), page.click('#backup')]);
  await d.saveAs(S + '/backup.json');
});
if (MODE === 'google' && process.env.RESTORE) await step('restore local backup into Google', async () => {
  await page.setViewportSize({ width: 1440, height: 950 });
  await page.goto(BASE + '/#/settings'); await page.waitForSelector('#restore');
  await page.setInputFiles('#restore', process.env.RESTORE);
  await page.click('.modal-foot button:has-text("Restore")');
  await page.waitForSelector('.toast:has-text("Backup restored")', { timeout: 60000 });
  await page.goto(BASE + '/#/clients'); await page.reload(); await page.waitForSelector('.client-card');
});

for (const [w, h, tag] of [[390, 844, 'm']]) {
  await page.setViewportSize({ width: w, height: h });
  await page.goto(BASE + '/#/'); await page.waitForTimeout(500); await page.screenshot({ path: OUT + `m1-dash.png`, fullPage: true });
  await page.goto(weddingUrl.split('?')[0]); await page.waitForTimeout(500); await page.screenshot({ path: OUT + `m2-detail.png`, fullPage: true });
  await page.goto(BASE + '/#/events/new'); await page.waitForTimeout(500);
  await page.click('[data-ta="add-sec"]'); await page.keyboard.type('Venue'); await page.keyboard.press('Enter'); await page.keyboard.type('Stage decor'); await page.keyboard.press('Enter'); await page.keyboard.type('Main stage');
  await page.screenshot({ path: OUT + `m3-form.png`, fullPage: true });
}
console.log('\nERRORS:\n' + errs.join('\n'));
if (errs.length) process.exitCode = 1;
await browser.close();
