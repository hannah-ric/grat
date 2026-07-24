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
      // Effective values, NOT solid birch: cross-grain plies carry little
      // bending, so MOE ≈ 0.7× and MOR ≈ 0.5× solid birch (13.9 GPa / 114 MPa).
      // ct/cr ≈ 0: cross-laminated plies cancel seasonal movement — plywood is exempt.
      key: 'baltic_birch', label: 'Baltic Birch Ply', janka: 1260, workability: 4,
      movement: 'low', outdoor: false, costTier: 2, sheet: true, // per-sheet pricing only (audit L-03)
      moe: 10.0, mor: 55, sg: 0.68, ct: 0.0002, cr: 0.0002,
      tone: 0xe9d8ae, rough: 0.5,
      grainScale: 8, ringContrast: 0.08, hueJitter: 0.06, pores: 0.1,
      blurb: 'Void-free plywood with clean striped edges. Dead flat, dead stable — the drawer-box default.'
    },

    /* ---- 2026 expansion, tier A: the dimensional-lumber aisle ----
     * Same sourcing discipline as the rows above: mechanicals from Wood
     * Handbook Tables 5-3a/5-3b at 12% MC, ct/cr verbatim from Table 13-5,
     * Janka from The Wood Database. `aliases` feed the offline intent parser
     * only — labels stay the trade names. */
    douglas_fir: {
      // Coast-type values (WH 5-3a); Table 13-5 "Douglas-fir, Coast-type".
      key: 'douglas_fir', label: 'Douglas-Fir', aliases: ['douglas fir', 'doug fir'],
      janka: 620, workability: 3,
      movement: 'medium', outdoor: false, costTier: 1, pricePerBdFt: 3.0,
      moe: 13.4, mor: 85, sg: 0.48, ct: 0.00267, cr: 0.00165,
      tone: 0xd8a071, rough: 0.75,
      grainScale: 12, ringContrast: 0.65, hueJitter: 0.24, pores: 0.1,
      blurb: 'The framing king — stiffer than red oak at a third of the price. Splintery latewood; ease every edge.'
    },
    syp: {
      // Loblolly basis (the dominant SYP species in commerce); WH 5-3a + 13-5.
      key: 'syp', label: 'Southern Yellow Pine', aliases: ['southern yellow pine', 'yellow pine', 'syp'],
      janka: 690, workability: 3,
      movement: 'medium', outdoor: false, costTier: 1, pricePerBdFt: 2.5,
      moe: 12.3, mor: 88, sg: 0.51, ct: 0.00259, cr: 0.00165,
      tone: 0xe6c07d, rough: 0.78,
      grainScale: 10, ringContrast: 0.7, hueJitter: 0.26, pores: 0.1,
      blurb: 'Hard, bold-grained 2× stock — the strongest softwood at the box store. Watch for pitch pockets; let it acclimate.'
    },
    spf: {
      // S-P-F is a GRADE GROUP (spruces, jack/lodgepole pine, balsam fir).
      // Values pinned to the Engelmann-spruce FLOOR of the group so the
      // physics judge is never optimistic about an anonymous stud.
      key: 'spf', label: 'SPF Stud Lumber', aliases: ['spf', 'whitewood', 'stud lumber'],
      janka: 390, workability: 4,
      movement: 'medium', outdoor: false, costTier: 1, pricePerBdFt: 2.0,
      moe: 8.9, mor: 64, sg: 0.35, ct: 0.00248, cr: 0.00130,
      tone: 0xeadcae, rough: 0.8,
      grainScale: 20, ringContrast: 0.4, hueJitter: 0.2, pores: 0.05,
      blurb: 'Whitewood studs — light, cheap, knotty, with rounded arrises. Cull the rack for straight ones; perfect for shop and paint-grade builds.'
    },
    western_red_cedar: {
      key: 'western_red_cedar', label: 'Western Red Cedar', janka: 350, workability: 4,
      movement: 'low', outdoor: true, costTier: 2, pricePerBdFt: 5.0,
      moe: 7.7, mor: 52, sg: 0.32, ct: 0.00234, cr: 0.00111,
      tone: 0xb07a52, rough: 0.8,
      grainScale: 16, ringContrast: 0.5, hueJitter: 0.3, pores: 0.1,
      blurb: 'Featherweight and rot-proof — the outdoor default at every lumberyard. Soft and brittle at fasteners: pre-drill everything.'
    },

    /* ---- 2026 expansion, tier B: hardwood-dealer staples ---- */
    soft_maple: {
      key: 'soft_maple', label: 'Soft Maple', aliases: ['red maple', 'soft maple'],
      janka: 950, workability: 4,
      movement: 'medium', outdoor: false, costTier: 2, pricePerBdFt: 4.5,
      moe: 11.3, mor: 92, sg: 0.54, ct: 0.00289, cr: 0.00137,
      tone: 0xe0c9a2, rough: 0.56,
      grainScale: 22, ringContrast: 0.18, hueJitter: 0.14, pores: 0.15,
      blurb: 'Eighty percent of hard maple at sixty percent of the price. Machines easier, still blotches under stain — go clear or dye.'
    },
    hickory: {
      // Shagbark basis (WH "true hickory" group); Table 13-5 "Hickory, true".
      key: 'hickory', label: 'Hickory', janka: 1880, workability: 2,
      movement: 'high', outdoor: false, costTier: 2, pricePerBdFt: 4.5,
      moe: 14.9, mor: 139, sg: 0.72, ct: 0.00411, cr: 0.00259,
      tone: 0xcfa170, rough: 0.7,
      grainScale: 12, ringContrast: 0.55, hueJitter: 0.4, pores: 0.6,
      blurb: 'The strongest domestic — axe-handle tough, brutal on edges, dramatic sap/heart contrast. Moves a lot: design for it.'
    },
    beech: {
      // Highest ct in this catalog (0.00431) — the movement engine and the
      // WIDE_TOP_MM advisories are doing their most important work here.
      key: 'beech', label: 'American Beech', janka: 1300, workability: 3,
      movement: 'high', outdoor: false, costTier: 2, pricePerBdFt: 5.0,
      moe: 11.9, mor: 103, sg: 0.64, ct: 0.00431, cr: 0.00190,
      tone: 0xdcb896, rough: 0.6,
      grainScale: 20, ringContrast: 0.2, hueJitter: 0.12, pores: 0.15,
      blurb: 'The classic workbench and butcher wood — fine, hard, and cheap. Moves more than anything else here; let every wide panel float.'
    },
    yellow_birch: {
      key: 'yellow_birch', label: 'Yellow Birch', janka: 1260, workability: 4,
      movement: 'medium', outdoor: false, costTier: 2, pricePerBdFt: 4.5,
      moe: 13.9, mor: 114, sg: 0.62, ct: 0.00338, cr: 0.00256,
      tone: 0xe3cda0, rough: 0.58,
      grainScale: 21, ringContrast: 0.22, hueJitter: 0.15, pores: 0.12,
      blurb: 'The solid wood behind Baltic birch ply — stiff, fine-grained, takes any finish evenly. Quietly one of the best values going.'
    },
    red_alder: {
      key: 'red_alder', label: 'Red Alder', aliases: ['alder'], janka: 590, workability: 5,
      movement: 'medium', outdoor: false, costTier: 2, pricePerBdFt: 4.0,
      moe: 9.5, mor: 68, sg: 0.41, ct: 0.00256, cr: 0.00151,
      tone: 0xd9a986, rough: 0.6,
      grainScale: 24, ringContrast: 0.12, hueJitter: 0.12, pores: 0.1,
      blurb: 'The West Coast cabinet shops’ secret — poplar’s workability with honest warm color. Stains into a convincing cherry.'
    },

    /* ---- 2026 expansion, tier C: premium / outdoor ---- */
    sapele: {
      // Mechanicals: The Wood Database (12% MC): MOE 12.35 GPa, MOR 110.9 MPa.
      // ct/cr DERIVED: sapele is absent from Table 13-5. Coefficients are
      // total shrinkage (T 7.2 / R 5.2) scaled by the Table 13-5 slope of its
      // Meliaceae sibling khaya — derivation disclosed here on the
      // baltic_birch documented-effective-values precedent.
      key: 'sapele', label: 'Sapele', janka: 1360, workability: 3,
      movement: 'medium', outdoor: true, costTier: 3, pricePerBdFt: 9.0,
      moe: 12.4, mor: 111, sg: 0.67, ct: 0.00253, cr: 0.00183,
      tone: 0x8a4f36, rough: 0.62,
      grainScale: 16, ringContrast: 0.35, hueJitter: 0.28, pores: 0.45,
      blurb: 'The mahogany that shimmers — ribbon stripe on every quartered face, rot-resistant enough for doors and decks. Interlocked grain rewards light, sharp passes.'
    },
    teak: {
      // ct/cr are OFFICIAL Table 13-5 imported-woods rows (shrinkage-onset
      // 22% MC footnote) — famously the most stable wood in this catalog.
      // `oily: true` drives the glue recommendation (epoxy + solvent wipe).
      key: 'teak', label: 'Teak', janka: 1070, workability: 3, oily: true,
      movement: 'low', outdoor: true, costTier: 4, pricePerBdFt: 28,
      moe: 12.3, mor: 97, sg: 0.66, ct: 0.00186, cr: 0.00101,
      tone: 0xa5814f, rough: 0.55,
      grainScale: 18, ringContrast: 0.3, hueJitter: 0.22, pores: 0.35,
      blurb: 'The gold standard outdoors — oily, silica-laden, nearly immortal. Wipe joints with solvent before glue; expect to sharpen often.'
    },

    /* ---- 2026 expansion, tier D: sheet goods ---- */
    mdf: {
      // Effective panel values, NOT clear wood: MOE ~3 GPa / MOR ~25 MPa are
      // conservative mid-density fiberboard figures — the engine will
      // (correctly, honestly) fail MDF shelves under books + creep, exactly
      // like the frozen ash-bookshelf case. That is a feature.
      // ct/cr ≈ 0 in-plane (isotropic mat); THICKNESS swell near water is
      // real but outside the width-movement model — the blurb carries it.
      key: 'mdf', label: 'MDF', aliases: ['mdf'], janka: 700, workability: 4,
      movement: 'low', outdoor: false, costTier: 1, sheet: true, // per-sheet pricing only (audit L-03)
      moe: 3.0, mor: 25, sg: 0.75, ct: 0.0002, cr: 0.0002,
      tone: 0xc9b391, rough: 0.45,
      grainScale: 40, ringContrast: 0.02, hueJitter: 0.02, pores: 0,
      blurb: 'Dead flat, dead cheap, the perfect paint canvas — and it sags under sustained load and swells if it ever meets water. Prime the edges twice.'
    },
    hardwood_ply: {
      // Home-center veneer-core birch/maple plywood. Effective values set
      // BELOW baltic_birch (10.0 / 55): thinner face plies, core voids, and
      // more crossbands carrying the load. Same documented-effective-value
      // pattern as the baltic_birch entry.
      key: 'hardwood_ply', label: 'Hardwood Plywood', aliases: ['hardwood ply', 'hardwood plywood'],
      janka: 1000, workability: 4,
      movement: 'low', outdoor: false, costTier: 2, sheet: true, // per-sheet pricing only (audit L-03)
      moe: 8.0, mor: 40, sg: 0.55, ct: 0.0002, cr: 0.0002,
      tone: 0xe2caa0, rough: 0.55,
      grainScale: 10, ringContrast: 0.1, hueJitter: 0.08, pores: 0.1,
      blurb: 'Home-center birch or maple ply — lighter and cheaper than Baltic, with core voids to match. Edge-band the shows, and don’t hang drawer slides off a void.'
    }
  };

  /* Movement advisory threshold: a wide solid top in a high-movement
   * species needs to be allowed to move (buttons/figure-8s, no glue). */
  const WIDE_TOP_MM = 500;

  /* One board foot, in mm³ — THE shared constant (plans, packing, units all
   * derive from this; never re-type it). 1 bd ft = 144 in³ × 16387.064 mm³/in³. */
  const BF_MM3 = 2359737;

  /* ---------------- design-value basis (audit F-S3-7) ----------------
   * Disclosed in the Integrity footer and the print sheet. This is what the
   * safety factor is silently absorbing, made explicit.
   */
  const DESIGN_BASIS =
    'Material values are Wood Handbook (FPL-GTR-282) means from small, clear, ' +
    'straight-grained specimens at 12% MC. Lumber you buy has knots, grain ' +
    'runout, and grade variability that formal design (NDS) derates for; here ' +
    'the safety factor of 4 on modulus of rupture absorbs grade variability ' +
    'plus load-duration effects on strength, and sustained-load deflection is ' +
    'separately doubled for creep (Wood Handbook ch. 4). Load presets follow ' +
    'BIFMA X5.4/X5.5/X5.9 functional loads; drawer-unit tipping follows the ' +
    'intent of ASTM F2057 (STURDY). For every load-bearing part, select ' +
    'straight-grained stock free of knots. Estimates for hobby woodworking — ' +
    'not certified structural engineering.';

  /* ---------------- 3b. Ergonomics ----------------
   * All mm. axis: which overall dimension the range constrains.
   * Templates reference rows by key; validation emits advisories, never errors.
   * Notes carry lengths as {mm} tokens — BB.Units.fmtTemplate renders them in
   * the current display units, so static data still crosses ONE boundary.
   */
  const ERGONOMICS = [
    { key: 'dining_height', label: 'Dining table height', min: 730, max: 760, axis: 'height', appliesTo: ['table'], note: 'Bar height ({1040} to {1100}) and counter height ({860} to {920}) are intentional exceptions.' },
    { key: 'desk_height', label: 'Desk height', min: 720, max: 750, axis: 'height', appliesTo: ['desk'], note: 'Pair with a {420} to {530} adjustable chair.' },
    { key: 'bench_seat', label: 'Bench seat height', min: 430, max: 480, axis: 'height', appliesTo: ['bench', 'stool'], note: 'Subtract ~{25} if a cushion will live on it.' },
    { key: 'nightstand_height', label: 'Nightstand height', min: 550, max: 700, axis: 'height', appliesTo: ['nightstand'], note: 'Aim within {50} of the mattress top.' },
    { key: 'shelf_depth_books', label: 'Shelf depth for books', min: 250, max: 320, axis: 'depth', appliesTo: ['bookshelf'], note: 'Trade paperbacks need {230}; art books want {320}+.' },
    { key: 'counter_height', label: 'Counter height', min: 860, max: 940, axis: 'height', appliesTo: ['cabinet'], note: 'Standard kitchen counter is {900} to the finished top.' },
    { key: 'toe_kick', label: 'Toe kick', min: 75, max: 100, axis: 'toeKick', appliesTo: ['cabinet'], note: 'Standard recess: {90} high × {75} deep.' },
    /* Drawer rows (Phase 2 §5): drive drawer advisories. */
    { key: 'drawer_min_height', label: 'Minimum useful drawer opening', min: 80, max: Infinity, axis: 'drawerOpeningHeight', appliesTo: ['nightstand', 'cabinet'], note: 'Below {80} an opening barely clears a hand.' },
    { key: 'drawer_max_width', label: 'Max drawer width per slide pair', min: 0, max: 750, axis: 'drawerOpeningWidth', appliesTo: ['nightstand', 'cabinet'], note: 'Beyond {750} boxes rack; use two banks.' },
    { key: 'drawer_pull_height', label: 'Comfortable pull height', min: 600, max: 1100, axis: 'drawerPullHeight', appliesTo: ['cabinet'], note: 'Top drawers between hip and chest height open easiest.' },
    /* 2026 expansion: anchors for common furniture classes. The appliesTo
     * keys name furniture types ahead of their templates — validation only
     * fires for templates that exist, but the AI digest and the Shop
     * Reference teach these ranges today (novel pieces benefit immediately). */
    { key: 'coffee_table_height', label: 'Coffee table height', min: 400, max: 480, axis: 'height', appliesTo: ['coffee_table'], note: 'Aim within {50} of the sofa cushion height.' },
    { key: 'console_height', label: 'Console table height', min: 750, max: 900, axis: 'height', appliesTo: ['console'], note: 'Behind a sofa, sit at or just below the sofa back.' },
    { key: 'console_depth', label: 'Console table depth', min: 300, max: 400, axis: 'depth', appliesTo: ['console'], note: 'Hallway consoles under {350} keep walkways clear.' },
    { key: 'counter_stool_seat', label: 'Counter stool seat height', min: 610, max: 660, axis: 'height', appliesTo: ['stool'], note: 'For {900} counters; leave {250} to {300} of knee room under the top.' },
    { key: 'bar_stool_seat', label: 'Bar stool seat height', min: 730, max: 780, axis: 'height', appliesTo: ['stool'], note: 'For {1060}+ bars; add a footrest {230} below the seat.' },
    { key: 'workbench_height', label: 'Workbench height', min: 850, max: 970, axis: 'height', appliesTo: ['workbench'], note: 'Knuckle height with arms relaxed; hand-tool users go lower, assembly work higher.' },
    { key: 'platform_bed_height', label: 'Platform bed height', min: 300, max: 450, axis: 'height', appliesTo: ['platform_bed'], note: 'Mattress top should land {500} to {650} off the floor.' },
    { key: 'media_height', label: 'Media console height', min: 400, max: 600, axis: 'height', appliesTo: ['media_console'], note: 'Screen center near seated eye line, about {1000} to {1100}.' },
    { key: 'media_depth', label: 'Media console depth', min: 420, max: 500, axis: 'depth', appliesTo: ['media_console'], note: 'AV gear wants {420}+ plus cable clearance behind.' },
    { key: 'floating_shelf_depth', label: 'Floating shelf depth', min: 200, max: 300, axis: 'depth', appliesTo: ['floating_shelf'], note: 'Past {250} deep, use a {32}+ thick shelf and a full-length cleat.' },
    /* Bed-size width anchors (AI-review C1): a "for my king bed" implication
     * needs a real number to resolve against, or end-of-bed pieces ship 600 mm
     * narrow while claiming king sizing. min–max are US standard mattress
     * widths — twin 38–39 in, full/double 54–55 in, queen 60 in, king
     * (Eastern) 76–78 in, California king 72 in; lengths ride the notes.
     * appliesTo names the bed class ahead of any bed template, same as the
     * 2026 rows above — validation only fires for templates that exist. */
    { key: 'twin_bed_width', label: 'Twin bed width', min: 965, max: 990, axis: 'width', appliesTo: ['bed'], note: 'Mattress {965} to {990} wide × {1905} long.' },
    { key: 'full_bed_width', label: 'Full bed width', min: 1372, max: 1397, axis: 'width', appliesTo: ['bed'], note: 'Mattress {1372} to {1397} wide × {1905} long.' },
    { key: 'queen_bed_width', label: 'Queen bed width', min: 1524, max: 1524, axis: 'width', appliesTo: ['bed'], note: 'Mattress {1524} wide × {2030} long.' },
    { key: 'king_bed_width', label: 'King bed width', min: 1930, max: 1980, axis: 'width', appliesTo: ['bed'], note: 'Eastern king mattress {1930} to {1980} wide × {2030} long; an end-of-bed piece matches the mattress width or is a stated narrower choice.' },
    { key: 'cal_king_bed_width', label: 'California king bed width', min: 1829, max: 1829, axis: 'width', appliesTo: ['bed'], note: 'Mattress {1829} wide × {2134} long.' }
  ];

  /* ---------------- 3c. Joinery matrix ----------------
   * strength 1..5 relative. level: minimum experience level.
   * kind: which slot the joint may fill (frame = leg/rail/apron, case = carcass
   * panels/shelves, box = drawer boxes).
   */
  const LEVELS = ['beginner', 'intermediate', 'advanced'];

  const JOINERY = {
    butt_screws: {
      key: 'butt_screws', label: 'Butt joint + screws', plural: 'butt joints with screws', strength: 1, difficulty: 1, level: 'beginner',
      kinds: ['frame', 'case', 'box'],
      tools: ['drill/driver', 'countersink bit'],
      bestFor: 'Quick utility builds, shop furniture, painted work.',
      failure: 'Screws into end grain strip out — always drill pilot holes and don’t over-torque.'
    },
    pocket_screws: {
      key: 'pocket_screws', label: 'Pocket screws', plural: 'pocket screws', strength: 2, difficulty: 1, level: 'beginner',
      kinds: ['frame', 'case', 'box'],
      tools: ['pocket-hole jig', 'drill/driver'],
      bestFor: 'Face frames, aprons, and drawer boxes hidden from view.',
      failure: 'Joints creep under racking if unglued — add glue on every long-grain face.'
    },
    dowels: {
      key: 'dowels', label: 'Dowel joint', plural: 'dowel joints', strength: 3, difficulty: 2, level: 'intermediate',
      kinds: ['frame', 'case', 'box'],
      tools: ['doweling jig', 'drill', 'clamps'],
      bestFor: 'Aprons, carcass butt-ups, and alignment-critical panels.',
      failure: 'Misaligned holes lock the assembly out of square — drill both parts from the same reference face.'
    },
    dado: {
      key: 'dado', label: 'Dado / housing', plural: 'dados', strength: 3, difficulty: 2, level: 'intermediate',
      kinds: ['case'],
      tools: ['router or table saw', 'straightedge'],
      bestFor: 'Fixed shelves carrying real weight in case sides.',
      failure: 'A dado sized to nominal plywood is loose on actual plywood — cut to the measured thickness.'
    },
    rabbet: {
      key: 'rabbet', label: 'Rabbet', plural: 'rabbets', strength: 2, difficulty: 2, level: 'intermediate',
      kinds: ['case'],
      tools: ['router or table saw'],
      bestFor: 'Back panels and case tops/bottoms.',
      failure: 'Thin rabbet walls split when screwed — keep the wall at least half the stock thickness.'
    },
    locking_rabbet: {
      key: 'locking_rabbet', label: 'Locking rabbet', plural: 'locking rabbets', strength: 3, difficulty: 3, level: 'intermediate',
      kinds: ['box'],
      tools: ['table saw or router table', 'dado stack or straight bit'],
      bestFor: 'Machine-cut drawer boxes — mechanical interlock plus glue area.',
      failure: 'The short tongue snaps if the fit needs a mallet — sneak up on a hand-pressed fit.'
    },
    mortise_tenon: {
      key: 'mortise_tenon', label: 'Mortise & tenon', plural: 'mortise-and-tenon joints', strength: 5, difficulty: 4, level: 'advanced',
      kinds: ['frame'],
      tools: ['mortiser or router', 'tenon saw', 'chisels'],
      bestFor: 'Legs to aprons and rails — the reference joint for frames.',
      failure: 'A too-tight tenon splits the mortise cheek on glue-up — aim for a firm hand-press fit.'
    },
    half_blind_dovetail: {
      key: 'half_blind_dovetail', label: 'Half-blind dovetail', plural: 'half-blind dovetails', strength: 5, difficulty: 5, level: 'advanced',
      kinds: ['box'],
      tools: ['dovetail saw', 'chisels', 'marking gauge'],
      bestFor: 'Drawer fronts that show no joinery from the front and never pull apart.',
      failure: 'Blowing out the socket floor — chop halfway from each side and let the chisel do the last cut.'
    },

    /* ---- 2026 expansion (13 joints, one new kind) ----
     * strength 1..5 calibrated against the Fine Woodworking #203 laboratory
     * test (18 joints, cherry, Titebond III: half lap 1603 lb > bridle 1560 >
     * splined miter 1498 > 3/8 M&T 1444 > floating tenon 1396 … pocket screws
     * 698 > biscuit 545 > stub tenon 200) and the woodgears.ca series, then
     * adjusted for how each joint AGES — a fresh miter tests deceptively
     * strong; a glue-only wide lap creeps. NEW KIND: 'panel' — edge-to-edge
     * lamination (tops, seats, shelves, butcher blocks). Frame/case/box
     * semantics are unchanged, so existing designs are untouched. */
    edge_glue: {
      key: 'edge_glue', label: 'Edge glue-up', plural: 'edge glue-ups', strength: 5, difficulty: 2, level: 'beginner',
      kinds: ['panel'],
      tools: ['jointer or hand plane (or a good table-saw rip)', 'bar clamps', 'cauls'],
      bestFor: 'Tops, seats, shelves, and butcher blocks — any panel wider than a board. Long-grain to long-grain is stronger than the wood itself.',
      failure: 'Starved or out-of-flat joints open at the ends — glue both edges, alternate clamps over and under, and check the panel with a straightedge before the glue tacks.'
    },
    half_lap: {
      key: 'half_lap', label: 'Half lap', plural: 'half laps', strength: 4, difficulty: 2, level: 'intermediate',
      kinds: ['frame'],
      tools: ['table saw or router', 'shoulder plane or chisel'],
      bestFor: 'Face frames, door frames, and stretchers — the strongest joint per minute of effort in the FWW lab test.',
      failure: 'A wide lap is a cross-grain glue surface that creeps with the seasons — pin laps wider than ~75 mm or keep them narrow.'
    },
    cross_lap: {
      key: 'cross_lap', label: 'Cross lap', plural: 'cross laps', strength: 4, difficulty: 2, level: 'intermediate',
      kinds: ['frame'],
      tools: ['table saw or router', 'chisel'],
      bestFor: 'X-bases, intersecting stretchers, and grid shelving — the joint that makes sculptural leg geometry buildable.',
      failure: 'Sloppy shoulders let the X rack — sneak up on the notch width with test cuts in offcut stock.'
    },
    bridle: {
      key: 'bridle', label: 'Bridle joint', plural: 'bridle joints', strength: 4, difficulty: 3, level: 'intermediate',
      kinds: ['frame'],
      tools: ['tenon saw or table saw', 'chisels'],
      bestFor: 'Exposed corner frames and trestle heads — mortise-and-tenon strength with every surface visible for fitting.',
      failure: 'Thin outer cheeks split under clamp pressure — keep the center tongue at one-third and clamp across the cheeks, not just along the rail.'
    },
    loose_tenon: {
      key: 'loose_tenon', label: 'Loose tenon', plural: 'loose tenons', strength: 4, difficulty: 3, level: 'intermediate',
      kinds: ['frame', 'case'],
      tools: ['router + edge guide (or Domino/mortising jig)', 'milled tenon stock', 'clamps'],
      bestFor: 'Mortise-and-tenon strength at machine speed, and the sane choice for angled or curved parts where a fixed tenon is awkward.',
      failure: 'Undersized store-bought tenons starve the joint — size the mortise to one-third of stock and mill tenon stock to a firm hand-press fit.'
    },
    box_joint: {
      key: 'box_joint', label: 'Box joint', plural: 'box joints', strength: 5, difficulty: 3, level: 'intermediate',
      kinds: ['box'],
      tools: ['table saw + dado stack + indexing jig (or router table)'],
      bestFor: 'Drawer boxes and chests with proudly visible corners — enormous long-grain glue area, machine-cut repeatability.',
      failure: 'Pin-spacing error is cumulative across the board — cut every finger off one indexed jig setting and never re-register mid-run.'
    },
    through_dovetail: {
      key: 'through_dovetail', label: 'Through dovetail', plural: 'through dovetails', strength: 5, difficulty: 5, level: 'advanced',
      kinds: ['box', 'case'],
      tools: ['dovetail saw', 'chisels', 'marking gauge'],
      bestFor: 'Carcass corners and drawer backs that show the craft — the mechanical lock holds even if the glue ever fails.',
      failure: 'Gappy baselines from timid scribing — knife the baseline deep and chop to it in stages from both faces.'
    },
    sliding_dovetail: {
      key: 'sliding_dovetail', label: 'Sliding dovetail', plural: 'sliding dovetails', strength: 4, difficulty: 4, level: 'advanced',
      kinds: ['case'],
      tools: ['router + dovetail bit', 'edge guide'],
      bestFor: 'Shelves and dividers that mechanically cannot pull out of the case sides; stretchers into slab legs.',
      failure: 'A full-length parallel socket seizes halfway home — taper the socket a hair, wax the pin, and drive it fast.'
    },
    miter_spline: {
      key: 'miter_spline', label: 'Splined miter', plural: 'splined miters', strength: 3, difficulty: 3, level: 'intermediate',
      kinds: ['case', 'box'],
      tools: ['table saw at 45°', 'spline jig'],
      bestFor: 'Waterfall edges and wrap-around grain — the spline carries what the end-grain miter faces cannot.',
      failure: 'Fresh miters test strong but seasonal stress finds them — orient the spline’s grain across the joint and never rely on the miter faces alone.'
    },
    staked_tenon: {
      key: 'staked_tenon', label: 'Staked wedged tenon', plural: 'staked wedged tenons', strength: 4, difficulty: 3, level: 'intermediate',
      kinds: ['frame'],
      tools: ['auger or Forstner bit', 'saw (wedge kerf)', 'hardwood wedges', 'sliding bevel'],
      bestFor: 'Legs straight into slab seats and tops — stools, staked benches, Windsor-style tables. The joint that unlocks splayed-leg pieces.',
      failure: 'A wedge driven parallel to the seat grain splits the slab — always orient the kerf and wedge across the grain of the mortised board.'
    },
    biscuits: {
      key: 'biscuits', label: 'Biscuit joint', plural: 'biscuit joints', strength: 2, difficulty: 1, level: 'beginner',
      kinds: ['case', 'panel'],
      tools: ['biscuit joiner', 'clamps'],
      bestFor: 'Alignment during panel glue-ups and light casework registration — fast, forgiving, invisible.',
      failure: 'Treating an alignment aid as structure — biscuits landed near the bottom of the FWW strength test; let the glue line or real joinery carry the load.'
    },
    french_cleat: {
      key: 'french_cleat', label: 'French cleat', plural: 'french cleats', strength: 3, difficulty: 2, level: 'beginner',
      kinds: ['case'],
      // external: the cleat's mate is the BUILDING (studs), never another
      // part of the model — correction refuses it inside a connection graph.
      external: true,
      tools: ['table saw (45° rip)', 'level', 'stud finder', 'drill/driver'],
      bestFor: 'Wall-hung cabinets, floating shelves, and shop-wall systems — a gravity lock that lifts off for moving day.',
      failure: 'A cleat screwed to drywall alone sheds the whole case — every cleat lands on studs or rated anchors, no exceptions.'
    },
    kd_bolt: {
      key: 'kd_bolt', label: 'Knockdown bolt', plural: 'knockdown bolts', strength: 4, difficulty: 2, level: 'beginner',
      // 'case' too (A1): barrel-nut bolts are the canonical knock-down CASE
      // fastener (access panels, bolted carcasses) — and the only honest
      // joint for a tool-removable lid/panel, so gating must not rewrite it
      // into a permanent joint the explain then lies about.
      kinds: ['frame', 'case'],
      tools: ['drill + brad-point bits', 'doweling jig', 'hex key'],
      bestFor: 'Bed rails, big tables, and anything that must fit through a doorway again someday — steel strength, tool-free service.',
      failure: 'The barrel-nut bore drifting off the bolt axis — drill both holes from the same reference face with a jig, never freehand.'
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
    // Existing frame/case/box picks are frozen (golden corpus); 'panel' is the
    // 2026 slot — edge glue-ups are the right default at every level.
    beginner: { frame: 'pocket_screws', case: 'butt_screws', box: 'pocket_screws', panel: 'edge_glue' },
    intermediate: { frame: 'dowels', case: 'dado', box: 'locking_rabbet', panel: 'edge_glue' },
    advanced: { frame: 'mortise_tenon', case: 'dado', box: 'half_blind_dovetail', panel: 'edge_glue' }
  };

  /* ---------------- 3d. Fasteners & finishes ----------------
   * Labels/uses carry {mm} tokens rendered via BB.Units.fmtTemplate.
   * Exceptions kept literal on purpose: "M4" and "5 mm shelf pin" ARE the
   * trade names in every market (metric hardware), and "#8" is a gauge. */
  const FASTENERS = {
    screws: [
      { key: 'wood_8x25', label: '#8 × {25} wood screw', pilot: 2.8, use: 'Drawer fronts from inside the box' },
      { key: 'wood_8x32', label: '#8 × {32} wood screw', pilot: 2.8, use: 'Aprons, cleats, general carcass' },
      { key: 'wood_8x50', label: '#8 × {50} wood screw', pilot: 2.8, use: 'Legs, rails, structural butt joints' },
      { key: 'pocket_32', label: '{32} coarse pocket screw', pilot: 0, use: 'Pocket joints in {18} to {20} softwood/sheet stock' },
      { key: 'slide_m4', label: 'M4 × {10} pan-head', pilot: 3.0, use: 'Drawer slide mounting into {12} box sides' },
      { key: 'top_button', label: 'Tabletop button + #8 × {16}', pilot: 2.8, use: 'Solid tops — lets the panel move' },
      /* 2026 expansion: 2× construction. The 32 mm pocket screw physically
       * cannot join 38 mm stock — the long jig setting needs its own screw. */
      { key: 'pocket_63', label: '{63} coarse pocket screw', pilot: 0, use: 'Pocket joints in {38} (2×) softwood/sheet stock' },
      { key: 'pocket_32_fine', label: '{32} fine pocket screw', pilot: 0, use: 'Pocket joints in {18} to {20} hardwood' },
      { key: 'pocket_63_fine', label: '{63} fine pocket screw', pilot: 0, use: 'Pocket joints in {38} (2×) hardwood' },
      { key: 'wood_8x64', label: '#8 × {64} wood screw', pilot: 2.8, use: '{19} stock through into {38} framing' },
      { key: 'struct_6x90', label: '{6} × {90} structural screw', pilot: 4.0, use: '2× and 4×4 frame joints, workbench bases' }
    ],
    dowels: [
      { key: 'dowel_8', label: '{8} × {40} fluted dowel', pilot: 8, use: 'Aprons and rails in {20}+ stock' },
      { key: 'dowel_10', label: '{10} × {50} fluted dowel', pilot: 10, use: 'Legs and thick frames' },
      /* 2026 expansion */
      { key: 'dowel_6', label: '{6} × {30} fluted dowel', pilot: 6, use: 'Boxes and light frames in {12} to {15} stock' },
      { key: 'loose_tenon_8', label: '{8} × {22} × {50} loose tenon', pilot: 8, use: 'Loose-tenon frame joints in {19}+ stock' }
    ],
    hardware: [
      // capacityKg: rated load per PAIR for the common 75 lb class of
      // side-mount ball-bearing slides — drives the slide-capacity check.
      { key: 'slide_pair', label: 'Side-mount ball-bearing slides (pair)', use: 'Drawer runners, {250} to {500}', price: 14, capacityKg: 34 },
      { key: 'pull', label: 'Drawer pull', use: 'One per drawer', price: 6 },
      { key: 'shelf_pin', label: '5 mm shelf pin', use: 'Adjustable shelves — 4 per shelf', price: 0.25 },
      { key: 'figure8', label: 'Figure-8 fastener', use: 'Solid top attachment allowing movement', price: 0.8 },
      /* 2026 expansion: knockdown, wall-hung, and hardware-legged pieces.
       * "M6"/"M8" and "#20" are the trade names in every market. */
      { key: 'biscuit_20', label: '#20 biscuit', use: 'Panel alignment — one per {150} to {250} of edge', price: 0.15 },
      { key: 'insert_m6', label: 'M6 threaded insert', use: 'Removable legs and hardware in solid stock', price: 0.9 },
      { key: 'barrel_m6', label: 'M6 × {50} furniture bolt + barrel nut', use: 'Knockdown frames: beds, big tables — 2 per rail end', price: 1.5 },
      { key: 'leg_plate', label: 'Leg mounting plate + hanger bolt', use: 'Turned or splayed legs, 0° to 15° pitch plates', price: 5 },
      { key: 'hairpin_406', label: '{406} hairpin legs (set of 4)', use: 'Slab-top side tables and benches', price: 40 },
      { key: 'hairpin_711', label: '{711} hairpin legs (set of 4)', use: 'Slab-top desks and dining tables', price: 55 },
      { key: 'euro_hinge', label: '35 mm concealed cup hinge', use: 'Cabinet doors — 2 per door, 3 over {900} tall', price: 4.5 },
      { key: 'caster_75', label: '{75} locking caster', use: 'Workbenches and carts — 4 per, check the stamped rating', price: 8 },
      { key: 'leveler_m8', label: 'M8 leveling foot', use: 'Uneven floors — one per leg, pairs with insert_m6', price: 1.2 },
      { key: 'bed_bracket', label: 'Bed rail bracket (pair)', use: 'Tool-free rail-to-headboard connection', price: 7 }
    ]
  };

  /* ---------------- Adhesives (2026 expansion — new table) ----------------
   * The plans said "glue" without ever saying which, yet food safety, outdoor
   * duty, and oily species all turn on the answer. openMin: working time.
   * clampMin: minimum clamp time (hardwood, 20 °C). cureHrs: full strength.
   * foodContact: compliant for INDIRECT food contact when fully cured
   * (FDA 21 CFR 175.105) — the butcher-block gate. water: ANSI/HPVA type.
   * price: one shop bottle/kit, for the BOM line. */
  const GLUES = [
    { key: 'pva_interior', label: 'Interior PVA (yellow glue)', openMin: 5, clampMin: 30, cureHrs: 24,
      water: 'interior only', foodContact: false, price: 8,
      blurb: 'The everyday bottle — fastest tack, easiest cleanup, stronger than the wood on any long-grain joint.' },
    { key: 'pva_resistant', label: 'Water-resistant PVA (Type II)', openMin: 5, clampMin: 45, cureHrs: 24,
      water: 'water-resistant (ANSI/HPVA Type II)', foodContact: false, price: 9,
      blurb: 'Covered-outdoor and kitchen-adjacent work. Fine glue, but reach for Type I when food or standing water is in the picture.' },
    { key: 'pva_waterproof', label: 'Waterproof PVA (Type I)', openMin: 8, clampMin: 45, cureHrs: 24,
      water: 'waterproof (ANSI/HPVA Type I)', foodContact: true, price: 10,
      blurb: 'The Titebond III class — cutting boards, butcher blocks, and outdoor glue-ups. Fully cured, it is FDA-compliant for indirect food contact.' },
    { key: 'epoxy_slow', label: 'Slow-set epoxy', openMin: 30, clampMin: 360, cureHrs: 72,
      water: 'waterproof', foodContact: false, price: 16,
      blurb: 'Gap-filling and oily-wood capable — the teak glue, after a solvent wipe. Long open time saves complex assemblies.' },
    { key: 'polyurethane', label: 'Polyurethane glue', openMin: 15, clampMin: 120, cureHrs: 24,
      water: 'waterproof', foodContact: false, price: 11,
      blurb: 'Foams as it cures — clamp hard, dampen one face, and expect squeeze-out cleanup with a chisel, not a rag.' }
  ];
  /* Code-owned glue choice: deterministic function of the corrected spec —
   * the assembly plan and BOM name the right bottle the way they already
   * name the right screw. Precedence: food contact > oily species > exterior
   * finish > everyday interior. */
  function recommendGlue(spec) {
    const byKey = k => GLUES.find(g => g.key === k);
    const sp = (spec && spec.wood && WOOD_SPECIES[spec.wood.species]) || {};
    const fin = (spec && FINISHES.find(f => f.key === spec.finish)) || {};
    if (fin.foodContact) {
      return {
        glue: byKey('pva_waterproof'),
        why: 'food-contact finish — the glue must match (indirect food contact when fully cured)' +
          (sp.oily ? `; wipe ${sp.label} joints with solvent first` : '')
      };
    }
    if (sp.oily) return { glue: byKey('epoxy_slow'), why: `${sp.label} is oily — epoxy after a solvent wipe` };
    if (fin.exterior) return { glue: byKey('pva_waterproof'), why: 'exterior finish — the glue line must outlast the weather too' };
    return { glue: byKey('pva_interior'), why: 'interior build — long-grain PVA is stronger than the wood' };
  }

  /* prep: sanding grit ladder before the first coat; betweenGrit: abrasive
   * between coats; raiseGrain: damp the surface and knock back the fuzz
   * before finishing; flammableRags: oil-soaked rags self-heat — the safety
   * step must say so (audit F-S3-3/F-S3-4). */
  const FINISHES = [
    { key: 'wipe_poly', label: 'Wipe-on polyurethane', coats: 3, recoatHrs: 4, cureDays: 3, sheen: 'satin', preview: 'film', prep: { grits: [120, 180], betweenGrit: 320 }, flammableRags: true, blurb: 'Foolproof rag-on protection; sand at 320 between coats.' },
    { key: 'danish_oil', label: 'Danish oil', coats: 2, recoatHrs: 8, cureDays: 7, sheen: 'natural', preview: 'oil', prep: { grits: [120, 180, 220], betweenGrit: 320 }, flammableRags: true, blurb: 'In-the-wood look and feel; easiest repair story — just re-oil.' },
    { key: 'water_poly', label: 'Water-based poly', coats: 3, recoatHrs: 2, dryFast: true, cureDays: 2, sheen: 'clear', preview: 'film', prep: { grits: [120, 180, 220], betweenGrit: 320, raiseGrain: true }, blurb: 'Crystal clear, low odor, fast recoat; raises grain — pre-dampen and sand first.' },
    { key: 'hardwax_oil', label: 'Hardwax oil', coats: 2, recoatHrs: 12, cureDays: 5, sheen: 'matte', preview: 'oil', prep: { grits: [120, 150, 180] }, flammableRags: true, blurb: 'Modern matte with a velvet hand; buff on, buff off.' },
    /* 2026 expansion — FIN wire enum: APPEND ONLY, this exact order.
     * foodContact marks finishes acceptable on cutting surfaces.
     * flammableRags semantics preserved: true = polymerizing (self-heating)
     * oil. Mineral oil is NON-drying — its rags are not self-heating (no
     * false alarm), which is itself useful safety truth. cureDays 0 = never
     * film-cures (renewable in place). */
    { key: 'mineral_oil', label: 'Mineral oil (food-contact)', coats: 3, recoatHrs: 8, cureDays: 0, sheen: 'natural', preview: 'oil',
      prep: { grits: [120, 180, 220] }, foodContact: true,
      blurb: 'Flood, let it drink, wipe dry. Never cures, never fails, never flakes — re-oil cutting surfaces monthly.' },
    { key: 'board_butter', label: 'Board butter (oil + beeswax)', coats: 2, recoatHrs: 12, cureDays: 0, sheen: 'soft satin', preview: 'oil',
      prep: { grits: [120, 180, 220] }, foodContact: true,
      blurb: 'Mineral oil base, beeswax topcoat buffed warm — water beads instead of soaking. The butcher-block finish.' },
    { key: 'tung_pure', label: 'Pure tung oil', coats: 5, recoatHrs: 48, cureDays: 21, sheen: 'matte', preview: 'oil',
      prep: { grits: [120, 180, 220] }, flammableRags: true, foodContact: true,
      blurb: 'Waterproofing that lives in the wood, not on it. Slow — a real cure takes weeks — but the patience shows.' },
    { key: 'shellac', label: 'Dewaxed shellac', coats: 3, recoatHrs: 1, cureDays: 1, sheen: 'satin-gloss', preview: 'film',
      prep: { grits: [120, 180, 220], betweenGrit: 320 },
      blurb: 'One-hour recoats and a barrier under anything else. Not for wet or hot surfaces — a coaster ring will find it.' },
    { key: 'spar_urethane', label: 'Spar urethane (exterior)', coats: 3, recoatHrs: 12, cureDays: 7, sheen: 'gloss', preview: 'film',
      prep: { grits: [120, 180], betweenGrit: 320 }, flammableRags: true, exterior: true,
      blurb: 'UV blockers and flex for outdoor pieces — pairs with white oak, cedar, sapele, and teak. Recoat before it ever peels.' },
    { key: 'paint_system', label: 'Primer + enamel', coats: 3, recoatHrs: 6, cureDays: 14, sheen: 'painted', preview: 'paint',
      prep: { grits: [120, 180] },
      blurb: 'The poplar, SPF, and MDF path: one primer coat, two enamel. Prime MDF edges twice — they drink the first coat whole.' }
  ];

  /* Display-only finish class for the 3D preview (interaction-system §2).
   * Never enters cut list, packing, integrity, or goldens — optics only. */
  function finishPreviewClass(key) {
    const f = FINISHES.find(x => x.key === key);
    return (f && f.preview) || 'raw';
  }

  /* Standard slide lengths (mm), used by drawer-box math.
   * 533/610 (21/24 in) appended for deep cases (2026 hardware expansion). */
  const SLIDE_LENGTHS = [250, 300, 350, 400, 450, 500, 533, 610];
  /* Side-mount ball-bearing slides need exactly 1/2 in (12.7 mm) per side —
   * total box-to-opening clearance. 12.5 binds the slide (audit F-S1-4). */
  const SLIDE_SPACE_MM = 25.4;

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
      // 2026 expansion: the rest of the 2× aisle and the 4×4 post. A 38 mm
      // part wider than 89 now packs as a direct rip instead of a glue-up,
      // and a 60–89 mm post rips from one 4×4 instead of laminating.
      '2x3': { t: 38, w: 64 }, '2x6': { t: 38, w: 140 }, '2x8': { t: 38, w: 184 },
      '2x10': { t: 38, w: 235 }, '2x12': { t: 38, w: 286 }, '4x4': { t: 89, w: 89 },
      // thick hardwood stock (surfaced 5/4 and 8/4) so 25/38 mm parts pack too
      '5/4x4': { t: 25, w: 89 }, '5/4x6': { t: 25, w: 140 }, '5/4x8': { t: 25, w: 184 },
      '8/4x3': { t: 45, w: 64 }, '8/4x4': { t: 45, w: 89 }
    },
    // 16 ft (4877) stock evaluated and deliberately left out: pack1D opens the
    // longest length first, so adding it would shift every multi-board plan
    // onto boards most people cannot transport — with no capability gain,
    // since no part exceeds the 12 ft board.
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
   * tier. Sheets: $ per FULL 1220×2440 sheet per thickness; fractions are
   * priced exactly pro-rata. Rough hardwood stays priced per board foot
   * (species pricePerBdFt) when the user prefers rough stock.
   */
  const BASE_PRICE_PER_M = {
    '1x2': 2.0, '1x3': 2.6, '1x4': 3.3, '1x6': 5.2, '1x8': 7.2, '1x10': 9.8, '1x12': 12.5,
    '2x2': 3.0, '2x4': 4.2,
    '2x3': 3.4, '2x6': 6.6, '2x8': 9.4, '2x10': 13.0, '2x12': 16.4, '4x4': 10.5,
    '5/4x4': 4.6, '5/4x6': 7.2, '5/4x8': 9.8, '8/4x3': 6.4, '8/4x4': 8.4
  };
  const TIER_FACTOR = { 1: 1, 2: 1.8, 3: 2.6, 4: 3.6 };
  /* Sheet prices are keyed species × thickness ($ per FULL 1220×2440 sheet).
   * Sheet species are the WOOD_SPECIES rows with `sheet: true`; the legacy
   * flat {6,12,18} price shape (implicitly Baltic) migrates in Store.loadPrices. */
  const SHEET_BASE_PRICES = {
    baltic_birch: { 6: 40, 12: 62, 18: 85 },
    mdf: { 6: 22, 12: 30, 18: 40 },
    hardwood_ply: { 6: 30, 12: 48, 18: 62 }
  };
  function sheetSpeciesKeys() {
    return Object.values(WOOD_SPECIES).filter(s => s.sheet).map(s => s.key);
  }
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
    const sheet = {};
    for (const key of sheetSpeciesKeys()) {
      sheet[key] = Object.assign({}, SHEET_BASE_PRICES[key] || SHEET_BASE_PRICES.baltic_birch);
    }
    return { dimensional, sheet, bdft: Object.fromEntries(
      Object.values(WOOD_SPECIES).filter(s => !s.sheet).map(s => [s.key, s.pricePerBdFt])),
      hardware: hardwarePriceDefaults() };
  }
  /* One boundary for sheet-price lookups: tolerates the legacy flat shape
   * ({6:40,...} meaning Baltic) and missing species (falls back to defaults). */
  function sheetPriceFor(prices, speciesKey, thickness) {
    const table = prices && prices.sheet;
    if (table) {
      const row = table[speciesKey];
      if (row && row[thickness] !== undefined) return row[thickness];
      if (speciesKey === 'baltic_birch' && typeof table[thickness] === 'number') return table[thickness];
    }
    const dflt = SHEET_BASE_PRICES[speciesKey] || SHEET_BASE_PRICES.baltic_birch;
    return dflt[thickness] !== undefined ? dflt[thickness] : 60;
  }

  /* ---------------- Hardware & consumable prices (2026) ----------------
   * One editable price key per non-lumber line the BOM prints, so the
   * "user-editable price list" is finally the WHOLE list, not a third of it.
   * Defaults assemble lazily from the owning tables (GLUES here, SLIDES and
   * PULLS in BB.HW, which loads immediately after this module); Store merges
   * user edits over these, and every BOM lookup routes through
   * hardwarePrice() so an edited number reaches every line item. */
  const CONSUMABLE_PRICES = {
    finish_flat: 18,   // one finish purchase per project (can/bottle)
    antitip_kit: 7, shelf_pin: 0.25, screw_pack: 1,
    screw: 0.06, pocket: 0.08, dowel: 0.1, figure8: 0.8,
    biscuit: 0.15, loose_tenon: 0.5, kd_bolt: 1.5, spline: 0.4
  };
  function hardwarePriceDefaults() {
    const out = Object.assign({}, CONSUMABLE_PRICES);
    for (const g of GLUES) out['glue_' + g.key] = g.price;
    const HW = BB.HW;
    if (HW) {
      for (const s of Object.values(HW.SLIDES)) out['slide_' + s.key] = s.price;
      for (const p of Object.values(HW.PULLS)) out['pull_' + p.key] = p.price;
      for (const k of ['euro_cup', 'butt_brass', 'no_mortise']) {
        if (HW.HINGES[k]) out['hinge_' + k] = HW.HINGES[k].price;
      }
    }
    return out;
  }
  function hardwarePrice(prices, key, fallback) {
    const t = prices && prices.hardware;
    if (t && isFinite(t[key])) return t[key];
    const d = hardwarePriceDefaults()[key];
    return d !== undefined ? d : (fallback !== undefined ? fallback : 0);
  }
  /* Display labels for the price editor — derived from the owning tables. */
  function hardwarePriceLabel(key) {
    const HW = BB.HW;
    if (key.startsWith('glue_')) { const g = GLUES.find(x => 'glue_' + x.key === key); if (g) return g.label; }
    if (HW && key.startsWith('slide_')) { const s = HW.SLIDES[key.slice(6)]; if (s) return s.label; }
    if (HW && key.startsWith('pull_')) { const p = HW.PULLS[key.slice(5)]; if (p) return p.label + (p.key === 'none_touch' ? '' : ' (each)'); }
    if (HW && key.startsWith('hinge_')) { const h = HW.HINGES[key.slice(6)]; if (h) return h.label + ' (each)'; }
    return {
      finish_flat: 'Finish (per project)', antitip_kit: 'Anti-tip wall anchor kit',
      shelf_pin: 'Shelf pin (each)', screw_pack: 'Screw pack (drawer mounting)',
      screw: 'Wood screw (each)', pocket: 'Pocket screw (each)', dowel: 'Fluted dowel (each)',
      figure8: 'Figure-8 fastener (each)', biscuit: '#20 biscuit (each)',
      loose_tenon: 'Loose tenon (each)', kd_bolt: 'Knockdown bolt (each)', spline: 'Plywood spline (each)'
    }[key] || key.replace(/_/g, ' ');
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

  /* Stock thickness snapping tables (mm). POST_THICKNESS extends the solid
   * table for custom-grammar posts/legs: the packer laminates anything over
   * 45, exactly as templates already allow 100 mm legs (audit F-S2-6). */
  const SOLID_THICKNESS = [12, 15, 19, 20, 25, 32, 38, 45];
  // 89 = actual 4×4, so custom posts snap to buyable stock instead of an
  // unbuyable 90 (2026 expansion, lands with the 4x4 nominal).
  const POST_THICKNESS = [...SOLID_THICKNESS, 60, 70, 80, 89, 90, 100];
  const SHEET_THICKNESS = [6, 12, 18];

  /* Ergonomics row lookup — validation reads thresholds from here instead of
   * re-typing 80/750/1100 (audit F-SYS-3). */
  function ergoRow(key) {
    return ERGONOMICS.find(r => r.key === key) || null;
  }

  /* ---------------- Digests for the AI system prompt ----------------
   * Compact, lossy on purpose: enough for good proposals; validation re-checks.
   * EVERY line is GENERATED from the tables above — never hand-copied — and
   * the self-test suite asserts the generation, so a table edit can never
   * leave the AI proposing from stale norms (audit F-S3-8). */
  function levelMatrixLine() {
    const parts = LEVELS.map((lvl, i) => {
      const own = Object.values(JOINERY).filter(j => j.level === lvl).map(j => j.key);
      return `${lvl}=${i ? '+' : ''}{${own.join(',')}}`;
    });
    return 'LEVEL MATRIX: ' + parts.join(' ');
  }
  /* Ergonomic anchor ranges for the photo-estimation prompt, generated. */
  function visionRangesLine() {
    const keys = ['dining_height', 'desk_height', 'bench_seat', 'nightstand_height', 'counter_height'];
    return keys.map(k => { const r = ergoRow(k); return `${r.label.toLowerCase().replace(/ height| seat/g, '')} ${r.min}-${r.max}`; }).join(', ') + ' mm';
  }
  function knowledgeDigest() {
    // Real $/bd ft, not $-dots (audit M-22): "keep it under $200" and
    // "cheapest wood that won't sag" are only answerable against numbers.
    // These are the DEFAULT prices; the current design's estimated total
    // (user-edited prices included) rides the prompt tail via AI.budgetLine.
    const w = Object.values(WOOD_SPECIES).map(s =>
      `${s.key}(janka ${s.janka},move ${s.movement},$${s.pricePerBdFt}/bdft)`).join(' ');
    // min===max rows (single standard sizes, e.g. queen_bed_width) print one
    // number — "1524–1524mm" spent tokens saying nothing.
    const e = ERGONOMICS.filter(r => isFinite(r.max)).map(r => `${r.key} ${r.min === r.max ? r.min : `${r.min}–${r.max}`}mm`).join('; ');
    // strength only: each joint's level already rides the LEVEL MATRIX line —
    // repeating it here spent ~50 prompt tokens saying the same thing twice.
    const j = Object.values(JOINERY).map(x => `${x.key}(str ${x.strength})`).join(' ');
    return [
      'WOOD: ' + w,
      'ERGONOMICS(mm): ' + e,
      'JOINERY: ' + j,
      levelMatrixLine(),
      'SLIDES(mm): ' + SLIDE_LENGTHS.join(','),
      // C12: the packer's real sheet — sheet-budget requests ("one sheet of
      // ply") must be designed against these dimensions, not a guessed prior.
      `SHEET(mm): ${LUMBER.SHEET.W}×${LUMBER.SHEET.L}, thickness ${LUMBER.SHEET.THICKNESSES.join('/')}`
    ].join('\n');
  }

  BB.K = {
    WOOD_SPECIES, ERGONOMICS, JOINERY, FASTENERS, FINISHES, GLUES,
    LEVELS, SLIDE_LENGTHS, SLIDE_SPACE_MM, SOLID_THICKNESS, POST_THICKNESS, SHEET_THICKNESS, WIDE_TOP_MM,
    JOINT_DEFAULTS, jointsForLevel, jointAllowed, knowledgeDigest,
    levelMatrixLine, visionRangesLine, ergoRow, BF_MM3, DESIGN_BASIS,
    LUMBER, defaultPrices, CLIMATE_DMC, movementMM,
    recommendGlue, sheetSpeciesKeys, sheetPriceFor, SHEET_BASE_PRICES,
    hardwarePriceDefaults, hardwarePrice, hardwarePriceLabel,
    finishPreviewClass
  };
})();
