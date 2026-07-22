# Phase 2a brief — LANDING subagent (the porch)

You are building Blueprint Buddy's landing experience in an isolated git
worktree. Read first, in order — they are the complete authority; do not
re-derive or re-litigate decisions:
1. `docs/overhaul/design-language.md` — §5 (motion presets you consume), §6
   (porch amendments), §7 (section-by-section choreography), §8 (calculator +
   entry paths), §10–12 (voice, breakpoints, budgets).
2. `docs/ui/front-porch.md` — the creative spec of record for the porch
   (beats, captions, copy draft of record §4a, gate §4d, budgets §8, laws,
   rejected list). Design-language §6 amends its implementation only.
3. `docs/overhaul/flow-blueprint.md` — §1 landing rows, §3 state, §5 tests.
4. `docs/overhaul/execution-plan.md` — file ownership.
5. `docs/overhaul/findings/phase1-notes.md` — the motion API as actually
   shipped.
6. `CLAUDE.md` — module system, conventions, founding rule.

## You own (write nothing else)
`src/porch.js` · `src/porch.css` · the template region between
`<!-- PORCH:BEGIN -->` and `<!-- PORCH:END -->` in `src/index.template.html`
· `test/porch.playwright.js` · one `"test:porch"` script line in package.json
· a porch section in `src/selftest.js` (guarded on `BB.Porch`) · ≤ ~40
display-only lines in `src/engine.js` (below) · `src/ui.js` ONLY at the two
integration points (below) · your findings file
`docs/overhaul/findings/phase2a-notes.md` + screenshots under
`docs/overhaul/findings/landing/`.

**The fence (absolute):** no edits to ai.js, spec.js, parametric.js,
structural.js, plans.js, packing.js, fasteners.js, units.js, knowledge.js,
codec.js, hardware.js, gallery.js, drafting.js, api/, test/golden/, build.js,
motion.js, styles.css. Every number you display is read from the live
pipeline (`state.report`, plans, packing, knowledge tables) at render time —
a hardcoded measurement is a founding-rule violation. Dimensional text always
renders through `BB.Units`.

## Engine additions (display-only, the whole allowance)
In the public api object of `src/engine.js` (match its style):
- `setCameraPose(p)` — assign any of `{theta, phi, dist}` onto `camGoal`
  (clamp phi 0.12–1.52, dist ≥ `minDolly(E.bounds)`, ≤ 20000); snap
  (`Object.assign(camCur, camGoal); placeCamera()`) under `E.reducedMotion`.
- `materializeStart()` — sibling of `heroAssemble`: keep each rec's home
  target, set `rec.cur.scale = {x:0.001,y:0.001,z:0.001}` (positions at
  home), build-order `rec.delay = Math.min(i*0.04, 0.6)` when
  `!E.reducedMotion`.
- `setDraftFill(t)` — clamp 0–1 into a module-level scalar; where drafting
  materials get their opacity, multiply by it (drafting mode only; 1 =
  today's exact appearance; find the draftMats opacity site and apply the
  multiplier there + `E.needsAnno` if labels ride it). Zero allocation.
`stats()` must stay flat: no new geometries/materials/textures.

## What to build

**A · The porch document** (real DOM inside the PORCH region, crawlable,
composed from Phase-1 components + your `.chapter/.calc/.entry-paths/
.ov-caption` styles in porch.css — tokens only, both themes, AA):
masthead (Act 0) → chapters 01–04 → honesty band → calculator → entry
paths + closing band, exactly per design-language §7 table and front-porch
§4a copy verbatim. Chapter washes from existing wash tokens. Ghost numerals,
occlusion sandwich (H1 behind the transparent stage canvas, lede/CTA in
front), `.kicker` labels, `Motion.lines` headline reveals, `Motion.count`
counters (real figures only), `content-visibility:auto` on off-screen
chapters. The DRAFT chapter includes a real elevation SVG:
`BB.Drafting.elevationSVG(model, spec, {animatable:true})` (Phase 1 added the
flag) drawn in via `Motion.draw`.

**B · The stage** — one porch-owned engine instance
(`BB.Engine.create` on a porch canvas, pointer-events:none until handover):
boots the nightstand starter (`BB.Gallery.STARTERS[4]`) through the same
`runPipeline` the app uses (call `BB.Spec.correctSpec`→`BB.Parametric.build`
→`BB.Spec.validate`→`BB.Structural.computeIntegrity` the way `ui.js
runPipeline` does — read it; do not duplicate derived-plan work you don't
display). Scroll choreography: ONE `Motion.scrollSync` timeline on the porch
container maps progress p to a code-owned track table (beat targets, camera
waypoints via `setCameraPose`, `setDraftFill`, `setDims`, `setDrafting`,
caption classes) — the damped follower does the smoothing; never bind
transforms to raw scrollY; wheel is never hijacked. Chapter reframes read as
one continuous shot (front-porch §11a): drift wide (01) → square-on ortho
(02) → dolly close, dims on (03) → pull low, wood (04). PROVEN capsule
`Motion.settle`s with the live sag-margin line from the stage's own computed
report. Ink-wash beat 4 via `setDrafting(false)` under the existing
`.inkwash` viewport treatment or your own equivalent CSS on the porch stage.

