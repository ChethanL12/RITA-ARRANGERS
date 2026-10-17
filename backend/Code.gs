/**
 * Rita Arrangers — Event Manager backend (Google Apps Script, bound to a Google Sheet).
 *
 * Storage: one tab per table (Clients, Events, Documents, Payments, Activity, Settings, Counters).
 * PDFs:    not stored here — each issued document's details are kept in the Documents tab and
 *          the app rebuilds the identical PDF on the device whenever it is viewed or downloaded.
 * Access:  only the Rita Arrangers website on Vercel may call this script. It sends a private
 *          server key with every request; the PIN itself lives in Vercel (APP_PIN), not here.
 *
 * ►►  Paste the SAME long random text you saved in Vercel as API_SECRET between the quotes below.
 */
var API_SECRET = '';

var TABLES = ['Clients', 'Events', 'Documents', 'Payments', 'Activity', 'Settings', 'Counters'];
var CHUNK = 45000;                 // Sheets cells hold 50,000 characters; longer values spill into field__2, field__3…

/* ============================ web entry points ============================ */

function doGet() {
  return json_({ ok: true, result: { app: 'rita-arrangers', message: 'Rita Arrangers backend is running.' } });
}

function doPost(e) {
  var req;
  try { req = JSON.parse(e.postData.contents); } catch (err) { return json_({ ok: false, error: 'Bad request' }); }
  try {
    if (String(API_SECRET).length < 16) return json_({ ok: false, code: 'SETUP', error: 'API_SECRET is not set in Code.gs (use at least 16 characters).' });
    if (!safeEqual_(String(req.secret || ''), String(API_SECRET))) return json_({ ok: false, code: 'AUTH', error: 'Wrong server key.' });
    var action = req.action, p = req.payload || {};
    var r;
    switch (action) {
      case 'ping': r = { app: 'rita-arrangers' }; break;
      case 'bootstrap': r = bootstrap_(); break;
      case 'get': r = getRecord_(p.sheet, p.id); break;
      case 'commit': r = withLock_(function () { return commit_(p.ops || []); }); break;
      case 'saveSettings': r = withLock_(function () { return saveSettings_(p.settings || {}); }); break;
      case 'nextNumber': r = withLock_(function () { return nextNumber_(p.series); }); break;
      case 'setCounter': r = withLock_(function () { return setCounter_(p.series, p.value); }); break;
      default: throw new Error('Unknown action: ' + action);
    }
    return json_({ ok: true, result: r });
  } catch (err) {
    return json_({ ok: false, error: String(err && err.message || err) });
  }
}

function json_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}

function withLock_(fn) {
  var lock = LockService.getScriptLock();
  lock.waitLock(25000);
  try { return fn(); } finally { lock.releaseLock(); }
}

