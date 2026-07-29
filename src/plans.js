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
  const LOAD_BEARING_ROLES = ['leg', 'apron', 'rail', 'top', 'seat', 'shelf', 'side', 'bottom', 'plinth',
    // Seating class (2026-07): every chair member is on a load path — the
    // clear-stock note is the difference between a chair and kindling.
    'post', 'stretcher', 'crest', 'slat', 'corner_block',
    // Wall-mounted class: the cleat carries everything.
    'cleat',
    // Bed class: headboard boards take the sitting lean.
    'headboard'];

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
        // Accumulate every allowance-bearing joint TYPE, not just the last:
        // a custom part tenoned at one end and dadoed at the other must name
        // both in its note (the millimetres already summed both).
        ends[j.a] = ends[j.a] || { n: 0, types: [], mm: 0 };
        ends[j.a].n++; ends[j.a].mm += mm;
        if (!ends[j.a].types.includes(j.type)) ends[j.a].types.push(j.type);
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
        const names = e.types.map(t => K.JOINERY[t] ? K.JOINERY[t].label.toLowerCase() : t).join(' + ');
        note = `includes ${U().fmtLength(allowance)} for ${names}`;
      }
      const angles = BB.Geo.cutAngles(p.rot);
      if (angles) note = (note ? note + ' · ' : '') + BB.Geo.angleText(angles);
      // Class-supplied angle guidance (e.g. splayed-leg compound cuts) rides
      // the row so the cut list never states an angle without a way to set it.
      if (p.angleNote) note = (note ? note + ' · ' : '') + p.angleNote;
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
          angles, allowance, allowanceJoint: e ? e.types[0] : null, allowanceEnds: e ? e.n : 0,
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
    // No `fine` helper in this scope on purpose: nothing the BOM prints is a
    // sag/kerf/tolerance value, so a decimal inch here would be a defect
    // (audit D-05 — the bore that regressed was exactly this mistake).
    const len = mm => U().fmtLength(mm);
    const drill = mm => U().fmtDrill(mm); // pilots/bores: real bit sizes (audit M-01)
    const hp = (key, fallback) => K.hardwarePrice(opts.prices, key, fallback);
    const engineCounts = BB.Fasteners ? BB.Fasteners.countFor(spec, model) : [];
    const PRICE_EACH = {
      screw: 0.06, pocket: 0.08, dowel: 0.1, figure8: 0.8,
      biscuit: 0.15, loose_tenon: 0.5, kd_bolt: 1.5, spline: 0.4
    };
    /* Outdoor duty (2026-08 exposure model): corrosion is a hard spec on the
     * shopping list, not an afterthought — every metal fastener line carries
     * it (stainless or hot-dip galvanized; WRCLA guidance — electroplated
     * zinc is too thin, and plain steel iron-stains tannic species). */
    const corrode = K.isOutdoor(spec) ? ` — ${K.OUTDOOR_FASTENER_SPEC} (outdoor duty)` : '';
    for (const c of engineCounts) {
      const label = (c.kind === 'figure8' ? `Figure-8 fasteners + #8 × ${len(16)}` : c.spec + (c.pilotMM && c.kind === 'screw' ? ` (pilot ${drill(c.pilotMM)})` : ''))
        + (c.kind === 'dowel' || c.kind === 'loose_tenon' || c.kind === 'biscuit' || c.kind === 'spline' ? '' : corrode);
      const detail = c.kind === 'figure8' ? 'top attachment — allows seasonal movement'
        : c.kind === 'pocket' ? 'per the pocket-hole layout in the steps'
        : c.kind === 'dowel' ? `drill ${drill(c.pilotMM)}, positions in the steps`
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
        items.push({ kind: 'fastener', label: `M4 × ${len(16)} pan-head screws (pilot ${drill(3.0)})${corrode}`, qty: 8, detail: `slide mounting, drawer ${d.index + 1}`, price: hp('screw_pack', 1) });
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
            ? `${pull.holes} × ${drill(5)} through-bores, ${len(pull.ctcMM)} centers · M4 × ${len(BB.HW.pullScrewLenMM(d.box.t + d.front.t))} (crosses box front + front)`
            : `one ${drill(pStyle.boreDia || 5)} bore, centered${effKey === 'knob_turned_wood' ? ' — wedged tenon, no screw' : ` · M4 × ${len(BB.HW.pullScrewLenMM(d.box.t + d.front.t))} (crosses box front + front)`}`;
        items.push({ kind: 'hardware', label: pull.count > 1 ? `${pStyle.label} (pair)` : pStyle.label, qty: pull.count, detail: `drawer ${d.index + 1} — ${boreDetail}${subNote}`, price: hp('pull_' + pStyle.key, pStyle.price) * pull.count });
      } else {
        items.push({ kind: 'hardware', label: 'Drawer pull', qty: 1, detail: `drawer ${d.index + 1}`, price: hp('pull_bar_pull', 6) });
      }
      items.push({ kind: 'fastener', label: `#8 × ${len(25)} wood screws (pilot ${drill(2.8)})${corrode}`, qty: 4, detail: `front attachment from inside, drawer ${d.index + 1}`, price: hp('screw_pack', 1) });
    }
    /* Door hardware (X-07). Counts come from the same BB.HW rule the hinge
     * check uses, so the BOM and the integrity panel can never disagree
     * about how many hinges this door needs — and the hanging step below
     * prints the same number again from the same call. One rule, three
     * surfaces; the alternative is the classic defect where the plan drills
     * three cups and the shopping list buys two hinges. */
    const doorParts = model.parts.filter(p => p.role === 'door');
    if (doorParts.length && BB.HW) {
      const hinge = BB.HW.HINGES[spec.hardware && spec.hardware.hinge] || BB.HW.HINGES.euro_cup;
      for (const dp of doorParts) {
        const kg = BB.HW.panelWeightKg(dp.size.w, dp.size.h, dp.size.d, dp.material);
        const n = BB.HW.doorHingeCount(dp.size.h, kg);
        items.push({
          kind: 'hardware', label: hinge.label, qty: n,
          detail: `${dp.name.toLowerCase()} — ${U().fmtWeight(kg)} of door, ${hinge.fronts.includes('inset') && spec.doors.style === 'inset' ? 'inset' : 'overlay'} hung`,
          price: hp('hinge_' + hinge.key, hinge.price) * n
        });
        // The door needs a way to be pulled and something to stop it swinging
        // open. The keeper is load-rated hardware now (roadmap item 4): type
        // and count come from BB.HW.catchSpec — the same pure function the
        // door:catch check rates and the fitting step installs, so the label,
        // the count, and the rating can never disagree.
        const cs = BB.HW.catchSpec(kg, dp.size.h, spec.hardware && spec.hardware.pull);
        items.push({
          kind: 'hardware', label: cs.label + (cs.count > 1 ? ' (top + bottom)' : ''), qty: cs.count,
          detail: `${dp.name.toLowerCase()} — ${U().fmtWeight(cs.holdKg)} hold class, ${cs.marginRatio}× over the computed swing demand` +
            (cs.substituted ? '; touch latch declined — past ~4 kg the pop-out spring loses, so this front needs a pull after all' : ''),
          price: hp('catch_' + cs.key, cs.price) * cs.count
        });
      }
      const pStyle = BB.HW.PULLS[spec.hardware && spec.hardware.pull];
      if (pStyle && pStyle.key !== 'none_touch') {
        items.push({
          kind: 'hardware', label: pStyle.label, qty: doorParts.length,
          detail: `one per door — ${doorParts.length === 2 ? 'mounted on the meeting stiles, mirrored' : 'on the opening stile'}`,
          price: hp('pull_' + pStyle.key, pStyle.price) * doorParts.length
        });
      }
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
    // the 4% swing. The corrected spec's EXPOSURE outranks the climate
    // preference (2026-08 outdoor model), same boundary as the movement math.
    const climate = K.CLIMATE_DMC[opts.climate] !== undefined ? opts.climate : 'temperate';
    const dMC = K.effectiveDMC(spec.exposure, climate);
    const swingLabel = K.isOutdoor(spec) ? `${spec.exposure} outdoor swing` : `${climate} indoor swing`;
    const boxJ = K.JOINERY[spec.joinery.box];
    /* THE formatting rule for every emitter in this file (audit M-01, and
     * D-05 which caught the call sites the first pass missed):
     *   drill(x)  hole diameters — pilots, bores, counterbores. A number you
     *             can find in a bit index; imperial gets 1/64 fractions.
     *   len(x)    measured gaps and positions — reveals, travel, setbacks,
     *             recesses. A shim or a rule sets these, so imperial gets
     *             reduced fractions, never a decimal.
     *   fine(x)   sag, kerf, tolerance, computed movement ONLY — the values
     *             that are honestly decimal because you measure them with a
     *             caliper or never measure them at all. */
    const len = mm => U().fmtLength(mm), fine = mm => U().fmtSmall(mm);
    const drill = mm => U().fmtDrill(mm); // pilots/bores: real bit sizes (audit M-01)
    /* Screwed/pocketed boxes have a relieved back: the bottom slides in from
     * the rear AFTER assembly. Grooved boxes (locking rabbet, dovetail)
     * capture the bottom on all four sides — it MUST go in during glue-up;
     * telling the builder to slide it in later is physically impossible
     * (audit F-S1-2). */
    const slideIn = spec.joinery.box === 'butt_screws' || spec.joinery.box === 'pocket_screws';
    // Pre-finish reminder (audit M-09), once, on the FIRST drawer step: an
    // assembled drawer bank's boxes and opening interiors are unreachable
    // for a clean finish. Text amendment only — never a new step id (the
    // golden corpus freezes the id list).
    const preFinish = ' Pre-finish the drawer boxes (inside and out) and the openings’ interior faces now — an assembled drawer bank can’t be finished cleanly.';
    for (const d of model.drawers) {
      const n = d.index + 1;
      const ids = id => d.partIds.filter(p => p.includes(id));
      const boxIds = [...ids('side'), ...ids('boxfront'), ...ids('boxback')];
      if (slideIn) {
        out.push(step(`dr${n}_box`, `Drawer ${n}: build the box`,
          `Join the sides, box front, and box back with ${boxJ.plural || boxJ.label.toLowerCase()} (${len(d.box.w)} × ${len(d.box.h)} × ${len(d.box.d)} outside). Check the diagonals — square now or fight it forever.${n === 1 ? preFinish : ''}`,
          boxIds, { drawer: d.index }));
        out.push(step(`dr${n}_bottom`, `Drawer ${n}: fit the bottom`,
          `Cut a ${len(6)} groove, ${len(6)} deep, ${len(10)} up from the bottom edge of the sides and front (the back is relieved). Slide in the ${len(6)} bottom from the rear — no glue, it floats.`,
          ids('bottom'), { drawer: d.index }));
      } else {
        out.push(step(`dr${n}_box`, `Drawer ${n}: groove, then build the box around its bottom`,
          `Cut a ${len(6)} groove, ${len(6)} deep, ${len(10)} up from the bottom edge of ALL FOUR box parts. Assemble with ${boxJ.plural || boxJ.label.toLowerCase()} (${len(d.box.w)} × ${len(d.box.h)} × ${len(d.box.d)} outside) WITH the ${len(6)} bottom sitting dry in its groove — it is captured on all four sides and cannot go in later. No glue on the bottom; check the diagonals before the glue sets.${n === 1 ? preFinish : ''}`,
          boxIds.concat(ids('bottom')), { drawer: d.index }));
      }
      // Only true rails flank a drawer opening — the desk's centre stile
      // carries role 'rail' too, and slicing it in shifted every later
      // drawer's highlighted parts by one.
      const railIds = model.parts.filter(p => p.role === 'rail' && !/^stile/.test(p.id)).slice(d.index, d.index + 2).map(p => p.id);
      const gearIds = railIds.concat(d.gearIds || []);
      if (d.runner === 'side_mount_slides') {
        out.push(step(`dr${n}_runners`, `Drawer ${n}: mount the slides`,
          `Screw the ${len(d.slideLen)} slides level and flush to the opening sides with M4 × ${len(16)} pan-heads. A spacer block beats a tape measure here.`,
          gearIds, { drawer: d.index }));
      } else if (d.runner === 'undermount_slides') {
        out.push(step(`dr${n}_runners`, `Drawer ${n}: mount the undermount slides`,
          `Screw the ${len(d.slideLen)} undermount slides to the case floor of the opening, dead parallel and flush to the front edge. The box was built to the slide — INSIDE width = opening − ${len(42)} (the locking devices register on the box interior), depth exactly ${len(d.slideLen)}, bottom recessed ${len(12.7)} — so notch the box back for the hooks and press the locking clips on under the front corners.`,
          gearIds, { drawer: d.index }));
      } else {
        const sp = K.WOOD_SPECIES[spec.wood.species];
        const clr = BB.HW ? BB.HW.drawerVerticalClearance(d.box.h, spec.wood.species, dMC) : 2;
        out.push(step(`dr${n}_runners`, `Drawer ${n}: fit wood runners`,
          `Glue and screw the hardwood runners level in the opening (they're in the cut list), with the rail above as the kicker so the box cannot tip open. Fit the box with ${fine(1)} per side and ${fine(clr)} of vertical clearance — that number is this drawer's computed seasonal movement (${sp.label.toLowerCase()}, ${swingLabel}), not a guess${sp.movement === 'high' ? '; quartersawn sides would halve it' : ''}. Wax the meeting surfaces with paraffin.`,
          gearIds, { drawer: d.index }));
      }
      out.push(step(`dr${n}_hang`, `Drawer ${n}: hang the box`,
        `Set the box on its runners and check it runs true with an even gap.`, boxIds.concat(ids('bottom')), { drawer: d.index }));
      // Screws from inside the box need the full drilling schedule (M-04):
      // clearance through the box front, pilot into the false front — or the
      // front stands off on the threads instead of drawing tight.
      const frontScrews = `screw it from inside the box with #8 × ${len(25)} screws — ${drill(4.5)} clearance holes through the box front, pilot ${drill(2.8)} into the false front, so it draws up tight`;
      out.push(step(`dr${n}_front`, `Drawer ${n}: attach the front`,
        d.frontStyle === 'inset'
          ? `Shim the ${len(d.front.w)} × ${len(d.front.h)} front in its opening with a ${len(2)} reveal all around, then ${frontScrews}.`
          : `Center the ${len(d.front.w)} × ${len(d.front.h)} overlay front on the opening and ${frontScrews}.`,
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
        pullText = `No pull on this front: fit the magnetic touch latch behind it, striker on the box — press to pop open. It needs ${len(2)} to ${len(3)} of travel in the reveal.`;
      } else if (pull.holes === 0) {
        pullText = pEff === 'edge_pull'
          ? `Screw the edge pull to the front’s TOP EDGE, centered — pre-drill every hole, this is end grain and it splits without pilots.${pSub}`
          : `Rout the flush-pull mortise with the maker’s template, centered on the front — freehand walls show through the finish forever.${pSub}`;
      } else if (pull.ctcMM) {
        pullText = `Bore ${pull.holes} × ${drill(5)} through-holes at ${len(pull.ctcMM)} centers, ${pull.count > 1 ? 'two pulls at the 1/3 and 2/3 points, ' : ''}on the front's centerline — every front in the stack shares ONE centerline (a story stick beats a tape). Bore through BOTH the false front and the box front behind it: the M4 × ${len(BB.HW.pullScrewLenMM(d.box.t + d.front.t))} screws drive from inside the box and cross both.${pSub}`;
      } else {
        pullText = `Bore one ${drill((pRow && pRow.boreDia) || 5)} hole at the front's center${pEff === 'knob_turned_wood' ? ' — glue the knob’s tenon in and wedge it from inside, wedge ACROSS the front’s grain' : `, M4 × ${len(BB.HW.pullScrewLenMM(d.box.t + d.front.t))} from inside — through the box front too`}. Every front in the stack shares one centerline.${pSub}`;
      }
      out.push(step(`dr${n}_pull`, `Drawer ${n}: ${pEff === 'none_touch' ? 'fit the touch latch' : 'add the pull'}`,
        pullText, ids('pull'), { drawer: d.index }));
    }
  }

  /* Hanging the doors (X-07). Placed before sanding for a reason a first-time
   * door-hanger learns the hard way: doors are fitted, marked, and then taken
   * OFF again to finish, because a door finished in place glues itself shut
   * at the reveal and its hinge screws bury themselves in cured film.
   *
   * Every number here comes from BB.HW — the same call the BOM and the
   * integrity check make — so the count you drill for is the count you
   * bought and the count the engine rated. */
  function doorSteps(spec, model, out) {
    const doors = model.parts.filter(p => p.role === 'door');
    if (!doors.length || !BB.HW) return;
    // Display boundary: mm in, formatted text out, exactly once and here.
    const len = mm => U().fmtLength(mm);
    const drill = mm => U().fmtDrill(mm);   // bores are bit sizes (audit M-01/D-05)
    const hinge = BB.HW.HINGES[spec.hardware && spec.hardware.hinge] || BB.HW.HINGES.euro_cup;
    const inset = spec.doors.style === 'inset';
    const d0 = doors[0];
    const kg = BB.HW.panelWeightKg(d0.size.w, d0.size.h, d0.size.d, d0.material);
    const n = BB.HW.doorHingeCount(d0.size.h, kg);
    const ids = doors.map(p => p.id);

    /* Cup boring is SOLVED from the designed overlay, not looked up: the
     * boring distance and the overlay are two ends of one equation, which is
     * why a cup bored "about 5 mm" from the edge gives an overlay nobody
     * asked for. cupBoring() reports when the answer falls outside what a
     * straight arm can do, and then the fix is a different plate, not a
     * wilder bore. */
    let boringText;
    if (hinge.boring && hinge.boring.cupDia) {
      // Overlay 0 for an inset door: the leaf laps nothing, it sits in the
      // hole. The plate is solved, not assumed — see cupBoringFor().
      const cb = BB.HW.cupBoringFor(inset ? 0 : DOOR_OVERLAY_LAP_MM);
      // The cup is a METRIC callout in both unit systems, deliberately: a
      // 35 mm cup hinge takes a 35 mm Forstner, and the nearest imperial bit
      // is one you can buy and cannot seat the hinge with. Same exemption
      // the SketchUp exports carry for real millimetre geometry.
      boringText = `Bore the ${cb.cupDia} mm cups ${len(cb.cupDepth)} deep — a ${cb.cupDia} mm Forstner, not the nearest inch bit; this is metric hardware — set ${len(cb.tbMM)} from the door's hinge edge to the cup's NEAR side, on ${cb.plateMM} mm plates` +
        (cb.inRange ? '' : ` (note: no standard plate lands this overlay inside the ${len(hinge.boring.tbMin)}–${len(hinge.boring.tbMax)} straight-arm window, so expect to buy a cranked arm rather than move the bore)`) +
        `. A drill press with a fence and a stop beats a jig here: every cup on every door must be the same distance from the edge, or the doors will not line up with each other however much you adjust them afterwards.`;
    } else {
      boringText = `Mark the ${hinge.label.toLowerCase()} leaf positions off ONE story stick for every door and every stile — matched pairs, not measured twice.` +
        (hinge.boring && hinge.boring.gainDepth ? ` Cut the gains ${hinge.boring.gainDepth} deep: deeper binds the door and springs the screws.` : '');
    }

    /* The keeper comes from the same pure function the BOM buys and the
     * door:catch check rates (BB.HW.catchSpec) — one rule, three surfaces. */
    const cs = BB.HW.catchSpec(kg, d0.size.h, spec.hardware && spec.hardware.pull);
    const catchText = cs.count === 2
      ? ` Fit ${cs.count} × ${cs.label.toLowerCase()} per door — one at the TOP and one at the BOTTOM of the free stile, so both free corners are held flat against seasonal twist on a leaf this tall.`
      : ` Fit a ${cs.label.toLowerCase()} per door at the free stile${cs.substituted ? ' — the touch latch was declined (past ~4 kg the pop-out spring loses), so this front keeps a pull' : ''}.`;

    out.push(step('doors_fit', doors.length > 1 ? 'Fit the doors, then take them off again' : 'Fit the door, then take it off again',
      `${n} × ${hinge.label.toLowerCase()} per door — ${U().fmtWeight(kg)} of door and ${len(d0.size.h)} of height is what sets that count, not the look of it. ` +
      boringText + ' ' +
      (inset
        ? `Inset doors are fitted by planing to the opening, not by cutting to a number: aim for a ${len(2)} reveal all round and check it with the door IN the opening, shimmed on playing cards. The reveal is the whole job — an even gap reads as fine work and an uneven one is the first thing anybody sees. Fit in the season you are in and remember which way it will move: a door fitted tight in a damp August binds every August after.`
        : `Overlay doors forgive the opening but not each other: hang both, then adjust until the gap down the middle is even and the bottom edges line up across the pair. That centre gap is the only reference anyone looks at.`) +
      catchText +
      ` Then unscrew the doors and set them aside — they get finished off the case, and go back on last.`,
      ids));
  }
  // The overlay a cup hinge is solved against; the panel laps the case edge
  // by this much, so it is the same number addDoors() builds the leaf from —
  // both read the casework class contract (classes.js CASE_GEOM).
  const DOOR_OVERLAY_LAP_MM = BB.Classes && BB.Classes.get('casework')
    ? BB.Classes.get('casework').geom.DOOR_OVERLAY_LAP : 12;

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
    /* Outdoor duty (2026-08 exposure model): the maintenance truths that keep
     * an outdoor build alive — corrosion spec, end-grain sealing, and the
     * recoat schedule — belong in the plan, not in folklore. */
    if (K.isOutdoor(spec)) {
      notes.push(`This is an outdoor build: every metal fastener and fitting must be ${K.OUTDOOR_FASTENER_SPEC} (the BOM says so on each line), leg bottoms and other end grain get sealed before assembly, and the exterior finish is a maintenance item — recoat before it peels, because a failed film traps water against the wood.`);
      if (spec.exposure === 'exposed') notes.push('Keep the feet off soil and grass (pavers or glides) — ground contact is preservative-treated territory this plan does not cover.');
    }
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

  /* Purchased-vs-plan thickness (audit FE-H9): dimensional mode buys the
   * nearest nominal AT OR OVER a part — 5/4 (25 mm) stock for a 20 mm apron
   * — and "rip and crosscut" alone leaves parts 5 mm over plan. Any gap
   * beyond 0.5 mm earns an explicit thicknessing step and the planer in the
   * tool wall. (Rough mode already mills; laminations already plane.) */
  function thicknessingNeeded(stockPlan, cut) {
    if (!stockPlan || stockPlan.mode === 'rough') return [];
    const tByName = new Map(cut.map(r => [r.name, r.T]));
    const jobs = new Map();
    const add = (nom, partName, toT) => {
      const n = K.LUMBER.NOMINALS[nom];
      // ≤ 1.5 mm is a clean-up skim any glue-up gets anyway; a real gap
      // (25 → 20 aprons, 89 → 70 legs) is a milling operation to call out.
      if (!n || !isFinite(toT) || n.t - toT <= 1.5) return;
      const key = `${n.t}|${toT}`;
      if (!jobs.has(key)) jobs.set(key, { fromT: n.t, toT, names: new Set() });
      jobs.get(key).names.add(partName);
    };
    for (const g of stockPlan.glueups || []) add(g.nominal, g.name, g.T);
    for (const b of stockPlan.boards || []) {
      if (!b.stockLen) continue;
      for (const c of b.cuts || []) add(b.nominal, c.name, tByName.get(c.name));
    }
    return [...jobs.values()];
  }

  /* kd_bolt is the knowledge layer's only tool-removable joint (SCHEMA_DOC:
   * "all joints permanent except kd_bolt") — an instruction to glue it would
   * permanently weld the knockdown whose entire point is disassembly
   * (G12/A4/C10). K.JOINERY carries no glued/removable flag, so the
   * predicate lives here; if a second non-glued joint ever ships, promote
   * this to a knowledge-table property. */
  const isKnockdown = joint => joint === 'kd_bolt';
  const KD_STEP_TEXT = 'Bolt together — hand-tight, then snug once square.';

  /* ---------------- frame templates: table / desk / bench ----------------
   * A leg-and-apron base is not three lines of instruction (audit D-01: the
   * most-requested piece in the product shipped 3 steps and 151 words while
   * casework got 10–18 steps and 437–943). It is two sub-assemblies, a cure,
   * and one floating top, and it goes wrong exactly where the three-line
   * version was silent: layout on the legs (every frame joint lands on one),
   * wind in the frames, the open time that forces a two-stage glue-up in the
   * first place, when the clamps come off versus when the piece can be
   * loaded, and a top held so it cannot move across its grain.
   *
   * Every number below is READ, never written here: apron setback and
   * shoulder from spec.structure, the joint count from the model, the clamp
   * count from BB.Fasteners.frameClampSchedule, open/clamp/cure times from
   * the glue K.recommendGlue picks for THIS design (make the finish
   * food-safe and the bottle — and the reasoning — changes with it), and the
   * top's seasonal travel from K.movementMM, the same function the integrity
   * engine's movement check uses. */
  function frameSteps(spec, model, out, opts, ctx) {
    const frP = ctx.frP, ids = ctx.ids;
    const len = mm => U().fmtLength(mm), fine = mm => U().fmtSmall(mm);
    const st = spec.structure;
    const kd = isKnockdown(spec.joinery.frame);
    const legIds = ids('leg_1', 'leg_2', 'leg_3', 'leg_4');
    const shortIds = ids('apron_short_1', 'apron_short_2');
    const longIds = ids('apron_long_1', 'apron_long_2');
    /* Stretchers are NOT a step of their own, and that is the single most
     * useful thing the plan can say about them. Each one ties the same leg
     * pair as an apron already in a sub-assembly, so it goes in during THAT
     * glue-up: the side stretchers into the end frames, the long stretchers
     * and the H's centre tie when the frames come together. Left as a
     * bolt-on step at the end, they are unfittable without dismantling the
     * base — the classic way a first stretcher build goes wrong. */
    const stretcherStyle = (st.stretcher && st.stretcher !== 'none') ? st.stretcher : null;
    const sideStrIds = ids('stretcher_side_1', 'stretcher_side_2');
    const lateStrIds = ids('stretcher_long_1', 'stretcher_long_2', 'stretcher_centre_1');
    const strSec = stretcherStyle && BB.Parametric.stretcherSection(st);
    const strY = stretcherStyle ? len(st.stretcherHeight) : '';
    // The one dimension that is neither a stock size nor on the cut list:
    // where the stretcher mortise sits on the leg, measured from the foot.
    const strSetout = stretcherStyle
      ? ` Set the stretcher joints out from the FOOT of each leg, not from the top — ${strY} to the centre of a ${len(strSec.h)} × ${len(strSec.t)} rail — while the aprons are set out from the leg top. Two reference ends on one part is how a stretcher finishes ${len(6)} out of level across the piece, so mark all four legs together, feet aligned against a stop.`
      : '';
    // Count what actually lands ON a leg, not "joints of the frame type" —
    // butt_screws is legal in the frame slot AND is the top's nominal joint,
    // so a type filter would count the two top fixings as leg joinery.
    const roleOf = id => { const p = model.parts.find(x => x.id === id); return p ? p.role : ''; };
    const nJoints = model.joints.filter(j => roleOf(j.b) === 'leg').length;
    const rec = K.recommendGlue(spec);
    const glue = rec && rec.glue;
    const clamps = n => (BB.Fasteners && BB.Fasteners.frameClampSchedule
      ? BB.Fasteners.frameClampSchedule(n).text
      : 'Clamp in line with each apron, with a caul under every jaw.');
    // Same schedule, count only — the second stage does not need the reason
    // restated, and repeating it verbatim would be padding, not instruction.
    const nClamps = n => (BB.Fasteners && BB.Fasteners.frameClampSchedule
      ? BB.Fasteners.frameClampSchedule(n).clamps : n);

    /* 1. Layout. Every frame joint lands on a leg, so a leg mis-marked once
     * is the same error repeated at every corner. */
    out.push(step('layout', 'Mark the legs before you cut a joint',
      `Stand the ${legIds.length} legs in the positions they will finish in and mark the tops with a cabinetmaker's triangle — best faces outward, sapwood and wild grain turned where nobody looks. All ${nJoints} frame joints land on a leg, so lay them out from ONE reference face and edge per leg: the aprons sit ${st.apronInset > 0 ? `${len(st.apronInset)} back from the outside leg face` : 'flush with the outside leg face'}, their top edges level with the leg tops and ${len(st.apronHeight)} of shoulder below that. Cut all ${nJoints} joints off that single setup — a layout error here is not one mistake, it is the same mistake ${nJoints} times over, and nothing downstream pulls a mis-marked base back into square.${strSetout} Pencil each part's cut-list name onto a face that finishes hidden.`,
      legIds));

    /* 2. The end frames — and the reason there are two stages at all. */
    out.push(step('s1', stretcherStyle ? 'Build the two end frames, stretchers included' : 'Build the two end frames',
      `Join a short apron between each leg pair with ${frP}.${stretcherStyle ? ` The side stretcher goes into this same glue-up: it ties the SAME two legs as the short apron above it, so a frame closed without it cannot take it afterwards without coming apart. Two rails per frame, apron at the top, stretcher at ${strY}.` : ''} ${kd ? KD_STEP_TEXT : 'Dry-fit first, then glue, clamp, and check for square.'} ` +
      (kd
        ? `Two mirror-image assemblies — build them against each other, not just against a square, or the base finishes wider at one end than the other. Bring the bolts up in stages, alternating ends, and re-measure the diagonals after every turn: a bolted frame walks out of square if you take one side home first.`
        : `Two mirror-image assemblies, and the base goes together in two stages for a reason worth knowing — ${glue.label} gives ${glue.openMin} minutes of open time and the whole base is ${nJoints} joints, more than anyone spreads, seats, and clamps before the glue starts to grab. ${clamps(shortIds.length)} Measure both diagonals across each frame and make them equal, then sight along the clamp bars for wind — on a bench you have checked flat, not on the shop floor, because a frame with a twist in it will rock the finished piece however true the top is. ${glue.clampMin} minutes in the clamps.`),
      legIds.concat(shortIds, sideStrIds)));

    /* 3. Closing the base. */
    out.push(step('s2', 'Join the frames',
      `Connect the end frames with the long aprons using ${frP}.` +
      (stretcherStyle === 'box'
        ? ` The long stretchers go on in this same stage, on the same leg pairs — four rails now, two aprons up top and two stretchers at ${strY}, and all four have to be seated before any of them is clamped home.`
        : stretcherStyle === 'h'
          ? ` The centre stretcher goes in now too, tying the two side stretchers at their midpoints. Its ends land on the FACE of each side stretcher, not on a leg — the one joint in this base that is end grain into a long-grain face, so it wants the glue given a minute to soak in before assembly, and it will never be as strong as the leg joints. Fit it dry with the frames standing before you commit: it sets the base's final width, and if it is long the end frames splay and every apron shoulder opens.`
          : '') +
      ` ${kd ? 'Work' : 'Dry-fit the whole base before glue, and work'} on a flat surface so the base sits without rocking. ` +
      (kd
        ? `Stand both end frames up and let the long aprons find their bores before anything is driven home — a knockdown base is only as square as the last bolt you tightened. Check the diagonals across the leg tops corner to corner: equal, or a shoulder is not seated. Then sight across the four leg tops from one end; they have to lie in one plane, because the top telegraphs any twist you leave in the base.`
        : `${nClamps(longIds.length)} bar clamps again, one in line with each long apron. Check the diagonals across the top of the base corner to corner — equal, or it is a parallelogram, and flattening the top will never hide that. Then sight across the four leg tops from one end: they have to lie in one plane, because the top telegraphs any twist you leave in the base. ${glue.clampMin} minutes in the clamps, and don't move it while it sets.`),
      longIds.concat(lateStrIds)));

    /* 4. When the clamps come off is not when the piece can be loaded. */
    const standCheck = ` Then set the base on the flattest floor you have and press each corner in turn. A base that rocks gets ONE foot trimmed — take the shaving off whichever foot is proud, with the base loaded on the opposite corner. Never shim it.`;
    out.push(step('base_check', kd ? 'Snug the base and stand it up' : 'Out of the clamps, then let it cure',
      (kd
        ? `Nothing in this base is glued, which is the entire point of a knockdown frame — so it is finished when the bolts are. Go round once more with the key, and plan to go round again after the first heating season: a knockdown frame nobody re-snugs will rack.`
        : `The clamps come off at ${glue.clampMin} minutes, but ${glue.label} is not at full strength for ${glue.cureHrs} hours — until then don't stand on the base, plane it, or hang a top off it. Pare the squeeze-out while it is still rubbery: a chisel or a card scraper lifts it away clean, where a wet rag drives it into the pores and it ghosts through the finish forever.`) + standCheck,
      legIds.concat(shortIds, longIds, sideStrIds, lateStrIds)));

    /* 5. The top: how it is held, and which way it is allowed to travel. */
    const top = model.parts.find(p => p.id === 'top_1');
    const topName = top ? top.name.toLowerCase() : 'top';
    const climate = K.CLIMATE_DMC[opts.climate] !== undefined ? opts.climate : 'temperate';
    // Exposure outranks the indoor climate preference (2026-08): the same
    // ΔMC boundary the movement checks run on.
    const topDMC = K.effectiveDMC(spec.exposure, climate);
    const topSwing = K.isOutdoor(spec) ? `${spec.exposure} outdoor swing` : `${climate} indoor swing`;
    const topKey = top && K.WOOD_SPECIES[top.material] ? top.material : spec.wood.species;
    const topSp = K.WOOD_SPECIES[topKey];
    // Cross-grain width, measured exactly as the integrity engine measures it
    // for the movement check: the panel dimension across the grain.
    const crossW = top ? Math.min(top.size.w, top.size.d) : 0;
    const moves = !!(topSp && !topSp.sheet && crossW > 0);
    const mv = moves ? K.movementMM(crossW, topKey, 'tangential', topDMC) : 0;
    out.push(step('s3', `Attach the ${topName}`,
      `Center the ${topName} and fasten it from below with figure-8s or buttons — never glue a solid ${topName} to its base. ` +
      (moves
        ? `This one travels about ${fine(mv)} across its ${len(crossW)} width between a dry winter and a damp summer (${topSp.label.toLowerCase()}, ${topSwing}) and effectively nothing along its length, so every fastener has to hold it DOWN while letting it slide ACROSS the grain: set each figure-8 with its long axis running across the ${topName}'s grain so it can swivel, or cut the buttons' tongues to ride in a kerf running the same way. `
        : `Hold it down without pinning it: a ${topName} that cannot move is one that splits. `) +
      `Snug, not crushed — a fastener torqued solid is a glued top with extra steps, and the crack turns up two winters later. Check the overhang is even on all four sides before you drill anything.`,
      ['top_1']));
  }

  /* ---------------- seating: chair / stool ----------------
   * The class contract's assembly template (classes.js 'seating'), realized
   * against THIS design's numbers. Every dimension and angle is read from
   * the spec/model; the sequence, jigs, and squareness checks are the
   * contract's. A chair is sub-assemblies against a story stick — the back
   * first (its offsets ARE the rake), then side frames, then the closing
   * glue-up, then the structure everyone mistakes for trim (corner blocks),
   * then a seat that is held down but never pinned. */
  function chairSteps(spec, model, out, opts, ctx) {
    const { frP, ids } = ctx;
    const len = mm => U().fmtLength(mm), fine = mm => U().fmtSmall(mm);
    const st = spec.structure, se = spec.seat || {};
    const stool = !se.backHeight;
    const kd = isKnockdown(spec.joinery.frame);
    const rec = K.recommendGlue(spec);
    const glue = rec && rec.glue;
    const drawbore = spec.meta.level === 'advanced' && spec.joinery.frame === 'mortise_tenon';
    const G = BB.Classes && BB.Classes.get('seating') ? BB.Classes.get('seating').geom : null;
    const railBand = `${len(st.apronHeight)} rails, top edges ${len(st.topThickness)} below the finished seat height`;

    if (stool) {
      const s = se.splayDeg || 0;
      const R = Math.round(Math.atan(Math.SQRT2 * Math.tan(s * Math.PI / 180)) * 180 / Math.PI * 10) / 10;
      out.push(step('layout', 'Angle schedule and layout — before any cut',
        `All four legs splay ${U().fmtDeg(s)} both ways. That compounds: the true tilt is ${U().fmtDeg(R)}, and it runs along the seat DIAGONAL — set a sliding bevel to ${U().fmtDeg(R)} and sight it 45° across the corner, or set the saw to blade bevel ${U().fmtDeg(s)} + miter ${U().fmtDeg(s)} for every leg end (both settings, same cut — that is what a compound angle means). RIP EACH LEG BLANK WITH THE GRAIN RUNNING ALONG THE LEG: the angles live in the end cuts only. Sawing the splay into an upright blank leaves grain running out the side of the leg, and that leg loses a quarter of its strength before anyone sits down. Mark all four legs together, feet against a stop, and pencil the cut-list name on each.`,
        ids('leg_1', 'leg_2', 'leg_3', 'leg_4')));
      out.push(step('s1', 'Two side frames first',
        `Join a side rail and a side stretcher between each leg pair with ${frP} — the rail shoulders carry the ${U().fmtDeg(s)} splay, so fit them dry and check the frame against the floor plan before glue. ${kd ? KD_STEP_TEXT : `${glue.label} gives ${glue.openMin} minutes of open time — enough for one frame at a time, not four corners at once. Clamp in line with each rail, cauls under the jaws.`} Both frames get checked the same way: feet flat on the bench, diagonals equal, and the splay matching its mirror twin — build them against each other.`,
        ids('leg_1', 'leg_2', 'leg_3', 'leg_4', 'rail_side_1', 'rail_side_2', 'stretcher_side_1', 'stretcher_side_2')));
      out.push(step('s2', 'Close the frame — footrest included',
        `Connect the frames with the front and back rails AND the front and rear stretchers in one clamp-up with ${frP}: the footrest box ties the splayed legs, and a frame closed without it cannot take it later. ${kd ? 'Bring the bolts up in stages, alternating sides, and re-measure the diagonals after every turn.' : `All eight shoulders seated before any clamp is driven home; ${glue.clampMin} minutes in the clamps.`} Check diagonals across the seat frame AND stand it on the flattest floor you have: four feet down, no rock — trim ONE proud foot if it rocks, never shim.`,
        ids('rail_front_1', 'rail_back_1', 'stretcher_front_1', 'stretcher_back_1')));
    } else {
      const rakeLine = se.backRake > 0
        ? ` The back rakes ${U().fmtDeg(se.backRake)} — not by bending anything, but by the mortise OFFSETS: the crest sits ${G ? len(Math.round(Math.tan(se.backRake * Math.PI / 180) * ((se.height + se.backHeight - G.CREST_H / 2) - (se.height + G.SLAT_RISE)) / 2 * 10) / 10) : 'its setout'} rearward of the post centreline and the bottom slat the same forward. Mark every mortise from the story stick, feet against a stop — two reference ends on one post is how a back finishes twisted.`
        : ' The back is upright: every mortise centres on the post depth.';
      out.push(step('layout', 'Story stick and layout — both posts marked together',
        `The rear posts are the chair: one straight piece each, floor to crest, no sawn bends (a sawn bend is short grain at the exact point the back load bends the post — the classic broken chair). Stand both posts together, feet against a stop, and mark EVERY joint from one story stick: seat rails at ${railBand}, stretchers at ${len(st.stretcherHeight)}, slats and crest above.${rakeLine} Front legs get the same treatment from the same stick.`,
        ids('post_1', 'post_2', 'leg_3', 'leg_4')));
      out.push(step('s1', 'Back sub-assembly',
        `Join the crest and slats between the two posts with ${frP}.${drawbore ? ' Advanced option earned here: DRAWBORE the crest tenons — offset the peg hole in the tenon ~1.5 mm toward the shoulder and the pin pulls the joint tight forever, clamps optional.' : ''} ${kd ? KD_STEP_TEXT : `Dry-fit, then glue; ${glue.label} allows ${glue.openMin} minutes.`} Check the back for wind on a flat bench and measure both diagonals — a twisted back telegraphs into every joint after it.`,
        ids('post_1', 'post_2', 'crest_1', 'slat_1', 'slat_2')));
      out.push(step('s2', 'Side frames onto the back',
        `Join each side rail and side stretcher between a rear post and its front leg with ${frP} — the side rail's rear shoulder carries the ${U().fmtDeg(se.slopeDeg)} seat slope${se.slopeDeg ? ' (that is the bevel on the cut list)' : ''}. One side at a time, on the flat bench: rail top edges land exactly on the story-stick line, and the front leg stands square to the floor in BOTH planes while the glue is open.`,
        ids('rail_side_1', 'rail_side_2', 'stretcher_side_1', 'stretcher_side_2', 'leg_3', 'leg_4')));
      out.push(step('s3', 'Close the seat frame',
        `Front rail between the legs, back rail between the posts${st.stretcher === 'h' ? ', and the centre stretcher tying the side stretchers at their midpoints — fit it dry first; it sets the frame width' : ', and the front/rear stretchers'} — with ${frP}, in one glue-up. ${kd ? 'Snug the bolts in rotation and re-check the diagonals after every pass; plan to re-snug after the first month and the first heating season — a bolted chair that nobody re-snugs is a wobbly chair.' : `Check the seat-frame diagonals equal BEFORE the glue tacks, and sight across the rails for wind.`} Then stand it: four feet on the flattest floor available, trim one proud foot if it rocks.`,
        ids('rail_front_1', 'rail_back_1', 'stretcher_centre_1', 'stretcher_front_1', 'stretcher_back_1')));
    }
    out.push(step('s4', 'Corner blocks — structure, not trim',
      `Glue and screw a corner block across each seat-frame corner, tight into the angle${stool ? '' : ' and against the leg or post'}. These blocks close the racking loop of the seat frame — the cyclic sit-down case counts on them — so they are on the cut list with their own dimensions, ripped at 45° so the grain runs across the diagonal. Two screws per face, pilots drilled, glue on every mating face.`,
      ids('block_1', 'block_2', 'block_3', 'block_4')));
    const seatPart = model.parts.find(p => p.id === 'seat_1');
    const crossW = seatPart ? Math.min(seatPart.size.w, seatPart.size.d) : 0;
    const climate = K.CLIMATE_DMC[opts.climate] !== undefined ? opts.climate : 'temperate';
    // Exposure outranks the indoor climate preference (2026-08 outdoor model).
    const mv = crossW ? K.movementMM(crossW, spec.wood.species, 'tangential', K.effectiveDMC(spec.exposure, climate)) : 0;
    out.push(step('s5', 'Fit and fasten the seat — held down, never pinned',
      `${stool ? 'Set the seat on the frame' : 'Notch the seat around the rear posts (the cut list size already includes the capture), then set it on the frame'} with even overhang${se.slopeDeg ? `, letting the ${U().fmtDeg(se.slopeDeg)} slope follow the rails` : ''}, and fasten it exactly as the setout lines below specify — hold-downs that let the panel move, never glue, never a screw pinned solid across the grain. This seat travels about ${fine(mv)} across its ${len(crossW)} width between seasons — a seat pinned solid is a split seat two winters out. Snug, not crushed.`,
      ['seat_1']));
    out.push(step('s6', kd ? 'Snug, stand, and the re-snug schedule' : 'Cure before anyone sits',
      kd
        ? 'Nothing structural here is glued — go around every bolt once more with the key, then sit-test gently. Re-snug after the first week, the first month, and every heating season: the re-snug schedule IS the maintenance plan for a bolted chair.'
        : `Clamps off at ${glue.clampMin} minutes, but ${glue.label} reaches full strength at ${glue.cureHrs} hours — no sitting, no rear-tilt testing, nothing, until then. Pare squeeze-out while rubbery. Then the acceptance test, gently: sit, shift, lean back a LITTLE — a new chair should feel dead, with no clicks and no give at any joint.`,
      []));
  }

  /* ---------------- wall shelf (the 'wall_mounted' class) ----------------
   * The assembly is mostly INSTALLATION, and the wall is a structural member
   * — so the steps carry the substrate discipline the anchor check assumed:
   * studs found and verified, screws in centres, level line first, and a
   * gentle load test before anything lives on it. Every number is read from
   * the class geometry and the live check data. */
  function wallShelfSteps(spec, model, integrity, out) {
    const len = mm => U().fmtLength(mm);
    const G = BB.Classes && BB.Classes.get('wall_mounted') ? BB.Classes.get('wall_mounted').geom : { CLEAT_H: 70, SCREWS_PER_STUD: 2, MASONRY_PITCH: 300 };
    const wall = spec.wall || { substrate: 'stud', studSpacingMM: 406 };
    const anchor = integrity && integrity.checks ? integrity.checks.find(c => c.id === 'wall:anchor') : null;
    const studCheck = integrity && integrity.checks ? integrity.checks.find(c => c.id === 'wall:studs') : null;
    const rec = K.recommendGlue(spec);
    const glue = rec && rec.glue;

    out.push(step('rip', 'Rip the cleat — one board, two halves',
      `Rip the ${len(model.parts.find(p => p.id === 'cleat_wall_1').size.w)} cleat board down its length with the blade tilted 45° — the single cut makes both interlocking halves (they're both in the cut list). Keep the bevel faces clean off the saw; they are the bearing surfaces the whole shelf hangs on.`,
      ['cleat_wall_1', 'cleat_shelf_1']));
    if (wall.substrate === 'stud') {
      const studs = studCheck && studCheck.data ? studCheck.data.studs : 2;
      out.push(step('studs', 'Find the studs — then prove them',
        `Mark every stud line behind the shelf position (spacing here is ${len(wall.studSpacingMM)} centres — IRC framing). A finder gets you close; a ${len(3)} pilot hole through the paint PROVES the centre — solid resistance full depth is a stud, a punch-through is a miss. The anchor math guarantees ${studs} stud${studs === 1 ? '' : 's'} under this cleat and assumes every screw lands in wood, not drywall.`,
        []));
      out.push(step('mount', 'Level line, then the wall half',
        `Strike a level line at mounting height (bookshelf duty likes ${len(1200)}–${len(1500)}; the cleat top sits ${len(G.CLEAT_H + spec.structure.topThickness)} below the finished shelf top). Screw the wall half bevel-UP-and-OUT through to the studs: ${G.SCREWS_PER_STUD} × #10 × ${len(76)} screws per stud, pilots drilled, heads snug — ${anchor && anchor.data ? `each carries ${U().fmtPointLoad(anchor.data.perScrewN / 9.81)} of withdrawal at ${anchor.data.marginRatio.toFixed(1)}× margin` : 'the Safety tab prices each screw'}. NEVER into drywall alone: the capacity math is wood-screw withdrawal, and drywall anchors creep.`,
        ['cleat_wall_1']));
    } else {
      out.push(step('mount', 'Level line, then the wall half — masonry',
        `Strike a level line at mounting height. Drill and set rated masonry anchors every ${len(G.MASONRY_PITCH)} along the cleat${anchor && anchor.data ? ` — buy a published WORKING load rating of at least ${U().fmtPointLoad(anchor.data.requiredWorkingN / 9.81)} each (the BOM prints it; ultimate ratings are ~4× working, so read the box carefully)` : ''}. Blow the dust out of every hole — a dusty hole halves an anchor.`,
        ['cleat_wall_1']));
    }
    out.push(step('shelf_half', 'Fit the shelf half',
      `Glue and screw the mating half under the shelf's rear edge, bevel DOWN-and-IN, flush to the back. ${glue ? `${glue.label}: ${glue.clampMin} minutes clamped, load after ${glue.cureHrs} hours.` : ''} The two bevels convert gravity into a clamping couple — that geometry, not the screws alone, is what a French cleat is.`,
      ['cleat_shelf_1', 'shelf_1']));
    out.push(step('hang', 'Hang, seat, and load-test',
      'Drop the shelf onto the wall half and press down along its length — it must seat fully with no rock. Check level. Then the acceptance test, gently: pull straight down at the FRONT edge with real force before any load goes on. A shelf that moves now moves worse with your things on it.',
      ['shelf_1']));
  }

  /* ---------------- bed (the 'bed' class) ----------------
   * The class contract's sequence: sub-assemble the ends, bolt the rails IN
   * THE ROOM (knock-down is the point), centre support before the deck, deck
   * to the story stick, then the snug schedule. */
  function bedSteps(spec, model, integrity, out) {
    const len = mm => U().fmtLength(mm);
    const b = spec.bed;
    const G = BB.Classes && BB.Classes.get('bed') ? BB.Classes.get('bed').geom : null;
    const slats = model.parts.filter(p => p.role === 'slat').map(p => p.id);
    const hboards = model.parts.filter(p => p.role === 'headboard').map(p => p.id);
    const hasCentre = model.parts.some(p => p.id === 'rail_centre_1');
    const jointChk = integrity && integrity.checks ? integrity.checks.find(c => c.id === 'bed:joint') : null;

    if (hboards.length) {
      out.push(step('s1', 'Headboard sub-assembly',
        `Bolt the ${hboards.length} headboard boards between the head posts — barrel-nut bores drilled with the jig, both holes off the same reference face. Check the assembly for wind on the flat and measure the diagonals; a twisted headboard fights every later bolt.`,
        ['post_1', 'post_2', ...hboards]));
    }
    out.push(step('s2', 'Foot sub-assembly',
      'Bolt the foot rail between the footboard posts. Two mirror ends, checked against each other.',
      ['post_3', 'post_4', 'rail_foot_1']));
    out.push(step('s3', 'Bolt the side rails — in the bedroom',
      `Stand the head and foot ends where the bed will LIVE and bolt the side rails between them (${jointChk && jointChk.data ? `each end carries ${U().fmtPointLoad(jointChk.data.endReactionN / 9.81)} at ${jointChk.data.marginRatio.toFixed(1)}× margin on its two bolts` : 'two barrel bolts per end'}). This is the knock-down mandate paying rent: the bed assembles in the room it can never leave whole. Snug in rotation, diagonals equal before the last bolt goes home.`,
      ['rail_side_1', 'rail_side_2', 'rail_head_1']));
    if (hasCentre) {
      out.push(step('s4', 'Centre rail and its leg — before the deck',
        'Screw the centre rail between the head and foot rails and fit its floor leg at midspan. The leg must BEAR THE FLOOR before any load goes on — a centre rail hanging in air is a broken-slat generator. Shim to firm contact if the floor dips.',
        ['rail_centre_1', 'leg_centre_1']));
    }
    out.push(step('s5', 'Cleats and the slat deck',
      `Screw the cleats level inside the side rails (constant drop from the rail top — use a spacer block), then lay the ${slats.length} slats to the spacing story stick (gaps ${G ? '≤ ' + len(G.SLAT_GAP_MAX) : 'even'} — the foam-mattress warranty number) and put one screw through each end so nothing walks.`,
      ['cleat_1', 'cleat_2', ...slats]));
    out.push(step('s6', 'Square, snug schedule, mattress',
      'Check the frame diagonals once more, then the re-snug schedule that keeps a bolted bed silent: go round every bolt after the first week, the first month, and each season. Then the mattress — and the first night is the load test.',
      []));
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
      const thick = thicknessingNeeded(opts.stockPlan, cutList(spec, model));
      if (thick.length) {
        const names = tj => [...tj.names].slice(0, 4).join(', ') + (tj.names.size > 4 ? ', …' : '');
        out.push(step('thickness', 'Bring stock to plan thickness',
          `The buy list is the nearest nominal OVER some parts: mill ${thick.map(tj => `${fmtL(tj.fromT)} stock down to ${fmtL(tj.toT)} (${names(tj)})`).join('; ')} — rip close, then plane or drum-sand with equal passes off both faces so nothing cups. Panels after their glue-up, sticks before any joinery.`, []));
      }
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
      /* One step per connection, each one identified by the parts it joins
       * (audit D-02: a two-connection piece emitted two steps both titled
       * "Join leg panel to seat" with near-identical bodies — nothing in the
       * plan told you which was which, and there was no clamp order, square
       * check, or glue window anywhere). The part ids are the honest
       * discriminator; the ordinal says why the step sits where it does. */
      const glueRec = K.recommendGlue(spec);
      const gl = glueRec && glueRec.glue;
      conns.forEach((c, i) => {
        const a = byId.get(c.a), b = byId.get(c.b);
        if (!a || !b) return;
        const j = K.JOINERY[c.joint];
        const ang = BB.Geo.cutAngles(a.rot) || BB.Geo.cutAngles(b.rot);
        const an = a.name.toLowerCase(), bn = b.name.toLowerCase();
        const kd = isKnockdown(c.joint);
        const first = i === 0, last = i === conns.length - 1;
        // A novel piece has no template behind it, so the whole-piece dry run
        // on the first connection is the only proof the parts go together.
        const openingLine = first
          ? ` And before you fix anything: stand the WHOLE piece up loose, every connection dry — a novel composition has no proven template behind it, so that trial run is the only evidence the parts meet where the drawing says they do.`
          : ` Connection ${i + 1} of ${conns.length}, working up from the ground so each joint rests on one already made.`;
        const closingLine = kd
          ? ` Work round the bolts in sequence instead of taking one home first — a frame pulled up on one side drags itself out of square${last ? ', and with the last one snug the piece should stand without a rock' : ''}.`
          : ` Clamp ACROSS the joint line so the pressure closes the faces, with a caul under each jaw to keep the marks off a show face, and check ${an} square to ${bn} in both planes before the glue tacks — ${gl ? `${gl.label} gives you ${gl.openMin} minutes` : 'you have minutes, not hours'}. ${gl ? `Leave it clamped ${gl.clampMin} minutes, and keep load off the piece for ${gl.cureHrs} hours.` : ''}${last ? ' This closes the piece: stand it and press each corner while the glue is still green — it should not rock.' : ''}`;
        out.push(step('c' + (i + 1), `Join ${an} (${c.a}) to ${bn} (${c.b})`,
          `Fix ${an} (${c.a}) to ${bn} (${c.b}) with ${j ? (j.plural || j.label.toLowerCase()) : c.joint}.` +
          (ang ? ` Angled joint: ${BB.Geo.angleText(ang)} — cut per the cut list before assembly.` : '') +
          (kd ? ' ' + KD_STEP_TEXT : ' Dry-fit before glue.') +
          openingLine + closingLine,
          [c.a, c.b]));
      });
    } else if (t === 'bookshelf') {
      out.push(step('s1', 'Join the case', `Dry-fit the whole case and check square before any glue. Then fasten the top and bottom between the sides with ${caP}. Clamp square before anything sets.`, ids('side_1', 'side_2', 'top_1', 'bottom_1')));
      const shelves = model.parts.filter(p => p.role === 'shelf').map(p => p.id);
      if (shelves.length) out.push(step('s2', 'Add the shelves', `Fit each shelf with ${caP}, working bottom to top.`, shelves));
      if (has('back_1')) out.push(step('s3', 'Fit the back', 'Pre-finish the interior faces and shelves first — once the back is on, the inside is unreachable for a clean finish. Then square the case to the back panel and fasten it — the back is what keeps everything square.', ['back_1']));
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
      if (has('back_1')) out.push(step('s3', 'Fit the back', 'Pre-finish the carcass interior and shelves first — unreachable once the back is on. Then fasten the back panel — square the carcass to it first.', ['back_1']));
      if (has('plinth_1')) out.push(step('s4', 'Add the toe kick', `Fit the toe-kick board ${U().fmtLength(75)} back from the front edge.`, ['plinth_1']));
      out.push(step('s5', 'Attach the top', 'Fasten the top from below.', ['top_1']));
      drawerSteps(spec, model, out, opts);
    } else if (t === 'nightstand') {
      out.push(step('s1', 'Build the two side frames', `Join the side aprons to the legs with ${frP} — two mirror-image assemblies. Dry-fit and check square before any glue.`, ids('leg_1', 'leg_2', 'leg_3', 'leg_4', 'apron_side_1', 'apron_side_2')));
      const rails = model.parts.filter(p => p.role === 'rail').map(p => p.id);
      out.push(step('s2', 'Connect with back apron and rails', `Join the back apron and the front drawer rails between the side frames with ${frP}.`, ['apron_back_1', ...rails]));
      if (has('shelf_1')) out.push(step('s3', 'Fit the lower shelf', 'Notch the shelf around the legs and fasten it.', ['shelf_1']));
      out.push(step('s4', 'Attach the top', 'Fasten the top with figure-8s so it can move with the seasons.', ['top_1']));
      drawerSteps(spec, model, out, opts);
    } else if (t === 'chair') {
      chairSteps(spec, model, out, opts, { frP, ids });
    } else if (t === 'wall_shelf') {
      wallShelfSteps(spec, model, integrity, out);
    } else if (t === 'bed') {
      bedSteps(spec, model, integrity, out);
    } else {
      frameSteps(spec, model, out, opts, { frP, ids });
      // Desk apron drawers (frame_table extension): the band members go in
      // with the base (their joints ride the frame steps' part lists); the
      // boxes, runners, and fitting are the standard drawer sequence.
      if (t === 'desk' && spec.drawers) drawerSteps(spec, model, out, opts);
    }
    // Mandatory anti-tip anchoring: an instruction step, not an aside. A
    // custom piece may not live against a wall at all (room dividers, column
    // wraps, "hanging" desks) — say what that means instead of assuming
    // studs behind it (G11/A7). Custom-scoped so template wording — and the
    // golden corpus — stays byte-identical.
    if (integrity && integrity.antiTip) {
      out.push(step('antitip', 'Anchor to the wall (required)',
        'This piece is tall, top-heavy, or tips with its drawers open: fasten the anti-tip strap to the top rear and screw the wall side into a stud (not just drywall). Do this before loading any shelf or drawer'
        + (t === 'custom' ? '; if it can’t back onto a wall, rethink placement — the tip risk is real.' : '.'), []));
    }
    // Before sanding, deliberately: the doors come back OFF to be finished.
    doorSteps(spec, model, out);
    safetyStep(spec, model, integrity, opts.stockPlan, out);
    sandingStep(spec, out);
    finishingStep(spec, out);
    /* Attach joint metadata: a joint belongs to the step that MAKES it — the
     * first step whose part list contains the joint's attached member — so
     * fastening notes and playback glow never teach another step's joinery
     * (audit FE-H6: the slide step used to inherit the rails' dowel setout,
     * and the case step taught the shelf screws while the top's own
     * attachment note never surfaced). */
    const seenJoints = new Set();
    const jKey = j => `${j.type}|${j.a}|${j.b}`;
    /* Steps that make no joint never own one. The custom "mill and label"
     * step lists every part in the piece, so it used to swallow the whole
     * connection graph and leave the connection steps with no setout at all
     * (audit D-02: that is why a novel piece got 15 words a step). */
    const MAKES_NO_JOINT = /^(mill|sand|finish|safety|antitip)/;
    const claimed = new Map();
    for (const s of out) {
      if (MAKES_NO_JOINT.test(s.id)) { s.joints = []; continue; }
      const ids = new Set(s.partIds || []);
      const mine = model.joints.filter(j => ids.has(j.a) && !seenJoints.has(jKey(j)));
      for (const j of mine) seenJoints.add(jKey(j));
      claimed.set(s.id, mine);
      // step.joints stays exactly as it was — the capped list other
      // consumers (playback glow, the Joint Inspector) already read.
      s.joints = mine.slice(0, 8);
    }
    // Fastener locations & joinery setout, from the engine — the same numbers
    // the BOM counted (audit F-S3-1). jointInfo describes what the plan
    // ACTUALLY fastens with (audit D-03) and covers every distinct fastening
    // the step introduces, grouped with a count (audit D-04); it is derived
    // from the step's full joint list, not the capped one, so a count printed
    // in the text can never understate what is on the bench.
    if (BB.Fasteners && BB.Fasteners.stepJoints) {
      for (const s of out) {
        const mine = claimed.get(s.id);
        if (!mine || !mine.length) continue;
        s.jointInfo = BB.Fasteners.stepJoints(spec, model, mine);
        const note = BB.Fasteners.stepNote(spec, model, mine);
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
    'Drill/driver', 'Bar or pipe clamps'
  ];
  const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
  function toolList(spec, model, stockPlan) {
    const tools = new Set(BASE_TOOLS);
    // Abrasives from the ACTUAL finish schedule (audit M-11): the prep grit
    // ladder plus the between-coat abrasive, straight from K.FINISHES —
    // never a hardcoded 120/180/220 that contradicts the finishing steps.
    const finSched = K.FINISHES.find(f => f.key === spec.finish);
    const prepGrits = finSched && finSched.prep && finSched.prep.grits && finSched.prep.grits.length
      ? finSched.prep.grits : [120, 180, 220];
    tools.add(`Sandpaper (${prepGrits.join(' / ')} grit)`);
    if (finSched && finSched.prep && finSched.prep.betweenGrit) {
      tools.add(`${finSched.prep.betweenGrit}-grit pad (between coats)`);
    }
    for (const t of new Set(model.joints.map(j => j.type))) {
      for (const tool of (K.JOINERY[t] ? K.JOINERY[t].tools : [])) tools.add(cap(tool));
    }
    if (model.parts.some(p => BB.Geo.cutAngles(p.rot))) tools.add('Miter saw (angled cuts)');
    if (model.parts.some(p => K.WOOD_SPECIES[p.material] && K.WOOD_SPECIES[p.material].sheet)) tools.add('Circular saw + straightedge (sheet breakdown)');
    if (stockPlan && ((stockPlan.glueups || []).length || (stockPlan.laminations || []).length)) {
      tools.add('Glue + cauls (panel glue-up)');
      if ((stockPlan.laminations || []).length) tools.add('Hand plane or thickness planer (laminations)');
    }
    if (stockPlan && thicknessingNeeded(stockPlan, cutList(spec, model)).length) {
      tools.add('Thickness planer or drum sander (stock bought over plan thickness)');
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
