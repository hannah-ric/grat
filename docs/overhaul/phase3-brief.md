# Phase 3 brief — VERIFIER subagent

You are the independent verifier of the Blueprint Buddy overhaul, working on
branch `claude/blueprint-buddy-overhaul-7xx68y` in the main checkout after
Phases 1–2 merged. Authorities: `docs/overhaul/design-language.md`,
`docs/overhaul/flow-blueprint.md`, `docs/overhaul/execution-plan.md` (DoD),
plus phase findings under `docs/overhaul/findings/`. You verify against the
spec/blueprint — not taste. Rejections cite the violated section.

## Protocol
1. `npm run build`, then run ALL suites: `npm test`, `npm run test:smoke`,
   `npm run test:porch`, and `node test/handcalc.js`. Record exact counts.
   Any red = finding.
2. **Cold journey walkthrough** (Playwright, fresh profile, SwiftShader
   chromium /opt/pw-browsers/chromium, storage shim like smoke's): at 375×812
   AND 1440×900: land → porch narrative renders (masthead, four chapters,
   honesty band, calculator, entry paths) → scroll through (desktop: verify
   stage states change with scroll) → CTA → studio with #heroText focused →
   type a prompt → design lands (offline parser OK) → See your plan → walk
   Overview/Cut/Buy/Assemble/Safety → Build mode → step through 2 tasks +
   check one box → exit → More→Export menu opens → Share sheet opens/copy →
   reload → state restored (project, mode, progress) → second visit skips
   porch. Screenshot every station into docs/overhaul/findings/verify/.
3. **Capability audit**: every row of flow-blueprint §2 (30 rows) exercised
   at 1440 and spot-checked at 375. Mark reachable+working / broken /
   unreachable, with evidence path. Any broken/unreachable = REJECT finding.
4. **Widths**: porch masthead+chapters+calculator, and app
   Overview/Cut/build at 320/375/768/1024/1440/2560 — no horizontal document
   scroll (`scrollWidth==innerWidth`), no clipped controls; screenshots.
5. **Reduced motion** (emulate `reduce`): porch = static complete document,
   overture absent, counters final, studio surfaces instant end-states;
   choreography fully disabled (assert no running animations via
   `document.getAnimations().length` sample and Motion.on()===false).
6. **State survival**: mid-journey reload at Plan/Cut restores tab+design;
   build progress survives exit+reload; rotate 390×844 ↔ 844×390 at porch,
   plan, and build — layout reflows, nothing lost.
7. **Cohesion seam**: screenshot porch closing band and studio welcome
   side-by-side; confirm same tokens/type/motion voice (cite computed
   font-family/colors on representative elements — mechanical check, not
   taste).
8. **Performance**: automated porch scrub → rAF-delta p95 (record; flag
   >34 ms SwiftShader); app interaction: chat-recompute with Cut open —
   compare against `git stash`-free baseline via the timings recorded in
   phase2b findings (re-measure post-merge); confirm no animation runs
   during recompute (instrument via getAnimations during commit).
9. **Compliance greps**: `anime.` outside motion.js = 0; raw hex colors /
   raw ms durations introduced by overhaul commits (diff-scoped grep) = 0
   outside token definitions; `data-motion` values all in the preset set;
   `pathLength` absent from golden fixtures (`git diff origin/main --
   test/golden/` empty).
10. **A11y**: axe-free manual checks — focus visible through porch CTAs and
    studio journey (tab through masthead→CTA), skip links intact, verdict
    capsules carry text, contrast spot-checks on porch washes (computed
    styles vs AA), `?` help opens, forced-colors smoke (emulate) porch
    readable.
11. **Repair pass**: fix ONLY clear spec/blueprint violations you found
    (cite section per fix; commit per fix with the standard trailer;
    re-run affected suites). Structural disagreements or taste = log, don't
    fix. One pass. Anything still failing after it = unresolved list.

## Output
`docs/overhaul/findings/phase3-verification.md`: verdict per DoD item
(execution-plan §Definition of done), the capability table with 30
verdicts, journey step counts measured vs blueprint targets, suite counts,
perf numbers, rejected findings + repairs (commit SHAs), unresolved list.
Screenshots referenced by path. Commit your findings + screenshots (named
adds, no dist, standard trailer). Final message: verdict summary + counts +
unresolved + SHAs.