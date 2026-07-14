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
npm test                       # unit + audit-regression + golden-corpus (node, no browser)
npm run test:smoke             # build + drive the real app in headless Chromium
npm run test:handcalc          # hand-arithmetic vs engine worksheet (audit asset)
npm run test:battery           # live behavior battery (representative/boundary/adversarial)
```

Engineering-truth guardrails (2026 audit — see `docs/audit/`): behavior
changes to physics, joinery allowances, packing, or exports must keep
`test/audit.test.js` green and re-freeze `test/golden/` deliberately
(`node test/golden.test.js --update`, then review the git diff). The AI
digests are generated from the knowledge tables and self-tested — never
hand-edit a digest string.

## Layout

- `src/` — one module per concern (`ai.js` transports/protocol, `spec.js`
  correction + validation incl. the geometric buildability audit,
  `parametric.js` templates, `structural.js` physics (creep, BIFMA presets,
  F2057 open-drawer tipping), `fasteners.js` fastener-location/joinery-setout
  engine, `packing.js` stock optimizer, `units.js` display boundary,
  `ui.js` DOM). Modules attach to the `BB` global; load order is set in
  `build.js`. Physical constants live in `knowledge.js` (one source each —
  see `docs/audit/02-constants-reference.md`).
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
