/* Blueprint Buddy — hand-verification worksheet executor (audit Phase 2B).
 * Every number below is computed TWICE: once by explicit hand arithmetic
 * written out in this file, once by the engine. Run: node test/handcalc.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const SRC = ['knowledge.js', 'hardware.js', 'icons.js', 'materials.js', 'geometry.js', 'units.js', 'classes.js', 'spec.js', 'parametric.js', 'structural.js', 'fasteners.js', 'packing.js',
  'plans.js', 'drafting.js', 'gltf.js', 'exports.js', 'history.js', 'codec.js', 'ai.js', 'store.js', 'gallery.js', 'joinery3d.js', 'selftest.js'];
for (const f of SRC) vm.runInThisContext(fs.readFileSync(path.join(__dirname, '..', 'src', f), 'utf8'), { filename: f });
const { Spec, Parametric, Structural, K, Plans, Packing, Units } = globalThis.BB;
Units.set({ system: 'metric' });

const rows = [];
const row = (name, hand, engine, tolPct) => {
  const err = Math.abs(hand - engine) / Math.max(1e-12, Math.abs(hand)) * 100;
  const pass = err <= (tolPct === undefined ? 1 : tolPct);
  rows.push({ name, hand, engine, errPct: err, pass });
  console.log(`${pass ? '✓' : '✗'} ${name}\n    hand=${hand.toPrecision(6)}  engine=${engine.toPrecision(6)}  err=${err.toFixed(3)}%`);
};
const pipeline = raw => {
  const spec = Spec.correctSpec(raw);
  const model = Parametric.build(spec);
  return { spec, model };
};

/* =========================================================================
 * 1. Distributed-load shelf: 5wL⁴/384EI, I = b·h³/12, h in bending direction.
 *    Bookshelf 900×300×1800, sides 18 → shelf span L = 900 − 2×18 = 864 mm.
 *    Shelf section: b = depth − 20 = 280 mm, h = 19 mm.
 *    Books preset (post-audit): 60 kg/m (BIFMA X5.9) ⇒ w = 60×9.81/1000 N/mm.
 *    Books are SUSTAINED: reported sag = elastic × CREEP_FACTOR (2.0).
 *    Red oak MOE 12.5 GPa = 12500 MPa.
 * ========================================================================= */
{
  const L = 864, b = 280, h = 19, E = 12500;
  const kgPerM = Structural.LOAD_PRESETS.books.kgPerM;
  const w = kgPerM * 9.81 / 1000;              // N/mm
  const I = b * h * h * h / 12;                // 280×6859/12 = 160,043.333 mm⁴
  const sagHand = Structural.CREEP_FACTOR * 5 * w * Math.pow(L, 4) / (384 * E * I);
  const { spec, model } = pipeline({
    meta: { name: 'HC shelf', template: 'bookshelf', level: 'beginner', units: 'mm' },
    overall: { width: 900, depth: 300, height: 1800 },
    wood: { species: 'red_oak' }, structure: { shelfCount: 4, sideThickness: 18, shelfThickness: 19, backPanel: true }
  });
  const integ = Structural.computeIntegrity(spec, model, {});
  const sagEng = integ.checks.find(c => c.id === 'sag:shelf_1').data.sagMM;
  console.log(`\n[1] UDL shelf. I = ${b}×${h}³/12 = ${I.toFixed(1)} mm⁴; w = ${kgPerM}×9.81/1000 = ${w.toFixed(5)} N/mm`);
  row('UDL shelf sag 5wL⁴/384EI (mm)', sagHand, sagEng);

  /* Bending stress Mc/I vs MOR/SF: M = wL²/8; c = h/2. */
  const M = w * L * L / 8;
  const stressHand = M * (h / 2) / I;
  const strCheck = integ.checks.find(c => c.id === 'str:shelf_1');
  const stressEng = parseFloat(strCheck.value.match(/([\d.]+) MPa/)[1]);
  console.log(`\n[2] Bending: M = wL²/8 = ${M.toFixed(0)} N·mm; σ = Mc/I = ${stressHand.toFixed(3)} MPa; allow = MOR ${K.WOOD_SPECIES.red_oak.mor}/${Structural.SAFETY_FACTOR} = ${(K.WOOD_SPECIES.red_oak.mor / Structural.SAFETY_FACTOR).toFixed(1)} MPa`);
  row('shelf bending stress Mc/I (MPa)', stressHand, stressEng, 2);
}

