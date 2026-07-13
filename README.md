# Blueprint Buddy

AI-driven furniture design and build-plan generator, built as a single-file React artifact (`blueprint-buddy.jsx`).

Describe a piece of furniture in plain language and get a professional-grade woodworking plan: an interactive 3D preview with exploded views, a cut list with joinery allowances, a bill of materials with cost estimates, and step-by-step assembly instructions tuned to your experience level.

## Architecture

The AI never does arithmetic. Three layers:

1. **AI layer (intent only)** — the chat calls the Anthropic API; the model returns a JSON `DesignSpec` describing intent (furniture type, overall dimensions, species, joinery). It proposes; it never calculates.
2. **Parametric layer (geometry authority)** — code-owned layout templates derive every part, dimension, and 3D position from the spec. Template math silently corrects any conflicting model output; only `furnitureType: "other"` trusts model-supplied parts, after validation.
3. **Derived layer (plans)** — cut list, BOM, and assembly steps are pure functions of the corrected spec. Every number the user sees comes from code.

## Features

- Parametric templates for leg-and-apron pieces (table, desk, bench, nightstand) and carcasses (bookshelf, cabinet), with stock-thickness snapping, joinery allowances (mortise & tenon, dados, rabbets, …), and structural sanity rules (shelf-span support, screw sizing, wood-movement-safe top attachment)
- Three.js 3D preview with custom orbit/pinch controls, damped explosion scrubbing, part selection, and full GPU resource lifecycle management
- Cut list with CSV export (fractional inches, cm, or mm), BOM with board-foot and sheet-good math, and experience-level-aware assembly instructions
- Self-healing chat pipeline: validation errors trigger one automatic retry; the last valid design always stays rendered

Runs as a Claude artifact: single file, default export, Tailwind core utilities, Three.js r128, no storage APIs.
