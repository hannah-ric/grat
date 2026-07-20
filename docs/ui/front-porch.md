# The Front Porch — landing experience & the Materialization

The design for Blueprint Buddy's marketing surface: a first-visit landing
experience whose centerpiece is **the Materialization** — a furniture design
appearing out of thin air as a living 3D blueprint, then becoming wood — told
in a way that explains what the product does and why it is not "just AI."
This is the design pass that `DESIGN.md` ("The front porch") and
[`interaction-system.md`](interaction-system.md) §8b declared themselves
gated on.

Relationship to the rest of `docs/ui/`:
[`brand-system.md`](brand-system.md) owns color/type/space tokens (the porch
adds one display step, §6); [`interaction-system.md`](interaction-system.md)
owns 3D motion law — the porch inherits all seven laws and cashes in the one
scroll-scrub license it reserved (§8b there);
[`phase2-roadmap.md`](phase2-roadmap.md) items 11 (payload diet) and 12
(blueprint-grid paper) are direct accelerants of this work.

Non-negotiables inherited from `CLAUDE.md` and `DESIGN.md`: zero runtime
dependencies, one self-contained file, every asset procedural, the AI
proposes intent while **code owns every number**, reduced motion is a
first-class path, boot stays untouched, memory contracts are smoke-tested,
and **the app is the site** — there is no separate marketing artifact, and a
returning user never sees the porch get in their way.

---

## 0 · The concept in one paragraph

A first visit opens on warm paper and a faint drafting grid. A sentence types
itself — *"A nightstand with two drawers in cherry"* — and the piece
**materializes as a 3D blueprint**: parts ink themselves in, in build order,
line work first, paper fills washing in behind, dimensions ticking on in
mono. A verdict lands — **PROVEN** — with the live sag margin the
engine actually computed. Then the ink washes away and the blueprint becomes
wood: grain, sunlight sweeping shadows across the floor once, parts settling
home. The caption resolves to *"Describe it. We'll draft it."* and the
viewer is standing in the working studio, cursor blinking in the prompt. The
whole story is the pipeline the product actually runs — **intent → drafted →
proven → built** — dramatized with zero fabricated numbers.

Two surfaces carry it:

- **Surface A — the Overture** (§3): an ~8-second one-shot of the
  Materialization inside the existing shell, on first run only. Small build,
  most of the payoff; ships first.
- **Surface B — the Porch** (§4): a scroll-told landing document above the
  studio — four chapters + a "why it isn't just AI" band of real,
  crawlable copy — with the sticky-viewport scrub §8b licensed. Desktop and
  tablet scrub; phones get the Overture plus plain chapters.

**Part II — the director's cut (§10–§17)** is the premium pass on both
surfaces: a porch-only stage grammar, the continuous shot and the
Shapeshift, scene grading, a finish-restraint pass, type as an actor, and
the one timeline that runs all of it inside a hard frame budget. Part I
makes the landing correct; Part II makes it cinema — with Apple-grade
restraint (`premium-refit.md`).

## 1 · Why this story (positioning, restated as choreography)

The differentiation claim is already established in `DESIGN.md`: competitors
do one slice; the moat is the pipeline. The landing's job is to make three
truths *felt* in under ten seconds, then legible in under a minute:

| Truth | How the Materialization shows it | Where it's real in code |
| --- | --- | --- |
| A sentence is enough | the typed prompt is the only "input UI" on stage | `BB.Gallery.FIRST_RUN_PROMPTS`, one chat pipeline (`ui.js` `heroSubmit`) |
| Code owns every number | dimensions tick on *as drafting output*, never as typed text; the verdict carries the engine's own sag margin | `Structural.computeIntegrity` via `state.report` — the caption reads the live report, **never a hardcoded number** |
| It ends at the bench | blueprint → wood → cut-list cascade; the AR/GLB and print-sheet beats | `plans.js`, `packing.js`, `exports.js`, Build mode |

The founding rule gives the landing its voice: **"The AI proposes. The
physics disposes."** Every marketing number on the porch is pulled from the
running engine at display time. If the copy says the nightstand's shelf sags
0.6 mm against a 3.8 mm allowance, it is because `Structural` just said so.
A landing page about trustworthy numbers must not fake its numbers.

## 2 · The Materialization — stage choreography

One sequence, five beats, built almost entirely from shipped machinery. All
motion rides the one damped family (law 2 — no bounce, no elastic); every
beat is skippable (law 4); reduced motion never plays it (§7).

