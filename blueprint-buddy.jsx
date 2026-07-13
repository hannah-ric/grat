// Blueprint Buddy — AI-driven furniture design & build-plan generator (single-file MVP)
// Architecture: AI proposes intent (DesignSpec) -> parametric layer owns all geometry ->
// derived layer (cut list / BOM / assembly) is pure functions of the corrected spec.
// The AI never does arithmetic; every number the user sees comes from code.

import React, { useState, useRef, useEffect, useMemo, useCallback } from "react";
import * as THREE from "three";

/* ============================== constants & helpers ============================== */

const SOLID_THICKNESSES = [19, 25, 32, 38]; // 4/4, 5/4, 6/4, 8/4 surfaced, mm
const SHEET_THICKNESSES = [6, 12, 18];
const SCREW_SIZES = [25, 32, 40, 50, 63, 75]; // mm, #8
const KERF_MM = 3;

const PRICE_BF = { oak: 8.5, maple: 7.5, walnut: 14, cherry: 11, pine: 4.5, plywood: 5, default: 7 }; // $/board-foot
const SHEET_PRICE = { 6: 34, 12: 52, 18: 68 }; // $ per 4x8 sheet by thickness
const SHEET_W = 1219, SHEET_L = 2438; // 4x8 ft in mm

const JOINTS_BY_LEVEL = {
  beginner: ["butt_screws", "pocket_screws"],
  intermediate: ["butt_screws", "pocket_screws", "dowels", "dados", "rabbets"],
  advanced: ["butt_screws", "pocket_screws", "dowels", "dados", "rabbets", "mortise_tenon", "half_lap"],
};
const JOINT_LABEL = {
  butt_screws: "butt joint + screws", pocket_screws: "pocket screws", dowels: "dowels",
  dados: "dados", rabbets: "rabbets", mortise_tenon: "mortise & tenon", half_lap: "half lap",
};
const FURNITURE_TYPES = ["table", "bookshelf", "bench", "desk", "cabinet", "nightstand", "other"];
const LEG_APRON_TYPES = ["table", "desk", "bench", "nightstand"];
const CARCASS_TYPES = ["bookshelf", "cabinet"];

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const snapTo = (arr, v) => arr.reduce((best, x) => (Math.abs(x - v) < Math.abs(best - v) ? x : best), arr[0]);
const snapSolid = (t) => snapTo(SOLID_THICKNESSES, t);
const snapSheet = (t) => snapTo(SHEET_THICKNESSES, t);
// Screw length = 2–2.5x thickness of the part being fastened through, snapped to common sizes.
function snapScrew(throughThickness) {
  const lo = 2 * throughThickness, hi = 2.5 * throughThickness;
  const inRange = SCREW_SIZES.filter((s) => s >= lo && s <= hi);
  if (inRange.length) return inRange[inRange.length - 1];
  return snapTo(SCREW_SIZES, 2.25 * throughThickness);
}

/* ---------- units: internal math is always mm; conversion is display-only ---------- */

function gcd(a, b) { return b ? gcd(b, a % b) : a; }
// mm -> fractional inches rounded to nearest 1/16, fraction reduced (never renders 8/16)
function inchesFrac(mm) {
  let sixteenths = Math.round((mm / 25.4) * 16);
  let whole = Math.floor(sixteenths / 16);
  let num = sixteenths % 16, den = 16;
  if (num === 0) return `${whole}`;
  const g = gcd(num, den); num /= g; den /= g;
  return whole > 0 ? `${whole} ${num}/${den}` : `${num}/${den}`;
}
function fmtLenBare(mm, unit) {
  if (unit === "in") return inchesFrac(mm);
  if (unit === "cm") return (mm / 10).toFixed(1);
  return String(Math.round(mm));
}
function fmtLen(mm, unit) {
  if (unit === "in") return inchesFrac(mm) + '"';
  if (unit === "cm") return (mm / 10).toFixed(1) + " cm";
  return Math.round(mm) + " mm";
}
const UNIT_LABEL = { in: "in", cm: "cm", mm: "mm" };
const fmtDims = (c, unit) => `${fmtLen(c.thickness, unit)} × ${fmtLen(c.width, unit)} × ${fmtLen(c.length, unit)}`;
const money = (n) => "$" + n.toFixed(2);

/* ---------- role normalization (AI role strings -> canonical roles) ---------- */

const ROLE_MAP = {
  tabletop: "top", table_top: "top", top_panel: "top", desktop: "top", seat: "top", worktop: "top",
  lower_shelf: "shelf", shelves: "shelf", shelving: "shelf", middle_shelf: "shelf",
  legs: "leg", aprons: "apron", rail: "apron", rails: "apron", skirt: "apron",
  side_panel: "side", sides: "side", side_panels: "side", panel: "side",
  back_panel: "back", backpanel: "back", bottom_panel: "bottom",
  stretchers: "stretcher", divider: "divider", dividers: "divider",
};
function normRole(r) {
  let s = String(r || "").toLowerCase().trim().replace(/[\s-]+/g, "_");
  if (ROLE_MAP[s]) return ROLE_MAP[s];
  if (s.endsWith("s") && s.length > 3) { const sing = s.slice(0, -1); if (ROLE_MAP[sing]) return ROLE_MAP[sing]; return sing; }
  return s;
}
const ROLE_VOCAB = {
  legApron: ["top", "leg", "apron", "shelf", "stretcher"],
  carcass: ["side", "top", "bottom", "shelf", "back", "divider"],
};
function jointFor(joinery, a, b) {
  for (const j of joinery || []) {
    const [x, y] = (j.connects || []).map(normRole);
    if ((x === a && y === b) || (x === b && y === a)) return j.joint;
  }
  return null;
}

/* ============================== seed spec (runs through the full production path) ============================== */

const SEED_SPEC = {
  name: "Walnut Nightstand",
  furnitureType: "nightstand",
  overall: { width: 500, depth: 420, height: 610 },
  material: { species: "walnut" },
  features: ["lower_shelf"],
  joinery: [
    { joint: "mortise_tenon", connects: ["apron", "leg"] },
    { joint: "dados", connects: ["shelf", "leg"] },
    { joint: "butt_screws", connects: ["top", "apron"] },
  ],
  designNotes: "Compact bedside table with a dadoed lower shelf and mortise-and-tenon apron frame.",
};

/* ============================== validation (code-owned, self-healing) ============================== */

function mergeSpec(current, patch) {
  // The model may omit optional fields it is not changing; merge onto the current spec.
  if (!patch || typeof patch !== "object") return null;
  const base = current || {};
  return {
    name: patch.name != null ? patch.name : base.name,
    furnitureType: patch.furnitureType != null ? patch.furnitureType : base.furnitureType,
    overall: { ...(base.overall || {}), ...(patch.overall || {}) },
    material: { ...(base.material || {}), ...(patch.material || {}) },
    features: Array.isArray(patch.features) ? patch.features : base.features || [],
    joinery: Array.isArray(patch.joinery) ? patch.joinery : base.joinery || [],
    designNotes: patch.designNotes != null ? patch.designNotes : base.designNotes || "",
    parts: Array.isArray(patch.parts) ? patch.parts : base.parts,
  };
}

