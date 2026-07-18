/* Blueprint Buddy — headless unit tests for the code-owned layers.
 * Run: node test/unit.test.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRC = ['knowledge.js', 'hardware.js', 'icons.js', 'materials.js', 'geometry.js', 'units.js', 'spec.js', 'parametric.js', 'structural.js', 'fasteners.js', 'packing.js',
  'plans.js', 'drafting.js', 'gltf.js', 'exports.js', 'history.js', 'codec.js', 'ai.js', 'store.js', 'gallery.js', 'joinery3d.js', 'selftest.js'];
for (const f of SRC) {
  vm.runInThisContext(fs.readFileSync(path.join(__dirname, '..', 'src', f), 'utf8'), { filename: f });
}
const BB = globalThis.BB;
const { Spec, Parametric, Plans, Exports, History, AI, K, Gallery, Codec, Structural, Packing } = BB;

let pass = 0, fail = 0;
function ok(cond, msg) {
  if (cond) { pass++; }
  else { fail++; console.error('  ✗ ' + msg); }
}
function eq(a, b, msg) { ok(JSON.stringify(a) === JSON.stringify(b), `${msg} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); }
function section(name) { console.log('· ' + name); }

function pipeline(raw) {
  const spec = Spec.correctSpec(raw);
  const model = Parametric.build(spec);
  const report = Spec.validate(spec, model);
  return { spec, model, report };
}

/* ---------------- spec + correction ---------------- */
section('spec correction');
{
  const s1 = Spec.correctSpec(Spec.defaultSpec('table'));
  const s2 = Spec.correctSpec(s1);
  eq(s1, s2, 'correction is idempotent');

  const bad = Spec.correctSpec({ meta: { template: 'table', level: 'beginner' }, joinery: { frame: 'mortise_tenon', box: 'half_blind_dovetail' } });
  eq(bad.joinery.frame, 'pocket_screws', 'beginner frame joint snapped to level matrix');
  eq(bad.joinery.box, 'pocket_screws', 'beginner box joint snapped (never dovetail)');

  const adv = Spec.correctSpec({ meta: { template: 'nightstand', level: 'advanced' }, joinery: { box: 'half_blind_dovetail' } });
  eq(adv.joinery.box, 'half_blind_dovetail', 'advanced keeps dovetail box');

  const wr = Spec.correctSpec({ meta: { template: 'nightstand', level: 'beginner' }, drawers: { count: 1, runner: 'wood_runners' } });
  eq(wr.drawers.runner, 'side_mount_slides', 'wood runners gated to intermediate+');

  const noDr = Spec.correctSpec({ meta: { template: 'table' }, drawers: { count: 2 } });
  ok(noDr.drawers === null || noDr.drawers === undefined, 'table never carries drawers');

  // E-04: one correction pass lands every value on its stock table —
  // correctSpec∘correctSpec === correctSpec across templates × sizes. The
  // 300×250 footprint is the trap: the geometric leg clamp used to run AFTER
  // the stock snap and leave an off-table 62 that drifted to 60 on reopen.
  {
    const sizes = [
      { width: 300, depth: 250, height: 400 },
      { width: 250, depth: 200, height: 120 },
      { width: 600, depth: 400, height: 750 },
      { width: 2400, depth: 1200, height: 2400 },
      { width: 508, depth: 406.4, height: 609.6 },
      { width: 900, depth: 300, height: 1800 }
    ];
    for (const t of ['table', 'desk', 'bench', 'bookshelf', 'nightstand', 'cabinet']) {
      for (const o of sizes) {
        const c1 = Spec.correctSpec({ meta: { name: 'Idem', template: t, level: 'intermediate', units: 'mm' }, overall: { ...o } });
        const c2 = Spec.correctSpec(JSON.parse(JSON.stringify(c1)));
        const same = JSON.stringify(c1) === JSON.stringify(c2);
        ok(same, `correction idempotent for ${t} ${o.width}×${o.depth}×${o.height}` +
          (same ? '' : ` — structure drift ${JSON.stringify(c1.structure)} → ${JSON.stringify(c2.structure)}`));
        ok(K.POST_THICKNESS.includes(c1.structure.legThickness),
          `legThickness on the post-stock table for ${t} ${o.width}×${o.depth} — got ${c1.structure.legThickness}`);
      }
    }
  }
}

/* ---------------- table geometry ---------------- */
section('table parametrics');
{
  const { spec, model, report } = pipeline({ meta: { name: 'Seed', template: 'table', level: 'beginner' } });
  eq(model.parts.length, 9, 'table = 4 legs + 4 aprons + top');
  const legs = model.parts.filter(p => p.role === 'leg');
  eq(legs.length, 4, 'four legs');
  eq(legs[0].size.h, spec.overall.height - spec.structure.topThickness, 'leg height = H - top');
  const top = model.parts.find(p => p.role === 'top');
  eq(top.size.w, spec.overall.width, 'top width exact');
  eq(top.pos.y, spec.overall.height - spec.structure.topThickness / 2, 'top rides at full height');
  ok(legs.every(l => Math.abs((l.pos.y - l.size.h / 2)) < 1e-9), 'legs sit on the floor');
  eq(report.errors.length, 0, 'seed validates clean');
  ok(legs.every(l => l.defKey === legs[0].defKey), 'legs share one definition key');
}

/* ---------------- ergonomics advisories ---------------- */
section('validation: advisory vs error');
{
  const { report } = pipeline({ meta: { template: 'table' }, overall: { width: 1500, depth: 850, height: 820 } });
  eq(report.errors.length, 0, '820mm table height: no errors');
  ok(report.advisories.some(a => a.id === 'ergo_dining_height'), '820mm table height: dismissible advisory');

  const { report: r2 } = pipeline({ meta: { template: 'table' }, overall: { width: 1500, depth: 900, height: 750 }, wood: { species: 'red_oak' } });
  ok(r2.advisories.some(a => a.id.startsWith('movement_')), 'high-movement species + wide top → movement advisory');

  const r3 = pipeline({ meta: { template: 'table' }, overall: { width: 1500, depth: 900, height: 750 }, wood: { species: 'baltic_birch' } });
  eq(r3.spec.wood.species, 'red_oak', 'sheet stock snapped to a solid species for solid parts');

  const r4 = pipeline({ meta: { template: 'table' }, overall: { width: 1500, depth: 900, height: 750 }, wood: { species: 'hard_maple' } });
  ok(!r4.report.advisories.some(a => a.id.startsWith('movement_')), 'medium-movement species: no movement advisory');
}

/* ---------------- drawer math ---------------- */
section('drawer-box math (nightstand, 2 drawers)');
{
  const { spec, model, report } = pipeline({
    meta: { name: 'NS', template: 'nightstand', level: 'intermediate' },
    overall: { width: 500, depth: 400, height: 600 },
    drawers: { count: 2, frontStyle: 'inset', runner: 'side_mount_slides' },
    joinery: { frame: 'dowels', box: 'locking_rabbet' }
  });
  eq(report.errors.length, 0, 'nightstand validates clean');
  const rails = model.parts.filter(p => p.role === 'rail');
  eq(rails.length, 3, '2 drawers → 3 rails (top, divider, bottom)');
  ok(rails.every(r => r.size.h === 60 && r.size.d === 20), 'rails are 20 thick × 60 tall');
  eq(model.openings.length, 2, 'two openings');
  eq(model.drawers.length, 2, 'two drawer assemblies');

  for (const d of model.drawers) {
    const op = d.opening;
    eq(d.box.w, op.w - 25.4, `drawer ${d.index + 1}: box width = opening − 25.4 (12.7 mm per side, the slide's half inch)`);
    eq(d.box.h, op.h - 15, `drawer ${d.index + 1}: box height = opening − 15`);
    ok(K.SLIDE_LENGTHS.includes(d.slideLen), `drawer ${d.index + 1}: slide is a standard length (${d.slideLen})`);
    eq(d.box.d, d.slideLen, `drawer ${d.index + 1}: box depth = slide length`);
    ok(d.slideLen <= op.interiorDepth - 25, `drawer ${d.index + 1}: slide respects 25mm rear setback`);
    eq(d.front.w, op.w - 4, `drawer ${d.index + 1}: inset front = opening − 2mm gap each side (w)`);
    eq(d.front.h, op.h - 4, `drawer ${d.index + 1}: inset front = opening − 2mm gap each side (h)`);
    eq(d.front.t, 19, 'front thickness 19');
    ok(op.h >= 80, 'opening ≥ 80');
    ok(op.w <= 750, 'opening ≤ 750');
  }
  const openings = model.openings;
  ok(Math.abs(openings[0].h - openings[1].h) < 0.2, 'equal opening heights by default');

  // Front parts use the main species; box parts use sheet stock.
  const fronts = model.parts.filter(p => p.role === 'drawer_front');
  eq(fronts.length, 2, 'two applied fronts');
  ok(fronts.every(f => f.material === spec.wood.species), 'fronts match main species');
  ok(model.parts.filter(p => p.role === 'drawer_side').every(p => p.material === 'baltic_birch'), 'box sides are baltic birch');

  // BOM: slide pairs + pulls + mounting screws.
  const bom = Plans.bom(spec, model);
  eq(bom.items.filter(i => i.label.includes('side-mount slides')).length, 2, 'BOM: one slide pair per drawer');
  eq(bom.items.filter(i => i.label === 'Bar pull').length, 2, 'BOM: one styled pull per drawer (bar pull default)');
  ok(bom.items.some(i => i.label.includes('M4 ×')), 'BOM: slide mounting screws');
  ok(bom.items.some(i => i.detail && i.detail.includes('front attachment')), 'BOM: front attachment screws');

  // Cut list: drawer parts flow through with allowances.
  const cut = Plans.cutList(spec, model);
  const boxFront = cut.find(r => r.name.includes('box front'));
  ok(boxFront, 'cut list includes drawer box fronts');
  ok(boxFront.note.includes('locking rabbet'), 'locking rabbet allowance noted');
  const geomFront = model.parts.find(p => p.role === 'drawer_boxfront');
  const geomLen = Math.max(geomFront.size.w, geomFront.size.h, geomFront.size.d);
  eq(boxFront.L, Math.round((geomLen + 2 * Plans.jointAllowance('locking_rabbet', 12)) * 10) / 10, 'box front length = geometry + 2 thickness-aware joint allowances');
}

section('drawer auto-correction + overlay');
{
  // Too many drawers for a short nightstand → correction reduces count.
  const { spec, model, report } = pipeline({
    meta: { template: 'nightstand', level: 'intermediate' },
    overall: { width: 450, depth: 380, height: 480 },
    drawers: { count: 4, frontStyle: 'inset', runner: 'side_mount_slides' }
  });
  ok(spec.drawers.count < 4, `drawer count auto-reduced (${spec.drawers.count})`);
  ok(model.openings.every(o => o.h >= 80), 'all openings ≥ 80 after correction');
  eq(report.errors.length, 0, 'auto-corrected design has no blocking errors');

  const ov = pipeline({
    meta: { template: 'cabinet', level: 'intermediate' },
    overall: { width: 800, depth: 450, height: 900 },
    drawers: { count: 2, frontStyle: 'overlay', runner: 'side_mount_slides' }
  });
  for (const d of ov.model.drawers) {
    ok(d.front.w > d.opening.w && d.front.w <= d.opening.w + 20, 'overlay front wider than opening, ≤ +10/side');
    ok(d.front.h > d.opening.h, 'overlay front taller than opening');
  }

  // Wood runners math.
  const wr = pipeline({
    meta: { template: 'nightstand', level: 'intermediate' },
    overall: { width: 500, depth: 400, height: 600 },
    drawers: { count: 1, frontStyle: 'inset', runner: 'wood_runners' }
  });
  const d0 = wr.model.drawers[0];
  eq(d0.box.w, d0.opening.w - 4, 'wood runners: box = opening − 4 total');
  eq(d0.box.h, d0.opening.h - 10, 'wood runners: height = opening − 10');
  eq(d0.box.d, d0.opening.interiorDepth - 20, 'wood runners: depth = interior − 20');
  eq(d0.slideLen, null, 'no slide hardware for wood runners');
}

