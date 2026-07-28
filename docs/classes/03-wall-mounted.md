# Wall-mounted — the class profile

Template `wall_shelf` (specVersion 8, wire key `wl`): a French-cleat floating
shelf. The class where the load path leaves the furniture — the wall carries
the cantilever couple, so the **substrate is required input** and an unknown
wall is a refusal, not a default. Code: `src/classes.js` (`wall_mounted`),
`src/structural.js` wall block; hand arithmetic in `test/handcalc.js` [18].

## The anchor model (sourced)

- Withdrawal capacity: **NDS W = 2850·G²·D lb per inch of thread** — a design
  value ~5× under ultimate (verified incl. an SYP cross-check). #10 screw
  (D = 0.190 in), 1.5 in of thread in a worst-case SPF stud (G = 0.42):
  **637 N per screw**. Shear uses the conservative 356 N secondary-source
  value, labeled as such (NDS Table 12L is paywalled).
- Demand: load (books 60 kg/m default + self weight) at half the depth →
  couple M; tension at the screw line (50 mm arm to the bearing edge);
  ≥ 1.5× gate. Default 914 × 241 oak shelf: 360 N/screw → **1.77×** pass;
  heavy storage drops it below the gate and says so.
- Studs: guaranteed crossings = floor(cleat/spacing) at IRC 406/610 centres
  (worst phase). ≥2 pass; 1 = named single-stud mount (centre it, ≤600 wide);
  0 = FAIL with a lengthen fix.
- **Masonry never assumes a capacity**: the check and BOM print the REQUIRED
  working rating (demand × 1.5) to match against the anchor's published
  working — not ultimate — value.

## Couplings & refusals

Depth caps at 300 (past it is wall-hung casework, not yet sound); depth > 250
forces 32 mm shelf stock (ergonomics note made structural). Height is derived
(cleat + shelf) — the mount plane is the datum, and the floor-invariant audit
is exempted ONLY for classes declaring `mounted: 'wall'` (a hovering table
still fails `geom_floats`; audit WALL-4). Refused with reasons: unknown
substrate (validation error + the parser asks before creating, with chips
that parse back in), drywall-only (anchor creep; ratings are ultimate),
ceiling-hung anything.

## Fixtures

Golden: `oak-floating-shelf-imperial` (nominal stud), `deep-shelf-masonry-metric`
(depth cap + thickness coupling + required-rating pattern frozen). Bad:
audit WALL-1…4. Steps carry the substrate discipline: stud-finding with pilot
verification, level line, two #10 × 3 in per stud into centres, and a
pull-down load test before anything lives on the shelf.

# Desk apron drawers (frame_table addendum)

Desks gained pencil drawers **inside the apron band**: the top is the kicker,
the front apron becomes a lower rail (opening = band − 40, clamped 45–80 — a
documented 45 mm class floor vs the 80 mm casework minimum), a pair splits
around a centre stile past 620 mm, boxes ride wooden runners to the rear
apron. Class-fixed knobs: inset fronts, wood runners at every level. The
weakened front band is judged by a **stiffness-shared (h³) two-member model**
(the fastened top forces equal deflection; the weak rail spans its opening;
the governing member is reported — handcalc [17]); identical pairs take the
original model byte-for-byte, so the frozen corpus never moved. The F2057
anchor mandate is re-scoped to clothing storage (the tip physics still
reports on desks); knee room is named against Panero & Zelnik with ADA 306.3
cited (audit DESK-2). Golden: `walnut-writing-desk-imperial`.