// Returns { spec: normalized/corrected, errors: [] }. Errors mean "re-prompt the model";
// anything silently correctable is corrected here or in the layout templates.
function validateSpec(raw, level) {
  const errors = [];
  if (!raw || typeof raw !== "object") return { spec: null, errors: ["Response is not a JSON object."] };
  const spec = {
    name: typeof raw.name === "string" && raw.name.trim() ? raw.name.trim().slice(0, 80) : "Untitled Piece",
    furnitureType: FURNITURE_TYPES.includes(raw.furnitureType) ? raw.furnitureType : null,
    overall: {}, material: {}, features: [], joinery: [], designNotes: "", parts: undefined,
  };
  if (!spec.furnitureType) errors.push(`furnitureType must be one of ${FURNITURE_TYPES.join(", ")}.`);

  for (const k of ["width", "depth", "height"]) {
    const v = Number(raw.overall && raw.overall[k]);
    if (!isFinite(v) || v < 100 || v > 3000) errors.push(`overall.${k} must be a number between 100 and 3000 mm (got ${raw.overall ? raw.overall[k] : "nothing"}).`);
    else spec.overall[k] = Math.round(v);
  }
  spec.material.species = String((raw.material && raw.material.species) || "pine").toLowerCase().trim();
  spec.features = (Array.isArray(raw.features) ? raw.features : []).map((f) => String(f).toLowerCase().trim()).slice(0, 12);
  spec.designNotes = String(raw.designNotes || "").slice(0, 500);

  const allowed = JOINTS_BY_LEVEL[level] || JOINTS_BY_LEVEL.beginner;
  const vocab = LEG_APRON_TYPES.includes(spec.furnitureType) ? ROLE_VOCAB.legApron
    : CARCASS_TYPES.includes(spec.furnitureType) ? ROLE_VOCAB.carcass : null;

  // "other" honors model parts (2–40, positive dims) — the only place the AI's parts are trusted.
  if (spec.furnitureType === "other") {
    const parts = Array.isArray(raw.parts) ? raw.parts : [];
    if (parts.length < 2 || parts.length > 40) errors.push(`furnitureType "other" requires 2–40 parts (got ${parts.length}).`);
    spec.parts = parts.slice(0, 40).map((p, i) => {
      const d = p.dimensions || {};
      const dims = { length: Number(d.length), width: Number(d.width), thickness: Number(d.thickness) };
      for (const k of ["length", "width", "thickness"]) {
        if (!isFinite(dims[k]) || dims[k] <= 0) errors.push(`parts[${i}].dimensions.${k} must be a positive number.`);
      }
      const stock = p.stock === "sheet" ? "sheet" : "solid";
      dims.thickness = isFinite(dims.thickness) && dims.thickness > 0
        ? (stock === "sheet" ? snapSheet(dims.thickness) : snapSolid(dims.thickness)) : dims.thickness;
      return {
        id: String(p.id || `part_${i + 1}`), role: normRole(p.role || `part_${i + 1}`),
        quantity: clamp(Math.round(Number(p.quantity) || 1), 1, 20),
        dimensions: dims, grainDirection: p.grainDirection === "width" ? "width" : "length", stock,
      };
    });
  }

  const partRoles = spec.furnitureType === "other" && spec.parts ? spec.parts.map((p) => p.role) : vocab || [];
  const joinery = Array.isArray(raw.joinery) ? raw.joinery : [];
  for (const j of joinery.slice(0, 12)) {
    if (!j || typeof j !== "object") continue;
    if (!allowed.includes(j.joint)) { errors.push(`Joint "${j.joint}" is not allowed at ${level} level. Allowed: ${allowed.join(", ")}.`); continue; }
    const c = Array.isArray(j.connects) ? j.connects.map(normRole) : [];
    if (c.length !== 2) { errors.push(`Joinery "${j.joint}" needs connects: [roleA, roleB].`); continue; }
    const bad = c.filter((r) => !partRoles.includes(r));
    if (bad.length) { errors.push(`Joinery connects role(s) ${bad.join(", ")} do not exist in the ${spec.furnitureType || "design"} part set (valid: ${partRoles.join(", ")}).`); continue; }
    spec.joinery.push({ joint: j.joint, connects: [c[0], c[1]] });
  }
  // Inject sensible defaults for known types so a joinery-less spec still builds.
  if (vocab && !errors.length) {
    const has = (a, b) => jointFor(spec.joinery, a, b);
    const best = (prefs) => prefs.find((p) => allowed.includes(p));
    if (vocab === ROLE_VOCAB.legApron) {
      if (!has("apron", "leg")) spec.joinery.push({ joint: best(["mortise_tenon", "dowels", "pocket_screws", "butt_screws"]), connects: ["apron", "leg"] });
      if (!has("top", "apron")) spec.joinery.push({ joint: "butt_screws", connects: ["top", "apron"] });
    } else {
      if (!has("shelf", "side")) spec.joinery.push({ joint: best(["dados", "pocket_screws", "butt_screws"]), connects: ["shelf", "side"] });
      if (!has("back", "side")) spec.joinery.push({ joint: best(["rabbets", "butt_screws"]), connects: ["back", "side"] });
    }
  }
  return { spec: errors.length ? null : spec, errors };
}

/* ============================== parametric layout engine (geometry authority) ============================== */
// Each template: (spec) => { parts: PositionedPart[], notes: string[] }
// PositionedPart: { id, name, role, size:{x,y,z} mm (assembled 3D box), pos:{x,y,z} mm center (y from floor),
//   cut:{length,width,thickness} mm (INCLUDES joinery allowances), grain, stock, bias }

function tenonLength(matingThickness) { return Math.min(Math.round((2 / 3) * matingThickness), 32); }

