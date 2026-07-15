/* Blueprint Buddy — furniture hardware repository (2026 expansion).
 *
 * THE DOCTRINE, founding rule extended one layer: the AI proposes hardware
 * STYLE intent only ("bar pulls", "no visible hardware", "undermount
 * slides"); CODE selects every rating, count, position, and bore. The app
 * already computes every part's dimensions and weight (geometry × SG), so
 * hinge counts, slide classes, gas-strut forces, and lid-stay torques are
 * pure functions of the corrected spec — exactly like beam math, and every
 * one is provenance-friendly arithmetic (RULES below).
 *
 * Three strata, honestly separated:
 *   LIVE — consumed by today's geometry (drawer slides, pulls, shelf pins,
 *          wooden-runner fitting, the outdoor-hardware advisory).
 *   READY — selection rules with no geometry yet (door hinges, lifts,
 *          stays): tested code awaiting the doors/lids workstream. Their
 *          wire enums are deliberately NOT minted until a consumer exists.
 *   REFERENCE — the teaching layer (catches, locks, wall hanging, feet,
 *          and the traditional no-hardware solutions), searchable in the
 *          Shop Reference, several with 3D inspector models.
 *
 * All mm, N, kg, N·m. {mm} tokens render via BB.Units.fmtTemplate.
 * Capacity fields are conservative class ratings, not brand promises.
 * Sources: Blum-class cup-hinge geometry and count charts, KV/Blum slide
 * specifications (27 mm undermount regime), gas-spring vendor moment
 * calculators, ASTM F963 toy-chest provisions, Amerock-class CTC series,
 * FWW rule-joint canon. Full register in the PR.
 */
var BB = globalThis.BB = globalThis.BB || {};

