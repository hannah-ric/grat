# Blueprint Buddy — Findings Register

Severity: **S0** plans could fail structurally/unsafely · **S1** will not build as
written · **S2** materially inaccurate · **S3** incomplete vs professional
standards (capability built) · **S4** polish (backlog allowed).
Confidence: **CE** confirmed-by-execution · **CI** confirmed-by-inspection.

**Resolution status: every S0, S1, S2, and S3 finding below is FIXED/BUILT and
guarded by a test** (verification gate: 293 unit + 99 audit + 6/6 golden +
125 smoke green; hand-verification worksheet 14/14; published-plan benchmark
0 unexplained divergences). S4 items live in `07-backlog.md`.

Shop verdicts are one sentence a woodworker would nod at.

---

## S0 — could fail structurally or unsafely

### F-S0-1 · Drawer furniture never checked for open-drawer tip-over (ASTM F2057 / STURDY domain) — CE
- **Where:** `structural.js:410-455` (tipping block).
- **Wrong:** Loaded tipping puts the surface load on the TOP, centered. Drawers
  are never opened in the model; no front-edge load case exists. Battery
  evidence: a 900×480×1200 four-drawer dresser (photo path) returns
  `antiTip=false`, loaded angle 13.2°, h/d exactly 2.5 — no anchor required, no
  open-drawer case run. F2057-style loading (drawers open 2/3, 50 lb on the top
  open drawer front) is the regulated scenario for clothing storage ≥ 27 in.
- **Shop verdict:** a dresser that looks stable with its drawers shut is exactly
  the one that goes over on a kid the day every drawer is open.
- **Ground truth:** ASTM F2057-23 / 16 CFR 1261 (STURDY): unit with drawers open
  to 2/3 travel must resist 50 lb (22.7 kg) applied to the open drawer front.
- **Fix:** new `tip_f2057` check in `structural.js`: opens every drawer to 2/3
  travel (geometry + travel already modeled), shifts each box+front mass
  forward, applies 22.7 kg at the highest open drawer front, and computes the
  moment margin about the front foot line. Applies to any drawered piece
  ≥ 686 mm tall (F2057 scope) and reports margin for shorter ones. Fail ⇒
  wall-anchor becomes mandatory (BOM + assembly step, already wired) and the
  check says why. Alignment documented in the check text and `DESIGN_BASIS`.
- **Test:** `test/audit.test.js` §F2057 — tall dresser fails without anchor,
  margin arithmetic hand-verified in `test/handcalc.js` [10].

### F-S0-2 · Sag checks carry no load-duration (creep) factor — CE
- **Where:** `structural.js:332-366` (beam block).
- **Wrong:** `grep creep|duration|sustained` over structural.js: absent
  (handcalc [7] executed). Book/storage loads are permanent; Wood Handbook
  ch. 4: creep under sustained load ≈ doubles initial elastic deflection.
  A shelf passing at ratio 0.99 today sags visibly within a year or two.
- **Shop verdict:** every woodworker has seen the bookshelf that was straight
  on delivery day and smiling by Christmas.
- **Ground truth:** Wood Handbook FPL-GTR-282 ch. 4 (time-dependent
  deformation): total ≈ 2× elastic for long-duration load on seasoned wood.
- **Fix:** load presets now carry `sustained: true/false`; sustained cases
  multiply deflection by `CREEP_FACTOR = 2.0` (exported, documented). Books,
  heavy storage, display and the distributed half of worktop are sustained;
  seated people and the edge-lean are transient. Check text reports the
  long-term figure.
- **Test:** audit.test.js §creep (books sag doubles; seating does not).

---

## S1 — will not build as written

### F-S1-1 · Mortise-and-tenon allowance is a fixed 30 mm — tenons longer than the mortised member is thick — CE
- **Where:** `plans.js:13-17` (`JOINT_ALLOWANCE`), consumed at `plans.js:40-47`.
- **Wrong:** Advanced cabinet (battery): drawer rails cut at L=786 = 726 clear
  + 2×30 mm tenons into **18 mm** sides. A 30 mm tenon cannot enter an 18 mm
  side; the cut list is physically impossible. Same failure for any M&T into
  stock thinner than ~36 mm.
