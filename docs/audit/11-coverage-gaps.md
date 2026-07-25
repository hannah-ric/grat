# Blueprint Buddy — Coverage Gaps: What Nothing Tests

**Date:** 2026-07-25 · **Commit audited:** `7cc8572`
**Question asked:** *What critical components for functionality haven't been tested, audited, reviewed, or considered?*
**Method:** Executed, not read. Coverage mapped from the suites' own module lists and `.github/workflows/ci.yml`, then each suspected blind spot probed against the built app — WebGL removed at the browser level, `localStorage` throwing on every write, hostile share codes, hostile dimensions, and structural validation of every export format.

**No source was changed.** Companion to [`10-live-user-audit.md`](10-live-user-audit.md), which audited the *user journey*; this one audits the *safety net around it*.

---

## 1. Verdict

The engineering-truth regime is real and unusually disciplined — but it is **pointed almost entirely at one half of the codebase**. Physics, joinery, packing, exports, and the server all have layered guards: golden corpus, hand-arithmetic worksheet, findings-register regression tests, 112 server assertions covering auth, isolation, webhook signatures, and burst limits. Meanwhile:

- **35% of `src/` — 7,782 lines including the entire UI — is never exercised by anything CI runs.**
- **The product is bricked end-to-end by one unguarded constructor**, and no suite would notice.
- **No client-side error is ever reported**, so that brick would never reach the operator.

The pattern: the project rigorously tests *what it computes* and barely tests *whether the user can reach it*. The three findings above compound — an untested surface, with no CI, and no telemetry, is a surface where failures are structurally invisible.

**Counts: 3 P0 · 5 P1 · 4 P2.**

---

## 2. P0 — critical and untested

### CG-01 · A missing WebGL context bricks the entire product

`src/engine.js:51` constructs the renderer with no guard:

```js
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
```

`BB.Engine.create(...)` is the **third statement** of `boot()` (`src/ui.js:3829`), and `boot()` has no try/catch around it. When the context cannot be created the throw aborts boot before the seed design commits, before chat renders, and before any plan is built.

Measured with Chromium launched `--disable-webgl --disable-webgl2 --disable-3d-apis`:

| Observation | Result |
|---|---|
| Page error | `Error creating WebGL context.` (uncaught) |
| Stage | stuck on **"Drafting your bench…"** permanently |
| Document title | stays `Untitled` — the seed design never loads |
| Chat | empty — no welcome, no input possible |
| Plan → Cut / Buy / Assemble / Safety | **0 characters rendered** on every tab |
| Message shown to the user | none |

The cut list, shopping list, assembly steps, and safety report need no 3D whatsoever, and all of them are unreachable. This is not a degraded experience — it is a blank product with a permanent loading message.

**Who hits this:** GPU-blocklisted corporate laptops, Firefox with hardware acceleration disabled, older iPads, some Android WebViews, browsers in battery-saver/reduced-graphics modes, and any user whose GPU driver crashes the tab once.

**Nothing tests it.** No suite constructs the engine without WebGL; the smoke suite runs with SwiftShader, which always succeeds.

### CG-02 · CI never opens a browser — 7,782 lines have zero automated coverage

`.github/workflows/ci.yml` runs exactly: `npm run build`, `npm test`, `npm run test:handcalc`, and the `dist/` sync check. It **never** runs `test:smoke`, `test:porch`, or `test:cloud`.

The headless suites (`unit`, `audit`, `golden`, `battery`) load 22 modules via `vm.runInThisContext`. These are excluded by design — they need DOM, Three.js, or browser globals:

| Module | Lines | What it is |
|---|---|---|
| `ui.js` | 4,475 | every DOM wiring, `commit()`, all rendering |
| `porch.js` | 1,184 | landing, calculator, public routing |
| `engine.js` | 1,168 | the entire 3D engine |
| `motion.js` | 313 | the animation preset library |
| `billing.js` | 265 | client checkout flow |
| `jointview.js` | 207 | Joint Inspector |
| `provenance.js` | 170 | "why this number" |
| **Total** | **7,782** | **35% of `src/`** |

