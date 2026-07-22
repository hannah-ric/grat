/* Blueprint Buddy — porch (landing) browser test against dist/index.html.
 * Run: node test/porch.playwright.js          (suite only)
 *      node test/porch.playwright.js --shots  (suite + evidence screenshots
 *                                              into docs/overhaul/findings/landing/)
 * Mirrors the smoke harness: local http server, artifact-storage shim over
 * localStorage, SwiftShader chromium. Asserts the porch contract of
 * flow-blueprint §5 / phase2a brief: gate matrix, scrub choreography,
 * enterStudio handoff, static/reduced parity, overture one-shot + skip,
 * calculator over the real pipeline, stats-flat disposal, pre-JS document,
 * and the scrub frame-delta budget.
 */
'use strict';
const { chromium } = require('playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');

const DIST = path.join(__dirname, '..', 'dist', 'index.html');
const SHOTS = path.join(__dirname, '..', 'docs', 'overhaul', 'findings', 'landing');
const WANT_SHOTS = process.argv.includes('--shots');

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.error('  ✗ ' + m); } };
const log = m => console.log('  · ' + m);

(async () => {
  const html = fs.readFileSync(DIST, 'utf8');
  const server = http.createServer((req, res) => {
    res.setHeader('content-type', 'text/html');
    res.end(html);
  }).listen(0);
  const port = server.address().port;
  const url = `http://127.0.0.1:${port}/`;

  const browser = await chromium.launch({
    executablePath: fs.existsSync('/opt/pw-browsers/chromium')
      ? '/opt/pw-browsers/chromium'
      : require('playwright').chromium.executablePath(),
    args: ['--no-sandbox', '--enable-unsafe-swiftshader']
  });

  const storageShim = () => {
    window.storage = {
      async get(key) {
        const v = localStorage.getItem('bbshim:' + key);
        if (v === null) throw new Error('missing key');
        return { key, value: v };
      },
      async set(key, value) { localStorage.setItem('bbshim:' + key, value); },
      async delete(key) { localStorage.removeItem('bbshim:' + key); }
    };
  };

  const newPage = async opts => {
    const ctx = await browser.newContext(Object.assign({ viewport: { width: 1440, height: 900 } }, opts));
    await ctx.addInitScript(storageShim);
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(String(e)));
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    return { ctx, page, errors };
  };
  const boot = (page, extra) => page.goto(url + (extra || ''))
    .then(() => page.waitForFunction(() => globalThis.__bb && __bb.state.model, null, { timeout: 45000 }));
  const scrollFrac = (page, f) => page.evaluate(fr => {
    const p = document.getElementById('porch');
    scrollTo(0, Math.round((p.offsetHeight - innerHeight) * fr));
  }, f);

  /* ============ JS-disabled document (static string check on dist) ============ */
  ok(/Furniture that starts as a sentence\./.test(html), 'dist carries the H1 pre-JS');
  ok(/Say it like you&rsquo;d say it out loud\./.test(html) || /Say it like you.{0,12}d say it out loud\./.test(html),
    'dist carries chapter 01 copy pre-JS');
  ok(/Physics gets a veto\./.test(html), 'dist carries chapter 03 copy pre-JS');
  ok(/The AI never writes a number\./.test(html), 'dist carries the honesty band pre-JS');
  ok(!/<section id="porch"[^>]*hidden/.test(html), 'porch section ships visible (crawlable, readable with JS off)');

  /* ============ A · fresh desktop profile: porch + scrub + calc + CTA ============ */
  const A = await newPage();
  await boot(A.page);
  ok(await A.page.evaluate(() => !!document.getElementById('porch')), 'fresh profile shows the porch');
  // Segmentation: the studio is booted but OFF the page while the landing is
  // up — never one scroll away; the welcome card waits for studio entry.
  ok(await A.page.evaluate(() => getComputedStyle(document.getElementById('app')).visibility === 'hidden'),
    'the studio is off the page while the landing is up');
  ok(await A.page.evaluate(() => document.getElementById('app').getBoundingClientRect().top === 0),
    'the hidden studio is a fixed layer, not the tail of the scroll document');
  ok(await A.page.evaluate(() => !document.getElementById('siteHeader').hidden),
    'the landing carries the fixed site header');
  await A.page.waitForFunction(() => BB.Porch && BB.Porch.mode === 'scrub', null, { timeout: 15000 });
  ok(true, 'desktop fine-pointer ≥880 initializes in scrub mode');
  ok(await A.page.evaluate(() => !!BB.Porch._state.engine), 'porch owns a live stage engine');
  ok(await A.page.evaluate(() => getComputedStyle(document.querySelector('.ph-stage canvas')).pointerEvents === 'none'),
    'stage is pointer-inert before the handover');
  ok(await A.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'no horizontal overflow at 1440');

  // calculator renders a real $ figure, and it changes with species
  await A.page.waitForFunction(() => /\$\d/.test((document.getElementById('phCalcCost') || {}).textContent || ''), null, { timeout: 10000 });
  const cost0 = await A.page.evaluate(() => document.getElementById('phCalcCost').textContent);
  ok(/^\$\d+\.\d\d$/.test(cost0), `calculator shows a BOM-convention price (${cost0})`);
  await A.page.evaluate(() => {
    for (const c of document.querySelectorAll('.calc-chip')) if (c.textContent === 'Black Walnut') c.click();
  });
  await A.page.waitForFunction(c0 => {
    const t = document.getElementById('phCalcCost').textContent;
    return /^\$\d/.test(t) && t !== c0;
  }, cost0, { timeout: 8000 });
  const cost1 = await A.page.evaluate(() => document.getElementById('phCalcCost').textContent);
  ok(cost1 !== cost0, `species change re-runs the pipeline ($ ${cost0} → ${cost1})`);

  // scrub drives chapter states through the one track table
  const beats = [];
  for (const f of [0, 0.15, 0.3, 0.6, 0.75, 1]) {
    await scrollFrac(A.page, f);
    await A.page.waitForFunction(fr => Math.abs(BB.Porch._state.p - fr) < 0.06, f, { timeout: 25000 });
    beats.push(await A.page.evaluate(() => ({
      beat: document.getElementById('porch').dataset.beat,
      draft: BB.Porch._state.swCur.draft, dims: BB.Porch._state.swCur.dims,
      live: BB.Porch._state.live, p: BB.Porch._state.p
    })));
  }
  ok(beats[0].beat === 'mast' && !beats[0].draft, 'p=0 rests on the wood masthead');
  ok(beats[1].beat === 'describe' && !!beats[1].draft, 'DESCRIBE commits drafting on');
  ok(beats.some(b => b.beat === 'draft' && b.dims), 'DRAFT turns dimensions on');
  ok(beats.some(b => b.beat === 'prove'), 'PROVE beat reached mid-scroll');
  ok(beats[5].beat === 'build' && !beats[5].draft, 'BUILD returns to wood');
  ok(beats[5].live === true, 'the handover arms the stage at the closing band');
  ok(beats[5].p > 0.97, `scroll fraction spans the document (p=${beats[5].p.toFixed(3)})`);
  const proveBits = await A.page.evaluate(() => ({
    stamp: (document.getElementById('phStamp') || {}).textContent || '',
    parts: +((document.querySelector('#phCounters .counter') || {}).__bbCountVal || 0),
    cuts: document.querySelectorAll('#phCuts .ph-cut').length
  }));
  ok(/proven|anchor required|advisory|fail/.test(proveBits.stamp),
    `PROVE capsule carries the live verdict text ("${proveBits.stamp}")`);
  ok(proveBits.cuts >= 4, `BUILD chapter shows real cut-list rows (${proveBits.cuts})`);

  // automated scrub: rAF deltas recorded against a no-scroll baseline (the
  // standing dual-engine render cost — under SwiftShader that alone is
  // hundreds of ms/frame; on GPU hardware the gate below degrades to the
  // brief's 34 ms). Plus a microbench of the scroll apply itself against the
  // §12 "porch JS ≤ 4 ms/frame" budget — the part this code owns.
  const sampler = () => {
    window.__fr = [];
    window.__stopFr = false;
    let last = performance.now();
    const loop = t => { window.__fr.push(t - last); last = t; if (!window.__stopFr) requestAnimationFrame(loop); };
    requestAnimationFrame(loop);
  };
  const takeFrames = p => p.evaluate(() => { window.__stopFr = true; return window.__fr.slice(1); });
  const pct = (arr, q) => { const s = [...arr].sort((a, b) => a - b); return s[Math.floor(s.length * q)] || 0; };
  await scrollFrac(A.page, 0);
  await A.page.waitForTimeout(300);
  await A.page.evaluate(sampler);
  await A.page.waitForTimeout(3000); // rest: no scrolling, both engines rendering
  const rest = await takeFrames(A.page);
  await A.page.evaluate(sampler);
  for (let i = 0; i < 26; i++) {
    await A.page.mouse.wheel(0, 420);
    await A.page.waitForTimeout(60);
  }
  const frames = await takeFrames(A.page);
  const restP95 = pct(rest, 0.95), scrubP95 = pct(frames, 0.95), scrubP50 = pct(frames, 0.5);
  const applyUs = await A.page.evaluate(() => {
    const t0 = performance.now();
    for (let i = 0; i <= 500; i++) BB.Porch._applyP(i / 500);
    const t1 = performance.now();
    BB.Porch._applyP(0);
    return (t1 - t0) / 501;
  });
  log(`rest rAF p95 ${restP95.toFixed(1)} ms (${rest.length} frames) · scrub rAF p50 ${scrubP50.toFixed(1)} / p95 ${scrubP95.toFixed(1)} ms (${frames.length} frames) · track apply ${(applyUs * 1000).toFixed(1)} µs/call`);
  ok(frames.length >= 20 && rest.length >= 4, `scrub frame sampler captured real frames (${frames.length} scrub / ${rest.length} rest)`);
  ok(applyUs <= 4, `scroll apply within the 4 ms porch-JS budget (${(applyUs * 1000).toFixed(1)} µs)`);
  const gate = Math.max(34, restP95 * 1.75);
  ok(scrubP95 <= gate, `scrub adds no long tasks over the standing render cost (p95 ${scrubP95.toFixed(1)} ms ≤ gate ${gate.toFixed(1)} ms; GPU-hardware gate = 34 ms)`);

  // one mid-scrub evidence shot
  if (WANT_SHOTS) {
    fs.mkdirSync(SHOTS, { recursive: true });
    await scrollFrac(A.page, 0.5);
    await A.page.waitForTimeout(700);
    await A.page.evaluate(() => { const S = BB.Porch._state; if (S.engine) S.engine.snapNow(); });
    await A.page.screenshot({ path: path.join(SHOTS, 'mid-scrub-1440.png') });
  }

  // stats-flat: main engine before porch disposal…
  const stats0 = await A.page.evaluate(() => __bb.state.engine.stats());
  // …CTA enters the studio: porch gone, flag set, hero focused
  await scrollFrac(A.page, 1);
  await A.page.waitForTimeout(400);
  await A.page.click('#phCtaEnd');
  await A.page.waitForFunction(() => !document.getElementById('porch'), null, { timeout: 8000 });
  await A.page.waitForTimeout(500);
  ok(true, 'CTA removes the porch');
  ok(await A.page.evaluate(() => getComputedStyle(document.getElementById('app')).visibility !== 'hidden'),
    'studio entry brings the app back on screen');
  ok(await A.page.evaluate(() => document.getElementById('siteHeader').hidden && document.getElementById('siteFooter').hidden),
    'the public header and footer leave with the landing');
  ok(await A.page.evaluate(() => localStorage.getItem('bb.porchSeen') === '1'), 'studio entry sets bb.porchSeen');
  ok(await A.page.evaluate(() => document.activeElement && document.activeElement.id === 'heroText'),
    'arrival focuses the hero prompt');
  ok(await A.page.evaluate(() => !document.getElementById('welcomeOverlay').hidden), 'welcome card still up on first entry');
  ok(await A.page.evaluate(() => scrollY === 0), 'the bench sits at the top after entry');
  // …after disposal + a theme flip, stats stay flat
  await A.page.evaluate(() => __bb.applyTheme('dark'));
  await A.page.waitForTimeout(400);
  await A.page.evaluate(() => __bb.applyTheme('auto'));
  await A.page.waitForTimeout(400);
  const stats1 = await A.page.evaluate(() => __bb.state.engine.stats());
  ok(JSON.stringify(stats0) === JSON.stringify(stats1),
    `main-engine stats flat after porch dispose + theme flip (${JSON.stringify(stats0)} vs ${JSON.stringify(stats1)})`);
  ok(A.errors.length === 0, `zero console errors through porch → studio (${A.errors.slice(0, 3).join(' | ')})`);

  // second visit skips the porch pre-boot
  await A.page.reload();
  await A.page.waitForFunction(() => globalThis.BB && BB.Porch, null, { timeout: 45000 });
  ok(await A.page.evaluate(() => !document.getElementById('porch')), 'second visit skips the porch');
  const shareCode = await A.page.evaluate(() => {
    return new Promise(res => {
      const iv = setInterval(() => {
        if (globalThis.__bb && __bb.state.spec) { clearInterval(iv); res(BB.Codec.toShareCode(__bb.state.spec)); }
      }, 100);
    });
  });
  await A.ctx.close();

  /* ============ B · share-link (#d=) arrival bypasses the porch ============ */
  const B = await newPage();
  await boot(B.page, '#d=' + encodeURIComponent(shareCode));
  ok(await B.page.evaluate(() => !document.getElementById('porch')), '#d= share-link arrival never sees the porch');
  ok(await B.page.evaluate(() => !!__bb.state.importedFromLink), 'share link lands on the shared design');
  ok(B.errors.length === 0, `zero console errors on share-link arrival (${B.errors.slice(0, 2).join(' | ')})`);
  await B.ctx.close();

  /* ============ C · entry path seeds the skill level ============ */
  const C = await newPage();
  await boot(C.page);
  await C.page.waitForFunction(() => BB.Porch && BB.Porch.mode === 'scrub', null, { timeout: 15000 });
  await C.page.click('.entry-card[data-enter="first"]');
  await C.page.waitForFunction(() => !document.getElementById('porch'), null, { timeout: 8000 });
  await C.page.waitForTimeout(400);
  ok(await C.page.evaluate(() => document.getElementById('levelSelect').value === 'beginner'),
    'First build seeds the level select to beginner');
  ok(await C.page.evaluate(() => __bb.state.prefs4.level === 'beginner'), 'seeded level persists in prefs4');
  ok(await C.page.evaluate(() => document.getElementById('galleryScrim').classList.contains('open')),
    'First build opens the starters gallery');
  ok(C.errors.length === 0, `zero console errors on entry-path handoff (${C.errors.slice(0, 2).join(' | ')})`);
  await C.ctx.close();

  /* ============ D · reduced motion: complete static parity ============ */
  const D = await newPage({ reducedMotion: 'reduce' });
  await boot(D.page);
  ok(await D.page.evaluate(() => !!document.getElementById('porch')), 'reduced motion still sees the porch');
  await D.page.waitForFunction(() => BB.Porch && document.getElementById('porch').dataset.mode === 'static', null, { timeout: 15000 });
  ok(true, 'reduced motion renders the static document (no scrub)');
  ok(await D.page.evaluate(() => !BB.Porch._state.obs.length), 'no scroll timeline is built under reduced motion');
  ok(await D.page.evaluate(() => !document.querySelector('.ov-caption')), 'no overture under reduced motion');
  ok(await D.page.evaluate(() => getComputedStyle(document.getElementById('app')).visibility === 'hidden'),
    'segmentation holds under reduced motion: the studio waits off the page');
  await D.page.waitForFunction(() => {
    const c = document.querySelector('#phCounters .counter');
    return c && +c.textContent > 0;
  }, null, { timeout: 15000 });
  ok(await D.page.evaluate(() => {
    const parts = +document.querySelector('#phCounters .counter').textContent;
    return parts === __bb.runPipeline(BB.Gallery.STARTERS[4].spec).model.parts.length;
  }), 'counters render final pipeline values, no roll');
  ok(await D.page.evaluate(() => (document.getElementById('phType').textContent || '').includes('knee height')),
    'typed prompt is simply there under reduced motion');
  await D.page.click('#phCtaTop');
  await D.page.waitForFunction(() => !document.getElementById('welcomeOverlay').hidden, null, { timeout: 8000 });
  ok(true, 'reduced-motion entry snaps straight to the standard welcome');
  ok(D.errors.length === 0, `zero console errors under reduced motion (${D.errors.slice(0, 2).join(' | ')})`);
  await D.ctx.close();

  /* ============ E · phone: static chapters + the overture plays once, ON ENTRY ============ */
  const E = await newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  await boot(E.page);
  ok(await E.page.evaluate(() => !!document.getElementById('porch')), 'phone first run shows the porch');
  await E.page.waitForFunction(() => BB.Porch && document.getElementById('porch').dataset.mode === 'static', null, { timeout: 15000 });
  ok(true, 'phone porch is the static-chapter document');
  const posters = await E.page.waitForFunction(() => document.querySelectorAll('.ph-slot img').length >= 3, null, { timeout: 20000 })
    .then(() => true).catch(() => false);
  ok(posters, 'chapter poster stills render from the stage engine');
  ok(await E.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'no horizontal overflow at 390');
  // Segmentation: the overture waits for studio entry — it must never play
  // invisibly behind the landing.
  await E.page.waitForTimeout(1500);
  ok(await E.page.evaluate(() => !document.querySelector('.ov-caption')), 'no overture while the landing is up');
  await E.page.click('#phCtaTop');
  const ovStarted = await E.page.waitForSelector('.ov-caption', { timeout: 15000 }).then(() => true).catch(() => false);
  ok(ovStarted, 'the overture plays on studio entry on a phone first run');
  ok(await E.page.evaluate(() => document.getElementById('welcomeOverlay').hidden),
    'welcome waits for the overture');
  ok(await E.page.evaluate(() => __bb.state.prefs4.seenOverture === true), 'overture marks prefs4.seenOverture');
  // any input skips: pointerdown lands the standard end state
  await E.page.mouse.move(200, 400);
  await E.page.mouse.down();
  await E.page.mouse.up();
  await E.page.waitForFunction(() => !document.querySelector('.ov-caption') && !document.getElementById('welcomeOverlay').hidden,
    null, { timeout: 8000 });
  ok(true, 'pointerdown skips the overture and lands the standard welcome');
  ok(E.errors.length === 0, `zero console errors on the phone path (${E.errors.slice(0, 2).join(' | ')})`);
  // reload: seenOverture persists — it never plays twice
  await E.page.reload();
  await E.page.waitForFunction(() => globalThis.__bb && __bb.state.model, null, { timeout: 45000 });
  await E.page.waitForTimeout(1200);
  ok(await E.page.evaluate(() => !document.querySelector('.ov-caption')), 'overture never plays twice');
  await E.ctx.close();

  /* ============ F · routed pages: FAQ + sign-in are their own views ============ */
  const F = await newPage();
  await boot(F.page);
  // landing → FAQ via the header: one view at a time
  await F.page.click('#navFaq');
  await F.page.waitForFunction(() => !document.getElementById('pageFaq').hidden, null, { timeout: 8000 });
  ok(await F.page.evaluate(() => document.getElementById('porch').hidden), 'FAQ hides the landing — separate page, not the same scroll');
  ok(await F.page.evaluate(() => getComputedStyle(document.getElementById('app')).visibility === 'hidden'),
    'the studio stays off the page on the FAQ');
  ok(await F.page.evaluate(() => document.querySelectorAll('#pageFaq .faq-item').length >= 10),
    'FAQ carries a real body of questions');
  ok(await F.page.evaluate(() => BB.Porch.view === 'faq' && location.hash === '#faq'), 'FAQ is addressable at #faq');
  // FAQ → sign-in; the probe lands on the honest local-first note (no /api/auth here)
  await F.page.click('#navSignin');
  await F.page.waitForFunction(() => !document.getElementById('pageSignin').hidden, null, { timeout: 8000 });
  await F.page.waitForFunction(() => /without accounts/.test(document.getElementById('signinBody').textContent), null, { timeout: 10000 });
  ok(true, 'sign-in page renders the honest local-first state where accounts are not configured');
  ok(await F.page.evaluate(() => document.getElementById('pageFaq').hidden), 'one public view at a time');
  // brand returns to the landing; back/forward ride the hash honestly
  await F.page.click('#siteBrand');
  await F.page.waitForFunction(() => !document.getElementById('porch').hidden, null, { timeout: 8000 });
  ok(true, 'the brand returns to the landing');
  await F.page.goBack();
  await F.page.waitForFunction(() => !document.getElementById('pageSignin').hidden, null, { timeout: 8000 });
  ok(true, 'browser back returns to the sign-in page');
  // entering the studio from a page clears the page hash and lands the welcome
  await F.page.click('#pageSignin [data-enter]');
  await F.page.waitForFunction(() => !document.getElementById('welcomeOverlay').hidden, null, { timeout: 8000 });
  ok(await F.page.evaluate(() => getComputedStyle(document.getElementById('app')).visibility !== 'hidden'),
    'a page CTA enters the studio');
  ok(await F.page.evaluate(() => location.hash !== '#signin'), 'the page hash does not survive into the studio');
  // in-app: More → FAQ routes out; back returns to the studio
  await F.page.click('#moreBtn');
  await F.page.click('#faqBtn');
  await F.page.waitForFunction(() => !document.getElementById('pageFaq').hidden, null, { timeout: 8000 });
  ok(true, 'More → FAQ reaches the FAQ from inside the studio');
  await F.page.goBack();
  await F.page.waitForFunction(() => document.getElementById('pageFaq').hidden &&
    getComputedStyle(document.getElementById('app')).visibility !== 'hidden', null, { timeout: 8000 });
  ok(true, 'browser back returns from the FAQ to the studio');
  ok(F.errors.length === 0, `zero console errors across routed views (${F.errors.slice(0, 3).join(' | ')})`);
  await F.ctx.close();

  /* ============ G · deep link: a first visit at #faq lands on the FAQ ============ */
  const G = await newPage();
  await boot(G.page, '#faq');
  ok(await G.page.evaluate(() => !document.getElementById('pageFaq').hidden), 'deep-linked #faq arrival lands on the FAQ page');
  ok(await G.page.evaluate(() => !!document.getElementById('porch') && document.getElementById('porch').hidden),
    'the unseen landing waits behind the FAQ');
  await G.page.click('#siteBrand');
  await G.page.waitForFunction(() => !document.getElementById('porch').hidden, null, { timeout: 8000 });
  ok(true, 'first-visit FAQ arrival can still reach the landing');
  ok(G.errors.length === 0, `zero console errors on deep-linked arrival (${G.errors.slice(0, 2).join(' | ')})`);
  await G.ctx.close();

  /* ============ evidence screenshots (--shots) ============ */
  if (WANT_SHOTS) {
    fs.mkdirSync(SHOTS, { recursive: true });
    const capture = async (name, opts, spots, prep) => {
      const S = await newPage(opts);
      await boot(S.page);
      await S.page.waitForTimeout(2500);
      if (prep) await prep(S.page);
      for (const [label, frac] of spots) {
        await S.page.evaluate(fr => {
          const p = document.getElementById('porch');
          if (p) scrollTo(0, Math.round((p.offsetHeight - innerHeight) * fr));
        }, frac);
        await S.page.waitForTimeout(900);
        await S.page.evaluate(() => { const st = BB.Porch._state; if (st.engine) st.engine.snapNow(); });
        await S.page.waitForTimeout(200);
        await S.page.screenshot({ path: path.join(SHOTS, `${name}-${label}.png`) });
      }
      await S.ctx.close();
    };
    const FULL = [['masthead', 0], ['ch1', 0.14], ['ch2', 0.30], ['shift', 0.42], ['honesty', 0.48],
      ['ch3', 0.60], ['ch4', 0.78], ['calc', 0.90], ['entry', 1]];
    const CORE = [['masthead', 0], ['ch1', 0.12], ['ch2', 0.30], ['ch3', 0.58], ['ch4', 0.75], ['calc', 0.88], ['entry', 1]];
    await capture('1440', {}, FULL);
    await capture('2560', { viewport: { width: 2560, height: 1200 } }, CORE);
    await capture('1024', { viewport: { width: 1024, height: 768 } }, CORE);
    await capture('768', { viewport: { width: 768, height: 1024 }, hasTouch: true }, CORE);
    await capture('375', { viewport: { width: 375, height: 812 }, hasTouch: true, isMobile: true }, CORE);
    await capture('320', { viewport: { width: 320, height: 680 }, hasTouch: true, isMobile: true }, CORE);
    await capture('1440-dark', {}, [['masthead', 0], ['ch2', 0.30], ['ch3', 0.60], ['calc', 0.90]],
      async p => { await p.evaluate(() => __bb.applyTheme('dark')); await p.waitForTimeout(700); });
    await capture('1440-reduced', { reducedMotion: 'reduce' }, [['masthead', 0], ['ch1', 0.12], ['ch3', 0.58], ['calc', 0.88]]);
    log('evidence screenshots written to ' + SHOTS);
  }

  await browser.close();
  server.close();
  console.log(`\nporch: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