- **Shop verdict:** you can't bury a 30 mm tenon in an 18 mm board — the first
  dry fit ends the day.
- **Ground truth:** blind tenon length ≤ mortised thickness − 6 mm of wall;
  craft practice 1/2–2/3 of the mortised member.
- **Fix:** `JOINT_ALLOWANCE` replaced by `Plans.jointAllowance(type, mateT)`;
  M&T = `min(30, max(0, mateT − 6))` per end (rounded to whole mm); dado/rabbet
  = `min(6, ⌊mateT/3⌋)` honoring the 1/3-depth cap (12 mm sides now get 4 mm
  dados, not 6). Joints in the model now carry the mate's thickness. Tenon
  THICKNESS (≈ member/3, snapped to 6/8/10/12 chisels) and edge shoulders
  are emitted by the new fastener/joinery-detail engine (F-S3-1).
- **Test:** audit.test.js §tenon (cabinet rail cut length ≤ buildable; 12 mm
  side dado = 4 mm).

### F-S1-2 · Captive drawer bottom told to "slide in" after the box is assembled — CI (geometry proves impossibility)
- **Where:** `plans.js:193-195` (`drawerSteps`), geometry `parametric.js:148`.
- **Wrong:** For locking-rabbet and dovetail boxes the bottom is grooved into
  ALL FOUR members (`botD = boxD − 2·boxT + 10`), yet step 2 says "build the
  box", step 3 "slide in the bottom". A panel captured on four sides cannot
  enter a closed box. (Screwed/pocket boxes are fine: the back is relieved
  16 mm and the bottom genuinely slides in from the rear.)
- **Shop verdict:** glue the four corners of that drawer and the bottom is
  staying in the shop, not in the drawer.
- **Fix:** grooved-box step order corrected: groove all four parts, then
  assemble the box AROUND the floating bottom; slide-in boxes keep the old
  order. Text says which situation applies.
- **Test:** audit.test.js §assembly-feasibility.

### F-S1-3 · COLLADA and SketchUp exports drop part rotations (and box-ify cylinders) — CE
- **Where:** `exports.js:84-91` (DAE identity matrix), `exports.js:140-163`
  (Ruby translation-only), box-only geometry both.
- **Wrong:** Executed: default custom bench's rotated panel leg (rot y=90)
  exports with identity rotation — the exported model has legs lying in the
  wrong orientation; any angled brace exports square; cylinders export as
  square posts. Export ≠ 3D view for every novel piece with rotation.
- **Shop verdict:** the SketchUp file shows a different piece of furniture
  than the screen — whichever one you build, one of them is wrong.
- **Fix:** both exports emit the full rotation (Y-up→Z-up conjugated matrix in
  DAE `<matrix>`; 16-element `Geom::Transformation` in Ruby, composed about
  the part center). Cylinders export as 16-gon prisms (DAE) / `add_circle` +
  pushpull (Ruby).
- **Test:** audit.test.js §exports (rotated part round-trips its basis
  vectors; cylinder emits non-box geometry).

### F-S1-4 · Drawer-box side clearance 12.5 mm/side vs the 12.7 mm ball-bearing slides require — CE
- **Where:** `parametric.js:114` (`boxW = op.w − 25`).
- **Wrong:** Battery nightstand: opening 378 → box 353. Side-mount ball-bearing
  slides are 1/2 in (12.7 mm) per side; 12.5 mm leaves the box 0.4 mm proud.
  Slides bind or need the box sanded down its whole side.
- **Shop verdict:** half-inch slides in a 12.5 mm gap is a drawer you install
  with a mallet and open with a prayer.
- **Ground truth:** every side-mount slide datasheet: 12.7 mm ±0.2 per side.
- **Fix:** clearance = 25.4 mm total (12.7/side), constant named and exported
  (`SLIDE_SPACE_MM`), provenance updated.
- **Test:** audit.test.js §slides (box = opening − 25.4).

---

## S2 — materially inaccurate

