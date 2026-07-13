# Blueprint Buddy

An AI-guided parametric furniture design studio, shipped as a single self-contained
HTML file. Phase 2 build: SketchUp export, diff-based design fine-tuning with full
revision history, embedded woodworking knowledge bases, a drawer system, and a
reference-quality interface.

## Architecture rule (binding)

**The AI proposes intent. The parametric layer owns geometry. Derived plans are pure
functions of the corrected spec.**

Every design change — whether typed in chat, tapped in the part inspector, or restored
from history — flows through the same pipeline:

```
proposed spec ─→ correctSpec() ─→ Parametric.build() ─→ validate() ─→ plans + 3D
                 (clamps, stock       (parts, joints,     (errors block,
                  snapping, joint      openings, drawer    advisories inform)
                  level gating)        boxes)
```

The model returns *partial-spec diffs* (`{"overall":{"height":700},"explain":"..."}`),
clarifying questions (`{"question":"...","options":[...]}`), or full new specs. Code
deep-merges, re-corrects, and computes the **actual** diff for the chat chip — the
model's explanation is displayed but never trusted as the record of change.

## Layout

| Path | Role |
| --- | --- |
| `src/knowledge.js` | Code-owned knowledge bases: wood species, ergonomics, joinery matrix, fasteners & finishes. Feeds the AI system prompt, validation, and the Shop Reference panel. |
| `src/spec.js` | DesignSpec schema, defaults, correction, validation (errors vs advisories), diff utilities. |
| `src/parametric.js` | Templates (table, desk, bench, bookshelf, nightstand, cabinet), drawer-bank rails and exact drawer-box math. |
| `src/plans.js` | Cut list with joinery allowances, BOM, assembly steps incl. drawer sub-sequences. |
| `src/exports.js` | COLLADA (.dae, mm, Z-up) and SketchUp Ruby (.rb, deduped ComponentDefinitions, `.mm`, one undo op), print sheet. |
| `src/ai.js` | Diff protocol, system prompt with knowledge digests, `window.claude.complete` bridge + offline intent parser fallback. |
| `src/history.js` | Immutable snapshot stack shared by AI and manual edits; undo/redo/restore/compare. |
| `src/engine.js` | Three.js scene: shared unit geometry (rebuilds allocate nothing), damped-lerp motion, staged drawer explosion, picking, dimension annotations, step-synced playback. |
| `src/ui.js` | App shell: chat, tabs, inspector, history drawer, gallery, Shop Reference, print, a11y, mobile. |
| `build.js` | Inlines everything (incl. Three.js and fonts) into `dist/index.html`. |

## Build & test

```
node build.js                     # → dist/index.html (single file, ~880 KB)
node test/unit.test.js            # 183 headless checks on the code-owned layers
node test/smoke.playwright.js     # 36 browser checks driving the real app
```

## Drawer math (code-owned, from §5 of the Phase 2 spec)

- Side-mount slides: box width = opening − 25 mm, box height = opening − 15 mm,
  box depth = largest standard slide length (250–500) ≤ interior − 25 mm.
- Wood runners (Intermediate+): box = opening − 4 / − 10, depth = interior − 20.
- 6 mm bottom in a 6 mm groove 10 mm up; back cut down when the box joint allows
  a slide-in bottom.
- Inset fronts = opening − 2 mm reveal per side; overlay = opening + 10 mm per side
  where the surround allows. Fronts 19 mm in the main species.
- Beginner boxes are gated to butt/pocket screws; locking rabbet at Intermediate,
  half-blind dovetail at Advanced — enforced by `correctSpec`, not by prompt.
