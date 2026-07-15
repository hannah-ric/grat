# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Blueprint Buddy — an AI-guided parametric furniture design studio and workshop companion. Vanilla JS, **zero runtime dependencies**, no framework, no bundler. The deliverable is one self-contained file, `dist/index.html` (fonts and Three.js inlined as data URIs), built from `src/` by `node build.js`, plus one serverless function (`api/chat.js`). `blueprint-buddy.jsx` is the earlier React-artifact incarnation (Phase 3) — reference only, not part of the build.

## The founding rule

**The AI proposes intent; code owns every number.** Model replies are compact wire-format JSON intent only. All geometry, joinery, structural math, unit conversion, and pricing live in code (`src/`). Never move a computation into a prompt, and never let model output write a dimension directly into state.

## Commands

```
npm install --ignore-scripts   # only needed for the smoke test (Playwright is the sole devDependency)
npm run build                  # node build.js → dist/index.html (single file)
npm run dev                    # build + serve on $PORT (default 3000) + watch-rebuild + /api/chat proxy
npm test                       # unit + audit + golden + battery + server suites (plain node, no browser, no install)
npm run test:smoke             # build + drive the real app in headless Chromium
npm run test:cloud             # accounts end-to-end: dev login → cloud autosave → reload restore (serve.js + Chromium)
npm run test:handcalc          # hand-arithmetic vs engine verification worksheet (must stay 14/14)
npm run test:battery           # live behavior battery (boundary/contradictory/adversarial fixtures) — asserting, part of npm test
npm run test:server            # api/ handlers: sessions, OAuth flows, document store — part of npm test
```

- Run one suite directly: `node test/unit.test.js`, `node test/audit.test.js`, `node test/golden.test.js`. There is no per-test filter — suites are plain Node scripts organized in `section(...)` blocks and run in a few seconds.
- Refreeze golden fixtures **only after an intended behavior change**: `node test/golden.test.js --update`, then review the git diff of `test/golden/` before committing.
- After changing `src/`: `npm run build && npm test`; also run the smoke test for UI-visible changes.
- Local AI: `cp .env.example .env` and set `ANTHROPIC_API_KEY` (`serve.js` reads `.env` itself). Without a key the app degrades to its built-in offline parser — everything else still works.

## Architecture

One pipeline, and every input path (chat, photo, share code, sliders, gallery) funnels through the same correction + validation gate:

```
intent (ai.js) → Spec.correctSpec → Parametric.build → Spec.validate
  → Structural.computeIntegrity → Plans (cutList/bom/assembly) → Packing.planStock → Exports
```

Everything downstream of the corrected spec is a **pure function of the corrected spec** — that's what makes the golden corpus, species comparison, and provenance possible.

The layers:

1. **AI layer** (`src/ai.js`, `src/codec.js`) — token-optimized wire codec (single-letter keys, enums as ints); refinements are partial-merge wire diffs; replies capped at 1000 tokens with a continuation protocol (truncation is continuable, never a validation failure). Transports tried in order: injected (tests) → same-origin `/api/chat` proxy → direct Anthropic → `window.claude.complete` → built-in offline intent parser.
2. **Parametric layer** (`src/parametric.js`) — code-owned templates (table, desk, bench, bookshelf, nightstand, cabinet) plus a novel-piece grammar: primitives (`post`, `rail`, `panel`, `slab`, `cylinder`) with an explicit connection graph, auto-grounded and centered by correction.
3. **Structural engine** (`src/structural.js`) — Wood Handbook material data, exact beam math (MOE→sag, MOR→strength at safety factor 4, Janka→surface duty only, never beam math), BIFMA load presets with published basis, ×2 creep on sustained loads, F2057/STURDY open-drawer tipping (failures make the wall anchor a mandatory BOM line), frame model for table-like pieces. Upstream of it, `spec.js` runs the geometric buildability audit (floor/envelope/overlap/joint-contact/connectivity/COG invariants) with up to three model-refinement rounds; a design that still fails is never presented.
4. **Derived layer** — `plans.js` (cut list with thickness-aware joinery allowances, BOM, assembly steps), `fasteners.js` (fastener-location/joinery-setout engine — screw positions, pilots, tenon setout snapped to chisel sizes; BOM counts must always match the drilling instructions), `packing.js` (1D/2D stock optimizer), `drafting.js` (dimensioned elevation SVGs + Blueprint Mode), `exports.js` + `gltf.js` (CSV/SketchUp/COLLADA/GLB).
5. **Display boundary** (`src/units.js`, `BB.Units`) — internal math is **always millimetres and SI**; conversion to display text happens exactly once, at render time. A raw `` `${x} mm` `` template string anywhere else is a bug. Deliberate exemption: SketchUp/CAD exports carry real millimetre geometry regardless of display mode.

