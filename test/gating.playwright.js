/* Blueprint Buddy — entitlement-gating browser test.
 * Run: node test/gating.playwright.js   (build dist/index.html first)
 *
 * WHY THIS SUITE EXISTS
 * `planLocked()` returns false whenever billing is unconfigured, so every
 * local run, every other browser suite, and every audit before this one
 * exercised the UNGATED app. smoke.playwright.js says so outright where it
 * keeps `providers` deliberately empty: provider evidence would flip
 * billingConfigured() on for the rest of that run. The consequence was that
 * the paywall, its previews, its CTAs, and every gating string had no
 * automated coverage at all — which is exactly where the copy contradicted
 * itself (an export menu that said "issued" to anonymous visitors, a Build
 * button showing a padlock beside the words "included with this design's
 * blueprint", "Issue blueprint — 1 credit" offered at a zero balance).
 *
 * Each state gets its OWN browser context and its own mock origin, so
 * billingConfigured() flipping on can never leak between states. The mocks
 * answer the real api/ contracts (see api/auth.js, api/billing.js,
 * api/blueprint.js, api/_entitlements.js statusFor).
 */
'use strict';
const { chromium } = require('playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');

const DIST = path.join(__dirname, '..', 'dist', 'index.html');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; } else { fail++; console.error('  ✗ ' + m); } };

/* The four states a real visitor can occupy on a configured deploy. */
const STATES = {
  anon: { user: null, balance: 0, purchased: 0, owned: false },
  noCredits: { user: { id: 'u1', name: 'Sam' }, balance: 0, purchased: 0, owned: false },
  hasCredit: { user: { id: 'u1', name: 'Sam' }, balance: 1, purchased: 0, owned: false },
  issued: { user: { id: 'u1', name: 'Sam' }, balance: 0, purchased: 1, owned: true }
};

function billingPayload(s) {
  return {
    plan: 'free',
    entitlements: { plan: 'free', projectLimit: 3, aiMonthlyLimit: 200 },
    usage: { aiMessages: 0 },
    credits: { balance: s.balance, purchased: s.purchased },
    subscription: null
  };
}

function makeServer(state, html) {
  return http.createServer((req, res) => {
    const url = req.url.split('?')[0];
    const send = (code, obj) => {
      res.statusCode = code;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify(obj));
    };
    if (url === '/' || url.startsWith('/index')) {
      res.setHeader('content-type', 'text/html');
      return res.end(html);
    }
    if (url === '/api/auth') {
      return send(200, { user: state.user, providers: ['google'], passwordAuth: true, storage: true, billing: billingPayload(state) });
    }
    if (url === '/api/billing') return send(200, billingPayload(state));
    if (url === '/api/chat') {
      // Production returns 401 for a signed-out visitor and 400 for the
      // zero-token probe's empty body — the badge reads both.
      if (!state.user) return send(401, { type: 'error', error: { type: 'auth_required', message: 'Sign in to design with AI.' } });
      return send(400, { error: 'bad_request' });
    }
    if (url === '/api/blueprint') {
      if (!state.user) return send(401, { error: 'auth_required' });
      // The ownership probe: GET ?owned=BB4:… — a pure read, never charges.
      if (req.method === 'GET' && /[?&]owned=/.test(req.url)) {
        state.probes = (state.probes || 0) + 1;
        return state.owned
          ? send(200, { owned: true, id: 'bp_test0001', revision: 1, windowEndsAt: Date.now() + 30 * 86400e3 })
          : send(200, { owned: false });
      }
      return send(402, { error: 'insufficient_credits', balance: 0 });
    }
    if (url === '/api/store') {
      if (!state.user) return send(401, { error: 'auth_required' });
      return send(200, { value: req.url.includes('doc=index') ? [] : null });
    }
    res.statusCode = 204; res.end();
  });
}

async function readState(page) {
  return page.evaluate(() => {
    const txt = el => (el ? (el.innerText || '').replace(/\s+/g, ' ').trim() : '');
    const build = document.querySelector('#buildModeBtn');
    return {
      aiBadgeState: document.querySelector('#aiBadge')?.dataset.state || '',
      aiBadgeLabel: txt(document.querySelector('#aiBadgeLabel')),
      exportHint: txt(document.querySelector('#exportSheetsHint')),
      buildTitle: build ? build.title : '',
      buildLockShown: !document.querySelector('#buildModeLock')?.hidden,
      panel: txt(document.querySelector('#panel-main'))
    };
  });
}

