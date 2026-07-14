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
 * drawer travel, explosion, camera. Reduced motion snaps all of it.
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

    /* Everything a theme touches in-scene, in one table. Wood stays wood in
     * both themes; what changes is ink, labels, bounce light, and shadows. */
    const THEMES = {
      light: {
        edge: 0x2a2018, edgeSel: 0x2f7fae, dim: 0x7a614a,
        hemiSky: 0xfff6e8, hemiGround: 0x9a8a76, hemiI: 0.8, sunI: 1.25, fillI: 0.45, shadowOp: 0.2,
        label: { bg: 'rgba(250,247,242,0.92)', stroke: 'rgba(90,70,50,0.35)', ink: '#4a3826' }
      },
      dark: {
        edge: 0xefe2cc, edgeSel: 0x6fb0d6, dim: 0xcbb695,
        hemiSky: 0xcabfa8, hemiGround: 0x2e2921, hemiI: 0.7, sunI: 1.1, fillI: 0.35, shadowOp: 0.3,
        label: { bg: 'rgba(30,26,20,0.92)', stroke: 'rgba(210,190,160,0.35)', ink: '#ede5d6' }
      }
    };

    const hemi = new THREE.HemisphereLight(0xfff6e8, 0x9a8a76, 0.85);
    scene.add(hemi);
    const sun = new THREE.DirectionalLight(0xffffff, 1.35);
    sun.position.set(1400, 2200, 1600);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    scene.add(sun);
    const fill = new THREE.DirectionalLight(0xdfe8ff, 0.45);
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
      if (bucket === 'selected') { m.emissive = new THREE.Color(0x2f7fae); m.emissiveIntensity = 0.3; }
      matPool.set(key, m);
      return m;
    }
    const edgeMat = new THREE.LineBasicMaterial({ color: 0x2a2018, transparent: true, opacity: 0.28 });
    const edgeMatFaint = new THREE.LineBasicMaterial({ color: 0x2a2018, transparent: true, opacity: 0.05 });
    const selEdgeMat = new THREE.LineBasicMaterial({ color: 0x2f7fae, transparent: true, opacity: 0.95 });

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
      dimsVisible: false,
      playback: null,         // {steps, index}
      reducedMotion: !!opts.reducedMotion,
      bounds: { w: 1500, d: 850, h: 750 },
      needsAnno: false,
      disposed: false
    };
    let camTarget = new THREE.Vector3(0, 400, 0);
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
          rec = { mesh, edge, part, bucket: 'solid', cur: null, geoKey };
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
      camTarget.set(0, model.bounds.h * 0.45, 0);
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
      const pal = THEMES[curTheme].label;
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
    const jointMat = new THREE.MeshBasicMaterial({ color: 0x2f7fae, transparent: true, opacity: 0.55, depthTest: false });
    function showJoints(joints) {
      while (jointGroup.children.length) jointGroup.remove(jointGroup.children[0]);
      for (const j of joints || []) {
        const s = new THREE.Mesh(jointGeo, jointMat);
        s.position.set(j.pos.x, j.pos.y, j.pos.z);
        s.renderOrder = 9;
        s.userData.base = Math.max(E.bounds.w, E.bounds.h) * 0.016 + 8;
        jointGroup.add(s);
      }
    }

    /* ---------------- playback ---------------- */
    function playbackEnter(steps) { E.playback = { steps, index: 0 }; showJoints(steps[0] && steps[0].joints); retargetAll(); }
    function playbackGoTo(i) {
      if (!E.playback) return;
      E.playback.index = Math.max(0, Math.min(E.playback.steps.length - 1, i));
      const step = E.playback.steps[E.playback.index];
      showJoints(step && step.joints);
      retargetAll();
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
    }

    /* ---------------- camera controls ---------------- */
    function frame() {
      const b = E.bounds;
      const radius = Math.sqrt(b.w * b.w + b.d * b.d + b.h * b.h) / 2;
      camGoal.dist = radius / Math.tan((camera.fov * Math.PI / 180) / 2) * 1.35;
      camGoal.theta = 0.72; camGoal.phi = 1.13;
      camTarget.set(0, b.h * 0.45, 0);
      if (E.reducedMotion) Object.assign(camCur, camGoal);
    }
    const pointers = new Map();
    let pinchStart = 0, moved = 0, lastTap = 0, downId = null;
    canvas.addEventListener('pointerdown', e => {
      canvas.setPointerCapture(e.pointerId);
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, b: e.button });
      moved = 0; downId = e.pointerId;
      if (pointers.size === 2) {
        const [a, b2] = [...pointers.values()];
        pinchStart = Math.hypot(a.x - b2.x, a.y - b2.y) || 1;
      }
    });
    canvas.addEventListener('pointermove', e => {
      const p = pointers.get(e.pointerId);
      if (!p) return;
      const dx = e.clientX - p.x, dy = e.clientY - p.y;
      moved += Math.abs(dx) + Math.abs(dy);
      if (pointers.size === 2) {
        p.x = e.clientX; p.y = e.clientY;
        const [a, b2] = [...pointers.values()];
        const d = Math.hypot(a.x - b2.x, a.y - b2.y) || 1;
        camGoal.dist *= pinchStart / d;
        camGoal.dist = Math.max(300, Math.min(20000, camGoal.dist));
        pinchStart = d;
        return;
      }
      p.x = e.clientX; p.y = e.clientY;
      if (p.b === 2 || e.shiftKey) { // pan
        const scale = camCur.dist * 0.0012;
        const right = new THREE.Vector3().subVectors(camera.position, camTarget).cross(camera.up).normalize();
        camTarget.addScaledVector(right, dx * scale);
        camTarget.y += dy * scale;
      } else {
        camGoal.theta -= dx * 0.0055;
        camGoal.phi = Math.max(0.12, Math.min(1.52, camGoal.phi - dy * 0.0045));
      }
    });
    function pickAt(e) {
      const rect = canvas.getBoundingClientRect();
      const ndc = new THREE.Vector2(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -((e.clientY - rect.top) / rect.height) * 2 + 1);
      const ray = new THREE.Raycaster();
      ray.setFromCamera(ndc, camera);
      const hits = ray.intersectObjects(partsGroup.children, false);
      for (const h of hits) {
        const rec = E.meshes.get(h.object.userData.partId);
        if (rec && rec.bucket !== 'faint' && rec.bucket !== 'hidden') return rec.part;
      }
      return null;
    }
    canvas.addEventListener('pointerup', e => {
      pointers.delete(e.pointerId);
      if (e.pointerId !== downId || moved > 8 || E.playback) return;
      const part = pickAt(e);
      const now = performance.now();
      const isDouble = now - lastTap < 350;
      lastTap = now;
      if (opts.onPick) opts.onPick(part, { double: isDouble });
    });
    canvas.addEventListener('pointercancel', e => pointers.delete(e.pointerId));
    canvas.addEventListener('wheel', e => {
      e.preventDefault();
      camGoal.dist = Math.max(300, Math.min(20000, camGoal.dist * (1 + e.deltaY * 0.0011)));
    }, { passive: false });
    canvas.addEventListener('contextmenu', e => e.preventDefault());
    canvas.addEventListener('keydown', e => {
      const step = 0.12;
      if (e.key === 'ArrowLeft') { camGoal.theta += step; e.preventDefault(); }
      else if (e.key === 'ArrowRight') { camGoal.theta -= step; e.preventDefault(); }
      else if (e.key === 'ArrowUp') { camGoal.phi = Math.max(0.12, camGoal.phi - step); e.preventDefault(); }
      else if (e.key === 'ArrowDown') { camGoal.phi = Math.min(1.52, camGoal.phi + step); e.preventDefault(); }
      else if (e.key === '+' || e.key === '=') { camGoal.dist = Math.max(300, camGoal.dist * 0.88); e.preventDefault(); }
      else if (e.key === '-') { camGoal.dist = Math.min(20000, camGoal.dist * 1.14); e.preventDefault(); }
      else if (e.key === 'Home') { frame(); e.preventDefault(); }
    });

    /* ---------------- frame loop ---------------- */
    const clock = new THREE.Clock();
    let raf = 0;
    function lerpN(a, b, k) { return a + (b - a) * k; }
    function placeCamera() {
      camera.position.set(
        camTarget.x + camCur.dist * Math.sin(camCur.phi) * Math.sin(camCur.theta),
        camTarget.y + camCur.dist * Math.cos(camCur.phi),
        camTarget.z + camCur.dist * Math.sin(camCur.phi) * Math.cos(camCur.theta));
      camera.lookAt(camTarget);
    }
    function tick() {
      if (E.disposed) return;
      raf = requestAnimationFrame(tick);
      const dt = Math.min(0.05, clock.getDelta());
      const k = E.reducedMotion ? 1 : 1 - Math.exp(-dt * 9);
      const kc = E.reducedMotion ? 1 : 1 - Math.exp(-dt * 7);

      for (const rec of E.meshes.values()) {
        const c = rec.cur, t = rec.target;
        for (const ax of ['x', 'y', 'z']) {
          c.pos[ax] = lerpN(c.pos[ax], t.pos[ax], k);
          c.scale[ax] = lerpN(c.scale[ax], t.scale[ax], k);
        }
        rec.mesh.position.set(c.pos.x, c.pos.y, c.pos.z);
        rec.mesh.scale.set(Math.max(0.001, c.scale.x), Math.max(0.001, c.scale.y), Math.max(0.001, c.scale.z));
        const bucket = rec.part.id === E.selected && rec.bucket === 'solid' ? 'selected' : rec.bucket;
        const want = materialFor(rec.part.material, rec.part.role, bucket);
        if (rec.mesh.material !== want) rec.mesh.material = want;
        const wantEdge = bucket === 'selected' ? selEdgeMat : (BUCKETS[bucket] !== undefined && BUCKETS[bucket] < 0.2 ? edgeMatFaint : edgeMat);
        if (rec.edge.material !== wantEdge) rec.edge.material = wantEdge;
        rec.mesh.visible = bucket !== 'hidden';
      }

      camCur.theta = lerpN(camCur.theta, camGoal.theta, kc);
      camCur.phi = lerpN(camCur.phi, camGoal.phi, kc);
      camCur.dist = lerpN(camCur.dist, camGoal.dist, kc);
      placeCamera();

      const pulse = 1 + 0.22 * Math.sin(performance.now() * 0.005);
      for (const j of jointGroup.children) j.scale.setScalar(j.userData.base * (E.reducedMotion ? 1 : pulse));

      if (E.needsAnno) { E.needsAnno = false; rebuildAnnotations(); }
      renderer.render(scene, camera);
    }

    function resize() {
      const w = canvas.clientWidth || canvas.parentElement.clientWidth;
      const h = canvas.clientHeight || canvas.parentElement.clientHeight;
      if (!w || !h) return;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    }

    /* ---------------- theme & quality ---------------- */
    function setTheme(mode) {
      curTheme = THEMES[mode] ? mode : 'light';
      const th = THEMES[curTheme];
      edgeMat.color.set(th.edge); edgeMatFaint.color.set(th.edge); selEdgeMat.color.set(th.edgeSel);
      dimLineMat.color.set(th.dim); tickMat.color.set(th.dim);
      hemi.color.set(th.hemiSky); hemi.groundColor.set(th.hemiGround); hemi.intensity = th.hemiI;
      sun.intensity = th.sunI; fill.intensity = th.fillI;
      shadowMat.opacity = th.shadowOp;
      applyEnvironment(curTheme);
      E.needsAnno = true; // labels repaint in the new palette
    }
    function applyQuality() {
      sun.castShadow = quality.shadows;
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

    /* ---------------- public API ---------------- */
    const api = {
      setModel, setGhost, frame, resize,
      setTheme,
      setQuality(q) { Object.assign(quality, q || {}); applyQuality(); },
      setExplode(t) { E.explodeT = Math.max(0, Math.min(1, t)); retargetAll(); },
      getExplode() { return E.explodeT; },
      toggleDrawer(i) {
        if (E.openDrawers.has(i)) E.openDrawers.delete(i); else E.openDrawers.add(i);
        retargetAll();
        return E.openDrawers.has(i);
      },
      closeDrawers() { E.openDrawers.clear(); retargetAll(); },
      select(id) { E.selected = id; E.needsAnno = true; },
      isolate(id) { E.isolated = id; retargetAll(); },
      getIsolated() { return E.isolated; },
      setDims(on) { E.dimsVisible = !!on; E.needsAnno = true; },
      // Display prefs changed (system/dual): relabel annotations next frame.
      unitsChanged() { E.needsAnno = true; },
      setReducedMotion(v) { E.reducedMotion = !!v; },
      playbackEnter, playbackGoTo, playbackExit, playbackReplay,
      inPlayback() { return !!E.playback; },
      /* One-shot hero: parts start from their fully exploded playback pose
       * and the standing damped lerp flies them home while the camera sweeps
       * in. Reduced motion makes k = 1 in the tick loop, i.e. an instant
       * snap — no special case needed. */
      heroAssemble() {
        const spread = Math.max(E.bounds.w, E.bounds.d, E.bounds.h) * 0.45;
        for (const rec of E.meshes.values()) {
          const off = playbackStart(rec.part, spread);
          rec.cur.pos = { x: rec.part.pos.x + off.x, y: rec.part.pos.y + off.y, z: rec.part.pos.z + off.z };
        }
        camCur.theta = camGoal.theta - 0.55;
        camCur.dist = camGoal.dist * 1.3;
      },
      stats() { return { geometries: renderer.info.memory.geometries, textures: renderer.info.memory.textures, meshes: E.meshes.size, materials: matPool.size }; },
      /* Synchronous render + return the canvas — thumbnails read pixels right
       * after this call (the drawing buffer is only valid in the same tick). */
      renderNow() { renderer.render(scene, camera); return canvas; },
      /* Snap every damped value to its target AND apply the transforms right
       * now — callers pair this with renderNow() synchronously (thumbnails),
       * where no tick runs between the calls. */
      snapNow() {
        for (const rec of E.meshes.values()) {
          rec.cur = { pos: { ...rec.target.pos }, scale: { ...rec.target.scale } };
          rec.mesh.position.set(rec.cur.pos.x, rec.cur.pos.y, rec.cur.pos.z);
          rec.mesh.scale.set(Math.max(0.001, rec.cur.scale.x), Math.max(0.001, rec.cur.scale.y), Math.max(0.001, rec.cur.scale.z));
        }
        Object.assign(camCur, camGoal);
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
        for (const m of [edgeMat, edgeMatFaint, selEdgeMat, dimLineMat, tickMat, discMat, shadowMat, jointMat]) m.dispose();
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
    frame();
    Object.assign(camCur, camGoal);
    resize();
    tick();
    return api;
  }

  BB.Engine = { create };
})();
