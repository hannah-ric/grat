/* Blueprint Buddy — furniture-class contracts (BB.Classes).
 *
 * A furniture CLASS is an engineering profile, not a template. Before the app
 * may generate a class soundly it must be able to STATE, in code, the nine
 * artifact sets below — and a class that cannot state them is a class the app
 * refuses, because a plausible unverified plan is worse than a refusal.
 *
 * The contract (every registered class supplies all nine):
 *   1. family        parametric family: valid ranges per dimension (owned by
 *                    Spec.DIM_RULES so sliders/correction share one table)
 *                    plus the COUPLING rules that tie dimensions together.
 *   2. humanFactors  dimension table with sources, for anything a body touches.
 *   3. loadCases     magnitudes, application points, direction, duration, and
 *                    acceptance criteria — each traced to a standard or a
 *                    documented derivation (`traceability` says which).
 *   4. jointRules    required and prohibited joints per connection, with the
 *                    reason (computed margins, not taste).
 *   5. failureModes  the checklist the validator runs — one entry per known
 *                    real-world failure of the class. Each entry names the
 *                    check ids that prove the engine examined it (`checkIds`)
 *                    or the correction guard that makes it unreachable
 *                    (`guard`), plus the bad-fixture test that proves it fires.
 *   6. hardware      requirements with capacity ratings matched to computed
 *                    loads.
 *   7. assembly      sequence template: step ids, jigs, clamping strategy,
 *                    squareness/angle checks.
 *   8. refusals      the specific request shapes this class cannot honor, and
 *                    WHERE the refusal is said (correction note, validation
 *                    error, or the intent parser).
 *   9. fixtures      the golden + bad-fixture manifest tests assert against.
 *
 * validateContract() is run by the self-test suite and the unit suite over
 * every registered class; runChecklist() re-derives failure-mode coverage
 * from a live integrity/validation result, so a physics check that silently
 * disappears breaks the build instead of shipping silence.
 *
 * Sources policy: values marked `standard` carry the standard and section;
 * BIFMA texts are paywalled, so magnitudes are pinned from accredited-lab
 * summaries and published test reports (secondary), named in `source`.
 * Values marked `derivation` are OURS and show their arithmetic. Residential
 * furniture is not certified by this file — see DESIGN_BASIS_SEATING.
 */
var BB = globalThis.BB = globalThis.BB || {};

