#!/usr/bin/env node
/* Blueprint Buddy — build: inline everything into dist/index.html.
 * The output is a single self-contained file (fonts and Three.js embedded)
 * suitable for publishing as a Claude Artifact. Run: node build.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = __dirname;
const read = p => fs.readFileSync(path.join(root, p), 'utf8');

/* ---- source stripping (2026-07 audit, outcome D) ----
 * dist shipped ~260 KB of src comments and blank lines verbatim. Stripping
 * happens HERE, at build time only — src/ stays fully commented; the
 * readability-vs-payload tradeoff the design-language doc declined never
 * actually existed, because the two live in different files.
 *
 * The method is line-granularity by design: only lines whose ENTIRE trimmed
 * content is comment (or nothing) are deleted, so every line containing code
 * passes through byte for byte and regex-literal ambiguity can never corrupt
 * code (a tokenizer-based stripper was measured drifting on
 * `.replace(/\\/g, ...)` in exports.js — that failure mode is structurally
 * excluded here, not merely handled). Two guards on top:
 *   1. a conservative lexer that only VETOES: a line is deletable only when
 *      the lexer can prove it starts outside strings and template literals
 *      (a blank line inside a template literal is content, not whitespace).
 *      A lexer mistake therefore needs a second, independent mistake — a
 *      code line that also reads as a pure comment line — before it can
 *      change behavior.
 *   2. every stripped JS module must still parse (vm.Script) or the build
 *      fails loudly.
 */

/* Lexer state at the start of each line: 'code' means provably outside
 * strings, template literals, and block comments. Anything uncertain
 * (including regex internals) reports non-code and blocks deletion. */
function jsLineStates(src) {
  const KW = new Set(['return', 'typeof', 'case', 'in', 'of', 'do', 'else',
    'void', 'delete', 'new', 'instanceof', 'yield', 'await', 'throw']);
  const st = ['code'];
  let mode = 'code';
  const tpl = []; // brace depth per open ${ } interpolation
  let lastSig = '', word = '';
  const regexOK = () => lastSig === '' || '([{,;=:!&|?+-*/%~^<>'.includes(lastSig) || KW.has(word);
  for (let i = 0; i < src.length; i++) {
    const c = src[i], d = src[i + 1];
    if (c === '\n') {
      if (mode === 'line') mode = 'code';
      st.push(mode === 'code' ? 'code' : mode === 'block' ? 'comment' : 'other');
      continue;
    }
    if (mode === 'code') {
      if (c === '/' && d === '/') { mode = 'line'; i++; }
      else if (c === '/' && d === '*') { mode = 'block'; i++; }
      else if (c === "'") mode = 'sq';
      else if (c === '"') mode = 'dq';
      else if (c === '`') mode = 'tpl';
      else if (c === '/' && regexOK()) mode = 'regex';
      else {
        if (tpl.length) {
          if (c === '{') tpl[tpl.length - 1]++;
          else if (c === '}') {
            if (tpl[tpl.length - 1] === 0) { tpl.pop(); mode = 'tpl'; }
            else tpl[tpl.length - 1]--;
          }
        }
        if (/[A-Za-z0-9_$]/.test(c)) word += c;
        else if (!/\s/.test(c)) word = '';
        if (!/\s/.test(c)) lastSig = c;
      }
    } else if (mode === 'sq') {
      if (c === '\\') i++;
      else if (c === "'") { mode = 'code'; lastSig = "'"; word = ''; }
    } else if (mode === 'dq') {
      if (c === '\\') i++;
      else if (c === '"') { mode = 'code'; lastSig = '"'; word = ''; }
    } else if (mode === 'tpl') {
      if (c === '\\') i++;
      else if (c === '`') { mode = 'code'; lastSig = '`'; word = ''; }
      else if (c === '$' && d === '{') { tpl.push(0); mode = 'code'; lastSig = '{'; word = ''; i++; }
    } else if (mode === 'regex') {
      if (c === '\\') i++;
      else if (c === '[') mode = 'class';
      else if (c === '/') { mode = 'code'; lastSig = ')'; word = ''; }
    } else if (mode === 'class') {
      if (c === '\\') i++;
      else if (c === ']') mode = 'regex';
    } else if (mode === 'block') {
      if (c === '*' && d === '/') { mode = 'code'; i++; }
    } // 'line' waits for \n above
  }
  return st;
}

