/* Blueprint Buddy — procedural materials (Phase 5).
 * Wood-grain albedo textures, the studio environment, and the contact blob
 * are all painted on canvas at runtime — no fetched assets, so the
 * single-file build stays self-contained. Grain is deterministic per species
 * (seeded PRNG), so thumbnails and re-opens always look the same.
 *
 * Texture cache contract: ONE CanvasTexture per species for the whole app
 * lifetime, shared across engine instances (textures upload per GL context,
 * and the source canvas outlives any one renderer). Engines must NOT call
 * disposeAll() in their own dispose(); it exists for tests and teardown.
 *
 * THREE is passed into texture builders (not read from globals) so headless
 * tests can exercise the cache with a stub.
 */
var BB = globalThis.BB = globalThis.BB || {};

(function () {
  'use strict';

  const TEX_W = 256, TEX_H = 512; // V (height) runs along the grain

  /* FNV-1a hash of the key seeds a mulberry32 stream — deterministic and
   * cheap, good enough for grain jitter (not cryptographic). */
  function seededRand(key) {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < key.length; i++) { h ^= key.charCodeAt(i); h = Math.imul(h, 16777619); }
    let a = h >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /* Grain recipe per species: painting parameters live in knowledge.js next
   * to the structural data (grainScale px, ringContrast 0..1, hueJitter 0..1,
   * pores 0..1). This helper merges them with the base tone and flags. */
  function grainParams(speciesKey) {
    const sp = BB.K.WOOD_SPECIES[speciesKey];
    if (!sp) return null;
    return {
      key: speciesKey, tone: sp.tone, sheet: !!sp.sheet,
      grainScale: sp.grainScale || 18,
      ringContrast: sp.ringContrast !== undefined ? sp.ringContrast : 0.4,
      hueJitter: sp.hueJitter !== undefined ? sp.hueJitter : 0.2,
      pores: sp.pores !== undefined ? sp.pores : 0.3
    };
  }

  const hex = t => ({ r: (t >> 16) & 255, g: (t >> 8) & 255, b: t & 255 });
  const rgba = (c, a) => `rgba(${c.r | 0},${c.g | 0},${c.b | 0},${a})`;
  const shade = (c, f) => ({ r: Math.min(255, c.r * f), g: Math.min(255, c.g * f), b: Math.min(255, c.b * f) });

  /* Paint one wrap-safe wood face onto a 2D context. Grain lines are sine
   * wobbles with an INTEGER number of vertical periods, so the texture tiles
   * seamlessly along the grain; every stroke is drawn three times (x-W, x,
   * x+W) so it also tiles across it. Poplar's hue patches drift green — its
   * signature streaks — via the hueJitter green bias below.
   */
  function paintWood(ctx, W, H, p, rand) {
    const base = hex(p.tone);
    ctx.fillStyle = rgba(base, 1);
    ctx.fillRect(0, 0, W, H);

    // Low-frequency color patches: boards are not one color.
    const patches = p.sheet ? 4 : 8;
    for (let i = 0; i < patches; i++) {
      const cx = rand() * W, pw = W * (0.18 + rand() * 0.3);
      const f = 1 + (rand() - 0.5) * 0.5 * p.hueJitter * 2;
      const c = shade(base, f);
      if (p.key === 'poplar' && rand() < 0.4) { c.g = Math.min(255, c.g * 1.12); c.r *= 0.92; } // green streaks
      const g = ctx.createLinearGradient(cx - pw, 0, cx + pw, 0);
      g.addColorStop(0, rgba(c, 0));
      g.addColorStop(0.5, rgba(c, 0.28));
      g.addColorStop(1, rgba(c, 0));
      ctx.fillStyle = g;
      for (const ox of [-W, 0, W]) { ctx.save(); ctx.translate(ox, 0); ctx.fillRect(cx - pw, 0, pw * 2, H); ctx.restore(); }
    }

    // Growth-ring lines along the grain.
    const dark = shade(base, 0.55), light = shade(base, 1.18);
    const spacing = Math.max(4, p.grainScale);
    for (let x0 = 0; x0 < W; x0 += spacing * (0.6 + rand() * 0.8)) {
      const amp = p.sheet ? 0.6 : (1.5 + rand() * 4.5);           // wobble, px
      const n = 1 + Math.floor(rand() * 3);                       // integer periods → vertical wrap
      const phase = rand() * Math.PI * 2;
      const late = rand() < 0.35;                                 // occasional latewood band
      const alpha = p.ringContrast * (late ? 0.34 : 0.16) * (0.7 + rand() * 0.6);
      ctx.strokeStyle = rgba(rand() < 0.12 ? light : dark, alpha);
      ctx.lineWidth = late ? 1.6 + rand() * 1.4 : 0.7 + rand() * 0.8;
      for (const ox of [-W, 0, W]) {
        ctx.beginPath();
        for (let y = 0; y <= H; y += 8) {
          const x = x0 + ox + amp * Math.sin((y / H) * Math.PI * 2 * n + phase);
          if (y === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
    }

    // Pores / fine short streaks (open-grained species read coarser).
    const strokes = Math.round(p.pores * 260);
    ctx.lineWidth = 0.6;
    for (let i = 0; i < strokes; i++) {
      const x = rand() * W, y = rand() * H, len = 8 + rand() * 30;
      ctx.strokeStyle = rgba(dark, 0.05 + rand() * 0.07);
      for (const [ox, oy] of [[0, 0], [0, -H], [0, H], [-W, 0], [W, 0]]) {
        ctx.beginPath();
        ctx.moveTo(x + ox, y + oy);
        ctx.lineTo(x + ox + (rand() - 0.5) * 2, y + oy + len);
        ctx.stroke();
      }
    }
  }

  /* ---------------- texture cache ---------------- */
  const texCache = new Map(); // speciesKey -> CanvasTexture

  function woodTexture(THREE, speciesKey) {
    if (texCache.has(speciesKey)) return texCache.get(speciesKey);
    const p = grainParams(speciesKey);
    if (!p) return null;
    const c = document.createElement('canvas');
    c.width = TEX_W; c.height = TEX_H;
    paintWood(c.getContext('2d'), TEX_W, TEX_H, p, seededRand(speciesKey));
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.anisotropy = 4;
    texCache.set(speciesKey, tex);
    return tex;
  }

  function disposeAll() {
    for (const t of texCache.values()) t.dispose();
    texCache.clear();
  }

  /* ---------------- studio environment ----------------
   * A small equirect gradient the PBR materials reflect: warm skylight above,
   * paper-toned bounce below, one bright window blob for speculars. Palettes
   * track the app themes so reflections never fight the page behind the
   * transparent canvas.
   */
  const ENV_PALETTES = {
    light: { top: '#fff8ec', mid: '#d9d0be', bottom: '#b4a98f', window: 'rgba(255,255,255,0.95)' },
    dark: { top: '#4a4238', mid: '#2a241d', bottom: '#171310', window: 'rgba(255,240,214,0.85)' }
  };

  function envCanvas(theme) {
    const pal = ENV_PALETTES[theme] || ENV_PALETTES.light;
    const c = document.createElement('canvas');
    c.width = 64; c.height = 32;
    const ctx = c.getContext('2d');
    const g = ctx.createLinearGradient(0, 0, 0, 32);
    g.addColorStop(0, pal.top);
    g.addColorStop(0.55, pal.mid);
    g.addColorStop(1, pal.bottom);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 64, 32);
    const w = ctx.createRadialGradient(16, 9, 1, 16, 9, 11);
    w.addColorStop(0, pal.window);
    w.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = w;
    ctx.fillRect(0, 0, 64, 32);
    return c;
  }

  /* Soft radial contact blob — the grounding fallback when real shadows are
   * off (flat quality tier). */
  function blobCanvas() {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const ctx = c.getContext('2d');
    const g = ctx.createRadialGradient(64, 64, 6, 64, 64, 62);
    g.addColorStop(0, 'rgba(0,0,0,0.26)');
    g.addColorStop(0.55, 'rgba(0,0,0,0.10)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 128, 128);
    return c;
  }

  BB.Materials = {
    seededRand, grainParams, paintWood, woodTexture, disposeAll,
    envCanvas, blobCanvas, ENV_PALETTES, TEX_W, TEX_H,
    _cacheSize: () => texCache.size
  };
})();
