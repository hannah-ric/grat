# Phase 1 foundation — implementation notes & spec deltas

Scope: build wiring for anime.js, `BB.Motion` preset library, shared component
CSS, the `Drafting.elevationSVG {animatable}` flag, selftest `motion` section.
Verified: `npm test` (unit 1253 / audit 480 / golden 6/6 / battery 50 / server
150, all green), `npm run test:smoke` (270/270), handcalc 16/16, plus a
35-assert Playwright harness (screenshots in `findings/phase1/`).

## Payload

- Baseline dist: 1 950 845 B. After Phase 1: 2 088 597 B → **+137 752 B**
  (anime bundle 118 043 B; motion.js + component CSS + porch stubs + template
  ≈ 19.7 KB). Against §12's ≤ +170 KB ceiling this leaves ≈ 32 KB for Phase 2
  porch markup/CSS/JS/copy — inside the "porch/motion/copy ≤ 54" sub-budget
  (≈ 34 KB of it remains).

## anime v4.5.0 — the API as it actually is (verified empirically on the bundle)

- `anime.cubicBezier(x1,y1,x2,y2)` is **top-level**, not in `anime.eases`
  (eases holds only the named in/out families). houseEase uses it directly.
- `anime.spring({...})` is the factory; `createSpring` exists but is
  **deprecated and logs a console warning** — never call it.
- Param names: `ease:` (not `easing`), callbacks `onComplete` / `onUpdate`.
- `anime.utils.remove(targets)` cancels in-flight animations **without firing
  `onComplete`** — presets therefore clean inline styles in `onComplete`, and
  an interrupting preset overwrites the same properties, so no stuck states.
- `anime.engine.pauseOnDocumentHidden` default is `true`, `timeUnit` is `ms`
  — both left untouched per spec.

## houseSpring measurement (spec §5 easing policy)

`spring({mass:1, stiffness:190, damping:28})`: max ease value measured
**1.000000** across 2000 samples — no overshoot at the spec's values
(overshoot first appears at damping ≤ 26; critical damping for k=190, m=1 is
2√190 ≈ 27.6). No damping raise was needed.

**Delta:** a spring-eased animation adopts the spring's settling duration
(≈ 980 ms), so `settle()` runs ≈ 980 ms, not the table's nominal "med" — in
anime v4 a spring owns the physical duration and a `duration:` param is
ignored for spring eases. Sanctioned use stays one-time renders (verdict
capsules on first appearance) per the §5 app limits.

## Motion.draw & the drafting `animatable` flag

- `anime.svg.createDrawable` normalizes by setting `pathLength="1000"` on the
  shape at animate time and drives dash **attributes** via a `draw` proxy.
  Drafting's opt-in `pathLength="1"` coexists (anime replaces it while
  animating); the flag's value is for CSS/static dash math and future
  non-anime consumers. Flag default OFF is byte-identical — proved against
  the pre-change module (3 views × 3 call shapes + sheetSVG) and by the
  golden suite; flag ON adds `pathLength="1"` to every stroke shape drafting
  emits (rect / polygon / line — 39/39 on the nightstand front).
- Elements whose dash is **CSS-driven** (the `.opening` dashed callouts)
  resist the drawable's attribute dash — CSS beats presentation attributes —
  so openings keep their dash and do not "draw". Correct and intended:
  `draw()` targets solid-stroke linework. `draw()` accepts an `<svg>`/`<g>`
  container (collects `path,line,polyline,polygon,rect,circle,ellipse`) or
  shape elements directly, pre-sets `draw: '0 0'` through the proxy to kill
  the first-frame flash, and removes dash attributes + inline stroke-linecap
  on complete.

## Motion.lines & the text splitter