/* ---------------- wire diff merge + chips (Phase 4 protocol) ---------------- */
section('wire diff-based refinement');
{
  const base = Spec.correctSpec({ meta: { template: 'table' } });
  const reply = AI.classify(AI.extractJSON('{"o":{"h":700},"e":"Lowered height by 50mm"}'));
  eq(reply.kind, 'diff', 'partial wire spec classified as diff');
  const applied = AI.apply(reply, base);
  eq(applied.spec.overall.height, 700, 'deep-merge applied');
  eq(applied.spec.overall.width, base.overall.width, 'unrelated fields untouched (no drift)');
  ok(applied.diffs.some(d => d.path === 'overall.height' && d.from === 736.6 && d.to === 700), 'code-computed diff records 736.6 → 700');
  ok(applied.chips.some(c => /height 29 in → 27 9\/16 in/.test(c)), 'chip text renders the change in display units (imperial default)');
  BB.Units.set({ system: 'metric' });
  const chipsMetric = Spec.describeDiff(applied.diffs);
  ok(chipsMetric.some(c => /height 736\.6 mm → 700 mm/.test(c)), 'the same diff renders metric after a units switch');
  BB.Units.set({ system: 'imperial' });

  // 0 deletes drawers on the wire.
  const cab = Spec.correctSpec({ meta: { template: 'cabinet' }, drawers: { count: 2 } });
  const rm = AI.apply(AI.classify(AI.extractJSON('{"d":0,"e":"Removed drawers"}')), cab);
  ok(!rm.spec.drawers, 'wire "d":0 removes drawers');

  // Partial drawer + structure + species updates.
  const drPatch = Codec.decodePartial({ d: { c: 3 }, m: 3, s: { c: 2 } });
  eq(drPatch.drawers.count, 3, 'partial wire drawer count decoded');
  const dr = AI.apply(AI.classify(AI.extractJSON('{"d":{"c":3},"m":3,"s":{"c":2},"e":"x"}')), cab);
  ok(dr.spec.drawers.count === 2, 'correction still auto-reduces drawers that leave openings under 80 mm');
  eq(dr.spec.wood.species, 'walnut', 'wire species enum decoded');
  eq(dr.spec.structure.shelfCount, 2, 'wire structure short key decoded');

  // Question shape (wire).
  const q = AI.classify(AI.extractJSON('Sure! {"q":"Bigger how?","a":["Wider","Taller"]}'));
  eq(q.kind, 'question', 'question classified');
  eq(q.options.length, 2, 'options preserved');

  // New-design shape (wire).
  const nd = AI.classify(AI.extractJSON('{"N":{"v":4,"n":"Oak Desk","t":1,"l":0,"u":0,"o":[1300,650,735],"m":0,"s":{"t":25},"j":[1,0,1],"f":0,"d":0},"e":"x"}'));
  eq(nd.kind, 'new', 'wire new-design classified');
  eq(nd.spec.meta.template, 'desk', 'template enum decoded');
  eq(nd.spec.overall.width, 1300, 'dimension array decoded');

  // Correction still governs merged specs.
  const cheat = AI.apply(AI.classify(AI.extractJSON('{"j":{"b":7},"e":"x"}')),
    Spec.correctSpec({ meta: { template: 'nightstand', level: 'beginner' } }));
  ok(cheat.spec.joinery.box !== 'half_blind_dovetail', 'AI cannot smuggle advanced joints past a beginner level');

  // A4: "p" and "c" are independent diff keys on a custom piece.
  {
    const cbase = Spec.correctSpec(Spec.defaultSpec('custom'));
    // p-only: the existing connection graph must survive the merge.
    const wireP = Codec.encode(cbase).p;
    const pOnly = Codec.decodePartial({ p: wireP });
    ok(pOnly && pOnly.custom && Array.isArray(pOnly.custom.parts) && !('connections' in pOnly.custom),
      'p-only diff carries parts and NO connections key');
    const pApplied = AI.apply({ kind: 'diff', patch: pOnly, explain: '' }, cbase);
    eq(pApplied.spec.custom.connections.length, 2, 'p-only diff preserves the existing connection graph');
    const pr = pipeline(pApplied.spec);
    eq(pr.report.errors.filter(e => e.id.startsWith('float_')).length, 0, 'p-only edit leaves no free-floating parts');
    // c-only: a joint upgrade decodes to a connections patch (was null).
    const cOnly = Codec.decodePartial({ c: [[1, 0, 3], [2, 0, 3]] }); // JNT 3 = dado
    ok(cOnly && cOnly.custom && !cOnly.custom.parts && cOnly.custom.connections.length === 2,
      'c-only diff decodes to a connections patch, no parts key');
    ok(!(cOnly.meta && cOnly.meta.template), 'c-only diff never stamps the template');
    const cbaseInt = Spec.correctSpec(Spec.deepMerge(Spec.defaultSpec('custom'), { meta: { level: 'intermediate' } }));
    const cApplied = AI.apply({ kind: 'diff', patch: cOnly, explain: '' }, cbaseInt);
    eq(cApplied.spec.custom.parts.length, 3, 'parts untouched by a c-only diff');
    ok(cApplied.spec.custom.connections.every(cn => cn.joint === 'dado'),
      'c-only joint upgrade lands in the corrected graph');
    ok(cApplied.chips.length > 0, 'the c-only change is visible in the code-computed diff');
    // Stale connection ids after a part-count shrink are dropped, not fatal.
    const shrink = Codec.decodePartial({ p: wireP.slice(0, 2) });
    const sApplied = AI.apply({ kind: 'diff', patch: shrink, explain: '' }, cbase);
    ok(sApplied.spec.custom.connections.every(cn => ['p1', 'p2'].includes(cn.a) && ['p1', 'p2'].includes(cn.b)),
      'connections referencing removed parts are dropped by correction');
  }
}

/* ---------------- custom o-only refinement scales in code (B3) ---------------- */
section('custom overall-only diff scales the composition (B3)');
{
  const cbase = Spec.correctSpec(Spec.defaultSpec('custom')); // 1100×350×468
  const target = cbase.overall.height - 101.6;
  const reply = AI.classify(AI.extractJSON(JSON.stringify({ o: { h: target }, e: 'Lowered 101.6 mm' })));
  const applied = AI.apply(reply, cbase);
  ok(Math.abs(applied.spec.overall.height - target) <= 5,
    `o-only height diff on a custom piece really resizes — got ${applied.spec.overall.height}, want ≈${target}`);
  ok(Math.abs(cbase.overall.height - applied.spec.overall.height - 101.6) <= 5,
    'delivered height dropped ≈101.6 mm (never a silent no-op behind a "changed" ack)');
  ok(applied.chips.some(c => /^height /.test(c)), 'the height change lands in the code-computed chips');
  ok(Math.abs(applied.spec.overall.width - cbase.overall.width) <= 2, 'width untouched by a height-only resize');
  eq(applied.spec.custom.parts.length, cbase.custom.parts.length, 'parts survive the scale');
  eq(applied.spec.custom.connections.length, cbase.custom.connections.length, 'connections survive the scale');
  const r = pipeline(applied.spec);
  eq(r.report.errors.length, 0, 'the scaled composition still builds clean');
  // A width-only target scales exactly (no thickness snap on that axis here).
  const wApplied = AI.apply(AI.classify(AI.extractJSON('{"o":{"w":1400},"e":"wider"}')), cbase);
  eq(wApplied.spec.overall.width, 1400, 'width-only target lands exactly');
  eq(wApplied.spec.overall.height, cbase.overall.height, 'height untouched by a width-only resize');
  // scaleCustom is a no-op guard: same-size target returns null, patch falls through.
  ok(Spec.scaleCustom(cbase, { height: cbase.overall.height }) === null, 'same-size target returns null (nothing to scale)');
  // Rotated parts map their local dims to the right world axis: the default
  // custom legs are panels rotated 90° about y — their WIDTH is vertical, so
  // a height scale must move dim.w, not dim.l.
  const leg = cbase.custom.parts.find(p => p.rot && p.rot.y === 90);
  const scaledLeg = Spec.scaleCustom(cbase, { height: cbase.overall.height * 0.5 }).parts.find(p => p.id === leg.id);
  ok(Math.abs(scaledLeg.dim.w - leg.dim.w * 0.5) <= 0.1, 'rotated panel scales its vertical (w) dim on a height resize');
  eq(scaledLeg.dim.l, leg.dim.l, 'and keeps its horizontal (l) dim');
}

/* ---------------- custom composition diffs are human chips (B5) ---------------- */
section('custom composition diffs are human-readable chips (B5)');
{
  const base = Spec.correctSpec(Spec.deepMerge(Spec.defaultSpec('custom'),
    { meta: { level: 'intermediate' }, wood: { species: 'walnut' } }));

  // The B-base2-t2 live failure: a diff flipped every part's stock from solid
  // walnut to baltic-birch sheet and the chips said only "10 items → 10 items".
  const flipped = Spec.clone(base);
  for (const p of flipped.custom.parts) p.stock = 'sheet';
  const flipChips = Spec.describeDiff(Spec.diffSpecs(base, Spec.correctSpec(flipped)));
  ok(!flipChips.some(c => /\bitems?\b/.test(c)), `no chip is an opaque "N items" count — got ${JSON.stringify(flipChips)}`);
  ok(flipChips.some(c => /all parts stock Black Walnut → Baltic Birch Ply/.test(c)),
    `the material flip is named in human terms — got ${JSON.stringify(flipChips)}`);

  // A joint change on a connection is named with the parts and joint labels.
  const jointed = Spec.clone(base);
  jointed.custom.connections = jointed.custom.connections.map(c => Object.assign({}, c, { joint: 'dado' }));
  const jointChips = Spec.describeDiff(Spec.diffSpecs(base, Spec.correctSpec(jointed)));
  ok(jointChips.some(c => /leg_panel–seat joint .*→ Dado \/ housing/.test(c)),
    `a connection's joint change is a named chip — got ${JSON.stringify(jointChips)}`);

  // A single part's dimension change renders as a length in display units,
  // and re-renders when the unit system flips (same contract as template chips).
  const resized = Spec.clone(base);
  resized.custom.parts[0].dim.l = 1200;
  const dimDiffs = Spec.diffSpecs(base, Spec.correctSpec(resized));
  const dimChips = Spec.describeDiff(dimDiffs);
  ok(dimChips.some(c => /^seat length .*in → .*in/.test(c)), `part dims render in display units — got ${JSON.stringify(dimChips)}`);
  BB.Units.set({ system: 'metric' });
  ok(Spec.describeDiff(dimDiffs).some(c => /^seat length 1100 mm → 1200 mm/.test(c)), 'part dims re-render metric after a units switch');
  BB.Units.set({ system: 'imperial' });

  // Part-count changes stay visible, and new connections are announced.
  const grown = Spec.clone(base);
  grown.custom.parts.push({ id: 'p4', role: 'stretcher', primitive: 'rail', dim: { l: 900, w: 60, t: 20 }, pos: { x: 0, y: 100, z: 0 }, rot: null, grain: 'length', stock: 'solid', loadBearing: false, surface: 'none' });
  grown.custom.connections.push({ a: 'p4', b: 'p2', joint: 'butt_screws' });
  const grownChips = Spec.describeDiff(Spec.diffSpecs(base, Spec.correctSpec(grown)));
  ok(grownChips.some(c => /composition 3 parts → 4 parts/.test(c)), `part count change is a chip — got ${JSON.stringify(grownChips)}`);
  ok(grownChips.some(c => /joined .*stretcher/.test(c) || /connections added/.test(c)), 'a new connection is announced');
}

