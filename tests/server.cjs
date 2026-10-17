// Test server: serves the app and emulates the Apps Script Web App at POST /exec,
// executing the real backend/Code.gs against the in-memory mock.
// Usage: node tests/server.cjs [port] [pin]
const http = require('http'); const fs = require('fs'); const path = require('path'); const vm = require('vm');
const { install } = require('./gas-mock.cjs');
const root = path.join(__dirname, '..');
const vercel = JSON.parse(fs.readFileSync(path.join(root, 'vercel.json'), 'utf8'));
const ctx = {}; const state = install(ctx); vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(root, 'backend/Code.gs'), 'utf8'), ctx);
const port = Number(process.argv[2] || 8090); const pin = process.argv[3] || '246810';
ctx.ensureSheets_(); if (pin !== 'none') ctx.setPin_(pin);
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json', '.webmanifest': 'application/manifest+json' };
http.createServer((req, res) => {
  if (req.method === 'POST' && req.url.startsWith('/exec')) {
    let body = ''; req.on('data', (c) => (body += c)); req.on('end', () => {
      const out = ctx.doPost({ postData: { contents: body } });
      res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }); res.end(out.text);
    }); return;
  }
  if (req.url === '/__state') { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ sheets: Object.fromEntries(Object.entries(state.sheets).map(([k, v]) => [k, v.rows])), files: Object.keys(state.files).length })); }
  let p = decodeURIComponent(req.url.split('?')[0]); if (p === '/') p = '/index.html';
  const f = path.join(root, p);
  if (!f.startsWith(root) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end('not found'); }
  const hdrs = { 'Content-Type': types[path.extname(f)] || 'application/octet-stream' };
  // apply the production (Vercel) security headers so tests exercise the real CSP
  for (const h of vercel.headers[0].headers) hdrs[h.key] = h.key === 'Content-Security-Policy' ? h.value.replace("connect-src 'self'", `connect-src 'self' http://localhost:${port}`) : h.value;
  res.writeHead(200, hdrs); fs.createReadStream(f).pipe(res);
}).listen(port, () => console.log(`test server on http://localhost:${port} (PIN ${pin})`));
