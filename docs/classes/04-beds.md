# Beds — the class profile

Template `bed` (specVersion 9, wire key `bd`): a knock-down platform bed —
four posts, bolted rails, slat deck on cleats, centre rail with its own floor
leg at queen width and up, optional board headboard. The mattress size is the
master dimension: interior = standard size + 30 mm fit clearance, and
`overall.*` are derived read-outs, never knobs. Code: `src/classes.js`
(`bed`, `BED_GEOM`), `src/structural.js` bed block; hand arithmetic in
`test/handcalc.js` [19]–[22].

## The load model (sourced)

- **User mass 110 kg × 2 occupants — EN 1725:2023** (SATRA/BSI summaries),
  the one citable adult-bed strength standard; **no US ASTM standard covers
  adult residential beds**, and every output says so (`bed:basis` — always
  benchmarked, never a compliance claim). Mattress masses per size from
  Saatva/Nectar spec pages (sustained → ×2 creep on the mattress share).
- **Slat deck** (`bed:slats`): count solved so gaps ≤ 70 mm — the
  foam-warranty floor (Amerisleep ≤ 2.75 in; Tempur-Pedic's ≥ 3 in slat
  width is the width floor). Strength is the knee case: 110 kg through the
  mattress onto two slats at midspan; sag is the distributed case at L/300.
  The SECTION is solved by code per species (`G.slatThickness`): a red-oak
  queen carries 19 mm slats, the same deck in SPF solves to 25 — the
  1×4-vs-2×4 choice the published plans leave to the reader, by arithmetic.
  The check measures gaps over the deck the builder actually laid out
  (probe/builder parity — slats inset clear of the post intrusions).
- **Side rails** (`bed:rail`): tributary share (quarter with the centre
  rail) plus a 0.75-user edge-sit point load at midspan.
- **Rail connections** (`bed:joint`): two M6 barrel bolts per rail end
  (kd_bolt, SG-scaled) against the computed end reaction, ≥ 1.5× gate.
  Surface-mount bed-rail brackets **publish no load ratings** (Rockler
  catalog confirmed 2026-07) — so the check and BOM print the REQUIRED
  capacity (demand × 1.5) for the buyer to match, the same honesty pattern
  as masonry anchors.
- **Centre support** (`bed:centre`): mandatory at interior ≥ 1350 mm —
  the Sealy/Stearns & Foster warranty rule (≥ 5 legs with centre support at
  queen+). Rail on edge, dimensioned floor leg, worst-segment stress priced.
- **Headboard** (`bed:headboard`): 667 N sit-back force (aligned to the
  X5.1 back magnitude the seating class uses) levered about the rail-bolt
  line into the post section.

## Couplings & refusals

The knock-down mandate is a coupling, not a preference: rails bolt
(`kd_bolt`) at every skill level, and an advanced ask for glued tenons is
corrected back and told (`no_glued_bed`) — a bed that cannot leave the room
is a defect. Headboard clears the rail band by ≥ 150 mm or it is trim (the
correction bumps it and says so). Platform height 250–500 (mattress top
lands 500–650). Refused with their regulations, before creation triggers:
**bunk/loft** (ASTM F1427 — guardrail/ladder/entrapment rules we don't
model, falls from height), **cribs and infant sleep** (16 CFR 1219/1220 —
federal safety law, refused permanently), **murphy/folding** (lift mechanism
+ moving-load wall anchorage; every joint here is fixed or bolted).

## Fixtures

Golden: `oak-queen-bed-imperial` (nominal, headboard + mandated centre
rail), `pine-twin-bed-metric` (no headboard, no centre rail — the other
side of the mandate — plus the pine section step-up from the species-aware
slat solver). Bad: audit BED-1…3 (gap parity across all five sizes, the
glued-rail correction, refusals with regulations named, the basis
disclosure). Legacy: `v9-oak-queen-bed.json` anchors the migration corpus at
the current version. Benchmark: `test/benchmark-bed.js` vs Ana White's
"Modern Farmhouse Bed Frame" (queen; reader-extracted list, caveat stated in
the file) — tally 5 OURS-BETTER / 3 EQUIVALENT / 1 TRADITIONAL, the plan's
10-slat deck failing the class gap rule being the load-bearing divergence.

# Long-span guard (frame_table addendum, roadmap item 2)

Not a template — a soundness boundary now enforced in the shipping class:
past 1800 mm clear span between legs, the racking couple on the apron–leg
joints grows while joint capacity stays fixed, so the racking score scales
down linearly (×0.7 at the cap) with the factor listed by name in the
check's own factor table. The 2400 mm `DIM_RULES` width cap is the stated
refusal (correction clamps and discloses; contract refusal `no_over_span`).
Breadboard/batten stiffening options remain future work. Audit: LSPAN-1.
