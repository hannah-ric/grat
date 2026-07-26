# Blueprint Buddy — Strategic Product Audit

**Date:** 2026-07-25 · **Commit:** `7cc8572` · **Baseline:** all suites green (unit · audit · golden · battery · server 112 · handcalc 14/14 · smoke 288)

**Method.** Executed, not read. Three instrumented passes against the built product:

1. **Pipeline probes** — real `src/` modules loaded through `vm.runInThisContext` (the `test/audit.test.js` loader pattern), driving `AI.localModel → AI.apply → correctSpec → build → validate → computeIntegrity → cutList/bom/assembly` over ~40 realistic prompts and every template × skill level.
2. **Browser drives** — `dist/index.html` in headless Chromium at 1440×900 and 390×844: arrival, Adjust, all five Plan tabs, share-code import of a known-failing design, playback, Build mode, species swaps, WebGL disabled, `localStorage` throwing, hostile share codes.
3. **Production-shape drives** — a mock origin serving the real `/api/auth`, `/api/billing`, `/api/chat`, `/api/store`, `/api/blueprint` contracts across the four entitlement states a real visitor can occupy.

Every quoted string is verbatim from a probe or the rendered DOM. **No source was changed.**

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
| X-03 | P1 | **The entire non-chat control surface is five knobs.** The Adjust rail renders exactly Width, Depth, Height, Species (19 options), Finish. Joinery, skill level, shelf count, drawer count, and every thickness are chat-only — and chat is behind sign-in on a configured origin. | DOM query |
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

*Probes executed against `dist/index.html` built from commit `7cc8572`. Baseline suites green before and after; no source changed.*
