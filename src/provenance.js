/* Blueprint Buddy — number provenance + species comparison (Phase 4 stretch).
 *
 * Provenance: every derived value can show the rule that produced it. Tapping
 * a dimension in the cut list or part inspector opens a popover with the
 * formula and its live inputs — code showing its work. The registry below
 * mirrors the parametric templates exactly; if a template changes, its
 * provenance line changes with it (and the self-tests cross-check key rows).
 *
 * Species comparison: the same design recomputed side by side with material
 * swapped — pure-function reruns, so it is cheap and instant.
 */
var BB = globalThis.BB = globalThis.BB || {};

(function () {
  'use strict';
  const K = BB.K;

  /* Rules and inputs render in the user's display units (the popover carries
   * a "computed internally in metric" footnote); the math itself never leaves
   * millimetres. */
  const mm = v => BB.Units.fmtLength(v);

  /* ---------------- provenance registry ---------------- */
  /* Returns [{dim, formula}] for a cut-list row (or inspector part). Each
   * formula string carries the rule AND its live inputs. */
  function forCutRow(spec, model, row) {
    const t = spec.meta.template;
    const o = spec.overall, st = spec.structure;
    const lines = [];
    const push = (dim, formula) => lines.push({ dim, formula });
    const name = row.name;

    const overhang = t === 'bench' ? 20 : t === 'nightstand' ? 20 : 35;
    const frameW = o.width - 2 * overhang;
    const frameD = o.depth - 2 * overhang;
    const innerW = o.width - 2 * st.sideThickness;

    const fine = v => BB.Units.fmtSmall(v);

    if (t === 'custom') {
      push('Dimensions', `novel composition: dimensions come straight from the designed primitive (AI proposes, code clamps to ${mm(10)}–${mm(3000)} and snaps thickness to stock)`);
    } else if (name === 'Leg') {
      push('Length', `leg = height − top thickness = ${mm(o.height)} − ${mm(st.topThickness)} = ${mm(o.height - st.topThickness)}`);
      push('Section', `leg thickness (spec) = ${mm(st.legThickness)} square`);
    } else if (name === 'Long apron') {
      push('Length', `frame width − 2 × leg = (${mm(o.width)} − 2 × ${mm(overhang)} overhang) − 2 × ${mm(st.legThickness)} = ${mm(frameW - 2 * st.legThickness)}`);
      push('Width', `apron height (spec) = ${mm(st.apronHeight)}`);
    } else if (name === 'Short apron') {
      push('Length', `frame depth − 2 × leg = (${mm(o.depth)} − 2 × ${mm(overhang)} overhang) − 2 × ${mm(st.legThickness)} = ${mm(frameD - 2 * st.legThickness)}`);
      push('Width', `apron height (spec) = ${mm(st.apronHeight)}`);
    } else if (name === 'Top' && ['table', 'desk', 'bench', 'nightstand', 'cabinet'].includes(t)) {
      if (t === 'bookshelf' || t === 'cabinet') push('Length', `inner width = width − 2 × side = ${mm(innerW)}`);
      else push('Length', `overall width = ${mm(o.width)} (full overhang)`);
      push('Thickness', `top thickness (spec) = ${mm(st.topThickness)}`);
    } else if (name === 'Seat') {
      push('Length', `overall width = ${mm(o.width)}`);
      push('Thickness', `top thickness (spec) = ${mm(st.topThickness)}`);
    } else if (name === 'Side' && (t === 'bookshelf' || t === 'cabinet')) {
      const base = t === 'cabinet' && st.toeKick ? 90 : 0;
      const caseH = t === 'cabinet' ? o.height - st.topThickness - base : o.height;
      push('Length', t === 'cabinet'
        ? `case height = height − top − toe kick = ${mm(o.height)} − ${mm(st.topThickness)} − ${mm(base)} = ${mm(caseH)}`
        : `overall height = ${mm(o.height)}`);
      push('Width', `overall depth = ${mm(o.depth)}`);
      push('Thickness', `side thickness (spec) = ${mm(st.sideThickness)}`);
    } else if (name === 'Shelf' || name === 'Top' || name === 'Bottom') {
      push('Length', `inner width = width − 2 × side = ${mm(o.width)} − 2 × ${mm(st.sideThickness)} = ${mm(innerW)}`);
      push('Thickness', `shelf thickness (spec) = ${mm(st.shelfThickness)}`);
    } else if (name === 'Back panel') {
      push('Size', `case − ${mm(12)} rabbet reveal = ${mm(o.width - 12)} × …, ${mm(6)} sheet stock`);
    } else if (/^(Side|Back) apron$/.test(name) && t === 'nightstand') {
      const count = spec.drawers ? spec.drawers.count : 1;
      const available = o.height - st.topThickness - 120;
      const desired = (count + 1) * 60 + count * 130;
      const bank = Math.min(desired, available);
      push('Width (bank height)', `min((${count}+1)×${mm(60)} rail + ${count}×${mm(130)} opening, height − top − ${mm(120)} leg reveal) = min(${mm(desired)}, ${mm(available)}) = ${mm(bank)}`);
      push('Length', name === 'Side apron'
        ? `frame depth − 2 × leg = ${mm(frameD - 2 * st.legThickness)}`
        : `frame width − 2 × leg = ${mm(frameW - 2 * st.legThickness)}`);
    } else if (/drawer rail/i.test(name) || name === 'Divider rail') {
      push('Length', `clear opening width between ${t === 'nightstand' ? 'legs' : 'sides'}`);
      push('Section', `${mm(20)} × ${mm(60)} rail stock (code constant)`);
    } else if (/^Drawer /.test(name) && model.drawers && model.drawers.length) {
      const d = model.drawers[0];
      const op = d.opening;
      if (/side$/.test(name)) push('Depth', d.runner === 'side_mount_slides'
        ? `box depth = longest standard slide ≤ interior − ${fine(25)} setback = ${mm(d.box.d)}`
        : `box depth = interior − ${fine(20)} = ${mm(d.box.d)}`);
      if (/side$/.test(name)) push('Height', d.runner === 'side_mount_slides' ? `opening − ${fine(15)} slide clearance = ${mm(op.h)} − ${fine(15)} = ${mm(d.box.h)}` : `opening − ${fine(10)} = ${mm(d.box.h)}`);
      if (/box front|box back/.test(name)) push('Width', d.runner === 'side_mount_slides'
        ? `opening − ${fine(K.SLIDE_SPACE_MM)} (${fine(K.SLIDE_SPACE_MM / 2)} per side, the slide's ½ in) − 2 × box side = ${mm(op.w)} − ${fine(K.SLIDE_SPACE_MM)} − 2×${mm(d.box.t)} = ${mm(d.box.w - 2 * d.box.t)}`
        : `opening − ${fine(4)} (fitted) − 2 × box side = ${mm(d.box.w - 2 * d.box.t)}`);
      if (/ front$/.test(name) && !/box/.test(name)) push('Size', d.frontStyle === 'inset'
        ? `inset front = opening − ${fine(2)} gap all around = ${mm(d.front.w)} × ${mm(d.front.h)}`
        : `overlay front = opening + up to ${fine(10)} per side = ${mm(d.front.w)} × ${mm(d.front.h)}`);
      if (/bottom$/.test(name)) push('Size', `${mm(6)} ply in a ${mm(6)} groove, ${mm(10)} up — floats, no glue`);
    } else if (name === 'Toe-kick board') {
      push('Size', `width − 2 × side, ${mm(90)} tall, set back ${mm(75)} (standard recess)`);
    } else if (name === 'Lower shelf') {
      push('Length', `frame width − 2 × leg + ${mm(30)} notch allowance`);
    }

    if (row.allowance) {
      const j = K.JOINERY[row.allowanceJoint];
      push('Joinery allowance', `cut length includes ${row.allowanceEnds} × ${mm(row.allowance / row.allowanceEnds)} for ${j ? j.label.toLowerCase() : row.allowanceJoint} = +${mm(row.allowance)} (geometry ${mm(row.L - row.allowance)} → cut ${mm(row.L)}); tenon/housing depth is capped by the mate's thickness (blind tenon ≤ mate − ${mm(6)}, housing ≤ ⅓ of the stock)`);
    }
    if (row.angles) {
      push('Angles', `saw angles from part rotation, rounded to 0.5°: ${BB.Geo.angleText(row.angles)}`);
    }
    if (!lines.length) push('Dimensions', 'direct from the parametric template for this piece');
    return lines;
  }

  /* ---------------- species comparison ----------------
   * Recompute the same design with the material swapped: purchasable cost
   * from the stock optimizer, weight, sag margin on the critical span,
   * seasonal movement, and Janka surface duty. Pure functions — instant.
   */
  function weightKg(spec, model) {
    let kg = 0;
    for (const p of model.parts) {
      if (p.role === 'pull') continue;
      const sg = p.material === 'baltic_birch' ? K.WOOD_SPECIES.baltic_birch.sg : (K.WOOD_SPECIES[spec.wood.species] || K.WOOD_SPECIES.pine).sg;
      const volFactor = p.prim === 'cylinder' ? Math.PI / 4 : 1;
      kg += p.size.w * p.size.h * p.size.d * 1e-9 * sg * 1000 * volFactor;
    }
    return kg;
  }

  function compareSpecies(spec, speciesKeys, opts) {
    opts = opts || {};
    const out = [];
    for (const key of speciesKeys.slice(0, 3)) {
      const sp = K.WOOD_SPECIES[key];
      if (!sp || sp.sheet) continue;
      const s2 = BB.Spec.correctSpec(BB.Spec.deepMerge(spec, { wood: { species: key } }));
      const m2 = BB.Parametric.build(s2);
      const cut2 = BB.Plans.cutList(s2, m2);
      const plan = BB.Packing.planStock(s2, m2, cut2, { prices: opts.prices, stockMode: opts.stockMode });
      const integ = BB.Structural.computeIntegrity(s2, m2, { loadChoices: opts.loadChoices, defaultLoad: opts.defaultLoad, climate: opts.climate });
      const worst = integ.summary.worstSag;
      const sagMargin = worst && worst.sag > 0 ? worst.limit / worst.sag : Infinity;
      // Worst-panel movement, read from the check's raw data — never parsed
      // back out of display text (which is unit-dependent).
      let movement = 0;
      for (const c of integ.checks) {
        if (!c.id.startsWith('move:') || !c.data) continue;
        movement = Math.max(movement, c.data.movementMM || 0);
      }
      out.push({
        key, label: sp.label,
        cost: plan.totalCost,
        weightKg: Math.round(weightKg(s2, m2) * 10) / 10,
        sagMargin: sagMargin === Infinity ? null : Math.round(sagMargin * 100) / 100,
        worstSagMM: worst ? Math.round(worst.sag * 100) / 100 : null,
        span: worst ? Math.round(worst.span) : null,
        movementMM: Math.round(movement * 10) / 10,
        janka: sp.janka,
        duty: sp.janka >= 1000 ? 'hard-wearing' : 'dents under daily use',
        fails: integ.summary.fails
      });
    }
    return out;
  }

  BB.Prov = { forCutRow };
  BB.Compare = { compareSpecies, weightKg };
})();
