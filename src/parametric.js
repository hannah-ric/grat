/* Blueprint Buddy — parametric layer.
 * Pure function: corrected DesignSpec → model { parts, joints, openings, drawers, bounds }.
 *
 * Scene coordinates (in-app): Y up, origin at floor center, +Z toward the viewer
 * (front). Part positions are box centers in mm. Exports convert axes themselves.
 *
 * The AI never touches this math. Drawer dimensions derive from the opening;
 * openings derive from the template frame.
 */
var BB = globalThis.BB = globalThis.BB || {};

(function () {
  'use strict';
  const K = BB.K;

  const RAIL_H = 60, RAIL_T = 20;          // drawer rails: 20 mm thick × 60 mm tall
  const DEFAULT_OPENING_H = 130;           // equal-height openings by default
  const MIN_LEG_REVEAL = 120;              // nightstand: legs must show below the bank

  function part(id, defKey, role, name, w, h, d, x, y, z, opts) {
    return Object.assign({
      id, defKey, role, name,
      size: { w, h, d }, pos: { x, y, z },
      material: 'solid', group: 'frame',
      explode: { x: 0, y: 0, z: 0 }
    }, opts || {});
  }

  /* ---------------- drawer bank math (shared by nightstand + cabinet) ----------------
   * zone: { clearW, yTop, zFront, interiorDepth, count, railLen, railJoint }
   * Rails stack top-down: rail, opening, rail, opening, ..., rail.
   */
  function bankHeights(availableH, count) {
    const desired = (count + 1) * RAIL_H + count * DEFAULT_OPENING_H;
    const bank = Math.min(desired, availableH);
    const openH = (bank - (count + 1) * RAIL_H) / count;
    return { bank, openH: Math.floor(openH * 10) / 10 };
  }

  /* Cheap probe used by spec correction to auto-reduce shelf count: the
   * center-to-center spacing shelves would get in the carcass shelf zone. */
  function shelfSpacingFor(spec) {
    const t = spec.meta.template, o = spec.overall, st = spec.structure;
    const n = st.shelfCount;
    if (!n) return Infinity;
    let span;
    if (t === 'bookshelf') {
      span = (o.height - st.shelfThickness) - (st.shelfThickness + 40);
    } else if (t === 'cabinet') {
      const base = st.toeKick ? 90 : 0;
      const bodyH = o.height - st.topThickness - base;
      const bank = spec.drawers ? bankHeights(bodyH * 0.6, spec.drawers.count).bank : 0;
      span = (o.height - st.topThickness - bank) - (base + 19);
    } else return Infinity;
    return span / (n + 1);
  }

  /* Cheap probe used by spec correction to auto-reduce drawer count. */
  function openingHeightFor(spec) {
    const t = spec.meta.template, o = spec.overall, st = spec.structure;
    const count = spec.drawers ? spec.drawers.count : 1;
    let available;
    if (t === 'nightstand') available = o.height - st.topThickness - MIN_LEG_REVEAL;
    else if (t === 'cabinet') {
      // Must mirror cabinet(): available = bodyH × 0.6 — probe/builder parity
      // (audit F-S2-8).
      const base = st.toeKick ? 90 : 0;
      available = (o.height - st.topThickness - base) * 0.6;
    } else return Infinity;
    return bankHeights(available, count).openH;
  }

  function buildBank(spec, zone, parts, joints, prefix) {
    const d = spec.drawers;
    const solidT = 15, sheetT = 12;
    const boxT = spec.wood.sheetSpecies ? sheetT : solidT; // sheet-stock boxes by default
    const boxMat = spec.wood.sheetSpecies || 'baltic_birch';
    const openings = [], drawers = [];
    const { openH } = bankHeights(zone.available, d.count);

    let yCursor = zone.yTop; // top of the bank
    for (let i = 0; i <= d.count; i++) {
      const railY = yCursor - RAIL_H / 2;
      parts.push(part(
        `${prefix}rail_${i + 1}`, `rail_${Math.round(zone.railLen)}`, 'rail',
        i === 0 ? 'Top drawer rail' : (i === d.count ? 'Bottom drawer rail' : 'Divider rail'),
        zone.railLen, RAIL_H, RAIL_T,
        zone.x || 0, railY, zone.zFront - RAIL_T / 2,
        { explode: { x: 0, y: 0, z: 0.6 } }
      ));
      if (zone.railJointTargets) {
        for (const tgt of zone.railJointTargets) {
          joints.push({
            type: spec.joinery.frame, a: `${prefix}rail_${i + 1}`, b: tgt.id,
            pos: { x: tgt.x, y: railY, z: zone.zFront - RAIL_T / 2 }
          });
        }
      }
      yCursor -= RAIL_H;
      if (i < d.count) {
        const opTop = yCursor, opBottom = yCursor - openH;
        openings.push({
          index: i, w: zone.clearW, h: openH,
          x: zone.x || 0, yTop: opTop, yBottom: opBottom, zTop: opTop,
          zFront: zone.zFront, interiorDepth: zone.interiorDepth
        });
        yCursor -= openH;
      }
    }

    // Drawer boxes: every dimension derives from the opening (§5 math).
    openings.forEach((op, i) => {
      const runner = d.runner;
      const under = runner === 'undermount_slides';
      let boxW, boxH, boxD, slideLen = null;
      if (runner === 'side_mount_slides') {
        // Ball-bearing slides are 1/2 in (12.7 mm) per side — 12.5 binds
        // (audit F-S1-4). The constant lives in the hardware knowledge.
        boxW = op.w - K.SLIDE_SPACE_MM;
        boxH = op.h - 15;                       // 15 mm vertical clearance
        const maxLen = op.interiorDepth - 25;   // 25 mm rear setback
        slideLen = null;
        for (const L of K.SLIDE_LENGTHS) if (L <= maxLen) slideLen = L;
        // No slide fits: the box still must not punch through the back —
        // validation reports the too-shallow interior; geometry stays honest.
        boxD = slideLen || Math.max(10, Math.floor(maxLen / 10) * 10);
      } else if (under) {
        // Undermount regime (2026 hardware expansion): the box is BUILT TO
        // THE SLIDE — Blum-class spec: INSIDE width = opening − 42 (the
        // locking devices register on the box interior, so outside = that
        // plus two box sides), 19 mm height clearance, depth exactly the
        // slide length, captured bottom recessed 12.7. The constant lives
        // in the hardware knowledge (audit FE-H8).
        const uc = (BB.HW && BB.HW.SLIDES.undermount_45.clearances) || { insideWidthMinus: 42 };
        boxW = op.w - uc.insideWidthMinus + 2 * boxT;
        boxH = op.h - 19;
        const maxLen = op.interiorDepth - 25;
        slideLen = null;
        for (const L of K.SLIDE_LENGTHS) if (L <= maxLen) slideLen = L;
        boxD = slideLen || Math.max(10, Math.floor(maxLen / 10) * 10);
      } else {
        boxW = op.w - 4;                        // fitted wood runners
        boxH = op.h - 10;
        boxD = op.interiorDepth - 20;
      }
      const frontT = 19;
      const inset = d.frontStyle === 'inset';
      // Inset fronts finish flush with the rail faces, so the box starts one
      // front-thickness behind the front plane. Overlay boxes start at it.
      const boxFrontZ = op.zFront - (inset ? frontT : 0);
      const boxBottomY = op.yBottom + (op.h - boxH) / 2;
      const cy = boxBottomY + boxH / 2;
      const cz = boxFrontZ - boxD / 2;
      const g = 'drawer_' + i;
      const px = op.x;

      const boxJoint = spec.joinery.box;
      // Undermount boxes always capture their bottom (the slide hooks it).
      const slideIn = !under && (boxJoint === 'butt_screws' || boxJoint === 'pocket_screws');
      const dp = [];
      dp.push(part(`${prefix}dr${i + 1}_side_l`, `drbox_side_${boxD}x${boxH}`, 'drawer_side', `Drawer ${i + 1} side`, boxT, boxH, boxD, px - boxW / 2 + boxT / 2, cy, cz, { material: boxMat, group: g }));
      dp.push(part(`${prefix}dr${i + 1}_side_r`, `drbox_side_${boxD}x${boxH}`, 'drawer_side', `Drawer ${i + 1} side`, boxT, boxH, boxD, px + boxW / 2 - boxT / 2, cy, cz, { material: boxMat, group: g }));
      dp.push(part(`${prefix}dr${i + 1}_boxfront`, `drbox_front_${boxW}x${boxH}`, 'drawer_boxfront', `Drawer ${i + 1} box front`, boxW - 2 * boxT, boxH, boxT, px, cy, boxFrontZ - boxT / 2, { material: boxMat, group: g }));
      const backH = slideIn ? boxH - 16 : boxH; // cut down so the bottom slides in from the rear
      dp.push(part(`${prefix}dr${i + 1}_boxback`, `drbox_back_${boxW}x${backH}`, 'drawer_boxback', `Drawer ${i + 1} box back`, boxW - 2 * boxT, backH, boxT, px, boxBottomY + (slideIn ? backH / 2 + 16 : boxH / 2), boxFrontZ - boxD + boxT / 2, { material: boxMat, group: g }));
      // Bottom: 6 mm in a 6 mm groove 10 mm up — except undermount, whose
      // 12 mm bottom sits recessed 12.7 so the slide arms tuck under it.
      const botT = under ? 12 : 6;
      const botY = under ? boxBottomY + 12.7 + botT / 2 : boxBottomY + 13;
      const botW = boxW - 2 * boxT + 10;
      const botD = slideIn ? boxD - boxT - (boxT - 6) : boxD - 2 * boxT + 10;
      dp.push(part(`${prefix}dr${i + 1}_bottom`, `drbox_bot_${Math.round(botW)}x${Math.round(botD)}`, 'drawer_bottom', `Drawer ${i + 1} bottom`, botW, botT, botD, px, botY, cz, { material: boxMat, group: g }));

      // Applied front: inset = opening − 2 mm gap all around; overlay = +10 mm
      // per side where the surround allows.
      let fw, fh;
      if (inset) { fw = op.w - 4; fh = op.h - 4; }
      else {
        fw = op.w + Math.min(20, (zone.overlayMaxW - op.w));
        fh = op.h + Math.min(20, 2 * (RAIL_H - 10));
      }
      const frontZ = inset ? op.zFront - frontT / 2 : op.zFront + frontT / 2;
      dp.push(part(`${prefix}dr${i + 1}_front`, `drfront_${Math.round(fw)}x${Math.round(fh)}`, 'drawer_front', `Drawer ${i + 1} front`, fw, frontT, 0, 0, 0, 0, { material: spec.wood.species, group: g }));
      // fix size/pos (front is w×h×t in scene axes)
      const f = dp[dp.length - 1];
      f.size = { w: fw, h: fh, d: frontT };
      f.pos = { x: px, y: op.yBottom + op.h / 2, z: frontZ };
      // Pull(s): STYLE from the spec; count, size, and spacing from the
      // hardware rules (BB.HW.pullSpec) — code owns the numbers.
      const pullStyle = (BB.HW && spec.hardware && BB.HW.PULLS[spec.hardware.pull]) ? spec.hardware.pull : 'bar_pull';
      const pSpec = BB.HW ? BB.HW.pullSpec(fw, pullStyle) : { style: 'bar_pull', count: 1, ctcMM: 96, holes: 2 };
      if (pullStyle !== 'none_touch') {
        const isKnob = /knob|ring/.test(pSpec.style);
        const pw = isKnob ? 35 : Math.max(60, Math.min(fw - 40, (pSpec.ctcMM || 96) + 14));
        const ph = isKnob ? 35 : 12;
        const pd = /cup/.test(pSpec.style) ? 28 : 22;
        // Tall fronts carry hardware in the upper-rail zone; a stack shares
        // one centerline (all fronts here already share px).
        const pullY = fh > 250 ? f.pos.y + fh / 2 - 60 : f.pos.y;
        for (let pi = 0; pi < pSpec.count; pi++) {
          const pxOff = pSpec.count === 1 ? 0 : (pi === 0 ? -fw / 6 : fw / 6);
          dp.push(part(`${prefix}dr${i + 1}_pull${pSpec.count > 1 ? '_' + (pi + 1) : ''}`, 'pull', 'pull', `Drawer ${i + 1} pull`,
            pw, ph, pd, px + pxOff, pullY, frontZ + frontT / 2 + pd / 2, { material: 'hardware', group: g }));
        }
      }

      for (const p of dp) { p.drawer = i; p.explode = { x: 0, y: 0, z: 0 }; }
      parts.push(...dp);

      /* Running gear in the model (2026): the case-side members render in
       * the main scene at their true positions. Metal slides are `hardware`
       * parts — visible in 3D and every geometry export, excluded from the
       * cut list, the packing plan, and the mass model (a folded steel
       * channel is not an oak box). Wooden runners are honest LUMBER: they
       * join the cut list, the stock plan, and the screw counts, because a
       * builder really has to cut and fit them. All stay `group: 'frame'` —
       * the case keeps its rail when the drawer glides open. */
      const gearIds = [];
      if (runner === 'side_mount_slides' && slideLen) {
        // One slide pair filling the exact 12.7 mm per-side clearance,
        // mounted flush with the BOX front plane (behind an inset front,
        // at the case edge for overlay) — exactly where a slide really
        // lands, and pen 0 against box, front, and case alike.
        const sh = Math.min(45, boxH - 4);
        [[-1, 'l'], [1, 'r']].forEach(([sgn, side]) => {
          const id = `${prefix}dr${i + 1}_slide_${side}`;
          parts.push(part(id, 'slide_side', 'slide', `Drawer ${i + 1} slide`,
            12.7, sh, slideLen, px + sgn * (op.w / 2 - 12.7 / 2), cy, boxFrontZ - slideLen / 2,
            { material: 'hardware', hardware: true, group: 'frame' }));
          gearIds.push(id);
        });
      } else if (under && slideLen) {
        // Undermount arms live INSIDE the box footprint, under the recessed
        // bottom (12.7 recess, 11 mm arm) — invisible from outside, exactly
        // as sold.
        const railW = Math.max(30, Math.min(42, Math.floor((boxW - 2 * boxT) / 4)));
        const sd = Math.max(50, boxD - 2 * boxT - 4);
        [[-1, 'l'], [1, 'r']].forEach(([sgn, side]) => {
          const id = `${prefix}dr${i + 1}_slide_${side}`;
          parts.push(part(id, 'slide_under', 'slide', `Drawer ${i + 1} undermount slide`,
            railW, 11, sd, px + sgn * (boxW / 2 - boxT - railW / 2 - 2), boxBottomY + 11 / 2, cz,
            { material: 'hardware', hardware: true, group: 'frame' }));
          gearIds.push(id);
        });
      } else if (runner === 'wood_runners') {
        // Traditional runner: a hardwood rail the drawer side rides on,
        // packed out flush to the case face (legs proud of aprons on a
        // nightstand make that one thicker block), 19 mm of bearing inside
        // the opening edge, stopped behind the front rail band.
        const runW = Math.round((zone.sideInnerX !== undefined ? zone.sideInnerX - op.w / 2 : 0) * 10) / 10 + 19;
        // Start behind the front structure (legs on a nightstand, the rail
        // band on a cabinet) and stop short of the rear — the runner spans
        // between the case's own members, exactly as it would in the shop.
        const setback = Math.max(RAIL_T, zone.gearFrontSetback || 0) + 2;
        const runD = Math.max(80, Math.round(op.interiorDepth - setback - 28));
        const runZ = zone.zFront - setback - runD / 2;
        [[-1, 0], [1, 1]].forEach(([sgn, ti]) => {
          const id = `${prefix}dr${i + 1}_runner_${sgn < 0 ? 'l' : 'r'}`;
          parts.push(part(id, `runner_${runD}`, 'runner', `Drawer ${i + 1} runner`,
            runW, 32, runD, px + sgn * (op.w / 2 - 19 + runW / 2), boxBottomY - 16, runZ,
            { group: 'frame' }));
          gearIds.push(id);
          const tgt = zone.runnerTargets && zone.runnerTargets[ti];
          if (tgt) {
            joints.push({ type: 'butt_screws', a: id, b: tgt, pos: { x: px + sgn * (op.w / 2 - 19 + runW), y: boxBottomY - 16, z: runZ }, noCutAllowance: true });
          }
        });
      }

      // Box-corner joints. The front/back are the inserted members (tongue or
      // tails live on them), so they carry the cut-length allowance. Grooved
      // boxes (locking rabbet / dovetail fronts) take a DADO-housed back —
      // the standard partner to a fine front, never a screwed-on back
      // (audit F-S3-9); slide-in boxes keep their screwed backs.
      joints.push(
        { type: boxJoint, a: dp[2].id, b: dp[0].id, pos: { x: px - boxW / 2 + boxT, y: cy, z: boxFrontZ - boxT / 2 } },
        { type: boxJoint, a: dp[2].id, b: dp[1].id, pos: { x: px + boxW / 2 - boxT, y: cy, z: boxFrontZ - boxT / 2 } },
        { type: slideIn ? boxJoint : 'dado', a: dp[3].id, b: dp[0].id, pos: { x: px - boxW / 2 + boxT, y: cy, z: boxFrontZ - boxD + boxT / 2 } },
        { type: slideIn ? boxJoint : 'dado', a: dp[3].id, b: dp[1].id, pos: { x: px + boxW / 2 - boxT, y: cy, z: boxFrontZ - boxD + boxT / 2 } }
      );

      drawers.push({
        index: i, group: g, opening: op,
        box: { w: boxW, h: boxH, d: boxD, t: boxT },
        slideLen, runner, frontStyle: d.frontStyle,
        front: { w: fw, h: fh, t: frontT },
        pull: Object.assign({ styleKey: pullStyle }, pSpec),
        travel: Math.round(boxD * 0.8),
        partIds: dp.map(p => p.id),
        gearIds
      });
    });

    return { openings, drawers };
  }

  /* ---------------- templates ---------------- */

  function tableLike(spec) {
    const o = spec.overall, st = spec.structure;
    const t = spec.meta.template;
    const parts = [], joints = [];
    const overhang = t === 'bench' ? 20 : 35;
    const legT = st.legThickness, topT = st.topThickness;
    const frameW = o.width - 2 * overhang, frameD = o.depth - 2 * overhang;
    const legH = o.height - topT;
    const sp = spec.wood.species;

    const lx = frameW / 2 - legT / 2, lz = frameD / 2 - legT / 2;
    [[-lx, -lz, 1], [lx, -lz, 2], [-lx, lz, 3], [lx, lz, 4]].forEach(([x, z, i]) => {
      parts.push(part(`leg_${i}`, `leg`, 'leg', 'Leg', legT, legH, legT, x, legH / 2, z,
        { material: sp, explode: { x: Math.sign(x) * 0.35, y: -0.4, z: Math.sign(z) * 0.35 } }));
    });

    const apY = o.height - topT - st.apronHeight / 2;
    const apLenLong = frameW - 2 * legT, apLenShort = frameD - 2 * legT;
    const apZ = frameD / 2 - st.apronInset - st.apronThickness / 2;
    const apX = frameW / 2 - st.apronInset - st.apronThickness / 2;
    [[-apZ, 1], [apZ, 2]].forEach(([z, i]) => {
      parts.push(part(`apron_long_${i}`, 'apron_long', 'apron', 'Long apron', apLenLong, st.apronHeight, st.apronThickness, 0, apY, z,
        { material: sp, explode: { x: 0, y: 0, z: Math.sign(z) } }));
    });
    [[-apX, 1], [apX, 2]].forEach(([x, i]) => {
      parts.push(part(`apron_short_${i}`, 'apron_short', 'apron', 'Short apron', st.apronThickness, st.apronHeight, apLenShort, x, apY, 0,
        { material: sp, explode: { x: Math.sign(x), y: 0, z: 0 } }));
    });

    parts.push(part('top_1', 'top', 'top', t === 'bench' ? 'Seat' : 'Top', o.width, topT, o.depth, 0, o.height - topT / 2, 0,
      { material: sp, explode: { x: 0, y: 1, z: 0 } }));

    // Frame joints: each apron end into its leg.
    const fj = spec.joinery.frame;
    for (const [z] of [[-apZ], [apZ]]) {
      joints.push({ type: fj, a: z < 0 ? 'apron_long_1' : 'apron_long_2', b: z < 0 ? 'leg_1' : 'leg_3', pos: { x: -lx, y: apY, z } });
      joints.push({ type: fj, a: z < 0 ? 'apron_long_1' : 'apron_long_2', b: z < 0 ? 'leg_2' : 'leg_4', pos: { x: lx, y: apY, z } });
    }
    for (const [x] of [[-apX], [apX]]) {
      joints.push({ type: fj, a: x < 0 ? 'apron_short_1' : 'apron_short_2', b: x < 0 ? 'leg_1' : 'leg_2', pos: { x, y: apY, z: -lz } });
      joints.push({ type: fj, a: x < 0 ? 'apron_short_1' : 'apron_short_2', b: x < 0 ? 'leg_3' : 'leg_4', pos: { x, y: apY, z: lz } });
    }
    joints.push({ type: 'butt_screws', a: 'top_1', b: 'apron_long_1', pos: { x: 0, y: o.height - topT, z: -apZ } });
    joints.push({ type: 'butt_screws', a: 'top_1', b: 'apron_long_2', pos: { x: 0, y: o.height - topT, z: apZ } });

    addStretchers(spec, parts, joints, { lx, lz, legT, sp });

    return { parts, joints, openings: [], drawers: [] };
  }

  /* ---------------- stretchers (X-07) ----------------
   * Leg-to-leg bracing low on the frame. Two styles, both real furniture:
   *
   *   h    two side stretchers running front-to-back, tied at their
   *        midpoints by one long centre stretcher. The trestle/desk answer —
   *        it braces the frame without a rail across the foot well.
   *   box  the perimeter: four stretchers, leg to leg all the way round.
   *        Stiffer, and the traditional look on benches and hall tables;
   *        the long rails are where your feet go, so it earns its footroom
   *        cost only if you want the bracing.
   *
   * Section is code-owned, not another knob: a stretcher carries almost no
   * bending — its job is triangulation and shortening the leg's unbraced
   * length — so it is cut from the apron's own stock thickness at a fraction
   * of the apron's height. One stock thickness, one setup, no new stock line.
   *
   * The centre stretcher of an `h` meets the side stretchers on their FACE,
   * not their end, which is a different joint from every apron-to-leg joint
   * in the frame: end grain into a long-grain face. That is why it takes the
   * frame joint's own type but is called out separately in the plan.
   */
  const STRETCHER_H_RATIO = 0.65;   // of apron height
  const STRETCHER_H_MIN = 40, STRETCHER_H_MAX = 90;

  function stretcherSection(st) {
    return {
      h: Math.max(STRETCHER_H_MIN, Math.min(STRETCHER_H_MAX, Math.round(st.apronHeight * STRETCHER_H_RATIO))),
      t: st.apronThickness
    };
  }

  function addStretchers(spec, parts, joints, frame) {
    const st = spec.structure;
    if (!st.stretcher || st.stretcher === 'none') return;
    const { lx, lz, legT, sp } = frame;
    const sec = stretcherSection(st);
    const y = st.stretcherHeight;
    const fj = spec.joinery.frame;
    // Leg-face to leg-face: the stretcher spans the gap, it does not run past
    // the legs. Same arithmetic the aprons use, at the legs' own centres.
    const spanX = 2 * lx - legT, spanZ = 2 * lz - legT;

    const addRail = (id, name, w, h, d, x, yy, z, ex) =>
      parts.push(part(id, `stretcher_${Math.round(Math.max(w, d))}`, 'stretcher', name, w, h, d, x, yy, z,
        { material: sp, explode: ex }));

    if (st.stretcher === 'box') {
      [[-lz, 1], [lz, 2]].forEach(([z, i]) => {
        addRail(`stretcher_long_${i}`, 'Long stretcher', spanX, sec.h, sec.t, 0, y, z, { x: 0, y: -0.5, z: Math.sign(z) });
        joints.push({ type: fj, a: `stretcher_long_${i}`, b: z < 0 ? 'leg_1' : 'leg_3', pos: { x: -lx, y, z } });
        joints.push({ type: fj, a: `stretcher_long_${i}`, b: z < 0 ? 'leg_2' : 'leg_4', pos: { x: lx, y, z } });
      });
    }

    // Both styles carry the pair of side stretchers; `box` adds the long
    // pair above, `h` adds the single centre tie below.
    [[-lx, 1], [lx, 2]].forEach(([x, i]) => {
      addRail(`stretcher_side_${i}`, 'Side stretcher', sec.t, sec.h, spanZ, x, y, 0, { x: Math.sign(x), y: -0.5, z: 0 });
      joints.push({ type: fj, a: `stretcher_side_${i}`, b: x < 0 ? 'leg_1' : 'leg_2', pos: { x, y, z: -lz } });
      joints.push({ type: fj, a: `stretcher_side_${i}`, b: x < 0 ? 'leg_3' : 'leg_4', pos: { x, y, z: lz } });
    });

    if (st.stretcher === 'h') {
      // Centre tie runs leg-line to leg-line, landing on the INNER faces of
      // the two side stretchers — hence the section thickness taken off each
      // end rather than the leg thickness.
      const centreLen = 2 * lx - sec.t;
      addRail('stretcher_centre_1', 'Centre stretcher', centreLen, sec.h, sec.t, 0, y, 0, { x: 0, y: -0.5, z: 0 });
      joints.push({ type: fj, a: 'stretcher_centre_1', b: 'stretcher_side_1', pos: { x: -lx + sec.t / 2, y, z: 0 } });
      joints.push({ type: fj, a: 'stretcher_centre_1', b: 'stretcher_side_2', pos: { x: lx - sec.t / 2, y, z: 0 } });
    }
  }

  function bookshelf(spec) {
    const o = spec.overall, st = spec.structure;
    const parts = [], joints = [];
    const sideT = st.sideThickness, shT = st.shelfThickness;
    const innerW = o.width - 2 * sideT;
    const sp = spec.wood.species;
    // The declared depth is the whole piece, door included — see doorSpace().
    const ds = doorSpace(spec);

    [[-1, 1], [1, 2]].forEach(([s, i]) => {
      parts.push(part(`side_${i}`, 'side', 'side', 'Side', sideT, o.height, o.depth, s * (o.width / 2 - sideT / 2), o.height / 2, 0,
        { material: sp, explode: { x: s, y: 0, z: 0 } }));
    });
    parts.push(part('top_1', 'shelf_fixed', 'top', 'Top', innerW, shT, o.depth, 0, o.height - shT / 2, 0, { material: sp, explode: { x: 0, y: 1, z: 0 } }));
    parts.push(part('bottom_1', 'shelf_fixed', 'bottom', 'Bottom', innerW, shT, o.depth, 0, shT / 2 + 40, 0, { material: sp, explode: { x: 0, y: -0.6, z: 0 } }));

    const y0 = shT + 40, y1 = o.height - shT;
    const n = st.shelfCount;
    for (let i = 1; i <= n; i++) {
      const y = y0 + (y1 - y0) * i / (n + 1);
      parts.push(part(`shelf_${i}`, 'shelf', 'shelf', 'Shelf', innerW, shT, o.depth - 20 - ds.recess, 0, y, 10 - ds.recess / 2, { material: sp, explode: { x: 0, y: 0, z: 0.8 } }));
      joints.push({ type: spec.joinery.case, a: `shelf_${i}`, b: 'side_1', pos: { x: -(o.width / 2 - sideT), y, z: 0 } });
      joints.push({ type: spec.joinery.case, a: `shelf_${i}`, b: 'side_2', pos: { x: (o.width / 2 - sideT), y, z: 0 } });
    }
    if (st.backPanel) {
      parts.push(part('back_1', 'back', 'back', 'Back panel', o.width - 12, o.height - 12, 6, 0, o.height / 2, -o.depth / 2 + 3,
        { material: spec.wood.sheetSpecies || 'baltic_birch', explode: { x: 0, y: 0, z: -1 } }));
      // The back sits in rabbets on all four case edges; its panel size
      // already includes the rabbet capture, so no cut-length allowance.
      joints.push({ type: 'rabbet', a: 'back_1', b: 'side_1', pos: { x: -(o.width / 2 - sideT / 2), y: o.height / 2, z: -o.depth / 2 + 3 }, noCutAllowance: true });
      joints.push({ type: 'rabbet', a: 'back_1', b: 'side_2', pos: { x: o.width / 2 - sideT / 2, y: o.height / 2, z: -o.depth / 2 + 3 }, noCutAllowance: true });
      joints.push({ type: 'rabbet', a: 'back_1', b: 'top_1', pos: { x: 0, y: o.height - shT / 2, z: -o.depth / 2 + 3 }, noCutAllowance: true });
      joints.push({ type: 'rabbet', a: 'back_1', b: 'bottom_1', pos: { x: 0, y: shT / 2 + 40, z: -o.depth / 2 + 3 }, noCutAllowance: true });
    }
    joints.push({ type: spec.joinery.case, a: 'top_1', b: 'side_1', pos: { x: -(o.width / 2 - sideT), y: o.height - shT / 2, z: 0 } });
    joints.push({ type: spec.joinery.case, a: 'top_1', b: 'side_2', pos: { x: (o.width / 2 - sideT), y: o.height - shT / 2, z: 0 } });
    joints.push({ type: spec.joinery.case, a: 'bottom_1', b: 'side_1', pos: { x: -(o.width / 2 - sideT), y: shT / 2 + 40, z: 0 } });
    joints.push({ type: spec.joinery.case, a: 'bottom_1', b: 'side_2', pos: { x: (o.width / 2 - sideT), y: shT / 2 + 40, z: 0 } });
    // The whole front is the opening on a bookshelf — a glazed or panelled
    // bookcase door is ordinary furniture, and the case is already there.
    addDoors(spec, parts, joints, {
      openW: innerW, openTop: o.height - shT, openBottom: shT + 40,
      zFront: o.depth / 2, caseOuterW: o.width, sideT, sp
    });
    return { parts, joints, openings: [], drawers: [] };
  }

  function nightstand(spec) {
    const o = spec.overall, st = spec.structure;
    const parts = [], joints = [];
    const overhang = 20;
    const legT = st.legThickness, topT = st.topThickness, apT = st.apronThickness;
    const frameW = o.width - 2 * overhang, frameD = o.depth - 2 * overhang;
    const legH = o.height - topT;
    const sp = spec.wood.species;
    const lx = frameW / 2 - legT / 2, lz = frameD / 2 - legT / 2;

    [[-lx, -lz, 1], [lx, -lz, 2], [-lx, lz, 3], [lx, lz, 4]].forEach(([x, z, i]) => {
      parts.push(part(`leg_${i}`, 'leg', 'leg', 'Leg', legT, legH, legT, x, legH / 2, z,
        { material: sp, explode: { x: Math.sign(x) * 0.35, y: -0.4, z: Math.sign(z) * 0.35 } }));
    });

    const available = o.height - topT - MIN_LEG_REVEAL;
    const { bank } = bankHeights(available, spec.drawers.count);
    const bankTop = o.height - topT;

    // Side + back aprons wrap the drawer bank.
    const sideLen = frameD - 2 * legT;
    const apY = bankTop - bank / 2;
    [[-1, 1], [1, 2]].forEach(([s, i]) => {
      parts.push(part(`apron_side_${i}`, 'apron_side', 'apron', 'Side apron', apT, bank, sideLen, s * (frameW / 2 - apT / 2), apY, 0,
        { material: sp, explode: { x: s, y: 0, z: 0 } }));
      joints.push({ type: spec.joinery.frame, a: `apron_side_${i}`, b: s < 0 ? 'leg_1' : 'leg_2', pos: { x: s * lx, y: apY, z: -lz } });
      joints.push({ type: spec.joinery.frame, a: `apron_side_${i}`, b: s < 0 ? 'leg_3' : 'leg_4', pos: { x: s * lx, y: apY, z: lz } });
    });
    parts.push(part('apron_back_1', 'apron_back', 'apron', 'Back apron', frameW - 2 * legT, bank, apT, 0, apY, -(frameD / 2 - apT / 2),
      { material: sp, explode: { x: 0, y: 0, z: -1 } }));
    joints.push({ type: spec.joinery.frame, a: 'apron_back_1', b: 'leg_1', pos: { x: -lx, y: apY, z: -lz } });
    joints.push({ type: spec.joinery.frame, a: 'apron_back_1', b: 'leg_2', pos: { x: lx, y: apY, z: -lz } });

    parts.push(part('top_1', 'top', 'top', 'Top', o.width, topT, o.depth, 0, o.height - topT / 2, 0,
      { material: sp, explode: { x: 0, y: 1, z: 0 } }));
    joints.push({ type: 'butt_screws', a: 'top_1', b: 'apron_side_1', pos: { x: -(frameW / 2 - apT / 2), y: o.height - topT, z: 0 } });
    joints.push({ type: 'butt_screws', a: 'top_1', b: 'apron_side_2', pos: { x: frameW / 2 - apT / 2, y: o.height - topT, z: 0 } });

    if (st.shelfCount > 0) {
      // The shelf notches around the legs (its size already includes the
      // notch capture — no cut allowance). Keep it clear of the drawer bank.
      const shelfY = Math.min(170, bankTop - bank - st.shelfThickness / 2 - 20);
      parts.push(part('shelf_1', 'shelf', 'shelf', 'Lower shelf', frameW - 2 * legT + 30, st.shelfThickness, frameD - 20, 0, shelfY, 0,
        { material: sp, explode: { x: 0, y: -0.5, z: 0.4 } }));
      [[-lx, -lz, 'leg_1'], [lx, -lz, 'leg_2'], [-lx, lz, 'leg_3'], [lx, lz, 'leg_4']].forEach(([x, z, leg]) => {
        joints.push({ type: spec.joinery.case, a: 'shelf_1', b: leg, pos: { x, y: shelfY, z }, noCutAllowance: true });
      });
    }

    const zone = {
      clearW: frameW - 2 * legT, railLen: frameW - 2 * legT,
      yTop: bankTop, zFront: frameD / 2,
      interiorDepth: frameD - apT, available,
      overlayMaxW: frameW - 2 * legT + Math.min(20, legT), x: 0,
      // Rails live at the front plane — they join into the FRONT legs.
      railJointTargets: [{ id: 'leg_3', x: -lx }, { id: 'leg_4', x: lx }],
      // Running gear: legs stand proud of the aprons, so wooden runners pack
      // out from the apron face and everything starts behind the front legs.
      sideInnerX: frameW / 2 - apT, gearFrontSetback: legT,
      runnerTargets: ['apron_side_1', 'apron_side_2']
    };
    const bankOut = buildBank(spec, zone, parts, joints, '');
    return { parts, joints, openings: bankOut.openings, drawers: bankOut.drawers };
  }

  function cabinet(spec) {
    const o = spec.overall, st = spec.structure;
    const parts = [], joints = [];
    const sideT = st.sideThickness, topT = st.topThickness;
    const base = st.toeKick ? 90 : 0;
    const sp = spec.wood.species;
    // The declared depth is the whole piece, door included — see doorSpace().
    const ds = doorSpace(spec);
    // Sides run floor to underside of top: the case stands on its own sides
    // (with the toe board bracing the front), never on a lone 19 mm plinth.
    const sideH = o.height - topT;
    const bodyH = sideH - base; // interior case height above the toe space
    const innerW = o.width - 2 * sideT;

    [[-1, 1], [1, 2]].forEach(([s, i]) => {
      parts.push(part(`side_${i}`, 'side', 'side', 'Side', sideT, sideH, o.depth, s * (o.width / 2 - sideT / 2), sideH / 2, 0,
        { material: sp, explode: { x: s, y: 0, z: 0 } }));
    });
    parts.push(part('bottom_1', 'bottom', 'bottom', 'Bottom', innerW, 19, o.depth, 0, base + 19 / 2, 0, { material: sp, explode: { x: 0, y: -0.6, z: 0 } }));
    joints.push({ type: spec.joinery.case, a: 'bottom_1', b: 'side_1', pos: { x: -innerW / 2, y: base + 10, z: 0 } });
    joints.push({ type: spec.joinery.case, a: 'bottom_1', b: 'side_2', pos: { x: innerW / 2, y: base + 10, z: 0 } });

    parts.push(part('top_1', 'top', 'top', 'Top', o.width, topT, o.depth, 0, o.height - topT / 2, 0, { material: sp, explode: { x: 0, y: 1, z: 0 } }));
    joints.push({ type: 'butt_screws', a: 'top_1', b: 'side_1', pos: { x: -(o.width / 2 - sideT / 2), y: o.height - topT, z: 0 } });
    joints.push({ type: 'butt_screws', a: 'top_1', b: 'side_2', pos: { x: o.width / 2 - sideT / 2, y: o.height - topT, z: 0 } });

    if (st.toeKick) {
      const plinthZ = o.depth / 2 - 75 - 9.5;
      parts.push(part('plinth_1', 'plinth', 'plinth', 'Toe-kick board', innerW, 90, 19, 0, 45, plinthZ,
        { material: sp, explode: { x: 0, y: -1, z: 0.4 } }));
      joints.push({ type: spec.joinery.case, a: 'plinth_1', b: 'side_1', pos: { x: -innerW / 2, y: 45, z: plinthZ } });
      joints.push({ type: spec.joinery.case, a: 'plinth_1', b: 'side_2', pos: { x: innerW / 2, y: 45, z: plinthZ } });
      joints.push({ type: 'butt_screws', a: 'plinth_1', b: 'bottom_1', pos: { x: 0, y: base, z: plinthZ }, noCutAllowance: true });
    }
    if (st.backPanel) {
      parts.push(part('back_1', 'back', 'back', 'Back panel', o.width - 12, bodyH - 12, 6, 0, base + bodyH / 2, -o.depth / 2 + 3,
        { material: spec.wood.sheetSpecies || 'baltic_birch', explode: { x: 0, y: 0, z: -1 } }));
      // The back sits in rabbets: sides and bottom. Its panel size already
      // includes the rabbet capture, so no cut-length allowance applies.
      joints.push({ type: 'rabbet', a: 'back_1', b: 'side_1', pos: { x: -(o.width / 2 - sideT / 2), y: base + bodyH / 2, z: -o.depth / 2 + 3 }, noCutAllowance: true });
      joints.push({ type: 'rabbet', a: 'back_1', b: 'side_2', pos: { x: o.width / 2 - sideT / 2, y: base + bodyH / 2, z: -o.depth / 2 + 3 }, noCutAllowance: true });
      joints.push({ type: 'rabbet', a: 'back_1', b: 'bottom_1', pos: { x: 0, y: base + 10, z: -o.depth / 2 + 3 }, noCutAllowance: true });
    }

    const available = bodyH * 0.6;
    const zone = {
      clearW: innerW, railLen: innerW,
      yTop: o.height - topT, zFront: o.depth / 2 - ds.recess,
      interiorDepth: o.depth - 10 - ds.recess, available,
      overlayMaxW: innerW + Math.min(20, sideT), x: 0,
      railJointTargets: [{ id: 'side_1', x: -innerW / 2 }, { id: 'side_2', x: innerW / 2 }],
      // Case sides run flush with the opening: runners land straight on them.
      sideInnerX: innerW / 2, gearFrontSetback: RAIL_T,
      runnerTargets: ['side_1', 'side_2']
    };
    let bankOut = { openings: [], drawers: [] };
    if (spec.drawers) bankOut = buildBank(spec, zone, parts, joints, '');

    // Shelves in the open section below the bank.
    const { bank } = spec.drawers ? bankHeights(available, spec.drawers.count) : { bank: 0 };
    const shelfZoneTop = o.height - topT - bank, shelfZoneBottom = base + 19;
    for (let i = 1; i <= st.shelfCount; i++) {
      const y = shelfZoneBottom + (shelfZoneTop - shelfZoneBottom) * i / (st.shelfCount + 1);
      parts.push(part(`shelf_${i}`, 'shelf', 'shelf', 'Shelf', innerW, st.shelfThickness, o.depth - 30 - ds.recess, 0, y, 5 - ds.recess / 2,
        { material: sp, explode: { x: 0, y: 0, z: 0.8 } }));
      joints.push({ type: spec.joinery.case, a: `shelf_${i}`, b: 'side_1', pos: { x: -innerW / 2, y, z: 0 } });
      joints.push({ type: spec.joinery.case, a: `shelf_${i}`, b: 'side_2', pos: { x: innerW / 2, y, z: 0 } });
    }
    // Doors close whatever the drawer bank left: the shelf zone is the door
    // opening, which is why this reads the same two numbers the shelves do.
    addDoors(spec, parts, joints, {
      openW: innerW, openTop: shelfZoneTop, openBottom: shelfZoneBottom,
      zFront: o.depth / 2, caseOuterW: o.width, sideT, sp
    });
    return { parts, joints, openings: bankOut.openings, drawers: bankOut.drawers };
  }

  /* ---------------- doors (X-07) ----------------
   * A door is a panel and a swing. The panel is geometry and belongs here;
   * the swing is hardware and belongs to BB.HW, which already carried the
   * hinge catalog, the count rule, and the cup boring solver as a READY
   * stratum waiting for exactly this.
   *
   * Two styles, and the difference is entirely in where the panel sits:
   *   inset    the door lives INSIDE the opening, its own thickness behind
   *            the case front, with a reveal of air all round. The reveal is
   *            the whole difficulty of an inset door and the reason it reads
   *            as fine work — it has to stay even as the door moves.
   *   overlay  the door sits ON the front and covers the case edge. Easier,
   *            forgiving, and what a euro cup hinge is built around.
   *
   * DOOR_REVEAL is a shop number, not a style choice: a 2 mm gap is what a
   * seasonal swing leaves you when the door is fitted in an average season.
   */
  const DOOR_REVEAL = 2;
  const DOOR_OVERLAY_LAP = 12;   // how far an overlay door laps the case edge
  const DOOR_T = 19;             // panel stock; a door thinner than this racks in its own frame

  /* An INSET door needs its recess kept clear. Everything inside the case —
   * the shelves, and the drawer bank's front plane — is set back by the door
   * thickness plus its reveal, or the door closes into the shelf edges.
   *
   * An OVERLAY door needs nothing: it stands proud of the case front, which
   * is the convention this codebase already follows for overlay drawer
   * fronts and pulls (spec.js PROUD_ROLES, 60 mm allowance). The declared
   * depth is the CARCASS, and applied fronts sit in front of it — so a door
   * is measured the same way a drawer front already is, rather than
   * inventing a second rule for the same face of the same cabinet.
   */
  function doorSpace(spec) {
    const d = spec.doors;
    if (!d || !d.count) return { none: true, recess: 0 };
    return { none: false, recess: d.style === 'inset' ? DOOR_T + DOOR_REVEAL : 0 };
  }

  function addDoors(spec, parts, joints, zone) {
    const d = spec.doors;
    if (!d || !d.count) return;
    const inset = d.style === 'inset';
    const openH = zone.openTop - zone.openBottom;
    if (openH < 120 || zone.openW < 120) return;   // nothing worth hanging a door on

    // Inset: the leaf is the opening less a reveal all round, split between
    // leaves (with a reveal down the meeting stile too). Overlay: the leaf
    // laps the case edge, so it is WIDER than the opening.
    const totalW = inset ? zone.openW - 2 * DOOR_REVEAL : Math.min(zone.caseOuterW, zone.openW + 2 * DOOR_OVERLAY_LAP);
    const leafW = d.count === 2 ? (totalW - (inset ? DOOR_REVEAL : 0)) / 2 : totalW;
    const leafH = inset ? openH - 2 * DOOR_REVEAL : openH + 2 * DOOR_OVERLAY_LAP;
    // Inset sits flush with the case front; overlay stands proud of it.
    const zDoor = inset ? zone.zFront - DOOR_T / 2 : zone.zFront + DOOR_T / 2;
    const yDoor = zone.openBottom + openH / 2;

    for (let i = 1; i <= d.count; i++) {
      const x = d.count === 2
        ? (i === 1 ? -1 : 1) * (leafW / 2 + (inset ? DOOR_REVEAL / 2 : 0))
        : 0;
      parts.push(part(`door_${i}`, `door_${Math.round(leafW)}x${Math.round(leafH)}`, 'door',
        d.count === 2 ? (i === 1 ? 'Left door' : 'Right door') : 'Door',
        leafW, leafH, DOOR_T, x, yDoor, zDoor,
        { material: spec.wood.species, explode: { x: d.count === 2 ? (i === 1 ? -0.6 : 0.6) : 0, y: 0, z: 1.2 } }));
      /* The hinge is NOT in the joint list, and that is deliberate: joints
       * here are permanent wood-to-wood connections that the cut list gives
       * allowances for and the racking model scores. A hinge is a mechanism —
       * it carries no racking, takes no cut allowance, and lives in the BOM
       * with the rest of the hardware. Recording it as a joint would credit
       * the case with stiffness a swinging door does not provide. */
    }
  }

  /* ---------------- seating: chair / stool (the 'seating' class) ----------------
   * The engineering profile lives in BB.Classes ('seating'); this builds its
   * geometry. Two honest constructions, both from straight stock:
   *
   *   chair  vertical rear posts running floor→crest (one piece, no sawn
   *          bend — the class REFUSES sawn rear legs, short grain). The back
   *          rake comes from offsetting the crest rearward and the slats
   *          forward WITHIN the post depth; the seat slopes by tilting the
   *          side rails and dropping the rear band, exactly as a rectilinear
   *          chair is really built. Corner blocks are structure and ship as
   *          parts.
   *   stool  backHeight 0: four legs splayed outward in both planes
   *          (compound angle), level rails, and a mandatory box-stretcher
   *          footrest. Legs are straight rips — the instructions demand the
   *          blank ripped WITH the grain along the leg axis, never sawn from
   *          a vertical blank (grain runout, see chair:grain).
   */
  function chairBuild(spec) {
    const st = spec.structure, se = spec.seat;
    const G = BB.Classes.get('seating').geom;
    const parts = [], joints = [];
    const sp = spec.wood.species;
    const fj = spec.joinery.frame;
    const W = se.width, D = se.depth, Hs = se.height;
    const seatT = st.topThickness, railH = st.apronHeight, railT = st.apronThickness;
    const legT = st.legThickness;
    const stool = se.backHeight === 0;
    const rad = d => d * Math.PI / 180;
    // Footrests carry a standing foot (chair:foot) — beefier than a table's
    // stretcher, same stock thickness.
    const secH = Math.max(45, Math.min(90, Math.round(railH * 0.75)));
    const secT = railT;
    const strY = st.stretcherHeight;
    const cb = G.CORNER_BLOCK;

    /* Ground a possibly-rotated part exactly: snap its lowest OBB corner to
     * the floor plane (the compound end cut trims the real leg flush). */
    const ground = p => {
      const cs = BB.Geo.obbCorners(BB.Geo.partOBB(p));
      const dy = Math.min(...cs.map(c => c[1]));
      if (Math.abs(dy) > 0.01) p.pos.y = Math.round((p.pos.y - dy) * 10) / 10;
    };

    if (stool) {
      const s = se.splayDeg, t = Math.tan(rad(s));
      const frameTop = Hs - seatT;
      const thetaR = Math.atan(Math.SQRT2 * t) * 180 / Math.PI; // compound resultant
      const lx = W / 2 - legT / 2, lz = D / 2 - legT / 2;
      // Axial length, trimmed a hair so the tilted top corners stay under the seat.
      const La = frameTop / Math.cos(rad(thetaR)) - legT * Math.tan(rad(thetaR));
      [[-1, -1, 1], [1, -1, 2], [-1, 1, 3], [1, 1, 4]].forEach(([sx, sz, i]) => {
        const runMid = t * (frameTop / 2); // outward travel of the leg centre at mid-height
        const p = part(`leg_${i}`, 'leg_splayed', 'leg', 'Leg', legT, La, legT,
          sx * (lx + runMid), frameTop / 2, sz * (lz + runMid),
          { material: sp, explode: { x: sx * 0.4, y: -0.4, z: sz * 0.4 } });
        p.rot = { x: -sz * s, y: 0, z: sx * s };
        p.cutDim = { L: Math.round(La * 10) / 10, W: legT, T: legT };
        p.angleNote = `compound end cut: splay ${s}° both ways — see the angle schedule in the steps`;
        ground(p);
        parts.push(p);
      });
      // Level rails and the footrest box: spans grow toward the floor as the
      // legs run out. Offset of a leg centre at height y: t·(frameTop − y).
      const off = y => t * (frameTop - y);
      const railY = frameTop - railH / 2;
      const mk = (id, name, w, h, d, x, y, z, legA, legB, note) => {
        const p = part(id, id.replace(/_\d+$/, ''), /stretcher/.test(id) ? 'stretcher' : 'rail', name, w, h, d, x, y, z,
          { material: sp, explode: { x: Math.sign(x), y: /stretcher/.test(id) ? -0.5 : 0, z: Math.sign(z) } });
        if (note) p.angleNote = note;
        parts.push(p);
        // Joint positions land at each member end (the setout engine reads them).
        const along = w >= d ? 'x' : 'z';
        const half = (along === 'x' ? w : d) / 2;
        const endA = { x, y, z }, endB = { x, y, z };
        endA[along] = (along === 'x' ? x : z) - half;
        endB[along] = (along === 'x' ? x : z) + half;
        joints.push({ type: fj, a: id, b: legA, pos: endA });
        joints.push({ type: fj, a: id, b: legB, pos: endB });
      };
      const shoulder = `shoulders cut at ${s}° (legs splay) — sliding bevel from the angle schedule`;
      // Seat rails, flush with the legs' outside faces at rail height.
      const oR = off(railY);
      [[-1, 'rail_side_1', 'leg_1', 'leg_3'], [1, 'rail_side_2', 'leg_2', 'leg_4']].forEach(([sx, id, a, b]) => {
        mk(id, 'Side rail', railT, railH, 2 * (lz + oR) - legT, sx * (lx + oR + legT / 2 - railT / 2), railY, 0, a, b, shoulder);
      });
      [[-1, 'rail_back_1', 'leg_1', 'leg_2'], [1, 'rail_front_1', 'leg_3', 'leg_4']].forEach(([sz, id, a, b]) => {
        mk(id, sz < 0 ? 'Back rail' : 'Front rail', 2 * (lx + oR) - legT, railH, railT, 0, railY, sz * (lz + oR + legT / 2 - railT / 2), a, b, shoulder);
      });
      // Footrest: the box stretcher every stool carries (class rule).
      const oS = off(strY);
      [[-1, 'stretcher_side_1', 'leg_1', 'leg_3'], [1, 'stretcher_side_2', 'leg_2', 'leg_4']].forEach(([sx, id, a, b]) => {
        mk(id, 'Side stretcher', secT, secH, 2 * (lz + oS) - legT, sx * (lx + oS), strY, 0, a, b, shoulder);
      });
      [[-1, 'stretcher_back_1', 'leg_1', 'leg_2'], [1, 'stretcher_front_1', 'leg_3', 'leg_4']].forEach(([sz, id, a, b]) => {
        mk(id, sz < 0 ? 'Rear stretcher' : 'Footrest stretcher', 2 * (lx + oS) - legT, secH, secT, 0, strY, sz * (lz + oS), a, b, shoulder);
      });
      addSeatCore(spec, parts, joints, { W, D, Hs, seatT, railH, railT, cb, sp, slope: 0, postIds: [] });
      return { parts, joints, openings: [], drawers: [] };
    }

    /* ---- chair ---- */
    const postD = G.rearPostDepth(st);
    const Hb = se.backHeight;
    const slope = se.slopeDeg, tanS = Math.tan(rad(slope));
    const lx = W / 2 - legT / 2;
    const zPost = -(D / 2 - postD / 2), zFront = D / 2 - legT / 2;
    // Seat top plane: full height at the FRONT edge, sloping down rearward.
    const seatTopAt = z => Hs - tanS * (D / 2 - z);
    const railTopAt = z => seatTopAt(z) - seatT;

    // Rear posts: ONE straight piece, floor to crest. The class refuses sawn
    // bends — rake lives in the slat offsets below.
    [[-1, 1], [1, 2]].forEach(([sx, i]) => {
      parts.push(part(`post_${i}`, 'rear_post', 'post', 'Rear post', legT, Hs + Hb, postD,
        sx * lx, (Hs + Hb) / 2, zPost,
        { material: sp, explode: { x: sx * 0.35, y: 0.2, z: -0.5 } }));
    });
    // Front legs run to the underside of the sloped seat. A box can't carry
    // a beveled end, so the height is taken at the leg's REAR face (the
    // lowest contact with the sloped underside) and the bevel is a cut note
    // — exactly how the leg is really trimmed to meet a sloped seat.
    const flH = railTopAt(zFront - legT / 2);
    [[-1, 3], [1, 4]].forEach(([sx, i]) => {
      const p = part(`leg_${i}`, 'leg', 'leg', 'Front leg', legT, flH, legT,
        sx * lx, flH / 2, zFront,
        { material: sp, explode: { x: sx * 0.35, y: -0.4, z: 0.4 } });
      if (slope > 0) p.angleNote = `top end beveled ${slope}° to meet the sloped seat`;
      parts.push(p);
    });

    // Seat rails. Side rails tilt with the seat slope (their shoulders carry
    // the bevel); front/back rails stay level at their own band heights.
    const sideSpan = D - legT - postD;
    const zSideC = (postD - legT) / 2;
    [[-1, 1, 'post_1', 'leg_3'], [1, 2, 'post_2', 'leg_4']].forEach(([sx, i, postId, legId]) => {
      const p = part(`rail_side_${i}`, 'rail_side', 'rail', 'Side rail', railT, railH, sideSpan,
        sx * (W / 2 - railT / 2), railTopAt(zSideC) - railH / 2, zSideC,
        { material: sp, explode: { x: sx, y: 0, z: 0 } });
      if (slope > 0) {
        p.rot = { x: -slope, y: 0, z: 0 };
        p.cutDim = { L: Math.round(sideSpan / Math.cos(rad(slope)) * 10) / 10, W: railH, T: railT };
      }
      parts.push(p);
      joints.push({ type: fj, a: `rail_side_${i}`, b: postId, pos: { x: sx * lx, y: railTopAt(zPost + postD / 2) - railH / 2, z: zPost + postD / 2 } });
      joints.push({ type: fj, a: `rail_side_${i}`, b: legId, pos: { x: sx * lx, y: railTopAt(zFront) - railH / 2, z: zFront - legT / 2 } });
    });
    // Front rail flush with the front-leg faces; back rail flush with the
    // posts' FRONT faces (its body lives inside the post depth).
    const zF = D / 2 - railT / 2;
    const zBack = -D / 2 + postD - railT / 2;
    parts.push(part('rail_front_1', 'rail_front', 'rail', 'Front rail', W - 2 * legT, railH, railT,
      0, railTopAt(zF) - railH / 2, zF, { material: sp, explode: { x: 0, y: 0, z: 1 } }));
    joints.push({ type: fj, a: 'rail_front_1', b: 'leg_3', pos: { x: -lx, y: railTopAt(zF) - railH / 2, z: zF } });
    joints.push({ type: fj, a: 'rail_front_1', b: 'leg_4', pos: { x: lx, y: railTopAt(zF) - railH / 2, z: zF } });
    parts.push(part('rail_back_1', 'rail_back', 'rail', 'Back seat rail', W - 2 * legT, railH, railT,
      0, railTopAt(zBack) - railH / 2, zBack, { material: sp, explode: { x: 0, y: 0, z: -1 } }));
    joints.push({ type: fj, a: 'rail_back_1', b: 'post_1', pos: { x: -lx, y: railTopAt(zBack) - railH / 2, z: zBack } });
    joints.push({ type: fj, a: 'rail_back_1', b: 'post_2', pos: { x: lx, y: railTopAt(zBack) - railH / 2, z: zBack } });

    // Stretchers: H (side pair + centre) or box (perimeter) at the stretcher line.
    const strStyle = st.stretcher === 'box' ? 'box' : 'h';
    [[-1, 1, 'post_1', 'leg_3'], [1, 2, 'post_2', 'leg_4']].forEach(([sx, i, postId, legId]) => {
      parts.push(part(`stretcher_side_${i}`, 'stretcher_side', 'stretcher', 'Side stretcher', secT, secH, sideSpan,
        sx * (W / 2 - secT / 2), strY, zSideC, { material: sp, explode: { x: sx, y: -0.5, z: 0 } }));
      joints.push({ type: fj, a: `stretcher_side_${i}`, b: postId, pos: { x: sx * lx, y: strY, z: zPost + postD / 2 } });
      joints.push({ type: fj, a: `stretcher_side_${i}`, b: legId, pos: { x: sx * lx, y: strY, z: zFront - legT / 2 } });
    });
    if (strStyle === 'h') {
      parts.push(part('stretcher_centre_1', 'stretcher_centre', 'stretcher', 'Centre stretcher', W - 2 * secT, secH, secT,
        0, strY, zSideC, { material: sp, explode: { x: 0, y: -0.5, z: 0 } }));
      joints.push({ type: fj, a: 'stretcher_centre_1', b: 'stretcher_side_1', pos: { x: -(W / 2 - secT), y: strY, z: zSideC } });
      joints.push({ type: fj, a: 'stretcher_centre_1', b: 'stretcher_side_2', pos: { x: W / 2 - secT, y: strY, z: zSideC } });
    } else {
      parts.push(part('stretcher_front_1', 'stretcher_front', 'stretcher', 'Front stretcher', W - 2 * legT, secH, secT,
        0, strY, zFront, { material: sp, explode: { x: 0, y: -0.5, z: 1 } }));
      joints.push({ type: fj, a: 'stretcher_front_1', b: 'leg_3', pos: { x: -lx, y: strY, z: zFront } });
      joints.push({ type: fj, a: 'stretcher_front_1', b: 'leg_4', pos: { x: lx, y: strY, z: zFront } });
      parts.push(part('stretcher_back_1', 'stretcher_back', 'stretcher', 'Rear stretcher', W - 2 * legT, secH, secT,
        0, strY, zPost, { material: sp, explode: { x: 0, y: -0.5, z: -1 } }));
      joints.push({ type: fj, a: 'stretcher_back_1', b: 'post_1', pos: { x: -lx, y: strY, z: zPost } });
      joints.push({ type: fj, a: 'stretcher_back_1', b: 'post_2', pos: { x: lx, y: strY, z: zPost } });
    }

    /* Back: crest + slats between the posts, raked by opposed z-offsets
     * within the post depth — the honest straight-post rake. Each member
     * centres on the rake line through the post's mid-depth. */
    const crestY = Hs + Hb - G.CREST_H / 2;
    const slatYs = [Hs + G.SLAT_RISE];
    if (Hb >= 420) slatYs.push((slatYs[0] + crestY) / 2);
    const yMid = (crestY + slatYs[0]) / 2;
    const tanR = Math.tan(rad(se.backRake));
    const zOn = y => zPost - tanR * (y - yMid); // rake line (top leans rearward)
    const backLen = W - 2 * legT;
    const crest = part('crest_1', 'crest', 'crest', 'Crest rail', backLen, G.CREST_H, G.SLAT_T,
      0, crestY, Math.round(zOn(crestY) * 10) / 10, { material: sp, explode: { x: 0, y: 0.8, z: -0.6 } });
    if (se.backRake > 0) crest.angleNote = `mortise offset per setout — back rakes ${se.backRake}° via opposed offsets`;
    parts.push(crest);
    joints.push({ type: fj, a: 'crest_1', b: 'post_1', pos: { x: -lx, y: crestY, z: zOn(crestY) } });
    joints.push({ type: fj, a: 'crest_1', b: 'post_2', pos: { x: lx, y: crestY, z: zOn(crestY) } });
    slatYs.forEach((y, i) => {
      parts.push(part(`slat_${i + 1}`, 'back_slat', 'slat', 'Back slat', backLen, G.SLAT_H, G.SLAT_T,
        0, y, Math.round(zOn(y) * 10) / 10, { material: sp, explode: { x: 0, y: 0.3, z: -0.4 } }));
      joints.push({ type: fj, a: `slat_${i + 1}`, b: 'post_1', pos: { x: -lx, y, z: zOn(y) } });
      joints.push({ type: fj, a: `slat_${i + 1}`, b: 'post_2', pos: { x: lx, y, z: zOn(y) } });
    });

    addSeatCore(spec, parts, joints, {
      W, D, Hs, seatT, railH, railT, cb, sp, slope,
      postIds: ['post_1', 'post_2']
    });
    return { parts, joints, openings: [], drawers: [] };
  }

  /* Seat panel + corner blocks, shared by chair and stool. Corner blocks are
   * STRUCTURE (they close the seat-frame racking loop) and ship as parts with
   * their own dimensions; at the corners they bear on the leg/post too, so
   * they are jointed to it as well — glued and screwed to everything they
   * touch, exactly as fitted in the shop. */
  function addSeatCore(spec, parts, joints, ctx) {
    const { W, D, Hs, seatT, railH, railT, cb, sp, slope } = ctx;
    const rad = d => d * Math.PI / 180;
    const tanS = Math.tan(rad(slope || 0));
    const seatTopAt = z => Hs - tanS * (D / 2 - z);
    const stool = !ctx.postIds || !ctx.postIds.length;

    // Corner blocks: touching both rails' inner faces at each corner.
    const bx = W / 2 - railT - cb / 2, bz = D / 2 - railT - cb / 2;
    const bh = Math.max(30, railH - 12);
    const corners = [
      { sx: -1, sz: 1, mates: stool ? ['leg_3'] : ['leg_3'], rails: ['rail_side_1', 'rail_front_1'] },
      { sx: 1, sz: 1, mates: stool ? ['leg_4'] : ['leg_4'], rails: ['rail_side_2', 'rail_front_1'] },
      { sx: -1, sz: -1, mates: stool ? ['leg_1'] : ['post_1'], rails: ['rail_side_1', 'rail_back_1'] },
      { sx: 1, sz: -1, mates: stool ? ['leg_2'] : ['post_2'], rails: ['rail_side_2', 'rail_back_1'] }
    ];
    corners.forEach((c, i) => {
      const z = c.sz * bz;
      const y = seatTopAt(z) - seatT - 4 - bh / 2;
      const id = `block_${i + 1}`;
      const p = part(id, 'corner_block', 'corner_block', 'Corner block', cb, bh, cb,
        c.sx * bx, Math.round(y * 10) / 10, z, { material: sp, explode: { x: c.sx * 0.2, y: -0.3, z: c.sz * 0.2 } });
      p.angleNote = 'rip the blank at 45° across the corner — grain runs across the diagonal';
      parts.push(p);
      for (const m of [...c.rails, ...c.mates]) {
        joints.push({ type: 'butt_screws', a: id, b: m, pos: { x: c.sx * bx, y, z }, noCutAllowance: true });
      }
    });

    // Seat panel: full plan, notched around the rear posts (capture included
    // in the panel size — no cut allowance), fastened so it can MOVE.
    const seat = part('seat_1', 'seat_panel', 'seat', 'Seat', W, seatT, D,
      0, Math.round((seatTopAt(0) - seatT / 2) * 10) / 10, 0,
      { material: sp, explode: { x: 0, y: 1, z: 0 } });
    if (slope > 0) {
      seat.rot = { x: -slope, y: 0, z: 0 };
      seat.cutDim = { L: W, W: D, T: seatT };
    }
    parts.push(seat);
    joints.push({ type: 'butt_screws', a: 'seat_1', b: 'rail_side_1', pos: { x: -(W / 2 - railT / 2), y: seatTopAt(0) - seatT, z: 0 }, noCutAllowance: true });
    joints.push({ type: 'butt_screws', a: 'seat_1', b: 'rail_side_2', pos: { x: W / 2 - railT / 2, y: seatTopAt(0) - seatT, z: 0 }, noCutAllowance: true });
    for (const pid of ctx.postIds || []) {
      joints.push({ type: 'butt_screws', a: 'seat_1', b: pid, pos: { x: (pid === 'post_1' ? -1 : 1) * (W / 2 - 20), y: seatTopAt(-D / 2 + 20) - seatT / 2, z: -D / 2 + 20 }, noCutAllowance: true });
    }
  }

  /* ---------------- custom (novel) compositions ----------------
   * The AI composes primitives + a connection graph; correction has already
   * grounded, centered, and canonicalized them. This builder is a straight
   * projection into model parts — positions and sizes pass through untouched.
   */
  function customBuild(spec) {
    const parts = [], joints = [];
    const c = spec.custom || { parts: [], connections: [] };
    const sp = spec.wood.species;
    for (const p of c.parts) {
      const size = BB.Spec.customPartSize(p);
      const dirX = p.pos.x >= 0 ? 1 : -1, dirZ = p.pos.z >= 0 ? 1 : -1;
      const explode = p.primitive === 'slab' ? { x: 0, y: 1, z: 0 }
        : (p.primitive === 'post' || p.primitive === 'cylinder') ? { x: dirX * 0.5, y: -0.4, z: dirZ * 0.5 }
        : { x: dirX * 0.6, y: 0.25, z: dirZ * 0.6 };
      parts.push(Object.assign(
        part(p.id, `custom_${p.primitive}_${p.dim.l}x${p.dim.w}x${p.dim.t}`, p.role,
          p.role.replace(/_/g, ' ').replace(/^./, ch => ch.toUpperCase()),
          size.w, size.h, size.d, p.pos.x, p.pos.y, p.pos.z,
          { material: p.stock === 'sheet' ? (spec.wood.sheetSpecies || 'baltic_birch') : sp, explode }),
        {
          prim: p.primitive, rot: p.rot ? { ...p.rot } : null,
          cutDim: { L: p.dim.l, W: p.dim.w, T: p.dim.t },
          grain: p.grain, surface: p.surface, loadBearing: p.loadBearing
        }
      ));
    }
    const byId = new Map(parts.map(p => [p.id, p]));
    for (const cn of c.connections) {
      const a = byId.get(cn.a), b = byId.get(cn.b);
      if (!a || !b) continue;
      joints.push({
        type: cn.joint, a: cn.a, b: cn.b,
        pos: { x: (a.pos.x + b.pos.x) / 2, y: (a.pos.y + b.pos.y) / 2, z: (a.pos.z + b.pos.z) / 2 }
      });
    }
    return { parts, joints, openings: [], drawers: [] };
  }

  /* ---------------- entry point ---------------- */
  function build(spec) {
    const t = spec.meta.template;
    let m;
    if (t === 'bookshelf') m = bookshelf(spec);
    else if (t === 'nightstand') m = nightstand(spec);
    else if (t === 'cabinet') m = cabinet(spec);
    else if (t === 'custom') m = customBuild(spec);
    else if (t === 'chair') m = chairBuild(spec);
    else m = tableLike(spec);
    m.bounds = { w: spec.overall.width, d: spec.overall.depth, h: spec.overall.height };
    // Round sizes/positions to 0.1 mm so exports and cut lists are stable.
    for (const p of m.parts) {
      for (const k of ['w', 'h', 'd']) p.size[k] = Math.round(p.size[k] * 10) / 10;
      for (const k of ['x', 'y', 'z']) p.pos[k] = Math.round(p.pos[k] * 10) / 10;
    }
    return m;
  }

  BB.Parametric = { build, openingHeightFor, shelfSpacingFor, RAIL_H, RAIL_T, DEFAULT_OPENING_H, bankHeights, stretcherSection };
})();
