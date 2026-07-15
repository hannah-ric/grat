# Blueprint Buddy — Hand-Verification Worksheet (before / after)

Executor: `test/handcalc.js` (permanent, re-runnable — every row computes the
number TWICE: explicit hand arithmetic in the script, and the engine).
"Before" columns are from the audit run at commit `22c88e4`; "after" from the
remediated engine. All lengths mm, stresses MPa, angles degrees.

## Beam mechanics

| Check | Hand arithmetic | Before (engine) | After (engine) | Verdict |
|---|---|---|---|---|
| UDL shelf sag, 5wL⁴/384EI — bookshelf 900×300×1800, span 864, shelf 280×19 red oak | I = 280·19³/12 = 160 043.3; w = 55×9.81/1000 = 0.53955 → 1.95694 | 1.95694 ✓ formula exact | preset now 60 kg/m (BIFMA) and books are sustained: 2×(5·0.5886·864⁴/384EI) = **4.26969** | after = 4.26969 exact ✓ (creep included) |
| Bending stress Mc/I vs MOR/SF4 | M = wL²/8 = 54 923 N·mm; σ = M·9.5/I = 3.260 | 2.989 (55 kg/m) ✓ | 3.260 ✓ (allow 24.8 = 99/4) | exact |
| Midspan point PL³/48EI | direct formula probe | exact | exact | ✓ |
| Cantilever wL⁴/8EI + PL³/3EI | direct formula probe | exact | exact | ✓ |
| Bench frame model (post-audit): apron ¾P·L³/48EI + ½·5wL⁴/384EI, I = 20·80³/12 = 853 333, span 1040, P = 136×9.81 | 3.24411 | n/a (model did not exist) | **3.24411** exact | ✓ |
| Bench seat strip between aprons: span 276, b_eff 238, point + tributary spread | 0.08565 | n/a | **0.08565** exact | ✓ |

## The Shaker-table case (finding F-S2-1)

Shaker Dining Table starter: 1828.8×914.4×749.3 cherry, top 25, aprons
19×101.6, apron span 1618.8, limit L/300 = 5.40 mm.

| Model | Hand | Engine before | Engine after |
|---|---|---|---|
| Top alone spanning leg-to-leg (audit engine) | 9.68 | 9.68 → **status FAIL** on the shipping starter | (model removed) |
| Apron beam (½ spread + ¾ point per apron) | 4.60956 | — | 4.60956 → pass |
| Top strip between aprons (span 781, b_eff 490.5) | 1.54222 | — | 1.54222 → pass |

The flagship starter — a design generations of shops have proven — was
reported structurally failing before the audit and passes on honest arithmetic
after it. A genuinely weak frame still fails (15×60 pine aprons on a 2.09 m
span: 74 mm ≫ 6.97 limit — audit test F-S2-1).

## Whole-piece physics

| Check | Hand | Before | After |
|---|---|---|---|
| Empty tipping angle, ash bookshelf (COG from part masses; atan2(edge, cogY)) | 7.88616° | 7.88616° ✓ | 7.88616° ✓ |
| Seasonal movement 900×0.00369×4 | 13.284 | 13.284 ✓ | 13.284 ✓ |
| Creep / load-duration factor present | required (Wood Handbook ch. 4) | **absent** (grep executed) | present: CREEP_FACTOR 2.0 on sustained cases ✓ |
| F2057 open-drawer margin, 900×480×1200 4-drawer dresser: Σm·g·(z_F−z_open) / [22.7g·(z_load−z_F)+…] | 1.18296 | **no check existed; antiTip=false** | 1.18296 exact → advisory + **anchor mandated** ✓ |
| Slide-capacity estimate: interior litres × 0.24 kg/L | 8.379 kg vs 34 kg pair rating | no check | 8.379 exact ✓ |

## Optimizer arithmetic

| Check | Hand | Before | After |
|---|---|---|---|
| 3×800 mm on a 2438 board: offcut = 2438 − 2×15 − (2400 + 2×3) | **+2 mm** | **−4 mm** (kerf double-subtracted) | +2 mm ✓ |
| Cut offsets 15 / 818 / 1621 | ✓ | ✓ | ✓ |

## Unit trace (symbol by symbol)

MOE table GPa →×1000→ MPa = N/mm² (`structural.js` `E = sp.moe * 1000`).
Loads kg →×9.81→ N; linear kg/m →×9.81/1000→ N/mm. Lengths mm; I mm⁴.
sag = (N/mm)·mm⁴ / ((N/mm²)·mm⁴) = **mm** ✓ ·
σ = N·mm·mm / mm⁴ = **N/mm² = MPa** ✓ vs MOR MPa ✓ ·
movement = mm × %⁻¹-coefficient × %MC = **mm** ✓ ·
density = SG×1000 kg/m³ with volumes ×1e-9 m³ = **kg** ✓.
No 10³/10⁶ hazards found anywhere on the beam/tipping/movement paths — the
pre-audit engine's unit discipline was sound; its failures were model-shape
(aprons ignored, creep absent, drawers never opened), not unit slips.

## Species data spot check (Wood Handbook 12 % MC)

Red oak 12.5/99/0.63/1290 · white oak 12.3/105/0.68/1360 · hard maple
12.6/109/0.63/1450 · cherry 10.3/85/0.50/950 · E. white pine 8.5/59/0.35/380 —
all match FPL-GTR-282 tables 5-3a/5-5; ct/cr match table 13-5. Baltic birch
carries reduced effective values (MOE ~0.7×, MOR ~0.5× solid birch) — comment
corrected to match the numbers (F-S2-9).
