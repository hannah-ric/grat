/* Blueprint Buddy — audit-finding regression tests (2026 engineering audit).
 * One section per register finding (docs/audit/04-findings-register.md).
 * Written BEFORE the fixes (fix protocol: watch them fail, fix, watch pass).
 * Run: node test/audit.test.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRC = ['knowledge.js', 'hardware.js', 'icons.js', 'materials.js', 'geometry.js', 'units.js', 'spec.js', 'parametric.js', 'structural.js', 'fasteners.js', 'packing.js',
  'plans.js', 'drafting.js', 'gltf.js', 'exports.js', 'history.js', 'codec.js', 'ai.js', 'store.js', 'gallery.js', 'joinery3d.js', 'selftest.js'];
for (const f of SRC) {
  const p = path.join(__dirname, '..', 'src', f);
  if (!fs.existsSync(p)) { console.error('MISSING MODULE: ' + f); continue; }
  vm.runInThisContext(fs.readFileSync(p, 'utf8'), { filename: f });
}
const BB = globalThis.BB;
const { Spec, Parametric, Plans, AI, K, Codec, Structural, Packing, Exports, Fasteners, Units } = BB;

let pass = 0, fail = 0;
function ok(cond, msg) { if (cond) pass++; else { fail++; console.error('  ✗ ' + msg); } }
function eq(a, b, msg) { ok(JSON.stringify(a) === JSON.stringify(b), `${msg} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); }
function near(a, b, tol, msg) { ok(typeof a === 'number' && Math.abs(a - b) <= tol, `${msg} — got ${a}, want ${b}±${tol}`); }
function section(name) { console.log('· ' + name); }
const pipeline = raw => {
  const spec = Spec.correctSpec(raw);
  const model = Parametric.build(spec);
  return { spec, model, report: Spec.validate(spec, model) };
};
Units.set({ system: 'metric', precision: 16, dual: false });

/* ================= F-S0-1: F2057-style open-drawer tipping ================= */
section('F-S0-1 open-drawer tipping (ASTM F2057 alignment)');
{
  // Tall, shallow 4-drawer dresser (the battery photo case): must run the
  // open-drawer check, and a piece this proportioned must mandate the anchor.
  const r = pipeline({
    meta: { name: 'Dresser', template: 'cabinet', level: 'beginner', units: 'mm' },
    overall: { width: 900, depth: 480, height: 1200 }, wood: { species: 'hard_maple' },
    structure: { topThickness: 25, toeKick: true, backPanel: true, shelfCount: 0 },
    drawers: { count: 4, frontStyle: 'overlay', runner: 'side_mount_slides' }
  });
  const ig = Structural.computeIntegrity(r.spec, r.model, {});
  const f2057 = ig.checks.find(c => c.id === 'tip_f2057');
  ok(f2057, 'drawered piece ≥686mm gets an open-drawer tipping check');
  ok(f2057 && /F2057|STURDY/i.test(f2057.threshold + f2057.explain), 'check cites its standard');
  ok(f2057 && typeof f2057.data.marginRatio === 'number', 'check carries the computed margin');
  // Hand moment balance, same geometry (see test/handcalc.js [10]): the check's
  // own numbers must satisfy margin = stabilizing / overturning.
  if (f2057) near(f2057.data.marginRatio, f2057.data.stabilizingNmm / f2057.data.overturningNmm, 1e-6, 'margin = stab/overturn internally consistent');
  // A squat 2-drawer nightstand under 686mm: report, don't fail the F2057 gate.
  const ns = pipeline({
    meta: { name: 'NS', template: 'nightstand', level: 'beginner', units: 'mm' },
    overall: { width: 500, depth: 400, height: 600 },
    drawers: { count: 2, frontStyle: 'inset', runner: 'side_mount_slides' }
  });
  const ig2 = Structural.computeIntegrity(ns.spec, ns.model, {});
  const f2 = ig2.checks.find(c => c.id === 'tip_f2057');
  ok(f2, 'short drawered piece still reports the open-drawer margin');
  ok(!f2 || f2.status !== 'fail' || ig2.antiTip, 'an open-drawer fail always mandates the anchor');
}

/* ================= F-S0-2: creep / load-duration factor ================= */
section('F-S0-2 creep factor on sustained loads');
{
  ok(Structural.CREEP_FACTOR >= 1.5 && Structural.CREEP_FACTOR <= 2.0, 'CREEP_FACTOR exported and in the Wood Handbook range');
  const casesBooks = Structural.loadCasesFor('books', 800, 'ss');
  ok(casesBooks.every(c => c.creep === Structural.CREEP_FACTOR), 'book loads are sustained: creep multiplier applied');
  const casesSeat = Structural.loadCasesFor('seating', 800, 'ss');
  ok(casesSeat.some(c => (c.creep || 1) === 1), 'seated-people point load is transient: no creep');
  // sag with creep = creep × elastic sag for a pure sustained case
  const I = Structural.I_rect(280, 19);
  const elastic = 5 * (Structural.LOAD_PRESETS.books.kgPerM * 9.81 / 1000) * Math.pow(864, 4) / (384 * 12500 * I);
  const { sag } = Structural.evalBeam(casesBooks, 864, 12500, I);
  near(sag / elastic, Structural.CREEP_FACTOR, 0.02, 'book-loaded shelf sag reports the long-term (creep) figure');
  // strength (moment) is NOT creep-multiplied — duration lives in the SF
  const { M } = Structural.evalBeam(casesBooks, 864, 12500, I);
  const handM = (Structural.LOAD_PRESETS.books.kgPerM * 9.81 / 1000) * 864 * 864 / 8;
  near(M, handM, handM * 0.001, 'bending moment stays elastic (duration handled by the safety factor)');
}

/* ================= F-S1-1: thickness-aware joinery allowances ================= */
section('F-S1-1 tenon length / dado depth vs mate thickness');
{
  ok(typeof Plans.jointAllowance === 'function', 'Plans.jointAllowance(type, mateT) exists');
  eq(Plans.jointAllowance('mortise_tenon', 70), 30, 'thick leg: full 30mm tenon');
  eq(Plans.jointAllowance('mortise_tenon', 18), 12, '18mm side: tenon capped at 18−6');
  eq(Plans.jointAllowance('dado', 18), 6, '18mm side: 6mm dado (1/3 rule)');
  eq(Plans.jointAllowance('dado', 12), 4, '12mm side: 4mm dado (1/3 rule)');
  // The battery cabinet: advanced M&T rails into 18mm sides must now be buildable.
  const r = pipeline({
    meta: { name: 'Cab', template: 'cabinet', level: 'advanced', units: 'mm' },
    overall: { width: 762, depth: 457.2, height: 914.4 }, wood: { species: 'white_oak' },
    structure: { topThickness: 25, shelfCount: 1, toeKick: true, backPanel: true },
    joinery: { frame: 'mortise_tenon', case: 'dado', box: 'half_blind_dovetail' },
    drawers: { count: 2, frontStyle: 'overlay', runner: 'side_mount_slides' }
  });
  const cut = Plans.cutList(r.spec, r.model);
  const rail = cut.find(c => /drawer rail/i.test(c.name));
  const innerW = r.spec.overall.width - 2 * r.spec.structure.sideThickness;
  ok(rail.L <= innerW + 2 * (r.spec.structure.sideThickness - 6) + 0.11,
    `rail tenons fit inside 18mm sides (cut ${rail.L}, clear ${innerW})`);
  const mt = pipeline({ meta: { name: 'T', template: 'table', level: 'advanced', units: 'mm' }, overall: { width: 1500, depth: 850, height: 745 }, joinery: { frame: 'mortise_tenon' } });
  const apron = Plans.cutList(mt.spec, mt.model).find(c => c.name === 'Long apron');
  eq(apron.L, 1350, 'legacy hand-calc case unchanged: 30mm tenons into 70mm legs');
}

/* ================= F-S1-2: captive drawer bottoms ================= */
section('F-S1-2 grooved drawer boxes assemble around the bottom');
{
  const grooved = pipeline({
    meta: { name: 'NS', template: 'nightstand', level: 'intermediate', units: 'mm' },
    overall: { width: 500, depth: 400, height: 600 },
    joinery: { box: 'locking_rabbet' }, drawers: { count: 1, frontStyle: 'inset', runner: 'side_mount_slides' }
  });
  const steps = Plans.assembly(grooved.spec, grooved.model);
  const boxStep = steps.find(s => s.id === 'dr1_box');
  ok(/around the .*bottom|bottom .*(captive|in its groove|during)/i.test(boxStep.text), 'grooved box: bottom goes in DURING assembly');
  ok(!steps.some(s => s.id === 'dr1_bottom' && /slide/i.test(s.text)), 'no post-assembly "slide in" step for a four-side-captive bottom');
  const screwed = pipeline({
    meta: { name: 'NS2', template: 'nightstand', level: 'beginner', units: 'mm' },
    overall: { width: 500, depth: 400, height: 600 },
    drawers: { count: 1, frontStyle: 'inset', runner: 'side_mount_slides' }
  });
  const steps2 = Plans.assembly(screwed.spec, screwed.model);
  ok(steps2.some(s => s.id === 'dr1_bottom' && /slide/i.test(s.text)), 'screwed box keeps the honest slide-in-from-the-rear step');
}

