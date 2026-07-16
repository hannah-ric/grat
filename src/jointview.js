/* Blueprint Buddy — Joint Inspector viewport (Phase 5).
 * A transient THREE scene in the joint modal: builds real geometry from
 * BB.Joinery3D piece data, species-tinted, with an assemble slider along the
 * joint's insert axis and a cutaway section toggle (clipping plane).
 *
 * Lifecycle contract: the renderer is a lazy per-session singleton (contexts
 * are expensive); geometries and materials are created per open() and
 * disposed per close(). The render loop watches the scrim and self-disposes
 * if the modal was closed by any path (Escape, backdrop, button).
 */
var BB = globalThis.BB = globalThis.BB || {};

(function () {
  'use strict';

  let renderer = null, canvas = null;
  let live = null; // { scene, camera, group, groupA, disposables, raf, cam, clip, spread }

  function ensureRenderer() {
    const THREE = globalThis.THREE;
    if (renderer) return;
    canvas = document.getElementById('jointCanvas');
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(2, globalThis.devicePixelRatio || 1));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.localClippingEnabled = true;
  }

  /* Convex profile prism (dovetail tails/pins): flat-shaded, non-indexed. */
  function prismGeometry(THREE, profile, z0, depth) {
    const n = profile.length;
    const tris = [];
    const at = (i, z) => [profile[i][0], profile[i][1], z];
    for (let i = 1; i < n - 1; i++) { // front fan (+z)
      tris.push(at(0, z0 + depth), at(i, z0 + depth), at(i + 1, z0 + depth));
    }
    for (let i = 1; i < n - 1; i++) { // back fan (reversed)
      tris.push(at(0, z0), at(i + 1, z0), at(i, z0));
    }
    for (let i = 0; i < n; i++) {     // side quads
      const j = (i + 1) % n;
      tris.push(at(i, z0), at(j, z0), at(j, z0 + depth));
      tris.push(at(i, z0), at(j, z0 + depth), at(i, z0 + depth));
    }
    const pos = new Float32Array(tris.flat());
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.computeVertexNormals();
    return g;
  }

  function open(type, partA, partB, opts) {
    const THREE = globalThis.THREE;
    opts = opts || {};
    ensureRenderer();
    close(); // dispose any previous scene

    const fmt = opts.fmt || (v => Math.round(v) + ' mm');
    const data = BB.Joinery3D.buildJoint(type, partA, partB, fmt);

    const scene = new THREE.Scene();
    scene.add(new THREE.HemisphereLight(0xfff6e8, 0x8a7a66, 1.0));
    const sun = new THREE.DirectionalLight(0xffffff, 1.3);
    sun.position.set(300, 500, 400);
    scene.add(sun);
    const fill = new THREE.DirectionalLight(0xf0e6d2, 0.4);
    fill.position.set(-400, 200, -300);
    scene.add(fill);

    const camera = new THREE.PerspectiveCamera(38, 1, 1, 10000);
    const disposables = [];
    const clip = new THREE.Plane(new THREE.Vector3(0, 0, -1), 0);

    // Species-tinted member materials: inserted member reads lighter than
    // the housing so the mechanism is legible; fasteners are steel.
    const toneOf = p => (BB.K.WOOD_SPECIES[p.material] || {}).tone || 0xb98d62;
    const roughOf = p => (BB.K.WOOD_SPECIES[p.material] || {}).rough || 0.7;
    const mats = {
      a: new THREE.MeshStandardMaterial({ color: new THREE.Color(toneOf(partA)).multiplyScalar(1.08), roughness: roughOf(partA), metalness: 0.02, side: THREE.DoubleSide }),
      b: new THREE.MeshStandardMaterial({ color: new THREE.Color(toneOf(partB)).multiplyScalar(0.82), roughness: roughOf(partB), metalness: 0.02, side: THREE.DoubleSide }),
      fastener: new THREE.MeshStandardMaterial({ color: 0x8a8a90, roughness: 0.35, metalness: 0.6, side: THREE.DoubleSide })
    };
    const edgeMat = new THREE.LineBasicMaterial({ color: 0x2a2018, transparent: true, opacity: 0.34 });
    disposables.push(mats.a, mats.b, mats.fastener, edgeMat);

    const group = new THREE.Group();   // whole joint
    const groupA = new THREE.Group();  // inserted member — the explode rider
    group.add(groupA);
    scene.add(group);

    const up = new THREE.Vector3(0, 1, 0);
    for (const piece of data.pieces) {
      let geo;
      if (piece.kind === 'cuboid') {
        geo = new THREE.BoxGeometry(piece.e[0] * 2, piece.e[1] * 2, piece.e[2] * 2);
      } else if (piece.kind === 'cylinder') {
        geo = new THREE.CylinderGeometry(piece.r, piece.r, piece.len, 16);
      } else {
        geo = prismGeometry(THREE, piece.profile, piece.z0, piece.depth);
      }
      const mesh = new THREE.Mesh(geo, mats[piece.member] || mats.a);
      if (piece.kind === 'cuboid') mesh.position.set(piece.c[0], piece.c[1], piece.c[2]);
      if (piece.kind === 'cylinder') {
        mesh.position.set(piece.c[0], piece.c[1], piece.c[2]);
        mesh.quaternion.setFromUnitVectors(up, new THREE.Vector3(...piece.axis).normalize());
      }
      const edgeGeo = new THREE.EdgesGeometry(geo, 25);
      mesh.add(new THREE.LineSegments(edgeGeo, edgeMat));
      disposables.push(geo, edgeGeo);
      (piece.member === 'a' ? groupA : group).add(mesh);
    }

    // Frame the joint; section plane sits at the scene's z-center.
    const box = new THREE.Box3().setFromObject(group);
    const center = box.getCenter(new THREE.Vector3());
    const sphere = box.getBoundingSphere(new THREE.Sphere());
    clip.constant = center.z;
    const cam = {
      theta: 0.7, phi: 1.15,
      dist: sphere.radius / Math.tan(19 * Math.PI / 180) * 1.25,
      goalTheta: 0.7, goalPhi: 1.15, goalDist: 0
    };
    cam.goalDist = cam.dist;
    const spread = Math.max(60, sphere.radius * 0.9);

    live = {
      scene, camera, group, groupA, disposables, raf: 0, cam, clip, center,
      insertAxis: data.insertAxis, spread, explodeT: 0, cutaway: false,
      reduced: !!opts.reducedMotion
    };

    const scrim = document.getElementById('jointScrim');
    const clock = new THREE.Clock();
    function tick() {
      if (!live) return;
      if (!scrim.classList.contains('open')) { close(); return; } // self-dispose
      live.raf = requestAnimationFrame(tick);
      const dt = Math.min(0.05, clock.getDelta());
      const k = live.reduced ? 1 : 1 - Math.exp(-dt * 9);
      const c = live.cam;
      c.theta += (c.goalTheta - c.theta) * k;
      c.phi += (c.goalPhi - c.phi) * k;
      c.dist += (c.goalDist - c.dist) * k;
      camera.position.set(
        center.x + c.dist * Math.sin(c.phi) * Math.sin(c.theta),
        center.y + c.dist * Math.cos(c.phi),
        center.z + c.dist * Math.sin(c.phi) * Math.cos(c.theta));
      camera.lookAt(center);
      const w = canvas.clientWidth, h = canvas.clientHeight;
      if (w && h) {
        renderer.setSize(w, h, false);
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
      }
      const off = live.explodeT * live.spread;
      groupA.position.set(data.insertAxis[0] * off, data.insertAxis[1] * off, data.insertAxis[2] * off);
      renderer.render(scene, camera);
    }
    tick();
    return data; // title + labels for the caption
  }

  /* Pointer orbit + wheel zoom on the joint canvas (bound once). */
  let bound = false;
  function bindControls() {
    if (bound) return;
    bound = true;
    const c = document.getElementById('jointCanvas');
    let drag = null;
    c.addEventListener('pointerdown', e => { c.setPointerCapture(e.pointerId); drag = { x: e.clientX, y: e.clientY }; });
    c.addEventListener('pointermove', e => {
      if (!drag || !live) return;
      live.cam.goalTheta -= (e.clientX - drag.x) * 0.0055;
      live.cam.goalPhi = Math.max(0.15, Math.min(1.5, live.cam.goalPhi - (e.clientY - drag.y) * 0.0045));
      drag = { x: e.clientX, y: e.clientY };
    });
    c.addEventListener('pointerup', () => { drag = null; });
    c.addEventListener('pointercancel', () => { drag = null; });
    c.addEventListener('wheel', e => {
      if (!live) return;
      e.preventDefault();
      live.cam.goalDist = Math.max(80, Math.min(4000, live.cam.goalDist * (1 + e.deltaY * 0.0011)));
    }, { passive: false });
  }

  function setExplode(t) { if (live) live.explodeT = Math.max(0, Math.min(1, t)); }
  function setCutaway(on) {
    if (!live) return;
    live.cutaway = !!on;
    const planes = on ? [live.clip] : [];
    live.scene.traverse(o => {
      if (o.isMesh && o.material) o.material.clippingPlanes = planes;
    });
  }
  function setReducedMotion(v) { if (live) live.reduced = !!v; }

  function close() {
    if (!live) return;
    cancelAnimationFrame(live.raf);
    for (const d of live.disposables) d.dispose();
    live = null;
  }

  BB.JointView = { open, close, setExplode, setCutaway, setReducedMotion, bindControls, _live: () => live };
})();
