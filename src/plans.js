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
    locking_rabbet: 6, half_blind_dovetail: 12,
    /* 2026 expansion — every joint decides its allowance explicitly.
     * Zeros are real: laps and bridles overlap inside existing length, loose
     * tenons are separate stock, cleats/bolts/biscuits add no length.
     * Through joints (box, through dovetail, splined miter, staked tenon)
     * run the FULL mate thickness — the value below is the cap. */
    edge_glue: 0, half_lap: 0, cross_lap: 0, bridle: 0, loose_tenon: 0,
    biscuits: 0, french_cleat: 0, kd_bolt: 0,
    box_joint: 32, through_dovetail: 32, miter_spline: 32, staked_tenon: 65,
    sliding_dovetail: 6
  };
  const THROUGH_JOINTS = ['box_joint', 'through_dovetail', 'miter_spline', 'staked_tenon'];
  function jointAllowance(type, mateT) {
    const cap = JOINT_ALLOWANCE[type] || 0;
    if (!cap) return 0;
    if (mateT === undefined || !isFinite(mateT)) return cap;
    if (type === 'mortise_tenon') return Math.max(0, Math.min(cap, Math.round(mateT - 6)));
    if (type === 'half_blind_dovetail') return Math.max(0, Math.min(cap, Math.round(mateT - 4)));
    // through joints: the inserted member crosses the whole mate
    if (THROUGH_JOINTS.includes(type)) return Math.max(0, Math.min(cap, Math.round(mateT)));
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
      if (p.role === 'pull' || p.hardware) continue; // hardware, not lumber
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
      const mat = K.WOOD_SPECIES[p.material] ? p.material : spec.wood.species;
      const isSheet = !!(K.WOOD_SPECIES[mat] && K.WOOD_SPECIES[mat].sheet);
      if (!isSheet && (LOAD_BEARING_ROLES.includes(p.role) || p.loadBearing)) {
        note = (note ? note + ' · ' : '') + 'select straight-grained stock, free of knots';
      }
      // Identical parts from different drawers cut as one line item.
      const groupName = p.name.replace(/^Drawer \d+ /, 'Drawer ');
      const key = [groupName, L, W, T, mat, angles ? `${angles.miter}/${angles.bevel}` : ''].join('|');
      if (!rows.has(key)) {
        rows.set(key, {
          name: groupName, qty: 0, L, W, T, material: mat, note, role: p.role,
          grain: p.grain || 'length', stock: isSheet ? 'sheet' : 'solid',
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
        if (p.role === 'pull' || p.hardware) continue;
        const dims = [p.size.w, p.size.h, p.size.d].sort((a, b) => b - a);
        if (K.WOOD_SPECIES[p.material] && K.WOOD_SPECIES[p.material].sheet) {
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
      const sheetSp = K.WOOD_SPECIES[spec.wood.sheetSpecies] || K.WOOD_SPECIES.baltic_birch;
      for (const t of K.SHEET_THICKNESS) {
        if (sheetArea.get(t) > 0) {
          const frac = Math.ceil(sheetArea.get(t) / (SW * SL) * 1.25 * 4) / 4; // quarters, 25% waste
          items.push({
            kind: 'sheet', label: `${sheetSp.label} ${U().fmtLength(t)}`, qty: frac,
            detail: `${frac} of a ${U().fmtSheet(SW, SL)} sheet`, price: Math.round(frac * K.sheetPriceFor(null, sheetSp.key, t))
          });
        }
      }
    }

    // Fasteners: counts come from the fastener-location engine, so the
    // shopping list always matches the drilling instructions (audit F-S3-1).
    // Every non-lumber price routes through the user-editable table
    // (prices.hardware) with the catalog defaults as fallback.
    const len = mm => U().fmtLength(mm), fine = mm => U().fmtSmall(mm);
    const hp = (key, fallback) => K.hardwarePrice(opts.prices, key, fallback);
    const engineCounts = BB.Fasteners ? BB.Fasteners.countFor(spec, model) : [];
    const PRICE_EACH = {
      screw: 0.06, pocket: 0.08, dowel: 0.1, figure8: 0.8,
      biscuit: 0.15, loose_tenon: 0.5, kd_bolt: 1.5, spline: 0.4
    };
    for (const c of engineCounts) {
      const label = c.kind === 'figure8' ? `Figure-8 fasteners + #8 × ${len(16)}` : c.spec + (c.pilotMM && c.kind === 'screw' ? ` (pilot ${fine(c.pilotMM)})` : '');
      const detail = c.kind === 'figure8' ? 'top attachment — allows seasonal movement'
        : c.kind === 'pocket' ? 'per the pocket-hole layout in the steps'
        : c.kind === 'dowel' ? `drill ${fine(c.pilotMM)}, positions in the steps`
        : c.kind === 'biscuit' ? 'slot positions in the assembly steps'
        : c.kind === 'loose_tenon' ? 'mortise setout in the assembly steps'
        : c.kind === 'kd_bolt' ? 'bolt and barrel bores in the assembly steps'
        : 'positions and pilots in the assembly steps';
      items.push({ kind: 'fastener', label, qty: c.qty, detail, price: Math.ceil(c.qty * hp(c.kind, PRICE_EACH[c.kind] || 0.06) * 100) / 100 });
    }

    // Glue: code names the bottle (2026 expansion) — food contact, outdoor
    // duty, and oily species change the answer, so "glue" alone is not a plan.
    if (model.parts.length > 1) {
      const rec = K.recommendGlue(spec);
      if (rec && rec.glue) {
        items.push({
          kind: 'glue', label: rec.glue.label, qty: 1,
          detail: `${rec.why} · open ${rec.glue.openMin} min · clamp ${rec.glue.clampMin} min · full strength ${rec.glue.cureHrs} h`,
          price: hp('glue_' + rec.glue.key, rec.glue.price)
        });
      }
    }

    // Drawer hardware from the fastener catalog. (M4 is a metric trade name
    // in every market; the screw length still renders through the boundary.)
    // Slides are picked by computed load via the same pure function the
    // integrity check uses; pulls carry their style, spacing, and bores.
    const DENSITY_KG_PER_L = 0.24;
    for (const d of model.drawers) {
      if (d.runner === 'side_mount_slides' || d.runner === 'undermount_slides') {
        const volL = Math.max(0, (d.box.w - 2 * d.box.t) * (d.box.h - d.box.t) * (d.box.d - d.box.t)) * 1e-6;
        const picked = BB.HW ? BB.HW.slidePick(volL * DENSITY_KG_PER_L, { undermount: d.runner === 'undermount_slides' }) : null;
        if (picked && picked.key === 'side_bb_34') {
          items.push({ kind: 'hardware', label: `${len(d.slideLen)} side-mount slides (pair)`, qty: 1, detail: `drawer ${d.index + 1}`, price: hp('slide_side_bb_34', 14) });
        } else if (picked) {
          items.push({ kind: 'hardware', label: `${len(d.slideLen)} ${picked.label.toLowerCase()}`, qty: 1, detail: `drawer ${d.index + 1} — picked for the computed load`, price: hp('slide_' + picked.key, picked.price) });
        } else {
          items.push({ kind: 'hardware', label: `${len(d.slideLen)} side-mount slides (pair)`, qty: 1, detail: `drawer ${d.index + 1}`, price: hp('slide_side_bb_34', 14) });
        }
        items.push({ kind: 'fastener', label: `M4 × ${len(16)} pan-head screws (pilot ${fine(3.0)})`, qty: 8, detail: `slide mounting, drawer ${d.index + 1}`, price: hp('screw_pack', 1) });
      }
      // Pull lines print the EFFECTIVE style — what pullSpec actually fitted
      // — so the label and the boring instructions can never disagree. A
      // substitution (front too narrow for the requested style) says so.
      const pull = d.pull || { styleKey: 'bar_pull', style: 'bar_pull', count: 1, ctcMM: 0, holes: 2 };
      const effKey = pull.style || pull.styleKey;
      const pStyle = BB.HW && BB.HW.PULLS[effKey];
      const reqStyle = BB.HW && BB.HW.PULLS[pull.styleKey];
      const subNote = pull.substituted && reqStyle && pStyle && reqStyle.key !== pStyle.key
        ? ` · front too narrow for ${reqStyle.label.toLowerCase()}s — substituted` : '';
      if (effKey === 'none_touch') {
        items.push({ kind: 'hardware', label: 'Magnetic touch latch (push-to-open)', qty: 1, detail: `drawer ${d.index + 1} — needs a ${len(2)} to ${len(3)} front gap`, price: hp('pull_none_touch', 6) });
      } else if (pStyle) {
        const boreDetail = pull.holes === 0
          ? (effKey === 'edge_pull'
            ? `screws into the front’s top edge — pre-drill, this is end grain`
            : `template-routed mortise in the face — nothing proud`)
          : pull.ctcMM
            ? `${pull.holes} × ${fine(5)} through-bores, ${len(pull.ctcMM)} centers · M4 × ${len(BB.HW.pullScrewLenMM(d.box.t + d.front.t))} (crosses box front + front)`
            : `one ${fine(pStyle.boreDia || 5)} bore, centered${effKey === 'knob_turned_wood' ? ' — wedged tenon, no screw' : ` · M4 × ${len(BB.HW.pullScrewLenMM(d.box.t + d.front.t))} (crosses box front + front)`}`;
        items.push({ kind: 'hardware', label: pull.count > 1 ? `${pStyle.label} (pair)` : pStyle.label, qty: pull.count, detail: `drawer ${d.index + 1} — ${boreDetail}${subNote}`, price: hp('pull_' + pStyle.key, pStyle.price) * pull.count });
      } else {
        items.push({ kind: 'hardware', label: 'Drawer pull', qty: 1, detail: `drawer ${d.index + 1}`, price: hp('pull_bar_pull', 6) });
      }
      items.push({ kind: 'fastener', label: `#8 × ${len(25)} wood screws (pilot ${fine(2.8)})`, qty: 4, detail: `front attachment from inside, drawer ${d.index + 1}`, price: hp('screw_pack', 1) });
    }
    // No shelf-pin line: every template shelf is JOINED to the sides (the
    // model, cut list, and structural engine all treat it as fixed), so pins
    // would be phantom hardware nothing installs (audit FE-C1/H-02). Pins
    // return when a genuinely adjustable-shelf option exists in the model.

    // Mandatory anti-tip hardware when the stability check demands it — a
    // line item, not a suggestion.
    if (opts.integrity && opts.integrity.antiTip) {
      items.push({ kind: 'hardware', label: 'Anti-tip wall anchor kit (strap + wall screws) — REQUIRED', qty: 1, detail: 'tall or top-heavy: anchor to a stud before loading', price: hp('antitip_kit', 7) });
    }

    const fin = K.FINISHES.find(f => f.key === spec.finish);
    items.push({ kind: 'finish', label: fin.label, qty: 1, detail: `${fin.coats} coats · recoat ${fin.recoatHrs} h · cure ${fin.cureDays} days`, price: hp('finish_flat', 18) });

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

  function drawerSteps(spec, model, out, opts) {
    opts = opts || {};
    // The user's climate preference reaches the bench: ΔMC drives the
    // wooden-runner fitting clearance, exactly as it drives the movement
    // checks. Default temperate — a plan without a stated climate keeps
    // the 4% swing.
    const climate = K.CLIMATE_DMC[opts.climate] !== undefined ? opts.climate : 'temperate';
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
      const gearIds = railIds.concat(d.gearIds || []);
      if (d.runner === 'side_mount_slides') {
        out.push(step(`dr${n}_runners`, `Drawer ${n}: mount the slides`,
          `Screw the ${len(d.slideLen)} slides level and flush to the opening sides with M4 × ${len(16)} pan-heads. A spacer block beats a tape measure here.`,
          gearIds, { drawer: d.index }));
      } else if (d.runner === 'undermount_slides') {
        out.push(step(`dr${n}_runners`, `Drawer ${n}: mount the undermount slides`,
          `Screw the ${len(d.slideLen)} undermount slides to the case floor of the opening, dead parallel and flush to the front edge. The box was built to the slide — width = opening − ${len(27)}, depth exactly ${len(d.slideLen)}, bottom recessed ${fine(12.7)} — so notch the box back for the hooks and press the locking clips on under the front corners.`,
          gearIds, { drawer: d.index }));
      } else {
        const sp = K.WOOD_SPECIES[spec.wood.species];
        const clr = BB.HW ? BB.HW.drawerVerticalClearance(d.box.h, spec.wood.species, K.CLIMATE_DMC[climate]) : 2;
        out.push(step(`dr${n}_runners`, `Drawer ${n}: fit wood runners`,
          `Glue and screw the hardwood runners level in the opening (they're in the cut list), with the rail above as the kicker so the box cannot tip open. Fit the box with ${fine(1)} per side and ${fine(clr)} of vertical clearance — that number is this drawer's computed seasonal movement (${sp.label.toLowerCase()}, ${climate} indoor swing), not a guess${sp.movement === 'high' ? '; quartersawn sides would halve it' : ''}. Wax the meeting surfaces with paraffin.`,
          gearIds, { drawer: d.index }));
      }
      out.push(step(`dr${n}_hang`, `Drawer ${n}: hang the box`,
        `Set the box on its runners and check it runs true with an even gap.`, boxIds.concat(ids('bottom')), { drawer: d.index }));
      out.push(step(`dr${n}_front`, `Drawer ${n}: attach the front`,
        d.frontStyle === 'inset'
          ? `Shim the ${len(d.front.w)} × ${len(d.front.h)} front in its opening with a ${fine(2)} reveal all around, then screw it from inside the box with #8 × ${len(25)} screws.`
          : `Center the ${len(d.front.w)} × ${len(d.front.h)} overlay front on the opening and screw it from inside the box with #8 × ${len(25)} screws.`,
        ids('front'), { drawer: d.index }));
      // Steps speak the EFFECTIVE style — the one pullSpec actually fitted.
      const pull = d.pull || { styleKey: 'bar_pull', style: 'bar_pull', count: 1, ctcMM: 0 };
      const pEff = pull.style || pull.styleKey;
      const pRow = BB.HW && BB.HW.PULLS[pEff];
      const pReq = BB.HW && BB.HW.PULLS[pull.styleKey];
      const pSub = pull.substituted && pReq && pRow && pReq.key !== pRow.key
        ? ` (The front is too narrow for ${pReq.label.toLowerCase()}s — a ${pRow.label.toLowerCase()} is fitted instead.)` : '';
      let pullText;
      if (pEff === 'none_touch') {
        pullText = `No pull on this front: fit the magnetic touch latch behind it, striker on the box — press to pop open. It needs ${fine(2)} to ${fine(3)} of travel in the reveal.`;
      } else if (pull.holes === 0) {
        pullText = pEff === 'edge_pull'
          ? `Screw the edge pull to the front’s TOP EDGE, centered — pre-drill every hole, this is end grain and it splits without pilots.${pSub}`
          : `Rout the flush-pull mortise with the maker’s template, centered on the front — freehand walls show through the finish forever.${pSub}`;
      } else if (pull.ctcMM) {
        pullText = `Bore ${pull.holes} × ${fine(5)} through-holes at ${len(pull.ctcMM)} centers, ${pull.count > 1 ? 'two pulls at the 1/3 and 2/3 points, ' : ''}on the front's centerline — every front in the stack shares ONE centerline (a story stick beats a tape). Bore through BOTH the false front and the box front behind it: the M4 × ${len(BB.HW.pullScrewLenMM(d.box.t + d.front.t))} screws drive from inside the box and cross both.${pSub}`;
      } else {
        pullText = `Bore one ${fine((pRow && pRow.boreDia) || 5)} hole at the front's center${pEff === 'knob_turned_wood' ? ' — glue the knob’s tenon in and wedge it from inside, wedge ACROSS the front’s grain' : `, M4 × ${len(BB.HW.pullScrewLenMM(d.box.t + d.front.t))} from inside — through the box front too`}. Every front in the stack shares one centerline.${pSub}`;
      }
      out.push(step(`dr${n}_pull`, `Drawer ${n}: ${pEff === 'none_touch' ? 'fit the touch latch' : 'add the pull'}`,
        pullText, ids('pull'), { drawer: d.index }));
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
    const isSheetMat = m => !!(K.WOOD_SPECIES[m] && K.WOOD_SPECIES[m].sheet);
    const hasSheet = model.parts.some(p => isSheetMat(p.material));
    if (hasSheet) notes.push('Full sheets are floppy and heavy — break them down on foam on the floor with a track/circular saw before any table-saw work.');
    if (model.parts.some(p => p.material === 'mdf')) notes.push('MDF dust is fine and binder-laden — this build wants real dust extraction, not just a mask.');
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

    /* Panel glue-ups and laminations from the stock plan are real bench
     * steps with a real clamp schedule — before this, the optimizer could
     * demand a three-strip seat and the steps never mentioned building it.
     * The clamp arithmetic is the edge_glue joint's own schedule
     * (BB.Fasteners.glueupSchedule), so the packing layer and the joinery
     * knowledge finally speak with one voice. */
    if (opts.stockPlan) {
      const fmtL = mm => U().fmtLength(mm);
      // Identical panels group into one step (× N) — two matching case
      // sides are one bench operation repeated, not two instructions.
      const grouped = list => {
        const m = new Map();
        for (const g of list) {
          const k = [g.name, g.n, g.nominal, g.W, g.T, g.L].join('|');
          if (!m.has(k)) m.set(k, Object.assign({ qty: 0 }, g));
          m.get(k).qty++;
        }
        return [...m.values()];
      };
      grouped(opts.stockPlan.glueups || []).forEach((g, i) => {
        const sch = BB.Fasteners && BB.Fasteners.glueupSchedule ? BB.Fasteners.glueupSchedule(g.L || 600) : null;
        out.push(step('glueup' + (i + 1), `Glue up: ${g.name.toLowerCase()}${g.qty > 1 ? ` (× ${g.qty})` : ''}`,
          `Edge-glue ${g.qty > 1 ? `${g.qty} panels, each ` : ''}${g.n} × ${g.nominal} strips (long grain to long grain — the joint outlasts the wood), then rip and crosscut to ${fmtL(g.L)} × ${fmtL(g.W)}. ${sch ? sch.text : 'Alternate clamps over and under; check flat with a straightedge.'}`, []));
      });
      grouped(opts.stockPlan.laminations || []).forEach((l, i) => {
        out.push(step('lam' + (i + 1), `Laminate: ${l.name.toLowerCase()}${l.qty > 1 ? ` (× ${l.qty})` : ''}`,
          `Face-laminate ${l.qty > 1 ? `${l.qty} blanks, each ` : ''}${l.n} × ${l.nominal} layers with the crowns opposed, clamp from the center outward on both faces, and plane to ${fmtL(l.T)} once cured — equal passes off both faces so it stays straight.`, []));
      });
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
      /* One carcass glue-up: with mortise-&-tenon (or doweled) rails the
       * sides cannot spread to seat the rails once the bottom is glued —
       * bottom, sides, and every front rail go together (audit FE-H3). */
      const rails = model.parts.filter(p => p.role === 'rail').map(p => p.id);
      out.push(step('s1', 'Build the carcass — one glue-up',
        `Dry-fit the bottom AND all ${rails.length} drawer rails between the sides first — once the sides are glued they cannot spread to seat the rails. Then glue it all in one clamp-up: bottom to sides with ${caP}, each ${U().fmtLength(20)} × ${U().fmtLength(60)} rail into the sides with ${frP}, spaced for the drawer openings. Check the diagonals before the glue sets.`,
        ids('side_1', 'side_2', 'bottom_1').concat(rails)));
      const shelves = model.parts.filter(p => p.role === 'shelf').map(p => p.id);
      const housedShelf = ['dado', 'sliding_dovetail', 'rabbet'].includes(spec.joinery.case);
      if (shelves.length) out.push(step('s2', 'Fit the shelves',
        `Fit each shelf with ${caP} now, while the back is open${housedShelf ? ' — a housed shelf slides in from the back and CANNOT go in after the back panel is on' : ''}.`, shelves));
      if (has('back_1')) out.push(step('s3', 'Fit the back', 'Fasten the back panel — square the carcass to it first.', ['back_1']));
      if (has('plinth_1')) out.push(step('s4', 'Add the toe kick', `Fit the toe-kick board ${U().fmtLength(75)} back from the front edge.`, ['plinth_1']));
      out.push(step('s5', 'Attach the top', 'Fasten the top from below.', ['top_1']));
      drawerSteps(spec, model, out, opts);
    } else if (t === 'nightstand') {
      out.push(step('s1', 'Build the two side frames', `Join the side aprons to the legs with ${frP} — two mirror-image assemblies.`, ids('leg_1', 'leg_2', 'leg_3', 'leg_4', 'apron_side_1', 'apron_side_2')));
      const rails = model.parts.filter(p => p.role === 'rail').map(p => p.id);
      out.push(step('s2', 'Connect with back apron and rails', `Join the back apron and the front drawer rails between the side frames with ${frP}.`, ['apron_back_1', ...rails]));
      if (has('shelf_1')) out.push(step('s3', 'Fit the lower shelf', 'Notch the shelf around the legs and fasten it.', ['shelf_1']));
      out.push(step('s4', 'Attach the top', 'Fasten the top with figure-8s so it can move with the seasons.', ['top_1']));
      drawerSteps(spec, model, out, opts);
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
  /* ---------------- tools & time (Phase 5 shop-truth) ----------------
   * The consolidated tool wall: a base kit every build needs, plus what the
   * joints actually in this model demand (from the knowledge base), plus
   * operation-driven extras read off the real plan — never declared by hand.
   */
  const BASE_TOOLS = [
    'Tape measure', 'Combination square', 'Table saw or circular saw with a guide',
    'Drill/driver', 'Bar or pipe clamps', 'Sandpaper (120 / 180 / 220 grit)'
  ];
  const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
  function toolList(spec, model, stockPlan) {
    const tools = new Set(BASE_TOOLS);
    for (const t of new Set(model.joints.map(j => j.type))) {
      for (const tool of (K.JOINERY[t] ? K.JOINERY[t].tools : [])) tools.add(cap(tool));
    }
    if (model.parts.some(p => BB.Geo.cutAngles(p.rot))) tools.add('Miter saw (angled cuts)');
    if (model.parts.some(p => K.WOOD_SPECIES[p.material] && K.WOOD_SPECIES[p.material].sheet)) tools.add('Circular saw + straightedge (sheet breakdown)');
    if (stockPlan && ((stockPlan.glueups || []).length || (stockPlan.laminations || []).length)) {
      tools.add('Glue + cauls (panel glue-up)');
      if ((stockPlan.laminations || []).length) tools.add('Hand plane or thickness planer (laminations)');
    }
    if (model.drawers && model.drawers.length) tools.add('Shims + spacers (drawer fitting)');
    const fin = K.FINISHES.find(f => f.key === spec.finish);
    if (fin) tools.add(`Rags / applicator (${fin.label.toLowerCase()})`);
    return [...tools];
  }

  /* Shop-time estimate: per-operation minutes × counts from the real plan,
   * scaled by skill level (beginners measure twice — and should). Active
   * bench time only; finish recoat/cure wall time is reported separately.
   * Every number here is a count × constant — no geometry, no AI. */
  const OP_MINUTES = {
    solidCut: 5, sheetCut: 8, sand: 4, assemblyStep: 10,
    glueUp: 30, lamination: 25, finishCoat: 20,
    joint: {
      butt_screws: 6, pocket_screws: 8, dowels: 12, dado: 15, rabbet: 12,
      locking_rabbet: 15, mortise_tenon: 40, half_blind_dovetail: 60,
      /* 2026 expansion — minutes per physical joint, same scale */
      edge_glue: 15, half_lap: 20, cross_lap: 20, bridle: 35, loose_tenon: 18,
      box_joint: 25, through_dovetail: 60, sliding_dovetail: 30, miter_spline: 18,
      staked_tenon: 25, biscuits: 6, french_cleat: 12, kd_bolt: 12
    }
  };
  const LEVEL_FACTOR = { beginner: 1.5, intermediate: 1.2, advanced: 1 };
  function timeEstimate(spec, model, cut, steps, stockPlan) {
    const breakdown = [];
    const add = (label, min) => { if (min > 0) breakdown.push({ label, min: Math.round(min) }); };
    const solidSticks = cut.filter(r => r.stock !== 'sheet').reduce((n, r) => n + r.qty, 0);
    const sheetPieces = cut.filter(r => r.stock === 'sheet').reduce((n, r) => n + r.qty, 0);
    add(`${solidSticks} board cuts`, solidSticks * OP_MINUTES.solidCut);
    add(`${sheetPieces} sheet cuts`, sheetPieces * OP_MINUTES.sheetCut);
    const byJoint = new Map();
    for (const j of model.joints) byJoint.set(j.type, (byJoint.get(j.type) || 0) + 1);
    for (const [type, n] of byJoint) {
      const label = K.JOINERY[type] ? K.JOINERY[type].label.toLowerCase() : type;
      add(`${n} × ${label}`, n * (OP_MINUTES.joint[type] || 10));
    }
    const glueups = stockPlan ? (stockPlan.glueups || []).length : 0;
    const laminations = stockPlan ? (stockPlan.laminations || []).length : 0;
    add(`${glueups} panel glue-up${glueups === 1 ? '' : 's'}`, glueups * OP_MINUTES.glueUp);
    add(`${laminations} lamination${laminations === 1 ? '' : 's'}`, laminations * OP_MINUTES.lamination);
    add('Sanding', model.parts.length * OP_MINUTES.sand);
    add(`${steps.length} assembly steps`, steps.length * OP_MINUTES.assemblyStep);
    const fin = K.FINISHES.find(f => f.key === spec.finish);
    const coats = fin ? fin.coats : 0;
    add(`${coats} finish coats`, coats * OP_MINUTES.finishCoat);
    const factor = LEVEL_FACTOR[spec.meta.level] || 1.2;
    const activeMin = Math.round(breakdown.reduce((n, b) => n + b.min, 0) * factor);
    const hoursLow = Math.max(1, Math.round(activeMin / 60));
    const hoursHigh = Math.max(hoursLow + 1, Math.round(activeMin * 1.35 / 60));
    return {
      activeMin, hoursLow, hoursHigh,
      sessions: Math.max(1, Math.ceil(hoursHigh / 4)), // ~4 h shop sessions
      factor, breakdown,
      finishWait: fin ? { coats, recoatHrs: fin.recoatHrs, cureDays: fin.cureDays, label: fin.label } : null
    };
  }

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

  BB.Plans = { cutList, bom, assembly, toolList, timeEstimate, JOINT_ALLOWANCE, jointAllowance, LOAD_BEARING_ROLES, BASE_TOOLS, cutKey, checklistKeys, pruneProgress };
})();