### Module system

No ES modules. Each `src/*.js` is an IIFE attaching one namespace to the global `BB` (`var BB = globalThis.BB = globalThis.BB || {}`). Load order is defined by `build.js`. **Adding a new src module requires touching all of:**

- `build.js` (a `{{JS_*}}` replace, in dependency order)
- `src/index.template.html` (the matching placeholder)
- the `SRC` array at the top of each headless test file (`test/unit.test.js`, `audit.test.js`, `golden.test.js`, `battery.js`, `handcalc.js`) — they load modules via `vm.runInThisContext`. Only browser-independent modules belong there (`engine.js`, `ui.js`, `jointview.js`, `provenance.js` are excluded because they need DOM/Three).

Other load-bearing locations:

- `src/knowledge.js` — every physical constant (wood species, ergonomics, fasteners, finishes) has exactly one source here; `docs/audit/02-constants-reference.md` maps them. The AI system-prompt digests are **generated from these tables and self-tested — never hand-edit a digest string**.
- `src/ui.js` — all DOM wiring; every design change (AI edit, inspector edit, integrity fix, history restore) flows through `commit()` so there is one spec and one history stack.
- `src/spec.js` — every corrected spec carries `specVersion` and loads through a migration registry: a saved design must never fail to open; add a migration rather than changing the schema in place.
- `api/` — all server code, CommonJS, zero deps, mounted identically by `serve.js` locally and auto-detected by Vercel (see `DEPLOYMENT.md`): `chat.js` (same-origin Anthropic proxy holding `ANTHROPIC_API_KEY`; owns model choice — default `claude-sonnet-5` — and the token ceiling), `auth.js` (optional OAuth logins → stateless HMAC session cookies; `_session.js` is the shared signer, not an endpoint), `store.js` (optional per-user JSON document store on Upstash/Vercel KV REST, or `.data/kv.json` in dev). Everything auth/storage is optional and degrades: no env vars → the client persists to `localStorage`, no login UI appears.
- `vendor/` — Three.js + Bitter fonts, committed, inlined at build time.
- `src/selftest.js` — the in-app diagnostics suite (long-press the logo); it ships in the product as a permanent regression net, so keep it in sync with behavior changes.

## Engineering-truth guardrails

The 2026 audit (`docs/audit/`, start at `00-final-report.md`) established the regime for any change to physics, joinery allowances, packing, or exports:

- `test/audit.test.js` must stay green — one section per findings-register entry, written failing-test-first.
- Six reference designs are frozen with complete outputs in `test/golden/`; behavior changes diff against them (0.05 mm tolerance) instead of re-litigating correctness. Refreeze deliberately with `--update` and review the diff.
- `test/handcalc.js` computes every physics number twice — explicit hand arithmetic vs the engine — and must stay 14/14.
- `ash-bookshelf-metric` is a frozen *honest-fail* case (19 mm shelves sag under books + creep); don't "fix" it.

## Conventions

- No new dependencies without strong cause — the build must stay runnable with nothing but Node ≥ 18.
- Keep everything inlineable: no ES modules in `src/`, no external URLs in the output, zero fetched assets — textures, environments, and drawings are generated procedurally at runtime.
- Memory contracts are load-bearing and smoke-tested: shared unit geometries, bounded material pools, one texture per species, dispose-on-teardown, `stats()` asserted stable across rebuilds/theme flips.
- Reduced motion is a first-class path: one damped-lerp family drives all 3D motion, one easing family in CSS, and reduced motion collapses every animation to a snap.
- Boot stays untouched: thumbnails, the hero moment, and other extras ride idle time and degrade silently on failure. Storage is a driver chain (artifact → cloud → device → memory, `src/store.js`) — every rung degrades to the next, ending at a fully working session-only app; the auth probe races a short timeout so first paint never waits on the network.
- UI system of record: `docs/ui/brand-system.md` ("Showroom" tokens — pending adoption into `src/styles.css`), `docs/ui/semantic-skeleton.md` (structural target for shell markup), `docs/ui/phase2-roadmap.md` (evidence-based UI backlog). Verdicts (`PASS`/`ADVISORY`/`FAIL`) always ship as stamps with text, never color alone.
- Product/creative direction and the built-vs-roadmap line for Phase 5: `DESIGN.md`.
