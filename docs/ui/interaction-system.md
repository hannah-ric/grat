# 3D interaction & motion system — "The Living Workshop"

The design for Blueprint Buddy's next tier of viewport interaction: physics
of motion, custom shaders, particles, dynamic lighting, camera behavior,
scroll choreography, direct manipulation, and immersive effects — each mapped
to the specific surface where it earns its keep, with the guardrails that
keep a *measuring instrument* usable while it performs.

Relationship to the rest of `docs/ui/`:
[`brand-system.md`](brand-system.md) owns color/type/space tokens;
[`semantic-skeleton.md`](semantic-skeleton.md) owns shell structure;
[`phase2-roadmap.md`](phase2-roadmap.md) owns the 2D-shell backlog (items 5
and 13 there are motion items — this document absorbs and extends them).
This document owns everything that moves, glows, or renders in 3D.

Non-negotiables inherited from `CLAUDE.md` and `DESIGN.md`: zero runtime
dependencies, one self-contained file, all assets procedural, the AI proposes
intent while **code owns every number**, reduced motion is a first-class
path, boot stays untouched, and the memory contracts (`stats()` stable
across rebuilds/theme flips) are load-bearing and smoke-tested.

---

## 0 · The laws (usability doctrine)

Every feature below is designed against these seven laws. A feature that
can't satisfy all seven doesn't ship, whatever it looks like in a demo reel.

1. **Motion is meaning.** Every animation encodes a state change the user
   caused or needs to notice (a part flying home, a drawer opening, a camera
   reframing). No idle loops — the sole exception is the joint-marker pulse,
   which is a *locator*, and even it stills under reduced motion
   (`engine.js` tick).
2. **One physics family.** All 3D motion integrates through the existing
   damped-lerp family — `k = 1 − e^(−c·dt)` with `c = 9` for values and
   `c = 7` for the camera (`src/engine.js:636-637`) — mirrored in CSS by the
   single `--ease: cubic-bezier(.22,1,.36,1)` (`src/styles.css:54`). New
   features pick a constant from this table; nobody invents a curve.
   Corollary: **critically damped is the brand.** Drafting instruments don't
   overshoot; furniture doesn't wobble. No bounce, no elastic easing,
   anywhere.
3. **Reduced motion is parity, not absence.** The engine's `k = 1` snap
   already makes every damped system instant with zero special cases
   (`heroAssemble` relies on exactly this, `src/engine.js:774-783`). Every
   feature below states its reduced-motion behavior; decorative systems
   (particles) turn *off*, functional ones (camera framing, scroll-follow)
   *snap*. A feature specified without this line does not ship.
4. **Input is sacred.** Never animate against an active pointer; never move
   the camera without user intent (exceptions, all bounded: initial frame,
   the one-shot hero, and cancellable playback drift, §4). Interruption is
   free in a damped system — retarget the goal, never lock out input.
5. **The scene is an instrument.** When the user is reading dimensions or an
   integrity verdict, the scene is calm: no ambient particles during work
   sessions, no lighting drift while dims are up, verdicts stay letterpress
   stamps (never fireworks). Showmanship is confined to moments the user
   isn't measuring: the hero, step completion, mode transitions.
6. **Zero per-frame allocation, bounded pools.** The tick loop allocates
   nothing today; new systems preallocate at `create()` (particle buffers,
   handle meshes, scratch vectors) so `engine.stats()` stays flat across
   rebuilds — extend the smoke assertion to cover them.
7. **Everything degrades.** Every effect ties into the existing single
   quality switch (`applyRender`, `src/ui.js:260-265` — the flat tier). Flat
   tier ⇒ no shadows, no textures, and now: no particles, no shader patches,
   no light choreography. WebGL loss or shader-compile failure falls back to
   today's behavior silently — decoration is never load-bearing.

## 1 · Inventory — what already exists

Extend, don't duplicate. The Phase 5 engine already covers a surprising
amount of the brief:

