# Showroom — brand token & fluid typography system

The Blueprint Buddy design language, built from the five brand constants:

> mid-century modern · clean · retro —
> `#94B9AF` · `#90A583` · `#9D8420` · `#942911` · `#593837`

The executable specimen is [`brand-system.html`](brand-system.html) — a single
self-contained file (fonts inlined, zero external URLs, zero generic
containers) that renders the whole system on bare semantic tags and **audits
itself**: WCAG contrast is computed from the resolved tokens in both schemes
at load, fluid sizes carry live px readouts, and a self-test proves the
published formula and the CSS agree to the pixel. This document is the system
of record: the math, the tables, and the adoption bridge into
`src/styles.css`.

Relationship to the rest of `docs/ui/`:
[`semantic-skeleton.html`](semantic-skeleton.md) fixed the shell's *structure*
(zero-div landmark tree); Showroom fixes its *language* — color, type, space,
shape, motion. Phase 2 shell work should pull from both.

## 1 · The five constants, with jobs the math can defend

Brand hexes never flip with the scheme — their **roles** do. Ratios below are
WCAG 2.2 relative-luminance contrast, measured by the specimen's own audit.

| Constant | Hex | MCM referent | Light "daylight" role | Dark "after hours" role |
| --- | --- | --- | --- | --- |
| Seafoam | `#94B9AF` | tile, fiberglass shells | washes, selection, meter/chart fills | **interactive voice**: links + focus (8.55:1 on paper) |
| Fern | `#90A583` | textiles, avocado | secondary fills, success family base | success family base, chip fills |
| Mustard | `#9D8420` | brass hardware | highlights, double rules, focus ring (3.26:1 ≥ 3:1 non-text) | lifts to `#C8A63C`; text form `#D9BC55` (9.82:1) |
| Rust | `#942911` | enamel, upholstery | **the action color**: links + CTA fill (7.26:1) · also failure | lifts to terracotta `#E47952` (6.05:1 as CTA fill) |
| Walnut | `#593837` | the furniture itself | secondary text *is* walnut (9.17:1) · shadow tint | the entire surface family is walnut-derived |

Two deliberate rules:

- **Rust carries urgency twice** (primary action *and* failure). With five
  fixed hues this is the honest trade; verdicts therefore always ship as
  stamps with text (`PASS / ADVISORY / FAIL`), never color alone.
- **One ink for light brand fills**: `--on-brand: #241A18` clears 4.5:1 on
  seafoam (7.94), fern (6.39), and mustard (4.65) — chips never need
  per-color ink.

## 2 · Scheme tokens

Everything is a `light-dark()` token; the only theme mechanism is the root
`color-scheme`. Derived rules (`--hairline`, `--rule`, shadows, washes) use
`color-mix(in oklab, …)` off these anchors.

| Token | Daylight | After hours | Role |
| --- | --- | --- | --- |
| `--paper` | `#F5F2E9` | `#1B1312` | the room |
| `--paper-raised` | `#FDFBF5` | `#251A18` | panels, cards |
| `--paper-sunken` | `#ECE7DA` | `#140E0D` | wells, input beds |
| `--ink` | `#2A1B1A` | `#F1EAE0` | body text (14.77 / 15.31 : 1) |
| `--ink-soft` | `#593837` | `#C9B9AF` | secondary text (9.17 / 9.61) |
| `--ink-mute` | `#7A6663` | `#9C8A80` | captions, hints (4.80 / 5.54) |
| `--action` | `#942911` | `#E47952` | CTA fill, urgency |
| `--action-hover` | `#6E1D0A` | `#EE9370` | CTA hover |
| `--action-ink` | `#FFF6EE` | `#2A1109` | text on action (7.61 / 6.05) |
| `--action-wash` | `#F6E4DC` | `#3A1D14` | rust tint fills |
| `--link` | `#942911` | `#94B9AF` | interactive text (7.26 / 8.55) |
| `--gild` | `#9D8420` | `#C8A63C` | brass accents, rules |
| `--gild-ink` | `#6E5C0F` | `#D9BC55` | mustard as text (5.86 / 9.82) |
| `--gild-wash` | `#F1EBD3` | `#322813` | mustard tint fills |
| `--seafoam-wash` | `#E3EDE7` | `#22302B` | calm fills, selected rows |
| `--fern-wash` | `#E6EADA` | `#262E1F` | success fills |
| `--ok` | `#46662C` | `#A5C88B` | pass verdicts (5.87 / 9.78) |
| `--warn` / `--warn-wash` | = gild family | = gild family | advisories |
| `--fail` / `--fail-wash` | = action family | = action family | failures (with text) |
| `--focus` | `#9D8420` | `#94B9AF` | focus ring (3.26 / 8.55, ≥ 3:1) |
| `--on-brand` | `#241A18` | `#241A18` | ink on light brand fills |
| `--hairline` | `ink 16%` | `ink 16%` | separators |
| `--rule` | `ink 38%` | `ink 38%` | borders, double rules |
| `--shadow-tint` | walnut | `#000` | elevation color, never gray |
| `--focus` outline | `2px solid` + `2px` offset | | one focus voice everywhere |

