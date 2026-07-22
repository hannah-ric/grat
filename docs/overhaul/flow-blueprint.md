# Blueprint Buddy — Overhaul flow blueprint (2026-07)

Source of truth for every journey's target structure. Subagents build this
blueprint; a flow problem found mid-build is logged (findings/) and, only if
blocking, escalated for one amendment — never improvised around.

## 0 · The verdict on current flows (evidence-based)

The July 2026 shell redesign + UI review already rebuilt the app's flows and
audited them hard (`docs/ui/redesign-reports.md`, `docs/ui/ui-review-2026-07.md`:
first-run 390 px journey = cut list in 5 actions, Build mode at 6, zero dead
ends, state in hash + prefs + autosave). **The app's journeys are not the
bottleneck — the arrival is.** A new visitor gets a welcome card with zero
narrative about what the product is or why its numbers can be trusted; there
is no marketing surface at all (`front-porch.md` designed one; it was never
built). Therefore: **rebuild the landing/arrival journey; restyle-and-deepen
the app surfaces by composition; keep every app flow's step count equal.**
This is the honest reading of "rebuild any flow where structure adds steps" —
no current app flow fails that test, and churning a freshly-audited shell
would trade verified quality for novelty.

## 1 · Journeys (schema: Journey | Current steps | Target steps | Rebuild or restyle | State handling | Capabilities relocated)

Steps = user actions (typing counts as 1). "Landing" rows count a brand-new
visitor; returning users bypass the porch entirely (gate) so every returning
journey is unchanged by construction.

| Journey | Current | Target | Rebuild/Restyle | State handling | Capabilities relocated |
| --- | --- | --- | --- | --- | --- |
| First visit → understand the product | no surface (welcome card only) | 0 actions — scroll-told porch narrative; skippable at any instant via CTA | **REBUILD (net-new: porch)** | `bb.porchSeen` localStorage + `prefs4.seenOverture`; share-link/deep-link/returning bypass pre-paint | none (additive) |
| First visit → first design | 2 (type prompt, Design it) after welcome appears | 2 via CTA→prompt-focused handoff (porch CTA counts as the welcome-dismiss equivalent; typing + submit unchanged) | landing REBUILD; studio side unchanged | prompt focus carried by `enterStudio`; level seeded by entry path | starters/photo/import reachable from porch entry cards AND welcome (unchanged) |
| Idea → plan | design lands → "See your plan" pill → Plan (2: pill, or mode btn) | same 2; pill moment gets `Motion.pop`; plan segment glints on fresh results | RESTYLE | mode+tab in hash (existing); recompute is live (existing) | none |
| Revision → updated plan | 1 (chat message) — plan recomputes live, diff chips render | same 1; diff card cascade + plan-segment glint | RESTYLE | history stack (existing); commit() single path (existing) | none |
| Plan → build | 1 (Build segment) | same 1; Build entry restyled (readiness respected — quiet until a chosen design exists) | RESTYLE | build progress per-project (existing, survives exit+reload) | none |
| Build step → step | 1 per step (Next/swipe/arrow) | same 1; step transition uses `Motion.reveal` ≤ 240 ms, interruptible; check feedback `Motion.pop` | RESTYLE | first-unfinished-task entry, progress persisted (existing) | none |
| Export (any format) | 2–3 (More → Export → item) or Share quick actions | same; menu restyle only | RESTYLE | n/a | none |
| Share / import | Share → copy (2); Share → paste → Import (3) | same | RESTYLE | import validation gate (existing) | none |
| Photo → design | 2 (photo button → file) | same; landing "Pro shop"/welcome mention it | RESTYLE | same chat pipeline (existing) | none |
| Species compare | Buy tab → Compare species (2) | same | RESTYLE (`.ledger`) | pure recompute (existing) | none |
| Learn (Shop Reference) | contextual links + More (1–2) | same | RESTYLE | contextual tab appears only while open (existing) | none |
| Diagnostics | logo long-press/Enter (1) | same | RESTYLE | n/a | none |
| Landing → studio (the seam) | n/a | 1 (any CTA) — porch disposes, bench scrolls in, prompt focused, level seeded | **REBUILD (net-new)** | porch engine disposed on entry (`stats()` flat); `enterStudio(path)` | none |

**Cohesion bar for the seam:** same tokens, same type ramp, same motion
presets on both sides; the porch's stage is the same engine class rendering
the same species materials the studio uses — continuity is literal, not
stylistic.

## 2 · Capability inventory → destination map

Base: `docs/audit/01-capability-inventory.md` (2026-07-14) + July shell
additions, re-verified against `src/ui.js` HEAD. **Every row must pass the
Phase 3 walkthrough.** Nothing is removed; locations are unchanged unless
noted "(+ porch discovery)".

