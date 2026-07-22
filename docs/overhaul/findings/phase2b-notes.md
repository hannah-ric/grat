# Phase 2b — app surfaces: what shipped, keys, timings, evidence

Scope: composition of the §9 engineering-as-aesthetic treatments across the
studio surfaces (`src/ui.js`, `src/styles.css`, `test/smoke.playwright.js`),
consuming the Phase 1 components and `BB.Motion` presets only. The July 2026
shell's structure and behavior contracts are untouched: every journey step
count equal, every capability working, zero raw `anime.` calls in ui.js
(grep-verified 0), zero new keyframes/transition values (CSS delta audited:
no ms, no curves, no hex; the two px occurrences are the file-wide hairline
`1px` and a layout cap `min(38vh, 340px)`, both existing shell conventions).

Verified green in this worktree: `npm run build`; `npm test` (unit 1253 /
audit 480 / golden 6/6 byte-stable / battery 50 / server 150);
`npm run test:smoke` **282/282** (270 existing + 12 new); handcalc 16/16.
Re-verified end to end after the final commit series: same counts, all
green, worktree clean except the locally rebuilt dist (not committed —
orchestrator-owned).

## The render-key design (the one-time law, mechanized)

`ui.js` keeps two epoch counters and a seen-map
(`motionKeys = { design, nav, seen }`); every one-time preset call sites
consult `motionOnce(surface, opts)`:

- **design epoch** — bumped by the three design-identity renders:
  `commit()` (every accepted change: AI, fixes, inspector commits, starters,
  imports, units — they all funnel here), `restoreTo()` (undo/redo/history
  restore), and `loadProjectIntoApp()` (project open renders without commit).
- **nav epoch** — bumped when the user brings a plan view on stage: a real
  tab change in `selectTab`, or a Design→Plan mode entry in `setMode`.
  Re-selecting the already-visible tab bumps nothing.
- **key shape** — per-design surfaces key on `d<design>` alone; tab surfaces
  key on `d<design>:n<nav>`. A surface fires its preset only when its stored
  key differs, then stores it.
- **visibility guard** — `motionOnce` returns false (WITHOUT burning the
  key) while `state.mode !== 'plan'` or in build mode: design mode hides
  `.panel` entirely, so a commit landing there must not spend the design
  epoch on an invisible render — the first *visible* render of that design
  gets the motion. Modal surfaces (species compare) pass `opts.modal` to
  skip that guard and reset their own key on dialog open
  (`delete motionKeys.seen.species` in `openSpecies`), so each open replays
  the entrance once while pick-toggle re-renders stay static.
- **what never bumps** — `recompute()` (price/climate/load-preset/stock-mode
  edits), `preview()` (slider drags), `commitPreview()` (the previewed DOM
  is already on screen un-animated; bumping here would only cascade a later
  unrelated recompute), dual/precision re-renders, resize re-layouts
  (mobileAdvisoryMq card/table swap), playback scrubs. All render statically.
- **markers** — a container renders `data-cascaded="1"` only on renders
  where the cascade actually fired; since renderers rebuild DOM each pass,
  the marker's absence on a re-render is the honest "did not re-stagger"
  signal the smoke suite asserts.

Key-assignment table:

| surface | key | fires |
| --- | --- | --- |
| `cut` rows + rule | design+nav | tab open / design change |
| `cut-sum` strip | design | first visible render per design |
| `buy` rows + rule, `bom` rows + rule | design+nav | same |
| `buy-sum`, `bom-sum`, `assembly-sum` | design | same |
| `assembly` step cascade + rule | design+nav | same |
| `overview` (counters, settle, elevation draw) | design | first visible render per design |
| `integrity` (settle, fix-card reveals) | design | first visible render per design |
| `species` (rule + row cascade) | modal, reset on open | once per dialog open |

One real bug found and fixed on the way: `selectTab` → `setMode('plan')`
rendered the panel (consuming the key, cascading), then selectTab rendered
*again*, replacing the cascaded DOM with a static copy — the entrance was
invisible on every Design→Plan transition, and the mode-entry path always
rendered twice. `setMode` now takes `{norender:true}` from selectTab (the
caller renders right after), so mode entry renders once and the entrance
lands on the DOM the user sees. Behavior identical, one render saved.

## What shipped vs spec, per surface

1. **Cut (flagship, §9.2)** — `ledgerHead()` builds the shared band:
   `h3.kicker` "Cut list · every part, ready for the saw" (h3 kept so the
   panel-heading focus/labelling contract holds; styled to the s end of the
   kicker band — the ≥14px UI floor), mono summary strip
   `N parts · N boards · X bd ft` (parts from `state.cut`, boards from
   `stockPlan.boards+sheets`, board feet via `Units.fmtBoardFeet(plan.bdft.
   exact)` — display boundary held; strips paint `fmt(0)` on their first
   rolling frame so the final value never flashes), `Motion.rule` drawn top
   rule, `Motion.count` on the strip once per design, one-time
   `Motion.cascade` on desktop `<tr>`s / phone cut-cards via
   `data-motion="cascade"` + `data-motion-group` + `Motion.auto(container)`
   (brief item 9: declarative markup preferred; counts stay imperative
   because attribute-based fmts are deliberately unsupported for
   dimensional values). The old lede's first sentence moved into the kicker;
   the provenance/stock sentence stays as the lede.
