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

const SRC = ['knowledge.js', 'hardware.js', 'icons.js', 'materials.js', 'geometry.js', 'units.js', 'classes.js', 'spec.js', 'parametric.js', 'structural.js', 'fasteners.js', 'packing.js',
  'plans.js', 'drafting.js', 'gltf.js', 'exports.js', 'history.js', 'codec.js', 'ai.js', 'store.js', 'gallery.js', 'joinery3d.js', 'selftest.js'];
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
    /* A FROZEN reference design, spelled out here on purpose. It used to be
     * `Spec.defaultSpec('custom')`, which quietly coupled the golden corpus to
     * a mutable product default: repairing that default (audit X-05, which
     * moved its joints off end-grain screws) would have silently rewritten a
     * frozen fixture. The corpus exists to hold behaviour still, so it carries
     * its own composition — screwed, end-grain-bearing, and honestly failing
     * joint adequacy, exactly as it was frozen. */
    name: 'custom-bench-metric',
    units: { system: 'metric', precision: 16, dual: false },
    raw: Object.assign(Spec.defaultSpec('custom'), {
      meta: { name: 'Custom Bench', template: 'custom', level: 'beginner', units: 'mm' },
      overall: { width: 1100, depth: 350, height: 468 },
      custom: {
        parts: [
          { id: 'p1', role: 'seat', primitive: 'slab', dim: { l: 1100, w: 350, t: 38 }, pos: { x: 0, y: 449, z: 0 }, rot: null, grain: 'length', stock: 'solid', loadBearing: false, surface: 'seating' },
          { id: 'p2', role: 'leg_panel', primitive: 'panel', dim: { l: 350, w: 430, t: 38 }, pos: { x: -475, y: 215, z: 0 }, rot: { x: 0, y: 90, z: 0 }, grain: 'length', stock: 'solid', loadBearing: true, surface: 'none' },
          { id: 'p3', role: 'leg_panel', primitive: 'panel', dim: { l: 350, w: 430, t: 38 }, pos: { x: 475, y: 215, z: 0 }, rot: { x: 0, y: 90, z: 0 }, grain: 'length', stock: 'solid', loadBearing: true, surface: 'none' }
        ],
        connections: [
          { a: 'p2', b: 'p1', joint: 'butt_screws' },
          { a: 'p3', b: 'p1', joint: 'butt_screws' }
        ]
      }
    })
  },

  /* ---- seating class (2026-07): nominal chair (imperial), nominal counter
   * stool (metric), and a boundary chair pushing every seat-family rule to
   * its edge (metric) — the class contract's golden manifest. Refusal cases
   * are frozen as exact-match assertions in audit.test.js (SEAT sections):
   * a refusal produces notes and errors, not a plan to snapshot. */
  {
    name: 'oak-dining-chair-imperial',
    units: { system: 'imperial', precision: 16, dual: false },
    raw: {
      meta: { name: 'Oak Dining Chair', template: 'chair', level: 'advanced', units: 'in' },
      wood: { species: 'red_oak' },
      joinery: { frame: 'mortise_tenon' },
      finish: 'danish_oil'
    }
  },
  {
    name: 'maple-counter-stool-metric',
    units: { system: 'metric', precision: 16, dual: false },
    raw: {
      meta: { name: 'Maple Counter Stool', template: 'chair', level: 'intermediate', units: 'mm' },
      wood: { species: 'hard_maple' },
      seat: { backHeight: 0, counterHeight: 900, splayDeg: 5 },
      finish: 'hardwax_oil'
    }
  },
  {
    /* Desk apron drawers (frame_table extension, 2026-07): the band model —
     * front apron replaced by a lower rail + centre stile, wood runners,
     * inset pencil fronts, stiffness-shared beam check. */
    name: 'walnut-writing-desk-imperial',
    units: { system: 'imperial', precision: 16, dual: false },
    raw: {
      meta: { name: 'Writing Desk', template: 'desk', level: 'intermediate', units: 'in' },
      wood: { species: 'walnut' },
      structure: { apronHeight: 110, topThickness: 25 },
      joinery: { frame: 'dowels', box: 'locking_rabbet' },
      drawers: { count: 1 },
      finish: 'hardwax_oil'
    }
  },
  /* ---- wall_mounted class (2026-07): nominal stud shelf (imperial) and a
   * boundary masonry shelf at the depth cap with the thickness coupling +
   * required-anchor-rating pattern frozen (metric). */
  {
    name: 'oak-floating-shelf-imperial',
    units: { system: 'imperial', precision: 16, dual: false },
    raw: {
      meta: { name: 'Oak Floating Shelf', template: 'wall_shelf', level: 'beginner', units: 'in' },
      wood: { species: 'red_oak' },
      overall: { width: 914.4, depth: 241.3 },
      finish: 'danish_oil'
    }
  },
  {
    name: 'deep-shelf-masonry-metric',
    units: { system: 'metric', precision: 16, dual: false },
    raw: {
      meta: { name: 'Deep Alcove Shelf', template: 'wall_shelf', level: 'intermediate', units: 'mm' },
      wood: { species: 'white_oak' },
      overall: { width: 1200, depth: 300 },
      structure: { topThickness: 25 }, // the coupling forces 32 — frozen proof
      wall: { substrate: 'masonry' }
    }
  },
  {
    /* Boundary: every seat-family knob at (or past) its edge — width/depth
     * at the band tops, seat height at the dining clamp, back rise at max,
     * rake asked at 8° and CLAMPED by the straight-post rule, slope at max.
     * Freezes both the clamps and the ergonomic advisories they trigger. */
    name: 'walnut-chair-boundary-metric',
    units: { system: 'metric', precision: 16, dual: false },
    raw: {
      meta: { name: 'Boundary Chair', template: 'chair', level: 'intermediate', units: 'mm' },
      wood: { species: 'walnut' },
      seat: { width: 520, depth: 460, height: 520, slopeDeg: 8, backHeight: 650, backRake: 8 },
      structure: { legThickness: 45, topThickness: 25 }
    }
  },

  /* ---- bed class (2026-07): nominal queen (imperial) with headboard and
   * the mandated centre rail, and a twin (metric) with no headboard — the
   * no-centre-rail side of the mandate plus the pine section step-up the
   * species-aware slat solver produces. Refusals (bunk/crib/murphy/glued)
   * are exact-match assertions in audit BED-2/BED-3. */
  {
    name: 'oak-queen-bed-imperial',
    units: { system: 'imperial', precision: 16, dual: false },
    raw: {
      meta: { name: 'Oak Queen Bed', template: 'bed', level: 'beginner', units: 'in' },
      wood: { species: 'red_oak' },
      bed: { size: 'queen' },
      finish: 'danish_oil'
    }
  },
  {
    name: 'pine-twin-bed-metric',
    units: { system: 'metric', precision: 16, dual: false },
    raw: {
      meta: { name: 'Pine Twin Bed', template: 'bed', level: 'beginner', units: 'mm' },
      wood: { species: 'pine' },
      bed: { size: 'twin', headboardHeight: 0, platformHeight: 300 }
    }
  },

  /* ---- childrens scope class (2026-07): the school-age pair the class
   * contract's golden manifest names — a table (metric) and a chair
   * (imperial), both pinned to EN 1729 mark 3 by the child block. The table
   * freezes the band height pin (750 asked, 590 delivered) + the child
   * finish advisory; the chair freezes the derived child seat plan, the
   * adult-magnitude tilt margins on child geometry, and the child:entrap /
   * child:basis checks. Refusal cases (toy chest, high chair, changing
   * table, play yard/gate) are exact-match assertions in audit KID-1 —
   * a refusal produces a named regulation, not a plan to snapshot. */
  {
    name: 'maple-kids-table-metric',
    units: { system: 'metric', precision: 16, dual: false },
    raw: {
      meta: { name: 'Kids Craft Table', template: 'table', level: 'beginner', units: 'mm' },
      wood: { species: 'hard_maple' },
      overall: { width: 900, depth: 600, height: 750 }, // 750 asked — the band pins 590
      child: { ageBand: 'school' },
      finish: 'tung_pure'
    }
  },
  {
    name: 'oak-kids-chair-imperial',
    units: { system: 'imperial', precision: 16, dual: false },
    raw: {
      meta: { name: 'Kids Chair', template: 'chair', level: 'beginner', units: 'in' },
      wood: { species: 'red_oak' },
      child: { ageBand: 'school' },
      finish: 'hardwax_oil'
    }
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
      verdict: integ.summary.verdict, // rollup tier (audit M-18): fail > anchor > advisory > pass
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
