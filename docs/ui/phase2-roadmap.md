# UI Phase 2 roadmap — sleek-retro polish & optimization

Written after the shell redesign shipped (collapsible chat, viewport splitter,
readiness strip, non-blocking onboarding, URL tabs, advisory fold, compact
header). Every item below comes from re-auditing the implemented interface —
a 33-screenshot matrix sweep (desktop/tablet/mobile × light/dark, dialogs,
splitter extremes, tiny-360 header, keyboard focus) plus the 158-assertion
smoke suite. Each item names its evidence. Baselines to preserve while doing
any of it: `npm test` (293 + 99 + 6 golden), `npm run test:smoke` (158),
`test/handcalc.js` (14/14), in-app diagnostics green.

## How this list was prioritized

P1 = users hit it in normal flows on real devices; P2 = interaction depth and
a11y completeness; P3 = aesthetic/perf investment with no behavior risk.
Within each band, ordered by (reach × severity) / effort.

---

## P1 — real friction, normal flows

### 1. Phone header action cluster
**Evidence:** at 390 px the design name compresses to ~44 px ("T…", audit
`m01`, `m08`); redo is display-none under 400 px; Export ▾ and More ▾ sit side
by side eating ~130 px.
**Proposal:** under 560 px collapse Export into the More menu (single ⋯ menu),
restore redo, and give the design name a 96 px floor. Keep `#exportBtn`
reachable for tests by moving, not removing (`hidden` + menu mirror), or remap
the smoke helper. Touch targets stay ≥40 px.
**Effort:** S–M. **Risk:** smoke-test contract on `#exportBtn` — update
`clickMoreCtl` style helpers alongside.

### 2. Build-mode cutting diagrams on phones
**Evidence:** `m07`: board-diagram SVG strip labels ("Top (strip 1/5) · 20 in")
render ~4 px tall at 390 px width — unreadable at the saw, which is exactly
where they matter.
**Proposal:** in build mode render diagrams at a larger min-height with
horizontal pan (`overflow-x: auto` inside the board card), scale SVG text with
a viewport-aware font floor, and add tap-to-zoom (full-width lightbox reusing
the existing scrim pattern).
**Effort:** M. **Risk:** none to physics — presentation only; `Packing.boardSVG`
already takes a formatter.

### 3. Advisory chips vs. mobile plan content
**Evidence:** `m01`/`m03`: fixed advisory chips (bottom-anchored above the
sheet) cover the cut-list rows a user is trying to read; the +N fold helps the
stack but not the placement.
**Proposal:** on ≤880 px collapse advisories to a single pill ("⚠ 2") docked
beside the sheet peek; tapping expands the stack overlay. Integrity tab badge
already carries the same state for discovery.
**Effort:** S–M. **Risk:** smoke asserts `.advisory` visibility after a
height change — keep the expanded state reachable and update the assertion to
go through the pill on mobile.

### 4. Readiness flow has no phone surface
**Evidence:** the strip hides under 660 px (by design this phase); phones get
no Design → Validate → Plans → Build affordance at all.
**Proposal:** a compact 4-dot readiness pill inside the expanded chat sheet
header (or left of the tab bar, scrolling with it). Reuse `readinessSteps()`
— zero new derivation.
**Effort:** S. **Risk:** none.

### 5. Sheet gesture physics
**Evidence:** the mobile chat sheet toggles on tap only; the handle looks
draggable (grabber affordance, `cursor: grab`) but doesn't follow a finger.
**Proposal:** pointer-follow drag with velocity snap open/closed, honoring
`prefers-reduced-motion`. Keep tap-to-toggle. ~60 lines, no layout change.
**Effort:** M. **Risk:** touch-action interplay with chat-log scrolling —
gate the drag to the handle element only.

---

## P2 — interaction depth & a11y completeness

### 6. Splitter on touch
**Evidence:** drag works (pointer events), but the double-click reset has no
touch equivalent and the 14 px mobile hit area is thin for thumbs.
**Proposal:** raise the touch hit area to 20 px (visual grip unchanged),
double-tap reset via a 300 ms tap-tap detector, and a long-press hint tooltip.
**Effort:** S.

### 7. Reference sub-tabs: finish the ARIA tab pattern
**Evidence:** `.ref-tabs` is `role=tablist` with roving tabindex (good), but
the tabs lack `aria-controls` and the table region isn't a `role=tabpanel`
with `aria-labelledby`.
**Proposal:** ids per subtab + panel role/labels, mirroring the main tab bar
(which is complete). Extend the smoke a11y block.
**Effort:** S.

### 8. Keyboard shortcut map
**Evidence:** the ? popover documents viewport keys only; global keys
(Ctrl+Z/Y, Escape layers, tab arrows, splitter keys) are discoverable nowhere.
**Proposal:** extend the ? popover into two columns (Viewport / Everywhere),
add `/` to focus chat and `[`/`]` to cycle plan tabs. One dialog, no new
surface.
**Effort:** S–M.