| # | Beat | On stage | Mechanics (existing unless flagged NEW) |
| --- | --- | --- | --- |
| 1 | **Thin air** (0–1.2 s) | empty `--paper` field, faint blueprint grid, the prompt types on | grid = roadmap #12's CSS gradient on the viewport backdrop; type-on is DOM text (~35 ms/char), caption element, not canvas |
| 2 | **Drafted** (1.2–3.4 s) | the 3D blueprint materializes: parts appear at home poses scaled from ~0, staggered in build order; ink edges lead, paper fills wash in; dimensions tick on | engine in drafting mode (`setDrafting`, `engine.js:976`); per-part entrance = the damped scale channel + the hero's stagger (`rec.delay`, `engine.js:1077`); fill wash = **NEW** one scalar ramping the bounded `draftMats` pool's opacity toward `DRAFT_OPACITY` (`engine.js:255`) — no per-part materials, no pool growth; dims via `setDims(true)` |
| 3 | **Proven** (3.4–4.6 s) | joint markers pulse once; the **PROVEN** verdict capsule settles over the caption (damped scale, no rotation) with the live margin line — e.g. *"worst span sags `report`-mm against `report`-mm allowed · safety factor 4"* | the verdict-capsule component (`brand-system.md` §4, premium-refit revision); numbers read from `state.report` at render time; verdict text always ships with the capsule, never color alone |
| 4 | **Built** (4.6–6.4 s) | ink washes away; blueprint becomes wood; parts fly home from a shallow explode; the sun sweeps shadows once; dust motes drift through the beam | `setDrafting(false)` under the shipped ink-wash (9c); **NEW** one-frame canvas snapshot cross-fade (§5) hides the material hard-cut; flight = `heroAssemble`'s path (`engine.js:1070`); sun sweep 6c + hero motes 7b are the already-designed Tier-3 items — the beat works without them, gains theater when they ship |
| 5 | **The studio** (6.4–8.5 s) | caption resolves to the wordmark + *"Describe it. We'll draft it."*; the welcome card rises with its existing entrance stagger; the prompt has focus | today's `showWelcome` path (`ui.js:3354`) unchanged; the Overture simply delays it by one story |

**Skip contract (law 4):** any `pointerdown`, `wheel`, or `keydown` — plus a
visible ghost "Skip" button, first in tab order — snaps every damped goal to
its end state and shows beat 5 immediately. Interruption is free in a damped
system; the skip is the same `k = 1` snap reduced motion uses.

**One-shot contract:** `prefs4.seenOverture`, exactly like `seenHero`
(`ui.js:2142-2146`). The starter hero (exploded → home on first starter
load) stays; it is a different moment (Assemble, not Materialize) and both
play once, ever. The two never chain in one session: loading a starter
after the Overture has played suppresses `heroAssemble` for that session —
two theater beats in a row breaks law 5's "confined showmanship."

Once Part II ships, the Overture performs on the graded stage — the
dark-room dip under the PROVEN verdict, the swept key light, the finish
restraint of §12–§13 — with the choreography above unchanged.

## 3 · Surface A — the Overture (first-run, in-app)

**Where it sits in boot:** boot is untouched through `adopt(r)`. On first
run only (and only when `!reducedMotion`, WebGL alive, and the skeleton
removed), the tail of `boot()` branches: instead of `snapNow()` → welcome,
it hands the engine to `BB.Porch.overture()`, which starts beat 1 with parts
hidden. **Hard fallback:** if the director hasn't produced a first frame
within 400 ms, or throws anywhere, it snaps to today's exact behavior —
`snapNow()`, skeleton gone, welcome card up. Failure is silent (the
degrade law); the Overture is never load-bearing.

**What plays it:** the seed table is already on stage at boot — but the
Materialization deserves the most charismatic starter, and drawers are the
templates' best trick. Recommendation: keep the seed **table** (it is
already the booted model; zero extra pipeline work; the Shaker table reads
beautifully in line work). The nightstand belongs to the Porch's chapter
stills (§4), where variety earns its keep.

**Captions** are real DOM (`<p class="ov-caption">`) in the display face,
one per beat, mirrored through the existing chat welcome message for AT
continuity. They are content, not decoration — beat 2's caption is the
first "what this is" sentence a new visitor reads:

> 1 · *"Say what you want to build."*
> 2 · *"Code drafts it — every dimension computed, none guessed."*
> 3 · *"Physics checks it. Honestly."*
> 4 · *"Then we turn it into wood, cut lists, and build steps."*

**Cost:** ~0 payload (procedural, existing fonts/tokens), no new GLSL, no
new geometry; `stats()` unchanged after teardown (§8).

## 4 · Surface B — the Porch (scroll-told landing)

