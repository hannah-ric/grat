/* Blueprint Buddy — self-test harness (Phase 4 item 7).
 * Verification stops being an honor system: this assertion suite runs
 * IN-APP (diagnostics panel, long-press the logo) and headless under node
 * (test/unit.test.js). Every test reports actual-versus-expected on failure.
 * The panel stays in the product as a permanent regression net.
 */
var BB = globalThis.BB = globalThis.BB || {};

(function () {
  'use strict';

  /* Order-insensitive deep equality (key order is not part of the contract). */
  function deepEqual(a, b) {
    if (a === b) return true;
    if (typeof a !== typeof b) return false;
    if (a === null || b === null) return false;
    if (typeof a === 'number') return Math.abs(a - b) < 1e-9;
    if (Array.isArray(a)) {
      if (!Array.isArray(b) || a.length !== b.length) return false;
      return a.every((v, i) => deepEqual(v, b[i]));
    }
    if (typeof a === 'object') {
      const ka = Object.keys(a).filter(k => a[k] !== undefined);
      const kb = Object.keys(b).filter(k => b[k] !== undefined);
      if (ka.length !== kb.length) return false;
      return ka.every(k => deepEqual(a[k], b[k]));
    }
    return false;
  }
  function firstDiff(a, b, path) {
    path = path || '';
    if (deepEqual(a, b)) return null;
    if (a && b && typeof a === 'object' && typeof b === 'object' && !Array.isArray(a) === !Array.isArray(b)) {
      const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
      for (const k of keys) {
        const d = firstDiff(a[k], b[k], path + '.' + k);
        if (d) return d;
      }
    }
    return `${path || '(root)'}: ${JSON.stringify(a)} vs ${JSON.stringify(b)}`;
  }

  /* v3 fixture: a Phase 2/3-era stored spec — no specVersion, no custom. A
   * saved design must NEVER fail to open. */
  const V3_FIXTURE = {
    meta: { name: 'Heirloom Nightstand', template: 'nightstand', level: 'intermediate', units: 'in' },
    overall: { width: 500, depth: 400, height: 600 },
    wood: { species: 'walnut' },
    structure: { topThickness: 20, legThickness: 45, apronHeight: 80, apronThickness: 20, apronInset: 12, shelfCount: 1, shelfThickness: 19, sideThickness: 18, backPanel: true, toeKick: false },
    joinery: { frame: 'dowels', case: 'dado', box: 'locking_rabbet' },
    finish: 'hardwax_oil',
    drawers: { count: 2, frontStyle: 'inset', runner: 'side_mount_slides' }
  };

  /* A deliberately oversized novel composition: 25 primitives (4 posts + 21
   * shelf slabs), 42 connections. Exercises the codec compaction targets and
   * the continuation protocol. */
  function bigComposition() {
    const parts = [], conns = [];
    const postXZ = [[-330, -180], [330, -180], [-330, 180], [330, 180]];
    postXZ.forEach(([x, z], i) => {
      parts.push({ id: 'p' + (i + 1), role: 'post', primitive: 'post', dim: { l: 1660, w: 45, t: 45 }, pos: { x, y: 830, z }, rot: null, grain: 'length', stock: 'solid', loadBearing: true, surface: 'none' });
    });
    for (let i = 0; i < 21; i++) {
      const idx = 5 + i;
      parts.push({ id: 'p' + idx, role: 'shelf_slab', primitive: 'slab', dim: { l: 705, w: 405, t: 19 }, pos: { x: 0, y: 85 + i * 75, z: 0 }, rot: null, grain: 'length', stock: 'solid', loadBearing: false, surface: 'shelf' });
      conns.push({ a: 'p' + idx, b: 'p' + (1 + (i % 2) * 1), joint: 'dado' });
      conns.push({ a: 'p' + idx, b: 'p' + (4 - (i % 2)), joint: 'dado' });
    }
    return {
      specVersion: 4,
      meta: { name: 'Ladder Rack 25', template: 'custom', level: 'intermediate', units: 'mm' },
      overall: { width: 1, depth: 1, height: 1 }, // correction recomputes
      wood: { species: 'ash', sheetSpecies: 'baltic_birch' },
      structure: {}, joinery: {}, finish: 'wipe_poly', drawers: null,
      custom: { parts, connections: conns }
    };
  }

  async function run() {
    const { Spec, Parametric, Plans, Codec, Packing, Structural, AI, K, Store } = BB;
    const results = [];
    const test = (group, name, pass, actual, expected) => {
      results.push({ group, name, pass: !!pass, actual: String(actual), expected: String(expected) });
    };
    const pipeline = raw => {
      const spec = Spec.correctSpec(raw);
      const model = Parametric.build(spec);
      return { spec, model, report: Spec.validate(spec, model) };
    };

    /* ============ unit conversions (BB.Units — the ONE display boundary) ============ */
    {
      const Units = BB.Units;
      const IMP = { system: 'imperial', precision: 16, dual: false };

      const parseFrac = s => {
        const m = String(s).match(/^(?:(\d+)(?:\s+(\d+)\/(\d+))?|(\d+)\/(\d+)) in$/);
        if (!m) return null;
        const val = m[4] !== undefined ? (+m[4] / +m[5]) : (+m[1] + (m[2] !== undefined ? (+m[2] / +m[3]) : 0));
        return val * 25.4;
      };
      let worst = 0, worstMM = 0;
      for (let mm = 3; mm <= 2400; mm += 7.3) {
        const s = Units.fmtLength(mm, IMP);
        const back = parseFrac(s);
        if (back == null) { worst = 99; worstMM = mm; break; }
        const err = Math.abs(back - mm);
        if (err > worst) { worst = err; worstMM = mm; }
      }
      const tol = 25.4 / 32; // half a 1/16" tick
      test('units', 'mm → fractional inches → mm round-trips within 1/32 in', worst <= tol, `worst ${worst.toFixed(3)} mm at ${worstMM.toFixed(1)} mm`, `≤ ${tol.toFixed(3)} mm`);

      const gcd = (a, b) => b ? gcd(b, a % b) : a;
      let unreduced = null;
      for (let mm = 0.5; mm <= 1000; mm += 0.7) {
        const s = Units.fmtLength(mm, IMP);
        const m = s.match(/(\d+)\/(\d+)/);
        if (m && gcd(+m[1], +m[2]) !== 1) { unreduced = `${s} at ${mm} mm`; break; }
      }
      test('units', 'fraction reduction never emits an unreduced fraction', !unreduced, unreduced || 'all reduced', 'all reduced');

      // Fine values (sag, movement, kerf, reveals) are DECIMAL inches — never fractions.
      let badFine = null;
      for (const mm of [0.11, 0.5, 1, 2.8, 3, 7.9, 15, 28.6, 50]) {
        const s = Units.fmtSmall(mm, IMP);
        if (s.includes('/') || !/^\d+(\.\d+)? in$/.test(s)) { badFine = `${s} at ${mm} mm`; break; }
      }
      test('units', 'fine values format as decimal inches, never fractions', !badFine, badFine || 'all decimal', 'all decimal');
      test('units', 'known fine value: 2.8 mm → 0.11 in', Units.fmtSmall(2.8, IMP) === '0.11 in', Units.fmtSmall(2.8, IMP), '0.11 in');

      // Stock board lengths render in feet; sheets as feet × feet.
      test('units', 'board lengths format in feet (2438 mm → 8 ft)', Units.fmtBoardLength(2438, IMP) === '8 ft', Units.fmtBoardLength(2438, IMP), '8 ft');
      test('units', 'sheet goods format as 4 x 8 ft', Units.fmtSheet(1220, 2440, IMP) === '4 x 8 ft', Units.fmtSheet(1220, 2440, IMP), '4 x 8 ft');
      test('units', 'nominal lumber leads with the trade name in imperial',
        Units.fmtNominal('1x4', { t: 19, w: 89 }, 2438, IMP) === '1x4 x 8 ft (3/4 x 3 1/2 in)',
        Units.fmtNominal('1x4', { t: 19, w: 89 }, 2438, IMP), '1x4 x 8 ft (3/4 x 3 1/2 in)');
      test('units', 'nominal lumber leads with actual mm in metric',
        Units.fmtNominal('1x4', { t: 19, w: 89 }, 2438, { system: 'metric', dual: false }) === '19 x 89 x 2438 mm (1x4)',
        Units.fmtNominal('1x4', { t: 19, w: 89 }, 2438, { system: 'metric', dual: false }), '19 x 89 x 2438 mm (1x4)');

      // Slider round-trip: 29 1/2 in ↔ exactly 749.3 mm, no drift.
      const dom = Units.sliderDomain(120, 2400, 749.3, IMP);
      const ticks = Math.round(29.5 * 16);
      test('units', 'slider round-trip: 29 1/2 in → 749.3 mm → 29 1/2 in',
        dom.value === ticks && dom.toMM(ticks) === 749.3 && Units.fmtLength(dom.toMM(ticks), IMP) === '29 1/2 in',
        `${dom.value} ticks → ${dom.toMM(ticks)} mm → ${Units.fmtLength(dom.toMM(ticks), IMP)}`,
        `${ticks} ticks → 749.3 mm → 29 1/2 in`);

      // The forgiving parser: five input forms, one shared normalizer, any mode.
      const forms = [['29 1/2', 749.3], ['29.5"', 749.3], [`2' 5"`, 736.6], ['750mm', 750], ['75cm', 750]];
      const got = forms.map(([s]) => Units.parseLength(s));
      test('units', 'length parser handles 29 1/2 · 29.5" · 2\' 5" · 750mm · 75cm',
        forms.every(([s, want], i) => got[i] === want), got.join(', '), forms.map(f => f[1]).join(', '));
      test('units', 'chat pre-parse rewrites dimension strings to explicit mm',
        Units.normalizeLengthText('make it 29 1/2 wide and 610mm deep') === 'make it 749.3mm wide and 610mm deep',
        Units.normalizeLengthText('make it 29 1/2 wide and 610mm deep'), 'make it 749.3mm wide and 610mm deep');

      // A known advisory renders converted units in imperial mode.
      {
        const saved = Units.get();
        try {
          Units.set(IMP);
          const tall = pipeline({ meta: { name: 'Ergo Case', template: 'table' }, overall: { width: 1524, depth: 863.6, height: 820 } });
          const adv = tall.report.advisories.find(a => a.id === 'ergo_dining_height');
          test('units', 'ergonomic advisory converts its range in imperial mode',
            adv && adv.text.includes('28 3/4 in') && adv.text.includes('29 15/16 in') && !/\d\s?mm/.test(adv.text),
            adv ? adv.text.slice(0, 80) + '…' : 'no advisory', 'contains 28 3/4 in … 29 15/16 in, no mm');
        } finally { Units.set(saved); }
      }

      // Dual display renders both systems on an Integrity row and a Stock row.
      {
        const saved = Units.get();
        try {
          Units.set({ system: 'imperial', precision: 16, dual: true });
          const shelf = pipeline({
            meta: { name: 'Dual Case', template: 'bookshelf', level: 'beginner' },
            overall: { width: 914.4, depth: 304.8, height: 1828.8 },
            wood: { species: 'red_oak' }, structure: { shelfCount: 4, sideThickness: 19, shelfThickness: 19, backPanel: true }
          });
          const integ = Structural.computeIntegrity(shelf.spec, shelf.model, {});
          const sagCheck = integ.checks.find(c => c.id.startsWith('sag:'));
          test('units', 'dual display: Integrity sag row carries both systems',
            sagCheck && /in \(/.test(sagCheck.value) && / mm\)/.test(sagCheck.value),
            sagCheck ? sagCheck.value : 'no sag check', 'in (… mm) in the sag line');
          const cut = Plans.cutList(shelf.spec, shelf.model);
          const plan = Packing.planStock(shelf.spec, shelf.model, cut, {});
          const board = plan.shopping.find(s => s.kind === 'board');
          test('units', 'dual display: Stock shopping row carries both systems',
            board && / ft /.test(board.label + ' ') && / mm/.test(board.label),
            board ? board.label : 'no board row', 'trade name + ft + mm actuals');
        } finally { Units.set(saved); }
      }
    }

    /* ============ joinery allowances ============ */
    {
      // Hand-calc: table W=1500, overhang 35 → frame 1430; legT 70 → shoulder
      // span 1290; mortise & tenon adds 2 × 30 mm → cut length 1350.
      const { spec, model } = pipeline({
        meta: { name: 'MT Table', template: 'table', level: 'advanced' },
        overall: { width: 1500, depth: 850, height: 745 },
        joinery: { frame: 'mortise_tenon' }
      });
      void spec;
      const cut = Plans.cutList(Spec.correctSpec({ meta: { name: 'MT Table', template: 'table', level: 'advanced' }, overall: { width: 1500, depth: 850, height: 745 }, joinery: { frame: 'mortise_tenon' } }), model);
      const apron = cut.find(r => r.name === 'Long apron');
      test('joinery', 'mortise & tenon long apron cut length matches hand calculation', apron && apron.L === 1350, apron ? apron.L : 'missing', 1350);
      test('joinery', 'allowance metadata carried for provenance', apron && apron.allowance === 60 && apron.allowanceJoint === 'mortise_tenon', apron ? `${apron.allowance} / ${apron.allowanceJoint}` : 'missing', '60 / mortise_tenon');
    }

    /* ============ beam check (±1% vs hand calculation) ============ */
    {
      // Bookshelf 900×300×1800, sides 18 → span 864; shelf 280 × 19 section;
      // books preset 55 kg/m; red oak MOE 12.5 GPa.
      // Hand: I = 280·19³/12 = 160043.33; w = 0.53955 N/mm;
      //       sag = 5wL⁴/384EI = 1.9569 mm.
      const HAND_SAG = 1.9569415106555312;
      const cases = Structural.loadCasesFor('books', 864, 'ss');
      const { sag } = Structural.evalBeam(cases, 864, 12500, Structural.I_rect(280, 19));
      test('beam', 'shelf deflection matches hand calculation within 1%', Math.abs(sag - HAND_SAG) / HAND_SAG < 0.01, sag.toFixed(4) + ' mm', HAND_SAG.toFixed(4) + ' mm');

      const { spec, model } = pipeline({
        meta: { name: 'Beam Case', template: 'bookshelf', level: 'beginner' },
        overall: { width: 900, depth: 300, height: 1800 },
        wood: { species: 'red_oak' }, structure: { shelfCount: 4, sideThickness: 18, shelfThickness: 19, backPanel: true }
      });
      const integ = Structural.computeIntegrity(spec, model, {});
      const shelfSag = integ.checks.find(c => c.id === 'sag:shelf_1');
      // Raw numbers ride check.data — display text is unit-dependent and never parsed.
      const got = shelfSag && shelfSag.data && shelfSag.data.sagMM;
      test('beam', 'integrity panel reports the same computed sag', got && Math.abs(got - HAND_SAG) < 0.06, got && got.toFixed(4) + ' mm', HAND_SAG.toFixed(4) + ' mm');
    }

    /* ============ structural: movement / tipping / racking (fixed values) ============ */
    {
      const mv = K.movementMM(900, 'red_oak', 'tangential', 4);
      test('structural', 'movement formula: 900 mm red oak × 0.00369 × 4% = 13.284 mm', Math.abs(mv - 13.284) < 0.001, mv.toFixed(3), '13.284');

      const shelf = pipeline({
        meta: { name: 'Tip Case', template: 'bookshelf', level: 'beginner' },
        overall: { width: 900, depth: 300, height: 1800 },
        wood: { species: 'red_oak' }, structure: { shelfCount: 4, sideThickness: 18, shelfThickness: 19, backPanel: true }
      });
      const integ = Structural.computeIntegrity(shelf.spec, shelf.model, {});
      test('structural', 'tall bookshelf: height/depth ratio is exactly 6.0 and anchor is mandatory',
        integ.tip && Math.abs(integ.tip.ratio - 6) < 0.01 && integ.antiTip,
        integ.tip ? `ratio ${integ.tip.ratio.toFixed(2)}, antiTip ${integ.antiTip}` : 'no tip check', 'ratio 6.00, antiTip true');
      const tipCheck = integ.checks.find(c => c.id === 'tip');
      test('structural', 'loaded tipping angle is computed and bounded', tipCheck && integ.tip.angLoaded > 0 && integ.tip.angLoaded < 10, integ.tip && integ.tip.angLoaded.toFixed(1) + '°', '0–10° (top-heavy case)');

      const seed = pipeline({ meta: { name: 'Rack Case', template: 'table', level: 'beginner' } });
      const seedInteg = Structural.computeIntegrity(seed.spec, seed.model, {});
      // Hand calc: 8 pocket-screw frame joints × 3.0 + 2 top butt joints × 2.0,
      // × SG factor (red oak) × 1.2 apron multiplier → 42.
      test('structural', 'seed table racking score matches hand calculation (42)', seedInteg.racking.score === 42, seedInteg.racking.score, 42);

      const movementCheck = integ.checks.find(c => c.id.startsWith('move:side'));
      test('structural', 'movement advisory names a concrete fix', !movementCheck || movementCheck.status !== 'advisory' || /elongate|button|breadboard/i.test(movementCheck.explain), movementCheck ? movementCheck.explain.slice(0, 60) + '…' : 'n/a', 'fix named');

      // Plywood exemption: a custom sheet slab must be exempted WITH a reason.
      const ply = pipeline({
        meta: { name: 'Ply Case', template: 'custom', level: 'beginner' },
        custom: {
          parts: [
            { id: 'p1', role: 'top_slab', primitive: 'slab', dim: { l: 900, w: 500, t: 18 }, pos: { x: 0, y: 409, z: 0 }, grain: 'length', stock: 'sheet', loadBearing: false, surface: 'worktop' },
            { id: 'p2', role: 'leg_panel', primitive: 'panel', dim: { l: 500, w: 400, t: 18 }, pos: { x: -350, y: 200, z: 0 }, rot: { x: 0, y: 90, z: 0 }, grain: 'length', stock: 'sheet', loadBearing: true, surface: 'none' },
            { id: 'p3', role: 'leg_panel', primitive: 'panel', dim: { l: 500, w: 400, t: 18 }, pos: { x: 350, y: 200, z: 0 }, rot: { x: 0, y: 90, z: 0 }, grain: 'length', stock: 'sheet', loadBearing: true, surface: 'none' }
          ],
          connections: [{ a: 'p2', b: 'p1', joint: 'butt_screws' }, { a: 'p3', b: 'p1', joint: 'butt_screws' }]
        }
      });
      const plyInteg = Structural.computeIntegrity(ply.spec, ply.model, {});
      const plyMove = plyInteg.checks.find(c => c.id.startsWith('move:'));
      test('structural', 'plywood panel is movement-exempt and says why', plyMove && plyMove.status === 'pass' && /plywood|plies/i.test(plyMove.explain), plyMove ? plyMove.explain.slice(0, 60) + '…' : 'no movement check', 'exempt, cross-laminated plies explanation');
    }

    /* ============ geometric buildability (the rogue-board net) ============ */
    {
      // A stray diagonal board dipping through the floor must be BLOCKED by
      // validation — never presented as a blueprint.
      const rogue = pipeline({
        specVersion: 4,
        meta: { name: 'Rogue Board Case', template: 'custom', level: 'beginner' },
        custom: {
          parts: [
            { id: 'p1', role: 'top_slab', primitive: 'slab', dim: { l: 900, w: 500, t: 18 }, pos: { x: 0, y: 409, z: 0 }, grain: 'length', stock: 'sheet', loadBearing: false, surface: 'worktop' },
            { id: 'p2', role: 'leg_panel', primitive: 'panel', dim: { l: 500, w: 400, t: 18 }, pos: { x: -350, y: 200, z: 0 }, rot: { x: 0, y: 90, z: 0 }, grain: 'length', stock: 'sheet', loadBearing: true, surface: 'none' },
            { id: 'p3', role: 'leg_panel', primitive: 'panel', dim: { l: 500, w: 400, t: 18 }, pos: { x: 350, y: 200, z: 0 }, rot: { x: 0, y: 90, z: 0 }, grain: 'length', stock: 'sheet', loadBearing: true, surface: 'none' },
            { id: 'p4', role: 'stray_board', primitive: 'rail', dim: { l: 700, w: 60, t: 20 }, pos: { x: 150, y: 40, z: 260 }, rot: { x: 0, y: 20, z: 40 }, grain: 'length', stock: 'solid', loadBearing: false, surface: 'none' }
          ],
          connections: [
            { a: 'p2', b: 'p1', joint: 'butt_screws' }, { a: 'p3', b: 'p1', joint: 'butt_screws' },
            { a: 'p4', b: 'p2', joint: 'butt_screws' }
          ]
        }
      });
      test('buildability', 'stray diagonal board is blocked by the geometric audit',
        rogue.report.errors.some(e => /^geom_/.test(e.id)),
        rogue.report.errors.map(e => e.id).join(', ') || 'no errors', 'geom_* error(s)');

      // Every declared joint must be physically touchable; unjointed parts
      // must not share space; the toe-kick case must stand on its sides.
      const tk = pipeline({
        meta: { name: 'TK Case', template: 'cabinet', level: 'intermediate' },
        overall: { width: 800, depth: 450, height: 900 },
        structure: { shelfCount: 1, toeKick: true, backPanel: true },
        drawers: { count: 2, frontStyle: 'overlay', runner: 'side_mount_slides' }
      });
      const tkSide = tk.model.parts.find(p => p.id === 'side_1');
      test('buildability', 'toe-kick cabinet is audit-clean and stands on its sides',
        tk.report.errors.length === 0 && Math.abs(tkSide.pos.y - tkSide.size.h / 2) < 0.11,
        `${tk.report.errors.length} errors, side base at ${(tkSide.pos.y - tkSide.size.h / 2).toFixed(1)}`, '0 errors, side base at 0.0');
      const tkPairs = new Set(tk.model.joints.map(j => [j.a, j.b].sort().join('|')));
      test('buildability', 'toe board and back panel are jointed into the case',
        tkPairs.has('plinth_1|side_1') && tkPairs.has('plinth_1|side_2') && tkPairs.has('back_1|side_1') && tkPairs.has('back_1|side_2'),
        [...tkPairs].filter(k => /plinth|back/.test(k)).join(', '), 'plinth + back joints present');

      // Near-square rotations snap; deliberate angles survive.
      const snap = Spec.correctSpec({
        specVersion: 4,
        meta: { name: 'Snap Case', template: 'custom', level: 'beginner' },
        custom: {
          parts: [
            { id: 'a', role: 'seat', primitive: 'slab', dim: { l: 900, w: 400, t: 19 }, pos: { x: 0, y: 400, z: 0 }, rot: { x: 1.5, y: 88, z: -359 }, grain: 'length', stock: 'solid', loadBearing: false, surface: 'seating' },
            { id: 'b', role: 'brace', primitive: 'rail', dim: { l: 600, w: 60, t: 20 }, pos: { x: 0, y: 200, z: 0 }, rot: { x: 30, y: 0, z: 0 }, grain: 'length', stock: 'solid', loadBearing: true, surface: 'none' }
          ],
          connections: [{ a: 'a', b: 'b', joint: 'butt_screws' }]
        }
      });
      test('buildability', 'near-square rotations snap to square; deliberate angles survive',
        deepEqual(snap.custom.parts[0].rot, { x: 0, y: 90, z: 0 }) && snap.custom.parts[1].rot.x === 30,
        JSON.stringify(snap.custom.parts[0].rot) + ' / ' + snap.custom.parts[1].rot.x, '{"x":0,"y":90,"z":0} / 30');
    }

    /* ============ packing invariants ============ */
    {
      const { spec, model } = pipeline({
        meta: { name: 'Pack Case', template: 'cabinet', level: 'intermediate' },
        overall: { width: 800, depth: 450, height: 900 },
        wood: { species: 'red_oak' },
        structure: { shelfCount: 1, toeKick: true, backPanel: true },
        drawers: { count: 2, frontStyle: 'overlay', runner: 'side_mount_slides' }
      });
      const cut = Plans.cutList(spec, model);
      const plan = Packing.planStock(spec, model, cut, {});
      // Expected stick count: every solid cut × its section multiplier.
      let expectedSticks = 0, expectedSheetParts = 0;
      for (const r of cut) {
        if (r.stock === 'sheet' || r.material === 'baltic_birch') expectedSheetParts += r.qty;
        else expectedSticks += r.qty * Packing.sectionFor(r.T, r.W).pieces;
      }
      const placedSticks = plan.boards.reduce((s, b) => s + b.cuts.length, 0);
      const placedSheet = plan.sheets.reduce((s, x) => s + x.placements.length, 0);
      test('packing', 'every solid stick placed exactly once', placedSticks === expectedSticks && !plan.errors.length, `${placedSticks} placed, ${plan.errors.length} errors`, `${expectedSticks} placed, 0 errors`);
      test('packing', 'every sheet part placed exactly once', placedSheet === expectedSheetParts, placedSheet, expectedSheetParts);

      const kerf = K.LUMBER.KERF, trim = K.LUMBER.END_TRIM;
      let boardsOK = true, boardMsg = 'all within bounds, kerf respected';
      for (const b of plan.boards) {
        const cuts = [...b.cuts].sort((x, y) => x.offset - y.offset);
        let prevEnd = trim;
        for (const c of cuts) {
          if (c.offset < prevEnd - 0.01) { boardsOK = false; boardMsg = `overlap on ${b.nominal}`; }
          if (c !== cuts[0] && c.offset - prevEnd < -0.01) { boardsOK = false; boardMsg = 'kerf violated'; }
          prevEnd = c.offset + c.len + kerf;
        }
        const last = cuts[cuts.length - 1];
        if (last && last.offset + last.len > b.stockLen - trim + 0.01) { boardsOK = false; boardMsg = `cut past end trim on ${b.nominal} ${b.stockLen}`; }
      }
      test('packing', '1D: cuts within stock bounds, 15 mm trim + 3 mm kerf respected', boardsOK, boardMsg, 'all within bounds, kerf respected');

      let sheetsOK = true, sheetMsg = 'no overlaps, all inside 1220×2440';
      for (const s of plan.sheets) {
        for (const p of s.placements) {
          if (p.x < -0.01 || p.y < -0.01 || p.x + p.w > 2440.01 || p.y + p.h > 1220.01) { sheetsOK = false; sheetMsg = `${p.name} out of bounds`; }
        }
        for (let i = 0; i < s.placements.length; i++) for (let j = i + 1; j < s.placements.length; j++) {
          const a = s.placements[i], b2 = s.placements[j];
          const sep = a.x + a.w + kerf <= b2.x + 0.01 || b2.x + b2.w + kerf <= a.x + 0.01 ||
                      a.y + a.h + kerf <= b2.y + 0.01 || b2.y + b2.h + kerf <= a.y + 0.01;
          if (!sep) { sheetsOK = false; sheetMsg = `${a.name} × ${b2.name} closer than kerf`; }
        }
      }
      test('packing', '2D: no overlaps, kerf spacing, sheet bounds', sheetsOK, sheetMsg, 'no overlaps, all inside 1220×2440');

      const grainOK = plan.sheets.every(s => s.placements.every(p => !p.rot || !cut.some(r => r.name === p.name && r.grain !== 'width')));
      test('packing', '2D: grain-constrained parts never rotate', grainOK, grainOK ? 'no locked part rotated' : 'a grain-locked part was rotated', 'no locked part rotated');
      test('packing', 'waste percentage reported', plan.wasteSolidPct != null && plan.wasteSolidPct >= 0 && plan.wasteSolidPct < 100, `solid ${plan.wasteSolidPct}%, sheet ${plan.wasteSheetPct}%`, '0–99%');

      // Hand spot-check: three 800 mm sticks fit ONE 2438 board
      // (15 + 800 + 3 + 800 + 3 + 800 + 15 = 2436 ≤ 2438).
      const boards = Packing.pack1D([
        { name: 'a', len: 800, nominal: '1x4', actual: K.LUMBER.NOMINALS['1x4'] },
        { name: 'b', len: 800, nominal: '1x4', actual: K.LUMBER.NOMINALS['1x4'] },
        { name: 'c', len: 800, nominal: '1x4', actual: K.LUMBER.NOMINALS['1x4'] }
      ]);
      test('packing', 'hand check: 3 × 800 mm fits one 2438 mm board with kerf+trim', boards.length === 1 && boards[0].stockLen === 2438 && boards[0].cuts.length === 3, `${boards.length} board(s) @ ${boards[0] && boards[0].stockLen}`, '1 board @ 2438');
    }

    /* ============ codec: decode(encode(x)) exact ============ */
    {
      const seed = Spec.correctSpec(Spec.defaultSpec('table'));
      const drawerSpec = Spec.correctSpec({
        meta: { name: 'Two-Drawer Nightstand', template: 'nightstand', level: 'intermediate' },
        overall: { width: 500, depth: 400, height: 600 }, wood: { species: 'walnut' },
        structure: { topThickness: 20, legThickness: 45, shelfCount: 1 },
        joinery: { frame: 'dowels', box: 'locking_rabbet' },
        drawers: { count: 2, frontStyle: 'inset', runner: 'side_mount_slides' }, finish: 'hardwax_oil'
      });
      const novel = Spec.correctSpec(bigComposition());
      for (const [label, s] of [['seed table', seed], ['drawer nightstand', drawerSpec], ['novel 25-part composition', novel]]) {
        const back = Codec.decode(Codec.encode(s));
        const diff = firstDiff(s, back);
        test('codec', `decode(encode(x)) deep-equals x — ${label}`, !diff, diff || 'exact', 'exact');
      }
      const wireLen = JSON.stringify(Codec.encode(drawerSpec));
      test('codec', 'known-type spec under 150 tokens on the wire', Codec.estimateTokens(wireLen) < 150, Codec.estimateTokens(wireLen) + ' tokens (' + wireLen.length + ' chars)', '< 150');
      const novelWire = JSON.stringify(Codec.encode(novel));
      test('codec', '25-primitive novel composition under 500 tokens', Codec.estimateTokens(novelWire) < 500, Codec.estimateTokens(novelWire) + ' tokens (' + novelWire.length + ' chars)', '< 500');
      test('codec', 'novel composition survives correction with all 25 parts', novel.custom.parts.length === 25 && novel.custom.connections.length === 42, `${novel.custom.parts.length} parts, ${novel.custom.connections.length} conns`, '25 parts, 42 conns');

      const share = Codec.toShareCode(drawerSpec);
      const imported = Codec.fromShareCode(share);
      const reDiff = imported.spec ? firstDiff(drawerSpec, Spec.correctSpec(imported.spec)) : 'decode failed';
      test('codec', 'share code round-trips to an identical design', share.startsWith('BB4:') && !reDiff, reDiff || share.slice(0, 24) + '…', 'BB4:… → identical spec');
      test('codec', 'share code rejects garbage gracefully', !!Codec.fromShareCode('BB4:!!!').error && !!Codec.fromShareCode('hello').error, 'errors returned', 'errors returned');
    }

    /* ============ migration ============ */
    {
      const migrated = Spec.migrateSpec(JSON.parse(JSON.stringify(V3_FIXTURE)));
      test('migration', 'v3 fixture gains specVersion 4 via the registry', migrated.specVersion === 4 && migrated.custom === null, `v${migrated.specVersion}, custom ${migrated.custom}`, 'v4, custom null');
      const { spec, model, report } = pipeline(JSON.parse(JSON.stringify(V3_FIXTURE)));
      test('migration', 'v3 stored design opens correctly at current version',
        report.errors.length === 0 && spec.specVersion === 4 && spec.wood.species === 'walnut' &&
        spec.drawers.count === 2 && spec.meta.units === 'in' && model.parts.length > 8 && model.drawers.length === 2,
        `${report.errors.length} errors, v${spec.specVersion}, ${spec.wood.species}, ${model.drawers.length} drawers`,
        '0 errors, v4, walnut, 2 drawers');
    }

    /* ============ continuation protocol ============ */
    {
      const novel = Spec.correctSpec(bigComposition());
      const full = JSON.stringify({ N: Codec.encode(novel), e: 'A 25-part ladder rack.' });
      const third = Math.ceil(full.length / 3);
      const chunks = [full.slice(0, third), full.slice(third, 2 * third), full.slice(2 * third)];
      let calls = 0, sawContinue = 0, sawRetry = 0;
      BB.AI.setTransport(async (system, messages) => {
        const last = messages[messages.length - 1];
        const lastText = typeof last.content === 'string' ? last.content : '';
        if (lastText === BB.AI.CONTINUE_PROMPT) sawContinue++;
        if (/not valid wire-format JSON/.test(lastText)) sawRetry++;
        const i = Math.min(calls, 2);
        calls++;
        return { text: chunks[i], stopReason: i < 2 ? 'max_tokens' : 'end_turn' };
      });
      try {
        const res = await BB.AI.respond('build a 25 part ladder rack', Spec.correctSpec(Spec.defaultSpec('table')), { turns: [] });
        const okSpec = res.reply && res.reply.kind === 'new' && res.reply.spec.custom && res.reply.spec.custom.parts.length === 25;
        test('protocol', 'oversized reply assembles across 2 continuations', calls === 3 && sawContinue === 2 && okSpec, `${calls} calls, ${sawContinue} continues, ${okSpec ? '25 parts' : 'bad spec'}`, '3 calls, 2 continues, 25 parts');
        test('protocol', 'truncation never consumes the validation retry', sawRetry === 0, sawRetry + ' retries burned', '0 retries burned');
      } finally {
        BB.AI.setTransport(null);
      }

      test('protocol', 'unbalanced JSON is detected as truncated (for stop_reason-less transports)', BB.AI.looksTruncated('{"o":{"h":65') && !BB.AI.looksTruncated('{"o":{"h":650}}'), 'detector agrees', 'detector agrees');

      // Context budget: >6 turns produces digest + exactly 6 verbatim + new msg.
      const turns = [];
      for (let i = 0; i < 10; i++) turns.push({ role: i % 2 ? 'assistant' : 'user', content: 'turn ' + i });
      const msgs = BB.AI.buildMessages(turns, 'So far: nightstand, oak, height 650', 'new message');
      const verbatim = msgs.filter(m => /^turn /.test(m.content)).length;
      const hasDigest = msgs.some(m => /\[context\] So far/.test(m.content));
      test('protocol', 'history: last 6 turns verbatim, older turns replaced by code digest', verbatim === 6 && hasDigest, `${verbatim} verbatim, digest ${hasDigest}`, '6 verbatim, digest true');

      const sys = BB.AI.systemPrompt(Spec.correctSpec(Spec.defaultSpec('nightstand')));
      test('protocol', 'system prompt = schema doc + level matrix + digest + wire spec', sys.includes('WIRE FORMAT') && sys.includes('LEVEL MATRIX') && sys.includes('WOOD:') && sys.includes('"v":4'), 'all four sections present', 'all four sections present');
      test('protocol', 'system prompt documents the schema once (no per-message re-explaining)', (sys.match(/WIRE FORMAT/g) || []).length === 1, (sys.match(/WIRE FORMAT/g) || []).length + ' occurrences', '1 occurrence');
    }

    /* ============ storage resilience ============ */
    {
      await Store.set('selftest:probe', { ok: 1 });
      const back = await Store.get('selftest:probe');
      await Store.del('selftest:probe');
      test('storage', 'store round-trips (falls back to memory when storage is absent)', back && back.ok === 1, JSON.stringify(back), '{"ok":1}');
      const prices = await Store.loadPrices();
      test('storage', 'price table loads with defaults merged', prices.dimensional && prices.dimensional.red_oak && prices.sheet[18] > 0, `red_oak 1x4 = $${prices.dimensional.red_oak && prices.dimensional.red_oak['1x4']}/m`, 'defaults present');

      // Prefs schema v1 → v2: imperial is for FRESH installs only; a returning
      // v1 user keeps metric. Real keys are saved and restored around the test.
      const savedV2 = await Store.get('prefs:v2'), savedV1 = await Store.get('prefs:v1');
      try {
        await Store.del('prefs:v2');
        await Store.set('prefs:v1', { climate: 'humid', stockMode: {} });
        const migrated = await Store.loadPrefs();
        test('storage', 'prefs v1 → v2 migration keeps a returning user metric',
          migrated.units.system === 'metric' && migrated.climate === 'humid',
          `${migrated.units.system} / climate ${migrated.climate}`, 'metric / climate humid');
        await Store.del('prefs:v2');
        await Store.del('prefs:v1');
        const fresh = await Store.loadPrefs();
        test('storage', 'fresh install defaults to imperial · 1/16 · dual off',
          fresh.units.system === 'imperial' && fresh.units.precision === 16 && fresh.units.dual === false,
          JSON.stringify(fresh.units), '{"system":"imperial","precision":16,"dual":false}');
      } finally {
        if (savedV1) await Store.set('prefs:v1', savedV1); else await Store.del('prefs:v1');
        if (savedV2) await Store.set('prefs:v2', savedV2); else await Store.del('prefs:v2');
      }
    }

    return results;
  }

  BB.SelfTest = { run, V3_FIXTURE, bigComposition, deepEqual, firstDiff };
})();
