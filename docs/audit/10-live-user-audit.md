# Blueprint Buddy — Live User-Journey Audit

**Date:** 2026-07-25 · **Commit audited:** `7cc8572`
**Lens:** A person who wants a piece of furniture, typing what they'd actually type, clicking what's actually on screen.
**Method:** *Executed*, not read. `npm run build && npm test` green as a baseline (unit · audit · golden · battery · server 112 · smoke 288), then three instrumented passes:

1. **Pipeline probes** — the real `src/` modules loaded through `vm.runInThisContext` (the `test/audit.test.js` loader pattern), driving `AI.localModel → AI.apply → correctSpec → build → validate → computeIntegrity → cutList/bom/assembly` over ~40 realistic prompts and every template × skill level.
2. **Browser drives** — `dist/index.html` in headless Chromium at 1440×900 and 390×844: arrival, Adjust rail, all five Plan tabs, share-code import of a known-failing design, assembly playback, Build mode, species swaps.
3. **Verbatim capture** — every quoted string below is copied from a probe or the rendered DOM, not paraphrased.

**No source was changed.** This document is an audit and a plan.

**Relation to existing audits:** [`AUDIT_REPORT.md`](../../AUDIT_REPORT.md) (carpenter engineering audit — CRITICAL/HIGH remediated) and [`docs/ui/capability-ux-audit.md`](../ui/capability-ux-audit.md) (2026-07-24, static cross-read) mapped this territory by *reading* the code. This pass **ran** it. Where the two agree, this document cites the prior ID and adds reproduction. Where running it revealed something reading could not, findings are marked **NEW**. Three previously-open items are confirmed **fixed** and should be struck from the backlog.

---

## 1. Verdict

The engineering core continues to earn its reputation: species data, joinery allowances, fastener setout, drawer instructions, and the four-tier integrity rollup are all genuinely shop-grade. The nightstand plan in particular reads like it was written by someone who has hung a drawer — story sticks, pre-finishing interiors, clearance-hole-then-pilot, floating bottoms.

The failures cluster in one place, and it is not the physics. **The product knows more than it says.** Three times in a single session, the engine computed a correct, important fact and then declined to tell the user:

- It clamped a 4 m table to 2.4 m and showed a chip reading `width 1524 mm → 2400 mm` — never mentioning the 4 m that was asked for.
- It refused a beginner's mortise-and-tenon request, substituted pocket screws, and emitted **zero** chips and **zero** notes.
- It declared a design FAIL on four checks and then let the user walk into full-screen, wake-locked Build mode with board diagrams up and **no mention of the failure anywhere on screen**.

That last one is the headline. Everything else in this audit is ordinary product work; that one is a safety-of-use defect in a product whose entire promise is "checked against real structural physics."

**Counts: 3 P0 · 11 P1 · 8 P2 · 3 P3 (25 findings).** 13 are NEW — not present in either prior audit.

**Three worst:**
① **LU-01** Build mode opens on a FAIL verdict with no warning at all.
② **LU-02** Refused intents are invisible — the chip channel reports what changed, never what was denied.
③ **LU-03** Any first-turn prompt containing "my" cannot create a piece; "a desk for my office" answers *"I didn't catch a change I can make there."*

---

## 2. Findings

Severity: **P0** unsafe or breaks the core promise · **P1** frequent friction, erodes trust · **P2** depth · **P3** polish.
"Repro" = the exact input. Every quoted output is verbatim.

