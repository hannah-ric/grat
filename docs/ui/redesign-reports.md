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

---

## Phase 1 — visual foundation

Date: 2026-07-16 · `npm test` 40/40 · `npm run test:smoke` 189/189 · build 1 538 KB.

### Files changed and the specific edits

- **`src/styles.css`**
  - Token system extended with the brand-system §3–4 scales: `--text-xs…-4xl` + `--text-hero` (40→64px, the prompt's hero range), additive `--leading-*`, `--measure: 66ch`, fluid `--space-3xs…-2xl`; the legacy `--s1…--s7` now **alias** the nearest fluid step so every existing rule scales without a rewrite. Shape tokens `--radius-s/m/l/pill` (4/10/18/999); `--tap: 44px`.
  - Body: fixed `15px/1.5` → `var(--text-m)` (16→18px fluid) with additive leading.
  - ~150 declarations swept from raw px to tokens: buttons/tabs/chips/tables/captions/labels → ≥`--text-s` (14→15); panel headings → `--text-xl` (23→32, prompt range 24–32 at the 1440 end, 23 at the 360 end — see conflicts); modal `h2` → `--text-xl`; ledes and long text get `max-width: var(--measure)`.
  - All inputs (`textarea`, design name, steppers, selects, price fields) ≥ `--text-m` = 16px — also removes the iOS focus-zoom jump.
  - Component primitives: `.btn` is now a **capsule** with `min-height: var(--tap)`; `.btn.small` is the inline tier (32px, 40px under coarse pointers); `.chip`/`.kind-tag`/`code.inline` → 4px drafting radius; cards (`.gallery-card`, `.check-card`, `.stock-board`, `.snap`, `.project-card`, `.help-block`, `.step-item`, `.table-scroll`, `.advisory`…) → 10px; dialogs/menus stay 18px (`--radius-lg` alias moved 16→18). `.stamp` → 14px + `rotate(-1.2deg)`. `.panel h3` gets the mustard 3px double rule.
  - Accessibility blocks appended: `prefers-contrast: more` (hairlines 55% ink, rules full ink, muted promoted — `:root, :root[data-theme]` so explicit themes are also hardened) and `forced-colors: active` (color-is-content elements opt out; buttons/tabs keep borders).
  - Mobile: topbar icon buttons 40px min-width ≤880; ≤400px drops the brand mono­gram and menu carets so the header fits 320px; gallery skeleton styles; ready-sep is now a CSS dot.
- **`src/engine.js`** — selection unified to Showroom: `THEMES.light.edgeSel 0x2f7fae → 0x447e6e` (seafoam deepened for ink duty), `THEMES.dark.edgeSel 0x6fb0d6 → 0x94b9af` (raw seafoam), new per-theme `joint` slot (`0x942911` light / `0xe47952` dark) so playback joint dots speak rust (action) instead of selection blue; initial `rimColor`/`selEdgeMat`/`hoverEdgeMat`/`jointMat` constants re-inked; `applyInkColors()` routes `jointMat` from `th.joint`. Blueprint `DRAFT` palette untouched (the deliberate blue).
- **`src/icons.js`** — five new drafting-style paths: `warn`, `stop`, `check`, `user`, `arrow`.
- **`src/ui.js`** — every emoji/stray glyph replaced with `BB.Icons`: advisory pill + per-advisory icon (was 🛑/⚠️), account avatar fallback (●), provenance close (✕), project empty thumb (▦), build checkboxes (✓ ×2), build step play (▶), species column (→), dynamic diagram-scrim close (✕); readiness separator is an empty styled span (was ›); gallery cards use a `g-fallback` skeleton (board icon on a dashed sheet) instead of emoji, and the thumbnail pass swaps `.g-fallback`; 15 inline sub-14px styles → `var(--text-s)`; `applyIcons()` also covers `welcomeClose`.
- **`src/gallery.js`** — the six now-unconsumed `emoji:` fields removed from STARTERS (data cleanup, no behavior).
- **`src/index.template.html`** — 17 pre-boot Unicode glyphs stripped (↶ ↷ ▾ ✕ ⤢ ‹ › ↺ ⇄, "⤢ Fit" copy); `w-emoji` class renamed `w-icon`.
- **`test/smoke.playwright.js`** — two header-height assertions updated from the old design's 58/56px to the redesign's specified 56–64px app bar (measured: 61px desktop, 57px phone). This is the only test change; reason documented here.

### Verified working (and how)

- `npm test` 40/40; **`npm run test:smoke` 189/189** after the threshold update.
- Playwright verification script (scratchpad, headless Chromium against `dist/`):
  - **Contrast, light/dark** (WCAG 2.2 ratios computed from resolved tokens): ink/paper **14.77 / 15.31**, ink-2/paper 9.17 / 9.61, muted/panel 5.19 / 5.13, CTA ink/rust **7.61 / 6.05**, link/paper 7.26 / 8.55, advisory 5.49 / 7.78, error 9.25 / 6.62, save-green 6.35 / 9.06, focus vs paper **3.26 / 8.55** (≥3:1 non-text), on-brand on seafoam 7.94, on fern 6.39, rust tab text on panel 7.85 / 5.77. All pass AA (text ≥4.5, non-text ≥3).
  - **Text floor**: full text-node sweep at 1440px — every visible element ≥14px except `.snap-source` (13px), a deliberate supplementary badge (see policy below).
  - **Touch targets**: all `.btn:not(.small)`, tabs, send, Build CTA ≥44px by `offsetHeight`. (First sweep flagged three at "43px" — false positives from closed-state `scale(.985)` menu/modal transforms; re-measured with `offsetHeight` = 44. `#photoBtn` was genuinely 42px from an old override — fixed.)
  - **No horizontal document scroll at 320 / 360 / 390 / 430** (`scrollWidth == innerWidth`). The first sweep caught real overflow (410px topbar at ≤390) introduced by the 44px buttons — fixed via mobile icon compaction, then re-verified.
  - Screenshots (desktop light/dark, phone 320/390) reviewed: capsule buttons, rust CTA, mustard double rules, walnut dark mode, SVG welcome icons all render as intended.

### Policy decision (documented, per the 14px rule)

`--text-xs` (12→13px) is retained **only** for supplementary uppercase badges/kickers whose information is duplicated or purely taxonomic: `.snap-source` (revision source tag beside the full title), `.kind-tag`, `.price-group` header, `.diag-group` header, provenance kickers, `.integrity-disclaimer`, `kbd` key caps, menu-item hints were promoted to 14 anyway. Everything a builder must read — dimensions, tables incl. headers, buttons, chips, captions, stamps (now 14px), labels — sits at ≥14px effective. Print stylesheet sizes (10–12px) are untouched: paper, not screen.

### Not done / deferred

- Chat placeholder still wraps in the narrow column — clipped to one clean ellipsis line for now; the Phase 3 composer redesign owns the real fix.
- Warm 3D *lighting* (cool `0xdfe8ff` fill light in engine + jointview) deferred to Phase 5 per the prompt's phase split ("warm 3D lighting and selection" is Phase 5; selection done now).
- `--seafoam`/`--fern` CSS tokens now have 3D counterparts but still few CSS consumers; Phase 2/3 surfaces (selection washes, success states) will consume them.
- Gallery thumbnails cached from before the selection-color change may show the old blue rim if a part was selected when snapped — cache key hashes specs only. Not worth a cache bust; thumbnails regenerate when starters change.

### Prompt-vs-reality notes for this phase

- "Panel headings: 24 to 32px": the shared fluid scale gives 23→32px (`--text-xl`); at 360px wide it renders 23px, 1px under the prompt's lower bound, in exchange for one coherent modular scale (the brand-system ramp). Accepted as the closest on-scale step.
- The two smoke-test header assertions encoded the pre-redesign 50px bar; the redesign prompt itself specifies 56–64px, so the assertions were updated to the new spec rather than shrinking controls below the 44px floor.

---

## Phase 2 — simplify the shell

Date: 2026-07-16 · `npm test` 40/40 · `npm run test:smoke` **195/195** (189 before; six new assertions cover the new surfaces) · build 1 552 KB.

### Files changed and the specific edits

- **`src/index.template.html`**
  - Top bar rebuilt: brand + project name + save state left; **mode nav** center (`#modeNav`: Design · Plan · Build segments, Build filled rust as the CTA, each segment carrying a derived state dot); undo/redo; one **More** menu; **Share** as the visible companion strong action. The standalone Export button/menu is gone — its nine items live in More under an "Export" group label (`#moreExportGroup`); "Shop reference" joins More (`#referenceBtn`).
  - Plan sub-nav: **Overview · Cut · Buy · Materials · Assemble · Safety** (`#tab-overview` new; `tab-stock` relabeled "Buy", `tab-assembly` "Assemble", `tab-integrity` "Safety" — element IDs and state keys unchanged). `#tab-reference` remains in the DOM but `hidden` unless active — reference is a contextual door, not a peer destination.
  - Welcome overlay rebuilt as the **first-run hero**: "What are you building?" (`--text-hero`, Bitter) over the live model, a real prompt field (`#heroText` + "Design it") that feeds the normal chat pipeline, three secondary paths (Upload a photo / Browse starters / Open a saved design), and `#heroStarters` — three starter cards using the same idle-rendered 3D thumbnails as the gallery (skeleton placeholders until they land; no fabricated imagery).
  - Chat head: mobile readiness dots replaced by the persistent **AI badge** (`#aiBadge`).
- **`src/ui.js`**
  - New mode model: `state.mode` (design/plan) + `setMode()`; `body[data-mode]` drives layout; Build remains the full-screen layer and takes `aria-current` while open. `selectTab()` pulls the app into Plan mode; `renderReadiness()` now paints the three mode segments (states derived exactly as before: design done, plan fail/attn/done from integrity+stock, build from progress).
  - Hash: `#design` is a first-class location; `#cut/#stock/…` imply Plan mode; deep links and reload restore both (smoke-verified).
  - `renderOverview()`: four stat cards (parts, boards, cost, Safety stamp) read straight from computed state + ONE derived next action (fix safety → keep building → open cut list).
  - AI badge: `setAIState()` + `probeAI()` — a zero-token truthful probe (`POST /api/chat {}` → 400 = configured, 503 = no key, 404/405 → check `window.claude`), re-probed on online/offline events, and overwritten by the observed result of every real send (`out.local` ⇒ offline). No optimistic states.
  - Reference conversion: More-menu entry; global `[data-reflink]` delegation; "Learn why" links added to joint why-tips (→ joinery, prefilled query) and the seasonal-movement row (→ wood). Arrow-key/bracket tab cycling skips the hidden reference tab.
  - Hero bindings (`heroSubmit` via Enter or button, photo path, starter loads through a factored `loadStarter()` also used by the gallery); `patchGalleryThumbs` also fills hero cards; welcome copy updated ("Buy tab", "Safety tab").
  - Removed: export-menu bindings, `moreExportMirror` cloning, `welcomeDescribe`/readiness-strip code.
- **`src/styles.css`** — mode-nav segmented capsule + state dots; `body[data-mode]` visibility rules (Design: tabs/panel/splitter hidden, viewport full-bleed; Plan: the existing split view — the prompt's "plan sits beneath the canvas" reading, which also keeps the splitter feature and its tests alive); hero styles (`--text-hero` title, large prompt, starter grid); AI-badge states (checking pulse / fern online / mustard offline); overview cards; `.learn-link`; `.share-cta`; menu group label; phone ladder reworked (dots-only Design/Plan segments ≤880, Share→More ≤560, brand monogram out ≤560, redo out ≤400, tighter paddings ≤360).
- **`test/smoke.playwright.js`** — updated to the new IA where the old one was encoded, adding six assertions net: first run opens in Design mode with hero field + three hero starters; explicit `#mode-plan` entry before tab clicks; reference opens via the More menu and its tab appears only while open; menu keyboard tests moved from Export to More; Share focus-trap test uses the top-bar button; readiness-strip block became the mode-nav block (3 segments, Design-mode hash, Build aria-current + attn progress); mobile assertion checks the Build segment keeps its label; AI badge asserted `offline` under the test server (which has no `/api/chat`).

### Verified working (and how)

- `npm test` 40/40; **`npm run test:smoke` 195/195** — including the new hero, mode-nav, deep-link, reference-door, and AI-badge assertions, plus all pre-existing behavior (playback, joint inspector, projects, share codes, species compare, diagnostics).
- Screenshots reviewed at 1440px (hero with three real rendered thumbnails; Plan mode showing Overview dashboard: 24 parts / 9 boards / $384 / ADVISORY stamp + next action) and 390px (hero fits, single-row header, Build labeled).
- No horizontal document scroll at 320/360/390/430 in BOTH modes (scripted check after a regression was caught and fixed — the first mode-nav cut overflowed phones at 402px).
- AI badge truthfulness: file:// and test-server sessions show "Offline · basic edits" (no proxy), matching reality; the probe logic distinguishes configured (400) from unconfigured (503) proxies without spending tokens. The 400-status probe semantics were verified against `api/chat.js` source (key check precedes body validation).

### Trade-offs and deferred items

- **Redo hidden ≤400px** (undo stays; Ctrl+Shift+Z still works) — the 320px budget with 44/40px targets forced a choice; documented here.
- Plan mode keeps the user's split (viewport strip above plans) rather than hiding the canvas; the prompt allowed either ("beneath or replaces").
- Chat placeholder is still static ("Describe a change…"); dynamic placeholder + composer redesign is Phase 3 per the prompt.
- The AI badge lives in the chat head, so on phones it is visible only when the chat sheet is expanded; per-message offline caveat chips still cover collapsed use. A topbar badge would not fit the 320px budget.
- Materials remains a separate sub-tab this phase; it merges into Buy in Phase 3 ("relocated, not deleted").

### Prompt-vs-reality notes

- "Move camera presets, explode, and secondary controls into a single View popover" is listed under the 3D viewport section — deliberately deferred to Phase 3/5 (the toolbar was already consolidated to one control card and passes the compactness assertions; a View popover is a further step, tracked).
- The smoke suite encoded the old shell throughout (six-tab peer nav, top-level Export, readiness strip); those blocks were rewritten to the new IA rather than deleted, keeping equivalent coverage — this is the "update tests honestly" path, all documented above.

---

## Phase 3 — core surfaces

Date: 2026-07-16 · `npm test` 40/40 · `npm run test:smoke` **204/204** (nine net-new assertions) · build 1 561 KB.

### Files changed and the specific edits

- **Chat (`src/ui.js`, `src/styles.css`)**
  - Dynamic placeholder, derived not stored: "Describe your piece…" until a design exists, "Ask for a change…" after (`updateChatPlaceholder()` rides `renderTopbar`).
  - Diff presentation: change chips now render inside a **diff card** — a bordered note headed "Changed" with each computed chip as a ledger row (chip markup and text untouched, so the code-computed diff strings and their tests are unchanged).
  - Bot replies restyled as **workshop notes**: paper card, mustard spine, drafting-crisp corner — no more generic gray bubbles.
  - **Offline material chips**: when the built-in parser handles a message but nothing changed, the reply offers four tappable species buttons ("Offline, I follow sizes, drawers, and wood species best") instead of a dead end. Honest failure states ("couldn't apply", "unbuildable") were already present and stay.
  - Mobile chat peek shows only the reply sentence, never the diff ledger squeezed into one line.
- **Safety (`renderIntegrity` → beginner-first)**
  - Every level now leads with the stamp + one plain sentence ("This design passes the required strength checks." / "…does not yet pass — fix it before you build.").
  - **Failing checks surface above the fold for everyone**, with their one-tap fixes. For beginners the surfaced card speaks builder ("This part would not safely carry its expected load…"), with **zero creep/ΔMC jargon — enforced by a smoke assertion**; the engine's full explanation, exact values, thresholds, and factors live in "See engineering details" (closed by default for beginners, open for intermediate/advanced). This replaces the audit-B7 arrangement where the full report opened by default so fixes stayed reachable — fixes now live above the fold instead. (First cut of this phase still leaked "×2 creep" into the beginner card via the engine explain text; caught in the screenshot review, fixed, and the smoke check that had computed-but-not-asserted jargon-freedom now asserts it.)
- **Materials merged into Buy** (relocated, not deleted): the Buy tab renders the stock plan and then the full bill of materials ("Materials & cost"), same renderers; `#tab-bom` removed; `#bom` deep links map to Buy; the Overview cost card points at Buy; unit-sweep tests updated to the five-tab list. Species compare, price editor, and every BOM behavior ride along unchanged (price-edit tests still pass untouched).
- **Mobile cut-list cards**: ≤880px the Cut tab renders cards (name, ×qty, L×W×T in mono, material · note) with **"Why this length?"** opening the same provenance dialog as the desktop table's tappable dimensions. Desktop keeps the table. Breakpoint crossings re-render the panel live.
- **Contextual part inspector**: now a right-side drawer under the viewport toolbar (was a top-left card), slide-in on selection only — CSS repositioning, all behavior intact.
- **Share sheet** (`index.template.html`, `ui.js`): one sheet now carries **code + link + exports** — the BB4 code block; a **share link** (`#d=<code>` — the whole design rides the URL, no server, imported through the exact same validation gate as a pasted code, after which the app takes the hash back); honest fallback copy when running from `file://` (no shareable origin); and quick actions for the two most shop-relevant exports (3D/AR `.glb`, Print). Only formats the app actually supports appear; the full list stays in More → Export.
- Legacy hash `#bom` and all previous deep links keep working.

### Verified working (and how)

- `npm test` 40/40 · **`npm run test:smoke` 204/204**, including nine new end-to-end assertions: placeholder before/after design, beginner Safety shape (plain lead + closed details + surfaced fixes + jargon-free first layer), intermediate details-open default, share-link hash import round-trip, phone cut-cards replacing the table, and phone provenance via "Why this length?".
- Screenshots reviewed: beginner Safety (FAIL stamp + plain sentence + surfaced fix capsules), chat diff card, share sheet, phone cut cards at 390px.

### Deferred / notes

- "View popover" for camera presets remains deferred (tracked since Phase 2; the toolbar already passes its compactness assertions).
- Share "link" required inventing nothing server-side: it reuses the existing codec through the existing import gate; from `file://` the sheet says links don't apply rather than minting a dead URL.
- BOM's separate renderer function remains (called by Buy) — deliberate, so golden/behavior surfaces stay byte-comparable.

---

## Phase 4 — phone-first Build experience

Date: 2026-07-16 · `npm test` 40/40 · `npm run test:smoke` **210/210** (six net-new assertions) · build 1 572 KB.

### Files changed and the specific edits

- **`src/ui.js`**
  - One derivation of the build work-list (`buildTasks()` + `checksForBoard/Sheet/Rough`) now feeds BOTH build surfaces, so progress keys can never drift: the wide two-column checklist (unchanged for desks) and the new **phone pager** — one board, sheet, or assembly step at a time.
  - Pager (`renderBmTask`): task title, hero cutting diagram (the `{large}` SVG on a 760px legibility floor, horizontally scrollable), explicit "Tap the diagram to enlarge" hint, the task's big check buttons, step text + 3D play button for assembly tasks. Entry lands on the **first unfinished task**; checking on either surface re-renders the other (never the one holding focus).
  - Navigation: sticky footer with large Prev / "N of M" / **Next** (56px, primary; the last Next reads "Done" and exits), **swipe** left/right (pan-y preserved for scrolling; reduced-motion unaffected since navigation is a re-render, not an animation), and ArrowLeft/Right while in build mode.
  - **Install nudge**: `beforeinstallprompt` is stashed (never shown unprompted); the first time a project reaches **100 % built** the pager shows a one-time banner — the real install prompt where the platform offers one, otherwise honest per-platform copy (iOS: "Share → Add to Home Screen"; elsewhere: bookmark/install). Persisted `prefs4.installNudged` keeps it to exactly once.
- **`src/index.template.html`** — `#bmPager`, `#bmTasknav` (Prev/pos/Next), `#bmInstall` banner added inside build mode; wide-bench columns annotated.
- **`src/styles.css`** — pager layout ≤880px (columns hidden, pager scrolls, task nav pinned above the safe area, 56px controls); **diagram legibility floors**: default cutting SVGs never render narrower than 560px CSS (`.bm-diagram`, `.stock-board` scroll sideways instead), pager heroes 760px; print keeps natural width; `--seafoam-wash`/`--fern-wash` tokens added to all four scheme blocks (install banner is the first fern-wash consumer).
- **`src/packing.js` — presentation functions only** (`boardSVG`/`sheetSVG`; the packing math above them is untouched, verified by the golden/audit suites staying green):
  - Label sizes raised (board main 26/32, rotated 21/26, offcut 24/28; sheet name 22/26, dims 20/24, legend 18/22) — with the CSS floors this lands **every diagram label at ≥14 effective px at every width** (measured 19.7px minimum at 320–430).
  - Flat labels now render only when they truly fit their segment (mono ≈ 0.62 em), otherwise rotate and truncate **to the segment width** — the screenshot review caught adjacent "Drawer front" labels overprinting; fixed.
  - The sheet legend's `⟶` arrow became words ("grain runs the long way") — the last non-kbd Unicode symbol in a UI surface.

### Verified working (and how)

- **`npm run test:smoke` 210/210**, including six new phone-Build assertions at 390×844: columns hidden + exactly one task card; 56px control floor; no sideways page pan; **every SVG label ≥14 effective px** (computed from viewBox scale × font-size); Next advances the pager; filling all but one key and checking the last box through the real UI raises the **one-time install nudge at 100 %**.
- Scripted width sweep in build mode: no horizontal document scroll and 19.7px minimum label size at **320 / 360 / 390 / 430**.
- Screenshots reviewed at 390px: board task (title, diagram, hint, checks, sticky nav) and the overlap fix confirmed.
- `npm test` 40/40 — golden outputs and packing math untouched by the presentation-only `packing.js` edits.

### Boundaries and honest gaps

- **Offline**: the app is one self-contained file — once loaded it runs without network (AI degrades to the built-in parser, storage to device/localStorage; the wake lock, checklists, diagrams all work). But there is **no service worker**, so a hard reload while offline depends on the browser's HTTP cache. A real SW would require shipping a second file, which contradicts the repo's founding "one self-contained file" rule — deliberately NOT done; flagged here and in Phase 0. The install nudge (standalone display manifest) mitigates: an installed instance keeps its document cached.
- The wide-bench build mode intentionally keeps the two-column overview (a 27-inch shop monitor benefits from seeing all boards); "one task at a time" is the phone-first behavior per this phase's title. Both share one work-list derivation and one progress store.

---

## Phase 5 — signature polish

Date: 2026-07-16 · `npm test` 40/40 · `npm run test:smoke` **212/212** · build 1 573 KB.

### Files changed and the specific edits

- **View popover** (the item deferred since Phase 2, now done): the viewport toolbar shows exactly what the spec names — **Dimensions · Blueprint · Fit · View** — and the View popover holds the camera presets (F/S/T/Iso), the explode slider, and "Keyboard & pointer help". All element IDs preserved; Escape layering extended; help opens from inside the popover and restores focus to its opener. Phone toolbar rules simplified (the old explode/help hide-rules died).
- **Warm 3D lighting**: the last cool light — the `0xdfe8ff` studio-blue fill in `engine.js` and `jointview.js` — became warm parchment `0xf0e6d2`. With Phase 1's selection change, nothing blue remains outside Blueprint Mode's deliberate cyanotype.
- **Skip links ×3**: Chat (`#chatText`), 3D model (`#view3d`), Plans (`#panel-main`); the plans link also switches to Plan mode first so its target is never `display:none`.
- **Dead CSS removed** (readiness remnants in the forced-colors list → replaced with mode-nav/AI-badge dots; orphaned `.stepper` rules). Dynamic-class "orphans" (`movement-*`, `verdict-*`) verified live before keeping.
- **Floor closures found by the final sweep**: `.menu-group-label` 13→14px; mode-nav segments to a real 44px min-height (nav capsule padding trimmed 3→2px to hold the ≤64px app-bar spec — the one smoke failure this caused was fixed, suite back to green).
- Dark mode was already walnut-derived from Phase 1 tokens; the dark journey (hero → plan → build) was re-shot and reviewed rather than re-styled.

### Verified working (and how)

- Scripted final verification (headless Chromium, both schemes):
  - **Text floor**: zero sub-14px visible text across hero, all five plan tabs, reference, and build mode (documented supplementary-badge tier excluded).
  - **Touch targets**: zero primary controls under 44px `offsetHeight` (buttons, tabs, mode segments, send, hero CTA).
  - **`prefers-contrast: more`**: hairline token verifiably hardens (16% → 55% ink mix) under emulation, in explicit themes too.
  - **Reduced motion**: all CSS transitions collapse to 0.01ms under emulation; the engine's damped-lerp family already snaps via its own `reducedMotion` flag (existing behavior, smoke-covered).
  - **No horizontal scroll** at 320/360/390/430 × design/plan/build.
- `npm run test:smoke` 212/212 (View-popover assertions added; two toolbar/help sites updated); `npm test` 40/40 throughout.
- Dark screenshots reviewed: plan overview and build mode read as the walnut den (terracotta actions, fern progress, warm boards).

### Deferred (with reasons)

- Font/Three.js payload subsetting (audit item B14) — build-time tooling explicitly deferred by the standing audit backlog; bundle sits at 1 573 KB (+36 KB over the redesign, +2.3%).
- Living Workshop Tier 2 particles — the prompt itself forbids decorative particles until mobile performance is proven excellent; audit backlog agrees (X8).
- Service worker / true offline reload — conflicts with the founding one-file rule (documented in Phases 0 and 4).

---

## Final report — definition of done, item by item

All engineering suites green throughout: unit + audit + golden + battery + server (`npm test` 40/40), hand-calc worksheet untouched, `test/golden/` diffed clean — **the pipeline, physics, and golden outputs are untouched** (only `packing.js` presentation functions `boardSVG`/`sheetSVG` changed, below the math).

1. **New user creates a starter design without instruction** — VERIFIED: the hero asks one question with three one-tap starters (real rendered thumbnails); smoke walks starter → plans → build end-to-end.
2. **One obvious primary action per screen** — VERIFIED by review: hero = "Design it"; Design mode = Send; Plan = the derived next-action button; Build = Next/check. The app bar holds exactly two strong actions (Build segment, Share).
3. **Phone Build mode comfortable at 390×844** — VERIFIED: one-task pager, 56px controls, 19.7px minimum diagram labels, sticky nav; smoke-asserted at 390 and script-checked at 320–430.
4. **No essential text below 14px effective** — VERIFIED by full text-node sweeps across every surface (zero findings; the supplementary-badge tier — snap-source, kind tags, provenance kickers, kbd caps, group headers — is 12–13px by documented policy; print stylesheet excluded as a different medium).
5. **Primary touch targets ≥44px** — VERIFIED by `offsetHeight` sweep (zero under floor on desktop; phone keeps the pre-existing 40px tier for secondary toolbar controls, primaries ≥44).
6. **Five colors with consistent documented jobs** — VERIFIED: rust action/failure, seafoam selection (CSS `::selection`, 3D edges/rim), fern success/progress, mustard focus/advisory/rules, walnut ink/surfaces/shadows; ratios documented in Phase 1.
7. **No blue outside Blueprint Mode** — VERIFIED: CSS tokens (grep), engine THEMES + fill lights re-inked; `DRAFT` cyanotype is the deliberate exception the brand system prescribes.
8. **No emoji or mismatched icon styles** — VERIFIED: one drafting-instrument SVG family everywhere; source grep for emoji/arrow/cross glyphs clean (kbd key legends like ⌘ retained as literal key caps; ●○ rating dots are a deliberate data visualization).
9. **Beginners never hit unexplained engineering terms first** — VERIFIED: Safety leads plain at every level; beginner first layer is jargon-free by smoke assertion; creep/ΔMC live behind "See engineering details".
10. **Desktop and mobile full-journey review** — DONE: screenshot journeys (first visit → design → plan → build) reviewed at 1440 and 320/390 in both schemes across the five phases.
11. **Reduced motion / keyboard-only / increased contrast** — VERIFIED: emulated reduced-motion collapses all transitions (plus the engine's own snap path); keyboard: three skip links, menu/dialog focus traps and restores, roving tabs, bracket-key sub-tab cycling, arrow-key build pager — all smoke-asserted; `prefers-contrast: more` hardens hairlines/rules (verified under emulation) and `forced-colors` opts out only where color is content.
12. **Pipeline untouched** — VERIFIED via suite runs and `git diff --stat` (no changes to `structural.js`, `spec.js`, `parametric.js`, `plans.js` math, `fasteners.js`, `packing.js` planners, `test/golden/`).

**Assumptions made** (all documented in-phase): desktop keeps the two-column build overview (phone gets the one-task pager); Plan mode keeps the model strip + splitter ("beneath", per the prompt's either/or); redo hidden ≤400px; smoke thresholds updated to the redesign's own 56–64px app-bar spec; share "link" implemented serverlessly as `#d=` hash import.
**Prompt-vs-reality conflicts**: recorded in Phase 0 (eight items — palette already migrated, Build-title already fixed, blue-in-engine confirmed, etc.).
**Known gaps**: no service worker (one-file rule); payload subsetting deferred; gallery thumbnails cached before the selection re-ink may show stale rims until starters change; AI badge lives in the chat head (visible on phones only with the sheet expanded — caveat chips cover the collapsed case).
