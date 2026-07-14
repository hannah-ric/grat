# Blueprint Buddy — agent guide

AI-guided parametric furniture design studio. Vanilla JS, zero runtime
dependencies, no framework, no bundler. The deliverable is one self-contained
file: `dist/index.html`.

## The founding rule

**The AI proposes intent; code owns every number.** Model replies are compact
wire-format JSON intent only. All geometry, joinery, structural math, unit
conversion, and pricing live in code (`src/`). Never move a computation into
a prompt, and never let model output write a dimension directly into state.

## Commands

```
npm install --ignore-scripts   # only devDependency is Playwright (tests)
npm run build                  # node build.js → dist/index.html (single file)
npm run dev                    # build + serve on $PORT (3000) + watch + /api/chat proxy
npm test                       # headless unit tests (node, no browser)
npm run test:smoke             # build + drive the real app in headless Chromium
```

## Layout

- `src/` — one module per concern (`ai.js` transports/protocol, `spec.js`
  correction, `parametric.js` templates, `structural.js` physics,
  `packing.js` stock optimizer, `units.js` display boundary, `ui.js` DOM,
  `materials.js` procedural textures/env, `engine.js` 3D viewport,
  `drafting.js` elevation SVGs, `joinery3d.js` + `jointview.js` the joint
  inspector, `gltf.js` GLB export, `icons.js` SVG icon set).
  Modules attach to the `BB` global; load order is set in `build.js`.
- `src/index.template.html` + `build.js` — `{{PLACEHOLDER}}` inlining; adding
  a new src module means adding a placeholder in both.
- `api/chat.js` — the only server code: same-origin Anthropic proxy
  (`ANTHROPIC_API_KEY`, optional `ANTHROPIC_MODEL`). CommonJS, zero deps.
- `serve.js` — zero-dep dev server; mounts `api/chat.js` locally.
- `vendor/` — Three.js + fonts, committed, inlined at build time.
- `blueprint-buddy.jsx` — the earlier React-artifact incarnation (Phase 3);
  reference only, not part of the build.

## Conventions

- Internal math is always millimetres/SI; conversion to display text happens
  only in `BB.Units` at render time.
- No new dependencies without strong cause — the build must stay runnable
  with nothing but Node ≥ 18.
- Keep everything inlineable: no ES modules in `src/`, no external URLs in
  the output (fonts/libs are embedded as data URIs).
- After changing `src/`, run `npm run build && npm test`; run the smoke test
  for UI-visible changes.
- Deployment settings and environment variables: see `DEPLOYMENT.md`.
