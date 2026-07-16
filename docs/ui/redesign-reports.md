# Blueprint Buddy redesign — phase reports

Working log for the 2026-07 interface redesign ("Modern Workshop / 1974 Showroom").
Each phase appends its honest report here: what changed, what was verified and how,
what was skipped or impossible, and where the redesign prompt disagreed with reality.
The engineering pipeline (spec → parametric → structural → plans → packing) is
out of scope and untouched throughout.

---

## Phase 0 — audit and inventory (no changes)

Date: 2026-07-16 · baseline: `npm run build` clean, `npm test` 40/40 green.

### File ownership (verified by reading, not assumed)

| Surface | Actual owner |
| --- | --- |
| Shell markup | `src/index.template.html` (static; placeholders inlined by `build.js`) |
| All DOM wiring, tabs, chat, build mode, modals | `src/ui.js` (2 855 lines, one IIFE) |
| Styling + tokens | `src/styles.css` (1 222 lines) |
| Icon set | `src/icons.js` — `BB.Icons`, 13 stroke paths + 1 filled; applied to chrome at runtime by `ui.js applyIcons()` |
| 3D scene, themes, selection | `src/engine.js` (`BB.Engine`) |
| Joint close-up 3D | `src/jointview.js` + `src/joinery3d.js` |
| AI transports + offline parser | `src/ai.js` (`hasRemote()`, `supportsImages()` exist) |
| Plan views (six tab renderers) | `ui.js` `renderCut/renderStock/renderBom/renderAssembly/renderIntegrity/renderReference` |
| Cutting-diagram SVGs | `src/packing.js` `boardSVG`/`sheetSVG` (presentation functions co-located with protected packing math `pack1D/pack2D/planStock`) |
| Drawing sheet | `src/drafting.js` |

All prompt-referenced files exist. `blueprint-buddy.jsx` is reference-only (not built).

### Navigation model (actual)

- Six peer plan tabs: **Cut list · Stock · Materials · Assembly · Integrity (dot) · Shop reference** (`#tab-cut/stock/bom/assembly/integrity/reference`) — matches the review's claim.
- Top bar: brand · design-name input · save state · readiness strip (Design→Validate→Plans→Build) · undo/redo · **More ▾** menu (History/Projects/Starters/Share + Units/Precision/Theme/Render rows) · **Export ▾** menu (9 items) · **Build mode** CTA.
- Layout: left chat column (mobile: bottom sheet with drag physics), stage = 3D viewport / draggable splitter / tab bar / panel. Hash carries `#tab;split=N;chat=0|1`.

### Typography (actual values)

- Body: fixed `15px/1.5` system stack (not fluid; below the 16px floor).
- Bitter (`--display`) already reserved for headings/brand/verdict-ish text. Mono stack with `tabular-nums` for machine numbers — already policy.
- Chrome sizes: buttons 13.5px (small 12.5px), tabs 13.5px, tables 13.5px (numeric cells 12.5px, headers 11.5px uppercase), chat bubbles 14px, many 10.5–12.5px labels.
- Build mode is already fluid via `clamp()` (title 20→30px, checks 16→20px, dims 14→17px).
- No `--text-*` / fluid `--space-*` tokens in the app stylesheet yet; the full system exists in `docs/ui/brand-system.md` §3–4 with an explicit adoption bridge (§7) that names this exact work.

### Color tokens (actual)

