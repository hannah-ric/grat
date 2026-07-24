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

  /* ---------------- cabinet doors (LIVE) ----------------
   * Doors cover the open carcass face below any drawer bank (or the full
   * body when there are no drawers). Style intent (count, overlay/inset,
   * hinge key, pull key) comes from the corrected spec; every rating,
   * count, bore, and position is computed here / in BB.HW.
   */
  function buildDoors(spec, zone, parts) {
    const doors = [];
    if (!spec.doors || !spec.doors.count) return doors;
    const count = Math.min(2, Math.max(1, Math.round(spec.doors.count)));
    const inset = spec.doors.frontStyle !== 'overlay';
    const frontT = 19;
    const sp = spec.wood.species;
    const gap = 2;
    const openW = zone.clearW;
    const openH = zone.yTop - zone.yBottom;
    if (openH < 120 || openW < 150) return doors;
    const hingeKey = (BB.HW && spec.hardware && BB.HW.HINGES[spec.hardware.hinge])
      ? spec.hardware.hinge
      : (inset ? 'butt_brass' : 'euro_cup');
    const hingeCat = BB.HW ? BB.HW.hingePick(hingeKey, inset ? 'inset' : 'overlay') : null;
    const pullStyle = (BB.HW && spec.hardware && BB.HW.PULLS[spec.hardware.pull])
      ? spec.hardware.pull
      : 'knob_round';

    for (let i = 0; i < count; i++) {
      let fw, fh, px;
      if (count === 1) {
        fw = inset ? openW - 2 * gap : Math.min(zone.overlayMaxW || openW + 20, openW + 20);
        px = zone.x || 0;
      } else {
        const half = openW / 2;
        fw = inset ? half - 1.5 * gap : half + Math.min(10, ((zone.overlayMaxW || openW + 20) - openW) / 2);
        px = (zone.x || 0) + (i === 0 ? -half / 2 : half / 2);
      }
      fh = inset ? openH - 2 * gap : openH + Math.min(20, 16);
      const frontZ = inset ? zone.zFront - frontT / 2 : zone.zFront + frontT / 2;
      const cy = zone.yBottom + openH / 2;
      const id = `door_${i + 1}`;
      const hingeSide = count === 1 ? 'left' : (i === 0 ? 'left' : 'right');
      parts.push(part(id, `door_${Math.round(fw)}x${Math.round(fh)}`, 'door', count === 1 ? 'Door' : `Door ${i + 1}`,
        fw, fh, frontT, px, cy, frontZ,
        { material: sp, group: 'door', explode: { x: hingeSide === 'left' ? -0.8 : 0.8, y: 0, z: 0.6 } }));

      const doorKg = BB.HW ? BB.HW.panelWeightKg(fw, fh, frontT, sp) : 5;
      const hCount = BB.HW ? BB.HW.doorHingeCount(fh, doorKg) : 2;
      const hingeIds = [];
      for (let hi = 0; hi < hCount; hi++) {
        const hy = cy - fh / 2 + 80 + (hCount === 1 ? fh / 2 - 80 : (fh - 160) * hi / Math.max(1, hCount - 1));
        const hx = hingeSide === 'left' ? px - fw / 2 + 15 : px + fw / 2 - 15;
        const hid = `door_${i + 1}_hinge_${hi + 1}`;
        parts.push(part(hid, 'hinge', 'hinge', `Door ${i + 1} hinge`,
          35, 12, 20, hx, hy, frontZ - frontT / 2 - 10,
          { material: 'hardware', hardware: true, group: 'frame' }));
        hingeIds.push(hid);
      }

      let boringNote = '';
      let tbMM = 5, cupDia = 35, cupDepth = 13;
      if (hingeCat && hingeCat.key === 'euro_cup') {
        const overlayMM = inset ? 0 : Math.max(0, (fw - (count === 1 ? openW : openW / 2)) / 2);
        const bore = BB.HW.cupBoring(overlayMM, 0);
        tbMM = bore.tbMM; cupDia = bore.cupDia; cupDepth = bore.cupDepth;
        boringNote = `${hCount} × 35 mm cups, boring distance ${tbMM} mm, plate setback ${bore.plateSetback} mm`;
      } else if (hingeCat) {
        boringNote = `${hCount} × ${hingeCat.label.toLowerCase()}`;
      }

      const pSpec = BB.HW ? BB.HW.pullSpec(fw, pullStyle) : { style: 'knob_round', count: 1, ctcMM: 0, holes: 1 };
      const pullIds = [];
      if (pSpec.style !== 'none_touch') {
        const isKnob = /knob|ring/.test(pSpec.style);
        const pw = isKnob ? 35 : Math.max(60, Math.min(fw - 40, (pSpec.ctcMM || 96) + 14));
        const ph = isKnob ? 35 : 12;
        const pd = 22;
        const pullX = hingeSide === 'left' ? px + fw / 2 - 40 : px - fw / 2 + 40;
        const pullY = cy;
        for (let pi = 0; pi < pSpec.count; pi++) {
          const pid = `door_${i + 1}_pull${pSpec.count > 1 ? '_' + (pi + 1) : ''}`;
          parts.push(part(pid, 'pull', 'pull', `Door ${i + 1} pull`,
            pw, ph, pd, pullX, pullY, frontZ + frontT / 2 + pd / 2,
            { material: 'hardware', group: 'door' }));
          pullIds.push(pid);
        }
      }

      doors.push({
        index: i, partId: id, hingeSide, t: frontT,
        w: fw, h: fh,
        hinge: {
          key: hingeCat ? hingeCat.key : hingeKey,
          label: hingeCat ? hingeCat.label : 'Door hinge',
          count: hCount, boringNote, tbMM, cupDia, cupDepth
        },
        hingeIds, pull: Object.assign({ styleKey: pullStyle }, pSpec), pullIds
      });
    }
    return doors;
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

    // Lower stretchers (Tier 1 LIVE): a pair of long rails between the legs
    // at ~40% of leg height — code-owned thickness/height; AI only flips the
    // structure.stretchers intent. Credits racking and shortens unbraced length.
    if (st.stretchers) {
      const strH = Math.min(70, Math.max(50, Math.round(st.apronHeight * 0.7)));
      const strT = st.apronThickness;
      const strY = Math.max(strH / 2 + 20, Math.round(legH * 0.38));
      const strLen = frameW - 2 * legT;
      const strZ = frameD / 2 - strT / 2;
      [[-strZ, 1], [strZ, 2]].forEach(([z, i]) => {
        parts.push(part(`stretcher_long_${i}`, 'stretcher_long', 'stretcher', 'Stretcher',
          strLen, strH, strT, 0, strY, z,
          { material: sp, explode: { x: 0, y: -0.3, z: Math.sign(z) * 0.6 } }));
        joints.push({ type: fj, a: `stretcher_long_${i}`, b: z < 0 ? 'leg_1' : 'leg_3', pos: { x: -lx, y: strY, z } });
        joints.push({ type: fj, a: `stretcher_long_${i}`, b: z < 0 ? 'leg_2' : 'leg_4', pos: { x: lx, y: strY, z } });
      });
    }

    return { parts, joints, openings: [], drawers: [], doors: [] };
  }

  function bookshelf(spec) {
    const o = spec.overall, st = spec.structure;
    const parts = [], joints = [];
    const sideT = st.sideThickness, shT = st.shelfThickness;
    const innerW = o.width - 2 * sideT;
    const sp = spec.wood.species;

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
      parts.push(part(`shelf_${i}`, 'shelf', 'shelf', 'Shelf', innerW, shT, o.depth - 20, 0, y, 10, { material: sp, explode: { x: 0, y: 0, z: 0.8 } }));
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
    return { parts, joints, openings: [], drawers: [], doors: [] };
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
    return { parts, joints, openings: bankOut.openings, drawers: bankOut.drawers, doors: [] };
  }

  function cabinet(spec) {
    const o = spec.overall, st = spec.structure;
    const parts = [], joints = [];
    const sideT = st.sideThickness, topT = st.topThickness;
    const base = st.toeKick ? 90 : 0;
    const sp = spec.wood.species;
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
      yTop: o.height - topT, zFront: o.depth / 2,
      interiorDepth: o.depth - 10, available,
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
      parts.push(part(`shelf_${i}`, 'shelf', 'shelf', 'Shelf', innerW, st.shelfThickness, o.depth - 30, 0, y, 5,
        { material: sp, explode: { x: 0, y: 0, z: 0.8 } }));
      joints.push({ type: spec.joinery.case, a: `shelf_${i}`, b: 'side_1', pos: { x: -innerW / 2, y, z: 0 } });
      joints.push({ type: spec.joinery.case, a: `shelf_${i}`, b: 'side_2', pos: { x: innerW / 2, y, z: 0 } });
    }

    // Doors on the open face below the drawer bank (or the full body when
    // there are no drawers). Intent: spec.doors; numbers: buildDoors + HW.
    const doorZone = {
      clearW: innerW, x: 0,
      yBottom: shelfZoneBottom, yTop: shelfZoneTop,
      zFront: o.depth / 2,
      overlayMaxW: innerW + Math.min(20, sideT)
    };
    // When there is no drawer bank, doors get the full carcass opening.
    if (!spec.drawers) {
      doorZone.yBottom = base + 19;
      doorZone.yTop = o.height - topT;
    }
    const doors = buildDoors(spec, doorZone, parts);
    return { parts, joints, openings: bankOut.openings, drawers: bankOut.drawers, doors };
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
    return { parts, joints, openings: [], drawers: [], doors: [] };
  }

  /* ---------------- entry point ---------------- */
  function build(spec) {
    const t = spec.meta.template;
    let m;
    if (t === 'bookshelf') m = bookshelf(spec);
    else if (t === 'nightstand') m = nightstand(spec);
    else if (t === 'cabinet') m = cabinet(spec);
    else if (t === 'custom') m = customBuild(spec);
    else m = tableLike(spec);
    m.bounds = { w: spec.overall.width, d: spec.overall.depth, h: spec.overall.height };
    m.doors = m.doors || [];
    // Round sizes/positions to 0.1 mm so exports and cut lists are stable.
    for (const p of m.parts) {
      for (const k of ['w', 'h', 'd']) p.size[k] = Math.round(p.size[k] * 10) / 10;
      for (const k of ['x', 'y', 'z']) p.pos[k] = Math.round(p.pos[k] * 10) / 10;
    }
    return m;
  }

  BB.Parametric = { build, openingHeightFor, shelfSpacingFor, RAIL_H, RAIL_T, DEFAULT_OPENING_H, bankHeights };
})();
