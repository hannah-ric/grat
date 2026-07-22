# Phase 2a — LANDING (the porch): implementation notes & spec deltas

Scope shipped: the porch document (masthead/Act 0, chapters 01–04, honesty
band, Shapeshift fallback band, build-vs-buy calculator, tiered entry paths +
closing band/handover), the scroll-driven Materialization on a porch-owned
engine, the first-run Overture, the §4d gate, `enterStudio(path)`,
`test/porch.playwright.js` + `test:porch`, a selftest porch section, and the
three display-only engine additions. Verified green in this worktree:
`npm test` (unit 1253 · audit 480 · golden 6/6 · battery 50 · server 150),
`npm run test:smoke` **270/270 untouched**, `npm run test:porch` 58/58.
Evidence: `docs/overhaul/findings/landing/` (53 screenshots — masthead +
every chapter + calculator + entry at 320/375/768/1024/1440/2560 light, 1440
dark ×4, 1440 reduced-motion ×4, one mid-scrub). Refresh via
`node test/porch.playwright.js --shots` (the plain suite never writes docs).

## Payload (measure-and-report; ceiling amendment applied)

Pre-inline additions vs the Phase 1 tip (c376654), bytes:

| file | added |
| --- | --- |
| src/porch.js | 37 127 |
| src/porch.css | 14 812 |
| src/index.template.html (porch region) | 8 343 |
| src/selftest.js (porch section) | 2 551 |
| src/engine.js (display API) | 1 862 |
| src/ui.js (integration point 1) | 1 184 |
| package.json (`test:porch`) | 68 |
| **total** | **65 947 B ≈ 64.4 KiB** |

dist: 2 088 597 B (post-Phase-1 recorded) → 2 154 476 B = **+65 879 B**.
Cumulative overhaul delta vs the 1 950 845 B baseline: **+203 631 B ≈
198.9 KiB**. The orchestrator amendment (design-language §12, recorded on
main: +170 KB → **+190 KB**, porch sanctioned at its honest ~68 KB) covers
this phase; note for Phase-4 accounting that the cumulative figure already
sits ≈ 9 KiB over the amended global ceiling *before* 2b lands — roadmap #11
(font/Three subsetting) remains the real diet. A partial size pass ran
before the amendment arrived: comment condensation + template-literal
helpers (`row`/`stat`), all meaning-preserving; kept.

## Deltas from the specs (each logged, none improvised)

1. **Scroll timeline linkage** — this anime 4.5 UMD build does not drive
   `createTimeline({ autoplay: onScroll(...) })` (verified empirically:
   linked timelines never advance; standalone observer callbacks and
   time-driven timelines both work — probe scripts, scratchpad). The §6.1
   composition is therefore ONE `Motion.scrollSync` observer whose
   `onUpdate` feeds the code-owned track table (`_tracks`) driving damped
   engine goals; `Motion.timeline` drives the time-based Overture only.
   Same one-driver architecture; the engine follower still owns smoothing;
   no raw `anime.` calls in porch.js (grep-clean).
2. **`content-visibility: auto` is static-mode-only.** Its forced paint
   containment makes every chapter its own stacking context, which flattens
   the copy(z3)/canvas(z2)/H1(z1) interleave the occlusion sandwich needs —
   measured, not theorized (chapters rendered invisibly behind the stage).
   Scrub mode drops it; the phone/reduced static document keeps it.
3. **The PROVE capsule reads `anchor required`, not PROVEN.** The walnut
   nightstand's real rollup is `anchor` (F2057 open-drawer tipping → the
   wall anchor is mandatory, in the BOM). front-porch §4a assumed a PASS
   capsule; the founding rule outranks the storyboard, so the landing shows
   the engine's live verdict with the sag line beneath — the product
   honestly vetoing its own hero piece under the "Physics gets a veto."
   headline. Deliberate; do not "fix" by cherry-picking loads.
4. **Overture is the phone's** (design-language §11 row 320–879: "Overture +
   plain chapters"; ≥880 scrub rows never mention it). `shouldOverture`
   therefore returns true only for static-mode porches on motion-capable
   devices. This is also what keeps smoke's 1440 fresh-boot welcome
   assertions passing untouched. Desktop first-visitors get the same story
   as the scrub; nobody gets both (porch §2 "confined showmanship").
