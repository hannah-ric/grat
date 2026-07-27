/* Blueprint Buddy — accessibility suite (audit finding V-07).
 * Run: node test/a11y.playwright.js   (build dist/index.html first)
 *
 * WHY THIS SUITE EXISTS
 * Before this file there was no axe, no a11y linting, and not one contrast,
 * focus-order, or accessible-name assertion anywhere in the test tree.
 * Accessibility work to date has been manual spot-fixes — aria-labels on the
 * camera presets (smoke: "camera presets carry real names"), keyboard access
 * to diagnostics (M-16) — each one added after somebody noticed, with nothing
 * standing between the next commit and the same regression.
 *
 * The product makes accessibility promises in its own specs and then does not
 * check them:
 *   - "Verdicts always ship as verdict capsules with text, never color alone"
 *     (CLAUDE.md; design-language.md §4; brand-system.md §3)
 *   - "Reduced motion is a first-class path" (CLAUDE.md; design-language §5)
 *   - "`prefers-contrast: more` hardens … `forced-colors` is left to the UA"
 *     (brand-system.md §5) — with a deliberate opt-out list in styles.css
 *   - "contrast audit: all pairs ≥ target in both schemes" (brand-system §8)
 * That last one was written from a hand-picked list — body ink, links, CTA,
 * focus, chip inks — and the first run of this suite found four `--muted`
 * pairings it never enumerated, all under 4.5:1 in the light scheme, on the
 * .lede/.sub line at the top of every panel and on every table header in Cut,
 * Buy, Species and Shop Reference. A claim nothing executes is a claim that
 * only stays true by luck. TOKEN_PAIRS below is that claim, executable.
 *
 * WHAT THIS SUITE DOES
 * Two layers, deliberately:
 *   1. axe-core, injected into the real built page, swept across the states
 *      this app actually has — three modes, five plan sub-tabs, a design with
 *      a FAILING verdict, six modal surfaces, both themes, mobile width, the
 *      porch, forced-colors and reduced-motion.
 *   2. hand-rolled checks for the four commitments above, which no generic
 *      ruleset knows about: design-token contrast pairs named at the TOKEN
 *      level (so a failure says "--muted on --panel", not fifty DOM nodes),
 *      verdict-capsule text, the forced-colors opt-out register, reduced-motion
 *      content parity, accessible names on every visible focusable, focus
 *      traps that release, and focus restore.
 *
 * ON THE DEPENDENCY (axe-core)
 * CLAUDE.md: "No new dependencies without strong cause — the build must stay
 * runnable with nothing but Node ≥ 18." That rule protects the BUILD and the
 * RUNTIME: `node build.js` still needs nothing, `dist/index.html` still ships
 * zero third-party runtime code, `api/` still has zero deps. axe-core is a
 * devDependency of the browser job that already runs `npm install` for
 * Playwright, it is itself dependency-free (one file, no transitive tree), and
 * it never enters src/, dist/, or api/. The alternative — hand-rolling
 * accessible-name computation (accname is a spec, not a heuristic), ARIA role
 * validity, and composited-background contrast resolution — would be a weaker
 * imitation of a well-tested implementation, and a weak imitation is exactly
 * the token gesture this finding exists to prevent. Injected via
 * addScriptTag rather than the @axe-core/playwright wrapper: one dependency,
 * not two.
 *
 * ═══ EXCLUSION REGISTER ═══════════════════════════════════════════════════
 * Every exclusion this suite applies is declared in EXCLUSIONS below, with a
 * reason, and the axe options are BUILT FROM that table — an undeclared
 * exclusion cannot exist. An unexplained exclusion is how these suites rot.
 * ══════════════════════════════════════════════════════════════════════════
 */
'use strict';
const { chromium } = require('playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');

const DIST = path.join(__dirname, '..', 'dist', 'index.html');
const AXE_PATH = path.join(__dirname, '..', 'node_modules', 'axe-core', 'axe.min.js');

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; } else { fail++; console.error('  ✗ ' + m); } };
const section = n => console.log('\n── ' + n + ' ' + '─'.repeat(Math.max(2, 62 - n.length)));

/* Every violation and every needs-review result, collected across the whole
 * run and printed as one actionable register at the end. */
const REGISTER = [];
const REVIEW = new Map();

/* ── EXCLUSION REGISTER ───────────────────────────────────────────────────
 * Nothing else is excluded. `include`/`exclude` selectors are not used at
 * all: every scan sees the whole document.
 */
const EXCLUSIONS = [
  {
    rule: 'color-contrast',
    appliesTo: 'the forced-colors pass only (states tagged forcedColors)',
    why:
      'axe reads `-webkit-text-fill-color` in preference to `color` ' +
      '(axe.js: `nodeStyle.getPropertyValue("-webkit-text-fill-color") || ' +
      'nodeStyle.getPropertyValue("color")`), and Chromium\'s forced-colors ' +
      'emulation overrides `color` but NOT `-webkit-text-fill-color`. So under ' +
      'forced colors axe measures the AUTHORED foreground against the FORCED ' +
      'background: it reports #sendBtn at 1.08:1 (#fcf4ec on #ffffff) while ' +
      'getComputedStyle(sendBtn).color is rgb(0,0,0) and the browser paints ' +
      'black on white. axe-core has no forced-colors awareness at all (the ' +
      'string "forced-colors" does not appear in its source). Separately, ' +
      'WCAG 1.4.3 does not govern a palette the user agent has forced. ' +
      'The forced-colors pass instead hand-checks the things that DO matter ' +
      'there — see "forced-colors: the opt-out register" below. Contrast ' +
      'itself is still fully asserted in the light, dark and mobile passes.'
  },
  {
    rule: 'accessible-name (house sweep) — role="separator" without tabindex',
    appliesTo: 'the hand-rolled name sweep only; axe\'s own rules are untouched',
    why:
      'A non-focusable `role="separator"` is an ARIA STRUCTURE role (a static ' +
      'divider such as .menu-sep) and ARIA makes its accessible name optional. ' +
      'A focusable separator IS a widget — the viewport splitter #vpSplitter — ' +
      'and is still swept, via the [tabindex]:not([tabindex="-1"]) clause. ' +
      'WCAG 4.1.2 governs user interface components, not decorative structure.'
  }
];

/* WCAG 2.x rule tags. best-practice is included on purpose: the two rules it
 * adds that fire here (a missing <h1>, a missing <main>) are real navigation
 * losses for a screen-reader user, not style opinions. */
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'];

/* ── the frozen honest-fail design ────────────────────────────────────────
 * `ash-bookshelf-metric` from test/golden/ — 19 mm ash shelves that sag under
 * books plus creep. Frozen as an honest FAIL (audit.test.js:2204); do not
 * "fix" it. Merged in to reach the failing-verdict states: the FAIL capsules,
 * the check cards, their fix buttons, and the build-despite-fail interstitial.
 */
const FAILING_DESIGN = {
  meta: { name: 'Floor Bookshelf', template: 'bookshelf', level: 'beginner' },
  overall: { width: 900, depth: 300, height: 1800 },
  wood: { species: 'ash' },
  structure: { shelfCount: 4, sideThickness: 19, shelfThickness: 19, backPanel: true },
  finish: 'wipe_poly'
};

/* ── design-token contrast pairs ──────────────────────────────────────────
 * The token-level counterpart to axe's node-level sweep. Each pair is listed
 * with the surface that actually puts that ink on that ground, so nothing
 * here is an invented pairing. brand-system.md §8 claims "all pairs ≥ target
 * in both schemes"; this is that claim, executable.
 * `large: true` = ≥18.66px bold or ≥24px, so 3:1 applies (WCAG 1.4.3).
 * `ui: true`   = non-text UI component / focus indicator, 3:1 (WCAG 1.4.11).
 */
