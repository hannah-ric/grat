# Blueprint Buddy — Overhaul design-language spec (2026-07)

**Status: source of truth for the 2026-07 experience overhaul.** Subagents build
from this document and `flow-blueprint.md` only — never from the reference
sites, and never re-deriving direction. Where this spec cites an existing doc
(`docs/ui/brand-system.md`, `docs/ui/front-porch.md`, `docs/ui/premium-refit.md`,
`docs/ui/interaction-system.md`), that doc's cited section is incorporated as
spec; the porch doc's *implementation* choices are amended by §6 below.

**Reference access note (evidence):** both reference sites are blocked by this
environment's network egress policy (gateway CONNECT 403 to `oryzo.ai` and
`terminal-industries.com`; probe log in `findings/network-block.md`). Direction
was synthesized from (a) the overhaul brief's own detailed translation of both
references, (b) public design-press coverage retrieved by search (Oryzo: Lusion;
dark, spacious, physics-mimicking easing, Z-depth orbital camera, live Three.js
object with weight and inertia. Terminal: Propagande; editorial precision,
massive type, modular layout, confident enterprise voice), and (c) Blueprint
Buddy's own July 2026 design corpus, which had already translated the same
sensibilities into this product's world (`front-porch.md`). "Steal the
sensibility, never the skin" makes this basis sufficient: no visual detail was
ever to be cloned.

## 0 · The synthesis in one paragraph

Blueprint Buddy already owns the sensibility both references perform: an
instrument that treats numbers as sacred and one object with reverence. The
overhaul therefore **evolves, never costumes**: the Showroom palette, the
Fraunces/Hanken/Plex Mono voices, the capsule shape language, and the damped
motion physics all stay. What the references contribute is *scale and
choreography*: display type doing compositional work at billboard size
(both), a scroll-told narrative where the product proves each claim
(terminal), specifications presented as designed objects (oryzo — which we
mean, and they fake), an interactive calculator and tiered entry as
conversion devices (terminal), and one signature 3D moment built with
obsessive craft while everything else exercises restraint (both). The motion
engine that implements all of it is anime.js v4.5.0, vendored and inlined
exactly like Three.js, expressed exclusively through a named preset library.

## 1 · Type system

| Element | Decision | Source |
| --- | --- | --- |
| Faces | Fraunces (display) / Hanken Grotesk (body) / IBM Plex Mono (every machine value, `tabular-nums`) — unchanged | identity |
| Scale | Existing fluid `--text-xs…-4xl` + `--text-hero` (brand-system §3) — unchanged | identity |
| **`--text-billboard`** (NEW) | `clamp(3.5rem, 2rem + 6.6667vw, 8rem)` — porch H1 + chapter numerals only; per front-porch §5.6 | synthesis (porch spec; oryzo/terminal "type is the design") |
| Ghost numerals | Chapter numbers 01–04 as ~30–38vw Fraunces 900 outlines (`-webkit-text-stroke`, ~8% ink alpha), drifting a few px with scroll | oryzo (object-scale composition) via front-porch §14b |
| Masked line reveals | Landing headlines/ledes reveal line-by-line: `Motion.lines()` (anime `text.split` + translateY inside `overflow:hidden` wrappers, 40–70 ms stagger) | terminal (sequential reveal) via front-porch §14c |
| Kicker voice | Uppercase tracked micro-labels (`--track-label +0.08em`, `--text-xs/s`, Hanken 600) formalized as `.kicker` — landing section labels, plan-panel ledger heads, spec-plate titles | terminal (uppercase micro-labels as navigational texture) + identity (existing h6/th voice) |
| Numbers roll | Every counted figure on the landing (parts, sag margins, costs) rolls in Plex Mono via `Motion.count()`; app totals may count once on first render only | terminal (animated counters) via front-porch §14d |
| Floors | Fraunces never below `--text-l`; UI text ≥14 px effective; input text ≥16 px — unchanged | identity (audited) |

## 2 · Color system

