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
 *   2. fetch to the Anthropic API (available when hosted on claude.ai)
 *   3. window.claude.complete (no stop_reason — truncation detected by
 *      unbalanced braces instead)
 *   4. the built-in local intent parser, so the app is fully functional
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
      'Joint slots: j[0]=frame (legs/aprons/rails), j[1]=case (carcass/shelves), j[2]=box (drawer boxes).',
      'LEVEL MATRIX (code enforces this regardless): beginner={butt_screws,pocket_screws}; intermediate adds {dowels,dado,rabbet,locking_rabbet}; advanced adds {mortise_tenon,half_blind_dovetail}.',
      'Drawers ("d") exist only on nightstand and cabinet templates. Known templates are fast and single-shot — prefer them whenever the request fits one; use t=6 (custom) only for genuinely novel forms.',
      'REFINEMENTS: when the user asks for a change, EDIT the current spec — send ONLY the changed wire keys. Do not redesign. STRUCTURAL CRITIQUE: when the message is a structural critique of your last composition, fix ONLY the listed problems and return the corrected FULL spec as {"N":{...}}.',
      '--- knowledge digest ---',
      K.knowledgeDigest(),
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
    const explain = String(obj.e !== undefined ? obj.e : (obj.explain || '')).slice(0, 200);
    const N = obj.N !== undefined ? obj.N : obj.new;
    if (N && typeof N === 'object') {
      const spec = Codec().decode(N);
      if (!spec) return null;
      // A new design that never states display units inherits the user's
      // current choice (apply() fills it in) instead of the wire default.
      return { kind: 'new', spec, unitsUnspecified: N.u === undefined && N.units === undefined, explain: explain || 'Here’s a starting point.' };
    }
    const wireDiff = {};
    for (const k of Object.keys(obj)) if (k !== 'e' && k !== 'explain') wireDiff[k] = obj[k];
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

  function localModel(text, spec) {
    text = BB.Units.normalizeLengthText(text); // idempotent; direct callers get the same guarantee as chat
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
    if (/\b(change|different|other|new)\b.*\bwood\b/.test(t) && !Object.values(K.WOOD_SPECIES).some(s => t.includes(s.label.toLowerCase().split(' ').pop()))) {
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
        options: ['Make it walnut', `Lower it by ${BB.Units.fmtLength(spec.meta.units === 'mm' ? 50 : 50.8)}`, 'Add a drawer']
      };
    }
    return { kind: 'diff', patch, explain: 'Adjusted ' + notes.slice(0, 4).join(', ') + '.' };
  }

  /* ---------------- transports ---------------- */
  let injectedTransport = null; // (system, messages) => Promise<{text, stopReason}>
  function setTransport(fn) { injectedTransport = fn; }
  let anthropicDead = false; // one hard network failure disables it for the session
  // Same-origin proxy (api/chat.js) — present when hosted on Vercel or the
  // bundled dev server; absent on claude.ai, where it dies on first touch
  // and the direct transport takes over. Browser-only.
  let proxyDead = typeof window === 'undefined';

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
      throw new Error('proxy unavailable (' + response.status + ')');
    }
    if (!response.ok) throw new Error('proxy returned ' + response.status);
    let data;
    try { data = await response.json(); }
    catch (e) { proxyDead = true; throw new Error('proxy returned non-JSON'); }
    if (data.error) throw new Error(data.error.message || 'proxy error');
    return { text: (data.content || []).map(b => b.text || '').join(''), stopReason: data.stop_reason || 'end_turn' };
  }

  async function anthropicTransport(system, messages) {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'claude-sonnet-5', max_tokens: MAX_TOKENS, system, messages })
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
    if (typeof fetch === 'function' && (!proxyDead || !anthropicDead) && typeof window !== 'undefined') return true;
    return typeof window !== 'undefined' && window.claude && typeof window.claude.complete === 'function';
  }
  function supportsImages() {
    return !!injectedTransport || (typeof fetch === 'function' && (!proxyDead || !anthropicDead));
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
    // sees them — the model proposes intent and never converts units.
    userText = BB.Units.normalizeLengthText(userText);
    const onStatus = opts.onStatus || (() => {});
    if (!hasRemote()) return { reply: localModel(userText, spec), turns: opts.turns || [], local: true };

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
      if (opts.image) return { reply: null, turns, error: 'The design service is unreachable, and photo analysis needs it. Text refinements still work offline.' };
      return { reply: localModel(userText, spec), turns, local: true };
    }
  }

  /* Structured critique for the propose-validate-revise loop (novel pieces). */
  function buildCritique(failedChecks) {
    const lines = failedChecks.slice(0, 10).map(c => `- ${c.title}: ${c.explain} (${c.value}; required: ${c.threshold})`);
    return `Structural validation of your composition FAILED. Problems:\n${lines.join('\n')}\nFix ONLY these problems — keep the design intent and everything that already works. Reply {"N":{corrected FULL wire spec}} as minified JSON, nothing else.`;
  }

  /* ---------------- photo-to-design (Phase 4 item 4) ---------------- */
  const VISION_PROMPT = [
    'The image is a furniture photo. Identify the furniture type and estimate overall proportions, anchored to standard ergonomic heights from the knowledge digest (table 730-760, desk 720-750, seat 430-480, nightstand 550-700, counter 860-940 mm).',
    'Reply {"N":{full wire spec}} — use a known template (t 0-5) whenever one fits; use t=6 (custom, parts + connections) only if none does.',
    'Estimate wood species from color/grain (m). If drawers are visible on a nightstand/cabinet, set "d". Minified JSON only.'
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
    MAX_TOKENS, MAX_CONTINUATIONS, VERBATIM_TURNS, CONTINUE_PROMPT
  };
})();