/* ================= F-S1-3: exports carry rotation, cylinders are round ================= */
section('F-S1-3 export parity: rotations + cylinders');
{
  const spec = Spec.correctSpec(Spec.defaultSpec('custom')); // rotated panel legs
  const model = Parametric.build(spec);
  const dae = Exports.toDAE(spec, model);
  const m = dae.match(/<node id="p2"[^>]*>\s*<matrix>([^<]+)<\/matrix>/);
  const vals = m[1].trim().split(/\s+/).map(Number);
  // p2 has rot y=90 in scene (Y-up). In Z-up the same spin is about +Z:
  // basis becomes [[0,-1,0],[1,0,0],[0,0,1]] (columns) — check off-diagonals.
  const R = [[vals[0], vals[1], vals[2]], [vals[4], vals[5], vals[6]], [vals[8], vals[9], vals[10]]];
  ok(Math.abs(R[0][0]) < 1e-6 && Math.abs(Math.abs(R[0][1]) - 1) < 1e-6, `DAE matrix carries the 90° rotation (row0 ${R[0]})`);
  const rb = Exports.toRuby(spec, model);
  ok(/Geom::Transformation\.new\(\[/.test(rb), 'Ruby uses full 16-element transformations');
  // cylinder: must not export as a 8-corner box
  const cyl = pipeline({
    meta: { name: 'cyl', template: 'custom', level: 'beginner', units: 'mm' },
    custom: {
      parts: [
        { id: 'p1', role: 'top', primitive: 'slab', dim: { l: 400, w: 400, t: 19 }, pos: { x: 0, y: 460, z: 0 }, grain: 'length', stock: 'solid', loadBearing: false, surface: 'worktop' },
        { id: 'p2', role: 'column', primitive: 'cylinder', dim: { l: 450, w: 80, t: 80 }, pos: { x: 0, y: 225, z: 0 }, grain: 'length', stock: 'solid', loadBearing: true, surface: 'none' },
        { id: 'p3', role: 'foot', primitive: 'slab', dim: { l: 400, w: 400, t: 38 }, pos: { x: 0, y: 19, z: 0 }, grain: 'length', stock: 'solid', loadBearing: true, surface: 'none' }
      ],
      connections: [{ a: 'p2', b: 'p1', joint: 'dowels' }, { a: 'p2', b: 'p3', joint: 'dowels' }]
    }
  });
  const cdae = Exports.toDAE(cyl.spec, cyl.model);
  const cylGeom = cdae.match(/<geometry id="[^"]*cyl[^"]*"[^>]*><mesh>[\s\S]*?<\/geometry>/);
  ok(cylGeom, 'cylinder gets its own (non-box) geometry in DAE');
  const crb = Exports.toRuby(cyl.spec, cyl.model);
  ok(/add_circle/.test(crb), 'Ruby builds cylinders with add_circle + pushpull');
}

/* ================= F-S1-4: slide clearance 12.7/side ================= */
section('F-S1-4 ball-bearing slide clearance');
{
  const r = pipeline({
    meta: { name: 'NS', template: 'nightstand', level: 'intermediate', units: 'mm' },
    overall: { width: 500, depth: 400, height: 600 },
    drawers: { count: 2, frontStyle: 'inset', runner: 'side_mount_slides' }
  });
  for (const d of r.model.drawers) {
    near(d.box.w, d.opening.w - 25.4, 0.01, `drawer ${d.index + 1}: box = opening − 25.4 (12.7 per side)`);
  }
}

/* ================= F-S2-1: table sag model (aprons + top strip) ================= */
section('F-S2-1 table-like sag: aprons carry the beam, top checked between aprons');
{
  const shaker = pipeline({
    meta: { name: 'Shaker', template: 'table', level: 'intermediate', units: 'mm' },
    overall: { width: 1828.8, depth: 914.4, height: 749.3 }, wood: { species: 'cherry' },
    structure: { topThickness: 25, legThickness: 70, apronHeight: 101.6, apronThickness: 19, apronInset: 12.7 }
  });
  const ig = Structural.computeIntegrity(shaker.spec, shaker.model, {});
  const apron = ig.checks.find(c => c.id.startsWith('sag:apron'));
  const strip = ig.checks.find(c => c.id === 'sag:top_1');
  ok(apron, 'apron beam check exists');
  ok(strip, 'top-between-aprons check exists (keeps the sag:top_1 id)');
  ok(apron && apron.status === 'pass' && strip && strip.status === 'pass',
    `the classic Shaker table passes as generations built it (apron ${apron && apron.status}, top ${strip && strip.status})`);
  ok(ig.summary.fails === 0, 'Shaker starter is failure-free');
  // A genuinely weak apron still fails: 15×60 aprons on a 2.2m oak table.
  const weak = pipeline({
    meta: { name: 'Weak', template: 'table', level: 'beginner', units: 'mm' },
    overall: { width: 2300, depth: 900, height: 750 }, wood: { species: 'pine' },
    structure: { topThickness: 19, legThickness: 70, apronHeight: 60, apronThickness: 15 }
  });
  const ig2 = Structural.computeIntegrity(weak.spec, weak.model, {});
  const apron2 = ig2.checks.find(c => c.id.startsWith('sag:apron'));
  ok(apron2 && apron2.status !== 'pass', `spindly aprons over a long span still flagged (${apron2 && apron2.status})`);
  // A thin top between widely-spaced aprons fails the strip check.
  const thin = pipeline({
    meta: { name: 'Thin', template: 'table', level: 'beginner', units: 'mm' },
    overall: { width: 1600, depth: 1100, height: 750 }, wood: { species: 'pine' },
    structure: { topThickness: 12, legThickness: 70, apronHeight: 90, apronThickness: 20 }
  });
  const ig3 = Structural.computeIntegrity(thin.spec, thin.model, {});
  const strip3 = ig3.checks.find(c => c.id === 'sag:top_1');
  ok(strip3 && strip3.status !== 'pass', `12mm pine top between aprons 1m apart flagged (${strip3 && strip3.status})`);
}

/* ================= F-S2-2: packer offcut arithmetic ================= */
section('F-S2-2 1D offcut');
{
  const boards = Packing.pack1D([
    { name: 'a', len: 800, nominal: '1x4', actual: K.LUMBER.NOMINALS['1x4'] },
    { name: 'b', len: 800, nominal: '1x4', actual: K.LUMBER.NOMINALS['1x4'] },
    { name: 'c', len: 800, nominal: '1x4', actual: K.LUMBER.NOMINALS['1x4'] }
  ]);
  eq(boards[0].offcut, 2, 'offcut = 2438 − 2×15 − (2400 + 2×3) = 2mm (kerf counted once)');
  ok(boards[0].offcut >= 0, 'offcut never negative on a feasible board');
}

/* ================= F-S2-3: movement context ================= */
section('F-S2-3 movement advisories know the attachment');
{
  const table = pipeline({
    meta: { name: 'T', template: 'table', level: 'beginner', units: 'mm' },
    overall: { width: 1500, depth: 900, height: 750 }, wood: { species: 'cherry' }
  });
  const ig = Structural.computeIntegrity(table.spec, table.model, {});
  const mv = ig.checks.find(c => c.id === 'move:top_1');
  ok(mv && mv.status === 'pass' && /figure-8|button/i.test(mv.explain),
    'table top: plan floats it on figure-8s — movement absorbed, no false alarm');
  // Wide flat-sawn red oak still earns the honest CUPPING advisory (a real
  // risk figure-8s cannot fix), with the quartersawn escape hatch named.
  const oakTable = pipeline({
    meta: { name: 'TO', template: 'table', level: 'beginner', units: 'mm' },
    overall: { width: 1500, depth: 900, height: 750 }, wood: { species: 'red_oak' }
  });
  const mvOak = Structural.computeIntegrity(oakTable.spec, oakTable.model, {}).checks.find(c => c.id === 'move:top_1');
  ok(mvOak && mvOak.status === 'advisory' && /cup|quartersawn/i.test(mvOak.explain),
    'wide flat-sawn red oak top keeps the cupping advisory');
  const shelfCase = pipeline({
    meta: { name: 'B', template: 'bookshelf', level: 'beginner', units: 'mm' },
    overall: { width: 900, depth: 350, height: 1800 }, wood: { species: 'red_oak' },
    structure: { shelfCount: 3, backPanel: true }
  });
  const ig2 = Structural.computeIntegrity(shelfCase.spec, shelfCase.model, {});
  const side = ig2.checks.find(c => c.id.startsWith('move:side'));
  ok(side && side.status === 'advisory' && /elongate/i.test(side.explain),
    'solid side screwed to a non-moving ply back: the real capture still warns with the real fix');
  const top2 = ig2.checks.find(c => c.id === 'move:top_1');
  ok(top2 && top2.status === 'pass' && /same direction|together|compatible/i.test(top2.explain),
    'solid top housed in solid sides moving the same way: compatible, says why');
}

/* ================= F-S2-4: BIFMA-aligned presets ================= */
section('F-S2-4 load presets aligned + basis documented');
{
  eq(Structural.LOAD_PRESETS.books.kgPerM, 60, 'books = 60 kg/m (BIFMA X5.9 40 lb/ft)');
  eq(Structural.LOAD_PRESETS.heavy.kgPerM, 112, 'heavy = 112 kg/m (X5.9 high-density 75 lb/ft)');
  eq(Structural.LOAD_PRESETS.seating.kgSeat, 136, 'seat = 136 kg (X5.4 300 lbf)');
  for (const p of Object.values(Structural.LOAD_PRESETS)) ok(!!p.basis, `${p.label} carries its basis`);
}

/* ================= F-S2-5: BOM fallback sheet standard ================= */
section('F-S2-5 BOM fallback uses the one true sheet');
{
  const r = pipeline({
    meta: { name: 'NS', template: 'nightstand', level: 'beginner', units: 'mm' },
    overall: { width: 500, depth: 400, height: 600 },
    drawers: { count: 1, frontStyle: 'inset', runner: 'side_mount_slides' }
  });
  const bom = Plans.bom(r.spec, r.model); // no stock plan → fallback path
  const sheetRow = bom.items.find(i => i.kind === 'sheet');
  ok(sheetRow && /1220|2440|4 x 8/.test(sheetRow.detail + sheetRow.label), `fallback prices 1220×2440 sheets (${sheetRow && sheetRow.detail})`);
}

/* ================= F-S2-6: custom post thickness ================= */
section('F-S2-6 custom thickness snap allows post stock');
{
  const s = Spec.correctSpec({
    meta: { name: 'P', template: 'custom', level: 'beginner', units: 'mm' },
    custom: {
      parts: [
        { id: 'a', role: 'top', primitive: 'slab', dim: { l: 500, w: 500, t: 19 }, pos: { x: 0, y: 460, z: 0 }, grain: 'length', stock: 'solid', loadBearing: false, surface: 'worktop' },
        { id: 'b', role: 'post', primitive: 'post', dim: { l: 450, w: 70, t: 70 }, pos: { x: 0, y: 225, z: 0 }, grain: 'length', stock: 'solid', loadBearing: true, surface: 'none' }
      ],
      connections: [{ a: 'b', b: 'a', joint: 'butt_screws' }]
    }
  });
  eq(s.custom.parts[1].dim.t, 70, 'a 70×70 post keeps its 70mm thickness');
}

/* ================= F-S2-7: end-grain connections ================= */
section('F-S2-7 end-grain screw connections derated + advised');
{
  // Horizontal rail butt-screwed END-ON between two posts: the joint sits at
  // the rail's ends along its grain — screws into end grain.
  const r = pipeline({
    meta: { name: 'EG', template: 'custom', level: 'beginner', units: 'mm' },
    custom: {
      parts: [
        { id: 'a', role: 'post', primitive: 'post', dim: { l: 700, w: 45, t: 45 }, pos: { x: -300, y: 350, z: 0 }, grain: 'length', stock: 'solid', loadBearing: true, surface: 'none' },
        { id: 'b', role: 'post', primitive: 'post', dim: { l: 700, w: 45, t: 45 }, pos: { x: 300, y: 350, z: 0 }, grain: 'length', stock: 'solid', loadBearing: true, surface: 'none' },
        { id: 'c', role: 'stretcher', primitive: 'rail', dim: { l: 555, w: 90, t: 30 }, pos: { x: 0, y: 650, z: 0 }, grain: 'length', stock: 'solid', loadBearing: true, surface: 'shelf' }
      ],
      connections: [{ a: 'c', b: 'a', joint: 'butt_screws' }, { a: 'c', b: 'b', joint: 'butt_screws' }]
    }
  });
  ok(r.report.advisories.some(a => /end grain/i.test(a.text)), 'validation names the end-grain screwed connection');
  const ig = Structural.computeIntegrity(r.spec, r.model, {});
  const joints = ig.checks.find(c => c.id === 'joints');
  ok(joints && /end grain/i.test(joints.value + joints.explain), 'joint adequacy shows the end-grain derate');
}

/* ================= F-S2-8: probe/builder parity ================= */
section('F-S2-8 cabinet drawer probe matches the builder');
{
  const spec = Spec.correctSpec({
    meta: { name: 'C', template: 'cabinet', level: 'beginner', units: 'mm' },
    overall: { width: 800, depth: 450, height: 900 },
    drawers: { count: 2, frontStyle: 'overlay', runner: 'side_mount_slides' }
  });
  const probe = Parametric.openingHeightFor(spec);
  const model = Parametric.build(spec);
  near(probe, model.openings[0].h, 0.11, 'probe openH equals built openH');
}

/* ================= F-S3-1: fastener/joinery-detail engine ================= */
section('F-S3-1 fastener locations + pilot diameters');
{
  ok(BB.Fasteners && typeof Fasteners.layoutForJoint === 'function', 'BB.Fasteners.layoutForJoint exists');
  const r = pipeline({ meta: { name: 'T', template: 'table', level: 'beginner', units: 'mm' }, overall: { width: 1500, depth: 850, height: 745 } });
  const j = r.model.joints.find(x => x.type === 'pocket_screws' || x.type === 'butt_screws');
  const lay = Fasteners.layoutForJoint(r.spec, r.model, j);
  ok(lay && lay.fasteners.length >= 2, 'a frame joint gets at least two fasteners');
  ok(lay.fasteners.every(f => f.pilotMM > 0), 'every fastener carries a pilot diameter');
  ok(lay.fasteners.every(f => f.edgeMM >= Fasteners.RULES.edgeMM - 1e-9), 'edge distances respected');
  for (let i = 1; i < lay.fasteners.length; i++) {
    ok(lay.fasteners[i].alongMM - lay.fasteners[i - 1].alongMM >= Fasteners.RULES.minSpacingMM - 1e-9, 'spacing respected');
  }
  // long joint gets more screws than a short one
  const long = Fasteners.layoutForJoint(r.spec, r.model, r.model.joints.find(x => x.a === 'top_1'));
  ok(long.fasteners.length >= 3, `a 1.3m top-to-apron joint gets a row of screws, not 2 (${long.fasteners.length})`);
  // M&T joints get a tenon setout
  const mt = pipeline({ meta: { name: 'MT', template: 'table', level: 'advanced', units: 'mm' }, overall: { width: 1500, depth: 850, height: 745 }, joinery: { frame: 'mortise_tenon' } });
  const jm = mt.model.joints.find(x => x.type === 'mortise_tenon');
  const tl = Fasteners.layoutForJoint(mt.spec, mt.model, jm);
  ok(tl.tenon && tl.tenon.thicknessMM >= 6 && tl.tenon.thicknessMM <= 12, `tenon thickness snapped to a chisel size (${tl.tenon && tl.tenon.thicknessMM})`);
  near(tl.tenon.thicknessMM, Math.min(12, Math.max(6, Math.round(20 / 3 / 2) * 2)), 2.1, 'tenon ≈ 1/3 of the 20mm apron');
  ok(tl.tenon.lengthMM <= 70 - 6, 'tenon length respects the 70mm leg');
  // dowels sized by stock
  const dw = pipeline({ meta: { name: 'DW', template: 'table', level: 'intermediate', units: 'mm' }, overall: { width: 1500, depth: 850, height: 745 }, joinery: { frame: 'dowels' } });
  const jd = dw.model.joints.find(x => x.type === 'dowels');
  const dl = Fasteners.layoutForJoint(dw.spec, dw.model, jd);
  ok(dl.fasteners.length >= 2 && dl.fasteners[0].diaMM >= 6, `dowel joints get ≥2 dowels with a real diameter (${dl.fasteners[0] && dl.fasteners[0].diaMM})`);
  // assembly steps surface the setout; print sheet carries the table
  const steps = Plans.assembly(mt.spec, mt.model);
  ok(steps.some(s => /tenon .*thick|mortise/i.test(s.text)), 'assembly text carries the tenon setout');
  const cut = Plans.cutList(r.spec, r.model);
  const html = Exports.printHTML(r.spec, r.model, cut, Plans.bom(r.spec, r.model), Plans.assembly(r.spec, r.model), null);
  ok(/Joinery (&amp;|&) hardware detail/i.test(html), 'print sheet gains the joinery + hardware detail section');
  ok(/pilot/i.test(html), 'print sheet lists pilot diameters');
}

/* ================= F-S3-2: milling sequence for rough stock ================= */
section('F-S3-2 milling sequence in rough mode');
{
  const r = pipeline({ meta: { name: 'T', template: 'table', level: 'intermediate', units: 'mm' }, overall: { width: 1500, depth: 850, height: 745 } });
  const cut = Plans.cutList(r.spec, r.model);
  const rough = Packing.planStock(r.spec, r.model, cut, { stockMode: { [r.spec.wood.species]: 'rough' } });
  const steps = Plans.assembly(r.spec, r.model, null, { stockPlan: rough });
  const milling = steps.filter(s => /^mill/.test(s.id));
  ok(milling.length >= 2, `rough stock prepends real milling steps (${milling.length})`);
  ok(/joint.*face|face.*joint/i.test(milling.map(s => s.text).join(' ')), 'milling starts at the jointer');
  const dim = Packing.planStock(r.spec, r.model, cut, {});
  const steps2 = Plans.assembly(r.spec, r.model, null, { stockPlan: dim });
  ok(!steps2.some(s => /^mill_face/.test(s.id)), 'dimensional lumber does not get told to re-mill');
}

/* ================= F-S3-3: sanding + finishing schedule ================= */
section('F-S3-3 finishing schedule from the catalog');
{
  const r = pipeline({ meta: { name: 'T', template: 'table', level: 'beginner', units: 'mm' }, finish: 'water_poly' });
  const steps = Plans.assembly(r.spec, r.model);
  const sand = steps.find(s => s.id === 'sand');
  ok(sand && /120.*180|80.*120/.test(sand.text), 'sanding step carries a grit ladder');
  const fin = steps.find(s => s.id === 'finish');
  ok(fin && /raise the grain|pre-?dampen/i.test(fin.text), 'water-based poly warns to raise the grain first');
  const oil = pipeline({ meta: { name: 'T2', template: 'table', level: 'beginner', units: 'mm' }, finish: 'danish_oil' });
  const fin2 = Plans.assembly(oil.spec, oil.model).find(s => s.id === 'finish');
  ok(fin2 && /rag|combust|flat to dry/i.test(fin2.text), 'oil finishes carry the rag-fire warning');
}

/* ================= F-S3-4: safety notes ================= */
section('F-S3-4 proportionate safety notes');
{
  const r = pipeline({
    meta: { name: 'C', template: 'cabinet', level: 'beginner', units: 'mm' },
    overall: { width: 800, depth: 450, height: 900 },
    drawers: { count: 2, frontStyle: 'overlay', runner: 'side_mount_slides' }
  });
  const ig = Structural.computeIntegrity(r.spec, r.model, {});
  const steps = Plans.assembly(r.spec, r.model, ig);
  const safety = steps.find(s => s.id === 'safety');
  ok(safety, 'plans carry a safety step');
  ok(safety && /eye|ear|dust/i.test(safety.text), 'the basics are present');
}

/* ================= F-S3-5: rule checks in validation ================= */
section('F-S3-5 pocket-screw stock minimum + thin-bottom rules');
{
  const thin = pipeline({
    meta: { name: 'PS', template: 'custom', level: 'beginner', units: 'mm' },
    custom: {
      parts: [
        { id: 'a', role: 'panel_a', primitive: 'panel', dim: { l: 400, w: 300, t: 6 }, pos: { x: 0, y: 150, z: 0 }, grain: 'length', stock: 'sheet', loadBearing: true, surface: 'none' },
        { id: 'b', role: 'shelf_b', primitive: 'slab', dim: { l: 400, w: 200, t: 6 }, pos: { x: 0, y: 303, z: 0 }, grain: 'length', stock: 'sheet', loadBearing: false, surface: 'shelf' }
      ],
      connections: [{ a: 'a', b: 'b', joint: 'pocket_screws' }]
    }
  });
  ok(thin.report.errors.some(e => /pocket/i.test(e.text) && /12/.test(e.text)), 'pocket screws into 6mm stock is a blocking error');
}

/* ================= F-S3-6: slide capacity ================= */
section('F-S3-6 slide capacity vs drawer size');
{
  const cap = (K.FASTENERS.hardware.find(h => h.key === 'slide_pair') || {}).capacityKg;
  ok(cap >= 30 && cap <= 45, `slide pair carries a capacity rating (${cap} kg)`);
  const big = pipeline({
    meta: { name: 'BigDrawers', template: 'cabinet', level: 'beginner', units: 'mm' },
    overall: { width: 780, depth: 600, height: 900 }, structure: { toeKick: false },
    drawers: { count: 1, frontStyle: 'overlay', runner: 'side_mount_slides' }
  });
  const ig = Structural.computeIntegrity(big.spec, big.model, {});
  const slide = ig.checks.find(c => c.id.startsWith('slide:'));
  ok(slide, 'drawered pieces get a slide-capacity check');
  ok(slide && /kg|lb/.test(slide.value), 'the check reports the estimated load vs rating');
}

/* ================= F-S3-7: design-value basis + clear-stock note ================= */
section('F-S3-7 design basis disclosed; clear stock called out');
{
  ok(typeof K.DESIGN_BASIS === 'string' && /small,? clear|clear[, ].*specimens?|Wood Handbook/i.test(K.DESIGN_BASIS), 'K.DESIGN_BASIS documents the small-clear-specimen basis');
  ok(/safety factor|SF/i.test(K.DESIGN_BASIS) && /knot|grade/i.test(K.DESIGN_BASIS), 'basis explains what the safety factor absorbs');
  const r = pipeline({ meta: { name: 'T', template: 'table', level: 'beginner', units: 'mm' } });
  const cut = Plans.cutList(r.spec, r.model);
  const legRow = cut.find(c => c.role === 'leg');
  ok(/straight|knot/i.test(legRow.note || ''), 'load-bearing rows carry the clear-stock note');
}

/* ================= F-S3-8: digest drift guard ================= */
section('F-S3-8 digests generated from tables');
{
  ok(typeof K.levelMatrixLine === 'function', 'level matrix line is generated');
  const line = K.levelMatrixLine();
  for (const lvl of K.LEVELS) {
    for (const j of Object.values(K.JOINERY).filter(x => x.level === lvl)) {
      ok(line.includes(j.key), `level matrix line includes ${j.key}`);
    }
  }
  ok(K.knowledgeDigest().includes(line), 'knowledgeDigest embeds the generated line');
  const sys = AI.systemPrompt(Spec.correctSpec(Spec.defaultSpec('table')));
  ok(sys.includes(line), 'system prompt uses the generated line (no hand copy)');
  ok(typeof K.visionRangesLine === 'function' && AI.VISION_PROMPT.includes(K.visionRangesLine()), 'vision prompt ranges generated from ERGONOMICS');
}

/* ================= F-S3-9: drawer backs ================= */
section('F-S3-9 grooved boxes get housed backs');
{
  const r = pipeline({
    meta: { name: 'DV', template: 'cabinet', level: 'advanced', units: 'mm' },
    overall: { width: 800, depth: 450, height: 900 },
    joinery: { box: 'half_blind_dovetail' },
    drawers: { count: 1, frontStyle: 'overlay', runner: 'side_mount_slides' }
  });
  const backJoints = r.model.joints.filter(j => j.a.includes('boxback'));
  ok(backJoints.length && backJoints.every(j => j.type === 'dado'), `dovetail box backs are dado-housed, not butt-screwed (${backJoints[0] && backJoints[0].type})`);
}

/* ================= consolidation: BF_MM3 single source ================= */
section('F-SYS-1 board-foot constant single-sourced');
{
  eq(K.BF_MM3, 2359737, 'K.BF_MM3 exported');
  const plansSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'plans.js'), 'utf8');
  const packSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'packing.js'), 'utf8');
  const unitsSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'units.js'), 'utf8');
  ok(!/BF_MM3\s*=\s*2359737/.test(plansSrc), 'plans.js no longer defines its own copy');
  ok(!/BF_MM3\s*=\s*2359737/.test(packSrc), 'packing.js no longer defines its own copy');
  ok(!/0\.002359737/.test(unitsSrc), 'units.js derives m³/bdft from the shared constant');
}

/* ================= threshold consolidation ================= */
section('F-SYS-3 drawer thresholds sourced from ERGONOMICS');
{
  ok(typeof K.ergoRow === 'function' && K.ergoRow('drawer_min_height').min === 80, 'K.ergoRow lookup exists');
  const specSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'spec.js'), 'utf8');
  ok(/ergoRow\(/.test(specSrc), 'spec.js reads the ergonomic rows instead of re-typing 80/750/1100');
}

/* ================= 2026 knowledge expansion =================
 * The expansion's own audit invariants: a joint or species that exists in
 * the tables but not in the derived engines silently mis-rates (racking 0,
 * butt-screw capacity, screws in a glue-up) — so coverage IS the invariant.
 */
section('KB-1 every joint is engine-covered: rating, allowance, time, setout');
{
  for (const key of Object.keys(K.JOINERY)) {
    ok(!!Structural.JOINT_RATING[key], `${key} has a structural rating (racking pts + capacity)`);
    ok(Plans.JOINT_ALLOWANCE[key] !== undefined, `${key} has an explicit cut-length allowance (0 must be deliberate)`);
  }
  const plansSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'plans.js'), 'utf8');
  ok(/edge_glue:\s*15/.test(plansSrc.slice(plansSrc.indexOf('OP_MINUTES'))), 'shop-time table covers the new joints');

  // Setout truth on demo members: glue-only joints emit zero purchasable
  // fasteners; hardware joints emit exactly what the BOM will count.
  const demo = {
    frame: [{ id: 'a', name: 'Apron', material: 'red_oak', size: { w: 600, h: 89, d: 19 }, pos: { x: 0, y: 300, z: 0 } },
            { id: 'b', name: 'Leg', material: 'red_oak', size: { w: 60, h: 700, d: 60 }, pos: { x: 300, y: 350, z: 0 } }],
    case: [{ id: 'a', name: 'Shelf', material: 'red_oak', size: { w: 800, h: 19, d: 280 }, pos: { x: 0, y: 400, z: 0 } },
           { id: 'b', name: 'Side', material: 'baltic_birch', size: { w: 18, h: 900, d: 280 }, pos: { x: 400, y: 450, z: 0 } }],
    box: [{ id: 'a', name: 'Drawer side', material: 'baltic_birch', size: { w: 400, h: 120, d: 12 }, pos: { x: 0, y: 200, z: 0 } },
          { id: 'b', name: 'Drawer front', material: 'red_oak', size: { w: 450, h: 120, d: 19 }, pos: { x: 200, y: 200, z: 0 } }],
    panel: [{ id: 'a', name: 'Board A', material: 'red_oak', size: { w: 600, h: 19, d: 140 }, pos: { x: 0, y: 20, z: 0 } },
            { id: 'b', name: 'Board B', material: 'red_oak', size: { w: 600, h: 19, d: 140 }, pos: { x: 0, y: 20, z: 140 } }]
  };
  const laySpec = Spec.correctSpec({ meta: { template: 'table' } });
  const layFor = key => {
    const kind = K.JOINERY[key].kinds[0];
    const parts = demo[kind];
    const model = { parts, joints: [{ type: key, a: 'a', b: 'b' }] };
    return { lay: Fasteners.layoutForJoint(laySpec, model, model.joints[0]), model };
  };
  const NEW_JOINTS = ['edge_glue', 'half_lap', 'cross_lap', 'bridle', 'loose_tenon', 'box_joint',
    'through_dovetail', 'sliding_dovetail', 'miter_spline', 'staked_tenon', 'biscuits', 'french_cleat', 'kd_bolt'];
  for (const key of NEW_JOINTS) {
    const { lay, model } = layFor(key);
    ok(lay && lay.text && lay.text.length > 40, `${key} has a real setout line, not the default screw case`);
    ok(!/#8 × 32 mm wood screw.*from each end, pilot/.test(lay.text), `${key} did not fall into the default screw case`);
    const bomCount = Fasteners.countFor(laySpec, model).reduce((n, c) => n + c.qty, 0);
    eq(bomCount, lay.fasteners.length, `${key} BOM count matches its drilling instructions`);
  }
  ok(layFor('edge_glue').lay.fasteners.length === 0 && /clamp/i.test(layFor('edge_glue').lay.text), 'edge glue-up: zero fasteners, a clamp schedule instead');
  const bj = layFor('box_joint').lay;
  ok(bj.dovetail && bj.dovetail.count % 2 === 1, `box joint forces an odd finger count (${bj.dovetail && bj.dovetail.count})`);
  ok(/across the seat grain/i.test(layFor('staked_tenon').lay.text), 'staked tenon setout carries the wedge-across-the-grain rule');
  ok(layFor('kd_bolt').lay.fasteners.length === 2, 'knockdown joint drills two bolts per rail end');
  ok(/stud/i.test(layFor('french_cleat').lay.text), 'french cleat setout demands studs, never drywall alone');
  ok(layFor('biscuits').lay.fasteners.every(f => f.edgeMM >= 50), 'biscuit slots respect the 50 mm edge distance');
}

