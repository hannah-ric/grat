// Blueprint Buddy — AI furniture design & build-plan generator (single-file artifact)
//
// Architecture (founding rule, unchanged: the AI proposes intent, code owns every number):
//   AI layer      -> returns a DesignSpec (intent only, JSON). For novel pieces it composes
//                    parametric primitives + an explicit connection graph, nothing more.
//   Parametric    -> code-owned templates/grammar derive every part, dimension, position.
//   Structural    -> Wood Handbook material data + beam/stability math judge the geometry.
//   Derived       -> cut list, BOM, assembly, exports, drawing sheet: pure functions of spec.
//
// Material property doctrine (USDA FPL Wood Handbook, values at 12% MC):
//   MOE  (GPa) -> stiffness ONLY: sag / deflection predictions.
//   MOR  (MPa) -> strength ONLY: breaking-load margins, safety factor 4.
//   SG         -> density (COG / tipping) and fastener / joint capacity scaling.
//   Janka(lbf) -> surface duty ONLY: dent & wear advisories. Never in sag or strength math.

import React, { useState, useRef, useEffect, useMemo, useCallback } from "react";
import * as THREE from "three";

/* ============================== constants & helpers ============================== */

const SOLID_THICKNESSES = [19, 25, 32, 38]; // 4/4, 5/4, 6/4, 8/4 surfaced, mm
const SHEET_THICKNESSES = [6, 12, 18];
const SCREW_SIZES = [25, 32, 40, 50, 63, 75]; // mm, #8
const KERF_MM = 3;
const GRAV = 9.81; // m/s²; loads enter as kg, all beam math is N·mm·MPa

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
const PRIMITIVES = ["post", "rail", "panel", "slab", "cylinder"];
const SURFACE_KINDS = ["seating", "worktop", "shelf", "none"];

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const snapTo = (arr, v) => arr.reduce((best, x) => (Math.abs(x - v) < Math.abs(best - v) ? x : best), arr[0]);
const snapSolid = (t) => snapTo(SOLID_THICKNESSES, t);
const snapSheet = (t) => snapTo(SHEET_THICKNESSES, t);
const nextSolidUp = (t) => SOLID_THICKNESSES.find((x) => x > t) || null;
// Screw length = 2–2.5x thickness of the part being fastened through, snapped to common sizes.
function snapScrew(throughThickness) {
  const lo = 2 * throughThickness, hi = 2.5 * throughThickness;
  const inRange = SCREW_SIZES.filter((s) => s >= lo && s <= hi);
  if (inRange.length) return inRange[inRange.length - 1];
  return snapTo(SCREW_SIZES, 2.25 * throughThickness);
}

/* ---------- units: internal math is always mm/N/MPa; conversion is display-only ---------- */

const DEFAULT_PREFS = {
  unitSystem: "in",     // "in" fractional inches | "ind" decimal inches | "cm" | "mm"
  precision: 16,         // fractional-inch denominator, 16 or 32
  dualUnits: false,      // secondary system in parentheses everywhere
  level: "advanced",     // experience level
  defaultLoad: "auto",   // default load preset for shelf surfaces ("auto" = by furniture type)
  annotations: true,     // dimension annotations default in the 3D view
  theme: "auto",         // "auto" | "light" | "dark"
  reducedMotion: "auto", // "auto" (follow OS) | "on"
};

function gcd(a, b) { return b ? gcd(b, a % b) : a; }
// mm -> fractional inches at the chosen precision, fraction reduced (never renders 8/16)
function inchesFrac(mm, den = 16) {
  let ticks = Math.round((mm / 25.4) * den);
  let whole = Math.floor(ticks / den);
  let num = ticks % den, d = den;
  if (num === 0) return `${whole}`;
  const g = gcd(num, d); num /= g; d /= g;
  return whole > 0 ? `${whole} ${num}/${d}` : `${num}/${d}`;
}
const isImperial = (p) => p.unitSystem === "in" || p.unitSystem === "ind";
function fmtOne(mm, sys, den) {
  if (sys === "in") return inchesFrac(mm, den) + '"';
  if (sys === "ind") return (mm / 25.4).toFixed(2) + '"';
  if (sys === "cm") return (mm / 10).toFixed(1) + " cm";
  return Math.round(mm) + " mm";
}
// Primary length with unit; dual-unit preference appends the other system: 750 mm (29 1/2")
function fmtLen(mm, prefs) {
  const p = fmtOne(mm, prefs.unitSystem, prefs.precision);
  if (!prefs.dualUnits) return p;
  const sec = isImperial(prefs) ? fmtOne(mm, "mm") : fmtOne(mm, "in", prefs.precision);
  return `${p} (${sec})`;
}
// Bare primary (unit lives in the table header); dual still appends the full secondary.
function fmtLenBare(mm, prefs) {
  const sys = prefs.unitSystem;
  const p = sys === "in" ? inchesFrac(mm, prefs.precision)
    : sys === "ind" ? (mm / 25.4).toFixed(2)
    : sys === "cm" ? (mm / 10).toFixed(1) : String(Math.round(mm));
  if (!prefs.dualUnits) return p;
  const sec = isImperial(prefs) ? fmtOne(mm, "mm") : fmtOne(mm, "in", prefs.precision);
  return `${p} (${sec})`;
}
const UNIT_LABEL = { in: "in", ind: "in", cm: "cm", mm: "mm" };
const fmtDims = (c, prefs) => `${fmtLen(c.thickness, prefs)} × ${fmtLen(c.width, prefs)} × ${fmtLen(c.length, prefs)}`;
const money = (n) => "$" + n.toFixed(2);
const fmtMM = (x) => (Math.round(x * 10) / 10).toFixed(1) + " mm";
const fmtDeg = (x) => (Math.round(x * 10) / 10) + "°";

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

/* ============================== materials science (Wood Handbook, FPL) ==============================
   moe GPa (stiffness -> sag), mor MPa (strength -> break margins), sg specific gravity at 12% MC
   (density, fastener/joint holding), janka lbf (surface duty ONLY). priceBF $/board-foot.        */

const SPECIES = {
  oak:     { label: "red oak",              moe: 12.5, mor: 99,  sg: 0.63, janka: 1290, priceBF: 8.5 },
  maple:   { label: "hard maple",           moe: 12.6, mor: 109, sg: 0.63, janka: 1450, priceBF: 7.5 },
  walnut:  { label: "black walnut",         moe: 11.6, mor: 101, sg: 0.55, janka: 1010, priceBF: 14 },
  cherry:  { label: "black cherry",         moe: 10.3, mor: 85,  sg: 0.50, janka: 950,  priceBF: 11 },
  pine:    { label: "eastern white pine",   moe: 8.5,  mor: 59,  sg: 0.35, janka: 380,  priceBF: 4.5 },
  // Effective MOE/MOR reduced ~20% vs solid birch: half the plies run cross-grain.
  plywood: { label: "Baltic birch plywood", moe: 10.0, mor: 55,  sg: 0.68, janka: 1260, priceBF: 5, sheet: true },
};
const speciesOf = (name) => SPECIES[name] || SPECIES.pine;
const densityOf = (name) => speciesOf(name).sg * 1000; // kg/m³ (approx at 12% MC)

/* ---------- load presets (user-selectable per surface in the Integrity panel) ---------- */

const LOAD_PRESETS = {
  display: { label: "Display items", detail: "10 kg/m",            kind: "udl",   kgPerM: 10 },
  books:   { label: "Books",         detail: "55 kg/m",            kind: "udl",   kgPerM: 55 },
  heavy:   { label: "Heavy storage", detail: "90 kg/m",            kind: "udl",   kgPerM: 90 },
  seating: { label: "Seated people", detail: "120 kg per seat",    kind: "seat",  kgSeat: 120 },
  worktop: { label: "Desk / table duty", detail: "75 kg + 90 kg lean", kind: "combo", kgDist: 75, kgEdge: 90 },
};
const PRESET_KEYS = ["display", "books", "heavy", "seating", "worktop"];

// Defaults by furniture type / declared surface; the user overrides per surface.
function defaultPresetFor(kind, furnitureType, defaultLoad) {
  if (kind === "seat") return "seating";
  if (kind === "top") return "worktop";
  if (defaultLoad && defaultLoad !== "auto") return defaultLoad; // shelf-kind surfaces honor the pref
  if (furnitureType === "bookshelf" || furnitureType === "cabinet") return "books";
  return "display";
}

/* ---------- joinery structural ratings (transparent heuristics, scaled by specific gravity) ----------
   rackPts: contribution per physical joint to the 0-100 racking score.
   capN: nominal shear/racking capacity per joint in N at SG 0.50; scales linearly with SG.      */

const JOINT_RATING = {
  butt_screws:   { rackPts: 2.0, capN: 500 },
  pocket_screws: { rackPts: 3.0, capN: 700 },
  dowels:        { rackPts: 3.5, capN: 800 },
  rabbets:       { rackPts: 3.5, capN: 900 },
  dados:         { rackPts: 4.0, capN: 1200 },
  half_lap:      { rackPts: 4.5, capN: 1400 },
  mortise_tenon: { rackPts: 6.0, capN: 2000 },
};
const sgFactor = (species) => speciesOf(species).sg / 0.5;

/* ---------- beam formulas (exact, SI: N, mm, MPa) ---------- */

const I_rect = (b, h) => (b * h * h * h) / 12; // rectangular section moment of inertia, mm⁴
const DEFL = {
  udlSS:     (w, L, E, I) => (5 * w * Math.pow(L, 4)) / (384 * E * I), // uniform, simply supported
  pointSS:   (P, L, E, I) => (P * Math.pow(L, 3)) / (48 * E * I),      // center point load
  udlCant:   (w, L, E, I) => (w * Math.pow(L, 4)) / (8 * E * I),       // cantilever, distributed
  pointCant: (P, L, E, I) => (P * Math.pow(L, 3)) / (3 * E * I),       // cantilever, end point load
};
const MOM = {
  udlSS:     (w, L) => (w * L * L) / 8,
  pointSS:   (P, L) => (P * L) / 4,
  udlCant:   (w, L) => (w * L * L) / 2,
  pointCant: (P, L) => P * L,
};
const SAFETY_FACTOR = 4; // standard for wood in non-engineered service

/* ============================== geometry math (pure, no three.js) ============================== */

const rad = (d) => (d * Math.PI) / 180;
// World rotation M = Rz(rz)·Ry(ry)·Rx(rx) — X applied first, then Y, then Z.
// three.js equivalent: mesh.rotation.set(rx, ry, rz, "ZYX"). Exports use the same convention.
function rotMat(rxDeg, ryDeg, rzDeg) {
  const cx = Math.cos(rad(rxDeg)), sx = Math.sin(rad(rxDeg));
  const cy = Math.cos(rad(ryDeg)), sy = Math.sin(rad(ryDeg));
  const cz = Math.cos(rad(rzDeg)), sz = Math.sin(rad(rzDeg));
  return [
    [cz * cy, cz * sy * sx - sz * cx, cz * sy * cx + sz * sx],
    [sz * cy, sz * sy * sx + cz * cx, sz * sy * cx - cz * sx],
    [-sy, cy * sx, cy * cx],
  ];
}
const mulMV = (M, v) => [
  M[0][0] * v[0] + M[0][1] * v[1] + M[0][2] * v[2],
  M[1][0] * v[0] + M[1][1] * v[1] + M[1][2] * v[2],
  M[2][0] * v[0] + M[2][1] * v[1] + M[2][2] * v[2],
];

// Oriented bounding box of a positioned part: center c[3], half extents e[3], rotation R.
function partOBB(p) {
  const r = p.rot || { x: 0, y: 0, z: 0 };
  return {
    c: [p.pos.x, p.pos.y, p.pos.z],
    e: [p.size.x / 2, p.size.y / 2, p.size.z / 2],
    R: rotMat(r.x || 0, r.y || 0, r.z || 0),
  };
}
function obbCorners(box) {
  const out = [];
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) {
    const local = [sx * box.e[0], sy * box.e[1], sz * box.e[2]];
    const w = mulMV(box.R, local);
    out.push([box.c[0] + w[0], box.c[1] + w[1], box.c[2] + w[2]]);
  }
  return out;
}
const col = (M, i) => [M[0][i], M[1][i], M[2][i]];
const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross3 = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

// Separating-axis OBB test. Returns null when separated, else the minimal overlap depth (mm).
function obbPenetration(A, B) {
  const axes = [];
  for (let i = 0; i < 3; i++) axes.push(col(A.R, i));
  for (let i = 0; i < 3; i++) axes.push(col(B.R, i));
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
    const c = cross3(col(A.R, i), col(B.R, j));
    const len = Math.hypot(c[0], c[1], c[2]);
    if (len > 1e-6) axes.push([c[0] / len, c[1] / len, c[2] / len]);
  }
  const d = [B.c[0] - A.c[0], B.c[1] - A.c[1], B.c[2] - A.c[2]];
  let minOverlap = Infinity;
  for (const ax of axes) {
    const rA = A.e[0] * Math.abs(dot3(ax, col(A.R, 0))) + A.e[1] * Math.abs(dot3(ax, col(A.R, 1))) + A.e[2] * Math.abs(dot3(ax, col(A.R, 2)));
    const rB = B.e[0] * Math.abs(dot3(ax, col(B.R, 0))) + B.e[1] * Math.abs(dot3(ax, col(B.R, 1))) + B.e[2] * Math.abs(dot3(ax, col(B.R, 2)));
    const overlap = rA + rB - Math.abs(dot3(ax, d));
    if (overlap <= 0) return null;
    if (overlap < minOverlap) minOverlap = overlap;
  }
  return minOverlap;
}

// Convex hull (Andrew monotone chain) of 2D points [[x,z],...], returned CCW.
function convexHull2D(pts) {
  const p = [...pts].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (p.length < 3) return p;
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower = [], upper = [];
  for (const pt of p) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], pt) <= 0) lower.pop();
    lower.push(pt);
  }
  for (const pt of [...p].reverse()) {
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], pt) <= 0) upper.pop();
    upper.push(pt);
  }
  lower.pop(); upper.pop();
  return lower.concat(upper); // CCW
}
// Signed distance from a point to a CCW convex polygon boundary: positive inside.
function polyInsideDistance(poly, pt) {
  if (poly.length < 3) return -Infinity;
  let min = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const ex = b[0] - a[0], ez = b[1] - a[1];
    const len = Math.hypot(ex, ez) || 1;
    // CCW: inside is to the left of each edge.
    const d = (ex * (pt[1] - a[1]) - ez * (pt[0] - a[0])) / len;
    if (d < min) min = d;
  }
  return min;
}

// Saw angles from a part rotation: deviation from the nearest square orientation,
// rounded to 0.5°. Rotation about Y (plan view) reads as a miter; X/Z tilt as a bevel.
// "Extreme" uses the effective compound angle acos(cos m · cos b) — a 40° miter with a
// 40° bevel is a >50° compound cut even though neither axis alone exceeds 45°.
function cutAngles(rot) {
  if (!rot) return null;
  const dev = (a) => {
    a = Math.abs(a) % 90;
    return Math.min(a, 90 - a);
  };
  const r05 = (a) => Math.round(a * 2) / 2;
  const miter = r05(dev(rot.y || 0));
  const bevel = r05(Math.max(dev(rot.x || 0), dev(rot.z || 0)));
  if (!miter && !bevel) return null;
  const effective = (Math.acos(Math.cos(rad(miter)) * Math.cos(rad(bevel))) * 180) / Math.PI;
  return { miter, bevel, compound: miter > 0 && bevel > 0, extreme: effective > 50 };
}

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
    connections: Array.isArray(patch.connections) ? patch.connections : base.connections,
    overrides: { ...(base.overrides || {}), ...(patch.overrides || {}) },
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
    connections: undefined, overrides: {},
  };
  if (!spec.furnitureType) errors.push(`furnitureType must be one of ${FURNITURE_TYPES.join(", ")}.`);

  for (const k of ["width", "depth", "height"]) {
    const v = Number(raw.overall && raw.overall[k]);
    if (!isFinite(v) || v < 100 || v > 3000) errors.push(`overall.${k} must be a number between 100 and 3000 mm (got ${raw.overall ? raw.overall[k] : "nothing"}).`);
    else spec.overall[k] = Math.round(v);
  }
  spec.material.species = String((raw.material && raw.material.species) || "pine").toLowerCase().trim();
  if (!SPECIES[spec.material.species]) spec.material.species = "pine";
  spec.features = (Array.isArray(raw.features) ? raw.features : []).map((f) => String(f).toLowerCase().trim()).slice(0, 12);
  spec.designNotes = String(raw.designNotes || "").slice(0, 500);

  // Code-owned tuning knobs (set by integrity fixes / templates honor them; never by the AI).
  const ovr = raw.overrides || {};
  for (const k of ["topThickness", "shelfThickness", "legThickness"]) {
    const v = Number(ovr[k]);
    if (isFinite(v) && v > 0) spec.overrides[k] = snapSolid(v);
  }

  const allowed = JOINTS_BY_LEVEL[level] || JOINTS_BY_LEVEL.beginner;
  const vocab = LEG_APRON_TYPES.includes(spec.furnitureType) ? ROLE_VOCAB.legApron
    : CARCASS_TYPES.includes(spec.furnitureType) ? ROLE_VOCAB.carcass : null;

  /* ---- novel-piece grammar: parametric primitives + explicit connection graph ----
     The AI composes; code guarantees it stands and can be built. Free-floating
     geometry, unknown primitives, or missing positions are validation errors.   */
  if (spec.furnitureType === "other") {
    const parts = Array.isArray(raw.parts) ? raw.parts : [];
    if (parts.length < 2 || parts.length > 40) errors.push(`furnitureType "other" requires 2–40 parts (got ${parts.length}).`);
    const ids = new Set();
    spec.parts = parts.slice(0, 40).map((p, i) => {
      const id = String(p.id || `part_${i + 1}`).slice(0, 40);
      if (ids.has(id)) errors.push(`Duplicate part id "${id}" — every part needs a unique id.`);
      ids.add(id);
      const primitive = PRIMITIVES.includes(p.primitive) ? p.primitive : null;
      if (!primitive) errors.push(`parts[${i}] (${id}): primitive must be one of ${PRIMITIVES.join(", ")}.`);
      const d = p.dimensions || {};
      const dims = { length: Number(d.length), width: Number(d.width), thickness: Number(d.thickness) };
      if (!isFinite(dims.length) || dims.length < 10 || dims.length > 3000) errors.push(`parts[${i}] (${id}): dimensions.length must be 10–3000 mm.`);
      if (!isFinite(dims.width) || dims.width < 5 || dims.width > 1500) errors.push(`parts[${i}] (${id}): dimensions.width must be 5–1500 mm.`);
      if (primitive === "cylinder") dims.thickness = dims.width; // width = diameter
      else if (!isFinite(dims.thickness) || dims.thickness < 3 || dims.thickness > 200) errors.push(`parts[${i}] (${id}): dimensions.thickness must be 3–200 mm.`);
      const stock = p.stock === "sheet" ? "sheet" : "solid";
      if (primitive !== "cylinder" && isFinite(dims.thickness) && dims.thickness > 0)
        dims.thickness = stock === "sheet" ? snapSheet(dims.thickness) : snapSolid(dims.thickness);
      const pos = p.position || {};
      const position = { x: Number(pos.x), y: Number(pos.y), z: Number(pos.z) };
      for (const k of ["x", "y", "z"]) {
        if (!isFinite(position[k]) || Math.abs(position[k]) > 3000)
          errors.push(`parts[${i}] (${id}): position.${k} is required (part CENTER in mm, y up from the floor).`);
      }
      let rotation = null;
      if (p.rotation && typeof p.rotation === "object") {
        rotation = { x: 0, y: 0, z: 0 };
        for (const k of ["x", "y", "z"]) {
          const v = Number(p.rotation[k]);
          if (isFinite(v)) rotation[k] = Math.round(clamp(v, -360, 360) * 10) / 10;
        }
        if (!rotation.x && !rotation.y && !rotation.z) rotation = null;
      }
      return {
        id, role: normRole(p.role || id), primitive: primitive || "rail",
        dimensions: dims, position, rotation,
        grainDirection: p.grainDirection === "width" ? "width" : "length", stock,
        loadBearing: !!p.loadBearing,
        surface: SURFACE_KINDS.includes(p.surface) ? p.surface : "none",
      };
    });

    const conns = Array.isArray(raw.connections) ? raw.connections : [];
    if (!conns.length) errors.push(`Novel pieces require a "connections" array — every part must connect to at least one other part through an explicit joint.`);
    spec.connections = [];
    for (const c of conns.slice(0, 80)) {
      if (!c || typeof c !== "object") continue;
      const a = String(c.partA || ""), b = String(c.partB || "");
      if (!ids.has(a) || !ids.has(b)) { errors.push(`Connection ${a || "?"}–${b || "?"} references a part id that does not exist.`); continue; }
      if (a === b) { errors.push(`Connection ${a}–${b} connects a part to itself.`); continue; }
      if (!allowed.includes(c.joint)) { errors.push(`Joint "${c.joint}" (connection ${a}–${b}) is not allowed at ${level} level. Allowed: ${allowed.join(", ")}.`); continue; }
      spec.connections.push({ partA: a, partB: b, joint: c.joint, faceHint: String(c.faceHint || "").slice(0, 80) });
    }
    const connected = new Set();
    for (const c of spec.connections) { connected.add(c.partA); connected.add(c.partB); }
    for (const id of ids) if (!connected.has(id)) errors.push(`Part "${id}" appears in no connection — free-floating geometry is invalid.`);
  }

  const partRoles = spec.furnitureType === "other" && spec.parts ? spec.parts.map((p) => p.role) : vocab || [];
  const joinery = Array.isArray(raw.joinery) ? raw.joinery : [];
  if (spec.furnitureType !== "other") {
    for (const j of joinery.slice(0, 12)) {
      if (!j || typeof j !== "object") continue;
      if (!allowed.includes(j.joint)) { errors.push(`Joint "${j.joint}" is not allowed at ${level} level. Allowed: ${allowed.join(", ")}.`); continue; }
      const c = Array.isArray(j.connects) ? j.connects.map(normRole) : [];
      if (c.length !== 2) { errors.push(`Joinery "${j.joint}" needs connects: [roleA, roleB].`); continue; }
      const bad = c.filter((r) => !partRoles.includes(r));
      if (bad.length) { errors.push(`Joinery connects role(s) ${bad.join(", ")} do not exist in the ${spec.furnitureType || "design"} part set (valid: ${partRoles.join(", ")}).`); continue; }
      spec.joinery.push({ joint: j.joint, connects: [c[0], c[1]] });
    }
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
  const fix = (j) => (JOINT_FALLBACK[j] || ["butt_screws"]).find((x) => allowed.includes(x)) || "butt_screws";
  return {
    ...spec,
    joinery: spec.joinery.map((j) => ({ ...j, joint: fix(j.joint) })),
    connections: spec.connections ? spec.connections.map((c) => ({ ...c, joint: fix(c.joint) })) : spec.connections,
  };
}
const specUsesDisallowed = (spec, level) =>
  spec.joinery.some((j) => !JOINTS_BY_LEVEL[level].includes(j.joint)) ||
  (spec.connections || []).some((c) => !JOINTS_BY_LEVEL[level].includes(c.joint));

