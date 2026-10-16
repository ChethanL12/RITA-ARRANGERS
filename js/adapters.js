// Storage adapters. Both expose the same interface:
//   bootstrap() -> { settings, counters, clients, events, documents, payments, activity }
//   commit(ops)            ops: [{ op: 'put', table, record } | { op: 'del', table, id }]
//   saveSettings(partial)
//   nextNumber(series)     atomic, never returns the same number twice for a series
//   setCounter(series, n)  set the last-used number of a series
//   saveFile(doc, blob)    -> { fileId, fileUrl }
//   getFile(doc)           -> Blob
//   getRecord(table, id)   -> full record (documents include their snapshot)

import { SCHEMA, TABLES, encodeRecord, decodeRecord } from './models.js';
import { blobToBase64, base64ToBlob } from './util.js';

/* ======================= This device (IndexedDB) ======================= */

export class LocalAdapter {
  constructor() { this.kind = 'local'; this.db = null; }

  async init() {
    this.db = await new Promise((res, rej) => {
      const req = indexedDB.open('rita-arrangers', 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        for (const t of TABLES) if (!db.objectStoreNames.contains(t)) db.createObjectStore(t, { keyPath: 'id' });
        if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
        if (!db.objectStoreNames.contains('files')) db.createObjectStore('files');
      };
      req.onsuccess = () => res(req.result);
      req.onerror = () => rej(req.error);
    });
    if (navigator.storage?.persist) navigator.storage.persist().catch(() => {});
  }

  _tx(stores, mode, fn) {
    return new Promise((res, rej) => {
      const tx = this.db.transaction(stores, mode);
      let out;
      tx.oncomplete = () => res(out);
      tx.onerror = () => rej(tx.error);
      tx.onabort = () => rej(tx.error || new Error('Transaction aborted'));
      out = fn(tx);
    });
  }
  _all(store) {
    return new Promise((res, rej) => {
      const r = this.db.transaction(store).objectStore(store).getAll();
      r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
    });
  }
  _get(store, key) {
    return new Promise((res, rej) => {
      const r = this.db.transaction(store).objectStore(store).get(key);
      r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
    });
  }

  async bootstrap() {
    const out = {};
    for (const t of TABLES) out[t] = await this._all(t);
    out.settings = (await this._get('kv', 'settings')) || {};
    out.counters = (await this._get('kv', 'counters')) || {};
    return out;
  }

  async commit(ops) {
    await this._tx([...TABLES], 'readwrite', (tx) => {
      for (const o of ops) {
        const st = tx.objectStore(o.table);
        if (o.op === 'put') st.put(JSON.parse(JSON.stringify(o.record)));
        else if (o.op === 'del') st.delete(o.id);
      }
    });
    return { ok: true };
  }

  async getRecord(table, id) { return this._get(table, id); }

  async saveSettings(partial) {
    const cur = (await this._get('kv', 'settings')) || {};
    const next = { ...cur, ...partial };
    await this._tx(['kv'], 'readwrite', (tx) => tx.objectStore('kv').put(next, 'settings'));
    return next;
  }

  async nextNumber(series, usedNumbers = []) {
    let n;
    await this._tx(['kv'], 'readwrite', (tx) => {
      const st = tx.objectStore('kv');
      const r = st.get('counters');
      r.onsuccess = () => {
        const c = r.result || {};
        n = (Number(c[series]) || 0) + 1;
        c[series] = n;
        st.put(c, 'counters');
      };
    });
    return n;
  }

  async setCounter(series, value) {
    await this._tx(['kv'], 'readwrite', (tx) => {
      const st = tx.objectStore('kv');
      const r = st.get('counters');
      r.onsuccess = () => { const c = r.result || {}; c[series] = Number(value) || 0; st.put(c, 'counters'); };
    });
  }

  async saveFile(doc, blob) {
    await this._tx(['files'], 'readwrite', (tx) => tx.objectStore('files').put(blob, doc.id));
    return { fileId: doc.id, fileUrl: '' };
  }
  async getFile(doc) { return this._get('files', doc.id); }
  async makePublic() { throw new Error('Shareable links need Google Drive storage (Settings → Storage).'); }

  async wipe() {
    await this._tx([...TABLES, 'kv', 'files'], 'readwrite', (tx) => {
      for (const t of [...TABLES, 'kv', 'files']) tx.objectStore(t).clear();
    });
  }
}

/* ======================= Google Sheets + Drive (Apps Script) ======================= */

export class AuthError extends Error { constructor(m) { super(m); this.code = 'AUTH'; } }

export class GoogleAdapter {
  constructor(url) {
    this.kind = 'google';
    this.url = url;
    this.token = localStorage.getItem('ra.token') || '';
  }

  async call(action, payload = {}, { auth = true } = {}) {
    let res;
    try {
      res = await fetch(this.url, {
        method: 'POST',
        // text/plain keeps this a "simple" request, which Apps Script web apps accept cross-origin
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ action, token: auth ? this.token : undefined, payload }),
        redirect: 'follow',
      });
    } catch (e) {
      throw new Error('Could not reach Google. Check your internet connection and try again.');
    }
    let data;
    try { data = await res.json(); } catch { throw new Error('Unexpected reply from the Google Apps Script. Check the Web App URL and deployment access.'); }
    if (!data.ok) {
      if (data.code === 'AUTH') throw new AuthError(data.error || 'Please sign in again.');
      throw new Error(data.error || 'Request failed');
    }
    return data.result;
  }

  async init() {}
  ping() { return this.call('ping', {}, { auth: false }); }

  async login(pin) {
    const r = await this.call('login', { pin, device: navigator.userAgent.slice(0, 80) }, { auth: false });
    this.token = r.token;
    localStorage.setItem('ra.token', r.token);
    return r;
  }
  async logout() {
    try { await this.call('logout'); } catch { /* ignore */ }
    this.token = ''; localStorage.removeItem('ra.token');
  }
  changePin(oldPin, newPin) { return this.call('changePin', { oldPin, newPin }); }

  async bootstrap() {
    const r = await this.call('bootstrap');
    const out = { settings: r.settings || {}, counters: r.counters || {} };
    for (const t of TABLES) out[t] = (r.tables[SCHEMA[t].sheet] || []).map((row) => decodeRecord(t, row));
    return out;
  }

  commit(ops) {
    return this.call('commit', {
      ops: ops.map((o) => (o.op === 'put'
        ? { op: 'put', sheet: SCHEMA[o.table].sheet, record: encodeRecord(o.table, o.record) }
        : { op: 'del', sheet: SCHEMA[o.table].sheet, id: o.id })),
    });
  }

  async getRecord(table, id) {
    const row = await this.call('get', { sheet: SCHEMA[table].sheet, id });
    return row ? decodeRecord(table, row) : null;
  }

  saveSettings(partial) { return this.call('saveSettings', { settings: partial }); }
  nextNumber(series, usedNumbers = []) { return this.call('nextNumber', { series }); }
  setCounter(series, value) { return this.call('setCounter', { series, value }); }

  async saveFile(doc, blob) {
    const data = await blobToBase64(blob);
    return this.call('saveFile', { fileName: doc.fileName, clientFolder: doc._clientFolder, data, mime: 'application/pdf' });
  }
  async getFile(doc) {
    if (!doc.fileId) return null;
    const r = await this.call('getFile', { fileId: doc.fileId });
    return base64ToBlob(r.data, r.mime || 'application/pdf');
  }
  async makePublic(doc) {
    const r = await this.call('shareFile', { fileId: doc.fileId });
    return r.url;
  }
}
