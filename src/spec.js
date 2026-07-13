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
  const Geo = BB.Geo;

  const TEMPLATES = ['table', 'desk', 'bench', 'bookshelf', 'nightstand', 'cabinet', 'custom'];
  const PRIMITIVES = ['post', 'rail', 'panel', 'slab', 'cylinder'];
  const SURFACES = ['none', 'seating', 'worktop', 'shelf'];

  /* ---------------- schema versioning (Phase 4) ----------------
   * Every corrected spec carries specVersion. Any stored spec is upgraded
   * through the migration registry on load — a saved design must never fail
   * to open. From Phase 4 forward, EVERY schema change adds a migration here.
   */
  const SPEC_VERSION = 4;
  const migrations = {
    /* v3 → v4: Phase 1–3 specs had no specVersion and no `custom` section.
     * Stamp the version, initialise custom to null, and normalise the legacy
     * `wood.sheetSpecies` field (v3 sometimes omitted it). */
    3: function (s) {
      const out = clone(s) || {};
      out.specVersion = 4;
      if (out.custom === undefined) out.custom = null;
      out.wood = out.wood || {};
      if (!out.wood.sheetSpecies) out.wood.sheetSpecies = 'baltic_birch';
      return out;
    }
  };
  function migrateSpec(raw) {
    if (!raw || typeof raw !== 'object') return raw;
    let s = raw;
    let v = typeof s.specVersion === 'number' ? s.specVersion : 3;
    let guard = 0;
    while (v < SPEC_VERSION && guard++ < 16) {
      const fn = migrations[v];
      if (!fn) break;
      s = fn(s);
      v = typeof s.specVersion === 'number' ? s.specVersion : v + 1;
    }
    return s;
  }

  /* ---------------- defaults ---------------- */
  /* Minimal valid composition for the custom template: a slab seat on two
   * rotated panel legs. Real designs come from the AI or a share code. */
  function defaultCustom() {
    return {
      parts: [
        { id: 'p1', role: 'seat', primitive: 'slab', dim: { l: 1100, w: 350, t: 38 }, pos: { x: 0, y: 449, z: 0 }, rot: null, grain: 'length', stock: 'solid', loadBearing: false, surface: 'seating' },
        { id: 'p2', role: 'leg_panel', primitive: 'panel', dim: { l: 350, w: 430, t: 38 }, pos: { x: -475, y: 215, z: 0 }, rot: { x: 0, y: 90, z: 0 }, grain: 'length', stock: 'solid', loadBearing: true, surface: 'none' },
        { id: 'p3', role: 'leg_panel', primitive: 'panel', dim: { l: 350, w: 430, t: 38 }, pos: { x: 475, y: 215, z: 0 }, rot: { x: 0, y: 90, z: 0 }, grain: 'length', stock: 'solid', loadBearing: true, surface: 'none' }
      ],
      connections: [
        { a: 'p2', b: 'p1', joint: 'butt_screws' },
        { a: 'p3', b: 'p1', joint: 'butt_screws' }
      ]
    };
  }

  function defaultSpec(template) {
    const base = {
      specVersion: SPEC_VERSION,
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
      drawers: null,
      custom: null
    };
    const t = base.meta.template;
    if (t === 'custom') {
      base.custom = defaultCustom();
      Object.assign(base.overall, { width: 1100, depth: 350, height: 468 });
      base.meta.name = 'Custom Piece';
    }
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
    'custom.parts': 'composition parts', 'custom.connections': 'connections',
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
    if (Array.isArray(v)) return v.length + ' item' + (v.length === 1 ? '' : 's');
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
  const r1 = v => Math.round(v * 10) / 10;

  /* ---------------- custom (novel) grammar ----------------
   * Primitive default orientations before rotation (the AI thinks in these,
   * code maps to 3D):
   *   post / cylinder: stand vertical — length is the height   (w=width, h=length, d=thickness)
   *   rail / panel:    run along x — length horizontal          (w=length, h=width, d=thickness)
   *   slab:            lie flat — thickness vertical            (w=length, h=thickness, d=width)
   */
  function customPartSize(p) {
    const d = p.dim;
    switch (p.primitive) {
      case 'post': return { w: d.w, h: d.l, d: d.t };
      case 'cylinder': return { w: d.w, h: d.l, d: d.w };
      case 'slab': return { w: d.l, h: d.t, d: d.w };
      default: return { w: d.l, h: d.w, d: d.t }; // rail, panel
    }
  }
  const asObB = p => Geo.partOBB({ size: customPartSize(p), pos: p.pos, rot: p.rot });

  /* Sanitize a proposed composition: clamp everything, snap stock, canonical
   * ids p1..pN, joint gating, then ground + center the whole piece. Silent,
   * deterministic, idempotent — validation reports whatever remains wrong. */
  function correctCustom(c, level) {
    const rawParts = Array.isArray(c && c.parts) ? c.parts : [];
    const parts = [];
    const idMap = new Map();
    rawParts.slice(0, 40).forEach((p, i) => {
      if (!p || typeof p !== 'object') return;
      const primitive = PRIMITIVES.includes(p.primitive) ? p.primitive : 'rail';
      const d = p.dim || p.dimensions || {};
      const stock = p.stock === 'sheet' ? 'sheet' : 'solid';
      const l = r1(clamp(num(d.l !== undefined ? d.l : d.length, 100), 10, 3000));
      const w = r1(clamp(num(d.w !== undefined ? d.w : d.width, 50), 5, 1500));
      let t = primitive === 'cylinder' ? w
        : snap(clamp(num(d.t !== undefined ? d.t : d.thickness, 19), 3, 200), stock === 'sheet' ? K.SHEET_THICKNESS : K.SOLID_THICKNESS);
      const pos = p.pos || p.position || {};
      let rot = null;
      const rr = p.rot || p.rotation;
      if (rr && typeof rr === 'object') {
        rot = { x: 0, y: 0, z: 0 };
        for (const k of ['x', 'y', 'z']) rot[k] = r1(clamp(num(rr[k], 0), -360, 360));
        if (!rot.x && !rot.y && !rot.z) rot = null;
      }
      const id = 'p' + (parts.length + 1);
      idMap.set(String(p.id !== undefined && p.id !== null ? p.id : id), id);
      parts.push({
        id,
        role: String(p.role || p.id || primitive).toLowerCase().trim().replace(/[\s-]+/g, '_').slice(0, 40) || primitive,
        primitive,
        dim: { l, w, t },
        pos: { x: r1(clamp(num(pos.x, 0), -3000, 3000)), y: r1(clamp(num(pos.y, 0), -3000, 3000)), z: r1(clamp(num(pos.z, 0), -3000, 3000)) },
        rot,
        grain: p.grain === 'width' || p.grainDirection === 'width' ? 'width' : 'length',
        stock,
        loadBearing: !!p.loadBearing,
        surface: SURFACES.includes(p.surface) ? p.surface : 'none'
      });
    });

    const conns = [];
    const seenPair = new Set();
    const rawConns = Array.isArray(c && c.connections) ? c.connections : [];
    for (const cn of rawConns.slice(0, 80)) {
      if (!cn || typeof cn !== 'object') continue;
      const a = idMap.get(String(cn.a !== undefined ? cn.a : cn.partA));
      const b = idMap.get(String(cn.b !== undefined ? cn.b : cn.partB));
      if (!a || !b || a === b) continue;
      const key = a < b ? a + '|' + b : b + '|' + a;
      if (seenPair.has(key)) continue;
      seenPair.add(key);
      const joint = K.jointAllowed(cn.joint, level) ? cn.joint : K.JOINT_DEFAULTS[level].frame;
      conns.push({ a, b, joint });
    }

    // Ground on the floor plane and center on x/z — silent code-owned fixes.
    if (parts.length) {
      let minY = Infinity, minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
      for (const p of parts) for (const corner of Geo.obbCorners(asObB(p))) {
        minY = Math.min(minY, corner[1]);
        minX = Math.min(minX, corner[0]); maxX = Math.max(maxX, corner[0]);
        minZ = Math.min(minZ, corner[2]); maxZ = Math.max(maxZ, corner[2]);
      }
      const dy = r1(minY), dx = r1((minX + maxX) / 2), dz = r1((minZ + maxZ) / 2);
      for (const p of parts) {
        if (Math.abs(dy) > 0.05) p.pos.y = r1(p.pos.y - dy);
        if (Math.abs(dx) > 0.05) p.pos.x = r1(p.pos.x - dx);
        if (Math.abs(dz) > 0.05) p.pos.z = r1(p.pos.z - dz);
      }
    }
    return { parts, connections: conns };
  }

  function customExtents(parts) {
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const p of parts) for (const c of Geo.obbCorners(asObB(p))) {
      minX = Math.min(minX, c[0]); maxX = Math.max(maxX, c[0]);
      minY = Math.min(minY, c[1]); maxY = Math.max(maxY, c[1]);
      minZ = Math.min(minZ, c[2]); maxZ = Math.max(maxZ, c[2]);
    }
    if (!isFinite(minX)) return { w: 100, d: 100, h: 100 };
    return { w: r1(maxX - minX), d: r1(maxZ - minZ), h: r1(maxY) };
  }

  /* ---------------- correction ----------------
   * Takes any proposed spec (AI or manual), returns the corrected spec the
   * whole app runs on. Deterministic, idempotent, never throws.
   */
  function correctSpec(raw) {
    raw = migrateSpec(raw);
    const template = TEMPLATES.includes(raw && raw.meta && raw.meta.template) ? raw.meta.template : 'table';
    const s = deepMerge(defaultSpec(template), raw || {});
    s.specVersion = SPEC_VERSION;
    s.meta.template = template;
    if (!K.LEVELS.includes(s.meta.level)) s.meta.level = 'beginner';
    if (s.meta.units !== 'in') s.meta.units = 'mm';
    s.meta.name = String(s.meta.name || 'Untitled').slice(0, 60);

    const o = s.overall, st = s.structure;
    if (template !== 'custom') {
      o.width = clamp(num(o.width, 1000), 250, 2400);
      o.depth = clamp(num(o.depth, 500), 200, 1200);
      o.height = clamp(num(o.height, 750), 120, 2400);
    }

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

    // Custom composition: sanitize the grammar, then derive overall from the
    // piece's true oriented extents (code owns the numbers, as always).
    if (template === 'custom') {
      s.custom = correctCustom(s.custom, s.meta.level);
      const ext = customExtents(s.custom.parts);
      s.overall = { width: ext.w, depth: ext.d, height: ext.h };
    } else {
      s.custom = null;
    }
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

    // Custom grammar hard rules: enough parts, nothing free-floating.
    if (t === 'custom') {
      const c = spec.custom || { parts: [], connections: [] };
      if (c.parts.length < 2) {
        errors.push({ id: 'custom_min', text: 'A custom piece needs at least two parts, each connected through an explicit joint.' });
      }
      const connected = new Set();
      for (const cn of c.connections) { connected.add(cn.a); connected.add(cn.b); }
      for (const p of c.parts) {
        if (!connected.has(p.id)) errors.push({ id: 'float_' + p.id, text: `Part “${p.role}” (${p.id}) appears in no connection — free-floating geometry is invalid.` });
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

    // dedupe by id and by identical text (e.g. the same advisory per opening)
    const seen = new Set(), seenText = new Set();
    const uniq = list => list.filter(x => {
      if (seen.has(x.id) || seenText.has(x.text)) return false;
      seen.add(x.id); seenText.add(x.text);
      return true;
    });
    return { errors: uniq(errors), advisories: uniq(advisories) };
  }

  BB.Spec = {
    TEMPLATES, PRIMITIVES, SURFACES, SPEC_VERSION, migrations, migrateSpec,
    defaultSpec, defaultCustom, clone, deepMerge, diffSpecs, describeDiff,
    correctSpec, validate, fmtLen, fmtValue, PATH_LABELS, MM_PER_IN,
    customPartSize, customExtents
  };
})();
