/* Blueprint Buddy — geometry math (pure, no three.js).
 * Oriented bounding boxes, hulls, and saw angles for the novel-piece grammar
 * and the structural engine. Scene convention everywhere: Y up, floor at y=0,
 * +Z toward the viewer. Rotations are degrees about world axes, applied
 * X then Y then Z (three.js mesh.rotation.set(rx, ry, rz, "ZYX")).
 */
var BB = globalThis.BB = globalThis.BB || {};

(function () {
  'use strict';

  const rad = d => (d * Math.PI) / 180;

  // World rotation M = Rz(rz)·Ry(ry)·Rx(rx) — X applied first, then Y, then Z.
  function rotMat(rxDeg, ryDeg, rzDeg) {
    const cx = Math.cos(rad(rxDeg)), sx = Math.sin(rad(rxDeg));
    const cy = Math.cos(rad(ryDeg)), sy = Math.sin(rad(ryDeg));
    const cz = Math.cos(rad(rzDeg)), sz = Math.sin(rad(rzDeg));
    return [
      [cz * cy, cz * sy * sx - sz * cx, cz * sy * cx + sz * sx],
      [sz * cy, sz * sy * sx + cz * cx, sz * sy * cx - cz * sx],
      [-sy, cy * sx, cy * cx]
    ];
  }
  const mulMV = (M, v) => [
    M[0][0] * v[0] + M[0][1] * v[1] + M[0][2] * v[2],
    M[1][0] * v[0] + M[1][1] * v[1] + M[1][2] * v[2],
    M[2][0] * v[0] + M[2][1] * v[1] + M[2][2] * v[2]
  ];

  /* OBB of a positioned model part {size:{w,h,d}, pos:{x,y,z}, rot?:{x,y,z}}. */
  function partOBB(p) {
    const r = p.rot || { x: 0, y: 0, z: 0 };
    return {
      c: [p.pos.x, p.pos.y, p.pos.z],
      e: [p.size.w / 2, p.size.h / 2, p.size.d / 2],
      R: rotMat(r.x || 0, r.y || 0, r.z || 0)
    };
  }
  function obbCorners(box) {
    const out = [];
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) {
      const w = mulMV(box.R, [sx * box.e[0], sy * box.e[1], sz * box.e[2]]);
      out.push([box.c[0] + w[0], box.c[1] + w[1], box.c[2] + w[2]]);
    }
    return out;
  }
  const col = (M, i) => [M[0][i], M[1][i], M[2][i]];
  const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const cross3 = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

  /* Separating-axis OBB test: null when separated, else minimal overlap (mm). */
  function obbPenetration(A, B) {
    const axes = [];
    for (let i = 0; i < 3; i++) axes.push(col(A.R, i));
    for (let i = 0; i < 3; i++) axes.push(col(B.R, i));
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
      const c = cross3(col(A.R, i), col(B.R, j));
      const len = Math.hypot(c[0], c[1], c[2]);
      if (len > 1e-6) axes.push([c[0] / len, c[1] / len, c[2] / len]);
    }
    const d = [B.c[0] - A.c[0], B.c[1] - A.c[1], B.c[2] - A.c[2]];
    let minOverlap = Infinity;
    for (const ax of axes) {
      const rA = A.e[0] * Math.abs(dot3(ax, col(A.R, 0))) + A.e[1] * Math.abs(dot3(ax, col(A.R, 1))) + A.e[2] * Math.abs(dot3(ax, col(A.R, 2)));
      const rB = B.e[0] * Math.abs(dot3(ax, col(B.R, 0))) + B.e[1] * Math.abs(dot3(ax, col(B.R, 1))) + B.e[2] * Math.abs(dot3(ax, col(B.R, 2)));
      const overlap = rA + rB - Math.abs(dot3(ax, d));
      if (overlap <= 0) return null;
      if (overlap < minOverlap) minOverlap = overlap;
    }
    return minOverlap;
  }

  /* Convex hull (Andrew monotone chain) of [[x,z],...], returned CCW. */
  function convexHull2D(pts) {
    const p = [...pts].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    if (p.length < 3) return p;
    const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
    const lower = [], upper = [];
    for (const pt of p) {
      while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], pt) <= 0) lower.pop();
      lower.push(pt);
    }
    for (const pt of [...p].reverse()) {
      while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], pt) <= 0) upper.pop();
      upper.push(pt);
    }
    lower.pop(); upper.pop();
    return lower.concat(upper);
  }
  /* Signed distance from point to CCW convex polygon boundary: + inside. */
  function polyInsideDistance(poly, pt) {
    if (poly.length < 3) return -Infinity;
    let min = Infinity;
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i], b = poly[(i + 1) % poly.length];
      const ex = b[0] - a[0], ez = b[1] - a[1];
      const len = Math.hypot(ex, ez) || 1;
      const d = (ex * (pt[1] - a[1]) - ez * (pt[0] - a[0])) / len;
      if (d < min) min = d;
    }
    return min;
  }

  /* Saw angles from a part rotation: deviation from the nearest square
   * orientation, rounded to 0.5°. Y-rotation reads as a miter; X/Z tilt as a
   * bevel. "Extreme" uses the effective compound angle acos(cos m · cos b). */
  function cutAngles(rot) {
    if (!rot) return null;
    const dev = a => { a = Math.abs(a) % 90; return Math.min(a, 90 - a); };
    const r05 = a => Math.round(a * 2) / 2;
    const miter = r05(dev(rot.y || 0));
    const bevel = r05(Math.max(dev(rot.x || 0), dev(rot.z || 0)));
    if (!miter && !bevel) return null;
    const effective = (Math.acos(Math.cos(rad(miter)) * Math.cos(rad(bevel))) * 180) / Math.PI;
    return { miter, bevel, compound: miter > 0 && bevel > 0, extreme: effective > 50 };
  }
  function angleText(a) {
    if (!a) return '';
    const bits = [];
    if (a.miter) bits.push(`miter ${a.miter}°`);
    if (a.bevel) bits.push(`bevel ${a.bevel}°`);
    return bits.join(', ') + (a.compound ? ' (compound)' : '');
  }

  /* World-axis extents of a (possibly rotated) part's OBB. */
  function worldExtents(p) {
    const box = partOBB(p);
    const ext = i => 2 * (box.e[0] * Math.abs(box.R[i][0]) + box.e[1] * Math.abs(box.R[i][1]) + box.e[2] * Math.abs(box.R[i][2]));
    return { x: ext(0), y: ext(1), z: ext(2) };
  }

  BB.Geo = { rotMat, mulMV, partOBB, obbCorners, obbPenetration, convexHull2D, polyInsideDistance, cutAngles, angleText, worldExtents, dot3 };
})();
