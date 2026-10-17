// App bootstrap: storage selection, sign-in, shell, and hash router.

import { icon } from './icons.js';
import { LocalAdapter, GoogleAdapter } from './adapters.js';
import { store, loadAll, subscribe, metrics } from './store.js';
import { h, $, $$, toast, toastError, busy, modal } from './ui.js';
import { esc } from './util.js';

import * as Dashboard from './views/dashboard.js';
import * as CalendarPage from './views/calendarPage.js';
import * as EventForm from './views/eventForm.js';
import * as EventDetail from './views/eventDetail.js';
import * as Clients from './views/clients.js';
import * as ClientDetail from './views/clientDetail.js';
import * as Settings from './views/settings.js';
import * as Reports from './views/reports.js';

const app = $('#app');

/* ======================= routing ======================= */

const ROUTES = [
  [/^\/?$/, Dashboard, 'dashboard'],
  [/^\/calendar$/, CalendarPage, 'calendar'],
  [/^\/events\/new$/, EventForm, 'new'],
  [/^\/events\/([\w-]+)\/edit$/, EventForm, 'clients'],
  [/^\/events\/([\w-]+)$/, EventDetail, 'clients'],
  [/^\/clients$/, Clients, 'clients'],
  [/^\/clients\/([\w-]+)$/, ClientDetail, 'clients'],
  [/^\/reports$/, Reports, 'reports'],
  [/^\/settings$/, Settings, 'settings'],
];

let current = null;   // { mod, cleanup }
let lastHash = '';
let ignoreNext = false;

export function navigate(hash) { location.hash = hash; }
window.raNavigate = navigate;

