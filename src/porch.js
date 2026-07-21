/* Blueprint Buddy — front porch (landing narrative, design-language §7).
 * Phase 2a (the landing workstream) implements this module. The stub exists
 * so build wiring, load order (after engine.js, before ui.js), and the
 * template's porch region are frozen by Phase 1 — the namespace must be
 * present even while the porch section stays hidden and inert.
 */
var BB = globalThis.BB = globalThis.BB || {};

(function () {
  'use strict';
  BB.Porch = {};
})();