**C · The Overture** (first-run, in-app; front-porch §3): at the tail of
`boot()` in ui.js — integration point 1 — branch exactly as §3 specifies:
first run only, `!reducedMotion`, WebGL alive, skeleton removed; hand the
MAIN engine to `BB.Porch.overture()` (time-driven `Motion.timeline` over the
same track table; beats 1–5, captions as real DOM mirrored to chat for AT);
400 ms first-frame watchdog and any-input skip both land `snapNow()` + the
standard welcome path. `prefs4.seenOverture` gates it to once ever (persist
via the existing prefs4 save path). Any throw = silent fallback to today's
exact boot.

**D · The gate** (front-porch §4d): tiny inline head script CANNOT be added
(template head is Phase-1 frozen) — instead gate at the top of porch.js
(runs before ui.js): synchronous `localStorage 'bb.porchSeen'` peek →
returning users / `location.hash` design links (`#d=`) / `?app` param get
the porch `remove()`d before first paint (your script runs pre-boot; measure
that no porch flash occurs). Storage-less → sessionStorage fallback →
show-and-skippable. Set seen on studio entry. "See the intro again": add one
More-menu item — integration point 2 in ui.js/template ONLY IF the app
agent's region makes it trivial; otherwise expose `BB.Porch.replay()` and
add the menu item to your findings for the verifier (do not fight over
shared files; log it).

**E · `enterStudio(path)`**: every CTA routes here — set `bb.porchSeen`,
dispose the porch engine, remove/collapse the porch section (smooth scroll
bench into view; instant under reduced motion), focus `#heroText` (welcome
card is up on first run), seed `prefs4.level` for entry paths
(first-build→beginner + open starters gallery; regular→intermediate;
pro→advanced) through the existing level-select change path so the
preference persists. Zero re-entry of known info.

**F · Calculator** (design-language §8): template/size/species chips → run
the real pipeline in a debounced worker-free call (it's fast; reuse one spec
object) → `Motion.count` the material cost (BOM stock-plan price), boards,
parts, bench-hours; retail comparison from a code-owned
`RETAIL_COMPARABLE` table you define IN porch.js (per template × S/M/L,
labeled "typical store range"). All money via the BOM's own formatting
conventions; all dimensions via `BB.Units`.

**G · Static/phone/reduced parity**: coarse pointers or <880px = no sticky
scrub — plain full-bleed chapters with poster stills (generate via the stage
engine `snapNow()+renderNow()` per pose into <img>/canvas — one codepath
with reduced-motion posters, per front-porch §4b). Reduced motion = complete
static document, all copy visible, counters at final values, no overture, no
timelines (`Motion` gate handles presets; you must also not build the scroll
timeline). Pre-JS: the porch markup + CSS alone must read as a complete
document (test with JS disabled).

## Tests you ship
`test/porch.playwright.js` (mirror smoke's harness: local http server,
storage shim, SwiftShader chromium at /opt/pw-browsers/chromium,
`--no-sandbox --enable-unsafe-swiftshader`), asserting at minimum:
fresh profile shows porch + zero console errors; scroll to bottom drives
chapter states; CTA lands studio with `#heroText` focused and porch gone +
`bb.porchSeen` set; second visit skips porch; `#d=` hash arrival skips
porch; reduced-motion emulation = porch visible, static, overture absent,
studio boot identical; entry path seeds level select; calculator renders a
$ figure that changes when species changes; overture plays once on first
run (and skip works via pointerdown); main-engine `stats()` flat after
porch dispose + a theme flip; JS-disabled porch document contains the H1
and chapter copy (fetch dist HTML and assert markup presence); an automated
scrub sampling rAF deltas (p95 ≤ 20 ms under SwiftShader — record the
number, assert generously ≤ 34 ms to avoid CI flake, log actual).
Add the `"test:porch": "node build.js && node test/porch.playwright.js"`
script. Selftest section: gate matrix as pure function
(`BB.Porch._gateDecision(seen, reduced, hash, search)`) + track table covers
p∈[0,1] monotone, no same-property overlap (expose `BB.Porch._tracks`).

## Verification & evidence
`npm run build` + `npm test` + `npm run test:smoke` + `npm run test:porch`
all green in your worktree (smoke must pass UNTOUCHED — you may not edit
it). Screenshots into docs/overhaul/findings/landing/: masthead + each
chapter + calculator + entry paths at 320/375/768/1024/1440/2560 light,
1440 dark, 1440 reduced-motion, one mid-scrub shot. Record dist size delta
(budget: your additions ≤ ~54 KB pre-inline). Findings file: what shipped
vs spec, Shapeshift attempted-or-fallback (it is stretch — static band with
three live thumbnails is the sanctioned fallback), any track-table deltas,
the More-menu item status, measured scrub p95.

## Ways of working
Commit in logical groups referencing spec sections; never `git add -A`;
never commit dist/ or node_modules; end every commit message with:

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01BdGWdPcJuzi3MotsS2tbcJ

Do not push. Your final message: commit SHAs + branch/worktree path, suite
counts, screenshot paths, findings-file path, deltas. A flow problem you
can't build within this brief: LOG it in the findings file and continue —
never improvise a different flow.