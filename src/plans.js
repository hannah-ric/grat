/* Blueprint Buddy — derived plans: cut list, BOM, assembly instructions.
 * Pure functions of (corrected spec, parametric model). No state, no AI.
 */
var BB = globalThis.BB = globalThis.BB || {};

(function () {
  'use strict';
  const K = BB.K;
  const U = () => BB.Units; // display boundary — all plan math stays mm

  /* Joinery allowance: mm added to the inserted member's cut length per joint
   * end — now MATE-THICKNESS AWARE (audit F-S1-1). A tenon can only be as
   * long as the mortised member leaves wall for (blind: mateT − 6, craft cap
   * 30); a dado/rabbet goes 1/3 of the stock deep, capped at 6. The base
   * table keeps the caps; jointAllowance() applies the mate. */
  const JOINT_ALLOWANCE = {
    butt_screws: 0, pocket_screws: 0, dowels: 0,
    dado: 6, rabbet: 6, mortise_tenon: 30,
    locking_rabbet: 6, half_blind_dovetail: 12
  };
  function jointAllowance(type, mateT) {
    const cap = JOINT_ALLOWANCE[type] || 0;
    if (!cap) return 0;
    if (mateT === undefined || !isFinite(mateT)) return cap;
    if (type === 'mortise_tenon') return Math.max(0, Math.min(cap, Math.round(mateT - 6)));
    if (type === 'half_blind_dovetail') return Math.max(0, Math.min(cap, Math.round(mateT - 4)));
    // housed joints: 1/3-depth rule, never past the table cap
    return Math.max(0, Math.min(cap, Math.floor(mateT / 3)));
  }
  /* Roles whose failure is structural: their rows carry the clear-stock note
   * (audit F-S3-7 — design values assume clear, straight-grained wood). */
  const LOAD_BEARING_ROLES = ['leg', 'apron', 'rail', 'top', 'seat', 'shelf', 'side', 'bottom', 'plinth'];

  /* ---------------- cut list ---------------- */
  function cutList(spec, model) {
    // allowance per part: joints where the part is the inserted member, each
    // end sized by ITS mate's thickness. Joints flagged noCutAllowance
    // (rabbeted backs, notched shelves) already carry the capture.
    const byId = new Map(model.parts.map(p => [p.id, p]));
    const ends = {};
    for (const j of model.joints) {
      if (j.noCutAllowance) continue;
      if (JOINT_ALLOWANCE[j.type]) {
        const mate = byId.get(j.b);
        const mateT = mate ? Math.min(mate.size.w, mate.size.h, mate.size.d) : undefined;
        const mm = jointAllowance(j.type, mateT);
        if (!mm) continue;
        ends[j.a] = ends[j.a] || { n: 0, type: j.type, mm: 0 };
        ends[j.a].n++; ends[j.a].type = j.type; ends[j.a].mm += mm;
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
        allowance = e.mm;
        L = Math.round((L + allowance) * 10) / 10;
        note = `includes ${U().fmtLength(allowance)} for ${K.JOINERY[e.type] ? K.JOINERY[e.type].label.toLowerCase() : e.type}`;
      }
      const angles = BB.Geo.cutAngles(p.rot);
      if (angles) note = (note ? note + ' · ' : '') + BB.Geo.angleText(angles);
      if (p.prim === 'cylinder') note = (note ? note + ' · ' : '') + 'cylinder, Ø = width';
      const mat = p.material === 'baltic_birch' ? 'baltic_birch' : spec.wood.species;
      if (mat !== 'baltic_birch' && (LOAD_BEARING_ROLES.includes(p.role) || p.loadBearing)) {
        note = (note ? note + ' · ' : '') + 'select straight-grained stock, free of knots';
      }
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
  const BF_MM3 = () => K.BF_MM3; // single-sourced (audit F-SYS-1)
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
      // Fallback estimate (no stock plan supplied): bins to the SAME sheet
      // standard the optimizer buys — 1220×2440, {6,12,18} (audit F-S2-5).
      const SW = K.LUMBER.SHEET.W, SL = K.LUMBER.SHEET.L;
      let solidMm3 = 0;
      const sheetArea = new Map(K.SHEET_THICKNESS.map(t => [t, 0]));
      for (const p of model.parts) {
        if (p.role === 'pull') continue;
        const dims = [p.size.w, p.size.h, p.size.d].sort((a, b) => b - a);
        if (p.material === 'baltic_birch') {
          const t = K.SHEET_THICKNESS.reduce((x, y) => Math.abs(y - dims[2]) < Math.abs(x - dims[2]) ? y : x);
          sheetArea.set(t, sheetArea.get(t) + dims[0] * dims[1]);
        } else solidMm3 += p.size.w * p.size.h * p.size.d;
      }
      if (solidMm3 > 0) {
        const bf = Math.ceil(solidMm3 / BF_MM3() * 1.3 * 10) / 10; // 30% waste factor
        items.push({
          kind: 'lumber', label: `${sp.label} — ${U().fmtBoardFeet(bf)}`, qty: 1,
          detail: `cost tier ${'$'.repeat(sp.costTier)} · ~$${Math.round(bf * sp.pricePerBdFt)}`,
          price: Math.round(bf * sp.pricePerBdFt)
        });
      }
      const sheetPrices = K.defaultPrices().sheet;
      for (const t of K.SHEET_THICKNESS) {
        if (sheetArea.get(t) > 0) {
          const frac = Math.ceil(sheetArea.get(t) / (SW * SL) * 1.25 * 4) / 4; // quarters, 25% waste
          items.push({
            kind: 'sheet', label: `Baltic birch ply ${U().fmtLength(t)}`, qty: frac,
            detail: `${frac} of a ${U().fmtSheet(SW, SL)} sheet`, price: Math.round(frac * (sheetPrices[t] || 60))
          });
        }
      }
    }

    // Fasteners: counts come from the fastener-location engine, so the
    // shopping list always matches the drilling instructions (audit F-S3-1).
    const len = mm => U().fmtLength(mm), fine = mm => U().fmtSmall(mm);
    const engineCounts = BB.Fasteners ? BB.Fasteners.countFor(spec, model) : [];
    const PRICE_EACH = { screw: 0.06, pocket: 0.08, dowel: 0.1, figure8: 0.8 };
    for (const c of engineCounts) {
      const label = c.kind === 'figure8' ? `Figure-8 fasteners + #8 × ${len(16)}` : c.spec + (c.pilotMM && c.kind === 'screw' ? ` (pilot ${fine(c.pilotMM)})` : '');
      const detail = c.kind === 'figure8' ? 'top attachment — allows seasonal movement'
        : c.kind === 'pocket' ? 'per the pocket-hole layout in the steps'
        : c.kind === 'dowel' ? `drill ${fine(c.pilotMM)}, positions in the steps`
        : 'positions and pilots in the assembly steps';
      items.push({ kind: 'fastener', label, qty: c.qty, detail, price: Math.ceil(c.qty * (PRICE_EACH[c.kind] || 0.06) * 100) / 100 });
    }

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
    /* Screwed/pocketed boxes have a relieved back: the bottom slides in from
     * the rear AFTER assembly. Grooved boxes (locking rabbet, dovetail)
     * capture the bottom on all four sides — it MUST go in during glue-up;
     * telling the builder to slide it in later is physically impossible
     * (audit F-S1-2). */
    const slideIn = spec.joinery.box === 'butt_screws' || spec.joinery.box === 'pocket_screws';
    for (const d of model.drawers) {
      const n = d.index + 1;
      const ids = id => d.partIds.filter(p => p.includes(id));
      const boxIds = [...ids('side'), ...ids('boxfront'), ...ids('boxback')];
      if (slideIn) {
        out.push(step(`dr${n}_box`, `Drawer ${n}: build the box`,
          `Join the sides, box front, and box back with ${boxJ.plural || boxJ.label.toLowerCase()} (${len(d.box.w)} × ${len(d.box.h)} × ${len(d.box.d)} outside). Check the diagonals — square now or fight it forever.`,
          boxIds, { drawer: d.index }));
        out.push(step(`dr${n}_bottom`, `Drawer ${n}: fit the bottom`,
          `Cut a ${len(6)} groove, ${len(6)} deep, ${len(10)} up from the bottom edge of the sides and front (the back is relieved). Slide in the ${len(6)} bottom from the rear — no glue, it floats.`,
          ids('bottom'), { drawer: d.index }));
      } else {
        out.push(step(`dr${n}_box`, `Drawer ${n}: groove, then build the box around its bottom`,
          `Cut a ${len(6)} groove, ${len(6)} deep, ${len(10)} up from the bottom edge of ALL FOUR box parts. Assemble with ${boxJ.plural || boxJ.label.toLowerCase()} (${len(d.box.w)} × ${len(d.box.h)} × ${len(d.box.d)} outside) WITH the ${len(6)} bottom sitting dry in its groove — it is captured on all four sides and cannot go in later. No glue on the bottom; check the diagonals before the glue sets.`,
          boxIds.concat(ids('bottom')), { drawer: d.index }));
      }
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

  /* Sanding + finishing schedule from the finish catalog (audit F-S3-3). */
  function sandingStep(spec, out) {
    const fin = K.FINISHES.find(f => f.key === spec.finish);
    const prep = fin.prep || { grits: [120, 180] };
    const ladder = prep.grits.join(' → ');
    const raise = prep.raiseGrain
      ? ` Then raise the grain: wipe with a damp rag, let it dry, and knock the fuzz back with the final grit — ${fin.label.toLowerCase()} will raise it otherwise.` : '';
    out.push(step('sand', 'Sand through the grits',
      `Work every show surface through ${ladder} grit — don't skip a grit, each one erases the last one's scratches. Break every edge with a light pass; ease corners a hand will touch.${raise} Vacuum, then tack off the dust.`, []));
  }
  function finishingStep(spec, out) {
    const fin = K.FINISHES.find(f => f.key === spec.finish);
    const prep = fin.prep || {};
    const between = prep.betweenGrit ? ` Scuff between coats at ${prep.betweenGrit} once each coat is dry to the touch.` : ' De-nib between coats with a worn abrasive pad.';
    const rag = fin.flammableRags
      ? ' SAFETY: oil-soaked rags self-heat and can ignite — lay them FLAT outdoors to dry crisp (or drown them in water) before binning. Never ball them up.' : '';
    out.push(step('finish', `Finish: ${fin.label.toLowerCase()}`,
      `Test on an offcut first. Apply ${fin.coats} coats — recoat after ${fin.recoatHrs} h.${between} Full cure takes ${fin.cureDays} days; keep loads and water off it until then. ${fin.blurb}${rag}`, []));
  }
  /* Proportionate safety notes derived from what THIS plan actually involves
   * (audit F-S3-4). */
  function safetyStep(spec, model, integrity, stockPlan, out) {
    const notes = ['Eyes and ears on for every cut; a dust mask (or extraction) for machine work and sanding.'];
    const cutRows = BB.Plans && model ? null : null;
    const hasSheet = model.parts.some(p => p.material === 'baltic_birch');
    if (hasSheet) notes.push('Full sheets are floppy and heavy — break them down on foam on the floor with a track/circular saw before any table-saw work.');
    const narrowRip = model.parts.some(p => {
      const dims = [p.size.w, p.size.h, p.size.d].sort((a, b) => b - a);
      return dims[1] < 150 && dims[0] > 300 && p.role !== 'pull';
    });
    if (narrowRip) notes.push(`Several rips finish under ${U().fmtLength(150)} wide — use a push stick and keep hands past the blade line.`);
    if (stockPlan && stockPlan.mode === 'rough') notes.push('Rough stock can hide staples and grit — inspect and scrub edges before it touches jointer knives.');
    if (integrity && integrity.antiTip) notes.push('This piece requires the wall anchor before it goes into service — it is in the steps and the BOM.');
    out.push(step('safety', 'Shop safety for this build', notes.join(' '), []));
  }
  /* Milling sequence when the stock plan says rough lumber (audit F-S3-2). */
  function millingSteps(spec, model, cut, out) {
    const thicknesses = [...new Set(cut.filter(r => r.stock !== 'sheet').map(r => r.T))].sort((a, b) => b - a);
    if (!thicknesses.length) return;
    const fmtT = thicknesses.map(t => U().fmtLength(t)).join(', ');
    out.push(step('mill_face', 'Mill: face and edge',
      'Rough lumber first: crosscut parts a hand-width over-length, then flatten one face on the jointer and square one edge to it. Mark the reference face and edge on every stick.', []));
    out.push(step('mill_thickness', 'Mill: thickness and width',
      `Plane to final thickness (${fmtT}) taking equal passes off both faces so the boards stay flat, then rip parts about ${U().fmtLength(2)} over-width and take the saw marks off back to the line.`, []));
    out.push(step('mill_length', 'Mill: square to length',
      'Square one end of each part, then cut to the exact cut-list length from that end. Let the wood rest a day after milling if it came in wet or tense.', []));
  }

  function assembly(spec, model, integrity, opts) {
    opts = opts || {};
    const out = [];
    const t = spec.meta.template;
    const fr = K.JOINERY[spec.joinery.frame], ca = K.JOINERY[spec.joinery.case];
    const frP = fr.plural || fr.label.toLowerCase(), caP = ca.plural || ca.label.toLowerCase();
    const has = id => model.parts.some(p => p.id === id);
    const ids = (...xs) => xs.filter(has);

    // Rough stock starts at the jointer, not the glue bottle (audit F-S3-2).
    if (opts.stockPlan && opts.stockPlan.mode === 'rough') {
      millingSteps(spec, model, cutList(spec, model), out);
    }

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
          `Fix ${a.name.toLowerCase()} (${c.a}) to ${b.name.toLowerCase()} (${c.b}) with ${j ? (j.plural || j.label.toLowerCase()) : c.joint}.` +
          (ang ? ` Angled joint: ${BB.Geo.angleText(ang)} — cut per the cut list before assembly.` : '') +
          ' Dry-fit before glue.',
          [c.a, c.b]));
      });
    } else if (t === 'bookshelf') {
      out.push(step('s1', 'Join the case', `Fasten the top and bottom between the sides with ${caP}. Clamp square before anything sets.`, ids('side_1', 'side_2', 'top_1', 'bottom_1')));
      const shelves = model.parts.filter(p => p.role === 'shelf').map(p => p.id);
      if (shelves.length) out.push(step('s2', 'Add the shelves', `Fit each shelf with ${caP}, working bottom to top.`, shelves));
      if (has('back_1')) out.push(step('s3', 'Fit the back', 'Square the case to the back panel and fasten it — the back is what keeps everything square.', ['back_1']));
    } else if (t === 'cabinet') {
      out.push(step('s1', 'Build the carcass', `Join the bottom between the sides with ${caP}.`, ids('side_1', 'side_2', 'bottom_1')));
      const rails = model.parts.filter(p => p.role === 'rail').map(p => p.id);
      if (rails.length) out.push(step('s2', 'Install the drawer rails', `Join each ${U().fmtLength(20)} × ${U().fmtLength(60)} rail into the sides with ${frP}, spaced for the drawer openings.`, rails));
      if (has('back_1')) out.push(step('s3', 'Fit the back', 'Fasten the back panel — square the carcass to it first.', ['back_1']));
      if (has('plinth_1')) out.push(step('s4', 'Add the toe kick', `Fit the toe-kick board ${U().fmtLength(75)} back from the front edge.`, ['plinth_1']));
      out.push(step('s5', 'Attach the top', 'Fasten the top from below.', ['top_1']));
      const shelves = model.parts.filter(p => p.role === 'shelf').map(p => p.id);
      if (shelves.length) out.push(step('s6', 'Add the shelves', 'Set the shelves on their pins.', shelves));
      drawerSteps(spec, model, out);
    } else if (t === 'nightstand') {
      out.push(step('s1', 'Build the two side frames', `Join the side aprons to the legs with ${frP} — two mirror-image assemblies.`, ids('leg_1', 'leg_2', 'leg_3', 'leg_4', 'apron_side_1', 'apron_side_2')));
      const rails = model.parts.filter(p => p.role === 'rail').map(p => p.id);
      out.push(step('s2', 'Connect with back apron and rails', `Join the back apron and the front drawer rails between the side frames with ${frP}.`, ['apron_back_1', ...rails]));
      if (has('shelf_1')) out.push(step('s3', 'Fit the lower shelf', 'Notch the shelf around the legs and fasten it.', ['shelf_1']));
      out.push(step('s4', 'Attach the top', 'Fasten the top with figure-8s so it can move with the seasons.', ['top_1']));
      drawerSteps(spec, model, out);
    } else {
      out.push(step('s1', 'Build the two end frames', `Join a short apron between each leg pair with ${frP}. Glue, clamp, and check for square.`, ids('leg_1', 'leg_3', 'leg_2', 'leg_4', 'apron_short_1', 'apron_short_2')));
      out.push(step('s2', 'Join the frames', `Connect the end frames with the long aprons using ${frP}. Work on a flat surface so the base sits without rocking.`, ids('apron_long_1', 'apron_long_2')));
      out.push(step('s3', 'Attach the top', 'Center the top and fasten it from below with figure-8s or buttons — never glue a solid top to its base.', ['top_1']));
    }
    // Mandatory anti-tip anchoring: an instruction step, not an aside.
    if (integrity && integrity.antiTip) {
      out.push(step('antitip', 'Anchor to the wall (required)',
        'This piece is tall, top-heavy, or tips with its drawers open: fasten the anti-tip strap to the top rear and screw the wall side into a stud (not just drywall). Do this before loading any shelf or drawer.', []));
    }
    safetyStep(spec, model, integrity, opts.stockPlan, out);
    sandingStep(spec, out);
    finishingStep(spec, out);
    // Attach joint metadata for playback highlighting.
    for (const s of out) s.joints = jointsFor(model, s.partIds).slice(0, 8);
    // Fastener locations & joinery setout, from the engine — the same numbers
    // the BOM counted (audit F-S3-1).
    if (BB.Fasteners) {
      for (const s of out) {
        if (!s.joints || !s.joints.length || /^(mill|sand|finish|safety|antitip)/.test(s.id)) continue;
        const note = BB.Fasteners.stepNote(spec, model, s.joints);
        if (note) s.text += ' — ' + note;
      }
    }
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

  BB.Plans = { cutList, bom, assembly, JOINT_ALLOWANCE, jointAllowance, LOAD_BEARING_ROLES, cutKey, checklistKeys, pruneProgress };
})();
