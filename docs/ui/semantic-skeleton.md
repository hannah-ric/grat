# Semantic shell skeleton — structural map

A reference viewport skeleton for the Blueprint Buddy shell built from **strict
semantic HTML5 only**: zero `<div>`, zero `<span>`, in markup and in script.
Every box in the layout is a native landmark or content element, so the
accessibility tree *is* the layout tree. The executed artifact is
[`semantic-skeleton.html`](semantic-skeleton.html) — a single self-contained
file (repo convention: no external URLs, no dependencies), openable straight
from disk.

It is a **skeleton, not a port**: real product regions (composer rail, 3D
stage, plans panel, readiness, dialogs) with real product copy from the
shaker-nightstand benchmark, and stub behavior where the engine would plug in.
Use it as the structural target when Phase 2 touches the shell
(`src/index.template.html` currently carries 91 `<div>`s).

## The DOM tree

```text
HTML[lang=en]
└── BODY ····································· app frame · grid rows: header / main / footer · 100dvh
    │
    ├── A.skip → #stage ······················ first focusable: skip straight to the viewport
    │
    ├── HEADER ═══════════════════════════════ COMMAND BAR (banner landmark)
    │   ├── HGROUP                             brand lockup
    │   │   ├── H1                             "Blueprint Buddy"
    │   │   └── P                              active design · revision
    │   ├── NAV "Readiness"                    Design → Validate → Plans → Build
    │   │   └── OL > LI ×4 > A > EM            aria-current="step" · data-state="done" → ✓
    │   ├── SEARCH                             project / species finder
    │   │   └── FORM > LABEL + INPUT[search]
    │   └── MENU "Global actions"              toolbar
    │       └── LI ×6 > BUTTON                 Chat‡ · New · Projects† · Share† · Export▾ · Theme
    │
    ├── MAIN ═════════════════════════════════ WORKSPACE · grid cols: 21rem | 1fr | 24rem
    │   │
    │   ├── SECTION #composer ─────────────── DESIGN CONVERSATION (rail / drawer‡)
    │   │   ├── HEADER > H2 + BUTTON‡          rail title · drawer close
    │   │   ├── OL #transcript                 scrolling message log
    │   │   │   └── LI ×n > ARTICLE            one turn · data-role="user|assistant"
    │   │   │       ├── HEADER > STRONG + TIME  speaker · timestamp
    │   │   │       ├── P                       message body
    │   │   │       └── FOOTER > UL > LI > DATA diff chips (machine value in @value)
    │   │   └── FORM #prompt-form              composer
    │   │       └── FIELDSET > LEGEND + LABEL + TEXTAREA
    │   │                    + MENU > LI ×2 > BUTTON     Photo · Propose
    │   │
    │   ├── SECTION #stage ────────────────── 3D VIEWPORT (skip-link target)
    │   │   ├── FIGURE
    │   │   │   ├── SVG[role=img]              isometric wireframe + dimension callouts
    │   │   │   └── FIGCAPTION > STRONG        piece · species · view
    │   │   ├── MENU "Viewport controls"       LI ×3 > BUTTON[aria-pressed]   Front · Iso · Top
    │   │   └── FOOTER                         readout strip
    │   │       ├── DATA                       envelope (mm in @value, imperial as text)
    │   │       └── OUTPUT[aria-live]          integrity verdict
    │   │
    │   └── ASIDE #plans ──────────────────── PLANS & INTEGRITY (complementary)
    │       ├── H2.vh                          landmark name for AT
    │       ├── MENU[role=tablist]             LI ×4 > BUTTON[role=tab]
    │       ├── SECTION[tabpanel] #panel-cut       TABLE: caption/thead/tbody · DATA cells
    │       ├── SECTION[tabpanel] #panel-integrity UL.gauges ×4: STRONG+DATA+METER+P
    │       │                                      DETAILS.advisories > SUMMARY + UL
    │       ├── SECTION[tabpanel] #panel-bom       TABLE + TFOOT > OUTPUT (est. total)
    │       └── SECTION[tabpanel] #panel-steps     OL.steps > LI ×5 > DETAILS > SUMMARY > H3
    │
    ├── FOOTER ═══════════════════════════════ STATUS BAR (contentinfo)
    │   ├── OUTPUT[aria-live]                  autosave state + TIME
    │   ├── DATA                               spec version
    │   └── SMALL                              provenance note
    │
    ├── DIALOG #projects-dialog ·············· modal · HEADER(H2 + FORM[method=dialog])
    │   └── UL.projects > LI ×3 > ARTICLE      H3 + MENU(actions) + P > TIME
    ├── DIALOG #share-dialog ················· modal · P + OUTPUT.code + FORM(copy)
    ├── MENU #export-menu[popover] ··········· LI ×3 > BUTTON (+KBD hints)
    │
    └── SCRIPT ······························· progressive enhancement only

     † opens a <dialog> (invoker commands, with fallback)   ‡ drawer controls, shown ≤1180px
```

