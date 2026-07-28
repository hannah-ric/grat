/* Blueprint Buddy — print & 1:1 template fidelity (audit V-10).
 * Run: node test/print.playwright.js
 *
 * WHY THIS SUITE EXISTS
 * The blueprint's full-size templates are the one artifact where a rendering
 * error is a RULER error: you stick the strip to the work and mark through the
 * printed circles. They are drawn in real millimetres (`width="240mm"` over a
 * `viewBox` of 240 user units) precisely so that printing at 100% puts a hole
 * where the engine says a hole goes.
 *
 * Nothing checked that the strip FITS the page it is printed on. A strip wider
 * than the printable column does not scale down — it clips, and the marks past
 * the fold are simply gone, with the scale-check bar still reading a perfect
 * 100 mm because the bar itself is short. A silently truncated template is
 * worse than no template.
 *
 * These assertions are arithmetic about the page box, measured in a real
 * browser under print emulation, not guesses about renderer behaviour.
 */
'use strict';
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; } else { fail++; console.error('  ✗ ' + m); } };

/* CSS px per mm at the 96 dpi CSS reference pixel — the unit every browser
 * lays print out in. */
const PX_PER_MM = 96 / 25.4;
/* The sheet asks for letter, but a metric shop feeds A4 — and a browser handed
 * A4 for a letter @page clips rather than scales. The template must therefore
 * fit the NARROWER of the two, or it is broken for half the world. */
const LETTER_W_MM = 215.9;
const A4_W_MM = 210;
const NARROWEST_PAPER_MM = Math.min(LETTER_W_MM, A4_W_MM);

function loadBB() {
  const SRC = ['knowledge.js', 'hardware.js', 'icons.js', 'materials.js', 'geometry.js', 'units.js', 'spec.js', 'parametric.js', 'structural.js', 'fasteners.js', 'packing.js',
    'plans.js', 'drafting.js', 'gltf.js', 'exports.js', 'history.js', 'codec.js', 'ai.js', 'store.js', 'gallery.js', 'joinery3d.js', 'selftest.js'];
  for (const f of SRC) vm.runInThisContext(fs.readFileSync(path.join(ROOT, 'src', f), 'utf8'), { filename: f });
  return globalThis.BB;
}

(async () => {
  const BB = loadBB();
  const { Spec, Parametric, Units } = BB;
  Units.set({ system: 'metric', precision: 16, dual: false });
  const Sheets = require(path.join(ROOT, 'api', '_sheets.js'));

  // A design with real discrete fastener layouts AND drawer pull bores — the
  // two things that become 1:1 strips.
  const spec = Spec.correctSpec(Spec.defaultSpec('nightstand'));
  const model = Parametric.build(spec);
  const html = Sheets.templateSet({ BB, spec, model },
    { id: 'bp_print_test', revision: 1, issued: '2026-07-27', name: spec.meta.name });

  const browser = await chromium.launch({
    executablePath: fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined,
    args: ['--no-sandbox']
  });
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.emulateMedia({ media: 'print' });
  await page.setContent(html, { waitUntil: 'load' });

  /* ---- what the sheet itself declares ---- */
  const decl = await page.evaluate(() => {
    const css = [...document.querySelectorAll('style')].map(s => s.textContent).join('\n');
    const pageRule = /@page\s*\{([^}]*)\}/.exec(css);
    const bodyMargin = getComputedStyle(document.body).marginLeft;
    return { pageRule: pageRule ? pageRule[1].trim() : null, bodyMargin };
  });
  ok(!!decl.pageRule, `the template sheet declares a @page rule (${decl.pageRule})`);
  const pageMarginMM = Number(/margin:\s*([\d.]+)mm/.exec(decl.pageRule || '')?.[1] || 0);
  const bodyMarginMM = parseFloat(decl.bodyMargin) / PX_PER_MM;
  ok(bodyMarginMM < 0.5,
    `print zeroes the body margin so the page box is the only margin (got ${bodyMarginMM.toFixed(1)}mm — a second margin inside the page box silently narrows the column the 1:1 strips are sized against)`);
  const printableMM = NARROWEST_PAPER_MM - 2 * pageMarginMM - 2 * bodyMarginMM;
  console.log(`  page: narrowest paper ${NARROWEST_PAPER_MM}mm − @page ${pageMarginMM}mm×2 − body ${bodyMarginMM.toFixed(1)}mm×2 = ${printableMM.toFixed(1)}mm printable`);

  /* ---- every strip must FIT that column ---- */
  const strips = await page.evaluate(pxPerMm => [...document.querySelectorAll('.strip svg')].map(s => ({
    declaredMM: parseFloat(s.getAttribute('width')),
    laidOutMM: s.getBoundingClientRect().width / pxPerMm,
    viewBox: s.getAttribute('viewBox')
  })), PX_PER_MM);
  ok(strips.length > 1, `the sheet renders strips to check (${strips.length})`);

  const widest = strips.reduce((m, s) => Math.max(m, s.declaredMM), 0);
  ok(widest <= printableMM + 0.5,
    `the widest 1:1 strip (${widest}mm) fits the printable column (${printableMM.toFixed(1)}mm) — a wider strip clips, and the marks past the edge are lost`);

  /* ---- 1:1 means 1:1: one user unit must be one millimetre ---- */
  for (const s of strips) {
    const [, , vbW] = (s.viewBox || '0 0 0 0').split(/\s+/).map(Number);
    if (!vbW) continue;
    const scale = s.declaredMM / vbW;
    ok(Math.abs(scale - 1) < 1e-9,
      `strip viewBox maps 1 unit → 1 mm (declared ${s.declaredMM}mm over ${vbW} units = ${scale})`);
    // And nothing in the cascade may rescale it once laid out.
    ok(Math.abs(s.laidOutMM - s.declaredMM) < 0.5,
      `strip lays out at its declared size, unscaled (${s.laidOutMM.toFixed(1)}mm vs ${s.declaredMM}mm)`);
  }

  /* ---- the scale-check bar is the user's own verification, so it must be
         exactly 100 mm and must itself fit ---- */
  const bar = await page.evaluate(pxPerMm => {
    const rect = [...document.querySelectorAll('.strip svg rect')]
      .find(r => Number(r.getAttribute('width')) === 100);
    if (!rect) return null;
    return { widthMM: rect.getBoundingClientRect().width / pxPerMm };
  }, PX_PER_MM);
  ok(!!bar, 'the sheet carries a 100 mm scale-check bar');
  if (bar) ok(Math.abs(bar.widthMM - 100) < 0.5, `the check bar measures 100 mm on the page (${bar.widthMM.toFixed(2)}mm)`);

  /* ---- and it prints as real pages ---- */
  const pdf = await page.pdf({ format: 'Letter', printBackground: true });
  ok(pdf.length > 1000, `the sheet renders to a PDF (${pdf.length} bytes)`);
  ok(pdf.slice(0, 5).toString('latin1') === '%PDF-', 'the output is a real PDF');

  await browser.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('print suite failed:', e); process.exit(1); });
