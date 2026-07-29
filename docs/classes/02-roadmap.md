# Class roadmap — what the app still refuses, ranked

Ranked by user demand against engineering risk; each placement names the
factor that drove it. Every class below is currently an honest refusal (or a
scope cap), and stays one until it can meet the contract in
`docs/classes/00-class-contract.md`. Two shallow classes are worth less than
one sound one — nothing here ships without its own load cases, failure-mode
checklist, golden fixtures, and a published-plan benchmark.

## 1. Beds — BUILT (2026-07, see 04-beds.md)

The most-requested absent class: the codebase already grew bed-size
ergonomic anchors (AI-review C1) and `bed_bracket` hardware because users
keep asking. What no existing class provides: a **slat deck** surface type
(distributed live load ≈ two occupants + dynamic factor over 900–2000 mm
spans, slat count/section solved against L/300 + creep), **rail-to-post
hardware capacity** (the bed-rail bracket or barrel-bolt joint carries the
rail end reaction as a moment, not shear — a new joint model), a **centre
rail mandate** above full/queen width, mattress-standard couplings (widths
already in `K.ERGONOMICS`), and a knock-down mandate (a bed that cannot
leave the room is a defect). Engineering risk moderate: static, rectilinear,
no compound geometry — the contract fits it cleanly. Build first.
Built as specified: mattress-master couplings, species-solved slat deck
against the foam-warranty gap floor, barrel-bolt rail connections with the
required-rating pattern for unrated brackets, the centre-rail warranty
mandate, the knock-down mandate enforced by correction, and bunk/crib/murphy
refusals with their regulations named. EN 1725 user mass is the benchmark;
every output states there is no US adult-bed standard.

## 2. Long-span tables and desks — BUILT as a guard (2026-07, see 04-beds.md addendum)

Not a new template — a soundness boundary inside `frame_table`. Past ~1800 mm
the apron-beam model still runs but racking stops scaling (the couple on the
apron–leg joints grows linearly with span while joint capacity is fixed) and
torsional floppiness of the top enters. Needs: span-coupled racking demand,
breadboard/batten stiffening options, and a stated span cap with refusal
beyond it. Ranked second because the app *already generates* 2400 mm tables
— any unsoundness here is live today, and closing it is cheap (the frame
model and contract exist).
Built: the racking score now carries a named span factor (linear to ×0.7 at
the cap) past 1800 mm clear, and the 2400 mm width clamp is a stated contract
refusal (`no_over_span`). Breadboard/batten stiffening options remain future
work — the honest cap stands in until they exist.

## 3. Wall-mounted and floating pieces — BUILT (2026-07, see 03-wall-mounted.md)

Highest injury risk of anything on the list — which cuts both ways: highest
value when done soundly, and the current blanket refusal ("everything stands
on the floor", enforced by correction and taught to the model) is itself a
safety feature that buys time. Needs what nothing else provides: the load
path leaves the furniture entirely — anchor pullout/shear ratings per
substrate (stud, masonry, hollow-wall), stud spacing as a *coupling rule*
(cleat length quantized to 400/600 mm centres), the cantilever moment
carried by the wall, and a refusal wherever substrate is unknown. The
`french_cleat` joint and floating-shelf ergonomics rows are already staged.
Built as specified: substrate required (unknown refused, drywall refused), NDS-sourced withdrawal math, IRC stud coupling, masonry by required-rating. Wall-hung CASEWORK (cabinets) remains future work on this foundation.

## 4. Doored casework completion — BUILT (2026-07, see 05-casework.md)

X-07 already shipped doors: hinge catalog with per-pair capacities, cup
boring, the weight-vs-hinge check, inset/overlay reveals in mm (unit-safe by
the display-boundary rule). Missing for the full class: door sag over span
(diagonal stiffness of a frame-and-panel vs slab door), reveal survival on
tall pairs, and catches/stays as load-rated hardware. Low risk, low effort;
ranked here only because it is an increment, not an absence.
Built as specified: the `casework` contract registered over the three
carcass templates (the frame_table retrofit pattern — every artifact points
at code that already owned the number); door:sag models the SLAB the app
actually builds (a slab cannot rack — the droop is the hinge couple,
W·g·w/(2s), amplified w/s at the free edge, with the Blum width≤height
chart rule as the verified gate); door:reveal prices seasonal movement
against the fitted air (half the swing arrives at the pinned-hinge leaf's
free edge — a red-oak inset pair closes 6.3 mm against its 2 mm meeting
reveal, said out loud, never hidden); and catches graduated to LIVE
load-rated hardware (BB.HW.catchSpec — type/count a pure function of the
corrected leaf, top+bottom on tall doors, touch latch declined past its own
4 kg spring cap, BOM = check = step). No new wire keys, no specVersion
bump. STAYS remain in the READY stratum — nothing in the model lifts yet;
they graduate with the lids workstream, not before.

## 5. Outdoor furniture — BUILT (2026-08, see 06-outdoor.md)

Species durability (`outdoor` flags), exterior finishes, tannin/corrosion
advisories, and Type-I glue routing already exist. What's missing is the
exposure model: wet-cycle movement (ΔMC well past the 6 % indoor ceiling),
drainage as geometry (slat gaps, no water-trapping mortises), fastener
corrosion as a hard gate rather than an advisory, and ground-contact rules.
Moderate risk; demand is seasonal.
Built as a cross-class overlay, not a template: one spec field
(`exposure`, specVersion 10, wire key `ex`) routes durable-species
correction (non-durable exposed → told substitution), Type-I glue, the
exterior finish, stainless/hot-dip-galvanized fastener lines, and a
Wood-Handbook-sourced outdoor ΔMC (covered 6 / exposed 12) through the one
pipeline. Interior sheet goods exposed are refused (no exterior-rated sheet
in the catalog); exposed wall shelves are refused (NDS dry-service anchor
math); water traps and ground contact are named advisories. Wet-cycle
drainage GEOMETRY (slat-top templates, drained mortises) remains future
work — the advisories carry it honestly until a slat-top surface exists.

## 6. Children's furniture — BUILT as a scope class (2026-07, see 07-childrens.md)

F2057/STURDY tipping is already modeled for drawer units, but a children's
class is CPSC territory end-to-end: entrapment gaps (3.5–9 in rule), small
parts, finger pinch, crib rules that this tool should likely *always* refuse
(16 CFR 1219/1220 is not a hobbyist domain). The honest scope is probably
"step stools and toy boxes with lid-support mandates, cribs refused
permanently". Ranked last because getting it wrong injures children and the
refusal today is explicit.
Built — narrower and stricter than the sketch above: a SCOPE (`child`
section) over the templates already sound (table, desk, chair, bookshelf),
never new nursery products. EN 1729 size-mark heights pinned by code, ADULT
loads kept (nothing lightened), the anti-tip anchor mandatory on child
storage regardless of margin, the 16 CFR 1213 entrapment band measured on
chair backs as an honest advisory, EN 71-3 finish guidance — and toy chests
(F963/F834, 16 CFR 1250), high chairs (1231), changing tables (1235), play
yards (1221), and gates (1239) refused with their regulations named, exactly
as cribs and bunks already were. Step stools stayed refused (a perch is fall
height); toy boxes stayed refused (the lid is the hazard).

## This run's decision

Seating is green and gated (contract, physics, goldens in both unit
systems, bad fixtures, benchmark). Beds — the top-ranked next class — needs
its own slat-deck load model, bracket-moment joint model, fixtures, and a
published-plan benchmark to meet the contract; a thinner version would be
exactly the shallow class the rule forbids. It ships as the next
workstream with this profile as its brief, not as a stub in this one.
