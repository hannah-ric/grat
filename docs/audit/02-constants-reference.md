# Blueprint Buddy — Physical Constants, Formulas, Thresholds (Phase 1 reference table)

Line numbers refer to commit `22c88e4` (pre-remediation). Where remediation moved
a value, the new home is noted in the register.

## Material properties (knowledge.js)

| Constant | Value | Location | Ground truth |
|---|---|---|---|
| Red oak MOE/MOR/SG/Janka/ct/cr | 12.5 GPa / 99 MPa / 0.63 / 1290 / 0.00369 / 0.00158 | knowledge.js:29 | Wood Handbook (FPL-GTR-282) Table 5-3a at 12% MC; Table 13-5 coefficients ✓ |
| White oak | 12.3 / 105 / 0.68 / 1360 / 0.00365 / 0.00180 | knowledge.js:36 | ✓ |
| Hard maple | 12.6 / 109 / 0.63 / 1450 / 0.00353 / 0.00165 | knowledge.js:43 | ✓ |
| Black walnut | 11.6 / 101 / 0.55 / 1010 / 0.00274 / 0.00190 | knowledge.js:50 | ✓ |
| Cherry | 10.3 / 85 / 0.50 / 950 / 0.00248 / 0.00126 | knowledge.js:57 | ✓ |
| White ash | 12.0 / 103 / 0.60 / 1320 / 0.00274 / 0.00169 | knowledge.js:64 | ✓ |
| Yellow-poplar | 10.9 / 70 / 0.42 / 540 / 0.00289 / 0.00158 | knowledge.js:71 | ✓ |
| Eastern white pine | 8.5 / 59 / 0.35 / 380 / 0.00212 / 0.00071 | knowledge.js:78 | ✓ |
| Baltic birch ply (effective) | 10.0 / 55 / 0.68 / 1260 / ~0 / ~0 | knowledge.js:85 | ~20%+ reduction vs solid birch for cross-plies; movement exempt ✓ |
| WIDE_TOP_MM | 500 | knowledge.js:95 | movement advisory trigger |
| CLIMATE_DMC | arid 2 / temperate 4 / humid 6 (%MC) | knowledge.js:295 | indoor seasonal swing |
| movementMM formula | width × (ct\|cr) × ΔMC | knowledge.js:296-301 | Wood Handbook ch. 13 dimensional change |
| SOLID_THICKNESS snap | [12,15,19,20,25,32,38,45] | knowledge.js:304 | |
| SHEET_THICKNESS snap | [6,12,18] | knowledge.js:305 | |

## Lumber catalog (knowledge.js:243-264)

| Constant | Value | Location |
|---|---|---|
| Nominal→actual map (1x2…8/4x4) | e.g. 1x4 = 19×89 | knowledge.js:246-252 |
| STOCK_LENGTHS | 1829/2438/3048/3658 mm (6/8/10/12 ft) | knowledge.js:254 |
| KERF | 3 mm | knowledge.js:255 |
| END_TRIM | 15 mm per board end | knowledge.js:256 |
| SHEET | 1220×2440, t ∈ {6,12,18} | knowledge.js:257 |
| SHEET_FRACTIONS | quarter 610×1220 / half 1220×1220 / full | knowledge.js:259-263 |
| BASE_PRICE_PER_M, TIER_FACTOR | per-nominal $/m × cost-tier | knowledge.js:272-276 |

## Structural engine (structural.js)