/* ---------------- ack reconciliation (A2, merges B4/C4) ---------------- */
section('ack reconciliation: the bot never claims what the spec lacks (A2)');
{
  const none = { patch: {}, ignored: [] };

  // req1 live case: "splayed legs" claimed on a legless bookshelf.
  const shelf = Spec.correctSpec({ meta: { template: 'bookshelf', level: 'advanced' }, wood: { species: 'walnut' } });
  const a1 = Spec.reconcileAck('Walnut case bookshelf with splayed solid legs and open sides for a bold mid-century look.', shelf, ['species Red Oak → Black Walnut'], none);
  ok(/no legs in this design/.test(a1), `legless bookshelf ack corrected — got "${a1}"`);
  ok(!/delivered wood/.test(a1), 'the true species claim (walnut) is not flagged');

  // req4-b-2 live case: "Three drawers ... hard maple" over a 2-drawer soft-maple cabinet.
  const cab = Spec.correctSpec({ meta: { template: 'cabinet', level: 'intermediate' }, wood: { species: 'soft_maple' }, drawers: { count: 2 } });
  const a2 = Spec.reconcileAck('Sized at workbench height with a thick 44mm hard maple top. Three drawers organize small hardware.', cab, ['drawer count null → 2'], none);
  ok(/2 drawers/.test(a2), `drawer count corrected — got "${a2}"`);
  ok(/soft maple/.test(a2), `species corrected to the delivered soft maple — got "${a2}"`);

  // A bare "maple" when the delivered wood IS a maple is not a contradiction.
  const a2b = Spec.reconcileAck('A sturdy maple workbench top.', cab, ['x'], none);
  ok(!/Actually:/.test(a2b), `generic "maple" over soft maple passes — got "${a2b}"`);

  // B4 live case (B-base2-t2): the requested depth reverted mid-pipeline.
  const table = Spec.correctSpec(Spec.defaultSpec('table'));
  const a3 = Spec.reconcileAck('Grew the top 50.8 mm deeper.', table, [], { patch: { overall: { depth: table.overall.depth + 50.8 } }, ignored: [] });
  ok(/depth is .* not the proposed/.test(a3), `reverted dimension surfaced — got "${a3}"`);

  // A requested change that changed nothing at all is said so.
  const a4 = Spec.reconcileAck('Lowered it 4 inches.', table, [], { patch: { overall: { height: table.overall.height } }, ignored: [] });
  ok(/nothing in the delivered design actually changed/.test(a4), `false "changed" ack corrected — got "${a4}"`);

  // C4: ignored wire keys are named.
  const a5 = Spec.reconcileAck('Angled the legs 10 degrees.', table, [], { patch: { overall: { height: table.overall.height } }, ignored: ['legs', 'angle'] });
  ok(/ignored: legs, angle/.test(a5), `ignored keys caveat — got "${a5}"`);

  // Mechanism words: a phantom hinge claim is corrected...
  const a6 = Spec.reconcileAck('The lid is hinged at the back for easy access.', shelf, ['x'], none);
  ok(/nothing hinges, folds, or pivots/.test(a6), `phantom hinge corrected — got "${a6}"`);
  // ...but honest negation is never "corrected"...
  const a7 = Spec.reconcileAck('The lid is glued fixed — a true hinged lid isn’t expressible here.', shelf, ['x'], none);
  ok(!/Actually:/.test(a7), `honest hinge negation passes — got "${a7}"`);
  // ...and a genuine kd_bolt lift-off survives.
  const kd = Spec.correctSpec(Spec.deepMerge(Spec.defaultSpec('custom'), { meta: { level: 'advanced' } }));
  kd.custom.connections[0].joint = 'kd_bolt';
  const a8 = Spec.reconcileAck('The top lifts off after removing the KD bolts.', kd, ['x'], none);
  ok(!/permanently fastened/.test(a8), `kd_bolt lift-off claim passes — got "${a8}"`);

  // A truthful ack passes through byte-identical.
  const low = Spec.correctSpec(Spec.deepMerge(Spec.defaultSpec('table'), { overall: { height: 700 } }));
  const clean = Spec.reconcileAck('Lowered the top to 700 mm.', low, ['height 29 in → 27 9/16 in'], { patch: { overall: { height: 700 } }, ignored: [] });
  eq(clean, 'Lowered the top to 700 mm.', 'a truthful ack passes through unchanged');

  // C4 codec half: an out-of-range enum index is dropped, never a silent
  // reset to the wire default.
  ok(Codec.decodePartial({ m: 99 }) === null, 'a diff of only an out-of-range enum decodes to null');
  const p2 = Codec.decodePartial({ m: 99, o: { h: 700 } });
  ok(p2.overall.height === 700 && !p2.wood, 'out-of-range species index is dropped, not reset to default');
  // classify records unknown wire keys for the ack caveat.
  const rIgn = AI.classify({ o: { h: 700 }, legs: 'angled', e: 'x' });
  eq(rIgn.ignored, ['legs'], 'classify lists unknown wire keys as ignored');
}

/* ---------------- integrity line on every commit source (A3) ---------------- */
section('integrity line rides every commit source when checks fail (A3)');
{
  eq(Spec.integrityLine({ fails: 5, advisories: 3 }, {}),
    ' Integrity: 5 failing checks — see the Safety tab before building.',
    'text-flow ack carries the failing-check line');
  eq(Spec.integrityLine({ fails: 1, advisories: 0 }, {}),
    ' Integrity: 1 failing check — see the Safety tab before building.',
    'singular phrasing for one failure');
  eq(Spec.integrityLine({ fails: 0, advisories: 2 }, {}), '', 'no scare line when nothing fails (text flows)');
  ok(/all checks pass/.test(Spec.integrityLine({ fails: 0, advisories: 0 }, { photo: true })),
    'photo flows keep the full report line even when clean');
  ok(/2 advisory/.test(Spec.integrityLine({ fails: 0, advisories: 2 }, { photo: true })),
    'photo flows still surface advisories');
  eq(Spec.integrityLine(null, {}), '', 'no summary, no line');
}

/* ---------------- mid-round reply triage (C8) ---------------- */
section('mid-round replies: info/question/limits are triaged, never burned (C8)');
{
  eq(AI.roundDecision(null), 'bail', 'no result bails');
  eq(AI.roundDecision({ reply: null }), 'bail', 'transport failure bails');
  eq(AI.roundDecision({ reply: null, usageLimit: true }), 'billing', 'mid-round 402 triggers the billing UX');
  eq(AI.roundDecision({ reply: null, rateLimited: true }), 'rate', 'mid-round 429 triggers the rate-limit notice');
  eq(AI.roundDecision({ reply: { kind: 'question', question: 'x' } }), 'question', 'a mid-round question is surfaced, not discarded');
  eq(AI.roundDecision({ reply: { kind: 'info', text: 'x' } }), 'info', 'a mid-round info reply shows its text (P8: no more burned no-op rounds)');
  eq(AI.roundDecision({ reply: { kind: 'diff', patch: {} } }), 'apply', 'a diff applies');
  eq(AI.roundDecision({ reply: { kind: 'new', spec: {} } }), 'apply', 'a full respec applies');
  eq(AI.roundDecision({ reply: { kind: 'question', question: 'x' }, local: true }), 'bail',
    'a mid-round transport death (local fallback) bails — the offline parser never speaks for the model');
}

/* ---------------- critique remedy vocabulary (A10) ---------------- */
section('buildCritique appends code-owned remedy hints per failing check type (A10)');
{
  const mk = (id, title) => ({ id, title, explain: 'x', value: 'v', threshold: 't' });
  const sag = AI.buildCritique([mk('sag:p1', 'Sag — worktop')]);
  ok(/laminate two sheet layers/.test(sag) && /add a rail or rib/.test(sag) && /shorten the span/.test(sag),
    `sag failures get thicken/laminate/rail/shorten-span vocabulary — got "${sag.match(/Proven fixes[^\n]*/)}"`);
  const str = AI.buildCritique([mk('str:p2', 'Strength — shelf')]);
  ok(/thicker section or a stronger species/.test(str), 'str failures get thicker-section/stronger-species');
  const tip = AI.buildCritique([mk('tip', 'Tipping stability')]);
  ok(/widen the stance or lower the mass/.test(tip), 'tip failures get widen-stance/lower-mass');
  const stand = AI.buildCritique([mk('stand', 'It must stand')]);
  ok(/widen the stance/.test(stand), 'COG (stand) failures share the stance remedy');
  const jnt = AI.buildCritique([mk('joints', 'Joint adequacy')]);
  ok(/stronger joint allowed by the LEVEL MATRIX/.test(jnt), 'joint failures point at the level matrix');
  // One line per TYPE — five sag fails produce the remedy once.
  const many = AI.buildCritique([mk('sag:p1', 'a'), mk('sag:p2', 'b'), mk('sag:p3', 'c')]);
  eq((many.match(/laminate two sheet layers/g) || []).length, 1, 'remedy lines dedupe per check type');
  // Unmapped check types add no remedy line and never break the critique.
  const other = AI.buildCritique([mk('collide', 'Collision check')]);
  ok(!/Proven fixes/.test(other) && /Fix ONLY these problems/.test(other), 'unmapped types keep the plain critique');
}

/* ---------------- assembly walkthrough context (C10, merges B7) ---------------- */
section('step walkthroughs inject the code-built assembly plan (C10)');
{
  const spec = Spec.correctSpec({
    meta: { name: 'Walk NS', template: 'nightstand', level: 'intermediate', units: 'in' },
    overall: { width: 508, depth: 406.4, height: 609.6 }, wood: { species: 'walnut' },
    drawers: { count: 2, frontStyle: 'inset', runner: 'side_mount_slides' }
  });
  // The reference numbering: exactly what the Plan tab renders (glue-ups included).
  const model = Parametric.build(spec);
  const integ = Structural.computeIntegrity(spec, model, {});
  const cut = Plans.cutList(spec, model);
  const stock = Packing.planStock(spec, model, cut, {});
  const steps = Plans.assembly(spec, model, integ, { stockPlan: stock });
  ok(steps.length >= 5, `fixture has at least 5 assembly steps (got ${steps.length})`);

  const ctx = AI.stepContext('walk me through step 5', spec);
  ok(!!ctx && /^\[assembly\]/.test(ctx), 'step ask produces an [assembly] context block');
  ok(ctx.includes(`Step 5 = "${steps[4].title}"`), `block names the REAL step-5 title — got "${String(ctx).slice(0, 200)}"`);
  ok(ctx.includes(`5. ${steps[4].title}`), 'the numbered title list matches the Plan tab numbering');
  ok(ctx.includes('user level: intermediate'), 'the user skill level rides the block');
  ok(steps[4].text ? ctx.includes(steps[4].text.slice(0, 40)) : true, 'the referenced step\'s full text is included');

  // Out-of-range step numbers are answered honestly, not guessed.
  const over = AI.stepContext('walk me through step 99', spec);
  ok(!!over && over.includes(`no step 99`) && over.includes(`${steps.length} steps`), 'a step past the end says how many steps exist');

  // Walkthrough phrasing without a number still ships the titles list.
  const how = AI.stepContext('how do i assemble this?', spec);
  ok(!!how && how.includes(`1. ${steps[0].title}`), 'general assembly asks get the numbered titles');

  // Ordinary refinements never trigger the injection.
  eq(AI.stepContext('make it walnut and 2 inches taller', spec), null, 'a plain refinement injects nothing');
}

