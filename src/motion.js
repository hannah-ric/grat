/* Blueprint Buddy — BB.Motion: the named preset library over anime.js v4
 * (design-language §5). Every animated surface calls presets BY NAME — a
 * surface hand-rolling anime calls or ad-hoc keyframes is a defect, same
 * class as hardcoding a hex. Browser-only: excluded from the headless test
 * SRC arrays (like ui.js); the vendored UMD bundle provides `anime` global.
 *
 * Laws carried here:
 * - ONE reduced-motion gate: on() is false under prefers-reduced-motion (live,
 *   listener-updated) or _forceOff; every preset then applies its END state
 *   synchronously and creates no anime objects. timeline()/scrollSync()
 *   return inert no-op objects with the real method surface.
 * - Easing: houseEase cubic-bezier(.22,1,.36,1) mirrors --ease; houseSpring
 *   {mass:1, stiffness:190, damping:28} sits at/above critical damping —
 *   measured max ease value 1.000000 on this bundle (overshoot begins at
 *   damping ≤26). No other curves anywhere.
 * - Durations FAST/MED/SLOW mirror --t-fast/--t-med/--t-slow.
 * - Interruptible: presets anime.utils.remove() their targets first, so
 *   re-invocation cancels in-flight animation on the same elements.
 * - Compositor-only: transform/opacity, plus SVG stroke-dash on drawables.
 *   Counters animate a detached plain object and write textContent.
 * - Display boundary: count() never formats dimensional values itself —
 *   callers pass a BB.Units-based fmt. The default fmt is a plain integer;
 *   tabular digits come from the .counter class.
 * - anime.engine defaults kept (pauseOnDocumentHidden true, timeUnit ms).
 */
var BB = globalThis.BB = globalThis.BB || {};

