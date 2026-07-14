/* Blueprint Buddy — exports: COLLADA (.dae), SketchUp Ruby (.rb), print sheet.
 *
 * Axis contract: the in-app scene is Y-up (+Z toward the viewer). Both SketchUp
 * formats are Z-up. Conversion for every point: X' = x, Y' = -z, Z' = y.
 * A leg whose scene center is (x, legH/2, z) lands with its foot ON the ground
 * plane (Z' spans 0..legH) — that is the orientation check.
 *
 * Only the ASSEMBLED model is exported, never the exploded state.
 */
var BB = globalThis.BB = globalThis.BB || {};

(function () {
  'use strict';

  /* Per-role display colors so imports are visually legible. [r,g,b] 0..255 */
  const ROLE_COLORS = {
    leg: [110, 78, 48], apron: [146, 106, 66], rail: [160, 120, 76],
    top: [196, 152, 102], seat: [196, 152, 102], shelf: [186, 146, 98],
    side: [176, 136, 90], bottom: [176, 136, 90], back: [222, 205, 166],
    plinth: [120, 90, 60], drawer_side: [233, 216, 174], drawer_boxfront: [233, 216, 174],
    drawer_boxback: [233, 216, 174], drawer_bottom: [240, 226, 190],
    drawer_front: [186, 138, 88], pull: [70, 70, 74]
  };
  const roleColor = role => ROLE_COLORS[role] || [180, 140, 95];

  const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const slug = s => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'design';
  const n = v => (Math.round(v * 1000) / 1000).toString();

  /* Y-up scene rotation → Z-up export rotation: R' = A·R·Aᵀ with A the axis
   * map above (x'=x, y'=-z, z'=y). Null when the part carries no rotation —
   * callers keep the cheaper translation-only path. Fixes the Phase 4 gap
   * where custom-part rotation was silently dropped from both exporters. */
  const AXIS = [[1, 0, 0], [0, 0, -1], [0, 1, 0]];
  const matMul = (X, Y) => X.map(row => [0, 1, 2].map(j => row[0] * Y[0][j] + row[1] * Y[1][j] + row[2] * Y[2][j]));
  const transpose = X => [0, 1, 2].map(j => X.map(r => r[j]));
  function zUpRot(rot) {
    if (!rot || (!rot.x && !rot.y && !rot.z)) return null;
    const M = BB.Geo.rotMat(rot.x || 0, rot.y || 0, rot.z || 0);
    return matMul(matMul(AXIS, M), transpose(AXIS));
  }

  /* ---------------- COLLADA ----------------
   * INTENTIONALLY unit-exempt: the .dae declares <unit meter="0.001"> and
   * writes raw millimetre geometry regardless of the display preference.
   * SketchUp must receive real geometry — display units never touch exports. */
  function toDAE(spec, model) {
    const created = new Date().toISOString();
    const roles = [...new Set(model.parts.map(p => p.role))];

    const effects = roles.map(r => {
      const [cr, cg, cb] = roleColor(r).map(c => n(c / 255));
      return `    <effect id="fx_${r}"><profile_COMMON><technique sid="common"><lambert>` +
        `<diffuse><color>${cr} ${cg} ${cb} 1</color></diffuse>` +
        `</lambert></technique></profile_COMMON></effect>`;
    }).join('\n');
    const materials = roles.map(r =>
      `    <material id="mat_${r}" name="${r}"><instance_effect url="#fx_${r}"/></material>`).join('\n');

    // Deduplicate box geometry by exact size. Box centered at local origin,
    // written directly in Z-up: X = scene w, Y = scene d, Z = scene h.
    const geoms = new Map(); // sizeKey -> {id, w, d, h}
    for (const p of model.parts) {
      const key = `${p.size.w}x${p.size.h}x${p.size.d}`;
      if (!geoms.has(key)) geoms.set(key, { id: 'geom_' + key.replace(/\./g, '_'), w: p.size.w, d: p.size.d, h: p.size.h });
    }
    const geomXML = [...geoms.values()].map(g => {
      const hx = g.w / 2, hy = g.d / 2, hz = g.h / 2;
      const P = [
        [-hx, -hy, -hz], [hx, -hy, -hz], [hx, hy, -hz], [-hx, hy, -hz],
        [-hx, -hy, hz], [hx, -hy, hz], [hx, hy, hz], [-hx, hy, hz]
      ].map(v => v.map(n).join(' ')).join(' ');
      const N = '0 0 -1 0 0 1 0 -1 0 0 1 0 -1 0 0 1 0 0';
      // faces as [v v v v, normal index]
      const faces = [
        [[0, 3, 2, 1], 0], [[4, 5, 6, 7], 1], [[0, 1, 5, 4], 2],
        [[3, 7, 6, 2], 3], [[0, 4, 7, 3], 4], [[1, 2, 6, 5], 5]
      ];
      const tris = faces.map(([f, ni]) =>
        `${f[0]} ${ni} ${f[1]} ${ni} ${f[2]} ${ni} ${f[0]} ${ni} ${f[2]} ${ni} ${f[3]} ${ni}`).join(' ');
      return `    <geometry id="${g.id}"><mesh>
      <source id="${g.id}_pos"><float_array id="${g.id}_pa" count="24">${P}</float_array>
        <technique_common><accessor source="#${g.id}_pa" count="8" stride="3"><param name="X" type="float"/><param name="Y" type="float"/><param name="Z" type="float"/></accessor></technique_common></source>
      <source id="${g.id}_nrm"><float_array id="${g.id}_na" count="18">${N}</float_array>
        <technique_common><accessor source="#${g.id}_na" count="6" stride="3"><param name="X" type="float"/><param name="Y" type="float"/><param name="Z" type="float"/></accessor></technique_common></source>
      <vertices id="${g.id}_vtx"><input semantic="POSITION" source="#${g.id}_pos"/></vertices>
      <triangles count="12" material="m">
        <input semantic="VERTEX" source="#${g.id}_vtx" offset="0"/><input semantic="NORMAL" source="#${g.id}_nrm" offset="1"/>
        <p>${tris}</p></triangles>
    </mesh></geometry>`;
    }).join('\n');

    // One named node per part instance: full pose (rotation + translation)
    // converted Y-up → Z-up.
    const nodes = model.parts.map(p => {
      const key = `${p.size.w}x${p.size.h}x${p.size.d}`;
      const g = geoms.get(key);
      const X = p.pos.x, Y = -p.pos.z, Z = p.pos.y;
      const R = zUpRot(p.rot) || [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
      const mtx = `${n(R[0][0])} ${n(R[0][1])} ${n(R[0][2])} ${n(X)} ` +
        `${n(R[1][0])} ${n(R[1][1])} ${n(R[1][2])} ${n(Y)} ` +
        `${n(R[2][0])} ${n(R[2][1])} ${n(R[2][2])} ${n(Z)} 0 0 0 1`;
      return `      <node id="${esc(p.id)}" name="${esc(p.id)}">
        <matrix>${mtx}</matrix>
        <instance_geometry url="#${g.id}"><bind_material><technique_common>
          <instance_material symbol="m" target="#mat_${p.role}"/>
        </technique_common></bind_material></instance_geometry>
      </node>`;
    }).join('\n');

    return `<?xml version="1.0" encoding="UTF-8"?>
<COLLADA xmlns="http://www.collada.org/2005/11/COLLADASchema" version="1.4.1">
  <asset>
    <contributor><authoring_tool>Blueprint Buddy</authoring_tool></contributor>
    <created>${created}</created><modified>${created}</modified>
    <unit meter="0.001" name="millimeter"/>
    <up_axis>Z_UP</up_axis>
  </asset>
  <library_effects>
${effects}
  </library_effects>
  <library_materials>
${materials}
  </library_materials>
  <library_geometries>
${geomXML}
  </library_geometries>
  <library_visual_scenes>
    <visual_scene id="Scene" name="${esc(spec.meta.name)}">
${nodes}
    </visual_scene>
  </library_visual_scenes>
  <scene><instance_visual_scene url="#Scene"/></scene>
</COLLADA>
`;
  }

  /* ---------------- SketchUp Ruby ----------------
   * INTENTIONALLY unit-exempt: every coordinate uses the .mm helper, so the
   * rebuilt model is geometrically identical no matter which display units
   * the user had selected. Do not route these through BB.Units. */
  function toRuby(spec, model) {
    const rb = s => String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    const name = rb(spec.meta.name);

    // One ComponentDefinition per unique part (defKey), instances placed with
    // transformations. All lengths pass through .mm — the SketchUp Ruby API
    // measures in inches by default and this is the only exact conversion.
    const defs = new Map(); // defKey -> {var, label, w,d,h, role, color, instances:[{id, x,y,z}]}
    let di = 0;
    for (const p of model.parts) {
      if (!defs.has(p.defKey)) {
        defs.set(p.defKey, {
          var: 'def_' + (di++), label: `${p.name} ${p.size.w}x${p.size.h}x${p.size.d}`,
          w: p.size.w, d: p.size.d, h: p.size.h, role: p.role, color: roleColor(p.role), instances: []
        });
      }
      const d = defs.get(p.defKey);
      // Definition geometry is drawn from its min corner; the scene rotates
      // parts about their center. Rotated instances place via full axes
      // (origin = center − R·halfExtents, axes = R columns); plain instances
      // keep the cheap min-corner translation.
      const R = zUpRot(p.rot);
      const cX = p.pos.x, cY = -p.pos.z, cZ = p.pos.y;
      if (R) {
        const half = [p.size.w / 2, p.size.d / 2, p.size.h / 2]; // SketchUp local X,Y,Z
        const o = [
          cX - (R[0][0] * half[0] + R[0][1] * half[1] + R[0][2] * half[2]),
          cY - (R[1][0] * half[0] + R[1][1] * half[1] + R[1][2] * half[2]),
          cZ - (R[2][0] * half[0] + R[2][1] * half[1] + R[2][2] * half[2])
        ];
        d.instances.push({ id: p.id, axes: { o, cols: [0, 1, 2].map(j => [R[0][j], R[1][j], R[2][j]]) } });
      } else {
        d.instances.push({
          id: p.id,
          x: cX - p.size.w / 2,
          y: cY - p.size.d / 2,
          z: cZ - p.size.h / 2
        });
      }
    }
    const roles = [...new Set(model.parts.map(p => p.role))];

    const placement = i => i.axes
      ? `Geom::Transformation.axes(
      Geom::Point3d.new(${i.axes.o.map(v => n(v) + '.mm').join(', ')}),
      ${i.axes.cols.map(c => `Geom::Vector3d.new(${c.map(n).join(', ')})`).join(',\n      ')})`
      : `Geom::Transformation.new(Geom::Point3d.new(${n(i.x)}.mm, ${n(i.y)}.mm, ${n(i.z)}.mm))`;

    const defCode = [...defs.values()].map(d => `
    ${d.var} = defs.add("${rb(d.label)}")
    face = ${d.var}.entities.add_face(
      [0, 0, 0], [${n(d.w)}.mm, 0, 0], [${n(d.w)}.mm, ${n(d.d)}.mm, 0], [0, ${n(d.d)}.mm, 0])
    face.reverse! if face.normal.z < 0
    face.pushpull(${n(d.h)}.mm)
    ${d.var}_mat = mats["bb_${d.role}"] || begin
      m = mats.add("bb_${d.role}"); m.color = Sketchup::Color.new(${d.color.join(', ')}); m
    end
${d.instances.map(i => `    inst = ents.add_instance(${d.var}, ${placement(i)})
    inst.name = "${rb(i.id)}"
    inst.layer = tags["${d.role}"]
    inst.material = ${d.var}_mat`).join('\n')}`).join('\n');

    return `# Blueprint Buddy — "${name}"
# Generated ${new Date().toISOString().slice(0, 10)} · all dimensions exact millimetres
#
# HOW TO RUN (either way):
#   1. In SketchUp: Window > Ruby Console, then paste this whole file and press Enter.
#      (Or in the console:  load "/path/to/${slug(spec.meta.name)}.rb")
#   2. Or drop this file into your SketchUp Plugins folder and restart SketchUp.
#
# The model builds as ONE undo step. Each unique part is a ComponentDefinition
# (identical legs are instances of a single definition); every part is tagged
# by role. Lengths use the .mm helper because the SketchUp API defaults to inches.

module BlueprintBuddyImport
  def self.build
    model = Sketchup.active_model
    model.start_operation("Import ${name}", true)
    defs = model.definitions
    mats = model.materials
    ents = model.active_entities
    tags = {}
    ${JSON.stringify(roles)}.each { |r| tags[r] = model.layers.add("bb_" + r) }
${defCode}
    model.commit_operation
    model.active_view.zoom_extents
    puts "Blueprint Buddy: built ${name} (#{${defs.size}} unique parts, ${model.parts.length} instances)"
  rescue => e
    model.abort_operation
    raise e
  end
end

BlueprintBuddyImport.build
`;
  }

  /* ---------------- CSV cut list ----------------
   * A display surface like the print sheet: dimensions in the current
   * display units AND raw millimetres, so the same file works at the bench
   * and in other software. RFC-4180 quoting; CRLF for spreadsheet apps. */
  function toCSV(spec, cut) {
    const U = BB.Units;
    const q = s => '"' + String(s).replace(/"/g, '""') + '"';
    const rows = [[
      'Part', 'Qty', 'Length', 'Width', 'Thickness',
      'Length (mm)', 'Width (mm)', 'Thickness (mm)', 'Material', 'Stock', 'Grain', 'Notes'
    ].map(q).join(',')];
    for (const r of cut) {
      const mat = BB.K.WOOD_SPECIES[r.material] ? BB.K.WOOD_SPECIES[r.material].label : r.material;
      rows.push([
        q(r.name), r.qty, q(U.fmtLength(r.L)), q(U.fmtLength(r.W)), q(U.fmtLength(r.T)),
        r.L, r.W, r.T, q(mat), q(r.stock), q(r.grain), q(r.note || '')
      ].join(','));
    }
    return rows.join('\r\n') + '\r\n';
  }

  /* ---------------- print sheet ---------------- */
  /* The stock diagrams use CSS variables for the screen; print swaps them for
   * fixed ink-on-paper colors so the sheet works regardless of theme. */
  const PRINT_COLORS = {
    '--ink': '#1c1a14', '--ink-2': '#444444', '--muted': '#777777', '--line-2': '#999999',
    '--accent': '#1b5d82', '--accent-soft': '#e8eef3', '--panel': '#ffffff', '--panel-2': '#eeeeee',
    '--mono': 'ui-monospace, monospace'
  };
  const printSVG = svg => String(svg).replace(/var\((--[a-z0-9-]+)\)/g, (m, v) => PRINT_COLORS[v] || '#333');

  function printHTML(spec, model, cut, bomData, steps, stock) {
    // The print sheet is a display surface: it follows the current display
    // preference via BB.Units (unlike the geometry exports above).
    const U = BB.Units;
    const dateStr = new Date().toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
    const dim = v => U.fmtLength(v);
    const sp = BB.K.WOOD_SPECIES[spec.wood.species];
    const cutRows = cut.map(r => `<tr><td>${esc(r.name)}</td><td>${r.qty}</td><td>${dim(r.L)}</td><td>${dim(r.W)}</td><td>${dim(r.T)}</td><td>${esc(BB.K.WOOD_SPECIES[r.material] ? BB.K.WOOD_SPECIES[r.material].label : r.material)}</td><td>${esc(r.note || '')}</td></tr>`).join('');
    const bomRows = bomData.items.map(i => `<tr><td>${esc(i.label)}</td><td>${i.qty}</td><td>${esc(i.detail || '')}</td></tr>`).join('');
    const stepBlocks = steps.map((s, i) => `<li><strong>${esc(s.title)}.</strong> ${esc(s.text)}</li>`).join('');

    let stockHTML = '';
    if (stock && (stock.boards.length || stock.sheets.length)) {
      const shopRows = stock.shopping.map(s => `<tr><td>${esc(s.label)}</td><td>${s.qty}</td><td>${esc(s.unit)}</td><td>$${s.cost.toFixed(2)}</td></tr>`).join('');
      const boardBlocks = stock.boards.filter(b => b.stockLen).map((b, i) =>
        `<div class="print-board"><p>${esc(U.fmtNominal(b.nominal, b.actual, b.stockLen))} — board ${i + 1} · offcut ${dim(b.offcut)}</p>${printSVG(BB.Packing.boardSVG(b, dim))}</div>`).join('');
      const sheetBlocks = stock.sheets.map((s, i) =>
        `<div class="print-board"><p>${dim(s.thickness)} sheet ${i + 1} — buy a ${esc(s.fractionLabel)}</p>${printSVG(BB.Packing.sheetSVG(s, dim))}</div>`).join('');
      const waste = [];
      if (stock.wasteSolidPct != null) waste.push(`solid ${stock.wasteSolidPct}%`);
      if (stock.wasteSheetPct != null) waste.push(`sheet ${stock.wasteSheetPct}%`);
      stockHTML = `
  <section class="print-section page-break">
    <h2>Stock — what to buy and how to break it down</h2>
    <table><thead><tr><th>Buy</th><th>Qty</th><th>Unit</th><th>Cost</th></tr></thead><tbody>${shopRows}</tbody></table>
    <p class="print-total">Purchasable-stock total: $${stock.totalCost.toFixed(2)}${waste.length ? ' · waste ' + waste.join(' · ') : ''}</p>
    ${boardBlocks}${sheetBlocks}
    <p>Kerf ${U.fmtSmall(BB.K.LUMBER.KERF)} per cut · ${dim(BB.K.LUMBER.END_TRIM)} end trim per board end · hatched areas are offcuts.</p>
  </section>`;
    }

    return `
  <header class="print-head">
    <h1>${esc(spec.meta.name)}</h1>
    <p>${esc(spec.meta.template)} · ${dim(spec.overall.width)} W × ${dim(spec.overall.depth)} D × ${dim(spec.overall.height)} H · ${esc(sp.label)} · ${esc(spec.meta.level)} build · ${dateStr}</p>
    <p class="print-sub">Blueprint Buddy build sheet</p>
  </header>
  <section class="print-section">
    <h2>Cut list</h2>
    <table><thead><tr><th>Part</th><th>Qty</th><th>Length</th><th>Width</th><th>Thick</th><th>Material</th><th>Notes</th></tr></thead><tbody>${cutRows}</tbody></table>
  </section>
  <section class="print-section page-break">
    <h2>Drawings — stylized elevations (not hidden-line)</h2>
    <div class="print-drawings">
      ${['front', 'side', 'top'].map(v => `<div class="print-elevation">${printSVG(BB.Drafting.elevationSVG(spec, model, v, dim))}</div>`).join('\n      ')}
    </div>
  </section>
  <section class="print-section">
    <h2>Tools &amp; shop time</h2>
    <p>${BB.Plans.toolList(spec, model, stock).map(esc).join(' · ')}</p>
    ${(() => {
      const t = BB.Plans.timeEstimate(spec, model, cut, steps, stock);
      const wait = t.finishWait ? ` Plus finish wall time: ${t.finishWait.coats} coats of ${esc(t.finishWait.label.toLowerCase())}, recoat every ${t.finishWait.recoatHrs} h, cure ${t.finishWait.cureDays} days.` : '';
      return `<p class="print-total">≈ ${t.hoursLow}–${t.hoursHigh} hours of bench time (${t.sessions} session${t.sessions === 1 ? '' : 's'} of ~4 h) at the ${esc(spec.meta.level)} pace.${wait}</p>`;
    })()}
  </section>${stockHTML}
  <section class="print-section page-break">
    <h2>Bill of materials</h2>
    <table><thead><tr><th>Item</th><th>Qty</th><th>Detail</th></tr></thead><tbody>${bomRows}</tbody></table>
    <p class="print-total">Estimated materials cost: $${bomData.total}</p>
  </section>
  <section class="print-section page-break">
    <h2>Assembly</h2>
    <ol class="print-steps">${stepBlocks}</ol>
  </section>`;
  }

  /* Blob download (browser only). */
  function download(filename, text, mime) {
    const blob = new Blob([text], { type: mime || 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click();
    setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 0);
  }

  BB.Exports = { toDAE, toRuby, toCSV, printHTML, printSVG, download, slug, ROLE_COLORS };
})();