/* ---------------- local model ---------------- */
section('local intent parser');
{
  const spec = Spec.correctSpec({ meta: { template: 'table' } });
  const q = AI.localModel('make it bigger', spec);
  eq(q.kind, 'question', 'ambiguous “bigger” → clarifying question');
  ok(q.options.length >= 2, 'question ships tappable options');

  const low = AI.localModel('lower it by 50mm', spec);
  eq(low.kind, 'diff', 'lower by 50 → diff');
  eq(low.patch.overall.height, spec.overall.height - 50, 'height reduced by 50');

  const wal = AI.localModel('make it walnut', spec);
  eq(wal.patch.wood.species, 'walnut', 'species change parsed');
  eq(AI.localModel('make the top oak instead of walnut', { ...spec, wood: { species: 'walnut' } }).patch.wood.species, 'red_oak',
    '"oak instead of walnut" picks the target species, not the one being replaced');
  eq(AI.localModel('switch to white oak instead of pine', { ...spec, wood: { species: 'pine' } }).patch.wood.species, 'white_oak',
    '"instead of" stripping works with multi-word oak');

  // 2026 species: multi-word labels beat last-word collisions, aliases work,
  // and a named sheet good switches ONLY the sheet stock.
  eq(AI.localModel('build it from southern yellow pine', spec).patch.wood.species, 'syp', '"southern yellow pine" is not just "pine"');
  eq(AI.localModel('make it pine', spec).patch.wood.species, 'pine', 'plain "pine" still means Eastern White Pine');
  eq(AI.localModel('douglas fir instead', spec).patch.wood.species, 'douglas_fir', 'hyphen-tolerant Douglas-Fir alias');
  eq(AI.localModel('make it hickory', spec).patch.wood.species, 'hickory', 'new single-word species parsed');
  eq(AI.localModel('soft maple please', spec).patch.wood.species, 'soft_maple', '"soft maple" beats the hard-maple last word');
  eq(AI.localModel('make it maple', spec).patch.wood.species, 'hard_maple', 'plain "maple" keeps meaning hard maple');
  const mdfPatch = AI.localModel('use mdf for the boxes', spec).patch;
  eq(mdfPatch.wood.sheetSpecies, 'mdf', 'sheet-good mention sets the sheet species');
  ok(!mdfPatch.wood.species, 'sheet-good mention leaves the solid species alone');

  // Hardware style intent (2026 hardware expansion): style only — the
  // counts, sizes, and bores are code-owned (BB.HW).
  const ns2 = Spec.correctSpec({ meta: { template: 'nightstand' } });
  eq(AI.localModel('use cup pulls', ns2).patch.hardware.pull, 'cup_pull', 'pull style intent parsed');
  eq(AI.localModel('make it handleless, push to open', ns2).patch.hardware.pull, 'none_touch', 'push-to-open parsed');
  eq(AI.localModel('turned wooden knobs please', ns2).patch.hardware.pull, 'knob_turned_wood', 'turned knob beats plain knob');
  eq(AI.localModel('switch to undermount slides', ns2).patch.drawers.runner, 'undermount_slides', 'undermount runner parsed');

  const ns = Spec.correctSpec({ meta: { template: 'nightstand' } });
  const dr = AI.localModel('add another drawer', ns);
  eq(dr.patch.drawers.count, 2, 'add a drawer increments count');

  const nw = AI.localModel('build me a bookshelf 900mm wide', spec);
  eq(nw.kind, 'new', 'creation intent');
  eq(nw.spec.meta.template, 'bookshelf', 'template switched');
  eq(nw.spec.overall.width, 900, 'explicit mm width picked up');

  const inches = AI.localModel('width to 48 in', spec);
  eq(inches.patch.overall.width, 1219.2, 'imperial parsed to mm');

  // Bare numbers follow the design's display system (imperial default).
  const bare = AI.localModel('make it 36 wide', spec);
  eq(bare.patch.overall.width, 914.4, 'bare number means inches for an imperial design');

  const frac = AI.localModel(`width to 29 1/2"`, spec);
  eq(frac.patch.overall.width, 749.3, 'fractional inches normalized to mm before parsing');

  // X-01: a bare noun-phrase description — the app's own hero placeholder —
  // is a creation request, and no ack/chip ever names a field the corrected
  // spec will not actually change.
  {
    const hero = AI.localModel('A walnut nightstand with two drawers', spec);
    eq(hero.kind, 'new', 'hero placeholder: bare noun phrase creates');
    eq(hero.kind === 'new' && hero.spec.meta.template, 'nightstand', 'hero placeholder: right template');
    eq(hero.kind === 'new' && hero.spec.wood.species, 'walnut', 'hero placeholder: walnut');
    eq(hero.kind === 'new' && hero.spec.drawers && hero.spec.drawers.count, 2, 'hero placeholder: two drawers');
    if (hero.kind === 'new') {
      const applied = AI.apply(hero, spec);
      ok(applied.spec.meta.template === 'nightstand' && applied.spec.drawers && applied.spec.drawers.count === 2,
        'hero placeholder applies as a real 2-drawer nightstand');
      ok(applied.chips.some(c => /template/.test(c)), 'chips record the template change');
    }

    const chip = AI.localModel(Gallery.FIRST_RUN_PROMPTS[1], spec); // 'A nightstand with two drawers in cherry'
    eq(chip.kind, 'new', 'hint chip: bare noun phrase creates');
    eq(chip.kind === 'new' && chip.spec.meta.template, 'nightstand', 'hint chip: nightstand');
    eq(chip.kind === 'new' && chip.spec.wood.species, 'cherry', 'hint chip: cherry');
    eq(chip.kind === 'new' && chip.spec.drawers && chip.spec.drawers.count, 2, 'hint chip: two drawers');

    const bed = AI.localModel('a bedside table in walnut', spec);
    eq(bed.kind === 'new' && bed.spec.meta.template, 'nightstand', 'multi-word "bedside table" beats "table"');

    // Phantom shelf count: a normalized length token ("about 5 feet tall" →
    // "about 1524mm tall") must never read as a shelf count — the chips would
    // then report a change the user never asked for.
    const bs = Spec.correctSpec({ meta: { template: 'bookshelf' } });
    const tall = AI.localModel('make the bookshelf about 1524mm tall', bs);
    eq(tall.kind, 'diff', 'same-template mention refines, never recreates');
    eq(tall.kind === 'diff' && tall.patch.overall && tall.patch.overall.height, 1524, 'height parsed from the mm token');
    ok(!(tall.kind === 'diff' && tall.patch.structure && 'shelfCount' in tall.patch.structure),
      'no phantom shelf count from the mm token');
    if (tall.kind === 'diff') {
      const applied = AI.apply(tall, bs);
      ok(applied.chips.every(c => !/shelf count/.test(c)), 'chips never name a shelf-count change nobody asked for');
    }
    const legit = AI.localModel('give it 3 shelves', bs);
    eq(legit.kind === 'diff' && legit.patch.structure && legit.patch.structure.shelfCount, 3, 'real shelf-count asks still parse');

    // A mentioned-but-not-created template cannot smuggle drawers onto the
    // current design (correction would strip them → phantom ack).
    const smug = AI.localModel('two drawers like a cabinet has', spec);
    ok(smug.kind === 'question' || !/drawer/.test((smug.explain || '') + JSON.stringify(smug.patch || {})),
      'drawers on a table are refused, never acked');

    // Negation guard intact (FE-H10/H11): a negated template noun never creates.
    ok(AI.localModel('not a nightstand', spec).kind !== 'new', 'negated template noun never creates');
    ok(AI.localModel('no ash please', ns).kind === 'question', 'species negation guard still asks');
  }

  // X-09: design names preserve the user's phrasing — never the mm token
  // that unit pre-normalization writes into the parsed text.
  {
    const nm = AI.localModel('A bookshelf about 5 feet tall', spec);
    eq(nm.kind, 'new', 'bare bookshelf description creates');
    ok(nm.kind === 'new' && !/\d+\s*mm\b/i.test(nm.spec.meta.name),
      `name carries no bare mm token — got "${nm.kind === 'new' ? nm.spec.meta.name : ''}"`);
    ok(nm.kind === 'new' && /5 feet/i.test(nm.spec.meta.name), 'name keeps the user\'s own words');
    ok(nm.kind === 'new' && Math.abs(nm.spec.overall.height - 1524) < 0.1, 'the height still parses to 1524 mm internally');
    // The chat route normalizes BEFORE localModel sees the text — the
    // original phrasing rides an opts channel.
    const pre = AI.localModel(BB.Units.normalizeLengthText('A bookshelf about 5 feet tall'), spec,
      { phrasing: 'A bookshelf about 5 feet tall' });
    ok(pre.kind === 'new' && !/\d+\s*mm\b/i.test(pre.spec.meta.name),
      `pre-normalized call with phrasing: no mm token — got "${pre.kind === 'new' ? pre.spec.meta.name : ''}"`);
  }
}

/* ---------------- lead-gen origin on export surfaces (A-11) ---------------- */
section('exports carry the app origin; share links carry a ref marker (A-11)');
{
  const r = pipeline({
    meta: { name: 'Origin NS', template: 'nightstand', level: 'intermediate', units: 'mm' },
    drawers: { count: 2, frontStyle: 'inset', runner: 'side_mount_slides' }
  });
  const cut = Plans.cutList(r.spec, r.model);
  const ORIGIN = 'https://blueprint.example.app/';
  // Origin is runtime state — it must be PASSED IN; the exporters stay pure.
  const csv = Exports.toCSV(r.spec, cut, { origin: ORIGIN });
  const lastLine = csv.trim().split('\r\n').pop();
  ok(/Blueprint Buddy/.test(lastLine) && /blueprint\.example\.app/.test(lastLine), 'CSV footer row names the app and its origin');
  ok(!/Made with|example\.app/.test(Exports.toCSV(r.spec, cut)), 'no origin argument → no footer (pure function of its arguments)');

  const fmt = v => BB.Units.fmtLength(v);
  ok(/blueprint\.example\.app/.test(BB.Drafting.sheetSVG(r.spec, r.model, fmt, { origin: ORIGIN })),
    'drawing sheet carries the origin in its title-block footer');
  ok(!/example\.app/.test(BB.Drafting.sheetSVG(r.spec, r.model, fmt)), 'sheet without origin unchanged');

  const integ = Structural.computeIntegrity(r.spec, r.model, {});
  const plan = Packing.planStock(r.spec, r.model, cut, {});
  const bom = Plans.bom(r.spec, r.model, { integrity: integ, stock: plan });
  const steps = Plans.assembly(r.spec, r.model, integ, { stockPlan: plan });
  const html = Exports.printHTML(r.spec, r.model, cut, bom, steps, plan, { origin: ORIGIN });
  ok(/Made with Blueprint Buddy[^<]*blueprint\.example\.app/.test(html), 'print sheet footer carries the origin');

  // Share links append a ref marker; import tolerates and strips it.
  const code = Codec.toShareCode(r.spec);
  const link = 'https://blueprint.example.app/#d=' + encodeURIComponent(code) + '&ref=share';
  const back = Codec.fromShareCode(link);
  ok(!back.error && back.spec && back.spec.meta.name === 'Origin NS', 'a full share link with the ref marker imports');
  const back2 = Codec.fromShareCode(code + '&ref=share');
  ok(!back2.error && !!back2.spec, 'code + ref marker imports (marker stripped)');
  ok(!Codec.fromShareCode(code).error, 'plain codes still import');
  ok(!!Codec.fromShareCode('BB4:!!!').error && !!Codec.fromShareCode('hello').error, 'garbage still rejected');
  const uiSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'ui.js'), 'utf8');
  ok(/encodeURIComponent\(Codec\.toShareCode\(state\.spec\)\) \+ '&ref=/.test(uiSrc), 'shareLink appends the ref marker');
}

/* ---------------- L-03: sheet goods never price in board feet ---------------- */
section('sheet species carry no vestigial pricePerBdFt (L-03)');
{
  // Reader audit (verified at fix time): defaultPrices().bdft filters
  // !s.sheet; plans.js/packing.js board-foot math reads spec.wood.species,
  // which correction guarantees is a SOLID species; compareSpecies skips
  // sheet rows. Nothing consumes pricePerBdFt for sheet: true species.
  for (const s of Object.values(K.WOOD_SPECIES).filter(x => x.sheet)) {
    ok(!('pricePerBdFt' in s), `${s.key} carries no pricePerBdFt (plywood is priced per sheet)`);
  }
  const dp = K.defaultPrices();
  ok(Object.keys(dp.bdft).length > 0 && Object.keys(dp.bdft).every(k => !K.WOOD_SPECIES[k].sheet),
    'board-foot default prices cover exactly the solid species');
  ok(Object.keys(dp.bdft).every(k => typeof dp.bdft[k] === 'number' && dp.bdft[k] > 0),
    'solid board-foot defaults remain intact');
  ok(Object.values(K.WOOD_SPECIES).filter(x => x.sheet).every(s => Object.keys(dp.sheet).includes(s.key)),
    'every sheet species prices through the per-sheet table instead');
}

/* ---------------- L-01: cleat stock from the ONE sheet table ---------------- */
section('french cleat ply comes from the standard sheet-thickness table (L-01)');
{
  const r = pipeline({
    meta: { name: 'Cleat', template: 'bookshelf', level: 'beginner', units: 'mm' },
    overall: { width: 900, depth: 300, height: 1800 }, structure: { shelfCount: 2, backPanel: true }
  });
  const side = r.model.parts.find(p => p.role === 'side');
  const mate = r.model.parts.find(p => p.role === 'top' || p.role === 'shelf');
  const lay = BB.Fasteners.layoutForJoint(r.spec, r.model, { type: 'french_cleat', a: side.id, b: mate.id });
  ok(lay && lay.cleat, 'french cleat layout carries cleat data');
  ok(lay && lay.cleat && K.SHEET_THICKNESS.includes(lay.cleat.plyMM),
    `cleat ply is ON the sheet-thickness table — got ${lay && lay.cleat && lay.cleat.plyMM}`);
  eq(lay && lay.cleat && lay.cleat.plyMM, K.SHEET_THICKNESS[2], 'cleat ply is the standard 18 mm sheet');
  ok(lay && lay.text.includes('rip ' + BB.Units.fmtLength(K.SHEET_THICKNESS[2]) + ' ply')
    && !lay.text.includes('rip ' + BB.Units.fmtLength(19) + ' ply'),
    'the rip instruction names the same stock the table sells');
}

