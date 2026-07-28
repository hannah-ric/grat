# Seating — the class profile

Template `chair` (specVersion 7, wire key `se`). Dining side chairs with
solid wood seats; counter and bar stools with compound-splayed legs. The
class that breaks every casework assumption: **loads are cyclic and
eccentric, not static**, and the governing case is a user tipped back onto
two legs.

Everything below is code (`src/classes.js` `seating`, `src/structural.js`
chair block); this page is the human-readable mirror.

## Human factors (with sources)

| Dimension | Band | Source |
|---|---|---|
| Dining seat height | 430–460 mm | Panero & Zelnik, *Human Dimension & Interior Space*; trade convention for 730–760 tables |
| Seat depth | 400–430 mm | P&Z buttock–popliteal, 5th-percentile female fit |
| Seat width | 400–500 mm | P&Z hip breadth + clothing |
| Seat slope | 0–8° rearward (default 3°) | chairmaking convention 3–5°; BIFMA G1 pan range |
| Back rake | 0–8°, capped by straight-post geometry | chairmaking convention; see refusals |
| Crest above seat | 380–600 mm | lumbar-to-shoulder band, P&Z |
| Counter stool seat | 610–660 mm (900 counters) | K.ERGONOMICS `counter_stool_seat` |
| Bar stool seat | 730–780 mm (1060+ bars) | K.ERGONOMICS `bar_stool_seat`; footrest 230 below seat |

Coupling: a stool serving a **stated counter** takes seat height =
counter − 250…300 (snap −270); a stool with no counter stated is **asked**
(`chair:counter` advisory + parser ack). Bands outside → named advisories,
never silence.

## Load cases