| ID | Pri | Area | Finding | Evidence / repro |
|----|-----|------|---------|------------------|
| **LU-01** | **P0** | Integrity · Build | **A FAILING design enters Build mode with no warning.** Import the frozen honest-fail bookshelf (4 × `Sag` FAIL). `#buildModeBtn` reports `disabled:false`, lock badge `hidden:true`, tooltip *"Build mode — the full-screen shop companion"*. Clicking opens the wake-locked shop companion. Scanning the entire Build DOM (1456 chars): `mentions FAIL: false · mentions sag: false · mentions unsafe: false`. The only "safety" hit is the routine *"Shop safety for this build"* step. The user cuts parts the engine has declared unsafe. | Share-code import → Build. **NEW** (prior audits flagged SI-4 as "custom designs can commit with FAILs"; nobody had checked what Build does with one) |
| **LU-02** | **P0** | Prompt · Joinery | **Refused intents produce no chip, no note, no acknowledgement.** Beginner asks for mortise & tenon → `joinery.frame` stays `pocket_screws`, `chips: []`, `correctionNotes: []`. Same for dovetails. `correctionNotes()` (`spec.js:772`) only ever reports *custom-part grounding* — it has no branch for joinery downgrades, species snaps, or dimension clamps. Chips come from `describeDiff(previous → corrected)`, so a refused request diffs to nothing and renders as silence. | `AI.apply({kind:'diff',patch:{joinery:{frame:'mortise_tenon'}}}, beginnerTable)` → `chips: []`. Confirms + explains PX-3 / JR-1 |
| **LU-03** | **P0** | Prompt | **The possessive "my" blocks piece creation.** `ai.js:265` disqualifies a bare noun-phrase creation when the text matches `\b(it\|its\|this\|that\|my\|mine)\b`. Result: *"a desk for my office"* → *"I didn't catch a change I can make there."* while *"a desk for the office"* builds a desk. Worse, *"walnut nightstand for my bedroom"* returns `kind:"diff"` — it turns the **current table walnut** instead of building a nightstand. Possessives are the most natural way people describe furniture. | `AI.localModel('a desk for my office', seed)` vs `'a desk for the office'`. **NEW** |
| LU-04 | P1 | Prompt | **Clamps report the result, never the refusal.** "4 m wide table" → chip `width 1524 mm → 2400 mm`; "2 m tall" → `height … → 2000 mm`; "6 mm top" → `top thickness 25 mm → 12 mm`. In every case the number the user asked for never appears, and no reason is given. | `AI.apply` with `overall.width = 4000`. Sharpens PX-3 |
| LU-05 | P1 | Prompt · Flexibility | **Feature asks are dropped in silence.** *"desk with a pencil drawer"* → `drawers: null`, explain reads *"Roughed out a desk to standard proportions — refine away."* — the drawer is never mentioned. *"kitchen cabinet with doors"* → doors never mentioned. | `AI.localModel` on both. Confirms DF-3 / PX-2, adds the no-disclosure half |
| LU-06 | P1 | Prompt | **Two fallbacks, and the wrong one fires for real furniture.** Out-of-scope asks split between an honest capability list (*"Offline I can rough out a table, desk, bench, workbench, bookshelf, nightstand, or cabinet…"* — good) and a generic *"I didn't catch a change I can make there."* The generic one answers **"bed frame"**, **"floating wall shelf"**, and **"something for my entryway"** — all clearly first-turn design intents. Mechanism (`ai.js:444`): `creationShaped` requires no possessive **and** (a creation verb **or** a leading article **or** a known template word) — so a bare two-word noun phrase ("bed frame") and anything containing "my" both fall to the edit-phrased answer. The same regex as LU-03 drives half of this. | `AI.localModel` sweep. **NEW** |
| LU-07 | P1 | Flexibility | **Skill level is a ceiling, never a floor.** `advanced` yields byte-identical joinery, steps, and word count to `beginner` at template defaults (`{"frame":"pocket_screws","case":"butt_screws","box":"pocket_screws"}` at all three levels). Declaring yourself advanced changes nothing unless you also name the joint; `K.jointsForLevel` only gates. | Template × level matrix: `buildSteps` and `words` identical per template across levels. **NEW** |
| LU-08 | P1 | Flexibility | **The entire non-chat control surface is 5 knobs.** The Adjust rail renders exactly: Width, Depth, Height, Species (19 options), Finish. Joinery, skill level, shelf count, drawer count, and every thickness are chat-only — so on the offline/anonymous path they are unreachable. | DOM query of `#adjustRail`. Quantifies JR-1 / DF-4 |
| LU-09 | P1 | Integrity | **On PASS/ADVISORY the Safety tab is a nearly empty page.** Rendered text is 120 characters: headline, capsule, one sentence — *"This design passes the required strength checks, with notes worth reading below"* — and a collapsed *"See engineering details"*. **There are no notes below**; they are inside the `<details>`. The copy promises content the page does not show. 16 checks, thresholds, spans, and load presets are all one disclosure triangle down. | Seed table → Plan → Safety. Sharpens SI-1 with the copy contradiction |
| LU-10 | P1 | Integrity | **Beginner fail cards are generic and repeat verbatim.** Four shelves produce four identical cards: *"This part would not safely carry its expected load as designed. Any fix below solves it, or ask the chat for a different approach."* No shelf is named, no sag figure, no span, no limit — although the engine computed all of them. | Failing bookshelf → Safety. Confirms SI-1 |
| LU-11 | P1 | Integrity | **The one-tap fix vocabulary is one-dimensional.** The failing bookshelf offers `"Thicken to 25 mm"` — eight times (four cards, duplicated in the details). For a 862 mm span the shop answers are a centre divider, a shorter span, or a stiffer species; none is offered. | Button scrape of `#panel-main`. Confirms EN-4 / backlog #4 |
| LU-12 | P1 | Integrity | **Importing a failing design says "revalidated" and nothing else.** Chat reads: *"Imported "Floor Bookshelf" from a share code — migrated to spec v4 and revalidated."* followed by a *"See your plan →"* chip. Four FAIL checks go unmentioned in chat; "revalidated" reads as reassurance. | Share-code import of the honest-fail bookshelf. **NEW** |
| LU-13 | P1 | Joinery | **The top-attach step teaches the wrong joint.** On the nightstand, step `s4` text says *"Fasten the top with figure-8s so it can move with the seasons"*, but `step.joints` carries two `butt_screws` records. "Why this joint?" and the Joint Inspector read `step.joints` — so tapping that joint teaches a butt-screw joint for a connection the plan explicitly makes with figure-8s. | `Plans.assembly(nightstand)` → `s4.joints`. **NEW** |
| LU-14 | P1 | Build plans | **Frame templates are a third the depth of casework.** Build steps (excluding mill/safety/sand/finish) and total instruction words: table / desk / bench **3 steps, 151 words**; bookshelf 4 / 269; nightstand 10 / 437; cabinet 18 / 943. A dining table — the most-requested piece — gets *"Build the two end frames · Join the frames · Attach the top."* | Template × level matrix. Quantifies BP-2 |
| LU-15 | P1 | Build plans | **Custom pieces get 15 words a step and duplicate titles.** The default custom piece emits two steps both titled *"Join leg panel to seat"* with near-identical text (*"Fix leg panel (p2) to seat (p1) with butt joints with screws. Dry-fit before glue."*) — no clamp order, no square check, no setout, and no way to tell the two apart. | `Plans.assembly(defaultSpec('custom'))`. Sharpens BP-3 |
| LU-16 | P1 | Flexibility · Integrity | **The default custom piece ships a structural FAIL with zero fixes.** `defaultSpec('custom')` → `verdict: 'fail'` on joint adequacy (*"136 kg per joint vs 43 kg capacity"*), and the check's `fixes` array is **empty** — the one path that fails by default is the one path with no one-tap remedy. | `computeIntegrity(defaultSpec('custom'))`. **NEW** |
| LU-17 | P2 | Prompt | **"Workbench" is advertised but not delivered.** The capability list names a workbench and offers *"A workbench"* as a chip; it maps to the `table` template with `topThickness: 25`, `legThickness: 70`, height corrected to 910 mm. A 25 mm top on 70 mm legs is a table at bench height, not a workbench. | `AI.localModel('workbench')`. **NEW** |
| LU-18 | P2 | Prompt | **Unknown species snap silently on the apply path.** `AI.apply` with `wood.species = 'wenge'` → `red_oak`, `chips: []`. (The *offline parser* now asks a question instead — the gap is in `correctSpec`, so it still bites model proposals, share codes, and imports.) | `AI.apply({wood:{species:'wenge'}})`. Confirms M-20 with corrected scope |
| LU-19 | P2 | Build plans | **Decimal-inch bores survived the M-01 fix.** `fmtDrill` is defined at `plans.js:289` but the pull-bore call sites at `plans.js:360` and `:362` still use `fine()` (`fmtSmall`): *"Bore 2 × 0.2 in through-holes"*. The reveal at `:342` is the same — *"a 0.08 in reveal all around"*. No imperial drill index has a 0.2 in bit. `fasteners.js` was fixed correctly; these two call sites were missed. | Nightstand `dr1_pull` / `dr1_front` step text. **NEW** — partial regression of a closed finding |
| LU-20 | P2 | 3D | **The Design viewport never shows a joint.** Legs meet aprons as plain boxes; joint dots appear only during Plan-mode playback. The free, most-visited surface teaches nothing about joinery. | Design-mode screenshot. Confirms 3D-1 |
| LU-21 | P2 | 3D | **Adjust overlays the model it adjusts.** At 1440 the Adjust panel covers roughly 40% of the stage and stays open across mode switches, so dragging Width partly hides the piece changing. | Screenshot `02-adjust`. **NEW** |
| LU-22 | P2 | 3D | **Species read as hue, not as figure.** Walnut / oak / maple / cherry differ clearly in colour, but grain figure is very low-contrast at default zoom — walnut reads as generic medium brown rather than walnut. (Colour could not be sampled numerically: the WebGL canvas has no `preserveDrawingBuffer`, so readback returns black — screenshots were used instead.) | `species-*.png`. **NEW** |
| LU-23 | P2 | Joinery | **Multi-joint steps describe one setout.** Nightstand `s2` carries 6 joints and prints setout for the back apron only; the front drawer rails get none. | `s2.joints.length === 6`, one note. Confirms JR-2 |
| LU-24 | P3 | Prompt | **"8 feet long" edits width without renaming.** *"dining table 8 feet long"* on the seed table returns `kind:"diff"` patching `overall.width` — correct geometry, but the piece stays "Seed Table" and the user's noun is discarded. | `AI.localModel`. **NEW** |
| LU-25 | P3 | Integrity | **Advisory content is gated behind the same triangle as the engineering detail.** The movement advisory that *does* surface on the seed table appears as a dismissible toast over the 3D view, not in the Safety tab, so dismissing it removes the only visible copy. | Design-mode screenshot vs Safety tab. **NEW** |

