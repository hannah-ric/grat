/* Blueprint Buddy — 3D engine (THREE r152, global build).
 *
 * Memory contract (Phase 1 item, re-verified in Phase 2): every part mesh
 * shares one unit geometry per (primitive, grain axis) — three UV-variant
 * unit boxes plus one unit cylinder, allocated once — scaled per part, so
 * scene rebuilds allocate no geometry. Materials live in a bounded pool keyed
 * by (material, role, bucket, textured) and are disposed on hard teardown.
 * Wood textures are pooled per species in BB.Materials (app lifetime, shared
 * across engine instances). The only per-rebuild GPU allocations are
 * dimension-label textures, which are disposed whenever annotations rebuild.
 * `engine.stats()` exposes renderer.info for the leak check.
 *
 * Render pipeline (Phase 5): ACES tone mapping, a procedural PMREM studio
 * environment (regenerated per theme, old target disposed), and one PCFSoft
 * sun shadow onto a ShadowMaterial plane so parts stay grounded mid-flight
 * during explode/playback. The flat quality tier trades both for a painted
 * contact blob. Background stays transparent — the page's --paper shows
 * through in every mode.
 *
 * Motion: one damped-lerp family drives everything — part positions, scales,
 * drawer travel, explosion, camera (including its target), the selection
 * light multipliers, and step stagger. Release inertia (flick) feeds the
 * same goals and decays exponentially. Reduced motion snaps all of it and
 * zeroes the decorative layers (inertia, stagger).
 */
var BB = globalThis.BB = globalThis.BB || {};

