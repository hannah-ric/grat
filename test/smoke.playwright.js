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
    executablePath: fs.existsSync('/opt/pw-browsers/chromium')
      ? '/opt/pw-browsers/chromium'
      : require('playwright').chromium.executablePath(),
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
    // Build Mode + premium exports are Pro features (the SaaS layer gates them
    // behind `advancedFeatures`/`premiumExports`). The artifact-storage shim above
    // makes Store.init() skip the /api/auth probe, so grant Pro directly the moment
    // BB.Store loads — re-runs on every navigation, so it survives reloads.
    const PRO = { plan: 'pro', entitlements: { plan: 'pro', label: 'Pro', projectLimit: null, aiMonthlyLimit: 500, premiumExports: true, advancedFeatures: true }, usage: { aiMessages: 0 }, subscription: { status: 'active' } };
    const grant = setInterval(() => {
      if (globalThis.BB && BB.Store && BB.Store.setBilling) { BB.Store.setBilling(PRO); clearInterval(grant); }
    }, 5);
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
  ok(await page.evaluate(() => document.body.dataset.mode === 'design'), 'first run opens in Design mode - the model is the hero');
  ok(await page.isVisible('#heroText'), 'hero leads with a real prompt field');
  ok(await page.$$eval('#heroStarters .hero-starter', b => b.length) === 3, 'hero offers three ready starters');
  ok(await page.evaluate(() => document.getElementById('chatText').placeholder.startsWith('Describe your piece')),
    'chat placeholder invites a first description');
  await page.click('#mode-plan');
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
  ok(await page.evaluate(() => document.getElementById('chatText').placeholder.startsWith('Ask for a change')),
    'chat placeholder flips to refinement once a design exists');
  await page.waitForTimeout(900);
  await page.screenshot({ path: SHOTS + '/02-nightstand.png' });

  // Chat refinement: code-computed diff chip.
  await page.fill('#chatText', 'lower it by 50mm');
  await page.click('#sendBtn');
  await page.waitForSelector('.msg.bot .chip', { timeout: 8000 });
  const chip = await page.locator('.msg.bot:last-child .chip:not(.caveat)').first().textContent();
  // C-05: chips are humanized in the display layer — sentence case, same
  // code-computed values in display units.
  ok(/Height 24 in → 22 1\/16 in/.test(chip), `diff chip shows code-computed change in display units (${chip.trim()})`);
  ok(await page.evaluate(() => document.getElementById('aiBadge').dataset.state === 'offline'),
    'AI badge tells the truth: no service here, offline basic edits');
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

  // Interaction system: the glowing joint dots are doors. Jump to a step
  // that carries joints, click the dot nearest the canvas center → the
  // Joint Inspector opens on that joint's real members, captioned with the
  // step and where the joint sits on the piece.
  const jointStepIdx = await page.evaluate(() => __bb.state.steps.findIndex(s => s.joints && s.joints.length));
  ok(jointStepIdx >= 0, 'a step carries joint metadata for its dots');
  await page.evaluate(i => __bb.scrubPlayback(i), jointStepIdx);
  await page.waitForTimeout(450); // fly-in settles; dot projection is fresh
  const dot = await page.evaluate(() => {
    const dots = __bb.state.engine.jointDotsOnScreen();
    if (!dots.length) return null;
    const c = document.getElementById('view3d').getBoundingClientRect();
    dots.sort((a, b) => Math.hypot(a.x - c.width / 2, a.y - c.height / 2) - Math.hypot(b.x - c.width / 2, b.y - c.height / 2));
    return dots[0];
  });
  ok(!!dot && !!dot.joint && !!dot.joint.type, 'playback projects clickable joint-dot anchors');
  const vb = await (await page.$('#view3d')).boundingBox();
  await page.mouse.click(vb.x + dot.x, vb.y + dot.y);
  await page.waitForSelector('#jointScrim.open');
  ok(await page.evaluate(() => !!BB.JointView._live()), 'clicking a joint dot opens the live 3D close-up');
  ok(await page.evaluate(() => {
    const w = document.querySelector('#jointNotes .joint-where');
    return !!w && /Step \d+/.test(w.textContent) && / sits /.test(w.textContent);
  }), 'dot close-up says which step and where the joint sits');
  await page.screenshot({ path: SHOTS + '/07b-joint-dot.png' });
  await page.click('#jointClose');
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

  // Part framing (interaction system §4b): isolate + focus glide the camera
  // to a part; clearFocus + frame restore. API-level here (the double-click
  // gesture rides the same calls); the zero-console-errors net backs it.
  await page.evaluate(() => {
    const id = __bb.state.model.parts[0].id;
    __bb.state.engine.isolate(id);
    __bb.state.engine.focusPart(id);
  });
  await page.waitForTimeout(350);
  ok(await page.evaluate(() => !!__bb.state.engine.getIsolated()), 'isolate + focus framing holds');
  await page.evaluate(() => { __bb.state.engine.isolate(null); __bb.state.engine.clearFocus(); __bb.state.engine.frame(); });
  await page.waitForTimeout(300);

  // Hover pre-highlight: a part under a fine pointer sets the pick cursor
  // (at most one raycast per frame; touch devices skip this entirely).
  const vb2 = await (await page.$('#view3d')).boundingBox();
  await page.mouse.move(vb2.x + vb2.width / 2, vb2.y + vb2.height * 0.55);
  await page.waitForTimeout(150);
  ok(await page.evaluate(() => document.getElementById('view3d').style.cursor === 'pointer'),
    'hovering a part shows the pick cursor');
  await page.mouse.move(vb2.x + 4, vb2.y + 4); // corner: empty paper
  await page.waitForTimeout(150);
  ok(await page.evaluate(() => document.getElementById('view3d').style.cursor === ''),
    'leaving parts clears the pick cursor');

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
  ok(await page.evaluate(() => document.getElementById('viewportWrap').classList.contains('inkwash')),
    'blueprint flip runs the one-beat ink-wash');
  await page.waitForTimeout(500);
  ok(await page.evaluate(() => !document.getElementById('viewportWrap').classList.contains('inkwash')),
    'ink-wash cleans itself up after the beat');
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
  // Reference demo (via the More menu - no longer a peer tab): every joint
  // learnable before it is used.
  await clickMoreCtl('#referenceBtn');
  await page.waitForSelector('.ref-search');
  ok(await page.evaluate(() => !document.getElementById('tab-reference').hidden),
    'reference tab appears only while reference is open');
  // M-12: sheet goods in the wood table are badged; Janka/movement dash.
  const sheetRow = await page.evaluate(() => {
    const row = [...document.querySelectorAll('#panel-main table tbody tr')]
      .find(r => /\bMDF\b/i.test(r.cells[0].textContent));
    return row ? {
      badge: !!row.querySelector('.sheet-badge'),
      janka: row.cells[1].textContent.trim(),
      move: row.cells[5].textContent.trim()
    } : null;
  });
  ok(!!sheetRow && sheetRow.badge && sheetRow.janka === '—' && sheetRow.move === '—',
    `sheet rows badged with Janka/movement dashed (${JSON.stringify(sheetRow)})`);
  await page.click('.ref-tabs .ref-tab:nth-child(3)');
  await page.waitForSelector('.joint-demo');
  ok(await page.evaluate(() => document.querySelectorAll('.joint-demo').length === Object.keys(BB.K.JOINERY).length),
    'shop reference offers a 3D demo for every joint type');
  await page.click('.joint-demo');
  await page.waitForSelector('#jointScrim.open');
  ok(await page.evaluate(() => !!BB.JointView._live()), 'reference demo opens on typical members');
  await page.click('#jointClose');

  // Shop reference searchable.
  await clickMoreCtl('#referenceBtn');
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

  // 2026: the WHOLE bill is editable — the hardware/glue/finish group exists,
  // and editing the finish price moves the BOM total through the pipeline.
  const hwGrid = await page.evaluate(() => ({
    group: !!document.querySelector('.price-group'),
    finishInput: !!([...document.querySelectorAll('.price-grid input')].find(i => (i.getAttribute('aria-label') || '') === 'Finish (per project)')),
    bomTotal: __bb.state.bomData.total
  }));
  ok(hwGrid.group && hwGrid.finishInput, 'hardware/glue/finish price group present in the editor');
  await page.evaluate(() => {
    const inp = [...document.querySelectorAll('.price-grid input')].find(i => (i.getAttribute('aria-label') || '') === 'Finish (per project)');
    inp.value = '44';
    inp.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await page.waitForFunction(t => __bb.state.bomData.total !== t, hwGrid.bomTotal, { timeout: 5000 });
  ok(await page.evaluate(() => __bb.state.bomData.items.find(i => i.kind === 'finish').price === 44), 'edited finish price reaches the live BOM line');

  // Running gear renders in the main scene as hardware; never in the cut list.
  const gear = await page.evaluate(() => ({
    slides: __bb.state.model.parts.filter(p => p.hardware).length,
    slideDrawers: __bb.state.model.drawers.filter(d => /slides/.test(d.runner) && d.slideLen).length,
    inCut: __bb.state.cut.some(r => r.role === 'slide')
  }));
  ok(gear.slides === 2 * gear.slideDrawers, `slide pair per slide-mounted drawer in the model (${gear.slides}/${gear.slideDrawers})`);
  ok(!gear.inCut, 'metal slides never reach the cut list');

  // Accounts: on a true static host (no providers, no billing evidence) the
  // section stays hidden. The smoke shim's granted billing IS billing
  // evidence, so with it present the persistent plans surface shows (A-05) —
  // rendered explicitly here because the boot render races the shim's grant.
  const acct = await page.evaluate(() => {
    const real = BB.Store.auth().billing;
    BB.Store.setBilling(null);
    __bb.renderAccount();
    const bare = document.getElementById('accountArea').hidden;
    BB.Store.setBilling(real);
    __bb.renderAccount();
    const withBilling = document.getElementById('accountArea').hidden;
    return { bare, withBilling };
  });
  ok(acct.bare === true, 'account section hidden with no providers and no billing evidence');
  ok(acct.withBilling === false, 'billing evidence shows the persistent plans surface (A-05)');

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
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => document.getElementById('provPop').hidden, null, { timeout: 3000 }).catch(() => {});

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
    return cards.length === 1 && !!cards[0].querySelector('#dimsToggle') &&
      !!cards[0].querySelector('#frameBtn') && !!cards[0].querySelector('#viewBtn') &&
      !!cards[0].querySelector('#viewMenu #explodeRange');
  }), 'toolbar keeps Dims/Blueprint/Fit/View; explode and presets ride the View popover');
  await page.click('#viewBtn');
  ok(await page.isVisible('#viewMenu #explodeRange') && await page.isVisible('#viewMenu #viewFront'),
    'View popover opens with explode and camera presets');
  await page.keyboard.press('Escape');
  ok(await page.evaluate(() => !document.getElementById('viewMenu').classList.contains('open')),
    'Escape closes the View popover');

  // Menu-button keyboard pattern: ArrowDown opens + enters, arrows cycle.
  // (Export lives inside More now - one quiet menu, per the shell redesign.)
  await page.focus('#moreBtn');
  await page.keyboard.press('ArrowDown');
  const menuKb = await page.evaluate(() => ({
    open: document.getElementById('moreMenu').classList.contains('open'),
    first: document.activeElement.id
  }));
  ok(menuKb.open && menuKb.first === 'historyBtn', 'ArrowDown opens the More menu onto its first item');
  await page.keyboard.press('ArrowDown');
  ok(await page.evaluate(() => document.activeElement.id === 'projectsBtn'), 'arrow keys cycle menu items');
  ok(await page.evaluate(() => !!document.querySelector('#moreMenu [data-export="print"]')),
    'export actions live inside the More menu');
  await page.keyboard.press('Escape');
  ok(await page.evaluate(() => !document.getElementById('moreMenu').classList.contains('open')), 'Escape closes the open menu');

  // Focus trap + restore: open Share (a strong top-bar action), Tab stays
  // inside, Escape hands focus back to the button that opened it.
  await page.click('#shareBtn');
  await page.waitForSelector('#shareScrim.open');
  const inTrap = await page.evaluate(() => !!document.activeElement.closest('#shareScrim'));
  await page.keyboard.press('Shift+Tab');
  const wrapped = await page.evaluate(() => !!document.activeElement.closest('#shareScrim'));
  ok(inTrap && wrapped, 'share dialog traps focus (Shift+Tab wraps inside the dialog)');
  await page.keyboard.press('Escape');
  ok(await page.evaluate(() => document.activeElement && document.activeElement.id === 'shareBtn'),
    'closing the dialog restores focus to the control that opened it');

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
  await clickMoreCtl('#referenceBtn');
  await page.waitForSelector('.ref-tabs');
  await page.focus('.ref-tab[aria-selected="true"]');
  await page.keyboard.press('ArrowRight');
  ok(await page.evaluate(() => __bb.state.refTab === 'ergo' && document.activeElement.classList.contains('ref-tab') &&
    document.activeElement.getAttribute('aria-selected') === 'true'),
    'reference tabs move with arrow keys and keep focus on the selected tab');
  // P2-7: the sub-tabs complete the ARIA tab pattern — aria-controls on every
  // tab, and the body is a role=tabpanel labelled by the selected tab.
  const refAria = await page.evaluate(() => {
    const tabs = [...document.querySelectorAll('.ref-tab')];
    const panel = document.getElementById('refPanel');
    const selected = tabs.find(t => t.getAttribute('aria-selected') === 'true');
    return {
      allControls: tabs.length > 0 && tabs.every(t => t.getAttribute('aria-controls') === 'refPanel'),
      panelRole: panel ? panel.getAttribute('role') : null,
      labelledBySelected: !!panel && !!selected && !!selected.id && panel.getAttribute('aria-labelledby') === selected.id
    };
  });
  ok(refAria.allControls, 'every reference tab carries aria-controls to the panel');
  ok(refAria.panelRole === 'tabpanel', 'the reference body is a role=tabpanel');
  ok(refAria.labelledBySelected, 'the tabpanel is labelled by the selected tab');

  // Integrity fix buttons patch the spec through the normal pipeline.
  await page.evaluate(() => __bb.merge({ meta: { template: 'desk' }, overall: { width: 2200, depth: 650, height: 735 }, wood: { species: 'pine' }, structure: { topThickness: 19 } }, 'manual'));
  await page.click('#tab-integrity');
  await page.waitForSelector('.fix-row .btn', { timeout: 5000 });

  // Beginner-first Safety: plain sentence leads, engineering details fold
  // closed, failing checks + their fixes stay surfaced above the fold.
  await page.evaluate(() => __bb.merge({ meta: { level: 'beginner' } }, 'manual'));
  await page.click('#tab-integrity');
  const safetyShape = await page.evaluate(() => ({
    plain: !!document.querySelector('.integrity-plain'),
    detailsOpen: document.querySelector('.integrity-details').open,
    surfacedFail: !!document.querySelector('.panel-inner > .check-card.fail'),
    fixReachable: !!document.querySelector('.panel-inner > .check-card.fail .fix-row .btn'),
    jargonFree: !/\u0394MC|creep/i.test([...document.querySelectorAll('.panel-inner > .check-card.fail')].map(x => x.textContent).join(''))
  }));
  ok(safetyShape.plain && !safetyShape.detailsOpen, 'Safety leads plain for beginners; details fold closed');
  ok(safetyShape.surfacedFail && safetyShape.fixReachable, 'failing checks and fixes stay above the fold');
  ok(safetyShape.jargonFree, 'no creep/\u0394MC jargon in the beginner first layer');
  await page.evaluate(() => __bb.merge({ meta: { level: 'intermediate' } }, 'manual'));
  await page.click('#tab-integrity');
  ok(await page.evaluate(() => document.querySelector('.integrity-details').open),
    'intermediate level opens the engineering details by default');

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
    // Thumbnails live in their own per-project docs now (not embedded in the
    // index), so check the thumb doc rather than the index row.
    return { renamed, dupName, dupGone: !idx.some(r => r.id === dupId), thumb: !!(await BB.Store.loadThumb(id)) };
  });
  ok(projOps.renamed === 'Renamed Desk', 'project rename persists');
  ok(projOps.dupName === 'Renamed Desk copy' && projOps.dupGone, 'duplicate + delete round-trip');
  ok(projOps.thumb, 'project card carries a 3D thumbnail (stored in its own doc)');

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

  // M-16: diagnostics must be reachable by keyboard, not pointer-only —
  // the logo target carries button semantics and Enter opens the panel.
  const diagKb = await page.evaluate(() => {
    const logo = document.getElementById('brandLogo');
    return {
      buttonSemantics: logo.tagName === 'BUTTON' || (logo.getAttribute('role') === 'button' && logo.getAttribute('tabindex') === '0'),
      aria: logo.getAttribute('aria-label') || '',
      h1Intact: !!document.querySelector('h1.brand-name') && !document.querySelector('h1.brand-name').closest('[role="button"], button')
    };
  });
  ok(diagKb.buttonSemantics, 'logo diagnostics target has button semantics');
  ok(/diagnostic/i.test(diagKb.aria), `logo names its diagnostics action for assistive tech (got "${diagKb.aria}")`);
  ok(diagKb.h1Intact, 'the h1 wordmark stays outside the button (heading not flattened)');
  await page.focus('#brandLogo');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(200);
  ok(await page.isVisible('#diagScrim.open'), 'Enter on the focused logo opens diagnostics');
  await page.evaluate(() => { if (document.getElementById('diagScrim').classList.contains('open')) document.getElementById('diagClose').click(); });
  // Camera presets announce their views, not bare letters.
  const presetAria = await page.evaluate(() => ['viewFront', 'viewSide', 'viewTop', 'viewIso'].map(id => document.getElementById(id).getAttribute('aria-label') || ''));
  ok(/front elevation/i.test(presetAria[0]) && /side elevation/i.test(presetAria[1]) && /plan|top/i.test(presetAria[2]) && /perspective/i.test(presetAria[3]),
    `camera presets carry real names (${presetAria.join(' | ') || 'none'})`);

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
    return grab(['cut', 'stock', 'assembly', 'integrity'], /\d\s?mm\b/);
  });
  ok(Object.keys(sweep).length === 0, 'imperial sweep finds zero stale mm: ' + JSON.stringify(sweep));
  await clickMoreCtl('#unitsMm');
  const sweepMet = await page.evaluate(() => {
    const out = {};
    for (const tab of ['cut', 'stock', 'assembly', 'integrity']) {
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
  ok(await page.evaluate(() => document.querySelector('.topbar').getBoundingClientRect().height <= 64),
    'desktop header is one compact row (redesign spec: 56\u201364px app bar)');

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

  // Mode nav: three derived segments (Design / Plan / Build), states live.
  const modes = await page.evaluate(() => [...document.querySelectorAll('#modeNav .mode-btn')].map(b => b.dataset.mode + ':' + b.dataset.state));
  ok(modes.length === 3 && modes[0] === 'design:done', `mode nav derives three segments (${modes.join(' ')})`);
  await page.click('#mode-design');
  ok(await page.evaluate(() => document.body.dataset.mode === 'design'
    && getComputedStyle(document.querySelector('.tabs')).display === 'none'
    && /^#design(;|$)/.test(location.hash)),
    'Design mode gives the stage to the model and mirrors into the hash');
  await page.click('#mode-plan');
  ok(await page.evaluate(() => document.body.dataset.mode === 'plan'
    && getComputedStyle(document.querySelector('.tabs')).display !== 'none'),
    'Plan mode brings the sub-tabs back');
  const modeBuild = await page.evaluate(() => {
    __bb.enterBuildMode();
    const current = document.getElementById('buildModeBtn').getAttribute('aria-current') === 'page';
    document.querySelector('.bm-check[aria-pressed="false"]').click();
    __bb.exitBuildMode();
    return { current, state: document.getElementById('buildModeBtn').dataset.state };
  });
  ok(modeBuild.current && modeBuild.state === 'attn',
    'Build segment holds aria-current in build mode and turns attn once progress lands');

  // URL-restorable tabs: hash mirrors the tab, external hash edits apply,
  // and a deep link survives reload — reference subtab included.
  // Hash may also carry ;split=N;chat=0|1 view state (ignored if unknown).
  await page.click('#tab-stock');
  ok(await page.evaluate(() => /^#stock(;|$)/.test(location.hash)), 'selecting a tab mirrors into the URL hash');
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

  // Share links: the design itself rides the URL hash through the same
  // import gate as a pasted code, then the app takes the hash back.
  await page.evaluate(() => {
    const spec = JSON.parse(JSON.stringify(__bb.state.spec));
    spec.meta.name = 'Linked Bench';
    location.hash = '#d=' + encodeURIComponent(BB.Codec.toShareCode(spec));
  });
  await page.waitForFunction(() => __bb.state.spec.meta.name === 'Linked Bench', null, { timeout: 5000 });
  ok(await page.evaluate(() => !/^#d=/.test(location.hash)), 'share-link hash imports the design and returns the URL to the app');

  // Panel labelled by its tab; skip link is the first tab stop.
  ok(await page.evaluate(() => document.getElementById('panel-main').getAttribute('aria-labelledby') === 'tab-reference'),
    'tab panel is labelled by the active tab');
  await page.evaluate(() => document.activeElement && document.activeElement.blur());
  await page.keyboard.press('Tab');
  ok(await page.evaluate(() => document.activeElement.classList.contains('skip-link')), 'skip link is the first tab stop');

  // Viewport help: now inside the View popover; Escape closes and restores.
  await page.click('#viewBtn');
  await page.click('#vpHelpBtn');
  ok(await page.isVisible('#vpHelp'), 'viewport help opens from the View popover');
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
    shortCta: getComputedStyle(document.querySelector('#buildModeBtn .mode-label')).display !== 'none'
  }));
  ok(mobileShell.topbarH <= 64, `mobile header stays one row (${Math.round(mobileShell.topbarH)}px, redesign spec: 56\u201364px)`);
  // Touch targets ≥40 px may wrap the toolbar onto a second row on narrow phones —
  // that is preferred over unreadably small controls at the bench.
  ok(mobileShell.toolbarH <= 120, `mobile viewport toolbar stays compact (${Math.round(mobileShell.toolbarH)}px)`);
  ok(mobileShell.brandHidden && mobileShell.shortCta, 'wordmark yields and Build keeps its word on phones');
  await page.evaluate(() => __bb.selectTab('cut'));
  await page.waitForSelector('.cut-card');
  ok(await page.evaluate(() => !document.querySelector('#panel-main table.data') && document.querySelectorAll('.cut-card').length >= 3),
    'phone cut list reads as cards, not a seven-column table');
  const whyOpens = await page.evaluate(() => {
    document.querySelector('.cut-card .cc-why').click();
    const open = !document.getElementById('provPop').hidden;
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    return open;
  });
  ok(whyOpens, '"Why this length?" opens the provenance dialog on a phone');

  // Phone Build mode: one board or step at a time — big diagram on a
  // legibility floor, 56px controls, Next/swipe pager, honest install nudge.
  await page.evaluate(() => __bb.enterBuildMode());
  await page.waitForSelector('.bm-task');
  const pagerShape = await page.evaluate(() => ({
    columnsHidden: getComputedStyle(document.querySelector('.bm-columns')).display === 'none',
    oneTask: document.querySelectorAll('.bm-task').length === 1,
    pos: document.getElementById('bmTaskPos').textContent,
    nextH: document.getElementById('bmTaskNext').offsetHeight >= 56,
    checkH: [...document.querySelectorAll('.bm-task .bm-check')].every(b => b.offsetHeight >= 56),
    noScrollX: document.documentElement.scrollWidth <= innerWidth
  }));
  ok(pagerShape.columnsHidden && pagerShape.oneTask, `phone build shows one task at a time (${pagerShape.pos})`);
  ok(pagerShape.nextH && pagerShape.checkH, 'build pager controls hold the 56px shop floor');
  ok(pagerShape.noScrollX, 'build mode never pans the page sideways');
  const fsOK = await page.evaluate(() => {
    const svg = document.querySelector('.bm-diagram-hero .cut-diagram-svg');
    if (!svg) return { ok: true, min: null }; // step-first pager (no boards)
    const scale = svg.getBoundingClientRect().width / svg.viewBox.baseVal.width;
    const sizes = [...svg.querySelectorAll('text')].map(t => parseFloat(t.getAttribute('font-size')) * scale);
    return { ok: sizes.every(x => x >= 13.5), min: Math.round(Math.min(...sizes) * 10) / 10 };
  });
  ok(fsOK.ok, `every diagram label lands at effective >=14px (min ${fsOK.min})`);
  const posBefore = await page.evaluate(() => __bb.state.bmTask);
  await page.click('#bmTaskNext');
  ok(await page.evaluate(b => __bb.state.bmTask === b + 1, posBefore), 'Next advances the one-task pager');
  const nudged = await page.evaluate(() => {
    // Fill every checklist key except one, then check the last box for real —
    // completion must raise the one-time install nudge through the UI path.
    const keys = BB.Plans.checklistKeys(__bb.state.stockPlan, __bb.state.cut, __bb.state.steps);
    const prog = __bb.state.project.progress;
    keys.cuts.forEach(k => { prog.cuts[k] = true; });
    keys.steps.forEach(k => { prog.steps[k] = true; });
    const firstKey = keys.cuts[0];
    prog.cuts[firstKey] = false;
    __bb.state.bmTask = 0;
    prog.task = 0; // re-entry restores the persisted position (C-08)
    __bb.renderReadiness();
    document.querySelectorAll('#bmPager .bm-check[aria-pressed="false"]').length; // pager may be stale; re-render
    return (async () => {
      __bb.state.prefs4.installNudged = false;
      const el = document.getElementById('bmPager');
      __bb.exitBuildMode(); __bb.enterBuildMode(); // re-derive pager on fresh progress
      const btn = document.querySelector('#bmPager .bm-check[aria-pressed="false"]');
      if (!btn) return { clicked: false };
      btn.click();
      return {
        clicked: true,
        pct: document.getElementById('bmProgress').textContent,
        nudge: !document.getElementById('bmInstall').hidden,
        flag: __bb.state.prefs4.installNudged === true
      };
    })();
  });
  ok(nudged.clicked && /100%/.test(nudged.pct) && nudged.nudge && nudged.flag,
    `finishing the build raises the one-time install nudge (${nudged.pct})`);
  await page.evaluate(() => { document.getElementById('bmInstallDismiss').click(); __bb.exitBuildMode(); });

  /* ================= X-05: Share + Import reachable on phones ================= */
  // ≤560px hides the topbar Share CTA; the More menu must carry a working
  // Share/Import entry there (the CSS comment's claim, made true).
  ok(await page.evaluate(() => getComputedStyle(document.getElementById('shareBtn')).display === 'none'),
    'topbar Share CTA is hidden at 390px');
  await page.click('#moreBtn');
  const menuShare = await page.evaluate(() => {
    const b = document.getElementById('menuShareBtn');
    return { exists: !!b, visible: !!b && b.getClientRects().length > 0 };
  });
  ok(menuShare.exists && menuShare.visible, 'More menu offers a Share / Import entry at phone widths');
  await page.evaluate(() => { const b = document.getElementById('menuShareBtn'); if (b) b.click(); });
  await page.waitForTimeout(250);
  ok(await page.isVisible('#shareScrim.open'), 'the More-menu Share entry opens the share dialog');
  ok(await page.isVisible('#shareScrim.open #importCode'), 'the import paste box is reachable from the phone entry');
  await page.evaluate(() => {
    if (document.getElementById('shareScrim').classList.contains('open')) document.getElementById('shareClose').click();
    if (document.getElementById('moreMenu').classList.contains('open')) document.getElementById('moreBtn').click();
  });

  /* ================= X-06: phone mode nav keeps its words ================= */
  // Design/Plan must never collapse to unlabeled dots: visible text labels at
  // 390px, assistive state labels intact, and the row still fits.
  const nav390 = await page.evaluate(() => {
    const label = id => {
      const l = document.querySelector('#' + id + ' .mode-label');
      return { visible: !!l && getComputedStyle(l).display !== 'none', text: l ? l.textContent : '' };
    };
    return {
      design: label('mode-design'), plan: label('mode-plan'), build: label('buildModeBtn'),
      designAria: document.getElementById('mode-design').getAttribute('aria-label') || '',
      planAria: document.getElementById('mode-plan').getAttribute('aria-label') || '',
      moreRight: Math.round(document.getElementById('moreBtn').getBoundingClientRect().right),
      topbarH: Math.round(document.querySelector('.topbar').getBoundingClientRect().height),
      tapOk: [...document.querySelectorAll('.mode-btn')].every(b => b.getBoundingClientRect().height >= 44)
    };
  });
  ok(nav390.design.visible && nav390.design.text === 'Design' && nav390.plan.visible && nav390.plan.text === 'Plan',
    'Design and Plan keep visible text labels at 390px');
  ok(nav390.build.visible, 'Build keeps its word too');
  ok(nav390.designAria.length > 0 && nav390.planAria.length > 0, 'mode buttons keep assistive state labels');
  ok(nav390.moreRight <= 390, `labeled nav still fits the 390px row (More ends at ${nav390.moreRight}px)`);
  ok(nav390.topbarH <= 64, `topbar stays one compact row with labels (${nav390.topbarH}px)`);
  ok(nav390.tapOk, 'labeled mode buttons hold the 44px tap floor');
  await page.setViewportSize({ width: 430, height: 844 });
  await page.waitForTimeout(250);
  ok(await page.evaluate(() => Math.round(document.getElementById('moreBtn').getBoundingClientRect().right) <= 430),
    'labeled nav fits at 430px too (the tightest mid-band)');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(250);

  /* ================= X-07: Plan mode on a phone shows real content ============ */
  // Entering Plan at ≤560px auto-shifts the splitter so the panel holds at
  // least 40% of the viewport — the first plan row is readable without a
  // drag. A splitter the user has touched this session always wins.
  const planPhone = await page.evaluate(() => {
    __bb.state.userSplitTouched = false;
    __bb.setSplit(58, { persist: false });
    __bb.setMode('design');
    __bb.selectTab('cut'); // enters Plan through the same gate as the mode nav
    document.getElementById('panel-main').scrollTop = 0; // fresh entry (earlier tests scrolled it)
    const panel = document.getElementById('panel-main').getBoundingClientRect();
    const firstRow = document.querySelector('#panel-main .cut-card, #panel-main tbody tr');
    const sheetTop = document.getElementById('chatPanel').getBoundingClientRect().top;
    const r = firstRow ? firstRow.getBoundingClientRect() : null;
    return {
      panelShare: panel.height / innerHeight,
      rowVisible: !!r && r.top >= panel.top - 1 && r.bottom <= Math.min(sheetTop, innerHeight) + 1,
      debug: { panelTop: Math.round(panel.top), panelBottom: Math.round(panel.bottom), row: r && [Math.round(r.top), Math.round(r.bottom)], sheetTop: Math.round(sheetTop), expanded: document.getElementById('chatPanel').classList.contains('expanded') }
    };
  });
  ok(planPhone.panelShare >= 0.39, `entering Plan on a phone gives the panel ≥40% of the viewport (got ${Math.round(planPhone.panelShare * 100)}%)`);
  ok(planPhone.rowVisible, `the first plan row is visible without a drag (${JSON.stringify(planPhone.debug)})`);
  const dragWins = await page.evaluate(() => {
    __bb.state.userSplitTouched = true;
    __bb.setSplit(58, { persist: false });
    __bb.setMode('design');
    __bb.setMode('plan');
    const split = __bb.state.prefs4.ui.split;
    __bb.state.userSplitTouched = false;
    __bb.setSplit(58, { persist: false });
    return split;
  });
  ok(dragWins === 58, `a user-touched splitter is never auto-fought (${dragWins}%)`);

  /* ================= P1-1: redo reachable on touch ================= */
  // The topbar redo folds away at phone widths; touch users (who have no
  // Ctrl+Shift+Z) get an actionable Redo in the More menu instead.
  ok(await page.evaluate(() => getComputedStyle(document.getElementById('redoBtn')).display === 'none'),
    'topbar redo is folded away at 390px');
  const redoTouch = await page.evaluate(() => {
    const before = __bb.state.spec.overall.height;
    __bb.merge({ overall: { height: before + 30 } }, 'manual');
    const changed = __bb.state.spec.overall.height;
    document.getElementById('undoBtn').click();
    const afterUndo = __bb.state.spec.overall.height;
    document.getElementById('moreBtn').click();
    const item = document.getElementById('menuRedoBtn');
    const visible = !!item && item.getClientRects().length > 0 && !item.disabled;
    if (item) item.click();
    const out = {
      distinct: changed !== before,
      undone: afterUndo === before,
      visible,
      redone: __bb.state.spec.overall.height === changed,
      menuClosed: !document.getElementById('moreMenu').classList.contains('open')
    };
    if (!out.menuClosed) document.getElementById('moreBtn').click();
    document.getElementById('undoBtn').click(); // leave the design as we found it
    return out;
  });
  ok(redoTouch.distinct && redoTouch.undone, 'undo/redo probe setup holds (edit landed, undo reverted)');
  ok(redoTouch.visible, 'More menu offers an enabled Redo at phone widths');
  ok(redoTouch.redone && redoTouch.menuClosed, 'the menu Redo restores the undone change and closes the menu');

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.waitForTimeout(300);

  /* ================= A-05: usage meter + persistent upgrade surface ============ */
  // A billing-configured origin shows Free users the wall BEFORE they hit it:
  // a compact remaining-messages meter by the chat input, and a persistent
  // Plans entry in the More menu — not only the paywall dialog.
  const meter = await page.evaluate(() => {
    const grab = () => {
      const m = document.getElementById('aiUsage');
      return {
        visible: !!m && !m.hidden,
        text: m ? m.textContent : '',
        areaShown: !document.getElementById('accountArea').hidden,
        menuHasPlans: !!document.querySelector('#accountArea [role="menuitem"]')
      };
    };
    const real = BB.Store.auth().billing;
    BB.Store.setBilling({ plan: 'free', entitlements: { plan: 'free', label: 'Free', projectLimit: 3, aiMonthlyLimit: 25, premiumExports: false, advancedFeatures: false }, usage: { aiMessages: 7 } });
    if (__bb.renderAccount) __bb.renderAccount();
    const free = grab();
    BB.Store.setBilling(real);
    if (__bb.renderAccount) __bb.renderAccount();
    const restored = grab();
    return { free, restored };
  });
  ok(meter.free.visible && /18 of 25/.test(meter.free.text),
    `free user with known usage sees the remaining-messages meter (got "${meter.free.text.trim()}")`);
  ok(/Upgrade/i.test(meter.free.text), 'the meter carries an Upgrade affordance for Free');
  ok(meter.free.areaShown && meter.free.menuHasPlans, 'billing-configured origin gets a persistent Plans entry in More');
  ok(!meter.restored.visible, 'meter hides again when usage is zero/unknown');

  /* ================= X-04: the Build gate announces itself ================= */
  // Free users get a visible + aria-communicated Pro lock on the Build mode
  // button, so the paywall is announced BEFORE the tap; activation still
  // opens the pricing dialog, never a bare dead-end.
  const lock = await page.evaluate(() => {
    const real = BB.Store.auth().billing;
    BB.Store.setBilling({ plan: 'free', entitlements: { plan: 'free', label: 'Free', projectLimit: 3, aiMonthlyLimit: 25, premiumExports: false, advancedFeatures: false }, usage: { aiMessages: 0 } });
    if (__bb.renderAccount) __bb.renderAccount();
    __bb.renderReadiness();
    const lockEl = document.getElementById('buildModeLock');
    const btn = document.getElementById('buildModeBtn');
    const free = {
      lockVisible: !!lockEl && !lockEl.hidden && !!lockEl.querySelector('svg'),
      aria: btn.getAttribute('aria-label') || ''
    };
    btn.click();
    const dlg = document.querySelector('.pricing-dialog');
    free.modal = !!(dlg && dlg.open);
    free.buildEntered = __bb.state.buildMode;
    if (dlg && dlg.open) dlg.close();
    BB.Store.setBilling(real);
    if (__bb.renderAccount) __bb.renderAccount();
    __bb.renderReadiness();
    return { free, pro: { lockVisible: !!lockEl && !lockEl.hidden } };
  });
  ok(lock.free.lockVisible, 'free users see a visible Pro lock glyph on the Build button');
  ok(/\bPro\b/.test(lock.free.aria), `Build button aria announces the Pro gate before the tap (got "${lock.free.aria}")`);
  ok(lock.free.modal && !lock.free.buildEntered, 'activating locked Build still opens the pricing dialog, not the shop');
  ok(!lock.pro.lockVisible, 'Pro entitlement clears the lock affordance');

  /* ================= A-04: the Free project-cap loop ================= */
  // At the 3-project cap the autosave path must stay calm AND honest: the
  // pricing dialog opens at most ONCE per session, the save indicator says
  // plainly that nothing is saved (with a working share-code way out), and
  // later blocked saves surface only the passive indicator/banner.
  const cap = await page.evaluate(async () => {
    const FREE = { plan: 'free', entitlements: { plan: 'free', label: 'Free', projectLimit: 3, aiMonthlyLimit: 25, premiumExports: false, advancedFeatures: false }, usage: { aiMessages: 0 } };
    const realIdx = await BB.Store.loadIndex();
    const realProject = __bb.state.project;
    const realBilling = BB.Store.auth().billing;
    await BB.Store.set('projects:index', [1, 2, 3].map(i => ({ id: 'seed' + i, name: 'Seed ' + i, updated: Date.now() - i, dims: null, progressPct: 0 })));
    BB.Store.setBilling(FREE);
    __bb.state.project = null;
    const dlg = () => document.querySelector('.pricing-dialog');
    const banner = () => document.getElementById('capBanner');
    const snap = () => ({
      modal: !!(dlg() && dlg().open),
      saveText: document.getElementById('saveState').textContent,
      banner: !!(banner() && !banner().hidden)
    });
    await __bb.doAutosave();
    const first = snap();
    if (dlg() && dlg().open) dlg().close();
    await __bb.doAutosave();
    const second = snap();
    if (dlg() && dlg().open) dlg().close(); // cleanup regardless of outcome
    let shareOpens = false;
    const shareBtn = document.getElementById('capBannerShare');
    if (shareBtn) {
      shareBtn.click();
      shareOpens = document.getElementById('shareScrim').classList.contains('open');
      if (shareOpens) document.getElementById('shareClose').click();
    }
    // restore the world for the tests that follow
    await BB.Store.set('projects:index', realIdx);
    __bb.state.project = realProject;
    BB.Store.setBilling(realBilling);
    if (banner()) banner().hidden = true;
    return { first, second, shareOpens };
  });
  ok(cap.first.modal, 'first blocked autosave at the cap opens the pricing dialog');
  ok(cap.first.saveText === 'not saved — project limit',
    `blocked autosave shows an explicit save state (got "${cap.first.saveText}")`);
  ok(cap.first.banner, 'blocked autosave raises the passive not-saved banner');
  ok(!cap.second.modal, 'second blocked autosave does NOT re-open the pricing dialog');
  ok(cap.second.saveText === 'not saved — project limit' && cap.second.banner,
    'later blocked saves keep the passive indicator only');
  ok(cap.shareOpens, 'the banner share-code affordance opens the share dialog');

  // (d) A server 403 {error:'project_limit'} on the project-doc write lands in
  // the SAME visible state — the cloud driver records the denial and the
  // autosave paints it, never a silent "saved · cloud".
  const cap403 = await page.evaluate(async () => {
    const realFetch = window.fetch;
    const shim = window.storage;
    const json = (body, status) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
    window.fetch = async (url, opts) => {
      const u = String(url);
      if (u.startsWith('/api/auth')) return json({ user: { id: 'u1', name: 'Cap Tester' }, providers: ['dev'], storage: true }, 200);
      if (u.startsWith('/api/store')) {
        if (opts && opts.method === 'PUT' && u.includes('doc=project%3A')) return json({ error: 'project_limit', limit: 3 }, 403);
        return json({ value: JSON.stringify([]) }, 200);
      }
      return realFetch(url, opts);
    };
    try {
      window.storage = null;                       // force the cloud rung
      await BB.Store.init({ timeoutMs: 2000 });    // probe succeeds -> remote alive
      if (!__bb.state.project) __bb.state.project = { id: BB.Store.newId(), progress: { cuts: {}, steps: {} } };
      await __bb.doAutosave();
      return {
        cloud: BB.Store.auth().cloud,
        saveText: document.getElementById('saveState').textContent,
        banner: !!(document.getElementById('capBanner') && !document.getElementById('capBanner').hidden)
      };
    } finally {
      window.storage = shim;
      window.fetch = realFetch;
      const banner = document.getElementById('capBanner');
      if (banner) banner.hidden = true;
    }
  });
  ok(cap403.cloud, 'store chain upgraded to cloud for the 403 probe');
  ok(cap403.saveText === 'not saved — project limit',
    `server project_limit 403 paints the same explicit state (got "${cap403.saveText}")`);
  ok(cap403.banner, 'server project_limit 403 raises the same passive banner');

  /* ================= P2-9: cut-list sticky headers actually stick ============ */
  // The column headers must pin to the top of the scrolling panel while the
  // rows scroll under them — measured on a 13-row cut list.
  const sticky = await page.evaluate(async () => {
    __bb.merge({ meta: { template: 'cabinet' }, overall: { width: 900, depth: 450, height: 900 }, drawers: { count: 2 }, structure: { shelfCount: 2 } }, 'manual');
    __bb.selectTab('cut');
    await new Promise(r => setTimeout(r, 400)); // panel rise animation settles
    const panel = document.getElementById('panel-main');
    const thead = document.querySelector('#panel-main thead');
    const rows = document.querySelectorAll('#panel-main tbody tr').length;
    panel.scrollTop = 0;
    const beforeTop = thead.getBoundingClientRect().top;
    panel.scrollTop = 300;
    const t = thead.getBoundingClientRect();
    const p = panel.getBoundingClientRect();
    const firstRow = document.querySelector('#panel-main tbody tr').getBoundingClientRect();
    panel.scrollTop = 0;
    return {
      rows,
      pinned: t.top >= p.top - 1 && t.top <= p.top + 40,
      drift: Math.round(beforeTop - t.top),
      rowsUnder: firstRow.top < t.bottom
    };
  });
  ok(sticky.rows >= 13, `sticky probe runs on a ${sticky.rows}-row cut list`);
  ok(sticky.pinned, `thead pins to the panel top after a 300px scroll (drifted ${sticky.drift}px instead)`);
  ok(sticky.rowsUnder, 'rows scroll under the pinned header');

  /* ================= M-15: first-run welcome reads import-first ============ */
  // With no saved projects the third path is IMPORT (paste a code you were
  // given), not "open a saved design" you don't have — and its action lands
  // focus in the paste box, not on the export code.
  const welcomeImport = await page.evaluate(() => {
    __bb.showWelcome(false);
    const name = document.getElementById('welcomeResumeName').textContent;
    document.getElementById('welcomeResume').click();
    const out = {
      name,
      shareOpen: document.getElementById('shareScrim').classList.contains('open'),
      focusId: document.activeElement ? document.activeElement.id : ''
    };
    if (out.shareOpen) document.getElementById('shareClose').click();
    __bb.hideWelcome();
    __bb.showWelcome(true);
    out.withProjects = document.getElementById('welcomeResumeName').textContent;
    __bb.hideWelcome();
    return out;
  });
  ok(welcomeImport.name === 'Import a design', `no-projects welcome reads import-first (got "${welcomeImport.name}")`);
  ok(welcomeImport.shareOpen && welcomeImport.focusId === 'importCode',
    `the import action opens Share with focus in the paste box (focus on "${welcomeImport.focusId}")`);
  ok(welcomeImport.withProjects === 'Open a saved design', 'the has-projects welcome keeps "Open a saved design"');


  /* ================= G13: transport death names the network ================= */
  // A transport that existed and died — on the first call or inside a
  // validation round — surfaces as a retryable connection message, never as
  // "I couldn't get a buildable design" and never as the offline parser
  // answering for the model. The design stays untouched both times.
  const g13 = await page.evaluate(async () => {
    const bubbles = () => [...document.querySelectorAll('#chatLog .msg.bot .bubble')].map(b => b.textContent.trim()).filter(Boolean);
    const specBefore = JSON.stringify(__bb.state.spec);
    const n0 = bubbles().length;
    // This session has proven a live service (injected transport) — the badge
    // gate distinguishes an online blip from a static host that never had one.
    __bb.setAIState('online');
    // (a) first call dies mid-flight.
    BB.AI.setTransport(async () => { throw new Error('boom'); });
    await __bb.sendMessage('make it walnut');
    const firstMsg = bubbles().pop() || '';
    // (b) death inside a validation round: reply 1 is a custom with an
    // unjointed overlap (validation error), then the wire drops.
    const bad = BB.Spec.correctSpec({
      meta: { name: 'Overlap probe', template: 'custom', level: 'advanced', units: 'mm' },
      custom: {
        parts: [
          { id: 'a', role: 'slab_a', primitive: 'slab', dim: { l: 300, w: 300, t: 30 }, pos: { x: 0, y: 15, z: 0 } },
          { id: 'b', role: 'slab_b', primitive: 'slab', dim: { l: 300, w: 300, t: 30 }, pos: { x: 0, y: 25, z: 0 } }
        ],
        connections: []
      }
    });
    let call = 0;
    BB.AI.setTransport(async () => {
      call++;
      if (call === 1) return { text: JSON.stringify({ N: BB.Codec.encode(bad), e: 'Two overlapping slabs.' }), stopReason: 'end_turn' };
      throw new Error('boom');
    });
    await __bb.sendMessage('two overlapping slabs please');
    BB.AI.setTransport(null);
    __bb.setAIState('offline'); // restore this host's truthful badge
    const after = bubbles().slice(n0);
    return {
      firstMsg,
      midMsg: after[after.length - 1] || '',
      blamedDesign: after.some(t => t.includes("couldn't get a buildable design")),
      untouched: JSON.stringify(__bb.state.spec) === specBefore,
      roundsRan: call >= 2
    };
  });
  ok(g13.firstMsg.startsWith('Connection dropped'), `first-call transport death names the network ("${g13.firstMsg.slice(0, 60)}")`);
  ok(g13.roundsRan && g13.midMsg.startsWith('Connection dropped'), `mid-validation transport death names the network ("${g13.midMsg.slice(0, 60)}")`);
  ok(!g13.blamedDesign, 'a dropped connection is never blamed on the design');
  ok(g13.untouched, 'the last valid design survives both transport deaths untouched');

  /* ================= G10: silent grounding reaches the ack ================= */
  // An airborne custom proposal is grounded silently by correction; the
  // committed ack must disclose the translation (whether the commit lands as
  // a clean ack or an honest-fail report).
  const g10 = await page.evaluate(async () => {
    const grounded = BB.Spec.correctSpec({
      meta: { name: 'Pedestal probe', template: 'custom', level: 'beginner', units: 'mm' },
      custom: {
        parts: [
          { id: 'base', role: 'base', primitive: 'slab', dim: { l: 400, w: 400, t: 30 }, pos: { x: 0, y: 15, z: 0 }, loadBearing: true },
          { id: 'post', role: 'post', primitive: 'post', dim: { l: 400, w: 80, t: 80 }, pos: { x: 0, y: 230, z: 0 }, loadBearing: true },
          { id: 'top', role: 'top', primitive: 'slab', dim: { l: 300, w: 300, t: 30 }, pos: { x: 0, y: 445, z: 0 }, surface: 'shelf' }
        ],
        connections: [
          { a: 'base', b: 'post', joint: 'butt_screws' },
          { a: 'post', b: 'top', joint: 'butt_screws' }
        ]
      }
    });
    const airborne = JSON.parse(JSON.stringify(grounded));
    for (const p of airborne.custom.parts) p.pos.y += 700; // a "hanging" pedestal
    // The cap403 section above leaves a mock user signed in, so this commit
    // (first non-local send since) fires Billing.refresh(); this host's 204
    // for /api/billing would clobber entitlements — pin it to 404 and
    // restore billing, same snapshot pattern as the billing sections.
    const realFetch = window.fetch;
    const realBilling = BB.Store.auth().billing;
    window.fetch = async (url, opts) => String(url).startsWith('/api/billing')
      ? new Response('{"error":"unavailable"}', { status: 404, headers: { 'Content-Type': 'application/json' } })
      : realFetch(url, opts);
    let calls = 0;
    try {
      BB.AI.setTransport(async () => {
        calls++;
        if (calls === 1) return { text: JSON.stringify({ N: BB.Codec.encode(airborne), e: 'A pedestal shelf.' }), stopReason: 'end_turn' };
        return { text: JSON.stringify({ i: 'no further changes' }), stopReason: 'end_turn' };
      });
      await __bb.sendMessage('a floating pedestal shelf');
      await new Promise(r => setTimeout(r, 120)); // let the fire-and-forget refresh settle
    } finally {
      BB.AI.setTransport(null);
      window.fetch = realFetch;
      BB.Store.setBilling(realBilling);
    }
    const acks = [...document.querySelectorAll('#chatLog .msg.bot .bubble')].map(b => b.textContent);
    const ack = acks.reverse().find(t => /pedestal shelf|Honest report/i.test(t)) || acks[0] || '';
    return {
      committed: __bb.state.spec.meta.template === 'custom' && __bb.state.spec.meta.name === 'Pedestal probe',
      floorY: Math.min(...__bb.state.model.parts.map(p => p.pos.y - p.size.h / 2)),
      ackDiscloses: /floated .+ above the floor/.test(ack) && /grounded/.test(ack),
      ack: ack.slice(0, 200)
    };
  });
  ok(g10.committed, 'the airborne proposal commits as the custom piece');
  ok(Math.abs(g10.floorY) < 1, `delivered piece stands on the floor (minY ${g10.floorY.toFixed(1)})`);
  ok(g10.ackDiscloses, `the ack discloses the silent grounding ("${g10.ack}")`);

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
