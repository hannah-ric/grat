# Blueprint Buddy

AI-guided furniture design studio and complete workshop companion. Describe a piece of furniture in plain language — or drop in a photo of one — and get a professional-grade woodworking plan: an interactive 3D preview, a structural integrity report grounded in real materials science, a cut list with joinery allowances, a stock-purchase plan with per-board cutting diagrams, step-by-step assembly with 3D playback, and a full-screen build mode for the shop.

The app ships as a single self-contained file (`dist/index.html`, built from `src/` by `node build.js`) with fonts and Three.js embedded — suitable for publishing as a Claude Artifact. `blueprint-buddy.jsx` is the earlier React-artifact incarnation of the same product (Phase 3).

## Architecture

The founding rule, unchanged since Phase 1: **the AI proposes intent; code owns every number.**

1. **AI layer (intent only)** — chat rides a token-optimized wire codec: single-letter keys, dimensions as arrays, enums as small integers, novel-piece primitives as flat arrays. The compact schema is documented once, statically, in the system prompt; refinements are partial-merge wire diffs; the last 6 turns travel verbatim and everything older is replaced by a code-built digest assembled from the diff chips the app already computes. Replies are capped at 1000 tokens with a continuation protocol (`stop_reason === "max_tokens"` → "continue exactly where you stopped", max 2 continuations) — truncation is continuable, never a validation failure. Photos are downscaled client-side (1024 px long edge, JPEG 0.8) before anything reaches the API. Offline, a built-in intent parser keeps the app fully functional.
2. **Parametric layer (geometry authority)** — code-owned templates (table, desk, bench, bookshelf, nightstand, cabinet — with drawer banks sized entirely by code) plus a novel-piece grammar: primitives (`post`, `rail`, `panel`, `slab`, `cylinder`) with positions, rotations, and an explicit connection graph, auto-grounded and centered by correction.
3. **Structural engine (physics judge)** — Wood Handbook material data drives exact beam math (MOE → sag, MOR → strength at safety factor 4, SG → tipping and joint capacity, Janka → surface duty only). Whole-piece checks: tipping (empty and loaded), transparent racking score, leg slenderness, joint adequacy, and — new in Phase 4 — seasonal wood movement (`width × coefficient × ΔMC`, tangential/radial coefficients per species, climate-adjustable ΔMC, plywood exempt with the reason stated). Novel compositions get connectivity, support-polygon, load-path, collision, and buildability guarantees, plus an automatic propose–validate–revise loop.
4. **Derived layer (pure functions of the corrected spec)** — cut list, BOM, assembly steps, CSV/SketchUp/COLLADA exports, print sheet, and the Phase 4 **stock optimizer**: first-fit-decreasing 1D packing onto buyable dimensional lumber (3 mm kerf, 15 mm end trim, glue-up and lamination planning) and guillotine 2D packing onto 1220×2440 sheets honoring grain direction, rendered as drafting-styled SVG cutting diagrams with hatched offcuts. The BOM prices actual purchasable units from a user-editable, persisted price table, reports waste percentage, and keeps board-foot math as a reference line.
5. **Display boundary (`BB.Units`)** — internal math is always millimetres and SI; conversion to display text happens in exactly one module, at render time, so rounding never feeds back into geometry or physics. Imperial semantics: reduced fractional inches (user-set precision, 1/16 default) for cut and overall dimensions, decimal inches for fine values (sag, movement, kerf, reveals, clearances), feet for stock board lengths, trade-name-first nominal lumber (`1x4 x 8 ft (3/4 x 3 1/2 in)`), lb and lb/ft loads — metric mode mirrors all of it, board feet stays the trade unit in both systems, angles stay degrees, and an optional dual display shows both. One forgiving parser accepts `29 1/2`, `29.5"`, `2' 5"`, `750mm`, and `75cm` anywhere a dimension is typed, and chat input is pre-normalized to explicit millimetres so the model never converts units. Imperial is the default for fresh installs only; preferences (schema v2) migrate without changing a returning user's metric choice. The SketchUp exports are the deliberate exemption: they carry real millimetre geometry regardless of display mode.

## Phase 4 features

- **Design persistence** — every spec carries `specVersion` and loads through a migration registry (a saved design must never fail to open; a v3 fixture proves the pattern). Projects autosave debounced to `window.storage` (index + per-project keys, last 20 revisions, build progress, ~128 px JPEG thumbnails under 15 KB); storage failure degrades silently to a fully working session-only app. My Projects gallery: open, rename, duplicate, delete.
- **Share codes** — any design exports as a compact copyable code (`BB4:` + base64url wire JSON); import validates, migrates, and revalidates.
- **Build mode** — a full-screen shop companion: oversized type, giant touch targets, cut checklist grouped board-by-board straight from the optimizer diagrams, assembly checklist, per-project persisted progress, full-screen step-synced 3D playback, and `navigator.wakeLock` with a silent fallback.
- **Photo-to-design** — upload a furniture photo; the model estimates type and proportions anchored to ergonomic standards and returns a wire spec that flows through the normal correction/integrity pipeline, presented with an estimation caveat.
- **Self-test harness** — long-press the logo for a hidden diagnostics panel that runs the in-app assertion suite (unit round-trips, joinery allowances, beam math within 1% of hand calculation, packing invariants, codec `decode(encode(x))` deep-equality, migration, movement/tipping/racking against fixed values, continuation protocol) with green/red and actual-versus-expected. It stays in the product as a permanent regression net.
- **Number provenance** — tap any dimension in the cut list or part inspector to see the formula that produced it, with live inputs. Code shows its work.
- **Species comparison** — up to three species recomputed side by side (purchasable cost, weight, sag margin, movement, Janka duty) as pure-function reruns; tap a column to apply.

## Development

```
npm run dev              # build, serve on http://localhost:3000, watch-rebuild, /api/chat proxy
node build.js            # inline everything into dist/index.html
npm test                 # headless unit tests (node test/unit.test.js)
npm run test:smoke       # build + drive the real app in headless Chromium
```

## Deploy: Vercel & v0

The repo is pre-configured for Vercel (and for import into [v0](https://v0.app)
via **Import from GitHub**): `vercel.json` pins the framework preset (**Other**),
install command (`npm install --ignore-scripts`), build command (`node build.js`),
and output directory (`dist`), and `api/chat.js` is a serverless proxy that keeps
`ANTHROPIC_API_KEY` server-side so AI chat and photo-to-design work when hosted
outside claude.ai. Without a key the app degrades to its built-in offline parser.
Setup steps, environment variables, and v0 caveats: **[DEPLOYMENT.md](DEPLOYMENT.md)**.
