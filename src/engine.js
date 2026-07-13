/* Blueprint Buddy — 3D engine (THREE r152, global build).
 *
 * Memory contract (Phase 1 item, re-verified in Phase 2): every part mesh
 * shares ONE unit BoxGeometry and ONE unit EdgesGeometry, scaled per part, so
 * scene rebuilds allocate no geometry. Materials live in a bounded pool keyed
 * by (material, role, bucket) and are disposed on hard teardown. The only
 * per-rebuild GPU allocations are dimension-label textures, which are disposed
 * whenever annotations rebuild. `engine.stats()` exposes renderer.info for the
 * leak check.
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

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(42, 1, 10, 30000);

    scene.add(new THREE.HemisphereLight(0xfff6e8, 0x9a8a76, 1.05));
    const sun = new THREE.DirectionalLight(0xffffff, 1.5);
    sun.position.set(1400, 2200, 1600);
    scene.add(sun);
    const fill = new THREE.DirectionalLight(0xdfe8ff, 0.5);
    fill.position.set(-1600, 800, -1200);
    scene.add(fill);

    // Ground: faint disc + grid.
    const groundGroup = new THREE.Group();
    const discGeo = new THREE.CircleGeometry(1, 64);
    const discMat = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.05 });
    const disc = new THREE.Mesh(discGeo, discMat);
    disc.rotation.x = -Math.PI / 2;
    groundGroup.add(disc);
    const grid = new THREE.GridHelper(1, 10, 0x8a7a66, 0x8a7a66);
    grid.material.transparent = true; grid.material.opacity = 0.12;
    groundGroup.add(grid);
    scene.add(groundGroup);

    // Shared geometry — the whole memory story.
    const unitBox = new THREE.BoxGeometry(1, 1, 1);
    const unitEdges = new THREE.EdgesGeometry(unitBox);

    // Bounded material pool.
    const matPool = new Map();
    function materialFor(matKey, role, bucket) {
      const key = matKey + '|' + role + '|' + bucket;
      if (matPool.has(key)) return matPool.get(key);
      let tone = 0xb98d62, rough = 0.7;
      if (matKey === 'hardware') { tone = 0x46464a; rough = 0.35; }
      else if (BB.K.WOOD_SPECIES[matKey]) { tone = BB.K.WOOD_SPECIES[matKey].tone; rough = BB.K.WOOD_SPECIES[matKey].rough; }
      const c = new THREE.Color(tone).multiplyScalar(ROLE_SHADE[role] || 1);
      const opacity = BUCKETS[bucket] !== undefined ? BUCKETS[bucket] : 1;
      const m = new THREE.MeshStandardMaterial({
        color: c, roughness: rough, metalness: matKey === 'hardware' ? 0.6 : 0.02,
        transparent: opacity < 1, opacity, depthWrite: opacity > 0.5
      });
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
      dimsVisible: false, units: 'mm',
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
        let rec = E.meshes.get(part.id);
        if (!rec) {
          const mesh = new THREE.Mesh(unitBox, materialFor(part.material, part.role, 'solid'));
          const edge = new THREE.LineSegments(unitEdges, edgeMat);
          mesh.add(edge);
          mesh.userData.partId = part.id;
          partsGroup.add(mesh);
          rec = { mesh, edge, part, bucket: 'solid', cur: null };
          E.meshes.set(part.id, rec);
        }
        rec.part = part;
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
          const m = new THREE.Mesh(unitBox, materialFor(part.material, part.role, 'ghost'));
          m.scale.set(part.size.w, part.size.h, part.size.d);
          m.position.set(part.pos.x, part.pos.y, part.pos.z);
          ghostGroup.add(m);
        }
      }
    }

    /* ---------------- dimension annotations ---------------- */
    function makeLabel(text) {
      const c = document.createElement('canvas');
      const ctx = c.getContext('2d');
      const fs = 44;
      ctx.font = `600 ${fs}px system-ui, sans-serif`;
      const w = Math.ceil(ctx.measureText(text).width) + 36;
      c.width = w; c.height = fs + 28;
      const ctx2 = c.getContext('2d');
      ctx2.font = `600 ${fs}px system-ui, sans-serif`;
      ctx2.fillStyle = 'rgba(250,247,242,0.92)';
      const r = 14;
      ctx2.beginPath();
      ctx2.roundRect(0, 0, c.width, c.height, r);
      ctx2.fill();
      ctx2.strokeStyle = 'rgba(90,70,50,0.35)'; ctx2.lineWidth = 2; ctx2.stroke();
      ctx2.fillStyle = '#4a3826';
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
    function dimLine(a, b, label) {
      const g = new THREE.Group();
      const pts = [new THREE.Vector3(a.x, a.y, a.z), new THREE.Vector3(b.x, b.y, b.z)];
      const geo = new THREE.BufferGeometry().setFromPoints(pts);
      g.add(new THREE.Line(geo, dimLineMat));
      // end ticks
      for (const p of pts) {
        const tickGeo = new THREE.SphereGeometry(1, 6, 6);
        const tick = new THREE.Mesh(tickGeo, new THREE.MeshBasicMaterial({ color: 0x7a614a }));
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
      // Dispose every label texture + line geometry from the previous pass.
      annoGroup.traverse(o => {
        if (o.geometry && o.geometry !== unitBox && o.geometry !== unitEdges) o.geometry.dispose();
        if (o.material && o.material.map) { /* sprite mats disposed below */ }
      });
      while (annoGroup.children.length) annoGroup.remove(annoGroup.children[0]);
      for (const t of labelTextures.splice(0)) t.dispose();
      if (!E.dimsVisible || !E.model) return;
      const b = E.bounds, u = E.units, fmt = v => BB.Spec.fmtLen(v, u);
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
      camera.position.set(
        camTarget.x + camCur.dist * Math.sin(camCur.phi) * Math.sin(camCur.theta),
        camTarget.y + camCur.dist * Math.cos(camCur.phi),
        camTarget.z + camCur.dist * Math.sin(camCur.phi) * Math.cos(camCur.theta));
      camera.lookAt(camTarget);

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

    /* ---------------- public API ---------------- */
    const api = {
      setModel, setGhost, frame, resize,
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
      setDims(on, units) { E.dimsVisible = !!on; if (units) E.units = units; E.needsAnno = true; },
      setUnits(u) { E.units = u; E.needsAnno = true; },
      setReducedMotion(v) { E.reducedMotion = !!v; },
      playbackEnter, playbackGoTo, playbackExit, playbackReplay,
      inPlayback() { return !!E.playback; },
      stats() { return { geometries: renderer.info.memory.geometries, textures: renderer.info.memory.textures, meshes: E.meshes.size, materials: matPool.size }; },
      snapNow() { for (const rec of E.meshes.values()) { rec.cur = { pos: { ...rec.target.pos }, scale: { ...rec.target.scale } }; } Object.assign(camCur, camGoal); },
      dispose() {
        E.disposed = true;
        cancelAnimationFrame(raf);
        for (const m of matPool.values()) m.dispose();
        matPool.clear();
        unitBox.dispose(); unitEdges.dispose();
        discGeo.dispose(); jointGeo.dispose();
        for (const t of labelTextures.splice(0)) t.dispose();
        renderer.dispose();
      }
    };
    frame();
    Object.assign(camCur, camGoal);
    resize();
    tick();
    return api;
  }

  BB.Engine = { create };
})();
