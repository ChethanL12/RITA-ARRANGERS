/**
 * Rita Arrangers — Event Manager backend (Google Apps Script, bound to a Google Sheet).
 *
 * Storage: one tab per table (Clients, Events, Documents, Payments, Activity, Settings, Counters).
 * PDFs:    not stored here — each issued document's details are kept in the Documents tab and
 *          the app rebuilds the identical PDF on the device whenever it is viewed or downloaded.
 * Access:  every request needs a session token obtained with the PIN set from the
 *          sheet menu "Rita Arrangers → Set up / change PIN".
 *
 * Setup steps are in README.md → "Google setup".
 */

var TABLES = ['Clients', 'Events', 'Documents', 'Payments', 'Activity', 'Settings', 'Counters'];
var CHUNK = 45000;                 // Sheets cells hold 50,000 characters; longer values spill into field__2, field__3…
var TOKEN_DAYS = 30;
var MAX_FAILS = 5;

/* ============================ menu & setup ============================ */

function onOpen() {
  SpreadsheetApp.getUi().createMenu('Rita Arrangers')
    .addItem('Reset forgotten PIN', 'setupPin')
    .addItem('Sign out all devices', 'signOutAll')
    .addToUi();
}

function setupPin() {
  var ui = SpreadsheetApp.getUi();
  ensureSheets_();
  var a = ui.prompt('Reset Rita Arrangers PIN', 'Forgot your PIN? Choose a new one (at least 6 digits). All devices will need the new PIN.', ui.ButtonSet.OK_CANCEL);
  if (a.getSelectedButton() !== ui.Button.OK) return;
  var pin = a.getResponseText().trim();
  if (pin.length < 6) { ui.alert('The PIN must be at least 6 characters.'); return; }
  var b = ui.prompt('Repeat the PIN', ui.ButtonSet.OK_CANCEL);
  if (b.getSelectedButton() !== ui.Button.OK) return;
  if (b.getResponseText().trim() !== pin) { ui.alert('The PINs did not match. Nothing was changed.'); return; }
  setPin_(pin);
  ui.alert('New PIN saved. Use it to open the Rita Arrangers app on every device.');
}

function signOutAll() {
  clearTokens_();
  SpreadsheetApp.getUi().alert('All devices have been signed out.');
}

function setPin_(pin) {
  var props = PropertiesService.getScriptProperties();
  var salt = Utilities.getUuid();
  props.setProperty('PIN_SALT', salt);
  props.setProperty('PIN_HASH', sha256_(salt + pin));
  clearTokens_();
}

/* ============================ web entry points ============================ */

function doGet() {
  return json_({ ok: true, result: { app: 'rita-arrangers', message: 'Rita Arrangers backend is running. Open the app and paste this URL to connect.' } });
}

function doPost(e) {
  var req;
  try { req = JSON.parse(e.postData.contents); } catch (err) { return json_({ ok: false, error: 'Bad request' }); }
  try {
    var action = req.action, p = req.payload || {};
    if (action === 'ping') return json_({ ok: true, result: { app: 'rita-arrangers', hasPin: !!PropertiesService.getScriptProperties().getProperty('PIN_HASH') } });
    if (action === 'login') return json_({ ok: true, result: login_(p.pin, p.device) });
    if (action === 'setupPin') return json_({ ok: true, result: withLock_(function () {
      // first-time setup from the app: only allowed while no PIN exists yet
      if (PropertiesService.getScriptProperties().getProperty('PIN_HASH')) throw new Error('A PIN is already set. Use Settings → Change PIN in the app.');
      if (String(p.pin || '').length < 6) throw new Error('Use at least 6 digits.');
      setPin_(String(p.pin));
      return login_(p.pin, p.device);
    }) });
    if (!checkToken_(req.token)) return json_({ ok: false, code: 'AUTH', error: 'Please sign in again.' });

    var r;
    switch (action) {
      case 'logout': revoke_(req.token); r = true; break;
      case 'changePin': r = changePin_(p.oldPin, p.newPin); break;
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

/* ============================ authentication ============================ */

function sha256_(s) {
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, s, Utilities.Charset.UTF_8);
  return bytes.map(function (b) { var v = (b < 0 ? b + 256 : b).toString(16); return v.length === 1 ? '0' + v : v; }).join('');
}

function login_(pin, device) {
  var props = PropertiesService.getScriptProperties();
  var hash = props.getProperty('PIN_HASH');
  if (!hash) throw new Error('No PIN is set yet. Open the Google Sheet → Rita Arrangers → Set up / change PIN.');
  var cache = CacheService.getScriptCache();
  var fails = Number(cache.get('fails') || 0);
  if (fails >= MAX_FAILS) throw new Error('Too many wrong attempts. Please wait 15 minutes and try again.');
  if (sha256_(props.getProperty('PIN_SALT') + String(pin || '')) !== hash) {
    cache.put('fails', String(fails + 1), 900);
    throw new Error('Incorrect PIN.' + (fails + 1 >= MAX_FAILS - 1 ? ' Attempts left: ' + Math.max(0, MAX_FAILS - fails - 1) : ''));
  }
  cache.remove('fails');
  pruneTokens_();
  var token = Utilities.getUuid() + Utilities.getUuid();
  props.setProperty('T_' + sha256_(token), JSON.stringify({ exp: Date.now() + TOKEN_DAYS * 864e5, device: String(device || '').slice(0, 80), at: Date.now() }));
  return { token: token };
}

function checkToken_(token) {
  if (!token) return false;
  var props = PropertiesService.getScriptProperties();
  var key = 'T_' + sha256_(token);
  var raw = props.getProperty(key);
  if (!raw) return false;
  var t = JSON.parse(raw);
  if (t.exp < Date.now()) { props.deleteProperty(key); return false; }
  if (Date.now() - (t.at || 0) > 864e5) { t.at = Date.now(); t.exp = Date.now() + TOKEN_DAYS * 864e5; props.setProperty(key, JSON.stringify(t)); }
  return true;
}

function revoke_(token) { PropertiesService.getScriptProperties().deleteProperty('T_' + sha256_(token)); }

function pruneTokens_() {
  var props = PropertiesService.getScriptProperties(); var all = props.getProperties();
  Object.keys(all).forEach(function (k) {
    if (k.indexOf('T_') === 0) { try { if (JSON.parse(all[k]).exp < Date.now()) props.deleteProperty(k); } catch (e) { props.deleteProperty(k); } }
  });
}

function clearTokens_() {
  var props = PropertiesService.getScriptProperties(); var all = props.getProperties();
  Object.keys(all).forEach(function (k) { if (k.indexOf('T_') === 0) props.deleteProperty(k); });
}

function changePin_(oldPin, newPin) {
  var props = PropertiesService.getScriptProperties();
  if (sha256_(props.getProperty('PIN_SALT') + String(oldPin || '')) !== props.getProperty('PIN_HASH')) throw new Error('The current PIN is incorrect.');
  if (String(newPin || '').length < 6) throw new Error('Use at least 6 characters.');
  setPin_(String(newPin));
  return true;
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