/* CSS crosses lines only inside block comments (strings can't span lines). */
function cssLineStates(src) {
  const st = ['code'];
  let mode = 'code';
  for (let i = 0; i < src.length; i++) {
    const c = src[i], d = src[i + 1];
    if (c === '\n') { st.push(mode === 'block' ? 'comment' : mode === 'code' ? 'code' : 'other'); continue; }
    if (mode === 'code') {
      if (c === '/' && d === '*') { mode = 'block'; i++; }
      else if (c === "'") mode = 'sq';
      else if (c === '"') mode = 'dq';
    } else if (mode === 'block') {
      if (c === '*' && d === '/') { mode = 'code'; i++; }
    } else if (mode === 'sq') {
      if (c === '\\') i++; else if (c === "'") mode = 'code';
    } else if (mode === 'dq') {
      if (c === '\\') i++; else if (c === '"') mode = 'code';
    }
  }
  return st;
}

/* Is this line, in its entirety, comments and whitespace? (`//` is JS-only.) */
function isPureCommentLine(t, css) {
  let s = t;
  for (;;) {
    s = s.replace(/^\s+/, '');
    if (s === '') return true;
    if (!css && s.startsWith('//')) return true;
    if (s.startsWith('/*')) {
      const k = s.indexOf('*/', 2);
      if (k === -1) return false; // unclosed here — the multi-line path owns it
      s = s.slice(k + 2);
      continue;
    }
    return false;
  }
}

function stripSource(src, { css = false } = {}) {
  const lines = src.split('\n');
  const state = css ? cssLineStates(src) : jsLineStates(src);
  const keep = [];
  let i = 0;
  while (i < lines.length) {
    const t = lines[i].trim();
    if (state[i] === 'code') {
      if (isPureCommentLine(t, css)) { i++; continue; }
      if (t.startsWith('/*') && !t.includes('*/')) {
        // multi-line block comment opening a full line: drop through the
        // close — unless the closing line carries code, in which case keep
        // the whole run verbatim rather than edit any line
        let j = i + 1;
        while (j < lines.length && !lines[j].includes('*/')) j++;
        const after = j < lines.length ? lines[j].slice(lines[j].indexOf('*/') + 2) : 'x';
        if (after.trim() === '') { i = j + 1; continue; }
        for (const stop = Math.min(j, lines.length - 1); i <= stop; i++) keep.push(lines[i]);
        continue;
      }
    }
    keep.push(lines[i]);
    i++;
  }
  return keep.join('\n');
}

function stripJS(name, code) {
  const out = stripSource(code);
  try {
    new vm.Script(out, { filename: name });
  } catch (e) {
    throw new Error(`build: stripped ${name} no longer parses — ${e.message}`);
  }
  return out;
}
const readB64 = p => fs.readFileSync(path.join(root, p)).toString('base64');

const fontURI = f => `data:font/woff2;base64,${readB64('vendor/fonts/' + f)}`;

/* Self-hosted, base64-inlined at build so dist/index.html stays a single
 * offline-capable artifact. Curated pairing: Fraunces (display), Hanken
 * Grotesk (body), IBM Plex Mono (dimensions/ledger numbers). */
