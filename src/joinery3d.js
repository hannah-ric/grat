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

  function buildJoint(type, partA, partB, fmt) {
    fmt = fmt || (v => Math.round(v) + ' mm');
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
    } else {
      // Unknown joint: honest fallback — two butted blocks, no fasteners.
      pieces.push(cub('b', -tB, 0, -LB / 2, LB / 2, -wB / 2, wB / 2));
      pieces.push(cub('a', 0, LA, -wA / 2, wA / 2, -tA / 2, tA / 2));
    }

    return { pieces, insertAxis, labels, title };
  }

  BB.Joinery3D = { buildJoint, section };
})();