const TOKEN_PAIRS = [
  { fg: '--ink', bg: '--paper', usedIn: 'body copy on the app field' },
  { fg: '--ink', bg: '--panel', usedIn: 'body copy in panels, modals, chat' },
  { fg: '--ink-2', bg: '--paper', usedIn: 'secondary copy, quiet button labels' },
  { fg: '--ink-2', bg: '--panel', usedIn: 'secondary copy in panels' },
  { fg: '--muted', bg: '--panel', usedIn: '.lede / .sub / .chat-head — every panel intro line' },
  { fg: '--muted', bg: '--paper', usedIn: '.pricing small print, cards on the app field' },
  { fg: '--muted', bg: '--panel-2', usedIn: 'table <th> across Cut, Buy, Species and Shop Reference' },
  { fg: '--muted', bg: '--accent-soft', usedIn: 'history snapshot summaries, featured pricing card' },
  { fg: '--link', bg: '--panel', usedIn: 'links' },
  { fg: '--accent-ink', bg: '--accent', usedIn: 'primary CTA label' },
  { fg: '--green', bg: '--panel', usedIn: '.stamp.pass — the PASS verdict capsule' },
  { fg: '--brick', bg: '--panel', usedIn: '.stamp.fail — the FAIL verdict capsule' },
  { fg: '--amber-ink', bg: '--panel', usedIn: '.stamp.advisory / .stamp.anchor capsules' },
  { fg: '--brick-ink', bg: '--brick-soft', usedIn: '.advisory.error — the error callout' },
  { fg: '--brick', bg: '--brick-soft', usedIn: '.stamp.fail inside .check-card.fail / .bm-verdict[fail]' },
  { fg: '--amber-ink', bg: '--amber-soft', usedIn: '.chip.caveat, .advisory, .bm-verdict[advisory]' },
  { fg: '--seafoam-ink', bg: '--seafoam', usedIn: 'selected .ref-tab, pressed .seg button, pressed .species-pick' },
  { fg: '--green', bg: '--seafoam-wash', usedIn: '#dualBtn[aria-pressed="true"]' },
  { fg: '--ink', bg: '--fern-wash', usedIn: 'the fern-wash callout block (inherits --ink)' },
  { fg: '--focus', bg: '--paper', ui: true, usedIn: ':focus-visible outline on the app field' },
  { fg: '--focus', bg: '--panel', ui: true, usedIn: ':focus-visible outline in panels and modals' }
];

/* WCAG 2.x relative luminance + contrast, computed here in Node rather than
 * asked of the page, so the numbers in a failure message are independently
 * derived from the token hex values. */
