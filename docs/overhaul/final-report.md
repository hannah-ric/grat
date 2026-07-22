# Blueprint Buddy experience overhaul — final report (2026-07)

**Verdict: yes.** Landing and app now read as one premium, cohesive product —
same tokens, same type ramp, same motion vocabulary on both sides of the seam
— and every journey is equal to or shorter than before (measured, §1). All
suites green at head: unit 1253 · audit 480 · golden 6/6 byte-identical ·
battery 50 · server 150 · smoke 283 · porch 58 · handcalc 16/16 · in-app
diagnostics 145/145. The pipeline fence was never crossed. Branch
`claude/blueprint-buddy-overhaul-7xx68y`, pushed, undeployed, unmerged.

## 1 · The language and the flows

The synthesis in one line: Blueprint Buddy already owned both references'
sensibility — numbers as sacred objects, one piece treated with reverence —
so the overhaul evolved the existing Showroom identity to reference *scale
and choreography* instead of costuming it. Full decision ledger with sources:
`design-language.md` §13 (spec trace) and §14 (conflict ledger). Highlights:

| Element | Decision | Source |
| --- | --- | --- |
| Palette/tokens/space/shape/faces | Showroom unchanged | identity |
| `--text-billboard` + ghost numerals + occlusion sandwich | landing display scale | oryzo + porch spec |
| Sequential-reveal chapters, counters, kickers | landing narrative | terminal |
| Calculator + tiered entry | conversion devices over real pipeline state | terminal |
| Engineering-as-aesthetic (drawn linework, ledgers, spec plates, live numbers only) | both surfaces | oryzo — meant, not faked |
| Motion engine | anime.js v4.5.0 vendored, `BB.Motion` presets, one reduced-motion gate | user mandate |
| Easing | house cubic-bezier + non-overshoot spring only | identity (law 2) |
| 3D integrator | damped-lerp follower retained; anime timelines drive its goals | identity — logged non-trivial |

Reference-access caveat: both sites were network-blocked in this environment
(evidence `findings/network-block.md`); synthesis used the brief's own
translation + design-press coverage. Recorded, not hidden.

Journeys (measured by the verifier, `findings/phase3-verification.md`):
landing→studio **1**; first design after CTA **2**; idea→plan **1**;
cold start→cut list **5** (unchanged from the July audit); plan→build **1**;
build step→step **1**; revision→updated plan **1**; export **2**;
share-copy **2**. Nothing regressed; the landing added an *optional*
narrative that returning users never see (gate verified).

## 2 · What was built (fix log)

Schema: Surface | Spec section | Files | Commits | Verified widths | Perf | Capabilities | Verified

| Surface | Spec | Files | Commits | Widths | Perf | Caps | ✓ |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Foundation: anime vendoring + wiring | §5 | build.js, template, vendor/ | 514cb13 | all 6 | +118 KB (the engine) | — | Y |
| BB.Motion preset library + gate | §5 | src/motion.js | 0f2756a | all 6 | compositor-props only, grep-proven | — | Y |
| Component vocabulary + tokens | §1 §4 | src/styles.css | 8d418a3 | all 6 | — | — | Y |
| Drafting animatable flag | §9.1 | src/drafting.js | 8e565a8 | — | goldens byte-identical | — | Y |
| Selftest motion section | §5 | src/selftest.js | c376654 | — | — | 27 | Y |
| Porch engine API (display-only) | §7 | src/engine.js | 12b1c4e | — | stats() flat | — | Y |
| The landing (porch document + Materialization + calculator + entry paths + gate + overture) | §6–§8 | src/porch.js, src/porch.css, template region, ui.js boot tail | 73e57a7, 22fef9e | all 6 + dark + reduced | track apply 5.4–7.4 µs; scrub adds no long tasks | 30 | Y |
| Porch tests + selftest | blueprint §5 | test/porch.playwright.js, selftest | d4d26e4, 53f8419 | — | 58/58 | — | Y |
| Cut/Buy/BOM/species ledgers | §9.2 | ui.js, styles.css | 03f0871, faa0cdd | all 6 (Cut) | one-time cascades; hot paths unchanged | 11–13, 15 | Y |
| Overview cover sheet (counters + drawn elevation + verdict plate) | §9.1/§9.4 | ui.js | 5f0328a | all 6 | draw once per design | 10 | Y |
| Safety settle + Assembly cascade | §9.3 | ui.js | fbc38d3 | 375+1440 | — | 8, 14 | Y |
| Chat diff kicker + cascade + plan glint | 2b-5 | ui.js | aca9a05 | 375+1440 | chat RT +2–3 ms (one-time presets) | 1, 4 | Y |
| Build-mode pops + reveals | 2b-6 | ui.js | e738370 | 375+1440 | ≤240 ms, interruptible | 16 | Y |
| Smoke additions (12) + honest updates (0 selectors) | blueprint §5 | test/smoke.playwright.js | bfca36e | — | — | — | Y |
| 'See the intro again' | §6.5 | template, ui.js | 36886cc | — | — | 30 | Y |
| Verifier repairs: porch token hoist, `?` keymap, doc sync | DoD 3/row 29/DoD 6 | porch.css, ui.js, CLAUDE/AGENTS/front-porch | 149d63e, 38d628b, 1c69924 | — | — | 29 | Y |