### 9. Sticky table headers
**Evidence:** long cut lists (bookshelf: 9+ rows) scroll headers out of view
in the panel; `position: sticky` is defeated by the `.table-scroll`
overflow-x wrapper (tested during this phase and deferred).
**Proposal:** apply `overflow-x: auto` conditionally — a ResizeObserver adds
`.scrollable` only when `scrollWidth > clientWidth`, letting sticky work in
the common no-horizontal-scroll case. Fallback stays the status quo.
**Effort:** M. **Risk:** subtle; needs the visual matrix re-run.

### 10. Focus order after tab-panel re-render
**Evidence:** switching tabs rebuilds `#panel-main` innerHTML; focus inside a
rebuilt panel (e.g. after activating a fix button) lands back at `body` in
some flows. The integrity fix button path re-renders and loses the button.
**Proposal:** after `renderPanel()` triggered by an in-panel action, restore
focus to a stable anchor (the panel heading with `tabindex="-1"`), announced
via the existing live region.
**Effort:** S–M.

---

## P3 — sleek-retro polish & optimization

### 11. Payload: Three.js and font subsetting
**Evidence:** `dist/index.html` is 1224 KB; `vendor/three.min.js` and three
Bitter woff2 weights dominate. Boot on a mid phone pays full parse cost before
first paint.
**Proposal:** (a) subset Bitter to the used glyph range (latin basic +
fractions ⁄ ½ etc.) — typically 40–60 % smaller per weight; (b) build a
custom Three bundle with only the used modules (no loaders/controls beyond
what `engine.js` touches). Both keep the single-file constraint (`build.js`
inlines whatever sits in `vendor/`).
**Effort:** M (fonts) / L (Three). **Risk:** golden-visual drift only if the
subset drops a glyph — the stale-unit sweep in smoke would catch missing
fraction glyphs as tofu via screenshot review.

### 12. Retro drafting texture, one notch further
**Evidence:** the sleek-retro language (marking-blue accent, Bitter slab,
stamp components) stops at flat panel fills; the print sheet's drafting
character (double rules, hatched offcuts) doesn't echo on screen.
**Proposal:** tokens-only touches — a 1 px double rule under panel h3s, a
faint blueprint-grid background on the viewport paper (CSS gradient, both
themes), stamp-style `PASS/ADVISORY/FAIL` already exists — align the
readiness dots to the same stamp family. Strictly `var()`-driven, no images.
**Effort:** S–M. **Risk:** dark-theme contrast — re-run the matrix.

### 13. Motion micro-polish
**Evidence:** welcome card and readiness dots snap state changes; the one
easing family (`--ease`) is in place but unused on dot state transitions.
**Proposal:** 150 ms dot fills, welcome entrance already rises — add a
120 ms stagger between the three cards, splitter grip scale on grab. All
inside the existing `prefers-reduced-motion` kill switch.
**Effort:** S.

### 14. PWA shell for the shop
**Evidence:** build mode is designed for a phone at the bench (wake lock,
giant targets), but the app lives in a browser tab with no `theme-color`, no
manifest, no icon — losing it mid-build means retyping a URL with sawdust on
your hands.
**Proposal:** inline manifest (data URI) + `theme-color` meta pair
(light/dark), maskable SVG icon reusing the brand mark. Installability without
any server change; single-file constraint holds.
**Effort:** S–M. **Risk:** none to runtime behavior.

### 15. Forced-colors / prefers-contrast audit
**Evidence:** untested this phase; several affordances are color-only at the
edges (readiness dots, integrity dot, chip tints) though text equivalents
exist for AT.
**Proposal:** a `forced-colors: active` pass (system color keywords for
chips/dots/toggles) and a `prefers-contrast: more` bump for `--muted`.
Add a forced-colors screenshot to the audit script.
**Effort:** S–M.

### 16. Session-scoped UI state in the URL
**Evidence:** tabs restore from the hash now; splitter %, chat fold, and the
active reference search don't travel with a shared link.
**Proposal:** extend the hash grammar conservatively
(`#stock;split=70;chat=0`) behind a parser that ignores unknown keys — share
codes stay the design-transport, the hash stays the view-transport.
**Effort:** S. **Risk:** keep `replaceState` guards (sandboxed frames).

---

## Explicitly not planned

- **Framework/bundler adoption** — the vanilla single-file architecture is a
  product feature (artifact publishing); everything above fits it.
- **Moving computation into prompts** — founding rule; nothing here touches
  the AI/code boundary.
- **New runtime dependencies** — items 11–14 are build-time or CSS-only.

## Phase 1 ledger (what this roadmap builds on)

Shipped and verified this phase: collapsible chat with rail + unread dot;
keyboard/pointer viewport splitter (ARIA separator, persisted); compact
one-row header at 1440/1024/390/360; tablet breakpoint; non-blocking welcome
with three entry paths over a live bench; derived readiness strip
(Design → Validate → Plans → Build); URL-restorable tabs incl. reference
subtab; advisory severity icons + cap/fold + live region; numeric-aligned
zebra plan tables with scoped headers; autosave saving…/saved feedback with
explanation; viewport ? help + pointer-aware hint; dialog `aria-labelledby`
everywhere + `aria-modal` drawer; skip link; h1 wordmark; actionable empty
states; integrity-tab spoken state; overscroll containment throughout;
splitter hidden in build playback; mobile build-mode title fix.
Suites: smoke 125 → 158 assertions, all node suites green, zero console
errors across the matrix, diagnostics green in-app.
