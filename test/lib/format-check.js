/* Blueprint Buddy — structural validators for exported files (audit V-04).
 *
 * WHY THIS EXISTS. Every export assertion in the suite used to be a substring
 * check: "does the .dae contain <up_axis>". A substring check cannot tell a
 * valid document from a truncated one, an unbalanced one, or one whose design
 * name broke out of its element. A malformed export therefore shipped green.
 * These validators parse each format as the format it claims to be, so a
 * generator bug fails the suite instead of failing in SketchUp.
 *
 * ZERO DEPENDENCIES, by the founding rule — hand-rolled over Node built-ins.
 * They are deliberately strict-but-small: they check the structural invariants
 * a consumer relies on (balance, containment, index integrity), not the full
 * XML/glTF specs. Anything they do not model, they must not silently accept —
 * an unparseable construct is an error, never a shrug.
 *
 * Not a Node test file itself: required by test/unit.test.js.
 */
'use strict';

/* ============================================================ XML / SVG ==== */

const NAME_START = /[A-Za-z_:]/;
const NAME_CHAR = /[-A-Za-z0-9_:.]/;
/* The five predefined entities plus numeric character references. Anything
 * else is a well-formedness error — which is exactly how an unescaped design
 * name ("Bench & Co", "a<b") announces itself. */