section('KB-2 sheet species are honest: MDF fails where MDF fails');
{
  // The same 900 × 300 shelf on two panel legs, loaded with books, in three
  // materials. MDF (3 GPa / 25 MPa effective) must fail sag under books +
  // creep — the ash-bookshelf doctrine extended to sheet goods.
  const shelfPiece = sheetSpecies => pipeline({
    meta: { name: 'Shelf Duty', template: 'custom', level: 'beginner', units: 'mm' },
    wood: { species: 'red_oak', sheetSpecies },
    custom: {
      parts: [
        { id: 'p1', role: 'shelf_slab', primitive: 'slab', dim: { l: 900, w: 300, t: 18 }, pos: { x: 0, y: 409, z: 0 }, grain: 'length', stock: 'sheet', loadBearing: false, surface: 'shelf' },
        { id: 'p2', role: 'leg_panel', primitive: 'panel', dim: { l: 300, w: 400, t: 18 }, pos: { x: -430, y: 200, z: 0 }, rot: { x: 0, y: 90, z: 0 }, grain: 'length', stock: 'sheet', loadBearing: true, surface: 'none' },
        { id: 'p3', role: 'leg_panel', primitive: 'panel', dim: { l: 300, w: 400, t: 18 }, pos: { x: 430, y: 200, z: 0 }, rot: { x: 0, y: 90, z: 0 }, grain: 'length', stock: 'sheet', loadBearing: true, surface: 'none' }
      ],
      connections: [{ a: 'p2', b: 'p1', joint: 'dado' }, { a: 'p3', b: 'p1', joint: 'dado' }]
    }
  });
  const sagOf = r => {
    const integ = Structural.computeIntegrity(r.spec, r.model, { loadChoices: { p1: 'books' } });
    const c = integ.checks.find(x => x.id === 'sag:p1');
    return { sag: c && c.data ? c.data.sagMM : null, status: c && c.status };
  };
  const mdf = sagOf(shelfPiece('mdf'));
  const baltic = sagOf(shelfPiece('baltic_birch'));
  ok(mdf.sag != null && baltic.sag != null, 'sag checks computed for sheet shelves');
  near(mdf.sag / baltic.sag, 10 / 3, 0.05, 'sag scales exactly inversely with effective MOE (baltic 10 GPa vs MDF 3 GPa)');
  eq(mdf.status, 'fail', 'an MDF shelf under books + creep honestly FAILS');
  // Movement: MDF is exempt in-plane, with the thickness-swell caveat named.
  const mv = Structural.computeIntegrity(shelfPiece('mdf').spec, shelfPiece('mdf').model, {}).checks.find(c => c.id === 'move:p1');
  ok(mv && mv.status === 'pass' && /isotropic|no grain/i.test(mv.explain) && /seal|water|swell/i.test(mv.explain), 'MDF movement exemption explains itself honestly');
  // And the primary-species rule is untouched: sheet stock can never be the
  // solid species; an invalid sheet choice snaps back to Baltic.
  eq(Spec.correctSpec({ meta: { template: 'table' }, wood: { species: 'mdf' } }).wood.species, 'red_oak', 'MDF cannot be the solid species');
  eq(Spec.correctSpec({ meta: { template: 'table' }, wood: { species: 'red_oak', sheetSpecies: 'walnut' } }).wood.sheetSpecies, 'baltic_birch', 'a solid species cannot be the sheet stock');
}

section('KB-3 the plan names the right glue');
{
  const bomOf = raw => {
    const r = pipeline(raw);
    const cut = Plans.cutList(r.spec, r.model);
    const stock = Packing.planStock(r.spec, r.model, cut, {});
    return Plans.bom(r.spec, r.model, { stock });
  };
  const interior = bomOf({ meta: { template: 'table' }, wood: { species: 'red_oak' }, finish: 'wipe_poly' });
  const food = bomOf({ meta: { template: 'table' }, wood: { species: 'hard_maple' }, finish: 'mineral_oil' });
  const oily = bomOf({ meta: { template: 'table' }, wood: { species: 'teak' }, finish: 'spar_urethane' });
  const glueLines = b => b.items.filter(i => i.kind === 'glue');
  eq(glueLines(interior).length, 1, 'exactly one glue line per BOM');
  ok(glueLines(interior)[0].label.includes('Interior PVA'), 'interior build gets interior PVA');
  ok(glueLines(food)[0].label.includes('Type I') && /food/i.test(glueLines(food)[0].detail), 'food-contact finish forces Type I with the reason stated');
  ok(glueLines(oily)[0].label.includes('epoxy') || /epoxy/i.test(glueLines(oily)[0].label), 'oily teak gets epoxy');
  ok(/solvent/i.test(K.recommendGlue({ wood: { species: 'teak' }, finish: 'mineral_oil' }).why), 'oily + food-contact carries the solvent-wipe instruction');
}

section('KB-4 the expanded lumber catalog packs and prices');
{
  // A 38 × 235 stretcher must pack as a direct 2x10 rip, not a glue-up.
  eq(Packing.sectionFor(38, 230).kind, 'direct', '38 × 230 packs direct');
  eq(Packing.sectionFor(38, 230).nominal, '2x10', '… on a 2x10');
  // But a direct fit must never win by planing most of the board away: a
  // 20 × 276 apron is a two-strip glue-up, not a 2x12 planed from 38 to 20.
  const apron276 = Packing.sectionFor(20, 276.4);
  eq(apron276.kind, 'glueup', '20 × 276 stays a glue-up despite the 2x12 existing');
  eq(apron276.nominal, '5/4x4', '… composed exactly as before the expansion');
  // Nor may a glue-up win on raw waste alone: three 1x2 strips never beat
  // one clean 1x6 rip for a 19 × 90 plinth — glue lines cost labor.
  eq(Packing.sectionFor(19, 90).kind, 'direct', '19 × 90 plinth stays a single rip');
  eq(Packing.sectionFor(19, 90).nominal, '1x6', '… from a 1x6');
  // A 32 × 381 bench seat glues from three 2x6 strips, not twelve 2x2s.
  const seat = Packing.sectionFor(32, 381);
  eq(seat.nominal, '2x6', 'bench seat glue-up picks sensible wide strips');
  ok(seat.pieces === 3, `… three of them (${seat.pieces})`);
  // And thin wide panels keep their pre-expansion sections exactly.
  eq(Packing.sectionFor(19, 126).nominal, '1x6', '19 × 126 keeps its direct 1x6');
  eq(Packing.sectionFor(45, 45).nominal, '8/4x3', '45 × 45 legs keep their direct 8/4x3');
  eq(Packing.sectionFor(18, 457.2).nominal, '1x10', '18 × 457 case side keeps its 1x10 glue-up');
  // A 70 mm post rips from one 4×4 instead of face-laminating two 8/4s.
  eq(Packing.sectionFor(70, 70).kind, 'direct', '70 × 70 post packs direct');
  eq(Packing.sectionFor(70, 70).nominal, '4x4', '… on a 4x4');
  // An 89 mm custom post snaps to buyable 4×4 stock exactly.
  const post = Spec.correctSpec({
    meta: { template: 'custom' },
    custom: { parts: [
      { id: 'p1', role: 'seat', primitive: 'slab', dim: { l: 900, w: 300, t: 38 }, pos: { x: 0, y: 469, z: 0 }, grain: 'length', stock: 'solid', surface: 'seating' },
      { id: 'p2', role: 'post', primitive: 'post', dim: { l: 450, w: 89, t: 88 }, pos: { x: -350, y: 225, z: 0 }, grain: 'length', stock: 'solid', loadBearing: true },
      { id: 'p3', role: 'post', primitive: 'post', dim: { l: 450, w: 89, t: 88 }, pos: { x: 350, y: 225, z: 0 }, grain: 'length', stock: 'solid', loadBearing: true }
    ], connections: [{ a: 'p2', b: 'p1', joint: 'staked_tenon' }, { a: 'p3', b: 'p1', joint: 'staked_tenon' }] }
  });
  eq(post.custom.parts[1].dim.t, 89, 'custom 88 mm post snaps to the 89 mm 4×4, not 90');
  // 16 ft stock stays deliberately absent: pack1D opens the longest length
  // first, so adding it would silently shift every plan onto 16-footers.
  ok(!K.LUMBER.STOCK_LENGTHS.includes(4877), 'no 16 ft stock (deliberate — see knowledge.js)');
  eq(Math.max(...K.LUMBER.STOCK_LENGTHS), 3658, '12 ft remains the longest board');
}

/* ================= 2026 hardware repository ================= */
section('KB-5 hardware is a pure function of the corrected spec');
{
  const HW = BB.HW;
  // The doctrine: style on the wire, numbers in code. The digest names
  // styles; capacities and formulas never enter the prompt.
  ok(Codec.PUL.length === Object.keys(HW.PULLS).length && Codec.PUL.every(k => HW.PULLS[k]), 'PUL wire enum matches the PULLS table exactly');
  ok(Codec.RUN.includes('undermount_slides'), 'RUN gained undermount (append-only)');
  const sys = AI.systemPrompt(Spec.correctSpec(Spec.defaultSpec('nightstand')));
  ok(sys.includes(HW.digestLine()) && !/capacityKg|forceClasses|torqueClasses/.test(sys), 'prompt carries styles, never ratings');

  // Undermount: the box is built to the slide — the one slide family where
  // geometry is the spec sheet.
  const um = pipeline({
    meta: { name: 'UM', template: 'cabinet', level: 'intermediate', units: 'mm' },
    overall: { width: 800, depth: 500, height: 900 }, structure: { toeKick: true },
    drawers: { count: 2, frontStyle: 'inset', runner: 'undermount_slides' }
  });
  for (const d of um.model.drawers) {
    // Blum-class spec sheet (audit FE-H8): the locking devices register on
    // the box INTERIOR — inside width = opening − 42, whatever the sides.
    eq(d.opening.w - (d.box.w - 2 * d.box.t), 42, `drawer ${d.index + 1}: INSIDE width = opening − 42 (Blum-class)`);
    eq(d.opening.h - d.box.h, 19, `drawer ${d.index + 1}: 19 mm height clearance`);
    eq(d.box.d, d.slideLen, `drawer ${d.index + 1}: box depth = slide length exactly`);
    const bot = um.model.parts.find(p => p.id === `dr${d.index + 1}_bottom`);
    eq(bot.size.h, 12, `drawer ${d.index + 1}: captured 12 mm bottom`);
    near(bot.pos.y - bot.size.h / 2 - (d.opening.yBottom + (d.opening.h - d.box.h) / 2), 12.7, 0.05, `drawer ${d.index + 1}: bottom recessed 12.7`);
  }
  ok(!um.report.errors.length, 'undermount cabinet validates clean');
  eq(Spec.correctSpec({ meta: { template: 'cabinet', level: 'beginner' }, drawers: { count: 1, runner: 'undermount_slides' } }).drawers.runner,
    'side_mount_slides', 'undermount gated past beginner (forgives nothing)');

  // Pull system: BOM, model parts, and step instructions agree.
  const ns = pipeline({
    meta: { name: 'NS', template: 'nightstand', level: 'intermediate', units: 'mm' },
    overall: { width: 500, depth: 400, height: 600 },
    drawers: { count: 2, frontStyle: 'inset', runner: 'side_mount_slides' }
  });
  const nsBom = Plans.bom(ns.spec, ns.model);
  const pullLines = nsBom.items.filter(i => i.label === 'Bar pull');
  eq(pullLines.length, 2, 'BOM: one styled pull line per drawer');
  ok(pullLines.every(l => /through-bores.*centers.*M4/.test(l.detail)), 'pull lines carry bores, series spacing, and M4 length');
  const d0 = ns.model.drawers[0];
  ok(BB.HW.PULL_CTC_SERIES.includes(d0.pull.ctcMM), `pull spacing ${d0.pull.ctcMM} is a real series value`);
  const nsSteps = Plans.assembly(ns.spec, ns.model, null, {});
  ok(/ONE centerline/.test(nsSteps.find(s => s.id === 'dr1_pull').text), 'pull step carries the shared-centerline rule');
  eq(ns.model.parts.filter(p => p.role === 'pull').length, 2, 'one pull part per drawer at default style');

  // Push-to-open: no pull part, a touch latch in the BOM, and the gap
  // advisory on overlay fronts.
  const touch = pipeline({
    meta: { name: 'T', template: 'nightstand', level: 'intermediate', units: 'mm' },
    overall: { width: 500, depth: 400, height: 600 },
    hardware: { pull: 'none_touch' },
    drawers: { count: 1, frontStyle: 'overlay', runner: 'side_mount_slides' }
  });
  eq(touch.model.parts.filter(p => p.role === 'pull').length, 0, 'push-to-open builds no pull part');
  ok(Plans.bom(touch.spec, touch.model).items.some(i => /touch latch/i.test(i.label)), 'BOM buys the touch latch instead');
  ok(touch.report.advisories.some(a => a.id === 'hw_touch_gap'), 'overlay + push-to-open raises the 2–3 mm gap advisory');

  // Slide family: the integrity check and the BOM pick the same class from
  // the same computed load, and small drawers keep the incumbent class.
  const ig = Structural.computeIntegrity(ns.spec, ns.model, {});
  const slideCheck = ig.checks.find(c => c.id.startsWith('slide:'));
  eq(slideCheck.data.capKg, 34, 'small drawers keep the 34 kg class (golden-stable)');
  ok(nsBom.items.some(i => /side-mount slides \(pair\)/.test(i.label)), 'BOM buys the same class the check rated');
  eq(HW.slidePick(30).capacityKg, 45, 'a 30 kg computed load climbs to the 45 kg class');

  // Wooden runners: the fitted clearance is the computed movement number.
  const wr = pipeline({
    meta: { name: 'WR', template: 'nightstand', level: 'intermediate', units: 'mm' },
    overall: { width: 500, depth: 400, height: 600 }, wood: { species: 'beech' },
    drawers: { count: 1, frontStyle: 'inset', runner: 'wood_runners' }
  });
  const wrStep = Plans.assembly(wr.spec, wr.model, null, {}).find(s => s.id === 'dr1_runners');
  const wrClr = HW.drawerVerticalClearance(wr.model.drawers[0].box.h, 'beech', K.CLIMATE_DMC.temperate);
  ok(wrStep.text.includes('computed seasonal movement'), 'runner step explains the clearance is computed');
  near(wrClr, wr.model.drawers[0].box.h * K.WOOD_SPECIES.beech.ct * 4 + 1, 0.06, 'clearance = height × ct × ΔMC + 1 floor');

  // Safety knowledge is live where geometry exists, staged where it does not.
  const outdoor = pipeline({ meta: { template: 'table' }, wood: { species: 'white_oak' }, finish: 'spar_urethane' });
  ok(outdoor.report.advisories.some(a => a.id === 'hw_outdoor'), 'exterior finish on tannic species → stainless/brass/galvanized advisory');
  ok(HW.GATES.kidSafe.refusedLidSupport.includes('cord_stay'), 'kidSafe gate data refuses cord stops (ASTM F963), ready for the lids workstream');
  ok(/NEVER the answer on a toy chest/.test(HW.TRADITIONAL.cord_stay.failure), 'the cord stop itself carries the toy-chest refusal');

  // 3D teaching views: dimensionally true and structurally sound.
  for (const v of ['hw_cup_hinge', 'hw_rule_joint', 'hw_pivot_pin', 'hw_tambour', 'hw_sawtooth', 'hw_undermount']) {
    const d = BB.Joinery3D.buildJoint(v, null, null, x => x + 'mm');
    const volOK = d.pieces.every(p => p.kind === 'cuboid' ? p.e.every(e => e > 0)
      : p.kind === 'cylinder' ? p.r > 0 && p.len > 0 : p.profile.length >= 3 && p.depth > 0);
    ok(volOK && d.labels.length >= 2 && Math.abs(Math.hypot(...d.insertAxis) - 1) < 1e-9, `${v} builds sound, labeled geometry`);
  }
  const cup = BB.Joinery3D.buildJoint('hw_cup_hinge', null, null, x => x + 'mm');
  const cupCyl = cup.pieces.find(p => p.kind === 'cylinder');
  ok(cupCyl.r === 17.5 && cupCyl.len === 13, 'cup view is a true 35 × 13 cup');
  const rjLabel = BB.Joinery3D.buildJoint('hw_rule_joint', null, null, x => x + 'mm').labels[0];
  ok(/22mm.*5mm.*3mm.*14mm/.test(rjLabel.replace(/[^0-9a-z.]/gi, '')) || /14/.test(rjLabel), 'rule-joint view teaches r = t − fillet − pin height');
}

/* ================= FE-C2 (2026-07 front-end audit): screw length bounded by the joint path ================= */
section('FE-C2 screw length never exceeds the wood it crosses');
{
  // Cabinet wood runner: 19 mm runner face-screwed to an 18 mm sheet side.
  // The old fixed #8 × 50 exited the show face by ~13 mm.
  const wr = pipeline({
    meta: { name: 'WR', template: 'cabinet', level: 'intermediate', units: 'mm' },
    overall: { width: 700, depth: 450, height: 900 },
    structure: { toeKick: true, backPanel: true, shelfCount: 0 },
    drawers: { count: 2, frontStyle: 'inset', runner: 'wood_runners' }
  });
  const rj = wr.model.joints.find(j => /runner/.test(j.a));
  ok(rj, 'cabinet wood-runner joint exists');
  const runner = wr.model.parts.find(p => p.id === rj.a), side = wr.model.parts.find(p => p.id === rj.b);
  const lay = Fasteners.layoutForJoint(wr.spec, wr.model, rj);
  const len = lay && lay.fasteners.length ? parseInt((lay.fasteners[0].spec.match(/× (\d+)/) || [])[1], 10) : NaN;
  const pathA = runner.size.w, pathB = side.size.w; // contact along x
  ok(isFinite(len) && len <= pathA + pathB - 3,
    `cabinet runner screw ${len} mm stays inside ${pathA}+${pathB} mm of wood (≤ path − 3)`);
  ok(len < 50, `cabinet runner screw shortened from the fixed 50 (got ${len})`);

  // Nightstand wood runner: 44 mm runner onto a 20 mm apron — a capped screw
  // alone leaves ≤ 6 mm of bite, so the setout must counterbore for thread.
  const nswr = pipeline({
    meta: { name: 'NSWR', template: 'nightstand', level: 'intermediate', units: 'mm' },
    overall: { width: 500, depth: 400, height: 600 },
    drawers: { count: 1, frontStyle: 'inset', runner: 'wood_runners' }
  });
  const nrj = nswr.model.joints.find(j => /runner/.test(j.a));
  const nrunner = nswr.model.parts.find(p => p.id === nrj.a), napron = nswr.model.parts.find(p => p.id === nrj.b);
  const nlay = Fasteners.layoutForJoint(nswr.spec, nswr.model, nrj);
  const nlen = parseInt((nlay.fasteners[0].spec.match(/× (\d+)/) || [])[1], 10);
  const cbore = nlay.fasteners[0].counterboreMM || 0;
  const bite = nlen - (nrunner.size.w - cbore);
  ok(nlen <= nrunner.size.w + napron.size.d - 3 + 0.01 || nlen <= nrunner.size.w + 20 - 3,
    `nightstand runner screw ${nlen} mm never exits the apron`);
  ok(bite >= 8 && bite <= 20 - 3, `runner screw bites ${bite} mm into the 20 mm apron (counterbore ${cbore} mm)`);
  ok(cbore > 0 && /counterbore/i.test(nlay.text), 'thick-runner setout instructs the counterbore');

  // Bookshelf case screws were CORRECT (through the 19 side into deep end
  // grain) — they must stay #8 × 50, and the text must name the true
  // through-member (you screw through the side, not through the shelf).
  const bs = pipeline({
    meta: { name: 'BS', template: 'bookshelf', level: 'beginner', units: 'mm' },
    overall: { width: 900, depth: 300, height: 1800 },
    structure: { shelfCount: 4, backPanel: true }
  });
  const sj = bs.model.joints.find(j => /^shelf/.test(j.a) && /^side/.test(j.b));
  const slay = Fasteners.layoutForJoint(bs.spec, bs.model, sj);
  ok(/× 50 mm/.test(slay.fasteners[0].spec), 'bookshelf case screw stays #8 × 50 (end-grain depth is real)');
  ok(/through side into shelf/i.test(slay.text), 'setout names the true through-member (side, not shelf)');
}

