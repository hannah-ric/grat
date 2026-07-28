/* Blueprint Buddy — live behavior battery (audit Phase 2A, permanent asset).
 * Exercises the real engine (not mocks) on representative, boundary,
 * contradictory, mixed-unit, and adversarial fixtures — and ASSERTS on each
 * (2026: this used to be a report that always exited 0; now it is a suite
 * that can fail). It still prints what the product actually produces.
 * Run: node test/battery.js [--json out.json]
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRC = ['knowledge.js', 'hardware.js', 'icons.js', 'materials.js', 'geometry.js', 'units.js', 'classes.js', 'spec.js', 'parametric.js', 'structural.js', 'fasteners.js', 'packing.js',
  'plans.js', 'drafting.js', 'gltf.js', 'exports.js', 'history.js', 'codec.js', 'ai.js', 'store.js', 'gallery.js', 'joinery3d.js', 'selftest.js'];
for (const f of SRC) {
  vm.runInThisContext(fs.readFileSync(path.join(__dirname, '..', 'src', f), 'utf8'), { filename: f });
}
const BB = globalThis.BB;
const { Spec, Parametric, Plans, AI, K, Codec, Structural, Packing, Units } = BB;

let checks = 0, fails = 0;
function ok(cond, name, detail) {
  checks++;
  if (!cond) { fails++; console.log(`   ✗ ASSERT ${name}${detail !== undefined ? ` — got ${JSON.stringify(detail)}` : ''}`); }
}

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
    ok(r.report.errors.length === 0, 'nightstand builds clean', r.report.errors);
    ok(ig.summary.fails === 0, 'walnut nightstand passes integrity', ig.summary);
    const d0 = r.model.drawers[0];
    ok(Math.abs(d0.box.w - (d0.opening.w - K.SLIDE_SPACE_MM)) < 0.11, 'box width = opening − 25.4 (12.7 per side)', d0.box.w);
    ok(K.SLIDE_LENGTHS.includes(d0.slideLen), 'slide length from the catalog', d0.slideLen);
    ok(r.model.parts.filter(p => p.hardware).length === 4, 'slide pair per drawer renders in the model', r.model.parts.filter(p => p.hardware).length);
    ok(cut.every(c => c.role !== 'slide'), 'metal slides never reach the cut list');
    ok(bom.total > 0 && plan.totalCost > 0, 'BOM and stock both price', [bom.total, plan.totalCost]);
    const steps = Plans.assembly(r.spec, r.model, ig, { stockPlan: plan });
    ok(steps.some(s => /^glueup/.test(s.id)), 'panel glue-ups from the stock plan are real steps');
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
    ok(r.report.errors.length === 0, 'bookshelf builds clean', r.report.errors);
    // The honest-fail physics: 36 in of 3/4 ash under books + creep sags.
    ok(ig.summary.fails >= 1 && ig.checks.some(c => c.id.startsWith('sag:') && c.status === 'fail'),
      '19 mm ash shelves honestly FAIL under books + creep', ig.summary);
    ok(ig.antiTip === true, 'a 72 in case demands the wall anchor', ig.antiTip);
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
    ok(r.report.errors.length === 0, 'advanced cabinet builds clean', r.report.errors);
    ok(rails.length > 0 && rails.every(c => /mortise/i.test(c.note)), 'M&T rails carry tenon allowances in their notes', rails.map(c => c.note));
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
    ok(r.spec.overall.width === 2400, 'width clamps to the 2400 ceiling', r.spec.overall.width);
    ok(r.report.errors.length === 0, 'clamped design still builds', r.report.errors);
  }
  {
    const r = pipeline({ meta: { name: '150 table', template: 'table', level: 'beginner', units: 'mm' }, overall: { width: 600, depth: 400, height: 150 } });
    const ig = integ(r);
    summarize('boundary: 150mm-tall table', r, ig, { legH: r.model.parts.find(p => p.role === 'leg').size.h, apronH: r.spec.structure.apronHeight });
    ok(r.report.errors.length === 0, '150 mm table builds without geometric errors', r.report.errors);
    ok(r.model.parts.find(p => p.role === 'leg').size.h > 0, 'legs stay positive');
    ok(r.spec.structure.apronHeight <= r.spec.overall.height, 'apron fits under the top');
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
    ok(r.spec.drawers.count < 4, 'drawer count auto-reduces at this height', r.spec.drawers.count);
    ok(r.model.openings.every(o => o.h >= 80), 'every surviving opening clears the 80 mm minimum', r.model.openings.map(o => o.h));
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
    ok(r.spec.custom.parts.length === 40, 'the 40-part cap holds exactly', r.spec.custom.parts.length);
    ok(ms < 5000, 'full pipeline on the max composition stays interactive', ms + 'ms');
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
    // The honest number: 19 mm pine under the heavy preset lands at 99.99%
    // of its L/300 sag limit — a knife-edge, and the engine must SAY so
    // (≥90% of limit), never flatter it into comfortable headroom.
    const worst = ig.summary && ig.summary.worstSag;
    ok(worst && worst.sag > 0.9 * worst.limit, 'worst sag reported at ≥90% of the limit — no flattery', worst);
    ok(ig.summary.fails + ig.summary.advisories >= 2, 'the contradiction surfaces as failures or advisories', ig.summary);
  }

  /* ---------- mixed units & messy language ---------- */
  {
    const text = 'about four feet wide, 30in tall, 550 mm deep';
    const norm = Units.normalizeLengthText(text);
    const base = Spec.correctSpec({ meta: { template: 'table', units: 'in' } });
    const reply = AI.localModel('make it ' + text, base);
    out.cases.push({ name: 'mixed units text', normalized: norm, replyKind: reply.kind, patch: reply.patch || null });
    console.log(`\n■ mixed units: "${text}"\n   normalized: "${norm}"\n   local parse: ${JSON.stringify(reply.patch || reply)}`);
    ok(reply.kind === 'diff', 'messy mixed-unit text parses to a diff', reply.kind);
    ok(reply.patch && reply.patch.overall && Math.abs(reply.patch.overall.width - 1219.2) < 0.1, 'four feet → 1219.2 mm', reply.patch && reply.patch.overall);
    ok(reply.patch && Math.abs(reply.patch.overall.height - 762) < 0.1, '30 in → 762 mm', reply.patch && reply.patch.overall);
    ok(reply.patch && Math.abs(reply.patch.overall.depth - 550) < 0.1, '550 mm stays 550 mm', reply.patch && reply.patch.overall);
  }

  /* ---------- offline parser: the possessive, the two fallbacks, the workbench,
   * the discarded noun (audit X-01 / X-04 / X-06 / X-08) ----------
   * AI chat sits behind sign-in, so for anonymous visitors, static hosts, and
   * offline sessions this parser IS the product's designer. Its edges are a
   * first impression, and these fixtures are the lock on them. */
  {
    const table = Spec.correctSpec({ meta: { name: 'Seed Table', template: 'table', level: 'beginner', units: 'in' } });
    const rows = [];
    const say = (text, spec) => {
      const r = AI.localModel(text, spec || table, {});
      rows.push({
        text, kind: r.kind,
        detail: r.kind === 'new' ? `${r.spec.meta.template} “${r.spec.meta.name}” / ${r.spec.wood.species}`
          : r.kind === 'question' ? r.question
            : JSON.stringify(r.patch)
      });
      return r;
    };
    const EDIT_ASK = /didn’t catch a change/;

    /* X-01 — a possessive attached to a ROOM, a PERSON, or a PURPOSE describes
     * the piece being asked for; it never points back at the bench. All three
     * of these dead-ended before, and the nightstand was the worst: it turned
     * the CURRENT TABLE walnut instead of building a nightstand. */
    const office = say('a desk for my office');
    ok(office.kind === 'new' && office.spec.meta.template === 'desk',
      '"a desk for my office" builds a desk', office.kind === 'new' ? office.spec.meta.template : office);
    ok(office.kind === 'new' && /office/i.test(office.spec.meta.name), 'and the user\'s own words name it', office.kind === 'new' && office.spec.meta.name);
    const bedroom = say('walnut nightstand for my bedroom');
    ok(bedroom.kind === 'new' && bedroom.spec.meta.template === 'nightstand' && bedroom.spec.wood.species === 'walnut',
      '"walnut nightstand for my bedroom" builds a walnut NIGHTSTAND — never a walnut table',
      bedroom.kind === 'new' ? bedroom.spec.meta.template : bedroom.kind);
    const kids = say('bookshelf for my kids room');
    ok(kids.kind === 'new' && kids.spec.meta.template === 'bookshelf',
      '"bookshelf for my kids room" builds a bookshelf', kids.kind === 'new' ? kids.spec.meta.template : kids.kind);
    for (const p of ["my daughter's desk", 'my daughter’s desk']) {
      const d = say(p);
      ok(d.kind === 'new' && d.spec.meta.template === 'desk',
        `a possessive PERSON still names a new piece (${p})`, d.kind === 'new' ? d.spec.meta.template : d.kind);
    }
    // The guard this replaced still catches every genuine back-reference — and
    // it never could swallow these: they carry no template noun to build from.
    const taller = say('make it taller');
    ok(taller.kind === 'diff' && taller.patch.overall && taller.patch.overall.height > table.overall.height,
      '"make it taller" stays a refinement of the piece on the bench', taller.kind);
    const walnut = say('make it walnut');
    ok(walnut.kind === 'diff' && walnut.patch.wood.species === 'walnut' && !walnut.patch.meta,
      '"make it walnut" stays a refinement, template untouched', walnut.patch);
    const thisOne = say('this one in walnut');
    ok(thisOne.kind === 'diff' && thisOne.patch.wood.species === 'walnut',
      '"this one in walnut" stays a refinement', thisOne.kind);
    const thisNs = say('this nightstand in walnut');
    ok(thisNs.kind === 'diff', 'a demonstrative on a PIECE noun is still a back-reference, never a build', thisNs.kind);

    /* X-04 — a first-turn design intent must never receive the edit-phrased
     * answer. Every unmatched ask that reads like a piece routes to the honest
     * capability list, with the nearest expressible option as a chip. */
    const outOfScope = {};
    for (const ask of ['something for my entryway', 'a sofa']) {
      const r = outOfScope[ask] = say(ask);
      ok(r.kind === 'question' && !EDIT_ASK.test(r.question), `"${ask}" never gets the edit-phrased answer`, r.question);
      ok(r.kind === 'question' && /rough out/.test(r.question), `"${ask}" gets the honest capability list`, r.question);
      // Every chip must be a phrase this parser can actually build — an
      // option that does not create is the same broken promise as the copy.
      for (const chip of r.options || []) {
        ok(AI.localModel(chip, table, {}).kind === 'new', `"${ask}" chip "${chip}" really builds`, AI.localModel(chip, table, {}).kind);
      }
    }
    /* Bed class (2026-07): "bed frame" graduated from the out-of-scope list
     * to a real platform-bed build. The shapes no sound plan can honor keep
     * refusals that outrank creation, each with its regulation named. */
    const bed = say('bed frame');
    ok(bed.kind === 'new' && bed.spec.meta.template === 'bed', 'a bed frame ask now builds the bed class', bed.kind);
    const kingBed = say('a king bed with no headboard');
    ok(kingBed.kind === 'new' && kingBed.spec.bed.size === 'king' && kingBed.spec.bed.headboardHeight === 0,
      'size words and "no headboard" are carried into the spec', kingBed.kind === 'new' && JSON.stringify(kingBed.spec.bed));
    const bunk = say('build me a bunk bed');
    ok(bunk.kind === 'info' && /F1427/.test(bunk.text), 'bunk beds are refused with ASTM F1427 named', bunk.kind + ': ' + (bunk.text || ''));
    const crib = say('a crib for the nursery');
    ok(crib.kind === 'info' && /16 CFR/.test(crib.text), 'cribs are refused permanently with 16 CFR 1219/1220 named', crib.kind + ': ' + (crib.text || ''));
    const murphy = say('a murphy bed');
    ok(murphy.kind === 'info' && /mechanism/i.test(murphy.text), 'murphy beds are refused on the mechanism', murphy.kind + ': ' + (murphy.text || ''));
    /* Wall-mounted class (2026-07): floating shelves graduated from the
     * out-of-scope list. A shelf with no wall named is ASKED for the
     * substrate (the class refusal), the chips parse straight back in, and
     * drywall-only is refused with the creep reason. */
    const ws = say('floating wall shelf');
    ok(ws.kind === 'question' && /substrate|behind the finish/i.test(ws.question),
      'a wall shelf with no wall named asks for the substrate', ws.kind + ': ' + (ws.question || ''));
    for (const chip of ws.options || []) {
      const r = AI.localModel(chip, table, {});
      ok(r.kind === 'new', `wall-shelf chip "${chip}" really builds`, r.kind);
    }
    const wsStud = say('a floating shelf on wood studs');
    ok(wsStud.kind === 'new' && wsStud.spec.meta.template === 'wall_shelf' && wsStud.spec.wall.substrate === 'stud',
      'naming the studs builds the shelf with the substrate carried', wsStud.kind);
    const wsDry = say('a floating shelf on drywall');
    ok(wsDry.kind === 'info' && /creep|ultimate/i.test(wsDry.text || ''),
      'drywall-only is refused with the reason', wsDry.kind);

    /* Children's scope class (2026-07): a kid-worded ask CREATES with the
     * EN 1729 band carried and told; regulated children's products are
     * refused with the regulation NAMED, before creation can trigger. */
    const nsBench = Spec.correctSpec({ meta: { name: 'NS', template: 'nightstand', level: 'beginner', units: 'in' } });
    const kidTable = say('a table for my toddler', nsBench);
    ok(kidTable.kind === 'new' && kidTable.spec.meta.template === 'table' &&
      kidTable.spec.child && kidTable.spec.child.ageBand === 'toddler',
      '"a table for my toddler" creates a child-scoped table on the toddler band',
      kidTable.kind === 'new' ? JSON.stringify(kidTable.spec.child) : kidTable.kind);
    const kidCor = kidTable.kind === 'new' ? Spec.correctSpec(kidTable.spec) : null;
    ok(kidCor && kidCor.overall.height === 460,
      'and correction pins the EN 1729 mark 1 table height (460)', kidCor && kidCor.overall.height);
    ok(/EN 1729/.test(kidTable.explain || '') && /adult design loads/.test(kidTable.explain || ''),
      'the ack names the band source and the kept adult loads — TOLD, not silent', kidTable.explain);
    // Same-template phrasing stays a refinement (X-08 doctrine) — and still
    // carries the band onto the piece on the bench.
    const kidRefine = say('a table for my toddler');
    ok(kidRefine.kind === 'diff' && kidRefine.patch.child && kidRefine.patch.child.ageBand === 'toddler',
      'on a table bench the toddler ask refines the bench piece into child scope', JSON.stringify(kidRefine.patch || kidRefine));
    const toyBox = say('a toy box with a lid');
    ok(toyBox.kind === 'info' && /F834/.test(toyBox.text) && /16 CFR 1250/.test(toyBox.text),
      'a toy box with a lid is REFUSED with ASTM F834 (now F963 / 16 CFR 1250) named', toyBox.kind + ': ' + (toyBox.text || '').slice(0, 90));
    const highChair = say('a high chair');
    ok(highChair.kind === 'info' && /16 CFR 1231/.test(highChair.text),
      'a high chair is refused with 16 CFR 1231 named', highChair.kind);
    const kidsDesk = say('kids desk');
    ok(kidsDesk.kind === 'question' && /age|old/i.test(kidsDesk.question),
      'a bare "kids desk" ASKS the age — the band is the geometry', kidsDesk.kind + ': ' + (kidsDesk.question || ''));
    for (const chip of kidsDesk.options || []) {
      const r = AI.localModel(chip, nsBench, {});
      ok(r.kind === 'new' && r.spec.child, `kids-desk chip "${chip}" really builds child-scoped`, r.kind);
    }
    ok(/\bchair\b/i.test((outOfScope['a sofa'].options || [])[0]),
      'a sofa offers the chair — the seating it does build now', outOfScope['a sofa'].options);

    /* Seating class (2026-07): chairs and stools graduated from the
     * out-of-scope list to a real engineering profile. The parser CREATES
     * them, couples stools to their counters, and REFUSES the class's
     * stated refusal shapes with the reason — never a silent approximation. */
    const chAsk = say('a chair');
    ok(chAsk.kind === 'new' && chAsk.spec.meta.template === 'chair' && chAsk.spec.seat.backHeight > 0,
      '"a chair" builds a chair (seating class)', chAsk.kind);
    ok(/rear-tilt/.test(chAsk.explain || ''), 'the chair ack names the class joinery mandate', chAsk.explain);
    const stAsk = say('a stool');
    ok(stAsk.kind === 'new' && stAsk.spec.seat.backHeight === 0,
      '"a stool" builds a backless stool', stAsk.kind);
    ok(/counter or bar/i.test(stAsk.explain || ''),
      'a bare stool ASKS for the counter it serves', stAsk.explain);
    const barAsk = say('a bar stool');
    const barCor = barAsk.kind === 'new' ? Spec.correctSpec(barAsk.spec) : null;
    ok(barCor && barCor.seat.counterHeight === 1060 &&
      Math.abs(barCor.seat.height - (1060 - 270)) <= 1,
      'a bar stool derives its seat height from bar height (post-correction)', barCor && JSON.stringify(barCor.seat));
    const uph = say('an upholstered dining chair');
    ok(uph.kind === 'info' && /upholster/i.test(uph.text) && /refus|can’t model|worse than/i.test(uph.text),
      'upholstery is refused with the stated reason', uph.kind + ': ' + (uph.text || '').slice(0, 80));
    const arm = say('build me an armchair');
    ok(arm.kind === 'info' && /arm/i.test(arm.text || ''),
      'arms are refused with the stated reason', arm.kind);
    const rocker = say('a rocking chair');
    ok(rocker.kind === 'info' && /rock/i.test(rocker.text || ''),
      'rockers are refused with the stated reason', rocker.kind);
    const edit = say('make it fancier');
    ok(edit.kind === 'question' && EDIT_ASK.test(edit.question),
      'a genuine edit attempt that did not parse keeps the edit-phrased answer', edit.question);

    /* X-06 — "workbench" is served, not advertised. The word buys the height
     * and nothing else: correction caps a top at 45 mm, so a laminated bench
     * top is not on the menu and no copy may imply it is. */
    const wb = say('workbench');
    ok(wb.kind === 'new' && wb.spec.meta.template === 'table', 'a workbench ask is still served — with the table it can genuinely build', wb.kind);
    const ergoWb = K.ergoRow('workbench_height');
    ok(wb.kind === 'new' && wb.spec.overall.height >= ergoWb.min && wb.spec.overall.height <= ergoWb.max,
      'at working height, from the ergonomics table', wb.kind === 'new' && wb.spec.overall.height);
    ok(/work table/.test(wb.explain) && /not a laminated/.test(wb.explain),
      'the ack says plainly what it is and what it is not', wb.explain);
    ok(!/out a workbench/.test(wb.explain), 'the ack never calls the result a workbench', wb.explain);
    const capability = outOfScope['a sofa'].question;
    ok(!/(?:^|[\s,])workbench(?:[\s,.]|$)/.test(capability.replace('at workbench height', '')),
      'the capability list never names a workbench as a piece it produces', capability);
    ok(/work table at workbench height/.test(capability), 'it names the honest thing instead', capability);
    for (const ask of ['bed frame', 'a chair', 'workbench 1200mm wide', 'something for my entryway']) {
      const r = AI.localModel(ask, table, {});
      ok(!(r.options || []).some(o => /workbench/i.test(o)), `no chip offers "a workbench" (${ask})`, r.options);
    }
    const wr = pipeline(wb.spec);
    const wig = integ(wr);
    summarize('offline X-06: "workbench" → the work table it can genuinely make', wr, wig, { explain: wb.explain, name: wr.spec.meta.name });
    ok(wr.report.errors.length === 0, 'the served work table builds clean', wr.report.errors);

    /* X-08 — a refinement that NAMES the piece renames it. "dining table 8
     * feet long" resized the seed table correctly and left it "Seed Table". */
    const dining = say('dining table 8 feet long');
    ok(dining.kind === 'diff' && dining.patch.overall && Math.abs(dining.patch.overall.width - 2438.4) < 0.1,
      '"8 feet long" still patches width', dining.patch);
    ok(dining.kind === 'diff' && dining.patch.meta && /dining table/i.test(dining.patch.meta.name),
      'and the noun the user typed becomes the name', dining.patch.meta);
    ok(dining.kind === 'diff' && !/\d+\s*mm\b/i.test(dining.patch.meta.name),
      'the name keeps the user\'s words, never the pre-normalized mm token (X-09)', dining.patch.meta);
    const renamed = AI.apply(dining, table);
    ok(/dining/i.test(renamed.spec.meta.name), 'the rename survives correction end to end', renamed.spec.meta.name);
    ok(/renamed/.test(dining.explain), 'the rename is acked, never silent', dining.explain);
    const bsSpec = Spec.correctSpec({ meta: { name: 'Floor Bookshelf', template: 'bookshelf', level: 'beginner', units: 'in' } });
    const mention = say('make the bookshelf about 1524mm tall', bsSpec);
    ok(mention.kind === 'diff' && !(mention.patch.meta && mention.patch.meta.name),
      'an EDIT that merely mentions the piece never renames it', mention.patch);

    /* Regression-locked guards that must survive all of the above. */
    const noAsh = say('no ash please', Spec.correctSpec({ meta: { template: 'nightstand', level: 'intermediate', units: 'in' } }));
    ok(noAsh.kind === 'question' && /not\s+(white\s+)?ash/i.test(noAsh.question) && !(noAsh.patch && noAsh.patch.wood),
      'the negation guard still asks which wood — it never switches TO ash', noAsh);
    const smug = say('two drawers like a cabinet has');
    ok(smug.kind !== 'new', 'drawer smuggling still never creates the cabinet', smug.kind);
    const hero = say('A walnut nightstand with two drawers');
    ok(hero.kind === 'new' && hero.spec.meta.template === 'nightstand' && hero.spec.drawers.count === 2,
      'the hero placeholder still builds its 2-drawer walnut nightstand', hero.kind);

    out.cases.push({ name: 'offline parser edges (X-01/04/06/08)', rows });
    console.log('\n■ offline parser edges (X-01/04/06/08):');
    for (const r of rows) console.log(`   ${JSON.stringify(r.text)} → ${r.kind}: ${r.detail}`);
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
    ok(['frame', 'case', 'box'].every(k => K.jointAllowed(smuggle.spec.joinery[k], 'beginner', k)),
      'smuggled advanced joints snap to beginner-legal picks', smuggle.spec.joinery);
    ok(absurd.spec.overall.width <= 2400 && absurd.spec.overall.height >= 120, 'absurd dimensions clamp to the envelope', absurd.spec.overall);
    ok(bomb.spec.custom && bomb.spec.custom.parts.length <= 40, 'the 500-part bomb truncates to the cap', bomb.spec.custom && bomb.spec.custom.parts.length);
  }

  /* ---------- custom-grammar partial diffs stay surgical (A4) ---------- */
  {
    const cbase = Spec.correctSpec(Spec.deepMerge(Spec.defaultSpec('custom'), { meta: { level: 'intermediate' } }));
    // p-only diff (material/dimension edit): the connection graph must survive.
    const wireP = Codec.encode(cbase).p.map(a => a.slice());
    wireP.forEach(a => { a[11] = 1; }); // STK 1 = sheet, an all-parts material flip
    const pRes = AI.apply(AI.classify(AI.extractJSON(JSON.stringify({ p: wireP, e: 'ply' }))), cbase);
    const pR = pipeline(pRes.spec);
    out.cases.push({ name: 'custom p-only diff', conns: pRes.spec.custom.connections.length, errors: pR.report.errors.map(e => e.id) });
    console.log(`\n■ custom p-only diff: connections kept=${pRes.spec.custom.connections.length}, errors=${pR.report.errors.length}`);
    ok(pRes.spec.custom.connections.length === 2, 'p-only diff commits with the connection graph intact', pRes.spec.custom.connections);
    ok(!pR.report.errors.some(e => e.id.startsWith('float_')), 'no "appears in no connection" errors from a material edit', pR.report.errors);
    // c-only diff (joint upgrade): decodes and changes the corrected joints.
    const cRes = AI.apply(AI.classify(AI.extractJSON('{"c":[[1,0,3],[2,0,3]],"e":"dado the legs in"}')), cbase);
    out.cases.push({ name: 'custom c-only diff', joints: cRes.spec.custom.connections.map(c => c.joint) });
    console.log(`■ custom c-only diff: joints=${cRes.spec.custom.connections.map(c => c.joint).join(',')}`);
    ok(cRes.spec.custom.connections.length === 2 && cRes.spec.custom.connections.every(c => c.joint === 'dado'),
      'c-only joint upgrade decodes, applies, and changes the corrected joints', cRes.spec.custom.connections);
    ok(cRes.spec.custom.parts.length === 3, 'c-only diff leaves the parts untouched', cRes.spec.custom.parts.length);
  }

  /* ---------- rejected proposals leave a marker in the conversation (B9) ---------- */
  {
    const base = Spec.correctSpec(Spec.defaultSpec('table'));
    // The model proposes an unbuildable custom piece (two jointed parts that
    // never touch). PRIM slab=3, rail=1; part = [PRIM,x,y,z,l,w,t,rx,ry,rz,GRAIN,STK,LB,SURF,role].
    const badWire = {
      N: {
        v: 4, n: 'Bad', t: 6, l: 0, u: 1, o: [600, 300, 500], m: 3, s: {}, j: [1, 0, 1], f: 0, d: 0,
        p: [[3, 0, 250, 0, 600, 300, 19, 0, 0, 0, 0, 0, 1, 2, 'top'],
          [1, 0, 480, 900, 400, 60, 20, 0, 0, 0, 0, 0, 0, 0, 'rail']],
        c: [[0, 1, 2]]
      }, e: 'floating rail'
    };
    AI.setTransport(async () => ({ text: JSON.stringify(badWire), stopReason: 'end_turn' }));
    const res = await AI.respond('add a floating rail', base, { turns: [] });
    const applied = AI.apply(res.reply, base);
    const r = pipeline(applied.spec);
    ok(r.report.errors.length > 0, 'B9 fixture really is unbuildable', r.report.errors.map(e => e.id));
    // The app's unbuildable path (ui.js aiPipeline / harness runner): the
    // rejected exchange stays in the turns, followed by the code-built marker.
    const kept = res.turns.concat(AI.rejectionMarker(r.report.errors)).slice(-24);
    let seen = null;
    AI.setTransport(async (system, messages) => { seen = messages; return { text: '{"e":"ok"}', stopReason: 'end_turn' }; });
    await AI.respond('make it walnut', base, { turns: kept });
    AI.setTransport(null);
    const marked = !!seen && seen.some(m => m.role === 'user' && /REJECTED/.test(m.content) && /UNCHANGED/.test(m.content));
    out.cases.push({ name: 'rejection marker', errors: r.report.errors.length, marked });
    console.log(`\n■ rejection marker (B9): unbuildable errors=${r.report.errors.length}, next-turn marker seen=${marked}`);
    ok(marked, 'the next turn\'s messages carry the rejection marker', seen && seen.map(m => m.role + ': ' + String(m.content).slice(0, 60)));
    ok(seen.some(m => m.role === 'assistant' && /floating rail/.test(String(m.content))),
      'the rejected reply itself is still in context (the marker explains it)');
    // A buildable turn never gains a marker — the marker is rejection-only.
    ok(!res.turns.some(m => /REJECTED/.test(String(m.content))), 'respond() itself never injects the marker');
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
    ok(same, 'share code round-trips to an identical corrected spec');
    ok(code.length < 700, 'share code stays compact', code.length);
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
    ok(calls === 3, 'exactly two continuations stitch the oversized reply', calls);
    ok(okParts, 'all 25 parts reassemble across the seams');
  }

  /* ---------- step walkthrough: the outgoing call carries the code-built plan (C10) ---------- */
  {
    const spec = Spec.correctSpec({
      meta: { name: 'Walk NS', template: 'nightstand', level: 'intermediate', units: 'in' },
      overall: { width: 508, depth: 406.4, height: 609.6 }, wood: { species: 'walnut' },
      drawers: { count: 2, frontStyle: 'inset', runner: 'side_mount_slides' }
    });
    const r = pipeline(spec);
    const ig = integ(r);
    const cut = Plans.cutList(r.spec, r.model);
    const stock = Packing.planStock(r.spec, r.model, cut, {});
    const steps = Plans.assembly(r.spec, r.model, ig, { stockPlan: stock });
    let seen = null;
    AI.setTransport(async (system, messages) => {
      seen = messages;
      return { text: '{"i":"Step 5 walkthrough."}', stopReason: 'end_turn' };
    });
    const res = await AI.respond('walk me through step 5', r.spec, { turns: [] });
    AI.setTransport(null);
    const block = seen && seen.map(m => String(m.content)).find(c => c.startsWith('[assembly]'));
    out.cases.push({ name: 'step walkthrough context', hasBlock: !!block, kind: res.reply && res.reply.kind });
    console.log(`\n■ step walkthrough (C10): [assembly] block sent=${!!block}`);
    ok(!!block, 'the outgoing messages carry the code-built [assembly] block', seen && seen.map(m => String(m.content).slice(0, 40)));
    ok(!!block && block.includes(`Step 5 = "${steps[4].title}"`), 'the block names the real step-5 title', block && block.slice(0, 200));
    ok(res.reply && res.reply.kind === 'info', 'the reply stays an ordinary info answer', res.reply && res.reply.kind);
  }

  /* ---------- ANSWER shape (2026): advice replies are legal wire ---------- */
  {
    AI.setTransport(async () => ({ text: '{"i":"Wipe-on poly: three thin coats, scuff at 320 between. The BOM already lists it."}', stopReason: 'end_turn' }));
    const base = Spec.correctSpec(Spec.defaultSpec('table'));
    const res = await AI.respond('what finish should I use?', base, { turns: [] });
    AI.setTransport(null);
    out.cases.push({ name: 'answer shape', kind: res.reply && res.reply.kind });
    console.log(`\n■ answer shape: kind=${res.reply && res.reply.kind}`);
    ok(res.reply && res.reply.kind === 'info' && /Wipe-on/.test(res.reply.text), 'a pure-advice reply parses as info, no spec change', res.reply);
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
    ok(r.spec.meta.template === 'cabinet' && r.spec.drawers && r.spec.drawers.count === 4, 'the vision wire lands as a 4-drawer cabinet', r.spec.drawers);
    ok(r.report.errors.length === 0, 'the photo estimate builds clean', r.report.errors);
    ok(ig.checks.some(c => c.id === 'tip_f2057'), 'a clothing-height drawer unit runs the F2057 scenario');
  }

  const jsonIdx = process.argv.indexOf('--json');
  if (jsonIdx > 0) fs.writeFileSync(process.argv[jsonIdx + 1], JSON.stringify(out, null, 2));
  console.log(`\nbattery complete — ${out.cases.length} cases, ${checks} assertions, ${fails} failed`);
  if (fails) process.exitCode = 1;
})().catch(e => { console.error('battery crashed:', e); process.exitCode = 1; });