The document story for people who want the argument, not just the magic —
and the app's first crawlable marketing copy (today `dist/index.html`
contains almost no indexable prose; the porch fixes SEO as a side effect).

**Structure:** a `<section id="porch">` document preceding the bench,
present only when the first-visit gate says so (§4d). The stage — a porch-
owned engine instance — sits `position: sticky` while four chapters scroll
past; scroll progress drives the Materialization **through a damped
follower** (`target = f(scrollProgress)`, current damps at `c = 9`) exactly
as §8b specified — never a transform bound to raw `scrollY`, never hijacked
wheel. The porch stage is pointer-inert (`pointer-events: none`): on the
porch the 3D is display; the *studio* is the instrument. The wheel belongs
to the page here, to the viewport there.

### 4a · Chapters and copy (draft of record)

Kicker `BLUEPRINT BUDDY` · H1 **"Furniture that starts as a sentence."** ·
lede *"Describe the piece you want. Watch it drafted into a real blueprint,
proven by real physics, and turned into plans you can build on Saturday."*
· CTA (rust capsule) **"Open the studio"** · ghost **"See how it works ↓"**

| Ch | Kicker / headline | Copy (support) | Stage state at chapter center |
| --- | --- | --- | --- |
| 01 | DESCRIBE — **"Say it like you'd say it out loud."** | *"'A walnut nightstand, two drawers, about knee height.' That's enough — a photo works too. No CAD to learn, no template maze. The studio speaks carpenter, not computer."* | beat 1→2 start: grid + typed prompt, first parts inking in |
| 02 | DRAFT — **"Watch it become a blueprint."** | *"Parametric templates draft your piece part by part — legs, aprons, joinery, drawer boxes — every dimension chosen by code that knows furniture. Change your mind in plain words; the drawing keeps up."* | full blueprint, dims on, slow ortho front→iso drift |
| 03 | PROVE — **"Physics gets a veto."** | *"Every design runs a structural gauntlet: shelf sag from real wood stiffness, racking, tipping, fastener duty — at safety factor 4, with creep counted in years, on material data from the U.S. Forest Service's Wood Handbook. When something won't hold, we say so — and one tap fixes it honestly."* | PROVEN capsule + live margin figures; joint dots pulse |
| 04 | BUILD — **"From thin air to the workbench."** | *"The blueprint becomes wood — then a cut list with joinery allowances, a buying plan packed onto real boards, assembly steps with 3D joint close-ups, and a build mode that rides to the shop on your phone. Or stand the piece in your room in AR."* | ink-wash → wood, fly-home, cut-list cards cascade in beside the stage |

Between chapter 02 and the honesty band sits the **Shapeshift
interstitial** (§11b) — *"One engine. Any piece."* — the parametric claim
made physical before the trust argument is made in words.

**The honesty band** (between 02 and 03, full-width wash — this is the
"why it's different from just AI" ask, answered with product truths):

> **Why this isn't "just AI."**
> - **The AI never writes a number.** It translates intent — *"lower,
>   wider, walnut"* — and hands it to a deterministic drafting engine.
>   Every millimetre is computed, never generated.
> - **Numbers carry receipts.** Tap any dimension, span, or price in the
>   app and see the formula behind it — that's the provenance system, not a
>   promise.
> - **Same design in, same numbers out.** No dice rolls in a cut list: our
>   reference designs are frozen to 0.05 mm and re-verified on every change.
> - **It can say no.** A bookshelf that would sag under a real load of
>   books fails its check and tells you why — then offers the fix.

Closing band: starters row (the real idle-time thumbnails — `ui.js`
`galleryThumbsPass` renders actual models), one line of trust copy —
*"Runs entirely in your browser · designs autosave on your device · a share
code carries a whole design in a line of text"* — and the rust **"Open the
studio"** CTA. Entering the studio disposes the porch engine and scrolls
the bench to viewport; the welcome card takes over as today.

### 4b · Scroll mechanics

- Progress `p` = porch scroll fraction, mapped piecewise to beat targets
  (a code-owned table: `p<0.22` → beat 1 … `p>0.86` → beat 5). The damped
  follower makes scrubbing feel weighted in both directions; steps in the
  cut-list cascade commit discretely (the 8a "steps commit whole" rule —
  no per-pixel part scrubbing).
- Caption/copy reveals ride `IntersectionObserver` + the CSS easing family
  (140/240/420 ms); no scroll-linked CSS animation dependency, no library.
- **Reduced motion (law 3):** no scrub — each chapter shows a static poster
  frame of its stage state (`snapNow()` + `renderNow()` per pose), copy
  fully visible, CTA identical. Exactly §8b's "static exploded poster
  frames per section."