/* ============================== parametric layout engine (geometry authority) ============================== */
// Each template: (spec) => { parts: PositionedPart[], notes: string[] }
// PositionedPart: { id, name, role, size:{x,y,z} mm (assembled 3D box), pos:{x,y,z} mm center (y from floor),
//   rot:{x,y,z} degrees | null, prim, cut:{length,width,thickness} mm (INCLUDES joinery allowances),
//   grain, stock, bias, surface?, loadBearing? }

function tenonLength(matingThickness) { return Math.min(Math.round((2 / 3) * matingThickness), 32); }

function buildLegApron(spec, notes) {
  const { width: W, depth: D, height: H } = spec.overall;
  const ovr = spec.overrides || {};
  const type = spec.furnitureType;
  const topT = snapSolid(ovr.topThickness || 25);
  const legT = ovr.legThickness ? snapSolid(ovr.legThickness) : Math.max(60, Math.round(H / 12));
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
  parts.push({ id: "top", name: "Top", role: "top", size: { x: W, y: topT, z: D }, pos: { x: 0, y: H - topT / 2, z: 0 }, rot: null,
    cut: { length: W, width: D, thickness: topT }, grain: "length", stock: "solid", bias: "up" });
  [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(([sx, sz], i) => {
    parts.push({ id: `leg${i + 1}`, name: "Leg", role: "leg", size: { x: legT, y: legL, z: legT },
      pos: { x: sx * legCx, y: legL / 2, z: sz * legCz }, rot: null,
      cut: { length: legL, width: legT, thickness: legT }, grain: "length", stock: "solid", bias: "leg" });
  });
  const apronZ = legCz + legT / 2 - inset - apronT / 2;
  [-1, 1].forEach((s, i) => {
    parts.push({ id: `apronLong${i + 1}`, name: "Apron (long)", role: "apron", size: { x: shoulderX, y: apronH, z: apronT },
      pos: { x: 0, y: apronY, z: s * apronZ }, rot: null,
      cut: { length: shoulderX + apronAllow, width: apronH, thickness: apronT }, grain: "length", stock: "solid", bias: "generic" });
  });
  const apronX = legCx + legT / 2 - inset - apronT / 2;
  [-1, 1].forEach((s, i) => {
    parts.push({ id: `apronShort${i + 1}`, name: "Apron (short)", role: "apron", size: { x: apronT, y: apronH, z: shoulderZ },
      pos: { x: s * apronX, y: apronY, z: 0 }, rot: null,
      cut: { length: shoulderZ + apronAllow, width: apronH, thickness: apronT }, grain: "length", stock: "solid", bias: "generic" });
  });
  if (apronJoint === "mortise_tenon") notes.push(`Apron cut lengths include two ${tenonLength(legT)} mm tenons each (added by code, never by the AI).`);

  const wantsShelf = spec.features.some((f) => f.includes("shelf"));
  const wantsStretcher = spec.features.some((f) => f.includes("stretcher"));
  if (wantsShelf) {
    let shelfT = ovr.shelfThickness ? snapSolid(ovr.shelfThickness) : snapSolid(19);
    if (!ovr.shelfThickness && Math.max(shoulderX, shoulderZ) > 800 && shelfT === 19) { shelfT = 25; notes.push("Lower shelf spans over 800 mm, so it was thickened to 25 mm stock for stiffness."); }
    const shelfJoint = jointFor(spec.joinery, "shelf", "leg") || jointFor(spec.joinery, "shelf", "apron");
    const dadoDepth = shelfJoint === "dados" ? Math.round(legT / 3) : 0;
    parts.push({ id: "shelf1", name: "Lower shelf", role: "shelf", size: { x: shoulderX, y: shelfT, z: shoulderZ },
      pos: { x: 0, y: Math.round(0.25 * H), z: 0 }, rot: null,
      cut: { length: shoulderX + 2 * dadoDepth, width: shoulderZ, thickness: shelfT }, grain: "length", stock: "solid", bias: "up" });
    if (dadoDepth) notes.push(`Lower shelf cut length includes 2 × ${dadoDepth} mm dado depth housed in the legs.`);
  } else if (wantsStretcher) {
    const strJoint = jointFor(spec.joinery, "stretcher", "leg");
    const strAllow = strJoint === "mortise_tenon" ? 2 * tenonLength(legT) : 0;
    [-1, 1].forEach((s, i) => {
      parts.push({ id: `stretcher${i + 1}`, name: "Stretcher", role: "stretcher", size: { x: apronT, y: 60, z: shoulderZ },
        pos: { x: s * legCx, y: Math.round(0.22 * H), z: 0 }, rot: null,
        cut: { length: shoulderZ + strAllow, width: 60, thickness: apronT }, grain: "length", stock: "solid", bias: "generic" });
    });
  }
  return parts;
}

function buildCarcass(spec, notes) {
  const { width: W, depth: D, height: H } = spec.overall;
  const ovr = spec.overrides || {};
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

  let shelfT = ovr.shelfThickness && !sheetMode ? snapSolid(ovr.shelfThickness) : t;
  const parts = [];
  const panelDepth = D - 8; // leave room for the back panel
  // Span rule: >800 mm unsupported in 19 mm stock -> thicken solid shelves to 25, or add a center
  // divider for sheet. An explicit user/fix override or the center_divider feature wins over the rule.
  let divider = spec.features.includes("center_divider");
  if (!divider && !ovr.shelfThickness && innerW > 800 && t < 25) {
    if (sheetMode) { divider = true; notes.push("Shelf span exceeds 800 mm in 18 mm sheet stock, so a center divider was added for support."); }
    else { shelfT = 25; notes.push("Shelf span exceeds 800 mm, so shelves were thickened to 25 mm stock."); }
  }

  [-1, 1].forEach((s, i) => {
    parts.push({ id: `side${i + 1}`, name: "Side", role: "side", size: { x: t, y: H, z: D },
      pos: { x: s * (W / 2 - t / 2), y: H / 2, z: 0 }, rot: null,
      cut: { length: H, width: D, thickness: t }, grain: "length", stock, bias: "side" });
  });
  parts.push({ id: "bottom", name: "Bottom", role: "bottom", size: { x: innerW, y: t, z: panelDepth },
    pos: { x: 0, y: t / 2, z: 4 }, rot: null,
    cut: { length: innerW + allowFor(capJoint), width: panelDepth, thickness: t }, grain: "length", stock, bias: "generic" });
  parts.push({ id: "topPanel", name: "Top", role: "top", size: { x: innerW, y: t, z: panelDepth },
    pos: { x: 0, y: H - t / 2, z: 4 }, rot: null,
    cut: { length: innerW + allowFor(capJoint), width: panelDepth, thickness: t }, grain: "length", stock, bias: "up" });
  for (let i = 1; i <= n; i++) {
    parts.push({ id: `shelf${i}`, name: "Shelf", role: "shelf", size: { x: innerW, y: shelfT, z: panelDepth },
      pos: { x: 0, y: Math.round(t + spacing * i), z: 4 }, rot: null,
      cut: { length: innerW + allowFor(shelfJoint), width: panelDepth, thickness: shelfT }, grain: "length", stock, bias: "up" });
  }
  if (divider) {
    parts.push({ id: "divider", name: "Center divider", role: "divider", size: { x: t, y: H - 2 * t, z: panelDepth },
      pos: { x: 0, y: H / 2, z: 4 }, rot: null, cut: { length: H - 2 * t, width: panelDepth, thickness: t }, grain: "length", stock, bias: "generic" });
  }
  // Back panel: 6 mm sheet; sits in rabbets (smaller, inset) or overlaps the back edges.
  const inRabbet = backJoint === "rabbets";
  const backW = inRabbet ? W - t : W;
  const backH = inRabbet ? H - t : H;
  parts.push({ id: "back", name: "Back panel", role: "back", size: { x: backW, y: backH, z: 6 },
    pos: { x: 0, y: inRabbet ? H / 2 : backH / 2, z: inRabbet ? -(D / 2 - 3) : -(D / 2 + 3) }, rot: null,
    cut: { length: backH, width: backW, thickness: 6 }, grain: "length", stock: "sheet", bias: "back" });
  if (shelfJoint === "dados") notes.push(`Shelf cut lengths include 2 × ${dadoDepth} mm dado depth housed in the sides.`);
  if (inRabbet) notes.push(`Back panel sized for a ${rabbetDepth} mm rabbet in the sides.`);
  return parts;
}

/* ---------- composed (novel) pieces: primitives with positions, rotations, connections ----------
   Primitive default orientations before rotation (the AI thinks in these, code maps to 3D):
     post / cylinder: stand vertical — length is the height        (x=width, y=length, z=thickness)
     rail / panel:    run along x — length horizontal, width tall  (x=length, y=width, z=thickness)
     slab:            lie flat — thickness vertical                (x=length, y=thickness, z=width) */

function composedSize(p) {
  const d = p.dimensions;
  switch (p.primitive) {
    case "post": return { x: d.width, y: d.length, z: d.thickness };
    case "cylinder": return { x: d.width, y: d.length, z: d.width };
    case "slab": return { x: d.length, y: d.thickness, z: d.width };
    default: return { x: d.length, y: d.width, z: d.thickness }; // rail, panel
  }
}
const COMPOSED_BIAS = { post: "leg", cylinder: "leg", slab: "up", panel: "side", rail: "generic" };

function buildComposed(spec, notes) {
  const parts = (spec.parts || []).map((p) => ({
    id: p.id, name: p.role.replace(/_/g, " "), role: p.role, prim: p.primitive,
    size: composedSize(p), pos: { ...p.position }, rot: p.rotation ? { ...p.rotation } : null,
    cut: { length: p.dimensions.length, width: p.dimensions.width, thickness: p.dimensions.thickness },
    grain: p.grainDirection, stock: p.stock, bias: COMPOSED_BIAS[p.primitive] || "generic",
    surface: p.surface, loadBearing: p.loadBearing,
  }));
  // Auto-ground: rest the composition on the floor plane (a silent, code-owned correction).
  let minY = Infinity;
  for (const p of parts) for (const c of obbCorners(partOBB(p))) minY = Math.min(minY, c[1]);
  if (isFinite(minY) && Math.abs(minY) > 1) {
    for (const p of parts) p.pos.y -= minY;
    notes.push(`Composition ${minY > 0 ? "lowered" : "raised"} ${Math.abs(Math.round(minY))} mm so it rests on the floor.`);
  }
  return parts;
}

// The single entry point: corrected spec in, positioned parts + engineering notes out.
function runParametric(spec) {
  const notes = [];
  let parts;
  if (LEG_APRON_TYPES.includes(spec.furnitureType)) parts = buildLegApron(spec, notes);
  else if (CARCASS_TYPES.includes(spec.furnitureType)) parts = buildCarcass(spec, notes);
  else parts = buildComposed(spec, notes);
  const solidTop = parts.find((p) => p.role === "top" && p.stock === "solid");
  if (solidTop) notes.push("Solid-wood top: attach with slotted screw holes or tabletop fasteners so the top can move with humidity. Never glue across the grain.");
  return { parts, notes };
}

/* ============================== structural engine ==============================
   Pure functions of (spec, positioned parts, per-surface load choices). Every check
   returns the computed number, the threshold it was judged against, a plain-English
   explanation, and — where code can own the change — tappable fixes that patch the
   spec through the normal pipeline. Estimates for hobby woodworking, not stamped
   engineering; the UI must always carry that disclaimer.                        */

const SAG_LIMIT_RATIO = 300;  // classic visible-sag limit: 1 mm per 300 mm of span
const CANT_LIMIT_RATIO = 150; // cantilever tip equivalent
const seatsFor = (span) => Math.max(1, Math.round(span / 550));

// World-axis extents of a (possibly rotated) part's OBB.
function worldExtents(p) {
  const box = partOBB(p);
  const ext = (i) => 2 * (box.e[0] * Math.abs(box.R[i][0]) + box.e[1] * Math.abs(box.R[i][1]) + box.e[2] * Math.abs(box.R[i][2]));
  return { x: ext(0), y: ext(1), z: ext(2) };
}

/* ---------- spec patch helpers (fixes apply through the normal pipeline) ---------- */
const patchOverride = (k, v) => (s) => ({ ...s, overrides: { ...(s.overrides || {}), [k]: v } });
const patchSpecies = (sp) => (s) => ({ ...s, material: { ...s.material, species: sp } });
const patchFeature = (f) => (s) => ({ ...s, features: s.features.includes(f) ? s.features : [...s.features, f] });
const patchPartThickness = (id, t) => (s) => ({ ...s, parts: (s.parts || []).map((p) => (p.id === id ? { ...p, dimensions: { ...p.dimensions, thickness: t } } : p)) });
const patchJoinery = (a, b, joint) => (s) => ({
  ...s, joinery: s.joinery.map((j) => {
    const [x, y] = j.connects;
    return (x === a && y === b) || (x === b && y === a) ? { ...j, joint } : j;
  }),
});
const patchConnJoint = (partId, joint) => (s) => ({
  ...s, connections: (s.connections || []).map((c) => (c.partA === partId || c.partB === partId ? { ...c, joint } : c)),
});

/* ---------- surface discovery: which parts carry live loads, and how they span ---------- */

function surfacesOf(spec, parts, loadChoices, defaultLoad) {
  const type = spec.furnitureType;
  const out = [];
  const push = (s) => {
    s.presetKey = (loadChoices && loadChoices[s.id] && LOAD_PRESETS[loadChoices[s.id]]) ? loadChoices[s.id]
      : defaultPresetFor(s.kind, type, defaultLoad);
    out.push(s);
  };

  if (LEG_APRON_TYPES.includes(type)) {
    const legs = parts.filter((p) => p.role === "leg");
    const top = parts.find((p) => p.role === "top");
    if (top && legs.length) {
      const legT = legs[0].size.x;
      const maxLegX = Math.max(...legs.map((l) => Math.abs(l.pos.x)));
      const span = Math.max(100, 2 * maxLegX - legT);
      const over = Math.max(0, top.size.x / 2 - maxLegX);
      push({ id: top.id, part: top, label: type === "bench" ? "Seat" : "Top", model: "ss",
        kind: type === "bench" ? "seat" : (type === "table" || type === "desk") ? "top" : "shelf",
        span, b: top.size.z, h: top.size.y, over: over >= 50 ? over : 0 });
    }
    const shelf = parts.find((p) => p.role === "shelf");
    if (shelf) push({ id: shelf.id, part: shelf, label: "Lower shelf", kind: "shelf", model: "ss",
      span: shelf.size.x, b: shelf.size.z, h: shelf.size.y, over: 0 });
  } else if (CARCASS_TYPES.includes(type)) {
    const divider = parts.some((p) => p.role === "divider");
    for (const p of parts) {
      if (p.role !== "shelf" && p.role !== "top") continue;
      const span = divider ? p.size.x / 2 : p.size.x;
      push({ id: p.id, part: p, label: p.role === "top" ? "Top panel" : `Shelf (${p.id.replace(/\D+/g, "") || 1})`,
        kind: "shelf", model: "ss", span, b: p.size.z, h: p.size.y, over: 0, halved: divider });
    }
  } else {
    // Composed: declared surfaces; span model inferred from the connection graph.
    const byId = new Map(parts.map((p) => [p.id, p]));
    for (const p of parts) {
      if (!p.surface || p.surface === "none") continue;
      const ext = worldExtents(p);
      const axis = ext.x >= ext.z ? [1, 0, 0] : [0, 0, 1];
      const len = Math.max(ext.x, ext.z);
      const bHoriz = Math.min(ext.x, ext.z);
      const half = len / 2;
      const ts = [];
      for (const c of spec.connections || []) {
        const otherId = c.partA === p.id ? c.partB : c.partB === p.id ? c.partA : null;
        if (!otherId) continue;
        const q = byId.get(otherId);
        if (!q) continue;
        const d = [q.pos.x - p.pos.x, q.pos.y - p.pos.y, q.pos.z - p.pos.z];
        ts.push(clamp(dot3(d, axis), -half, half));
      }
      let model = "cant", span = half, over = 0;
      if (ts.length >= 2) {
        const spread = Math.max(...ts) - Math.min(...ts);
        if (spread >= 0.4 * len) { model = "ss"; span = Math.max(spread, 100); }
      }
      if (model === "cant") {
        const tbar = ts.length ? ts.reduce((a, b) => a + b, 0) / ts.length : 0;
        span = Math.max(80, half + Math.abs(tbar));
      }
      push({ id: p.id, part: p, label: p.name, model, span, b: Math.max(20, bHoriz), h: p.cut.thickness, over: 0,
        kind: p.surface === "seating" ? "seat" : p.surface === "worktop" ? "top" : "shelf" });
    }
  }
  return out;
}

/* ---------- load cases per preset (superposition of the exact formulas) ---------- */

function loadCasesFor(presetKey, span, model) {
  const p = LOAD_PRESETS[presetKey] || LOAD_PRESETS.display;
  const cases = [];
  if (p.kind === "udl") {
    const w = (p.kgPerM * GRAV) / 1000; // N/mm
    cases.push(model === "cant" ? { fn: "udlCant", mag: w } : { fn: "udlSS", mag: w });
  } else if (p.kind === "seat") {
    const seats = seatsFor(span);
    const P = p.kgSeat * GRAV;
    if (model === "cant") cases.push({ fn: "pointCant", mag: P });
    else {
      cases.push({ fn: "pointSS", mag: P });
      if (seats > 1) cases.push({ fn: "udlSS", mag: ((seats - 1) * P) / span });
    }
  } else { // combo: distributed duty + a person leaning at the worst position
    const w = (p.kgDist * GRAV) / span;
    const P = p.kgEdge * GRAV;
    if (model === "cant") { cases.push({ fn: "udlCant", mag: w }, { fn: "pointCant", mag: P }); }
    else { cases.push({ fn: "udlSS", mag: w }, { fn: "pointSS", mag: P }); }
  }
  return cases;
}
function totalLoadN(presetKey, span) {
  const p = LOAD_PRESETS[presetKey] || LOAD_PRESETS.display;
  if (p.kind === "udl") return (p.kgPerM * span / 1000) * GRAV;
  if (p.kind === "seat") return seatsFor(span) * p.kgSeat * GRAV;
  return (p.kgDist + p.kgEdge) * GRAV;
}
function evalBeam(cases, L, E_MPa, I) {
  let sag = 0, M = 0;
  for (const c of cases) { sag += DEFL[c.fn](c.mag, L, E_MPa, I); M += MOM[c.fn](c.mag, L); }
  return { sag, M };
}

/* ---------- the integrity computation: every check, with numbers and fixes ---------- */

function computeIntegrity(spec, parts, loadChoices, level, defaultLoad) {
  const checks = [];
  const sp = speciesOf(spec.material.species);
  const E = sp.moe * 1000; // GPa -> MPa (N/mm²)
  const sgF = sgFactor(spec.material.species);
  const composed = spec.furnitureType === "other";
  const surfaces = surfacesOf(spec, parts, loadChoices, defaultLoad);
  const byId = new Map(parts.map((p) => [p.id, p]));
  const allowed = JOINTS_BY_LEVEL[level] || JOINTS_BY_LEVEL.advanced;

  /* ---- composed hard guarantees: connectivity, stand, load paths, collisions ---- */
  let grounded = new Set();
  if (composed && parts.length) {
    // Connectivity: the connection graph must form one component.
    const adj = new Map(parts.map((p) => [p.id, []]));
    for (const c of spec.connections || []) {
      if (adj.has(c.partA) && adj.has(c.partB)) { adj.get(c.partA).push(c.partB); adj.get(c.partB).push(c.partA); }
    }
    const seen = new Set();
    const stack = [parts[0].id];
    while (stack.length) { const id = stack.pop(); if (seen.has(id)) continue; seen.add(id); for (const n of adj.get(id) || []) stack.push(n); }
    const orphans = parts.filter((p) => !seen.has(p.id)).map((p) => p.id);
    checks.push({
      id: "conn", title: "Connectivity", status: orphans.length ? "fail" : "pass",
      value: orphans.length ? `${orphans.length} disconnected part(s)` : "one connected structure",
      threshold: "single connected component",
      explain: orphans.length ? `${orphans.join(", ")} ${orphans.length > 1 ? "are" : "is"} not connected to the main structure.` : "Every part reaches every other part through declared joints.",
      fixes: [],
    });

    // Grounded parts and the support polygon.
    for (const p of parts) {
      const corners = obbCorners(partOBB(p));
      if (Math.min(...corners.map((c) => c[1])) < 5) grounded.add(p.id);
    }
    const footPts = [];
    for (const id of grounded) {
      for (const c of obbCorners(partOBB(byId.get(id)))) if (c[1] < 30) footPts.push([c[0], c[2]]);
    }
    const hull = convexHull2D(footPts);
    let mass = 0, mx = 0, my = 0, mz = 0;
    for (const p of parts) {
      const dens = p.stock === "sheet" ? densityOf("plywood") : densityOf(spec.material.species);
      const volFactor = p.prim === "cylinder" ? Math.PI / 4 : 1;
      const m = p.size.x * p.size.y * p.size.z * 1e-9 * dens * volFactor;
      mass += m; mx += m * p.pos.x; my += m * p.pos.y; mz += m * p.pos.z;
    }
    const cog = mass ? [mx / mass, my / mass, mz / mass] : [0, 0, 0];
    const inDist = hull.length >= 3 ? polyInsideDistance(hull, [cog[0], cog[2]]) : -Infinity;
    const MARGIN = 15;
    let standExplain;
    if (!grounded.size) standExplain = "No part touches the floor — the piece has nothing to stand on.";
    else if (hull.length < 3) standExplain = "The floor contact points are collinear — the piece would fall over sideways.";
    else if (inDist < 0) {
      const cxz = hull.reduce((a, p) => [a[0] + p[0] / hull.length, a[1] + p[1] / hull.length], [0, 0]);
      const dx = cog[0] - cxz[0], dz = cog[2] - cxz[1];
      const dir = Math.abs(dz) >= Math.abs(dx) ? (dz > 0 ? "the front" : "the back") : (dx > 0 ? "the right" : "the left");
      standExplain = `The center of gravity falls ${Math.round(-inDist)} mm outside the support polygon toward ${dir}.`;
    } else if (inDist < MARGIN) standExplain = `The center of gravity is only ${Math.round(inDist)} mm inside the support polygon — under the ${MARGIN} mm stability margin.`;
    else standExplain = `The center of gravity sits ${Math.round(inDist)} mm inside the footprint.`;
    checks.push({
      id: "stand", title: "It must stand", status: inDist >= MARGIN ? "pass" : "fail",
      value: isFinite(inDist) ? `COG margin ${Math.round(inDist)} mm` : "no footprint",
      threshold: `≥ ${MARGIN} mm inside the support polygon`, explain: standExplain, fixes: [],
    });

    // Load paths: every load-bearing surface must reach the ground through the graph.
    for (const p of parts) {
      if (!(p.loadBearing || (p.surface && p.surface !== "none"))) continue;
      const q = [[p.id, [p.id]]];
      const vis = new Set([p.id]);
      let path = null;
      while (q.length && !path) {
        const [id, trail] = q.shift();
        if (grounded.has(id)) { path = trail; break; }
        for (const n of adj.get(id) || []) if (!vis.has(n)) { vis.add(n); q.push([n, [...trail, n]]); }
      }
      if (!path) {
        checks.push({ id: `path:${p.id}`, title: `Load path — ${p.id}`, status: "fail",
          value: "no path to ground", threshold: "connected route to a floor-bearing part",
          explain: `${p.id} carries load but has no connection path to the ground — it is floating.`, fixes: [] });
      } else {
        const weak = path.slice(1, -1).filter((id) => byId.get(id) && !byId.get(id).loadBearing);
        if (weak.length) checks.push({ id: `path:${p.id}`, title: `Load path — ${p.id}`, status: "advisory",
          value: `via ${path.slice(1).join(" → ")}`, threshold: "load-bearing route to ground",
          explain: `The load path for ${p.id} runs through ${weak.join(", ")}, which ${weak.length > 1 ? "are" : "is"} not declared load-bearing.`, fixes: [] });
      }
    }

    // Collisions: intended joint overlaps (connected pairs) vs accidental intersections.
    const connSet = new Set((spec.connections || []).map((c) => [c.partA, c.partB].sort().join("|")));
    const hits = [];
    const gaps = [];
    for (let i = 0; i < parts.length; i++) for (let j = i + 1; j < parts.length; j++) {
      const a = parts[i], b = parts[j];
      const key = [a.id, b.id].sort().join("|");
      const pen = obbPenetration(partOBB(a), partOBB(b));
      if (connSet.has(key)) {
        // Declared joint: the parts must actually meet (within a 5 mm reach).
        const A = partOBB(a); A.e = A.e.map((e) => e + 5);
        if (pen == null && obbPenetration(A, partOBB(b)) == null) gaps.push(`${a.id}–${b.id}`);
      } else if (pen != null && pen > 2) hits.push(`${a.id} × ${b.id} (${Math.round(pen)} mm)`);
    }
    checks.push({
      id: "collide", title: "Collision check", status: hits.length ? "fail" : gaps.length ? "advisory" : "pass",
      value: hits.length ? `${hits.length} accidental intersection(s)` : gaps.length ? `${gaps.length} open joint(s)` : "clean",
      threshold: "no unconnected parts intersecting",
      explain: hits.length ? `Unconnected parts intersect: ${hits.join("; ")}. Move or resize them.`
        : gaps.length ? `Declared connections where the parts never touch: ${gaps.join("; ")}.`
        : "Connected parts overlap only at their declared joints.",
      fixes: [],
    });

    // Buildability: miter/bevel angles from rotations.
    const angled = parts.map((p) => ({ p, a: cutAngles(p.rot) })).filter((x) => x.a);
    if (angled.length) {
      const worst = angled.reduce((m, x) => Math.max(m, x.a.miter, x.a.bevel), 0);
      const extreme = angled.filter((x) => x.a.extreme);
      checks.push({
        id: "build", title: "Buildability (angled cuts)", status: extreme.length ? "advisory" : "pass",
        value: `${angled.length} angled part(s), max ${fmtDeg(worst)}`, threshold: "compound cuts ≤ 50°",
        explain: extreme.length
          ? `${extreme.map((x) => x.p.id).join(", ")} need${extreme.length > 1 ? "" : "s"} cuts past 50° — beyond common miter-saw capability. Consider a jig or a squarer design.`
          : "All miters and bevels are within common saw capability; angles are listed in the cut list.",
        fixes: [],
      });
    }
  }

  /* ---- beam checks per load-bearing surface: sag (MOE), strength (MOR / SF 4) ---- */
  let worstSagRatio = 0, worstSag = null;
  for (const s of surfaces) {
    const I = I_rect(s.b, s.h);
    const cases = loadCasesFor(s.presetKey, s.span, s.model);
    const { sag, M } = evalBeam(cases, s.span, E, I);
    const limit = s.model === "cant" ? s.span / CANT_LIMIT_RATIO : s.span / SAG_LIMIT_RATIO;
    const ratio = sag / limit;
    if (ratio > worstSagRatio) { worstSagRatio = ratio; worstSag = { id: s.id, sag, limit, span: s.span }; }
    const preset = LOAD_PRESETS[s.presetKey];

    const fixes = [];
    const up = nextSolidUp(s.h);
    if (!composed && up) {
      if (s.part.role === "top" && LEG_APRON_TYPES.includes(spec.furnitureType))
        fixes.push({ id: `thick-top`, label: `Thicken to ${up} mm`, patch: patchOverride("topThickness", up) });
      else if (s.part.stock === "solid")
        fixes.push({ id: `thick-shelf`, label: `Thicken to ${up} mm`, patch: patchOverride("shelfThickness", up) });
    }
    if (composed && up && s.part.stock === "solid")
      fixes.push({ id: `thick-${s.id}`, label: `Thicken ${s.id} to ${up} mm`, patch: patchPartThickness(s.id, up) });
    if (CARCASS_TYPES.includes(spec.furnitureType) && !s.halved)
      fixes.push({ id: "divider", label: "Add a center support", patch: patchFeature("center_divider") });
    if (SPECIES.maple.moe > sp.moe * 1.1 && spec.material.species !== "plywood")
      fixes.push({ id: "maple", label: "Switch to maple", patch: patchSpecies("maple") });

    checks.push({
      id: `sag:${s.id}`, title: `Sag — ${s.label}`,
      status: ratio <= 1 ? "pass" : ratio <= 1.5 ? "advisory" : "fail",
      value: `predicted sag ${fmtMM(sag)} over ${Math.round(s.span)} mm ${s.model === "cant" ? "cantilever" : "span"}`,
      threshold: `≤ ${fmtMM(limit)} (${s.model === "cant" ? `L/${CANT_LIMIT_RATIO} at the free end` : `1 mm per ${SAG_LIMIT_RATIO} mm of span`})`,
      explain: `${sp.label} at ${Math.round(s.h)} mm thick under the “${preset.label}” preset (${preset.detail})${s.halved ? "; the center divider halves the span" : ""}. Stiffness comes from MOE (${sp.moe} GPa) and thickness cubed.`,
      fixes: ratio > 1 ? fixes : [],
    });

    const stress = (M * (s.h / 2)) / I; // bending stress = M·c / I
    const allow = sp.mor / SAFETY_FACTOR;
    const margin = stress > 0 ? allow / stress : Infinity;
    checks.push({
      id: `str:${s.id}`, title: `Strength — ${s.label}`,
      status: margin >= 1.25 ? "pass" : margin >= 1 ? "advisory" : "fail",
      value: `bending stress ${stress.toFixed(1)} MPa · margin ${margin === Infinity ? "∞" : margin.toFixed(1) + "×"}`,
      threshold: `≤ ${allow.toFixed(1)} MPa (MOR ${sp.mor} MPa ÷ safety factor ${SAFETY_FACTOR})`,
      explain: margin >= 1 ? `Comfortably below the breaking stress of ${sp.label} with the standard ×${SAFETY_FACTOR} wood safety factor.`
        : `The “${preset.label}” load brings this part too close to breaking stress.`,
      fixes: margin < 1.25 ? fixes : [],
    });

    // A person leaning on the unsupported overhang: cantilever point load at the edge.
    if (s.over > 0 && s.kind === "top") {
      const P = LOAD_PRESETS.worktop.kgEdge * GRAV;
      const sagO = DEFL.pointCant(P, s.over, E, I);
      const limO = s.over / CANT_LIMIT_RATIO;
      const rO = sagO / limO;
      checks.push({
        id: `cant:${s.id}`, title: `Overhang — ${s.label}`,
        status: rO <= 1 ? "pass" : rO <= 1.5 ? "advisory" : "fail",
        value: `edge deflection ${fmtMM(sagO)} on a ${Math.round(s.over)} mm overhang`,
        threshold: `≤ ${fmtMM(limO)} (L/${CANT_LIMIT_RATIO}) under a ${LOAD_PRESETS.worktop.kgEdge} kg lean`,
        explain: "Cantilever case: a person leaning at the worst edge position.",
        fixes: rO > 1 ? fixes : [],
      });
    }

    // Surface duty: Janka drives dent/wear advisories ONLY — never sag or strength.
    if (s.kind === "top" && sp.janka < 1000) {
      checks.push({
        id: `duty:${s.id}`, title: `Surface durability — ${s.label}`, status: "advisory",
        value: `${sp.label} Janka ${sp.janka} lbf`, threshold: "≥ 1000 lbf for a hard-wearing worktop",
        explain: `${sp.label[0].toUpperCase() + sp.label.slice(1)} will dent under daily desk use. Fine for a rustic look — consider maple or oak for a hard-wearing surface.`,
        fixes: [
          { id: "duty-maple", label: "Switch to maple", patch: patchSpecies("maple") },
          { id: "duty-oak", label: "Switch to oak", patch: patchSpecies("oak") },
        ],
      });
    }
  }

  /* ---- tipping stability: COG from part volumes & density, empty and loaded ---- */
  let antiTip = false, tip = null;
  {
    let mass = 0, mx = 0, my = 0, mz = 0;
    for (const p of parts) {
      const dens = p.stock === "sheet" ? densityOf("plywood") : densityOf(spec.material.species);
      const volFactor = p.prim === "cylinder" ? Math.PI / 4 : 1;
      const m = p.size.x * p.size.y * p.size.z * 1e-9 * dens * volFactor;
      mass += m; mx += m * p.pos.x; my += m * p.pos.y; mz += m * p.pos.z;
    }
    const feet = composed ? parts.filter((p) => grounded.has(p.id)) : parts.filter((p) => p.pos.y - p.size.y / 2 < 5);
    if (mass > 0 && feet.length) {
      let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
      for (const f of feet) for (const c of obbCorners(partOBB(f))) {
        if (c[1] < 30) { minX = Math.min(minX, c[0]); maxX = Math.max(maxX, c[0]); minZ = Math.min(minZ, c[2]); maxZ = Math.max(maxZ, c[2]); }
      }
      const height = Math.max(...parts.map((p) => p.pos.y + p.size.y / 2));
      const baseDepth = Math.max(1, maxZ - minZ);
      const cogE = [mx / mass, my / mass, mz / mass];
      const edge = (cog) => Math.max(1, Math.min(maxX - cog[0], cog[0] - minX, maxZ - cog[2], cog[2] - minZ));
      const angEmpty = (Math.atan2(edge(cogE), cogE[1]) * 180) / Math.PI;
      // Worst case: the top-most storage surface loaded with its preset.
      const topSurf = surfaces.filter((s) => s.kind === "shelf" || s.kind === "top").sort((a, b) => b.part.pos.y - a.part.pos.y)[0];
      let angLoaded = angEmpty, loadKg = 0;
      if (topSurf) {
        loadKg = totalLoadN(topSurf.presetKey, topSurf.span) / GRAV;
        const M2 = mass + loadKg;
        const cogL = [(mx + loadKg * topSurf.part.pos.x) / M2, (my + loadKg * topSurf.part.pos.y) / M2, (mz + loadKg * topSurf.part.pos.z) / M2];
        angLoaded = (Math.atan2(edge(cogL), cogL[1]) * 180) / Math.PI;
      }
      const ratio = height / baseDepth;
      antiTip = ratio > 2.5 || angLoaded < 10;
      tip = { angEmpty, angLoaded, ratio, loadKg };
      checks.push({
        id: "tip", title: "Tipping stability",
        status: angLoaded < 5 ? "fail" : antiTip ? "advisory" : "pass",
        value: `tipping angle ${fmtDeg(angLoaded)} loaded · ${fmtDeg(angEmpty)} empty · height/depth ${ratio.toFixed(1)}`,
        threshold: "≥ 10° loaded, height/depth ≤ 2.5 — otherwise a wall anchor is mandatory",
        explain: antiTip
          ? `Tall or top-heavy${loadKg ? ` with ${Math.round(loadKg)} kg on the top surface` : ""}: an anti-tip wall anchor has been added to the BOM and assembly steps (mandatory, not optional).`
          : "Stable footprint: the piece resists tipping even with the top surface fully loaded.",
        fixes: [],
      });
    }
  }

  /* ---- racking score: transparent heuristic, 0–100, factors listed ---- */
  const rack = { factors: [], score: 0 };
  {
    let raw = 0;
    const addPts = (label, pts) => { rack.factors.push({ label, pts: Math.round(pts * 10) / 10 }); raw += pts; };
    if (!composed) {
      for (const j of spec.joinery) {
        const [a, b] = j.connects;
        const nA = parts.filter((p) => p.role === a).length;
        if (!nA) continue;
        const count = a === "back" ? 4 : nA * (b === "leg" && a === "shelf" ? 4 : 2);
        const r = JOINT_RATING[j.joint];
        if (r) addPts(`${count} × ${JOINT_LABEL[j.joint]} (${a}–${b})`, count * r.rackPts * sgF);
      }
    } else {
      const byJoint = new Map();
      for (const c of spec.connections || []) byJoint.set(c.joint, (byJoint.get(c.joint) || 0) + 1);
      for (const [joint, n] of byJoint) {
        const r = JOINT_RATING[joint];
        if (r) addPts(`${n} × ${JOINT_LABEL[joint]}`, n * r.rackPts * sgF);
      }
    }
    const mults = [];
    const hasRole = (r) => parts.some((p) => p.role === r);
    if (!composed) {
      if (hasRole("apron")) mults.push({ label: "apron frame ties the legs", mult: 1.2 });
      if (hasRole("stretcher")) mults.push({ label: "stretchers triangulate the base", mult: 1.2 });
      if (hasRole("back")) mults.push({ label: "back panel acts as a shear panel", mult: 1.5 });
      const sj = jointFor(spec.joinery, "shelf", "side") || jointFor(spec.joinery, "shelf", "leg");
      if (sj === "dados" && hasRole("shelf")) mults.push({ label: "fixed shelves housed in dados", mult: 1.15 });
    } else {
      const connCount = new Map();
      for (const c of spec.connections || []) { connCount.set(c.partA, (connCount.get(c.partA) || 0) + 1); connCount.set(c.partB, (connCount.get(c.partB) || 0) + 1); }
      if (parts.some((p) => (p.prim === "panel" || p.prim === "slab") && (connCount.get(p.id) || 0) >= 2))
        mults.push({ label: "panel/slab braces the frame", mult: 1.3 });
      if (parts.filter((p) => p.prim === "rail").length >= 2) mults.push({ label: "rails stiffen the frame", mult: 1.15 });
    }
    for (const m of mults) { rack.factors.push({ label: m.label, mult: m.mult }); raw *= m.mult; }
    rack.score = Math.round(Math.min(100, raw));
    const cheapFix = LEG_APRON_TYPES.includes(spec.furnitureType) ? "a pair of stretchers" : composed ? "a stretcher or back panel between the uprights" : "dado-housed fixed shelves";
    const fixes = [];
    if (rack.score < 40) {
      if (LEG_APRON_TYPES.includes(spec.furnitureType) && !hasRole("stretcher") && !hasRole("shelf"))
        fixes.push({ id: "stretchers", label: "Add stretchers", patch: patchFeature("stretchers") });
      if (CARCASS_TYPES.includes(spec.furnitureType) && jointFor(spec.joinery, "shelf", "side") !== "dados" && allowed.includes("dados"))
        fixes.push({ id: "dados", label: "House shelves in dados", patch: patchJoinery("shelf", "side", "dados") });
    }
    checks.push({
      id: "rack", title: "Racking resistance", status: rack.score < 40 ? "advisory" : "pass",
      value: `score ${rack.score} / 100`, threshold: "≥ 40 (heuristic, not physics)",
      explain: rack.score < 40
        ? `The joints alone won't stop side-to-side wobble. Cheapest effective fix: ${cheapFix}.`
        : "Joinery and bracing elements give this piece good resistance to side-to-side wobble.",
      fixes, factors: rack.factors,
    });
  }

  /* ---- leg slenderness: unbraced length / least thickness > 20 ---- */
  {
    const legs = composed
      ? parts.filter((p) => (p.prim === "post" || p.prim === "cylinder") && p.loadBearing)
      : parts.filter((p) => p.role === "leg");
    if (legs.length) {
      const braced = composed
        ? legs.some((l) => (spec.connections || []).some((c) => {
            const other = c.partA === l.id ? c.partB : c.partB === l.id ? c.partA : null;
            const q = other && byId.get(other);
            return q && q.pos.y > 0.15 * l.size.y && q.pos.y < 0.75 * l.size.y;
          }))
        : parts.some((p) => p.role === "stretcher" || p.role === "shelf");
      const worst = legs.reduce((m, l) => {
        const len = l.size.y * (braced ? 0.6 : 1);
        const minT = Math.min(l.size.x, l.size.z);
        const r = len / minT;
        return r > m.r ? { r, l } : m;
      }, { r: 0, l: null });
      if (worst.l) {
        const fixes = [];
        const up = nextSolidUp(Math.min(worst.l.size.x, worst.l.size.z));
        if (!composed && up) fixes.push({ id: "thick-leg", label: `Thicken legs to ${up} mm`, patch: patchOverride("legThickness", up) });
        if (composed && up && worst.l.stock === "solid") fixes.push({ id: `thick-${worst.l.id}`, label: `Thicken ${worst.l.id} to ${up} mm`, patch: patchPartThickness(worst.l.id, up) });
        if (LEG_APRON_TYPES.includes(spec.furnitureType) && !parts.some((p) => p.role === "stretcher" || p.role === "shelf"))
          fixes.push({ id: "stretchers2", label: "Add stretchers", patch: patchFeature("stretchers") });
        checks.push({
          id: "slender", title: "Leg slenderness", status: worst.r > 20 ? "advisory" : "pass",
          value: `worst L/t = ${worst.r.toFixed(1)}${braced ? " (braced)" : ""}`, threshold: "≤ 20 unbraced length / least thickness",
          explain: worst.r > 20 ? "Long thin legs bow under load and feel wobbly — add stretchers or use thicker stock." : "Legs are stocky enough for their unbraced length.",
          fixes: worst.r > 20 ? fixes : [],
        });
      }
    }
  }

  /* ---- joint adequacy: load per joint from the load path vs joint capacity (SG-scaled) ---- */
  {
    let weakest = null;
    for (const s of surfaces) {
      const N = totalLoadN(s.presetKey, s.span);
      let joint = null, count = 2, where = "";
      if (composed) {
        const conns = (spec.connections || []).filter((c) => c.partA === s.id || c.partB === s.id);
        if (!conns.length) continue;
        count = conns.length;
        joint = conns.reduce((min, c) => (JOINT_RATING[c.joint].capN < JOINT_RATING[min.joint].capN ? c : min), conns[0]).joint;
        where = s.id;
      } else if (LEG_APRON_TYPES.includes(spec.furnitureType)) {
        if (s.part.role === "top") { joint = jointFor(spec.joinery, "apron", "leg") || "butt_screws"; count = 8; where = "apron–leg"; }
        else { joint = jointFor(spec.joinery, "shelf", "leg") || jointFor(spec.joinery, "shelf", "apron") || "butt_screws"; count = 4; where = "shelf–leg"; }
      } else {
        joint = jointFor(spec.joinery, s.part.role === "top" ? "top" : "shelf", "side") || jointFor(spec.joinery, "shelf", "side") || "butt_screws";
        count = 2; where = `${s.part.role}–side`;
      }
      const cap = JOINT_RATING[joint].capN * sgF;
      const per = N / count;
      const margin = cap / per;
      if (!weakest || margin < weakest.margin) weakest = { margin, joint, where, per, cap, surf: s };
    }
    if (weakest) {
      const better = ["mortise_tenon", "half_lap", "dados", "dowels", "pocket_screws"].find((j) => allowed.includes(j) && JOINT_RATING[j].capN > JOINT_RATING[weakest.joint].capN);
      const fixes = [];
      if (weakest.margin < 1.5 && better) {
        fixes.push(composed
          ? { id: "upjoint", label: `Upgrade ${weakest.where} joints to ${JOINT_LABEL[better]}`, patch: patchConnJoint(weakest.where, better) }
          : { id: "upjoint", label: `Upgrade ${weakest.where} to ${JOINT_LABEL[better]}`, patch: patchJoinery(...weakest.where.split("–"), better) });
      }
      checks.push({
        id: "joints", title: "Joint adequacy",
        status: weakest.margin >= 1.5 ? "pass" : weakest.margin >= 1 ? "advisory" : "fail",
        value: `weakest: ${JOINT_LABEL[weakest.joint]} at ${weakest.where} — ${Math.round(weakest.per)} N per joint vs ${Math.round(weakest.cap)} N capacity`,
        threshold: "≥ 1.5× capacity margin (SG-scaled joint ratings)",
        explain: weakest.margin >= 1.5 ? "Every joint carries its share of the load path with room to spare."
          : `The ${JOINT_LABEL[weakest.joint]} joints at ${weakest.where} are the weak link in the load path.`,
        fixes,
      });
    }
  }

  const summary = {
    worstSag: worstSag ? { ...worstSag } : null,
    tipLoaded: tip ? tip.angLoaded : null,
    rackScore: rack.score,
    fails: checks.filter((c) => c.status === "fail").length,
    advisories: checks.filter((c) => c.status === "advisory").length,
  };
  return { checks, surfaces, antiTip, racking: rack, summary };
}

// Short chip strings describing what changed between two integrity results.
function integrityDiff(before, after) {
  const chips = [];
  if (before.summary.worstSag && after.summary.worstSag) {
    const a = before.summary.worstSag.sag, b = after.summary.worstSag.sag;
    if (Math.abs(a - b) > 0.05) chips.push(`sag ${a.toFixed(1)} → ${b.toFixed(1)} mm`);
  }
  if (before.summary.tipLoaded != null && after.summary.tipLoaded != null) {
    const a = before.summary.tipLoaded, b = after.summary.tipLoaded;
    if (Math.abs(a - b) > 0.3) chips.push(`tip ${a.toFixed(1)}° → ${b.toFixed(1)}°`);
  }
  if (before.summary.rackScore !== after.summary.rackScore)
    chips.push(`racking ${before.summary.rackScore} → ${after.summary.rackScore}`);
  const df = after.summary.fails - before.summary.fails;
  if (df !== 0) chips.push(`${Math.abs(df)} check${Math.abs(df) > 1 ? "s" : ""} ${df < 0 ? "fixed" : "now failing"}`);
  return chips;
}

/* ============================== derived layer: cut list ============================== */

function angleText(a) {
  if (!a) return "";
  const bits = [];
  if (a.miter) bits.push(`miter ${a.miter}°`);
  if (a.bevel) bits.push(`bevel ${a.bevel}°`);
  return bits.join(", ") + (a.compound ? " (compound)" : "");
}

function makeCutList(parts, species) {
  const groups = new Map();
  for (const p of parts) {
    const ang = cutAngles(p.rot);
    const key = `${p.name}|${p.cut.length}|${p.cut.width}|${p.cut.thickness}|${p.stock}|${p.prim === "cylinder" ? "cyl" : ""}|${ang ? `${ang.miter}/${ang.bevel}` : ""}`;
    if (!groups.has(key)) {
      groups.set(key, { name: p.name, qty: 0, cut: { ...p.cut }, grain: p.grain, stock: p.stock,
        material: p.stock === "sheet" ? "plywood" : species, cylinder: p.prim === "cylinder", angles: ang,
        volume: p.cut.length * p.cut.width * p.cut.thickness });
    }
    groups.get(key).qty += 1;
  }
  return [...groups.values()].sort((a, b) => b.volume - a.volume);
}

function buildCutListCSV(rows, prefs) {
  const q = (s) => `"${String(s).replace(/"/g, '""')}"`;
  const anyAngles = rows.some((r) => r.angles);
  const header = ["Part", "Qty", "Thickness", "Width", "Length", "Unit", "Material", "Grain", ...(anyAngles ? ["Angles"] : [])].map(q).join(",");
  const lines = rows.map((r) => [
    r.name + (r.cylinder ? " (cylinder, Ø = width)" : ""), r.qty,
    fmtLenBare(r.cut.thickness, prefs), fmtLenBare(r.cut.width, prefs), fmtLenBare(r.cut.length, prefs),
    UNIT_LABEL[prefs.unitSystem], r.material, r.grain, ...(anyAngles ? [angleText(r.angles)] : []),
  ].map(q).join(","));
  const note = [q(`Cut lengths include joinery allowances. Add ${fmtLenBare(KERF_MM, prefs)} ${UNIT_LABEL[prefs.unitSystem]} kerf between adjacent cuts. Angles are rounded to 0.5 degrees.`)].join(",");
  return [header, ...lines, note].join("\r\n") + "\r\n";
}
function cutListCSV(rows, prefs, specName) {
  downloadFile(`${specName.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}-cutlist.csv`, buildCutListCSV(rows, prefs), "text/csv;charset=utf-8");
}

function downloadFile(filename, text, mime) {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/* ============================== derived layer: bill of materials ============================== */

function makeBOM(spec, parts, integrity) {
  const species = spec.material.species;
  const lumber = [], sheets = [], hardware = [];

  // Lumber: board feet = (t_in x w_in x l_in) / 144 per part, +15% waste, priced by species.
  let bf = 0;
  for (const p of parts) if (p.stock === "solid") bf += (p.cut.thickness / 25.4) * (p.cut.width / 25.4) * (p.cut.length / 25.4) / 144;
  if (bf > 0) {
    const bfW = bf * 1.15;
    const rate = speciesOf(species).priceBF;
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
  const screwCounts = new Map(); const pocketCounts = new Map(); let dowels = 0;
  const tally = (joint, throughT, faces) => {
    const screws = faces * 2;
    if (joint === "butt_screws") { const s = snapScrew(throughT); screwCounts.set(s, (screwCounts.get(s) || 0) + screws); }
    else if (joint === "pocket_screws") { const s = snapScrew(throughT); pocketCounts.set(s, (pocketCounts.get(s) || 0) + screws); }
    else if (joint === "dowels") dowels += screws;
  };
  if (spec.furnitureType === "other" && spec.connections) {
    for (const c of spec.connections) {
      const a = parts.find((p) => p.id === c.partA), b = parts.find((p) => p.id === c.partB);
      if (!a || !b) continue;
      // Screws drive THROUGH the thinner part into the thicker one; size off the thinner.
      tally(c.joint, Math.min(a.cut.thickness, b.cut.thickness), 1);
    }
  } else {
    for (const j of spec.joinery) {
      const roleA = j.connects[0];
      const aParts = parts.filter((p) => p.role === roleA);
      if (!aParts.length) continue;
      const faces = roleA === "back" ? 4 : Math.max(aParts.length * 2, 2);
      const bPart = parts.find((p) => p.role === j.connects[1]);
      const through = bPart && bPart.cut.thickness < aParts[0].cut.thickness ? bPart : aParts[0];
      tally(j.joint, through.cut.thickness, faces);
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
  // Mandatory anti-tip hardware when the stability check demands it — a line item, not a suggestion.
  if (integrity && integrity.antiTip)
    hardware.push({ label: "Anti-tip wall anchor kit (strap + wall screws) — REQUIRED", qty: "1", unitPrice: 7, cost: 7 });
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
// Every step carries the ids of the parts it touches so the 3D view can sync during playback.
function makeAssembly(spec, parts, notes, level, integrity) {
  const beginner = level === "beginner";
  const steps = [];
  const idsOf = (...roles) => parts.filter((p) => roles.includes(p.role)).map((p) => p.id);
  const add = (title, body, extra = {}) => steps.push({ title, body, ids: [], ...extra });
  const partNames = (role) => { const m = parts.filter((p) => p.role === role); return m.length ? `${m.length}× ${m[0].name}` : null; };
  const thicknessOf = (role) => { const p = parts.find((x) => x.role === role); return p ? p.cut.thickness : 19; };

  add("Mill and label every part", "Cut all parts to the dimensions in the cut list, then label each one in pencil.",
    { parts: ["All parts"], ids: parts.map((p) => p.id), joint: null, fasteners: "none", tip: "Mark the show faces now so grain and color decisions happen once, not mid-glue-up.",
      why: beginner ? "Cutting everything first means every later step is pure assembly — no stopping to re-measure with glue open." : null });

  if (LEG_APRON_TYPES.includes(spec.furnitureType)) {
    const aj = jointFor(spec.joinery, "apron", "leg") || "pocket_screws";
    add("Build the two side frames (sub-assemblies)", `Join a short apron between a pair of legs: ${jointPrep(aj)}, then glue and clamp each side frame flat on the bench. Make two.`,
      { parts: [partNames("leg"), "2× Apron (short)"].filter(Boolean), ids: idsOf("leg").concat(parts.filter((p) => p.id.startsWith("apronShort")).map((p) => p.id)),
        joint: aj, fasteners: fastenersText(aj, thicknessOf("apron")), tip: JOINT_TIPS[aj],
        why: beginner ? "Two flat sub-assemblies are far easier to keep square than one four-legged glue-up." : null,
        check: beginner ? "Measure both diagonals of each frame — equal diagonals mean square." : null });
    add("Join the side frames with the long aprons", `Stand the side frames up and connect them with the long aprons using the same joinery. Clamp and set the base on a flat surface.`,
      { parts: ["2× Side frame", "2× Apron (long)"], ids: idsOf("leg").concat(parts.filter((p) => p.id.startsWith("apronLong")).map((p) => p.id)),
        joint: aj, fasteners: fastenersText(aj, thicknessOf("apron")), tip: "Dry-fit the whole base once before any glue touches wood.",
        check: beginner ? "Check diagonals across the top of the base and rack it square before the glue sets." : null });
    const shelf = parts.find((p) => p.role === "shelf");
    if (shelf) {
      const sj = jointFor(spec.joinery, "shelf", "leg") || jointFor(spec.joinery, "shelf", "apron") || "butt_screws";
      add("Install the lower shelf", `Fit the lower shelf between the legs at shelf height${sj === "dados" ? ", seating it fully into its dados" : ""}.`,
        { parts: ["1× Lower shelf"], ids: [shelf.id], joint: sj, fasteners: fastenersText(sj, shelf.cut.thickness), tip: JOINT_TIPS[sj] });
    }
    const st = parts.filter((p) => p.role === "stretcher");
    if (st.length) {
      const sj = jointFor(spec.joinery, "stretcher", "leg") || "dowels";
      add("Install the stretchers", "Fit the stretchers between the leg pairs at stretcher height.",
        { parts: [`${st.length}× Stretcher`], ids: st.map((p) => p.id), joint: sj, fasteners: fastenersText(sj, st[0].cut.thickness), tip: JOINT_TIPS[sj] });
    }
    add("Attach the top", "Center the top on the base (equal overhang all around) and fasten it from below through the aprons. IMPORTANT: solid wood moves with humidity — use slotted screw holes or tabletop fasteners (Z-clips) and never glue the top across the grain.",
      { parts: ["1× Top", "Base assembly"], ids: idsOf("top"), joint: jointFor(spec.joinery, "top", "apron") || "butt_screws",
        fasteners: `#8 × ${snapScrew(thicknessOf("apron"))} mm screws in slotted holes, or tabletop fasteners`,
        tip: "Elongate the outer screw holes across the grain so seasonal movement doesn't crack the top.",
        why: beginner ? "A solid top can move several millimeters across its width through the year; rigid fastening is what splits tabletops." : null });
  } else if (CARCASS_TYPES.includes(spec.furnitureType)) {
    const sj = jointFor(spec.joinery, "shelf", "side") || "butt_screws";
    const bj = jointFor(spec.joinery, "back", "side") || "butt_screws";
    add("Prepare the case sides (sub-assembly prep)", `Lay the two sides inside-face up and ${jointPrep(sj)} for the top, bottom and every fixed shelf${bj === "rabbets" ? "; then cut the back-panel rabbets along the rear inside edges" : ""}.`,
      { parts: ["2× Side"], ids: idsOf("side"), joint: sj, fasteners: "none yet", tip: JOINT_TIPS[sj],
        why: beginner ? "All machining happens while the sides are flat on the bench — far more accurate than working on a standing case." : null });
    add("Join the top and bottom between the sides", "Stand the sides up and fix the top and bottom panels between them to form the case.",
      { parts: ["2× Side", "1× Top", "1× Bottom"], ids: idsOf("side", "top", "bottom"), joint: sj, fasteners: fastenersText(sj, thicknessOf("top")), tip: "Assemble on a known-flat surface so the case can't take a twist.",
        check: beginner ? "Measure both diagonals of the case opening — adjust clamps until they match." : null });
    const shelves = parts.filter((p) => p.role === "shelf");
    if (shelves.length) add("Install the shelves", `Slide the ${shelves.length} shelf${shelves.length > 1 ? "s" : ""} into position${sj === "dados" ? ", seating each fully into its dado" : ""} and fasten.`,
      { parts: [`${shelves.length}× Shelf`], ids: shelves.map((p) => p.id), joint: sj, fasteners: fastenersText(sj, shelves[0].cut.thickness), tip: JOINT_TIPS[sj] });
    if (parts.find((p) => p.role === "divider")) add("Install the center divider", "Fit the vertical divider at mid-span between the bottom and top — it carries the long shelves.",
      { parts: ["1× Center divider"], ids: idsOf("divider"), joint: sj, fasteners: fastenersText(sj, thicknessOf("divider")), tip: "Cut it a hair long and shave to a press fit." });
    add("Fit the back panel", `Square the case, then fasten the back panel ${bj === "rabbets" ? "into its rabbets" : "over the back edges"}.`,
      { parts: ["1× Back panel"], ids: idsOf("back"), joint: bj, fasteners: `#8 × ${snapScrew(6)} mm screws (or 18 ga brads) + glue`, tip: "The back is what keeps the case square forever — fasten it only after the diagonals match.",
        why: beginner ? "A thin back panel acts as a shear panel; it locks the whole case against racking." : null });
  } else {
    // Composed pieces: walk the connection graph bottom-up so every step rests on the last.
    const byId = new Map(parts.map((p) => [p.id, p]));
    const conns = [...(spec.connections || [])].sort((a, b) => {
      const ya = Math.min(byId.get(a.partA)?.pos.y ?? 0, byId.get(a.partB)?.pos.y ?? 0);
      const yb = Math.min(byId.get(b.partA)?.pos.y ?? 0, byId.get(b.partB)?.pos.y ?? 0);
      return ya - yb;
    });
    for (const c of conns) {
      const a = byId.get(c.partA), b = byId.get(c.partB);
      if (!a || !b) continue;
      const ang = cutAngles(a.rot) || cutAngles(b.rot);
      add(`Join ${c.partA.replace(/_/g, " ")} to ${c.partB.replace(/_/g, " ")}`,
        `${jointPrep(c.joint)}, then assemble and clamp${c.faceHint ? ` (${c.faceHint})` : ""}.${ang ? ` Angled joint: ${angleText(ang)} — cut per the cut list before assembly.` : ""}`,
        { parts: [c.partA, c.partB], ids: [c.partA, c.partB], joint: c.joint,
          fasteners: fastenersText(c.joint, Math.min(a.cut.thickness, b.cut.thickness)), tip: JOINT_TIPS[c.joint] });
    }
    if (!conns.length) add("Assemble the parts", "Join the parts per your design intent.", { parts: ["All parts"], ids: parts.map((p) => p.id), joint: null, fasteners: "as appropriate", tip: "Dry-fit everything before glue." });
  }

  // Mandatory anti-tip anchoring: an instruction step, not an aside.
  if (integrity && integrity.antiTip) {
    add("Anchor to the wall (required)", "This piece is tall or top-heavy: fasten the anti-tip strap to the top rear of the piece and screw the wall side into a stud (not just drywall). Do this before loading any shelf.",
      { parts: ["Anti-tip wall anchor kit"], ids: [], joint: null, fasteners: "anchor strap + wall screws into a stud",
        tip: "A loaded top shelf moves the center of gravity up dramatically — the anchor is what makes this safe around kids.",
        why: beginner ? "Furniture tip-overs are one of the most common serious shop-project accidents, and the fix costs a few dollars." : null });
  }

  add("Sand and finish", "Sand everything through 120 → 180 → 220 grit, break the sharp edges, then apply finish to all faces (including the underside of tops and shelves).",
    { parts: ["Whole piece"], ids: parts.map((p) => p.id), joint: null, fasteners: "none", tip: "Finish both faces of wide solid panels equally, or uneven moisture exchange will cup them.",
      why: beginner ? "Wipe-on Danish oil is the most forgiving first finish: wipe on, wait, wipe off." : null });

  const toolSet = new Set(BASE_TOOLS);
  for (const j of spec.joinery) (JOINT_TOOLS[j.joint] || []).forEach((t) => toolSet.add(t));
  for (const c of spec.connections || []) (JOINT_TOOLS[c.joint] || []).forEach((t) => toolSet.add(t));
  if (parts.some((p) => cutAngles(p.rot))) toolSet.add("Miter saw (angled cuts)");
  return { steps, tools: [...toolSet] };
}

/* ============================== exports: SketchUp (.rb script and .dae COLLADA) ==============================
   Shared rotation convention: world M = Rz·Ry·Rx (degrees, X applied first) — identical to the
   3D view and the collision math. SketchUp axes: X right, Y back, Z up; ours: X right, Y up,
   Z front. The change of basis (x,y,z) -> (x,−z,y) maps our X->SU X, our Y->SU Z, our Z->SU −Y,
   so rotations map Rx->Rx, Ry->Rz, Rz->Ry(−).                                                  */

const rbEsc = (s) => String(s).replace(/\\/g, "\\\\").replace(/"/g, '\\"');

function rubyExport(spec, parts, prefs, revision) {
  const lines = [];
  const o = spec.overall;
  lines.push(`# ${spec.name} — Blueprint Buddy export (rev ${revision})`);
  if (o.width) lines.push(`# Overall: ${fmtLen(o.width, prefs)} W × ${fmtLen(o.depth, prefs)} D × ${fmtLen(o.height, prefs)} H · ${speciesOf(spec.material.species).label}`);
  lines.push(`# Estimates for hobby woodworking based on Wood Handbook material properties.`);
  lines.push(`# Paste into SketchUp's Ruby console, or save as .rb and run via Extensions.`);
  lines.push(`model = Sketchup.active_model`);
  lines.push(`model.start_operation("Blueprint Buddy - ${rbEsc(spec.name)}", true)`);
  lines.push(`root = model.active_entities.add_group`);
  lines.push(`root.name = "${rbEsc(spec.name)} (rev ${revision})"`);
  for (const p of parts) {
    const s = p.size;
    const label = `${p.name} — ${fmtLen(p.cut.thickness, prefs)} × ${fmtLen(p.cut.width, prefs)} × ${fmtLen(p.cut.length, prefs)}`;
    const r = p.rot || { x: 0, y: 0, z: 0 };
    lines.push(`grp = root.entities.add_group`);
    lines.push(`grp.name = "${rbEsc(label)}"`);
    if (p.prim === "cylinder") {
      lines.push(`edges = grp.entities.add_circle(Geom::Point3d.new(0, 0, ${(-s.y / 2).toFixed(2)}.mm), Z_AXIS, ${(s.x / 2).toFixed(2)}.mm, 24)`);
      lines.push(`face = grp.entities.add_face(edges)`);
    } else {
      // Box centered at the origin: our (x,y,z) sizes land in SU as (x-extent, z-depth->SU y, height->SU z).
      const hx = (s.x / 2).toFixed(2), hy = (s.z / 2).toFixed(2), hz = (s.y / 2).toFixed(2);
      lines.push(`face = grp.entities.add_face([Geom::Point3d.new(-${hx}.mm, -${hy}.mm, -${hz}.mm), Geom::Point3d.new(${hx}.mm, -${hy}.mm, -${hz}.mm), Geom::Point3d.new(${hx}.mm, ${hy}.mm, -${hz}.mm), Geom::Point3d.new(-${hx}.mm, ${hy}.mm, -${hz}.mm)])`);
    }
    lines.push(`face.reverse! if face.normal.z < 0`);
    lines.push(`face.pushpull(${p.prim === "cylinder" ? s.y.toFixed(2) : s.y.toFixed(2)}.mm)`);
    lines.push(`t = Geom::Transformation.translation(Geom::Vector3d.new(${p.pos.x.toFixed(2)}.mm, ${(-p.pos.z).toFixed(2)}.mm, ${p.pos.y.toFixed(2)}.mm))`);
    if (r.z) lines.push(`t = t * Geom::Transformation.rotation(ORIGIN, Y_AXIS, ${(-r.z).toFixed(2)}.degrees)`);
    if (r.y) lines.push(`t = t * Geom::Transformation.rotation(ORIGIN, Z_AXIS, ${r.y.toFixed(2)}.degrees)`);
    if (r.x) lines.push(`t = t * Geom::Transformation.rotation(ORIGIN, X_AXIS, ${r.x.toFixed(2)}.degrees)`);
    lines.push(`grp.transform!(t)`);
  }
  lines.push(`model.commit_operation`);
  return lines.join("\n") + "\n";
}

const xmlId = (s) => String(s).replace(/[^a-zA-Z0-9_-]+/g, "_");

function colladaExport(spec, parts, prefs, revision) {
  // Unit cube (centered, ±0.5) and unit 24-gon cylinder, scaled per part in the node matrix.
  const cubePos = [];
  for (const z of [-0.5, 0.5]) for (const y of [-0.5, 0.5]) for (const x of [-0.5, 0.5]) cubePos.push(x, y, z);
  // Vertex order above: index = x + 2*y + 4*z (x fastest).
  const cubeTris = [
    4, 5, 7, 5, 7, 6,   // z+ facing (indices with z bit set: 4..7 -> (-,-),(+,-),(-,+),(+,+))
    1, 0, 2, 1, 2, 3,   // z-
    5, 1, 3, 5, 3, 7,   // x+
    0, 4, 6, 0, 6, 2,   // x-
    2, 6, 7, 2, 7, 3,   // y+
    0, 1, 5, 0, 5, 4,   // y-
  ];
  const N = 24;
  const cylPos = [];
  for (const y of [-0.5, 0.5]) for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2;
    cylPos.push(0.5 * Math.cos(a), y, 0.5 * Math.sin(a));
  }
  cylPos.push(0, -0.5, 0, 0, 0.5, 0); // centers: 2N, 2N+1
  const cylTris = [];
  for (let i = 0; i < N; i++) {
    const j = (i + 1) % N;
    cylTris.push(i, j, N + j, i, N + j, N + i);        // side
    cylTris.push(2 * N, j, i);                          // bottom cap
    cylTris.push(2 * N + 1, N + i, N + j);              // top cap
  }
  const geom = (id, pos, tris) => `
    <geometry id="${id}"><mesh>
      <source id="${id}-pos"><float_array id="${id}-pos-array" count="${pos.length}">${pos.map((v) => +v.toFixed(4)).join(" ")}</float_array>
        <technique_common><accessor source="#${id}-pos-array" count="${pos.length / 3}" stride="3">
          <param name="X" type="float"/><param name="Y" type="float"/><param name="Z" type="float"/></accessor></technique_common></source>
      <vertices id="${id}-vtx"><input semantic="POSITION" source="#${id}-pos"/></vertices>
      <triangles count="${tris.length / 3}" material="wood"><input semantic="VERTEX" source="#${id}-vtx" offset="0"/><p>${tris.join(" ")}</p></triangles>
    </mesh></geometry>`;

  const nodes = parts.map((p, i) => {
    const r = p.rot || { x: 0, y: 0, z: 0 };
    const M = rotMat(r.x, r.y, r.z);
    const s = [p.size.x, p.size.y, p.size.z];
    const m = [
      M[0][0] * s[0], M[0][1] * s[1], M[0][2] * s[2], p.pos.x,
      M[1][0] * s[0], M[1][1] * s[1], M[1][2] * s[2], p.pos.y,
      M[2][0] * s[0], M[2][1] * s[1], M[2][2] * s[2], p.pos.z,
      0, 0, 0, 1,
    ].map((v) => +v.toFixed(5));
    const label = `${p.name} ${fmtLen(p.cut.thickness, prefs)} x ${fmtLen(p.cut.width, prefs)} x ${fmtLen(p.cut.length, prefs)}`.replace(/[<>&"]/g, "");
    return `      <node id="n${i}-${xmlId(p.id)}" name="${label}">
        <matrix>${m.join(" ")}</matrix>
        <instance_geometry url="#${p.prim === "cylinder" ? "cyl" : "box"}">
          <bind_material><technique_common><instance_material symbol="wood" target="#woodMat"/></technique_common></bind_material>
        </instance_geometry>
      </node>`;
  }).join("\n");

  return `<?xml version="1.0" encoding="utf-8"?>
<COLLADA xmlns="http://www.collada.org/2005/11/COLLADASchema" version="1.4.1">
  <asset>
    <contributor><authoring_tool>Blueprint Buddy</authoring_tool></contributor>
    <comments>${spec.name.replace(/[<>&"]/g, "")} (rev ${revision}). Estimates for hobby woodworking based on Wood Handbook material properties.</comments>
    <unit meter="0.001" name="millimeter"/>
    <up_axis>Y_UP</up_axis>
  </asset>
  <library_effects>
    <effect id="woodFx"><profile_COMMON><technique sid="common"><lambert>
      <diffuse><color>0.72 0.55 0.38 1</color></diffuse></lambert></technique></profile_COMMON></effect>
  </library_effects>
  <library_materials><material id="woodMat" name="wood"><instance_effect url="#woodFx"/></material></library_materials>
  <library_geometries>${geom("box", cubePos, cubeTris)}${geom("cyl", cylPos, cylTris)}
  </library_geometries>
  <library_visual_scenes>
    <visual_scene id="scene" name="${xmlId(spec.name)}">
${nodes}
    </visual_scene>
  </library_visual_scenes>
  <scene><instance_visual_scene url="#scene"/></scene>
</COLLADA>
`;
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
    '{"name":string,"furnitureType":"table"|"bookshelf"|"bench"|"desk"|"cabinet"|"nightstand"|"other","overall":{"width":mm,"depth":mm,"height":mm},"material":{"species":string},"features":[string],"joinery":[{"joint":string,"connects":[roleA,roleB]}],"designNotes":string,"parts":[...],"connections":[...] — parts+connections only when furnitureType is "other"}',
    `Allowed joint types for this user's experience level (${level}): ${allowed.join(", ")}. Never use any other joint.`,
    'Valid connects roles — leg-and-apron types (table/desk/bench/nightstand): top, leg, apron, shelf, stretcher. Carcass types (bookshelf/cabinet): side, top, bottom, shelf, back.',
    "You describe INTENT only. Code derives every part, dimension, position, and joinery allowance from your spec; any part sizes you supply for known furniture types are ignored. Known types are fast and single-shot — prefer them whenever the request fits one.",
    "",
    "NOVEL PIECES (furnitureType \"other\") use the composition grammar. You compose parametric primitives; code then validates that the piece stands, carries its loads, and can be built, and will send you specific structural errors to revise. Required fields:",
    '"parts": 2-40 entries, each {"id":unique string,"role":string,"primitive":"post"|"rail"|"panel"|"slab"|"cylinder","dimensions":{"length":mm,"width":mm,"thickness":mm},"position":{"x","y","z"},"rotation":{"x","y","z"} optional degrees,"grainDirection":"length"|"width","stock":"solid"|"sheet","loadBearing":bool,"surface":"seating"|"worktop"|"shelf"|"none"}',
    '"connections": [{"partA":id,"partB":id,"joint":allowed joint,"faceHint":short string}] — every part must appear in at least one connection; free-floating geometry is invalid.',
    "Coordinate system: y is up, the floor is y=0, +z is the front. position is the part CENTER in mm. Primitive orientations before rotation: post & cylinder stand vertical (length = height); rail & panel run along x (length horizontal, width vertical); slab lies flat (length along x, width along z, thickness vertical). rotation is degrees about the world x, y, z axes, applied x then y then z. Connected parts must physically touch/overlap at their joint; unconnected parts must not intersect.",
    "Declare loadBearing:true for every part in a load path, and surface for anything someone sets things on or sits on — the structural engine checks exactly what you declare.",
    "All dimensions in millimeters, each overall dimension 100-3000. Species: oak, maple, walnut, cherry, pine, or plywood. Use feature \"lower_shelf\" for a shelf under a table, \"stretchers\" for leg stretchers, or \"N shelves\" for shelf count in a bookshelf/cabinet.",
    "REFINEMENTS: when a current spec is provided below and the user asks for a change, EDIT that spec — change only what they asked for and keep everything else identical. Do not redesign. Omit optional fields you are not changing.",
    "STRUCTURAL CRITIQUE: when the user message is a structural critique of your last composition, fix ONLY the listed problems and return the corrected FULL spec.",
    spec ? `Current spec: ${JSON.stringify(spec)}` : "There is no current design yet.",
    `Example response: ${examplePrompt(level)}`,
  ].join("\n");
}

async function callClaude(system, messages) {
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: "claude-sonnet-5", max_tokens: 4000, system, messages }),
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

// Structured critique for the propose-validate-revise loop: failed checks in, revision prompt out.
function buildCritique(failedChecks) {
  const lines = failedChecks.slice(0, 10).map((c) => `- ${c.title}: ${c.explain} (${c.value}; required: ${c.threshold})`);
  return `Structural validation of your composition FAILED. Problems:\n${lines.join("\n")}\nFix ONLY these problems — keep the design intent, ids, and everything that already works. Return the corrected FULL DesignSpec as minified JSON only, nothing else.`;
}

/* ============================== persistent preferences (window.storage) ==============================
   One prefs object under one key. Load once on mount inside try/catch — a missing key THROWS,
   and the app must work perfectly on defaults if storage is absent or failing. Saves are
   debounced and fire-and-forget; the UI never blocks on storage. Designs are NOT persisted. */

const PREFS_KEY = "prefs:v1";

function usePrefs() {
  const [prefs, setPrefs] = useState(DEFAULT_PREFS);
  const saveTimer = useRef(null);
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = await window.storage.get(PREFS_KEY);
        if (alive && r && r.value) {
          const parsed = JSON.parse(r.value);
          setPrefs({ ...DEFAULT_PREFS, ...(parsed && typeof parsed === "object" ? parsed : {}) });
        }
      } catch { /* missing key or no storage: defaults are the product, not an error */ }
    })();
    return () => { alive = false; };
  }, []);
  const update = useCallback((patch) => {
    setPrefs((p) => {
      const next = { ...p, ...patch };
      clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => {
        try { window.storage.set(PREFS_KEY, JSON.stringify(next)).catch(() => {}); } catch { /* storage optional */ }
      }, 400);
      return next;
    });
  }, []);
  return [prefs, update];
}