/* =========================================================================
 * 2. Midspan point load through the POST-AUDIT frame model. Bench 1200×380×450
 *    ash, seat 32, legT 60, aprons 20×80 (defaults), inset 12.
 *    Hand geometry: frameW = 1200−40 = 1160; apron span = 1160−120 = 1040.
 *    frameD = 340; apron offset off = 170−12−10 = 148; strip span = 2·148−20
 *    = 276; bEff = min(1200, 0.5·276+100) = 238.
 *    Seating preset: P = 136×9.81; seats = round(1040/550) = 2 → one midspan
 *    point + (seats−1)·P spread. APRON: half the spread + ¾ of the point.
 *    STRIP: full point + tributary spread (total × bEff/apronSpan).
 * ========================================================================= */
{
  const { spec, model } = pipeline({
    meta: { name: 'HC bench', template: 'bench', level: 'beginner', units: 'mm' },
    overall: { width: 1200, depth: 380, height: 450 },
    wood: { species: 'ash' }, structure: { topThickness: 32, legThickness: 60 }
  });
  const integ = Structural.computeIntegrity(spec, model, {});
  const E = K.WOOD_SPECIES.ash.moe * 1000;
  const P = Structural.LOAD_PRESETS.seating.kgSeat * 9.81;
  const apSpan = 1040, apB = 20, apH = 80;
  const Iap = apB * apH ** 3 / 12;                       // 853,333 mm⁴
  const wExtra = (1 * P) / apSpan;                       // second seat as UDL
  const sagApronHand = 0.75 * P * apSpan ** 3 / (48 * E * Iap)
    + 5 * (wExtra / 2) * apSpan ** 4 / (384 * E * Iap);
  const apronEng = integ.checks.find(c => c.id === 'sag:apron:top_1').data.sagMM;
  console.log(`\n[3] Frame model, bench. I_apron = ${Iap.toFixed(0)}; P = ${P.toFixed(0)} N; apron span ${apSpan}`);
  row('apron beam sag: ¾·PL³/48EI + ½·5wL⁴/384EI (mm)', sagApronHand, apronEng);
  const stripSpan = 276, bEff = 238;
  const Ist = bEff * 32 ** 3 / 12;
  const tribut = (1 * P) * (bEff / apSpan);
  const sagStripHand = P * stripSpan ** 3 / (48 * E * Ist)
    + 5 * (tribut / stripSpan) * stripSpan ** 4 / (384 * E * Ist);
  const stripEng = integ.checks.find(c => c.id === 'sag:top_1').data.sagMM;
  row('seat strip sag between aprons (mm)', sagStripHand, stripEng);
}

/* =========================================================================
 * 3. Cantilever: wL⁴/8EI + PL³/3EI. Custom shelf with one support → cant.
 * ========================================================================= */
{
  const w = 0.5, L = 300, E = 12500, I = 100000;
  const hand = w * Math.pow(L, 4) / (8 * E * I) + (200 * Math.pow(L, 3)) / (3 * E * I);
  const eng = Structural.DEFL.udlCant(w, L, E, I) + Structural.DEFL.pointCant(200, L, E, I);
  console.log('\n[4] Cantilever formulas direct');
  row('cantilever wL⁴/8EI + PL³/3EI (mm)', hand, eng);
}