- **The Showroom palette swap already happened** (July 16, PR #21, audit item B1): `:root` holds rust `--accent #942911`, mustard `--focus/--amber #9D8420`, walnut ink/surfaces, warm shadows, dark scheme = walnut den, `data-theme` overrides mirror both schemes. CSS has no machinist blue outside `--blueprint-*`.
- `--seafoam #94B9AF` / `--fern #90A583` are **defined but never used** in any rule.
- Not yet adopted from the bridge: fluid type scale, fluid space scale, shape tokens (4/10/18/pill), stamp rotation, mustard double rules, capsule buttons.

### 3D selection colors — review claim CONFIRMED

`src/engine.js` still selects/hovers in machinist blue: `edgeSel: 0x2f7fae` (light) / `0x6fb0d6` (dark) at lines 64/69, `selEdgeMat`/`hoverEdgeMat` `0x2f7fae` (235–236), fresnel `rimColor 0x2f7fae` (191), playback joint dots `0x2f7fae` (535). Cool fill light `0xdfe8ff` (95). Blueprint-mode blues (`DRAFT`, `0x1b5d82` family) are the deliberate cyanotype exception and stay.

### July 15 audit fixes — current state (checked in code)

All P0–P3 fixes from `docs/ui/diy-audit-fix-report.md` are present in the current source, including:

- **N1 mobile Build-mode title wrapping: FIXED in code** (`styles.css` ≤880px block keeps `.bm-name` word-wrapping with a 12rem floor; the old `overflow-wrap:anywhere` letter-stack is gone). Fix report cites live measurement 260×30 (was 16×600). *Present; visually re-verified in a later phase.*
- N1b/N4 diagram tap-to-zoom lightbox; N2 phone header (BB short brand, Export folded into More ≤560px); N3 mobile readiness dots; N5 browser skips direct Anthropic + offline caveat chip; N6 export menu order; N7 starter coach message; N8 theme-color + inline manifest; B2 welcome-card SVGs; B4 ≥40px viewport touch targets; B5 advisory collapse pill; B7 beginner-first integrity summary; B12 sticky table headers.

None of these are re-fixed in this redesign; they are built upon.

### Emoji / Unicode symbol inventory (exact locations)

| Location | Glyphs | Note |
| --- | --- | --- |
| `ui.js:282,292` | 🛑 ⚠️ | advisory pill + per-advisory icon — real emoji, to replace |
| `gallery.js STARTERS` | 🍽 💻 🪑 📚 🌙 🗄 | starter-card fallbacks until idle 3D thumbnails paint |
| `ui.js:1688` | ▦ | empty project thumbnail |
| `ui.js:214` | ● | account avatar fallback |
| `ui.js:370` | ✕ | provenance close (dynamic) |
| `index.template.html` `#welcomeClose` | ✕ | not covered by `applyIcons()` |
| `ui.js:1940,1950` | ✓ | build-mode check glyphs |
| `ui.js:2024` | ▶ | build-mode step play (the assembly-tab equivalent already uses `BB.Icons`) |
| `ui.js:2200 / 1845 / 1030` | › / → / … | readiness separator, species column affordance, busy send |
| template chrome | ↶ ↷ ▾ ✕ ⤢ ‹ › ↺ ⇄ | replaced at runtime by `applyIcons()`; visible only pre-boot |
| `ui.js:674,943-944` | ●○ | strength/difficulty ratings — deliberate rating dots, kept |

### AI connection state (for the truthful badge)

`AI.hasRemote()` is optimistic until the first send (`proxyDead` flips on first 404/405/503). A zero-token truthful probe exists: `POST /api/chat {}` → **503** = proxy present, no key; **400** = proxy present and configured (key check precedes body validation in `api/chat.js`); **404/405** = no proxy → check `window.claude.complete`. No persistent badge exists today; offline is surfaced per-message via a caveat chip.

### Offline / PWA (actual)

Inline data-URI manifest + `theme-color` exist (N8). **No service worker anywhere.** True offline reload and a rich install prompt would require a second shipped file, which conflicts with the founding "one self-contained file" rule — flagged for Phase 4 as a boundary, not silently violated.

### Test coupling that constrains the redesign

- `test/smoke.playwright.js` (189 assertions) clicks `#tab-cut/stock/assembly/integrity/reference`, `#exportMenu`, `#viewportWrap`, `#chatPanel`, etc. IA changes must keep these IDs working or update the suite honestly.
- `src/selftest.js` ships in-app assertions (e.g. `BB.Icons.svg('undo')` contains `currentColor`).
- `test/golden/` + physics suites don't touch presentation, but `npm test` must stay green each phase.

### Prompt-vs-reality conflicts (recorded per ground rule 1)

1. **"Complete the design-token migration"** — the *palette* migration is already done (PR #21). What remains from the documented bridge is fluid type/space, shape/motion signatures, and seafoam/fern actually being used. Phase 1 therefore completes the bridge's steps 2–3, not the color swap.
2. **Mobile Build-title wrapping** — already fixed; treated as "present, visual re-verification pending", not re-fixed.
3. **Welcome screen** — current treatment is a compact three-path card ("Where should we start?"), not the described hero; the live 3D model behind it already exists (seed table on boot), which is the foundation the hero needs.
4. **Icons** — a single drafting-instrument SVG family already exists and covers most chrome; the "mixed icon styles" are localized to the advisory emoji, gallery fallbacks, and a few stray glyphs (table above).
5. **Chat diff presentation** — change chips (dimension diffs) already exist after AI edits; "diff cards" are an upgrade of an existing mechanism, not new.
6. **Assembly animation, joint inspector, blueprint ink-wash** — all exist (playback bar, `#jointScrim` + `BB.JointView`, `inkwash` keyframes) and are preserved.
7. **"packing.js owns diagram presentation"** — confirmed: `boardSVG`/`sheetSVG` live there next to protected math; only those two functions are presentation.
8. **Six-tab names** — exactly as the review guessed: Cut list, Stock, Materials, Assembly, Integrity, Shop reference.

Nothing in the prompt referenced a file or feature that does not exist.