| # | Capability (user-reachable) | Where today (unchanged unless noted) |
| --- | --- | --- |
| 1 | Describe a piece in chat → design (AI or offline parser) | chat / hero prompt (+ porch entry) |
| 2 | Photo → parametric design | chat photo btn + welcome card |
| 3 | Six starters w/ real thumbnails | welcome, More → Starters (+ porch starters row) |
| 4 | Refine via chat (partial diffs, clarifying questions, offline species chips) | chat |
| 5 | Inspector: per-part sliders/segs, isolate, joint why-tips + learn links | 3D click → inspector drawer |
| 6 | 3D: orbit/zoom-to-cursor/pinch/keys, F/S/T/Iso, explode, drawers, dims, flick inertia, hover highlight, focus framing | viewport + View popover |
| 7 | Blueprint Mode (cyanotype ortho drawing) | viewport toggle |
| 8 | Assembly playback + joint-dot 3D close-ups | Assemble tab + playback bar |
| 9 | Joint Inspector (8 joints, apart/cutaway) | assembly steps + Shop Reference |
| 10 | Plan Overview (stats + derived next action) | Plan → Overview |
| 11 | Cut list + provenance taps + phone cards | Plan → Cut |
| 12 | Buying plan: stock optimizer, cutting diagrams + zoom, rough-lumber mode, price editor (persisted) | Plan → Buy |
| 13 | BOM w/ fasteners-match-drilling guarantee | Plan → Buy (merged 2026-07) |
| 14 | Structural report: verdict capsules, beginner-first layers, one-tap fixes | Plan → Safety |
| 15 | Species comparison (recompute, tap-to-adopt) | Buy → Compare species |
| 16 | Build mode: wake lock, board-by-board, phone pager, progress persist, install nudge | Build segment |
| 17 | Exports: print sheet, SVG drawing, CSV, JSON spec, GLB/AR, SketchUp .rb/.dae + help | More → Export, Share quick actions |
| 18 | Share codes BB4: + `#d=` links; import gate | Share sheet |
| 19 | Projects: autosave, open/rename/duplicate/delete, thumbnails | More → Projects |
| 20 | History: undo/redo, revision drawer, 3D ghost compare | topbar + More → History |
| 21 | Units in/mm, dual display, fractional precision | More menu |
| 22 | Theme auto/light/dark; render Wood/Flat | More + View popover |
| 23 | Skill level (persisted, owns explanations + joinery gating) | chat head select (+ porch entry seeds it) |
| 24 | Shop Reference (wood/joinery/fasteners/finishes + search) | contextual links + More |
| 25 | Accounts/cloud sync/billing when server configured (else invisible) | More → account area |
| 26 | AI allowance meter + truthful AI badge | chat head |
| 27 | Diagnostics suite | logo long-press |
| 28 | PWA install (manifest, theme-color) + build-complete nudge | build mode |
| 29 | Accessibility: skip links, focus traps, reduced motion, forced-colors, keyboard map (`?`) | global |
| 30 | NEW — porch narrative + calculator + tiered entry + overture | landing (porch) |

Capability-kill candidates: **none proposed.** (C-16 "merge why-joint/learn
links" from the July review remains a parked product call — both links keep
working.)

## 3 · State model (where state lives; survival contract)

| State | Home | Survives |
| --- | --- | --- |
| Design spec + history | `state` + autosave (Store driver chain: artifact→cloud→device→memory) | reload, navigation, rotation |
| Mode / tab / split / chat fold | hash (`#cut;split=N;chat=0`) + `prefs4.ui` | reload, deep link, rotation (resize re-layout existing) |
| Units/precision/theme/render/level | `prefs4` persisted | sessions |
| Build progress | per-project store | exit + reload (existing, review-verified) |
| Porch seen / overture seen | `bb.porchSeen` (localStorage, pre-paint peek) + `prefs4.seenOverture`; sessionStorage fallback | sessions; storage-less envs degrade to session-cap |
| Porch scroll position | none (by design — re-entry restarts narrative; "See the intro again" in More) | — |
| Entry-path tier | seeds `prefs4.level` once | sessions |

Rotation/resize: porch stage re-frames on ResizeObserver like the studio
canvas; chapter layout is fluid; no state loss (assert in Phase 3 by
rotating 390×844 ↔ 844×390 mid-journey).

## 4 · Rebuild vs restyle ledger (per surface)

| Surface | Verdict | Why |
| --- | --- | --- |
| Landing/arrival | REBUILD (net-new porch + overture) | no marketing surface exists; designed but unbuilt |
| Welcome card | RESTYLE + integrate (porch CTA focuses its prompt; copy tightened) | strong bones, review-audited |
| Topbar/nav/menus | RESTYLE | July-rebuilt, audited at 320 |
| Chat | RESTYLE (notes/diff cards get ledger voice; cascade on diff chips) | flows verified |
| 3D viewer chrome | RESTYLE | interaction Tier 1 shipped |
| Plan Overview | RESTYLE + one addition: drawn elevation tile (spec §9.1) + counter tiles | engineering-as-aesthetic flagship |
| Cut / Buy / Safety / Assemble | RESTYLE (`.ledger`, spec plates, cascades, settle) | flagship instrument surfaces |
| Build mode | RESTYLE (feedback presets only; arm's-length legibility floors untouchable) | review-hardened |
| Dialogs/drawers (share, projects, history, species, help, diagnostics) | RESTYLE | behavior-stable |
| Exports & print sheet | UNTOUCHED visuals except tokens already applied | July print restyle just shipped |
| Empty/loading/error states | RESTYLE (voice per spec §10; skeleton already branded) | |

## 5 · Test-contract impact

- `test/smoke.playwright.js` keeps every behavioral assertion; app agent may
  update selectors only where markup changes, documented per edit.
- NEW `test/porch.playwright.js` (landing agent): gate matrix (first visit
  shows porch; returning/`#d=` bypass; reduced-motion = static parity;
  skip/CTA lands studio with prompt focused; `stats()` flat after entry;
  zero console errors; scroll-scrub frame-delta sample; calculator renders
  pipeline-real numbers; entry paths seed level).
- `src/selftest.js` gains a porch section (gate logic × reduced motion ×
  link-arrival matrix; beat table covers p∈[0,1] monotonically) guarded on
  `BB.Porch` presence so headless suites are unaffected.
- Node suites (`npm test`) must stay green untouched — nothing in this
  overhaul may alter pipeline outputs (drafting `animatable` flag defaults
  off; golden fixtures byte-identical).