/* =========================================================================
 * 4. Tipping angle from computed COG — tall bookshelf 900×300×1800 ash.
 *    Hand: rebuild the mass sum from the model parts, then
 *    angle = atan2(min horizontal distance COG→base edge, COG height).
 * ========================================================================= */
{
  const { spec, model } = pipeline({
    meta: { name: 'HC tip', template: 'bookshelf', level: 'beginner', units: 'mm' },
    overall: { width: 900, depth: 300, height: 1800 },
    wood: { species: 'ash' }, structure: { shelfCount: 4, sideThickness: 18, shelfThickness: 19, backPanel: true }
  });
  const dens = k => K.WOOD_SPECIES[k].sg * 1000;
  let mass = 0, my = 0, mx = 0, mz = 0;
  for (const p of model.parts) {
    const d = (p.material === 'baltic_birch' ? dens('baltic_birch') : dens('ash'));
    const m = p.size.w * p.size.h * p.size.d * 1e-9 * d;
    mass += m; my += m * p.pos.y; mx += m * p.pos.x; mz += m * p.pos.z;
  }
  const cog = [mx / mass, my / mass, mz / mass];
  // base rect from side panels: x ∈ [−450, 450], z ∈ [−150, 150]
  const edge = Math.min(450 - cog[0], cog[0] + 450, 150 - cog[2], cog[2] + 150);
  const angHand = Math.atan2(edge, cog[1]) * 180 / Math.PI;
  const integ = Structural.computeIntegrity(spec, model, {});
  console.log(`\n[5] Tipping: piece mass=${mass.toFixed(1)} kg, COG=(${cog.map(v => v.toFixed(1)).join(', ')}), nearest base edge=${edge.toFixed(1)} mm`);
  row('empty tipping angle atan2(edge, cogY) (°)', angHand, integ.tip.angEmpty);
  console.log(`    engine loaded angle = ${integ.tip.angLoaded.toFixed(2)}° with ${integ.tip.loadKg.toFixed(1)} kg on the top surface`);
}

/* =========================================================================
 * 5. Seasonal movement: width × coefficient × ΔMC.
 *    900 mm red oak tangential, ΔMC 4% ⇒ 900 × 0.00369 × 4 = 13.284 mm.
 * ========================================================================= */
{
  const hand = 900 * 0.00369 * 4;
  row('movement 900×0.00369×4 (mm)', hand, K.movementMM(900, 'red_oak', 'tangential', 4), 0.01);
}

/* =========================================================================
 * 6. Unit trace, symbol by symbol (documented check, printed for the record).
 *    MOE table GPa → ×1000 → MPa = N/mm². Loads kg → ×9.81 → N.
 *    Linear kg/m → ×9.81/1000 → N/mm. All lengths mm. I mm⁴.
 *    sag = N/mm × mm⁴ / (N/mm² × mm⁴) = mm ✓ ; σ = N·mm × mm / mm⁴ = N/mm² ✓
 * ========================================================================= */
console.log('\n[6] Unit trace: sag [ (N/mm)·mm⁴ / ((N/mm²)·mm⁴) ] = mm ✓ ; stress [ N·mm·mm / mm⁴ ] = MPa ✓');

/* =========================================================================
 * 7. Creep: Wood Handbook ch.4 — sustained load roughly DOUBLES elastic
 *    deflection over time. Question at audit: does any sag check carry a
 *    load-duration factor? (grep executed below on structural source.)
 * ========================================================================= */
{
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'structural.js'), 'utf8');
  const hasCreep = /creep|duration|sustained|long.?term/i.test(src);
  console.log(`\n[7] Creep factor present in structural.js: ${hasCreep}`);
  rows.push({ name: 'creep/load-duration factor present', hand: 1, engine: hasCreep ? 1 : 0, errPct: hasCreep ? 0 : 100, pass: hasCreep });
}