const ENTITY = /^&(?:amp|lt|gt|quot|apos|#[0-9]+|#x[0-9A-Fa-f]+);/;

function checkEntities(s, where, errors) {
  let i = s.indexOf('&');
  while (i !== -1) {
    if (!ENTITY.test(s.slice(i))) {
      errors.push(`${where}: bare "&" (not a valid entity reference) near "${s.slice(i, i + 24)}"`);
      return;
    }
    i = s.indexOf('&', i + 1);
  }
}

/* Parse an XML document far enough to prove it is well-formed.
 * Returns { ok, errors, root, elements, depth, tags, texts, attrs }.
 *   elements — total element count
 *   tags     — Map of tag name -> count
 *   texts    — every text node, in document order
 *   attrs    — every attribute value, in document order
 * texts/attrs are what the XSS lock (V-05) inspects: a hostile design name
 * must appear in exactly one of them and never as markup. */
function parseXML(src) {
  const errors = [];
  const stack = [];
  const tags = new Map();
  const texts = [];
  const attrs = [];
  let elements = 0, depth = 0, maxDepth = 0, root = null, rootClosed = false;
  const s = String(src);
  let i = 0;

  const fail = msg => { errors.push(msg + ` (at offset ${i})`); };

  while (i < s.length) {
    if (s[i] !== '<') {
      const next = s.indexOf('<', i);
      const text = s.slice(i, next === -1 ? s.length : next);
      if (text.trim()) {
        if (!stack.length) fail(`text "${text.trim().slice(0, 20)}" outside the root element`);
        texts.push(text);
        checkEntities(text, 'text', errors);
      }
      if (next === -1) break;
      i = next;
      continue;
    }
    if (s.startsWith('<?', i)) {                       // declaration / PI
      const end = s.indexOf('?>', i);
      if (end === -1) { fail('unterminated <? ... ?>'); break; }
      i = end + 2;
      continue;
    }
    if (s.startsWith('<!--', i)) {
      const end = s.indexOf('-->', i);
      if (end === -1) { fail('unterminated comment'); break; }
      i = end + 3;
      continue;
    }
    if (s.startsWith('<![CDATA[', i)) {
      const end = s.indexOf(']]>', i);
      if (end === -1) { fail('unterminated CDATA'); break; }
      i = end + 3;
      continue;
    }
    if (s.startsWith('<!', i)) {                       // DOCTYPE and friends
      const end = s.indexOf('>', i);
      if (end === -1) { fail('unterminated <! ... >'); break; }
      i = end + 1;
      continue;
    }
    if (s.startsWith('</', i)) {                       // end tag
      let j = i + 2;
      if (!NAME_START.test(s[j] || '')) { fail('malformed end tag'); break; }
      while (j < s.length && NAME_CHAR.test(s[j])) j++;
      const name = s.slice(i + 2, j);
      while (j < s.length && /\s/.test(s[j])) j++;
      if (s[j] !== '>') { fail(`end tag </${name}> is not closed by ">"`); break; }
      const open = stack.pop();
      if (open === undefined) fail(`end tag </${name}> with no open element`);
      else if (open !== name) fail(`end tag </${name}> closes <${open}>`);
      depth--;
      if (!stack.length) rootClosed = true;
      i = j + 1;
      continue;
    }
    // start tag
    let j = i + 1;
    if (!NAME_START.test(s[j] || '')) { fail('malformed start tag'); break; }
    while (j < s.length && NAME_CHAR.test(s[j])) j++;
    const name = s.slice(i + 1, j);
    if (rootClosed && !stack.length) fail(`second root element <${name}>`);
    const seen = new Set();
    let selfClosing = false, closed = false;
    while (j < s.length) {
      while (j < s.length && /\s/.test(s[j])) j++;
      if (s[j] === '/' && s[j + 1] === '>') { selfClosing = true; closed = true; j += 2; break; }
      if (s[j] === '>') { closed = true; j++; break; }
      if (!NAME_START.test(s[j] || '')) { fail(`unexpected "${s[j]}" in <${name}>`); break; }
      const aStart = j;
      while (j < s.length && NAME_CHAR.test(s[j])) j++;
      const aName = s.slice(aStart, j);
      if (seen.has(aName)) fail(`duplicate attribute "${aName}" on <${name}>`);
      seen.add(aName);
      while (j < s.length && /\s/.test(s[j])) j++;
      if (s[j] !== '=') { fail(`attribute "${aName}" on <${name}> has no value`); break; }
      j++;
      while (j < s.length && /\s/.test(s[j])) j++;
      const q = s[j];
      if (q !== '"' && q !== "'") { fail(`attribute "${aName}" on <${name}> is not quoted`); break; }
      const close = s.indexOf(q, j + 1);
      if (close === -1) { fail(`attribute "${aName}" on <${name}> is unterminated`); j = s.length; break; }
      const value = s.slice(j + 1, close);
      if (value.includes('<')) fail(`attribute "${aName}" on <${name}> contains a raw "<"`);
      checkEntities(value, `attribute ${aName}`, errors);
      attrs.push(value);
      j = close + 1;
    }
    if (!closed) { fail(`start tag <${name}> is never closed`); break; }
    elements++;
    tags.set(name, (tags.get(name) || 0) + 1);
    if (!stack.length && root === null) root = name;
    if (!selfClosing) {
      stack.push(name);
      depth++;
      if (depth > maxDepth) maxDepth = depth;
    }
    i = j;
  }
  if (stack.length) errors.push(`unclosed elements at end of document: ${stack.join(' > ')}`);
  if (root === null) errors.push('no root element');

  return { ok: errors.length === 0, errors, root, elements, depth: maxDepth, tags, texts, attrs };
}

/* Resolve the five predefined entities and numeric references. parseXML hands
 * back raw source slices; the XSS lock needs the decoded value so it can prove
 * a hostile design name arrived intact AS TEXT rather than as markup. */
function decodeEntities(s) {
  return String(s).replace(/&(amp|lt|gt|quot|apos|#x[0-9A-Fa-f]+|#[0-9]+);/g, (m, ent) => {
    if (ent[0] === '#') return String.fromCodePoint(parseInt(ent.slice(ent[1] === 'x' ? 2 : 1), ent[1] === 'x' ? 16 : 10));
    return { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }[ent];
  });
}

/* SVG-specific wrapper: well-formed XML AND a real SVG document. */
function parseSVG(src) {
  const r = parseXML(src);
  if (r.root !== null && r.root !== 'svg') r.errors.push(`root element is <${r.root}>, not <svg>`);
  if (!/<svg\b[^>]*\bxmlns\s*=\s*"http:\/\/www\.w3\.org\/2000\/svg"/.test(String(src))) {
    r.errors.push('root <svg> does not declare the SVG namespace');
  }
  r.ok = r.errors.length === 0;
  return r;
}

/* ==================================================================== GLB === */

const MAGIC = 0x46546C67;   // 'glTF'
const CHUNK_JSON = 0x4E4F534A;
const CHUNK_BIN = 0x004E4942;

/* Validate the GLB *container*: magic, version, declared-vs-actual length,
 * chunk headers, 4-byte alignment, and that the JSON chunk parses. Returns
 * { ok, errors, json, chunks, declaredLength, actualLength }. */
function checkGLB(buffer) {
  const errors = [];
  const u8 = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  const actualLength = u8.byteLength;
  const out = { ok: false, errors, json: null, chunks: [], declaredLength: null, actualLength };
  if (actualLength < 12) { errors.push(`file is ${actualLength} bytes — shorter than the 12-byte GLB header`); return out; }
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);

  const magic = dv.getUint32(0, true);
  if (magic !== MAGIC) errors.push(`magic is 0x${magic.toString(16)}, not "glTF" (0x46546c67)`);
  const version = dv.getUint32(4, true);
  if (version !== 2) errors.push(`container version is ${version}, not 2`);
  const declared = dv.getUint32(8, true);
  out.declaredLength = declared;
  // The single most valuable assertion here: a truncated or over-allocated
  // file is exactly the failure a substring check cannot see.
  if (declared !== actualLength) errors.push(`header declares ${declared} bytes, file is ${actualLength} bytes`);

  let p = 12;
  const limit = Math.min(declared, actualLength);
  while (p + 8 <= limit) {
    const len = dv.getUint32(p, true);
    const type = dv.getUint32(p + 4, true);
    const body = p + 8;
    if (len % 4 !== 0) errors.push(`chunk at offset ${p} has length ${len}, not a multiple of 4`);
    if (body + len > limit) { errors.push(`chunk at offset ${p} claims ${len} bytes but only ${limit - body} remain`); break; }
    out.chunks.push({ offset: p, length: len, type });
    if (type === CHUNK_JSON) {
      const text = Buffer.from(u8.buffer, u8.byteOffset + body, len).toString('utf8');
      try { out.json = JSON.parse(text); }
      catch (e) { errors.push(`JSON chunk does not parse: ${e.message}`); }
    }
    p = body + len;
  }
  if (p !== limit) errors.push(`chunk walk ended at ${p}, expected ${limit} — trailing bytes or a bad chunk length`);
  if (!out.chunks.length) errors.push('no chunks after the header');
  else {
    if (out.chunks[0].type !== CHUNK_JSON) errors.push('first chunk is not the JSON chunk (glTF 2.0 requires it first)');
    for (const c of out.chunks.slice(1)) {
      if (c.type !== CHUNK_BIN) errors.push(`chunk at offset ${c.offset} has unknown type 0x${c.type.toString(16)}`);
    }
  }
  out.ok = errors.length === 0;
  return out;
}

