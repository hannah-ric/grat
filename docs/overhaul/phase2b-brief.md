# Phase 2b brief — APP subagent (studio surfaces)

You are executing the overhaul across Blueprint Buddy's app surfaces in an
isolated git worktree. Read first, in order — complete authority, no
re-derivation: `docs/overhaul/design-language.md` (§1 kicker voice, §4
components, §5 motion presets + APP FUNCTIONAL LIMITS, §9
engineering-as-aesthetic treatments, §10 voice, §11 breakpoints),
`docs/overhaul/flow-blueprint.md` (§1 journeys — every app step count stays
EQUAL, §4 rebuild-vs-restyle ledger, §5 test contract),
`docs/overhaul/execution-plan.md` (ownership),
`docs/overhaul/findings/phase1-notes.md` (motion API as shipped), `CLAUDE.md`.

## You own (write nothing else)
`src/ui.js` · `src/styles.css` (app rules; Phase-1 component/token blocks are
consumed, extended only if a treatment genuinely needs a new shared rule) ·
`src/index.template.html` OUTSIDE the PORCH region · `test/smoke.playwright.js`
(honest updates only, documented per edit) · findings
`docs/overhaul/findings/phase2b-notes.md` + screenshots under
`docs/overhaul/findings/app/`.

**The fence (absolute):** no edits to ai.js, spec.js, parametric.js,
structural.js, plans.js, packing.js, fasteners.js, units.js, knowledge.js,
codec.js, hardware.js, gallery.js, drafting.js, engine.js, motion.js,
porch.js, porch.css, build.js, api/, test/golden/. Presentation of pipeline
outputs is yours; their computation is not. No behavior/capability may be
removed — flow-blueprint §2 lists 29 app capabilities that must all still
work; step counts stay equal (§1).

## The treatments to apply (design-language §9; composition, not invention)

1. **Cut list = the flagship instrument.** `.ledger` treatment on the Cut
   tab (desktop table + phone cards): kicker head band ("CUT LIST · every
   part, ready for the saw"), `Motion.rule` drawn top rule, mono summary
   strip (`N parts · N boards · total board feet` — compute from the
   existing plan/packing state already in `state`, format via `BB.Units`)
   with `Motion.count` on first render of a given design, one-time
   `Motion.cascade` on rows. Cascade fires when the user opens the tab or
   the design identity changes — never on recomputes of the same view
   (track a render key). Same `.ledger` voice on Buy (stock plan + BOM) and
   the species-compare table.
2. **Overview = the drafting cover sheet.** Keep the four stat tiles +
   next-action (existing derivation untouched); tiles become `.counter`s
   (count once per design change); add one **drawing tile**: a small front
   elevation via `BB.Drafting.elevationSVG(state.model, state.spec,
   {animatable:true})`, drawn in with `Motion.draw` once per design change,
   static thereafter (and instantly complete under reduced motion). Spec-
   plate treatment for the safety line (verdict capsule `Motion.settle` on
   first appearance per design).
3. **Safety.** Verdict capsules settle on first render; fix-cards
   `Motion.reveal`; beginner-first layering and all copy behavior unchanged.
4. **Assemble.** Step list gets one-time cascade; step cards `.ledger`
   voice; playback surfaces untouched behaviorally.
5. **Chat.** Bot notes keep their card; diff cards get `.kicker` head +
   chips cascade (≤360 ms); "See your plan" pill gets `Motion.pop`; plan
   mode-segment glints (a one-shot `Motion.pop` on the segment dot) when
   fresh results land while in Design mode. Send/busy states untouched.
6. **Build mode.** Feedback only: check toggles `Motion.pop`, task/step
   transitions `Motion.reveal` (≤240 ms, interruptible); arm's-length
   legibility floors and pager behavior untouchable.
7. **Dialogs/drawers/menus/welcome.** Entrance `Motion.reveal` where a CSS
   transition doesn't already do the job — do NOT double-animate; where CSS
   already animates an entrance, leave it (CSS micro-states remain CSS per
   §5). Welcome card copy per voice §10 if any strings read off-voice.
8. **Empty/loading/error states.** Voice pass per §10 (name the next
   action); no new mechanisms.
9. **`Motion.auto(root)`** may be used via `data-motion` attributes in
   generated markup where it keeps renderers declarative — prefer it over
   imperative calls inside render functions.

## Hard limits (defects if violated)
- All motion through `BB.Motion` presets — zero raw `anime.` calls in
  ui.js; zero new keyframes/transition values outside tokens; grep-clean.
- App motion ≤ `--t-med` except one-time cascades (≤360 ms total); only
  transform/opacity (+ SVG stroke via presets); everything interruptible;
  nothing blocks input; nothing loops; nothing animates during recompute
  paths (commit()/preview() hot paths must not allocate animations).
- Reduced motion: presets self-gate — verify surfaces render complete end
  states instantly under emulation.
- No hardcoded spec values: colors/durations/radii/sizes ride tokens.
- AA contrast holds (existing token pairs only); tap floors ≥44px keep;
  text floors keep; `scrollWidth == innerWidth` at every width.

## Tests
`test/smoke.playwright.js` stays green with honest updates only — selector
updates where markup changed, plus NEW assertions: ledger head present on
Cut; Overview drawing tile SVG present with pathLength shapes completed
(reduced-motion run) ; cascade one-time key behavior (open Cut twice →
second render does not re-stagger: assert via a `data-cascaded` marker or
equivalent); reduced-motion end-state instantness on one representative
surface; zero console errors remains. Document every changed assertion in
your findings file with why. `npm test` (node suites) must pass untouched.

## Verification & evidence
`npm run build` + `npm test` + `npm run test:smoke` green in your worktree.
Screenshots into docs/overhaul/findings/app/: Overview, Cut, Buy, Safety,
Assemble, chat-with-diff, build phone + desktop, welcome — at
320/375/768/1024/1440/2560 for Cut + Overview (the flagships), and at
375+1440 for the rest; 1440 dark for Overview/Cut/build; one reduced-motion
1440 Cut. Interaction responsiveness: measure (Performance API or timestamp
around commit) that a chat-driven recompute with the Cut tab open does not
regress vs baseline by more than noise — record numbers. Findings file:
what shipped vs spec per surface, every smoke edit + reason, cascade
render-key design, measured recompute timings, anything logged-not-built.

## Ways of working
Commits grouped by surface referencing spec sections; never `git add -A`;
never commit dist/ or node_modules; end every commit message with:

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01BdGWdPcJuzi3MotsS2tbcJ

Do not push. Final message: commit SHAs + branch/worktree path, suite
counts, screenshot paths, findings path, timings. A flow/structure problem
outside this brief: LOG it and continue — never improvise a flow change.