(async () => {
  const html = fs.readFileSync(DIST, 'utf8');
  const browser = await chromium.launch({
    executablePath: fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined,
    args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox']
  });

  for (const [name, base] of Object.entries(STATES)) {
    const state = Object.assign({}, base);
    const server = makeServer(state, html).listen(0);
    const port = server.address().port;
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.addInitScript(() => { try { localStorage.setItem('bb.porchSeen', 'credits-2026-07'); } catch (e) { /* storage-less */ } });
    await page.goto(`http://localhost:${port}/`, { waitUntil: 'load' });
    await page.waitForTimeout(2600);
    if (await page.locator('#welcomeClose').isVisible().catch(() => false)) await page.click('#welcomeClose').catch(() => {});
    await page.waitForTimeout(900); // the ownership probe lands after boot

    const s = await readState(page);
    ok(!errors.length, `[${name}] no page errors (${errors[0] || ''})`);

    /* ---- the AI badge never calls a healthy service "offline" ---- */
    if (name === 'anon') {
      ok(s.aiBadgeState === 'signedout', `[${name}] AI badge state is signedout, got "${s.aiBadgeState}"`);
      ok(!/offline/i.test(s.aiBadgeLabel), `[${name}] badge does not say Offline — got "${s.aiBadgeLabel}"`);
      ok(/sign in/i.test(s.aiBadgeLabel), `[${name}] badge invites sign-in — got "${s.aiBadgeLabel}"`);
    } else {
      ok(s.aiBadgeState === 'online', `[${name}] signed in + healthy proxy reads online, got "${s.aiBadgeState}"`);
    }

    /* ---- the export menu never claims a blueprint that does not exist ---- */
    if (name === 'issued') {
      ok(s.exportHint === 'issued', `[${name}] export hint says issued, got "${s.exportHint}"`);
    } else {
      ok(s.exportHint !== 'issued', `[${name}] export hint must NOT say "issued" — got "${s.exportHint}"`);
      ok(s.exportHint.length > 0, `[${name}] export hint states what is needed — got "${s.exportHint}"`);
    }

    /* ---- lock glyph and tooltip tell the same story ---- */
    const owned = name === 'issued';
    ok(s.buildLockShown === !owned, `[${name}] Build lock glyph ${owned ? 'hidden' : 'shown'}`);
    if (!owned) {
      ok(!/—\s*included with/i.test(s.buildTitle),
        `[${name}] locked Build must not claim the feature is "included" — got "${s.buildTitle}"`);
      ok(/unlock|sign in/i.test(s.buildTitle), `[${name}] locked Build says how to unlock — got "${s.buildTitle}"`);
    }

    /* ---- Plan gating, and the CTA the server can actually honour ---- */
    await page.click('#mode-plan').catch(() => {});
    await page.waitForTimeout(900);
    await page.click('#tab-cut').catch(() => {});
    await page.waitForTimeout(700);
    const cut = (await readState(page)).panel;
    if (owned) {
      ok(/\bQty\b|\bLength\b/i.test(cut), '[issued] a paid design shows the real cut list, not a preview');
      ok(!/Issue blueprint/i.test(cut), '[issued] a paid design is not asked to pay again');
    } else if (name === 'anon') {
      ok(/sign in/i.test(cut), '[anon] locked preview asks for the free sign-in');
      ok(!/Issue blueprint —/i.test(cut), '[anon] no credit CTA before there is an account');
    } else if (name === 'noCredits') {
      // Offering "Issue blueprint — 1 credit" at balance 0 offers an action
      // the server answers with 402.
      ok(!/Issue blueprint —\s*1 credit/i.test(cut), '[noCredits] does not offer an issue the server would 402');
      ok(/get a credit/i.test(cut), '[noCredits] asks for a credit instead — got a CTA');
    } else if (name === 'hasCredit') {
      ok(/Issue blueprint —\s*1 credit/i.test(cut), '[hasCredit] offers the issue it can actually honour');
    }

    /* ---- ownership survives a reload: the paid design must not re-lock ---- */
    if (owned) {
      ok((state.probes || 0) > 0, '[issued] the client asks the server what it owns');
      await page.reload({ waitUntil: 'load' });
      await page.waitForTimeout(2600);
      if (await page.locator('#welcomeClose').isVisible().catch(() => false)) await page.click('#welcomeClose').catch(() => {});
      await page.waitForTimeout(1200);
      const after = await readState(page);
      ok(after.exportHint === 'issued', '[issued] still issued after a reload — ownership is not client memory');
      ok(!after.buildLockShown, '[issued] Build stays unlocked after a reload');
    }

    await ctx.close();
    server.close();
  }

  await browser.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('gating suite failed:', e); process.exit(1); });
