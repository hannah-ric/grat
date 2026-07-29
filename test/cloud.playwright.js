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
  // The spawned server outlives every failure path unless something kills it.
  // Boot timeouts and chromium.launch() failures both used to escape before
  // the scenario's try block, leaving serve.js running: locally that is a
  // stray process, but on a CI runner a leaked child holds the step's stdout
  // pipe open and the step hangs until its timeout instead of failing fast.
  let browser = null;
  const cleanup = () => {
    try { if (browser) browser.close(); } catch (e) { /* already gone */ }
    try { server.kill(); } catch (e) { /* already gone */ }
    try { fs.unlinkSync(kvFile); } catch (e) { /* gone */ }
  };
  process.on('exit', cleanup);

  try {
    await new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('serve.js never came up')), 30000);
      server.stdout.on('data', d => { if (String(d).includes('Blueprint Buddy on')) { clearTimeout(t); resolve(); } });
      server.stderr.on('data', d => process.stderr.write(d));
    });

    // Same launch recipe as the smoke suite (pre-provisioned Chromium).
    browser = await chromium.launch({
      executablePath: fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined,
      args: ['--no-sandbox', '--enable-unsafe-swiftshader']
    });
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    const base = `http://127.0.0.1:${PORT}`;
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
    // Everything a user creates is namespaced bb:{uid}:… . The ONE documented
    // exception is the signup-grant counter: bb:ipgrant:{hashed ip} deliberately
    // lives outside every per-uid keyspace (CLAUDE.md, api/_credits.js) because
    // its whole job is to cap grants per IP ACROSS accounts. This assertion
    // predates that counter and had been failing ever since, so it is written
    // as an allowlist rather than a prefix test: any key that is neither
    // per-uid nor a known shared root is a real leak and fails here.
    const SHARED_ROOTS = [/^bb:ipgrant:[0-9a-f]+$/, /^bb:leads(?::|$)/];
    const stray = Object.keys(kv).filter(k => !k.startsWith('bb:dev:local:') && !SHARED_ROOTS.some(rx => rx.test(k)));
    ok(!stray.length, `every stored key is per-user or a documented shared root (stray: ${JSON.stringify(stray)})`);
    ok(Object.keys(kv).some(k => k.startsWith('bb:dev:local:')), 'the user\'s own documents are namespaced to them');

    // 4. Hard reload: the project comes back from the cloud.
    await page.goto(base + '/');
    await page.waitForFunction(() => globalThis.__bb && __bb.state.spec, null, { timeout: 30000 });
    await page.waitForFunction(() => __bb.state.spec.meta.name === 'Cloud Walnut Bench', null, { timeout: 10000 });
    ok(true, 'reload restores the cloud project');
    ok(await page.evaluate(() => __bb.state.spec.wood.species) === 'walnut', 'restored spec is intact (species survives)');

    // 4b. The printed live link: every issued sheet footer prints
    // /?bp=<id> promising "open to refine or re-download". Issue this
    // design's blueprint, follow the link, and prove the issued design
    // loads AND arrives already recognized as paid (the ownership probe
    // re-attaches the credited-design record — no re-charge, no paywall).
    const issued = await page.evaluate(async () => {
      const r = await fetch('/api/blueprint', {
        method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ wire: BB.Codec.encode(__bb.state.spec) })
      });
      return { status: r.status, data: await r.json() };
    });
    ok(issued.status === 200 && issued.data.ok && issued.data.charged,
      `blueprint issues over the API, spending the signup credit (status ${issued.status})`);
    // Point the screen at something else so the link demonstrably does the work.
    await page.evaluate(() => __bb.merge({ meta: { name: 'Decoy Rename' } }, 'manual'));
    await page.goto(base + '/?bp=' + issued.data.id);
    await page.waitForFunction(() => globalThis.__bb && __bb.state.spec, null, { timeout: 30000 });
    await page.waitForFunction(() => __bb.state.spec.meta.name === 'Cloud Walnut Bench', null, { timeout: 10000 });
    ok(true, 'the /?bp= link from the issued sheets reopens the issued design');
    ok(await page.evaluate(() => location.search === ''), 'the ?bp= marker is stripped once the design loads');
    await page.waitForFunction(() => !!__bb.state.blueprint, null, { timeout: 10000 });
    ok(true, 'the reopened design is recognized as already issued (unlocked, never re-charged)');

    // 5. Sign out: back to device, app fully working.
    await page.goto(base + '/api/auth?logout=1');
    await page.waitForFunction(() => globalThis.__bb && __bb.state.spec, null, { timeout: 30000 });
    ok(await page.evaluate(() => BB.Store.persistenceMode()) === 'device', 'sign-out falls back to device persistence');
    // The device write-through means the project is STILL there locally.
    ok(await page.evaluate(() => __bb.state.spec.meta.name) === 'Cloud Walnut Bench', 'write-through device copy survives sign-out');
  } catch (e) {
    fail++;
    console.error('  ✗ scenario crashed: ' + e.message);
  } finally {
    cleanup();
  }
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
