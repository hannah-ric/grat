# Phase 3 — independent verification (2026-07-22)

Verifier of record for the 2026-07 overhaul, branch
`claude/blueprint-buddy-overhaul-7xx68y` at merge state `36886cc` (Phases 1,
2a, 2b merged). Verified against `design-language.md`, `flow-blueprint.md`,
`execution-plan.md` (DoD), and the phase findings — spec, not taste. All
browser work: Playwright over the built `dist/index.html`, SwiftShader
Chromium (`/opt/pw-browsers/chromium`, `--no-sandbox
--enable-unsafe-swiftshader`), artifact-storage shim, fresh profile per
scenario. Evidence: 60 screenshots in `findings/verify/` (referenced below;
the ≤60 budget forced triage — every trimmed surface stays covered by a
numeric assertion and a neighboring width/journey capture).

## 1 · Suites (protocol step 1 — all re-run at merge state)

| Suite | Result |
| --- | --- |
| `npm test` | green — unit **1253**, audit **480**, golden **6/6**, battery **50** (18 cases), server **150**; 0 failed |
| `npm run test:smoke` | **282/282** (270 + 12 Phase-2b) |
| `npm run test:porch` | **58/58** — one full-suite rerun needed: first attempt timed out at the scroll-fraction wait (porch.playwright.js:109) with the box still at load ≈5 from the just-finished smoke run; clean on an idle box. Logged as load sensitivity (unresolved U4), not a product defect. |
| `node test/handcalc.js` | **16/16** |
| In-app diagnostics (capability 27 session) | **145/145 green** — includes the porch gate-matrix/track-table and motion sections shipped by 2a/Phase 1 (`verify/cap-27-diagnostics.jpg`) |

Re-run after the repair pass (ui.js + porch.css changed): `npm test` green
(same counts), smoke **283/283** (282 + 1 new `?`-key assertion), porch
**58/58**, handcalc 16/16. Two intermediate smoke runs on a loaded box
(concurrent verifier Chromium sessions / warm load ≈ 3–4) missed the
zero-tolerance "blueprint flip runs the one-beat ink-wash" check; an
in-page MutationObserver probe proved the product correct 5/5 (class added
on flip, held 311–421 ms, self-cleaned) — the miss is the CDP
click→evaluate roundtrip racing the 240 ms beat under SwiftShader load.
Folded into U4 with the porch-suite scroll wait.

## 2 · Cold journey walkthrough (protocol step 2)

Fresh profiles at **1440×900** and **375×812**; every station screenshotted
(`verify/j-d-*.jpg`, `verify/j-p-*.jpg`). Driver: scratchpad `journey.js`
(41 assertions, all passed, zero console errors on both journeys).

Desktop: land → porch renders complete (masthead H1, chapters
describe/draft/prove/build, honesty band, live calculator, 3 entry paths)
→ scrub drives beat states `mast→describe→draft→prove→build` with draft/dims
switches committing mid-scroll and the handover arming the stage → `#phCtaEnd`
→ studio with `#heroText` focused, welcome up, bench at top → typed
"a walnut nightstand with two drawers" → design lands via offline parser
(29 parts) → chat "See your plan →" → Plan/Overview → walked
Cut/Buy/Assemble/Safety → Build mode (desktop columns; pager correctly
phone-only) → two tasks worked (one cut + one assembly check, progress 3%)
→ exit → More → Export menu (8 items) → Share sheet (BB4 code) → Copy
("Copied ✓") → reload → project, mode+tab (plan/cut), and build progress all
restored; porch skipped on second visit → **More → "See the intro again" →
porch replays after reload** (`BB.Porch.replay` wired, `j-d-15-replay.jpg`).

Phone: overture plays first-run (`j-p-01`) → tap skips it → static-chapter
porch document, no horizontal overflow, posters render idle-time → CTA →
welcome → typed prompt → design lands → floating "See your plan" pill →
all five plan tabs → build pager (56 px controls), 2 tasks + 1 check →
More→Export + Share via More (topbar Share folds ≤560) → reload → restored;
porch and overture both skipped on second visit.

