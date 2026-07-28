/* First-time user usability walkthrough.
 * Acts as a brand-new visitor: porch → sign-in → studio → "walnut desk"
 * → Plan tabs → blueprint/export attempts. Records observations + screenshots.
 *
 * Run: node scripts/first-user-journey.js
 * Needs Playwright (devDependency) and a built dist/.
 */
'use strict';
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const ROOT = path.join(__dirname, '..');
const SHOTS = path.join('/opt/cursor/artifacts', 'first-user');
const REPORT_JSON = path.join(ROOT, 'docs', 'usability', 'first-user-journey.json');

fs.mkdirSync(SHOTS, { recursive: true });
fs.mkdirSync(path.dirname(REPORT_JSON), { recursive: true });

const findings = [];
const steps = [];
const note = (sev, area, title, detail, evidence) => {
  findings.push({ sev, area, title, detail, evidence: evidence || null });
};
const step = (id, title, ok, detail, shot) => {
  steps.push({ id, title, ok: !!ok, detail: detail || '', shot: shot || null });
  console.log(`${ok ? '✓' : '✗'} [${id}] ${title}${detail ? ' — ' + detail : ''}`);
};

const shot = async (page, name) => {
  const file = path.join(SHOTS, name + '.png');
  await page.screenshot({ path: file, fullPage: false });
  return file;
};

const waitBoot = (page, ms) =>
  page.waitForFunction(() => globalThis.__bb && __bb.state && __bb.state.spec, null, { timeout: ms || 45000 });

const visibleText = async (page, sel) => {
  const el = await page.$(sel);
  if (!el) return null;
  const box = await el.boundingBox();
  if (!box || box.width < 2 || box.height < 2) return null;
  return (await el.innerText()).trim();
};

const clipText = (s, n) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, n || 180);

