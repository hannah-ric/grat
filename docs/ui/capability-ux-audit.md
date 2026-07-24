# Blueprint Buddy — User Capability UX Audit

**Date:** 2026-07-24  
**Lens:** Hobby woodworker / weekend maker using the product end-to-end — not an engineering-truth re-audit.  
**Method:** Cross-read of `src/` (AI → correction → parametric → structural → plans → fasteners → UI → 3D), existing audits (`docs/audit/`, `AUDIT_REPORT.md`, DIY/UI reports), and `DESIGN.md` roadmap. No code changed.

**Related:** [`DESIGN.md`](../../DESIGN.md) · [`docs/audit/00-final-report.md`](../audit/00-final-report.md) · [`AUDIT_REPORT.md`](../../AUDIT_REPORT.md) · [`diy-audit-fix-report.md`](diy-audit-fix-report.md) · [`interaction-system.md`](interaction-system.md) · [`docs/audit/07-backlog.md`](../audit/07-backlog.md)

---

## 1. Verdict

The pipeline moat is real: a sentence can become a structurally-proven, shop-ready plan that competitors cannot match as a single product. From a user seat, **template furniture (table / desk / bench / bookshelf / nightstand / cabinet) already works**; the product feels trustworthy once someone lands on a known family and stays inside it.

The gap is **expressibility and control surface**, not physics:

| User expectation | Product reality today |
|---|---|
| “Describe any piece” | Six templates + constrained custom grammar; doors / chairs / wall mounts / desk drawers are missing or refused |
| “I chose that size / wood / joint” | Code clamps, snaps, and level-gates — often correctly, sometimes silently |
| “Show me how it goes together” | Joint Inspector + playback are excellent; the main model is boxes; best assembly detail sits behind the blueprint credit |
| “I can build from this on Saturday” | Credited template plans are shop-grade; table/custom steps are thinner; fastener MEDIUM batch still open |

**Conviction (user lens):** A beginner who picks a starter nightstand and follows Plan → Build can succeed. A beginner who types “dining table with drawers and doors” will bounce off the grammar, or get a nearest-fixed form they did not ask for. Closing that gap — without letting the model write dimensions — is the highest-leverage product work left.

---

## 2. Surface audits

Each surface: what works · challenges · opportunities. Severity for challenges: **P0** blocks trust or a common ask · **P1** frequent friction · **P2** depth / delight · **P3** polish.

### 2.1 Prompt experience

**What works**

- Carpenter-English prompts map cleanly onto templates (“walnut nightstand, two drawers, beginner”).
- Wire protocol is honest: refinements are partial diffs; questions come as tappable chips; advice does not fake a commit.
- Offline parser covers the same six families when AI is unavailable — the product still designs.
- Ack reconciliation can append “Actually: …” when the model over-claims (mechanisms, wall-mount).
- Sign-in / rate-limit / monthly AI ceiling errors are not masked as offline.

**Challenges**