The Playwright suites that *do* cover this code exist and pass (smoke: 288 assertions) — but they run only when a human remembers. A regression in `ui.js`, `engine.js`, or `porch.js` merges to `main` with a green check.

The CI comment states the rationale — *"The app has ZERO runtime dependencies, so the core suite needs no install at all"* — which is true and worth preserving. It argues for adding a **second** job with the Playwright install, not for leaving the UI uncovered.

### CG-03 · No client-side error reporting — failures are invisible to the operator

`api/_log.js` gives the server one structured line per failure, deliberately and well. The client has **nothing**: no `window.onerror`, no `unhandledrejection` listener anywhere in `src/`.

Consequence: CG-01 could be happening to every WebGL-blocked visitor today and would produce no signal — no error rate, no funnel drop, no report. The class of bug this audit found is precisely the class the operator cannot see.

---

## 3. P1 — load-bearing contracts with no guard

### CG-04 · The spec-migration promise is untested

`CLAUDE.md` states the contract plainly: *"a saved design must never fail to open; add a migration rather than changing the schema in place."* Today `SPEC_VERSION = 4` with exactly one registered migration (`3 → 4`).

The only related assertion in the entire repo is one smoke line — `revived.version === 4` — which round-trips a **current** design and exercises no migration at all.

Probed directly, old specs do open: v1, v2, v3, and a spec with no `specVersion` at all each produce a valid 9-part table. But that works because `correctSpec` back-fills defaults, **not** because a migration handled it — v1 and v2 have no registered migration and simply fall through. The contract currently holds by robustness, and nothing would catch the day it stops. There is no fixture corpus of old saved designs or old share codes.

### CG-05 · Export files are never structurally validated

The suites assert substrings (`toDAE` contains a tag, `toCSV` lacks a footer). No test parses an export as its actual format.

Validated by hand for a nightstand, all currently correct:

| Format | Result |
|---|---|
| COLLADA `.dae` | 26,017 bytes · tag-balanced, 0 unclosed · `<COLLADA … 1.4>` header present |
| Elevation `.svg` | 2,801 bytes · tag-balanced |
| Sheet `.svg` | 9,337 bytes · tag-balanced |
| SketchUp `.rb` | 9,747 bytes · 14 `end` tokens |
| `.glb` | magic `glTF` · version 2 · declared length 18,404 = actual 18,404 · JSON chunk parses · 12 meshes, 19 nodes, `asset.generator: "Blueprint Buddy"` |

Good news — and entirely unasserted. A malformed export would ship green. Separately, the prior audit's UNVERIFIED list still stands: no export has been opened in SketchUp, Blender, or an AR viewer.

### CG-06 · HTML escaping is correct but unlocked by any test

Design names carry raw HTML through the codec unchanged — `<img src=x onerror=…>` survives `toShareCode` → `fromShareCode` verbatim. Share codes are attacker-controlled input passed *between users* ("import my design"), so this is a genuine cross-user injection surface.

Live test result: **safe.** Importing a hostile name fired no script and created no `<img>` element; the name renders as text through `ui.js`'s `esc` helper, and `api/_sheets.js` escapes independently on the server-rendered share page. Prototype pollution via `__proto__` in the wire JSON is also blocked (both top-level and nested).

But no test asserts any of it. One future `innerHTML` on a design name reopens it silently.

### CG-07 · No automated accessibility check

No axe, no a11y linting, no contrast or focus-order assertions in any suite. Accessibility work to date has been manual spot-fixes (aria-labels on camera presets, keyboard access to diagnostics). Nothing prevents regression.

### CG-08 · No offline support at the bench