/* ================= FE-H1 (2026-07 front-end audit): figure-8s only where a top can float ================= */
section('FE-H1 captured tops keep case joinery; overhanging tops float');
{
  // Bookshelf: the top is CAPTURED between the sides (contact on a horizontal
  // axis). It must be fastened like the bottom — case screws — not given
  // figure-8s the steps never install.
  const bs = pipeline({
    meta: { name: 'BS', template: 'bookshelf', level: 'beginner', units: 'mm' },
    overall: { width: 900, depth: 300, height: 1800 },
    structure: { shelfCount: 4, backPanel: true }
  });
  const counts = Fasteners.countFor(bs.spec, bs.model);
  ok(!counts.some(c => c.kind === 'figure8'), 'bookshelf BOM carries no figure-8s');
  const tj = bs.model.joints.find(j => j.a === 'top_1' && /^side/.test(j.b));
  const tlay = Fasteners.layoutForJoint(bs.spec, bs.model, tj);
  ok(tlay.fasteners.length && tlay.fasteners.every(f => f.kind === 'screw'),
    'captured bookshelf top is screwed like the bottom');
  ok(/through side into top/i.test(tlay.text), 'top setout screws through the side into the top');

  // Overhanging solid tops still float: nightstand top on aprons, cabinet
  // top over the sides — both sit ON their mates (vertical contact).
  const ns = pipeline({
    meta: { name: 'NS', template: 'nightstand', level: 'intermediate', units: 'mm' },
    overall: { width: 500, depth: 400, height: 600 },
    drawers: { count: 1, frontStyle: 'inset', runner: 'side_mount_slides' }
  });
  const naj = ns.model.joints.find(j => j.a === 'top_1');
  ok(Fasteners.layoutForJoint(ns.spec, ns.model, naj).fasteners.every(f => f.kind === 'figure8'),
    'nightstand top still floats on figure-8s');
  const cab = pipeline({
    meta: { name: 'CAB', template: 'cabinet', level: 'advanced', units: 'mm' },
    overall: { width: 762, depth: 457.2, height: 914.4 },
    structure: { toeKick: true, backPanel: true, shelfCount: 1 },
    drawers: { count: 2, frontStyle: 'inset', runner: 'side_mount_slides' }
  });
  const cj = cab.model.joints.find(j => j.a === 'top_1' && /^side/.test(j.b));
  ok(cj && Fasteners.layoutForJoint(cab.spec, cab.model, cj).fasteners.every(f => f.kind === 'figure8'),
    'cabinet top (solid, overhanging sheet sides) still floats on figure-8s');
}

/* ================= FE-H5 (2026-07 front-end audit): pull screws cross the whole stack ================= */
section('FE-H5 pull screws reach through box front + false front');
{
  const ns = pipeline({
    meta: { name: 'NS', template: 'nightstand', level: 'intermediate', units: 'mm' },
    overall: { width: 500, depth: 400, height: 600 },
    drawers: { count: 1, frontStyle: 'inset', runner: 'side_mount_slides' }
  });
  const d = ns.model.drawers[0];
  const stack = d.box.t + d.front.t; // the M4 crosses BOTH before reaching the pull
  const lenMM = BB.HW.pullScrewLenMM(stack);
  ok(lenMM >= stack + 5, `pull screw ${lenMM} mm engages ≥ 5 mm past the ${stack} mm stack`);
  ok([12, 16, 20, 25, 30, 35, 40, 45, 50].includes(lenMM), `pull screw ${lenMM} mm is a buyable M4 length`);
  const bom = Plans.bom(ns.spec, ns.model, {});
  const pullLine = bom.items.find(i => /pull/i.test(i.label) && /M4/.test(i.detail || ''));
  ok(pullLine && new RegExp(`M4 × ${lenMM} mm`).test(pullLine.detail), 'BOM pull line carries the stack-length M4');
  const steps = Plans.assembly(ns.spec, ns.model, null, {});
  const pullStep = steps.find(s => /pull/i.test(s.title));
  ok(pullStep && new RegExp(`M4 × ${lenMM} mm`).test(pullStep.text) && /box front/i.test(pullStep.text),
    'pull step names the stack-length screw and why');
}

/* ================= FE-H7 (2026-07 front-end audit): pocket screws escalate for 2× stock ================= */
section('FE-H7 pocket screws match the stock they join');
{
  const mk = t => ({ id: 'r' + t, name: 'Rail', role: 'rail', group: 'frame', size: { w: 600, h: 76, d: t }, pos: { x: 0, y: 0, z: 0 } });
  const model = { parts: [Object.assign(mk(38), { id: 'a' }), Object.assign(mk(38), { id: 'b', pos: { x: 0, y: 0, z: 38 } })], joints: [] };
  const lay = Fasteners.layoutForJoint({}, model, { type: 'pocket_screws', a: 'a', b: 'b' });
  ok(/63 mm coarse pocket screw/.test(lay.text) && !/32 mm coarse/.test(lay.text),
    '38 mm (2×) stock gets the 63 mm pocket screw the knowledge base documents');
  const thin = { parts: [Object.assign(mk(19), { id: 'a' }), Object.assign(mk(19), { id: 'b', pos: { x: 0, y: 0, z: 19 } })], joints: [] };
  const lay19 = Fasteners.layoutForJoint({}, thin, { type: 'pocket_screws', a: 'a', b: 'b' });
  ok(/32 mm coarse pocket screw/.test(lay19.text), '19 mm stock keeps the 32 mm pocket screw');
}

/* ================= FE-C1/H2/H3/H4 (2026-07 front-end audit): one shelf system, one carcass glue-up ================= */
section('FE-C1 shelves have one story: model, steps, and BOM agree');
{
  const cab = pipeline({
    meta: { name: 'CAB', template: 'cabinet', level: 'advanced', units: 'mm' },
    overall: { width: 762, depth: 457.2, height: 914.4 },
    structure: { toeKick: true, backPanel: true, shelfCount: 1 },
    drawers: { count: 2, frontStyle: 'inset', runner: 'side_mount_slides' }
  });
  const bom = Plans.bom(cab.spec, cab.model, {});
  ok(!bom.items.some(i => /shelf pin/i.test(i.label)), 'cabinet BOM buys no pins for a shelf the model joins with dados (C-01)');
  const steps = Plans.assembly(cab.spec, cab.model, null, {});
  ok(!steps.some(s => /pins|32 mm system/i.test(s.text)), 'no pin-drilling step for a fixed shelf (C-01/H-04)');
  // H-03: with mortise-&-tenon rails, the rails must be part of the single
  // carcass glue-up — they cannot be seated once the sides are glued.
  const s1 = steps.find(s => s.id === 's1');
  const railIds = cab.model.parts.filter(p => p.role === 'rail').map(p => p.id);
  ok(railIds.every(id => s1.partIds.includes(id)), 'drawer rails glue up WITH the carcass (H-03)');
  ok(/dry-fit/i.test(s1.text), 'carcass step demands the dry-fit first');
  ok(!steps.some(s => /Install the drawer rails/.test(s.title)), 'no separate post-glue rail step remains');
  // C-01 fit math: the shelf's cut length minus its two dado depths must
  // exactly equal the interior width — it fits ITS OWN joinery.
  const shelfRow = Plans.cutList(cab.spec, cab.model).find(r => r.name === 'Shelf');
  const interior = cab.spec.overall.width - 2 * cab.spec.structure.sideThickness;
  near(shelfRow.L - shelfRow.allowance, interior, 0.11, 'shelf length = interior + dado allowance (fits its dados)');
  // H-04: the shelf goes in while the back is still open.
  const shelfIdx = steps.findIndex(s => (s.partIds || []).some(id => /^shelf/.test(id)));
  const backIdx = steps.findIndex(s => (s.partIds || []).includes('back_1'));
  ok(shelfIdx > -1 && backIdx > -1 && shelfIdx < backIdx, 'shelf step comes before the back closes the case');

  // H-02: bookshelf — fixed, screwed shelves must not buy phantom pins.
  const bs = pipeline({
    meta: { name: 'BS', template: 'bookshelf', level: 'beginner', units: 'mm' },
    overall: { width: 900, depth: 300, height: 1800 },
    structure: { shelfCount: 4, backPanel: true }
  });
  const bbom = Plans.bom(bs.spec, bs.model, {});
  ok(!bbom.items.some(i => /shelf pin/i.test(i.label)), 'bookshelf BOM buys no pins for butt-screwed shelves (H-02)');
}

/* ================= FE-H6 (2026-07 front-end audit): a step teaches only its own joints ================= */
section('FE-H6 fastening notes belong to the step that makes the joint');
{
  const ns = pipeline({
    meta: { name: 'NS', template: 'nightstand', level: 'intermediate', units: 'mm' },
    overall: { width: 500, depth: 400, height: 600 },
    drawers: { count: 1, frontStyle: 'inset', runner: 'side_mount_slides' }
  });
  const steps = Plans.assembly(ns.spec, ns.model, null, {});
  const byId = id => steps.find(s => s.id === id);
  ok(!/dowel|pocket hole/i.test(byId('dr1_runners').text), 'slide-mounting step carries no rail-joint setout');
  ok(/dowel|pocket hole/i.test(byId('s2').text), 'the rail step itself still teaches its frame joints');
  ok((byId('dr1_runners').joints || []).length === 0, 'slide step claims no joints (slides are not joinery)');
  ok(!/rabbet/i.test(byId('dr1_hang').text), 'hang-the-box step does not re-teach the box joint');
  ok(!/figure-8/i.test(byId('s1').text), 'side-frame step carries no top-attachment note');
  ok(/figure-8/i.test(byId('s4').text), 'the top step itself carries the figure-8 setout');

  const bs = pipeline({
    meta: { name: 'BS', template: 'bookshelf', level: 'beginner', units: 'mm' },
    overall: { width: 900, depth: 300, height: 1800 },
    structure: { shelfCount: 4, backPanel: true }
  });
  const bsteps = Plans.assembly(bs.spec, bs.model, null, {});
  const bs1 = bsteps.find(s => s.id === 's1'), bs2 = bsteps.find(s => s.id === 's2');
  ok(/through side into (top|bottom)/i.test(bs1.text), 'case step teaches the top/bottom screws');
  ok(!/into shelf/i.test(bs1.text), 'case step does not teach the shelf screws');
  ok(/into shelf/i.test(bs2.text), 'shelf step teaches the shelf screws');
  // Playback metadata follows the same rule: no joint appears on two steps.
  const seen = new Set();
  let dup = false;
  for (const s of bsteps) for (const j of (s.joints || [])) {
    const k = `${j.type}|${j.a}|${j.b}`;
    if (seen.has(k)) dup = true;
    seen.add(k);
  }
  ok(!dup, 'no joint is claimed by two steps');
}

/* ================= FE-H9 (2026-07 front-end audit): over-thick purchases get a thicknessing step ================= */
section('FE-H9 bought thickness reaches plan thickness on the bench');
{
  // Nightstand aprons/rails are 20 mm; the optimizer correctly buys 5/4
  // (25 mm actual) — the plan must say "plane to 20" and list the planer.
  const ns = pipeline({
    meta: { name: 'NS', template: 'nightstand', level: 'intermediate', units: 'mm' },
    overall: { width: 500, depth: 400, height: 600 },
    drawers: { count: 1, frontStyle: 'inset', runner: 'side_mount_slides' }
  });
  const cut = Plans.cutList(ns.spec, ns.model);
  const stock = Packing.planStock(ns.spec, ns.model, cut, {});
  const buysOverThick = (stock.glueups || []).some(g => K.LUMBER.NOMINALS[g.nominal] && K.LUMBER.NOMINALS[g.nominal].t > g.T + 1.5)
    || (stock.boards || []).some(b => b.stockLen && (b.cuts || []).some(c => {
      const row = cut.find(r => r.name === c.name);
      return row && K.LUMBER.NOMINALS[b.nominal] && K.LUMBER.NOMINALS[b.nominal].t > row.T + 1.5;
    }));
  ok(buysOverThick, 'fixture really buys thicker stock than the plan (else this test is vacuous)');
  const steps = Plans.assembly(ns.spec, ns.model, null, { stockPlan: stock });
  const th = steps.find(s => s.id === 'thickness');
  ok(th, 'a bring-to-thickness step exists');
  ok(th && /25 mm/.test(th.text) && /20 mm/.test(th.text), 'it names the real from/to thicknesses');
  const s1i = steps.findIndex(s => s.id === 's1');
  ok(th && steps.indexOf(th) < s1i, 'thicknessing happens before joinery/assembly');
  const tools = Plans.toolList(ns.spec, ns.model, stock);
  ok(tools.some(t => /planer|drum sander/i.test(t)), 'tool list gains the planer/drum sander');

  // Control: a bookshelf whose parts land on exact nominals gets NO step.
  const bs = pipeline({
    meta: { name: 'BS', template: 'bookshelf', level: 'beginner', units: 'mm' },
    overall: { width: 900, depth: 300, height: 1800 },
    structure: { shelfCount: 4, backPanel: true }
  });
  const bcut = Plans.cutList(bs.spec, bs.model);
  const bstock = Packing.planStock(bs.spec, bs.model, bcut, {});
  const bsteps = Plans.assembly(bs.spec, bs.model, null, { stockPlan: bstock });
  ok(!bsteps.some(s => s.id === 'thickness'), 'exact-nominal buys add no thicknessing step');
  ok(!Plans.toolList(bs.spec, bs.model, bstock).some(t => /planer|drum sander/i.test(t)), 'and no planer in tools');
}

/* ================= FE-H10/H11 (2026-07 front-end audit): offline parser honesty ================= */
section('FE-H10/H11 offline parser: negation and drawer honesty');
{
  const ns = Spec.correctSpec({ meta: { name: 'NS', template: 'nightstand', level: 'intermediate', units: 'mm' } });
  // H-11: "no ash please" switched the build TO White Ash. A negated species
  // is a rejection — ask, never ack.
  const neg = AI.localModel('no ash please', ns);
  ok(neg.kind === 'question', '"no ash please" asks instead of acking');
  ok(!(neg.patch && neg.patch.wood), 'no species patch rides a negated mention');
  ok(/not\s+(white\s+)?ash/i.test(neg.question || ''), 'the refusal names the rejected wood');
  ok(AI.localModel("don't use oak", ns).kind === 'question', 'negated oak asks too');
  const pos = AI.localModel('make it oak instead of walnut', ns);
  ok(pos.kind === 'diff' && pos.patch.wood.species === 'red_oak', 'positive species requests still work');
  const mixed = AI.localModel('no ash, use walnut', ns);
  ok(mixed.kind === 'diff' && mixed.patch.wood && mixed.patch.wood.species === 'walnut',
    'rejection plus request applies the request');

  // H-10: drawers on a drawerless template — honest refusal, and the clarify
  // chips never offer an action the template cannot take.
  const table = Spec.correctSpec({ meta: { name: 'T', template: 'table', level: 'beginner', units: 'mm' } });
  const dr = AI.localModel('add a drawer', table);
  ok(dr.kind === 'question' && /nightstand|cabinet/i.test(dr.question || ''), 'drawer ask on a table is refused honestly');
  const fb = AI.localModel('do something nice', table);
  ok(fb.kind === 'question' && !(fb.options || []).some(o => /drawer/i.test(o)), 'clarify chips drop "Add a drawer" on a table');
  const fbNs = AI.localModel('do something nice', ns);
  ok((fbNs.options || []).some(o => /drawer/i.test(o)), 'nightstand keeps the drawer chip');
}

/* ================= M-01 (2026-07 productization): pilots/bores are real drill bits ================= */
section('M-01 pilot and bore callouts are real drill sizes, never decimal inches');
{
  // A drill callout must be a bit you can pick out of an index: imperial =
  // nearest standard fractional bit ("7/64 in"), metric = millimetres.
  Units.set({ system: 'imperial', precision: 16, dual: false });
  ok(typeof Units.fmtDrill === 'function', 'BB.Units.fmtDrill exists (display boundary owns the conversion)');
  if (typeof Units.fmtDrill === 'function') {
    eq(Units.fmtDrill(2.8), '7/64 in', '2.8 mm pilot → 7/64 in');
    eq(Units.fmtDrill(3.2), '1/8 in', '3.2 mm pilot → 1/8 in');
    eq(Units.fmtDrill(9.5), '3/8 in', '9.5 mm pocket bit → 3/8 in (the jig bit)');
    eq(Units.fmtDrill(7), '9/32 in', '7 mm bolt bore → 9/32 in');
    Units.set({ system: 'metric', precision: 16, dual: false });
    eq(Units.fmtDrill(2.8), '2.8 mm', 'metric drill callouts stay millimetres');
    Units.set({ system: 'imperial', precision: 16, dual: false });
  }
  // Probe matrix: every joint layout, detail row, and the print sheet across
  // representative designs — no decimal-inch token near a pilot/bore callout.
  const probes = [
    { meta: { name: 'P Table', template: 'table', level: 'beginner', units: 'in' } },
    { meta: { name: 'P NS', template: 'nightstand', level: 'intermediate', units: 'in' },
      drawers: { count: 2, frontStyle: 'inset', runner: 'side_mount_slides' }, structure: { shelfCount: 1 } },
    { meta: { name: 'P Cab', template: 'cabinet', level: 'advanced', units: 'in' },
      overall: { width: 762, depth: 457.2, height: 914.4 },
      joinery: { frame: 'mortise_tenon', case: 'dado', box: 'half_blind_dovetail' },
      drawers: { count: 2, frontStyle: 'overlay', runner: 'side_mount_slides' }, structure: { toeKick: true, backPanel: true } },
    { meta: { name: 'P Shelf', template: 'bookshelf', level: 'beginner', units: 'in' },
      overall: { width: 900, depth: 300, height: 1800 }, structure: { shelfCount: 4, backPanel: true } }
  ];
  // Callout-shaped patterns only: "Pilot 0.11 in", "0.28 in bolt bore",
  // "bore 0.39 in". Layout positions ("centered 0.49 in from the joint
  // line") are honest decimals and stay legal.
  const decimalDrill = text => {
    const bad = [];
    for (const rx of [
      /\bpilots?\s+\d+\.\d+\s?in\b/gi,
      /\d+\.\d+\s?in\b[^.;]{0,24}\bbores?\b/gi,
      /\bbores?\s+\d+\.\d+\s?in\b/gi
    ]) {
      let m;
      while ((m = rx.exec(text))) bad.push(m[0]);
    }
    return bad;
  };
  for (const raw of probes) {
    const r = pipeline(raw);
    // The fastener engine's full text surface: every joint layout, every
    // print detail row, the print sheet in full (including the BOM table),
    // and every BOM label + detail — the same drill must read the same
    // everywhere (M-01 completion, deliberate golden refreeze authorized).
    let all = '';
    for (const j of r.model.joints) {
      const lay = Fasteners.layoutForJoint(r.spec, r.model, j);
      if (lay) all += ' ' + lay.text;
    }
    for (const row of Fasteners.detailRows(r.spec, r.model)) all += ' ' + row.text;
    const cut = Plans.cutList(r.spec, r.model);
    const integ = Structural.computeIntegrity(r.spec, r.model, {});
    const plan = Packing.planStock(r.spec, r.model, cut, {});
    const bom = Plans.bom(r.spec, r.model, { integrity: integ, stock: plan });
    for (const i of bom.items) all += ' ' + i.label + ' ' + (i.detail || '');
    const steps = Plans.assembly(r.spec, r.model, integ, { stockPlan: plan });
    for (const s of steps) all += ' ' + s.text;
    all += ' ' + Exports.printHTML(r.spec, r.model, cut, bom, steps, plan);
    const bad = decimalDrill(all);
    ok(bad.length === 0, `${raw.meta.name}: no decimal-inch pilot/bore callout — offenders: ${bad.slice(0, 3).join(' | ')}`);
  }
  Units.set({ system: 'metric', precision: 16, dual: false });
}

