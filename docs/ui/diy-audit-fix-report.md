# DIY audit — fix report

**Date:** 2026-07-16  
**Branch:** `cursor/frontend-diy-audit-30fa`  
**Basis:** [`diy-frontend-audit.md`](diy-frontend-audit.md) ranked backlog

Live verification: `npm test` green · `npm run test:smoke` **189/189** · phone Build-mode title now **260×30** (was 16×600) · diagram labels **~13 CSS px** (was ~5).

---

## What was fixed

### P0 — shop-phone blockers
| ID | Fix |
| --- | --- |
| N1 | Build-mode title no longer letter-stacks: removed `overflow-wrap: anywhere`, gave `.bm-title` a full-width floor, wrap whole words only |
| N1b / N4 | Board/sheet SVGs taller + larger fonts (readable ~13 px on 390-wide); tap-to-zoom lightbox (`#diagramScrim`) regenerates `{ large: true }` |

### P1 — normal DIY friction
| ID | Fix |
| --- | --- |
| N2 | Phone header: “BB” short brand, design name ≥96 px, Export folded into More ≤560 px (`#exportBtn` kept in DOM), redo restored |
| N3 | Mobile readiness 4-dot strip in chat sheet head (`#readinessMobile`) |
| N5 | Browser skips direct Anthropic (no CORS noise); offline caveat chip; `"oak instead of walnut"` parses the *target* species |
| N6 | Export menu + help reordered: Print / CSV / SVG / Share first; SketchUp/CAD last |
| N7 | First-starter coach message in chat (`prefs4.seenCoach`) |
| N8 | `theme-color` + inline web-app manifest |
| B1 | Showroom palette adopted (rust action, walnut ink, seafoam/fern accents); Blueprint Mode keeps cyanotype blue |

### P2 — clarity & depth
| ID | Fix |
| --- | --- |
| B2 | Welcome cards use inline SVG icons (no emoji) |
| B3 | Reference search auto-jumps to the first tab with hits |
| B4 | Viewport touch targets ≥40 px on phone |
| B5 | Mobile advisories collapse to a single ⚠/🛑 N pill |
| B6 | DIY plain-language Stock/Cut ledes |
| B7 | Beginner integrity: plain summary + collapsible full report (starts open) |
| B8 | Richer mobile chat-peek fallback |
| B9 | Photo offline path already honest; left as-is |
| X3′ | Price editor: “optional” summary + note |

### P3 — polish
| ID | Fix |
| --- | --- |
| B10 | Splitter 20 px hit area + touch double-tap reset |
| B11 | `?` help: Viewport + Everywhere (`/`, `[` `]`, Esc, splitter) |
| B12 | Sticky table headers when no horizontal overflow (`.table-scroll.scrollable`) |
| B13 | Focus restored to panel heading after integrity fix re-render |
| B15 | Hash carries `;split=N;chat=0\|1` (unknown keys ignored) |

---

## What could still be improved (ordered)

These were **out of scope** for a UI pass (geometry, physics, build tooling, or multi-week product work). Do them in this order:

| Order | Pri | ID | Item | Why it waits |
| --- | --- | --- | --- | --- |
| 1 | P1 | B16 | Doors + hinges + stretchers | Parametric/geometry workstream; hardware READY stratum already waiting |
| 2 | P2 | B17 | Finish preview on 3D materials | Material-pool upgrade (`MeshPhysicalMaterial` finish classes) |
| 3 | P3 | B14 | Font + Three.js subsetting | Build-time tooling; ~1.5 MB payload |
| 4 | P3 | B18 | Scrap-first / room-fit / QR share | DESIGN.md Tier 3 — each needs its own design pass |
| 5 | P3 | X8 | Living Workshop Tier 2+ (particles, shaders, scroll choreography) | Delight after shop-phone basics stay green |
| 6 | P3 | X9 | Semantic zero-div shell migration | Large a11y rewrite; adopt incrementally |
| 7 | P2 | — | Forced-colors / prefers-contrast pass | phase2-roadmap item 15; untested this pass |
| 8 | P2 | — | Reference sub-tab full ARIA `aria-controls` | phase2-roadmap item 7 |
| 9 | P3 | — | Only show offline caveat once per session | Minor copy noise reduction |

**Explicitly still deprioritized:** promoting revision-compare, diagnostics UX, SketchUp-first messaging, particle systems before more shop features.

---

## Suggested next implementation order

1. **Doors/hinges/stretchers (B16)** — unlocks cabinets as first-class DIY pieces  
2. **Finish preview (B17)** — species already look real; finish sells the piece  
3. **Forced-colors + ref ARIA** — cheap a11y completeness  
4. **Payload subsetting (B14)** — mid-phone boot  
5. **Scrap-first or QR share (B18)** — pick by user demand  
6. **Living Workshop Tier 2** — only after the above stay green on phone

---

## How to verify

```bash
npm run build && npm test && npm run test:smoke
node test/diy-audit.playwright.js   # optional full DIY matrix
```