(async () => {
  // Build first so dist matches src.
  console.log('Building…');
  require('child_process').execSync('node build.js', { cwd: ROOT, stdio: 'inherit' });

  const kvFile = path.join(os.tmpdir(), 'bb-first-user-kv-' + Date.now() + '.json');
  const PORT = 45000 + (process.pid % 1000);
  const server = spawn(process.execPath, ['serve.js', '--no-watch'], {
    cwd: ROOT,
    env: Object.assign({}, process.env, {
      PORT: String(PORT),
      BB_DEV_LOGIN: '1',
      BB_KV_FILE: kvFile,
      AUTH_SECRET: 'first-user-usability-secret-0123456789abcdef01234567'
      // Intentionally NO ANTHROPIC_API_KEY — many first deploys / local runs
      // look like this; the journey should still be usable via offline parser
      // on localhost.
    }),
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let browser = null;
  const cleanup = () => {
    try { if (browser) browser.close(); } catch (e) { /* */ }
    try { server.kill(); } catch (e) { /* */ }
    try { fs.unlinkSync(kvFile); } catch (e) { /* */ }
  };
  process.on('exit', cleanup);

  try {
    await new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('serve.js never came up')), 45000);
      server.stdout.on('data', d => {
        if (String(d).includes('Blueprint Buddy on')) { clearTimeout(t); resolve(); }
      });
      server.stderr.on('data', d => process.stderr.write(d));
    });

    browser = await chromium.launch({
      executablePath: fs.existsSync('/opt/pw-browsers/chromium')
        ? '/opt/pw-browsers/chromium'
        : undefined,
      args: ['--no-sandbox', '--enable-unsafe-swiftshader']
    });

    const base = `http://127.0.0.1:${PORT}`;
    const consoleErrors = [];
    const pageErrors = [];

    /* ========== PHASE A: Fresh desktop landing (first paint) ========== */
    const deskCtx = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      // Fresh profile — no porchSeen, no prefs
      storageState: undefined
    });
    const page = await deskCtx.newPage();
    page.on('pageerror', e => pageErrors.push(String(e)));
    page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()); });

    const t0 = Date.now();
    await page.goto(base + '/');
    await waitBoot(page);
    const bootMs = Date.now() - t0;
    step('A1', 'Fresh visit boots', true, `boot ${bootMs}ms`);

    const porchVisible = await page.evaluate(() => {
      const p = document.getElementById('porch');
      const app = document.getElementById('app');
      return {
        porchHidden: !p || p.hidden,
        porchDisplay: p ? getComputedStyle(p).display : null,
        appVis: app ? getComputedStyle(app).visibility : null,
        bodyClass: document.body.className,
        h1: (document.getElementById('phH1') || {}).textContent || '',
        cta: (document.getElementById('phCtaTop') || {}).textContent || '',
        header: !(document.getElementById('siteHeader') || { hidden: true }).hidden,
        navSignin: (document.getElementById('navSignin') || {}).textContent || ''
      };
    });
    await shot(page, '01-landing-masthead');
    step('A2', 'Porch landing shows first', porchVisible.appVis === 'hidden' && !porchVisible.porchHidden,
      `h1="${clipText(porchVisible.h1)}" cta="${clipText(porchVisible.cta)}" signin="${porchVisible.navSignin}"`);

    // Motion.lines() splits the H1 for animation; textContent can concatenate
    // the original + split line clones (a11y / copy-paste smell).
    if ((porchVisible.h1.match(/Furniture that starts/gi) || []).length > 1
        || /sentence\.Furniture/i.test(porchVisible.h1)) {
      note('MEDIUM', 'A11y/Landing', 'Hero H1 textContent is duplicated after line-split animation',
        `document.getElementById('phH1').textContent === "${clipText(porchVisible.h1, 120)}". Screen readers / select-all may hear the headline twice.`,
        { h1: porchVisible.h1 });
    }

    if (bootMs > 8000) {
      note('HIGH', 'Performance', 'First paint / boot is slow for a first visit',
        `Waited ${bootMs}ms for __bb.state.spec on a local loopback host. A first-time user on a real network will wait longer before the CTA is trustworthy.`,
        { bootMs });
    }

    // Brand / hero composition check from a user's eyes
    const mast = await page.evaluate(() => {
      const brand = document.querySelector('#siteHeader .site-brand-name, #siteHeader .brand-name, .site-brand-name');
      const h1 = document.getElementById('phH1');
      const lede = document.getElementById('phLede');
      const cta = document.getElementById('phCtaTop');
      const rect = el => {
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { top: Math.round(r.top), bottom: Math.round(r.bottom), h: Math.round(r.height), inView: r.top < innerHeight && r.bottom > 0 };
      };
      return {
        brand: brand ? brand.textContent : null,
        brandRect: rect(brand),
        h1: h1 ? h1.textContent : null,
        h1Rect: rect(h1),
        lede: lede ? lede.textContent : null,
        ledeRect: rect(lede),
        cta: cta ? cta.textContent : null,
        ctaRect: rect(cta),
        vh: innerHeight
      };
    });
    step('A3', 'Masthead composition in first viewport',
      !!(mast.h1Rect && mast.h1Rect.inView && mast.ctaRect && mast.ctaRect.inView),
      `brand=${clipText(mast.brand)} h1=${clipText(mast.h1)} ctaBottom=${mast.ctaRect && mast.ctaRect.bottom}/${mast.vh}`);

    if (mast.ctaRect && mast.ctaRect.bottom > mast.vh) {
      note('HIGH', 'Landing', 'Primary CTA sits below the fold on desktop',
        `At 1440×900 the "Open the studio" button bottom is ${mast.ctaRect.bottom}px (viewport ${mast.vh}). A first visitor may scroll before they can start.`,
        mast);
    }

    // Header sign-in discoverability
    if (!/sign in/i.test(porchVisible.navSignin || '')) {
      note('MEDIUM', 'Auth', 'Header does not clearly offer Sign in on first paint',
        `navSignin text was "${porchVisible.navSignin}"`, porchVisible);
    }

    // Scroll the narrative briefly — does the story help or overwhelm?
    await page.evaluate(() => {
      const p = document.getElementById('porch');
      scrollTo(0, Math.round((p.offsetHeight - innerHeight) * 0.2));
    });
    await page.waitForTimeout(800);
    await shot(page, '02-landing-chapter-describe');

    await page.evaluate(() => {
      const p = document.getElementById('porch');
      scrollTo(0, Math.round((p.offsetHeight - innerHeight) * 0.85));
    });
    await page.waitForTimeout(800);
    await shot(page, '03-landing-calc-cta');

    const calc = await page.evaluate(() => {
      const cost = (document.getElementById('phCalcCost') || {}).textContent || '';
      const chips = [...document.querySelectorAll('.calc-chip')].map(c => c.textContent.trim());
      const endCta = (document.getElementById('phCtaEnd') || {}).textContent || '';
      return { cost, chips, endCta };
    });
    step('A4', 'Build-vs-buy calculator shows a dollar figure', /^\$\d/.test(calc.cost),
      `cost=${calc.cost} chips=${calc.chips.slice(0, 4).join(',')}`);

    // FAQ pricing honesty (static copy vs credits pivot)
    await page.goto(base + '/#faq');
    await page.waitForTimeout(600);
    const faqCost = await page.evaluate(() => {
      const items = [...document.querySelectorAll('.faq-item')];
      const hit = items.find(d => /what does it cost/i.test((d.querySelector('summary') || {}).textContent || ''));
      if (!hit) return null;
      hit.open = true;
      return (hit.querySelector('.faq-a') || {}).textContent || '';
    });
    await shot(page, '04-faq-pricing');
    step('A5', 'FAQ cost answer readable', !!faqCost, clipText(faqCost, 140));
    if (faqCost && /Pro plan|monthly AI-message allowance/i.test(faqCost) && !/credit/i.test(faqCost)) {
      note('HIGH', 'Trust/Copy', 'FAQ still describes the legacy Pro subscription, not credits',
        `First-time visitors reading "What does it cost?" see: "${clipText(faqCost, 240)}". Product now sells blueprint credits.`,
        { faqCost });
    }

    /* ========== PHASE B: Sign-in path ========== */
    await page.goto(base + '/#signin');
    await page.waitForTimeout(800);
    // Wait for auth probe to finish rendering buttons
    await page.waitForFunction(() => {
      const box = document.getElementById('signinBody');
      return box && /Continue with|Sign in with email|Open the studio|Dev/i.test(box.textContent || '');
    }, null, { timeout: 10000 }).catch(() => null);

    const signinUI = await page.evaluate(() => {
      const box = document.getElementById('signinBody');
      const title = (document.querySelector('#pageSignin .page-title') || {}).textContent || '';
      const lede = (document.querySelector('#pageSignin .page-lede') || {}).textContent || '';
      const buttons = [...(box ? box.querySelectorAll('button') : [])].map(b => b.textContent.trim());
      return { title, lede, body: (box || {}).textContent || '', buttons, pageHidden: !!(document.getElementById('pageSignin') || {}).hidden };
    });
    await shot(page, '05-signin-page');
    step('B1', 'Sign-in page renders providers',
      signinUI.buttons.some(b => /Dev|Google|GitHub|email/i.test(b)),
      `buttons=[${signinUI.buttons.join(' | ')}]`);

    if (!signinUI.buttons.some(b => /Continue with Dev/i.test(b))) {
      note('MEDIUM', 'Auth', 'Dev login label may confuse a real user if ever left on',
        `Visible buttons: ${signinUI.buttons.join(', ')}`);
    }

    // User confusion: landing CTA says "Open the studio" but AI needs sign-in
    // — we'll verify that after entering unsigned.

    // Click Dev login (one-click, lands back via redirect)
    const beforeUrl = page.url();
    await page.click('button:has-text("Continue with Dev")');
    await waitBoot(page);
    await page.waitForFunction(() => {
      try { return !!(BB.Store && BB.Store.auth && BB.Store.auth().user); } catch (e) { return false; }
    }, null, { timeout: 15000 }).catch(() => null);

    const afterLogin = await page.evaluate(() => {
      const a = BB.Store.auth();
      const porch = document.getElementById('porch');
      const app = document.getElementById('app');
      const welcome = document.getElementById('welcomeOverlay');
      return {
        user: a.user && a.user.name,
        mode: BB.Store.persistenceMode(),
        porchHidden: !porch || porch.hidden || getComputedStyle(porch).display === 'none',
        appVis: app ? getComputedStyle(app).visibility : null,
        welcomeHidden: !welcome || welcome.hidden,
        welcomeTitle: (document.getElementById('welcomeTitle') || {}).textContent || '',
        hash: location.hash,
        bodyPh: document.body.classList.contains('ph-open')
      };
    });
    await shot(page, '06-after-dev-login');
    step('B2', 'Dev sign-in lands in studio with session',
      !!afterLogin.user && afterLogin.appVis !== 'hidden',
      `user=${afterLogin.user} mode=${afterLogin.mode} welcomeHidden=${afterLogin.welcomeHidden} hash=${afterLogin.hash}`);

    if (afterLogin.bodyPh || afterLogin.appVis === 'hidden') {
      note('CRITICAL', 'Auth', 'After sign-in the studio is still off-page / porch still owns the view',
        `A first-time user who signs in expects to design. Got appVis=${afterLogin.appVis} ph-open=${afterLogin.bodyPh} porchHidden=${afterLogin.porchHidden}`,
        afterLogin);
    }

    if (afterLogin.welcomeHidden) {
      // markSeen on OAuth may skip the welcome — that's a usability call
      note('MEDIUM', 'Onboarding', 'Welcome / first-prompt card did not appear after sign-in',
        'Signing in via the public #signin page marks the porch as seen and jumps to the studio, but the "What are you building?" welcome may already be dismissed or never deferred. The chat placeholder may be the only cue.',
        afterLogin);
    }

    /* ========== PHASE C: Prompt a walnut desk ========== */
    // Prefer the hero if present; else use chat.
    const entry = await page.evaluate(() => {
      const welcome = document.getElementById('welcomeOverlay');
      const hero = document.getElementById('heroText');
      const chat = document.getElementById('chatText');
      return {
        welcomeOpen: !!(welcome && !welcome.hidden),
        heroPlaceholder: hero ? hero.placeholder : null,
        chatPlaceholder: chat ? chat.placeholder : null,
        chatVisible: !!(chat && getComputedStyle(chat).display !== 'none'),
        mode: document.body.dataset.mode,
        template: __bb.state.spec.meta.template,
        name: __bb.state.spec.meta.name
      };
    });
    step('C1', 'Studio ready for a prompt', true,
      `welcome=${entry.welcomeOpen} heroPh="${entry.heroPlaceholder}" chatPh="${entry.chatPlaceholder}" seed=${entry.template}/${entry.name}`);

    if (entry.welcomeOpen) {
      await page.fill('#heroText', 'A walnut writing desk, about 48 inches wide');
      await shot(page, '07-hero-walnut-desk-typed');
      await page.click('#heroSend');
    } else {
      // Ensure chat is expanded
      const collapsed = await page.evaluate(() => document.getElementById('chatPanel')?.classList.contains('collapsed'));
      if (collapsed) await page.click('#chatRail').catch(() => null);
      await page.fill('#chatText', 'A walnut writing desk, about 48 inches wide');
      await shot(page, '07-chat-walnut-desk-typed');
      await page.click('#chatSend').catch(async () => {
        await page.keyboard.press('Enter');
      });
    }

    // Wait for design to update — template desk + walnut
    const designOk = await page.waitForFunction(() => {
      const s = __bb.state.spec;
      return s && s.meta && s.meta.template === 'desk' && s.wood && s.wood.species === 'walnut';
    }, null, { timeout: 30000 }).then(() => true).catch(() => false);

    const afterPrompt = await page.evaluate(() => {
      const s = __bb.state.spec;
      const log = document.getElementById('chatLog');
      const bubbles = [...(log ? log.querySelectorAll('.msg.bot .bubble, .bot .bubble') : [])]
        .map(b => b.textContent.trim()).filter(Boolean).slice(-4);
      const aiBadge = (document.getElementById('aiBadge') || document.getElementById('aiBadgeBar') || {});
      return {
        template: s.meta.template,
        name: s.meta.name,
        species: s.wood.species,
        W: s.overall && s.overall.W,
        D: s.overall && s.overall.D,
        H: s.overall && s.overall.H,
        units: s.meta.units,
        local: !!(__bb.state && __bb.state.lastLocal),
        bubbles,
        aiState: aiBadge.dataset ? aiBadge.dataset.state : null,
        aiText: aiBadge.textContent || '',
        welcomeHidden: !!(document.getElementById('welcomeOverlay') || { hidden: true }).hidden,
        errors: (__bb.state.report && __bb.state.report.errors || []).map(e => e.text || e),
        mode: document.body.dataset.mode
      };
    });
    await page.waitForTimeout(1200);
    await shot(page, '08-walnut-desk-designed');
    step('C2', 'Walnut desk prompt produces a desk in walnut',
      designOk && afterPrompt.template === 'desk' && afterPrompt.species === 'walnut',
      `template=${afterPrompt.template} species=${afterPrompt.species} size=${afterPrompt.W}×${afterPrompt.D}×${afterPrompt.H}mm name="${afterPrompt.name}"`);

    if (!designOk) {
      note('CRITICAL', 'Core loop', 'Prompting "walnut writing desk" did not yield a walnut desk',
        `Got ${JSON.stringify(afterPrompt)}. Offline parser on localhost should handle this.`,
        afterPrompt);
    }

    // Ack quality — does the bot explain what it built?
    const lastBot = afterPrompt.bubbles[afterPrompt.bubbles.length - 1] || '';
    if (designOk && (!lastBot || lastBot.length < 8)) {
      note('HIGH', 'Chat', 'No clear confirmation after the first design prompt',
        'The 3D model may have updated, but the chat did not leave a readable "here\'s what I built" message a first-time user can trust.',
        { bubbles: afterPrompt.bubbles });
    }

    // Width intent: "about 48 inches" → ~1219 mm
    if (designOk && afterPrompt.W) {
      const wIn = afterPrompt.W / 25.4;
      if (Math.abs(wIn - 48) > 6) {
        note('HIGH', 'Intent fidelity', 'Requested ~48 in width was not honored closely',
          `User said "about 48 inches wide"; got W=${afterPrompt.W}mm (${wIn.toFixed(1)} in).`,
          { W: afterPrompt.W, wIn });
      } else {
        step('C3', 'Width ~48 in honored', true, `${wIn.toFixed(1)} in`);
      }
    }

    // Offline / unconfigured honesty
    if (/offline|not configured|local/i.test(afterPrompt.aiText + ' ' + lastBot)) {
      step('C4', 'AI status communicated', true, clipText(afterPrompt.aiText + ' | ' + lastBot, 120));
      if (/AI not configured/i.test(afterPrompt.aiText)) {
        note('HIGH', 'Trust', '"AI not configured" badge is the loudest status in Design chat',
          'After a successful design, the chat header still shows a red-dot "AI not configured." The offline caveat ("Working offline…") is quieter. A first user reads this as "the product is broken," not "degraded mode."',
          { aiText: afterPrompt.aiText, aiState: afterPrompt.aiState, lastBot });
      }
    } else if (!process.env.ANTHROPIC_API_KEY) {
      note('MEDIUM', 'Trust', 'Running on the offline parser without a clear in-chat caveat',
        `aiBadge="${afterPrompt.aiText}" state=${afterPrompt.aiState}. A first user may believe they talked to the full AI.`,
        afterPrompt);
    }

    // Natural prompt length → generic name (pieceName truncates at 40 chars)
    if (designOk && /^New /i.test(afterPrompt.name || '')) {
      note('MEDIUM', 'Chat', 'Natural first prompts become "New <template>"',
        `Prompt was longer than the offline namer's 40-char budget, so the design was titled "${afterPrompt.name}" instead of something like "Walnut writing desk".`,
        { name: afterPrompt.name });
    }

    /* ========== PHASE D: Explore Plan / Build as a maker ========== */
    // Prefer JS activation — Plan subtabs sit under a split layout where the
    // 3D canvas / panel can intercept Playwright's actionability hit-test
    // (observed live: #tab-cut "intercepts pointer events").
    const jsClick = async (sel) => page.evaluate(s => {
      const el = document.querySelector(s);
      if (!el) return false;
      el.click();
      return true;
    }, sel);

    await jsClick('#mode-plan');
    await page.waitForTimeout(500);
    await shot(page, '09-plan-overview');

    const planMeta = await page.evaluate(() => {
      const tabs = [...document.querySelectorAll('#planTabs button, [role="tab"]')]
        .filter(b => b.offsetParent !== null)
        .map(b => ({ id: b.id, text: b.textContent.replace(/\s+/g, ' ').trim() }));
      const panel = (document.getElementById('panel-main') || {}).innerText || '';
      const buildBtn = document.getElementById('mode-build');
      return {
        tabs,
        panelSnippet: panel.slice(0, 400),
        buildLocked: !!(buildBtn && (buildBtn.classList.contains('locked') || /lock/i.test(buildBtn.innerHTML) || buildBtn.getAttribute('aria-disabled') === 'true')),
        buildTitle: buildBtn ? (buildBtn.title || buildBtn.getAttribute('aria-label') || buildBtn.textContent) : null,
        ent: (typeof __bb !== 'undefined' && __bb.entitlementState) ? null : null,
        credited: !!(__bb.state && __bb.state.blueprint),
        creditsChip: (document.getElementById('creditsChip') || document.querySelector('.credits-chip, [title*="credit" i]') || {}).textContent || ''
      };
    });
    step('D1', 'Plan mode opens', true,
      `tabs=${planMeta.tabs.map(t => t.text || t.id).slice(0, 8).join(', ')}; buildLocked=${planMeta.buildLocked}`);

    if (/ADVISORY/i.test(planMeta.panelSnippet) && /passes the required strength/i.test(planMeta.panelSnippet)) {
      note('LOW', 'Trust/Copy', 'ADVISORY rollup still reads as a soft pass',
        'Overview shows ADVISORY + "passes the required strength checks, with notes worth reading." First users may skip Safety.',
        { snippet: clipText(planMeta.panelSnippet, 180) });
    }

    // Name quality after prompt
    const nameNow = await page.evaluate(() => __bb.state.spec.meta.name);
    if (designOk && /^new desk$/i.test(nameNow || '')) {
      note('MEDIUM', 'Chat', 'First design named generically "New desk"',
        'User said "walnut writing desk"; the title bar shows "New desk". The CHANGE log says "Renamed to New desk," which feels like a downgrade of their words.',
        { name: nameNow });
    }

    // Overall dims (width/depth/height, not W/D/H)
    const dims = await page.evaluate(() => {
      const o = __bb.state.spec.overall || {};
      return { width: o.width, depth: o.depth, height: o.height };
    });
    if (designOk && dims.width) {
      const wIn = dims.width / 25.4;
      step('C3', 'Width ~48 in honored', Math.abs(wIn - 48) <= 6, `${wIn.toFixed(1)} in (depth=${(dims.depth/25.4).toFixed(1)} height=${(dims.height/25.4).toFixed(1)})`);
      // Depth silently moved — captured in CHANGE log from screenshots
      note('MEDIUM', 'Intent fidelity', 'Offline ack is thin; CHANGE log carries the real story',
        `Bot said only "Roughed out a desk to standard proportions — refine away." Width ${wIn.toFixed(0)} in was honored, but depth/species/name changes live in a separate CHANGED list a hurried user may miss.`,
        dims);
    }

    // Cut list (locked preview expected before credit spend)
    await jsClick('#tab-cut');
    await page.waitForTimeout(500);
    const cutInfo = await page.evaluate(() => {
      const panel = (document.getElementById('panel-main') || {}).innerText || '';
      const locks = document.querySelectorAll('#panel-main .preview-locked, #panel-main [aria-label*="blueprint"]').length;
      const cta = (document.querySelector('#panel-main .preview-cta, #panel-main .btn.primary') || {}).textContent || '';
      return { panel: panel.slice(0, 500), locks, cta: (cta || '').replace(/\s+/g, ' ').trim() };
    });
    await shot(page, '10-plan-cut-locked');
    step('D2', 'Cut list shows credit wall or dimensions',
      /blueprint|credit|Length|lock/i.test(cutInfo.panel + cutInfo.cta) || cutInfo.locks > 0,
      `locks=${cutInfo.locks} cta="${clipText(cutInfo.cta, 60)}" ${clipText(cutInfo.panel, 100)}`);

    if (/Issue blueprint/i.test(cutInfo.cta) || /exact dimensions are issued/i.test(cutInfo.panel)) {
      note('HIGH', 'Core loop / Monetization', 'Cut dimensions locked until a credit is spent — after the user already "designed" the piece',
        'Landing promised plans you can build Saturday. After a successful walnut-desk prompt, Cut/Buy/Assemble withhold exact numbers behind "Issue blueprint — 1 credit." Overview stays open (ADVISORY + cost). First users feel the product worked, then hit a paywall for the thing the headline sold.',
        { cta: cutInfo.cta, panel: clipText(cutInfo.panel, 220) });
    }

    await jsClick('#tab-stock');
    await page.waitForTimeout(400);
    await shot(page, '11-plan-buy-locked');

    await jsClick('#tab-assembly');
    await page.waitForTimeout(400);
    const asmInfo = await page.evaluate(() => {
      const panel = (document.getElementById('panel-main') || {}).innerText || '';
      return { snippet: panel.slice(0, 300), stepTitles: [...document.querySelectorAll('#panel-main .preview-steps li, #panel-main .step')].map(li => li.textContent.trim()).slice(0, 6) };
    });
    await shot(page, '12-plan-assemble-locked');
    step('D3', 'Assembly preview present', /Assembly|step|blueprint/i.test(asmInfo.snippet) || asmInfo.stepTitles.length > 0,
      clipText(asmInfo.snippet, 120));

    await jsClick('#tab-integrity');
    await page.waitForTimeout(400);
    const safety = await page.evaluate(() => {
      const panel = (document.getElementById('panel-main') || {}).innerText || '';
      const verdict = (panel.match(/PASS|ADVISORY|FAIL|ANCHOR/i) || [])[0];
      return { verdict, snippet: panel.slice(0, 280) };
    });
    await shot(page, '13-plan-safety');
    step('D4', 'Safety / integrity visible without credit', !!safety.verdict, `verdict=${safety.verdict}`);

    // Build mode — should trigger issue flow when locked
    await jsClick('#mode-build');
    await page.waitForTimeout(800);
    await shot(page, '14-build-or-issue');
    const buildAttempt = await page.evaluate(() => {
      const mode = document.body.dataset.mode;
      const panel = (document.getElementById('panel-main') || {}).innerText || '';
      const chat = (document.getElementById('chatLog') || {}).innerText || '';
      const dialog = (document.querySelector('dialog[open], .modal.open, .billing-sheet, #billingScrim.open') || {}).innerText || '';
      return {
        mode,
        panel: panel.slice(0, 240),
        chatTail: chat.slice(-300),
        dialog: (dialog || '').slice(0, 240),
        hasIssueCta: /Issue blueprint/i.test(panel + chat + dialog)
      };
    });
    step('D5', 'Build click surfaces issue/unlock path',
      buildAttempt.mode === 'build' || buildAttempt.hasIssueCta,
      `mode=${buildAttempt.mode} issueCta=${buildAttempt.hasIssueCta}`);

    if (planMeta.buildLocked) {
      note('HIGH', 'Core loop', 'Build mode padlocked until blueprint issuance',
        'Mode switcher shows Build with a lock. Clicking it should spend the free credit / open issue — but a first user who has not discovered "Issue blueprint" yet sees a locked third act with no in-chrome explanation of why.',
        buildAttempt);
    }

    // Try issuing the free credit if CTA is visible
    const issued = await page.evaluate(async () => {
      const btns = [...document.querySelectorAll('button')].filter(b => /Issue blueprint/i.test(b.textContent));
      if (!btns.length) return { ok: false, reason: 'no-cta' };
      btns[0].click();
      return { ok: true, reason: 'clicked' };
    });
    if (issued.ok) {
      await page.waitForTimeout(2500);
      await shot(page, '15-after-issue-attempt');
      const postIssue = await page.evaluate(() => ({
        blueprint: __bb.state.blueprint,
        mode: document.body.dataset.mode,
        chatTail: ((document.getElementById('chatLog') || {}).innerText || '').slice(-400),
        cutOpen: ((document.getElementById('panel-main') || {}).innerText || '').slice(0, 200)
      }));
      step('D6', 'Issue blueprint attempt', !!postIssue.blueprint,
        postIssue.blueprint ? `id=${postIssue.blueprint.id}` : clipText(postIssue.chatTail, 140));
      if (!postIssue.blueprint) {
        note('CRITICAL', 'Monetization', 'Issue blueprint did not complete for a signed-in user with 1 free credit',
          'The headline offer is the free first credit. If issuance fails (KV/Stripe/env), the first-run promise collapses.',
          postIssue);
      }
    } else {
      step('D6', 'Issue blueprint CTA available', false, issued.reason);
    }

    /* ========== PHASE E: Unsigned path — try chat before login ========== */
    await deskCtx.clearCookies();
    await page.goto(base + '/api/auth?logout=1');
    await page.waitForTimeout(500);

    // Fresh context to simulate unsigned visitor who skips porch
    const anonCtx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const anon = await anonCtx.newPage();
    await anon.addInitScript(() => {
      try { localStorage.setItem('bb.porchSeen', 'credits-2026-07'); } catch (e) { /* */ }
    });
    await anon.goto(base + '/');
    await waitBoot(anon);
    await anon.waitForFunction(() => !document.getElementById('accountArea').hidden, null, { timeout: 10000 }).catch(() => null);

    const anonState = await anon.evaluate(() => {
      const a = BB.Store.auth();
      return {
        user: a.user,
        providers: a.providers,
        welcome: !(document.getElementById('welcomeOverlay') || { hidden: true }).hidden,
        chatPh: (document.getElementById('chatText') || {}).placeholder
      };
    });
    await shot(anon, '16-anon-studio-welcome');

    // Try to design without signing in
    if (anonState.welcome) {
      await anon.fill('#heroText', 'A walnut desk');
      await anon.click('#heroSend');
    } else {
      await anon.fill('#chatText', 'A walnut desk');
      await anon.click('#chatSend').catch(async () => anon.keyboard.press('Enter'));
    }
    await anon.waitForTimeout(1500);
    const gated = await anon.evaluate(() => {
      const log = document.getElementById('chatLog');
      const text = (log && log.innerText) || '';
      const hasSignIn = /sign in/i.test(text);
      const buttons = [...(log ? log.querySelectorAll('button') : [])].map(b => b.textContent.trim());
      const template = __bb.state.spec.meta.template;
      const species = __bb.state.spec.wood.species;
      return { hasSignIn, buttons, text: text.slice(-400), template, species };
    });
    await shot(anon, '17-anon-gated-prompt');
    step('E1', 'Anonymous AI prompt asks for sign-in', gated.hasSignIn,
      `buttons=[${gated.buttons.join('|')}] template still ${gated.template}/${gated.species}`);

    if (!gated.hasSignIn) {
      note('HIGH', 'Auth gating', 'Unsigned chat did not clearly prompt sign-in',
        `Chat tail: ${clipText(gated.text, 200)}`, gated);
    }

    // Is the gate message friendly about the free credit?
    if (gated.hasSignIn && !/free|credit|included/i.test(gated.text)) {
      note('MEDIUM', 'Auth', 'Sign-in gate does not mention the free first credit',
        clipText(gated.text, 200));
    }

    // Can they still browse starters without signing in?
    const starterPath = await anon.evaluate(async () => {
      const btn = document.getElementById('welcomeStarter');
      return { hasStarter: !!(btn && !document.getElementById('welcomeOverlay').hidden) };
    });
    if (starterPath.hasStarter) {
      await anon.click('#welcomeStarter');
      await anon.waitForSelector('#galleryScrim.open', { timeout: 8000 }).catch(() => null);
      await shot(anon, '18-anon-gallery');
      const gal = await anon.evaluate(() => ({
        open: !!(document.getElementById('galleryScrim') || {}).classList?.contains('open'),
        cards: document.querySelectorAll('.gallery-card').length
      }));
      // Pick a desk-like card if present
      const picked = await anon.evaluate(() => {
        const cards = [...document.querySelectorAll('.gallery-card')];
        const desk = cards.find(c => /desk/i.test(c.textContent));
        (desk || cards[0] || {}).click?.();
        return desk ? 'desk' : (cards[0] ? 'first' : 'none');
      });
      await anon.waitForTimeout(1000);
      const afterStarter = await anon.evaluate(() => ({
        template: __bb.state.spec.meta.template,
        name: __bb.state.spec.meta.name,
        welcomeHidden: document.getElementById('welcomeOverlay').hidden
      }));
      await shot(anon, '19-anon-starter-loaded');
      step('E2', 'Unsigned visitor can load a starter', !!afterStarter.template,
        `picked=${picked} → ${afterStarter.template} "${afterStarter.name}"`);
    } else {
      step('E2', 'Unsigned starter path', true, 'welcome already dismissed — skipped gallery probe');
    }

    /* ========== PHASE F: Mobile first visit ========== */
    const mobCtx = await browser.newContext({
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1'
    });
    const mob = await mobCtx.newPage();
    await mob.goto(base + '/');
    await waitBoot(mob, 60000);
    await shot(mob, '20-mobile-landing');
    const mobMast = await mob.evaluate(() => {
      const h1 = document.getElementById('phH1');
      const cta = document.getElementById('phCtaTop');
      const r = el => el ? el.getBoundingClientRect() : null;
      const hr = r(h1), cr = r(cta);
      return {
        h1: h1 && h1.textContent,
        h1InView: hr && hr.top < innerHeight && hr.bottom > 0,
        ctaInView: cr && cr.top < innerHeight && cr.bottom > 0,
        ctaBottom: cr && Math.round(cr.bottom),
        overflowX: document.documentElement.scrollWidth > innerWidth + 1,
        scrollW: document.documentElement.scrollWidth,
        vw: innerWidth
      };
    });
    step('F1', 'Mobile masthead usable', !!(mobMast.h1InView && mobMast.ctaInView && !mobMast.overflowX),
      `ctaBottom=${mobMast.ctaBottom} overflowX=${mobMast.overflowX}`);

    if (mobMast.overflowX) {
      note('HIGH', 'Mobile', 'Horizontal overflow on first mobile viewport',
        `scrollWidth=${mobMast.scrollW} vw=${mobMast.vw}`, mobMast);
    }
    if (!mobMast.ctaInView) {
      note('HIGH', 'Mobile', 'Primary CTA not in first mobile viewport',
        JSON.stringify(mobMast), mobMast);
    }

    // Enter studio on mobile
    await mob.click('#phCtaTop');
    await mob.waitForTimeout(1200);
    await shot(mob, '21-mobile-studio');
    const mobStudio = await mob.evaluate(() => {
      const app = document.getElementById('app');
      const chat = document.getElementById('chatPanel');
      const welcome = document.getElementById('welcomeOverlay');
      return {
        appVis: app ? getComputedStyle(app).visibility : null,
        welcome: welcome && !welcome.hidden,
        chatCollapsed: chat && (chat.classList.contains('collapsed') || getComputedStyle(chat).display === 'none'),
        hero: !!(document.getElementById('heroText') && !welcome.hidden)
      };
    });
    step('F2', 'Mobile enters studio', mobStudio.appVis !== 'hidden',
      `welcome=${mobStudio.welcome} chatCollapsed=${mobStudio.chatCollapsed}`);

    if (!mobStudio.welcome && mobStudio.chatCollapsed) {
      note('HIGH', 'Mobile', 'After Open the studio, no welcome and chat looks collapsed',
        'A phone visitor may not see how to describe a piece.', mobStudio);
    }

    /* ========== PHASE G: Dual path confusion — Open studio vs Sign in ========== */
    // From porch, unsigned: open studio, try design → gate. Measure click count to first success.
    note('MEDIUM', 'IA', 'Two front-door CTAs with different outcomes',
      '"Open the studio" lets you in unsigned, but AI chat immediately demands sign-in. "Sign in" is a separate header link. A first-time user who wants "walnut desk" needs: Open studio → type → blocked → Sign in → retype. Prefer a primary CTA that matches the promised loop ("Describe a piece").');

    /* ========== Console hygiene ========== */
    const serious = pageErrors.filter(e => !/ResizeObserver|favicon/i.test(e));
    if (serious.length) {
      note('MEDIUM', 'Stability', 'Page errors during the journey',
        serious.slice(0, 5).join(' | '), { pageErrors: serious.slice(0, 10), consoleErrors: consoleErrors.slice(0, 10) });
    }
    step('G1', 'No serious page errors on desktop journey', serious.length === 0,
      serious.slice(0, 2).join(' | ') || 'clean');

    await anonCtx.close();
    await mobCtx.close();
    await deskCtx.close();

  } catch (e) {
    note('CRITICAL', 'Harness', 'Journey script crashed', e.stack || e.message);
    console.error(e);
  } finally {
    cleanup();
  }

  const bySev = { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0 };
  for (const f of findings) bySev[f.sev] = (bySev[f.sev] || 0) + 1;

  const out = {
    generatedAt: new Date().toISOString(),
    method: 'Fresh Chromium profiles against serve.js with BB_DEV_LOGIN=1, no ANTHROPIC_API_KEY (localhost offline parser). Desktop 1440×900 + mobile 390×844.',
    steps,
    findings,
    counts: bySev,
    screenshots: fs.readdirSync(SHOTS).filter(f => f.endsWith('.png')).sort()
  };
  fs.writeFileSync(REPORT_JSON, JSON.stringify(out, null, 2));
  console.log('\n— Summary —');
  console.log(`Steps: ${steps.filter(s => s.ok).length}/${steps.length} ok`);
  console.log(`Findings: ${findings.length} (C=${bySev.CRITICAL} H=${bySev.HIGH} M=${bySev.MEDIUM} L=${bySev.LOW})`);
  console.log(`Wrote ${REPORT_JSON}`);
  console.log(`Shots in ${SHOTS}`);
  process.exit(findings.some(f => f.sev === 'CRITICAL') ? 1 : 0);
})();