- **Phones / coarse pointers:** no sticky scrub (thumb scroll + sticky
  canvas fight for the same gesture budget). Phones get the Overture (§3)
  plus the chapters as plain full-bleed sections with poster stills. One
  codepath for stills: the reduced-motion posters.

### 4c · The porch engine instance

The porch owns a transient engine (`BB.Engine.create` on its own canvas) —
the precedent is the thumbnail pass and the Joint Inspector's
create-per-open / dispose-per-close contract. It boots the nightstand
starter spec through `runPipeline`, plays the Materialization, and is
**disposed on studio entry** (`dispose()`, `engine.js:1104`) — the species
texture cache is app-lifetime and shared, so disposal costs nothing warm.
Two GL contexts exist only while the porch is on screen; the budget table
(§8) carries it.

### 4d · The gate (who sees the porch)

- First visit only: a synchronous `localStorage` peek (`bb.porchSeen`) in a
  tiny head script, before first paint — no flash for regulars. Storage
  unavailable (artifact iframe, private mode) → porch shows and stays
  skippable; `sessionStorage` fallback stops repeats within a session.
- A returning user, a share-link arrival (`state.importedFromLink`), and a
  deep-linked hash all bypass the porch entirely — the DESIGN.md rule:
  *the front porch never gets in a regular's way.* Share links land on the
  shared design, not on marketing.
- The porch markup ships in the document for crawlers either way; the gate
  removes it from the DOM pre-paint for returning users (`hidden` +
  `remove()` at boot).
- "See the intro again" lives in More → a one-line menu item that clears
  the flag — cheap, and it makes the porch demoable.

## 5 · Small engine & code additions (all bounded)

Everything new, in one list — each item is display-only, behind the quality
switch where it renders, and inside the memory contract:

1. **`materializeStart()`** (engine) — sibling of `heroAssemble`: parts keep
   home *positions* but `cur.scale ≈ 0.001` with build-order stagger, and
   the draft-fill scalar starts at 0. ~15 lines beside `heroAssemble`.
2. **Draft-fill ramp** (engine) — one `matT` scalar damped in the tick;
   applied as `m.opacity = base(bucket) · matT` over the bounded
   `draftMats` pool and the draft edge singletons. Zero allocation, zero
   pool growth; snaps under reduced motion like every damped value.
3. **Snapshot cross-fade** (porch.js, DOM-side) — before `setDrafting(false)`,
   `drawImage(renderNow(), …)` into a transient 2D overlay canvas; fade it
   out over 420 ms; remove and drop refs. One allocation per Materialization,
   GC'd; `stats()` (GL) untouched. Falls back to the bare ink-wash (shipped
   9c) if the 2D context fails.
4. **`BB.Porch`** (`src/porch.js`) — the director + porch DOM. Browser-only
   module: wire `build.js` (`{{JS_PORCH}}` before `{{JS_UI}}`), the template
   placeholder, and **not** the headless-test `SRC` arrays (it needs
   DOM/Three, same exclusion class as `ui.js`/`engine.js` — the CLAUDE.md
   module checklist applies).
5. **Drafting draw-on option** (drafting.js, Porch chapter 04's print-sheet
   beat) — `elevationSVG(…, {animatable:true})` adds `pathLength="1"` to
   emitted shapes so CSS can draw them with a single
   `stroke-dasharray: 1; stroke-dashoffset: 1→0` rule. Opt-in flag only, so
   golden fixtures stay byte-identical.
6. **`--text-billboard`** (styles.css) — one porch display step above
   `--text-4xl`, from the brand formula (window 22.5→90 rem): MIN 3.5 rem,
   MAX 8 rem → S = 6.6667 vw, I = 2.0 rem →
   `clamp(3.5rem, 2rem + 6.6667vw, 8rem)`. Zoom-safe like every other step;
   used only by porch chapter numerals and the H1.

Deliberately **not** needed: new GLSL (the ≤120-line budget is untouched),
new geometry, post-processing, any dependency, any fetched asset.

## 6 · Art direction — retro palette, modern instrument

The brief in one line: **funky mid-century color, contemporary execution —
never a themed "retro app."** The Showroom constants already are the funk
(seafoam `#94B9AF` · fern `#90A583` · mustard `#9D8420` · rust `#942911` ·
walnut `#593837`); the porch is where they finally get to go loud, and the
studio is where they stay instrument-calm. That split is the taste law.

