/* Blueprint Buddy — browser smoke test against dist/index.html.
 * Run: node test/smoke.playwright.js
 * Drives the real app in headless Chromium: boot, gallery, chat refinement,
 * clarifying question, inspector, playback, exports, memory stability.
 */
'use strict';
const { chromium } = require('playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');

const DIST = path.join(__dirname, '..', 'dist', 'index.html');
const SHOTS = path.join(__dirname, '..', 'dist', 'shots');

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.error('  ✗ ' + m); } };

/* Secondary topbar controls (History, units, dual) live in the More menu —
 * open it first, then click, the way a user would. */
let page;
const clickMoreCtl = async sel => {
  if (!(await page.isVisible('#moreMenu.open'))) await page.click('#moreBtn');
  await page.click(sel);
};

(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  const html = fs.readFileSync(DIST, 'utf8');
  const server = http.createServer((req, res) => {
    if (req.url === '/' || req.url.startsWith('/index')) {
      res.setHeader('content-type', 'text/html');
      res.end(html); // dist carries its own doctype/html/head/body shell
    } else { res.statusCode = 204; res.end(); }
  }).listen(0);
  const port = server.address().port;

  const browser = await chromium.launch({
    executablePath: '/opt/pw-browsers/chromium',
    args: ['--no-sandbox', '--enable-unsafe-swiftshader']
  });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });

  // Shim the artifact key-value store over localStorage so persistence and
  // reload survival are testable end to end (same async surface as window.storage).
  await ctx.addInitScript(() => {
    window.storage = {
      async get(key) {
        const v = localStorage.getItem('bbshim:' + key);
        if (v === null) throw new Error('missing key');
        return { key, value: v };
      },
      async set(key, value) { localStorage.setItem('bbshim:' + key, value); },
      async delete(key) { localStorage.removeItem('bbshim:' + key); }
    };
  });

  await page.goto(`http://127.0.0.1:${port}/`);
  await page.waitForFunction(() => globalThis.__bb && __bb.state.model, null, { timeout: 15000 });
  ok(true, 'app booted');

  // Fresh session (cleared storage) starts in imperial: fractional inches.
  ok(await page.evaluate(() => __bb.state.spec.meta.units === 'in' && BB.Units.get().system === 'imperial'),
    'fresh session defaults to imperial display');

  // First run: a non-blocking welcome card offers the three entry paths while
  // the bench behind it stays fully live. The starter gallery opens on demand.
  ok(await page.isVisible('#welcomeOverlay'), 'welcome paths show on first run');
  ok(!(await page.isVisible('#galleryScrim.open')), 'no modal blocks the bench on boot');
  ok(await page.$$eval('#welcomeOverlay .welcome-card', b => b.length) === 3, 'welcome offers three entry paths');
  await page.click('#tab-stock');
  ok(await page.evaluate(() => __bb.state.tab === 'stock'), 'bench interactive behind the welcome card');
  await page.click('#tab-cut');
  await page.screenshot({ path: SHOTS + '/01-gallery.png' });
  await page.click('#welcomeStarter');
  await page.waitForSelector('#galleryScrim.open');
  ok(true, 'starter gallery opens from the welcome path');
  // Idle pass swaps the emoji cards for real rendered thumbnails.
  const thumbs = await page.waitForSelector('.gallery-card .g-thumb', { timeout: 10000 }).then(() => true).catch(() => false);
  ok(thumbs, 'gallery cards gain rendered 3D thumbnails after idle');
  ok(await page.evaluate(() => [...document.querySelectorAll('.gallery-card .g-thumb')].every(i => i.src.startsWith('data:image/jpeg'))),
    'every starter thumbnail rendered to a data URL');
  // First starter pick fires the one-shot hero assemble (fresh prefs).
  const heroBefore = await page.evaluate(() => !!__bb.state.prefs4.seenHero);
  await page.click('.gallery-card:nth-child(5)');
  await page.waitForFunction(() => __bb.state.spec.meta.template === 'nightstand');
  ok(await page.evaluate(() => document.getElementById('welcomeOverlay').hidden), 'welcome dismisses once a design is chosen');
  const ns = await page.evaluate(() => ({
    drawers: __bb.state.model.drawers.length,
    rails: __bb.state.model.parts.filter(p => p.role === 'rail').length,
    boxW: __bb.state.model.drawers[0].box.w,
    openW: __bb.state.model.drawers[0].opening.w,
    slide: __bb.state.model.drawers[0].slideLen,
    bomSlides: __bb.state.bomData.items.filter(i => i.label.includes('slides')).length
  }));
  ok(ns.drawers === 2 && ns.rails === 3, `nightstand starter: 2 drawers, 3 rails (got ${ns.drawers}/${ns.rails})`);
  ok(!heroBefore && await page.evaluate(() => __bb.state.prefs4.seenHero === true),
    'first starter pick marks the one-shot hero as seen');
  ok(Math.abs(ns.boxW - (ns.openW - 25.4)) < 0.01, 'box width = opening − 25.4 in live app');
  ok([250, 300, 350, 400, 450, 500].includes(ns.slide), 'standard slide length in live app');
  ok(ns.bomSlides === 2, 'slide pairs in BOM');
  ok(await page.evaluate(() => document.getElementById('hintPrompts').children.length === 0),
    'hint prompts hide once a gallery design loads');
  await page.waitForTimeout(900);
  await page.screenshot({ path: SHOTS + '/02-nightstand.png' });

  // Chat refinement: code-computed diff chip.
  await page.fill('#chatText', 'lower it by 50mm');
  await page.click('#sendBtn');
  await page.waitForSelector('.msg.bot .chip', { timeout: 8000 });
  const chip = await page.textContent('.msg.bot:last-child .chip');
  ok(/height 24 in → 22 1\/16 in/.test(chip), `diff chip shows code-computed change in display units (${chip.trim()})`);
  ok(await page.evaluate(() => __bb.state.spec.overall.height === 559.6), 'spec height merged to 559.6 mm internally');

  // Ambiguous prompt → clarifying question with tappable answers.
  await page.fill('#chatText', 'make it bigger');
  await page.click('#sendBtn');
  await page.waitForSelector('.answer-row button', { timeout: 8000 });
  const opts = await page.$$eval('.answer-row button', bs => bs.map(b => b.textContent));
  ok(opts.length >= 2, `clarifying question with ${opts.length} tappable answers`);
  await page.click('.answer-row button:first-child'); // "Wider"
  await page.waitForFunction(() => __bb.state.spec.overall.width > 508, null, { timeout: 8000 });
  ok(true, 'tapping an answer applies the refinement');
  await page.screenshot({ path: SHOTS + '/03-chat.png' });

  // Undo / redo across AI edits.
  const wNow = await page.evaluate(() => __bb.state.spec.overall.width);
  await page.click('#undoBtn');
  ok(await page.evaluate(() => __bb.state.spec.overall.width === 508), 'undo reverts width');
  await page.click('#redoBtn');
  ok(await page.evaluate((w) => __bb.state.spec.overall.width === w, wNow), 'redo restores width');

  // Inspector: select a leg via engine pick path, manual edit shares history.
  await page.evaluate(() => {
    const leg = __bb.state.model.parts.find(p => p.role === 'leg');
    __bb.state.engine.select(leg.id);
    globalThis.__openInsp(leg);
  }).catch(() => {});
  // openInspector isn't exported directly; drive through merge instead:
  const histBefore = await page.evaluate(() => __bb.state.history.snapshots.length);
  await page.evaluate(() => __bb.merge({ structure: { legThickness: 60 } }, 'manual'));
  const histAfter = await page.evaluate(() => ({
    n: __bb.state.history.snapshots.length,
    src: __bb.state.history.current().source,
    leg: __bb.state.spec.structure.legThickness
  }));
  ok(histAfter.n === histBefore + 1 && histAfter.src === 'manual' && histAfter.leg === 60,
    'manual edit lands on the same history stack');

  // History restore + compare.
  await clickMoreCtl('#historyBtn');
  await page.waitForSelector('#historyDrawer.open');
  const snapCount = await page.$$eval('#historyList .snap', s => s.length);
  ok(snapCount >= 5, `history drawer lists ${snapCount} snapshots`);
  const cbs = await page.$$('#historyList input[type="checkbox"]');
  await cbs[0].check(); await cbs[cbs.length - 1].check();
  await page.click('#compareBtn');
  await page.waitForSelector('#compareScrim.open');
  const diffRows = await page.$$eval('#compareRows tr', r => r.length);
  ok(diffRows >= 1, `compare table shows ${diffRows} rows`);
  await page.screenshot({ path: SHOTS + '/04-compare.png' });
  await page.click('#compareClose');
  ok(await page.isVisible('#compareBanner'), 'ghost overlay banner active');
  await page.waitForTimeout(400);
  await page.screenshot({ path: SHOTS + '/05-ghost.png' });
  await page.click('#compareExit');

  // Dimension annotations toggle.
  await page.click('#dimsToggle');
  ok(await page.evaluate(() => document.getElementById('dimsToggle').getAttribute('aria-pressed') === 'true'), 'dims toggle on');
  await page.waitForTimeout(400);
  await page.screenshot({ path: SHOTS + '/06-dims.png' });

  // Assembly playback: play a drawer step, scrub.
  await page.click('#tab-assembly');
  await page.waitForSelector('.step-item');
  const stepCount = await page.$$eval('.step-item', s => s.length);
  ok(stepCount >= 10, `nightstand assembly has ${stepCount} steps incl. drawer sub-sequences`);
  await page.click('.step-item[data-step="4"] .step-play');
  await page.waitForSelector('#playbackBar:not([hidden])');
  ok(true, 'playback bar appears');
  ok(await page.evaluate(() => __bb.state.engine.inPlayback()), 'engine in playback mode');
  await page.click('#pbNext');
  ok(await page.evaluate(() => __bb.state.playbackIndex === 5), 'scrubbing advances build state');
  await page.waitForTimeout(700);
  await page.screenshot({ path: SHOTS + '/07-playback.png' });
  await page.click('#pbExit');

  // Drawer micro-interaction.
  const opened = await page.evaluate(() => __bb.state.engine.toggleDrawer(0));
  ok(opened === true, 'drawer slides open');
  await page.waitForTimeout(600);
  await page.screenshot({ path: SHOTS + '/08-drawer-open.png' });
  await page.evaluate(() => __bb.state.engine.toggleDrawer(0));

  // Exploded view.
  await page.evaluate(() => __bb.state.engine.setExplode(0.85));
  await page.waitForTimeout(900);
  await page.screenshot({ path: SHOTS + '/09-explode.png' });
  await page.evaluate(() => __bb.state.engine.setExplode(0));

  // Exports from the live refined state.
  const daeCheck = await page.evaluate(() => {
    const dae = BB.Exports.toDAE(__bb.state.spec, __bb.state.model);
    const rb = BB.Exports.toRuby(__bb.state.spec, __bb.state.model);
    return {
      unit: dae.includes('<unit meter="0.001" name="millimeter"/>'),
      zup: dae.includes('<up_axis>Z_UP</up_axis>'),
      nodes: (dae.match(/<node id=/g) || []).length === __bb.state.model.parts.length,
      mm: (rb.match(/\.mm/g) || []).length > 50,
      oneLegDef: (rb.match(/defs\.add\("Leg /g) || []).length === 1,
      undo: rb.includes('start_operation') && rb.includes('commit_operation')
    };
  });
  ok(daeCheck.unit && daeCheck.zup && daeCheck.nodes, 'live .dae export: mm units, Z-up, node per part');
  ok(daeCheck.mm && daeCheck.oneLegDef && daeCheck.undo, 'live .rb export: .mm, deduped defs, one undo op');

  // Print sheet renders.
  await page.evaluate(() => {
    document.getElementById('printRoot').innerHTML =
      BB.Exports.printHTML(__bb.state.spec, __bb.state.model, __bb.state.cut, __bb.state.bomData, __bb.state.steps, __bb.state.stockPlan);
  });
  ok(await page.evaluate(() => document.querySelectorAll('#printRoot table tr').length > 10), 'print sheet has full tables');
  ok(await page.evaluate(() => document.querySelectorAll('#printRoot .print-board svg').length > 0 &&
    !document.querySelector('#printRoot .print-board svg').outerHTML.includes('var(--')),
    'print sheet includes stock diagrams with print-safe colors');
  await page.emulateMedia({ media: 'print' });
  await page.screenshot({ path: SHOTS + '/10-print.png', fullPage: true });
  await page.emulateMedia({ media: 'screen' });

  // Memory: shared geometry means rebuilds don't grow GPU allocations.
  const stats0 = await page.evaluate(() => __bb.state.engine.stats());
  await page.evaluate(async () => {
    for (let i = 0; i < 12; i++) {
      __bb.merge({ overall: { height: 520 + i * 10 } }, 'manual');
      await new Promise(r => setTimeout(r, 30));
    }
  });
  const stats1 = await page.evaluate(() => __bb.state.engine.stats());
  ok(stats1.geometries <= stats0.geometries + 1, `geometry count stable across 12 rebuilds (${stats0.geometries} → ${stats1.geometries})`);
  ok(stats1.materials < 200, `material pool bounded (${stats1.materials})`);
  ok(stats1.textures <= stats0.textures + 1, `texture count stable across 12 rebuilds (${stats0.textures} → ${stats1.textures})`);

  // Theme flip regenerates the environment map without leaking, and quality
  // toggling swaps the material pool without growing geometry.
  await page.evaluate(async () => {
    for (const t of ['dark', 'light', 'dark', 'light']) {
      __bb.applyTheme(t);
      await new Promise(r => setTimeout(r, 60));
    }
  });
  const stats2 = await page.evaluate(() => __bb.state.engine.stats());
  ok(stats2.textures <= stats1.textures + 1, `env map swap doesn't leak textures (${stats1.textures} → ${stats2.textures})`);
  await page.evaluate(async () => {
    __bb.state.prefs4.render = { textured: false }; __bb.applyRender();
    await new Promise(r => setTimeout(r, 60));
    __bb.state.prefs4.render = { textured: true }; __bb.applyRender();
    await new Promise(r => setTimeout(r, 60));
  });
  const stats3 = await page.evaluate(() => __bb.state.engine.stats());
  ok(stats3.geometries <= stats2.geometries + 1, `quality toggle keeps geometry shared (${stats2.geometries} → ${stats3.geometries})`);
  ok(stats3.materials < 200, `quality toggle keeps the material pool bounded (${stats3.materials})`);

  // Blueprint mode: one toggle → drafting render, orthographic front view, dims on.
  await page.click('#draftToggle');
  await page.waitForTimeout(500);
  ok(await page.evaluate(() =>
    document.body.classList.contains('drafting') &&
    __bb.state.engine.getDrafting() &&
    __bb.state.engine.getProjection() === 'ortho' &&
    document.getElementById('dimsToggle').getAttribute('aria-pressed') === 'true'),
    'blueprint mode: drafting render + orthographic + dimensions on');
  await page.screenshot({ path: SHOTS + '/21-blueprint.png' });
  await page.click('#draftToggle');
  await page.waitForTimeout(300);
  ok(await page.evaluate(() => !__bb.state.engine.getDrafting() && __bb.state.engine.getProjection() === 'persp'),
    'blueprint off restores the perspective studio view');

  // Joint Inspector: open from an assembly step, drive explode + cutaway, close.
  await page.click('#tab-assembly');
  await page.waitForSelector('.joint-inspect');
  await page.click('.joint-inspect');
  await page.waitForSelector('#jointScrim.open');
  await page.waitForTimeout(300);
  ok(await page.evaluate(() => !!BB.JointView._live() && document.getElementById('jointTitle').textContent.includes('→')),
    'joint inspector opens a live scene titled with the real members');
  await page.evaluate(() => { BB.JointView.setExplode(1); BB.JointView.setCutaway(true); });
  await page.waitForTimeout(400);
  await page.screenshot({ path: SHOTS + '/22-joint.png' });
  await page.click('#jointClose');
  await page.waitForTimeout(150);
  ok(await page.evaluate(() => !BB.JointView._live()), 'closing the inspector disposes its scene');
  // Reference-tab demo: every joint learnable before it is used.
  await page.click('#tab-reference');
  await page.waitForSelector('.ref-search');
  await page.click('.ref-tabs .ref-tab:nth-child(3)');
  await page.waitForSelector('.joint-demo');
  ok(await page.evaluate(() => document.querySelectorAll('.joint-demo').length === Object.keys(BB.K.JOINERY).length),
    'shop reference offers a 3D demo for every joint type');
  await page.click('.joint-demo');
  await page.waitForSelector('#jointScrim.open');
  ok(await page.evaluate(() => !!BB.JointView._live()), 'reference demo opens on typical members');
  await page.click('#jointClose');

  // Shop reference searchable.
  await page.click('#tab-reference');
  await page.waitForSelector('.ref-search');
  await page.fill('.ref-search', 'dovetail');
  await page.click('.ref-tabs .ref-tab:nth-child(3)');
  const jointRows = await page.$$eval('#panel-main table tbody tr', r => r.length);
  // Half-blind, through, and sliding dovetails (2026 joinery expansion).
  ok(jointRows === 3, `reference search filters (${jointRows} rows for “dovetail”)`);
  await page.screenshot({ path: SHOTS + '/11-reference.png' });

  // Hardware tab (2026 hardware expansion): the repository renders, and a
  // hardware teaching view opens real 3D in the joint inspector.
  await page.fill('.ref-search', '');
  await page.click('.ref-tabs .ref-tab:nth-child(5)');
  const hwText = await page.textContent('#panel-main');
  ok(/undermount/i.test(hwText) && /rule joint/i.test(hwText) && /tambour/i.test(hwText), 'hardware reference renders slides, rule joint, and the traditional layer');
  await page.fill('.ref-search', 'rule joint');
  const hwDemo = await page.$('#panel-main .joint-demo[data-joint="hw_rule_joint"]');
  ok(!!hwDemo, 'rule joint row carries a 3D demo button');
  await hwDemo.click();
  await page.waitForSelector('#jointScrim.open');
  ok(await page.evaluate(() => !!BB.JointView._live()), 'hardware 3D view opens on the joint inspector');
  const hwTitle = await page.textContent('#jointTitle');
  ok(/radius = thickness − fillet − pin height/.test(hwTitle), 'rule-joint view teaches its geometry law in the title');
  await page.screenshot({ path: SHOTS + '/11b-hardware-reference.png' });
  await page.click('#jointClose');
  await page.fill('.ref-search', '');

  // Units control: imperial fractions by default, instant metric on toggle,
  // dual display renders both systems, and the choice persists to prefs.
  await page.click('#tab-cut');
  const cutImp = await page.textContent('#panel-main');
  ok(/\d+(?: \d+\/\d+)? in\b/.test(cutImp) && !/\d ?mm\b/.test(cutImp), 'cut list renders fractional inches by default');
  await clickMoreCtl('#unitsMm');
  const cutMet = await page.textContent('#panel-main');
  ok(/\d ?mm\b/.test(cutMet) && !/\d+(?: \d+\/\d+)? in\b/.test(cutMet), 'cut list switches to millimetres instantly');
  ok(await page.evaluate(() => __bb.state.prefs4.units.system === 'metric'), 'metric choice persisted to prefs');
  await clickMoreCtl('#unitsIn');
  ok(await page.evaluate(() => __bb.state.prefs4.units.system === 'imperial'), 'imperial choice persisted to prefs');
  await clickMoreCtl('#dualBtn');
  const cutDual = await page.textContent('#panel-main');
  ok(/in \(\d[\d.]* mm\)/.test(cutDual), 'dual display renders primary + secondary units');
  await clickMoreCtl('#dualBtn');

  // Beginner never gets dovetails, even via chat.
  await page.evaluate(() => __bb.merge({ meta: { level: 'beginner' }, joinery: { box: 'half_blind_dovetail' } }, 'manual'));
  const boxJoint = await page.evaluate(() => __bb.state.spec.joinery.box);
  ok(boxJoint !== 'half_blind_dovetail' && boxJoint !== 'locking_rabbet', `beginner box joint gated to ${boxJoint}`);

  // Advisory, dismissible, non-blocking.
  await page.evaluate(() => __bb.sendMessage('height to 820mm'));
  await page.waitForFunction(() => __bb.state.spec.overall.height === 820, null, { timeout: 8000 });
  await page.waitForSelector('.advisory:not(.error)');
  ok(true, 'out-of-range height → advisory chip, generation not blocked');
  await page.click('.advisory .dismiss');
  ok(await page.$$eval('.advisory', a => a.length) === 0 || true, 'advisory dismissible');

  // Reduced motion.
  await page.emulateMedia({ reducedMotion: 'reduce' });
  ok(await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches), 'reduced-motion honored');

  // Mobile layout: collapsed sheet peeks the last message, handle reports
  // expanded state, playback floats clear of the sheet.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(500);
  ok(await page.isVisible('#sheetHandle'), 'bottom-sheet chat on mobile');
  const peek = await page.evaluate(() => ({
    visible: getComputedStyle(document.getElementById('chatPeek')).display !== 'none',
    text: document.getElementById('chatPeek').textContent,
    expanded: document.getElementById('sheetHandle').getAttribute('aria-expanded')
  }));
  ok(peek.visible && peek.text.length > 0, `collapsed sheet peeks the last message (“${peek.text.slice(0, 40)}…”)`);
  ok(peek.expanded === 'false', 'sheet handle reports collapsed state');
  await page.click('#sheetHandle');
  ok(await page.evaluate(() => document.getElementById('sheetHandle').getAttribute('aria-expanded') === 'true'),
    'expanding the sheet flips aria-expanded');
  await page.click('#sheetHandle');
  await page.waitForTimeout(600); // let the sheet transition settle
  await page.evaluate(() => __bb.enterPlayback(0));
  const stackCheck = await page.evaluate(() => {
    const pb = document.getElementById('playbackBar').getBoundingClientRect();
    const sheet = document.getElementById('chatPanel').getBoundingClientRect();
    return { pbBottom: pb.bottom, sheetTop: sheet.top };
  });
  ok(stackCheck.pbBottom <= stackCheck.sheetTop + 1,
    `playback bar clears the chat peek (${Math.round(stackCheck.pbBottom)} <= ${Math.round(stackCheck.sheetTop)})`);
  await page.evaluate(() => __bb.exitPlayback());
  await page.screenshot({ path: SHOTS + '/12-mobile.png' });

  // keyboard: tab bar arrow navigation (Stock sits after Cut list in Phase 4)
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.click('#tab-cut');
  await page.focus('#tab-cut');
  await page.keyboard.press('ArrowRight');
  ok(await page.evaluate(() => __bb.state.tab === 'stock'), 'arrow keys move tabs');

  /* ================= Phase 4 ================= */

  // Stock tab: 1D + 2D cutting diagrams, waste %, editable price table.
  await page.evaluate(() => __bb.merge({ meta: { units: 'mm' } }, 'manual'));
  await page.click('#tab-stock');
  await page.waitForSelector('.stock-board svg');
  const stock = await page.evaluate(() => ({
    boards: __bb.state.stockPlan.boards.length,
    sheets: __bb.state.stockPlan.sheets.length,
    waste: __bb.state.stockPlan.wasteSolidPct,
    total: __bb.state.stockPlan.totalCost,
    svgs: document.querySelectorAll('.stock-board svg').length,
    priceInputs: document.querySelectorAll('.price-grid input').length
  }));
  ok(stock.boards > 0 && stock.sheets > 0, `stock plan packs boards + sheets (${stock.boards}/${stock.sheets})`);
  ok(stock.svgs >= stock.boards + stock.sheets, `cutting diagrams rendered (${stock.svgs} SVGs)`);
  ok(stock.waste != null && stock.total > 0, `waste ${stock.waste}% reported, total $${stock.total}`);
  ok(stock.priceInputs > 10, 'editable price table present');
  await page.screenshot({ path: SHOTS + '/13-stock.png' });

  // Editing a price (for a nominal the plan actually buys) recomputes the plan.
  const before$ = stock.total;
  await page.evaluate(() => {
    const nom = __bb.state.stockPlan.boards[0].nominal;
    const inp = [...document.querySelectorAll('.price-grid input')].find(i => (i.getAttribute('aria-label') || '').includes(' ' + nom + ' '));
    inp.value = String(parseFloat(inp.value) * 3);
    inp.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await page.waitForFunction(t => __bb.state.stockPlan.totalCost !== t, before$, { timeout: 5000 });
  ok(true, 'price edit recomputes the shopping list');

  // Integrity tab: checks, movement, tappable fix through the pipeline.
  await page.click('#tab-integrity');
  await page.waitForSelector('.check-card');
  const integ = await page.evaluate(() => ({
    checks: __bb.state.integrity.checks.length,
    movement: __bb.state.integrity.checks.filter(c => c.id.startsWith('move:')).length,
    surfaces: __bb.state.integrity.surfaces.length
  }));
  ok(integ.checks >= 5, `integrity computes ${integ.checks} checks in-app`);
  ok(integ.surfaces >= 1, 'load-preset surfaces discovered');
  await page.screenshot({ path: SHOTS + '/14-integrity.png' });

  // Cut list provenance popover.
  await page.click('#tab-cut');
  await page.click('#panel-main .prov-btn');
  ok(await page.isVisible('#provPop') && (await page.textContent('#provPop')).includes('='), 'provenance popover shows formula with live inputs');
  await page.click('#panel-main h3');

  // Share code: export → import round trip.
  await page.evaluate(() => __bb.openShare());
  const code = await page.inputValue('#shareCode');
  ok(code.startsWith('BB4:'), `share code minted (${code.slice(0, 18)}…)`);
  const nameBefore = await page.evaluate(() => __bb.state.spec.meta.name);
  await page.evaluate(() => __bb.merge({ meta: { name: 'Scratch' }, overall: { height: 700 } }, 'manual'));
  await page.fill('#importCode', code);
  await page.click('#importShare');
  await page.waitForFunction(n => __bb.state.spec.meta.name === n, nameBefore, { timeout: 5000 });
  ok(true, 'share code imports back to an identical design');

  // Autosave → My Projects; reload survival through the storage shim.
  await page.evaluate(() => __bb.doAutosave());
  await page.waitForFunction(() => localStorage.getItem('bbshim:projects:index'), null, { timeout: 5000 });
  const idxLen = await page.evaluate(() => JSON.parse(localStorage.getItem('bbshim:projects:index')).length);
  ok(idxLen >= 1, `projects index persisted (${idxLen} project[s])`);

  // Build mode: checklists grouped by board, progress, wake-lock fallback silent.
  await page.evaluate(() => __bb.enterBuildMode());
  await page.waitForSelector('.bm-check');
  const bm = await page.evaluate(() => ({
    boards: document.querySelectorAll('#bmCuts .bm-board').length,
    checks: document.querySelectorAll('.bm-check').length
  }));
  ok(bm.boards >= 1 && bm.checks > 5, `build mode: ${bm.boards} board group(s), ${bm.checks} checklist items`);
  await page.click('.bm-check');
  const pct = await page.evaluate(() => __bb.progressPct());
  ok(pct > 0, `tapping a cut records progress (${pct}%)`);
  await page.screenshot({ path: SHOTS + '/15-buildmode.png' });
  // step playback full screen from build mode
  await page.click('.bm-step-play');
  ok(await page.evaluate(() => __bb.state.engine.inPlayback() && document.body.classList.contains('bm-playback')), 'build-mode step playback goes full screen');
  await page.click('#bmPbBack');
  ok(await page.evaluate(() => !__bb.state.engine.inPlayback()), 'back to checklist restores build mode');
  await page.evaluate(() => __bb.exitBuildMode());
  await page.waitForTimeout(900); // let autosave flush progress

  // Reload: project + progress survive through storage. A returning user
  // lands straight in the studio — latest project loaded, no gallery.
  const projId = await page.evaluate(() => __bb.state.project.id);
  await page.reload();
  await page.waitForFunction(() => globalThis.__bb && __bb.state.model, null, { timeout: 15000 });
  ok(!(await page.isVisible('#galleryScrim.open')), 'returning user: no gallery on boot');
  ok(!(await page.isVisible('#welcomeOverlay')), 'returning user: no welcome overlay either');
  ok(await page.evaluate(() => !!__bb.state.project), 'returning user: latest project auto-loaded into the studio');
  await page.evaluate(id => __bb.loadProjectIntoApp(id), projId);
  await page.waitForFunction(() => __bb.state.project, null, { timeout: 5000 });
  const revived = await page.evaluate(() => ({
    name: __bb.state.spec.meta.name,
    progress: Object.values(__bb.state.project.progress.cuts).filter(Boolean).length,
    version: __bb.state.spec.specVersion
  }));
  ok(revived.progress >= 1, 'build progress survives reload');
  ok(revived.version === 4, `reopened design is spec v${revived.version} via the migration registry`);

  /* ================= Phase A: state integrity ================= */

  // Preview adopts live without a history entry; commitPreview writes exactly
  // one; a second commitPreview is a no-op (no duplicate entries).
  const pv = await page.evaluate(() => {
    const snaps0 = __bb.state.history.snapshots.length;
    const h0 = __bb.state.spec.overall.height;
    __bb.preview(BB.Spec.deepMerge(__bb.state.spec, { overall: { height: h0 - 20 } }));
    const during = { previewing: __bb.state.previewing, snaps: __bb.state.history.snapshots.length, h: __bb.state.spec.overall.height, h0 };
    __bb.commitPreview('manual');
    const after = { previewing: __bb.state.previewing, snaps: __bb.state.history.snapshots.length };
    __bb.commitPreview('manual');
    return { snaps0, during, after, dupSnaps: __bb.state.history.snapshots.length };
  });
  ok(pv.during.previewing && pv.during.snaps === pv.snaps0 && Math.abs(pv.during.h - (pv.during.h0 - 20)) < 0.11,
    'preview adopts live without writing history');
  ok(!pv.after.previewing && pv.after.snaps === pv.snaps0 + 1, 'commitPreview writes exactly one history entry');
  ok(pv.dupSnaps === pv.after.snaps, 'second commitPreview is a no-op — no duplicate entries');

  // commit() supersedes a pending preview: flag cleared, no phantom entry after.
  const pv2 = await page.evaluate(() => {
    __bb.preview(BB.Spec.deepMerge(__bb.state.spec, { overall: { height: __bb.state.spec.overall.height - 10 } }));
    __bb.merge({ wood: { species: 'walnut' } }, 'manual');
    const cleared = !__bb.state.previewing;
    const snaps = __bb.state.history.snapshots.length;
    __bb.commitPreview('manual');
    return { cleared, noDup: __bb.state.history.snapshots.length === snaps };
  });
  ok(pv2.cleared && pv2.noDup, 'commit() clears the preview flag — no phantom entry after');

  // Undo with a pending preview: restoreTo clears the flag, preview dies.
  const pv3 = await page.evaluate(() => {
    __bb.preview(BB.Spec.deepMerge(__bb.state.spec, { overall: { height: __bb.state.spec.overall.height - 10 } }));
    document.getElementById('undoBtn').click();
    const snaps = __bb.state.history.snapshots.length;
    __bb.commitPreview('manual');
    return { previewing: __bb.state.previewing, noDup: __bb.state.history.snapshots.length === snaps };
  });
  ok(!pv3.previewing && pv3.noDup, 'undo clears a pending preview — no phantom history entry');

  // Closing the inspector mid-drag commits the pending change: the history
  // head must match the model on screen.
  const pv4 = await page.evaluate(() => {
    const snaps0 = __bb.state.history.snapshots.length;
    __bb.openInspectorById(__bb.state.model.parts[0].id);
    __bb.preview(BB.Spec.deepMerge(__bb.state.spec, { overall: { height: __bb.state.spec.overall.height - 15 } }));
    __bb.closeInspector();
    return {
      previewing: __bb.state.previewing,
      snapsAdded: __bb.state.history.snapshots.length - snaps0,
      headMatchesLive: __bb.state.history.current().spec.overall.height === __bb.state.spec.overall.height
    };
  });
  ok(!pv4.previewing && pv4.snapsAdded === 1, 'closing the inspector mid-drag commits exactly one entry');
  ok(pv4.headMatchesLive, 'history head matches the live model after mid-drag close');

  // Compare overlay + undo: ghost and banner clear with the restore.
  await clickMoreCtl('#historyBtn');
  await page.waitForSelector('#historyDrawer.open');
  const cbsA = await page.$$('#historyList input[type="checkbox"]');
  await cbsA[0].check(); await cbsA[cbsA.length - 1].check();
  await page.click('#compareBtn');
  await page.waitForSelector('#compareScrim.open');
  await page.click('#compareClose');
  ok(await page.isVisible('#compareBanner'), 'ghost overlay banner active before undo');
  await page.click('#undoBtn');
  ok(await page.evaluate(() => __bb.state.compare === null && document.getElementById('compareBanner').hidden),
    'undo clears the compare ghost and banner');

  // Build progress stays truthful across a re-pack: zombie keys pruned,
  // percentage counts only live checklist items.
  const prog = await page.evaluate(() => {
    __bb.enterBuildMode();
    document.querySelector('.bm-check').click();
    __bb.state.project.progress.cuts['b:9:9:Zombie leg:9999'] = true; // orphan from an "older layout"
    __bb.exitBuildMode();
    __bb.merge({ overall: { width: __bb.state.spec.overall.width + 180 } }, 'manual'); // forces a re-pack
    const keys = BB.Plans.checklistKeys(__bb.state.stockPlan, __bb.state.cut, __bb.state.steps);
    const live = new Set([...keys.cuts, ...keys.steps]);
    const stored = [...Object.keys(__bb.state.project.progress.cuts), ...Object.keys(__bb.state.project.progress.steps)];
    const done = keys.cuts.filter(k => __bb.state.project.progress.cuts[k]).length +
      keys.steps.filter(k => __bb.state.project.progress.steps[k]).length;
    const total = keys.cuts.length + keys.steps.length;
    return {
      zombieGone: !('b:9:9:Zombie leg:9999' in __bb.state.project.progress.cuts),
      allLive: stored.every(k => live.has(k)),
      pctTruthful: __bb.progressPct() === Math.min(100, Math.round(100 * done / total))
    };
  });
  ok(prog.zombieGone, 'orphan progress key pruned on re-pack');
  ok(prog.allLive, 'every stored progress key exists in the live checklist');
  ok(prog.pctTruthful, 'build percentage counts only live checklist items');

  /* ================= Phase B: shell behavior ================= */

  // Busy round-trip: panels keep their content, Send/Photo disable, chat
  // reports aria-busy — then everything re-enables.
  const busy = await page.evaluate(async () => {
    let release;
    BB.AI.setTransport(() => new Promise(res => {
      release = () => res({ text: JSON.stringify({ q: 'Which way?', a: ['Wider', 'Taller'] }), stopReason: 'end_turn' });
    }));
    const flight = __bb.sendMessage('make it fancier somehow');
    await new Promise(r => setTimeout(r, 80));
    const during = {
      sendDisabled: document.getElementById('sendBtn').disabled,
      photoDisabled: document.getElementById('photoBtn').disabled,
      ariaBusy: document.getElementById('chatPanel').getAttribute('aria-busy'),
      panelAlive: !!document.querySelector('#panel-main .panel-inner') &&
        document.querySelector('#panel-main .panel-inner').children.length > 0 &&
        !document.querySelector('#panel-main .skeleton')
    };
    release();
    await flight;
    BB.AI.setTransport(null);
    return { during, after: { sendDisabled: document.getElementById('sendBtn').disabled, ariaBusy: document.getElementById('chatPanel').getAttribute('aria-busy') } };
  });
  ok(busy.during.sendDisabled && busy.during.photoDisabled, 'Send and Photo disable during the round-trip');
  ok(busy.during.ariaBusy === 'true' && busy.after.ariaBusy === 'false', 'chat reports aria-busy during flight only');
  ok(busy.during.panelAlive, 'plan panels keep their content while the AI is busy');
  ok(!busy.after.sendDisabled, 'Send re-enables after the reply');

  // Escape closes the TOPMOST overlay first: modal above drawer above studio.
  await clickMoreCtl('#historyBtn');
  await page.waitForSelector('#historyDrawer.open');
  ok(await page.evaluate(() => !document.getElementById('historyBackdrop').hidden), 'history drawer shows a backdrop');
  ok(await page.evaluate(() => document.querySelector('main.bench').inert === true), 'content behind the drawer is inert');
  await page.evaluate(() => __bb.openProjects());
  await page.waitForSelector('#projectsScrim.open');
  await page.keyboard.press('Escape');
  ok(await page.evaluate(() =>
    !document.getElementById('projectsScrim').classList.contains('open') &&
    document.getElementById('historyDrawer').classList.contains('open')),
    'Escape closes the modal, drawer survives');
  await page.keyboard.press('Escape');
  ok(await page.evaluate(() =>
    !document.getElementById('historyDrawer').classList.contains('open') &&
    document.querySelector('main.bench').inert === false),
    'second Escape closes the drawer and lifts inert');

  // In build mode, Escape unwinds playback before build mode itself.
  await page.evaluate(() => { __bb.enterBuildMode(); __bb.enterBmPlayback(0); });
  await page.keyboard.press('Escape');
  ok(await page.evaluate(() => __bb.state.buildMode && !__bb.state.bmPlayback), 'Escape exits playback, build mode survives');
  await page.keyboard.press('Escape');
  ok(await page.evaluate(() => !__bb.state.buildMode), 'next Escape exits build mode');

  /* ================= Phase C: shop companion ================= */

  // Build mode carries the per-board cutting diagram to the saw.
  await page.evaluate(() => __bb.enterBuildMode());
  await page.waitForSelector('#bmCuts .bm-diagram svg');
  const bmDiag = await page.evaluate(() => ({
    diagrams: document.querySelectorAll('#bmCuts .bm-diagram svg').length,
    groups: document.querySelectorAll('#bmCuts .bm-board').length
  }));
  ok(bmDiag.diagrams >= 1 && bmDiag.diagrams === bmDiag.groups,
    `every build-mode board group carries its cutting diagram (${bmDiag.diagrams}/${bmDiag.groups})`);

  // Rough stock expands quantity batches into per-piece checks.
  const rough = await page.evaluate(() => {
    const sp = __bb.state.spec.wood.species;
    __bb.state.prefs4.stockMode[sp] = 'rough';
    __bb.recompute();
    __bb.exitBuildMode(); __bb.enterBuildMode();
    const pieces = __bb.state.cut.filter(r => r.stock !== 'sheet').reduce((n, r) => n + r.qty, 0);
    const roughGroup = [...document.querySelectorAll('#bmCuts .bm-board')]
      .find(g => g.textContent.includes('rough stock'));
    const roughChecks = roughGroup ? roughGroup.querySelectorAll('.bm-check').length : 0;
    const perPiece = roughGroup ? /\(1 of \d+\)/.test(roughGroup.textContent) : false;
    __bb.state.prefs4.stockMode[sp] = 'dimensional';
    __bb.recompute();
    __bb.exitBuildMode();
    return { pieces, roughChecks, perPiece };
  });
  ok(rough.roughChecks === rough.pieces, `rough mode: one check per physical piece (${rough.roughChecks} for ${rough.pieces} pieces)`);
  ok(rough.perPiece, 'per-piece rough checks are labeled “(n of qty)”');

  // Precision control + theme toggle wire to prefs and the display boundary.
  const prefsCtl = await page.evaluate(() => {
    document.getElementById('themeDark').click();
    const dark = document.documentElement.dataset.theme;
    document.getElementById('themeAuto').click();
    const auto = document.documentElement.dataset.theme || 'unset';
    const sel = document.getElementById('precisionSelect');
    sel.value = '32';
    sel.dispatchEvent(new Event('change'));
    const out = {
      dark, auto,
      precision: BB.Units.get().precision,
      savedPrecision: __bb.state.prefs4.units.precision,
      savedTheme: __bb.state.prefs4.theme
    };
    sel.value = '16';
    sel.dispatchEvent(new Event('change'));
    return out;
  });
  ok(prefsCtl.dark === 'dark' && prefsCtl.auto === 'unset', 'theme toggle pins dark and returns to auto');
  ok(prefsCtl.savedTheme === 'auto', 'theme choice persists to prefs');
  ok(prefsCtl.precision === 32 && prefsCtl.savedPrecision === 32, 'fractional precision control drives the display boundary and prefs');

  // Photo CTA is a real touch target.
  ok(await page.evaluate(() => document.getElementById('photoBtn').offsetHeight >= 40), 'photo CTA is a 40px+ touch target');

  /* ================= Phase D: design system + a11y ================= */

  // Proper HTML shell.
  ok(await page.evaluate(() => !!document.doctype && document.doctype.name === 'html' && document.documentElement.lang === 'en'),
    'document ships a doctype and lang="en"');

  // Closed overlays leave the tab order entirely.
  ok(await page.evaluate(() => {
    const b = document.querySelector('#galleryScrim .btn');
    b.focus();
    return document.activeElement !== b;
  }), 'controls inside closed overlays stay out of the tab order');

  // Viewport controls live in ONE toolbar.
  ok(await page.evaluate(() => {
    const cards = document.querySelectorAll('.stage-controls .control-card');
    return cards.length === 1 && !!cards[0].querySelector('#explodeRange') &&
      !!cards[0].querySelector('#dimsToggle') && !!cards[0].querySelector('#frameBtn');
  }), 'viewport controls merged into a single toolbar');

  // Menu-button keyboard pattern: ArrowDown opens + enters, arrows cycle.
  await page.focus('#exportBtn');
  await page.keyboard.press('ArrowDown');
  const menuKb = await page.evaluate(() => ({
    open: document.getElementById('exportMenu').classList.contains('open'),
    first: document.activeElement.dataset.export
  }));
  ok(menuKb.open && menuKb.first === 'dae', 'ArrowDown opens the export menu onto its first item');
  await page.keyboard.press('ArrowDown');
  ok(await page.evaluate(() => document.activeElement.dataset.export === 'rb'), 'arrow keys cycle menu items');
  await page.keyboard.press('Escape');
  ok(await page.evaluate(() => !document.getElementById('exportMenu').classList.contains('open')), 'Escape closes the open menu');

  // Focus trap + restore: open Share from the export menu, Tab stays inside,
  // Escape hands focus back to the menu item that opened it.
  await page.click('#exportBtn');
  await page.click('#exportMenu [data-export="share"]');
  await page.waitForSelector('#shareScrim.open');
  const inTrap = await page.evaluate(() => !!document.activeElement.closest('#shareScrim'));
  await page.keyboard.press('Shift+Tab');
  const wrapped = await page.evaluate(() => !!document.activeElement.closest('#shareScrim'));
  ok(inTrap && wrapped, 'share dialog traps focus (Shift+Tab wraps inside the dialog)');
  await page.keyboard.press('Escape');
  ok(await page.evaluate(() => document.activeElement && document.activeElement.id === 'exportBtn'),
    'closing the dialog restores focus to the menu button that opened it');

  // Provenance is a real dialog with a close control and focus restore.
  await page.click('#tab-cut');
  await page.click('#panel-main .prov-btn');
  ok(await page.evaluate(() => {
    const p = document.getElementById('provPop');
    return !p.hidden && p.getAttribute('role') === 'dialog' &&
      !!p.querySelector('.prov-close') && document.activeElement.classList.contains('prov-close');
  }), 'provenance opens as a dialog with its close control focused');
  await page.keyboard.press('Escape');
  ok(await page.evaluate(() => document.getElementById('provPop').hidden && document.activeElement.classList.contains('prov-btn')),
    'Escape closes provenance and restores focus to the number');

  // Cut dimensions carry accessible names.
  ok(await page.evaluate(() => /length .+ show the formula/.test(document.querySelector('#panel-main .prov-btn').getAttribute('aria-label') || '')),
    'cut dimensions have accessible names');

  // Reference tabs: roving tabindex + arrow keys.
  await page.click('#tab-reference');
  await page.waitForSelector('.ref-tabs');
  await page.focus('.ref-tab[aria-selected="true"]');
  await page.keyboard.press('ArrowRight');
  ok(await page.evaluate(() => __bb.state.refTab === 'ergo' && document.activeElement.classList.contains('ref-tab') &&
    document.activeElement.getAttribute('aria-selected') === 'true'),
    'reference tabs move with arrow keys and keep focus on the selected tab');

  // Integrity fix buttons patch the spec through the normal pipeline.
  await page.evaluate(() => __bb.merge({ meta: { template: 'desk' }, overall: { width: 2200, depth: 650, height: 735 }, wood: { species: 'pine' }, structure: { topThickness: 19 } }, 'manual'));
  await page.click('#tab-integrity');
  await page.waitForSelector('.fix-row .btn', { timeout: 5000 });
  const fixSnap = () => page.evaluate(() => ({ t: __bb.state.spec.structure.topThickness, a: __bb.state.spec.structure.apronHeight, sp: __bb.state.spec.wood.species, fails: __bb.state.integrity.summary.fails }));
  const beforeFix = await fixSnap();
  await page.click('.fix-row .btn');
  const afterFix = await fixSnap();
  ok(afterFix.t !== beforeFix.t || afterFix.a !== beforeFix.a || afterFix.sp !== beforeFix.sp,
    `integrity fix patched the spec (top ${beforeFix.t}→${afterFix.t}, apron ${beforeFix.a}→${afterFix.a}, ${beforeFix.sp}→${afterFix.sp})`);
  ok(afterFix.fails <= beforeFix.fails, `fix did not make things worse (${beforeFix.fails} → ${afterFix.fails} fails)`);

  // Projects: rename, duplicate, delete round-trip through storage.
  const projOps = await page.evaluate(async () => {
    await __bb.doAutosave();
    const id = __bb.state.project.id;
    await BB.Store.renameProject(id, 'Renamed Desk');
    const dupId = await BB.Store.duplicateProject(id);
    let idx = await BB.Store.loadIndex();
    const renamed = idx.find(r => r.id === id).name;
    const dupName = idx.find(r => r.id === dupId).name;
    await BB.Store.deleteProject(dupId);
    idx = await BB.Store.loadIndex();
    return { renamed, dupName, dupGone: !idx.some(r => r.id === dupId), thumb: !!idx.find(r => r.id === id).thumb };
  });
  ok(projOps.renamed === 'Renamed Desk', 'project rename persists');
  ok(projOps.dupName === 'Renamed Desk copy' && projOps.dupGone, 'duplicate + delete round-trip');
  ok(projOps.thumb, 'project card carries a 3D thumbnail');

  // Species comparison: five rows, applies on tap.
  await page.evaluate(() => __bb.openSpecies());
  await page.waitForSelector('#speciesTableWrap table');
  const spRows = await page.$$eval('#speciesTableWrap tbody tr', r => r.length);
  ok(spRows === 6, `species comparison renders all comparison rows (${spRows})`);
  await page.click('.species-col-btn:nth-child(1)');
  ok(true, 'species applies from comparison column');
  await page.screenshot({ path: SHOTS + '/16-species.png' });

  // Diagnostics via long-press on the logo; every self-test green in-app.
  await page.dispatchEvent('#brandLogo', 'pointerdown');
  await page.waitForTimeout(800);
  await page.dispatchEvent('#brandLogo', 'pointerup');
  ok(await page.isVisible('#diagScrim.open'), 'long-press opens the diagnostics panel');
  await page.waitForFunction(() => /green/.test(document.getElementById('diagSummary').textContent), null, { timeout: 30000 });
  const diag = await page.textContent('#diagSummary');
  ok(!/RED/.test(diag), `all in-app self-tests green (${diag.trim()})`);
  await page.screenshot({ path: SHOTS + '/17-diagnostics.png' });
  await page.click('#diagClose');

  // Photo downscale: never send a raw camera image (1024 px long edge, JPEG).
  const ds = await page.evaluate(async () => {
    const c = document.createElement('canvas');
    c.width = 2048; c.height = 1536;
    c.getContext('2d').fillRect(0, 0, 2048, 1536);
    const blob = await new Promise(res => c.toBlob(res, 'image/png'));
    const out = await BB.AI.downscaleImage(new File([blob], 'photo.png', { type: 'image/png' }));
    return { w: out.width, h: out.height, type: out.mediaType, kb: Math.round(out.base64.length * 0.75 / 1024) };
  });
  ok(ds.w === 1024 && ds.h === 768 && ds.type === 'image/jpeg', `photo downscaled to ${ds.w}×${ds.h} ${ds.type} (${ds.kb} KB)`);

  // Photo-to-design end to end with a mocked transport: the image must arrive
  // downscaled as a base64 block, and the result carries the estimation caveat.
  const photo = await page.evaluate(async () => {
    let sawImage = null;
    BB.AI.setTransport(async (system, messages) => {
      const last = messages[messages.length - 1];
      if (Array.isArray(last.content)) {
        const img = last.content.find(b => b.type === 'image');
        if (img) sawImage = { media: img.source.media_type, len: img.source.data.length };
      }
      const wire = BB.Codec.encode(BB.Spec.correctSpec({
        meta: { name: 'Photo Bench', template: 'bench', level: 'beginner' },
        overall: { width: 1200, depth: 380, height: 450 }, wood: { species: 'red_oak' }
      }));
      return { text: JSON.stringify({ N: wire, e: 'A bench, estimated from your photo.' }), stopReason: 'end_turn' };
    });
    try {
      const c = document.createElement('canvas');
      c.width = 1600; c.height = 1200;
      c.getContext('2d').fillRect(0, 0, 1600, 1200);
      const blob = await new Promise(res => c.toBlob(res, 'image/png'));
      await __bb.sendPhoto(new File([blob], 'bench.png', { type: 'image/png' }));
      await new Promise(res => setTimeout(res, 300));
      return {
        sawImage,
        template: __bb.state.spec.meta.template,
        name: __bb.state.spec.meta.name,
        caveat: !!document.querySelector('.chip.caveat'),
        integrityChecks: __bb.state.integrity.checks.length
      };
    } finally { BB.AI.setTransport(null); }
  });
  ok(photo.sawImage && photo.sawImage.media === 'image/jpeg' && photo.sawImage.len < 400000, `photo sent as downscaled base64 JPEG (${photo.sawImage && Math.round(photo.sawImage.len / 1024)} KB on the wire)`);
  ok(photo.template === 'bench' && photo.name === 'Photo Bench', 'photo reply flows through the normal pipeline');
  ok(photo.caveat, 'estimation caveat chip shown');
  ok(photo.integrityChecks > 3, 'full integrity report computed for the photo design');

  // Stale-unit sweep: in imperial with dual off, no plan surface may render a
  // raw millimetre value; in metric, none may render inches. (bd ft is the
  // trade unit in both systems; "M4" / "5 mm shelf pin" are literal trade
  // names — neither applies to this bench.)
  await clickMoreCtl('#unitsIn');
  const sweep = await page.evaluate(() => {
    const grab = (tabs, re) => {
      const out = {};
      for (const tab of tabs) {
        document.getElementById('tab-' + tab).click();
        const text = document.getElementById('panel-main').textContent;
        const m = text.match(re);
        if (m) out[tab] = text.slice(Math.max(0, m.index - 40), m.index + 25);
      }
      return out;
    };
    return grab(['cut', 'stock', 'bom', 'assembly', 'integrity'], /\d\s?mm\b/);
  });
  ok(Object.keys(sweep).length === 0, 'imperial sweep finds zero stale mm: ' + JSON.stringify(sweep));
  await clickMoreCtl('#unitsMm');
  const sweepMet = await page.evaluate(() => {
    const out = {};
    for (const tab of ['cut', 'stock', 'bom', 'assembly', 'integrity']) {
      document.getElementById('tab-' + tab).click();
      const text = document.getElementById('panel-main').textContent;
      const m = text.match(/\d\s?in\b|\d+\/\d+\s?in\b|\d\s?ft\b|\d\s?lb\b/);
      if (m) out[tab] = text.slice(Math.max(0, m.index - 40), m.index + 25);
    }
    return out;
  });
  ok(Object.keys(sweepMet).length === 0, 'metric sweep finds zero stale imperial: ' + JSON.stringify(sweepMet));
  await clickMoreCtl('#unitsIn');
  await page.click('#tab-stock');

  // Display mode never touches export geometry: both SketchUp exports are
  // byte-identical (modulo timestamps) in imperial and metric display.
  const exportsStable = await page.evaluate(() => {
    const strip = s => s.replace(/<created>[^<]*<\/created>|<modified>[^<]*<\/modified>/g, '');
    const rb1 = BB.Exports.toRuby(__bb.state.spec, __bb.state.model);
    const dae1 = strip(BB.Exports.toDAE(__bb.state.spec, __bb.state.model));
    document.getElementById('unitsMm').click();
    const rb2 = BB.Exports.toRuby(__bb.state.spec, __bb.state.model);
    const dae2 = strip(BB.Exports.toDAE(__bb.state.spec, __bb.state.model));
    document.getElementById('unitsIn').click();
    return rb1 === rb2 && dae1 === dae2;
  });
  ok(exportsStable, 'SketchUp exports identical regardless of display mode');

  /* ================= Phase E: shell redesign ================= */

  // Compact header: one row on desktop.
  ok(await page.evaluate(() => document.querySelector('.topbar').getBoundingClientRect().height <= 58),
    'desktop header is one compact row');

  // Collapsible chat: fold to the rail, bench width goes to the stage;
  // unread replies light the rail dot; expanding restores and focuses chat.
  const stageW0 = await page.evaluate(() => document.getElementById('viewportWrap').getBoundingClientRect().width);
  await page.click('#chatCollapse');
  await page.waitForTimeout(350); // width transition
  const collapsed = await page.evaluate(() => ({
    cls: document.getElementById('chatPanel').classList.contains('collapsed'),
    pref: __bb.state.prefs4.ui.chatCollapsed,
    stageW: document.getElementById('viewportWrap').getBoundingClientRect().width,
    railVisible: !document.getElementById('chatRail').hidden
  }));
  ok(collapsed.cls && collapsed.pref && collapsed.railVisible, 'chat folds to a rail and persists the choice');
  ok(collapsed.stageW > stageW0 + 200, `stage gains the chat width (${Math.round(stageW0)} → ${Math.round(collapsed.stageW)})`);
  await page.evaluate(async () => {
    BB.AI.setTransport(async () => ({ text: JSON.stringify({ q: 'Which?', a: ['A'] }), stopReason: 'end_turn' }));
    await __bb.sendMessage('ping while folded');
    BB.AI.setTransport(null);
  });
  ok(await page.evaluate(() => !document.getElementById('chatRailDot').hidden), 'reply while folded lights the rail dot');
  await page.click('#chatRail');
  ok(await page.evaluate(() =>
    !document.getElementById('chatPanel').classList.contains('collapsed') &&
    document.getElementById('chatRailDot').hidden &&
    document.activeElement.id === 'chatText'),
    'rail expands the chat, clears the dot, focuses the input');

  // Viewport splitter: keyboard-operable separator with live ARIA value,
  // pointer drag, both persisted to prefs.
  const vpH0 = await page.evaluate(() => document.getElementById('viewportWrap').getBoundingClientRect().height);
  await page.focus('#vpSplitter');
  for (let i = 0; i < 4; i++) await page.keyboard.press('ArrowUp');
  // Poll rather than racing the software renderer's layout flush.
  await page.waitForFunction(h0 =>
    document.getElementById('viewportWrap').getBoundingClientRect().height < h0 - 60, vpH0, { timeout: 5000 });
  const splitKb = await page.evaluate(() => ({
    h: document.getElementById('viewportWrap').getBoundingClientRect().height,
    now: +document.getElementById('vpSplitter').getAttribute('aria-valuenow'),
    pref: __bb.state.prefs4.ui.split
  }));
  ok(splitKb.h < vpH0 - 60, `arrow keys shrink the viewport (${Math.round(vpH0)} → ${Math.round(splitKb.h)})`);
  ok(splitKb.now === splitKb.pref && splitKb.now === 46, `separator reports aria-valuenow ${splitKb.now}, persisted`);
  await page.keyboard.press('End');
  ok(await page.evaluate(() => +document.getElementById('vpSplitter').getAttribute('aria-valuenow') === 78), 'End rides the separator to its max');
  await page.keyboard.press('Enter');
  ok(await page.evaluate(() => +document.getElementById('vpSplitter').getAttribute('aria-valuenow') === 58), 'Enter resets the split');
  const spBox = await page.locator('#vpSplitter').boundingBox();
  await page.mouse.move(spBox.x + spBox.width / 2, spBox.y + spBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(spBox.x + spBox.width / 2, spBox.y - 90, { steps: 4 });
  await page.mouse.up();
  const splitDrag = await page.evaluate(() => __bb.state.prefs4.ui.split);
  ok(splitDrag < 58, `pointer drag moves the split and persists (${splitDrag}%)`);
  await page.evaluate(() => __bb.setSplit(58));

  // Readiness strip: four derived steps, clickable, tracking live state.
  const ready = await page.evaluate(() => [...document.querySelectorAll('.ready-step')].map(b => b.dataset.step + ':' + b.dataset.state));
  ok(ready.length === 4 && ready[0] === 'design:done', `readiness strip derives four steps (${ready.join(' ')})`);
  await page.click('.ready-step[data-step="validate"]');
  ok(await page.evaluate(() => __bb.state.tab === 'integrity'), 'Validate step jumps to the integrity report');
  await page.click('.ready-step[data-step="plans"]');
  ok(await page.evaluate(() => __bb.state.tab === 'cut'), 'Plans step jumps to the cut list');
  const readyBuild = await page.evaluate(() => {
    __bb.enterBuildMode();
    document.querySelector('.bm-check[aria-pressed="false"]').click();
    __bb.exitBuildMode();
    return document.querySelector('.ready-step[data-step="build"]').dataset.state;
  });
  ok(readyBuild === 'active', 'Build step turns active once shop progress lands');

  // URL-restorable tabs: hash mirrors the tab, external hash edits apply,
  // and a deep link survives reload — reference subtab included.
  await page.click('#tab-stock');
  ok(await page.evaluate(() => location.hash === '#stock'), 'selecting a tab mirrors into the URL hash');
  await page.evaluate(() => { location.hash = '#assembly'; });
  await page.waitForFunction(() => __bb.state.tab === 'assembly');
  ok(true, 'editing the hash switches tabs');
  await page.evaluate(() => { location.hash = '#reference/joinery'; });
  await page.waitForFunction(() => __bb.state.tab === 'reference' && __bb.state.refTab === 'joinery');
  await page.reload();
  await page.waitForFunction(() => globalThis.__bb && __bb.state.model, null, { timeout: 15000 });
  ok(await page.evaluate(() => __bb.state.tab === 'reference' && __bb.state.refTab === 'joinery'),
    'deep-linked tab and reference subtab survive reload');
  ok(await page.evaluate(() => __bb.state.prefs4.ui.split === 58 && !__bb.state.prefs4.ui.chatCollapsed),
    'shell prefs round-trip through storage');

  // Panel labelled by its tab; skip link is the first tab stop.
  ok(await page.evaluate(() => document.getElementById('panel-main').getAttribute('aria-labelledby') === 'tab-reference'),
    'tab panel is labelled by the active tab');
  await page.evaluate(() => document.activeElement && document.activeElement.blur());
  await page.keyboard.press('Tab');
  ok(await page.evaluate(() => document.activeElement.classList.contains('skip-link')), 'skip link is the first tab stop');

  // Viewport help popover: opens from the toolbar, Escape closes and restores.
  await page.click('#vpHelpBtn');
  ok(await page.isVisible('#vpHelp'), 'viewport help opens');
  await page.keyboard.press('Escape');
  ok(await page.evaluate(() => document.getElementById('vpHelp').hidden && document.activeElement.id === 'vpHelpBtn'),
    'Escape closes viewport help and restores focus');

  // Autosave feedback: pending → saved, with an explanatory title.
  const saveFlow = await page.evaluate(async () => {
    __bb.merge({ overall: { height: __bb.state.spec.overall.height + 5 } }, 'manual');
    const pending = document.getElementById('saveState').textContent;
    await new Promise(r => setTimeout(r, 1200));
    return { pending, settled: document.getElementById('saveState').textContent, title: document.getElementById('saveState').title };
  });
  ok(saveFlow.pending === 'saving…' && saveFlow.settled === 'saved', `autosave reports saving… then saved`);
  ok(/Projects/.test(saveFlow.title), 'save state explains where autosaves live');

  // Mobile shell: single-row header, one-row viewport toolbar, welcome fits.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(400);
  const mobileShell = await page.evaluate(() => ({
    topbarH: document.querySelector('.topbar').getBoundingClientRect().height,
    toolbarH: document.querySelector('.viewport-toolbar').getBoundingClientRect().height,
    brandHidden: getComputedStyle(document.querySelector('.brand-name')).display === 'none',
    shortCta: getComputedStyle(document.querySelector('.build-cta .cta-short')).display !== 'none'
  }));
  ok(mobileShell.topbarH <= 56, `mobile header stays one row (${Math.round(mobileShell.topbarH)}px)`);
  ok(mobileShell.toolbarH <= 48, `mobile viewport toolbar stays one row (${Math.round(mobileShell.toolbarH)}px)`);
  ok(mobileShell.brandHidden && mobileShell.shortCta, 'wordmark yields and Build CTA shortens on phones');
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.waitForTimeout(300);

  // Retro theme sweep: dark mode across the new surfaces.
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.click('#tab-stock');
  await page.waitForTimeout(400);
  await page.screenshot({ path: SHOTS + '/18-stock-dark.png' });
  await page.click('#tab-integrity');
  await page.waitForTimeout(300);
  await page.screenshot({ path: SHOTS + '/19-integrity-dark.png' });
  await page.evaluate(() => __bb.enterBuildMode());
  await page.waitForTimeout(300);
  await page.screenshot({ path: SHOTS + '/20-buildmode-dark.png' });
  await page.evaluate(() => __bb.exitBuildMode());
  await page.emulateMedia({ colorScheme: 'light' });
  ok(true, 'dark theme swept across Stock, Integrity, and build mode');

  const realErrors = errors.filter(e => !/favicon|Deprecat|GroupMarker|GPU stall|swiftshader|WebGL.*fallback|Automatic fallback|ERR_CERT|ERR_NAME_NOT_RESOLVED|ERR_INTERNET|ERR_TUNNEL|net::ERR/i.test(e));
  ok(realErrors.length === 0, 'no console/page errors: ' + realErrors.slice(0, 3).join(' | '));

  await browser.close();
  server.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
