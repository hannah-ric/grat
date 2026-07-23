# Deluxe refit — the 2026-07 retro-funk elevation pass

The interface elevation layer on top of the Showroom system
(`docs/ui/brand-system.md`) and the premium restraint pass
(`docs/ui/premium-refit.md`): same palette families, same type, same
semantics — pushed into a cinematic, 3D-accented, modern-but-retro register.
Implemented entirely as one override layer at the end of `src/styles.css`
(and a front-of-house sibling at the end of `src/porch.css`). No selector
renames, no DOM changes, no new behavior: every rule restyles a surface that
already existed, so every feature, breakpoint, and test contract is
untouched.

## The three signatures

1. **The tri-stripe.** One funky flourish: a rust / ochre / seafoam racing
   stripe (`--stripe`) — the three brand families (action, annotation,
   proof) in one mid-century band. It rides only non-scrolling chrome
   edges: the studio topbar's bottom rule, the Build-mode header, the
   porch's pre-JS top edge, and the seated (`.scrolled`) site header.
   Decoration only, never a signal; forced-colors removes it.

2. **Studio-light depth.** One warm top-light (`--edge-light`, built from
   `--structure-ink` so it reads as paper sheen in light and rim light in
   dark) plus the existing layered shadows, applied to raised surfaces:
   topbar, active mode segment, buttons, menus, floating glass (viewport
   toolbar, playback bar, inspector, adjust rail), the welcome sheet, and
   modals. Modals and the history drawer additionally carry a rust datum
   line (inset shadow — it cannot scroll away) as their "pulled from the
   flat file" lid mark.

3. **Press/lift physics.** Buttons lift 1px on approach and press 1px on
   commit; browsing cards (welcome paths, starters, gallery, entry paths)
   lift with a −0.4° wink of rotation. All of it is gated to
   `(hover: hover) and (pointer: fine)` — a thumb never sees a sticky
   hover — and rides the existing transition durations, so the global
   reduced-motion rules collapse everything to a snap.

## The stage

The 3D viewport reads as a lit workshop: key light above, floor band and
bench glow below, and drafting **registration corners** (pure CSS corner
brackets, `--reg-ink`) framing the volume. Blueprint mode re-inks the
corners in `--blueprint-grid` and keeps its cyanotype field untouched; the
welcome overlay hides them along with the rest of the stage chrome. The
gesture hint speaks the machine voice (Plex Mono HUD readout).

## Atmosphere

A fixed 4% film-grain wash (`--grain-url`, procedural SVG `feTurbulence`
data URI — self-contained, no external asset) covers the whole instrument,
pointer-inert. Print and forced-colors opt out. Scrollbars join the
instrument: thin, warm, `--ink-2`-tinted; the tabs bar keeps its own
scrollbar-hiding rules by specificity.

## Guardrails honored

- Tokens only; every color is a `color-mix` of existing Showroom families.
- Resting styles are the reduced-motion end state; no new keyframes at all.
  (A scale breath on the house `rise` entrance was tried and reverted: the
  phone plan-entry guarantee — the first plan row visible without a drag,
  X-07 — measures content at entry, and a scaled first frame on a tall
  panel shifts near-top rows past the chat sheet. The entrance grammar
  belongs to the presets, not to deeper CSS keyframes.)
- Verdicts still ship as text capsules (the new `.stamp` ring is an inset
  hairline of `currentColor`, not a signal).
- One filled primary per screen: the quiet tiers (`.ghost`,
  welcome-open's demoted Send, `build-quiet`) are explicitly flattened in
  the layer.
- `body.drafting`, forced-colors, `prefers-contrast: more`, and print all
  keep their existing overrides (higher specificity or explicit opt-outs).

## Verification

- `npm run build && npm test` — all headless suites green.
- `npm run test:smoke` (288) and `npm run test:porch` (81) green on the
  refit build.
- Screenshot pass over light/dark × porch / welcome / design / plan /
  blueprint at 1440×900.
