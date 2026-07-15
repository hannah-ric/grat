/* Blueprint Buddy — icon set (Phase 5).
 * One drafting-instrument style: 20×20 grid, 1.7px stroke, round caps,
 * stroke = currentColor so icons inherit button/text color and theme freely.
 * Replaces the platform-dependent Unicode glyphs (↶ ↷ ▾ ✕ ⤢ ‹ › ↺ ▶ ⇄) that
 * rendered with inconsistent metrics across OSes.
 */
var BB = globalThis.BB = globalThis.BB || {};

(function () {
  'use strict';

  const PATHS = {
    undo: 'M7.5 4.5 4 8 7.5 11.5 M4 8 h8.2 a4.4 4.4 0 0 1 0 8.8 H9',
    redo: 'M12.5 4.5 16 8 12.5 11.5 M16 8 H7.8 a4.4 4.4 0 0 0 0 8.8 H11',
    caret: 'M6 8.2 l4 4 4 -4',
    dual: 'M4 6.8 h10.5 m0 0 -3 -3 m3 3 -3 3 M16 13.2 H5.5 m0 0 3 -3 m-3 3 3 3',
    close: 'M5.5 5.5 14.5 14.5 M14.5 5.5 5.5 14.5',
    fit: 'M7.5 3.5 H4.5 a1 1 0 0 0 -1 1 v3 M12.5 3.5 h3 a1 1 0 0 1 1 1 v3 M3.5 12.5 v3 a1 1 0 0 0 1 1 h3 M16.5 12.5 v3 a1 1 0 0 1 -1 1 h-3',
    prev: 'M12 4.5 6.5 10 12 15.5',
    next: 'M8 4.5 13.5 10 8 15.5',
    replay: 'M15.8 12 a6.2 6.2 0 1 1 -1 -6.5 M15.5 2.8 v3.4 h-3.4',
    ruler: 'M3 13.5 13.5 3 17 6.5 6.5 17 Z M6.8 10.2 l1.6 1.6 M9.3 7.7 l1.6 1.6 M11.8 5.2 l1.6 1.6',
    board: 'M3 6.5 h14 v7 H3 Z M6.5 6.5 c0 2.3 0 4.7 0 7 M13 6.5 c0 2.3 0 4.7 0 7',
    camera: 'M3.5 6.5 h3 l1.5 -2 h4 l1.5 2 h3 v9 h-13 Z M10 13.8 a2.8 2.8 0 1 0 0 -5.6 a2.8 2.8 0 0 0 0 5.6'
  };
  const FILLED = {
    play: 'M7 4.5 15.2 10 7 15.5 Z'
  };

  function svg(name, size) {
    size = size || 17;
    const filled = FILLED[name];
    const d = filled || PATHS[name];
    if (!d) return '';
    const paint = filled
      ? 'fill="currentColor" stroke="none"'
      : 'fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"';
    return `<svg width="${size}" height="${size}" viewBox="0 0 20 20" ${paint} aria-hidden="true"><path d="${d}"/></svg>`;
  }

  BB.Icons = { svg, PATHS, FILLED };
})();