| Technique | Shipped today | Where |
| --- | --- | --- |
| 3D models | Parametric primitives on shared unit geometries (3 grain-axis boxes + cylinder), diff-based rebuild | `src/engine.js:136-157, 325-385` |
| Physics-based animation | One damped-lerp family: part pose/scale, drawer travel, staged explosion, camera; reduced-motion snap | `src/engine.js:632-668` |
| Procedural materials | Seeded per-species wood grain, PMREM studio environment per theme, ACES tone mapping | `src/materials.js`, `src/engine.js:119-130` |
| Dynamic lighting | Hemi + sun + fill, theme-driven table, shadow frustum fitted per model | `src/engine.js:59-94, 375-381` |
| Camera controls | Hand-rolled orbit/pan/pinch/wheel/keys, F/S/T/Iso presets, persp↔ortho on one rig, auto-frame | `src/engine.js:529-612, 729-734` |
| Object transformations | Explode slider (drawers stage first), drawer toggle, isolate, assembly playback with buckets | `src/engine.js:254-317, 504-527` |
| Immersive effects | Blueprint Mode (interactive technical drawing), one-shot hero assemble, ghost compare overlay, Joint Inspector with cutaway clipping plane | `src/engine.js:699-707, 775-783`, `src/jointview.js` |
| Smooth scrolling | Reduce-aware `scrollIntoView` in playback + chat log | `src/ui.js:1201`, `src/styles.css:261` |

Notably absent (and deliberately so, until this design): custom GLSL,
particles, velocity/inertia, direct manipulation in the viewport, and any
scroll-driven 3D. The vendored build is the **core** `three.min.js` (r152) —
no examples modules, so no `OrbitControls` and no `EffectComposer`; controls
stay hand-rolled and there is no post-processing stack to lean on. That
constraint shapes several verdicts below.

---

## 2 · 3D models — content strategy

The parametric model **is** the content. No fetched GLTF, ever — the
single-file law means every model is generated, which is also why thumbnails
and re-opens are deterministic (seeded grain, `src/materials.js:24-34`).

**Where models multiply impact** (mostly shipped, listed to aim new effort):

- **The piece itself** — hero surface; everything in §3–§9 serves it.
- **Gallery thumbnails** — real renders via the idle mini-engine pass,
  cached by content hash (`src/ui.js:1434-1458`). Done; don't touch boot.
- **Joint close-ups** — transient parametric scenes (`src/jointview.js`).
  Gets the cut-face shader in §5.
- **Hardware stratum** — metal renders in-scene but never enters the cut
  list (`src/hardware.js` LIVE stratum). Done.
- **Finish preview** (DESIGN.md Tier 1 roadmap) — a *material* upgrade, not
  geometry: reuse the pool with `MeshPhysicalMaterial` (in the core build)
  and 3–4 finish classes (raw / oil / film / paint) driving clearcoat,
  sheen, and roughness deltas per class. Pool key grows one bounded
  dimension (`material|role|bucket|textured|finishClass`). **Tier 2.**
- **Room-fit ghost box** (DESIGN.md Tier 3) — the alcove the piece must fit,
  rendered with the existing ghost bucket; clearance advisories from the
  ergonomics table. Immersion in *purpose*. **Tier 3.**

**Guardrail:** per-part detail geometry (real chamfers, roundovers) is
rejected — it would break the shared-unit-geometry memory contract
(`src/engine.js:2-11`). The edge-line overlay already sells "machined edge";
detail belongs in the Joint Inspector, which builds real geometry per open
and disposes per close.

## 3 · Physics-based animation

**Where:** everything that moves keeps riding the one damped family — this
section *adds* the two physical behaviors the family can't express (thrown
velocity, choreographed weight) without breaking law 2.

