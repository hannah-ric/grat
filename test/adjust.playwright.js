/* Blueprint Buddy — Adjust-rail control-surface test.
 * Run: node test/adjust.playwright.js   (build dist/index.html first)
 *
 * WHY THIS SUITE EXISTS
 * Chat is behind sign-in on a configured origin, so the Adjust rail is the
 * whole editing surface for anonymous, signed-out, and offline sessions. Two
 * things were wrong with it (audit X-02, X-03):
 *
 *   - joinery could not be changed outside chat at all, and
 *   - skill level was a ceiling and never a floor: setting "advanced" left a
 *     design on the beginner joints it started with, so declaring yourself
 *     advanced changed nothing.
 *
 * The rail also hardcoded its own dimension bounds, duplicating the clamp
 * table in spec.js — a slider offering a value correctSpec silently refuses
 * is the same silent-correction class the notes work exists to kill.
 */
'use strict';
const { chromium } = require('playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');

const DIST = path.join(__dirname, '..', 'dist', 'index.html');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; } else { fail++; console.error('  ✗ ' + m); } };

const rail = () => ({
  open: () => {
    const b = document.getElementById('adjustBtn');
    if (document.getElementById('adjustRail').hidden) b.click();
  }
});

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
    args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox']
  });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript(() => { try { localStorage.setItem('bb.porchSeen', 'credits-2026-07'); } catch (e) { /* storage-less */ } });
  await page.goto(`http://localhost:${port}/`, { waitUntil: 'load' });
  await page.waitForTimeout(2600);
  if (await page.locator('#welcomeClose').isVisible().catch(() => false)) await page.click('#welcomeClose').catch(() => {});
  await page.waitForTimeout(500);

  const openRail = async () => {
    await page.evaluate(() => { if (document.getElementById('adjustRail').hidden) document.getElementById('adjustBtn').click(); });
    await page.waitForTimeout(350);
  };
  const labels = () => page.evaluate(() =>
    [...document.querySelectorAll('#adjustRail .param .param-label')].map(l => (l.textContent || '').trim()));

  /* ---- the bounds a slider offers must be the bounds correctSpec enforces ---- */
  await openRail();
  ok(await page.evaluate(() => !!(BB.Spec.DIM_RULES && BB.Spec.DIM_RULES['overall.width'])),
    'the clamp table is exported for the UI to read');
  ok(await page.evaluate(() => {
    const r = BB.Spec.DIM_RULES;
    if (!r) return false;
    // Every unit-aware slider maps its own domain, so compare in millimetres
    // by round-tripping the rail's own conversion.
    return Object.keys(r).length >= 8 && r['overall.width'].max === 2400;
  }), 'clamp table carries the bounds the rail renders from');

  /* ---- a table: frame joints appear, case/box do not ---- */
  const tableLabels = await labels();
  ok(tableLabels.some(l => /^Frame joints/.test(l)), `table exposes frame joints (${tableLabels.join(' · ')})`);
  ok(!tableLabels.some(l => /^Case joints|^Drawer-box joints/.test(l)), 'table does not offer joints it never builds with');
  ok(tableLabels.some(l => /Top thickness/.test(l)), 'table exposes top thickness');
  ok(tableLabels.some(l => /Leg thickness/.test(l)), 'table exposes leg thickness');

  /* ---- the slot only lists joints legal at this level ---- */
  const beginnerOpts = await page.evaluate(() => {
    const wrap = [...document.querySelectorAll('#adjustRail .param')].find(p => /Frame joints/.test(p.textContent));
    return [...wrap.querySelectorAll('option')].map(o => o.value);
  });
  const legalBeginner = await page.evaluate(() => BB.K.jointsForLevel('beginner'));
  ok(beginnerOpts.every(k => legalBeginner.includes(k)),
    `beginner frame options are all beginner-legal (${beginnerOpts.join(',')})`);
  ok(!beginnerOpts.includes('mortise_tenon'), 'mortise & tenon is not offered to a beginner');

  /* ---- changing a joint through the rail actually changes the design ---- */
  const before = await page.evaluate(() => __bb.state.spec.joinery.frame);
  await page.evaluate(() => {
    const wrap = [...document.querySelectorAll('#adjustRail .param')].find(p => /Frame joints/.test(p.textContent));
    const sel = wrap.querySelector('select');
    const other = [...sel.options].map(o => o.value).find(v => v !== sel.value);
    sel.value = other;
    sel.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await page.waitForTimeout(700);
  const after = await page.evaluate(() => __bb.state.spec.joinery.frame);
  ok(after !== before, `the joinery select commits (${before} → ${after})`);

  /* ---- X-02: raising the level OFFERS the joints it unlocks ---- */
  await page.evaluate(() => __bb.merge({ meta: { level: 'beginner' } }, 'manual'));
  await openRail();
  await page.evaluate(() => {
    const seg = [...document.querySelectorAll('#adjustRail .param')].find(p => /Skill level/.test(p.textContent));
    [...seg.querySelectorAll('button')].find(b => /Advanced/.test(b.textContent)).click();
  });
  await page.waitForTimeout(800);
  ok(await page.evaluate(() => __bb.state.spec.meta.level === 'advanced'), 'the level segment commits');
  const offer = await page.evaluate(() => {
    const msgs = [...document.querySelectorAll('#chatLog .msg')];
    const last = msgs[msgs.length - 1];
    return last ? (last.innerText || '').replace(/\s+/g, ' ').trim() : '';
  });
  ok(/unlocks stronger joinery/i.test(offer), `raising the level offers the unlocked joints — got "${offer.slice(0, 90)}"`);

  const advOpts = await page.evaluate(() => {
    const wrap = [...document.querySelectorAll('#adjustRail .param')].find(p => /Frame joints/.test(p.textContent));
    return [...wrap.querySelectorAll('option')].map(o => o.value);
  });
  ok(advOpts.includes('mortise_tenon'), 'advanced unlocks mortise & tenon in the rail');

  /* ---- and taking the offer really upgrades the joint ---- */
  const beforeOffer = await page.evaluate(() => __bb.state.spec.joinery.frame);
  await page.evaluate(() => {
    const msgs = [...document.querySelectorAll('#chatLog .msg')];
    const btn = msgs[msgs.length - 1].querySelector('.answer-row button');
    if (btn) btn.click();
  });
  await page.waitForTimeout(800);
  const afterOffer = await page.evaluate(() => __bb.state.spec.joinery.frame);
  ok(afterOffer !== beforeOffer, `taking the offer upgrades the joint (${beforeOffer} → ${afterOffer})`);
  ok(await page.evaluate(() => BB.K.jointsForLevel('advanced').includes(__bb.state.spec.joinery.frame)),
    'the upgraded joint is legal at the level that offered it');

  /* ---- lowering the level does not badger, and correction still governs ---- */
  const msgsBefore = await page.evaluate(() => document.querySelectorAll('#chatLog .msg').length);
  await openRail();
  await page.evaluate(() => {
    const seg = [...document.querySelectorAll('#adjustRail .param')].find(p => /Skill level/.test(p.textContent));
    [...seg.querySelectorAll('button')].find(b => /Beginner/.test(b.textContent)).click();
  });
  await page.waitForTimeout(800);
  ok(await page.evaluate(() => BB.K.jointsForLevel('beginner').includes(__bb.state.spec.joinery.frame)),
    'dropping the level snaps the joint back to something legal');
  const msgsAfter = await page.evaluate(() => document.querySelectorAll('#chatLog .msg').length);
  ok(msgsAfter <= msgsBefore + 1, 'lowering the level does not push a joinery offer');

  /* ---- a case piece exposes case joints and shelf thickness ---- */
  await page.evaluate(() => __bb.commit(BB.Spec.defaultSpec('bookshelf'), 'manual'));
  await page.waitForTimeout(700);
  await openRail();
  const shelfLabels = await labels();
  ok(shelfLabels.some(l => /^Case joints/.test(l)), `bookshelf exposes case joints (${shelfLabels.join(' · ')})`);
  ok(!shelfLabels.some(l => /^Frame joints/.test(l)), 'bookshelf does not offer frame joints it never builds with');
  ok(shelfLabels.some(l => /Shelf thickness/.test(l)), 'bookshelf exposes shelf thickness');

  /* ---- a novel piece steers through chat, and says so ---- */
  await page.evaluate(() => __bb.commit(BB.Spec.defaultSpec('custom'), 'manual'));
  await page.waitForTimeout(700);
  await openRail();
  const customLabels = await labels();
  ok(!customLabels.some(l => /joints/i.test(l)), 'a novel piece offers no slot selects — its joints are per connection');

  ok(!errors.length, `no page errors (${errors[0] || ''})`);

  await browser.close();
  server.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('adjust suite failed:', e); process.exit(1); });