### Previously-open items confirmed FIXED (strike from the backlog)

Running the code settled three items the static audits still listed as open:

- **AUDIT H-11 / PX-5 (negation guard)** — *"no ash please"* → *"Understood — not white ash. Which wood should it be instead?"*. Working.
- **Backlog #2 (word-number dimensions)** — *"a dining table four feet wide"* → `overall.width: 1219.2`. Working.
- **AUDIT Batch B (instruction completeness)** — the nightstand plan now carries pre-finishing (*"Pre-finish the drawer boxes (inside and out) … an assembled drawer bank is unreachable"*), dry-fit-before-glue (*"Dry-fit and check square before any glue"*), the floating drawer bottom (*"no glue, it floats"*), and clearance-then-pilot (*"11/64 in clearance holes through the box front, pilot 7/64 in"*). Shipped and good.

---

## 3. Challenge catalogue

Grouped by what they cost the user, not by which file they live in.

### 3.1 The disclosure gap (LU-02, 04, 05, 12, 18 · the single largest cluster)

Five findings are one architectural fact: **the app's only channel for "what happened to your design" is a diff of the spec before and after.** A diff can express *change*. It cannot express *refusal*, *clamp*, *substitution*, or *drop* — those are precisely the events where intent and result diverge, and precisely the events a user needs narrated. The founding rule ("code owns every number") makes these corrections correct; nothing makes them *visible*.