function buildLegApron(spec, notes) {
  const { width: W, depth: D, height: H } = spec.overall;
  const type = spec.furnitureType;
  const topT = snapSolid(25);
  const legT = Math.max(60, Math.round(H / 12));
  const legL = H - topT;
  const apronT = snapSolid(20); // 20 mm nominal snaps to 19 stock
  const apronH = clamp(Math.round(H * 0.12), 70, 150);
  let over = type === "nightstand" ? 25 : 40;
  // Guard: keep at least 60 mm of apron span on the narrow axis.
  const maxOver = Math.floor((Math.min(W, D) - 2 * legT - 60) / 2);
  if (over > maxOver) { over = Math.max(5, maxOver); notes.push(`Top overhang reduced to ${over} mm so the legs and aprons fit the footprint.`); }

  const legCx = W / 2 - over - legT / 2;
  const legCz = D / 2 - over - legT / 2;
  const shoulderX = 2 * legCx - legT; // apron shoulder-to-shoulder span, long axis
  const shoulderZ = 2 * legCz - legT;
  const apronY = legL - apronH / 2;
  const inset = 6; // apron face flush-inset from outer leg face

  const apronJoint = jointFor(spec.joinery, "apron", "leg");
  const apronAllow = apronJoint === "mortise_tenon" ? 2 * tenonLength(legT) : 0;

  const parts = [];
  parts.push({ id: "top", name: "Top", role: "top", size: { x: W, y: topT, z: D }, pos: { x: 0, y: H - topT / 2, z: 0 },
    cut: { length: W, width: D, thickness: topT }, grain: "length", stock: "solid", bias: "up" });
  [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(([sx, sz], i) => {
    parts.push({ id: `leg${i + 1}`, name: "Leg", role: "leg", size: { x: legT, y: legL, z: legT },
      pos: { x: sx * legCx, y: legL / 2, z: sz * legCz },
      cut: { length: legL, width: legT, thickness: legT }, grain: "length", stock: "solid", bias: "leg" });
  });
  const apronZ = legCz + legT / 2 - inset - apronT / 2;
  [-1, 1].forEach((s, i) => {
    parts.push({ id: `apronLong${i + 1}`, name: "Apron (long)", role: "apron", size: { x: shoulderX, y: apronH, z: apronT },
      pos: { x: 0, y: apronY, z: s * apronZ },
      cut: { length: shoulderX + apronAllow, width: apronH, thickness: apronT }, grain: "length", stock: "solid", bias: "generic" });
  });
  const apronX = legCx + legT / 2 - inset - apronT / 2;
  [-1, 1].forEach((s, i) => {
    parts.push({ id: `apronShort${i + 1}`, name: "Apron (short)", role: "apron", size: { x: apronT, y: apronH, z: shoulderZ },
      pos: { x: s * apronX, y: apronY, z: 0 },
      cut: { length: shoulderZ + apronAllow, width: apronH, thickness: apronT }, grain: "length", stock: "solid", bias: "generic" });
  });
  if (apronJoint === "mortise_tenon") notes.push(`Apron cut lengths include two ${tenonLength(legT)} mm tenons each (added by code, never by the AI).`);

  const wantsShelf = spec.features.some((f) => f.includes("shelf"));
  const wantsStretcher = spec.features.some((f) => f.includes("stretcher"));
  if (wantsShelf) {
    let shelfT = snapSolid(19);
    if (Math.max(shoulderX, shoulderZ) > 800 && shelfT === 19) { shelfT = 25; notes.push("Lower shelf spans over 800 mm, so it was thickened to 25 mm stock for stiffness."); }
    const shelfJoint = jointFor(spec.joinery, "shelf", "leg") || jointFor(spec.joinery, "shelf", "apron");
    const dadoDepth = shelfJoint === "dados" ? Math.round(legT / 3) : 0;
    parts.push({ id: "shelf1", name: "Lower shelf", role: "shelf", size: { x: shoulderX, y: shelfT, z: shoulderZ },
      pos: { x: 0, y: Math.round(0.25 * H), z: 0 },
      cut: { length: shoulderX + 2 * dadoDepth, width: shoulderZ, thickness: shelfT }, grain: "length", stock: "solid", bias: "up" });
    if (dadoDepth) notes.push(`Lower shelf cut length includes 2 × ${dadoDepth} mm dado depth housed in the legs.`);
  } else if (wantsStretcher) {
    const strJoint = jointFor(spec.joinery, "stretcher", "leg");
    const strAllow = strJoint === "mortise_tenon" ? 2 * tenonLength(legT) : 0;
    [-1, 1].forEach((s, i) => {
      parts.push({ id: `stretcher${i + 1}`, name: "Stretcher", role: "stretcher", size: { x: apronT, y: 60, z: shoulderZ },
        pos: { x: s * legCx, y: Math.round(0.25 * H), z: 0 },
        cut: { length: shoulderZ + strAllow, width: 60, thickness: apronT }, grain: "length", stock: "solid", bias: "generic" });
    });
  }
  return parts;
}

function buildCarcass(spec, notes) {
  const { width: W, depth: D, height: H } = spec.overall;
  const sheetMode = spec.material.species === "plywood";
  const t = sheetMode ? snapSheet(18) : snapSolid(19);
  const stock = sheetMode ? "sheet" : "solid";
  const innerW = W - 2 * t;

  const shelfJoint = jointFor(spec.joinery, "shelf", "side");
  const capJoint = jointFor(spec.joinery, "top", "side") || jointFor(spec.joinery, "bottom", "side") || shelfJoint;
  const backJoint = jointFor(spec.joinery, "back", "side");
  const dadoDepth = Math.round(t / 3);
  const rabbetDepth = Math.round(t / 2);
  const allowFor = (joint) => (joint === "dados" ? 2 * dadoDepth : joint === "rabbets" ? 2 * rabbetDepth : 0);

  // Shelf count: explicit "N shelves"/"shelves_N" feature wins; otherwise even spacing,
  // first shelf never below 250 mm.
  let n = null;
  for (const f of spec.features) { const m = f.match(/(\d+)[^\d]*shel|shel[^\d]*(\d+)/); if (m) { n = clamp(parseInt(m[1] || m[2], 10), 0, 12); break; } }
  if (n == null) n = clamp(Math.round(H / 380) - 1, spec.furnitureType === "bookshelf" ? 1 : 0, 8);
  let spacing = (H - 2 * t) / (n + 1);
  while (n > 0 && (t + spacing < 250)) { n--; spacing = (H - 2 * t) / (n + 1); }

  let shelfT = t;
  const parts = [];
  const panelDepth = D - 8; // leave room for the back panel
  // Span rule: >800 mm unsupported in 19 mm stock -> thicken solid shelves to 25, or add a center divider for sheet.
  let divider = false;
  if (innerW > 800 && t < 25) {
    if (sheetMode) { divider = true; notes.push("Shelf span exceeds 800 mm in 18 mm sheet stock, so a center divider was added for support."); }
    else { shelfT = 25; notes.push("Shelf span exceeds 800 mm, so shelves were thickened to 25 mm stock."); }
  }

  [-1, 1].forEach((s, i) => {
    parts.push({ id: `side${i + 1}`, name: "Side", role: "side", size: { x: t, y: H, z: D },
      pos: { x: s * (W / 2 - t / 2), y: H / 2, z: 0 },
      cut: { length: H, width: D, thickness: t }, grain: "length", stock, bias: "side" });
  });
  parts.push({ id: "bottom", name: "Bottom", role: "bottom", size: { x: innerW, y: t, z: panelDepth },
    pos: { x: 0, y: t / 2, z: 4 },
    cut: { length: innerW + allowFor(capJoint), width: panelDepth, thickness: t }, grain: "length", stock, bias: "generic" });
  parts.push({ id: "topPanel", name: "Top", role: "top", size: { x: innerW, y: t, z: panelDepth },
    pos: { x: 0, y: H - t / 2, z: 4 },
    cut: { length: innerW + allowFor(capJoint), width: panelDepth, thickness: t }, grain: "length", stock, bias: "up" });
  for (let i = 1; i <= n; i++) {
    parts.push({ id: `shelf${i}`, name: "Shelf", role: "shelf", size: { x: innerW, y: shelfT, z: panelDepth },
      pos: { x: 0, y: Math.round(t + spacing * i), z: 4 },
      cut: { length: innerW + allowFor(shelfJoint), width: panelDepth, thickness: shelfT }, grain: "length", stock, bias: "up" });
  }
  if (divider) {
    parts.push({ id: "divider", name: "Center divider", role: "divider", size: { x: t, y: H - 2 * t, z: panelDepth },
      pos: { x: 0, y: H / 2, z: 4 }, cut: { length: H - 2 * t, width: panelDepth, thickness: t }, grain: "length", stock, bias: "generic" });
  }
  // Back panel: 6 mm sheet; sits in rabbets (smaller, inset) or overlaps the back edges.
  const inRabbet = backJoint === "rabbets";
  const backW = inRabbet ? W - t : W;
  const backH = inRabbet ? H - t : H;
  parts.push({ id: "back", name: "Back panel", role: "back", size: { x: backW, y: backH, z: 6 },
    pos: { x: 0, y: inRabbet ? H / 2 : backH / 2, z: inRabbet ? -(D / 2 - 3) : -(D / 2 + 3) },
    cut: { length: backH, width: backW, thickness: 6 }, grain: "length", stock: "sheet", bias: "back" });
  if (shelfJoint === "dados") notes.push(`Shelf cut lengths include 2 × ${dadoDepth} mm dado depth housed in the sides.`);
  if (inRabbet) notes.push(`Back panel sized for a ${rabbetDepth} mm rabbet in the sides.`);
  return parts;
}

function buildOther(spec) {
  // Only "other" trusts model-supplied parts (post-validation). Lay instances out on the shop floor.
  const parts = [];
  let cursor = 0;
  (spec.parts || []).forEach((p) => {
    for (let q = 0; q < p.quantity; q++) {
      const d = p.dimensions;
      parts.push({ id: `${p.id}_${q + 1}`, name: p.role.replace(/_/g, " "), role: p.role,
        size: { x: d.length, y: d.thickness, z: d.width },
        pos: { x: cursor + d.length / 2, y: d.thickness / 2, z: 0 },
        cut: { length: d.length, width: d.width, thickness: d.thickness },
        grain: p.grainDirection, stock: p.stock, bias: "generic" });
      cursor += d.length + 60;
    }
  });
  const mid = cursor / 2;
  parts.forEach((p) => { p.pos.x -= mid; });
  return parts;
}

// The single entry point: corrected spec in, positioned parts + engineering notes out.
function runParametric(spec) {
  const notes = [];
  let parts;
  if (LEG_APRON_TYPES.includes(spec.furnitureType)) parts = buildLegApron(spec, notes);
  else if (CARCASS_TYPES.includes(spec.furnitureType)) parts = buildCarcass(spec, notes);
  else parts = buildOther(spec);
  const solidTop = parts.find((p) => p.role === "top" && p.stock === "solid");
  if (solidTop) notes.push("Solid-wood top: attach with slotted screw holes or tabletop fasteners so the top can move with humidity. Never glue across the grain.");
  return { parts, notes };
}

/* ============================== derived layer: cut list ============================== */

function makeCutList(parts, species) {
  const groups = new Map();
  for (const p of parts) {
    const key = `${p.name}|${p.cut.length}|${p.cut.width}|${p.cut.thickness}|${p.stock}`;
    if (!groups.has(key)) {
      groups.set(key, { name: p.name, qty: 0, cut: { ...p.cut }, grain: p.grain, stock: p.stock,
        material: p.stock === "sheet" ? "plywood" : species,
        volume: p.cut.length * p.cut.width * p.cut.thickness });
    }
    groups.get(key).qty += 1;
  }
  return [...groups.values()].sort((a, b) => b.volume - a.volume);
}

function cutListCSV(rows, unit, specName) {
  const q = (s) => `"${String(s).replace(/"/g, '""')}"`;
  const header = ["Part", "Qty", "Thickness", "Width", "Length", "Unit", "Material", "Grain"].map(q).join(",");
  const lines = rows.map((r) => [r.name, r.qty, fmtLenBare(r.cut.thickness, unit), fmtLenBare(r.cut.width, unit),
    fmtLenBare(r.cut.length, unit), UNIT_LABEL[unit], r.material, r.grain].map(q).join(","));
  const note = [q(`Cut lengths include joinery allowances. Add ${fmtLenBare(KERF_MM, unit)} ${UNIT_LABEL[unit]} kerf between adjacent cuts.`)].join(",");
  const csv = [header, ...lines, note].join("\r\n") + "\r\n";
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${specName.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}-cutlist.csv`;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/* ============================== derived layer: bill of materials ============================== */

function makeBOM(spec, parts) {
  const species = spec.material.species;
  const lumber = [], sheets = [], hardware = [];

  // Lumber: board feet = (t_in x w_in x l_in) / 144 per part, +15% waste, priced by species.
  let bf = 0;
  for (const p of parts) if (p.stock === "solid") bf += (p.cut.thickness / 25.4) * (p.cut.width / 25.4) * (p.cut.length / 25.4) / 144;
  if (bf > 0) {
    const bfW = bf * 1.15;
    const rate = PRICE_BF[species] != null ? PRICE_BF[species] : PRICE_BF.default;
    lumber.push({ label: `${species} lumber (${bf.toFixed(1)} bd ft + 15% waste = ${bfW.toFixed(1)} bd ft)`,
      qty: `${bfW.toFixed(1)} bd ft`, unitPrice: rate, cost: bfW * rate });
  }
  // Sheet goods: fraction of a 4x8 sheet, rounded UP to the nearest quarter sheet, per thickness.
  const areaByT = new Map();
  for (const p of parts) if (p.stock === "sheet") {
    const t = snapSheet(p.cut.thickness);
    areaByT.set(t, (areaByT.get(t) || 0) + p.cut.length * p.cut.width);
  }
  for (const [t, area] of [...areaByT.entries()].sort((a, b) => b[0] - a[0])) {
    const frac = Math.ceil((area / (SHEET_W * SHEET_L)) * 4) / 4;
    const price = SHEET_PRICE[t] || SHEET_PRICE[18];
    sheets.push({ label: `${t} mm plywood (${frac} of a 4×8 sheet)`, qty: `${frac} sheet`, unitPrice: price, cost: frac * price });
  }
  // Hardware: screws sized 2–2.5x the fastened part's thickness; 2 screws per joint face minimum.
  const screwCounts = new Map(); let pocketCounts = new Map(); let dowels = 0;
  for (const j of spec.joinery) {
    const roleA = j.connects[0];
    const aParts = parts.filter((p) => p.role === roleA);
    if (!aParts.length) continue;
    const faces = roleA === "back" ? 4 : Math.max(aParts.length * 2, 2);
    const screws = faces * 2;
    // Screws drive THROUGH the thinner part into the thicker one (through the apron into the leg,
    // through the back into the sides), so size off the thinner of the two connected parts.
    const bPart = parts.find((p) => p.role === j.connects[1]);
    const through = bPart && bPart.cut.thickness < aParts[0].cut.thickness ? bPart : aParts[0];
    if (j.joint === "butt_screws") {
      const size = snapScrew(through.cut.thickness);
      screwCounts.set(size, (screwCounts.get(size) || 0) + screws);
    } else if (j.joint === "pocket_screws") {
      const size = snapScrew(through.cut.thickness);
      pocketCounts.set(size, (pocketCounts.get(size) || 0) + screws);
    } else if (j.joint === "dowels") {
      dowels += screws;
    }
  }
  for (const [size, count] of [...screwCounts.entries()].sort((a, b) => a[0] - b[0]))
    hardware.push({ label: `#8 × ${size} mm wood screws`, qty: `${count}`, unitPrice: 0.12, cost: count * 0.12 });
  for (const [size, count] of [...pocketCounts.entries()].sort((a, b) => a[0] - b[0]))
    hardware.push({ label: `${size} mm pocket-hole screws`, qty: `${count}`, unitPrice: 0.15, cost: count * 0.15 });
  if (dowels) hardware.push({ label: "8 × 40 mm fluted dowels", qty: `${dowels}`, unitPrice: 0.1, cost: dowels * 0.1 });
  const solidTop = parts.find((p) => p.role === "top" && p.stock === "solid");
  if (solidTop && LEG_APRON_TYPES.includes(spec.furnitureType))
    hardware.push({ label: "Tabletop fasteners (Z-clips, allow wood movement)", qty: "8", unitPrice: 0.6, cost: 4.8 });
  hardware.push({ label: "Wood glue (PVA, 16 oz)", qty: "1", unitPrice: 8, cost: 8 });
  hardware.push({ label: "Finish (Danish oil, 1 qt)", qty: "1", unitPrice: 16, cost: 16 });

  const sub = (rows) => rows.reduce((s, r) => s + r.cost, 0);
  const sections = [
    { title: "Lumber", rows: lumber, subtotal: sub(lumber) },
    { title: "Sheet goods", rows: sheets, subtotal: sub(sheets) },
    { title: "Hardware & finish", rows: hardware, subtotal: sub(hardware) },
  ].filter((s) => s.rows.length);
  return { sections, total: sections.reduce((s, x) => s + x.subtotal, 0) };
}

/* ============================== derived layer: assembly instructions ============================== */

const JOINT_TIPS = {
  butt_screws: "Pre-drill and countersink every screw to keep the stock from splitting.",
  pocket_screws: "Clamp the faces flush before driving pocket screws — they like to shift the joint.",
  dowels: "Use dowel centers to transfer hole locations; a 0.5 mm miss shows in the finished joint.",
  dados: "Test the dado width on scrap first; the shelf should slide home with firm hand pressure.",
  rabbets: "Cut rabbets in two light passes for a crisp shoulder.",
  mortise_tenon: "Cut the mortises first, then fit each tenon to its mortise — sneak up on a snug fit.",
  half_lap: "Saw just shy of the line, then pare to the line with a sharp chisel. Note: lap depth is half the part thickness.",
};
const JOINT_TOOLS = {
  butt_screws: ["Countersink bit"],
  pocket_screws: ["Pocket-hole jig"],
  dowels: ["Doweling jig", "8 mm brad-point bit"],
  dados: ["Router with straight bit (or dado stack)"],
  rabbets: ["Rabbeting bit (or dado stack)"],
  mortise_tenon: ["Mortise chisel", "Tenon / back saw", "Marking gauge"],
  half_lap: ["Back saw", "Bench chisel"],
};
const BASE_TOOLS = ["Tape measure", "Combination square", "Table saw or circular saw with a guide", "Drill/driver", "Bar or pipe clamps", "Sandpaper (120 / 180 / 220 grit)"];

function fastenersText(joint, throughT) {
  if (joint === "butt_screws") return `#8 × ${snapScrew(throughT)} mm screws + glue`;
  if (joint === "pocket_screws") return `${snapScrew(throughT)} mm pocket screws`;
  if (joint === "dowels") return "8 × 40 mm dowels + glue";
  if (joint === "mortise_tenon" || joint === "half_lap" || joint === "dados" || joint === "rabbets") return "glue + clamps";
  return "glue";
}
const jointPrep = (joint) => ({
  mortise_tenon: "cut the mortises and matching tenons",
  dados: "rout the dados (depth = 1/3 of the housing part's thickness)",
  rabbets: "cut the rabbets (depth = half the part thickness)",
  half_lap: "cut the half laps (depth = half the part thickness)",
  dowels: "drill the dowel holes",
  pocket_screws: "drill the pocket holes",
  butt_screws: "pre-drill and countersink",
}[joint] || "prepare the joints");

// Deterministic walk of the joinery graph: sub-assemblies -> joining -> tops/shelves/backs -> finish.
function makeAssembly(spec, parts, notes, level) {
  const beginner = level === "beginner";
  const steps = [];
  const add = (title, body, extra = {}) => steps.push({ title, body, ...extra });
  const partNames = (role) => { const m = parts.filter((p) => p.role === role); return m.length ? `${m.length}× ${m[0].name}` : null; };
  const thicknessOf = (role) => { const p = parts.find((x) => x.role === role); return p ? p.cut.thickness : 19; };

  add("Mill and label every part", "Cut all parts to the dimensions in the cut list, then label each one in pencil.",
    { parts: ["All parts"], joint: null, fasteners: "none", tip: "Mark the show faces now so grain and color decisions happen once, not mid-glue-up.",
      why: beginner ? "Cutting everything first means every later step is pure assembly — no stopping to re-measure with glue open." : null });

  if (LEG_APRON_TYPES.includes(spec.furnitureType)) {
    const aj = jointFor(spec.joinery, "apron", "leg") || "pocket_screws";
    add("Build the two side frames (sub-assemblies)", `Join a short apron between a pair of legs: ${jointPrep(aj)}, then glue and clamp each side frame flat on the bench. Make two.`,
      { parts: [partNames("leg"), "2× Apron (short)"].filter(Boolean), joint: aj, fasteners: fastenersText(aj, thicknessOf("apron")), tip: JOINT_TIPS[aj],
        why: beginner ? "Two flat sub-assemblies are far easier to keep square than one four-legged glue-up." : null,
        check: beginner ? "Measure both diagonals of each frame — equal diagonals mean square." : null });
    add("Join the side frames with the long aprons", `Stand the side frames up and connect them with the long aprons using the same joinery. Clamp and set the base on a flat surface.`,
      { parts: ["2× Side frame", "2× Apron (long)"], joint: aj, fasteners: fastenersText(aj, thicknessOf("apron")), tip: "Dry-fit the whole base once before any glue touches wood.",
        check: beginner ? "Check diagonals across the top of the base and rack it square before the glue sets." : null });
    const shelf = parts.find((p) => p.role === "shelf");
    if (shelf) {
      const sj = jointFor(spec.joinery, "shelf", "leg") || jointFor(spec.joinery, "shelf", "apron") || "butt_screws";
      add("Install the lower shelf", `Fit the lower shelf between the legs at shelf height${sj === "dados" ? ", seating it fully into its dados" : ""}.`,
        { parts: ["1× Lower shelf"], joint: sj, fasteners: fastenersText(sj, shelf.cut.thickness), tip: JOINT_TIPS[sj] });
    }
    const st = parts.filter((p) => p.role === "stretcher");
    if (st.length) {
      const sj = jointFor(spec.joinery, "stretcher", "leg") || "dowels";
      add("Install the stretchers", "Fit the stretchers between the leg pairs at stretcher height.",
        { parts: [`${st.length}× Stretcher`], joint: sj, fasteners: fastenersText(sj, st[0].cut.thickness), tip: JOINT_TIPS[sj] });
    }
    add("Attach the top", "Center the top on the base (equal overhang all around) and fasten it from below through the aprons. IMPORTANT: solid wood moves with humidity — use slotted screw holes or tabletop fasteners (Z-clips) and never glue the top across the grain.",
      { parts: ["1× Top", "Base assembly"], joint: jointFor(spec.joinery, "top", "apron") || "butt_screws",
        fasteners: `#8 × ${snapScrew(thicknessOf("apron"))} mm screws in slotted holes, or tabletop fasteners`,
        tip: "Elongate the outer screw holes across the grain so seasonal movement doesn't crack the top.",
        why: beginner ? "A solid top can move several millimeters across its width through the year; rigid fastening is what splits tabletops." : null });
  } else if (CARCASS_TYPES.includes(spec.furnitureType)) {
    const sj = jointFor(spec.joinery, "shelf", "side") || "butt_screws";
    const bj = jointFor(spec.joinery, "back", "side") || "butt_screws";
    add("Prepare the case sides (sub-assembly prep)", `Lay the two sides inside-face up and ${jointPrep(sj)} for the top, bottom and every fixed shelf${bj === "rabbets" ? "; then cut the back-panel rabbets along the rear inside edges" : ""}.`,
      { parts: ["2× Side"], joint: sj, fasteners: "none yet", tip: JOINT_TIPS[sj],
        why: beginner ? "All machining happens while the sides are flat on the bench — far more accurate than working on a standing case." : null });
    add("Join the top and bottom between the sides", "Stand the sides up and fix the top and bottom panels between them to form the case.",
      { parts: ["2× Side", "1× Top", "1× Bottom"], joint: sj, fasteners: fastenersText(sj, thicknessOf("top")), tip: "Assemble on a known-flat surface so the case can't take a twist.",
        check: beginner ? "Measure both diagonals of the case opening — adjust clamps until they match." : null });
    const shelves = parts.filter((p) => p.role === "shelf");
    if (shelves.length) add("Install the shelves", `Slide the ${shelves.length} shelf${shelves.length > 1 ? "s" : ""} into position${sj === "dados" ? ", seating each fully into its dado" : ""} and fasten.`,
      { parts: [`${shelves.length}× Shelf`], joint: sj, fasteners: fastenersText(sj, shelves[0].cut.thickness), tip: JOINT_TIPS[sj] });
    if (parts.find((p) => p.role === "divider")) add("Install the center divider", "Fit the vertical divider at mid-span between the bottom and top — it carries the long shelves.",
      { parts: ["1× Center divider"], joint: sj, fasteners: fastenersText(sj, thicknessOf("divider")), tip: "Cut it a hair long and shave to a press fit." });
    add("Fit the back panel", `Square the case, then fasten the back panel ${bj === "rabbets" ? "into its rabbets" : "over the back edges"}.`,
      { parts: ["1× Back panel"], joint: bj, fasteners: `#8 × ${snapScrew(6)} mm screws (or 18 ga brads) + glue`, tip: "The back is what keeps the case square forever — fasten it only after the diagonals match.",
        why: beginner ? "A thin back panel acts as a shear panel; it locks the whole case against racking." : null });
  } else {
    for (const j of spec.joinery) {
      const [a, b] = j.connects;
      add(`Join ${a.replace(/_/g, " ")} to ${b.replace(/_/g, " ")}`, `${jointPrep(j.joint)}, then assemble and clamp.`,
        { parts: [partNames(a), partNames(b)].filter(Boolean), joint: j.joint, fasteners: fastenersText(j.joint, Math.min(thicknessOf(a), thicknessOf(b))), tip: JOINT_TIPS[j.joint] });
    }
    if (!spec.joinery.length) add("Assemble the parts", "Join the parts per your design intent.", { parts: ["All parts"], joint: null, fasteners: "as appropriate", tip: "Dry-fit everything before glue." });
  }

  add("Sand and finish", "Sand everything through 120 → 180 → 220 grit, break the sharp edges, then apply finish to all faces (including the underside of tops and shelves).",
    { parts: ["Whole piece"], joint: null, fasteners: "none", tip: "Finish both faces of wide solid panels equally, or uneven moisture exchange will cup them.",
      why: beginner ? "Wipe-on Danish oil is the most forgiving first finish: wipe on, wait, wipe off." : null });

  const toolSet = new Set(BASE_TOOLS);
  for (const j of spec.joinery) (JOINT_TOOLS[j.joint] || []).forEach((t) => toolSet.add(t));
  return { steps, tools: [...toolSet] };
}

/* ============================== AI layer: intent only, never arithmetic ============================== */

function examplePrompt(level) {
  const allowed = JOINTS_BY_LEVEL[level];
  const joint = allowed.includes("mortise_tenon") ? "mortise_tenon" : allowed.includes("dowels") ? "dowels" : "pocket_screws";
  return JSON.stringify({ name: "Oak Coffee Table", furnitureType: "table",
    overall: { width: 1100, depth: 600, height: 450 }, material: { species: "oak" },
    features: ["lower_shelf"], joinery: [{ joint, connects: ["apron", "leg"] }],
    designNotes: "Low, sturdy coffee table with a lower shelf." });
}

function buildSystemPrompt(level, spec) {
  const allowed = JOINTS_BY_LEVEL[level];
  return [
    "You are the design-intent engine for Blueprint Buddy, a woodworking plan generator.",
    "Return ONLY minified JSON (no whitespace, no markdown fences, no preamble, no trailing text) matching this DesignSpec schema:",
    '{"name":string,"furnitureType":"table"|"bookshelf"|"bench"|"desk"|"cabinet"|"nightstand"|"other","overall":{"width":mm,"depth":mm,"height":mm},"material":{"species":string},"features":[string],"joinery":[{"joint":string,"connects":[roleA,roleB]}],"designNotes":string,"parts":[...only when furnitureType is "other"]}',
    `Allowed joint types for this user's experience level (${level}): ${allowed.join(", ")}. Never use any other joint.`,
    'Valid connects roles — leg-and-apron types (table/desk/bench/nightstand): top, leg, apron, shelf, stretcher. Carcass types (bookshelf/cabinet): side, top, bottom, shelf, back.',
    "You describe INTENT only. Code derives every part, dimension, position, and joinery allowance from your spec; any part sizes you supply for known furniture types are ignored. Omit \"parts\" entirely unless furnitureType is \"other\" (then supply 2-40 parts with positive mm dimensions, each {\"id\",\"role\",\"quantity\",\"dimensions\":{\"length\",\"width\",\"thickness\"},\"grainDirection\":\"length\"|\"width\",\"stock\":\"solid\"|\"sheet\"}).",
    "All dimensions in millimeters, each overall dimension 100-3000. Species: oak, maple, walnut, cherry, pine, or plywood. Use feature \"lower_shelf\" for a shelf under a table, or \"N shelves\" for shelf count in a bookshelf/cabinet.",
    "REFINEMENTS: when a current spec is provided below and the user asks for a change, EDIT that spec — change only what they asked for and keep everything else identical. Do not redesign. Omit optional fields you are not changing.",
    spec ? `Current spec: ${JSON.stringify(spec)}` : "There is no current design yet.",
    `Example response: ${examplePrompt(level)}`,
  ].join("\n");
}

async function callClaude(system, messages) {
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: "claude-sonnet-4-6", max_tokens: 1000, system, messages }),
  });
  if (!response.ok) throw new Error(`API returned ${response.status}`);
  const data = await response.json();
  if (data.error) throw new Error(data.error.message || "API error");
  return (data.content || []).map((b) => b.text || "").join("");
}

