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

  const TEMPLATES = ['table', 'desk', 'bench', 'bookshelf', 'nightstand', 'cabinet', 'custom', 'chair', 'wall_shelf', 'bed'];
  const PRIMITIVES = ['post', 'rail', 'panel', 'slab', 'cylinder'];
  const SURFACES = ['none', 'seating', 'worktop', 'shelf'];
  /* The templates Parametric.tableLike() builds: four legs tied by an apron
   * frame. Deliberately NOT structural.js's TABLE_LIKE, which also carries
   * nightstand — that one describes "reads as a table to the load model",
   * this one describes "is built by the frame builder", and a nightstand's
   * drawer bank leaves no room between its legs for a stretcher to span. */
  const FRAME_TEMPLATES = ['table', 'desk', 'bench'];

  /* ---------------- schema versioning (Phase 4) ----------------
   * Every corrected spec carries specVersion. Any stored spec is upgraded
   * through the migration registry on load — a saved design must never fail
   * to open. From Phase 4 forward, EVERY schema change adds a migration here.
   */
  const SPEC_VERSION = 11;
  const migrations = {
    /* v3 → v4: Phase 1–3 specs had no specVersion and no `custom` section.
     * Stamp the version, initialise custom to null, and normalise the legacy
     * `wood.sheetSpecies` field (v3 sometimes omitted it). */
    3: function (s) {
      const out = clone(s) || {};
      out.specVersion = 4;
      if (out.custom === undefined) out.custom = null;
      // isObj, not `|| {}`: a junk section that is truthy-but-not-an-object
      // (`{wood:"no"}`, straight off the wire or a bad merge) survives `||`
      // and then throws on property assignment under strict mode. Migrations
      // run on the least trustworthy input in the app — anything a stranger's
      // share code or a half-written patch can carry.
      if (!isObj(out.wood)) out.wood = {};
      if (!out.wood.sheetSpecies) out.wood.sheetSpecies = 'baltic_birch';
      return out;
    },
    /* v4 → v5: stretchers became a first-class frame option (X-07). Every
     * design saved before this was unbraced, so `none` is not a default here
     * — it is the truth about what that design was. The height rides along
     * so the knob has something to show the moment somebody turns bracing on;
     * it is inert while stretcher is `none`. */
    4: function (s) {
      const out = clone(s) || {};
      out.specVersion = 5;
      if (!isObj(out.structure)) out.structure = {};
      if (out.structure.stretcher === undefined) out.structure.stretcher = 'none';
      if (out.structure.stretcherHeight === undefined) out.structure.stretcherHeight = 280;
      return out;
    },
    /* v5 → v6: doors and their hinge (X-07). Same principle as v4 → v5 — a
     * case saved before doors existed was an OPEN case, and must open as one.
     * The hinge default rides along so the picker has something to show the
     * moment doors are added; it is inert while `doors` is null. */
    5: function (s) {
      const out = clone(s) || {};
      out.specVersion = 6;
      if (out.doors === undefined) out.doors = null;
      if (!isObj(out.hardware)) out.hardware = {};
      if (out.hardware.hinge === undefined) out.hardware.hinge = 'euro_cup';
      return out;
    },
    /* v6 → v7: the seating class (chair/stool template) added a `seat`
     * section. No pre-v7 design is a chair, so every old design gets an
     * explicit null — same principle as doors and stretchers: absence is the
     * truth about what that design was. */
    6: function (s) {
      const out = clone(s) || {};
      out.specVersion = 7;
      if (out.seat === undefined) out.seat = null;
      return out;
    },
    /* v7 -> v8: the wall-mounted class added a `wall` section. Same doctrine:
     * nothing saved before it was wall-mounted, so absence becomes an
     * explicit null. */
    7: function (s) {
      const out = clone(s) || {};
      out.specVersion = 8;
      if (out.wall === undefined) out.wall = null;
      return out;
    },
    /* v8 -> v9: the bed class added a `bed` section. Same doctrine: absence
     * becomes an explicit null. */
    8: function (s) {
      const out = clone(s) || {};
      out.specVersion = 9;
      if (out.bed === undefined) out.bed = null;
      return out;
    },
    /* v9 -> v10: the outdoor exposure model added one field. Every design
     * saved before it was designed for the indoors — interior EMC swings,
     * interior glue, interior finishes — so absence becomes the explicit
     * interior default: the truth about what that design was, exactly the
     * v4→v5 unbraced doctrine. */
    9: function (s) {
      const out = clone(s) || {};
      out.specVersion = 10;
      if (out.exposure === undefined) out.exposure = 'interior';
      return out;
    },
    /* v10 -> v11: the children's SCOPE class added a `child` section
     * (null = adult design — which is what every design saved before it
     * was). */
    10: function (s) {
      const out = clone(s) || {};
      out.specVersion = 11;
      if (out.child === undefined) out.child = null;
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
  /* Minimal valid composition for the custom template: a knock-down slab seat
   * on two rotated panel legs. Real designs come from the AI or a share code.
   *
   * The joint is a knockdown bolt, and that is a structural decision, not a
   * style one (audit X-05). A seat is the heaviest duty in the load table
   * (BIFMA X5.4, 136 kg per seat) and this composition hands the whole of it
   * to exactly two connections — ~1334 N each. At the default `beginner`
   * level the legal joints are butt screws (500 N), pocket screws (700 N),
   * biscuits (600 N) and the KD bolt (1800 N); the three wooden ones are
   * further derated ×0.67 because the leg lands inside the slab's end-grain
   * zone. Only the bolt carries the load with the 1.5× margin the joint check
   * demands (1.70×), so only the bolt is an honest default — and it is how a
   * demountable slab bench is genuinely built (barrel nut + connector bolt).
   * Do not "simplify" this back to screws: the piece would ship a FAIL, which
   * is exactly the defect X-05 recorded. Change the piece before the physics. */
  function defaultCustom() {
    return {
      parts: [
        { id: 'p1', role: 'seat', primitive: 'slab', dim: { l: 1100, w: 350, t: 38 }, pos: { x: 0, y: 449, z: 0 }, rot: null, grain: 'length', stock: 'solid', loadBearing: false, surface: 'seating' },
        { id: 'p2', role: 'leg_panel', primitive: 'panel', dim: { l: 350, w: 430, t: 38 }, pos: { x: -475, y: 215, z: 0 }, rot: { x: 0, y: 90, z: 0 }, grain: 'length', stock: 'solid', loadBearing: true, surface: 'none' },
        { id: 'p3', role: 'leg_panel', primitive: 'panel', dim: { l: 350, w: 430, t: 38 }, pos: { x: 475, y: 215, z: 0 }, rot: { x: 0, y: 90, z: 0 }, grain: 'length', stock: 'solid', loadBearing: true, surface: 'none' }
      ],
      connections: [
        { a: 'p2', b: 'p1', joint: 'kd_bolt' },
        { a: 'p3', b: 'p1', joint: 'kd_bolt' }
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
        backPanel: true, toeKick: false,
        // Every existing template ships unbraced, exactly as before — a
        // stretcher is something you ask for. `none` is also what the
        // migration writes, so no saved design changes shape on open.
        stretcher: 'none', stretcherHeight: 280
      },
      joinery: { frame: 'pocket_screws', case: 'butt_screws', box: 'pocket_screws' },
      finish: 'wipe_poly',
      exposure: 'interior',
      hardware: { pull: 'bar_pull', hinge: 'euro_cup' },
      drawers: null,
      doors: null,
      custom: null,
      seat: null,
      wall: null,
      bed: null,
      child: null
    };
    const t = base.meta.template;
    if (t === 'bed') {
      /* Bed class (BB.Classes 'bed'): the mattress size DRIVES the frame —
       * overall is derived from the size standard plus rail structure. */
      base.meta.name = 'Platform Bed';
      base.bed = { size: 'queen', platformHeight: 350, headboardHeight: 1000 };
      Object.assign(base.structure, {
        legThickness: 70, apronHeight: 140, apronThickness: 25, topThickness: 19
      });
      /* Knock-down is a CLASS MANDATE: a glued bed cannot leave the room.
       * Correction re-enforces this whatever is asked. */
      base.joinery.frame = 'kd_bolt';
    }
    if (t === 'wall_shelf') {
      /* Wall-mounted class (BB.Classes 'wall_mounted'): width = length along
       * the wall, depth = shelf depth, height DERIVED (cleat + shelf). The
       * substrate defaults to studs at 16 in o.c. — the CHAT path asks
       * before creating; a share code can carry 'unknown' and is refused. */
      base.meta.name = 'Floating Shelf';
      Object.assign(base.overall, { width: 914.4, depth: 241.3, height: 102 });
      base.structure.topThickness = 32;
      base.wall = { substrate: 'stud', studSpacingMM: 406 };
    }
    if (t === 'chair') {
      /* Seating class defaults (BB.Classes 'seating' owns the ranges and
       * sources). Overall is DERIVED from the seat family by correction —
       * the numbers here are just a sane pre-correction envelope. */
      base.meta.name = 'Dining Chair';
      Object.assign(base.overall, { width: 430, depth: 420, height: 915 });
      base.seat = {
        width: 430, depth: 420, height: 445, slopeDeg: 3,
        backHeight: 470, backRake: 4, splayDeg: 0, counterHeight: null
      };
      Object.assign(base.structure, {
        topThickness: 20, legThickness: 38, apronHeight: 65, apronThickness: 25,
        apronInset: 0, stretcher: 'h', stretcherHeight: 200
      });
      /* Seat-frame joinery is CLASS-MANDATED (never screws) — see the
       * seating contract in classes.js. The level default is applied by
       * correction; this seed matches the beginner mandate. */
      base.joinery.frame = 'kd_bolt';
    }
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
  /* Keys that are not data. `JSON.parse` creates a real OWN "__proto__"
   * property, so a spec that arrived as raw JSON can carry one — and walking
   * into it writes onto Object.prototype for the whole process, not onto the
   * spec. The codec is immune (decode emits a fixed key set), but the server
   * accepts a raw `body.spec` on POST /api/blueprint and api/_pipeline.js
   * keeps its vm context warm between requests, so one poisoned merge would
   * outlive the request that caused it and reach the next user's plan. This
   * is the single choke point every merge path goes through. */
  const UNSAFE_KEYS = ['__proto__', 'constructor', 'prototype'];
  function deepMerge(base, patch) {
    const out = clone(base) || {};
    (function walk(dst, src) {
      for (const k of Object.keys(src)) {
        if (UNSAFE_KEYS.includes(k)) continue;
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
    'finish': 'finish', 'exposure': 'exposure', 'hardware.pull': 'pull style',
    'drawers.count': 'drawer count', 'drawers.frontStyle': 'drawer fronts', 'drawers.runner': 'drawer runners',
    'seat.width': 'seat width', 'seat.depth': 'seat depth', 'seat.height': 'seat height',
    'seat.slopeDeg': 'seat slope', 'seat.backHeight': 'back height', 'seat.backRake': 'back rake',
    'seat.splayDeg': 'leg splay', 'seat.counterHeight': 'counter height',
    'structure.stretcher': 'stretcher style', 'structure.stretcherHeight': 'stretcher height',
    'bed.size': 'mattress size', 'bed.platformHeight': 'platform height', 'bed.headboardHeight': 'headboard height',
    'wall.substrate': 'wall substrate', 'wall.studSpacingMM': 'stud spacing',
    'child.ageBand': 'child age band'
  };
  const MM_PATHS = /^(overall\.|structure\.(top|leg|apron|shelf|side)Thickness|structure\.apronHeight|structure\.apronInset|structure\.shelfThickness|structure\.stretcherHeight$|seat\.(width|depth|height|backHeight|counterHeight)$|bed\.(platformHeight|headboardHeight)$|wall\.studSpacingMM$|custom\.part\.(len|wid|thk)$)/;

  /* Diff-chip / inspector value rendering. Lengths route through BB.Units —
   * the current display preference, NOT a per-call unit, decides the text. */
  function fmtValue(path, v) {
    if (typeof v === 'number' && MM_PATHS.test(path)) return U().fmtLength(v);
    if (typeof v === 'boolean') return v ? 'on' : 'off';
    // null and undefined both mean "not there" on a chip: adding drawers
    // diffs null → 2, removing them 2 → null — never a literal "null".
    if (v === undefined || v === null) return '—';
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
      /* The wall_mounted class (2026-07) really does fasten to the building
       * — a wall_shelf's cleat/stud/mount talk is honest and never
       * "corrected". Everything else keeps the floor doctrine. */
      const isWallMounted = spec.meta && spec.meta.template === 'wall_shelf';
      const hasCleat = isWallMounted || (isCustom
        ? ((spec.custom && spec.custom.parts) || []).some(p => /cleat/.test(p.role || '')) ||
          ((spec.custom && spec.custom.connections) || []).some(c => c.joint === 'french_cleat')
        : ['frame', 'case', 'box'].some(k => spec.joinery && spec.joinery[k] === 'french_cleat'));
      const BUILDING = '(columns?|walls?|ceilings?|studs?|joists?|rafters?|masonry|brick)';
      const mountRx = new RegExp('\\b(?:screw(?:ed|s)?|bolt(?:ed|s)?|lag(?:ged)?|mount(?:ed|s)?|attach(?:ed|es)?|fasten(?:ed|s)?|hangs?|hung|suspend(?:ed|s)?)\\b[^.;:!?]{0,40}?\\b' + BUILDING + '\\b');
      const styleRx = new RegExp('\\b' + BUILDING + '[\\s-](?:mounted|mount|hung|suspended)\\b');
      const target = w => (/^column/.test(w) ? 'column' : /^(ceiling|joist|rafter)/.test(w) ? 'ceiling' : 'wall');
      const cleatM = /\bfrench[\s-]+cleats?\b/.exec(low);
      if (!hasCleat && cleatM && !NEG.test(clauseAt(cleatM.index))) {
        fixes.push('no french cleat exists in this plan — the only building attachment this tool ever adds is the anti-tip strap');
      } else {
        const m = isWallMounted ? null : (mountRx.exec(low) || styleRx.exec(low));
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

  /* Integrity honesty line for the chat ack (A3/G11): a failing verdict is
   * never hidden behind a cheerful blurb, an ANCHOR verdict is said in chat
   * — not just a "REQUIRED" BOM line the user meets at checkout (B13) — and
   * a failing line names the governing check when the worst sag is itself
   * the failure. The assumed-load disclosure (G3/G4) rides here too:
   * engine-DERIVED check surfaces always state their assumed duty, and
   * defaulted presets are named whenever the line already speaks — but
   * template defaults alone never turn a clean pass into ack noise. Photo
   * flows keep their fuller phrasing (proportions were estimated, so even a
   * clean report is worth stating). */
  function integrityLine(summary, opts) {
    if (!summary) return '';
    if (opts && opts.photo) {
      const t = summary.fails ? summary.fails + ' fail(s)' : summary.advisories ? summary.advisories + ' advisory(ies)' : 'all checks pass';
      return ` Integrity: ${t} — full report in the Safety tab.`;
    }
    let line = '';
    if (summary.fails) {
      // Name the worst sag only when it is truly a failing check (the fail
      // threshold is 1.5× the limit) — the failures may live elsewhere.
      const ws = summary.worstSag;
      const worst = ws && ws.limit > 0 && ws.sag / ws.limit > 1.5
        ? ` — worst: ${String(ws.id).replace(/_/g, ' ')} sag ${U().fmtSmall(ws.sag)} vs ${U().fmtSmall(ws.limit)} limit;`
        : ' —';
      line = ` Integrity: ${summary.fails} failing check${summary.fails > 1 ? 's' : ''}${worst} see the Safety tab before building.`;
    } else if (summary.anchorRequired) {
      line = ' This piece needs the included wall anchor — it tips without it.';
    }
    const assumed = Array.isArray(summary.surfaceLoads) ? summary.surfaceLoads.filter(l => l && l.assumed) : [];
    const derived = Array.isArray(summary.assumedSurfaces) && summary.assumedSurfaces.length > 0;
    if (assumed.length && (line || derived)) {
      const byLabel = new Map();
      for (const l of assumed) {
        if (!byLabel.has(l.label)) byLabel.set(l.label, []);
        byLabel.get(l.label).push(String(l.id).replace(/_/g, ' '));
      }
      const groups = [...byLabel].map(([lab, ids]) => `${lab} on ${ids.slice(0, 3).join(', ')}${ids.length > 3 ? ', …' : ''}`);
      line += ` Checked at ${groups.join(' and ')} (assumed — set the real duty in the Safety tab).`;
    }
    return line;
  }

  function snap(v, table) {
    let best = table[0];
    for (const t of table) if (Math.abs(t - v) < Math.abs(best - v)) best = t;
    return best;
  }
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const num = (v, fallback) => (typeof v === 'number' && isFinite(v) ? v : fallback);
  const r1 = v => Math.round(v * 10) / 10;

  /* ---------------- clamped-length table ----------------
   * One source for every length bound correction owns: correctSpec applies
   * it, correctionNotes (G10) reads it back to name what it refused. `stock`
   * is the board table the clamped value lands on — landing on stock is code
   * buying a real board, not a refusal, so notes stay quiet about it; a value
   * outside [min, max] was genuinely refused and gets said out loud.
   * (shelfCount is a count, not a length — it keeps its own rule below, and
   * never crosses the units boundary.)
   */
  const DIM_RULES = {
    'overall.width': { min: 250, max: 2400, def: 1000 },
    'overall.depth': { min: 200, max: 1200, def: 500 },
    'overall.height': { min: 120, max: 2400, def: 750 },
    'structure.topThickness': { min: 12, max: 45, def: 25, stock: K.SOLID_THICKNESS },
    // Legs snap to the SAME post-stock table custom posts use (values below
    // the 32 mm clamp floor can never win the nearest-match) — one table,
    // not a hand-copied twin that drifts.
    'structure.legThickness': { min: 32, max: 100, def: 70, stock: K.POST_THICKNESS },
    'structure.apronThickness': { min: 15, max: 25, def: 20, stock: [15, 19, 20, 25] },
    'structure.apronHeight': { min: 60, max: 160, def: 90 },
    'structure.apronInset': { min: 0, max: 30, def: 12 },
    'structure.shelfThickness': { min: 12, max: 32, def: 19, stock: K.SOLID_THICKNESS },
    'structure.sideThickness': { min: 12, max: 25, def: 18, stock: [12, 15, 18, 19, 25] },
    /* Stretcher centreline above the floor. The bounds are the two ways a
     * stretcher goes wrong, not a taste range: too low and it is a toe-stub
     * that collects dust and braces nothing near the top of the leg; too high
     * and it is a shin rail. Correction additionally caps it against the
     * actual leg — this table cannot know the piece's height. */
    'structure.stretcherHeight': { min: 100, max: 600, def: 280 },
    /* Seating family (BB.Classes 'seating' documents the sources): plan
     * dimensions of the seat itself; height spans dining chairs (380–500)
     * through bar stools (up to 850) — the chair/stool branch inside
     * correctSeat narrows further, and the counter-height coupling can move
     * height inside this range. */
    'seat.width': { min: 300, max: 700, def: 430 },
    'seat.depth': { min: 300, max: 550, def: 420 },
    'seat.height': { min: 380, max: 850, def: 445 }
  };
  const STRETCHERS = ['none', 'h', 'box'];
  /* Doors (X-07). Templates with a front opening to close. A bookshelf
   * qualifies as much as a cabinet — glazed-or-panelled bookcase doors are
   * ordinary furniture — but a frame piece has no case to hang them on. */
  const DOOR_TEMPLATES = ['cabinet', 'bookshelf'];
  const DOOR_STYLES = ['inset', 'overlay'];
  /* A single door past this width sags on its own hinges and needs a swing
   * radius nobody has in a kitchen; correction splits it into a pair rather
   * than building something that will droop. Standard cabinet practice —
   * and the same 600 the Blum-class hinge count charts are valid to, which
   * is why the cap is owned by the casework class contract (CASE_GEOM) and
   * only read here. doorNotes() discloses the split. */
  const DOOR_MAX_SINGLE_W = BB.Classes && BB.Classes.get('casework')
    ? BB.Classes.get('casework').geom.DOOR_MAX_SINGLE_W : 600;
  /* Clear air the stretcher needs under the apron, and the least it can sit
   * above the floor. Both are shop numbers, not taste: the gap is what lets
   * you get a clamp and a hand between the two rails during glue-up, and the
   * floor minimum keeps the rail above a skirting board and out of the mop. */
  const STRETCHER_APRON_GAP = 90;
  const STRETCHER_FLOOR_MIN = 100;
  function applyDim(path, v) {
    const r = DIM_RULES[path];
    const c = clamp(num(v, r.def), r.min, r.max);
    return r.stock ? snap(c, r.stock) : c;
  }
  /* Shelves are counted, not measured — same single-source deal, no snap and
   * no units boundary. Correction clamps to this range, THEN decrements until
   * the shelves clear each other; the two are separate refusals. */
  const SHELF_COUNT = { min: 0, max: 8, def: 0 };

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
   * ids p1..pN, joint gating. Grounding/centering happens in correctCustom —
   * this half is shared with correctionNotes (G10), which must measure the
   * proposal's altitude BEFORE the floor snap under the exact rules
   * correction applies. Silent, deterministic, never mutates its input. */
  function sanitizeCustom(c, level) {
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
    return { parts, connections: conns };
  }

  /* Correct a proposed composition: sanitize (above), then ground + center
   * the whole piece. Silent, deterministic, idempotent — validation reports
   * whatever remains wrong; correctionNotes (G10) reports what grounding
   * silently changed. */
  function correctCustom(c, level) {
    const out = sanitizeCustom(c, level);
    const parts = out.parts;

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
    return out;
  }

  /* ---------------- correction notes (G10) ----------------
   * Pure, user-facing record of the silent fixes correction applied: compare
   * the RAW proposal with the delivered spec and name what neither the user
   * nor the model would otherwise learn. First class: custom grounding —
   * correctCustom translates an airborne composition onto the floor with no
   * disclosure (ref1: a "ceiling-suspended" desk delivered 610 mm lower, its
   * ack still selling the hang, because grounding runs before the audit so
   * geom_floats can never fire). Then the four silent substitutions the same
   * pass makes on every template: a joint the skill level won't allow, a
   * length outside what the tool (or the piece) can take, a species that
   * isn't stocked solid lumber, and a drawer bank on a template with no
   * opening for one. Returns display-ready strings; [] when nothing notable
   * happened. The raw spec is pre-correction — parts may lack dim/pos/rot —
   * so it is sanitized (never mutated) with the same rules correction itself
   * uses. Consumed by the ack pipeline and refinement-round context (P-UI
   * wave). */
  const GROUND_NOTE_MM = 50; // below this, snapping to the floor is cleanup, not a destroyed premise
  const DRAWER_TEMPLATES = ['nightstand', 'cabinet'];
  /* Read a section field off a spec that may be partial, junk, or absent —
   * correctionNotes runs on Spec.deepMerge(base, patch) output and must never
   * throw on the chat commit path. */
  const at = (o, sec, key) => (o && o[sec] && typeof o[sec] === 'object' ? o[sec][key] : undefined);

  /* Lengths correction refused. Outside the rule's range = refused outright;
   * inside it but still delivered different = capped by the piece's own
   * geometry (legs against the footprint, apron under the top). A value that
   * only moved to land on stock is not a refusal — code buying the nearest
   * real board is the deal — so it stays quiet. */
  function dimensionNotes(raw, cor, notes) {
    const fmt = mm => U().fmtLength(mm);
    const derivedOverall = ['chair', 'bed'].includes(at(cor, 'meta', 'template'));
    for (const path of Object.keys(DIM_RULES)) {
      // A chair's overall is DERIVED from the seat family and a bed's from
      // its mattress size — their own sections carry the user-facing
      // refusals, so overall.* notes there would be noise.
      if (derivedOverall && path.startsWith('overall.')) continue;
      // Child-scoped heights are PINNED to the EN 1729 band — childNotes
      // owns those refusals with the band named; a second generic note here
      // would be noise.
      if (cor.child && (path === 'overall.height' || path.startsWith('seat.'))) continue;
      const dot = path.indexOf('.');
      const sec = path.slice(0, dot), key = path.slice(dot + 1);
      const want = num(at(raw, sec, key), null), got = num(at(cor, sec, key), null);
      if (want === null || got === null) continue;
      const r = DIM_RULES[path], label = PATH_LABELS[path] || key;
      if (want < r.min || want > r.max) {
        notes.push(`The ${label} asked for (${fmt(want)}) is outside what this tool builds — ${fmt(got)} was used instead.`);
      } else if (Math.abs(applyDim(path, want) - got) > 0.05) {
        notes.push(`The ${label} asked for (${fmt(want)}) doesn’t fit the piece’s own dimensions — ${fmt(got)} was used instead.`);
      }
    }
  }

  /* The shelf count correction refused — two refusals with two different
   * meanings, so they are two different sentences. The range clamp is an
   * arbitrary product cap ("more than this tool builds"); the decrement loop
   * is the user's OWN piece running out of height to space shelves apart, and
   * that is the one they can act on. Rounding a fractional count is not a
   * refusal. A count is not a length: the bare integer IS the truth, so this
   * is the one note family with no units boundary to cross. */
  function shelfCountNote(raw, cor, notes) {
    const want = num(at(raw, 'structure', 'shelfCount'), null);
    const got = num(at(cor, 'structure', 'shelfCount'), null);
    if (want === null || got === null) return;
    const asked = Math.round(want), capped = clamp(asked, SHELF_COUNT.min, SHELF_COUNT.max);
    const shelves = n => n + (n === 1 ? ' shelf' : ' shelves');
    if (asked !== capped) {
      notes.push(`The shelf count asked for (${asked}) is outside what this tool builds — it stops at ${capped}.`);
    }
    // Whatever survived the cap is what the piece's own height then judged.
    if (capped !== got) {
      notes.push(`There isn’t room for ${shelves(capped)} at this piece’s height — the design carries ${got === 0 ? 'none' : got}.`);
    }
  }

  /* Species snapped to a fallback, in either stock slot: a name the library
   * has never heard of, or stock asked to be the material it isn't (sheet
   * goods as the solid wood, lumber as the sheet stock). One refused name
   * standing in for BOTH slots is one refusal, not a wood changing twice —
   * it merges into a single sentence. */
  function speciesNotes(raw, cor, notes) {
    const refused = key => {
      const want = at(raw, 'wood', key), got = at(cor, 'wood', key);
      if (typeof want !== 'string' || !want || typeof got !== 'string' || want === got) return null;
      const sp = K.WOOD_SPECIES[want];
      // A species already right for its own slot is one correction kept.
      if (sp && (key === 'species' ? !sp.sheet : !!sp.sheet)) return null;
      return { want, sp, to: fmtValue('wood.' + key, got) };
    };
    const word = w => `“${String(w).replace(/_/g, ' ')}”`;
    const solid = refused('species'), sheet = refused('sheetSpecies');
    if (solid && sheet && !solid.sp && !sheet.sp && solid.want === sheet.want) {
      notes.push(`${word(solid.want)} isn’t in the wood library — the design is built in ${solid.to} with ${sheet.to} sheet stock.`);
      return;
    }
    if (solid) {
      notes.push(solid.sp
        ? `${solid.sp.label} is sheet stock, not solid lumber — the design is built in ${solid.to}.`
        : `${word(solid.want)} isn’t in the wood library — the design is built in ${solid.to}.`);
    }
    if (sheet) {
      notes.push(sheet.sp
        ? `${sheet.sp.label} is solid lumber, not sheet stock — the sheet parts are cut from ${sheet.to}.`
        : `${word(sheet.want)} isn’t in the sheet-goods library — the sheet parts are cut from ${sheet.to}.`);
    }
  }

  /* Joints the level matrix gated out. Only the LEVEL gate is reported: a
   * joint that never fits the slot (a dado in a frame) or a key the codec
   * never minted was nonsense, not a downgrade. */
  function joineryNotes(raw, cor, notes) {
    const lvl = at(cor, 'meta', 'level');
    const level = K.LEVELS.includes(lvl) ? lvl : 'beginner';
    for (const kind of ['frame', 'case', 'box']) {
      const want = at(raw, 'joinery', kind), got = at(cor, 'joinery', kind);
      if (typeof want !== 'string' || typeof got !== 'string' || want === got) continue;
      const j = K.JOINERY[want];
      if (!j || !j.kinds.includes(kind) || K.jointAllowed(want, level, kind)) continue;
      const art = /^[aeiou]/.test(j.level) ? 'an' : 'a';
      notes.push(`${j.label} is ${art} ${j.level} joint and this design is set to ${level} — the ${PATH_LABELS['joinery.' + kind]} falls back to ${fmtValue('joinery.' + kind, got)}.`);
    }
  }

  /* Seating-class refusals and couplings, said out loud (the class contract
   * in BB.Classes names each of these as a refusal condition or coupling
   * rule; this is where they reach the user). */
  function seatNotes(raw, cor, notes) {
    if (!cor || at(cor, 'meta', 'template') !== 'chair' || !cor.seat) return;
    const rawSeat = raw && isObj(raw.seat) ? raw.seat : {};
    const seat = cor.seat;
    const fmt = mm => U().fmtLength(mm);
    /* Refusals: these keys are never minted by the codec, but a raw spec
     * (share import, API POST) can carry them, and silently building
     * something else would be a guess — worse than the refusal. */
    if (rawSeat.upholstered || rawSeat.slipSeat || rawSeat.upholstery) {
      notes.push('Upholstered and slip seats aren’t generated: the seat frame becomes its own part set with foam and fabric clearances this tool doesn’t model soundly yet — the design carries a solid wood seat.');
    }
    if (rawSeat.arms || rawSeat.armrests) {
      notes.push('Arms aren’t generated: arm joints carry their own load cases (BIFMA arm strength) this tool doesn’t model yet — the design is a side chair.');
    }
    const wantRake = num(rawSeat.backRake, null);
    if (wantRake !== null && seat.backHeight > 0 && wantRake - seat.backRake > 0.25) {
      notes.push(`A ${wantRake}° back rake needs a sawn or steam-bent rear leg — sawing the bend puts short grain at exactly the point the rear-tilt load breaks chairs, so this tool stops at what straight rear posts give: ${seat.backRake}°.`);
    }
    const wantSplay = num(rawSeat.splayDeg, null);
    if (wantSplay !== null && wantSplay > 0.25 && seat.backHeight > 0) {
      notes.push('Leg splay is a stool feature — a backed chair in this class keeps vertical legs (the back’s rake geometry assumes them).');
    }
    if (seat.counterHeight !== null) {
      const wantH = num(rawSeat.height, null);
      if (wantH !== null && Math.abs(wantH - seat.height) > 5) {
        notes.push(`A seat serving a ${fmt(seat.counterHeight)} counter sits 250–300 mm below it — the ${fmt(wantH)} asked for was moved to ${fmt(seat.height)}.`);
      }
    }
    /* The class joint mandate, disclosed: a frame joint the LEVEL allows but
     * the CLASS refuses (screws, biscuits, dowels on a seat frame) is a
     * silent substitution unless said here. */
    const wantJ = raw && isObj(raw.joinery) ? raw.joinery.frame : undefined;
    if (typeof wantJ === 'string' && cor.joinery && wantJ !== cor.joinery.frame && K.JOINERY[wantJ]) {
      const lvl = at(cor, 'meta', 'level');
      if (K.jointAllowed(wantJ, K.LEVELS.includes(lvl) ? lvl : 'beginner', 'frame')) {
        notes.push(`${K.JOINERY[wantJ].label} can’t hold a chair’s seat frame — the rear-tilt case racks the side-rail joints beyond what screws or dowels carry at any skill level (see the Safety tab), so the frame uses ${fmtValue('joinery.frame', cor.joinery.frame)}.`);
      }
    }
  }

  /* Bed-class disclosures: the knock-down mandate and the size fallback. */
  function bedNotes(raw, cor, notes) {
    if (!cor || at(cor, 'meta', 'template') !== 'bed' || !cor.bed) return;
    const wantJ = raw && isObj(raw.joinery) ? raw.joinery.frame : undefined;
    if (typeof wantJ === 'string' && wantJ !== 'kd_bolt' && K.JOINERY[wantJ]) {
      notes.push(`${K.JOINERY[wantJ].label} can’t join a bed’s rails — a glued bed cannot leave the room, so the class bolts every rail to its post (knockdown bolts) and the plan carries the re-snug schedule.`);
    }
    const wantSize = raw && isObj(raw.bed) ? raw.bed.size : undefined;
    if (typeof wantSize === 'string' && wantSize !== cor.bed.size) {
      notes.push(`“${wantSize}” isn’t a mattress size this tool knows (twin, full, queen, king, california king) — the frame is sized for a ${cor.bed.size.replace('_', ' ')}.`);
    }
  }

  /* Outdoor-exposure disclosures (2026-08): the species substitution and the
   * finish routing are silent, deterministic corrections — so they are said
   * here, the founding style. speciesNotes stays quiet for this case on
   * purpose (the asked-for species IS a valid solid species). */
  function exposureNotes(raw, cor, notes) {
    if (!cor || !['covered', 'exposed'].includes(cor.exposure)) return;
    const wantSp = raw && isObj(raw.wood) ? raw.wood.species : undefined;
    if (cor.exposure === 'exposed' && typeof wantSp === 'string' && cor.wood && wantSp !== cor.wood.species) {
      const sp = K.WOOD_SPECIES[wantSp];
      if (sp && !sp.sheet && !sp.outdoor) {
        notes.push(`${sp.label} isn’t decay-resistant — left in the weather it rots at the joints and checks in the sun, so this exposed build is corrected to ${fmtValue('wood.species', cor.wood.species)}. Even durable species are durable in heartwood only (sapwood of every species is perishable — cull it for outdoor parts). Ask for a covered spot to keep ${sp.label.toLowerCase()}.`);
      }
    }
    const wantFin = raw ? raw.finish : undefined;
    if (typeof wantFin === 'string' && wantFin !== cor.finish) {
      const f = K.FINISHES.find(x => x.key === wantFin);
      if (f && !f.exterior) {
        notes.push(`${f.label} is an interior finish — sun and water fail it outdoors, so the ${cor.exposure} build carries ${fmtValue('finish', cor.finish)} (exterior-rated: UV blockers and a flexible film; recoat before it ever peels).`);
      }
    }
  }

  /* Children's-scope disclosures (the 'childrens' class): the band pinning
   * heights, the backed-floor-seating refusal, and the scope cap — each a
   * contract coupling or refusal, said here so it is never silent. */
  function childNotes(raw, cor, notes) {
    const rawChild = raw && isObj(raw.child) ? raw.child : null;
    const t = at(cor, 'meta', 'template');
    const fmt = mm => U().fmtLength(mm);
    if (rawChild && (!cor || !cor.child)) {
      notes.push('The child scope only rides tables, desks, chairs, and bookshelves — this template keeps adult sizing (child-scoped casework is future work).');
      return;
    }
    if (!cor || !cor.child || !K.CHILD) return;
    const band = K.CHILD.BANDS[cor.child.ageBand];
    if (rawChild && typeof rawChild.ageBand === 'string' && rawChild.ageBand !== cor.child.ageBand) {
      notes.push(`“${String(rawChild.ageBand).replace(/_/g, ' ')}” isn’t a child age band this tool knows (toddler, preschool, school, preteen) — the design is sized for a ${band.label}.`);
    }
    if (t === 'table' || t === 'desk') {
      const want = num(at(raw, 'overall', 'height'), null);
      if (want !== null && Math.abs(want - cor.overall.height) > 5) {
        notes.push(`A ${t} for a ${band.label} is ${fmt(band.tableH)} tall — EN 1729 size mark ${band.mark} pairs it with the ${fmt(band.seatH)} seat — so the ${fmt(want)} asked for wasn’t used. Drop the child scope to size freely.`);
      }
    }
    if (t === 'chair' && cor.seat) {
      const rawSeat = raw && isObj(raw.seat) ? raw.seat : {};
      const askedStool = num(rawSeat.backHeight, 1) === 0;
      const askedCounter = num(rawSeat.counterHeight, null) !== null;
      if (askedStool || askedCounter) {
        notes.push('Child seating keeps a back and floor-serving height: a backless perch or a counter/bar stool puts a small child at fall height, so the child scope builds backed chairs only.');
      }
      const wantH = num(rawSeat.height, null);
      if (wantH !== null && Math.abs(wantH - cor.seat.height) > 5) {
        notes.push(`A chair for a ${band.label} seats at ${fmt(band.seatH)} (EN 1729 size mark ${band.mark}) — the ${fmt(wantH)} asked for wasn’t used.`);
      }
    }
  }

  /* A drawer bank asked of a template that has no opening to put one in. */
  function drawerNote(raw, cor, notes) {
    const want = raw && raw.drawers;
    if (!want || typeof want !== 'object' || !cor || cor.drawers) return;
    const t = at(cor, 'meta', 'template');
    if (!TEMPLATES.includes(t) || DRAWER_TEMPLATES.includes(t)) return; // dropped for some other reason
    notes.push(`The ${t} template has no opening for drawers — the drawer bank was dropped.`);
  }

  /* Doors refused or reshaped by correction, said out loud (casework class):
   * a single leaf past the class cap becomes a pair, and doors asked of a
   * template with no case front are dropped — both silently deterministic in
   * correctSpec, both disclosed here (G10 doctrine). */
  function doorNotes(raw, cor, notes) {
    const want = raw && raw.doors;
    if (!want || typeof want !== 'object' || !cor) return;
    const fmt = mm => U().fmtLength(mm);
    if (cor.doors) {
      const asked = Math.round(num(want.count, 0));
      if (asked === 1 && cor.doors.count === 2) {
        notes.push(`A single door across this opening would be wider than ${fmt(DOOR_MAX_SINGLE_W)} — past what cabinet hinges are charted for, and a swing radius nobody has — so the opening carries a pair of doors instead.`);
      }
    } else {
      const t = at(cor, 'meta', 'template');
      if (TEMPLATES.includes(t) && !DOOR_TEMPLATES.includes(t)) {
        notes.push(`The ${t} template has no case front to hang doors on — the doors were dropped.`);
      }
    }
  }

  function correctionNotes(rawSpec, correctedSpec) {
    const notes = [];
    const raw = migrateSpec(rawSpec);
    const rawParts = raw && raw.custom && Array.isArray(raw.custom.parts) ? raw.custom.parts : [];
    const corOk = correctedSpec && correctedSpec.custom && Array.isArray(correctedSpec.custom.parts) && correctedSpec.custom.parts.length;
    if (rawParts.length && corOk) {
      const level = correctedSpec.meta && K.LEVELS.includes(correctedSpec.meta.level) ? correctedSpec.meta.level : 'beginner';
      const s = sanitizeCustom(raw.custom, level);
      if (s.parts.length) {
        let minY = Infinity;
        for (const p of s.parts) for (const corner of Geo.obbCorners(asObB(p))) minY = Math.min(minY, corner[1]);
        const dy = r1(minY);
        if (isFinite(dy) && Math.abs(dy) > GROUND_NOTE_MM) {
          notes.push(dy > 0
            ? `The proposal floated ~${U().fmtLength(dy)} above the floor — everything was grounded (this tool only builds floor-standing pieces).`
            : `The proposal sat ~${U().fmtLength(-dy)} below the floor — everything was raised onto it (this tool only builds floor-standing pieces).`);
        }
      }
    }
    if (correctedSpec && typeof correctedSpec === 'object') {
      // A custom piece derives its overall from the composition's own extents
      // and never reads structure.*, so neither number was ever the user's to
      // lose — reporting them there would be noise, not disclosure. (Both
      // wood slots DO reach custom parts, so species notes are not gated.)
      if (at(correctedSpec, 'meta', 'template') !== 'custom') {
        dimensionNotes(raw, correctedSpec, notes);
        shelfCountNote(raw, correctedSpec, notes);
      }
      speciesNotes(raw, correctedSpec, notes);
      joineryNotes(raw, correctedSpec, notes);
      drawerNote(raw, correctedSpec, notes);
      doorNotes(raw, correctedSpec, notes);
      seatNotes(raw, correctedSpec, notes);
      bedNotes(raw, correctedSpec, notes);
      exposureNotes(raw, correctedSpec, notes);
      childNotes(raw, correctedSpec, notes);
    }
    return [...new Set(notes)];
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

  /* ---------------- seating correction (the 'seating' class) ----------------
   * The chair/stool template's family rules. The numbers and their sources
   * live in the class contract (BB.Classes, 'seating'); this applies them.
   * Deterministic, idempotent, silent — seatNotes() reports what was refused.
   */
  function correctSeat(s) {
    const C = BB.Classes ? BB.Classes.get('seating') : null;
    const G = C ? C.geom : null;
    const se = isObj(s.seat) ? s.seat : {};
    const out = {};
    /* ---- children's scope (the 'childrens' class) ----
     * The age band IS the seat: EN 1729 size-mark seat height with the
     * class-derived plan (CHILD_GEOM.seatPlan — arithmetic documented in the
     * contract). A child chair is always BACKED and floor-serving: backless
     * perches and counter/bar stools put a small child at fall height, so
     * backHeight > 0 and counterHeight = null are forced (childNotes says
     * why). Slope and rake keep the seating class's own rules. */
    const childCls = s.child && BB.Classes ? BB.Classes.get('childrens') : null;
    if (childCls && K.CHILD && K.CHILD.BANDS[s.child.ageBand]) {
      const plan = childCls.geom.seatPlan(s.child.ageBand);
      out.width = plan.width;
      out.depth = plan.depth;
      out.height = plan.height;
      out.backHeight = plan.backHeight;
      out.counterHeight = null;
      out.slopeDeg = r1(clamp(num(se.slopeDeg, 3), 0, 8));
      out.splayDeg = 0;
      let kidRake = clamp(num(se.backRake, 4), 0, 8);
      if (G) kidRake = Math.min(kidRake, G.backRakeMax(s.structure, out));
      out.backRake = r1(Math.max(0, kidRake));
      return out;
    }
    out.width = applyDim('seat.width', se.width);
    out.depth = applyDim('seat.depth', se.depth);
    /* Back: 0 = stool; otherwise the crest rides a fixed band ABOVE the seat
     * (total back height moves with the seat, so a counter stool with a back
     * stays proportioned). */
    const bhRaw = num(se.backHeight, 470);
    out.backHeight = bhRaw <= 0 ? 0 : Math.round(clamp(bhRaw, 380, 600));
    const stool = out.backHeight === 0;
    /* Counter coupling: a stool serving a stated counter GETS its seat height
     * from it — 250 to 300 below the surface (the class contract cites the
     * source). A height already inside that window is the user's own tweak
     * and survives; anything else snaps to the 270 midpoint. */
    out.counterHeight = num(se.counterHeight, null);
    /* Capped at 1100 so the WHOLE coupling window stays inside the exported
     * seat.height rule (380–850): the Adjust rail and inspector read
     * DIM_RULES as the authoritative bounds, and the coupling must never
     * deliver a height past them (counter − 250 ≤ 850 → counter ≤ 1100).
     * Real bar tops run 1016–1067 mm, so 1100 loses nothing buildable. */
    if (out.counterHeight !== null) out.counterHeight = r1(clamp(out.counterHeight, 700, 1100));
    let h = applyDim('seat.height', se.height);
    if (out.counterHeight !== null) {
      const drop = G ? G.COUNTER_DROP : 270;
      const lo = out.counterHeight - 300, hi = out.counterHeight - 250;
      if (h < lo || h > hi) h = out.counterHeight - drop;
    } else if (!stool) {
      h = clamp(h, 380, 500); // a chair with no counter named is dining seating
    }
    out.height = r1(h);
    // Stools carry level seats (you perch square); chairs slope a few
    // degrees rearward per the human-factors table.
    out.slopeDeg = stool ? 0 : r1(clamp(num(se.slopeDeg, 3), 0, 8));
    /* Splay is a STOOL move: a backed chair in this class keeps vertical
     * legs — the back's offset-rail rake geometry assumes them. */
    out.splayDeg = stool ? r1(clamp(num(se.splayDeg, 4), 0, 10)) : 0;
    /* Rake is bounded by what STRAIGHT rear posts can give: the crest rail
     * and the bottom slat offset in opposite directions within the post
     * depth. Asking for more means a sawn or bent rear leg — short grain at
     * the bend, a real-world chair failure — so the class refuses it rather
     * than building it (seatNotes says so). */
    let rake = clamp(num(se.backRake, 4), 0, 8);
    if (!stool && G) rake = Math.min(rake, G.backRakeMax(s.structure, out));
    out.backRake = r1(stool ? 0 : Math.max(0, rake));
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
    /* Junk tolerance: a scalar where an object section belongs ("meta":"junk",
     * "overall":42, "wood":"oak") must CORRECT, never throw — a tampered save
     * or a raw API spec can carry anything, and this function's contract is
     * "never throws". null keeps its meaning where the schema says so
     * (drawers/doors: removed). */
    for (const key of ['meta', 'overall', 'structure', 'wood', 'joinery', 'seat', 'bed', 'wall', 'custom', 'hardware']) {
      if (s[key] !== undefined && !isObj(s[key])) {
        const d = defaultSpec(template)[key];
        s[key] = isObj(d) ? d : null;
      }
    }
    for (const key of ['drawers', 'doors']) {
      if (s[key] !== undefined && s[key] !== null && !isObj(s[key])) s[key] = null;
    }
    s.specVersion = SPEC_VERSION;
    s.meta.template = template;
    if (!K.LEVELS.includes(s.meta.level)) s.meta.level = 'beginner';
    // Imperial is the default; only an explicit metric choice stays metric.
    if (s.meta.units !== 'mm') s.meta.units = 'in';
    s.meta.name = String(s.meta.name || 'Untitled').slice(0, 60);

    /* ---- children's scope sanitize (the 'childrens' class) ----
     * `child` is a SCOPE over an existing template, never a template: it
     * rides only the templates the class contract names (table, desk,
     * chair, bookshelf — the ones already generated soundly), an unknown
     * band falls to `school`, and on any other template the scope is
     * dropped (childNotes discloses both). Sanitized FIRST so the seat
     * family and the height couplings below can read it. */
    const CHILD_TEMPLATES = ['table', 'desk', 'chair', 'bookshelf'];
    if (isObj(s.child) && CHILD_TEMPLATES.includes(template) && K.CHILD) {
      s.child = { ageBand: K.CHILD.BANDS[s.child.ageBand] ? s.child.ageBand : 'school' };
    } else {
      s.child = null;
    }

    const o = s.overall, st = s.structure;
    if (template !== 'custom') {
      o.width = applyDim('overall.width', o.width);
      o.depth = applyDim('overall.depth', o.depth);
      o.height = applyDim('overall.height', o.height);
    }

    if (!K.WOOD_SPECIES[s.wood.species] || K.WOOD_SPECIES[s.wood.species].sheet) s.wood.species = 'red_oak';
    // Sheet stock is its own choice (2026 expansion): any `sheet: true`
    // species is valid; anything else — including a solid species — snaps
    // back to the Baltic default.
    const sheetSp = K.WOOD_SPECIES[s.wood.sheetSpecies];
    if (!sheetSp || !sheetSp.sheet) s.wood.sheetSpecies = 'baltic_birch';

    /* ---- outdoor exposure (2026-08, the exposure overlay) ----
     * One field routes the material consequences; junk falls to interior.
     * EXPOSED corrects a non-durable species to the deterministic durable
     * substitute (the species table's `outdoor` flags are the authority;
     * exposureNotes tells the substitution) — the bed class's glued-rail
     * override pattern. COVERED keeps the species and validation carries the
     * durability advisory instead. Idempotent: a durable species and an
     * exterior finish both pass through untouched. */
    s.exposure = K.EXPOSURES.includes(s.exposure) ? s.exposure : 'interior';
    if (s.exposure === 'exposed') {
      s.wood.species = K.outdoorSubstitute(s.wood.species);
    }

    st.topThickness = applyDim('structure.topThickness', st.topThickness);
    st.legThickness = applyDim('structure.legThickness', st.legThickness);
    st.apronThickness = applyDim('structure.apronThickness', st.apronThickness);
    st.apronHeight = applyDim('structure.apronHeight', st.apronHeight);
    st.apronInset = applyDim('structure.apronInset', st.apronInset);
    st.shelfThickness = applyDim('structure.shelfThickness', st.shelfThickness);
    st.sideThickness = applyDim('structure.sideThickness', st.sideThickness);
    st.shelfCount = clamp(Math.round(num(st.shelfCount, SHELF_COUNT.def)), SHELF_COUNT.min, SHELF_COUNT.max);
    st.backPanel = !!st.backPanel;
    st.toeKick = template === 'cabinet' ? !!st.toeKick : false;

    /* Stretchers brace a leg-and-apron frame; there is nothing for them to
     * span on a carcass, so the whole idea is refused outside table-likes
     * rather than silently built into a bookshelf. Chairs run their own
     * stretcher rules in the seating block below. */
    st.stretcher = ((FRAME_TEMPLATES.includes(template) || template === 'chair') && STRETCHERS.includes(st.stretcher)) ? st.stretcher : 'none';
    st.stretcherHeight = applyDim('structure.stretcherHeight', st.stretcherHeight);

    /* ---- children's heights (the 'childrens' class) ----
     * The age band IS the height on a child table or desk: EN 1729 pairs a
     * seat with a table per size mark, and the band's table height is pinned
     * by code (K.CHILD — one source; childNotes discloses a refused ask).
     * The apron band caps at the class's APRON_MAX so the band's own thigh
     * room survives under the lower top (derivation in the contract).
     * Bookshelf child scope changes no geometry — its regime is the anchor
     * mandate and the finish advisory. */
    if (s.child && (template === 'table' || template === 'desk') && K.CHILD) {
      const cG = BB.Classes ? BB.Classes.get('childrens').geom : { APRON_MAX: 80 };
      o.height = K.CHILD.BANDS[s.child.ageBand].tableH;
      st.apronHeight = Math.min(st.apronHeight, cG.APRON_MAX);
    }

    /* ---- seating (the 'seating' class family) ----
     * The seat section is corrected first, then the OVERALL is derived from
     * it — splayed stool legs widen the floor footprint, and the audit's
     * envelope check judges parts against overall, so overall must be the
     * true envelope, exactly as a custom piece derives its extents. */
    if (template === 'chair') {
      s.seat = correctSeat(s);
      const seat = s.seat;
      const stool = seat.backHeight === 0;
      const G = BB.Classes ? BB.Classes.get('seating').geom : null;
      /* Seat rails are the chair's structure: keep the rail band inside the
       * seat height (rail bottom must clear the stretcher and the floor). */
      st.apronHeight = Math.min(st.apronHeight, Math.max(50, seat.height - st.topThickness - 160));
      const railBottom = seat.height - st.topThickness - st.apronHeight;
      if (stool) {
        /* A stool's footrest is structure AND ergonomics, not an option: the
         * box stretcher braces the splayed legs and carries a standing foot.
         * Its line comes from the footrest drop (class contract, sourced). */
        st.stretcher = 'box';
        const drop = G ? G.FOOTREST_DROP : 230;
        st.stretcherHeight = Math.round(clamp(seat.height - drop, 100, Math.max(100, railBottom - 60)));
      } else {
        /* A chair is never unbraced: without stretchers the whole rear-tilt
         * couple lands on the rail joints alone (see chair:tilt). 'none'
         * arrives from the pre-seating migration defaults, so the height is
         * re-derived from the seat rather than inherited from a table. */
        if (!STRETCHERS.includes(st.stretcher) || st.stretcher === 'none') {
          st.stretcher = 'h';
          st.stretcherHeight = Math.round(seat.height * 0.45);
        }
        st.stretcherHeight = Math.round(clamp(st.stretcherHeight, 100, Math.max(100, railBottom - 60)));
      }
      const run = seat.splayDeg > 0 ? Math.tan(seat.splayDeg * Math.PI / 180) * (seat.height - st.topThickness) : 0;
      // Mutate in place: `o` aliases s.overall for the rest of correction.
      o.width = r1(seat.width + 2 * run);
      o.depth = r1(seat.depth + 2 * run);
      o.height = r1(seat.height + seat.backHeight);
    } else {
      s.seat = null;
    }

    /* ---- wall-mounted (the 'wall_mounted' class) ----
     * Depth caps at the fixing class (300); past 250 the shelf must run 32+
     * thick (K.ERGONOMICS floating_shelf_depth note). Height is DERIVED:
     * cleat + shelf — the assembly, not a room position. Substrate is
     * sanitized but NEVER invented: junk falls to the stud default, an
     * explicit 'unknown' or 'drywall' survives so validation can refuse it. */
    if (template === 'wall_shelf') {
      const G = BB.Classes ? BB.Classes.get('wall_mounted').geom : { CLEAT_H: 70, STUD_SPACINGS: [406, 610] };
      const w = isObj(s.wall) ? s.wall : {};
      o.depth = r1(clamp(o.depth, 200, 300));
      if (o.depth > 250) st.topThickness = Math.max(st.topThickness, 32);
      o.height = r1(G.CLEAT_H + st.topThickness);
      s.wall = {
        substrate: ['stud', 'masonry', 'unknown', 'drywall'].includes(w.substrate) ? w.substrate : 'stud',
        studSpacingMM: G.STUD_SPACINGS.includes(w.studSpacingMM) ? w.studSpacingMM : 406
      };
      s.drawers = null; s.doors = null;
    } else {
      s.wall = null;
    }

    /* ---- beds (the 'bed' class) ----
     * The mattress size is the master input: interior = mattress + fit
     * clearance, overall derived from it plus the rail structure. The
     * knock-down mandate is re-enforced (a glued bed cannot leave the room),
     * and the centre-rail rule rides the builder (width ≥ 1350 always gets
     * one — Sealy/Stearns & Foster warranty practice, see the contract). */
    if (template === 'bed') {
      const C = BB.Classes ? BB.Classes.get('bed') : null;
      const G = C ? C.geom : null;
      const b = isObj(s.bed) ? s.bed : {};
      const sizes = G ? Object.keys(G.SIZES) : ['twin', 'full', 'queen', 'king', 'cal_king'];
      const size = sizes.includes(b.size) ? b.size : 'queen';
      const platform = r1(clamp(num(b.platformHeight, 350), 250, 500));
      let hb = num(b.headboardHeight, 1000);
      hb = hb <= 0 ? 0 : r1(clamp(hb, 800, 1300));
      // The headboard must clear the rail band by a board's worth or it is trim.
      const railTop = platform + (G ? G.MATTRESS_STOP : 50);
      if (hb > 0 && hb < railTop + 150) hb = r1(railTop + 150);
      s.bed = { size, platformHeight: platform, headboardHeight: hb };
      // Rails are the structure: keep the band deep enough to carry the deck.
      st.apronHeight = clamp(st.apronHeight, 110, 160);
      st.apronThickness = Math.max(st.apronThickness, 19);
      s.joinery.frame = 'kd_bolt';
      if (G) {
        const m = G.SIZES[size];
        const Wi = m.w + G.FIT_CLEARANCE, Li = m.l + G.FIT_CLEARANCE;
        o.width = r1(Wi + 2 * st.apronThickness);
        o.depth = r1(Li + 2 * st.apronThickness);
        // Posts run 50 past the rail top (they cap the corners), so the
        // envelope is the taller of headboard and post tops.
        o.height = r1(Math.max(hb, railTop + 50));
      }
      s.drawers = null; s.doors = null;
    } else {
      s.bed = null;
    }

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

    /* A stretcher has to land on the leg, between the floor and the underside
     * of the apron. DIM_RULES cannot express that — its bounds are fixed and
     * this ceiling moves with the piece — so the geometric cap lives here,
     * with the other clamps that need the whole spec. A bench at 457 mm has
     * far less leg than a table at 737 mm, and the default 280 would land the
     * stretcher inside the apron on a low piece.
     * SECTION_MIN is the stretcher's own depth: it needs its own thickness of
     * clearance under the apron, or the two are the same piece of wood. */
    if (st.stretcher !== 'none' && template !== 'chair') {
      const apronUnderside = o.height - st.topThickness - st.apronHeight;
      const ceiling = apronUnderside - STRETCHER_APRON_GAP;
      const floor_ = STRETCHER_FLOOR_MIN;
      // A piece with no room at all keeps its stretcher and gets the highest
      // legal line rather than being silently unbraced: `ceiling < floor_`
      // means the legs are too short for any stretcher, which the buildability
      // audit reports honestly instead of correction hiding it.
      st.stretcherHeight = ceiling >= floor_
        ? clamp(st.stretcherHeight, floor_, ceiling)
        : Math.max(floor_, Math.round(apronUnderside / 2));
    }

    // Joint gating: code, not the model, enforces the level matrix.
    const lvl = s.meta.level;
    for (const kind of ['frame', 'case', 'box']) {
      if (!K.jointAllowed(s.joinery[kind], lvl, kind)) s.joinery[kind] = K.JOINT_DEFAULTS[lvl][kind];
    }
    /* Seating class mandate ON TOP of the level matrix: a chair's seat-frame
     * joints resist the rear-tilt racking couple, and screws, biscuits, and
     * dowels do not carry it at ANY level (the class contract shows the
     * computed margins). The allowed set and per-level defaults live in
     * BB.Classes ('seating'); seatNotes discloses the substitution. */
    if (template === 'chair' && BB.Classes) {
      s.joinery.frame = BB.Classes.get('seating').enforceFrameJoint(s.joinery.frame, lvl);
    }
    if (!K.FINISHES.some(f => f.key === s.finish)) s.finish = 'wipe_poly';
    /* Outdoor finish routing: only an exterior-rated film survives outdoors
     * (UV blockers + flex — spar_urethane is the catalog's exterior row), so
     * covered and exposed builds are corrected onto it and exposureNotes
     * tells. Interior designs are untouched byte-for-byte. */
    if (s.exposure !== 'interior') {
      const finRow = K.FINISHES.find(f => f.key === s.finish);
      if (!finRow || !finRow.exterior) s.finish = 'spar_urethane';
    }

    // Hardware style intent (2026 expansion): the AI proposes a pull STYLE;
    // code owns every count, size, spacing, and bore (BB.HW).
    s.hardware = s.hardware && typeof s.hardware === 'object' ? s.hardware : {};
    if (!BB.HW || !BB.HW.PULLS[s.hardware.pull]) s.hardware.pull = 'bar_pull';

    /* Doors (X-07). Geometry intent lives in `doors`; the hinge is a STYLE,
     * so it sits with the pull in `hardware` — code owns the count, the
     * boring, and the capacity, exactly as it does for pulls.
     * Order matters: this runs before the drawer block below, because a
     * cabinet's door zone is what the drawer bank leaves behind. */
    if (s.doors && DOOR_TEMPLATES.includes(template)) {
      const d = s.doors;
      d.style = DOOR_STYLES.includes(d.style) ? d.style : 'overlay';
      d.count = clamp(Math.round(num(d.count, 2)), 1, 2);
      // A single door wider than one person can swing is a pair, whatever
      // was asked for. Correction owns geometry.
      const leafW = o.width / d.count;
      if (d.count === 1 && leafW > DOOR_MAX_SINGLE_W) d.count = 2;
    } else {
      s.doors = null;
    }
    /* The hinge must physically suit the door style it is hanging — the
     * catalog carries that as `fronts`, so the rule reads off the same table
     * the Shop Reference teaches from rather than a second hand-kept list.
     * A knife hinge on an overlay door is not a preference, it is a hinge
     * that cannot be fitted. */
    if (BB.HW) {
      const style = s.doors ? s.doors.style : null;
      const h = BB.HW.HINGES[s.hardware.hinge];
      const fits = h && (!style || (h.fronts || []).includes(style));
      if (!fits) {
        s.hardware.hinge = style === 'inset' ? 'butt_brass' : 'euro_cup';
      }
    }

    /* Desk apron drawers (frame_table extension, 2026-07): the drawer lives
     * INSIDE the apron band — the top is its kicker, the front apron becomes
     * a lower rail under the opening, and the box rides wooden runners hung
     * between the front rail and the rear apron. That construction fixes the
     * knobs: fronts are inset (there is no case face to overlay), runners
     * are wood at EVERY level (there is no case side to screw a slide to —
     * the beginner gate below is a casework rule, not an apron rule), and
     * the band must be deep enough to leave a lower rail under a usable
     * pencil-drawer opening. */
    if (s.drawers && template === 'desk') {
      const d = s.drawers;
      d.count = clamp(Math.round(num(d.count, 1)), 1, 2);
      d.frontStyle = 'inset';
      d.runner = 'wood_runners';
      st.apronHeight = Math.max(st.apronHeight, 90);
      // A single drawer wider than a pencil drawer racks on its runners —
      // the band splits into a pair around a centre stile, exactly as a
      // too-wide door splits into a pair. Same deterministic rule the
      // builder reads (35 mm overhang is the frame builder's own constant).
      const clearW = o.width - 2 * 35 - 2 * st.legThickness;
      if (d.count === 1 && clearW > 620) d.count = 2;
    }

    // Drawers: only templates with openings support them.
    if (s.drawers && (template === 'nightstand' || template === 'cabinet')) {
      const d = s.drawers;
      d.count = clamp(Math.round(num(d.count, 1)), 1, 4);
      d.frontStyle = d.frontStyle === 'overlay' ? 'overlay' : 'inset';
      /* Drawers and doors on the same case share one front plane, so they
       * share one style. Mixing them is not a taste — an overlay drawer
       * front stands proud of exactly the face an inset door sits behind,
       * and the two occupy the same wood. Correction owns geometry, so the
       * doors win and correctionNotes reports the change. */
      if (s.doors && d.frontStyle !== s.doors.style) d.frontStyle = s.doors.style;
      d.runner = ['wood_runners', 'undermount_slides'].includes(d.runner) ? d.runner : 'side_mount_slides';
      // Fussier running gear is gated past beginner: wood runners need
      // fitting, undermounts forgive nothing (box built to the slide).
      if (d.runner !== 'side_mount_slides' && lvl === 'beginner') d.runner = 'side_mount_slides';
      // Reduce count until every opening clears the 80 mm minimum (correction
      // owns geometry; validation only reports what remains).
      while (d.count > 1 && BB.Parametric && BB.Parametric.openingHeightFor(s) < 80) d.count--;
    } else if (template !== 'desk') {
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
  // Applied fronts and the hardware on them stand proud of the case front by
  // design. A DOOR is the same class of object as a drawer front — same face,
  // same overlay convention — so it is measured the same way rather than
  // being given a rule of its own.
  const PROUD_ROLES = { pull: true, drawer_front: true, door: true };

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

    /* Wall-mounted classes hang by design: the mount plane, not the floor,
     * is their datum, so the floor and footprint invariants are exempted —
     * for exactly the classes whose contract declares `mounted: 'wall'` and
     * carries the anchor math that replaces them. Everything else keeps the
     * floor doctrine untouched. */
    const wallMounted = !!(BB.Classes && BB.Classes.forTemplate(spec.meta.template) &&
      BB.Classes.forTemplate(spec.meta.template).mounted === 'wall');

    // 1. The floor plane is real: nothing passes through it, something rests on it.
    let globalMinY = Infinity;
    for (const p of parts) {
      const my = minY.get(p.id);
      globalMinY = Math.min(globalMinY, my);
      if (!wallMounted && my < -AUDIT.BELOW_EPS) {
        errors.push({ id: 'geom_below:' + p.id, text: `“${p.name}” (${p.id}) extends ${fine(-my)} below the floor — wood can’t pass through the ground.` });
      }
    }
    if (!wallMounted && globalMinY > AUDIT.FLOOR_EPS) {
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
    if (!wallMounted && globalMinY <= AUDIT.FLOOR_EPS) { // otherwise geom_floats already covers it; wall classes stand on the wall
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
      // Child-scoped pieces are sized by the EN 1729 band (K.CHILD), not the
      // adult height rows — a 530 mm preschool table judged against the
      // 730–760 dining band would advise against its own correctness.
      if (spec.child && row.axis === 'height') continue;
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

    /* Seating human factors (the 'seating' class contract carries the table
     * WITH sources; advisories never block — a boundary chair is legal, just
     * named). The counter-coupling ask lives in the integrity checks
     * (chair:counter); these are the body-fit bands. */
    if (t === 'chair' && spec.seat && !spec.child && BB.Classes) {
      // (child-scoped chairs are pinned to the EN 1729 band by correction —
      // judging them against the ADULT body-fit bands would be noise)
      const hf = Object.fromEntries(BB.Classes.get('seating').humanFactors.map(h => [h.key, h]));
      const se = spec.seat;
      const stool = se.backHeight === 0;
      const band = (row, v, id, what) => {
        if (!row || (v >= row.min && v <= row.max)) return;
        const dir = v > row.max ? 'above' : 'below';
        advisories.push({ id, text: `${fmt(v)} is ${dir} the ${fmt(row.min)} to ${fmt(row.max)} ${what} band (${row.source.split('(')[0].trim()}).` });
      };
      if (!stool) {
        band(hf.dining_seat_height, se.height, 'ergo_seat_height', 'dining seat height');
      } else if (se.counterHeight === null) {
        // No counter named: judge against BOTH stool bands; outside both is
        // a stool serving no surface anyone stated.
        const c = hf.counter_stool_seat, b = hf.bar_stool_seat;
        const inC = c && se.height >= c.min && se.height <= c.max;
        const inB = b && se.height >= b.min && se.height <= b.max;
        const inBench = se.height >= 430 && se.height <= 480; // a low perch stool is legitimate
        if (!inC && !inB && !inBench) {
          advisories.push({ id: 'ergo_seat_height', text: `${fmt(se.height)} matches no seating band (dining ${fmt(430)}–${fmt(480)}, counter ${fmt(c.min)}–${fmt(c.max)}, bar ${fmt(b.min)}–${fmt(b.max)}). Name the counter it serves and the height will be derived.` });
        }
      }
      band(hf.seat_depth, se.depth, 'ergo_seat_depth', 'seat depth');
      band(hf.seat_width, se.width, 'ergo_seat_width', 'seat width');
    }

    /* Wall-mounted refusals (the 'wall_mounted' class): the wall carries the
     * whole load path, so an unknown substrate is a hard error — the refusal
     * the class contract states — and drywall-only gets its own, because it
     * arrives asked-for and deserves the reason. */
    if (t === 'wall_shelf' && spec.wall) {
      if (spec.wall.substrate === 'unknown') {
        errors.push({ id: 'wall_substrate', text: 'What is this wall? A shelf hangs on its substrate, and the anchor math needs it: wood studs or masonry. Hanging on an unknown wall is a guess — worse than a refusal.' });
      } else if (spec.wall.substrate === 'drywall') {
        errors.push({ id: 'wall_substrate', text: 'Drywall alone can’t carry a shelf: anchors creep under sustained load and their listed ratings are ultimate, not working values. Find the studs behind it (16 or 24 in apart) or name a masonry wall.' });
      }
    }

    /* ---- outdoor exposure (2026-08): refusals and named advisories ----
     * Sheet goods have no exterior-rated row in the catalog, so an EXPOSED
     * design that actually consumes sheet stock is refused with the reason
     * (covered gets the advisory — sheltered from direct wetting, but with
     * no rating to lean on). Water traps are NAMED, never silent: end grain
     * at the leg bottoms wicks, horizontal surfaces pond. A wall shelf
     * cannot be exposed: its anchor math uses NDS dry-service withdrawal
     * values (MC ≤ 19%), and direct wetting crosses into wet service (NDS
     * wet-service factor CM = 0.7 on withdrawal) — a derating the
     * wall_mounted class does not carry. */
    if (spec.exposure === 'covered' || spec.exposure === 'exposed') {
      const exposed = spec.exposure === 'exposed';
      const sheetParts = model && model.parts
        ? model.parts.filter(p => K.WOOD_SPECIES[p.material] && K.WOOD_SPECIES[p.material].sheet) : [];
      if (sheetParts.length) {
        const names = [...new Set(sheetParts.map(p => p.name.toLowerCase()))].slice(0, 3).join(', ');
        if (exposed) {
          errors.push({ id: 'out_sheet', text: `This exposed build uses interior sheet stock (${names}) and no exterior-rated sheet good exists in this catalog — interior plywood delaminates and MDF swells the first time rain finds it. Remove the sheet parts (drawers, back panel), put the piece under cover, or keep it indoors. A guessed exterior rating would be worse than this refusal.` });
        } else {
          advisories.push({ id: 'out_sheet', text: `Covered outdoors, the sheet parts (${names}) stay out of the rain but carry no exterior rating — seal every edge, keep them off wet floors, and know that direct weather would be a refusal, not an upgrade.` });
        }
      }
      if (exposed && t === 'wall_shelf') {
        errors.push({ id: 'out_mount', text: 'A wall shelf can’t hang in direct weather: the anchor math uses NDS dry-service withdrawal values (moisture content ≤ 19%), and rain-wetted framing crosses into wet service — NDS derates withdrawal to 0.7×, a factor this model doesn’t carry. A covered porch wall stays dry-service and is fine.' });
      }
      const spx = K.WOOD_SPECIES[spec.wood.species];
      if (!exposed && spx && !spx.outdoor) {
        advisories.push({ id: 'out_species', text: `${spx.label} isn’t decay-resistant — a roof keeps the rain off, but expect faster greying and bigger seasonal movement than indoors, and never let it stand wet. In direct weather it would be corrected to a durable species.` });
      }
      if (exposed && t !== 'wall_shelf') {
        advisories.push({ id: 'out_legs', text: 'Leg bottoms are end grain — they wick standing water like a straw. Seal them (thinned epoxy or extra finish coats), chamfer the bottom edges, and keep the feet on pavers or glides, never soil or grass: ground contact needs preservative-treated stock this catalog doesn’t carry.' });
        advisories.push({ id: 'out_drain', text: 'Water must drain, not sit: upward-facing end grain and open joint mouths trap rain, so orient mortises and slots where they can’t hold water, seal every exposed end-grain surface, and let horizontal surfaces shed (a slight slope or slat gaps). Recoat the finish before it peels — a failed film traps water against the wood.' });
      }
    }

    /* Bed human factors: the platform band, said with its consequence. */
    if (t === 'bed' && spec.bed && BB.Classes) {
      const row = K.ergoRow('platform_bed_height');
      const ph = spec.bed.platformHeight;
      if (row && (ph < row.min || ph > row.max)) {
        advisories.push({ id: 'ergo_platform', text: `${fmt(ph)} deck height is outside the ${fmt(row.min)}–${fmt(row.max)} platform band — with a mattress the sleeping surface should land ${fmt(500)}–${fmt(650)} off the floor (K.ERGONOMICS).` });
      }
    }

    /* Desk knee room (frame_table coupling): the seated knee needs the air
     * under the band. Residential desks commonly run ~600–640 clear; ADA
     * 306.3 asks 685 for an accessible workstation — both are named, and
     * the advisory never blocks. */
    if (t === 'desk' && !spec.child) {
      // (the 600 mm band is ADULT seated knee room — a child desk is judged
      // by its EN 1729 pair, and the child apron cap keeps the thigh room)
      const clear = o.height - spec.structure.topThickness - spec.structure.apronHeight;
      if (clear < 600) {
        advisories.push({ id: 'ergo_knee', text: `${fmt(clear)} of knee clearance under the ${spec.drawers ? 'drawer band' : 'apron'} is below the ~${fmt(600)} seated-knee band (Panero & Zelnik; ADA 306.3 asks ${fmt(685)} for accessible desks). Shallower ${spec.drawers ? 'band' : 'aprons'} or a taller desk buys it back.` });
      }
    }

    /* Children's finish safety (the 'childrens' class): every child-scoped
     * design names the finish-safety ground truth — children mouth what they
     * touch. Verified basis: EN 71-3 ("Safety of toys — Migration of certain
     * elements") is the certification route for child-safe coatings; the
     * catalog's foodContact finishes (pure tung oil, mineral oil, board
     * butter) are food-contact class [FDA framing: shellac resin is listed
     * under 21 CFR 175.300, but hardware-store premixed shellac carries no
     * food/toy certification — so no product is blessed]. An uncertified
     * film finish is COMMONLY considered inert once fully cured; that is
     * practice, not a certification, and the advisory says which. */
    if (spec.child) {
      const cf = K.FINISHES.find(f => f.key === spec.finish);
      const cured = cf && cf.foodContact
        ? `${cf.label} is a food-contact-class finish — the safest family for a child's piece; still allow the full cure${cf.cureDays ? ` (${cf.cureDays} days)` : ''} before handover.`
        : `${cf ? cf.label : 'The chosen finish'} carries no toy-safety certification: a fully cured film finish is commonly considered inert, but that is practice, not a certificate.`;
      advisories.push({
        id: 'child_finish',
        text: `Child-scoped piece: children mouth what they touch. ${cured} For a certified route use a finish tested to EN 71-3 (toy-safety migration limits) — or a food-contact finish like pure tung oil; note hardware-store premixed shellac is not food/toy certified even though shellac resin itself is FDA-listed (21 CFR 175.300).`
      });
    }

    // Outdoor hardware truth (2026 hardware expansion; extended by the 2026-08
    // exposure model): outdoor duty means corrosion-resistant fittings, and a
    // tannin-rich species (oak, cedar — WRCLA/Real Cedar guidance) earns the
    // iron-stain warning by name.
    const finRow = K.FINISHES.find(f => f.key === spec.finish);
    const spRow = K.WOOD_SPECIES[spec.wood.species];
    const outdoorDuty = K.isOutdoor(spec);
    if (finRow && finRow.exterior && BB.HW && spRow &&
      (outdoorDuty || spRow.outdoor || BB.HW.GATES.outdoorHardware.tannicSpecies.includes(spRow.key))) {
      const tannic = BB.HW.GATES.outdoorHardware.tannicSpecies.includes(spRow.key);
      advisories.push({
        id: 'hw_outdoor',
        text: tannic
          ? `Outdoor duty: every screw, hinge, and fitting must be ${K.OUTDOOR_FASTENER_SPEC} — plain steel reacts with tannin-rich ${spRow.label.toLowerCase()} and streaks it blue-black in the rain (electroplated zinc is too thin to last).`
          : `Outdoor duty: every screw, hinge, and fitting must be ${K.OUTDOOR_FASTENER_SPEC} — plain and electroplated steel rust outdoors, and the BOM's fastener lines say so.`
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
    /* Desk apron drawers are PENCIL drawers: the class accepts a 45 mm
     * opening (the band could never hold the 80 mm casework minimum without
     * eating the knee room) — a frame_table coupling, documented there. */
    const drMinH = t === 'desk' ? 45 : K.ergoRow('drawer_min_height').min;
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
    /* Read-only clamp tables. Exported so every surface that offers a
     * dimension (the Adjust rail's sliders, the inspector) reads the SAME
     * bounds correction enforces — a control that offers a value the pipeline
     * silently clamps is the silent-correction defect all over again. Shape is
     * `{ min, max, def, stock? }` keyed by dotted spec path; never mutate. */
    DIM_RULES, SHELF_COUNT,
    defaultSpec, defaultCustom, clone, deepMerge, diffSpecs, describeDiff, reconcileAck, integrityLine,
    correctSpec, correctionNotes, validate, auditModel, AUDIT, fmtValue, PATH_LABELS,
    customPartSize, customExtents, customGrainInfo, endGrainBearing, scaleCustom
  };
})();
