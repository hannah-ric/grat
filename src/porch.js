/* Blueprint Buddy — the front porch (landing narrative + first-run overture).
 * Spec of record: docs/ui/front-porch.md amended by design-language §6–§8.
 * Shape: the GATE runs at eval, pre-boot (returning/`#d=`/`?app` arrivals
 * lose the porch before paint). The document ships complete in the template;
 * this module adds live pipeline numbers and, on capable desktops, the
 * scroll-driven Materialization: ONE Motion.scrollSync observer maps scroll
 * fraction p through the code-owned track table onto damped engine goals —
 * the follower smooths, scrollY never binds a transform, the wheel is never
 * hijacked. (This anime build doesn't link createTimeline({autoplay:
 * onScroll}) — verified; the observer's onUpdate is the composition, and
 * Motion.timeline drives the time-based overture only.) Founding rule:
 * every figure here reads from the live pipeline at render time; the only
 * code-owned tables are INPUT presets and the labeled retail RANGE. Static
 * parity: coarse pointer, <880 px, reduced motion, or no motion engine =
 * the complete static document; any throw degrades to the same. */
var BB = globalThis.BB = globalThis.BB || {};

(function () {
  'use strict';

  const doc = typeof document !== 'undefined' ? document : null;
  const $ = id => doc && doc.getElementById(id);

  /* ---------------- the gate (front-porch §4d) ---------------- */
  /* Pure decision, selftest-matrixed: seen/link/app arrivals never see the
   * porch; reduced motion sees it as the complete static document. */
  function _gateDecision(seen, reduced, hash, search) {
    const h = String(hash || '').replace(/^#/, '');
    const link = h.startsWith('d=');
    const app = /[?&]app(?:[=&]|$)/.test(String(search || ''));
    const show = !seen && !link && !app;
    return { show, static: show && !!reduced };
  }

  /* The porch now carries pricing and lead capture, so "seen" is versioned:
   * bump PRICING_REV whenever the offer changes and every returning visitor
   * sees the porch once more (credits pivot §4 decision). A legacy '1' from
   * the overture era counts as unseen — those visitors predate the offer.
   * Share-link (#d=) and ?app arrivals still bypass, as before. */
  const PRICING_REV = 'credits-2026-07';
  function peekSeen() {
    try { if (localStorage.getItem('bb.porchSeen') === PRICING_REV) return true; } catch (e) { /* storage-less */ }
    try { return sessionStorage.getItem('bb.porchSeen') === PRICING_REV; } catch (e) { return false; }
  }
  function markSeen() {
    try { localStorage.setItem('bb.porchSeen', PRICING_REV); return; } catch (e) { /* fall through */ }
    try { sessionStorage.setItem('bb.porchSeen', PRICING_REV); } catch (e) { /* session-only env */ }
  }

  const reduceMq = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;
  const coarseMq = typeof matchMedia === 'function' ? matchMedia('(pointer: coarse)') : null;
  const darkMq = typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)') : null;
  /* The same 879/880 line the porch.css reflow breaks on — mode and layout
   * must never disagree (a scrub porch over a single-column layout occludes
   * the headline). */
  const narrowMq = typeof matchMedia === 'function' ? matchMedia('(max-width: 879px)') : null;

  const decision = _gateDecision(peekSeen(), reduceMq && reduceMq.matches,
    typeof location !== 'undefined' ? location.hash : '',
    typeof location !== 'undefined' ? location.search : '');

  const porchEl = $ && $('porch');
  if (porchEl && !decision.show) porchEl.remove();
  const active = !!(porchEl && decision.show);

  /* ---------------- front-of-house views (segmentation) ----------------
   * The landing, FAQ, and sign-in pages are separate views from the studio:
   * exactly one is on screen at a time. While any public view is up, the
   * studio (#app) stays booted but leaves the page entirely (see porch.css
   * .ph-open rules) — the narrative is never one scroll away from the
   * workbench. Routing is the location hash (#faq, #signin); everything
   * else resolves to the landing (first visit) or the studio. */
  function _routeFromHash(hash, alive) {
    const h = String(hash || '').replace(/^#/, '').split(';')[0];
    if (h === 'faq') return 'faq';
    if (h === 'signin') return 'signin';
    return alive ? 'landing' : 'app';
  }
  const PAGE_IDS = { faq: 'pageFaq', signin: 'pageSignin' };
  let view = null;
  let firstRunCb = null; // ui.js parks the first-run welcome/overture here

  function landingAlive() { return !!(porchEl && porchEl.isConnected); }

  function showView(v) {
    if (!doc || !doc.body) return;
    if (v === 'landing' && !landingAlive()) v = 'app';
    const pub = v !== 'app';
    if (landingAlive()) porchEl.hidden = v !== 'landing';
    for (const k in PAGE_IDS) { const p = $(PAGE_IDS[k]); if (p) p.hidden = v !== k; }
    const header = $('siteHeader'), footer = $('siteFooter');
    if (header) header.hidden = !pub;
    if (footer) footer.hidden = !pub;
    doc.body.classList.toggle('ph-open', pub);
    const changed = view !== null && view !== v;
    view = v;
    BB.Porch.view = v;
    if (changed) {
      // a chapter anchor rides the hash back onto the landing; else the top
      const target = v === 'landing' && /^#ph-/.test(location.hash) ? doc.querySelector(location.hash) : null;
      if (target) target.scrollIntoView();
      else scrollTo(0, 0);
    }
    if (pub) updateNav();
    if (v === 'signin') renderSignin();
    if (v === 'landing' && active && !S.inited) schedule();
  }

  function updateNav() {
    const alive = landingAlive();
    for (const id of ['navHow', 'footHow']) { const n = $(id); if (n) n.hidden = !alive; }
    let user = null;
    try { user = BB.Store && BB.Store.auth ? BB.Store.auth().user : null; } catch (e) { /* pre-boot */ }
    for (const id of ['navSignin', 'footSignin']) { const n = $(id); if (n) n.textContent = user ? 'Account' : 'Sign in'; }
  }

  /* ui.js defers the first-run theater (welcome card / phone overture) here
   * while a public view is up — it plays on studio entry, where it's
   * actually visible, instead of invisibly behind the landing. */
  function deferFirstRun(fn) {
    if (typeof fn !== 'function' || !landingAlive()) return false;
    firstRunCb = fn;
    return true;
  }

  /* Code-owned track table (§16a). Anchors = scroll fractions of chapter
   * centers (measured at init; defaults keep it pure for selftest + the
   * overture). Continuous rows tile [0,1] per prop; switch rows (p0===p1)
   * commit whole (§8a). Camera = the §11a continuous shot: drift wide →
   * square-on → dolly close → pull low/long; dist rides k × fitted dist. */
  const DEFAULT_ANCHORS = { mast: 0, c1: 0.18, c2: 0.42, c3: 0.68, c4: 0.86, close: 1 };
  function _buildTracks(a) {
    a = a || DEFAULT_ANCHORS;
    const seg = (prop, stops) => {
      const rows = [];
      for (let i = 0; i < stops.length - 1; i++) {
        rows.push({ prop, p0: stops[i][0], p1: stops[i + 1][0], from: stops[i][1], to: stops[i + 1][1] });
      }
      return rows;
    };
    const sw = (prop, p0, to) => ({ prop, p0, p1: p0, to });
    const draftOn = a.mast + (a.c1 - a.mast) * 0.55;
    const draftOff = a.c3 + (a.c4 - a.c3) * 0.45;
    const fillMid = (a.c1 + a.c2) / 2;
    let bp = -1; // beat thresholds stay strictly monotone under any layout
    const beatAt = p => { bp = Math.max(bp + 0.001, p); return bp; };
    return [].concat(
      seg('theta', [[0, 0.95], [a.c1, 0.5], [a.c2, 0], [a.c3, 0.45], [a.c4, 0.85], [1, 0.72]]),
      seg('phi', [[0, 1.24], [a.c1, 1.09], [a.c2, 1.52], [a.c3, 1.22], [a.c4, 1.42], [1, 1.13]]),
      seg('distK', [[0, 1.12], [a.c1, 1.5], [a.c2, 1.18], [a.c3, 0.68], [a.c4, 1.08], [1, 1.32]]),
      seg('fill', [[0, 0], [a.c1, 0], [fillMid, 0.55], [a.c2, 1], [1, 1]]),
      [sw('draft', draftOn, 1), sw('draft', draftOff, 0),
        sw('mat', draftOn, 1),
        sw('dims', a.c2 - 0.04, 1), sw('dims', draftOff, 0),
        sw('ortho', a.c2 - 0.07, 1), sw('ortho', a.c2 + 0.09, 0),
        sw('explode', a.c3 - 0.05, 0.14), sw('explode', draftOff + 0.02, 0),
        sw('beat', beatAt(0), 'mast'), sw('beat', beatAt(draftOn), 'describe'),
        sw('beat', beatAt((a.c1 + a.c2) / 2), 'draft'), sw('beat', beatAt(a.c3 - 0.07), 'prove'),
        sw('beat', beatAt(draftOff), 'build')]
    );
  }
  let tracks = _buildTracks();

  /* Track evaluation: continuous props resolve to the segment containing p;
   * switches reset to base then apply every crossed row in order, so a
   * backward scrub honestly reverts each committed state. The io object is
   * reused — the scroll apply allocates nothing. */
  const SW_BASE = { draft: 0, mat: 0, dims: 0, ortho: 0, explode: 0, beat: 'mast' };
  function evalTracks(p, io, table) {
    io.pose.theta = io.pose.phi = io.pose.distK = io.pose.fill = null;
    Object.assign(io.sw, SW_BASE);
    for (const r of table || tracks) {
      if (r.p1 > r.p0) {
        if (p >= r.p0 && (p < r.p1 || r.p1 >= 1)) {
          const t = Math.max(0, Math.min(1, (p - r.p0) / (r.p1 - r.p0)));
          io.pose[r.prop] = r.from + (r.to - r.from) * t;
        }
      } else if (p >= r.p0) {
        io.sw[r.prop] = r.to;
      }
    }
  }

  /* ---------------- shared pipeline data (the nightstand starter) ---------- */
  let data = null;
  function pipelineData() {
    if (data) return data;
    const K = BB.K, U = BB.Units;
    const spec = BB.Spec.correctSpec(BB.Gallery.STARTERS[4].spec);
    const model = BB.Parametric.build(spec);
    const report = BB.Spec.validate(spec, model);
    const integrity = BB.Structural.computeIntegrity(spec, model, { defaultLoad: 'auto' });
    const cut = BB.Plans.cutList(spec, model);
    data = { K, U, spec, model, report, integrity, cut };
    return data;
  }

  /* ---------------- stage + scrub state ---------------- */
  const S = {
    mode: 'static', engine: null, D0: 3200, p: 0, inited: false,
    sw: Object.assign({}, SW_BASE), pose: { theta: null, phi: null, distK: null, fill: null },
    obs: [], cleanups: [], reveals: [], live: false, disposed: false,
    numerals: [], numCache: []
  };
  const M = () => BB.Motion;

  function anchorsFromLayout() {
    const vh = innerHeight || 800;
    const total = Math.max(1, porchEl.offsetHeight - vh);
    const pr = porchEl.getBoundingClientRect();
    const at = id => {
      const n = $(id);
      if (!n) return null;
      const r = n.getBoundingClientRect();
      return Math.max(0, Math.min(1, (r.top - pr.top + r.height / 2 - vh / 2) / total));
    };
    const a = { mast: 0, c1: at('ph-ch1'), c2: at('ph-ch2'), c3: at('ph-ch3'), c4: at('ph-ch4'), close: 1 };
    if (a.c1 == null || a.c2 == null || a.c3 == null || a.c4 == null) return DEFAULT_ANCHORS;
    // enforce strict monotonic order so the table always tiles [0,1]
    let last = 0;
    for (const k of ['c1', 'c2', 'c3', 'c4']) { a[k] = Math.max(a[k], last + 0.02); last = a[k]; }
    if (a.c4 >= 0.98) return DEFAULT_ANCHORS;
    return a;
  }

  /* Apply one scroll fraction to the stage — the ONLY writer of stage state.
   * Zero allocation: the pose object is reused; numeral transforms write
   * only when their rounded pixel value changes. */
  function applyP(p) {
    S.p = p;
    evalTracks(p, S);
    const e = S.engine;
    if (!e) return;
    if (!S.live && S.pose.theta !== null) {
      S.poseOut.theta = S.pose.theta;
      S.poseOut.phi = S.pose.phi;
      S.poseOut.dist = S.pose.distK * S.D0;
      e.setCameraPose(S.poseOut);
    }
    e.setDraftFill(S.pose.fill == null ? 1 : S.pose.fill);
    if (S.sw.draft !== S.swCur.draft) {
      S.swCur.draft = S.sw.draft;
      e.setDrafting(!!S.sw.draft);
      if (porchEl && M().on()) { // diegetic ink-wash on the stage flip
        porchEl.classList.remove('ph-inkwash');
        void porchEl.offsetWidth;
        porchEl.classList.add('ph-inkwash');
      }
    }
    if (S.sw.mat !== S.swCur.mat) {
      S.swCur.mat = S.sw.mat;
      if (S.sw.mat) e.materializeStart();
    }
    if (S.sw.dims !== S.swCur.dims) { S.swCur.dims = S.sw.dims; e.setDims(!!S.sw.dims); }
    if (S.sw.ortho !== S.swCur.ortho) { S.swCur.ortho = S.sw.ortho; e.setProjection(S.sw.ortho ? 'ortho' : 'persp'); }
    if (S.sw.explode !== S.swCur.explode) { S.swCur.explode = S.sw.explode; e.setExplode(S.sw.explode || 0); }
    if (S.sw.beat !== S.swCur.beat && porchEl) { S.swCur.beat = S.sw.beat; porchEl.dataset.beat = S.sw.beat; }
    for (const r of S.reveals) {
      if (!r.done && p >= r.p0) { r.done = true; try { r.fn(); } catch (err) { /* reveal is decoration */ } }
    }
    for (let i = 0; i < S.numerals.length; i++) {
      const n = S.numerals[i];
      const t = Math.max(0, Math.min(1, (p - n.p0) / (n.p1 - n.p0)));
      const px = Math.round((0.5 - t) * 26);
      if (px !== S.numCache[i]) { S.numCache[i] = px; n.el.style.transform = 'translateY(' + px + 'px)'; }
    }
  }
  S.poseOut = { theta: 0, phi: 0, dist: 0 };
  S.swCur = Object.assign({}, SW_BASE);

  /* ---------------- DOM enrichment (live numbers only) ---------------- */
  const el = (tag, cls, html) => {
    const n = doc.createElement(tag);
    if (cls) n.className = cls;
    if (html !== undefined) n.innerHTML = html;
    return n;
  };
  const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  function fillElevation() {
    const host = $('phElev');
    if (!host) return;
    const d = pipelineData();
    host.innerHTML = BB.Drafting.elevationSVG(d.spec, d.model, 'front', v => d.U.fmtLength(v), { animatable: true });
  }

  function fillProve() {
    const d = pipelineData();
    const plate = $('phPlate'), counters = $('phCounters');
    if (!plate || !counters) return;
    const sum = d.integrity.summary;
    const verdict = sum.verdict;
    const stampText = verdict === 'pass' ? 'proven' : verdict === 'anchor' ? 'anchor required' : verdict;
    const ws = sum.worstSag;
    const sagLine = ws
      ? `worst span sags ${esc(d.U.fmtSmall(ws.sag))} against ${esc(d.U.fmtSmall(ws.limit))} allowed · safety factor ${BB.Structural.SAFETY_FACTOR}`
      : `no sagging span in this piece · safety factor ${BB.Structural.SAFETY_FACTOR}`;
    const row = (l, v) => `<div class="spec-plate-row"><span class="spec-plate-label">${l}</span><span class="spec-plate-value">${v}</span></div>`;
    plate.innerHTML = `<span class="stamp ${esc(verdict)}" id="phStamp">${esc(stampText)}</span><div class="spec-plate" style="border-top:0;padding-bottom:0">` +
      row(esc(d.spec.meta.name), `${esc(d.U.fmtLength(d.spec.overall.width))} × ${esc(d.U.fmtLength(d.spec.overall.depth))} × ${esc(d.U.fmtLength(d.spec.overall.height))}`) +
      (ws ? row('critical span', esc(d.U.fmtLength(ws.span))) : '') +
      `</div><p class="ph-verdict-line">${sagLine}</p>`;
    counters.textContent = '';
    const spans = [];
    for (const [v, label] of [[d.model.parts.length, 'parts drafted'],
      [d.integrity.checks.length, 'structural checks'], [BB.Structural.SAFETY_FACTOR, 'safety factor']]) {
      const w = el('div', 'ph-counter');
      const c = el('span', 'counter', '0');
      w.append(c, el('span', 'kicker', esc(label)));
      counters.append(w);
      spans.push([c, v]);
    }
    return { spans, stamp: $('phStamp') };
  }

  function fillCuts() {
    const host = $('phCuts');
    if (!host) return [];
    const d = pipelineData();
    host.textContent = '';
    const rows = d.cut.slice(0, 6);
    for (const r of rows) {
      host.append(el('div', 'ph-cut',
        `<span class="ph-cut-name">${esc(r.name)}</span><span class="ph-cut-qty">×${r.qty}</span>` +
        `<span class="ph-cut-dim">${esc(d.U.fmtLength(r.L))} × ${esc(d.U.fmtLength(r.W))} × ${esc(d.U.fmtLength(r.T))}</span>`));
    }
    return [...host.children];
  }

  /* Shapeshift fallback band: three real starters, honest part counts —
   * thumbnails render idle-time from a throwaway engine (gallery precedent).
   * The closing band's starters row consolidates here (logged in findings). */
  const SHIFT_STARTERS = [0, 3, 5];
  function fillShift() {
    const host = $('phShiftRow');
    if (!host) return;
    host.textContent = '';
    const entries = [];
    for (const i of SHIFT_STARTERS) {
      const g = BB.Gallery.STARTERS[i];
      const spec = BB.Spec.correctSpec(g.spec);
      const model = BB.Parametric.build(spec);
      const fig = el('figure', 'ph-thumb',
        `<span class="ph-thumb-empty" aria-hidden="true">${BB.Icons ? BB.Icons.svg('board', 26) : ''}</span>
         <figcaption>${esc(spec.meta.name)} <span class="ph-thumb-parts">· ${model.parts.length} parts</span></figcaption>`);
      host.append(fig);
      entries.push({ fig, spec, model });
    }
    const pass = () => {
      try {
        const canvas = doc.createElement('canvas');
        canvas.style.cssText = 'position:fixed;left:-9999px;top:0;width:320px;height:240px;';
        doc.body.append(canvas);
        const mini = BB.Engine.create(canvas, { reducedMotion: true });
        for (const e2 of entries) {
          mini.setModel(e2.model, e2.spec, { snap: true });
          mini.frame();
          mini.snapNow();
          const img = doc.createElement('img');
          img.alt = '';
          img.src = mini.renderNow().toDataURL('image/png');
          const empty = e2.fig.querySelector('.ph-thumb-empty');
          if (empty) empty.replaceWith(img);
        }
        mini.dispose();
        canvas.remove();
      } catch (e) { /* skeleton stays — decoration only */ }
    };
    if (globalThis.requestIdleCallback) {
      const id = requestIdleCallback(pass, { timeout: 2500 });
      S.cleanups.push(() => { try { cancelIdleCallback(id); } catch (e) { /* already fired */ } });
    } else {
      const id = setTimeout(pass, 1500);
      S.cleanups.push(() => clearTimeout(id));
    }
  }

  /* ---------------- build-vs-buy calculator (design-language §8) ----------
   * Input presets are code-owned dimension sets (inch-clean mm) fed to the
   * REAL pipeline; RETAIL_COMPARABLE is a labeled ballpark range — a
   * knowledge table, never a computed output. Money follows the BOM's own
   * $x.xx convention; dimensions render through BB.Units. */
  const CALC_TEMPLATES = [['table', 'Table'], ['desk', 'Desk'], ['bench', 'Bench'], ['bookshelf', 'Bookshelf'], ['nightstand', 'Nightstand'], ['cabinet', 'Cabinet']];
  const CALC_SIZES = {
    table: { S: [1219.2, 762, 736.6], M: [1524, 863.6, 736.6], L: [1828.8, 914.4, 749.3] },
    desk: { S: [1066.8, 558.8, 736.6], M: [1320.8, 660.4, 736.6], L: [1524, 762, 736.6] },
    bench: { S: [914.4, 355.6, 457.2], M: [1117.6, 381, 457.2], L: [1371.6, 406.4, 457.2] },
    bookshelf: { S: [762, 279.4, 1219.2], M: [914.4, 304.8, 1828.8], L: [1066.8, 330.2, 2133.6] },
    nightstand: { S: [457.2, 381, 558.8], M: [508, 406.4, 609.6], L: [609.6, 457.2, 660.4] },
    cabinet: { S: [609.6, 406.4, 812.8], M: [762, 457.2, 914.4], L: [914.4, 508, 914.4] }
  };
  const RETAIL_COMPARABLE = { // per template × size class, USD, "typical store range"
    table: { S: [400, 900], M: [600, 1500], L: [900, 2500] },
    desk: { S: [250, 700], M: [400, 1100], L: [600, 1600] },
    bench: { S: [150, 450], M: [200, 600], L: [300, 800] },
    bookshelf: { S: [150, 500], M: [250, 800], L: [400, 1100] },
    nightstand: { S: [150, 500], M: [250, 700], L: [350, 900] },
    cabinet: { S: [400, 1200], M: [700, 1800], L: [1000, 2500] }
  };
  const CALC_SPECIES = ['red_oak', 'white_oak', 'hard_maple', 'walnut', 'cherry', 'ash'];
  const money = v => '$' + (Math.round(v * 100) / 100).toFixed(2);
  const calc = { template: 'table', size: 'M', species: 'red_oak', raf: 0, out: null };

  function calcCompute() {
    const K = BB.K, U = BB.Units;
    const raw = BB.Spec.defaultSpec(calc.template);
    const dims = CALC_SIZES[calc.template][calc.size];
    raw.meta.level = 'intermediate';
    raw.overall = { width: dims[0], depth: dims[1], height: dims[2] };
    raw.wood.species = calc.species;
    const spec = BB.Spec.correctSpec(raw);
    const model = BB.Parametric.build(spec);
    const cut = BB.Plans.cutList(spec, model);
    const prices = K.defaultPrices();
    const stockPlan = BB.Packing.planStock(spec, model, cut, { prices, stockMode: {} });
    const integrity = BB.Structural.computeIntegrity(spec, model, { defaultLoad: 'auto' });
    const steps = BB.Plans.assembly(spec, model, integrity, { stockPlan });
    const est = BB.Plans.timeEstimate(spec, model, cut, steps, stockPlan);
    return {
      cost: stockPlan.totalCost,
      boards: stockPlan.boards.length + stockPlan.sheets.length,
      parts: model.parts.length,
      hoursLow: est.hoursLow, hoursHigh: est.hoursHigh,
      dims: `${U.fmtLength(spec.overall.width)} × ${U.fmtLength(spec.overall.depth)} × ${U.fmtLength(spec.overall.height)} · ${K.WOOD_SPECIES[spec.wood.species].label}`,
      retail: RETAIL_COMPARABLE[calc.template][calc.size]
    };
  }

  function calcRender(first) {
    const r = calcCompute();
    const stats = $('phCalcStats');
    if (!stats) return;
    if (first) {
      const stat = (id, inner, k) => `<div class="calc-stat"><span class="counter"${id ? ` id="${id}"` : ''}>${inner}</span><span class="kicker">${k}</span></div>`;
      stats.innerHTML = stat('phCalcCost', '0', 'wood, packed on real boards') +
        stat('phCalcBoards', '0', 'boards &amp; sheets to buy') +
        stat('phCalcParts', '0', 'parts, cut to size') +
        stat('', '<span class="counter" id="phCalcHl">0</span>–<span class="counter" id="phCalcHh">0</span> h', 'honest bench time');
      $('phCalcVerdict').innerHTML = 'Your cost: <span class="counter" id="phCalcCost2">$0.00</span> in wood — the rest is Saturday.';
    }
    const roll = (id, v, fmt) => {
      const t = $(id);
      if (!t) return;
      // first paint writes plain text so the section-enter roll starts at 0;
      // static mode always renders final values (reduced-motion parity).
      if (S.mode === 'scrub' && !first) M().count(t, v, fmt ? { fmt } : undefined);
      else { t.textContent = fmt ? fmt(v) : String(Math.round(v)); }
    };
    roll('phCalcCost', r.cost, money);
    roll('phCalcCost2', r.cost, money);
    roll('phCalcBoards', r.boards);
    roll('phCalcParts', r.parts);
    roll('phCalcHl', r.hoursLow);
    roll('phCalcHh', r.hoursHigh);
    $('phCalcDims').textContent = r.dims;
    $('phCalcRetail').innerHTML = '<span class="kicker">A comparable piece at retail</span>' +
      `<div class="spec-plate-row"><span class="spec-plate-label">typical store range</span><span class="spec-plate-value">$${r.retail[0]}–$${r.retail[1]}</span></div>` +
      `<div class="spec-plate-row"><span class="spec-plate-label">your wood</span><span class="spec-plate-value" id="phCalcAgainst">${money(r.cost)}</span></div>`;
    calc.out = r;
  }

  function calcSchedule() {
    if (calc.raf) return;
    calc.raf = requestAnimationFrame(() => { calc.raf = 0; calcRender(false); });
  }

  function buildCalc() {
    const rows = $('phCalcRows');
    if (!rows) return;
    rows.textContent = '';
    const K = BB.K;
    const mkRow = (label, items, get, set) => {
      const row = el('div', 'calc-row');
      row.append(el('span', 'kicker', esc(label)));
      for (const [key, text] of items) {
        const chip = el('button', 'calc-chip', esc(text));
        chip.type = 'button';
        chip.setAttribute('aria-pressed', String(get() === key));
        chip.onclick = () => {
          set(key);
          for (const c of row.querySelectorAll('.calc-chip')) c.setAttribute('aria-pressed', 'false');
          chip.setAttribute('aria-pressed', 'true');
          if (M().on()) M().pop(chip);
          calcSchedule();
        };
        row.append(chip);
      }
      rows.append(row);
    };
    mkRow('Piece', CALC_TEMPLATES, () => calc.template, v => { calc.template = v; });
    mkRow('Size', [['S', 'Small'], ['M', 'Medium'], ['L', 'Large']], () => calc.size, v => { calc.size = v; });
    mkRow('Species', CALC_SPECIES.map(k => [k, K.WOOD_SPECIES[k].label]), () => calc.species, v => { calc.species = v; });
    calcRender(true);
    buildCalcCapture();
  }

  /* The calculator is a qualified-intent signal — capture it instead of
   * discarding it (credits pivot, Phase 5). Optional, quiet, and honest:
   * storage-less or API-less hosts show a plain failure note. */
  function buildCalcCapture() {
    const host = $('phCalc');
    if (!host || $('phCalcLead')) return;
    const wrap = el('form', 'calc-lead');
    wrap.id = 'phCalcLead';
    wrap.innerHTML = `<label class="kicker" for="phCalcEmail">Email me this estimate</label>
      <div class="calc-lead-row">
        <input type="email" id="phCalcEmail" name="email" required placeholder="you@example.com" autocomplete="email" aria-label="Email address">
        <button type="submit" class="btn small">Send it</button>
      </div>
      <p class="calc-lead-note" id="phCalcLeadNote" role="status"></p>`;
    wrap.addEventListener('submit', async e => {
      e.preventDefault();
      const note = $('phCalcLeadNote');
      const email = $('phCalcEmail').value.trim();
      const r = calc.out || {};
      try {
        const res = await fetch('/api/lead', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, kind: 'calculator', context: JSON.stringify({ template: calc.template, size: calc.size, species: calc.species, cost: r.cost, boards: r.boards, parts: r.parts, hours: [r.hoursLow, r.hoursHigh] }) })
        });
        note.textContent = res.ok ? 'Saved — the estimate is on its way.' : 'Couldn’t save that right now — the studio itself is one click away.';
      } catch (err) {
        note.textContent = 'Couldn’t save that right now — the studio itself is one click away.';
      }
    });
    host.append(wrap);
  }

  /* ---------------- entering the studio (design-language §7 handoff) ------- */
  function seedLevel(path) {
    const lv = path === 'first' ? 'beginner' : path === 'regular' ? 'intermediate' : path === 'pro' ? 'advanced' : null;
    if (!lv) return;
    const apply = () => {
      const sel = $('levelSelect');
      if (sel) sel.value = lv;
      const bb = globalThis.__bb;
      if (!bb || !bb.state || !bb.state.prefs4) return false;
      bb.state.prefs4.level = lv;
      BB.Store.savePrefs(bb.state.prefs4); // persists; ui.js enforces prefs4.level on every applied spec
      return true;
    };
    try { if (apply()) return; } catch (e) { return; }
    // A CTA can land before boot exposes __bb — retry briefly so the seeded
    // level persists instead of stopping at the select's cosmetic value.
    let n = 0;
    const iv = setInterval(() => {
      n++;
      try { if (apply() || n > 40) clearInterval(iv); } catch (e) { clearInterval(iv); }
    }, 250);
  }

  function enterStudio(path) {
    markSeen();
    teardown();
    if (porchEl && porchEl.parentNode) porchEl.remove();
    // a page hash (#faq/#signin) must not survive into the studio — a reload
    // there should land back in the studio, not on the page
    if (/^#(faq|signin)$/.test(location.hash || '')) {
      try { history.replaceState(null, '', location.pathname + location.search); } catch (e) { /* sandboxed frame */ }
    }
    showView('app');
    scrollTo(0, 0);
    seedLevel(path);
    const app = $('app');
    if (app && M() && M().on()) { // one quiet settle on arrival
      app.classList.remove('studio-enter');
      void app.offsetWidth;
      app.classList.add('studio-enter');
    }
    // Deferred first-run theater plays on arrival — the welcome card, or the
    // phone overture (suppressed when the starters dialog is the ask).
    if (firstRunCb) {
      const fn = firstRunCb;
      firstRunCb = null;
      try { fn({ suppressOverture: path === 'first' }); } catch (e) { /* never load-bearing */ }
    }
    if (path === 'first') {
      // The starters dialog owns focus (aria-modal trap) — stealing it back
      // for the hero prompt would fight the trap.
      const g = $('galleryBtn');
      if (g) { g.click(); return; }
    }
    const hero = $('heroText');
    if (hero && hero.offsetParent) hero.focus();
    else if (!doc.querySelector('.ov-caption')) { // the overture owns focus while it plays
      const chat = $('chatText');
      if (chat) chat.focus();
    }
  }

  /* Scrub → static, one way. teardown() is a one-way door by design, so a
   * viewport that narrows past the CSS reflow line downgrades to the static
   * document (full content parity — the same experience phones get) rather
   * than trying to make teardown reversible for a rare interaction. Widening
   * again stays static until the next visit. */
  function downgrade() {
    if (S.mode !== 'scrub' || S.disposed) return;
    S.mode = 'static';
    BB.Porch.mode = 'static';
    teardown();
    if (!landingAlive()) return;
    porchEl.dataset.mode = 'static';
    delete porchEl.dataset.beat;
    delete porchEl.dataset.live;
    delete porchEl.dataset.anim;
    initStatic().catch(() => { /* the document stands without stills */ });
  }

  function teardown() {
    if (S.disposed) return;
    S.disposed = true;
    for (const o of S.obs) { try { o.revert(); } catch (e) { /* observer already gone */ } }
    S.obs.length = 0;
    for (const fn of S.cleanups) { try { fn(); } catch (e) { /* best effort */ } }
    S.cleanups.length = 0;
    if (S.engine) { try { S.engine.dispose(); } catch (e) { /* GL already lost */ } S.engine = null; }
  }

  /* "See the intro again" — More-menu hook (verifier wires the menu item):
   * clears the gate and reloads so the porch narrative replays. */
  function replay() {
    try { localStorage.removeItem('bb.porchSeen'); } catch (e) { /* ignore */ }
    try { sessionStorage.removeItem('bb.porchSeen'); } catch (e) { /* ignore */ }
    location.reload();
  }

  /* ---------------- sign-in page (#signin) ----------------
   * Rendered from the REAL auth probe: provider buttons where the origin
   * offers accounts, the signed-in identity when there is one, and an honest
   * local-first note where accounts aren't configured. */
  const PROVIDER_LABELS = { google: 'Google', github: 'GitHub', dev: 'Dev (local)' };
  let signinProbe = 'idle'; // idle | busy | done
  let signinMode = 'login'; // login | register — the email/password form's mode
  // Server error codes (api/_passwords.js) → human copy. Login stays generic
  // on a bad address so the page never reveals which emails are registered.
  const PASSWORD_ERROR_COPY = {
    invalid_credentials: 'That email and password don’t match. Check them and try again.',
    email_taken: 'An account already exists for that email — switch to Sign in.',
    weak_password: 'Use at least 8 characters for your password.',
    invalid_email: 'Enter a valid email address.',
    invalid_password: 'That password can’t be used. Try a different one.',
    too_many_attempts: 'Too many attempts. Wait a few minutes, then try again.',
    storage_unconfigured: 'Accounts are temporarily unavailable. Please try again shortly.'
  };
  function renderSignin() {
    const box = $('signinBody');
    if (!box) return;
    const St = BB.Store;
    const a = St && St.auth ? St.auth() : { user: null, providers: [] };
    if (signinProbe === 'idle' && St && St.init) {
      signinProbe = 'busy';
      Promise.resolve()
        .then(() => St.init({ timeoutMs: 4000 }))
        .catch(() => null)
        .then(() => {
          signinProbe = 'done';
          if (view === 'signin') renderSignin();
          updateNav();
        });
    }
    box.textContent = '';
    const note = t => el('p', 'signin-note', t);
    const btn = (cls, label) => {
      const b = el('button', 'btn signin-btn' + (cls ? ' ' + cls : ''), label);
      b.type = 'button';
      return b;
    };
    if (a.user) {
      const row = el('div', 'signin-user',
        (a.user.avatar ? `<img class="signin-avatar" src="${esc(a.user.avatar)}" alt="" referrerpolicy="no-referrer">` : '') +
        `<span>${esc(a.user.name)}</span>`);
      box.append(row, note('You’re signed in — projects sync to your account and follow you to any device.'));
      const open = btn('primary', 'Open the studio');
      open.dataset.enter = '';
      const out = btn('', 'Sign out');
      out.onclick = () => { location.href = St.logoutUrl; };
      box.append(open, out);
      return;
    }
    const hasOAuth = !!(a.providers && a.providers.length);
    const hasPassword = !!a.passwordAuth;
    if (hasOAuth) {
      for (const p of a.providers) {
        const b = btn('primary', 'Continue with ' + esc(PROVIDER_LABELS[p] || p));
        // signing in is intent to work — land in the studio after the round trip
        b.onclick = () => { markSeen(); location.href = St.loginUrl(p); };
        box.append(b);
      }
    }
    if (hasOAuth && hasPassword) {
      box.append(el('div', 'signin-or', '<span>or</span>'));
    }
    if (hasPassword) {
      box.append(buildPasswordForm());
      box.append(note('Your first blueprint credit is free with a new account, and your projects follow you to any device.'));
    } else if (!hasOAuth && signinProbe !== 'done') {
      box.append(note('Checking this workshop’s sign-in options…'));
    } else if (!hasOAuth) {
      box.append(note('This workshop runs without accounts: designs autosave to this device, and a share code carries a whole design anywhere in a line of text.'));
      const open = btn('primary', 'Open the studio');
      open.dataset.enter = '';
      box.append(open);
    } else {
      // OAuth-only origin (no password auth configured).
      box.append(note('Sign-in runs through your existing account. Your projects then follow you to any device.'));
    }
  }

  /* The email + password form. One <form> so Enter submits and browser
   * password managers recognise it; a mode toggle flips between signing in
   * and creating an account (the name field appears only on register). */
  function buildPasswordForm() {
    const register = signinMode === 'register';
    const form = el('form', 'signin-form');
    form.setAttribute('novalidate', '');
    form.autocomplete = 'on';
    form.innerHTML =
      `<h2 class="signin-form-title">${register ? 'Create your account' : 'Sign in with email'}</h2>` +
      (register ? `<label class="signin-field"><span>Name <em>(optional)</em></span>
         <input type="text" name="name" autocomplete="name" maxlength="80" placeholder="Your name"></label>` : '') +
      `<label class="signin-field"><span>Email</span>
         <input type="email" name="email" autocomplete="email" required placeholder="you@example.com"></label>
       <label class="signin-field"><span>Password</span>
         <input type="password" name="password" autocomplete="${register ? 'new-password' : 'current-password'}"
           required minlength="8" placeholder="${register ? 'At least 8 characters' : 'Your password'}"></label>
       <p class="signin-error" role="alert" aria-live="polite" hidden></p>
       <button type="submit" class="btn primary signin-btn signin-submit">${register ? 'Create account — free credit' : 'Sign in'}</button>
       <p class="signin-toggle">${register ? 'Already have an account?' : 'New here?'}
         <button type="button" class="linkish" data-signin-toggle>${register ? 'Sign in' : 'Create one — it’s free'}</button></p>`;
    const errEl = form.querySelector('.signin-error');
    const submit = form.querySelector('.signin-submit');
    const showError = code => {
      errEl.textContent = PASSWORD_ERROR_COPY[code] || 'Something went wrong. Please try again.';
      errEl.hidden = false;
    };
    form.querySelector('[data-signin-toggle]').onclick = () => {
      signinMode = register ? 'login' : 'register';
      renderSignin();
    };
    form.onsubmit = async e => {
      e.preventDefault();
      errEl.hidden = true;
      const data = new FormData(form);
      const email = String(data.get('email') || '').trim();
      const password = String(data.get('password') || '');
      if (!email) return showError('invalid_email');
      if (password.length < 8) return showError('weak_password');
      submit.disabled = true;
      submit.textContent = register ? 'Creating account…' : 'Signing in…';
      try {
        await BB.Store.passwordAuth(register ? 'register' : 'login',
          { email, password, name: String(data.get('name') || '') });
        // Session is set and state re-probed — land in the studio to work.
        enterStudio();
      } catch (err) {
        submit.disabled = false;
        submit.textContent = register ? 'Create account — free credit' : 'Sign in';
        showError(err && err.code);
      }
    };
    return form;
  }

  /* ---------------- init ---------------- */
  function typeOn() {
    const t = $('phType');
    if (!t || !M().on()) return;
    const full = t.dataset.full || t.textContent;
    t.dataset.full = full;
    t.textContent = '';
    let i = 0;
    const iv = setInterval(() => {
      i++;
      t.textContent = full.slice(0, i);
      if (i >= full.length) clearInterval(iv);
    }, 35);
    S.cleanups.push(() => { clearInterval(iv); t.textContent = full; });
  }

  function stageTheme() {
    if (!S.engine) return;
    const explicit = doc.documentElement.dataset.theme;
    const dark = explicit ? explicit === 'dark' : !!(darkMq && darkMq.matches);
    S.engine.setTheme(dark ? 'dark' : 'light');
  }

  function initScrub() {
    const canvas = $('porchCanvas');
    const d = pipelineData();
    const engine = BB.Engine.create(canvas, { reducedMotion: false });
    S.engine = engine;
    engine.setModel(d.model, d.spec);
    engine.resize();
    engine.frame();
    S.D0 = engine.cameraPose().dist;
    stageTheme();
    const mo = new MutationObserver(stageTheme);
    mo.observe(doc.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    S.cleanups.push(() => mo.disconnect());
    if (darkMq) {
      darkMq.addEventListener('change', stageTheme);
      S.cleanups.push(() => darkMq.removeEventListener('change', stageTheme));
    }
    const ro = new ResizeObserver(() => engine.resize());
    ro.observe(canvas.parentElement);
    S.cleanups.push(() => ro.disconnect());
    engine.materializeStart(); // the piece assembles into the masthead frame

    // measured anchors → the one code-owned track table
    const a = anchorsFromLayout();
    tracks = _buildTracks(a);
    BB.Porch._tracks = tracks;
    BB.Porch._anchors = a;

    // ghost numeral drift rides the same driver (few px, cached writes)
    S.numerals.length = 0;
    [['ph-ch1', a.c1], ['ph-ch2', a.c2], ['ph-ch3', a.c3], ['ph-ch4', a.c4]].forEach(([id, c]) => {
      const n = doc.querySelector('#' + id + ' .ph-num');
      if (n) { S.numerals.push({ el: n, p0: Math.max(0, c - 0.16), p1: Math.min(1, c + 0.16) }); S.numCache.push(null); }
    });

    // copy reveals fire on section enter, through the same p; each threshold
    // re-derives from the anchors when the layout re-measures
    const rev = (layout, fn) => S.reveals.push({ p0: layout(a), layout, fn, done: false });
    const m = M();
    rev(x => Math.max(0.001, x.c1 - 0.14), () => {
      const c = doc.querySelector('#ph-ch1 .ph-copy');
      m.lines(c.querySelector('.ph-head'));
      m.reveal(c.querySelector('.ph-body'));
      typeOn();
    });
    rev(x => x.c2 - 0.14, () => {
      const c = doc.querySelector('#ph-ch2 .ph-copy');
      m.lines(c.querySelector('.ph-head'));
      m.reveal(c.querySelector('.ph-body'));
      m.draw($('phElev'), { dur: 900 });
    });
    rev(x => (x.c2 + x.c3) / 2 - 0.05, () => {
      m.cascade(doc.querySelectorAll('.ph-claims li'));
    });
    rev(x => x.c3 - 0.14, () => {
      const c = doc.querySelector('#ph-ch3 .ph-copy');
      m.lines(c.querySelector('.ph-head'));
      m.reveal(c.querySelector('.ph-body'));
      const pv = fillProve();
      if (pv) {
        m.settle($('phStamp'));
        for (const [span, v] of pv.spans) m.count(span, v);
      }
    });
    rev(x => x.c4 - 0.14, () => {
      const c = doc.querySelector('#ph-ch4 .ph-copy');
      m.lines(c.querySelector('.ph-head'));
      m.reveal(c.querySelector('.ph-body'));
      m.cascade(fillCuts());
    });
    rev(x => Math.min(0.94, x.c4 + (1 - x.c4) * 0.3), () => {
      calcSchedule(); // counters roll in as the calculator enters
      m.cascade(porchEl.querySelectorAll('.entry-card'));
    });
    // the handover: the stage goes orbit-live at the closing band
    rev(() => 0.93, () => {
      S.live = true;
      porchEl.dataset.live = '1';
      const spin = $('phSpin');
      if (spin) { spin.hidden = false; m.reveal(spin); }
    });

    // masthead reveal on load
    m.lines($('phH1'));
    m.reveal($('phLede'), { delay: 120 });
    porchEl.dataset.anim = '1';

    // THE driver: one scroll observer → track table → damped engine goals
    const sc = m.scrollSync(porchEl, {
      enter: 'start start', leave: 'end end', sync: false,
      onUpdate: self => applyP(self.progress)
    });
    S.obs.push(sc);
    applyP(0);

    // content-visibility materialization changes the porch's height after
    // init — re-measure the observer's bounds and the anchor table when it
    // does, so p honestly spans [0,1] over the real document.
    let lastH = porchEl.offsetHeight;
    const roP = new ResizeObserver(() => {
      const h = porchEl.offsetHeight;
      if (Math.abs(h - lastH) < 40) return;
      lastH = h;
      try { sc.refresh(); } catch (e) { /* observer gone */ }
      const a2 = anchorsFromLayout();
      tracks = _buildTracks(a2);
      BB.Porch._tracks = tracks;
      BB.Porch._anchors = a2;
      for (let i = 0; i < S.numerals.length; i++) {
        const c = [a2.c1, a2.c2, a2.c3, a2.c4][i];
        S.numerals[i].p0 = Math.max(0, c - 0.16);
        S.numerals[i].p1 = Math.min(1, c + 0.16);
      }
      for (const r2 of S.reveals) if (r2.layout) r2.p0 = r2.layout(a2);
    });
    roP.observe(porchEl);
    S.cleanups.push(() => roP.disconnect());

    // crossing the CSS reflow line downgrades to static (teardown removes
    // this listener with the rest — the door stays one-way)
    if (narrowMq) {
      const onNarrow = () => { if (narrowMq.matches) downgrade(); };
      narrowMq.addEventListener('change', onNarrow);
      S.cleanups.push(() => narrowMq.removeEventListener('change', onNarrow));
    }

    // layout reflows instantly on resize; the stage's vw-offset drift must
    // not ease toward a position the layout has already left — hold the
    // transition off while resize events stream, restore on settle
    let rzTimer = 0;
    const onResize = () => {
      porchEl.classList.add('ph-resizing');
      clearTimeout(rzTimer);
      rzTimer = setTimeout(() => porchEl.classList.remove('ph-resizing'), 200);
    };
    addEventListener('resize', onResize);
    S.cleanups.push(() => {
      removeEventListener('resize', onResize);
      clearTimeout(rzTimer);
      porchEl.classList.remove('ph-resizing');
    });
  }

  const POSTER_POSES = {
    describe: { draft: 1, fill: 0.4, dims: 0, ortho: 0, explode: 0, theta: 0.5, phi: 1.09, distK: 1.5 },
    draft: { draft: 1, fill: 1, dims: 1, ortho: 1, explode: 0, theta: 0, phi: 1.52, distK: 1.18 },
    prove: { draft: 1, fill: 1, dims: 1, ortho: 0, explode: 0.14, theta: 0.45, phi: 1.22, distK: 0.68 },
    build: { draft: 0, fill: 1, dims: 0, ortho: 0, explode: 0, theta: 0.85, phi: 1.42, distK: 1.08 }
  };
  async function initStatic() {
    const pv = fillProve();
    if (pv) for (const [c, v] of pv.spans) c.textContent = String(v); // final values — static parity
    fillCuts();
    try {
      const d = pipelineData();
      const canvas = doc.createElement('canvas');
      canvas.style.cssText = 'position:fixed;left:-9999px;top:0;width:640px;height:480px;';
      doc.body.append(canvas);
      const eng = BB.Engine.create(canvas, { reducedMotion: true });
      eng.setModel(d.model, d.spec, { snap: true });
      eng.frame();
      const D0 = eng.cameraPose().dist;
      const explicit = doc.documentElement.dataset.theme;
      eng.setTheme(explicit === 'dark' || (!explicit && darkMq && darkMq.matches) ? 'dark' : 'light');
      for (const [key, q] of Object.entries(POSTER_POSES)) {
        const slot = doc.querySelector(`.ph-slot[data-poster="${key}"]`);
        if (!slot) continue;
        eng.setDrafting(!!q.draft);
        eng.setDraftFill(q.fill);
        eng.setDims(!!q.dims);
        eng.setProjection(q.ortho ? 'ortho' : 'persp');
        eng.setExplode(q.explode);
        eng.setCameraPose({ theta: q.theta, phi: q.phi, dist: q.distK * D0 });
        // one engine tick applies bucket/drafting materials (they swap in the
        // tick, not in the setters); reducedMotion k=1 settles it in a frame
        await new Promise(r => requestAnimationFrame(r));
        eng.snapNow();
        const img = doc.createElement('img');
        img.alt = '';
        img.src = eng.renderNow().toDataURL('image/png');
        slot.textContent = '';
        slot.append(img);
      }
      eng.dispose();
      canvas.remove();
    } catch (e) { /* the document stands without stills */ }
  }

  function init() {
    if (!active || S.inited) return;
    S.inited = true;
    try {
      const fine = !(coarseMq && coarseMq.matches);
      const wide = narrowMq ? !narrowMq.matches : (innerWidth || 0) >= 880;
      S.mode = (fine && wide && M() && M().on()) ? 'scrub' : 'static';
      BB.Porch.mode = S.mode;
      porchEl.dataset.mode = S.mode;
      // shared enrichment (both modes); CTAs land through the one document-
      // level [data-enter] delegate (bootstrap below) — header, footer, and
      // page CTAs share the exact same door.
      fillElevation();
      fillShift();
      buildCalc();
      if (S.mode === 'scrub') initScrub();
      else initStatic().catch(() => { /* the document stands without stills */ });
    } catch (e) {
      // any throw = the complete static document, silently
      try { if (porchEl) { porchEl.dataset.mode = 'static'; } teardown(); } catch (e2) { /* stand down */ }
    }
  }

  /* Porch/overture start only after the boot skeleton is gone (§12 budget:
   * boot stays untouched) AND the landing is the on-screen view — a #faq or
   * #signin arrival initializes the scrub only once the visitor actually
   * lands on it (hidden porch = unmeasurable anchors). Poll is cheap and
   * self-cancels. */
  let scheduled = false;
  function schedule() {
    if (!active || scheduled) return;
    scheduled = true;
    const t0 = Date.now();
    const iv = setInterval(() => {
      if (S.inited || S.disposed || !landingAlive()) { clearInterval(iv); return; }
      if (view !== 'landing') return;
      if (!doc.getElementById('bootSkeleton') || Date.now() - t0 > 6000) {
        clearInterval(iv);
        requestAnimationFrame(() => requestAnimationFrame(init));
      }
    }, 120);
  }

  /* ---------------- the Overture (front-porch §3, in-app, first-run) ------ */
  /* Wanted only where the porch cannot scrub the story itself: static-mode
   * porch on a motion-capable device (phones/coarse per design-language §11).
   * The caller (ui.js boot tail) adds its own gates: first run, !reduced,
   * WebGL alive, skeleton removed. */
  function shouldOverture(o) {
    o = o || {};
    if (o.seenOverture || o.reduced || o.webgl === false || o.skeletonGone === false) return false;
    if (!active) return false;
    if (!(M() && M().on())) return false;
    const fine = !(coarseMq && coarseMq.matches);
    const wide = (innerWidth || 0) >= 880;
    return !(fine && wide); // desktop scrub owns the story; the overture is the phone's
  }

  const OV_CAPTIONS = [
    'Say what you want to build.',
    'Code drafts it — every dimension computed, none guessed.',
    'Physics checks it. Honestly.',
    'Then we turn it into wood, cut lists, and build steps.'
  ];
  function overture(engine, opts) {
    opts = opts || {};
    const m = M();
    if (!engine || !m || !m.on()) return false;
    const wrap = $('viewportWrap');
    if (!wrap) return false;
    let finished = false, started = false;
    const caption = el('p', 'ov-caption');
    caption.setAttribute('aria-live', 'polite');
    const skip = el('button', 'btn small ghost ov-skip', 'Skip');
    skip.type = 'button';
    wrap.append(caption, skip);
    const tl = m.timeline({ defaults: { ease: 'linear' } });
    const obj = { p: 0 };
    const io = { pose: { theta: null, phi: null, distK: null }, sw: Object.assign({}, SW_BASE) };
    const cur = Object.assign({}, SW_BASE);
    const pose = { theta: 0, phi: 0, dist: 0 };
    const ovTracks = _buildTracks(DEFAULT_ANCHORS);
    const D0 = engine.cameraPose().dist;
    let capIdx = -1;
    const apply = () => {
      started = true;
      const p = obj.p;
      evalTracks(p, io, ovTracks);
      if (io.pose.theta !== null) {
        pose.theta = io.pose.theta; pose.phi = io.pose.phi; pose.dist = io.pose.distK * D0;
        engine.setCameraPose(pose);
      }
      engine.setDraftFill(io.pose.fill == null ? 1 : io.pose.fill);
      for (const k of ['draft', 'mat', 'dims', 'ortho', 'explode']) {
        if (io.sw[k] !== cur[k]) {
          cur[k] = io.sw[k];
          if (k === 'draft') {
            engine.setDrafting(!!cur.draft);
            wrap.classList.remove('inkwash'); void wrap.offsetWidth; wrap.classList.add('inkwash');
          } else if (k === 'mat' && cur.mat) engine.materializeStart();
          else if (k === 'dims') engine.setDims(!!cur.dims);
          else if (k === 'ortho') engine.setProjection(cur.ortho ? 'ortho' : 'persp');
          else if (k === 'explode') engine.setExplode(cur.explode || 0);
        }
      }
      const beats = [0.02, 0.2, 0.62, 0.8];
      let idx = -1;
      for (let i = 0; i < beats.length; i++) if (p >= beats[i]) idx = i;
      if (idx !== capIdx && idx >= 0) {
        capIdx = idx;
        caption.textContent = OV_CAPTIONS[idx];
        m.reveal(caption);
        if (idx === 2 && opts.integrity) {
          const sum = opts.integrity.summary;
          const ws = sum.worstSag;
          const stamp = el('span', 'stamp ' + sum.verdict,
            (sum.verdict === 'pass' ? 'proven' : sum.verdict === 'anchor' ? 'anchor required' : sum.verdict) +
            (ws ? ` — sags ${BB.Units.fmtSmall(ws.sag)} of ${BB.Units.fmtSmall(ws.limit)} allowed` : ''));
          caption.append(doc.createElement('br'), stamp);
          m.settle(stamp);
        }
      }
    };
    const finish = () => {
      if (finished) return;
      finished = true;
      try { tl.cancel(); } catch (e) { /* inert */ }
      removeEventListener('pointerdown', finish, true);
      removeEventListener('wheel', finish, true);
      removeEventListener('keydown', finish, true);
      try {
        engine.setDrafting(false);
        engine.setDims(false);
        engine.setDraftFill(1);
        engine.setProjection('persp');
        engine.setExplode(0);
        engine.frame();
        engine.snapNow();
      } catch (e) { /* engine already standard */ }
      caption.remove();
      skip.remove();
      // mirror the story to chat for AT continuity
      try {
        const log = $('chatLog');
        if (log) {
          const msg = el('div', 'msg bot');
          msg.innerHTML = `<div class="bubble">${OV_CAPTIONS.map(esc).join(' ')}</div>`;
          log.append(msg);
        }
      } catch (e) { /* chat mirror is a courtesy */ }
      if (typeof opts.onDone === 'function') opts.onDone();
    };
    skip.onclick = finish;
    addEventListener('pointerdown', finish, true);
    addEventListener('wheel', finish, true);
    addEventListener('keydown', finish, true);
    tl.add(obj, { p: 1, duration: 7600, ease: 'linear', onUpdate: apply, onComplete: finish }, 0);
    tl.init();
    setTimeout(() => { if (!started) finish(); }, 400); // first-frame watchdog
    setTimeout(() => { if (!finished) finish(); }, 12000); // absolute guard
    try { skip.focus(); } catch (e) { /* focus best-effort */ }
    return true;
  }

  BB.Porch = {
    active, mode: S.mode, view: null,
    enterStudio, replay, overture, shouldOverture, deferFirstRun, showView,
    _gateDecision, _routeFromHash, _buildTracks, _tracks: tracks, _anchors: DEFAULT_ANCHORS,
    _state: S, _calc: calc, _applyP: applyP
  };

  /* ---------------- bootstrap: resolve the arrival view ---------------- */
  if (doc && doc.body) {
    // every "Open the studio" CTA — porch, header, footer, FAQ, sign-in —
    // goes through the one door
    doc.addEventListener('click', e => {
      const b = e.target && e.target.closest ? e.target.closest('[data-enter]') : null;
      if (!b) return;
      e.preventDefault();
      enterStudio(b.dataset.enter || null);
    });
    addEventListener('hashchange', () => {
      const v = _routeFromHash(location.hash, landingAlive());
      if (v !== view) showView(v);
    });
    // fixed header takes its hairline once the page is off the top
    let navTick = false;
    addEventListener('scroll', () => {
      if (navTick) return;
      navTick = true;
      requestAnimationFrame(() => {
        navTick = false;
        const h = $('siteHeader');
        if (h && !h.hidden) h.classList.toggle('scrolled', scrollY > 8);
      });
    }, { passive: true });
    showView(_routeFromHash(typeof location !== 'undefined' ? location.hash : '', landingAlive()));
  }
})();
