#!/usr/bin/env node
/* Blueprint Buddy — build: inline everything into dist/index.html.
 * The output is a single self-contained file (fonts and Three.js embedded)
 * suitable for publishing as a Claude Artifact. Run: node build.js
 */
'use strict';
const fs = require('fs');
const path = require('path');

const root = __dirname;
const read = p => fs.readFileSync(path.join(root, p), 'utf8');
const readB64 = p => fs.readFileSync(path.join(root, p)).toString('base64');

const fontURI = f => `data:font/woff2;base64,${readB64('vendor/fonts/' + f)}`;

let css = read('src/styles.css')
  .replace('{{FONT_500}}', fontURI('bitter-latin-500-normal.woff2'))
  .replace('{{FONT_600}}', fontURI('bitter-latin-600-normal.woff2'))
  .replace('{{FONT_700}}', fontURI('bitter-latin-700-normal.woff2'));

const js = name => read('src/' + name).replace(/<\/script>/gi, '<\\/script>');

let html = read('src/index.template.html')
  .replace('{{CSS}}', css)
  .replace('{{THREE}}', () => read('vendor/three.min.js').replace(/<\/script>/gi, '<\\/script>'))
  .replace('{{JS_KNOWLEDGE}}', () => js('knowledge.js'))
  .replace('{{JS_HARDWARE}}', () => js('hardware.js'))
  .replace('{{JS_ICONS}}', () => js('icons.js'))
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
  .replace('{{JS_PROVENANCE}}', () => js('provenance.js'))
  .replace('{{JS_GALLERY}}', () => js('gallery.js'))
  .replace('{{JS_SELFTEST}}', () => js('selftest.js'))
  .replace('{{JS_JOINERY3D}}', () => js('joinery3d.js'))
  .replace('{{JS_JOINTVIEW}}', () => js('jointview.js'))
  .replace('{{JS_ENGINE}}', () => js('engine.js'))
  .replace('{{JS_UI}}', () => js('ui.js'));

fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
fs.writeFileSync(path.join(root, 'dist/index.html'), html);
console.log(`dist/index.html — ${(html.length / 1024).toFixed(0)} KB`);