Selection is a fixed brand moment in both schemes:
`::selection { background: #94B9AF; color: #241A18 }`. Root `accent-color:
var(--action)` brands checkboxes, radios, range and progress natively.

`prefers-contrast: more` hardens `--hairline` to 55% ink, promotes `--rule`
to full ink and `--ink-mute` to `--ink-soft`. `forced-colors` is left to the
UA except swatches/bars, which set `forced-color-adjust: none` because there
color *is* the content.

## 3 · Fluid type — strict clamp() on a 360→1440 window

One formula for every step (sizes in rem, window `22.5rem → 90rem`,
Δ = `67.5rem`):

```
S (slope, vw units) = (MAX − MIN) ÷ 67.5 × 100
I (intercept, rem)  = MIN − S × 0.225        /* 1vw = 0.225rem at 360px */
size                = clamp(MIN, I + S·vw, MAX)
```

Worked example — body: MIN `1rem`, MAX `1.125rem` →
S `= 0.125/67.5×100 = 0.1852vw`, I `= 1 − 0.1852×0.225 = 0.9583rem` →
`clamp(1rem, 0.9583rem + 0.1852vw, 1.125rem)`.

The ramp runs **minor third (1.200) at 360px → perfect fourth (1.333) at
1440px** over a 16→18px base, so hierarchy is gentle on phones and
declarative on desktops:

| Token | clamp() | @360 | @1440 | Maps to |
| --- | --- | --- | --- | --- |
| `--text-4xl` | `clamp(2.4883rem, 1.7375rem + 3.3369vw, 4.7407rem)` | 39.8 | 75.9 | `h1` |
| `--text-3xl` | `clamp(2.0736rem, 1.5796rem + 2.1956vw, 3.5556rem)` | 33.2 | 56.9 | `h2` |
| `--text-2xl` | `clamp(1.728rem, 1.4151rem + 1.3907vw, 2.6667rem)` | 27.6 | 42.7 | `h3` |
| `--text-xl` | `clamp(1.44rem, 1.2533rem + 0.8296vw, 2rem)` | 23.0 | 32.0 | `h4`, gauge figures |
| `--text-l` | `clamp(1.2rem, 1.1rem + 0.4444vw, 1.5rem)` | 19.2 | 24.0 | `h5`, ledes, `blockquote` |
| `--text-m` | `clamp(1rem, 0.9583rem + 0.1852vw, 1.125rem)` | 16.0 | 18.0 | `body`, `p`, `li`, inputs |
| `--text-s` | `clamp(0.875rem, 0.8542rem + 0.0926vw, 0.9375rem)` | 14.0 | 15.0 | `small`, captions, buttons |
| `--text-xs` | `clamp(0.75rem, 0.7292rem + 0.0926vw, 0.8125rem)` | 12.0 | 13.0 | `h6`, `th`, stamps, chips |