/* =========================================================================
 * 8. Shaker starter (1829×914×749 cherry, top 25, aprons 19×101.6) through
 *    the POST-AUDIT frame model, fully by hand:
 *    apron span = (1828.8−70) − 140 = 1618.8 mm; I_ap = 19·101.6³/12.
 *    Worktop preset: 75 kg spread (halved per apron) + 90 kg point (×¾).
 *    Strip: span = frameD − 2·(12.7+19) = 780.99…; engine ropes it to the
 *    apron pair: 2·off − t with off = 844.4/2 − 12.7 − 9.5.
 * ========================================================================= */
{
  const g = { meta: { name: 'Shaker', template: 'table', level: 'intermediate', units: 'mm' },
    overall: { width: 1828.8, depth: 914.4, height: 749.3 }, wood: { species: 'cherry' },
    structure: { topThickness: 25, legThickness: 70, apronHeight: 101.6, apronThickness: 19, apronInset: 12.7 } };
  const { spec, model } = pipeline(g);
  const integ = Structural.computeIntegrity(spec, model, {});
  const E = K.WOOD_SPECIES.cherry.moe * 1000;
  const apSpan = 1618.8;
  const I_apron = 19 * Math.pow(101.6, 3) / 12;
  const wAll = 75 * 9.81 / apSpan, P = 90 * 9.81;
  const sagApronHand = 5 * (wAll / 2) * apSpan ** 4 / (384 * E * I_apron) + 0.75 * P * apSpan ** 3 / (48 * E * I_apron);
  const apronEng = integ.checks.find(c => c.id === 'sag:apron:top_1');
  console.log(`\n[8] Shaker table, apron span=${apSpan} mm, limit=${(apSpan / 300).toFixed(2)} mm`);
  row('Shaker apron beam sag (mm)', sagApronHand, apronEng.data.sagMM);
  // strip: frameD = 914.4 − 70 = 844.4; off = 422.2 − 12.7 − 9.5 = 400;
  // span = 800 − 19 = 781; bEff = min(1828.8, 0.5·781 + 100) = 490.5
  const stripSpan = 2 * (844.4 / 2 - 12.7 - 19 / 2) - 19, bEff = 0.5 * stripSpan + 100;
  const Ist = bEff * 25 ** 3 / 12;
  const tribut = 75 * 9.81 * (bEff / apSpan);
  const sagStripHand = P * stripSpan ** 3 / (48 * E * Ist) + 5 * (tribut / stripSpan) * stripSpan ** 4 / (384 * E * Ist);
  const stripEng = integ.checks.find(c => c.id === 'sag:top_1');
  row('Shaker top strip sag between aprons (mm)', sagStripHand, stripEng.data.sagMM);
  rows.push({ name: 'Shaker starter passes sag as built (craft expectation)', hand: 1, engine: apronEng.status === 'pass' && stripEng.status === 'pass' ? 1 : 0, errPct: apronEng.status === 'pass' && stripEng.status === 'pass' ? 0 : 100, pass: apronEng.status === 'pass' && stripEng.status === 'pass' });
  console.log(`    apron ${apronEng.status} (${apronEng.data.sagMM.toFixed(2)} mm), strip ${stripEng.status} (${stripEng.data.sagMM.toFixed(3)} mm) — the classic passes, as generations built it`);
}

/* =========================================================================
 * 10. F2057 open-drawer moment balance, by hand, from the model geometry:
 *     margin = Σ m·g·(zF − z_open) / [22.7·g·(zLoad − zF) + Σ overhang terms]
 *     — recomputed here term by term against the engine's stab/over sums.
 * ========================================================================= */
{
  const { spec, model } = pipeline({
    meta: { name: 'HC dresser', template: 'cabinet', level: 'beginner', units: 'mm' },
    overall: { width: 900, depth: 480, height: 1200 }, wood: { species: 'hard_maple' },
    structure: { topThickness: 25, toeKick: true, backPanel: true, shelfCount: 0 },
    drawers: { count: 4, frontStyle: 'overlay', runner: 'side_mount_slides' }
  });
  const integ = Structural.computeIntegrity(spec, model, {});
  const f = integ.checks.find(c => c.id === 'tip_f2057');
  const drawerOf = new Map();
  model.drawers.forEach(d => d.partIds.forEach(id => drawerOf.set(id, d)));
  const feet = model.parts.filter(p => p.pos.y - p.size.h / 2 < 95);
  let zF = -Infinity;
  for (const ft of feet) for (const c of BB.Geo.obbCorners(BB.Geo.partOBB(ft))) if (c[1] < 130) zF = Math.max(zF, c[2]);
  let stab = 0, over = 0;
  const dens = k => K.WOOD_SPECIES[k].sg * 1000;
  for (const p of model.parts) {
    // 2026: slide/runner running gear is EXCLUDED from the mass model (a
    // folded steel channel is not a solid box of anything); solid pulls
    // keep the engine's deliberate 3000 kg/m³ metal-hardware density.
    if (p.hardware) continue;
    const d = p.material === 'baltic_birch' ? dens('baltic_birch') : p.material === 'hardware' ? 3000 : dens(spec.wood.species);
    const m = p.size.w * p.size.h * p.size.d * 1e-9 * d * (p.prim === 'cylinder' ? Math.PI / 4 : 1);
    const dr = drawerOf.get(p.id);
    const z = p.pos.z + (dr ? dr.travel * (2 / 3) : 0);
    const mom = m * 9.81 * (zF - z);
    if (mom >= 0) stab += mom; else over += -mom;
  }
  const top = model.drawers.reduce((a, b) => (a.opening.yTop > b.opening.yTop ? a : b));
  const frontPart = model.parts.find(p => p.id === top.partIds.find(id => /front$/.test(id) && !/boxfront/.test(id)));
  const zLoad = frontPart.pos.z + frontPart.size.d / 2 + top.travel * (2 / 3);
  over += 22.7 * 9.81 * (zLoad - zF);
  console.log(`\n[10] F2057 hand balance: front feet line z=${zF.toFixed(1)}, load at z=${zLoad.toFixed(1)}`);
  row('F2057 margin = stabilizing / overturning', stab / over, f.data.marginRatio);
  console.log(`    engine verdict: ${f.status} — ${f.value}`);
}

