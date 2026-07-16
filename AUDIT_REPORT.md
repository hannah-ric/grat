# Blueprint Buddy — Front-End Audit (Master Carpenter Review)

**Date:** 2026-07-16 · **Auditor lens:** 30-year professional furniture maker reading every screen the way an apprentice's build gets inspected — joint by joint.
**Method:** Full static read of `src/` (plans, fasteners, parametric, knowledge, hardware, units, spec, ai, codec, ui, exports, drafting, packing, provenance, structural) cross-checked against the six frozen golden fixtures in `test/golden/`, plus a live click-through of the built app (`node serve.js`, headless Chromium at 1440×900 and 390×844, no `ANTHROPIC_API_KEY` → offline parser path): welcome → starters → chat probes → every Plan tab → units/dual toggles → exports (CSV/SVG/JSON/.rb downloaded and inspected) → Build mode desktop + phone → integrity details → runner/undermount switches → reload. Baseline `npm run build && npm test` green before auditing. Evidence excerpts quote rendered text verbatim. **No code was changed.**

---

## 1. Executive summary

Blueprint Buddy's engineering core is genuinely trustworthy — species data matches the Wood Handbook, nominal→actual lumber tables are right, units flow through one display boundary, the CSV opens clean, level gating really changes joinery, and the anti-tip pipeline (BOM line + step + safety note) all fire together. The failures cluster one layer up, where **the fastener/step engine meets the bench**: fixed screw lengths that exit a cabinet's show face, a shelf cut 12 mm too long for the pins the step says to set it on, pulls whose machine screws are ~12 mm too short to install, step notes that teach the *wrong joint* in the wrong step, and a stock plan that buys 1-in stock for 13/16-in parts without ever saying "plane it." The offline chat will also cheerfully switch your build **to** the wood you just refused ("no ash please" → *Adjusted White Ash*).

**Counts: 2 CRITICAL · 11 HIGH · 22 MEDIUM · 14 LOW (49 findings).**

