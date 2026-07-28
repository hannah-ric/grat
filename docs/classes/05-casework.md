# Casework — the class profile (doored-casework completion)

Templates `cabinet` / `bookshelf` / `nightstand` (specVersion 6 `doors` block,
wire keys `dr`/`hh` — nothing new was minted): the carcass family, restated
onto the contract the way `frame_table` was — every artifact points at code
that already owned the number (the audited sag/strength beam checks,
F2057/STURDY open-drawer tipping, the movement engine, the X-07 door system)
plus the three closures roadmap item 4 named. Code: `src/classes.js`
(`casework`, `CASE_GEOM`), `src/structural.js` door block, `BB.HW.catchSpec`;
hand arithmetic in `test/handcalc.js` [23]–[27].

## The three closures

- **Door sag over span (`door:sag`).** What the app builds is a **slab**
  door — a one-piece panel — and a slab cannot rack out of square: the panel
  is its own shear web (frame-and-panel doors rack at frame joints that do
  not exist here; the check says so instead of borrowing their failure).
  What drops a slab door's free corner is the **hinge couple**: gate statics,
  F = W·g·w/(2s) horizontal on the top hinge fixing over the spread
  s = leafH − 2×100, and every millimetre that fixing yields reads as **w/s**
  millimetres at the free edge (pure geometry). Droop is priced at a 0.5 mm
  design settlement (documented derivation — no maker publishes one) against
  the fitted 2 mm reveal: ≤ half clean, ≤ whole hard, past it FAIL. The width
  gate is the Blum chart rule, verified 2026-07 (ea.blum.com "Number of
  hinges"): *doors should have a height greater than their width*, counts
  valid to 600 mm wide — the same 600 the correction split guard already
  enforces, now owned by one constant (`CASE_GEOM.DOOR_MAX_SINGLE_W`).
  Fixes: continuous (piano) hinge — full-edge carry genuinely clears the
  check — or split a single into a pair.
- **Reveal survival (`door:reveal`).** Slab leaves are solid wood: swing =
  cross-grain width × ct × ΔMC (the same `K.movementMM` and ΔMC the `move:`
  checks use; sheet stock exempt the same way). The hinge edge is pinned by
  its screws, so **half the full swing arrives at the free edge**; an inset
  pair closes its 2 mm meeting reveal from both sides at once (a nominal
  red-oak pair closes 6.3 mm — the honest number, frozen in the armoire
  golden), an overlay pair is re-centred within the ±2 mm plate adjustment
  (Blum CLIP top, verified-approximate), an overlay single just rides over
  the case face. Advisory, not fail, deliberately: fit-in-the-humid-season +
  eased meeting stiles is the discipline every inset slab door has always
  needed — the check's job is to say the number out loud (and offer the
  overlay style as the forgiving remedy).
- **Catches as load-rated hardware (`door:catch`, `BB.HW.catchSpec`).** The
  catches stratum graduated to LIVE: type and count are a pure function of
  the corrected leaf. Demand is the out-of-plumb swing force (m·g·sin 3° —
  derivation; no standard rates residential catches) shared across the
  catches, against the catalog `holdKg` class ratings at the repo's 1.5×
  gate. Magnetic default; roller past 4 kg of leaf; leaves ≥ 1500 mm take a
  catch **top and bottom** so both free corners are held flat. A handleless
  front (pull style `none_touch`) gets its touch latch only up to the 4 kg
  spring cap the catalog row itself publishes — past it the latch is
  **declined**, an honest magnetic catch is substituted, and the
  substitution is carried to every surface (`substituted: true`, the
  pullSpec honesty contract). BOM count = check count = fitting step, all
  one call. **No new wire key**: catch intent derives entirely from door
  geometry + the existing pull style.

## Couplings & refusals

Single leaf > 600 → pair (guard + `doorNotes` disclosure); drawers and doors
share one front style (doors win, told); inset doors recess everything behind
them by door t + reveal (`Parametric.doorSpace`); the hinge must be able to
hang the style it is given (catalog `fronts`); drawer count decrements to the
80 mm opening floor; shelf count decrements to clearance. Refused with
reasons: doors on templates with no case front (dropped **and told** —
`doorNotes`, SCHEMA_DOC scopes `dr` to cabinet/bookshelf); sliding, tambour,
and glazed doors (mechanism doctrine — the grooved-slider and tambour setouts
stay Shop Reference teaching); wall-hung cabinets (floor doctrine; named
future work on the wall_mounted foundation).

## Fixtures

Golden: `advanced-cabinet-imperial`, `walnut-nightstand-2drawer-imperial`,
`ash-bookshelf-metric` (the frozen honest-fail — unchanged), plus the two the
completion added: `oak-armoire-pair-imperial` (tall inset pair: four hinges
by the chart, catches top + bottom, door:sag pass on the tall spread, the
honest red-oak reveal advisory) and `beech-sideboard-doors-metric` (boundary:
the split guard fires, wider-than-tall leaves flag the chart rule, beech
movement outruns the overlay adjustment — and its 19 mm shelf over a 1.36 m
span sags honestly, a second frozen honest-fail; don't "fix" it). Bad:
audit CASE-1…5. Steps carry the door discipline: cups off one fence setting,
reveal shimmed on playing cards, catches at the free stile (top AND bottom on
tall leaves), and the doors come OFF again before finishing.