/* ============================== drafting-studio theme ==============================
   Light: vintage paper drawing sheet. Dark: blueprint / cyanotype. One geometric
   grotesque for UI, one monospace (tabular figures) for every number. Both AA.   */

const THEMES = {
  light: {
    name: "light", paper: "#f2ecdd", panel: "#f8f4e8", card: "#fdfaf1",
    ink: "#211f18", inkSoft: "rgba(33,31,24,0.76)", inkFaint: "rgba(33,31,24,0.66)",
    rule: "rgba(33,31,24,0.18)", ruleFaint: "rgba(33,31,24,0.09)",
    accent: "#2e5f8a", accentInk: "#f7fbff", accentSoft: "rgba(46,95,138,0.12)",
    pass: "#2c6a45", adv: "#8a5514", fail: "#9c2c2c", failBg: "rgba(156,44,44,0.08)",
    scene: "#e9e1cc", grid: "#c9c0a6", draftFace: "#f4efe0", draftLine: "#2b2921",
    userBubble: "#2e5f8a", userInk: "#f7fbff",
  },
  dark: {
    name: "dark", paper: "#0b1c2c", panel: "#102539", card: "#142c42",
    ink: "#d9e7f4", inkSoft: "rgba(217,231,244,0.74)", inkFaint: "rgba(217,231,244,0.58)",
    rule: "rgba(199,222,242,0.22)", ruleFaint: "rgba(199,222,242,0.1)",
    accent: "#8ec1e8", accentInk: "#071b2a", accentSoft: "rgba(142,193,232,0.14)",
    pass: "#83d6a4", adv: "#e6be74", fail: "#f09c9c", failBg: "rgba(240,156,156,0.1)",
    scene: "#0a1826", grid: "#1e3a54", draftFace: "#11283c", draftLine: "#cfe4f6",
    scene2: "#0e2233",
    userBubble: "#8ec1e8", userInk: "#071b2a",
  },
};

