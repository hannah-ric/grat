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
      // books preset 60 kg/m (BIFMA X5.9 40 lb/ft); red oak MOE 12.5 GPa.
      // Hand: I = 280·19³/12 = 160043.33; w = 60×9.81/1000 = 0.5886 N/mm;
      //       elastic = 5wL⁴/384EI = 2.13485 mm; books are a SUSTAINED load,
      //       so the reported figure carries ×2 creep (Wood Handbook ch. 4):
      //       sag = 4.26970 mm.
      const HAND_ELASTIC = 2.1348497758;
      const HAND_SAG = HAND_ELASTIC * 2.0;
      const cases = Structural.loadCasesFor('books', 864, 'ss');
      const { sag } = Structural.evalBeam(cases, 864, 12500, Structural.I_rect(280, 19));
      test('beam', 'shelf deflection matches hand calculation within 1% (incl. creep)', Math.abs(sag - HAND_SAG) / HAND_SAG < 0.01, sag.toFixed(4) + ' mm', HAND_SAG.toFixed(4) + ' mm');

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

    /* ============ digest integrity (audit F-S3-8) ============
     * The AI proposes from these digests; every generated line must equal a
     * fresh regeneration from its source table, so a table edit that forgets
     * the digest turns this red instead of silently wasting critique rounds. */
    {
      const line = K.levelMatrixLine();
      const expectLine = 'LEVEL MATRIX: ' + K.LEVELS.map((lvl, i) =>
        `${lvl}=${i ? '+' : ''}{${Object.values(K.JOINERY).filter(j => j.level === lvl).map(j => j.key).join(',')}}`).join(' ');
      test('digest', 'level-matrix digest equals a fresh regeneration from JOINERY', line === expectLine, line, expectLine);
      test('digest', 'knowledgeDigest embeds the generated level matrix', K.knowledgeDigest().includes(line), 'embedded', 'embedded');
      const sys = BB.AI.systemPrompt(Spec.correctSpec(Spec.defaultSpec('table')));
      test('digest', 'system prompt carries the generated matrix, not a hand copy', sys.includes(line), 'generated line present', 'generated line present');
      const vis = K.visionRangesLine();
      const nightR = K.ergoRow('nightstand_height');
      test('digest', 'vision-prompt ranges regenerate from ERGONOMICS', BB.AI.VISION_PROMPT.includes(vis) && vis.includes(`${nightR.min}-${nightR.max}`), vis, `contains ${nightR.min}-${nightR.max}`);
      const wLine = K.knowledgeDigest().split('\n')[0];
      const wOk = Object.values(K.WOOD_SPECIES).every(s => wLine.includes(`${s.key}(janka ${s.janka}`));
      test('digest', 'wood digest line carries every species from the table', wOk, wOk ? 'all present' : 'missing species', 'all present');
      // C1: bed-size anchors must regenerate into the digest, so a "for my
      // king bed" implication resolves against the real mattress width.
      const kingBed = K.ergoRow('king_bed_width');
      test('digest', 'bed-size anchor rows ride the knowledge digest (C1)',
        !!kingBed && kingBed.min >= 1900 && K.knowledgeDigest().includes(`king_bed_width ${kingBed.min}–${kingBed.max}mm`),
        kingBed ? `king_bed_width ${kingBed.min}–${kingBed.max}` : 'row missing', 'king row generated into digest');
      // C12: the standard sheet regenerates from LUMBER.SHEET — the table the
      // packer actually packs onto — so sheet-budget asks design against it.
      const sh = K.LUMBER.SHEET;
      test('digest', 'sheet size line regenerates from LUMBER.SHEET (C12)',
        K.knowledgeDigest().includes(`SHEET(mm): ${sh.W}×${sh.L}, thickness ${sh.THICKNESSES.join('/')}`),
        'generated line present', 'generated line present');
    }

    /* ============ 2026 knowledge expansion: full engine coverage ============
     * A joint or species that exists in the table but not in the derived
     * engines would silently mis-rate (racking 0, screws in a glue-up), so
     * coverage itself is the invariant. */
    {
      const KINDS = ['frame', 'case', 'box', 'panel'];
      let gap = null;
      for (const j of Object.values(K.JOINERY)) {
        if (!BB.Structural.JOINT_RATING[j.key]) { gap = j.key + ' missing JOINT_RATING'; break; }
        if (BB.Plans.JOINT_ALLOWANCE[j.key] === undefined) { gap = j.key + ' missing JOINT_ALLOWANCE'; break; }
        if (!j.kinds.every(k => KINDS.includes(k))) { gap = j.key + ' has an unknown kind'; break; }
      }
      test('expansion', 'every joint carries a structural rating, an explicit cut allowance, and known kinds', !gap, gap || 'full coverage', 'full coverage');
      const dflts = Object.entries(K.JOINT_DEFAULTS).every(([lvl, slots]) =>
        Object.entries(slots).every(([kind, key]) => K.jointAllowed(key, lvl, kind)));
      test('expansion', 'every JOINT_DEFAULTS pick passes its own level and kind gate', dflts, String(dflts), 'true');

      let spGap = null;
      for (const s of Object.values(K.WOOD_SPECIES)) {
        if (!(s.moe > 0 && s.mor > 0 && s.sg > 0 && s.ct > 0 && s.cr > 0)) { spGap = s.key + ' missing mechanics'; break; }
        if (!['low', 'medium', 'high'].includes(s.movement)) { spGap = s.key + ' bad movement label'; break; }
      }
      test('expansion', 'every species row carries complete Wood Handbook mechanics', !spGap, spGap || 'all complete', 'all complete');

      // Movement spot checks at the new extremes (hand arithmetic):
      // beech 500 × 0.00431 × 4 = 8.62 mm; teak 500 × 0.00186 × 4 = 3.72 mm.
      const mvBeech = K.movementMM(500, 'beech', 'tangential', 4);
      const mvTeak = K.movementMM(500, 'teak', 'tangential', 4);
      test('expansion', 'movement math at the catalog extremes matches hand arithmetic',
        Math.abs(mvBeech - 8.62) < 0.001 && Math.abs(mvTeak - 3.72) < 0.001,
        `beech ${mvBeech.toFixed(3)}, teak ${mvTeak.toFixed(3)}`, 'beech 8.620, teak 3.720');

      // Glue recommendation is deterministic and context-honest.
      const g1 = K.recommendGlue({ wood: { species: 'hard_maple' }, finish: 'mineral_oil' });
      const g2 = K.recommendGlue({ wood: { species: 'teak' }, finish: 'spar_urethane' });
      const g3 = K.recommendGlue({ wood: { species: 'red_oak' }, finish: 'wipe_poly' });
      test('expansion', 'glue choice: food contact → Type I, oily species → epoxy, interior → PVA',
        g1.glue.key === 'pva_waterproof' && g2.glue.key === 'epoxy_slow' && g3.glue.key === 'pva_interior',
        [g1.glue.key, g2.glue.key, g3.glue.key].join(' / '), 'pva_waterproof / epoxy_slow / pva_interior');
      test('expansion', 'food-contact finishes and glues exist for the butcher-block path',
        K.FINISHES.some(f => f.foodContact) && K.GLUES.some(g => g.foodContact), 'present', 'present');

      // Appended wire enums round-trip: a design using only 2026 keys.
      const roundSpec = Spec.correctSpec({
        meta: { name: 'RT', template: 'table', level: 'intermediate', units: 'mm' },
        wood: { species: 'hickory', sheetSpecies: 'hardwood_ply' },
        joinery: { frame: 'half_lap' }, finish: 'tung_pure'
      });
      const back = BB.Codec.decode(BB.Codec.encode(roundSpec));
      test('expansion', 'appended enum values survive encode → decode',
        back.wood.species === 'hickory' && back.wood.sheetSpecies === 'hardwood_ply' &&
        back.joinery.frame === 'half_lap' && back.finish === 'tung_pure',
        `${back.wood.species}/${back.wood.sheetSpecies}/${back.joinery.frame}/${back.finish}`, 'hickory/hardwood_ply/half_lap/tung_pure');
      test('expansion', 'pre-expansion designs still omit the sheet-stock wire key',
        !('ms' in BB.Codec.encode(Spec.correctSpec(Spec.defaultSpec('table')))), 'ms omitted', 'ms omitted');
    }

    /* ============ hardware repository: code owns every number ============ */
    {
      const HW = BB.HW;
      // Hinge count: band edges and the weight rule (ceil kg/3.5, floor 2).
      test('hardware', 'door hinge count: height bands 900/1600/2000 and the 3.5 kg weight rule',
        HW.doorHingeCount(899, 1) === 2 && HW.doorHingeCount(901, 1) === 3 &&
        HW.doorHingeCount(1601, 1) === 4 && HW.doorHingeCount(600, 8) === 3,
        [HW.doorHingeCount(899, 1), HW.doorHingeCount(901, 1), HW.doorHingeCount(1601, 1), HW.doorHingeCount(600, 8)].join('/'), '2/3/4/3');
      // Gas strut hand calc: 6.8 kg lid, 450 deep, defaults → 1.3·W·g·(225/90)
      // = 3.25·W·g ≈ 216.8 N — over the 200 N class on one strut, honest;
      // split across two on a 700-wide lid → 108.4 N → 120 N class.
      const gs = HW.gasStrut(6.8, 450, 700);
      test('hardware', 'gas strut moment balance matches hand arithmetic and snaps UP',
        gs.count === 2 && Math.abs(gs.requiredNEach - 108.4) < 0.05 && gs.classN === 120,
        JSON.stringify(gs), '2 struts, 108.4 N each, 120 N class');
      // Cup hinge: overlay solves the boring distance; outside 3–7 the
      // answer is a different plate/crank, never a wilder bore.
      const cb = HW.cupBoring(16, 0), cbOut = HW.cupBoring(25, 0);
      test('hardware', 'cup boring solved from overlay and clamped to the legal 3–7 range',
        cb.tbMM === 5 && cb.inRange && cbOut.tbMM === 7 && !cbOut.inRange,
        `overlay16→TB${cb.tbMM}, overlay25→TB${cbOut.tbMM}(out)`, 'TB5 in range; TB7 flagged out');
      // Pull sizing: ⅓ width snapped DOWN into the CTC series; two pulls
      // past 750; knobs under 300.
      const p1 = HW.pullSpec(430, 'bar_pull'), p2 = HW.pullSpec(800, 'bar_pull'), p3 = HW.pullSpec(250, 'bar_pull');
      test('hardware', 'pull sizing: series snap, two-pull rule past 750, knob under 300',
        p1.ctcMM === 128 && p2.count === 2 && p3.style === 'knob_round',
        `${p1.ctcMM} / ×${p2.count} / ${p3.style}`, '128 / ×2 / knob_round');
      test('hardware', 'every CTC the sizer can emit is a real series spacing',
        HW.PULL_CTC_SERIES.includes(HW.pullSpec(600, 'bar_pull').ctcMM), String(HW.pullSpec(600, 'bar_pull').ctcMM), 'in series');
      // Rule joint: r = t − fillet − pinH.
      const rj = HW.ruleJoint(22);
      test('hardware', 'rule joint radius = thickness − fillet − pin height', rj.radiusMM === 14, `${rj.radiusMM}`, '14');
      // Slide picker climbs the family by computed load.
      test('hardware', 'slide picker: 34 kg default, 45 kg past 25, 100 kg past 45, undermount honored',
        HW.slidePick(8).key === 'side_bb_34' && HW.slidePick(30).key === 'side_bb_45' &&
        HW.slidePick(60).key === 'heavy_duty_100' && HW.slidePick(8, { undermount: true }).key === 'undermount_45',
        'family climbs', 'family climbs');
      // Undermount geometry: the box is built to the slide.
      const um = pipeline({
        meta: { name: 'UM', template: 'cabinet', level: 'intermediate', units: 'mm' },
        overall: { width: 800, depth: 500, height: 900 }, structure: { toeKick: true },
        drawers: { count: 1, frontStyle: 'inset', runner: 'undermount_slides' }
      });
      const d0 = um.model.drawers[0];
      test('hardware', 'undermount box: INSIDE width = opening − 42 (Blum-class), height − 19, depth = slide length exactly',
        d0.opening.w - (d0.box.w - 2 * d0.box.t) === 42 && d0.opening.h - d0.box.h === 19 && d0.box.d === d0.slideLen,
        `inside −${d0.opening.w - (d0.box.w - 2 * d0.box.t)}/−${(d0.opening.h - d0.box.h)}/${d0.box.d}=${d0.slideLen}`, 'inside −42/−19/depth=slideLen');
      // kidSafe gate data is ready for the lids workstream, with the cord
      // stop explicitly refused.
      test('hardware', 'kidSafe gate: torsion/soft stays required, cord stop refused, ventilation specified',
        HW.GATES.kidSafe.requiredLidSupport.includes('torsion_lid') &&
        HW.GATES.kidSafe.refusedLidSupport.includes('cord_stay') && HW.GATES.kidSafe.ventilationMM >= 12,
        'gate complete', 'gate complete');
      // The system prompt carries the style digest but no capacities.
      const sysHW = BB.AI.systemPrompt(Spec.correctSpec(Spec.defaultSpec('nightstand')));
      test('hardware', 'system prompt carries hardware STYLES only (ratings stay in code)',
        sysHW.includes(HW.digestLine()) && !sysHW.includes('capacityKg'), 'styles only', 'styles only');
    }

    /* ============ 2026 hardening: coherence, budget, persistence ============ */
    {
      const HW = BB.HW;
      // Pull label and bore can never disagree: cup pulls stay style-true on
      // narrow drawers; generic styles substitute AND say so, everywhere.
      const cup = HW.pullSpec(240, 'cup_pull');
      test('hardening', 'cup pull stays a cup pull on a 240 mm front (own CTC series)',
        cup.style === 'cup_pull' && cup.holes === 2 && cup.ctcMM === 76 && !cup.substituted,
        `${cup.style} ${cup.holes}×@${cup.ctcMM}`, 'cup_pull 2×@76');
      const bar = HW.pullSpec(240, 'bar_pull');
      test('hardening', 'bar pull on a narrow front substitutes a knob and carries the flag',
        bar.style === 'knob_round' && bar.substituted === true && bar.holes === 1,
        `${bar.style} substituted=${bar.substituted}`, 'knob_round substituted=true');
      test('hardening', 'zero-hole styles carry zero bores (edge/flush)',
        HW.pullSpec(400, 'edge_pull').holes === 0 && HW.pullSpec(400, 'flush_recessed').holes === 0,
        'holes 0/0', 'holes 0/0');
      const narrow = pipeline({
        meta: { name: 'Narrow', template: 'nightstand', level: 'intermediate' },
        overall: { width: 330, depth: 400, height: 600 },
        drawers: { count: 1, frontStyle: 'inset', runner: 'side_mount_slides' }
      });
      const nb = BB.Plans.bom(narrow.spec, narrow.model, {});
      const knobLine = nb.items.find(i => i.kind === 'hardware' && /knob/i.test(i.label));
      test('hardening', 'BOM prints the FITTED style with the substitution named',
        !!knobLine && /substituted/.test(knobLine.detail) && narrow.report.advisories.some(a => a.id.startsWith('hw_pull_narrow')),
        knobLine ? knobLine.label : 'no knob line', 'Round knob + advisory');

      // Custom connection kinds are gated like template slots; french cleat
      // (external — its mate is the wall) never joins two parts.
      const gated = Spec.correctSpec({
        meta: { name: 'G', template: 'custom', level: 'beginner' },
        custom: {
          parts: [
            { id: 'a', role: 'leg', primitive: 'post', dim: { l: 400, w: 45, t: 45 }, pos: { x: 0, y: 200, z: 0 }, rot: null, grain: 'length', stock: 'solid', loadBearing: true, surface: 'none' },
            { id: 'b', role: 'seat', primitive: 'slab', dim: { l: 400, w: 300, t: 38 }, pos: { x: 0, y: 419, z: 0 }, rot: null, grain: 'length', stock: 'solid', loadBearing: false, surface: 'seating' }
          ],
          connections: [{ a: 'a', b: 'b', joint: 'french_cleat' }]
        }
      });
      test('hardening', 'french cleat between two parts is refused (kind gate)',
        gated.custom.connections[0].joint !== 'french_cleat', gated.custom.connections[0].joint, 'a level default, never french_cleat');

      // The climate preference reaches the bench text.
      const wr = pipeline({
        meta: { name: 'WR', template: 'nightstand', level: 'intermediate' },
        drawers: { count: 1, frontStyle: 'inset', runner: 'wood_runners' }
      });
      const humid = BB.Plans.assembly(wr.spec, wr.model, null, { climate: 'humid' }).find(s => /runners/.test(s.id));
      test('hardening', 'wooden-runner fitting follows the climate ΔMC',
        humid && /humid indoor swing/.test(humid.text), humid ? 'humid named' : 'step missing', 'humid named');

      // Prompt budget: hard ceiling, measured, with the ANSWER shape legal.
      const sysT = BB.AI.systemPrompt(Spec.correctSpec(Spec.defaultSpec('nightstand')));
      const tk = BB.Codec.estimateTokens(sysT);
      test('hardening', 'system prompt under the 2040-token ceiling', tk <= 2040 && tk > 800, tk + ' tokens', '≤ 2040'); // raised for the A5 exclusion line, then the C1 bed anchors
      const info = BB.AI.classify({ i: 'Use wipe-on poly.' });
      test('hardening', 'pure-advice replies classify as info (no spec change)', info && info.kind === 'info', info && info.kind, 'info');

      // Persistence driver chain reports an honest mode.
      const mode = Store.persistenceMode();
      test('hardening', 'persistence mode is a known driver name',
        ['artifact', 'cloud', 'device', 'session'].includes(mode), mode, 'artifact|cloud|device|session');
      test('hardening', 'hardware price defaults cover slides, pulls, glues',
        (() => { const h = K.hardwarePriceDefaults(); return h.slide_side_bb_34 === 14 && h.pull_bar_pull === 6 && h.glue_pva_interior === 8; })(),
        'defaults assemble', 'defaults assemble');
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

      // M-18: a drawered piece that tips with drawers open (F2057 margin < 1)
      // rolls up the distinct anchor tier — "safe only when anchored" — never
      // plain advisory under a "passes" headline.
      const anchorNs = pipeline({
        meta: { name: 'Anchor Tier', template: 'nightstand', level: 'intermediate' },
        overall: { width: 508, depth: 406.4, height: 609.6 }, wood: { species: 'walnut' },
        drawers: { count: 2, frontStyle: 'inset', runner: 'side_mount_slides' }, structure: { shelfCount: 1 }
      });
      const anchorInteg = Structural.computeIntegrity(anchorNs.spec, anchorNs.model, {});
      test('structural', 'mandatory-anchor design rolls up the "anchor" tier, not advisory',
        anchorInteg.antiTip && anchorInteg.summary.fails === 0 && anchorInteg.summary.verdict === 'anchor',
        `verdict ${anchorInteg.summary.verdict}, antiTip ${anchorInteg.antiTip}`, 'verdict anchor, antiTip true');

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
      test('storage', 'price table loads with defaults merged', prices.dimensional && prices.dimensional.red_oak && prices.sheet.baltic_birch && prices.sheet.baltic_birch[18] > 0, `red_oak 1x4 = $${prices.dimensional.red_oak && prices.dimensional.red_oak['1x4']}/m`, 'defaults present');

      // Legacy flat sheet prices ({18:99} meaning Baltic) migrate into the
      // per-species shape without losing the user's edit (2026 expansion).
      const savedPr = await Store.get('prices:v1');
      try {
        await Store.set('prices:v1', { dimensional: {}, sheet: { 6: 41, 12: 63, 18: 99 }, bdft: {} });
        const mig = await Store.loadPrices();
        test('storage', 'legacy flat sheet prices migrate to baltic_birch, new species fill from defaults',
          mig.sheet.baltic_birch[18] === 99 && mig.sheet.mdf && mig.sheet.mdf[18] > 0,
          `baltic 18 = $${mig.sheet.baltic_birch[18]}, mdf 18 = $${mig.sheet.mdf && mig.sheet.mdf[18]}`, 'baltic 18 = $99, mdf 18 > 0');
      } finally {
        if (savedPr) await Store.set('prices:v1', savedPr); else await Store.del('prices:v1');
      }

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

      // Render prefs deep-fill: stored prefs that predate the render block
      // gain the textured default without touching the user's other choices.
      const savedV2b = await Store.get('prefs:v2');
      try {
        await Store.set('prefs:v2', { climate: 'arid', theme: 'dark', units: { system: 'metric', precision: 16, dual: false } });
        const filled = await Store.loadPrefs();
        test('storage', 'prefs without render block gain textured default, keep the rest',
          filled.render && filled.render.textured === true && filled.climate === 'arid' && filled.units.system === 'metric',
          `render ${JSON.stringify(filled.render)}, climate ${filled.climate}, ${filled.units.system}`, 'render {"textured":true}, climate arid, metric');
      } finally {
        if (savedV2b) await Store.set('prefs:v2', savedV2b); else await Store.del('prefs:v2');
      }
    }

    /* ============ procedural materials ============ */
    {
      const M = BB.Materials;
      // Every species carries a full grain recipe.
      let missing = null;
      for (const key of Object.keys(K.WOOD_SPECIES)) {
        const p = M.grainParams(key);
        if (!p || !(p.grainScale > 0) || p.ringContrast === undefined || p.hueJitter === undefined || p.pores === undefined) { missing = key; break; }
      }
      test('materials', 'every species has a complete grain recipe', !missing, missing || 'all present', 'all present');
      test('materials', 'unknown species yields no params (no phantom textures)', M.grainParams('unobtainium') === null, String(M.grainParams('unobtainium')), 'null');

      // Deterministic grain: same key → same stream; different keys diverge.
      const a1 = M.seededRand('walnut'), a2 = M.seededRand('walnut'), b = M.seededRand('cherry');
      const seqA1 = [a1(), a1(), a1()], seqA2 = [a2(), a2(), a2()], seqB = [b(), b(), b()];
      test('materials', 'seeded PRNG is deterministic per species', JSON.stringify(seqA1) === JSON.stringify(seqA2), seqA1.map(v => v.toFixed(4)).join(','), seqA2.map(v => v.toFixed(4)).join(','));
      test('materials', 'different species get different grain streams', JSON.stringify(seqA1) !== JSON.stringify(seqB), 'streams differ', 'streams differ');
      const inRange = seqA1.every(v => v >= 0 && v < 1);
      test('materials', 'PRNG output stays in [0,1)', inRange, seqA1.map(v => v.toFixed(4)).join(','), 'all in [0,1)');

      // Theme palettes exist and actually differ.
      test('materials', 'environment palettes: light and dark defined and distinct',
        M.ENV_PALETTES.light && M.ENV_PALETTES.dark && M.ENV_PALETTES.light.top !== M.ENV_PALETTES.dark.top,
        `${M.ENV_PALETTES.light.top} vs ${M.ENV_PALETTES.dark.top}`, 'distinct palettes');

      // Texture cache: one entry per species regardless of how many
      // role/bucket materials request it (browser only — needs a canvas).
      if (typeof document !== 'undefined' && globalThis.THREE) {
        const before = M._cacheSize();
        M.woodTexture(globalThis.THREE, 'walnut');
        M.woodTexture(globalThis.THREE, 'walnut');
        const t1 = M.woodTexture(globalThis.THREE, 'walnut');
        const t2 = M.woodTexture(globalThis.THREE, 'walnut');
        test('materials', 'texture cache returns one shared texture per species', t1 === t2 && M._cacheSize() <= before + 1, `cache ${before} → ${M._cacheSize()}, identical ${t1 === t2}`, 'one new entry, identical');
      }
    }

    /* ============ shop truth: tools, time, CSV ============ */
    {
      // Advanced mortise-and-tenon table: the tool wall must demand the
      // joint's real tools on top of the base kit.
      const mt = pipeline({ meta: { name: 'MT Table', template: 'table', level: 'advanced' }, joinery: { frame: 'mortise_tenon' } });
      const mtTools = Plans.toolList(mt.spec, mt.model, null);
      test('shop', 'tool wall = base kit + joint tools (mortise & tenon adds chisels)',
        Plans.BASE_TOOLS.every(t => mtTools.includes(t)) && mtTools.some(t => /chisel/i.test(t)),
        mtTools.filter(t => /chisel|mortis/i.test(t)).join(', ') || 'no joint tools', 'chisels present');

      // Drawered nightstand: sheet goods + drawer fitting appear.
      const ns = pipeline({ meta: { name: 'NS', template: 'nightstand', level: 'intermediate' }, drawers: { count: 2 } });
      const nsTools = Plans.toolList(ns.spec, ns.model, null);
      test('shop', 'drawer build adds sheet breakdown + drawer fitting tools',
        nsTools.some(t => /sheet/i.test(t)) && nsTools.some(t => /drawer/i.test(t)),
        nsTools.filter(t => /sheet|drawer/i.test(t)).join(', '), 'sheet + drawer tools');

      // Time estimate: level factor orders the estimates; breakdown is honest.
      const cutMT = Plans.cutList(mt.spec, mt.model);
      const stepsMT = Plans.assembly(mt.spec, mt.model, null);
      const tAdv = Plans.timeEstimate(mt.spec, mt.model, cutMT, stepsMT, null);
      const beg = pipeline({ meta: { name: 'B Table', template: 'table', level: 'beginner' } });
      const tBeg = Plans.timeEstimate(beg.spec, beg.model, Plans.cutList(beg.spec, beg.model), Plans.assembly(beg.spec, beg.model, null), null);
      const sum = tAdv.breakdown.reduce((n, b) => n + b.min, 0);
      test('shop', 'time estimate: breakdown × level factor = active minutes',
        Math.abs(tAdv.activeMin - Math.round(sum * tAdv.factor)) <= 1, `${tAdv.activeMin} vs ${Math.round(sum * tAdv.factor)}`, 'equal ±1');
      test('shop', 'beginner pace multiplier exceeds advanced', tBeg.factor > tAdv.factor, `${tBeg.factor} vs ${tAdv.factor}`, '1.5 vs 1');
      test('shop', 'estimate is bounded and session count follows hours',
        tAdv.hoursLow >= 1 && tAdv.hoursHigh > tAdv.hoursLow && tAdv.sessions === Math.ceil(tAdv.hoursHigh / 4),
        `${tAdv.hoursLow}–${tAdv.hoursHigh} h, ${tAdv.sessions} sessions`, 'low < high, sessions = ceil(high/4)');

      // CSV: one line per row + header, display units AND raw mm, RFC quoting.
      // Display prefs are pinned imperial for the assertion and restored.
      const savedUnits = BB.Units.get();
      let csvLines, nsCut;
      try {
        BB.Units.set({ system: 'imperial', precision: 16, dual: false });
        nsCut = Plans.cutList(ns.spec, ns.model);
        csvLines = BB.Exports.toCSV(ns.spec, nsCut).trim().split('\r\n');
      } finally { BB.Units.set(savedUnits); }
      test('shop', 'CSV has header + one line per cut row', csvLines.length === nsCut.length + 1, csvLines.length, nsCut.length + 1);
      test('shop', 'CSV carries display units and raw mm side by side',
        csvLines[0].includes('"Length (mm)"') && / in"/.test(csvLines[1]) && /,\d+(\.\d+)?,/.test(csvLines[1]),
        csvLines[1].slice(0, 80) + '…', 'formatted + numeric mm columns');

      // Icons: strings, themable, unknown-safe.
      test('shop', 'icon set emits currentColor SVGs and empty string for unknown names',
        BB.Icons.svg('undo').includes('currentColor') && BB.Icons.svg('nope') === '',
        `undo ${BB.Icons.svg('undo').length} chars, unknown "${BB.Icons.svg('nope')}"`, 'svg + empty');
    }

    /* ============ glTF export + rotation in every exporter ============ */
    {
      // Minimal hand-built model: a plain box, a 45°-rotated box, and a
      // cylinder — exercises dedup, the quaternion path, and prism geometry.
      const spec2 = Spec.correctSpec(Spec.defaultSpec('table'));
      const model2 = {
        parts: [
          { id: 'leg_a', name: 'Leg', role: 'leg', defKey: 'leg', material: spec2.wood.species, size: { w: 60, h: 700, d: 60 }, pos: { x: -200, y: 350, z: 0 } },
          { id: 'leg_b', name: 'Leg', role: 'leg', defKey: 'leg', material: spec2.wood.species, size: { w: 60, h: 700, d: 60 }, pos: { x: 200, y: 350, z: 0 } },
          { id: 'brace', name: 'Brace', role: 'rail', defKey: 'brace', material: spec2.wood.species, size: { w: 500, h: 60, d: 30 }, pos: { x: 0, y: 600, z: 100 }, rot: { x: 0, y: 45, z: 0 } },
          { id: 'peg', name: 'Peg', role: 'pull', defKey: 'peg', material: 'hardware', prim: 'cylinder', size: { w: 20, h: 80, d: 20 }, pos: { x: 0, y: 640, z: 0 } }
        ]
      };

      const glb = BB.GLTF.toGLB(spec2, model2);
      const dv = new DataView(glb);
      test('gltf', 'GLB header: magic, version 2, declared length = actual bytes',
        dv.getUint32(0, true) === 0x46546C67 && dv.getUint32(4, true) === 2 && dv.getUint32(8, true) === glb.byteLength,
        `magic ${dv.getUint32(0, true).toString(16)}, v${dv.getUint32(4, true)}, ${dv.getUint32(8, true)}/${glb.byteLength}`,
        '46546c67, v2, lengths equal');
      const jsonLen = dv.getUint32(12, true);
      test('gltf', 'chunks 4-byte aligned with JSON + BIN\\0 tags',
        jsonLen % 4 === 0 && dv.getUint32(16, true) === 0x4E4F534A && dv.getUint32(20 + jsonLen + 4, true) === 0x004E4942,
        `jsonLen ${jsonLen}, tags ok`, 'aligned, JSON then BIN');
      const gj = JSON.parse(new TextDecoder().decode(new Uint8Array(glb, 20, jsonLen)));
      test('gltf', 'one node per part, all POSITION accessors carry min/max',
        gj.nodes.length === model2.parts.length &&
        gj.meshes.every(m => { const acc = gj.accessors[m.primitives[0].attributes.POSITION]; return acc.min && acc.max; }),
        `${gj.nodes.length} nodes`, `${model2.parts.length} nodes, min/max present`);
      const braceNode = gj.nodes.find(nd => nd.name === 'brace');
      const q = braceNode && braceNode.rotation;
      const qy = Math.sin(Math.PI / 8), qw = Math.cos(Math.PI / 8);
      test('gltf', 'rotated part carries the y=45° quaternion [0, sin22.5°, 0, cos22.5°]',
        q && Math.abs(q[0]) < 1e-6 && Math.abs(q[1] - qy) < 1e-6 && Math.abs(q[2]) < 1e-6 && Math.abs(q[3] - qw) < 1e-6,
        q ? q.map(v => v.toFixed(4)).join(', ') : 'missing', `0, ${qy.toFixed(4)}, 0, ${qw.toFixed(4)}`);
      test('gltf', 'unrotated nodes omit rotation; identical legs share one mesh',
        !gj.nodes.find(nd => nd.name === 'leg_a').rotation &&
        gj.nodes.find(nd => nd.name === 'leg_a').mesh === gj.nodes.find(nd => nd.name === 'leg_b').mesh,
        'shared mesh, no rotation', 'shared mesh, no rotation');

      // Quaternion → matrix round-trip against the source rotation matrix.
      const R = BB.Geo.rotMat(20, 45, 10);
      const [x, y, z, w] = BB.GLTF.mat3ToQuat(R);
      const RQ = [
        [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
        [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
        [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)]
      ];
      let worstQ = 0;
      for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) worstQ = Math.max(worstQ, Math.abs(R[i][j] - RQ[i][j]));
      test('gltf', 'mat3ToQuat round-trips a compound rotation within 1e-6', worstQ < 1e-6, worstQ.toExponential(2), '< 1e-6');

      // Cylinder prism data: 16-gon sides + caps, indices in range.
      const cd = BB.GLTF.cylData(20, 80);
      test('gltf', 'cylinder prism: 66 verts, 192 indices, all in range',
        cd.pos.length === 66 * 3 && cd.idx.length === 192 && cd.idx.every(i => i < 66),
        `${cd.pos.length / 3} verts, ${cd.idx.length} idx`, '66 verts, 192 idx');

      // Rotation in the legacy exporters (audit F-S1-3 implementation): DAE
      // writes the Z-up rotation block (y=45° about scene-up = Rz(45): row
      // "0.707 -0.707 0"); Ruby places EVERY instance with one full 16-array
      // Geom::Transformation — the rotated one carries the 0.707107 columns.
      const dae2 = BB.Exports.toDAE(spec2, model2);
      test('gltf', 'DAE carries rotation for rotated parts (Rz45 rows present)',
        dae2.includes('0.707 -0.707 0') && dae2.includes('0.707 0.707 0'),
        dae2.match(/<matrix>[^<]{0,40}/g).filter(s => s.includes('0.707')).length + ' rotated matrices', 'Rz(45) rows present');
      const rb2 = BB.Exports.toRuby(spec2, model2);
      const fullTransforms = (rb2.match(/Transformation\.new\(\[/g) || []).length;
      test('gltf', 'Ruby: every instance places via a full 16-array transform; rotation lands in the matrix',
        fullTransforms === model2.parts.length && rb2.includes('0.707107') && !rb2.includes('Transformation.axes'),
        `${fullTransforms}/${model2.parts.length} full transforms, Rz45 ${rb2.includes('0.707107') ? 'present' : 'missing'}`,
        'all instances full-matrix, Rz(45) present');
    }

    /* ============ drafting: dimensioned elevations ============ */
    {
      const savedU = BB.Units.get();
      try {
        BB.Units.set({ system: 'imperial', precision: 16, dual: false });
        const fmt = v => BB.Units.fmtLength(v);

        const seed = pipeline(Spec.defaultSpec('table'));
        const front = BB.Drafting.elevationSVG(seed.spec, seed.model, 'front', fmt);
        const rects = (front.match(/<rect /g) || []).length;
        test('drafting', 'front elevation draws every part (≥9 shapes for the seed table)',
          rects >= 9, rects + ' rects', '≥ 9');
        test('drafting', 'overall width dimension label routes through BB.Units',
          front.includes('>' + fmt(seed.model.bounds.w) + '<') && front.includes('>' + fmt(seed.model.bounds.h) + '<'),
          `${fmt(seed.model.bounds.w)} / ${fmt(seed.model.bounds.h)} present: ${front.includes(fmt(seed.model.bounds.w))}`, 'width + height labels present');
        const side = BB.Drafting.elevationSVG(seed.spec, seed.model, 'side', fmt);
        test('drafting', 'side elevation carries depth + height dimensions',
          side.includes('>' + fmt(seed.model.bounds.d) + '<') && side.includes('SIDE ELEVATION'),
          'depth label + title', 'depth label + title');

        // Drawer openings appear as dashed callouts on the nightstand front.
        const ns2 = pipeline({ meta: { name: 'NS', template: 'nightstand', level: 'intermediate' }, drawers: { count: 2 } });
        const nsFront = BB.Drafting.elevationSVG(ns2.spec, ns2.model, 'front', fmt);
        const openN = (nsFront.match(/class="opening"/g) || []).length;
        test('drafting', 'front elevation calls out each drawer opening',
          openN === ns2.model.openings.length, openN, ns2.model.openings.length);

        // A compound-rotated part projects as its convex-hull silhouette (6 corners).
        const modelRot = {
          bounds: { w: 600, d: 200, h: 700 },
          parts: [{ id: 'b', name: 'Brace', role: 'rail', defKey: 'b', material: 'red_oak', size: { w: 500, h: 60, d: 30 }, pos: { x: 0, y: 350, z: 0 }, rot: { x: 30, y: 30, z: 0 } }],
          openings: []
        };
        const rotSVG = BB.Drafting.elevationSVG(seed.spec, modelRot, 'front', fmt);
        const poly = rotSVG.match(/<polygon points="([^"]+)"/);
        const nPts = poly ? poly[1].trim().split(/\s+/).length : 0;
        test('drafting', 'compound-rotated part renders as a 6-vertex hull polygon',
          nPts === 6, nPts + ' vertices', '6 vertices');

        // Drawing sheet: three views + title block, no unresolved CSS vars after print swap.
        const sheet = BB.Exports.printSVG(BB.Drafting.sheetSVG(seed.spec, seed.model, fmt));
        test('drafting', 'drawing sheet composes 3 elevations + title block, print-safe',
          sheet.includes('FRONT ELEVATION') && sheet.includes('SIDE ELEVATION') && sheet.includes('PLAN ELEVATION') &&
          sheet.includes('BLUEPRINT BUDDY') && !sheet.includes('var(--'),
          'views + title block, vars swapped', 'views + title block, vars swapped');
      } finally { BB.Units.set(savedU); }
    }

    /* ============ joint inspector geometry ============ */
    {
      const apron = { id: 'a', name: 'Apron', material: 'red_oak', size: { w: 600, h: 89, d: 19 } };
      const leg = { id: 'l', name: 'Leg', material: 'red_oak', size: { w: 60, h: 700, d: 60 } };
      const shelf = { id: 's', name: 'Shelf', material: 'red_oak', size: { w: 800, h: 19, d: 280 } };
      const side = { id: 'c', name: 'Side', material: 'baltic_birch', size: { w: 18, h: 900, d: 280 } };
      const dSide = { id: 'ds', name: 'Drawer side', material: 'baltic_birch', size: { w: 400, h: 120, d: 12 } };
      const dFront = { id: 'df', name: 'Drawer front', material: 'red_oak', size: { w: 450, h: 120, d: 19 } };
      const boardA = { id: 'ba', name: 'Board A', material: 'red_oak', size: { w: 600, h: 19, d: 140 } };
      const boardB = { id: 'bb', name: 'Board B', material: 'red_oak', size: { w: 600, h: 19, d: 140 } };
      const membersFor = t => {
        const kind = K.JOINERY[t].kinds[0];
        return kind === 'frame' ? [apron, leg] : kind === 'case' ? [shelf, side]
          : kind === 'panel' ? [boardA, boardB] : [dSide, dFront];
      };

      // Every joint type builds: pieces with positive volume, both members
      // represented, a unit-length insert axis, and at least one sizing rule.
      let bad = null;
      for (const t of Object.keys(K.JOINERY)) {
        const [ma, mb] = membersFor(t);
        const d = BB.Joinery3D.buildJoint(t, ma, mb, v => v + 'mm');
        const volOK = d.pieces.every(p =>
          p.kind === 'cuboid' ? p.e.every(e => e > 0)
            : p.kind === 'cylinder' ? p.r > 0 && p.len > 0
              : p.profile.length >= 3 && p.depth > 0);
        const members = new Set(d.pieces.map(p => p.member));
        const axisLen = Math.hypot(...d.insertAxis);
        if (!volOK || !members.has('a') || !members.has('b') || Math.abs(axisLen - 1) > 1e-9 || !d.labels.length) {
          bad = `${t}: vol ${volOK}, members ${[...members]}, axis ${axisLen}`;
          break;
        }
      }
      test('joints3d', `all ${Object.keys(K.JOINERY).length} joint builders return sound geometry (volumes, members, axis, rules)`, !bad, bad || 'all sound', 'all sound');

      // Mortise & tenon: tenon = ⅓ stock, fits the pocket exactly, 30 mm deep.
      const mt = BB.Joinery3D.buildJoint('mortise_tenon', apron, leg, v => v + 'mm');
      const tenon = mt.pieces.filter(p => p.member === 'a').sort((x, y) => x.e[0] * x.e[1] * x.e[2] - y.e[0] * y.e[1] * y.e[2])[0];
      const pocketBack = mt.pieces.filter(p => p.member === 'b').sort((x, y) => x.e[0] - y.e[0])[0];
      test('joints3d', 'tenon is ⅓ of stock thickness and 30 mm long',
        Math.abs(tenon.e[2] * 2 - 19 / 3) < 0.01 && Math.abs(tenon.e[0] * 2 - 30) < 0.01,
        `${(tenon.e[2] * 2).toFixed(2)} thick × ${(tenon.e[0] * 2).toFixed(1)} long`, `${(19 / 3).toFixed(2)} × 30`);
      test('joints3d', 'mortise pocket matches the tenon section',
        Math.abs(pocketBack.e[1] - tenon.e[1]) < 0.01 && Math.abs(pocketBack.e[2] - tenon.e[2]) < 0.01,
        `pocket ${(pocketBack.e[1] * 2).toFixed(1)}×${(pocketBack.e[2] * 2).toFixed(2)}`, `tenon ${(tenon.e[1] * 2).toFixed(1)}×${(tenon.e[2] * 2).toFixed(2)}`);

      // Dado: groove depth = ⅓ housing thickness; the shelf rides in it.
      const dd = BB.Joinery3D.buildJoint('dado', shelf, side, v => v + 'mm');
      const floorPiece = dd.pieces.filter(p => p.member === 'b').sort((a, b) => a.e[0] - b.e[0])[0];
      test('joints3d', 'dado floor strip depth complements the ⅓ groove',
        Math.abs(floorPiece.e[0] * 2 - (18 - 18 / 3)) < 0.01,
        (floorPiece.e[0] * 2).toFixed(2), (18 - 18 / 3).toFixed(2));
      test('joints3d', 'dado assembles along the groove (Z), not the face',
        dd.insertAxis[2] === 1 && dd.insertAxis[0] === 0, dd.insertAxis.join(','), '0,0,1');

      // Dovetail: 1:8 flare — flank angle ≈ 7.13°, tails slide along Z.
      const dt = BB.Joinery3D.buildJoint('half_blind_dovetail', dSide, dFront, v => v + 'mm');
      const tail = dt.pieces.find(p => p.kind === 'prism' && p.member === 'a');
      const [p0, p1, p2] = [tail.profile[0], tail.profile[1], tail.profile[2]];
      void p1;
      const flank = Math.atan(Math.abs(p2[1] - tail.profile[1][1]) / Math.abs(p2[0] - tail.profile[1][0])) * 180 / Math.PI;
      void p0;
      test('joints3d', 'dovetail flank follows the 1:8 rule (≈7.1°, within 7–14°)',
        flank >= 6.9 && flank <= 14, flank.toFixed(2) + '°', '7.13°');
      test('joints3d', 'dovetail assembles along the side face normal (Z)', dt.insertAxis[2] === 1, dt.insertAxis.join(','), '0,0,1');
    }

    return results;
  }

  BB.SelfTest = { run, V3_FIXTURE, bigComposition, deepEqual, firstDiff };
})();
