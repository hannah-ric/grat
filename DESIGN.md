# Blueprint Buddy — Phase 5: "The Craftsman's Studio"

The creative direction and product blueprint behind the Phase 5 work. The
founding rule is unchanged and non-negotiable: **the AI proposes intent; code
owns every number** — and the zero-dependency, single-file architecture stays.

## Positioning

**Audience:** hobby woodworkers, weekend makers, and beginners graduating from
YouTube — a garage shop, a miter saw, Saturday afternoons. They don't want CAD
(SketchUp/Fusion is too much) and they don't want someone else's static PDF
plan (it's not *theirs*). They want their piece, proven safe, with a shopping
list and a build path.

**Positioning statement:** *"Describe it. We'll draft it."* — the only tool
that goes from a sentence (or a photo) to a structurally-proven, shop-ready
plan: 3D preview, integrity report, cut list, cutting diagrams, and a
build-day companion. Competitors do one slice (CutList Optimizer = packing
only; SketchUp = geometry only; printed plans = no parametrics). The moat is
the *pipeline*, and the design language dramatizes it: **intent → drafted →
proven → built**.

**Brand narrative:** a drafting table with a master craftsman behind it.
Every visual choice reinforces "numbers you can trust": provenance taps,
precise PASS/ADVISORY/FAIL verdict capsules, drafting-styled diagrams — and
now the product *looks* like the blueprint it produces.

## Visual direction — evolve, don't replace

> **Superseded note (July 2026):** the palette described below (warm oat +
> machinist blue) predates the brand token system in
> [`docs/ui/brand-system.md`](docs/ui/brand-system.md) — "Showroom": five
> mid-century brand constants, `light-dark()` scheme, fluid `clamp()` type.
> The structural ideas in this section stand; when tokens swap, everything
> below inherits Showroom automatically because it rides `var()` and
> `currentColor`. Blueprint Mode's cyanotype ink is the one candidate for a
> deliberate blue exception — a blueprint is blue; decide there.

The token system (warm oat + machinist blue, Fraunces display serif with Hanken
Grotesk body and IBM Plex Mono numbers, 8pt scale, one easing family) is kept.
Phase 5 added, in order of leverage:

1. **The model as hero** — procedural per-species wood grain, ACES tone
   mapping, a procedural studio environment, soft grounded shadows. Species
   read as themselves; the piece reads as furniture, not toy CAD. A
   "Wood/Flat" quality tier keeps low-power devices smooth.
2. **Blueprint Mode** — the signature feature: one toggle flips the viewport
   to an orthographic technical drawing (paper fills, machinist-blue ink,
   blueprint-grid field, dimensions on). Light theme is ink-on-paper; dark is
   true cyanotype. F/S/T/Iso preset views ride the same damped camera.
3. **A real icon set** (`src/icons.js`) — one drafting-instrument style,
   20-grid, 1.7px stroke, `currentColor`; replaced every platform-dependent
   Unicode glyph in the chrome.
4. **Real thumbnails** — starter cards render their actual models via an
   idle-time offscreen engine pass (cached by content hash); the emoji era is
   over.
5. **The hero moment** — the first starter a fresh install picks assembles
   itself once: parts fly home from their exploded poses while the camera
   sweeps in. Reduced motion snaps; it never plays twice.

## Motion language

One damped-lerp family (`1 − e^(−9·dt)`) drives everything: part poses,
drawer travel, explosion, camera, hero, joint inspector. One easing family in
CSS. Reduced motion collapses every animation to a snap, in both worlds.

## What shipped in Phase 5

- **Render upgrade** — procedural grain (seeded, wrap-safe, recipes in
  `WOOD_SPECIES`), PMREM environment per theme, PCFSoft sun shadow fitted to
  the exploded pose, grain-axis UV variants on shared unit boxes, theme-aware
  scene ink/labels/lights.
- **Blueprint Mode + drawings** — ortho camera + view presets, drafting
  render mode, dimensioned elevation SVGs (painter's-order projections,
  OBB-hull silhouettes for rotated parts, architectural tick dimensions,
  drawer-opening callouts), a one-page drawing sheet with title block on the
  print sheet and as an `.svg` export.
- **Joint Inspector** — all 8 joint types as parametric 3D close-ups sized
  from the real members (tenon = ⅓ stock, dado = ⅓ housing, dovetails at 1:8
  with a ⅓ lap), apart/together slider, cutaway section, sizing rules through
  the display boundary. Entry points: assembly steps (real parts) and the
  Shop Reference (typical members — learn any joint before using it).
- **Shop truth** — CSV cut list (display units + raw mm), consolidated tool
  wall derived from the joints/operations actually in the plan, honest
  bench-time estimates (per-operation minutes × counts × skill pace, finish
  wall-time reported separately).
- **Modern export** — hand-written `.glb` (dedup'd geometry, PBR materials,
  rotation quaternions) for AR handoff; rotation bug fixed in the COLLADA and
  SketchUp exporters (previously translation-only).

## Commercial posture (decided trade-offs, July 2026)

- **The plan-tab wall is soft, and that is accepted.** The whole pipeline is
  client-side by design, so every locked number exists in browser memory; the
  preview lock keeps them out of the DOM but a determined devtools user can
  read them. The defensible product is the **server-issued artifact** — the
  stamped, versioned sheet set and 1:1 templates, refund-backed issuance, free
  re-downloads, the refinement window — not the secrecy of the numbers. A
  server-rendered viewer for the free tier would contradict the offline-first
  architecture and is deliberately not on the roadmap. Frame the wall in copy
  as "the blueprint is issued with the credit", not "the numbers are hidden".
- **"Unlimited refinement for 30 days" is per design id, not per piece.** A
  committed table can legally morph into a bench on one credit inside the
  window. No threshold logic ships (the brief's rule); instead every
  piece-type hop is recorded on the design record (`morphs`) and logged
  (`window_morph`), so the first pricing revisit is decided on data.
- **The signup credit is per OAuth identity, damped per IP.** Fresh-account
  grants are capped per client IP per rolling window (`SIGNUP_IP_CAP` /
  `SIGNUP_IP_WINDOW_DAYS` in `api/_credits.js`); the denial lands on the
  account's ledger, and a capped account still works and can buy packs.

## Roadmap (designed, not yet built)

**Tier 1 — shop truth continued:** ~~stretchers as a first-class template
bracing option; doors + hinges for cabinets (overlay/inset, euro vs butt;
BOM + racking credit)~~ **shipped (2026-07)** — `structure.stretchers`,
cabinet `doors` + LIVE `HNG` hinge styles, hang steps, racking credit;
finish preview on the 3D material still open.

**Tier 3 — untapped use cases** (each needs its own design pass):
- **Scrap-first design ("shop the offcuts")** — invert the optimizer: enter
  boards you own; the app constrains and suggests designs that fit.
- **Room-fit** — alcove/wall dimensions ghost-boxed around the piece;
  clearance advisories from the ergonomics table.
- **Project journal** — per-step photo notes in build mode; a shareable
  canvas-rendered "maker's card" for the finished piece.
- **QR share codes** — render the existing `BB4:` code as a QR for
  shop-to-phone handoff (zero-dep generator).

**Tier 4 — learning layer:** a "first build" guided path; joint how-to
walkthroughs woven deeper into the Inspector; glossary links from advisories
into the Shop Reference.

## The front porch (website concept)

The app *is* the site. The first-visit gallery is the marketing: real
rendered thumbnails, the hero assemble moment, and the pipeline dramatized in
one shot. Returning users land in the studio with their latest project — the
front porch never gets in a regular's way.

> **Designed (July 2026):** the full landing concept — the Materialization
> overture and the scroll-told porch — is specified in
> [`docs/ui/front-porch.md`](docs/ui/front-porch.md).

## Optimization doctrine

- Single-file constraint: every texture, environment, and drawing is
  generated procedurally at runtime — zero fetched assets, zero new
  dependencies. Phase 5 grew `dist/index.html` ~80 KB on 1.15 MB.
- Memory contracts are load-bearing and tested: shared unit geometries
  (now per grain axis), bounded material pools, one texture per species for
  the app's lifetime, dispose-on-teardown everywhere, `stats()` asserted
  stable across rebuilds/theme flips/quality toggles in the smoke suite.
- Boot stays untouched: thumbnails and the hero ride idle time and first
  interaction; failures degrade to the previous behavior silently.
- Reduced motion is a first-class path through every new feature.