This is the cheapest high-value fix in the audit because the surface already exists — chips render, `correctionNotes()` is already wired from `correctSpec` through `ui.js:1900` into chat. It has one branch. It needs five.

### 3.2 The honesty gap at the point of danger (LU-01, 09, 10, 12)

The integrity engine is the product's moat and it is *systematically quietest where it matters most*: silent on a failing import, generic on a failing shelf, empty on a passing design, and absent from Build mode. The FAIL path is actually the best-designed one (real fix buttons, clear capsule) — but it stops at the Plan tab and does not follow the user to the bench.

### 3.3 The expressibility cliff (LU-03, 05, 06, 07, 08, 17)

A user has two ways to change a design: chat, or five sliders. Chat is behind sign-in on configured hosts (`api/chat.js:129` — *"Sign in to design with AI"*), so for anonymous and offline sessions the built-in parser **is** the product — and that parser cannot handle possessives, drops features silently, and answers real furniture nouns with "I didn't catch a change." Meanwhile the one knob that should express ambition — skill level — does nothing on its own.

### 3.4 Depth asymmetry (LU-14, 15, 16, 23)

Casework is excellent; frames and custom pieces are sketches. The gap is 6× in instruction words. Users asking for the single most common piece — a dining table — get the thinnest plan in the product, and the novel-geometry path both fails by default and offers no way out.

### 3.5 The teaching surface is in the wrong room (LU-13, 20, 21, 22)

The 3D view is where users spend their time and where joinery is invisible; the joint teaching lives behind Plan playback; and one step teaches a joint the plan does not use.

---

## 4. Opportunity catalogue

Ranked by user value per unit of invasiveness. Every item preserves the founding rule — none moves a computation into a prompt or lets model output write a number.