Unchanged — the Showroom tokens in `src/styles.css` are the palette, both
schemes (brand-system §1–2). The references contribute **no color**: Oryzo's
dark-industrial and Terminal's green/orange are skin, explicitly banned by the
brief. Landing chapter washes use only existing wash tokens
(`--paper → --seafoam-wash → --amber-soft → --fern-wash → --paper`); dark
scheme is the walnut den throughout. Verdicts always ship as verdict capsules
with text (`PASS / ADVISORY / FAIL`), never color alone. AA contrast pairs are
the audited table in brand-system §2 — no new pairs are minted.
| Element | Decision | Source |
| --- | --- | --- |
| Palette, roles, schemes | Existing Showroom tokens, no additions | identity |
| Landing washes | Existing wash tokens as full-bleed chapter fields | identity (porch §6) |

## 3 · Spatial rhythm & shape

Unchanged: fluid `--space-*` scale, `--radius-s/m/l/pill`, capsule buttons,
hairline separations, elevation from `--shadow-tint` (premium-refit bar: no
ornament, hierarchy from scale/weight/space). Landing sections breathe at
`--space-2xl/3xl`; the app keeps its instrument density.
| Element | Decision | Source |
| --- | --- | --- |
| Space/shape/elevation | Existing tokens; landing at 2xl/3xl rhythm | identity |
| Ornament | None — premium-refit ban list holds everywhere, incl. landing (no grain chrome, stamps, halftone, ticker, grain/vignette overlays) | identity (premium-refit) |

## 4 · Component vocabulary

Existing components (capsule `.btn` tiers, verdict capsules, cards, menus,
tabs, chips, zebra ledgers, blur toolbars, drawers/scrims) are the base — all
surfaces compose them. NEW components, all tokenized, built once in Phase 1:

| Component | What it is | Where used | Source |
| --- | --- | --- | --- |
| `.kicker` | Uppercase tracked micro-label | landing sections, ledger heads, spec plates | terminal |
| `.spec-plate` | A designed specification block: kicker title, mono value rows, hairline rules that draw in, optional verdict capsule | landing chapters, plan Overview, cut/BOM headers | oryzo (engineering-as-aesthetic) |
| `.ledger` | The instrument-grade table treatment: kicker head band, mono numerics, hairline draw-in top rule, one-time row cascade | cut list, BOM, species compare, price editor | oryzo + identity |
| `.counter` | Plex Mono `tabular-nums` figure wired to `Motion.count` | landing counters, Overview stat tiles | terminal |
| `.calc` | Build-vs-buy calculator widget (see §8) | landing | terminal |
| `.entry-paths` | Three tiered entry cards (see §8) | landing closing band | terminal |
| `.chapter` | Landing chapter scaffold: ghost numeral, kicker, billboard headline, lede, stage-side slot | landing | synthesis |
| `.ov-caption` | Overture caption line (display face, one per beat) | first-run overture | porch §3 |

## 5 · Motion vocabulary — `BB.Motion` (the preset library)

**Engine:** anime.js v4.5.0, vendored at `vendor/anime.umd.min.js` (116 KB
min, MIT, © Julian Garnier), inlined by `build.js` before all `src/` modules;
global `anime` namespace (`animate`, `createTimeline`, `onScroll`, `svg`,
`stagger`, `spring`, `text`, `eases`, `utils`, `engine`). This vendoring is a
deliberate, user-mandated amendment to front-porch.md's "no animation
libraries" rejection — recorded in §6. The single-file law holds: no fetched
assets, no npm runtime dependency. "Modular import" under a single-file build
translates to: one engine shared by landing and app (already the cheapest
form), the min bundle, and nothing else vendored.

**The library:** `src/motion.js` → `BB.Motion`, an IIFE like every module.
Browser-only (excluded from headless-test SRC arrays, like `ui.js`). Every
animated surface calls presets **by name**; a surface hand-rolling anime calls
or ad-hoc keyframes is a defect (same class as hardcoding a hex).

**The single reduced-motion gate:** `Motion.on()` — false when
`prefers-reduced-motion: reduce` (live media query). Every preset checks it
and, when off, applies end state synchronously (opacity/transform cleared,
counters render final values, drawables complete, timelines never built).
The engine's own `reducedMotion` snap stays in charge of 3D (same OS signal,
so the two worlds always agree). `anime.engine.timeUnit` stays ms; global
`anime.engine.pauseOnDocumentHidden` default kept.