const FONT_FILES = {
  FRAUNCES_500: 'fraunces-latin-500-normal.woff2',
  FRAUNCES_600: 'fraunces-latin-600-normal.woff2',
  FRAUNCES_700: 'fraunces-latin-700-normal.woff2',
  FRAUNCES_900: 'fraunces-latin-900-normal.woff2',
  HANKEN_400: 'hanken-grotesk-latin-400-normal.woff2',
  HANKEN_500: 'hanken-grotesk-latin-500-normal.woff2',
  HANKEN_600: 'hanken-grotesk-latin-600-normal.woff2',
  HANKEN_700: 'hanken-grotesk-latin-700-normal.woff2',
  MONO_400: 'ibm-plex-mono-latin-400-normal.woff2',
  MONO_500: 'ibm-plex-mono-latin-500-normal.woff2',
  MONO_600: 'ibm-plex-mono-latin-600-normal.woff2',
};

let css = stripSource(read('src/styles.css'), { css: true });
for (const [key, file] of Object.entries(FONT_FILES)) {
  css = css.replace(`{{FONT_${key}}}`, fontURI(file));
}

const js = name => stripJS(name, read('src/' + name)).replace(/<\/script>/gi, '<\\/script>');

let html = read('src/index.template.html')
  .replace('{{CSS}}', css)
  .replace('{{CSS_PORCH}}', () => stripSource(read('src/porch.css'), { css: true }))
  .replace('{{THREE}}', () => read('vendor/three.min.js').replace(/<\/script>/gi, '<\\/script>'))
  .replace('{{ANIME}}', () => read('vendor/anime.umd.min.js').replace(/<\/script>/gi, '<\\/script>'))
  .replace('{{JS_KNOWLEDGE}}', () => js('knowledge.js'))
  .replace('{{JS_HARDWARE}}', () => js('hardware.js'))
  .replace('{{JS_ICONS}}', () => js('icons.js'))
  .replace('{{JS_MOTION}}', () => js('motion.js'))
  .replace('{{JS_MATERIALS}}', () => js('materials.js'))
  .replace('{{JS_GEOMETRY}}', () => js('geometry.js'))
  .replace('{{JS_UNITS}}', () => js('units.js'))
  .replace('{{JS_SPEC}}', () => js('spec.js'))
  .replace('{{JS_PARAMETRIC}}', () => js('parametric.js'))
  .replace('{{JS_STRUCTURAL}}', () => js('structural.js'))
  .replace('{{JS_FASTENERS}}', () => js('fasteners.js'))
  .replace('{{JS_PACKING}}', () => js('packing.js'))
  .replace('{{JS_PLANS}}', () => js('plans.js'))
  .replace('{{JS_DRAFTING}}', () => js('drafting.js'))
  .replace('{{JS_GLTF}}', () => js('gltf.js'))
  .replace('{{JS_EXPORTS}}', () => js('exports.js'))
  .replace('{{JS_HISTORY}}', () => js('history.js'))
  .replace('{{JS_CODEC}}', () => js('codec.js'))
  .replace('{{JS_AI}}', () => js('ai.js'))
  .replace('{{JS_STORE}}', () => js('store.js'))
  .replace('{{JS_BILLING}}', () => js('billing.js'))
  .replace('{{JS_PROVENANCE}}', () => js('provenance.js'))
  .replace('{{JS_GALLERY}}', () => js('gallery.js'))
  .replace('{{JS_SELFTEST}}', () => js('selftest.js'))
  .replace('{{JS_JOINERY3D}}', () => js('joinery3d.js'))
  .replace('{{JS_JOINTVIEW}}', () => js('jointview.js'))
  .replace('{{JS_ENGINE}}', () => js('engine.js'))
  .replace('{{JS_PORCH}}', () => js('porch.js'))
  .replace('{{JS_UI}}', () => js('ui.js'));

fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
fs.writeFileSync(path.join(root, 'dist/index.html'), html);
/* robots.txt (A-06): allow everything, reference nothing that doesn't exist —
 * the app is one page, so there is deliberately no sitemap line. */
fs.writeFileSync(path.join(root, 'dist/robots.txt'), 'User-agent: *\nAllow: /\n');
console.log(`dist/index.html — ${(html.length / 1024).toFixed(0)} KB (+ robots.txt)`);

module.exports = { stripSource, stripJS };
