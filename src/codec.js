/* Blueprint Buddy — compact wire codec (Phase 4).
 * The response cap is 1000 tokens and every call resends context, so the wire
 * format is a first-class engineering concern. ALL AI traffic and share codes
 * route through this module.
 *
 * Internal specs stay verbose and readable; on the wire we use a documented
 * short-key format: single-letter keys, dimensions as arrays, enums as small
 * integers, novel-grammar primitives as flat arrays. encode() and decode()
 * are exact inverses over corrected specs — the self-test harness proves it.
 * The compact schema is documented ONCE, statically, in SCHEMA_DOC; it is
 * never re-explained per message.
 */
var BB = globalThis.BB = globalThis.BB || {};

(function () {
  'use strict';

  /* ---------------- enum tables (order is the wire contract — append only) ---------------- */
  const TPL = ['table', 'desk', 'bench', 'bookshelf', 'nightstand', 'cabinet', 'custom'];
  const SPC = ['red_oak', 'white_oak', 'hard_maple', 'walnut', 'cherry', 'ash', 'poplar', 'pine', 'baltic_birch',
    // 2026 knowledge expansion — appended in this exact order; old share codes decode unchanged.
    'douglas_fir', 'syp', 'spf', 'western_red_cedar', 'soft_maple', 'hickory', 'beech', 'yellow_birch',
    'red_alder', 'sapele', 'teak', 'mdf', 'hardwood_ply'];
  const JNT = ['butt_screws', 'pocket_screws', 'dowels', 'dado', 'rabbet', 'locking_rabbet', 'mortise_tenon', 'half_blind_dovetail',
    // 2026 knowledge expansion — append only.
    'edge_glue', 'half_lap', 'cross_lap', 'bridle', 'loose_tenon', 'box_joint', 'through_dovetail',
    'sliding_dovetail', 'miter_spline', 'staked_tenon', 'biscuits', 'french_cleat', 'kd_bolt'];
  const FIN = ['wipe_poly', 'danish_oil', 'water_poly', 'hardwax_oil',
    // 2026 knowledge expansion — append only.
    'mineral_oil', 'board_butter', 'tung_pure', 'shellac', 'spar_urethane', 'paint_system'];
  const LVL = ['beginner', 'intermediate', 'advanced'];
  const UNITS = ['mm', 'in'];
  const FRONT = ['inset', 'overlay'];
  // RUN and PUL: 2026 hardware expansion — append only. PUL is pull STYLE
  // intent; every count, size, and bore is computed by code (BB.HW).
  const RUN = ['side_mount_slides', 'wood_runners', 'undermount_slides'];
  const PUL = ['bar_pull', 'knob_round', 'knob_turned_wood', 'cup_pull', 'ring_pull',
    'edge_pull', 'flush_recessed', 'appliance_pull', 'leather_pull', 'none_touch'];
  // HNG: LIVE cabinet-door hinge styles only (append-only). Lid hinges stay
  // READY without a wire enum until a lids consumer exists.
  const HNG = ['euro_cup', 'butt_brass', 'no_mortise'];
  const PRIM = ['post', 'rail', 'panel', 'slab', 'cylinder'];
  const SURF = ['none', 'seating', 'worktop', 'shelf'];
  const GRAIN = ['length', 'width'];
  const STK = ['solid', 'sheet'];

  const ix = (arr, v, dflt) => { const i = arr.indexOf(v); return i >= 0 ? i : dflt; };
  const at = (arr, i, dflt) => (Number.isInteger(i) && i >= 0 && i < arr.length ? arr[i] : dflt);

  /* structure short keys (partial-merge friendly) */
  const S_KEYS = [
    ['t', 'topThickness'], ['l', 'legThickness'], ['a', 'apronHeight'], ['at', 'apronThickness'],
    ['ai', 'apronInset'], ['c', 'shelfCount'], ['st', 'shelfThickness'], ['sd', 'sideThickness'],
    ['b', 'backPanel'], ['k', 'toeKick'],
    // x=stretchers (table/desk/bench) — append-only; omit for false default
    ['x', 'stretchers']
  ];

  /* ---------------- encode: verbose corrected spec -> wire ---------------- */
  function encodePart(p) {
    const r = p.rot || { x: 0, y: 0, z: 0 };
    const arr = [
      ix(PRIM, p.primitive, 1),
      p.pos.x, p.pos.y, p.pos.z,
      p.dim.l, p.dim.w, p.dim.t,
      r.x || 0, r.y || 0, r.z || 0,
      ix(GRAIN, p.grain, 0), ix(STK, p.stock, 0),
      p.loadBearing ? 1 : 0, ix(SURF, p.surface, 0)
    ];
    if (p.role && p.role !== p.primitive) arr.push(p.role);
    return arr;
  }
  function encode(spec) {
    const w = {
      v: spec.specVersion || 4,
      n: spec.meta.name,
      t: ix(TPL, spec.meta.template, 0),
      l: ix(LVL, spec.meta.level, 0),
      u: ix(UNITS, spec.meta.units, 0),
      o: [spec.overall.width, spec.overall.depth, spec.overall.height],
      m: ix(SPC, spec.wood.species, 0),
      s: {},
      j: [ix(JNT, spec.joinery.frame, 1), ix(JNT, spec.joinery.case, 0), ix(JNT, spec.joinery.box, 1)],
      f: ix(FIN, spec.finish, 0)
    };
    // Sheet stock rides the wire only when it departs from the Baltic default,
    // so every pre-expansion design encodes byte-identically.
    if (spec.wood.sheetSpecies && spec.wood.sheetSpecies !== 'baltic_birch') {
      w.ms = ix(SPC, spec.wood.sheetSpecies, 8);
    }
    // Pull style likewise: only a non-default choice rides the wire.
    if (spec.hardware && spec.hardware.pull && spec.hardware.pull !== 'bar_pull') {
      w.hp = ix(PUL, spec.hardware.pull, 0);
    }
    // Hinge style: only a non-default (non euro_cup) rides the wire.
    if (spec.hardware && spec.hardware.hinge && spec.hardware.hinge !== 'euro_cup') {
      w.hh = ix(HNG, spec.hardware.hinge, 0);
    }
    for (const [k, path] of S_KEYS) {
      const v = spec.structure[path];
      w.s[k] = typeof v === 'boolean' ? (v ? 1 : 0) : v;
    }
    w.d = spec.drawers ? [spec.drawers.count, ix(FRONT, spec.drawers.frontStyle, 0), ix(RUN, spec.drawers.runner, 0)] : 0;
    // Cabinet doors: "do":[count,FRONT]|0 — omit when absent so legacy
    // cabinet share codes stay identical.
    if (spec.doors && spec.doors.count) {
      w.do = [spec.doors.count, ix(FRONT, spec.doors.frontStyle, 1)];
    }
    if (spec.custom && spec.meta.template === 'custom') {
      const idIndex = new Map(spec.custom.parts.map((p, i) => [p.id, i]));
      w.p = spec.custom.parts.map(encodePart);
      w.c = spec.custom.connections
        .filter(c => idIndex.has(c.a) && idIndex.has(c.b))
        .map(c => [idIndex.get(c.a), idIndex.get(c.b), ix(JNT, c.joint, 0)]);
    }
    return w;
  }

  /* ---------------- decode: wire -> verbose spec ---------------- */
  function decodePart(arr, i) {
    if (!Array.isArray(arr)) return null;
    const n = v => (typeof v === 'number' && isFinite(v) ? v : 0);
    const prim = at(PRIM, arr[0], 'rail');
    const rot = { x: n(arr[7]), y: n(arr[8]), z: n(arr[9]) };
    return {
      id: 'p' + (i + 1),
      role: typeof arr[14] === 'string' && arr[14] ? arr[14] : prim,
      primitive: prim,
      dim: { l: n(arr[4]), w: n(arr[5]), t: n(arr[6]) },
      pos: { x: n(arr[1]), y: n(arr[2]), z: n(arr[3]) },
      rot: (rot.x || rot.y || rot.z) ? rot : null,
      grain: at(GRAIN, arr[10], 'length'),
      stock: at(STK, arr[11], 'solid'),
      loadBearing: !!arr[12],
      surface: at(SURF, arr[13], 'none')
    };
  }
  function decodeStructure(s) {
    const out = {};
    if (!s || typeof s !== 'object') return out;
    for (const [k, path] of S_KEYS) {
      if (s[k] === undefined || s[k] === null) continue;
      out[path] = (path === 'backPanel' || path === 'toeKick' || path === 'stretchers') ? !!s[k] : s[k];
    }
    return out;
  }
  function decode(w) {
    if (!w || typeof w !== 'object') return null;
    const spec = {
      specVersion: typeof w.v === 'number' ? w.v : 4,
      meta: {
        name: typeof w.n === 'string' ? w.n : 'Untitled',
        template: at(TPL, w.t, 'table'),
        level: at(LVL, w.l, 'beginner'),
        units: at(UNITS, w.u, 'mm')
      },
      overall: Array.isArray(w.o)
        ? { width: w.o[0], depth: w.o[1], height: w.o[2] }
        : { width: 1000, depth: 500, height: 750 },
      wood: { species: at(SPC, w.m, 'red_oak'), sheetSpecies: at(SPC, w.ms, 'baltic_birch') },
      structure: decodeStructure(w.s),
      joinery: Array.isArray(w.j)
        ? { frame: at(JNT, w.j[0], 'pocket_screws'), case: at(JNT, w.j[1], 'butt_screws'), box: at(JNT, w.j[2], 'pocket_screws') }
        : {},
      finish: at(FIN, w.f, 'wipe_poly'),
      hardware: {
        pull: at(PUL, w.hp, 'bar_pull'),
        hinge: at(HNG, w.hh, 'euro_cup')
      },
      drawers: Array.isArray(w.d) && w.d.length
        ? { count: w.d[0], frontStyle: at(FRONT, w.d[1], 'inset'), runner: at(RUN, w.d[2], 'side_mount_slides') }
        : null,
      doors: Array.isArray(w.do) && w.do.length
        ? { count: w.do[0], frontStyle: at(FRONT, w.do[1], 'overlay') }
        : null,
      custom: null
    };
    if (Array.isArray(w.p) && spec.meta.template === 'custom') {
      const parts = w.p.map(decodePart).filter(Boolean);
      const conns = (Array.isArray(w.c) ? w.c : [])
        .filter(c => Array.isArray(c) && Number.isInteger(c[0]) && Number.isInteger(c[1]) && c[0] >= 0 && c[1] >= 0 && c[0] < parts.length && c[1] < parts.length)
        .map(c => ({ a: 'p' + (c[0] + 1), b: 'p' + (c[1] + 1), joint: at(JNT, c[2], 'butt_screws') }));
      spec.custom = { parts, connections: conns };
    }
    return spec;
  }

  /* ---------------- partial decode: wire refinement diff -> verbose patch ----------------
   * Refinement replies stay partial-merge (Phase 2), now in wire format. The
   * model sends ONLY changed keys; array keys may arrive as partial objects:
   *   o: {w,d,h}   j: {f,c,b}   d: {c,f,r}   s: {t,l,a,at,ai,c,st,sd,b,k}
   * "d":0 (or null) removes drawers. Full-array forms are also accepted.
   */
  function decodePartial(w) {
    if (!w || typeof w !== 'object') return null;
    const patch = {};
    if (typeof w.n === 'string') { patch.meta = patch.meta || {}; patch.meta.name = w.n; }
    if (w.t !== undefined) { patch.meta = patch.meta || {}; patch.meta.template = at(TPL, w.t, undefined); }
    if (w.l !== undefined) { patch.meta = patch.meta || {}; patch.meta.level = at(LVL, w.l, undefined); }
    if (w.u !== undefined) { patch.meta = patch.meta || {}; patch.meta.units = at(UNITS, w.u, undefined); }
    if (Array.isArray(w.o)) patch.overall = { width: w.o[0], depth: w.o[1], height: w.o[2] };
    else if (w.o && typeof w.o === 'object') {
      patch.overall = {};
      if (w.o.w !== undefined) patch.overall.width = w.o.w;
      if (w.o.d !== undefined) patch.overall.depth = w.o.d;
      if (w.o.h !== undefined) patch.overall.height = w.o.h;
    }
    if (w.m !== undefined) patch.wood = { species: at(SPC, w.m, undefined) };
    if (w.ms !== undefined) { patch.wood = patch.wood || {}; patch.wood.sheetSpecies = at(SPC, w.ms, undefined); }
    if (w.s !== undefined) patch.structure = decodeStructure(w.s);
    if (Array.isArray(w.j)) patch.joinery = { frame: at(JNT, w.j[0], undefined), case: at(JNT, w.j[1], undefined), box: at(JNT, w.j[2], undefined) };
    else if (w.j && typeof w.j === 'object') {
      patch.joinery = {};
      if (w.j.f !== undefined) patch.joinery.frame = at(JNT, w.j.f, undefined);
      if (w.j.c !== undefined) patch.joinery.case = at(JNT, w.j.c, undefined);
      if (w.j.b !== undefined) patch.joinery.box = at(JNT, w.j.b, undefined);
    }
    if (w.f !== undefined) patch.finish = at(FIN, w.f, undefined);
    if (w.hp !== undefined) patch.hardware = { pull: at(PUL, w.hp, undefined) };
    if (w.hh !== undefined) {
      patch.hardware = patch.hardware || {};
      patch.hardware.hinge = at(HNG, w.hh, undefined);
    }
    if (w.d !== undefined) {
      if (!w.d) patch.drawers = null;
      else if (Array.isArray(w.d)) patch.drawers = { count: w.d[0], frontStyle: at(FRONT, w.d[1], 'inset'), runner: at(RUN, w.d[2], 'side_mount_slides') };
      else if (typeof w.d === 'object') {
        patch.drawers = {};
        if (w.d.c !== undefined) patch.drawers.count = w.d.c;
        if (w.d.f !== undefined) patch.drawers.frontStyle = at(FRONT, w.d.f, undefined);
        if (w.d.r !== undefined) patch.drawers.runner = at(RUN, w.d.r, undefined);
      }
    }
    if (w.do !== undefined) {
      if (!w.do) patch.doors = null;
      else if (Array.isArray(w.do)) patch.doors = { count: w.do[0], frontStyle: at(FRONT, w.do[1], 'overlay') };
      else if (typeof w.do === 'object') {
        patch.doors = {};
        if (w.do.c !== undefined) patch.doors.count = w.do.c;
        if (w.do.f !== undefined) patch.doors.frontStyle = at(FRONT, w.do.f, undefined);
      }
    }
    /* Custom-grammar diffs stay surgical (A4): "p" and "c" are independent
     * keys. A p-only diff must NOT wipe the existing connection graph
     * (deepMerge clones arrays wholesale — omitting the key preserves it;
     * correctCustom drops connections referencing removed parts), and a
     * c-only diff (joint upgrades) must decode instead of nulling the turn. */
    const mapConns = (list, max) => list
      .filter(c => Array.isArray(c) && Number.isInteger(c[0]) && Number.isInteger(c[1]) &&
        c[0] >= 0 && c[1] >= 0 && (max == null || (c[0] < max && c[1] < max)))
      .map(c => ({ a: 'p' + (c[0] + 1), b: 'p' + (c[1] + 1), joint: at(JNT, c[2], 'butt_screws') }));
    if (Array.isArray(w.p)) {
      const parts = w.p.map(decodePart).filter(Boolean);
      patch.custom = { parts };
      if (Array.isArray(w.c)) patch.custom.connections = mapConns(w.c, parts.length);
      patch.meta = patch.meta || {};
      patch.meta.template = 'custom';
    } else if (Array.isArray(w.c)) {
      // Ids map to p1..pN of the CURRENT parts; correctCustom validates them.
      patch.custom = { connections: mapConns(w.c, null) };
    }
    // Drop values that decoded to undefined (out-of-range enum indexes) so a
    // bad index can never silently reset a field to its default (C4), then
    // drop empty sub-objects so the merge stays surgical.
    for (const k of Object.keys(patch)) {
      const v = patch[k];
      if (v && typeof v === 'object' && !Array.isArray(v)) {
        for (const kk of Object.keys(v)) if (v[kk] === undefined) delete v[kk];
        if (!Object.keys(v).length) delete patch[k];
      } else if (v === undefined) delete patch[k];
    }
    return Object.keys(patch).length ? patch : null;
  }

  /* ---------------- share codes ----------------
   * Artifacts cannot mint URLs, so sharing is a compact copyable CODE:
   * "BB4:" + base64url(minified wire JSON). Import validates, migrates
   * through the registry, and runs the normal correction pipeline.
   */
  const b64url = s => btoaSafe(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const b64unurl = s => s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice(0, (4 - s.length % 4) % 4);
  function btoaSafe(s) {
    if (typeof btoa === 'function') return btoa(unescape(encodeURIComponent(s)));
    return Buffer.from(s, 'utf8').toString('base64');
  }
  function atobSafe(s) {
    if (typeof atob === 'function') return decodeURIComponent(escape(atob(s)));
    return Buffer.from(s, 'base64').toString('utf8');
  }
  function toShareCode(spec) {
    return 'BB4:' + b64url(JSON.stringify(encode(spec)));
  }
  function fromShareCode(code) {
    let trimmed = String(code || '').trim();
    // Share LINKS carry the code in the #d= hash with a trailing ref marker
    // (audit A-11): accept a pasted full link or a code+marker — strip the
    // wrapper, keep the code. Plain codes pass through untouched.
    const hash = trimmed.match(/#d=([^&\s]+)/);
    if (hash) trimmed = hash[1];
    trimmed = trimmed.split('&')[0];
    if (/%[0-9A-Fa-f]{2}/.test(trimmed)) {
      try { trimmed = decodeURIComponent(trimmed); } catch (e) { /* not URL-encoded after all */ }
    }
    const m = trimmed.match(/^BB(\d+):([A-Za-z0-9_-]+)$/);
    if (!m) return { error: 'Not a Blueprint Buddy share code — it should start with “BB4:”.' };
    let wire;
    try { wire = JSON.parse(atobSafe(b64unurl(m[2]))); }
    catch (e) { return { error: 'That code is damaged — it doesn’t decode to a design.' }; }
    const spec = decode(wire);
    if (!spec) return { error: 'That code decoded but doesn’t contain a design.' };
    // Version migration happens inside correctSpec via the migration registry.
    return { spec };
  }

  /* ---------------- token discipline ---------------- */
  // Rough token estimate for budget checks: dense JSON averages ~3.6 chars
  // per token on Claude tokenizers. Deliberately conservative.
  const estimateTokens = s => Math.ceil(String(s).length / 3.6);

  /* ---------------- static schema documentation (sent ONCE, in the system prompt) ---------------- */
  const SCHEMA_DOC = [
    'WIRE FORMAT — every reply is minified JSON in this compact format (mm integers; enums are 0-based indexes into these lists, documented once here):',
    `TPL=[${TPL.join(',')}] SPC=[${SPC.join(',')}] JNT=[${JNT.join(',')}] FIN=[${FIN.join(',')}] LVL=[${LVL.join(',')}] UNITS=[${UNITS.join(',')}] FRONT=[${FRONT.join(',')}] RUN=[${RUN.join(',')}] PUL=[${PUL.join(',')}] HNG=[${HNG.join(',')}] PRIM=[${PRIM.join(',')}] SURF=[${SURF.join(',')}] GRAIN=[${GRAIN.join(',')}] STK=[${STK.join(',')}]`,
    'Full spec: {"v":4,"n":name,"t":TPL,"l":LVL,"u":UNITS,"o":[width,depth,height],"m":SPC,"ms":SPC,"s":{structure},"j":[frameJNT,caseJNT,boxJNT],"f":FIN,"d":[count,FRONT,RUN]|0,"do":[count,FRONT]|0,"p":[...],"c":[...]}',
    '"m" must be a SOLID species; "ms" is the sheet stock (baltic_birch, mdf, or hardwood_ply only) — omit "ms" for the baltic_birch default.',
    '"hp"/"hh" = pull/hinge STYLE only (PUL/HNG; omit for bar_pull/euro_cup) — counts and bores are computed by the app.',
    'structure "s" keys: t=topThickness l=legThickness a=apronHeight at=apronThickness ai=apronInset c=shelfCount st=shelfThickness sd=sideThickness b=backPanel(0/1) k=toeKick(0/1) x=stretchers(0/1 on table/desk/bench).',
    'Drawers ("d") on nightstand/cabinet/desk/table (desk/table cap 2; code keeps knee/leg clearance). Cabinet doors on t=5 only: "do":[count,FRONT]|0 (1–2); "do":0 removes. Chairs/beds/wall-mounts are not templates — ask or nearest floor piece + say so in "e".',
    'NOVEL pieces (t=6 custom): "p"=parts, each a flat array [PRIM,x,y,z,len,wid,thk,rx,ry,rz,GRAIN,STK,loadBearing(0/1),SURF,"role"] (role string optional). position = part CENTER, mm, y up from the floor, +z toward the front; rotation in degrees about world axes, applied x then y then z. Before rotation: post/cylinder stand vertical (len = height); rail/panel run along x (len horizontal, wid vertical); slab lies flat (len along x, wid along z, thk vertical). "c"=connections as index pairs [partIndexA,partIndexB,JNT] — every part in at least one connection; connected parts must physically touch; unconnected parts must not intersect. loadBearing=1 on every load path, SURF on anything loaded or sat on. 2–40 parts.',
    'Lid/lift-off/fold remain NOT expressible (JNT permanent except kd_bolt). Doors use do/hh. For lid/fold asks: nearest fixed design + say so in "e", or ask — never claim lid motion.',
    // G10: the floor boundary was undocumented — the model kept proposing
    // hangs and correction silently grounded them into mangled deliveries.
    'Everything must STAND ON THE FLOOR — hanging/wall/ceiling mounting does not exist (airborne parts are force-grounded); for such asks build the nearest floor-standing design and say so in "e", or ask.',
    'REPLY SHAPES (minified JSON only, no prose, no fences): 1) REFINEMENT — ONLY the changed keys plus "e" (1-2 sentences, ≤500 chars — complete sentences, disclosures included), e.g. {"o":{"h":650},"e":"Lowered 100 mm"}. Partial-object forms: o:{w,d,h} j:{f,c,b} d:{c,f,r} do:{c,f} s:{...}. "d":0 removes drawers; "do":0 removes doors. 2) NEW DESIGN — {"N":{full spec},"e":"..."}. 3) QUESTION — {"q":"...","a":["opt1","opt2","opt3"]} (2-3 short tappable answers). 4) ANSWER — {"i":"2-5 concrete sentences"} when the user asks for advice or explanation needing NO spec change; the app already renders full plans (cut list, stock, BOM, assembly, integrity) from the spec — point at those tabs rather than reciting numbers.'
  ].join('\n');

  /* ---------------- running history digest ----------------
   * Chat history sends the last 6 turns verbatim; everything older is
   * replaced by this code-built digest assembled from the diff chips the app
   * already computed. Zero extra AI calls — code already knows every applied
   * change.
   */
  function buildDigest(snapshots, currentSpec) {
    if (!snapshots || !snapshots.length) return '';
    const first = snapshots[0];
    const bits = [`started: ${first.spec.meta.template} “${first.spec.meta.name}”`];
    for (const s of snapshots.slice(1)) {
      const line = (s.summary || []).slice(0, 3).join(', ');
      if (line && line !== 'no dimensional change') bits.push(line);
    }
    let digest = 'So far (code-built digest of older turns): ' + bits.join('; ');
    if (digest.length > 700) digest = digest.slice(0, 340) + ' … ' + digest.slice(-340);
    return digest;
  }

  BB.Codec = {
    TPL, SPC, JNT, FIN, LVL, UNITS, FRONT, RUN, PUL, HNG, PRIM, SURF, GRAIN, STK,
    encode, decode, decodePartial, toShareCode, fromShareCode,
    estimateTokens, SCHEMA_DOC, buildDigest
  };
})();
