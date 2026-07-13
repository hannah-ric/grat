/* Blueprint Buddy — stock layout & cut optimization (Phase 4).
 * The cut list says what to cut; this module says what to BUY and how to
 * break it down. All deterministic, all code-owned:
 *   1D: first-fit-decreasing of required lengths onto stock boards of the
 *       matching nominal section — 3 mm kerf per cut, 15 mm end trim per end.
 *   2D: guillotine first-fit-decreasing onto 1220×2440 sheets, honoring grain
 *       (grain-constrained parts align with the sheet's long axis).
 * Output: boards/sheets to buy, per-board cutting diagrams (SVG), priced from
 * the user-editable price table, with reported waste percentage.
 */
var BB = globalThis.BB = globalThis.BB || {};

(function () {
  'use strict';
  const K = BB.K;
  const L = () => K.LUMBER;
  const U = () => BB.Units; // display boundary — packing math itself stays mm

  const r1 = v => Math.round(v * 10) / 10;

  /* ---------------- section selection ----------------
   * Map a required cut section (T × W) onto a buyable nominal. Three shapes:
   *   direct   — a nominal covers T and W outright (rip to width).
   *   glue-up  — wider than any board: edge-glue N strips (3 mm jointed off
   *              each glued edge), then cut to final width.
   *   laminate — thicker than any board: face-laminate N layers, plane to T.
   */
  function sectionFor(T, W) {
    const noms = Object.entries(L().NOMINALS);
    let best = null;
    for (const [name, a] of noms) {
      if (a.t >= T - 0.5 && a.w >= W - 0.5) {
        const waste = a.t * a.w - T * W;
        if (!best || waste < best.waste) best = { kind: 'direct', nominal: name, actual: a, waste, pieces: 1 };
      }
    }
    if (best) return best;
    // glue-up: thickness fits some nominal, width doesn't
    let glue = null;
    for (const [name, a] of noms) {
      if (a.t >= T - 0.5) {
        const stripW = a.w - 6; // 3 mm jointed off each glued edge
        const n = Math.ceil(W / stripW);
        const waste = n * a.t * a.w - T * W;
        if (!glue || waste < glue.waste) glue = { kind: 'glueup', nominal: name, actual: a, waste, pieces: n };
      }
    }
    if (glue) return glue;
    // laminate: nothing is thick enough — stack layers and plane to T
    let lam = null;
    for (const [name, a] of noms) {
      if (a.w >= W - 0.5) {
        const n = Math.ceil(T / a.t);
        const waste = n * a.t * a.w - T * W;
        if (!lam || waste < lam.waste) lam = { kind: 'laminate', nominal: name, actual: a, waste, pieces: n };
      }
    }
    if (lam) return lam;
    // both too wide and too thick: laminate the widest, glue-up noted
    const widest = noms.reduce((m, x) => (x[1].w > m[1].w ? x : m));
    return { kind: 'laminate', nominal: widest[0], actual: widest[1], waste: 0, pieces: Math.ceil(T / widest[1].t) * Math.ceil(W / (widest[1].w - 6)) };
  }

  /* ---------------- 1D packing: first-fit-decreasing ---------------- */
  function pack1D(pieces) {
    // pieces: [{name, len, nominal, actual, note}] — one entry per stick to cut
    const kerf = L().KERF, trim = L().END_TRIM;
    const byNominal = new Map();
    for (const p of pieces) {
      if (!byNominal.has(p.nominal)) byNominal.set(p.nominal, []);
      byNominal.get(p.nominal).push(p);
    }
    const boards = [];
    for (const [nominal, list] of [...byNominal.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
      list.sort((a, b) => b.len - a.len); // decreasing
      const open = [];
      for (const p of list) {
        let placed = false;
        for (const b of open) { // first fit
          const need = (b.cuts.length ? kerf : 0) + p.len;
          if (b.remaining >= need) {
            b.cuts.push({ name: p.name, len: p.len, offset: b.used + (b.cuts.length ? kerf : 0), note: p.note });
            b.used += need;
            b.remaining -= need;
            placed = true;
            break;
          }
        }
        if (!placed) {
          // Open the LONGEST stock length and shrink to the shortest that
          // still fits once packing is done — price is per metre, so fewer,
          // fuller boards never cost more.
          const lengths = L().STOCK_LENGTHS;
          const stockLen = lengths[lengths.length - 1] - 2 * trim >= p.len ? lengths[lengths.length - 1] : null;
          if (!stockLen) { boards.push({ nominal, actual: list[0].actual, stockLen: null, cuts: [], error: `“${p.name}” (${U().fmtLength(p.len)}) exceeds the longest stock board.` }); continue; }
          const b = { nominal, actual: list[0].actual, stockLen, used: 0, remaining: stockLen - 2 * trim, cuts: [] };
          b.cuts.push({ name: p.name, len: p.len, offset: 0, note: p.note });
          b.used = p.len;
          b.remaining -= p.len;
          open.push(b);
          boards.push(b);
        }
      }
      // Shrink each board to the shortest stock length that still holds it.
      for (const b of open) {
        const needed = b.used + 2 * trim;
        const shorter = L().STOCK_LENGTHS.find(s => s >= needed);
        if (shorter && shorter < b.stockLen) { b.remaining += b.stockLen - shorter; b.stockLen = shorter; }
        // Recompute cut offsets to include the leading end trim.
        let cursor = trim;
        for (const c of b.cuts) { c.offset = cursor; cursor += c.len + kerf; }
        b.offcut = r1(b.stockLen - trim - b.used - (b.cuts.length - 1) * kerf - trim);
      }
    }
    return boards;
  }

  /* ---------------- 2D packing: guillotine first-fit-decreasing ---------------- */
  function pack2D(parts, sheetT) {
    // parts: [{name, w (along grain / sheet length), h (across), grainLocked}]
    const kerf = L().KERF;
    const SW = L().SHEET.L, SH = L().SHEET.W; // x along the 2440 axis (grain), y across 1220
    const sheets = [];
    const sorted = [...parts].sort((a, b) => Math.max(b.w, b.h) - Math.max(a.w, a.h));
    const fits = (rect, w, h) => rect.w >= w && rect.h >= h;

    function placeInSheet(sheet, p) {
      const pw = p.w + kerf, ph = p.h + kerf;
      for (let i = 0; i < sheet.free.length; i++) {
        const rect = sheet.free[i];
        let w = pw, h = ph, rot = false;
        if (!fits(rect, w, h)) {
          if (p.grainLocked || !fits(rect, ph, pw)) continue;
          w = ph; h = pw; rot = true;
        }
        sheet.placements.push({ name: p.name, x: rect.x, y: rect.y, w: w - kerf, h: h - kerf, rot });
        sheet.free.splice(i, 1);
        // guillotine split: give the larger leftover the full run
        const rightW = rect.w - w, topH = rect.h - h;
        if (rightW > topH) {
          if (rightW > 0) sheet.free.push({ x: rect.x + w, y: rect.y, w: rightW, h: rect.h });
          if (topH > 0) sheet.free.push({ x: rect.x, y: rect.y + h, w: w, h: topH });
        } else {
          if (topH > 0) sheet.free.push({ x: rect.x, y: rect.y + h, w: rect.w, h: topH });
          if (rightW > 0) sheet.free.push({ x: rect.x + w, y: rect.y, w: rightW, h: h });
        }
        return true;
      }
      return false;
    }

    const errors = [];
    for (const p of sorted) {
      if (p.w > SW || (p.h > SH && (p.grainLocked || p.h > SW || p.w > SH))) {
        errors.push(`“${p.name}” (${U().fmtLength(p.w)} × ${U().fmtLength(p.h)}) exceeds a full sheet.`);
        continue;
      }
      let placed = false;
      for (const s of sheets) if (placeInSheet(s, p)) { placed = true; break; }
      if (!placed) {
        const s = { thickness: sheetT, w: SW, h: SH, placements: [], free: [{ x: 0, y: 0, w: SW, h: SH }] };
        sheets.push(s);
        if (!placeInSheet(s, p)) errors.push(`“${p.name}” could not be placed.`);
      }
    }
    // Purchasable fraction: smallest quarter/half/full region the layout fits.
    for (const s of sheets) {
      let maxX = 0, maxY = 0;
      for (const p of s.placements) { maxX = Math.max(maxX, p.x + p.w); maxY = Math.max(maxY, p.y + p.h); }
      s.extent = { x: r1(maxX), y: r1(maxY) };
      if (maxX <= 1220 && maxY <= 610) s.fraction = 0.25;
      else if (maxX <= 1220 && maxY <= 1220) s.fraction = 0.5;
      else s.fraction = 1;
      s.fractionLabel = s.fraction === 1 ? 'full sheet' : s.fraction === 0.5 ? 'half sheet' : 'quarter sheet';
    }
    return { sheets, errors };
  }

  /* ---------------- the full stock plan ---------------- */
  function planStock(spec, model, cut, opts) {
    opts = opts || {};
    const prices = opts.prices || K.defaultPrices();
    const species = spec.wood.species;
    const rough = opts.stockMode && opts.stockMode[species] === 'rough';

    // Expand cut rows into individual sticks / sheet parts.
    const solidPieces = [], sheetParts = [];
    const glueups = [], laminations = [];
    let solidVol = 0, sheetAreaByT = new Map();
    for (const row of cut) {
      for (let i = 0; i < row.qty; i++) {
        if (row.stock === 'sheet' || row.material === 'baltic_birch') {
          const t = K.SHEET_THICKNESS.reduce((x, y) => Math.abs(y - row.T) < Math.abs(x - row.T) ? y : x);
          // grain runs along the cut length; length-grain parts lock to the sheet's long axis
          sheetParts.push({ name: row.name, w: row.L, h: row.W, t, grainLocked: row.grain !== 'width' });
          sheetAreaByT.set(t, (sheetAreaByT.get(t) || 0) + row.L * row.W);
        } else {
          solidVol += row.L * row.W * row.T;
          if (!rough) {
            const sec = sectionFor(row.T, row.W);
            if (sec.kind === 'direct') {
              solidPieces.push({ name: row.name, len: row.L, nominal: sec.nominal, actual: sec.actual, note: sec.actual.w - row.W > 3 ? `rip to ${U().fmtLength(row.W)}` : '' });
            } else if (sec.kind === 'glueup') {
              glueups.push({ name: row.name, n: sec.pieces, nominal: sec.nominal, W: row.W, T: row.T });
              for (let s2 = 0; s2 < sec.pieces; s2++) solidPieces.push({ name: `${row.name} (strip ${s2 + 1}/${sec.pieces})`, len: row.L, nominal: sec.nominal, actual: sec.actual, note: 'glue-up strip' });
            } else {
              laminations.push({ name: row.name, n: sec.pieces, nominal: sec.nominal, T: row.T });
              for (let s2 = 0; s2 < sec.pieces; s2++) solidPieces.push({ name: `${row.name} (layer ${s2 + 1}/${sec.pieces})`, len: row.L, nominal: sec.nominal, actual: sec.actual, note: `laminate + plane to ${U().fmtLength(row.T)}` });
            }
          }
        }
      }
    }

    const boards = rough ? [] : pack1D(solidPieces);
    const sheetPlans = [];
    const sheetErrors = [];
    for (const t of [...new Set(sheetParts.map(p => p.t))].sort((a, b) => b - a)) {
      const res = pack2D(sheetParts.filter(p => p.t === t), t);
      sheetPlans.push(...res.sheets);
      sheetErrors.push(...res.errors);
    }

    // ---- pricing: actual purchasable units ----
    const spPrices = (prices.dimensional && prices.dimensional[species]) || {};
    let lumberCost = 0, boardVol = 0;
    const shopping = [];
    if (!rough) {
      const groups = new Map(); // nominal|stockLen -> count
      for (const b of boards) {
        if (!b.stockLen) continue;
        const key = b.nominal + '|' + b.stockLen;
        groups.set(key, (groups.get(key) || 0) + 1);
        boardVol += b.stockLen * b.actual.t * b.actual.w;
      }
      for (const [key, count] of [...groups.entries()].sort()) {
        const [nominal, len] = key.split('|');
        const perM = spPrices[nominal] !== undefined ? spPrices[nominal] : 5;
        const cost = count * perM * (+len / 1000);
        lumberCost += cost;
        shopping.push({ kind: 'board', label: `${K.WOOD_SPECIES[species].label} ${U().fmtNominal(nominal, L().NOMINALS[nominal], +len)}`, qty: count, unit: `$${(perM * (+len / 1000)).toFixed(2)}`, cost });
      }
    }

    // Rough / board-foot math — the primary line in rough mode, a secondary
    // reference line otherwise.
    const BF_MM3 = 2359737;
    const bdftExact = solidVol / BF_MM3;
    const bdftRate = (prices.bdft && prices.bdft[species]) !== undefined ? prices.bdft[species] : (K.WOOD_SPECIES[species].pricePerBdFt || 5);
    const bdftWithWaste = Math.ceil(bdftExact * 1.3 * 10) / 10;
    const bdftCost = bdftWithWaste * bdftRate;
    if (rough && solidVol > 0) {
      lumberCost = bdftCost;
      shopping.push({ kind: 'board', label: `${K.WOOD_SPECIES[species].label} rough stock — ${U().fmtBoardFeet(bdftWithWaste)} (incl. 30% waste)`, qty: 1, unit: `$${bdftRate.toFixed(2)}/bd ft`, cost: bdftCost });
    }

    let sheetCost = 0, sheetBoughtArea = 0, sheetUsedArea = 0;
    const sheetGroups = new Map();
    for (const s of sheetPlans) {
      const key = s.thickness + '|' + s.fraction;
      sheetGroups.set(key, (sheetGroups.get(key) || 0) + 1);
      sheetBoughtArea += s.fraction * L().SHEET.W * L().SHEET.L;
      for (const p of s.placements) sheetUsedArea += p.w * p.h;
    }
    for (const [key, count] of [...sheetGroups.entries()].sort((a, b) => b[0].localeCompare(a[0]))) {
      const [t, frac] = key.split('|').map(Number);
      const price = ((prices.sheet && prices.sheet[t]) !== undefined ? prices.sheet[t] : 60) * frac;
      const label = `Baltic birch ${U().fmtLength(t)} — ${frac === 1 ? 'full' : frac === 0.5 ? 'half' : 'quarter'} sheet (${U().fmtSheet(L().SHEET.W, L().SHEET.L)} base)`;
      sheetCost += count * price;
      shopping.push({ kind: 'sheet', label, qty: count, unit: `$${price.toFixed(2)}`, cost: count * price });
    }

    const usedVol = solidVol;
    const wasteSolid = !rough && boardVol > 0 ? 1 - usedVol / boardVol : null;
    const wasteSheet = sheetBoughtArea > 0 ? 1 - sheetUsedArea / sheetBoughtArea : null;
    const bought = (rough ? bdftWithWaste * BF_MM3 : boardVol) + sheetBoughtArea * 18; // sheets ~normalized; report separately instead
    void bought;

    return {
      mode: rough ? 'rough' : 'dimensional',
      boards, sheets: sheetPlans, glueups, laminations, shopping,
      errors: [...boards.filter(b => b.error).map(b => b.error), ...sheetErrors],
      lumberCost: Math.round(lumberCost * 100) / 100,
      sheetCost: Math.round(sheetCost * 100) / 100,
      totalCost: Math.round((lumberCost + sheetCost) * 100) / 100,
      wasteSolidPct: wasteSolid == null ? null : Math.round(wasteSolid * 100),
      wasteSheetPct: wasteSheet == null ? null : Math.round(wasteSheet * 100),
      bdft: { exact: Math.round(bdftExact * 10) / 10, withWaste: bdftWithWaste, rate: bdftRate, cost: Math.round(bdftCost * 100) / 100 }
    };
  }

  /* ---------------- SVG cutting diagrams (drafting-styled) ---------------- */
  const escXML = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  let hatchSeq = 0;

  function hatchDef(id) {
    return `<defs><pattern id="${id}" width="7" height="7" patternTransform="rotate(45)" patternUnits="userSpaceOnUse">` +
      `<line x1="0" y1="0" x2="0" y2="7" stroke="var(--muted)" stroke-width="1" opacity="0.55"/></pattern></defs>`;
  }

  function boardSVG(board, fmt) {
    fmt = fmt || (v => U().fmtLength(v));
    const W = 720, H = 64, pad = 4;
    const id = 'bbhatch' + (++hatchSeq);
    const sx = (W - 2 * pad) / board.stockLen;
    const trim = L().END_TRIM, kerf = L().KERF;
    let x = pad;
    const rects = [];
    const seg = (w, cls, label, title) => {
      const px = x;
      x += w;
      return { px, w, cls, label, title };
    };
    rects.push(seg(trim * sx, 'trim', '', `end trim ${U().fmtLength(trim)}`));
    board.cuts.forEach((c, i) => {
      if (i > 0) rects.push(seg(kerf * sx, 'kerf', '', `kerf ${U().fmtSmall(kerf)}`));
      rects.push(seg(c.len * sx, 'cut', `${c.name} · ${fmt(c.len)}`, `${c.name} — ${fmt(c.len)}${c.note ? ' · ' + c.note : ''}`));
    });
    const offX = x;
    const parts = rects.map(r => {
      const fill = r.cls === 'cut' ? 'var(--accent-soft)' : r.cls === 'kerf' ? 'var(--line-2)' : 'var(--panel-2)';
      const stroke = r.cls === 'cut' ? 'var(--accent)' : 'var(--line-2)';
      let out = `<rect x="${r.px.toFixed(1)}" y="${pad}" width="${Math.max(0.8, r.w).toFixed(1)}" height="${H - 2 * pad}" fill="${fill}" stroke="${stroke}" stroke-width="1"><title>${escXML(r.title || '')}</title></rect>`;
      if (r.label && r.w > 60) out += `<text x="${(r.px + r.w / 2).toFixed(1)}" y="${H / 2 + 4}" text-anchor="middle" font-size="11" fill="var(--ink)" font-family="var(--mono)">${escXML(r.label)}</text>`;
      else if (r.label) out += `<text x="${(r.px + r.w / 2).toFixed(1)}" y="${H / 2 + 4}" text-anchor="middle" font-size="9" fill="var(--ink-2)" font-family="var(--mono)" transform="rotate(-30 ${(r.px + r.w / 2).toFixed(1)} ${H / 2})">${escXML(r.label.split(' · ')[0].slice(0, 14))}</text>`;
      return out;
    }).join('');
    const offW = W - pad - offX;
    const offcut = offW > 1 ? `<rect x="${offX.toFixed(1)}" y="${pad}" width="${offW.toFixed(1)}" height="${H - 2 * pad}" fill="url(#${id})" stroke="var(--line-2)" stroke-width="1"><title>offcut ${fmt(board.offcut)}</title></rect>` +
      (offW > 46 ? `<text x="${(offX + offW / 2).toFixed(1)}" y="${H / 2 + 4}" text-anchor="middle" font-size="10" fill="var(--muted)" font-family="var(--mono)">${escXML(fmt(board.offcut))}</text>` : '') : '';
    return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Cutting diagram for one ${board.nominal} board" style="width:100%;height:auto;display:block">` +
      hatchDef(id) +
      `<rect x="${pad}" y="${pad}" width="${W - 2 * pad}" height="${H - 2 * pad}" fill="var(--panel)" stroke="var(--ink-2)" stroke-width="1.5"/>` +
      parts + offcut +
      `</svg>`;
  }

  function sheetSVG(sheet, fmt) {
    fmt = fmt || (v => U().fmtLength(v));
    const SW = L().SHEET.L, SH = L().SHEET.W;
    const W = 720, H = Math.round(W * SH / SW), pad = 3;
    const id = 'bbhatch' + (++hatchSeq);
    const sx = (W - 2 * pad) / SW, sy = (H - 2 * pad) / SH;
    const rects = sheet.placements.map(p => {
      const x = pad + p.x * sx, y = pad + p.y * sy, w = p.w * sx, h = p.h * sy;
      const label = `${p.name}`;
      const dims = `${fmt(p.w)} × ${fmt(p.h)}`;
      return `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" fill="var(--accent-soft)" stroke="var(--accent)" stroke-width="1"><title>${escXML(p.name)} — ${escXML(dims)}${p.rot ? ' (rotated)' : ''}</title></rect>` +
        (w > 54 && h > 26 ? `<text x="${(x + w / 2).toFixed(1)}" y="${(y + h / 2 - 2).toFixed(1)}" text-anchor="middle" font-size="10.5" fill="var(--ink)" font-family="var(--mono)">${escXML(label.slice(0, Math.max(4, Math.floor(w / 7))))}</text>` +
          `<text x="${(x + w / 2).toFixed(1)}" y="${(y + h / 2 + 10).toFixed(1)}" text-anchor="middle" font-size="9" fill="var(--ink-2)" font-family="var(--mono)">${escXML(dims)}</text>` : '');
    }).join('');
    // fraction guides
    const guides = `<line x1="${pad + 1220 * sx}" y1="${pad}" x2="${pad + 1220 * sx}" y2="${H - pad}" stroke="var(--line-2)" stroke-dasharray="5 4" stroke-width="1"/>` +
      `<line x1="${pad}" y1="${pad + 610 * sy}" x2="${pad + 1220 * sx}" y2="${pad + 610 * sy}" stroke="var(--line-2)" stroke-dasharray="5 4" stroke-width="1"/>`;
    return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Sheet cutting diagram" style="width:100%;height:auto;display:block">` +
      hatchDef(id) +
      `<rect x="${pad}" y="${pad}" width="${W - 2 * pad}" height="${H - 2 * pad}" fill="url(#${id})" stroke="var(--ink-2)" stroke-width="1.5"/>` +
      guides + rects +
      `<text x="${W - 8}" y="${H - 8}" text-anchor="end" font-size="10" fill="var(--muted)" font-family="var(--mono)">grain ⟶ · hatched = offcut · dashed = half/quarter cuts</text>` +
      `</svg>`;
  }

  BB.Packing = { sectionFor, pack1D, pack2D, planStock, boardSVG, sheetSVG };
})();
