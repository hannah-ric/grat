# Blueprint Buddy — Published-Plan Benchmark (external ground truth)

Executor: `test/benchmark-shaker.js` (permanent, exits non-zero on unexplained
divergence). Reference: the classic one-drawer Shaker-style nightstand as
published in essentially identical proportions across the canonical plan
literature — 18 × 16 × 26 in, ¾ in top with ~1 in overhang, 1⅜ in square
tapered legs, ¾ in aprons, mortise-and-tenon frame, one ~4 in inset drawer.
The source proportions are stated in the script so the comparison is honest
about what it benchmarks against.

## Generated cut list at the reference envelope (cherry, advanced)

```
1× Top             18 in × 16 in × 3/4 in          · clear-stock note
1× Back apron      15 15/16 × 9 13/16 × 3/4        · +2 1/16 in for M&T (tenons capped by 1 1/4 in legs)
2× Side apron      13 15/16 × 9 13/16 × 3/4        · +2 1/16 in for M&T
2× Drawer rail     15 15/16 × 2 3/8 × 13/16        · +2 1/16 in for M&T
4× Leg             25 1/4 × 1 1/4 × 1 1/4
1× Drawer front    13 3/4 × 4 15/16 × 3/4          · inset, 1/16 reveal
1× Box front       12 9/16 × 4 1/2 × 1/2           · +5/8 in half-blind dovetail (lap sized to 1/2 in sides)
1× Box back        12 1/4 × 4 1/2 × 1/2            · +5/16 in dado (1/3 of the 1/2 in sides)
2× Drawer side     11 13/16 × 4 1/2 × 1/2
1× Drawer bottom   12 3/8 × 11 1/4 × 1/4
```
Validation: clean. Integrity: 0 fails.

## Line-by-line classification (11 lines, 0 unexplained)

| Line | Published | Ours | Class |
|---|---|---|---|
| Overall envelope | 18×16×26 | identical | EQUIVALENT |
| Top thickness | 3/4 | 3/4 | EQUIVALENT |
| Top overhang | ~1 in/side | 13/16 in/side | EQUIVALENT (within published range) |
| Legs | 1⅜ sq, tapered | 1¼ sq, straight | TRADITIONAL — snap table lands 1¼; taper is aesthetic; slenderness passes (backlog: taper + 35 mm snap) |
| Leg joinery | M&T | M&T, tenons ≤ leg − 6 mm | EQUIVALENT |
| Apron stock | ¾ × ~5 in | ¾ thick drawer-bank face | EQUIVALENT — bank replaces the single apron, same load path |
| Drawer front | ~4 in inset flush | 4 15/16 inset, 1/16 reveal | EQUIVALENT |
| Drawer box | solid stock, wood runners | ½ in Baltic birch on slides (default) | OURS-DIFFERENT — `wood_runners` mode reproduces the traditional build; ply+slides is the beginner default, stated |
| Tenon length | long blind tenons | min(30, mate − 6) per end | OURS-BETTER — pre-audit fixed 30 mm could not enter thin stock (F-S1-1) |
| Fastener locations | dimensioned drawings | per-joint setout + print Joinery detail | EQUIVALENT (gap closed by F-S3-1) |
| Finish schedule | prose | grit ladder + coat schedule + rag-fire warning | OURS-BETTER |

Verdict: the generated plan is a sound modern rendering of the published form;
every divergence is classified and none is a defect.
