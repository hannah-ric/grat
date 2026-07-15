/* Blueprint Buddy — golden corpus diff harness (audit Phase 4, permanent asset).
 *
 * Six reference designs spanning templates, drawers, the novel grammar, and
 * both unit systems are frozen with their COMPLETE expected outputs:
 * corrected spec, cut list, BOM, integrity numbers, optimizer layout, and
 * assembly step ids. Future changes diff against known-good plans instead of
 * re-litigating correctness. Every frozen value traces to the 2026 audit's
 * hand-verification worksheet (test/handcalc.js) and audit tests.
 *
 * Run:    node test/golden.test.js            (diff against test/golden/)
 * Update: node test/golden.test.js --update   (refreeze after an INTENDED
 *         change — review the diff in git before committing)
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRC = ['knowledge.js', 'geometry.js', 'units.js', 'spec.js', 'parametric.js', 'structural.js', 'fasteners.js',
  'packing.js', 'plans.js', 'exports.js', 'history.js', 'codec.js', 'ai.js', 'store.js', 'gallery.js', 'selftest.js'];
for (const f of SRC) vm.runInThisContext(fs.readFileSync(path.join(__dirname, '..', 'src', f), 'utf8'), { filename: f });
const { Spec, Parametric, Plans, K, Structural, Packing, Units } = globalThis.BB;

const GOLDEN_DIR = path.join(__dirname, 'golden');
const UPDATE = process.argv.includes('--update');

/* ---------------- the corpus ---------------- */
const CORPUS = [
  {
    name: 'seed-table-imperial',
    units: { system: 'imperial', precision: 16, dual: false },
    raw: { meta: { name: 'Seed Table', template: 'table', level: 'beginner', units: 'in' } }
  },
  {
    name: 'shaker-table-imperial',
    units: { system: 'imperial', precision: 16, dual: false },
    raw: {
      meta: { name: 'Shaker Dining Table', template: 'table', level: 'intermediate', units: 'in' },
      overall: { width: 1828.8, depth: 914.4, height: 749.3 }, wood: { species: 'cherry' },
      structure: { topThickness: 25, legThickness: 70, apronHeight: 101.6, apronThickness: 19, apronInset: 12.7 },
      joinery: { frame: 'dowels' }, finish: 'danish_oil'
    }
  },
  {
    name: 'walnut-nightstand-2drawer-imperial',
    units: { system: 'imperial', precision: 16, dual: false },
    raw: {
      meta: { name: 'Two-Drawer Nightstand', template: 'nightstand', level: 'intermediate', units: 'in' },
      overall: { width: 508, depth: 406.4, height: 609.6 }, wood: { species: 'walnut' },
      structure: { topThickness: 19, legThickness: 45, shelfCount: 1 },
      joinery: { frame: 'dowels', box: 'locking_rabbet' },
      drawers: { count: 2, frontStyle: 'inset', runner: 'side_mount_slides' }, finish: 'hardwax_oil'
    }
  },
  {
    name: 'advanced-cabinet-imperial',
    units: { system: 'imperial', precision: 16, dual: false },
    raw: {
      meta: { name: 'Sideboard Cabinet', template: 'cabinet', level: 'advanced', units: 'in' },
      overall: { width: 762, depth: 457.2, height: 914.4 }, wood: { species: 'white_oak' },
      structure: { topThickness: 25, shelfCount: 1, toeKick: true, backPanel: true },
      joinery: { frame: 'mortise_tenon', case: 'dado', box: 'half_blind_dovetail' },
      drawers: { count: 2, frontStyle: 'overlay', runner: 'side_mount_slides' }, finish: 'danish_oil'
    }
  },
  {
    name: 'ash-bookshelf-metric',
    units: { system: 'metric', precision: 16, dual: false },
    raw: {
      meta: { name: 'Floor Bookshelf', template: 'bookshelf', level: 'beginner', units: 'mm' },
      overall: { width: 900, depth: 300, height: 1800 }, wood: { species: 'ash' },
      structure: { shelfCount: 4, sideThickness: 19, shelfThickness: 19, backPanel: true }, finish: 'wipe_poly'
    }
  },
  {
    name: 'custom-bench-metric',
    units: { system: 'metric', precision: 16, dual: false },
    raw: Object.assign(Spec.defaultSpec('custom'), { meta: { name: 'Custom Bench', template: 'custom', level: 'beginner', units: 'mm' } })
  }
];