**3a · Velocity layer for user-thrown surfaces.**
Flick-to-orbit in the viewport, and the mobile chat sheet
(phase2-roadmap #5). Track pointer velocity over the last ~3 samples; on
release, feed a decaying velocity into the *goal*:
`goal += v·dt; v *= e^(−4·dt)` — the damped follower stays the only
integrator, so interruption, clamping (`phi` limits, `dist` 300–20000,
`src/engine.js:559, 600`), and reduced motion (zero `v`, snap) all inherit.
- **Why:** touch orbit currently dies the instant the finger lifts — a
  330 ms flick reads as "heavy tripod". Inertia is the single biggest
  perceived-quality win on phones.
- **Guardrails:** velocity caps (~2 rad/s), any `pointerdown` zeroes it,
  never applies to zoom (precision), never on the joint canvas (small
  scenes spin nauseatingly).
- **Reduced motion:** no inertia — release stops dead. **Tier 1.**

**3b · Choreographed weight in assembly.**
Multi-part playback steps currently launch every part simultaneously
(`playbackReplay`, `src/engine.js:516-527`). Stagger each part's departure
by 40–70 ms (index-ordered, code-owned constant) and let heavy parts (mass
already computed for the BOM) use `c = 7` instead of `c = 9` — a slab
settles a beat after a rail. Weight without a solver, determinism preserved.
- **Why:** the assembly playback is the teaching surface; sequencing is the
  content. Stagger *shows* order.
- **Reduced motion:** snap (stagger collapses with `k = 1`). **Tier 2.**

**3c · What "physics" explicitly is not here.**
No physics engine (cannon-es et al. — dependency law, and the golden corpus
demands determinism), no springs with overshoot (law 2), no gravity drops.
Assembly is *choreography*: the piece is proven by `Structural`, not by a
toy simulation — pretending otherwise would undercut the product's honesty.

## 4 · Camera — the usability multiplier

The camera is where interaction quality is *felt* most and where misuse
(uninvited movement) hurts most. All four additions ride `camGoal` on the
existing rig, so reduced-motion snapping and clamps are inherited.

**4a · Zoom-to-cursor** (wheel + pinch midpoint). Dolly toward the point
under the pointer instead of screen center: unproject the cursor ray, shift
`camTarget` toward its model-plane hit by `(1 − zoomFactor)`, clamp target
inside ~1.5× model bounds. Standard CAD affordance; pure math.
- **Why:** inspecting a stretcher joint on a 2 m bookshelf currently takes
  zoom + pan + zoom; this collapses it to two scrolls. **Tier 1.**

**4b · Focus framing on isolate.** Double-tap already isolates a part
(`src/ui.js:2141`); it should also *frame* it: `camTarget` → part centroid,
`dist` → fit part bounds ×1.25, storing one restore pose; leaving isolation
restores it. Add `F` (frame selected) beside the existing keys and document
it in the `?` popover (phase2-roadmap #8).
- **Why:** isolation without framing leaves a lone drawer side floating at
  whole-piece distance — the current half-experience.
- **Reduced motion:** snaps (free). **Tier 1.**

**4c · Playback camera drift.** On each step change, ease `camTarget` 35%
of the way toward the centroid of the incoming parts' joints and drift
`theta` ≤ 12° toward their visible side. Any pointer input cancels drift
for that step (law 4). Amplitude deliberately small: the workbench, not a
trailer.
- **Why:** step 7 of a cabinet build happens at the back panel; today the
  user manually chases every step. **Tier 2.**

**4d · Render-on-demand loop.** Not motion but the frame that pays for all
of it: every damped system converges, so when all `|cur − goal| < ε`, no
playback, and no pointer is down, stop the rAF loop and wake on any input /
retarget / resize. Laptop battery and phone thermals are usability.
- **Risk:** subtle — the joint pulse and any live particles keep it awake;
  gate wake sources through one `needsFrame()` predicate. **Tier 2.**

**Rejected:** autorotate/idle orbit (battery, motion sickness, law 1);
camera shake of any kind; FOV animation (dimension legibility — verticals
must stay trustworthy in a tool that prints measurements).

## 5 · Custom shaders — patches, not rewrites

The constraint box first, because shader sprawl is how render pipelines rot:
every custom effect is an `onBeforeCompile` patch on the standard/physical
materials already in the pool — never a bespoke `ShaderMaterial` for lit
geometry (it would fork the lighting/shadow/env pipeline the scene depends
on). Total custom GLSL budget across the app: **≤ ~120 lines**. Every patch
is behind the quality switch (flat tier compiles zero custom GLSL) and gets
a smoke screenshot.

**5a · Cut-face tint — Joint Inspector cutaway.** The cutaway clips with a
plane (`src/jointview.js:74, 189-196`) but clipped interiors render as the
same face color, so the section reads as hollow plastic. Patch the two
member materials: when `gl_FrontFacing` is false, darken ~0.62× and
desaturate slightly — instantly reads as cut lumber/end grain. ~8 lines.
- **Why here:** the Inspector is the teaching surface for joinery; the
  section cut is its whole point. Biggest visual payoff per line of GLSL in
  the app. **Tier 2** (with the Inspector already `DoubleSide`, it's small).

**5b · Selection rim (fresnel).** Replace the fixed emissive on the
`selected` bucket (`src/engine.js:195`, hardcoded `0x2f7fae`) with a
view-dependent rim: `emissive += edgeSel · pow(1 − N·V, 3)`. Reads on every
species in both themes (the flat emissive currently muddies dark walnut),
and fixes a latent gap: the rim color joins `applyInkColors()` so theme
switches recolor selection (today's emissive doesn't). ~10 lines, pooled
per existing keys + theme. **Tier 1.**

**5c · Ghost X-ray.** The compare overlay draws 30%-alpha standard
materials (`src/engine.js:387-406`) — overlapping ghost parts stack into
mud. Fresnel-weighted alpha (`0.08 + 0.35·rim`) keeps silhouettes while
interior faces fade; the "previous design" becomes a readable glass shell.
**Tier 3** (compare is a low-traffic surface).

**Rejected:** procedural GLSL wood (the canvas albedo at 256×512 with
anisotropy already reads correctly, is deterministic per species — a
thumbnail-cache feature — and costs zero shader budget); blueprint paper
grid as a shader (phase2-roadmap #12 does it in CSS on the transparent
canvas's backdrop — cheaper and theme-native); full-screen post effects
(no composer in the core build; see §9).

## 6 · Dynamic lighting

Lighting is already dynamic across themes (`THEMES` table,
`src/engine.js:59-70`); this section makes it *responsive* — always through
a damped `lightCur/lightGoal` table in the tick, never a second timing
system.

**6a · Selection spotlight.** On select/isolate, breathe `fill` down ~30%,
`hemi` ×0.9, `sun` ×1.06; restore on clear. The scene visibly "leans in"
while bucket-dimming (already shipped) does the object-level work.
- **Guardrail:** deltas ≤ 15% and scene-only — page/DOM contrast (WCAG
  audit in `brand-system.md`) is untouched. Skipped in Blueprint Mode,
  where materials are unlit `MeshBasic` by design (`src/engine.js:699-707`).
- **Reduced motion:** intensities snap (same family). **Tier 1.**

**6b · Theme cross-fade.** `setTheme` currently hard-cuts light colors and
intensities (`src/engine.js:689-698`). Route them through the damped table
(~400 ms perceptual ramp); the PMREM environment still swaps instantly —
regenerating intermediate PMREMs per frame is off the table (cost), and the
lights carry the perceived transition. **Tier 2.**

**6c · Hero sun sweep.** During the one-shot hero, start the sun's azimuth
−0.3 rad and let it damp home while parts fly in — shadows sweep across the
floor exactly once, in the one moment showmanship is licensed (law 5).
Reduced motion: hero already snaps; the sweep never happens. **Tier 3.**

**Rejected:** time-of-day cycles (idle animation, law 1); shadow-casting
point/spot lights (a second shadow pass on every frame for atmosphere the
PCFSoft sun + PMREM already provide); light flicker of any kind.

## 7 · Particle systems — two moments, one pool

Particles are the easiest way to ruin an instrument, so placement is
everything: **never ambient during work sessions** (law 5), never in
Blueprint Mode (a drawing has no dust), off in flat tier and reduced motion
(pure decoration → off, per law 3).

**Implementation (shared):** one `THREE.Points` per engine, preallocated at
`create()` — 256-particle `Float32` position/velocity/life buffers, one
shared 32×32 radial-alpha canvas sprite (the `blobCanvas` pattern,
`src/materials.js:173-184`), normal blending, alpha ≤ 0.35, `depthWrite`
off, `renderOrder` below annotations, `drawRange` = live count. Advanced in
the existing tick with code-owned gravity/drag constants; zero per-frame
allocation; `stats()` gains exactly +1 geometry +1 texture, fixed for the
engine's life.

**7a · Sawdust on step landing** (assembly playback + build mode). When a
step's parts fly home, emit 24–48 motes at that step's joint markers
(positions already computed — `showJoints`, `src/engine.js:493-502`),
drifting down with drag over ~1.2 s. It celebrates *placement* exactly
where the work happens, and doubles as a locator for the joint markers.
- **Why here:** build mode is the companion at the bench; step completion
  is its heartbeat. A 1.2 s transient rewards without wallpapering.
- **Trigger:** forward step advances only (`scrubPlayback`,
  `src/ui.js:1193-1202`); never on scrub-back. **Tier 2.**

**7b · Dust motes in the hero.** During the one-shot `heroAssemble`
(`src/ui.js:1394-1398` gates it to once, ever), ~100 slow motes drift
through the sun direction for the sweep's duration and fade with it —
"morning workshop" in the first ten seconds of first use, then never again.
**Tier 3.**

**Rejected:** confetti on PASS (verdicts are letterpress stamps with text —
`brand-system.md` — and structural truth is not a slot machine); ambient
motes during normal sessions; particle trails on drag.

## 8 · Smooth scrolling — and the anti-scrolljack law

Blueprint Buddy is a workspace, not a scrollytelling page. The law: **the
wheel belongs to the surface under the pointer** — zoom in the viewport
(shipped, `src/engine.js:598-601`), native scroll in panels (overscroll
containment shipped, phase-1 ledger). Document scroll is never hijacked,
smoothed globally, or re-eased. What remains is *linking* scroll to state,
in two places where it's honest:

**8a · Build-mode scroll-follow (discrete).** The inverse binding already
half-exists — step changes scroll the active card into view, reduce-aware
(`src/ui.js:1201`). Add the forward direction: an `IntersectionObserver` on
step cards (~0.6 threshold) drives `scrubPlayback(i)` as the list scrolls,
with a ~300 ms suppression window after programmatic scrolls to prevent
feedback loops. Crucially **discrete**: steps commit whole — never per-pixel
playback scrubbing, which reads as motion soup on a phone at the bench with
sawdust on the screen.
- **Reduced motion:** identical logic; the 3D transition snaps. **Tier 2.**

**8b · The front porch (future marketing surface).** DESIGN.md's "the app
is the site" stands; if a scroll-told landing page ever ships, this is the
one licensed scrub: a sticky viewport whose `explodeT` follows scroll
progress through a damped follower (`target = f(scrollProgress)`, current
damps at `c = 9` — never bind a transform to raw `scrollY`), narrating
intent → drafted → proven → built. Reduced motion: static exploded poster
frames per section. **Tier 3, gated on the front-porch concept** — that
concept is now designed: [`front-porch.md`](front-porch.md).

## 9 · Immersive effects & direct manipulation

**9a · Dimension drag handles — the flagship.** Today the viewport is an
*output*; the inspector sliders are the input. Put them together: selecting
the piece shows six face handles on the overall bounding box (shared cone
geometry, one pooled material, own raycast group checked before parts in
`pickAt`). Dragging a handle projects the pointer ray onto the face-normal
axis; the delta drives the **existing preview pipeline** — the same
`preview → commitPreview` path the inspector sliders use
(`src/ui.js:86-121`), so the whole model re-derives live and parts damp to
their new poses; release commits one history entry (`'viewport'` source).
The founding rule is preserved exactly: the drag proposes *intent* ("wider"),
`Spec.correctSpec` owns the number — clamps, increments, and structural
consequences included. A live dimension label rides the existing annotation
system during the drag.
- **Why:** this converts the 3D view from a picture into the primary
  instrument — the single highest-value interaction in this document, and
  it's mostly wiring: every hard part (preview, correction, history,
  damped retarget) already exists.
- **Guardrails:** handles only on the overall envelope (template params stay
  in the inspector — per-part handles wait for the novel grammar's editor);
  ≥ 40 px touch targets (roadmap standard); handles hide during explode,
  playback, and Blueprint Mode; `Escape` cancels a live drag and restores.
- **Reduced motion:** parts snap to each preview state. **Tier 2** (the
  headline of the tier).

**9b · Hover pre-highlight.** Pointer-move raycast (≤ 1/frame, rAF-gated,
`(hover: hover)` devices only) swaps the hovered part's *edge* material to
a mid-weight ink — no mesh-material churn, no pool growth — plus
`cursor: pointer`. Makes pickability legible before commitment. Off during
drags; during playback it targets the joint dots instead (9e). **Tier 1.**

**9e · Joint dots are doors.** In step playback the glowing joint markers
(`showJoints`, `src/engine.js`) become pickable: clicking one opens the
Joint Inspector on **that** joint's real members, captioned with the step
("Step 5 — Build the two side frames") and where the joint sits on the
piece ("front right, at mid-height", derived qualitatively from the joint's
position vs the model bounds). Hit-testing is screen-space against the
projected dot centers with a 28 px thumb-sized tolerance — the honest test
for markers that render depth-free — and the hovered dot swells past its
pulse so "this one opens" reads before the tap. The step list advertises
the affordance in its lede. This is the missing link between *watching* a
step and *knowing the cut*: what to do and exactly where, one tap from the
dot that marks the spot. **Shipped with Tier 1.**

**9c · Blueprint Mode ink-wash.** The mode toggle is a hard cut today
(`setDrafting`, `src/engine.js:701-707`). A 200–240 ms CSS ink-wash on the
viewport wrap (radial wipe in the draft ink color, `var(--ease)`,
`prefers-reduced-motion: none`) sells "flipping to the drawing" for zero
engine cost and no per-frame work. **Tier 1.**

**9d · AR handoff, surfaced.** The `.glb` exporter (`src/gltf.js`) is the
real immersive endgame — the piece standing in your actual room. Pair it
with the roadmap's QR share code so the path is: phone camera → model in
the alcove. No new 3D tech; product wiring. **Tier 2, mostly outside this
document's scope.**

**Rejected:** depth of field / bloom / SSAO / vignette post-processing — no
`EffectComposer` in the vendored core build, a full-frame copy tax on every
device, and defocus is hostile to a tool whose job is legible dimensions
(law 5). If a "beauty shot" mode is ever wanted, it's a one-off offline
render path on the thumbnail engine, not a live effect. Also rejected:
audio (uninvited sound in a shop), free-rotation gizmos on parts (placement
belongs to the parametric templates — rotating a leg is a lie the cut list
can't honor).

---

## 10 · Performance & memory budgets

| Budget | Ceiling | Enforced by |
| --- | --- | --- |
| Frame (mid-tier phone) | ≤ 8 ms JS+GPU steady-state | render-on-demand (§4d) makes steady-state ≈ 0 |
| Draw calls | today ≈ 2/part + fixed overhead; additions ≤ +8 total (particles 1, handles ≤ 6, rim/tint 0) | shared geometries; one `Points` |
| Per-frame allocation | 0 bytes in tick | law 6; hoist the pan handler's scratch `Vector3` (`src/engine.js:566`) while in there |
| Raycasts | ≤ 1/frame (hover), else on tap only | rAF gate |
| Custom GLSL | ≤ ~120 lines total | §5 constraint box |
| `stats()` | flat across rebuild/theme/quality; +1 geo +1 tex (particles), +1 geo (handles) fixed at create | smoke assertion extended |
| Pixel ratio | ≤ 2 (shipped, `src/engine.js:40`) | — |
| Payload | no new vendored code; every effect is authored source | single-file law; phase2-roadmap #11 still wants the *smaller* Three build |

Degrade ladder (one switch, in order): full → flat tier (no textures,
shadows, particles, GLSL patches, light choreography — `applyRender` stays
the single lever) → reduced motion (orthogonal: snaps functional motion,
kills decorative motion) → WebGL failure (existing fallbacks; nothing in
this document is load-bearing).

## 11 · Adoption plan

Tiers are ordered by (user value × confidence) / effort, sized to ship each
as one reviewable change with its tests.

| Tier | Items | Effort | Test obligations |
| --- | --- | --- | --- |
| **1 — feel** | zoom-to-cursor (4a) · focus framing + `F` (4b) · flick inertia (3a) + sheet gesture (roadmap #5) · hover pre-highlight (9b) · selection rim (5b) · selection spotlight (6a) · blueprint ink-wash (9c) · motion micro-polish (roadmap #13) | S–M each | smoke: reduced-motion snap per feature, `stats()` flat, hover has no touch path; selftest: shader patch renders |
| **2 — instrument** | dimension handles (9a) · render-on-demand (4d) · playback stagger (3b) + camera drift (4c) · scroll-follow build mode (8a) · sawdust on landing (7a) · cut-face tint (5a) · theme light cross-fade (6b) · finish preview (§2) | M–L | smoke: drag→`commitPreview`→one history entry, Escape restores, observer feedback-loop guard; goldens untouched (display-only); handles absent in playback/Blueprint |
| **3 — theater** | hero motes (7b) + sun sweep (6c) · ghost X-ray (5c) · room-fit ghosts (§2) · front-porch scroll story (8b) | M each | hero still one-shot & boot-untouched; front porch gated on DESIGN.md concept |

Sequencing note: Tier 1 is deliberately all-feel/no-schema — zero spec,
golden, or physics surface. The first Tier 2 item to build is
render-on-demand (4d), because every later effect then pays its frame cost
only while actually animating.

### Status ledger (July 2026 — first implementation pass)

Shipped, smoke-asserted (189 assertions, zero console errors, `stats()`
still flat): zoom-to-cursor 4a · focus framing + `F` 4b · flick inertia 3a
(viewport) + the mobile sheet gesture (roadmap #5) · hover pre-highlight
9b · selection fresnel rim 5b (which also fixed the stale-on-theme-switch
selection emissive; joint dots and hover ink joined `applyInkColors`) ·
selection spotlight 6a · blueprint ink-wash 9c (canvas `filter` keyframe —
overlay-free, so it can never cover controls) · motion micro-polish
(roadmap #13: welcome-card stagger, splitter-grip grab) · playback stagger
3b (pulled forward from Tier 2) · **9e joint-dot close-ups** · the law-6
scratch-vector cleanup. New engine API: `focusPart`, `clearFocus`,
`jointDotsOnScreen`, and an `onJointPick` callback.

Still open, in build order: render-on-demand 4d → dimension handles 9a →
scroll-follow 8a → sawdust 7a → cut-face tint 5a → playback drift 4c →
theme light cross-fade 6b → finish preview (§2) — then Tier 3.

## Explicitly rejected (kept here so it isn't re-litigated)

- **A physics engine** — dependency law; determinism (golden corpus) over
  emergence; structural truth already has an engine (`src/structural.js`).
- **Post-processing stack** (DoF, bloom, SSAO) — not in the core build;
  full-frame tax; anti-legibility.
- **Overshoot/elastic easing** — critically damped is the brand (law 2).
- **Scroll hijacking, global smooth-scroll, per-pixel playback scrubbing** —
  law: the wheel belongs to the surface under the pointer.
- **Autorotate / idle camera drift / time-of-day lighting** — motion is
  meaning (law 1); battery.
- **Confetti or celebration effects on verdicts** — stamps with text, never
  theater on structural claims.
- **Per-part detail geometry** (chamfers/roundovers) — breaks the
  shared-geometry memory contract; detail lives in the Joint Inspector.
- **Free rotation/translation gizmos on parts** — the parametric templates
  own placement; a hand-rotated part would divorce the scene from the cut
  list.
- **Audio** — uninvited sound in a workshop tool.
- **Procedural GLSL wood** — the seeded canvas albedo is cheaper,
  deterministic, and already reads true per species.