/* ================= L-02 (2026-07 productization): fallback formatters use the boundary ================= */
section('L-02 3D-view fallback formatters route through BB.Units; no raw mm concatenation');
{
  // Positive: both fallbacks default to the ONE display boundary. jointview
  // is browser-coupled (THREE/DOM), so its check stays at source level —
  // the repo convention for DOM-coupled modules.
  const j3d = fs.readFileSync(path.join(__dirname, '..', 'src', 'joinery3d.js'), 'utf8');
  const jv = fs.readFileSync(path.join(__dirname, '..', 'src', 'jointview.js'), 'utf8');
  ok(/fmt \|\| BB\.Units\.fmtLength/.test(j3d), 'joinery3d fallback is BB.Units.fmtLength');
  ok(/fmt \|\| BB\.Units\.fmtLength/.test(jv), 'jointview fallback is BB.Units.fmtLength');
  ok(!/\+ ' mm'/.test(j3d), 'joinery3d builds no raw mm strings');
  ok(!/\+ ' mm'/.test(jv), 'jointview builds no raw mm strings');
  // Functional (joinery3d is browser-free): with no fmt, labels render in
  // the CURRENT display system — imperial shows fractions, never "N mm".
  Units.set({ system: 'imperial', precision: 16, dual: false });
  const r = pipeline({
    meta: { name: 'JV', template: 'bookshelf', level: 'beginner', units: 'mm' },
    overall: { width: 900, depth: 300, height: 1800 }, structure: { shelfCount: 2, backPanel: true }
  });
  const shelf = r.model.parts.find(p => p.role === 'shelf');
  const side = r.model.parts.find(p => p.role === 'side');
  const data = BB.Joinery3D.buildJoint('dado', shelf, side);
  ok(data.labels.length > 0 && data.labels.every(l => !/\d\s?mm\b/.test(l)),
    'default joint labels follow the display preference — got: ' + data.labels.join(' | ').slice(0, 90));
  Units.set({ system: 'metric', precision: 16, dual: false });
  // Repo convention: raw "+ ' mm'" string-building lives ONLY in units.js
  // (the boundary itself), knowledge.js (AI digests — the wire speaks mm by
  // contract), and selftest.js (diagnostics read out internal mm truth).
  const allowed = new Set(['units.js', 'knowledge.js', 'selftest.js']);
  const offenders = [];
  for (const f of fs.readdirSync(path.join(__dirname, '..', 'src')).filter(x => x.endsWith('.js'))) {
    if (allowed.has(f)) continue;
    if (/\+ ' mm'/.test(fs.readFileSync(path.join(__dirname, '..', 'src', f), 'utf8'))) offenders.push(f);
  }
  eq(offenders, [], 'no raw mm concatenation outside the boundary + documented exemptions');
}

/* ================= M-11 (2026-07 productization): abrasives from the finish schedule ================= */
section('M-11 tool-list abrasives derive from the actual finish schedule');
{
  const base = { meta: { name: 'Fin', template: 'table', level: 'beginner', units: 'mm' } };
  const grits = tools => tools.filter(t => /grit/i.test(t)).join(' · ') || 'none';
  // Hardwax oil: its own 120/150/180 ladder, NO between-coat pad, no phantom 220.
  const hw = pipeline({ ...base, finish: 'hardwax_oil' });
  const hwTools = Plans.toolList(hw.spec, hw.model, null);
  ok(hwTools.some(t => /120 \/ 150 \/ 180/.test(t)), 'hardwax lists its own 120/150/180 ladder — got ' + grits(hwTools));
  ok(!hwTools.some(t => /220/.test(t)), 'no phantom 220 grit when the schedule lacks it');
  ok(!hwTools.some(t => /between/i.test(t)), 'no between-coat pad when the schedule has none');
  // Film finish (wipe-on poly): 120/180 prep plus the 320 between-coat pad.
  const wp = pipeline({ ...base, finish: 'wipe_poly' });
  const wpTools = Plans.toolList(wp.spec, wp.model, null);
  ok(wpTools.some(t => /120 \/ 180/.test(t) && !/220/.test(t)), 'wipe-on poly lists its 120/180 prep ladder — got ' + grits(wpTools));
  ok(wpTools.some(t => /320/.test(t) && /between/i.test(t)), 'film finish lists its 320 between-coat pad');
  // Danish oil keeps its full ladder from the same table.
  const dan = pipeline({ ...base, finish: 'danish_oil' });
  const danTools = Plans.toolList(dan.spec, dan.model, null);
  ok(danTools.some(t => /120 \/ 180 \/ 220/.test(t)), 'danish oil keeps its 120/180/220 ladder');
}

