/* Blueprint Buddy — knowledge bases.
 * Code-owned constant tables. Three consumers: the AI system prompt (digests),
 * the validation layer (rules), and the UI (Shop Reference panel).
 * Never AI-generated at runtime.
 */
var BB = globalThis.BB = globalThis.BB || {};

(function () {
  'use strict';

  /* ---------------- 3a. Wood species ----------------
   * janka: lbf. workability: 1 (fights you) .. 5 (a pleasure).
   * movement: tangential movement rating for solid stock.
   * costTier: 1 ($) .. 4 ($$$$), drives BOM pricing.
   * tone/rough: drive the 3D material so species read differently.
   * grainScale/ringContrast/hueJitter/pores: procedural grain-texture recipe
   *   (BB.Materials) — ring spacing in texture px, ring darkness 0..1, board
   *   color variation 0..1, open-pore streak density 0..1.
   *
   * Structural doctrine (USDA FPL Wood Handbook, values at 12% MC):
   *   moe GPa  -> stiffness ONLY: sag / deflection predictions.
   *   mor MPa  -> strength ONLY: breaking-load margins at safety factor 4.
   *   sg       -> density (COG / tipping) and fastener / joint capacity scaling.
   *   janka    -> surface duty ONLY: dent & wear advisories. Never in beam math.
   *   ct / cr  -> tangential / radial dimensional-change coefficients per 1% MC
   *               (Wood Handbook table 13-5) — seasonal movement math.
   */
  const WOOD_SPECIES = {
    red_oak: {
      key: 'red_oak', label: 'Red Oak', janka: 1290, workability: 4,
      movement: 'high', outdoor: false, costTier: 2, pricePerBdFt: 5.5,
      moe: 12.5, mor: 99, sg: 0.63, ct: 0.00369, cr: 0.00158,
      tone: 0xc89a6b, rough: 0.72,
      grainScale: 13, ringContrast: 0.5, hueJitter: 0.22, pores: 0.8,
      blurb: 'Open-grained workhorse; strong, honest, and everywhere. Loves stain, hates standing water.'
    },
    white_oak: {
      key: 'white_oak', label: 'White Oak', janka: 1360, workability: 3,
      movement: 'medium', outdoor: true, costTier: 3, pricePerBdFt: 8.5,
      moe: 12.3, mor: 105, sg: 0.68, ct: 0.00365, cr: 0.00180,
      tone: 0xb99d72, rough: 0.68,
      grainScale: 15, ringContrast: 0.42, hueJitter: 0.18, pores: 0.6,
      blurb: 'Closed-pored and rot-resistant — the outdoor-worthy oak. Quartersawn ray fleck is the classic Arts & Crafts look.'
    },
    hard_maple: {
      key: 'hard_maple', label: 'Hard Maple', janka: 1450, workability: 3,
      movement: 'medium', outdoor: false, costTier: 2, pricePerBdFt: 6.5,
      moe: 12.6, mor: 109, sg: 0.63, ct: 0.00353, cr: 0.00165,
      tone: 0xe4cfa4, rough: 0.55,
      grainScale: 22, ringContrast: 0.16, hueJitter: 0.1, pores: 0.15,
      blurb: 'Pale, dense, and crisp under a sharp edge. Blotches under stain — finish it clear.'
    },
    walnut: {
      key: 'walnut', label: 'Black Walnut', janka: 1010, workability: 5,
      movement: 'medium', outdoor: false, costTier: 4, pricePerBdFt: 12,
      moe: 11.6, mor: 101, sg: 0.55, ct: 0.00274, cr: 0.00190,
      tone: 0x5e4230, rough: 0.6,
      grainScale: 17, ringContrast: 0.5, hueJitter: 0.32, pores: 0.4,
      blurb: 'Chocolate heartwood that machines like a dream. The species you save for the show piece.'
    },
    cherry: {
      key: 'cherry', label: 'Cherry', janka: 950, workability: 5,
      movement: 'medium', outdoor: false, costTier: 3, pricePerBdFt: 9,
      moe: 10.3, mor: 85, sg: 0.50, ct: 0.00248, cr: 0.00126,
      tone: 0xa66a48, rough: 0.58,
      grainScale: 20, ringContrast: 0.28, hueJitter: 0.2, pores: 0.3,
      blurb: 'Starts salmon-pink, deepens to auburn with light and age. Scorches if your blade dawdles.'
    },
    ash: {
      key: 'ash', label: 'White Ash', janka: 1320, workability: 4,
      movement: 'medium', outdoor: false, costTier: 2, pricePerBdFt: 5,
      moe: 12.0, mor: 103, sg: 0.60, ct: 0.00274, cr: 0.00169,
      tone: 0xd6bd92, rough: 0.7,
      grainScale: 12, ringContrast: 0.48, hueJitter: 0.16, pores: 0.7,
      blurb: 'Oak’s springier cousin — baseball-bat tough, bends beautifully, takes finish evenly.'
    },
    poplar: {
      key: 'poplar', label: 'Poplar', janka: 540, workability: 5,
      movement: 'medium', outdoor: false, costTier: 1, pricePerBdFt: 3.5,
      moe: 10.9, mor: 70, sg: 0.42, ct: 0.00289, cr: 0.00158,
      tone: 0xd9cfa8, rough: 0.62,
      grainScale: 24, ringContrast: 0.22, hueJitter: 0.3, pores: 0.2,
      blurb: 'Soft, stable, cheap, and green-streaked. The right answer for paint-grade and practice.'
    },
    pine: {
      key: 'pine', label: 'Eastern White Pine', janka: 380, workability: 5,
      movement: 'low', outdoor: false, costTier: 1, pricePerBdFt: 2.5,
      moe: 8.5, mor: 59, sg: 0.35, ct: 0.00212, cr: 0.00071,
      tone: 0xe8cf9e, rough: 0.8,
      grainScale: 26, ringContrast: 0.55, hueJitter: 0.28, pores: 0.25,
      blurb: 'Light, forgiving, and knotty — dents if you look at it hard, but nothing is friendlier to learn on.'
    },
    baltic_birch: {
      // Effective MOE/MOR reduced ~20% vs solid birch: half the plies run cross-grain.
      // ct/cr ≈ 0: cross-laminated plies cancel seasonal movement — plywood is exempt.
      key: 'baltic_birch', label: 'Baltic Birch Ply', janka: 1260, workability: 4,
      movement: 'low', outdoor: false, costTier: 2, pricePerBdFt: 6, sheet: true,
      moe: 10.0, mor: 55, sg: 0.68, ct: 0.0002, cr: 0.0002,
      tone: 0xe9d8ae, rough: 0.5,
      grainScale: 8, ringContrast: 0.08, hueJitter: 0.06, pores: 0.1,
      blurb: 'Void-free plywood with clean striped edges. Dead flat, dead stable — the drawer-box default.'
    }
  };

  /* Movement advisory threshold: a wide solid top in a high-movement
   * species needs to be allowed to move (buttons/figure-8s, no glue). */
  const WIDE_TOP_MM = 500;

  /* ---------------- 3b. Ergonomics ----------------
   * All mm. axis: which overall dimension the range constrains.
   * Templates reference rows by key; validation emits advisories, never errors.
   * Notes carry lengths as {mm} tokens — BB.Units.fmtTemplate renders them in
   * the current display units, so static data still crosses ONE boundary.
   */
  const ERGONOMICS = [
    { key: 'dining_height', label: 'Dining table height', min: 730, max: 760, axis: 'height', appliesTo: ['table'], note: 'Bar height ({1040} to {1100}) and counter height ({860} to {920}) are intentional exceptions.' },
    { key: 'desk_height', label: 'Desk height', min: 720, max: 750, axis: 'height', appliesTo: ['desk'], note: 'Pair with a {420} to {530} adjustable chair.' },
    { key: 'bench_seat', label: 'Bench seat height', min: 430, max: 480, axis: 'height', appliesTo: ['bench'], note: 'Subtract ~{25} if a cushion will live on it.' },
    { key: 'nightstand_height', label: 'Nightstand height', min: 550, max: 700, axis: 'height', appliesTo: ['nightstand'], note: 'Aim within {50} of the mattress top.' },
    { key: 'shelf_depth_books', label: 'Shelf depth for books', min: 250, max: 320, axis: 'depth', appliesTo: ['bookshelf'], note: 'Trade paperbacks need {230}; art books want {320}+.' },
    { key: 'counter_height', label: 'Counter height', min: 860, max: 940, axis: 'height', appliesTo: ['cabinet'], note: 'Standard kitchen counter is {900} to the finished top.' },
    { key: 'toe_kick', label: 'Toe kick', min: 75, max: 100, axis: 'toeKick', appliesTo: ['cabinet'], note: 'Standard recess: {90} high × {75} deep.' },
    /* Drawer rows (Phase 2 §5): drive drawer advisories. */
    { key: 'drawer_min_height', label: 'Minimum useful drawer opening', min: 80, max: Infinity, axis: 'drawerOpeningHeight', appliesTo: ['nightstand', 'cabinet'], note: 'Below {80} an opening barely clears a hand.' },
    { key: 'drawer_max_width', label: 'Max drawer width per slide pair', min: 0, max: 750, axis: 'drawerOpeningWidth', appliesTo: ['nightstand', 'cabinet'], note: 'Beyond {750} boxes rack; use two banks.' },
    { key: 'drawer_pull_height', label: 'Comfortable pull height', min: 600, max: 1100, axis: 'drawerPullHeight', appliesTo: ['cabinet'], note: 'Top drawers between hip and chest height open easiest.' }
  ];

  /* ---------------- 3c. Joinery matrix ----------------
   * strength 1..5 relative. level: minimum experience level.
   * kind: which slot the joint may fill (frame = leg/rail/apron, case = carcass
   * panels/shelves, box = drawer boxes).
   */
  const LEVELS = ['beginner', 'intermediate', 'advanced'];

  const JOINERY = {
    butt_screws: {
      key: 'butt_screws', label: 'Butt joint + screws', strength: 1, difficulty: 1, level: 'beginner',
      kinds: ['frame', 'case', 'box'],
      tools: ['drill/driver', 'countersink bit'],
      bestFor: 'Quick utility builds, shop furniture, painted work.',
      failure: 'Screws into end grain strip out — always drill pilot holes and don’t over-torque.'
    },
    pocket_screws: {
      key: 'pocket_screws', label: 'Pocket screws', strength: 2, difficulty: 1, level: 'beginner',
      kinds: ['frame', 'case', 'box'],
      tools: ['pocket-hole jig', 'drill/driver'],
      bestFor: 'Face frames, aprons, and drawer boxes hidden from view.',
      failure: 'Joints creep under racking if unglued — add glue on every long-grain face.'
    },
    dowels: {
      key: 'dowels', label: 'Dowel joint', strength: 3, difficulty: 2, level: 'intermediate',
      kinds: ['frame', 'case', 'box'],
      tools: ['doweling jig', 'drill', 'clamps'],
      bestFor: 'Aprons, carcass butt-ups, and alignment-critical panels.',
      failure: 'Misaligned holes lock the assembly out of square — drill both parts from the same reference face.'
    },
    dado: {
      key: 'dado', label: 'Dado / housing', strength: 3, difficulty: 2, level: 'intermediate',
      kinds: ['case'],
      tools: ['router or table saw', 'straightedge'],
      bestFor: 'Fixed shelves carrying real weight in case sides.',
      failure: 'A dado sized to nominal plywood is loose on actual plywood — cut to the measured thickness.'
    },
    rabbet: {
      key: 'rabbet', label: 'Rabbet', strength: 2, difficulty: 2, level: 'intermediate',
      kinds: ['case'],
      tools: ['router or table saw'],
      bestFor: 'Back panels and case tops/bottoms.',
      failure: 'Thin rabbet walls split when screwed — keep the wall at least half the stock thickness.'
    },
    locking_rabbet: {
      key: 'locking_rabbet', label: 'Locking rabbet', strength: 3, difficulty: 3, level: 'intermediate',
      kinds: ['box'],
      tools: ['table saw or router table', 'dado stack or straight bit'],
      bestFor: 'Machine-cut drawer boxes — mechanical interlock plus glue area.',
      failure: 'The short tongue snaps if the fit needs a mallet — sneak up on a hand-pressed fit.'
    },
    mortise_tenon: {
      key: 'mortise_tenon', label: 'Mortise & tenon', strength: 5, difficulty: 4, level: 'advanced',
      kinds: ['frame'],
      tools: ['mortiser or router', 'tenon saw', 'chisels'],
      bestFor: 'Legs to aprons and rails — the reference joint for frames.',
      failure: 'A too-tight tenon splits the mortise cheek on glue-up — aim for a firm hand-press fit.'
    },
    half_blind_dovetail: {
      key: 'half_blind_dovetail', label: 'Half-blind dovetail', strength: 5, difficulty: 5, level: 'advanced',
      kinds: ['box'],
      tools: ['dovetail saw', 'chisels', 'marking gauge'],
      bestFor: 'Drawer fronts that show no joinery from the front and never pull apart.',
      failure: 'Blowing out the socket floor — chop halfway from each side and let the chisel do the last cut.'
    }
  };

  /* Experience-level matrix: joints allowed at each level (a level includes
   * everything below it). Code — never the model — enforces this. */
  function jointsForLevel(level) {
    const rank = Math.max(0, LEVELS.indexOf(level));
    return Object.values(JOINERY).filter(j => LEVELS.indexOf(j.level) <= rank).map(j => j.key);
  }
  function jointAllowed(jointKey, level, kind) {
    const j = JOINERY[jointKey];
    if (!j) return false;
    if (kind && !j.kinds.includes(kind)) return false;
    return jointsForLevel(level).includes(jointKey);
  }
  /* Preferred pick per slot per level (AI proposes within this; code snaps). */
  const JOINT_DEFAULTS = {
    beginner: { frame: 'pocket_screws', case: 'butt_screws', box: 'pocket_screws' },
    intermediate: { frame: 'dowels', case: 'dado', box: 'locking_rabbet' },
    advanced: { frame: 'mortise_tenon', case: 'dado', box: 'half_blind_dovetail' }
  };

  /* ---------------- 3d. Fasteners & finishes ----------------
   * Labels/uses carry {mm} tokens rendered via BB.Units.fmtTemplate.
   * Exceptions kept literal on purpose: "M4" and "5 mm shelf pin" ARE the
   * trade names in every market (metric hardware), and "#8" is a gauge. */
  const FASTENERS = {
    screws: [
      { key: 'wood_8x25', label: '#8 × {25} wood screw', pilot: 2.8, use: 'Drawer fronts from inside the box' },
      { key: 'wood_8x32', label: '#8 × {32} wood screw', pilot: 2.8, use: 'Aprons, cleats, general carcass' },
      { key: 'wood_8x50', label: '#8 × {50} wood screw', pilot: 3.2, use: 'Legs, rails, structural butt joints' },
      { key: 'pocket_32', label: '{32} coarse pocket screw', pilot: 0, use: 'Pocket joints in {18} to {20} stock' },
      { key: 'slide_m4', label: 'M4 × {16} pan-head', pilot: 3.0, use: 'Drawer slide mounting' },
      { key: 'top_button', label: 'Tabletop button + #8 × {16}', pilot: 2.8, use: 'Solid tops — lets the panel move' }
    ],
    dowels: [
      { key: 'dowel_8', label: '{8} × {40} fluted dowel', pilot: 8, use: 'Aprons and rails in {20}+ stock' },
      { key: 'dowel_10', label: '{10} × {50} fluted dowel', pilot: 10, use: 'Legs and thick frames' }
    ],
    hardware: [
      { key: 'slide_pair', label: 'Side-mount ball-bearing slides (pair)', use: 'Drawer runners, {250} to {500}', price: 14 },
      { key: 'pull', label: 'Drawer pull', use: 'One per drawer', price: 6 },
      { key: 'shelf_pin', label: '5 mm shelf pin', use: 'Adjustable shelves — 4 per shelf', price: 0.25 },
      { key: 'figure8', label: 'Figure-8 fastener', use: 'Solid top attachment allowing movement', price: 0.8 }
    ]
  };

  const FINISHES = [
    { key: 'wipe_poly', label: 'Wipe-on polyurethane', coats: 3, recoatHrs: 4, cureDays: 3, sheen: 'satin', blurb: 'Foolproof rag-on protection; sand at 320 between coats.' },
    { key: 'danish_oil', label: 'Danish oil', coats: 2, recoatHrs: 8, cureDays: 7, sheen: 'natural', blurb: 'In-the-wood look and feel; easiest repair story — just re-oil.' },
    { key: 'water_poly', label: 'Water-based poly', coats: 3, recoatHrs: 2, dryFast: true, cureDays: 2, sheen: 'clear', blurb: 'Crystal clear, low odor, fast recoat; raises grain — pre-dampen and sand first.' },
    { key: 'hardwax_oil', label: 'Hardwax oil', coats: 2, recoatHrs: 12, cureDays: 5, sheen: 'matte', blurb: 'Modern matte with a velvet hand; buff on, buff off.' }
  ];

  /* Standard slide lengths (mm), used by drawer-box math. */
  const SLIDE_LENGTHS = [250, 300, 350, 400, 450, 500];

  /* ---------------- 3e. Buyable lumber catalog (Phase 4) ----------------
   * Code-owned: what a lumberyard actually sells. Nominal names map to ACTUAL
   * surfaced dimensions (mm). Boards come in fixed stock lengths; sheet goods
   * come as whole, half, or quarter sheets. The stock optimizer packs the cut
   * list onto these and nothing else.
   */
  const LUMBER = {
    // nominal -> { t: actual thickness mm, w: actual width mm }
    NOMINALS: {
      '1x2': { t: 19, w: 38 }, '1x3': { t: 19, w: 64 }, '1x4': { t: 19, w: 89 },
      '1x6': { t: 19, w: 140 }, '1x8': { t: 19, w: 184 }, '1x10': { t: 19, w: 235 },
      '1x12': { t: 19, w: 286 },
      '2x2': { t: 38, w: 38 }, '2x4': { t: 38, w: 89 },
      // thick hardwood stock (surfaced 5/4 and 8/4) so 25/38 mm parts pack too
      '5/4x4': { t: 25, w: 89 }, '5/4x6': { t: 25, w: 140 }, '5/4x8': { t: 25, w: 184 },
      '8/4x3': { t: 45, w: 64 }, '8/4x4': { t: 45, w: 89 }
    },
    STOCK_LENGTHS: [1829, 2438, 3048, 3658],        // 6 / 8 / 10 / 12 ft
    KERF: 3,                                         // mm lost per cut
    END_TRIM: 15,                                    // mm squared off each board end
    SHEET: { W: 1220, L: 2440, THICKNESSES: [6, 12, 18] },
    // purchasable sheet fractions: fraction of full sheet -> usable W × L (mm)
    SHEET_FRACTIONS: [
      { key: 'quarter', frac: 0.25, w: 610, l: 1220 },
      { key: 'half', frac: 0.5, w: 1220, l: 1220 },
      { key: 'full', frac: 1, w: 1220, l: 2440 }
    ]
  };

  /* Default price list — user-editable in the Stock tab, persisted to storage.
   * Dimensional lumber: $ per lineal metre per nominal, scaled by species cost
   * tier. Sheets: $ per FULL 1220×2440 sheet per thickness (fractions pro-rata
   * + 15% cutting premium). Rough hardwood stays priced per board foot
   * (species pricePerBdFt) when the user prefers rough stock.
   */
  const BASE_PRICE_PER_M = {
    '1x2': 2.0, '1x3': 2.6, '1x4': 3.3, '1x6': 5.2, '1x8': 7.2, '1x10': 9.8, '1x12': 12.5,
    '2x2': 3.0, '2x4': 4.2, '5/4x4': 4.6, '5/4x6': 7.2, '5/4x8': 9.8, '8/4x3': 6.4, '8/4x4': 8.4
  };
  const TIER_FACTOR = { 1: 1, 2: 1.8, 3: 2.6, 4: 3.6 };
  function defaultPrices() {
    const dimensional = {};
    for (const sp of Object.values(WOOD_SPECIES)) {
      if (sp.sheet) continue;
      const row = {};
      for (const nom of Object.keys(LUMBER.NOMINALS)) {
        row[nom] = Math.round(BASE_PRICE_PER_M[nom] * TIER_FACTOR[sp.costTier] * 100) / 100;
      }
      dimensional[sp.key] = row;
    }
    return { dimensional, sheet: { 6: 40, 12: 62, 18: 85 }, bdft: Object.fromEntries(
      Object.values(WOOD_SPECIES).filter(s => !s.sheet).map(s => [s.key, s.pricePerBdFt])) };
  }

  /* ---------------- 3f. Seasonal movement (Phase 4) ----------------
   * ΔMC presets: default indoor seasonal swing 4% MC; humid or arid climates
   * shift it. movementMM = width × coefficient × ΔMC — the whole formula.
   */
  const CLIMATE_DMC = { arid: 2, temperate: 4, humid: 6 };
  function movementMM(widthMM, speciesKey, grain, dMC) {
    const sp = WOOD_SPECIES[speciesKey];
    if (!sp) return 0;
    const coef = grain === 'radial' ? sp.cr : sp.ct; // flat-sawn default: tangential
    return widthMM * coef * (dMC === undefined ? CLIMATE_DMC.temperate : dMC);
  }

  /* Stock thickness snapping tables (mm). */
  const SOLID_THICKNESS = [12, 15, 19, 20, 25, 32, 38, 45];
  const SHEET_THICKNESS = [6, 12, 18];

  /* ---------------- Digests for the AI system prompt ----------------
   * Compact, lossy on purpose: enough for good proposals; validation re-checks. */
  function knowledgeDigest() {
    const w = Object.values(WOOD_SPECIES).map(s =>
      `${s.key}(janka ${s.janka},move ${s.movement},$${'●'.repeat(s.costTier)})`).join(' ');
    const e = ERGONOMICS.filter(r => isFinite(r.max)).map(r => `${r.key} ${r.min}–${r.max}mm`).join('; ');
    const j = Object.values(JOINERY).map(x => `${x.key}(str ${x.strength},lvl ${x.level})`).join(' ');
    return [
      'WOOD: ' + w,
      'ERGONOMICS(mm): ' + e,
      'JOINERY: ' + j,
      'LEVEL MATRIX: beginner={butt_screws,pocket_screws} intermediate=+{dowels,dado,rabbet,locking_rabbet} advanced=+{mortise_tenon,half_blind_dovetail}',
      'SLIDES(mm): ' + SLIDE_LENGTHS.join(',')
    ].join('\n');
  }

  BB.K = {
    WOOD_SPECIES, ERGONOMICS, JOINERY, FASTENERS, FINISHES,
    LEVELS, SLIDE_LENGTHS, SOLID_THICKNESS, SHEET_THICKNESS, WIDE_TOP_MM,
    JOINT_DEFAULTS, jointsForLevel, jointAllowed, knowledgeDigest,
    LUMBER, defaultPrices, CLIMATE_DMC, movementMM
  };
})();
