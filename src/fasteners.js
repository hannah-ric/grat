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

  const CATALOG = {
    butt_screw: { spec: '#8 × {50} wood screw', pilotMM: 3.2 },
    case_screw: { spec: '#8 × {32} wood screw', pilotMM: 2.8 },
    pocket: { spec: '{32} coarse pocket screw', pilotMM: 9.5 }, // the jig's 3/8 in stepped bit
    front_screw: { spec: '#8 × {25} wood screw', pilotMM: 2.8 },
    figure8: { spec: 'figure-8 fastener + #8 × {16}', pilotMM: 2.8 }
  };
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

    const isTopAttach = (a.role === 'top' || a.role === 'seat') && a.material !== 'baltic_birch' &&
      ['apron', 'side', 'rail'].includes(b.role);

    if (isTopAttach) {
      // Solid tops are floated: figure-8s roughly every 300 mm of run.
      const pos = positions(runMM, Math.max(2, Math.round(runMM / 300)), 300);
      const c = CATALOG.figure8;
      for (const p of pos) out.fasteners.push({ kind: 'figure8', spec: fmtSpec(c), pilotMM: c.pilotMM, alongMM: p, edgeMM: Math.min(p, runMM - p) });
      out.text = `${out.fasteners.length} figure-8 fasteners along the ${b.name.toLowerCase()}, ${len(RULES.edgeMM)} in from each end — pilot ${fine(c.pilotMM)}, and let the top move.`;
      return out;
    }

    switch (type) {
      case 'butt_screws': {
        const c = a.group !== 'frame' || b.group !== 'frame' ? CATALOG.front_screw : (runMM > 400 ? CATALOG.case_screw : CATALOG.butt_screw);
        const pos = positions(runMM, 2);
        for (const p of pos) out.fasteners.push({ kind: 'screw', spec: fmtSpec(c), pilotMM: c.pilotMM, alongMM: p, edgeMM: Math.min(p, runMM - p) });
        out.text = `${pos.length} × ${fmtSpec(c)} through ${a.name.toLowerCase()} into ${b.name.toLowerCase()}: first ${len(RULES.edgeMM)} from each end${pos.length > 2 ? `, then every ${len(Math.round((runMM - 2 * RULES.edgeMM) / (pos.length - 1)))}` : ''}, centered ${fine(mateT / 2)} from the joint line. Pilot ${fine(c.pilotMM)}.`;
        break;
      }
      case 'pocket_screws': {
        const c = CATALOG.pocket;
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
      default: {
        const c = CATALOG.case_screw;
        const pos = positions(runMM, 2);
        for (const p of pos) out.fasteners.push({ kind: 'screw', spec: fmtSpec(c), pilotMM: c.pilotMM, alongMM: p, edgeMM: Math.min(p, runMM - p) });
        out.text = `${pos.length} × ${fmtSpec(c)}, ${len(RULES.edgeMM)} from each end, pilot ${fine(c.pilotMM)}.`;
      }
    }
    return out;
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

  BB.Fasteners = { RULES, CHISELS, DOWEL_DIAMETERS, layoutForJoint, stepNote, detailRows, countFor, jointRun, positions };
})();
