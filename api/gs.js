// POST /api/gs  { action, payload }  — signed-in requests are passed to Google Apps Script
// together with the private server key. The browser never sees the script URL or the key.
import { missingEnv, verifySession, readBody, send } from './_lib/auth.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return send(res, 405, { ok: false, error: 'Method not allowed' });
  const miss = missingEnv();
  if (miss.length) return send(res, 500, { ok: false, code: 'SETUP', error: `Server not set up: add ${miss.join(', ')} in Vercel and redeploy.` });
  if (!verifySession(req.headers['x-ra-session'])) return send(res, 401, { ok: false, code: 'AUTH', error: 'Please enter your PIN again.' });

  const { action, payload } = await readBody(req);
  let text;
  try {
    const r = await fetch(process.env.APPS_SCRIPT_URL, {
      method: 'POST', redirect: 'follow',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action, payload, secret: process.env.API_SECRET }),
    });
    text = await r.text();
  } catch (e) {
    return send(res, 502, { ok: false, error: 'Could not reach Google Apps Script. Check APPS_SCRIPT_URL in Vercel.' });
  }
  let data;
  try { data = JSON.parse(text); } catch {
    return send(res, 502, { ok: false, error: 'Google Apps Script did not reply properly. Check APPS_SCRIPT_URL and that the deployment\'s "Who has access" is "Anyone".' });
  }
  if (!data.ok && (data.code === 'AUTH' || data.code === 'SETUP')) {
    return send(res, 502, { ok: false, error: `Google Apps Script: ${data.error} API_SECRET in Vercel and in Code.gs must be exactly the same; after editing Code.gs deploy a new version.` });
  }
  return send(res, 200, data);
}