/* =========================================================================
 * 11. Slide capacity arithmetic: interior litres × 0.24 kg/L vs 34 kg pair.
 * ========================================================================= */
{
  const { spec, model } = pipeline({
    meta: { name: 'HC slide', template: 'cabinet', level: 'beginner', units: 'mm' },
    overall: { width: 780, depth: 600, height: 900 },
    drawers: { count: 1, frontStyle: 'overlay', runner: 'side_mount_slides' }
  });
  const integ = Structural.computeIntegrity(spec, model, {});
  const s = integ.checks.find(c => c.id.startsWith('slide:'));
  const d = model.drawers[0];
  const volL = (d.box.w - 2 * d.box.t) * (d.box.h - d.box.t) * (d.box.d - d.box.t) * 1e-6;
  row('drawer volume estimate (kg at 0.24 kg/L)', volL * 0.24, s.data.estKg, 0.1);
}

/* =========================================================================
 * 12. Frame-joint demand = worst apron end reaction (G5, 2026-07).
 *     Same bench as section 2 (1200×380×450 ash, aprons 20×80, span 1040).
 *     The audited frame model (F-S2-1) gives each apron HALF the spread load
 *     and ¾ of the point load; simple-span statics then put the end reaction
 *     at the loaded apron's leg joint:
 *       seating preset, seats = round(1040/550) = 2:
 *         point case P = 136×9.81 = 1334.16 N  → apron share 0.75·P,
 *           at midspan each end takes half     → R_pt = 0.75·P/2 = 0.375·P
 *         spread case w = (seats−1)·P/L        → apron share 0.5·w,
 *           UDL end reaction w′L/2             → R_ud = 0.5·(P/L)·L/2 = 0.25·P
 *       R = (0.375 + 0.25)·P = 0.625 × 1334.16 = 833.85 N.
 *     (The old model divided the whole surface load over all 8 frame joints —
 *      333.5 N — flattering the loaded end joint by 2.5×.)
 *     Capacity: pocket screws 700 N at SG 0.50, linear SG scaling (ash).
 * ========================================================================= */
{
  const { spec, model } = pipeline({
    meta: { name: 'HC bench joints', template: 'bench', level: 'beginner', units: 'mm' },
    overall: { width: 1200, depth: 380, height: 450 },
    wood: { species: 'ash' }, structure: { topThickness: 32, legThickness: 60 }
  });
  const integ = Structural.computeIntegrity(spec, model, {});
  const j = integ.checks.find(c => c.id === 'joints');
  const P = Structural.LOAD_PRESETS.seating.kgSeat * 9.81;
  const handR = 0.5 * (P / 1040) * (1040 / 2) + 0.75 * P / 2;   // = 0.625·P
  const handCap = 700 * (K.WOOD_SPECIES.ash.sg / 0.5);           // pocket screws, SG-scaled
  console.log(`\n[12] Frame joint: R = 0.25·P + 0.375·P = ${handR.toFixed(2)} N; cap = 700×${K.WOOD_SPECIES.ash.sg}/0.5 = ${handCap.toFixed(0)} N (margin ${(handCap / handR).toFixed(2)})`);
  row('frame joint demand: worst apron end reaction (N)', handR, j && j.data ? j.data.perN : NaN);
  row('frame joint capacity: 700 N × SG/0.5 (N)', handCap, j && j.data ? j.data.capN : NaN, 0.01);
}

