#!/usr/bin/env node
/* Blueprint Buddy — zero-dependency dev server.
 * Run: node serve.js [--no-watch]
 *
 * Builds dist/index.html on boot, serves it, rebuilds when src/ or vendor/
 * changes, and mounts the same /api/chat handler Vercel deploys from api/ —
 * so `npm run dev` behaves exactly like the production host. Used by local
 * dev and by the v0 sandbox preview alike.
 *
 * Reads .env (KEY=VALUE lines) if present, without overriding real env vars,
 * so ANTHROPIC_API_KEY works locally with no tooling.
 */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const root = __dirname;
const DIST = path.join(root, 'dist');
const PORT = Number(process.env.PORT) || 3000;
const WATCH = !process.argv.includes('--no-watch');

/* ---- .env (optional, local dev only) ---- */
try {
  for (const line of fs.readFileSync(path.join(root, '.env'), 'utf8').split('\n')) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
} catch (e) { /* no .env — fine */ }

/* ---- build ---- */
function build() {
  try {
    execFileSync(process.execPath, ['build.js'], { cwd: root, stdio: 'inherit' });
    return true;
  } catch (e) {
    console.error('build failed — still serving the previous dist/index.html');
    return false;
  }
}
build();

if (WATCH) {
  let timer = null;
  const rebuild = () => { clearTimeout(timer); timer = setTimeout(build, 150); };
  for (const dir of ['src', 'vendor']) {
    try { fs.watch(path.join(root, dir), { recursive: true }, rebuild); }
    catch (e) { /* recursive watch unsupported — watch top level only */ fs.watch(path.join(root, dir), rebuild); }
  }
  console.log('watching src/ and vendor/ for changes');
}

/* ---- server ---- */
const chat = require('./api/chat.js');
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.ico': 'image/x-icon', '.woff2': 'font/woff2'
};

http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/api/chat') return chat(req, res);

  // Static: mirror how Vercel serves outputDirectory dist/.
  const rel = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
  const file = path.join(DIST, path.normalize(rel));
  if (!file.startsWith(DIST)) { res.statusCode = 403; return res.end('forbidden'); }
  fs.readFile(file, (err, data) => {
    if (err) { res.statusCode = 404; return res.end('not found'); }
    res.setHeader('Content-Type', MIME[path.extname(file)] || 'application/octet-stream');
    res.end(data);
  });
}).listen(PORT, '0.0.0.0', () => {
  console.log(`Blueprint Buddy on http://localhost:${PORT}` +
    (process.env.ANTHROPIC_API_KEY ? ' (AI proxy configured)' : ' (no ANTHROPIC_API_KEY — offline parser only)'));
});