function parseHash() {
  const raw = location.hash.replace(/^#/, '') || '/';
  const [path, qs] = raw.split('?');
  return { path, query: new URLSearchParams(qs || '') };
}

async function route() {
  if (ignoreNext) { ignoreNext = false; return; }
  if (current?.mod?.canLeave && !(await current.mod.canLeave())) {
    ignoreNext = true; location.hash = lastHash; return;
  }
  const { path, query } = parseHash();
  let match = null;
  for (const [re, mod, nav] of ROUTES) { const m = path.match(re); if (m) { match = { mod, nav, params: m.slice(1) }; break; } }
  if (!match) { navigate('#/'); return; }
  try { current?.cleanup?.(); } catch (e) { console.error(e); }
  const view = $('#view');
  // a fresh host per route, so listeners a view attaches to its root die with it
  const host = document.createElement('div');
  view.replaceChildren(host);
  view.classList.remove('view-in'); void view.offsetWidth; view.classList.add('view-in');
  $$('.nav-link').forEach((a) => a.classList.toggle('active', a.dataset.nav === match.nav));
  document.body.classList.remove('nav-open');
  window.scrollTo(0, 0);
  lastHash = location.hash || '#/';
  try {
    const cleanup = await match.mod.render(host, { params: match.params, query, navigate });
    current = { mod: match.mod, cleanup };
  } catch (e) {
    toastError(e);
    host.innerHTML = `<div class="page"><div class="empty"><h3>Something went wrong</h3><p>${esc(e.message)}</p></div></div>`;
  }
}

/* ======================= shell ======================= */

function shell() {
  const navItems = [
    ['#/', 'dashboard', 'layout-dashboard', 'Dashboard'],
    ['#/calendar', 'calendar', 'calendar-days', 'Calendar'],
    ['#/clients', 'clients', 'users', 'Clients & Events'],
    ['#/reports', 'reports', 'chart-column', 'Reports & Analytics'],
    ['#/settings', 'settings', 'settings', 'Settings'],
  ];
  const isGoogle = store.adapter.kind === 'google';
  app.innerHTML = `
  <div class="shell">
    <aside class="sidebar">
      <a class="brand" href="#/"><img src="assets/logo.png" alt="Rita Arrangers — Event Planner"></a>
      <a class="btn btn-primary btn-block new-btn" href="#/events/new">${icon('plus')}<span>New Enquiry</span></a>
      <nav class="nav">
        ${navItems.map(([href, key, ic, label]) => `<a class="nav-link" data-nav="${key}" href="${href}">${icon(ic)}<span>${label}</span>${key === 'dashboard' ? '<i class="nav-count" id="nav-pending"></i>' : ''}</a>`).join('')}
      </nav>
      <div class="side-foot">
        <div class="storage-pill ${isGoogle ? 'ok' : 'local'}">${icon(isGoogle ? 'cloud' : 'hard-drive')}
          <div><b>${isGoogle ? 'Google Sheets' : 'This device only'}</b><small>${isGoogle ? 'Synced &amp; backed up' : 'Data stays in this browser'}</small></div></div>
        <button class="nav-link nav-btn" id="lock-btn">${icon(isGoogle ? 'log-out' : 'lock')}<span>${isGoogle ? 'Sign out' : 'Lock'}</span></button>
      </div>
    </aside>
    <header class="topbar">
      <button class="icon-btn" id="menu-btn" aria-label="Menu">${icon('menu')}</button>
      <a class="brand-sm" href="#/"><img src="assets/logo.png" alt="Rita Arrangers"></a>
      <a class="icon-btn gold" href="#/events/new" aria-label="New enquiry">${icon('plus')}</a>
    </header>
    <div class="scrim" id="scrim"></div>
    <main id="view" class="view"></main>
    <nav class="tabbar">
      <a class="nav-link" data-nav="dashboard" href="#/">${icon('layout-dashboard')}<span>Home</span></a>
      <a class="nav-link" data-nav="calendar" href="#/calendar">${icon('calendar-days')}<span>Calendar</span></a>
      <a class="nav-link tab-new" data-nav="new" href="#/events/new">${icon('plus')}<span>New</span></a>
      <a class="nav-link" data-nav="clients" href="#/clients">${icon('users')}<span>Clients</span></a>
      <a class="nav-link" data-nav="reports" href="#/reports">${icon('chart-column')}<span>Reports</span></a>
    </nav>
  </div>`;
  $('#menu-btn').onclick = () => document.body.classList.toggle('nav-open');
  $('#scrim').onclick = () => document.body.classList.remove('nav-open');
  $('#lock-btn').onclick = async () => {
    if (store.adapter.kind === 'google') { await store.adapter.logout(); location.reload(); }
    else if (localStorage.getItem('ra.localPin')) { sessionStorage.removeItem('ra.unlocked'); location.reload(); }
    else toast('Set an app PIN in Settings → Storage & Security to lock this device.', { type: 'info' });
  };
  const updateCount = () => { const n = metrics().pending.length; const el = $('#nav-pending'); if (el) { el.textContent = n || ''; el.hidden = !n; } };
  subscribe(updateCount); updateCount();
}

/* ======================= sign-in & setup ======================= */

async function sha256(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
export async function setLocalPin(pin) {
  if (!pin) { localStorage.removeItem('ra.localPin'); return; }
  const salt = crypto.getRandomValues(new Uint32Array(2)).join('');
  localStorage.setItem('ra.localPin', JSON.stringify({ salt, hash: await sha256(salt + pin) }));
  sessionStorage.setItem('ra.unlocked', '1');
}

function gate(inner) {
  app.innerHTML = `<div class="gate"><div class="gate-card">
    <img class="gate-logo" src="assets/logo.png" alt="Rita Arrangers — Event Planner">
    ${inner}
  </div><p class="gate-foot">Private event management workspace</p></div>`;
}

function pinScreen({ title, subtitle, onSubmit, extra = '' }) {
  return new Promise((resolve) => {
    gate(`<h1>${title}</h1><p class="gate-sub">${subtitle}</p>
      <form class="pin-form" id="pin-form" autocomplete="off">
        <input class="input pin-input" id="pin" type="password" inputmode="numeric" placeholder="Enter PIN" autocomplete="current-password" required>
        <button class="btn btn-primary btn-block" type="submit">${icon('key-round')}<span>Unlock</span></button>
        <p class="form-error" id="pin-err" hidden></p>
      </form>${extra}`);
    const form = $('#pin-form'); const pin = $('#pin'); pin.focus();
    form.onsubmit = async (e) => {
      e.preventDefault();
      const btn = form.querySelector('button');
      await busy(btn, async () => {
        try { await onSubmit(pin.value); resolve(); } catch (err) {
          const el = $('#pin-err'); el.hidden = false; el.textContent = err.message; pin.select();
        }
      });
    };
  });
}

async function start() {
  try {
    // On Vercel (config.js: server: true) the app always uses the Google Sheet through the
    // site's own server functions, and asks for the PIN (Vercel env APP_PIN) on every opening.
    // Without a server (local development) it keeps data in this browser.
    const server = window.RA_CONFIG?.server !== false;
    let adapter;
    if (server) {
      adapter = new GoogleAdapter('/api');
      if (!adapter.token) {
        await pinScreen({
          title: 'Welcome back', subtitle: 'Enter your PIN to open Rita Arrangers.',
          onSubmit: (pin) => adapter.login(pin),
        });
      }
    } else {
      adapter = new LocalAdapter();
      const lock = localStorage.getItem('ra.localPin');
      if (lock && !sessionStorage.getItem('ra.unlocked')) {
        const { salt, hash } = JSON.parse(lock);
        await pinScreen({
          title: 'Unlock', subtitle: 'Enter your app PIN.',
          onSubmit: async (pin) => { if (await sha256(salt + pin) !== hash) throw new Error('Incorrect PIN.'); sessionStorage.setItem('ra.unlocked', '1'); },
        });
      }
    }
    app.innerHTML = '<div class="boot"><img src="assets/logo.png" alt="Rita Arrangers" width="220"><div class="boot-bar"><i></i></div><p>Loading your events…</p></div>';
    await adapter.init();
    try { await loadAll(adapter); } catch (e) {
      if (e.code === 'AUTH') { sessionStorage.removeItem('ra.session'); return start(); }
      throw e;
    }
    shell();
    window.addEventListener('hashchange', route);
    window.addEventListener('beforeunload', (e) => { if (current?.mod?.isDirty?.()) { e.preventDefault(); e.returnValue = ''; } });
    window.__onAuth = () => { sessionStorage.removeItem('ra.session'); toast('Please enter your PIN again.', { type: 'warn' }); setTimeout(() => location.reload(), 1200); };
    await route();
  } catch (e) {
    console.error(e);
    gate(`<h1>Could not open the workspace</h1><p class="gate-sub">${esc(e.message)}</p>
      <button class="btn btn-primary btn-block" id="retry">${icon('refresh-cw')}<span>Try again</span></button>
      `);
    $('#retry').onclick = () => location.reload();
  }
}

start();
