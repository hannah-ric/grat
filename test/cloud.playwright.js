/* Blueprint Buddy — cloud persistence end-to-end (accounts + /api/store).
 *
 * Drives the REAL app against the REAL dev server (serve.js) with the
 * dev-login provider: sign in, autosave a design, hard-reload, and prove
 * the project came back from the per-user document store — then sign out
 * and prove the device fallback still works. This is the one path the
 * artifact-shimmed smoke suite cannot exercise.
 *
 * Run: node test/cloud.playwright.js   (needs the Playwright devDependency)
 */
'use strict';
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) pass++; else { fail++; console.error('  ✗ ' + msg); } };

(async () => {
  const root = path.join(__dirname, '..');
  const kvFile = path.join(os.tmpdir(), 'bb-cloud-test-kv-' + Date.now() + '.json');
  const PORT = 44000 + (process.pid % 1000);
  const server = spawn(process.execPath, ['serve.js', '--no-watch'], {
    cwd: root,
    env: Object.assign({}, process.env, {
      PORT: String(PORT), BB_DEV_LOGIN: '1', BB_KV_FILE: kvFile,
      AUTH_SECRET: 'cloud-test-secret-0123456789abcdef0123456789abcdef'
    }),
    stdio: ['ignore', 'pipe', 'pipe']
  });
  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('serve.js never came up')), 30000);
    server.stdout.on('data', d => { if (String(d).includes('Blueprint Buddy on')) { clearTimeout(t); resolve(); } });
    server.stderr.on('data', d => process.stderr.write(d));
  });

  // Same launch recipe as the smoke suite (pre-provisioned Chromium).
  const browser = await chromium.launch({
    executablePath: fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined,
    args: ['--no-sandbox', '--enable-unsafe-swiftshader']
  });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const base = `http://127.0.0.1:${PORT}`;

  try {
    // 1. Anonymous boot: device persistence, sign-in offered in the menu.
    await page.goto(base + '/');
    await page.waitForFunction(() => globalThis.__bb && __bb.state.spec, null, { timeout: 30000 });
    await page.waitForFunction(() => !document.getElementById('accountArea').hidden, null, { timeout: 8000 });
    ok(await page.evaluate(() => BB.Store.persistenceMode()) === 'device', 'anonymous on Vercel-like host → device persistence');
    ok(await page.evaluate(() => BB.Store.auth().providers.includes('dev')), 'dev provider offered');

    // 2. Sign in (dev provider = one redirect, no upstream).
    await page.goto(base + '/api/auth?provider=dev');
    await page.waitForFunction(() => globalThis.__bb && __bb.state.spec, null, { timeout: 30000 });
    await page.waitForFunction(() => BB.Store.persistenceMode() === 'cloud', null, { timeout: 8000 });
    ok(true, 'signed in → cloud persistence mode');
    ok(await page.evaluate(() => (BB.Store.auth().user || {}).name) === 'Local Dev', 'session carries the user');

    // 3. Make a distinctive design and autosave it.
    await page.evaluate(() => __bb.merge({ meta: { name: 'Cloud Walnut Bench' }, wood: { species: 'walnut' } }, 'manual'));
    await page.evaluate(() => __bb.doAutosave());
    await page.waitForFunction(() => fetch('/api/store?doc=projects:index', { credentials: 'same-origin' })
      .then(r => r.json()).then(d => !!d.value && d.value.includes('Cloud Walnut Bench')), null, { timeout: 8000 });
    ok(true, 'autosave lands in the per-user cloud store');
    const kv = JSON.parse(fs.readFileSync(kvFile, 'utf8'));
    ok(Object.keys(kv).every(k => k.startsWith('bb:dev:local:')), 'every stored key is namespaced to the user');

    // 4. Hard reload: the project comes back from the cloud.
    await page.goto(base + '/');
    await page.waitForFunction(() => globalThis.__bb && __bb.state.spec, null, { timeout: 30000 });
    await page.waitForFunction(() => __bb.state.spec.meta.name === 'Cloud Walnut Bench', null, { timeout: 10000 });
    ok(true, 'reload restores the cloud project');
    ok(await page.evaluate(() => __bb.state.spec.wood.species) === 'walnut', 'restored spec is intact (species survives)');

    // 5. Sign out: back to device, app fully working.
    await page.goto(base + '/api/auth?logout=1');
    await page.waitForFunction(() => globalThis.__bb && __bb.state.spec, null, { timeout: 30000 });
    ok(await page.evaluate(() => BB.Store.persistenceMode()) === 'device', 'sign-out falls back to device persistence');
    // The device write-through means the project is STILL there locally.
    ok(await page.evaluate(() => __bb.state.spec.meta.name) === 'Cloud Walnut Bench', 'write-through device copy survives sign-out');
  } catch (e) {
    fail++;
    console.error('  ✗ scenario crashed: ' + e.message);
  }

  await browser.close();
  server.kill();
  try { fs.unlinkSync(kvFile); } catch (e) { /* gone */ }
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
