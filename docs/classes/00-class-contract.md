# The furniture-class contract

**A class is an engineering profile, not a template.** Adding a seat shape to
casework rules is not adding chairs. Before Blueprint Buddy may generate a
furniture class, the class must state — in code, in `src/classes.js`
(`BB.Classes`) — the nine artifact sets below. A class that cannot state them
is a class the app refuses, because a plausible unverified plan is worse than
a refusal (S0).

## The nine artifact sets

| # | Artifact | What it must contain | Enforced by |
|---|----------|----------------------|-------------|
| 1 | `family` | Valid ranges per dimension (each `ownedBy` `Spec.DIM_RULES`, the one table sliders and correction share) **plus the coupling rules** that tie dimensions together — a family with no couplings is a template, not a class | `validateContract` checks every path resolves; couplings name their enforcement site |
| 2 | `humanFactors` | min/max/unit **with a source** for anything a body touches | source string required, length-checked |
| 3 | `loadCases` | magnitude, application point, direction, duration, acceptance criterion, **source**, and `traceability: standard \| derivation` | all eight fields required; presets referenced must exist in `Structural.LOAD_PRESETS` |
| 4 | `jointRules` | required and prohibited joints per connection **with the computed reason** | joints must exist in `K.JOINERY` |
| 5 | `failureModes` | one entry per known real-world failure; each names the live `checkIds` proving the engine examined it, or the correction `guard` making it unreachable, **plus the bad-fixture test proving it fires** | `runChecklist()` re-derives coverage from a live integrity/validation result — a silently vanished physics check breaks the build |
| 6 | `hardware` | items with capacity ratings `matchedTo` computed loads | all fields required |
| 7 | `assembly` | sequence template, jigs, clamping strategy, squareness/angle checks | ≥ 3 sequence stages, ≥ 1 jig, ≥ 1 check |
| 8 | `refusals` | the request shapes the class cannot honor, the reason, and **where the refusal is said** (correction note / validation error / intent parser) | ≥ 1 refusal — "a class that can build anything asked of it is lying" |
| 9 | `fixtures` | golden manifest (nominal, boundary — both unit systems) + bad-fixture manifest | golden names must exist on disk (`audit SEAT-0`) |

## Enforcement

- `BB.Classes.validateContract(cls)` — structural **and referential**
  validation, run over every registered class by `src/selftest.js` (ships in
  the product) and `test/audit.test.js` SEAT-0.
- `BB.Classes.runChecklist(template, {integrity, validation})` — walks the
  failure-mode checklist against a live result; a non-`conditional` mode with
  no matching emitted check is `uncovered` and fails the suite.
- Correction (`Spec.correctSpec`) applies the family and couplings; the
  structural engine reads the load-case magnitudes from the class object
  (single source); `Spec.correctionNotes` speaks the refusals.

## Proof of generality (the retrofit)

The pre-existing leg-and-apron class (`table` / `desk` / `bench`) is
registered as **`frame_table`** on the same contract, with every artifact
pointing at the code that already owned it (DIM_RULES, ERGONOMICS rows,
BIFMA-based load presets, the audited frame model's check ids, the frameSteps
sequence). Nothing was invented for the retrofit — which is the point: the
contract restates existing engineering; it does not only fit chairs.

## Classes registered today

- `frame_table` — tables, desks, benches (retrofit).
- `seating` — dining chairs, counter/bar stools (`docs/classes/01-seating.md`).
- `wall_mounted` — French-cleat floating shelves (`docs/classes/03-wall-mounted.md`).
- `bed` — knock-down platform beds (`docs/classes/04-beds.md`).
- `casework` — bookshelves, nightstands, cabinets, doored or open (retrofit;
  `docs/classes/05-casework.md`).
