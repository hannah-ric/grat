# Outdoor exposure — the cross-class overlay

Not a template: **one spec field** (`exposure`: `interior` | `covered` |
`exposed`; specVersion 10, wire key `ex`, append-only enum `EXP`) laid over
every existing class. The AI proposes the exposure WORD only ("garden",
"patio", "porch" → the parser and SCHEMA_DOC both route it); code owns every
consequence. Interior is the default, never rides the wire, and every
pre-exposure design encodes and behaves byte-identically. Code:
`src/knowledge.js` (constants + `effectiveDMC`/`outdoorSubstitute` +
`recommendGlue` routing), `src/spec.js` (correction, `exposureNotes`,
`out_*` validation), `src/structural.js` (movement ΔMC boundary); hand
arithmetic in `test/handcalc.js` [23].

## Material routing (sourced, one source each)

- **Species** — the species table's `outdoor` flags are the single authority
  (white oak, western red cedar, sapele, teak). EXPOSED corrects a
  non-durable species to the deterministic durable substitute — `costTier 1 →
  western_red_cedar` (the box-store outdoor default), else `white_oak` — and
  the correction note says so, with the heartwood honesty: even durable
  species are durable in **heartwood only**; sapwood of every species is
  perishable (Wood Handbook ch. 14 doctrine). COVERED keeps the species and
  validation carries the named `out_species` advisory instead.
- **Glue** — every outdoor build routes to Type I waterproof PVA
  (ANSI/HPVA HP-1 — the Titebond III class; verified on the manufacturer's
  spec page). Oily-species precedence holds: outdoor teak still takes epoxy
  (itself waterproof). The BOM glue line and the assembly steps read the same
  `K.recommendGlue`, so they can never disagree.
- **Finish** — only the exterior-rated catalog row survives outdoors
  (`spar_urethane`: UV blockers + flexible film); interior finishes are
  corrected onto it and told. The recoat-before-it-peels maintenance truth
  rides the safety step.
- **Fasteners** — outdoor duty stamps **stainless or hot-dip galvanized** on
  every metal fastener BOM line (WRCLA/Real Cedar guidance: electroplated
  zinc is too thin), with the blue-black tannin iron-stain advisory named for
  tannic species (oak, cedar — `BB.HW.GATES.outdoorHardware`).
- **Sheet goods** — no exterior-rated sheet exists in the catalog, so an
  EXPOSED design that actually consumes sheet stock (ply drawer boxes, ply
  backs, MDF) is **refused** (`out_sheet` error) with the reason; covered
  gets the advisory. A guessed exterior rating would be worse than the
  refusal.

## Physics honesty (the ΔMC boundary)

`K.effectiveDMC(exposure, climate)`: exposure outranks the indoor climate
preference; interior keeps `CLIMATE_DMC` byte-identically. Outdoor values
(`K.EXPOSURE_DMC`, Wood Handbook ch. 13 / FPL-RN-0268):

- **covered = 6** — WH Table 13-2 exterior installation MC: 12% average,
  9–14% range for most of the US (≈5 points), widened to 6 for humid-coastal
  outdoor monthly EMC spans (e.g. Seattle 12.2–16.5%). verified-approximate.
- **exposed = 12** — sun-dried monthly lows ≈7% (arid-region EMC 4–8.5%
  band) against the 19% MC NDS dry/wet-service boundary under direct
  wetting: 19 − 7 = 12 points. Documented derivation (verified-approximate);
  direct wetting can locally exceed fiber saturation, so this is a floor.

An exposed white-oak top honestly reports **3×** the temperate-indoor
movement (handcalc [23], exact agreement). The wood-runner drawer clearance
and the top-attachment step run on the same boundary and name the outdoor
swing instead of claiming an indoor one.

## Water traps — named advisories, never silent

On every exposed floor-standing piece: `out_legs` (leg bottoms are end grain
— they wick; seal them, chamfer, feet on pavers — **ground contact is
preservative-treated territory the catalog refuses**) and `out_drain`
(upward-facing end grain and joint mouths trap rain; shed, gap, seal).

## Refusals

- `no_exposed_sheet` (frame_table contract): interior sheet goods exposed —
  `Spec.validate out_sheet` error, reason stated.
- `no_exposed_mount` (wall_mounted contract): a wall shelf in direct weather
  — the anchor math is NDS **dry-service** (MC ≤ 19%); wetting crosses into
  wet service (CM = 0.7 on withdrawal), a derating the model does not carry.
  Refused at validation (`out_mount`) and at the parser; a covered porch
  wall stays dry-service and is allowed.

## Fixtures & gates

Golden: `cedar-garden-bench-imperial` (nominal exposed — interior finish
asked, exterior routing frozen; M&T because cedar's SG 0.32 halves screw
capacities below the load path) and `pine-patio-table-metric` (the
correction boundary: pine → cedar, told; frozen ADVISORY on `duty:` — cedar
dents, which is true). Legacy: `v10-cedar-porch-bench` anchors specVersion
10. Audit OUT-1…OUT-6; battery parser fixtures ("a teak garden bench", "an
oak desk for the patio" → corrected and told); handcalc [23] (43/43).
