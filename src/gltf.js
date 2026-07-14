/* Blueprint Buddy — glTF 2.0 binary (.glb) exporter (Phase 5).
 * Hand-written like the COLLADA exporter: zero dependencies, one binary
 * buffer, box geometry deduplicated by exact size, real 16-gon prisms for
 * cylinder primitives, one PBR material per role in use (same palette as the
 * other exporters, converted sRGB → linear as the spec requires).
 *
 * INTENTIONALLY unit-exempt like DAE/Ruby: glTF is metres, so raw scene
 * millimetres × 0.001 — display units never touch exports. glTF is Y-up like
 * the scene, so positions pass straight through, and part rotation rides
 * along as a quaternion (Shepperd's method over BB.Geo.rotMat) — the
 * rotation support the older exporters lacked.
 */
var BB = globalThis.BB = globalThis.BB || {};

(function () {
  'use strict';

  const MM = 0.001; // scene mm -> glTF metres

  /* sRGB channel (0..255) -> linear 0..1 (exact piecewise EOTF). */
  function srgbToLinear(c) {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  }

  /* Rotation matrix (BB.Geo.rotMat row-major 3×3) -> unit quaternion
   * [x, y, z, w], Shepperd's method: pick the dominant diagonal branch for
   * numerical stability. */
  function mat3ToQuat(M) {
    const m00 = M[0][0], m01 = M[0][1], m02 = M[0][2];
    const m10 = M[1][0], m11 = M[1][1], m12 = M[1][2];
    const m20 = M[2][0], m21 = M[2][1], m22 = M[2][2];
    const tr = m00 + m11 + m22;
    let x, y, z, w;
    if (tr > 0) {
      const s = Math.sqrt(tr + 1) * 2;
      w = s / 4; x = (m21 - m12) / s; y = (m02 - m20) / s; z = (m10 - m01) / s;
    } else if (m00 > m11 && m00 > m22) {
      const s = Math.sqrt(1 + m00 - m11 - m22) * 2;
      w = (m21 - m12) / s; x = s / 4; y = (m01 + m10) / s; z = (m02 + m20) / s;
    } else if (m11 > m22) {
      const s = Math.sqrt(1 + m11 - m00 - m22) * 2;
      w = (m02 - m20) / s; x = (m01 + m10) / s; y = s / 4; z = (m12 + m21) / s;
    } else {
      const s = Math.sqrt(1 + m22 - m00 - m11) * 2;
      w = (m10 - m01) / s; x = (m02 + m20) / s; y = (m12 + m21) / s; z = s / 4;
    }
    const len = Math.hypot(x, y, z, w) || 1;
    return [x / len, y / len, z / len, w / len];
  }

  /* Box mesh data in local metres: 24 verts (per-face normals), 36 indices.
   * Local axes match the scene: x = w, y = h, z = d, centered at origin. */
  function boxData(w, h, d) {
    const hx = w * MM / 2, hy = h * MM / 2, hz = d * MM / 2;
    const faces = [
      { n: [1, 0, 0], c: [[hx, -hy, -hz], [hx, hy, -hz], [hx, hy, hz], [hx, -hy, hz]] },
      { n: [-1, 0, 0], c: [[-hx, -hy, hz], [-hx, hy, hz], [-hx, hy, -hz], [-hx, -hy, -hz]] },
      { n: [0, 1, 0], c: [[-hx, hy, -hz], [-hx, hy, hz], [hx, hy, hz], [hx, hy, -hz]] },
      { n: [0, -1, 0], c: [[-hx, -hy, hz], [-hx, -hy, -hz], [hx, -hy, -hz], [hx, -hy, hz]] },
      { n: [0, 0, 1], c: [[-hx, -hy, hz], [hx, -hy, hz], [hx, hy, hz], [-hx, hy, hz]] },
      { n: [0, 0, -1], c: [[hx, -hy, -hz], [-hx, -hy, -hz], [-hx, hy, -hz], [hx, hy, -hz]] }
    ];
    const pos = [], nrm = [], idx = [];
    faces.forEach((f, fi) => {
      for (const c of f.c) { pos.push(...c); nrm.push(...f.n); }
      const b = fi * 4;
      idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
    });
    return { pos, nrm, idx };
  }

  /* Cylinder (novel-grammar primitive): radius w/2, height h, axis local Y.
   * 16-gon prism: smooth radial sides + flat caps. */
  function cylData(w, h) {
    const r = w * MM / 2, hy = h * MM / 2, SEG = 16;
    const pos = [], nrm = [], idx = [];
    for (let i = 0; i < SEG; i++) { // side rings (radial normals)
      const a = i / SEG * Math.PI * 2, x = Math.cos(a), z = Math.sin(a);
      pos.push(x * r, -hy, z * r); nrm.push(x, 0, z);
      pos.push(x * r, hy, z * r); nrm.push(x, 0, z);
    }
    for (let i = 0; i < SEG; i++) {
      const a = i * 2, b = ((i + 1) % SEG) * 2;
      idx.push(a, b, a + 1, b, b + 1, a + 1);
    }
    for (const [sign, ny] of [[-1, -1], [1, 1]]) { // caps (axial normals)
      const center = pos.length / 3;
      pos.push(0, sign * hy, 0); nrm.push(0, ny, 0);
      const ring = pos.length / 3;
      for (let i = 0; i < SEG; i++) {
        const a = i / SEG * Math.PI * 2;
        pos.push(Math.cos(a) * r, sign * hy, Math.sin(a) * r); nrm.push(0, ny, 0);
      }
      for (let i = 0; i < SEG; i++) {
        const a = ring + i, b = ring + (i + 1) % SEG;
        if (sign > 0) idx.push(center, a, b); else idx.push(center, b, a);
      }
    }
    return { pos, nrm, idx };
  }

  function toGLB(spec, model) {
    const roleColor = BB.Exports.ROLE_COLORS;
    const speciesRough = (BB.K.WOOD_SPECIES[spec.wood.species] || {}).rough || 0.7;

    // Materials: one per role in use (parity with the DAE/Ruby exporters).
    const roles = [...new Set(model.parts.map(p => p.role))];
    const matIndex = new Map(roles.map((r, i) => [r, i]));
    const materials = roles.map(r => {
      const c = roleColor[r] || [180, 140, 95];
      const metal = r === 'pull';
      return {
        name: r,
        pbrMetallicRoughness: {
          baseColorFactor: [srgbToLinear(c[0]), srgbToLinear(c[1]), srgbToLinear(c[2]), 1],
          metallicFactor: metal ? 0.6 : 0,
          roughnessFactor: metal ? 0.35 : speciesRough
        }
      };
    });

    // Geometry deduplicated by (kind, exact size); one glTF mesh per (geom, role).
    const geoms = new Map();  // geoKey -> {data}
    const meshes = [];        // glTF meshes
    const meshIndex = new Map(); // geoKey|role -> mesh index
    const nodes = [];
    for (const p of model.parts) {
      const isCyl = p.prim === 'cylinder';
      const geoKey = (isCyl ? 'cyl:' : 'box:') + `${p.size.w}x${p.size.h}x${p.size.d}`;
      if (!geoms.has(geoKey)) geoms.set(geoKey, isCyl ? cylData(p.size.w, p.size.h) : boxData(p.size.w, p.size.h, p.size.d));
      const mKey = geoKey + '|' + p.role;
      if (!meshIndex.has(mKey)) {
        meshIndex.set(mKey, meshes.length);
        meshes.push({ name: mKey, geoKey, material: matIndex.get(p.role) });
      }
      const node = {
        name: p.id,
        mesh: meshIndex.get(mKey),
        translation: [p.pos.x * MM, p.pos.y * MM, p.pos.z * MM]
      };
      if (p.rot && (p.rot.x || p.rot.y || p.rot.z)) {
        const q = mat3ToQuat(BB.Geo.rotMat(p.rot.x || 0, p.rot.y || 0, p.rot.z || 0));
        if (Math.abs(q[3] - 1) > 1e-9) node.rotation = q;
      }
      nodes.push(node);
    }

    // Binary buffer: per unique geometry — POSITION f32, NORMAL f32, indices u16.
    const bufferViews = [], accessors = [], chunks = [];
    let offset = 0;
    const geoAccessors = new Map(); // geoKey -> {posAcc, nrmAcc, idxAcc}
    const align4 = nBytes => (4 - (nBytes % 4)) % 4;
    for (const [key, g] of geoms) {
      const pos = new Float32Array(g.pos), nrm = new Float32Array(g.nrm), idx = new Uint16Array(g.idx);
      const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
      for (let i = 0; i < pos.length; i += 3) for (let a = 0; a < 3; a++) {
        if (pos[i + a] < min[a]) min[a] = pos[i + a];
        if (pos[i + a] > max[a]) max[a] = pos[i + a];
      }
      const entry = {};
      for (const [arr, type, compType, count, extra] of [
        [pos, 'VEC3', 5126, pos.length / 3, { min, max }],
        [nrm, 'VEC3', 5126, nrm.length / 3, null],
        [idx, 'SCALAR', 5123, idx.length, null]
      ]) {
        const bytes = new Uint8Array(arr.buffer);
        bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: bytes.length });
        accessors.push(Object.assign({
          bufferView: bufferViews.length - 1, componentType: compType, count, type
        }, extra || {}));
        chunks.push(bytes);
        offset += bytes.length;
        const pad = align4(offset);
        if (pad) { chunks.push(new Uint8Array(pad)); offset += pad; }
      }
      geoAccessors.set(key, {
        pos: accessors.length - 3, nrm: accessors.length - 2, idx: accessors.length - 1
      });
    }

    const gltfMeshes = meshes.map(m => ({
      name: m.name,
      primitives: [{
        attributes: { POSITION: geoAccessors.get(m.geoKey).pos, NORMAL: geoAccessors.get(m.geoKey).nrm },
        indices: geoAccessors.get(m.geoKey).idx,
        material: m.material
      }]
    }));

    const json = {
      asset: { version: '2.0', generator: 'Blueprint Buddy' },
      scene: 0,
      scenes: [{ name: spec.meta.name, nodes: nodes.map((_, i) => i) }],
      nodes, meshes: gltfMeshes, materials,
      accessors, bufferViews,
      buffers: [{ byteLength: offset }]
    };

    // ---- GLB container: header + JSON chunk (space-padded) + BIN chunk ----
    const enc = new TextEncoder();
    let jsonBytes = enc.encode(JSON.stringify(json));
    const jsonPad = align4(jsonBytes.length);
    if (jsonPad) {
      const padded = new Uint8Array(jsonBytes.length + jsonPad);
      padded.set(jsonBytes); padded.fill(0x20, jsonBytes.length);
      jsonBytes = padded;
    }
    const binLen = offset;
    const total = 12 + 8 + jsonBytes.length + 8 + binLen;
    const out = new ArrayBuffer(total);
    const dv = new DataView(out);
    const u8 = new Uint8Array(out);
    dv.setUint32(0, 0x46546C67, true);           // magic 'glTF'
    dv.setUint32(4, 2, true);                    // version
    dv.setUint32(8, total, true);
    dv.setUint32(12, jsonBytes.length, true);
    dv.setUint32(16, 0x4E4F534A, true);          // 'JSON'
    u8.set(jsonBytes, 20);
    let p = 20 + jsonBytes.length;
    dv.setUint32(p, binLen, true);
    dv.setUint32(p + 4, 0x004E4942, true);       // 'BIN\0'
    p += 8;
    for (const c of chunks) { u8.set(c, p); p += c.length; }
    return out;
  }

  BB.GLTF = { toGLB, mat3ToQuat, srgbToLinear, boxData, cylData };
})();