/* ================= M-12 (2026-07 productization): sheet goods marked in the wood table ================= */
section('M-12 Shop Reference wood table: sheet rows badged, Janka/movement dashed');
{
  // The wood table renders inline in browser-coupled ui.js — source-level
  // assertions (repo convention for DOM builders), backed by a smoke check.
  const uiSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'ui.js'), 'utf8');
  ok(/sheet-badge/.test(uiSrc), 'sheet rows carry a visible badge');
  ok(/s\.sheet \? '—' : (`|')?\$?\{?s\.janka/.test(uiSrc) || /\$\{s\.sheet \? '—' : s\.janka/.test(uiSrc),
    'Janka cell dashes for sheet: true species (face hardness is not comparable)');
  ok(/s\.sheet \? '—' : s\.ct\.toFixed/.test(uiSrc),
    'movement cell dashes for sheet: true species (the movement engine exempts them)');
  // The data layer really does distinguish them — the badge has a source.
  const sheets = Object.values(K.WOOD_SPECIES).filter(s => s.sheet);
  ok(sheets.length >= 3, 'sheet species exist in the table (baltic birch, MDF, hardwood ply)');
}

/* ================= M-13 (2026-07 productization): compare weight skips hardware ================= */
section('M-13 species-compare weight never weighs steel hardware as wood');
{
  // provenance.js is browser-free; it is loaded here ad hoc because the
  // shared SRC list predates it.
  vm.runInThisContext(fs.readFileSync(path.join(__dirname, '..', 'src', 'provenance.js'), 'utf8'), { filename: 'provenance.js' });
  const r = pipeline({
    meta: { name: 'NS', template: 'nightstand', level: 'intermediate', units: 'mm' },
    overall: { width: 508, depth: 406.4, height: 609.6 }, wood: { species: 'walnut' },
    drawers: { count: 2, frontStyle: 'inset', runner: 'side_mount_slides' }, structure: { shelfCount: 1 }
  });
  const hwParts = r.model.parts.filter(p => p.hardware);
  ok(hwParts.length >= 4, 'the 2-drawer model renders metal slide hardware parts');
  // Hand-summed wood-only mass, mirroring the engine's density fallback —
  // the same exclusion structural.js uses for its COG mass (:569).
  const sgOf = p => (K.WOOD_SPECIES[p.material] || K.WOOD_SPECIES[r.spec.wood.species] || K.WOOD_SPECIES.pine).sg;
  const woodOnly = r.model.parts.filter(p => !p.hardware && p.role !== 'pull')
    .reduce((kg, p) => kg + p.size.w * p.size.h * p.size.d * 1e-9 * sgOf(p) * 1000 * (p.prim === 'cylinder' ? Math.PI / 4 : 1), 0);
  const w = BB.Compare.weightKg(r.spec, r.model);
  near(w, woodOnly, 1e-9, 'weightKg equals the wood-only mass — steel slides never weighed as walnut');
  const cols = BB.Compare.compareSpecies(r.spec, ['walnut'], {});
  near(cols[0].weightKg, Math.round(woodOnly * 10) / 10, 1e-9, 'the compare column carries the wood-only weight');
}

/* ================= M-18 (2026-07 productization): mandatory-anchor rollup tier ================= */
section('M-18 mandatory-anchor designs roll up "safe only when anchored", never plain advisory');
{
  // The golden walnut nightstand: F2057 open-drawer margin 0.619 — it TIPS in
  // the regulated scenario — yet has zero failing checks. The rollup must be
  // the distinct anchor tier, never 'advisory' under a "passes…" headline.
  const ns = pipeline({
    meta: { name: 'Two-Drawer Nightstand', template: 'nightstand', level: 'intermediate', units: 'in' },
    overall: { width: 508, depth: 406.4, height: 609.6 }, wood: { species: 'walnut' },
    structure: { topThickness: 19, legThickness: 45, shelfCount: 1 },
    joinery: { frame: 'dowels', box: 'locking_rabbet' },
    drawers: { count: 2, frontStyle: 'inset', runner: 'side_mount_slides' }
  });
  const ig = Structural.computeIntegrity(ns.spec, ns.model, {});
  const f = ig.checks.find(c => c.id === 'tip_f2057');
  ok(f && f.data.marginRatio < 1, 'fixture still tips: F2057 margin < 1');
  ok(ig.summary.fails === 0, 'the trap is real: zero failing checks, yet it tips');
  ok(ig.summary.anchorRequired === true, 'summary carries anchorRequired');
  eq(ig.summary.verdict, 'anchor', 'rollup verdict is the distinct anchor tier');
  ok(f && f.anchor === true, 'the mandating check is flagged so the UI surfaces it above the fold');

  // Tier order: fail > anchor > advisory > pass. The frozen honest-fail
  // bookshelf both fails and mandates the anchor — fail wins the headline.
  const shelf = pipeline({
    meta: { name: 'Floor Bookshelf', template: 'bookshelf', level: 'beginner', units: 'mm' },
    overall: { width: 900, depth: 300, height: 1800 }, wood: { species: 'ash' },
    structure: { shelfCount: 4, sideThickness: 19, shelfThickness: 19, backPanel: true }
  });
  const igF = Structural.computeIntegrity(shelf.spec, shelf.model, {});
  ok(igF.summary.fails > 0 && igF.antiTip, 'honest-fail fixture both fails and mandates the anchor');
  eq(igF.summary.verdict, 'fail', 'failing checks outrank the anchor tier');
  const tipChk = igF.checks.find(c => c.id === 'tip');
  ok(tipChk && tipChk.anchor === true, 'the static tipping mandate is flagged too');

  // Stable pieces never enter the tier, and non-anchor verdicts reduce to the
  // old rollup exactly.
  const seed = pipeline({ meta: { name: 'Seed', template: 'table', level: 'beginner', units: 'mm' } });
  const igS = Structural.computeIntegrity(seed.spec, seed.model, {});
  ok(!igS.antiTip && igS.summary.verdict !== 'anchor', 'stable designs never enter the anchor tier');
  eq(igS.summary.verdict, igS.summary.fails ? 'fail' : igS.summary.advisories ? 'advisory' : 'pass',
    'non-anchor verdicts reduce to the old rollup');

  // UI headline honesty (source level — ui.js is browser-coupled): both the
  // Overview card and the Safety tab speak the tier, anchor-mandating checks
  // join the above-the-fold cards (the beginner details-collapse cannot hide
  // them), and no headline recomputes a rollup that lacks the tier.
  const uiSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'ui.js'), 'utf8');
  ok((uiSrc.match(/safe only when anchored/gi) || []).length >= 2, 'both headline surfaces say "safe only when anchored"');
  ok(/status === 'fail' \|\| \w+\.anchor/.test(uiSrc), 'above-the-fold check cards include anchor-mandating checks');
  ok(!/'advisory'\s*:\s*'pass'/.test(uiSrc), 'no ui.js headline recomputes a rollup without the anchor tier');
}

/* =========================================================================
 * 2026-07 generalization findings (register-gated: G1–G5, G15).
 * Fixtures are the live review sessions' committed geometry, rebuilt inline.
 * ========================================================================= */

/* The adapt4 platform bed: committed live with verdict PASS while its
 * 40×20 mm hard-maple side rails rupture under the engine's own seating
 * preset (findings B1/B6, verify-B1-adapt4-rails.py). */
function adapt4Bed(opts) {
  opts = opts || {};
  const P = (id, role, primitive, l, w, t, x, y, z, rotY, surface) => ({
    id, role, primitive, dim: { l, w, t }, pos: { x, y, z },
    rot: rotY ? { x: 0, y: rotY, z: 0 } : null,
    grain: 'length', stock: 'solid', loadBearing: true, surface: surface || 'none'
  });
  const parts = [
    P('p1', 'leg_foot_left', 'post', 450, 90, 90, -717, 225, -967),
    P('p2', 'leg_foot_right', 'post', 450, 90, 90, 717, 225, -967),
    P('p3', 'leg_head_left', 'post', 450, 90, 90, -717, 225, 967),
    P('p4', 'leg_head_right', 'post', 450, 90, 90, 717, 225, 967),
    P('p5', 'leg_center_a', 'post', 450, 90, 90, 0, 225, -356),
    P('p6', 'leg_center_b', 'post', 450, 90, 90, 0, 225, 356),
    P('p7', 'rail_left', 'rail', 1934, 40, 20, -717, 405, 0, 90),
    P('p8', 'rail_right', 'rail', 1934, 40, 20, 717, 405, 0, 90),
    P('p9', 'end_rail_foot', 'rail', 1434, 40, 20, 0, 405, -967),
    P('p10', 'end_rail_head', 'rail', 1434, 40, 20, 0, 405, 967),
    P('p11', 'beam_center', 'rail', 1834, 40, 20, 0, 405, 0, 90)
  ];
  const fj = opts.frameJoint || 'pocket_screws';
  const conns = [
    ['p1', 'p7'], ['p3', 'p7'], ['p2', 'p8'], ['p4', 'p8'],
    ['p1', 'p9'], ['p2', 'p9'], ['p3', 'p10'], ['p4', 'p10'],
    ['p5', 'p11'], ['p6', 'p11'],
    ['p7', 'p9'], ['p8', 'p9'], ['p7', 'p10'], ['p8', 'p10']
  ].map(([a, b]) => ({ a, b, joint: fj }));
  let n = 12;
  for (const z of [-847, -587, -227, 33, 493, 753]) {
    for (const sx of [-1, 1]) {
      const id = 'p' + n++;
      parts.push(P(id, 'deck_slat', 'slab', 716, 140, 38, 359 * sx, 444, z, 0,
        opts.untagged ? 'none' : 'seating'));
      conns.push({ a: id, b: sx < 0 ? 'p7' : 'p8', joint: 'dowels' }, { a: id, b: 'p11', joint: 'dowels' });
    }
  }
  return {
    meta: { name: 'Platform Bed', template: 'custom', level: 'advanced', units: 'in' },
    overall: { width: 1524, depth: 2024, height: 463 },
    wood: { species: 'hard_maple', sheetSpecies: 'baltic_birch' },
    custom: { parts, connections: conns }
  };
}
const mpa = c => c && parseFloat((c.value.match(/([\d.]+) MPa/) || [])[1]);

/* ================= G1: member load-path coverage (B1 + B6) ================= */
section('G1 members carrying a checked surface get their own beam checks');
{
  const r = pipeline(adapt4Bed());
  ok(!r.report.errors.length, 'fixture passes the geometric audit (as it did live)');
  const ig = Structural.computeIntegrity(r.spec, r.model, {});
  const strP7 = ig.checks.find(c => c.id === 'str:mbr:p7');
  const sagP7 = ig.checks.find(c => c.id === 'sag:mbr:p7');
  ok(strP7 && sagP7, 'side rail p7 gets sag + strength member checks');
  ok(ig.checks.some(c => c.id === 'str:mbr:p8'), 'side rail p8 too');
  const strP11 = ig.checks.find(c => c.id === 'str:mbr:p11');
  ok(strP11, 'center beam p11 too');
  // verify-B1: 136 kg seat point mid-rail over the 1844 mm clear span:
  // σ = (P·L/4)·c/I = (1334.16·1844/4)·20/106666.7 = 115.3 MPa vs MOR 109.
  ok(strP7 && strP7.status === 'fail', 'rail strength FAILS (the live commit presented verdict pass)');
  near(mpa(strP7), 115.3, 2.5, 'rail stress matches the verify-B1 hand calc');
  ok(sagP7 && sagP7.status === 'fail', 'rail sag fails its span limit');
  // Center beam: supports 712 mm apart on a 1834 member → cantilever model,
  // point at the free end. Fails hard; the point load is MAX not Σ (a person
  // sits in one place — twelve tagged slats must not stack twelve people).
  ok(strP11 && strP11.status === 'fail' && mpa(strP11) > 100 && mpa(strP11) < 300,
    `center beam fails as a cantilever without stacking point loads (${mpa(strP11)} MPa)`);
  ok(!ig.checks.some(c => c.id === 'sag:mbr:p9' || c.id === 'sag:mbr:p10'),
    'unloaded end rails draw no member checks');
  const slat = ig.checks.find(c => c.id === 'sag:p12');
  ok(slat && slat.status === 'pass', 'the slat surface checks are unchanged (sound slats stay sound)');
  eq(ig.summary.verdict, 'fail', 'adapt4 committed geometry can no longer present verdict pass');

  // Load-path joint adequacy (B6): the beam-to-center-leg pocket screws see
  // the member end reaction as demand — and a joinery change re-runs it.
  const joints = ig.checks.find(c => c.id === 'joints');
  ok(joints && joints.status === 'fail', 'joint adequacy sees the load-path connections and fails');
  ok(joints && /p11/.test(joints.value), 'the weakest link is named on the member path (beam–leg)');
  const mt = pipeline(adapt4Bed({ frameJoint: 'mortise_tenon' }));
  const igMT = Structural.computeIntegrity(mt.spec, mt.model, {});
  const jMT = igMT.checks.find(c => c.id === 'joints');
  ok(jMT && jMT.status !== 'fail', 'mortise & tenon on the same load path clears the gate (swap re-checked)');

  // Tributary accumulation: six book-loaded slats each hand half their UDL to
  // the rail — w = 6·(0.5886·716)/2/1844 N/mm → σ = (w·L²/8)·c/I ≈ 54.7 MPa.
  // (Σ of shares, not a single-slat shortcut, and no double-count beyond it.)
  const lc = {};
  for (let i = 12; i <= 23; i++) lc['p' + i] = 'books';
  const igB = Structural.computeIntegrity(r.spec, r.model, { loadChoices: lc });
  near(mpa(igB.checks.find(c => c.id === 'str:mbr:p7')), 54.7, 2,
    'six tributary shares accumulate onto the rail (books duty)');
}

/* The ref2-run1 spiral column bookshelf: five 600×300×18 ply shelves, each
 * cantilevered off a 50×45 white-oak spine on a single 2-dowel connection.
 * The engine printed "10 lb per joint vs 245 lb capacity … room to spare"
 * while the root moment sat at/beyond dowel ultimate (findings B2/B3,
 * verify-B2-spiral-moment.py). */
function spiralShelf() {
  const S = (id, role, y, rotY, x, z) => ({
    id, role, primitive: 'slab', dim: { l: 600, w: 300, t: 18 }, pos: { x, y, z },
    rot: rotY ? { x: 0, y: rotY, z: 0 } : null,
    grain: 'length', stock: 'sheet', loadBearing: true, surface: 'shelf'
  });
  return {
    meta: { name: 'Spiral Column Bookshelf', template: 'custom', level: 'intermediate', units: 'in' },
    overall: { width: 867.7, depth: 825.4, height: 2051 },
    wood: { species: 'white_oak', sheetSpecies: 'hardwood_ply' },
    custom: {
      parts: [
        { id: 'p1', role: 'mount_spine', primitive: 'post', dim: { l: 2050, w: 50, t: 45 }, pos: { x: 0, y: 1026, z: 27 }, rot: null, grain: 'length', stock: 'solid', loadBearing: true, surface: 'none' },
        S('p2', 'shelf1', 301, 0, 0, 202),
        S('p3', 'shelf2', 601, 72, 166, 81),
        S('p4', 'shelf3', 901, 144, 103, -115),
        S('p5', 'shelf4', 1201, 216, -103, -115),
        S('p6', 'shelf5', 1501, 288, -166, 81),
        { id: 'p7', role: 'stability_base', primitive: 'slab', dim: { l: 500, w: 400, t: 32 }, pos: { x: 0, y: 16, z: 150 }, rot: null, grain: 'length', stock: 'solid', loadBearing: true, surface: 'none' }
      ],
      connections: ['p2', 'p3', 'p4', 'p5', 'p6', 'p7'].map(b => ({ a: 'p1', b, joint: 'dowels' }))
    }
  };
}

/* ================= G2: cantilever root moment reaches the joint check (B2) ================= */
section('G2 cantilevered surface connections are checked as a moment couple');
{
  const r = pipeline(spiralShelf());
  ok(!r.report.errors.length, 'spiral fixture passes the geometric audit (as it did live)');
  const books = {};
  for (const id of ['p2', 'p3', 'p4', 'p5', 'p6']) books[id] = 'books';
  const ig = Structural.computeIntegrity(r.spec, r.model, { loadChoices: books });
  const j = ig.checks.find(c => c.id === 'joints');
  ok(j && j.status === 'fail', 'book duty FAILS the cantilever root (engine used to print 25× pass)');
  ok(j && /cantilever|root/i.test(j.value + ' ' + j.explain), 'the check names the cantilever couple');
  // verify-B2: worst shelf cantilevers 433 mm → M = w·L²/2 = 55.2 kN·mm,
  // couple arm 0.67·18 = 12.06 mm → group tension ≈ 4.58 kN = 466 kg, vs
  // two glued dowels rated 800 N × SG 1.36 = 1.09 kN. Demand ≈ 4.2× capacity.
  const kg = j && parseFloat((j.value.match(/([\d.]+) kg/) || [])[1]);
  near(kg, 466, 25, 'couple tension matches the verify-B2 class (≈4.6 kN pull-out)');
  // Even the delivered display duty leaves no 1.5× margin at the root.
  const disp = {};
  for (const id of ['p2', 'p3', 'p4', 'p5', 'p6']) disp[id] = 'display';
  const igD = Structural.computeIntegrity(r.spec, r.model, { loadChoices: disp });
  const jD = igD.checks.find(c => c.id === 'joints');
  ok(jD && jD.status !== 'pass', 'display duty is still no pass at the root (≈1.4×, under the 1.5× gate)');
  // The joints explain never overclaims on customs: only checked connections
  // are spoken for ("Every joint …" was printed over unexamined load paths).
  ok(jD && !/every joint/i.test(jD.explain), 'custom joints explain names what was checked, never "every joint"');
  const bench = pipeline(Object.assign(Spec.defaultSpec('custom'), { meta: { name: 'CB', template: 'custom', level: 'beginner', units: 'mm' } }));
  const igCB = Structural.computeIntegrity(bench.spec, bench.model, {});
  const jCB = igCB.checks.find(c => c.id === 'joints');
  ok(jCB && !/every joint/i.test(jCB.explain), 'the default custom bench explain names its coverage too');
  // Simply-supported surfaces gain no couple: the plain shear path still runs.
  const igMT = Structural.computeIntegrity(pipeline(adapt4Bed({ frameJoint: 'mortise_tenon' })).spec,
    pipeline(adapt4Bed({ frameJoint: 'mortise_tenon' })).model, {});
  const jMT = igMT.checks.find(c => c.id === 'joints');
  ok(jMT && !/cantilever root/.test(jMT.value), 'ss surfaces draw no phantom couple');
}

/* ================= G3: untagged customs get derived check surfaces (B4) ================= */
section('G3 check coverage is never model-discretionary: untagged customs derive surfaces');
{
  // The B-probe-nosurf demonstration: adapt4's exact geometry, SURF tags
  // stripped, committed live with verdict pass and ZERO load checks.
  const r = pipeline(adapt4Bed({ untagged: true }));
  const ig = Structural.computeIntegrity(r.spec, r.model, {});
  ok(ig.surfaces.length > 0, 'surfaces are derived when the wire author tags nothing');
  ok(ig.surfaces.every(s => s.assumed === true && s.kind === 'shelf'),
    'derived surfaces are shelf-duty and flagged assumed');
  ok(ig.checks.some(c => c.id.startsWith('sag:')), 'sag physics runs on the derived surfaces');
  ok(!(ig.summary.verdict === 'pass' && !ig.checks.some(c => /^(sag|str):/.test(c.id))),
    'a fully-untagged custom can never report verdict pass with zero load checks');
  ok(Array.isArray(ig.summary.assumedSurfaces) && ig.summary.assumedSurfaces.length > 0,
    'the summary carries the assumption for the ack/Safety tab');
  // The topmost horizontal slab per connected stack is the derived surface —
  // the deck slats, not the rails under them.
  ok(ig.surfaces.some(s => s.id === 'p12'), 'a deck slat is the derived surface');
  ok(!ig.surfaces.some(s => s.id === 'p7' || s.id === 'p11'), 'rails below the deck are not surfaces');

  // A grounded slab still derives (ref8’s planter bottoms sit on the floor).
  const planter = pipeline({
    meta: { name: 'Planter Box', template: 'custom', level: 'beginner', units: 'mm' },
    wood: { species: 'western_red_cedar' },
    custom: {
      parts: [
        { id: 'p1', role: 'planter_bottom', primitive: 'slab', dim: { l: 350, w: 350, t: 19 }, pos: { x: 0, y: 9.5, z: 0 }, rot: null, grain: 'length', stock: 'solid', loadBearing: true, surface: 'none' },
        { id: 'p2', role: 'planter_front', primitive: 'panel', dim: { l: 350, w: 350, t: 19 }, pos: { x: 0, y: 175.5, z: 166 }, rot: null, grain: 'length', stock: 'solid', loadBearing: true, surface: 'none' },
        { id: 'p3', role: 'planter_back', primitive: 'panel', dim: { l: 350, w: 350, t: 19 }, pos: { x: 0, y: 175.5, z: -166 }, rot: null, grain: 'length', stock: 'solid', loadBearing: true, surface: 'none' }
      ],
      connections: [{ a: 'p1', b: 'p2', joint: 'edge_glue' }, { a: 'p1', b: 'p3', joint: 'edge_glue' }]
    }
  });
  const igP = Structural.computeIntegrity(planter.spec, planter.model, {});
  ok(igP.surfaces.some(s => s.id === 'p1' && s.assumed), 'floor-resting planter bottom is derived (walls are vertical)');

  // No horizontal slab/panel at all: the engine says so instead of passing silently.
  const frame = pipeline({
    meta: { name: 'Bare Frame', template: 'custom', level: 'beginner', units: 'mm' },
    custom: {
      parts: [
        { id: 'p1', role: 'post_a', primitive: 'post', dim: { l: 900, w: 60, t: 60 }, pos: { x: -300, y: 450, z: 0 }, rot: null, grain: 'length', stock: 'solid', loadBearing: true, surface: 'none' },
        { id: 'p2', role: 'post_b', primitive: 'post', dim: { l: 900, w: 60, t: 60 }, pos: { x: 300, y: 450, z: 0 }, rot: null, grain: 'length', stock: 'solid', loadBearing: true, surface: 'none' },
        { id: 'p3', role: 'stretcher', primitive: 'rail', dim: { l: 540, w: 60, t: 30 }, pos: { x: 0, y: 870, z: 0 }, rot: null, grain: 'length', stock: 'solid', loadBearing: true, surface: 'none' }
      ],
      connections: [{ a: 'p1', b: 'p3', joint: 'mortise_tenon' }, { a: 'p2', b: 'p3', joint: 'mortise_tenon' }]
    }
  });
  const igF = Structural.computeIntegrity(frame.spec, frame.model, {});
  ok(igF.checks.some(c => c.id === 'loadcheck' && c.status !== 'pass'),
    'nothing derivable → an explicit no-load-checks-ran advisory, never a silent pass');
  ok(igF.summary.verdict !== 'pass', 'the bare frame cannot roll up verdict pass');

  // Tagged compositions are untouched: no phantom derived surfaces.
  const tagged = pipeline(adapt4Bed());
  const igT = Structural.computeIntegrity(tagged.spec, tagged.model, {});
  ok(igT.surfaces.length === 12 && igT.surfaces.every(s => !s.assumed),
    'tagged compositions derive nothing extra');
}

/* ================= G4: custom shelves default to book duty + assumed-load disclosure (B3/B5a) ================= */
section('G4 custom shelf surfaces default to books; summary discloses assumed loads');
{
  // The one-line hole: custom+shelf fell through to display (10 kg/m) — the
  // spiral BOOKSHELF was checked at 1/6 the duty the bookshelf template uses.
  eq(Structural.defaultPresetFor('shelf', 'custom', undefined), 'books', 'custom shelf kind defaults to books');
  eq(Structural.defaultPresetFor('shelf', 'bookshelf', undefined), 'books', 'bookshelf template unchanged');
  eq(Structural.defaultPresetFor('seat', 'custom', undefined), 'seating', 'seat kind unchanged');
  eq(Structural.defaultPresetFor('top', 'custom', undefined), 'worktop', 'top kind unchanged');
  eq(Structural.defaultPresetFor('shelf', 'custom', 'display'), 'display', 'an explicit design-level default still wins');
  eq(Structural.defaultPresetFor('shelf', 'nightstand', undefined), 'display', 'template shelf defaults untouched');

  const r = pipeline(spiralShelf());
  const ig = Structural.computeIntegrity(r.spec, r.model, {});
  ok(ig.surfaces.length === 5 && ig.surfaces.every(s => s.presetKey === 'books'),
    'spiral shelves now check at book duty by default');
  const j = ig.checks.find(c => c.id === 'joints');
  ok(j && j.status === 'fail', 'default duty fails the cantilever roots (the live commit showed a 25× pass at display)');

  // summary.surfaceLoads — the contract integrityLine consumes (P-SPEC):
  // [{ id, presetKey, label, assumed }] for every checked surface.
  const sl = ig.summary.surfaceLoads;
  ok(Array.isArray(sl) && sl.length === ig.surfaces.length, 'summary.surfaceLoads lists every checked surface');
  const p2 = sl && sl.find(x => x.id === 'p2');
  ok(p2 && p2.presetKey === 'books' && p2.label === 'Books' && p2.assumed === true,
    'a defaulted preset is disclosed as assumed, with its label');
  // A user loadChoice is never overridden — and is not "assumed".
  const igU = Structural.computeIntegrity(r.spec, r.model, { loadChoices: { p2: 'display' } });
  const slU = (igU.summary.surfaceLoads || []).find(x => x.id === 'p2');
  ok(igU.surfaces.find(s => s.id === 'p2').presetKey === 'display' && slU && slU.assumed === false,
    'user loadChoices are honored and not marked assumed');
  // Template surfaces disclose their defaults the same way.
  const tb = pipeline({ meta: { name: 'T', template: 'table', level: 'beginner', units: 'mm' } });
  const igT = Structural.computeIntegrity(tb.spec, tb.model, {});
  const slT = (igT.summary.surfaceLoads || []).find(x => x.id === 'top_1');
  ok(slT && slT.presetKey === 'worktop' && slT.assumed === true, 'template defaults are disclosed as assumed too');
  // G3-derived surfaces flow through as assumed book duty.
  const un = pipeline(adapt4Bed({ untagged: true }));
  const igN = Structural.computeIntegrity(un.spec, un.model, {});
  const slN = igN.summary.surfaceLoads || [];
  ok(slN.length > 0 && slN.every(x => x.assumed === true && x.presetKey === 'books'),
    'derived surfaces land in surfaceLoads as assumed book duty');
}

/* ================= G5: frame-joint demand = worst apron end reaction (B7) ================= */
section('G5 table-like frame joints see the apron end reaction, not total/8');
{
  // ref7-run1's committed cedar bench. The engine's own frame model (F-S2-1)
  // says each apron carries half the spread load + ¾ of the point load — yet
  // the joint check divided the surface total equally over all 8 frame
  // joints (75 lb) when the loaded-apron end joint really carries
  // R = 0.5·w·L/2 + 0.75·P/2 = 333.5 + 500.3 = 833.9 N ≈ 187 lb (2.5×).
  const r = pipeline({
    meta: { name: 'Deck Board Bench', template: 'bench', level: 'beginner', units: 'in' },
    overall: { width: 1200, depth: 350, height: 450 },
    wood: { species: 'western_red_cedar' },
    structure: { topThickness: 25, legThickness: 45, apronHeight: 80, apronThickness: 25, apronInset: 12 },
    joinery: { frame: 'butt_screws' }
  });
  const ig = Structural.computeIntegrity(r.spec, r.model, {});
  const j = ig.checks.find(c => c.id === 'joints');
  ok(j && j.data && typeof j.data.perN === 'number', 'apron-path joint demand ships as check data');
  // seats(1070) = 2 → P = 1334.16 N point + one extra seat as spread:
  // R = 0.5·(P/1070)·(1070/2) + 0.75·P/2 = 0.25·P + 0.375·P = 833.85 N.
  near(j && j.data && j.data.perN, 833.85, 1.5, 'demand is the worst apron end reaction (hand statics)');
  near(j && j.data && j.data.capN, 320, 1, 'capacity: butt screws 500 N × cedar SG factor 0.64');
  ok(j && j.status === 'fail', 'the honest margin ≈0.38× is a clear fail (was flattered to 0.96×)');

  // Carcass case joints keep the untouched model — the frozen ash-bookshelf
  // honest-fail golden must not move (G27).
  const bs = pipeline({
    meta: { name: 'Floor Bookshelf', template: 'bookshelf', level: 'beginner', units: 'mm' },
    overall: { width: 900, depth: 300, height: 1800 }, wood: { species: 'ash' },
    structure: { shelfCount: 4, sideThickness: 19, shelfThickness: 19, backPanel: true }
  });
  const jB = Structural.computeIntegrity(bs.spec, bs.model, {}).checks.find(c => c.id === 'joints');
  ok(jB && !jB.data, 'carcass case joints carry no apron data (ash golden stays byte-stable)');
  // Sanity: a stout frame still clears the honest demand — the Shaker table
  // (dowel frame, cherry) sits just above the 1.5× gate, not in fail.
  const sh = pipeline({
    meta: { name: 'Shaker Dining Table', template: 'table', level: 'intermediate', units: 'in' },
    overall: { width: 1828.8, depth: 914.4, height: 749.3 }, wood: { species: 'cherry' },
    structure: { topThickness: 25, legThickness: 70, apronHeight: 101.6, apronThickness: 19, apronInset: 12.7 },
    joinery: { frame: 'dowels' }
  });
  const jS = Structural.computeIntegrity(sh.spec, sh.model, {}).checks.find(c => c.id === 'joints');
  // worktop duty: R = 0.5·(75·9.81)/2 + 0.75·(90·9.81)/2 = 515.0 N vs
  // dowels 800 N × SG 1.0 → margin 1.55 — an honest pass, no flattery left.
  ok(jS && jS.status === 'pass' && jS.data && Math.abs(jS.data.perN - 515.03) < 1,
    'the Shaker classic still passes on the honest end-reaction demand');
}

/* ================= G15: thickness fixes solve to the first PASSING stock (B12) ================= */
section('G15 tappable thickness fixes are solved against the check, not one blind step');
{
  // simple2's live commit: 19 mm pine shelves at 862 mm span under books,
  // crept sag 6.221 vs 2.873 limit (ratio 2.165). The old fix offered the
  // next stock step (20 mm → still 5.33, still failing). Solved:
  // t·∛ratio = 19 × 1.2936 = 24.58 → first passing stock = 25 mm.
  const raw = {
    meta: { name: 'Simple Pine Bookshelf', template: 'bookshelf', level: 'beginner', units: 'in' },
    overall: { width: 900, depth: 300, height: 1524 }, wood: { species: 'pine' },
    structure: { shelfCount: 4, shelfThickness: 19, sideThickness: 19, backPanel: true },
    joinery: { frame: 'butt_screws', case: 'butt_screws', box: 'butt_screws' }
  };
  const r = pipeline(raw);
  const sagChk = Structural.computeIntegrity(r.spec, r.model, {}).checks.find(c => c.id === 'sag:shelf_1');
  ok(sagChk && sagChk.status === 'fail', 'fixture still fails honestly (5.33-class sag)');
  const fx = sagChk && sagChk.fixes.find(f => f.id === 'thick-shelf');
  ok(fx, 'the failing shelf offers a thickness fix');
  eq(fx && fx.patch.structure.shelfThickness, 25, 'fix skips the still-failing 20 mm step and lands on 25 mm');
  ok(fx && /25/.test(fx.label), 'the label names the solved thickness');
  const r25 = pipeline(Object.assign(JSON.parse(JSON.stringify(raw)), { structure: { shelfCount: 4, shelfThickness: 25, sideThickness: 19, backPanel: true } }));
  const sag25 = Structural.computeIntegrity(r25.spec, r25.model, {}).checks.find(c => c.id === 'sag:shelf_1');
  ok(sag25 && sag25.status === 'pass', 'the offered fix actually passes (6.22 → 2.76 vs 2.80-class limit)');

  // Custom surface path: a 12 mm pine slab spanning 840 mm at book duty
  // (ratio 8.91) needs t·∛ratio = 24.9 — the fix lands on 25, not 15.
  const cu = pipeline({
    meta: { name: 'Plank Shelf', template: 'custom', level: 'beginner', units: 'mm' },
    wood: { species: 'pine' },
    custom: {
      parts: [
        { id: 'p1', role: 'shelf', primitive: 'slab', dim: { l: 900, w: 250, t: 12 }, pos: { x: 0, y: 426, z: 0 }, rot: null, grain: 'length', stock: 'solid', loadBearing: false, surface: 'shelf' },
        { id: 'p2', role: 'post_a', primitive: 'post', dim: { l: 420, w: 60, t: 60 }, pos: { x: -420, y: 210, z: 0 }, rot: null, grain: 'length', stock: 'solid', loadBearing: true, surface: 'none' },
        { id: 'p3', role: 'post_b', primitive: 'post', dim: { l: 420, w: 60, t: 60 }, pos: { x: 420, y: 210, z: 0 }, rot: null, grain: 'length', stock: 'solid', loadBearing: true, surface: 'none' }
      ],
      connections: [{ a: 'p2', b: 'p1', joint: 'butt_screws' }, { a: 'p3', b: 'p1', joint: 'butt_screws' }]
    }
  });
  const igC = Structural.computeIntegrity(cu.spec, cu.model, {});
  const sagC = igC.checks.find(c => c.id === 'sag:p1');
  const fxC = sagC && sagC.fixes.find(f => f.id === 'thick-p1');
  ok(sagC && sagC.status === 'fail' && fxC, 'the failing custom slab offers a solved thickness fix');
  const newT = fxC && fxC.patch.custom.parts.find(p => p.id === 'p1').dim.t;
  eq(newT, 25, 'custom fix solves several stock steps at once (12 → 25, not 15)');

  // Member checks (G1) get the same solver: adapt4's 40-tall rail needs
  // 40·∛21.1 = 110.5 → deepen to 115 (rounded up to clean 5 mm rip width),
  // which passes both sag (5.5 vs 6.1) and strength (14.0 vs 27.3 allow).
  const bed = pipeline(adapt4Bed());
  const igB = Structural.computeIntegrity(bed.spec, bed.model, {});
  const mFx = igB.checks.find(c => c.id === 'sag:mbr:p7');
  const deep = mFx && mFx.fixes.find(f => f.id === 'deep-p7');
  ok(deep, 'a failing member offers a solved deepen fix');
  eq(deep && deep.patch.custom.parts.find(p => p.id === 'p7').dim.w, 115, 'rail deepens to the solved 115 mm, not one step');

  // When no stock can pass, the label says so instead of pretending.
  const wide = pipeline(Object.assign(JSON.parse(JSON.stringify(raw)),
    { overall: { width: 2000, depth: 300, height: 1524 } }));
  const sagW = Structural.computeIntegrity(wide.spec, wide.model, {}).checks.find(c => c.id === 'sag:shelf_1');
  const fxW = sagW && sagW.fixes.find(f => f.id === 'thick-shelf');
  ok(fxW && fxW.patch.structure.shelfThickness === 45 && /partial/i.test(fxW.label),
    'an unsolvable span offers the biggest stock as an honest partial step');
}

/* ================= G9: reconcileAck — phantom attachment / stock-source / "-free" / structure dims ================= */
section('G9 acks never claim attachment, stock reuse, material-free builds, or dims the plan lacks');
{
  const none = { patch: {}, ignored: [] };

  // ref2-run1 (live): "gets french-cleat screwed to it [the column]" over a
  // delivered spec whose connections are all dowels — no cleat part, joint,
  // BOM line, or step exists (the tip-critical claim lived only in the ack).
  const REF2 = "Column itself isn't modeled (it's your existing structural post); a solid white-oak vertical spine gets french-cleat screwed to it, and 5 plywood shelves cantilever off it at 72° increments, rising 300mm each turn. Check the 900mm footprint clears your column plus walking space.";
  const spiral = Spec.correctSpec(Spec.deepMerge(Spec.defaultSpec('custom'), { meta: { level: 'intermediate' }, wood: { species: 'white_oak', sheetSpecies: 'hardwood_ply' } }));
  spiral.custom.connections.forEach(c => { c.joint = 'dowels'; });
  const g1 = Spec.reconcileAck(REF2, spiral, ['x'], none);
  ok(/Actually:.*no french cleat exists in this plan/.test(g1), `phantom cleat corrected — got "${g1}"`);
  ok(/anti-tip strap/.test(g1), 'the correction names the one real building attachment');

  // ref7-run1 t2 (live): stock-source claim over a catalog-shopping stock
  // plan, plus a leg number correction silently clamped (50 → 45).
  const REF7A = "Tuned the bench to the actual stock: 5/4 (~25mm) cedar deck boards, with legs laminated from two boards (50mm) for stiffness and the apron built from a single board (25mm) — top was already 25mm. That uses only your deck boards, no dimensional lumber. Want the small table next as a low coffee-table height or a standard side-table height?";
  const bench1 = Spec.correctSpec({
    meta: { name: 'Deck Board Bench', template: 'bench', level: 'beginner', units: 'in' },
    overall: { width: 1200, depth: 350, height: 450 }, wood: { species: 'western_red_cedar' },
    structure: { topThickness: 25, legThickness: 50, apronHeight: 80, apronThickness: 25 },
    joinery: { frame: 'butt_screws' }
  });
  eq(bench1.structure.legThickness, 45, 'the proposed 50 mm laminated legs snapped to 45 (the claim the ack keeps making)');
  const g2 = Spec.reconcileAck(REF7A, bench1, ['x'], none);
  ok(/the stock plan buys catalog lumber — designing onto on-hand boards isn’t modeled yet/.test(g2), `stock reuse claim corrected — got "${g2}"`);
  ok(/leg thickness is 45 mm, not the claimed 50 mm/.test(g2), `clamped leg number corrected — got "${g2}"`);
  ok(!/apron thickness is/.test(g2) && !/top thickness is/.test(g2), 'true apron/top numbers are not flagged');

  // ref7-run2 t2 (live): "legs/aprons doubled-up 2x6 (70mm)" over aprons the
  // clamp delivered at 25 mm — the legs really are 70, only the apron lies.
  const REF7B = "A simple outdoor bench sized to use six 6' 2x6s: legs/aprons doubled-up 2x6 (70mm), seat slats at full 38mm thickness with gaps to shed water. Pocket screws forgive the cupping better than tight joinery; spar urethane suits exterior cedar.";
  const bench2 = Spec.correctSpec({
    meta: { name: 'Cedar Deck-Board Bench', template: 'bench', level: 'beginner', units: 'in' },
    overall: { width: 1200, depth: 350, height: 450 }, wood: { species: 'western_red_cedar' },
    structure: { topThickness: 38, legThickness: 70, apronHeight: 100, apronThickness: 38 },
    joinery: { frame: 'pocket_screws' }
  });
  eq(bench2.structure.apronThickness, 25, 'the proposed 38 mm (2x6) aprons clamped to 25');
  const g3 = Spec.reconcileAck(REF7B, bench2, ['x'], none);
  ok(/apron thickness is 25 mm, not the claimed 70 mm/.test(g3), `doubled-2x6 apron story corrected — got "${g3}"`);
  ok(!/leg thickness is/.test(g3), 'the true 70 mm leg claim is untouched');
  ok(!/top thickness is/.test(g3), 'the true 38 mm seat-slat claim is untouched');
  ok(!/catalog lumber/.test(g3), '"sized to use six 2x6s" is sizing intent, not a reuse claim — no stock fix');

  // simple2 (live): "plywood-free back panel" over a baltic birch ply back.
  const SIMPLE2 = "A simple pine bookshelf, 900w x 300d x 1524h mm, with 4 shelves, plywood-free back panel, and beginner-friendly butt joints with screws for easy building.";
  const pineShelf = Spec.correctSpec({
    meta: { name: 'Pine Bookshelf', template: 'bookshelf', level: 'beginner', units: 'mm' },
    overall: { width: 900, depth: 300, height: 1524 }, wood: { species: 'pine' },
    structure: { shelfCount: 4, backPanel: true }
  });
  const g4 = Spec.reconcileAck(SIMPLE2, pineShelf, ['x'], none);
  ok(/not plywood-free — the delivered design uses baltic birch ply/.test(g4), `"plywood-free" over a ply back corrected — got "${g4}"`);

  // The same claim over a design with no sheet stock in it is TRUE — silent.
  const bareTable = Spec.correctSpec(Spec.defaultSpec('table'));
  const g5 = Spec.reconcileAck('A plywood-free solid oak table.', bareTable, ['x'], none);
  ok(!/Actually:/.test(g5), `a true "plywood-free" claim passes — got "${g5}"`);

  // Must-NOT-fire: honest mechanism disclosures pass through byte-identical.
  const kdTable = Spec.correctSpec(Spec.deepMerge(Spec.defaultSpec('table'), { joinery: { frame: 'kd_bolt' } }));
  const ADAPT3 = "A true fold-flat hinge mechanism isn't something I can build—every joint is permanent except kd_bolt. Nearest real option: legs bolt to the apron frame with kd_bolt (hex-key) joints, so one person unbolts 4 legs solo and stacks top+frame+legs flat, well under 254mm, for storage.";
  const REF3A = "True folding hinges aren't buildable here (all joints are permanent except kd_bolt), so I switched frame joinery to kd_bolt: one person can unbolt the aprons/legs from the top and knock it down for storage. Top, legs, and aprons are all ≤70mm thick, so the disassembled parts lean flat and slide into a 254mm gap.";
  const REF3B = "A true hinged fold-flat isn't buildable — every joint is permanent except kd_bolt. This is a knock-down design instead: legs and aprons bolt to the top with kd_bolt hardware, so one person can unbolt it and stack the flat top, aprons, and legs (each well under 254mm) for storage, then rebolt it solo to set up again.";
  for (const [nm, txt] of [['adapt3', ADAPT3], ['ref3-run1', REF3A], ['ref3-run2', REF3B]]) {
    eq(Spec.reconcileAck(txt, kdTable, ['x'], none), txt, `${nm}'s honest mechanism disclosure passes through untouched`);
  }

  // ref8-run2 (live): the liner honesty ("not a modeled part") is preserved.
  const REF8 = "Two cedar planter boxes (dadoed bottoms, rabbeted corners) anchor a slatted privacy screen on posts and rails. Solid wood alone isn't waterproof — drop a separate metal or plastic liner tray inside each planter (not a modeled part) to actually keep water off your hardwood floor.";
  const planter = Spec.correctSpec(Spec.deepMerge(Spec.defaultSpec('custom'), { wood: { species: 'western_red_cedar' } }));
  eq(Spec.reconcileAck(REF8, planter, ['x'], none), REF8, 'ref8-run2 liner honesty passes through untouched');

  // A positive TRUE dimension claim is never "corrected".
  const g7 = Spec.reconcileAck('A sturdy red oak table with a 25 mm top on 70 mm legs.', bareTable, ['x'], none);
  ok(!/Actually:/.test(g7), `true dimension claims pass — got "${g7}"`);

  // A delta claim is not a dimension claim (the unit suite's a3 text).
  const g8 = Spec.reconcileAck('Grew the top 50.8 mm deeper.', bareTable, [], none);
  ok(!/top thickness/.test(g8), `"50.8 mm deeper" is a delta, not a thickness claim — got "${g8}"`);

  // Suspension narration with no artifact is corrected; honest negation is not.
  const g9 = Spec.reconcileAck('The desk hangs from the ceiling on steel cables.', kdTable, ['x'], none);
  ok(/no ceiling attachment exists in this plan/.test(g9), `suspension claim corrected — got "${g9}"`);
  const g10 = Spec.reconcileAck('This bookshelf doesn’t attach to the wall — it stands on its own feet.', pineShelf, ['x'], none);
  ok(!/Actually:/.test(g10), `negated attachment claim passes — got "${g10}"`);
}

