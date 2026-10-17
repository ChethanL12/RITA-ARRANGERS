// Shared helpers for the Vercel server functions.
// Environment variables (Vercel → Project → Settings → Environment Variables):
//   APP_PIN          the PIN asked when the app opens (at least 6 digits)
//   APPS_SCRIPT_URL  your Google Apps Script Web App URL (ends in /exec)
//   API_SECRET       long random text; paste the same text into API_SECRET at the top of Code.gs
import crypto from 'node:crypto';

const SESSION_HOURS = 12;

export function missingEnv() {
  const miss = [];
  if (String(process.env.APP_PIN || '').length < 4) miss.push('APP_PIN');
  if (!/^https?:\/\//.test(process.env.APPS_SCRIPT_URL || '')) miss.push('APPS_SCRIPT_URL');
  if (String(process.env.API_SECRET || '').length < 16) miss.push('API_SECRET (16+ characters)');
  return miss;
}

export function safeEqual(a, b) {
  const x = crypto.createHash('sha256').update(String(a)).digest();
  const y = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(x, y);
}

const key = () => crypto.createHash('sha256').update('ra-session:' + (process.env.API_SECRET || '') + ':' + (process.env.APP_PIN || '')).digest();

/** short-lived session token; changing APP_PIN or API_SECRET invalidates every existing session */
export function signSession() {
  const payload = Buffer.from(JSON.stringify({ exp: Date.now() + SESSION_HOURS * 3600e3 })).toString('base64url');
  const sig = crypto.createHmac('sha256', key()).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}
export function verifySession(token) {
  const [payload, sig] = String(token || '').split('.');
  if (!payload || !sig) return false;
  const good = crypto.createHmac('sha256', key()).update(payload).digest('base64url');
  if (!safeEqual(sig, good)) return false;
  try { return JSON.parse(Buffer.from(payload, 'base64url').toString()).exp > Date.now(); } catch { return false; }
}

export async function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') { try { return JSON.parse(req.body); } catch { return {}; } }
  const chunks = []; for await (const c of req) chunks.push(c);
  try { return JSON.parse(Buffer.concat(chunks).toString() || '{}'); } catch { return {}; }
}

export function send(res, status, obj) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(obj));
}