- `anime.text.split(el, { lines: { wrap: 'clip' } })` **is present** in this
  bundle (TextSplitter with `.lines`; options `{words, chars, lines,
  accessible, includeSpaces, debug}`; `wrap:'clip'` produces
  `<span style="overflow:clip">` line masks — exactly §1's masked reveal).
- The splitter re-splits on resize (ResizeObserver). `lines()` caches one
  splitter per element (`el.__bbSplit`) because re-splitting an already-split
  element would nest wrappers. Degrade path (splitter missing or throwing):
  whole-element `reveal()`. Reduced motion never splits at all.

## The preset surface as shipped (for Phase 2 authors)

`BB.Motion = { on, _forceOff, reveal, cascade, draw, rule, count,
countUpOnce, lines, settle, pop, timeline, scrollSync, auto, FAST, MED, SLOW,
houseEase, houseSpring }`

- Presets return the anime animation object when `on()`, `null` when off —
  never branch on the return; only `timeline()`/`scrollSync()` are
  gate-stable objects (inert no-ops when off: full Timeline/Timer +
  ScrollObserver method surface, chainable, `then()` resolves with
  `undefined` so `await` never chases the thenable).
- `countUpOnce(el, to, {fmt})` ships per the §5 table (one roll per element;
  later calls snap to the final formatted value) — the "totals count once on
  first render only" helper.
- `auto(root)` hooks: `data-motion="reveal|cascade|draw|count|lines|rule"`;
  cascade members group per closest `[data-motion-group]` ancestor (else the
  parent element); `data-motion="count"` reads `data-count-to` (falls back to
  the element's text) through `countUpOnce` with the **integer default fmt**
  — dimensional counters MUST be wired imperatively with a `BB.Units` fmt
  (display-boundary law); there is deliberately no attribute-based fmt.
- `on()` is also false when the `anime` global is missing (defensive) — end
  states still apply, so a load-order accident degrades instead of throwing.
- Live gate: a mid-session reduced-motion flip affects every **new** preset
  call; already-created timelines/scroll observers belong to their creator —
  the porch director (2a) must revert its own on dispose.
- Cleanup contract: reveal/cascade/rule/settle/pop clear their inline
  opacity/transform on completion — **the stylesheet's resting state IS the
  end state**. Surfaces must not style themselves via inline
  opacity/transform, or a preset will erase it.
- `scrollSync(el, opts)` defaults `{ target: el, sync: true }`; pass
  `sync:'smooth'`/eased variants and `container` through opts.

## Components & tokens

- Added tokens: `--text-billboard` (§1) and `--track-label: .08em` — the
  design language references the latter for the kicker voice and no such
  token existed; the kicker consumes it so the letterspace has one source.
- `.ledger-rule` is defined as the generic drawn hairline (top-level rule,
  `transform-origin: left center` in CSS); spec plates reuse it rather than
  minting a parallel class. `.spec-plate` rows: `.spec-plate-row` /
  `.spec-plate-label` / `.spec-plate-value`; ledger head band:
  `.ledger-head` + `.ledger-sum`. Verdict capsules (`.stamp`) compose in
  unchanged.
- AA measured (not assumed): kicker/label `--muted-2` pairs 5.39:1 (light
  paper), 6.04:1 (light panel), 6.25:1 (dark paper), 5.83:1 (dark panel);
  values `--ink` 14.5–15.7:1. All ≥ 4.5:1 in both schemes.
- `.porch` base rule ships (`display:block`, `[hidden]` wins) so the
  pre-wired region stays inert until 2a fills it.

## Wiring facts for later phases

- Load order: `{{ANIME}}` immediately after `{{THREE}}`; `{{JS_MOTION}}`
  after `{{JS_ICONS}}`; `{{JS_PORCH}}` after `{{JS_ENGINE}}`, before
  `{{JS_UI}}`. Porch CSS is a second `<style>{{CSS_PORCH}}</style>` block
  after the app stylesheet (no font placeholders processed in it).
- `src/porch.js` is a stub IIFE (`BB.Porch = {}`); `src/porch.css` is a
  header comment only — both owned by 2a from here on. motion.js must NOT be
  added to any headless SRC array (browser-only, like ui.js).
