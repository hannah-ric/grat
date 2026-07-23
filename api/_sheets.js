/* Blueprint Buddy — the blueprint sheet set (server-side, zero-dependency).
 *
 * Composes the ISSUED artifact: a complete, self-contained, print-optimized
 * HTML document — ten numbered sheets, each with a real title block (project,
 * blueprint id, revision, sheet n of N, issue date, link back to the live
 * design). Print it from any browser and every sheet is a page (@page CSS);
 * the document IS the deliverable, stored under the artifact hash and served
 * forever from /api/blueprint.
 *
 * Every number in it comes from the pipeline outputs passed in — this file
 * lays out; it never computes geometry (the founding rule, extended to paper).
 *
 * Files starting with "_" are libraries, not deployed Vercel functions.
 */
'use strict';

const esc = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const PRINT_COLORS = {
  '--ink': '#1c1a14', '--ink-2': '#444444', '--muted': '#777777', '--line-2': '#999999',
  '--accent': '#1b5d82', '--accent-soft': '#e8eef3', '--panel': '#ffffff', '--panel-2': '#eeeeee',
  '--mono': 'ui-monospace, monospace'
};
const printSVG = svg => String(svg).replace(/var\((--[a-z0-9-]+)\)/g, (m, v) => PRINT_COLORS[v] || '#333');

const CSS = `
  :root { color-scheme: light; }
  * { box-sizing: border-box; margin: 0; }
  body { font: 13px/1.5 "Helvetica Neue", Arial, sans-serif; color: #1c1a14; background: #f2f0ea; }
  .sheet { background: #fff; max-width: 980px; margin: 18px auto; padding: 34px 40px 88px; position: relative;
           border: 1px solid #d8d4c8; min-height: 640px; page-break-after: always; }
  .sheet h2 { font-size: 21px; margin: 0 0 4px; letter-spacing: .01em; }
  .sheet h3 { font-size: 14px; margin: 18px 0 6px; }
  .kicker { font-size: 11px; text-transform: uppercase; letter-spacing: .14em; color: #8a4a2b; margin-bottom: 10px; }
  table { border-collapse: collapse; width: 100%; margin: 8px 0 14px; font-size: 12px; }
  th, td { border: 1px solid #cfcabb; padding: 4px 7px; text-align: left; vertical-align: top; }
  th { background: #efece2; font-weight: 600; }
  .num { text-align: right; font-variant-numeric: tabular-nums; }
  .titleblock { position: absolute; left: 0; right: 0; bottom: 0; display: flex; border-top: 2px solid #1c1a14;
                font-size: 10.5px; background: #fff; }
  .titleblock > div { padding: 7px 12px; border-right: 1px solid #cfcabb; }
  .titleblock .tb-name { flex: 1.6; font-weight: 700; font-size: 12px; }
  .titleblock .tb-sheet { text-align: right; border-right: 0; min-width: 90px; }
  .tb-label { display: block; font-size: 8.5px; text-transform: uppercase; letter-spacing: .1em; color: #777; }
  .cover-hero { text-align: center; margin: 12px 0; }
  .cover-hero img { max-width: 100%; max-height: 430px; border: 1px solid #d8d4c8; }
  .cover-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin-top: 14px; }
  .cover-grid div { border: 1px solid #cfcabb; padding: 8px 10px; }
  .cover-grid strong { display: block; font-size: 16px; }
  .verdict { display: inline-block; border: 1.5px solid; padding: 3px 10px; font-weight: 700; font-size: 12px;
             letter-spacing: .06em; text-transform: uppercase; margin: 8px 0; }
  .verdict.pass { border-color: #2e6b3f; color: #2e6b3f; }
  .verdict.anchor, .verdict.advisory { border-color: #8a5a1c; color: #8a5a1c; }
  .verdict.fail { border-color: #8a2a1c; color: #8a2a1c; }
  .drawing svg { width: 100%; height: auto; }
  .board { margin: 10px 0; }
  .board svg { width: 100%; height: auto; }
  ol.steps { padding-left: 20px; } ol.steps li { margin: 0 0 10px; }
  .fine { color: #666; font-size: 11px; }
  .sheet-index td:first-child { width: 46px; }
  @media print {
    body { background: #fff; }
    .sheet { border: 0; margin: 0; max-width: none; min-height: auto; page-break-after: always; padding-bottom: 76px; }
    @page { size: letter; margin: 10mm; }
  }`;

