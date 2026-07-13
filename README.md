# Blueprint Buddy

AI-driven furniture design and build-plan generator, built as a single-file React artifact (`blueprint-buddy.jsx`).

Describe a piece of furniture in plain language and get a professional-grade woodworking plan: an interactive 3D preview with exploded views and drafting-style dimension annotations, a structural integrity report grounded in real materials science, a cut list with joinery allowances and computed miter angles, a bill of materials, step-by-step assembly with 3D-synced playback, and a printable drawing sheet with a proper title block.

## Architecture

The AI never does arithmetic. Four layers:

1. **AI layer (intent only)** — the chat calls the Anthropic API; the model returns a JSON `DesignSpec` describing intent. For known furniture types it names type, dimensions, species, and joinery. For novel pieces it composes parametric primitives (`post`, `rail`, `panel`, `slab`, `cylinder`) with positions, rotations, and an explicit connection graph. It proposes; it never calculates.
2. **Parametric layer (geometry authority)** — code-owned layout templates derive every part, dimension, and 3D position from the spec. Novel compositions are auto-grounded and validated: one connected component, a support polygon that contains the center of gravity, a load path from every load-bearing surface to the floor, and oriented-bounding-box collision tests that distinguish intended joints from accidents.
3. **Structural engine (physics judge)** — Wood Handbook material properties drive exact beam math. MOE predicts sag (`5wL⁴/384EI` and friends), MOR bounds strength at a ×4 safety factor, specific gravity scales fastener and joint capacity, and Janka hardness drives surface-durability advisories only. Whole-piece checks cover tipping (COG, empty and loaded), a transparent racking score, leg slenderness, and joint adequacy. Novel designs that fail run an automatic propose–validate–revise loop (max 3 rounds) with structured critiques; if a design still fails, the best attempt is presented with an honest failing report.
4. **Derived layer (plans)** — cut list, BOM, assembly steps, CSV, SketchUp Ruby and COLLADA exports, and the print drawing sheet are pure functions of the corrected spec. Every number the user sees comes from code.

## Features

- **Integrity panel** — per-check pass/advisory/fail with the computed number, the threshold, a plain-English explanation, and tappable fixes that patch the spec through the normal pipeline (watch the check flip). User-selectable load presets per surface (display/books/heavy storage shelves, 120 kg seating, 75 kg + 90 kg-lean worktops). Mandatory anti-tip wall anchors appear in the BOM and instructions for tall or top-heavy cases. Permanent disclaimer: hobby estimates, not certified engineering.
- **Persistent preferences** — one object in the artifact key-value store: unit system (fractional/decimal inches, cm, mm), 1/16″ or 1/32″ precision, dual-unit display everywhere (`750 mm (29 1/2")`, including CSV and both SketchUp exports), experience level, default load preset, annotation default, theme, reduced motion. Loads once with silent fallback to defaults; saves debounced.
- **Novel furniture grammar** — primitives + connection graph + per-part `loadBearing`/`surface` declarations; rotations flow through the 3D view, both exports, and the cut list as miter/bevel angles rounded to 0.5° with compound-cut advisories past 50°.
- **Drafting-studio interface** — light mode is a vintage paper drawing sheet, dark mode a Prussian-blue cyanotype; geometric grotesque UI type over tabular monospace for every number; a drafting render mode (edge line-art over pale faces on a floor grid); hand-drafted dimension annotations; revision history with restore; print view with border, registration marks, and a real title block (name, dimensions, species, scale, date, revision).
- Three.js 3D preview with custom orbit/pinch controls, damped explosion, part selection, step-synced assembly playback, and full GPU resource lifecycle management.

Runs as a Claude artifact: single file, default export, Tailwind core utilities, Three.js, `window.storage` for preferences only.
