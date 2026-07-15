/* Blueprint Buddy — audit-finding regression tests (2026 engineering audit).
 * One section per register finding (docs/audit/04-findings-register.md).
 * Written BEFORE the fixes (fix protocol: watch them fail, fix, watch pass).
 * Run: node test/audit.test.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRC = ['knowledge.js', 'geometry.js', 'units.js', 'spec.js', 'parametric.js', 'structural.js', 'fasteners.js',
  'packing.js', 'plans.js', 'exports.js', 'history.js', 'codec.js', 'ai.js', 'store.js', 'gallery.js', 'selftest.js'];
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
  ok(/Joinery detail/i.test(html), 'print sheet gains the joinery-detail section');
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

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
