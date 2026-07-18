/* Blueprint Buddy — parametric joint geometry (Phase 5 Joint Inspector).
 * Pure data, no THREE: buildJoint(type, partA, partB, fmt) returns close-up
 * geometry for one joint of the design, sized from the REAL parts —
 * `a` is the inserted member and `b` the housing member, matching
 * model.joints. All sizing rules are code-owned and mirror the cut-list
 * doctrine (tenon = ⅓ stock and 30 mm long per JOINT_ALLOWANCE, dado depth
 * = ⅓ housing thickness, dovetail flare 1:8, pocket holes 15°).
 *
 * Output, in joint-local millimetres (interface plane at x = 0, member A
 * entering from +X, vertical = Y):
 *   { pieces: [ {member:'a'|'b'|'fastener', kind:'cuboid', c:[x,y,z], e:[hx,hy,hz]}
 *             | {member, kind:'cylinder', c, axis:[x,y,z], r, len}
 *             | {member, kind:'prism', profile:[[x,y]…] (convex, CCW), z0, depth} ],
 *     insertAxis: [x,y,z],   // member A slides along this to explode
 *     labels: [string…],     // sizing rules, dimensions via fmt
 *     title: string }
 */
var BB = globalThis.BB = globalThis.BB || {};

(function () {
  'use strict';

  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  /* Cross-section of a part: thickness = smallest dimension, width = middle. */
  function section(part) {
    const d = [part.size.w, part.size.h, part.size.d].sort((x, y) => x - y);
    return { t: d[0], w: d[1] };
  }
  const cub = (member, x0, x1, y0, y1, z0, z1) => ({
    member, kind: 'cuboid',
    c: [(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2],
    e: [(x1 - x0) / 2, (y1 - y0) / 2, (z1 - z0) / 2]
  });
  const cyl = (member, c, axis, r, len) => ({ member, kind: 'cylinder', c, axis, r, len });

  /* ---------------- hardware teaching views (2026 hardware expansion) --
   * Keyed 'hw_*', shown from the Shop Reference. Fixed didactic sizes, but
   * every dimension that teaches is TRUE: cup 35 × 13 at boring distance 5
   * and plate line 37; rule-joint radius = t − fillet − pin height; pivot
   * edge radius from the axis inset; tambour radius ≥ 2.5 × slat; sawtooth
   * at 25 pitch; undermount 27 / 19 / 12.7. */
  function buildHardwareView(type, fmt) {
    const pieces = [], labels = [];
    let insertAxis = [1, 0, 0], title = type;
    const HW = BB.HW || { HINGES: {}, TRADITIONAL: {}, SLIDES: {} };

    if (type === 'hw_cup_hinge') {
      title = 'Cup hinge in section — 35 mm cup, boring distance, 37 mm plate line';
      const tb = 5, cupR = 17.5, doorT = 19;
      // Door slab lying flat (thickness up); hinge edge at x = 0.
      pieces.push(cub('a', 0, 130, -55, 55, 0, doorT));
      // The 35 × 13 cup sunk in the door's back face, edge tb from the door edge.
      pieces.push(cyl('fastener', [tb + cupR, 0, doorT - 6.5], [0, 0, 1], cupR, 13));
      // Hinge arm reaching back over the door edge to the mounting plate.
      pieces.push(cub('fastener', -37, tb + cupR, -8, 8, doorT, doorT + 6));
      // Case side behind the edge; plate boss on its face at the 37 mm line.
      pieces.push(cub('b', -56, -18, -70, 70, -80, doorT + 14));
      pieces.push(cub('fastener', -37 - 9, -37 + 9, -19, 19, doorT + 6, doorT + 12));
      insertAxis = [1, 0, 0];
      labels.push(`Cup Ø ${fmt(35)}, bored ${fmt(13)} deep; cup edge ${fmt(tb)} from the door edge (legal range ${fmt(3)} to ${fmt(7)}).`);
      labels.push(`Mounting plate on the ${fmt(37)} system line — the same 37 the shelf-pin rows use; overlay solves the boring distance, never the other way around.`);
    } else if (type === 'hw_rule_joint') {
      title = 'Rule joint — radius = thickness − fillet − pin height';
      const t = 22, fillet = 5, pinH = 3, r = t - fillet - pinH; // 14
      const zSpan = 55;
      // Top (x ≤ 0 body): fillet, then the convex roundover bulging toward
      // the leaf; the arc's center IS the pin position (0, pinH).
      const arc = [];
      for (let i = 0; i <= 6; i++) {
        const th = Math.PI / 2 - (Math.PI / 2) * i / 6; // 90° → 0°
        arc.push([Math.round(r * Math.cos(th) * 100) / 100, Math.round((pinH + r * Math.sin(th)) * 100) / 100]);
      }
      pieces.push({ member: 'b', kind: 'prism', z0: -zSpan, depth: 2 * zSpan,
        profile: [[-110, 0], [-110, t], [0, t], ...arc, [r, 0]] });
      // Leaf: body past the cove + a stepped cove lip that wraps the
      // roundover from above, with 1 mm operating clearance (radius r + 1).
      pieces.push(cub('a', r + 1, 110, 0, t, -zSpan, zSpan));
      const rc = r + 1;
      for (let i = 0; i < 5; i++) {
        const x0 = Math.max(1, rc * (i / 5));
        const x1 = rc * ((i + 1) / 5);
        // Arc height at the band's LEFT edge — the step stays outside the swing.
        const yLow = pinH + Math.sqrt(Math.max(0, rc * rc - x0 * x0));
        if (x1 - x0 > 0.4 && t - yLow > 0.4) pieces.push(cub('a', x0, x1, Math.min(t - 0.4, yLow), t, -zSpan, zSpan));
      }
      // The hinge pin at the arc center, nudged 1 mm outboard.
      pieces.push(cyl('fastener', [1, pinH, 0], [0, 0, 1], 1.6, 2 * zSpan * 0.9));
      insertAxis = [0, -1, 0];
      labels.push(`radius = ${fmt(t)} top − ${fmt(fillet)} fillet − ${fmt(pinH)} pin height = ${fmt(r)}; the pin sits AT the arc center, nudged ${fmt(1)} outboard.`);
      labels.push('Short leaf and barrel mortise into the top; the LONG leaf spans the leaf’s cove. Pin below center binds going down and gaps going up.');
    } else if (type === 'hw_pivot_pin') {
      title = 'Pivot-pin door — the edge radius is not optional';
      const t = 19, inset = t / 2 + 2; // 11.5
      const half = Math.sqrt(inset * inset - (t / 2) * (t / 2)); // where the arc meets the faces
      const a0 = Math.atan2(t / 2, -half), a1 = 2 * Math.PI - a0; // sweep around the hinge edge
      const arc = [];
      for (let i = 0; i <= 8; i++) {
        const th = a0 + (a1 - a0) * i / 8;
        arc.push([Math.round((inset + inset * Math.cos(th)) * 100) / 100, Math.round((t / 2 + inset * Math.sin(th)) * 100) / 100]);
      }
      pieces.push({ member: 'a', kind: 'prism', z0: -60, depth: 120, profile: [[120, 0], [120, t], ...arc] });
      pieces.push(cyl('fastener', [inset, t / 2, 66], [0, 0, 1], 3.5, 16)); // top pin
      pieces.push(cyl('fastener', [inset, t / 2, -66], [0, 0, 1], 3.5, 16)); // bottom pin
      pieces.push(cub('b', -50, 110, 0, t, 63, 82)); // case top rail carrying the bore
      insertAxis = [0, 0, -1];
      labels.push(`Pin axis ${fmt(inset)} in from the hinge edge (≥ door t/2 + ${fmt(2)}); round the edge to that same radius so it clears in swing.`);
      labels.push('A square hinge edge with an offset pin jams at 30° — UHMW or brass washer under the bottom pin; the door floats on it.');
    } else if (type === 'hw_tambour') {
      title = 'Tambour — track radius ≥ 2.5 × slat width';
      const slat = 20, minR = 2.5 * slat; // 50
      // Track path (groove floor shown dark): run, 45° turn, drop.
      pieces.push(cub('fastener', -90, 10, 96, 100, -2, 2));
      pieces.push({ member: 'fastener', kind: 'prism', z0: -2, depth: 4,
        profile: [[10, 100], [10 + minR * 0.7, 100 - minR * 0.7], [10 + minR * 0.7 + 4, 100 - minR * 0.7 + 3], [14, 103]] });
      pieces.push(cub('fastener', 10 + minR * 0.7, 14 + minR * 0.7, 10, 100 - minR * 0.7 + 3, -2, 2));
      // Case side the groove lives in.
      pieces.push(cub('b', -100, 60, 0, 112, 8, 26));
      // Slats riding the path: flat, one on the turn, two dropping.
      for (let i = 0; i < 3; i++) pieces.push(cub('a', -85 + i * 26, -85 + i * 26 + slat, 88, 97, -30, -4));
      pieces.push({ member: 'a', kind: 'prism', z0: -30, depth: 26,
        profile: [[16, 92], [30, 78], [36, 84], [22, 98]] });
      for (let i = 0; i < 2; i++) pieces.push(cub('a', 42 + minR * 0.7, 51 + minR * 0.7, 70 - i * 26 - slat, 70 - i * 26, -30, -4));
      insertAxis = [-1, 0, 0];
      labels.push(`Slats ~${fmt(9)} × ${fmt(slat)} to ${fmt(40)} on canvas; track ${fmt(11)} deep, routed from ONE template in both sides.`);
      labels.push(`Minimum track radius ≥ 2.5 × slat width (${fmt(minR)} here) — a curve tighter than the slats can turn is the whole failure mode.`);
    } else if (type === 'hw_sawtooth') {
      title = 'Sawtooth supports — gang-cut, period-correct, free';
      const pitch = 25;
      pieces.push(cub('b', 0, 16, -90, 90, 0, 19)); // strip body
      for (let i = 0; i < 6; i++) {
        const y0 = -75 + i * pitch;
        pieces.push({ member: 'b', kind: 'prism', z0: 0, depth: 19,
          profile: [[16, y0], [16 + 10, y0 + pitch / 2], [16, y0 + pitch]] });
      }
      // Shelf cleat dropped into one notch + shelf stub.
      pieces.push({ member: 'a', kind: 'prism', z0: 0, depth: 19,
        profile: [[16, -25], [26, -12.5], [16, 0], [44, 0], [44, -25]] });
      pieces.push(cub('a', 26, 110, -8, 0, 0, 19));
      insertAxis = [0, 1, 0];
      labels.push(`45° teeth at ${fmt(pitch)} pitch, four strips cut in ONE gang — separate setups never line up and the shelves rock forever.`);
      labels.push('Shelf-end cleats drop into the teeth; shelf length = opening − 2 × strip thickness.');
    } else if (type === 'hw_undermount') {
      title = 'Undermount slides — the box is built to the slide';
      const boxW = 180, boxH = 70, boxD = 150, sideT = 12, botT = 12, recess = 12.7;
      pieces.push(cub('b', -boxW / 2 - 30, boxW / 2 + 30, -14, -8, -boxD / 2 - 20, boxD / 2 + 10)); // case floor
      // Slide rails under the box, tucked inside the recess.
      for (const s of [-1, 1]) pieces.push(cub('fastener', s * (boxW / 2 - 21) - 6, s * (boxW / 2 - 21) + 6, -8, recess - botT / 2, -boxD / 2, boxD / 2));
      pieces.push(cub('a', -boxW / 2, -boxW / 2 + sideT, 0, boxH, -boxD / 2, boxD / 2));
      pieces.push(cub('a', boxW / 2 - sideT, boxW / 2, 0, boxH, -boxD / 2, boxD / 2));
      pieces.push(cub('a', -boxW / 2 + sideT, boxW / 2 - sideT, 0, boxH, boxD / 2 - sideT, boxD / 2));
      pieces.push(cub('a', -boxW / 2 + sideT, boxW / 2 - sideT, recess, recess + botT, -boxD / 2, boxD / 2 - sideT)); // recessed captured bottom
      insertAxis = [0, 0, 1];
      labels.push(`Box width = opening − ${fmt(27)}; ${fmt(19)} height clearance; ${fmt(botT)} bottom captured and recessed ${fmt(12.7)} so the arms tuck under; depth = slide length EXACTLY.`);
      labels.push('They forgive nothing — square within 0.5 mm, and notch the back for the hooks. Build the box to the slide, never the reverse.');
    } else {
      pieces.push(cub('b', -60, 0, -40, 40, -20, 20));
      pieces.push(cub('a', 0, 90, -30, 30, -10, 10));
    }
    return { pieces, insertAxis, labels, title };
  }

  function buildJoint(type, partA, partB, fmt) {
    // Default to the ONE display boundary (audit L-02) — a raw mm string
    // here would ignore the user's unit preference.
    fmt = fmt || BB.Units.fmtLength;
    if (/^hw_/.test(type)) return buildHardwareView(type, fmt);
    const A = section(partA), B = section(partB);
    const tA = A.t, wA = A.w, tB = B.t, wB = B.w;
    const LA = clamp(tA * 3.5, 90, 170);   // stub of the inserted member
    const LB = clamp(wA * 1.8, 140, 260);  // stub of the housing member
    const pieces = [], labels = [];
    let insertAxis = [1, 0, 0];
    const J = BB.K.JOINERY[type];
    const title = (J ? J.label : type) + ' — ' + (partA.name || partA.id) + ' → ' + (partB.name || partB.id);

    if (type === 'butt_screws' || type === 'pocket_screws' || type === 'dowels') {
      // Butt family: A's end meets B's face at x = 0.
      const dB = Math.min(tB * 2, wB); // housing depth along the insert
      pieces.push(cub('b', -dB, 0, -LB / 2, LB / 2, -wB / 2, wB / 2));
      pieces.push(cub('a', 0, LA, -wA / 2, wA / 2, -tA / 2, tA / 2));
      if (type === 'butt_screws') {
        for (const s of [-1, 1]) {
          pieces.push(cyl('fastener', [-dB / 2 + 12, s * wA / 4, 0], [1, 0, 0], 2.2, dB + 24));
        }
        labels.push('Screws drive through the housing into the end — pilot-drill both.');
      } else if (type === 'pocket_screws') {
        const c15 = Math.cos(15 * Math.PI / 180), s15 = Math.sin(15 * Math.PI / 180);
        for (const s of [-1, 1]) {
          pieces.push(cyl('fastener', [16, s * wA / 4, -tA / 2 + 9], [-c15, 0, s15], 2.4, 52));
        }
        labels.push('Pockets bored at 15° from the hidden face; screws bite the housing.');
      } else {
        for (const s of [-1, 1]) {
          pieces.push(cyl('fastener', [0, s * wA / 4, 0], [1, 0, 0], 4, 40));
        }
        labels.push(`${fmt(8)} × ${fmt(40)} fluted dowels — half in each member, glued.`);
      }
    } else if (type === 'dado') {
      // Housing panel B (thickness tB along X); shelf A rides a groove
      // ⅓ tB deep, cut across the inner face. Slides in along Z.
      const depth = tB / 3, zSpan = clamp(wB, 120, 240) / 2;
      pieces.push(cub('b', -tB, 0, -LB / 2, -tA / 2, -zSpan, zSpan));
      pieces.push(cub('b', -tB, 0, tA / 2, LB / 2, -zSpan, zSpan));
      pieces.push(cub('b', -tB, -depth, -tA / 2, tA / 2, -zSpan, zSpan));
      pieces.push(cub('a', -depth, LA, -tA / 2, tA / 2, -zSpan, zSpan));
      insertAxis = [0, 0, 1];
      labels.push(`Groove ${fmt(depth)} deep (⅓ of the ${fmt(tB)} side) × ${fmt(tA)} wide — cut to the measured shelf thickness.`);
    } else if (type === 'rabbet') {
      // Housing B rabbeted along its top edge (y = 0); panel A drops in.
      const depth = tA, wall = tB / 2, zSpan = clamp(wB, 120, 240) / 2;
      pieces.push(cub('b', -tB / 2, tB / 2, -LB, -depth, -zSpan, zSpan));
      pieces.push(cub('b', 0, tB / 2, -depth, 0, -zSpan, zSpan));
      pieces.push(cub('a', -LA, 0, -depth, 0, -zSpan, zSpan));
      insertAxis = [-1, 0, 0];
      labels.push(`Rabbet ${fmt(depth)} × ${fmt(wall)} — keep the wall at least half the ${fmt(tB)} stock.`);
    } else if (type === 'locking_rabbet') {
      // Drawer corner: front A (thickness along X), side B (thickness along
      // Z). The side's tongue locks into a dado in the front's back half.
      const tF = tA, tS = tB, h = clamp(wA, 80, 140);
      const LF = clamp(tS * 4, 90, 150), LS = clamp(tF * 5, 110, 170);
      pieces.push(cub('a', -tF, -tF / 2, -h / 2, h / 2, -LF, tS));
      pieces.push(cub('a', -tF / 2, 0, -h / 2, h / 2, -LF, tS / 3));
      pieces.push(cub('a', -tF / 2, 0, -h / 2, h / 2, 2 * tS / 3, tS));
      pieces.push(cub('b', 0, LS, -h / 2, h / 2, 0, tS));
      pieces.push(cub('b', -tF / 2, 0, -h / 2, h / 2, tS / 3, 2 * tS / 3));
      insertAxis = [1, 0, 0];
      labels.push(`Tongue ${fmt(tS / 3)} thick × ${fmt(tF / 2)} long locks into the front — sneak up on a hand-pressed fit.`);
    } else if (type === 'mortise_tenon') {
      // Leg B with a blind mortise; apron A's tenon = ⅓ stock, 30 mm long.
      const tT = tA / 3, depth = 30, shoulder = clamp(wA * 0.12, 8, 16);
      const wT = wA - 2 * shoulder;
      const dB = Math.min(tB * 2, Math.max(tB, depth + 15));
      pieces.push(cub('b', -dB, 0, -LB / 2, LB / 2, -wB / 2, -tT / 2));
      pieces.push(cub('b', -dB, 0, -LB / 2, LB / 2, tT / 2, wB / 2));
      pieces.push(cub('b', -dB, 0, wT / 2, LB / 2, -tT / 2, tT / 2));
      pieces.push(cub('b', -dB, 0, -LB / 2, -wT / 2, -tT / 2, tT / 2));
      pieces.push(cub('b', -dB, -depth, -wT / 2, wT / 2, -tT / 2, tT / 2));
      pieces.push(cub('a', 0, LA, -wA / 2, wA / 2, -tA / 2, tA / 2));
      pieces.push(cub('a', -depth, 0, -wT / 2, wT / 2, -tT / 2, tT / 2));
      labels.push(`Tenon ${fmt(tT)} (⅓ of ${fmt(tA)} stock) × ${fmt(wT)} wide × ${fmt(depth)} long; ${fmt(shoulder)} shoulders.`);
      labels.push('Aim for a firm hand-press fit — a mallet-tight tenon splits the mortise cheek.');
    } else if (type === 'half_blind_dovetail') {
      // Drawer side A: tails on its end; front B keeps a ⅓ lap so nothing
      // shows from the face. Tails slide in along Z (the side's face normal).
      const tS = tA, tF = Math.max(tB, 16), h = clamp(wA, 90, 150);
      const lap = tF / 3, sock = tF - lap; // socket depth into the front
      const LS = clamp(tS * 6, 110, 170);
      const nTails = 3, flare = sock / 8; // 1:8
      const pitch = h / (nTails + 1);
      pieces.push(cub('a', 0, LS, -h / 2, h / 2, 0, tS)); // side body
      pieces.push(cub('b', -tF, -sock, -h / 2, h / 2, 0, tS)); // front lap slab
      const boundaries = [-h / 2];
      for (let i = 1; i <= nTails; i++) {
        const yc = -h / 2 + i * pitch;
        const wNarrow = pitch * 0.42;
        // tail (member a): narrow at the shoulder (x=0), wide at the lap
        pieces.push({
          member: 'a', kind: 'prism', z0: 0, depth: tS,
          profile: [
            [0, yc - wNarrow / 2], [0, yc + wNarrow / 2],
            [-sock, yc + wNarrow / 2 + flare], [-sock, yc - wNarrow / 2 - flare]
          ]
        });
        boundaries.push(yc - wNarrow / 2, yc + wNarrow / 2);
      }
      boundaries.push(h / 2);
      // front pins fill the gaps between tails (complementary flare)
      for (let i = 0; i < boundaries.length; i += 2) {
        const y0 = boundaries[i], y1 = boundaries[i + 1];
        if (y1 - y0 < 2) continue;
        pieces.push({
          member: 'b', kind: 'prism', z0: 0, depth: tS,
          profile: [
            [0, y0], [0, y1],
            [-sock, y1 - (i > 0 ? flare : 0)], [-sock, y0 + (i < boundaries.length - 2 ? flare : 0)]
          ]
        });
      }
      insertAxis = [0, 0, 1];
      labels.push(`${nTails} tails, 1:8 flare, sockets ${fmt(sock)} deep — a ${fmt(lap)} lap hides the joinery from the front.`);
      labels.push('Chop the socket floors halfway from each side to avoid blow-out.');
    } else if (type === 'edge_glue' || type === 'biscuits') {
      // Two boards meeting edge to edge at x = 0, faces up (thickness on Y).
      const t = Math.min(tA, tB), span = clamp(Math.max(wA, 120), 120, 240) / 2;
      pieces.push(cub('a', 0, LA, -t / 2, t / 2, -span, span));
      pieces.push(cub('b', -LB, 0, -t / 2, t / 2, -span, span));
      if (type === 'biscuits') {
        // #20 biscuit: 56 long along the seam, ~23 across (11.5 each side), 4 thick.
        pieces.push(cub('fastener', -11.5, 11.5, -2, 2, -28, 28));
        labels.push('#20 biscuit slots on the centerline — alignment aid; the long-grain glue line carries the load.');
      } else {
        labels.push('Long-grain to long-grain — glued and clamped, the joint outlasts the wood around it.');
        labels.push(`Clamps at ~${fmt(225)} centers, alternating faces; cauls keep the panel flat.`);
      }
    } else if (type === 'half_lap' || type === 'cross_lap') {
      // A runs along X, B along Y; each sheds half its thickness (Z) where
      // they cross. Half lap = corner (members extend one way); cross lap = X.
      const t = Math.min(tA, tB), lap = t / 2;
      const spanA = clamp(tB * 4, 90, 170), spanB = clamp(tA * 4, 90, 170);
      // A keeps its TOP half over the overlap, full section beyond it.
      pieces.push(cub('a', wB / 2, wB / 2 + spanA, -wA / 2, wA / 2, -t / 2, t / 2));
      pieces.push(cub('a', -wB / 2, wB / 2, -wA / 2, wA / 2, 0, t / 2));
      // B keeps its BOTTOM half in the overlap.
      pieces.push(cub('b', -wB / 2, wB / 2, wA / 2, wA / 2 + spanB, -t / 2, t / 2));
      pieces.push(cub('b', -wB / 2, wB / 2, -wA / 2, wA / 2, -t / 2, 0));
      if (type === 'cross_lap') {
        pieces.push(cub('a', -wB / 2 - spanA, -wB / 2, -wA / 2, wA / 2, -t / 2, t / 2));
        pieces.push(cub('b', -wB / 2, wB / 2, -wA / 2 - spanB, -wA / 2, -t / 2, t / 2));
      }
      insertAxis = [0, 0, 1];
      labels.push(`Lap ${fmt(lap)} deep from each face — exactly half the ${fmt(t)} stock, both members off one reference face.`);
      if (Math.max(wA, wB) >= 75) labels.push(`A ${fmt(Math.max(wA, wB))}-wide lap is a cross-grain glue face — pin it with one ${fmt(8)} dowel.`);
    } else if (type === 'bridle') {
      // Post B ends in an open slot; rail A's full-height tongue drops in.
      const tongue = clamp(tA / 3, 6, 12);
      const postTop = wA / 2;
      pieces.push(cub('b', -tB / 2, tB / 2, -LB, -postTop, -wB / 2, wB / 2)); // post body
      pieces.push(cub('b', -tB / 2, tB / 2, -postTop, postTop, -wB / 2, -tongue / 2)); // cheek
      pieces.push(cub('b', -tB / 2, tB / 2, -postTop, postTop, tongue / 2, wB / 2));   // cheek
      pieces.push(cub('a', tB / 2, tB / 2 + LA, -wA / 2, wA / 2, -tA / 2, tA / 2));    // rail body
      pieces.push(cub('a', -tB / 2, tB / 2, -wA / 2, wA / 2, -tongue / 2, tongue / 2)); // tongue
      labels.push(`Tongue ${fmt(tongue)} (⅓ of the ${fmt(tA)} rail) through an open ${fmt(tB)} slot — every surface visible for fitting.`);
      labels.push('Clamp across the cheeks at glue-up so they cannot split.');
    } else if (type === 'loose_tenon') {
      // Butt at x = 0; the floating tenon spans both mortises.
      const tT = clamp(Math.min(tA, tB) / 3, 6, 12);
      const dB = Math.min(tB * 2, wB);
      pieces.push(cub('b', -dB, 0, -LB / 2, LB / 2, -wB / 2, wB / 2));
      pieces.push(cub('a', 0, LA, -wA / 2, wA / 2, -tA / 2, tA / 2));
      pieces.push(cub('a', -25, 25, -11, 11, -tT / 2, tT / 2)); // tenon rides with A
      labels.push(`Loose tenon ${fmt(tT)} × ${fmt(22)} × ${fmt(50)} — matching routed mortises ${fmt(25)} deep in both members.`);
      labels.push('Mill tenon stock to a firm hand-press fit; an undersized tenon starves the joint.');
    } else if (type === 'box_joint' || type === 'through_dovetail') {
      // Corner comb: side A (thickness tS along Z) into front B (tF along X).
      const tS = tA, tF = Math.max(tB, 12), h = clamp(wA, 90, 150);
      const LS = clamp(tS * 6, 110, 170);
      pieces.push(cub('a', 0, LS, -h / 2, h / 2, 0, tS));       // side body
      pieces.push(cub('b', -tF, 0, -h / 2, h / 2, tS, tS + clamp(wB, 100, 200))); // front runs on
      if (type === 'box_joint') {
        const n = 5; // odd — both edges land on full fingers
        const fw = h / n;
        for (let i = 0; i < n; i++) {
          const y0 = -h / 2 + i * fw, y1 = y0 + fw;
          pieces.push(cub(i % 2 === 0 ? 'a' : 'b', -tF, 0, y0, y1, 0, tS));
        }
        insertAxis = [1, 0, 0];
        labels.push(`Fingers = the ${fmt(tS)} stock snapped to a dado width, an ODD count across the corner — cut every one off a single indexed jig setting.`);
      } else {
        const nTails = 3, flare = tF / 8; // 1:8, through the full front
        const pitch = h / (nTails + 1);
        const boundaries = [-h / 2];
        for (let i = 1; i <= nTails; i++) {
          const yc = -h / 2 + i * pitch, wNarrow = pitch * 0.42;
          pieces.push({
            member: 'a', kind: 'prism', z0: 0, depth: tS,
            profile: [
              [0, yc - wNarrow / 2], [0, yc + wNarrow / 2],
              [-tF, yc + wNarrow / 2 + flare], [-tF, yc - wNarrow / 2 - flare]
            ]
          });
          boundaries.push(yc - wNarrow / 2, yc + wNarrow / 2);
        }
        boundaries.push(h / 2);
        for (let i = 0; i < boundaries.length; i += 2) {
          const y0 = boundaries[i], y1 = boundaries[i + 1];
          if (y1 - y0 < 2) continue;
          pieces.push({
            member: 'b', kind: 'prism', z0: 0, depth: tS,
            profile: [
              [0, y0], [0, y1],
              [-tF, y1 - (i > 0 ? flare : 0)], [-tF, y0 + (i < boundaries.length - 2 ? flare : 0)]
            ]
          });
        }
        insertAxis = [0, 0, 1];
        labels.push(`${nTails} through tails, 1:8 flare, half-pins at both edges — the mechanical lock outlives the glue.`);
        labels.push('Knife the baseline deep on both faces and chop to it in stages.');
      }
    } else if (type === 'sliding_dovetail') {
      // Housing panel B (thickness tB along X) with a flared socket; shelf A's
      // dovetail key slides in along Z, like a dado that cannot pull out.
      const depth = tB / 3, flare = depth / 8, zSpan = clamp(wB, 120, 240) / 2;
      const hN = tA - 2 * flare < 4 ? tA * 0.7 : tA - 2 * flare; // key at the face
      pieces.push(cub('b', -tB, -depth, -LB / 2, LB / 2, -zSpan, zSpan)); // panel behind the socket
      pieces.push({ // panel above the flared socket (convex quad prism)
        member: 'b', kind: 'prism', z0: -zSpan, depth: 2 * zSpan,
        profile: [[-depth, LB / 2], [-depth, tA / 2], [0, hN / 2], [0, LB / 2]]
      });
      pieces.push({ // panel below
        member: 'b', kind: 'prism', z0: -zSpan, depth: 2 * zSpan,
        profile: [[-depth, -tA / 2], [-depth, -LB / 2], [0, -LB / 2], [0, -hN / 2]]
      });
      pieces.push(cub('a', 0, LA, -tA / 2, tA / 2, -zSpan, zSpan)); // shelf body
      pieces.push({ // the dovetail key
        member: 'a', kind: 'prism', z0: -zSpan, depth: 2 * zSpan,
        profile: [[0, -hN / 2], [0, hN / 2], [-depth, tA / 2], [-depth, -tA / 2]]
      });
      insertAxis = [0, 0, 1];
      labels.push(`Socket ${fmt(depth)} deep (⅓ of the ${fmt(tB)} side), 1:8 flare, stopped ${fmt(6)} from the front — the shelf mechanically cannot pull out.`);
      labels.push('Taper the socket a hair, wax the key, and drive it home fast.');
    } else if (type === 'miter_spline') {
      // Corner miter: A along +X, B along +Y, outer corner at the origin,
      // 45° plane from (0,0) to the inner corner; a 6 mm spline crosses it.
      const t = Math.min(tA, tB), LAm = clamp(t * 5, 100, 180), LBm = clamp(t * 5, 100, 180);
      const zSpan = clamp(Math.max(wA, wB), 100, 200) / 2;
      pieces.push({ member: 'a', kind: 'prism', z0: -zSpan, depth: 2 * zSpan, profile: [[0, 0], [-t, -t], [LAm, -t], [LAm, 0]] });
      pieces.push({ member: 'b', kind: 'prism', z0: -zSpan, depth: 2 * zSpan, profile: [[0, 0], [0, LBm], [-t, LBm], [-t, -t]] });
      // Spline: thin rectangle astride the miter line (normal n = (1,-1)/√2).
      const cx = -t / 2, cy = -t / 2, dLen = t * 0.55, half = 3;
      const n = [Math.SQRT1_2, -Math.SQRT1_2], u = [-Math.SQRT1_2, -Math.SQRT1_2];
      pieces.push({
        member: 'fastener', kind: 'prism', z0: -zSpan * 0.85, depth: 2 * zSpan * 0.85,
        profile: [
          [cx - n[0] * dLen - u[0] * half, cy - n[1] * dLen - u[1] * half],
          [cx - n[0] * dLen + u[0] * half, cy - n[1] * dLen + u[1] * half],
          [cx + n[0] * dLen + u[0] * half, cy + n[1] * dLen + u[1] * half],
          [cx + n[0] * dLen - u[0] * half, cy + n[1] * dLen - u[1] * half]
        ]
      });
      insertAxis = [Math.SQRT1_2, -Math.SQRT1_2, 0];
      labels.push(`Both faces at 45°; a ${fmt(6)} ply spline sits ⅔ of the way into each half, grain ACROSS the joint.`);
      labels.push('The end-grain miter faces carry nothing on their own — the spline is the joint.');
    } else if (type === 'staked_tenon') {
      // Leg A (cylinder) bored straight through slab seat B; wedge locks it.
      const dia = tA >= 38 ? 25 : 19, r = dia / 2;
      const seatT = Math.max(tB, 25), span = clamp(wB, 140, 240) / 2;
      const legLen = clamp(tA * 4, 160, 260);
      // Seat: four cuboids around a square pocket the tenon passes through.
      pieces.push(cub('b', -span, -r, 0, seatT, -span, span));
      pieces.push(cub('b', r, span, 0, seatT, -span, span));
      pieces.push(cub('b', -r, r, 0, seatT, -span, -r));
      pieces.push(cub('b', -r, r, 0, seatT, r, span));
      // Leg body up to the seat's underside; only the tenon passes through.
      pieces.push(cyl('a', [0, -legLen / 2, 0], [0, 1, 0], Math.max(r + 3, tA / 2 * 0.72), legLen));
      pieces.push(cyl('a', [0, seatT / 2, 0], [0, 1, 0], r, seatT + 0.5));
      // Wedge: thin triangular prism in the tenon top, ACROSS the seat grain.
      pieces.push({
        member: 'fastener', kind: 'prism', z0: -r * 0.85, depth: 2 * r * 0.85,
        profile: [[-6, seatT + 1], [0, seatT - seatT * 2 / 3], [6, seatT + 1]]
      });
      insertAxis = [0, -1, 0];
      labels.push(`Tenon Ø ${fmt(dia)} bored straight THROUGH the ${fmt(seatT)} seat; kerf to ⅔ of the tenon, wedge driven across the seat grain.`);
      labels.push('Rake and splay come from the sight line — bore at the resultant angle, wedge across the grain, trim flush.');
    } else if (type === 'french_cleat') {
      // Interlocked 45° rips: wall half below, case half hooked over it.
      const t = 19, H = clamp(wA, 90, 150), zSpan = clamp(Math.max(wA, wB), 160, 260) / 2;
      pieces.push({ member: 'b', kind: 'prism', z0: -zSpan, depth: 2 * zSpan, profile: [[0, 0], [t, 0], [t, H / 2 - t], [0, H / 2]] });
      pieces.push({ member: 'a', kind: 'prism', z0: -zSpan, depth: 2 * zSpan, profile: [[t, H / 2 - t], [t, H], [0, H], [0, H / 2]] });
      pieces.push(cub('a', t, t + 18, 0, H, -zSpan, zSpan)); // the case back riding the cleat
      for (const s of [-0.6, 0, 0.6]) {
        pieces.push(cyl('fastener', [t / 2, H / 4, s * zSpan], [1, 0, 0], 2.2, t + 20)); // stud screws
      }
      insertAxis = [0, 1, 0];
      labels.push(`Two ${fmt(t)} ply strips ripped at 45° — gravity locks them; the whole case lifts straight off.`);
      labels.push(`Wall half screwed into EVERY stud at ≤ ${fmt(400)} centers — never drywall alone.`);
    } else if (type === 'kd_bolt') {
      // Rail A butts post B; bolt runs through B into A, crossing a barrel nut.
      const dB = Math.min(tB * 2, wB);
      pieces.push(cub('b', -dB, 0, -LB / 2, LB / 2, -wB / 2, wB / 2));
      pieces.push(cub('a', 0, LA, -wA / 2, wA / 2, -tA / 2, tA / 2));
      const inset = 28;
      pieces.push(cyl('fastener', [(-dB + inset) / 2 + 6, 0, 0], [1, 0, 0], 3, dB + inset + 12)); // M6 bolt
      pieces.push(cyl('fastener', [inset, 0, 0], [0, 0, 1], 5, Math.min(tA, 24))); // barrel nut
      labels.push(`${fmt(7)} bolt bore through the post, ${fmt(10)} barrel bore ${fmt(inset)} from the shoulder — both from the same reference face.`);
      labels.push('Steel strength, tool-free service: snug it with a hex key whenever the seasons loosen it.');
    } else {
      // Unknown joint: honest fallback — two butted blocks, no fasteners.
      pieces.push(cub('b', -tB, 0, -LB / 2, LB / 2, -wB / 2, wB / 2));
      pieces.push(cub('a', 0, LA, -wA / 2, wA / 2, -tA / 2, tA / 2));
    }

    return { pieces, insertAxis, labels, title };
  }

  BB.Joinery3D = { buildJoint, section };
})();