> **Remediation status (2026-07-16, same branch):** every CRITICAL and HIGH finding is **FIXED** and regression-locked in `test/audit.test.js` sections `FE-C1`, `FE-C2`, `FE-H1`, `FE-H5`, `FE-H6`, `FE-H7`, `FE-H8`, `FE-H9`, `FE-H10/H11` — written failing-first per the repo protocol, verified in the live app, goldens refrozen deliberately (pin lines removed; bookshelf top on case screws; `thickness` step added to four designs). H-08 was corrected against the published Blum-class rule (inside width = opening − 42 mm — subtly different from the report's original outside-width guess). MEDIUM/LOW work is planned in §7.

**Three worst:** ① C-01 cabinet shelf carries a dado allowance but the step installs it on pins — it physically cannot fit its opening; ② C-02 `#8 × 50` runner screws blow 13 mm out through a cabinet's finished side (and only bite 6 mm on a nightstand); ③ H-05 drawer-pull screws are sized for the false front only and cannot reach the pull through the box front behind it.

---

## 2. Findings table

Severity: **CRITICAL** wrong/unsafe build · **HIGH** blocks or badly confuses a builder · **MEDIUM** erodes trust/clarity · **LOW** polish.
All line numbers are from the audited commit (`9a23bb4`). "Live" = reproduced in the running app.

| ID | Sev | Domain | Where | Finding (evidence) | One-line fix |
|----|-----|--------|-------|--------------------|--------------|
| C-01 | CRITICAL | Instructions/Materials | `src/parametric.js:508-511`, `src/plans.js:488-490`, `src/plans.js:252-256` | Cabinet shelf is modeled with `case` (dado) joints so its cut length includes a 12 mm dado allowance (golden: Shelf `L 738` in a 726 mm opening, note "includes 1/2 in for dado / housing"), but step s6 says "Drill the 32 mm system for the pins… Set the shelves on their pins" and the BOM buys "5 mm shelf pins qty 4" — a pin-set shelf 12 mm longer than the space between the sides | Pick one shelf system: pins (drop the case-joint allowance, cut shelf to opening − clearance) or dados (glue in at carcass glue-up, delete the pin BOM line) |
| C-02 | CRITICAL | Hardware | `src/fasteners.js:70,112`, `src/parametric.js:246-261` | Frame-to-frame butt joints under 400 mm run always get `#8 × {50} wood screw`; screw length is never bounded by member+mate thickness. Cabinet wood runner (`runW = 19`) into an 18 mm sheet side → tip exits the exterior show face by ~13 mm; nightstand runner (`runW = 44`, live) into a 20 mm apron → only ~6 mm of bite. Live step: "3 × #8 × 1 15/16 in wood screw through drawer 1 runner into side apron" | Add a screw-length ladder and pick the longest with `len ≤ memberT + mateT − 3` |
| H-01 | HIGH | Instructions/Hardware | `src/fasteners.js:97-108`, `src/plans.js:477` | `isTopAttach` includes `b.role === 'side'`, so a bookshelf top *captured between the sides* is treated as a floating tabletop: BOM gets "Figure-8 fasteners + #8 × 16 mm qty 4" (golden + live) while step s1 says "Fasten the top and bottom between the sides with butt joints with screws"; no step ever installs figure-8s, and the top's real screws are missing from the BOM | Gate `isTopAttach` to overhanging tops (`b.role` in `['apron','rail']` only) |
| H-02 | HIGH | Tools/Hardware | `src/plans.js:252-256` vs `src/parametric.js:361-363`, `:506-511` | "5 mm shelf pins, 4 per adjustable shelf" is bought whenever a bookshelf/cabinet has shelves — but every template shelf is *joined* to the sides (`spec.joinery.case`: butt-screwed or dadoed fixed). Live bookshelf: 16 pins in BOM, shelves butt-screwed in s2, no drilling step anywhere | Buy pins only for genuinely adjustable shelves, and pair them with a drilling step |
| H-03 | HIGH | Instructions | `src/plans.js:481-484` | Advanced cabinet: s1 glues the carcass (bottom between sides), then s2 says "Join each rail into the sides with mortise & tenon joints" — with the sides already fixed 726 mm apart you cannot seat 12 mm tenons on both ends of a 750 mm rail (golden step order `s1, s2`; rail note "includes 15/16 in for mortise & tenon") | Merge carcass + rails into one dry-fit-then-glue clamp-up when frame joinery is M&T |
| H-04 | HIGH | Instructions | `src/plans.js:481-490` | Cabinet shelf-pin rows are drilled at s6 — *after* the back (s3) and top (s5) are on: "rows of 5 mm holes, 9 mm deep, at 32 mm pitch" inside a closed box, where the top physically blocks the upper holes | Emit the pin-drilling step on the flat side panels before carcass assembly |
| H-05 | HIGH | Hardware | `src/hardware.js:558`, `src/plans.js:350-352`, `src/plans.js:244` | Pull screws are `pullScrewLenMM = frontT + 6` and mounted "from inside" *after* the front is screwed to the box — the M4 must cross box front (12 mm) + false front (19 mm) ≈ 31 mm before engaging the pull; the spec'd M4 × 25 ("M4 screws, length = front + 1/4 in", live BOM "M4 × 1 in") is ~12 mm short | Size pull screws `boxFrontT + frontT + 6` (or bore/mount the pull before hanging the front) |
| H-06 | HIGH | Instructions | `src/plans.js:513-521`, `src/fasteners.js:313-325` | Step fastening notes attach the setout of *any* joint touching the step's parts, deduped by type-first-seen: live "Drawer 1: mount the slides … — 2 × 5/16 in dowels on the joint centerline… 5/16 in bit" (rail dowels in a slide step); bookshelf "Join the case … — 3 × #8 … through **shelf** into side" (shelf screws in the top/bottom step, while the top's figure-8 note appears nowhere); "hang the box"/"attach the front" re-teach the locking rabbet | Filter `stepNote` to joints *introduced by that step* (e.g. joints whose both parts are in `partIds` and not yet assembled) |
| H-07 | HIGH | Hardware/Tools | `src/fasteners.js:72,118-122` vs `src/knowledge.js:514-516` | Pocket catalog has only `{32} coarse pocket screw` while the step prints "jig set for `memberT` stock" — on 38 mm stock that reads "jig set for 1 1/2 in stock, 1 1/4 in pocket screws", which physically cannot join it; `knowledge.js` itself documents `pocket_63` ("The 32 mm pocket screw physically cannot join 38 mm stock") but the engine can never emit it | Add `pocket_63` to the fasteners CATALOG and select by `memberT >= 32` |
| H-08 | HIGH | Hardware | `src/parametric.js:131`, `src/hardware.js:201`, `src/plans.js:319` | Undermount drawer boxes are built to `width = opening − 27` (live: box 351 in a 378 opening; step: "width = opening − 1 1/16 in … press the locking clips on") — the industry-standard undermount pattern (Blum TANDEM / Hettich Quadro / Grass Dynapro class, which "locking clips" implies) is **opening − 42 mm**; a box built to −27 is ~15 mm too wide for that hardware | Confirm the target slide line; if Blum-class, set `widthTotal: 42` (and re-check `bottomT`) then refreeze goldens/selftest |
| H-09 | HIGH | Materials/Instructions | `src/plans.js:442-450`, `:535-554` (live Stock+Assembly) | The optimizer buys 5/4 stock (25 mm actual) for 20 mm parts (nightstand aprons/rails: cut list "13/16 in") and the glue-up step says only "rip and crosscut to L × W" — no thicknessing operation exists anywhere in dimensional mode and no planer is in the 18-item tool list; the builder's parts come out 1 in thick against 13/16-in plans | When purchased thickness > part thickness, emit a "plane/resaw to T" step and add the planer to the tool list |
| H-10 | HIGH | AI | `src/spec.js:446-459`, `src/ai.js:53`, `src/ai.js:276-282` | Drawers are impossible outside nightstand/cabinet: `correctSpec` silently does `s.drawers = null` and the system prompt says drawers "exist only on nightstand and cabinet templates" — a desk with a pencil drawer or a dresser can't be expressed; live on the seed **table**, "add a drawer" is honestly refused, but the refusal's own suggestion chips include **"Add a drawer"** (`ai.js:280`), a loop that can never succeed | Support drawers on `desk` (or surface a "drawers not supported on this template" advisory) and filter suggestion chips by template |
| H-11 | HIGH | AI | `src/ai.js:172-187` | Offline parser has no negation guard: live "**no ash please**" → "Adjusted White Ash. CHANGED species Red Oak → White Ash" — the build switches *to* the refused wood; same for "not oak", "without walnut" | Bail out of species matching when a negation token (`no|not|without|avoid|don't`) precedes the match; fall through to the clarify question |
| M-01 | MEDIUM | Instructions | `src/fasteners.js:94,106,115,122` | Pilot/bore callouts render as decimal inches — live: "Pilot 0.13 in", "Bore 2 × 0.2 in through-holes", "centered 0.89 in from the joint line" — no imperial drill index has a 0.13 bit, and screw positions are tape measurements that need fractions (`fmtSmall` is meant for sag/kerf, not drill sizes) | Render pilots as the nearest real bit ("1/8 in") and positions via `fmtLength` fractions |
| M-02 | MEDIUM | Hardware | `src/fasteners.js:72` | Pocket screws are always **coarse** thread; the whole species catalog is hardwood, where fine thread is the rule (coarse splits pocket walls in oak/maple) | Select coarse vs fine by species (janka/sheet) |
| M-03 | MEDIUM | Hardware | `src/fasteners.js:70-74` | Pilot diameters are fixed per screw, not species-scaled — a #8 gets the same 2.8 mm pilot in 380-janka pine and 1880-janka hickory, despite `janka` sitting unused in the same knowledge base | Scale pilot from the receiving species' hardness |
| M-04 | MEDIUM | Instructions | `src/fasteners.js:115,292` | Screw setouts say only "Pilot X" — never a clearance/shank hole in the near member nor a countersink, so the joint won't draw tight and flatheads won't seat ("Countersink bit" is in the tool list but no step uses it) | Emit "clearance Ø in A, pilot Ø in B, countersink" for screw joints |
| M-05 | MEDIUM | Instructions/Tools | `src/fasteners.js:101-107` | Figure-8 fasteners get no recess/mortise instruction (they must be let into the apron's top edge) and no Forstner bit in tools; the note also counts only the first joint ("2 figure-8 fasteners" live, while the BOM correctly has 4) | Add the recess instruction + Forstner to tools; sum fasteners across the step's joints |
| M-06 | MEDIUM | Materials | `src/plans.js:304,308` | Drawer-bottom steps say "Cut a 1/4 in groove … slide in the 1/4 in bottom" with no measured-thickness caveat — nominal 6 mm/1/4-in ply is ~5.2 mm actual, so the groove rattles; the engine's own dado text (`fasteners.js:151`) *does* carry "cut to the MEASURED thickness … not nominal" | Add the same caveat to the groove step |
| M-07 | MEDIUM | Instructions | `src/fasteners.js:151` | The dado setout hardcodes "…of the **shelf**" — live it appears inside drawer-box steps: "Dado 1/2 in wide × 3/16 in deep … cut to the MEASURED thickness of the shelf" while the housed part is the box back | Use `b.name`/`a.name` instead of the literal "shelf" |
| M-08 | MEDIUM | Instructions | `src/plans.js:496` vs live Safety tab | The movement advisory demands "elongate the screw holes across the grain (slot, don't just drill) … or it will split" for the captured lower shelf, but the shelf step says only "Notch the shelf around the legs and fasten it" — the slotting requirement never reaches the step where the screw is driven | Append the slotted-hole instruction to the affected step when the advisory fires |
| M-09 | MEDIUM | Instructions | `src/plans.js:509-511` | Sanding + finishing are always the final two steps; cases with backs and drawer banks (bookshelf, cabinet, nightstand) never get "pre-finish interior faces/shelves/drawer boxes before closing the case" — standard practice once interiors become unreachable | Insert a pre-finish step for designs with backs/drawers |
| M-10 | MEDIUM | Instructions | `src/plans.js:477-502` vs `:473` | Template assembly paths (table/bookshelf/cabinet/nightstand) have no dry-fit instruction before glue-up; the custom path explicitly says "Dry-fit before glue." | Add "dry-fit and check square before glue" to case/frame steps |
| M-11 | MEDIUM | Tools | `src/plans.js:535-554` | Tool list is dishonest about consumables: fixed "Sandpaper (120 / 180 / 220 grit)" vs the actual schedules (hardwax wants 150, live sanding step "120 → 150 → 180"; film finishes need the 320 between-coat pad the finishing step demands); the cabinet pin step needs a 5 mm brad-point + depth stop that's never listed; and joint tools duplicate ("Table saw or router table" + "Router or table saw", "Drill" + "Drill/driver", "Clamps" + "Bar or pipe clamps") | Build the abrasives line from `fin.prep`, add operation-driven bits, dedupe by canonical tool key |
| M-12 | MEDIUM | Materials | `src/ui.js:1051-1057` | Shop Reference "Wood" table renders sheet goods in the same grid as solid lumber with a Janka ("MDF 700 lbf") and a seasonal-movement coefficient column, unmarked — the exact species-vs-sheet-goods conflation the engine itself scrupulously avoids | Badge `sheet: true` rows and dash Janka/movement cells for them |
| M-13 | MEDIUM | 3D/Materials | `src/provenance.js:122` | Species-comparison weight skips only `role === 'pull'`, not `hardware` — steel slides are weighed as solid blocks of the compared wood (violates the "hardware never enters mass" doctrine at `parametric.js:207-213`; primary mass in `structural.js:569` gets it right) | `if (p.role === 'pull' \|\| p.hardware) continue;` |
| M-14 | MEDIUM | UI | `src/ui.js:171-179` | Autosave sets "saving…" then `doAutosave` returns early when a free user is over the project cap — the label sticks on "saving…" forever and the work is silently not saved (reload reverts) | On gate-block, show an explicit "not saved — export a share code" state |
| M-15 | MEDIUM | UI/Copy | `src/ui.js:2608` | `welcomeResumeName` ternary has identical branches (`hasProjects ? 'Open a saved design' : 'Open a saved design'`) while the handler opens *paste-a-share-code* when no projects exist — the card's title lies about its action on first run | No-projects branch should read "Import a design" |
| M-16 | MEDIUM | A11y | `src/ui.js:2154-2165` (`index.template.html:22`), `index.template.html:207-210` | Diagnostics opens only by pointer long-press on a `<div>` (no `tabindex`/`role`/key handler) — keyboard/AT users can never reach it; camera preset buttons announce as bare letters "F/S/T" | Make the logo a button with Enter/Space; add `aria-label="Front elevation"` etc. |
| M-17 | MEDIUM | AI | `src/ai.js:172-187` | Part-scoped species requests are applied globally without saying so: live "make the **top** oak instead of walnut" → "Adjusted oak. CHANGED species Black Walnut → Red Oak" — the whole piece (legs, aprons, fronts) went oak, and the ack never mentions the widened scope | Say "species applies to the whole piece" in the ack (or scope per-part via custom materials) |
| M-18 | MEDIUM | Integrity/Copy | live Safety tab (`structural.js` F2057 + `ui.js` rollup) | A design that fails F2057 ("margin 0.62× … this piece TIPS") rolls up as **ADVISORY** under the headline "This design passes the required strength checks, with notes worth reading below" — the check copy is excellent, but the rollup undersells a tip-over hazard that regulators treat as a recall matter | Give anchor-mandatory tipping its own rollup tier/wording ("safe only when anchored") |
| M-19 | MEDIUM | Hardware | `src/plans.js:225` (`knowledge.js:512`) | "M4 × 5/8 in (16 mm) pan-head" slide screws, 8 per drawer, driven through ~1.5 mm of slide into 12 mm Baltic drawer sides → tip pokes ~2 mm into the drawer interior | Spec M4 × 10/12 for the drawer member (same length-vs-thickness bound as C-02) |
| M-20 | MEDIUM | AI/Materials | `src/spec.js:408` | Any unknown or sheet species proposed as the solid wood silently snaps to `red_oak` — a request for wenge/purpleheart becomes red oak with no in-chat notice (contrast the honest pull-substitution note) | Surface a substitution note when the species snaps |
| M-21 | MEDIUM | Hardware | `src/fasteners.js:56-67` | `positions()` violates its own `minSpacingMM: 32` at n=2: joint runs of ~41-72 mm return two fasteners 1-32 mm apart (the while-loop only drops fasteners when `n > 2`) | At n=2 under min spacing, return one centered fastener |
| M-22 | MEDIUM | AI | `src/knowledge.js:818` (digest) | The prompt sends species cost only as `$`-dots; real $/bd ft and the user's edited price table never reach the model, so "keep it under $200" / "cheapest wood that won't sag" can't be honored except by luck | Add a one-line budget digest (species $/bdft + current estimated total) |
| L-01 | LOW | Materials | `src/fasteners.js:264,272-273` | French cleat specifies 19 mm ply — the app's own sheet standard for 3/4-in ply is 18 mm (`SHEET_THICKNESS [6,12,18]`); "19 mm ply" isn't a stockable sheet | Change to 18 / `K.SHEET_THICKNESS[2]` |
| L-02 | LOW | Units | `src/jointview.js:60`, `src/joinery3d.js:163` | Fallback formatters build raw `' mm'` strings — the project's own units.js header calls that a bug; real callers pass `fmtLength`, so it's latent | Default to `BB.Units.fmtLength` |
| L-03 | LOW | Materials | `src/knowledge.js:98,232,245` | Sheet species carry `pricePerBdFt` (plywood priced in board feet at the data level) — unused (defaults exclude sheets) but misleading | Remove the field from `sheet: true` rows |
| L-04 | LOW | Materials | `src/knowledge.js:31,39` | red_oak `movement:'high'` (ct 0.00369) vs white_oak `'medium'` (ct 0.00365) — category and coefficient can disagree in advisories | Derive the category from ct thresholds |
| L-05 | LOW | Materials | `src/structural.js:454` | Stiffness upsell hardcodes Hard Maple though hickory/yellow birch/Douglas-fir are stiffer (some cheaper) | Pick the stiffest qualifying species from the table |
| L-06 | LOW | Exports | `src/exports.js:283,409` | CSV has no UTF-8 BOM — a non-ASCII custom part name (or the `—` fallback) mojibakes in Excel's default import | Prepend `'﻿'` |
| L-07 | LOW | 3D | `src/joinery3d.js:228` | Joint-inspector tenon is drawn/labelled at a fixed 30 mm while the cut list's allowance is mate-aware (`min(30, mateT−6)`) — the close-up can overstate the real tenon | Cap illustrated depth by the same rule |
| L-08 | LOW | UI | live Stock tab / `src/exports.js:310-311`, `src/packing.js:250-256` | Diagram part labels truncate ("Top (strip", "Drawer box fro"); board numbers don't cross-reference shopping-list rows | Ellipsize with title tooltips; tag boards with their shopping row |
| L-09 | LOW | Copy | `src/plans.js:391`, `src/fasteners.js:115`, `src/ai.js:283` | "Several rips finish under…" fires even when one part matches; n=1 renders "1 × screw … first 13/16 in from each end"; runner change acks as "Adjusted ." with an empty label (live) | Count-aware copy; guard the n=1 template; skip empty notes |
| L-10 | LOW | Integrity/Copy | live Safety tab | "margin 34787.3×" — absurd precision erodes the credibility the panel otherwise earns | Cap displayed margins (">1000×") |
| L-11 | LOW | UI | `src/ui.js:2752`, `:491-513`, `index.template.html:138` | Dead `doExport('share')` branch; `ensureDiagramScrim` rebuild path unreachable (template ships the markup); static chat placeholder overwritten on boot; `buildModeBtn` breaks the `mode-*` id pattern; panel scroll resets on re-render; mixed `...`/`…` | Delete dead paths; normalize |
| L-12 | LOW | Hardware | `src/fasteners.js:70-73` | A #8 gets two different pilots by *length* (50 mm → 3.2, 25/32 mm → 2.8) — pilot should track gauge (and species), not length | One pilot per gauge |
| L-13 | LOW | AI/State | `src/ui.js:1341` | `state.turns` is written before `commit()` — if a commit ever failed, the transcript would claim a design that wasn't adopted (latent; commit is currently infallible there) | Persist turns only after a successful commit |
| L-14 | LOW | AI/Ops | `src/ai.js:307-310`, `api/chat.js:22,95` | Missing `ANTHROPIC_API_KEY` (503) is indistinguishable from real offline for the user/operator — a misconfigured deploy silently runs on the toy parser; default model id `claude-sonnet-5` worth a deploy-time check | Surface the 503 reason once ("AI isn't set up on this site") |

---

## 3. Detailed findings — CRITICAL and HIGH

### C-01 · Cabinet shelf: cut for dados, installed on pins — cannot fit
- **Where:** `src/parametric.js:508-511` (shelf joined to sides with `spec.joinery.case`), `src/plans.js:16-41` + `:55-79` (case joint adds cut-length allowance), `src/plans.js:488-490` (step s6), `src/plans.js:252-256` (pin BOM). Frozen proof: `test/golden/advanced-cabinet-imperial.json` — `overall.width 762`, `sideThickness 18` → interior 726 mm; cut list `Shelf L 738 · "includes 1/2 in for dado / housing"`; BOM `5 mm shelf pins qty 4`; steps `…s5, s6…`.
- **What the builder experiences:** They cut the shelf at 738 mm as the cut list says (the extra 12 mm is real — it's the dado allowance). Then step s6 tells them to drill the 32 mm pin system and "set the shelves on their pins." A 738 mm shelf will not drop between sides 726 mm apart. Three surfaces disagree: the model says *fixed dado shelf*, the step says *adjustable pin shelf*, the BOM buys *pins*.
- **Repro:** Load the "Storage Cabinet" starter (or any cabinet with `shelfCount ≥ 1`, level advanced so `case = dado`); open Plan → Cut (shelf note shows the dado allowance) and Plan → Assemble (s6 is the pin step). Compare shelf `L` to `width − 2 × sideThickness`.

### C-02 · Wood-runner screws: through the show face on a cabinet, 6 mm of bite on a nightstand
- **Where:** `src/fasteners.js:70` (`butt_screw: '#8 × {50}'`), `:112` (frame+frame ≤ 400 mm run → `butt_screw`), `src/parametric.js:246-261` (runner `runW = (sideInnerX − op.w/2) + 19`, joint `butt_screws` runner→side/apron, both `group:'frame'`).
- **Bench math:** Cabinet: `runW = 19` (sides flush with the opening) + 18 mm sheet side → a 50 mm screw leaves **13 mm of point standing proud of the finished exterior**. Nightstand (live): `runW = 44` + 20 mm apron → 6 mm of thread in the mate, which will not hold a drawer runner. The engine computes `mateT` (`fasteners.js:91`) and uses it for prose ("centered 0.39 in from the joint line") but never to bound length. The BOM and the step both instruct it (live: "3 × #8 × 1 15/16 in wood screw through drawer 1 runner into side apron … Pilot 0.13 in").
- **Repro:** Nightstand starter → chat "use wood runners for the drawers" (level intermediate+) → Plan → Assemble, "Drawer 1: fit wood runners"; inspect `__bb.state.model.parts` runner sizes vs `#8 × 1 15/16 in` in the BOM. For the through-poke variant, same on a cabinet (runner `runW` = 19).
- **Related:** M-19 (M4 × 16 slide screws vs 12 mm drawer sides) and H-05 share the same root cause: no length-vs-thickness check anywhere in fastener selection.

### H-01 · Captured bookshelf top gets figure-8s in the BOM, screws in the step
- **Where:** `src/fasteners.js:97-108`; `src/plans.js:477`. Golden: `ash-bookshelf-metric.json` Top `L 862` (= 900 − 2×19, captured), BOM `Figure-8 fasteners + #8 × 16 mm qty 4`. Live identical on the "Floor Bookshelf" starter.
- **Why it's wrong:** A top captured between case sides is fixed casework — it can't "float," and a figure-8 has no apron edge to be recessed into here; meanwhile the step says to butt-screw it, and those screws were never counted (the fastener engine spent the joint on figure-8s). The builder holds hardware no step mentions, and a step whose fasteners aren't in the shopping list.
- **Repro:** Floor Bookshelf starter → Plan → Buy (figure-8 line) vs Assemble s1 (butt-screw text; its appended note describes *shelf* screws — see H-06).

### H-02 · Sixteen phantom shelf pins
- **Where:** `src/plans.js:252-256` — pins are bought for any bookshelf/cabinet with shelf parts, regardless of joinery; `src/parametric.js:361-363` joins every bookshelf shelf to the sides (fixed). Live bookshelf: BOM "5 mm shelf pins qty 16", steps s1-s3 only (no drilling step), shelves butt-screwed in s2.
- **Why it's wrong:** The builder buys 16 pins that nothing installs; if they trust the pins over the steps, they have no hole pattern to put them in (the bookshelf path never emits the 32 mm drilling step the cabinet path has).
- **Repro:** Floor Bookshelf starter → Plan → Buy vs Assemble.

### H-03 · M&T rails installed after the carcass is glued
- **Where:** `src/plans.js:481-484`; golden `advanced-cabinet-imperial.json` step order (`s1` carcass → `s2` rails), rail note "includes 15/16 in for mortise & tenon".
- **Why it's wrong:** Once s1's glue sets, the sides cannot spread to seat tenons on both rail ends. Every carpenter assembles front rails and carcass in one glue-up. As written, a builder who follows step order literally is stuck with cured glue and three un-installable rails.
- **Repro:** Storage Cabinet starter at advanced → Plan → Assemble, read s1 then s2.

### H-04 · Shelf-pin rows drilled inside a closed cabinet
- **Where:** `src/plans.js:481-490` — order: s1 carcass, s2 rails, s3 back, s4 toe kick, **s5 top**, **s6 drill 5 mm pin rows**.
- **Why it's wrong:** Pin rows are drilled on the flat panels at the bench (drill press/jig). At s6 the box is closed on five sides; the top blocks the highest holes and a hand drill inside a carcass wanders. (Fixing C-01 should fold this step into pre-assembly drilling.)
- **Repro:** Same cabinet → Assemble, s5 vs s6.

### H-05 · Pull screws can't reach the pull
- **Where:** `src/hardware.js:558` (`pullScrewLenMM = frontT + 6`), `src/plans.js:350-352` (step: "M4 screws, length = front + 1/4 in"), `:244-246` (BOM), step order `dr_front` (attach front) before `dr_pull`.
- **Bench math:** Every drawer has a box front (12 mm sheet) behind the applied front (19 mm). Mounting hardware "from inside" means the machine screw crosses 12 + 19 = 31 mm before the pull's threads start; M4 × 25 is ~12 mm short. Live BOM: "Bar pull … 2 × 0.2 in through-bores, 3 3/4 in centers · M4 × 1 in".
- **Repro:** Nightstand starter → Plan → Buy, drawer pull line; Assemble "Drawer 1: add the pull".

### H-06 · Step notes teach the wrong joint in the wrong step
- **Where:** `src/plans.js:513-521` (`s.joints = jointsFor(model, s.partIds)` — any joint *touching* the step's parts; note appended from the first joint per type), `src/fasteners.js:313-325`.
- **Live evidence:** "Drawer 1: **mount the slides** … — 2 × 5/16 in dowels on the joint centerline… drill both parts from the same reference face, 5/16 in bit" (those are the rail-to-leg dowels, installed two steps earlier — there are no dowels in slide mounting). Bookshelf "**Join the case** … — 3 × #8 × 1 15/16 in wood screw through **shelf** into side" (the step is about the top/bottom; the shelf comes next step; the top's actual figure-8 layout is never printed because the type was already "seen"). "Hang the box"/"attach the front" re-print the locking-rabbet setout.
- **Why it matters:** These appended lines are the app's *drilling instructions* — the thing the BOM promises to match. A builder standing at the saw gets confidently-worded setout for operations that don't belong to the step in front of them.
- **Repro:** Nightstand starter → Plan → Assemble; read "mount the slides" and (on a bookshelf) "Join the case".

### H-07 · 32 mm pocket screws on 38 mm stock
- **Where:** `src/fasteners.js:72` (only `pocket` = 32 mm in the CATALOG), `:118-122` (text prints the real `memberT`: "jig set for {memberT} stock"); `src/knowledge.js:514-516` documents `pocket_63` and states 32 mm "physically cannot join 38 mm stock" — but the engine has no path to it.
- **Repro:** Any pocket-screw joint on a ≥32 mm member (custom grammar rail 38 mm thick + `pocket_screws` connection; thick-apron frames) → Assemble step reads "jig set for 1 1/2 in stock, 1 1/4 in coarse pocket screws".

### H-08 · Undermount clearance: −27 mm vs the industry's −42 mm
- **Where:** `src/parametric.js:131` (`boxW = op.w − 27`), `src/hardware.js:201` (`clearances: { widthTotal: 27, … }`), `src/plans.js:319` (step: "width = opening − 1 1/16 in … notch the box back for the hooks and press the locking clips on").
- **Why it's suspect:** The mechanism described (hooks, notched back, locking clips, 1/2-in bottom recess) is the Blum TANDEM pattern, and that whole class (Blum/Hettich/Grass) specs **drawer width = interior width − 42 mm** (21 mm/side). A box at −27 is ~15 mm too wide to drop onto that hardware — discovered only at install, after the box is glued. The value is internally consistent and selftest-asserted, so this is a deliberate constant that appears ~15 mm off the hardware it describes; flagged for confirmation against the intended SKU (see UNVERIFIED).
- **Repro:** Nightstand → chat "switch to undermount slides" (level intermediate+) → compare `drawers[0].box.w` to `opening.w` (live: 351 vs 378).

### H-09 · Bought 1-in stock, plans say 13/16 — and nobody says "plane"
- **Where:** `src/plans.js:442-450` (glue-up step: "…then rip and crosscut to L × W" — no thickness op), `:535-554` (tool list has a planer only for *laminations*); live nightstand: Stock buys "5/4x4 (1 x 3 1/2 in)" for aprons/rails whose cut list reads "13/16 in / 20 mm".
- **Why it's wrong:** 20 mm parts are un-buyable in S4S; the packer correctly reaches for 5/4 (25 mm), but the plan never instructs planing to 20 and never lists the tool. The rough-lumber mode has proper milling steps (`plans.js:397-407`); dimensional mode — the default — has none, so parts end up 5 mm over plan thickness (drawer-opening math assumes 20).
- **Repro:** Nightstand starter → Plan → Buy (5/4 lines) vs Cut (13/16 in) vs Assemble (glue-up steps mention only rip/crosscut; 18-item tool list has no planer).

### H-10 · Drawers: silently impossible outside two templates, and the chat suggests them anyway
- **Where:** `src/spec.js:446-459` (`else { s.drawers = null; }` — silent), `src/ai.js:53` (prompt constraint), `src/ai.js:276-282` (clarify fallback always offers "Add a drawer").
- **Live evidence:** On the boot Seed **Table**: "add a drawer" → "I didn't catch a change I can make there…" with suggestion chips `Make it walnut · Lower it by 2 in · **Add a drawer**` — tapping the chip loops the refusal. A desk with a pencil drawer (perhaps the most common request in furniture) cannot be expressed at all; on the AI path a proposed drawer bank is stripped by correction with no advisory, so the model's prose can over-claim what the 3D/cut list show (prose path UNVERIFIED live — no API key).
- **Repro:** Boot app (no key) → chat "add a drawer" on the seed table.

### H-11 · "No ash please" → the build becomes ash
- **Where:** `src/ai.js:172-187` — species matching strips "instead of X" but has no negation handling; the last-word fallback (`'ash'` from "White Ash") matches inside "no ash please".
- **Live evidence:** "no ash please" → "Adjusted White Ash. **CHANGED species Red Oak → White Ash**" — the cut list, BOM, and CSV all now say White Ash (verified in the exported CSV). The change chips make it *visible*, but the ack asserts the opposite of the user's intent; a trusting user buys the wrong lumber.
- **Repro:** Any design, offline chat: "no ash please" (also "not oak", "without walnut").

---

## 4. What passed inspection (kept short — these earn the app its trust)

- **Species data** spot-checked against Wood Handbook/Wood Database: Janka, MOE, MOR, SG, ct/cr all realistic for all 19+ species; engineered panels use documented *effective* values with ct≈0 (correct). Property doctrine holds: Janka never enters beam math; movement exempts sheet goods with correct physics text.
- **Nominal ↔ actual**: `1x4 = 19×89`, `2x4 = 38×89`, 5/4 = 25, 8/4 = 45, 4×4 = 89; sheets 1220×2440 in 6/12/18; stock lengths 6/8/10/12 ft; kerf 3 mm + end trim accounted and drawn; board-foot constant single-sourced (2,359,737 mm³) and used correctly.
- **Solid vs sheet separation**: pickers filter correctly both ways; templates put backs/drawer boxes in sheet stock and shows in solid; `spec.js` refuses a sheet species as the solid wood; packer locks sheet grain to the face veneer's long axis.
- **Units boundary**: every live surface (cut/stock/BOM/integrity/steps/drawings) followed the in↔mm toggle and dual mode in testing; imperial cut dims are reduced fractions with unit suffixes; CSV carries display units *and* raw mm; CAD exports stay mm by documented design (COLLADA `meter=0.001` Z-up; GLB metres; .rb inch-native transforms) — all verified in the downloaded files.
- **CSV**: RFC-4180 quoting, CRLF, fraction-as-date trap neutralized ("3/4 in", quoted) — opened-clean check done on the real download.
- **BOM ↔ drilling invariant**: fastener counts and step positions come from one engine (`countFor`/`stepNote` share `layoutForJoint`) — verified live (e.g. 16 × #8×50 = 4 runners × 3 + shelf 4). The *contamination* in H-06 is about placement, not counts.
- **Level gating is real**: live A/B — beginner: pocket/butt screws everywhere, slides forced; advanced: dowels, locking rabbets, dados, undermounts offered; steps and tools change accordingly. A beginner can never be handed dovetails.
- **Anti-tip pipeline**: F2057 failure produces BOM "REQUIRED" line + dedicated step + safety note + overview mention, all fired together (live).
- **Drawer-bottom capture logic**: grooved boxes trap the bottom at glue-up ("cannot go in later"), screwed boxes slide it in through the relieved back — both correct and well-worded. Side-mount clearance 12.7 mm/side correct.
- **Integrity panel**: formulas, thresholds, and design basis printed in full with honest caveats ("not certified structural engineering"); provenance formulas match engine outputs exactly (checked against goldens).
- **Prior audit's P0 is fixed**: phone Build mode now shows a one-line title, tall readable diagrams with "tap to enlarge", and a clean 1-of-35 pager (verified at 390×844).
- **A11y baseline**: no unlabeled visible controls found across Design/Cut/Stock; verdicts are text stamps, not color alone; focus traps + Escape stack verified in code; reduced-motion collapses animation.
- **Honest offline state**: chat header shows "Offline · basic edits"; ambiguous asks get clarify chips; unknown asks get an honest refusal (except H-11/M-17 above); history drawer records every change with source chips.

## 5. UNVERIFIED (needs a human click-through or a live backend)

| # | Item | What I'd test |
|---|------|---------------|
| U-1 | Real-model AI chat (no `ANTHROPIC_API_KEY` in this environment; all chat testing used the offline parser) | Metric-only session; novel piece ("standing desk that converts to a bench" → custom grammar); mid-conversation revisions; whether `explain` prose ever claims changes the code stripped (H-10's AI half); continuation on a genuinely truncated 40-part custom reply |
| U-2 | Photo → design | Needs the hosted vision path; offline shows an honest error |
| U-3 | Print output | `window.print` sheet renders (code inspected, print CSS present); needs a human print-preview/paper check |
| U-4 | GLB/DAE/.rb in external apps | Files download and are structurally valid (headers/units inspected); import into SketchUp/Blender + AR viewer not run here |
| U-5 | Undermount −27 mm constant (H-08) | Confirm against the slide SKU the product intends; Blum/Hettich/Grass-class spec sheets say −42 |
| U-6 | Billing/Stripe upgrade + project-cap UX (M-14 path) | Needs Stripe test keys; server suite passes, UI flow untested |
| U-7 | Real-device phone gestures | Diagram lightbox pinch/drag, wake-lock behavior on iOS/Android |
| U-8 | Species-compare panel numbers on screen | Weight distortion (M-13) verified in code; on-screen table not exercised live |

## 6. Quick wins (< 15 min each)

1. C-02/M-19 stopgap: clamp screw length to `memberT + mateT − 3` before formatting (full ladder later).
2. H-11: negation guard (`/\b(no|not|without|avoid|don'?t)\b/` before species match → clarify).
3. H-01: `isTopAttach` — drop `'side'` from the mate-role list.
4. H-02: gate the shelf-pin BOM line on the shelf actually being pin-mounted.
5. M-07: replace literal "shelf" with `b.name` in the dado text (`fasteners.js:151`).
6. M-11a: build the sandpaper line from `fin.prep.grits` + `betweenGrit`.
7. M-13: add `|| p.hardware` to the provenance weight skip.
8. M-15: fix the `welcomeResumeName` ternary.
9. L-01: French cleat 19 → 18.
10. L-02: default jointview/joinery3d formatters to `BB.Units.fmtLength`.
11. L-03: delete `pricePerBdFt` from the three `sheet: true` species.
12. L-06: prepend `'﻿'` to the CSV.
13. L-09: skip empty notes in "Adjusted …" acks; guard the n=1 "from each end" template.
14. L-11: delete the dead `doExport('share')` branch.
15. H-10 (chip half): filter clarify chips by template capability.

## 7. Remediation plan — MEDIUM and LOW findings

All CRITICAL/HIGH items are fixed (see the status note in §1); the original fix-order proposal that stood here has been executed for steps 1–7. The remaining 22 MEDIUM + 14 LOW group into six PR-sized batches, ordered by bench impact. Protocol per batch: failing-test-first for behavior-bearing changes (new `FE-*` sections in `test/audit.test.js`), `npm run build && npm test` after every change, golden refreeze only when the diff is the intended one, smoke test for anything UI-visible.

### Batch A — Fastener bench-usability (`fasteners.js`, `knowledge.js`) · ~half day
| Items | Change |
|---|---|
| M-01 | Render pilots/bores as real drill sizes (imperial: nearest 1/64 fraction — "1/8 in", never "0.13 in") via a dedicated `fmtDrill`; screw *positions* through `fmtLength` fractions (they're tape measurements) |
| M-02 | Fine-thread pocket screws for hardwood (janka ≥ ~1000); add the fine entries to `K.FASTENERS` + the engine catalog |
| M-03 + L-12 | Pilot Ø scaled by the receiving species' janka (hardwood ≈ root Ø, softwood ≈ 85%); one pilot per gauge |
| M-04 | Screw setouts gain "clearance hole in the near member + countersink" phrasing (the countersink bit is already in tools) |
| M-05 | Figure-8s: recess/mortise instruction + Forstner bit in tools; per-step fastener totals instead of first-joint-only counts |
| M-19 | Slide screws for the drawer member sized to the 12 mm side (M4 × 10/12) — reuse the C-02 `screwPlan` bound |
| M-21 | `positions()` at n=2 under min spacing → one centered fastener |

Golden impact: BOM pilot/label text churn — one deliberate refreeze at batch end.

### Batch B — Instruction completeness (`plans.js`) · ~half day
| Items | Change |
|---|---|
| M-06 | Drawer-bottom groove step gains the measured-ply caveat the dado text already has (nominal 6 mm ply ≈ 5.2 mm) |
| M-07 | `fasteners.js` dado text names the real housed part (`b.name`), not the literal "shelf" |
| M-08 | When the movement check demands slotted screw holes for a captured panel, append that demand to the step that drives those screws (integrity already flows into `assembly()`) |
| M-09 | Cases with backs or drawer banks get a "pre-finish interior faces, shelves, and drawer boxes before closing the case" step |
| M-10 | Dry-fit-before-glue phrasing on all template case/frame glue-up steps (custom path already has it) |
| M-11 | Abrasives line built from `fin.prep.grits` + `betweenGrit` (150 for hardwax, 320 pads for film finishes); tool dedupe by canonical key ("Table saw or router table" ≡ "Router or table saw", "Drill" ⊂ "Drill/driver", "Clamps" ⊂ "Bar or pipe clamps") |
| L-09 | "Several rips" → count-aware copy |

Golden impact: step additions (pre-finish) — refreeze; battery fixtures re-checked.

### Batch C — Materials & reference honesty (`ui.js`, `knowledge.js`, `provenance.js`, `structural.js`) · 2–3 h
| Items | Change |
|---|---|
| M-12 | Shop Reference Wood table: badge `sheet: true` rows, dash their Janka/movement cells (MDF "700 lbf" reads as solid-wood hardness today) |
| M-13 | `weightKg` skips `p.hardware` so steel slides stop weighing as wood in species compare |
| L-01 | French cleat ply 19 → 18 (`K.SHEET_THICKNESS`) |
| L-03 | Drop vestigial `pricePerBdFt` from `sheet: true` species |
| L-04 | Derive the movement category label from `ct` thresholds so label and coefficient can't disagree (red vs white oak) |
| L-05 | Stiffness upsell recommends the stiffest qualifying species, not hardcoded hard maple |
| NEW (found during the H-09 fix) | Bookshelf default `sideThickness` 18 → 19: solid sides should default to a buyable S4S thickness (18 is a sheet number; today's default implies a 1 mm skim on every 1× side and a 2 mm interior-width drift if the builder keeps 19) |

### Batch D — UI, a11y, state (`ui.js`, `index.template.html`, `styles.css`) · ~half day
| Items | Change |
|---|---|
| M-14 | Autosave gate-block shows "not saved — export a share code" instead of a stuck "saving…" (work silently lost today) |
| M-15 | `welcomeResumeName` no-projects branch reads "Import a design" |
| M-16 | Diagnostics reachable by keyboard (button semantics + Enter/Space); camera presets get `aria-label="Front elevation"` etc. |
| M-18 | F2057 failure rolls up as its own tier — a "safe only when anchored" stamp — instead of sitting under "passes the required strength checks" |
| L-08 | Stock-diagram labels ellipsize with tooltips; boards cross-reference their shopping-list row |
| L-11 | Dead-code sweep: `doExport('share')` branch, duplicated `diagramScrim` markup, dead placeholder, `buildModeBtn` id note, panel scroll restore, ellipsis normalization |
| L-13 | `state.turns` persists only after a successful commit |

Smoke-test additions for M-14/M-16; no golden impact.

### Batch E — AI context & honesty (`ai.js`, `spec.js`, `knowledge.js`, `api/chat.js`) · ~half day
| Items | Change |
|---|---|
| M-17 | Part-scoped species asks ("make the *top* oak") ack the true scope: "species applies to the whole piece" |
| M-20 | A small corrections-note channel from `correctSpec` → chat so silent snaps (unknown species → red oak; AI-path drawer strips) surface as honest notes — design carefully: notes describe what code did; the model never writes numbers |
| M-22 | One budget digest line in the prompt (species $/bd ft + the current design's BOM total) so "keep it under $200" is answerable |
| L-14 | Missing-key 503 surfaces once as "AI isn't set up on this site" instead of masquerading as offline; deploy-time model-id check |

Prompt digests are self-tested — keep `knowledgeDigest` tests green.

### Batch F — Polish sweep · 1–2 h
L-02 (jointview/joinery3d `' mm'` fallbacks → `BB.Units.fmtLength`), L-06 (CSV UTF-8 BOM), L-07 (joint-inspector tenon capped by the mate-aware allowance), L-10 (cap displayed margins at ">1000×").

**Order: A → B → C → D → E → F.** A and B finish the bench-truth story the CRITICAL/HIGH fixes started; C and D are trust and access; E carries the one new design decision (the corrections-note channel); F is cleanup. Every batch lands as its own commit series with the same verify-as-you-go discipline used for the CRITICAL/HIGH pass.

### Carry-over UNVERIFIED (unchanged from §5)
Real-model AI chat (needs `ANTHROPIC_API_KEY`), print fidelity, external CAD/AR imports, real-device gestures, Stripe upgrade flow — plus one new item: pin the exact undermount SKU the product recommends (the −42 inside rule and 12.7 mm recess implemented are the Blum TANDEM-family standard).

---

*The original audit was read-only. The remediation pass changed `src/` under the repo's engineering-truth guardrails: failing-test-first, all suites green after every fix (unit 946 · audit 319 · golden 6/6 · battery · server 69 · handcalc 14/14 · smoke 212), goldens refrozen only where the diff was the intended behavior change.*