(function () {
  'use strict';

  /* ---------------- §1 Hinges (READY: awaits the doors workstream) ---- */
  const HINGES = {
    euro_cup: {
      key: 'euro_cup', label: '35 mm concealed cup hinge', price: 4.5,
      fronts: ['overlay', 'inset'], opening: 110, softCloseAvail: true,
      capacityKgPair: 7, countRule: 'doorHinges',
      boring: { cupDia: 35, cupDepth: 13, tbMin: 3, tbMax: 7, tbDefault: 5, plateSetback: 37, maxDoorT: 26 },
      bestFor: 'Cabinet doors of every kind — 3-axis adjustable after hanging, soft-close available, invisible when closed.',
      failure: 'Cup bored too far from the edge robs the opening angle and drags the door on the carcass — respect the 3 to 7 mm boring distance.'
    },
    compact_ff: {
      key: 'compact_ff', label: 'Compact face-frame hinge', price: 4,
      fronts: ['overlay'], opening: 105, softCloseAvail: true, capacityKgPair: 7, countRule: 'doorHinges',
      boring: { cupDia: 35, cupDepth: 13, pattern: 45 },
      bestFor: 'Overlay doors on face-frame cabinets — the cup hinge that screws straight to the frame stile, no plate.',
      failure: 'Overlay is fixed by the hinge model, not adjustment — buy the overlay you designed, don’t bend the one you have.'
    },
    butt_brass: {
      key: 'butt_brass', label: 'Brass butt hinge', price: 6,
      fronts: ['inset'], opening: 180, sizes: [51, 64, 76], capacityKgPair: 9, countRule: 'doorHinges',
      boring: { gainDepth: 'one leaf thickness (~2.3)', screws: '#5 × {16}' },
      bestFor: 'Inset doors on fine casework and boxes — the traditional exposed knuckle, mortised flush.',
      failure: 'A gain cut deeper than one leaf binds the door and springs the screws — the knuckle, not the leaf, sets the reveal.'
    },
    no_mortise: {
      key: 'no_mortise', label: 'No-mortise hinge', price: 3.5,
      fronts: ['inset'], opening: 180, capacityKgPair: 7, countRule: 'doorHinges',
      bestFor: 'Inset doors without the chisel work — interleaved leaves add only one leaf thickness of gap.',
      failure: 'The built-in ~2 mm gap IS the reveal — plan the door size around it instead of fighting it.'
    },
    piano: {
      key: 'piano', label: 'Piano (continuous) hinge', price: 12,
      fronts: ['inset', 'overlay'], opening: 270, stockLenMM: 1829, capacityKgPair: 25, countRule: 'fullLength',
      boring: { screws: '#4 × {13} every {64}' },
      bestFor: 'Chest and bench lids, fold-down desks — carries the whole edge, so a slightly twisted lid still closes true.',
      failure: 'Cutting to length and leaving a half screw hole at the end — trim between holes and dress the cut with a file.'
    },
    soss_invisible: {
      key: 'soss_invisible', label: 'Invisible (Soss-type) hinge', price: 14,
      fronts: ['inset'], opening: 180, sizesByDoorT: { 13: '#101', 16: '#203', 19: '#204', 22: '#208' },
      capacityKgPair: 5, countRule: 'doorHinges',
      bestFor: 'Doors and folding panels that must show nothing, open or closed — barrels mortise fully into both members.',
      failure: 'Deep twin mortises leave thin walls in {16} stock — step up a stock thickness before stepping up a hinge size.'
    },
    knife_pivot: {
      key: 'knife_pivot', label: 'Knife (pivot) hinge', price: 16,
      fronts: ['inset'], opening: 180, reveal: 1.5, capacityKgPair: 8, countRule: 'pairOnly',
      boring: { gainDepth: 'one blade thickness (~2.4)', position: 'door top/bottom edge + case' },
      bestFor: 'The fine-furniture inset door — a sliver of brass at top and bottom and nothing else visible.',
      failure: 'They install DURING case assembly — a case glued up first cannot take straight knife hinges. Sequence or suffer.'
    },
    pivot_offset: {
      key: 'pivot_offset', label: 'Offset pivot hinge', price: 15,
      fronts: ['overlay', 'inset'], opening: 180, capacityKgPair: 12, countRule: 'pairOnly',
      bestFor: 'Overlay doors and mid-century-style pivots — hardware hides in the top and bottom rails of the case.',
      failure: 'All the load rides two points — through-bolt or hard-point the case panels, never screw into raw MDF edge.'
    },
    drop_leaf: {
      key: 'drop_leaf', label: 'Drop-leaf (rule joint) hinge', price: 7,
      fronts: ['special'], opening: 90, capacityKgPair: 10, countRule: 'ruleJoint',
      bestFor: 'Drop-leaf tables — the rule joint carries the raised leaf along its whole length; the hinge only steers (RULES.ruleJoint solves the geometry).',
      failure: 'Treating it like a butt hinge: the barrel needs its own deeper mortise, and the LONG leaf goes on the drop leaf.'
    },
    quadrant_stay: {
      key: 'quadrant_stay', label: 'Quadrant hinge with stop', price: 18,
      fronts: ['inset'], opening: 95, capacityKgPair: 3, countRule: 'pairOnly',
      bestFor: 'Jewelry and humidor lids — hinge plus built-in 95° stay in one small brass arc.',
      failure: 'The arc needs a curved mortise in BOTH lid and box wall — rout with the maker’s template, never freehand.'
    },
    butler_tray: {
      key: 'butler_tray', label: 'Butler tray hinge', price: 12,
      fronts: ['special'], opening: 90, capacityKgPair: 6, countRule: 'pairOnly',
      bestFor: 'Fold-flat tray tables and gallery-edged trays — leaves lie flat open and latch upright at 90°.',
      failure: 'Spring detents chew soft woods — hard shims under the leaves in pine and poplar trays.'
    },
    torsion_lid: {
      key: 'torsion_lid', label: 'Torsion lid-stay hinge', price: 22,
      fronts: ['special'], opening: 90, torqueClassesNm: [1.1, 2.3, 3.4, 4.5, 6.8], countRule: 'lidTorque',
      bestFor: 'Toy chests and bench lids — hinge and damped stay in one; the lid hangs wherever you leave it. The kidSafe answer.',
      failure: 'Under-torqued pairs let a heavy lid drift down — size by computed lid torque (RULES.lidStay), never by eye.'
    },
    strap_t: {
      key: 'strap_t', label: 'Strap / T-hinge', price: 8,
      fronts: ['overlay'], opening: 180, sizes: [150, 200, 300], capacityKgPair: 20, countRule: 'doorHinges', exterior: true,
      bestFor: 'Outdoor chests, gates, and rustic cabinet doors — long leaves spread load across weak or narrow stiles.',
      failure: 'Plain steel streaks tannin-rich woods (oak, cedar) black in the rain — go stainless or galvanized outdoors.'
    }
  };

  /* ---------------- §2 Pulls (LIVE on drawer fronts today) ------------
   * ctc: the industry center-to-center series — pick from it, never
   * invent a spacing (a spacing outside the series is a pull nobody can
   * ever replace). Boring: 5 mm through-holes, M4 machine screws,
   * screw length = front thickness + 6. */
  const PULL_CTC_SERIES = [64, 76, 96, 128, 160, 192, 224, 256, 305, 457];

  const PULLS = {
    bar_pull: {
      key: 'bar_pull', label: 'Bar pull', price: 6, holes: 2, boreDia: 5,
      bestFor: 'The modern default — length ≈ ⅓ of the front width, snapped into the CTC series.',
      failure: 'A spacing outside the 64…457 series is a pull nobody can ever replace — snap to the series.'
    },
    knob_round: {
      key: 'knob_round', label: 'Round knob', price: 3, holes: 1, boreDia: 5, diaRange: [25, 45],
      bestFor: 'Doors and small drawers — the default when a pull would crowd the front.',
      failure: 'One loose knob spins forever — a drop of thread-locker on the M4, never glue.'
    },
    knob_turned_wood: {
      key: 'knob_turned_wood', label: 'Turned wood knob', price: 2, holes: 1, boreDia: 12,
      bestFor: 'Shaker and country work — the knob the piece would grow on its own (TRADITIONAL.turned_knob to make it).',
      failure: 'The {12} tenon wedges from inside, wedge ACROSS the front’s grain — with it is a splitting jig.'
    },
    cup_pull: {
      key: 'cup_pull', label: 'Cup (bin) pull', price: 5, holes: 2, boreDia: 5, ctc: [76, 96], drawersOnly: true,
      bestFor: 'Drawers only — fingers curl up under the cup; the classic on apothecary and Shaker banks.',
      failure: 'A cup pull on a door is upside-down half the time — drawers only.'
    },
    ring_pull: {
      key: 'ring_pull', label: 'Ring / drop pull', price: 7, holes: 1, boreDia: 5,
      bestFor: 'Campaign and period pieces — folds flat so nothing snags.',
      failure: 'Backplate screws want pilot holes in hardwood — brass screws shear like cheese.'
    },
    edge_pull: {
      key: 'edge_pull', label: 'Edge pull', price: 8, holes: 0,
      bestFor: 'Handleless modern fronts — a finger ledge of aluminum let into the top edge; pairs with push-to-open.',
      failure: 'Screws enter the front’s top EDGE — pre-drill, this is end grain territory.'
    },
    flush_recessed: {
      key: 'flush_recessed', label: 'Recessed flush pull', price: 9, holes: 0,
      bestFor: 'Sliding doors and anything that passes another front — nothing proud of the face. Mandatory on bypass doors.',
      failure: 'The router mortise wants a template — freehand walls show through the finish forever.'
    },
    appliance_pull: {
      key: 'appliance_pull', label: 'Appliance pull', price: 22, holes: 2, boreDia: 5, ctc: [305, 457],
      bestFor: 'Big heavy fronts — pantry doors, refrigerator panels, workshop drawer banks.',
      failure: 'Past ~{500} of pull, through-bolt it — wood screws in 5 mm bores work loose under body weight.'
    },
    leather_pull: {
      key: 'leather_pull', label: 'Leather strap pull', price: 4, holes: 2, ctc: [64, 76, 96],
      bestFor: 'Warm, quiet, and shop-makeable — folds flat, never rattles (TRADITIONAL.leather_work).',
      failure: 'Finish washers or the screw heads saw the strap through in a year.'
    },
    none_touch: {
      key: 'none_touch', label: 'No hardware (push-to-open)', price: 6, holes: 0,
      bestFor: 'Handleless fronts via a magnetic touch latch — press to pop open.',
      failure: 'Needs a 2 to 3 mm front gap and a light front — past ~4 kg the pop-out spring loses.'
    }
  };

  /* ---------------- §3 Drawer slides (LIVE) --------------------------- */
  const SLIDES = {
    euro_roller: {
      key: 'euro_roller', label: 'Euro roller slides (pair)', price: 6, capacityKg: 22, extension: 0.75, softClose: false, sideClearMM: 12.7,
      bestFor: 'Utility and paint-grade drawers — cheap, forgiving of sloppy openings, self-closing bump at the end.',
      failure: 'Plastic wheels flat-spot under heavy static loads — keep them out of tool and dish drawers.'
    },
    side_bb_34: {
      key: 'side_bb_34', label: 'Side-mount ball-bearing slides (pair)', price: 14, capacityKg: 34, extension: 1.0, softClose: false, sideClearMM: 12.7,
      bestFor: 'The default — full extension, 75 lb class, tolerant of ±0.5 mm.',
      failure: 'Exactly {12.7} per side or it binds — 12.5 is not 12.7 (the audit already knows).'
    },
    side_bb_45: {
      key: 'side_bb_45', label: 'HD side-mount ball-bearing, soft-close (pair)', price: 22, capacityKg: 45, extension: 1.0, softClose: true, sideClearMM: 12.7,
      bestFor: 'Pot drawers, file drawers, shop banks — the 100 lb class with a damper.',
      failure: 'Wide drawers rack the slides before they overload them — past {750} wide, geometry is the limit, not capacity.'
    },
    undermount_45: {
      key: 'undermount_45', label: 'Undermount soft-close slides (pair)', price: 30, capacityKg: 45, extension: 1.0, softClose: true,
      clearances: { widthTotal: 27, heightMin: 19, bottomRecess: 12.7, bottomT: 12, backNotch: true },
      bestFor: 'Invisible running gear and full interior width — the fine-furniture and kitchen standard. The app builds the box to the slide.',
      failure: 'They forgive nothing: box width = opening − {27}, depth = slide length exactly, square within 0.5 mm.'
    },
    heavy_duty_100: {
      key: 'heavy_duty_100', label: 'Heavy-duty locking slides (pair)', price: 45, capacityKg: 100, extension: 1.0, softClose: false, sideClearMM: 12.7,
      bestFor: 'Workbench and vehicle drawers — lock-in/lock-out detents.',
      failure: 'The case, not the slide, fails first — {100} kg cantilevered wants screws into solid wood or through-bolts.'
    }
  };

  /* ---------------- §4 Lift & stay hardware (READY: awaits lids) ------ */
  const LIFTS = {
    gas_strut: {
      key: 'gas_strut', label: 'Gas strut', price: 9, forceClassesN: [50, 80, 100, 120, 150, 200], countRule: 'gasStrut',
      geometry: { strutLen: '≈ 0.6 × lid depth', stroke: '≈ 0.55 × extended length', mountFromHinge: '≈ 0.2 × lid depth' },
      bestFor: 'Top-opening chests, window-seat lids, lift-up flaps — constant assist, holds open at full extension.',
      failure: 'Oversized launches the lid; undersized won’t hold — size by the moment balance (RULES.gasStrut), buy adjustable when unsure.'
    },
    lid_stay_soft: {
      key: 'lid_stay_soft', label: 'Soft-down lid stay', price: 12, torqueClassesNm: [1.1, 2.3, 3.4, 4.5, 6.8], countRule: 'lidTorque',
      bestFor: 'Chest and toy-box lids — friction/damper arm that lowers the lid gently and holds any angle.',
      failure: 'Rated torque is PER STAY — a wide heavy lid needs one each end, and the pair’s sum must clear the computed torque with 25% margin.'
    },
    flap_lift_up: {
      key: 'flap_lift_up', label: 'Lift-up flap fitting (Aventos-class)', price: 60, countRule: 'powerFactor',
      variants: { HK: 'single flap swings up', HF: 'bi-fold, tall openings', HL: 'flap rises parallel', HS: 'up-and-over the top' },
      bestFor: 'Overhead doors that get out of the way — the app prints the power factor (kg × mm) on the BOM so you order the right mechanism.',
      failure: 'Bought by looks instead of power factor — the arms either can’t lift the door or slam it skyward.'
    },
    fall_flap_stay: {
      key: 'fall_flap_stay', label: 'Fall-flap (drop-front) stay', price: 10, countRule: 'pairOnly',
      bestFor: 'Secretary desks and bar cabinets — the flap drops to horizontal and the stays carry writing loads.',
      failure: 'Stays support, hinges locate: the flap ALSO needs a continuous or 3-hinge bottom edge, or it twists.'
    },
    tv_desk_lift: {
      key: 'tv_desk_lift', label: 'Lifting column (TV / sit-stand)', price: 180, capacityKg: 60,
      bestFor: 'Motorized TV cabinets and sit-stand desks — a purchased column; the app supplies the enclosure math.',
      failure: 'The cabinet must brace against the lift’s racking moment at full height — cross-panel or steel angle, per the racking score.'
    }
  };

  /* ---------------- §5 Catches, locks, shelf, table/bed, wall, feet --- */
  const CATCHES = {
    magnetic: { key: 'magnetic', label: 'Magnetic catch', price: 1.5, holdKg: 3, bestFor: 'The default door keeper — surface-mounts anywhere, strike plate on the door.' },
    rare_earth_cup: { key: 'rare_earth_cup', label: '{10} rare-earth magnet + cup + washer', price: 1.2, holdKg: 4, bestFor: 'Shop-fit invisible catch — magnet in a {10} bore in the case, washer or second magnet in the door.' },
    ball_catch: { key: 'ball_catch', label: '{8} ball catch', price: 2, holdKg: 3, bestFor: 'Inset doors on fine work — bores into the door edge, strike in the case; invisible when open.' },
    roller_catch: { key: 'roller_catch', label: 'Roller catch', price: 2, holdKg: 4, bestFor: 'Bigger doors and slightly out-of-true cases — the forgiving one.' },
    touch_latch: {
      key: 'touch_latch', label: 'Magnetic touch latch (push-to-open)', price: 6, holdKg: 2,
      bestFor: 'Handleless fronts — press to pop open. Needs a 2 to 3 mm gap.',
      failure: 'On tall or heavy fronts the pop-out spring loses — keep to fronts under ~4 kg.'
    },
    elbow_catch: { key: 'elbow_catch', label: 'Elbow catch', price: 2.5, holdKg: 5, bestFor: 'The inactive half of a door pair — hooks the fixed door to the case behind the active one.' },
    hook_eye: { key: 'hook_eye', label: 'Hook and eye', price: 1, holdKg: 5, bestFor: 'Rustic and utility latching, lids and gates — honest hardware in plain sight.' },
    bullet_catch: { key: 'bullet_catch', label: '{6} bullet catch', price: 1.5, holdKg: 1.5, bestFor: 'Small box lids and light doors — a spring pip in a drilled hole, nearly invisible.' }
  };

  const LOCKS = {
    half_mortise: {
      key: 'half_mortise', label: 'Half-mortise chest/drawer lock', price: 14,
      bestFor: 'Chests, drawers, and doors on period work — the lock body hides in the wood, only the keyhole shows.',
      failure: 'Cutting the mortise after assembly, upside down, in the dark — fit the lock to the drawer front BEFORE the box goes together.'
    },
    cam_lock: {
      key: 'cam_lock', label: '{19} cam lock', price: 4,
      bestFor: 'Utility security — office drawers, shop cabinets, mailbox-grade privacy.',
      failure: 'It is privacy, not security — say so on the plan and nobody is disappointed.'
    }
  };

  /* The 32 mm system, formalized on the existing 5 mm pin: rows at 32
   * pitch, 37 from the edges, 9 deep — the same 37 the cup-hinge plate
   * wants, because the 32 mm system is one system. */
  const SHELF_SUPPORT = {
    pin_5: { key: 'pin_5', label: '5 mm shelf pin', price: 0.25, holdKgEach: 10, boring: { dia: 5, depth: 9, pitch: 32, setback: 37 },
      bestFor: 'The 32 mm system — rows of {5} holes at {32} pitch, {37} from the edges; adjustable forever.' },
    sawtooth: { key: 'sawtooth', label: 'Sawtooth supports (shop-made)', price: 0,
      bestFor: 'The traditional adjustable system — see TRADITIONAL.sawtooth_supports; zero hardware, period-correct.' },
    standards: { key: 'standards', label: 'Steel shelf standards + clips', price: 4, holdKgEach: 20,
      bestFor: 'Utility shelving and closets — surface-mounted or let into {16} grooves; fast and strong.',
      failure: 'Standards let into grooves must all index from the SAME end of the case or the shelves rock forever.' }
  };

  const TABLE_BED = {
    z_clip: { key: 'z_clip', label: 'Z-clip (tabletop fastener)', price: 0.5,
      bestFor: 'Solid-top attachment that moves — clip screws to the top, tongue rides a {4} kerf in the apron; slot travel = the computed movement.' },
    corner_bracket: { key: 'corner_bracket', label: 'Steel corner bracket + M8 hanger bolt', price: 6,
      bestFor: 'Knockdown tables — legs come off with a wing nut; honestly rated below a mortise and tenon, but this one unbolts.',
      failure: 'The bracket needs kerfs in BOTH apron ends and a hanger bolt dead on the leg’s diagonal — 45° or it racks.' },
    equalizer_slides: { key: 'equalizer_slides', label: 'Table extension slides (pair)', price: 55, sizes: [660, 810, 970, 1070], crownMM: 3,
      bestFor: 'Extension dining tables — geared halves open evenly; built with a ~{3} crown that flattens under the leaves’ weight.',
      failure: 'Mounted dead flat they sag open — the crown bows UP at install, by design.' },
    table_pin: { key: 'table_pin', label: 'Tapered table alignment pin', price: 1.2,
      bestFor: 'Leaf-to-leaf registration — brass pin one edge, socket the other, two per joint minimum.' },
    draw_catch: { key: 'draw_catch', label: 'Table draw catch', price: 3.5,
      bestFor: 'Pulls extension halves tight so the seam disappears — one per leaf joint, centered.' },
    keyhole_bed: { key: 'keyhole_bed', label: 'Keyhole bed-rail fitting (pair)', price: 9,
      bestFor: 'The other knockdown bed answer — hooks drop over lag-screwed pins in the post; silent, tool-free.',
      failure: 'Pins must land in the post’s center third — edge-close pins split the post the first time someone sits hard.' }
  };

  const WALL_HANG = {
    keyhole_plate: { key: 'keyhole_plate', label: 'Keyhole plate', price: 0.8, holdKgEach: 10,
      bestFor: 'Small shelves, mirrors, coat racks — let flush into the back, opening DOWN, two per piece, level, on studs/anchors.' },
    flush_mount: { key: 'flush_mount', label: 'Flush-mount interlock (pair)', price: 2.5, holdKgPair: 30,
      bestFor: 'Heavier wall cabinets — two interlocking plates; lifts off like a cleat.' },
    cleat_ref: { key: 'cleat_ref', label: 'French cleat', price: 0,
      bestFor: 'Already in JOINERY (french_cleat) — the capacity king; every cleat lands on studs, per the existing wall-anchor rule.' }
  };

  const FEET_MISC = {
    rubber_foot_food: { key: 'rubber_foot_food', label: '{19} rubber foot + stainless screw', price: 0.6,
      bestFor: 'Cutting boards and butcher blocks — air under the board so it dries flat; screws enter from BELOW only (food-zone rule).' },
    felt_pad: { key: 'felt_pad', label: 'Felt pad', price: 0.15,
      bestFor: 'Anything that lives on a wood floor. One per corner. The cheapest insurance in the catalog.' },
    glide_nail: { key: 'glide_nail', label: 'Nail-on glide', price: 0.3,
      bestFor: 'Chairs and stools on hard floors — takes the scrape out of the daily drag.' },
    grommet_60: { key: 'grommet_60', label: '{60} desk grommet', price: 2.5, boring: { dia: 60 },
      bestFor: 'Desks and media consoles — the cable pass-through that keeps the back panel honest. Forstner or hole saw, back edge of the top.' }
  };

  /* ---------------- §6 The traditional layer (REFERENCE + LIVE rules) -
   * Shop-made replacements for everything above, each with real setout
   * numbers. Where movement matters they lean on BB.K.movementMM — the
   * drawer-fitting clearance is computed per species and climate, which
   * is exactly how a craftsman fits drawers, done by code. */
  const TRADITIONAL = {
    wooden_runners: {
      key: 'wooden_runners', label: 'Wooden runners, kickers & guides', replaces: 'drawer slides', level: 'intermediate',
      setout: [
        'Runner: {19} × {32} rail the drawer side rides on, glued/screwed level in the case.',
        'Kicker: the same rail ABOVE the drawer so it cannot tip open.',
        'Side clearance {1} per side; vertical clearance = drawer height × ct × ΔMC (computed per species and climate) + {1} floor.',
        'Wax the meeting surfaces with paraffin; quartersawn sides move half as much.'
      ],
      bestFor: 'Every drawer in furniture history before 1950 — silent, serviceable, and free.',
      failure: 'Fitting drawers tight in July or loose in January — the clearance is a computed number, not a feel.'
    },
    side_hung: {
      key: 'side_hung', label: 'Side-hung drawer', replaces: 'drawer slides', level: 'advanced',
      setout: ['Groove in the drawer side: {6} deep × {13} tall, at mid-height.',
        'Hardwood runner strip {12} × {12} screwed + glued to the case side, {0.5} vertical play.',
        'Groove stops {19} short of the drawer front so it never shows.'],
      bestFor: 'Cases with thin sides or no front rails — the drawer hangs on its own grooves; classic in Krenov-school work.',
      failure: 'Runner and groove cut from different reference faces — index both off the case bottom or the drawer smiles.'
    },
    center_runner: {
      key: 'center_runner', label: 'Center runner & slip', replaces: 'drawer slides', level: 'intermediate',
      setout: ['{19} × {32} rail under the drawer centerline; grooved guide block on the drawer bottom rides it.',
        'Front edge flush with the rail below the opening; wax.'],
      bestFor: 'Small and mid drawers — one rail keeps the box tracking dead straight with almost no fitting.',
      failure: 'Skipping the kicker above — a center-run drawer noses down hard when pulled far.'
    },
    sliding_doors_grooved: {
      key: 'sliding_doors_grooved', label: 'Grooved sliding doors', replaces: 'hinges + slides', level: 'intermediate',
      setout: ['Top groove depth = 2 × bottom groove depth + {1}: typically {11} top, {5} bottom in {19} case stock.',
        'Door height = opening + bottom depth + {1} — lift into the top groove, drop into the bottom.',
        'Groove width = door thickness + {1}; two tracks {3} apart; doors overlap {25} to {40}.',
        'Pulls must be flush (flush_recessed) — anything proud collides with the passing door.'],
      bestFor: 'Bookcase and record-cabinet doors, Japanese-style cases — no swing space needed, no hardware bought.',
      failure: 'Equal top and bottom grooves — the door that cannot lift in cannot ever come out.'
    },
    tambour: {
      key: 'tambour', label: 'Tambour door', replaces: 'lift/roll-up hardware', level: 'advanced',
      setout: ['Slats ~{9} thick × {20} to {40} face, backs glued to canvas (end tongues left dry).',
        'Track groove = slat tongue + {1} wide × {11} deep, routed in both case sides from ONE template.',
        'Minimum track radius ≥ 2.5 × slat face width. Lead slat is a stiffer lift rail with the pull.',
        'Wax the track; finish slats BEFORE gluing the canvas.'],
      bestFor: 'Roll-tops, appliance garages, media cabinets — the door disappears into the case.',
      failure: 'A curve tighter than the slats can turn — the radius rule is the whole game; template both sides identically.'
    },
    wooden_knuckle_hinge: {
      key: 'wooden_knuckle_hinge', label: 'Wooden knuckle (finger) hinge', replaces: 'butt/piano hinges', level: 'advanced',
      setout: ['Interlocking fingers on both parts, odd count (3 or 5), {0.5} side play.',
        'Barrel diameter ≈ stock thickness; {6} brass rod pin through all knuckles.',
        'Round the knuckles to the pin center or the joint binds at 90°. Grain runs ALONG the barrel.'],
      bestFor: 'Screens, box lids, fold-flat stands — furniture with no metal anywhere.',
      failure: 'Short grain across a knuckle — one dropped lid shears it; orient grain along the barrel, always.'
    },
    pivot_pin_hinge: {
      key: 'pivot_pin_hinge', label: 'Pivot-pin door', replaces: 'butt/knife hinges', level: 'intermediate',
      setout: ['{6} to {8} brass or steel pin into the door’s top and bottom edges, into case bores.',
        'Pin axis set in from the hinge edge ≥ door t/2 + {2}; round the hinge edge to radius = axis-to-back-edge distance so it clears in swing.',
        'UHMW or brass washer under the bottom pin — the door floats on it.'],
      bestFor: 'Inset doors and mid-century pivots with two dots of brass as the only hardware.',
      failure: 'Square hinge edge + offset pin = a door that jams at 30° — the edge radius is not optional.'
    },
    rule_joint_ref: {
      key: 'rule_joint_ref', label: 'Rule joint (drop leaf)', replaces: 'plain hinged leaf', level: 'advanced',
      setout: ['Roundover on the top, matching cove on the leaf; fillet ≥ {5}.',
        'Pin center at the roundover arc center, nudged ~{1} toward the edge; pin sits ~{3} above the underside (half the barrel).',
        'radius = top thickness − fillet − pin height (RULES.ruleJoint solves it).',
        'Hinges {75} to {100} from each end, then every ~{250}; install with a veneer-thickness spacer in the joint.'],
      bestFor: 'Drop-leaf tables — the raised leaf bears on the wood along its whole length, not on screws.',
      failure: 'Pin below the arc center: the leaf binds going down and gaps going up. The geometry is the joint.'
    },
    knuckle_swing_arm: {
      key: 'knuckle_swing_arm', label: 'Knuckle-joint swing arm', replaces: 'metal leaf supports', level: 'advanced',
      setout: ['A wooden knuckle hinge built into the apron: the outer section swings 90° out under the raised leaf.',
        'Stop shoulder at 90°; arm reaches ≥ 40% of the leaf width.'],
      bestFor: 'Period drop-leaf tables — the support IS the apron; nothing to buy, nothing to see.',
      failure: 'An arm that stops short of 40% lets the leaf lever the joint apart — reach matters more than strength.'
    },
    sawtooth_supports: {
      key: 'sawtooth_supports', label: 'Sawtooth shelf supports', replaces: 'shelf pins/standards', level: 'intermediate',
      setout: ['Four vertical strips with matching 45° sawtooth notches at {25} pitch, cut in one gang.',
        'Shelf-end cleats drop into the teeth; shelf length = opening − 2 × strip thickness.'],
      bestFor: 'Adjustable shelving in traditional casework — infinitely serviceable, period-correct, free.',
      failure: 'Strips cut in separate setups never line up — gang-cut all four or the shelves rock.'
    },
    turn_button: {
      key: 'turn_button', label: 'Turn button (spinner)', replaces: 'catches', level: 'beginner',
      setout: ['Hardwood button ~{19} × {50}, pivot screw + washer through the center, {1} clearance to the door face.'],
      bestFor: 'Cupboard doors, dust panels, jig storage — the catch a child understands and nobody breaks.',
      failure: 'Overtightening the pivot — it should spin with two fingers and stay put with one.'
    },
    wooden_spring_catch: {
      key: 'wooden_spring_catch', label: 'Wooden spring catch', replaces: 'ball/roller catches', level: 'advanced',
      setout: ['Thin springy strip (ash/hickory) with a pip that snaps into a strike notch; feathered to ~{3} at the flex.'],
      bestFor: 'All-wood boxes and cabinets — a soft click with zero metal.',
      failure: 'A pip too proud doubles as a lock — {1.5} engagement is plenty.'
    },
    turned_knob: {
      key: 'turned_knob', label: 'Turned/shop-made knob', replaces: 'bought knobs', level: 'intermediate',
      setout: ['{12} tenon, glued into a {12} bore and wedged from inside the front, wedge across the front’s grain.'],
      bestFor: 'Knobs from the project’s own offcuts — grain-matched hardware money cannot buy.',
      failure: 'Wedge aligned WITH the front’s grain — that’s a splitting jig, not a knob.'
    },
    carved_scoop: {
      key: 'carved_scoop', label: 'Carved finger scoop', replaces: 'pulls', level: 'intermediate',
      setout: ['Scooped recess ~{100} × {25}, max depth = HALF the front thickness, centered or in the top rail zone.'],
      bestFor: 'Sculpted modern fronts — the pull is subtraction, not addition.',
      failure: 'Scooping past half the thickness telegraphs a shadow through — or a hole.'
    },
    cutout_handle: {
      key: 'cutout_handle', label: 'Cutout handhold', replaces: 'pulls', level: 'beginner',
      setout: ['{100} × {30} slot, {15} corner radii, ≥ {40} from every edge; ease both faces heavily.'],
      bestFor: 'Shop furniture, crates, step stools, kids’ pieces — grab it anywhere with gloves on.',
      failure: 'A cutout near an edge is a crack starter — the {40} margin is structural, not aesthetic.'
    },
    finger_groove: {
      key: 'finger_groove', label: 'Finger groove (J-pull)', replaces: 'edge pulls', level: 'intermediate',
      setout: ['{15} cove bit under the drawer lip or along the door edge, full width, BEFORE assembly.'],
      bestFor: 'Handleless fronts in solid wood — the routed shadow line IS the handle.',
      failure: 'Routing after assembly — the climb-cut at the stile ends tears out; machine the parts, then build.'
    },
    leather_work: {
      key: 'leather_work', label: 'Leather pulls & hinges', replaces: 'pulls / light hinges', level: 'beginner',
      setout: ['Pulls: {75} × {20} strap folded, two #8 screws + finish washers.',
        'Hinges: {40} wide straps, three screws per leaf — LIGHT lids only (camp boxes, toy crates).'],
      bestFor: 'Warm, silent, cheap, and replaceable in ten minutes forever.',
      failure: 'Leather hinges on a heavy lid stretch into a sad smile — hardware for weight, leather for charm.'
    },
    cord_stay: {
      key: 'cord_stay', label: 'Cord / chain lid stop', replaces: 'lid stays (NOT for toy chests)', level: 'beginner',
      setout: ['Anchor at distance d down the box side and d out the lid; cord length L = 2 × d × sin(max angle ÷ 2).',
        'Stainless screws + washers; leave {10} slack out of the pinch line.'],
      bestFor: 'Blanket chests and site boxes — the honest stop that costs a shoelace.',
      failure: 'It stops, it does not SUPPORT — a falling lid still falls. NEVER the answer on a toy chest (GATES.kidSafe).'
    }
  };

  /* ---------------- §7 Selection rules — pure functions ---------------
   * Deterministic, provenance-ready arithmetic. The model never picks
   * hardware quantities or ratings; code does. Weights come from
   * geometry × SG, which the app already owns. */
  const GRAV = 9.81;

  /* Panel weight (kg) from code-owned dimensions and species SG. */
  function panelWeightKg(wMM, hMM, tMM, speciesKey) {
    const sp = BB.K.WOOD_SPECIES[speciesKey] || BB.K.WOOD_SPECIES.pine;
    return wMM * hMM * tMM * 1e-9 * sp.sg * 1000;
  }

  /* Door hinge count = max(height band, weight rule).
   * Height bands: ≤900 → 2, ≤1600 → 3, ≤2000 → 4, else 5.
   * Weight: ceil(kg / 3.5), floor 2 (Blum-class chart floor). */
  function doorHingeCount(doorHMM, doorKg) {
    const band = doorHMM <= 900 ? 2 : doorHMM <= 1600 ? 3 : doorHMM <= 2000 ? 4 : 5;
    return Math.max(band, Math.max(2, Math.ceil(doorKg / 3.5)));
  }

  /* Cup-hinge boring distance solved FROM the designed overlay (straight
   * arm, 0-plate anchor: overlay ≈ TB + 11 − plateHeight). Returns the
   * clamped TB and whether the design needs a different plate/crank
   * instead of a wilder bore. */
  function cupBoring(overlayMM, plateHeightMM) {
    const b = HINGES.euro_cup.boring;
    const raw = overlayMM - 11 + (plateHeightMM || 0);
    const tb = Math.min(b.tbMax, Math.max(b.tbMin, Math.round(raw * 10) / 10));
    return { tbMM: tb, inRange: raw >= b.tbMin && raw <= b.tbMax, cupDia: b.cupDia, cupDepth: b.cupDepth, plateSetback: b.plateSetback };
  }

  /* Gas strut moment balance: F_total = 1.3 × W·g × (Lcg / d),
   * d defaulting to 0.2 × lid depth and Lcg to half the depth — which
   * collapses to ≈ 3.25 × lid weight at defaults. Split across two
   * struts on lids wider than 600; snap UP into the force classes. */
  function gasStrut(lidKg, lidDepthMM, lidWidthMM, opts) {
    opts = opts || {};
    const d = opts.mountMM || 0.2 * lidDepthMM;
    const lcg = opts.cgMM || lidDepthMM / 2;
    const n = lidWidthMM > 600 ? 2 : 1;
    const perStrut = 1.3 * lidKg * GRAV * (lcg / d) / n;
    const cls = LIFTS.gas_strut.forceClassesN.find(c => c >= perStrut) ||
      LIFTS.gas_strut.forceClassesN[LIFTS.gas_strut.forceClassesN.length - 1];
    return { count: n, requiredNEach: Math.round(perStrut * 10) / 10, classN: cls, over: perStrut > cls };
  }

  /* Lid stay torque: T = W·g × Dcg (N·m); the summed stay rating must
   * clear it with 25% margin; wide lids take one stay per end. */
  function lidStay(lidKg, cgDistMM, lidWidthMM) {
    const T = lidKg * GRAV * (cgDistMM / 1000);
    const n = lidWidthMM > 600 ? 2 : 1;
    const perStay = 1.25 * T / n;
    const cls = LIFTS.lid_stay_soft.torqueClassesNm.find(c => c >= perStay) ||
      LIFTS.lid_stay_soft.torqueClassesNm[LIFTS.lid_stay_soft.torqueClassesNm.length - 1];
    return { count: n, requiredNmTotal: Math.round(T * 100) / 100, classNmEach: cls, over: perStay > cls };
  }

  /* Flap power factor, printed on the BOM for ordering. */
  const powerFactor = (doorKg, doorHMM) => Math.round(doorKg * doorHMM);

  /* Pull sizing: CTC ≈ frontWidth / 3 snapped DOWN into the series
   * (floor 64); fronts over 750 take two pulls at the ⅓ and ⅔ points.
   *
   * Narrow fronts: a style with its OWN CTC series (cup pulls, leather
   * straps) is made for narrow drawers and stays style-true down to its
   * smallest spacing plus finger room; a generic 2-hole style under 300
   * reads better as a knob (or a bar pull when there's still real width).
   * A substitution is carried on the result (`substituted: true`, with
   * `style` = what is actually fitted) so the BOM, the steps, and the
   * validation advisory all stay honest about it — the label and the bore
   * count can never disagree again. Zero-hole styles (edge, flush,
   * push-to-open) pass through with holes: 0 — their install is a mortise
   * or edge screws, never a centered bore. */
  function pullSpec(frontWMM, styleKey) {
    const style = PULLS[styleKey] || PULLS.bar_pull;
    if (style.holes <= 1) {
      return { style: style.key, count: 1, ctcMM: 0, holes: style.holes };
    }
    const series = style.ctc || PULL_CTC_SERIES;
    const minFront = series[0] + 44; // smallest CTC + finger room both ends
    const narrow = style.ctc ? frontWMM < minFront : frontWMM < 300;
    if (narrow) {
      const sub = pullSpec(frontWMM, frontWMM >= 300 ? 'bar_pull' : 'knob_round');
      sub.substituted = true;
      return sub;
    }
    const target = frontWMM / 3;
    let ctc = series[0];
    for (const c of series) if (c <= target) ctc = c;
    if (frontWMM > 750) {
      return { style: style.key, count: 2, ctcMM: Math.max(ctc, 96), holes: 4, note: 'two pulls at the 1/3 and 2/3 points, one shared centerline' };
    }
    return { style: style.key, count: 1, ctcMM: ctc, holes: 2 };
  }
  const pullScrewLenMM = frontT => Math.round(frontT + 6);

  /* Slide picker: by computed load, ask, and fit. The 34 kg class stays
   * the default; heavier computed loads climb the family. */
  function slidePick(loadKg, opts) {
    opts = opts || {};
    if (opts.heavyDuty || loadKg > 45) return SLIDES.heavy_duty_100;
    if (opts.undermount) return SLIDES.undermount_45;
    if (loadKg > 25 || opts.softClose) return SLIDES.side_bb_45;
    if (opts.utility && loadKg <= 15) return SLIDES.euro_roller;
    return SLIDES.side_bb_34;
  }

  /* Rule joint geometry: radius = top thickness − fillet − pin height;
   * fillet ≥ 5, pin ≈ 3 above the underside (half the barrel), pin
   * center nudged 1 mm outboard of the arc center. */
  function ruleJoint(topTMM, filletMM) {
    const fillet = Math.max(5, filletMM || 5);
    const pinH = 3;
    const r = Math.max(0, topTMM - fillet - pinH);
    return { radiusMM: r, filletMM: fillet, pinHeightMM: pinH, pinNudgeMM: 1, workable: r >= 6 };
  }

  /* Wooden-runner drawer fitting: the vertical clearance IS the computed
   * seasonal movement of the drawer side, plus a 1 mm floor. */
  function drawerVerticalClearance(drawerHMM, speciesKey, dMC) {
    const mv = BB.K.movementMM(drawerHMM, speciesKey, 'tangential', dMC);
    return Math.max(1.5, Math.round((mv + 1) * 10) / 10);
  }

  /* ---------------- §8 Safety gates (data for validation) -------------
   * kidSafe is live the day a lid exists; foodZone the day a cutting
   * surface exists; outdoorHardware is live NOW (species + finish). */
  const GATES = {
    kidSafe: {
      basis: 'ASTM F963 toy-chest lid support, latch, and ventilation provisions',
      requiredLidSupport: ['torsion_lid', 'lid_stay_soft'],
      refusedLidSupport: ['cord_stay'],
      noAutoLatch: true,
      ventilationMM: 12
    },
    foodZone: {
      basis: 'FDA 21 CFR 175.105 (glue, cured) + food-contact finish rows',
      noMetalInCuttingZone: true, feetScrewFromBelow: true,
      glue: 'pva_waterproof', finishes: ['mineral_oil', 'board_butter', 'tung_pure']
    },
    outdoorHardware: {
      finishes: ['stainless', 'brass', 'galvanized'],
      tannicSpecies: ['red_oak', 'white_oak', 'western_red_cedar', 'hickory'],
      note: 'Plain steel streaks tannin-rich woods black in the rain.'
    }
  };

  /* ---------------- §9 Digest (one generated line, style keys only) --- */
  function digestLine() {
    return 'HARDWARE STYLES (quantities/ratings computed by code): pulls={' +
      Object.keys(PULLS).join(',') + '} runners per RUN enum; slides sized by load.';
  }

  BB.HW = {
    HINGES, PULLS, PULL_CTC_SERIES, SLIDES, LIFTS, CATCHES, LOCKS,
    SHELF_SUPPORT, TABLE_BED, WALL_HANG, FEET_MISC, TRADITIONAL, GATES,
    panelWeightKg, doorHingeCount, cupBoring, gasStrut, lidStay, powerFactor,
    pullSpec, pullScrewLenMM, slidePick, ruleJoint, drawerVerticalClearance,
    digestLine
  };
})();
