# Blueprint Buddy — Launch Audit: Outstanding Human Inputs

**Status:** OPEN — this is a living checklist · **Date:** 2026-07-22 · **Audited commit:** `ea47bd3` (post-overhaul merge, PR #37)

**Scope.** Everything that still requires a *human* before (or at) production launch:
decisions only the owner can make, environment/console configuration no script can
set, verification steps that need a real device or a real payment, and content
(legal, branding, marketing claims) only a human can approve. Engineering
correctness is NOT re-audited here — that regime lives in `00-…08` and
`AUDIT_REPORT.md` and is referenced only where a human decision is still owed.

**How this was produced.**
- Full read of `api/`, `scripts/verify-production.js`, `.env.example`,
  `DEPLOYMENT.md`, `.vercel-env-manifest.json`, the prior audits
  (`08-production-readiness.md`, `AUDIT_REPORT.md`, `docs/overhaul/final-report.md`),
  and targeted reads of `src/`.
- Baseline verified at the audited commit: `npm run build && npm test` → **all
  suites green** (unit + audit + golden + battery + server, 150 server assertions),
  `npm run test:handcalc` green in CI, and `dist/index.html` byte-identical to a
  fresh build.
- The **live Stripe account was queried read-only** (account, prices, portal
  configurations, subscriptions) via the Stripe API. Findings below marked
  *(Stripe API, verified 2026-07-22)* come from that.
- The **live deployment could not be probed** from this environment (outbound
  requests to `*.vercel.app` are blocked by the sandbox network policy), so
  anything needing the running site is phrased as a human verification step —
  `npm run verify` from any machine with the env vars is the tool for most of it.

**Legend.** `P0` = blocks the launch story (revenue or trust) · `P1` = should be
resolved before announcing · `P2` = decide-and-record (defer is a valid answer) ·
`P3` = hygiene.

---

## 0. Summary checklist

| # | P | Item | One-line action |
|---|---|------|-----------------|
| [LH-01](#lh-01) | P0 | No OAuth provider configured → nobody can sign in → **Pro cannot be bought** | Create Google and/or GitHub OAuth client; set the env pair |
| [LH-02](#lh-02) | P0 | Stripe **Customer Portal has no configuration** → "Manage subscription" fails | Save the portal config in the Stripe Dashboard |
| [LH-03](#lh-03) | P0 | Webhook raw-body **never proven on the real Vercel runtime** (A3) | `stripe trigger customer.subscription.created` against the deploy |
| [LH-04](#lh-04) | P0 | **Zero live subscriptions ever** — the paid loop has never run end-to-end | One real $15 purchase → verify Pro flips → cancel/refund |
| [LH-05](#lh-05) | P0 | Stripe **payout schedule is `manual`** — revenue would sit in the balance | Switch to automatic payouts (or record "manual" as deliberate) |
| [LH-06](#lh-06) | P0 | `ANTHROPIC_API_KEY` not confirmed set in production (silent offline degrade) | Confirm on Vercel; add to the env manifest |
| [LH-07](#lh-07) | P1 | Anthropic-side spend ceiling — nothing in-repo can cap the bill | Set a monthly spend limit/alerts in the Anthropic Console |
| [LH-08](#lh-08) | P1 | `AI_MONTHLY_TOKEN_BUDGET` exists in code but is **undocumented and unset** | Decide a value (or explicitly leave off); document it |
| [LH-09](#lh-09) | P2 | Model choice: proxy defaults to `claude-sonnet-5` | Sign off or pin `ANTHROPIC_MODEL` |
| [LH-10](#lh-10) | P0 | **No privacy policy or terms of service exist anywhere** | Provide/approve text; ship as pages or an in-app dialog |
| [LH-11](#lh-11) | P1 | Safety/liability language sign-off (plans drive power tools) | Owner (ideally counsel) approves `DESIGN_BASIS` + ToS risk clause |
| [LH-12](#lh-12) | P1 | Stripe support email **null**; receipts/branding unset | Set support email, receipt emails, logo/colors in the Dashboard |
| [LH-13](#lh-13) | P2 | Tax: Stripe Tax settings active but **checkout collects no tax** | Decide: flat-price (record it) or wire `automatic_tax` |
| [LH-14](#lh-14) | P2 | Domain: stay on `hannah-ric-grat.vercel.app` or buy a custom domain | Decide; if custom, run the coordinated-change list below |
| [LH-15](#lh-15) | P1 | Vercel plan: subscriptions are commercial use — Hobby tier disallows it | Confirm the project is on a Pro (paid) Vercel team |
| [LH-16](#lh-16) | P1 | Upstash KV is the system of record for projects + entitlements | Confirm no-eviction, plan limits, backups in the Upstash console |
| [LH-17](#lh-17) | P1 | No monitoring: function logs are ephemeral, webhook failures silent | Set up log drain / Stripe webhook alerts / uptime check |
| [LH-18](#lh-18) | P2 | No favicon or PWA/app icons anywhere; Stripe checkout unbranded | Provide an icon; inline it in the template; upload to Stripe |
| [LH-19](#lh-19) | P2 | Prior audit's MEDIUM/LOW remediation is **partially landed, no ledger** | Decide fund-now vs post-launch; add a status column to §7 |
| [LH-20](#lh-20) | P2 | Overhaul "Unresolved" items (§8) await product calls | Decide U1 payload, U3 CSS rise, parked polish; record |
| [LH-21](#lh-21) | P1 | Physical-device verification matrix (phone GPU, iOS, print, CAD) | Run the device pass; record results in `docs/overhaul/findings/` |
| [LH-22](#lh-22) | P2 | Marketing numbers: porch retail ranges + default price tables | Owner signs off the claims and regional prices |
| [LH-23](#lh-23) | P2 | Final sign-off of pricing/caps ($15/$144 · 3/25/500 · burst 60) | One-line confirmation (changing later touches 3 places) |
| [LH-24](#lh-24) | P3 | Five stale remote branches (incl. recreated `v0/*`) | Maintainer deletes (outward action — deliberate) |
| [LH-25](#lh-25) | P3 | `pnpm-lock.yaml` re-added while the repo standardized on npm | Remove it (or document why it stays) |
| [LH-26](#lh-26) | P3 | Env-manifest + docs upkeep after the above | Update manifest, re-run `npm run verify`, small doc nits |

---

## 1. Revenue path — blockers (P0)

The Stripe side is genuinely ready: account activated with charges + payouts
enabled and a verified bank account, statement descriptor `BLUEPRINT BUDDY`,
both Pro prices **live and active** — $15.00/month
(`price_1Ttv6QDmAsGr64ouadZUalOQ`) and $144.00/year
(`price_1Ttv6QDmAsGr64ouvKGZa3wR`), matching the client's pricing card
(`src/billing.js:106-107` shows $15 / $12-billed-yearly). *(Stripe API, verified
2026-07-22.)* What remains is the chain that lets a customer actually reach and
manage that checkout.

<a name="lh-01"></a>
### LH-01 · Configure a sign-in provider — without one, Pro is unreachable (P0)

- **What's outstanding.** No Google or GitHub OAuth client pair is configured.
  Neither pair appears in `.vercel-env-manifest.json` nor in DEPLOYMENT.md's
  "Current production state" table. The repo's own tooling states the consequence
  plainly: *"no one can sign in and billing/Pro checkout is unreachable"*
  (`api/_env-check.js:94-100`, `scripts/verify-production.js:168-172`). The client
  copes honestly — the Upgrade dialog says *"Sign-in isn't available on this site
  yet"* (`src/billing.js:138-143`) — but honest copy is not a revenue path. The
  fact that the Stripe account has **zero subscriptions and zero customers ever**
  is consistent with sign-in never having been possible.
- **What the human does.** Either provider is sufficient; Google fits the
  audience better, GitHub is faster to set up (no consent-screen review):
  1. **Google:** Google Cloud Console → APIs & Services → Credentials → Create
     OAuth client (type *Web application*) with authorized redirect URI
     `https://hannah-ric-grat.vercel.app/api/auth`. Then Console → OAuth consent
     screen: app name, support email, **privacy policy URL (see LH-10 — Google
     requires it)**, and **publish to Production** (in Testing mode only
     allow-listed accounts can sign in).
  2. **GitHub:** Settings → Developer settings → OAuth Apps → New OAuth App,
     callback URL `https://hannah-ric-grat.vercel.app/api/auth`.
  3. Set the env pair(s) on Vercel (Production, and Preview if wanted):
     `vercel env add GOOGLE_CLIENT_ID production` (+ `GOOGLE_CLIENT_SECRET`,
     and/or `GITHUB_CLIENT_ID`/`GITHUB_CLIENT_SECRET`), then redeploy.
- **Where to record / verify.** Add the key names to
  `.vercel-env-manifest.json → confirmed_production` and bump `last_verified`.
  Verify live: `https://hannah-ric-grat.vercel.app/api/auth?me=1` must list the
  provider(s) in `providers`; then a full sign-in round-trip in a fresh browser
  profile. `npm run verify` flips its "OAuth sign-in provider" line from WARN to
  PASS.

<a name="lh-02"></a>
### LH-02 · Save a Stripe Customer Portal configuration (P0)

- **What's outstanding.** `GET /v1/billing_portal/configurations` returns an
  **empty list** *(Stripe API, verified 2026-07-22)*. `api/billing.js:88` calls
  `billingPortal.sessions.create(...)` for the "Manage subscription" action —
  with no saved configuration, Stripe rejects the call, the handler 502s, and a
  paying customer who wants to cancel or change cards sees only "Billing is
  temporarily unavailable" (`src/billing.js:48`). Nothing in
  `scripts/verify-production.js` checks this.
- **What the human does.** Stripe Dashboard → Settings → Billing → **Customer
  portal**: enable at minimum *cancel subscription* and *update payment method*
  (plan-switching monthly↔yearly optional), set the business display name, and
  **Save** — saving creates the default configuration the API needs. Zero code
  changes.
- **Where to record / verify.** Re-run the read (`/v1/billing_portal/configurations`
  non-empty), and after LH-04's test purchase click **Manage** in the app and
  confirm the portal opens. Consider adding a portal-configuration check to
  `scripts/verify-production.js` §4 (it already holds the key) so this can never
  regress silently.

<a name="lh-03"></a>
### LH-03 · Prove the webhook end-to-end on the real deploy — finding A3, still open (P0)

- **What's outstanding.** `docs/audit/08-production-readiness.md` (§1, §3-A3)
  closed every finding except this one: signature verification needs the **raw
  request bytes**, `module.exports.config = { api: { bodyParser: false } }`
  (`api/stripe-webhook.js:102`) is a Next.js-only convention that standalone
  `@vercel/node` functions may ignore, and the handler's distinct
  `raw_body_unavailable` 400 (`api/stripe-webhook.js:26-43,74-76`) exists
  precisely to make that misconfiguration visible **on the first test event**.
  DEPLOYMENT.md's production-state table confirms the endpoint is *registered*
  but records no successful live delivery. Until one 200 is observed, a paying
  customer might be charged and never upgraded — checkout succeeds, entitlements
  never flip.
- **What the human does.** With the Stripe CLI logged into the live account:
  `stripe trigger customer.subscription.created`, then Stripe Dashboard →
  Webhooks → the `hannah-ric-grat.vercel.app/api/stripe-webhook` endpoint →
  recent deliveries. **200 `{received:true}`** = proven. **400
  `raw_body_unavailable`** = the platform pre-parsed the body; that's the known
  fix path (capture raw bytes on this runtime), and it must be fixed before LH-04.
- **Where to record.** Add a "webhook live-fired: date, event id, 200" line to
  DEPLOYMENT.md's *Current production state* table. (The synthetic HMAC check in
  `npm run verify` §5 covers the signature math only — it cannot cover body
  handling, which is why this needs the CLI once.)

<a name="lh-04"></a>
### LH-04 · Run one real purchase through the live system (P0)

- **What's outstanding.** `GET /v1/subscriptions?status=all` returns **zero
  subscriptions ever created** *(Stripe API, verified 2026-07-22)* — the full
  paid loop (sign-in → checkout → webhook → KV entitlement → client gate lift →
  portal) has never executed in live mode. `test/server.test.js` proves each
  link in isolation; only a real purchase proves the chain.
- **What the human does.** After LH-01/02/03: in a fresh browser, sign in, buy
  Pro monthly with a real card, confirm (a) the app shows Pro and the gates lift
  (Build Mode, premium exports), (b) the subscription record landed in KV
  (`bb:{uid}:subscription`), (c) **Manage** opens the portal — then cancel
  (and refund from the Dashboard if desired; expect the plan to drop to Free at
  period end, `cancelAtPeriodEnd` shown in the account sheet).
- **Where to record.** Same DEPLOYMENT.md table — "first live purchase verified:
  date". This also closes prior-audit item U-6 (`AUDIT_REPORT.md` §5).

<a name="lh-05"></a>
### LH-05 · Payouts are set to `manual` (P0)

- **What's outstanding.** The account's payout schedule is
  `interval: "manual"` *(Stripe API, verified 2026-07-22)* — charges would
  accumulate in the Stripe balance indefinitely and never reach the verified
  bank account unless someone remembers to pay out by hand.
- **What the human does.** Stripe Dashboard → Settings → Business → **Payouts**
  → set automatic (daily is the default most small SaaS use). If manual is
  actually intended (e.g., while watching for disputes early on), record that
  choice here instead — either answer is fine; an *unrecorded* manual schedule
  is the failure mode.

---

## 2. AI service — configuration and cost posture

<a name="lh-06"></a>
### LH-06 · Confirm `ANTHROPIC_API_KEY` is set on the production deployment (P0)

- **What's outstanding.** The key appears in **neither**
  `.vercel-env-manifest.json` nor DEPLOYMENT.md's production-state table, and the
  live site can't be probed from this sandbox. A missing key does not error the
  app — it silently degrades to the offline parser (by design,
  `api/chat.js:118-121`; the client surfaces it once per session after the L-14
  fix) — which makes "we forgot the key" the single most plausible silent launch
  failure: the site works, and the flagship feature is quietly the toy parser.
- **What the human does.** Vercel → Project → Settings → Environment Variables:
  confirm `ANTHROPIC_API_KEY` exists in **Production** (add as *Sensitive* if
  missing; use a key from a dedicated workspace so LH-07's cap is scoped to this
  app). Quick live check without burning a message: `curl -s -o /dev/null -w
  "%{http_code}" -X POST -H 'Content-Type: application/json' -d '{}'
  https://hannah-ric-grat.vercel.app/api/chat` → **400** means the key is set
  (request rejected for shape), **503** means it is missing.
- **Where to record.** Add `ANTHROPIC_API_KEY` to
  `.vercel-env-manifest.json → confirmed_production` (the manifest's stated
  purpose is exactly this: sensitive vars `vercel env pull` can't show).

<a name="lh-07"></a>
### LH-07 · Set a provider-side spend ceiling on the Anthropic key (P1)

- **What's outstanding.** `08-production-readiness.md` P0-3 closed the metering
  hole (every request metered by uid or hashed IP + burst limit) and noted the
  remaining pair: *"add a provider spend ceiling."* Nothing in this repo can cap
  what the key can spend at Anthropic; only the console can.
- **What the human does.** Anthropic Console → the workspace holding this key →
  set a **monthly spend limit** sized to tolerance (reference point: worst-case
  metered usage is ~500 msgs × ~1k output tokens for each paying user plus
  25/month per anonymous IP hash; at launch scale a $25–$50/month cap with an
  email alert at 50% is a sane starting posture) → confirm alert emails land.
- **Where to record.** One line in DEPLOYMENT.md's production-state table
  ("Anthropic spend cap: $X/mo, set YYYY-MM-DD").

<a name="lh-08"></a>
### LH-08 · Decide and document `AI_MONTHLY_TOKEN_BUDGET` (P1)

- **What's outstanding.** The proxy supports a per-user **monthly output-token
  ceiling** — `api/chat.js:125,144-151` reads `AI_MONTHLY_TOKEN_BUDGET` (0/unset
  = disabled) against the durable KV meter (`api/_entitlements.js:56-75`), and
  the feature is fully tested (server suite E-07a). But the variable appears in
  **neither `.env.example` nor DEPLOYMENT.md's env table** — an operator reading
  the documented surface cannot discover it, and today it is (presumably) unset,
  so the only per-user brakes are the 25/500 message caps and the burst guard.
- **What the human does.** Two decisions: (1) enable it or not for launch —
  reasonable value: `750000` (≈ 500 messages × the 1000-token reply ceiling ×
  1.5 continuation headroom); (2) whichever way it goes, add the documentation:
  - `.env.example` — insert after the `ANTHROPIC_MODEL` block (line 12):
    ```
    # Optional: per-user monthly output-token ceiling on /api/chat (0/unset =
    # disabled). A durable KV meter; trips as a 429 the client surfaces
    # gracefully. Example: 750000.
    # AI_MONTHLY_TOKEN_BUDGET=
    ```
  - `DEPLOYMENT.md` — add a row to the environment-variable table (after
    `ANTHROPIC_MODEL`, line 44).
- **Where to record.** The env table row is the record; add the var to the
  manifest only if actually set.

<a name="lh-09"></a>
### LH-09 · Sign off the model choice (P2)

- **What's outstanding.** The proxy defaults to `claude-sonnet-5`
  (`api/chat.js:23`), overridable via `ANTHROPIC_MODEL`. This is a cost/quality
  dial only the owner can weigh (the wire codec was tuned on Sonnet-class
  replies; a smaller model would be cheaper but weaker at the novel-piece
  grammar).
- **What the human does.** Keep the default (no action) or set
  `ANTHROPIC_MODEL` on Vercel; either way tick this item. If pinning, note it in
  DEPLOYMENT.md's production-state table so the choice survives operator churn.

---

## 3. Legal, policy, and trust content (human-authored by definition)

<a name="lh-10"></a>
### LH-10 · Privacy policy and terms of service do not exist (P0)

- **What's outstanding.** A repo-wide search finds no privacy policy, terms,
  or legal page in any surface (`src/`, `dist/`, docs). The app: creates
  accounts (Google/GitHub OAuth), stores user designs server-side (Upstash),
  processes payments (Stripe), sends user text and photos to Anthropic, and
  meters anonymous users by hashed IP (`api/chat.js:31-40` — a privacy-conscious
  design worth *saying* out loud). Three forcing functions: **Google's OAuth
  consent screen requires a privacy policy URL** (LH-01), Stripe checkout
  conventionally links terms, and selling subscriptions without either is a
  trust and (jurisdiction-dependent) legal gap.
- **What the human does.** Provide or approve the two texts (a generator or
  counsel — owner's call; the data inventory above is the honest input). Ship
  them one of two zero-dependency ways:
  1. **Static pages (recommended — Google needs stable URLs):** emit
     `dist/privacy.html` and `dist/terms.html` from `build.js` — the mechanism
     exists at `build.js:77-80` where `robots.txt` is written; add the two
     `fs.writeFileSync` calls (content can live as small template files under
     `src/`). They deploy with the same static output, satisfying the consent
     screen and checkout links.
  2. In-app dialog wired from the More menu (`src/ui.js`, the menu block around
     line 3750) — fine for the app, but not linkable from Google's console, so
     option 1 is still needed for LH-01.
- **Where to record.** Once live, paste the URLs into the Google consent screen
  (LH-01), Stripe Dashboard → Settings → Business details (website/policy
  links), and add a footer/More-menu link in the app.

<a name="lh-11"></a>
### LH-11 · Sign off the safety/liability posture (P1)

- **What's outstanding.** The engineering disclaimer is already excellent and
  honest — `DESIGN_BASIS` (`src/knowledge.js:265-275`) discloses the Wood
  Handbook basis, what the safety factor absorbs, and closes with *"Estimates
  for hobby woodworking — not certified structural engineering,"* rendered in
  the Integrity footer and print sheet (`src/ui.js:1160`). What no engineer can
  supply: the owner's (ideally counsel's) confirmation that this language plus
  an assumption-of-risk clause in the ToS (LH-10) is the liability posture they
  want while charging money for plans that direct power-tool work. The F2057
  tipping treatment (anchor becomes a mandatory BOM line; M-18 "safe only when
  anchored" tier is implemented) is a strength worth citing in that review.
- **What the human does.** Read the Integrity footer, the print sheet, and the
  Safety tab of one drawer-bearing design; approve or request wording changes;
  ensure the ToS carries the matching clause. Record the sign-off here.

<a name="lh-12"></a>
### LH-12 · Stripe customer-facing settings: support email, receipts, branding (P1)

- **What's outstanding.** *(Stripe API, verified 2026-07-22)*:
  `business_profile.support_email` is **null** (a support phone and URL exist),
  and checkout **branding is empty** (icon, logo, colors all null) — the payment
  page renders text-only, and receipts/disputes surface no email contact.
  Whether Stripe emails receipts at all is a dashboard toggle this audit can't
  read (Settings → Emails → "Successful payments").
- **What the human does.** Stripe Dashboard: (1) Settings → Business details →
  set a support **email** (decide the address — see also LH-14; a domain email
  beats a personal one on receipts); (2) Settings → Branding → upload
  icon/logo, set brand color (the app's tokens: rust `#B4552D`-family on oat —
  see `docs/ui/brand-system.md`) — this styles checkout and the portal (LH-02);
  (3) Settings → Emails → turn **receipts on** for successful payments.
- **Where to record.** Nothing in-repo; tick here. (LH-18 reuses the same icon
  asset in-app.)

<a name="lh-13"></a>
### LH-13 · Decide the tax posture (P2)

- **What's outstanding.** Stripe **Tax settings are active** with a head office
  set *(Stripe API, verified 2026-07-22)*, but the checkout session
  (`api/billing.js:72-82`) does not pass `automatic_tax`, and both prices carry
  `tax_behavior: "unspecified"` — so today every charge is a flat $15/$144 with
  **no tax calculated, collected, or tracked**. For a US individual selling a
  low-volume digital subscription this is a common early posture, but it is a
  *decision*, currently made implicitly.
- **What the human does.** Choose and record one:
  1. **Flat-price for now** (typical pre-nexus): no code change; note the
     revisit trigger (e.g., "review at $X MRR or N subscribers"). Stripe Tax's
     threshold monitoring can watch registrations for you.
  2. **Collect tax:** register where required, set `tax_behavior` on both prices
     (Dashboard), and add `automatic_tax: { enabled: true }` to the checkout
     payload at `api/billing.js:72-82` (+ a server test alongside the existing
     checkout assertions in `test/server.test.js`). Verify in test mode first.

---

## 4. Platform and operations

<a name="lh-14"></a>
### LH-14 · Domain decision (P2 — but decide *before* wide announcement)

- **What's outstanding.** Everything is pinned to
  `https://hannah-ric-grat.vercel.app`: `APP_ORIGIN` (Vercel env), the
  registered Stripe webhook (`.env.example:60-64`), the Stripe business-profile
  URL, and (once LH-01 lands) OAuth redirect URIs. A custom domain
  (`blueprintbuddy.???`) is a brand/marketing call — but switching **after**
  launch multiplies the work below across live users, so decide now.
- **What the human does if staying on vercel.app:** nothing — tick this item.
- **If moving to a custom domain**, the coordinated change list (order matters):
  1. Buy the domain; add it to the Vercel project (Domains).
  2. Update `APP_ORIGIN` env → new origin (it exists precisely so redirect
     targets are immune to Host spoofing — keep it authoritative).
  3. Google + GitHub OAuth apps: add the new redirect URI
     `https://NEW-DOMAIN/api/auth` (keep the old during cutover).
  4. Stripe: add a **new** webhook endpoint `https://NEW-DOMAIN/api/stripe-webhook`
     (same three `customer.subscription.*` events), put its new `whsec_…` in
     `STRIPE_WEBHOOK_SECRET`, re-run LH-03, then disable the old endpoint.
     Update the business-profile URL.
  5. Update the recorded values: `.env.example:43-46,60-64`, DEPLOYMENT.md's
     production-state table, `.vercel-env-manifest.json` `last_verified`.
  6. Re-run `npm run verify` and a full sign-in + checkout round-trip.

<a name="lh-15"></a>
### LH-15 · Confirm the Vercel plan permits commercial use (P1)

- **What's outstanding.** Vercel's Hobby tier prohibits commercial use;
  charging subscriptions on it risks suspension at exactly the wrong moment.
  Which team/plan the project sits on is not visible from the repo.
- **What the human does.** Vercel Dashboard → the project's team → confirm it's
  a **Pro** (paid) team, or move the project to one. While there: Settings →
  Functions region — co-locate with the Upstash Redis region (LH-16) so every
  KV read doesn't cross an ocean.

<a name="lh-16"></a>
### LH-16 · Upstash Redis: durability posture for the system of record (P1)

- **What's outstanding.** The same KV holds user documents, subscriptions, and
  usage meters (`api/_kv.js`, `api/_entitlements.js`) — it is a **database, not
  a cache**. Three console-side properties this audit can't see: eviction
  policy (an eviction-enabled instance would silently delete user projects at
  memory pressure), plan limits (free-tier command/bandwidth caps vs expected
  traffic), and backups (the client's device-write-through softens but does not
  replace them — a KV wipe still loses any project not opened locally since).
- **What the human does.** Upstash console → the database: (1) confirm
  **eviction is disabled**; (2) confirm the plan fits (paid/pay-as-you-go for
  production is the safe default); (3) enable daily backups if on a plan that
  offers them; (4) note the region for LH-15's co-location.
- **Where to record.** One line in DEPLOYMENT.md's production-state table
  ("KV: region, plan, eviction off, backups on — verified YYYY-MM-DD").

<a name="lh-17"></a>
### LH-17 · Minimal observability before real users (P1)

- **What's outstanding.** The API layer emits clean one-line structured errors
  (`api/_log.js` — E-08) but Vercel function logs are ephemeral unless drained,
  webhook delivery failures are silent unless Stripe's notifications are on, and
  nobody is watching uptime. All are console setups, not code.
- **What the human does (30 minutes, once):**
  1. Stripe Dashboard → Webhooks: enable **failure notification emails** for the
     endpoint (repeated-failure alerts).
  2. Vercel → Project → Logs: add a **log drain** (any receiver) or, at
     minimum, calendar a weekly scan for `"scope":"webhook"` /
     `"scope":"billing"` error lines.
  3. Any uptime monitor → two checks: `GET /` (200 + non-trivial body) and
     `GET /api/auth?me=1` (200 JSON) — the second catches a dead functions
     layer even when static hosting is fine.
  4. Anthropic console alerts are LH-07.

<a name="lh-18"></a>
### LH-18 · App icon / favicon (and the matching Stripe logo) (P2)

- **What's outstanding.** `src/index.template.html` ships **no `rel=icon`** and
  the inline PWA manifest (line 16) declares **no icons** — browser tabs show
  the generic globe, iOS "Add to Home Screen" renders a screenshot tile, and
  the install-nudge path the overhaul checks on iOS (final-report §9) has no
  icon to show. Checkout branding is the same gap on Stripe's side (LH-12).
- **What the human does.** Approve one mark (the drafting-instrument logo the
  porch masthead already draws is the obvious candidate — `src/icons.js`).
  Then, keeping the zero-external-assets rule: inline it as data-URI links in
  the template head (`<link rel="icon" href="data:image/svg+xml,…">` +
  `apple-touch-icon` as a small data-URI PNG) and add an `icons` array to the
  inline manifest. Reuse the raster for Stripe branding (LH-12).
- **Where.** `src/index.template.html:3-17` (head block); rebuild
  (`npm run build`) and eyeball a tab + an iOS home-screen add.

---

## 5. Product decisions already queued in the repo's own documents

These are not new findings — they are open calls the repo's documents explicitly
route to a human, gathered here so they stop being ambient.

<a name="lh-19"></a>
### LH-19 · The MEDIUM/LOW remediation plan is partially executed with no status ledger (P2)

- **What's outstanding.** `AUDIT_REPORT.md` §7 plans 22 MEDIUM + 14 LOW fixes
  in batches A–F. Code/test markers show a substantial subset **landed** (M-01
  drill-size rendering, M-11 tool list, M-12 sheet badging, M-13 hardware mass,
  M-14 honest not-saved state, M-15, M-16 a11y, M-18 anchor-tier verdict, L-01,
  L-02, L-03, L-14, plus the G10 corrections-note channel ≈ M-20) — but others
  are **verifiably still open**, e.g. M-19: slide screws are still `M4 × 16`
  into 12 mm drawer sides (`src/plans.js:226,316`, `src/exports.js:347`), M-02
  fine-thread pocket screws absent from `src/fasteners.js`, M-09 pre-finish
  step absent from `src/plans.js`. The report itself still reads as if all 36
  are uniformly "planned."
- **What the human does.** One decision: fund a completion pass now (bench-truth
  items M-19/M-02/M-09 are the customer-visible ones) or explicitly defer to
  post-launch. Either way, have the next engineering session add a status
  column to `AUDIT_REPORT.md` §7 so the ledger matches reality — an audit
  document that overstates open work erodes exactly the trust it exists to
  protect.

<a name="lh-20"></a>
### LH-20 · Overhaul "Unresolved" product calls (P2)

From `docs/overhaul/final-report.md` §8 — each explicitly awaits an owner call:
1. **U1 — payload:** dist is ~23 KB over the amended +190 KB ceiling (2.17 MB
   total). Accept the overage, or fund roadmap #11 (Three.js/font subsetting,
   worth ~hundreds of KB). Decide; record in the final report.
2. **U3 — `.panel-inner` CSS rise on recompute renders:** pre-existing, audited,
   left per CSS-stays-CSS. Keep or remove — product call.
3. **Parked polish:** Shapeshift morph interstitial (static fallback shipped);
   overture Skip-pill overlapping the View button at 375 px for the first-run
   seconds ("one-line nudge if it bothers you"); gallery cascades + provenance
   spec-plate skin. Fund, park, or kill — record which.

<a name="lh-21"></a>
### LH-21 · Physical-device verification matrix (P1)

The one verification class no CI here can run, consolidated from
`docs/overhaul/final-report.md` §9 and `AUDIT_REPORT.md` §5:

| Check | Source |
|---|---|
| Overture + scroll-scrub feel on a real phone GPU (SwiftShader couldn't prove p95 ≤ 20 ms) | overhaul U2/§9 |
| Touch: diagram pinch/drag, double-tap; wake lock through a build session on iOS **and** Android | U-7 / §9 |
| iOS install nudge / Add to Home Screen (pairs with LH-18) | §9 |
| Print the plan on paper (print CSS inspected, never printed) | U-3 |
| Import `.glb` / `.dae` / `.rb` into Blender + SketchUp; open `.glb` in Android AR | U-4 |
| One real-model AI session end-to-end (novel piece, revisions, a genuine continuation) — needs LH-06 first | U-1 |
| Photo → design on the hosted vision path | U-2 |

**Do:** one afternoon with an iPhone + an Android + a printer; record outcomes
in `docs/overhaul/findings/` (device-pass note) and tick here.

<a name="lh-22"></a>
### LH-22 · Sign off the human-authored numbers: retail claims and default prices (P2)

- **What's outstanding.** Two tables are honest *inputs* the pipeline never
  computes, so only a human can vouch for them:
  1. `RETAIL_COMPARABLE` (`src/porch.js:323-330`) — the landing calculator's
     "typical store range" ($150–$2,500 by template × size). It's marketing
     copy in table form; the owner should confirm the ranges read as fair
     before traffic arrives.
  2. Default lumber/sheet/consumable prices (`src/knowledge.js` —
     `defaultPrices()` at 713, `SHEET_BASE_PRICES` at 705, `CONSUMABLE_PRICES`
     at 751) — users can override per-key, but the defaults set the first cost
     impression and drift with the lumber market.
- **What the human does.** Skim both against current local reality (one hardwood
  dealer visit or price sheet); adjust values in place if needed (`npm run build
  && npm test` — golden fixtures pin geometry, not prices, but the battery
  asserts price *plumbing*, so run the suite).

<a name="lh-23"></a>
### LH-23 · Final pricing/caps sign-off (P2)

One-line confirmation that these launch values are intended — recorded because
changing any of them later touches multiple synchronized places:
- **$15/mo · $144/yr** (Stripe prices, live) — display mirror at
  `src/billing.js:106-107`.
- **Free = 3 projects + 25 AI msgs/mo · Pro = unlimited + 500/mo** — authority
  `api/_entitlements.js:7-14`, display mirror `src/billing.js:10-13` (the two
  must stay in sync — documented in both files).
- **Burst 60 req/min per meter id** (`api/chat.js:50`) and **anonymous = Free
  caps per hashed IP** (`api/chat.js:31-40`) — note the known trade-off:
  users behind one CGNAT/campus IP share an anonymous bucket; signing in is
  the documented escape hatch.

---

## 6. Repo hygiene (P3)

<a name="lh-24"></a>
### LH-24 · Stale remote branches (maintainer-only, outward action)

`git ls-remote --heads` today: `main` plus **five** non-main branches —
`claude/blueprint-buddy-frontend-audit-41p7ee`,
`claude/premium-aesthetic-prompt-rpx2hx`, `production-readiness-review`,
`uxui-audit`, `v0/hannah-ric-74b06807`, `v0/hannah-ric-d0284132`. This is
finding B1/B2 from `08-production-readiness.md` §4, deliberately deferred to the
maintainer (deletion is outward; the `v0/*` pair was predicted to be
tool-recreated and was). **Do:** confirm each tip is merged/abandoned, delete on
GitHub; expect `v0/*` to reappear if v0 stays connected.

<a name="lh-25"></a>
### LH-25 · `pnpm-lock.yaml` re-added against the npm standardization

The M2/H1 remediation removed it and standardized on npm
(`vercel.json` pins `npm install --omit=dev --ignore-scripts`); commit
`e2e7970` later re-added it. It's inert (Vercel obeys `vercel.json`) but
re-opens the two-package-manager confusion the audit closed. **Do:** delete it
(preferred), or record here that a v0/tooling integration requires it.

<a name="lh-26"></a>
### LH-26 · Record-keeping after the above

- Add every newly set var to `.vercel-env-manifest.json → confirmed_production`
  (expected end-state adds: `ANTHROPIC_API_KEY`, `GOOGLE_CLIENT_ID`,
  `GOOGLE_CLIENT_SECRET` and/or the GitHub pair, optionally
  `AI_MONTHLY_TOKEN_BUDGET`, `ANTHROPIC_MODEL`), bump `last_verified`.
- Re-run **`npm run verify`** from a machine with the env vars after each batch
  of changes — done means: 0 failed, and the two advisory gaps (AI key, OAuth)
  gone, i.e. the script's *"ready to accept live Stripe subscriptions"* line
  without qualifications.
- Doc nits found in passing: README.md:64 describes `npm test` as three suites
  (it now also runs battery + server); DEPLOYMENT.md's env table should gain
  the `AI_MONTHLY_TOKEN_BUDGET` row (LH-08).

---

## 7. What was checked and found already done (no action — do not re-litigate)

- **Stripe account**: activated — charges enabled, payouts enabled, bank
  account verified, statement descriptor `BLUEPRINT BUDDY`, business profile
  name/description/URL set, ToS accepted. *(Stripe API, 2026-07-22.)*
- **Prices**: both live, active, correct amounts/intervals/nicknames, tagged
  `app: blueprint-buddy`. *(Stripe API, 2026-07-22.)*
- **Vercel env (per manifest, 2026-07-16)**: `AUTH_SECRET`,
  `STRIPE_SECRET_KEY`, both price IDs, `STRIPE_WEBHOOK_SECRET`, KV pair,
  `APP_ORIGIN` all confirmed set.
- **Engineering baseline at `ea47bd3`**: full suite green, handcalc 14/14 in
  CI, `dist/index.html` in sync with `src/` (verified by rebuild during this
  audit), CI enforcing all of it on every push/PR (`.github/workflows/ci.yml`).
- **Security posture** (per 08 audit, spot-confirmed): no secret reaches the
  browser; sessions HMAC + timing-safe; store keys uid-scoped; OAuth CSRF
  state; anonymous AI metered + burst-limited; billing errors don't leak
  upstream messages; `robots.txt` is allow-all (generated, `build.js:77-80`).
- **Graceful degradation**: every optional service (AI, auth, KV, Stripe) has a
  tested degrade path — the launch risk is silent *under*-configuration
  (LH-01/06), not crashes.