Orchestration commits: b420895 (specs), 4a6e942 (briefs), 89dcc6b (budget
amendment), f240496 + 8cc95bb (merges), 3d41475/7c7fa42/36886cc/b80c650
(dist rebuilds), 69e7a7d (.gitignore), 6fe54b4 (verification evidence).

**Preview:** `npm run build` then open `dist/index.html`, or `npm run dev`
(port 3000). A fresh profile (or More → "See the intro again") shows the
landing; scroll the narrative, then any CTA lands in the studio with the
prompt focused. Returning visits, `#d=` share links, and deep links skip
the landing entirely.

## 3 · The landing

Masthead (Act 0): pre-JS the brand mark draws itself in CSS over a static,
fully readable document; H1 "Furniture that starts as a sentence." sits at
billboard scale *behind* the live stage canvas (occlusion sandwich), lede
and rust CTA in front; headline reveals via `Motion.lines`. Chapters 01–04
(DESCRIBE / DRAFT / PROVE / BUILD) scroll past a sticky stage running the
Materialization on a porch-owned engine — typed prompt, parts inking in at
scale-zero through `materializeStart()`, a real `elevationSVG` drawing
itself beside chapter 02, the PROVEN moment settling as a verdict capsule
reading the live report (which honestly says **anchor required** for the
nightstand — F2057 — and we show exactly that), ink-wash to wood in 04 with
the cut-list cards cascading in. One `Motion.scrollSync` observer drives a
code-owned track table; the engine's damped follower smooths it; the wheel
is never hijacked. Shapeshift shipped as its sanctioned static fallback
(three live thumbnails, honest part counts) — the interstitial morph
remains parked (§8). Honesty band verbatim from the porch spec. The
build-vs-buy calculator runs the real pipeline per interaction (template ×
size × species → stock-plan cost, boards, parts, bench-hours) against a
labeled typical-retail range table. Tiered entry paths seed the real skill
preference (beginner/intermediate/advanced) and land in the studio with the
prompt focused — that is the signup handoff; auth remains optional and
untouched. Phones and reduced motion get the same document with poster
stills and no scrub (verified static parity, zero running animations).
Perf: track apply 5.4–7.4 µs/frame vs 4 ms budget; scrub added no long
tasks over rest on SwiftShader; absolute p95 needs GPU hardware (§8).
Evidence: 53 shots in `findings/landing/`, verifier's in
`findings/verify/`.

## 4 · The app

Rebuilt: nothing structurally — the July 2026 shell was freshly audited
(5-action first journey, zero dead ends), so the blueprint deliberately
restyled and deepened by composition instead of churning it; the one
structural piece of the overhaul is the landing/arrival journey. Restyled:
plan surfaces as instruments (ledger head bands, drawn rules, mono summary
strips, one-time row cascades on Cut/Buy/BOM/species), Overview as a
drafting cover sheet (counter tiles + a front elevation that draws itself
once per design change + verdict spec plate), Safety verdict settle, chat
diff cards with kicker + chip cascade + plan-segment glint, build-mode
check pops and ≤240 ms interruptible task reveals. State handling:
unchanged homes (hash for mode/tab/split, prefs4, per-project progress,
autosave chain) plus the two porch flags; reload, rotation, and build
progress survival re-verified end-to-end. Functional-motion discipline:
two-epoch render keys (design identity + real navigation) so recomputes,
previews, resizes, and scrubs never animate — measured: preview hot path
unchanged (4.1→7.7 ms range consistent with baseline), commit +~2 ms from
sanctioned one-time presets, zero animations start during recompute.
Mid-build usability: pager, 56 px controls, diagram legibility floors, and
wake lock untouched; motion there is feedback-only.

## 5 · Capability audit