| Constant / formula | Value | Location | Basis |
|---|---|---|---|
| GRAV | 9.81 m/s² | structural.js:21 | |
| SAFETY_FACTOR | 4 (on MOR) | structural.js:22 | see register F-PHY-4: basis documented in remediation |
| SAG_LIMIT_RATIO | L/300 | structural.js:23 | furniture visible-sag practice |
| CANT_LIMIT_RATIO | L/150 | structural.js:24 | 2× span limit at free end |
| MOVEMENT_LIMIT | 3 mm | structural.js:25 | constrained-panel advisory |
| Load presets | display 10 kg/m; books 55 kg/m; heavy 90 kg/m; seating 120 kg/seat; worktop 75 kg dist + 90 kg edge | structural.js:38-44 | books ≈ 37 lb/ft (BIFMA X5.9 shelf ≈ 40 lb/ft) |
| JOINT_RATING rackPts/capN | butt 2.0/500 · pocket 3.0/700 · dowel 3.5/800 · rabbet 3.5/900 · locking 4.0/1100 · dado 4.0/1200 · HB dovetail 5.5/1800 · M&T 6.0/2000 (N at SG 0.5, ×SG/0.5) | structural.js:65-74 | transparent heuristic |
| I_rect | b·h³/12 | structural.js:77 | |
| DEFL.udlSS | 5wL⁴/384EI | structural.js:79 | |
| DEFL.pointSS | PL³/48EI | structural.js:80 | |
| DEFL.udlCant | wL⁴/8EI | structural.js:81 | |
| DEFL.pointCant | PL³/3EI | structural.js:82 | |
| MOM (udlSS wL²/8, pointSS PL/4, udlCant wL²/2, pointCant PL) | structural.js:84-89 | |
| seatsFor | round(span/550) | structural.js:90 | |
| E conversion | GPa → MPa ×1000 | structural.js:210 | units trace §05 |
| Stand margin (custom) | COG ≥ 15 mm inside hull | structural.js:256 | |
| Tipping | angle = atan2(edge dist, COG height); antiTip if h/d > 2.5 or loaded angle < 10°; fail < 5° | structural.js:430-453 | see F-PHY-6 (F2057 alignment) |
| Racking pass | score ≥ 40 | structural.js:495 | heuristic, labeled |
| Leg slenderness | L/t ≤ 20 (braced ×0.6) | structural.js:517-534 | rule of thumb |
| Joint adequacy margin | ≥ 1.5 pass, ≥ 1 advisory | structural.js:576 | |
| Strength margin | allow = MOR/SF; pass ≥ 1.25 | structural.js:369-373 | |
| Movement cross-width threshold | ≥ 300 mm | structural.js:597 | |

## Parametric layer (parametric.js)

| Constant | Value | Location |
|---|---|---|
| RAIL_H / RAIL_T | 60 / 20 mm drawer rails | parametric.js:16 |
| DEFAULT_OPENING_H | 130 mm | parametric.js:17 |
| MIN_LEG_REVEAL (nightstand) | 120 mm | parametric.js:18 |
| Table/desk overhang 35, bench 20, nightstand 20 | parametric.js:198, 284 |
| Slide clearances | box W = opening − 25 (12.5/side); H = opening − 15; rear setback 25 | parametric.js:114-117 | see F-CRA-2 (12.7/side required) |
| Wood-runner clearances | −4 W, −10 H, −20 D | parametric.js:123-125 |
| Drawer front | 19 mm; inset gap 2 mm/side; overlay ≤ +10 mm/side | parametric.js:127, 154-158 |
| Drawer bottom | 6 mm in 6 mm groove, 10 mm up (center 13) | parametric.js:148-149 |
| Drawer box thickness | 12 mm Baltic birch (solidT 15 dead path) | parametric.js:73-74 |
| Bookshelf bottom lift | 40 mm | parametric.js:254 |
| Back panel | 6 mm, −12 on W/H (6 mm rabbets) | parametric.js:265, 375 |
| Toe kick | 90 high, 75 setback (+9.5 board half) | parametric.js:346, 367 |
| Cabinet drawer-zone share | 0.6 × body height | parametric.js:384 |

## Derived plans (plans.js)

| Constant | Value | Location |
|---|---|---|
| JOINT_ALLOWANCE (per inserted end) | butt/pocket/dowel 0 · dado/rabbet/locking 6 · M&T 30 · HB dovetail 12 | plans.js:13-17 (see F-CRA-1: made thickness-aware in remediation) |
| BF_MM3 | 2,359,737 mm³/bd ft | plans.js:75 (duplicated packing.js:247, units.js:33 — see F-SYS-1) |
| BOM fallback sheet | 1525×1525, t ∈ {6,12,15,18}, 1.25 waste | plans.js:104-126 (contradicts LUMBER.SHEET — see F-SYS-2) |
| Solid-lumber waste factor | 1.3 | plans.js:114, packing.js:250 |
| Fastener counts | 2 screws/joint, 2 dowels/joint, 6 figure-8s/top, 8 M4/slide pair, 4 front screws/drawer, 4 pins/shelf | plans.js:137-158 |

## Spec correction & audit (spec.js)

