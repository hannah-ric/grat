/* Blueprint Buddy — derived plans: cut list, BOM, assembly instructions.
 * Pure functions of (corrected spec, parametric model). No state, no AI.
 */
var BB = globalThis.BB = globalThis.BB || {};

(function () {
  'use strict';
  const K = BB.K;

  /* Joinery allowance table: mm added to the inserted member's cut length per
   * joint end. Phase 2 adds locking_rabbet and half_blind_dovetail rows. */
  const JOINT_ALLOWANCE = {
    butt_screws: 0, pocket_screws: 0, dowels: 0,
    dado: 6, rabbet: 6, mortise_tenon: 30,
    locking_rabbet: 6, half_blind_dovetail: 12
  };

  /* ---------------- cut list ---------------- */
  function cutList(spec, model) {
    // allowance ends per part: joints where the part is the inserted member
    const ends = {};
    for (const j of model.joints) {
      if (JOINT_ALLOWANCE[j.type]) {
        ends[j.a] = ends[j.a] || { n: 0, type: j.type };
        ends[j.a].n++; ends[j.a].type = j.type;
      }
    }
    const rows = new Map();
    for (const p of model.parts) {
      if (p.role === 'pull') continue; // hardware, not lumber
      const dims = [p.size.w, p.size.h, p.size.d].sort((a, b) => b - a);
      let [L, W, T] = dims;
      let note = '';
      const e = ends[p.id];
      if (e) {
        L = Math.round((L + e.n * JOINT_ALLOWANCE[e.type]) * 10) / 10;
        note = `includes ${e.n * JOINT_ALLOWANCE[e.type]} mm for ${K.JOINERY[e.type] ? K.JOINERY[e.type].label.toLowerCase() : e.type}`;
      }
      const mat = p.material === 'baltic_birch' ? 'baltic_birch' : spec.wood.species;
      // Identical parts from different drawers cut as one line item.
      const groupName = p.name.replace(/^Drawer \d+ /, 'Drawer ');
      const key = [groupName, L, W, T, mat].join('|');
      if (!rows.has(key)) rows.set(key, { name: groupName, qty: 0, L, W, T, material: mat, note, roles: p.role });
      rows.get(key).qty++;
    }
    return [...rows.values()].sort((a, b) => (b.L * b.W) - (a.L * a.W));
  }

  /* ---------------- bill of materials ---------------- */
  const BF_MM3 = 2359737; // one board foot in mm³
  function bom(spec, model) {
    const items = [];
    const sp = K.WOOD_SPECIES[spec.wood.species];

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
        kind: 'lumber', label: `${sp.label} — ${bf} bd ft`, qty: 1,
        detail: `cost tier ${'$'.repeat(sp.costTier)} · ~$${Math.round(bf * sp.pricePerBdFt)}`,
        price: Math.round(bf * sp.pricePerBdFt)
      });
    }
    for (const t of [6, 12, 15, 18]) {
      if (sheetArea[t] > 0) {
        const frac = sheetArea[t] / (1525 * 1525) * 1.25;
        items.push({
          kind: 'sheet', label: `Baltic birch ply ${t} mm`, qty: Math.ceil(frac * 4) / 4,
          detail: `${Math.ceil(frac * 4) / 4} of a 1525 × 1525 sheet`, price: Math.round(frac * 70)
        });
      }
    }

    // Fasteners from the joint list.
    const jc = {};
    for (const j of model.joints) jc[j.type] = (jc[j.type] || 0) + 1;
    if (jc.pocket_screws) items.push({ kind: 'fastener', label: '32 mm coarse pocket screws', qty: jc.pocket_screws * 2, detail: '2 per pocket joint', price: Math.ceil(jc.pocket_screws * 2 * 0.08) });
    if (jc.butt_screws) items.push({ kind: 'fastener', label: '#8 × 50 mm wood screws (pilot 3.2 mm)', qty: jc.butt_screws * 2, detail: '2 per butt joint, pilot-drilled', price: Math.ceil(jc.butt_screws * 2 * 0.06) });
    if (jc.dowels) items.push({ kind: 'fastener', label: '8 × 40 mm fluted dowels', qty: jc.dowels * 2, detail: '2 per dowel joint (8 mm pilot)', price: Math.ceil(jc.dowels * 2 * 0.1) });

    // Solid-top attachment lets the panel move.
    const topPart = model.parts.find(p => p.role === 'top' && p.material !== 'baltic_birch');
    if (topPart) items.push({ kind: 'fastener', label: 'Figure-8 fasteners + #8 × 16 mm', qty: 6, detail: 'top attachment — allows seasonal movement', price: 5 });

    // Drawer hardware from the fastener catalog.
    for (const d of model.drawers) {
      if (d.runner === 'side_mount_slides') {
        items.push({ kind: 'hardware', label: `${d.slideLen} mm side-mount slides (pair)`, qty: 1, detail: `drawer ${d.index + 1}`, price: 14 });
        items.push({ kind: 'fastener', label: 'M4 × 16 mm pan-head screws (pilot 3.0 mm)', qty: 8, detail: `slide mounting, drawer ${d.index + 1}`, price: 1 });
      }
      items.push({ kind: 'hardware', label: 'Drawer pull', qty: 1, detail: `drawer ${d.index + 1}`, price: 6 });
      items.push({ kind: 'fastener', label: '#8 × 25 mm wood screws (pilot 2.8 mm)', qty: 4, detail: `front attachment from inside, drawer ${d.index + 1}`, price: 1 });
    }
    const shelfParts = model.parts.filter(p => p.role === 'shelf');
    if (shelfParts.length && ['bookshelf', 'cabinet'].includes(spec.meta.template)) {
      items.push({ kind: 'hardware', label: '5 mm shelf pins', qty: shelfParts.length * 4, detail: '4 per adjustable shelf', price: Math.ceil(shelfParts.length) });
    }

    const fin = K.FINISHES.find(f => f.key === spec.finish);
    items.push({ kind: 'finish', label: fin.label, qty: 1, detail: `${fin.coats} coats · recoat ${fin.recoatHrs} h · cure ${fin.cureDays} days`, price: 18 });

    const total = items.reduce((s, i) => s + (i.price || 0), 0);
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
    for (const d of model.drawers) {
      const n = d.index + 1;
      const ids = id => d.partIds.filter(p => p.includes(id));
      const boxIds = [...ids('side'), ...ids('boxfront'), ...ids('boxback')];
      out.push(step(`dr${n}_box`, `Drawer ${n}: build the box`,
        `Join the sides, box front, and box back with ${boxJ.label.toLowerCase()}s (${d.box.w} × ${d.box.h} × ${d.box.d} mm outside). Check the diagonals — square now or fight it forever.`,
        boxIds, { drawer: d.index }));
      out.push(step(`dr${n}_bottom`, `Drawer ${n}: fit the bottom`,
        `Cut a 6 mm groove, 6 mm deep, 10 mm up from the bottom edge. Slide in the 6 mm bottom — no glue, it floats.`,
        ids('bottom'), { drawer: d.index }));
      const railIds = model.parts.filter(p => p.role === 'rail').slice(d.index, d.index + 2).map(p => p.id);
      if (d.runner === 'side_mount_slides') {
        out.push(step(`dr${n}_runners`, `Drawer ${n}: mount the slides`,
          `Screw the ${d.slideLen} mm slides level and flush to the opening sides with M4 × 16 mm pan-heads. A spacer block beats a tape measure here.`,
          railIds, { drawer: d.index }));
      } else {
        out.push(step(`dr${n}_runners`, `Drawer ${n}: fit wood runners`,
          `Glue and screw the hardwood runners level in the opening; wax them well.`, railIds, { drawer: d.index }));
      }
      out.push(step(`dr${n}_hang`, `Drawer ${n}: hang the box`,
        `Set the box on its runners and check it runs true with an even gap.`, boxIds.concat(ids('bottom')), { drawer: d.index }));
      out.push(step(`dr${n}_front`, `Drawer ${n}: attach the front`,
        d.frontStyle === 'inset'
          ? `Shim the ${d.front.w} × ${d.front.h} mm front in its opening with a 2 mm reveal all around, then screw it from inside the box with #8 × 25 mm screws.`
          : `Center the ${d.front.w} × ${d.front.h} mm overlay front on the opening and screw it from inside the box with #8 × 25 mm screws.`,
        ids('front'), { drawer: d.index }));
      out.push(step(`dr${n}_pull`, `Drawer ${n}: add the pull`,
        `Drill for the pull at the front’s centerline and bolt it on.`, ids('pull'), { drawer: d.index }));
    }
  }

  function finishingStep(spec, out) {
    const fin = K.FINISHES.find(f => f.key === spec.finish);
    out.push(step('finish', 'Finish', `Sand to 180, break the edges, then apply ${fin.coats} coats of ${fin.label.toLowerCase()} (recoat after ${fin.recoatHrs} h, full cure in ${fin.cureDays} days). ${fin.blurb}`, []));
  }

  function assembly(spec, model) {
    const out = [];
    const t = spec.meta.template;
    const fr = K.JOINERY[spec.joinery.frame], ca = K.JOINERY[spec.joinery.case];
    const has = id => model.parts.some(p => p.id === id);
    const ids = (...xs) => xs.filter(has);

    if (t === 'bookshelf') {
      out.push(step('s1', 'Join the case', `Fasten the top and bottom between the sides with ${ca.label.toLowerCase()}s. Clamp square before anything sets.`, ids('side_1', 'side_2', 'top_1', 'bottom_1')));
      const shelves = model.parts.filter(p => p.role === 'shelf').map(p => p.id);
      if (shelves.length) out.push(step('s2', 'Add the shelves', `Fit each shelf with ${ca.label.toLowerCase()}s, working bottom to top.`, shelves));
      if (has('back_1')) out.push(step('s3', 'Fit the back', 'Square the case to the back panel and fasten it — the back is what keeps everything square.', ['back_1']));
    } else if (t === 'cabinet') {
      out.push(step('s1', 'Build the carcass', `Join the bottom between the sides with ${ca.label.toLowerCase()}s.`, ids('side_1', 'side_2', 'bottom_1')));
      const rails = model.parts.filter(p => p.role === 'rail').map(p => p.id);
      if (rails.length) out.push(step('s2', 'Install the drawer rails', `Join each 20 × 60 mm rail into the sides with ${fr.label.toLowerCase()}s, spaced for the drawer openings.`, rails));
      if (has('back_1')) out.push(step('s3', 'Fit the back', 'Fasten the back panel — square the carcass to it first.', ['back_1']));
      if (has('plinth_1')) out.push(step('s4', 'Add the toe kick', 'Fit the toe-kick board 75 mm back from the front edge.', ['plinth_1']));
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
    finishingStep(spec, out);
    // Attach joint metadata for playback highlighting.
    for (const s of out) s.joints = jointsFor(model, s.partIds).slice(0, 8);
    return out;
  }

  BB.Plans = { cutList, bom, assembly, JOINT_ALLOWANCE };
})();
