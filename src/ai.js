/* Blueprint Buddy — AI intent layer (Phase 4: token-optimized).
 *
 * Wire protocol: ALL traffic rides the compact codec (BB.Codec). The system
 * prompt documents the schema ONCE, statically; refinements are partial-merge
 * wire diffs; new designs are full wire specs; the current spec travels in
 * wire format. Response cap is 1000 tokens with a continuation protocol:
 * stop_reason === "max_tokens" appends the partial as an assistant message,
 * asks the model to continue exactly where it stopped (max 2 continuations),
 * and concatenates before parsing — truncation is continuable, never a
 * validation failure.
 *
 * Context budget: last 6 turns verbatim; everything older is replaced by a
 * code-built running digest assembled from the diff chips the app already
 * computes (zero extra AI calls).
 *
 * Transports, tried in order:
 *   1. an injected transport (tests / diagnostics use this)
 *   2. the same-origin /api/chat proxy (Vercel + the bundled dev server)
 *   3. direct fetch to the Anthropic API — NON-BROWSER hosts only, using the
 *      server-side ANTHROPIC_API_KEY (browsers skip it: no key + CORS)
 *   4. window.claude.complete (no stop_reason — truncation detected by
 *      unbalanced braces instead)
 *   5. the built-in local intent parser, so the app is fully functional
 *      standalone and testable headless.
 *
 * The reply is intent only. Code deep-merges the patch, re-corrects the
 * spec, reruns the parametric layer, and computes the ACTUAL diff chips.
 */
var BB = globalThis.BB = globalThis.BB || {};