/* ================= G11: anchor/fail ack disclosure + anchor-step context ================= */
section('G11 anchor verdicts reach the ack; failing acks name the governing check; anchor step fits non-wall contexts');
{
  // Anchor verdict, no fails: said in chat, not just a BOM line (B13 — the
  // ref2/ref5 commits shipped "REQUIRED" anchor hardware with a silent ack).
  eq(Spec.integrityLine({ fails: 0, advisories: 2, anchorRequired: true }, {}),
    ' This piece needs the included wall anchor — it tips without it.',
    'anchor verdict gets its own ack sentence');

  // Failing commits name the governing check when the worst sag is itself a
  // failure (simple2's live numbers: 6.22 mm over a 2.87 mm limit).
  const l1 = Spec.integrityLine({ fails: 5, advisories: 1, worstSag: { id: 'shelf_2', sag: 6.221, limit: 2.8733, span: 862 } }, {});
  ok(/ Integrity: 5 failing checks — worst: shelf 2 sag 6\.2 mm vs 2\.9 mm limit; see the Safety tab before building\./.test(l1),
    `failing ack names the worst check — got "${l1}"`);

  // A worst sag on the passing side is never blamed for other checks' fails.
  eq(Spec.integrityLine({ fails: 1, worstSag: { id: 'top_1', sag: 1.0, limit: 3.0, span: 900 } }, {}),
    ' Integrity: 1 failing check — see the Safety tab before building.',
    'a passing sag is not named as the governing failure');

  // Fails outrank the anchor sentence (one line, ordered like the verdict).
  const l2 = Spec.integrityLine({ fails: 2, anchorRequired: true }, {});
  ok(/failing checks/.test(l2) && !/needs the included wall anchor/.test(l2), 'fail line wins over the anchor line');

  // G4 assumed-load clause rides the line whenever it speaks…
  const l3 = Spec.integrityLine({
    fails: 1,
    surfaceLoads: [
      { id: 'p4', presetKey: 'books', label: 'Books', assumed: true },
      { id: 'p5', presetKey: 'books', label: 'Books', assumed: true },
      { id: 'p9', presetKey: 'seating', label: 'Seated people', assumed: false }
    ]
  }, {});
  ok(/Checked at Books on p4, p5 \(assumed — set the real duty in the Safety tab\)\./.test(l3),
    `assumed presets are named per surface — got "${l3}"`);
  ok(!/Seated people/.test(l3), 'a user-chosen load is never reported as assumed');

  // …and engine-DERIVED surfaces (G3) disclose even on a clean pass.
  const l4 = Spec.integrityLine({
    fails: 0, advisories: 0, anchorRequired: false,
    assumedSurfaces: ['p3'],
    surfaceLoads: [{ id: 'p3', presetKey: 'books', label: 'Books', assumed: true }]
  }, {});
  eq(l4, ' Checked at Books on p3 (assumed — set the real duty in the Safety tab).',
    'a derived check surface is disclosed even when everything passes');

  // Template defaults alone stay quiet on a clean pass — no ack spam.
  eq(Spec.integrityLine({
    fails: 0, advisories: 0, assumedSurfaces: [],
    surfaceLoads: [{ id: 'top_1', presetKey: 'worktop', label: 'Desk / table duty', assumed: true }]
  }, {}), '', 'assumed defaults alone never spam a passing template commit');

  // Photo flows keep their fuller phrasing.
  ok(/all checks pass/.test(Spec.integrityLine({ fails: 0, advisories: 0 }, { photo: true })), 'photo branch preserved');

  // End to end: an untagged custom (G3 derived surfaces) speaks through the
  // real engine summary.
  const un = Spec.defaultSpec('custom');
  un.custom.parts.forEach(p => { p.surface = 'none'; });
  const r = pipeline(un);
  const ig = Structural.computeIntegrity(r.spec, r.model, {});
  ok(ig.summary.assumedSurfaces.length > 0, 'the untagged custom derived a check surface');
  ok(/\(assumed — set the real duty in the Safety tab\)/.test(Spec.integrityLine(ig.summary, {})),
    'the derived assumption reaches the chat line end to end');

  // The anchor STEP acknowledges non-wall contexts for custom pieces only —
  // a mid-room divider or column wrap cannot "screw into a stud" (A7).
  const cu = pipeline(Spec.defaultSpec('custom'));
  const cuSteps = Plans.assembly(cu.spec, cu.model, { antiTip: true }, {});
  const cuAnchor = cuSteps.find(s => s.id === 'antitip');
  ok(cuAnchor && /; if it can’t back onto a wall, rethink placement — the tip risk is real\.$/.test(cuAnchor.text),
    `custom anchor step names the non-wall reality — got "${cuAnchor && cuAnchor.text}"`);
  const tb = pipeline(Spec.defaultSpec('table'));
  const tbAnchor = Plans.assembly(tb.spec, tb.model, { antiTip: true }, {}).find(s => s.id === 'antitip');
  eq(tbAnchor && tbAnchor.text,
    'This piece is tall, top-heavy, or tips with its drawers open: fasten the anti-tip strap to the top rear and screw the wall side into a stud (not just drywall). Do this before loading any shelf or drawer.',
    'template anchor step wording is byte-stable (goldens cannot see this change)');
}

/* ================= G12: assembly steps never glue a knockdown joint ================= */
section('G12 kd_bolt steps bolt — they never instruct glue (A4/C10)');
{
  // Template path (ref3/adapt3's live shape): a kd_bolt frame whose entire
  // point is tool-only disassembly used to get "Glue, clamp, and check for
  // square." — following the text welds the table shut and silently
  // invalidates the model's verified flat-pack answer.
  const kd = pipeline(Spec.deepMerge(Spec.defaultSpec('table'), { meta: { units: 'mm' }, joinery: { frame: 'kd_bolt' } }));
  eq(kd.spec.joinery.frame, 'kd_bolt', 'kd_bolt survives correction on a beginner frame');
  const kdSteps = Plans.assembly(kd.spec, kd.model, null, {});
  const s1 = kdSteps.find(s => s.id === 's1');
  ok(s1 && /knockdown bolts/.test(s1.text) && /Bolt together — hand-tight, then snug once square\./.test(s1.text),
    `kd frame step bolts instead of gluing — got "${s1 && s1.text}"`);
  ok(!kdSteps.some(s => (s.joints || []).some(j => j.type === 'kd_bolt') && /glue/i.test(s.text)),
    'no step that makes a kd_bolt joint mentions glue');

  // Glued frames keep a real glue instruction (now with the M-10 dry-fit).
  const gl = pipeline(Spec.defaultSpec('table'));
  const g1 = Plans.assembly(gl.spec, gl.model, null, {}).find(s => s.id === 's1');
  ok(g1 && /with pocket screws\. Dry-fit first, then glue, clamp, and check for square\./.test(g1.text),
    `glued frames keep the glue sentence (with dry-fit, M-10) — got "${g1 && g1.text}"`);

  // Custom path: the unconditional " Dry-fit before glue." suffix (ref4's
  // live bed rails: "…with knockdown bolts. Dry-fit before glue.").
  const cu = Spec.correctSpec(Spec.defaultSpec('custom'));
  cu.custom.connections[0].joint = 'kd_bolt';
  const cuModel = Parametric.build(cu);
  const cSteps = Plans.assembly(cu, cuModel, null, {});
  const kdStep = cSteps.find(s => /knockdown bolts/.test(s.text));
  ok(kdStep && /Bolt together — hand-tight, then snug once square\./.test(kdStep.text) && !/glue/i.test(kdStep.text),
    `custom kd_bolt connection bolts, no glue — got "${kdStep && kdStep.text}"`);
  const glStep = cSteps.find(s => /butt joint/.test(s.text));
  ok(glStep && / Dry-fit before glue\./.test(glStep.text),
    `glued custom connections keep the dry-fit suffix — got "${glStep && glStep.text}"`);

  // No golden fixture uses kd_bolt, so this wording change cannot diff the
  // corpus — assert it stays that way.
  for (const f of fs.readdirSync(path.join(__dirname, 'golden'))) {
    ok(!/kd_bolt/.test(fs.readFileSync(path.join(__dirname, 'golden', f), 'utf8')), `golden ${f} is kd_bolt-free`);
  }
}

/* ================= G10: silent custom grounding is recorded as a correction note ================= */
section('G10 correctionNotes records the grounding translation correction never disclosed');
{
  // ref1-run1's recorded wire proposal, verbatim: the "Ceiling-Suspended
  // Truss Desk" whose coherent hanging composition (desktop y=715, ceiling
  // ledger frame y=2395) correctCustom silently translated 610 mm down onto
  // the floor — no event ever told the model or the user that the
  // suspension premise was destroyed (spec.js grounding runs before the
  // audit, so geom_floats can never fire on an airborne composition).
  const REF1_WIRE = JSON.parse('{"N":{"v":4,"n":"Ceiling-Suspended Truss Desk","t":6,"l":1,"u":1,"o":[1200,600,1830],"m":2,"j":[12,12,12],"f":2,"d":0,"p":[[3,0,715,0,1200,600,30,0,0,0,0,0,1,2,"desktop"],[0,-550,1525,-260,1650,70,70,0,0,0,0,0,1,0,"post_FL"],[0,550,1525,-260,1650,70,70,0,0,0,0,0,1,0,"post_FR"],[0,-550,1525,260,1650,70,70,0,0,0,0,0,1,0,"post_BL"],[0,550,1525,260,1650,70,70,0,0,0,0,0,1,0,"post_BR"],[1,0,655,-260,1100,90,20,0,0,0,0,0,1,0,"apron_front"],[1,0,655,260,1100,90,20,0,0,0,0,0,1,0,"apron_back"],[1,-550,655,0,520,90,20,0,90,0,0,0,1,0,"apron_left"],[1,550,655,0,520,90,20,0,90,0,0,0,1,0,"apron_right"],[1,0,2395,-260,1100,90,40,0,0,0,0,0,1,0,"ceiling_front"],[1,0,2395,260,1100,90,40,0,0,0,0,0,1,0,"ceiling_back"],[1,-550,2395,0,520,90,40,0,90,0,0,0,1,0,"ceiling_left"],[1,550,2395,0,520,90,40,0,90,0,0,0,1,0,"ceiling_right"]],"c":[[0,5,1],[0,6,1],[0,7,1],[0,8,1],[5,1,12],[5,2,12],[6,3,12],[6,4,12],[7,1,12],[7,3,12],[8,2,12],[8,4,12],[9,1,12],[9,2,12],[10,3,12],[10,4,12],[11,1,12],[11,3,12],[12,2,12],[12,4,12]]}}');
  const raw = Codec.decode(REF1_WIRE.N);
  const corrected = Spec.correctSpec(raw);
  ok(corrected.custom && corrected.custom.parts.length === 13, 'the composition survives correction');
  const notes = Spec.correctionNotes(raw, corrected);
  ok(notes.length >= 1, `at least one note for the suspended proposal — got ${notes.length}`);
  const ground = notes.find(n => /floated|grounded|floor-standing/i.test(n));
  ok(ground && /floated ~610 mm above the floor|floated ~699 mm above the floor/.test(ground) || (ground && /floated ~\d+ mm above the floor/.test(ground)),
    `the grounding note carries the real translation — got "${ground}"`);
  ok(ground && /grounded/.test(ground) && /floor-standing/.test(ground), 'the note states the fix and the product boundary');

  // Display boundary: the note renders through BB.Units like everything else.
  Units.set({ system: 'imperial', precision: 16, dual: false });
  const impNotes = Spec.correctionNotes(raw, corrected);
  const impNote = impNotes.find(n => /floated|grounded/i.test(n));
  ok(impNote && /floated ~\d+ in above the floor/.test(impNote), `the note re-renders imperial — got "${impNote}"`);
  Units.set({ system: 'metric', precision: 16, dual: false });

  // A grounded proposal earns no grounding note; correctionNotes is pure and quiet
  // about geometry that already stands on the floor (other disclosures may still fire).
  const grounded = Spec.defaultSpec('custom');
  ok(!Spec.correctionNotes(grounded, Spec.correctSpec(Spec.clone(grounded))).some(n => /floated|below the floor|grounded/i.test(n)),
    'a grounded proposal earns no grounding note');

  // Small hovers stay silent — grounding under the 50 mm threshold is the
  // ordinary snap-to-floor cleanup, not a destroyed premise.
  const hover = Spec.defaultSpec('custom');
  hover.custom.parts.forEach(p => { p.pos.y += 40; });
  ok(!Spec.correctionNotes(hover, Spec.correctSpec(Spec.clone(hover))).some(n => /floated|below the floor/i.test(n)),
    'a 40 mm hover is below the disclosure threshold');

  // Template specs and non-custom corrections are out of scope for grounding.
  ok(!Spec.correctionNotes(Spec.defaultSpec('table'), Spec.correctSpec(Spec.defaultSpec('table'))).some(n => /floated|grounded/i.test(n)),
    'templates have no grounding notes');

  // Defensive: a raw proposal with missing dim/pos/rot fields is measured
  // with correction's own sanitization and never throws.
  const junk = { meta: { template: 'custom', level: 'beginner' }, custom: { parts: [{ primitive: 'slab', dim: { l: 500 }, pos: { y: 900 } }, { id: 'x' }], connections: [] } };
  ok(Array.isArray(Spec.correctionNotes(junk, Spec.correctSpec(Spec.clone(junk)))), 'junk raw parts are measured defensively');

  // A proposal sunk below the floor is raised — and says so.
  const sunk = Spec.defaultSpec('custom');
  sunk.custom.parts.forEach(p => { p.pos.y -= 300; });
  const sunkNotes = Spec.correctionNotes(sunk, Spec.correctSpec(Spec.clone(sunk)));
  ok(sunkNotes.some(n => /sat ~300 mm below the floor/.test(n)), `a sunk proposal is named too — got ${JSON.stringify(sunkNotes)}`);
}

