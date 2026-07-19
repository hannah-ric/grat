/* Blueprint Buddy — DesignSpec: schema, defaults, correction, validation, diffing.
 *
 * Architecture rule (Phase 1, still binding): the AI proposes intent as a spec
 * (or a partial-spec diff); THIS layer owns the corrected spec; geometry and all
 * derived plans are pure functions of the corrected spec.
 *
 * All lengths are millimetres internally. `meta.units` only affects display,
 * and every displayed length routes through BB.Units — the single boundary
 * where mm becomes text.
 */
var BB = globalThis.BB = globalThis.BB || {};

(function () {
  'use strict';
  const K = BB.K;
  const Geo = BB.Geo;
  const U = () => BB.Units;

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

  /* Template defaults are stored in mm (internal truth) but chosen as exact
   * inch multiples so a fresh design reads as clean fractions in the default
   * imperial display: 1524 = 60 in, 863.6 = 34 in, 736.6 = 29 in, … Heights
   * also keep (height − top)/2 on the 0.1 mm grid the parametric layer
   * rounds positions to, so legs land exactly on the floor. */
  function defaultSpec(template) {
    const base = {
      specVersion: SPEC_VERSION,
      meta: { name: 'Untitled', template: template || 'table', level: 'beginner', units: 'in' },
      overall: { width: 1524, depth: 863.6, height: 736.6 },
      wood: { species: 'red_oak', sheetSpecies: 'baltic_birch' },
      structure: {
        topThickness: 25, legThickness: 70, apronHeight: 90, apronThickness: 20,
        apronInset: 12, shelfCount: 0, shelfThickness: 19, sideThickness: 18,
        backPanel: true, toeKick: false
      },
      joinery: { frame: 'pocket_screws', case: 'butt_screws', box: 'pocket_screws' },
      finish: 'wipe_poly',
      hardware: { pull: 'bar_pull' },
      drawers: null,
      custom: null
    };
    const t = base.meta.template;
    if (t === 'custom') {
      base.custom = defaultCustom();
      Object.assign(base.overall, { width: 1100, depth: 350, height: 468 });
      base.meta.name = 'Custom Piece';
    }
    if (t === 'desk') Object.assign(base.overall, { width: 1320.8, depth: 660.4, height: 736.6 });
    if (t === 'bench') {
      Object.assign(base.overall, { width: 1219.2, depth: 381, height: 457.2 });
      Object.assign(base.structure, { topThickness: 32, legThickness: 60, apronHeight: 80 });
    }
    if (t === 'bookshelf') {
      Object.assign(base.overall, { width: 914.4, depth: 304.8, height: 1828.8 });
      base.structure.shelfCount = 4;
      // 36 in of fully-loaded books over 3/4 in stock sags visibly once creep
      // has its years (audit F-S0-2) — the default case ships 1 in shelves.
      base.structure.shelfThickness = 25;
    }
    if (t === 'nightstand') {
      Object.assign(base.overall, { width: 508, depth: 406.4, height: 609.6 });
      Object.assign(base.structure, { topThickness: 20, legThickness: 45, apronHeight: 80 });
      base.drawers = { count: 1, frontStyle: 'inset', runner: 'side_mount_slides' };
    }
    if (t === 'cabinet') {
      Object.assign(base.overall, { width: 812.8, depth: 457.2, height: 914.4 });
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
      if (p === 'custom' || p.startsWith('custom.')) continue; // summarized part-by-part below (B5)
      const va = get(a, p), vb = get(b, p);
      if (isObj(va) || isObj(vb)) continue;
      if (JSON.stringify(va) !== JSON.stringify(vb)) out.push({ path: p, from: va, to: vb });
    }
    out.push(...diffCustom(a, b));
    return out;
  }

  /* Custom compositions used to diff as one array leaf ("10 items → 10
   * items") — a full material flip or a joint change was invisible (B5).
   * Summarize part- and connection-level changes in human terms instead,
   * aggregating when the same change hits many parts. Entries may carry
   * `label` (chip title override) or `text` (a whole pre-built chip); numeric
   * dim entries keep raw mm so chips re-render on a display-unit switch. */
  function diffCustom(a, b) {
    const ca = (a && a.custom) || {};
    const cb = (b && b.custom) || {};
    const pa = Array.isArray(ca.parts) ? ca.parts : [];
    const pb = Array.isArray(cb.parts) ? cb.parts : [];
    if (!pa.length && !pb.length) return [];
    const out = [];
    if (pa.length !== pb.length) {
      out.push({ path: 'custom.parts', label: 'composition', from: pa.length + ' parts', to: pb.length + ' parts' });
    }
    const partName = p => (p.role && p.role !== p.primitive ? p.role : p.id);
    // A part's material is its stock resolved against that spec's wood choice.
    const stockLabel = (p, spec) => {
      const w = (spec && spec.wood) || {};
      const key = p.stock === 'sheet' ? (w.sheetSpecies || 'baltic_birch') : (w.species || 'red_oak');
      return (K.WOOD_SPECIES[key] && K.WOOD_SPECIES[key].label) || String(key).replace(/_/g, ' ');
    };
    // Per-part field diffs on parts present in both sides (canonical p1..pN
    // ids match by index). Positions are deliberately skipped: re-grounding
    // and re-centering shift every part and would drown the real changes.
    const n = Math.min(pa.length, pb.length);
    const FIELDS = [
      { key: 'stock', label: 'stock', get: p => p.stock, fmtFrom: c => stockLabel(c.pa, a), fmtTo: c => stockLabel(c.pb, b) },
      { key: 'primitive', label: 'primitive', get: p => p.primitive },
      { key: 'len', label: 'length', get: p => p.dim.l },
      { key: 'wid', label: 'width', get: p => p.dim.w },
      { key: 'thk', label: 'thickness', get: p => p.dim.t }
    ];
    for (const f of FIELDS) {
      const changed = [];
      for (let i = 0; i < n; i++) {
        if (JSON.stringify(f.get(pa[i])) !== JSON.stringify(f.get(pb[i]))) {
          changed.push({ pa: pa[i], pb: pb[i] });
        }
      }
      if (!changed.length) continue;
      const path = 'custom.part.' + f.key; // mm formatting keys off this prefix
      const vFrom = c => (f.fmtFrom ? f.fmtFrom(c) : f.get(c.pa));
      const vTo = c => (f.fmtTo ? f.fmtTo(c) : f.get(c.pb));
      const from0 = vFrom(changed[0]), to0 = vTo(changed[0]);
      const uniform = changed.every(c => JSON.stringify(vFrom(c)) === JSON.stringify(from0) &&
        JSON.stringify(vTo(c)) === JSON.stringify(to0));
      if (uniform && changed.length > 2) {
        const who = changed.length === n && pa.length === pb.length ? 'all parts' : changed.length + ' parts';
        out.push({ path, label: who + ' ' + f.label, from: from0, to: to0 });
      } else if (changed.length <= 4) {
        for (const c of changed) out.push({ path, label: partName(c.pb) + ' ' + f.label, from: vFrom(c), to: vTo(c) });
      } else {
        out.push({ path, text: changed.length + ' parts changed ' + f.label });
      }
    }
    // Connections: joint changes on surviving pairs, plus added/removed pairs.
    const pairKey = c => (c.a < c.b ? c.a + '|' + c.b : c.b + '|' + c.a);
    const mapA = new Map(), mapB = new Map();
    for (const c of (Array.isArray(ca.connections) ? ca.connections : [])) mapA.set(pairKey(c), c);
    for (const c of (Array.isArray(cb.connections) ? cb.connections : [])) mapB.set(pairKey(c), c);
    const byIdA = new Map(pa.map(p => [p.id, p])), byIdB = new Map(pb.map(p => [p.id, p]));
    const connName = (c, byId) => {
      const x = byId.get(c.a), y = byId.get(c.b);
      return (x ? partName(x) : c.a) + '–' + (y ? partName(y) : c.b);
    };
    const jointChanges = [], added = [], removed = [];
    for (const [k, cn] of mapB) {
      const prev = mapA.get(k);
      if (!prev) added.push(cn);
      else if (prev.joint !== cn.joint) jointChanges.push({ prev, cn });
    }
    for (const [k, cn] of mapA) if (!mapB.has(k)) removed.push(cn);
    if (jointChanges.length) {
      const jf0 = jointChanges[0].prev.joint, jt0 = jointChanges[0].cn.joint;
      const uniformJ = jointChanges.every(j => j.prev.joint === jf0 && j.cn.joint === jt0);
      if (uniformJ && jointChanges.length > 2) {
        out.push({ path: 'custom.joint', label: jointChanges.length + ' joints', from: jf0, to: jt0 });
      } else if (jointChanges.length <= 4) {
        for (const j of jointChanges) out.push({ path: 'custom.joint', label: connName(j.cn, byIdB) + ' joint', from: j.prev.joint, to: j.cn.joint });
      } else {
        out.push({ path: 'custom.joint', text: jointChanges.length + ' joints changed' });
      }
    }
    if (added.length) {
      if (added.length <= 2) for (const c of added) out.push({ path: 'custom.conn', text: 'joined ' + connName(c, byIdB) + ' (' + fmtValue('custom.joint', c.joint) + ')' });
      else out.push({ path: 'custom.conn', text: added.length + ' connections added' });
    }
    if (removed.length) {
      if (removed.length <= 2) for (const c of removed) out.push({ path: 'custom.conn', text: 'disconnected ' + connName(c, byIdA) });
      else out.push({ path: 'custom.conn', text: removed.length + ' connections removed' });
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
    'finish': 'finish', 'hardware.pull': 'pull style',
    'drawers.count': 'drawer count', 'drawers.frontStyle': 'drawer fronts', 'drawers.runner': 'drawer runners'
  };
  const MM_PATHS = /^(overall\.|structure\.(top|leg|apron|shelf|side)Thickness|structure\.apronHeight|structure\.apronInset|structure\.shelfThickness|custom\.part\.(len|wid|thk)$)/;

  /* Diff-chip / inspector value rendering. Lengths route through BB.Units —
   * the current display preference, NOT a per-call unit, decides the text. */
  function fmtValue(path, v) {
    if (typeof v === 'number' && MM_PATHS.test(path)) return U().fmtLength(v);
    if (typeof v === 'boolean') return v ? 'on' : 'off';
    if (v === undefined) return '—';
    if (Array.isArray(v)) return v.length + ' item' + (v.length === 1 ? '' : 's');
    if (typeof v === 'string') {
      if (K.WOOD_SPECIES[v]) return K.WOOD_SPECIES[v].label;
      if (K.JOINERY[v]) return K.JOINERY[v].label;
      const f = K.FINISHES.find(x => x.key === v);
      if (f) return f.label;
      if (BB.HW && BB.HW.PULLS[v]) return BB.HW.PULLS[v].label;
      return String(v).replace(/_/g, ' ');
    }
    return String(v);
  }
  function describeDiff(diffs) {
    return diffs.map(d => {
      if (d.text) return d.text; // pre-built chip (custom composition summary)
      const label = d.label || PATH_LABELS[d.path] || d.path;
      return `${label} ${fmtValue(d.path, d.from)} → ${fmtValue(d.path, d.to)}`;
    });
  }

  /* ---------------- ack reconciliation (A2, merges B4/C4; G9) ----------------
   * The chat ack is the model's FIRST "explain", shown after correction,
   * validation-refinement, and critique rounds may have changed or reverted
   * what it describes. Code — never the model — checks the enumerated
   * contradiction classes seen live and appends the code-built truth:
   *   - a species word that isn't the delivered wood ("hard maple" over soft maple)
   *   - an "X-free" claim over a material the build actually uses (G9/C7)
   *   - a drawer-count numeral vs the delivered drawers ("three drawers" over 2)
   *   - leg words on a legless design ("splayed legs" on a bookshelf)
   *   - mechanism words (hinge/fold/pivot/lift-off) no artifact contains
   *   - building-attachment claims (cleat / screwed-to-wall / hangs from the
   *     ceiling) with no matching artifact in the spec (G9/A3/B14)
   *   - stock-source claims ("uses only your deck boards") no plan can honor (G9/C2)
   *   - a requested dimension that did not survive to the final spec (B4)
   *   - a structure number the explain pins to a leg/apron/top that correction
   *     silently clamped away (G9/C4)
   *   - a requested change that changed nothing (the false-ack surface)
   * plus a caveat naming wire keys the codec ignored (C4).
   * Pure: (explain, correctedSpec, chips, requested) -> ack text.
   * requested = { patch: verbose patch of the shown reply, ignored: [keys] }. */
  function reconcileAck(explain, spec, chips, requested) {
    let text = String(explain || '').trim();
    if (!text || !spec) return text;
    const low = ' ' + text.toLowerCase().replace(/[’]/g, "'") + ' ';
    const fixes = [];
    // A mention is honest when its own clause already negates it ("no hinges",
    // "a hinged lid isn't expressible") — never "correct" honesty.
    const NEG = /\b(no|not|never|nothing|without|can't|cannot|isn't|aren't|won't|doesn't|don't|instead of|rather than|unable|lacks?|omit(?:ted|s)?)\b/;
    const clauseAt = i => {
      const before = low.slice(0, i).split(/[,.;:!?()]|\s[—–-]\s/).pop();
      const after = low.slice(i).split(/[,.;:!?()]|\s[—–-]\s/)[0];
      return before + after;
    };
    const mentioned = rx => {
      const m = rx.exec(low);
      return m ? !NEG.test(clauseAt(m.index)) : false;
    };
    const rxWord = nm => new RegExp('\\b' + nm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/[\s-]+/g, '[\\s-]+') + '\\b');

    // 1. Species words vs the delivered wood (solid or sheet).
    {
      const actual = K.WOOD_SPECIES[spec.wood && spec.wood.species];
      const sheetSp = K.WOOD_SPECIES[spec.wood && spec.wood.sheetSpecies];
      const okNames = []
        .concat(actual ? [actual.label.toLowerCase()].concat(actual.aliases || []) : [])
        .concat(sheetSp ? [sheetSp.label.toLowerCase()].concat(sheetSp.aliases || []) : []);
      const candidates = [];
      for (const s of Object.values(K.WOOD_SPECIES)) {
        if (spec.wood && (s.key === spec.wood.species || s.key === spec.wood.sheetSpecies)) continue;
        for (const nm of [s.label.toLowerCase()].concat(s.aliases || [])) candidates.push(nm);
      }
      candidates.sort((x, y) => y.length - x.length); // "hard maple" beats "maple"
      for (const nm of candidates) {
        if (!mentioned(rxWord(nm))) continue;
        // A generic word inside the real species' name ("maple" when the
        // delivered wood is soft maple) is not a contradiction.
        if (okNames.some(o => o.includes(nm) || nm.includes(o))) break;
        if (actual) fixes.push('the delivered wood is ' + actual.label.toLowerCase());
        break;
      }
    }

    // 1b. "X-free" claims over a material the build actually uses (G9/C7):
    // the "-free" suffix negates its own noun, so the NEG grammar reads the
    // clause as honest — parse the suffix form explicitly. Solid stock is
    // always in the build; sheet stock only when the spec actually yields
    // sheet parts (carcass back panels, drawer bottoms, sheet custom parts).
    {
      const t = spec.meta && spec.meta.template;
      const usesSheet = t === 'custom'
        ? ((spec.custom && spec.custom.parts) || []).some(p => p.stock === 'sheet')
        : !!(spec.drawers && spec.drawers.count) ||
          ((t === 'bookshelf' || t === 'cabinet') && spec.structure && spec.structure.backPanel);
      const solidSp = K.WOOD_SPECIES[spec.wood && spec.wood.species];
      const sheetSp = K.WOOD_SPECIES[spec.wood && spec.wood.sheetSpecies];
      const inUse = [];
      if (solidSp) inUse.push({ sp: solidSp, names: [solidSp.label.toLowerCase()].concat(solidSp.aliases || []) });
      if (usesSheet && sheetSp) {
        const names = [sheetSp.label.toLowerCase()].concat(sheetSp.aliases || []);
        // Family words: any ply sheet answers to "plywood"/"ply".
        if (names.some(nm => /\bply\b|plywood/.test(nm))) names.push('plywood', 'ply');
        inUse.push({ sp: sheetSp, names });
      }
      const rxFree = nm => new RegExp('\\b' + nm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/[\s-]+/g, '[\\s-]+') + '[\\s-]?free\\b');
      let hit = null;
      for (const u of inUse) {
        for (const nm of u.names) {
          const m = rxFree(nm).exec(low);
          if (m && !NEG.test(clauseAt(m.index))) { hit = { nm, sp: u.sp }; break; }
        }
        if (hit) break;
      }
      if (hit) fixes.push('not ' + hit.nm + '-free — the delivered design uses ' + hit.sp.label.toLowerCase());
    }

    // 2. Drawer-count numerals vs the delivered drawers.
    let drawerFixed = false;
    {
      const m = /\b(\d+|one|two|three|four)\s+drawers?\b/.exec(low);
      if (m && !NEG.test(clauseAt(m.index))) {
        const WORDS = { one: 1, two: 2, three: 3, four: 4 };
        const n = WORDS[m[1]] || parseInt(m[1], 10);
        const have = spec.drawers ? spec.drawers.count : 0;
        if (isFinite(n) && n !== have) {
          fixes.push(have ? 'the delivered design has ' + have + ' drawer' + (have === 1 ? '' : 's') : 'no drawers in this design');
          drawerFixed = true;
        }
      }
    }

    // 3. Leg words on a legless design.
    {
      let hasLegs = ['table', 'desk', 'bench', 'nightstand'].includes(spec.meta && spec.meta.template);
      if (spec.meta && spec.meta.template === 'custom' && spec.custom) {
        hasLegs = (spec.custom.parts || []).some(p => /leg/.test(p.role || '') || p.primitive === 'post' || p.primitive === 'cylinder');
      }
      if (!hasLegs && mentioned(/\blegs?\b/)) fixes.push('no legs in this design');
    }

    // 4. Mechanism words no artifact can contain (kd_bolt is the only
    // non-permanent joint, so an honest lift-off claim needs one).
    {
      const hasKD = ['frame', 'case', 'box'].some(k => spec.joinery && spec.joinery[k] === 'kd_bolt') ||
        ((spec.custom && spec.custom.connections) || []).some(c => c.joint === 'kd_bolt');
      if (mentioned(/\b(hinged?|hinges|pivot(?:s|ing)?|fold(?:s|ing|able)?(?:[\s-](?:down|out|up|flat))?)\b/)) {
        fixes.push('nothing hinges, folds, or pivots in this plan — every connection is fixed' + (hasKD ? ' or bolted (kd_bolt)' : ''));
      } else if (!hasKD && mentioned(/\blifts?[\s-]?off\b/)) {
        fixes.push('the lid/top is permanently fastened — no lift-off connection exists in this plan');
      }
    }

    // 4b. Building-attachment claims (G9/A3/B14): no deliverable spec ever
    // fastens to the building — correction refuses external joints inside
    // custom graphs, template cleats join parts to parts, and the one
    // modeled wall item is the integrity-mandated anti-tip strap (which is
    // a strap, not a mount). A positive cleat/mount/hang claim over a spec
    // with no matching artifact gets the code truth appended.
    {
      const isCustom = spec.meta && spec.meta.template === 'custom';
      const hasCleat = isCustom
        ? ((spec.custom && spec.custom.parts) || []).some(p => /cleat/.test(p.role || '')) ||
          ((spec.custom && spec.custom.connections) || []).some(c => c.joint === 'french_cleat')
        : ['frame', 'case', 'box'].some(k => spec.joinery && spec.joinery[k] === 'french_cleat');
      const BUILDING = '(columns?|walls?|ceilings?|studs?|joists?|rafters?|masonry|brick)';
      const mountRx = new RegExp('\\b(?:screw(?:ed|s)?|bolt(?:ed|s)?|lag(?:ged)?|mount(?:ed|s)?|attach(?:ed|es)?|fasten(?:ed|s)?|hangs?|hung|suspend(?:ed|s)?)\\b[^.;:!?]{0,40}?\\b' + BUILDING + '\\b');
      const styleRx = new RegExp('\\b' + BUILDING + '[\\s-](?:mounted|mount|hung|suspended)\\b');
      const target = w => (/^column/.test(w) ? 'column' : /^(ceiling|joist|rafter)/.test(w) ? 'ceiling' : 'wall');
      const cleatM = /\bfrench[\s-]+cleats?\b/.exec(low);
      if (!hasCleat && cleatM && !NEG.test(clauseAt(cleatM.index))) {
        fixes.push('no french cleat exists in this plan — the only building attachment this tool ever adds is the anti-tip strap');
      } else {
        const m = mountRx.exec(low) || styleRx.exec(low);
        if (m) {
          const clause = clauseAt(m.index);
          const noun = m[1];
          const pre = low.slice(Math.max(0, m.index + m[0].lastIndexOf(noun) - 20), m.index + m[0].lastIndexOf(noun));
          // "planter walls", "case sides" name parts, not the building; the
          // anti-tip strap's own wall instruction is honest hardware talk.
          const partNoun = /(planter|box|drawer|case|cabinet|screen|divider|side)\s+$/.test(pre);
          if (!NEG.test(clause) && !/anti[\s-]?tip|strap/.test(clause) && !partNoun) {
            fixes.push('no ' + target(noun) + ' attachment exists in this plan — the piece stands free on the floor; the only building attachment this tool ever adds is the anti-tip strap');
          }
        }
      }
    }

    // 4c. Stock-source claims (G9/C2): no wire field, spec field, or packer
    // input can represent boards the user already owns — every stock plan
    // shops the catalog, so a reuse claim is never true of the delivered plan.
    {
      const c1 = /\bonly\s+(?:your|my)\b[^.;:!?]{0,30}?\b(?:boards?|lumber|stock|planks?|wood|decking)\b/;
      const c2 = /\b(?:uses?|using|built|builds?|made|reuses?|reusing|repurposes?|repurposing)\s+only\b[^.;:!?]{0,30}?\b(?:reclaimed|leftover|salvaged|scrap|on[\s-]hand|existing)\b/;
      const c3 = /\bno\s+(?:dimensional|new|store[\s-]bought|fresh|additional|extra)\s+(?:lumber|boards?|stock|wood)\b/;
      const reuseCtx = /\b(?:your|my|reclaimed|leftover|salvaged|scrap|on[\s-]hand|deck\s+boards?)\b/;
      if (mentioned(c1) || mentioned(c2) || (c3.test(low) && reuseCtx.test(low))) {
        fixes.push('the stock plan buys catalog lumber — designing onto on-hand boards isn’t modeled yet');
      }
    }

    // 5. Requested values that did not survive to the delivered spec (B4).
    const patch = requested && requested.patch;
    if (patch && patch.overall && spec.overall) {
      for (const dim of ['width', 'depth', 'height']) {
        const want = patch.overall[dim];
        if (typeof want !== 'number' || !isFinite(want)) continue;
        const got = spec.overall[dim];
        if (typeof got === 'number' && Math.abs(want - got) > 5) {
          fixes.push(dim + ' is ' + U().fmtLength(got) + ', not the proposed ' + U().fmtLength(want));
        }
      }
    }
    if (!drawerFixed && patch && patch.drawers && typeof patch.drawers.count === 'number') {
      const have = spec.drawers ? spec.drawers.count : 0;
      if (patch.drawers.count !== have) {
        fixes.push(have ? 'the delivered design has ' + have + ' drawer' + (have === 1 ? '' : 's') : 'no drawers in this design');
      }
    }

    // 5b. Structure-dimension claims (G9/C4): a number the explain pins to a
    // leg/apron/top/shelf/side that differs >2 mm from the delivered
    // structure value gets the delivered number appended — correction clamps
    // silently, and the stock story ("aprons doubled-up 2x6") must not
    // outlive the geometry. Conservative by construction: explicit mm/in
    // numbers only, thickness-class magnitudes only (≤120 mm), bound claims
    // ("well under 254mm", "≤70mm") and delta claims ("50.8 mm deeper")
    // skipped, and an apron number matching the apron HEIGHT is a true
    // claim too. Custom parts carry their own dims — template-only.
    if (spec.meta && spec.meta.template !== 'custom' && spec.structure) {
      const st = spec.structure;
      const DIMS = [
        { rx: 'legs?', vals: [st.legThickness], got: st.legThickness, name: 'leg thickness' },
        { rx: 'aprons?', vals: [st.apronThickness, st.apronHeight], got: st.apronThickness, name: 'apron thickness' },
        { rx: 'top|seat', vals: [st.topThickness], got: st.topThickness, name: 'top thickness' },
        { rx: 'shelf|shelves', vals: [st.shelfThickness], got: st.shelfThickness, name: 'shelf thickness' },
        { rx: 'sides?', vals: [st.sideThickness], got: st.sideThickness, name: 'side thickness' }
      ];
      const BOUND = /(?:under|below|within|up\s+to|at\s+most|less\s+than|max(?:imum)?|over|above|at\s+least|more\s+than|[≤<≥>])\s*(?:the\s+|a\s+|an\s+)?[~≈]?\s*$/;
      const DELTA = /^\s*(?:deeper|wider|taller|longer|shorter|narrower|thicker|thinner|higher|lower)\b/;
      const numRx = /(\d+(?:\.\d+)?)\s*(mm\b|millimet\w*|in\b|inch(?:es)?\b|["”])/g;
      let m;
      while ((m = numRx.exec(low))) {
        const v = parseFloat(m[1]);
        const mmVal = /^(?:in\b|inch|["”])/.test(m[2]) ? v * 25.4 : v;
        if (!isFinite(mmVal) || mmVal <= 0 || mmVal > 120) continue;
        if (BOUND.test(low.slice(Math.max(0, m.index - 16), m.index))) continue;
        // A noun binds its number only inside the same clause: ahead stops at
        // any clause break ("(70mm), seat slats…" must not bind 70 to the
        // seat), while backward context survives an opening paren ("legs …
        // (50mm)" is one claim).
        const aheadRaw = low.slice(m.index + m[0].length, m.index + m[0].length + 20).split(/[.;:!?,()]/)[0];
        if (DELTA.test(low.slice(m.index + m[0].length, m.index + m[0].length + 20).split(/[.;:!?]/)[0])) continue;
        const back = low.slice(Math.max(0, m.index - 48), m.index).split(/[.;:!?,]/).pop();
        let best = null;
        for (const d of DIMS) {
          const rxG = new RegExp('\\b(?:' + d.rx + ')\\b', 'g');
          let dist = Infinity, bm;
          while ((bm = rxG.exec(back))) dist = back.length - (bm.index + bm[0].length);
          const am = new RegExp('\\b(?:' + d.rx + ')\\b').exec(aheadRaw);
          if (am && am.index < dist) dist = am.index;
          if (dist < (best ? best.dist : Infinity)) best = { d, dist };
        }
        if (!best) continue;
        const delivered = best.d.vals.filter(x => typeof x === 'number' && isFinite(x));
        if (!delivered.length || delivered.some(x => Math.abs(x - mmVal) <= 2)) continue;
        const fixTxt = best.d.name + ' is ' + U().fmtLength(best.d.got) + ', not the claimed ' + U().fmtLength(mmVal);
        if (!fixes.includes(fixTxt)) fixes.push(fixTxt);
      }
    }

    // 6. A requested change that changed nothing at all.
    if ((!chips || !chips.length) && !fixes.length && patch && Object.keys(patch).length) {
      fixes.push('nothing in the delivered design actually changed');
    }

    let out = text;
    if (fixes.length) out = out.replace(/[.\s]*$/, '') + '. Actually: ' + fixes.join('; ') + '.';
    const ign = requested && Array.isArray(requested.ignored) ? requested.ignored.filter(Boolean) : [];
    if (ign.length) out += ' (I couldn’t express and ignored: ' + ign.slice(0, 4).join(', ') + '.)';
    return out;
  }

  /* Integrity honesty line for the chat ack (A3): a failing verdict is never
   * hidden behind a cheerful blurb, whatever the commit source. Photo flows
   * keep their fuller phrasing (proportions were estimated, so even a clean
   * report is worth stating). */
  function integrityLine(summary, opts) {
    if (!summary) return '';
    if (opts && opts.photo) {
      const t = summary.fails ? summary.fails + ' fail(s)' : summary.advisories ? summary.advisories + ' advisory(ies)' : 'all checks pass';
      return ` Integrity: ${t} — full report in the Safety tab.`;
    }
    return summary.fails
      ? ` Integrity: ${summary.fails} failing check${summary.fails > 1 ? 's' : ''} — see the Safety tab before building.`
      : '';
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
      // Solid parts snap to POST_THICKNESS (up to 100 mm): the stock planner
      // laminates anything over 45, so thick legs survive (audit F-S2-6).
      let t = primitive === 'cylinder' ? w
        : snap(clamp(num(d.t !== undefined ? d.t : d.thickness, 19), 3, 200), stock === 'sheet' ? K.SHEET_THICKNESS : K.POST_THICKNESS);
      const pos = p.pos || p.position || {};
      let rot = null;
      const rr = p.rot || p.rotation;
      if (rr && typeof rr === 'object') {
        rot = { x: 0, y: 0, z: 0 };
        for (const k of ['x', 'y', 'z']) {
          let v = r1(clamp(num(rr[k], 0), -360, 360));
          // Snap near-square rotations: a part 1–2° off axis is a sloppy
          // proposal, not design intent — left alone it reads as a rogue
          // diagonal board. Deliberate angles (> 2.5° off square) survive.
          const sq = Math.round(v / 90) * 90;
          if (Math.abs(v - sq) <= 2.5) v = Math.abs(sq) === 360 ? 0 : sq;
          rot[k] = v;
        }
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

    /* Joint KIND for a custom pair, derived from the primitives: any pair
     * involving a stick (post/rail/cylinder) is frame territory (sticks
     * meeting sheets also take case-style attachment — a shelf dadoed into
     * a post); two sheet-like parts (panel/slab) may take case, panel, or
     * box joinery. A joint whose kinds never intersect the pair's — or an
     * `external` joint whose mate is the building, not a part (french
     * cleat) — is replaced by the level default for the pair, exactly as
     * template slots are gated. Before this, a beginner custom could put a
     * french cleat between a leg and a seat and the setout would tell a
     * freestanding bench to find studs. */
    const STICKS = ['post', 'rail', 'cylinder'];
    const pairKinds = (pa, pb) => {
      const aS = STICKS.includes(pa.primitive), bS = STICKS.includes(pb.primitive);
      if (aS && bS) return ['frame'];
      if (aS || bS) return ['frame', 'case'];
      return ['case', 'panel', 'box'];
    };
    const byNewId = new Map(parts.map(p => [p.id, p]));
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
      const kinds = pairKinds(byNewId.get(a), byNewId.get(b));
      const j = K.JOINERY[cn.joint];
      const okJoint = j && !j.external && K.jointAllowed(cn.joint, level) &&
        j.kinds.some(k => kinds.includes(k));
      const joint = okJoint ? cn.joint
        : K.JOINT_DEFAULTS[level][kinds.includes('frame') ? 'frame' : 'case'];
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

  /* World grain axis + grain-run length for a custom part (audit F-S2-7).
   * Primitive local axes follow customPartSize: post/cylinder length is local
   * Y, rail/panel/slab length is local X; 'width' grain swaps to the width
   * dimension's axis. */
  function customGrainInfo(p) {
    const d = p.dim;
    let axisLocal, len;
    if (p.primitive === 'post' || p.primitive === 'cylinder') {
      if (p.grain === 'width') { axisLocal = [1, 0, 0]; len = d.w; }
      else { axisLocal = [0, 1, 0]; len = d.l; }
    } else if (p.primitive === 'slab') {
      if (p.grain === 'width') { axisLocal = [0, 0, 1]; len = d.w; }
      else { axisLocal = [1, 0, 0]; len = d.l; }
    } else { // rail, panel
      if (p.grain === 'width') { axisLocal = [0, 1, 0]; len = d.w; }
      else { axisLocal = [1, 0, 0]; len = d.l; }
    }
    const r = p.rot || { x: 0, y: 0, z: 0 };
    const R = Geo.rotMat(r.x || 0, r.y || 0, r.z || 0);
    return { axis: Geo.mulMV(R, axisLocal), len };
  }
  /* True when the connection to `mate` bears on p's END GRAIN: the mate sits
   * at or beyond the outer quarter of p's grain run. */
  function endGrainBearing(p, mate) {
    const g = customGrainInfo(p);
    if (!g.len) return false;
    const d = [mate.pos.x - p.pos.x, mate.pos.y - p.pos.y, mate.pos.z - p.pos.z];
    return Math.abs(Geo.dot3(d, g.axis)) > 0.75 * (g.len / 2);
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

  /* Scale a custom composition to a target overall size (B3). Custom overall
   * is DERIVED from part extents, so an overall-only refinement would be a
   * silent no-op — instead code scales the composition: positions per world
   * axis (about the floor plane and x/z center), and each part dim by the
   * world axis its local dimension dominantly spans (same local axes as
   * customPartSize, rotated by the part's rot). Thickness re-snaps in
   * correctCustom. Returns new {parts, connections} or null when there is
   * nothing to scale. */
  const SCALE_LOCAL_AXES = {
    post: { l: [0, 1, 0], w: [1, 0, 0], t: [0, 0, 1] },
    cylinder: { l: [0, 1, 0], w: [1, 0, 0], t: [1, 0, 0] },
    slab: { l: [1, 0, 0], w: [0, 0, 1], t: [0, 1, 0] },
    rail: { l: [1, 0, 0], w: [0, 1, 0], t: [0, 0, 1] },
    panel: { l: [1, 0, 0], w: [0, 1, 0], t: [0, 0, 1] }
  };
  function scaleCustom(spec, target) {
    if (!spec || !spec.custom || !Array.isArray(spec.custom.parts) || !spec.custom.parts.length) return null;
    const cur = customExtents(spec.custom.parts);
    const f = {
      x: num(target && target.width, 0) > 0 && cur.w > 0 ? clamp(target.width / cur.w, 0.05, 20) : 1,
      y: num(target && target.height, 0) > 0 && cur.h > 0 ? clamp(target.height / cur.h, 0.05, 20) : 1,
      z: num(target && target.depth, 0) > 0 && cur.d > 0 ? clamp(target.depth / cur.d, 0.05, 20) : 1
    };
    if (Math.abs(f.x - 1) < 1e-4 && Math.abs(f.y - 1) < 1e-4 && Math.abs(f.z - 1) < 1e-4) return null;
    const out = clone(spec.custom);
    for (const p of out.parts) {
      const r = p.rot || { x: 0, y: 0, z: 0 };
      const R = Geo.rotMat(r.x || 0, r.y || 0, r.z || 0);
      const axes = SCALE_LOCAL_AXES[p.primitive] || SCALE_LOCAL_AXES.rail;
      const scaled = {};
      for (const dk of ['l', 'w', 't']) {
        const v = Geo.mulMV(R, axes[dk]);
        const ax = Math.abs(v[0]) >= Math.abs(v[1]) - 1e-9 && Math.abs(v[0]) >= Math.abs(v[2]) - 1e-9 ? 'x'
          : (Math.abs(v[1]) >= Math.abs(v[2]) - 1e-9 ? 'y' : 'z');
        scaled[dk] = r1(p.dim[dk] * f[ax]);
      }
      p.dim = scaled;
      p.pos = { x: r1(p.pos.x * f.x), y: r1(p.pos.y * f.y), z: r1(p.pos.z * f.z) };
    }
    return out;
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
    // Imperial is the default; only an explicit metric choice stays metric.
    if (s.meta.units !== 'mm') s.meta.units = 'in';
    s.meta.name = String(s.meta.name || 'Untitled').slice(0, 60);

    const o = s.overall, st = s.structure;
    if (template !== 'custom') {
      o.width = clamp(num(o.width, 1000), 250, 2400);
      o.depth = clamp(num(o.depth, 500), 200, 1200);
      o.height = clamp(num(o.height, 750), 120, 2400);
    }

    if (!K.WOOD_SPECIES[s.wood.species] || K.WOOD_SPECIES[s.wood.species].sheet) s.wood.species = 'red_oak';
    // Sheet stock is its own choice (2026 expansion): any `sheet: true`
    // species is valid; anything else — including a solid species — snaps
    // back to the Baltic default.
    const sheetSp = K.WOOD_SPECIES[s.wood.sheetSpecies];
    if (!sheetSp || !sheetSp.sheet) s.wood.sheetSpecies = 'baltic_birch';

    st.topThickness = snap(clamp(num(st.topThickness, 25), 12, 45), K.SOLID_THICKNESS);
    // Legs snap to the SAME post-stock table custom posts use (values below
    // the 32 mm clamp floor can never win the nearest-match) — one table,
    // not a hand-copied twin that drifts.
    st.legThickness = snap(clamp(num(st.legThickness, 70), 32, 100), K.POST_THICKNESS);
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
    // When the footprint caps the legs, snap DOWN to the largest post-stock
    // value that still fits (audit E-04): a bare geometric clamp after the
    // stock snap left off-table values (300×250 → 62) that drifted to 60 on
    // the next correction pass — one pass must land on-table and stay put.
    const legCap = Math.floor(Math.min(o.width, o.depth) / 4);
    if (st.legThickness > legCap) {
      st.legThickness = K.POST_THICKNESS.filter(t => t <= legCap).pop() || K.POST_THICKNESS[0];
    }

    // Joint gating: code, not the model, enforces the level matrix.
    const lvl = s.meta.level;
    for (const kind of ['frame', 'case', 'box']) {
      if (!K.jointAllowed(s.joinery[kind], lvl, kind)) s.joinery[kind] = K.JOINT_DEFAULTS[lvl][kind];
    }
    if (!K.FINISHES.some(f => f.key === s.finish)) s.finish = 'wipe_poly';

    // Hardware style intent (2026 expansion): the AI proposes a pull STYLE;
    // code owns every count, size, spacing, and bore (BB.HW).
    s.hardware = s.hardware && typeof s.hardware === 'object' ? s.hardware : {};
    if (!BB.HW || !BB.HW.PULLS[s.hardware.pull]) s.hardware.pull = 'bar_pull';

    // Drawers: only templates with openings support them.
    if (s.drawers && (template === 'nightstand' || template === 'cabinet')) {
      const d = s.drawers;
      d.count = clamp(Math.round(num(d.count, 1)), 1, 4);
      d.frontStyle = d.frontStyle === 'overlay' ? 'overlay' : 'inset';
      d.runner = ['wood_runners', 'undermount_slides'].includes(d.runner) ? d.runner : 'side_mount_slides';
      // Fussier running gear is gated past beginner: wood runners need
      // fitting, undermounts forgive nothing (box built to the slide).
      if (d.runner !== 'side_mount_slides' && lvl === 'beginner') d.runner = 'side_mount_slides';
      // Reduce count until every opening clears the 80 mm minimum (correction
      // owns geometry; validation only reports what remains).
      while (d.count > 1 && BB.Parametric && BB.Parametric.openingHeightFor(s) < 80) d.count--;
    } else {
      s.drawers = null;
    }
    if (template === 'nightstand' && !s.drawers) s.drawers = { count: 1, frontStyle: 'inset', runner: 'side_mount_slides' };

    // Reduce shelf count until every shelf clears its neighbors by at least
    // a usable gap — overlapping shelves are rogue geometry, and correction
    // owns geometry. (Runs after drawers: the bank shrinks the shelf zone.)
    while (st.shelfCount > 0 && BB.Parametric && BB.Parametric.shelfSpacingFor(s) < st.shelfThickness + 20) st.shelfCount--;

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

  /* ---------------- geometric buildability audit ----------------
   * Hard, template-agnostic invariants over the BUILT model. Every design —
   * template, custom, share-code import, photo estimate — must clear these
   * before it can be adopted: nothing below the floor, nothing floating in
   * the air, nothing outside the declared envelope, no rogue overlap between
   * unjointed parts, every declared joint physically touching, and a floor
   * footprint the center of gravity actually sits inside. Failures are
   * validate() ERRORS, so commit() refuses them on every path (chat, photo,
   * share code, sliders) and the last valid design stays untouched.
   */
  const AUDIT = {
    BELOW_EPS: 0.5,      // mm a part may dip below the floor plane
    FLOOR_EPS: 2,        // mm the lowest part may hover above the floor
    ENVELOPE_EPS: 2,     // mm of tolerance on the overall bounding envelope
    FRONT_PROUD_MAX: 60, // mm pulls / applied fronts may stand proud (+z)
    PEN_EPS: 2,          // mm unjointed parts may interpenetrate
    CONTACT_GAP: 5,      // mm within which jointed parts must touch
    FOOT_Y: 5,           // a part grounds if its lowest corner is under this
    FOOT_PT_Y: 30        // corners under this height count as floor contact
  };
  const PROUD_ROLES = { pull: true, drawer_front: true }; // stand proud of the case front by design

  function auditModel(spec, model) {
    const errors = [];
    if (!model || !Array.isArray(model.parts) || !model.parts.length) return errors;
    const parts = model.parts;
    const b = model.bounds || spec.overall && { w: spec.overall.width, d: spec.overall.depth, h: spec.overall.height };
    if (!b) return errors;
    if (parts.some(p => p.size.w <= 0 || p.size.h <= 0 || p.size.d <= 0)) return errors; // degenerate sizes already reported
    const fine = mm => U().fmtSmall(mm);

    const boxes = new Map(), corners = new Map(), minY = new Map();
    for (const p of parts) {
      const obb = Geo.partOBB(p);
      boxes.set(p.id, obb);
      const cs = Geo.obbCorners(obb);
      corners.set(p.id, cs);
      minY.set(p.id, Math.min(...cs.map(c => c[1])));
    }
    // World-axis bounds per part, for gap messages the model (and user) can
    // act on numerically (A9).
    const aabbOf = id => {
      const cs = corners.get(id);
      const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
      for (const c of cs) for (let ax = 0; ax < 3; ax++) {
        min[ax] = Math.min(min[ax], c[ax]); max[ax] = Math.max(max[ax], c[ax]);
      }
      return { min, max };
    };

    // 1. The floor plane is real: nothing passes through it, something rests on it.
    let globalMinY = Infinity;
    for (const p of parts) {
      const my = minY.get(p.id);
      globalMinY = Math.min(globalMinY, my);
      if (my < -AUDIT.BELOW_EPS) {
        errors.push({ id: 'geom_below:' + p.id, text: `“${p.name}” (${p.id}) extends ${fine(-my)} below the floor — wood can’t pass through the ground.` });
      }
    }
    if (globalMinY > AUDIT.FLOOR_EPS) {
      errors.push({ id: 'geom_floats', text: `Nothing touches the floor — the whole piece hovers ${fine(globalMinY)} in the air.` });
    }

    // 2. Envelope: every part stays inside the declared overall size. Pulls
    // and applied drawer fronts legitimately stand proud of the front (+z).
    for (const p of parts) {
      const proud = PROUD_ROLES[p.role] ? AUDIT.FRONT_PROUD_MAX : 0;
      let out = 0;
      for (const c of corners.get(p.id)) {
        out = Math.max(out,
          Math.abs(c[0]) - (b.w / 2 + AUDIT.ENVELOPE_EPS),
          c[1] - (b.h + AUDIT.ENVELOPE_EPS),
          -c[2] - (b.d / 2 + AUDIT.ENVELOPE_EPS),
          c[2] - (b.d / 2 + AUDIT.ENVELOPE_EPS + proud));
      }
      if (out > 0) {
        errors.push({ id: 'geom_out:' + p.id, text: `“${p.name}” (${p.id}) sticks ${fine(out)} outside the piece’s stated ${U().fmtLength(b.w)} × ${U().fmtLength(b.d)} × ${U().fmtLength(b.h)} envelope — rogue geometry.` });
      }
    }

    // 3. Joints reference real parts; jointed parts touch; unjointed parts
    // keep out of each other's space. Same-drawer internals (grooved bottoms,
    // captured backs) are validated by their own derivation math instead.
    const idSet = new Set(parts.map(p => p.id));
    const jointed = new Set();
    for (const j of model.joints || []) {
      if (!idSet.has(j.a) || !idSet.has(j.b)) {
        errors.push({ id: 'geom_jref:' + j.a + '|' + j.b, text: `A ${j.type} joint references a part that doesn’t exist (${!idSet.has(j.a) ? j.a : j.b}).` });
        continue;
      }
      jointed.add(j.a < j.b ? j.a + '|' + j.b : j.b + '|' + j.a);
    }
    const sameDrawer = (p, q) => p.group === q.group && p.group !== 'frame';
    for (let i = 0; i < parts.length; i++) {
      for (let k = i + 1; k < parts.length; k++) {
        const p = parts[i], q = parts[k];
        const key = p.id < q.id ? p.id + '|' + q.id : q.id + '|' + p.id;
        if (jointed.has(key)) {
          if (Geo.obbPenetration(boxes.get(p.id), boxes.get(q.id)) == null) {
            const grown = Geo.partOBB(p);
            grown.e = grown.e.map(e => e + AUDIT.CONTACT_GAP);
            if (Geo.obbPenetration(grown, boxes.get(q.id)) == null) {
              // Name the axis, the separation, and both parts' nearest faces
              // (A9) — a purely verbal message gave the model nothing to fix.
              const A = aabbOf(p.id), B = aabbOf(q.id);
              let bestAx = 0, bestGap = -Infinity;
              for (let ax = 0; ax < 3; ax++) {
                const g = Math.max(B.min[ax] - A.max[ax], A.min[ax] - B.max[ax]);
                if (g > bestGap) { bestGap = g; bestAx = ax; }
              }
              const AXIS = ['x', 'y', 'z'];
              const geom = bestGap > 0.05
                ? (() => {
                  const aFirst = A.max[bestAx] <= B.min[bestAx];
                  const [loP, loB, hiP, hiB] = aFirst ? [p, A, q, B] : [q, B, p, A];
                  return ` They are ${fine(bestGap)} apart along ${AXIS[bestAx]}: “${loP.name}” ends at ${AXIS[bestAx]}=${fine(loB.max[bestAx])}, “${hiP.name}” starts at ${AXIS[bestAx]}=${fine(hiB.min[bestAx])} — move one so the faces meet.`;
                })()
                : '';
              errors.push({ id: 'geom_gap:' + key, text: `“${p.name}” (${p.id}) and “${q.name}” (${q.id}) are joined on paper but never touch — that joint can’t be built.${geom}` });
            }
          }
        } else if (!sameDrawer(p, q)) {
          const pen = Geo.obbPenetration(boxes.get(p.id), boxes.get(q.id));
          if (pen != null && pen > AUDIT.PEN_EPS) {
            errors.push({ id: 'geom_overlap:' + key, text: `“${p.name}” (${p.id}) and “${q.name}” (${q.id}) occupy the same space (${fine(pen)} deep) with no joint between them.` });
          }
        }
      }
    }

    // 4. It must be able to stand: the volume-weighted center of gravity has
    // to fall inside the hull of the floor contact points. (The structural
    // engine reports stability MARGINS; this is the hard impossibility gate.)
    const footPts = [];
    for (const p of parts) {
      if (minY.get(p.id) < AUDIT.FOOT_Y) {
        for (const c of corners.get(p.id)) if (c[1] < AUDIT.FOOT_PT_Y) footPts.push([c[0], c[2]]);
      }
    }
    let mass = 0, mx = 0, mz = 0;
    for (const p of parts) {
      if (p.role === 'pull' || p.hardware) continue;
      const m = p.size.w * p.size.h * p.size.d; // uniform density is enough for a hard gate
      mass += m; mx += m * p.pos.x; mz += m * p.pos.z;
    }
    const hull = Geo.convexHull2D(footPts);
    if (globalMinY <= AUDIT.FLOOR_EPS) { // otherwise geom_floats already covers it
      if (hull.length < 3) {
        errors.push({ id: 'geom_footprint', text: footPts.length ? 'The floor contact points are collinear — the piece falls over sideways.' : 'No part offers a floor footprint to stand on.' });
      } else if (mass > 0) {
        const inDist = Geo.polyInsideDistance(hull, [mx / mass, mz / mass]);
        if (inDist < 0) {
          errors.push({ id: 'geom_footprint', text: `The center of gravity falls ${fine(-inDist)} outside the floor footprint — the piece tips over as built.` });
        }
      }
    }
    return errors;
  }

  /* ---------------- validation ----------------
   * Pure report over the corrected spec + built model.
   * errors block generation; advisories are dismissible chips.
   */
  function validate(spec, model) {
    const errors = [], advisories = [];
    const t = spec.meta.template, o = spec.overall;
    const fmt = mm => U().fmtLength(mm);

    // Ergonomics advisories (never block).
    for (const row of K.ERGONOMICS) {
      if (!row.appliesTo.includes(t)) continue;
      if (row.axis === 'height' || row.axis === 'depth') {
        const v = o[row.axis];
        if (v < row.min || v > row.max) {
          const dir = v > row.max ? 'above' : 'below';
          advisories.push({
            id: 'ergo_' + row.key,
            text: `${fmt(v)} is ${dir} the typical ${fmt(row.min)} to ${fmt(row.max)} ${row.label.toLowerCase()}. ${U().fmtTemplate(row.note)}`
          });
        }
      }
    }

    // Outdoor hardware truth (2026 hardware expansion): an exterior finish
    // on a tannin-rich species means plain-steel hardware streaks black.
    const finRow = K.FINISHES.find(f => f.key === spec.finish);
    const spRow = K.WOOD_SPECIES[spec.wood.species];
    if (finRow && finRow.exterior && BB.HW && spRow &&
      (spRow.outdoor || BB.HW.GATES.outdoorHardware.tannicSpecies.includes(spRow.key))) {
      advisories.push({
        id: 'hw_outdoor',
        text: `Outdoor duty: every screw, hinge, and fitting should be stainless, brass, or galvanized — plain steel streaks tannin-rich ${spRow.label.toLowerCase()} black in the rain.`
      });
    }
    // Push-to-open needs a gap to push through: overlay fronts sit proud
    // and touch — inset fronts already carry the 2 mm reveal.
    if (spec.hardware && spec.hardware.pull === 'none_touch' && spec.drawers && spec.drawers.frontStyle === 'overlay') {
      advisories.push({
        id: 'hw_touch_gap',
        text: `Push-to-open needs a ${fmt(2)} to ${fmt(3)} gap to travel through — use inset fronts with a touch latch, or add bumper spacers behind overlay fronts.`
      });
    }

    // Wide solid top in a high-movement species.
    const sp = K.WOOD_SPECIES[spec.wood.species];
    const hasWideTop = ['table', 'desk', 'bench', 'nightstand', 'cabinet'].includes(t) && o.depth >= K.WIDE_TOP_MM;
    if (sp && sp.movement === 'high' && hasWideTop) {
      advisories.push({
        id: 'movement_' + sp.key,
        text: `${sp.label} moves a lot across the grain, and this top is ${fmt(o.depth)} wide. Fasten it with buttons or figure-8s — never glue a wide solid top down.`
      });
    }

    // Drawer geometry from the built model. Thresholds come from the
    // ergonomics table — one source of truth (audit F-SYS-3).
    const drMinH = K.ergoRow('drawer_min_height').min;
    const drMaxW = K.ergoRow('drawer_max_width').max;
    const pullMax = K.ergoRow('drawer_pull_height').max;
    if (model && model.openings) {
      for (const op of model.openings) {
        if (op.h < drMinH) errors.push({ id: 'op_h_' + op.index, text: `Drawer opening ${op.index + 1} is only ${fmt(op.h)} tall — the minimum workable opening is ${fmt(drMinH)}. Reduce the drawer count or grow the piece.` });
        if (op.w > drMaxW) advisories.push({ id: 'op_w_' + op.index, text: `A ${fmt(op.w)} drawer is wider than the ${fmt(drMaxW)} a single slide pair handles well. Consider two banks side by side.` });
      }
      if (spec.drawers && model.openings.length) {
        const topOp = model.openings[0];
        if (t === 'cabinet' && topOp.zTop > pullMax) advisories.push({ id: 'pull_height', text: `The top drawer sits above comfortable pull height (${fmt(K.ergoRow('drawer_pull_height').min)} to ${fmt(pullMax)}). Fine for occasional storage.` });
      }
    }
    if (model && model.drawers) {
      for (const d of model.drawers) {
        if ((d.runner === 'side_mount_slides' || d.runner === 'undermount_slides') && !d.slideLen) {
          errors.push({ id: 'dr_slide_' + d.index, text: `Drawer ${d.index + 1}'s interior is too shallow for the shortest ${fmt(250)} slide. Deepen the piece or switch to wood runners.` });
        } else if (d.box.d < 120) {
          errors.push({ id: 'dr_depth_' + d.index, text: `Drawer ${d.index + 1} would only be ${fmt(d.box.d)} deep — the interior doesn't leave a workable drawer. Deepen the piece or remove the drawers.` });
        }
        // A 6 mm bottom over a wide box drums and sags (audit F-S3-5).
        if (d.box.w - 2 * d.box.t > 600) {
          advisories.push({ id: 'dr_bottom_' + d.index, text: `Drawer ${d.index + 1}'s bottom spans ${fmt(d.box.w - 2 * d.box.t)} — over ${fmt(600)}, a ${fmt(6)} bottom drums and sags. Use ${fmt(12)} ply or add a center muntin.` });
        }
        // Pull substitution honesty (2026): when the front is too narrow for
        // the requested style, code fits something workable — and says so.
        const pu = d.pull;
        if (pu && pu.substituted && BB.HW) {
          const want = BB.HW.PULLS[pu.styleKey], got = BB.HW.PULLS[pu.style];
          advisories.push({
            id: 'hw_pull_narrow_' + d.index,
            text: `Drawer ${d.index + 1}'s front is ${fmt(d.front.w)} wide — too narrow for ${want ? want.label.toLowerCase() + 's' : 'that pull style'}, so a ${got ? got.label.toLowerCase() : 'round knob'} is fitted instead. Pick a knob or cup pull to make it explicit.`
          });
        }
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
      // End-grain reality (audit F-S2-7): screws barely hold in end grain and
      // glue holds almost nothing there — name every screw-only end-grain joint.
      const byPid = new Map(c.parts.map(p => [p.id, p]));
      for (const cn of c.connections) {
        if (cn.joint !== 'butt_screws' && cn.joint !== 'pocket_screws') continue;
        const a = byPid.get(cn.a), b = byPid.get(cn.b);
        if (!a || !b) continue;
        if (endGrainBearing(a, b) || endGrainBearing(b, a)) {
          advisories.push({
            id: 'endgrain_' + cn.a + '_' + cn.b,
            text: `“${a.role}” (${cn.a}) meets “${b.role}” (${cn.b}) on end grain with screws only — screws hold about a third less in end grain and glue there holds almost nothing. Prefer dowels, a tenon, or a cleat at this joint.`
          });
        }
      }
      // Pocket screws need meat to bite (audit F-S3-5): the jig itself bottoms
      // out under ~12 mm of stock.
      for (const cn of c.connections) {
        if (cn.joint !== 'pocket_screws') continue;
        const a = byPid.get(cn.a), b = byPid.get(cn.b);
        for (const p of [a, b]) {
          if (p && p.dim.t < 12) {
            errors.push({ id: 'pocket_thin_' + p.id, text: `Pocket screws into “${p.role}” (${p.id}) at ${fmt(p.dim.t)} thick — a pocket-hole jig needs at least ${fmt(12)} of stock. Use a thicker part or a different joint.` });
          }
        }
      }
      // One piece, not several: the connection graph must be a single component.
      if (c.parts.length >= 2 && c.connections.length) {
        const adj = new Map(c.parts.map(p => [p.id, []]));
        for (const cn of c.connections) {
          if (adj.has(cn.a) && adj.has(cn.b)) { adj.get(cn.a).push(cn.b); adj.get(cn.b).push(cn.a); }
        }
        const reach = new Set([c.parts[0].id]);
        const stack = [c.parts[0].id];
        while (stack.length) {
          const id = stack.pop();
          for (const n of adj.get(id) || []) if (!reach.has(n)) { reach.add(n); stack.push(n); }
        }
        if (reach.size < c.parts.length) {
          errors.push({ id: 'custom_split', text: 'The composition splits into disconnected sub-assemblies — every part must reach every other part through declared joints.' });
        }
      }
    }

    // Hard geometric errors.
    if (model && model.parts) {
      for (const p of model.parts) {
        if (p.size.w <= 0 || p.size.h <= 0 || p.size.d <= 0) {
          errors.push({ id: 'geom_' + p.id, text: `“${p.name}” computes to a non-positive dimension. The current sizes don’t leave room for it.` });
        }
      }
      errors.push(...auditModel(spec, model));
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
    defaultSpec, defaultCustom, clone, deepMerge, diffSpecs, describeDiff, reconcileAck, integrityLine,
    correctSpec, validate, auditModel, AUDIT, fmtValue, PATH_LABELS,
    customPartSize, customExtents, customGrainInfo, endGrainBearing, scaleCustom
  };
})();