// Strip anything before the first "{" and after the last "}", drop code fences, then parse.
function extractJSON(text) {
  try {
    const cleaned = String(text).replace(/```[a-zA-Z]*/g, "");
    const i = cleaned.indexOf("{"), j = cleaned.lastIndexOf("}");
    if (i < 0 || j <= i) return null;
    return JSON.parse(cleaned.slice(i, j + 1));
  } catch { return null; }
}

/* ---------- experience-level joinery regeneration ---------- */

const JOINT_FALLBACK = {
  mortise_tenon: ["mortise_tenon", "dowels", "pocket_screws"],
  half_lap: ["half_lap", "dowels", "pocket_screws"],
  dados: ["dados", "butt_screws"],
  rabbets: ["rabbets", "butt_screws"],
  dowels: ["dowels", "pocket_screws"],
  pocket_screws: ["pocket_screws"],
  butt_screws: ["butt_screws"],
};
function regenerateJoinery(spec, level) {
  const allowed = JOINTS_BY_LEVEL[level];
  const joinery = spec.joinery.map((j) => ({ ...j, joint: (JOINT_FALLBACK[j.joint] || ["butt_screws"]).find((x) => allowed.includes(x)) || "butt_screws" }));
  return { ...spec, joinery, designNotes: spec.designNotes };
}
const specUsesDisallowed = (spec, level) => spec.joinery.some((j) => !JOINTS_BY_LEVEL[level].includes(j.joint));

/* ============================== 3D viewer (one renderer, refs only, no setState in the loop) ============================== */

const ROLE_COLORS = {
  top: "#b98a5e", leg: "#7d5a3c", apron: "#96714e", stretcher: "#96714e",
  shelf: "#c19a6b", side: "#a9805b", bottom: "#a9805b", back: "#d9c3a3",
  divider: "#b08a63", generic: "#a1795a",
};

function Viewer({ parts, explodeTarget, onSelect }) {
  const containerRef = useRef(null);
  const R = useRef({});
  const onSelectRef = useRef(onSelect);
  useEffect(() => { onSelectRef.current = onSelect; }, [onSelect]);
  useEffect(() => { R.current.explodeTarget = explodeTarget; }, [explodeTarget]);

  // Renderer / scene / camera / lights: created exactly once, torn down fully on unmount.
  useEffect(() => {
    const el = containerRef.current;
    const r = R.current;
    r.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    r.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    r.renderer.shadowMap.enabled = true;
    r.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    const dom = r.renderer.domElement;
    dom.style.touchAction = "none";
    dom.style.display = "block";
    dom.style.cursor = "grab";
    el.appendChild(dom);

    r.scene = new THREE.Scene();
    r.camera = new THREE.PerspectiveCamera(40, 1, 0.01, 100);
    r.scene.add(new THREE.HemisphereLight(0xfff4e6, 0x8a7a66, 0.95));
    r.key = new THREE.DirectionalLight(0xffffff, 1.05);
    r.key.castShadow = true;
    r.key.shadow.mapSize.set(2048, 2048);
    r.key.shadow.bias = -0.0004;
    r.scene.add(r.key);
    r.scene.add(r.key.target);
    r.groundGeo = new THREE.PlaneGeometry(40, 40);
    r.groundMat = new THREE.ShadowMaterial({ opacity: 0.22 });
    const ground = new THREE.Mesh(r.groundGeo, r.groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    r.scene.add(ground);
    r.group = new THREE.Group();
    r.scene.add(r.group);

    // Motion state (all refs; the loop only reads/writes these).
    r.explode = 0; r.explodeTarget = r.explodeTarget || 0;
    r.sph = { radius: 2.5, theta: 0.65, phi: 1.1 };
    r.sphT = { radius: 2.5, theta: 0.65, phi: 1.1 };
    r.orbitTarget = new THREE.Vector3(0, 0.3, 0);
    r.orbitTargetT = new THREE.Vector3(0, 0.3, 0);
    r.frameDist = 2.5;
    r.clock = new THREE.Clock();

    const loop = () => {
      r.raf = requestAnimationFrame(loop);
      const dt = Math.min(r.clock.getDelta(), 0.05);
      const k = Math.min(1, dt * 5), kc = Math.min(1, dt * 6);
      r.explode += (r.explodeTarget - r.explode) * k;
      r.sph.radius += (r.sphT.radius - r.sph.radius) * kc;
      r.sph.theta += (r.sphT.theta - r.sph.theta) * kc;
      r.sph.phi += (r.sphT.phi - r.sph.phi) * kc;
      r.orbitTarget.lerp(r.orbitTargetT, kc);
      r.camera.position.set(
        r.orbitTarget.x + r.sph.radius * Math.sin(r.sph.phi) * Math.sin(r.sph.theta),
        r.orbitTarget.y + r.sph.radius * Math.cos(r.sph.phi),
        r.orbitTarget.z + r.sph.radius * Math.sin(r.sph.phi) * Math.cos(r.sph.theta));
      r.camera.lookAt(r.orbitTarget);
      for (const m of r.group.children)
        m.position.copy(m.userData.assembled).addScaledVector(m.userData.explodeVec, r.explode);
      r.renderer.render(r.scene, r.camera);
    };
    loop();

    const ro = new ResizeObserver(() => {
      const w = el.clientWidth, h = el.clientHeight;
      if (!w || !h) return;
      r.renderer.setSize(w, h);
      r.camera.aspect = w / h;
      r.camera.updateProjectionMatrix();
    });
    ro.observe(el);

    // Custom orbit: spherical coords + damping; Pointer Events with capture; pinch via two pointers.
    const pointers = new Map();
    let moved = 0, lastX = 0, lastY = 0, prevPinch = 0;
    const setHighlight = (mesh) => {
      if (r.selMesh) r.selMesh.material.emissive.setHex(0x000000);
      r.selMesh = mesh || null;
      if (mesh) mesh.material.emissive.setHex(0x6b3f14);
    };
    r.setHighlight = setHighlight;
    const raycaster = new THREE.Raycaster();
    const pickAt = (clientX, clientY) => {
      const rect = dom.getBoundingClientRect();
      const nx = ((clientX - rect.left) / rect.width) * 2 - 1;
      const ny = -((clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(new THREE.Vector2(nx, ny), r.camera);
      const hits = raycaster.intersectObjects(r.group.children, false);
      const mesh = hits.length ? hits[0].object : null;
      setHighlight(mesh);
      onSelectRef.current(mesh ? mesh.userData.part : null);
    };
    const onDown = (e) => {
      dom.setPointerCapture(e.pointerId);
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      moved = 0; lastX = e.clientX; lastY = e.clientY;
      dom.style.cursor = "grabbing";
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        prevPinch = Math.hypot(a.x - b.x, a.y - b.y);
      }
    };
    const onMove = (e) => {
      if (!pointers.has(e.pointerId)) return;
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.size === 1) {
        const dx = e.clientX - lastX, dy = e.clientY - lastY;
        moved += Math.abs(dx) + Math.abs(dy);
        r.sphT.theta -= dx * 0.006;
        r.sphT.phi = clamp(r.sphT.phi - dy * 0.006, 0.1, 1.5);
        lastX = e.clientX; lastY = e.clientY;
      } else if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (prevPinch > 0 && d > 0)
          r.sphT.radius = clamp(r.sphT.radius * (prevPinch / d), 0.4 * r.frameDist, 4 * r.frameDist);
        prevPinch = d;
        moved += 10;
      }
    };
    const onUp = (e) => {
      if (!pointers.has(e.pointerId)) return;
      pointers.delete(e.pointerId);
      try { dom.releasePointerCapture(e.pointerId); } catch {}
      if (pointers.size < 2) prevPinch = 0;
      if (pointers.size === 0) dom.style.cursor = "grab";
      if (e.type === "pointerup" && moved < 5 && pointers.size === 0) pickAt(e.clientX, e.clientY);
    };
    const onWheel = (e) => {
      e.preventDefault();
      r.sphT.radius = clamp(r.sphT.radius * (e.deltaY > 0 ? 1.1 : 0.9), 0.4 * r.frameDist, 4 * r.frameDist);
    };
    dom.addEventListener("pointerdown", onDown);
    dom.addEventListener("pointermove", onMove);
    dom.addEventListener("pointerup", onUp);
    dom.addEventListener("pointercancel", onUp);
    dom.addEventListener("wheel", onWheel, { passive: false });

    return () => {
      cancelAnimationFrame(r.raf);
      ro.disconnect();
      dom.removeEventListener("pointerdown", onDown);
      dom.removeEventListener("pointermove", onMove);
      dom.removeEventListener("pointerup", onUp);
      dom.removeEventListener("pointercancel", onUp);
      dom.removeEventListener("wheel", onWheel);
      for (const m of [...r.group.children]) { m.geometry.dispose(); m.material.dispose(); r.group.remove(m); }
      r.groundGeo.dispose(); r.groundMat.dispose();
      r.renderer.dispose();
      el.removeChild(dom);
    };
  }, []);

  // Rebuild the model on spec change: dispose every old geometry/material, then rebuild + reframe.
  useEffect(() => {
    const r = R.current;
    if (!r.group) return;
    r.setHighlight(null);
    for (const m of [...r.group.children]) { m.geometry.dispose(); m.material.dispose(); r.group.remove(m); }
    if (!parts.length) return;

    let minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9, minZ = 1e9, maxZ = -1e9;
    for (const p of parts) {
      minX = Math.min(minX, p.pos.x - p.size.x / 2); maxX = Math.max(maxX, p.pos.x + p.size.x / 2);
      minY = Math.min(minY, p.pos.y - p.size.y / 2); maxY = Math.max(maxY, p.pos.y + p.size.y / 2);
      minZ = Math.min(minZ, p.pos.z - p.size.z / 2); maxZ = Math.max(maxZ, p.pos.z + p.size.z / 2);
    }
    const cx = (minX + maxX) / 2, cz = (minZ + maxZ) / 2, cy = (minY + maxY) / 2;
    const sizeX = maxX - minX, sizeY = maxY - minY, sizeZ = maxZ - minZ;
    const radius = 0.5 * Math.hypot(sizeX, sizeY, sizeZ) / 1000; // bounding sphere, meters
    const modelCenter = new THREE.Vector3(0, cy / 1000, 0);

    for (const p of parts) {
      const geo = new THREE.BoxGeometry(p.size.x / 1000, p.size.y / 1000, p.size.z / 1000);
      const mat = new THREE.MeshStandardMaterial({ color: ROLE_COLORS[p.role] || ROLE_COLORS.generic, roughness: 0.75, metalness: 0.05 });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.castShadow = true; mesh.receiveShadow = true;
      const assembled = new THREE.Vector3((p.pos.x - cx) / 1000, p.pos.y / 1000, (p.pos.z - cz) / 1000);
      // Explosion vector: radial from model center, with role bias. Magnitude = bounding radius x 0.6.
      const v = assembled.clone().sub(modelCenter);
      if (v.lengthSq() < 1e-8) v.set(0, 1, 0);
      v.normalize();
      if (p.bias === "up") { v.x *= 0.3; v.z *= 0.3; v.y = Math.max(v.y, 0) + 1.2; }
      else if (p.bias === "leg") { v.x *= 1.3; v.z *= 1.3; v.y = -0.35; }
      else if (p.bias === "back") { v.x *= 0.2; v.y *= 0.2; v.z = -(Math.abs(v.z) + 1.2); }
      else if (p.bias === "side") { v.y *= 0.2; v.z *= 0.2; v.x = (assembled.x >= 0 ? 1 : -1) * 1.2; }
      v.normalize().multiplyScalar(radius * 0.6);
      mesh.userData = { assembled, explodeVec: v, part: p };
      mesh.position.copy(assembled);
      r.group.add(mesh);
    }

    // Auto-frame: distance = (maxDim/2) / tan(fov/2) x 1.4 margin; ease there, never teleport.
    const maxDim = Math.max(sizeX, sizeY, sizeZ) / 1000;
    const dist = (maxDim / 2) / Math.tan(THREE.MathUtils.degToRad(r.camera.fov / 2)) * 1.4;
    r.frameDist = dist;
    r.sphT.radius = dist;
    r.sphT.phi = clamp(r.sphT.phi, 0.9, 1.25);
    r.orbitTargetT.set(0, cy / 1000, 0);
    r.key.position.set(dist * 0.9, dist * 1.2, dist * 0.6);
    r.key.target.position.set(0, cy / 1000, 0);
    const s = Math.max(1, radius * 2.4);
    const sc = r.key.shadow.camera;
    sc.left = -s; sc.right = s; sc.top = s; sc.bottom = -s; sc.far = dist * 6;
    sc.updateProjectionMatrix();
  }, [parts]);

  return <div ref={containerRef} className="absolute inset-0" />;
}

/* ============================== app ============================== */

export default function BlueprintBuddy() {
  const [unit, setUnit] = useState("in");
  const [level, setLevel] = useState("advanced");
  const [spec, setSpec] = useState(() => validateSpec(SEED_SPEC, "advanced").spec);
  const [pendingLevel, setPendingLevel] = useState(null);
  const [explodeVal, setExplodeVal] = useState(0);
  const [selected, setSelected] = useState(null);
  const [tab, setTab] = useState("cut");
  const [mobileTab, setMobileTab] = useState("cut");
  const [messages, setMessages] = useState([{ who: "ai", text: "Welcome to the shop! I've seeded a walnut nightstand so you can explore every panel right away. Describe any piece — “a 6-foot oak dining table with a lower shelf”, “a tall maple bookshelf” — or refine this one: “make it 100mm shorter”, “switch to cherry”." }]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const apiHistory = useRef([]);

  const { parts, notes } = useMemo(() => runParametric(spec), [spec]);
  const cutRows = useMemo(() => makeCutList(parts, spec.material.species), [parts, spec]);
  const bom = useMemo(() => makeBOM(spec, parts), [spec, parts]);
  const asm = useMemo(() => makeAssembly(spec, parts, notes, level), [spec, parts, notes, level]);
  useEffect(() => { setSelected(null); }, [parts]);

  const onSelect = useCallback((p) => setSelected(p), []);
  const pushMsg = (who, text) => setMessages((m) => [...m, { who, text }]);

  async function send() {
    const text = input.trim();
    if (!text || busy) return;
    setInput("");
    pushMsg("user", text);
    setBusy(true);
    const sys = buildSystemPrompt(level, spec);
    const hist = [...apiHistory.current, { role: "user", content: text }].slice(-12);
    try {
      // Attempt 1: parse -> merge onto current spec -> validate -> parametric layer.
      let reply = await callClaude(sys, hist);
      let parsed = extractJSON(reply);
      let merged = parsed ? mergeSpec(spec, parsed) : null;
      let v = merged ? validateSpec(merged, level) : { spec: null, errors: ["Response was not parseable JSON."] };
      if (!v.spec) {
        // One retry with the specific errors appended.
        const hist2 = [...hist, { role: "assistant", content: reply || "(empty)" },
          { role: "user", content: `Your last response had these problems: ${v.errors.join(" ")} Return the corrected FULL DesignSpec as minified JSON only — nothing else.` }];
        reply = await callClaude(sys, hist2);
        parsed = extractJSON(reply);
        merged = parsed ? mergeSpec(spec, parsed) : null;
        v = merged ? validateSpec(merged, level) : { spec: null, errors: ["Second response was not parseable JSON."] };
      }
      if (v.spec) {
        setSpec(v.spec);
        // Store the CORRECTED spec as the assistant turn so future refinements edit reality, not the model's memory.
        apiHistory.current = [...hist, { role: "assistant", content: JSON.stringify(v.spec) }].slice(-12);
        pushMsg("ai", `Updated “${v.spec.name}” — ${v.spec.overall.width}×${v.spec.overall.depth}×${v.spec.overall.height} mm ${v.spec.material.species}. ${v.spec.designNotes || ""}`.trim());
      } else {
        apiHistory.current = hist.slice(0, -1);
        pushMsg("error", `I couldn't get a valid design from the model after a retry: ${v.errors.slice(0, 3).join(" ")} Your last valid design is still shown — try rephrasing.`);
      }
    } catch (err) {
      apiHistory.current = hist.slice(0, -1);
      pushMsg("error", `The design service is unreachable (${err.message}). Everything else still works — try again in a moment.`);
    }
    setBusy(false);
  }

  function requestLevel(next) {
    if (next === level) return;
    if (specUsesDisallowed(spec, next)) setPendingLevel(next);
    else { setLevel(next); setPendingLevel(null); }
  }
  function applyPendingLevel(regen) {
    if (regen) setSpec((s) => regenerateJoinery(s, pendingLevel));
    setLevel(pendingLevel);
    setPendingLevel(null);
  }

  const toggleExplode = () => setExplodeVal((v) => (v < 0.5 ? 1 : 0));
  const seg = (active) => `px-2.5 py-1 text-xs font-semibold rounded-md transition-colors ${active ? "bg-amber-600 text-white" : "text-stone-300 hover:text-white"}`;
  const tabBtn = (active) => `px-3 py-2 text-xs font-semibold border-b-2 transition-colors ${active ? "border-amber-600 text-amber-800" : "border-transparent text-stone-500 hover:text-stone-800"}`;

  const renderChat = () => (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex-1 min-h-0 overflow-y-auto p-3 space-y-2.5" ref={(el) => { if (el) el.scrollTop = el.scrollHeight; }}>
        {messages.map((m, i) => (
          <div key={i} className={`text-sm leading-relaxed rounded-xl px-3 py-2 ${m.who === "user" ? "bg-amber-600 text-white ml-8" : m.who === "error" ? "bg-red-50 text-red-800 border border-red-200 mr-8" : "bg-stone-100 text-stone-800 mr-8"}`}>{m.text}</div>
        ))}
        {busy && <div className="bg-stone-100 text-stone-500 rounded-xl px-3 py-2 mr-8 text-sm animate-pulse">Drafting your design…</div>}
      </div>
      <div className="p-3 border-t border-stone-200 flex gap-2">
        <input value={input} onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") send(); }} disabled={busy}
          placeholder="Describe or refine a piece…"
          className="flex-1 min-w-0 text-sm rounded-lg border border-stone-300 px-3 py-2 bg-white text-stone-900 placeholder-stone-400 focus:outline-none focus:border-amber-600 disabled:opacity-60" />
        <button onClick={send} disabled={busy || !input.trim()}
          className="px-3 py-2 rounded-lg bg-amber-600 text-white text-sm font-semibold hover:bg-amber-700 disabled:opacity-40">Send</button>
      </div>
    </div>
  );

  const renderPlans = (t) => t === "cut" ? (
    <div className="p-3">
      <div className="flex items-center justify-between mb-2">
        <div className="text-xs text-stone-500">{cutRows.reduce((s, r) => s + r.qty, 0)} pieces · cut lengths include joinery allowances</div>
        <button onClick={() => cutListCSV(cutRows, unit, spec.name)} className="px-2.5 py-1 rounded-md bg-stone-800 text-white text-xs font-semibold hover:bg-stone-700">Export CSV</button>
      </div>
      <table className="w-full text-xs">
        <thead><tr className="text-left text-stone-500 border-b border-stone-200">
          <th className="py-1.5 pr-2 font-semibold">Part</th><th className="py-1.5 pr-2 font-semibold">Qty</th>
          <th className="py-1.5 pr-2 font-semibold">T × W × L ({UNIT_LABEL[unit]})</th>
          <th className="py-1.5 pr-2 font-semibold">Material</th><th className="py-1.5 font-semibold">Grain</th>
        </tr></thead>
        <tbody>{cutRows.map((r, i) => (
          <tr key={i} className="border-b border-stone-100 text-stone-800">
            <td className="py-1.5 pr-2 font-medium">{r.name}</td><td className="py-1.5 pr-2">{r.qty}</td>
            <td className="py-1.5 pr-2 whitespace-nowrap">{fmtLenBare(r.cut.thickness, unit)} × {fmtLenBare(r.cut.width, unit)} × {fmtLenBare(r.cut.length, unit)}</td>
            <td className="py-1.5 pr-2">{r.material}</td><td className="py-1.5">{r.grain}</td>
          </tr>))}
        </tbody>
      </table>
      <p className="mt-2 text-xs text-stone-500">Allow {fmtLen(KERF_MM, unit)} of saw kerf between adjacent cuts when laying out stock.</p>
    </div>
  ) : t === "bom" ? (
    <div className="p-3 space-y-4">
      {bom.sections.map((s) => (
        <div key={s.title}>
          <div className="text-xs font-bold uppercase tracking-wide text-stone-500 mb-1">{s.title}</div>
          {s.rows.map((r, i) => (
            <div key={i} className="flex items-baseline justify-between gap-2 py-1 border-b border-stone-100 text-xs text-stone-800">
              <span className="min-w-0">{r.label} <span className="text-stone-400">× {r.qty}</span></span>
              <span className="whitespace-nowrap font-medium">{money(r.cost)}</span>
            </div>))}
          <div className="flex justify-between pt-1 text-xs font-semibold text-stone-600"><span>Subtotal</span><span>{money(s.subtotal)}</span></div>
        </div>))}
      <div className="flex justify-between items-baseline border-t-2 border-stone-300 pt-2 text-sm font-bold text-stone-900"><span>Total</span><span>{money(bom.total)}</span></div>
      <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-2">Estimate. Prices are placeholders; verify locally.</p>
    </div>
  ) : (
    <div className="p-3 space-y-4">
      <div>
        <div className="text-xs font-bold uppercase tracking-wide text-stone-500 mb-1.5">Tools you'll need</div>
        <div className="flex flex-wrap gap-1.5">{asm.tools.map((tl) => <span key={tl} className="px-2 py-0.5 rounded-full bg-stone-100 text-stone-700 text-xs">{tl}</span>)}</div>
      </div>
      {(spec.designNotes || notes.length > 0) && (
        <div className="text-xs text-stone-700 bg-stone-50 border border-stone-200 rounded-lg p-2 space-y-1">
          {spec.designNotes && <p className="italic">{spec.designNotes}</p>}
          {notes.map((n, i) => <p key={i}>• {n}</p>)}
        </div>)}
      <ol className="space-y-3">
        {asm.steps.map((s, i) => (
          <li key={i} className="border border-stone-200 rounded-lg p-2.5">
            <div className="text-sm font-semibold text-stone-900">{i + 1}. {s.title}</div>
            <p className="text-xs text-stone-700 mt-1">{s.body}</p>
            <p className="text-xs text-stone-500 mt-1.5">
              Parts: {(s.parts || []).join(", ")}{s.joint ? ` · Joint: ${JOINT_LABEL[s.joint]}` : ""} · Fasteners: {s.fasteners}
            </p>
            <p className="text-xs text-amber-800 mt-1">Tip: {s.tip}</p>
            {level === "beginner" && s.why && <p className="text-xs text-stone-600 mt-1">Why: {s.why}</p>}
            {level === "beginner" && s.check && <p className="text-xs text-emerald-700 mt-1">✓ {s.check}</p>}
          </li>))}
      </ol>
    </div>
  );

  return (
    <div className="h-screen flex flex-col bg-stone-100 text-stone-900" style={{ fontFamily: "ui-sans-serif, system-ui, sans-serif" }}>
      <header className="bg-stone-900 text-stone-100 px-4 py-2.5 flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="flex items-baseline gap-2 mr-auto">
          <span className="text-lg font-black tracking-tight"><span className="text-amber-500">Blueprint</span> Buddy</span>
          <span className="hidden sm:inline text-xs text-stone-400">describe it · preview it · build it</span>
        </div>
        <div className="flex items-center gap-1 bg-stone-800 rounded-lg p-0.5">
          {["in", "cm", "mm"].map((u) => <button key={u} onClick={() => setUnit(u)} className={seg(unit === u)}>{u}</button>)}
        </div>
        <select value={level} onChange={(e) => requestLevel(e.target.value)}
          className="bg-stone-800 text-stone-100 text-xs font-semibold rounded-lg px-2 py-1.5 border border-stone-700 focus:outline-none">
          <option value="beginner">Beginner</option><option value="intermediate">Intermediate</option><option value="advanced">Advanced</option>
        </select>
        <div className="flex items-center gap-2">
          <button onClick={toggleExplode} className="px-2.5 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-700 text-white text-xs font-semibold">
            {explodeVal < 0.5 ? "Explode" : "Assemble"}
          </button>
          <input type="range" min="0" max="1" step="0.01" value={explodeVal}
            onChange={(e) => setExplodeVal(parseFloat(e.target.value))}
            className="w-24" style={{ accentColor: "#d97706" }} />
        </div>
      </header>

      {pendingLevel && (
        <div className="bg-amber-50 border-b border-amber-200 px-4 py-2 flex flex-wrap items-center gap-2 text-xs text-amber-900">
          <span className="font-medium">This design uses joinery beyond the {pendingLevel} toolkit. Regenerate the joints to fit?</span>
          <button onClick={() => applyPendingLevel(true)} className="px-2 py-1 rounded bg-amber-600 text-white font-semibold hover:bg-amber-700">Regenerate joinery</button>
          <button onClick={() => applyPendingLevel(false)} className="px-2 py-1 rounded bg-white border border-amber-300 font-semibold hover:bg-amber-100">Keep design as-is</button>
          <button onClick={() => setPendingLevel(null)} className="px-2 py-1 rounded text-amber-700 hover:bg-amber-100">Cancel</button>
        </div>
      )}

      <div className="flex-1 min-h-0 flex flex-col lg:flex-row">
        <aside className="hidden lg:flex flex-col w-80 bg-white border-r border-stone-200">{renderChat()}</aside>

        <main className="relative h-72 sm:h-80 lg:h-auto lg:flex-1 min-w-0 shrink-0 lg:shrink"
          style={{ background: "radial-gradient(ellipse at 50% 35%, #f7f1e6 0%, #e9dfcd 70%, #ddd0b8 100%)" }}>
          <Viewer parts={parts} explodeTarget={explodeVal} onSelect={onSelect} />
          <div className="absolute top-3 left-3 bg-white bg-opacity-90 rounded-lg shadow px-3 py-2 pointer-events-none max-w-xs">
            <div className="text-sm font-bold text-stone-900">{spec.name}</div>
            <div className="text-xs text-stone-600">{spec.furnitureType} · {fmtLen(spec.overall.width, unit)} W × {fmtLen(spec.overall.depth, unit)} D × {fmtLen(spec.overall.height, unit)} H · {spec.material.species}</div>
            <div className="text-xs text-stone-500 mt-0.5">{spec.joinery.map((j) => JOINT_LABEL[j.joint]).filter((v, i, a) => a.indexOf(v) === i).join(" · ")}</div>
          </div>
          {selected && (
            <div className="absolute bottom-3 left-3 bg-stone-900 bg-opacity-90 text-white rounded-lg shadow px-3 py-2 pointer-events-none">
              <div className="text-sm font-semibold">{selected.name}</div>
              <div className="text-xs text-stone-300">cut: {fmtDims(selected.cut, unit)}</div>
              <div className="text-xs text-stone-400">{selected.stock} · grain along {selected.grain}</div>
            </div>)}
          <div className="absolute bottom-3 right-3 text-xs text-stone-500 pointer-events-none">drag to orbit · wheel/pinch to zoom · click a part</div>
        </main>

        <aside className="hidden lg:flex flex-col w-96 bg-white border-l border-stone-200">
          <div className="flex border-b border-stone-200 px-2">
            <button onClick={() => setTab("cut")} className={tabBtn(tab === "cut")}>Cut List</button>
            <button onClick={() => setTab("bom")} className={tabBtn(tab === "bom")}>BOM</button>
            <button onClick={() => setTab("assembly")} className={tabBtn(tab === "assembly")}>Assembly</button>
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto">{renderPlans(tab)}</div>
        </aside>

        <div className="lg:hidden flex flex-col flex-1 min-h-0 bg-white border-t border-stone-200">
          <div className="flex border-b border-stone-200 px-1">
            <button onClick={() => setMobileTab("chat")} className={tabBtn(mobileTab === "chat")}>Chat</button>
            <button onClick={() => setMobileTab("cut")} className={tabBtn(mobileTab === "cut")}>Cut List</button>
            <button onClick={() => setMobileTab("bom")} className={tabBtn(mobileTab === "bom")}>BOM</button>
            <button onClick={() => setMobileTab("assembly")} className={tabBtn(mobileTab === "assembly")}>Assembly</button>
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto">
            {mobileTab === "chat" ? renderChat() : renderPlans(mobileTab)}
          </div>
        </div>
      </div>
    </div>
  );
}
