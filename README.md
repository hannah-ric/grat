# Blueprint Buddy

AI-guided furniture design studio and complete workshop companion. Describe a piece of furniture in plain language — or drop in a photo of one — and get a professional-grade woodworking plan: an interactive 3D preview, a structural integrity report grounded in real materials science, a cut list with joinery allowances, a stock-purchase plan with per-board cutting diagrams, step-by-step assembly with 3D playback, and a full-screen build mode for the shop.

The app ships as a single self-contained file (`dist/index.html`, built from `src/` by `node build.js`) with fonts and Three.js embedded — suitable for publishing as a Claude Artifact. `blueprint-buddy.jsx` is the earlier React-artifact incarnation of the same product (Phase 3).

## Architecture

The founding rule, unchanged since Phase 1: **the AI proposes intent; code owns every number.**

1. **AI layer (intent only)** — chat rides a token-optimized wire codec: single-letter keys, dimensions as arrays, enums as small integers, novel-piece primitives as flat arrays. The compact schema is documented once, statically, in the system prompt; refinements are partial-merge wire diffs; the last 6 turns travel verbatim and everything older is replaced by a code-built digest assembled from the diff chips the app already computes. Replies are capped at 1000 tokens with a continuation protocol (`stop_reason === "max_tokens"` → "continue exactly where you stopped", max 2 continuations) — truncation is continuable, never a validation failure. Photos are downscaled client-side (1024 px long edge, JPEG 0.8) before anything reaches the API. Offline, a built-in intent parser keeps the app fully functional.
2. **Parametric layer (geometry authority)** — code-owned templates (table, desk, bench, bookshelf, nightstand, cabinet — with drawer banks sized entirely by code) plus a novel-piece grammar: primitives (`post`, `rail`, `panel`, `slab`, `cylinder`) with positions, rotations, and an explicit connection graph, auto-grounded and centered by correction.
3. **Structural engine (physics judge)** — Wood Handbook material data drives exact beam math (MOE → sag, MOR → strength at safety factor 4, SG → tipping and joint capacity, Janka → surface duty only), hand-verified to the digit against the worksheet in `test/handcalc.js`. Load presets carry their published basis (BIFMA X5.4/X5.5/X5.9); sustained loads include the ×2 creep factor (Wood Handbook ch. 4); table-like pieces are judged as frames (apron beams + top strip between aprons + overhang cantilever), not as a lone top. Whole-piece checks: tipping empty/loaded **and with every drawer open** (moment balance aligned with ASTM F2057 / STURDY — failures make the wall anchor a mandatory BOM line), transparent racking score, leg slenderness, joint adequacy (end-grain screw connections derated ×0.67), drawer-slide capacity vs rating, and seasonal wood movement (`width × coefficient × ΔMC`, attachment-aware: floated tops pass with their figure-8s, plywood-captured solid panels get the elongate-the-holes advisory, plywood exempt with the reason stated). The design-value basis — small-clear specimen means, what the safety factor absorbs, the clear-stock rule — is disclosed in the integrity footer and on the print sheet. Novel compositions get connectivity, support-polygon, load-path, collision, and buildability guarantees, plus an automatic propose–validate–revise loop. Upstream of all of it sits the **geometric buildability audit** (Phase 5): every design — template or novel, from chat, photo, share code, or slider — must clear hard model invariants before it can be adopted: nothing below the floor or hovering above it, nothing outside the declared envelope, no overlap between unjointed parts, every declared joint physically touching, one connected structure, and a floor footprint the center of gravity actually sits inside. Validation failures feed back to the model verbatim for up to three refinement rounds; a design that still fails is never presented — the last valid design stays. Near-square part rotations (≤ 2.5° off axis) are snapped by correction, so sloppy proposals can't produce accidental diagonals.
4. **Derived layer (pure functions of the corrected spec)** — cut list with thickness-aware joinery allowances (a blind tenon can never be longer than its mortised member allows; housings obey the 1/3-depth rule) and clear-stock notes on load-bearing parts; the **fastener/joinery-setout engine** (`src/fasteners.js`): per-joint screw/dowel positions inside edge-distance and spacing rules, pilot diameters, tenon setout snapped to chisel sizes, dovetail laps — surfaced in the assembly steps, a print-sheet "Joinery detail" table, and BOM counts that always match the drilling instructions; assembly steps with milling sequence when rough stock is selected, grit-ladder sanding, a per-finish coat schedule (with the oily-rag fire warning), and proportionate shop-safety notes; a consolidated **tool wall and honest shop-time estimate** (per-operation minutes × counts × skill pace, finish wall-time reported separately); **dimensioned elevation drawings** (painter's-order projections with architectural tick dimensions) on screen, on the print sheet, and as an `.svg` export; CSV cut list (display units + raw mm); SketchUp/COLLADA/**glTF (.glb)** exports carrying full part rotations and true cylinders — the .glb ready for AR handoff; and the **stock optimizer**: first-fit-decreasing 1D packing onto buyable dimensional lumber (3 mm kerf, 15 mm end trim, glue-up and lamination planning) and guillotine 2D packing onto 1220×2440 sheets honoring grain direction, rendered as drafting-styled SVG cutting diagrams with hatched offcuts. The BOM prices actual purchasable units from a user-editable, persisted price table, reports waste percentage, and keeps board-foot math as a reference line.
5. **Display boundary (`BB.Units`)** — internal math is always millimetres and SI; conversion to display text happens in exactly one module, at render time, so rounding never feeds back into geometry or physics. Imperial semantics: reduced fractional inches (user-set precision, 1/16 default) for cut and overall dimensions, decimal inches for fine values (sag, movement, kerf, reveals, clearances), feet for stock board lengths, trade-name-first nominal lumber (`1x4 x 8 ft (3/4 x 3 1/2 in)`), lb and lb/ft loads — metric mode mirrors all of it, board feet stays the trade unit in both systems, angles stay degrees, and an optional dual display shows both. One forgiving parser accepts `29 1/2`, `29.5"`, `2' 5"`, `750mm`, and `75cm` anywhere a dimension is typed, and chat input is pre-normalized to explicit millimetres so the model never converts units. Imperial is the default for fresh installs only; preferences (schema v2) migrate without changing a returning user's metric choice. The SketchUp exports are the deliberate exemption: they carry real millimetre geometry regardless of display mode.

## Phase 4 features

- **Design persistence** — every spec carries `specVersion` and loads through a migration registry (a saved design must never fail to open; a v3 fixture proves the pattern). Projects autosave debounced to `window.storage` (index + per-project keys, last 20 revisions, build progress, ~128 px JPEG thumbnails under 15 KB); storage failure degrades silently to a fully working session-only app. My Projects gallery: open, rename, duplicate, delete.
- **Share codes** — any design exports as a compact copyable code (`BB4:` + base64url wire JSON); import validates, migrates, and revalidates.
- **Build mode** — a full-screen shop companion: oversized type, giant touch targets, cut checklist grouped board-by-board straight from the optimizer diagrams, assembly checklist, per-project persisted progress, full-screen step-synced 3D playback, and `navigator.wakeLock` with a silent fallback.
- **Photo-to-design** — upload a furniture photo; the model estimates type and proportions anchored to ergonomic standards and returns a wire spec that flows through the normal correction/integrity pipeline, presented with an estimation caveat.
- **Self-test harness** — long-press the logo for a hidden diagnostics panel that runs the in-app assertion suite (unit round-trips, joinery allowances, beam math within 1% of hand calculation, packing invariants, codec `decode(encode(x))` deep-equality, migration, movement/tipping/racking against fixed values, continuation protocol) with green/red and actual-versus-expected. It stays in the product as a permanent regression net.
- **Number provenance** — tap any dimension in the cut list or part inspector to see the formula that produced it, with live inputs. Code shows its work.
- **Species comparison** — up to three species recomputed side by side (purchasable cost, weight, sag margin, movement, Janka duty) as pure-function reruns; tap a column to apply.

## Phase 5 features — "The Craftsman's Studio"

Creative direction and roadmap: **[DESIGN.md](DESIGN.md)**.

- **Rendered wood** — procedural per-species grain textures (seeded, painted
  on canvas at runtime — still zero assets), ACES tone mapping, a procedural
  studio environment, and soft grounded shadows that track parts through
  explode and playback. Grain follows each part's long axis on shared unit
  geometry. A "Wood / Flat" quality toggle persists in prefs; the whole scene
  follows light/dark/auto themes.
- **Blueprint Mode** — one toggle flips the viewport to an orthographic
  technical drawing: paper fills, machinist-blue ink lines, a blueprint-grid
  field (cyanotype in dark mode), dimensions on, with Front/Side/Top/Iso
  preset views. The print sheet gains true dimensioned elevations, and a
  one-page **drawing sheet (.svg)** with title block exports from the menu.
- **Joint Inspector** — tap "Inspect joint in 3D" on any assembly step (or
  the 3D demo on any Shop Reference joinery row) for a parametric close-up
  built from the real member dimensions: pull it apart along the insert axis,
  section it with a cutaway plane, read the sizing rules (tenon = ⅓ stock,
  dado = ⅓ housing, dovetails at 1:8 with a ⅓ lap).
- **Shop truth** — a consolidated tool wall derived from the joints and
  operations actually in the plan; an honest bench-time estimate
  (per-operation minutes × counts × skill pace, finish cure time separate);
  CSV cut-list export with display units and raw millimetres side by side.
- **glTF / AR** — hand-written `.glb` export (deduplicated geometry, PBR
  materials, exact rotations); Android opens it in AR natively. Part rotation
  now also carries into the COLLADA and SketchUp exports.
- **The front porch** — starter cards render real 3D thumbnails of their
  models (cached, off the boot path), and the first starter a fresh install
  picks assembles itself once in a hero moment. A drafting-instrument SVG
  icon set replaces the old platform-dependent glyphs.

## Development

```
npm run dev              # build, serve on http://localhost:3000, watch-rebuild, /api/chat proxy
node build.js            # inline everything into dist/index.html
npm test                 # unit + audit-regression + golden-corpus suites (node, no browser)
npm run test:smoke       # build + drive the real app in headless Chromium
npm run test:handcalc    # hand-arithmetic vs engine verification worksheet
npm run test:battery     # live behavior battery (boundary/contradictory/adversarial fixtures)
```

The 2026 engineering-truth audit (findings register, hand-verification
worksheet, published-plan benchmark, golden-corpus manifest) lives in
[`docs/audit/`](docs/audit/00-final-report.md). Six reference designs are
frozen in `test/golden/`; behavior changes diff against them instead of
re-litigating correctness.

## Deploy: Vercel & v0

The repo is pre-configured for Vercel (and for import into [v0](https://v0.app)
via **Import from GitHub**): `vercel.json` pins the framework preset (**Other**),
install command (`npm install --ignore-scripts`), build command (`node build.js`),
and output directory (`dist`), and `api/chat.js` is a serverless proxy that keeps
`ANTHROPIC_API_KEY` server-side so AI chat and photo-to-design work when hosted
outside claude.ai. Without a key the app degrades to its built-in offline parser.
Setup steps, environment variables, and v0 caveats: **[DEPLOYMENT.md](DEPLOYMENT.md)**.
