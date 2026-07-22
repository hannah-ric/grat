# Overhaul execution plan (orchestrator-owned)

Branch: `claude/blueprint-buddy-overhaul-7xx68y` (all work; never default).
Specs of record: `design-language.md` + `flow-blueprint.md`. Evidence:
`docs/overhaul/findings/` (screenshots captured, not described; fix-log lines).

## Roster & sequence

| Phase | Actor | Scope | Gate |
| --- | --- | --- | --- |
| 1 Foundation | one subagent, sequential | tokens (+`--text-billboard`, porch scaffolding tokens), new components (§4), `src/motion.js` presets + gate, build wiring for `vendor/anime.umd.min.js` + `{{JS_MOTION}}` + porch placeholders, `Drafting.elevationSVG animatable` flag, component demo verified at all six widths | build + `npm test` + smoke green |
| 2a Landing | subagent, worktree | porch markup/CSS/JS (`src/porch.js`, `src/porch.css`, template porch region), overture, chapters, calculator, entry paths, gate, `test/porch.playwright.js`, package.json `test:porch` | spec §7–§8; porch suite green |
| 2b App | subagent, worktree, parallel with 2a | `.ledger`/spec-plate/cascade/settle/count application across plan tabs, Overview drawing tile, chat/build/dialog restyles, `Motion.auto` hooks, smoke updates | spec §9 + blueprint §4; smoke green |
| 3 Verify | subagent | full walkthrough per brief (widths, capabilities, seam, state, reduced motion, perf, no hardcoded values, preset-only motion, suites) → findings; one repair pass | reject list empty or logged |
| 4 Report | orchestrator | merge, rebuild dist, final suites, report, push, draft PR | — |

## File ownership (parallel-safety contract)

| Path | Owner |
| --- | --- |
| `src/porch.js`, `src/porch.css`, `test/porch.playwright.js`, package.json script line | 2a only |
| template porch region (`<!-- PORCH:BEGIN --> … <!-- PORCH:END -->`, pre-wired empty in Phase 1) | 2a only |
| `src/styles.css`, `src/ui.js`, `test/smoke.playwright.js`, template outside porch region | 2b only |
| `src/motion.js`, `build.js`, `src/index.template.html` placeholders, `vendor/` | Phase 1 only (frozen after) |
| `src/drafting.js` (`animatable` flag only) | Phase 1 only |
| `src/engine.js` | 2a may add ≤ ~40 lines: `materializeStart()` + draft-fill scalar (porch §5.1–5.2), display-only, `stats()`-flat |
| `src/selftest.js` porch section | 2a |
| `dist/` | orchestrator only (rebuilt at merge points; agents build locally but don't commit dist) |
| `src/gallery.js`, pipeline modules (`spec/parametric/structural/plans/packing/fasteners/units/knowledge/codec/ai/hardware`), `api/`, `test/golden/`, node suites | **frozen — the fence** |

## Definition of done

1. `npm test` green; `npm run test:smoke` green (updated honestly); `test:porch` green.
2. Landing: gate matrix correct; reduced-motion static parity; skip works; CTA lands prompt-focused; frame-delta p95 ≤ 20 ms scrub sample; pre-JS document readable.
3. App: no motion outside presets (grep `anime.` appears only in motion.js; grep for raw `animate(` in ui/porch = 0); cascades one-time; no hardcoded spec values (spot grep for raw hex/ms in changed rules).
4. Every capability row (blueprint §2) walked and confirmed at 375 + 1440 minimum.
5. `stats()` flat after porch dispose; goldens byte-identical; dist rebuilt once at the end.
6. Docs synced: CLAUDE.md/AGENTS.md module lists + UI doc pointers; front-porch.md amendment note; ui docs index.
