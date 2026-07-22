/* Blueprint Buddy — fastener & joinery-detail engine (audit F-S3-1).
 *
 * Professional plans say WHERE the screws go and how thick the tenon is, not
 * just how many screws to buy. This module derives, per model joint:
 *   - fastener rows (kind, catalog spec, pilot Ø, positions along the joint
 *     run with edge distances respected),
 *   - tenon / dado / rabbet / dovetail setout where the joint type calls
 *     for one (thickness ≈ member/3 snapped to chisel sizes, lengths from
 *     Plans.jointAllowance so cut list and setout can never disagree),
 *   - a one-line human setout for assembly steps, and a detail table for the
 *     print sheet. BOM screw counts come from here, so the shopping list and
 *     the drilling instructions always match.
 *
 * Edge-distance and spacing rules (audit F-S3-5) are exported as RULES and
 * enforced by construction: positions are generated inside them.
 */
var BB = globalThis.BB = globalThis.BB || {};

(function () {
  'use strict';
  const K = BB.K;
  const U = () => BB.Units;

  /* Screw placement rules for furniture-scale joints:
   * edge/end distance ≥ 20 mm (≈ 5 shank diameters for a #8, and comfortably
   * past the 10 mm splitting minimum), spacing between fasteners 32–160 mm. */
  const RULES = { edgeMM: 20, minSpacingMM: 32, maxSpacingMM: 160 };
  const CHISELS = [6, 8, 10, 12];           // tenon thickness snap (mm)
  const DOWEL_DIAMETERS = [6, 8, 10, 12];   // fluted dowel stock (mm)

  const snapTo = (v, table) => table.reduce((best, t) => Math.abs(t - v) < Math.abs(best - v) ? t : best, table[0]);
  const minDim = p => Math.min(p.size.w, p.size.h, p.size.d);

  /* AABB overlap run: the joint's working length is the largest axis overlap
   * between the two parts (axis-aligned; rotated custom parts use their
   * world-extent boxes, which is the honest approximation for a setout line). */
  function jointRun(a, b) {
    const box = p => {
      const e = BB.Geo.worldExtents(p);
      return {
        min: [p.pos.x - e.x / 2, p.pos.y - e.y / 2, p.pos.z - e.z / 2],
        max: [p.pos.x + e.x / 2, p.pos.y + e.y / 2, p.pos.z + e.z / 2]
      };
    };
    const A = box(a), B = box(b);
    let best = 0, axis = 0;
    for (let i = 0; i < 3; i++) {
      const ov = Math.min(A.max[i], B.max[i]) - Math.max(A.min[i], B.min[i]);
      if (ov > best) { best = ov; axis = i; }
    }
    return { runMM: Math.max(0, best), axis: ['width', 'height', 'depth'][axis] };
  }

  /* Evenly spaced positions inside the edge-distance rules. `spacing`
   * overrides the default max spacing (figure-8s ride at ~300 mm). */
  function positions(runMM, want, spacing) {
    const maxSp = spacing || RULES.maxSpacingMM;
    const usable = Math.max(0, runMM - 2 * RULES.edgeMM);
    if (usable <= 0) return runMM > 0 ? [runMM / 2] : [];
    let n = Math.max(want || 2, Math.ceil(usable / maxSp) + 1);
    // spacing floor: drop fasteners until they are at least minSpacing apart
    while (n > 2 && usable / (n - 1) < RULES.minSpacingMM) n--;
    if (usable < RULES.minSpacingMM && n > 2) n = 2;
    const out = [];
    for (let i = 0; i < n; i++) out.push(Math.round((RULES.edgeMM + (n === 1 ? usable / 2 : usable * i / (n - 1))) * 10) / 10);
    return out;
  }

  /* Screw path across a butt joint (audit FE-C2): the contact axis is the
   * axis of LEAST overlap (that's where the faces meet); each part's extent
   * along it is the wood the screw crosses on that side. Interpenetrating
   * joints (notched shelves, housings) have no clean face pair — fall back
   * to the attached member's thinnest dimension with real depth beyond. */
  function contactPaths(a, b) {
    const ext = p => { const e = BB.Geo.worldExtents(p); return [e.x, e.y, e.z]; };
    const A = ext(a), B = ext(b);
    const ca = [a.pos.x, a.pos.y, a.pos.z], cb = [b.pos.x, b.pos.y, b.pos.z];
    let axis = 0, minOv = Infinity;
    for (let i = 0; i < 3; i++) {
      const ov = Math.min(ca[i] + A[i] / 2, cb[i] + B[i] / 2) - Math.max(ca[i] - A[i] / 2, cb[i] - B[i] / 2);
      if (ov < minOv) { minOv = ov; axis = i; }
    }
    if (minOv > 2) return { pathA: minDim(a), pathB: 1000, housed: true, axis };
    return { pathA: A[axis], pathB: B[axis], housed: false, axis };
  }

  /* One decision for every plain wood screw: which member it enters through,
   * the longest catalog length that stays inside the wood (never out a show
   * face), and a counterbore when the entry member is so thick the thread
   * would barely reach the mate. Lengths are the buyable #8 ladder. */
  const SCREW_LENGTHS = [16, 25, 32, 38, 50, 64];
  function screwPlan(a, b, baseLen) {
    const { pathA, pathB, housed } = contactPaths(a, b);
    let thru = a, into = b, thruT = pathA, deepT = pathB;
    if (!housed) {
      if (pathA <= 64) { /* screw through the attached member */ }
      else if (pathB <= 64) { thru = b; into = a; thruT = pathB; deepT = pathA; }
      else { thruT = minDim(a); deepT = 1000; }
    }
    const cap = thruT + deepT - 3;
    let li = SCREW_LENGTHS.indexOf(baseLen);
    if (li < 0) li = SCREW_LENGTHS.length - 1;
    while (li > 0 && SCREW_LENGTHS[li] > cap) li--;
    let len = SCREW_LENGTHS[li];
    // thin bite: first try one size up, then counterbore the entry member
    let counterboreMM = 0;
    if (len - thruT < 8) {
      if (li + 1 < SCREW_LENGTHS.length && SCREW_LENGTHS[li + 1] <= cap) len = SCREW_LENGTHS[++li];
      if (len - thruT < 8 && deepT >= 12) {
        const target = Math.min(deepT - 4, 16);
        let c = Math.ceil(thruT + target - len);
        c = Math.max(0, Math.min(c, Math.floor(thruT / 2)));
        if (c >= 4) counterboreMM = c;
      }
    }
    return {
      len, counterboreMM, thru, into,
      biteMM: Math.round((len - (thruT - counterboreMM)) * 10) / 10,
      pilotMM: len >= 50 ? 3.2 : 2.8,
      // The NEAR member gets a shank clearance hole (audit M-04): a #8 shank
      // is ~4.2 mm — the screw must spin free on its side of the joint line
      // or the two parts jack apart instead of drawing tight.
      clearanceMM: 4.5,
      spec: `#8 × {${len}} wood screw`,
      housed
    };
  }

  const CATALOG = {
    butt_screw: { spec: '#8 × {50} wood screw', pilotMM: 3.2 },
    case_screw: { spec: '#8 × {32} wood screw', pilotMM: 2.8 },
    pocket: { spec: '{32} coarse pocket screw', pilotMM: 9.5 }, // the jig's 3/8 in stepped bit
    pocket_63: { spec: '{63} coarse pocket screw', pilotMM: 9.5 }, // 2× stock — a 32 cannot join 38 (K.FASTENERS)
    front_screw: { spec: '#8 × {25} wood screw', pilotMM: 2.8 },
    figure8: { spec: 'figure-8 fastener + #8 × {16}', pilotMM: 2.8 },
    /* 2026 expansion */
    biscuit: { spec: '#20 biscuit', pilotMM: 0 },
    loose_tenon: { spec: '{8} × {22} × {50} loose tenon', pilotMM: 8 },
    kd_bolt: { spec: 'M6 × {50} furniture bolt + barrel nut', pilotMM: 7 }, // 7 mm bolt bore; 10 mm barrel bore
    spline: { spec: '{6} plywood spline', pilotMM: 0 }
  };
  const DADO_WIDTHS = [6, 10, 13, 19]; // dado-stack / box-joint finger snap (mm)
  const fmtSpec = c => U().fmtTemplate(c.spec);

  /* ---------------- the per-joint layout ---------------- */
  function layoutForJoint(spec, model, joint) {
    const byId = new Map(model.parts.map(p => [p.id, p]));
    const a = byId.get(joint.a), b = byId.get(joint.b);
    if (!a || !b) return null;
    const { runMM } = jointRun(a, b);
    const memberT = minDim(a);            // inserted / attached member
    const mateT = minDim(b);              // the part it lands in
    const type = joint.type;
    const out = { joint, type, a, b, runMM, fasteners: [], text: '' };
    const fine = mm => U().fmtSmall(mm);
    const len = mm => U().fmtLength(mm);
    const drill = mm => U().fmtDrill(mm); // pilots/bores: real bit sizes (audit M-01)

    /* Floating hardware is only for tops that SIT ON their base (vertical
     * contact — aprons, rails, side top edges). A top CAPTURED between case
     * sides (horizontal contact) is fixed casework: it takes the case
     * joinery like the bottom, and it moves with the sides (audit FE-H1). */
    const isTopAttach = (a.role === 'top' || a.role === 'seat') &&
      !(K.WOOD_SPECIES[a.material] && K.WOOD_SPECIES[a.material].sheet) &&
      ['apron', 'side', 'rail'].includes(b.role) &&
      contactPaths(a, b).axis === 1;

    if (isTopAttach) {
      // Solid tops are floated: figure-8s roughly every 300 mm of run.
      const pos = positions(runMM, Math.max(2, Math.round(runMM / 300)), 300);
      const c = CATALOG.figure8;
      for (const p of pos) out.fasteners.push({ kind: 'figure8', spec: fmtSpec(c), pilotMM: c.pilotMM, alongMM: p, edgeMM: Math.min(p, runMM - p) });
      out.text = `${out.fasteners.length} figure-8 fasteners along the ${b.name.toLowerCase()}, ${len(RULES.edgeMM)} in from each end — pilot ${drill(c.pilotMM)}, and let the top move.`;
      return out;
    }

    switch (type) {
      case 'butt_screws': {
        const baseLen = a.group !== 'frame' || b.group !== 'frame' ? 25 : (runMM > 400 ? 32 : 50);
        const sp = screwPlan(a, b, baseLen);
        const specTxt = U().fmtTemplate(sp.spec);
        const pos = positions(runMM, 2);
        for (const p of pos) out.fasteners.push({ kind: 'screw', spec: specTxt, pilotMM: sp.pilotMM, clearanceMM: sp.clearanceMM, counterboreMM: sp.counterboreMM, alongMM: p, edgeMM: Math.min(p, runMM - p) });
        const spacing = pos.length === 1 ? 'centered on the run'
          : `first ${len(RULES.edgeMM)} from each end${pos.length > 2 ? `, then every ${len(Math.round((runMM - 2 * RULES.edgeMM) / (pos.length - 1)))}` : ''}`;
        const where = sp.housed ? `centered ${fine(mateT / 2)} from the joint line`
          : sp.thru === a ? `on the ${a.name.toLowerCase()}'s centerline`
            : `centered ${fine(minDim(a) / 2)} from the joint line`;
        // The full drilling schedule (audit M-04): clearance through the near
        // member (the screw must spin free there to DRAW the joint tight),
        // pilot in the mate, and a countersink so the flat head seats —
        // or the counterbore when the entry member is thick.
        const draw = sp.counterboreMM
          ? ` Counterbore ${len(10)} Ø × ${len(sp.counterboreMM)} deep first, ${drill(sp.clearanceMM)} clearance through the rest of the ${sp.thru.name.toLowerCase()} — the thread bites ${len(sp.biteMM)} into the ${sp.into.name.toLowerCase()}.`
          : ` Drill ${drill(sp.clearanceMM)} clearance through the ${sp.thru.name.toLowerCase()} and countersink so the head seats flush — the screw must spin free in the near member to draw the joint tight.`;
        out.text = `${pos.length} × ${specTxt} through ${sp.thru.name.toLowerCase()} into ${sp.into.name.toLowerCase()}: ${spacing}, ${where}. Pilot ${drill(sp.pilotMM)} into the ${sp.into.name.toLowerCase()}.${draw}`;
        break;
      }
      case 'pocket_screws': {
        // 2× (38 mm) stock needs the long jig setting and its own screw —
        // the 32 mm pocket screw physically cannot join it (audit FE-H7).
        const c = memberT >= 36 ? CATALOG.pocket_63 : CATALOG.pocket;
        const pos = positions(runMM, 2);
        for (const p of pos) out.fasteners.push({ kind: 'pocket', spec: fmtSpec(c), pilotMM: c.pilotMM, alongMM: p, edgeMM: Math.min(p, runMM - p) });
        out.text = `${pos.length} pocket holes on the hidden face of ${a.name.toLowerCase()}, ${len(RULES.edgeMM)} in from each end — jig set for ${len(memberT)} stock, ${fmtSpec(c)}s.`;
        break;
      }
      case 'dowels': {
        const dia = snapTo(Math.max(6, memberT * 0.4), DOWEL_DIAMETERS);
        const want = Math.max(2, Math.min(4, Math.floor(runMM / (dia * 8))));
        // dowel edge distance: 2 diameters; spacing ≥ 3 diameters
        const usable = Math.max(0, runMM - 2 * (2 * dia));
        let n = Math.min(want, Math.max(2, Math.floor(usable / (3 * dia)) + 1));
        const pos = [];
        for (let i = 0; i < n; i++) pos.push(Math.round((2 * dia + (n === 1 ? usable / 2 : usable * i / (n - 1))) * 10) / 10);
        for (const p of pos) out.fasteners.push({ kind: 'dowel', spec: `${U().fmtLength(dia)} × ${U().fmtLength(dia === 6 ? 30 : dia === 8 ? 40 : 50)} fluted dowel`, pilotMM: dia, diaMM: dia, alongMM: p, edgeMM: Math.min(p, runMM - p) });
        out.text = `${n} × ${len(dia)} dowels on the joint centerline, first ${len(2 * dia)} from each edge (2Ø), spaced ≥ ${len(3 * dia)} (3Ø) — drill both parts from the same reference face, ${len(dia)} bit.`;
        break;
      }
      case 'mortise_tenon': {
        const allowance = BB.Plans ? BB.Plans.jointAllowance('mortise_tenon', mateT) : Math.min(30, Math.max(0, mateT - 6));
        const thick = snapTo(Math.max(6, memberT / 3), CHISELS.filter(c2 => c2 <= Math.max(6, memberT - 8)));
        const memberH = [a.size.w, a.size.h, a.size.d].sort((x, y) => y - x)[1]; // the member's width at the joint
        const shoulder = 6;
        const width = Math.max(10, Math.round(memberH - 2 * shoulder));
        out.tenon = { thicknessMM: thick, lengthMM: allowance, widthMM: width, shoulderMM: shoulder };
        out.text = `Tenon ${len(thick)} thick (≈ ⅓ of the ${len(memberT)} member, chisel size) × ${len(width)} wide × ${len(allowance)} long, ${len(shoulder)} shoulders; mortise ${len(allowance)} deep into the ${len(mateT)} ${b.name.toLowerCase()}, walls ≥ ${len(Math.max(0, Math.round((mateT - thick) / 2)))}.` + (width > 80 ? ' Haunch or split tenons this wide.' : '');
        break;
      }
      case 'dado': case 'rabbet': case 'locking_rabbet': {
        const depth = BB.Plans ? BB.Plans.jointAllowance(type, mateT) : Math.min(6, Math.floor(mateT / 3));
        out.dado = { depthMM: depth, widthMM: memberT };
        out.text = type === 'dado'
          ? `Dado ${len(memberT)} wide × ${len(depth)} deep (⅓ of the ${len(mateT)} stock, capped) — cut to the MEASURED thickness of the shelf, not nominal.`
          : type === 'rabbet'
            ? `Rabbet ${len(memberT)} × ${len(depth)} along the mating edge; keep the remaining wall at least half the stock.`
            : `Locking rabbet: ${len(depth)} tongue on the ${a.name.toLowerCase()}, matching ${len(depth)} dado in the ${b.name.toLowerCase()} — sneak up on a hand-press fit.`;
        break;
      }
      case 'half_blind_dovetail': {
        const memberH2 = [a.size.w, a.size.h, a.size.d].sort((x, y) => y - x)[1];
        const tails = Math.max(2, Math.round(memberH2 / 45));
        const lap = Math.max(4, Math.round(mateT / 3));
        out.dovetail = { tails, lapMM: lap };
        out.text = `${tails} tails on the ${b.name.toLowerCase()}, half-blind sockets in the ${a.name.toLowerCase()} leaving a ${len(lap)} lap (⅓ of the ${len(mateT)} front) — bevel gauge at 1:8.`;
        break;
      }

      /* ---- 2026 expansion: setout rules for the new joints. Every rule
       * snaps to the same chisel / bit / dado ladders the engine already
       * uses, and every purchasable item lands in out.fasteners so the BOM
       * and the drilling instructions can never disagree (audit F-S3-1). */
      case 'edge_glue': {
        // Long-grain lamination: no fasteners — the schedule is clamps
        // (same arithmetic the stock plan's glue-up steps use).
        const clamps = glueupSchedule(runMM).clamps;
        out.glueup = { clampCount: clamps };
        out.text = `Edge glue-up along ${len(runMM)}: joint both edges dead square, glue BOTH faces, and set ${clamps} bar clamps at ~${len(225)} centers, alternating over and under. Cauls across the ends keep the panel flat — check with a straightedge before the glue tacks.`;
        break;
      }
      case 'half_lap': case 'cross_lap': {
        const lapT = Math.round(Math.min(memberT, mateT) / 2 * 10) / 10;
        const memberW = [a.size.w, a.size.h, a.size.d].sort((x, y) => y - x)[1];
        out.lap = { depthMM: lapT, widthMM: memberW };
        // Wide laps creep on their cross-grain glue face — pin them (one
        // dowel dead center; edge distance is guaranteed at ≥ 2Ø by width).
        if (memberW >= 75) {
          out.fasteners.push({ kind: 'dowel', spec: `${U().fmtLength(8)} × ${U().fmtLength(40)} fluted dowel`, pilotMM: 8, diaMM: 8, alongMM: runMM / 2, edgeMM: runMM / 2 });
        }
        out.text = (type === 'half_lap'
          ? `Half lap: ${len(lapT)} deep from each face (half the ${len(Math.min(memberT, mateT))} stock), shoulders knifed square — cut both members from the same reference face.`
          : `Cross lap: matching ${len(lapT)} notches in each member — sneak up on the notch width with test cuts in offcut stock.`) +
          (memberW >= 75 ? ` The lap is ${len(memberW)} wide (cross-grain glue): pin it with one ${len(8)} dowel dead center, ${len(8)} bit.` : '');
        break;
      }
      case 'bridle': {
        const tongue = snapTo(Math.max(6, memberT / 3), CHISELS.filter(c2 => c2 <= Math.max(6, memberT - 8)));
        const cheek = Math.round((memberT - tongue) / 2 * 10) / 10;
        const tongueW = [a.size.w, a.size.h, a.size.d].sort((x, y) => y - x)[1];
        out.tenon = { thicknessMM: tongue, lengthMM: Math.round(mateT), widthMM: Math.round(tongueW), shoulderMM: cheek, open: true };
        out.text = `Bridle joint: ${len(tongue)} tongue (≈ ⅓ of the ${len(memberT)} stock, chisel size) through an open ${len(mateT)}-deep slot; the ${len(cheek)} outer cheeks split the rest. Clamp ACROSS the cheeks at glue-up, not just along the rail.`;
        break;
      }
      case 'loose_tenon': {
        const thick = snapTo(Math.max(6, Math.min(memberT, mateT) / 3), CHISELS.filter(c2 => c2 <= Math.max(6, Math.min(memberT, mateT) - 8)));
        const memberH = [a.size.w, a.size.h, a.size.d].sort((x, y) => y - x)[1];
        const depthEach = 25; // half of the 50 mm tenon stock per member
        const nT = memberH >= 140 ? 2 : 1;
        for (let i = 0; i < nT; i++) {
          const along = nT === 1 ? runMM / 2 : runMM * (i + 1) / (nT + 1);
          out.fasteners.push({ kind: 'loose_tenon', spec: fmtSpec(CATALOG.loose_tenon), pilotMM: thick, diaMM: thick, alongMM: Math.round(along * 10) / 10, edgeMM: Math.min(along, runMM - along) });
        }
        out.tenon = { thicknessMM: thick, lengthMM: depthEach * 2, widthMM: 22, loose: true };
        out.text = `${nT} loose tenon${nT > 1 ? 's' : ''}: rout a ${len(thick)} × ${len(22)} mortise ${len(depthEach)} deep in BOTH members (⅓-of-stock bit, same reference face), and mill tenon stock to a firm hand-press fit — never trust an undersized store tenon.`;
        break;
      }
      case 'box_joint': {
        const finger = snapTo(Math.max(6, Math.min(19, memberT)), DADO_WIDTHS);
        let n = Math.max(3, Math.round(runMM / finger));
        if (n % 2 === 0) n += 1; // odd count: both edges land on full fingers
        out.dovetail = { tails: Math.ceil(n / 2), fingerMM: finger, count: n, box: true };
        out.text = `Box joint: ${n} fingers × ${len(finger)} (dado-stack width) across the ${len(runMM)} corner — an odd count so both edges finish on full fingers. Cut every finger off ONE indexed jig setting; never re-register mid-run.`;
        break;
      }
      case 'through_dovetail': {
        const tails = Math.max(2, Math.round(runMM / 50));
        out.dovetail = { tails, through: true };
        out.text = `${tails} through tails, 1:8 slope, half-pins at both edges (pins ≥ ${len(6)} at the narrow) — the joint shows on both faces, so knife the ${len(mateT)} baseline deep and chop from both sides.`;
        break;
      }
      case 'sliding_dovetail': {
        const depth = BB.Plans ? BB.Plans.jointAllowance('sliding_dovetail', mateT) : Math.min(6, Math.floor(mateT / 3));
        out.dado = { depthMM: depth, widthMM: memberT, dovetail: true };
        out.text = `Sliding dovetail: ${len(depth)}-deep socket (⅓ of the ${len(mateT)} stock), 1:8 flare, stopped ${len(6)} from the front edge — taper the socket a hair toward the back, wax the pin, drive it fast.`;
        break;
      }
      case 'miter_spline': {
        const face = Math.round(Math.min(memberT, mateT) * Math.SQRT2 * 10) / 10;
        const depth = Math.round(face * 2 / 3 * 10) / 10;
        out.spline = { thicknessMM: 6, depthMM: depth };
        out.fasteners.push({ kind: 'spline', spec: fmtSpec(CATALOG.spline), pilotMM: 0, alongMM: runMM / 2, edgeMM: runMM / 2 });
        out.text = `Splined miter: cut both faces at 45°, then a ${len(6)} slot ${len(depth)} into each half (⅔ of the ${len(face)} miter face). Spline grain runs ACROSS the joint — the end-grain miter faces carry nothing on their own.`;
        break;
      }
      case 'staked_tenon': {
        const dia = memberT >= 38 ? 25 : 19;
        const ang = BB.Geo && BB.Geo.cutAngles ? (BB.Geo.cutAngles(a.rot) || BB.Geo.cutAngles(b.rot)) : null;
        out.tenon = { thicknessMM: dia, lengthMM: Math.round(mateT), widthMM: dia, round: true, wedged: true };
        out.text = `Staked tenon: turn or shave a ${len(dia)} round tenon, bore ${len(dia)} straight through the ${len(mateT)} seat${ang ? ` at the resultant angle (${BB.Geo.angleText(ang)} — sight line first, then the bevel)` : ''}, saw the wedge kerf to ⅔ of the tenon length, and drive a hardwood wedge ACROSS the seat grain — never parallel to it.`;
        break;
      }
      case 'biscuits': {
        // #20 biscuits: 50 mm edge distance, 150–250 mm spacing.
        const edge = 50, usable = Math.max(0, runMM - 2 * edge);
        let nB = Math.max(1, Math.round(usable / 200) + 1);
        while (nB > 1 && usable / (nB - 1) < 150) nB--;
        if (runMM < 2 * edge + 10) nB = 1;
        const c = CATALOG.biscuit;
        for (let i = 0; i < nB; i++) {
          const along = nB === 1 ? runMM / 2 : edge + usable * i / (nB - 1);
          out.fasteners.push({ kind: 'biscuit', spec: fmtSpec(c), pilotMM: 0, alongMM: Math.round(along * 10) / 10, edgeMM: Math.min(along, runMM - along) });
        }
        out.text = `${nB} × #20 biscuit${nB > 1 ? 's' : ''} on the centerline: first slot ${len(edge)} from each end, the rest at ${len(150)} to ${len(250)} centers. Biscuits align — the glue line carries the load.`;
        break;
      }
      case 'french_cleat': {
        // Standard sheet stock ripped at 45° — the thickest entry in the ONE
        // sheet-thickness table (18), never a hand-typed 19 that nothing
        // sells (audit L-01). A screw into every stud at ≤ 400 mm centers.
        const plyMM = K.SHEET_THICKNESS[K.SHEET_THICKNESS.length - 1];
        const cleatLen = Math.max(300, Math.round(runMM * 2 / 3));
        const c = CATALOG.butt_screw;
        const nS = Math.max(2, Math.floor(cleatLen / 400) + 1);
        for (let i = 0; i < nS; i++) {
          const along = nS === 1 ? cleatLen / 2 : RULES.edgeMM + (cleatLen - 2 * RULES.edgeMM) * i / (nS - 1);
          out.fasteners.push({ kind: 'screw', spec: fmtSpec(c), pilotMM: c.pilotMM, alongMM: Math.round(along * 10) / 10, edgeMM: Math.min(along, cleatLen - along) });
        }
        out.cleat = { lengthMM: cleatLen, plyMM };
        out.text = `French cleat: rip ${len(plyMM)} ply at 45°; the wall half runs ${len(cleatLen)} (≥ ⅔ of the case) with ${nS} × ${fmtSpec(c)} — one into EVERY stud at ≤ ${len(400)} centers, bevel up and toward the wall. Pilot ${drill(c.pilotMM)}. Never drywall alone.`;
        break;
      }
      case 'kd_bolt': {
        const c = CATALOG.kd_bolt;
        const memberH = [a.size.w, a.size.h, a.size.d].sort((x, y) => y - x)[1];
        const inset = Math.min(32, Math.max(25, Math.round(memberH / 4)));
        // Two bolts per rail end when the run allows; one, centered, when not.
        const spots = runMM - inset > inset + 10 ? [inset, runMM - inset] : [Math.max(10, runMM / 2)];
        for (const along of spots) {
          out.fasteners.push({ kind: 'kd_bolt', spec: fmtSpec(c), pilotMM: c.pilotMM, alongMM: Math.round(along * 10) / 10, edgeMM: Math.min(along, runMM - along) });
        }
        out.text = `${spots.length} knockdown bolt${spots.length > 1 ? 's' : ''} per joint: ${drill(7)} bolt bore through the ${b.name.toLowerCase()} into the rail end, ${drill(10)} barrel bore ${len(inset)} in from the shoulder — drill BOTH from the same reference face with a jig, then pull up with a hex key.`;
        break;
      }
      default: {
        const sp = screwPlan(a, b, 32);
        const specTxt = U().fmtTemplate(sp.spec);
        const pos = positions(runMM, 2);
        for (const p of pos) out.fasteners.push({ kind: 'screw', spec: specTxt, pilotMM: sp.pilotMM, counterboreMM: sp.counterboreMM, alongMM: p, edgeMM: Math.min(p, runMM - p) });
        out.text = `${pos.length} × ${specTxt}, ${len(RULES.edgeMM)} from each end, pilot ${drill(sp.pilotMM)}.`;
      }
    }
    return out;
  }

  /* Clamp schedule for an edge glue-up of a given run (panel length): bar
   * clamps at ~225 mm centers, minimum two, alternating over and under so
   * the panel can't bow toward the clamp bars. Shared by the edge_glue
   * joint setout AND the stock plan's glue-up assembly steps — packing and
   * joinery speak with one voice (2026). */
  function glueupSchedule(runMM) {
    const clamps = Math.max(2, Math.ceil(Math.max(0, runMM - 50) / 225) + 1);
    return {
      clamps,
      text: `Set ${clamps} bar clamps at ~${U().fmtLength(225)} centers, alternating over and under, cauls across the ends — check flat with a straightedge before the glue tacks.`
    };
  }

  /* One concise fastening line for an assembly step (first joint of each
   * distinct type in the step). */
  function stepNote(spec, model, joints) {
    if (!joints || !joints.length) return '';
    const seen = new Set();
    const bits = [];
    for (const j of joints) {
      if (seen.has(j.type)) continue;
      seen.add(j.type);
      const lay = layoutForJoint(spec, model, j);
      if (lay && lay.text) bits.push(lay.text);
      if (bits.length >= 2) break; // steps stay readable
    }
    return bits.join(' ');
  }

  /* Print-sheet detail table + BOM-grade counts: one row per unique
   * (type, part-pair-name) so four identical leg joints read as one row × 4. */
  function detailRows(spec, model) {
    const rows = new Map();
    for (const j of model.joints) {
      const lay = layoutForJoint(spec, model, j);
      if (!lay) continue;
      const key = j.type + '|' + lay.a.name + '|' + lay.b.name;
      if (!rows.has(key)) {
        rows.set(key, {
          type: j.type, label: (K.JOINERY[j.type] ? K.JOINERY[j.type].label : j.type),
          where: `${lay.a.name} → ${lay.b.name}`, qty: 0, text: lay.text,
          fasteners: lay.fasteners
        });
      }
      rows.get(key).qty++;
    }
    return [...rows.values()];
  }

  /* Aggregate fastener counts for the BOM (replaces flat 2-per-joint). */
  function countFor(spec, model) {
    const totals = new Map(); // spec label -> {qty, pilotMM, kind}
    for (const j of model.joints) {
      const lay = layoutForJoint(spec, model, j);
      if (!lay) continue;
      for (const f of lay.fasteners) {
        const key = f.kind + '|' + f.spec;
        if (!totals.has(key)) totals.set(key, { kind: f.kind, spec: f.spec, pilotMM: f.pilotMM, qty: 0 });
        totals.get(key).qty++;
      }
    }
    return [...totals.values()];
  }

  BB.Fasteners = { RULES, CHISELS, DOWEL_DIAMETERS, layoutForJoint, stepNote, detailRows, countFor, jointRun, positions, glueupSchedule };
})();