| # | Opportunity | Fixes | Why it's cheap |
|---|-------------|-------|----------------|
| 1 | **Make `correctionNotes()` a real correction channel** — return notes for joinery downgrade, dimension clamp, species snap, and dropped features, alongside today's grounding note | LU-02, 04, 05, 18 | The function, its call sites, and the chat rendering already exist; this adds branches to one pure function |
| 2 | **Carry the verdict to the bench** — a persistent verdict banner in Build mode, a FAIL interstitial before entry, and the verdict named in the import acknowledgement | LU-01, 12 | `integ.summary.verdict` is already computed on every commit; this is rendering |
| 3 | **Un-bury Safety** — render the check list open by default with each check's own `explain`, `value`, and `threshold`; keep only the design-basis appendix collapsed | LU-09, 10 | The strings are already computed and already correct — they are simply inside a closed `<details>` |
| 4 | **Loosen the creation guard** — scope the deixis test to back-references ("make **it** taller") rather than any possessive, so "a desk for my office" builds a desk | LU-03, 24 | One regex, plus battery fixtures |
| 5 | **One honest fallback** — route every unmatched first-turn ask to the capability list, never to "I didn't catch a change" | LU-06 | Branch consolidation in `localModel` |
| 6 | **Let skill level propose** — when a user raises level, offer the joinery upgrade as a tappable chip (intent only; `correctSpec` still owns legality) | LU-07 | Reuses the existing fix-chip mechanism |
| 7 | **Joinery + structure slots on the Adjust rail**, filtered by `jointAllowed(level)` | LU-08 | The rail already commits through `commit()`; adds selects, not physics |
| 8 | **Fix the two `fine()` → `drill()` call sites** and the reveal | LU-19 | Three-character change; regression-lock it |
| 9 | **Widen the fix vocabulary** — centre divider / shorter span / stiffer species alongside "thicken" | LU-11 | Parametric already supports dividers via shelf/partition geometry |
| 10 | **Raise frame + custom step density** to casework quality; dedupe custom step titles by part index | LU-14, 15 | Same step-emitter, more branches |
| 11 | **Repair the custom default** so the shipped novel piece passes, and give joint-adequacy checks real `fixes` | LU-16 | Default geometry + fix wiring |
| 12 | **Joint dots in Design mode** (free, one sample joint) and align `step.joints` with the fastening the text actually specifies | LU-13, 20, 23 | Dots exist; this changes when they render |
| 13 | **Dock Adjust beside the stage**; deepen grain contrast | LU-21, 22 | CSS + material tuning |
| 14 | **Deliver the workbench** as a real template (thick top, heavy legs) or stop advertising it | LU-17 | Either is honest; today's state is not |

---

## 5. Improvement plan

Four phases. Each leaves the product strictly more honest than it found it, and each is independently shippable. Scope is described by invasiveness, not calendar.

### Phase 1 — Say what you did (the disclosure + safety pass)

**Goal:** the product never silently overrides, and never lets a failing design reach the saw unannounced.

1. **Extend `correctionNotes(raw, corrected)`** with branches for: joinery downgraded by level, dimension clamped (naming *both* the asked-for and the applied value), species snapped to a substitute, and feature dropped as unsupported (drawers/doors on templates that lack them). Notes describe what **code** did — the model never writes them.
2. **Verdict follows the user.** Build mode gains a persistent verdict banner; entering Build on a `fail` requires passing an interstitial that names the failing checks and offers the fixes; the import acknowledgement names the verdict instead of the reassuring bare *"revalidated"*.
3. **Safety renders open.** Check cards show their own `explain` / `value` / `threshold` by default; only the design-basis appendix (load presets, movement assumptions) stays collapsed. Delete the *"notes worth reading below"* promise or put the notes below it.
4. **Beginner fail cards name the part and the number** — the check's concrete `explain`, not the generic paragraph, and one grouped card for N identical shelves.

*Exit:* new `LU-*` sections in `test/audit.test.js` written failing-first; smoke assertions for the Build interstitial and the open Safety list; no golden churn (rendering only, except the notes channel).

### Phase 2 — Let people ask (the prompt pass)

**Goal:** natural first-turn phrasing succeeds, and what can't be built is said out loud.

1. Scope the creation guard to genuine back-references so possessives create pieces; add battery fixtures for *"a desk for my office"*, *"walnut nightstand for my bedroom"*, *"bookshelf for my kids room"*.
2. Collapse the two fallbacks into the honest capability list; make "bed frame", "wall shelf", "chair", "stool", "coffee table", "console" all land there with the nearest expressible option offered as a chip.
3. Name dropped features in the reply (*"Desks can't take drawers yet — want this as a shallow cabinet?"*) rather than returning a spec that quietly lacks them.
4. Decide the workbench: build the template properly, or remove it from the capability list and the chips.