**Zoom-safety** (WCAG 1.4.4): both clamp bounds are rem, and the rem
intercept dominates the slope, so at 200% browser zoom the bounds double
while `vw` stands still — rendered text always at least doubles. The specimen
asserts endpoint math and live formula⇄CSS agreement (`drift ≤ 0.00px` in
headless Chromium at 1440/390).

### Faces

| Voice | Stack | Use |
| --- | --- | --- |
| `--display` | `'Bitter', 'Iowan Old Style', Georgia, serif` (500/600/700, committed in `vendor/fonts`, inlined) | `h1–h4`, blockquote, big verdict figures — never below `--text-l` |
| `--body` | `system-ui …` grotesque | body, labels, `h5/h6`, controls |
| `--mono` | `ui-monospace …` + `tabular-nums` | `code/kbd/samp/data/time/output` — every machine value (the display-boundary rule, spoken in type) |

### Leading — additive, self-regulating

`line-height: calc(1em + n·rem)` instead of unitless ratios: the rem term
scales with zoom, and the *ratio* tightens automatically as sizes grow.

| Token | Value | Applied to | Effective ratio |
| --- | --- | --- | --- |
| `--leading-display` | `calc(1em + 0.25rem)` | `h1 h2` | 1.10 @ 40px → 1.05 @ 76px |
| `--leading-heading` | `calc(1em + 0.375rem)` | `h3 h4 h5`, ledes | 1.22 @ 28px → 1.14 @ 43px |
| `--leading-body` | `calc(1em + 0.625rem)` | `p li dl` | 1.63 @ 16px → 1.56 @ 18px |
| `--leading-caption` | `calc(1em + 0.375rem)` | `small`, captions | 1.43 @ 14px |

Tracking: `--track-display −0.02em` (h1/h2), `--track-heading −0.01em`
(h3/h4), `--track-label +0.08em` (the uppercase label voice: `h6 th legend`
stamps). Measure: `--measure 66ch` on prose (45–75ch window),
`--measure-narrow 48ch`, `--measure-wide 90ch` for ledgers; compact UI
regions opt out explicitly.

## 4 · Fluid space, shape, elevation, motion

Space rides the identical window/formula so rhythm scales with hierarchy:

| Token | @360 → @1440 | | Token | @360 → @1440 |
| --- | --- | --- | --- | --- |
| `--space-3xs` | 4 (flat) | | `--space-l` | 32 → 36 |
| `--space-2xs` | 8 → 9 | | `--space-xl` | 48 → 54 |
| `--space-xs` | 12 → 13.5 | | `--space-2xl` | 64 → 72 |
| `--space-s` | 16 → 18 | | `--space-3xl` | 96 → 108 |
| `--space-m` | 24 → 27 | | `--gutter` | 16 → 36 (elastic) |

- **Shape**: `--radius-s 4px` (drafting-crisp: chips, code, cells),
  `--radius-m 10px` (inputs, cards), `--radius-l 18px` (panels, dialogs),
  `--radius-pill` — every button is an atomic-age capsule.
- **Elevation**: two shadows mixed from `--shadow-tint` (walnut by day, black
  after hours) — warm, never gray.
- **Motion**: one easing family `cubic-bezier(.22, 1, .36, 1)` at
  140/240/420ms; `prefers-reduced-motion` kills all of it.
- **Ergonomics**: `--tap: 44px` floor on primary controls and inputs; input
  text ≥ `max(1rem, --text-m)` so mobile Safari never zoom-jumps.
- **Signatures**: 3px `double` rule under section `h2`s (the print sheet's
  drafting voice — roadmap item 12), `✦` ornament on `hr`, stamp components
  at `rotate(-1.2deg)`.

## 5 · Wide ledgers

Multi-column tables ride inside `<figure class="scroll">`
(`overflow-x: auto`) so the *page* never pans sideways — verified
`scrollWidth == innerWidth` at 320/360/390/768/1024/1440. Grid/flex ancestors
release the `min-width: auto` floor (`min-inline-size: 0`) so internal scroll
regions actually scroll; this is the same conditional-overflow direction as
roadmap item 9.

