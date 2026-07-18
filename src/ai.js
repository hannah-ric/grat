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

  /* ---------------- system prompt: static schema doc + level joint list +
   * knowledge digests + current spec in wire format. Nothing else. -------- */
  function systemPrompt(spec) {
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
      'REFINEMENTS: EDIT the current spec — send ONLY the changed wire keys; never redesign. STRUCTURAL CRITIQUE: fix ONLY the listed problems and return the corrected FULL spec as {"N":{...}}.',
      '--- knowledge digest ---',
      K.knowledgeDigest(),
      // Hardware style intent only — every count, rating, and bore is code
      // (BB.HW), so capacities and formulas never spend prompt tokens.
      BB.HW ? BB.HW.digestLine() : '',
      '--- current spec (wire format) ---',
      JSON.stringify(Codec().encode(spec))
    ].join('\n');
  }

  /* ---------------- JSON extraction ---------------- */
  /* Extract the first balanced JSON object from model text. */
  function extractJSON(text) {
    const s = String(text || '');
    const start = s.indexOf('{');
    if (start < 0) return null;
    let depth = 0, inStr = false, escp = false;
    for (let i = start; i < s.length; i++) {
      const c = s[i];
      if (inStr) { if (escp) escp = false; else if (c === '\\') escp = true; else if (c === '"') inStr = false; continue; }
      if (c === '"') inStr = true;
      else if (c === '{') depth++;
      else if (c === '}') { depth--; if (!depth) { try { return JSON.parse(s.slice(start, i + 1)); } catch (e) { return null; } } }
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
      return { kind: 'info', text: String(info).slice(0, 900) };
    }
    const explain = String(obj.e !== undefined ? obj.e : (obj.explain || '')).slice(0, 320);
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
    const patch = Codec().decodePartial(wireDiff);
    if (!patch) return null;
    return { kind: 'diff', patch, explain: explain || 'Updated.' };
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
    const tmplWords = { table: 'table', 'dining table': 'table', desk: 'desk', bench: 'bench', bookshelf: 'bookshelf', bookcase: 'bookshelf', 'shelf unit': 'bookshelf', nightstand: 'nightstand', 'bedside table': 'nightstand', 'night stand': 'nightstand', cabinet: 'cabinet', sideboard: 'cabinet', console: 'table' };
    let wantTemplate = null, tmplWord = null;
    for (const w of Object.keys(tmplWords).sort((a, b) => b.length - a.length)) {
      if (t.includes(' ' + w)) { wantTemplate = tmplWords[w]; tmplWord = w; break; }
    }
    // A creation verb creates — and so does a bare noun-phrase description
    // (audit X-01): the hero placeholder "A walnut nightstand with two
    // drawers" names a piece with no verb at all. A description leads with
    // the template noun (an article plus at most three descriptor words),
    // never refers back to the current piece, and is not negated
    // ("not a nightstand").
    const bareDescription = !!tmplWord &&
      !/\b(it|its|this|that|my|mine)\b/.test(t) &&
      !negated(t, rxWord(tmplWord)) &&
      new RegExp('^(?:(?:an?|the)\\s+)?(?:[\\w\'-]+\\s+){0,3}?' + tmplWord.replace(/[\s-]+/g, '[\\s-]+') + 's?\\b').test(t.trim());
    const creating = (/\b(build|make|design|create|new|start)\b/.test(t) || bareDescription) && wantTemplate && wantTemplate !== spec.meta.template;

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
      const base = BB.Spec.defaultSpec(wantTemplate);
      const merged = BB.Spec.deepMerge(base, patch);
      merged.meta.template = wantTemplate;
      merged.meta.name = phrasing.length < 40 ? phrasing.replace(/^\s*(please\s+)?(build|make|design|create)\s*(me\s+)?(a|an)?\s*/i, '').replace(/\.$/, '').trim() || wantTemplate : 'New ' + wantTemplate;
      merged.meta.name = merged.meta.name.charAt(0).toUpperCase() + merged.meta.name.slice(1);
      const drawerNote = dm && !canDrawer(landing) ? ` (drawers aren’t available on a ${wantTemplate} yet, so I skipped those)` : '';
      return { kind: 'new', spec: merged, explain: `Roughed out a ${wantTemplate} to standard proportions${drawerNote} — refine away.` };
    }

    // A rejected species with nothing else asked: say so and ask which wood
    // instead — never a wrong ack (audit FE-H11).
    if (!Object.keys(patch).length && negatedSpecies) {
      const alts = ['Walnut', 'Hard maple', 'Cherry', 'White oak']
        .filter(x => !negatedSpecies.toLowerCase().includes(x.toLowerCase().split(' ').pop())).slice(0, 3);
      return { kind: 'question', question: `Understood — not ${negatedSpecies.toLowerCase()}. Which wood should it be instead?`, options: alts };
    }

    if (!Object.keys(patch).length) {
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
  let injectedTransport = null; // (system, messages) => Promise<{text, stopReason}>
  function setTransport(fn) { injectedTransport = fn; }
  let anthropicDead = false; // one hard network failure disables it for the session
  // Same-origin proxy (api/chat.js) — present when hosted on Vercel or the
  // bundled dev server; absent on claude.ai, where it dies on first touch
  // and the direct transport takes over. Browser-only.
  let proxyDead = typeof window === 'undefined';
  // A proxy that EXISTS but answered 503 (no ANTHROPIC_API_KEY on the server)
  // is a broken deploy, not ordinary offline — remembered for the session so
  // the UI can say "AI not configured" instead of the generic offline label
  // (audit L-14).
  let proxyUnconfigured = false;

  async function proxyTransport(system, messages) {
    let response;
    try {
      response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ system, messages, max_tokens: MAX_TOKENS })
      });
    } catch (e) { proxyDead = true; throw e; }
    // 404/405: no proxy at this origin. 503: proxy present but unconfigured.
    // Both are permanent for the session; other failures may be transient
    // upstream errors and leave the proxy alive for the next message.
    if (response.status === 404 || response.status === 405 || response.status === 503) {
      proxyDead = true;
      if (response.status === 503) proxyUnconfigured = true; // route exists, key missing (L-14)
      throw new Error('proxy unavailable (' + response.status + ')');
    }
    // Usage limit (402) and rate limit (429) are AUTHORITATIVE, not transport
    // failures — surface them distinctly so the UI can prompt an upgrade instead
    // of silently dropping to the offline parser. The proxy stays alive.
    if (response.status === 402 || response.status === 429) {
      let payload = null;
      try { payload = await response.json(); } catch (e) { /* no body */ }
      const err = new Error(response.status === 402 ? 'usage_limit' : 'rate_limited');
      if (response.status === 402) { err.usageLimit = true; err.billing = payload && payload.billing; }
      else err.rateLimited = true;
      throw err;
    }
    if (!response.ok) throw new Error('proxy returned ' + response.status);
    let data;
    try { data = await response.json(); }
    catch (e) { proxyDead = true; throw new Error('proxy returned non-JSON'); }
    if (data.error) throw new Error(data.error.message || 'proxy error');
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
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({ model, max_tokens: MAX_TOKENS, system, messages })
    });
    if (!response.ok) throw new Error('API returned ' + response.status);
    const data = await response.json();
    if (data.error) throw new Error(data.error.message || 'API error');
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
    if (typeof fetch === 'function' && !proxyDead && typeof window !== 'undefined') return true;
    if (!inBrowser && typeof fetch === 'function' && !anthropicDead) return true;
    return typeof window !== 'undefined' && window.claude && typeof window.claude.complete === 'function';
  }
  function supportsImages() {
    if (injectedTransport) return true;
    if (typeof fetch === 'function' && !proxyDead) return true;
    return false;
  }

  async function rawCall(system, messages) {
    if (injectedTransport) return injectedTransport(system, messages);
    if (typeof fetch === 'function' && !proxyDead) {
      try {
        return await proxyTransport(system, messages);
      } catch (e) {
        if (!proxyDead) throw e; // proxy alive, upstream hiccup — surface it
        // proxy absent/unconfigured: fall through to the direct transport
      }
    }
    if (typeof fetch === 'function' && !anthropicDead) {
      try {
        return await anthropicTransport(system, messages);
      } catch (e) {
        anthropicDead = true; // fall through once, stay fallen
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

  /* ---------------- context budget (1b) ----------------
   * turns: [{role:'user'|'assistant', content}] maintained by the UI in wire
   * format. Send the last 6 verbatim; compress everything older into the
   * code-built digest (from history snapshots — zero extra AI calls).
   */
  function buildMessages(turns, digest, newUserContent) {
    let recent = turns.slice(-VERBATIM_TURNS);
    while (recent.length && recent[0].role === 'assistant') recent = recent.slice(1);
    const out = [];
    if (digest && turns.length > VERBATIM_TURNS) {
      out.push({ role: 'user', content: '[context] ' + digest });
      out.push({ role: 'assistant', content: '{"e":"ok"}' });
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
    if (!hasRemote()) return { reply: localModel(userText, spec, { phrasing }), turns: opts.turns || [], local: true, unconfigured: proxyUnconfigured };

    const system = systemPrompt(spec);
    const turns = opts.turns || [];
    const digest = opts.digest || '';
    const userContent = opts.image
      ? [
          { type: 'image', source: { type: 'base64', media_type: opts.image.mediaType, data: opts.image.base64 } },
          { type: 'text', text: userText }
        ]
      : userText;
    const baseMessages = buildMessages(turns, digest, userContent);

    try {
      let { text } = await callModel(system, baseMessages, onStatus);
      let parsed = classify(extractJSON(text));
      if (!parsed) {
        // The single validation retry. Truncation never lands here — the
        // continuation protocol already stitched partial outputs together.
        onStatus('Re-asking for valid JSON');
        const retryMessages = [...baseMessages,
          { role: 'assistant', content: text || '(empty)' },
          { role: 'user', content: 'That was not valid wire-format JSON. Reply again with ONLY minified JSON in the documented wire format.' }];
        const second = await callModel(system, retryMessages, onStatus);
        parsed = classify(extractJSON(second.text));
        if (parsed) text = second.text;
      }
      if (parsed) {
        const newTurns = [...turns,
          { role: 'user', content: typeof userContent === 'string' ? userContent : userText + ' [photo]' },
          { role: 'assistant', content: text }];
        return { reply: parsed, turns: newTurns, local: false };
      }
      return { reply: null, turns, error: 'The model never produced a valid design reply.' };
    } catch (err) {
      // Usage/rate limits are authoritative server answers, not outages — never
      // mask them behind the offline parser.
      if (err && err.usageLimit) return { reply: null, turns, usageLimit: true, billing: err.billing || null };
      if (err && err.rateLimited) return { reply: null, turns, rateLimited: true };
      if (opts.image) return { reply: null, turns, error: 'The design service is unreachable, and photo analysis needs it. Text refinements still work offline.' };
      return { reply: localModel(userText, spec, { phrasing }), turns, local: true, unconfigured: proxyUnconfigured };
    }
  }

  /* Structured critique for the propose-validate-revise loop (novel pieces). */
  function buildCritique(failedChecks) {
    const lines = failedChecks.slice(0, 10).map(c => `- ${c.title}: ${c.explain} (${c.value}; required: ${c.threshold})`);
    return `Structural validation of your composition FAILED. Problems:\n${lines.join('\n')}\nFix ONLY these problems — keep the design intent and everything that already works. Reply {"N":{corrected FULL wire spec}} as minified JSON, nothing else.`;
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
    } else proposed = S.deepMerge(currentSpec, reply.patch);
    const corrected = S.correctSpec(proposed);
    const diffs = S.diffSpecs(currentSpec, corrected);
    return { spec: corrected, diffs, chips: S.describeDiff(diffs) };
  }

  BB.AI = {
    systemPrompt, extractJSON, looksTruncated, classify, localModel, respond, apply,
    setTransport, callModel, buildMessages, buildCritique, downscaleImage,
    supportsImages, hasRemote, VISION_PROMPT,
    unconfigured: () => proxyUnconfigured, // keyless proxy seen this session (L-14)
    MAX_TOKENS, MAX_CONTINUATIONS, VERBATIM_TURNS, CONTINUE_PROMPT
  };
})();
