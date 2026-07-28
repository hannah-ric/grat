# First-user usability report

**Date:** 2026-07-28  
**Lens:** Brand-new visitor — land, sign in, ask for a walnut desk, try to get buildable plans.  
**Method:** Fresh Chromium profiles against `serve.js` with `BB_DEV_LOGIN=1`, no `ANTHROPIC_API_KEY` (localhost offline parser). Desktop 1440×900 + mobile 390×844. Evidence screenshots in `docs/usability/shots/` and machine log in `docs/usability/first-user-journey.json`. Re-run: `node scripts/first-user-journey.js`.

**Counts: 1 CRITICAL · 5 HIGH · 8 MEDIUM · 2 LOW (16 findings).**

---

## Verdict

The engineering loop works. A signed-in first user can type “A walnut writing desk, about 48 inches wide,” get a Black Walnut desk at 48×26×29 in, and see Overview + Safety without paying. That is real product.

The **first-hour experience still fails the promise on the porch.** The landing sells “plans you can build on Saturday.” After the design appears, Cut/Buy/Assemble hide the numbers behind a credit wall whose primary CTA is **scrolled out of view**, Build stays padlocked, chat wears a red “AI not configured” badge, and Safety says both “passes” and “would not safely carry the load.” On a phone, “Open the studio” skips the welcome prompt and opens overture + Adjust over a half-seen seed model.

Trust and discoverability — not geometry — are the bottleneck.

---

## Journey (what actually happened)

### 1. Landing (porch)
- First paint shows the narrative masthead, brand, “Open the studio,” and Sign in. Boot ~1.2s locally.
- Build-vs-buy calculator produces a real dollar figure and responds to species chips.
- FAQ “What does it cost?” still describes the **legacy Pro subscription** (AI-message allowance, project cap, premium exports) — not blueprint credits.

### 2. Sign-in
- `#signin` offers Dev (local) + email/password when accounts are configured.
- Dev login lands in the studio with cloud persistence, **1 credit**, and the “What are you building?” welcome card. This path works.

### 3. Walnut desk prompt
- Hero: “A walnut writing desk, about 48 inches wide” → desk template, Black Walnut, width 48 in honored.
- Bot ack is thin: “Roughed out a desk to standard proportions — refine away.” The useful story is in CHANGED (depth 34→26, width 60→48, oak→walnut, renamed “New desk”).
- Title becomes **“New desk”** because the offline namer falls back when the prompt is longer than 40 characters.
- Chat header shows red **“AI not configured”** plus a quieter offline note — success with a broken-looking badge.

### 4. Plan / Build
- Overview: ADVISORY, “9 of 9” checks, estimated cost visible (good).
- Cut: part names + qty + Black Walnut, dimensions replaced by lock glyphs. Copy says exact dims ship with the blueprint.
- **“Issue blueprint — 1 credit” measured at y≈1109; panel viewport ends at y=900 — CTA not on screen without scrolling the plan panel.**
- Build mode shows a lock; clicking it is meant to open the spend confirm, but the unlock story is easy to miss if you never scroll Cut/Buy/Assemble.
- Safety: rollup “passes… with notes” while beginner plain-language on an ADVISORY card says the top “would not safely carry the load.”

### 5. Unsigned path
- Prompting “A walnut desk” correctly gates with “Sign in free… first blueprint credit is included” and provider buttons.
- Seed Red Oak table + open Adjust rail stay visible underneath — feels like the request was ignored.

### 6. Mobile
- Masthead CTA fits; no horizontal overflow.
- Enter studio: welcome suppressed, phone overture (Skip), Adjust already open, brand collapses to “BB.” Hard to know where to type the first piece.

---

## Findings

Severity: **CRITICAL** blocks the sold outcome · **HIGH** blocks/confuses the next action or trust · **MEDIUM** erodes clarity · **LOW** polish.