const FONT_UI = "'Space Grotesk', 'Avenir Next', 'Segoe UI', system-ui, sans-serif";
const FONT_MONO = "'IBM Plex Mono', ui-monospace, 'SF Mono', Menlo, Consolas, monospace";
const FONT_HREF = "https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500;600&display=swap";

// Webfonts via a link tag with a system-stack fallback: the app must look intentional without them.
function useFonts() {
  useEffect(() => {
    if (document.querySelector('link[data-bb-fonts]')) return;
    const link = document.createElement("link");
    link.rel = "stylesheet"; link.href = FONT_HREF; link.setAttribute("data-bb-fonts", "1");
    document.head.appendChild(link);
  }, []);
}

// All chrome styling lives here, driven by CSS variables the theme sets on the root.
const BB_CSS = `
.bb-root { background: var(--paper); color: var(--ink); font-family: ${FONT_UI}; }
.bb-fade, .bb-fade * { transition: background-color .25s ease, border-color .25s ease, color .25s ease; }
.num, .bb-mono { font-family: ${FONT_MONO}; font-variant-numeric: tabular-nums; letter-spacing: -0.01em; }
.bb-sect { font-size: 10px; font-weight: 700; letter-spacing: 0.14em; text-transform: uppercase;
  color: var(--ink-soft); border-bottom: 1px solid var(--rule); padding-bottom: 4px; }
.bb-btn { border: 1px solid var(--ink); background: transparent; color: var(--ink);
  font: 600 11px ${FONT_UI}; padding: 5px 10px; border-radius: 2px; cursor: pointer; }
.bb-btn:hover { background: var(--accent-soft); }
.bb-btn:active { transform: translateY(0.5px); }
.bb-btn:disabled { opacity: 0.4; cursor: default; transform: none; }
.bb-btn-primary { background: var(--accent); border-color: var(--accent); color: var(--accent-ink); }
.bb-btn-primary:hover { filter: brightness(1.08); background: var(--accent); }
.bb-btn-ghost { border-color: var(--rule); color: var(--ink-soft); }
.bb-btn-ghost:hover { color: var(--ink); border-color: var(--ink); }
.bb-chip { display: inline-flex; align-items: center; gap: 4px; border: 1px solid var(--rule);
  border-radius: 2px; padding: 1px 7px; font: 600 10px ${FONT_UI}; letter-spacing: 0.06em;
  text-transform: uppercase; color: var(--ink-soft); }
.bb-chip-num { text-transform: none; letter-spacing: 0; font-family: ${FONT_MONO}; font-size: 10.5px; }
.bb-stamp { display: inline-block; border: 1.5px solid currentColor; border-radius: 2px;
  font: 700 9.5px ${FONT_UI}; letter-spacing: 0.12em; text-transform: uppercase; padding: 1px 6px; }
.bb-input, .bb-select { border: 1px solid var(--rule); background: var(--card); color: var(--ink);
  border-radius: 2px; font: 500 12px ${FONT_UI}; padding: 6px 8px; }
.bb-input:focus, .bb-select:focus { outline: none; border-color: var(--accent); }
.bb-input::placeholder { color: var(--ink-faint); }
.bb-select { cursor: pointer; }
.bb-tab { padding: 8px 10px; font: 600 11px ${FONT_UI}; letter-spacing: 0.04em; text-transform: uppercase;
  color: var(--ink-soft); border-bottom: 2px solid transparent; cursor: pointer; background: none; border-top: none; border-left: none; border-right: none; }
.bb-tab:hover { color: var(--ink); }
.bb-tab.on { color: var(--accent); border-bottom-color: var(--accent); }
.bb-table { width: 100%; font-size: 11.5px; border-collapse: collapse; }
.bb-table th { text-align: left; font: 700 9.5px ${FONT_UI}; letter-spacing: 0.1em; text-transform: uppercase;
  color: var(--ink-soft); border-bottom: 1px solid var(--rule); padding: 5px 8px 5px 0; }
.bb-table td { border-bottom: 1px solid var(--rule-faint); padding: 5px 8px 5px 0; color: var(--ink); }
.bb-hairline { border-color: var(--rule) !important; }
.bb-card { background: var(--card); border: 1px solid var(--rule); border-radius: 2px; }
.bb-pop { background: var(--panel); border: 1px solid var(--ink); border-radius: 2px;
  box-shadow: 4px 4px 0 var(--accent-soft); }
.bb-root ::-webkit-scrollbar { width: 8px; height: 8px; }
.bb-root ::-webkit-scrollbar-thumb { background: var(--rule); border-radius: 4px; }
.bb-root :focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
.bb-range { accent-color: var(--accent); }
@media (prefers-reduced-motion: reduce) { .bb-fade, .bb-fade * { transition: none !important; } }
.bb-reduced, .bb-reduced * { transition: none !important; animation: none !important; }

/* ---- drawing sheet (print view) ---- */
.bb-sheet { background: #fdfbf4; color: #1c1a14; font-family: ${FONT_UI}; position: relative;
  border: 2px solid #1c1a14; padding: 26px; }
.bb-sheet .num { color: #1c1a14; }
.bb-regmark { position: absolute; width: 14px; height: 14px; pointer-events: none; }
.bb-regmark::before, .bb-regmark::after { content: ""; position: absolute; background: #1c1a14; }
.bb-regmark::before { left: 50%; top: 0; bottom: 0; width: 1px; }
.bb-regmark::after { top: 50%; left: 0; right: 0; height: 1px; }
.bb-titleblock { border: 1.5px solid #1c1a14; display: grid; grid-template-columns: 2.2fr 1.6fr 1fr 1fr 1fr 0.8fr; }
.bb-titleblock > div { border-left: 1px solid #1c1a14; padding: 6px 9px; min-width: 0; }
.bb-titleblock > div:first-child { border-left: none; }
.bb-titleblock .tb-label { font-size: 8px; font-weight: 700; letter-spacing: 0.14em; text-transform: uppercase; color: #6b6656; }
.bb-titleblock .tb-value { font-family: ${FONT_MONO}; font-size: 11.5px; font-weight: 600; margin-top: 2px; overflow-wrap: break-word; }
.bb-sheet table { width: 100%; border-collapse: collapse; font-size: 10.5px; }
.bb-sheet th { text-align: left; font-size: 8.5px; letter-spacing: 0.12em; text-transform: uppercase;
  border-bottom: 1px solid #1c1a14; padding: 3px 8px 3px 0; }
.bb-sheet td { border-bottom: 1px solid rgba(28,26,20,0.15); padding: 3px 8px 3px 0; font-family: ${FONT_MONO}; }
@media print {
  body * { visibility: hidden; }
  .bb-print-wrap, .bb-print-wrap * { visibility: visible; }
  .bb-print-wrap { position: absolute !important; inset: 0; overflow: visible !important; background: white; padding: 0 !important; }
  .bb-noprint { display: none !important; }
}
`;

