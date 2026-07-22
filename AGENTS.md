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
npm run test:porch             # build + drive the landing (porch) in headless Chromium
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
  `ui.js` DOM, `materials.js` procedural textures/env, `engine.js` 3D
  viewport, `drafting.js` elevation SVGs + blueprint mode,
  `joinery3d.js` + `jointview.js` the joint inspector, `gltf.js` GLB export,
  `icons.js` SVG icon set, `motion.js` the `BB.Motion` animation-preset
  library over vendored anime.js — presets by name only, one reduced-motion
  gate, `porch.js` + `porch.css` the first-visit landing narrative — see
  `docs/overhaul/design-language.md`). Modules attach to the `BB` global;
  load order is set in `build.js`. Physical constants live in `knowledge.js`
  (one source each — see `docs/audit/02-constants-reference.md`).
- `src/index.template.html` + `build.js` — `{{PLACEHOLDER}}` inlining; adding
  a new src module means adding a placeholder in both.
- `api/` — all server code, CommonJS, zero deps (Stripe's few REST calls
  hand-rolled in `_stripe.js` over `fetch`+`crypto`, like `_kv.js` — the
  no-dependency rule holds): `chat.js` (same-origin Anthropic proxy;
  `ANTHROPIC_API_KEY`, optional `ANTHROPIC_MODEL`; meters AI by uid or
  hashed IP + a burst limit), `auth.js` (optional OAuth logins → stateless
  HMAC session cookies; `_session.js` is the shared signer, not an endpoint),
  `store.js` (optional per-user document store on Upstash/Vercel KV REST, or a
  local JSON file in dev), `billing.js` + `stripe-webhook.js` (optional Stripe
  subscriptions → the Free/Pro gate; `_entitlements.js` is the entitlement/
  usage authority, `_stripe.js` the client — both shared libs, not endpoints).
  All auth/storage/billing degrades: no env vars → the client persists to
  `localStorage` and shows no login or upgrade UI (see `DEPLOYMENT.md`).
- `serve.js` — zero-dep dev server; mounts every `api/` handler locally.
- `vendor/` — Three.js, anime.js v4.5.0 (`anime.umd.min.js`), + the Fraunces /
  Hanken Grotesk / IBM Plex Mono fonts, committed, inlined at build time.
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
