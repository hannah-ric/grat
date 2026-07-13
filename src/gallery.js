/* Blueprint Buddy — starter gallery.
 * Six real specs; each runs through the full production pipeline
 * (correct → build → validate → plans) exactly like a chat-created design.
 */
var BB = globalThis.BB = globalThis.BB || {};

(function () {
  'use strict';

  const STARTERS = [
    {
      caption: 'The classic first commission', emoji: '🍽',
      spec: {
        meta: { name: 'Shaker Dining Table', template: 'table', level: 'intermediate', units: 'mm' },
        overall: { width: 1800, depth: 900, height: 750 },
        wood: { species: 'cherry' },
        structure: { topThickness: 25, legThickness: 70, apronHeight: 100, apronThickness: 20, apronInset: 12 },
        joinery: { frame: 'dowels' }, finish: 'danish_oil'
      }
    },
    {
      caption: 'A weekend of pocket screws', emoji: '💻',
      spec: {
        meta: { name: 'Weekend Desk', template: 'desk', level: 'beginner', units: 'mm' },
        overall: { width: 1300, depth: 650, height: 735 },
        wood: { species: 'hard_maple' },
        structure: { topThickness: 25, legThickness: 60, apronHeight: 90 },
        finish: 'water_poly'
      }
    },
    {
      caption: 'Sturdy seat for the mudroom', emoji: '🪑',
      spec: {
        meta: { name: 'Entry Bench', template: 'bench', level: 'intermediate', units: 'mm' },
        overall: { width: 1100, depth: 380, height: 450 },
        wood: { species: 'white_oak' },
        structure: { topThickness: 32, legThickness: 60, apronHeight: 80 },
        joinery: { frame: 'dowels' }, finish: 'hardwax_oil'
      }
    },
    {
      caption: 'Five shelves, one afternoon', emoji: '📚',
      spec: {
        meta: { name: 'Floor Bookshelf', template: 'bookshelf', level: 'beginner', units: 'mm' },
        overall: { width: 900, depth: 300, height: 1800 },
        wood: { species: 'ash' },
        structure: { shelfCount: 4, sideThickness: 18, shelfThickness: 19, backPanel: true },
        finish: 'wipe_poly'
      }
    },
    {
      caption: 'Drawer joinery, sized by code', emoji: '🌙',
      spec: {
        meta: { name: 'Two-Drawer Nightstand', template: 'nightstand', level: 'intermediate', units: 'mm' },
        overall: { width: 500, depth: 400, height: 600 },
        wood: { species: 'walnut' },
        structure: { topThickness: 20, legThickness: 45, shelfCount: 1 },
        joinery: { frame: 'dowels', box: 'locking_rabbet' },
        drawers: { count: 2, frontStyle: 'inset', runner: 'side_mount_slides' },
        finish: 'hardwax_oil'
      }
    },
    {
      caption: 'Carcass work with a drawer bank', emoji: '🗄',
      spec: {
        meta: { name: 'Sideboard Cabinet', template: 'cabinet', level: 'advanced', units: 'mm' },
        overall: { width: 780, depth: 450, height: 900 },
        wood: { species: 'white_oak' },
        structure: { topThickness: 25, shelfCount: 1, toeKick: true, backPanel: true },
        joinery: { frame: 'mortise_tenon', case: 'dado', box: 'half_blind_dovetail' },
        drawers: { count: 2, frontStyle: 'overlay', runner: 'side_mount_slides' },
        finish: 'danish_oil'
      }
    }
  ];

  const FIRST_RUN_PROMPTS = [
    'Build me a walnut dining table, 1600 wide, for a beginner',
    'A nightstand with two drawers in cherry'
  ];

  BB.Gallery = { STARTERS, FIRST_RUN_PROMPTS };
})();