| Constant | Value | Location |
|---|---|---|
| Overall clamps (non-custom) | W 250–2400, D 200–1200, H 120–2400 | spec.js:343-345 |
| topThickness 12–45 snap; legThickness 32–100 snap; apronThickness 15–25; apronHeight 60–160; apronInset 0–30; shelfThickness 12–32; sideThickness 12–25; shelfCount 0–8 | spec.js:351-358 |
| Apron fit rule | apronHeight ≤ height − top − 60 (min 40) | spec.js:363 |
| Leg fit rule | legT ≤ min(W,D)/4 | spec.js:364 |
| Drawer count clamp | 1–4; opening ≥ 80 auto-reduce | spec.js:376-382 |
| Shelf spacing auto-reduce | spacing ≥ shelfThickness + 20 | spec.js:391 |
| Custom clamps | l 10–3000, w 5–1500, t 3–200→snap, pos ±3000, ≤40 parts, ≤80 conns | spec.js:241-285 |
| Rotation snap | ≤ 2.5° off square | spec.js:261 |
| AUDIT epsilons | BELOW 0.5 / FLOOR 2 / ENVELOPE 2 / PROUD 60 / PEN 2 / CONTACT 5 / FOOT_Y 5 / FOOT_PT_Y 30 | spec.js:415-424 |
| Drawer validation | opening ≥ 80 error; width > 750 advisory; pull height > 1100 advisory; box depth ≥ 120 | spec.js:575-590 (80/750/1100 duplicate K.ERGONOMICS — see F-SYS-3) |

## Units (units.js)

| Constant | Value | Location |
|---|---|---|
| IN / FT | 25.4 / 304.8 mm | units.js:31 |
| KG_LB / KGM_LBFT | 2.2046… / ÷3.2808 | units.js:32 |
| M3_PER_BDFT | 0.002359737 | units.js:33 |
| Default prefs | imperial, 1/16, dual off | units.js:35 |

## AI / protocol (ai.js, codec.js, api/chat.js)

| Constant | Value | Location |
|---|---|---|
| MAX_TOKENS 1000 / MAX_CONTINUATIONS 2 / VERBATIM_TURNS 6 | ai.js:34-36 |
| Level matrix text (hand-copied) | ai.js:48, knowledge.js:318 | see F-SYS-4 digest drift guard |
| Vision ergonomic ranges (hand-copied) | ai.js:432 | see F-SYS-4 |
| estimateTokens | chars/3.6 | codec.js:236 |
| Proxy caps | 1024 tokens, 32 messages, 5 MB | api/chat.js:19-21 |

## 2026 knowledge expansion addendum (species 9 → 22, joints 8 → 21, finishes 4 → 10, + GLUES)

Every physical constant added by the expansion keeps the one-source rule: the row in
`src/knowledge.js` is the single home, and the generated digests / self-tests cover it.