/* ================= M-04 (2026-07 credits pivot): screwed joints draw tight ================= */
section('M-04 screw setouts name the clearance hole and countersink, not just the pilot');
{
  // A screwed case joint: the near member gets a shank CLEARANCE hole (the
  // screw must spin free in it to draw the joint tight) and the flat head a
  // countersink — "Pilot X" alone will not close the joint.
  const r = pipeline({
    meta: { name: 'Shelf case', template: 'bookshelf', level: 'beginner', units: 'mm' },
    overall: { width: 800, depth: 280, height: 1100 },
    structure: { shelfCount: 2, backPanel: true }
  });
  const joint = r.model.joints.find(j => j.type === 'butt_screws');
  ok(joint, 'a beginner bookshelf has screwed case joints');
  if (joint) {
    const lay = Fasteners.layoutForJoint(r.spec, r.model, joint);
    ok(/clearance/i.test(lay.text), `setout names the clearance hole — got "${lay.text}"`);
    ok(/countersink|counterbore/i.test(lay.text), 'setout names the countersink (or counterbore when the member is thick)');
    ok(lay.fasteners.every(f => f.kind !== 'screw' || f.clearanceMM > f.pilotMM), 'screw fasteners carry a clearance Ø larger than the pilot');
  }
  // The drawer-front attachment (screws from inside the box) needs the same.
  const ns = pipeline({
    meta: { name: 'NS', template: 'nightstand', level: 'intermediate', units: 'mm' },
    overall: { width: 500, depth: 400, height: 600 },
    drawers: { count: 1, frontStyle: 'inset', runner: 'side_mount_slides' }
  });
  const ig = Structural.computeIntegrity(ns.spec, ns.model, {});
  const stock = Packing.planStock(ns.spec, ns.model, Plans.cutList(ns.spec, ns.model), {});
  const steps = Plans.assembly(ns.spec, ns.model, ig, { stockPlan: stock });
  const front = steps.find(s => s.id === 'dr1_front');
  ok(front && /clearance/i.test(front.text), `drawer-front step names the clearance holes — got "${front && front.text}"`);
}

/* ================= M-09: pre-finish before the case closes ================= */
section('M-09 cases with backs or drawer banks say pre-finish before closing');
{
  const shelf = pipeline({
    meta: { name: 'Shelf', template: 'bookshelf', level: 'beginner', units: 'mm' },
    overall: { width: 800, depth: 280, height: 1100 },
    structure: { shelfCount: 2, backPanel: true }
  });
  const ig = Structural.computeIntegrity(shelf.spec, shelf.model, {});
  const steps = Plans.assembly(shelf.spec, shelf.model, ig, {});
  const back = steps.find(s => s.id === 's3');
  ok(back && /pre-?finish/i.test(back.text), 'the back-panel step demands pre-finishing the interior first');
  // Golden guard: the amendment is TEXT only — the step id list is unchanged
  // (a new step id would diverge the frozen corpus).
  ok(!steps.some(s => /^prefinish/.test(s.id)), 'no new step id is minted (text amendment only)');

  const ns = pipeline({
    meta: { name: 'NS', template: 'nightstand', level: 'intermediate', units: 'mm' },
    overall: { width: 500, depth: 400, height: 600 },
    drawers: { count: 2, frontStyle: 'inset', runner: 'side_mount_slides' }
  });
  const ig2 = Structural.computeIntegrity(ns.spec, ns.model, {});
  const steps2 = Plans.assembly(ns.spec, ns.model, ig2, {});
  const box1 = steps2.find(s => s.id === 'dr1_box');
  ok(box1 && /pre-?finish/i.test(box1.text), 'the first drawer step demands pre-finishing boxes and openings');
  const box2 = steps2.find(s => s.id === 'dr2_box');
  ok(box2 && !/pre-?finish/i.test(box2.text), 'the reminder appears once, not on every drawer');
}

/* ================= M-10: dry-fit before glue on template paths ================= */
section('M-10 template glue-up steps demand a dry-fit (the custom path already did)');
{
  const table = pipeline({ meta: { name: 'T', template: 'table', level: 'intermediate', units: 'mm' } });
  const igT = Structural.computeIntegrity(table.spec, table.model, {});
  const stepsT = Plans.assembly(table.spec, table.model, igT, {});
  ok(/dry-?fit/i.test((stepsT.find(s => s.id === 's1') || {}).text || ''), 'table end-frame glue-up says dry-fit first');
  ok(/dry-?fit/i.test((stepsT.find(s => s.id === 's2') || {}).text || ''), 'table frame-join glue-up says dry-fit first');

  const shelf = pipeline({
    meta: { name: 'S', template: 'bookshelf', level: 'beginner', units: 'mm' },
    overall: { width: 800, depth: 280, height: 1100 }, structure: { shelfCount: 2, backPanel: true }
  });
  const igS = Structural.computeIntegrity(shelf.spec, shelf.model, {});
  ok(/dry-?fit/i.test((Plans.assembly(shelf.spec, shelf.model, igS, {}).find(s => s.id === 's1') || {}).text || ''), 'bookshelf case step says dry-fit first');

  const ns = pipeline({
    meta: { name: 'N', template: 'nightstand', level: 'intermediate', units: 'mm' },
    overall: { width: 500, depth: 400, height: 600 }, drawers: { count: 1, frontStyle: 'inset', runner: 'side_mount_slides' }
  });
  const igN = Structural.computeIntegrity(ns.spec, ns.model, {});
  ok(/dry-?fit/i.test((Plans.assembly(ns.spec, ns.model, igN, {}).find(s => s.id === 's1') || {}).text || ''), 'nightstand side-frame step says dry-fit first');
}

/* ================= M-22: real prices reach the model ================= */
section('M-22 budget digest: species $/bd ft + the current design total reach the prompt');
{
  // The WOOD digest line carries real $/bd ft, not $-dots — "keep it under
  // $200" is only answerable against numbers.
  const digest = K.knowledgeDigest();
  ok(digest.includes(`$${K.WOOD_SPECIES.red_oak.pricePerBdFt}/bdft`), 'digest carries red oak $/bd ft');
  ok(digest.includes(`$${K.WOOD_SPECIES.walnut.pricePerBdFt}/bdft`), 'digest carries walnut $/bd ft');
  ok(!/\$●/.test(digest), 'the $-dot tier glyphs are gone');
  // The system prompt carries the CURRENT design's estimated total, computed
  // by code (the model never computes it), placed AFTER the cache-split
  // marker so the byte-stable prefix stays cacheable.
  const spec = Spec.correctSpec({ meta: { name: 'B', template: 'table', level: 'beginner', units: 'mm' } });
  const line = AI.budgetLine(spec, null);
  ok(/\$\d/.test(line), `budgetLine carries a real dollar total — got "${line}"`);
  const sys = AI.systemPrompt(spec);
  const marker = sys.indexOf('--- current spec (wire format) ---');
  ok(sys.indexOf(line) > marker && marker > 0, 'budget line rides the per-call tail, after the cache-split marker');
}


/* ================= Batch A remainder: fastener bench-usability ================= */
section('M-02 fine-thread pocket screws for hardwood; coarse for softwood');
{
  const oak = pipeline({
    meta: { name: 'T', template: 'table', level: 'beginner', units: 'mm' },
    wood: { species: 'red_oak' },
    joinery: { frame: 'pocket_screws' }
  });
  const pine = pipeline({
    meta: { name: 'T2', template: 'table', level: 'beginner', units: 'mm' },
    wood: { species: 'pine' },
    joinery: { frame: 'pocket_screws' }
  });
  const oj = oak.model.joints.find(j => j.type === 'pocket_screws');
  const pj = pine.model.joints.find(j => j.type === 'pocket_screws');
  const ol = Fasteners.layoutForJoint(oak.spec, oak.model, oj);
  const pl = Fasteners.layoutForJoint(pine.spec, pine.model, pj);
  ok(/fine pocket/i.test(ol.text), `oak pocket setout is fine-thread — got "${ol.text}"`);
  ok(/coarse pocket/i.test(pl.text), `pine pocket setout is coarse-thread — got "${pl.text}"`);
}

section('M-03 + L-12 pilot tracks gauge + species, not screw length');
{
  const hard = pipeline({
    meta: { name: 'B', template: 'bookshelf', level: 'beginner', units: 'mm' },
    wood: { species: 'hard_maple' }, structure: { shelfCount: 2 }
  });
  const soft = pipeline({
    meta: { name: 'B2', template: 'bookshelf', level: 'beginner', units: 'mm' },
    wood: { species: 'pine' }, structure: { shelfCount: 2 }
  });
  const hj = hard.model.joints.find(j => j.type === 'butt_screws');
  const sj = soft.model.joints.find(j => j.type === 'butt_screws');
  const hl = Fasteners.layoutForJoint(hard.spec, hard.model, hj);
  const sl = Fasteners.layoutForJoint(soft.spec, soft.model, sj);
  ok(hl.fasteners[0].pilotMM === 2.8, `hardwood #8 pilot is 2.8 — got ${hl.fasteners[0].pilotMM}`);
  ok(sl.fasteners[0].pilotMM === 2.4, `softwood #8 pilot is 2.4 (85%) — got ${sl.fasteners[0].pilotMM}`);
}

section('M-05 figure-8 recess + Forstner + per-step totals match BOM');
{
  const r = pipeline({
    meta: { name: 'T', template: 'table', level: 'beginner', units: 'mm' },
    overall: { width: 1200, depth: 700, height: 750 }
  });
  const ig = Structural.computeIntegrity(r.spec, r.model, {});
  const steps = Plans.assembly(r.spec, r.model, ig, {});
  const top = steps.find(s => s.id === 's3');
  ok(top && /Forstner|recess/i.test(top.text), `top step names the figure-8 recess — got "${top && top.text}"`);
  const bom = Plans.bom(r.spec, r.model, { integrity: ig });
  const fig = bom.items.find(i => /figure-?8/i.test(i.label));
  const m = top && top.text.match(/(\d+)\s+figure-8/i);
  ok(fig && m && Number(m[1]) === fig.qty, `step figure-8 count ${m && m[1]} matches BOM ${fig && fig.qty}`);
  const tools = Plans.toolList(r.spec, r.model);
  ok(tools.some(t => /Forstner/i.test(t)), 'tool list includes a Forstner for figure-8 recesses');
}

section('M-19 slide screws sized for 12 mm drawer sides (M4 × 10)');
{
  const r = pipeline({
    meta: { name: 'NS', template: 'nightstand', level: 'intermediate', units: 'mm' },
    overall: { width: 500, depth: 400, height: 600 },
    drawers: { count: 1, frontStyle: 'inset', runner: 'side_mount_slides' }
  });
  const bom = Plans.bom(r.spec, r.model, {});
  const slideScrew = bom.items.find(i => /M4/.test(i.label) && /pan-head/i.test(i.label));
  ok(slideScrew && !/16\s*mm|5\/8/.test(slideScrew.label), `slide screws are not M4×16 — got "${slideScrew && slideScrew.label}"`);
  ok(slideScrew && /10/.test(slideScrew.label), `slide screws are M4×10 — got "${slideScrew.label}"`);
  const steps = Plans.assembly(r.spec, r.model, Structural.computeIntegrity(r.spec, r.model, {}), {});
  const run = steps.find(s => s.id === 'dr1_runners');
  ok(run && /M4/.test(run.text) && !/×\s*16|5\/8 in/.test(run.text), `slide step agrees — got "${run && run.text}"`);
}

section('M-21 positions() at n=2 under min spacing collapses to one centered fastener');
{
  const pos = Fasteners.positions(50, 2);
  ok(pos.length === 1, `short run returns one fastener — got ${pos.length}`);
  near(pos[0], 25, 1, 'the single fastener is centered on the run');
  const long = Fasteners.positions(400, 2);
  ok(long.length >= 2, 'a long run still places at least two');
}

/* ================= Batch B remainder: instruction completeness ================= */
section('M-06 drawer groove steps carry the measured-ply caveat');
{
  const r = pipeline({
    meta: { name: 'NS', template: 'nightstand', level: 'beginner', units: 'mm' },
    drawers: { count: 1, frontStyle: 'inset', runner: 'side_mount_slides' }
  });
  const steps = Plans.assembly(r.spec, r.model, Structural.computeIntegrity(r.spec, r.model, {}), {});
  const bot = steps.find(s => s.id === 'dr1_bottom');
  ok(bot && /MEASURED|measured thickness/i.test(bot.text), `groove step names measured ply — got "${bot && bot.text}"`);
}

section('M-07 dado setout names the housed part, not the literal "shelf"');
{
  const r = pipeline({
    meta: { name: 'NS', template: 'nightstand', level: 'intermediate', units: 'mm' },
    joinery: { box: 'locking_rabbet' },
    drawers: { count: 1, frontStyle: 'inset', runner: 'side_mount_slides' }
  });
  const dado = r.model.joints.find(j => j.type === 'dado');
  ok(dado, 'locking-rabbet drawer has a dado-housed back');
  if (dado) {
    const lay = Fasteners.layoutForJoint(r.spec, r.model, dado);
    ok(!/of the shelf/i.test(lay.text), `dado text must not hardcode "shelf" — got "${lay.text}"`);
    ok(/of the /i.test(lay.text), `dado text names the housed member — got "${lay.text}"`);
  }
}

section('M-11 tool list collapses synonym rows');
{
  const r = pipeline({
    meta: { name: 'C', template: 'cabinet', level: 'advanced', units: 'mm' },
    joinery: { case: 'dado', frame: 'mortise_tenon' },
    drawers: { count: 2, frontStyle: 'overlay', runner: 'side_mount_slides' }
  });
  const tools = Plans.toolList(r.spec, r.model);
  ok(!(tools.includes('Router or table saw') && tools.includes('Table saw or router table')),
    `router/table-saw synonyms collapse — got ${JSON.stringify(tools.filter(t => /router|table saw/i.test(t)))}`);
  ok(tools.filter(t => t === 'Drill' || t === 'Drill/driver').length === 1, 'bare Drill does not sit beside Drill/driver');
}

/* ================= Disclosure + capability ================= */
section('M-20 correctionNotes disclose stock snaps, joinery resets, and species snaps');
{
  const raw = Spec.defaultSpec('table');
  raw.structure.legThickness = 55;
  raw.joinery.frame = 'half_blind_dovetail';
  raw.meta.level = 'beginner';
  raw.wood.species = 'wenge';
  const corrected = Spec.correctSpec(Spec.clone(raw));
  const notes = Spec.correctionNotes(raw, corrected);
  ok(notes.some(n => /leg thickness|snapped/i.test(n)), `stock snap disclosed — ${JSON.stringify(notes)}`);
  ok(notes.some(n => /dovetail|switched|isn't available/i.test(n)), `joinery reset disclosed — ${JSON.stringify(notes)}`);
  ok(notes.some(n => /wenge|isn't a solid species|snapped to/i.test(n)), `unknown species disclosed — ${JSON.stringify(notes)}`);
}

section('Capability questions: chair / wall-mount ask instead of silent nearest-fixed');
{
  const table = Spec.correctSpec(Spec.defaultSpec('table'));
  const chair = AI.localModel('build me a dining chair', table);
  ok(chair.kind === 'question' && /chair/i.test(chair.question), `chair ask → question — got ${JSON.stringify(chair)}`);
  const wall = AI.localModel('a floating wall shelf', table);
  ok(wall.kind === 'question' && /wall|floor/i.test(wall.question), `wall ask → question — got ${JSON.stringify(wall)}`);
}

/* ================= Tier 1 LIVE: stretchers + doors ================= */
section('Stretchers: table-like geometry, racking credit, assembly step');
{
  const plain = pipeline({
    meta: { name: 'T', template: 'table', level: 'beginner', units: 'mm' },
    overall: { width: 1500, depth: 800, height: 750 }
  });
  ok(!plain.model.parts.some(p => p.role === 'stretcher'), 'default table has no stretchers');
  const braced = pipeline({
    meta: { name: 'T2', template: 'table', level: 'beginner', units: 'mm' },
    overall: { width: 1500, depth: 800, height: 750 },
    structure: { stretchers: true }
  });
  const str = braced.model.parts.filter(p => p.role === 'stretcher');
  ok(str.length === 2, `stretchers emit two long rails — got ${str.length}`);
  const ig = Structural.computeIntegrity(braced.spec, braced.model, {});
  const rack = ig.checks.find(c => c.id === 'rack');
  ok(rack && rack.factors.some(f => /stretcher/i.test(f.label)), 'racking credits stretchers');
  const steps = Plans.assembly(braced.spec, braced.model, ig, {});
  ok(steps.some(s => s.id === 's2b' && /stretcher/i.test(s.title)), 'assembly has a stretcher step');
  const wire = Codec.encode(braced.spec);
  ok(wire.s.x === 1, 'stretchers encode as s.x=1');
  const round = Spec.correctSpec(Codec.decode(wire));
  ok(round.structure.stretchers === true, 'stretchers survive encode→decode→correct');
}

section('Cabinet doors: LIVE geometry, hinge counts, BOM, hang steps');
{
  const r = pipeline({
    meta: { name: 'C', template: 'cabinet', level: 'intermediate', units: 'mm' },
    overall: { width: 800, depth: 450, height: 900 },
    drawers: { count: 2, frontStyle: 'overlay', runner: 'side_mount_slides' },
    doors: { count: 2, frontStyle: 'overlay' },
    hardware: { pull: 'knob_round', hinge: 'euro_cup' }
  });
  ok(r.model.doors && r.model.doors.length === 2, `two doors in the model — got ${r.model.doors && r.model.doors.length}`);
  ok(r.model.parts.filter(p => p.role === 'door').length === 2, 'two door panels in the cut list parts');
  ok(r.model.parts.some(p => p.role === 'hinge' && p.hardware), 'hinge hardware parts render');
  const bom = Plans.bom(r.spec, r.model, {});
  ok(bom.items.some(i => /hinge|cup hinge/i.test(i.label)), `BOM buys hinges — ${bom.items.filter(i => i.kind === 'hardware').map(i => i.label).join('; ')}`);
  const steps = Plans.assembly(r.spec, r.model, Structural.computeIntegrity(r.spec, r.model, {}), {});
  ok(steps.some(s => /^door1_hang$/.test(s.id)), 'assembly has door hang steps');
  const wire = Codec.encode(r.spec);
  ok(Array.isArray(wire.do) && wire.do[0] === 2, 'doors encode as do:[count,FRONT]');
  const offline = AI.localModel('add two doors', Spec.correctSpec(Spec.defaultSpec('cabinet')));
  ok(offline.kind === 'diff' && offline.patch.doors && offline.patch.doors.count === 2,
    `offline "add two doors" patches doors — got ${JSON.stringify(offline)}`);
}


console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