/* =========================================================================
 * 9. Optimizer board re-computation: one board, exact kerf/trim arithmetic.
 *    3×800 on a 2438 board: 15 + 800+3+800+3+800 + 15 = 2436 ≤ 2438 ✓
 *    offcut = 2438 − 15 − (800×3 + 3×2) − 15 = 2 mm.
 * ========================================================================= */
{
  const boards = Packing.pack1D([
    { name: 'a', len: 800, nominal: '1x4', actual: K.LUMBER.NOMINALS['1x4'] },
    { name: 'b', len: 800, nominal: '1x4', actual: K.LUMBER.NOMINALS['1x4'] },
    { name: 'c', len: 800, nominal: '1x4', actual: K.LUMBER.NOMINALS['1x4'] }
  ]);
  row('board offcut hand recompute (mm)', 2438 - 15 - (3 * 800 + 2 * 3) - 15, boards[0].offcut, 0.01);
  const offs = boards[0].cuts.map(c => c.offset).join(',');
  console.log(`    offsets: ${offs} (hand: 15, 818, 1621)`);
}

/* =========================================================================
 * 10. SEATING (2026-07) — the rear-tilt case, by hand, every step shown.
 *     Nominal advanced red-oak dining chair (M&T frame):
 *       seat.height 445, topThickness 20, apronHeight 65 → rail centreline
 *       railY = 445 − 20 − 65/2 = 392.5 mm; stretcherHeight 200 →
 *       couple arm = 392.5 − 200 = 192.5 mm.
 *       backHeight 470, CREST_H 75 → crestY = 445 + 470 − 37.5 = 877.5 mm.
 *     Back functional force 667 N (BIFMA X5.1 §5/6) at the crest, chair
 *     tipped onto its rear legs. Per SIDE frame:
 *       M = (667/2) × (877.5 − 392.5) = 333.5 × 485 = 161,747.5 N·mm
 *       R = M / arm = 161,747.5 / 192.5 = 840.25 N per joint
 *     Capacity: mortise & tenon 2000 N × (SG 0.63 / 0.5) = 2520 N
 *       margin = 2520 / 840.25 = 3.00×  → PASS (gate 1.5×)
 * ========================================================================= */
{
  const spec = Spec.correctSpec({ meta: { name: 'HC chair', template: 'chair', level: 'advanced', units: 'mm' }, joinery: { frame: 'mortise_tenon' } });
  const model = Parametric.build(spec);
  const integ = Structural.computeIntegrity(spec, model, {});
  const tilt = integ.checks.find(c => c.id === 'chair:tilt');
  const railY = 445 - 20 - 65 / 2;
  const crestY = 445 + 470 - 75 / 2;
  const arm = railY - 200;
  const Mhand = (667 / 2) * (crestY - railY);
  const Rhand = Mhand / arm;
  const capHand = 2000 * (K.WOOD_SPECIES.red_oak.sg / 0.5);
  console.log(`\n[13] Rear tilt: M = 333.5 × (${crestY} − ${railY}) = ${Mhand.toFixed(1)} N·mm; R = M/${arm} = ${Rhand.toFixed(2)} N; cap = 2000×1.26 = ${capHand} N; margin ${(capHand / Rhand).toFixed(2)}×`);
  row('rear-tilt side moment M (N·mm)', Mhand, tilt.data.momentNmm);
  row('rear-tilt joint demand R (N)', Rhand, tilt.data.demandN);
  row('rear-tilt joint capacity (N)', capHand, tilt.data.capN, 0.01);
  row('rear-tilt margin (×)', capHand / Rhand, tilt.data.marginRatio);

  /* Back static — rear post net-section bending at the rail mortise:
   *   post 38 wide × 45 deep; mortise derate 10 → net b = 28
   *   I = 28 × 45³ / 12 = 212,625 mm⁴; c = 22.5
   *   σ = M·c/I = 161,747.5 × 22.5 / 212,625 = 17.115 MPa
   *   allow = MOR 99 / 4 = 24.75 → margin 1.45 → PASS */
  const back = integ.checks.find(c => c.id === 'chair:back');
  const Ihand = 28 * Math.pow(45, 3) / 12;
  const sigmaHand = Mhand * 22.5 / Ihand;
  console.log(`\n[14] Back post: I = 28×45³/12 = ${Ihand} mm⁴; σ = ${Mhand.toFixed(0)}×22.5/${Ihand} = ${sigmaHand.toFixed(3)} MPa vs allow ${(99 / 4).toFixed(2)}`);
  row('rear-post net-section stress (MPa)', sigmaHand, back.data.stressMPa);

  /* Cyclic acceptance: seat 1334 N / 4 joints = 333.5 N; capacity 2520 × 0.5
   * = 1260 N → margin 3.78×. */
  const cyc = integ.checks.find(c => c.id === 'chair:cyclic');
  console.log(`\n[15] Cyclic: 1334/4 = 333.5 N vs 2520×0.5 = 1260 N (margin ${(1260 / 333.5).toFixed(2)})`);
  row('cyclic per-joint demand (N)', 1334 / 4, cyc.data.perJointN);
  row('cyclic capacity at 0.5 factor (N)', capHand * 0.5, cyc.data.cyclicCapN, 0.01);
}

