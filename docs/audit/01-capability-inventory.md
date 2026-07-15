# Blueprint Buddy — Capability Inventory (Phase 1, as discovered)

Audit date: 2026-07-14. Source of truth: code at commit `22c88e4`. Design docs
(README.md, AGENTS.md) treated as hypotheses.

## Modules, responsibilities, consumers

| Module (src/) | Lines | Responsibility | Consumers |
|---|---|---|---|
| `knowledge.js` | 329 | Code-owned constant tables: 9 wood species (Wood Handbook 12% MC values: MOE, MOR, SG, Janka, ct/cr), ergonomics rows, joinery matrix + level gating, fasteners/finishes catalogs, buyable-lumber catalog (nominals, stock lengths, kerf, trim, sheets), default prices, climate ΔMC presets, `movementMM`, AI digest builder | spec, parametric, structural, plans, packing, ai (digest), ui (reference tab), provenance |
| `geometry.js` | 134 | Pure geometry: rotation matrices (XYZ order matching three.js `'ZYX'` set), OBB corners, SAT penetration, 2D convex hull, point-in-polygon distance, saw angles from rotations, world extents | spec (audit, correction), structural (COG/footprint/surfaces), plans (angle notes), ui |
| `units.js` | 278 | THE display boundary: mm→text formatters (fractional in, decimal in for fine values, ft, nominals, lb, lb/ft, bd ft, sag rates), `{N}` template renderer, slider domains, forgiving length parser, chat pre-normalizer to mm | everything that renders text; ai (pre-normalization) |
| `spec.js` | 650 | DesignSpec schema v4 + migration registry, defaults per template, deepMerge/diff/describe, `correctSpec` (clamps, stock snapping, joint level-gating, drawer/shelf auto-reduction, custom grammar sanitization + grounding/centering + rotation snapping), geometric buildability audit (floor, envelope, overlap, joint contact, footprint/COG), `validate` (errors + advisories) | ui (every commit), ai (apply), history, selftest |
| `parametric.js` | 466 | Corrected spec → model {parts, joints, openings, drawers, bounds}. Templates: tableLike (table/desk/bench), bookshelf, nightstand, cabinet; shared drawer-bank math; custom-composition projection. Probes for correction (`openingHeightFor`, `shelfSpacingFor`) | ui, selftest, structural (via model), plans, exports |
| `structural.js` | 667 | Physics judge: per-surface beam checks (sag via MOE, strength via MOR/SF4), load presets, tipping (COG, empty+loaded), racking heuristic, leg slenderness, joint adequacy (SG-scaled capN), seasonal movement, custom hard guarantees (connectivity, stand, load paths, collisions, buildability angles), fix patches, integrity diff chips | ui (integrity tab, chips), plans (bom antiTip), compare |
| `plans.js` | 326 | Derived layer: cut list (L≥W≥T + joinery allowances), BOM (stock-plan-priced or fallback estimate; fasteners from joints; hardware; anti-tip; finish), assembly steps per template + drawer sub-sequence, build-checklist keys + progress pruning | ui, exports (print), selftest |
| `packing.js` | 364 | Stock optimizer: section selection (direct/glue-up/laminate), 1D FFD onto stock lengths (3 kerf/15 trim), 2D guillotine FFD onto 1220×2440 honoring grain, pricing from price table, waste %, SVG cutting diagrams | ui (stock tab, build mode), plans (bom), exports (print) |
| `codec.js` | 272 | Wire codec: enum tables (order = wire contract), encode/decode (exact inverses), partial decode for refinement diffs, share codes `BB4:`+base64url, token estimator, static SCHEMA_DOC, history digest builder | ai, ui (share, autosave wire), store |
| `ai.js` | 492 | Intent layer: system prompt (schema doc + level matrix + knowledge digest + wire spec), JSON extraction/truncation detection, classify (new/diff/question), local offline parser, transports (injected/proxy/direct/window.claude), continuation protocol (max 2), context budget (6 verbatim + digest), critique builder, photo downscale, `apply` | ui |
| `engine.js` | 553 | Three.js renderer: shared unit geometries, bounded material pool, damped-lerp motion, explode/drawer/playback states, camera, picking, dimension annotations, thumbnails | ui |
| `exports.js` | 273 | COLLADA .dae (Z-up, mm), SketchUp Ruby .rb (ComponentDefinitions, .mm), print sheet HTML, blob download | ui |
| `history.js` | 70 | Immutable snapshot stack, undo/redo pointer, restore-appends, compare | ui, ai digest |
| `store.js` | 207 | window.storage persistence + memory fallback: projects (wire + 20 revisions + progress + thumb), price table, prefs v2 (+v1 migration), thumbnails | ui |
| `provenance.js` | 168 | Number provenance registry (mirrors templates), species comparison reruns | ui |
| `gallery.js` | 86 | Six starter specs + first-run prompts | ui |
| `selftest.js` | 518 | In-app assertion suite (units, joinery, beam ±1%, structural fixed values, buildability, packing, codec, migration, protocol, storage) | ui diagnostics, test/unit.test.js |
| `ui.js` | 1888 | DOM shell: pipeline (correct→build→validate), commit/preview/restore, all tabs, chat + propose-validate-revise loops, inspector, projects, share, species compare, build mode, diagnostics, exports | — |
| `build.js` | 47 | Inline everything into dist/index.html | — |
| `api/chat.js` | 101 | Server proxy: key custody, model choice, token cap 1024, message cap 32, body cap 5 MB | client ai.js |
| `serve.js` / `test/*` | — | Dev server; headless unit tests (loads all of src/ into a VM, 288 asserts incl. self-test suite); Playwright smoke drive of dist | — |

## Features in code but absent from design docs

- Geometric buildability audit sweep across all template configurations (unit test) — README describes the audit but not the sweep.
- Rough-lumber ("board-foot") stock mode with per-species toggle and per-piece build-mode checklist.
- Editable, persisted price table with imperial $/ft display conversion.
- Theme system (auto/light/dark), focus-trap stack, inert overlay management.
- Per-surface load-preset selection UI feeding the integrity engine.
- `noCutAllowance` joint flag (rabbeted backs, notched shelves, toe boards).
- Near-square rotation snapping (≤2.5°) in custom correction.
- Proxy transport chain with per-session fallbacks (proxy → direct → window.claude → offline parser).

## Features described in docs but absent/divergent in code

- README: sheet fractions "pro-rata + 15% cutting premium" — code prices fractions at exact pro-rata, **no** 15% premium (`packing.js:267`).
- README claims "professional-grade woodworking plan" — no fastener locations, no milling sequence for rough mode, single-line finishing schedule, no safety notes (Phase 2C findings; built in Phase 3).
- README: "exports … match the 3D view" — COLLADA/Ruby exports drop part rotations (Phase 2D finding F-EXP-1).
- `blueprint-buddy.jsx` is the retired Phase-3 React artifact, reference only (confirmed not in build).

## Sibling documents

- `02-constants-reference.md` — every physical constant/formula/threshold with file:line.
- `03-data-flow.md` — end-to-end transform map with rounding/conversion points.
- `04-findings-register.md` — the audit register (severity, evidence, fix, test).
- `05-hand-verification.md` — hand arithmetic vs engine values (before/after).
- `06-benchmark-shaker-table.md` — published-plan comparison.
