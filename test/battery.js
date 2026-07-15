/* Blueprint Buddy — live behavior battery (audit Phase 2A, permanent asset).
 * Exercises the real engine (not mocks) on representative, boundary,
 * contradictory, mixed-unit, and adversarial fixtures and prints what the
 * product actually produces. Run: node test/battery.js [--json out.json]
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRC = ['knowledge.js', 'geometry.js', 'units.js', 'spec.js', 'parametric.js', 'structural.js', 'fasteners.js', 'packing.js',
  'plans.js', 'exports.js', 'history.js', 'codec.js', 'ai.js', 'store.js', 'gallery.js', 'selftest.js'];
for (const f of SRC) {
  vm.runInThisContext(fs.readFileSync(path.join(__dirname, '..', 'src', f), 'utf8'), { filename: f });
}
const BB = globalThis.BB;
const { Spec, Parametric, Plans, AI, K, Codec, Structural, Packing, Units } = BB;

const out = { meta: { date: new Date().toISOString() }, cases: [] };
const pipeline = raw => {
  const spec = Spec.correctSpec(raw);
  const model = Parametric.build(spec);
  const report = Spec.validate(spec, model);
  return { spec, model, report };
};
const integ = (r, opts) => Structural.computeIntegrity(r.spec, r.model, opts || {});
const summarize = (name, r, ig, extra) => {
  const c = {
    name,
    template: r.spec.meta.template,
    overall: r.spec.overall,
    errors: r.report.errors.map(e => e.id + ': ' + e.text),
    advisories: r.report.advisories.map(a => a.id),
    parts: r.model.parts.length,
    checks: ig ? ig.checks.map(x => ({ id: x.id, status: x.status, value: x.value })) : null,
    fails: ig ? ig.summary.fails : null,
    antiTip: ig ? ig.antiTip : null
  };
  Object.assign(c, extra || {});
  out.cases.push(c);
  const fl = ig ? ` · integrity ${ig.summary.fails} fail / ${ig.summary.advisories} adv` : '';
  console.log(`\n■ ${name}: ${c.errors.length} errors${fl}`);
  for (const e of c.errors) console.log('   ERROR ' + e);
  if (ig) for (const ck of ig.checks) if (ck.status !== 'pass') console.log(`   ${ck.status.toUpperCase()} ${ck.id} — ${ck.value}`);
  return c;
};

(async () => {
  Units.set({ system: 'imperial', precision: 16, dual: false });

  /* ---------- representative ---------- */
  {
    const r = pipeline({
      meta: { name: 'Battery Nightstand', template: 'nightstand', level: 'intermediate', units: 'in' },
      overall: { width: 508, depth: 406.4, height: 609.6 }, wood: { species: 'walnut' },
      drawers: { count: 2, frontStyle: 'inset', runner: 'side_mount_slides' }, structure: { shelfCount: 1 }
    });
    const ig = integ(r);
    const cut = Plans.cutList(r.spec, r.model);
    const plan = Packing.planStock(r.spec, r.model, cut, {});
    const bom = Plans.bom(r.spec, r.model, { integrity: ig, stock: plan });
    summarize('representative: nightstand 20×16×24in walnut 2-drawer', r, ig, {
      cutRows: cut.map(c => `${c.qty}× ${c.name} ${c.L}×${c.W}×${c.T} ${c.note || ''}`),
      bomTotal: bom.total, stockCost: plan.totalCost, waste: [plan.wasteSolidPct, plan.wasteSheetPct],
      drawer0: r.model.drawers[0] && { box: r.model.drawers[0].box, slideLen: r.model.drawers[0].slideLen, front: r.model.drawers[0].front }
    });
  }
  {
    const r = pipeline({
      meta: { name: 'Battery Bookshelf', template: 'bookshelf', level: 'beginner', units: 'in' },
      overall: { width: 914.4, depth: 304.8, height: 1828.8 }, wood: { species: 'ash' },
      structure: { shelfCount: 4, sideThickness: 19, shelfThickness: 19, backPanel: true }
    });
    const ig = integ(r);
    summarize('representative: bookshelf 36×12×72in ash', r, ig, {
      sag: ig.checks.filter(c => c.id.startsWith('sag:')).map(c => c.value),
      tip: ig.tip
    });
  }
  {
    const r = pipeline({
      meta: { name: 'Battery Sideboard', template: 'cabinet', level: 'advanced', units: 'in' },
      overall: { width: 762, depth: 457.2, height: 914.4 }, wood: { species: 'white_oak' },
      structure: { topThickness: 25, shelfCount: 1, toeKick: true, backPanel: true },
      joinery: { frame: 'mortise_tenon', case: 'dado', box: 'half_blind_dovetail' },
      drawers: { count: 2, frontStyle: 'overlay', runner: 'side_mount_slides' }
    });
    const ig = integ(r);
    const cut = Plans.cutList(r.spec, r.model);
    const rails = cut.filter(c => /rail/i.test(c.name));
    summarize('representative: advanced cabinet w/ drawers (M&T rails!)', r, ig, {
      railRows: rails.map(c => `${c.qty}× ${c.name} L=${c.L} (${c.note}) — sideThickness=${r.spec.structure.sideThickness}`),
      sideT: r.spec.structure.sideThickness
    });
  }

  /* ---------- boundary ---------- */
  {
    const r = pipeline({
      meta: { name: '3000mm shelf ask', template: 'bookshelf', level: 'beginner', units: 'mm' },
      overall: { width: 3000, depth: 300, height: 900 }, wood: { species: 'pine' },
      structure: { shelfCount: 1, sideThickness: 18, shelfThickness: 19 }
    });
    const ig = integ(r);
    summarize('boundary: 3000mm-wide single-span shelf ask (clamps?)', r, ig, {
      clampedWidth: r.spec.overall.width,
      shelfSag: ig.checks.find(c => c.id === 'sag:shelf_1')
    });
  }
  {
    const r = pipeline({ meta: { name: '150 table', template: 'table', level: 'beginner', units: 'mm' }, overall: { width: 600, depth: 400, height: 150 } });
    const ig = integ(r);
    summarize('boundary: 150mm-tall table', r, ig, { legH: r.model.parts.find(p => p.role === 'leg').size.h, apronH: r.spec.structure.apronHeight });
  }
  {
    const r = pipeline({
      meta: { name: '4-drawer minimum', template: 'nightstand', level: 'intermediate', units: 'mm' },
      overall: { width: 500, depth: 400, height: 600 },
      drawers: { count: 4, frontStyle: 'inset', runner: 'side_mount_slides' }
    });
    summarize('boundary: 4-drawer bank at 600mm height (auto-reduce?)', r, integ(r), {
      finalCount: r.spec.drawers.count,
      openings: r.model.openings.map(o => Math.round(o.h * 10) / 10)
    });
  }
  {
    const novel = BB.SelfTest.bigComposition(); // 25 parts
    // inflate to the 40-part cap with braces
    for (let i = 26; i <= 40; i++) {
      novel.custom.parts.push({ id: 'p' + i, role: 'brace_' + i, primitive: 'rail', dim: { l: 660, w: 45, t: 19 }, pos: { x: 0, y: 40 + (i - 26) * 110, z: 180 * ((i % 2) ? 1 : -1) }, rot: null, grain: 'length', stock: 'solid', loadBearing: true, surface: 'none' });
      novel.custom.connections.push({ a: 'p' + i, b: 'p' + (1 + (i % 4)), joint: 'butt_screws' });
    }
    const t0 = Date.now();
    const r = pipeline(novel);
    const ig = integ(r);
    const cut = Plans.cutList(r.spec, r.model);
    const plan = Packing.planStock(r.spec, r.model, cut, {});
    const ms = Date.now() - t0;
    summarize('boundary: 40-part novel composition (max)', r, ig, { parts: r.spec.custom.parts.length, pipelineMs: ms, boards: plan.boards.length });
  }

  /* ---------- contradictory: delicate pine workbench that must hold an anvil ---------- */
  {
    const r = pipeline({
      meta: { name: 'Delicate Anvil Bench', template: 'table', level: 'beginner', units: 'in' },
      overall: { width: 1500, depth: 600, height: 900 },
      wood: { species: 'pine' }, structure: { topThickness: 19, legThickness: 45 }
    });
    // "must hold an anvil": heavy preset is the closest the engine offers (90kg/m + user leaning)
    const ig = integ(r, { loadChoices: { top_1: 'heavy' } });
    summarize('contradictory: delicate pine bench + heavy load', r, ig, {
      strength: ig.checks.find(c => c.id === 'str:top_1'),
      sagTop: ig.checks.find(c => c.id === 'sag:top_1'),
      joints: ig.checks.find(c => c.id === 'joints')
    });
  }

  /* ---------- mixed units & messy language ---------- */
  {
    const text = 'about four feet wide, 30in tall, 550 mm deep';
    const norm = Units.normalizeLengthText(text);
    const base = Spec.correctSpec({ meta: { template: 'table', units: 'in' } });
    const reply = AI.localModel('make it ' + text, base);
    out.cases.push({ name: 'mixed units text', normalized: norm, replyKind: reply.kind, patch: reply.patch || null });
    console.log(`\n■ mixed units: "${text}"\n   normalized: "${norm}"\n   local parse: ${JSON.stringify(reply.patch || reply)}`);
  }

  /* ---------- adversarial: code must enforce, not the model's manners ---------- */
  {
    // 1. Wire reply tries to smuggle advanced joints into a beginner design.
    const base = Spec.correctSpec({ meta: { template: 'nightstand', level: 'beginner', units: 'in' } });
    const smuggle = AI.apply(AI.classify(AI.extractJSON('{"j":{"f":6,"c":3,"b":7},"e":"pro joints"}')), base);
    // 2. Wire reply tries absurd dimensions.
    const absurd = AI.apply(AI.classify(AI.extractJSON('{"o":{"w":9000,"h":5},"e":"trust me"}')), base);
    // 3. Wire new-design tries a 500-part composition (cap 40).
    const parts = [];
    for (let i = 0; i < 500; i++) parts.push([0, 0, 100 + i, 0, 500, 45, 19, 0, 0, 0, 0, 0, 1, 0]);
    const bomb = AI.apply(AI.classify({ N: { v: 4, n: 'bomb', t: 6, l: 0, u: 0, o: [1, 1, 1], m: 0, s: {}, j: [0, 0, 0], f: 0, d: 0, p: parts, c: [[0, 1, 0]] } }), base);
    out.cases.push({
      name: 'adversarial',
      smuggledJoints: smuggle.spec.joinery,
      absurdDims: absurd.spec.overall,
      bombParts: bomb.spec.custom ? bomb.spec.custom.parts.length : 0
    });
    console.log('\n■ adversarial:');
    console.log('   beginner + wire {j:[M&T,dado,dovetail]} →', JSON.stringify(smuggle.spec.joinery), '(must be beginner-legal)');
    console.log('   wire {w:9000,h:5} →', JSON.stringify(absurd.spec.overall), '(must be clamped)');
    console.log('   500-part wire bomb → parts kept:', bomb.spec.custom ? bomb.spec.custom.parts.length : '(not custom)');
  }

  /* ---------- share-code round trip ---------- */
  {
    const r = pipeline({
      meta: { name: 'Share RT', template: 'cabinet', level: 'advanced', units: 'in' },
      overall: { width: 762, depth: 457.2, height: 914.4 }, wood: { species: 'white_oak' },
      structure: { shelfCount: 1, toeKick: true }, drawers: { count: 2, frontStyle: 'overlay', runner: 'side_mount_slides' },
      joinery: { frame: 'mortise_tenon', case: 'dado', box: 'half_blind_dovetail' }
    });
    const code = Codec.toShareCode(r.spec);
    const back = Codec.fromShareCode(code);
    const r2 = pipeline(back.spec);
    const same = JSON.stringify(r.spec) === JSON.stringify(r2.spec);
    out.cases.push({ name: 'share round trip', identical: same, codeLen: code.length });
    console.log(`\n■ share code round trip: identical=${same} (${code.length} chars)`);
  }

  /* ---------- continuation protocol under oversized composition ---------- */
  {
    const novel = Spec.correctSpec(BB.SelfTest.bigComposition());
    const full = JSON.stringify({ N: Codec.encode(novel), e: 'ladder rack' });
    const third = Math.ceil(full.length / 3);
    const chunks = [full.slice(0, third), full.slice(third, 2 * third), full.slice(2 * third)];
    let calls = 0;
    AI.setTransport(async () => {
      const i = Math.min(calls, 2); calls++;
      return { text: chunks[i], stopReason: i < 2 ? 'max_tokens' : 'end_turn' };
    });
    const res = await AI.respond('oversized', novel, { turns: [] });
    AI.setTransport(null);
    const okParts = res.reply && res.reply.kind === 'new' && res.reply.spec.custom.parts.length === 25;
    out.cases.push({ name: 'continuation', calls, okParts });
    console.log(`\n■ continuation protocol: ${calls} calls, 25 parts reassembled=${okParts}`);
  }

  /* ---------- photo path (simulated vision reply through the real pipeline) ---------- */
  {
    const wire = { N: { v: 4, n: 'Photo Dresser', t: 5, l: 0, u: 1, o: [900, 480, 1200], m: 2, s: { t: 25, c: 0, k: 1, b: 1 }, j: [1, 0, 1], f: 0, d: [4, 1, 0] }, e: 'A four-drawer dresser.' };
    AI.setTransport(async () => ({ text: JSON.stringify(wire), stopReason: 'end_turn' }));
    const base = Spec.correctSpec(Spec.defaultSpec('table'));
    const res = await AI.respond(AI.VISION_PROMPT, base, { turns: [], image: { mediaType: 'image/jpeg', base64: 'x' } });
    AI.setTransport(null);
    const applied = AI.apply(res.reply, base);
    const r = pipeline(applied.spec);
    const ig = integ(r);
    summarize('photo path: simulated 4-drawer dresser (1200mm tall, drawers)', r, ig, {
      tip: ig.tip, antiTip: ig.antiTip, drawerCount: r.spec.drawers ? r.spec.drawers.count : 0
    });
  }

  const jsonIdx = process.argv.indexOf('--json');
  if (jsonIdx > 0) fs.writeFileSync(process.argv[jsonIdx + 1], JSON.stringify(out, null, 2));
  console.log('\nbattery complete —', out.cases.length, 'cases');
})();