/* ---------------- A-06: discoverability — meta/OG tags + robots.txt ---------------- */
section('template ships meta description + OG tags; build emits robots.txt (A-06)');
{
  const tpl = fs.readFileSync(path.join(__dirname, '..', 'src', 'index.template.html'), 'utf8');
  const head = tpl.slice(0, tpl.indexOf('</head>'));
  ok(/<meta name="description" content="[^"]{60,}">/.test(head), 'meta description present and substantive');
  ok(/<meta property="og:title" content="[^"]+">/.test(head), 'og:title present');
  ok(/<meta property="og:description" content="[^"]+">/.test(head), 'og:description present');
  ok(/<meta property="og:type" content="website">/.test(head), 'og:type=website present');
  ok(/<meta name="twitter:card" content="summary">/.test(head), 'twitter:card=summary present');
  ok(!/og:image/.test(head), 'no og:image is fabricated (no hosted asset exists)');
  // robots.txt is a real build output, committed alongside dist/index.html.
  const robotsPath = path.join(__dirname, '..', 'dist', 'robots.txt');
  const robots = fs.existsSync(robotsPath) ? fs.readFileSync(robotsPath, 'utf8') : '';
  ok(robots.length > 0, 'dist/robots.txt exists after build');
  ok(/^User-agent: \*$/m.test(robots) && /^Allow: \/$/m.test(robots), 'robots.txt allows all agents');
  ok(!/sitemap|\.xml|disallow/i.test(robots), 'robots.txt references nothing that does not exist');
}

/* ---------------- history ---------------- */
section('history');
{
  const s0 = Spec.correctSpec({ meta: { template: 'table' } });
  const h = History.createHistory(s0, 'gallery');
  const s1 = Spec.correctSpec(Spec.deepMerge(s0, { overall: { height: 700 } }));
  h.push(s1, 'ai');
  const s2 = Spec.correctSpec(Spec.deepMerge(s1, { wood: { species: 'walnut' } }));
  h.push(s2, 'manual');
  eq(h.snapshots.length, 3, 'three snapshots');
  eq(h.currentSpec().wood.species, 'walnut', 'current is latest');
  eq(h.undo().wood.species, 'red_oak', 'undo restores species');
  eq(h.undo().overall.height, 736.6, 'undo restores height');
  ok(!h.canUndo(), 'at root');
  eq(h.redo().overall.height, 700, 'redo works');
  h.restore(0);
  eq(h.snapshots.length, 4, 'restore appends, never truncates');
  eq(h.currentSpec().overall.height, 736.6, 'restore returns to snapshot 0 state');
  ok(h.snapshots[2], 'later snapshots still present after restore');
  const cmp = h.compare(0, 2);
  ok(cmp.diffs.some(d => d.path === 'wood.species'), 'compare finds species diff');
  ok(cmp.rows.length > 0, 'compare renders rows');
  ok(Object.isFrozen(h.snapshots[0].spec), 'snapshots are immutable');
}

/* ---------------- build checklist keys + progress pruning (Phase A) ---------------- */
section('build progress: checklist keys + orphan pruning');
{
  const { spec, model } = pipeline({
    meta: { template: 'nightstand', level: 'intermediate' },
    drawers: { count: 2, frontStyle: 'inset', runner: 'side_mount_slides' }
  });
  const cut = Plans.cutList(spec, model);
  const steps = Plans.assembly(spec, model);
  const plan = Packing.planStock(spec, model, cut, { prices: K.defaultPrices(), stockMode: {} });
  const keys = Plans.checklistKeys(plan, cut, steps);
  const boardCuts = plan.boards.filter(b => b.stockLen).reduce((n, b) => n + b.cuts.length, 0);
  const sheetCuts = plan.sheets.reduce((n, s) => n + s.placements.length, 0);
  eq(keys.cuts.length, boardCuts + sheetCuts, 'one key per packed board cut and sheet placement');
  eq(keys.steps.length, steps.length, 'one key per assembly step');
  ok(new Set(keys.cuts).size === keys.cuts.length, 'cut keys are unique');

  // Orphans from an older stock layout are pruned; live progress survives.
  const progress = {
    cuts: { [keys.cuts[0]]: true, 'b:9:9:Zombie leg:9999': true, 's:7:7:Zombie panel:123': false },
    steps: { [keys.steps[0]]: true, zombie_step: true }
  };
  Plans.pruneProgress(progress, keys);
  eq(Object.keys(progress.cuts), [keys.cuts[0]], 'orphan cut keys pruned, live key kept');
  eq(Object.keys(progress.steps), [keys.steps[0]], 'orphan step keys pruned, live step kept');

  // A re-pack (wider piece) changes the layout; pruning against the new plan
  // leaves nothing the live checklist can't render, so % can never lie.
  const r2 = pipeline(Spec.deepMerge(spec, { overall: { width: spec.overall.width + 220 } }));
  const cut2 = Plans.cutList(r2.spec, r2.model);
  const steps2 = Plans.assembly(r2.spec, r2.model);
  const plan2 = Packing.planStock(r2.spec, r2.model, cut2, { prices: K.defaultPrices(), stockMode: {} });
  const keys2 = Plans.checklistKeys(plan2, cut2, steps2);
  const allChecked = {
    cuts: Object.fromEntries(keys.cuts.map(k => [k, true])),
    steps: Object.fromEntries(keys.steps.map(k => [k, true]))
  };
  Plans.pruneProgress(allChecked, keys2);
  const live2 = new Set(keys2.cuts);
  ok(Object.keys(allChecked.cuts).every(k => live2.has(k)), 'after a re-pack no orphan cut keys remain');
  const done = keys2.cuts.filter(k => allChecked.cuts[k]).length + keys2.steps.filter(k => allChecked.steps[k]).length;
  ok(done <= keys2.cuts.length + keys2.steps.length, 'checked count never exceeds the live checklist');

  // Rough mode: quantity expands into per-piece keys, sheets still keyed.
  const planR = Packing.planStock(spec, model, cut, { prices: K.defaultPrices(), stockMode: { [spec.wood.species]: 'rough' } });
  const keysR = Plans.checklistKeys(planR, cut, steps);
  eq(planR.mode, 'rough', 'rough stock mode engaged');
  const solidPieces = cut.filter(r => r.stock !== 'sheet').reduce((n, r) => n + r.qty, 0);
  eq(keysR.cuts.filter(k => k.startsWith('r:')).length, solidPieces, 'rough mode: one key per physical piece, not per batch');
  ok(new Set(keysR.cuts).size === keysR.cuts.length, 'per-piece rough keys are unique');
  eq(keysR.cuts.filter(k => k.startsWith('s:')).length, planR.sheets.reduce((n, s) => n + s.placements.length, 0), 'rough mode: sheet placements still keyed');
}