*Exit:* battery fixtures assert refusal-with-alternative for every capability wall; no prompt in the corpus returns "I didn't catch a change" for a furniture noun.

### Phase 3 — Give people the knobs (the control pass)

**Goal:** the design is steerable without chat — which is what anonymous, offline, and signed-out users have.

1. Adjust rail gains joinery slots (`frame` / `case` / `box`) filtered by `jointAllowed(level)`, plus shelf count, drawer count, and the thicknesses that already exist in the spec.
2. Raising skill level proposes matching joinery upgrades as tappable chips instead of silently permitting them.
3. Widen the integrity fix vocabulary beyond "thicken": centre divider, shorter span, stiffer species — each a real geometry or spec patch through `commit()`.
4. Repair the default custom piece so it passes, and populate `fixes` on joint-adequacy failures.

*Exit:* golden refreeze only where joinery legitimately changes; new goldens for a divider-fixed bookshelf and a passing default custom piece.

### Phase 4 — Close the depth gap (the plans + teaching pass)

**Goal:** the most-requested piece stops having the thinnest plan.

1. Raise table / desk / bench assembly to casework density — clamp order, square checks, glue-up windows, apron-to-leg setout per joint rather than per step.
2. Custom path: per-part step titles (no duplicates), dry-fit and square guidance, setout for each connection.
3. Multi-joint steps explain every distinct joint they introduce, not the first.
4. Align `step.joints` with the fastening the step text actually specifies (the figure-8 case), so the Joint Inspector stops teaching a joint the plan doesn't use.
5. Joint dots in the Design viewport with one free sample inspection.
6. Fix `fine()` → `drill()` at `plans.js:360/362` and the reveal at `:342`; regression-lock the drill-format rule across *all* emitters so it cannot regress a third time.

*Exit:* frame-template word count within 2× of casework; `benchmark-shaker` re-run and re-classified; handcalc untouched (no physics changes in this phase).

### Sequencing

```
1  Disclosure + safety     ← ship first; smallest diff, largest trust delta
2  Prompt honesty          ← independent of 1, different files
3  Control surface         ← depends on 1's notes channel for level-change chips
4  Plan depth + teaching   ← largest, least urgent; no user is blocked on it
```

Phases 1 and 2 touch disjoint files (`ui.js`/`spec.js` vs `ai.js`) and can run in parallel. Phase 3 wants Phase 1's notes channel in place so new controls announce their own corrections. Phase 4 is the only phase that should wait.

### Guardrails for all four

- Failing-test-first for every behaviour-bearing change (`LU-*` sections in `test/audit.test.js`).
- `npm run build && npm test` after each change; `npm run test:smoke` for anything UI-visible.
- Golden refreeze only when the diff **is** the intended change, reviewed in git.
- No computation moves into a prompt; no model output writes a dimension. Every note added in Phase 1 describes an action `correctSpec` already took.

---

## 6. Scorecard

| Surface | Today | Bound by |
|---------|-------|----------|
| Prompt experience | **Fair** — excellent inside the template vocabulary, brittle at its edges | LU-03, 05, 06 |
| Flexibility of generation | **Fair** — six solid families, five knobs, level that does nothing | LU-07, 08, 16 |
| 3D interface | **Good** — clean, fast, species-legible; teaches nothing about joints | LU-20, 21, 22 |
| Engineering | **Excellent** — the pipeline and its guardrails are the best part of this product | LU-19 (one regression) |
| Structural integrity | **Good engine, poor delivery** — right answers, wrong volume, absent at the bench | LU-01, 09, 10, 11 |
| Joinery recommendations | **Good** — real setout, real teaching stack, one wrong-joint bug and no picker | LU-13, 23, 08 |
| Step-by-step build plans | **Excellent for casework, thin for frames and custom** | LU-14, 15 |

**The one-sentence version:** Blueprint Buddy's engine deserves more trust than its interface currently asks for — it should stop hiding its own good work, and it must never hand a failing design to someone holding a saw.

---

*Audit executed against `dist/index.html` built from commit `7cc8572`, headless Chromium, offline-parser path (no `ANTHROPIC_API_KEY`). Baseline suites green before and after; no source changed.*
