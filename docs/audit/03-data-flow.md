# Blueprint Buddy — Data flow, transforms, rounding & conversion points (Phase 1)

```
user text ──(1)── BB.Units.normalizeLengthText ──► explicit-mm text
photo ──(2)── AI.downscaleImage (1024px JPEG 0.8) ─┐
                                                   ▼
        AI.respond → transport chain → wire JSON (3) extractJSON / continuation stitch
                                                   ▼
        classify → {new spec | partial patch | question}   (Codec.decode / decodePartial)
                                                   ▼
        AI.apply: deepMerge onto current spec ──(4)── Spec.correctSpec
                                                   ▼
   ┌─────────── corrected spec (mm, specVersion 4) ────────────┐
   │  (5) Parametric.build → model {parts, joints, openings,   │
   │      drawers, bounds}  — positions/sizes rounded 0.1 mm   │
   │  (6) Spec.validate = ergonomics/movement/drawer rules +   │
   │      auditModel (floor/envelope/overlap/contact/footprint)│
   │      errors ⇒ commit() REFUSES; ui keeps last valid design│
   └───────────────────────────────────────────────────────────┘
                     ▼ (on accept: ui.adopt)
   Structural.computeIntegrity (spec, model, loadChoices/climate)
   Plans.cutList (7) → Packing.planStock (8) → Plans.bom (9)
   Plans.assembly (10) → checklistKeys → build-mode progress
   Engine.setModel (3D) · History.push · autosave (Codec.encode wire)
                     ▼ (render)
   BB.Units formatters (11) — the ONLY mm→text conversion point
   Exports: toDAE/toRuby (12, mm exempt) · printHTML (11) · share code (13)
```

## Transform / rounding / conversion points

1. **Chat pre-normalization** (`units.js:230-268`): every dimension idiom
   (`2' 5"`, `29 1/2`, `36 wide` in imperial, `75cm`) rewritten to explicit
   `NNNmm`, rounded 0.1 mm. The model never converts units.
2. **Photo downscale** (`ai.js:439-466`): long edge 1024 px, JPEG q0.8. Lossy
   by design; only intent survives.
3. **Wire decode** (`codec.js:112-200`): enums bounds-checked (`at()`), numbers
   passed through; **no rounding**. Malformed entries dropped.
4. **Correction** (`spec.js:330-403`): clamps (see constants table), snap to
   stock thickness tables, joint level-gating, drawer/shelf auto-reduction
   (probe: `parametric.openingHeightFor` / `shelfSpacingFor`), custom grammar:
   dims rounded 0.1 (`r1`), rotation snap ≤ 2.5°, grounding/centering shifts
   rounded 0.1 mm. Deterministic + idempotent (unit-tested).
5. **Parametric build** (`parametric.js:448-462`): all part sizes/positions
   rounded 0.1 mm after template math (floats like bank/openH floored to
   0.1 mm at `bankHeights`).
6. **Validation**: pure report; no mutation.
7. **Cut list** (`plans.js:20-66`): template parts derive L≥W≥T by sorting the
   size triple; custom parts use explicit `cutDim` (rotation never changes the
   stick you cut). Joinery allowance added per inserted end, rounded 0.1 mm.
   Identical rows merged by (name, L, W, T, material, angles).
8. **Stock optimizer** (`packing.js`): section match tolerance 0.5 mm;
   glue-up strips lose 3 mm per glued edge; kerf 3 mm between cuts, 15 mm end
   trim; 2D placements carry kerf-inflated envelopes then store net sizes;
   offcut rounded 0.1. Board-foot: mm³ ÷ 2,359,737, ×1.3 waste, ceil to 0.1.
9. **BOM** (`plans.js:76-172`): prices rounded to cents; fastener quantities
   from joint counts.
10. **Assembly** (`plans.js:222-288`): text carries lengths through
    `BB.Units` formatters at render time.
11. **Display boundary** (`units.js`): fractional inches = round(mm/25.4 ×
    denom)/denom reduced; fine values decimal inches (2 dp); metric 0.1 mm.
    Rounding NEVER feeds back into stored geometry.
12. **SketchUp exports** (`exports.js`): deliberate unit exemption — raw mm,
    3-decimal rounding; Y-up→Z-up conversion X'=x, Y'=−z, Z'=y.
13. **Share codes** (`codec.js:207-231`): wire JSON → base64url. Import:
    decode → migrate → correct → validate (same gate as chat).

## Trust boundaries

- AI output NEVER writes numbers into state directly: everything passes
  (3)→(4)→(5)→(6); commit refuses on errors and the last valid design stays.
- Wire `"d":0` removes drawers explicitly (null-preserving deepMerge).
- Correction runs on load, import, migration, chat, photo, sliders — one gate.

## Digest drift check (Phase 1 item 4)

Compared the AI-facing digests against the code tables they summarize:

| Digest | Source table | Status at audit |
|---|---|---|
| `knowledgeDigest()` WOOD/ERGONOMICS/JOINERY/SLIDES lines | K.WOOD_SPECIES / K.ERGONOMICS / K.JOINERY / K.SLIDE_LENGTHS | computed from tables — cannot drift ✓ |
| `knowledgeDigest()` LEVEL MATRIX line | hand-written string `knowledge.js:318` | matches `jointsForLevel` today; **hand-copied → can drift silently** |
| `ai.js:48` LEVEL MATRIX line | second hand-written copy | matches today; **duplicate hand copy** |
| `ai.js:432` VISION_PROMPT ergonomic ranges | hand-written numbers | match K.ERGONOMICS today; **hand-copied → can drift** |

Finding F-SYS-4: no assertion existed tying these strings to their tables.
Remediation derives the level-matrix and vision ranges from the tables and adds
a startup/self-test digest-integrity assertion so drift can never recur silently.