**Easing policy:** the house curve is `--ease: cubic-bezier(.22,1,.36,1)` →
presets use `cubicBezier(.22,1,.36,1)` ("houseEase"). Springs are allowed
only at critical damping or above (no overshoot — drafting instruments don't
wobble): `spring({ mass:1, stiffness:190, damping:28 })` is the one sanctioned
"physical" easing (`houseSpring`). Durations ride the existing tokens:
fast 150 / med 240 / slow 420 ms (mirror of `--t-*`). No other curves, no
elastic, no bounce, anywhere.

**The presets** (complete list; adding one = editing `motion.js` + this table):

| Preset | Signature | Behavior | Duration/ease | Used by |
| --- | --- | --- | --- | --- |
| `Motion.reveal(el, {dy, delay})` | single element | opacity 0→1, translateY 12px→0 | med · houseEase | cards, dialogs, chapter copy |
| `Motion.cascade(els, {step})` | list-shaped surfaces | reveal with `stagger(step≈28ms)`, total capped ≤ 360 ms (step auto-shrinks with count) | fast per item · houseEase | cut rows, BOM rows, assembly steps, starter cards, project grid |
| `Motion.draw(svgEl, {dur})` | SVG stroke draw-in | `anime.svg.createDrawable` 0→1, "pencil on vellum" | slow · houseEase | dimension callouts, elevation linework, rule strokes, brand mark |
| `Motion.rule(el)` | hairline draw | scaleX 0→1 (transform-origin left) on a rule div | med · houseEase | ledger head rules, spec plates |
| `Motion.count(el, to, {fmt})` | counted figure | number roll to `to`, rendered through `fmt` (ALWAYS a `BB.Units` formatter for dimensional values — display-boundary law) | slow · houseEase | landing counters, Overview tiles |
| `Motion.lines(el)` | headline reveal | `anime.text.split` into masked lines, per-line rise, 40–70 ms stagger | med · houseEase | landing headlines/ledes only |
| `Motion.settle(el)` | verdict capsule | scale 0.92→1 + opacity, damped, no rotation | med · houseSpring | PROVEN capsule, verdict capsules on first render |
| `Motion.pop(el)` | small state feedback | scale 0.97→1 | fast · houseEase | chips, save pulse, toggle acknowledgments |
| `Motion.timeline(opts)` | choreography builder | thin wrapper over `createTimeline` that returns an inert no-op object when `!Motion.on()` | — | overture, porch director only |
| `Motion.scrollSync(el, opts)` | scroll link | wrapper over `onScroll({ sync: true/smooth })` — always progress-linked, never hijacking; returns no-op when off | — | porch chapters, ghost numerals |
| `Motion.countUpOnce(el)` helper + `data-motion` HTML hooks | declarative attachment | `Motion.auto(root)` scans `[data-motion="reveal|cascade|draw|count|lines|rule"]` and applies presets — lets renderers stay declarative | — | plan panels, landing |

**App functional-motion limits (hard):** in-app motion is feedback, ≤ `--t-med`
except one-time renders (≤ 360 ms total cascade); always interruptible (presets
cancel prior animations on the same targets via `anime.utils.remove`); only
compositor-friendly properties (`transform`, `opacity`) plus SVG
stroke-dash on drawables; never gates input (no pointer-events lockouts, no
waiting states driven by animation); nothing loops idly. Cascades fire once
per user-initiated render, never on background recomputes of the same view.
The landing may use `--t-slow` and scroll-synced timelines; the studio may not.

**The 3D integrator stays.** The engine's damped-lerp family
(`k = 1 − e^(−c·dt)`, `src/engine.js`) is a continuous-retarget follower —
the correct physics for orbit/explode/part flight, load-bearing for the
interaction laws and memory contracts, and not tween-shaped. It is logged as
**retained, not migrated** (the brief's "log where non-trivial" path). The
choreography relationship: anime.js timelines animate *scalar goals* (the
porch progress `p`, camera-pose waypoints, fill-wash scalars) and the engine's
follower integrates them — one timeline drives type and scene as one
choreography, two systems never approximate each other. CSS transitions on
hover/press/toggle micro-states remain CSS (they already ride `--ease`/`--t-*`,
the same vocabulary; migrating them buys nothing and risks jank) — logged.

## 6 · Amendments to `front-porch.md` (the implementation deltas)

Front-porch.md remains the porch's *creative* spec (beats, copy, captions,
laws, budgets, rejected list). Implementation amendments, by user mandate:

1. **anime.js is the timeline engine.** §16a's hand-rolled track table is
   replaced by `Motion.timeline`/`Motion.scrollSync`; §4b's
   IntersectionObserver reveals become `Motion.reveal/lines` driven by
   `onScroll` enter callbacks. The damped follower still smooths the stage
   (scrub `p` feeds the engine through the follower, exactly §4b).
2. **"No animation libraries" (rejected list) is superseded** for anime.js
   only — vendored/inlined, so the zero-fetched-assets and no-npm-runtime-dep
   laws hold. GSAP/Lenis/smooth-scroll remain rejected.
3. **New sections join the porch:** build-vs-buy calculator and tiered entry
   paths (§8 below), between the honesty band and the closing band.
4. **Scope:** Part I ships in full (Overture; chapters 01–04; honesty band;
   closing band + handover). Part II items shipping: occlusion sandwich
   (14a), ghost numerals (14b), masked reveals (14c), odometer counters
   (14d), chapter light scripts (12a) if within frame budget, Act 0 skeleton
   draw-on (15b). The Shapeshift (11b) is **stretch**: attempt only after
   everything above verifies; its fallback is a static "One engine. Any
   piece." band with three real starter thumbnails. Foley stays a drawer
   (15c). Everything on the rejected lists stays rejected.
5. **`prefs4.seenOverture` + `bb.porchSeen`** gates per §3/§4d; "See the
   intro again" lands in More.

## 7 · The landing — scroll choreography, section by section

Structure (`<section id="porch">` preceding `main.bench`, real DOM, crawlable;
gate per porch §4d — first visit only, returning users/share links/deep links
bypass pre-paint):

| # | Section | Content & choreography (desktop/tablet) |
| --- | --- | --- |
| 0 | **Act 0 / masthead** | Pre-JS: brand mark strokes draw via CSS `stroke-dashoffset`; kicker `BLUEPRINT BUDDY`; H1 "Furniture that starts as a sentence." at `--text-billboard` behind the stage canvas (occlusion sandwich); lede + rust CTA "Open the studio" + ghost "See how it works ↓". H1/lede reveal via `Motion.lines` on load. |
| 1 | **Chapter 01 DESCRIBE** | Sticky stage left/center, copy right (porch §4a table verbatim). Typed prompt (DOM type-on ~35 ms/char); stage at beat 1→2: grid field, first parts inking in. |
| 2 | **Chapter 02 DRAFT** | Full blueprint, dims ticking on; slow ortho front→iso drift; beside the copy, a real `Drafting.elevationSVG` of the nightstand draws itself in via `Motion.draw` (the flagship linework moment). |
| 3 | **Shapeshift interstitial** (stretch) | "One engine. Any piece." — else static band w/ three live thumbnails. |
| 4 | **Honesty band** | "Why this isn't just AI" — porch §4a copy verbatim; four claims cascade in; wash field. |
| 5 | **Chapter 03 PROVE** | Dark-room grade (12a); joint dots pulse once; PROVEN verdict capsule `Motion.settle`s with the live sag-margin line read from `state.report` at render time; counters roll real numbers (`Motion.count`). |
| 6 | **Chapter 04 BUILD** | Ink-wash → wood; parts fly home; cut-list cards cascade beside the stage (`Motion.cascade`); sun sweeps once if light scripts land. |
| 7 | **Build-vs-buy calculator** | §8. |
| 8 | **Tiered entry paths + closing band** | §8; starters row (real idle thumbnails); trust line; the handover ("Go on. Spin it." — stage goes orbit-live); rust CTA "Open the studio". |

Scroll mechanics: one `Motion.scrollSync` timeline on the porch container
maps scroll fraction `p` to beat targets (code-owned table), feeding the
porch engine's damped follower — never raw scrollY→transform, never hijacked
wheel. Copy reveals fire on section enter. Phones/coarse pointers: **no
sticky scrub** — Overture plus plain full-bleed chapters with static poster
stills (one codepath with the reduced-motion posters). Reduced motion: no
overture, no scrub, no reveals — complete static document, full content
parity, identical CTAs (this IS the static fallback demanded by the brief).

**Signup/entry handoff:** every landing CTA calls one `enterStudio(path)`:
scrolls the bench to viewport, disposes the porch engine, seeds the chosen
path (§8), focuses the hero prompt (`#heroText`) — arrival with momentum, no
re-entry of anything. Auth stays optional/unchanged (More → account) — the
product has no signup wall and the landing must not invent one.