/* Validate the glTF JSON *graph*: every index actually resolves, every buffer
 * view fits its buffer, and the declared buffer length matches the BIN chunk.
 * A dangling accessor index is a file that opens in nothing. */
function checkGLTF(json, binLength) {
  const errors = [];
  if (!json || typeof json !== 'object') { errors.push('no glTF JSON'); return { ok: false, errors }; }
  const arr = k => (Array.isArray(json[k]) ? json[k] : []);
  const nodes = arr('nodes'), meshes = arr('meshes'), materials = arr('materials');
  const accessors = arr('accessors'), views = arr('bufferViews'), buffers = arr('buffers'), scenes = arr('scenes');

  if (!json.asset || json.asset.version !== '2.0') errors.push(`asset.version is ${JSON.stringify(json.asset && json.asset.version)}, not "2.0"`);
  if (!scenes.length) errors.push('no scenes');
  if (typeof json.scene !== 'number' || !scenes[json.scene]) errors.push(`scene index ${json.scene} does not resolve`);
  for (const sc of scenes) {
    for (const n of (sc.nodes || [])) if (!nodes[n]) errors.push(`scene references missing node ${n}`);
  }
  nodes.forEach((nd, i) => {
    if (nd.mesh !== undefined && !meshes[nd.mesh]) errors.push(`node ${i} references missing mesh ${nd.mesh}`);
    for (const key of ['translation', 'scale']) {
      if (nd[key] && (nd[key].length !== 3 || nd[key].some(v => !Number.isFinite(v)))) errors.push(`node ${i}.${key} is not three finite numbers`);
    }
    if (nd.rotation) {
      if (nd.rotation.length !== 4 || nd.rotation.some(v => !Number.isFinite(v))) errors.push(`node ${i}.rotation is not four finite numbers`);
      else {
        const len = Math.hypot(...nd.rotation);
        if (Math.abs(len - 1) > 1e-5) errors.push(`node ${i}.rotation is not a unit quaternion (|q| = ${len})`);
      }
    }
  });
  meshes.forEach((m, i) => {
    const prims = Array.isArray(m.primitives) ? m.primitives : [];
    if (!prims.length) errors.push(`mesh ${i} has no primitives`);
    prims.forEach((pr, j) => {
      const where = `mesh ${i} primitive ${j}`;
      for (const [name, idx] of Object.entries(pr.attributes || {})) {
        if (!accessors[idx]) errors.push(`${where} attribute ${name} references missing accessor ${idx}`);
      }
      if ((pr.attributes || {}).POSITION === undefined) errors.push(`${where} has no POSITION attribute`);
      if (pr.indices !== undefined && !accessors[pr.indices]) errors.push(`${where} references missing accessor ${pr.indices} for indices`);
      if (pr.material !== undefined && !materials[pr.material]) errors.push(`${where} references missing material ${pr.material}`);
    });
  });
  accessors.forEach((a, i) => {
    if (a.bufferView !== undefined && !views[a.bufferView]) errors.push(`accessor ${i} references missing bufferView ${a.bufferView}`);
    if (!(a.count > 0)) errors.push(`accessor ${i} has count ${a.count}`);
  });
  views.forEach((v, i) => {
    const buf = buffers[v.buffer || 0];
    if (!buf) { errors.push(`bufferView ${i} references missing buffer ${v.buffer}`); return; }
    if ((v.byteOffset || 0) + v.byteLength > buf.byteLength) {
      errors.push(`bufferView ${i} runs past the end of buffer ${v.buffer || 0}`);
    }
  });
  if (binLength != null && buffers[0] && buffers[0].byteLength > binLength) {
    errors.push(`buffers[0].byteLength ${buffers[0].byteLength} exceeds the BIN chunk's ${binLength} bytes`);
  }
  return { ok: errors.length === 0, errors, counts: { nodes: nodes.length, meshes: meshes.length, materials: materials.length, accessors: accessors.length, bufferViews: views.length } };
}

