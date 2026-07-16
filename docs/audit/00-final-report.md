# Blueprint Buddy — Engineering-Truth Audit & Remediation, Final Report

Auditors' standard: not "matches the spec" but *a professional woodworker and
a structural engineer would sign off on the plans this produces, and a
beginner following them literally builds sound furniture.* Code was treated as
the only source of truth; the phase specs as hypotheses.

Scope exclusion honored: UX/visual/accessibility untouched (one-line appendix
at the end).

> **Companion report:** the production/SaaS layer added after this audit (Stripe
> billing, entitlements, webhook, chat auth) is audited separately in
> `08-production-readiness.md` — front-end↔back-end contract, security posture,
> and repo hygiene. This engineering-truth report does not cover it.

## What was done

| Phase | Deliverable |
|---|---|
| 1 Discovery | `01-capability-inventory.md` · `02-constants-reference.md` (every constant/formula/threshold with file:line) · `03-data-flow.md` (transform/rounding map + digest drift check) |
| 2 Audit | Live battery (`test/battery.js`, before/after JSON in this folder) · hand-verification executor (`test/handcalc.js`) · systems greps — evidence attached per finding |
| 3 Remediation | `04-findings-register.md` — every S0/S1/S2 fixed, every S3 capability BUILT, failing-test-first (`test/audit.test.js`, 99 asserts) |
| 4 Verification | 293 unit + 99 audit + **golden corpus** (`test/golden.test.js`, 6 frozen reference designs with full outputs + diff harness) + 125 browser-smoke — all green; battery & hand-calcs re-run with after-values |
| 5 Report | this file · `05-hand-verification.md` · `06-benchmark-shaker-nightstand.md` · `07-backlog.md` |

## Findings register — headline rows (full register: 04)

| ID | Sev | What was wrong (evidence) | Fix |
|---|---|---|---|
| F-S0-1 | S0 | Drawer furniture never checked with drawers OPEN — a 1.2 m four-drawer dresser required no anchor (executed: `antiTip=false`) | ASTM F2057/STURDY-intent check: all drawers open ⅔, 22.7 kg on the top drawer front, moment balance about the front feet; fails mandate the anchor. Hand-verified to 6 decimal places |
| F-S0-2 | S0 | No creep factor: permanently loaded shelves passed on day-one elastic numbers (grep executed: absent) | Sustained presets carry ×2.0 long-term deflection (Wood Handbook ch. 4); transient loads don't |
| F-S1-1 | S1 | Fixed 30 mm tenon allowance — cut lists demanded 30 mm tenons inside 18 mm cabinet sides (executed: rail L=786) | `jointAllowance(type, mateT)`: blind tenon ≤ mate−6, housings ≤ ⅓ stock; setout engine snaps tenon thickness to chisel sizes |
| F-S1-2 | S1 | Grooved drawer boxes: bottom captured on four sides, steps said "slide it in" after assembly (impossible) | Grooved boxes assemble AROUND the floating bottom; slide-in boxes keep the honest rear-entry step |
| F-S1-3 | S1 | COLLADA/SketchUp exports dropped every part rotation and box-ified cylinders (executed: identity matrix on a rotated leg) | Full Y-up→Z-up conjugated rotation matrices in both exports; 16-gon prisms / `add_circle` cylinders |
| F-S1-4 | S1 | 12.5 mm/side drawer clearance vs the 12.7 mm ball-bearing slides require — every drawer binds | 25.4 mm total (`K.SLIDE_SPACE_MM`) |
| F-S2-1 | S2 | Table sag modeled as the top alone spanning leg-to-leg — the shipping Shaker starter showed **FAIL** (9.68 mm "sag" where the aprons hold it to 4.6) | Honest frame model: apron beams (½ spread + ¾ point each) + top strip between aprons + overhang; hand-verified exactly |
| F-S2-2 | S2 | 1D packer offcut double-subtracted kerf — negative offcuts on full boards (executed: −4 mm where truth is +2) | `offcut = stock − 2·trim − used` |
| F-S2-3 | S2 | Movement advisory warned tops "will split" while the same plan floats them on figure-8s; warned on compatible solid-solid casework | Movement context: floated / captured / compatible / custom — advisory only where capture is real (ply backs, leg-notched shelves), cupping note kept for wide flat-sawn tops |
| F-S2-4 | S2 | Load presets imitated BIFMA but missed the marks | books 60 kg/m, heavy 112, seating 136 kg — X5.9/X5.4/X5.5 basis strings shipped and shown |
| F-S2-5..9 | S2 | BOM fallback priced a sheet standard the store doesn't sell; 70 mm posts silently became 45; end-grain screws at full capacity; probe/builder drift; ply comment vs values | all fixed (register) |
| F-S3-1..9 | S3 | No fastener locations/pilots/setout, no milling steps, one-line finishing, no safety notes, no edge-distance rules, no slide ratings, undocumented design basis, drift-prone digests, screwed backs on dovetail drawers | **Built**: fastener/joinery-setout engine (`src/fasteners.js`) feeding steps + print + BOM counts; milling sequence in rough mode; grit-ladder + coat schedule + oily-rag fire warning; proportionate safety step; pocket-min/bottom-span rules; slide-capacity check; `K.DESIGN_BASIS` in the integrity footer & print + clear-stock notes on load-bearing rows; digests generated from tables with a self-test drift guard; dado-housed backs |