**Porch = editorial.** Full-bleed wash fields per chapter (paper → seafoam
wash → gild wash → fern wash → paper), oversized Fraunces 900 chapter
numerals (`01–04`) in `--text-billboard`, `--on-brand` ink on every light
wash (pre-cleared ≥ 4.5:1 in `brand-system.md` §1), IBM Plex Mono for every
figure with `tabular-nums` count-ups, and capsule CTAs. Ornament is retired
everywhere (premium refit, [`premium-refit.md`](premium-refit.md)): no ✦,
no double rules, no letterpress — hierarchy comes from scale, weight, and
space. Dark scheme is the walnut den with the cyanotype draft field — the
blueprint blue stays the licensed exception it already is.

**Modern means:** flat color planes and generous `--space-2xl/3xl` rhythm;
fluid `clamp()` type; critically-damped motion only; crisp `--hairline`
separations; real whitespace. **Retro-kitsch ban list** (the "not a RETRO
APP" clause, made enforceable): no wood-grain or paper-texture UI chrome,
no torn edges, no halftone/CRT/scanline overlays, no starburst clip-art, no
boomerang patterns, no display type below `--text-l`, no sepia filters,
no rotated "rubber-stamp" marks, no ornament glyphs.
Mid-century must arrive through **color, type contrast, and shape**
(capsule, wash, hairline) — never through simulated age.

**The studio keeps its contract:** laws 1 and 5 hold inside the bench —
the porch's showmanship budget does not leak into work sessions. The
interface investments that raise the studio's polish are the ones already
specced: the open interaction-system Tier-2 ledger (render-on-demand,
dimension handles, cut-face tint, theme-light cross-fade, finish preview)
plus roadmap #12's blueprint-grid paper — this document adds no new studio
motion.

## 7 · Reduced motion & a11y contract

- **Overture:** does not play (`prefers-reduced-motion` → today's boot
  exactly). Not "a faster version" — absence, because it is pure decoration
  by law 3's decorative/functional split.
- **Porch:** full content parity as static poster chapters (§4b); the
  scrub never binds. Type-on becomes whole text. Count-ups render final
  values.
- Captions and chapter copy are real DOM text in reading order; the stage
  canvas is `aria-hidden` with the H1/lede carrying the page's meaning;
  "Skip" is a real button, first focusable, `:focus-visible` ring per
  tokens; the verdict capsule ships text, never color alone.
- Chapter wash contrast pairs come from the audited token table
  (`brand-system.md` §2) — no new color pairs are minted; the porch adds
  layout, not palette.
- `forced-colors`: washes flatten to Canvas/CanvasText; posters keep their
  border; roadmap #15's sweep covers the porch when it lands.

## 8 · Performance & memory budgets

| Budget | Ceiling | Enforced by |
| --- | --- | --- |
| Boot | unchanged to the millisecond that matters: skeleton → first model path identical; Overture starts only after `adopt()` + skeleton removal, 400 ms first-frame watchdog | §3 fallback; smoke boot assertions |
| Payload | porch copy + CSS only (~4–6 KB pre-inline); zero new vendored bytes; roadmap #11 (font/Three subsetting) remains the real diet | single-file law |
| GL contexts | +1 while the porch is on screen, disposed on entry (Joint-Inspector precedent) | `dispose()` + smoke `stats()` flat after entry |
| Per-frame allocation | 0 in tick (director mutates goals only); one transient 2D canvas per Materialization | law 6; smoke |
| New GLSL | 0 lines | §5 |
| Overture length | ≤ 8.5 s, skippable at any instant | §2 skip contract |

Degrade ladder (inherited, extended): flat tier ⇒ Materialization plays
with flat materials and no sweep/motes (still legible — the choreography is
the content); WebGL loss or any director throw ⇒ snap to standard boot;
reduced motion ⇒ §7; storage loss ⇒ porch shows, skippable, session-capped.

## 9 · Verification plan

Per the house regime — behavior first, then the frozen surfaces:

- **Smoke additions:** Overture plays once then never (prefs flag);
  any-input skip lands the exact standard end state; reduced-motion boot
  is byte-identical to today's; `stats()` flat after porch disposal and
  across a subsequent theme flip; porch absent for a returning profile and
  for share-link arrivals; zero console errors through porch → studio
  entry; boot skeleton timing untouched.
- **Goldens/physics:** untouched by construction — every addition is
  display-side; the `animatable` drafting flag defaults off so drawing
  fixtures stay byte-identical. Any diff in `test/golden/` fails the PR.
- **Selftest:** one porch section — gate logic pure-function tests (seen
  flag × reduced motion × link-arrival matrix) and the beat table's
  monotonic coverage of `p ∈ [0,1]`.
- **Visual matrix:** porch chapters at 360/390/768/1024/1440 × both
  schemes × reduced-motion posters; `scrollWidth == innerWidth` at every
  width (the brand-system bar).
- **Copy truth check:** the honesty band's claims each trace to a shipped
  feature (provenance taps, golden tolerance, the honest-fail starter) —
  reviewed like code, because they are claims about code.

---

# Part II · The director's cut — the premium pass

Part I ships a well-made page. What separates a well-made page from
top-shelf agency work is not more effects — it is **cinematography**: one
continuous shot instead of a stack of sections, a graded frame instead of
a default render, type that behaves like a physical actor on the stage,
motion that answers the visitor's own hand, and finish density high enough
that every pixel reads as decided. This part upgrades both surfaces to
that standard — without touching a law that protects the instrument, and
without one new dependency, shader line, or fetched byte.

## 10 · Stage grammar — porch-only amendments to the laws

The seven laws govern a measuring instrument. The porch stage measures
nothing, so it earns a narrow, explicit license — amendments, not
exemptions, and none of them leak past `#porch`:

| Law | On the bench (unchanged) | On the porch stage |
| --- | --- | --- |
| 1 · motion is meaning | no idle loops | "meaning" includes **the visitor's own input**: scroll and pointer may drive continuous response (parallax §13a, camera travel §11a). Nothing ambient — no idle loops, no ambient texture, and the piece never stirs on its own, even here. |
| 2 · one physics family | damped only | unchanged — every effect below integrates through the same follower. Critically damped is the brand, lobby included. |
| 4 · input is sacred | camera never moves uninvited | the stage camera is **scripted** — it may dolly and reframe between chapters, because nothing is being inspected; the stage is `pointer-events: none` until the handover (§15a), so a script and a hand never fight |
| 5 · instrument calm | showmanship confined | the porch **is** the confined moment — grade and theater live here and stop at the studio door |

Two things stay locked even on stage: **FOV** (the dolly does the drama —
parallel verticals are part of the drafting voice) and the **easing
family** (no overshoot in the lobby either).

## 11 · The continuous shot & the Shapeshift

**11a · One shot, no cuts.** The piece never blinks out between chapters.
Each chapter hands the stage to the next by *reframing the same model* —
drift wide for DESCRIBE, square-on for DRAFT, dolly into the joinery for
PROVE, pull low and long for BUILT — as `camGoal` waypoints in the
timeline (§16). Scrubbed end to end, the porch should read as a single
camera move. The only hard transition is the ink-wash, and the ink-wash is
diegetic: it *is* the drawing changing state.

**11b · The Shapeshift — the signature move.** Between DRAFT and the
honesty band, a full-bleed interstitial: **"One engine. Any piece."** As
it enters, the drafted nightstand's parts take flight and **reassemble** —
nightstand → dining table → bookshelf → nightstand — and each morph is a
real `runPipeline(starterSpec)` → `setModel()` on the porch engine: the
diff-based rebuild (`engine.js:325-385`) flies shared parts to their new
poses and scales retiring/arriving parts out/in, exactly the machinery
every inspector edit already uses. The caption counts honestly from the
pipeline — *"41 parts → 23 → 19"* — read at init, never typed in. No
agency can fake this move and no competitor can copy it, because it isn't
an animation *about* the product; it **is** the product, running. Morphs
commit at scroll thresholds (discrete — 8a's "steps commit whole" rule)
and the damped flight is the tween; all three models are built once at
porch init and reused, so scrubbing is deterministic and allocation-free.
Reduced motion: three posters, same caption.

## 12 · Set, light, grade — cinematography of the stage

The default render is product truth: studio-neutral, evenly lit, grounded.
Correct for the workbench; too polite for a poster. The porch grades the
frame — all through existing systems:

- **12a · Chapter light scripts.** The damped light table (6a/6b
  machinery) gains one script per chapter: DESCRIBE, warm daylight; DRAFT,
  cool and flat (the drawing is its own light); **PROVE goes dark-room** —
  hemi and fill breathe down ~60%, the sun warms, the joint dots and the
  landing verdict carry the frame; BUILT returns to full daylight with the
  sun swept low, so the finished piece throws one long, confident shadow.
  Flat tier: no scripts, standard lighting.
- **12b · The backdrop is the palette.** The canvas is transparent by
  architecture (`engine.js:17-18`) — the chapter wash *is* the cyclorama,
  so the page's color story relights the scene's mood for free: no
  backdrop geometry, no environment swaps, no cost.
- **12c · The floor is a drawing.** Scene fog (core Three, porch engine
  only) fades the grid floor toward the current chapter wash — fog color
  reads the wash token at each chapter change, so set and page are always
  one room. Under it, roadmap #12's blueprint-grid paper: the piece
  stands *on its own blueprint*, receding to a soft horizon.

## 13 · Finish — the restraint pass

*(Revised for the premium refit, [`premium-refit.md`](premium-refit.md):
the frame is graded by light — §12 — never by overlays. Apple-grade means
what's absent is as designed as what's present.)*

- **13a · Pointer parallax.** The stage yaws ≤ 2° toward the cursor
  through `camGoal` — aliveness that is answer, not idle (law 1 as
  amended). Suppressed while scroll velocity is high; absent under
  reduced motion and on coarse pointers. The one pointer effect the
  porch keeps, because it happens *in the scene*, not on top of it.
- **13b · Finish details.** Branded `::selection` already ships. Add
  `text-wrap: balance` on headlines, odometer digits on every counted
  figure (§14d), and porch-scoped scrollbar styling. Nothing else — no
  film grain, no vignette, no cursor accessories, no novelty scroll
  rails; all formally rejected below.

## 14 · Type as an actor

- **14a · The occlusion sandwich.** Because the canvas is transparent,
  DOM layers compose in depth for free: set the H1 *behind* the canvas
  and the drafted piece physically occludes its own headline; the lede
  and CTA sit in front. Two z-indices, zero GL. "The model breaks the
  type" is the oldest expensive trick on the web — here it costs
  nothing, so spend it on the opening frame.
- **14b · Ghost numerals.** Chapter numbers as 35–40 vw Fraunces 900
  outlines (`-webkit-text-stroke`, ~8% ink) drifting a few pixels
  against scroll through the follower — depth without parallax soup.
- **14c · Masked line reveals.** Headlines and ledes reveal line-by-line
  — `translateY` inside `overflow: hidden` line wrappers, 40–70 ms
  stagger, the one CSS family — on chapter entry; the H1 adds a per-word
  rise. A ~20-line post-layout line-wrapper (re-runs on resize) is the
  whole cost. Reduced motion: the text is simply there.
- **14d · Numbers roll.** Every counted figure — parts, sag margins,
  board feet — rolls odometer-style in Plex Mono digit columns to its
  final value. Numbers are the brand; they get the best move in the
  house. Reduced motion: final values, rendered.

## 15 · The handover, Act 0, and the one invited sound

Controls keep the app's own quiet hover grammar — a small lift and shadow.
No magnetism, no tilt, no specular sweeps, no marquee tickers: the stage is
the spectacle; the controls are controls (premium-refit bar). What remains
is three moments that carry real meaning:

- **15a · The handover.** At the closing band the stage goes live for
  the first time — *"Go on. Spin it."* — orbit only, on the same damped
  rig, right before the rust CTA. The visitor's first touch of the
  product happens on the marketing page, and it feels identical inside
  the studio, because it is the same engine. This is the conversion
  moment: display becomes instrument in their hands.
- **15b · Act 0 — the load is the first frame.** The pre-JS boot
  skeleton (A-09) already paints while the megabyte parses; promote it
  from placeholder to overture opening: the brand mark's strokes draw
  themselves (pure-CSS `stroke-dashoffset` on the existing inline SVG),
  the drafting field fades up beneath, and boot's handoff into beat 1 is
  continuous — load, reveal, and story become one shot. Still zero JS
  before `boot()`; still removed at the same line (`ui.js:3336-3337`).
- **15c · Foley, strictly invited — spec'd, default OFF.** The product's
  audio rejection stands ("uninvited sound in a shop"). If ever
  revisited, it is porch-only and opt-in: a "sound" chip, off by
  default, never autoplaying, zero WebAudio init until tapped; three
  synthesized cues (a pencil scratch under DRAFT, a soft wood *thock*
  per landed part, one verdict thump) — generated, never fetched.
  Recommendation: **ship silent.** This paragraph is the drawer the idea
  lives in, so it never gets re-invented worse.

## 16 · The timeline engine & the frame budget

**16a · One timeline, two drivers.** A code-owned track table —
`{p0, p1, from, to, apply}` per property (camera pose, light script,
fill-wash, morph waypoint, caption class) — evaluated
through the single damped follower. The **Overture drives `p` with time;
the Porch drives it with scroll**; every beat, grade, and morph is data
in one place. ~60 lines, no GSAP, determinism inherited, and testable as
a pure function: `selftest` asserts the tracks cover `p ∈ [0,1]`,
monotone, no same-property overlap.

**16b · Frame discipline — felt quality is a budget.**

| Budget | Ceiling | Enforced by |
| --- | --- | --- |
| porch JS per frame | ≤ 4 ms mid-tier | the timeline applies diffs only; zero allocation inside `apply` |
| long tasks during scrub | none > 50 ms; rAF-delta p95 ≤ 20 ms | smoke: an automated scrub records frame deltas |
| stage at rest | 0 rAF work | render-on-demand (4d) is promoted to a **prerequisite** of Phase B |
| off-screen chapters | skipped layout/paint | `content-visibility: auto` |
| morph models | 3, built once at porch init | §11b |
| new GLSL / deps / fetched bytes | 0 / 0 / 0 | the laws |

**16c · Verification addendum** (extends §9): morph determinism (one
scroll script → identical sampled part poses + `cameraPose`); parallax
and light scripts absent under reduced motion and flat tier; the stage
inert to pointers until the closing band, live after; Act 0 asserted
pre-JS (view-source: skeleton animates from CSS alone).

## 17 · Phasing (revised)

| Phase | Ships | Effort | Gate |
| --- | --- | --- | --- |
| **A — Overture core** | §2 director · engine adds (§5) · skip/one-shot gating · smoke | M | none |
| **A′ — the grade** | chapter light scripts (12a) · fog + blueprint floor (12c) · Act 0 draw-on (15b) | S–M | A |
| **B — the Porch** | document, chapters, copy, honesty band, scrub + posters, first-visit gate · type system (§14) · render-on-demand prerequisite (4d) | L | A′ |
| **B′ — the Shapeshift** | §11b interstitial · morph waypoints · odometer counters | M | B |
| **C — theater & receipts** | sun sweep 6c + motes 7b in beat 4 · cut-list cascade · the handover (15a) · print-sheet draw-on (drafting flag) · "see the intro again" menu item | S–M each | B |

Sequencing note: **A′ lands before B on purpose** — the grade multiplies
everything built after it and is the cheapest tier on the table. A is
still shell-shaped: no document restructure, maximum learning about the
Materialization's feel before the porch commits copy and layout around it.

## Explicitly rejected (so it isn't re-litigated)

- **A separate marketing site or second artifact** — the app is the site
  (`DESIGN.md`); two artifacts means two truths.
- **Animation & scroll libraries** (GSAP, Lenis, Locomotive-style smooth
  scroll, Three examples modules) — one damped family and one track table
  do the work; dependencies are the one thing this product never buys.
- **Full-page WebGL backgrounds, shader blobs, particle wallpaper** — the
  piece is the spectacle; atmosphere that competes with it is noise.
- **Idle model motion (autorotate, breathing) even on the porch** —
  aliveness comes from the visitor's input, not a screensaver; §10's
  amendment licenses texture, never movement.
- **DoF / bloom / SSAO "beauty" post** — still no composer in the core
  build, still a full-frame tax, still anti-legibility; the grade
  (§12–§13) buys the cinema without it.
- **Gyro parallax** — a permission prompt for a gimmick.
- **Autoplay video / recorded captures** — fetched assets violate the
  single-file law, and a recording of the engine is a worse engine.
- **Scroll hijacking, snap-jacked storytelling, horizontal-scroll
  sections, or raw `scrollY` bindings** — the wheel stays honest even in
  the lobby; the scrub is a damped follower on a sticky stage.
- **A loading percentage** — Act 0 draws instead of counting; fake
  progress is a small lie, and this brand doesn't tell small lies.
- **Fabricated numbers in marketing copy** — every figure on stage reads
  from the live report or the knowledge tables; a hardcoded "0.4 mm sag"
  is a founding-rule violation in a costume.
- **Confetti/fireworks on PROVEN** — verdict capsules with text, always.
- **Retro-kitsch surface treatments** (wood-grain chrome, torn paper,
  halftone, scanlines, starbursts, aged filters, rotated rubber-stamp
  marks, ornament glyphs) — §6 ban list; palette, type, and shape carry
  the era.
- **Lens cosplay & pointer accessories** (film grain, vignettes, cursor
  halos, magnetic buttons, tilt/specular cards, marquee tickers, novelty
  scroll rails) — the premium-refit bar: grade with light, never with
  overlays; controls are controls.
- **Autoplaying sound** — §15f is a drawer, not a plan.
- **Overture on every visit, or porch for returning users** — one-shot
  and gated; regulars land in their studio.
- **A second easing vocabulary for the landing** — the porch performs in
  the same damped family as the instrument; the brand does not overshoot,
  even in the lobby.
