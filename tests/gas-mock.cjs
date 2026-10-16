// Minimal in-memory emulation of the Apps Script services used by backend/Code.gs.
// Lets the real backend run under Node for automated tests (tests/server.js).
const crypto = require('crypto');

function makeSheet(name) {
  const sh = {
    name, rows: [], maxRows: 1000, maxCols: 26,
    getLastRow() { let n = sh.rows.length; while (n > 0 && sh.rows[n - 1].every((v) => v === '' || v == null)) n--; return n; },
    getLastColumn() { return sh.rows.reduce((m, r) => { let n = r.length; while (n > 0 && (r[n - 1] === '' || r[n - 1] == null)) n--; return Math.max(m, n); }, 0); },
    getMaxRows() { return sh.maxRows; }, getMaxColumns() { return sh.maxCols; },
    insertRowsAfter(_, n) { sh.maxRows += n; }, insertColumnsAfter(_, n) { sh.maxCols += n; },
    setFrozenRows() {},
    deleteRow(r) { sh.rows.splice(r - 1, 1); },
    getRange(r, c, nr = 1, nc = 1) {
      if (r + nr - 1 > sh.maxRows || c + nc - 1 > sh.maxCols) throw new Error(`Range out of bounds ${r},${c},${nr},${nc} on ${name}`);
      const range = {
        getValues() { const out = []; for (let i = 0; i < nr; i++) { const row = sh.rows[r - 1 + i] || []; const o = []; for (let j = 0; j < nc; j++) o.push(row[c - 1 + j] ?? ''); out.push(o); } return out; },
        setValues(v) { for (let i = 0; i < nr; i++) { while (sh.rows.length < r + i) sh.rows.push([]); const row = sh.rows[r - 1 + i]; for (let j = 0; j < nc; j++) { if (typeof v[i][j] === 'string' && v[i][j].length > 50000) throw new Error('Cell over 50000 chars'); row[c - 1 + j] = v[i][j]; } } return range; },
        setValue(v) { return range.setValues([[v]]); },
        setFontWeight() { return range; }, setBackground() { return range; }, setNumberFormat() { return range; },
      };
      return range;
    },
  };
  return sh;
}

function install(global) {
  const sheets = {};
  const props = {};
  const cache = {};
  const files = {}; const folders = {};
  let idn = 0; const nid = (p) => p + (++idn) + crypto.randomBytes(4).toString('hex');
  function folder(name, parent) {
    const f = { id: nid('fo'), name, parent, getId: () => f.id, isTrashed: () => false,
      getFoldersByName: (n) => iter(Object.values(folders).filter((x) => x.parent === f && x.name === n)),
      createFolder: (n) => folder(n, f),
      getParents: () => iter(f.parent ? [f.parent] : []),
      createFile: (blob) => { const file = { id: nid('fi'), blob, parent: f, sharing: 'private', getId: () => file.id, getUrl: () => 'https://drive.example/' + file.id, getBlob: () => blob, getParents: () => iter([f]), setSharing: (a) => { file.sharing = a; } }; files[file.id] = file; return file; } };
    folders[f.id] = f; return f;
  }
  const iter = (arr) => { let i = 0; return { hasNext: () => i < arr.length, next: () => arr[i++] }; };
  const ss = { getSheetByName: (n) => sheets[n] || null, insertSheet: (n) => (sheets[n] = makeSheet(n)) };
  Object.assign(global, {
    SpreadsheetApp: { getActiveSpreadsheet: () => ss, getUi: () => { throw new Error('no ui in tests'); } },
    PropertiesService: { getScriptProperties: () => ({
      getProperty: (k) => (k in props ? props[k] : null), setProperty: (k, v) => { props[k] = String(v); }, deleteProperty: (k) => { delete props[k]; }, getProperties: () => ({ ...props }) }) },
    CacheService: { getScriptCache: () => ({ get: (k) => cache[k] ?? null, put: (k, v) => { cache[k] = v; }, remove: (k) => { delete cache[k]; } }) },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    Utilities: {
      DigestAlgorithm: { SHA_256: 'sha256' }, Charset: { UTF_8: 'utf8' },
      computeDigest: (alg, s) => [...crypto.createHash('sha256').update(s, 'utf8').digest()].map((b) => (b > 127 ? b - 256 : b)),
      getUuid: () => crypto.randomUUID(),
      base64Decode: (s) => [...Buffer.from(s, 'base64')],
      base64Encode: (bytes) => Buffer.from(bytes.map((b) => (b < 0 ? b + 256 : b))).toString('base64'),
      newBlob: (bytes, type, name) => ({ getBytes: () => bytes, getContentType: () => type, getName: () => name }),
    },
    DriveApp: {
      Access: { ANYONE_WITH_LINK: 'anyone' }, Permission: { VIEW: 'view' },
      createFolder: (n) => folder(n, null),
      getFolderById: (id) => { if (!folders[id]) throw new Error('no folder'); return folders[id]; },
      getFileById: (id) => { if (!files[id]) throw new Error('no file'); return files[id]; },
    },
    ContentService: { MimeType: { JSON: 'json' }, createTextOutput: (t) => ({ text: t, setMimeType() { return this; } }) },
  });
  return { sheets, props, files };
}
module.exports = { install };