5. **`seenHero` suppression** — after the Overture plays, ui.js sets
   `state.prefs4.seenHero = true` *after* the `savePrefs` call, so the
   suppression is session-scoped as porch §2 asks; a later unrelated
   `savePrefs` may incidentally persist it (accepted; the alternative was
   editing `loadStarter`, outside my two integration points).
6. **Entry-path level seeding** — the literal levelSelect change path runs
   `merge()` → `commit()` → `hideWelcome()` + `hasDesign = true`, which
   contradicts §E's "welcome card is up + #heroText focused" arrival. The
   seed instead sets the select value + `prefs4.level` + `Store.savePrefs`
   — the same persisted outcome — and ui.js:~2363 already enforces
   `prefs4.level` onto every subsequently applied spec, so chat, Safety
   layers, and joinery gating follow exactly as §8 intends.
7. **Wheel at the handover** — once the closing band arms the stage
   (`data-live`), the canvas takes pointers and the wheel dollies, exactly
   as the studio viewport does ("display becomes instrument"). Page
   scrolling stays available on all band content, scrollbar, and keyboard;
   before the handover the stage is `pointer-events: none` throughout.
8. **Studio fixed overlays vs the porch** — the phone chat sheet
   (`position: fixed`) floated over the narrative; porch.css re-roots it
   with `contain: paint` on `#app` while the porch exists (plus the
   body-scroll unlock). Both rules dissolve with the porch; the instrument
   contract returns untouched. Scoped in porch.css — `styles.css` unedited.
9. **Beat washes live on the porch root**, not the stage layer (an opaque
   stage background would sit above the z1 H1 and kill the sandwich).
10. **SwiftShader timing note** — the engine's damped sim runs on a
    dt-clamped clock (0.05 s), so at software-raster frame rates the
    materialization stagger stretches ~6×. Tests snap deterministically via
    `snapNow()`; real GPUs are unaffected.

## Scrub performance (measured, SwiftShader)

The §12 budget this code owns — porch JS per scroll frame — measures
**5.6 µs/call** through the live track table (500-sample microbench of the
same `_applyP` the observer calls; budget 4 ms, ~700× headroom; zero
allocation in the apply path, numeral writes cached per-pixel). Raw rAF
deltas on this software-raster runner: rest p95 250 ms (the standing cost of
two full-height SwiftShader engines), scrub p50 200 / **p95 233 ms** —
scrubbing is *cheaper* than rest jitter, i.e. the scrub adds no long tasks.
The suite gates `scrubP95 ≤ max(34 ms, restP95 × 1.75)`, which on GPU
hardware degrades to exactly the brief's 34 ms gate; the brief's "p95 ≤
20 ms under SwiftShader" premise doesn't survive contact with SwiftShader
rasterizing 2×1440×900 — recorded honestly instead of gamed.

## Shapeshift: sanctioned static fallback shipped

The stretch §11b live morph was not attempted — the core (Materialization,
occlusion masthead, draw-in linework, calculator, gate, overture, parity
paths, suites) consumed the budget, per "do not let it endanger the core."
Shipped fallback: the "One engine. Any piece." band with three real starter
thumbnails (table/bookshelf/cabinet), rendered idle-time by a throwaway
engine (gallery precedent), each captioned with its honest pipeline part
count. The closing band's §4a "starters row" is consolidated into this band
rather than duplicated two sections apart — one starters row, entry cards +
trust line + handover + CTA close the page.

## More-menu "See the intro again": NOT wired — verifier action

The More menu lives in template-outside-porch / ui.js territory owned by 2b;
per the brief I did not fight over shared files. `BB.Porch.replay()` ships
(clears `bb.porchSeen` + sessionStorage twin, reloads). The verifier (or 2b)
should add one More menuitem calling it, e.g.
`<button role="menuitem" id="porchReplayBtn"><span>See the intro again</span><span class="hint">landing tour</span></button>`
+ `$('porchReplayBtn').onclick = () => BB.Porch.replay();` — and may hide it
when `BB.Porch` reports the porch permanently gone.

## Track table as built

Continuous props (theta/phi/distK/fill) tile p∈[0,1] from measured chapter
anchors (re-measured on porch height changes — content-visibility
materialization shifts layout; the ScrollObserver is `refresh()`ed and the
table rebuilt). Switches: draft on/off, materialize, dims, ortho (square-on
window around ch02), explode 0.14 joint-reveal in PROVE, beat classes. The
selftest asserts tiling + strict switch monotonicity on both the default
and the live table; the close pose hands over near the studio's default
framing. Poses for the static posters reuse the same table's chapter values.