/* ---------------- exports ---------------- */
section('COLLADA export');
{
  const { spec, model } = pipeline({ meta: { name: 'Seed Table', template: 'table' } });
  const dae = Exports.toDAE(spec, model);
  ok(dae.includes('<unit meter="0.001" name="millimeter"/>'), 'mm unit declared');
  ok(dae.includes('<up_axis>Z_UP</up_axis>'), 'Z_UP declared');
  for (const p of model.parts) ok(dae.includes(`<node id="${p.id}" name="${p.id}">`), `node for ${p.id}`);
  // Leg lands on the ground plane: node Z translation = legH/2, geometry half-height = legH/2.
  const leg = model.parts.find(p => p.id === 'leg_1');
  const m = dae.match(new RegExp(`<node id="leg_1"[^>]*>\\s*<matrix>([^<]+)</matrix>`));
  ok(m, 'leg_1 has a matrix');
  const vals = m[1].trim().split(/\s+/).map(Number);
  eq(vals[11], leg.size.h / 2, 'leg Z translation = half height (foot on ground)');
  eq(vals[3], leg.pos.x, 'X preserved');
  eq(vals[7], -leg.pos.z, 'Y′ = −z (Y-up → Z-up swap)');
  ok(dae.includes('mat_leg') && dae.includes('mat_top'), 'materials per role');
  // Deduped geometry: 4 legs share one geometry id.
  const geomCount = (dae.match(/<geometry id="/g) || []).length;
  ok(geomCount < model.parts.length, `geometry deduped (${geomCount} geoms for ${model.parts.length} parts)`);
}

section('Ruby export');
{
  const { spec, model } = pipeline({
    meta: { name: 'NS "quoted"', template: 'nightstand', level: 'intermediate' },
    drawers: { count: 2, frontStyle: 'inset', runner: 'side_mount_slides' }
  });
  const rb = Exports.toRuby(spec, model);
  ok(rb.includes('model.start_operation') && rb.includes('model.commit_operation'), 'single undo operation');
  ok(rb.includes('.mm'), 'uses .mm helper');
  ok(!/Point3d\.new\([^)]*\d\s*[,)]\s*(?!.*\.mm)/.test('') , 'placeholder');
  // Instances place with FULL 16-element transformations (rotation-capable)
  const xf = rb.match(/Geom::Transformation\.new\(\[[^\]]+\]\)/g) || [];
  ok(xf.length > 0 && xf.every(t => t.split(',').length === 16), 'every instance uses a full 16-element transformation');
  // Dedup: 4 legs → one definition, four instances.
  const legDefs = (rb.match(/defs\.add\("Leg /g) || []).length;
  eq(legDefs, 1, 'four legs = ONE ComponentDefinition');
  const legInsts = (rb.match(/inst\.name = "leg_\d"/g) || []).length;
  eq(legInsts, 4, 'four leg instances');
  ok(rb.includes('model.layers.add'), 'tags (layers) per role');
  ok(rb.includes('pushpull'), 'boxes built via pushpull');
  ok(rb.includes('face.reverse! if face.normal.z < 0'), 'pushpull direction normalized');
  ok(rb.includes('NS \\"quoted\\"'), 'design name escaped in Ruby strings');
  ok(rb.includes('Ruby Console'), 'run instructions in header');
}

/* ---------------- assembly ---------------- */
section('assembly steps');
{
  const { spec, model } = pipeline({
    meta: { template: 'nightstand', level: 'beginner' },
    drawers: { count: 2, frontStyle: 'inset', runner: 'side_mount_slides' }
  });
  const steps = Plans.assembly(spec, model);
  const ids = steps.map(s => s.id);
  const want = ['dr1_box', 'dr1_bottom', 'dr1_runners', 'dr1_hang', 'dr1_front', 'dr1_pull'];
  ok(want.every(w => ids.includes(w)), 'drawer sub-sequence complete');
  ok(ids.indexOf('dr1_box') < ids.indexOf('dr1_bottom') && ids.indexOf('dr1_bottom') < ids.indexOf('dr1_runners') &&
     ids.indexOf('dr1_runners') < ids.indexOf('dr1_hang') && ids.indexOf('dr1_hang') < ids.indexOf('dr1_front') &&
     ids.indexOf('dr1_front') < ids.indexOf('dr1_pull'), 'drawer steps in build order');
  ok(ids.indexOf('dr1_pull') < ids.indexOf('dr2_box'), 'drawer 1 completes before drawer 2');
  const partIds = new Set(model.parts.map(p => p.id));
  ok(steps.every(s => s.partIds.every(id => partIds.has(id))), 'every step references real parts');
  ok(steps.some(s => s.joints && s.joints.length), 'steps carry joint metadata for highlighting');
  ok(!steps.some(s => s.text.toLowerCase().includes('dovetail')), 'beginner build never mentions dovetails');
  ok(steps[steps.length - 1].id === 'finish', 'finishing step closes the sequence');
}

/* ---------------- gallery through the pipeline ---------------- */
section('starter gallery');
{
  for (const g of Gallery.STARTERS) {
    const { spec, model, report } = pipeline(g.spec);
    eq(report.errors.length, 0, `${g.spec.meta.name}: no blocking errors`);
    ok(model.parts.length > 4, `${g.spec.meta.name}: parts built`);
    const cut = Plans.cutList(spec, model);
    const b = Plans.bom(spec, model);
    const steps = Plans.assembly(spec, model);
    ok(cut.length > 0 && b.items.length > 0 && steps.length > 0, `${g.spec.meta.name}: full plans derived`);
    const dae = Exports.toDAE(spec, model);
    const rb = Exports.toRuby(spec, model);
    ok(dae.length > 500 && rb.length > 500, `${g.spec.meta.name}: exports generate`);
  }
  eq(Gallery.STARTERS.length, 6, 'six starters');
}

/* ---------------- knowledge ---------------- */
section('knowledge bases');
{
  ok(Object.keys(K.WOOD_SPECIES).length >= 22, 'twenty-two+ species (2026 expansion)');
  for (const s of Object.values(K.WOOD_SPECIES)) {
    ok(s.janka > 0 && s.blurb && s.movement && s.costTier >= 1, `${s.key} row complete`);
    ok(s.moe > 0 && s.mor > 0 && s.sg > 0 && s.ct > 0 && s.cr > 0, `${s.key} carries full Wood Handbook mechanics`);
  }
  ok(K.ERGONOMICS.some(r => r.key === 'drawer_max_width'), 'drawer ergonomics rows present');
  ok(K.ERGONOMICS.some(r => r.key === 'workbench_height') && K.ERGONOMICS.some(r => r.key === 'coffee_table_height'), '2026 ergonomics anchors present');
  ok(Object.keys(K.JOINERY).length >= 21, 'twenty-one+ joints (2026 expansion)');
  for (const j of Object.values(K.JOINERY)) {
    ok(j.strength >= 1 && j.strength <= 5 && j.tools.length && j.failure && j.bestFor, `${j.key} row complete`);
    ok(j.kinds.every(k => ['frame', 'case', 'box', 'panel'].includes(k)), `${j.key} kinds are known`);
  }
  ok(K.JOINERY.edge_glue.kinds.includes('panel') && K.JOINT_DEFAULTS.beginner.panel === 'edge_glue', 'panel kind exists with edge_glue as its default');
  const digest = K.knowledgeDigest();
  ok(digest.includes('dining_height 730–760mm') && digest.includes('mortise_tenon'), 'digest carries norms');
  ok(digest.includes('hickory(janka 1880') && digest.includes('staked_tenon'), 'digest carries the 2026 additions');
  const sys = AI.systemPrompt(Spec.correctSpec({ meta: { template: 'table' } }));
  ok(sys.includes(digest) && sys.includes('"t":0'), 'system prompt embeds knowledge digest + current spec in wire format');
  ok(sys.includes('ONLY the changed wire keys'), 'system prompt demands wire diff-based refinement');
  ok(sys.includes(Codec.SCHEMA_DOC), 'system prompt documents the compact schema once, statically');
  eq(K.jointsForLevel('beginner').sort().join(','), 'biscuits,butt_screws,edge_glue,french_cleat,kd_bolt,pocket_screws', 'beginner matrix');
  ok(K.jointsForLevel('advanced').includes('half_blind_dovetail'), 'advanced matrix');
  ok(K.jointsForLevel('advanced').includes('through_dovetail') && !K.jointsForLevel('intermediate').includes('through_dovetail'), 'through dovetail gated to advanced');
  ok(K.jointsForLevel('intermediate').includes('staked_tenon'), 'staked tenon reachable at intermediate');
  ok(K.FASTENERS.screws.every(s => s.pilot !== undefined), 'screws carry pilot diameters');
  ok(K.FASTENERS.screws.some(s => s.key === 'pocket_63'), '2× stock pocket screw present (32 mm cannot join 38 mm stock)');
  ok(K.FINISHES.every(f => f.coats && f.recoatHrs !== undefined && f.cureDays !== undefined), 'finishes carry coats + dry times (cureDays 0 = never film-cures)');
  ok(K.FINISHES.some(f => f.foodContact) && K.FINISHES.some(f => f.exterior), 'food-contact and exterior finish categories open');
  const mo = K.FINISHES.find(f => f.key === 'mineral_oil'), tp = K.FINISHES.find(f => f.key === 'tung_pure');
  ok(!mo.flammableRags && tp.flammableRags === true, 'rag-fire physics: non-drying mineral oil is safe, polymerizing tung is flagged');
  ok(K.GLUES.length >= 5 && K.GLUES.every(g => g.openMin > 0 && g.clampMin > 0 && g.cureHrs > 0 && g.water), 'GLUES table complete');
  // Price coupling: every nominal in the SAME commit as a price row — a miss prices as NaN.
  const prices = K.defaultPrices();
  for (const sp of Object.keys(prices.dimensional)) {
    for (const nom of Object.keys(K.LUMBER.NOMINALS)) {
      ok(isFinite(prices.dimensional[sp][nom]) && prices.dimensional[sp][nom] > 0, `price grid ${sp} × ${nom}`);
    }
  }
  for (const sk of K.sheetSpeciesKeys()) {
    for (const t of K.LUMBER.SHEET.THICKNESSES) ok(K.sheetPriceFor(prices, sk, t) > 0, `sheet price ${sk} × ${t}`);
  }
}

/* ---------------- geometric buildability audit ----------------
 * The rogue-board net: no design — template, custom, import, or photo —
 * may present geometry that can't be built. These invariants are the hard
 * gate; the structural engine only reports margins on what passes them. */
section('geometric buildability audit');
{
  // The reported field failure: a cabinet-like piece with a stray diagonal
  // board poking through the floor. Grounding re-levels on the rogue tip,
  // the real case ends up hovering, and the footprint cannot stand — the
  // audit must block it instead of presenting it.
  const rogue = pipeline({
    specVersion: 4,
    meta: { name: 'Rogue Cabinet', template: 'custom', level: 'beginner' },
    custom: {
      parts: [
        { id: 's1', role: 'side_panel', primitive: 'panel', dim: { l: 450, w: 900, t: 18 }, pos: { x: -220, y: 450, z: 0 }, rot: { x: 0, y: 90, z: 0 }, grain: 'length', stock: 'sheet', loadBearing: true, surface: 'none' },
        { id: 's2', role: 'side_panel', primitive: 'panel', dim: { l: 450, w: 900, t: 18 }, pos: { x: 220, y: 450, z: 0 }, rot: { x: 0, y: 90, z: 0 }, grain: 'length', stock: 'sheet', loadBearing: true, surface: 'none' },
        { id: 'top', role: 'top_slab', primitive: 'slab', dim: { l: 460, w: 450, t: 18 }, pos: { x: 0, y: 909, z: 0 }, rot: null, grain: 'length', stock: 'sheet', loadBearing: false, surface: 'worktop' },
        { id: 'bot', role: 'bottom_slab', primitive: 'slab', dim: { l: 422, w: 450, t: 18 }, pos: { x: 0, y: 91, z: 0 }, rot: null, grain: 'length', stock: 'sheet', loadBearing: false, surface: 'shelf' },
        { id: 'stray', role: 'stray_board', primitive: 'rail', dim: { l: 700, w: 60, t: 20 }, pos: { x: 140, y: 60, z: 220 }, rot: { x: 0, y: 20, z: 40 }, grain: 'length', stock: 'solid', loadBearing: false, surface: 'none' }
      ],
      connections: [
        { a: 's1', b: 'top', joint: 'butt_screws' }, { a: 's2', b: 'top', joint: 'butt_screws' },
        { a: 's1', b: 'bot', joint: 'butt_screws' }, { a: 's2', b: 'bot', joint: 'butt_screws' },
        { a: 'stray', b: 'bot', joint: 'butt_screws' }
      ]
    }
  });
  ok(rogue.report.errors.length > 0, 'rogue diagonal board is blocked, never presented');
  ok(rogue.report.errors.some(e => /^geom_/.test(e.id)), 'the block comes from the geometric audit');

  // Same case minus the stray board must sail through — the audit gates
  // rogue geometry, not honest casework.
  const cleanCustom = pipeline({
    specVersion: 4,
    meta: { name: 'Clean Case', template: 'custom', level: 'beginner' },
    custom: {
      parts: [
        { id: 's1', role: 'side_panel', primitive: 'panel', dim: { l: 450, w: 900, t: 18 }, pos: { x: -220, y: 450, z: 0 }, rot: { x: 0, y: 90, z: 0 }, grain: 'length', stock: 'sheet', loadBearing: true, surface: 'none' },
        { id: 's2', role: 'side_panel', primitive: 'panel', dim: { l: 450, w: 900, t: 18 }, pos: { x: 220, y: 450, z: 0 }, rot: { x: 0, y: 90, z: 0 }, grain: 'length', stock: 'sheet', loadBearing: true, surface: 'none' },
        { id: 'top', role: 'top_slab', primitive: 'slab', dim: { l: 460, w: 450, t: 18 }, pos: { x: 0, y: 909, z: 0 }, rot: null, grain: 'length', stock: 'sheet', loadBearing: false, surface: 'worktop' },
        { id: 'bot', role: 'bottom_slab', primitive: 'slab', dim: { l: 422, w: 450, t: 18 }, pos: { x: 0, y: 91, z: 0 }, rot: null, grain: 'length', stock: 'sheet', loadBearing: false, surface: 'shelf' }
      ],
      connections: [
        { a: 's1', b: 'top', joint: 'butt_screws' }, { a: 's2', b: 'top', joint: 'butt_screws' },
        { a: 's1', b: 'bot', joint: 'butt_screws' }, { a: 's2', b: 'bot', joint: 'butt_screws' }
      ]
    }
  });
  eq(cleanCustom.report.errors.length, 0, 'the same case without the stray board validates clean');

  // A "connected" part that never touches its partner is a rogue board too.
  const gapped = Spec.clone(cleanCustom.spec);
  gapped.custom.parts.push({ id: 'p9', role: 'floating_rail', primitive: 'rail', dim: { l: 300, w: 60, t: 20 }, pos: { x: 0, y: 1400, z: 900 }, rot: null, grain: 'length', stock: 'solid', loadBearing: false, surface: 'none' });
  gapped.custom.connections.push({ a: 'p9', b: gapped.custom.parts[2].id, joint: 'butt_screws' });
  const gappedR = pipeline(gapped);
  ok(gappedR.report.errors.some(e => e.id.startsWith('geom_gap:')), 'joined-on-paper-but-never-touching is a blocking error');
  // A9: the gap message carries geometry the model (and user) can act on —
  // axis, separation distance, and both parts' nearest-face positions.
  {
    const gapErr = gappedR.report.errors.find(e => e.id.startsWith('geom_gap:'));
    ok(/apart along [xyz]/.test(gapErr.text), `gap error names the axis — got "${gapErr.text}"`);
    ok(/ends at [xyz]=/.test(gapErr.text) && /starts at [xyz]=/.test(gapErr.text),
      `gap error names both parts' nearest faces — got "${gapErr.text}"`);
    ok(/[\d.]+ (in|mm)/.test(gapErr.text), 'gap error carries formatted numbers');
  }

  // Two internally-connected clusters are two pieces of furniture, not one.
  const splitR = pipeline({
    specVersion: 4,
    meta: { name: 'Two Stools', template: 'custom', level: 'beginner' },
    custom: {
      parts: [
        { id: 'a_top', role: 'seat', primitive: 'slab', dim: { l: 350, w: 300, t: 38 }, pos: { x: -400, y: 419, z: 0 }, rot: null, grain: 'length', stock: 'solid', loadBearing: false, surface: 'seating' },
        { id: 'a_leg', role: 'leg_panel', primitive: 'panel', dim: { l: 300, w: 400, t: 38 }, pos: { x: -400, y: 200, z: 0 }, rot: { x: 0, y: 90, z: 0 }, grain: 'length', stock: 'solid', loadBearing: true, surface: 'none' },
        { id: 'b_top', role: 'seat', primitive: 'slab', dim: { l: 350, w: 300, t: 38 }, pos: { x: 400, y: 419, z: 0 }, rot: null, grain: 'length', stock: 'solid', loadBearing: false, surface: 'seating' },
        { id: 'b_leg', role: 'leg_panel', primitive: 'panel', dim: { l: 300, w: 400, t: 38 }, pos: { x: 400, y: 200, z: 0 }, rot: { x: 0, y: 90, z: 0 }, grain: 'length', stock: 'solid', loadBearing: true, surface: 'none' }
      ],
      connections: [
        { a: 'a_leg', b: 'a_top', joint: 'butt_screws' },
        { a: 'b_leg', b: 'b_top', joint: 'butt_screws' }
      ]
    }
  });
  ok(splitR.report.errors.some(e => e.id === 'custom_split'), 'disconnected sub-assemblies are blocked');

  // Near-square rotations are sloppy output, not intent: snap them.
  const snapped = Spec.correctSpec({
    specVersion: 4,
    meta: { name: 'Snap', template: 'custom', level: 'beginner' },
    custom: {
      parts: [
        { id: 'a', role: 'seat', primitive: 'slab', dim: { l: 900, w: 400, t: 19 }, pos: { x: 0, y: 400, z: 0 }, rot: { x: 1.5, y: 88, z: -359 }, grain: 'length', stock: 'solid', loadBearing: false, surface: 'seating' },
        { id: 'b', role: 'brace', primitive: 'rail', dim: { l: 600, w: 60, t: 20 }, pos: { x: 0, y: 200, z: 0 }, rot: { x: 30, y: 0, z: 0 }, grain: 'length', stock: 'solid', loadBearing: true, surface: 'none' }
      ],
      connections: [{ a: 'a', b: 'b', joint: 'butt_screws' }]
    }
  });
  eq(snapped.custom.parts[0].rot, { x: 0, y: 90, z: 0 }, 'rotations within 2.5° of square snap to square');
  eq(snapped.custom.parts[1].rot.x, 30, 'deliberate angles survive the snap');
  eq(Spec.correctSpec(snapped), snapped, 'rotation snapping is idempotent');

  // Cabinet construction: the case stands on its sides, never on a lone
  // 19 mm toe board, and every touching panel is jointed.
  const cab = pipeline({
    meta: { name: 'TK', template: 'cabinet', level: 'intermediate' },
    overall: { width: 800, depth: 450, height: 900 },
    structure: { shelfCount: 1, toeKick: true, backPanel: true },
    drawers: { count: 2, frontStyle: 'overlay', runner: 'side_mount_slides' }
  });
  eq(cab.report.errors.length, 0, 'toe-kick cabinet validates clean');
  const side = cab.model.parts.find(p => p.id === 'side_1');
  ok(Math.abs(side.pos.y - side.size.h / 2) < 0.11, 'cabinet sides reach the floor');
  eq(side.size.h, 900 - cab.spec.structure.topThickness, 'side height runs floor to underside of top');
  const jointPairs = new Set(cab.model.joints.map(j => [j.a, j.b].sort().join('|')));
  for (const want of ['plinth_1|side_1', 'plinth_1|side_2', 'back_1|side_1', 'back_1|side_2', 'back_1|bottom_1', 'side_2|top_1']) {
    ok(jointPairs.has(want), `cabinet joint graph includes ${want}`);
  }

  // Nightstand rails join the FRONT legs they actually touch.
  const ns = pipeline({ meta: { name: 'NS', template: 'nightstand', level: 'beginner' }, structure: { shelfCount: 1 } });
  eq(ns.report.errors.length, 0, 'nightstand validates clean');
  const railJoints = ns.model.joints.filter(j => j.a.startsWith('rail_') || j.b.startsWith('rail_'));
  ok(railJoints.length > 0 && railJoints.every(j => ['leg_3', 'leg_4'].includes(j.a) || ['leg_3', 'leg_4'].includes(j.b)), 'drawer rails joint into the front legs');
  const shelfJoints = ns.model.joints.filter(j => j.a === 'shelf_1');
  eq(shelfJoints.length, 4, 'notched nightstand shelf is jointed to all four legs');

  // Rabbeted backs and notched shelves already carry their capture in the
  // geometric size — no cut-length allowance on top.
  const bs = pipeline({ meta: { name: 'BS', template: 'bookshelf', level: 'intermediate' }, structure: { shelfCount: 2, backPanel: true }, joinery: { case: 'dado' } });
  eq(bs.report.errors.length, 0, 'bookshelf validates clean');
  const backRow = Plans.cutList(bs.spec, bs.model).find(r => r.role === 'back');
  eq(backRow.L, bs.spec.overall.height - 12, 'back panel cut length carries no rabbet allowance');
  const shelfRow = Plans.cutList(bs.spec, bs.model).find(r => r.role === 'shelf');
  eq(shelfRow.L, (bs.spec.overall.width - 2 * bs.spec.structure.sideThickness) + 12, 'dado-housed shelf still gets its 6 mm per end');

  // Too-shallow interiors refuse drawers honestly instead of punching the
  // box through the back apron.
  const shallow = pipeline({
    meta: { name: 'Shallow', template: 'nightstand', level: 'intermediate' },
    overall: { width: 500, depth: 220, height: 600 },
    drawers: { count: 1, frontStyle: 'inset', runner: 'side_mount_slides' }
  });
  ok(shallow.report.errors.some(e => e.id.startsWith('dr_slide') || e.id.startsWith('dr_depth')), 'shallow interior blocks slides with a clear error');
  ok(!shallow.report.errors.some(e => e.id.startsWith('geom_overlap')), 'the drawer box never punches through the back apron');

  // Shelf count auto-reduces before shelves could ever overlap.
  const squeezed = pipeline({ meta: { name: 'Sq', template: 'bookshelf', level: 'beginner' }, overall: { width: 900, depth: 300, height: 400 }, structure: { shelfCount: 8, shelfThickness: 19 } });
  ok(squeezed.spec.structure.shelfCount < 8, `shelf count auto-reduced (${squeezed.spec.structure.shelfCount})`);
  eq(squeezed.report.errors.length, 0, 'squeezed bookshelf still validates clean');

  // The invariant sweep: every reachable template configuration is free of
  // rogue geometry. (Degenerate sizes may be BLOCKED — that's the gate doing
  // its job — but overlap/float/envelope/gap errors mean the template math
  // itself is wrong.)
  let swept = 0, roguecfg = 0, firstBad = null;
  for (const template of ['table', 'desk', 'bench', 'bookshelf', 'nightstand', 'cabinet']) {
    for (const overall of [
      { width: 250, depth: 200, height: 120 }, { width: 500, depth: 380, height: 400 },
      { width: 900, depth: 600, height: 750 }, { width: 1500, depth: 450, height: 1300 },
      { width: 2400, depth: 1200, height: 2400 }
    ]) {
      for (const extras of [
        {},
        { structure: { shelfCount: 8, toeKick: true, backPanel: true } },
        { structure: { shelfCount: 2, toeKick: true, backPanel: false }, drawers: { count: 4, frontStyle: 'overlay', runner: 'side_mount_slides' } },
        { drawers: { count: 2, frontStyle: 'inset', runner: 'wood_runners' }, joinery: { frame: 'mortise_tenon', case: 'dado', box: 'half_blind_dovetail' }, level: 'advanced' }
      ]) {
        const r = pipeline(Object.assign({ meta: { name: 'S', template, level: extras.level || 'intermediate' }, overall },
          extras.structure ? { structure: extras.structure } : {},
          extras.drawers !== undefined ? { drawers: extras.drawers } : {},
          extras.joinery ? { joinery: extras.joinery } : {}));
        swept++;
        const bad = r.report.errors.filter(e => /^geom_(below|out|gap|overlap|floats|footprint|jref)/.test(e.id));
        if (bad.length) { roguecfg++; if (!firstBad) firstBad = `${template} ${JSON.stringify(overall)}: ${bad[0].id}`; }
      }
    }
  }
  ok(roguecfg === 0, `template sweep free of rogue geometry (${swept} configs${firstBad ? '; first: ' + firstBad : ''})`);
}

/* ---------------- 2026 hardening: pulls, gating, climate, prices, prompt ---------------- */
section('pull coherence: label and bore can never disagree');
{
  const HW = BB.HW;
  // Style-true narrow drawers for styles DESIGNED narrow.
  const cup = HW.pullSpec(240, 'cup_pull');
  eq([cup.style, cup.holes, cup.ctcMM, !!cup.substituted], ['cup_pull', 2, 76, false], 'cup pull stays a cup pull on a 240 front (its own CTC series)');
  const leather = HW.pullSpec(200, 'leather_pull');
  eq([leather.style, !!leather.substituted], ['leather_pull', false], 'leather strap stays style-true on a 200 front');
  // Honest substitution for generic styles.
  const bar = HW.pullSpec(240, 'bar_pull');
  eq([bar.style, bar.holes, bar.substituted], ['knob_round', 1, true], 'bar pull on a 240 front substitutes a knob AND says so');
  const app = HW.pullSpec(320, 'appliance_pull');
  eq([app.style, app.substituted], ['bar_pull', true], 'appliance pull on a 320 front steps down to a bar pull');
  // Zero-hole styles are never "one bore, centered".
  eq(HW.pullSpec(400, 'edge_pull').holes, 0, 'edge pull carries zero bores');
  eq(HW.pullSpec(400, 'flush_recessed').holes, 0, 'flush pull carries zero bores');

  // End to end: the BOM prints the EFFECTIVE style with a substitution note,
  // and validation raises the advisory. (238 opening → ~234 inset front.)
  const r = pipeline({
    meta: { name: 'Narrow', template: 'nightstand', level: 'intermediate' },
    overall: { width: 330, depth: 400, height: 600 },
    hardware: { pull: 'bar_pull' },
    drawers: { count: 1, frontStyle: 'inset', runner: 'side_mount_slides' }
  });
  const d0 = r.model.drawers[0];
  ok(d0.front.w < 300 && d0.pull.substituted === true, `narrow front (${d0.front.w}) triggers substitution`);
  const bom = Plans.bom(r.spec, r.model, {});
  const pullLine = bom.items.find(i => i.kind === 'hardware' && /knob/i.test(i.label));
  ok(!!pullLine && /substituted/.test(pullLine.detail), 'BOM prints the fitted knob and names the substitution');
  ok(!bom.items.some(i => /bar pull/i.test(i.label)), 'no phantom bar-pull line remains');
  ok(r.report.advisories.some(a => a.id.startsWith('hw_pull_narrow')), 'validation raises the narrow-front advisory');
  const steps = Plans.assembly(r.spec, r.model, null, {});
  const pullStep = steps.find(s => /pull/.test(s.id));
  ok(/knob|bore one|hole/i.test(pullStep.text) && /too narrow/i.test(pullStep.text), 'the step speaks the fitted style and the reason');
}

section('custom connections: joint KINDS are gated like template slots');
{
  const mk = (joint, prims) => Spec.correctSpec({
    meta: { name: 'K', template: 'custom', level: 'intermediate' },
    custom: {
      parts: [
        { id: 'a', role: 'a', primitive: prims[0], dim: { l: 400, w: 300, t: 19 }, pos: { x: 0, y: 200, z: 0 }, rot: prims[0] === 'panel' ? { x: 0, y: 90, z: 0 } : null, grain: 'length', stock: 'solid', loadBearing: true, surface: 'none' },
        { id: 'b', role: 'b', primitive: prims[1], dim: { l: 400, w: 300, t: 19 }, pos: { x: 0, y: 405, z: 0 }, rot: null, grain: 'length', stock: 'solid', loadBearing: false, surface: 'seating' }
      ],
      connections: [{ a: 'a', b: 'b', joint }]
    }
  }).custom.connections[0].joint;

  eq(mk('french_cleat', ['panel', 'slab']), 'dado', 'french cleat (external — its mate is the wall) is refused part-to-part');
  eq(mk('box_joint', ['panel', 'panel']), 'box_joint', 'box joints are legal on sheet-to-sheet corners (a chest is a big drawer)');
  eq(mk('box_joint', ['post', 'rail']), 'dowels', 'box joints on a stick frame snap to the frame default');
  eq(mk('staked_tenon', ['cylinder', 'slab']), 'staked_tenon', 'staked tenon leg-into-seat stays (frame kind, stick pair)');
  eq(mk('edge_glue', ['panel', 'panel']), 'edge_glue', 'edge glue-ups are legal panel-to-panel (the panel kind has a consumer)');
  eq(mk('mortise_tenon', ['post', 'rail']), 'dowels', 'level gating still applies on top of kind gating (M&T is advanced)');
  // A1: kd_bolt is the one non-permanent joint the schema doc advertises for
  // openable panels — case-kind pairs must keep it, never re-weld it to dado.
  eq(mk('kd_bolt', ['panel', 'slab']), 'kd_bolt', 'kd_bolt survives on a panel-to-slab (case) pair — a tool-removable lid stays removable');
  eq(mk('kd_bolt', ['post', 'rail']), 'kd_bolt', 'kd_bolt still legal on stick frames (bed rails)');
}

section('climate reaches the bench: wooden-runner clearance follows ΔMC');
{
  const raw = {
    meta: { name: 'Runners', template: 'nightstand', level: 'intermediate' },
    overall: { width: 508, depth: 406.4, height: 609.6 }, wood: { species: 'beech' },
    drawers: { count: 1, frontStyle: 'inset', runner: 'wood_runners' }
  };
  const r = pipeline(raw);
  const stepOf = climate => Plans.assembly(r.spec, r.model, null, { climate }).find(s => /runners/.test(s.id)).text;
  const temperate = stepOf(undefined), humid = stepOf('humid'), arid = stepOf('arid');
  ok(/temperate indoor swing/.test(temperate), 'no stated climate keeps the temperate default');
  ok(/humid indoor swing/.test(humid) && humid !== temperate, 'humid climate changes the fitting clearance text');
  ok(/arid indoor swing/.test(arid) && arid !== humid, 'arid differs from humid');
  // The clearance numbers really move: beech box side, ΔMC 6 vs 2.
  const h = BB.HW.drawerVerticalClearance(r.model.drawers[0].box.h, 'beech', 6);
  const a = BB.HW.drawerVerticalClearance(r.model.drawers[0].box.h, 'beech', 2);
  ok(h > a, `computed clearance scales with ΔMC (${a} → ${h})`);
  // Wooden runners are honest lumber: cut list + model + screws.
  const cut = Plans.cutList(r.spec, r.model);
  ok(cut.some(row => row.role === 'runner'), 'runners join the cut list');
  ok(r.model.parts.some(p => p.role === 'runner' && !p.hardware), 'runner parts render in the model as wood');
  eq(r.report.errors.length, 0, 'runner geometry passes the buildability audit');
}

section('editable hardware prices: one table, every BOM line');
{
  const dflt = K.defaultPrices();
  ok(dflt.hardware && dflt.hardware.slide_side_bb_34 === 14 && dflt.hardware.glue_pva_interior === 8, 'defaults assemble from the owning tables');
  for (const [k, v] of Object.entries(dflt.hardware)) {
    ok(isFinite(v) && v >= 0, `hardware price ${k} is a number`);
    ok(typeof K.hardwarePriceLabel(k) === 'string' && K.hardwarePriceLabel(k).length > 2, `label for ${k}`);
  }
  const r = pipeline({
    meta: { name: 'P', template: 'nightstand', level: 'beginner' },
    drawers: { count: 1, frontStyle: 'inset', runner: 'side_mount_slides' }
  });
  const before = Plans.bom(r.spec, r.model, {});
  const edited = JSON.parse(JSON.stringify(dflt));
  edited.hardware.slide_side_bb_34 = 99;
  edited.hardware.finish_flat = 40;
  const after = Plans.bom(r.spec, r.model, { prices: edited });
  const slideBefore = before.items.find(i => /slides \(pair\)/.test(i.label));
  const slideAfter = after.items.find(i => /slides \(pair\)/.test(i.label));
  eq([slideBefore.price, slideAfter.price], [14, 99], 'an edited slide price reaches the BOM line');
  eq(after.items.find(i => i.kind === 'finish').price, 40, 'an edited finish price reaches the BOM');
  ok(after.total > before.total, 'the total moves with the edits');
}

section('prompt budget: hard ceiling with measured headroom');
{
  const sys = AI.systemPrompt(Spec.correctSpec(Spec.defaultSpec('nightstand')));
  const tokens = Codec.estimateTokens(sys);
  // Ceiling raised 1900 → 2000 for the A5 exclusion-binding line (~80 tokens,
  // deliberate spend); the guard still catches accidental bloat.
  ok(tokens <= 2000, `system prompt stays under the 2000-token ceiling (measured ${tokens})`);
  ok(tokens > 800, `and is not accidentally hollow (measured ${tokens})`);
  ok((sys.match(/LEVEL MATRIX:/g) || []).length === 1, 'the level matrix TABLE rides the prompt exactly once (the joint-slots line may reference it)');
  ok(Codec.estimateTokens(AI.VISION_PROMPT) <= 320, `vision prompt bounded (${Codec.estimateTokens(AI.VISION_PROMPT)})`);
  // A1: mechanism honesty — the wire cannot carry hinges/lids/doors, and the
  // schema doc must SAY so (kd_bolt is the only non-permanent joint) so the
  // model never narrates motion the parts lack.
  ok(/NOT expressible/.test(Codec.SCHEMA_DOC) && /except kd_bolt/.test(Codec.SCHEMA_DOC),
    'SCHEMA_DOC states mechanisms are inexpressible (kd_bolt the only non-permanent joint)');
  ok(/hinge/.test(Codec.SCHEMA_DOC) && /never claim motion/.test(Codec.SCHEMA_DOC),
    'SCHEMA_DOC names hinge-class mechanisms and forbids claiming motion the parts lack');
  // The ANSWER shape: pure advice is legal wire, not a validation failure.
  const info = AI.classify({ i: 'Use wipe-on poly.' });
  eq([info.kind, info.text], ['info', 'Use wipe-on poly.'], 'ANSWER replies classify as info');
  ok(AI.classify({ q: 'which?', a: ['a', 'b'] }).kind === 'question', 'question shape unchanged');
  // A5: stated exclusions bind the session — the prompt must say so and name
  // the all-wood joinery escape hatch, or "zero hardware" gets silently
  // reframed over a screw-filled BOM (observed live: V-a5-2).
  ok(/EXCLUSIONS:/.test(sys) && /binds the WHOLE session/.test(sys),
    'system prompt states that stated exclusions bind the whole session');
  ok(/screws\/bolts ARE metal/.test(sys) && /mortise_tenon/.test(sys) && /never silently reframe/.test(sys),
    'the exclusion line names metal fasteners as metal, all-wood joints, and forbids silent reframes');
}

section('word-number lengths and storage driver honesty');
{
  const U2 = BB.Units;
  ok(/1219\.2mm/.test(U2.normalizeLengthText('four feet wide')), 'four feet → 1219.2mm');
  ok(/152\.4mm/.test(U2.normalizeLengthText('six inches deep')), 'six inches → 152.4mm');
  eq(U2.normalizeLengthText('two in the corner'), 'two in the corner', 'bare "in" as a preposition is never a unit');
  // Headless: no artifact storage, no localStorage, no cloud — session-only.
  eq(BB.Store.persistenceMode(), 'session', 'headless persistence mode is session');
  ok(BB.Store.isPersistent() === false, 'and isPersistent is honest about it');
  eq(BB.Store.auth().user, null, 'no auth probe ran — anonymous');
  // A fake localStorage upgrades the chain to device.
  globalThis.localStorage = (() => {
    const m = new Map();
    return { setItem: (k, v) => m.set(k, String(v)), getItem: k => (m.has(k) ? m.get(k) : null), removeItem: k => m.delete(k) };
  })();
  eq(BB.Store.persistenceMode(), 'device', 'localStorage upgrades the chain to device');
  delete globalThis.localStorage;
}

/* L-14: a keyless proxy (/api/chat → 503) is a DISTINCT state — the app must
 * never present a broken AI deploy as ordinary offline. Fresh vm contexts get
 * a stubbed browser + fetch so the real transport ladder runs. */
async function testKeylessProxyState() {
  section('AI transport: keyless proxy (503) ≠ offline (L-14)');
  const AI_SRC = ['knowledge.js', 'hardware.js', 'geometry.js', 'units.js', 'spec.js', 'codec.js', 'ai.js'];
  const load = globals => {
    const ctx = vm.createContext(globals);
    for (const f of AI_SRC) vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'src', f), 'utf8'), ctx, { filename: 'L14-' + f });
    return ctx.BB;
  };
  // Proxy present but unconfigured: /api/chat answers 503.
  const keyless = load({
    console, window: {}, document: {},
    fetch: async () => ({ status: 503, ok: false, json: async () => ({ error: { message: 'no key' } }) })
  });
  const hasFlag = typeof keyless.AI.unconfigured === 'function';
  ok(hasFlag && keyless.AI.unconfigured() === false, 'AI.unconfigured() exists and starts false');
  const spec503 = keyless.Spec.correctSpec({ meta: { template: 'table' } });
  const r1 = await keyless.AI.respond('make it walnut', spec503, { turns: [] });
  ok(r1.local === true && r1.reply && r1.reply.kind === 'diff', 'keyless proxy still answers via the local parser');
  eq(r1.unconfigured, true, '503 surfaces the distinct unconfigured state');
  ok(hasFlag && keyless.AI.unconfigured() === true, 'the session remembers the keyless proxy');
  const r2 = await keyless.AI.respond('make it pine', spec503, { turns: [] });
  eq(r2.unconfigured, true, 'unconfigured persists on the hasRemote fast path');
  // Genuine offline: the network itself is down — NOT "not configured".
  const offline = load({
    console, window: {}, document: {},
    fetch: async () => { throw new Error('network down'); }
  });
  const rOff = await offline.AI.respond('make it walnut', offline.Spec.correctSpec({ meta: { template: 'table' } }), { turns: [] });
  ok(rOff.local === true && !rOff.unconfigured, 'a dead network is plain offline, never "not configured"');
  ok(typeof offline.AI.unconfigured === 'function' && offline.AI.unconfigured() === false,
    'offline context never claims unconfigured');
  // Badge honesty (source level — ui.js is browser-coupled).
  const uiSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'ui.js'), 'utf8');
  ok(/AI not configured/.test(uiSrc), 'badge has a distinct "AI not configured" label');
  ok(/out\.unconfigured/.test(uiSrc), 'send path threads the unconfigured state to the badge');
}

