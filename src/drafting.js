/* Blueprint Buddy — 2D drafting: dimensioned elevation SVGs (Phase 5).
 * Pure functions of the built model. Orthographic projection of every part's
 * oriented box onto a view plane: axis-aligned parts render as <rect>,
 * rotated custom parts as convex-hull <polygon> (BB.Geo does the OBB math).
 * Painter's order by view depth gives a stylized elevation — deliberately
 * NOT hidden-line removal, and the UI says so.
 *
 * Dimension text crosses the display boundary through the caller-supplied
 * fmt (BB.Units.fmtLength); geometry itself stays raw millimetres in the
 * SVG coordinate space. Colors are CSS variables so drawings theme on
 * screen; print/export swaps them for fixed ink (Exports.printSVG).
 */
var BB = globalThis.BB = globalThis.BB || {};

(function () {
  'use strict';

  /* View definitions: u/v pick world axes (with sign) for the sheet plane
   * (v grows downward in SVG), depth orders the painter (ascending = far
   * first). h/vDim name the overall dimensions each view carries. */
  const VIEWS = {
    front: { u: p => p[0], v: p => -p[1], depth: p => p[2], hAxis: 'w', vAxis: 'h', title: 'FRONT' },
    side: { u: p => p[2], v: p => -p[1], depth: p => p[0], hAxis: 'd', vAxis: 'h', title: 'SIDE' },
    top: { u: p => p[0], v: p => p[2], depth: p => p[1], hAxis: 'w', vAxis: 'd', title: 'PLAN' }
  };
  const nf = v => (Math.round(v * 100) / 100).toString();

  function corners(part) {
    if (part.rot && (part.rot.x || part.rot.y || part.rot.z)) {
      return BB.Geo.obbCorners(BB.Geo.partOBB(part));
    }
    const { w, h, d } = part.size, p = part.pos;
    const out = [];
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) {
      out.push([p.x + sx * w / 2, p.y + sy * h / 2, p.z + sz * d / 2]);
    }
    return out;
  }

  /* One projected part → { shape (svg element string body), depth, uv bounds }
   * pl carries the optional animatable attribute — '' emits byte-identical
   * legacy markup. */
  function project(part, V, pl = '') {
    const cs = corners(part);
    const pts = cs.map(c => [V.u(c), V.v(c)]);
    const depth = cs.reduce((n, c) => n + V.depth(c), 0) / cs.length;
    const rotated = !!(part.rot && (part.rot.x || part.rot.y || part.rot.z));
    let shape;
    if (rotated) {
      const hull = BB.Geo.convexHull2D(pts);
      shape = `<polygon points="${hull.map(p => nf(p[0]) + ',' + nf(p[1])).join(' ')}"${pl}/>`;
    } else {
      const us = pts.map(p => p[0]), vs = pts.map(p => p[1]);
      const u0 = Math.min(...us), v0 = Math.min(...vs);
      shape = `<rect x="${nf(u0)}" y="${nf(v0)}" width="${nf(Math.max(...us) - u0)}" height="${nf(Math.max(...vs) - v0)}"${pl}/>`;
    }
    return { shape, depth, us: pts.map(p => p[0]), vs: pts.map(p => p[1]) };
  }

  /* Architectural dimension: extension lines + slash ticks + centered label.
   * Horizontal along the bottom (dir 'h') or vertical along the left ('v'). */
  function dimension(a, b, off, dir, text, pl = '') {
    const T = 7; // tick half-length
    if (dir === 'h') {
      const y = off;
      return `<g class="dim">
        <line x1="${nf(a.u)}" y1="${nf(a.v)}" x2="${nf(a.u)}" y2="${nf(y + 6)}"${pl}/>
        <line x1="${nf(b.u)}" y1="${nf(b.v)}" x2="${nf(b.u)}" y2="${nf(y + 6)}"${pl}/>
        <line x1="${nf(a.u)}" y1="${nf(y)}" x2="${nf(b.u)}" y2="${nf(y)}"${pl}/>
        <line x1="${nf(a.u - T)}" y1="${nf(y + T)}" x2="${nf(a.u + T)}" y2="${nf(y - T)}"${pl}/>
        <line x1="${nf(b.u - T)}" y1="${nf(y + T)}" x2="${nf(b.u + T)}" y2="${nf(y - T)}"${pl}/>
        <text x="${nf((a.u + b.u) / 2)}" y="${nf(y - 8)}" text-anchor="middle">${text}</text>
      </g>`;
    }
    const x = off;
    return `<g class="dim">
      <line x1="${nf(a.u)}" y1="${nf(a.v)}" x2="${nf(x - 6)}" y2="${nf(a.v)}"${pl}/>
      <line x1="${nf(b.u)}" y1="${nf(b.v)}" x2="${nf(x - 6)}" y2="${nf(b.v)}"${pl}/>
      <line x1="${nf(x)}" y1="${nf(a.v)}" x2="${nf(x)}" y2="${nf(b.v)}"${pl}/>
      <line x1="${nf(x - T)}" y1="${nf(a.v + T)}" x2="${nf(x + T)}" y2="${nf(a.v - T)}"${pl}/>
      <line x1="${nf(x - T)}" y1="${nf(b.v + T)}" x2="${nf(x + T)}" y2="${nf(b.v - T)}"${pl}/>
      <text x="${nf(x - 8)}" y="${nf((a.v + b.v) / 2)}" text-anchor="middle" transform="rotate(-90 ${nf(x - 8)} ${nf((a.v + b.v) / 2)})">${text}</text>
    </g>`;
  }

  /* Full dimensioned elevation. Returns a standalone themable <svg>.
   * opts.animatable adds pathLength="1" to every stroke shape so
   * BB.Motion.draw can run the linework in; default OFF keeps the output
   * byte-identical (golden-proved) for exports, print, and saved sheets. */
  function elevationSVG(spec, model, view, fmt, opts) {
    const pl = opts && opts.animatable ? ' pathLength="1"' : '';
    const V = VIEWS[view] || VIEWS.front;
    const projected = model.parts
      .filter(p => p.role !== 'pull')
      .map(p => project(p, V, pl))
      .sort((a, b) => a.depth - b.depth);
    if (!projected.length) return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"></svg>';

    let uMin = Infinity, uMax = -Infinity, vMin = Infinity, vMax = -Infinity;
    for (const pr of projected) {
      uMin = Math.min(uMin, ...pr.us); uMax = Math.max(uMax, ...pr.us);
      vMin = Math.min(vMin, ...pr.vs); vMax = Math.max(vMax, ...pr.vs);
    }

    const bodies = projected.map(pr => pr.shape).join('\n    ');

    // Overall dimensions: horizontal below, vertical left.
    const span = Math.max(uMax - uMin, vMax - vMin);
    const off = span * 0.1 + 40;
    const dims = [
      dimension({ u: uMin, v: vMax }, { u: uMax, v: vMax }, vMax + off, 'h',
        fmt(model.bounds[V.hAxis]), pl),
      dimension({ u: uMin, v: vMin }, { u: uMin, v: vMax }, uMin - off, 'v',
        fmt(model.bounds[V.vAxis]), pl)
    ];

    // Front view: drawer openings as dashed callouts with height labels.
    let openings = '';
    if (view === 'front' && model.openings && model.openings.length) {
      openings = model.openings.map(op => {
        const u0 = (op.x || 0) - op.w / 2, v0 = -op.yTop;
        return `<g class="opening"><rect x="${nf(u0)}" y="${nf(v0)}" width="${nf(op.w)}" height="${nf(op.h)}"${pl}/>` +
          `<text x="${nf(u0 + op.w / 2)}" y="${nf(v0 + op.h / 2 + 5)}" text-anchor="middle">${fmt(op.h)}</text></g>`;
      }).join('\n    ');
    }

    const pad = off + 60;
    const x0 = uMin - pad, y0 = vMin - pad * 0.55;
    const w = (uMax - uMin) + pad * 1.5, h = (vMax - vMin) + pad * 1.8;
    const fs = Math.max(14, span * 0.035);
    /* The view title anchors to the viewBox centre, not the geometry centre:
     * the left dimension stack pads the frame asymmetrically, so a geometry-
     * anchored title reads visibly off-centre in the rendered drawing. The
     * fs*0.06 nudge half-compensates text-anchor="middle" centring the
     * advance width, which includes the trailing 0.12em letter-space. */
    const titleX = x0 + w / 2 + fs * 0.06;
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${nf(x0)} ${nf(y0)} ${nf(w)} ${nf(h)}" class="bb-elevation" role="img" aria-label="${V.title} elevation">
  <style>
    .bb-elevation { font-family: var(--mono); }
    .body rect, .body polygon { fill: var(--panel); stroke: var(--ink); stroke-width: ${nf(span * 0.004 + 1)}; stroke-linejoin: round; }
    .dim line { stroke: var(--accent); stroke-width: ${nf(span * 0.002 + 0.7)}; }
    .dim text { fill: var(--accent); font-size: ${nf(fs)}px; }
    .opening rect { fill: none; stroke: var(--accent); stroke-width: ${nf(span * 0.002 + 0.7)}; stroke-dasharray: ${nf(span * 0.012)} ${nf(span * 0.008)}; }
    .opening text { fill: var(--muted); font-size: ${nf(fs * 0.8)}px; }
    .vtitle { fill: var(--ink-2); font-size: ${nf(fs)}px; letter-spacing: 0.12em; }
  </style>
  <g class="body">
    ${bodies}
  </g>
    ${openings}
    ${dims.join('\n    ')}
  <text class="vtitle" x="${nf(titleX)}" y="${nf(vMax + off + 34)}" text-anchor="middle">${V.title} ELEVATION</text>
</svg>`;
  }

  /* One-page drawing sheet: three elevations + a title block. Origin is
   * runtime state passed in by the caller (audit A-11) — the sheet stays a
   * pure function of its arguments. */
  function sheetSVG(spec, model, fmt, opts) {
    const host = String((opts && opts.origin) || '').replace(/^https?:\/\//, '').replace(/\/$/, '');
    const views = ['front', 'side', 'top'];
    const inner = views.map((v, i) =>
      `<svg x="${(i % 2) * 50}%" y="${i < 2 ? 0 : 46}%" width="50%" height="46%" preserveAspectRatio="xMidYMid meet">${elevationSVG(spec, model, v, fmt)}</svg>`
    ).join('\n  ');
    const sp = BB.K.WOOD_SPECIES[spec.wood.species];
    const dims = `${fmt(spec.overall.width)} W × ${fmt(spec.overall.depth)} D × ${fmt(spec.overall.height)} H`;
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1400 1000" class="bb-sheet" role="img" aria-label="Drawing sheet">
  <style>
    .bb-sheet { font-family: var(--mono); }
    .frame { fill: none; stroke: var(--ink); stroke-width: 2; }
    .tb line { stroke: var(--ink); stroke-width: 1.2; }
    .tb text { fill: var(--ink); font-size: 15px; }
    .tb .big { font-size: 22px; font-weight: 600; }
    .tb .sub { fill: var(--muted); font-size: 12px; }
  </style>
  <rect class="frame" x="8" y="8" width="1384" height="984"/>
  ${inner}
  <g class="tb">
    <line x1="708" y1="930" x2="1392" y2="930"/>
    <line x1="708" y1="930" x2="708" y2="992"/>
    <text class="big" x="724" y="958">${escText(spec.meta.name)}</text>
    <text x="724" y="980">${escText(dims)} · ${escText(sp ? sp.label : spec.wood.species)}</text>
    <text class="sub" x="1180" y="958">BLUEPRINT BUDDY</text>
    <text class="sub" x="1180" y="980">NOT HIDDEN-LINE · ${escText(String(spec.meta.level).toUpperCase())} BUILD</text>
  </g>${host ? `
  <text class="tb-origin" x="16" y="986" style="fill: var(--muted); font-size: 12px;">Made with Blueprint Buddy — ${escText(host)}</text>` : ''}
</svg>`;
  }
  const escText = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  BB.Drafting = { elevationSVG, sheetSVG, VIEWS };
})();
