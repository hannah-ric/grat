/* Blueprint Buddy — structural engine (physics judge).
 * Pure functions of (corrected spec, parametric model, per-surface load
 * choices). Wood Handbook material data drives exact beam math:
 *   MOE (GPa) -> stiffness ONLY: sag / deflection predictions.
 *   MOR (MPa) -> strength ONLY: breaking-load margins, safety factor 4.
 *   SG        -> density (COG / tipping) and fastener / joint capacity scaling.
 *   Janka     -> surface duty ONLY: dent & wear advisories.
 *   ct / cr   -> seasonal movement: width × coefficient × ΔMC (Phase 4).
 * Every check returns the computed number, the threshold, a plain-English
 * explanation, and — where code can own the change — tappable fixes that
 * patch the spec through the normal pipeline. Estimates for hobby
 * woodworking, not stamped engineering; the UI always carries a disclaimer.
 */
var BB = globalThis.BB = globalThis.BB || {};

(function () {
  'use strict';
  const K = BB.K;
  const Geo = BB.Geo;

  const GRAV = 9.81;            // m/s²; loads enter as kg, beam math is N·mm·MPa
  /* SAFETY_FACTOR basis (audit F-S3-7, disclosed via K.DESIGN_BASIS): MOR is a
   * Wood Handbook small-clear mean; ÷4 absorbs grade variability (knots,
   * runout — the NDS-style derate) plus load-duration effects on strength.
   * Deflection under sustained load is handled separately by CREEP_FACTOR. */
  const SAFETY_FACTOR = 4;
  const SAG_LIMIT_RATIO = 300;  // visible-sag limit: 1 mm per 300 mm of span
  const CANT_LIMIT_RATIO = 150; // cantilever tip equivalent
  const MOVEMENT_LIMIT = 3;     // mm of computed seasonal movement before the advisory
  /* Wood Handbook ch. 4: creep under long-duration load roughly DOUBLES the
   * initial elastic deflection of seasoned wood. Sustained load cases (books,
   * stored weight) report the long-term figure (audit F-S0-2). */
  const CREEP_FACTOR = 2.0;

  const speciesOf = key => K.WOOD_SPECIES[key] || K.WOOD_SPECIES.pine;
  const densityOf = key => speciesOf(key).sg * 1000; // kg/m³ at ~12% MC
  const sgFactor = key => speciesOf(key).sg / 0.5;
  const nextSolidUp = t => K.SOLID_THICKNESS.find(x => x > t) || null;
  // All display text routes through BB.Units — the check math stays SI.
  const U = () => BB.Units;
  const fmtFine = x => U().fmtSmall(x);      // sag / movement / margins: decimal in
  const fmtLen = x => U().fmtLength(x);      // spans / thicknesses: fractional in
  const fmtDeg = x => U().fmtDeg(x);         // angles never convert

  /* ---------------- load presets (user-selectable per surface) ----------------
   * Magnitudes aligned to published functional loads (audit F-S2-4); the
   * basis ships with each preset and is shown in the UI. `sustained` drives
   * the creep factor: stored weight lives there for years, people don't. */
  const LOAD_PRESETS = {
    display: { label: 'Display items', kind: 'udl', kgPerM: 10, sustained: true, basis: 'light display duty' },
    books:   { label: 'Books', kind: 'udl', kgPerM: 60, sustained: true, basis: 'BIFMA X5.9 shelf load, 40 lb/ft' },
    heavy:   { label: 'Heavy storage', kind: 'udl', kgPerM: 112, sustained: true, basis: 'BIFMA X5.9 high-density file load, 75 lb/ft' },
    seating: { label: 'Seated people', kind: 'seat', kgSeat: 136, sustained: false, basis: 'BIFMA X5.4 seating functional load, 300 lbf' },
    // Worktop loads are BIFMA FUNCTIONAL (short-term capability) loads — a
    // set table or a lean, not weight that sits for years — so no creep.
    worktop: { label: 'Desk / table duty', kind: 'combo', kgDist: 75, kgEdge: 90, sustained: false, basis: 'BIFMA X5.5 distributed + concentrated functional loads' }
  };
  const PRESET_KEYS = ['display', 'books', 'heavy', 'seating', 'worktop'];
  /* Preset magnitudes rendered in the CURRENT display units (lb/ft · lb
   * imperial, kg/m · kg metric) — formatted at render time, never stored. */
  function presetDetail(key) {
    const p = LOAD_PRESETS[key] || LOAD_PRESETS.display;
    if (p.kind === 'udl') return U().fmtLinearLoad(p.kgPerM);
    if (p.kind === 'seat') return `${U().fmtPointLoad(p.kgSeat)} per seat`;
    return `${U().fmtPointLoad(p.kgDist)} + ${U().fmtPointLoad(p.kgEdge)} lean`;
  }
  function defaultPresetFor(kind, template, defaultLoad) {
    if (kind === 'seat') return 'seating';
    if (kind === 'top') return 'worktop';
    if (defaultLoad && defaultLoad !== 'auto' && LOAD_PRESETS[defaultLoad]) return defaultLoad;
    if (template === 'bookshelf' || template === 'cabinet') return 'books';
    return 'display';
  }

  /* ---------------- joinery structural ratings (transparent heuristics) ----
   * rackPts: contribution per physical joint to the 0–100 racking score.
   * capN: nominal shear capacity per joint in N at SG 0.50, scales with SG. */
  const JOINT_RATING = {
    butt_screws:   { rackPts: 2.0, capN: 500 },
    pocket_screws: { rackPts: 3.0, capN: 700 },
    dowels:        { rackPts: 3.5, capN: 800 },
    rabbet:        { rackPts: 3.5, capN: 900 },
    locking_rabbet:{ rackPts: 4.0, capN: 1100 },
    dado:          { rackPts: 4.0, capN: 1200 },
    half_blind_dovetail: { rackPts: 5.5, capN: 1800 },
    mortise_tenon: { rackPts: 6.0, capN: 2000 }
  };

  /* ---------------- beam formulas (exact, SI: N, mm, MPa) ---------------- */
  const I_rect = (b, h) => (b * h * h * h) / 12;
  const DEFL = {
    udlSS:     (w, L, E, I) => (5 * w * Math.pow(L, 4)) / (384 * E * I),
    pointSS:   (P, L, E, I) => (P * Math.pow(L, 3)) / (48 * E * I),
    udlCant:   (w, L, E, I) => (w * Math.pow(L, 4)) / (8 * E * I),
    pointCant: (P, L, E, I) => (P * Math.pow(L, 3)) / (3 * E * I)
  };
  const MOM = {
    udlSS:     (w, L) => (w * L * L) / 8,
    pointSS:   (P, L) => (P * L) / 4,
    udlCant:   (w, L) => (w * L * L) / 2,
    pointCant: (P, L) => P * L
  };
  const seatsFor = span => Math.max(1, Math.round(span / 550));

  /* Each case carries `creep`: sustained loads report long-term deflection
   * (elastic × CREEP_FACTOR); transient loads stay elastic. Moments are never
   * creep-scaled — strength duration effects live inside SAFETY_FACTOR. */
  function loadCasesFor(presetKey, span, model) {
    const p = LOAD_PRESETS[presetKey] || LOAD_PRESETS.display;
    const cases = [];
    const kSus = CREEP_FACTOR;
    if (p.kind === 'udl') {
      const w = (p.kgPerM * GRAV) / 1000;
      const creep = p.sustained ? kSus : 1;
      cases.push(model === 'cant' ? { fn: 'udlCant', mag: w, creep } : { fn: 'udlSS', mag: w, creep });
    } else if (p.kind === 'seat') {
      const P = p.kgSeat * GRAV;
      if (model === 'cant') cases.push({ fn: 'pointCant', mag: P, creep: 1 });
      else {
        cases.push({ fn: 'pointSS', mag: P, creep: 1 });
        const seats = seatsFor(span);
        if (seats > 1) cases.push({ fn: 'udlSS', mag: ((seats - 1) * P) / span, creep: 1 });
      }
    } else {
      const w = (p.kgDist * GRAV) / span;
      const P = p.kgEdge * GRAV;
      const distCreep = p.sustained === 'dist' || p.sustained === true ? kSus : 1;
      if (model === 'cant') cases.push({ fn: 'udlCant', mag: w, creep: distCreep }, { fn: 'pointCant', mag: P, creep: 1 });
      else cases.push({ fn: 'udlSS', mag: w, creep: distCreep }, { fn: 'pointSS', mag: P, creep: 1 });
    }
    return cases;
  }
  function totalLoadN(presetKey, span) {
    const p = LOAD_PRESETS[presetKey] || LOAD_PRESETS.display;
    if (p.kind === 'udl') return (p.kgPerM * span / 1000) * GRAV;
    if (p.kind === 'seat') return seatsFor(span) * p.kgSeat * GRAV;
    return (p.kgDist + p.kgEdge) * GRAV;
  }
  function evalBeam(cases, L, E_MPa, I) {
    let sag = 0, M = 0, crept = false;
    for (const c of cases) {
      sag += DEFL[c.fn](c.mag, L, E_MPa, I) * (c.creep || 1);
      M += MOM[c.fn](c.mag, L);
      if ((c.creep || 1) > 1) crept = true;
    }
    return { sag, M, crept };
  }

  /* ---------------- surface discovery ---------------- */
  const TABLE_LIKE = ['table', 'desk', 'bench', 'nightstand'];
  const CARCASS = ['bookshelf', 'cabinet'];

  function surfacesOf(spec, model, loadChoices, defaultLoad) {
    const t = spec.meta.template;
    const out = [];
    const push = s => {
      s.presetKey = (loadChoices && loadChoices[s.id] && LOAD_PRESETS[loadChoices[s.id]])
        ? loadChoices[s.id] : defaultPresetFor(s.kind, t, defaultLoad);
      out.push(s);
    };
    const parts = model.parts;

    if (TABLE_LIKE.includes(t)) {
      const legs = parts.filter(p => p.role === 'leg');
      const top = parts.find(p => p.role === 'top');
      if (top && legs.length) {
        const legT = legs[0].size.w;
        const maxLegX = Math.max(...legs.map(l => Math.abs(l.pos.x)));
        const span = Math.max(100, 2 * maxLegX - legT);
        const over = Math.max(0, top.size.w / 2 - maxLegX - legT / 2);
        /* Frame mechanics (audit F-S2-1): the aprons are the beams — the top
         * rides on them. Find the governing apron pair (the longer-spanning
         * parallel pair); the top is then checked as a plate strip spanning
         * BETWEEN that pair, not leg-to-leg on its own. */
        const aprons = parts.filter(p => p.role === 'apron');
        const alongX = aprons.filter(a => a.size.w >= a.size.d);
        const alongZ = aprons.filter(a => a.size.d > a.size.w);
        const pick = (list, axis) => {
          if (list.length < 2) return null;
          return {
            id: list[0].id, len: Math.max(...list.map(a => axis === 'x' ? a.size.w : a.size.d)),
            off: Math.max(...list.map(a => axis === 'x' ? Math.abs(a.pos.z) : Math.abs(a.pos.x))),
            t: axis === 'x' ? list[0].size.d : list[0].size.w, h: list[0].size.h, axis
          };
        };
        const px = pick(alongX, 'x'), pz = pick(alongZ, 'z');
        const pair = (px && pz) ? (px.len >= pz.len ? px : pz) : (px || pz);
        let apron = null, strip = null;
        if (pair) {
          apron = { id: pair.id, span: Math.max(100, pair.len), b: pair.t, h: pair.h };
          const stripSpan = Math.max(50, 2 * pair.off - pair.t);
          const topAlong = pair.axis === 'x' ? top.size.w : top.size.d;
          // Plate strip under a point load: effective width ≈ half the span
          // plus a hand-sized contact patch, never wider than the panel.
          strip = { span: stripSpan, bEff: Math.min(topAlong, 0.5 * stripSpan + 100) };
        }
        push({
          id: top.id, part: top, label: t === 'bench' ? 'Seat' : 'Top', model: 'ss',
          kind: t === 'bench' ? 'seat' : (t === 'table' || t === 'desk') ? 'top' : 'shelf',
          span, b: top.size.d, h: top.size.h, over: over >= 50 ? over : 0,
          apron, strip
        });
      }
      const shelf = parts.find(p => p.role === 'shelf');
      if (shelf) push({ id: shelf.id, part: shelf, label: 'Lower shelf', kind: 'shelf', model: 'ss', span: shelf.size.w, b: shelf.size.d, h: shelf.size.h, over: 0 });
    } else if (CARCASS.includes(t)) {
      for (const p of parts) {
        if (p.role !== 'shelf' && p.role !== 'top') continue;
        push({
          id: p.id, part: p, label: p.role === 'top' ? 'Top panel' : `Shelf ${p.id.replace(/\D+/g, '') || 1}`,
          kind: 'shelf', model: 'ss', span: p.size.w, b: p.size.d, h: p.size.h, over: 0
        });
      }
    } else if (t === 'custom') {
      // Declared surfaces; span model inferred from the connection graph.
      const byId = new Map(parts.map(p => [p.id, p]));
      for (const p of parts) {
        if (!p.surface || p.surface === 'none') continue;
        const ext = Geo.worldExtents(p);
        const axis = ext.x >= ext.z ? [1, 0, 0] : [0, 0, 1];
        const len = Math.max(ext.x, ext.z);
        const bHoriz = Math.min(ext.x, ext.z);
        const half = len / 2;
        const ts = [];
        for (const c of (spec.custom && spec.custom.connections) || []) {
          const otherId = c.a === p.id ? c.b : c.b === p.id ? c.a : null;
          if (!otherId) continue;
          const q = byId.get(otherId);
          if (!q) continue;
          const d = [q.pos.x - p.pos.x, q.pos.y - p.pos.y, q.pos.z - p.pos.z];
          ts.push(Math.max(-half, Math.min(half, Geo.dot3(d, axis))));
        }
        let mdl = 'cant', span = half;
        if (ts.length >= 2) {
          const spread = Math.max(...ts) - Math.min(...ts);
          if (spread >= 0.4 * len) { mdl = 'ss'; span = Math.max(spread, 100); }
        }
        if (mdl === 'cant') {
          const tbar = ts.length ? ts.reduce((a, b) => a + b, 0) / ts.length : 0;
          span = Math.max(80, half + Math.abs(tbar));
        }
        const th = p.cutDim ? p.cutDim.T : Math.min(p.size.w, p.size.h, p.size.d);
        push({
          id: p.id, part: p, label: p.name, model: mdl, span, b: Math.max(20, bHoriz), h: th, over: 0,
          kind: p.surface === 'seating' ? 'seat' : p.surface === 'worktop' ? 'top' : 'shelf'
        });
      }
    }
    return out;
  }

  /* ---------------- the integrity computation ---------------- */
  function computeIntegrity(spec, model, opts) {
    opts = opts || {};
    const checks = [];
    const t = spec.meta.template;
    const custom = t === 'custom';
    const parts = model.parts;
    const sp = speciesOf(spec.wood.species);
    const E = sp.moe * 1000; // GPa -> MPa
    const sgF = sgFactor(spec.wood.species);
    const level = spec.meta.level;
    const allowed = K.jointsForLevel(level);
    const surfaces = surfacesOf(spec, model, opts.loadChoices, opts.defaultLoad);
    const byId = new Map(parts.map(p => [p.id, p]));
    const dMC = K.CLIMATE_DMC[opts.climate] !== undefined ? K.CLIMATE_DMC[opts.climate] : K.CLIMATE_DMC.temperate;

    /* ---- custom hard guarantees: connectivity, stand, load paths, collisions ---- */
    let grounded = new Set();
    let adj = new Map();
    if (custom && parts.length) {
      adj = new Map(parts.map(p => [p.id, []]));
      for (const c of (spec.custom && spec.custom.connections) || []) {
        if (adj.has(c.a) && adj.has(c.b)) { adj.get(c.a).push(c.b); adj.get(c.b).push(c.a); }
      }
      const seen = new Set();
      const stack = [parts[0].id];
      while (stack.length) { const id = stack.pop(); if (seen.has(id)) continue; seen.add(id); for (const n of adj.get(id) || []) stack.push(n); }
      const orphans = parts.filter(p => !seen.has(p.id)).map(p => p.id);
      checks.push({
        id: 'conn', title: 'Connectivity', status: orphans.length ? 'fail' : 'pass',
        value: orphans.length ? `${orphans.length} disconnected part(s)` : 'one connected structure',
        threshold: 'single connected component',
        explain: orphans.length ? `${orphans.join(', ')} ${orphans.length > 1 ? 'are' : 'is'} not connected to the main structure.` : 'Every part reaches every other part through declared joints.',
        fixes: []
      });

      for (const p of parts) {
        const corners = Geo.obbCorners(Geo.partOBB(p));
        if (Math.min(...corners.map(c => c[1])) < 5) grounded.add(p.id);
      }
      const footPts = [];
      for (const id of grounded) {
        for (const c of Geo.obbCorners(Geo.partOBB(byId.get(id)))) if (c[1] < 30) footPts.push([c[0], c[2]]);
      }
      const hull = Geo.convexHull2D(footPts);
      let mass = 0, mx = 0, my = 0, mz = 0;
      for (const p of parts) {
        const dens = p.material === 'baltic_birch' ? densityOf('baltic_birch') : densityOf(spec.wood.species);
        const volFactor = p.prim === 'cylinder' ? Math.PI / 4 : 1;
        const m = p.size.w * p.size.h * p.size.d * 1e-9 * dens * volFactor;
        mass += m; mx += m * p.pos.x; my += m * p.pos.y; mz += m * p.pos.z;
      }
      const cog = mass ? [mx / mass, my / mass, mz / mass] : [0, 0, 0];
      const inDist = hull.length >= 3 ? Geo.polyInsideDistance(hull, [cog[0], cog[2]]) : -Infinity;
      const MARGIN = 15;
      let standExplain;
      if (!grounded.size) standExplain = 'No part touches the floor — the piece has nothing to stand on.';
      else if (hull.length < 3) standExplain = 'The floor contact points are collinear — the piece would fall over sideways.';
      else if (inDist < 0) standExplain = `The center of gravity falls ${fmtFine(-inDist)} outside the support polygon.`;
      else if (inDist < MARGIN) standExplain = `The center of gravity is only ${fmtFine(inDist)} inside the support polygon — under the ${fmtFine(MARGIN)} stability margin.`;
      else standExplain = `The center of gravity sits ${fmtFine(inDist)} inside the footprint.`;
      checks.push({
        id: 'stand', title: 'It must stand', status: inDist >= MARGIN ? 'pass' : 'fail',
        value: isFinite(inDist) ? `COG margin ${fmtFine(inDist)}` : 'no footprint',
        threshold: `≥ ${fmtFine(MARGIN)} inside the support polygon`, explain: standExplain, fixes: [],
        data: { cogMarginMM: isFinite(inDist) ? inDist : null }
      });

      for (const p of parts) {
        if (!(p.loadBearing || (p.surface && p.surface !== 'none'))) continue;
        const q = [[p.id, [p.id]]];
        const vis = new Set([p.id]);
        let path = null;
        while (q.length && !path) {
          const [id, trail] = q.shift();
          if (grounded.has(id)) { path = trail; break; }
          for (const n2 of adj.get(id) || []) if (!vis.has(n2)) { vis.add(n2); q.push([n2, [...trail, n2]]); }
        }
        if (!path) {
          checks.push({
            id: 'path:' + p.id, title: `Load path — ${p.id}`, status: 'fail',
            value: 'no path to ground', threshold: 'connected route to a floor-bearing part',
            explain: `${p.id} carries load but has no connection path to the ground — it is floating.`, fixes: []
          });
        } else {
          const weak = path.slice(1, -1).filter(id => byId.get(id) && !byId.get(id).loadBearing);
          if (weak.length) checks.push({
            id: 'path:' + p.id, title: `Load path — ${p.id}`, status: 'advisory',
            value: 'via ' + path.slice(1).join(' → '), threshold: 'load-bearing route to ground',
            explain: `The load path for ${p.id} runs through ${weak.join(', ')}, which ${weak.length > 1 ? 'are' : 'is'} not declared load-bearing.`, fixes: []
          });
        }
      }

      const connSet = new Set(((spec.custom && spec.custom.connections) || []).map(c => [c.a, c.b].sort().join('|')));
      const hits = [], gaps = [];
      for (let i = 0; i < parts.length; i++) for (let j = i + 1; j < parts.length; j++) {
        const a = parts[i], b = parts[j];
        const key = [a.id, b.id].sort().join('|');
        const pen = Geo.obbPenetration(Geo.partOBB(a), Geo.partOBB(b));
        if (connSet.has(key)) {
          const A = Geo.partOBB(a); A.e = A.e.map(e => e + 5);
          if (pen == null && Geo.obbPenetration(A, Geo.partOBB(b)) == null) gaps.push(`${a.id}–${b.id}`);
        } else if (pen != null && pen > 2) hits.push(`${a.id} × ${b.id} (${fmtFine(pen)})`);
      }
      checks.push({
        id: 'collide', title: 'Collision check', status: hits.length ? 'fail' : gaps.length ? 'advisory' : 'pass',
        value: hits.length ? `${hits.length} accidental intersection(s)` : gaps.length ? `${gaps.length} open joint(s)` : 'clean',
        threshold: 'no unconnected parts intersecting',
        explain: hits.length ? `Unconnected parts intersect: ${hits.join('; ')}. Move or resize them.`
          : gaps.length ? `Declared connections where the parts never touch: ${gaps.join('; ')}.`
          : 'Connected parts overlap only at their declared joints.',
        fixes: []
      });

      const angled = parts.map(p => ({ p, a: Geo.cutAngles(p.rot) })).filter(x => x.a);
      if (angled.length) {
        const worst = angled.reduce((m, x) => Math.max(m, x.a.miter, x.a.bevel), 0);
        const extreme = angled.filter(x => x.a.extreme);
        checks.push({
          id: 'build', title: 'Buildability (angled cuts)', status: extreme.length ? 'advisory' : 'pass',
          value: `${angled.length} angled part(s), max ${fmtDeg(worst)}`, threshold: 'compound cuts ≤ 50°',
          explain: extreme.length
            ? `${extreme.map(x => x.p.id).join(', ')} need${extreme.length > 1 ? '' : 's'} cuts past 50° — beyond common miter-saw capability. Consider a jig or a squarer design.`
            : 'All miters and bevels are within common saw capability; angles are listed in the cut list.',
          fixes: []
        });
      }
    }

    /* ---- beam checks per load-bearing surface: sag (MOE), strength (MOR/SF4) ----
     * Frame surfaces (table/desk/bench/nightstand tops) run the honest model
     * from the audit (F-S2-1): the APRONS are the beams over the leg-to-leg
     * span; the TOP is a plate strip spanning between the aprons. Everything
     * else stays a plain single-span (or cantilever) beam. */
    let worstSagRatio = 0, worstSag = null;
    const allow = sp.mor / SAFETY_FACTOR;
    const sagStatus = r => r <= 1 ? 'pass' : r <= 1.5 ? 'advisory' : 'fail';
    const strengthCheck = (id, label, M, h, I, preset, fixes) => {
      const stress = I > 0 ? (M * (h / 2)) / I : Infinity;
      const margin = stress > 0 ? allow / stress : Infinity;
      checks.push({
        id, title: `Strength — ${label}`,
        status: margin >= 1.25 ? 'pass' : margin >= 1 ? 'advisory' : 'fail',
        value: `bending stress ${stress.toFixed(1)} MPa · margin ${margin === Infinity ? '∞' : margin.toFixed(1) + '×'}`,
        threshold: `≤ ${allow.toFixed(1)} MPa (MOR ${sp.mor} MPa ÷ safety factor ${SAFETY_FACTOR})`,
        explain: margin >= 1 ? `Comfortably below the breaking stress of ${sp.label} with the standard ×${SAFETY_FACTOR} wood safety factor.`
          : `The “${preset.label}” load brings this part too close to breaking stress.`,
        fixes: margin < 1.25 ? fixes : []
      });
    };
    for (const s of surfaces) {
      const preset = LOAD_PRESETS[s.presetKey];
      const fixes = [];
      const up = nextSolidUp(s.h);
      if (!custom && up) {
        if (s.part.role === 'top' && TABLE_LIKE.includes(t)) fixes.push({ id: 'thick-top', label: `Thicken top to ${fmtLen(up)}`, patch: { structure: { topThickness: up } } });
        else if (s.part.material !== 'baltic_birch' && !s.apron) fixes.push({ id: 'thick-shelf', label: `Thicken to ${fmtLen(up)}`, patch: { structure: { shelfThickness: up } } });
      }
      if (custom && up && s.part.material !== 'baltic_birch') {
        const newParts = spec.custom.parts.map(p => p.id === s.id ? { ...p, dim: { ...p.dim, t: up } } : p);
        fixes.push({ id: 'thick-' + s.id, label: `Thicken ${s.id} to ${fmtLen(up)}`, patch: { custom: { parts: newParts, connections: spec.custom.connections } } });
      }
      if (K.WOOD_SPECIES.hard_maple.moe > sp.moe * 1.1 && spec.wood.species !== 'hard_maple') {
        fixes.push({ id: 'maple', label: 'Switch to hard maple', patch: { wood: { species: 'hard_maple' } } });
      }

      if (s.apron) {
        /* (a) Apron beam over the leg-to-leg span. Each of the pair carries
         * half the spread load. The point load's worst position is directly
         * above one apron; the top (fastened along both aprons) redistributes
         * at least a quarter of it to the partner, so one apron carries 3/4 —
         * still conservative against true composite action. */
        const POINT_SHARE = 0.75;
        const cases = loadCasesFor(s.presetKey, s.apron.span, 'ss')
          .map(c => ({ ...c, mag: c.fn.startsWith('udl') ? c.mag * 0.5 : c.mag * POINT_SHARE }));
        const Ia = I_rect(s.apron.b, s.apron.h);
        const { sag, M } = evalBeam(cases, s.apron.span, E, Ia);
        const limit = s.apron.span / SAG_LIMIT_RATIO;
        const ratio = sag / limit;
        if (ratio > worstSagRatio) { worstSagRatio = ratio; worstSag = { id: s.id, sag, limit, span: s.apron.span }; }
        const apFixes = [...fixes];
        if (spec.structure.apronHeight < 160) apFixes.unshift({ id: 'tall-apron', label: `Deepen aprons to ${fmtLen(Math.min(160, spec.structure.apronHeight + 30))}`, patch: { structure: { apronHeight: Math.min(160, spec.structure.apronHeight + 30) } } });
        checks.push({
          id: 'sag:apron:' + s.id, title: `Sag — aprons under ${s.label.toLowerCase()}`,
          status: sagStatus(ratio),
          value: `predicted sag ${fmtFine(sag)} over the ${fmtLen(s.apron.span)} apron span`,
          threshold: `≤ ${fmtFine(limit)} (${U().fmtSagRate(SAG_LIMIT_RATIO)})`,
          explain: `The aprons are the beams: each ${fmtLen(s.apron.b)} × ${fmtLen(s.apron.h)} apron carries half the spread load and, worst case, ¾ of the point load (the attached top shares the rest across). Sustained loads include ×${CREEP_FACTOR} creep.`,
          fixes: ratio > 1 ? apFixes : [],
          data: { sagMM: sag, limitMM: limit, spanMM: s.apron.span },
          prov: { rule: `apron beam: I = t·h³/12 = ${Math.round(Ia).toLocaleString()} mm⁴, span ${Math.round(s.apron.span)} mm, half the spread load per apron` }
        });
        strengthCheck('str:apron:' + s.id, `aprons under ${s.label.toLowerCase()}`, M, s.apron.h, Ia, preset, apFixes);

        /* (b) Top as a plate strip between the aprons. Point loads act at the
         * strip midspan; spread loads contribute their tributary share. */
        const rawCases = loadCasesFor(s.presetKey, s.apron.span, 'ss');
        const stripCases = [];
        for (const c of rawCases) {
          if (c.fn === 'pointSS') stripCases.push({ ...c });
          else if (c.fn === 'udlSS') {
            const totalN = c.mag * s.apron.span;                     // N over the whole top
            const tributary = totalN * (s.strip.bEff / s.apron.span); // strip's share
            stripCases.push({ ...c, mag: tributary / s.strip.span });
          }
        }
        const Is = I_rect(s.strip.bEff, s.h);
        const { sag: sagS, M: MS } = evalBeam(stripCases, s.strip.span, E, Is);
        const limS = s.strip.span / SAG_LIMIT_RATIO;
        const rS = sagS / limS;
        if (rS > worstSagRatio) { worstSagRatio = rS; worstSag = { id: s.id, sag: sagS, limit: limS, span: s.strip.span }; }
        checks.push({
          id: 'sag:' + s.id, title: `Sag — ${s.label} between aprons`,
          status: sagStatus(rS),
          value: `predicted sag ${fmtFine(sagS)} across the ${fmtLen(s.strip.span)} between aprons`,
          threshold: `≤ ${fmtFine(limS)} (${U().fmtSagRate(SAG_LIMIT_RATIO)})`,
          explain: `${sp.label} at ${fmtLen(s.h)} thick under the “${preset.label}” preset (${presetDetail(s.presetKey)}), checked as a ${fmtLen(s.strip.bEff)}-wide strip spanning between the aprons.`,
          fixes: rS > 1 ? fixes : [],
          data: { sagMM: sagS, limitMM: limS, spanMM: s.strip.span },
          prov: { rule: `plate strip: span ${Math.round(s.strip.span)} mm between apron faces, effective width min(top, span/2 + 100) = ${Math.round(s.strip.bEff)} mm, I = ${Math.round(Is).toLocaleString()} mm⁴` }
        });
        strengthCheck('str:' + s.id, s.label, MS, s.h, Is, preset, fixes);
      } else {
        const I = I_rect(s.b, s.h);
        const cases = loadCasesFor(s.presetKey, s.span, s.model);
        const { sag, M, crept } = evalBeam(cases, s.span, E, I);
        const limit = s.model === 'cant' ? s.span / CANT_LIMIT_RATIO : s.span / SAG_LIMIT_RATIO;
        const ratio = sag / limit;
        if (ratio > worstSagRatio) { worstSagRatio = ratio; worstSag = { id: s.id, sag, limit, span: s.span }; }
        checks.push({
          id: 'sag:' + s.id, title: `Sag — ${s.label}`,
          status: sagStatus(ratio),
          value: `predicted ${crept ? 'long-term ' : ''}sag ${fmtFine(sag)} over a ${fmtLen(s.span)} ${s.model === 'cant' ? 'cantilever' : 'span'}`,
          threshold: `≤ ${fmtFine(limit)} (${s.model === 'cant' ? `L/${CANT_LIMIT_RATIO} at the free end` : U().fmtSagRate(SAG_LIMIT_RATIO)})`,
          explain: `${sp.label} at ${fmtLen(s.h)} thick under the “${preset.label}” preset (${presetDetail(s.presetKey)}). Stiffness comes from MOE (${sp.moe} GPa) and thickness cubed.${crept ? ` Sustained load: includes ×${CREEP_FACTOR} creep (Wood Handbook ch. 4).` : ''}`,
          fixes: ratio > 1 ? fixes : [],
          data: { sagMM: sag, limitMM: limit, spanMM: s.span },
          prov: { rule: `sag = Σ load cases (5wL⁴/384EI and friends${crept ? `, sustained cases ×${CREEP_FACTOR} creep` : ''}) with E = ${sp.moe} GPa, I = bh³/12 = ${Math.round(I).toLocaleString()} mm⁴, L = ${Math.round(s.span)} mm` }
        });
        strengthCheck('str:' + s.id, s.label, M, s.h, I, preset, fixes);
      }

      if (s.over > 0 && s.kind === 'top') {
        const P = LOAD_PRESETS.worktop.kgEdge * GRAV;
        const IO = I_rect(s.b, s.h); // the top itself cantilevers past the frame
        const sagO = DEFL.pointCant(P, s.over, E, IO);
        const limO = s.over / CANT_LIMIT_RATIO;
        const rO = sagO / limO;
        checks.push({
          id: 'cant:' + s.id, title: `Overhang — ${s.label}`,
          status: rO <= 1 ? 'pass' : rO <= 1.5 ? 'advisory' : 'fail',
          value: `edge deflection ${fmtFine(sagO)} on a ${fmtLen(s.over)} overhang`,
          threshold: `≤ ${fmtFine(limO)} (L/${CANT_LIMIT_RATIO}) under a ${U().fmtPointLoad(LOAD_PRESETS.worktop.kgEdge)} lean`,
          explain: 'Cantilever case: a person leaning at the worst edge position.',
          fixes: rO > 1 ? fixes : [],
          data: { sagMM: sagO, limitMM: limO, spanMM: s.over }
        });
      }

      if (s.kind === 'top' && sp.janka < 1000) {
        checks.push({
          id: 'duty:' + s.id, title: `Surface durability — ${s.label}`, status: 'advisory',
          value: `${sp.label} Janka ${sp.janka} lbf`, threshold: '≥ 1000 lbf for a hard-wearing worktop',
          explain: `${sp.label} will dent under daily desk use. Fine for a rustic look — consider maple or oak for a hard-wearing surface.`,
          fixes: [
            { id: 'duty-maple', label: 'Switch to hard maple', patch: { wood: { species: 'hard_maple' } } },
            { id: 'duty-oak', label: 'Switch to red oak', patch: { wood: { species: 'red_oak' } } }
          ]
        });
      }
    }

    /* ---- tipping stability: COG from part volumes & density, empty and loaded ---- */
    let antiTip = false, tip = null;
    {
      let mass = 0, mx = 0, my = 0, mz = 0;
      for (const p of parts) {
        if (p.role === 'pull') continue;
        const dens = p.material === 'baltic_birch' ? densityOf('baltic_birch') : p.material === 'hardware' ? 3000 : densityOf(spec.wood.species);
        const volFactor = p.prim === 'cylinder' ? Math.PI / 4 : 1;
        const m = p.size.w * p.size.h * p.size.d * 1e-9 * dens * volFactor;
        mass += m; mx += m * p.pos.x; my += m * p.pos.y; mz += m * p.pos.z;
      }
      // Feet: parts whose underside is at (or within a toe-kick of) the floor.
      const feet = custom ? parts.filter(p => grounded.has(p.id)) : parts.filter(p => p.pos.y - p.size.h / 2 < 95);
      if (mass > 0 && feet.length) {
        let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
        for (const f of feet) for (const c of Geo.obbCorners(Geo.partOBB(f))) {
          if (c[1] < 130) { minX = Math.min(minX, c[0]); maxX = Math.max(maxX, c[0]); minZ = Math.min(minZ, c[2]); maxZ = Math.max(maxZ, c[2]); }
        }
        const height = Math.max(...parts.map(p => p.pos.y + p.size.h / 2));
        const baseDepth = Math.max(1, maxZ - minZ);
        const cogE = [mx / mass, my / mass, mz / mass];
        const edge = cog => Math.max(1, Math.min(maxX - cog[0], cog[0] - minX, maxZ - cog[2], cog[2] - minZ));
        const angEmpty = (Math.atan2(edge(cogE), cogE[1]) * 180) / Math.PI;
        const topSurf = surfaces.filter(s => s.kind === 'shelf' || s.kind === 'top').sort((a, b) => b.part.pos.y - a.part.pos.y)[0];
        let angLoaded = angEmpty, loadKg = 0;
        if (topSurf) {
          loadKg = totalLoadN(topSurf.presetKey, topSurf.span) / GRAV;
          const M2 = mass + loadKg;
          const cogL = [(mx + loadKg * topSurf.part.pos.x) / M2, (my + loadKg * topSurf.part.pos.y) / M2, (mz + loadKg * topSurf.part.pos.z) / M2];
          angLoaded = (Math.atan2(edge(cogL), cogL[1]) * 180) / Math.PI;
        }
        const ratio = height / baseDepth;
        antiTip = ratio > 2.5 || angLoaded < 10;
        tip = { angEmpty, angLoaded, ratio, loadKg, massKg: mass };
        checks.push({
          id: 'tip', title: 'Tipping stability',
          status: angLoaded < 5 ? 'fail' : antiTip ? 'advisory' : 'pass',
          value: `tipping angle ${fmtDeg(angLoaded)} loaded · ${fmtDeg(angEmpty)} empty · height/depth ${ratio.toFixed(1)}`,
          threshold: '≥ 10° loaded, height/depth ≤ 2.5 — otherwise a wall anchor is mandatory',
          explain: antiTip
            ? `Tall or top-heavy${loadKg ? ` with ${U().fmtPointLoad(loadKg)} on the top surface` : ''}: an anti-tip wall anchor is added to the BOM and assembly steps (mandatory, not optional).`
            : 'Stable footprint: the piece resists tipping even with the top surface fully loaded.',
          fixes: []
        });
      }
    }

    /* ---- open-drawer tipping (ASTM F2057 / STURDY intent — audit F-S0-1) ----
     * Empty unit, every drawer open to 2/3 travel, 22.7 kg (50 lb) applied at
     * the front of the highest open drawer. Moment balance about the front
     * feet line. This is the scenario that puts dressers on top of children;
     * clothing-storage-height pieces (≥ 686 mm) FAIL below margin 1. */
    if (model.drawers && model.drawers.length) {
      const TEST_KG = 22.7, OPEN_FRACTION = 2 / 3;
      const drawerOf = new Map();
      model.drawers.forEach(d => d.partIds.forEach(id => drawerOf.set(id, d)));
      const feet = custom ? parts.filter(p => grounded.has(p.id)) : parts.filter(p => p.pos.y - p.size.h / 2 < 95);
      let zF = -Infinity;
      for (const f of feet) for (const c of Geo.obbCorners(Geo.partOBB(f))) if (c[1] < 130) zF = Math.max(zF, c[2]);
      if (isFinite(zF)) {
        let stab = 0, over = 0;
        for (const p of parts) {
          const dens = p.material === 'baltic_birch' ? densityOf('baltic_birch') : p.material === 'hardware' ? 3000 : densityOf(spec.wood.species);
          const volFactor = p.prim === 'cylinder' ? Math.PI / 4 : 1;
          const m = p.size.w * p.size.h * p.size.d * 1e-9 * dens * volFactor;
          const dr = drawerOf.get(p.id);
          const z = p.pos.z + (dr ? dr.travel * OPEN_FRACTION : 0);
          const moment = m * GRAV * (zF - z); // + stabilizes, − overturns
          if (moment >= 0) stab += moment; else over += -moment;
        }
        // 22.7 kg on the front face of the highest open drawer.
        const top = model.drawers.reduce((a, b) => (a.opening.yTop > b.opening.yTop ? a : b));
        const frontPart = parts.find(p => p.id === top.partIds.find(id => /front$/.test(id) && !/boxfront/.test(id))) || parts.find(p => p.id === top.partIds[0]);
        const zLoad = (frontPart ? frontPart.pos.z + frontPart.size.d / 2 : zF) + top.travel * OPEN_FRACTION;
        over += TEST_KG * GRAV * Math.max(0, zLoad - zF);
        const margin = over > 0 ? stab / over : Infinity;
        const inScope = spec.overall.height >= 686; // F2057 covers clothing storage ≥ 27 in
        const status = margin >= 1.5 ? 'pass' : margin >= 1 ? 'advisory' : (inScope ? 'fail' : 'advisory');
        // Anchor mandatory when it actually tips, or when a clothing-storage-
        // height piece runs a thin margin (the regulated scenario).
        if (margin < 1 || (inScope && margin < 1.5)) antiTip = true;
        checks.push({
          id: 'tip_f2057', title: 'Tipping — drawers open (F2057)',
          status,
          value: `margin ${margin === Infinity ? '∞' : margin.toFixed(2) + '×'} with all drawers open ⅔ and ${U().fmtPointLoad(TEST_KG)} on the top drawer front`,
          threshold: `≥ 1× to stand, ≥ 1.5× to skip the anchor — aligned with ASTM F2057 / STURDY (${U().fmtPointLoad(TEST_KG)} on an open drawer)`,
          explain: margin >= 1.5
            ? 'Even with every drawer open and a child-weight pull on the top one, the piece stays planted.'
            : margin >= 1
              ? `It stands, but the margin is thin${inScope ? ' at clothing-storage height (F2057 territory) — the anti-tip wall anchor is added and required' : ' — anchor it if children are around'}.`
              : 'With drawers open and weight on the top front, this piece TIPS. The wall anchor is mandatory — and this check follows the same scenario regulators test dressers against.',
          fixes: [],
          data: { marginRatio: margin, stabilizingNmm: stab, overturningNmm: over, testKg: TEST_KG, openFraction: OPEN_FRACTION }
        });
      }

      /* ---- slide capacity vs drawer size (audit F-S3-6) ---- */
      const slideRow = (K.FASTENERS.hardware || []).find(h => h.key === 'slide_pair');
      const capKg = slideRow && slideRow.capacityKg;
      if (capKg) {
        const DENSITY_KG_PER_L = 0.24; // general household storage; paper runs ~0.72
        let worst = null;
        for (const d of model.drawers) {
          if (d.runner !== 'side_mount_slides') continue;
          const volL = Math.max(0, (d.box.w - 2 * d.box.t) * (d.box.h - d.box.t) * (d.box.d - d.box.t)) * 1e-6;
          const estKg = volL * DENSITY_KG_PER_L;
          if (!worst || estKg > worst.estKg) worst = { d, volL, estKg };
        }
        if (worst) {
          const fileKg = worst.volL * 0.72;
          const overCap = worst.estKg > capKg;
          checks.push({
            id: 'slide:dr' + worst.d.index, title: 'Drawer slide capacity',
            status: overCap ? 'advisory' : 'pass',
            value: `largest drawer ≈ ${U().fmtPointLoad(worst.estKg)} loaded vs ${U().fmtPointLoad(capKg)} slide rating (pair)`,
            threshold: `≤ ${U().fmtPointLoad(capKg)} per pair (75 lb-class ball-bearing slides)`,
            explain: (overCap
              ? 'Packed full, this drawer would exceed its slide rating — specify 100 lb slides or split the storage.'
              : 'Everyday storage sits inside the slide rating.') +
              (fileKg > capKg ? ` Loaded with paper or files (~0.72 kg/L) it would reach ${U().fmtPointLoad(fileKg)} — beyond the rating; use file-rated slides for that duty.` : ''),
            fixes: [],
            data: { estKg: worst.estKg, capKg, volumeL: worst.volL }
          });
        }
      }
    }

    /* ---- racking score: transparent heuristic, 0–100, factors listed ---- */
    const rack = { factors: [], score: 0 };
    {
      let raw = 0;
      const addPts = (label, pts) => { rack.factors.push({ label, pts: Math.round(pts * 10) / 10 }); raw += pts; };
      const byJoint = new Map();
      for (const j of model.joints) byJoint.set(j.type, (byJoint.get(j.type) || 0) + 1);
      for (const [joint, n] of byJoint) {
        const r = JOINT_RATING[joint];
        if (r) addPts(`${n} × ${K.JOINERY[joint] ? K.JOINERY[joint].label.toLowerCase() : joint}`, n * r.rackPts * sgF);
      }
      const mults = [];
      const hasRole = r => parts.some(p => p.role === r);
      if (!custom) {
        if (hasRole('apron')) mults.push({ label: 'apron frame ties the legs', mult: 1.2 });
        if (hasRole('rail')) mults.push({ label: 'drawer rails triangulate the frame', mult: 1.1 });
        if (hasRole('back')) mults.push({ label: 'back panel acts as a shear panel', mult: 1.5 });
        if (spec.joinery.case === 'dado' && hasRole('shelf')) mults.push({ label: 'fixed shelves housed in dados', mult: 1.15 });
      } else {
        const connCount = new Map();
        for (const c of (spec.custom && spec.custom.connections) || []) {
          connCount.set(c.a, (connCount.get(c.a) || 0) + 1);
          connCount.set(c.b, (connCount.get(c.b) || 0) + 1);
        }
        if (parts.some(p => (p.prim === 'panel' || p.prim === 'slab') && (connCount.get(p.id) || 0) >= 2)) mults.push({ label: 'panel/slab braces the frame', mult: 1.3 });
        if (parts.filter(p => p.prim === 'rail').length >= 2) mults.push({ label: 'rails stiffen the frame', mult: 1.15 });
      }
      for (const m of mults) { rack.factors.push({ label: m.label, mult: m.mult }); raw *= m.mult; }
      rack.score = Math.round(Math.min(100, raw));
      const fixes = [];
      if (rack.score < 40) {
        if (CARCASS.includes(t) && !spec.structure.backPanel) fixes.push({ id: 'back', label: 'Add a back panel', patch: { structure: { backPanel: true } } });
        if (CARCASS.includes(t) && spec.joinery.case !== 'dado' && allowed.includes('dado')) fixes.push({ id: 'dados', label: 'House shelves in dados', patch: { joinery: { case: 'dado' } } });
        if (TABLE_LIKE.includes(t) && spec.joinery.frame !== 'mortise_tenon' && allowed.includes('mortise_tenon')) fixes.push({ id: 'mt', label: 'Mortise & tenon frame', patch: { joinery: { frame: 'mortise_tenon' } } });
        if (TABLE_LIKE.includes(t) && spec.joinery.frame === 'butt_screws') fixes.push({ id: 'pocket', label: 'Pocket-screw the frame', patch: { joinery: { frame: 'pocket_screws' } } });
      }
      const cheapFix = TABLE_LIKE.includes(t) ? 'stronger frame joints or a lower shelf' : custom ? 'a stretcher or panel between the uprights' : 'a fastened back panel and dado-housed shelves';
      checks.push({
        id: 'rack', title: 'Racking resistance', status: rack.score < 40 ? 'advisory' : 'pass',
        value: `score ${rack.score} / 100`, threshold: '≥ 40 (heuristic, not physics)',
        explain: rack.score < 40
          ? `The joints alone won't stop side-to-side wobble. Cheapest effective fix: ${cheapFix}.`
          : 'Joinery and bracing elements give this piece good resistance to side-to-side wobble.',
        fixes, factors: rack.factors
      });
    }

    /* ---- leg slenderness: unbraced length / least thickness > 20 ---- */
    {
      const legs = custom
        ? parts.filter(p => (p.prim === 'post' || p.prim === 'cylinder') && p.loadBearing)
        : parts.filter(p => p.role === 'leg');
      if (legs.length) {
        const braced = custom
          ? legs.some(l => ((spec.custom && spec.custom.connections) || []).some(c => {
              const other = c.a === l.id ? c.b : c.b === l.id ? c.a : null;
              const q = other && byId.get(other);
              return q && q.pos.y > 0.15 * l.size.h && q.pos.y < 0.75 * l.size.h;
            }))
          : parts.some(p => p.role === 'shelf' || p.role === 'rail');
        const worst = legs.reduce((m, l) => {
          const len = l.size.h * (braced ? 0.6 : 1);
          const minT = Math.min(l.size.w, l.size.d);
          const r = len / minT;
          return r > m.r ? { r, l } : m;
        }, { r: 0, l: null });
        if (worst.l) {
          const fixes = [];
          const up = nextSolidUp(Math.min(worst.l.size.w, worst.l.size.d));
          if (!custom && up) fixes.push({ id: 'thick-leg', label: `Thicken legs to ${fmtLen(Math.min(100, worst.l.size.w + 15))}`, patch: { structure: { legThickness: Math.min(100, worst.l.size.w + 15) } } });
          if (custom && up) {
            const newParts = spec.custom.parts.map(p => p.id === worst.l.id ? { ...p, dim: { ...p.dim, t: up, w: Math.max(p.dim.w, up) } } : p);
            fixes.push({ id: 'thick-' + worst.l.id, label: `Thicken ${worst.l.id}`, patch: { custom: { parts: newParts, connections: spec.custom.connections } } });
          }
          checks.push({
            id: 'slender', title: 'Leg slenderness', status: worst.r > 20 ? 'advisory' : 'pass',
            value: `worst L/t = ${worst.r.toFixed(1)}${braced ? ' (braced)' : ''}`, threshold: '≤ 20 unbraced length / least thickness',
            explain: worst.r > 20 ? 'Long thin legs bow under load and feel wobbly — add bracing or use thicker stock.' : 'Legs are stocky enough for their unbraced length.',
            fixes: worst.r > 20 ? fixes : []
          });
        }
      }
    }

    /* ---- joint adequacy: load per joint vs SG-scaled capacity ----
     * Custom screw joints bearing on END GRAIN carry only 0.67 of their
     * side-grain capacity (NDS end-grain factor; audit F-S2-7). */
    {
      let weakest = null;
      const specParts = custom ? new Map(((spec.custom && spec.custom.parts) || []).map(p => [p.id, p])) : null;
      for (const s of surfaces) {
        const N = totalLoadN(s.presetKey, s.span);
        let joint = null, count = 2, where = '', slot = null, endGrain = false;
        if (custom) {
          const conns = ((spec.custom && spec.custom.connections) || []).filter(c => c.a === s.id || c.b === s.id);
          if (!conns.length) continue;
          count = conns.length;
          let minCap = Infinity;
          for (const c of conns) {
            const rating0 = JOINT_RATING[c.joint] || JOINT_RATING.butt_screws;
            let capC = rating0.capN;
            const pa = specParts.get(c.a), pb = specParts.get(c.b);
            const screwed = c.joint === 'butt_screws' || c.joint === 'pocket_screws';
            const eg = screwed && pa && pb && (BB.Spec.endGrainBearing(pa, pb) || BB.Spec.endGrainBearing(pb, pa));
            if (eg) capC *= 0.67;
            if (capC < minCap) { minCap = capC; joint = c.joint; endGrain = !!eg; }
          }
          where = s.id;
        } else if (TABLE_LIKE.includes(t)) {
          if (s.part.role === 'top') { joint = spec.joinery.frame; count = 8; where = 'apron–leg'; slot = 'frame'; }
          else { joint = spec.joinery.case; count = 4; where = 'shelf–leg'; slot = 'case'; }
        } else {
          joint = spec.joinery.case; count = 2; where = `${s.part.role}–side`; slot = 'case';
        }
        const rating = JOINT_RATING[joint] || JOINT_RATING.butt_screws;
        const cap = rating.capN * sgF * (endGrain ? 0.67 : 1);
        const per = N / count;
        const margin = cap / per;
        if (!weakest || margin < weakest.margin) weakest = { margin, joint, where, per, cap, slot, endGrain };
      }
      if (weakest) {
        const jLabel = k => K.JOINERY[k] ? K.JOINERY[k].label.toLowerCase() : k;
        const fixes = [];
        if (weakest.margin < 1.5) {
          const stronger = ['mortise_tenon', 'dado', 'dowels', 'pocket_screws'].find(j =>
            allowed.includes(j) && (JOINT_RATING[j].capN > (JOINT_RATING[weakest.joint] || JOINT_RATING.butt_screws).capN) &&
            (!weakest.slot || K.jointAllowed(j, level, weakest.slot)));
          if (stronger && weakest.slot) fixes.push({ id: 'upjoint', label: `Upgrade ${weakest.where} to ${jLabel(stronger)}`, patch: { joinery: { [weakest.slot]: stronger } } });
        }
        checks.push({
          id: 'joints', title: 'Joint adequacy',
          status: weakest.margin >= 1.5 ? 'pass' : weakest.margin >= 1 ? 'advisory' : 'fail',
          value: `weakest: ${jLabel(weakest.joint)} at ${weakest.where}${weakest.endGrain ? ' (end grain, ×0.67)' : ''} — ${U().fmtPointLoad(weakest.per / GRAV)} per joint vs ${U().fmtPointLoad(weakest.cap / GRAV)} capacity`,
          threshold: '≥ 1.5× capacity margin (SG-scaled joint ratings)',
          explain: (weakest.margin >= 1.5 ? 'Every joint carries its share of the load path with room to spare.'
            : `The ${jLabel(weakest.joint)} joints at ${weakest.where} are the weak link in the load path.`) +
            (weakest.endGrain ? ' Screws at this joint bear on end grain, which holds about a third less (derated ×0.67) — a dowel, tenon, or cleat would restore full capacity.' : ''),
          fixes
        });
      }
    }

    /* ---- seasonal wood movement (Phase 4 — completes the integrity engine) ----
     * movement = cross-grain width × coefficient × ΔMC. Plywood is exempt:
     * cross-laminated plies cancel each other's movement. */
    {
      const panels = parts.filter(p =>
        ['top', 'seat', 'shelf', 'side', 'bottom'].includes(p.role) || (custom && (p.prim === 'slab' || p.prim === 'panel')));
      const seen = new Set();
      for (const p of panels) {
        // Cross-grain width: the panel dimension perpendicular to the grain.
        const crossW = custom && p.cutDim ? (p.grain === 'width' ? p.cutDim.L : p.cutDim.W)
          : Math.min(p.size.w, p.size.d) === 0 ? 0 : (p.role === 'side' ? p.size.d : Math.min(p.size.w, p.size.d));
        if (crossW < 300) continue; // narrow stock moves too little to matter
        const key = p.role + ':' + Math.round(crossW);
        if (seen.has(key)) continue;
        seen.add(key);
        if (p.material === 'baltic_birch') {
          checks.push({
            id: 'move:' + p.id, title: `Movement — ${p.name}`, status: 'pass',
            value: `plywood: ~${fmtFine(0)} seasonal movement`,
            threshold: `≤ ${fmtFine(MOVEMENT_LIMIT)} across the grain`,
            explain: 'Plywood is exempt: cross-laminated plies restrain each other, so seasonal moisture swings produce no meaningful dimensional change.',
            fixes: [],
            data: { movementMM: 0, crossWidthMM: crossW }
          });
          continue;
        }
        const mv = K.movementMM(crossW, spec.wood.species, 'tangential', dMC);
        /* Attachment context (audit F-S2-3): the advisory must agree with how
         * THIS plan actually holds the panel.
         *  floated   — table-like tops/seats: the plan itself specifies
         *              figure-8s/buttons, so the movement is absorbed.
         *  captured  — cross-grain fixed to something that does not move the
         *              same way (solid side against a plywood back; a shelf
         *              notched around legs): the genuine split risk.
         *  compatible— solid panels housed in solid sides that move across
         *              the same axis at the same rate.
         *  custom    — attachment unknown: warn with the fix, as before. */
        let ctx = 'custom';
        if (!custom) {
          if ((p.role === 'top' || p.role === 'seat') && TABLE_LIKE.includes(t)) ctx = 'floated';
          else if (p.role === 'side') ctx = spec.structure.backPanel ? 'captured' : 'compatible';
          else if (p.role === 'shelf' && TABLE_LIKE.includes(t)) ctx = 'captured'; // notched around the legs
          else if (['top', 'bottom', 'shelf', 'seat'].includes(p.role)) ctx = 'compatible';
        }
        const formula = `${fmtLen(crossW)} × ${sp.ct} (tangential coefficient) × ${dMC}% ΔMC = ${fmtFine(mv)}.`;
        const cupNote = (sp.movement === 'high' && (p.role === 'top' || p.role === 'seat') && crossW >= K.WIDE_TOP_MM)
          ? ' Flat-sawn ' + sp.label.toLowerCase() + ' this wide also wants to cup — alternate growth rings or use quartersawn stock.' : '';
        let status, explain;
        if (ctx === 'floated') {
          status = cupNote ? 'advisory' : 'pass';
          explain = `${formula} The plan already floats this panel on figure-8s/buttons (see the BOM and assembly), so the movement is absorbed — never glue it down.${cupNote}`;
        } else if (ctx === 'compatible') {
          status = 'pass';
          explain = `${formula} The panel and the solid parts it joins move across the grain in the same direction at the same rate — they travel together, so nothing captures anything.`;
        } else if (ctx === 'captured') {
          const over = mv > MOVEMENT_LIMIT;
          status = over ? 'advisory' : 'pass';
          const what = p.role === 'side' ? 'The plywood back does not move, but this solid panel does' : 'This panel is captured across the grain';
          explain = `${formula}${over ? ` ${what} — elongate the screw holes across the grain (slot, don't just drill) so the panel can travel, or it will split at the fasteners.` : ' Within tolerance for a captured panel.'}`;
        } else {
          const over = mv > MOVEMENT_LIMIT;
          status = over ? 'advisory' : 'pass';
          explain = `${formula}${over ? ' Attachment is design-specific on a novel piece: let this panel move — elongated screw holes across the grain, buttons/figure-8s for tops, and never a cross-grain glue line.' : ' Within tolerance.'}${cupNote}`;
        }
        checks.push({
          id: 'move:' + p.id, title: `Movement — ${p.name}`,
          status,
          value: `${fmtFine(mv)} seasonal movement across ${fmtLen(crossW)}`,
          threshold: `≤ ${fmtFine(MOVEMENT_LIMIT)} where cross-grain captured`,
          explain,
          fixes: [],
          data: { movementMM: mv, crossWidthMM: crossW, context: ctx },
          prov: { rule: `movement = width × coefficient × ΔMC = ${Math.round(crossW)} × ${sp.ct} × ${dMC}` }
        });
      }
    }

    const summary = {
      worstSag: worstSag ? { ...worstSag } : null,
      tipLoaded: tip ? tip.angLoaded : null,
      rackScore: rack.score,
      fails: checks.filter(c => c.status === 'fail').length,
      advisories: checks.filter(c => c.status === 'advisory').length
    };
    return { checks, surfaces, antiTip, tip, racking: rack, summary };
  }

  /* Short chip strings describing what changed between two integrity results. */
  function integrityDiff(before, after) {
    const chips = [];
    if (before.summary.worstSag && after.summary.worstSag) {
      const a = before.summary.worstSag.sag, b = after.summary.worstSag.sag;
      if (Math.abs(a - b) > 0.05) chips.push(`sag ${fmtFine(a)} → ${fmtFine(b)}`);
    }
    if (before.summary.tipLoaded != null && after.summary.tipLoaded != null) {
      const a = before.summary.tipLoaded, b = after.summary.tipLoaded;
      if (Math.abs(a - b) > 0.3) chips.push(`tip ${a.toFixed(1)}° → ${b.toFixed(1)}°`);
    }
    if (before.summary.rackScore !== after.summary.rackScore) chips.push(`racking ${before.summary.rackScore} → ${after.summary.rackScore}`);
    const df = after.summary.fails - before.summary.fails;
    if (df !== 0) chips.push(`${Math.abs(df)} check${Math.abs(df) > 1 ? 's' : ''} ${df < 0 ? 'fixed' : 'now failing'}`);
    return chips;
  }

  BB.Structural = {
    LOAD_PRESETS, PRESET_KEYS, presetDetail, JOINT_RATING, SAFETY_FACTOR,
    SAG_LIMIT_RATIO, CANT_LIMIT_RATIO, MOVEMENT_LIMIT, GRAV,
    CREEP_FACTOR,
    I_rect, DEFL, MOM, loadCasesFor, totalLoadN, evalBeam,
    surfacesOf, computeIntegrity, integrityDiff, defaultPresetFor, nextSolidUp
  };
})();