All **30 of 30** rows of the inventory (`flow-blueprint.md` §2 — the 29
existing capabilities + the new landing) verified reachable and working by
the Phase 3 walkthrough at 1440 with 375 spot-checks
(`findings/phase3-verification.md`). One capability was broken pre-repair —
the `?` keyboard-map shortcut listed in row 29 had never existed as a key
(the map lived only in the View popover); repaired in 38d628b with a smoke
assertion. Locations: unchanged for all 29 (the landing adds discovery
paths, relocates nothing). Capabilities recommended for removal: **none**
(C-16 "merge why-joint/learn links" stays a parked product call; both
links work).

## 6 · Cohesion evidence (before/after by path)

Before: `findings/before/` (17 shots). After: `findings/landing/` (53),
`findings/app/` (29), `findings/verify/` (60). Pairs of record:
- Arrival: `before/landing-welcome-1440.png` → `landing/1440-masthead.png` (+ chapters)
- Cut list: `before/plan-cut-1440.png` → `app/cut-1440.png` (+ dark, reduced)
- Overview: `before/plan-overview-1440.png` → `app/overview-1440.png`
- Build: `before/build-390.png` → `app/build-390.png`
- Seam: `verify/` closing-band + studio-welcome pair — same tokens, faces,
  and presets on both sides; the porch stage renders the same engine and
  species materials the studio uses, so continuity is literal.

## 7 · Motion inventory

Engine: anime.js v4.5.0 (`vendor/anime.umd.min.js`, MIT, inlined like
Three.js). Library: `BB.Motion` (`src/motion.js`) — `reveal`, `cascade`
(stagger, 360 ms cap), `draw` (SVG stroke-in), `rule`, `count`/
`countUpOnce` (fmt-driven, BB.Units for dimensional values), `lines`
(masked line reveal), `settle` (non-overshoot spring), `pop`, `timeline` +
`scrollSync` (inert no-ops when gated), `auto` (`data-motion` scanning);
house easings only; every preset cancels in-flight work on its targets and
animates transform/opacity/stroke-dash exclusively. One gate: `Motion.on()`
(live `prefers-reduced-motion`) — off means synchronous end states, no
timelines built, porch static, overture absent; verified with the
preference enabled (0 running animations). Legacy audit: no animation
libraries existed; CSS micro-state transitions (already tokenized) remain
CSS by design; the engine's damped-lerp family is **retained** as the 3D
integrator that anime timelines feed — both logged in `design-language.md`
§5 with rationale. `anime.` appears nowhere outside motion.js
(grep-verified at head).

## 8 · Unresolved

1. **Payload (U1)**: dist 1,950,845 → 2,169,761 B (**+218,916 B ≈ +11.2%**)
   vs the amended +190 KB ceiling (≈23 KB over; anime is 118 KB of it).
   I chose recorded overage over stripping source comments for size —
   readable source is a repo value; the real diet lever remains roadmap
   #11 (Three/font subsetting, untouched by this work and worth ~hundreds
   of KB). Your call whether to fund that next.
2. **Scrub p95 on hardware (U2)**: SwiftShader can't prove the absolute
   ≤20 ms budget; scrub-vs-rest shows no added long tasks. Verify on a
   physical phone.
3. **Pre-existing `.panel-inner` CSS rise on recompute renders (U3)** —
   predates the overhaul, B-13-audited; left per CSS-stays-CSS. Product
   call to remove or keep.
4. **Two load-sensitive test waits (U4)** — porch scroll-fraction wait and
   smoke's immediate ink-wash check can flake on a saturated CI box (green
   here, 5/5). Candidates for explicit-signal waits later.
5. **Parked taste/stretch**: the Shapeshift morph interstitial (spec §6.4
   stretch; static fallback shipped); overture Skip pill overlaps the View
   button at 375 for its transient first-run seconds (no spec clause;
   one-line nudge if it bothers you); gallery/project-grid cascades and
   provenance spec-plate skin (logged by 2b as unassigned polish).
6. **Pipeline-touching improvements specced, not built**: none were needed
   — no flow improvement required a pipeline change.

## 9 · What to verify before approving

Physical device: overture + scrub feel on a real phone GPU (U2), touch
double-tap/pinch (unchanged but re-worth checking), wake lock + install
nudge on iOS, print output on paper. Read before merging:
`design-language.md` §5 (motion contract + the two amendments), §13–14
(spec trace + conflicts), `flow-blueprint.md` §1–2 (journeys + the
30-capability map), `findings/phase3-verification.md` (the independent
verdict, repairs, and U-list), and the payload accounting above (§8.1) —
that is the one place this work knowingly exceeds its own spec.