**Journey step counts, measured vs blueprint §1 targets** (user actions):

| Journey | Target | Measured |
| --- | --- | --- |
| First visit → understand product | 0 (scroll-told) | 0 — scroll only |
| Landing → studio | 1 (any CTA) | **1** |
| First visit → first design (post-CTA) | 2 | **2** (type + Design it) |
| Idea → plan | 2 (pill, or mode btn) | **1** (pill) |
| Cold → cut list (July-audit parity) | 5 | **5** (CTA·type·send·pill·Cut) |
| Revision → updated plan | 1 | **1** (chat message; live recompute + diff chips, cap 4) |
| Plan → build | 1 | **1** |
| Build step → step | 1 | **1** (Next / swipe) |
| Export | 2–3 | **2** (More → item) |
| Share → copy | 2 | **2** |

No journey exceeds its target; none regressed vs the July audit.

## 3 · Capability audit (protocol step 3 — flow-blueprint §2, 30 rows)

All 30 rows exercised at 1440; spot-checks at 375 (phone cut cards, Safety
capsules, build pager, gallery, fresh-context AI badge). Driver: scratchpad
`caps.js`. **After the repair pass: 30/30 reachable + working.** Pre-repair:
29/30 (row 29's `?` key absent — repaired, R3 below).

| # | Capability | Verdict | Evidence |
| --- | --- | --- | --- |
| 1 | Chat → design (offline parser) | WORKING | desk landed from prompt; journey D4/P4 |
| 2 | Photo → design | WORKING | real `#photoInput` change → downscaled JPEG on the wire → bench landed (injected transport, mirroring smoke) |
| 3 | Six starters w/ thumbnails | WORKING | 6 cards, 6 thumbnails (`cap-03-starters.jpg`) |
| 4 | Chat refinement + diff chips | WORKING | species change, 8 diff chips |
| 5 | Inspector | WORKING | 4 sliders + 3 seg/selects + isolate + provenance dims (`cap-05-inspector.jpg`). Note: joint why-tips + learn-links live on assembly steps (verified working there → Shop Reference opens contextually); the row's wording bundles the two surfaces — behavior matches the shipped shell, unchanged since baseline |
| 6 | 3D orbit/zoom/views/explode/dims | WORKING | drag moved θ 0.72→−0.21; F/S/T/Iso segs (front→ortho), explode range, dims toggle |
| 7 | Blueprint Mode | WORKING | `#draftToggle` → drafting + ortho (`cap-07-blueprint.jpg`) |
| 8 | Assembly playback + joint dots | WORKING | step-play → playback bar; joint-dot projection API live (`cap-08-playback.jpg`) |
| 9 | Joint Inspector | WORKING | "Pocket screws — Side apron → Leg" live scene (`cap-09-jointview.jpg`) |
| 10 | Plan Overview stats + next action | WORKING | 4 counter tiles, derived next action, drawn elevation tile, verdict spec plate |
| 11 | Cut list + provenance + phone cards | WORKING | formula popover (`cap-11-provenance.jpg`); 13 phone cards at 375 |
| 12 | Buy: optimizer, diagrams+zoom, rough mode, price editor | WORKING | 9 diagrams; zoom dialog; rough recompute (bd ft note); 62 price inputs (`cap-12-buy.jpg`) |
| 13 | BOM + fastener guarantee | WORKING | 25 BOM lines (12 hardware/fastener); `Fasteners.countFor` live; counts-match-drilling is audit-suite-enforced |
| 14 | Structural report | WORKING | 16 text capsules incl. "anchor required" (`cap-14-safety.jpg`) |
| 15 | Species compare + adopt | WORKING | 6 ledger rows; adopt walnut→hard_maple |
| 16 | Build mode | WORKING | desktop boards ×9; phone pager 56 px; progress persists (journey) |
| 17 | Exports | WORKING | 6/6 downloads (csv/json/svg/glb/rb/dae), print sheet 54 KB HTML, help dialog |
| 18 | Share BB4 + `#d=` + import gate | WORKING | BB4 code; `#d=` bypass (porch suite B); malformed import rejected |
| 19 | Projects | WORKING | rename/duplicate/delete round-trip 2→3→2 cards, thumbnails (`cap-19-projects.jpg`) |
| 20 | History | WORKING | snapshot +1, undo/redo, drawer (9 snaps), compare table + 3D ghost banner (`cap-20-history-ghost.jpg`) |
| 21 | Units/dual/precision | WORKING | mm↔in via BB.Units, dual toggle, 1/32 precision |
| 22 | Theme + render | WORKING | dark/light flip; Wood/Flat seg |
| 23 | Skill level | WORKING | select → prefs4 + spec meta.level |
| 24 | Shop Reference | WORKING | More + contextual learn-link paths; tab appears only while open (`cap-24-reference.jpg`) |
| 25 | Accounts/billing degrade | WORKING | invisible with no server config |
| 26 | AI meter + truthful badge | WORKING | fresh no-key context: "offline"; after live (injected) service: "online" — truthful both ways |
| 27 | Diagnostics | WORKING | logo long-press (`cap-27-diagnostics.jpg`); keyboard path exists (smoke M-16) |
| 28 | PWA install | WORKING | manifest + theme-color + build-complete nudge machinery |
| 29 | Accessibility bundle | WORKING (after R3) | 4 skip links; share-sheet focus trap holds Tab×12; **`?` keyboard map: absent at merge → repaired**; reduced motion §5; forced-colors §10 |
| 30 | Porch narrative + calculator + entry + overture | WORKING | journey + porch suite; calculator re-runs the real pipeline on species change ($ changes) |

## 4 · Widths (protocol step 4)

Porch (masthead+chapters+calculator, full-page) and app Overview/Cut/Build
at **320/375/768/1024/1440/2560**: `scrollWidth == innerWidth` at every
width and surface, and zero controls clipped past either viewport edge —
**48/48 assertions**. Screenshots: `verify/w-porch-<w>.jpg` (6 full-page),
`verify/w-app-*-{320,768,2560}.jpg` (extremes + tablet; 375/1440/1024
asserted numerically and covered by the journey/cap shots — triage to hold
the ≤60-image evidence budget).

## 5 · Reduced motion (protocol step 5)

Emulated `reduce`, fresh profile: porch renders `data-mode="static"` as a
complete document (4 chapters, honesty band, calculator, 3 entry cards, both
CTAs); overture absent; `Motion.on() === false`; no scroll timeline
(`_state.obs.length === 0`); counters painted final pipeline values without
rolling; typed prompt simply present. `document.getAnimations()` sample:
**0 running** — 3 entries listed, all `finished` at the .01 ms clamp with
`fill: forwards` (the Act 0 masthead draw snapping to its end state, exactly
the porch.css comment's contract). Studio surfaces: cut ledger renders
instantly (13 rows, summary strip final), overview drawing tile instantly
complete (0 dash attributes), counters final, 0 running animations. Zero
console errors. `verify/reduced-porch.jpg`, `verify/reduced-overview.jpg`.

## 6 · State survival (protocol step 6)

- Mid-journey reload at Plan/Cut: mode `plan`, tab `cut`, design (9 parts,
  cherry) all restored.
- Build progress: checked box survives exit + reload (asserted twice —
  journey D10 and the dedicated pass).
- Rotation 390×844 ↔ 844×390 at porch, plan, and build: layout reflows, no
  horizontal overflow, chapters/tab/design/checked-progress all retained,
  zero console errors (`verify/rotate-*.jpg`).

## 7 · Cohesion seam (protocol step 7 — mechanical)

Porch closing band vs studio welcome (`verify/seam-porch-close.jpg`,
`verify/seam-studio-welcome.jpg`), computed styles:

| Probe | Porch close | Studio welcome |
| --- | --- | --- |
| Display face | Fraunces 700 (`.ph-head`) | Fraunces 700 (`#welcomeTitle`) |
| Body/button face | Hanken Grotesk 550 | Hanken Grotesk 550 |
| Primary CTA | `rgb(148,41,17)` capsule `999px` | identical |
| Paper field | `rgb(241,235,221)` | identical |
| Muted voice | `rgb(111,91,76)` trust line | muted caption family |

Same tokens, same type ramp, same capsule shape, same rust accent on both
sides of the seam; the porch stage and studio viewport are the same engine
class rendering the same species materials (porch suite asserts `stats()`
flat across the handover). Cohesion bar met.

## 8 · Performance (protocol step 8 — SwiftShader-relative)

**Porch scrub** (my sampler, 1440×900; SwiftShader renders two full-height
engines in software — rest ≈ 250–400 ms/frame is the standing raster cost):

| Metric | Value |
| --- | --- |
| rest rAF p95 | 400.0 ms (13 frames / 4 s) — 3.73 longtasks/s |
| scrub rAF p50 / p95 | 266.6 / 350.0 ms (68 frames) — 4.42 longtasks/s |
| scrub vs rest | p95 **below** rest jitter → the scrub adds no long tasks of its own |
| track apply (`_applyP`) | **7.4 µs/call** (porch-suite run: 5.4 µs) vs the 4 ms §12 budget — ≈540× headroom, zero allocation |

Porch-suite gate (`scrubP95 ≤ max(34, restP95×1.75)`): passed on both runs
(300.0 ≤ 495.8; my run 350.0 ≤ 700.0). The brief's absolute "p95 ≤ 20 ms
scrub" is not measurable on software raster (unresolved U2, per the 2a
finding); on GPU hardware the same gate degrades to the 34 ms bound.

**App interaction** (Cut open, nightstand, N=40/20/40; vs phase2b table):

| Path | This run (median/p95) | Phase 2b | 2b baseline |
| --- | --- | --- | --- |
| commit (`merge`) | 10.8 / 18.8 ms | 8.6–9.1 / 13.2–15.7 | 7.1–7.3 / 10.4–10.5 |
| chat round trip | 19.2 / 27.4 ms | 15.1–18.0 / 21.9–35.8 | 13.5–14.6 / 19.1–19.7 |
| preview (drag) | **4.1 / 7.7 ms** | 4.3–4.7 / 6.1–12.4 | 4.3–4.4 / 5.7–9.4 |

Reading: preview/recompute hot path unchanged within noise (the 2b
requirement); commit/chat carry the sanctioned one-time entrance cost plus
shared-runner jitter, consistent with 2b's measurements.

**No animation on the recompute path:** `recompute()` and `preview()` start
**zero** preset animations and never re-cascade (`data-cascaded` absent on
those renders); a design `merge` fires the one-time cascade (4 running
mid-entrance, marker present), settles ≤ 760 ms, nothing loops. The single
animation observed on recompute/preview renders is the July shell's
pre-existing `.panel-inner`/`.advisory` CSS `rise` (240 ms, token-riding,
reduced-motion-killed) — predates the overhaul (present on `origin/main`),
logged by 2b for the verifier, and logged here as U3 (product call, not an
overhaul defect; the overhaul's own machinery is verified silent).

## 9 · Compliance greps (protocol step 9)

| Grep | Result |
| --- | --- |
| `anime.` outside `motion.js` | **0** (motion.js aliases the global once) |
| raw `animate(` in ui.js / porch.js | **0** |
| raw hex introduced by overhaul commits (diff-scoped, styles.css + porch.css) | **0** |
| raw ms introduced (diff-scoped) | was **3** in porch.css rules (700 ms stage drift; 900 ms + 120 ms Act 0 mark draw) → **repaired R1**: values now live only in porch-scoped token definitions (`--ph-t-drift/--ph-t-mark/--ph-t-mark-delay`), rules consume tokens; grep now clean |
| `data-motion` values | only `cascade` (×10) — in the preset set |
| `pathLength` in golden fixtures | absent; `git diff origin/main -- test/golden/` empty (byte-identical) |

Also verified: `linear` appears once in porch.js as the overture timeline's
scalar time axis (`{p:0→1}` integrated by the engine's damped follower — the
§5 architecture where timelines drive scalar goals and the follower owns
visible easing); no visible surface is eased linearly. Observation, not a
violation.

## 10 · A11y (protocol step 10)

- Focus visible tabbing through the porch (phCtaTop → phCtaHow → calc
  chips…, all with visible outline/shadow; `verify/a11y-focus-porch.jpg`).
- Skip links intact after porch dispose (`#heroText`, `#chatText`,
  `#view3d`, `#panel-main`).
- Verdict capsules always carry text ("anchor required" / "advisory" /
  "pass" observed live — never color alone).
- Contrast spot-checks on the porch washes (computed fg vs effective bg):
  honesty claim 8.41:1, honesty kicker 5.25:1, PROVE body on fern wash
  8.64:1, calc verdict 14.54:1, entry card body 9.68:1, trust line 5.39:1 —
  all ≥ AA 4.5:1.
- `?` opens the keyboard map (after repair R3; toggles, Esc closes, typing
  guard holds — `verify/a11y-keymap-question.jpg`); share-sheet focus trap
  holds Tab×12.
- Forced-colors emulation: porch fully readable, CTAs visible, 4 chapters
  (`verify/a11y-forced-colors-porch.jpg`).

## 11 · Repair pass (protocol step 11 — one pass, violations only)

| # | Violation (citation) | Repair | Commit |
| --- | --- | --- | --- |
| R1 | Raw ms in three changed porch.css rules — execution-plan DoD 3 ("no hardcoded spec values — spot grep for raw hex/ms in changed rules"), design-language §5 duration policy | Hoisted to porch-scoped duration tokens defined once on `.porch` (`--ph-t-drift: 700ms`, `--ph-t-mark: 900ms`, `--ph-t-mark-delay: 120ms`); rules consume the tokens; computed values byte-identical (verified: mark draw 0.9s/0.12s, drift 0.7s) | `149d63e` |
| R2 | Docs not synced — execution-plan DoD 6 (CLAUDE.md/AGENTS.md module lists + UI doc pointers; front-porch.md amendment note) | CLAUDE.md: `test:porch` command, motion.js/porch.js in the browser-excluded module list, anime.js on the vendor line, `BB.Motion`/porch load-bearing entries, overhaul specs added to the UI system-of-record index. AGENTS.md mirrored. front-porch.md: amendment banner pointing at design-language §6 + 2a findings | `1c69924` |
| R3 | `?` keyboard-map key absent — flow-blueprint §2 row 29 ("keyboard map (`?`)"), brief step 10 | Global keydown gains a `?` branch (typing-guarded, modifier-free) toggling the existing "Keyboard & pointer help" card (`vpHelp`); Esc path already closes it. Smoke suite gains one assertion covering it | `38d628b` |

Each repair re-verified: R1 — porch suite 58/58 + token-resolution probe;
R3 — smoke 283/283 (with the new assertion) + capability row 29 re-run
(WORKING) + typing-guard probe; R2 — docs only. Full `npm test` green after
the pass.

**Logged, not fixed** (structural/pre-existing, per brief §11):

- `.panel-inner`/`.advisory` CSS rise on recompute/preview renders (U3;
  pre-dates overhaul, B-13-audited, reduced-motion-killed).
- The porch-suite scroll-fraction wait's 10 s timeout under heavy CPU load
  (U4) — test robustness, not product.
- 2a's ten logged deltas re-confirmed as shipped behavior (overture on
  phones per §11; `content-visibility` static-mode-only; scrollSync feeding
  the code-owned track table; PROVE capsule honestly reading
  "anchor required"; Shapeshift as its sanctioned static fallback band; the
  handover wheel-dolly; seenHero session persistence nuance; ≈980 ms
  physical settle duration) — all documented spec deltas, none violations.
- Polish nit (no spec clause violated): during the phone overture the Skip
  pill overlaps the viewport toolbar's View button at 375
  (`verify/j-p-01-overture.jpg`) — transient (first run only, any tap
  dismisses), both controls remain hittable; left for a taste pass.

## 12 · Payload accounting (unresolved U1 — recorded, not dieted)

| Point | Bytes |
| --- | --- |
| Baseline dist (origin/main) | 1,950,845 |
| Merge state (36886cc, dist as committed = my rebuild, byte-identical) | 2,168,839 |
| **Overhaul delta at merge** | **+217,994 B ≈ 212.9 KiB** |
| Post-repair rebuild (R1 tokens + R3 branch, uncommitted) | 2,169,761 B (delta +218,916 ≈ 213.8 KiB) |
| Amended ceiling (design-language §12, 2026-07-21) | +190 KB (194,560 B) |
| **Over ceiling** | ≈ +22.9 KiB at merge (≈ +23.8 KiB post-repair) |

Composition: anime.js UMD 118,043 B; Phase 1 motion/components/wiring
≈ 19.7 KB; porch (2a) +65,879 B; app pass (2b) +13,863 B; merge extras
≈ 0.5 KB. The ordered diet remains roadmap #11 (font/Three subsetting) — an
orchestrator/Phase-4 accounting decision; this verifier was instructed to
record, not diet.

## 13 · Definition-of-done verdicts (execution-plan)

| DoD | Verdict |
| --- | --- |
| 1 · `npm test` + smoke + porch green | **PASS** — 1253/480/6/50/150 · 282/282 (283/283 after R3) · 58/58 |
| 2 · Landing: gate matrix, reduced-motion parity, skip, CTA→prompt focus, scrub budget, pre-JS document | **PASS** (scrub budget in its SwiftShader-relative form; absolute 20 ms gate unresolvable on software raster — U2) |
| 3 · No motion outside presets; cascades one-time; no hardcoded hex/ms | **PASS after R1** (greps clean; cascade one-time proven by marker probes + smoke) |
| 4 · Every capability row at 375 + 1440 | **PASS after R3** — 30/30 working |
| 5 · `stats()` flat after porch dispose; goldens byte-identical; dist rebuilt once at end | **PASS** (stats flat asserted in porch suite + journey theme-flip; goldens byte-identical; final dist rebuild is Phase 4's step — working tree carries the post-repair rebuild uncommitted per dist ownership) |
| 6 · Docs synced | **PASS after R2** |

## 14 · Unresolved list

| # | Item | Owner |
| --- | --- | --- |
| U1 | Payload +218,916 B ≈ 213.8 KiB (post-repair) vs +190 KB amended ceiling — ≈ 23.8 KiB over, anime's 118 KB dominant; roadmap #11 subsetting is the named diet | orchestrator / Phase 4 accounting |
| U2 | Absolute scrub p95 ≤ 20 ms (brief) unverifiable under SwiftShader; relative gates pass with huge headroom on the code-owned budget (7.4 µs vs 4 ms) | needs GPU hardware run |
| U3 | Pre-existing `.panel-inner`/`.advisory` CSS rise animates on recompute/preview renders (July shell behavior, B-13-audited) | product call, out of overhaul scope |
| U4 | Two zero-tolerance browser-suite waits are load-sensitive on shared CPU: porch.playwright.js's scroll-fraction wait (timed out once right after a smoke run) and smoke's ink-wash immediate-check (missed twice under load ≈ 3–4; product proven correct by in-page observation; green on an idle box). Consider a small tolerance window for both | test-robustness backlog |
