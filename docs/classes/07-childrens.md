# Children's — the class profile

A SCOPE class, not a template (specVersion 10 in this tree — 11 after
integration; wire key `ch`): `child: { ageBand }` overlays a template the app
already builds soundly — table, desk, chair (seating class), bookshelf — with
the safety regime children need. Null means adult, which is what every design
saved before it was. Code: `src/classes.js` (`childrens`, `CHILD_GEOM`,
`scope: 'child'` — `forTemplate` skips scope classes; `runChecklist(res.spec)`
overlays them), `src/knowledge.js` (`K.CHILD`), the child blocks in
`src/spec.js` and `src/structural.js`; hand arithmetic in `test/handcalc.js`
[23].

## The sizing anchor (sourced)

- **EN 1729-1 size-mark pairs** — the school-furniture standard, the one
  citable children's sizing anchor. Four bands, each one mark: toddler =
  mark 1 (seat **260** / table **460**, ≈3–4 yr), preschool = mark 2
  (**310/530**, 4–6), school = mark 3 (**350/590**, 6–8), preteen = mark 4
  (**380/640**, 8–11). Cross-checked against multiple published sizing guides
  (ESPO chair & table guide, GLS listings, edu-quip/OWL buying guides,
  2026-07 — the standard text is paywalled): **verified-exact**. One source:
  `K.CHILD`. Age ≥ 12 is ADULT — EN 1729 mark 5 (430/710) meets the adult
  bands the tool already builds, and the parser says so.
- **The band IS the height.** Correction pins table/desk `overall.height` to
  the band's table height and the chair seat to the band's seat plan; an
  asked-for height is refused and disclosed (`childNotes`, EN 1729 mark
  named). Seat width/depth/back scale the adult seating nominal by the
  seat-height ratio, round-5 (**derivation** — EN 1729's t4/b3 plan
  dimensions are not publicly published; arithmetic in `CHILD_GEOM` and
  handcalc [23]). The apron band caps at 80 so the band's own thigh room
  survives (derivation, documented in `CHILD_GEOM`).

## The safety regime, in code

- **Adult loads, kept.** Nothing is lightened — adults sit on kids' chairs
  (documented derivation, stated in the contract's load cases and in the
  `child:basis` check every child output carries). The toddler chair proves
  the point: the shorter rail-to-stretcher couple arm RAISES the rear-tilt
  joint demand (1046 N vs the adult chair's 840 N, handcalc [23]) under the
  same 667 N back force, and the class-mandated tenon-class joinery still
  clears the 1.5× gate.
- **Anchor mandate** (`tip` / `tip_f2057` child extension): child-scoped
  storage (bookshelf) takes the anti-tip wall anchor as a MANDATORY BOM line
  regardless of computed margin — CPSC **Anchor It!** guidance adopted as a
  mandate, stricter than F2057's clothing-storage scope. Any child-scoped
  drawered piece (a kids desk's pencil drawer included) is inside the F2057
  1.5× anchor gate whatever its height or template; the 22.7 kg pull is
  unchanged. The check text says why (audit KID-3).
- **Head entrapment** (`child:entrap`, child chairs): bounded back openings
  measured on the BUILT parts (probe/builder parity) against the
  **16 CFR 1213** band — passes the wedge block (~89 mm,
  verified-approximate) but not the 9 in / 230 mm sphere (verified-exact,
  §1213.3). Honestly scoped: the band is bunk-guardrail law, applied to
  chair backs as an ADVISORY (the nominal school chair's 140 mm seat→slat
  opening fires it), never a compliance claim. Assembly checks carry the
  tape-measure rule.
- **Finish safety** (`child_finish` advisory, every child design): names
  **EN 71-3** (migration of certain elements) as the certified route;
  food-contact-class catalog finishes (pure tung oil, mineral oil, board
  butter) are named as such with the full-cure caveat; an uncertified film
  finish is labeled "commonly considered inert once cured — practice, not a
  certificate"; premixed hardware-store shellac is called out as NOT
  food/toy certified even though shellac resin is FDA-listed (21 CFR
  175.300). No product is blessed beyond what was verified.
- **Backed floor seating only:** a backless perch or counter/bar stool puts
  a small child at fall height — `correctSeat`'s child branch forces
  backHeight > 0 and counterHeight = null, and says so.

## Refusals — regulations named, before creation

Fired by the intent parser's children's block (ahead of any template
creation) and taught to the hosted model in SCHEMA_DOC (all pairings
verified 2026-07): **toy chests / hinged-lid boxes** (ASTM F834 lid-support
requirements — folded into ASTM F963, mandatory under **16 CFR 1250**),
**high chairs / boosters** (**16 CFR 1231** / ASTM F404), **changing
tables** (**16 CFR 1235** / ASTM F2388), **play yards / playpens**
(**16 CFR 1221** / ASTM F406), **safety gates / enclosures** (**16 CFR
1239** / ASTM F1004) — plus the bed class's standing refusals restated so
the children's surface tells one story: **cribs/bassinets/toddler beds**
(16 CFR 1219/1220, permanent) and **bunk/loft beds** (ASTM F1427 /
16 CFR 1213). A "changing table height" edit phrase never trips the refusal
(negative lookahead).

## Fixtures

Golden: `maple-kids-table-metric` (school band; the 750-asked/590-delivered
pin and the finish advisory frozen), `oak-kids-chair-imperial` (derived
child seat plan, adult-magnitude tilt margins on child geometry,
`child:entrap` + `child:basis` frozen). Bad: audit KID-1…KID-6 + battery
children cases ("a table for my toddler" creates on the band and is told;
"a toy box with a lid" refuses with F834/16 CFR 1250 named; bare "kids
desk" ASKS the age — the band is the geometry). Legacy:
`v10-maple-kids-desk.json` anchors the migration corpus at the current
version. Future work, stated: child-scoped casework (nightstand/cabinet),
filler slats/panels to close in-band chair openings, and a children's-plan
benchmark.