(function () {
  'use strict';
  const K = BB.K;

  const registry = new Map();
  function register(cls) { registry.set(cls.key, cls); }
  function get(key) { return registry.get(key) || null; }
  function all() { return [...registry.values()]; }
  function forTemplate(t) {
    for (const c of registry.values()) if (c.templates.includes(t)) return c;
    return null;
  }

  /* ---------------- contract validation ----------------
   * Returns a list of problems ([] = the contract holds). Deliberately
   * structural AND referential: a family rule must exist in Spec.DIM_RULES,
   * a load case naming a Structural preset must resolve, a failure mode must
   * name either check ids or a correction guard plus its proving fixture.
   */
  function validateContract(cls) {
    const p = [];
    const need = (cond, msg) => { if (!cond) p.push(cls.key + ': ' + msg); };
    need(cls.key && typeof cls.key === 'string', 'class key missing');
    need(Array.isArray(cls.templates) && cls.templates.length, 'templates missing');

    // 1. parametric family
    const fam = cls.family || {};
    need(Array.isArray(fam.rules) && fam.rules.length, 'family.rules missing');
    for (const r of fam.rules || []) {
      need(r.path && r.ownedBy, `family rule needs path+ownedBy (${r.path})`);
      if (r.ownedBy === 'Spec.DIM_RULES') {
        need(BB.Spec && BB.Spec.DIM_RULES && BB.Spec.DIM_RULES[r.path],
          `family rule ${r.path} not found in Spec.DIM_RULES`);
      }
    }
    need(Array.isArray(fam.couplings) && fam.couplings.length, 'family.couplings missing — a family with no coupling rules is a template, not a class');
    for (const c of fam.couplings || []) need(c.id && c.rule && c.enforcedBy, `coupling ${c.id || '?'} needs id+rule+enforcedBy`);

    // 2. human factors with sources
    need(Array.isArray(cls.humanFactors) && cls.humanFactors.length, 'humanFactors missing');
    for (const h of cls.humanFactors || []) {
      need(h.key && h.label && typeof h.min === 'number' && typeof h.max === 'number' && h.min <= h.max,
        `human factor ${h.key || '?'} malformed`);
      need(h.source && h.source.length > 8, `human factor ${h.key || '?'} has no source`);
    }

    // 3. load cases: magnitude, application, direction, duration, acceptance, source
    need(Array.isArray(cls.loadCases) && cls.loadCases.length, 'loadCases missing');
    for (const lc of cls.loadCases || []) {
      for (const f of ['id', 'label', 'magnitude', 'apply', 'direction', 'duration', 'acceptance', 'source', 'traceability']) {
        need(lc[f] !== undefined && lc[f] !== '', `load case ${lc.id || '?'} missing ${f}`);
      }
      need(['standard', 'derivation'].includes(lc.traceability), `load case ${lc.id || '?'} traceability must be standard|derivation`);
      if (lc.ownedBy && lc.ownedBy.startsWith('Structural.LOAD_PRESETS.')) {
        const k = lc.ownedBy.slice('Structural.LOAD_PRESETS.'.length);
        need(BB.Structural && BB.Structural.LOAD_PRESETS[k], `load case ${lc.id} names a missing preset ${k}`);
      }
    }

    // 4. joint rules with reasons
    const jr = cls.jointRules || {};
    need(Array.isArray(jr.connections) && jr.connections.length, 'jointRules.connections missing');
    for (const c of jr.connections || []) {
      need(c.connection && Array.isArray(c.required) && Array.isArray(c.prohibited) && c.reason,
        `joint rule ${c.connection || '?'} needs connection/required/prohibited/reason`);
      for (const j of [...(c.required || []), ...(c.prohibited || [])]) {
        need(!!K.JOINERY[j], `joint rule ${c.connection} names unknown joint ${j}`);
      }
    }

    // 5. failure-mode checklist
    need(Array.isArray(cls.failureModes) && cls.failureModes.length, 'failureModes missing');
    for (const m of cls.failureModes || []) {
      need(m.id && m.mode, `failure mode ${m.id || '?'} malformed`);
      need((Array.isArray(m.checkIds) && m.checkIds.length) || m.guard,
        `failure mode ${m.id} names neither checkIds nor a correction guard`);
      need(m.fixture, `failure mode ${m.id} names no proving fixture/test`);
    }

    // 6. hardware with capacities matched to loads
    need(Array.isArray(cls.hardware), 'hardware missing (may be empty only with reason)');
    for (const h of cls.hardware || []) {
      need(h.id && h.item && h.when && h.capacity && h.matchedTo, `hardware ${h.id || '?'} needs item/when/capacity/matchedTo`);
    }

    // 7. assembly template
    const asm = cls.assembly || {};
    need(Array.isArray(asm.sequence) && asm.sequence.length >= 3, 'assembly.sequence missing/too thin');
    need(Array.isArray(asm.jigs) && asm.jigs.length, 'assembly.jigs missing');
    need(Array.isArray(asm.checks) && asm.checks.length, 'assembly.checks (squareness/angle) missing');

    // 8. refusals
    need(Array.isArray(cls.refusals) && cls.refusals.length, 'refusals missing — a class that can build anything asked of it is lying');
    for (const r of cls.refusals || []) {
      need(r.id && r.shape && r.reason && r.surface, `refusal ${r.id || '?'} needs shape/reason/surface`);
    }

    // 9. fixture manifest
    const fx = cls.fixtures || {};
    need(Array.isArray(fx.golden) && fx.golden.length, 'fixtures.golden missing');
    need(Array.isArray(fx.bad) && fx.bad.length, 'fixtures.bad missing');
    return p;
  }

  /* ---------------- failure-mode coverage over a live result ----------------
   * For the class owning `template`, walk the checklist against the emitted
   * integrity checks + validation errors. A mode is `covered` when at least
   * one emitted check/error id matches one of its prefixes (or it is guarded
   * by correction, which is deterministic and fixture-proven). `fired` means
   * it detected something (non-pass). The self-test asserts full coverage on
   * a nominal design of every class.
   */
  function runChecklist(template, res) {
    const cls = forTemplate(template);
    if (!cls) return null;
    const ids = []
      .concat(((res && res.integrity && res.integrity.checks) || []).map(c => ({ id: c.id, status: c.status })))
      .concat(((res && res.validation && res.validation.errors) || []).map(e => ({ id: e.id, status: 'fail' })))
      .concat(((res && res.validation && res.validation.advisories) || []).map(a => ({ id: a.id, status: 'advisory' })));
    return cls.failureModes.map(m => {
      if (m.guard) return { id: m.id, mode: m.mode, covered: true, guard: m.guard, fired: false, status: 'guarded' };
      const hits = ids.filter(x => m.checkIds.some(px => x.id === px || x.id.startsWith(px)));
      const worst = hits.reduce((w, h) => (h.status === 'fail' ? 'fail' : h.status === 'advisory' && w !== 'fail' ? 'advisory' : w), 'pass');
      /* `conditional` modes exist only when their geometry does (an overhang,
       * a stool, an out-of-band dimension) — absence on THIS design is 'n/a',
       * and the mode's named fixture test proves it fires where it applies. */
      const absent = m.conditional ? 'n/a' : 'uncovered';
      return { id: m.id, mode: m.mode, covered: hits.length > 0, fired: hits.some(h => h.status !== 'pass'), status: hits.length ? worst : absent };
    });
  }

  /* =========================================================================
   * RETROFIT: frame_table — the pre-existing leg-and-apron class (table /
   * desk / bench), restated onto the contract. Nothing here invents a new
   * number: every artifact points at the code that already owns it. This is
   * the proof the contract generalizes beyond seating — a contract that only
   * fits chairs would be wrong.
   * ========================================================================= */
  register({
    key: 'frame_table',
    label: 'Tables, desks & benches (leg-and-apron frame)',
    templates: ['table', 'desk', 'bench'],
    family: {
      rules: [
        { path: 'overall.width', ownedBy: 'Spec.DIM_RULES' },
        { path: 'overall.depth', ownedBy: 'Spec.DIM_RULES' },
        { path: 'overall.height', ownedBy: 'Spec.DIM_RULES' },
        { path: 'structure.topThickness', ownedBy: 'Spec.DIM_RULES' },
        { path: 'structure.legThickness', ownedBy: 'Spec.DIM_RULES' },
        { path: 'structure.apronHeight', ownedBy: 'Spec.DIM_RULES' },
        { path: 'structure.apronThickness', ownedBy: 'Spec.DIM_RULES' },
        { path: 'structure.stretcherHeight', ownedBy: 'Spec.DIM_RULES' }
      ],
      couplings: [
        { id: 'apron_under_top', rule: 'apronHeight ≤ height − topThickness − 60: the apron band must leave leg below the top', enforcedBy: 'Spec.correctSpec geometry-sanity clamp' },
        { id: 'leg_vs_footprint', rule: 'legThickness ≤ min(width, depth)/4, snapped DOWN the post-stock table', enforcedBy: 'Spec.correctSpec legCap (audit E-04)' },
        { id: 'stretcher_on_leg', rule: 'stretcher centreline ∈ [floor+100, apron underside − 90] — it must land on the leg with clamp room', enforcedBy: 'Spec.correctSpec stretcher clamp (X-07)' },
        { id: 'drawer_in_band', rule: 'desk drawers live INSIDE the apron band: opening = apronHeight − 40 clamped 45–80 (pencil-drawer class, hence the 45 mm floor in validate), fronts inset, wood runners at every level (no case side for slides), a single opening wider than 620 splits around a centre stile', enforcedBy: 'Spec.correctSpec desk-drawer block + Parametric.addDeskDrawers' },
        { id: 'knee_room', rule: 'desk knee clearance = height − top − band ≥ ~600 (Panero & Zelnik seated knee; ADA 306.3 asks 685 for accessible desks) — advisory, never silent', enforcedBy: 'Spec.validate ergo_knee' },
        { id: 'long_span', rule: 'clear span between legs > 1800 scales the racking score down (linearly to ×0.7 at the cap) — the couple on the apron–leg joints grows with span while joint capacity is fixed, and the top’s torsional stiffness stops helping', enforcedBy: 'Structural racking span factor (roadmap item 2)' },
        { id: 'exposure_routing', rule: 'exposure ∈ {interior, covered, exposed} (one spec field, roadmap item 5): outdoor routes Type-I glue (K.recommendGlue), an exterior finish, stainless/hot-dip-galvanized fastener lines, and the outdoor ΔMC (K.EXPOSURE_DMC, WH ch. 13) into the movement math; EXPOSED additionally corrects a non-durable species to the deterministic durable substitute (costTier 1 → western_red_cedar, else white_oak) and is told', enforcedBy: 'Spec.correctSpec exposure block + exposureNotes + K.effectiveDMC + validate out_* checks' }
      ]
    },
    humanFactors: [
      { key: 'dining_height', label: 'Dining table height', min: 730, max: 760, unit: 'mm', source: 'K.ERGONOMICS dining_height (Panero & Zelnik, Human Dimension & Interior Space; trade convention 29–30 in)' },
      { key: 'desk_height', label: 'Desk height', min: 720, max: 750, unit: 'mm', source: 'K.ERGONOMICS desk_height (BIFMA G1 ergonomics guideline seated worksurface band)' },
      { key: 'bench_seat', label: 'Bench seat height', min: 430, max: 480, unit: 'mm', source: 'K.ERGONOMICS bench_seat (Panero & Zelnik seat-height band)' }
    ],
    loadCases: [
      { id: 'worktop_dist', label: 'Distributed working load', magnitude: '75 kg spread over the top', apply: 'uniform over the span', direction: 'gravity', duration: 'functional (short-term)', acceptance: 'sag ≤ L/300; bending margin ≥ 1 at MOR/4', source: 'BIFMA X5.5 distributed functional load (preset basis string)', traceability: 'standard', ownedBy: 'Structural.LOAD_PRESETS.worktop' },
      { id: 'worktop_edge', label: 'Concentrated lean at the edge', magnitude: '90 kg point', apply: 'worst midspan / overhang edge', direction: 'gravity', duration: 'functional', acceptance: 'sag ≤ L/300 (span) and ≤ L/150 (overhang); strength margin ≥ 1', source: 'BIFMA X5.5 concentrated functional load (preset basis string)', traceability: 'standard', ownedBy: 'Structural.LOAD_PRESETS.worktop' },
      { id: 'bench_seat', label: 'Seated people on a bench', magnitude: '136 kg per 550 mm seat', apply: 'point at midspan + spread for extra seats', direction: 'gravity', duration: 'functional', acceptance: 'sag ≤ L/300; strength margin ≥ 1; joint margin ≥ 1.5', source: 'aligned to BIFMA X5.4 drop-test proof mass 300 lb (136 kg); functional drop mass is 225 lb — design load sits above functional', traceability: 'standard', ownedBy: 'Structural.LOAD_PRESETS.seating' },
      { id: 'shelf_books', label: 'Lower shelf under books', magnitude: '60 kg/m', apply: 'uniform, sustained', direction: 'gravity', duration: 'sustained (×2 creep, Wood Handbook ch. 4)', acceptance: 'long-term sag ≤ L/300', source: 'BIFMA X5.9 shelf load 40 lb/ft (preset basis string)', traceability: 'standard', ownedBy: 'Structural.LOAD_PRESETS.books' }
    ],
    jointRules: {
      connections: [
        { connection: 'apron → leg', required: ['mortise_tenon', 'dowels', 'pocket_screws', 'loose_tenon', 'kd_bolt', 'half_lap', 'bridle'], prohibited: ['biscuits', 'edge_glue'], reason: 'the apron-leg joint carries the apron end reaction (frame model, audit F-S2-1/G5); biscuits are an alignment aid and edge glue is a panel operation — neither attaches a rail to a leg. The level matrix gates further; the joint-adequacy check prices whatever is chosen.' },
        { connection: 'top → apron', required: ['butt_screws'], prohibited: ['edge_glue'], reason: 'a solid top must move across its grain: figure-8s/buttons in slotted or pivoting fittings, never glue (movement check + FE-H1).' },
        { connection: 'stretcher → leg', required: ['mortise_tenon', 'dowels', 'pocket_screws', 'loose_tenon', 'half_lap'], prohibited: ['biscuits'], reason: 'the stretcher shortens the leg’s unbraced length — its joint takes the frame slot’s own gating (X-07).' }
      ]
    },
    failureModes: [
      { id: 'top_sag', mode: 'top sags between aprons under load', checkIds: ['sag:top_1', 'sag:apron:'], fixture: 'audit F-S2-1', realWorld: 'dished tabletops' },
      { id: 'member_rupture', mode: 'apron or top passes deflection but fails in bending', checkIds: ['str:'], fixture: 'audit F-S2-1 / handcalc [2]', realWorld: 'cracked aprons under a sat-on table edge' },
      { id: 'overhang_dive', mode: 'a person leans on an overhang and it dives', checkIds: ['cant:'], conditional: true, fixture: 'handcalc [overhang]', realWorld: 'tip-edge failures on cantilevered tops' },
      { id: 'racking', mode: 'frame racks side-to-side (wobbles) under horizontal use loads', checkIds: ['rack'], fixture: 'unit racking sections', realWorld: 'loose wobbly tables' },
      { id: 'leg_buckle', mode: 'slender legs bow under load', checkIds: ['slender'], fixture: 'unit slenderness sections', realWorld: 'spindly hall tables' },
      { id: 'movement_split', mode: 'captured cross-grain panel splits with the seasons', checkIds: ['move:'], fixture: 'audit F-S2-3', realWorld: 'split solid tops screwed rigid' },
      { id: 'joint_overload', mode: 'weakest frame joint below its load share', checkIds: ['joints'], fixture: 'audit G5', realWorld: 'aprons torn off their legs' },
      { id: 'tipping', mode: 'piece tips when top-loaded at the edge', checkIds: ['tip'], fixture: 'audit M-18', realWorld: 'tall narrow pieces going over' },
      { id: 'band_weakened', mode: 'the drawer opening guts the front apron and the band sags or breaks', checkIds: ['sag:apron:', 'str:apron:'], conditional: true, fixture: 'audit DESK-1 (stiffness-shared band model, handcalc [17])', realWorld: 'pencil-drawer desks that bounce at the front edge' },
      { id: 'drawer_pullout_tip', mode: 'open drawer + downward pull tips the desk', checkIds: ['tip_f2057'], conditional: true, fixture: 'audit DESK-2 (reported; anchor mandate stays scoped to clothing storage)', realWorld: 'kids hanging on an open pencil drawer' },
      { id: 'weather_rot', mode: 'a non-durable species or interior materials left in the weather rot, delaminate, and shed their finish', conditional: true, guard: 'Spec.correctSpec exposure routing (durable species substitution + exterior finish) with exposureNotes disclosure; validate out_sheet refuses interior sheet goods exposed', checkIds: ['out_'], fixture: 'audit OUT-2/OUT-3/OUT-5; golden pine-patio-table-metric freezes the substitution', realWorld: 'the picnic-table pine bench that composts itself in three seasons' }
    ],
    hardware: [
      { id: 'top_fasteners', item: 'figure-8 fasteners / tabletop buttons', when: 'every solid top', capacity: 'hold-down only; movement is released by design', matchedTo: 'seasonal travel computed by K.movementMM — the same number the movement check reports' },
      { id: 'antitip', item: 'anti-tip wall anchor kit', when: 'tip margin below gate', capacity: 'per kit rating', matchedTo: 'tipping checks (mandatory BOM line when they fire, audit M-18)' },
      { id: 'desk_drawer_gear', item: 'hardwood runners (cut list) + drawer pulls (BB.HW pullSpec)', when: 'desk drawers', capacity: 'runners are lumber sized by the box; pull bores computed by code', matchedTo: 'the wood-runner clearance model (climate-driven, FE-C2 family) and the pull rules the casework banks already use' }
    ],
    assembly: {
      sequence: ['layout', 's1 (end frames)', 's2 (join frames)', 'base_check (cure + rock check)', 's3 (attach top floating)'],
      jigs: ['cabinetmaker’s triangle marking', 'one reference face/edge per leg', 'stop block for foot-aligned stretcher setout'],
      checks: ['equal diagonals on each end frame', 'wind (twist) sighted along clamp bars', 'diagonals across the closed base', 'leg tops in one plane', 'one-foot trim rule on a rocking base']
    },
    refusals: [
      { id: 'no_wall_hang', shape: 'wall-hung / floating variants of a frame piece', reason: 'anchor pullout and stud engagement are a different class (wall-mounted) not yet generated soundly', surface: 'correction grounds airborne parts + SCHEMA_DOC floor rule' },
      { id: 'no_stretcher_offframe', shape: 'stretchers on carcass templates', reason: 'nothing for them to span on a carcass', surface: 'Spec.correctSpec refuses (stretcher gate)' },
      { id: 'no_over_span', shape: 'tops wider than 2400 mm', reason: 'past the cap the apron-beam model still runs but the racking couple and the top’s torsional floppiness have no code-owned answer (breadboard/batten stiffening is future work) — the clamp is the refusal and correction says so', surface: 'Spec.DIM_RULES overall.width max 2400 (dimensionNotes disclose the clamp) + the racking span factor' },
      { id: 'no_exposed_sheet', shape: 'interior sheet goods (plywood drawer boxes, MDF panels, ply backs) on an EXPOSED build', reason: 'no exterior-rated sheet good exists in the catalog — interior plywood delaminates and MDF swells when wetted, and a guessed exterior rating is worse than a refusal (covered builds get the advisory instead: sheltered, but unrated)', surface: 'Spec.validate out_sheet error (exposed) / advisory (covered)' }
    ],
    fixtures: {
      golden: ['seed-table-imperial', 'shaker-table-imperial', 'custom-bench-metric', 'walnut-writing-desk-imperial'],
      bad: ['audit F-S2-1 (apron-model regression)', 'unit geometric-buildability sections', 'battery boundary fixtures']
    }
  });

  /* =========================================================================
   * SEATING — chairs and stools. The class that breaks every casework
   * assumption: loads are cyclic and eccentric, the governing case is a user
   * tipped back onto two legs, and the side-rail-to-rear-leg joint is where
   * chairs really die.
   * ========================================================================= */

  /* Design-basis disclosure for every seating output. The app must NEVER
   * claim BIFMA compliance: compliance is physical testing of a physical
   * chair, and residential dining seating is not formally in BIFMA scope. */
  const DESIGN_BASIS_SEATING =
    'Seating checks are BENCHMARKED against ANSI/BIFMA X5.1 / X5.4 magnitudes ' +
    '(pinned from accredited-lab summaries; the standards themselves are ' +
    'paywalled) and against documented derivations for the rear-tilt case. ' +
    'Residential dining chairs are not formally covered by BIFMA, and ' +
    'compliance would require physical testing of a built chair — these are ' +
    'engineering benchmarks, not a compliance claim.';

  /* Load magnitudes, single-sourced for the structural engine AND the
   * contract text. N except where marked. */
  const SEAT_LOADS = {
    /* Seat design load: 136 kg (1334 N). Alignment: X5.1/X5.4 have no static
     * seat test — the seat test is a DROP test, functional mass 102 kg
     * (X5.1 §8) / 225 lb (X5.4), proof 136 kg (300 lb). Designing statically
     * to the PROOF drop mass keeps the app's long-standing 136 kg seating
     * preset and sits above the functional mass. */
    SEAT_STATIC_N: 1334,
    /* Back functional force: 667 N (150 lbf), X5.1-2017 §5/§6 back strength,
     * applied ≤ 406 mm above the seat, held 1 min (Manufacturing Solutions
     * Center lab summary). We apply it at the CREST — a longer lever than
     * the test point, i.e. conservative. */
    BACK_STATIC_N: 667,
    /* Leg strength: 334 N (75 lbf) functional per front leg, X5.4-2012 §16
     * (proof 113 lb). Application height is not published in reachable
     * sources; we apply it horizontally AT THE FOOT with the frame held —
     * the longest lever to the stretcher brace — which is conservative. */
    LEG_STATIC_N: 334,
    /* Cyclic seating durability: 57 kg dropped 100 000 cycles (X5.1 §10.3,
     * X5.4-2020; SGS/Kokuyo report summaries). Modeled as an acceptance
     * factor, not a simulation: joints must carry the static seat case with
     * DOUBLE margin — cyclic acceptable design load ≈ half the static
     * ultimate (Eckelman, Purdue furniture-engineering practice; WFS
     * static-vs-cyclic front-to-back chair studies). */
    CYCLIC_MASS_KG: 57,
    CYCLIC_CYCLES: 100000,
    CYCLIC_CAPACITY_FACTOR: 0.5,
    /* Rear-tilt occupant: the full 136 kg on the two rear legs plus the back
     * force at the crest. Documented derivation (no standard covers tipping
     * back on two legs; every chairmaker designs for it anyway). */
    TILT_OCCUPANT_N: 1334,
    /* Stool footrest: one foot, full body weight, stepping up — 136 kg point
     * at midspan of the front stretcher. Derivation, deliberately at the
     * seat design mass. */
    FOOTREST_STEP_N: 1334
  };

  /* Geometry constants the builder, correction, and checks share. */
  const SEAT_GEOM = {
    CREST_H: 75,          // crest rail height (vertical)
    SLAT_H: 60,           // back slat height
    SLAT_T: 16,           // back slat thickness (thinner than the post, so rake can offset)
    SLAT_RISE: 170,       // bottom slat centreline above the seat (lumbar)
    REAR_POST_MIN_D: 45,  // rear posts run deeper fore-aft than wide: bending is about that axis
    MORTISE_DERATE: 10,   // mm of post width lost to the rail mortise at the max-moment section
    CORNER_BLOCK: 60,     // corner block leg length
    FOOTREST_DROP: 230,   // footrest below the seat (K.ERGONOMICS bar_stool_seat note)
    COUNTER_DROP: 270,    // seat below the counter it serves (midpoint of the 250–300 window)
    /* Max honest back rake from STRAIGHT rear posts: crest and bottom slat
     * offset in opposite directions inside the post depth. Beyond this is a
     * sawn/bent rear leg — short grain at the bend — which the class refuses. */
    /* Rear posts run at least REAR_POST_MIN_D deep fore-aft (bending about
     * that axis is where the back load lives), and the rake offsets live in
     * that same depth — so the cap reads the POST depth, not the leg width. */
    rearPostDepth(st) { return Math.max(st.legThickness || 38, this.REAR_POST_MIN_D); },
    backRakeMax(st, seat) {
      const off = Math.max(0, this.rearPostDepth(st) - this.SLAT_T);
      const span = Math.max(120, (seat.backHeight - this.CREST_H / 2) - this.SLAT_RISE);
      return Math.round(Math.atan(off / span) * 180 / Math.PI * 10) / 10;
    }
  };

  /* Seat-frame joinery mandate. Computed at the rear-tilt couple (see the
   * structural engine's chair:tilt check and test/handcalc.js): demand ≈
   * 840 N per side joint on the nominal dining chair; capacities are the
   * SG-scaled JOINT_RATING values. Screws and biscuits never reach the 1.5×
   * gate in ANY stocked species (pocket screws top out ≈ 1.35× in hickory);
   * dowels hover at 1.0–1.35× and halve again under the cyclic factor. */
  const SEAT_FRAME_ALLOWED = ['mortise_tenon', 'loose_tenon', 'kd_bolt'];
  const SEAT_FRAME_DEFAULT = { beginner: 'kd_bolt', intermediate: 'loose_tenon', advanced: 'mortise_tenon' };
  function enforceFrameJoint(joint, level) {
    if (SEAT_FRAME_ALLOWED.includes(joint) && K.jointAllowed(joint, level, 'frame')) return joint;
    return SEAT_FRAME_DEFAULT[level] || SEAT_FRAME_DEFAULT.beginner;
  }

  register({
    key: 'seating',
    label: 'Seating (dining chairs, counter & bar stools)',
    templates: ['chair'],
    geom: SEAT_GEOM,
    loads: SEAT_LOADS,
    enforceFrameJoint,
    DESIGN_BASIS_SEATING,
    family: {
      rules: [
        { path: 'seat.width', ownedBy: 'Spec.DIM_RULES' },
        { path: 'seat.depth', ownedBy: 'Spec.DIM_RULES' },
        { path: 'seat.height', ownedBy: 'Spec.DIM_RULES' }
      ],
      couplings: [
        { id: 'counter_drop', rule: 'a stool serving a stated counter takes seat height = counter − 250…300 (snap to −270); a stool with NO counter stated is asked for one', enforcedBy: 'Spec.correctSeat + validate chair block' },
        { id: 'rake_from_posts', rule: 'backRake ≤ atan((legThickness − slatT) / slat span): straight rear posts only — more rake needs a sawn/bent leg (refused, short grain)', enforcedBy: 'Spec.correctSeat via SEAT_GEOM.backRakeMax' },
        { id: 'splay_stool_only', rule: 'leg splay 0–10° on stools; 0 on backed chairs (the offset-rail rake geometry assumes vertical posts)', enforcedBy: 'Spec.correctSeat' },
        { id: 'envelope_derived', rule: 'overall = seat plan + splay run; height = seat + back rise — the audit envelope always contains the splayed feet', enforcedBy: 'Spec.correctSpec chair block' },
        { id: 'footrest_drop', rule: 'stool footrest (box stretcher) top ≈ 230 below the seat; stools ALWAYS carry it — it is structure and ergonomics at once', enforcedBy: 'Spec.correctSpec chair block' },
        { id: 'rail_band', rule: 'seat-rail band ≤ seat height − topThickness − 160 so the stretcher and knee room survive', enforcedBy: 'Spec.correctSpec chair block' },
        { id: 'exposure_routing', rule: 'the cross-class exposure overlay (roadmap item 5) applies: outdoor chairs/stools route Type-I glue, exterior finish, corrosion-spec fasteners and outdoor ΔMC; exposed corrects non-durable species and is told', enforcedBy: 'Spec.correctSpec exposure block + exposureNotes + K.effectiveDMC + validate out_* checks' }
      ]
    },
    humanFactors: [
      { key: 'dining_seat_height', label: 'Dining seat height', min: 430, max: 460, unit: 'mm', source: 'Panero & Zelnik, Human Dimension & Interior Space (16.5–18 in); trade convention for 730–760 tables' },
      { key: 'seat_depth', label: 'Seat depth', min: 400, max: 430, unit: 'mm', source: 'Panero & Zelnik buttock–popliteal 5th percentile female fit; deeper cuts circulation at the knee' },
      { key: 'seat_width', label: 'Seat width', min: 400, max: 500, unit: 'mm', source: 'Panero & Zelnik hip breadth + clothing allowance' },
      { key: 'seat_slope', label: 'Seat slope (rearward)', min: 0, max: 8, unit: 'deg', source: 'chairmaking convention 3–5°; BIFMA G1 task-seat pan range' },
      { key: 'back_rake', label: 'Back rake off vertical', min: 0, max: 8, unit: 'deg', source: 'chairmaking convention: a few degrees off vertical for dining; more is lounge territory' },
      { key: 'back_rise', label: 'Crest above the seat', min: 380, max: 600, unit: 'mm', source: 'lumbar-to-shoulder support band, Panero & Zelnik' },
      { key: 'counter_stool_seat', label: 'Counter stool seat height', min: 610, max: 660, unit: 'mm', source: 'K.ERGONOMICS counter_stool_seat (for 900 counters, 250–300 below the surface)' },
      { key: 'bar_stool_seat', label: 'Bar stool seat height', min: 730, max: 780, unit: 'mm', source: 'K.ERGONOMICS bar_stool_seat (for 1060+ bars; footrest 230 below seat)' }
    ],
    loadCases: [
      { id: 'seat_static', label: 'Seat static load', magnitude: '1334 N (136 kg)', apply: 'centre of the seat panel', direction: 'gravity', duration: 'functional, 1 min class', acceptance: 'seat sag ≤ L/300; seat + rail bending margin ≥ 1 at MOR/4; joint margin ≥ 1.5', source: 'aligned to BIFMA X5.1 §8 / X5.4 drop-test proof mass 300 lb (functional is 225 lb); no static seat test exists in the standard', traceability: 'standard', ownedBy: 'Structural.LOAD_PRESETS.seating' },
      { id: 'back_static', label: 'Back static load', magnitude: '667 N (150 lbf)', apply: 'crest rail (test point is ≤ 406 mm above seat — crest is the longer, conservative lever)', direction: 'horizontal, rearward', duration: 'functional, 1 min', acceptance: 'rear-post net-section bending margin ≥ 1 at MOR/4 (mortise derated); slat/crest joints hold', source: 'ANSI/BIFMA X5.1-2017 §5/§6 back strength functional 150 lbf (Manufacturing Solutions Center lab summary)', traceability: 'standard' },
      { id: 'rear_tilt', label: 'Rear tilt — user on two legs', magnitude: '1334 N occupant on the rear legs + 667 N at the crest', apply: 'occupant over the rear-leg line; back force at the crest', direction: 'gravity + horizontal', duration: 'repeated abuse case', acceptance: 'side-rail↔rear-post joint couple margin ≥ 1 (≥ 1.5 to pass clean), resolved over the rail–stretcher arm', source: 'documented derivation (no standard tests two-leg tilt); arithmetic shown in test/handcalc.js', traceability: 'derivation' },
      { id: 'front_leg', label: 'Front leg strength', magnitude: '334 N (75 lbf)', apply: 'at the foot, horizontal (worst lever to the stretcher)', direction: 'horizontal, front and side', duration: 'functional, 1 min', acceptance: 'leg bending margin ≥ 1 at MOR/4 over the unbraced segment', source: 'ANSI/BIFMA X5.4-2012 §16 leg strength functional 75 lb (Manufacturing Solutions Center summary); application height unpublished — foot chosen as conservative derivation', traceability: 'standard' },
      { id: 'cyclic_durability', label: 'Cyclic seating durability', magnitude: '57 kg × 100 000 cycles', apply: 'seat, repeated', direction: 'gravity', duration: 'cyclic', acceptance: 'joint margins ≥ 1 at HALF capacity (cyclic factor 0.5) under the static seat case', source: 'ANSI/BIFMA X5.1 §10.3 / X5.4-2020 durability (SGS/Kokuyo summaries); 0.5 capacity factor per Eckelman furniture-engineering practice (derivation)', traceability: 'derivation' },
      { id: 'footrest_step', label: 'Stool footrest step-up', magnitude: '1334 N point', apply: 'midspan of the footrest stretcher', direction: 'gravity', duration: 'functional', acceptance: 'stretcher bending margin ≥ 1 at MOR/4', source: 'derivation: full body weight on one foot while mounting — the load every bar stool actually sees', traceability: 'derivation' }
    ],
    jointRules: {
      connections: [
        { connection: 'side rail → rear post (and all seat-frame rails → legs)', required: SEAT_FRAME_ALLOWED, prohibited: ['butt_screws', 'pocket_screws', 'biscuits', 'dowels'], reason: 'the rear-tilt couple puts ≈ 840 N through each side joint on the nominal dining chair (handcalc [13]); screws top out ≈ 1.2× margin in the densest stocked species and biscuits/dowels sit at 0.7–1.4× — all below the 1.5× gate, and halved again under the cyclic factor. Mortise & tenon (or loose tenon / bolted barrel-nut) carries it at 2.7–3.0× in oak. This is why a screwed chair loosens in a year.' },
        { connection: 'back slats / crest → rear posts', required: ['mortise_tenon', 'loose_tenon', 'kd_bolt'], prohibited: ['butt_screws', 'pocket_screws'], reason: 'the back force levers slats in withdrawal — screws into post side grain work loose; housed tenons do not. Follows the frame slot mandate.' },
        { connection: 'corner blocks → rails', required: ['butt_screws'], prohibited: [], reason: 'corner blocks are glued and screwed across the corner — structure of the seat frame (they close the racking loop), listed as parts with their own dimensions, but their fastening is honestly screws + glue.' },
        { connection: 'seat panel → rails/posts', required: ['butt_screws'], prohibited: ['edge_glue'], reason: 'a solid seat moves across the grain: screws in slotted holes / buttons, notched around the posts with capture in the panel size — never glued down (movement check).' }
      ]
    },
    failureModes: [
      { id: 'rear_tilt_racking', mode: 'side rail–rear leg joints fail from repeated rear-tilt racking', checkIds: ['chair:tilt'], fixture: 'audit SEAT bad-fixture: screwed side rail; handcalc rear-tilt section', realWorld: 'the classic loose-then-broken dining chair' },
      { id: 'short_grain_rear_leg', mode: 'sawn/curved rear leg breaks at short grain under the back load', guard: 'Spec.correctSeat clamps backRake to straight-post capability and seatNotes refuses the rest (validate re-checks as defense)', checkIds: ['chair:rake'], fixture: 'audit SEAT bad-fixture: 8°+ rake request → refusal note + clamp', realWorld: 'rear legs snapping at the bend' },
      { id: 'back_post_rupture', mode: 'rear post breaks at the rail mortise under the back load', checkIds: ['chair:back'], fixture: 'handcalc back-post section; pine chair fixture fails honestly', realWorld: 'posts cracking at the seat joint — the max-moment, min-section point' },
      { id: 'seat_collapse', mode: 'seat panel or rails fail under the seated load', checkIds: ['sag:seat_1', 'str:seat_1', 'sag:apron:seat_1', 'str:apron:seat_1'], fixture: 'golden chair fixtures freeze the margins', realWorld: 'split seats, cracked rails' },
      { id: 'leg_snap', mode: 'front leg snaps under lateral load', checkIds: ['chair:leg'], fixture: 'handcalc leg section', realWorld: 'legs kicked out sideways' },
      { id: 'cyclic_loosening', mode: 'joints loosen under 100k sit-down cycles', checkIds: ['chair:cyclic'], fixture: 'audit SEAT cyclic section (pine fails, oak passes)', realWorld: 'the wobbly chair that was fine when new' },
      { id: 'stool_wrong_height', mode: 'stool sized to the wrong counter', conditional: true, guard: 'Spec.correctSeat counter coupling snaps height into the 250–300 drop window and seatNotes says so; validate asks when no counter is given', checkIds: ['chair:counter'], fixture: 'audit SEAT bad-fixture: 900-counter stool asked at 750 seat', realWorld: 'knees jammed under the bar / dangling perch' },
      { id: 'ergonomic_miss', mode: 'seat height/depth outside the human-factors band', checkIds: ['ergo_seat'], conditional: true, fixture: 'audit SEAT bad-fixture: 550 seat height on a dining chair', realWorld: 'chairs nobody wants to sit in' },
      { id: 'grain_orientation', mode: 'splayed leg sawn from a vertical blank (grain runout) instead of ripped with the grain', checkIds: ['chair:grain'], fixture: 'audit SEAT grain section', realWorld: 'splayed stool legs shearing along the runout' },
      { id: 'footrest_break', mode: 'stool footrest stretcher breaks under a mounting step', checkIds: ['chair:foot'], conditional: true, fixture: 'handcalc footrest section', realWorld: 'bar stool rungs snapping underfoot' },
      { id: 'seat_movement_split', mode: 'solid seat glued/pinned rigid splits across the grain', checkIds: ['move:seat_1'], fixture: 'movement check on golden chair fixtures', realWorld: 'seasonal seat cracks at the fasteners' }
    ],
    hardware: [
      { id: 'corner_block_screws', item: '#8 × 32 wood screws, 2 per block face (glue + screws)', when: 'every seat frame (4 corner blocks)', capacity: 'screw shear ≥ 500 N each (JOINT_RATING butt_screws basis)', matchedTo: 'racking share of the seat frame; blocks close the frame loop — counted by the fastener engine so BOM = drilling instructions' },
      { id: 'seat_fixing', item: '#8 screws in slotted/oversize holes through the corner blocks (or figure-8s)', when: 'solid seat panels', capacity: 'hold-down only', matchedTo: 'seasonal movement computed by K.movementMM — fixing must release it' },
      { id: 'kd_hardware', item: 'M6 furniture bolts + barrel nuts, 2 per rail end', when: 'joinery.frame = kd_bolt', capacity: '1800 N per joint class (JOINT_RATING kd_bolt), SG-scaled', matchedTo: 'rear-tilt couple demand (≈ 840 N nominal, handcalc [13]) with re-snug schedule in the steps' }
    ],
    assembly: {
      sequence: [
        'layout (both rear posts marked together, feet against a stop)',
        'back sub-assembly: slats + crest into the posts (rake set by the offset mortises)',
        'side frames: front leg + side rail + side stretcher to the back assembly, one side at a time',
        'closing: front/back rails + remaining stretchers, clamped square',
        'corner blocks: glued + screwed across each seat-frame corner',
        'seat: notched around the posts, fastened to move',
        'cure + rock check, then load'
      ],
      jigs: ['story stick for post mortise heights (mark all posts together, feet aligned on a stop)', 'sliding bevel set from the printed angle schedule (splay/rake shoulders)', 'drilling jig for barrel-nut bores (kd builds) — both bores off the same reference face', 'drawbore pins optional at advanced M&T (offset 1.5 mm)'],
      checks: ['equal diagonals across the seat frame before the glue tacks', 'back assembly checked for wind against a flat bench', 'seat frame checked LEVEL side-to-side and sloped only front-to-back by the stated slope', 'stool legs: all four feet on the flat, trim ONE proud foot', 'compound shoulders test-fitted dry before glue']
    },
    refusals: [
      { id: 'no_upholstery', shape: 'upholstered or slip seats', reason: 'the frame becomes its own part set with foam/fabric clearances not modeled soundly yet — a guessed slip-seat rebate is worse than a refusal', surface: 'seatNotes correction note + intent parser + SCHEMA_DOC' },
      { id: 'no_arms', shape: 'armchairs', reason: 'arm joints carry their own BIFMA load cases (vertical 169 lbf / horizontal 100 lbf functional) not modeled', surface: 'seatNotes + intent parser + SCHEMA_DOC' },
      { id: 'no_sawn_rear_legs', shape: 'back rake beyond straight-post capability (sawn/curved/steam-bent rear legs)', reason: 'sawing the bend puts short grain at the highest-moment point — the real-world rear-leg failure; lamination/steam-bending are outside the tool', surface: 'correctSeat clamp + seatNotes + validate defense check' },
      { id: 'no_rockers_folders', shape: 'rockers, folding chairs, swivel or height-adjust mechanisms', reason: 'mechanisms are not expressible (every joint is fixed except kd_bolt) and their load paths are unmodeled', surface: 'SCHEMA_DOC + intent parser' },
      { id: 'no_chair_splay', shape: 'splayed legs on a backed chair', reason: 'the straight-post rake geometry assumes vertical posts; splayed backed chairs need compound-raked joinery not yet generated soundly', surface: 'correctSeat forces splay 0 + seatNotes' }
    ],
    fixtures: {
      golden: ['oak-dining-chair-imperial', 'maple-counter-stool-metric', 'walnut-chair-boundary-metric'],
      bad: ['audit SEAT-1 screwed side rail', 'audit SEAT-2 sawn rear leg (rake refusal)', 'audit SEAT-3 stool vs wrong counter', 'audit SEAT-4 seat height outside human factors', 'audit SEAT-5 upholstery/arms refusal', 'audit SEAT-6 pine cyclic honest-fail']
    }
  });

  /* =========================================================================
   * WALL-MOUNTED — floating shelves on a French cleat. The class where the
   * load path leaves the furniture entirely: the wall carries the cantilever
   * moment, so the substrate is a REQUIRED input and "unknown wall" is a
   * refusal, not a default. Highest injury risk on the roadmap — built with
   * the anchor model or not at all.
   * ========================================================================= */
  const DESIGN_BASIS_WALL =
    'Anchor math uses NDS reference withdrawal design values for wood screws ' +
    '(W = 2850·G²·D lb per inch of thread penetration — a DESIGN value, ' +
    'already ~5× under ultimate), worst-case SPF studs (G = 0.42), and IRC ' +
    'R602.3(5) stud spacing. Masonry anchors are specified by REQUIRED ' +
    'working load, to be met by the anchor’s published rating — never ' +
    'assumed. This is fixing guidance for a hobby shelf, not certified ' +
    'anchor design; screws must land in stud centres, and drywall alone is ' +
    'refused outright (anchors creep under sustained load; ratings are ' +
    'ultimate, not working).';

  const WALL_GEOM = {
    CLEAT_H: 70,            // cleat height (each half), 19 mm stock, 45° rip
    CLEAT_T: 19,
    SCREW_LINE: 50,         // screw centreline above the cleat bottom (upper third)
    SCREWS_PER_STUD: 2,     // French-cleat practice: two per stud crossing
    STUD_SPACINGS: [406, 610], // IRC R602.3(5): 16/24 in o.c.
    MASONRY_PITCH: 300,     // masonry anchors every ≤ 300 mm along the cleat
    /* #10 wood screw, 1.5 in of thread in the stud (3 in screw through
     * 13 mm drywall + 19 mm cleat): NDS W = 2850 × 0.42² × 0.190 =
     * 95.5 lb/in × 1.5 in = 143 lb = 637 N design withdrawal (SPF floor). */
    SCREW_WITHDRAWAL_N: 637,
    /* Lateral (vertical shear) per #10 into a stud: NDS Table 12L is
     * paywalled; secondary woodworking sources put 80–100 lb allowable —
     * the conservative end (80 lb = 356 N) is used and labeled. */
    SCREW_LATERAL_N: 356,
    /* Guaranteed stud crossings for a cleat of length L at spacing s under
     * WORST phase alignment. */
    studsEngaged(cleatLen, spacing) { return Math.max(0, Math.floor(cleatLen / spacing)); }
  };

  register({
    key: 'wall_mounted',
    label: 'Wall-mounted shelves (French cleat)',
    templates: ['wall_shelf'],
    mounted: 'wall', // audit + structural engines key floor-invariant exemptions off this
    geom: WALL_GEOM,
    DESIGN_BASIS_WALL,
    family: {
      rules: [
        { path: 'overall.width', ownedBy: 'Spec.DIM_RULES' },
        { path: 'overall.depth', ownedBy: 'Spec.DIM_RULES' },
        { path: 'structure.topThickness', ownedBy: 'Spec.DIM_RULES' }
      ],
      couplings: [
        { id: 'substrate_required', rule: 'substrate ∈ {stud, masonry} or the design is refused — a shelf hung on unknown structure is a guess, and drywall-only is refused outright (anchor creep; ratings are ultimate)', enforcedBy: 'Spec.validate wall_substrate error + parser ask' },
        { id: 'depth_thickness', rule: 'depth > 250 forces shelf thickness ≥ 32 (K.ERGONOMICS floating_shelf_depth note) and depth caps at 300 — past that the couple demand outruns hobby fixings', enforcedBy: 'Spec.correctSpec wall block' },
        { id: 'stud_engagement', rule: 'on studs, the cleat’s guaranteed crossings = floor(length/spacing) (worst phase, IRC 406/610 o.c.); 0 studs fails, 1 stud is a named single-stud mount (centre the cleat, width ≤ 600)', enforcedBy: 'Structural wall:studs' },
        { id: 'height_derived', rule: 'overall.height = cleat + shelf thickness (the assembly, not a room position) — floor invariants are exempted for mounted classes and the mount plane is the datum', enforcedBy: 'Spec.correctSpec + auditModel exemption' }
      ]
    },
    humanFactors: [
      { key: 'floating_shelf_depth', label: 'Floating shelf depth', min: 200, max: 300, unit: 'mm', source: 'K.ERGONOMICS floating_shelf_depth (deeper than 250 wants 32+ thickness and a full-length cleat)' },
      { key: 'shelf_reach', label: 'Mounting height guidance', min: 1200, max: 1800, unit: 'mm', source: 'standing reach band, Panero & Zelnik (guidance in the steps — the spec models the assembly, not the room)' }
    ],
    loadCases: [
      { id: 'shelf_books', label: 'Books along the shelf', magnitude: '60 kg/m sustained', apply: 'uniform, centroid at half the depth', direction: 'gravity', duration: 'sustained (×2 creep)', acceptance: 'cantilever sag ≤ span/150 at the free edge; bending margin ≥ 1 at MOR/4', source: 'BIFMA X5.9 shelf load 40 lb/ft (preset basis string)', traceability: 'standard', ownedBy: 'Structural.LOAD_PRESETS.books' },
      { id: 'anchor_couple', label: 'Cleat screw withdrawal', magnitude: 'M = load × depth/2, resolved over the screw-line arm', apply: 'top screws in withdrawal, bottom edge in bearing', direction: 'tension out of the wall', duration: 'sustained', acceptance: 'margin ≥ 1.5 vs NDS design withdrawal (637 N per #10 × 1.5 in in SPF); masonry emits the REQUIRED rating instead of assuming one', source: 'NDS W = 2850·G²·D (verified vs SYP cross-check); arithmetic in test/handcalc.js', traceability: 'derivation' },
      { id: 'anchor_shear', label: 'Vertical shear on the fixings', magnitude: 'full shelf load across the engaged screws', apply: 'screw group, vertical', direction: 'gravity', duration: 'sustained', acceptance: 'margin ≥ 1.5 vs 356 N per screw (80 lb — conservative end of secondary sources; NDS 12L is paywalled and the label says so)', source: 'secondary (Obsessed Woodworking / trade practice), marked verified-approximate', traceability: 'derivation' }
    ],
    jointRules: {
      connections: [
        { connection: 'shelf → wall cleat', required: ['french_cleat'], prohibited: ['butt_screws', 'pocket_screws', 'kd_bolt'], reason: 'the cleat is the one joint whose mate is the BUILDING: 45° halves convert gravity into a clamping couple and lift off for moving day. Screwing the shelf straight to the wall loses the bearing couple and puts every newton in withdrawal.' },
        { connection: 'wall cleat → structure', required: [], prohibited: [], reason: 'not a wood-to-wood joint: #10 × 3 in screws, two per stud, into stud CENTRES (or rated masonry anchors every ≤ 300 mm). Capacity math in the wall:anchor check; drywall alone refused.' }
      ]
    },
    failureModes: [
      { id: 'unknown_wall', mode: 'shelf hung on unknown or drywall-only structure', conditional: true, checkIds: ['wall_substrate', 'wall:substrate'], fixture: 'audit WALL-1 (unknown → error; drywall → refusal with the creep reason)', realWorld: 'the shelf that came down with the plaster' },
      { id: 'anchor_pullout', mode: 'top screws pull out of the studs under the cantilever couple', checkIds: ['wall:anchor'], fixture: 'handcalc anchor section; audit WALL-2 heavy/deep fixture', realWorld: 'loaded shelves peeling off the wall' },
      { id: 'missed_studs', mode: 'cleat spans too few studs (or none)', checkIds: ['wall:studs'], fixture: 'audit WALL-3 (short cleat on 610 spacing)', realWorld: 'shelves screwed to drywall between studs' },
      { id: 'shelf_dive', mode: 'shelf sags or breaks at the free edge', checkIds: ['sag:', 'str:'], fixture: 'golden fixtures freeze the cantilever margins', realWorld: 'drooping floating shelves' },
      { id: 'overdeep', mode: 'depth beyond the fixing class', guard: 'Spec.correctSpec clamps depth at 300 and couples thickness ≥ 32 past 250; dimensionNotes reports the refusal', checkIds: ['wall:anchor'], fixture: 'audit WALL-4', realWorld: 'display ledges asked to be desks' }
    ],
    hardware: [
      { id: 'stud_screws', item: '#10 × 3 in wood screws (2 per stud crossing)', when: 'substrate = stud', capacity: '637 N design withdrawal each (NDS, SPF floor, 1.5 in thread)', matchedTo: 'wall:anchor couple demand at ≥ 1.5×' },
      { id: 'masonry_anchors', item: 'rated masonry anchors every ≤ 300 mm', when: 'substrate = masonry', capacity: 'REQUIRED working load printed by the check and the BOM — met by the anchor’s published rating, never assumed', matchedTo: 'wall:anchor demand × 1.5' }
    ],
    assembly: {
      sequence: ['rip the cleat pair at 45° from one board', 'find and mark every stud (knock + finder + pilot verify)', 'level line at mounting height', 'wall half screwed to studs (pilots, two per stud)', 'shelf half glued + screwed under the shelf', 'hang, check level and seating, load test gently'],
      jigs: ['stud finder + verification pilot holes', 'a level (the cleat IS the level line)', '45° rip: table saw blade tilted, one board makes both halves'],
      checks: ['level along the cleat before driving screws home', 'every screw lands in a stud CENTRE (probe with a pilot)', 'cleat halves seat fully — no rock along the length', 'gentle pull-down load test before real load goes on']
    },
    refusals: [
      { id: 'no_unknown_wall', shape: 'mounting on an unstated or unknown wall', reason: 'the wall carries the whole load path — without the substrate the anchor math is a guess, and a plausible guess is worse than a refusal', surface: 'validate wall_substrate error + parser asks before creating' },
      { id: 'no_drywall_only', shape: 'drywall-anchor-only mounting', reason: 'drywall anchors creep under sustained load and their ratings are ULTIMATE, not working (industry practice is ≤ ¼ of listed) — shelving is sustained load, so drywall alone is refused, not derated', surface: 'validate error + correction note + parser' },
      { id: 'no_heavy_cantilever', shape: 'depths past 300 mm / desk-duty wall units', reason: 'the couple demand outruns hobby fixings — that is the wall-hung casework class, not yet generated soundly', surface: 'Spec.correctSpec depth clamp + dimensionNotes' },
      { id: 'no_ceiling', shape: 'ceiling-hung anything', reason: 'overhead failure is injury-first; no ceiling model exists', surface: 'SCHEMA_DOC + parser (unchanged floor/wall doctrine)' },
      { id: 'no_exposed_mount', shape: 'a wall shelf in direct weather (exposure = exposed)', reason: 'the anchor math uses NDS dry-service withdrawal values (MC ≤ 19%); direct wetting crosses the wet-service boundary, where NDS derates withdrawal to CM = 0.7 — a derating this model does not carry. A covered porch wall stays dry-service and is allowed', surface: 'Spec.validate out_mount error + parser refusal on outdoor wall-shelf asks' }
    ],
    fixtures: {
      golden: ['oak-floating-shelf-imperial', 'deep-shelf-masonry-metric'],
      bad: ['audit WALL-1 unknown/drywall substrate', 'audit WALL-2 anchor margin arithmetic', 'audit WALL-3 stud engagement', 'audit WALL-4 depth refusal + thickness coupling']
    }
  });

  /* =========================================================================
   * BEDS — knock-down platform beds with a slat deck. The class the roadmap
   * ranked first on demand. No US standard covers adult residential beds
   * (ASTM F1427 is bunk beds only) — the citable adult reference is
   * EN 1725:2023 (user weight 110 kg, tests per ISO 19833), used here as a
   * BENCHMARK, never a compliance claim.
   * ========================================================================= */
  const DESIGN_BASIS_BED =
    'Bed checks are BENCHMARKED against EN 1725:2023 magnitudes (adult beds, ' +
    '110 kg user weight — the one citable adult-bed standard; no US ASTM ' +
    'standard covers adult residential beds) plus manufacturer warranty ' +
    'rules for slat gaps and centre support. Bed-rail brackets publish NO ' +
    'load ratings, so the rail connection capacity here is the barrel-bolt ' +
    'math, not a vendor claim. Benchmarks, not certification.';

  const BED_GEOM = {
    /* Mattress standards: widths from K.ERGONOMICS bed rows; lengths from
     * the same rows' notes (US standard sizes). */
    SIZES: {
      twin: { w: 965, l: 1905, label: 'Twin' },
      full: { w: 1372, l: 1905, label: 'Full' },
      queen: { w: 1524, l: 2030, label: 'Queen' },
      king: { w: 1956, l: 2030, label: 'King' },
      cal_king: { w: 1829, l: 2134, label: 'California King' }
    },
    /* Design mattress mass (kg): the heavy end of published hybrid weights
     * (Saatva/Nectar spec pages; verified-approximate). Sustained load. */
    MATTRESS_KG: { twin: 32, full: 42, queen: 55, king: 70, cal_king: 65 },
    FIT_CLEARANCE: 30,     // interior over mattress (post corners intrude ~45)
    MATTRESS_STOP: 50,     // rail top above the slat deck — keeps the mattress
    SLAT_W: 89, SLAT_T: 19, // 1x4 slats (Tempur-Pedic asks ≥ 3 in wide slats)
    /* Foam-mattress warranty floor: gaps ≤ 70 mm (Amerisleep ≤ 2.75 in,
     * warranty text; Tempur-Pedic ≤ 4 in is the loosest major). */
    SLAT_GAP_MAX: 70,
    CLEAT: { w: 32, h: 20 },
    /* Centre rail + floor leg mandatory at interior width ≥ 1350 mm — the
     * Sealy / Stearns & Foster warranty rule (≥ 5 legs with centre support
     * at queen and up; strict variants start at 53 in). */
    CENTRE_RAIL_MIN_W: 1350,
    USER_KG: 110,          // EN 1725:2023 user mass
    OCCUPANTS: 2,
    /* Slat section, solved by code against the governing knee case — the
     * same case bed:slats prices: 110 kg on one knee at midspan, spread
     * over two slats by the mattress (P = USER_KG·g/2) — in the ACTUAL
     * species: σ = 6M/(b·t²) must hold ≥ 1.25× at MOR/4 (the strength-pass
     * floor; the check adds a small mattress line-load term on top, so the
     * solver's floor is the check's pass band). Stock thicknesses only;
     * spans past 850 additionally floor at 25 for stiffness. A red-oak
     * queen stays at 19; the same deck in SPF stud lumber solves to 25 —
     * exactly the 1x4-vs-2x4 choice the published plans leave to the
     * reader, made by arithmetic instead. If even the largest stock fails,
     * the builder ships it and bed:slats says so honestly. */
    slatThickness(spanMM, speciesKey) {
      const sp = (K.WOOD_SPECIES && K.WOOD_SPECIES[speciesKey]) || { mor: 99 };
      const allow = sp.mor / 4;
      const M = (this.USER_KG * 9.81 / 2) * spanMM / 4;
      const floor = spanMM > 850 ? 25 : this.SLAT_T;
      const stock = K.SOLID_THICKNESS.filter(t => t >= floor);
      for (const t of stock) {
        if (allow / (6 * M / (this.SLAT_W * t * t)) >= 1.25) return t;
      }
      return stock[stock.length - 1];
    }
  };

  register({
    key: 'bed',
    label: 'Beds (knock-down platform, slat deck)',
    templates: ['bed'],
    geom: BED_GEOM,
    DESIGN_BASIS_BED,
    family: {
      rules: [
        { path: 'structure.apronHeight', ownedBy: 'Spec.DIM_RULES' },
        { path: 'structure.apronThickness', ownedBy: 'Spec.DIM_RULES' },
        { path: 'structure.legThickness', ownedBy: 'Spec.DIM_RULES' }
      ],
      couplings: [
        { id: 'mattress_master', rule: 'the mattress size drives everything: interior = standard size + 30 fit; overall derived (width/depth/height are read-outs, not knobs)', enforcedBy: 'Spec.correctSpec bed block' },
        { id: 'knockdown_mandate', rule: 'rails bolt to posts (kd_bolt) at every level — a glued bed cannot leave the room; asking for glued joinery is overridden and told', enforcedBy: 'Spec.correctSpec + bedNotes' },
        { id: 'slat_gap', rule: 'slat count solved so gaps ≤ 70 mm (foam-warranty floor: Amerisleep 2.75 in) with ≥ 75 mm slat width (Tempur-Pedic ≥ 3 in)', enforcedBy: 'Parametric.bedBuild + bed:slats check' },
        { id: 'centre_support', rule: 'interior ≥ 1350 mm always gets a centre rail + floor leg (Sealy/S&F warranty: ≥ 5 legs with centre support at queen+)', enforcedBy: 'Parametric.bedBuild + bed:centre check' },
        { id: 'headboard_clear', rule: 'a headboard clears the rail band by ≥ 150 or it is trim, not a headboard', enforcedBy: 'Spec.correctSpec bed block' },
        { id: 'exposure_routing', rule: 'the cross-class exposure overlay (roadmap item 5) applies — a porch daybed is a covered/exposed bed: Type-I glue, exterior finish, corrosion-spec fasteners, outdoor ΔMC; exposed corrects non-durable species and is told', enforcedBy: 'Spec.correctSpec exposure block + exposureNotes + K.effectiveDMC + validate out_* checks' }
      ]
    },
    humanFactors: [
      { key: 'platform_height', label: 'Platform (deck) height', min: 300, max: 450, unit: 'mm', source: 'K.ERGONOMICS platform_bed_height (mattress top lands 500–650 off the floor)' },
      { key: 'mattress_sizes', label: 'Mattress standards', min: 965, max: 1956, unit: 'mm width', source: 'K.ERGONOMICS bed-size anchor rows (US standard widths; lengths in the row notes)' },
      { key: 'headboard_height', label: 'Headboard height', min: 800, max: 1300, unit: 'mm', source: 'trade convention: sit-up support band above a 500–650 mattress top' }
    ],
    loadCases: [
      { id: 'deck_live', label: 'Two occupants + mattress on the deck', magnitude: '2 × 110 kg (EN 1725 user mass) + design mattress mass, per size', apply: 'distributed over the slat deck', direction: 'gravity', duration: 'occupants transient; mattress sustained (×2 creep)', acceptance: 'slat and rail sag ≤ L/300; bending ≥ 1× at MOR/4', source: 'EN 1725:2023 user weight (SATRA/BSI summaries); mattress masses from Saatva/Nectar spec pages', traceability: 'standard' },
      { id: 'slat_point', label: 'Kneeling on one slat', magnitude: '1079 N (110 kg on one knee-point)', apply: 'midspan of the worst slat', direction: 'gravity', duration: 'transient', acceptance: 'slat bending ≥ 1× at MOR/4', source: 'derivation from the EN 1725 user mass — the load every bed slat sees when someone climbs in', traceability: 'derivation' },
      { id: 'rail_connection', label: 'Rail end reaction into the posts', magnitude: 'rail tributary share ÷ 2 ends', apply: 'each barrel-bolt pair', direction: 'vertical shear', duration: 'sustained + transient', acceptance: '≥ 1.5× on 2 × kd_bolt per rail end (SG-scaled); the bracket ALTERNATIVE prints its required rating — brackets publish none', source: 'JOINT_RATING kd_bolt; Rockler bracket pages confirmed rating-free (research 2026-07)', traceability: 'derivation' },
      { id: 'headboard_pull', label: 'Sitting back against the headboard', magnitude: '667 N horizontal at the headboard top', apply: 'shared by the two head posts', direction: 'horizontal', duration: 'functional', acceptance: 'post bending ≥ 1× at MOR/4 over the lever above the rail bolts', source: 'derivation aligned to the BIFMA X5.1 back functional magnitude the seating class uses', traceability: 'derivation' }
    ],
    jointRules: {
      connections: [
        { connection: 'side/head/foot rails → posts', required: ['kd_bolt'], prohibited: ['mortise_tenon', 'pocket_screws', 'butt_screws', 'dowels', 'loose_tenon'], reason: 'the knock-down mandate: 2 barrel bolts per rail end carry the end reaction at ≥ 1.5× and come apart on moving day. A glued tenon here is a bed that cannot leave the room; screws alone loosen under cyclic edge-sitting. Surface-mount bed-rail brackets are a legitimate alternative — but they publish NO ratings, so the BOM prints the required capacity for the buyer to match.' },
        { connection: 'slats → cleats', required: ['butt_screws'], prohibited: [], reason: 'one screw per end keeps slats from walking; the cleat and centre rail carry the load in bearing.' },
        { connection: 'cleats → rails, centre rail → head/foot rails', required: ['butt_screws'], prohibited: [], reason: 'glued + screwed along the length; loads are distributed bearing, not joint-limited.' }
      ]
    },
    failureModes: [
      { id: 'slat_snap', mode: 'a slat snaps under a knee or concentrated sit', checkIds: ['bed:slats'], fixture: 'handcalc bed slat section; audit BED-2', realWorld: 'the cracked-slat thump at 2 am' },
      { id: 'rail_sag', mode: 'side rails sag or break under the deck load', checkIds: ['bed:rail'], fixture: 'audit BED-2', realWorld: 'sagging bed edges' },
      { id: 'connection_failure', mode: 'rail-to-post connection works loose / shears', checkIds: ['bed:joint'], fixture: 'audit BED-2 (margin arithmetic)', realWorld: 'wobbly knock-down frames, stripped brackets' },
      { id: 'missing_centre', mode: 'queen+ deck without centre support', checkIds: ['bed:centre'], fixture: 'audit BED-1 (builder always adds it ≥ 1350)', realWorld: 'broken slats and voided mattress warranties' },
      { id: 'slat_gap_wide', mode: 'slat gaps beyond the foam-mattress warranty floor', checkIds: ['bed:slats'], fixture: 'audit BED-1 gap arithmetic', realWorld: 'foam sagging into the gaps' },
      { id: 'headboard_break', mode: 'head posts break at the rail line under a sitting lean', checkIds: ['bed:headboard'], conditional: true, fixture: 'audit BED-3', realWorld: 'headboards snapping their posts' },
      { id: 'ergonomic_height', mode: 'deck height outside the platform band', checkIds: ['ergo_platform'], conditional: true, fixture: 'audit BED-3', realWorld: 'beds you fall into or climb onto' }
    ],
    hardware: [
      { id: 'rail_bolts', item: 'M6 × 50 furniture bolts + barrel nuts, 2 per rail end (8+ total)', when: 'every bed', capacity: 'kd_bolt joint class, 1800 N SG-scaled per bolt-pair joint', matchedTo: 'bed:joint end-reaction margin ≥ 1.5×' },
      { id: 'bracket_alt', item: 'surface-mount bed-rail brackets (alternative)', when: 'buyer preference', capacity: 'NO published ratings exist (Rockler et al., confirmed) — the BOM prints the computed required capacity per end to match against whatever the maker will state', matchedTo: 'bed:joint demand × 1.5' },
      { id: 'slat_screws', item: '#8 × 32 screws, one per slat end', when: 'every bed', capacity: 'anti-walk only; load is bearing on the cleats', matchedTo: 'slat retention (fastener engine counts them)' }
    ],
    assembly: {
      sequence: ['headboard sub-assembly (boards into posts)', 'foot sub-assembly', 'bolt side rails to head + foot (in the room!)', 'cleats + centre rail with its leg', 'lay and screw the slat deck', 'square check, snug schedule, mattress'],
      jigs: ['doweling jig for barrel-nut bores (both bores off one reference face)', 'cleat spacer block (constant drop from the rail top)', 'slat spacing story stick'],
      checks: ['diagonals across the frame before snugging the last bolts', 'centre rail leg bears the floor BEFORE the deck goes on', 'slat gaps verified against the story stick (≤ 70)', 're-snug bolts after the first week and each season']
    },
    refusals: [
      { id: 'no_bunks', shape: 'bunk and loft beds', reason: 'ASTM F1427 territory (sleeping surface > 762 mm, guardrail and entrapment rules) — fall-height engineering this tool does not model', surface: 'intent parser + SCHEMA_DOC' },
      { id: 'no_cribs', shape: 'cribs and infant furniture', reason: '16 CFR 1219/1220 is federal safety law, not a hobbyist domain — permanently refused', surface: 'intent parser + SCHEMA_DOC' },
      { id: 'no_murphy', shape: 'murphy / wall / folding beds', reason: 'lift mechanisms and wall anchorage under a moving load are unmodeled (and the mechanism doctrine already refuses moving parts)', surface: 'intent parser + SCHEMA_DOC' },
      { id: 'no_glued_bed', shape: 'glued rail joinery on a bed', reason: 'a bed that cannot be disassembled cannot leave the room — the knock-down mandate overrides and says so', surface: 'Spec.correctSpec + bedNotes' }
    ],
    fixtures: {
      golden: ['oak-queen-bed-imperial', 'pine-twin-bed-metric'],
      bad: ['audit BED-1 gap/centre rules', 'audit BED-2 slat/rail/joint margins vs hand arithmetic', 'audit BED-3 headboard + platform band + refusals']
    }
  });

  BB.Classes = {
    register, get, all, forTemplate, validateContract, runChecklist,
    DESIGN_BASIS_SEATING, DESIGN_BASIS_WALL, DESIGN_BASIS_BED
  };
})();