/* ==================================================================== Ruby == */

const RUBY_OPENERS = new Set(['module', 'class', 'def', 'begin', 'case', 'do']);
/* if/unless/while/until/for open a block only in statement position; used as a
 * trailing modifier ("face.reverse! if …") they take no `end`. The generated
 * export uses both forms, so the first-word-on-the-line rule is load-bearing. */
const RUBY_MODIFIERS = new Set(['if', 'unless', 'while', 'until', 'for']);

/* Is the SketchUp Ruby export syntactically plausible? Not a Ruby parser — a
 * lexer that strips comments and string literals, then checks the things a
 * broken generator actually breaks: unterminated strings, unbalanced
 * brackets, and block keywords without a matching `end`. */
function checkRuby(src) {
  const errors = [];
  const s = String(src);
  const brackets = [];
  const pairs = { ')': '(', ']': '[', '}': '{' };
  let blockDepth = 0, minBlockDepth = 0, line = 1, atLineStart = true;
  let i = 0;

  while (i < s.length) {
    const c = s[i];
    if (c === '\n') { line++; atLineStart = true; i++; continue; }
    if (c === '#') { const nl = s.indexOf('\n', i); i = nl === -1 ? s.length : nl; continue; }
    if (/\s/.test(c)) { i++; continue; }
    if (c === '"' || c === "'") {
      const quote = c;
      let j = i + 1, terminated = false;
      while (j < s.length) {
        if (s[j] === '\\') { j += 2; continue; }
        if (s[j] === '\n') line++;
        if (s[j] === quote) { terminated = true; break; }
        j++;
      }
      if (!terminated) { errors.push(`unterminated ${quote === '"' ? 'double' : 'single'}-quoted string opened on line ${line}`); break; }
      i = j + 1;
      atLineStart = false;
      continue;
    }
    if ('([{'.includes(c)) { brackets.push({ c, line }); i++; atLineStart = false; continue; }
    if (')]}'.includes(c)) {
      const open = brackets.pop();
      if (!open) errors.push(`stray "${c}" on line ${line}`);
      else if (open.c !== pairs[c]) errors.push(`"${open.c}" on line ${open.line} closed by "${c}" on line ${line}`);
      i++; atLineStart = false;
      continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      let j = i;
      while (j < s.length && /[A-Za-z0-9_]/.test(s[j])) j++;
      const word = s.slice(i, j);
      const isFirst = atLineStart;
      // `end` may itself be a method name (`arr.end`); ours never is.
      if (word === 'end' && s[i - 1] !== '.') {
        blockDepth--;
        if (blockDepth < minBlockDepth) minBlockDepth = blockDepth;
      } else if (RUBY_OPENERS.has(word) && s[i - 1] !== '.') {
        blockDepth++;
      } else if (RUBY_MODIFIERS.has(word) && isFirst) {
        blockDepth++;
      }
      i = j; atLineStart = false;
      continue;
    }
    i++; atLineStart = false;
  }

  for (const b of brackets) errors.push(`"${b.c}" opened on line ${b.line} is never closed`);
  if (minBlockDepth < 0) errors.push(`saw ${-minBlockDepth} more "end" than block openers`);
  if (blockDepth !== 0) errors.push(`${blockDepth} block${blockDepth === 1 ? '' : 's'} left open at end of file (module/def/begin without end)`);

  return { ok: errors.length === 0, errors, blockDepth };
}

