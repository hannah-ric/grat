# Blueprint Buddy — Strategic Product Audit

**Date:** 2026-07-25 · **Commit:** `7cc8572` · **Baseline:** all suites green (unit · audit · golden · battery · server 112 · handcalc 14/14 · smoke 288)

**Method.** Executed, not read. Three instrumented passes against the built product:

1. **Pipeline probes** — real `src/` modules loaded through `vm.runInThisContext` (the `test/audit.test.js` loader pattern), driving `AI.localModel → AI.apply → correctSpec → build → validate → computeIntegrity → cutList/bom/assembly` over ~40 realistic prompts and every template × skill level.
2. **Browser drives** — `dist/index.html` in headless Chromium at 1440×900 and 390×844: arrival, Adjust, all five Plan tabs, share-code import of a known-failing design, playback, Build mode, species swaps, WebGL disabled, `localStorage` throwing, hostile share codes.
3. **Production-shape drives** — a mock origin serving the real `/api/auth`, `/api/billing`, `/api/chat`, `/api/store`, `/api/blueprint` contracts across the four entitlement states a real visitor can occupy.

Every quoted string is verbatim from a probe or the rendered DOM. **The audit pass itself changed no source.**

> **Status:** Phases 0–4 of §5 have since been implemented on this branch. The findings below are preserved exactly as written at audit time so the record stays honest; **[§7](#7-implementation-status)**, **[§8](#8-phase-3--v-01-status)** and **[§9](#9-phase-4-status--depth-and-verification)** are the delta — what is fixed, what changed shape on contact with the code, and what remains.

**Supersedes** the two working documents from this pass (live user-journey audit, coverage-gap audit), which are folded in here in full.
**Relation to prior work:** [`AUDIT_REPORT.md`](../../AUDIT_REPORT.md) and [`docs/ui/capability-ux-audit.md`](../ui/capability-ux-audit.md) mapped this territory by reading the code. Findings marked **NEW** are not in either.

---

## 1. The thesis

Blueprint Buddy has a genuinely excellent engine wrapped in a product that does not reliably deliver it.

The engineering core deserves its reputation. Species data matches the Wood Handbook, joinery allowances are mate-aware, the nightstand plan reads like it was written by someone who has actually hung a drawer, and the server-side money path is properly defended — signature verification, atomic spend, per-user isolation, refund-on-failure. That work is real and it is not what is wrong.

What is wrong is everything between that engine and a person:

- **The app can fail completely.** One unguarded constructor takes the entire product down — including the cut list, which needs no GPU.
- **The commercial surface contradicts itself.** In all four entitlement states, the export menu says a blueprint is "issued" when none is, the Build button simultaneously shows a lock, claims the feature is "included", and opens anyway — and a signed-out visitor is told the AI is **"Offline"** when it is running and one free sign-in away.
- **The product hides its own work.** Refusals, clamps, and substitutions are silent by construction. A design that FAILS its structural checks hands you a wake-locked cut list with no warning.
- **It is less flexible than it appears.** Five sliders, six templates, and a skill level that changes nothing.

**And the tests are green through all of it** — not by accident, but for a structural reason worth stating plainly (§2).

**Counts: 6 P0 · 16 P1 · 12 P2 · 3 P3 (37 findings).** 19 are NEW.

---

## 2. Why the suite is green while the product is broken

This is the most important section in the document, because it explains why more tests of the current kind will not help.

**The suites test the pure core; almost nothing tests the product.**

`npm test` loads 22 modules into Node and exercises them as pure functions. That is where the golden corpus, the hand-arithmetic worksheet, and the findings-register regressions all live, and they are excellent at what they do. But the modules that decide what a person actually sees are excluded by design — they need a DOM, Three.js, or browser globals:

| Excluded module | Lines | What it decides |
|---|---:|---|
| `ui.js` | 4,475 | every rendered string, every gate, `commit()` |
| `porch.js` | 1,184 | landing, calculator, public routing |
| `engine.js` | 1,168 | the 3D engine |
| `motion.js` | 313 | animation |
| `billing.js` | 265 | client checkout + entitlement display |
| `jointview.js` | 207 | Joint Inspector |
| `provenance.js` | 170 | "why this number" |
| **Total** | **7,782** | **35% of `src/`** |

Three compounding facts make that gap total rather than partial:

1. **CI never opens a browser.** `.github/workflows/ci.yml` runs `npm run build`, `npm test`, `npm run test:handcalc`, and the `dist/` sync check. It never runs `test:smoke`, `test:porch`, or `test:cloud`. The Playwright suites exist and pass — they run only when a human remembers.
2. **The gated configuration is avoided on purpose.** `planLocked()` returns `false` when billing is unconfigured, so every local run, every smoke run, and every prior audit has exercised the **ungated** app. `test/smoke.playwright.js:1717` says so outright: *"providers deliberately empty: with the credits tier model, provider evidence would flip `billingConfigured()` on for the REST of the run."* The commercial surface is the least-tested code in the product, which is exactly where the contradictions are.
3. **There is no client telemetry.** No `window.onerror`, no `unhandledrejection` anywhere in `src/`. `api/_log.js` covers the server well; the client is silent. The failures below could be happening to every visitor today and would produce no signal.

Untested surface + no CI + no telemetry = failures that are structurally invisible. That is the real defect; the 37 findings are its symptoms.

---

## 3. Findings

Severity: **P0** the product is broken, unsafe, or lies about money · **P1** frequent friction, erodes trust · **P2** depth · **P3** polish.

### 3.1 Fatal — the app does not work

| ID | Pri | Finding | Evidence |
|----|-----|---------|----------|
| **F-01** | **P0** | **A missing WebGL context bricks the entire product.** `engine.js:51` constructs `new THREE.WebGLRenderer` unguarded, and it is the *third statement* of `boot()` (`ui.js:3829`) — the throw aborts before the seed design commits. With Chromium launched `--disable-webgl --disable-webgl2 --disable-3d-apis`: uncaught `Error creating WebGL context.`, stage stuck on **"Drafting your bench…"** forever, title stays `Untitled`, chat empty, and **all five Plan tabs render 0 characters**. The cut list, shopping list, assembly steps, and safety report need no GPU and are all unreachable. No message is shown. Hits GPU-blocklisted corporate laptops, Firefox without hardware acceleration, older iPads, some Android WebViews, and anyone whose driver crashes the tab once. | **NEW** |

### 3.2 Gating — the commercial surface contradicts itself

All four states driven against the real API contracts on a configured origin. This section is entirely **NEW**: no prior audit ran the gated configuration.

| ID | Pri | Finding | Evidence |
|----|-----|---------|----------|
| **G-01** | **P0** | **Signed-out visitors are told the AI is "Offline".** The probe maps HTTP status to badge state at `ui.js:1780-1785`: `400 → online`, `503 → unconfigured`, **everything else → offline**. Production `api/chat.js:129` returns **401 `auth_required`** for a signed-out user. So on the real site every first-time visitor sees **"Offline · basic edits"** with the tooltip *"No AI connection."* — while the AI is running and one free sign-in away. The product's headline capability is declared unavailable at the exact moment of maximum intent. There is no "signed out" badge state. | Probe: 4 states, badge `"Offline"` in all |
| **G-02** | **P0** | **Issuance state is client-only, so paid designs re-lock.** `state.blueprint` is set only inside `doIssue` (`ui.js:476`), restored from a saved project record (`:2887`), or nulled (`:2652`, `:2941`). Nothing fetches ownership at boot, though the server holds the truth at `bb:{uid}:design:{id}`. A customer who issues a blueprint and reloads — or opens the design on a second device — sees the paywall again on a design they already paid for, unless it happened to be a saved cloud project carrying the record. | Code trace + `issued` state renders identically to `noCredits` |
| **G-03** | **P1** | **The export menu says "issued" when nothing is.** The More → Export section header reads **"Blueprint sheet set — issued"** in **all four states**, including anonymous with no account and zero credits. | Verbatim in anon / noCredits / hasCredit / issued |
| **G-04** | **P1** | **The Build button contradicts itself three ways, identically in every state.** Lock badge visible (`#buildModeLock` `hidden: false`), tooltip reads *"Build mode — the full-screen shop companion — included with this design's blueprint"* (present tense, as if owned), and `disabled: false` so it opens regardless. Anonymous and paid users see the same button. | 4/4 states identical |
| **G-05** | **P1** | **Two different costs for one design on adjacent tabs.** Overview shows **"$290 Estimated cost"** (`ui.js:862`, from `plan.totalCost` — boards only); Buy shows **"Estimated materials: $326.92"** (`ui.js:775/1243`, from `bomData.total` — boards + fasteners + glue + finish). Both are true numbers of different things, but nothing in either label distinguishes them, and the one called *materials* is the larger. In a product selling numeric precision this reads as a bug. | 4/4 states |
| **G-06** | **P1** | **The gated configuration is untestable by construction.** Turning on provider evidence flips `billingConfigured()` for the remainder of a smoke run, so the suite deliberately keeps it off. The result is that the paywall, the previews, the CTAs, and every string above have no automated coverage at all. | `smoke.playwright.js:1717` |
| G-07 | P2 | **The "Issue blueprint — 1 credit" CTA is shown at zero balance.** With `credits.balance === 0` the locked previews still present *"Issue blueprint — 1 credit"*; the server answers `402 insufficient_credits`. The CTA should read "Buy a credit". | `noCredits` state |

### 3.3 Honesty — the product hides its own work

The largest cluster, and one architectural fact: **the only channel for "what happened to your design" is a before/after spec diff.** A diff expresses *change*. It cannot express *refusal*, *clamp*, *substitution*, or *silent drop* — precisely the events where intent and result diverge.

| ID | Pri | Finding | Evidence |
|----|-----|---------|----------|
| **H-01** | **P0** | **A FAILING design enters wake-locked Build mode with no warning.** Import the frozen honest-fail bookshelf (4 × `Sag` FAIL). `#buildModeBtn`: `disabled:false`, lock `hidden:true`, tooltip *"the full-screen shop companion"*. Clicking opens the shop companion. Whole-DOM scan of Build (1,456 chars): `mentions FAIL: false · mentions sag: false · mentions unsafe: false` — the only "safety" hit is the routine *"Shop safety for this build"* step. The engine has declared the piece unsafe and the product hands over the cut list with the screen kept awake. | **NEW** |
| **H-02** | **P0** | **Refused intents produce no chip, no note, no acknowledgement.** A beginner asking for mortise & tenon gets pocket screws with `chips: []` and `correctionNotes: []`; same for dovetails. `correctionNotes()` (`spec.js:772`) only ever reports custom-part grounding — it has no branch for joinery downgrades, species snaps, or dimension clamps. Chips come from `describeDiff(previous → corrected)`, so a refused request diffs to nothing and renders as silence. | `AI.apply({joinery:{frame:'mortise_tenon'}})` |
| H-03 | P1 | **Clamps report the result, never the refusal.** "4 m wide table" → chip `width 1524 mm → 2400 mm`; "2 m tall" → `height … → 2000 mm`; "6 mm top" → `top thickness 25 mm → 12 mm`. The number the user asked for never appears and no reason is given. | `AI.apply` |
| H-04 | P1 | **Importing a failing design says "revalidated" and nothing else.** Chat: *"Imported "Floor Bookshelf" from a share code — migrated to spec v4 and revalidated."* Four FAIL checks go unmentioned; "revalidated" reads as reassurance. | **NEW** |
| H-05 | P1 | **On PASS/ADVISORY the Safety tab is a nearly empty page.** 120 rendered characters: headline, capsule, one sentence — *"…with notes worth reading below"* — and a collapsed *"See engineering details"*. **There are no notes below**; they are inside the `<details>`. 16 checks, spans, thresholds, and load presets are all one disclosure triangle down. | Seed table → Plan → Safety |
| H-06 | P1 | **Beginner fail cards are generic and repeat verbatim.** Four shelves produce four identical cards: *"This part would not safely carry its expected load as designed. Any fix below solves it…"* — no shelf named, no sag figure, no span, no limit, though the engine computed all of them. | Failing bookshelf |
| H-07 | P1 | **The fix vocabulary is one-dimensional.** The failing bookshelf offers `"Thicken to 25 mm"` — eight times (four cards, duplicated in details). For an 862 mm span the shop answers are a centre divider, a shorter span, or a stiffer species; none is offered. | Button scrape |
| H-08 | P2 | **Unknown species snap silently.** `AI.apply` with `wood.species = 'wenge'` → `red_oak`, `chips: []`. (The offline parser now asks a question; the gap is in `correctSpec`, so it still bites model proposals, share codes, and imports.) | |
| H-09 | P2 | **Feature asks are dropped in silence.** *"desk with a pencil drawer"* → `drawers: null`, explain reads *"Roughed out a desk to standard proportions — refine away."* *"kitchen cabinet with doors"* → doors never mentioned. | |

### 3.4 Flexibility — less steerable than it looks

| ID | Pri | Finding | Evidence |
|----|-----|---------|----------|
| **X-01** | **P0** | **The possessive "my" blocks piece creation.** `ai.js:265` disqualifies a bare noun-phrase creation on `\b(it\|its\|this\|that\|my\|mine)\b`. *"a desk for my office"* → *"I didn't catch a change I can make there."*, while *"a desk for **the** office"* builds a desk. *"walnut nightstand for my bedroom"* returns `kind:"diff"` — it turns the **current table walnut** instead. Possessives are how people describe furniture. | **NEW** |
| X-02 | P1 | **Skill level is a ceiling, never a floor.** `advanced` yields byte-identical joinery, steps, and word counts to `beginner` at template defaults (`pocket_screws / butt_screws / pocket_screws` at all three levels). `K.jointsForLevel` only gates. Declaring yourself advanced changes nothing. | **NEW** |
| X-03 | P1 | **Joinery and every thickness are chat-only** — and chat is behind sign-in on a configured origin, so a signed-out user cannot change a joint at all. On the seed table the Adjust rail renders just five controls (Width, Depth, Height, Species, Finish). **Correction, made during implementation:** the original wording — "the entire non-chat control surface is five knobs" — was measured on a table and overstated the general case. Shelf count, drawer count, and skill level *are* already in the rail, but conditionally: shelf count only for bookshelf/cabinet (or an existing shelf), drawer count only for nightstand/cabinet. Five is the table's number, not the product's. The joinery and thickness half of the finding stands as written. | DOM query |
| X-04 | P1 | **Two fallbacks, and the wrong one fires for real furniture.** Out-of-scope asks split between an honest capability list and a generic *"I didn't catch a change I can make there."* The generic one answers **"bed frame"**, **"floating wall shelf"**, **"something for my entryway"**. Mechanism (`ai.js:444`): `creationShaped` needs no possessive **and** (a creation verb **or** a leading article **or** a template word). | **NEW** |
| X-05 | P1 | **The default custom piece ships a structural FAIL with zero fixes.** `defaultSpec('custom')` → `verdict: 'fail'` on joint adequacy (*"136 kg per joint vs 43 kg capacity"*), and the check's `fixes` array is **empty** — the one path that fails by default is the one with no one-tap remedy. | **NEW** |
| X-06 | P2 | **"Workbench" is advertised but not delivered.** The capability list names it and offers *"A workbench"* as a chip; it maps to `table` with `topThickness: 25`, `legThickness: 70` at 910 mm. That is a table at bench height. | **NEW** |
| X-07 | P2 | Doors, stretchers, desk drawers, chairs, beds, and wall-mounted pieces remain outside LIVE geometry (confirms prior DF-1/2/3). | |
| X-08 | P3 | *"dining table 8 feet long"* edits width correctly but discards the noun — the piece stays "Seed Table". | **NEW** |

### 3.5 Depth — casework is excellent, everything else is a sketch

| ID | Pri | Finding | Evidence |
|----|-----|---------|----------|
| D-01 | P1 | **Frame templates are a third the depth of casework.** Build steps (excluding mill/safety/sand/finish) and instruction words: table / desk / bench **3 steps, 151 words**; bookshelf 4 / 269; nightstand 10 / 437; cabinet 18 / 943. A dining table — the most-requested piece — gets *"Build the two end frames · Join the frames · Attach the top."* | |
| D-02 | P1 | **Custom pieces get 15 words a step and duplicate titles.** The default custom piece emits two steps both titled *"Join leg panel to seat"* with near-identical text — no clamp order, no square check, no setout, no way to tell them apart. | **NEW** |
| D-03 | P1 | **The top-attach step teaches the wrong joint.** Nightstand `s4` text says *"Fasten the top with figure-8s"*, but `step.joints` carries two `butt_screws` records — and "Why this joint?" and the Joint Inspector read `step.joints`. | **NEW** |
| D-04 | P2 | **Multi-joint steps describe one setout.** Nightstand `s2` carries 6 joints and prints setout for the back apron only. | |
| D-05 | P2 | **Decimal-inch bores survived the M-01 fix.** `fmtDrill` is defined at `plans.js:289` but the pull-bore call sites at `:360`/`:362` still use `fine()`: *"Bore 2 × 0.2 in through-holes"*; the reveal at `:342` is *"a 0.08 in reveal"*. No imperial index has a 0.2 in bit. `fasteners.js` was fixed correctly; these were missed. | **NEW** — partial regression |
| D-06 | P2 | **The Design viewport never shows a joint.** Legs meet aprons as plain boxes; joint dots appear only during Plan playback — the free, most-visited surface teaches nothing. | |
| D-07 | P2 | Adjust overlays the model it adjusts (~40% of the stage at 1440, stays open across mode switches). | **NEW** |
| D-08 | P3 | Species read as hue, not figure — walnut is generic medium brown at default zoom. | **NEW** |
| D-09 | P3 | The movement advisory appears as a dismissible toast over the 3D view and nowhere in the Safety tab; dismissing removes the only copy. | **NEW** |

### 3.6 Verification — contracts with no guard

| ID | Pri | Finding | Evidence |
|----|-----|---------|----------|
| **V-01** | **P0** | **CI never opens a browser** — 7,782 lines (35% of `src/`) have zero automated coverage. See §2. | `ci.yml` |
| **V-02** | **P0** | **No client-side error reporting** — no `window.onerror`, no `unhandledrejection` in `src/`. F-01 would never reach the operator. | **NEW** |
| V-03 | P1 | **The spec-migration promise is untested.** `SPEC_VERSION = 4`, one migration (`3→4`), and `CLAUDE.md` promises *"a saved design must never fail to open."* The only related assertion round-trips a **current** design. Probed directly, v1/v2/v3 and version-less specs all open — but because `correctSpec` back-fills defaults, **not** because a migration ran. No fixture corpus of old designs or old share codes. | **NEW** |
| V-04 | P1 | **Export files are never structurally validated.** Tests assert substrings. Hand-validated and currently correct: DAE 26,017 B tag-balanced with a `COLLADA 1.4` header; elevation SVG 2,801 B and sheet SVG 9,337 B balanced; `.rb` 9,747 B; GLB magic `glTF`, version 2, declared length 18,404 = actual, JSON chunk parses (12 meshes, 19 nodes). All unasserted — a malformed export ships green. No export has ever been opened in SketchUp, Blender, or an AR viewer. | **NEW** |
| V-05 | P1 | **HTML escaping is correct but unlocked.** Design names carry raw HTML through the codec verbatim (`<img src=x onerror=…>` survives round-trip), and share codes are attacker-controlled input passed between users. Live test: **safe** — no script ran, no element created; `_sheets.js` escapes server-side too. Prototype pollution via `__proto__` is blocked. Nothing asserts any of it; one future `innerHTML` reopens it. | **NEW** |
| V-06 | P1 | **No offline support at the bench.** No service worker anywhere. Build mode — the wake-locked shop companion — depends entirely on HTTP cache, in a garage. | |
| V-07 | P2 | No automated accessibility check (no axe, no contrast or focus-order assertions). | **NEW** |
| V-08 | P2 | **Multi-tab / multi-device concurrency untested** — last-write-wins against the cloud store is assumed; silent data loss is the failure mode. | **NEW** |
| V-09 | P2 | **Browser matrix unverified** — everything is headless Chromium. iOS Safari (different storage eviction, wake-lock behaviour), Firefox, Android WebView untested. | |
| V-10 | P2 | **Print fidelity unverified** — 4 `@media print` blocks exist and `printHTML` is exercised for content, but no rendered PDF has been checked for page breaks or scale. A 1:1 template printing at 98% is worse than none. | |
| V-11 | P2 | **Photo/vision path never exercised end-to-end** (needs a live key). | |

### 3.7 Verified healthy

Probed this pass and sound — recorded so they are not re-litigated:

- **Storage failure degrades cleanly** — `localStorage.setItem` throwing `QuotaExceededError` on every call: no page errors, plan renders fully, app stays usable.
- **Prototype pollution blocked** — `__proto__` payloads in share codes, top-level and nested, leave `Object.prototype` clean.
- **Hostile dimensions clamp** — 1e9, negative, zero, `NaN` all resolve to bounded specs and build.
- **Per-user isolation tested** (`server.test.js:268`); every document namespaced `bb:{uid}:{doc}`.
- **Webhook signature verification tested**, including a tampered payload; **AI burst guard tested**, including the KV-down path.
- **Casework plan quality is genuinely high** — pre-finishing interiors, dry-fit-before-glue, floating drawer bottoms, clearance-then-pilot, story sticks.
- **Three previously-open items are fixed**: negation guard (*"no ash please"* → asks which wood), word-number dimensions (*"four feet wide"* → 1219.2), and instruction-completeness Batch B. Strike them from the backlog.

---

## 4. Root causes

Four patterns produce most of the 37 findings. Fixing the patterns is cheaper than fixing the symptoms one at a time.

**RC-1 · Boot is a single point of failure with no error boundary.** `boot()` runs engine creation, state hydration, and rendering in one unguarded sequence, so a GPU problem becomes a total product outage (F-01). The pipeline downstream of `correctSpec` is pure and needs nothing from the GPU — the architecture already supports degradation; the boot sequence just doesn't use it.

**RC-2 · There is no channel for "what the system decided".** Chips are a spec diff and `correctionNotes()` has exactly one branch. Every silent clamp, downgrade, substitution, and drop (H-02, H-03, H-08, H-09) is the same missing abstraction. One function, five branches, fixes the whole cluster.

**RC-3 · Entitlement is display state, not derived state.** Gating strings are written as static copy at their call sites rather than rendered from one entitlement model, so they cannot all be right at once — hence "issued" when nothing is, a lock beside "included", and a paid design that re-locks on reload (G-02, G-03, G-04, G-07). There is no single `entitlementState()` the UI reads.

**RC-4 · The test architecture stops at the module boundary.** Purity is tested; presentation, gating, and failure modes are not — and the one suite that could cover them is neither run by CI nor pointed at the configured origin (V-01, G-06, V-02).

---

## 5. The plan

Five phases. Each is independently shippable and leaves the product strictly more honest. Ordered by risk retired per unit of diff — not by how interesting the work is.

### Phase 0 — Stop the bleeding (days, not weeks)

The smallest diff in the document, and the highest stakes. Nothing else should start first.

1. **Guard boot (F-01).** Wrap engine creation in try/catch; on failure hide the stage, show one honest line — *"3D preview isn't available in this browser — your plans below are unaffected"* — and **let `boot()` continue** so the design commits and every Plan tab renders. Everything downstream of `correctSpec` is a pure function.
2. **Gate Build on the verdict (H-01).** A `fail` verdict shows an interstitial naming the failing checks and offering the fixes; Build itself carries a persistent verdict banner. `integ.summary.verdict` is already computed on every commit.
3. **Fix the AI badge (G-01).** Add a `signed-out` state: `401 → "Sign in to design with AI"`, never "Offline". One branch at `ui.js:1785`.
4. **Add client error reporting (V-02).** `window.onerror` + `unhandledrejection` posting to a minimal endpoint reusing `api/_log.js`'s one-line format. Rate-limit, send no design content, gate on the same optional-env pattern as everything else.

*Exit:* a Playwright case with WebGL disabled asserts the cut list renders and the message appears; a case asserts Build on a `fail` design is interstitialled; a case asserts the signed-out badge text.

### Phase 1 — Make the money surface tell the truth

One model, one source of truth, every string derived from it.

1. **Introduce `entitlementState()`** — a single pure function returning `{ configured, signedIn, balance, purchased, designIssued, windowOpen }`. Every gating string, badge, tooltip, CTA, and lock renders from it. This retires G-03, G-04, G-07 structurally rather than string by string.
2. **Fetch issuance at boot (G-02).** Ask the server whether the current design is already issued (`bb:{uid}:design:{id}` is authoritative) instead of trusting client memory. A paid design must never re-lock.
3. **Disambiguate the two costs (G-05).** Either label them precisely ("boards" vs "boards + hardware & finish") or show one number everywhere. Same design, same page, one story.
4. **Turn gating on in the test suite (G-06).** A configured-origin fixture with the four entitlement states, asserting the rendered copy in each. This is the coverage that does not exist today.

*Exit:* a state × surface matrix test — no string may claim ownership the state does not have.

### Phase 2 — Say what the code decided

The RC-2 fix, and the cheapest large trust win in the document.

1. **Extend `correctionNotes(raw, corrected)`** with branches for: joinery downgraded by level, dimension clamped (naming *both* the asked-for and the applied value), species snapped, and feature dropped as unsupported. Notes describe what **code** did — the model never writes them, so the founding rule is untouched.
2. **Render Safety open (H-05, H-06).** Check cards show their own `explain` / `value` / `threshold` by default; only the design-basis appendix stays collapsed. Group N identical shelves into one card that names the part and the number. Delete the *"notes worth reading below"* promise or put the notes below it.
3. **Name the verdict on import (H-04)** instead of the reassuring bare *"revalidated"*.
4. **Widen the fix vocabulary (H-07)** — centre divider, shorter span, stiffer species, each a real patch through `commit()`.

*Exit:* battery fixtures assert a note for every silent correction class; smoke asserts the open Safety list.

### Phase 3 — Let people ask, and give them knobs

1. **Scope the creation guard (X-01)** to genuine back-references so possessives create pieces; battery fixtures for *"a desk for my office"*, *"walnut nightstand for my bedroom"*.
2. **One honest fallback (X-04)** — every unmatched first-turn ask routes to the capability list with the nearest expressible option as a chip.
3. **Joinery and structure slots on the Adjust rail (X-03)**, filtered by `jointAllowed(level)`; shelf count, drawer count, thicknesses.
4. **Level proposes (X-02)** — raising skill offers matching joinery upgrades as tappable chips.
5. **Repair the default custom piece (X-05)**; populate `fixes` on joint-adequacy failures.
6. **Decide the workbench (X-06)** — build it properly or remove it from the capability list.

*Exit:* no prompt in the corpus returns "I didn't catch a change" for a furniture noun; goldens refrozen only where joinery legitimately changes.

### Phase 4 — Close the depth gap and the verification gap

1. **Browser CI (V-01).** A second job — `npm install --ignore-scripts && npx playwright install chromium && npm run test:smoke && npm run test:porch` — kept separate so the zero-dependency core job stays exactly as it is.
2. **Lock the contracts that hold by luck (V-03, V-04, V-05):** a v1/v2/v3 fixture corpus; XML well-formedness and GLB header/JSON-chunk assertions; one XSS assertion on an imported hostile name.
3. **Raise frame and custom step density (D-01, D-02)** toward casework: clamp order, square checks, glue-up windows, per-part step titles.
4. **Align `step.joints` with the fastening the text specifies (D-03)**; explain every distinct joint a step introduces (D-04).
5. **Fix `fine()` → `drill()` at `plans.js:360/362` and the reveal at `:342` (D-05)**, and regression-lock the drill-format rule across *all* emitters so it cannot regress a third time.
6. **Service worker for Build (V-06)**, axe in the browser job (V-07), one physically measured 1:1 print (V-10).

*Exit:* frame-template word count within 2× of casework; `benchmark-shaker` re-run and re-classified; handcalc untouched.

### Sequencing

```
Phase 0  Stop the bleeding        ← nothing else starts first
Phase 1  Truthful money surface   ┐ disjoint files, can run in parallel
Phase 2  Say what the code did    ┘
Phase 3  Expressibility + knobs   ← wants Phase 2's notes channel for level chips
Phase 4  Depth + verification     ← largest, least urgent; no user is blocked
```

### What to stop doing

- **Stop adding tests of the current kind.** Another `audit.test.js` section does not touch any of the six P0s. The marginal test should be a browser test of a rendered state.
- **Stop writing gating copy at call sites.** Until `entitlementState()` exists, every new string is another chance to contradict the other five.
- **Stop treating smoke as optional.** It is the only thing standing between `ui.js` and production.
- **Do not start new geometry families** (doors, stretchers, chairs) until Phases 0–2 are green. Adding expressibility to a product that silently refuses and mislabels ownership multiplies the confusion rather than the value.

---

## 6. Scorecard

| Surface | Today | Bound by |
|---------|-------|----------|
| Availability | **Broken** — one unguarded constructor is a total outage | F-01 |
| Commercial / gating | **Contradictory** — every state says something untrue | G-01…G-05 |
| Prompt experience | **Fair** — excellent inside the vocabulary, brittle at its edges | X-01, X-04, H-09 |
| Flexibility | **Fair** — six families, five knobs, a level that does nothing | X-02, X-03, X-05 |
| 3D interface | **Good** — clean, fast, species-legible; teaches nothing about joints | D-06, D-07 |
| Engineering | **Excellent** — the best part of this product | D-05 (one regression) |
| Structural integrity | **Good engine, poor delivery** — right answers, wrong volume, absent at the bench | H-01, H-05, H-06, H-07 |
| Joinery | **Good** — real setout and teaching stack; one wrong-joint bug, no picker | D-03, D-04, X-03 |
| Build plans | **Excellent for casework, thin elsewhere** | D-01, D-02 |
| Verification | **Structurally blind** — 35% of `src/` uncovered, no CI browser, no telemetry | V-01, V-02 |

**The one-sentence version:** the engine deserves more trust than the product currently asks for — and before it asks for more, it must stop going dark on a missing GPU, stop telling signed-out visitors the AI is offline, stop re-locking designs people paid for, and stop handing a wake-locked cut list to someone whose design just failed.

---

## 7. Implementation status

Phases 0–2 are implemented on this branch. Every item below was verified by running the product, not by reading the diff.

### Fixed

| ID | What shipped |
|----|--------------|
| **F-01** | `BB.Engine.create` is guarded and boot continues. A `Proxy`-based stand-in engine absorbs **any** method call, so a call added later can never resurrect the crash; the handful of methods whose return value callers consume (`getIsolated`, `inPlayback`, `stats`, `cameraPose`, `renderNow`) answer explicitly. The viewport says *"3D preview isn't available in this browser — your plans below are unaffected"*. Locked by `test/nowebgl.playwright.js` (15 assertions) against a browser launched `--disable-webgl`. |
| **G-01** | `probeAI` maps `401 → signedout`, a new badge state reading **"Sign in to design with AI"** with accent styling — the service is up, so it is an invitation, not a fault. Previously every signed-out visitor on a healthy deploy was told *"Offline · basic edits"*. |
| **G-02** | New `GET /api/blueprint?owned=BB4:…` — a pure read (decode → evaluate → `chargeHash` → `bphash` lookup) that cannot charge. The client probes after the on-screen design settles and adopts the server's answer. A paid design no longer re-locks on reload or on a second device. |
| **G-03 / G-04 / G-07** | One `entitlementState()` — `{ configured, signedIn, balance, designIssued, hasPlan, planLocked, nextAction }` — and every gate, lock glyph, tooltip, menu hint, and CTA now renders from it. The export hint is derived (`issued` / `sign in` / `needs a credit` / `1 credit`); the Build tooltip says how to unlock instead of claiming the feature is "included" beside a padlock; a zero balance offers **Get a credit**, not an issue the server answers with 402. |
| **G-05** | Overview's "Estimated cost" now shows the BOM total, matching Buy. The boards-only subtotal keeps its own honest label, "Purchasable stock total". |
| **G-06** | `test/gating.playwright.js` (37 assertions) drives all four entitlement states, each in its own context and mock origin so `billingConfigured()` cannot leak between them. |
| **H-01** | A `fail` verdict gates Build behind an interstitial naming the failing checks, with **Show me the fixes** focused and **Build anyway** as the deliberate override; a verdict banner then stands at the bench for the whole build. Locked in `smoke.playwright.js`. |
| **H-02 / H-03 / H-08 / H-09** | `correctionNotes()` grew from one branch to six, reporting joinery downgraded by level, dimensions clamped (naming **both** the asked-for and the applied value), species substituted (solid *and* sheet), shelf counts refused, and drawer banks dropped. `correctSpec` and the notes now read one shared `DIM_RULES` table, so they cannot drift. `ui.js` requests notes on **every** diff — previously only on `new` replies and custom patches, which is why an ordinary refinement stayed silent. |
| **H-04** | Import calls the existing `Spec.integrityLine`, so a shared design that fails says so in chat instead of only *"revalidated"*. |
| **H-05 / H-06** | Advisories surface above the fold (the summary promised "notes worth reading below" and there were none); the measured value renders at every level; identical checks group into one card ("Sag — Shelf 1–4 · 4 parts, same result"); the beginner line names the part instead of repeating one anonymous paragraph. |
| **H-07** | Sag/strength failures offer a computed stiffer-species fix beside the thickness one, and joint-adequacy failures — which offered nothing at all — now offer a level-legal joint upgrade. |
| **V-02** | `api/clientlog.js` + `window.onerror` / `unhandledrejection`. Allowlisted fields only, hard-truncated, per-page-load cap, `keepalive`, always `204`. |

### Changed shape on contact with the code

- **H-06 vs the beginner-jargon rule.** Using each check's own `explain` for beginners leaked creep/ΔMC into the first layer, which smoke rightly forbids. Specificity now comes from the part-named subject plus the always-visible measured value; the engine's prose stays one fold down.
- **H-07 partial fixes.** The brief said never offer a fix that doesn't fully clear the check. The codebase already had an honest precedent (`Deepen … (partial fix — still over the limit)`), so the species fix follows it: on the frozen ash bookshelf it reads *"Switch to hickory (partial fix — still over the limit)"* rather than being suppressed.
- **Sheet species on custom pieces.** Custom compositions genuinely cut sheet parts, so the sheet-species note fires there even though the dimension notes do not.
- **`enterBuildMode` stays synchronous.** Making it `async` broke every caller that acts on the DOM on the next line — including the diagnostics entry point the smoke suite drives. Only the failing-verdict path defers, re-entering through the same door once answered.

### Verification

`unit 1256 · audit 625 · golden 6/6 · battery 50 · server 225 · credits 112 · smoke 291 · porch 81 · gating 37 · nowebgl 15 · handcalc 16/16`, **0 failures**, `test/golden/` untouched.

Two notes for the record: `test/handcalc.js` reports **16/16**, not the 14/14 stated in `CLAUDE.md` — verified identical at `HEAD`, so that is stale documentation, not a change. And `test/smoke.playwright.js` gained assertions for the Build gate; its other Build entries pass `{ acknowledged: true }`, since those blocks test checklists and the pager, not the safety gate.

## 8. Phase 3 + V-01 status

### Fixed

| ID | What shipped |
|----|--------------|
| **V-01** | `ci.yml` gains a second `browser` job — the first job is byte-identical, keeping its zero-install property. It runs all six browser suites as a real gate, caching npm and the Chromium download keyed on the *resolved* Playwright version. It carries a **coverage guard**: a `test:*` script whose command names a `.playwright.js` file must either have its own step or be listed in `SKIPPED` with a reason, and the workflow may not name a script that no longer exists. Verified in both directions locally — it passes on the real tree and correctly fails on a deliberately unwired suite. `timeout-minutes: 25`, sized from measured local wall-clock. |
| **X-01** | The creation guard now matches genuine **back-references** only: bare `it/its/mine`, or `this/that/these/those` + a piece noun, or `my` + a *piece* noun. A possessive attached to a room, person, or purpose no longer blocks a build. *"a desk for my office"* builds a desk; *"walnut nightstand for my bedroom"* builds a nightstand instead of turning the current table walnut. |
| **X-02** | Raising the skill level now **offers** the joints it unlocks, as tappable chips. The level still only ever gates — code owns the joint, the chip proposes intent, exactly like chat. Lowering the level pushes nothing and still snaps illegal joints back (now with a correction note). |
| **X-03** | The Adjust rail gains joinery slot selects — filtered to joints legal for that slot *and* that skill level — plus top / shelf / leg thickness. Slots are shown only for templates that actually build with them (derived by building each template with a distinct sentinel joint per slot). Bounds are read from the exported `Spec.DIM_RULES`, the same table `correctSpec` clamps against, and the two surfaces that previously hardcoded those numbers now read it too. |
| **X-04** | One honest fallback. Out-of-scope asks get a specific reason and the nearest expressible option as a chip — *"Beds are outside what I build — nothing here is sized to carry a mattress"*, *"Chairs and stools are outside what I build; a bench is the seating I can make"*. The edit-phrased answer is reserved for genuine edit attempts. Every chip the capability list offers is fed back through the parser in the battery and must build. |
| **X-05** | `defaultSpec('custom')` ships **`advisory`**, not `fail`. The two connections moved from end-grain butt screws to a knockdown bolt — the only beginner-legal joint that carries a BIFMA seating load through two connections, and the same remedy the engine's own fix offers. Joint adequacy now passes at 1.70× against the 1.5× gate. |
| **X-06** | The parser stops promising a workbench. "Workbench" survives only as a *height* (*"a table — a work table at workbench height included"*), the `"A workbench"` chip is gone, and the ack states the boundary: *"a sturdy table, not a laminated bench top with a vise, which is past what I can build."* The 45 mm `topThickness` ceiling makes a real bench top inexpressible, so this is resolved as copy honesty rather than a geometry claim. |
| **X-08** | A refinement that names the piece renames it: *"dining table 8 feet long"* → *"Adjusted width 96 in, renamed 'Dining table 8 feet long'."* |

### Found while implementing — not in the original audit

- **`test/cloud.playwright.js` had a failing assertion at `HEAD`**, and had for some time: it asserted every KV key starts with `bb:{uid}:`, but the signup-grant counter `bb:ipgrant:{hashed ip}` is *documented* as living outside every per-uid keyspace. Rewritten as an allowlist — any key that is neither per-uid nor a known shared root now fails, which is **stricter** than the prefix test it replaces, not weaker.
- **The same suite leaked its server.** `chromium.launch()` and the boot timeout both sat outside the `try`, so `server.kill()` was skipped on those paths. Locally that is a stray process; in CI a leaked child holds the step's stdout pipe and the step hangs until its timeout. Cleanup now runs on every path.
- **The golden corpus was coupled to a mutable product default.** `custom-bench-metric` was defined as `Spec.defaultSpec('custom')`, so repairing that default (X-05) would have silently rewritten a *frozen* fixture. The composition is now spelled out inline — screwed, end-grain, honestly failing, exactly as frozen. All six goldens remain byte-identical.
- **`CLAUDE.md`'s "handcalc must stay 14/14" is stale** — the worksheet is 16/16, verified identical at `HEAD`.

### Correction to this audit

X-03 originally read *"the entire non-chat control surface is five knobs."* That was measured on a table. Shelf count, drawer count, and skill level were already in the rail, conditionally. The finding is corrected in place in §3.4; the joinery-and-thickness half stood.

### Verification

`unit 1256 · audit 659 · golden 6/6 · battery 20 cases/110 · server 225 · credits 112 · handcalc 16/16 · smoke 291 · porch 81 · gating 37 · nowebgl 15 · adjust 21 · cloud 11` — **0 failures**, `test/golden/` untouched. Smoke was run three times to check for flakiness now that CI gates on it.

### Still open

Phases 4–5: plan depth (D-01…D-09 — frame templates at a third of casework density, custom step titles, the two `fine()` → `drill()` call sites) and the rest of verification (V-03 migration corpus, V-04 export structure, V-05 XSS lock, V-06 service worker, V-07 a11y tooling, V-08…V-11). X-07 (doors, stretchers, desk drawers, chairs, beds) remains a geometry workstream, not a copy fix.

---

## 9. Phase 4 status — depth and verification

### Fixed

| ID | What shipped |
|----|--------------|
| **D-01** | Frame templates were a sketch beside casework. Table / desk / bench go from **6 steps · 326 words to 8 steps · 930 words**: a stock-layout step that assigns the boards before a cut is made, a base flatness check (diagonals across the base, then sighting the four leg tops in one plane), clamp counts and cauls named per glue-up, seasonal-movement instruction at the top attachment computed from the species and the climate swing, and a dry-fit demanded before any glue. The exit criterion was casework-to-frame word ratio within 2×: **3.67× → 1.60×**. |
| **D-02** | Every custom-composition step names its own parts instead of "connect the parts": 205 → 428 words over the same 6 steps. Locked by an audit section that fails on any step whose text does not name the parts its `partIds` list. |
| **D-03** | `step.jointInfo` carries the **effective** fastening, not the nominal joint. A step whose joint was downgraded by skill level (or substituted by correction) used to print the joint the spec asked for while the fastener engine drilled the joint it actually got; the plan and the drilling instructions could disagree with each other on the same page. |
| **D-04** | A step that introduces several distinct fastenings now explains **each** of them, grouped with a count — *"The same setout at all 4 long apron-to-leg joints."* The old code deduplicated by joint type and stopped at two, so a nightstand step carrying six joints described one. Grouping carries `samePair`, so nothing claims "all N x-to-y joints" when the joints do not in fact run between the same two parts. |
| **D-05** | `fine()` → `drill()` at the two `plans.js` call sites, and the reveal at `:342` to `len()`. The rule — bores are bit sizes, gaps are fractions, decimals are for tolerance and computed movement only — is now regression-locked across **every** emitter rather than at the two sites that regressed, so it cannot come back a third time in a different file. |
| **V-03** | `test/fixtures/legacy/` — 11 saved designs and share codes spanning versionless Phase-1 through current, including three that omit fields later migrations add. Two sections: one asserts the corpus covers **every** registered migration (a new migration with no fixture fails), the other opens all 11 and validates the result. The promise in `CLAUDE.md` — *"a saved design must never fail to open"* — had nothing executing it. |
| **V-04** | `test/lib/format-check.js`: real structural validation for each export — XML well-formedness with tag balance for COLLADA, GLB magic/version/chunk-length arithmetic against the actual byte length plus JSON-chunk parse, CSV field-count agreement, Ruby balance. Applied across three shapes of design. **And the validators are themselves tested**: a section feeds each one deliberately corrupt input and fails if it passes, because a lock that cannot fail is not a lock. |
| **V-05** | A hostile design name — `<img src=x onerror=alert(1)>` and friends — is carried byte-identical by the codec and escaped by every renderer: the studio, the sheet set, and the public share page. Two real vulnerabilities were found doing this and are recorded below. |
| **V-06** | `src/sw.js` (186 lines), emitted as a `dist/` sibling by `build.js` under `BB_SW` (`on` default / `off` / `tombstone` → `src/sw-kill.js`, a worker that unregisters itself and clears its caches). Network-first for navigations with the cache as fallback, so a stale worker can never pin an old app; cache name is `bb-shell-<sha256(html)[0:12]>`, so a new build is a new cache. `/api/*` and `/b/:code` are never touched — a cached entitlement answer or a cached share page is exactly the bug the credits pivot cannot afford. |
| **V-07** | `test/a11y.playwright.js` — 180 assertions. axe-core swept across the states the app really has (three modes, five plan sub-tabs, a **failing**-verdict design, six modal surfaces, both themes, mobile, the porch, forced-colors, reduced-motion), plus hand-rolled checks for the four commitments no generic ruleset knows: token-level contrast pairs, verdict capsules carrying text and not colour alone, the forced-colors opt-out register, and reduced-motion content parity. Every exclusion is declared in a register the axe options are **built from**, so an undeclared exclusion cannot exist. First run: **48 failures**, dominated by one token — `--muted` failed AA on all four light surfaces while `brand-system.md` §8 claimed every pair passed. |
| **V-10** | `test/print.playwright.js` (34) measures the 1:1 templates against the real page box in a browser. It found a silent, self-certifying defect: 240 mm template strips in a 179.9 mm printable column — **clipped, not scaled**, while the 100 mm scale-check bar beside them still measured correct, so the artifact certified its own accuracy while being wrong. `api/_sheets.js` now derives the strip width from the narrowest paper it can land on (A4 portrait, 210 mm) less margins and printer slack, and declares `@page { size: letter }`. Shipped separately as `06f721b`. |

### Two vulnerabilities, found while implementing V-05

Both were reproduced end to end before being touched, and both are fixed at the single choke point rather than at the call site that exposed them.

- **Prototype pollution through `POST /api/blueprint`.** `deepMerge` walked whatever keys its input had. `JSON.parse` creates a real own `__proto__` property, the endpoint accepts a raw `body.spec`, and `api/_pipeline.js` keeps its `vm` context warm between requests — so one poisoned merge outlived the request that caused it and reached the **next user's** plan. The codec path was never exposed (decode emits a fixed key set), which is exactly why it went unnoticed. `deepMerge` now skips `__proto__` / `constructor` / `prototype`.
- **Remote code execution through a shared design name (SketchUp `.rb` export).** The Ruby escaper handled `\` and `"` only. The design name rides a share code between users byte-identical and is emitted inside real quoted strings — including `model.start_operation("Import <name>", true)`. Two ways out: a newline ended the statement, putting an uncommented `system` call on its own line; and `#{…}` interpolates, so `#{system(...)}` ran the moment the script did. The file's own header tells the reader to paste it into SketchUp's Ruby Console. Escaping now covers `#`, newlines, tabs and every control character.

### Found while implementing — not in the original audit

- **Dropping `role="menu"` unwired every export in the product.** `#moreMenu` claimed `role="menu"` while containing settings groups that are not menu items and implementing no roving-focus contract; it failed `aria-required-children`, so the roles came off. But **three** pieces of `ui.js` found their targets with `[role="menuitem"]` selectors, and all three silently matched nothing: the click binding that is the *only* wiring for `[data-export]` (sheet set, print, SVG, CSV, JSON, GLB, `.rb`, `.dae` — all visible, all enabled, all inert), the arrow-key navigation, and the close-the-panel-on-pick behaviour. A fourth, `releaseFocus`'s `[aria-haspopup="menu"]` fallback, dropped focus to `<body>` every time a dialog opened from the panel was closed. All four are selected by structure now, and each has a test that fails if the wiring goes away again: smoke **presses** an export entry and watches the export layer get called, rather than asserting the button exists.
- **The V-01 coverage guard registered scripts, not files.** `test/diy-audit.playwright.js` had no npm script, so it was invisible to the guard — 944 lines driving a `#exportMenu` the shell redesign deleted. The guard now enumerates `test/*.playwright.js` on disk as well; a suite file must be reachable from a script or declared in a `MANUAL` register with a reason (its standing is the one `CLAUDE.md` already gives `test/benchmark-shaker.js`).
- **`aria-haspopup` has no value that means "group".** Its legal values name a role — menu / listbox / tree / grid / dialog, with `true` defined as a synonym for menu — and axe validates that the attribute is *well-formed*, never that the thing it names has that role. Both shell popups are disclosures now (`aria-expanded` + `aria-controls`, no `aria-haspopup`), and the suite checks the trigger and its target agree **in both directions**, so "no `aria-haspopup`" cannot become the loophole.
- **Three menu rows were labelled "Units and precision" regardless of contents** (Theme and Render included), and `#precisionRow` carried `role="group"` twice. Introduced while satisfying the menu's required-children rule; removed with the rule that required them, since each row is already named visually and each control inside already carries its own labelled group.
- **Two source files were classified as binary by grep.** A literal `NUL` used as a map-key separator in `ui.js` (and two in the a11y suite) made ripgrep skip both files entirely — in a repo whose entire workflow is grep-driven. Written as `\u0000` escapes now: identical strings, plain-ASCII files.

### Changed shape on contact with the code

- **Two agent-reported failures were mis-specified assertions, not product bugs**, and were reproduced before being reported as such: `!/ onerror=/i.test(doc)` matched the correctly **escaped** `&lt;img src=x onerror=alert(1)&gt;`, and an SVG element count of 4 where 7 is right (root + 3 positioning wrappers + 3 elevations).
- **Two smoke assertions encoded markup this phase deliberately changed**, and were rewritten to test the contract rather than the old shape: panel headings moved `h3` → `h2` (heading-order), so the ledger check reads `:is(h2, h3).kicker`; and `.brand-name` is visually clipped rather than `display: none` on phones, because `display: none` removed the document's only `<h1>` from the accessibility tree in every mobile state. The new assertion — occupies no header width **and** still carries its text as the `<h1>` — fails if either half regresses, where the old one would pass again the moment somebody reintroduced the defect.

### Verification

`unit 1741 · audit 788 · golden 6/6 · battery 20 cases/110 · server 225 · credits 112 · handcalc 16/16 · smoke 293 · porch 81 · gating 37 · nowebgl 15 · adjust 21 · print 34 · a11y 180 · cloud 11` — **0 failures**.

`test/golden/` took its one deliberate refreeze: 2 files, 4 lines — the `layout` and `base_check` step IDs D-01 adds to the two frame fixtures. The corpus stores step **IDs**, not step text, which is why 600 words of new instruction moved nothing else. The a11y suite was run three times on a frozen build for flakiness: identical results each time.

### Still open

X-07 (doors, stretchers, desk drawers, chairs, beds) remains a geometry workstream. D-06…D-09 (joint teaching in the 3D view), V-08, V-09 and V-11 are unstarted. The service worker ships but is not yet exercised by a browser suite — `BB_SW=off` is the escape hatch until it is.

---

*Audit probes executed against `dist/index.html` built from commit `7cc8572`; no source changed by the audit itself. Phases 0–4 implemented and verified on this branch as recorded in §7, §8 and §9.*
