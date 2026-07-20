# Premium refit — the restraint pass (2026-07)

The audit and revision behind one directive: the app should feel like a
best-in-class product Apple might have made — retro-colored, but never a
"retro app." Concretely: **no cheesy stamps, no clutter, no unnecessary
inclusions.** The Showroom palette, the Fraunces/Hanken/Plex Mono voices,
the capsule shape language, and every behavior stay; what changes is that
ornament goes, gloss goes, and hierarchy is carried by scale, weight, and
space instead of decoration.

Relationship to the rest of `docs/ui/`: this document *revises*
[`brand-system.md`](brand-system.md) §4's signature list (revision noted
there) and [`front-porch.md`](front-porch.md) Part II (its finish sections
now cite this bar). It adds no new tokens and removes no behavior — every
suite that was green before is green after.

## 1 · The bar

Three tests applied to every visual element:

1. **Would it survive an Apple design review?** Precision, calm, depth
   used sparingly, nothing rotated for charm, nothing simulating age or
   material it isn't.
2. **Is it content, affordance, or ornament?** Content and affordances
   stay; ornament goes. (Blueprint Mode's grid field stays — there the
   grid *is* the content: a drawing surface.)
3. **Does the retro arrive through color, type, and shape?** The five
   brand constants, the serif/grotesk contrast, and the capsule are the
   era. Anything that arrives through distressing, rotation, or texture
   cosplay is kitsch and goes.

## 2 · Findings → changes (all shipped in this pass)

| # | Finding | Verdict | Change |
| --- | --- | --- | --- |
| 1 | Verdict stamps rotated `-1.2deg` with double-ring inset — "rubber stamp cosplay" (`styles.css` `.stamp`) | cheesy | **Verdict capsule**: unrotated pill, quiet `currentColor` tint at 10%, Hanken 650 caps at `--text-xs`, no border, no ring. Classes and text semantics unchanged (`PASS/ADVISORY/ANCHOR/FAIL` still text-first; forced-colors opt-out kept) |
| 2 | Perforated ochre tick-strip across every overview card (`.overview-card::before`) | ornament | removed; the mono numeral is the tile |
| 3 | Glossy inset top-highlights on primary CTAs (`.btn.primary`, `.mode-btn.build-cta`) | skeuomorph | removed — flat rust fill, `border-color: transparent`, elevation only |
| 4 | 3px `double` mustard rule under every panel `h3` | ornament, repeated | removed; space + Fraunces weight carry the hierarchy |
| 5 | Topbar "drafting title-block" fake double rule (1.5px border + offset box-shadow) | ornament | one 1px hairline |
| 6 | Recessed inset shadow inside the mode-nav capsule | skeuomorph | removed; flat well, raised active segment unchanged |
| 7 | Mustard "spine" + asymmetric radii on every bot chat bubble | decorative overuse of an advisory color | plain paper card, uniform `--radius-m`; mustard is reserved for advisories |
| 8 | Always-on drafting grid painted behind the 3D stage in wood mode (CSS `.viewport-wrap` gradients) | clutter | removed; the stage is a clean warm pool of light. The grid field remains **only** in Blueprint Mode, where it is content |
| 9 | In-scene `GridHelper` on the studio floor (`engine.js`) | clutter — read as "CAD tool" | removed; the PCFSoft shadow alone grounds the piece (flat tier keeps its contact blob). One fewer geometry per engine; `stats()` assertions unaffected (they check flatness, not counts) |
| 10 | Heavy viewport vignette (`inset 0 0 120px` at 55%) | heavy-handed | softened to a barely-there seat (100px at 32%) |
| 11 | Print sheet `3px double` rules | borderline — real drafting idiom, but inconsistent with the refit | print-head to a clean 2px solid; section rules to 1px hairlines |
| 12 | Welcome card border at `--line-2` | minor | quieted to `--line`; blur + shadow already separate it |

## 3 · Deliberately kept (audited, not cheese)

- **Capsule buttons and pill controls** — the atomic-age shape *is* the
  Apple pill; conviction, not kitsch.
- **Blur toolbars over the viewport** (`.control-card`, inspector,
  playback bar) — translucent instrument panels; already the modern
  grammar.
- **Uppercase tracked labels** (`h6`/`th`/kickers) — the caps voice, used
  small and sparingly.
- **Ink-dark tooltips** (provenance, why-joint) — high-contrast, quiet.
- **Build mode's heavy 2px ink rules** — functional shop legibility at
  arm's length with sawdust, not decoration.
- **Zebra rows, seafoam selection, rust single-CTA discipline** — all
  semantic, all audited in `brand-system.md`.
- **The dashed gallery placeholder** — communicates "not yet rendered"
  honestly; dashes are semantics here.
- **Hover lift (2px + shadow) on cards** — the app's one hover grammar;
  no tilt, no shine.

## 4 · Verification

- `npm run build` → `npm test`: all node suites green.
- `npm run test:smoke`: **270 passed, 0 failed** (contrast assertions,
  reduced motion, `stats()` flatness, zero console errors — all live in
  this suite).
- Headless screenshot review at 1440×900, light + dark: welcome card,
  plan overview (capsule verdict tile), safety tab (inline ADVISORY
  capsule), design stage. Dark stage now reads as a clean walnut den —
  piece grounded by shadow alone.
- Goldens and physics untouched by construction (display-only pass).

## 5 · Doc alignment (same commit)

- `brand-system.md` — §1 wording and the §4 signature list revised (the
  revision is noted in place; the double rule, `✦`, and rotated stamp are
  retired from the signature set).
- `front-porch.md` — Part II re-graded to this bar: film grain, vignette,
  cursor halo, magnetic buttons, tilt/specular cards, data ticker, and
  the novelty scroll rail are cut and moved to its rejected list; the
  landing's PROVEN moment is a verdict capsule settling with damped
  scale, no rotation.
- `CLAUDE.md` / `DESIGN.md` — "stamps" language replaced with verdict
  capsules; this document joined the UI system-of-record list.

## 6 · Known follow-ups

- `brand-system.html` (the self-auditing specimen) still renders the old
  rotated stamp in its component gallery — update the specimen to the
  capsule in its next regeneration pass; the `.md` is the system of
  record and is already revised.
- The in-app self-test (`src/selftest.js`) asserts behavior, not styling
  — nothing to update, verified by the green run.
