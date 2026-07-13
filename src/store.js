/* Blueprint Buddy — persistence (Phase 4).
 * Uses the same window.storage API as preferences. EVERY call sits inside
 * try/catch with an in-memory fallback: the app must run fully — session-only
 * — when storage is unavailable, and the user should barely notice.
 *
 * Key layout (respecting the 5 MB per-key limit):
 *   projects:index  -> [{id, name, updated, thumb, dims, progressPct}]
 *   project:{id}    -> { id, name, updated, wire (codec spec), revisions
 *                        (last 20 wire snapshots), progress {cuts, steps} }
 *   prices:v1       -> user-edited price table
 *   prefs:v2        -> { climate, stockMode, units: {system, precision, dual} }
 *   prefs:v1        -> legacy (no units block); migrated on first load, and a
 *                      returning v1 user keeps the metric world they had —
 *                      the imperial default applies ONLY to fresh installs.
 * Never store meshes or derived plans — everything regenerates from the spec.
 */
var BB = globalThis.BB = globalThis.BB || {};

(function () {
  'use strict';

  const memory = new Map(); // silent session-only fallback
  let storageWorks = null;  // null = unknown, probed lazily

  function hasStorage() {
    return typeof window !== 'undefined' && window.storage &&
      typeof window.storage.get === 'function' && typeof window.storage.set === 'function';
  }

  async function get(key) {
    if (hasStorage()) {
      try {
        const r = await window.storage.get(key);
        storageWorks = true;
        if (r && r.value !== undefined && r.value !== null) return JSON.parse(r.value);
        return null;
      } catch (e) { /* missing key or broken storage: fall through */ }
    }
    return memory.has(key) ? JSON.parse(memory.get(key)) : null;
  }
  async function set(key, obj) {
    const value = JSON.stringify(obj);
    memory.set(key, value); // memory always mirrors, so a mid-session storage death loses nothing
    if (hasStorage()) {
      try { await window.storage.set(key, value); storageWorks = true; return true; }
      catch (e) { storageWorks = false; }
    }
    return false;
  }
  async function del(key) {
    memory.delete(key);
    if (hasStorage()) {
      try {
        if (typeof window.storage.delete === 'function') await window.storage.delete(key);
        else await window.storage.set(key, 'null');
        return true;
      } catch (e) { /* silent */ }
    }
    return false;
  }

  /* ---------------- projects ---------------- */
  const INDEX_KEY = 'projects:index';
  const PROJECT_PREFIX = 'project:';
  const MAX_REVISIONS = 20;

  const newId = () => 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

  async function loadIndex() {
    const idx = await get(INDEX_KEY);
    return Array.isArray(idx) ? idx : [];
  }
  async function saveIndex(idx) { return set(INDEX_KEY, idx); }

  /* Upsert one project and its index row. `data` carries everything already
   * serialized: wire spec, capped revisions, progress, thumb. */
  async function saveProject(data) {
    const record = {
      id: data.id, name: data.name, updated: Date.now(),
      wire: data.wire,
      revisions: (data.revisions || []).slice(-MAX_REVISIONS),
      progress: data.progress || { cuts: {}, steps: {} }
    };
    await set(PROJECT_PREFIX + data.id, record);
    const idx = await loadIndex();
    const row = {
      id: data.id, name: data.name, updated: record.updated,
      thumb: data.thumb || (idx.find(r => r.id === data.id) || {}).thumb || null,
      dims: data.dims || null,
      progressPct: data.progressPct !== undefined ? data.progressPct : (idx.find(r => r.id === data.id) || {}).progressPct || 0
    };
    const i = idx.findIndex(r => r.id === data.id);
    if (i >= 0) idx[i] = row; else idx.unshift(row);
    idx.sort((a, b) => b.updated - a.updated);
    await saveIndex(idx);
    return record;
  }

  async function loadProject(id) {
    const rec = await get(PROJECT_PREFIX + id);
    return rec && rec.wire ? rec : null;
  }

  async function deleteProject(id) {
    await del(PROJECT_PREFIX + id);
    const idx = await loadIndex();
    await saveIndex(idx.filter(r => r.id !== id));
  }

  async function renameProject(id, name) {
    const rec = await get(PROJECT_PREFIX + id);
    if (rec) { rec.name = name; await set(PROJECT_PREFIX + id, rec); }
    const idx = await loadIndex();
    const row = idx.find(r => r.id === id);
    if (row) { row.name = name; await saveIndex(idx); }
  }

  async function duplicateProject(id) {
    const rec = await get(PROJECT_PREFIX + id);
    if (!rec) return null;
    const idx = await loadIndex();
    const row = idx.find(r => r.id === id) || {};
    const copyId = newId();
    const copy = { ...rec, id: copyId, name: rec.name + ' copy', updated: Date.now(), progress: { cuts: {}, steps: {} } };
    await set(PROJECT_PREFIX + copyId, copy);
    idx.unshift({ id: copyId, name: copy.name, updated: copy.updated, thumb: row.thumb || null, dims: row.dims || null, progressPct: 0 });
    await saveIndex(idx);
    return copyId;
  }

  /* ---------------- price table & preferences ---------------- */
  const PRICES_KEY = 'prices:v1';
  const PREFS_KEY = 'prefs:v2';
  const LEGACY_PREFS_KEY = 'prefs:v1';
  // Fresh installs: fractional inches at 1/16, dual display off.
  const DEFAULT_PREFS = {
    climate: 'temperate', stockMode: {},
    units: { system: 'imperial', precision: 16, dual: false }
  };

  async function loadPrices() {
    const stored = await get(PRICES_KEY);
    const dflt = BB.K.defaultPrices();
    if (!stored || typeof stored !== 'object') return dflt;
    return {
      dimensional: Object.assign({}, dflt.dimensional, stored.dimensional || {}),
      sheet: Object.assign({}, dflt.sheet, stored.sheet || {}),
      bdft: Object.assign({}, dflt.bdft, stored.bdft || {})
    };
  }
  const savePrices = prices => set(PRICES_KEY, prices);

  /* Deep-fill against defaults so new fields appear WITHOUT clobbering the
   * user's stored choices (Object.assign would flatten the units block). */
  function withPrefDefaults(stored) {
    const out = Object.assign({}, DEFAULT_PREFS, stored);
    out.units = Object.assign({}, DEFAULT_PREFS.units, stored && stored.units ? stored.units : {});
    return out;
  }
  async function loadPrefs() {
    const stored = await get(PREFS_KEY);
    if (stored && typeof stored === 'object') return withPrefDefaults(stored);
    // Schema migration v1 -> v2. The imperial default is for people with NO
    // stored preferences; a returning v1 user was living in the old metric
    // default, so their selection is preserved, never overwritten.
    const legacy = await get(LEGACY_PREFS_KEY);
    if (legacy && typeof legacy === 'object') {
      const migrated = withPrefDefaults(Object.assign({}, legacy, {
        units: { system: 'metric', precision: 16, dual: false }
      }));
      await set(PREFS_KEY, migrated);
      return migrated;
    }
    return withPrefDefaults({});
  }
  const savePrefs = prefs => set(PREFS_KEY, prefs);

  /* ---------------- thumbnails ----------------
   * Render the live 3D canvas down to a ~128 px JPEG dataURL, kept under
   * ~15 KB. Quality steps down until it fits.
   */
  function makeThumb(sourceCanvas) {
    try {
      if (!sourceCanvas || !sourceCanvas.width) return null;
      const w = 128, h = Math.max(1, Math.round(sourceCanvas.height / sourceCanvas.width * 128));
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#efeade';
      ctx.fillRect(0, 0, w, h);
      ctx.drawImage(sourceCanvas, 0, 0, w, h);
      for (const q of [0.7, 0.5, 0.3]) {
        const url = c.toDataURL('image/jpeg', q);
        if (url.length < 15000) return url;
      }
      return null;
    } catch (e) { return null; }
  }

  BB.Store = {
    get, set, del, hasStorage,
    isPersistent: () => storageWorks !== false && hasStorage(),
    newId, loadIndex, saveProject, loadProject, deleteProject, renameProject, duplicateProject,
    loadPrices, savePrices, loadPrefs, savePrefs, makeThumb,
    MAX_REVISIONS, DEFAULT_PREFS
  };
})();
