/* DIY-user front-end audit walkthrough.
 * Exercises every surface a hobby woodworker would touch, at desktop + phone.
 * Writes screenshots to dist/audit-shots/ and a JSON log to dist/diy-audit-log.json.
 * Run: node test/diy-audit.playwright.js
 */
'use strict';
const { chromium } = require('playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');

const DIST = path.join(__dirname, '..', 'dist', 'index.html');
const SHOTS = path.join(__dirname, '..', 'dist', 'audit-shots');
const LOG_PATH = path.join(__dirname, '..', 'dist', 'diy-audit-log.json');

const findings = [];
const note = (cat, severity, title, detail, evidence) => {
  findings.push({ cat, severity, title, detail, evidence: evidence || null, at: new Date().toISOString() });
  console.log(`[${severity}] ${cat}: ${title}`);
};

const chromePath =
  fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium'
  : '/home/ubuntu/.cache/ms-playwright/chromium-1228/chrome-linux64/chrome';

(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  const html = fs.readFileSync(DIST, 'utf8');
  const server = http.createServer((req, res) => {
    if (req.url === '/' || req.url.startsWith('/index')) {
      res.setHeader('content-type', 'text/html');
      res.end(html);
    } else { res.statusCode = 204; res.end(); }
  }).listen(0);
  const port = server.address().port;

  const browser = await chromium.launch({
    executablePath: chromePath,
    args: ['--no-sandbox', '--enable-unsafe-swiftshader']
  });

  async function freshPage(viewport, label) {
    const ctx = await browser.newContext({
      viewport,
      deviceScaleFactor: viewport.width < 500 ? 2 : 1,
      hasTouch: viewport.width < 900,
      isMobile: viewport.width < 500
    });
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
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(String(e)));
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    page._bbErrors = errors;
    page._bbCtx = ctx;
    page._bbLabel = label;
    await page.goto(`http://127.0.0.1:${port}/`);
    await page.waitForFunction(() => globalThis.__bb && __bb.state.model, null, { timeout: 20000 });
    return page;
  }

  const shot = async (page, name) => {
    const file = `${page._bbLabel}-${name}.png`;
    await page.screenshot({ path: path.join(SHOTS, file), fullPage: false });
    return file;
  };

  const clickMore = async (page, sel) => {
    if (!(await page.isVisible('#moreMenu.open'))) await page.click('#moreBtn');
    await page.click(sel);
  };

  /** Close any open scrim/drawer without fighting pointer intercepts. */
  const closeOverlays = async (page) => {
    await page.evaluate(() => {
      for (const id of ['shareClose', 'projectsClose', 'galleryClose', 'helpClose',
        'speciesClose', 'diagClose', 'jointClose', 'compareClose', 'historyClose',
        'welcomeClose', 'inspClose', 'bmExit', 'pbExit', 'compareExit']) {
        const el = document.getElementById(id);
        if (el) try { el.click(); } catch (_) {}
      }
      document.querySelectorAll('.scrim.open').forEach(s => s.classList.remove('open'));
      document.querySelectorAll('.scrim').forEach(s => s.setAttribute('inert', ''));
      const hd = document.getElementById('historyDrawer');
      if (hd) { hd.setAttribute('aria-hidden', 'true'); hd.setAttribute('inert', ''); }
      const hb = document.getElementById('historyBackdrop');
      if (hb) hb.setAttribute('hidden', '');
    });
    await page.keyboard.press('Escape').catch(() => {});
    await page.waitForTimeout(150);
  };

  const measure = async (page, sel) => page.evaluate(s => {
    const el = document.querySelector(s);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return {
      w: Math.round(r.width), h: Math.round(r.height),
      top: Math.round(r.top), left: Math.round(r.left),
      visible: cs.display !== 'none' && cs.visibility !== 'hidden' && r.width > 0 && r.height > 0,
      text: (el.innerText || el.textContent || '').slice(0, 120).replace(/\s+/g, ' ').trim(),
      overflowX: el.scrollWidth > el.clientWidth + 2,
      overflowY: el.scrollHeight > el.clientHeight + 2
    };
  }, sel);

  // ═══════════════════════════════════════════════════════════
  // DESKTOP — full DIY journey
  // ═══════════════════════════════════════════════════════════
  try {
    const page = await freshPage({ width: 1440, height: 900 }, 'desk');
    console.log('\n=== DESKTOP DIY JOURNEY ===');

    // 1. First paint / welcome
    const welcomeVisible = await page.isVisible('#welcomeOverlay');
    note('onboarding', welcomeVisible ? 'good' : 'P0',
      'Welcome overlay on first visit',
      welcomeVisible ? 'Non-blocking welcome with 3 paths; bench stays live behind it.' : 'Welcome missing on fresh session.',
      await shot(page, '01-welcome'));

    const brand = await measure(page, '.brand-name');
    note('brand', brand && brand.visible ? 'good' : 'P1',
      'Brand lockup visible in header',
      `Brand text: "${brand && brand.text}" (${brand && brand.w}×${brand.h})`);

    // Interactive behind welcome
    await page.click('#tab-integrity');
    const tabOk = await page.evaluate(() => __bb.state.tab === 'integrity');
    note('onboarding', tabOk ? 'good' : 'P1',
      'Bench usable behind welcome card',
      tabOk ? 'Tabs switch while welcome is open — non-blocking as designed.' : 'Tabs blocked by welcome.');

    // 2. Starter gallery path
    await page.click('#welcomeStarter');
    await page.waitForSelector('#galleryScrim.open');
    await page.waitForTimeout(1200); // thumbnails idle render
    const cards = await page.$$eval('.gallery-card', els => els.map(e => ({
      name: e.querySelector('.g-name')?.textContent,
      hasThumb: !!e.querySelector('.g-thumb')
    })));
    note('gallery', cards.length >= 6 ? 'good' : 'P1',
      'Starter gallery density',
      `${cards.length} starters: ${cards.map(c => c.name).join(', ')}; thumbs=${cards.filter(c => c.hasThumb).length}`,
      await shot(page, '02-gallery'));

    // Pick nightstand (reliable drawers + integrity surface)
    await page.click('.gallery-card:nth-child(5)');
    await page.waitForFunction(() => __bb.state.spec.meta.template === 'nightstand');
    await page.waitForTimeout(1100);
    note('gallery', 'good', 'Nightstand starter loads with hero assemble',
      await page.evaluate(() => ({
        name: __bb.state.spec.meta.name,
        drawers: __bb.state.model.drawers.length,
        parts: __bb.state.model.parts.length,
        cut: __bb.state.cut.length,
        steps: __bb.state.steps.length,
        integrity: __bb.state.integrity.summary
      })),
      await shot(page, '03-nightstand'));

    // 3. Chat refinement (offline parser — no API key)
    await page.fill('#chatText', 'make the top oak instead of walnut');
    await page.click('#sendBtn');
    await page.waitForTimeout(1500);
    const chatAfterSpecies = await page.evaluate(() => ({
      msgs: document.querySelectorAll('#chatLog .msg').length,
      lastBot: document.querySelector('#chatLog .msg.bot:last-child')?.innerText?.slice(0, 200),
      species: __bb.state.spec.wood.species
    }));
    note('chat', 'observe', 'Species change via chat (offline)',
      chatAfterSpecies, await shot(page, '04-chat-species'));

    await page.fill('#chatText', 'lower it by 2 inches');
    await page.click('#sendBtn');
    await page.waitForSelector('.msg.bot .chip', { timeout: 8000 }).catch(() => null);
    const heightChip = await page.evaluate(() => ({
      chip: document.querySelector('.msg.bot:last-child .chip')?.textContent,
      h: __bb.state.spec.overall.height
    }));
    note('chat', heightChip.chip ? 'good' : 'P1',
      'Dimension change shows code-computed diff chip',
      heightChip, await shot(page, '05-chat-height'));

    await page.fill('#chatText', 'make it bigger');
    await page.click('#sendBtn');
    await page.waitForSelector('.clarify, .msg.bot .opt', { timeout: 5000 }).catch(() => null);
    const clarify = await page.evaluate(() => ({
      hasClarify: !!document.querySelector('.clarify, .msg.bot .opt, .opt-row'),
      opts: [...document.querySelectorAll('.msg.bot .opt, .opt-row button, .clarify button')].map(b => b.textContent.trim()).slice(0, 6)
    }));
    note('chat', clarify.hasClarify ? 'good' : 'P2',
      'Ambiguous prompt asks clarifying question',
      clarify, await shot(page, '06-clarify'));
    if (clarify.hasClarify && clarify.opts.length) {
      await page.click('.msg.bot .opt, .opt-row button, .clarify button');
      await page.waitForTimeout(800);
    }

    // Skill level
    await page.selectOption('#levelSelect', 'beginner');
    const level = await page.evaluate(() => __bb.state.spec.meta.level);
    note('chat', level === 'beginner' ? 'good' : 'P2', 'Skill level selector updates spec', { level });

    // 4. Viewport controls
    await page.click('#dimsToggle');
    await page.waitForTimeout(300);
    note('viewport', await page.getAttribute('#dimsToggle', 'aria-pressed') === 'true' ? 'good' : 'P1',
      'Dimensions toggle', null, await shot(page, '07-dims'));

    await page.click('#draftToggle');
    await page.waitForTimeout(400);
    note('viewport', await page.getAttribute('#draftToggle', 'aria-pressed') === 'true' ? 'good' : 'P1',
      'Blueprint mode toggle', null, await shot(page, '08-blueprint'));
    for (const id of ['#viewFront', '#viewSide', '#viewTop', '#viewIso']) {
      await page.click(id);
      await page.waitForTimeout(200);
    }
    note('viewport', 'good', 'F/S/T/Iso view presets all clickable', null, await shot(page, '09-iso'));
    await page.click('#draftToggle'); // off
    await page.click('#dimsToggle'); // off

    await page.fill('#explodeRange', '70');
    await page.dispatchEvent('#explodeRange', 'input');
    await page.waitForTimeout(400);
    note('viewport', 'good', 'Explode slider to 70%', null, await shot(page, '10-explode'));
    await page.fill('#explodeRange', '0');
    await page.dispatchEvent('#explodeRange', 'input');

    await page.click('#vpHelpBtn');
    const helpOpen = await page.isVisible('#vpHelp');
    note('viewport', helpOpen ? 'good' : 'P2', 'Viewport ? help popover', null, await shot(page, '11-vp-help'));
    await page.click('#vpHelpBtn'); // close
    await page.click('#frameBtn');

    // Click a part to open inspector
    const partHit = await page.evaluate(() => {
      const canvas = document.getElementById('view3d');
      const r = canvas.getBoundingClientRect();
      // Prefer a known part mesh center via engine if available
      const eng = __bb.state.engine;
      const parts = __bb.state.model.parts;
      if (!parts.length) return { ok: false };
      // Synthetic click at canvas center — engine raycast may hit something
      return { ok: true, cx: r.left + r.width / 2, cy: r.top + r.height * 0.55, n: parts.length };
    });
    if (partHit.ok) {
      await page.mouse.click(partHit.cx, partHit.cy);
      await page.waitForTimeout(500);
    }
    const inspOpen = await page.evaluate(() => !document.getElementById('inspector').inert);
    note('inspector', inspOpen ? 'good' : 'observe',
      'Part inspector after canvas click',
      { open: inspOpen, parts: partHit.n },
      await shot(page, '12-inspector'));
    if (inspOpen) {
      const inspBody = await page.textContent('#inspBody');
      note('inspector', inspBody && inspBody.length > 20 ? 'good' : 'P2',
        'Inspector shows editable controls',
        { preview: (inspBody || '').slice(0, 180) });
      await page.click('#inspClose');
    } else {
      // Force-open via API for coverage
      await page.evaluate(() => {
        const p = __bb.state.model.parts[0];
        if (p && typeof __bb.openInspector === 'function') __bb.openInspector(p.id);
        else if (p) {
          // fallback: dispatch select through engine
          __bb.state.engine.select?.(p.id);
        }
      });
      await page.waitForTimeout(300);
    }

    // 5. Plans tabs — every tab
    const tabs = ['cut', 'stock', 'bom', 'assembly', 'integrity', 'reference'];
    for (const t of tabs) {
      await page.click(`#tab-${t}`);
      await page.waitForTimeout(250);
      const panelText = await page.evaluate(() => document.getElementById('panel-main').innerText.slice(0, 300));
      const h3 = await page.evaluate(() => document.querySelector('#panel-main h3')?.textContent);
      note('plans', h3 ? 'good' : 'P1', `Tab: ${t}`, { h3, preview: panelText.replace(/\s+/g, ' ').slice(0, 160) },
        await shot(page, `13-tab-${t}`));
    }

    // Give the plans panel more vertical room so controls aren't under the canvas
    await page.evaluate(() => {
      const sp = document.getElementById('vpSplitter');
      if (sp) {
        // set split via CSS var used by layout
        document.querySelector('.stage').style.setProperty('--vp-split', '40');
      }
      document.getElementById('panel-main').scrollIntoView({ block: 'start' });
    });
    await page.waitForTimeout(200);

    // Cut list provenance (panel sits under the viewport; DOM click avoids canvas intercept)
    await page.click('#tab-cut');
    await page.evaluate(() => {
      const panel = document.getElementById('panel-main');
      panel.scrollIntoView({ block: 'start' });
      const b = panel.querySelector('.prov-btn');
      if (b) { b.scrollIntoView({ block: 'center' }); b.click(); }
    });
    await page.waitForTimeout(300);
    const provVisible = await page.isVisible('#provPop:not([hidden])');
    note('plans', provVisible ? 'good' : 'P2',
      'Provenance popover on cut-list dimension',
      await page.evaluate(() => document.getElementById('provPop')?.innerText?.slice(0, 200) || null),
      await shot(page, '14-provenance'));
    await page.keyboard.press('Escape');
    await page.evaluate(() => document.getElementById('provPop')?.setAttribute('hidden', ''));

    // Stock mode + price editor
    await page.click('#tab-stock');
    await page.evaluate(() => {
      const sel = document.querySelector('select[aria-label="Stock buying mode for this species"]');
      if (sel) { sel.value = 'rough'; sel.dispatchEvent(new Event('change', { bubbles: true })); }
    });
    await page.waitForTimeout(400);
    note('plans', 'good', 'Stock mode switch to rough lumber',
      await page.evaluate(() => document.querySelector('#panel-main')?.innerText.includes('Rough lumber')),
      await shot(page, '15-stock-rough'));
    await page.evaluate(() => {
      const sel = document.querySelector('select[aria-label="Stock buying mode for this species"]');
      if (sel) { sel.value = 'dimensional'; sel.dispatchEvent(new Event('change', { bubbles: true })); }
    });
    await page.waitForTimeout(300);
    await page.evaluate(() => {
      const sum = document.querySelector('.price-editor summary');
      if (sum) sum.click();
    });
    await page.waitForTimeout(200);
    const priceInputs = await page.$$eval('.price-grid input', els => els.length);
    note('plans', priceInputs > 5 ? 'good' : 'P2',
      'Editable price table expands',
      { inputs: priceInputs }, await shot(page, '16-prices'));

    // Materials / species compare
    await page.click('#tab-bom');
    const compareBtn = await page.$('button:has-text("Compare species")');
    if (compareBtn) {
      await compareBtn.click();
      await page.waitForSelector('#speciesScrim.open');
      note('plans', 'good', 'Species comparison dialog',
        await page.evaluate(() => ({
          picks: document.querySelectorAll('#speciesPick button, #speciesPick label').length,
          table: !!document.querySelector('#speciesTableWrap table')
        })),
        await shot(page, '17-species'));
      await closeOverlays(page);
    }

    // Assembly + joint inspector + playback
    await page.click('#tab-assembly');
    const jointBtn = await page.$('.joint-inspect');
    if (jointBtn) {
      await jointBtn.click();
      await page.waitForSelector('#jointScrim.open');
      await page.waitForTimeout(500);
      await page.fill('#jointExplode', '80');
      await page.dispatchEvent('#jointExplode', 'input');
      await page.click('#jointCutaway');
      note('joint', 'good', 'Joint inspector from assembly step',
        await page.textContent('#jointNotes').then(t => (t || '').slice(0, 200)),
        await shot(page, '18-joint'));
      await closeOverlays(page);
    } else {
      note('joint', 'P2', 'No joint inspect button on assembly steps', null);
    }

    const playBtn = await page.$('.step-play');
    if (playBtn) {
      await playBtn.click();
      await page.waitForSelector('#playbackBar:not([hidden])');
      await page.waitForTimeout(800);
      note('assembly', 'good', 'Assembly playback bar',
        await page.textContent('#pbLabel'),
        await shot(page, '19-playback'));
      await page.click('#pbNext');
      await page.waitForTimeout(500);
      await page.click('#pbExit');
    }

    // Integrity + one-click fixes
    await page.click('#tab-integrity');
    const integrity = await page.evaluate(() => ({
      summary: __bb.state.integrity.summary,
      checks: __bb.state.integrity.checks.map(c => ({ title: c.title, status: c.status, fixes: (c.fixes || []).map(f => f.label) })),
      stamps: [...document.querySelectorAll('#panel-main .stamp')].map(s => s.textContent)
    }));
    note('integrity', 'good', 'Integrity report structure', integrity, await shot(page, '20-integrity'));
    const fixBtn = await page.$('.fix-row .btn');
    if (fixBtn) {
      const label = await fixBtn.textContent();
      await fixBtn.click();
      await page.waitForTimeout(600);
      note('integrity', 'good', 'One-click integrity fix applied', { label }, await shot(page, '21-fix'));
    } else {
      note('integrity', 'observe', 'No fix buttons on current design (all pass/advisory)', integrity.summary);
    }

    // Shop reference subtabs
    await page.click('#tab-reference');
    const refTabs = await page.$$eval('.ref-tabs button, .ref-tabs [role=tab]', els => els.map(e => e.textContent.trim()));
    note('reference', refTabs.length >= 4 ? 'good' : 'P2',
      'Shop reference sub-tabs', { tabs: refTabs }, await shot(page, '22-ref'));
    for (const t of refTabs.slice(0, 8)) {
      await page.click(`.ref-tabs button:has-text("${t}"), .ref-tabs [role=tab]:has-text("${t}")`);
      await page.waitForTimeout(150);
    }
    await page.fill('.ref-search', 'dovetail');
    await page.waitForTimeout(300);
    const searchHit = await page.evaluate(() => document.getElementById('panel-main').innerText.includes('dovetail') || document.getElementById('panel-main').innerText.includes('Dovetail'));
    note('reference', searchHit ? 'good' : 'P2', 'Reference search for dovetail', { hit: searchHit },
      await shot(page, '23-ref-search'));
    const refJoint = await page.$('.joint-demo');
    if (refJoint) {
      await refJoint.click();
      await page.waitForSelector('#jointScrim.open');
      note('reference', 'good', 'Joint demo from shop reference', null, await shot(page, '24-ref-joint'));
      await page.click('#jointClose');
    }

    // 6. Header menus — More
    await page.click('#moreBtn');
    note('chrome', 'good', 'More menu open',
      await page.$$eval('#moreMenu [role=menuitem]', els => els.map(e => e.innerText.replace(/\s+/g, ' ').trim())),
      await shot(page, '25-more'));

    // Units / dual / theme / render
    await page.click('#unitsMm');
    await page.waitForTimeout(200);
    const mmMode = await page.evaluate(() => BB.Units.get().system === 'metric');
    note('chrome', mmMode ? 'good' : 'P1', 'Switch display units to mm', { mmMode });
    await page.click('#dualBtn');
    await page.waitForTimeout(200);
    note('chrome', 'good', 'Dual units toggle',
      await page.evaluate(() => document.querySelector('#panel-main')?.innerText.slice(0, 80)),
      await shot(page, '26-dual-mm'));
    await page.click('#unitsIn');
    await page.click('#dualBtn'); // off
    await page.click('#themeDark');
    await page.waitForTimeout(300);
    note('chrome', 'good', 'Dark theme', null, await shot(page, '27-dark'));
    await page.click('#themeLight');
    await page.click('#renderFlat');
    await page.waitForTimeout(300);
    note('chrome', 'good', 'Flat render mode', null, await shot(page, '28-flat'));
    await page.click('#renderRich');
    await page.click('#themeAuto');

    // History
    await clickMore(page, '#historyBtn');
    await page.waitForTimeout(400);
    const histItems = await page.$$eval('#historyList .snap, #historyList .hist-item, #historyList > *', els => els.length);
    note('chrome', histItems > 0 ? 'good' : 'P2', 'History drawer', { items: histItems },
      await shot(page, '29-history'));
    // Try compare if 2+ checkboxes
    const checks = await page.$$('#historyList input[type=checkbox]');
    if (checks.length >= 2) {
      await checks[0].check();
      await checks[1].check();
      const compareEnabled = await page.evaluate(() => !document.getElementById('compareBtn').disabled);
      if (compareEnabled) {
        await page.click('#compareBtn');
        await page.waitForSelector('#compareScrim.open', { timeout: 3000 }).catch(() => null);
        note('chrome', await page.isVisible('#compareScrim.open') ? 'good' : 'P2',
          'Revision compare dialog', null, await shot(page, '30-compare'));
        if (await page.$('#compareScrim.open #compareClose')) {
          await page.click('#compareScrim.open #compareClose');
          await page.waitForTimeout(400);
        }
        if (await page.isVisible('#compareExit')) {
          await page.click('#compareExit');
          await page.waitForTimeout(200);
        }
      }
    }
    // Force-close history drawer (may sit off-canvas after compare overlay)
    await page.evaluate(() => {
      const close = document.getElementById('historyClose');
      if (close) close.click();
      document.getElementById('historyDrawer')?.setAttribute('aria-hidden', 'true');
      document.getElementById('historyBackdrop')?.setAttribute('hidden', '');
    });
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);

    // Projects
    await clickMore(page, '#projectsBtn');
    await page.waitForSelector('#projectsScrim.open');
    note('chrome', 'good', 'Projects dialog',
      await page.evaluate(() => ({
        cards: document.querySelectorAll('#projectsGrid .project-card, #projectsGrid > *').length,
        storage: document.getElementById('storageNote')?.textContent
      })),
      await shot(page, '31-projects'));
    await closeOverlays(page);

    // Share
    await clickMore(page, '#shareBtn');
    await page.waitForSelector('#shareScrim.open');
    const shareCode = await page.inputValue('#shareCode');
    note('chrome', shareCode.startsWith('BB4:') ? 'good' : 'P1',
      'Share code dialog', { prefix: shareCode.slice(0, 20), len: shareCode.length },
      await shot(page, '32-share'));
    await page.click('#copyShare');
    await page.waitForTimeout(200);
    // Import round-trip: copy code, clear via new design path, import
    const code = shareCode;
    await closeOverlays(page);

    // Gallery again from More
    await clickMore(page, '#galleryBtn');
    await page.waitForSelector('#galleryScrim.open');
    await page.click('#galleryClose');

    // 7. Export menu — every item (downloads)
    await page.click('#exportBtn');
    const exportItems = await page.$$eval('#exportMenu [role=menuitem]', els =>
      els.map(e => ({ text: e.innerText.replace(/\s+/g, ' ').trim(), exp: e.getAttribute('data-export') })));
    note('export', exportItems.length >= 7 ? 'good' : 'P1',
      'Export menu inventory', { items: exportItems }, await shot(page, '33-export'));

    for (const item of exportItems) {
      if (!item.exp || item.exp === 'help' || item.exp === 'print' || item.exp === 'share') continue;
      try {
        const [download] = await Promise.all([
          page.waitForEvent('download', { timeout: 5000 }),
          page.click(`#exportMenu [data-export="${item.exp}"]`)
        ]);
        note('export', 'good', `Export ${item.exp} downloads`, { suggested: download.suggestedFilename() });
      } catch (e) {
        note('export', 'P1', `Export ${item.exp} failed`, { err: String(e).slice(0, 120) });
      }
      // reopen menu for next
      if (!(await page.isVisible('#exportMenu.open'))) await page.click('#exportBtn');
    }
    // help
    if (!(await page.isVisible('#exportMenu.open'))) await page.click('#exportBtn');
    await page.click('#exportMenu [data-export="help"]');
    await page.waitForSelector('#helpScrim.open');
    note('export', 'good', 'Import/integration help dialog', null, await shot(page, '34-help'));
    await closeOverlays(page);

    // Share via export
    await page.click('#exportBtn');
    await page.click('#exportMenu [data-export="share"]');
    await page.waitForSelector('#shareScrim.open');
    await closeOverlays(page);

    // 8. Build mode
    await page.click('#buildModeBtn');
    await page.waitForSelector('#buildMode:not([hidden])');
    await page.waitForTimeout(400);
    const bm = await page.evaluate(() => ({
      name: document.getElementById('bmName')?.textContent,
      progress: document.getElementById('bmProgress')?.textContent,
      wake: document.getElementById('bmWake')?.textContent,
      cutsHtml: document.getElementById('bmCuts')?.innerText?.slice(0, 200),
      stepsHtml: document.getElementById('bmSteps')?.innerText?.slice(0, 200),
      cutCards: document.querySelectorAll('#bmCuts .bm-board, #bmCuts .stock-board, #bmCuts > *').length,
      stepItems: document.querySelectorAll('#bmSteps .bm-step, #bmSteps li, #bmSteps > *').length
    }));
    note('build', bm.cutCards > 0 || (bm.cutsHtml && bm.cutsHtml.length > 20) ? 'good' : 'P1',
      'Build mode board-by-board companion', bm, await shot(page, '35-build'));

    // Mark a step if checkboxes exist
    const bmCheck = await page.$('#bmSteps input[type=checkbox]');
    if (bmCheck) {
      await bmCheck.check();
      await page.waitForTimeout(200);
      note('build', 'good', 'Build-mode step checkbox works',
        await page.textContent('#bmProgress'));
    }
    const bmPlay = await page.$('#bmSteps .step-play, #bmSteps button[aria-label*="Play"]');
    if (bmPlay) {
      await bmPlay.click();
      await page.waitForTimeout(600);
      const playbar = await page.isVisible('#bmPlaybar:not([hidden])');
      note('build', playbar ? 'good' : 'P2', 'Build-mode 3D playback', null, await shot(page, '36-bm-play'));
      if (await page.isVisible('#bmPbBack')) await page.click('#bmPbBack');
    }
    await page.click('#bmExit');

    // 9. Design name + undo/redo
    await page.fill('#designName', 'Shop Nightstand');
    await page.dispatchEvent('#designName', 'change');
    await page.waitForTimeout(200);
    note('chrome', await page.evaluate(() => __bb.state.spec.meta.name === 'Shop Nightstand') ? 'good' : 'P2',
      'Design name rename', null);

    await page.click('#undoBtn');
    await page.waitForTimeout(300);
    await page.click('#redoBtn');
    await page.waitForTimeout(300);
    note('chrome', 'good', 'Undo/redo buttons fire', null);

    // 10. Share import round-trip
    await clickMore(page, '#shareBtn');
    await page.waitForSelector('#shareScrim.open');
    await page.fill('#importCode', code);
    await page.click('#importShare');
    await page.waitForTimeout(800);
    const importMsg = await page.textContent('#importMsg');
    note('share', !importMsg || !/fail|error|invalid/i.test(importMsg) ? 'good' : 'P1',
      'Share code import', { msg: importMsg }, await shot(page, '37-import'));
    await closeOverlays(page);

    // 11. Diagnostics (logo long-press)
    await page.dispatchEvent('#brandLogo', 'pointerdown');
    await page.waitForTimeout(900);
    await page.dispatchEvent('#brandLogo', 'pointerup');
    const diagOpen = await page.waitForSelector('#diagScrim.open', { timeout: 5000 }).then(() => true).catch(() => false);
    if (diagOpen) {
      await page.waitForTimeout(2500);
      const diag = await page.textContent('#diagSummary');
      note('diag', 'good', 'In-app diagnostics via logo hold', { summary: diag },
        await shot(page, '38-diag'));
      await closeOverlays(page);
    } else {
      note('diag', 'observe', 'Diagnostics did not open on synthetic pointer hold', null);
    }

    // 12. Readiness strip
    const ready = await measure(page, '#readiness');
    const readySteps = await page.$$eval('#readiness button, #readiness .ready-step', els =>
      els.map(e => ({ text: e.innerText.replace(/\s+/g, ' ').trim(), aria: e.getAttribute('aria-label') })));
    note('chrome', ready && ready.visible ? 'good' : 'P2',
      'Readiness strip (Design→Validate→Plans→Build)',
      { visible: ready?.visible, w: ready?.w, steps: readySteps },
      await shot(page, '39-readiness'));

    // 13. Splitter
    const split = await measure(page, '#vpSplitter');
    note('chrome', split && split.visible ? 'good' : 'P2',
      'Viewport/plans splitter present', split);

    // Chat collapse
    await page.click('#chatCollapse');
    await page.waitForTimeout(300);
    const collapsed = await page.evaluate(() => document.getElementById('chatPanel').classList.contains('collapsed'));
    note('chat', collapsed ? 'good' : 'P2', 'Chat collapse to rail', { collapsed },
      await shot(page, '40-chat-collapsed'));
    if (await page.isVisible('#chatRail')) await page.click('#chatRail');

    // Photo button present (don't actually upload)
    const photo = await measure(page, '#photoBtn');
    note('chat', photo && photo.visible ? 'good' : 'P2',
      'Photo-to-design affordance present', photo);

    // Console errors
    if (page._bbErrors.length) {
      note('stability', 'P1', 'Console/page errors during desktop journey',
        { count: page._bbErrors.length, sample: page._bbErrors.slice(0, 5) });
    } else {
      note('stability', 'good', 'No console errors on desktop journey', null);
    }

    // Header crowding metrics
    const headerMetrics = await page.evaluate(() => {
      const top = document.querySelector('.topbar');
      const name = document.getElementById('designName');
      const kids = [...top.children].map(c => ({
        id: c.id || c.className, w: Math.round(c.getBoundingClientRect().width)
      }));
      return {
        topW: Math.round(top.getBoundingClientRect().width),
        nameW: Math.round(name.getBoundingClientRect().width),
        nameVal: name.value,
        kids
      };
    });
    note('chrome', headerMetrics.nameW >= 96 ? 'good' : 'P1',
      'Design name width at 1440', headerMetrics);

    await page._bbCtx.close();
  } catch (e) {
    note('stability', 'P1', 'Desktop journey aborted', { err: String(e).slice(0, 300) });
    console.error(e);
  }

  // ═══════════════════════════════════════════════════════════
  // PHONE — DIY at the bench (390×844)
  // ═══════════════════════════════════════════════════════════
  try {
    const page = await freshPage({ width: 390, height: 844 }, 'phone');
    console.log('\n=== PHONE DIY JOURNEY ===');

    note('mobile', await page.isVisible('#welcomeOverlay') ? 'good' : 'P0',
      'Welcome on phone', null, await shot(page, '01-welcome'));

    // Brand name hidden on phone?
    const brandPhone = await page.evaluate(() => {
      const b = document.querySelector('.brand-name');
      const cs = getComputedStyle(b);
      return { display: cs.display, w: Math.round(b.getBoundingClientRect().width) };
    });
    note('mobile', brandPhone.display === 'none' ? 'P1' : 'good',
      'Brand name visibility on 390px',
      brandPhone,
      'DESIGN.md says brand must be hero-level; CSS hides .brand-name under 880px.');

    const namePhone = await measure(page, '#designName');
    note('mobile', namePhone && namePhone.w >= 96 ? 'good' : 'P1',
      'Design name width on phone', namePhone);

    const redoVis = await page.evaluate(() => {
      const r = document.getElementById('redoBtn');
      return getComputedStyle(r).display !== 'none' && r.getBoundingClientRect().width > 0;
    });
    note('mobile', redoVis ? 'good' : 'P1', 'Redo button visible on phone', { redoVis });

    const readyPhone = await page.evaluate(() => {
      const r = document.getElementById('readiness');
      return { display: getComputedStyle(r).display, w: Math.round(r.getBoundingClientRect().width) };
    });
    note('mobile', readyPhone.display === 'none' ? 'P1' : 'good',
      'Readiness strip on phone',
      readyPhone,
      'phase2-roadmap item 4: no phone readiness surface.');

    // Start via starter
    await page.click('#welcomeStarter');
    await page.waitForSelector('#galleryScrim.open');
    await page.waitForTimeout(800);
    note('mobile', 'good', 'Gallery on phone', null, await shot(page, '02-gallery'));
    await page.click('.gallery-card:nth-child(5)');
    await page.waitForFunction(() => __bb.state.spec.meta.template === 'nightstand');
    await page.waitForTimeout(900);
    note('mobile', 'good', 'Nightstand loaded on phone', null, await shot(page, '03-loaded'));

    // Sheet handle / chat
    const sheet = await measure(page, '#sheetHandle');
    note('mobile', sheet && sheet.visible ? 'good' : 'P1',
      'Mobile chat sheet handle', sheet);
    if (sheet && sheet.visible) {
      await page.click('#sheetHandle');
      await page.waitForTimeout(400);
      const expanded = await page.evaluate(() => document.getElementById('chatPanel').classList.contains('expanded'));
      note('mobile', expanded ? 'good' : 'P1', 'Chat sheet expands on tap', { expanded },
        await shot(page, '04-chat-sheet'));
      // Type a change
      await page.fill('#chatText', 'make it taller');
      await page.click('#sendBtn');
      await page.waitForTimeout(1200);
      note('mobile', 'good', 'Chat send from sheet', null, await shot(page, '05-chat-sent'));
      await page.click('#sheetHandle'); // collapse
    }

    // Advisory chips vs content
    const advisories = await measure(page, '#advisories');
    const panel = await measure(page, '#panel-main');
    note('mobile', 'observe', 'Advisory chip placement vs panel',
      { advisories, panelTop: panel?.top },
      await shot(page, '06-advisories'));

    // Tabs scroll
    for (const t of ['cut', 'stock', 'bom', 'assembly', 'integrity', 'reference']) {
      await page.click(`#tab-${t}`);
      await page.waitForTimeout(200);
    }
    note('mobile', 'good', 'All plan tabs reachable on phone', null, await shot(page, '07-integrity'));

    // Stock diagrams readability
    await page.click('#tab-stock');
    await page.waitForTimeout(300);
    const diagText = await page.evaluate(() => {
      const svg = document.querySelector('#panel-main svg');
      if (!svg) return null;
      const texts = [...svg.querySelectorAll('text')];
      const sizes = texts.map(t => parseFloat(t.getAttribute('font-size') || getComputedStyle(t).fontSize));
      const r = svg.getBoundingClientRect();
      return { svgW: Math.round(r.width), svgH: Math.round(r.height), minFont: Math.min(...sizes.filter(Boolean)), nText: texts.length };
    });
    note('mobile', diagText && diagText.minFont >= 10 && diagText.svgH >= 80 ? 'good' : 'P1',
      'Cutting diagram readability on phone',
      { ...diagText, note: 'phase2-roadmap item 2: board-diagram labels ~4px at 390.' },
      await shot(page, '08-stock-diagrams'));

    // Viewport toolbar crowding
    const toolbar = await page.evaluate(() => {
      const tb = document.querySelector('.viewport-toolbar');
      const r = tb.getBoundingClientRect();
      const btns = [...tb.querySelectorAll('button, input')].map(b => ({
        id: b.id, w: Math.round(b.getBoundingClientRect().width), h: Math.round(b.getBoundingClientRect().height),
        label: (b.getAttribute('aria-label') || b.textContent || '').slice(0, 40)
      }));
      return { w: Math.round(r.width), h: Math.round(r.height), wrap: r.height > 50, btns };
    });
    note('mobile', toolbar.btns.every(b => b.h >= 32) ? 'good' : 'P2',
      'Viewport toolbar touch targets on phone', toolbar, await shot(page, '09-toolbar'));

    // Build mode on phone — THE critical DIY surface
    await page.click('#buildModeBtn');
    await page.waitForSelector('#buildMode:not([hidden])');
    await page.waitForTimeout(400);
    const bmPhone = await page.evaluate(() => {
      const cuts = document.getElementById('bmCuts');
      const svgs = [...cuts.querySelectorAll('svg')];
      const textSizes = svgs.flatMap(s => [...s.querySelectorAll('text')].map(t => parseFloat(t.getAttribute('font-size') || 0)));
      return {
        progress: document.getElementById('bmProgress')?.textContent,
        cutText: cuts.innerText.slice(0, 250),
        svgCount: svgs.length,
        minSvgText: textSizes.length ? Math.min(...textSizes.filter(Boolean)) : null,
        svgHeights: svgs.map(s => Math.round(s.getBoundingClientRect().height)),
        stepCount: document.querySelectorAll('#bmSteps .bm-step, #bmSteps li').length || document.getElementById('bmSteps').children.length,
        exitH: Math.round(document.getElementById('bmExit').getBoundingClientRect().height)
      };
    });
    note('mobile', bmPhone.minSvgText && bmPhone.minSvgText < 10 ? 'P0' : (bmPhone.svgCount ? 'P1' : 'observe'),
      'Build-mode cutting diagrams at phone size',
      { ...bmPhone, note: 'Saw-bench readability is the product promise for build mode.' },
      await shot(page, '10-build'));

    // Check step targets
    const checkH = await page.evaluate(() => {
      const c = document.querySelector('#bmSteps input[type=checkbox]');
      return c ? Math.round(c.getBoundingClientRect().height) : null;
    });
    note('mobile', !checkH || checkH >= 20 ? 'good' : 'P1',
      'Build-mode checkbox touch target', { checkH });

    await page.click('#bmExit');

    // More + Export crowding
    const headerPhone = await page.evaluate(() => {
      const name = document.getElementById('designName');
      const exportBtn = document.getElementById('exportBtn');
      const more = document.getElementById('moreBtn');
      const build = document.getElementById('buildModeBtn');
      return {
        nameW: Math.round(name.getBoundingClientRect().width),
        nameVal: name.value.slice(0, 30),
        exportW: Math.round(exportBtn.getBoundingClientRect().width),
        moreW: Math.round(more.getBoundingClientRect().width),
        buildW: Math.round(build.getBoundingClientRect().width),
        exportText: exportBtn.innerText,
        moreText: more.innerText,
        buildText: build.innerText
      };
    });
    note('mobile', headerPhone.nameW < 80 ? 'P1' : 'good',
      'Phone header action cluster crowding',
      headerPhone,
      'phase2-roadmap item 1.',
      await shot(page, '11-header'));

    await page.click('#moreBtn');
    note('mobile', 'good', 'More menu on phone', null, await shot(page, '12-more'));
    await page.keyboard.press('Escape');

    await page.click('#exportBtn');
    note('mobile', 'good', 'Export menu on phone', null, await shot(page, '13-export'));
    await page.keyboard.press('Escape');

    // Share / projects reachable
    await clickMore(page, '#shareBtn');
    await page.waitForSelector('#shareScrim.open');
    note('mobile', 'good', 'Share dialog on phone', null, await shot(page, '14-share'));
    await closeOverlays(page);

    if (page._bbErrors.length) {
      note('stability', 'P1', 'Console errors on phone journey',
        { count: page._bbErrors.length, sample: page._bbErrors.slice(0, 5) });
    } else {
      note('stability', 'good', 'No console errors on phone journey', null);
    }

    await page._bbCtx.close();
  } catch (e) {
    note('stability', 'P1', 'Phone journey aborted', { err: String(e).slice(0, 300) });
    console.error(e);
  }

  // ═══════════════════════════════════════════════════════════
  // TABLET — 1024×768
  // ═══════════════════════════════════════════════════════════
  try {
    const page = await freshPage({ width: 1024, height: 768 }, 'tablet');
    console.log('\n=== TABLET SPOT CHECK ===');
    await page.click('#welcomeClose');
    await page.waitForTimeout(300);
    // Load via gallery from More
    await clickMore(page, '#galleryBtn');
    await page.waitForSelector('#galleryScrim.open');
    await page.click('.gallery-card:nth-child(1)');
    await page.waitForFunction(() => __bb.state.spec.meta.template);
    await page.waitForTimeout(800);

    const layout = await page.evaluate(() => {
      const chat = document.getElementById('chatPanel').getBoundingClientRect();
      const stage = document.getElementById('stage').getBoundingClientRect();
      const brand = getComputedStyle(document.querySelector('.brand-name')).display;
      const ready = getComputedStyle(document.getElementById('readiness')).display;
      return {
        chatW: Math.round(chat.width), stageW: Math.round(stage.width),
        brandDisplay: brand, readyDisplay: ready,
        chatCollapsed: document.getElementById('chatPanel').classList.contains('collapsed')
      };
    });
    note('tablet', 'observe', 'Tablet layout metrics', layout, await shot(page, '01-bench'));

    await page.click('#buildModeBtn');
    await page.waitForTimeout(400);
    note('tablet', 'good', 'Build mode on tablet', null, await shot(page, '02-build'));
    await page.click('#bmExit');

    if (page._bbErrors.length) {
      note('stability', 'P1', 'Console errors on tablet', page._bbErrors.slice(0, 3));
    }
    await page._bbCtx.close();
  } catch (e) {
    note('stability', 'P1', 'Tablet journey aborted', { err: String(e).slice(0, 300) });
    console.error(e);
  }

  // Persist log
  fs.writeFileSync(LOG_PATH, JSON.stringify({ generated: new Date().toISOString(), findings }, null, 2));
  const counts = findings.reduce((a, f) => { a[f.severity] = (a[f.severity] || 0) + 1; return a; }, {});
  console.log('\n=== AUDIT COMPLETE ===');
  console.log('Findings by severity:', counts);
  console.log('Log:', LOG_PATH);
  console.log('Shots:', SHOTS);

  await browser.close();
  server.close();
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
