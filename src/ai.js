/* Blueprint Buddy — AI intent layer.
 *
 * Protocol (Phase 2): for refinements the model returns a minified JSON object
 * containing ONLY changed fields plus "explain". For a brand-new piece it
 * returns {"new":{...spec...},"explain":"..."}. For ambiguity it returns
 * {"question":"...","options":["...","..."]}.
 *
 * The reply is intent only. Code deep-merges the patch, re-corrects the spec,
 * reruns the parametric layer, and computes the ACTUAL diff for the chat chip.
 *
 * Transport: window.claude.complete when hosted inside claude.ai; otherwise a
 * built-in intent parser covers the common refinement vocabulary so the app is
 * fully functional standalone (and testable headless).
 */
var BB = globalThis.BB = globalThis.BB || {};

(function () {
  'use strict';
  const K = BB.K;

  function systemPrompt(spec) {
    return [
      'You are the design intent engine inside Blueprint Buddy, a parametric furniture design tool.',
      'You NEVER compute geometry. You propose intent; the app owns all math and re-validates everything.',
      'Reply with ONLY minified JSON, no prose, no markdown fences. Three reply shapes:',
      '1. Refinement: an object with ONLY the changed DesignSpec fields, plus "explain" (short sentence). Example: {"overall":{"height":700},"explain":"Lowered height by 50mm"}',
      '2. New design: {"new":{<full DesignSpec>},"explain":"..."}',
      '3. Ambiguous request: {"question":"...","options":["opt1","opt2","opt3"]} (2-3 short tappable answers).',
      'Set a field to null to remove it (e.g. {"drawers":null}).',
      'DesignSpec shape: {meta:{name,template(table|desk|bench|bookshelf|nightstand|cabinet),level(beginner|intermediate|advanced),units(mm|in)},overall:{width,depth,height},wood:{species},structure:{topThickness,legThickness,apronHeight,shelfCount,...},joinery:{frame,case,box},finish,drawers:{count(1-4),frontStyle(inset|overlay),runner(side_mount_slides|wood_runners)}}. All lengths mm.',
      'Joint choices must respect the level matrix below; the app enforces it regardless.',
      '--- knowledge digest ---',
      K.knowledgeDigest(),
      '--- current corrected spec ---',
      JSON.stringify(spec)
    ].join('\n');
  }

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

  function classify(obj) {
    if (!obj || typeof obj !== 'object') return null;
    if (typeof obj.question === 'string') {
      return { kind: 'question', question: obj.question, options: Array.isArray(obj.options) ? obj.options.slice(0, 3).map(String) : [] };
    }
    if (obj.new && typeof obj.new === 'object') {
      return { kind: 'new', spec: obj.new, explain: String(obj.explain || 'Here’s a starting point.') };
    }
    const patch = {};
    for (const k of Object.keys(obj)) if (k !== 'explain') patch[k] = obj[k];
    if (!Object.keys(patch).length) return null;
    return { kind: 'diff', patch, explain: String(obj.explain || 'Updated.') };
  }

  /* ---------------- local intent parser (offline fallback) ----------------
   * Deliberately conservative: handles the common refinement vocabulary and
   * asks a clarifying question when the request is ambiguous.
   */
  const MM = { mm: 1, millimeter: 1, millimeters: 1, cm: 10, centimeter: 10, centimeters: 10, m: 1000, in: 25.4, inch: 25.4, inches: 25.4, '"': 25.4, ft: 304.8, feet: 304.8, foot: 304.8 };
  function parseLen(str) {
    const m = String(str).match(/(\d+(?:\.\d+)?)\s*(mm|cm|m\b|in\b|inch(?:es)?|"|ft|feet|foot)?/i);
    if (!m) return null;
    const unit = (m[2] || 'mm').toLowerCase();
    return Math.round(parseFloat(m[1]) * (MM[unit] || 1));
  }
  const WORD_NUMS = { one: 1, a: 1, an: 1, two: 2, three: 3, four: 4 };

  function localModel(text, spec) {
    const t = ' ' + String(text).toLowerCase().trim() + ' ';
    const patch = {};
    const notes = [];
    const set = (path, v) => {
      let o = patch; const ks = path.split('.');
      ks.slice(0, -1).forEach(k => { o = o[k] = o[k] || {}; });
      o[ks[ks.length - 1]] = v;
    };

    // New design?
    const tmplWords = { table: 'table', 'dining table': 'table', desk: 'desk', bench: 'bench', bookshelf: 'bookshelf', bookcase: 'bookshelf', 'shelf unit': 'bookshelf', nightstand: 'nightstand', 'bedside table': 'nightstand', 'night stand': 'nightstand', cabinet: 'cabinet', sideboard: 'cabinet', console: 'table' };
    let wantTemplate = null;
    for (const w of Object.keys(tmplWords)) if (t.includes(' ' + w)) { wantTemplate = tmplWords[w]; break; }
    const creating = /\b(build|make|design|create|new|start)\b/.test(t) && wantTemplate && wantTemplate !== spec.meta.template;

    // Ambiguity checks first.
    if (/\b(bigger|larger|smaller)\b/.test(t) && !/\b(wide|width|deep|depth|tall|height|high|%|percent)\b/.test(t)) {
      return { kind: 'question', question: 'Happy to resize — in which direction?', options: ['Wider', 'Deeper', 'Taller'] };
    }
    if (/\b(change|different|other|new)\b.*\bwood\b/.test(t) && !Object.values(K.WOOD_SPECIES).some(s => t.includes(s.label.toLowerCase().split(' ').pop())) ) {
      return { kind: 'question', question: 'Which way should the wood go?', options: ['Walnut — dark and refined', 'Hard maple — pale and crisp', 'Pine — light and budget-friendly'] };
    }

    // Species.
    for (const s of Object.values(K.WOOD_SPECIES)) {
      if (s.sheet) continue;
      const words = s.label.toLowerCase();
      const last = words.split(' ').pop();
      if (t.includes(words) || (t.includes(last) && last !== 'oak') || (last === 'oak' && t.includes(words))) {
        set('wood.species', s.key); notes.push(s.label); break;
      }
    }
    if (!patch.wood && /\boak\b/.test(t)) { set('wood.species', /white\s+oak/.test(t) ? 'white_oak' : 'red_oak'); notes.push('oak'); }

    // Level.
    if (/\bbeginner|first (build|project)|simple joinery\b/.test(t)) { set('meta.level', 'beginner'); notes.push('beginner'); }
    else if (/\bintermediate\b/.test(t)) { set('meta.level', 'intermediate'); notes.push('intermediate'); }
    else if (/\badvanced|dovetail|mortise\b/.test(t)) { set('meta.level', 'advanced'); notes.push('advanced'); }

    // Dimensions: "<n><unit> wide/deep/tall", "width to X", "lower/raise by X".
    const dimWord = { wide: 'width', width: 'width', deep: 'depth', depth: 'depth', tall: 'height', height: 'height', high: 'height', long: 'width' };
    const re = /(\d+(?:\.\d+)?\s*(?:mm|cm|m\b|in\b|inch(?:es)?|"|ft|feet|foot)?)\s*(wide|deep|tall|high|long)|(width|depth|height)\s*(?:to|of|=|at)?\s*(\d+(?:\.\d+)?\s*(?:mm|cm|m\b|in\b|inch(?:es)?|"|ft|feet|foot)?)/gi;
    let m;
    while ((m = re.exec(t))) {
      const key = dimWord[(m[2] || m[3] || '').toLowerCase()];
      const val = parseLen(m[1] || m[4]);
      if (key && val) { set('overall.' + key, val); notes.push(`${key} ${val}mm`); }
    }
    let mm2;
    if ((mm2 = t.match(/\b(lower|shorten|raise|lift)\b(?:\s+\w+)*?\s+by\s+([\d.]+\s*(?:mm|cm|in|inch(?:es)?|")?)/))) {
      const delta = parseLen(mm2[2]);
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
    if ((mm2 = t.match(/(\d+)\s*(?:more\s+)?shel(?:f|ves)/)) || (mm2 = t.match(/shel(?:f|ves)[^\d]*(\d+)/))) {
      set('structure.shelfCount', parseInt(mm2[1], 10)); notes.push('shelves');
    } else if (/\badd (a |another )?shelf\b/.test(t)) {
      set('structure.shelfCount', spec.structure.shelfCount + 1); notes.push('shelf');
    }

    // Drawers.
    const canDrawer = w => ['nightstand', 'cabinet'].includes(w || spec.meta.template);
    if (/\b(no|remove|without)\b.*\bdrawers?\b/.test(t) && spec.meta.template !== 'nightstand') { patch.drawers = null; notes.push('no drawers'); }
    else {
      let dm = t.match(/(\d+|one|two|three|four)\s+drawers?/);
      if (!dm && /\badd (a |another )?drawer\b/.test(t)) dm = [null, String((spec.drawers ? spec.drawers.count : 0) + 1)];
      if (dm && canDrawer(wantTemplate)) {
        const count = WORD_NUMS[dm[1]] || parseInt(dm[1], 10) || 1;
        set('drawers.count', Math.min(4, Math.max(1, count)));
        if (!spec.drawers) { set('drawers.frontStyle', 'inset'); set('drawers.runner', 'side_mount_slides'); }
        notes.push(count + ' drawer(s)');
      }
      if (/\boverlay\b/.test(t)) set('drawers.frontStyle', 'overlay');
      if (/\binset\b/.test(t)) set('drawers.frontStyle', 'inset');
      if (/\bwood(en)? runners?\b/.test(t)) set('drawers.runner', 'wood_runners');
      if (/\bslides?\b/.test(t) && /\b(ball|side|metal)\b/.test(t)) set('drawers.runner', 'side_mount_slides');
    }

    // Finish.
    for (const f of K.FINISHES) {
      const kw = f.key === 'wipe_poly' ? 'poly' : f.label.toLowerCase().split(' ')[0];
      if (t.includes(kw)) { set('finish', f.key); notes.push(f.label); break; }
    }

    if (creating) {
      const base = BB.Spec.defaultSpec(wantTemplate);
      const merged = BB.Spec.deepMerge(base, patch);
      merged.meta.template = wantTemplate;
      merged.meta.name = text.length < 40 ? text.replace(/^\s*(please\s+)?(build|make|design|create)\s*(me\s+)?(a|an)?\s*/i, '').replace(/\.$/, '').trim() || wantTemplate : 'New ' + wantTemplate;
      merged.meta.name = merged.meta.name.charAt(0).toUpperCase() + merged.meta.name.slice(1);
      return { kind: 'new', spec: merged, explain: `Roughed out a ${wantTemplate} to standard proportions — refine away.` };
    }

    if (!Object.keys(patch).length) {
      return {
        kind: 'question',
        question: 'I didn’t catch a change I can make there. Try a dimension, species, joinery level, drawers, or finish — what should move?',
        options: ['Make it walnut', 'Lower it by 50 mm', 'Add a drawer']
      };
    }
    return { kind: 'diff', patch, explain: 'Adjusted ' + notes.slice(0, 4).join(', ') + '.' };
  }

  /* ---------------- transport ---------------- */
  function hasClaude() {
    return typeof window !== 'undefined' && window.claude && typeof window.claude.complete === 'function';
  }

  async function respond(userText, spec) {
    if (hasClaude()) {
      try {
        const prompt = systemPrompt(spec) + '\n--- user request ---\n' + userText +
          '\nReply with ONLY minified JSON.';
        let reply = await window.claude.complete(prompt);
        let parsed = classify(extractJSON(reply));
        if (!parsed) {
          reply = await window.claude.complete(prompt + '\nYour previous reply was not valid JSON. JSON ONLY.');
          parsed = classify(extractJSON(reply));
        }
        if (parsed) return parsed;
      } catch (e) { /* fall through to local parser */ }
    }
    return localModel(userText, spec);
  }

  /* Apply an AI reply to the current corrected spec.
   * Returns { spec, diffs, chips } — chips are the code-computed record. */
  function apply(reply, currentSpec) {
    const S = BB.Spec;
    let proposed;
    if (reply.kind === 'new') proposed = reply.spec;
    else proposed = S.deepMerge(currentSpec, reply.patch);
    const corrected = S.correctSpec(proposed);
    const diffs = S.diffSpecs(currentSpec, corrected);
    return { spec: corrected, diffs, chips: S.describeDiff(diffs, corrected.meta.units) };
  }

  BB.AI = { systemPrompt, extractJSON, classify, localModel, respond, apply, hasClaude };
})();