## 8 · Conversion devices (terminal-derived, honestly re-expressed)

**Build-vs-buy calculator** (`.calc`, landing §7): pick a piece
(template chips: table/desk/bench/bookshelf/nightstand/cabinet) + size
(S/M/L presets mapping to code-owned dimension sets) + species (chips from
`knowledge.js`). On change, the calculator runs the **real pipeline**
(`Spec.defaultSpec` → merge → `correctSpec` → `Parametric.build` →
`Plans.cutList/bom` → `Packing.planStock`) and rolls: material cost (the
BOM's stock-plan price), board count, part count, est. bench hours (the
plans' honest estimate). Beside it, "a comparable piece at retail" shows a
range from a new code-owned `RETAIL_COMPARABLE` table (per template ×
size class, clearly labeled "typical store range" — a knowledge table, not a
fabricated measurement; cite-free ballparks are acceptable *as a labeled
range*). Verdict line: "Your cost: $X in wood — the rest is Saturday."
Numbers roll via `Motion.count`; every dimensional value renders through
`BB.Units`. The pipeline already runs in-browser at boot; the calculator is
presentation over existing computation (fence intact).

**Tiered entry paths** (`.entry-paths`): three cards mapped to real product
state, not marketing personas — **First build** (sets skill level beginner,
opens the starters gallery), **Regular maker** (level intermediate, focuses
the blank prompt), **Pro shop** (level advanced, lands on the prompt +
mentions photo→design and BB4 import). Each is `enterStudio(path)` with a
seeded `prefs4.level` (the existing C-06 preference, so chat, Safety
explanations, and joinery gating all follow — the tier genuinely matches the
product to the visitor).

## 9 · Engineering-as-aesthetic (the treatments)

The product generates real engineering output; presenting it as designed
objects is the brand's deepest claim. Treatments:

1. **Dimension/elevation linework draws itself** — `Drafting.elevationSVG`
   gains an opt-in `{animatable:true}` flag adding `pathLength="1"` (golden
   fixtures byte-identical when off, per porch §5.5); `Motion.draw` animates
   stroke-dashoffset. Ships on: landing chapter 02, plan **Overview's new
   drawing tile** (small front elevation of the current piece, drawn in
   once per design change). *Amended at close-out:* the third site named
   here pre-build — "Blueprint Mode's entry" — is descoped: the mode's
   ink-wash plus the engine's own drafting render already are that moment,
   and a DOM overlay drawing on an instrument surface would violate law 5
   (instrument calm). The two shipped sites are the treatment.
2. **The cut list is an instrument** (flagship app surface): `.ledger`
   treatment — kicker head band ("CUT LIST · every part, ready for the saw"),
   drawn top rule, mono dimension columns (existing), provenance underlines
   (existing), one-time `Motion.cascade` on rows, and a mono summary strip
   (`N parts · N boards · total bd ft`) with `Motion.count` on first render.
   Same treatment on Buy/BOM and the species compare.
3. **Verdict capsules settle** (`Motion.settle`) on first appearance;
   text-first always.
4. **Spec plates** on the landing chapters and plan Overview: measured
   values (span, sag vs allowance, safety factor) presented as designed
   blocks — every number read live from `state.report`/knowledge tables at
   render time; a hardcoded figure is a founding-rule violation.
5. **Provenance is the receipt** — the existing tap-a-dimension provenance
   popover is unchanged in behavior; it gains the `.spec-plate` visual
   treatment.

## 10 · Voice (micro-copy notes)

Confident, plain, carpenter-first; playful precision without cuteness.
Patterns: second person, present tense, one clause of wit max ("The studio
speaks carpenter, not computer"), numbers always concrete and real, verdicts
plain ("Physics gets a veto"). Kickers are single words (DESCRIBE, DRAFT,
PROVE, BUILD). Landing copy of record is front-porch §4a verbatim. Error
and empty states name the next action ("No plan yet — describe a piece or
pick a starter"). Never: exclamation-mark enthusiasm, "magic/AI-powered"
puffery, fabricated numbers, apology theater.

## 11 · Per-breakpoint strategy

| Width | Landing | App |
| --- | --- | --- |
| 320–559 | Overture (if !reduced) + plain chapters w/ poster stills; no sticky scrub; calculator stacks; entry paths stack | existing phone shell (sheet chat, pager build) — unchanged structure |
| 560–879 | same as phone landing ≥768 gains two-column chapters | existing tablet shell |
| 880–1439 | full scrub choreography | desktop shell |
| ≥1440–2560 | full choreography; porch content max-width ~90rem, washes full-bleed; stage caps at a sane height | desktop shell; panel measures capped (existing) |

Verification widths for every surface: 320 / 375 / 768 / 1024 / 1440 / 2560,
both schemes, `scrollWidth == innerWidth` everywhere.

## 12 · Performance budgets

| Budget | Ceiling |
| --- | --- |
| Payload delta (whole overhaul) | ≤ +190 KB on 1 951 KB dist — **amended 2026-07-21** from the pre-measurement ≤ +170 KB estimate (anime alone measured 118 KB; Phase 2b landed +13.9 KB; the porch's honest size is ~68 KB). Rationale: sacrificing source readability (comment/whitespace stripping) to chase a pre-measurement estimate inverts the budget's purpose; the landing's real load story is the pre-JS static document + deferred choreography, not 1% of file size. Recorded by the orchestrator as the one sanctioned blueprint amendment of Phase 2. |
| Boot | untouched path to first model (skeleton → adopt → snapNow); porch/overture start only after skeleton removal; 400 ms first-frame watchdog then snap-to-studio |
| Porch JS per frame | ≤ 4 ms mid-tier; zero allocation in scroll `apply`; `content-visibility:auto` on off-screen chapters |
| Landing long tasks | none > 50 ms during scrub (automated scrub records rAF deltas) |
| App interaction | no added input latency; cascades one-time ≤ 360 ms; no animation on the recompute path |
| GL | +1 context while porch on screen, disposed on entry; `stats()` flat after |
| Throttled-mobile landing | pre-JS static porch document paints first (static markup + CSS only — the per-device asset strategy IS progressive enhancement from a complete static document) |

## 13 · Spec trace (decision ledger)

| Element | Decision | Source |
| --- | --- | --- |
| Palette/tokens/space/shape | Showroom unchanged | identity |
| Type faces & scale | unchanged + `--text-billboard` | identity + synthesis |
| Billboard display composition | H1 behind stage (occlusion), ghost numerals | oryzo |
| Sequential-reveal narrative | 4 chapters + honesty band, one thought at a time | terminal |
| Product proves between statements | live engine states per chapter; real elevation SVG draw-in | terminal + oryzo |
| Engineering-as-aesthetic | spec plates, ledger treatment, draw-in linework, live numbers only | oryzo (meant, not faked) |
| Signature 3D moment | the Materialization (blueprint→wood), obsessive craft; everything else restrained | oryzo + terminal shared DNA |
| Calculator | build-vs-buy over the real pipeline + labeled retail range table | terminal |
| Tiered entry | 3 paths seeding real skill-level pref | terminal |
| Counters | `Motion.count` on real figures only | terminal |
| Uppercase micro-labels | `.kicker` system | terminal + identity |
| Motion engine | anime.js v4.5.0 vendored; `BB.Motion` presets; single gate | user mandate |
| Easing | house cubic-bezier + non-overshoot spring only | identity (law 2) |
| 3D physics | damped-lerp follower retained as integrator | identity (laws) — logged non-trivial |
| Scroll | progress-linked sync only, never hijack | identity (law 8) + terminal |
| Reduced motion | full static parity document | identity (law 3) + brief |
| Voice | carpenter-plain, playful precision | identity + oryzo |
| Dark scheme | walnut den everywhere | identity |
| No cork jokes / no dark-industrial clone / no green-orange | banned | brief |

## 14 · Conflict ledger (resolved)

1. porch "no animation libraries" vs brief's anime.js mandate → **brief wins**;
   vendored like Three.js, single-file law intact.
2. brief "spring easings" vs law 2 "no overshoot" → springs at ≥ critical
   damping only (`houseSpring`).
3. terminal "prerendered product motion" vs single-file/no-video law → the
   live engine performs instead (a recording of the engine is a worse engine).
4. brief "modular import for load budget" vs single-file build → one shared
   inlined min bundle is the minimal payload form; documented in §5.
5. brief "signup handoff" vs product's optional-auth design → handoff =
   `enterStudio(path)` momentum; auth untouched.
