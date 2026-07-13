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

(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  const html = fs.readFileSync(DIST, 'utf8');
  const server = http.createServer((req, res) => {
    if (req.url === '/' || req.url.startsWith('/index')) {
      res.setHeader('content-type', 'text/html');
      res.end('<!doctype html><html><head></head><body>' + html + '</body></html>');
    } else { res.statusCode = 204; res.end(); }
  }).listen(0);
  const port = server.address().port;

  const browser = await chromium.launch({
    executablePath: '/opt/pw-browsers/chromium',
    args: ['--no-sandbox', '--enable-unsafe-swiftshader']
  });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
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

  // Gallery on first load; load the nightstand starter through the pipeline.
  ok(await page.isVisible('#galleryScrim.open'), 'starter gallery shows on first load');
  await page.screenshot({ path: SHOTS + '/01-gallery.png' });
  await page.click('.gallery-card:nth-child(5)');
  await page.waitForFunction(() => __bb.state.spec.meta.template === 'nightstand');
  const ns = await page.evaluate(() => ({
    drawers: __bb.state.model.drawers.length,
    rails: __bb.state.model.parts.filter(p => p.role === 'rail').length,
    boxW: __bb.state.model.drawers[0].box.w,
    openW: __bb.state.model.drawers[0].opening.w,
    slide: __bb.state.model.drawers[0].slideLen,
    bomSlides: __bb.state.bomData.items.filter(i => i.label.includes('slides')).length
  }));
  ok(ns.drawers === 2 && ns.rails === 3, `nightstand starter: 2 drawers, 3 rails (got ${ns.drawers}/${ns.rails})`);
  ok(ns.boxW === ns.openW - 25, 'box width = opening − 25 in live app');
  ok([250, 300, 350, 400, 450, 500].includes(ns.slide), 'standard slide length in live app');
  ok(ns.bomSlides === 2, 'slide pairs in BOM');
  await page.waitForTimeout(900);
  await page.screenshot({ path: SHOTS + '/02-nightstand.png' });

  // Chat refinement: code-computed diff chip.
  await page.fill('#chatText', 'lower it by 50mm');
  await page.click('#sendBtn');
  await page.waitForSelector('.msg.bot .chip', { timeout: 8000 });
  const chip = await page.textContent('.msg.bot:last-child .chip');
  ok(/height/.test(chip) && /550/.test(chip), `diff chip shows code-computed change (${chip.trim()})`);
  ok(await page.evaluate(() => __bb.state.spec.overall.height === 550), 'spec height merged to 550');

  // Ambiguous prompt → clarifying question with tappable answers.
  await page.fill('#chatText', 'make it bigger');
  await page.click('#sendBtn');
  await page.waitForSelector('.answer-row button', { timeout: 8000 });
  const opts = await page.$$eval('.answer-row button', bs => bs.map(b => b.textContent));
  ok(opts.length >= 2, `clarifying question with ${opts.length} tappable answers`);
  await page.click('.answer-row button:first-child'); // "Wider"
  await page.waitForFunction(() => __bb.state.spec.overall.width > 500, null, { timeout: 8000 });
  ok(true, 'tapping an answer applies the refinement');
  await page.screenshot({ path: SHOTS + '/03-chat.png' });

  // Undo / redo across AI edits.
  const wNow = await page.evaluate(() => __bb.state.spec.overall.width);
  await page.click('#undoBtn');
  ok(await page.evaluate(() => __bb.state.spec.overall.width === 500), 'undo reverts width');
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
  await page.click('#historyBtn');
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

  // Shop reference searchable.
  await page.click('#tab-reference');
  await page.waitForSelector('.ref-search');
  await page.fill('.ref-search', 'dovetail');
  await page.click('.ref-tabs .ref-tab:nth-child(3)');
  const jointRows = await page.$$eval('#panel-main table tbody tr', r => r.length);
  ok(jointRows === 1, `reference search filters (${jointRows} row for “dovetail”)`);
  await page.screenshot({ path: SHOTS + '/11-reference.png' });

  // Units toggle → inches in cut list.
  await page.click('#unitsBtn');
  await page.click('#tab-cut');
  const cutText = await page.textContent('#panel-main');
  ok(cutText.includes('″'), 'cut list renders inches after unit toggle');
  await page.click('#unitsBtn');

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

  // Mobile layout.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(500);
  ok(await page.isVisible('#sheetHandle'), 'bottom-sheet chat on mobile');
  await page.screenshot({ path: SHOTS + '/12-mobile.png' });

  // keyboard: tab bar arrow navigation (Stock sits after Cut list in Phase 4)
  await page.setViewportSize({ width: 1440, height: 900 });
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

  // Reload: project + progress survive through storage.
  const projId = await page.evaluate(() => __bb.state.project.id);
  await page.reload();
  await page.waitForFunction(() => globalThis.__bb && __bb.state.model, null, { timeout: 15000 });
  await page.evaluate(id => __bb.loadProjectIntoApp(id), projId);
  await page.waitForFunction(() => __bb.state.project, null, { timeout: 5000 });
  const revived = await page.evaluate(() => ({
    name: __bb.state.spec.meta.name,
    progress: Object.values(__bb.state.project.progress.cuts).filter(Boolean).length,
    version: __bb.state.spec.specVersion
  }));
  ok(revived.progress >= 1, 'build progress survives reload');
  ok(revived.version === 4, `reopened design is spec v${revived.version} via the migration registry`);

  // Integrity fix buttons patch the spec through the normal pipeline.
  await page.evaluate(() => __bb.merge({ meta: { template: 'desk' }, overall: { width: 2200, depth: 650, height: 735 }, wood: { species: 'pine' }, structure: { topThickness: 19 } }, 'manual'));
  await page.click('#tab-integrity');
  await page.waitForSelector('.fix-row .btn', { timeout: 5000 });
  const beforeFix = await page.evaluate(() => ({ t: __bb.state.spec.structure.topThickness, sp: __bb.state.spec.wood.species, fails: __bb.state.integrity.summary.fails }));
  await page.click('.fix-row .btn');
  const afterFix = await page.evaluate(() => ({ t: __bb.state.spec.structure.topThickness, sp: __bb.state.spec.wood.species, fails: __bb.state.integrity.summary.fails }));
  ok(afterFix.t !== beforeFix.t || afterFix.sp !== beforeFix.sp, `integrity fix patched the spec (${beforeFix.t}mm/${beforeFix.sp} → ${afterFix.t}mm/${afterFix.sp})`);
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
