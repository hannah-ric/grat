/* Blueprint Buddy — starter gallery.
 * Six real specs; each runs through the full production pipeline
 * (correct → build → validate → plans) exactly like a chat-created design.
 */
var BB = globalThis.BB = globalThis.BB || {};

(function () {
  'use strict';

  /* Dimensions are stored in mm (internal truth) but picked as exact inch
   * multiples so the default imperial display reads as clean fractions:
   * 1828.8 = 72 in, 914.4 = 36 in, 749.3 = 29 1/2 in, and so on. */
  const STARTERS = [
    {
      caption: 'The classic first commission',
      spec: {
        meta: { name: 'Shaker Dining Table', template: 'table', level: 'intermediate', units: 'in' },
        overall: { width: 1828.8, depth: 914.4, height: 749.3 },
        wood: { species: 'cherry' },
        structure: { topThickness: 25, legThickness: 70, apronHeight: 101.6, apronThickness: 19, apronInset: 12.7 },
        joinery: { frame: 'dowels' }, finish: 'danish_oil'
      }
    },
    {
      caption: 'A weekend of pocket screws',
      spec: {
        meta: { name: 'Weekend Desk', template: 'desk', level: 'beginner', units: 'in' },
        overall: { width: 1320.8, depth: 660.4, height: 736.6 },
        wood: { species: 'hard_maple' },
        structure: { topThickness: 25, legThickness: 60, apronHeight: 88.9 },
        finish: 'water_poly'
      }
    },
    {
      caption: 'Sturdy seat for the mudroom',
      spec: {
        meta: { name: 'Entry Bench', template: 'bench', level: 'intermediate', units: 'in' },
        overall: { width: 1117.6, depth: 381, height: 457.2 },
        wood: { species: 'white_oak' },
        structure: { topThickness: 32, legThickness: 60, apronHeight: 76.2 },
        joinery: { frame: 'dowels' }, finish: 'hardwax_oil'
      }
    },
    {
      caption: 'Five shelves, one afternoon',
      spec: {
        meta: { name: 'Floor Bookshelf', template: 'bookshelf', level: 'beginner', units: 'in' },
        overall: { width: 914.4, depth: 304.8, height: 1828.8 },
        wood: { species: 'ash' },
        // 25 mm (1 in) shelves: 914 mm of loaded books over 19 mm stock sags
        // once creep has its years — the starter ships the honest section.
        structure: { shelfCount: 4, sideThickness: 19, shelfThickness: 25, backPanel: true },
        finish: 'wipe_poly'
      }
    },
    {
      caption: 'Drawer joinery, sized by code',
      spec: {
        meta: { name: 'Two-Drawer Nightstand', template: 'nightstand', level: 'intermediate', units: 'in' },
        overall: { width: 508, depth: 406.4, height: 609.6 },
        wood: { species: 'walnut' },
        structure: { topThickness: 19, legThickness: 45, shelfCount: 1 },
        joinery: { frame: 'dowels', box: 'locking_rabbet' },
        drawers: { count: 2, frontStyle: 'inset', runner: 'side_mount_slides' },
        finish: 'hardwax_oil'
      }
    },
    {
      caption: 'Carcass work with a drawer bank',
      spec: {
        meta: { name: 'Sideboard Cabinet', template: 'cabinet', level: 'advanced', units: 'in' },
        overall: { width: 762, depth: 457.2, height: 914.4 },
        wood: { species: 'white_oak' },
        structure: { topThickness: 25, shelfCount: 1, toeKick: true, backPanel: true },
        joinery: { frame: 'mortise_tenon', case: 'dado', box: 'half_blind_dovetail' },
        drawers: { count: 2, frontStyle: 'overlay', runner: 'side_mount_slides' },
        finish: 'danish_oil'
      }
    }
  ];

  const FIRST_RUN_PROMPTS = [
    'Build me a walnut dining table, 63 in wide, for a beginner',
    'A nightstand with two drawers in cherry'
  ];

  BB.Gallery = { STARTERS, FIRST_RUN_PROMPTS };
})();