There is no service worker anywhere in `src/`. Build mode — the wake-locked, shop-phone companion, and the whole point of the Build tier — depends entirely on HTTP cache. A garage with a weak signal is the *expected* environment, and it is the one environment nothing guarantees.

---

## 4. P2 — considered, not verified

| ID | Gap | Note |
|----|-----|------|
| CG-09 | **Multi-tab / multi-device concurrency** — two tabs editing one design against the cloud store; last-write-wins is assumed but never tested. Silent data loss is the failure mode. |
| CG-10 | **Browser and device matrix** — everything is verified on headless Chromium only. iOS Safari (different storage eviction, no wake lock guarantees), Firefox, and Android WebView are unverified. |
| CG-11 | **Print fidelity** — `styles.css` has 4 `@media print` blocks and `Exports.printHTML` is exercised for content, but no rendered PDF has been checked for page breaks, scale accuracy, or 1:1 template correctness. A 1:1 template that prints at 98% is worse than none. |
| CG-12 | **Photo / vision path** — requires a live `ANTHROPIC_API_KEY`; never exercised end-to-end in any suite. |

---

## 5. Verified healthy

Worth recording so these are not re-litigated — each was probed this pass and passed:

- **Storage failure degrades cleanly.** With `localStorage.setItem` throwing `QuotaExceededError` on every call (Safari private mode, full quota): no page errors, plan renders fully, the app stays usable. The driver chain works as designed.
- **Prototype pollution is blocked** — `__proto__` payloads in share codes, top-level and nested, leave `Object.prototype` clean.
- **Hostile dimensions clamp** — 1e9, negative, zero, and `NaN` all resolve to sane bounded specs and build 9-part models.
- **Per-user data isolation is tested** (`test/server.test.js:268`), and the store namespaces every document as `bb:{uid}:{doc}`.
- **Webhook signature verification is tested**, including a tampered payload.
- **The AI burst guard is tested**, including the KV-down path.

---

## 6. Recommended plan

Ordered by risk retired per unit of work. Items 1–3 are small and close the compounding blind spot.

### Step 1 — Stop the brick (CG-01)

Wrap engine creation in a guard and make the failure a *degraded* mode, not a dead one: catch the throw, hide the stage, show one honest line (*"3D preview isn't available in this browser — your plans below are unaffected"*), and **let `boot()` continue** so the design commits and every Plan tab renders. The pipeline is already a pure function of the corrected spec; nothing downstream of `correctSpec` needs a GPU.

*Test:* a Playwright case launched with WebGL disabled asserting the cut list renders and the message appears.

### Step 2 — Put a browser in CI (CG-02)

Add a second CI job — `npm install --ignore-scripts && npx playwright install chromium && npm run test:smoke && npm run test:porch` — kept separate so the zero-dependency core job stays exactly as it is. This immediately covers 7,782 lines that today rely on someone remembering.

### Step 3 — Turn on the lights (CG-03)

Add `window.onerror` + `unhandledrejection` handlers posting to a minimal endpoint that reuses `api/_log.js`'s one-line format. Rate-limit client-side, send no design content, and gate on the same optional-env pattern everything else uses so a keyless deploy simply doesn't report.

### Step 4 — Lock the contracts that already hold (CG-04, 05, 06)

Cheap regression tests for behaviour that is currently correct by accident of good design:

- A fixture corpus of v1/v2/v3 specs and old `BB4:` codes, asserted to open and build.
- Structural assertions on exports: XML well-formedness for `.dae`/`.svg`, GLB magic/version/length + JSON-chunk parse.
- One XSS assertion: a hostile design name imported by share code renders as text and creates no element.

### Step 5 — The bench environment (CG-07, 08, 11)

A service worker for Build mode, an axe pass in the browser CI job, and one physically-verified print of the 1:1 templates measured with a rule. These are the items that decide whether the product works *where it is actually used*.

---

*Probes executed against `dist/index.html` built from commit `7cc8572`. Baseline `npm run build && npm test` green before and after; no source changed.*