/** constant-time comparison, so the key cannot be guessed character by character */
function safeEqual_(a, b) {
  if (a.length !== b.length) return false;
  var diff = 0;
  for (var i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/* ============================ sheet storage ============================ */

function ss_() { return SpreadsheetApp.getActiveSpreadsheet(); }

function ensureSheets_() {
  var ss = ss_();
  TABLES.forEach(function (name) {
    var sh = ss.getSheetByName(name);
    if (!sh) {
      sh = ss.insertSheet(name);
      sh.getRange(1, 1).setValue('id');
      sh.setFrozenRows(1);
      sh.getRange(1, 1, 1, 1).setFontWeight('bold').setBackground('#F3E8CC');
    }
  });
}

function sheet_(name) {
  if (TABLES.indexOf(name) < 0) throw new Error('Unknown table: ' + name);
  var sh = ss_().getSheetByName(name);
  if (!sh) { ensureSheets_(); sh = ss_().getSheetByName(name); }
  return sh;
}

function header_(sh) {
  var lastCol = Math.max(1, sh.getLastColumn());
  return sh.getRange(1, 1, 1, lastCol).getValues()[0].map(String);
}

function ensureCols_(sh, header, keys) {
  var added = [];
  keys.forEach(function (k) { if (header.indexOf(k) < 0 && added.indexOf(k) < 0) added.push(k); });
  if (!added.length) return header;
  var start = header.length + 1;
  if (sh.getMaxColumns() < header.length + added.length) sh.insertColumnsAfter(sh.getMaxColumns(), header.length + added.length - sh.getMaxColumns());
  sh.getRange(1, start, 1, added.length).setValues([added]).setFontWeight('bold').setBackground('#F3E8CC');
  return header.concat(added);
}

/** Split long strings across spill columns: field, field__2, field__3 … */
function explode_(rec) {
  var out = {};
  Object.keys(rec).forEach(function (k) {
    var v = rec[k] == null ? '' : String(rec[k]);
    if (v.length <= CHUNK) { out[k] = v; return; }
    for (var i = 0, n = 1; i < v.length; i += CHUNK, n++) out[n === 1 ? k : k + '__' + n] = v.slice(i, i + CHUNK);
  });
  return out;
}

function rowToRecord_(header, row, skip) {
  var rec = {}, spill = {};
  header.forEach(function (h, i) {
    if (!h) return;
    var m = h.match(/^(.*)__(\d+)$/);
    var base = m ? m[1] : h;
    if (skip && skip.indexOf(base) >= 0) return;
    var v = row[i] == null ? '' : String(row[i]);
    if (m) { if (v) (spill[base] = spill[base] || [])[Number(m[2])] = v; }
    else rec[h] = v;
  });
  Object.keys(spill).forEach(function (b) { rec[b] = (rec[b] || '') + spill[b].filter(function (x) { return x != null; }).join(''); });
  return rec;
}

function readAll_(name, skip) {
  var sh = sheet_(name);
  var last = sh.getLastRow();
  if (last < 2) return [];
  var header = header_(sh);
  return sh.getRange(2, 1, last - 1, header.length).getValues()
    .filter(function (r) { return r[0] !== '' && r[0] != null; })
    .map(function (r) { return rowToRecord_(header, r, skip); });
}

function getRecord_(name, id) {
  var sh = sheet_(name); var header = header_(sh);
  var row = findRow_(sh, id);
  if (!row) return null;
  return rowToRecord_(header, sh.getRange(row, 1, 1, header.length).getValues()[0]);
}

function findRow_(sh, id, ids) {
  ids = ids || idColumn_(sh);
  var i = ids.indexOf(String(id));
  return i < 0 ? 0 : i + 2;
}

function idColumn_(sh) {
  var last = sh.getLastRow();
  if (last < 2) return [];
  return sh.getRange(2, 1, last - 1, 1).getValues().map(function (r) { return String(r[0]); });
}

function putRecord_(sh, rec, cache) {
  if (!rec || !rec.id) throw new Error('Record without id');
  var flat = explode_(rec);
  var header = ensureCols_(sh, cache.header, Object.keys(flat));
  cache.header = header;
  var rowNum = findRow_(sh, rec.id, cache.ids);
  var values;
  if (rowNum) {
    values = sh.getRange(rowNum, 1, 1, header.length).getValues()[0].map(String);
    // clear stale spill columns of fields being rewritten
    header.forEach(function (h, i) { var m = h.match(/^(.*)__(\d+)$/); if (m && (m[1] in rec) && !(h in flat)) values[i] = ''; });
  } else {
    values = header.map(function () { return ''; });
    rowNum = sh.getLastRow() + 1;
    if (rowNum > sh.getMaxRows()) sh.insertRowsAfter(sh.getMaxRows(), 200);
    cache.ids.push(String(rec.id));
  }
  header.forEach(function (h, i) { if (h in flat) values[i] = flat[h]; });
  var range = sh.getRange(rowNum, 1, 1, header.length);
  range.setNumberFormat('@');   // keep everything as plain text: no date/number/formula conversion
  range.setValues([values]);
}

function deleteRecord_(sh, id, cache) {
  var rowNum = findRow_(sh, id, cache.ids);
  if (!rowNum) return;
  sh.deleteRow(rowNum);
  cache.ids.splice(rowNum - 2, 1);
}

function commit_(ops) {
  var caches = {};
  ops.forEach(function (o) {
    var sh = sheet_(o.sheet);
    var c = caches[o.sheet] || (caches[o.sheet] = { header: header_(sh), ids: idColumn_(sh) });
    if (o.op === 'put') putRecord_(sh, o.record, c);
    else if (o.op === 'del') deleteRecord_(sh, o.id, c);
  });
  return { ok: true, count: ops.length };
}

/* ============================ app data ============================ */

function bootstrap_() {
  ensureSheets_();
  var tables = {};
  ['Clients', 'Events', 'Documents', 'Payments', 'Activity'].forEach(function (t) {
    tables[t] = readAll_(t, t === 'Documents' ? ['snapshot'] : null);   // snapshots are loaded on demand
  });
  var settings = {};
  readAll_('Settings').forEach(function (r) { try { settings[r.id] = JSON.parse(r.value); } catch (e) { settings[r.id] = r.value; } });
  var counters = {};
  readAll_('Counters').forEach(function (r) { counters[r.id] = Number(r.value) || 0; });
  return { tables: tables, settings: settings, counters: counters };
}

function saveSettings_(obj) {
  var sh = sheet_('Settings');
  var c = { header: header_(sh), ids: idColumn_(sh) };
  Object.keys(obj).forEach(function (k) { putRecord_(sh, { id: k, value: JSON.stringify(obj[k]) }, c); });
  return true;
}

function nextNumber_(series) {
  if (!series) throw new Error('Missing series');
  var sh = sheet_('Counters');
  var c = { header: header_(sh), ids: idColumn_(sh) };
  var cur = getRecord_('Counters', series);
  var n = (cur ? Number(cur.value) || 0 : 0) + 1;
  putRecord_(sh, { id: series, value: String(n) }, c);
  return n;
}

function setCounter_(series, value) {
  var sh = sheet_('Counters');
  putRecord_(sh, { id: series, value: String(Number(value) || 0) }, { header: header_(sh), ids: idColumn_(sh) });
  return true;
}