| ID | Sev | Area | Finding | Fix direction |
|----|-----|------|---------|---------------|
| U-01 | CRITICAL | Monetization | Issue-blueprint CTA below the Plan-panel fold after a successful design | Pin a sticky CTA bar in locked Cut/Buy/Assemble (`Issue blueprint — 1 credit · you have N`); do not bury it under the preview table |
| U-02 | HIGH | Trust/Copy | FAQ still sells legacy Pro, not credits | Rewrite FAQ cost answer (+ any porch/billing copy) to the credit model |
| U-03 | HIGH | Trust | “AI not configured” is the loudest Design-chat status after a successful build | On localhost/offline: “Working offline” / “Basic designer.” Reserve “not configured” for operators; never red-dot a working session |
| U-04 | HIGH | Safety copy | ADVISORY cards say “would not safely carry the load” under a “passes” headline | Beginner plain line must match tier: advisory ≠ fail. e.g. “Worth improving before you build” + the measured value |
| U-05 | HIGH | Monetization | Cut dims / assembly text / Build locked after the porch promised Saturday plans | Keep the wall, but make the free credit the obvious next step on Overview + a post-design chat chip (“Issue your free blueprint”) |
| U-06 | HIGH | Mobile | Open studio → overture + Adjust, no welcome hero | On phone entry from porch: welcome/hero first; defer Adjust until a design exists or user opens it; overture must not steal the first prompt |
| U-07 | MEDIUM | Naming | Natural prompts → title “New desk” (>40 char offline namer) | Prefer a short title from species+template (“Walnut writing desk”) when phrasing is long |
| U-08 | MEDIUM | Chat | Thin ack; CHANGE log holds the truth | First-turn ack should name wood + size in one sentence (“48×26 in Black Walnut desk — refine away”) |
| U-09 | MEDIUM | IA | “Open the studio” vs “Sign in” teach different outcomes | Primary CTA for the AI loop: “Describe a piece” / “Sign in to design” when accounts are configured |
| U-10 | MEDIUM | A11y | H1 `textContent` duplicated after `Motion.lines` split | Keep original text `aria-hidden` on clones, or restore a single accessible name after animation |
| U-11 | MEDIUM | Chrome | Adjust rail auto-opens on first entry and covers the model | Default Adjust closed until the user asks or selects a part |
| U-12 | MEDIUM | Chat polish | Placeholder clips to “Describe your pie” at default split | Shorter placeholder (“Describe a piece…”) or allow wrap/tooltip |
| U-13 | MEDIUM | Auth | Unsigned gate is clear; seed + Adjust underneath feel like a no-op | Collapse Adjust on gate; optional dim/overlay on the bench until sign-in |
| U-14 | MEDIUM | Intent | Depth/species changes easy to miss beside a short bot line | Same as U-08 — surface key clamps in the bubble, not only CHANGED |
| U-15 | LOW | Trust | ADVISORY rollup still reads as soft pass | Tie rollup wording to worst plain-language card |
| U-16 | LOW | Landing | Masthead CTA near bottom of 900px viewport | Already mitigated by header CTA; optional tighten lede |

---

## What already works (do not break)

- Porch → studio segmentation (studio off-page while landing is up).
- Sign-in → cloud mode + free credit chip visible (“1 credit”).
- Welcome hero path: type → Design it → walnut desk with correct species and ~48 in width.
- Unsigned AI correctly demands sign-in and mentions the free credit.
- Overview + Safety remain readable before spend (shape, cost, physics).
- Locked Cut preview is honest about *what* is withheld (part names/qty visible).
- Calculator on the porch runs the real pipeline.

---

## Prioritized action plan

### P0 — Unblock the sold loop (do these first)

1. **Sticky issue CTA (U-01, U-05)**  
   Locked Plan tabs and Overview get a persistent “Issue blueprint — 1 credit (N left)” actions row. Optionally auto-scroll the panel to the CTA once per design. Add a chat chip after the first successful design: “Issue your free blueprint.”

2. **Safety plain-language by tier (U-04, U-15)**  
   Stop using fail verbs on `advisory`. Align headline, stamp, and beginner sentence. Regression: assert advisory copy never matches `/would not safely/`.

3. **Quiet the AI badge when the session works (U-03)**  
   Offline/local parser → neutral “Offline designer” (or hide). Red “not configured” only when the proxy 503’d in a way the user cannot recover from — and never alongside a successful design reply.

### P1 — First-session clarity

4. **FAQ + marketing copy → credits (U-02)**  
   One source of pricing truth; kill Pro-allowance language on public pages.

5. **Mobile entry rewrite (U-06, U-11)**  
   Porch CTA → welcome/hero focused; overture skippable without blocking; Adjust closed by default.

6. **First-turn naming + ack (U-07, U-08, U-14)**  
   Title from species+template; ack names wood and overall size.

7. **CTA IA when accounts exist (U-09, U-13)**  
   Make the front door match “describe a piece”; on gate, calm the bench chrome.

### P2 — Polish

8. H1 accessible name after line-split (U-10).  
9. Placeholder length (U-12).  
10. Masthead spacing (U-16) only if analytics show fold drop-off.

### Explicit non-goals for this pass

- Do not remove the credit wall on Cut/Buy/Assemble/Build — fix **discoverability** of the free credit instead.
- Do not weaken structural checks to make copy nicer — fix the **words**, not the math.
- Do not treat `AUDIT_REPORT.md` (bench/fastener engineering) as done; this report is the **first-hour UX** layer on top.

---

## Suggested verification

After P0/P1 fixes:

```bash
node scripts/first-user-journey.js   # journey + screenshots
npm run test:porch
npm run test:smoke
npm run test:gating
```

Add assertions: Issue CTA in panel viewport on locked Cut; advisory beginner copy ≠ fail template; FAQ mentions credits; mobile porch entry shows welcome or hero without Adjust open.

---

## Evidence index

| Shot | Moment |
|------|--------|
| `01-landing-masthead.png` | First desktop viewport |
| `04-faq-pricing.png` | Legacy Pro FAQ |
| `05-signin-page.png` | Sign-in |
| `06-after-dev-login.png` | Welcome after login |
| `08-walnut-desk-designed.png` | Walnut desk + offline ack |
| `10-plan-cut-locked.png` | Locked cut dims (CTA below fold) |
| `13-plan-safety.png` / `14-build-or-issue.png` | Safety contradiction + locked Build |
| `17-anon-gated-prompt.png` | Unsigned gate |
| `21-mobile-studio.png` | Mobile overture + Adjust |

Machine-readable companion: `docs/usability/first-user-journey.json`.