/* =========================================================== injection ====== */

/* Scan a rendered HTML/SVG document for markup an escaped design name must
 * never be able to create.
 *
 * Deliberately structural, at two levels, because both naive forms of this
 * check are wrong. Searching the document for "onerror=" false-positives on
 * CORRECT output: a design honestly named `<img src=x onerror=alert(1)>`
 * renders as `&lt;img src=x onerror=alert(1)&gt;`, where the substring
 * survives as inert prose and no element exists. Searching a whole tag's
 * attribute text false-positives the same way, because an escaped payload
 * sitting inside `content="…"` still reads as an event handler.
 *
 * So: tags are located, then attribute NAMES are read separately from
 * attribute VALUES. A handler is dangerous only as a name; a javascript: URL
 * only as the value of a URL-bearing attribute. Returns the first offender,
 * or null. */
const RISKY_ELEMENT = /^(?:script|iframe|object|embed|frame|frameset)$/i;
const URL_ATTR = /^(?:href|src|action|formaction|xlink:href|data|poster)$/i;
function findMarkupInjection(html) {
  for (const m of String(html).matchAll(/<([a-zA-Z][-\w:]*)((?:"[^"]*"|'[^']*'|[^>"'])*)>/g)) {
    const [full, name, attrs] = m;
    const at = full.length > 100 ? full.slice(0, 100) + '…' : full;
    if (RISKY_ELEMENT.test(name)) return { reason: `<${name}> element`, at };
    for (const a of attrs.matchAll(/([-\w:]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]*))/g)) {
      const attrName = a[1];
      const value = a[2] !== undefined ? a[2] : a[3] !== undefined ? a[3] : (a[4] || '');
      if (/^on[a-z]+$/i.test(attrName)) return { reason: `inline event handler "${attrName}"`, at };
      if (URL_ATTR.test(attrName) && /^\s*javascript\s*:/i.test(decodeEntities(value))) {
        return { reason: `javascript: URL in "${attrName}"`, at };
      }
    }
  }
  return null;
}

/* ============================================================== leakage ===== */

/* A generator that stringifies a missing value leaves a fingerprint. Every
 * text export is checked for it — cheaper than any format-specific rule and it
 * catches the class of bug where a new field is read before it is computed. */
const LEAK = /\b(?:undefined|NaN|Infinity)\b|\[object Object\]/;
function findLeak(text) {
  const m = LEAK.exec(String(text));
  if (!m) return null;
  const at = m.index;
  return { token: m[0], context: String(text).slice(Math.max(0, at - 40), at + 40) };
}

module.exports = { parseXML, parseSVG, decodeEntities, checkGLB, checkGLTF, checkRuby, findMarkupInjection, findLeak };
