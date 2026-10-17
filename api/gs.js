// POST /api/gs  { action, payload }  — signed-in requests are passed to Google Apps Script
// together with the private server key. The browser never sees the script URL or the key.
import { missingEnv, verifySession, readBody, send } from './_lib/auth.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return send(res, 405, { ok: false, error: 'Method not allowed' });
  const miss = missingEnv();
  if (miss.length) return send(res, 500, { ok: false, code: 'SETUP', error: `Server not set up: add ${miss.join(', ')} in Vercel and redeploy.` });
  if (!verifySession(req.headers['x-ra-session'])) return send(res, 401, { ok: false, code: 'AUTH', error: 'Please enter your PIN again.' });

  const { action, payload } = await readBody(req);
  let text, status, finalUrl;
  try {
    const r = await fetch(process.env.APPS_SCRIPT_URL.trim(), {
      method: 'POST', redirect: 'follow',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action, payload, secret: process.env.API_SECRET }),
    });
    status = r.status; finalUrl = r.url; text = await r.text();
  } catch (e) {
    return send(res, 502, { ok: false, error: `Could not reach Google Apps Script (${e.message}). Check APPS_SCRIPT_URL in Vercel.` });
  }
  let data;
  try { data = JSON.parse(text); } catch {
    // Google answered with a web page: say which one, so the cause is visible
    const title = (text.match(/<title>([^<]*)<\/title>/i) || [])[1] || '';
    const body = text.replace(/<style[\s\S]*?<\/style>|<script[\s\S]*?<\/script>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 160);
    let hint = 'Check APPS_SCRIPT_URL and that the deployment\'s "Who has access" is "Anyone".';
    if (/accounts\.google\.com|sign in/i.test(finalUrl + title + body)) hint = 'Google asked for a sign-in: in Apps Script open Deploy → Manage deployments → ✏️ and set "Who has access" to "Anyone" (not "Anyone with Google account"), then Deploy.';
    else if (/authori[sz]ation|permission/i.test(title + body)) hint = 'The script needs permission: in Apps Script click Run (▶) once on any function or redeploy, and choose Allow when Google asks.';
    else if (/not found|unable to open|404/i.test(title + body) || status === 404) hint = 'The Web App URL was not found: copy it again from Deploy → Manage deployments and update APPS_SCRIPT_URL in Vercel, then redeploy.';
    return send(res, 502, { ok: false, error: `Google Apps Script did not reply properly (status ${status}${title ? `, “${title}”` : ''}). ${hint}${body ? ` Google said: “${body}”` : ''}` });
  }
  if (!data.ok && (data.code === 'AUTH' || data.code === 'SETUP')) {
    return send(res, 502, { ok: false, error: `Google Apps Script: ${data.error} API_SECRET in Vercel and in Code.gs must be exactly the same; after editing Code.gs deploy a new version.` });
  }
  return send(res, 200, data);
}