### F-S2-1 · Table/bench/nightstand top sag modeled as the top alone spanning leg-to-leg — aprons ignored; flagship starter FAILS its own integrity tab — CE
- **Where:** `structural.js:140-155` (`surfacesOf` TABLE_LIKE).
- **Wrong:** Executed (handcalc [8]): Shaker Dining Table starter — engine
  predicts 9.68 mm sag (FAIL) treating the 25 mm top as the only beam over the
  1619 mm leg span. The two 19×101.6 aprons it ignores would deflect 3.47 mm
  carrying the whole load themselves (limit 5.40 mm). The shipped gallery
  starter shows a red "fail" for a design generations of shops have proven.
- **Shop verdict:** the aprons are the beam; judging a table by its top alone
  is like rating a door by its paint.
- **Fix:** table-like surfaces now produce three honest checks: (a) **apron
  beam** — each long apron carries half the load over the leg-to-leg span,
  I = t·h³/12; (b) **top between aprons** — the top spans the clear depth
  between long aprons under the point load on a span-wide strip; (c) existing
  overhang cantilever. Provenance strings updated to match.
- **Test:** audit.test.js §tablemodel (Shaker starter passes; a 12 mm pine
  top over 700 mm apron spacing still fails (b); a 15×60 apron on a 2 m span
  fails (a)). Hand arithmetic in handcalc [8] (after) matches.

### F-S2-2 · 1D packer reports offcut minus (n−1)×kerf — negative offcuts on full boards — CE
- **Where:** `packing.js:112` (`b.offcut = stockLen − trim − used − (cuts−1)·kerf − trim`); `b.used` already contains the kerfs.
- **Wrong:** Executed: 3×800 on a 2438 board → true offcut 2 mm, reported
  **−4 mm** (kerf double-subtracted). Every multi-cut board diagram
  under-states its offcut; tight boards show negative.
- **Shop verdict:** the diagram says the board is over-committed when the cuts
  actually fit — you'd buy a board you don't need.
- **Fix:** `offcut = stockLen − 2·trim − used` (used already carries kerfs).
- **Test:** audit.test.js §packing-offcut (hand recompute = engine, ≥ 0 on all
  battery boards); handcalc [9] now agrees.

### F-S2-3 · Movement advisory contradicts the plan's own attachment method; warns on compatible solid-solid casework — CE (battery)
- **Where:** `structural.js:586-632` (`constrained = true` always).
- **Wrong:** Battery: every table/nightstand fires "this panel is fastened
  across the grain — restrained movement splits panels" on tops the SAME plan
  attaches with figure-8 fasteners (BOM line + assembly step). Carcass tops and
  bottoms housed in same-species solid sides move WITH the sides (both
  cross-grain in depth) — no differential capture exists, yet it warns.
- **Shop verdict:** the plan already floats that top on figure-8s; warning me
  it will split is telling me my dog will starve while pointing at his full bowl.
