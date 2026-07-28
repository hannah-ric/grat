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
  /* Per-part material honesty (2026 expansion): a part whose `material` is a
   * real species row (any sheet stock, or a solid that differs from the
   * primary) is judged with ITS OWN species data; anything else — 'hardware',
   * the bare 'solid' default on rails — falls back to the design's primary
   * species, exactly as before. */
  const materialSpeciesKey = (p, spec) =>
    K.WOOD_SPECIES[p.material] ? p.material : spec.wood.species;
  const partDensity = (p, spec) =>
    p.material === 'hardware' ? 3000 : densityOf(materialSpeciesKey(p, spec));
  const nextSolidUp = t => K.SOLID_THICKNESS.find(x => x > t) || null;
  /* G15 (finding B12): the tappable thickness fix must be SOLVED against the
   * failing check, not one blind stock step (simple2's "thicken to 20 mm"
   * left the shelf at 5.33 mm vs a 2.87 limit). Closed form: sag scales
   * 1/t³ (I = b·t³/12) and bending stress 1/t², so the first passing
   * thickness is t·∛(sag/limit) or t·√(1.25·stress/allow) — whichever
   * governs — snapped UP the stock table. When even the biggest stock
   * falls short, it is offered honestly as a partial step. */
  function solveThicknessFix(h, sagRatio, stress, allow) {
    let need = h;
    if (sagRatio > 1) need = Math.max(need, h * Math.cbrt(sagRatio));
    if (allow > 0 && stress > 0 && allow / stress < 1.25) need = Math.max(need, h * Math.sqrt((1.25 * stress) / allow));
    if (need <= h + 0.05) return null;
    const t = K.SOLID_THICKNESS.find(x => x > h && x >= need - 1e-6);
    if (t) return { t, partial: false };
    const biggest = K.SOLID_THICKNESS[K.SOLID_THICKNESS.length - 1];
    return biggest > h ? { t: biggest, partial: true } : null;
  }
  /* House wording for a fix that helps but does not finish the job. The
   * thickness fix has said this since G15; every fix says it the same way. */
  const PARTIAL_LIMIT = ' (partial fix — still over the limit)';
  const PARTIAL_MARGIN = ' (partial fix — still under the margin)';
  /* Verdicts, single-sourced so a fix is judged by exactly the code that
   * judges the check. ONE rule governs every tappable fix: it must move the
   * check's verdict UP, and a fix that would leave it failing is never
   * offered — a fix that does not fix is worse than no fix. */
  const sagStatus = r => r <= 1 ? 'pass' : r <= 1.5 ? 'advisory' : 'fail';
  const strStatus = m => m >= 1.25 ? 'pass' : m >= 1 ? 'advisory' : 'fail';
  const jointStatus = m => m >= 1.5 ? 'pass' : m >= 1 ? 'advisory' : 'fail';
  const RANK = { fail: 0, advisory: 1, pass: 2 };
  const better = (a, b) => RANK[a] > RANK[b];
  const worse = (a, b) => RANK[a] < RANK[b];
  /* The OTHER code-owned answer to a sagging or over-stressed member: a
   * stiffer species, no new geometry (B-fixes-1). Solved against the failing
   * check exactly like the thickness fix — sag scales 1/E and the bending
   * margin scales with MOR, so every candidate's outcome is closed form.
   * Sheet goods are excluded: plywood and MDF are not solid-wood substitutes
   * (and a wood.species patch never touches a part cut from a sheet). */
  const solidSpecies = () => Object.values(K.WOOD_SPECIES).filter(w => !w.sheet);
  const STIFFEST_FIRST = solidSpecies().sort((a, b) => b.moe - a.moe).map(w => w.key);
  const STRONGEST_FIRST = solidSpecies().sort((a, b) => b.mor - a.mor).map(w => w.key);
  /* `focus` names the check this fix will be OFFERED ON — 'sag' or 'str' —
   * because the two checks of one surface are judged separately: a species
   * that rescues the bending margin but leaves the shelf sagging belongs on
   * the strength check only. The candidate must lift the focused verdict and
   * may never drop the other one. */
  function solveSpeciesFix(curKey, sagRatio, stress, allow, focus) {
    const cur = speciesOf(curKey);
    const finite = stress > 0 && isFinite(stress);
    const s0 = sagStatus(sagRatio), t0 = strStatus(finite ? allow / stress : Infinity);
    if ((focus === 'str' ? t0 : s0) === 'pass') return null;
    for (const key of (focus === 'str' ? STRONGEST_FIRST : STIFFEST_FIRST)) {
      if (key === curKey) continue; // never offer the species already in the design
      const c = speciesOf(key);
      const s1 = sagStatus(sagRatio * (cur.moe / c.moe));
      const t1 = strStatus(finite ? (c.mor / SAFETY_FACTOR) / stress : Infinity);
      /* Stiffer is not automatically stronger: Douglas-fir out-stiffens ash
       * and breaks sooner. A candidate never trades one verdict for the other. */
      if (worse(s1, s0) || worse(t1, t0)) continue;
      if (!better(focus === 'str' ? t1 : s1, focus === 'str' ? t0 : s0)) continue;
      return { key, label: c.label, partial: (focus === 'str' ? t1 : s1) !== 'pass' };
    }
    return null;
  }
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
    /* 136 kg = the BIFMA X5.1 §8 / X5.4 drop-test PROOF mass (300 lb);
     * the functional drop mass is 225 lb, and no static seat test exists in
     * either standard — designing statically to the proof mass is the
     * conservative, honestly-labeled alignment (2026-07 seating class). */
    seating: { label: 'Seated people', kind: 'seat', kgSeat: 136, sustained: false, basis: 'aligned to BIFMA X5.1/X5.4 drop-test proof mass, 300 lb (functional drop is 225 lb)' },
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
    /* A custom part tagged 'shelf' gets the same book duty the bookshelf
     * template uses (G4/B3): a novel BOOKSHELF was being checked at display
     * 10 kg/m — 1/6 of the duty its template twin assumes. Template shelf
     * kinds (a table's lower shelf, a nightstand top) keep display duty.
     * Wall shelves take book duty too — that is what people put on them. */
    if (template === 'bookshelf' || template === 'cabinet' || template === 'custom' || template === 'wall_shelf') return 'books';
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
    mortise_tenon: { rackPts: 6.0, capN: 2000 },
    /* 2026 expansion — calibrated to the FWW #203 lab ordering (half lap >
     * bridle > splined miter > M&T > floating tenon … pocket > biscuit) and
     * then aged: the fresh-strong splined miter derates for seasonal stress,
     * biscuits stay the honest alignment aid, steel KD bolts sit under a
     * glued M&T because they loosen. Laps/bridles land just above M&T (as
     * tested) with the same rack contribution class as dovetails. */
    edge_glue:        { rackPts: 5.0, capN: 2200 },
    half_lap:         { rackPts: 5.5, capN: 2100 },
    cross_lap:        { rackPts: 5.5, capN: 2100 },
    bridle:           { rackPts: 5.5, capN: 2100 },
    loose_tenon:      { rackPts: 5.5, capN: 1900 },
    box_joint:        { rackPts: 5.5, capN: 2000 },
    through_dovetail: { rackPts: 6.0, capN: 2100 },
    sliding_dovetail: { rackPts: 5.0, capN: 1600 },
    miter_spline:     { rackPts: 4.0, capN: 1300 },
    staked_tenon:     { rackPts: 5.5, capN: 1800 },
    biscuits:         { rackPts: 2.5, capN: 600 },
    french_cleat:     { rackPts: 3.0, capN: 1500 },
    kd_bolt:          { rackPts: 4.5, capN: 1800 }
  };
  /* Upgrade vocabulary for the tappable joint fix, strongest answer first.
   * The head four are the historical order (unchanged, so template designs
   * keep the joint they were already offered); the tail is what a shop
   * reaches for when level or part geometry rules the head out. CURATED,
   * not a raw capN sort: only joints that ATTACH one part to another belong
   * here — an edge glue-up makes a panel wider and a biscuit is an alignment
   * aid, so neither is ever the answer to a joint that is pulling apart.
   * Level (K.jointsForLevel) and pair-kind gating apply on top. */
  const JOINT_UPGRADES = [
    'mortise_tenon', 'dado', 'dowels', 'pocket_screws',
    'through_dovetail', 'half_lap', 'bridle', 'box_joint', 'loose_tenon',
    'half_blind_dovetail', 'kd_bolt', 'staked_tenon', 'sliding_dovetail',
    'cross_lap', 'miter_spline', 'locking_rabbet', 'rabbet'
  ];

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
  // Templates that can actually take a stretcher — mirrors Spec.FRAME_TEMPLATES
  // (nightstand's drawer bank fills the space a stretcher would span), so a
  // fix is never offered on a piece correction would refuse to build.
  const FRAME_TEMPLATES = ['table', 'desk', 'bench'];
  const CARCASS = ['bookshelf', 'cabinet'];

  function surfacesOf(spec, model, loadChoices, defaultLoad) {
    const t = spec.meta.template;
    const out = [];
    const push = s => {
      const chosen = !!(loadChoices && loadChoices[s.id] && LOAD_PRESETS[loadChoices[s.id]]);
      s.presetKey = chosen ? loadChoices[s.id] : defaultPresetFor(s.kind, t, defaultLoad);
      s.userChosen = chosen; // a user pick is never an "assumed" load (G4)
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
        /* Desk apron drawers replace the front apron with a shallow lower
         * rail — the band's weakest member governs the pair, so the rail
         * joins the candidate list and the pair is judged at the MIN height
         * (identical pairs are unchanged, so the frozen corpus is too). */
        const aprons = parts.filter(p => p.role === 'apron' || p.id === 'rail_lower_1');
        const alongX = aprons.filter(a => a.size.w >= a.size.d);
        const alongZ = aprons.filter(a => a.size.d > a.size.w);
        const pick = (list, axis) => {
          if (list.length < 2) return null;
          return {
            id: list[0].id, len: Math.max(...list.map(a => axis === 'x' ? a.size.w : a.size.d)),
            off: Math.max(...list.map(a => axis === 'x' ? Math.abs(a.pos.z) : Math.abs(a.pos.x))),
            t: axis === 'x' ? list[0].size.d : list[0].size.w,
            h: Math.min(...list.map(a => a.size.h)), axis
          };
        };
        const px = pick(alongX, 'x'), pz = pick(alongZ, 'z');
        const pair = (px && pz) ? (px.len >= pz.len ? px : pz) : (px || pz);
        let apron = null, strip = null;
        if (pair) {
          apron = { id: pair.id, span: Math.max(100, pair.len), b: pair.t, h: pair.h };
          /* Unequal pair (desk drawer band): the full rear apron and the
           * shallow front rail share by stiffness (the fastened top forces
           * equal deflection), and the rail's own span runs opening-wide —
           * the centre stile, hung from the top, posts it at midspan. */
          const hs = alongX.length >= 2 && pair.axis === 'x' ? alongX.map(a => a.size.h) : (pair.axis === 'z' ? alongZ.map(a => a.size.h) : []);
          const hStrong = hs.length ? Math.max(...hs) : pair.h;
          if (hStrong > pair.h + 0.1) {
            apron.hStrong = hStrong;
            apron.weakSpan = model.openings && model.openings.length
              ? Math.max(100, Math.max(...model.openings.map(op => op.w)))
              : apron.span;
          }
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
    } else if (t === 'wall_shelf') {
      /* Wall-mounted: the shelf cantilevers its DEPTH off the cleat line —
       * the wall:anchor check below prices the couple the cantilever throws
       * into the fixings. */
      const shelf = parts.find(p => p.id === 'shelf_1');
      if (shelf) {
        const G2 = BB.Classes ? BB.Classes.get('wall_mounted').geom : { CLEAT_T: 19 };
        push({
          id: shelf.id, part: shelf, label: 'Shelf', kind: 'shelf', model: 'cant',
          span: Math.max(60, shelf.size.d - 2 * G2.CLEAT_T), b: shelf.size.w, h: shelf.size.h, over: 0
        });
      }
    } else if (t === 'chair') {
      /* Seating: the SIDE RAILS are the beams (front-back), the seat is a
       * plate strip spanning between them — the frame model the audit
       * established for tables, applied to the seat frame. Kind 'seat' pins
       * the seating preset. */
      const seat = parts.find(p => p.id === 'seat_1');
      const rails = parts.filter(p => p.id === 'rail_side_1' || p.id === 'rail_side_2');
      if (seat && rails.length === 2 && spec.seat) {
        const r = rails[0];
        const railSpan = Math.max(100, Math.max(r.size.d, r.size.w));
        const stripSpan = Math.max(80, spec.seat.width - 2 * spec.structure.apronThickness);
        push({
          id: seat.id, part: seat, label: 'Seat', kind: 'seat', model: 'ss',
          span: stripSpan, b: seat.size.d, h: seat.size.h, over: 0,
          apron: { id: r.id, span: railSpan, b: Math.min(r.size.w, r.size.d), h: r.size.h },
          strip: { span: stripSpan, bEff: Math.min(seat.size.d, 0.5 * stripSpan + 100) }
        });
      }
    } else if (t === 'custom') {
      // Declared surfaces; span model inferred from the connection graph.
      const byId = new Map(parts.map(p => [p.id, p]));
      const mkSurface = (p, kind, assumed) => {
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
        push(Object.assign({
          id: p.id, part: p, label: assumed ? `${p.name} (assumed shelf)` : p.name,
          model: mdl, span, b: Math.max(20, bHoriz), h: th, over: 0, kind
        }, assumed ? { assumed: true } : {}));
      };
      let tagged = 0;
      for (const p of parts) {
        if (!p.surface || p.surface === 'none') continue;
        tagged++;
        mkSurface(p, p.surface === 'seating' ? 'seat' : p.surface === 'worktop' ? 'top' : 'shelf', false);
      }
      /* G3 (finding B4): check coverage must never be model-discretionary.
       * If the wire author tagged nothing, derive the check surfaces: the
       * topmost horizontal slab/panel of each connected stack is what things
       * get put on — treat it as shelf duty, flagged `assumed` so the ack
       * and Safety tab disclose the assumption instead of skipping physics. */
      if (!tagged && parts.length) {
        const comp = new Map(parts.map(p => [p.id, p.id]));
        const find = id => { while (comp.get(id) !== id) { comp.set(id, comp.get(comp.get(id))); id = comp.get(id); } return id; };
        for (const c of (spec.custom && spec.custom.connections) || []) {
          if (comp.has(c.a) && comp.has(c.b)) comp.set(find(c.a), find(c.b));
        }
        const topPer = new Map(); // component root -> topmost horizontal slab/panel y
        const cand = [];
        for (const p of parts) {
          if (p.prim !== 'slab' && p.prim !== 'panel') continue;
          const ext = Geo.worldExtents(p);
          if (ext.y >= Math.max(ext.x, ext.z)) continue; // standing panel, not a surface
          const top = p.pos.y + ext.y / 2;
          const root = find(p.id);
          cand.push({ p, top, root });
          if (!topPer.has(root) || top > topPer.get(root)) topPer.set(root, top);
        }
        for (const c of cand) {
          if (c.top >= topPer.get(c.root) - 5) mkSurface(c.p, 'shelf', true); // ties (a slat deck) all derive
        }
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
    /* ΔMC: the corrected spec's exposure outranks the indoor climate
     * preference (2026-08 outdoor model) — an exposed build swings on the
     * outdoor EMC range (K.EXPOSURE_DMC, Wood Handbook ch. 13 sourced), an
     * interior build keeps the CLIMATE_DMC behavior byte-identically. */
    const dMC = K.effectiveDMC(spec.exposure, opts.climate);

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
        if (p.hardware) continue; // steel channels are not wood-density boxes
        const dens = partDensity(p, spec);
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

    /* G3 backstop: a custom with no tagged surface AND nothing derivable
     * (no horizontal slab/panel anywhere) must still never roll up a clean
     * pass with zero load physics — say so, out loud. */
    if (custom && parts.length && !surfaces.length) {
      checks.push({
        id: 'loadcheck', title: 'Load coverage', status: 'advisory',
        value: 'no load-bearing surface declared or derivable',
        threshold: 'at least one checked load surface',
        explain: 'No part is tagged as a load surface and none could be derived, so NO sag or strength physics ran on this design. Tag the parts things will rest or sit on.',
        fixes: []
      });
    }

    /* ---- beam checks per load-bearing surface: sag (MOE), strength (MOR/SF4) ----
     * Frame surfaces (table/desk/bench/nightstand tops) run the honest model
     * from the audit (F-S2-1): the APRONS are the beams over the leg-to-leg
     * span; the TOP is a plate strip spanning between the aprons. Everything
     * else stays a plain single-span (or cantilever) beam. */
    let worstSagRatio = 0, worstSag = null;
    /* Strength checks judge each member with ITS OWN species (msp): template
     * parts share the primary species, so nothing changes for them, but an
     * MDF or plywood surface is now judged with MDF/ply numbers — the
     * honest-fail doctrine (see the frozen ash-bookshelf case). */
    const strengthCheck = (id, label, M, h, I, preset, fixes, msp) => {
      msp = msp || sp;
      const allow = msp.mor / SAFETY_FACTOR;
      const stress = I > 0 ? (M * (h / 2)) / I : Infinity;
      const margin = stress > 0 ? allow / stress : Infinity;
      checks.push({
        id, title: `Strength — ${label}`,
        status: strStatus(margin),
        value: `bending stress ${stress.toFixed(1)} MPa · margin ${margin === Infinity ? '∞' : margin.toFixed(1) + '×'}`,
        threshold: `≤ ${allow.toFixed(1)} MPa (MOR ${msp.mor} MPa ÷ safety factor ${SAFETY_FACTOR})`,
        explain: margin >= 1 ? `Comfortably below the breaking stress of ${msp.label} with the standard ×${SAFETY_FACTOR} wood safety factor.`
          : `The “${preset.label}” load brings this part too close to breaking stress.`,
        fixes: margin < 1.25 ? fixes : []
      });
    };
    /* A `wood.species` patch moves only the parts that INHERIT the primary
     * species — a slab explicitly cut from plywood or walnut is untouched by
     * it, so the fix is never offered against one. */
    const withSpecies = (base, memberKey, sagRatio, stress, allow, focus) => {
      if (memberKey !== spec.wood.species) return base;
      const sol = solveSpeciesFix(spec.wood.species, sagRatio, stress, allow, focus);
      if (!sol) return base;
      return base.concat([{
        id: 'species-' + sol.key,
        label: `Switch to ${sol.label.toLowerCase()}${sol.partial ? PARTIAL_LIMIT : ''}`,
        patch: { wood: { species: sol.key } }
      }]);
    };
    for (const s of surfaces) {
      const preset = LOAD_PRESETS[s.presetKey];
      // The surface's own material: primary species for template parts,
      // the sheet species for sheet-stock slabs and panels.
      const ssp = speciesOf(materialSpeciesKey(s.part, spec));
      const Es = ssp.moe * 1000; // GPa -> MPa
      const fixes = [];
      /* The governing beam for THIS surface (strip or plain span), carried
       * out to the overhang check so its fix is judged on real numbers. */
      let surfKey = materialSpeciesKey(s.part, spec), surfStress = 0, surfAllow = 0;
      const sIsSheet = !!(K.WOOD_SPECIES[s.part.material] && K.WOOD_SPECIES[s.part.material].sheet);
      /* G15: the thickness fix is solved AGAINST the failing check (first
       * stock that passes, or an honest partial step) — so it is built after
       * the beam is evaluated, from the check's own ratio and stress. */
      const thicknessFix = (sagRatio, stress, allow) => {
        if (sIsSheet) return null; // sheet stock tops out — the remedy is structure, not a phantom thickness
        const solved = solveThicknessFix(s.h, sagRatio, stress, allow);
        if (!solved) return null;
        const suffix = solved.partial ? PARTIAL_LIMIT : '';
        if (!custom) {
          if (s.part.role === 'top' && TABLE_LIKE.includes(t)) return { id: 'thick-top', label: `Thicken top to ${fmtLen(solved.t)}${suffix}`, patch: { structure: { topThickness: solved.t } } };
          if (!s.apron) return { id: 'thick-shelf', label: `Thicken to ${fmtLen(solved.t)}${suffix}`, patch: { structure: { shelfThickness: solved.t } } };
          return null;
        }
        const newParts = spec.custom.parts.map(p => p.id === s.id ? { ...p, dim: { ...p.dim, t: solved.t } } : p);
        return { id: 'thick-' + s.id, label: `Thicken ${s.id} to ${fmtLen(solved.t)}${suffix}`, patch: { custom: { parts: newParts, connections: spec.custom.connections } } };
      };
      if (s.apron) {
        /* (a) Apron beam over the leg-to-leg span. Each of the pair carries
         * half the spread load. The point load's worst position is directly
         * above one apron; the top (fastened along both aprons) redistributes
         * at least a quarter of it to the partner, so one apron carries 3/4 —
         * still conservative against true composite action.
         *
         * UNEQUAL pair (desk drawer band): the fastened top forces equal
         * deflection, so the spread load splits by stiffness (h³); the point
         * load keeps at least a quarter on the member it lands over (the
         * mirror of the redistribution rule above). The weak member spans
         * its OPENING (the centre stile, hung from the top, posts it), the
         * strong member the full leg-to-leg run; the governing member is
         * reported. Equal pairs take the original path byte for byte. */
        const POINT_SHARE = 0.75;
        let Ia, sag, M, apEvalH = s.apron.h, apEvalSpan = s.apron.span;
        if (s.apron.hStrong) {
          const hW = s.apron.h, hS = s.apron.hStrong;
          const shareW = Math.pow(hW, 3) / (Math.pow(hW, 3) + Math.pow(hS, 3));
          const evalMember = (h, span, spreadShare, ptShare) => {
            const I = I_rect(s.apron.b, h);
            const cases = loadCasesFor(s.presetKey, span, 'ss')
              .map(c => ({ ...c, mag: c.fn.startsWith('udl') ? c.mag * spreadShare : c.mag * ptShare }));
            const r = evalBeam(cases, span, E, I);
            return { I, sag: r.sag, M: r.M, ratio: r.sag / (span / SAG_LIMIT_RATIO), h, span };
          };
          const weak = evalMember(hW, s.apron.weakSpan || s.apron.span, shareW, Math.max(shareW, 0.25));
          const strong = evalMember(hS, s.apron.span, 1 - shareW, POINT_SHARE);
          const gov = weak.ratio >= strong.ratio ? weak : strong;
          Ia = gov.I; sag = gov.sag; M = gov.M; apEvalH = gov.h; apEvalSpan = gov.span;
        } else {
          const cases = loadCasesFor(s.presetKey, s.apron.span, 'ss')
            .map(c => ({ ...c, mag: c.fn.startsWith('udl') ? c.mag * 0.5 : c.mag * POINT_SHARE }));
          Ia = I_rect(s.apron.b, s.apron.h);
          ({ sag, M } = evalBeam(cases, s.apron.span, E, Ia));
        }
        const limit = apEvalSpan / SAG_LIMIT_RATIO;
        const ratio = sag / limit;
        if (ratio > worstSagRatio) { worstSagRatio = ratio; worstSag = { id: s.id, sag, limit, span: apEvalSpan }; }
        const apFixes = [...fixes];
        if (spec.structure.apronHeight < 160) apFixes.unshift({ id: 'tall-apron', label: `Deepen aprons to ${fmtLen(Math.min(160, spec.structure.apronHeight + 30))}`, patch: { structure: { apronHeight: Math.min(160, spec.structure.apronHeight + 30) } } });
        const apStress = Ia > 0 ? (M * (apEvalH / 2)) / Ia : Infinity;
        const apAllow = sp.mor / SAFETY_FACTOR;
        checks.push({
          id: 'sag:apron:' + s.id, title: `Sag — aprons under ${s.label.toLowerCase()}`,
          status: sagStatus(ratio),
          value: `predicted sag ${fmtFine(sag)} over the ${fmtLen(apEvalSpan)} ${s.apron.hStrong ? 'governing band' : 'apron'} span`,
          threshold: `≤ ${fmtFine(limit)} (${U().fmtSagRate(SAG_LIMIT_RATIO)})`,
          explain: s.apron.hStrong
            ? `Drawer band: the full ${fmtLen(s.apron.hStrong)} rear apron and the ${fmtLen(s.apron.h)} front rail share the load by stiffness through the fastened top; the governing member (${fmtLen(apEvalH)} deep over ${fmtLen(apEvalSpan)}) is reported. Sustained loads include ×${CREEP_FACTOR} creep.`
            : `The aprons are the beams: each ${fmtLen(s.apron.b)} × ${fmtLen(s.apron.h)} apron carries half the spread load and, worst case, ¾ of the point load (the attached top shares the rest across). Sustained loads include ×${CREEP_FACTOR} creep.`,
          fixes: ratio > 1 ? withSpecies(apFixes, spec.wood.species, ratio, apStress, apAllow, 'sag') : [],
          data: { sagMM: sag, limitMM: limit, spanMM: s.apron.span },
          prov: { rule: `apron beam: I = t·h³/12 = ${Math.round(Ia).toLocaleString()} mm⁴, span ${Math.round(apEvalSpan)} mm, ${s.apron.hStrong ? 'stiffness-shared (h³) across the unequal band' : 'half the spread load per apron'}` }
        });
        strengthCheck('str:apron:' + s.id, `aprons under ${s.label.toLowerCase()}`, M, apEvalH, Ia, preset,
          withSpecies(apFixes, spec.wood.species, ratio, apStress, apAllow, 'str'), sp);

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
        const { sag: sagS, M: MS } = evalBeam(stripCases, s.strip.span, Es, Is);
        const limS = s.strip.span / SAG_LIMIT_RATIO;
        const rS = sagS / limS;
        if (rS > worstSagRatio) { worstSagRatio = rS; worstSag = { id: s.id, sag: sagS, limit: limS, span: s.strip.span }; }
        const stressS = Is > 0 ? (MS * (s.h / 2)) / Is : Infinity;
        const allowS = ssp.mor / SAFETY_FACTOR;
        const tFixS = thicknessFix(rS, stressS, allowS);
        if (tFixS) fixes.unshift(tFixS); // top thickness governs the strip, not the aprons
        surfKey = materialSpeciesKey(s.part, spec); surfStress = stressS; surfAllow = allowS;
        checks.push({
          id: 'sag:' + s.id, title: `Sag — ${s.label} between aprons`,
          status: sagStatus(rS),
          value: `predicted sag ${fmtFine(sagS)} across the ${fmtLen(s.strip.span)} between aprons`,
          threshold: `≤ ${fmtFine(limS)} (${U().fmtSagRate(SAG_LIMIT_RATIO)})`,
          explain: `${ssp.label} at ${fmtLen(s.h)} thick under the “${preset.label}” preset (${presetDetail(s.presetKey)}), checked as a ${fmtLen(s.strip.bEff)}-wide strip spanning between the aprons.`,
          fixes: rS > 1 ? withSpecies(fixes, surfKey, rS, stressS, allowS, 'sag') : [],
          data: { sagMM: sagS, limitMM: limS, spanMM: s.strip.span },
          prov: { rule: `plate strip: span ${Math.round(s.strip.span)} mm between apron faces, effective width min(top, span/2 + 100) = ${Math.round(s.strip.bEff)} mm, I = ${Math.round(Is).toLocaleString()} mm⁴` }
        });
        strengthCheck('str:' + s.id, s.label, MS, s.h, Is, preset, withSpecies(fixes, surfKey, rS, stressS, allowS, 'str'), ssp);
      } else {
        const I = I_rect(s.b, s.h);
        const cases = loadCasesFor(s.presetKey, s.span, s.model);
        const { sag, M, crept } = evalBeam(cases, s.span, Es, I);
        s._M = M; // root moment — the joint block prices cantilever couples off it (G2)
        const limit = s.model === 'cant' ? s.span / CANT_LIMIT_RATIO : s.span / SAG_LIMIT_RATIO;
        const ratio = sag / limit;
        if (ratio > worstSagRatio) { worstSagRatio = ratio; worstSag = { id: s.id, sag, limit, span: s.span }; }
        const stressB = I > 0 ? (M * (s.h / 2)) / I : Infinity;
        const allowB = ssp.mor / SAFETY_FACTOR;
        const tFix = thicknessFix(ratio, stressB, allowB);
        if (tFix) fixes.unshift(tFix);
        surfKey = materialSpeciesKey(s.part, spec); surfStress = stressB; surfAllow = allowB;
        checks.push({
          id: 'sag:' + s.id, title: `Sag — ${s.label}`,
          status: sagStatus(ratio),
          value: `predicted ${crept ? 'long-term ' : ''}sag ${fmtFine(sag)} over a ${fmtLen(s.span)} ${s.model === 'cant' ? 'cantilever' : 'span'}`,
          threshold: `≤ ${fmtFine(limit)} (${s.model === 'cant' ? `L/${CANT_LIMIT_RATIO} at the free end` : U().fmtSagRate(SAG_LIMIT_RATIO)})`,
          explain: `${ssp.label} at ${fmtLen(s.h)} thick under the “${preset.label}” preset (${presetDetail(s.presetKey)}). Stiffness comes from MOE (${ssp.moe} GPa) and thickness cubed.${crept ? ` Sustained load: includes ×${CREEP_FACTOR} creep (Wood Handbook ch. 4).` : ''}`,
          fixes: ratio > 1 ? withSpecies(fixes, surfKey, ratio, stressB, allowB, 'sag') : [],
          data: { sagMM: sag, limitMM: limit, spanMM: s.span },
          prov: { rule: `sag = Σ load cases (5wL⁴/384EI and friends${crept ? `, sustained cases ×${CREEP_FACTOR} creep` : ''}) with E = ${ssp.moe} GPa, I = bh³/12 = ${Math.round(I).toLocaleString()} mm⁴, L = ${Math.round(s.span)} mm` }
        });
        strengthCheck('str:' + s.id, s.label, M, s.h, I, preset, withSpecies(fixes, surfKey, ratio, stressB, allowB, 'str'), ssp);
      }

      if (s.over > 0 && s.kind === 'top') {
        const P = LOAD_PRESETS.worktop.kgEdge * GRAV;
        const IO = I_rect(s.b, s.h); // the top itself cantilevers past the frame
        const sagO = DEFL.pointCant(P, s.over, Es, IO);
        const limO = s.over / CANT_LIMIT_RATIO;
        const rO = sagO / limO;
        checks.push({
          id: 'cant:' + s.id, title: `Overhang — ${s.label}`,
          status: rO <= 1 ? 'pass' : rO <= 1.5 ? 'advisory' : 'fail',
          value: `edge deflection ${fmtFine(sagO)} on a ${fmtLen(s.over)} overhang`,
          threshold: `≤ ${fmtFine(limO)} (L/${CANT_LIMIT_RATIO}) under a ${U().fmtPointLoad(LOAD_PRESETS.worktop.kgEdge)} lean`,
          explain: 'Cantilever case: a person leaning at the worst edge position.',
          // Judged on the OVERHANG's own ratio — a species that rescues the
          // main span may do nothing visible out at the free edge.
          fixes: rO > 1 ? withSpecies(fixes, surfKey, rO, surfStress, surfAllow, 'sag') : [],
          data: { sagMM: sagO, limitMM: limO, spanMM: s.over }
        });
      }

      if (s.kind === 'top' && ssp.janka < 1000) {
        checks.push({
          id: 'duty:' + s.id, title: `Surface durability — ${s.label}`, status: 'advisory',
          value: `${ssp.label} Janka ${ssp.janka} lbf`, threshold: '≥ 1000 lbf for a hard-wearing worktop',
          explain: `${ssp.label} will dent under daily desk use. Fine for a rustic look — consider maple or oak for a hard-wearing surface.`,
          fixes: [
            { id: 'duty-maple', label: 'Switch to hard maple', patch: { wood: { species: 'hard_maple' } } },
            { id: 'duty-oak', label: 'Switch to red oak', patch: { wood: { species: 'red_oak' } } }
          ]
        });
      }
    }

    /* ---- member load-path coverage (finding G1, 2026-07 generalization) ----
     * A checked surface hands its load to the members it bears on; before this
     * block those members were never examined (a bed deck on 40×20 rails
     * presented verdict PASS while the rails ruptured on paper). For custom
     * compositions: walk the connection graph downward from every checked
     * surface, accumulate each member's tributary share, infer the member's
     * own span between ITS supports exactly like surfacesOf infers surface
     * spans, and run the same evalBeam + strength machinery per member.
     *   · distributed load splits equally over the surface's direct supports;
     *   · a point load (a person) acts in ONE place — each member is checked
     *     with the full point at its worst position, never a stacked sum;
     *   · a support that is itself a tagged surface keeps its own surface
     *     check unchanged (no double-report);
     *   · vertical members (posts, standing panels) carry axially, not in
     *     bending — they terminate the walk (axial capacity is a future
     *     check class); floor-resting members bear continuously and are safe.
     * Template frames don't come through here: their aprons already run the
     * audited frame model above. */
    const memberChecks = []; // { part, supports, R } for the joint-adequacy block
    if (custom && surfaces.length) {
      const surfIds = new Set(surfaces.map(s => s.id));
      const cconns = (spec.custom && spec.custom.connections) || [];
      const bottoms = new Map(parts.map(p => [p.id, Math.min(...Geo.obbCorners(Geo.partOBB(p)).map(c => c[1]))]));
      const supportsOf = p => {
        const seen = new Set(), out = [];
        for (const c of cconns) {
          const oid = c.a === p.id ? c.b : c.b === p.id ? c.a : null;
          if (!oid || seen.has(oid)) continue;
          const q = byId.get(oid);
          if (q && q.loadBearing && bottoms.get(oid) < bottoms.get(p.id) - 10) { seen.add(oid); out.push(q); }
        }
        return out;
      };
      const recs = new Map(); // member id -> accumulated tributary load
      const recFor = q => {
        if (!recs.has(q.id)) recs.set(q.id, { part: q, distSus: 0, distTrans: 0, point: 0, from: [] });
        return recs.get(q.id);
      };
      /* G15 for members: the deepen fix is solved against the member's own
       * check (sag ∝ 1/h³, stress ∝ 1/h²) and patches the spec dimension
       * that is world-vertical — only when the part's rotation keeps one
       * (y-rotations do; tilted members get no phantom fix). Slab thickness
       * snaps up the stock table; rail/panel depth is a rip cut, rounded to
       * a clean 5 mm. */
      const deepenFix = (m, h, sagRatio, stress, allow) => {
        const sp2 = ((spec.custom && spec.custom.parts) || []).find(p => p.id === m.id);
        if (!sp2) return null;
        const rr = sp2.rot || { x: 0, y: 0, z: 0 };
        const flat = a => { const d = ((a % 180) + 180) % 180; return d < 1 || d > 179; };
        if (!flat(rr.x || 0) || !flat(rr.z || 0)) return null;
        const key = sp2.primitive === 'slab' ? 't' : (sp2.primitive === 'rail' || sp2.primitive === 'panel') ? 'w' : null;
        if (!key) return null; // a post/cylinder lies down only via x/z rotations (gated above)
        let need = h;
        if (sagRatio > 1) need = Math.max(need, h * Math.cbrt(sagRatio));
        if (allow > 0 && stress > 0 && allow / stress < 1.25) need = Math.max(need, h * Math.sqrt((1.25 * stress) / allow));
        if (need <= h + 0.05) return null;
        let tNew, partial;
        if (key === 't') {
          const solved = solveThicknessFix(h, sagRatio, stress, allow);
          if (!solved) return null;
          tNew = solved.t; partial = solved.partial;
        } else {
          tNew = Math.min(1500, Math.ceil(need / 5) * 5);
          partial = tNew < need - 0.05;
        }
        const newParts = spec.custom.parts.map(p => p.id === m.id ? { ...p, dim: { ...p.dim, [key]: tNew } } : p);
        return {
          id: 'deep-' + m.id,
          label: `Deepen ${m.id} to ${fmtLen(tNew)}${partial ? PARTIAL_LIMIT : ''}`,
          patch: { custom: { parts: newParts, connections: spec.custom.connections } }
        };
      };
      for (const s of surfaces) {
        const p = LOAD_PRESETS[s.presetKey] || LOAD_PRESETS.display;
        let dist = 0, sus = false, point = 0;
        if (p.kind === 'udl') { dist = (p.kgPerM * s.span / 1000) * GRAV; sus = !!p.sustained; }
        else if (p.kind === 'seat') { point = p.kgSeat * GRAV; dist = (seatsFor(s.span) - 1) * p.kgSeat * GRAV; }
        else { dist = p.kgDist * GRAV; sus = p.sustained === true; point = p.kgEdge * GRAV; }
        const sup = supportsOf(s.part);
        if (!sup.length) continue;
        for (const q of sup) {
          if (surfIds.has(q.id)) continue; // its own surface check stands
          const r = recFor(q);
          if (sus) r.distSus += dist / sup.length; else r.distTrans += dist / sup.length;
          r.point = Math.max(r.point, point);
          r.from.push(s.id);
        }
      }
      // Highest member first, so multi-tier stacks flow their reactions down.
      const done = new Set();
      for (;;) {
        let rec = null;
        for (const r of recs.values()) if (!done.has(r.part.id) && (!rec || bottoms.get(r.part.id) > bottoms.get(rec.part.id))) rec = r;
        if (!rec) break;
        done.add(rec.part.id);
        const m = rec.part;
        const total = rec.distSus + rec.distTrans + rec.point;
        const grounded = bottoms.get(m.id) < 5;
        if (grounded || total < 1) continue;
        const ext = Geo.worldExtents(m);
        const horiz = Math.max(ext.x, ext.z) > ext.y;
        const sup = supportsOf(m);
        if (horiz) {
          // Span between the member's own supports, surfacesOf-style.
          const axis = ext.x >= ext.z ? [1, 0, 0] : [0, 0, 1];
          const len = Math.max(ext.x, ext.z);
          const half = len / 2;
          const ts = sup.map(q => Math.max(-half, Math.min(half,
            Geo.dot3([q.pos.x - m.pos.x, q.pos.y - m.pos.y, q.pos.z - m.pos.z], axis))));
          let mdl = 'cant', span = half;
          if (ts.length >= 2) {
            const spread = Math.max(...ts) - Math.min(...ts);
            if (spread >= 0.4 * len) {
              mdl = 'ss';
              // Clear span: back the extreme supports' own width out of the
              // centre-to-centre spread (the frame model does the same).
              const axExt = q => { const e = Geo.worldExtents(q); return axis[0] ? e.x : e.z; };
              const qMin = sup[ts.indexOf(Math.min(...ts))], qMax = sup[ts.indexOf(Math.max(...ts))];
              span = Math.max(100, spread - axExt(qMin) / 2 - axExt(qMax) / 2);
            }
          }
          if (mdl === 'cant') {
            const tbar = ts.length ? ts.reduce((a, b) => a + b, 0) / ts.length : 0;
            span = Math.max(80, half + Math.abs(tbar));
          }
          const cases = [];
          const udlFn = mdl === 'cant' ? 'udlCant' : 'udlSS';
          const ptFn = mdl === 'cant' ? 'pointCant' : 'pointSS';
          if (rec.distSus > 0) cases.push({ fn: udlFn, mag: rec.distSus / span, creep: CREEP_FACTOR });
          if (rec.distTrans > 0) cases.push({ fn: udlFn, mag: rec.distTrans / span, creep: 1 });
          if (rec.point > 0) cases.push({ fn: ptFn, mag: rec.point, creep: 1 });
          const b = Math.max(10, Math.min(ext.x, ext.z));
          const h = Math.max(5, ext.y);
          const I = I_rect(b, h);
          const msp = speciesOf(materialSpeciesKey(m, spec));
          const { sag, M, crept } = evalBeam(cases, span, msp.moe * 1000, I);
          const limit = mdl === 'cant' ? span / CANT_LIMIT_RATIO : span / SAG_LIMIT_RATIO;
          const ratio = sag / limit;
          if (ratio > worstSagRatio) { worstSagRatio = ratio; worstSag = { id: m.id, sag, limit, span }; }
          const srcs = [...new Set(rec.from)];
          const mFixes = [];
          const allowM = msp.mor / SAFETY_FACTOR;
          const stressM = I > 0 ? (M * (h / 2)) / I : Infinity;
          const mKey = materialSpeciesKey(m, spec);
          {
            if (ratio > 1 || allowM / stressM < 1.25) {
              const mf = deepenFix(m, h, ratio, stressM, allowM);
              if (mf) mFixes.push(mf);
            }
          }
          checks.push({
            id: 'sag:mbr:' + m.id, title: `Sag — ${m.name} (supporting member)`,
            status: sagStatus(ratio),
            value: `predicted ${crept ? 'long-term ' : ''}sag ${fmtFine(sag)} over a ${fmtLen(span)} ${mdl === 'cant' ? 'cantilever' : 'span'}`,
            threshold: `≤ ${fmtFine(limit)} (${mdl === 'cant' ? `L/${CANT_LIMIT_RATIO} at the free end` : U().fmtSagRate(SAG_LIMIT_RATIO)})`,
            explain: `${m.name} carries the load from ${srcs.join(', ')} — a ${fmtLen(b)} × ${fmtLen(h)} ${msp.label} section spanning ${fmtLen(span)} between its own supports.${crept ? ` Sustained share includes ×${CREEP_FACTOR} creep.` : ''}`,
            fixes: ratio > 1 ? withSpecies(mFixes, mKey, ratio, stressM, allowM, 'sag') : [],
            data: { sagMM: sag, limitMM: limit, spanMM: span },
            prov: { rule: `member beam: tributary load from ${srcs.join('+')}, I = bh³/12 = ${Math.round(I).toLocaleString()} mm⁴, ${mdl === 'cant' ? 'cantilever' : 'span'} ${Math.round(span)} mm` }
          });
          strengthCheck('str:mbr:' + m.id, `${m.name} (supporting member)`, M, h, I, { label: 'carried' },
            withSpecies(mFixes, mKey, ratio, stressM, allowM, 'str'), msp);
          const R = mdl === 'cant' ? total : total / 2; // worst end reaction
          memberChecks.push({ part: m, supports: sup, R });
        }
        // Flow this member's whole load onto whatever holds IT up (a joist
        // deck on beams, a post standing on a beam): sustained share stays
        // sustained, everything else lands as transient distributed load.
        for (const q of sup) {
          if (surfIds.has(q.id)) continue;
          const r2 = recFor(q);
          r2.distSus += rec.distSus / sup.length;
          r2.distTrans += (rec.distTrans + rec.point) / sup.length;
          r2.from.push(...rec.from);
        }
      }
    }

    /* ---- seating load cases (the 'seating' class, BB.Classes) ----
     * Chairs break where casework never does: cyclic, eccentric loads and a
     * user tipped onto two legs. Magnitudes and their sources are pinned in
     * the class contract (classes.js SEAT_LOADS); the arithmetic here is
     * hand-verified in test/handcalc.js. */
    if (t === 'chair' && spec.seat && BB.Classes) {
      const C = BB.Classes.get('seating');
      const L = C.loads, G = C.geom;
      const se = spec.seat, st2 = spec.structure;
      const stool = se.backHeight === 0;
      const fjKey = spec.joinery.frame;
      const capJoint = (JOINT_RATING[fjKey] || JOINT_RATING.butt_screws).capN * sgF;
      const jLabel = K.JOINERY[fjKey] ? K.JOINERY[fjKey].label.toLowerCase() : fjKey;
      const railH = st2.apronHeight;
      const railY = se.height - st2.topThickness - railH / 2;
      const strYc = st2.stretcherHeight;
      const arm = Math.max(30, railY - strYc);
      const allow = sp.mor / SAFETY_FACTOR;
      const crestY = se.height + se.backHeight - G.CREST_H / 2;

      if (!stool) {
        /* (a) REAR TILT — the case that kills chairs. Occupant weight rides
         * the rear legs (axial — posts carry it easily); the governing
         * demand is the back force levering each side frame about its seat
         * joints. Per side: M = (F/2)·(crest − rail); resisted as a couple
         * between the side-rail joint and the side-stretcher joint. */
        const M = (L.BACK_STATIC_N / 2) * (crestY - railY);
        const R = M / arm;
        const margin = capJoint / R;
        const fixes = [];
        if (margin < 1.5) {
          // A lower stretcher lengthens the couple arm — solved, not guessed.
          const needArm = (R * arm) / (capJoint / 1.5);
          const newY = Math.round(railY - needArm);
          if (newY >= 100 && newY < strYc - 10) {
            fixes.push({ id: 'tilt-arm', label: `Drop the stretchers to ${fmtLen(newY)}`, patch: { structure: { stretcherHeight: newY } } });
          }
          if (spec.meta.level === 'advanced' && fjKey !== 'mortise_tenon') {
            fixes.push({ id: 'tilt-mt', label: 'Mortise & tenon the seat frame', patch: { joinery: { frame: 'mortise_tenon' } } });
          }
        }
        checks.push({
          id: 'chair:tilt', title: 'Rear tilt — user on two legs',
          status: jointStatus(margin),
          value: `${U().fmtPointLoad(R / GRAV)} per side joint vs ${U().fmtPointLoad(capJoint / GRAV)} capacity (${margin.toFixed(2)}×)`,
          threshold: '≥ 1.5× on the side-rail↔rear-post joint couple (class contract, derivation)',
          explain: `Tipped onto the rear legs, the ${U().fmtPointLoad(L.BACK_STATIC_N / GRAV)} back force (BIFMA X5.1 back functional magnitude) levers each side frame about its seat joints: M = ${Math.round(M).toLocaleString()} N·mm per side, resolved as a couple over the ${fmtLen(arm)} between the side rail and the side stretcher. This is why the class mandates ${jLabel}-grade joinery — screwed rails fail exactly here.`,
          fixes,
          data: { momentNmm: M, armMM: arm, demandN: R, capN: capJoint, marginRatio: margin },
          prov: { rule: `rear tilt: M = (${L.BACK_STATIC_N}/2) × (${Math.round(crestY)} − ${Math.round(railY)}) = ${Math.round(M).toLocaleString()} N·mm; R = M/${Math.round(arm)} = ${Math.round(R)} N vs ${Math.round(capJoint)} N (${fjKey}, SG-scaled)` }
        });

        /* (b) BACK STATIC — rear post bending at the rail mortise: the
         * highest moment lands on the post's smallest net section. */
        const postD = G.rearPostDepth(st2);
        const bNet = Math.max(10, st2.legThickness - G.MORTISE_DERATE);
        const Ipost = I_rect(bNet, postD);
        const stressP = (M * (postD / 2)) / Ipost;
        const marginP = allow / stressP;
        const pFixes = [];
        if (marginP < 1.25) {
          const up = nextSolidUp(st2.legThickness);
          if (up && up <= 100) pFixes.push({ id: 'post-up', label: `Thicken the rear posts to ${fmtLen(up)}`, patch: { structure: { legThickness: up } } });
          const sol2 = solveSpeciesFix(spec.wood.species, 0, stressP, allow, 'str');
          if (sol2) pFixes.push({ id: 'post-sp-' + sol2.key, label: `Switch to ${sol2.label.toLowerCase()}${sol2.partial ? PARTIAL_LIMIT : ''}`, patch: { wood: { species: sol2.key } } });
        }
        checks.push({
          id: 'chair:back', title: 'Back strength — rear posts',
          status: strStatus(marginP),
          value: `net-section bending ${stressP.toFixed(1)} MPa · margin ${marginP.toFixed(1)}×`,
          threshold: `≤ ${allow.toFixed(1)} MPa (MOR ${sp.mor} ÷ ${SAFETY_FACTOR}) at the rail mortise, ${fmtLen(bNet)} × ${fmtLen(postD)} net section`,
          explain: `${U().fmtPointLoad(L.BACK_STATIC_N / GRAV)} horizontal at the crest (ANSI/BIFMA X5.1-2017 §5/6 functional back load — applied at the crest, a LONGER lever than the standard's ≤406 mm point) bends each rear post about the section the side-rail mortise has already thinned. Straight grain is mandatory here — which is exactly why the class refuses sawn rear-leg bends.`,
          fixes: pFixes,
          data: { stressMPa: stressP, allowMPa: allow, momentNmm: M, netW: bNet, postD },
          prov: { rule: `post bending: I = ${Math.round(bNet)}×${Math.round(postD)}³/12 = ${Math.round(Ipost).toLocaleString()} mm⁴; σ = M·c/I with M = ${Math.round(M).toLocaleString()} N·mm, c = ${postD / 2}` }
        });
      }

      /* (c) LEG STRENGTH — X5.4 §16 magnitude (334 N functional) applied
       * horizontally at the foot: the longest lever to the stretcher brace
       * (application height is unpublished; the foot is the conservative
       * reading, stated in the class contract). */
      {
        const legT2 = st2.legThickness;
        const Mleg = L.LEG_STATIC_N * strYc;
        const Ileg = I_rect(legT2, legT2);
        const stressL = (Mleg * (legT2 / 2)) / Ileg;
        const marginL = allow / stressL;
        checks.push({
          id: 'chair:leg', title: 'Leg strength',
          status: strStatus(marginL),
          value: `bending ${stressL.toFixed(1)} MPa at the stretcher line · margin ${marginL.toFixed(1)}×`,
          threshold: `≤ ${allow.toFixed(1)} MPa (MOR ${sp.mor} ÷ ${SAFETY_FACTOR})`,
          explain: `${U().fmtPointLoad(L.LEG_STATIC_N / GRAV)} sideways at the foot (BIFMA X5.4 §16 leg-strength functional magnitude) bends the leg over the ${fmtLen(strYc)} below the stretcher brace.`,
          fixes: marginL < 1 ? [{ id: 'leg-up', label: `Thicken legs to ${fmtLen(Math.min(100, legT2 + 7))}`, patch: { structure: { legThickness: Math.min(100, legT2 + 7) } } }] : [],
          data: { stressMPa: stressL, allowMPa: allow },
          prov: { rule: `leg bending: M = ${L.LEG_STATIC_N} × ${strYc} = ${Math.round(Mleg).toLocaleString()} N·mm; I = ${legT2}⁴/12` }
        });
      }

      /* (d) CYCLIC DURABILITY — 100 000 sit-downs (X5.1 §10.3 / X5.4-2020).
       * Acceptance, not simulation: the seat-frame joints must carry the
       * static seat case at HALF capacity (cyclic acceptable design load ≈
       * half static — Eckelman practice; class contract names it a
       * derivation). Demand: seat load through the four rail-end joint
       * pairs; worst single joint takes a quarter. */
      {
        const perJoint = L.SEAT_STATIC_N / 4;
        const marginC = (capJoint * L.CYCLIC_CAPACITY_FACTOR) / perJoint;
        checks.push({
          id: 'chair:cyclic', title: 'Cyclic seating durability',
          status: jointStatus(marginC),
          value: `${U().fmtPointLoad(perJoint / GRAV)} per joint vs ${U().fmtPointLoad(capJoint * L.CYCLIC_CAPACITY_FACTOR / GRAV)} cyclic capacity (${marginC.toFixed(2)}×)`,
          threshold: `≥ 1.5× at half static joint capacity — stands in for ${L.CYCLIC_MASS_KG} kg × ${L.CYCLIC_CYCLES.toLocaleString()} cycles (X5.1 §10.3)`,
          explain: marginC >= 1.5
            ? `The ${jLabel} seat frame holds the seated load with cyclic headroom — the difference between a chair that is tight in year five and one that wobbles in year one.`
            : `Under repeated seating the ${jLabel} joints work loose — this is the wobbly-chair failure. A stiffer species or mortise-and-tenon joinery buys the cyclic margin back.` + (fjKey === 'kd_bolt' ? ' Bolted frames additionally need their re-snug schedule honored (it is in the assembly steps).' : ''),
          fixes: [],
          data: { perJointN: perJoint, cyclicCapN: capJoint * L.CYCLIC_CAPACITY_FACTOR, marginRatio: marginC },
          prov: { rule: `cyclic: ${L.SEAT_STATIC_N}/4 = ${Math.round(perJoint)} N vs ${Math.round(capJoint)} × ${L.CYCLIC_CAPACITY_FACTOR}` }
        });
      }

      /* (e) STOOL FOOTREST — full body weight on one foot, midspan. */
      if (stool) {
        const fr = parts.find(p => p.id === 'stretcher_front_1');
        if (fr) {
          const span = Math.max(100, Math.max(fr.size.w, fr.size.d));
          const bF = Math.min(fr.size.w, fr.size.d), hF = fr.size.h;
          const IF = I_rect(bF, hF);
          const MF = (L.FOOTREST_STEP_N * span) / 4;
          const stressF = (MF * (hF / 2)) / IF;
          const marginF = allow / stressF;
          checks.push({
            id: 'chair:foot', title: 'Footrest under a mounting step',
            status: strStatus(marginF),
            value: `bending ${stressF.toFixed(1)} MPa · margin ${marginF.toFixed(1)}×`,
            threshold: `≤ ${allow.toFixed(1)} MPa (MOR ${sp.mor} ÷ ${SAFETY_FACTOR})`,
            explain: `Mounting a stool puts the full ${U().fmtPointLoad(L.FOOTREST_STEP_N / GRAV)} on one foot at the footrest midspan (class derivation) — the load every bar-stool rung actually sees, and why the footrest is sized as structure, not trim.`,
            fixes: [],
            data: { stressMPa: stressF, allowMPa: allow, spanMM: span },
            prov: { rule: `footrest: M = PL/4 = ${L.FOOTREST_STEP_N}×${Math.round(span)}/4 = ${Math.round(MF).toLocaleString()} N·mm; I = ${Math.round(bF)}×${Math.round(hF)}³/12` }
          });
        }
        /* (f) COUNTER COUPLING — a stool is FOR a surface; not knowing the
         * surface is itself a finding, never silence. */
        checks.push(se.counterHeight === null ? {
          id: 'chair:counter', title: 'Counter height', status: 'advisory',
          value: `seat at ${fmtLen(se.height)} — no counter stated`,
          threshold: 'seat 250–300 below the counter it serves',
          explain: `No counter height was given, so the seat is at ${fmtLen(se.height)} on the standard band. Tell the app the real counter height and the seat will be re-derived 250–300 below it.`,
          fixes: []
        } : {
          id: 'chair:counter', title: 'Counter height', status: 'pass',
          value: `seat ${fmtLen(se.height)} for a ${fmtLen(se.counterHeight)} counter (drop ${fmtLen(se.counterHeight - se.height)})`,
          threshold: 'seat 250–300 below the counter it serves',
          explain: 'Seat height is derived from the stated counter — the coupling the class contract mandates.',
          fixes: []
        });
      }

      /* (g) RAKE DEFENSE — correction clamps rake to straight-post
       * capability; this re-derives the cap so a spec that somehow escaped
       * correction can never present a sawn-leg geometry as sound. */
      if (!stool) {
        const maxRake = G.backRakeMax(st2, se);
        const over = se.backRake > maxRake + 0.05;
        checks.push({
          id: 'chair:rake', title: 'Back rake vs straight rear posts',
          status: over ? 'fail' : 'pass',
          value: `${fmtDeg(se.backRake)} of ${fmtDeg(maxRake)} available from offsets`,
          threshold: 'rake achievable by opposed offsets within the post depth — beyond it is a sawn/bent leg (refused: short grain)',
          explain: over
            ? 'This rake exceeds what straight rear posts can give. A sawn bend puts short grain at the post’s highest-moment point — the classic rear-leg break — so the class refuses the geometry rather than shipping it.'
            : `The back rakes ${fmtDeg(se.backRake)} by offsetting the crest rearward and the slats forward inside the post depth — rear posts stay straight, grain stays continuous, no short grain anywhere.`,
          fixes: [],
          data: { rakeDeg: se.backRake, maxRakeDeg: maxRake }
        });
      }

      /* (h) GRAIN ORIENTATION — the blank rule for every angled leg: rip
       * WITH the grain along the leg axis; never saw the angle into a
       * vertical blank (slope-of-grain strength loss ~25–30% at 1-in-10,
       * Wood Handbook slope-of-grain table; JLC/MDPI corroboration). */
      {
        const splayed = se.splayDeg > 0;
        checks.push({
          id: 'chair:grain', title: 'Grain orientation on legs',
          status: splayed ? 'advisory' : 'pass',
          value: splayed ? `${fmtDeg(se.splayDeg)} splay — blank orientation is load-bearing` : 'straight members — grain follows every leg',
          threshold: 'grain runs the length of every leg; angled legs are ripped with the grain, never sawn from a vertical blank',
          explain: splayed
            ? `Splayed legs MUST be ripped with the grain running along the leg axis (the compound angle lives in the END cuts). Sawing the splay into a vertically-grained blank costs roughly a quarter of the bending strength at a 1-in-10 slope (Wood Handbook slope-of-grain data) — the cut list and steps carry the blank rule.`
            : 'All legs and posts are straight members cut with continuous grain — the class geometry never creates runout.',
          fixes: [],
          data: { splayDeg: se.splayDeg }
        });
      }

      /* (h2) HEAD ENTRAPMENT — children's scope only (BB.Classes
       * 'childrens', audit KID-5). Bounded openings between the seat, the
       * back slats, and the crest are measured on the BUILT parts (probe/
       * builder parity, same doctrine as bed:slats) against the 16 CFR 1213
       * head-entrapment band: an opening that passes the wedge block
       * (~89 mm — verified-approximate; the block is drawn in the CFR
       * figure) but not the 9 in / 230 mm rigid sphere (verified-exact,
       * §1213.3) can pass a child's body and trap the head. That band is
       * DEFINED for bunk-bed guardrails — this check applies the same
       * body-passes-head-doesn't geometry to a child chair's back as an
       * ADVISORY, honestly scoped, never a compliance claim. */
      if (spec.child && !stool && BB.Classes.get('childrens')) {
        const cG = BB.Classes.get('childrens').geom;
        const members = parts
          .filter(p => p.role === 'slat' || p.role === 'crest') // chair back members (defKey back_slat / crest)
          .map(p => ({ lo: p.pos.y - p.size.h / 2, hi: p.pos.y + p.size.h / 2 }))
          .sort((a, b) => a.lo - b.lo);
        const gaps = [];
        let prevTop = se.height; // the seat surface bounds the lowest opening
        for (const m of members) {
          gaps.push(Math.round((m.lo - prevTop) * 10) / 10);
          prevTop = Math.max(prevTop, m.hi);
        }
        const inBand = gaps.filter(g => g >= cG.ENTRAP_MIN && g < cG.ENTRAP_MAX);
        checks.push({
          id: 'child:entrap', title: 'Back openings vs the head-entrapment band',
          status: inBand.length ? 'advisory' : 'pass',
          value: `bounded back openings: ${gaps.map(g => fmtLen(Math.max(0, g))).join(', ')} (seat → slats → crest)`,
          threshold: `openings between ${fmtLen(cG.ENTRAP_MIN)} and ${fmtLen(cG.ENTRAP_MAX)} are the head-entrapment band (16 CFR 1213: passes the wedge block, not the ${fmtLen(cG.ENTRAP_MAX)} sphere)`,
          explain: inBand.length
            ? `${inBand.length} bounded opening${inBand.length > 1 ? 's' : ''} in this back fall${inBand.length > 1 ? '' : 's'} inside the band where a small body slips through but the head does not — the geometry 16 CFR 1213 rejects on bunk guardrails. That standard does not regulate chairs, so this is an advisory, not a failure: closing the gap below ${fmtLen(cG.ENTRAP_MIN)} (an added slat or a filler panel — not yet generated here) or opening it past ${fmtLen(cG.ENTRAP_MAX)} removes the geometry. The assembly checks carry the tape-measure rule.`
            : `No bounded opening in this back falls inside the ${fmtLen(cG.ENTRAP_MIN)}–${fmtLen(cG.ENTRAP_MAX)} band.`,
          fixes: [],
          data: { gapsMM: gaps, inBandCount: inBand.length }
        });
      }

      /* (i) The benchmark disclosure — in the OUTPUT, not just the docs:
       * never a compliance claim. */
      checks.push({
        id: 'chair:bifma', title: 'What these numbers are', status: 'pass',
        value: 'benchmarked, not certified',
        threshold: 'no compliance claim without physical testing',
        explain: C.DESIGN_BASIS_SEATING,
        fixes: []
      });
    }

    /* ---- wall-mounted anchor model (the 'wall_mounted' class) ----
     * The load path leaves the furniture: the cantilever couple lands in the
     * fixings, and the class contract carries the sourced capacities
     * (classes.js WALL_GEOM — NDS withdrawal, IRC spacing). Arithmetic is
     * hand-verified in test/handcalc.js. */
    const wallCls = BB.Classes ? BB.Classes.forTemplate(t) : null;
    const isWallMounted = !!(wallCls && wallCls.mounted === 'wall');
    if (isWallMounted && t === 'wall_shelf' && spec.wall) {
      const G2 = wallCls.geom;
      const shelf = parts.find(p => p.id === 'shelf_1');
      const su = spec.wall.substrate;
      const W = spec.overall.width, D = spec.overall.depth;
      const cleatLen = W - 20;
      const surf = surfaces.find(x => x.id === 'shelf_1');
      const presetKey = surf ? surf.presetKey : 'books';
      // Load: the chosen preset along the shelf + the shelf's own mass.
      const loadN = totalLoadN(presetKey, W);
      let selfN = 0;
      for (const p of parts) if (!p.hardware) selfN += p.size.w * p.size.h * p.size.d * 1e-9 * partDensity(p, spec) * GRAV;
      const totalN = loadN + selfN;
      // Couple: load centroid at D/2 off the wall; tension at the screw
      // line, bearing at the cleat bottom → arm = SCREW_LINE.
      const M = totalN * (D / 2);
      const Tn = M / G2.SCREW_LINE;

      if (su === 'stud') {
        const studs = G2.studsEngaged(cleatLen, spec.wall.studSpacingMM);
        const screws = Math.max(1, studs) * G2.SCREWS_PER_STUD;
        const perScrew = Tn / screws;
        const margin = G2.SCREW_WITHDRAWAL_N / perScrew;
        const shearPer = totalN / screws;
        const shearMargin = G2.SCREW_LATERAL_N / shearPer;
        checks.push({
          id: 'wall:studs', title: 'Stud engagement',
          status: studs >= 2 ? 'pass' : studs === 1 ? 'advisory' : 'fail',
          value: `${studs} stud${studs === 1 ? '' : 's'} guaranteed under a ${fmtLen(cleatLen)} cleat at ${fmtLen(spec.wall.studSpacingMM)} centres`,
          threshold: '≥ 2 studs (worst-phase floor(length/spacing), IRC R602.3(5) spacing)',
          explain: studs >= 2
            ? 'Whatever the cleat’s phase against the stud grid, it crosses at least two studs — find them, and put two screws in each.'
            : studs === 1
              ? `Only one stud crossing is guaranteed at this length. A single-stud mount works CENTRED on the stud with both screws in it — keep the shelf under ${fmtLen(600)} and expect no forgiveness for a missed centre.`
              : 'The cleat cannot guarantee a single stud crossing — lengthen the shelf past one spacing bay or name a masonry wall.',
          fixes: studs < 2 ? [{ id: 'wall-wider', label: `Lengthen to ${fmtLen(2 * spec.wall.studSpacingMM + 40)}`, patch: { overall: { width: 2 * spec.wall.studSpacingMM + 40 } } }] : [],
          data: { studs, cleatLen, spacing: spec.wall.studSpacingMM }
        });
        checks.push({
          id: 'wall:anchor', title: 'Anchor pullout — cleat screws',
          status: jointStatus(Math.min(margin, shearMargin)),
          value: `${U().fmtPointLoad(perScrew / GRAV)} withdrawal per screw vs ${U().fmtPointLoad(G2.SCREW_WITHDRAWAL_N / GRAV)} design capacity (${margin.toFixed(2)}×)`,
          threshold: `≥ 1.5× on ${screws} × #10 screws (NDS W = 2850·G²·D, SPF floor, 1.5 in thread; shear ${shearMargin.toFixed(2)}× vs the 356 N secondary-source value)`,
          explain: `${U().fmtPointLoad(totalN / GRAV)} at half the ${fmtLen(D)} depth throws a ${Math.round(M).toLocaleString()} N·mm couple into the wall: tension along the screw line, bearing at the cleat bottom, arm ${fmtLen(G2.SCREW_LINE)}. Every screw must land in a stud CENTRE — the capacity assumes wood, not drywall.`,
          fixes: margin < 1.5 ? [{ id: 'wall-shallow', label: `Shallow the shelf to ${fmtLen(Math.max(200, D - 50))}`, patch: { overall: { depth: Math.max(200, D - 50) } } }] : [],
          data: { momentNmm: M, tensionN: Tn, perScrewN: perScrew, capN: G2.SCREW_WITHDRAWAL_N, screws, marginRatio: margin, shearMargin },
          prov: { rule: `anchor couple: M = ${Math.round(totalN)} N × ${Math.round(D / 2)} mm; T = M/${G2.SCREW_LINE} = ${Math.round(Tn)} N over ${screws} screws` }
        });
      } else if (su === 'masonry') {
        const anchors = Math.max(2, Math.floor(cleatLen / G2.MASONRY_PITCH) + 1);
        const perAnchor = Tn / anchors;
        const required = Math.ceil(perAnchor * 1.5 / 10) * 10;
        checks.push({
          id: 'wall:anchor', title: 'Anchor pullout — masonry',
          status: 'advisory',
          value: `${anchors} anchors at ≤ ${fmtLen(G2.MASONRY_PITCH)}: buy a WORKING load rating ≥ ${U().fmtPointLoad(required / GRAV)} each`,
          threshold: 'anchor’s published WORKING rating ≥ 1.5 × the computed demand — capacity is never assumed for masonry',
          explain: `The couple puts ${U().fmtPointLoad(perAnchor / GRAV)} of tension on each of ${anchors} anchors. The BOM prints the required rating instead of guessing one: match it against the anchor box's WORKING (not ultimate) value, in the actual wall material.`,
          fixes: [],
          data: { momentNmm: M, perAnchorN: perAnchor, requiredWorkingN: required, anchors }
        });
      }
      checks.push({
        id: 'wall:basis', title: 'What these fixing numbers are', status: 'pass',
        value: 'design guidance, not certified anchor engineering',
        threshold: 'no fixing claim without the substrate stated',
        explain: BB.Classes.DESIGN_BASIS_WALL,
        fixes: []
      });
    }

    /* ---- bed load cases (the 'bed' class) ----
     * Deck + connection physics with EN 1725's 110 kg user mass as the
     * benchmark. Hand arithmetic in test/handcalc.js. Sag is judged on the
     * DISTRIBUTED case (comfort criterion); strength on the knee-point case
     * spread over two slats by the mattress (derivation, stated). */
    if (t === 'bed' && spec.bed && BB.Classes) {
      const C = BB.Classes.get('bed');
      const G = C.geom;
      const bd = spec.bed;
      const msz = G.SIZES[bd.size];
      const Wi = msz.w + G.FIT_CLEARANCE, Li = msz.l + G.FIT_CLEARANCE;
      const slats = parts.filter(p => p.role === 'slat');
      const nSlat = slats.length;
      // Gaps are measured over the deck the builder actually laid out
      // (slats sit clear of the post intrusions, not over the full inner
      // length) — probe and builder must agree on the same number.
      const slatZs = slats.map(p => p.pos.z);
      const deckLenMM = nSlat > 1 ? (Math.max.apply(null, slatZs) - Math.min.apply(null, slatZs)) + G.SLAT_W : G.SLAT_W;
      const gapMM = nSlat > 1 ? (deckLenMM - nSlat * G.SLAT_W) / (nSlat - 1) : 0;
      const hasCentre = parts.some(p => p.id === 'rail_centre_1');
      const allow = sp.mor / SAFETY_FACTOR;
      const liveN = G.OCCUPANTS * G.USER_KG * GRAV;
      const mattN = (G.MATTRESS_KG[bd.size] || 55) * GRAV;
      const totalN = liveN + mattN;

      /* (a) SLATS — gap rule + the governing segment. */
      {
        const span = Math.max(200, hasCentre ? Wi / 2 - 51 : Wi - 2 * G.CLEAT.w);
        const slatT = slats.length ? slats[0].size.h : G.SLAT_T; // section solved by the builder
        const I = I_rect(G.SLAT_W, slatT);
        // Distributed (sag criterion): this slat's share, segment tributary.
        const perSlat = totalN / nSlat;
        const w = perSlat / Wi; // N/mm along the slat
        const sagD = (5 * w * Math.pow(span, 4)) / (384 * E * I) * (mattN / totalN * CREEP_FACTOR + liveN / totalN);
        const limD = span / SAG_LIMIT_RATIO;
        // Knee point (strength criterion): 110 kg on one knee, spread over
        // TWO slats by the mattress (a knee patch through 200+ mm of
        // mattress covers two slats at this pitch — derivation, stated).
        const P = (G.USER_KG * GRAV) / 2;
        const Mk = (P * span) / 4 + ((mattN / nSlat / Wi) * span * span) / 8;
        const stressK = (Mk * (slatT / 2)) / I;
        const marginK = allow / stressK;
        const gapOK = gapMM <= G.SLAT_GAP_MAX + 0.05;
        const sagStat = sagStatus(sagD / limD), strStat = strStatus(marginK);
        const worst = !gapOK ? 'fail' : (RANK[sagStat] < RANK[strStat] ? sagStat : strStat);
        checks.push({
          id: 'bed:slats', title: 'Slat deck',
          status: worst,
          value: `${nSlat} × ${fmtLen(G.SLAT_W)}×${fmtLen(slatT)} slats, gaps ${fmtLen(Math.round(gapMM * 10) / 10)} · knee margin ${marginK.toFixed(2)}× · sag ${fmtFine(sagD)}`,
          threshold: `gaps ≤ ${fmtLen(G.SLAT_GAP_MAX)} (foam-warranty floor, Amerisleep 2.75 in) · strength ≥ 1.25× at MOR/${SAFETY_FACTOR} · sag ≤ ${fmtFine(limD)}`,
          explain: `Two occupants at ${G.USER_KG} kg (EN 1725 user mass) plus a ${Math.round(mattN / GRAV)} kg design mattress ride ${nSlat} slats${hasCentre ? ', each spanning half the width to the centre rail' : ''}. The strength case is a knee: ${Math.round(G.USER_KG * GRAV)} N through the mattress onto two slats at midspan. Slat width ${fmtLen(G.SLAT_W)} meets the ≥ 3 in manufacturer floor.`,
          fixes: [],
          data: { nSlat, gapMM, spanMM: span, kneeMarginRatio: marginK, sagMM: sagD, kneeStressMPa: stressK },
          prov: { rule: `knee: M = ${Math.round(P)}×${Math.round(span)}/4 + mattress share; I = ${G.SLAT_W}×${G.SLAT_T}³/12 = ${Math.round(I).toLocaleString()} mm⁴` }
        });
      }

      /* (b) SIDE RAILS — tributary share + edge-sit point. */
      const rail = parts.find(p => p.id === 'rail_side_1');
      let railR = 0;
      if (rail) {
        const span = Math.max(500, rail.size.d);
        const share = hasCentre ? 0.25 : 0.5;
        const w = (totalN * share) / span;
        const I = I_rect(rail.size.w, rail.size.h);
        const Pedge = 0.75 * G.USER_KG * GRAV; // sitting on the rail edge
        const M = (w * span * span) / 8 + (Pedge * span) / 4;
        const sag = (5 * w * Math.pow(span, 4)) / (384 * E * I) + (Pedge * Math.pow(span, 3)) / (48 * E * I);
        const lim = span / SAG_LIMIT_RATIO;
        const stress = (M * (rail.size.h / 2)) / I;
        const margin = allow / stress;
        railR = (w * span) / 2 + Pedge / 2;
        checks.push({
          id: 'bed:rail', title: 'Side rails',
          status: sag / lim > 1.5 || margin < 1 ? 'fail' : sag / lim > 1 || margin < 1.25 ? 'advisory' : 'pass',
          value: `sag ${fmtFine(sag)} over ${fmtLen(span)} · strength margin ${margin.toFixed(1)}×`,
          threshold: `sag ≤ ${fmtFine(lim)} (L/${SAG_LIMIT_RATIO}) · margin ≥ 1.25× at MOR/${SAFETY_FACTOR}`,
          explain: `Each ${fmtLen(rail.size.w)} × ${fmtLen(rail.size.h)} rail carries ${hasCentre ? 'a quarter' : 'half'} of the deck load${hasCentre ? ' (the centre rail takes half)' : ''} plus a ${U().fmtPointLoad(Pedge / GRAV)} edge-sit at midspan.`,
          fixes: [],
          data: { sagMM: sag, limitMM: lim, marginRatio: margin, endReactionN: railR },
          prov: { rule: `rail: w = ${Math.round(totalN * share)}/${Math.round(span)} N/mm + P·L/4 edge case; I = ${Math.round(I).toLocaleString()} mm⁴` }
        });
        /* (c) RAIL CONNECTIONS — the knock-down joints. */
        const capJ = JOINT_RATING.kd_bolt.capN * sgF;
        const marginJ = capJ / railR;
        checks.push({
          id: 'bed:joint', title: 'Rail-to-post connections',
          status: jointStatus(marginJ),
          value: `${U().fmtPointLoad(railR / GRAV)} per rail end vs ${U().fmtPointLoad(capJ / GRAV)} (2 × M6 barrel bolts) — ${marginJ.toFixed(2)}×`,
          threshold: '≥ 1.5× on the barrel-bolt connection; the bracket alternative prints this demand × 1.5 as its REQUIRED capacity (brackets publish no ratings — confirmed)',
          explain: 'The knock-down mandate: every rail end bolts to its post with two M6 barrel bolts and comes apart on moving day. Surface-mount bed-rail brackets are a legitimate swap, but no maker publishes a rating — match the printed requirement or keep the bolts. Re-snug after the first week and each season.',
          fixes: [],
          data: { endReactionN: railR, capN: capJ, marginRatio: marginJ, requiredBracketN: Math.ceil(railR * 1.5 / 10) * 10 },
          prov: { rule: `end reaction = wL/2 + P/2 = ${Math.round(railR)} N vs kd_bolt ${Math.round(capJ)} N (SG-scaled)` }
        });
      }

      /* (d) CENTRE RAIL — the warranty mandate, verified live. */
      {
        const needed = Wi >= G.CENTRE_RAIL_MIN_W;
        if (needed && hasCentre) {
          const cr = parts.find(p => p.id === 'rail_centre_1');
          const seg = Math.max(400, cr.size.d / 2);
          const w = (totalN * 0.5) / cr.size.d;
          const I = I_rect(cr.size.w, cr.size.h);
          const M = (w * seg * seg) / 8;
          const stress = (M * (cr.size.h / 2)) / I;
          checks.push({
            id: 'bed:centre', title: 'Centre support',
            status: strStatus(allow / stress),
            value: `centre rail + floor leg — segment stress ${stress.toFixed(1)} MPa (margin ${(allow / stress).toFixed(1)}×)`,
            threshold: 'mandatory at interior ≥ 1350 mm (Sealy/Stearns & Foster warranty: ≥ 5 legs with centre support at queen+)',
            explain: 'The centre rail halves every slat span and takes half the deck load to its own floor leg — the difference between a deck that lasts and the broken-slat queen bed. The leg must bear the floor BEFORE the deck is loaded (it is in the steps).',
            fixes: [],
            data: { segmentSpan: seg, stressMPa: stress }
          });
        } else if (!needed) {
          checks.push({
            id: 'bed:centre', title: 'Centre support', status: 'pass',
            value: `not required at ${fmtLen(Wi)} interior`,
            threshold: 'mandatory at interior ≥ 1350 mm (warranty practice)',
            explain: 'Twin-class widths carry on the side cleats alone; the mandate begins at 1350 mm.',
            fixes: []
          });
        } else {
          checks.push({
            id: 'bed:centre', title: 'Centre support', status: 'fail',
            value: 'MISSING at a width that requires it',
            threshold: 'mandatory at interior ≥ 1350 mm',
            explain: 'A queen-class deck without centre support breaks slats and voids mattress warranties — the builder always adds it; this spec somehow lacks it.',
            fixes: []
          });
        }
      }

      /* (e) HEADBOARD — sitting back against it. */
      if (bd.headboardHeight > 0) {
        const railTopY = bd.platformHeight + G.MATTRESS_STOP;
        const lever = Math.max(100, bd.headboardHeight - railTopY);
        const F = 667; // aligned to the X5.1 back magnitude the seating class uses (derivation)
        const Mh = (F / 2) * lever;
        const postT2 = spec.structure.legThickness;
        const I = I_rect(postT2, postT2);
        const stress = (Mh * (postT2 / 2)) / I;
        const margin = allow / stress;
        checks.push({
          id: 'bed:headboard', title: 'Headboard posts',
          status: strStatus(margin),
          value: `bending ${stress.toFixed(1)} MPa at the rail line · margin ${margin.toFixed(1)}×`,
          threshold: `≤ ${allow.toFixed(1)} MPa (MOR/${SAFETY_FACTOR}) under ${U().fmtPointLoad(F / GRAV)} at the headboard top`,
          explain: `Sitting back against the headboard levers each post about the rail-bolt line — ${fmtLen(lever)} of lever into a ${fmtLen(postT2)} square post.`,
          fixes: margin < 1.25 ? [{ id: 'bed-post-up', label: `Thicken posts to ${fmtLen(Math.min(100, postT2 + 10))}`, patch: { structure: { legThickness: Math.min(100, postT2 + 10) } } }] : [],
          data: { leverMM: lever, stressMPa: stress, marginRatio: margin }
        });
      }

      checks.push({
        id: 'bed:basis', title: 'What these bed numbers are', status: 'pass',
        value: 'benchmarked (EN 1725 magnitudes), not certified',
        threshold: 'no compliance claim; no US adult-bed standard exists',
        explain: BB.Classes.DESIGN_BASIS_BED,
        fixes: []
      });
    }

    /* ---- children's scope basis (BB.Classes 'childrens') ----
     * Every child-scoped output states its ground truth: EN 1729 band
     * heights, ADULT loads kept (nothing lightened — adults use kids'
     * furniture), anchor mandate on storage, regulated products refused.
     * Guidance, never a children's-product certification. */
    if (spec.child && BB.Classes && BB.Classes.get('childrens') && K.CHILD) {
      const band = K.CHILD.BANDS[spec.child.ageBand];
      checks.push({
        id: 'child:basis', title: 'Child scope — what changes and what never does', status: 'pass',
        value: `sized for a ${band.label} · adult design loads KEPT`,
        threshold: 'EN 1729 size-mark heights pinned by code; no load case is ever lightened; regulated children\'s products are refused',
        explain: BB.Classes.DESIGN_BASIS_CHILD,
        fixes: []
      });
    }

    /* ---- tipping stability: COG from part volumes & density, empty and loaded ---- */
    let antiTip = false, tip = null;
    if (!isWallMounted) {
      let mass = 0, mx = 0, my = 0, mz = 0;
      for (const p of parts) {
        if (p.role === 'pull' || p.hardware) continue;
        const dens = partDensity(p, spec);
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
        /* Children's scope (BB.Classes 'childrens', audit KID-3): a
         * child-scoped STORAGE piece takes the anchor as a mandate
         * regardless of computed margin — children climb shelves, and CPSC
         * Anchor It! guidance is to anchor storage furniture in a child's
         * space, full stop. Stricter than the F2057 clothing-storage scope
         * by design; the physics is still computed and reported honestly. */
        const childStorage = !!spec.child && ['bookshelf', 'cabinet', 'nightstand'].includes(t);
        antiTip = ratio > 2.5 || angLoaded < 10 || childStorage;
        tip = { angEmpty, angLoaded, ratio, loadKg, massKg: mass };
        checks.push({
          id: 'tip', title: 'Tipping stability',
          ...(antiTip ? { anchor: true } : {}), // this check mandates the wall anchor (audit M-18)
          status: angLoaded < 5 ? 'fail' : antiTip ? 'advisory' : 'pass',
          value: `tipping angle ${fmtDeg(angLoaded)} loaded · ${fmtDeg(angEmpty)} empty · height/depth ${ratio.toFixed(1)}`,
          threshold: childStorage
            ? 'child-scoped storage: the wall anchor is mandatory at ANY margin (CPSC Anchor It!)'
            : '≥ 10° loaded, height/depth ≤ 2.5 — otherwise a wall anchor is mandatory',
          explain: childStorage
            ? `Child-scoped storage: the anti-tip wall anchor is mandatory regardless of the computed margin${ratio > 2.5 || angLoaded < 10 ? '' : ` (the geometry itself measures stable — ${fmtDeg(angLoaded)} loaded)`} — children climb shelves, and anchoring storage in a child's space is the CPSC Anchor It! rule this class adopts as a mandate. It is in the BOM and the assembly steps.`
            : antiTip
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
          if (p.hardware) continue; // excluded from the mass model, like pulls from COG
          const dens = partDensity(p, spec);
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
        // F2057/STURDY covers CLOTHING STORAGE ≥ 27 in — a desk's pencil
        // drawer is not a dresser drawer, so the anchor mandate follows the
        // regulation's scope while the physics is still reported.
        // CHILD SCOPE EXTENSION (BB.Classes 'childrens', audit KID-3): a
        // child-scoped piece is IN SCOPE whatever its height or template —
        // the child at the drawer is not hypothetical there, so the 1.5×
        // anchor gate applies to a kids desk's pencil drawer too. Stricter
        // than the regulation's own scope, by design; magnitudes unchanged.
        const childScope = !!spec.child;
        const inScope = childScope || (spec.overall.height >= 686 && t !== 'desk');
        const status = margin >= 1.5 ? 'pass' : margin >= 1 ? 'advisory' : (inScope ? 'fail' : 'advisory');
        // Anchor mandatory when it actually tips, or when an in-scope piece
        // (clothing-storage height, or ANY child-scoped piece) runs thin.
        const anchorHere = margin < 1 || (inScope && margin < 1.5);
        if (anchorHere) antiTip = true;
        checks.push({
          id: 'tip_f2057', title: 'Tipping — drawers open (F2057)',
          ...(anchorHere ? { anchor: true } : {}), // this check mandates the wall anchor (audit M-18)
          status,
          value: `margin ${margin === Infinity ? '∞' : margin.toFixed(2) + '×'} with all drawers open ⅔ and ${U().fmtPointLoad(TEST_KG)} on the top drawer front`,
          threshold: `≥ 1× to stand, ≥ 1.5× to skip the anchor — aligned with ASTM F2057 / STURDY (${U().fmtPointLoad(TEST_KG)} on an open drawer)${childScope ? '; child scope: the gate applies at ANY height and template' : ''}`,
          explain: margin >= 1.5
            ? 'Even with every drawer open and a child-weight pull on the top one, the piece stays planted.'
            : margin >= 1
              ? `It stands, but the margin is thin${childScope ? ' — and this is a CHILD-SCOPED piece, so the F2057 anchor gate applies whatever the height: the anti-tip wall anchor is added and required' : inScope ? ' at clothing-storage height (F2057 territory) — the anti-tip wall anchor is added and required' : ' — anchor it if children are around'}.`
              : 'With drawers open and weight on the top front, this piece TIPS. The wall anchor is mandatory — and this check follows the same scenario regulators test dressers against.',
          fixes: [],
          data: { marginRatio: margin, stabilizingNmm: stab, overturningNmm: over, testKg: TEST_KG, openFraction: OPEN_FRACTION, childScope }
        });
      }

      /* ---- slide capacity vs drawer size (audit F-S3-6) ----
       * 2026 hardware expansion: the slide FAMILY is picked by computed
       * load (BB.HW.slidePick) — the check reports the picked class and
       * the BOM buys the same one; both call the same pure function. */
      const DENSITY_KG_PER_L = 0.24; // general household storage; paper runs ~0.72
      let worst = null;
      for (const d of model.drawers) {
        if (d.runner !== 'side_mount_slides' && d.runner !== 'undermount_slides') continue;
        const volL = Math.max(0, (d.box.w - 2 * d.box.t) * (d.box.h - d.box.t) * (d.box.d - d.box.t)) * 1e-6;
        const estKg = volL * DENSITY_KG_PER_L;
        if (!worst || estKg > worst.estKg) worst = { d, volL, estKg };
      }
      if (worst) {
        const picked = BB.HW
          ? BB.HW.slidePick(worst.estKg, { undermount: worst.d.runner === 'undermount_slides' })
          : { label: 'Side-mount ball-bearing slides (pair)', capacityKg: 34 };
        const capKg = picked.capacityKg;
        const fileKg = worst.volL * 0.72;
        const overCap = worst.estKg > capKg;
        checks.push({
          id: 'slide:dr' + worst.d.index, title: 'Drawer slide capacity',
          status: overCap ? 'advisory' : 'pass',
          value: `largest drawer ≈ ${U().fmtPointLoad(worst.estKg)} loaded vs ${U().fmtPointLoad(capKg)} slide rating (pair)`,
          threshold: `≤ ${U().fmtPointLoad(capKg)} per pair (${picked.label.toLowerCase()})`,
          explain: (overCap
            ? 'Packed full, this drawer would exceed its slide rating — specify 100 lb slides or split the storage.'
            : `Everyday storage sits inside the rating of the picked class (${picked.label.toLowerCase()}).`) +
            (fileKg > capKg ? ` Loaded with paper or files (~0.72 kg/L) it would reach ${U().fmtPointLoad(fileKg)} — beyond the rating; use file-rated slides for that duty.` : ''),
          fixes: [],
          data: { estKg: worst.estKg, capKg, volumeL: worst.volL }
        });
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
        /* Bracing at the foot works against the longest lever the frame has,
         * which is why it beats the same joints anywhere else. A box
         * stretcher closes the loop on all four sides; an H ties two sides
         * and relies on the centre rail to carry the third direction. */
        if (hasRole('stretcher')) {
          mults.push(spec.structure.stretcher === 'box'
            ? { label: 'box stretcher closes the frame at the foot', mult: 1.3 }
            : { label: 'H-stretcher ties the legs low', mult: 1.2 });
        }
        if (hasRole('back')) mults.push({ label: 'back panel acts as a shear panel', mult: 1.5 });
        if (spec.joinery.case === 'dado' && hasRole('shelf')) mults.push({ label: 'fixed shelves housed in dados', mult: 1.15 });
        /* Long-span coupling (frame_table contract, roadmap item 2): the
         * racking couple on the apron–leg joints grows with the clear span
         * while joint capacity stays fixed, and past ~1800 mm the top's own
         * torsional stiffness stops helping. Demand scales the score down
         * linearly to ×0.7 at the 2400 mm DIM_RULES cap — the cap itself is
         * the refusal (correction clamps and says so). */
        if (TABLE_LIKE.includes(t)) {
          const clearSpan = spec.overall.width - 2 * (spec.structure.legThickness || 0);
          if (clearSpan > 1800) {
            const spanMult = Math.max(0.7, 1 - (clearSpan - 1800) / 2000);
            mults.push({ label: `long span raises the racking couple (${Math.round(clearSpan)} mm clear between legs)`, mult: Math.round(spanMult * 100) / 100 });
          }
        }
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
      // A wall shelf does not rack — the wall is its shear panel; the anchor
      // checks own its safety story.
      if (!isWallMounted) checks.push({
        id: 'rack', title: 'Racking resistance', status: rack.score < 40 ? 'advisory' : 'pass',
        value: `score ${rack.score} / 100`, threshold: '≥ 40 (heuristic, not physics)',
        explain: rack.score < 40
          ? `The joints alone won't stop side-to-side wobble. Cheapest effective fix: ${cheapFix}.`
          : 'Joinery and bracing elements give this piece good resistance to side-to-side wobble.',
        fixes, factors: rack.factors
      });
    }

    /* ---- door hinges: weight vs the hinges the app itself specified ----
     * The one check a door genuinely needs. Everything in it is code-owned
     * and already existed as hardware.js's READY stratum: panel weight from
     * geometry × species SG, hinge count from the height band and the weight
     * rule, and the per-pair capacity straight off the catalog row. Nothing
     * here is a preference — an under-hinged door sags, drags on the case,
     * and eventually pulls its screws out of the stile. */
    if (spec.doors && BB.HW) {
      const doors = parts.filter(p => p.role === 'door');
      const hinge = BB.HW.HINGES[spec.hardware && spec.hardware.hinge] || BB.HW.HINGES.euro_cup;
      let worst = null;
      for (const dp of doors) {
        const kg = BB.HW.panelWeightKg(dp.size.w, dp.size.h, dp.size.d, dp.material);
        const n = BB.HW.doorHingeCount(dp.size.h, kg);
        // The catalog rates a PAIR, so n hinges carry n/2 pairs' worth.
        const capacity = hinge.capacityKgPair * (n / 2);
        const ratio = capacity > 0 ? kg / capacity : Infinity;
        if (!worst || ratio > worst.ratio) worst = { part: dp, kg, n, capacity, ratio };
      }
      if (worst) {
        const over = worst.ratio > 1;
        const fixes = [];
        if (over) {
          // A heavier-rated hinge that still suits this door style — read off
          // the same catalog, never invented.
          const style = spec.doors.style;
          const stronger = Object.values(BB.HW.HINGES)
            .filter(h => (h.fronts || []).includes(style) && h.capacityKgPair > hinge.capacityKgPair)
            .sort((a, b) => a.capacityKgPair - b.capacityKgPair)[0];
          if (stronger) fixes.push({ id: 'hinge-up', label: `Hang it on ${stronger.label.toLowerCase()}`, patch: { hardware: { hinge: stronger.key } } });
          if (spec.doors.count === 1) fixes.push({ id: 'door-pair', label: 'Split it into a pair of doors', patch: { doors: { count: 2 } } });
        }
        checks.push({
          id: 'hinge', title: 'Door hinges', status: over ? 'advisory' : 'pass',
          value: `${U().fmtWeight(worst.kg)} on ${worst.n} × ${hinge.label.toLowerCase()}`,
          threshold: `≤ ${U().fmtWeight(worst.capacity)} for ${worst.n} hinges (${U().fmtWeight(hinge.capacityKgPair)} per pair)`,
          explain: over
            ? `This door outweighs the hinges carrying it. An over-loaded hinge does not fail all at once — the door drops a millimetre, catches on the case, and the screws work loose in the stile from there.`
            : `${worst.n} hinges is what this door's height and weight ask for, and ${hinge.label.toLowerCase()} carries it with room to spare.`,
          fixes
        });
      }

      /* ---- doored-casework completion (roadmap item 4): droop, reveal,
       * catches. All three read the casework class contract (CASE_GEOM) and
       * the hardware catalog — hand arithmetic in test/handcalc.js. */
      const caseCls = BB.Classes ? BB.Classes.get('casework') : null;
      if (worst && caseCls) {
        const G = caseCls.geom;
        const dp = worst.part;
        const inset = spec.doors.style === 'inset';
        const nLeaves = spec.doors.count;

        /* ---- door:sag — slab droop over the hinge couple ----
         * What the app builds is a SLAB door: a one-piece panel. A slab
         * cannot rack out of square — the panel is its own shear web
         * (frame-and-panel doors rack at frame joints that do not exist
         * here). What drops a slab door's free corner is the hinge couple:
         * the leaf's weight at w/2 from the hinge line resolves as a
         * horizontal force couple over the hinge spread s (gate statics,
         * F = W·g·w/(2s)), and every millimetre the top hinge fixing
         * yields reads as w/s millimetres of droop at the free edge —
         * pure geometry. Droop is priced at the class's 0.5 mm design
         * settlement (a documented derivation — no maker publishes one)
         * against the fitted reveal. The width gate is the Blum-class
         * chart rule, verified 2026-07 (ea.blum.com "Number of hinges"):
         * "doors should have a height that is greater than their width",
         * charts valid to 600 mm wide. A continuous (piano) hinge carries
         * the whole edge and escapes both. */
        {
          const dd = G.doorDroop(hinge, dp.size.w, dp.size.h, worst.kg);
          const vBudget = G.DOOR_REVEAL;
          const sagStatus2 = dd.droopMM > vBudget ? 'fail'
            : (dd.widerThanTall || dd.droopMM > vBudget / 2) ? 'advisory' : 'pass';
          const sagFixes = [];
          if (sagStatus2 !== 'pass') {
            if (hinge.countRule !== 'fullLength') sagFixes.push({ id: 'hinge-piano', label: 'Hang it on a continuous (piano) hinge', patch: { hardware: { hinge: 'piano' } } });
            if (nLeaves === 1) sagFixes.push({ id: 'door-pair', label: 'Split it into a pair of doors', patch: { doors: { count: 2 } } });
          }
          checks.push({
            id: 'door:sag', title: 'Door droop',
            status: sagStatus2,
            value: `${fmtFine(dd.droopMM)} free-edge droop at ${fmtFine(G.HINGE_SETTLE_MM)} hinge settlement × ${dd.ampRatio} amplification (spread ${fmtLen(dd.spreadMM)})`,
            threshold: `droop ≤ ${fmtFine(vBudget / 2)} clean, ≤ ${fmtFine(vBudget)} hard (the fitted reveal); leaf width ≤ height for two-point hinges (Blum chart rule)`,
            explain: `A slab door cannot rack out of square — the panel is its own diagonal — so what drops the free corner is the hinge couple: ${U().fmtWeight(worst.kg)} at half the ${fmtLen(dp.size.w)} width puts ${Math.round(dd.coupleN)} N of horizontal pull on the top hinge fixing across the ${fmtLen(dd.spreadMM)} spread, and every millimetre it yields reads as ${dd.ampRatio} mm at the free edge.` +
              (dd.widerThanTall ? ` This leaf is WIDER than it is tall — past the geometry the hinge count charts are written for (they stop at height > width); a wide-short door droops on any two-point hinge.` : '') +
              (sagStatus2 === 'pass' ? ' Tall spread, modest width: the droop stays inside the fitted reveal.' : ''),
            fixes: sagFixes,
            data: { leafKg: worst.kg, spreadMM: dd.spreadMM, ampRatio: dd.ampRatio, droopMM: dd.droopMM, coupleN: dd.coupleN, widerThanTall: dd.widerThanTall },
            prov: { rule: `couple F = ${worst.kg.toFixed(2)} kg × g × ${Math.round(dp.size.w)}/(2 × ${Math.round(dd.spreadMM)}) = ${Math.round(dd.coupleN)} N; droop = ${G.HINGE_SETTLE_MM} × ${Math.round(dp.size.w)}/${Math.round(dd.spreadMM)}` }
          });
        }

        /* ---- door:reveal — seasonal movement vs the fitted air ----
         * Slab leaves are solid wood: the leaf swings across its grain with
         * the seasons (Wood Handbook coefficients — the same K.movementMM
         * and ΔMC the move: checks use; sheet stock is exempt the same
         * way). The hinge edge is pinned by its screws, so the whole
         * half-swing from a mid-season fit arrives at the FREE edge: an
         * inset leaf closes its reveal, a pair closes the meeting gap from
         * both sides at once. Overlay singles simply ride over the case
         * face; overlay pairs can be re-centred within the plate
         * adjustment (±2 mm, Blum CLIP top spec — verified-approximate).
         * Advisory, not fail: fitting in the humid season and easing the
         * meeting stiles is the discipline every inset door has always
         * needed — the check's job is to say the number out loud. */
        {
          const crossW = Math.min(dp.size.w, dp.size.h);
          const swing = G.doorSwingMM(dp.size.w, dp.size.h, dp.material, dMC);
          const closure = nLeaves * swing / 2;
          const freeRide = !inset && nLeaves === 1;
          const budget = inset ? G.DOOR_REVEAL : nLeaves * G.HINGE_ADJUST_MM;
          const over = !freeRide && closure > budget;
          const revFixes = [];
          if (over && inset) revFixes.push({ id: 'door-overlay', label: 'Overlay the doors (forgiving style)', patch: { doors: { style: 'overlay' } } });
          checks.push({
            id: 'door:reveal', title: 'Reveal survival',
            status: over ? 'advisory' : 'pass',
            value: freeRide
              ? `overlay single: ${fmtFine(swing)} seasonal swing rides over the case face`
              : `${fmtFine(closure)} of ${inset ? (nLeaves === 2 ? 'meeting-gap' : 'reveal') : 'meeting-gap'} closure vs ${fmtFine(budget)} of fitted air`,
            threshold: inset
              ? `closure ≤ ${fmtFine(budget)} (the fitted reveal) — half of each leaf's full-swing movement arrives at the free edge`
              : `closure ≤ ${fmtFine(budget)} (± ${fmtFine(G.HINGE_ADJUST_MM)} plate adjustment per door)`,
            explain: swing === 0
              ? 'Sheet stock is movement-exempt: cross-laminated plies restrain each other, so the reveal holds all year.'
              : `Each ${fmtLen(crossW)} slab leaf swings ${fmtFine(swing)} across the grain between a dry winter and a damp summer; the hinge screws pin one edge, so half of that arrives at the free edge${nLeaves === 2 ? ' of BOTH leaves, meeting in the middle' : ''}.` +
                (freeRide ? ' An overlay single just rides over the case face — nothing to bind against.' : over
                  ? ` That outruns the fitted air: fit in the season you are in and expect the ${inset ? 'reveal' : 'centre gap'} to breathe — fit tight in the HUMID season so winter opens a gap instead of summer binding it. Quartersawn stock roughly halves the swing; ${inset ? 'an overlay style forgives the case edges entirely' : 'the plates re-centre what they can'}.`
                  : ' Inside the fitted air — the reveal breathes but survives the year.'),
            fixes: revFixes,
            data: { crossWidthMM: crossW, swingMM: swing, closureMM: closure, budgetMM: freeRide ? null : budget },
            prov: { rule: `swing = ${Math.round(crossW)} × ct × ${dMC}%; closure = ${nLeaves} × swing/2 = ${closure.toFixed(2)} mm vs ${freeRide ? 'n/a (overlay single)' : `${budget} mm`}` }
          });
        }

        /* ---- door:catch — catches as load-rated hardware ----
         * Selection is BB.HW.catchSpec — one pure function the BOM, this
         * check, and the fitting step all call, so the label, the count,
         * and the rating can never disagree (the hinge-count contract,
         * extended to the keeper). */
        {
          const cs = BB.HW.catchSpec(worst.kg, dp.size.h, spec.hardware && spec.hardware.pull);
          checks.push({
            id: 'door:catch', title: 'Door catches',
            status: cs.substituted ? 'advisory' : 'pass',
            value: `${cs.count} × ${cs.label.toLowerCase()} per door — ${U().fmtWeight(cs.holdKg)} hold class, ${cs.marginRatio}× over the swing demand`,
            threshold: `hold ≥ 1.5× the out-of-plumb swing force (m·g·sin 3° shared across ${cs.count} catch${cs.count > 1 ? 'es' : ''}); touch latches refuse leaves past ${U().fmtWeight(4)} (spring cap)`,
            explain: (cs.count === 2 ? `At ${fmtLen(dp.size.h)} this leaf takes a catch top AND bottom, so both free corners are held flat against seasonal twist. ` : '') +
              (cs.substituted
                ? `A handleless front wants a touch latch, but at ${U().fmtWeight(worst.kg)} this leaf is past the ~${U().fmtWeight(4)} the pop-out spring can throw — an honest magnetic catch is fitted instead, and the front needs a pull after all.`
                : `A case leaning 3° swings its own doors open; ${cs.count} × ${cs.label.toLowerCase()} holds ${U().fmtWeight(cs.holdKg * cs.count)} of class rating against a ${cs.demandN.toFixed(2)} N computed demand per catch.`),
            fixes: [],
            data: { countPerDoor: cs.count, holdN: cs.holdN, demandN: cs.demandN, marginRatio: cs.marginRatio, substituted: cs.substituted },
            prov: { rule: `demand = ${worst.kg.toFixed(2)} kg × g × 0.05 / ${cs.count} = ${cs.demandN.toFixed(2)} N vs ${cs.holdN} N hold (${cs.label})` }
          });
        }
      }
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
        /* A stretcher is a brace at a KNOWN height, so its effect is measured
         * rather than assumed. Euler's effective length for a strut braced at
         * one point is the longer of the two resulting segments — brace a leg
         * dead centre and you halve it; brace it near the floor and you have
         * barely helped. That distinction is the whole reason stretcherHeight
         * is a knob, and the flat 0.6 factor below cannot express it.
         *
         * Shelves and rails keep the 0.6 estimate: their heights vary across
         * the piece and no single one of them braces every leg, so there is
         * no honest single number to measure. Unchanged for every design that
         * has no stretcher. */
        const stretchers = custom ? [] : parts.filter(p => p.role === 'stretcher');
        const worst = legs.reduce((m, l) => {
          let len;
          if (stretchers.length) {
            // Lowest brace on this leg governs: the segment above it is the
            // one that buckles. Legs run floor→top, so pos.y is the centre.
            const braceY = Math.min(...stretchers.map(s => s.pos.y));
            len = Math.max(braceY, l.size.h - braceY);
          } else {
            len = l.size.h * (braced ? 0.6 : 1);
          }
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
          /* Bracing beats bulk here, so it is offered first. Solved, not
           * guessed: the height that minimises the worst segment is the leg's
           * own midpoint, and correction clamps it to what the apron leaves. */
          if (FRAME_TEMPLATES.includes(t) && (!spec.structure || spec.structure.stretcher === 'none')) {
            fixes.unshift({
              id: 'stretcher', label: 'Brace the legs with stretchers',
              patch: { structure: { stretcher: 'h', stretcherHeight: Math.round(worst.l.size.h / 2) } }
            });
          }
          const measured = stretchers.length > 0;
          checks.push({
            id: 'slender', title: 'Leg slenderness', status: worst.r > 20 ? 'advisory' : 'pass',
            value: `worst L/t = ${worst.r.toFixed(1)}${measured ? ' (stretcher-braced)' : braced ? ' (braced)' : ''}`,
            threshold: '≤ 20 unbraced length / least thickness',
            explain: worst.r > 20
              ? 'Long thin legs bow under load and feel wobbly — add bracing or use thicker stock.'
              : measured
                ? `Legs are stocky enough for the ${fmtLen(Math.max(...legs.map(l => l.size.h)) - Math.min(...stretchers.map(s => s.pos.y)))} the stretchers leave unbraced above them.`
                : 'Legs are stocky enough for their unbraced length.',
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
      let surfGroups = 0, coupleRoots = 0; // custom coverage tally (G2 honesty)
      const specParts = custom ? new Map(((spec.custom && spec.custom.parts) || []).map(p => [p.id, p])) : null;
      /* Every margin the check weighs, recorded so a proposed joint upgrade
       * can be re-rated against ALL of them (B-fixes-2) — a fix that lifts
       * the named joint while another one still fails is not a fix. Each
       * entry carries the joints that make up its capacity (`group`), how
       * they combine (min for a single load path, sum for a couple), and the
       * demand they carry; the margins themselves stay exactly as computed. */
      const entries = [];
      const connKey = c => (c.a < c.b ? c.a + '|' + c.b : c.b + '|' + c.a);
      const isScrewed = j => j === 'butt_screws' || j === 'pocket_screws';
      const marginUnder = (e, swap) => {
        let cap = e.combine === 'sum' ? 0 : Infinity;
        for (const g of e.group) {
          const nj = swap.get(g.key) || g.joint;
          const eff = (JOINT_RATING[nj] || JOINT_RATING.butt_screws).capN * (g.eg && isScrewed(nj) ? 0.67 : 1);
          cap = e.combine === 'sum' ? cap + eff : Math.min(cap, eff);
        }
        return (cap * sgF) / e.per;
      };
      /* Mirror of correctCustom's pair-kind rule (spec.js): correction
       * replaces a joint whose kinds don't fit the pair with the level
       * default, so a fix that ignored the rule would land as a DOWNGRADE. */
      const STICKS = ['post', 'rail', 'cylinder'];
      const pairAccepts = (j, a, b) => {
        const def = K.JOINERY[j];
        if (!def || def.external) return false; // a french cleat fastens to the building, not to a part
        const pa = specParts && specParts.get(a), pb = specParts && specParts.get(b);
        if (!pa || !pb) return false;
        const aS = STICKS.includes(pa.primitive), bS = STICKS.includes(pb.primitive);
        const kinds = aS && bS ? ['frame'] : (aS || bS) ? ['frame', 'case'] : ['case', 'panel', 'box'];
        return def.kinds.some(k => kinds.includes(k));
      };
      /* Build the patch that puts joint `j` where the weak margin is:
       *  - template slot (the :upjoint path): the slot's joinery key;
       *  - custom grammar: the connections that MAKE this margin, rewritten
       *    in place (parts untouched) — every one that is weaker than `j` and
       *    can physically take it. Returns the patch plus the key→joint map
       *    the re-rating above reads, or null when nothing would change. */
      const swapFor = (e, j) => {
        const map = new Map();
        if (e.slot) {
          if (!K.jointAllowed(j, level, e.slot)) return null;
          map.set(e.slot, j);
          return { map, patch: { joinery: { [e.slot]: j } } };
        }
        const cap = JOINT_RATING[j].capN;
        for (const g of e.group) {
          const eff = (JOINT_RATING[g.joint] || JOINT_RATING.butt_screws).capN * (g.eg && isScrewed(g.joint) ? 0.67 : 1);
          if (eff >= cap) continue;
          if (!pairAccepts(j, g.a, g.b)) continue;
          map.set(g.key, j);
        }
        if (!map.size) return null;
        const conns = ((spec.custom && spec.custom.connections) || []).map(c =>
          map.has(connKey(c)) ? { ...c, joint: j } : c);
        return { map, patch: { custom: { parts: (spec.custom && spec.custom.parts) || [], connections: conns } } };
      };
      for (const s of surfaces) {
        /* Chairs run their own joint cases (chair:tilt is the governing one,
         * chair:cyclic the durability one) — the generic per-surface share
         * would price the seat's movement screws as the load path, which is
         * the wrong model for a frame the slab merely rests on. */
        if (t === 'chair' || t === 'wall_shelf') continue; // both run their own joint/anchor cases
        const N = totalLoadN(s.presetKey, s.span);
        let joint = null, count = 2, where = '', slot = null, endGrain = false;
        let demand = null, apron = false; // G5: apron end reaction overrides N/count
        const group = []; // the joints this margin is made of (fix re-rating)
        if (custom) {
          const conns = ((spec.custom && spec.custom.connections) || []).filter(c => c.a === s.id || c.b === s.id);
          if (!conns.length) continue;
          surfGroups++;
          count = conns.length;
          let minCap = Infinity, capGroup = 0;
          for (const c of conns) {
            const rating0 = JOINT_RATING[c.joint] || JOINT_RATING.butt_screws;
            let capC = rating0.capN;
            const pa = specParts.get(c.a), pb = specParts.get(c.b);
            const screwed = c.joint === 'butt_screws' || c.joint === 'pocket_screws';
            const eg = screwed && pa && pb && (BB.Spec.endGrainBearing(pa, pb) || BB.Spec.endGrainBearing(pb, pa));
            if (eg) capC *= 0.67;
            capGroup += capC * sgF;
            if (capC < minCap) { minCap = capC; joint = c.joint; endGrain = !!eg; }
            group.push({ key: connKey(c), a: c.a, b: c.b, joint: c.joint, eg: !!eg });
          }
          where = s.id;
          /* G2: a cantilevered surface's real failure mode is the ROOT MOMENT,
           * not vertical shear — the overhung load levers its fasteners out.
           * Demand: the beam check's own root moment resisted as a couple
           * inside the member — tension in the joint group over an arm bounded
           * by the shelf thickness (⅔·h, compression at the far edge line).
           * Capacity: the group's summed SG-scaled ratings — a conservative
           * shear-equivalent stand-in, no new physics tables. Same 1.5× gate. */
          if (s.model === 'cant' && s._M > 0) {
            coupleRoots++;
            const T = s._M / (0.67 * s.h);
            const mC = capGroup / T;
            const eC = { margin: mC, joint, where: `${s.id} cantilever root`, per: T, cap: capGroup, slot: null, endGrain: false, couple: true, h: s.h, group, combine: 'sum' };
            entries.push(eC);
            if (!weakest || mC < weakest.margin) weakest = eC;
          }
        } else if (TABLE_LIKE.includes(t)) {
          if (s.part.role === 'top') {
            joint = spec.joinery.frame; count = 8; where = 'apron–leg'; slot = 'frame';
            /* G5 (B7): the frame model above already says the aprons are the
             * beams — each carries half the spread load and ¾ of the point
             * load. The joint demand must be SELF-CONSISTENT with it: the
             * loaded apron's end joint carries the apron END REACTION
             * (Σ 0.5·w·L/2 for spread cases + Σ 0.75·P/2 for a midspan
             * point), not an equal 1/count share of the surface total —
             * which flattered the true worst joint by 2–3×. */
            if (s.apron) {
              apron = true;
              demand = 0;
              for (const c of loadCasesFor(s.presetKey, s.apron.span, 'ss')) {
                if (c.fn === 'udlSS') demand += (0.5 * c.mag) * s.apron.span / 2;
                else demand += (0.75 * c.mag) / 2;
              }
            }
          } else { joint = spec.joinery.case; count = 4; where = 'shelf–leg'; slot = 'case'; }
        } else {
          joint = spec.joinery.case; count = 2; where = `${s.part.role}–side`; slot = 'case';
        }
        const rating = JOINT_RATING[joint] || JOINT_RATING.butt_screws;
        const cap = rating.capN * sgF * (endGrain ? 0.67 : 1);
        const per = demand != null ? demand : N / count;
        const margin = cap / per;
        if (!custom) group.push({ key: slot, joint, eg: false });
        const entry = { margin, joint, where, per, cap, slot, endGrain, apron, group, combine: 'min' };
        entries.push(entry);
        if (!weakest || margin < weakest.margin) weakest = entry;
      }
      /* G1: load-path connections — every member-to-support joint is checked
       * with the member's end reaction as demand, so a joinery change on the
       * load path re-runs adequacy (the T2 mortise&tenon → pocket-screw swap
       * used to pass unexamined). */
      for (const mc of memberChecks) {
        for (const q of mc.supports) {
          const cn = ((spec.custom && spec.custom.connections) || []).find(c =>
            (c.a === mc.part.id && c.b === q.id) || (c.b === mc.part.id && c.a === q.id));
          if (!cn) continue;
          const rating = JOINT_RATING[cn.joint] || JOINT_RATING.butt_screws;
          const pa = specParts.get(cn.a), pb = specParts.get(cn.b);
          const screwed = cn.joint === 'butt_screws' || cn.joint === 'pocket_screws';
          const eg = !!(screwed && pa && pb && (BB.Spec.endGrainBearing(pa, pb) || BB.Spec.endGrainBearing(pb, pa)));
          const cap = rating.capN * sgF * (eg ? 0.67 : 1);
          const margin = cap / mc.R;
          const entry = { margin, joint: cn.joint, where: `${mc.part.id}–${q.id}`, per: mc.R, cap, slot: null, endGrain: eg,
            group: [{ key: connKey(cn), a: cn.a, b: cn.b, joint: cn.joint, eg }], combine: 'min' };
          entries.push(entry);
          if (!weakest || margin < weakest.margin) weakest = entry;
        }
      }
      if (weakest) {
        const jLabel = k => K.JOINERY[k] ? K.JOINERY[k].label.toLowerCase() : k;
        const fixes = [];
        if (weakest.margin < 1.5) {
          const s0 = jointStatus(weakest.margin);
          const curCap = (JOINT_RATING[weakest.joint] || JOINT_RATING.butt_screws).capN;
          for (const j of JOINT_UPGRADES) {
            if (!allowed.includes(j)) continue;            // the level matrix is never crossed
            if (!JOINT_RATING[j] || JOINT_RATING[j].capN <= curCap) continue;
            const swap = swapFor(weakest, j);
            if (!swap) continue;
            // Re-rate EVERY recorded margin under the patch, not just this one.
            let worstM = Infinity;
            for (const e of entries) worstM = Math.min(worstM, marginUnder(e, swap.map));
            const s1 = jointStatus(worstM);
            if (!better(s1, s0)) continue;
            fixes.push({
              id: 'upjoint',
              label: `Upgrade ${weakest.where} to ${jLabel(j)}${s1 === 'pass' ? '' : PARTIAL_MARGIN}`,
              patch: swap.patch
            });
            break;
          }
        }
        /* The explain names exactly what was examined (G2): on customs only
         * the load-surface groups, cantilever roots, and load-path support
         * connections were checked — never "every joint", because decorative
         * or off-path connections are not. Template joint models cover the
         * structural joints by construction, so their wording stands. */
        const coverage = `${surfGroups} load-surface joint group${surfGroups === 1 ? '' : 's'}` +
          (coupleRoots ? `, ${coupleRoots} cantilever root${coupleRoots === 1 ? '' : 's'}` : '') +
          (memberChecks.length ? ` and ${memberChecks.length} supporting member${memberChecks.length === 1 ? '' : 's'}` : '');
        checks.push({
          id: 'joints', title: 'Joint adequacy',
          status: weakest.margin >= 1.5 ? 'pass' : weakest.margin >= 1 ? 'advisory' : 'fail',
          value: weakest.couple
            ? `weakest: ${jLabel(weakest.joint)} at ${weakest.where} — cantilever couple pulls ${U().fmtPointLoad(weakest.per / GRAV)} vs ${U().fmtPointLoad(weakest.cap / GRAV)} group capacity`
            : `weakest: ${jLabel(weakest.joint)} at ${weakest.where}${weakest.endGrain ? ' (end grain, ×0.67)' : ''} — ${U().fmtPointLoad(weakest.per / GRAV)} per joint vs ${U().fmtPointLoad(weakest.cap / GRAV)} capacity`,
          threshold: '≥ 1.5× capacity margin (SG-scaled joint ratings)',
          explain: (weakest.margin >= 1.5
            ? (custom ? `Checked ${coverage} — every checked connection holds its load with at least 1.5× in hand.`
              : 'Every joint carries its share of the load path with room to spare.')
            : weakest.couple
              ? `The overhung load levers this joint group out of its support: the root moment resists as a pull-out couple across two-thirds of the ${fmtLen(weakest.h)} member thickness, and the ${jLabel(weakest.joint)} group at ${weakest.where} can't hold it.`
              : `The ${jLabel(weakest.joint)} joints at ${weakest.where} are the weak link in the load path.`) +
            (custom && weakest.margin < 1.5 ? ` (Checked: ${coverage}.)` : '') +
            (weakest.apron ? ' Demand is the loaded apron\'s end reaction from the same frame model the sag checks use (half the spread load + ¾ of the point load per apron).' : '') +
            (weakest.endGrain ? ' Screws at this joint bear on end grain, which holds about a third less (derated ×0.67) — a dowel, tenon, or cleat would restore full capacity.' : ''),
          fixes,
          ...(weakest.apron ? { data: { perN: weakest.per, capN: weakest.cap } } : {})
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
        const pKey = materialSpeciesKey(p, spec);
        const psp = speciesOf(pKey);
        if (psp.sheet) {
          checks.push({
            id: 'move:' + p.id, title: `Movement — ${p.name}`, status: 'pass',
            value: `${psp.key === 'mdf' ? 'engineered panel' : 'plywood'}: ~${fmtFine(0)} seasonal movement`,
            threshold: `≤ ${fmtFine(MOVEMENT_LIMIT)} across the grain`,
            explain: psp.key === 'mdf'
              ? 'MDF is exempt in-plane: the isotropic fiber mat has no grain to move across. (Thickness swell near standing water is its real enemy — seal the edges.)'
              : 'Plywood is exempt: cross-laminated plies restrain each other, so seasonal moisture swings produce no meaningful dimensional change.',
            fixes: [],
            data: { movementMM: 0, crossWidthMM: crossW }
          });
          continue;
        }
        const mv = K.movementMM(crossW, pKey, 'tangential', dMC);
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
          if ((p.role === 'top' || p.role === 'seat') && (TABLE_LIKE.includes(t) || t === 'chair')) ctx = 'floated';
          else if (p.role === 'side') ctx = spec.structure.backPanel ? 'captured' : 'compatible';
          else if (p.role === 'shelf' && TABLE_LIKE.includes(t)) ctx = 'captured'; // notched around the legs
          else if (['top', 'bottom', 'shelf', 'seat'].includes(p.role)) ctx = 'compatible';
        }
        const formula = `${fmtLen(crossW)} × ${psp.ct} (tangential coefficient) × ${dMC}% ΔMC = ${fmtFine(mv)}.`;
        const cupNote = (psp.movement === 'high' && (p.role === 'top' || p.role === 'seat') && crossW >= K.WIDE_TOP_MM)
          ? ' Flat-sawn ' + psp.label.toLowerCase() + ' this wide also wants to cup — alternate growth rings or use quartersawn stock.' : '';
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
          prov: { rule: `movement = width × coefficient × ΔMC = ${Math.round(crossW)} × ${psp.ct} × ${dMC}` }
        });
      }
    }

    const fails = checks.filter(c => c.status === 'fail').length;
    const advisories = checks.filter(c => c.status === 'advisory').length;
    const summary = {
      worstSag: worstSag ? { ...worstSag } : null,
      tipLoaded: tip ? tip.angLoaded : null,
      rackScore: rack.score,
      fails,
      advisories,
      anchorRequired: antiTip,
      // G3: derived (assumed) check surfaces are disclosed, never silent.
      assumedSurfaces: surfaces.filter(s => s.assumed).map(s => s.id),
      /* G4 contract (consumed by Spec.integrityLine / the Safety tab): what
       * load every checked surface was judged under, and whether that was an
       * assumption (engine default or a derived surface) or the user's own
       * pick. User loadChoices are never overridden. */
      surfaceLoads: surfaces.map(s => ({
        id: s.id,
        presetKey: s.presetKey,
        label: (LOAD_PRESETS[s.presetKey] || LOAD_PRESETS.display).label,
        assumed: !!s.assumed || !s.userChosen
      })),
      /* Rollup tier (audit M-18): a mandatory wall anchor is its own headline
       * tier — "safe only when anchored" — never rolled into plain advisory
       * under a "passes the required checks" banner. Order: fail > anchor >
       * advisory > pass. */
      verdict: fails ? 'fail' : antiTip ? 'anchor' : advisories ? 'advisory' : 'pass'
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