/* =========================================================================
 * 11. Stool: footrest step-up and the compound-splay resultant.
 *     Maple counter stool, counter 900 → seat 630; splay 5°.
 *     Resultant tilt of a leg splayed 5° in BOTH planes:
 *       θR = atan(√2 · tan 5°) = atan(1.41421 × 0.0874886) = 7.0498°
 *     Leg axial length: frameTop = 630 − 20 = 610;
 *       La = 610 / cos(θR) − 38·tan(θR) = 614.62... − 4.70 = 609.92 → 609.9
 *     Footrest: front stretcher at strY = 630 − 230 = 400;
 *       span (model) grows with the splay run below the seat.
 *       M = P·L/4 with P = 1334 N; σ = M·c/I, I = 25 × 49³/12.
 * ========================================================================= */
{
  Units.set({ system: 'metric' });
  const spec = Spec.correctSpec({ meta: { name: 'HC stool', template: 'chair', level: 'intermediate', units: 'mm' }, wood: { species: 'hard_maple' }, seat: { backHeight: 0, counterHeight: 900, splayDeg: 5 } });
  const model = Parametric.build(spec);
  const thetaR = Math.atan(Math.SQRT2 * Math.tan(5 * Math.PI / 180));
  const LaHand = 610 / Math.cos(thetaR) - 38 * Math.tan(thetaR);
  const leg = model.parts.find(p => p.id === 'leg_1');
  console.log(`\n[16] Splay resultant: θR = atan(√2·tan5°) = ${(thetaR * 180 / Math.PI).toFixed(4)}°; La = 610/cosθR − 38·tanθR = ${LaHand.toFixed(2)} mm`);
  row('splayed leg axial length (mm)', Math.round(LaHand * 10) / 10, leg.size.h);

  const integ = Structural.computeIntegrity(spec, model, {});
  const foot = integ.checks.find(c => c.id === 'chair:foot');
  const fr = model.parts.find(p => p.id === 'stretcher_front_1');
  const span = Math.max(fr.size.w, fr.size.d);
  const Mf = 1334 * span / 4;
  const If = 25 * Math.pow(49, 3) / 12;
  const sigmaF = Mf * (49 / 2) / If;
  console.log(`    Footrest: span ${span} → M = 1334×${span}/4 = ${Mf.toFixed(0)} N·mm; I = 25×49³/12 = ${If.toFixed(0)}; σ = ${sigmaF.toFixed(3)} MPa vs allow ${(K.WOOD_SPECIES.hard_maple.mor / 4).toFixed(2)}`);
  row('footrest bending stress (MPa)', sigmaF, foot.data.stressMPa);
}