function lum(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const c = [0, 2, 4].map(i => parseInt(m[1].slice(i, i + 2), 16) / 255)
    .map(v => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
function contrast(a, b) {
  const la = lum(a), lb = lum(b);
  if (la === null || lb === null) return null;
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/* ── axe plumbing ─────────────────────────────────────────────────────── */
function axeSource() {
  if (!fs.existsSync(AXE_PATH)) {
    console.error(
      '\naxe-core is not installed. This suite does not degrade to a weaker\n' +
      'hand-rolled substitute — a silent skip is how an a11y suite dies.\n' +
      '  npm install --ignore-scripts\n');
    process.exit(1);
  }
  return fs.readFileSync(AXE_PATH, 'utf8');
}
const AXE = axeSource();

async function ensureAxe(page) {
  if (await page.evaluate(() => !!window.axe).catch(() => false)) return;
  await page.addScriptTag({ content: AXE });
}

/* Let motion finish before measuring anything colour- or geometry-dependent:
 * a contrast reading taken mid-fade is a flaky contrast reading. Both motion
 * paths reach zero running animations within a few hundred ms of settling. */
async function settle(page, extra) {
  await page.waitForFunction(
    () => document.getAnimations().every(a => {
      if (a.playState !== 'running') return true;
      // An endless decorative loop (the porch's blinking caret) never finishes
      // and must not be waited on — only transitional motion is.
      let iters = Infinity;
      try { iters = a.effect.getComputedTiming().iterations; } catch (e) { /* not an effect we can read */ }
      return iters === Infinity;
    }),
    null, { timeout: 3000 }
  ).catch(() => { /* never let motion stall the suite */ });
  await page.waitForTimeout(extra || 220);
}

/* One axe sweep of one state. Emits ONE ok() per (state, rule) — never per
 * node — so the pass/fail counts stay stable while the DOM node counts move
 * with the design, and so each distinct defect is individually visible. */
async function audit(page, label, opts) {
  opts = opts || {};
  await ensureAxe(page);
  await settle(page);
  const rules = {};
  for (const x of EXCLUSIONS) {
    if (opts.forcedColors && x.rule === 'color-contrast') rules[x.rule] = { enabled: false };
  }
  const res = await page.evaluate(async o => await window.axe.run(document, {
    runOnly: { type: 'tag', values: o.tags },
    resultTypes: ['violations', 'incomplete'],
    rules: o.rules
  }), { tags: TAGS, rules });

  for (const v of res.incomplete) {
    REVIEW.set(v.id, (REVIEW.get(v.id) || 0) + v.nodes.length);
  }
  if (!res.violations.length) {
    ok(true, `${label}: axe clean`);
    return res;
  }
  for (const v of res.violations.sort((a, b) => a.id.localeCompare(b.id))) {
    const n = v.nodes[0] || {};
    const data = (n.any && n.any[0] && n.any[0].data) || {};
    const extra = data.contrastRatio
      ? `${data.contrastRatio}:1 ${data.fgColor} on ${data.bgColor} (need ${data.expectedContrastRatio})`
      : (n.target || []).join(' ');
    ok(false, `${label} · ${v.id} [${v.impact}] ×${v.nodes.length} — ${extra}`);
    REGISTER.push({ label, id: v.id, impact: v.impact, n: v.nodes.length, extra, help: v.helpUrl });
  }
  return res;
}

/* ── page plumbing (same shape as gating/nowebgl, the newest suites) ───── */
function serve(html) {
  return http.createServer((req, res) => {
    const p = req.url.split('?')[0];
    if (p === '/' || p.startsWith('/index')) { res.setHeader('content-type', 'text/html'); return res.end(html); }
    res.statusCode = 204; res.end();
  }).listen(0);
}

async function newPage(browser, port, opts) {
  const ctx = await browser.newContext(Object.assign({ viewport: { width: 1440, height: 900 } }, opts || {}));
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  if (!(opts && opts.showPorch)) {
    await page.addInitScript(() => { try { localStorage.setItem('bb.porchSeen', 'credits-2026-07'); } catch (e) { /* storage-less */ } });
  }
  await page.goto(`http://localhost:${port}/`, { waitUntil: 'load' });
  // Boot completion, not a stopwatch: the skeleton is removed by boot()'s last act.
  await page.waitForFunction(() => !document.getElementById('bootSkeleton'), null, { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(700);
  return { ctx, page, errors };
}

async function dismissWelcome(page) {
  if (await page.locator('#welcomeClose').isVisible().catch(() => false)) await page.click('#welcomeClose').catch(() => {});
  await page.waitForTimeout(400);
}

/* ── hand-rolled check: every visible focusable has an accessible name ───
 * axe's button-name / link-name / input-* rules cover the common shapes; this
 * sweep is broader (it covers every focusable including custom roles) and uses
 * axe's own accname implementation, so it agrees with what a screen reader
 * would announce rather than with a regex over aria-label. */
async function nameSweep(page, label) {
  await ensureAxe(page);
  const unnamed = await page.evaluate(() => {
    /* Interactive things only. A `role="separator"` with no tabindex is an
     * ARIA *structure* role — a static divider — and the spec makes its name
     * optional; a FOCUSABLE separator (the viewport splitter) is a widget and
     * is caught by the [tabindex] clause below, which is where it belongs. */
    const SEL = 'a[href],button,input:not([type="hidden"]),select,textarea,summary,' +
      '[tabindex]:not([tabindex="-1"]),[role="button"],[role="menuitem"],[role="tab"],' +
      '[role="slider"],[role="checkbox"],[role="link"]';
    window.axe.setup(document.documentElement);
    const out = [];
    try {
      for (const el of document.querySelectorAll(SEL)) {
        /* axe's own exposure tests, not a rect measurement — they are the only
         * thing that agrees with what a screen reader is actually offered.
         * They know about inert, aria-hidden, a collapsed <details>, and
         * everything a modal <dialog> pushes out of the accessibility tree.
         * (A closed <details> still reports a layout box in Chromium, so a
         * rect check alone reports its perfectly well-labelled selects as
         * nameless; and with a modal open, the whole studio behind it is out
         * of the tree, so a rect check reports the entire shell as nameless.) */
        if (!window.axe.commons.dom.isVisibleToScreenReaders(el)) continue;
        if (!window.axe.commons.dom.isVisibleOnScreen(el)) continue;
        let name = '';
        try { name = window.axe.commons.text.accessibleTextVirtual(window.axe.utils.getNodeFromTree(el)) || ''; }
        catch (e) { name = '\u0000ERR ' + e.message; }
        if (!name.trim() || name.startsWith('\u0000')) {
          out.push((el.id ? '#' + el.id : el.tagName + '.' + String(el.className).split(' ')[0]) +
            ' ‹' + el.outerHTML.replace(/\s+/g, ' ').slice(0, 90) + '›');
        }
      }
    } finally { window.axe.teardown(); }
    return out;
  });
  ok(unnamed.length === 0, `${label}: every visible focusable has an accessible name (${unnamed.length} without — ${unnamed.slice(0, 3).join(' | ')})`);
  if (unnamed.length) REGISTER.push({ label, id: 'accessible-name (house sweep)', impact: 'serious', n: unnamed.length, extra: unnamed[0], help: '' });
}

/* ── hand-rolled check: a focus trap must hold AND release ───────────────
 * A dialog that leaks focus to the page behind it and a dialog that will not
 * let a keyboard user out are the same bug from opposite ends.
 *
 * The property asserted is "Tab never reaches a CONTROL outside the dialog".
 * <body>/<html> is not counted as an escape: a native modal <dialog> wraps its
 * tab cycle through the document root by design (measured:
 * button → button → BODY → DIALOG → button …), so the very next Tab is back
 * inside. If a trap were genuinely leaking, the Tab after the body hit would
 * land on studio chrome — a real element outside the root — and be caught
 * here. The JS-trapped scrims never leave their root at all. */
async function trapHolds(page, label, rootSel, steps) {
  const escapes = [];
  for (let i = 0; i < (steps || 30); i++) {
    await page.keyboard.press('Tab');
    const where = await page.evaluate(sel => {
      const a = document.activeElement;
      if (!a || a === document.body || a === document.documentElement) return null; // UA wrap point
      return a.closest(sel) ? null : (a.id ? '#' + a.id : a.tagName + '.' + String(a.className).split(' ')[0]);
    }, rootSel);
    if (where) escapes.push(where);
  }
  ok(escapes.length === 0, `${label}: focus never reaches a control outside ${rootSel} over ${steps || 30} Tabs (escaped to ${[...new Set(escapes)].slice(0, 3).join(', ')})`);
}

/* One stage per browser context. A stage that throws — a selector the product
 * moved, a dialog that did not open — records a failure and the run CONTINUES.
 * A gating suite that reports "the porch was never checked" because a button
 * moved in Design mode is a suite that gets deleted. */
async function stage(name, fn) {
  try {
    await fn();
  } catch (e) {
    ok(false, `${name}: stage aborted before finishing — ${String(e.message || e).split('\n')[0]}`);
    REGISTER.push({ label: name, id: 'suite-error', impact: 'unknown', n: 1, extra: String(e.message || e).split('\n')[0], help: '' });
  }
}

(async () => {
  const html = fs.readFileSync(DIST, 'utf8');
  const server = serve(html);
  const port = server.address().port;
  const browser = await chromium.launch({
    executablePath: fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined,
    args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox']
  });

  console.log('Blueprint Buddy — accessibility suite (axe-core ' +
    JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'node_modules', 'axe-core', 'package.json'), 'utf8')).version +
    ', WCAG 2.0/2.1/2.2 A+AA + best-practice)');

  /* ════════════════ 1 · design tokens, at the token level ════════════════
   * Before any DOM: are the ink/ground pairs the design system is built from
   * legal at all? A node-level sweep tells you fifty elements are wrong; this
   * tells you which TOKEN is wrong, in both schemes. */
  await stage('design tokens', async () => {
    const { ctx, page } = await newPage(browser, port);
    await dismissWelcome(page);
    for (const theme of ['light', 'dark']) {
      section(`design tokens · ${theme} scheme (brand-system.md §8 claims all pairs pass)`);
      await page.evaluate(t => __bb.applyTheme(t), theme);
      await page.waitForTimeout(300);
      const tokens = await page.evaluate(names => {
        const cs = getComputedStyle(document.documentElement);
        const out = {};
        for (const n of names) out[n] = cs.getPropertyValue(n).trim();
        return out;
      }, [...new Set(TOKEN_PAIRS.flatMap(p => [p.fg, p.bg]))]);
      for (const p of TOKEN_PAIRS) {
        const ratio = contrast(tokens[p.fg], tokens[p.bg]);
        const target = p.ui || p.large ? 3 : 4.5;
        if (ratio === null) { ok(false, `${theme}: ${p.fg}/${p.bg} did not resolve to hex (${tokens[p.fg]} / ${tokens[p.bg]})`); continue; }
        const r = Math.round(ratio * 100) / 100;
        const good = ratio >= target;
        ok(good, `${theme}: ${p.fg} (${tokens[p.fg]}) on ${p.bg} (${tokens[p.bg]}) = ${r}:1, needs ${target}:1 — ${p.usedIn}`);
        if (!good) REGISTER.push({ label: `tokens/${theme}`, id: 'token-contrast', impact: 'serious', n: 1, extra: `${p.fg} on ${p.bg} = ${r}:1 (need ${target}:1) — ${p.usedIn}`, help: '' });
      }
    }
    await ctx.close();
  });

  /* ════════════════ 2 · the studio, light, 1440 ════════════════ */
  await stage('studio (light, 1440)', async () => {
    const { ctx, page, errors } = await newPage(browser, port);

    section('studio · first run and Design mode');
    await audit(page, 'welcome overlay (first run)');
    await nameSweep(page, 'welcome overlay');
    await dismissWelcome(page);
    await audit(page, 'design mode');
    await nameSweep(page, 'design mode');

    // Skip links are the keyboard user's way past the chrome; both targets must exist.
    const skips = await page.evaluate(() => [...document.querySelectorAll('.skip-link')].map(a => ({
      href: a.getAttribute('href'), target: !!document.querySelector(a.getAttribute('href')), hidden: a.hidden
    })));
    ok(skips.length > 0 && skips.filter(s => !s.hidden).every(s => s.target),
      `skip links point at real targets (${JSON.stringify(skips)})`);

    // :focus-visible must produce a visible indicator, not just move the caret.
    await page.evaluate(() => document.getElementById('moreBtn').focus());
    await page.keyboard.press('Tab');
    const fv = await page.evaluate(() => {
      const a = document.activeElement, cs = getComputedStyle(a);
      return { id: a.id, matches: a.matches(':focus-visible'), w: parseFloat(cs.outlineWidth) || 0, style: cs.outlineStyle };
    });
    ok(fv.matches && fv.w >= 2 && fv.style !== 'none',
      `keyboard focus paints a visible ring on #${fv.id} (${fv.w}px ${fv.style}, :focus-visible=${fv.matches})`);

    section('studio · the Adjust rail (the whole editing surface when chat is gated)');
    await page.evaluate(() => { if (document.getElementById('adjustRail').hidden) document.getElementById('adjustBtn').click(); });
    await page.waitForSelector('#adjustRail .param', { timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(300);
    await audit(page, 'adjust rail open');
    await nameSweep(page, 'adjust rail');
    const railControls = await page.evaluate(() => {
      const named = el => {
        const id = el.id;
        const lab = el.getAttribute('aria-label') ||
          (id && (document.querySelector(`label[for="${id}"]`) || {}).textContent) ||
          (el.closest('label') || {}).textContent ||
          (el.getAttribute('aria-labelledby') && (document.getElementById(el.getAttribute('aria-labelledby')) || {}).textContent) || '';
        return !!String(lab).trim();
      };
      const ranges = [...document.querySelectorAll('#adjustRail input[type="range"]')];
      const selects = [...document.querySelectorAll('#adjustRail select')];
      const segs = [...document.querySelectorAll('#adjustRail .seg')];
      return {
        ranges: ranges.length, rangesNamed: ranges.every(named),
        rangesBounded: ranges.every(r => r.min !== '' && r.max !== ''),
        selects: selects.length, selectsNamed: selects.every(named),
        segs: segs.length,
        segsGrouped: segs.every(s => s.getAttribute('role') === 'group' && !!s.getAttribute('aria-label')),
        segsPressed: segs.every(s => [...s.querySelectorAll('button')].every(b => b.hasAttribute('aria-pressed')))
      };
    });
    ok(railControls.ranges > 0 && railControls.rangesNamed, `every Adjust slider has a name (${railControls.ranges} sliders)`);
    ok(railControls.rangesBounded, 'every Adjust slider exposes min/max, so a screen reader can announce the range');
    ok(railControls.selects > 0 && railControls.selectsNamed, `every Adjust select has a name (${railControls.selects} selects)`);
    ok(railControls.segs > 0 && railControls.segsGrouped, `the skill-level segmented control is a labelled role=group (${railControls.segs} groups)`);
    ok(railControls.segsPressed, 'every segment reports aria-pressed, so its state is not colour alone');
    // A slider a keyboard user cannot move is a slider that does not exist.
    const railKb = await page.evaluate(async () => {
      const r = document.querySelector('#adjustRail input[type="range"]');
      if (!r) return { focused: false, before: null };
      r.focus();
      return { focused: document.activeElement === r, before: r.value };
    });
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(350);
    const railAfter = await page.evaluate(() => (document.querySelector('#adjustRail input[type="range"]') || {}).value);
    ok(railKb.focused && railAfter !== railKb.before, `an Adjust slider moves from the keyboard (${railKb.before} → ${railAfter})`);
    await page.evaluate(() => document.getElementById('adjustClose').click());
    await page.waitForTimeout(300);

    section('studio · the View popover and the More menu');
    await page.click('#viewBtn');
    await page.waitForTimeout(350);
    await audit(page, 'View popover open');
    await nameSweep(page, 'View popover');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(250);
    await page.evaluate(() => document.getElementById('moreBtn').click());
    await page.waitForTimeout(350);
    await audit(page, 'More menu open');
    await nameSweep(page, 'More menu');

    /* A popup trigger has to describe the thing it actually opens, and there
     * are exactly two honest ways to do that:
     *
     *   MENU-BUTTON  aria-haspopup names the ROLE of what opens. axe validates
     *     that the ATTRIBUTE is well-formed, never that the named thing has
     *     that role — so a menu quietly re-roled to a group leaves the trigger
     *     announcing "has popup menu" over something that is not a menu, and
     *     no rule anywhere notices. (aria-haspopup="true" is a defined synonym
     *     for "menu"; the only other legal values are listbox/tree/grid/dialog
     *     — there is none for a plain group, which is why both shell popups
     *     take the second form.)
     *
     *   DISCLOSURE   no aria-haspopup at all; aria-expanded carries the state
     *     and aria-controls names the element. Checked here too, because
     *     "no aria-haspopup" must not be the loophole that lets a trigger
     *     describe nothing whatsoever.
     *
     * These are the shell's two popup buttons. */
    const popups = await page.evaluate(() => [['moreBtn', 'moreMenu'], ['viewBtn', 'viewMenu']].map(([b, m]) => {
      const btn = document.getElementById(b), pop = document.getElementById(m);
      const promised = (btn && btn.getAttribute('aria-haspopup')) || '';
      return {
        btn: b, pop: m,
        promised: promised === 'true' ? 'menu' : promised,
        controls: (btn && btn.getAttribute('aria-controls')) || '',
        expanded: (btn && btn.getAttribute('aria-expanded')) || '',
        actual: (pop && pop.getAttribute('role')) || (pop ? pop.tagName.toLowerCase() : 'MISSING')
      };
    }));
    for (const p of popups) {
      const good = p.promised
        ? p.promised === p.actual
        : (p.controls === p.pop && (p.expanded === 'true' || p.expanded === 'false'));
      const why = p.promised
        ? `promises aria-haspopup="${p.promised}" and #${p.pop} is role="${p.actual}" — they must agree`
        : `has no aria-haspopup, so it must be a disclosure: aria-controls="${p.pop}" (got "${p.controls}") and aria-expanded (got "${p.expanded || 'absent'}")`;
      ok(good, `#${p.btn} ${why}`);
      if (!good) REGISTER.push({ label: 'More menu open', id: 'popup trigger/target mismatch (house check)', impact: 'moderate', n: 1, extra: `#${p.btn}: ${why}`, help: '' });
    }
    await page.keyboard.press('Escape');
    await page.waitForTimeout(250);

    /* The two keyboard contracts the roles above are easy to break silently,
     * because axe scores markup and neither of these is markup.
     *
     * 1. ARROW NAVIGATION. bindMenu() collected its entries with a selector.
     *    When the panel stopped being a role="menu" the selector kept
     *    matching nothing, so every arrow key became a no-op with no error
     *    and no failing rule anywhere. Tab still worked, which is exactly why
     *    it could sit there unnoticed.
     * 2. FOCUS RESTORE THROUGH AN INERT OPENER. Dialogs opened FROM this
     *    panel (History, Projects, Starters, Share) close back onto an opener
     *    that is now inert, so .focus() on it silently does nothing and focus
     *    falls to <body> — the keyboard user is dropped at the top of the
     *    document. releaseFocus() falls back to the panel's trigger; that
     *    fallback found the trigger by a selector too. */
    await page.evaluate(() => document.getElementById('moreBtn').focus());
    await page.keyboard.press('ArrowDown');
    await page.waitForTimeout(200);
    const arrowNav = await page.evaluate(() => {
      const m = document.getElementById('moreMenu');
      return { open: m.classList.contains('open'), inside: m.contains(document.activeElement), at: document.activeElement && document.activeElement.id };
    });
    ok(arrowNav.open, 'ArrowDown on #moreBtn opens the panel');
    ok(arrowNav.inside, `ArrowDown moves focus into the panel (landed on "${arrowNav.at || document.activeElement}")`);
    await page.keyboard.press('ArrowDown');
    await page.waitForTimeout(120);
    const arrowNext = await page.evaluate(() => document.activeElement && document.activeElement.id);
    ok(arrowNext && arrowNext !== arrowNav.at, `a second ArrowDown advances to the next entry (${arrowNav.at} → ${arrowNext})`);
    await page.keyboard.press('End');
    await page.waitForTimeout(120);
    const arrowEnd = await page.evaluate(() => {
      const m = document.getElementById('moreMenu');
      return m.contains(document.activeElement) && document.activeElement !== null;
    });
    ok(arrowEnd, 'End jumps to the last entry without leaving the panel');

    // The precision <select> owns its own arrow keys; the panel must not
    // steal ArrowDown from it to move focus.
    await page.evaluate(() => document.getElementById('precisionSelect').focus());
    const beforeSel = await page.evaluate(() => document.getElementById('precisionSelect').value);
    await page.keyboard.press('ArrowDown');
    await page.waitForTimeout(150);
    const afterSel = await page.evaluate(() => ({
      value: document.getElementById('precisionSelect').value,
      stillFocused: document.activeElement && document.activeElement.id === 'precisionSelect'
    }));
    ok(afterSel.stillFocused, 'ArrowDown inside the precision select does not yank focus out of it');
    ok(afterSel.value !== beforeSel, `ArrowDown still changes the precision select (${beforeSel} → ${afterSel.value})`);

    // Focus restore out of a dialog whose opener is inert.
    await page.evaluate(() => document.getElementById('historyBtn').click());
    await page.waitForSelector('#historyDrawer.open', { timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(400);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(450);
    const restored = await page.evaluate(() => ({
      id: document.activeElement && document.activeElement.id,
      body: document.activeElement === document.body
    }));
    ok(!restored.body && restored.id === 'moreBtn',
      `closing a dialog opened from the panel restores focus to #moreBtn, not <body> (got ${restored.body ? '<body>' : '#' + restored.id})`);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(250);

    section('studio · Plan mode, every sub-tab');
    await page.click('#mode-plan');
    await page.waitForTimeout(800);
    for (const [name, sel] of [['overview', '#tab-overview'], ['cut', '#tab-cut'], ['stock (Buy)', '#tab-stock'],
      ['assembly', '#tab-assembly'], ['integrity (Safety)', '#tab-integrity']]) {
      await page.click(sel);
      await page.waitForTimeout(550);
      await audit(page, `plan/${name}`);
      await nameSweep(page, `plan/${name}`);
    }

    section('studio · a design with a FAILING verdict (frozen ash-bookshelf-metric)');
    await page.evaluate(d => __bb.merge(d, 'manual'), FAILING_DESIGN);
    await page.waitForTimeout(1300);
    const fails = await page.evaluate(() => __bb.state.integrity.summary.fails);
    ok(fails > 0, `precondition: the frozen honest-fail design really fails (${fails} checks)`);
    await page.click('#tab-integrity');
    await page.waitForTimeout(700);
    await audit(page, 'plan/integrity FAILING');
    await nameSweep(page, 'plan/integrity FAILING');

    /* The house rule, executable: "verdicts always ship as verdict capsules
     * with text, never color alone". Colour-blind and forced-colors users see
     * the word or they see nothing. */
    const capsules = await page.evaluate(() => [...document.querySelectorAll('.stamp')].map(s => ({
      cls: [...s.classList].filter(c => c !== 'stamp' && c !== 'ov-value').join(' '),
      text: (s.textContent || '').trim()
    })));
    ok(capsules.length > 0, `verdict capsules are on screen to check (${capsules.length})`);
    const mute = capsules.filter(c => !c.text);
    ok(mute.length === 0, `every verdict capsule carries its word, never colour alone (${mute.length} silent: ${mute.map(m => m.cls).join(', ')})`);
    // …and the word must be the RIGHT word: a capsule whose class says fail
    // and whose text says pass is worse than one that says nothing.
    const STATUSES = ['pass', 'advisory', 'anchor', 'fail'];
    const mismatched = capsules
      .map(c => ({ c, status: c.cls.split(/\s+/).map(x => x.replace(/^verdict-/, '')).find(x => STATUSES.includes(x)) }))
      .filter(x => x.status && !new RegExp(x.status, 'i').test(x.c.text));
    ok(mismatched.length === 0, `each capsule's word matches its status class (${mismatched.map(m => m.c.cls + '="' + m.c.text + '"').join(', ')})`);

    // The fix buttons on a failing check are the recovery path; they must be
    // reachable and named, and the failing cards must not rely on a colour cue.
    const fixShape = await page.evaluate(() => {
      const cards = [...document.querySelectorAll('.check-card.fail')];
      const btns = [...document.querySelectorAll('.check-card.fail .fix-row .btn')];
      return {
        cards: cards.length,
        cardsHaveWord: cards.every(c => /fail/i.test(c.textContent || '')),
        btns: btns.length,
        btnsNamed: btns.every(b => (b.textContent || '').trim().length > 3),
        btnsFocusable: btns.every(b => b.tagName === 'BUTTON' && !b.disabled)
      };
    });
    ok(fixShape.cards > 0 && fixShape.cardsHaveWord, `every failing check card says "fail" in words (${fixShape.cards} cards)`);
    ok(fixShape.btns > 0 && fixShape.btnsNamed, `every fix button has a real label (${fixShape.btns} buttons)`);
    ok(fixShape.btnsFocusable, 'fix buttons are real, enabled buttons a keyboard can reach');

    await page.click('#tab-overview');
    await page.waitForTimeout(600);
    await audit(page, 'plan/overview FAILING');

    section('studio · the build-despite-fail interstitial');
    await page.click('#buildModeBtn').catch(() => {});
    await page.waitForTimeout(900);
    const bfPresent = await page.evaluate(() => !!document.querySelector('dialog.build-fail-confirm'));
    ok(bfPresent, 'the failing design raises the build-despite-fail interstitial');
    if (bfPresent) {
      await audit(page, 'build-fail interstitial');
      await nameSweep(page, 'build-fail interstitial');
      const bf = await page.evaluate(() => {
        const d = document.querySelector('dialog.build-fail-confirm');
        const lab = d.getAttribute('aria-labelledby');
        return {
          modal: d.open && d.matches(':modal'),
          labelled: !!(lab && document.getElementById(lab) && document.getElementById(lab).textContent.trim()),
          focusInside: !!(document.activeElement && document.activeElement.closest('dialog.build-fail-confirm')),
          words: /fail/i.test(d.textContent || '')
        };
      });
      ok(bf.modal, 'the interstitial is a real modal dialog (focus is contained by the UA)');
      ok(bf.labelled, 'the interstitial has an accessible name from its heading');
      ok(bf.focusInside, 'opening the interstitial moves focus into it');
      ok(bf.words, 'the interstitial states the failure in words, not by colour');
      await trapHolds(page, 'build-fail interstitial', 'dialog.build-fail-confirm', 24);
      await page.keyboard.press('Escape');
      await page.waitForTimeout(500);
      ok(await page.evaluate(() => !document.querySelector('dialog.build-fail-confirm')),
        'Escape releases the interstitial — a keyboard user is never stranded on it');
    }

    section('studio · Build mode (full-screen, focus-trapped)');
    await page.evaluate(() => __bb.enterBuildMode({ acknowledged: true }));
    await page.waitForTimeout(1200);
    ok(await page.evaluate(() => !document.getElementById('buildMode').hidden), 'precondition: Build mode is up');
    await audit(page, 'build mode');
    await nameSweep(page, 'build mode');
    await trapHolds(page, 'build mode', '#buildMode', 40);
    const exitReachable = await page.evaluate(() => {
      const b = document.getElementById('bmExit');
      const r = b.getBoundingClientRect();
      return { visible: r.width > 0 && r.height > 0, tabbable: b.tabIndex >= 0, name: (b.textContent || '').trim() };
    });
    ok(exitReachable.visible && exitReachable.tabbable && exitReachable.name.length > 3,
      `Build mode's exit is visible, tabbable and named ("${exitReachable.name}")`);
    await page.evaluate(() => __bb.exitBuildMode());
    await page.waitForTimeout(800);
    ok(await page.evaluate(() => document.getElementById('buildMode').hidden), 'Build mode releases the screen back to the studio');

    section('studio · modal surfaces');
    // Share / Import — opened the way a user opens it, so focus restore is real.
    await page.click('#mode-design').catch(() => {});
    await page.waitForTimeout(500);
    await page.click('#shareBtn');
    await page.waitForSelector('#shareScrim.open');
    await page.waitForTimeout(400);
    await audit(page, 'share / import dialog');
    await nameSweep(page, 'share / import dialog');
    const shareShape = await page.evaluate(() => {
      const d = document.getElementById('shareScrim');
      const lab = d.getAttribute('aria-labelledby');
      const fields = [...d.querySelectorAll('textarea,input')];
      return {
        role: d.getAttribute('role'), modal: d.getAttribute('aria-modal'),
        labelled: !!(lab && document.getElementById(lab)),
        fieldsLabelled: fields.every(f => f.getAttribute('aria-label') ||
          (f.id && document.querySelector(`label[for="${f.id}"]`))),
        liveError: !!d.querySelector('[aria-live]')
      };
    });
    ok(shareShape.role === 'dialog' && shareShape.modal === 'true', 'share is role=dialog aria-modal=true');
    ok(shareShape.labelled, 'share dialog is named by its heading');
    ok(shareShape.fieldsLabelled, 'every share/import field carries its own label');
    ok(shareShape.liveError, 'the import error is announced through a live region, not colour');
    await trapHolds(page, 'share dialog', '#shareScrim', 26);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(400);
    ok(await page.evaluate(() => document.activeElement && document.activeElement.id === 'shareBtn'),
      'closing share restores focus to the control that opened it');

    // Joint inspector — reached the way a user reaches it, from Shop Reference.
    // Waited on by selector, not by stopwatch: the reference panel renders from
    // the knowledge tables and a fixed sleep is how a suite starts flaking.
    await page.evaluate(() => document.getElementById('moreBtn').click());
    await page.waitForTimeout(250);
    await page.evaluate(() => document.getElementById('referenceBtn').click());
    await page.waitForSelector('.ref-tabs', { timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(350);
    await audit(page, 'shop reference (wood)');
    await page.click('#ref-tab-joinery').catch(() => {});
    await page.waitForSelector('.joint-demo', { timeout: 8000 }).catch(() => {});
    await audit(page, 'shop reference (joinery)');
    const demos = await page.evaluate(() => document.querySelectorAll('.joint-demo').length);
    ok(demos > 0, `precondition: the joinery reference offers 3D joint demos (${demos})`);
    if (demos > 0) {
      await page.evaluate(() => document.querySelector('.joint-demo').click());
      await page.waitForSelector('#jointScrim.open', { timeout: 8000 }).catch(() => {});
      await page.waitForTimeout(600);
      ok(await page.evaluate(() => document.getElementById('jointScrim').classList.contains('open')), 'the joint inspector opens');
      await audit(page, 'joint inspector');
      await nameSweep(page, 'joint inspector');
      const jointShape = await page.evaluate(() => {
        const d = document.getElementById('jointScrim');
        return {
          named: !!(d.getAttribute('aria-label') || d.getAttribute('aria-labelledby')),
          canvasNamed: !!(document.getElementById('jointCanvas').getAttribute('aria-label') || '').trim(),
          // The 3D close-up is the point of the dialog; the text beside it is
          // what a screen-reader user actually gets, so it must not be empty.
          notes: (document.getElementById('jointNotes').textContent || '').trim().length,
          explodeNamed: !!(document.getElementById('jointExplode').getAttribute('aria-label') || '').trim(),
          cutawayPressed: document.getElementById('jointCutaway').hasAttribute('aria-pressed')
        };
      });
      ok(jointShape.named, 'the joint inspector dialog has an accessible name');
      ok(jointShape.canvasNamed, 'the joint canvas describes what it shows and how to drive it');
      ok(jointShape.notes > 40, `the joint carries a text equivalent beside the 3D (${jointShape.notes} chars)`);
      ok(jointShape.explodeNamed && jointShape.cutawayPressed, 'the joint controls are named and report their state');
      await trapHolds(page, 'joint inspector', '#jointScrim', 20);
      await page.keyboard.press('Escape');
      await page.waitForTimeout(500);
      ok(await page.evaluate(() => !document.getElementById('jointScrim').classList.contains('open')),
        'Escape closes the joint inspector');
    }

    // Pricing — the credits dialog. Rendered even when billing is unconfigured,
    // which is exactly the state every local run and every other suite is in.
    await page.evaluate(() => BB.Billing.open && BB.Billing.open());
    await page.waitForTimeout(700);
    const pricingUp = await page.evaluate(() => !!document.querySelector('dialog.pricing-dialog'));
    ok(pricingUp, 'the pricing dialog opens');
    if (pricingUp) {
      await audit(page, 'pricing dialog');
      await nameSweep(page, 'pricing dialog');
      const pr = await page.evaluate(() => {
        const d = document.querySelector('dialog.pricing-dialog');
        const lab = d.getAttribute('aria-labelledby');
        return {
          modal: d.open && d.matches(':modal'),
          labelled: !!(lab && document.getElementById(lab) && document.getElementById(lab).textContent.trim()),
          closeNamed: !!(d.querySelector('[data-pricing-close]') || {}).getAttribute &&
            !!d.querySelector('[data-pricing-close]').getAttribute('aria-label'),
          packsNamed: [...d.querySelectorAll('.pricing-grid section')].every(s => !!s.getAttribute('aria-label'))
        };
      });
      ok(pr.modal, 'pricing is a real modal dialog');
      ok(pr.labelled, 'pricing is named by its heading');
      ok(pr.closeNamed, 'the pricing close control is named for assistive tech, not by a glyph alone');
      ok(pr.packsNamed, 'each credit pack is a named region');
      await trapHolds(page, 'pricing dialog', 'dialog.pricing-dialog', 22);
      await page.keyboard.press('Escape');
      await page.waitForTimeout(400);
      ok(await page.evaluate(() => !document.querySelector('dialog.pricing-dialog[open]')), 'Escape closes pricing');
      await page.evaluate(() => { const d = document.querySelector('dialog.pricing-dialog'); if (d) d.remove(); });
    }

    // The revisions drawer — the one overlay that is an <aside>, not a .scrim.
    // Scanned OPEN on purpose: while it is aria-hidden axe can only mark its
    // role "incomplete", and an incomplete is a result nobody reads.
    await page.evaluate(() => document.getElementById('moreBtn').click());
    await page.waitForTimeout(250);
    await page.evaluate(() => document.getElementById('historyBtn').click());
    await page.waitForTimeout(700);
    ok(await page.evaluate(() => document.getElementById('historyDrawer').getAttribute('aria-hidden') !== 'true'),
      'precondition: the revisions drawer is open');
    await audit(page, 'revisions drawer');
    await nameSweep(page, 'revisions drawer');
    await page.evaluate(() => document.getElementById('historyClose').click());
    await page.waitForTimeout(400);

    // Closed overlays must be out of the tab order entirely — a keyboard user
    // tabbing the studio must never land inside a dialog that is not on screen.
    const buried = await page.evaluate(() => {
      const out = [];
      for (const scrim of document.querySelectorAll('.scrim:not(.open), .drawer-panel[aria-hidden="true"]')) {
        for (const el of scrim.querySelectorAll('button,a[href],input,select,textarea,[tabindex]:not([tabindex="-1"])')) {
          const r = el.getBoundingClientRect();
          if (r.width && r.height && !scrim.hasAttribute('inert')) out.push(scrim.id + ' › ' + (el.id || el.className));
        }
      }
      return out;
    });
    ok(buried.length === 0, `closed overlays stay out of the tab order (${buried.slice(0, 3).join(', ')})`);

    ok(!errors.length, `no page errors across the studio sweep (${errors[0] || ''})`);
    await ctx.close();
  });

  /* ════════════════ 3 · dark scheme ════════════════ */
  await stage('dark scheme', async () => {
    section('dark scheme');
    const { ctx, page, errors } = await newPage(browser, port, { colorScheme: 'dark' });
    await dismissWelcome(page);
    await page.evaluate(() => __bb.applyTheme('dark'));
    await page.waitForTimeout(500);
    ok(await page.evaluate(() => document.documentElement.getAttribute('data-theme') === 'dark'), 'precondition: dark theme is applied');
    await audit(page, 'dark · design mode');
    await page.click('#mode-plan'); await page.waitForTimeout(800);
    await page.click('#tab-cut'); await page.waitForTimeout(600);
    await audit(page, 'dark · plan/cut');
    await page.evaluate(d => __bb.merge(d, 'manual'), FAILING_DESIGN);
    await page.waitForTimeout(1300);
    await page.click('#tab-integrity'); await page.waitForTimeout(600);
    await audit(page, 'dark · plan/integrity FAILING');
    await nameSweep(page, 'dark · plan/integrity FAILING');
    ok(!errors.length, `no page errors in the dark pass (${errors[0] || ''})`);
    await ctx.close();
  });

  /* ════════════════ 4 · mobile width ════════════════
   * 390 px is where the shell drops chrome — and where dropping the wrong
   * thing costs a heading or a scroll affordance. */
  await stage('mobile 390', async () => {
    section('mobile · 390×844');
    const { ctx, page, errors } = await newPage(browser, port, { viewport: { width: 390, height: 844 } });
    await dismissWelcome(page);
    await audit(page, 'mobile · design mode');
    await nameSweep(page, 'mobile · design mode');
    await page.click('#mode-plan'); await page.waitForTimeout(800);
    for (const [n, s] of [['cut', '#tab-cut'], ['stock (Buy)', '#tab-stock'], ['integrity', '#tab-integrity']]) {
      await page.click(s); await page.waitForTimeout(600);
      await audit(page, `mobile · plan/${n}`);
    }
    // A horizontally scrolling region that no key can move is content a
    // keyboard-only user simply cannot read (WCAG 2.1.1).
    await ensureAxe(page);
    const scrollers = await page.evaluate(() => [...document.querySelectorAll('.table-scroll, [class*="scroll"]')]
      // A real scroll container only: `overflow-x: visible` means the content
      // simply spills, which is a layout question, not a keyboard one. And it
      // must actually be on screen — the compare-snapshots table sits inside a
      // closed dialog at every width and is nobody's scroll problem.
      .filter(e => ['auto', 'scroll'].includes(getComputedStyle(e).overflowX))
      .filter(e => e.scrollWidth > e.clientWidth + 2)
      .filter(e => window.axe.commons.dom.isVisibleOnScreen(e))
      .map(e => ({
        cls: e.className,
        tabbable: e.tabIndex >= 0,
        hasFocusable: !!e.querySelector('a[href],button,input,select,textarea,[tabindex]:not([tabindex="-1"])')
      })));
    const stuck = scrollers.filter(s => !s.tabbable && !s.hasFocusable);
    ok(stuck.length === 0, `every overflowing region is keyboard-scrollable (${stuck.length} stranded: ${stuck.map(s => s.cls).join(' | ')})`);
    ok(!errors.length, `no page errors at 390 px (${errors[0] || ''})`);
    await ctx.close();
  });

  /* ════════════════ 5 · forced colors ════════════════
   * The project's stated position (brand-system.md §5): forced-colors is left
   * to the UA, with a deliberate, enumerated opt-out list where colour IS the
   * content. This pass checks that the opt-out list is exactly that list and
   * nothing has quietly joined it, and that the UI survives the repaint.
   * axe's color-contrast rule is disabled here — see EXCLUSIONS. */
  await stage('forced colors', async () => {
    section('forced colors (Windows High Contrast) — the opt-out register');
    const { ctx, page, errors } = await newPage(browser, port, { forcedColors: 'active' });
    await dismissWelcome(page);
    ok(await page.evaluate(() => matchMedia('(forced-colors: active)').matches), 'precondition: forced colors really is active');
    await audit(page, 'forced-colors · design mode', { forcedColors: true });
    await nameSweep(page, 'forced-colors · design mode');
    await page.click('#mode-plan'); await page.waitForTimeout(800);
    await page.click('#tab-integrity'); await page.waitForTimeout(600);
    await audit(page, 'forced-colors · plan/integrity', { forcedColors: true });

    /* styles.css §forced-colors names exactly the elements where colour is the
     * content. Anything else opting out is hiding from the user's palette. */
    const SANCTIONED = ['dot', 'integrity-dot', 'diag-dot', 'chat-rail-dot', 'dots',
      'movement-low', 'movement-medium', 'movement-high', 'stamp', 'save-state'];
    const optOuts = await page.evaluate(() => [...document.querySelectorAll('*')]
      .filter(e => getComputedStyle(e).forcedColorAdjust === 'none')
      .map(e => ({ cls: typeof e.className === 'string' ? e.className : '', id: e.id, tag: e.tagName })));
    const rogue = optOuts.filter(o => !SANCTIONED.some(c => (' ' + o.cls + ' ').includes(' ' + c + ' ')));
    ok(rogue.length === 0,
      `only the sanctioned colour-as-content elements opt out of forced colors (${rogue.length} rogue: ${rogue.slice(0, 4).map(r => r.tag + '.' + r.cls + '#' + r.id).join(', ')})`);
    ok(optOuts.length > 0, `the sanctioned opt-outs are present and doing their job (${optOuts.length})`);

    // Ordinary text must take the forced palette — an element that kept its
    // authored ink can land invisible on the user's chosen ground.
    const forcedInk = await page.evaluate(() => {
      const sample = [...document.querySelectorAll('p, h1, h2, h3, li, td, th, label, .lede, .sub')]
        .filter(e => e.getBoundingClientRect().width > 0 && (e.textContent || '').trim())
        .slice(0, 60);
      const colors = new Set(sample.map(e => getComputedStyle(e).color));
      return { n: sample.length, colors: [...colors] };
    });
    ok(forcedInk.n > 0 && forcedInk.colors.length <= 2,
      `body text takes the system palette under forced colors (${forcedInk.colors.join(', ')})`);

    // Controls must stay findable when every fill is flattened — styles.css
    // gives .btn / .tab / .toggle .track a ButtonText border for exactly this.
    const borders = await page.evaluate(() => [...document.querySelectorAll('.btn')]
      .filter(b => b.getBoundingClientRect().width > 0).slice(0, 12)
      .map(b => ({ id: b.id || b.className, w: parseFloat(getComputedStyle(b).borderTopWidth) || 0, s: getComputedStyle(b).borderTopStyle })));
    const invisible = borders.filter(b => !(b.w > 0 && b.s !== 'none'));
    ok(borders.length > 0 && invisible.length === 0,
      `buttons keep a visible edge under forced colors (${invisible.length} edgeless: ${invisible.map(b => b.id).join(', ')})`);

    // Verdicts are the one place the product deliberately keeps its own colour —
    // so the word beside it is load-bearing, and this is where it is checked.
    const fcCapsules = await page.evaluate(() => [...document.querySelectorAll('.stamp')]
      .map(s => (s.textContent || '').trim()).filter(Boolean).length);
    const fcCapsulesAll = await page.evaluate(() => document.querySelectorAll('.stamp').length);
    ok(fcCapsulesAll > 0 && fcCapsules === fcCapsulesAll,
      `every colour-keeping verdict capsule still carries its word (${fcCapsules}/${fcCapsulesAll})`);

    ok(!errors.length, `no page errors under forced colors (${errors[0] || ''})`);
    await ctx.close();
  });

  /* ════════════════ 6 · reduced motion ════════════════ */
  await stage('reduced motion', async () => {
    section('reduced motion — a first-class path, not a degraded one');
    const full = await newPage(browser, port);
    await dismissWelcome(full.page);
    await full.page.click('#mode-plan'); await full.page.waitForTimeout(900);
    await full.page.click('#tab-cut'); await full.page.waitForTimeout(700);
    await settle(full.page, 500);
    const fullText = await full.page.evaluate(() => (document.getElementById('panel-main').innerText || '').replace(/\s+/g, ' ').trim());
    await full.ctx.close();

    const { ctx, page, errors } = await newPage(browser, port, { reducedMotion: 'reduce' });
    await dismissWelcome(page);
    ok(await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches), 'precondition: reduced motion is on');
    ok(await page.evaluate(() => BB.Motion && BB.Motion.on() === false), 'BB.Motion reports itself off — one gate, not per-surface guesses');
    await audit(page, 'reduced-motion · design mode');
    await nameSweep(page, 'reduced-motion · design mode');
    await page.click('#mode-plan'); await page.waitForTimeout(900);
    await page.click('#tab-cut'); await page.waitForTimeout(700);
    await audit(page, 'reduced-motion · plan/cut');
    await settle(page, 500);
    const reducedText = await page.evaluate(() => (document.getElementById('panel-main').innerText || '').replace(/\s+/g, ' ').trim());
    ok(reducedText.length > 200, `the reduced-motion plan is fully rendered (${reducedText.length} chars)`);
    ok(reducedText === fullText,
      `reduced motion is content-identical to the animated path (${reducedText.length} vs ${fullText.length} chars)`);
    // Nothing may be left mid-animation and therefore mid-opacity: a cascade
    // that never ran leaves content invisible to eyes and to hit-testing.
    const ghosts = await page.evaluate(() => [...document.querySelectorAll('#panel-main *')]
      .filter(e => (e.textContent || '').trim() && e.getBoundingClientRect().height > 0)
      .filter(e => parseFloat(getComputedStyle(e).opacity) < 0.99).length);
    ok(ghosts === 0, `no element is stranded mid-fade under reduced motion (${ghosts} at partial opacity)`);
    ok(!errors.length, `no page errors under reduced motion (${errors[0] || ''})`);
    await ctx.close();
  });

  /* ════════════════ 7 · the porch (a separate document view) ════════════════ */
  await stage('the porch', async () => {
    section('the porch — landing, FAQ, sign-in');
    const { ctx, page, errors } = await newPage(browser, port, { showPorch: true });
    await page.waitForTimeout(1200);
    ok(await page.evaluate(() => !!document.getElementById('porch') && !document.getElementById('porch').hidden),
      'precondition: the landing really is on screen');
    await audit(page, 'porch · landing (masthead)');
    await nameSweep(page, 'porch · landing');

    // Scrolled far enough to build the calculator, which is live UI with inputs.
    await page.evaluate(() => { const c = document.getElementById('phCalc'); if (c) c.scrollIntoView({ block: 'center' }); });
    await page.waitForTimeout(1400);
    await audit(page, 'porch · build-vs-buy calculator');
    await nameSweep(page, 'porch · calculator');

    for (const [name, hash] of [['FAQ', '#faq'], ['sign-in', '#signin']]) {
      await page.evaluate(h => { location.hash = h; }, hash);
      await page.waitForTimeout(1000);
      await audit(page, `porch · ${name}`);
      await nameSweep(page, `porch · ${name}`);
    }
    ok(!errors.length, `no page errors across the porch (${errors[0] || ''})`);
    await ctx.close();
  });

  await browser.close();
  server.close();

  /* ── the register ──────────────────────────────────────────────────────
   * Grouped by defect, not by state, so a failing run reads as a list of
   * things to fix rather than a wall of repeats. */
  if (REGISTER.length) {
    console.log('\n' + '═'.repeat(72));
    console.log('VIOLATION REGISTER — distinct defects, and where each was seen');
    console.log('═'.repeat(72));
    const byDefect = new Map();
    for (const r of REGISTER) {
      const key = r.id + ' — ' + r.extra;
      if (!byDefect.has(key)) byDefect.set(key, { impact: r.impact, help: r.help, states: [] });
      byDefect.get(key).states.push(r.label);
    }
    const rows = [...byDefect.entries()].sort((a, b) => b[1].states.length - a[1].states.length);
    for (const [key, v] of rows) {
      console.log(`\n[${v.impact}] ${key}`);
      console.log(`   seen in ${v.states.length} state(s): ${v.states.slice(0, 6).join(', ')}${v.states.length > 6 ? ', …' : ''}`);
      if (v.help) console.log(`   ${v.help}`);
    }
  }
  if (REVIEW.size) {
    console.log('\n' + '─'.repeat(72));
    console.log('NEEDS HUMAN REVIEW — axe could not decide (not counted as failures)');
    for (const [id, n] of [...REVIEW.entries()].sort()) console.log(`   ${id}: ${n} node(s) across the run`);
  }
  console.log('\n' + '─'.repeat(72));
  console.log('EXCLUSIONS APPLIED (' + EXCLUSIONS.length + ')');
  for (const x of EXCLUSIONS) console.log(`   ${x.rule} — ${x.appliesTo}`);
  console.log('\nWHAT THIS SUITE CANNOT CATCH');
  console.log('   Automated rules find roughly a third of real accessibility defects.');
  console.log('   Outside this suite: whether an accessible name is USEFUL (not just');
  console.log('   present), whether reading order matches visual order, whether the 3D');
  console.log('   viewport and its drawings are comprehensible without sight, whether');
  console.log('   live-region announcements are timely and not chatty, cognitive load,');
  console.log('   and every real assistive-technology behaviour (NVDA/JAWS/VoiceOver,');
  console.log('   voice control, switch access) — none of which a headless Chromium');
  console.log('   with an injected ruleset can observe.');

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('a11y suite failed:', e); process.exit(1); });