## Why each container earns its tag

| Region | Element | Rationale |
| --- | --- | --- |
| Command bar | `header` | One banner landmark; brand in `hgroup` so the tagline doesn't pollute the outline |
| Readiness | `nav > ol` | It *is* navigation through an *ordered* pipeline; `aria-current="step"` carries state |
| Finder | `search > form` | The dedicated search landmark; the form gives Enter semantics for free |
| Toolbars | `menu > li > button` | `menu` is spec'd as a list of commands — toolbar rows, view controls, tab strip, popover |
| Chat turn | `article` | Self-contained, timestamped, individually distributable content — the definition |
| Diff chips | `data` | Human text ("depth 18 in") with the machine value (`d:457`) in `@value` — the display-boundary rule in markup |
| Stage | `figure > svg + figcaption` | The rendered piece is referenced content with a caption, not decoration |
| Readouts | `output` | Calculation results (integrity verdict, autosave, BOM total) — announced politely via `aria-live` |
| Plans | `aside` | Complementary to the stage: derived documents about the thing being viewed |
| Gauges | `meter` | Bounded scalar with low/optimum semantics — sag margin, tipping, racking |
| Advisories / steps | `details > summary` | Native disclosure, keyboard-complete, zero JS |
| Overlays | `dialog`, `[popover]` | Native focus trap, `::backdrop`, light dismiss, `Esc` — all free |
| Dim values | `data` in `td` | Millimetres in `@value`, imperial fraction as text — same boundary as `BB.Units` |

## Responsive states (same DOM, three layouts)

```text
≥1181px   HEADER [brand │ readiness │ search │ actions]
          MAIN   [composer 21rem │ stage 1fr │ plans 24rem]
          FOOTER [status]

≤1300px   readiness labels collapse to numbered/check dots
≤1180px   composer → off-canvas drawer (fixed, translate), toggled by the
          Chat button; `body:has(#chat-toggle[aria-expanded="true"])` drives
          the CSS — button state is the single source of truth. Esc closes.
          Search landmark and tagline hide; plans narrows to 23rem.
≤760px    MAIN stacks: stage 44dvh over plans (each pane scrolls itself);
          the command bar becomes a wrapping flex bar (brand + actions,
          readiness rail on its own centered row); status provenance drops;
          safe-area inset padding on the status bar.
≤480px    action buttons tighten (smaller type and padding, one row)
```

No layout state lives in a class toggle: breakpoints are media queries, user
state is ARIA attributes, and CSS selects on those.

## Behavior budget

The document is complete with JavaScript disabled — every pane is reachable,
disclosures and dialogs' close buttons (`form[method=dialog]`) still work, and
the export menu opens natively via `popovertarget`. The single script only
*enhances*:

- **Invoker fallback** — `command`/`commandfor` dialog opening for engines
  that predate Invoker Commands.
- **Tabs** — APG pattern: roving tabindex, arrow/Home/End keys, `hidden`
  panel switching.
- **Drawer** — flips one `aria-expanded`; CSS does the motion.
- **Theme** — cycles `color-scheme` (auto → dark → light); every color is a
  `light-dark()` token so the palette flips natively.
- **Composer stub** — appends semantic turns (`li > article > header + p`)
  and an offline-parser acknowledgement.

## Contract & verification

```sh
grep -cE '<(div|span)[ >]' docs/ui/semantic-skeleton.html   # → 0
grep -c  'createElement'   docs/ui/semantic-skeleton.html   # only li/article/header/strong/time/p
```

- One `h1`; heading levels never skip; every landmark has an accessible name.
- Contrast: ink on paper ≈ 15:1 both schemes (AAA); `prefers-contrast: more`
  promotes hairlines to full ink; `prefers-reduced-motion` kills transitions.
- Open the file directly (`file://` is fine — it is fully self-contained) or
  serve `docs/ui/` with any static server.