Design decisions the register forced: the default/starter 36 in bookshelf now
ships 25 mm shelves — under the honest 60 kg/m + creep arithmetic, 19 mm
stock over 876 mm of books sags visibly in service (the fixture freezing that
failure is golden `ash-bookshelf-metric`).

## Connection map (annotated, before → after)

```
intent ─ ai.js ─► spec.correct ─► parametric ─► validate ─► structural ─► plans ─► packing ─► exports
   │        │           │             │             │            │            │         │        │
   │   [F-S3-8 digests  │       [F-S2-8 probe   [F-S3-5     [F-S0-1 F2057] [F-S1-1  [F-S2-2  [F-S1-3
   │    hand-copied →   │        vs builder]     rules]     [F-S0-2 creep]  tenons]  offcut]  rotations]
   │    generated+      │      [F-S1-4 slides]              [F-S2-1 aprons]   │         │        │
   │    self-tested]    │      [F-S3-9 backs]               [F-S2-3 context] [F-S1-2 steps]     │
   │              [F-S2-6 post                              [F-S2-4 BIFMA]  [F-S3-1..4 built]   │
   │               thickness]                               [F-S2-7 endgrain]                   │
   └── every path still funnels through ONE correction + validation gate (unchanged, verified) ──┘
new module: src/fasteners.js (joinery setout engine) feeding plans, print, BOM
```

## Golden corpus manifest (`test/golden/`)

seed-table-imperial · shaker-table-imperial · walnut-nightstand-2drawer-imperial
· advanced-cabinet-imperial · ash-bookshelf-metric (frozen honest-fail case) ·
custom-bench-metric — each frozen with corrected spec, cut list, validation
ids, integrity checks + data numbers, optimizer boards/sheets/offcuts/costs,
BOM, and step ids; diffed at 0.05 mm tolerance; `--update` refreezes after an
intended change. Every frozen value traces to the verified engine at this
audit's close (hand worksheet 14/14).

## Live battery — before → after highlights (JSONs in this folder)

- Photo-path 4-drawer dresser: *no open-drawer check, no anchor* → margin
  1.18×, advisory, **anchor mandated**.
- Shaker starter: *sag FAIL 9.68 mm* → apron 4.61 / strip 1.54, **passes**.
- Advanced cabinet: *rails with impossible 30 mm tenons* → tenons 12 mm,
  buildable, benchmark-verified.
- 2400 mm pine shelf: still fails loudly (now with creep: 13.85 in long-term)
  — the gate keeps refusing what should be refused.
- Adversarial wire (smuggled dovetails, 9 m widths, 500-part bomb): still
  clamped by code, unchanged.
- Contradictory "delicate pine + heavy duty": surfaced via Janka duty +
  racking advisories + borderline apron sag — the integrity engine, not
  model manners, carries the conflict.

## Conviction statements

**Before this effort:** a beginner following the plans literally was *mostly*
safe but not reliably so. The unit discipline, level gating, geometric audit,
and validation gates were genuinely sound (nothing in the battery ever walked
through a wall). But three shipped failure modes were real: a cut list could
demand tenons that cannot physically enter their mortised member (the build
dies at dry-fit — S1); dovetail-grade drawer instructions required inserting a
captive bottom into a closed box (S1); and every drawer binds on its slides by
0.4 mm (S1). On the safety side, a 1.2 m dresser earned no anti-tip anchor
because drawers were never opened in the model (S0 — the exact scenario the
STURDY Act regulates), and permanently loaded shelves passed on day-one
elastic numbers that creep erases within a couple of years (S0). Meanwhile the
flagship starter *failed* its own integrity tab on a false alarm, teaching
users to distrust the one gauge that mattered.

**Now:** yes — with the honest caveats the product itself states. Every
number on the physics path is hand-verified to the digit (14/14); the tipping
of drawered furniture is checked in the regulated open-drawer scenario and
anchors become mandatory line items when the moment balance says so; creep is
in the sag math; tenons, dados, and dovetail laps are sized by the wood they
enter; drawers clear their slides; captive bottoms go in during glue-up;
exports match the screen; and the plans now say where the screws go, at what
pilot, in what milling order, with a finishing schedule and the oily-rag fire
warning. The basis of it all — small-clear Wood Handbook means, what the ×4
safety factor absorbs, the BIFMA/F2057 alignment, and the clear-stock rule —
is disclosed in the integrity footer and on the printed sheet, not buried in
a comment. The remaining honesty gap is inherent: the engine judges the
lumber the user *should* buy (straight-grained, knot-free, as every plan now
says), not the board they actually pick — that is exactly what the disclosed
safety factor and clear-stock notes are for.

## Appendix (out-of-scope, one line)

UX notes seen in passing: the integrity footer is now a long paragraph (could
collapse behind a "basis" toggle); the provenance popover can overflow narrow
phones; the new print sections haven't had a dark-mode pass. Not touched, per
scope.