## 6 · Dark mode principles

1. **A den, not an inversion** — dark surfaces derive from walnut
   (`#1B1312/#251A18/#140E0D`), keeping the wood-shop warmth; grays are
   banned in both schemes.
2. **Hue roles shift, constants don't** — rust hands the interactive voice to
   seafoam; mustard and fern lift to text-safe tints; every lift is named in
   the token table, not improvised per component.
3. **One mechanism** — `color-scheme` on the root plus `light-dark()`
   everywhere; the theme button cycles auto → dark → light with no class
   swaps. (The app's `data-theme` attribute can keep working during adoption
   by setting `color-scheme` under those selectors.)

## 7 · Adoption bridge → `src/styles.css`

The app keeps its var *names* where they already read well; values move to
Showroom. Suggested mapping (old → new):

| `src/styles.css` today | Showroom token | Note |
| --- | --- | --- |
| `--paper / --panel / --panel-2` | `--paper / --paper-raised / --paper-sunken` | direct |
| `--ink / --ink-2 / --muted` | `--ink / --ink-soft / --ink-mute` | direct |
| `--line / --line-2` | `--hairline / --rule` | become mixes, not hexes |
| `--accent` (machinist blue) | `--action` (rust) + `--link` | the brand pivot; blue retires |
| `--accent-soft` | `--action-wash` | |
| `--amber / --amber-ink / --amber-soft` | `--gild / --gild-ink / --gild-wash` | mustard replaces amber |
| `--brick / --brick-ink / --brick-soft` | `--fail / --fail-wash` | rust family |
| `--green` | `--ok` | fern family |
| `--s1…--s7` (8pt) | `--space-2xs…--space-2xl` | fluid; nearest-step table above |
| fixed `font: 15px/1.5` | `--text-m / --leading-body` | 16px floor — also fixes the sub-16px body |
| `--radius 10 / --radius-lg 16` | `--radius-m 10 / --radius-l 18` | near-direct |
| `--display/--body/--mono`, `--ease`, `--t-*` | unchanged | already Showroom's names |

Phasing that keeps every suite green:

1. **Tokens first** — swap `:root` values (and the `data-theme` blocks) for
   Showroom's; keep old var names aliased to new tokens. Re-run the
   33-screenshot matrix + `npm run test:smoke` (contrast assertions live
   there).
2. **Type scale** — replace fixed px `font-size`s with `--text-*` steps
   (nearest step; the build-mode `clamp()`s already there fold in
   naturally).
3. **Signatures last** — capsule buttons, double rules, stamp alignment
   (roadmap items 12/13), each behind the visual-matrix re-run.

The specimen relies on evergreen-browser CSS (`light-dark()`, `color-mix()`,
`clamp()`); `src/styles.css` adoption keeps its existing
media-query + `data-theme` fallback pattern, so no support regression is
introduced by the token swap itself.

## 8 · Verification

```sh
grep -cE '<(div|span)[ >]' docs/ui/brand-system.html    # → 0 (markup and script)
```

Checked in headless Chromium (Playwright, both schemes):

- self-test: `8 steps · formula ⇄ CSS drift ≤ 0.00 px` at 390 and 1440;
- contrast audit: all pairs ≥ target in both schemes (body 14.77/15.31,
  links 7.26/8.55, CTA 7.61/6.05, focus 3.26/8.55 vs 3:1, chip inks
  7.94/6.39);
- `scrollWidth == innerWidth` at 320/360/390/768/1024/1440 — no horizontal
  pan at any width;
- zero console/page errors, JS disabled leaves a complete document
  (instrumentation degrades to em-dash placeholders).

Open [`brand-system.html`](brand-system.html) straight from disk (`file://`
is fine) — resize, cycle the theme, drag the viewport simulator, and read the
audit table: the system grades itself in front of you.