const cssVars = (t) => ({
  "--paper": t.paper, "--panel": t.panel, "--card": t.card, "--ink": t.ink,
  "--ink-soft": t.inkSoft, "--ink-faint": t.inkFaint, "--rule": t.rule, "--rule-faint": t.ruleFaint,
  "--accent": t.accent, "--accent-ink": t.accentInk, "--accent-soft": t.accentSoft,
  "--pass": t.pass, "--adv": t.adv, "--fail": t.fail, "--fail-bg": t.failBg,
});

/* ============================== 3D viewer (one renderer, refs only, no setState in the loop) ============================== */

const ROLE_COLORS = {
  top: "#b98a5e", leg: "#7d5a3c", apron: "#96714e", stretcher: "#96714e",
  shelf: "#c19a6b", side: "#a9805b", bottom: "#a9805b", back: "#d9c3a3",
  divider: "#b08a63", generic: "#a1795a",
};

function Viewer({ parts, explodeTarget, onSelect, drafting, showDims, prefs, theme, highlightIds, reduced, apiRef }) {
  const containerRef = useRef(null);
  const R = useRef({});
  const onSelectRef = useRef(onSelect);
  useEffect(() => { onSelectRef.current = onSelect; }, [onSelect]);
  useEffect(() => { R.current.explodeTarget = explodeTarget; }, [explodeTarget]);
  useEffect(() => { R.current.reduced = reduced; }, [reduced]);
  useEffect(() => { R.current.showDims = showDims; }, [showDims]);

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
    r.hemi = new THREE.HemisphereLight(0xfff4e6, 0x8a7a66, 0.95);
    r.scene.add(r.hemi);
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
    r.annot = new THREE.Group();
    r.scene.add(r.annot);

    // Motion state (all refs; the loop only reads/writes these). Damped-lerp, tuned quick.
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
      const k = r.reduced ? 1 : Math.min(1, dt * 7), kc = r.reduced ? 1 : Math.min(1, dt * 8);
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
      r.annot.visible = !!r.showDims && r.explode < 0.05;
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
      if (r.selMesh && r.selMesh.material.emissive) r.selMesh.material.emissive.setHex(0x000000);
      r.selMesh = mesh || null;
      if (mesh && mesh.material.emissive) mesh.material.emissive.setHex(0x6b3f14);
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
      clearAnnotations(r);
      r.groundGeo.dispose(); r.groundMat.dispose();
      r.renderer.dispose();
      el.removeChild(dom);
    };
  }, []);

  // Print-sheet capture: render one frame synchronously, then read the canvas.
  useEffect(() => {
    if (!apiRef) return;
    apiRef.current = {
      capture: () => {
        const r = R.current;
        if (!r.renderer) return null;
        r.renderer.render(r.scene, r.camera);
        try { return r.renderer.domElement.toDataURL("image/png"); } catch { return null; }
      },
    };
    return () => { apiRef.current = null; };
  }, [apiRef]);

  // Rebuild the model on spec change: dispose every old geometry/material, then rebuild + reframe.
  useEffect(() => {
    const r = R.current;
    if (!r.group) return;
    r.setHighlight(null);
    for (const m of [...r.group.children]) { m.geometry.dispose(); m.material.dispose(); r.group.remove(m); }
    if (!parts.length) { r.bbox = null; return; }

    // OBB-accurate bounds so rotated parts frame correctly.
    let minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9, minZ = 1e9, maxZ = -1e9;
    for (const p of parts) for (const c of obbCorners(partOBB(p))) {
      minX = Math.min(minX, c[0]); maxX = Math.max(maxX, c[0]);
      minY = Math.min(minY, c[1]); maxY = Math.max(maxY, c[1]);
      minZ = Math.min(minZ, c[2]); maxZ = Math.max(maxZ, c[2]);
    }
    const cx = (minX + maxX) / 2, cz = (minZ + maxZ) / 2, cy = (minY + maxY) / 2;
    const sizeX = maxX - minX, sizeY = maxY - minY, sizeZ = maxZ - minZ;
    const radius = 0.5 * Math.hypot(sizeX, sizeY, sizeZ) / 1000; // bounding sphere, meters
    const modelCenter = new THREE.Vector3(0, cy / 1000, 0);
    r.bbox = { // mesh-space (meters), for the annotation layer
      minX: (minX - cx) / 1000, maxX: (maxX - cx) / 1000, minY: minY / 1000, maxY: maxY / 1000,
      minZ: (minZ - cz) / 1000, maxZ: (maxZ - cz) / 1000,
      w: sizeX, h: sizeY, d: sizeZ, radius,
    };

    for (const p of parts) {
      const geo = p.prim === "cylinder"
        ? new THREE.CylinderGeometry(p.size.x / 2000, p.size.x / 2000, p.size.y / 1000, 24)
        : new THREE.BoxGeometry(p.size.x / 1000, p.size.y / 1000, p.size.z / 1000);
      const mat = new THREE.MeshStandardMaterial({ color: ROLE_COLORS[p.role] || ROLE_COLORS.generic, roughness: 0.75, metalness: 0.05 });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.castShadow = true; mesh.receiveShadow = true;
      if (p.rot) mesh.rotation.set(rad(p.rot.x || 0), rad(p.rot.y || 0), rad(p.rot.z || 0), "ZYX");
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
      mesh.userData = { assembled, explodeVec: v, part: p, baseColor: mat.color.getHex() };
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

  /* ---- drafting render mode: line-art via EdgesGeometry over flat pale faces + floor grid ----
     Every resource this mode creates is disposed on the way out (toggle or unmount).        */
  useEffect(() => {
    const r = R.current;
    if (!r.group || !drafting) return;
    const res = { edges: [], mats: [], grid: null };
    const face = new THREE.Color(theme.draftFace), line = new THREE.Color(theme.draftLine);
    for (const mesh of r.group.children) {
      mesh.userData.origMat = mesh.material;
      const flat = new THREE.MeshLambertMaterial({ color: face, emissive: new THREE.Color(0x000000), polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 });
      mesh.material = flat;
      res.mats.push(flat);
      mesh.castShadow = false;
      const eg = new THREE.EdgesGeometry(mesh.geometry, 20);
      const em = new THREE.LineBasicMaterial({ color: line });
      const edges = new THREE.LineSegments(eg, em);
      mesh.add(edges);
      res.edges.push({ mesh, edges, eg, em });
    }
    const gridSize = Math.max(2, (r.bbox ? r.bbox.radius : 1) * 4);
    res.grid = new THREE.GridHelper(gridSize, Math.round(gridSize * 10), new THREE.Color(theme.grid), new THREE.Color(theme.grid));
    res.grid.position.y = 0.001;
    r.scene.add(res.grid);
    r.groundMat.opacity = 0;
    return () => {
      for (const { mesh, edges, eg, em } of res.edges) {
        mesh.remove(edges); eg.dispose(); em.dispose();
        if (mesh.userData.origMat) { mesh.material = mesh.userData.origMat; mesh.userData.origMat = null; }
        mesh.castShadow = true;
      }
      for (const m of res.mats) m.dispose();
      if (res.grid) { r.scene.remove(res.grid); res.grid.geometry.dispose(); res.grid.material.dispose(); }
      r.groundMat.opacity = 0.22;
    };
  }, [drafting, parts, theme]);

  /* ---- step-synced highlight: dim everything not in the active assembly step ---- */
  useEffect(() => {
    const r = R.current;
    if (!r.group) return;
    const set = highlightIds && highlightIds.length ? new Set(highlightIds) : null;
    for (const mesh of r.group.children) {
      const on = !set || set.has(mesh.userData.part.id);
      mesh.material.transparent = !on;
      mesh.material.opacity = on ? 1 : 0.12;
      mesh.material.depthWrite = on;
    }
    return () => {
      for (const mesh of r.group.children) {
        mesh.material.transparent = false; mesh.material.opacity = 1; mesh.material.depthWrite = true;
      }
    };
  }, [highlightIds, parts, drafting]);

  /* ---- dimension annotations: extension lines, slash terminators, monospace labels ---- */
  useEffect(() => {
    const r = R.current;
    if (!r.annot) return;
    clearAnnotations(r);
    if (!showDims || !r.bbox) return;
    buildAnnotations(r, prefs, theme);
    return () => clearAnnotations(R.current);
  }, [parts, showDims, prefs, theme]);

  return <div ref={containerRef} className="absolute inset-0" />;
}

function clearAnnotations(r) {
  if (!r || !r.annot) return;
  for (const o of [...r.annot.children]) {
    if (o.geometry) o.geometry.dispose();
    if (o.material) { if (o.material.map) o.material.map.dispose(); o.material.dispose(); }
    r.annot.remove(o);
  }
}

function labelSprite(text, theme, hWorld) {
  const c = document.createElement("canvas");
  const ctx = c.getContext("2d");
  const font = `600 44px ${FONT_MONO.split(",")[0].replace(/'/g, "")}, monospace`;
  ctx.font = font;
  const w = Math.ceil(ctx.measureText(text).width) + 36;
  c.width = w; c.height = 68;
  const ctx2 = c.getContext("2d");
  ctx2.fillStyle = theme.paper;
  ctx2.globalAlpha = 0.92;
  ctx2.fillRect(0, 0, w, 68);
  ctx2.globalAlpha = 1;
  ctx2.strokeStyle = theme.draftLine; ctx2.lineWidth = 3;
  ctx2.strokeRect(1.5, 1.5, w - 3, 65);
  ctx2.font = font;
  ctx2.fillStyle = theme.draftLine;
  ctx2.textBaseline = "middle"; ctx2.textAlign = "center";
  ctx2.fillText(text, w / 2, 36);
  const tex = new THREE.CanvasTexture(c);
  tex.anisotropy = 4;
  const mat = new THREE.SpriteMaterial({ map: tex, depthTest: false });
  const spr = new THREE.Sprite(mat);
  spr.scale.set((w / 68) * hWorld, hWorld, 1);
  spr.renderOrder = 10;
  return spr;
}

function buildAnnotations(r, prefs, theme) {
  const b = r.bbox;
  const off = Math.max(b.radius * 0.14, 0.03);
  const tick = off * 0.18;
  const y0 = 0.002;
  const segs = [];
  const seg = (a, c) => segs.push(a[0], a[1], a[2], c[0], c[1], c[2]);
  const slash = (p, dir) => { // 45° slash terminator in the plane of dir (unit-ish [dx,dy,dz] pairs)
    seg([p[0] - dir[0] * tick, p[1] - dir[1] * tick, p[2] - dir[2] * tick],
        [p[0] + dir[0] * tick, p[1] + dir[1] * tick, p[2] + dir[2] * tick]);
  };
  // Width (X) along the front edge, on the floor plane.
  const zw = b.maxZ + off;
  seg([b.minX, y0, b.maxZ + 0.01], [b.minX, y0, zw + tick]); // extension lines
  seg([b.maxX, y0, b.maxZ + 0.01], [b.maxX, y0, zw + tick]);
  seg([b.minX, y0, zw], [b.maxX, y0, zw]);
  slash([b.minX, y0, zw], [0.7, 0, 0.7]);
  slash([b.maxX, y0, zw], [0.7, 0, 0.7]);
  // Depth (Z) along the right edge, on the floor plane.
  const xd = b.maxX + off;
  seg([b.maxX + 0.01, y0, b.minZ], [xd + tick, y0, b.minZ]);
  seg([b.maxX + 0.01, y0, b.maxZ], [xd + tick, y0, b.maxZ]);
  seg([xd, y0, b.minZ], [xd, y0, b.maxZ]);
  slash([xd, y0, b.minZ], [0.7, 0, 0.7]);
  slash([xd, y0, b.maxZ], [0.7, 0, 0.7]);
  // Height (Y) up the front-right corner.
  const xh = b.maxX + off, zh = b.maxZ + off;
  seg([b.maxX + 0.01, b.minY + 0.001, b.maxZ + 0.01], [xh + tick, b.minY + 0.001, zh + tick]);
  seg([b.maxX + 0.01, b.maxY, b.maxZ + 0.01], [xh + tick, b.maxY, zh + tick]);
  seg([xh, b.minY, zh], [xh, b.maxY, zh]);
  slash([xh, b.minY, zh], [0.7, 0.7, 0]);
  slash([xh, b.maxY, zh], [0.7, 0.7, 0]);

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(segs, 3));
  const mat = new THREE.LineBasicMaterial({ color: new THREE.Color(theme.draftLine), transparent: true, opacity: 0.9 });
  r.annot.add(new THREE.LineSegments(geo, mat));

  const hL = Math.max(b.radius * 0.085, 0.02);
  const lw = labelSprite(fmtLen(b.w, prefs), theme, hL);
  lw.position.set((b.minX + b.maxX) / 2, y0 + hL * 0.7, zw + hL * 0.4);
  r.annot.add(lw);
  const ld = labelSprite(fmtLen(b.d, prefs), theme, hL);
  ld.position.set(xd + hL * 0.6, y0 + hL * 0.7, (b.minZ + b.maxZ) / 2);
  r.annot.add(ld);
  const lh = labelSprite(fmtLen(b.h, prefs), theme, hL);
  lh.position.set(xh + hL * 0.5, (b.minY + b.maxY) / 2, zh + hL * 0.5);
  r.annot.add(lh);
}

/* ============================== UI components (drafting-studio system) ============================== */

const DISCLAIMER = "Estimates for hobby woodworking based on Wood Handbook material properties. Not certified structural engineering.";

const STATUS_COLOR = { pass: "var(--pass)", advisory: "var(--adv)", fail: "var(--fail)" };
const STATUS_TEXT = { pass: "pass", advisory: "advisory", fail: "fail" };
function Stamp({ status }) {
  return <span className="bb-stamp" style={{ color: STATUS_COLOR[status] || "var(--ink-soft)" }}>{STATUS_TEXT[status] || status}</span>;
}
function DiffChips({ chips }) {
  if (!chips || !chips.length) return null;
  return (
    <div className="flex flex-wrap gap-1.5 mt-1.5">
      {chips.map((c, i) => <span key={i} className="bb-chip bb-chip-num" style={{ color: "var(--accent)", borderColor: "var(--accent)" }}>{c}</span>)}
    </div>
  );
}

function IntegrityPanel({ integrity, prefs, loadChoices, setLoadChoices, onFix, lastDiff }) {
  const { checks, surfaces, summary, racking } = integrity;
  const overall = summary.fails ? "fail" : summary.advisories ? "advisory" : "pass";
  return (
    <div className="p-3 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Stamp status={overall} />
          <span className="text-xs" style={{ color: "var(--ink-soft)" }}>
            {checks.length} checks · {summary.fails} fail · {summary.advisories} advisory
          </span>
        </div>
      </div>
      <DiffChips chips={lastDiff} />

      {surfaces.length > 0 && (
        <div>
          <div className="bb-sect mb-2">Load presets (per surface)</div>
          <div className="space-y-1.5">
            {surfaces.map((s) => (
              <div key={s.id} className="flex items-center justify-between gap-2">
                <span className="text-xs" style={{ color: "var(--ink)" }}>{s.label}
                  <span className="num text-[10px] ml-1.5" style={{ color: "var(--ink-faint)" }}>{Math.round(s.span)} mm {s.model === "cant" ? "cantilever" : "span"}</span>
                </span>
                <select className="bb-select text-xs py-1" value={s.presetKey}
                  onChange={(e) => setLoadChoices((c) => ({ ...c, [s.id]: e.target.value }))}>
                  {PRESET_KEYS.map((k) => <option key={k} value={k}>{LOAD_PRESETS[k].label} — {LOAD_PRESETS[k].detail}</option>)}
                </select>
              </div>
            ))}
          </div>
        </div>
      )}

      <div>
        <div className="bb-sect mb-2">Checks</div>
        <div className="space-y-2.5">
          {checks.map((c) => (
            <div key={c.id} className="bb-card p-2.5" style={c.status === "fail" ? { background: "var(--fail-bg)", borderColor: "var(--fail)" } : {}}>
              <div className="flex items-start justify-between gap-2">
                <span className="text-xs font-semibold" style={{ color: "var(--ink)" }}>{c.title}</span>
                <Stamp status={c.status} />
              </div>
              <div className="num text-[11px] mt-1" style={{ color: "var(--ink)" }}>{c.value}</div>
              <div className="num text-[10px] mt-0.5" style={{ color: "var(--ink-faint)" }}>threshold: {c.threshold}</div>
              <p className="text-[11px] mt-1 leading-relaxed" style={{ color: "var(--ink-soft)" }}>{c.explain}</p>
              {c.factors && (
                <div className="mt-1.5 space-y-0.5">
                  {c.factors.map((f, i) => (
                    <div key={i} className="flex justify-between text-[10px]" style={{ color: "var(--ink-faint)" }}>
                      <span>{f.label}</span>
                      <span className="num">{f.mult ? `× ${f.mult}` : `+${f.pts}`}</span>
                    </div>
                  ))}
                </div>
              )}
              {c.fixes && c.fixes.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {c.fixes.map((f) => (
                    <button key={f.id} className="bb-btn bb-btn-primary text-[10px] py-1" onClick={() => onFix(f)}>{f.label}</button>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function ReferencePanel() {
  return (
    <div className="p-3 space-y-4 text-xs" style={{ color: "var(--ink)" }}>
      <div>
        <div className="bb-sect mb-2">Shop reference — species properties</div>
        <div className="overflow-x-auto">
          <table className="bb-table">
            <thead><tr><th>Species</th><th>MOE GPa</th><th>MOR MPa</th><th>SG</th><th>Janka lbf</th></tr></thead>
            <tbody>
              {Object.entries(SPECIES).map(([k, s]) => (
                <tr key={k}><td>{s.label}</td><td className="num">{s.moe.toFixed(1)}</td><td className="num">{s.mor}</td><td className="num">{s.sg.toFixed(2)}</td><td className="num">{s.janka}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-1.5 text-[10px]" style={{ color: "var(--ink-faint)" }}>USDA Forest Products Laboratory Wood Handbook, 12% moisture content. Plywood values are effective (cross-plies).</p>
      </div>
      <div>
        <div className="bb-sect mb-2">What each property drives</div>
        <ul className="space-y-1 leading-relaxed" style={{ color: "var(--ink-soft)" }}>
          <li><b style={{ color: "var(--ink)" }}>MOE</b> → stiffness: sag and deflection. Nothing else predicts sag.</li>
          <li><b style={{ color: "var(--ink)" }}>MOR</b> → strength: breaking-load margins (safety factor 4).</li>
          <li><b style={{ color: "var(--ink)" }}>Specific gravity</b> → fastener holding and joint capacity.</li>
          <li><b style={{ color: "var(--ink)" }}>Janka</b> → surface duty only: dent and wear. Never in sag or strength math.</li>
        </ul>
      </div>
      <div>
        <div className="bb-sect mb-2">Joinery ratings (heuristic)</div>
        <table className="bb-table">
          <thead><tr><th>Joint</th><th>Racking pts</th><th>Capacity N (SG 0.50)</th></tr></thead>
          <tbody>
            {Object.entries(JOINT_RATING).map(([k, r]) => (
              <tr key={k}><td>{JOINT_LABEL[k]}</td><td className="num">{r.rackPts.toFixed(1)}</td><td className="num">{r.capN}</td></tr>
            ))}
          </tbody>
        </table>
      </div>
      <div>
        <div className="bb-sect mb-2">Load presets</div>
        <table className="bb-table">
          <thead><tr><th>Preset</th><th>Load</th></tr></thead>
          <tbody>
            {PRESET_KEYS.map((k) => (
              <tr key={k}><td>{LOAD_PRESETS[k].label}</td><td className="num">{LOAD_PRESETS[k].detail}</td></tr>
            ))}
          </tbody>
        </table>
      </div>
      <div>
        <div className="bb-sect mb-2">Stock thicknesses</div>
        <p style={{ color: "var(--ink-soft)" }}>Solid: <span className="num">{SOLID_THICKNESSES.join(" / ")} mm</span> (4/4–8/4 surfaced) · Sheet: <span className="num">{SHEET_THICKNESSES.join(" / ")} mm</span></p>
      </div>
    </div>
  );
}

function PrefsPopover({ prefs, update, requestLevel, onClose }) {
  const Row = ({ label, children }) => (
    <div className="flex items-center justify-between gap-3 py-1.5">
      <span className="text-xs font-medium" style={{ color: "var(--ink)" }}>{label}</span>
      {children}
    </div>
  );
  return (
    <div className="bb-pop absolute right-3 top-12 z-40 w-72 p-3" role="dialog" aria-label="Preferences">
      <div className="flex items-center justify-between mb-1">
        <span className="bb-sect border-none p-0" style={{ borderBottom: "none" }}>Preferences</span>
        <button className="bb-btn bb-btn-ghost text-[10px] py-0.5 px-2" onClick={onClose}>Close</button>
      </div>
      <Row label="Units">
        <select className="bb-select text-xs py-1" value={prefs.unitSystem} onChange={(e) => update({ unitSystem: e.target.value })}>
          <option value="in">Fractional inches</option>
          <option value="ind">Decimal inches</option>
          <option value="cm">Centimeters</option>
          <option value="mm">Millimeters</option>
        </select>
      </Row>
      {isImperial(prefs) && (
        <Row label="Imperial precision">
          <select className="bb-select text-xs py-1" value={prefs.precision} onChange={(e) => update({ precision: Number(e.target.value) })}>
            <option value={16}>1/16"</option>
            <option value={32}>1/32"</option>
          </select>
        </Row>
      )}
      <Row label="Dual-unit display">
        <input type="checkbox" checked={prefs.dualUnits} onChange={(e) => update({ dualUnits: e.target.checked })} />
      </Row>
      <Row label="Experience level">
        <select className="bb-select text-xs py-1" value={prefs.level} onChange={(e) => requestLevel(e.target.value)}>
          <option value="beginner">Beginner</option>
          <option value="intermediate">Intermediate</option>
          <option value="advanced">Advanced</option>
        </select>
      </Row>
      <Row label="Default shelf load">
        <select className="bb-select text-xs py-1" value={prefs.defaultLoad} onChange={(e) => update({ defaultLoad: e.target.value })}>
          <option value="auto">Auto (by type)</option>
          {["display", "books", "heavy"].map((k) => <option key={k} value={k}>{LOAD_PRESETS[k].label}</option>)}
        </select>
      </Row>
      <Row label="Dimension annotations">
        <input type="checkbox" checked={prefs.annotations} onChange={(e) => update({ annotations: e.target.checked })} />
      </Row>
      <Row label="Theme">
        <select className="bb-select text-xs py-1" value={prefs.theme} onChange={(e) => update({ theme: e.target.value })}>
          <option value="auto">Auto</option>
          <option value="light">Paper (light)</option>
          <option value="dark">Blueprint (dark)</option>
        </select>
      </Row>
      <Row label="Reduce motion">
        <select className="bb-select text-xs py-1" value={prefs.reducedMotion} onChange={(e) => update({ reducedMotion: e.target.value })}>
          <option value="auto">Follow system</option>
          <option value="on">Always</option>
        </select>
      </Row>
      <p className="text-[10px] mt-2 pt-2 border-t bb-hairline" style={{ color: "var(--ink-faint)" }}>
        Saved to your device; applies everywhere including exports.
      </p>
    </div>
  );
}

function HistoryDrawer({ history, current, onRestore, onClose, prefs }) {
  return (
    <div className="absolute inset-0 z-40 flex justify-end" onClick={onClose}>
      <div className="w-80 max-w-full h-full overflow-y-auto p-3 bb-fade" style={{ background: "var(--panel)", borderLeft: "1px solid var(--ink)" }} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-2">
          <span className="bb-sect" style={{ borderBottom: "none" }}>Revision history</span>
          <button className="bb-btn bb-btn-ghost text-[10px] py-0.5 px-2" onClick={onClose}>Close</button>
        </div>
        <div className="space-y-1.5">
          {history.map((h, i) => (
            <button key={i} onClick={() => onRestore(i)}
              className="w-full text-left bb-card p-2 cursor-pointer"
              style={i === current ? { borderColor: "var(--accent)", background: "var(--accent-soft)" } : {}}>
              <div className="flex items-center justify-between">
                <span className="num text-[10px]" style={{ color: "var(--accent)" }}>REV {i + 1}</span>
                <span className="num text-[10px]" style={{ color: "var(--ink-faint)" }}>{new Date(h.ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
              </div>
              <div className="text-xs font-medium mt-0.5" style={{ color: "var(--ink)" }}>{h.label}</div>
              <div className="num text-[10px] mt-0.5" style={{ color: "var(--ink-soft)" }}>
                {h.spec.name} · {fmtLen(h.spec.overall.width, prefs)} × {fmtLen(h.spec.overall.depth, prefs)} × {fmtLen(h.spec.overall.height, prefs)}
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function PrintSheet({ spec, cutRows, bom, integrity, prefs, revision, img, onClose }) {
  const sp = speciesOf(spec.material.species);
  const overall = integrity.summary.fails ? "FAIL" : integrity.summary.advisories ? "ADVISORY" : "PASS";
  return (
    <div className="bb-print-wrap fixed inset-0 z-50 overflow-auto p-4 sm:p-6" style={{ background: "rgba(10,20,30,0.55)" }}>
      <div className="max-w-3xl mx-auto">
        <div className="flex gap-2 justify-end mb-2 bb-noprint">
          <button className="bb-btn" style={{ background: "#fdfbf4", color: "#1c1a14", borderColor: "#1c1a14" }} onClick={() => window.print()}>Print</button>
          <button className="bb-btn" style={{ background: "#fdfbf4", color: "#1c1a14", borderColor: "#1c1a14" }} onClick={onClose}>Close</button>
        </div>
        <div className="bb-sheet">
          <span className="bb-regmark" style={{ top: -7, left: -7 }} /><span className="bb-regmark" style={{ top: -7, right: -7 }} />
          <span className="bb-regmark" style={{ bottom: -7, left: -7 }} /><span className="bb-regmark" style={{ bottom: -7, right: -7 }} />
          <div className="flex items-baseline justify-between border-b-2 pb-2 mb-4" style={{ borderColor: "#1c1a14" }}>
            <div>
              <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.2em" }}>BLUEPRINT BUDDY · DRAWING SHEET</div>
              <div style={{ fontSize: 22, fontWeight: 700, letterSpacing: "-0.01em" }}>{spec.name}</div>
            </div>
            <div className="num" style={{ fontSize: 11 }}>INTEGRITY: {overall}</div>
          </div>
          {img && (
            <div className="mb-4 flex justify-center" style={{ border: "1px solid rgba(28,26,20,0.3)", padding: 8 }}>
              <img src={img} alt={`${spec.name} 3D view`} style={{ maxWidth: "100%", maxHeight: 300 }} />
            </div>
          )}
          <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.14em", marginBottom: 4 }}>CUT LIST</div>
          <table className="mb-4">
            <thead><tr><th>Part</th><th>Qty</th><th>T × W × L ({UNIT_LABEL[prefs.unitSystem]})</th><th>Material</th><th>Angles</th></tr></thead>
            <tbody>
              {cutRows.map((r, i) => (
                <tr key={i}>
                  <td style={{ fontFamily: "inherit" }}>{r.name}{r.cylinder ? " (Ø)" : ""}</td>
                  <td>{r.qty}</td>
                  <td>{fmtLenBare(r.cut.thickness, prefs)} × {fmtLenBare(r.cut.width, prefs)} × {fmtLenBare(r.cut.length, prefs)}</td>
                  <td style={{ fontFamily: "inherit" }}>{r.material}</td>
                  <td>{angleText(r.angles) || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="flex flex-wrap gap-x-6 gap-y-1 mb-4" style={{ fontSize: 10 }}>
            {integrity.checks.slice(0, 8).map((c) => (
              <span key={c.id} className="num">{c.title}: {STATUS_TEXT[c.status] || c.status}</span>
            ))}
            <span className="num">Est. materials: {money(bom.total)}</span>
          </div>
          <p style={{ fontSize: 8.5, color: "#6b6656", marginBottom: 10 }}>{DISCLAIMER}</p>
          <div className="bb-titleblock">
            <div><div className="tb-label">Design</div><div className="tb-value">{spec.name}</div></div>
            <div><div className="tb-label">Overall W×D×H</div><div className="tb-value">{fmtLen(spec.overall.width, prefs)} × {fmtLen(spec.overall.depth, prefs)} × {fmtLen(spec.overall.height, prefs)}</div></div>
            <div><div className="tb-label">Species</div><div className="tb-value">{sp.label}</div></div>
            <div><div className="tb-label">Scale</div><div className="tb-value">NTS</div></div>
            <div><div className="tb-label">Date</div><div className="tb-value">{new Date().toLocaleDateString()}</div></div>
            <div><div className="tb-label">Rev</div><div className="tb-value">{revision}</div></div>
          </div>
        </div>
      </div>
    </div>
  );
}

// Fine-tune sliders: temp value while dragging, committed through the normal pipeline on release,
// producing history entries and integrity-delta diff chips.
function FineTune({ spec, prefs, onCommit, lastDiff }) {
  const [drag, setDrag] = useState(null); // {key, value}
  const dims = [["width", "W"], ["depth", "D"], ["height", "H"]];
  const commit = (key, value) => {
    setDrag(null);
    if (value !== spec.overall[key]) onCommit({ ...spec, overall: { ...spec.overall, [key]: value } }, `Fine-tune ${key} → ${value} mm`);
  };
  return (
    <div className="bb-card p-2.5 space-y-1.5" style={{ background: "var(--panel)" }}>
      {dims.map(([key, letter]) => {
        const val = drag && drag.key === key ? drag.value : spec.overall[key];
        return (
          <div key={key} className="flex items-center gap-2">
            <span className="num text-[10px] w-3" style={{ color: "var(--ink-soft)" }}>{letter}</span>
            <input type="range" min={100} max={3000} step={10} value={val} className="bb-range flex-1" aria-label={`${key} (mm)`}
              onChange={(e) => setDrag({ key, value: Number(e.target.value) })}
              onPointerUp={(e) => commit(key, Number(e.target.value))}
              onKeyUp={(e) => { if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)) commit(key, Number(e.target.value)); }} />
            <span className="num text-[10px] w-24 text-right" style={{ color: "var(--ink)" }}>{fmtLen(val, prefs)}</span>
          </div>
        );
      })}
      <DiffChips chips={lastDiff} />
    </div>
  );
}

/* ============================== app ============================== */

export default function BlueprintBuddy() {
  useFonts();
  const [prefs, updatePrefs] = usePrefs();
  const [sysDark, setSysDark] = useState(false);
  const [sysReduced, setSysReduced] = useState(false);
  useEffect(() => {
    const mq1 = window.matchMedia("(prefers-color-scheme: dark)");
    const mq2 = window.matchMedia("(prefers-reduced-motion: reduce)");
    setSysDark(mq1.matches); setSysReduced(mq2.matches);
    const h1 = (e) => setSysDark(e.matches), h2 = (e) => setSysReduced(e.matches);
    mq1.addEventListener("change", h1); mq2.addEventListener("change", h2);
    return () => { mq1.removeEventListener("change", h1); mq2.removeEventListener("change", h2); };
  }, []);
  const theme = THEMES[prefs.theme === "auto" ? (sysDark ? "dark" : "light") : prefs.theme] || THEMES.light;
  const reduced = prefs.reducedMotion === "on" || sysReduced;

  // Design history: every applied change is a revision; the drawing sheet stamps the current one.
  const [history, setHistory] = useState(() => [{ spec: validateSpec(SEED_SPEC, "advanced").spec, label: "Seed design", ts: Date.now() }]);
  const [histIdx, setHistIdx] = useState(0);
  const spec = history[histIdx].spec;
  const revision = histIdx + 1;
  const [lastDiff, setLastDiff] = useState([]);

  const [loadChoices, setLoadChoices] = useState({});
  const [pendingLevel, setPendingLevel] = useState(null);
  const [explodeVal, setExplodeVal] = useState(0);
  const [selected, setSelected] = useState(null);
  const [tab, setTab] = useState("cut");
  const [mobileTab, setMobileTab] = useState("cut");
  const [drafting, setDrafting] = useState(false);
  const [dimsOverride, setDimsOverride] = useState(null);
  const showDims = dimsOverride != null ? dimsOverride : prefs.annotations;
  const [fineOpen, setFineOpen] = useState(false);
  const [prefsOpen, setPrefsOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [printOpen, setPrintOpen] = useState(false);
  const [printImg, setPrintImg] = useState(null);
  const [activeStep, setActiveStep] = useState(null);
  const [playing, setPlaying] = useState(false);
  const [messages, setMessages] = useState([{ who: "ai", text: "Welcome to the drafting studio. I've seeded a walnut nightstand — the Integrity tab shows its structural report, live. Describe any piece (“a 6-foot oak dining table”), refine this one (“make it 100mm shorter”), or go somewhere new: “an asymmetric five-legged hall table with a cantilevered shelf.” Novel pieces run a structural refinement loop — that's the price of novelty." }]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const apiHistory = useRef([]);
  const viewerApi = useRef(null);

  const { parts, notes } = useMemo(() => runParametric(spec), [spec]);
  const integrity = useMemo(() => computeIntegrity(spec, parts, loadChoices, prefs.level, prefs.defaultLoad),
    [spec, parts, loadChoices, prefs.level, prefs.defaultLoad]);
  const cutRows = useMemo(() => makeCutList(parts, spec.material.species), [parts, spec]);
  const bom = useMemo(() => makeBOM(spec, parts, integrity), [spec, parts, integrity]);
  const asm = useMemo(() => makeAssembly(spec, parts, notes, prefs.level, integrity), [spec, parts, notes, prefs.level, integrity]);
  useEffect(() => { setSelected(null); setActiveStep(null); setPlaying(false); }, [parts]);

  const onSelect = useCallback((p) => setSelected(p), []);
  const pushMsg = (m) => setMessages((prev) => [...prev, m]);

  // Every change flows through here: validate happened upstream; record a revision + integrity deltas.
  function applyValidated(nextSpec, label) {
    const nextInteg = computeIntegrity(nextSpec, runParametric(nextSpec).parts, loadChoices, prefs.level, prefs.defaultLoad);
    const chips = integrityDiff(integrity, nextInteg);
    setHistory((h) => [...h.slice(0, histIdx + 1), { spec: nextSpec, label, ts: Date.now() }]);
    setHistIdx(histIdx + 1);
    setLastDiff(chips);
    return chips;
  }
  function applyPatch(patch, label) {
    const v = validateSpec(patch(spec), prefs.level);
    if (v.spec) applyValidated(v.spec, label);
  }
  const onFix = (fix) => applyPatch(fix.patch, fix.label);

  /* ---- chat: known types single-shot; novel pieces run propose-validate-revise (max 3 rounds) ---- */
  const setStatus = (t) => setMessages((m) => {
    const last = m[m.length - 1];
    return last && last.who === "status" ? [...m.slice(0, -1), { who: "status", text: t }] : [...m, { who: "status", text: t }];
  });
  const clearStatus = () => setMessages((m) => m.filter((x) => x.who !== "status"));

  async function send() {
    const text = input.trim();
    if (!text || busy) return;
    setInput("");
    pushMsg({ who: "user", text });
    setBusy(true);
    const sys = buildSystemPrompt(prefs.level, spec);
    let hist = [...apiHistory.current, { role: "user", content: text }].slice(-12);
    try {
      // Attempt 1: parse -> merge onto current spec -> validate; one retry with specific errors.
      let reply = await callClaude(sys, hist);
      let parsed = extractJSON(reply);
      let merged = parsed ? mergeSpec(spec, parsed) : null;
      let v = merged ? validateSpec(merged, prefs.level) : { spec: null, errors: ["Response was not parseable JSON."] };
      if (!v.spec) {
        const hist2 = [...hist, { role: "assistant", content: reply || "(empty)" },
          { role: "user", content: `Your last response had these problems: ${v.errors.join(" ")} Return the corrected FULL DesignSpec as minified JSON only — nothing else.` }];
        reply = await callClaude(sys, hist2);
        parsed = extractJSON(reply);
        merged = parsed ? mergeSpec(spec, parsed) : null;
        v = merged ? validateSpec(merged, prefs.level) : { spec: null, errors: ["Second response was not parseable JSON."] };
        if (v.spec) hist = hist2;
      }
      if (!v.spec) {
        // apiHistory was never committed for this turn; the last valid design stays rendered.
        pushMsg({ who: "error", text: `I couldn't get a valid design from the model after a retry: ${v.errors.slice(0, 3).join(" ")} Your last valid design is still shown — try rephrasing.` });
        setBusy(false);
        return;
      }

      let final = v.spec;
      let failReport = null;
      if (final.furnitureType === "other") {
        // The critique loop: code validates, the model revises. Novelty pays this toll; known types don't.
        setStatus("Novel piece — validating structure, round 1 of 3");
        let curHist = hist;
        let best = null;
        let round = 1;
        while (true) {
          const built = runParametric(final);
          const integ = computeIntegrity(final, built.parts, loadChoices, prefs.level, prefs.defaultLoad);
          const fails = integ.checks.filter((c) => c.status === "fail");
          if (!best || fails.length < best.fails.length) best = { spec: final, fails, hist: curHist };
          if (!fails.length || round >= 3) break;
          round++;
          setStatus(`Refining structure, round ${round} of 3`);
          const hist3 = [...curHist, { role: "assistant", content: JSON.stringify(final) },
            { role: "user", content: buildCritique(fails) }].slice(-12);
          let v2 = { spec: null };
          try {
            const r2 = await callClaude(sys, hist3);
            const p2 = extractJSON(r2);
            const m2 = p2 ? mergeSpec(final, p2) : null;
            v2 = m2 ? validateSpec(m2, prefs.level) : { spec: null };
          } catch { /* keep best attempt */ }
          if (!v2.spec) break;
          final = v2.spec;
          curHist = hist3;
        }
        clearStatus();
        // Present the best attempt — honestly, with its failing report if it never converged.
        final = best.spec;
        hist = best.hist;
        if (best.fails.length) failReport = best.fails;
      }

      const chips = applyValidated(final, text.slice(0, 60));
      apiHistory.current = [...hist, { role: "assistant", content: JSON.stringify(final) }].slice(-12);
      if (failReport && failReport.length) {
        pushMsg({ who: "ai", chips, text: `Honest report: after 3 structural refinement rounds, “${final.name}” is my best attempt but still fails ${failReport.length} check${failReport.length > 1 ? "s" : ""}: ${failReport.slice(0, 3).map((c) => c.title).join("; ")}${failReport.length > 3 ? "…" : ""}. The Integrity tab has every number — refine manually, tap a fix, or ask me to change the approach.` });
      } else {
        pushMsg({ who: "ai", chips, text: `Updated “${final.name}” — ${final.overall.width}×${final.overall.depth}×${final.overall.height} mm ${final.material.species}. ${final.designNotes || ""}`.trim() });
      }
    } catch (err) {
      clearStatus();
      pushMsg({ who: "error", text: `The design service is unreachable (${err.message}). Everything else still works — try again in a moment.` });
    }
    setBusy(false);
  }

  function requestLevel(next) {
    if (next === prefs.level) return;
    if (specUsesDisallowed(spec, next)) setPendingLevel(next);
    else { updatePrefs({ level: next }); setPendingLevel(null); }
  }
  function applyPendingLevel(regen) {
    if (regen) {
      const v = validateSpec(regenerateJoinery(spec, pendingLevel), pendingLevel);
      if (v.spec) applyValidated(v.spec, `Joinery regenerated for ${pendingLevel}`);
    }
    updatePrefs({ level: pendingLevel });
    setPendingLevel(null);
  }

  /* ---- step-synced playback: the 3D view follows the active assembly step ---- */
  const stepCount = asm.steps.length;
  function gotoStep(i) {
    if (i == null || i < 0 || i >= stepCount) { setActiveStep(null); setPlaying(false); return; }
    setActiveStep(i);
    setExplodeVal(stepCount > 1 ? clamp(1 - i / (stepCount - 1), 0, 1) : 0);
  }
  useEffect(() => {
    if (!playing || reduced) return;
    const t = setTimeout(() => {
      if (activeStep == null || activeStep >= stepCount - 1) { setPlaying(false); return; }
      gotoStep(activeStep + 1);
    }, 2600);
    return () => clearTimeout(t);
  }, [playing, activeStep, stepCount, reduced]);
  const highlightIds = activeStep != null && asm.steps[activeStep] ? asm.steps[activeStep].ids : null;

  const openPrint = () => {
    setPrintImg(viewerApi.current && viewerApi.current.capture ? viewerApi.current.capture() : null);
    setPrintOpen(true);
  };

  const overallStatus = integrity.summary.fails ? "fail" : integrity.summary.advisories ? "advisory" : "pass";

  const renderChat = () => (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex-1 min-h-0 overflow-y-auto p-3 space-y-2.5" ref={(el) => { if (el) el.scrollTop = el.scrollHeight; }}>
        {messages.map((m, i) => (
          <div key={i} className="text-sm leading-relaxed px-3 py-2"
            style={m.who === "user" ? { background: "var(--accent)", color: "var(--accent-ink)", marginLeft: 32, borderRadius: 2 }
              : m.who === "error" ? { background: "var(--fail-bg)", color: "var(--fail)", border: "1px solid var(--fail)", marginRight: 32, borderRadius: 2 }
              : m.who === "status" ? { color: "var(--accent)", border: "1px dashed var(--accent)", marginRight: 32, borderRadius: 2, fontSize: 12 }
              : { background: "var(--card)", color: "var(--ink)", border: "1px solid var(--rule)", marginRight: 32, borderRadius: 2 }}>
            {m.who === "status" && <span className={reduced ? "" : "animate-pulse"}>⟳ </span>}{m.text}
            {m.chips && <DiffChips chips={m.chips} />}
          </div>
        ))}
        {busy && !messages.some((m) => m.who === "status") && (
          <div className={`px-3 py-2 text-sm ${reduced ? "" : "animate-pulse"}`} style={{ color: "var(--ink-soft)", border: "1px dashed var(--rule)", marginRight: 32, borderRadius: 2 }}>Drafting your design…</div>
        )}
      </div>
      <div className="p-3 border-t bb-hairline flex gap-2">
        <input value={input} onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") send(); }} disabled={busy}
          placeholder="Describe or refine a piece…" aria-label="Design request"
          className="bb-input flex-1 min-w-0 text-sm" />
        <button onClick={send} disabled={busy || !input.trim()} className="bb-btn bb-btn-primary text-sm">Send</button>
      </div>
    </div>
  );

  const exportButtons = (
    <div className="flex flex-wrap gap-1.5">
      <button onClick={() => cutListCSV(cutRows, prefs, spec.name)} className="bb-btn text-[10px]">CSV</button>
      <button onClick={() => downloadFile(`${spec.name.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}-sketchup.rb`, rubyExport(spec, parts, prefs, revision), "text/plain;charset=utf-8")} className="bb-btn text-[10px]">SketchUp .rb</button>
      <button onClick={() => downloadFile(`${spec.name.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.dae`, colladaExport(spec, parts, prefs, revision), "model/vnd.collada+xml")} className="bb-btn text-[10px]">COLLADA .dae</button>
    </div>
  );

  const renderPlans = (t) => t === "cut" ? (
    <div className="p-3">
      <div className="flex items-center justify-between gap-2 mb-2 flex-wrap">
        <div className="text-xs" style={{ color: "var(--ink-soft)" }}>{cutRows.reduce((s, r) => s + r.qty, 0)} pieces · cut lengths include joinery allowances</div>
        {exportButtons}
      </div>
      <div className="overflow-x-auto">
        <table className="bb-table">
          <thead><tr>
            <th>Part</th><th>Qty</th><th>T × W × L ({UNIT_LABEL[prefs.unitSystem]})</th><th>Material</th><th>Grain</th>
            {cutRows.some((r) => r.angles) && <th>Angles</th>}
          </tr></thead>
          <tbody>{cutRows.map((r, i) => (
            <tr key={i}>
              <td className="font-medium">{r.name}{r.cylinder ? " (cylinder, Ø = width)" : ""}</td>
              <td className="num">{r.qty}</td>
              <td className="num whitespace-nowrap">{fmtLenBare(r.cut.thickness, prefs)} × {fmtLenBare(r.cut.width, prefs)} × {fmtLenBare(r.cut.length, prefs)}</td>
              <td>{r.material}</td><td>{r.grain}</td>
              {cutRows.some((x) => x.angles) && <td className="num whitespace-nowrap">{angleText(r.angles) || "—"}</td>}
            </tr>))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs" style={{ color: "var(--ink-soft)" }}>Allow <span className="num">{fmtLen(KERF_MM, prefs)}</span> of saw kerf between adjacent cuts when laying out stock.</p>
    </div>
  ) : t === "bom" ? (
    <div className="p-3 space-y-4">
      {bom.sections.map((s) => (
        <div key={s.title}>
          <div className="bb-sect mb-1">{s.title}</div>
          {s.rows.map((r, i) => (
            <div key={i} className="flex items-baseline justify-between gap-2 py-1 border-b text-xs" style={{ borderColor: "var(--rule-faint)", color: "var(--ink)" }}>
              <span className="min-w-0">{r.label} <span style={{ color: "var(--ink-faint)" }}>× {r.qty}</span></span>
              <span className="num whitespace-nowrap font-medium">{money(r.cost)}</span>
            </div>))}
          <div className="flex justify-between pt-1 text-xs font-semibold" style={{ color: "var(--ink-soft)" }}><span>Subtotal</span><span className="num">{money(s.subtotal)}</span></div>
        </div>))}
      <div className="flex justify-between items-baseline border-t-2 pt-2 text-sm font-bold" style={{ borderColor: "var(--ink)", color: "var(--ink)" }}><span>Total</span><span className="num">{money(bom.total)}</span></div>
      <p className="text-xs bb-card p-2" style={{ color: "var(--adv)" }}>Estimate. Prices are placeholders; verify locally.</p>
    </div>
  ) : t === "assembly" ? (
    <div className="p-3 space-y-4">
      <div>
        <div className="bb-sect mb-1.5">Tools you'll need</div>
        <div className="flex flex-wrap gap-1.5">{asm.tools.map((tl) => <span key={tl} className="bb-chip">{tl}</span>)}</div>
      </div>
      {(spec.designNotes || notes.length > 0) && (
        <div className="text-xs bb-card p-2 space-y-1" style={{ color: "var(--ink-soft)" }}>
          {spec.designNotes && <p className="italic">{spec.designNotes}</p>}
          {notes.map((n, i) => <p key={i}>• {n}</p>)}
        </div>)}
      <div className="flex items-center gap-1.5 flex-wrap">
        <span className="bb-sect border-none" style={{ borderBottom: "none", paddingBottom: 0 }}>Step-synced playback</span>
        {!reduced && (
          <button className="bb-btn text-[10px]" onClick={() => { if (playing) setPlaying(false); else { gotoStep(activeStep == null ? 0 : activeStep); setPlaying(true); } }}>
            {playing ? "Pause" : "Play"}
          </button>
        )}
        <button className="bb-btn bb-btn-ghost text-[10px]" disabled={activeStep == null || activeStep <= 0} onClick={() => gotoStep((activeStep || 0) - 1)}>‹ Prev</button>
        <button className="bb-btn bb-btn-ghost text-[10px]" disabled={activeStep != null && activeStep >= stepCount - 1} onClick={() => gotoStep(activeStep == null ? 0 : activeStep + 1)}>Next ›</button>
        {activeStep != null && <button className="bb-btn bb-btn-ghost text-[10px]" onClick={() => gotoStep(null)}>Clear</button>}
      </div>
      <ol className="space-y-3">
        {asm.steps.map((s, i) => (
          <li key={i} className="bb-card p-2.5 cursor-pointer" onClick={() => gotoStep(activeStep === i ? null : i)}
            style={activeStep === i ? { borderColor: "var(--accent)", background: "var(--accent-soft)" } : {}}>
            <div className="text-sm font-semibold" style={{ color: "var(--ink)" }}><span className="num" style={{ color: "var(--accent)" }}>{String(i + 1).padStart(2, "0")}</span> {s.title}</div>
            <p className="text-xs mt-1" style={{ color: "var(--ink-soft)" }}>{s.body}</p>
            <p className="text-xs mt-1.5" style={{ color: "var(--ink-faint)" }}>
              Parts: {(s.parts || []).join(", ")}{s.joint ? ` · Joint: ${JOINT_LABEL[s.joint]}` : ""} · Fasteners: {s.fasteners}
            </p>
            <p className="text-xs mt-1" style={{ color: "var(--adv)" }}>Tip: {s.tip}</p>
            {prefs.level === "beginner" && s.why && <p className="text-xs mt-1" style={{ color: "var(--ink-soft)" }}>Why: {s.why}</p>}
            {prefs.level === "beginner" && s.check && <p className="text-xs mt-1" style={{ color: "var(--pass)" }}>✓ {s.check}</p>}
          </li>))}
      </ol>
    </div>
  ) : t === "integrity" ? (
    <IntegrityPanel integrity={integrity} prefs={prefs} loadChoices={loadChoices} setLoadChoices={setLoadChoices} onFix={onFix} lastDiff={lastDiff} />
  ) : (
    <ReferencePanel />
  );

  // The Integrity disclaimer footer is permanent: rendered outside the scroll area.
  const plansWithFooter = (t) => (
    <>
      <div className="flex-1 min-h-0 overflow-y-auto">{renderPlans(t)}</div>
      {t === "integrity" && (
        <div className="px-3 py-2 border-t bb-hairline text-[10px]" style={{ color: "var(--ink-faint)", background: "var(--panel)" }}>{DISCLAIMER}</div>
      )}
    </>
  );

  const TABS = [["cut", "Cut List"], ["bom", "BOM"], ["assembly", "Assembly"], ["integrity", "Integrity"], ["reference", "Reference"]];

  return (
    <div className={`bb-root bb-fade ${reduced ? "bb-reduced" : ""} h-screen flex flex-col relative`} style={cssVars(theme)}>
      <style>{BB_CSS}</style>
      <header className="px-4 py-2 flex flex-wrap items-center gap-x-3 gap-y-2 border-b relative z-30" style={{ background: "var(--panel)", borderColor: "var(--ink)" }}>
        <div className="flex items-baseline gap-2 mr-auto">
          <span className="text-base font-bold tracking-tight" style={{ color: "var(--ink)" }}>
            <span style={{ color: "var(--accent)" }}>BLUEPRINT</span> BUDDY
          </span>
          <span className="hidden md:inline text-[10px] uppercase tracking-widest" style={{ color: "var(--ink-faint)" }}>drafting studio</span>
          <span className="bb-chip bb-chip-num hidden sm:inline-flex">rev {revision}</span>
        </div>
        <span className="bb-stamp" style={{ color: STATUS_COLOR[overallStatus] }}>{overallStatus}</span>
        <button className="bb-btn" onClick={() => setHistoryOpen(true)}>History</button>
        <button className="bb-btn" onClick={openPrint}>Drawing sheet</button>
        <button className="bb-btn" onClick={() => setPrefsOpen((o) => !o)} aria-expanded={prefsOpen}>Preferences</button>
        <div className="flex items-center gap-2">
          <button onClick={() => setExplodeVal((v) => (v < 0.5 ? 1 : 0))} className="bb-btn bb-btn-primary">
            {explodeVal < 0.5 ? "Explode" : "Assemble"}
          </button>
          <input type="range" min="0" max="1" step="0.01" value={explodeVal}
            onChange={(e) => setExplodeVal(parseFloat(e.target.value))}
            className="w-24 bb-range" aria-label="Explosion amount" />
        </div>
      </header>
      {prefsOpen && <PrefsPopover prefs={prefs} update={updatePrefs} requestLevel={requestLevel} onClose={() => setPrefsOpen(false)} />}

      {pendingLevel && (
        <div className="px-4 py-2 flex flex-wrap items-center gap-2 text-xs border-b" style={{ background: "var(--accent-soft)", borderColor: "var(--rule)", color: "var(--ink)" }}>
          <span className="font-medium">This design uses joinery beyond the {pendingLevel} toolkit. Regenerate the joints to fit?</span>
          <button onClick={() => applyPendingLevel(true)} className="bb-btn bb-btn-primary">Regenerate joinery</button>
          <button onClick={() => applyPendingLevel(false)} className="bb-btn">Keep design as-is</button>
          <button onClick={() => setPendingLevel(null)} className="bb-btn bb-btn-ghost">Cancel</button>
        </div>
      )}

      <div className="flex-1 min-h-0 flex flex-col lg:flex-row">
        <aside className="hidden lg:flex flex-col w-80 border-r bb-hairline" style={{ background: "var(--panel)" }}>{renderChat()}</aside>

        <main className="relative h-72 sm:h-80 lg:h-auto lg:flex-1 min-w-0 shrink-0 lg:shrink"
          style={{ background: `radial-gradient(ellipse at 50% 35%, ${theme.scene} 0%, ${theme.paper} 100%)` }}>
          <Viewer parts={parts} explodeTarget={explodeVal} onSelect={onSelect} drafting={drafting} showDims={showDims}
            prefs={prefs} theme={theme} highlightIds={highlightIds} reduced={reduced} apiRef={viewerApi} />
          <div className="absolute top-3 left-3 bb-card px-3 py-2 pointer-events-none max-w-xs" style={{ background: "var(--panel)", opacity: 0.95 }}>
            <div className="text-sm font-bold" style={{ color: "var(--ink)" }}>{spec.name}</div>
            <div className="num text-[11px]" style={{ color: "var(--ink-soft)" }}>{fmtLen(spec.overall.width, prefs)} W × {fmtLen(spec.overall.depth, prefs)} D × {fmtLen(spec.overall.height, prefs)} H</div>
            <div className="text-[10px] mt-0.5" style={{ color: "var(--ink-faint)" }}>{spec.furnitureType} · {speciesOf(spec.material.species).label}</div>
            <div className="text-[10px]" style={{ color: "var(--ink-faint)" }}>{[...new Set([...spec.joinery.map((j) => JOINT_LABEL[j.joint]), ...(spec.connections || []).map((c) => JOINT_LABEL[c.joint])])].join(" · ")}</div>
          </div>
          <div className="absolute top-3 right-3 flex flex-col gap-1.5 items-end">
            <button className="bb-btn text-[10px]" style={drafting ? { background: "var(--accent)", color: "var(--accent-ink)", borderColor: "var(--accent)" } : { background: "var(--panel)" }}
              onClick={() => setDrafting((d) => !d)} aria-pressed={drafting}>Drafting view</button>
            <button className="bb-btn text-[10px]" style={showDims ? { background: "var(--accent)", color: "var(--accent-ink)", borderColor: "var(--accent)" } : { background: "var(--panel)" }}
              onClick={() => setDimsOverride(!showDims)} aria-pressed={showDims}>Dimensions</button>
            <button className="bb-btn text-[10px]" style={fineOpen ? { background: "var(--accent)", color: "var(--accent-ink)", borderColor: "var(--accent)" } : { background: "var(--panel)" }}
              onClick={() => setFineOpen((o) => !o)} aria-pressed={fineOpen}>Fine-tune</button>
          </div>
          {fineOpen && (
            <div className="absolute bottom-10 left-1/2 -translate-x-1/2 w-72 max-w-full z-20">
              <FineTune spec={spec} prefs={prefs} lastDiff={lastDiff} onCommit={(raw, label) => { const v = validateSpec(raw, prefs.level); if (v.spec) applyValidated(v.spec, label); }} />
            </div>
          )}
          {selected && (
            <div className="absolute bottom-3 left-3 bb-card px-3 py-2 pointer-events-none" style={{ background: "var(--ink)", color: "var(--paper)", borderColor: "var(--ink)" }}>
              <div className="text-sm font-semibold">{selected.name}</div>
              <div className="num text-[11px]" style={{ opacity: 0.85 }}>cut: {fmtDims(selected.cut, prefs)}</div>
              {cutAngles(selected.rot) && <div className="num text-[10px]" style={{ opacity: 0.8 }}>{angleText(cutAngles(selected.rot))}</div>}
              <div className="text-[10px]" style={{ opacity: 0.7 }}>{selected.stock} · grain along {selected.grain}{selected.surface && selected.surface !== "none" ? ` · ${selected.surface}` : ""}</div>
            </div>)}
          <div className="absolute bottom-3 right-3 text-[10px] pointer-events-none" style={{ color: "var(--ink-faint)" }}>drag to orbit · wheel/pinch to zoom · click a part</div>
        </main>

        <aside className="hidden lg:flex flex-col w-96 border-l bb-hairline" style={{ background: "var(--panel)" }}>
          <div className="flex border-b bb-hairline px-1 overflow-x-auto">
            {TABS.map(([k, label]) => (
              <button key={k} onClick={() => setTab(k)} className={`bb-tab ${tab === k ? "on" : ""}`}>
                {label}{k === "integrity" && overallStatus !== "pass" ? <span style={{ color: STATUS_COLOR[overallStatus] }}> ●</span> : ""}
              </button>
            ))}
          </div>
          {plansWithFooter(tab)}
        </aside>

        <div className="lg:hidden flex flex-col flex-1 min-h-0 border-t bb-hairline" style={{ background: "var(--panel)" }}>
          <div className="flex border-b bb-hairline px-1 overflow-x-auto">
            <button onClick={() => setMobileTab("chat")} className={`bb-tab ${mobileTab === "chat" ? "on" : ""}`}>Chat</button>
            {TABS.map(([k, label]) => (
              <button key={k} onClick={() => setMobileTab(k)} className={`bb-tab ${mobileTab === k ? "on" : ""}`}>
                {label}{k === "integrity" && overallStatus !== "pass" ? <span style={{ color: STATUS_COLOR[overallStatus] }}> ●</span> : ""}
              </button>
            ))}
          </div>
          {mobileTab === "chat" ? <div className="flex-1 min-h-0">{renderChat()}</div> : plansWithFooter(mobileTab)}
        </div>
      </div>

      {historyOpen && <HistoryDrawer history={history} current={histIdx} prefs={prefs}
        onRestore={(i) => { setHistIdx(i); setLastDiff([]); setHistoryOpen(false); }} onClose={() => setHistoryOpen(false)} />}
      {printOpen && <PrintSheet spec={spec} cutRows={cutRows} bom={bom} integrity={integrity} prefs={prefs} revision={revision} img={printImg} onClose={() => setPrintOpen(false)} />}
    </div>
  );
}

// Pure-function surface for tests; the artifact runtime only consumes the default export.
export const __engine = {
  SPECIES, LOAD_PRESETS, JOINT_RATING, DEFAULT_PREFS,
  inchesFrac, fmtLen, fmtLenBare, snapScrew,
  rotMat, obbCorners, obbPenetration, convexHull2D, polyInsideDistance, cutAngles, partOBB,
  mergeSpec, validateSpec, regenerateJoinery, runParametric,
  I_rect, DEFL, MOM, loadCasesFor, totalLoadN, evalBeam,
  computeIntegrity, integrityDiff, surfacesOf,
  makeCutList, makeBOM, makeAssembly, angleText, buildCutListCSV,
  rubyExport, colladaExport, buildSystemPrompt, buildCritique, extractJSON,
  UI: { IntegrityPanel, ReferencePanel, PrefsPopover, HistoryDrawer, PrintSheet, FineTune, Viewer },
};