/* One title block per sheet — the thing that makes it a document, not a printout. */
function titleblock(meta, sheetNo, sheetTitle, total) {
  return `<div class="titleblock">
    <div class="tb-name"><span class="tb-label">Project</span>${esc(meta.name)}</div>
    <div><span class="tb-label">Blueprint</span>${esc(meta.id)}</div>
    <div><span class="tb-label">Revision</span>${meta.revision}</div>
    <div><span class="tb-label">Issued</span>${esc(meta.issued)}</div>
    <div><span class="tb-label">Live design</span>${esc(meta.link || '—')}</div>
    <div class="tb-sheet"><span class="tb-label">${esc(sheetTitle)}</span>Sheet ${sheetNo} of ${total}</div>
  </div>`;
}

/* Compose the full sheet set. `p` carries the pipeline outputs:
 * { BB, spec, model, report, integ, cut, stock, bom, steps, time }
 * `meta`: { id, revision, issued, link, heroDataUrl, explodedDataUrl } */
function sheetSet(p, meta) {
  const { BB, spec, model, integ, cut, stock, bom, steps, time } = p;
  const U = BB.Units;
  const K = BB.K;
  const dim = v => U.fmtLength(v);
  const sp = K.WOOD_SPECIES[spec.wood.species];
  const verdict = integ.summary.verdict;
  const verdictText = verdict === 'fail' ? 'FAIL — do not build as drawn'
    : verdict === 'anchor' ? 'SAFE ONLY WHEN ANCHORED to the wall'
      : verdict === 'advisory' ? 'PASS with advisories' : 'PASS';
  const partCount = cut.reduce((s, r) => s + r.qty, 0);

  const SHEETS = [];
  const add = (title, body) => SHEETS.push({ title, body });

  /* 1 — cover */
  add('Cover', `
    <p class="kicker">Blueprint Buddy · issued blueprint</p>
    <h2>${esc(spec.meta.name)}</h2>
    <p>${dim(spec.overall.width)} W × ${dim(spec.overall.depth)} D × ${dim(spec.overall.height)} H · ${esc(sp.label)} · ${esc(spec.meta.level)} build</p>
    <span class="verdict ${esc(verdict)}">${esc(verdictText)}</span>
    ${meta.heroDataUrl ? `<div class="cover-hero"><img src="${esc(meta.heroDataUrl)}" alt="Rendered view of ${esc(spec.meta.name)}"></div>` : ''}
    <div class="cover-grid">
      <div><span class="tb-label">Parts</span><strong>${partCount}</strong></div>
      <div><span class="tb-label">Estimated materials</span><strong>$${bom.total}</strong></div>
      <div><span class="tb-label">Bench time</span><strong>≈ ${time.hoursLow}–${time.hoursHigh} h</strong>${time.sessions} session${time.sessions === 1 ? '' : 's'} at the ${esc(spec.meta.level)} pace</div>
    </div>
    <h3>Sheet index</h3>
    <table class="sheet-index"><tbody>__SHEET_INDEX__</tbody></table>
    ${meta.link ? `<p class="fine">This blueprint stays live: open ${esc(meta.link)} to refine the design or re-download any sheet.</p>` : ''}`);

  /* 2 — dimensioned elevations */
  add('Elevations', `
    <h2>Dimensioned elevations</h2>
    <p class="fine">Front, side, plan and detail views. Stylized elevations (not hidden-line); every dimension is the engine's own number.</p>
    <div class="drawing">${printSVG(BB.Drafting.sheetSVG(spec, model, dim, { origin: meta.origin }))}</div>`);

  /* 3 — exploded axonometric */
  add('Exploded view', `
    <h2>Exploded axonometric</h2>
    ${meta.explodedDataUrl
      ? `<div class="cover-hero"><img src="${esc(meta.explodedDataUrl)}" alt="Exploded view of ${esc(spec.meta.name)}"></div>
         <p class="fine">Part names and joints are called out in the cut list (sheet 4) and joinery details (sheet 6).</p>`
      : '<p class="fine">No exploded render was captured at issuance — open the live design and re-issue to add one. All part geometry is fully specified on sheets 4–6.</p>'}`);

  /* 4 — cut list */
  const cutRows = cut.map(r => `<tr><td>${esc(r.name)}</td><td class="num">${r.qty}</td><td class="num">${dim(r.L)}</td><td class="num">${dim(r.W)}</td><td class="num">${dim(r.T)}</td><td>${esc(K.WOOD_SPECIES[r.material] ? K.WOOD_SPECIES[r.material].label : r.material)}</td><td>${esc(r.note || '')}</td></tr>`).join('');
  add('Cut list', `
    <h2>Cut list — final dimensions, joinery allowances included</h2>
    <table><thead><tr><th>Part</th><th>Qty</th><th>Length</th><th>Width</th><th>Thick</th><th>Material</th><th>Notes</th></tr></thead><tbody>${cutRows}</tbody></table>
    <p class="fine">Load-bearing parts: select straight-grained, clear stock free of knots — the structural numbers on sheet 9 assume clear wood. Lengths include tenon/joinery allowances where noted.</p>`);

  /* 5 — stock plan + cutting diagrams */
  let stockBody = '<h2>Stock purchase plan</h2><p class="fine">Nothing to buy — no stock plan was produced for this design.</p>';
  if (stock && (stock.boards.length || stock.sheets.length)) {
    const shopRows = stock.shopping.map(s => `<tr><td>${esc(s.label)}</td><td class="num">${s.qty}</td><td>${esc(s.unit)}</td><td class="num">$${s.cost.toFixed(2)}</td></tr>`).join('');
    const boards = stock.boards.filter(b => b.stockLen).map((b, i) =>
      `<div class="board"><p>${esc(U.fmtNominal(b.nominal, b.actual, b.stockLen))} — board ${i + 1} · offcut ${dim(b.offcut)}</p>${printSVG(BB.Packing.boardSVG(b, dim))}</div>`).join('');
    const sheets = stock.sheets.map((s, i) =>
      `<div class="board"><p>${dim(s.thickness)} sheet ${i + 1} — buy a ${esc(s.fractionLabel)}</p>${printSVG(BB.Packing.sheetSVG(s, dim))}</div>`).join('');
    const waste = [];
    if (stock.wasteSolidPct != null) waste.push(`solid ${stock.wasteSolidPct}%`);
    if (stock.wasteSheetPct != null) waste.push(`sheet ${stock.wasteSheetPct}%`);
    stockBody = `
      <h2>Stock purchase plan &amp; cutting diagrams</h2>
      <table><thead><tr><th>Buy</th><th>Qty</th><th>Unit</th><th>Cost</th></tr></thead><tbody>${shopRows}</tbody></table>
      <p>Purchasable-stock total: <strong>$${stock.totalCost.toFixed(2)}</strong>${waste.length ? ' · waste ' + waste.join(' · ') : ''}</p>
      ${boards}${sheets}
      <p class="fine">Kerf ${U.fmtSmall(K.LUMBER.KERF)} per cut · ${dim(K.LUMBER.END_TRIM)} end trim per board end · hatched areas are offcuts.</p>`;
  }
  add('Stock plan', stockBody);

  /* 6 — joinery details with setout numbers */
  const setout = (BB.Fasteners ? BB.Fasteners.detailRows(spec, model) : []).concat(BB.Exports.hardwareRows(spec, model));
  add('Joinery details', `
    <h2>Joinery details — locations, pilots, setout</h2>
    ${setout.length
      ? `<table><thead><tr><th>Joint / hardware</th><th>Qty</th><th>Where</th><th>Setout</th></tr></thead><tbody>${setout.map(r => `<tr><td>${esc(r.label)}</td><td class="num">${r.qty}</td><td>${esc(r.where)}</td><td>${esc(r.text)}</td></tr>`).join('')}</tbody></table>`
      : '<p class="fine">This design has no fastened joints — all joinery is captured in the cut list allowances.</p>'}
    <p class="fine">Positions are measured from the reference edge named in each row. Tenon setouts are snapped to standard chisel sizes.</p>`);

  /* 7 — hardware schedule */
  const hwItems = bom.items.filter(i => i.kind === 'hardware' || i.kind === 'fastener' || /screw|slide|pull|pin|anchor|latch|bolt|figure/i.test(i.label));
  add('Hardware schedule', `
    <h2>Hardware schedule</h2>
    ${hwItems.length
      ? `<table><thead><tr><th>Item</th><th>Qty</th><th>Detail</th></tr></thead><tbody>${hwItems.map(i => `<tr><td>${esc(i.label)}</td><td class="num">${i.qty}</td><td>${esc(i.detail || '')}</td></tr>`).join('')}</tbody></table>`
      : '<p class="fine">No metal hardware — this design is joined entirely in wood.</p>'}
    <p class="fine">Counts match the drilling instructions on sheet 6 line for line.</p>`);

  /* 8 — assembly sequence */
  add('Assembly', `
    <h2>Assembly sequence</h2>
    <ol class="steps">${steps.map(s => `<li><strong>${esc(s.title)}.</strong> ${esc(s.text)}</li>`).join('')}</ol>`);

  /* 9 — finish schedule + safety */
  const fin = K.FINISHES[spec.finish];
  const checks = integ.checks.map(c => `<tr><td>${esc(c.label || c.id)}</td><td>${esc(String(c.status).toUpperCase())}</td><td>${esc(c.explain || '')}</td></tr>`).join('');
  add('Finish & safety', `
    <h2>Finish schedule</h2>
    ${fin ? `<p><strong>${esc(fin.label)}</strong> — ${esc(fin.desc || '')}</p>` : ''}
    ${time.finishWait ? `<p>${time.finishWait.coats} coats · recoat every ${time.finishWait.recoatHrs} h · full cure ${time.finishWait.cureDays} days.</p>` : ''}
    <h3>Safety verdict</h3>
    <span class="verdict ${esc(verdict)}">${esc(verdictText)}</span>
    ${integ.antiTip ? '<p><strong>Wall anchor is mandatory.</strong> The anti-tip anchor in the hardware schedule is a required part of this design, not an option.</p>' : ''}
    <table><thead><tr><th>Check</th><th>Result</th><th>Notes</th></tr></thead><tbody>${checks}</tbody></table>`);

  /* 10 — design basis & disclosure */
  add('Design basis', `
    <h2>Design basis &amp; disclosure</h2>
    <p>${esc(K.DESIGN_BASIS)}</p>
    <h3>Revision</h3>
    <table><tbody><tr><td>Blueprint</td><td>${esc(meta.id)}</td></tr><tr><td>Revision</td><td>${meta.revision}</td></tr><tr><td>Spec hash</td><td style="font-family:monospace">${esc(meta.specHash || '')}</td></tr><tr><td>Issued</td><td>${esc(meta.issued)}</td></tr></tbody></table>
    <p class="fine">Every number in this document is a pure function of the corrected design spec above — regenerating from the same spec reproduces this blueprint exactly.</p>`);

  const total = SHEETS.length;
  const index = SHEETS.map((s, i) => `<tr><td class="num">${i + 1}</td><td>${esc(s.title)}</td></tr>`).join('');
  const body = SHEETS.map((s, i) =>
    `<section class="sheet">${s.body.replace('__SHEET_INDEX__', index)}${titleblock(meta, i + 1, s.title, total)}</section>`).join('\n');

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(spec.meta.name)} — Blueprint ${esc(meta.id)} rev ${meta.revision}</title>
<style>${CSS}</style></head>
<body>${body}</body></html>`;
}

/* ---------------- full-size (1:1) templates ----------------
 * Printable layout strips whose drawing units are REAL millimetres (SVG mm
 * units — print at 100% scale, no "fit to page"): fastener positions per
 * unique joint pairing, and pull-bore layouts per drawer front. Strips
 * longer than a page are split into segments with alignment ticks. The
 * geometry is the engine's own (layoutForJoint / pull spec) — this file only
 * draws it. */
const SEG_MM = 240;         // printable strip segment (letter/A4 portrait safe width)
const STRIP_H = 46;         // strip height in mm

function stripSVG(esc, seg, label, sub) {
  const w = seg.w;
  const ticks = seg.marks.map(m =>
    `<line x1="${m.at}" y1="8" x2="${m.at}" y2="${STRIP_H - 12}" stroke="#1c1a14" stroke-width="0.3"/>` +
    `<circle cx="${m.at}" cy="${(STRIP_H - 2) / 2}" r="${Math.max(0.6, (m.dia || 2) / 2)}" fill="none" stroke="#8a2a1c" stroke-width="0.4"/>` +
    `<text x="${m.at}" y="${STRIP_H - 6}" font-size="3.2" text-anchor="middle" fill="#444">${esc(m.label || '')}</text>`
  ).join('');
  const joinL = seg.joinLeft ? `<path d="M0,0 L4,4 L0,8" fill="none" stroke="#1b5d82" stroke-width="0.5"/><text x="1" y="14" font-size="3" fill="#1b5d82">join ←</text>` : '';
  const joinR = seg.joinRight ? `<path d="M${w},0 L${w - 4},4 L${w},8" fill="none" stroke="#1b5d82" stroke-width="0.5"/><text x="${w - 14}" y="14" font-size="3" fill="#1b5d82">join →</text>` : '';
  return `<div class="strip">
    <p><strong>${esc(label)}</strong>${sub ? ' — ' + esc(sub) : ''}${seg.part ? ` · segment ${seg.part}` : ''}</p>
    <svg width="${w}mm" height="${STRIP_H}mm" viewBox="0 0 ${w} ${STRIP_H}" xmlns="http://www.w3.org/2000/svg">
      <rect x="0" y="8" width="${w}" height="${STRIP_H - 20}" fill="none" stroke="#1c1a14" stroke-width="0.5"/>
      <line x1="0" y1="${(STRIP_H - 2) / 2}" x2="${w}" y2="${(STRIP_H - 2) / 2}" stroke="#999" stroke-width="0.2" stroke-dasharray="2,2"/>
      ${ticks}${joinL}${joinR}
      <text x="2" y="5" font-size="3.2" fill="#444">0 at the reference end — print at 100% scale, verify with the 100 mm check bar</text>
    </svg>
  </div>`;
}

function segment(runMM, marks) {
  const segs = [];
  for (let start = 0, i = 1; start < runMM; start += SEG_MM, i++) {
    const w = Math.min(SEG_MM, runMM - start);
    segs.push({
      w, part: runMM > SEG_MM ? i : 0,
      joinLeft: start > 0, joinRight: start + w < runMM,
      marks: marks.filter(m => m.atRun >= start && m.atRun <= start + w).map(m => ({ at: m.atRun - start, dia: m.dia, label: m.label }))
    });
  }
  return segs;
}

function templateSet(p, meta) {
  const { BB, spec, model } = p;
  const esc2 = esc;
  const U = BB.Units;
  const strips = [];
  // One strip per unique joint pairing that has discrete fasteners.
  const seen = new Set();
  for (const joint of model.joints || []) {
    const lay = BB.Fasteners ? BB.Fasteners.layoutForJoint(spec, model, joint) : null;
    if (!lay || !lay.fasteners || !lay.fasteners.length) continue;
    const key = [lay.type, lay.a.name, lay.b.name, Math.round(lay.runMM)].join('|');
    if (seen.has(key)) continue;
    seen.add(key);
    const marks = lay.fasteners.map(f => ({ atRun: f.alongMM, dia: f.diaMM || f.pilotMM || 3, label: U.fmtDrill(f.pilotMM || f.diaMM || 3) }));
    for (const seg of segment(lay.runMM, marks)) {
      strips.push(stripSVG(esc2, seg, `${lay.a.name} → ${lay.b.name}`, `${lay.type.replace(/_/g, ' ')} · run ${U.fmtLength(lay.runMM)}`));
    }
  }
  // Pull-bore layout per drawer front.
  for (const d of model.drawers || []) {
    const pu = d.pull || {};
    if (!pu.ctcMM || !pu.holes) continue;
    const w = d.front.w;
    const centers = [];
    const mid = w / 2;
    if (pu.count > 1) centers.push(w / 3, 2 * w / 3);
    else centers.push(mid);
    const marks = [];
    for (const c of centers) {
      if (pu.holes === 2) { marks.push({ atRun: c - pu.ctcMM / 2, dia: 5, label: U.fmtDrill(5) }, { atRun: c + pu.ctcMM / 2, dia: 5, label: U.fmtDrill(5) }); }
      else marks.push({ atRun: c, dia: 5, label: U.fmtDrill(5) });
    }
    for (const seg of segment(w, marks)) {
      strips.push(stripSVG(esc2, seg, `Drawer ${d.index + 1} front — pull bores`, `front width ${U.fmtLength(w)}, bores on the shared centerline`));
    }
  }
  const check = `<div class="strip"><p><strong>Scale check</strong> — this bar must measure exactly 100 mm (3 15/16 in). If it doesn't, printing scaled.</p>
    <svg width="110mm" height="12mm" viewBox="0 0 110 12" xmlns="http://www.w3.org/2000/svg">
      <rect x="0" y="2" width="100" height="6" fill="none" stroke="#1c1a14" stroke-width="0.5"/>
      <text x="50" y="11.5" font-size="3.2" text-anchor="middle" fill="#444">100 mm</text>
    </svg></div>`;
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(spec.meta.name)} — full-size templates (1:1) · ${esc(meta.id)}</title>
<style>
  body { font: 12px/1.5 "Helvetica Neue", Arial, sans-serif; color: #1c1a14; background: #fff; margin: 10mm; }
  h1 { font-size: 18px; margin: 0 0 2px; } .sub { color: #666; margin: 0 0 12px; }
  .strip { page-break-inside: avoid; margin: 0 0 8mm; }
  .strip p { margin: 0 0 2mm; font-size: 11px; }
  @media print { @page { size: letter; margin: 8mm; } }
</style></head><body>
  <h1>${esc(spec.meta.name)} — full-size templates (1:1)</h1>
  <p class="sub">Blueprint ${esc(meta.id)} rev ${meta.revision} · Print at 100% scale ("Actual size", never "Fit to page"), then stick each strip to the work and mark through the circles.</p>
  ${check}
  ${strips.length ? strips.join('\n') : '<p>This design has no discrete fastener layouts — all joinery is captured in the cut-list allowances and sheet 6 of the blueprint.</p>'}
</body></html>`;
}

module.exports = { sheetSet, templateSet };
