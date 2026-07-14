# Blueprint Buddy — Audit Backlog (S4 + noted follow-ups)

Each entry is written as a ready-to-run future prompt. None affects
structural soundness or buildability; all S0–S3 findings were fixed in the
audit pass.

1. **Consolidate `SHEET_FRACTIONS`** — "packing.js hardcodes the 1220/610
   fraction bounds that `K.LUMBER.SHEET_FRACTIONS` already tabulates; make
   `pack2D`'s fraction classifier read the table and delete the literals.
   Guard with a test that the table and classifier agree."
2. **Word-number dimensions** — "`BB.Units.normalizeLengthText` misses
   'four feet wide'. Add word-number (one…twelve) parsing ahead of the unit
   idioms so the offline parser and the model both receive explicit mm.
   Battery case 'mixed units' asserts width 1219.2 is captured."
3. **Rename `openings[].zTop`** — "the field is a Y coordinate; rename to
   `yTopWorld` across parametric/spec/ui with a migration-free sweep (it is
   never persisted)."
4. **Long-span sag fixes** — "when a sag check fails on a span > 900 mm,
   offer 'add a fixed center divider' / 'halve the span with a partition' as
   a tappable fix alongside thicken/species."
5. **Leg taper + 35 mm snap** — "add optional leg taper generation
   (aesthetic, cut list + steps) and include 35 mm (1⅜ in) in the leg snap
   table — the published Shaker section (benchmark line 'legs')."
6. **Back-into-shelf attachment** — "bookshelf backs are rabbeted to the
   case but not fastened to fixed shelves; add 'screw the back into each
   fixed shelf' to steps/BOM (racking + shelf-edge support), and note the
   support conservatism of the shelf beam model."
7. **Fastener catalog unification** — "BOM screw/dowel line labels now come
   from the fastener engine, but `K.FASTENERS` rows and the engine CATALOG
   still describe the same hardware in two places; source the engine's specs
   from `K.FASTENERS` keys."
8. **Drawer-bottom material step-up** — "when the 600 mm bottom advisory
   fires, offer a tappable fix that switches that drawer's bottom to 12 mm
   (parametric + cut list + BOM)."
9. **`window.claude.complete` continuation** — "artifact-host transport has
   no stop_reason; `looksTruncated` covers it but is untested against the
   real host. Verify on claude.ai and record a fixture." (Question Q-1.)