| Addition | Values | Ground truth |
|---|---|---|
| Douglas-Fir (coast) | MOE 13.4 / MOR 85 / SG 0.48 / Janka 620 / ct 0.00267 / cr 0.00165 | Wood Handbook 5-3a + 13-5 (Coast type) ✓ |
| Southern Yellow Pine (loblolly) | 12.3 / 88 / 0.51 / 690 / 0.00259 / 0.00165 | WH 5-3a + 13-5, loblolly basis ✓ |
| SPF (Engelmann floor of grade group) | 8.9 / 64 / 0.35 / 390 / 0.00248 / 0.00130 | WH 5-3a + 13-5; pinned to group's weakest member (honesty rule) |
| Western Red Cedar | 7.7 / 52 / 0.32 / 350 / 0.00234 / 0.00111 | WH 5-3a + 13-5 ✓ |
| Soft Maple (red) | 11.3 / 92 / 0.54 / 950 / 0.00289 / 0.00137 | WH 5-3a + 13-5 ✓ |
| Hickory (shagbark, true-hickory group) | 14.9 / 139 / 0.72 / 1880 / 0.00411 / 0.00259 | WH 5-3a + 13-5 ✓ |
| American Beech (highest ct in catalog) | 11.9 / 103 / 0.64 / 1300 / 0.00431 / 0.00190 | WH 5-3a + 13-5 ✓ |
| Yellow Birch | 13.9 / 114 / 0.62 / 1260 / 0.00338 / 0.00256 | WH 5-3a + 13-5 ✓ |
| Red Alder | 9.5 / 68 / 0.41 / 590 / 0.00256 / 0.00151 | WH 5-3a + 13-5 ✓ |
| Sapele | 12.4 / 111 / 0.67 / 1360 / ct 0.00253* / cr 0.00183* | Wood Database mechanicals; *derived from total shrinkage scaled by khaya's 13-5 slope — disclosed in-file |
| Teak (`oily: true`) | 12.3 / 97 / 0.66 / 1070 / 0.00186 / 0.00101 | WH imported table + 13-5 official rows |
| MDF (effective panel values) | 3.0 / 25 / 0.75 / — / ~0 / ~0 | conservative MDF class values; honest-fail under books + creep by design |
| Hardwood plywood (effective) | 8.0 / 40 / 0.55 / — / ~0 / ~0 | rated below Baltic (thinner faces, core voids), documented in-file |
| Joint strengths (13 new joints) | JOINERY.strength + Structural.JOINT_RATING | FWW #203 lab test + woodgears.ca, aged for seasonal behavior |
| GLUES (5 rows) | open/clamp/cure, water rating, foodContact | ANSI/HPVA types; FDA 21 CFR 175.105 for Type I PVA (indirect food contact, cured) |
| Food-contact finishes | mineral_oil / board_butter / tung_pure | non-drying mineral oil rags are NOT self-heating; tung rags are (flag preserved) |
| New nominals | 2x3/2x6/2x8/2x10/2x12 (38 mm), 4x4 (89×89) | landed with price rows in the same commit (NaN guard tested) |
| POST_THICKNESS += 89 | custom posts snap to buyable 4×4 | |
| GLUE_LINE_PENALTY_MM2 | 400 (packing.js) | labor charge per glue line when a glue-up challenges a direct fit |
| 16 ft stock (4877) | **deliberately absent** | pack1D opens longest-first; would shift every plan onto boards most people cannot transport |

## 2026 hardware repository addendum (src/hardware.js, BB.HW)

Doctrine: the AI proposes hardware STYLE only (`hp` wire key, PUL enum); code computes
every rating, count, position, and bore — all provenance-ready arithmetic in `BB.HW`.

| Constant / rule | Value | Ground truth |
|---|---|---|
| Door hinge count | max(height band 900/1600/2000/2400, ceil(kg/3.5), floor 2) | Blum-class count/weight charts, conservative floor |
| Cup hinge boring | Ø35 × 13 deep, boring distance 3–7 (default 5), plate line 37 | Blum published boring geometry; overlay ≈ TB + 11 − plate |
| Gas strut | F = 1.3·W·g·(Lcg/d), d ≈ 0.2 × lid depth, 2 struts > 600 wide, snap UP to 50…200 N | gas-spring vendor moment calculators |
| Lid stay torque | ΣT_rated ≥ 1.25 × W·g × Dcg; classes 1.1–6.8 N·m | retail soft-down stay classes |
| Pull sizing | CTC ≈ width/3 snapped DOWN into 64…457 series; 2 pulls > 750; knob < 300; M4 len = front + 6 | Amerock-class series + kitchen-trade placement |
| Slide family | 22/34/45/45/100 kg classes; picked by computed load (0.24 kg/L household) | KV/Blum spec sheets; 34 kg class stays default |
| Undermount regime | box = opening − 27 wide, − 19 tall, depth = slide length, 12 mm bottom recessed 12.7, back notched | Blum Tandem-class documentation |
| Wooden runner fit | vertical clearance = drawer height × ct × ΔMC + 1 floor | the movement engine, applied to drawer fitting |
| Rule joint | radius = top t − fillet(≥5) − pin height(≈3); pin at arc center + 1 outboard | FWW rule-joint canon |
| 32 mm system | 5 mm pins, 32 pitch, 37 setback, 9 deep (same 37 as the cup-hinge plate line) | system-32 casework standard |
| kidSafe gate (staged) | torsion/soft-down stays required, cord stops refused, ≥12 mm ventilation, no auto-latch | ASTM F963 toy-chest provisions |
| SLIDE_LENGTHS += 533, 610 | deep-case slides (21/24 in) | append-only |
| HNG/LID wire enums | **deliberately absent** | no door/lid geometry exists yet — style intent without a code consumer would invert the founding rule |
