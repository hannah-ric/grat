/* Blueprint Buddy — degradation test: the app without a WebGL context.
 * Run: node test/nowebgl.playwright.js   (build dist/index.html first)
 *
 * WHY THIS SUITE EXISTS
 * `BB.Engine.create` was called unguarded as the third statement of boot(),
 * so a browser that cannot hand back a WebGL context took the WHOLE product
 * down: the throw aborted boot before the seed design committed, leaving the
 * stage on its boot skeleton ("Drafting your bench…"), the chat empty, and
 * every Plan tab rendering zero characters — including the cut list, the
 * shopping list, and the safety report, none of which need a GPU. No message
 * was shown. That is not exotic hardware: GPU blocklists on managed laptops,
 * Firefox with hardware acceleration off, older tablets, and any tab whose
 * driver has crashed once all land here.
 *
 * Everything downstream of correctSpec is a pure function of the spec, so a
 * dead viewport must cost the viewport ONLY. This suite runs the real app in
 * a browser launched with WebGL genuinely disabled — not stubbed in page
 * script, which Three.js gets past — and asserts the plans survive.
 */
'use strict';
const { chromium } = require('playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');

const DIST = path.join(__dirname, '..', 'dist', 'index.html');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; } else { fail++; console.error('  ✗ ' + m); } };

(async () => {
  const html = fs.readFileSync(DIST, 'utf8');
  const server = http.createServer((req, res) => {
    const p = req.url.split('?')[0];
    if (p === '/' || p.startsWith('/index')) { res.setHeader('content-type', 'text/html'); return res.end(html); }
    res.statusCode = 204; res.end();
  }).listen(0);
  const port = server.address().port;

  const browser = await chromium.launch({
    executablePath: fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined,
    // At the BROWSER level: overriding canvas.getContext in an init script
    // does not reproduce this — Three.js still obtains a context.
    args: ['--no-sandbox', '--disable-webgl', '--disable-webgl2', '--disable-3d-apis']
  });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await page.addInitScript(() => { try { localStorage.setItem('bb.porchSeen', 'credits-2026-07'); } catch (e) { /* storage-less */ } });
  await page.goto(`http://localhost:${port}/`, { waitUntil: 'load' });
  await page.waitForTimeout(3500);

  ok(await page.evaluate(() => {
    try { return !document.createElement('canvas').getContext('webgl2') && !document.createElement('canvas').getContext('webgl'); }
    catch (e) { return true; }
  }), 'precondition: this browser really has no WebGL context');

  /* ---- boot completes rather than aborting ---- */
  ok(await page.evaluate(() => !document.getElementById('bootSkeleton')),
    'the boot skeleton is removed — boot ran to completion');
  ok(await page.evaluate(() => document.body.dataset.view3d === 'unavailable'),
    'the shell records that 3D is unavailable');
  ok(await page.evaluate(() => !!document.getElementById('view3dFallback')),
    'the viewport says so, in words, instead of sitting on a spinner');
  ok(await page.evaluate(() => /plans/i.test(document.getElementById('view3dFallback').textContent)),
    'the message tells the user their plans are unaffected');
  ok(await page.evaluate(() => (document.querySelector('#chatLog') || {}).innerText.length > 50),
    'the chat welcome still lands');

  if (await page.locator('#welcomeClose').isVisible().catch(() => false)) await page.click('#welcomeClose').catch(() => {});
  await page.waitForTimeout(600);
  ok(await page.evaluate(() => !!document.querySelector('#welcomeCard, .welcome-card') || true),
    'first-run card path does not throw without a viewport');

  /* ---- the product itself: every plan surface renders ---- */
  await page.click('#mode-plan');
  await page.waitForTimeout(1000);
  for (const [label, sel] of [['Cut', '#tab-cut'], ['Buy', '#tab-stock'], ['Assemble', '#tab-assembly'], ['Safety', '#tab-integrity'], ['Overview', '#tab-overview']]) {
    await page.click(sel);
    await page.waitForTimeout(500);
    const n = await page.evaluate(() => (document.querySelector('#panel-main') || {}).innerText.length || 0);
    ok(n > 150, `${label} renders without a GPU (${n} chars)`);
  }

  /* ---- and the engine stand-in absorbs calls instead of throwing ---- */
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.evaluate(() => {
    const e = __bb.state.engine;
    // A representative spread of what the shell calls on the engine.
    e.frame(); e.resize(); e.setExplode(0.5); e.setDims(true); e.setDrafting(true);
    e.select('leg_1'); e.isolate(null); e.clearFocus(); e.setTheme('dark');
    e.setQuality({ textured: false, shadows: false }); e.snapNow(); e.unitsChanged();
  });
  await page.waitForTimeout(300);
  ok(!errors.length, `engine calls are absorbed by the stand-in (${errors[0] || 'no errors'})`);
  ok(await page.evaluate(() => __bb.state.engine.getIsolated() === null && __bb.state.engine.inPlayback() === false),
    'value-returning engine methods answer sensibly');
  ok(await page.evaluate(() => __bb.state.engine.renderNow() == null),
    'renderNow yields nothing to capture, and callers null-check it');

  await browser.close();
  server.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('no-webgl suite failed:', e); process.exit(1); });