(function () {
  'use strict';
  const K = BB.K;
  const Codec = () => BB.Codec;

  const MAX_TOKENS = 1000;
  const MAX_CONTINUATIONS = 2;
  const VERBATIM_TURNS = 6;
  const CONTINUE_PROMPT = 'Continue exactly where you stopped. No repetition, no preamble.';

  /* The one-line budget digest (audit M-22): the current design's estimated
   * materials total, computed by CODE from the same BOM the Buy tab shows —
   * user-edited prices included when the UI passes them. The model never
   * computes a price; it only reasons against this number and the $/bd ft
   * column in the knowledge digest. Best-effort: any failure returns ''. */
  function budgetLine(spec, prices) {
    try {
      if (!BB.Parametric || !BB.Plans || !BB.Packing || !BB.Structural) return '';
      const model = BB.Parametric.build(spec);
      if (!model || !model.parts || !model.parts.length) return '';
      const integ = BB.Structural.computeIntegrity(spec, model, {});
      const cut = BB.Plans.cutList(spec, model);
      const stock = BB.Packing.planStock(spec, model, cut, { prices });
      const bom = BB.Plans.bom(spec, model, { integrity: integ, stock, prices });
      return `BUDGET: current estimated materials total $${bom.total} (code-computed, live price table). Answer budget asks against this and the $/bdft column; never invent prices.`;
    } catch (e) { return ''; }
  }

  /* ---------------- system prompt: static schema doc + level joint list +
   * knowledge digests + current spec in wire format. Nothing else. -------- */
  function systemPrompt(spec, prices) {
    return [
      'You are the design intent engine inside Blueprint Buddy, a parametric furniture design tool.',
      'You NEVER compute geometry. You propose intent; the app owns all math, snaps stock sizes, and re-validates everything.',
      'All wire dimensions are millimetres. The app pre-normalizes dimension strings in user messages to explicit millimetres before you see them — NEVER convert units yourself.',
      Codec().SCHEMA_DOC,
      // The LEVEL MATRIX itself rides the knowledge digest (generated from
      // the joinery table, audit F-S3-8) — repeating it here cost ~90 tokens
      // per call saying the same thing twice.
      'Joint slots: j[0]=frame (legs/aprons/rails), j[1]=case (carcass/shelves), j[2]=box (drawer boxes) — the LEVEL MATRIX below is enforced by code regardless.',
      'Drawers ("d") exist only on nightstand and cabinet templates. Known templates are fast and single-shot — prefer them whenever the request fits one; use t=6 (custom) only for genuinely novel forms.',
      // G6: ask-vs-guess was ungoverned chance — 2/4 fresh runs of an
      // underdetermined request silently committed complete failing designs.
      // Deliberate token spend; asking is load-bearing for soundness (every
      // guessed ref7 commit failed integrity; the informed one passed).
      'ASK OR DISCLOSE: if a load-bearing or fit-critical unknown (what piece; boards on hand when building from the user\'s stock; the size of a named object or count — "for 6", a queen mattress; a stated capacity) would change the design, ask ONE question (QUESTION shape), most consequential first; a follow-up turn may ask the next such unknown (inventory after piece) or state the assumption.',
      'If you design without asking, OPEN "e" naming the assumptions you filled in; size to any named object/count and state that size in "e". Never ask styling/finish first; a complete, well-determined request gets ZERO questions.',
      'REFINEMENTS: EDIT the current spec — send ONLY the changed wire keys; never redesign. STRUCTURAL CRITIQUE: fix ONLY the listed problems and return the corrected FULL spec as {"N":{...}}.',
      // A5: a stated exclusion must bind every later choice or be excepted
      // out loud — never silently reframed (observed: "no metal hardware"
      // acked over a 78-screw BOM).
      'EXCLUSIONS: a stated exclusion ("no metal", "zero hardware", "no plywood") binds the WHOLE session — honor it in every joinery/hardware choice (screws/bolts ARE metal; all-wood JNT: dowels, mortise_tenon, loose_tenon, staked_tenon) or state the exception plainly in "e"; never silently reframe.',
      '--- knowledge digest ---',
      K.knowledgeDigest(),
      // Hardware style intent only — every count, rating, and bore is code
      // (BB.HW), so capacities and formulas never spend prompt tokens.
      BB.HW ? BB.HW.digestLine() : '',
      // Everything after the marker is the PER-CALL tail (uncached — see
      // api/chat.js C14): the wire spec and the code-computed budget line.
      '--- current spec (wire format) ---',
      JSON.stringify(Codec().encode(spec)),
      budgetLine(spec, prices)
    ].filter(Boolean).join('\n');
  }

  /* ---------------- JSON extraction ---------------- */
  /* Extract the first PARSEABLE balanced JSON object from model text. A
   * balanced-but-unparseable brace blob (prose like "dims ride keys {w,d,h}")
   * no longer ends the scan (C5) — keep scanning from the next '{'. */
  function extractJSON(text) {
    const s = String(text || '');
    let start = s.indexOf('{');
    while (start >= 0) {
      let depth = 0, inStr = false, escp = false, closed = false;
      for (let i = start; i < s.length; i++) {
        const c = s[i];
        if (inStr) { if (escp) escp = false; else if (c === '\\') escp = true; else if (c === '"') inStr = false; continue; }
        if (c === '"') inStr = true;
        else if (c === '{') depth++;
        else if (c === '}') { depth--; if (!depth) { try { return JSON.parse(s.slice(start, i + 1)); } catch (e) { closed = true; break; } } }
      }
      if (!closed) return null; // ran off the end — nothing further to scan
      start = s.indexOf('{', start + 1);
    }
    return null;
  }
  /* Truncated-output detector for transports without stop_reason: an opened,
   * never-closed JSON object is continuable — NOT a validation failure. */
  function looksTruncated(text) {
    const s = String(text || '');
    const start = s.indexOf('{');
    if (start < 0) return false;
    let depth = 0, inStr = false, escp = false;
    for (let i = start; i < s.length; i++) {
      const c = s[i];
      if (inStr) { if (escp) escp = false; else if (c === '\\') escp = true; else if (c === '"') inStr = false; continue; }
      if (c === '"') inStr = true;
      else if (c === '{') depth++;
      else if (c === '}') { depth--; if (!depth) return false; }
    }
    return depth > 0;
  }

  /* ---------------- classify: wire reply -> verbose intent ---------------- */
  /* G7: explain budget. SCHEMA_DOC demands honest disclosures in "e"
   * (mechanism boundaries, workaround offers, assumption statements) and on
   * novel pieces they routinely run 320-530 chars — the old hard
   * .slice(0, 320) amputated exactly that safety/honesty content mid-word
   * ("…via the n.") and glued the integrity line onto the stump. Cap raised
   * to fit the schema's own demands, with sentence-boundary truncation as
   * the backstop: cut at the last sentence end before the cap, never
   * mid-sentence; a punctuation-free run-on falls back to the last word
   * boundary plus an ellipsis — never mid-word. */
  const EXPLAIN_CAP = 600; // "e" ack text (schema asks ≤500 — headroom, not license)
  const INFO_CAP = 900;    // "i" advice text (unchanged budget)
  function capText(text, cap) {
    const s = String(text);
    if (s.length <= cap) return s;
    let cut = -1, m;
    const re = /[.!?]["'’”)\]]*(?=\s|$)/g; // terminal punctuation (+ closing quotes/brackets) ending a sentence
    while ((m = re.exec(s))) {
      const end = m.index + m[0].length;
      if (end > cap) break;
      cut = end;
    }
    if (cut > 0) return s.slice(0, cut).trimEnd();
    const head = s.slice(0, cap);
    const ws = head.lastIndexOf(' ');
    return (ws > 0 ? head.slice(0, ws) : head).trimEnd() + '…';
  }
  function classify(obj) {
    if (!obj || typeof obj !== 'object') return null;
    const q = obj.q !== undefined ? obj.q : obj.question;
    if (typeof q === 'string') {
      const opts = obj.a !== undefined ? obj.a : obj.options;
      return { kind: 'question', question: q, options: Array.isArray(opts) ? opts.slice(0, 3).map(String) : [] };
    }
    // ANSWER shape (2026): pure advice/explanation, no spec change. Before
    // this, "what finish should I use?" had no legal reply — an answer with
    // no wire keys parsed to null and burned the validation retry.
    const info = obj.i !== undefined ? obj.i : obj.info;
    if (typeof info === 'string' && info.trim()) {
      return { kind: 'info', text: capText(info, INFO_CAP) };
    }
    const eRaw = String(obj.e !== undefined ? obj.e : (obj.explain || ''));
    const explain = capText(eRaw, EXPLAIN_CAP);
    const N = obj.N !== undefined ? obj.N : obj.new;
    if (N && typeof N === 'object') {
      const spec = Codec().decode(N);
      if (!spec) return null;
      // A new design that never states display units inherits the user's
      // current choice (apply() fills it in) instead of the wire default.
      return { kind: 'new', spec, unitsUnspecified: N.u === undefined && N.units === undefined, explain: explain || 'Here’s a starting point.' };
    }
    const wireDiff = {};
    for (const k of Object.keys(obj)) if (k !== 'e' && k !== 'explain' && k !== 'i' && k !== 'info') wireDiff[k] = obj[k];
    // G14: a prose-only reply — non-empty "e", no wire keys — is a correct
    // no-change answer wearing the wrong key (observed: adapt3-run2's
    // verified constraint answer died as "never produced a valid design
    // reply" because a bare explain parsed to null and the retry repeated
    // it). Coerce to an info answer; the raw e rides the "i" budget.
    if (!Object.keys(wireDiff).length && eRaw.trim()) {
      return { kind: 'info', text: capText(eRaw, INFO_CAP) };
    }
    const patch = Codec().decodePartial(wireDiff);
    if (!patch) return null;
    // Wire keys outside the documented schema decode to nothing — record them
    // so the ack can say what was ignored instead of implying it landed (C4).
    const KNOWN = ['v', 'n', 't', 'l', 'u', 'o', 'm', 'ms', 's', 'j', 'f', 'hp', 'd', 'p', 'c'];
    const ignored = Object.keys(wireDiff).filter(k => !KNOWN.includes(k));
    return { kind: 'diff', patch, explain: explain || 'Updated.', ignored };
  }

  /* ---------------- local intent parser (offline fallback) ----------------
   * Deliberately conservative: handles the common refinement vocabulary and
   * asks a clarifying question when the request is ambiguous.
   */
  /* Length parsing delegates to the ONE shared parser in BB.Units. Bare
   * numbers inherit the design's display system (an imperial user's "60
   * wide" means inches); chat text is normally pre-normalized to mm by
   * BB.Units.normalizeLengthText before it ever reaches this parser. */
  function parseLen(str, spec) {
    const dflt = spec && spec.meta && spec.meta.units === 'mm' ? 'mm' : 'in';
    const v = BB.Units.parseLength(str, dflt);
    return v == null ? null : Math.round(v * 10) / 10;
  }
  const WORD_NUMS = { one: 1, a: 1, an: 1, two: 2, three: 3, four: 4 };

  function localModel(text, spec, lmOpts) {
    // The user's own phrasing survives for NAMES (audit X-09): length
    // pre-normalization ("about 5 feet tall" → "about 1524mm tall") exists
    // for parsing and the wire, never for what the piece is called. The chat
    // route normalizes before calling here, so it passes the original via
    // lmOpts.phrasing; direct callers' raw text is captured before our own
    // normalization pass.
    const phrasing = (lmOpts && lmOpts.phrasing) || String(text || '');
    text = BB.Units.normalizeLengthText(text); // idempotent; direct callers get the same guarantee as chat
    const t = ' ' + String(text).toLowerCase().trim() + ' ';
    const patch = {};
    const notes = [];
    const set = (path, v) => {
      let o = patch; const ks = path.split('.');
      ks.slice(0, -1).forEach(k => { o = o[k] = o[k] || {}; });
      o[ks[ks.length - 1]] = v;
    };

    const rxWord = nm => new RegExp('\\b' + nm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/[\s-]+/g, '[\\s-]+') + '\\b');
    /* Negation guard (audit FE-H11): "no ash please" is a REJECTION of ash,
     * not a request for it. A mention within a few words of a negation (in
     * the same clause) is skipped; if nothing else was asked, the reply asks
     * instead — never a wrong ack. Shared by species and template detection. */
    const negated = (src, rx) => {
      const m = rx.exec(src);
      if (!m) return false;
      const clause = src.slice(0, m.index).split(/[,.;:!?()]|\s[—–-]\s/).pop();
      return /(?:^|\s)(?:no|not|never|without|avoid|don'?t|do not|hate)(?:\s+[\w']+){0,2}\s*$/.test(clause);
    };

    // New design? Longest template word first: "bedside table" must win
    // over "table".
    const tmplWords = { table: 'table', 'dining table': 'table', desk: 'desk', bench: 'bench', workbench: 'table', bookshelf: 'bookshelf', bookcase: 'bookshelf', 'shelf unit': 'bookshelf', nightstand: 'nightstand', 'bedside table': 'nightstand', 'night stand': 'nightstand', cabinet: 'cabinet', sideboard: 'cabinet', console: 'table' };
    let wantTemplate = null, tmplWord = null;
    for (const w of Object.keys(tmplWords).sort((a, b) => b.length - a.length)) {
      if (t.includes(' ' + w)) { wantTemplate = tmplWords[w]; tmplWord = w; break; }
    }
    // A creation verb creates — and so does a bare noun-phrase description
    // (audit X-01): the hero placeholder "A walnut nightstand with two
    // drawers" names a piece with no verb at all. A description leads with
    // the template noun (an article plus up to six descriptor words — "a
    // super funky mid century modern bookshelf" is five, A8), never refers
    // back to the current piece, and is not negated ("not a nightstand").
    const bdMatch = tmplWord &&
      new RegExp('^((?:(?:an?|the)\\s+)?(?:[\\w\'-]+\\s+){0,6}?)' + tmplWord.replace(/[\s-]+/g, '[\\s-]+') + 's?\\b').exec(t.trim());
    const bareDescription = !!bdMatch &&
      !/\b(it|its|this|that|my|mine)\b/.test(t) &&
      !negated(t, rxWord(tmplWord)) &&
      // Feature nouns before the template word mean the phrase's head is the
      // FEATURE, not the piece ("two drawers like a cabinet has") — never a
      // creation (audit X-01 drawer smuggling stays refused).
      !/\b(drawers?|shel(?:f|ves)|doors?)\b/.test(bdMatch[1] || '');
    // A8: "workbench" lands on the table template, so asking for one while a
    // plain table is on the bench must still CREATE — unless the current
    // design already IS the workbench being refined (name carries the word).
    const differentPiece = wantTemplate !== spec.meta.template ||
      (tmplWord === 'workbench' && !/workbench/i.test((spec.meta && spec.meta.name) || ''));
    const creating = (/\b(build|make|design|create|new|start)\b/.test(t) || bareDescription) && wantTemplate && differentPiece;

    // Ambiguity checks first.
    if (/\b(bigger|larger|smaller)\b/.test(t) && !/\b(wide|width|deep|depth|tall|height|high|%|percent)\b/.test(t)) {
      return { kind: 'question', question: 'Happy to resize — in which direction?', options: ['Wider', 'Deeper', 'Taller'] };
    }
    if (/\b(change|different|other|new)\b.*\bwood\b/.test(t) && !Object.values(K.WOOD_SPECIES).some(s => t.includes(s.label.toLowerCase().split(' ').pop()))) {
      return { kind: 'question', question: 'Which way should the wood go?', options: ['Walnut — dark and refined', 'Hard maple — pale and crisp', 'Pine — light and budget-friendly'] };
    }

    // Species. Two passes so multi-word labels ("southern yellow pine") beat
    // last-word collisions ("pine"); `aliases` come from the species table.
    // Strip "instead of <species>" so "make it oak instead of walnut" picks oak.
    const speciesText = t.replace(/\binstead of\s+[\w\s-]{2,40}(?=\s|$|,|\.|!|;)/g, ' ');
    let negatedSpecies = null;
    const solid = Object.values(K.WOOD_SPECIES).filter(s => !s.sheet);
    let picked = null;
    for (const s of [...solid].sort((x, y) => y.label.length - x.label.length)) {
      const names = [s.label.toLowerCase(), ...(s.aliases || [])];
      const hit = names.find(nm => rxWord(nm).test(speciesText));
      if (!hit) continue;
      if (negated(speciesText, rxWord(hit))) { negatedSpecies = negatedSpecies || s.label; continue; }
      picked = s; break;
    }
    if (!picked) {
      for (const s of solid) {
        const last = s.label.toLowerCase().split(' ').pop();
        if (last === 'oak' || !rxWord(last).test(speciesText)) continue;
        if (negated(speciesText, rxWord(last))) { negatedSpecies = negatedSpecies || s.label; continue; }
        picked = s; break;
      }
    }
    if (picked) { set('wood.species', picked.key); notes.push(picked.label); }
    if (!patch.wood && /\boak\b/.test(speciesText)) {
      if (negated(speciesText, /\boak\b/)) negatedSpecies = negatedSpecies || 'oak';
      else { set('wood.species', /white\s+oak/.test(speciesText) ? 'white_oak' : 'red_oak'); notes.push('oak'); }
    }
    // Sheet stock (drawer boxes, backs): a named sheet good switches only the
    // sheet species — solid parts keep their wood.
    for (const s of Object.values(K.WOOD_SPECIES).filter(x => x.sheet)) {
      const names = [s.label.toLowerCase(), ...(s.aliases || [])];
      const hit = names.find(nm => rxWord(nm).test(t));
      if (hit && !negated(t, rxWord(hit))) {
        set('wood.sheetSpecies', s.key); notes.push(s.label + ' sheet stock'); break;
      }
    }

    // Level.
    if (/\bbeginner|first (build|project)|simple joinery\b/.test(t)) { set('meta.level', 'beginner'); notes.push('beginner'); }
    else if (/\bintermediate\b/.test(t)) { set('meta.level', 'intermediate'); notes.push('intermediate'); }
    else if (/\badvanced|dovetail|mortise\b/.test(t)) { set('meta.level', 'advanced'); notes.push('advanced'); }

    // Dimensions.
    const dimWord = { wide: 'width', width: 'width', deep: 'depth', depth: 'depth', tall: 'height', height: 'height', high: 'height', long: 'width' };
    const re = /(\d+(?:\.\d+)?\s*(?:mm|cm|m\b|in\b|inch(?:es)?|"|ft|feet|foot)?)\s*(wide|deep|tall|high|long)|(width|depth|height)\s*(?:to|of|=|at)?\s*(\d+(?:\.\d+)?\s*(?:mm|cm|m\b|in\b|inch(?:es)?|"|ft|feet|foot)?)/gi;
    let m;
    while ((m = re.exec(t))) {
      const key = dimWord[(m[2] || m[3] || '').toLowerCase()];
      const val = parseLen(m[1] || m[4], spec);
      if (key && val) { set('overall.' + key, val); notes.push(`${key} ${BB.Units.fmtLength(val)}`); }
    }
    let mm2;
    if ((mm2 = t.match(/\b(lower|shorten|raise|lift)\b(?:\s+\w+)*?\s+by\s+([\d.]+\s*(?:mm|cm|in|inch(?:es)?|")?)/))) {
      const delta = parseLen(mm2[2], spec);
      if (delta) { set('overall.height', spec.overall.height + (/(lower|shorten)/.test(mm2[1]) ? -delta : delta)); notes.push('height'); }
    }
    if (/\b(wider)\b/.test(t) && !patch.overall) { set('overall.width', Math.round(spec.overall.width * 1.15)); notes.push('wider'); }
    if (/\b(deeper)\b/.test(t) && !(patch.overall && patch.overall.depth)) { set('overall.depth', Math.round(spec.overall.depth * 1.15)); notes.push('deeper'); }
    if (/\b(taller)\b/.test(t) && !(patch.overall && patch.overall.height)) { set('overall.height', Math.round(spec.overall.height * 1.1)); notes.push('taller'); }
    if (/\b(shorter)\b/.test(t) && !(patch.overall && patch.overall.height)) { set('overall.height', Math.round(spec.overall.height * 0.9)); notes.push('shorter'); }

    // Legs / aprons / shelves.
    if ((mm2 = t.match(/\b(thinner|slimmer|thicker|chunkier)\b.*\bleg/)) || (mm2 = t.match(/\bleg[s]?\b.*\b(thinner|slimmer|thicker|chunkier)\b/))) {
      const thinner = /(thinner|slimmer)/.test(mm2[1]);
      set('structure.legThickness', spec.structure.legThickness + (thinner ? -12 : 12)); notes.push('legs');
    }
    // Shelf counts are bare small numbers, never length tokens: "bookshelf
    // about 1524mm tall" must not read 1524 as a shelf count (the corrected
    // spec would clamp it to 8 and the chips would report a change nobody
    // asked for — audit X-01). \b also keeps "bookshelf" itself from
    // matching as "…shelf".
    if ((mm2 = t.match(/(\d+)\s*(?:more\s+)?\bshel(?:f|ves)\b/)) || (mm2 = t.match(/\bshel(?:f|ves)\b[^\d]*?(\d+)(?![\d.]|\s*(?:mm|cm|m|in|inch(?:es)?|"|ft|feet|foot)\b)/))) {
      set('structure.shelfCount', parseInt(mm2[1], 10)); notes.push('shelves');
    } else if (/\badd (a |another )?shelf\b/.test(t)) {
      set('structure.shelfCount', spec.structure.shelfCount + 1); notes.push('shelf');
    }

    // Drawers. Honesty first (audit FE-H10): the code strips drawers from
    // templates without openings, so the parser must never ack one there.
    // Drawer fields judge the template the patch actually LANDS on (audit
    // X-01): the new template when creating, else the CURRENT design — a
    // mentioned-but-not-created template must never smuggle a field that
    // correction will strip (the phantom "2 drawer(s)" ack).
    const canDrawer = w => ['nightstand', 'cabinet'].includes(w || spec.meta.template);
    const landing = creating ? wantTemplate : spec.meta.template;
    let dm = null;
    if (/\b(no|remove|without)\b.*\bdrawers?\b/.test(t) && spec.meta.template !== 'nightstand') { patch.drawers = null; notes.push('no drawers'); }
    else {
      dm = t.match(/(\d+|one|two|three|four)\s+drawers?/);
      if (!dm && /\badd (a |another )?drawer\b/.test(t)) dm = [null, String((spec.drawers ? spec.drawers.count : 0) + 1)];
      if (dm && !canDrawer(landing) && !creating) {
        if (!Object.keys(patch).length) {
          return {
            kind: 'question',
            question: `Drawers need a case with openings — a ${spec.meta.template} can't take them yet, but a nightstand or cabinet can.`,
            options: ['Make it a nightstand', 'Make it a cabinet']
          };
        }
        notes.push(`drawers skipped — not available on a ${spec.meta.template}`);
      } else if (dm && canDrawer(landing)) {
        const count = WORD_NUMS[dm[1]] || parseInt(dm[1], 10) || 1;
        set('drawers.count', Math.min(4, Math.max(1, count)));
        if (!spec.drawers) { set('drawers.frontStyle', 'inset'); set('drawers.runner', 'side_mount_slides'); }
        notes.push(count + ' drawer(s)');
      }
      if (canDrawer(landing)) {
        if (/\boverlay\b/.test(t)) set('drawers.frontStyle', 'overlay');
        if (/\binset\b/.test(t)) set('drawers.frontStyle', 'inset');
        if (/\bwood(en)? runners?\b/.test(t)) { set('drawers.runner', 'wood_runners'); notes.push('wood runners'); }
        if (/\bslides?\b/.test(t) && /\b(ball|side|metal)\b/.test(t)) { set('drawers.runner', 'side_mount_slides'); notes.push('side-mount slides'); }
        if (/\bundermount\b/.test(t)) { set('drawers.runner', 'undermount_slides'); notes.push('undermount slides'); }
      }
    }

    // Hardware style intent (2026 expansion): the style is the whole ask —
    // counts, sizes, spacing, and bores are computed by code (BB.HW).
    if (/push[ -]?to[ -]?open|handleless|no (visible )?(hardware|handles|pulls)/.test(t)) { set('hardware.pull', 'none_touch'); notes.push('push-to-open'); }
    else if (/turned (wood(en)? )?knobs?|wood(en)? knobs?/.test(t)) { set('hardware.pull', 'knob_turned_wood'); notes.push('turned knobs'); }
    else if (/\bknobs?\b/.test(t)) { set('hardware.pull', 'knob_round'); notes.push('knobs'); }
    else if (/\b(cup|bin) pulls?\b/.test(t)) { set('hardware.pull', 'cup_pull'); notes.push('cup pulls'); }
    else if (/\bleather (strap )?pulls?\b/.test(t)) { set('hardware.pull', 'leather_pull'); notes.push('leather pulls'); }
    else if (/\bring pulls?\b/.test(t)) { set('hardware.pull', 'ring_pull'); notes.push('ring pulls'); }
    else if (/\bbar pulls?\b/.test(t)) { set('hardware.pull', 'bar_pull'); notes.push('bar pulls'); }

    // Finish.
    for (const f of K.FINISHES) {
      const kw = f.key === 'wipe_poly' ? 'poly' : f.label.toLowerCase().split(' ')[0];
      if (t.includes(kw)) { set('finish', f.key); notes.push(f.label); break; }
    }

    if (creating) {
      // A workbench is a table at working height: the WORD itself implies the
      // height, from the ergonomics table (A8) — an explicit height still wins.
      if (tmplWord === 'workbench' && !(patch.overall && patch.overall.height)) {
        const row = K.ergoRow('workbench_height');
        if (row) set('overall.height', Math.round((row.min + row.max) / 2));
      }
      const base = BB.Spec.defaultSpec(wantTemplate);
      const merged = BB.Spec.deepMerge(base, patch);
      merged.meta.template = wantTemplate;
      merged.meta.name = phrasing.length < 40 ? phrasing.replace(/^\s*(please\s+)?(build|make|design|create)\s*(me\s+)?(a|an)?\s*/i, '').replace(/\.$/, '').trim() || tmplWord : 'New ' + tmplWord;
      merged.meta.name = merged.meta.name.charAt(0).toUpperCase() + merged.meta.name.slice(1);
      const drawerNote = dm && !canDrawer(landing) ? ` (drawers aren’t available on a ${wantTemplate} yet, so I skipped those)` : '';
      return { kind: 'new', spec: merged, explain: `Roughed out a ${tmplWord} to standard proportions${drawerNote} — refine away.` };
    }

    // A rejected species with nothing else asked: say so and ask which wood
    // instead — never a wrong ack (audit FE-H11).
    if (!Object.keys(patch).length && negatedSpecies) {
      const alts = ['Walnut', 'Hard maple', 'Cherry', 'White oak']
        .filter(x => !negatedSpecies.toLowerCase().includes(x.toLowerCase().split(' ').pop())).slice(0, 3);
      return { kind: 'question', question: `Understood — not ${negatedSpecies.toLowerCase()}. Which wood should it be instead?`, options: alts };
    }

    if (!Object.keys(patch).length) {
      // A8: a creation-shaped request (no back-reference to the current
      // piece) that didn't parse gets a creation-phrased answer naming what
      // the offline parser CAN rough out — not the edit-phrased question.
      const creationShaped = !/\b(it|its|this|that|my|mine)\b/.test(t) &&
        (/\b(build|make|design|create)\b/.test(t) || /^(?:an?|the)\b/.test(t.trim()) || !!tmplWord);
      if (creationShaped) {
        return {
          kind: 'question',
          question: 'Offline I can rough out a table, desk, bench, workbench, bookshelf, nightstand, or cabinet — name one (plus wood, size, or drawers) and I’ll build it to standard proportions.',
          options: ['A walnut nightstand with two drawers', 'A workbench', 'A bookshelf']
        };
      }
      return {
        kind: 'question',
        question: 'I didn’t catch a change I can make there. Try a dimension, species, joinery level, drawers, or finish — what should move?',
        options: ['Make it walnut', `Lower it by ${BB.Units.fmtLength(spec.meta.units === 'mm' ? 50 : 50.8)}`,
          canDrawer(null) ? 'Add a drawer' : 'Make it wider']
      };
    }
    return { kind: 'diff', patch, explain: 'Adjusted ' + (notes.filter(Boolean).slice(0, 4).join(', ') || 'the design') + '.' };
  }

  /* ---------------- transports ---------------- */
  /* C6: every model fetch carries an abort timeout — a hung connection used
   * to pin the chat in the busy state forever. Aborts reject the fetch and
   * ride the existing catch paths (Node ≥ 18 / modern browsers; absent
   * AbortSignal.timeout degrades to no timeout, exactly the old behavior). */
  const FETCH_TIMEOUT_MS = 60000;
  const fetchSignal = () =>
    (typeof AbortSignal !== 'undefined' && AbortSignal.timeout) ? AbortSignal.timeout(FETCH_TIMEOUT_MS) : undefined;
  let injectedTransport = null; // (system, messages) => Promise<{text, stopReason}>
  function setTransport(fn) { injectedTransport = fn; }
  /* C7: transport death comes in two grades. 404/405/503 (route truly absent
   * or unconfigured) stays PERMANENT for the session; a plain fetch rejection
   * is a NETWORK death — a blip or a hung hop — and only benches the
   * transport for a TTL, so restored connectivity brings the model back
   * without a reload (before: one rejection meant offline forever). */
  const DEAD_TTL_MS = 30000;
  let anthropicDead = false;   // permanent: browser host / no key / hard API error
  let anthropicDeadAt = 0;     // network death — retried after the TTL
  // Same-origin proxy (api/chat.js) — present when hosted on Vercel or the
  // bundled dev server; absent on claude.ai, where it dies on first touch
  // and the direct transport takes over. Browser-only.
  let proxyDead = typeof window === 'undefined'; // permanent
  let proxyDeadAt = 0;                           // network death — TTL retry
  const proxyDown = () => proxyDead || (proxyDeadAt && Date.now() - proxyDeadAt < DEAD_TTL_MS);
  const anthropicDown = () => anthropicDead || (anthropicDeadAt && Date.now() - anthropicDeadAt < DEAD_TTL_MS);
  // A proxy that EXISTS but answered 503 (no ANTHROPIC_API_KEY on the server)
  // is a broken deploy, not ordinary offline — remembered for the session so
  // the UI can say "AI not configured" instead of the generic offline label
  // (audit L-14).
  let proxyUnconfigured = false;

  /* Credits pivot: where may the offline intent parser still answer?
   *   - non-browser hosts (the headless test suites drive it directly);
   *   - dev hosts (localhost & friends — the documented dev/test path);
   *   - hosts with NO proxy route at all (a static file or claude.ai
   *     artifact — the standalone-app capability stays intact).
   * The one place it is now FORBIDDEN is a production deploy whose proxy
   * answered 503 (route exists, ANTHROPIC_API_KEY missing): there the UI
   * says "AI is not configured on this site" instead of quietly serving a
   * toy parser that looks like the product. */
  function isDevHost() {
    if (typeof location === 'undefined') return false;
    return /^(localhost|127\.|0\.0\.0\.0|\[::1\])/.test(location.hostname || '');
  }
  function localParserAllowed() {
    if (typeof window === 'undefined' || typeof document === 'undefined') return true;
    if (!proxyUnconfigured) return true;
    return isDevHost();
  }

  async function proxyTransport(system, messages) {
    let response;
    try {
      response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ system, messages, max_tokens: MAX_TOKENS }),
        signal: fetchSignal()
      });
    } catch (e) { proxyDeadAt = Date.now(); e.transient = true; throw e; } // network death — TTL, not forever (C7)
    // 404/405: no proxy at this origin. 503: proxy present but unconfigured.
    // Both are permanent for the session; other failures may be transient
    // upstream errors and leave the proxy alive for the next message.
    if (response.status === 404 || response.status === 405 || response.status === 503) {
      proxyDead = true;
      if (response.status === 503) proxyUnconfigured = true; // route exists, key missing (L-14)
      throw new Error('proxy unavailable (' + response.status + ')');
    }
    // Sign-in required (401), usage limit (402), and rate limit (429) are
    // AUTHORITATIVE answers, not transport failures — surface them distinctly
    // so the UI can prompt sign-in / name the ceiling instead of silently
    // dropping to the offline parser. The proxy stays alive.
    if (response.status === 401 || response.status === 402 || response.status === 429) {
      let payload = null;
      try { payload = await response.json(); } catch (e) { /* no body */ }
      const err = new Error(response.status === 401 ? 'auth_required' : response.status === 402 ? 'usage_limit' : 'rate_limited');
      if (response.status === 401) err.authRequired = true;
      else if (response.status === 402) { err.usageLimit = true; err.billing = payload && payload.billing; }
      else err.rateLimited = true;
      throw err;
    }
    if (!response.ok) throw new Error('proxy returned ' + response.status);
    let data;
    try { data = await response.json(); }
    catch (e) { proxyDead = true; throw new Error('proxy returned non-JSON'); }
    if (data.error) throw new Error(data.error.message || 'proxy error');
    proxyDeadAt = 0; // a good answer clears any network-death bench (C7)
    return { text: (data.content || []).map(b => b.text || '').join(''), stopReason: data.stop_reason || 'end_turn' };
  }

  async function anthropicTransport(system, messages) {
    // Browser pages never hold ANTHROPIC_API_KEY and CORS blocks this call —
    // skip immediately so DIY sessions fall to the offline parser without a
    // noisy console error. Direct Anthropic is for non-browser hosts only.
    if (typeof window !== 'undefined' && typeof document !== 'undefined') {
      anthropicDead = true;
      throw new Error('direct Anthropic unavailable in browser');
    }
    // Non-browser host only: authenticate with the server-side key and send
    // the API version header. Without the key the call can only 401, so fail
    // fast to the next transport instead of burning a request.
    const key = (typeof process !== 'undefined' && process.env) ? process.env.ANTHROPIC_API_KEY : '';
    if (!key) { anthropicDead = true; throw new Error('ANTHROPIC_API_KEY not set'); }
    const model = (typeof process !== 'undefined' && process.env && process.env.ANTHROPIC_MODEL) || 'claude-sonnet-5';
    let response;
    try {
      response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': key,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({ model, max_tokens: MAX_TOKENS, system, messages }),
        signal: fetchSignal()
      });
    } catch (e) { anthropicDeadAt = Date.now(); e.transient = true; throw e; } // network death — TTL (C7)
    if (!response.ok) throw new Error('API returned ' + response.status);
    const data = await response.json();
    if (data.error) throw new Error(data.error.message || 'API error');
    anthropicDeadAt = 0;
    // 1c: read stop_reason from EVERY response — max_tokens means continue.
    return { text: (data.content || []).map(b => b.text || '').join(''), stopReason: data.stop_reason || 'end_turn' };
  }

  function renderForPrompt(messages) {
    // Flatten a messages array into a single prompt for window.claude.complete.
    return messages.map(m => {
      const content = Array.isArray(m.content)
        ? m.content.map(b => b.type === 'text' ? b.text : '[image omitted]').join('\n')
        : m.content;
      return (m.role === 'assistant' ? 'ASSISTANT: ' : 'USER: ') + content;
    }).join('\n');
  }
  async function claudeCompleteTransport(system, messages) {
    const prompt = system + '\n--- conversation ---\n' + renderForPrompt(messages) + '\nReply with ONLY minified JSON.';
    const text = await window.claude.complete(prompt);
    // No stop_reason on this transport; unbalanced braces stand in for it.
    return { text: String(text || ''), stopReason: looksTruncated(text) ? 'max_tokens' : 'end_turn' };
  }

  function hasRemote() {
    if (injectedTransport) return true;
    // In the browser, only the same-origin proxy (or window.claude) can reach
    // a model — never count bare Anthropic as "remote available".
    const inBrowser = typeof window !== 'undefined' && typeof document !== 'undefined';
    if (typeof fetch === 'function' && !proxyDown() && typeof window !== 'undefined') return true;
    if (!inBrowser && typeof fetch === 'function' && !anthropicDown()) return true;
    return typeof window !== 'undefined' && window.claude && typeof window.claude.complete === 'function';
  }
  function supportsImages() {
    if (injectedTransport) return true;
    if (typeof fetch === 'function' && !proxyDown()) return true;
    return false;
  }

  async function rawCall(system, messages) {
    if (injectedTransport) return injectedTransport(system, messages);
    if (typeof fetch === 'function' && !proxyDown()) {
      try {
        return await proxyTransport(system, messages);
      } catch (e) {
        if (!proxyDown()) throw e; // proxy alive, upstream hiccup — surface it
        // proxy absent/unconfigured/benched: fall through to the direct transport
      }
    }
    if (typeof fetch === 'function' && !anthropicDown()) {
      try {
        return await anthropicTransport(system, messages);
      } catch (e) {
        // C7: a network blip benches it for the TTL only; every other failure
        // (browser host, no key, hard API error) stays fallen for the session.
        if (!e || !e.transient) anthropicDead = true;
      }
    }
    if (typeof window !== 'undefined' && window.claude && typeof window.claude.complete === 'function') {
      return claudeCompleteTransport(system, messages);
    }
    throw new Error('no-transport');
  }

  /* ---------------- continuation protocol (1c) ----------------
   * On max_tokens: append the partial output as an assistant message, ask to
   * continue with no repetition, concatenate before parsing. Up to 2
   * continuations; the chat shows "Receiving design, part N".
   */
  async function callModel(system, baseMessages, onStatus) {
    let acc = '', continuations = 0;
    for (;;) {
      const messages = acc
        ? [...baseMessages, { role: 'assistant', content: acc }, { role: 'user', content: CONTINUE_PROMPT }]
        : baseMessages;
      const res = await rawCall(system, messages);
      acc += res.text;
      if (res.stopReason !== 'max_tokens' || continuations >= MAX_CONTINUATIONS) {
        return { text: acc, stopReason: res.stopReason, continuations };
      }
      continuations++;
      if (onStatus) onStatus(`Receiving design, part ${continuations + 1}`);
    }
  }

  /* ---------------- assembly walkthrough context (C10) ----------------
   * "walk me through step 5": the model never sees the code-built plan, so it
   * deflects or guesses (observed 4/4). When the user asks for a step or an
   * assembly walkthrough, inject the plan's REAL numbered step titles — the
   * same Plans.assembly list the Plan tab renders, glue-ups included, so
   * "step 5" is the user's step 5 — plus the referenced step's full text and
   * the spec's skill level. Code-built context, never computation in the
   * prompt: the founding rule holds. */
  const STEP_ASK = /\b(?:step\s*\d+|walk me through|talk me through|how do i (?:assemble|build|glue))\b/i;
  function stepContext(text, spec) {
    const src = String(text || '');
    if (!STEP_ASK.test(src) || !BB.Plans || !BB.Parametric || !BB.Structural || !BB.Packing) return null;
    const num = /\bstep\s*(\d+)\b/i.exec(src);
    try {
      const model = BB.Parametric.build(spec);
      if (!model || !model.parts || !model.parts.length) return null;
      const integ = BB.Structural.computeIntegrity(spec, model, {});
      const cut = BB.Plans.cutList(spec, model);
      const stock = BB.Packing.planStock(spec, model, cut, {});
      const steps = BB.Plans.assembly(spec, model, integ, { stockPlan: stock });
      if (!steps || !steps.length) return null;
      const n = num ? parseInt(num[1], 10) : 0;
      let block = `[assembly] Code-built plan for this spec (user level: ${spec.meta.level}) — numbered steps: ` +
        steps.map((s, i) => `${i + 1}. ${s.title}`).join('; ') + '.';
      if (n >= 1 && n <= steps.length) {
        const s = steps[n - 1];
        block += ` Step ${n} = "${s.title}": ${s.text || ''}`;
      } else if (n > steps.length) {
        block += ` There is no step ${n} — the plan has ${steps.length} steps.`;
      }
      return block + ' Answer from THIS plan at the user\'s level ({"i":...} unless a spec change is asked).';
    } catch (e) { return null; } // context is best-effort — never block the turn
  }

  /* ---------------- context budget (1b) ----------------
   * turns: [{role:'user'|'assistant', content}] maintained by the UI in wire
   * format. Send the last 6 verbatim; compress everything older into the
   * code-built digest (from history snapshots — zero extra AI calls).
   */
  function buildMessages(turns, digest, newUserContent, origin) {
    let recent = turns.slice(-VERBATIM_TURNS);
    while (recent.length && recent[0].role === 'assistant') recent = recent.slice(1);
    const out = [];
    if (digest && turns.length > VERBATIM_TURNS) {
      out.push({ role: 'user', content: '[context] ' + digest });
      out.push({ role: 'assistant', content: '{"e":"ok"}' });
    }
    // C11: refinement/critique rounds append two turns each, so in a deep
    // pipeline the ORIGINAL request (the words carrying style/purpose/
    // constraints) scrolls out of the verbatim window. Pin it with a compact
    // context pair whenever it is no longer verbatim in what we send.
    if (origin && typeof origin === 'string') {
      const verbatim = c => typeof c === 'string' && c.includes(origin);
      const inWindow = recent.some(m => verbatim(m.content)) || verbatim(newUserContent);
      if (!inWindow) {
        out.push({ role: 'user', content: '[request] ' + origin });
        out.push({ role: 'assistant', content: '{"e":"ok"}' });
      }
    }
    out.push(...recent);
    out.push({ role: 'user', content: newUserContent });
    return out;
  }

  /* ---------------- respond ---------------- */
  async function respond(userText, spec, opts) {
    opts = opts || {};
    // Pre-parse dimension strings to explicit millimetres BEFORE the model
    // sees them — the model proposes intent and never converts units. The
    // original phrasing is kept for design names (audit X-09).
    const phrasing = String(userText || '');
    userText = BB.Units.normalizeLengthText(userText);
    const onStatus = opts.onStatus || (() => {});
    if (!hasRemote()) {
      if (!localParserAllowed()) {
        // A keyless DEPLOY (proxy route exists, no ANTHROPIC_API_KEY): the
        // offline parser must never impersonate the product in production.
        // Dev hosts and no-proxy hosts (static / claude.ai) keep it.
        return { reply: null, turns: opts.turns || [], unconfigured: true, error: 'AI is not configured on this site. The design tools all work — but chat needs the site owner to set the AI key.' };
      }
      return { reply: localModel(userText, spec, { phrasing }), turns: opts.turns || [], local: true, unconfigured: proxyUnconfigured };
    }

    const system = systemPrompt(spec, opts.prices);
    const turns = opts.turns || [];
    const digest = opts.digest || '';
    const userContent = opts.image
      ? [
          { type: 'image', source: { type: 'base64', media_type: opts.image.mediaType, data: opts.image.base64 } },
          { type: 'text', text: userText }
        ]
      : userText;
    const baseMessages = buildMessages(turns, digest, userContent, opts.origin);
    // C10: a step/assembly walkthrough ask gets the code-built step list for
    // THIS committed spec injected as a context pair (same pattern as the
    // digest pair), so "step 5" means the Plan tab's step 5.
    const stepCtx = opts.image ? null : stepContext(userText, spec);
    if (stepCtx) {
      baseMessages.splice(baseMessages.length - 1, 0,
        { role: 'user', content: stepCtx },
        { role: 'assistant', content: '{"e":"ok"}' });
    }

    try {
      const first = await callModel(system, baseMessages, onStatus);
      let text = first.text;
      let stopReason = first.stopReason;
      let parsed = classify(extractJSON(text));
      if (!parsed) {
        // The single validation retry. A stitched-but-still-truncated reply
        // CAN land here when the continuation ceiling is exhausted (C15) —
        // the failure is then named as truncation, never "invalid JSON".
        onStatus('Re-asking for valid JSON');
        const retryMessages = [...baseMessages,
          { role: 'assistant', content: text || '(empty)' },
          // G14: name the escape hatch — a "not JSON" verdict alone made the
          // model repeat a valid-JSON-wrong-shape reply until the turn died.
          { role: 'user', content: 'That was not valid wire-format JSON. Reply again with ONLY minified JSON in the documented wire format. If you meant advice or an explanation with NO spec change, reply {"i":"..."}.' }];
        const second = await callModel(system, retryMessages, onStatus);
        parsed = classify(extractJSON(second.text));
        if (parsed) text = second.text;
        else stopReason = second.stopReason;
      }
      if (parsed) {
        const newTurns = [...turns,
          { role: 'user', content: typeof userContent === 'string' ? userContent : userText + ' [photo]' },
          { role: 'assistant', content: text }];
        return { reply: parsed, turns: newTurns, local: false };
      }
      // C15: the failed exchange stays in the returned turns (capped) so the
      // conversation remembers what was asked and attempted, and truncation
      // exhaustion is named instead of the generic invalid-reply line.
      const failTurns = [...turns,
        { role: 'user', content: typeof userContent === 'string' ? userContent : userText + ' [photo]' },
        { role: 'assistant', content: (String(text || '(no reply)')).slice(0, 1500) }];
      const truncated = stopReason === 'max_tokens';
      return {
        reply: null, turns: failTurns, truncated,
        error: truncated
          ? 'That reply kept overflowing the response limit even after ' + (MAX_CONTINUATIONS + 1) + ' parts, so I couldn’t finish it. Try asking for a simpler piece, or split the request into smaller steps.'
          : 'The model never produced a valid design reply.'
      };
    } catch (err) {
      // Sign-in and usage/rate limits are authoritative server answers, not
      // outages — never mask them behind the offline parser.
      if (err && err.authRequired) return { reply: null, turns, authRequired: true };
      if (err && err.usageLimit) return { reply: null, turns, usageLimit: true, billing: err.billing || null };
      if (err && err.rateLimited) return { reply: null, turns, rateLimited: true };
      if (!localParserAllowed()) {
        return { reply: null, turns, unconfigured: proxyUnconfigured, error: proxyUnconfigured ? 'AI is not configured on this site. The design tools all work — but chat needs the site owner to set the AI key.' : 'The design service is unreachable. Your design is untouched — try again in a moment.' };
      }
      if (opts.image) return { reply: null, turns, error: 'The design service is unreachable, and photo analysis needs it. Text refinements still work offline.' };
      // G13: the transport EXISTED and died mid-flight (hasRemote() was true
      // above — a session that starts offline returns early and never lands
      // here). The local reply still ships for the first-turn offline
      // feature, but the result is MARKED so the orchestration loops can
      // name the network instead of blaming the design ("I couldn't get a
      // buildable design from that…" over a dropped fetch). Additive: local
      // stays true, the reply stays the parser's.
      return { reply: localModel(userText, spec, { phrasing }), turns, local: true, transportFailed: true, unconfigured: proxyUnconfigured };
    }
  }

  /* Mid-loop reply triage for the orchestration loops (C8): billing and rate
   * limits surface their own UX, a question goes to the user, an info reply
   * shows its text — none of them are appliable patches. Before this, a
   * question's text vanished on break, an info reply deep-merged into a no-op
   * that burned the round, and limits fell through to "couldn't get a
   * buildable design". */
  function roundDecision(res) {
    if (!res) return 'bail';
    if (res.authRequired) return 'auth';
    if (res.usageLimit) return 'billing';
    if (res.rateLimited) return 'rate';
    if (!res.reply) return 'bail';
    // G13: a transport death mid-loop is a NETWORK event, not a design
    // verdict — name it distinctly so the loop can offer a retry ("connection
    // dropped, design untouched") instead of falling through to the
    // unbuildable rejection with unspent rounds. Checked before the local
    // bail: the offline parser still never speaks for the model.
    if (res.transportFailed) return 'transport';
    // The loops only run remote; a local reply mid-round means the transport
    // died mid-flight — bail to the honest unbuildable path, never surface
    // the offline parser's guess as the model's answer.
    if (res.local) return 'bail';
    if (res.reply.kind === 'question') return 'question';
    if (res.reply.kind === 'info') return 'info';
    return 'apply';
  }

  /* Code-built marker pair appended to the retained turns after a rejected
   * (unbuildable) proposal (B9). Without it the rejected diff sits in the
   * conversation looking accepted, and a later turn silently builds on it —
   * observed live as an all-ply material flip riding an unrelated edit.
   * Same pattern as the digest context pair in buildMessages. */
  function rejectionMarker(errors) {
    const brief = (errors || []).slice(0, 2).map(e => (e && e.text) || String(e)).join(' ');
    return [
      { role: 'user', content: '[context] That proposal was REJECTED — validation failed' + (brief ? ': ' + brief : '.') + ' The committed design is UNCHANGED; do not build on the rejected values.' },
      { role: 'assistant', content: '{"e":"understood, design unchanged"}' }
    ];
  }

  /* Structured critique for the propose-validate-revise loop (novel pieces).
   * A10: each failing check TYPE gets one code-owned remedy line — observed
   * live, three sag rounds never once proposed lamination, so the loop
   * shuffled geometry instead of converging. */
  const CRITIQUE_REMEDIES = [
    [/^sag:/, 'sag: thicken the part (sheet stock tops out at 18 mm — use solid stock, or laminate by stacking TWO 18 mm sheet slabs as separate touching parts joined edge_glue), add a rail or rib under the span, or shorten the span'],
    [/^str:/, 'strength: use a thicker section or a stronger species'],
    [/^(tip|stand)/, 'tipping/balance: widen the stance or lower the mass'],
    [/^joints/, 'joints: pick a stronger joint allowed by the LEVEL MATRIX']
  ];
  function critiqueRemedies(failedChecks) {
    const lines = [];
    for (const c of failedChecks) {
      const r = CRITIQUE_REMEDIES.find(([rx]) => rx.test(String(c.id || '')));
      if (r && !lines.includes(r[1])) lines.push(r[1]);
    }
    return lines;
  }
  function buildCritique(failedChecks) {
    const shown = failedChecks.slice(0, 10);
    const lines = shown.map(c => `- ${c.title}: ${c.explain} (${c.value}; required: ${c.threshold})`);
    const fixes = critiqueRemedies(shown);
    return `Structural validation of your composition FAILED. Problems:\n${lines.join('\n')}\n` +
      (fixes.length ? `Proven fixes — ${fixes.join('; ')}.\n` : '') +
      `Fix ONLY these problems — keep the design intent and everything that already works. Reply {"N":{corrected FULL wire spec}} as minified JSON, nothing else.`;
  }

  /* ---------------- photo-to-design (Phase 4 item 4) ----------------
   * Ergonomic anchor ranges are GENERATED from K.ERGONOMICS (audit F-S3-8). */
  const VISION_PROMPT = [
    'The image is a furniture photo. Identify the furniture type and estimate overall proportions, anchored to standard ergonomic heights from the knowledge digest (' + K.visionRangesLine() + ').',
    'Reply {"N":{full wire spec}} — use a known template (t 0-5) whenever one fits; use t=6 (custom, parts + connections) only if none does.',
    // Picture identification (2026): everything the wire can carry, the
    // photo path should read — species by color/grain against the full SPC
    // list, visible sheet goods, drawer bank, pull style, shelf count, and
    // the joinery level when exposed joints show.
    'Read from the photo: wood species by color and grain ("m", a SOLID species from SPC — pale cream=maple/birch, honey/amber=oak/ash/pine, salmon-auburn=cherry, chocolate=walnut, ribbon-striped red-brown=sapele, painted=poplar or mdf); visible sheet goods ("ms"); drawers ("d": count and inset/overlay) with pull style ("hp" from PUL — bars, knobs, cups, ring, leather, none visible = push-to-open); shelf count (s.c); joinery level (l) if exposed dovetails/tenons show.',
    'Snap thicknesses to stock sizes. Minified JSON only.'
  ].join(' ');

  /* Client-side downscale (1d): image tokens scale with pixel count — NEVER
   * send a raw camera image. 1024 px long edge, JPEG quality 0.8. */
  function downscaleImage(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        try {
          const long = Math.max(img.naturalWidth, img.naturalHeight) || 1;
          const scale = Math.min(1, 1024 / long);
          const w = Math.max(1, Math.round(img.naturalWidth * scale));
          const h = Math.max(1, Math.round(img.naturalHeight * scale));
          const canvas = document.createElement('canvas');
          canvas.width = w; canvas.height = h;
          canvas.getContext('2d').drawImage(img, 0, 0, w, h);
          const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
          URL.revokeObjectURL(url);
          resolve({
            dataUrl,
            base64: dataUrl.split(',')[1],
            mediaType: 'image/jpeg',
            width: w, height: h,
            originalWidth: img.naturalWidth, originalHeight: img.naturalHeight
          });
        } catch (e) { URL.revokeObjectURL(url); reject(e); }
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('unreadable image')); };
      img.src = url;
    });
  }

  /* Apply an AI reply to the current corrected spec.
   * Returns { spec, diffs, chips } — chips are the code-computed record. */
  function apply(reply, currentSpec) {
    const S = BB.Spec;
    let proposed;
    if (reply.kind === 'new') {
      proposed = reply.spec;
      // Display units are the user's choice, not the model's: a new design
      // that never mentioned them keeps whatever the user was working in.
      if (reply.unitsUnspecified && currentSpec && currentSpec.meta) {
        proposed = S.deepMerge(proposed, { meta: { units: currentSpec.meta.units } });
      }
    } else {
      let patch = reply.patch;
      // B3: custom overall is derived from part extents, so an overall-only
      // diff would silently no-op behind a confident ack. Scale the
      // composition in code (Spec.scaleCustom); the extents-derived overall
      // then lands naturally, so the overall patch itself is dropped.
      if (patch && patch.overall && !patch.custom && currentSpec && currentSpec.meta &&
        currentSpec.meta.template === 'custom' &&
        !(patch.meta && patch.meta.template && patch.meta.template !== 'custom')) {
        const scaled = S.scaleCustom(currentSpec, patch.overall);
        if (scaled) {
          patch = Object.assign({}, patch, { custom: scaled });
          delete patch.overall;
        }
      }
      proposed = S.deepMerge(currentSpec, patch);
    }
    const corrected = S.correctSpec(proposed);
    const diffs = S.diffSpecs(currentSpec, corrected);
    return { spec: corrected, diffs, chips: S.describeDiff(diffs) };
  }

  BB.AI = {
    systemPrompt, budgetLine, extractJSON, looksTruncated, classify, localModel, respond, apply,
    setTransport, callModel, buildMessages, buildCritique, rejectionMarker, roundDecision, downscaleImage, stepContext,
    supportsImages, hasRemote, VISION_PROMPT,
    unconfigured: () => proxyUnconfigured, // keyless proxy seen this session (L-14)
    MAX_TOKENS, MAX_CONTINUATIONS, VERBATIM_TURNS, CONTINUE_PROMPT
  };
})();
