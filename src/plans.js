/* Blueprint Buddy — derived plans: cut list, BOM, assembly instructions.
 * Pure functions of (corrected spec, parametric model). No state, no AI.
 */
var BB = globalThis.BB = globalThis.BB || {};

(function () {
  'use strict';
  const K = BB.K;
  const U = () => BB.Units; // display boundary — all plan math stays mm

  /* Joinery allowance table: mm added to the inserted member's cut length per
   * joint end. Phase 2 adds locking_rabbet and half_blind_dovetail rows. */
  const JOINT_ALLOWANCE = {
    butt_screws: 0, pocket_screws: 0, dowels: 0,
    dado: 6, rabbet: 6, mortise_tenon: 30,
    locking_rabbet: 6, half_blind_dovetail: 12
  };

  /* ---------------- cut list ---------------- */
  function cutList(spec, model) {
    // allowance ends per part: joints where the part is the inserted member.
    // Joints flagged noCutAllowance (rabbeted backs, notched shelves) already
    // carry the capture in their geometric size.
    const ends = {};
    for (const j of model.joints) {
      if (j.noCutAllowance) continue;
      if (JOINT_ALLOWANCE[j.type]) {
        ends[j.a] = ends[j.a] || { n: 0, type: j.type };
        ends[j.a].n++; ends[j.a].type = j.type;
      }
    }
    const rows = new Map();
    for (const p of model.parts) {
      if (p.role === 'pull') continue; // hardware, not lumber
      // Custom-grammar parts carry explicit cut dims (rotation changes the
      // oriented box, never the stick you cut); template parts derive L≥W≥T.
      const dims = p.cutDim ? [p.cutDim.L, p.cutDim.W, p.cutDim.T]
        : [p.size.w, p.size.h, p.size.d].sort((a, b) => b - a);
      let [L, W, T] = dims;
      let note = '';
      const e = ends[p.id];
      let allowance = 0;
      if (e) {
        allowance = e.n * JOINT_ALLOWANCE[e.type];
        L = Math.round((L + allowance) * 10) / 10;
        note = `includes ${U().fmtLength(allowance)} for ${K.JOINERY[e.type] ? K.JOINERY[e.type].label.toLowerCase() : e.type}`;
      }
      const angles = BB.Geo.cutAngles(p.rot);
      if (angles) note = (note ? note + ' · ' : '') + BB.Geo.angleText(angles);
      if (p.prim === 'cylinder') note = (note ? note + ' · ' : '') + 'cylinder, Ø = width';
      const mat = p.material === 'baltic_birch' ? 'baltic_birch' : spec.wood.species;
      // Identical parts from different drawers cut as one line item.
      const groupName = p.name.replace(/^Drawer \d+ /, 'Drawer ');
      const key = [groupName, L, W, T, mat, angles ? `${angles.miter}/${angles.bevel}` : ''].join('|');
      if (!rows.has(key)) {
        rows.set(key, {
          name: groupName, qty: 0, L, W, T, material: mat, note, role: p.role,
          grain: p.grain || 'length', stock: p.material === 'baltic_birch' ? 'sheet' : 'solid',
          angles, allowance, allowanceJoint: e ? e.type : null, allowanceEnds: e ? e.n : 0,
          partId: p.id, defKey: p.defKey
        });
      }
      rows.get(key).qty++;
    }
    return [...rows.values()].sort((a, b) => (b.L * b.W) - (a.L * a.W));
  }

  /* ---------------- bill of materials ----------------
   * Phase 4: when a stock plan is supplied (opts.stock), the BOM prices the
   * actual purchasable units from the optimizer — boards by nominal size and
   * stock length, sheets by whole/half/quarter — with the board-foot math
   * retained as a secondary reference line and waste percentage reported.
   * Without a plan it falls back to the Phase 1 area/volume estimate.
   */
  const BF_MM3 = 2359737; // one board foot in mm³
  function bom(spec, model, opts) {
    opts = opts || {};
    const stock = opts.stock;
    const items = [];
    const sp = K.WOOD_SPECIES[spec.wood.species];

    if (stock && stock.shopping.length) {
      for (const s of stock.shopping) {
        items.push({
          kind: s.kind === 'sheet' ? 'sheet' : 'lumber', label: s.label, qty: s.qty,
          detail: `${s.unit} each` + (s.kind === 'board' && stock.mode === 'dimensional' ? ' · from the cutting diagrams' : ''),
          price: Math.round(s.cost * 100) / 100
        });
      }
      if (stock.mode === 'dimensional' && stock.bdft.exact > 0) {
        items.push({
          kind: 'lumber', label: `(reference) rough-sawn equivalent: ${U().fmtBoardFeet(stock.bdft.withWaste)}`, qty: 1,
          detail: `≈ $${stock.bdft.cost.toFixed(2)} at $${stock.bdft.rate.toFixed(2)}/bd ft incl. 30% waste — secondary line, not added to the total`,
          price: 0
        });
      }
      const wasteBits = [];
      if (stock.wasteSolidPct != null) wasteBits.push(`solid ${stock.wasteSolidPct}%`);
      if (stock.wasteSheetPct != null) wasteBits.push(`sheet ${stock.wasteSheetPct}%`);
      if (wasteBits.length) {
        items.push({ kind: 'lumber', label: `Waste from purchasable sizes: ${wasteBits.join(' · ')}`, qty: 1, detail: 'offcuts shown hatched in the Stock tab diagrams', price: 0 });
      }
    } else {
      let solidMm3 = 0, sheetArea = { 6: 0, 12: 0, 15: 0, 18: 0 };
      for (const p of model.parts) {
        if (p.role === 'pull') continue;
        const dims = [p.size.w, p.size.h, p.size.d].sort((a, b) => b - a);
        if (p.material === 'baltic_birch') {
          const t = [6, 12, 15, 18].reduce((x, y) => Math.abs(y - dims[2]) < Math.abs(x - dims[2]) ? y : x);
          sheetArea[t] += dims[0] * dims[1];
        } else solidMm3 += p.size.w * p.size.h * p.size.d;
      }
      if (solidMm3 > 0) {
        const bf = Math.ceil(solidMm3 / BF_MM3 * 1.3 * 10) / 10; // 30% waste factor
        items.push({
          kind: 'lumber', label: `${sp.label} — ${U().fmtBoardFeet(bf)}`, qty: 1,
          detail: `cost tier ${'$'.repeat(sp.costTier)} · ~$${Math.round(bf * sp.pricePerBdFt)}`,
          price: Math.round(bf * sp.pricePerBdFt)
        });
      }
      for (const t of [6, 12, 15, 18]) {
        if (sheetArea[t] > 0) {
          const frac = sheetArea[t] / (1525 * 1525) * 1.25;
          items.push({
            kind: 'sheet', label: `Baltic birch ply ${U().fmtLength(t)}`, qty: Math.ceil(frac * 4) / 4,
            detail: `${Math.ceil(frac * 4) / 4} of a ${U().fmtSheet(1525, 1525)} sheet`, price: Math.round(frac * 70)
          });
        }
      }
    }

    // Fasteners from the joint list. Lengths render through the boundary;
    // pilot diameters are fine values (decimal inches in imperial).
    const len = mm => U().fmtLength(mm), fine = mm => U().fmtSmall(mm);
    const jc = {};
    for (const j of model.joints) jc[j.type] = (jc[j.type] || 0) + 1;
    if (jc.pocket_screws) items.push({ kind: 'fastener', label: `${len(32)} coarse pocket screws`, qty: jc.pocket_screws * 2, detail: '2 per pocket joint', price: Math.ceil(jc.pocket_screws * 2 * 0.08) });
    if (jc.butt_screws) items.push({ kind: 'fastener', label: `#8 × ${len(50)} wood screws (pilot ${fine(3.2)})`, qty: jc.butt_screws * 2, detail: '2 per butt joint, pilot-drilled', price: Math.ceil(jc.butt_screws * 2 * 0.06) });
    if (jc.dowels) items.push({ kind: 'fastener', label: `${len(8)} × ${len(40)} fluted dowels`, qty: jc.dowels * 2, detail: `2 per dowel joint (${len(8)} pilot)`, price: Math.ceil(jc.dowels * 2 * 0.1) });

    // Solid-top attachment lets the panel move.
    const topPart = model.parts.find(p => p.role === 'top' && p.material !== 'baltic_birch');
    if (topPart) items.push({ kind: 'fastener', label: `Figure-8 fasteners + #8 × ${len(16)}`, qty: 6, detail: 'top attachment — allows seasonal movement', price: 5 });

    // Drawer hardware from the fastener catalog. (M4 is a metric trade name
    // in every market; the screw length still renders through the boundary.)
    for (const d of model.drawers) {
      if (d.runner === 'side_mount_slides') {
        items.push({ kind: 'hardware', label: `${len(d.slideLen)} side-mount slides (pair)`, qty: 1, detail: `drawer ${d.index + 1}`, price: 14 });
        items.push({ kind: 'fastener', label: `M4 × ${len(16)} pan-head screws (pilot ${fine(3.0)})`, qty: 8, detail: `slide mounting, drawer ${d.index + 1}`, price: 1 });
      }
      items.push({ kind: 'hardware', label: 'Drawer pull', qty: 1, detail: `drawer ${d.index + 1}`, price: 6 });
      items.push({ kind: 'fastener', label: `#8 × ${len(25)} wood screws (pilot ${fine(2.8)})`, qty: 4, detail: `front attachment from inside, drawer ${d.index + 1}`, price: 1 });
    }
    const shelfParts = model.parts.filter(p => p.role === 'shelf');
    if (shelfParts.length && ['bookshelf', 'cabinet'].includes(spec.meta.template)) {
      // "5 mm shelf pin" IS the trade name in every market — stays literal.
      items.push({ kind: 'hardware', label: '5 mm shelf pins', qty: shelfParts.length * 4, detail: '4 per adjustable shelf', price: Math.ceil(shelfParts.length) });
    }

    // Mandatory anti-tip hardware when the stability check demands it — a
    // line item, not a suggestion.
    if (opts.integrity && opts.integrity.antiTip) {
      items.push({ kind: 'hardware', label: 'Anti-tip wall anchor kit (strap + wall screws) — REQUIRED', qty: 1, detail: 'tall or top-heavy: anchor to a stud before loading', price: 7 });
    }

    const fin = K.FINISHES.find(f => f.key === spec.finish);
    items.push({ kind: 'finish', label: fin.label, qty: 1, detail: `${fin.coats} coats · recoat ${fin.recoatHrs} h · cure ${fin.cureDays} days`, price: 18 });

    const total = Math.round(items.reduce((s, i) => s + (i.price || 0), 0) * 100) / 100;
    return { items, total };
  }

  /* ---------------- assembly instructions ---------------- */
  function step(id, title, text, partIds, opts) {
    return Object.assign({ id, title, text, partIds: partIds || [] }, opts || {});
  }
  function jointsFor(model, partIds) {
    const set = new Set(partIds);
    return model.joints.filter(j => set.has(j.a) || set.has(j.b));
  }

  function drawerSteps(spec, model, out) {
    const boxJ = K.JOINERY[spec.joinery.box];
    const len = mm => U().fmtLength(mm), fine = mm => U().fmtSmall(mm);
    for (const d of model.drawers) {
      const n = d.index + 1;
      const ids = id => d.partIds.filter(p => p.includes(id));
      const boxIds = [...ids('side'), ...ids('boxfront'), ...ids('boxback')];
      out.push(step(`dr${n}_box`, `Drawer ${n}: build the box`,
        `Join the sides, box front, and box back with ${boxJ.label.toLowerCase()}s (${len(d.box.w)} × ${len(d.box.h)} × ${len(d.box.d)} outside). Check the diagonals — square now or fight it forever.`,
        boxIds, { drawer: d.index }));
      out.push(step(`dr${n}_bottom`, `Drawer ${n}: fit the bottom`,
        `Cut a ${len(6)} groove, ${len(6)} deep, ${len(10)} up from the bottom edge. Slide in the ${len(6)} bottom — no glue, it floats.`,
        ids('bottom'), { drawer: d.index }));
      const railIds = model.parts.filter(p => p.role === 'rail').slice(d.index, d.index + 2).map(p => p.id);
      if (d.runner === 'side_mount_slides') {
        out.push(step(`dr${n}_runners`, `Drawer ${n}: mount the slides`,
          `Screw the ${len(d.slideLen)} slides level and flush to the opening sides with M4 × ${len(16)} pan-heads. A spacer block beats a tape measure here.`,
          railIds, { drawer: d.index }));
      } else {
        out.push(step(`dr${n}_runners`, `Drawer ${n}: fit wood runners`,
          `Glue and screw the hardwood runners level in the opening; wax them well.`, railIds, { drawer: d.index }));
      }
      out.push(step(`dr${n}_hang`, `Drawer ${n}: hang the box`,
        `Set the box on its runners and check it runs true with an even gap.`, boxIds.concat(ids('bottom')), { drawer: d.index }));
      out.push(step(`dr${n}_front`, `Drawer ${n}: attach the front`,
        d.frontStyle === 'inset'
          ? `Shim the ${len(d.front.w)} × ${len(d.front.h)} front in its opening with a ${fine(2)} reveal all around, then screw it from inside the box with #8 × ${len(25)} screws.`
          : `Center the ${len(d.front.w)} × ${len(d.front.h)} overlay front on the opening and screw it from inside the box with #8 × ${len(25)} screws.`,
        ids('front'), { drawer: d.index }));
      out.push(step(`dr${n}_pull`, `Drawer ${n}: add the pull`,
        `Drill for the pull at the front’s centerline and bolt it on.`, ids('pull'), { drawer: d.index }));
    }
  }

  function finishingStep(spec, out) {
    const fin = K.FINISHES.find(f => f.key === spec.finish);
    out.push(step('finish', 'Finish', `Sand to 180, break the edges, then apply ${fin.coats} coats of ${fin.label.toLowerCase()} (recoat after ${fin.recoatHrs} h, full cure in ${fin.cureDays} days). ${fin.blurb}`, []));
  }

  function assembly(spec, model, integrity) {
    const out = [];
    const t = spec.meta.template;
    const fr = K.JOINERY[spec.joinery.frame], ca = K.JOINERY[spec.joinery.case];
    const has = id => model.parts.some(p => p.id === id);
    const ids = (...xs) => xs.filter(has);

    if (t === 'custom') {
      // Novel pieces: walk the connection graph bottom-up so every step rests
      // on the one before it.
      const byId = new Map(model.parts.map(p => [p.id, p]));
      const conns = [...((spec.custom && spec.custom.connections) || [])].sort((a, b) => {
        const ya = Math.min(byId.get(a.a) ? byId.get(a.a).pos.y : 0, byId.get(a.b) ? byId.get(a.b).pos.y : 0);
        const yb = Math.min(byId.get(b.a) ? byId.get(b.a).pos.y : 0, byId.get(b.b) ? byId.get(b.b).pos.y : 0);
        return ya - yb;
      });
      out.push(step('mill', 'Mill and label every part',
        'Cut all parts to the dimensions in the cut list (angles included), then label each one in pencil.',
        model.parts.map(p => p.id)));
      conns.forEach((c, i) => {
        const a = byId.get(c.a), b = byId.get(c.b);
        if (!a || !b) return;
        const j = K.JOINERY[c.joint];
        const ang = BB.Geo.cutAngles(a.rot) || BB.Geo.cutAngles(b.rot);
        out.push(step('c' + (i + 1), `Join ${a.name.toLowerCase()} to ${b.name.toLowerCase()}`,
          `Fix ${a.name.toLowerCase()} (${c.a}) to ${b.name.toLowerCase()} (${c.b}) with ${j ? j.label.toLowerCase() + 's' : c.joint}.` +
          (ang ? ` Angled joint: ${BB.Geo.angleText(ang)} — cut per the cut list before assembly.` : '') +
          ' Dry-fit before glue.',
          [c.a, c.b]));
      });
    } else if (t === 'bookshelf') {
      out.push(step('s1', 'Join the case', `Fasten the top and bottom between the sides with ${ca.label.toLowerCase()}s. Clamp square before anything sets.`, ids('side_1', 'side_2', 'top_1', 'bottom_1')));
      const shelves = model.parts.filter(p => p.role === 'shelf').map(p => p.id);
      if (shelves.length) out.push(step('s2', 'Add the shelves', `Fit each shelf with ${ca.label.toLowerCase()}s, working bottom to top.`, shelves));
      if (has('back_1')) out.push(step('s3', 'Fit the back', 'Square the case to the back panel and fasten it — the back is what keeps everything square.', ['back_1']));
    } else if (t === 'cabinet') {
      out.push(step('s1', 'Build the carcass', `Join the bottom between the sides with ${ca.label.toLowerCase()}s.`, ids('side_1', 'side_2', 'bottom_1')));
      const rails = model.parts.filter(p => p.role === 'rail').map(p => p.id);
      if (rails.length) out.push(step('s2', 'Install the drawer rails', `Join each ${U().fmtLength(20)} × ${U().fmtLength(60)} rail into the sides with ${fr.label.toLowerCase()}s, spaced for the drawer openings.`, rails));
      if (has('back_1')) out.push(step('s3', 'Fit the back', 'Fasten the back panel — square the carcass to it first.', ['back_1']));
      if (has('plinth_1')) out.push(step('s4', 'Add the toe kick', `Fit the toe-kick board ${U().fmtLength(75)} back from the front edge.`, ['plinth_1']));
      out.push(step('s5', 'Attach the top', 'Fasten the top from below.', ['top_1']));
      const shelves = model.parts.filter(p => p.role === 'shelf').map(p => p.id);
      if (shelves.length) out.push(step('s6', 'Add the shelves', 'Set the shelves on their pins.', shelves));
      drawerSteps(spec, model, out);
    } else if (t === 'nightstand') {
      out.push(step('s1', 'Build the two side frames', `Join the side aprons to the legs with ${fr.label.toLowerCase()}s — two mirror-image assemblies.`, ids('leg_1', 'leg_2', 'leg_3', 'leg_4', 'apron_side_1', 'apron_side_2')));
      const rails = model.parts.filter(p => p.role === 'rail').map(p => p.id);
      out.push(step('s2', 'Connect with back apron and rails', `Join the back apron and the front drawer rails between the side frames with ${fr.label.toLowerCase()}s.`, ['apron_back_1', ...rails]));
      if (has('shelf_1')) out.push(step('s3', 'Fit the lower shelf', 'Notch the shelf around the legs and fasten it.', ['shelf_1']));
      out.push(step('s4', 'Attach the top', 'Fasten the top with figure-8s so it can move with the seasons.', ['top_1']));
      drawerSteps(spec, model, out);
    } else {
      out.push(step('s1', 'Build the two end frames', `Join a short apron between each leg pair with ${fr.label.toLowerCase()}s. Glue, clamp, and check for square.`, ids('leg_1', 'leg_3', 'leg_2', 'leg_4', 'apron_short_1', 'apron_short_2')));
      out.push(step('s2', 'Join the frames', `Connect the end frames with the long aprons using ${fr.label.toLowerCase()}s. Work on a flat surface so the base sits without rocking.`, ids('apron_long_1', 'apron_long_2')));
      out.push(step('s3', 'Attach the top', 'Center the top and fasten it from below with figure-8s or buttons — never glue a solid top to its base.', ['top_1']));
    }
    // Mandatory anti-tip anchoring: an instruction step, not an aside.
    if (integrity && integrity.antiTip) {
      out.push(step('antitip', 'Anchor to the wall (required)',
        'This piece is tall or top-heavy: fasten the anti-tip strap to the top rear and screw the wall side into a stud (not just drywall). Do this before loading any shelf.', []));
    }
    finishingStep(spec, out);
    // Attach joint metadata for playback highlighting.
    for (const s of out) s.joints = jointsFor(model, s.partIds).slice(0, 8);
    return out;
  }

  /* ---------------- build-mode checklist keys ----------------
   * Single source of truth for build-progress keys: the same enumeration
   * names the checkboxes in build mode, prunes stale progress after a
   * re-pack, and counts completion — so the three can never disagree. */
  function cutKey(kind, gi, ci, name, len) { return `${kind}:${gi}:${ci}:${name}:${len}`; }

  function checklistKeys(stockPlan, cut, steps) {
    const cuts = [];
    if (stockPlan) {
      stockPlan.boards.forEach((b, bi) => {
        if (!b.stockLen) return;
        b.cuts.forEach((c, ci) => cuts.push(cutKey('b', bi, ci, c.name, c.len)));
      });
      stockPlan.sheets.forEach((s, si) => {
        s.placements.forEach((p, pi) => cuts.push(cutKey('s', si, pi, p.name, Math.round(p.w))));
      });
      if (stockPlan.mode === 'rough') {
        // Rough stock expands quantity into per-piece checks.
        (cut || []).filter(r => r.stock !== 'sheet').forEach((r, ri) => {
          for (let qi = 0; qi < r.qty; qi++) cuts.push(cutKey('r', ri, qi, r.name, r.L));
        });
      }
    }
    return { cuts, steps: (steps || []).map(s => s.id) };
  }

  /* Drop progress keys that no longer exist in the live checklist — orphans
   * left behind by an older stock layout. Mutates in place. */
  function pruneProgress(progress, keys) {
    const liveCuts = new Set(keys.cuts), liveSteps = new Set(keys.steps);
    for (const k of Object.keys(progress.cuts)) if (!liveCuts.has(k)) delete progress.cuts[k];
    for (const k of Object.keys(progress.steps)) if (!liveSteps.has(k)) delete progress.steps[k];
    return progress;
  }

  BB.Plans = { cutList, bom, assembly, JOINT_ALLOWANCE, cutKey, checklistKeys, pruneProgress };
})();