/* =========================================================================
 * 12. Desk drawer band — stiffness-shared unequal pair, by hand.
 *     Default desk (1320.8 wide, legT 70, apron 90) with drawers: openH =
 *     90 − 40 = 50 → lower rail h = 40; rear apron h = 90; t = 20.
 *     shareW = 40³/(40³+90³) = 64 000/793 000 = 0.080706…
 *     Weak member spans its opening (stile posts the middle):
 *       apLen = (1320.8 − 2·35) − 2·70 = 1110.8; openW = (1110.8−60)/2 = 525.4
 *     Worktop preset: spread 75 kg over the span + 90 kg point.
 *       weak: w = 75·9.81/525.4 · shareW; P = 90·9.81 · max(shareW, 0.25)
 *       strong: span 1110.8, w · (1−shareW), P · 0.75
 *     Engine reports the GOVERNING member; both are recomputed here.
 * ========================================================================= */
{
  Units.set({ system: 'metric' });
  const spec = Spec.correctSpec({ meta: { name: 'HC desk', template: 'desk', level: 'intermediate', units: 'mm' }, drawers: { count: 1 } });
  const model = Parametric.build(spec);
  const integ = Structural.computeIntegrity(spec, model, {});
  const chk = integ.checks.find(c => c.id === 'sag:apron:top_1');
  const E = 12500, t = spec.structure.apronThickness;
  const hW = 40, hS = 90;
  const shareW = Math.pow(hW, 3) / (Math.pow(hW, 3) + Math.pow(hS, 3));
  const openW = model.openings[0].w;
  const apLen = 1110.8;
  const beam = (h, span, sSh, pSh) => {
    const I = t * Math.pow(h, 3) / 12;
    const w = (75 * 9.81 / span) * sSh;
    const P = 90 * 9.81 * pSh;
    const sag = 5 * w * Math.pow(span, 4) / (384 * E * I) + P * Math.pow(span, 3) / (48 * E * I);
    return { sag, ratio: sag / (span / 300) };
  };
  const weak = beam(hW, openW, shareW, Math.max(shareW, 0.25));
  const strong = beam(hS, apLen, 1 - shareW, 0.75);
  const gov = weak.ratio >= strong.ratio ? weak : strong;
  console.log(`\n[17] Desk band: shareW = 40³/(40³+90³) = ${shareW.toFixed(5)}; weak(${openW} span) sag ${weak.sag.toFixed(3)}, strong(${apLen}) sag ${strong.sag.toFixed(3)} — governing ${gov === weak ? 'weak rail' : 'rear apron'}`);
  row('desk band governing sag (mm)', gov.sag, chk.data.sagMM);
}

/* =========================================================================
 * 13. Wall shelf anchor couple — by hand.
 *     Default shelf: 914.4 × 241.3, 32 thick red oak; cleat 894.4 long,
 *     two halves 70 × 19. Studs at 406: floor(894.4/406) = 2 → 4 screws.
 *     Load: books 60 kg/m × 0.9144 m = 54.864 kg → 538.22 N, plus self
 *     weight (shelf 914.4·32·241.3 mm³ + 2 cleats 894.4·70·19) at red oak
 *     630 kg/m³.
 *     M = total · D/2; T = M/50 (screw line); per screw = T/4;
 *     capacity 637 N (NDS 2850·G²·D × 1.5 in, SPF floor).
 * ========================================================================= */
{
  const spec = Spec.correctSpec({ meta: { name: 'HC shelf', template: 'wall_shelf', level: 'beginner', units: 'mm' } });
  const model = Parametric.build(spec);
  const integ = Structural.computeIntegrity(spec, model, {});
  const chk = integ.checks.find(c => c.id === 'wall:anchor');
  const loadN = 60 * 0.9144 * 9.81;
  const dens = K.WOOD_SPECIES.red_oak.sg * 1000;
  const selfN = (914.4 * 32 * 241.3 + 2 * 894.4 * 70 * 19) * 1e-9 * dens * 9.81;
  const totalN = loadN + selfN;
  const M = totalN * (241.3 / 2);
  const T = M / 50;
  const perScrew = T / 4;
  const margin = 637 / perScrew;
  console.log(`\n[18] Wall anchor: load ${loadN.toFixed(1)} + self ${selfN.toFixed(1)} = ${totalN.toFixed(1)} N; M = ${M.toFixed(0)} N·mm; T = M/50 = ${T.toFixed(1)} N; per screw ${perScrew.toFixed(1)} N vs 637 N (margin ${margin.toFixed(2)})`);
  row('wall anchor per-screw withdrawal (N)', perScrew, chk.data.perScrewN);
  row('wall anchor margin (×)', margin, chk.data.marginRatio);
}

const fails = rows.filter(r => !r.pass);
console.log(`\nworksheet: ${rows.length - fails.length}/${rows.length} agree`);
for (const f of fails) console.log(`  DISAGREE: ${f.name} (hand ${f.hand} vs engine ${f.engine})`);
fs.writeFileSync(path.join(__dirname, '..', 'docs', 'audit', 'handcalc-latest.json'), JSON.stringify(rows, null, 2));
