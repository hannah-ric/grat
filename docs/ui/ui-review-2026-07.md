# UI review & build — 2026-07-20

**Branch:** `claude/blueprint-buddy-ui-review-i11dmp` (PR #33) · **Method:** three independent review lanes (Responsive/Devices, Aesthetics/System, Simplicity/Use) over the live app at 320→2560px both themes → adversarial verification pass → five build batches, one commit per finding → independent build verification re-measuring every fix → one repair pass.
**Suites at head:** unit 1253 · audit 480 · golden 6 (untouched) · battery 50 assertions · server 150 · smoke 270 · handcalc 16 — all green; dist in sync.

## Verdict

The bones were already strong — zero horizontal overflow anywhere, honest offline mode, a best-in-app Build-mode pager, near-perfect mono discipline in the plan tables, and a genuinely enforced Showroom token system. What failed was concentrated: shell chrome at phone extremes (topbar/menus/tabs unreachable at 320), the print export rendering blank, a providerless deployment Pro-gating Build into a dead end, viewer touch gaps (framing crop, pinch-through, no touch isolate), four measured AA contrast failures, and a first-run screen with four competing primaries. All 39 verified findings that were buildable in-scope are now fixed (37 findings + 3 verifier-found regressions repaired); 1 deferred, 1 report-only.

| Surface | Before | After |
| --- | --- | --- |
| Topbar/menus (phone) | More clipped to ~6px at 320; menus unscrollably taller than viewport at 6/8 sizes | fits at 320/344 incl. long names; menus cap + scroll; verified by probe |
| 3D viewer (touch) | model cropped at phone aspect; pinch could fly inside the piece to blank; no touch isolate; dead 10s boot shell on 3G | aspect-aware framing; dolly floor at 0.9× bounding sphere; double-tap + Isolate control; branded pre-JS skeleton |
| Plan tabs | Safety tab invisible at 320; inactive labels 4.37:1 | selected tab auto-scrolls into view + edge shadows; 6.04:1 |
| Build mode | position lost on exit/reload; hint 3.9:1; landscape checkboxes below fold; Pro-gate dead end with no billing configured | position survives exit AND reload; 5.39:1/16px; side-by-side landscape; providerless never gates |
| Print | completely blank (unclosed `#app` div swallowed `#printRoot`); off-system Georgia/grays | real on-brand sheet (Fraunces/Hanken/Plex Mono, walnut inks), ~174KB PDF, census-verified 0 gray/0 off-brand |
| Landing | four primary-styled actions, background chrome leaking through welcome, 21 tab stops to the hero input | one filled primary (Design it), quiet chrome under the card, hero input is Tab 1 via skip link |
| Chat | "drawer count null → 2" wire chips; placeholder 3.88:1 | humanized chips ("Added 2 drawers"); 5.39/6.25:1 |
| Touch targets | 34px segs, 15px sheet handle, sub-40 toolbar | 44px floor across audited controls (probe-swept) |

First-run journey (fresh profile, 390px): before — 9 actions to a cut list + CSV with **Build mode unreachable** (paywall dead end); after — cut list at 5, **Build mode enters at action 6**, full design→build→export→print path 15 actions, zero dead ends.

## Fixed (finding → commit)

Batch 1 shell: C-01 providerless gate `0a50be2` · B-01 print root `02cced5` · A-01 320 topbar `6e04c98` · A-02 menu scroll `7cab498` · A-03 tab reachability `2110175` · A-08 tap floors `b911d37` · A-04 toolbar row `f4f49cc` · A-12 tablet name `00d830c`
Batch 2 viewer: A-05 framing `592795e` · A-06 dolly clamp `605aab3` · A-07 touch isolate `6fe4678` · A-09 boot skeleton `f00fe8a` · A-10 partial Render row `bb0e7ad`
Batch 3 build+a11y: C-08 position persist `6c8bacc` · C-09 hint/dims `6a67a85` · C-10 placeholders `bb51d18` · C-11 tab contrast `b62a646` · C-12 splitter focus `57a0ede` · C-13 skip link `94878be` · A-11 landscape build `b994ca4`
Batch 4 simplicity: C-02 one primary `962bd5a` · C-03 see-your-plan `f3c781f` · C-05 humanized chips `b19299d` · C-06 level pref `cbafe74` · B-08 quiet welcome `0462a53` · C-15 label `2b94eb3` · C-17 empty-submit nudge `0a3b9f2` · C-14 coarse ⌘P `0421ab4`
Batch 5 system: B-02 print restyle `ca859e1` · B-03 mono values `9067523` · B-04 Fraunces floor `e4d23e7` · B-05 one dark voice `8123100` · B-06 seafoam selection `191a9d8` · B-09 radius tokens `86346a5` · B-10 type floor `131e4d3` · B-11 range styling `5699366` · B-12 inline styles `225751f` · B-13 motion tokens `431f28e`
Repair: R-01/R-02/R-03 (verifier-found sev-2 regressions: 320 quiet-Build fit, tap floors on the two new controls) `47b2d06`

## Deliberate behavior changes

- **C-06**: starters/gallery/projects now load at the *user's* skill level (default beginner) instead of the starter's authored level; an explicit dropdown choice persists.
- **B-06**: persistent selected states (segs, toggles, ref-tabs, species picks) moved from rust to the seafoam family per the brand table — rust is action-only again.
- **A-04**: at ≤480 the Dims/Blueprint toggles show state tracks only (words stay in aria-labels) to hold one 52px toolbar row.
- **A-07**: on touch, opening the inspector from a tap waits ~300ms (double-tap disambiguation).

## Gaps / not done (prioritized)

1. **A-10 auto GPU degrade** (Build-later): sustained-low-fps auto-switch to Flat is a new engine subsystem, unverifiable under SwiftShader CI, for a measured ~1.3× payoff; the manual Render row now sits in the View popover.
2. **C-16** (Report-only, product call): merge the per-joint "Why this joint?" + "Learn why" links — removes a distinct control.
3. Pre-existing, confirmed byte-identical on main: 844×390 welcome-card tightness (functional — scrolls, focusable), price-editor SKU labels in Hanken, ⌘P copy inside the export-help dialog.
4. CLAUDE.md doc drift: hand-calc worksheet is 16/16, doc says 14/14.
5. Standing roadmap items re-confirmed open: ~1.9MB payload subsetting, forced-colors pass, Shop-reference sub-tab ARIA, chat-sheet drag physics.

## Verify on real hardware (emulation caveats)

Touch double-tap isolate + the ~300ms inspector latency (A-07), pinch clamp feel (A-06), 3G skeleton timing on a real network (A-09), wake lock + PWA install on iOS Safari, print output on a physical printer, forced-colors mode, and any performance judgment (all perf numbers here are SwiftShader-relative).

Full evidence (probes, measured ratios, 100+ eyeballed screenshots, per-fix verification) lived in the session findings register; the fix log summary above carries the per-fix verified widths in its commits.
