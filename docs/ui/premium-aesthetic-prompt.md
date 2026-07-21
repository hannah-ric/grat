# Prompt — Re-focus on a premium aesthetic across the whole app

Paste the block below into a fresh session to run a whole-app premium
aesthetic pass. It is written to sit on top of the existing system, not
replace it: the Showroom tokens ([`brand-system.md`](brand-system.md)), the
restraint bar ([`premium-refit.md`](premium-refit.md)), and the founding
rule (*the AI proposes intent; code owns every number*) all stand. The
North Star is one sentence: **it should feel like Apple made a best-in-class,
retro-colored AI woodworking app — simple, calm, and at home on any screen.**

---

## The prompt

> **Re-focus the whole app on a premium aesthetic.**
>
> **North Star.** Blueprint Buddy should feel like the app Apple would have
> shipped if Apple made a retro-colored, best-in-class AI woodworking tool.
> The retro arrives *only* through color, type, and shape — never through
> distressing, rotation, texture cosplay, or novelty. Premium means calm,
> precise, confident, and quiet: hierarchy carried by scale, weight, and
> space, not by decoration. When in doubt, remove something.
>
> **Keep everything that already works.** Do not restyle from scratch and do
> not add tokens. Build on:
> - the Showroom palette and tokens (`docs/ui/brand-system.md`,
>   `src/styles.css`) — five brand constants, `light-dark()` scheme, fluid
>   `clamp()` type/space, one easing family;
> - the restraint pass already shipped (`docs/ui/premium-refit.md`) — verdict
>   capsules, retired ornament, quieted chrome. Extend that bar to every
>   remaining surface; do not regress it.
> - the founding rule: the AI proposes intent, **code owns every number**.
>   This is a display-only pass — touch `src/styles.css`, `src/ui.js` markup,
>   and view code; do **not** touch physics, geometry, joinery, packing, or
>   exports, and do not change any golden.
>
> **The three-question bar — apply to every visual element, screen by
> screen:**
> 1. *Would it survive an Apple design review?* Precision, calm, depth used
>    sparingly. Nothing rotated for charm. Nothing simulating age or a
>    material it isn't.
> 2. *Is it content, an affordance, or ornament?* Content and affordances
>    stay; ornament goes. (Blueprint Mode's grid is content — it's a drawing
>    surface — so it stays.)
> 3. *Does the retro arrive through color, type, and shape?* If the era is
>    arriving through anything else, it's kitsch — cut it.
>
> **Simple and flexible for any platform** (this is a first-class
> requirement, not a footnote):
> - One layout that flows from a 360 px phone to a wide desktop with no
>   separate "mobile version" — verify `scrollWidth == innerWidth` at
>   320/360/390/768/1024/1440; the page never pans sideways.
> - Touch-first ergonomics everywhere: `--tap: 44px` floor on every primary
>   control and input; inputs ≥ 16px text so mobile Safari never zoom-jumps;
>   generous hit targets; nothing that depends on hover to be usable.
> - Works with a keyboard and a screen reader; one visible focus voice;
>   verdicts always ship as capsules with text, never color alone.
> - `prefers-reduced-motion`, `prefers-contrast: more`, forced-colors, and
>   light/dark all remain first-class — every animation collapses to a snap,
>   every contrast pair stays above target.
> - Stays inside the architecture: zero new runtime dependencies, no ES
>   modules, no external URLs or fetched assets, everything inlineable into
>   the single `dist/index.html`.
>
> **Where to look** (audit the whole shell — Design / Plan / Build and every
> plan sub-tab Overview/Cut/Buy/Assemble/Safety, plus Shop Reference, the
> chat panel, inspector, dialogs, empty/loading/error states, the landing
> "front porch", and the mobile layout of each). For every surface, decide
> per the three-question bar, then quiet or remove; prefer subtraction. Favor
> more whitespace, fewer rules, calmer color, and stronger type hierarchy
> over adding anything.
>
> **Deliver:**
> 1. A short written audit: per surface, what you kept, what you quieted, and
>    what you removed — each mapped to the three-question bar (mirror the
>    findings-table format in `premium-refit.md`).
> 2. The implementation, then `npm run build && npm test` green and
>    `npm run test:smoke` green (its contrast, reduced-motion, and `stats()`
>    flatness assertions are the guardrail). Goldens and physics must be
>    untouched — this is display-only.
> 3. Headless screenshots at 390 (phone) and 1440 (desktop), light + dark, of
>    each changed surface, described in the audit.
>
> Work surface by surface. Show the audit and the plan before large sweeps;
> keep each change reversible and behind the smoke re-run.

---

## Why this shape

- **It's additive, so it stays green.** Pointing the pass at the existing
  bar and tokens means the 270-assertion smoke suite and the golden corpus
  stay the guardrail — the prompt can't quietly become a rewrite.
- **"Any platform" is spelled out.** Responsive-without-a-mobile-fork, the
  44 px tap floor, the 16 px input floor, reduced-motion/contrast/forced-
  colors, and the no-horizontal-pan check are named so "flexible for any
  platform" is testable, not vibes.
- **Subtraction is the default instruction.** The single biggest premium
  lever this codebase has already proven (see `premium-refit.md`) is
  removing ornament; the prompt makes "prefer removing" explicit so the pass
  compounds that work instead of re-decorating.