| Case | Magnitude | Applied | Acceptance | Trace |
|---|---|---|---|---|
| Seat static | 1334 N (136 kg) | seat centre, gravity, functional | sag ≤ L/300; bending ≥ 1× at MOR/4; joints ≥ 1.5× | **standard-aligned**: BIFMA X5.1 §8 / X5.4 drop-test *proof* mass 300 lb (functional drop is 225 lb; no static seat test exists — honestly relabeled) |
| Back static | 667 N horizontal | at the crest (longer lever than the standard's ≤ 406 mm point — conservative) | rear-post **net-section** bending ≥ 1× at MOR/4 (rail mortise derates 10 mm of width) | **standard**: X5.1-2017 §5/6 functional 150 lbf (Manufacturing Solutions Center lab summary) |
| **Rear tilt** | 1334 N on rear legs + 667 N at crest | occupant over the rear-leg line | side-rail↔rear-post joint couple ≥ 1× (≥ 1.5 clean), resolved over the rail–stretcher arm | **derivation** — arithmetic shown in `test/handcalc.js` [13] |
| Front leg | 334 N horizontal | at the foot (application height unpublished; foot = worst lever, stated) | leg bending ≥ 1× at MOR/4 over the unbraced segment | **standard**: X5.4-2012 §16 functional 75 lb |
| Cyclic durability | 57 kg × 100 000 cycles | seat, repeated | joints ≥ 1.5× at **half** static capacity (cyclic ≈ ½ static — Eckelman practice) | **derivation** standing in for X5.1 §10.3 |
| Footrest step | 1334 N point | footrest midspan | bending ≥ 1× at MOR/4 | **derivation**: full body weight while mounting |

**No BIFMA compliance is claimed anywhere** — residential dining chairs are
not in BIFMA scope and compliance requires physical testing. The
`chair:bifma` check ships that disclosure *inside every integrity report*
(audit SEAT-8 scans all output surfaces for compliance claims).

## The rear-tilt worksheet (hand-verified, handcalc [13]–[15])

Nominal advanced red-oak chair: railY = 445−20−32.5 = **392.5**; arm to the
stretcher = 392.5−200 = **192.5**; crestY = **877.5**.
M = (667/2)·(877.5−392.5) = **161 747.5 N·mm** per side;
R = M/192.5 = **840.2 N** per joint;
M&T capacity 2000 × (SG 0.63/0.50) = **2520 N** → margin **3.00×** PASS.
Pocket screws: 700 × 1.26 = 882 N → **1.05×**; in SPF 490 N → **0.55×** —
which is why screwed seat frames are prohibited at every level.
Back post: σ = 161 747.5 × 22.5 / (28×45³/12) = **17.12 MPa** vs 24.75
allow → 1.45× (pine: 0.86× → honest FAIL, frozen in audit SEAT-6).

## Joint rules

- Seat-frame rails → legs/posts: **required** `mortise_tenon` /
  `loose_tenon` / `kd_bolt` (defaults: advanced / intermediate / beginner);
  **prohibited at every level**: butt screws, pocket screws, biscuits,
  dowels — computed above, disclosed by correction note when asked for.
- Back slats/crest → posts: same mandate (withdrawal under the back force).
- Corner blocks: glue + screws, **structure** — 4 parts with their own
  dimensions, 45° rip note, counted by the fastener engine so BOM =
  drilling instructions.
- Seat panel: screws in slotted holes / figure-8s, notched around the
  posts — never glued (seasonal movement, `move:seat_1`).

## Geometry doctrine

- **Rear posts are one straight piece, floor to crest.** Sawn or bent rear
  legs are REFUSED (short grain at the highest-moment point). Back rake
  comes from opposed crest/slat mortise offsets inside the post depth;
  `backRakeMax = atan((postDepth − slatT)/slat span)` caps it (≈ 4.8–6.3°).
- Rear posts run **deeper fore-aft than wide** (≥ 45 mm) — bending governs.
- Seat slope lives in the side-rail shoulders (the cut-list bevel) with the
  front-leg tops beveled to match.
- Stool legs splay ≤ 10° in both planes; the resultant is **computed**
  (θR = atan(√2·tan s)) and expressed as tool settings: sliding bevel at θR
  sighted 45° across the corner, or blade bevel s° + miter s°. Blanks are
  **ripped with the grain along the leg axis** — sawing the splay into a
  vertical blank costs ~25–30 % of bending strength at 1-in-10 grain slope
  (Wood Handbook slope-of-grain data; JLC / MDPI corroboration) and the
  cut list carries the rule.
- Stools always carry the box-stretcher footrest (structure + ergonomics),
  top ≈ 230 mm below the seat.

## Refusals (stated, never approximated)

| Shape | Reason | Where said |
|---|---|---|
| Upholstered / slip seats | foam+fabric frame clearances are an unmodeled part set — a guessed frame is worse than a refusal | correction note, intent parser, SCHEMA_DOC |
| Arms | BIFMA arm load cases (169/100 lbf) unmodeled | same |
| Sawn / curved / steam-bent rear legs (rake past the cap) | short grain at the rear-leg break point | correctSeat clamp + note + `chair:rake` FAIL defense |
| Rockers, folders, swivels | mechanisms inexpressible; load paths unmodeled | parser + SCHEMA_DOC |
| Splay on a backed chair | offset-rake geometry assumes vertical posts | correctSeat + note |

## Fixture manifest

Golden (frozen complete outputs, `test/golden/`): `oak-dining-chair-imperial`
(nominal, imperial), `maple-counter-stool-metric` (nominal stool + counter
coupling + 5° splay, metric), `walnut-chair-boundary-metric` (every knob at
its edge; rake clamped 8→4.2°; three ergonomic advisories frozen).

Bad fixtures (audit SEAT-1…9, each caught by code): screwed side rail →
rewritten + disclosed + arithmetic shown; 8° sawn-leg rake → clamped +
short-grain note + tampered-spec `chair:rake` FAIL; stool at 750 vs a 900
counter → re-derived 630 + note; seat 500/460/520 → three band advisories;
upholstery/arms/rocker/steam-bent asks → parser refusals with reasons; pine
chair → honest `chair:back` FAIL (the class's second frozen honest-fail);
corner-block BOM/step/cut-list agreement; compliance-claim scan; both-unit
geometry identity.

## Published-plan benchmark

`test/benchmark-chair.js` (manual instrument, asserting) diffs our chair
against Ana White's *"Classic Chairs Made Simple"* line by line: tally
3 OURS-BETTER (sawn 2×4 rear legs → straight posts; pocket-screwed rails →
tenon-class mandate, 0.55× vs gate; vertical back → 4° offset rake),
5 EQUIVALENT (front legs, front/back rails, corner blocks — which the plan
gets right, seat-support sticks, unremarked-vs-named seat depth),
1 TRADITIONAL refusal (the upholstered slip seat). The published joint
choice fails our rear-tilt case outright; the same chair in red oak passes
at 2.55×.
