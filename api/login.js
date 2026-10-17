// POST /api/login  { pin }  ->  { token }   — checks the PIN stored in Vercel (APP_PIN)
import { missingEnv, safeEqual, signSession, readBody, send } from './_lib/auth.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return send(res, 405, { ok: false, error: 'Method not allowed' });
  const miss = missingEnv();
  if (miss.length) return send(res, 500, { ok: false, code: 'SETUP', error: `The server is not set up yet. In Vercel → Settings → Environment Variables add: ${miss.join(', ')}. Then redeploy.` });
  const { pin } = await readBody(req);
  if (!safeEqual(String(pin || '').trim(), String(process.env.APP_PIN).trim())) {
    await new Promise((r) => setTimeout(r, 900));   // slows down guessing
    return send(res, 401, { ok: false, code: 'PIN', error: 'Incorrect PIN.' });
  }
  return send(res, 200, { ok: true, result: { token: signSession() } });
}