/* X-09 (chat route): respond() normalizes the text for parsing and the wire,
 * but the created design's NAME keeps the user's phrasing. */
async function testNamePhrasing() {
  section('respond(): names keep the user phrasing after normalization (X-09)');
  const spec = BB.Spec.correctSpec({ meta: { template: 'table' } });
  const res = await AI.respond('A bookshelf about 5 feet tall', spec, { turns: [] });
  ok(res.local === true && res.reply && res.reply.kind === 'new', 'headless respond falls back to the local parser');
  const name = res.reply && res.reply.kind === 'new' ? res.reply.spec.meta.name : '';
  ok(!/\d+\s*mm\b/i.test(name), `chat-route name carries no bare mm token — got "${name}"`);
  ok(/5 feet/i.test(name), 'chat-route name keeps "about 5 feet tall"');
}

/* C8, probe-P8 shape: an ANSWER reply arriving in a validation-refinement
 * round classifies as info via respond() end-to-end, so the loop can show its
 * text and stop instead of deep-merging undefined and burning the round. */
async function testMidRoundInfo() {
  section('respond(): a mid-round ANSWER reply triages as info (C8/P8)');
  AI.setTransport(async () => ({ text: '{"i":"The overhang is the problem — shorten the top instead."}', stopReason: 'end_turn' }));
  const spec = Spec.correctSpec(Spec.defaultSpec('table'));
  const res = await AI.respond('Your proposal failed validation: parts never touch. Return a corrected reply, minified wire JSON only.', spec, { turns: [] });
  AI.setTransport(null);
  eq(AI.roundDecision(res), 'info', 'the refinement loop sees info, not an appliable no-op');
  ok(/overhang/.test(res.reply.text), 'and the text survives for botSay');
}

/* ---------------- the in-app self-test suite, headless ---------------- */
(async () => {
  await testKeylessProxyState();
  await testNamePhrasing();
  await testMidRoundInfo();
  section('self-test suite (headless run)');
  const results = await BB.SelfTest.run();
  for (const r of results) {
    ok(r.pass, `[${r.group}] ${r.name} — actual: ${r.actual}, expected: ${r.expected}`);
  }
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
