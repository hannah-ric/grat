/* Blueprint Buddy — the engineering pipeline, loaded into Node (zero-dependency).
 *
 * The same loader pattern test/audit.test.js proved: every browser-independent
 * src/ module is executed in an isolated vm context, giving the server the
 * EXACT pipeline the client runs — correction, parametric build, validation,
 * structural integrity, cut list, BOM, assembly, stock packing, drafting SVGs,
 * print HTML, CSV. Nothing is reimplemented; a blueprint issued here is a pure
 * function of the corrected spec, byte-for-byte the client's math.
 *
 * Files starting with "_" are libraries, not deployed Vercel functions.
 *
 * The context is created once per process (cold start) and reused. Runs are
 * fully synchronous, so the module-global BB.Units display state can never
 * interleave across requests.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');

// Load order matches build.js. Browser-bound modules (engine, ui, motion,
// porch, store, billing, gallery, selftest, joinery3d, jointview, provenance,
// ai, history, icons for chrome) stay out — this list is the plan pipeline only.
const SRC = ['knowledge.js', 'hardware.js', 'icons.js', 'materials.js', 'geometry.js', 'units.js',
  'spec.js', 'parametric.js', 'structural.js', 'fasteners.js', 'packing.js',
  'plans.js', 'drafting.js', 'gltf.js', 'exports.js', 'codec.js'];

/* Bump when the pipeline's OUTPUT contract changes in a way that should
 * invalidate cached artifacts (the golden corpus is the real guard; this is
 * the cache-busting knob). Part of the artifact hash, NOT the charge hash —
 * a pipeline upgrade must never charge anyone again for the same design. */
const PIPELINE_REV = 1;

let cachedBB = null;

function load() {
  if (cachedBB) return cachedBB;
  // Buffer: the share-code codec base64s through Buffer when btoa is absent.
  const context = vm.createContext({ console, TextEncoder, TextDecoder, Buffer });
  for (const f of SRC) {
    const p = path.join(__dirname, '..', 'src', f);
    vm.runInContext(fs.readFileSync(p, 'utf8'), context, { filename: f });
  }
  cachedBB = context.BB;
  return cachedBB;
}

/* Deterministic canonical JSON: keys sorted at every level, so hashing is
 * stable across serializers and property-insertion orders. */
function canonical(value) {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') {
    return '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + canonical(value[k])).join(',') + '}';
  }
  return JSON.stringify(value);
}
const sha = s => crypto.createHash('sha256').update(s).digest('hex');

/* The CHARGE hash: identity of the material design. meta.name and meta.units
 * are display-only — renaming a piece or flipping the unit system is never a
 * "material spec change" and must never charge. */
function chargeHash(correctedSpec) {
  const clone = JSON.parse(JSON.stringify(correctedSpec));
  if (clone.meta) { delete clone.meta.name; delete clone.meta.units; }
  return sha('bb-charge:' + canonical(clone));
}
/* The ARTIFACT hash: identity of the rendered document set (name and units DO
 * change the sheets; a pipeline rev bump re-renders without re-charging). */
function artifactHash(correctedSpec) {
  return sha('bb-artifact:v' + PIPELINE_REV + ':' + canonical(correctedSpec));
}

/* Correct + build + validate. Returns { spec, model, report } — the caller
 * decides what a validation failure means (never a charge). */
function evaluate(rawSpec) {
  const BB = load();
  const raw = JSON.parse(JSON.stringify(rawSpec));
  const system = raw && raw.meta && raw.meta.units === 'mm' ? 'metric' : 'imperial';
  BB.Units.set({ system, precision: 16, dual: false });
  const spec = BB.Spec.correctSpec(raw);
  const model = BB.Parametric.build(spec);
  const report = BB.Spec.validate(spec, model);
  return { BB, spec, model, report };
}

/* Everything downstream of a VALID corrected spec — the artifact inputs. */
function derive(BB, spec, model) {
  const integ = BB.Structural.computeIntegrity(spec, model, {});
  const cut = BB.Plans.cutList(spec, model);
  const stock = BB.Packing.planStock(spec, model, cut, {});
  const bom = BB.Plans.bom(spec, model, { integrity: integ, stock });
  const steps = BB.Plans.assembly(spec, model, integ, { stockPlan: stock });
  const time = BB.Plans.timeEstimate(spec, model, cut, steps, stock);
  return { integ, cut, stock, bom, steps, time };
}

function decodeWire(wire) {
  const BB = load();
  return BB.Codec.decode(wire);
}
function decodeShareCode(text) {
  const BB = load();
  return BB.Codec.fromShareCode(text);
}

module.exports = { load, evaluate, derive, chargeHash, artifactHash, decodeWire, decodeShareCode, canonical, PIPELINE_REV };