| ID | Pri | Challenge |
|----|-----|-----------|
| PX-1 | P0 | Marketing promise (“describe a piece”) collides with a **sign-in wall for AI** on configured hosts; anonymous users get Adjust + starters, not the headline loop. |
| PX-2 | P0 | Capability mismatch: doors, hinged lids, wall shelves, chairs, beds, and drawers-on-desk feel like furniture but are out of LIVE grammar. |
| PX-3 | P1 | Silent corrections (dimension clamps, stock snaps, shelf auto-reduce, joinery level resets) often lack chip-level disclosure; users think the AI ignored them. |
| PX-4 | P1 | Offline looks like full product but cannot do novel grammar, photo, or rich Q&A — capability cliff without a durable session-level caveat. |
| PX-5 | P1 | Part-scoped species (“make the top oak”) still applies globally; unknown species snap to red oak; budget language (“under $200”) cannot be honored (AUDIT M-17 / M-20 / M-22). |
| PX-6 | P2 | Word-number dims (“four feet”) miss normalization (`docs/audit/07-backlog` #2). |
| PX-7 | P2 | Token ceiling (1000) + two continuations: complex custom designs truncate mid-flight. |
| PX-8 | P2 | Photo path is estimate-only and needs remote AI; offline must fail honestly (already does) — users still expect tape-measure accuracy. |

**Opportunities**

- Prefer **QUESTION** replies with nearest expressible options when the ask hits a capability wall (doors / wall / chair) instead of nearest-fixed-form silence.
- Extend correction chips to stock snaps, clamp deltas, and whole-piece species scope (same pattern as grounding notes).
- Budget digest in the AI prompt (species $/bdft + current estimate) so cost intents become real wire choices — numbers still owned by packing/BOM.
- One durable “you’re on the built-in parser” banner per session when offline / no key.

---

### 2.2 Flexibility of design generation

**What works**

- Six templates cover the weekend-maker sweet spot; structure knobs (legs, aprons, shelves, back, toe-kick, drawers, runners, pulls) are rich enough for real variation.
- Novel `custom` grammar (post / rail / panel / slab / cylinder + connection graph) exists for forms that are not templates — rare among furniture tools.
- Gallery starters + share codes + photo intent give multiple on-ramps.
- Hardware doctrine is correct: AI proposes **style**; code picks counts, ratings, bores (`LIVE` / `READY` / `REFERENCE` strata).

**Challenges**

| ID | Pri | Challenge |
|----|-----|-----------|
| DF-1 | P0 | **Doors + hinges** not LIVE — cabinets feel incomplete; READY hinge math sits unused (`DESIGN.md` Tier 1 / DIY B16). |
| DF-2 | P0 | **Stretchers** not first-class — long tables look / rack under-specified relative to shop practice. |
| DF-3 | P1 | Drawers only on nightstand/cabinet — “desk with a pencil drawer” is a top ask that still fails or redirects (H-10 fixed for chip loops; expressibility gap remains). |
| DF-4 | P1 | Custom pieces: overall size is chat-only (no Adjust sliders); drawers absent; higher structural-fail risk after critique rounds. |
| DF-5 | P1 | Alias gap: coffee table, stool, console, dresser — users invent names that map poorly or land on the wrong template. |
| DF-6 | P2 | Free part gizmos / per-part chamfers correctly rejected (would break shared geometry + cut-list honesty) — but users still reach for them in the 3D view. |
| DF-7 | P2 | Scrap-first / room-fit (Tier 3) would invert today’s “design then buy” mental model — not started. |

**Opportunities**

- Ship doors/hinges + stretchers as **intent enums + parametric geometry** (READY → LIVE); do not invent dimensions in the prompt.
- Add **desk-with-drawers** (or narrow cabinet-as-desk) as a real template — highest ask/effort ratio after doors.
- Template aliases: coffee table / console / stool as constrained defaults of `table` / `bench` (same builder, different `o` + surface duty).
- Expose `Spec.scaleCustom` on the Adjust rail — code already owns scaling.
- Gallery “custom recipes” (validated chair/bed-like compositions) before inventing new physics templates.

---

### 2.3 3D interface

**What works**

- Species-true procedural grain, Blueprint Mode, explode / isolate / drawer travel, hero assemble — the piece reads as furniture, not toy CAD.
- Tier 1 interaction pass (zoom-to-cursor, flick inertia, focus framing, joint-dot pick → Inspector) makes the viewport feel alive without fake physics.
- Joint Inspector is a genuine teaching instrument (assemble slider, cutaway, real member sizes).
- Reduced motion and Flat/Wood quality tiers keep low-power devices honest.

**Challenges**

| ID | Pri | Challenge |
|----|-----|-----------|
| 3D-1 | P1 | **Main scene never shows joinery** — unit boxes + glowing dots only; education depends on Plan playback or Shop Reference. |
| 3D-2 | P1 | Pedagogical loop (play → glow → inspect) is strongest **behind the blueprint credit wall**; Design-mode 3D alone under-teaches. |
| 3D-3 | P1 | No **dimension drag handles** — viewport is still mostly output; Adjust sliders are the input (`interaction-system.md` Tier 2 flagship). |
| 3D-4 | P2 | No finish preview on materials — finish is a BOM/step fact, not a visual one (B17). |
| 3D-5 | P2 | Playback camera does not chase the active step — users re-orbit for backs / insides. |
| 3D-6 | P2 | Elevations are painter’s-order, not hidden-line — fine for overview, confusing vs shop drawings. |
| 3D-7 | P3 | Payload (Three + fonts) still the boot diet for mid phones; particles / post-FX correctly deferred. |

**Opportunities**

- Dimension handles that write **intent deltas** into the same `commit()` path as sliders (founding rule preserved).
- Finish material classes (oil / film / hardwax) as visual only — numbers stay in finish schedule.
- Free “sample assembly step” in Design mode (one joint glow + Inspect) without unlocking the full cut list.
- Cut-face tint and playback camera drift inside Joint Inspector / Build only — keep memory contracts on shared unit boxes.
- Room-fit ghost box (Tier 3) as the “will it fit” visual, not a second CAD app.

---

### 2.4 Engineering (pipeline honesty)

**What works**

- Founding rule is load-bearing and enforced: wire intent → `correctSpec` → build → validate → structural → plans → packing. Golden corpus + handcalc + audit tests lock the math.
- Digests are generated from `knowledge.js` and self-tested — the model cannot invent species constants.
- Stock snaps, joinery allowances, and packing offcuts are code-owned; exports carry real millimetre geometry.
- CRITICAL/HIGH carpenter-audit defects (screw length, shelf/pin conflict, pull screws, stepNote attachment, thicknessing step) are fixed and regression-locked.

**Challenges**

| ID | Pri | Challenge |
|----|-----|-----------|
| EN-1 | P1 | Inherent honesty gap: engine judges **clear stock the user should buy**, not the board they pick (`00-final-report`). |
| EN-2 | P1 | Fastener **MEDIUM** batch still open — pilots as shop fractions, species-scaled pilots, clearance+countersink phrasing, pocket fine/coarse (AUDIT Batch A). |
| EN-3 | P2 | Dual fastener catalogs (`K.FASTENERS` vs engine CATALOG) risk drift (`07-backlog` #7). |
| EN-4 | P2 | Long-span sag fixes lack “add center divider” (`07-backlog` #4). |
| EN-5 | P3 | Liability / design-basis human sign-off still a launch item — product copy must stay within disclosed caveats. |

**Opportunities**

- Finish Batch A/B (fastener + instruction completeness) — highest remaining bench-trust ROI per line of code.
- Surface “this plan assumes clear kiln-dried stock” once in Overview/Safety, not buried in footnotes.
- One-tap sag fixes that add geometry (divider) the same way thicken/species already do.

---

### 2.5 Structural integrity

**What works**

- Four-tier rollup: `fail` > `anchor` > `advisory` > `pass` — F2057 tip-over is no longer undersold as a soft note.
- Overview stamp + plain-English sentence; Safety tab puts fails/anchor above the fold; beginners get a summary with engineering behind `<details>`.
- One-tap integrity fixes merge patches and show diffs — rare and valuable.
- Chat integrity line names worst sag / assumed loads / anchor need after commits.
- Verdicts ship as capsules with text, never color alone.

**Challenges**

| ID | Pri | Challenge |
|----|-----|-----------|
| SI-1 | P1 | Beginner fail cards can use a **generic** plain line instead of the check’s specific `explain` until details expand. |
| SI-2 | P1 | Assumed load presets are editable but easy to miss — users may dispute a FAIL without seeing the BIFMA basis. |
| SI-3 | P2 | No 3D highlight of the failing member — integrity and selection are disconnected. |
| SI-4 | P2 | Custom designs can commit with structural FAILs after critique rounds (“honest report”) — correct policy, confusing if the user expected “validated = safe to build.” |
| SI-5 | P3 | Absurd margin precision (“34787.3×”) still erodes credibility (AUDIT L-10). |

**Opportunities**

- Beginner cards always quote the check’s concrete `explain` + member name.
- Clicking a Safety check focuses / ghosts the responsible parts in the viewport.
- Custom FAIL path: hard gate “Issue blueprint” until fixed or user acknowledges “build at your own risk” — keep free exploration, protect paid artifact.
- Cap displayed margins (`>1000×`); friendlier stamp subtitle for advisory (“PASS · notes”).

---

### 2.6 Joinery recommendations

**What works**

- Skill-level matrix really changes joints (beginner pocket/butt → advanced M&T / half-blind DT).
- Assembly “Why this joint?” + Shop Reference + Joint Inspector form a coherent teaching stack.
- Fastener setout is mate-aware; BOM counts are required to match drilling notes (audit-locked).
- Integrity can recommend joint upgrades on racking (dados / M&T / pocket) as tappable fixes.
- Shaker benchmark: tenons/setout EQUIVALENT or OURS-BETTER vs published canon.

**Challenges**

| ID | Pri | Challenge |
|----|-----|-----------|
| JR-1 | P1 | **No joinery picker in Adjust** — changing joints is chat- or skill-driven; lowering skill silently snaps illegal joints. |
| JR-2 | P1 | Only the first joint on a step gets “Why this joint?” / Inspect — multi-joint steps under-explain. |
| JR-3 | P2 | Main model does not visualize joints (see 3D-1); Inspector tenon illustration can overstate vs mate-aware allowance (L-07). |
| JR-4 | P2 | Hardware teaching (cup hinges) ahead of LIVE doors — users can learn what they cannot yet put on a piece. |
| JR-5 | P2 | Parked product call: merge “Why this joint?” + “Learn why” (overhaul C-16). |
| JR-6 | P3 | Leg taper + 35 mm snap vs traditional Shaker legs still open (`07-backlog` #5). |

**Opportunities**

- Adjust-rail joinery slots (`frame` / `case` / `box`) filtered by `jointAllowed(level)` — intent only; allowances stay in plans/fasteners.
- Announce level snaps in chips (“Dovetails need Advanced — switched to locking rabbet”).
- Multi-joint chips per assembly step; optional explode-to-joint framing for the active joint.
- Defer Shop Reference demos for READY-only hardware behind a “coming to designs” badge — or ship doors first.

---

### 2.7 Step-by-step build plans

**What works**

- Template assembly quality is high for casework/drawers: milling → dry-fit order → thicknessing when stock > part T → setout → anti-tip step → finish schedule.
- Cut list carries joinery allowances with provenance; packing produces real shopping boards; tool wall + bench-time estimates are derived from operations.
- Build mode: wake lock, phone pager, board diagrams with zoom, checklist persistence — shop-phone P0s fixed.
- Issued blueprint (10 sheets + 1:1 templates) is the defensible unit of sale; soft client wall is an accepted commercial posture.

**Challenges**

| ID | Pri | Challenge |
|----|-----|-----------|
| BP-1 | P0 | Soft wall locks Cut / Stock / Assembly detail — users cannot rehearse the best UX before paying; locked assembly shows **titles only**. |
| BP-2 | P1 | Table/bench assembly is ~3 high-level steps vs drawer granularity — frame clamp order under-specified. |
| BP-3 | P1 | Custom connection-walk steps are thin (“Fix A to B with X”) — less square/clamp guidance. |
| BP-4 | P1 | Instruction completeness Batch B still open: measured-ply groove caveat, slotted-hole on the screw step, pre-finish interiors, dry-fit-before-glue on templates, tool-list honesty. |
| BP-5 | P2 | First-build guided path is only a light coach message — not a tour (DESIGN Tier 4 / DIY N7). |
| BP-6 | P2 | No service worker — hard offline at the bench depends on HTTP cache. |
| BP-7 | P3 | Physical-device verification of phone Build still a human launch checklist item. |

**Opportunities**

- Unlock **one sample assembly step** (with setout + Inspect) for free — sell the blueprint without giving away the full cut list.
- Raise table/frame and custom step density toward drawer quality (clamp order, square checks, glue-up windows).
- Finish AUDIT Batch B before adding new template families that emit more steps.
- First-build path: pick one starter → locked checklist of “look at Safety → issue or preview sample step → cut → assemble” without new geometry.

---

## 3. Challenge catalogue (rollup)

Grouped by user impact. IDs cross-reference §2.

### Trust blockers (fix or disclose before growth bets)

| ID | Area | One-line |
|----|------|----------|
| PX-2 / DF-1 / DF-2 | Prompt / Flexibility | Doors, stretchers, and several common furniture nouns are outside LIVE geometry |
| BP-1 | Build plans | Best buildability UX is credit-gated with titles-only preview |
| EN-2 / BP-4 | Engineering / Plans | Remaining fastener + instruction MEDIUM defects still touch the bench |
| PX-3 / JR-1 | Prompt / Joinery | Silent snaps (stock, level, species scope) without durable disclosure |

### Frequent friction

| ID | Area | One-line |
|----|------|----------|
| PX-1 | Prompt | Sign-in wall vs “describe a piece” marketing |
| DF-3 / DF-4 | Flexibility | Desk drawers missing; custom = chat-only sizing |
| 3D-1 / 3D-2 / JR-2 | 3D / Joinery | Joinery teaching disconnected from the free Design viewport |
| SI-1 / SI-2 | Integrity | Beginner fail copy + load basis too easy to miss |
| PX-4 / PX-5 | Prompt | Offline cliff; species/budget intents under-served |

### Depth & differentiation (after trust)

| ID | Area | One-line |
|----|------|----------|
| 3D-3 / 3D-4 | 3D | Dimension handles + finish preview (Living Workshop Tier 2) |
| DF-7 | Flexibility | Scrap-first, room-fit, QR share (DESIGN Tier 3) |
| BP-5 | Build plans | Real first-build guided path (Tier 4) |
| EN-4 / SI-3 | Engineering / Integrity | Smarter sag fixes + 3D integrity highlighting |
| 3D-7 | 3D | Payload diet for mid-phone boot |

### Explicitly out of scope (do not re-litigate)

- Physics engines, post-processing bloom, confetti on PASS, free rotation gizmos on shared unit boxes (`interaction-system.md`).
- Moving computation into prompts or letting model output write dimensions into state.
- Hard secrecy of client-side plan numbers — the product is the **issued artifact** (`DESIGN.md`).

---

## 4. Opportunity catalogue (by leverage)

| Rank | Opportunity | Surfaces helped | Constraint preserved |
|------|-------------|-----------------|----------------------|
| 1 | Doors + hinges + stretchers (READY → LIVE) | Prompt, Flexibility, Joinery, Plans, 3D | Style intent → HW selection rules |
| 2 | AUDIT Batches A + B (fastener + instruction completeness) | Engineering, Joinery, Build plans | Code-owned setout |
| 3 | Disclosure chips for snaps / level / species scope + capability QUESTION replies | Prompt | Correction still owns numbers |
| 4 | Desk-with-drawers template + coffee/console/stool aliases | Prompt, Flexibility | Same builders, new defaults |
| 5 | Free sample assembly step + Inspect in Design | 3D, Joinery, Build plans, commercial | Cut/Stock stay gated |
| 6 | Adjust-rail joinery slots + custom overall scale | Flexibility, Joinery | `jointAllowed` + `scaleCustom` |
| 7 | Integrity → 3D part focus + concrete beginner explains | Integrity, 3D | Same structural engine |
| 8 | Finish preview + dimension handles | 3D | Visual / intent-only |
| 9 | Long-span divider fix + back-into-shelf fastening | Engineering, Integrity, Plans | Parametric + BOM |
| 10 | Scrap-first / room-fit / QR / first-build path | Flexibility, 3D, Plans | Each needs its own design pass |

---

## 5. Improvement plan

Phased so each phase leaves the product more trustworthy than before. Aligns with `DESIGN.md` tiers and open audit batches; does not invent calendar estimates — scope is described by subsystem invasiveness.

### Phase A — Bench trust (low invasiveness, high shop impact)

**Goal:** A credited plan is harder to misuse at the saw.

1. Execute **AUDIT Batch A** (fastener bench-usability): shop-fraction pilots, species-scaled pilots, clearance+countersink, pocket fine/coarse, figure-8 recess, spacing n=2.
2. Execute **AUDIT Batch B** (instruction completeness): measured-ply groove caveat, slotted holes on the screw step, pre-finish interiors, dry-fit-before-glue on templates, honest tool/abrasives list.
3. Cap absurd integrity margins; beginner fail cards use specific `explain`.
4. Announce stock snaps / level joint resets / whole-piece species scope in chat chips.

**Exit criteria:** New `FE-*` audit sections green; no golden refreeze except intentional setout diffs; smoke green.

### Phase B — Say what you can build (prompt + expressibility)

**Goal:** Common asks either succeed or get an honest nearest path.

1. Capability QUESTION protocol for doors / wall-mount / chair / bed / desk-drawer until geometry ships.
2. Durable offline / no-key session banner (once per session).
3. Template aliases: coffee table, console, stool (defaults only).
4. Desk-with-drawers template (or documented “use a shallow cabinet”) — pick one and ship.
5. Word-number dimension parsing (`07-backlog` #2).
6. Budget digest line for cost-aware intents (M-22).

**Exit criteria:** Battery fixtures for refusal → question paths; offline banner smoke; alias golden optional.

### Phase C — Shop-truth geometry (DESIGN Tier 1)

**Goal:** Cabinets and long tables match what users think they asked for.

1. **Stretchers** as first-class bracing on table-like templates (geometry + racking credit + steps).
2. **Doors + hinges**: overlay/inset, euro vs butt; mint wire style enums; promote HW READY → LIVE; BOM + assembly + Joint Inspector wired to real parts.
3. Finish preview on 3D materials (visual classes only).
4. Adjust-rail joinery triad filtered by skill level.

**Exit criteria:** New goldens for door cabinet + stretcher table; handcalc untouched unless physics changes; hardware selftests for counts/bores; smoke + porch if landing copy changes.

### Phase D — Teach in the free loop (3D + integrity UX)

**Goal:** Design mode teaches joinery and strength without issuing a blueprint.

1. Free sample assembly step (setout + joint glow + Inspect) while Cut/Stock stay locked.
2. Safety check → viewport focus/ghost of responsible parts.
3. Playback camera drift to active step (Build + sample step).
4. Multi-joint chips on assembly steps; align Inspector tenon with mate-aware allowance.
5. Custom overall-scale on Adjust via `scaleCustom`.

**Exit criteria:** Plan-lock tests still protect Cut/Stock; sample step available unsigned-in where Adjust is; integrity↔selection smoke.

### Phase E — Living Workshop Tier 2 + audit leftovers

**Goal:** Viewport becomes an input; remaining S4 cleanup.

1. Dimension drag handles → same commit path as inspector.
2. Cut-face tint in Joint Inspector; optional theme light cross-fade.
3. Long-span center-divider fix; back-into-shelf fastening; drawer-bottom step-up fix (`07-backlog` #4, #6, #8).
4. Fastener catalog unification; `SHEET_FRACTIONS` consolidate; openings rename.
5. Payload subsetting (fonts / Three) once shop features stay green on phone.

### Phase F — New use cases (DESIGN Tier 3–4)

**Goal:** Differentiate beyond “AI furniture CAD.”

1. Room-fit ghost + clearance advisories.
2. QR share of existing `BB4:` codes.
3. Scrap-first (“shop the offcuts”) — invert packing constraints (dedicated design pass).
4. First-build guided path + deeper Inspector how-tos + glossary from advisories.
5. Project journal / maker’s card — last; depends on Build-mode photo notes.

Each Tier 3 item is its own brief; do not bundle.

---

## 6. Suggested sequencing (implementation order)

```
A  Bench trust (Batches A/B + disclosure chips)
B  Honest prompt boundaries + aliases + desk drawers
C  Stretchers → doors/hinges → finish preview → joinery Adjust
D  Free sample step + integrity↔3D + custom scale
E  Dimension handles + S4 cleanup + payload
F  Room-fit / QR → scrap-first → first-build path
```

**Dependency notes**

- Do not start Living Workshop particles / Tier 3 scrap-first until Phases A–C stay green on phone Build.
- Doors (C) unblock honest Shop Reference for cup hinges (JR-4) and cabinet marketing claims (PX-2).
- Sample step (D) is the commercial bridge for BP-1 without abandoning the issued-artifact posture.
- Phase A can ship in parallel with early Phase B copy/protocol work — different files, low merge risk.

---

## 7. Scorecard (user perspective, today)

| Surface | Desktop | Phone | Notes |
|---------|---------|-------|-------|
| Prompt experience | Good inside templates | Fair | Auth + capability cliffs dominate |
| Design flexibility | Good (6 families) | Good | Doors/stretchers/desk drawers missing |
| 3D interface | Excellent as showroom | Good | Weak as editor / joinery teacher |
| Engineering honesty | Excellent | Excellent | MEDIUM fastener/instruction batch remains |
| Structural integrity | Excellent | Good | Beginner copy + 3D link still thin |
| Joinery recommendations | Excellent in Plan | Fair | No Adjust control; scene doesn’t show joints |
| Step-by-step build plans | Excellent when credited | Good (post DIY fix) | Titles-only preview; table/custom thinner |

**Overall:** Shop-signoff core with a **grammar and control-surface** product problem. Improve by shipping geometry users already ask for, disclosing every correction, finishing bench-instruction MEDIUMs, and teaching joinery/strength in the free Design loop — without ever letting the model own a number.

---

## 8. Non-goals for this plan

- Replacing the soft plan wall with fake “unlimited free full plans.”
- General-purpose CAD (freeform solids, NURBS, CNC toolpaths).
- Per-part decorative modeling that breaks shared geometries or cut-list honesty.
- Re-opening rejected interaction toys (physics sim, post-FX, confetti on verdicts).
