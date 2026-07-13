/* Blueprint Buddy — DesignSpec: schema, defaults, correction, validation, diffing.
 *
 * Architecture rule (Phase 1, still binding): the AI proposes intent as a spec
 * (or a partial-spec diff); THIS layer owns the corrected spec; geometry and all
 * derived plans are pure functions of the corrected spec.
 *
 * All lengths are millimetres internally. `meta.units` only affects display.
 */
var BB = globalThis.BB = globalThis.BB || {};

(function () {
  'use strict';
  const K = BB.K;

  const TEMPLATES = ['table', 'desk', 'bench', 'bookshelf', 'nightstand', 'cabinet'];

  /* ---------------- defaults ---------------- */
  function defaultSpec(template) {
    const base = {
      meta: { name: 'Untitled', template: template || 'table', level: 'beginner', units: 'mm' },
      overall: { width: 1500, depth: 850, height: 745 },
      wood: { species: 'red_oak', sheetSpecies: 'baltic_birch' },
      structure: {
        topThickness: 25, legThickness: 70, apronHeight: 90, apronThickness: 20,
        apronInset: 12, shelfCount: 0, shelfThickness: 19, sideThickness: 18,
        backPanel: true, toeKick: false
      },
      joinery: { frame: 'pocket_screws', case: 'butt_screws', box: 'pocket_screws' },
      finish: 'wipe_poly',
      drawers: null
    };
    const t = base.meta.template;
    if (t === 'desk') Object.assign(base.overall, { width: 1300, depth: 650, height: 735 });
    if (t === 'bench') {
      Object.assign(base.overall, { width: 1200, depth: 380, height: 450 });
      Object.assign(base.structure, { topThickness: 32, legThickness: 60, apronHeight: 80 });
    }
    if (t === 'bookshelf') {
      Object.assign(base.overall, { width: 900, depth: 300, height: 1800 });
      base.structure.shelfCount = 4;
    }
    if (t === 'nightstand') {
      Object.assign(base.overall, { width: 500, depth: 400, height: 600 });
      Object.assign(base.structure, { topThickness: 20, legThickness: 45, apronHeight: 80 });
      base.drawers = { count: 1, frontStyle: 'inset', runner: 'side_mount_slides' };
    }
    if (t === 'cabinet') {
      Object.assign(base.overall, { width: 800, depth: 450, height: 900 });
      Object.assign(base.structure, { topThickness: 25, shelfCount: 1, toeKick: true });
      base.drawers = { count: 2, frontStyle: 'overlay', runner: 'side_mount_slides' };
    }
    return base;
  }

  /* ---------------- small utilities ---------------- */
  function clone(o) { return o === undefined ? undefined : JSON.parse(JSON.stringify(o)); }
  function isObj(v) { return v && typeof v === 'object' && !Array.isArray(v); }

  /* Deep merge `patch` into a clone of `base`. `null` is kept as an explicit
   * null (how the AI removes drawers: {"drawers":null}) so correction can tell
   * "removed" apart from "unspecified" and won't resurrect a template default. */
  function deepMerge(base, patch) {
    const out = clone(base) || {};
    (function walk(dst, src) {
      for (const k of Object.keys(src)) {
        const v = src[k];
        if (v === null) { dst[k] = null; continue; }
        if (isObj(v)) {
          if (!isObj(dst[k])) dst[k] = {};
          walk(dst[k], v);
        } else dst[k] = clone(v);
      }
    })(out, patch || {});
    return out;
  }

  /* Flatten two specs into [{path, from, to}] — the code-computed record of
   * what actually changed. The model's "explain" is never trusted for this. */
  function diffSpecs(a, b) {
    const paths = new Set();
    (function collect(o, p) {
      if (!isObj(o)) { paths.add(p); return; }
      for (const k of Object.keys(o)) collect(o[k], p ? p + '.' + k : k);
    })(a || {}, ''); // eslint-disable-line
    (function collect(o, p) {
      if (!isObj(o)) { paths.add(p); return; }
      for (const k of Object.keys(o)) collect(o[k], p ? p + '.' + k : k);
    })(b || {}, '');
    const get = (o, path) => path.split('.').reduce((x, k) => (x == null ? x : x[k]), o);
    const out = [];
    for (const p of [...paths].sort()) {
      if (!p) continue;
      const va = get(a, p), vb = get(b, p);
      if (isObj(va) || isObj(vb)) continue;
      if (JSON.stringify(va) !== JSON.stringify(vb)) out.push({ path: p, from: va, to: vb });
    }
    return out;
  }

  /* Human labels + value formatting for diff chips and the inspector. */
  const PATH_LABELS = {
    'meta.name': 'name', 'meta.template': 'template', 'meta.level': 'skill level', 'meta.units': 'units',
    'overall.width': 'width', 'overall.depth': 'depth', 'overall.height': 'height',
    'wood.species': 'species', 'wood.sheetSpecies': 'sheet stock',
    'structure.topThickness': 'top thickness', 'structure.legThickness': 'leg thickness',
    'structure.apronHeight': 'apron height', 'structure.apronThickness': 'apron thickness',
    'structure.apronInset': 'apron inset', 'structure.shelfCount': 'shelf count',
    'structure.shelfThickness': 'shelf thickness', 'structure.sideThickness': 'side thickness',
    'structure.backPanel': 'back panel', 'structure.toeKick': 'toe kick',
    'joinery.frame': 'frame joinery', 'joinery.case': 'case joinery', 'joinery.box': 'drawer-box joinery',
    'finish': 'finish',
    'drawers.count': 'drawer count', 'drawers.frontStyle': 'drawer fronts', 'drawers.runner': 'drawer runners'
  };
  const MM_PATHS = /^(overall\.|structure\.(top|leg|apron|shelf|side)Thickness|structure\.apronHeight|structure\.apronInset|structure\.shelfThickness)/;

  const MM_PER_IN = 25.4;
  function fmtLen(mm, units) {
    if (units === 'in') {
      const inches = mm / MM_PER_IN;
      // nearest 1/16", trimmed
      const sixteenths = Math.round(inches * 16);
      const whole = Math.floor(sixteenths / 16), rem = sixteenths % 16;
      if (!rem) return whole + '″';
      const div = (a, b) => { const g = (x, y) => y ? g(y, x % y) : x; const d = g(a, b); return (a / d) + '/' + (b / d); };
      return (whole ? whole + ' ' : '') + div(rem, 16) + '″';
    }
    return (Math.round(mm * 10) / 10) + ' mm';
  }
  function fmtValue(path, v, units) {
    if (typeof v === 'number' && MM_PATHS.test(path)) return fmtLen(v, units);
    if (typeof v === 'boolean') return v ? 'on' : 'off';
    if (v === undefined) return '—';
    if (typeof v === 'string') {
      if (K.WOOD_SPECIES[v]) return K.WOOD_SPECIES[v].label;
      if (K.JOINERY[v]) return K.JOINERY[v].label;
      const f = K.FINISHES.find(x => x.key === v);
      if (f) return f.label;
      return String(v).replace(/_/g, ' ');
    }
    return String(v);
  }
  function describeDiff(diffs, units) {
    return diffs.map(d => {
      const label = PATH_LABELS[d.path] || d.path;
      return `${label} ${fmtValue(d.path, d.from, units)} → ${fmtValue(d.path, d.to, units)}`;
    });
  }

  function snap(v, table) {
    let best = table[0];
    for (const t of table) if (Math.abs(t - v) < Math.abs(best - v)) best = t;
    return best;
  }
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const num = (v, fallback) => (typeof v === 'number' && isFinite(v) ? v : fallback);

  /* ---------------- correction ----------------
   * Takes any proposed spec (AI or manual), returns the corrected spec the
   * whole app runs on. Deterministic, idempotent, never throws.
   */
  function correctSpec(raw) {
    const template = TEMPLATES.includes(raw && raw.meta && raw.meta.template) ? raw.meta.template : 'table';
    const s = deepMerge(defaultSpec(template), raw || {});
    s.meta.template = template;
    if (!K.LEVELS.includes(s.meta.level)) s.meta.level = 'beginner';
    if (s.meta.units !== 'in') s.meta.units = 'mm';
    s.meta.name = String(s.meta.name || 'Untitled').slice(0, 60);

    const o = s.overall, st = s.structure;
    o.width = clamp(num(o.width, 1000), 250, 2400);
    o.depth = clamp(num(o.depth, 500), 200, 1200);
    o.height = clamp(num(o.height, 750), 120, 2400);

    if (!K.WOOD_SPECIES[s.wood.species] || K.WOOD_SPECIES[s.wood.species].sheet) s.wood.species = 'red_oak';
    s.wood.sheetSpecies = 'baltic_birch';

    st.topThickness = snap(clamp(num(st.topThickness, 25), 12, 45), K.SOLID_THICKNESS);
    st.legThickness = snap(clamp(num(st.legThickness, 70), 32, 100), [32, 38, 45, 60, 70, 80, 90, 100]);
    st.apronThickness = snap(clamp(num(st.apronThickness, 20), 15, 25), [15, 19, 20, 25]);
    st.apronHeight = clamp(num(st.apronHeight, 90), 60, 160);
    st.apronInset = clamp(num(st.apronInset, 12), 0, 30);
    st.shelfThickness = snap(clamp(num(st.shelfThickness, 19), 12, 32), K.SOLID_THICKNESS);
    st.sideThickness = snap(clamp(num(st.sideThickness, 18), 12, 25), [12, 15, 18, 19, 25]);
    st.shelfCount = clamp(Math.round(num(st.shelfCount, 0)), 0, 8);
    st.backPanel = !!st.backPanel;
    st.toeKick = template === 'cabinet' ? !!st.toeKick : false;

    // Geometry sanity: aprons and legs must fit under the top.
    st.apronHeight = Math.min(st.apronHeight, Math.max(40, o.height - st.topThickness - 60));
    st.legThickness = Math.min(st.legThickness, Math.floor(Math.min(o.width, o.depth) / 4));

    // Joint gating: code, not the model, enforces the level matrix.
    const lvl = s.meta.level;
    for (const kind of ['frame', 'case', 'box']) {
      if (!K.jointAllowed(s.joinery[kind], lvl, kind)) s.joinery[kind] = K.JOINT_DEFAULTS[lvl][kind];
    }
    if (!K.FINISHES.some(f => f.key === s.finish)) s.finish = 'wipe_poly';

    // Drawers: only templates with openings support them.
    if (s.drawers && (template === 'nightstand' || template === 'cabinet')) {
      const d = s.drawers;
      d.count = clamp(Math.round(num(d.count, 1)), 1, 4);
      d.frontStyle = d.frontStyle === 'overlay' ? 'overlay' : 'inset';
      d.runner = d.runner === 'wood_runners' ? 'wood_runners' : 'side_mount_slides';
      if (d.runner === 'wood_runners' && lvl === 'beginner') d.runner = 'side_mount_slides';
      // Reduce count until every opening clears the 80 mm minimum (correction
      // owns geometry; validation only reports what remains).
      while (d.count > 1 && BB.Parametric && BB.Parametric.openingHeightFor(s) < 80) d.count--;
    } else {
      s.drawers = null;
    }
    if (template === 'nightstand' && !s.drawers) s.drawers = { count: 1, frontStyle: 'inset', runner: 'side_mount_slides' };
    return s;
  }

  /* ---------------- validation ----------------
   * Pure report over the corrected spec + built model.
   * errors block generation; advisories are dismissible chips.
   */
  function validate(spec, model) {
    const errors = [], advisories = [];
    const t = spec.meta.template, o = spec.overall;
    const units = spec.meta.units;

    // Ergonomics advisories (never block).
    for (const row of K.ERGONOMICS) {
      if (!row.appliesTo.includes(t)) continue;
      if (row.axis === 'height' || row.axis === 'depth') {
        const v = o[row.axis];
        if (v < row.min || v > row.max) {
          const dir = v > row.max ? 'above' : 'below';
          advisories.push({
            id: 'ergo_' + row.key,
            text: `${fmtLen(v, units)} is ${dir} the typical ${fmtLen(row.min, units)}–${fmtLen(row.max, units)} ${row.label.toLowerCase()}. ${row.note}`
          });
        }
      }
    }

    // Wide solid top in a high-movement species.
    const sp = K.WOOD_SPECIES[spec.wood.species];
    const hasWideTop = ['table', 'desk', 'bench', 'nightstand', 'cabinet'].includes(t) && o.depth >= K.WIDE_TOP_MM;
    if (sp && sp.movement === 'high' && hasWideTop) {
      advisories.push({
        id: 'movement_' + sp.key,
        text: `${sp.label} moves a lot across the grain, and this top is ${fmtLen(o.depth, units)} wide. Fasten it with buttons or figure-8s — never glue a wide solid top down.`
      });
    }

    // Drawer geometry from the built model.
    if (model && model.openings) {
      for (const op of model.openings) {
        if (op.h < 80) errors.push({ id: 'op_h_' + op.index, text: `Drawer opening ${op.index + 1} is only ${fmtLen(op.h, units)} tall — the minimum workable opening is 80 mm. Reduce the drawer count or grow the piece.` });
        if (op.w > 750) advisories.push({ id: 'op_w_' + op.index, text: `A ${fmtLen(op.w, units)} drawer is wider than the ${fmtLen(750, units)} a single slide pair handles well. Consider two banks side by side.` });
      }
      if (spec.drawers && model.openings.length) {
        const topOp = model.openings[0];
        if (t === 'cabinet' && topOp.zTop > 1100) advisories.push({ id: 'pull_height', text: 'The top drawer sits above comfortable pull height (600–1100 mm). Fine for occasional storage.' });
      }
    }

    // Hard geometric errors.
    if (model && model.parts) {
      for (const p of model.parts) {
        if (p.size.w <= 0 || p.size.h <= 0 || p.size.d <= 0) {
          errors.push({ id: 'geom_' + p.id, text: `“${p.name}” computes to a non-positive dimension. The current sizes don’t leave room for it.` });
        }
      }
    } else if (!model) {
      errors.push({ id: 'no_model', text: 'The parametric layer could not build this spec.' });
    }

    // dedupe by id
    const seen = new Set();
    return {
      errors: errors.filter(e => !seen.has(e.id) && seen.add(e.id)),
      advisories: advisories.filter(a => !seen.has(a.id) && seen.add(a.id))
    };
  }

  BB.Spec = {
    TEMPLATES, defaultSpec, clone, deepMerge, diffSpecs, describeDiff,
    correctSpec, validate, fmtLen, fmtValue, PATH_LABELS, MM_PER_IN
  };
})();