(function () {
  'use strict';

  const A = globalThis.anime || null;

  const FAST = 150, MED = 240, SLOW = 420;               // mirror --t-*
  const CASCADE_TOTAL = 360;                              // hard cap, §5
  const houseEase = A ? A.cubicBezier(.22, 1, .36, 1) : null;
  const houseSpring = A ? A.spring({ mass: 1, stiffness: 190, damping: 28 }) : null;

  /* The single gate. matchMedia is guarded so accidental headless evaluation
   * degrades to permanently-off instead of throwing. */
  const mq = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;
  let reduced = !!(mq && mq.matches);
  let forced = false;
  if (mq) {
    const sync = e => { reduced = e.matches; };
    if (mq.addEventListener) mq.addEventListener('change', sync);
    else if (mq.addListener) mq.addListener(sync);
  }
  function on() { return !!A && !forced && !reduced; }
  function _forceOff(v) { forced = !!v; }

  /* Normalize a target (element, NodeList/array, or null) to an array. */
  function list(t) {
    if (t == null) return [];
    if (typeof Element !== 'undefined' && t instanceof Element) return [t];
    if (typeof t.length === 'number') return Array.prototype.slice.call(t);
    return [t];
  }

  /* End state for the off path AND post-animation cleanup: inline opacity/
   * transform must never outlive a preset (stylesheet state is the end
   * state), or later CSS on the same element silently loses. */
  function clearStyles(targets) {
    for (const t of targets) {
      if (t && t.style) { t.style.removeProperty('opacity'); t.style.removeProperty('transform'); }
    }
    return null;
  }

  /* opacity 0→1, translateY dy→0 — cards, dialogs, chapter copy. */
  function reveal(el, opts) {
    opts = opts || {};
    const targets = list(el);
    if (!targets.length) return null;
    if (!on()) return clearStyles(targets);
    A.utils.remove(targets);
    return A.animate(targets, {
      opacity: [0, 1],
      translateY: [opts.dy == null ? 12 : opts.dy, 0],
      duration: MED, ease: houseEase, delay: opts.delay || 0,
      onComplete: () => clearStyles(targets)
    });
  }

  /* Staggered reveal for list-shaped surfaces. Total is capped at 360 ms:
   * the step shrinks as the count grows, never the other way. Fires once
   * per user-initiated render — callers must not re-run it on background
   * recomputes of the same view. */
  function cascade(els, opts) {
    opts = opts || {};
    const targets = list(els);
    if (!targets.length) return null;
    if (!on()) return clearStyles(targets);
    const base = opts.step == null ? 28 : opts.step;
    const step = targets.length > 1
      ? Math.min(base, (CASCADE_TOTAL - FAST) / (targets.length - 1)) : 0;
    A.utils.remove(targets);
    return A.animate(targets, {
      opacity: [0, 1],
      translateY: [opts.dy == null ? 12 : opts.dy, 0],
      duration: FAST, ease: houseEase, delay: A.stagger(step),
      onComplete: () => clearStyles(targets)
    });
  }

  /* SVG stroke draw-in ("pencil on vellum"). Accepts an <svg>/<g> container
   * (its stroke geometry is collected) or shape element(s) directly. Anime's
   * drawable proxy owns dash normalization (it sets pathLength=1000 at
   * animate time); drafting's opt-in pathLength="1" serves CSS/static
   * consumers and is compatible. Elements whose dash is CSS-driven (e.g.
   * .opening callouts) keep their CSS dash — the cascade of CSS over
   * presentation attributes is the guarantee, not a special case here. */
  const DRAW_SHAPES = 'path,line,polyline,polygon,rect,circle,ellipse';
  function drawTargets(el) {
    const out = [];
    for (const t of list(el)) {
      if (!t || !t.tagName) continue;
      if (typeof t.getTotalLength === 'function') out.push(t);
      else if (t.querySelectorAll) out.push(...t.querySelectorAll(DRAW_SHAPES));
    }
    return out;
  }
  function drawEnd(shapes) {
    for (const s of shapes) {
      s.removeAttribute('stroke-dasharray');
      s.removeAttribute('stroke-dashoffset');
      if (s.style) s.style.removeProperty('stroke-linecap');
    }
    return null;
  }
  function draw(svgEl, opts) {
    opts = opts || {};
    const shapes = drawTargets(svgEl);
    if (!shapes.length) return null;
    if (!on()) return drawEnd(shapes);
    A.utils.remove(shapes);
    const drawables = A.svg.createDrawable(shapes);
    for (const d of drawables) d.setAttribute('draw', '0 0'); // no first-frame flash
    return A.animate(drawables, {
      draw: '0 1',
      duration: opts.dur == null ? SLOW : opts.dur, ease: houseEase,
      delay: opts.delay || 0,
      onComplete: () => drawEnd(shapes)
    });
  }

  /* Hairline draw: scaleX 0→1 from the left — ledger head rules, spec
   * plates. The stylesheet owns the resting state (scaleX 1). */
  function rule(el) {
    const targets = list(el);
    if (!targets.length) return null;
    if (!on()) return clearStyles(targets);
    A.utils.remove(targets);
    for (const t of targets) if (t.style) t.style.transformOrigin = 'left center';
    return A.animate(targets, {
      scaleX: [0, 1], duration: MED, ease: houseEase,
      onComplete: () => clearStyles(targets)
    });
  }

  /* Number roll on a detached plain object; the element only ever receives
   * fmt(value) as text. Dimensional values MUST come through a BB.Units
   * formatter — the default fmt is for dimensionless integers only. */
  function count(el, to, opts) {
    opts = opts || {};
    const t = list(el)[0];
    if (!t) return null;
    const fmt = typeof opts.fmt === 'function' ? opts.fmt : (v => String(Math.round(v)));
    if (!on()) { t.__bbCountVal = to; t.textContent = fmt(to); return null; }
    if (t.__bbCountObj) A.utils.remove(t.__bbCountObj);
    const obj = { v: typeof t.__bbCountVal === 'number' ? t.__bbCountVal : 0 };
    t.__bbCountObj = obj;
    return A.animate(obj, {
      v: to, duration: SLOW, ease: houseEase,
      onUpdate: () => { t.__bbCountVal = obj.v; t.textContent = fmt(obj.v); },
      onComplete: () => { t.__bbCountVal = to; t.textContent = fmt(to); t.__bbCountObj = null; }
    });
  }

  /* One-shot counter for app surfaces ("totals count once on first render
   * only"): re-invocation on the same element snaps to the final value. */
  function countUpOnce(el, to, opts) {
    const t = list(el)[0];
    if (!t) return null;
    if (t.__bbCounted) {
      t.__bbCountVal = to;
      t.textContent = (opts && typeof opts.fmt === 'function' ? opts.fmt : (v => String(Math.round(v))))(to);
      return null;
    }
    t.__bbCounted = true;
    return count(t, to, opts);
  }

  /* Masked line reveal — landing headlines/ledes only. anime's text splitter
   * wraps each measured line in an overflow-clip span; the rise never paints
   * outside it. Splitters are cached per element (re-splitting a split
   * element would nest wrappers); the splitter itself re-measures on resize.
   * Degrades to reveal() when the splitter is unavailable or fails. */
  function lines(el) {
    const t = list(el)[0];
    if (!t) return null;
    if (!on()) {
      const split = t.__bbSplit;
      if (split && split.lines) clearStyles(split.lines);
      return clearStyles([t]);
    }
    let ls = null;
    try {
      if (!t.__bbSplit && A.text && typeof A.text.split === 'function') {
        t.__bbSplit = A.text.split(t, { lines: { wrap: 'clip' } });
      }
      ls = t.__bbSplit && t.__bbSplit.lines;
    } catch (e) { ls = null; }
    if (!ls || !ls.length) return reveal(t);
    A.utils.remove(ls);
    return A.animate(ls, {
      translateY: ['100%', '0%'],
      duration: MED, ease: houseEase, delay: A.stagger(55),   // 40–70 ms band
      onComplete: () => clearStyles(ls)
    });
  }

  /* Verdict capsules on first appearance: damped, no rotation, no overshoot.
   * The spring owns the physical duration (settling ≈980 ms) — sanctioned
   * for one-time renders only. */
  function settle(el) {
    const targets = list(el);
    if (!targets.length) return null;
    if (!on()) return clearStyles(targets);
    A.utils.remove(targets);
    return A.animate(targets, {
      scale: [0.92, 1], opacity: [0, 1], ease: houseSpring,
      onComplete: () => clearStyles(targets)
    });
  }

  /* Small state feedback — chips, save pulse, toggle acknowledgments. */
  function pop(el) {
    const targets = list(el);
    if (!targets.length) return null;
    if (!on()) return clearStyles(targets);
    A.utils.remove(targets);
    return A.animate(targets, {
      scale: [0.97, 1], duration: FAST, ease: houseEase,
      onComplete: () => clearStyles(targets)
    });
  }

  /* Inert stand-ins for the choreography builders: the full Timeline/Timer +
   * ScrollObserver method surface as chainable no-ops, so porch/overture
   * code never branches on the gate. then() resolves with undefined —
   * resolving with the object itself would make `await` chase the thenable
   * forever. */
  function noopChoreo() {
    const o = {
      duration: 0, progress: 0, currentTime: 0, paused: true, completed: true,
      then: cb => Promise.resolve().then(cb)
    };
    for (const m of ['add', 'sync', 'set', 'call', 'label', 'remove', 'stretch',
      'refresh', 'revert', 'init', 'play', 'pause', 'resume', 'restart', 'seek',
      'reverse', 'cancel', 'complete', 'reset', 'link', 'updateBounds',
      'handleScroll', 'scroll', 'velocity', 'debug', 'removeDebug']) o[m] = () => o;
    return o;
  }

  /* Thin wrapper over createTimeline — overture and porch director only;
   * app surfaces use the one-shot presets above. */
  function timeline(opts) {
    if (!on()) return noopChoreo();
    return A.createTimeline(opts);
  }

  /* Scroll link: always progress-synced (sync: true default — smooth/eased
   * variants ride opts), never hijacked wheel, never raw scrollY→transform. */
  function scrollSync(el, opts) {
    if (!on()) return noopChoreo();
    return A.onScroll(Object.assign({ target: el, sync: true }, opts || {}));
  }

  /* Declarative attachment: renderers mark [data-motion] and call auto(root)
   * once per user-initiated render. Cascade members group per closest
   * [data-motion-group] ancestor (falling back to the parent element) so one
   * stagger spans one list. Counters read data-count-to (else the element's
   * current text) and count once — dimensional counters must be wired
   * imperatively with a BB.Units fmt instead. */
  function auto(root) {
    const scope = root && root.querySelectorAll ? root : (typeof document !== 'undefined' ? document : null);
    if (!scope) return;
    const groups = new Map();
    const nodes = Array.prototype.slice.call(scope.querySelectorAll('[data-motion]'));
    if (scope !== document && scope.matches && scope.matches('[data-motion]')) nodes.unshift(scope);
    for (const el of nodes) {
      const kind = el.getAttribute('data-motion');
      if (kind === 'cascade') {
        const host = (el.closest && el.closest('[data-motion-group]')) || el.parentElement || scope;
        let g = groups.get(host);
        if (!g) groups.set(host, g = []);
        g.push(el);
      } else if (kind === 'reveal') reveal(el);
      else if (kind === 'draw') draw(el);
      else if (kind === 'rule') rule(el);
      else if (kind === 'lines') lines(el);
      else if (kind === 'count') countUpOnce(el, +(el.getAttribute('data-count-to') || el.textContent) || 0);
    }
    groups.forEach(els => cascade(els));
  }

  BB.Motion = {
    on, _forceOff,
    reveal, cascade, draw, rule, count, countUpOnce, lines, settle, pop,
    timeline, scrollSync, auto,
    FAST, MED, SLOW, houseEase, houseSpring
  };
})();