/* ---------------- deterministic snapshot of the full pipeline ---------------- */
const r3 = v => (typeof v === 'number' ? Math.round(v * 1000) / 1000 : v);
function snapshot(entry) {
  Units.set(entry.units);
  const spec = Spec.correctSpec(JSON.parse(JSON.stringify(entry.raw)));
  const model = Parametric.build(spec);
  const report = Spec.validate(spec, model);
  const integ = Structural.computeIntegrity(spec, model, {});
  const cut = Plans.cutList(spec, model);
  const stock = Packing.planStock(spec, model, cut, {});
  const bom = Plans.bom(spec, model, { integrity: integ, stock });
  const steps = Plans.assembly(spec, model, integ, { stockPlan: stock });
  return {
    spec,
    validation: { errors: report.errors.map(e => e.id), advisories: report.advisories.map(a => a.id) },
    cutList: cut.map(c => ({ name: c.name, qty: c.qty, L: r3(c.L), W: r3(c.W), T: r3(c.T), material: c.material, grain: c.grain, note: c.note, angles: c.angles || null })),
    integrity: {
      antiTip: integ.antiTip,
      rackScore: integ.racking.score,
      tip: integ.tip ? { angEmpty: r3(integ.tip.angEmpty), angLoaded: r3(integ.tip.angLoaded), ratio: r3(integ.tip.ratio) } : null,
      checks: integ.checks.map(c => ({
        id: c.id, status: c.status,
        data: c.data ? Object.fromEntries(Object.entries(c.data).map(([k, v]) => [k, r3(v)])) : null
      }))
    },
    stock: {
      mode: stock.mode,
      shopping: stock.shopping.map(s => ({ label: s.label, qty: s.qty, cost: r3(s.cost) })),
      boards: stock.boards.map(b => ({ nominal: b.nominal, stockLen: b.stockLen, offcut: r3(b.offcut), cuts: b.cuts.map(c => ({ name: c.name, len: r3(c.len), offset: r3(c.offset) })) })),
      sheets: stock.sheets.map(s => ({ thickness: s.thickness, fraction: s.fraction, placements: s.placements.map(p => ({ name: p.name, x: r3(p.x), y: r3(p.y), w: r3(p.w), h: r3(p.h), rot: !!p.rot })) })),
      totalCost: r3(stock.totalCost), wasteSolidPct: stock.wasteSolidPct, wasteSheetPct: stock.wasteSheetPct
    },
    bom: { items: bom.items.map(i => ({ kind: i.kind, label: i.label, qty: r3(i.qty), price: r3(i.price) })), total: r3(bom.total) },
    steps: steps.map(s => s.id)
  };
}

/* ---------------- diff harness ---------------- */
function diff(a, b, pathStr, out) {
  if (typeof a === 'number' && typeof b === 'number') {
    if (Math.abs(a - b) > 0.05) out.push(`${pathStr}: ${a} → ${b}`);
    return;
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) { out.push(`${pathStr}.length: ${a.length} → ${b.length}`); return; }
    a.forEach((v, i) => diff(v, b[i], `${pathStr}[${i}]`, out));
    return;
  }
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) diff(a[k], b[k], `${pathStr}.${k}`, out);
    return;
  }
  if (JSON.stringify(a) !== JSON.stringify(b)) out.push(`${pathStr}: ${JSON.stringify(a)} → ${JSON.stringify(b)}`);
}

let pass = 0, fail = 0;
fs.mkdirSync(GOLDEN_DIR, { recursive: true });
for (const entry of CORPUS) {
  const file = path.join(GOLDEN_DIR, entry.name + '.json');
  const snap = snapshot(entry);
  if (UPDATE || !fs.existsSync(file)) {
    fs.writeFileSync(file, JSON.stringify(snap, null, 1));
    console.log(`· ${entry.name}: ${UPDATE ? 'updated' : 'created'} (${snap.cutList.length} cut rows, ${snap.integrity.checks.length} checks, $${snap.stock.totalCost})`);
    continue;
  }
  const golden = JSON.parse(fs.readFileSync(file, 'utf8'));
  const diffs = [];
  diff(golden, snap, entry.name, diffs);
  if (!diffs.length) { pass++; console.log(`· ${entry.name}: matches golden`); }
  else {
    fail++;
    console.error(`✗ ${entry.name}: ${diffs.length} divergence(s) from golden`);
    for (const d of diffs.slice(0, 12)) console.error('    ' + d);
    if (diffs.length > 12) console.error(`    … and ${diffs.length - 12} more`);
  }
}
if (!UPDATE) {
  console.log(`\n${pass}/${CORPUS.length} golden designs match${fail ? ` — ${fail} DIVERGED (intended? re-freeze with --update and review the git diff)` : ''}`);
  process.exit(fail ? 1 : 0);
}