- **Fix:** movement context is now derived per panel: `apron-capture`
  (tops/seats on frames — but the plan floats them: PASS with "absorbed by
  figure-8s/buttons" + cupping note where relevant), `ply-back capture`
  (solid side/bottom screwed to a non-moving ply back — the REAL split risk:
  advisory with elongated-hole fix, as before), `compatible` (solid-solid,
  same movement axis: PASS with reason), `free`.
- **Test:** audit.test.js §movement-context.

### F-S2-4 · Load presets diverge from the BIFMA loads they imitate — CI
- **Where:** `structural.js:38-44`.
- **Wrong / Fix:** books 55 → **60 kg/m** (BIFMA X5.9 general shelf 40 lb/ft);
  heavy 90 → **112 kg/m** (X5.9 high-density file 75 lb/ft); seating 120 →
  **136 kg/seat** (X5.4 300 lbf functional); worktop 75+90 kept (≈ X5.5
  distributed + concentrated functional loads) — basis strings shipped with
  each preset and shown in the UI detail line.
- **Shop verdict:** if we borrow the office-furniture yardstick we should read
  it at its own marks, not half an inch shy.
- **Test:** audit.test.js §presets (values + basis strings present); selftest
  beam hand-values recomputed for 60 kg/m.

### F-S2-5 · BOM fallback prices a 1525×1525 sheet standard the optimizer doesn't sell (and a 15 mm thickness no table lists) — CI
- **Where:** `plans.js:104-129` vs `knowledge.js:257` (1220×2440, {6,12,18}).
- **Fix:** fallback now bins to `K.SHEET_THICKNESS` and prices fractions of the
  one true sheet (`K.LUMBER.SHEET`), using default sheet prices.
- **Test:** audit.test.js §bom-fallback.

### F-S2-6 · Custom-part thickness silently snapped to ≤ 45 mm — a 70×70 post becomes 70×45 — CE
- **Where:** `spec.js:249` (snap to `SOLID_THICKNESS`, max 45).
- **Wrong:** Executed in audit tests: proposing a 70 mm-thick post yields 45 mm.
  Templates allow 100 mm legs and the packer laminates anything over 45, so the
  cap is an artifact, not a stock truth.
- **Fix:** custom solid thickness snaps to `POST_THICKNESS` (SOLID ∪
  {60,70,80,90,100}); packer already laminates. Sheet parts unchanged.
- **Test:** audit.test.js §custom-thickness.

### F-S2-7 · End-grain screw connections in the novel grammar carry full capacity and no warning — CI
- **Where:** `structural.js:541-584` (joint adequacy), `spec.js` validation.
- **Wrong:** A rail butt-screwed END-ON to a post (screws into the rail's end
  grain) rates the same 500 N as a face joint. End-grain withdrawal ≈ 75 % of
  side-grain is the OLD wisdom for lag screws; for wood screws the handbook
  says do not rely on end-grain withdrawal at all, and end-grain glue is
  near zero.
- **Fix:** custom connections detect end-grain bearing (joint sits at a
  member's end along its grain axis): capacity ×0.6 in joint adequacy, plus a
  validation advisory naming the parts and suggesting a mechanical joint
  (dowel/M&T) or a cleat. Novel grammar therefore cannot rely on silent
  end-grain-only strength.
- **Test:** audit.test.js §endgrain.

### F-S2-8 · Cabinet drawer probe disagrees with the builder (side thickness subtracted only in the probe) — CI
- **Where:** `parametric.js:66` vs `parametric.js:384`.
- **Fix:** probe uses the builder's `bodyH × 0.6`.
- **Test:** audit.test.js §probe-parity (probe openH == built openH ±0.1).

### F-S2-9 · Baltic birch comment claims "~20 % reduction" while the table encodes 28 %/52 % — CI
- **Where:** `knowledge.js:83-84`.
- **Fix:** comment corrected to the actual derates (MOE ~0.7×, MOR ~0.5× solid
  birch — plywood bending values, conservative).
- **Test:** covered by digest-integrity test asserting values unchanged.

---

## S3 — incomplete vs professional standards (capabilities built)

### F-S3-1 · No fastener locations, pilot diameters, or joinery setout anywhere in the plans — BUILT
- New `src/fasteners.js` (`BB.Fasteners`): per-joint layout engine — screw
  counts by member length (edge distance ≥ 20 mm, spacing ≤ 160 mm), pilot
  Ø from the fastener catalog, pocket-screw placement, dowel Ø by stock
  (≈ T/3 snapped to 6/8/10/12) with 2Ø edge distance and ≥ 3Ø spacing, tenon
  setout (thickness ≈ member/3 snapped to chisel sizes, length from
  F-S1-1 rule, 6 mm edge shoulders), dado/rabbet depths. Surfaced: assembly
  steps carry the setout line per joint; print sheet gains a "Joinery detail"
  table; BOM screw counts now come from the engine instead of flat 2/joint.
- **Test:** audit.test.js §fasteners (edge distances respected on short and
  long joints; dovetail/tenon setouts sane; BOM counts = engine counts).

### F-S3-2 · No milling sequence for rough stock — BUILT
- Rough-stock mode now prepends real milling steps (face-joint, edge-joint,
  plane to listed thickness, rip, crosscut oversize then square to length)
  ahead of joinery, listing the thicknesses actually in the cut list.
- **Test:** audit.test.js §milling.

### F-S3-3 · Finishing is one sentence — no grit progression or schedule — BUILT
- `K.FINISHES` rows gain `prep` (grit ladder, raise-grain flag, between-coat
  abrasive) and safety flags; `Plans.assembly` emits a sanding step (grit
  progression by finish) and a finishing schedule step (coats × recoat ×
  cure, between-coat sanding, oil-rag fire warning where applicable).
- **Test:** audit.test.js §finishing.

### F-S3-4 · No safety notes — BUILT
- Proportionate safety block generated from the plan itself: sheet-goods
  handling when sheets present, push-stick note when rips < 150 mm exist,
  dust/hearing/eye basics once, oily-rag disposal with oil finishes,
  anti-tip reminder when mandated.
- **Test:** audit.test.js §safety.

### F-S3-5 · No edge-distance / spacing / min-stock rules in validation — BUILT
- Validation now errors on pocket screws into stock < 12 mm and advises on
  screw edge distances the fastener engine cannot satisfy (parts too small),
  and on 6 mm drawer bottoms wider than 600 mm.
- **Test:** audit.test.js §rules.

### F-S3-6 · Hardware ratings absent — slide capacity vs drawer size — BUILT
- `K.FASTENERS.hardware` slide row gains `capacityKg: 34` (75 lb class);
  integrity gains `slide:` check per drawer: interior volume × load density
  (clothing 0.24 kg/L; documented) vs capacity, with the file-drawer caveat.
- **Test:** audit.test.js §slide-capacity.

### F-S3-7 · Design-value basis undocumented; no clear-stock note — BUILT
- `K.DESIGN_BASIS` (exported text): Wood Handbook small-clear means; what
  SF=4 absorbs (grade/knots/duration); creep factor; BIFMA/F2057 mapping.
  Integrity footer now discloses it. Load-bearing cut-list rows carry
  "select straight-grained stock free of knots" and the print sheet repeats it.
- **Test:** audit.test.js §basis.

### F-S3-8 · Digest drift possible (hand-copied level matrix ×2, vision ergonomics) — BUILT (guard)
- Level-matrix line now GENERATED from `jointsForLevel`; vision ranges
  generated from `K.ERGONOMICS`; self-test asserts every digest line matches a
  regeneration from the source tables, so drift is a red test forever.
- **Test:** selftest `digest` group + audit.test.js §digest.

### F-S3-9 · Dovetail/locking-rabbet drawers get butt-screwed backs — IMPROVED
- Grooved boxes now use dado-housed backs (standard practice with half-blind
  fronts); slide-in boxes keep screwed backs.
- **Test:** audit.test.js §drawer-backs.

---

## S4 — polish backlog (not fixed in this pass unless noted)

| id | item | note |
|---|---|---|
| F-S4-1 | "pocket screwss" pluralization in step text | FIXED in passing (label pluralizer) — one-line |
| F-S4-2 | `SHEET_FRACTIONS` table orphaned (packing hardcodes bounds) | consolidate later |
| F-S4-3 | 15 % sheet-fraction cutting premium: comment promised, code omits | comment corrected to match code (pricing left pro-rata; user-editable anyway) |
| F-S4-4 | Word-number dimensions ("four feet") not normalized for the offline parser | backlog prompt included |
| F-S4-5 | `openings[].zTop` is a Y coordinate with a Z name | rename in a quiet refactor |
| F-S4-6 | Sag fixes never offer "add a center support / fixed shelf" for long spans | backlog |
| F-S4-7 | `FASTENERS` catalog vs BOM strings share values but not code | fastener engine now sources the catalog for screws/dowels; full unification backlog |
| F-S4-8 | dowel_10 catalog row unused by BOM | fastener engine now selects by stock; row live |

## Questions (not findings — no reproducible evidence)

- Q-1: `window.claude.complete` transport (claude.ai artifact host) untestable
  here; continuation detection for it relies on `looksTruncated` only. Left as
  is; covered by unit tests at the protocol level.