2. **Buy (§9.2)** — same voice on the stock plan ("Buying plan · what to
   buy, how to break it down"; strip `N boards · N sheets · $total`, or
   `X bd ft · …` in rough mode) and the BOM ("Materials & cost · down to
   the screws"; strip `N lines · $total`); shopping + BOM rows cascade.
   Diagrams, price editor, controls untouched.
3. **Overview (2b-2, §9.1/§9.4)** — the drafting cover sheet: the safety
   line became a `.spec-plate` (kicker STRUCTURAL VERDICT, verdict capsule
   `Motion.settle`s once per design, sentence unchanged, plus one live mono
   row "Checks passed N of N" — a pure read of `integrity`); the four stat
   tiles keep their derivation and become counters (`Motion.count` once per
   design; the Safety tile's capsule settles instead; "—" states never
   count); NEW drawing tile: `BB.Drafting.elevationSVG(spec, model,
   'front', fmt, {animatable:true})` under a "Front elevation · drawn from
   the live model" kicker, `Motion.draw`n once per design change, fully
   drawn (static) on every later render and instantly complete under
   reduced motion (no dash attributes — smoke-asserted). Next-action row
   untouched. Note the brief's inline sketch `elevationSVG(state.model,
   state.spec, {animatable:true})` names the args in a different order than
   the real Phase-1 signature `(spec, model, view, fmt, opts)`; the real
   signature is used.
4. **Safety (2b-3, §9.3)** — summary verdict capsule settles once per
   design; surfaced fail/anchor cards `Motion.reveal` under the same key.
   Interpretation: per-check capsules inside cards do NOT also settle — the
   card already reveals as a unit and double-animating the stamp inside a
   fading card reads as mud; the summary capsule is THE verdict. Layers,
   copy, fixes, climate row: untouched.
5. **Assemble (2b-4)** — ledger head ("Assembly · in build order", strip
   "N steps"), one-time step cascade (design+nav key — playback scrubs
   re-render the list for the active highlight and never re-stagger), and
   the ledger voice on step numbers (mono `counter()` digits via CSS).
   Playback surfaces untouched.
6. **Chat (2b-5)** — diff-card head `Changed` now wears `.kicker` (its
   bespoke styles were already kicker-shaped; the class unifies color/
   weight to the audited token pair); chips cascade ≤360 ms on reply
   arrival (fresh DOM per message = naturally once; their generic CSS rise
   is scoped off for diff cards only, so the preset owns the entrance —
   no double animation); "See your plan" pill and its floating phone
   variant get `Motion.pop`; the Plan segment's state dot gets a one-shot
   `Motion.pop` glint when a chat commit lands in Design mode
   (`glintPlanSegment()` after the successful `commit` in `sendMessage`).
   Honest note: the spec names the *dot* (8px, 6px on phones) as the glint
   target — a 3% scale pulse on it is deliberately subtle; the dot's
   data-state color transition (existing CSS) carries most of the visible
   change. Composed exactly as specified, logged here. Send/busy states
   untouched.
7. **Build mode (2b-6)** — check toggles pop their `.box` (the state
   carrier); Next/swipe task transitions reveal the incoming pager card
   (≤240 ms, interruptible; `renderBmTask({animate:true})` from `bmTaskGo`
   only — toggle-driven and entry re-renders stay instant). Legibility
   floors, pager behavior, wake lock, install nudge untouched.
8. **Dialogs/drawers/menus/welcome (2b-7)** — audited every entrance:
   scrims fade + modals translate (`.scrim`/`.modal` transitions), the
   history drawer slides (transform transition), menus fade/slide
   (`.menu.open`), the welcome card and its path cards ride the `rise`
   keyframe with stagger, chat messages rise, `.panel-inner` rises. CSS
   already does the job everywhere → **zero `Motion.reveal` added** (the
   brief's "do NOT double-animate" branch). One CSS fix in this area: the
   floating plan-CTA pill centered via `transform: translateX(-50%)`,
   which `Motion.pop` (inline-transform owner while running) would have
   unseated — it now centers with `inset-inline + margin auto`, no
   transform.
9. **Empty/loading/error voice (2b-8)** — swept all `emptyState` calls,
   chat error strings, welcome copy, and the projects/storage notes against
   §10: they already name the next action in carpenter-plain voice (July
   shell + premium refit did this work). **No copy changed** — churn for
   its own sake would be off-brief. Logged as reviewed-no-change.

## Smoke-test edits (every one, with why)

Selector updates required: **none** — all 270 existing assertions passed
against the new markup unchanged (the treatments are additive composition).
Additions (12), all in one new "Phase 2b" section placed after the advisory
section and before the reduced-motion section (leaves prior state exactly
as found: viewport 1440, height restored via +15/−15 merges, reduced-motion
emulation cleared):

1–3. Cut ledger: kicker head band present and reads "cut list"; drawn top
  rule present; summary strip matches `parts · boards · bd ft` AND its part
  count equals the live `state.cut` total (live-numbers proof).
4–7. Cascade render-key law via the `data-cascaded` marker: opening Cut
  (from Buy) cascades; re-clicking the open Cut tab does not re-stagger; a
  `recompute()` of the same view does not re-stagger; a `merge()` (design-
  identity change) replays it. This is the brief's "open Cut twice" reading:
  a second render of the same view never re-staggers, while a *fresh view
  entrance* (tab change away and back) legitimately replays per §9.2
  "cascade fires when the user opens the tab".
8. Diff cards wear the kicker head (treatment 5).
9–12. Reduced-motion cover sheet (the representative instant-end-state
  surface, per brief): drawing tile present with animatable (pathLength)
  shapes; linework instantly complete (zero dash attributes); verdict spec
  plate present; stat counters paint final values instantly.

"Zero console errors" stays the suite's final gate (unchanged, passing).

## Measured recompute latency (Cut tab open, 1440×900, headless SwiftShader)

Harness: performance.now around `__bb.merge` (the commit path a chat edit
takes), a full `sendMessage` round trip with an instant injected transport,
and `preview()` (slider-drag hot path); nightstand starter; N=40/20/40.

| path | baseline (2 runs) | after 2b (3 runs; one noisy run discarded*) |
| --- | --- | --- |
| commit, Cut open | median 7.1–7.3 ms · p95 10.4–10.5 | median 8.6–9.1 ms · p95 13.2–15.7 |
| chat round trip | median 13.5–14.6 ms · p95 19.1–19.7 | median 15.1–18.0 ms · p95 21.9–35.8 |
| preview (drag) | median 4.3–4.4 ms · p95 5.7–9.4 | median 4.3–4.7 ms · p95 6.1–12.4 |

\* one run (of four) on the shared-CPU runner produced median 12.5/p95 37 —
environment jitter, reproduced on neither adjacent run.

Reading: the **preview/recompute hot path is unchanged within noise**
(medians 4.3–4.4 → 4.3–4.7 ms) — zero animation allocation there, as
required. The commit path with Cut open carries ≈ +1.5–2 ms median: that is
the one-time cascade/count/rule allocation for the *design-identity* render
the spec sanctions (each merge in the loop is a design change with the tab
open); the anime tick itself runs on rAF after commit returns. Chat round
trip moves with commit (same +1.5–3 ms, inside the run-to-run spread).
Nothing blocks input; nothing animates on recompute/preview renders.

## Payload

dist: 2 088 597 B (Phase 1) → 2 102 460 B = **+13 863 B** for the app pass
(ui.js +11.2 KB, styles.css +2.4 KB; inlined once, no minifier by design —
comments ship, and were densified once already). Against §12's whole-
overhaul ceiling of ≤ +170 KB over 1 950 845 B, the running total is
+151 615 B, leaving **≈ 18.4 KB for 2a's porch** — tighter than the
≈ 34 KB the Phase 1 notes projected for it. FLAG for the orchestrator:
if 2a's porch lands over ≈ 18 KB, the ceiling needs either a porch diet, a
comment-strip pass at merge, or an amendment. Not improvised around here.

## Logged, not built (with reasons)

- **Gallery/starter cards and project-grid cascades** — listed in
  design-language §4's cascade "used by" column, but not in this brief's
  treatment list (1–9); left untouched rather than scope-creeping. One line
  for the verifier: welcome/starter cards already stagger via the existing
  CSS `rise` delays.
- **Per-check capsule settles inside Safety cards** — see Safety above
  (summary capsule + card reveal only; restraint).
- **`.panel-inner` CSS rise on every render** — pre-existing shell behavior
  (tokens-riding, reduced-motion-killed). It also runs on recompute renders;
  it is CSS, cheap, and B-13-audited, so it was left alone per "CSS
  micro-states remain CSS" — but it IS technically an entrance animation on
  recompute paths that predates this phase. Logged for the verifier.
- **Provenance popover `.spec-plate` visual treatment** (§9.5) — assigned by
  the design language but not in the 2b treatment list; not risked without
  a brief line. The popover behavior is untouched either way.
- **`ledger-sum` runs at --text-xs (12–13 px)** — Phase 1's component
  definition; it is a supplementary strip (the table carries the real
  numbers) matching the audited "supplementary kickers only" role of xs.

## Evidence

Screenshots (`docs/overhaul/findings/app/`, light unless noted; every
capture asserted `scrollWidth == innerWidth` — all passed, no horizontal
overflow at any width):

- Flagships at 320/375/768/1024/1440/2560: `cut-<w>.png`, `overview-<w>.png`
- Dark 1440: `cut-1440-dark.png`, `overview-1440-dark.png`, `build-1440-dark.png`
- Reduced motion: `cut-1440-reduced-motion.png` (fresh design epoch, complete end state)
- Others at 375 + 1440: `buy-*`, `safety-*`, `assemble-*`, `chat-diff-*`,
  `build-375.png` (pager) / `build-1440.png` (columns), `welcome-*`
- Detail: `overview-1440-drawing-tile.png` (the dimensioned front elevation
  in the tile, real drafting output)
