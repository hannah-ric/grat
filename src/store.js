/* Blueprint Buddy — persistence (Phase 4; 2026: real persistence everywhere).
 *
 * One key-value API over a DRIVER CHAIN, first available wins per call:
 *   1. artifact — window.storage (claude.ai artifact hosting)
 *   2. cloud    — /api/store with a signed-in session (Vercel + KV; see
 *                 api/auth.js). Writes also mirror to device storage, so a
 *                 network blip or sign-out never loses the latest state.
 *   3. device   — localStorage ("bb:" prefix). THE fix for the app's oldest
 *                 silent failure: off-artifact, projects used to evaporate
 *                 on refresh because only window.storage was ever tried.
 *   4. memory   — session-only, always mirrored, so a mid-session storage
 *                 death loses nothing.
 * EVERY call sits inside try/catch: the app must run fully — session-only —
 * when all storage is unavailable, and the user should barely notice.
 *
 * Accounts: Store.init() probes /api/auth?me=1 once (boot races it against
 * a short timeout so first paint never waits on the network). Signing in
 * upgrades the chain to cloud and runs a one-time device→cloud migration
 * when the cloud side is still empty — existing local projects follow the
 * user. Cloud documents with data always win; migration never overwrites.
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

  const memory = new Map(); // silent session-only fallback, always mirrored
  const LOCAL_PREFIX = 'bb:';
  let artifactWorks = null; // null = unknown, probed lazily
  let localOK = null;       // null = unknown, probed lazily
  let auth = null;          // { user, providers, storage } from /api/auth?me=1
  let remoteAlive = false;  // signed in AND the server has a KV backend
  const modeListeners = [];

  function hasStorage() {
    return typeof window !== 'undefined' && window.storage &&
      typeof window.storage.get === 'function' && typeof window.storage.set === 'function';
  }

  function localStore() {
    if (localOK === false) return null; // a THROWING localStorage stays latched off
    try {
      const ls = (typeof window !== 'undefined' ? window : globalThis).localStorage;
      if (!ls) return null; // absent (headless) — re-checked per call, never latched
      if (localOK === null) {
        ls.setItem(LOCAL_PREFIX + 'probe', '1');
        ls.removeItem(LOCAL_PREFIX + 'probe');
        localOK = true;
      }
      return ls;
    } catch (e) { localOK = false; return null; }
  }

  /* ---------------- cloud driver (same-origin /api/store) ---------------- */
  async function remoteGet(key) {
    const r = await fetch('/api/store?doc=' + encodeURIComponent(key), { credentials: 'same-origin' });
    if (r.status === 401 || r.status === 503) { setRemote(false); return undefined; } // signed out / unconfigured
    if (!r.ok) throw new Error('store ' + r.status);
    const data = await r.json();
    return data && typeof data.value === 'string' ? data.value : null;
  }
  let writeDenial = null; // the last remote write the server refused outright (e.g. 403 project_limit)
  async function remoteSet(key, value) {
    const r = await fetch('/api/store?doc=' + encodeURIComponent(key), {
      method: 'PUT', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ value })
    });
    if (r.status === 401 || r.status === 503) { setRemote(false); return false; }
    if (r.status === 403) {
      // The server refused this write by policy (A-10: Free project cap).
      // Record it so the UI can say so instead of implying a cloud save (A-04).
      try {
        const data = await r.json();
        if (data && data.error) writeDenial = { error: data.error, limit: data.limit, key };
      } catch (e) { /* body optional */ }
      return false;
    }
    return r.ok;
  }
  async function remoteDel(key) {
    const r = await fetch('/api/store?doc=' + encodeURIComponent(key), { method: 'DELETE', credentials: 'same-origin' });
    if (r.status === 401 || r.status === 503) setRemote(false);
    return r.ok;
  }

  function setRemote(on) {
    if (remoteAlive === !!on) return;
    remoteAlive = !!on;
    for (const cb of modeListeners) { try { cb(persistenceMode()); } catch (e) { /* listener's problem */ } }
  }

  /* ---------------- the unified get/set/del ---------------- */
  async function get(key) {
    if (hasStorage()) {
      try {
        const r = await window.storage.get(key);
        artifactWorks = true;
        if (r && r.value !== undefined && r.value !== null) return JSON.parse(r.value);
        return null;
      } catch (e) { /* missing key or broken storage: fall through */ }
    }
    if (remoteAlive) {
      try {
        const v = await remoteGet(key);
        if (typeof v === 'string') return JSON.parse(v);
        if (v === null) return null; // authoritative: signed-in cloud says "no such doc"
      } catch (e) { /* transient network — fall through for THIS call */ }
    }
    const ls = localStore();
    if (ls) {
      try {
        const v = ls.getItem(LOCAL_PREFIX + key);
        if (v !== null) return JSON.parse(v);
        return memory.has(key) ? JSON.parse(memory.get(key)) : null;
      } catch (e) { /* fall through */ }
    }
    return memory.has(key) ? JSON.parse(memory.get(key)) : null;
  }

  async function set(key, obj) {
    const value = JSON.stringify(obj);
    memory.set(key, value); // memory always mirrors
    let ok = false;
    if (hasStorage()) {
      try { await window.storage.set(key, value); artifactWorks = true; ok = true; }
      catch (e) { artifactWorks = false; }
    }
    // Device write-through even when cloud is live: the local copy is the
    // offline cache and the signed-out fallback.
    const ls = localStore();
    if (ls) {
      try { ls.setItem(LOCAL_PREFIX + key, value); ok = true; }
      catch (e) { localOK = false; /* quota / private mode */ }
    }
    if (remoteAlive) {
      try { ok = (await remoteSet(key, value)) || ok; }
      catch (e) { /* transient — local copy already landed */ }
    }
    return ok;
  }

  async function del(key) {
    memory.delete(key);
    let ok = false;
    if (hasStorage()) {
      try {
        if (typeof window.storage.delete === 'function') await window.storage.delete(key);
        else await window.storage.set(key, 'null');
        ok = true;
      } catch (e) { /* silent */ }
    }
    const ls = localStore();
    if (ls) { try { ls.removeItem(LOCAL_PREFIX + key); ok = true; } catch (e) { /* silent */ } }
    if (remoteAlive) { try { ok = (await remoteDel(key)) || ok; } catch (e) { /* transient */ } }
    return ok;
  }

  /* ---------------- accounts: probe, upgrade, migrate ----------------
   * init() resolves fast (or the boot race abandons the wait — the chain
   * upgrades itself mid-session and notifies listeners). On claude.ai and
   * static hosting the probe 404s once and everything below stays dormant. */
  async function init(opts) {
    opts = opts || {};
    if (typeof fetch !== 'function' || typeof window === 'undefined' || hasStorage()) return authState();
    try {
      const ctl = typeof AbortController === 'function' ? new AbortController() : null;
      const timer = ctl ? setTimeout(() => ctl.abort(), opts.timeoutMs || 4000) : null;
      const r = await fetch('/api/auth?me=1', { credentials: 'same-origin', signal: ctl ? ctl.signal : undefined });
      if (timer) clearTimeout(timer);
      if (!r.ok) return authState();
      auth = await r.json();
      if (auth && auth.user && auth.storage) {
        try { await migrateLocalToCloud(); } catch (e) { /* migration is best-effort */ }
        setRemote(true);
      }
    } catch (e) { /* no /api/auth at this origin — device storage it is */ }
    return authState();
  }

  /* One-time device→cloud copy on first sign-in: only when the cloud side
   * has NO project index yet — cloud data always wins, never overwritten. */
  async function migrateLocalToCloud() {
    const ls = localStore();
    if (!ls) return;
    const remoteIdx = await remoteGet(INDEX_KEY);
    if (remoteIdx === undefined || remoteIdx !== null) return; // unavailable, or cloud already has data
    const localIdx = ls.getItem(LOCAL_PREFIX + INDEX_KEY);
    if (!localIdx) return;
    let idx;
    try { idx = JSON.parse(localIdx) || []; } catch (e) { return; }
    for (const row of idx.slice(0, 100)) {
      const k = PROJECT_PREFIX + row.id;
      const v = ls.getItem(LOCAL_PREFIX + k);
      if (v) await remoteSet(k, v);
      // Move a thumbnail — legacy-embedded in the row, or its own local doc —
      // into the cloud thumb doc, then strip it so the cloud index stays under
      // the 400 KB value cap (A5). Values are stored JSON-stringified.
      const localThumb = ls.getItem(LOCAL_PREFIX + THUMB_PREFIX + row.id);
      if (row.thumb) { await remoteSet(THUMB_PREFIX + row.id, JSON.stringify(row.thumb)); delete row.thumb; }
      else if (localThumb) { await remoteSet(THUMB_PREFIX + row.id, localThumb); }
    }
    await remoteSet(INDEX_KEY, JSON.stringify(idx));
    for (const k of [PRICES_KEY, PREFS_KEY]) {
      const v = ls.getItem(LOCAL_PREFIX + k);
      if (v) await remoteSet(k, v);
    }
  }

  const authState = () => ({
    user: auth && auth.user ? auth.user : null,
    providers: auth && Array.isArray(auth.providers) ? auth.providers : [],
    passwordAuth: !!(auth && auth.passwordAuth),
    storage: !!(auth && auth.storage),
    cloud: remoteAlive,
    billing: auth && auth.billing ? auth.billing : null
  });

  /* Email + password sign-in (POST /api/auth). action is 'login' or
   * 'register'; on success the server has set the session cookie, so we
   * re-probe to run the same cloud upgrade + device→cloud migration an OAuth
   * return would. Rejects with an Error whose .code is the server's stable
   * machine code (invalid_credentials, email_taken, weak_password, …) so the
   * UI can map it to copy. */
  async function passwordAuth(action, creds) {
    const r = await fetch('/api/auth', {
      method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(Object.assign({ action }, creds || {}))
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok || !data.ok) {
      const e = new Error(data.error || 'auth_failed');
      e.code = data.error || 'auth_failed';
      throw e;
    }
    try { await init(); }
    catch (e) { auth = auth || { providers: [], passwordAuth: true }; auth.user = data.user; }
    return authState();
  }
  const setBilling = billing => {
    auth = auth || { user: null, providers: [], storage: false };
    auth.billing = billing;
    return authState();
  };

  function persistenceMode() {
    if (hasStorage() && artifactWorks !== false) return 'artifact';
    if (remoteAlive) return 'cloud';
    if (localStore()) return 'device';
    return 'session';
  }
  const onModeChange = cb => { if (typeof cb === 'function') modeListeners.push(cb); };

  /* ---------------- projects ---------------- */
  const INDEX_KEY = 'projects:index';
  const PROJECT_PREFIX = 'project:';
  // Thumbnails live in their OWN per-project docs, never embedded in the index.
  // A ~15 KB JPEG per row would push projects:index past the 400 KB cloud value
  // cap at ~26 projects, silently stopping cloud sync for Pro users (A5). Kept
  // out, the index rows are tiny and scale to thousands of projects.
  const THUMB_PREFIX = 'thumb:';
  const MAX_REVISIONS = 20;

  const loadThumb = id => get(THUMB_PREFIX + id);

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
      progress: data.progress || { cuts: {}, steps: {} },
      // Display-only record of the design's issued blueprint (credits pivot);
      // the server ledger stays the authority on every charge.
      blueprint: data.blueprint || null
    };
    await set(PROJECT_PREFIX + data.id, record);
    if (data.thumb) await set(THUMB_PREFIX + data.id, data.thumb); // its own doc, not the index
    const idx = await loadIndex();
    const row = {
      id: data.id, name: data.name, updated: record.updated,
      dims: data.dims || null,
      progressPct: data.progressPct !== undefined ? data.progressPct : (idx.find(r => r.id === data.id) || {}).progressPct || 0
    };
    const i = idx.findIndex(r => r.id === data.id);
    if (i >= 0) idx[i] = row; else idx.unshift(row);
    // Self-healing migration: move any thumbnails a legacy index still embeds
    // into their own docs, so the persisted index is always thumbnail-free.
    const migrations = [];
    for (const r of idx) {
      if (r.thumb) { migrations.push(set(THUMB_PREFIX + r.id, r.thumb)); delete r.thumb; }
    }
    if (migrations.length) await Promise.all(migrations);
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
    await del(THUMB_PREFIX + id);
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
    const srcThumb = row.thumb || await loadThumb(id); // legacy embedded or its own doc
    if (srcThumb) await set(THUMB_PREFIX + copyId, srcThumb);
    idx.unshift({ id: copyId, name: copy.name, updated: copy.updated, dims: row.dims || null, progressPct: 0 });
    await saveIndex(idx);
    return copyId;
  }

  /* ---------------- price table & preferences ---------------- */
  const PRICES_KEY = 'prices:v1';
  const PREFS_KEY = 'prefs:v2';
  const LEGACY_PREFS_KEY = 'prefs:v1';
  // Fresh installs: fractional inches at 1/16, dual display off, OS theme,
  // textured render (wood grain + shadows).
  // ui: shell layout — chat panel collapsed (desktop) and the viewport/plans
  // split as a percentage of the stage height.
  const DEFAULT_PREFS = {
    climate: 'temperate', stockMode: {}, theme: 'auto',
    units: { system: 'imperial', precision: 16, dual: false },
    render: { textured: true },
    ui: { chatCollapsed: false, split: 58 },
    seenHero: false, // the one-shot assemble moment on first starter pick
    level: null      // skill level the USER chose via the dropdown (C-06); null = never chosen
  };

  /* Sheet prices migrated in place (2026 expansion): the legacy flat shape
   * {6:40,12:62,18:85} implicitly meant Baltic birch — it becomes that
   * species' row, and other sheet species fill from defaults. User edits are
   * never lost; per-species deep-fill keeps new thicknesses/species working. */
  function normalizeSheetPrices(dfltSheet, storedSheet) {
    const out = {};
    const legacyFlat = storedSheet && typeof storedSheet === 'object' &&
      Object.keys(storedSheet).every(k => /^\d+$/.test(k));
    for (const key of Object.keys(dfltSheet)) {
      const storedRow = legacyFlat
        ? (key === 'baltic_birch' ? storedSheet : null)
        : (storedSheet && typeof storedSheet[key] === 'object' ? storedSheet[key] : null);
      out[key] = Object.assign({}, dfltSheet[key], storedRow || {});
    }
    return out;
  }
  async function loadPrices() {
    const stored = await get(PRICES_KEY);
    const dflt = BB.K.defaultPrices();
    if (!stored || typeof stored !== 'object') return dflt;
    // Per-species deep-fill: a stored table from before the expansion gains
    // the new species and nominals without clobbering edited rows.
    const dimensional = {};
    for (const sp of Object.keys(dflt.dimensional)) {
      dimensional[sp] = Object.assign({}, dflt.dimensional[sp],
        stored.dimensional && stored.dimensional[sp] ? stored.dimensional[sp] : {});
    }
    return {
      dimensional,
      sheet: normalizeSheetPrices(dflt.sheet, stored.sheet),
      bdft: Object.assign({}, dflt.bdft, stored.bdft || {}),
      // Hardware & consumables (2026): pre-expansion tables gain the block.
      hardware: Object.assign({}, dflt.hardware, stored.hardware || {})
    };
  }
  const savePrices = prices => set(PRICES_KEY, prices);

  /* Deep-fill against defaults so new fields appear WITHOUT clobbering the
   * user's stored choices (Object.assign would flatten the units block). */
  function withPrefDefaults(stored) {
    const out = Object.assign({}, DEFAULT_PREFS, stored);
    out.units = Object.assign({}, DEFAULT_PREFS.units, stored && stored.units ? stored.units : {});
    out.render = Object.assign({}, DEFAULT_PREFS.render, stored && stored.render ? stored.render : {});
    out.ui = Object.assign({}, DEFAULT_PREFS.ui, stored && stored.ui ? stored.ui : {});
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
      // Fill with the live --paper token so dark-theme thumbs match their cards.
      let paper = '#efeade';
      try {
        const v = getComputedStyle(document.documentElement).getPropertyValue('--paper').trim();
        if (v) paper = v;
      } catch (e) { /* default paper */ }
      ctx.fillStyle = paper;
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
    consumeWriteDenial: () => { const d = writeDenial; writeDenial = null; return d; },
    isPersistent: () => persistenceMode() !== 'session',
    persistenceMode, init, auth: authState, setBilling, onModeChange, passwordAuth,
    loginUrl: p => '/api/auth?provider=' + encodeURIComponent(p),
    logoutUrl: '/api/auth?logout=1',
    newId, loadIndex, saveProject, loadProject, loadThumb, deleteProject, renameProject, duplicateProject,
    loadPrices, savePrices, loadPrefs, savePrefs, makeThumb,
    MAX_REVISIONS, DEFAULT_PREFS
  };
})();