(function () {
  'use strict';

  const ROLE_SHADE = { // multiplier so roles read apart within one species
    leg: 0.82, apron: 0.9, rail: 0.95, top: 1.06, seat: 1.06, shelf: 1.0,
    side: 0.94, bottom: 0.9, back: 1.1, plinth: 0.78,
    drawer_side: 1.0, drawer_boxfront: 1.0, drawer_boxback: 0.97, drawer_bottom: 1.08,
    drawer_front: 1.04, pull: 1.0
  };
  const BUCKETS = { solid: 1, dim: 0.32, ghost: 0.3, faint: 0.07, hidden: 0.0 };

  /* Interactive dolly floor (A-06): wheel, pinch, and keyboard zoom stop at
   * a fraction of the piece's bounding-sphere radius (never under the 300 mm
   * absolute floor), so the camera can never dive through the model into a
   * blank scene. Pure — the self-test asserts it; code owns the number. */
  const DOLLY_MIN_K = 0.9;
  function minDolly(b) {
    return Math.max(300, Math.sqrt(b.w * b.w + b.d * b.d + b.h * b.h) / 2 * DOLLY_MIN_K);
  }

  function create(canvas, opts) {
    const THREE = globalThis.THREE;
    opts = opts || {};
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(2, globalThis.devicePixelRatio || 1));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(42, 1, 10, 30000);
    /* Drafting projection: one orthographic camera rides the same spherical
     * rig — camCur.dist maps to frustum half-height so perspective↔ortho
     * switches are visually seamless and wheel-zoom keeps working. */
    const ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, -50000, 50000);
    let activeCamera = camera;
    let viewAspect = 1;
    const ORTHO_K = Math.tan((42 / 2) * Math.PI / 180); // fov/2 → dist·k = half-height

    /* Everything a theme touches in-scene, in one table. Wood stays wood in
     * both themes; what changes is ink, labels, bounce light, and shadows. */
    /* Selection speaks Showroom seafoam (deepened for ink duty by day, raw
     * after hours); tappable joint dots speak rust — the action color. The
     * machinist-blue selection family is retired; blue lives only in DRAFT. */
    const THEMES = {
      light: {
        edge: 0x2a2018, edgeSel: 0x447e6e, joint: 0x942911, dim: 0x7a614a,
        hemiSky: 0xfff6e8, hemiGround: 0x9a8a76, hemiI: 0.8, sunI: 1.25, fillI: 0.45, shadowOp: 0.2,
        label: { bg: 'rgba(250,247,242,0.92)', stroke: 'rgba(90,70,50,0.35)', ink: '#4a3826' }
      },
      dark: {
        edge: 0xefe2cc, edgeSel: 0x94b9af, joint: 0xe47952, dim: 0xcbb695,
        hemiSky: 0xcabfa8, hemiGround: 0x2e2921, hemiI: 0.7, sunI: 1.1, fillI: 0.35, shadowOp: 0.3,
        label: { bg: 'rgba(30,26,20,0.92)', stroke: 'rgba(210,190,160,0.35)', ink: '#ede5d6' }
      }
    };

    /* Blueprint-mode palette: technical-drawing fills and ink per theme.
     * Light = ink-on-paper machinist blue; dark = true cyanotype. */
    const DRAFT = {
      light: {
        fill: 0xfdfcf7, ink: 0x1b5d82, dim: 0x14486a,
        label: { bg: 'rgba(253,252,247,0.95)', stroke: 'rgba(27,93,130,0.45)', ink: '#14486a' }
      },
      dark: {
        fill: 0x143850, ink: 0xd9e8f4, dim: 0xa8cce4,
        label: { bg: 'rgba(16,45,66,0.95)', stroke: 'rgba(168,204,228,0.45)', ink: '#dbe9f4' }
      }
    };

    const hemi = new THREE.HemisphereLight(0xfff6e8, 0x9a8a76, 0.85);
    scene.add(hemi);
    const sun = new THREE.DirectionalLight(0xffffff, 1.35);
    sun.position.set(1400, 2200, 1600);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    scene.add(sun);
    // Warm parchment fill — the cool studio-blue fill retired with the
    // machinist palette; only Blueprint Mode keeps blue.
    const fill = new THREE.DirectionalLight(0xf0e6d2, 0.45);
    fill.position.set(-1600, 800, -1200);
    scene.add(fill);

    // Ground: contact blob (flat tier) or shadow plane (default), plus grid.
    const groundGroup = new THREE.Group();
    const discGeo = new THREE.CircleGeometry(1, 64);
    const blobTex = new THREE.CanvasTexture(BB.Materials.blobCanvas());
    const discMat = new THREE.MeshBasicMaterial({ map: blobTex, transparent: true, depthWrite: false });
    const disc = new THREE.Mesh(discGeo, discMat);
    disc.rotation.x = -Math.PI / 2;
    groundGroup.add(disc);
    const shadowGeo = new THREE.PlaneGeometry(1, 1);
    const shadowMat = new THREE.ShadowMaterial({ opacity: 0.16 });
    const shadowPlane = new THREE.Mesh(shadowGeo, shadowMat);
    shadowPlane.rotation.x = -Math.PI / 2;
    shadowPlane.position.y = 1; // above the grid lines, under everything else
    shadowPlane.receiveShadow = true;
    groundGroup.add(shadowPlane);
    const grid = new THREE.GridHelper(1, 10, 0x8a7a66, 0x8a7a66);
    grid.material.transparent = true; grid.material.opacity = 0.12;
    groundGroup.add(grid);
    scene.add(groundGroup);

    /* Procedural studio environment: tiny equirect canvas → PMREM. Regenerated
     * on theme switch; the previous render target is disposed first. */
    let envRT = null;
    function applyEnvironment(theme) {
      const pm = new THREE.PMREMGenerator(renderer);
      const tex = new THREE.CanvasTexture(BB.Materials.envCanvas(theme));
      tex.mapping = THREE.EquirectangularReflectionMapping;
      tex.colorSpace = THREE.SRGBColorSpace;
      const rt = pm.fromEquirectangular(tex);
      tex.dispose();
      pm.dispose();
      if (envRT) envRT.dispose();
      envRT = rt;
      scene.environment = rt.texture;
    }

    /* Shared geometry — the whole memory story. Three unit boxes with
     * pre-rotated UVs (texture V along local X, Y, or Z) let grain follow
     * each part's long axis while every part still shares geometry; cylinders
     * (novel-grammar primitive) share one unit cylinder the same way. */
    function makeGrainBox(axis) {
      const g = new THREE.BoxGeometry(1, 1, 1);
      const pos = g.attributes.position, uv = g.attributes.uv, nrm = g.attributes.normal;
      for (let i = 0; i < pos.count; i++) {
        const p = { x: pos.getX(i) + 0.5, y: pos.getY(i) + 0.5, z: pos.getZ(i) + 0.5 };
        const nAxis = Math.abs(nrm.getX(i)) > 0.5 ? 'x' : Math.abs(nrm.getY(i)) > 0.5 ? 'y' : 'z';
        if (nAxis === axis) {
          // End-grain face: any consistent mapping; side grain reads fine here.
          const t = axis === 'x' ? ['y', 'z'] : axis === 'y' ? ['x', 'z'] : ['x', 'y'];
          uv.setXY(i, p[t[0]], p[t[1]]);
        } else {
          const other = axis !== 'x' && nAxis !== 'x' ? 'x' : axis !== 'y' && nAxis !== 'y' ? 'y' : 'z';
          uv.setXY(i, p[other], p[axis]); // V runs along the grain axis
        }
      }
      return g;
    }
    const unitBoxes = { x: makeGrainBox('x'), y: makeGrainBox('y'), z: makeGrainBox('z') };
    const unitBox = unitBoxes.y;
    const unitEdges = new THREE.EdgesGeometry(unitBox);
    const unitCyl = new THREE.CylinderGeometry(0.5, 0.5, 1, 24);
    const unitCylEdges = new THREE.EdgesGeometry(unitCyl, 30);
    const DEG = Math.PI / 180;

    /* Grain axis for a part: along its stated grain if the model says so,
     * else along the longest dimension — the same rule the cut list uses. */
    function grainAxis(part) {
      const dims = [['x', part.size.w], ['y', part.size.h], ['z', part.size.d]].sort((a, b) => b[1] - a[1]);
      return part.grain === 'width' ? dims[1][0] : dims[0][0];
    }

    /* Quality tiers: default is textured wood + real shadows; the flat tier
     * (low-power devices, user choice) is solid tones + contact blob. */
    const quality = { textured: true, shadows: true };
    let curTheme = 'light';

    /* Selection spotlight (interaction design §6a): light intensities ride a
     * damped multiplier table — never a second timing system. Scene-only, so
     * page/DOM contrast is untouched; Blueprint mode is unlit and opts out. */
    const lightMul = { cur: { hemi: 1, sun: 1, fill: 1 }, goal: { hemi: 1, sun: 1, fill: 1 } };
    function retargetLights() {
      const focus = !!(E.selected || E.isolated) && !E.drafting;
      lightMul.goal.hemi = focus ? 0.88 : 1;
      lightMul.goal.sun = focus ? 1.06 : 1;
      lightMul.goal.fill = focus ? 0.68 : 1;
    }

    /* Selection reads as a view-dependent fresnel rim rather than a flat
     * emissive: it survives dark species in both themes and re-inks on theme
     * change through this one shared uniform color. If a future three build
     * renames the chunk, the unmatched replace leaves the material unpatched
     * — selection still shows via its edge lines, nothing breaks. */
    const rimColor = new THREE.Color(0x447e6e);
    function patchRim(m) {
      m.onBeforeCompile = shader => {
        shader.uniforms.uBBRim = { value: rimColor };
        shader.fragmentShader = 'uniform vec3 uBBRim;\n' + shader.fragmentShader.replace(
          '#include <emissivemap_fragment>',
          '#include <emissivemap_fragment>\n' +
          '\tfloat bbRim = pow(1.0 - saturate(dot(normalize(normal), normalize(vViewPosition))), 3.0);\n' +
          '\ttotalEmissiveRadiance += uBBRim * bbRim * 0.9;');
      };
    }

    // Bounded material pool. Textured wood gets the species grain map with a
    // near-white tint (ROLE_SHADE still separates legs/tops/backs); flat mode
    // keeps the original solid species tones.
    const matPool = new Map();
    function materialFor(matKey, role, bucket) {
      const sp = BB.K.WOOD_SPECIES[matKey];
      const textured = quality.textured && !!sp;
      const key = matKey + '|' + role + '|' + bucket + (textured ? '|t' : '');
      if (matPool.has(key)) return matPool.get(key);
      let tone = 0xb98d62, rough = 0.7;
      if (matKey === 'hardware') { tone = 0x46464a; rough = 0.35; }
      else if (sp) { tone = sp.tone; rough = sp.rough; }
      const shadeF = ROLE_SHADE[role] || 1;
      const c = textured
        ? new THREE.Color(1, 1, 1).multiplyScalar(0.55 + 0.45 * shadeF)
        : new THREE.Color(tone).multiplyScalar(shadeF);
      const opacity = BUCKETS[bucket] !== undefined ? BUCKETS[bucket] : 1;
      const m = new THREE.MeshStandardMaterial({
        color: c, roughness: rough, metalness: matKey === 'hardware' ? 0.6 : 0.02,
        transparent: opacity < 1, opacity, depthWrite: opacity > 0.5
      });
      if (textured) m.map = BB.Materials.woodTexture(THREE, matKey);
      m.envMapIntensity = matKey === 'hardware' ? 0.9 : 0.5;
      if (bucket === 'selected') {
        if (textured) patchRim(m); // fresnel rim; recolored via the shared uniform
        else { m.emissive = new THREE.Color().copy(rimColor); m.emissiveIntensity = 0.3; }
      }
      matPool.set(key, m);
      return m;
    }
    const edgeMat = new THREE.LineBasicMaterial({ color: 0x2a2018, transparent: true, opacity: 0.28 });
    const edgeMatFaint = new THREE.LineBasicMaterial({ color: 0x2a2018, transparent: true, opacity: 0.05 });
    const selEdgeMat = new THREE.LineBasicMaterial({ color: 0x447e6e, transparent: true, opacity: 0.95 });
    const hoverEdgeMat = new THREE.LineBasicMaterial({ color: 0x447e6e, transparent: true, opacity: 0.6 });

    /* Blueprint mode: flat paper fills — the existing per-mesh edge overlays
     * become the ink lines, at full weight. Pooled per (bucket, theme). */
    const draftMats = new Map();
    const DRAFT_OPACITY = { solid: 0.96, selected: 0.96, dim: 0.4, ghost: 0.3, faint: 0.08, hidden: 0 };
    function draftMaterialFor(bucket) {
      const key = bucket + '|' + curTheme;
      if (draftMats.has(key)) return draftMats.get(key);
      const pal = DRAFT[curTheme];
      const opacity = DRAFT_OPACITY[bucket] !== undefined ? DRAFT_OPACITY[bucket] : 0.96;
      const c = new THREE.Color(bucket === 'selected' ? pal.ink : pal.fill);
      if (bucket === 'selected') c.lerp(new THREE.Color(pal.fill), 0.75); // pale ink tint
      const m = new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity, depthWrite: opacity > 0.5 });
      draftMats.set(key, m);
      return m;
    }
    const draftEdge = new THREE.LineBasicMaterial({ color: 0x1b5d82, transparent: true, opacity: 0.9 });
    const draftEdgeFaint = new THREE.LineBasicMaterial({ color: 0x1b5d82, transparent: true, opacity: 0.12 });
    const draftSelEdge = new THREE.LineBasicMaterial({ color: 0x1b5d82, transparent: true, opacity: 1 });

    const partsGroup = new THREE.Group();
    scene.add(partsGroup);
    const ghostGroup = new THREE.Group();
    scene.add(ghostGroup);
    const annoGroup = new THREE.Group();
    scene.add(annoGroup);
    const jointGroup = new THREE.Group();
    scene.add(jointGroup);

    /* ---------------- state ---------------- */
    const E = {
      meshes: new Map(),      // partId -> {mesh, edge, part, cur:{pos,scale}, target:{pos,scale}, bucket}
      model: null, spec: null,
      explodeT: 0,
      openDrawers: new Set(),
      selected: null, isolated: null,
      hovered: null, hoverDot: null,
      dimsVisible: false,
      drafting: false,
      playback: null,         // {steps, index}
      reducedMotion: !!opts.reducedMotion,
      bounds: { w: 1500, d: 850, h: 750 },
      needsAnno: false,
      disposed: false
    };
    /* The camera target is a damped pair like every other value: pan and
     * dolly write both (1:1 feel under the pointer), part framing writes the
     * goal only, so it glides. */
    const tgtCur = new THREE.Vector3(0, 400, 0);
    const tgtGoal = new THREE.Vector3(0, 400, 0);
    let camCur = { theta: 0.7, phi: 1.15, dist: 3200 };
    let camGoal = { theta: 0.7, phi: 1.15, dist: 3200 };
    const labelTextures = [];

    /* ---------------- target computation ----------------
     * Assembled position + drawer travel + staged explosion + playback state.
     */
    function drawerFor(part) {
      if (part.drawer === undefined || part.drawer === null || !E.model) return null;
      return E.model.drawers[part.drawer] || null;
    }
    function explodedOffset(part, t, spread) {
      const off = { x: 0, y: 0, z: 0 };
      const dr = drawerFor(part);
      if (dr) {
        // Drawers pull forward BEFORE the general explosion applies.
        const dT = Math.min(1, t / 0.35);
        const gT = Math.max(0, (t - 0.35) / 0.65);
        off.z += dT * (dr.travel * 0.7 + 60) + gT * spread * 0.45;
      } else {
        const gT = Math.max(0, (t - 0.15) / 0.85);
        off.x += part.explode.x * gT * spread;
        off.y += part.explode.y * gT * spread * 0.7;
        off.z += part.explode.z * gT * spread;
      }
      return off;
    }
    /* Playback start pose: fully exploded, drawer internals additionally spread. */
    function playbackStart(part, spread) {
      const off = explodedOffset(part, 1, spread);
      if (drawerFor(part)) {
        const extra = {
          drawer_side: p => ({ x: Math.sign(p.pos.x || 0.01) * 130, y: 0, z: 0 }),
          drawer_boxback: () => ({ x: 0, y: 0, z: -90 }),
          drawer_bottom: () => ({ x: 0, y: -110, z: 0 }),
          drawer_front: () => ({ x: 0, y: 0, z: 150 }),
          pull: () => ({ x: 0, y: 0, z: 230 })
        }[part.role];
        if (extra) { const e = extra(part); off.x += e.x; off.y += e.y; off.z += e.z; }
      }
      return off;
    }

    function computeTarget(rec) {
      const part = rec.part;
      const spread = Math.max(E.bounds.w, E.bounds.d, E.bounds.h) * 0.45;
      const t = { x: part.pos.x, y: part.pos.y, z: part.pos.z };
      let bucket = 'solid';

      if (E.playback) {
        const { steps, index } = E.playback;
        const placed = new Set(), current = new Set();
        for (let i = 0; i < index; i++) for (const id of steps[i].partIds) placed.add(id);
        for (const id of (steps[index] ? steps[index].partIds : [])) current.add(id);
        if (current.has(part.id)) bucket = 'solid';
        else if (placed.has(part.id)) bucket = 'dim';
        else bucket = 'faint';
        if (!placed.has(part.id) && !current.has(part.id)) {
          const off = playbackStart(part, spread);
          t.x += off.x; t.y += off.y; t.z += off.z;
        }
      } else {
        const off = explodedOffset(part, E.explodeT, spread);
        t.x += off.x; t.y += off.y; t.z += off.z;
        const dr = drawerFor(part);
        if (dr && E.openDrawers.has(dr.index)) t.z += dr.travel;
        if (E.isolated) bucket = part.id === E.isolated ? 'solid' : 'faint';
      }
      rec.target = { pos: t, scale: { x: part.size.w, y: part.size.h, z: part.size.d } };
      rec.bucket = bucket;
    }

    function retargetAll() {
      for (const rec of E.meshes.values()) computeTarget(rec);
      E.needsAnno = true;
    }

    /* ---------------- scene (re)build — diff by part id ---------------- */
    function setModel(model, spec, opts2) {
      const firstModel = !E.model;
      E.model = model; E.spec = spec;
      E.bounds = model.bounds;
      const seen = new Set();
      for (const part of model.parts) {
        seen.add(part.id);
        const isCyl = part.prim === 'cylinder';
        // Geometry choice is (primitive, grain axis) — all variants are the
        // module-shared unit geometries, so swapping allocates nothing.
        const geoKey = isCyl ? 'cyl' : grainAxis(part);
        let rec = E.meshes.get(part.id);
        if (rec && rec.geoKey !== geoKey) {
          rec.mesh.geometry = isCyl ? unitCyl : unitBoxes[geoKey];
          rec.edge.geometry = isCyl ? unitCylEdges : unitEdges;
          rec.geoKey = geoKey;
        }
        if (!rec) {
          const mesh = new THREE.Mesh(isCyl ? unitCyl : unitBoxes[geoKey], materialFor(part.material, part.role, 'solid'));
          mesh.castShadow = true;
          mesh.receiveShadow = true;
          const edge = new THREE.LineSegments(isCyl ? unitCylEdges : unitEdges, edgeMat);
          mesh.add(edge);
          mesh.userData.partId = part.id;
          partsGroup.add(mesh);
          rec = { mesh, edge, part, bucket: 'solid', cur: null, geoKey, delay: 0 };
          E.meshes.set(part.id, rec);
        }
        rec.part = part;
        // Static rotation from the novel grammar (degrees, applied X→Y→Z).
        const r = part.rot || { x: 0, y: 0, z: 0 };
        rec.mesh.rotation.set((r.x || 0) * DEG, (r.y || 0) * DEG, (r.z || 0) * DEG, 'ZYX');
        computeTarget(rec);
        if (!rec.cur || (opts2 && opts2.snap)) {
          rec.cur = { pos: { ...rec.target.pos }, scale: { ...rec.target.scale } };
          if (!(opts2 && opts2.snap) && !E.reducedMotion) rec.cur.scale = { x: 0.001, y: 0.001, z: 0.001 };
        }
      }
      for (const [id, rec] of [...E.meshes]) {
        if (!seen.has(id)) {
          partsGroup.remove(rec.mesh);
          E.meshes.delete(id);
        }
      }
      if (E.selected && !seen.has(E.selected)) E.selected = null;
      if (E.isolated && !seen.has(E.isolated)) E.isolated = null;
      const maxDim = Math.max(model.bounds.w, model.bounds.d, model.bounds.h);
      disc.scale.setScalar(maxDim * 1.4);
      grid.scale.setScalar(maxDim * 2.6 / 1);
      // Sun distance and shadow frustum track model size, sized once per
      // model to cover the fully exploded pose (offsets reach ~0.95 × maxDim).
      sun.position.set(1400, 2200, 1600).normalize().multiplyScalar(maxDim * 2.6);
      const sc = sun.shadow.camera, ext = maxDim * 1.6;
      sc.left = -ext; sc.right = ext; sc.top = ext; sc.bottom = -ext;
      sc.near = maxDim * 0.4; sc.far = maxDim * 5.2;
      sc.updateProjectionMatrix();
      sun.shadow.normalBias = Math.max(1, maxDim * 0.002);
      shadowPlane.scale.setScalar(maxDim * 4);
      tgtGoal.set(0, model.bounds.h * 0.45, 0);
      if (firstModel || E.reducedMotion) tgtCur.copy(tgtGoal);
      focusRestore = null; // a rebuilt design invalidates the stored framing pose
      E.needsAnno = true;
      retargetAll();
    }

    function setGhost(model) {
      // Compare overlay: previous design at 30% opacity behind the new one.
      while (ghostGroup.children.length) {
        ghostGroup.remove(ghostGroup.children[0]);
      }
      if (model) {
        for (const part of model.parts) {
          // Same geometry rules as setModel: cylinders share the unit
          // cylinder, everything else the unit box, rotation applied X→Y→Z.
          const isCyl = part.prim === 'cylinder';
          const m = new THREE.Mesh(isCyl ? unitCyl : unitBox, materialFor(part.material, part.role, 'ghost'));
          m.userData.part = part; // lets setQuality re-derive the material
          const r = part.rot || { x: 0, y: 0, z: 0 };
          m.rotation.set((r.x || 0) * DEG, (r.y || 0) * DEG, (r.z || 0) * DEG, 'ZYX');
          m.scale.set(part.size.w, part.size.h, part.size.d);
          m.position.set(part.pos.x, part.pos.y, part.pos.z);
          ghostGroup.add(m);
        }
      }
    }

    /* ---------------- dimension annotations ---------------- */
    function makeLabel(text) {
      const pal = (E.drafting ? DRAFT : THEMES)[curTheme].label;
      const c = document.createElement('canvas');
      const ctx = c.getContext('2d');
      const fs = 44;
      ctx.font = `600 ${fs}px system-ui, sans-serif`;
      const w = Math.ceil(ctx.measureText(text).width) + 36;
      c.width = w; c.height = fs + 28;
      const ctx2 = c.getContext('2d');
      ctx2.font = `600 ${fs}px system-ui, sans-serif`;
      ctx2.fillStyle = pal.bg;
      const r = 14;
      ctx2.beginPath();
      ctx2.roundRect(0, 0, c.width, c.height, r);
      ctx2.fill();
      ctx2.strokeStyle = pal.stroke; ctx2.lineWidth = 2; ctx2.stroke();
      ctx2.fillStyle = pal.ink;
      ctx2.textBaseline = 'middle'; ctx2.textAlign = 'center';
      ctx2.fillText(text, c.width / 2, c.height / 2 + 2);
      const tex = new THREE.CanvasTexture(c);
      tex.colorSpace = THREE.SRGBColorSpace;
      labelTextures.push(tex);
      const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
      const s = Math.max(E.bounds.w, E.bounds.h) * 0.14;
      spr.scale.set(s * c.width / c.height * 0.55, s * 0.55, 1);
      spr.renderOrder = 10;
      return spr;
    }
    const dimLineMat = new THREE.LineBasicMaterial({ color: 0x7a614a, transparent: true, opacity: 0.85 });
    const tickMat = new THREE.MeshBasicMaterial({ color: 0x7a614a });
    const tickGeo = new THREE.SphereGeometry(1, 6, 6);
    function dimLine(a, b, label) {
      const g = new THREE.Group();
      const pts = [new THREE.Vector3(a.x, a.y, a.z), new THREE.Vector3(b.x, b.y, b.z)];
      const geo = new THREE.BufferGeometry().setFromPoints(pts);
      g.add(new THREE.Line(geo, dimLineMat));
      // end ticks (shared geometry + shared themable material)
      for (const p of pts) {
        const tick = new THREE.Mesh(tickGeo, tickMat);
        tick.position.copy(p);
        tick.scale.setScalar(Math.max(E.bounds.w, E.bounds.h) * 0.004 + 2);
        g.add(tick);
      }
      const spr = makeLabel(label);
      spr.position.set((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
      g.add(spr);
      return g;
    }
    function rebuildAnnotations() {
      // Dispose every label texture, sprite material, + line geometry from
      // the previous pass (tick geometry/material are shared — kept).
      annoGroup.traverse(o => {
        if (o.geometry && o.geometry !== tickGeo) o.geometry.dispose();
        if (o.isSprite && o.material) o.material.dispose();
      });
      while (annoGroup.children.length) annoGroup.remove(annoGroup.children[0]);
      for (const t of labelTextures.splice(0)) t.dispose();
      if (!E.dimsVisible || !E.model) return;
      // Annotation labels route through the display boundary like every
      // other surface; scene geometry itself stays in raw millimetres.
      const b = E.bounds, fmt = v => BB.Units.fmtLength(v);
      const m = Math.max(b.w, b.d, b.h) * 0.08 + 40; // offset from body
      const hw = b.w / 2, hd = b.d / 2;
      annoGroup.add(dimLine({ x: -hw, y: -0, z: hd + m }, { x: hw, y: 0, z: hd + m }, fmt(b.w)));
      annoGroup.add(dimLine({ x: hw + m, y: 0, z: hd }, { x: hw + m, y: 0, z: -hd }, fmt(b.d)));
      annoGroup.add(dimLine({ x: -hw - m, y: 0, z: hd }, { x: -hw - m, y: b.h, z: hd }, fmt(b.h)));
      const sel = E.selected && E.meshes.get(E.selected);
      if (sel) {
        const p = sel.part, s = p.size, pos = p.pos, off = 26;
        annoGroup.add(dimLine(
          { x: pos.x - s.w / 2, y: pos.y + s.h / 2 + off, z: pos.z + s.d / 2 },
          { x: pos.x + s.w / 2, y: pos.y + s.h / 2 + off, z: pos.z + s.d / 2 }, fmt(s.w)));
        annoGroup.add(dimLine(
          { x: pos.x + s.w / 2 + off, y: pos.y - s.h / 2, z: pos.z + s.d / 2 },
          { x: pos.x + s.w / 2 + off, y: pos.y + s.h / 2, z: pos.z + s.d / 2 }, fmt(s.h)));
        annoGroup.add(dimLine(
          { x: pos.x + s.w / 2 + off, y: pos.y + s.h / 2 + off, z: pos.z - s.d / 2 },
          { x: pos.x + s.w / 2 + off, y: pos.y + s.h / 2 + off, z: pos.z + s.d / 2 }, fmt(s.d)));
      }
    }

    /* ---------------- joint highlight (playback) ---------------- */
    const jointGeo = new THREE.SphereGeometry(1, 18, 14);
    const jointMat = new THREE.MeshBasicMaterial({ color: 0x942911, transparent: true, opacity: 0.55, depthTest: false });
    function showJoints(joints) {
      while (jointGroup.children.length) jointGroup.remove(jointGroup.children[0]);
      E.hoverDot = null;
      for (const j of joints || []) {
        const s = new THREE.Mesh(jointGeo, jointMat);
        s.position.set(j.pos.x, j.pos.y, j.pos.z);
        s.renderOrder = 9;
        s.userData.base = Math.max(E.bounds.w, E.bounds.h) * 0.016 + 8;
        s.userData.joint = j; // dots are doors: picked in playback → close-up
        jointGroup.add(s);
      }
    }

    /* ---------------- playback ---------------- */
    /* Choreographed weight (interaction design §3b): a step's parts leave in
     * build order, 55 ms apart — sequencing made visible without a solver.
     * Reduced motion never sets a hold (k = 1 snaps everything anyway). */
    function staggerStep() {
      if (!E.playback || E.reducedMotion) return;
      const step = E.playback.steps[E.playback.index];
      if (!step) return;
      step.partIds.forEach((id, i) => {
        const rec = E.meshes.get(id);
        if (rec) rec.delay = Math.min(i * 0.055, 0.5);
      });
    }
    function playbackEnter(steps) { E.playback = { steps, index: 0 }; showJoints(steps[0] && steps[0].joints); retargetAll(); staggerStep(); }
    function playbackGoTo(i) {
      if (!E.playback) return;
      E.playback.index = Math.max(0, Math.min(E.playback.steps.length - 1, i));
      const step = E.playback.steps[E.playback.index];
      showJoints(step && step.joints);
      retargetAll();
      staggerStep();
    }
    function playbackExit() { E.playback = null; showJoints([]); retargetAll(); }
    /* Re-run the current step's fly-in: snap its parts back to their exploded
     * start pose so the damped lerp plays again. */
    function playbackReplay() {
      if (!E.playback) return;
      const step = E.playback.steps[E.playback.index];
      if (!step) return;
      const spread = Math.max(E.bounds.w, E.bounds.d, E.bounds.h) * 0.45;
      for (const id of step.partIds) {
        const rec = E.meshes.get(id);
        if (!rec) continue;
        const off = playbackStart(rec.part, spread);
        rec.cur.pos = { x: rec.part.pos.x + off.x, y: rec.part.pos.y + off.y, z: rec.part.pos.z + off.z };
      }
      staggerStep();
    }

    /* ---------------- camera controls ---------------- */
    /* Fit distance for a sphere of `radius`: the tighter of the vertical and
     * horizontal FOV governs, so portrait viewports (aspect < 1) pull back
     * far enough that wide pieces clear the side edges too (A-05). */
    function fitDist(radius, pad) {
      const vHalf = (camera.fov * Math.PI / 180) / 2;
      const hHalf = Math.atan(Math.tan(vHalf) * (viewAspect || 1));
      return radius / Math.tan(Math.min(vHalf, hHalf)) * pad;
    }
    function frame() {
      const b = E.bounds;
      const radius = Math.sqrt(b.w * b.w + b.d * b.d + b.h * b.h) / 2;
      camGoal.dist = Math.min(20000, fitDist(radius, 1.35));
      camGoal.theta = 0.72; camGoal.phi = 1.13;
      tgtGoal.set(0, b.h * 0.45, 0);
      focusRestore = null; // Home is the escape hatch from part framing
      if (E.reducedMotion) { Object.assign(camCur, camGoal); tgtCur.copy(tgtGoal); }
    }
    /* Part framing (interaction design §4b): double-tap isolate and the F key
     * glide the target to the part and fit the distance to it; one stored
     * pose brings the view back when the framing ends. */
    function focusPart(id) {
      const rec = E.meshes.get(id);
      if (!rec) return;
      if (!focusRestore) focusRestore = { target: tgtGoal.clone(), dist: camGoal.dist };
      const t = rec.target;
      const radius = Math.max(60, Math.hypot(t.scale.x, t.scale.y, t.scale.z) / 2);
      tgtGoal.set(t.pos.x, t.pos.y, t.pos.z);
      camGoal.dist = Math.max(300, fitDist(radius, 1.55));
      if (E.reducedMotion) { Object.assign(camCur, camGoal); tgtCur.copy(tgtGoal); }
    }
    function clearFocus() {
      if (!focusRestore) return;
      tgtGoal.copy(focusRestore.target);
      camGoal.dist = focusRestore.dist;
      focusRestore = null;
      if (E.reducedMotion) { Object.assign(camCur, camGoal); tgtCur.copy(tgtGoal); }
    }
    /* The floor never sits above the current goal: part framing may already
     * be closer than the piece-level floor, and a pinch or scroll must not
     * kick that framing outward — it just can't dolly any further in. */
    function dollyFloor() { return Math.min(camGoal.dist, minDolly(E.bounds)); }
    const pointers = new Map();
    let pinchStart = 0, moved = 0, lastTap = 0, downId = null;
    const _ray = new THREE.Raycaster(), _ndc = new THREE.Vector2(), _v1 = new THREE.Vector3();
    const hoverCapable = typeof matchMedia === 'function' && matchMedia('(hover: hover)').matches;
    let hoverPt = null; // latest no-button pointer spot; tick raycasts it at most once per frame
    const flick = { vT: 0, vP: 0, on: false, last: 0 }; // orbit release inertia, rad/s
    let focusRestore = null; // camera pose to return to when part framing ends
    /* Dolly-toward-cursor (interaction design §4a): T' = A + (T − A)·f keeps
     * the world point under the pointer fixed on screen while the distance
     * damps. Anchor = part under the cursor, else the horizontal plane
     * through the camera target. The pivot is clamped near the piece. */
    function dollyShift(cx, cy, f) {
      if (!isFinite(f) || f === 1) return;
      const rect = canvas.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      _ndc.set(((cx - rect.left) / rect.width) * 2 - 1, -((cy - rect.top) / rect.height) * 2 + 1);
      _ray.setFromCamera(_ndc, activeCamera);
      let anchor = null;
      const hits = _ray.intersectObjects(partsGroup.children, false);
      if (hits.length) anchor = hits[0].point;
      else {
        const dy = _ray.ray.direction.y;
        const t = Math.abs(dy) > 1e-6 ? (tgtCur.y - _ray.ray.origin.y) / dy : -1;
        if (t > 0) anchor = _ray.ray.at(t, _v1);
      }
      if (!anchor) return;
      tgtGoal.lerp(anchor, 1 - f);
      tgtCur.lerp(anchor, 1 - f);
      const b = E.bounds, lim = Math.max(b.w, b.d, b.h) * 1.5;
      for (const v of [tgtGoal, tgtCur]) {
        v.x = Math.max(-lim, Math.min(lim, v.x));
        v.z = Math.max(-lim, Math.min(lim, v.z));
        v.y = Math.max(-lim * 0.2, Math.min(b.h + lim * 0.6, v.y));
      }
    }
    /* Joint-dot picking is screen-space: the dots render depth-free, so the
     * honest hit test is distance to their projected centers — and the 28 px
     * tolerance is a thumb-sized target on phones. */
    function pickDotAt(e) {
      const rect = canvas.getBoundingClientRect();
      if (!rect.width || !rect.height) return null;
      const px = e.clientX - rect.left, py = e.clientY - rect.top;
      let best = null, bestD = 28;
      for (const s of jointGroup.children) {
        _v1.copy(s.position).project(activeCamera);
        if (_v1.z > 1) continue; // behind the camera
        const d = Math.hypot((_v1.x + 1) / 2 * rect.width - px, (1 - _v1.y) / 2 * rect.height - py);
        if (d < bestD) { bestD = d; best = s; }
      }
      return best;
    }
    /* Touch double-tap (A-07): a touch tap's pick is HELD briefly instead of
     * dispatched — dispatching immediately opens the part inspector over the
     * canvas, which swallows the second tap on phones. A second tap-up within
     * 250 ms and 24 px converts the pair into one double pick (isolate);
     * otherwise the hold expires and the single pick fires. Pairing compares
     * input timeStamps, so main-thread jank between the taps never breaks a
     * genuine double. Mouse and pen keep the immediate dispatch path. */
    let pendingTap = null;
    function flushTap() {
      if (!pendingTap) return;
      clearTimeout(pendingTap.timer);
      const p = pendingTap;
      pendingTap = null;
      if (opts.onPick) opts.onPick(p.part, { double: false });
    }
    function touchTap(part, e) {
      const up = e.timeStamp || performance.now();
      if (pendingTap && up - pendingTap.up <= 250 &&
          Math.hypot(e.clientX - pendingTap.x, e.clientY - pendingTap.y) <= 24) {
        clearTimeout(pendingTap.timer);
        const held = pendingTap.part;
        pendingTap = null;
        if (opts.onPick) opts.onPick(part || held, { double: true });
        return;
      }
      flushTap(); // an unrelated pending single fires before the new tap arms
      if (!part) { if (opts.onPick) opts.onPick(null, { double: false }); return; }
      pendingTap = { part, x: e.clientX, y: e.clientY, up, timer: setTimeout(flushTap, 300) };
    }
    canvas.addEventListener('pointerdown', e => {
      canvas.setPointerCapture(e.pointerId);
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, b: e.button });
      // A possible second tap is in flight: hold the pending single so the
      // inspector can't open (and swallow it) mid-gesture. Every non-tap
      // outcome ends in flushTap(), so the hold never strands the pick.
      if (pendingTap) clearTimeout(pendingTap.timer);
      moved = 0; downId = e.pointerId;
      flick.on = false; flick.vT = 0; flick.vP = 0; flick.last = performance.now();
      if (pointers.size === 2) {
        const [a, b2] = [...pointers.values()];
        pinchStart = Math.hypot(a.x - b2.x, a.y - b2.y) || 1;
      }
    });
    canvas.addEventListener('pointermove', e => {
      const p = pointers.get(e.pointerId);
      if (!p) {
        // No button down: remember the spot; the tick raycasts it once/frame.
        if (hoverCapable && !pointers.size) hoverPt = { clientX: e.clientX, clientY: e.clientY };
        return;
      }
      const dx = e.clientX - p.x, dy = e.clientY - p.y;
      moved += Math.abs(dx) + Math.abs(dy);
      if (pointers.size === 2) {
        p.x = e.clientX; p.y = e.clientY;
        const [a, b2] = [...pointers.values()];
        const d = Math.hypot(a.x - b2.x, a.y - b2.y) || 1;
        const before = camGoal.dist;
        camGoal.dist = Math.max(dollyFloor(), Math.min(20000, camGoal.dist * (pinchStart / d)));
        dollyShift((a.x + b2.x) / 2, (a.y + b2.y) / 2, camGoal.dist / before); // pinch pivots on its midpoint
        pinchStart = d;
        return;
      }
      p.x = e.clientX; p.y = e.clientY;
      if (p.b === 2 || e.shiftKey) { // pan
        const scale = camCur.dist * 0.0012;
        _v1.subVectors(camera.position, tgtCur).cross(camera.up).normalize();
        tgtCur.addScaledVector(_v1, dx * scale); tgtGoal.addScaledVector(_v1, dx * scale);
        tgtCur.y += dy * scale; tgtGoal.y += dy * scale;
      } else {
        camGoal.theta -= dx * 0.0055;
        camGoal.phi = Math.max(0.12, Math.min(1.52, camGoal.phi - dy * 0.0045));
        // Flick memory: an EMA of the drag's angular velocity, consumed on
        // release as inertia (interaction design §3a).
        const now = performance.now();
        const dts = Math.max(0.008, (now - flick.last) / 1000);
        flick.last = now;
        flick.vT = flick.vT * 0.6 + (-dx * 0.0055 / dts) * 0.4;
        flick.vP = flick.vP * 0.6 + (-dy * 0.0045 / dts) * 0.4;
      }
    });
    function pickAt(e) {
      const rect = canvas.getBoundingClientRect();
      _ndc.set(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -((e.clientY - rect.top) / rect.height) * 2 + 1);
      _ray.setFromCamera(_ndc, activeCamera);
      const hits = _ray.intersectObjects(partsGroup.children, false);
      for (const h of hits) {
        const rec = E.meshes.get(h.object.userData.partId);
        if (rec && rec.bucket !== 'faint' && rec.bucket !== 'hidden') return rec.part;
      }
      return null;
    }
    canvas.addEventListener('pointerup', e => {
      const p = pointers.get(e.pointerId);
      pointers.delete(e.pointerId);
      if (e.pointerId !== downId) return;
      // A real orbit drag still moving at release keeps spinning (inertia).
      if (moved > 24 && !pointers.size && p && p.b !== 2 && !e.shiftKey && !E.reducedMotion
          && performance.now() - flick.last < 90) {
        const cap = 2.2;
        flick.vT = Math.max(-cap, Math.min(cap, flick.vT));
        flick.vP = Math.max(-cap, Math.min(cap, flick.vP));
        if (Math.abs(flick.vT) + Math.abs(flick.vP) > 0.35) flick.on = true;
      }
      if (moved > 8) { flushTap(); return; } // a drag supersedes the pairing window
      if (E.playback) {
        // Step playback: the glowing joint dots are doors to the close-up.
        const dot = pickDotAt(e);
        if (dot && opts.onJointPick) opts.onJointPick(dot.userData.joint);
        return;
      }
      const part = pickAt(e);
      if (e.pointerType === 'touch') { touchTap(part, e); return; }
      const now = performance.now();
      const isDouble = now - lastTap < 350;
      lastTap = now;
      if (opts.onPick) opts.onPick(part, { double: isDouble });
    });
    canvas.addEventListener('pointercancel', e => { pointers.delete(e.pointerId); flushTap(); });
    canvas.addEventListener('pointerleave', () => {
      hoverPt = null;
      E.hovered = null; E.hoverDot = null;
      canvas.style.cursor = '';
    });
    canvas.addEventListener('wheel', e => {
      e.preventDefault();
      const before = camGoal.dist;
      camGoal.dist = Math.max(dollyFloor(), Math.min(20000, camGoal.dist * (1 + e.deltaY * 0.0011)));
      dollyShift(e.clientX, e.clientY, camGoal.dist / before); // zoom pivots on the cursor
    }, { passive: false });
    canvas.addEventListener('contextmenu', e => e.preventDefault());
    canvas.addEventListener('keydown', e => {
      const step = 0.12;
      if (e.key === 'ArrowLeft') { camGoal.theta += step; e.preventDefault(); }
      else if (e.key === 'ArrowRight') { camGoal.theta -= step; e.preventDefault(); }
      else if (e.key === 'ArrowUp') { camGoal.phi = Math.max(0.12, camGoal.phi - step); e.preventDefault(); }
      else if (e.key === 'ArrowDown') { camGoal.phi = Math.min(1.52, camGoal.phi + step); e.preventDefault(); }
      else if (e.key === '+' || e.key === '=') { camGoal.dist = Math.max(dollyFloor(), camGoal.dist * 0.88); e.preventDefault(); }
      else if (e.key === '-') { camGoal.dist = Math.min(20000, camGoal.dist * 1.14); e.preventDefault(); }
      else if (e.key === 'Home') { frame(); e.preventDefault(); }
      else if (e.key.toLowerCase() === 'f' && !e.ctrlKey && !e.metaKey && !e.altKey) {
        // F frames the selected part (keyboard parity with double-tap).
        if (E.selected) focusPart(E.selected); else frame();
        e.preventDefault();
      }
    });

    /* ---------------- frame loop ---------------- */
    const clock = new THREE.Clock();
    let raf = 0;
    function lerpN(a, b, k) { return a + (b - a) * k; }
    function placeCamera() {
      camera.position.set(
        tgtCur.x + camCur.dist * Math.sin(camCur.phi) * Math.sin(camCur.theta),
        tgtCur.y + camCur.dist * Math.cos(camCur.phi),
        tgtCur.z + camCur.dist * Math.sin(camCur.phi) * Math.cos(camCur.theta));
      camera.lookAt(tgtCur);
      if (activeCamera === ortho) {
        ortho.position.copy(camera.position);
        ortho.quaternion.copy(camera.quaternion);
        const halfH = camCur.dist * ORTHO_K, halfW = halfH * viewAspect;
        ortho.left = -halfW; ortho.right = halfW; ortho.top = halfH; ortho.bottom = -halfH;
        ortho.updateProjectionMatrix();
      }
    }
    function tick() {
      if (E.disposed) return;
      raf = requestAnimationFrame(tick);
      const dt = Math.min(0.05, clock.getDelta());
      const k = E.reducedMotion ? 1 : 1 - Math.exp(-dt * 9);
      const kc = E.reducedMotion ? 1 : 1 - Math.exp(-dt * 7);

      for (const rec of E.meshes.values()) {
        const c = rec.cur, t = rec.target;
        if (rec.delay > 0) rec.delay -= dt; // staggered departure holds the pose
        else for (const ax of ['x', 'y', 'z']) {
          c.pos[ax] = lerpN(c.pos[ax], t.pos[ax], k);
          c.scale[ax] = lerpN(c.scale[ax], t.scale[ax], k);
        }
        rec.mesh.position.set(c.pos.x, c.pos.y, c.pos.z);
        rec.mesh.scale.set(Math.max(0.001, c.scale.x), Math.max(0.001, c.scale.y), Math.max(0.001, c.scale.z));
        const bucket = rec.part.id === E.selected && rec.bucket === 'solid' ? 'selected' : rec.bucket;
        const want = E.drafting ? draftMaterialFor(bucket) : materialFor(rec.part.material, rec.part.role, bucket);
        if (rec.mesh.material !== want) rec.mesh.material = want;
        const faintEdge = BUCKETS[bucket] !== undefined && BUCKETS[bucket] < 0.2;
        const hovered = rec.part.id === E.hovered && bucket === 'solid'; // selection wins over hover
        const wantEdge = E.drafting
          ? (bucket === 'selected' || hovered ? draftSelEdge : faintEdge ? draftEdgeFaint : draftEdge)
          : (bucket === 'selected' ? selEdgeMat : hovered ? hoverEdgeMat : faintEdge ? edgeMatFaint : edgeMat);
        if (rec.edge.material !== wantEdge) rec.edge.material = wantEdge;
        rec.mesh.visible = bucket !== 'hidden';
      }

      if (flick.on) { // thrown orbit decays exponentially; any press stops it
        camGoal.theta += flick.vT * dt;
        camGoal.phi = Math.max(0.12, Math.min(1.52, camGoal.phi + flick.vP * dt));
        const decay = Math.exp(-dt * 4);
        flick.vT *= decay; flick.vP *= decay;
        if (Math.abs(flick.vT) + Math.abs(flick.vP) < 0.05) flick.on = false;
      }
      camCur.theta = lerpN(camCur.theta, camGoal.theta, kc);
      camCur.phi = lerpN(camCur.phi, camGoal.phi, kc);
      camCur.dist = lerpN(camCur.dist, camGoal.dist, kc);
      tgtCur.lerp(tgtGoal, kc);
      placeCamera();

      // Selection spotlight: intensities damp toward the multiplier goals.
      const thL = THEMES[curTheme];
      lightMul.cur.hemi = lerpN(lightMul.cur.hemi, lightMul.goal.hemi, kc);
      lightMul.cur.sun = lerpN(lightMul.cur.sun, lightMul.goal.sun, kc);
      lightMul.cur.fill = lerpN(lightMul.cur.fill, lightMul.goal.fill, kc);
      hemi.intensity = thL.hemiI * lightMul.cur.hemi;
      sun.intensity = thL.sunI * lightMul.cur.sun;
      fill.intensity = thL.fillI * lightMul.cur.fill;

      if (hoverPt) { // hover pre-highlight: at most one raycast per frame
        const pt = hoverPt;
        hoverPt = null;
        E.hovered = null; E.hoverDot = null;
        let cursor = '';
        if (E.playback) {
          E.hoverDot = pickDotAt(pt);
          cursor = E.hoverDot ? 'pointer' : '';
        } else {
          const part = pickAt(pt);
          E.hovered = part ? part.id : null;
          cursor = part ? 'pointer' : '';
        }
        canvas.style.cursor = cursor;
      }

      const pulse = 1 + 0.22 * Math.sin(performance.now() * 0.005);
      for (const j of jointGroup.children) {
        // The hovered dot swells past its pulse — "this one opens".
        j.scale.setScalar(j.userData.base * (E.reducedMotion ? 1 : pulse) * (j === E.hoverDot ? 1.45 : 1));
      }

      if (E.needsAnno) { E.needsAnno = false; rebuildAnnotations(); }
      renderer.render(scene, activeCamera);
    }

    function resize() {
      const w = canvas.clientWidth || canvas.parentElement.clientWidth;
      const h = canvas.clientHeight || canvas.parentElement.clientHeight;
      if (!w || !h) return;
      renderer.setSize(w, h, false);
      viewAspect = w / h;
      camera.aspect = viewAspect;
      camera.updateProjectionMatrix();
    }

    /* ---------------- theme & quality ---------------- */
    /* Ink-family colors depend on (theme, drafting) together — one place. */
    function applyInkColors() {
      const th = THEMES[curTheme], dr = DRAFT[curTheme];
      edgeMat.color.set(th.edge); edgeMatFaint.color.set(th.edge); selEdgeMat.color.set(th.edgeSel);
      draftEdge.color.set(dr.ink); draftEdgeFaint.color.set(dr.ink); draftSelEdge.color.set(dr.ink);
      hoverEdgeMat.color.set(th.edgeSel);
      jointMat.color.set(th.joint); // joint dots are action targets: rust, not selection seafoam
      rimColor.set(th.edgeSel); // the rim uniform is shared — every selected material re-inks
      // Flat-tier selected materials carry a plain emissive; re-ink those too
      // (textured keys end '|t' and are rim-driven, so endsWith targets flat).
      for (const [key, m] of matPool) {
        if (key.endsWith('|selected') && m.emissive) m.emissive.copy(rimColor);
      }
      const dim = E.drafting ? dr.dim : th.dim;
      dimLineMat.color.set(dim); tickMat.color.set(dim);
    }
    function setTheme(mode) {
      curTheme = THEMES[mode] ? mode : 'light';
      const th = THEMES[curTheme];
      applyInkColors();
      hemi.color.set(th.hemiSky); hemi.groundColor.set(th.hemiGround); hemi.intensity = th.hemiI;
      sun.intensity = th.sunI; fill.intensity = th.fillI;
      shadowMat.opacity = th.shadowOp;
      applyEnvironment(curTheme);
      E.needsAnno = true; // labels repaint in the new palette
    }
    /* Blueprint mode: paper fills + full-weight ink edges, no ground/shadow —
     * the interactive technical drawing. Lighting is irrelevant (MeshBasic). */
    function setDrafting(on) {
      E.drafting = !!on;
      applyInkColors();
      retargetLights(); // the drawing is unlit — spotlight bows out
      groundGroup.visible = !E.drafting;
      sun.castShadow = E.drafting ? false : quality.shadows;
      E.needsAnno = true;
    }
    function applyQuality() {
      sun.castShadow = quality.shadows && !E.drafting;
      shadowPlane.visible = quality.shadows;
      disc.visible = !quality.shadows;
      // Re-derive every pooled material so the texture mode flips at once —
      // the pool is cleared, then live meshes get fresh materials directly
      // (never a disposed one).
      for (const m of matPool.values()) m.dispose();
      matPool.clear();
      for (const rec of E.meshes.values()) {
        const bucket = rec.part.id === E.selected && rec.bucket === 'solid' ? 'selected' : rec.bucket;
        rec.mesh.material = materialFor(rec.part.material, rec.part.role, bucket);
      }
      for (const g of ghostGroup.children) {
        if (g.userData.part) g.material = materialFor(g.userData.part.material, g.userData.part.role, 'ghost');
      }
    }

    /* Preset views ride the standing damped camera; front/side use an exactly
     * horizontal phi and top looks straight down (offset avoids the up-vector
     * degeneracy). Reduced motion snaps like every other camera move. */
    const VIEWS = {
      front: { theta: 0, phi: Math.PI / 2 },
      side: { theta: Math.PI / 2, phi: Math.PI / 2 },
      top: { theta: 0, phi: 0.02 },
      iso: { theta: 0.72, phi: 1.13 }
    };

    /* ---------------- public API ---------------- */
    const api = {
      setModel, setGhost, frame, focusPart, clearFocus, resize,
      setTheme,
      setQuality(q) { Object.assign(quality, q || {}); applyQuality(); },
      setDrafting,
      getDrafting() { return E.drafting; },
      setProjection(mode) {
        activeCamera = mode === 'ortho' ? ortho : camera;
        placeCamera();
      },
      getProjection() { return activeCamera === ortho ? 'ortho' : 'persp'; },
      setView(name) {
        const v = VIEWS[name];
        if (!v) return;
        camGoal.theta = v.theta; camGoal.phi = v.phi;
        if (E.reducedMotion) { Object.assign(camCur, camGoal); placeCamera(); }
      },
      setExplode(t) { E.explodeT = Math.max(0, Math.min(1, t)); retargetAll(); },
      getExplode() { return E.explodeT; },
      toggleDrawer(i) {
        if (E.openDrawers.has(i)) E.openDrawers.delete(i); else E.openDrawers.add(i);
        retargetAll();
        return E.openDrawers.has(i);
      },
      closeDrawers() { E.openDrawers.clear(); retargetAll(); },
      select(id) { E.selected = id; E.needsAnno = true; retargetLights(); },
      isolate(id) { E.isolated = id; retargetAll(); retargetLights(); },
      getIsolated() { return E.isolated; },
      setDims(on) { E.dimsVisible = !!on; E.needsAnno = true; },
      // Display prefs changed (system/dual): relabel annotations next frame.
      unitsChanged() { E.needsAnno = true; },
      setReducedMotion(v) {
        E.reducedMotion = !!v;
        if (E.reducedMotion) { // decorative layers zero out, not just speed up
          flick.on = false; flick.vT = 0; flick.vP = 0;
          for (const rec of E.meshes.values()) rec.delay = 0;
        }
      },
      playbackEnter, playbackGoTo, playbackExit, playbackReplay,
      inPlayback() { return !!E.playback; },
      /* Screen-space anchors for the playback joint dots (CSS px, canvas-
       * relative), with each dot's joint payload — for DOM affordances that
       * point at a dot, and for driving the click path in tests. */
      jointDotsOnScreen() {
        const rect = canvas.getBoundingClientRect();
        const out = [];
        for (const s of jointGroup.children) {
          _v1.copy(s.position).project(activeCamera);
          if (_v1.z > 1) continue;
          out.push({ x: (_v1.x + 1) / 2 * rect.width, y: (1 - _v1.y) / 2 * rect.height, joint: s.userData.joint });
        }
        return out;
      },
      /* One-shot hero: parts start from their fully exploded playback pose
       * and the standing damped lerp flies them home while the camera sweeps
       * in. Reduced motion makes k = 1 in the tick loop, i.e. an instant
       * snap — no special case needed. */
      heroAssemble() {
        const spread = Math.max(E.bounds.w, E.bounds.d, E.bounds.h) * 0.45;
        let i = 0;
        for (const rec of E.meshes.values()) {
          const off = playbackStart(rec.part, spread);
          rec.cur.pos = { x: rec.part.pos.x + off.x, y: rec.part.pos.y + off.y, z: rec.part.pos.z + off.z };
          // Build-order cascade: legs land before aprons, aprons before tops.
          if (!E.reducedMotion) rec.delay = Math.min(i * 0.03, 0.55);
          i++;
        }
        camCur.theta = camGoal.theta - 0.55;
        camCur.dist = camGoal.dist * 1.3;
      },
      stats() { return { geometries: renderer.info.memory.geometries, textures: renderer.info.memory.textures, meshes: E.meshes.size, materials: matPool.size }; },
      /* Read-only camera snapshot for probes and diagnostics: the damped
       * goal pose plus the current interactive dolly floor (A-06). */
      cameraPose() { return { theta: camGoal.theta, phi: camGoal.phi, dist: camGoal.dist, minDist: minDolly(E.bounds) }; },
      /* Synchronous render + return the canvas — thumbnails read pixels right
       * after this call (the drawing buffer is only valid in the same tick). */
      renderNow() { renderer.render(scene, activeCamera); return canvas; },
      /* Snap every damped value to its target AND apply the transforms right
       * now — callers pair this with renderNow() synchronously (thumbnails),
       * where no tick runs between the calls. */
      snapNow() {
        for (const rec of E.meshes.values()) {
          rec.cur = { pos: { ...rec.target.pos }, scale: { ...rec.target.scale } };
          rec.delay = 0;
          rec.mesh.position.set(rec.cur.pos.x, rec.cur.pos.y, rec.cur.pos.z);
          rec.mesh.scale.set(Math.max(0.001, rec.cur.scale.x), Math.max(0.001, rec.cur.scale.y), Math.max(0.001, rec.cur.scale.z));
        }
        Object.assign(camCur, camGoal);
        tgtCur.copy(tgtGoal);
        placeCamera();
      },
      dispose() {
        E.disposed = true;
        cancelAnimationFrame(raf);
        for (const m of matPool.values()) m.dispose();
        matPool.clear();
        for (const g of Object.values(unitBoxes)) g.dispose();
        unitEdges.dispose();
        unitCyl.dispose(); unitCylEdges.dispose();
        discGeo.dispose(); shadowGeo.dispose(); jointGeo.dispose(); tickGeo.dispose();
        for (const m of [edgeMat, edgeMatFaint, selEdgeMat, hoverEdgeMat, draftEdge, draftEdgeFaint, draftSelEdge, dimLineMat, tickMat, discMat, shadowMat, jointMat]) m.dispose();
        for (const m of draftMats.values()) m.dispose();
        draftMats.clear();
        blobTex.dispose();
        if (envRT) envRT.dispose();
        for (const t of labelTextures.splice(0)) t.dispose();
        // Deliberately NOT BB.Materials.disposeAll(): the species texture
        // cache is app-lifetime and shared with other engine instances.
        renderer.dispose();
      }
    };
    applyEnvironment(curTheme);
    applyQuality();
    resize(); // before frame(): the fit needs the real viewport aspect
    frame();
    Object.assign(camCur, camGoal);
    tgtCur.copy(tgtGoal);
    tick();
    return api;
  }

  BB.Engine = { create, minDolly };
})();
