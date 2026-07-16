# Blueprint Buddy — Production-Readiness Audit: Findings & Remediation Plan

**Status:** FINAL · **Date:** 2026-07-16 · **Scope:** all 24 feature PRs (#3–#26) merged to `main`,
with risk concentrated in the last four merges (#23–#26, the v0/cursor SaaS/Stripe bolt-on).

This audit sits alongside the 2026 engineering-truth audit (`00-final-report.md` … `07-backlog.md`),
which remains valid: it covers physics, joinery, packing, and exports. This report covers the
**production layer bolted on afterward** — the SaaS/Stripe/entitlements code, its front-end↔back-end
contract, security posture, and repo hygiene — none of which the earlier audit or any test touches.

---

## 1. Verdict

**As merged: not production-ready.** The engineering core was in excellent shape, but the SaaS layer
added last shipped with **zero tests, zero documentation, no CI, and a dependency that violated the
repo's founding zero-dependency rule and crashed a fresh clone.**

**After remediation (this branch): all findings addressed** — see the status table below. The `stripe`
dependency is gone (hand-rolled in `api/_stripe.js`), anonymous AI is metered, the client acts on the
server's usage limit, the store index no longer bloats, CI runs the suite on every push, and the SaaS
layer is documented. The one item that still needs a human step is **A3**: the webhook is now robust and
self-diagnosing, but signature verification over the raw body must still be confirmed on the real Vercel
deploy with the Stripe CLI (§3, A3) — the code can't prove the platform's body handling on its own.

### Remediation status (2026-07-16)

| ID | Sev | Status |
|---|----|--------|
| M1/A1/A2 | HIGH | **Fixed** — `stripe` removed; `api/_stripe.js` hand-rolls the 4 REST calls over `fetch`+`crypto`; fresh clone boots again |
| A3 | HIGH | **Fixed + verify-on-deploy** — raw-body read made robust and now returns a distinct `raw_body_unavailable` 400 instead of a mystery signature failure; confirm on live deploy with `stripe trigger` |
| A4b | HIGH | **Fixed** — every `/api/chat` request metered (uid or hashed IP) + in-memory burst limit |
| T2 | HIGH | **Fixed** — `.github/workflows/ci.yml` runs build + full suite + handcalc + dist-sync check |
| A4a | MED | **Fixed** — `proxyTransport` surfaces 402/429; the client opens the upgrade dialog from the server payload |
| A5 | MED | **Fixed** — thumbnails moved to their own per-project docs; index stays tiny; legacy thumbs self-migrate |
| M2/H1 | MED | **Fixed** — `pnpm-lock.yaml` removed; `vercel.json` → `npm install --omit=dev --ignore-scripts` |
| M3/A6 | MED | **Fixed** — SaaS layer + env matrix + webhook setup + font swap documented (DEPLOYMENT/CLAUDE/AGENTS/brand-system/DESIGN) |
| T1 | MED | **Fixed** — 40 new server assertions: entitlements, webhook signature/A7/A3, checkout/portal, anon metering |
| A7 | LOW | **Fixed** — renewal date read from `items[].current_period_end` |
| S1 | LOW | **Fixed** — `billing.js` no longer returns raw `error.message` |
| S2 | LOW | **Fixed (doc)** — `APP_ORIGIN` documented as recommended in production |
| S3 | LOW | **Noted** — benign KV TTL edge; left as-is |
| M4 | LOW | **Fixed** — `.v0-*.png` + orphan `bitter-*.woff2` removed |
| A9 | LOW | **Fixed** — Free-tier numbers single-sourced into one documented client mirror |
| B1/B2 | HYGIENE | **Deferred to maintainer** — branch deletion is outward and `v0/*` may be tool-recreated |

**Discovered during remediation (running the smoke suite that no CI ever ran — T2):**

- **V1 — Build Mode gated behind Pro, smoke test stale.** #26 moved **Build Mode**
  (the full-screen workshop companion) and **premium exports** behind the Pro
  paywall (`ui.js` `gate('advancedFeatures'|'premiumExports')`) but never updated
  `test/smoke.playwright.js`, which drives Build Mode as an anonymous Free user —
  so the smoke test had been failing since #26 with nobody to catch it. The gating
  is intended monetization (the pricing card markets "advanced workshop tools");
  **fixed** the smoke harness to grant Pro on boot, and documented the entitlement
  split in DEPLOYMENT.md.
- **V2 — topbar drifted 3px over its own spec.** With Build Mode unblocked, the
  suite reached a later assertion and showed the desktop app bar at **67px** vs the
  redesign's stated **56–64px** — a regression from #24's Bitter→Fraunces/Hanken
  font swap (identical in Free and Pro, so not billing-related). **Fixed** with a
  minimal, spec-conforming trim (`.topbar` vertical padding 7px→5px → 63px); the
  segmented-capsule design is untouched.
- **A5 test update.** The smoke assertion that a project card "carries a 3D
  thumbnail" checked the index row; with thumbnails now in their own docs it checks
  `Store.loadThumb(id)` instead — a stronger check of the new storage shape.

The findings detail below is retained as the record of what was wrong and why.

### What is solid (verified this audit, do not re-litigate)
- **`npm test` → 40 passed, 0 failed** (unit + audit + golden + battery + server). Hand-calc stays 14/14.
- **`dist/index.html` is byte-identical to a fresh `node build.js`** at HEAD — currently in sync.
- The engineering pipeline (intent → correct → build → validate → structural → plans → exports) is
  unchanged and fully covered by the golden corpus and hand-verification worksheet.
- Client security discipline holds: every `innerHTML` sink in `src/ui.js` wraps dynamic values
  (user chat text, AI `explain`/`question` text, project names, OAuth name/avatar) in `esc()`.
  No model or user free-text reaches the DOM unescaped — the founding rule ("model output is JSON
  intent; code owns rendering") is intact.
- Session/auth crypto is sound: HMAC-SHA256 cookies, **timing-safe** comparison (`_session.js:37`),
  every parse failure returns `null` (anonymous, never a 500), expiry inside the signed payload.
- Store isolation is sound: keys are `bb:{uid}:{doc}` with `uid` from the signed session and a strict
  `DOC_RE` charset — no cross-user access, no key injection.
- OAuth CSRF is enforced: signed `state` cookie echoed and checked on callback (`auth.js:178-179`).
- No secret ever reaches the browser: `ANTHROPIC_API_KEY` and `STRIPE_SECRET_KEY` are server-only;
  the browser talks to same-origin proxies (`/api/chat`, `/api/billing`) that hold the keys.

---

## 2. Severity ranking (consolidated across all three audit passes)

| # | ID | Sev | One-line |
|---|----|-----|----------|
| 1 | **M1 / A1 / A2** | HIGH | `stripe` runtime dep breaks the zero-dep rule **and** crashes fresh-clone `npm run dev`/`npm start` (`MODULE_NOT_FOUND`, verified) |
| 2 | **A3** | HIGH | Stripe webhook raw-body: `config` export is a Next.js-only mechanism, **likely ignored** on `@vercel/node` → every webhook 400s → paying users never upgraded |
| 3 | **A4b** | HIGH | Anonymous `/api/chat` is unmetered → anyone can burn the owner's Anthropic key; Free users bypass the 25-msg meter by signing out |
| 4 | **T2** | HIGH | No CI — nothing runs the 40/40 suite on PR/push; the v0/cursor merges landed unchecked |
| 5 | **A4a** | MED | Client swallows the server's `402` usage-limit reply → server's authoritative gate is dead code; only an optimistic cached pre-check works |
| 6 | **A5** | MED | 400 KB store cap vs. an ever-growing `projects:index` (embeds thumbnails) → Pro users silently stop cloud-syncing their index at ~26 projects |
| 7 | **M2 / H1** | MED | Package-manager split: npm scripts + gitignored `package-lock.json`, but `vercel.json` runs `pnpm install --frozen-lockfile`; `--ignore-scripts` dropped → Playwright browser download on every deploy |
| 8 | **M3 / A6** | MED | Entire SaaS layer + font/palette overhaul undocumented; `DEPLOYMENT.md` stale (says "one function"; omits all `STRIPE_*` envs + webhook setup) |
| 9 | **T1** | MED | Zero test coverage for billing / entitlements / webhook |
| 10 | **A7** | LOW | Webhook renewal date always `null` — `current_period_end` moved to `items[]`; the fix is one line (the item is already in scope) |
| 11 | **S1** | LOW | `billing.js:88` leaks raw `error.message` (Stripe/internal) to the browser |
| 12 | **S2** | LOW | `origin()` trusts `x-forwarded-host` when `APP_ORIGIN` is unset; the mitigation (set `APP_ORIGIN` in prod) is undocumented |
| 13 | **M4** | LOW | ~865 KB unreferenced `.v0-*.png` at repo root + ~56 KB orphan `bitter-*.woff2` |
| 14 | **A9 / S3 / M5 / M6** | LOW | Cluster: post-checkout race; Free-tier numbers duplicated client/server; unhandled 409/404 checkout errors; `incrementAI` TTL-set-once orphan-key edge; double-print listener stacking (harmless); forward-dated `apiVersion` pin |
| 15 | **B1 / B2** | HYGIENE | 2 merged branches + 3 `v0/*` branches (zero unique work) still on remote → delete (note: v0 may recreate its branches) |

---

## 3. Ship-blockers (HIGH) — detail

### M1 / A1 / A2 — `stripe` dependency breaks zero-dep rule and crashes fresh clone
- **Where:** `api/billing.js:3` and `api/stripe-webhook.js:3` `require('stripe')`; `package.json`
  now has a `dependencies` block; `serve.js:71-72` **eager-requires** both modules at top level.
- **Evidence (verified):** with `node_modules/stripe` absent (as in a fresh clone),
  `node -e "require('stripe')"` → `MODULE_NOT_FOUND`. Because `serve.js` requires `billing.js` and
  `stripe-webhook.js` at load, `npm run dev`, `npm start`, and `npm run test:cloud` all crash on boot.
  `npm test` is **unaffected** — verified: the suite passed 40/40 with `stripe` absent, because
  `server.test.js`'s require graph never reaches billing/webhook.
- **Impact:** violates the rule stated verbatim in `CLAUDE.md`, `AGENTS.md`, `DEPLOYMENT.md`, and the
  `serve.js` header ("zero-dependency"). Breaks the "clone + `node serve.js` just works" contract.
- **Fix (recommended — preserves the founding rule):** hand-roll the **four** Stripe REST calls the
  code actually uses — `customers.create`, `checkout.sessions.create`, `billingPortal.sessions.create`,
  and webhook signature verification (`webhooks.constructEvent` = HMAC-SHA256 over the raw body) —
  using `fetch` + `node:crypto`, exactly as `api/_kv.js` already hand-rolls the KV REST client.
  This keeps the deliverable a zero-dep app.
- **Fix (alternative — if a dep is accepted):** lazy-`require('stripe')` **inside** the handlers so a
  keyless/offline clone still boots, **and** explicitly amend the zero-dep rule in all four docs.
  This is the lesser option; it concedes the rule the whole build is organized around.

### A3 — Stripe webhook raw body (the resolved open conflict)
- **The conflict:** agent 2 read `module.exports.config = { api: { bodyParser: false } }`
  (`stripe-webhook.js:62`) as sufficient; agent 1 flagged that Vercel may not honor it.
- **Resolution — agent 1 is correct; treat as likely-broken until proven otherwise.** The
  `config.api.bodyParser` export (ESM `export const config` **or** CJS `module.exports.config`) is a
  **Next.js `pages/api`** convention, read by the Next.js server. This project deploys **standalone
  `@vercel/node` functions** (`vercel.json` `framework: null`, functions auto-detected from `/api`),
  for which that export is **not** the supported body-parsing switch. The `@vercel/node` runtime
  auto-parses a JSON body and populates `req.body` as an **object**. `rawBody()` then matches neither
  the `Buffer` nor the `string` branch, falls through to reading the request stream — which is already
  consumed — and gets an **empty buffer**. `stripe.webhooks.constructEvent(...)` throws →
  **every webhook returns 400** → `customer.subscription.*` events are never processed →
  **a user who pays is never marked Pro.**
- **This is critical and silent:** checkout succeeds, the customer is charged, and entitlements never
  flip. The only symptom is "I paid but I'm still on Free."
- **Action:** **must** be validated against a real deploy with `stripe listen` + `stripe trigger
  customer.subscription.created` before launch. The robust fix does **not** depend on the config flag:
  capture the raw request bytes before any parse on the actual runtime (and note this is the *same*
  raw-body requirement if M1 is fixed by hand-rolling `constructEvent`).

### A4b — anonymous `/api/chat` is unmetered
- **Where:** `chat.js:66` gates usage **only** `if (session)`. A request with no `bb_sess` cookie skips
  the meter entirely and is proxied straight to Anthropic on the owner's key.
- **Impact:** (1) unauthenticated abuse — anyone who finds the endpoint can burn the owner's Anthropic
  budget; (2) the 25-msg Free meter is trivially bypassed by signing out. Metering "fails open" is a
  deliberate resilience choice for *storage outages*, but **no-session-at-all** is a hole, not a
  fail-open.
- **Fix:** require a valid session on `/api/chat` (the app already provisions anonymous device
  identity elsewhere), **or** add an IP/shared-cap rate limit for sessionless requests. Pair with a
  per-key spend ceiling at the provider.

### T2 — no CI
- **Where:** no `.github/` directory at all (verified). Nothing runs `npm test` on PR or push.
- **Impact:** the exact reason #23–#26 merged with a rule-breaking dependency, no tests, and stale
  docs. There is no guardrail.
- **Fix:** add `.github/workflows/ci.yml` — `node ≥18`, `npm ci --ignore-scripts`,
  `npm run build`, `npm test`, and a **dist-sync check** (`node build.js` then fail if
  `git diff --exit-code dist/index.html` is non-empty) to enforce H3 mechanically.

---

## 4. Medium & low findings — detail

### A4a (MED) — 402 swallowed on the client
`proxyTransport` (`src/ai.js:311`) special-cases only 404/405/503; a `402` is `!response.ok` and throws
a generic error. `rawCall` re-throws (proxy still "alive"), and `respond()`'s catch
(`src/ai.js:483-485`) returns `localModel(...)` with `local:true` → the user silently drops to the
**offline parser**. The server's `402` `billing` payload is never read. A client-side pre-check exists
(`ui.js:1339-1343`) that opens the upgrade dialog from **cached** usage, so the single-device common
case is covered — but the server's authoritative gate is dead, so a stale cache (multi-device/tab, or
the exact threshold-crossing message) yields a confusing offline fallback instead of the upgrade
prompt. **Fix:** detect `402` in `proxyTransport`, surface it distinctly, and drive
`BB.Billing.open(...)` from the server's `billing` payload.

### A5 (MED) — store value cap vs. growing index
`store.js:31` caps a value at 400 KB (413 above it). The client's `projects:index` embeds ~15 KB
thumbnails per project; Pro is "unlimited projects." At ~26 projects the index PUT exceeds 400 KB →
413 → cloud index silently stops updating while the local write succeeds and the UI shows "saved."
**Fix:** stop embedding thumbnails in the index (store each thumb as its own doc, or drop thumbs from
the synced index), or page the index across keys.

### M2 / H1 (MED) — package-manager split
`.gitignore` ignores `package-lock.json` (npm intent) while `vercel.json:4` runs
`pnpm install --frozen-lockfile` (pnpm) and the docs say `npm install --ignore-scripts`. `pnpm-lock.yaml`
is committed. Also `--ignore-scripts` was dropped, so Playwright's postinstall browser download now
runs on **every Vercel deploy** (slow, can fail the build). **Fix:** pick one manager — align
`vercel.json`, `.gitignore`, and docs — and restore `--ignore-scripts` (or set
`PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1`) on the deploy install.

### M3 / A6 (MED) — documentation drift
The SaaS layer (billing, entitlements, webhook, chat auth/metering) is undocumented in
`CLAUDE.md`, `AGENTS.md`, `DEPLOYMENT.md`, and `docs/` (only `.env.example` was updated). `DEPLOYMENT.md`
still says "one serverless function" (there are 5), omits the four `STRIPE_*` envs and the webhook
registration steps, and says `npm install --ignore-scripts` while `vercel.json` uses pnpm. The
Bitter→Fraunces/Hanken/Plex font swap + palette overhaul never reached the designated UI system of
record (`docs/ui/brand-system.md`, `brand-system.html`, `DESIGN.md:39`, `CLAUDE.md:66`). `CLAUDE.md:57`'s
headless-exclusion list doesn't name `billing.js`. **Fix:** one documentation pass covering the SaaS
architecture, the full env matrix, webhook setup, and the font system-of-record update.

### T1 (MED) — no billing/entitlement/webhook tests
`test/server.test.js` covers sessions/auth/store only. Nothing exercises entitlement math
(`_entitlements.js`), the checkout/portal flows, or webhook signature + subscription-record handling.
**Fix:** extend `server.test.js` — entitlement status transitions, `incrementAI` + monthly reset,
webhook signature accept/reject and `customer.subscription.*` → `setSubscription`. (If M1 is fixed by
hand-rolling Stripe, these become pure-Node testable with no network.)

### LOW cluster
- **A7** — `stripe-webhook.js:30` reads `subscription.current_period_end`, moved to
  `items[].current_period_end` in the pinned `2026-05-27.dahlia` API. `subscriptionRecord` already
  destructures `item = subscription.items.data[0]`, so the fix is one line:
  `item && item.current_period_end ? new Date(item.current_period_end*1000).toISOString() : null`.
- **S1** (new, my sweep) — `billing.js:88` returns `{ error:'billing_error', message: error.message }`,
  leaking raw Stripe/internal text to the client. Other handlers use fixed codes; match them.
- **S2** (new, my sweep) — `origin()` in `auth.js:71` / `billing.js:13` trusts `x-forwarded-host` when
  `APP_ORIGIN` is unset (used for OAuth `redirect_uri` and Stripe `success_url`/`cancel_url`). Not
  directly exploitable (an attacker can't ride the victim's cookie; providers validate the URIs), but
  **set `APP_ORIGIN` in production** and document it as required.
- **S3** (new, my sweep) — `_entitlements.js:49` sets the monthly TTL only when `count === 1`; if that
  `EXPIRE` fails (best-effort, swallowed in `chat.js:118`), that month's key persists without a TTL.
  Harmless (each month keys separately) but leaks orphaned KV keys.
- **M4** — remove the four `.v0-*.png` (~865 KB, referenced nowhere — the `DEPLOYMENT.md` "v0-specific"
  hit is an unrelated string) and the three orphan `vendor/fonts/bitter-*.woff2` (~56 KB, unreferenced
  since the font swap).
- **A9 / M5 / M6** — post-checkout race (webhook async vs `/?billing=success` refresh; A4a fix + a short
  retry covers it); Free-tier constants duplicated in `src/billing.js:6` vs `_entitlements.js:5-8`
  (single-source them); unhandled 409/404 checkout errors show a generic message; double-print listener
  stacking is harmless; confirm the forward-dated `apiVersion` pin against the live API once.

### B1 / B2 (HYGIENE) — stale branches (all still on remote, verified)
- **B1:** `claude/claude-md-docs-1wsvyz` (merged #19) and `cursor/frontend-diy-audit-30fa` (merged #21)
  — tips are ancestors of `main`. Safe to delete.
- **B2:** `v0/hannah-ric-46f0a4db`, `-b5015d1c`, `-d72f1e74` point at commits already in `main` (merge
  commits of #25/#24 and current HEAD) — zero unique work. Safe to delete, **but v0 integration may
  recreate them** — coordinate before deleting.
- **B3/B4:** PRs #1/#2 were intentional planning drafts (closed-unmerged); no open issues; no stranded
  unmerged work anywhere. No action.

*(Branch deletion is an outward, hard-to-reverse action and the `v0/*` set may be tool-managed, so this
report recommends rather than performs it — the maintainer should confirm and delete.)*

---

## 5. Remediation plan (phased)

**P0 — before any real deploy (the four blockers + the silent-payment risk):**
1. **M1** — restore zero-dep by hand-rolling the 4 Stripe REST calls (recommended), or lazy-require +
   amend the rule in all four docs.
2. **A3** — validate webhook raw-body on a live deploy with the Stripe CLI; fix with a runtime-correct
   raw-body capture (independent of the `config` flag). Fold into M1's hand-rolled `constructEvent`.
3. **A4b** — require a session or rate-limit sessionless `/api/chat`; add a provider spend ceiling.
4. **T2** — add CI (`npm ci --ignore-scripts` → build → `npm test` → dist-sync check).

**P1 — correctness & operability:**
5. **A4a** — surface `402` distinctly and drive the upgrade dialog from server truth.
6. **A5** — stop embedding thumbnails in the synced index.
7. **M2/H1** — converge on one package manager; restore `--ignore-scripts` on deploy.
8. **M3/A6** — document the SaaS layer, env matrix, webhook setup, and font system-of-record.
9. **T1** — add billing/entitlement/webhook tests.

**P2 — polish & hygiene:**
10. **A7** — one-line item-scoped `current_period_end`.
11. **S1/S2/S3** — stop leaking `error.message`; document `APP_ORIGIN`; note the TTL edge.
12. **M4** — delete `.v0-*.png` + orphan bitter fonts.
13. **A9 cluster** — single-source Free-tier constants; tidy checkout error messaging.
14. **B1/B2** — delete the merged branches (coordinate on `v0/*`).

---

## 6. Verified-OK — do not re-check
Route parity dev/prod incl. billing + webhook mounted in `serve.js`; chat request/response shape and
probe status codes; transport chain intact post-#25 (browser never holds a key; direct-Anthropic is
non-browser-only); store GET/PUT/DELETE shapes + `DOC_RE`; auth `me`/`logout`/OAuth CSRF state;
`bb_sess` HMAC cookie flags + timing-safe verify; entitlement shape end-to-end incl. UI gates; chat
metering fails open **for signed-in users** by design (the *anonymous* hole is A4b, tracked); `{{JS_BILLING}}`
build wiring + load order + correct SRC-array exclusion (DOM-dependent); `vercel.json` serves `dist` at
`/` and `api/*` as functions; `pnpm-lock` in sync with `package.json` today; **client XSS surface clean**
(disciplined `esc()` on every dynamic `innerHTML`); **`dist/index.html` byte-identical to a fresh build**;
**`npm test` 40/40 green without `stripe` installed**. PR #23 entirely clean; font build wiring 11↔11;
dist rebuilt and in sync across #23–#26; no CSP exists (predates these PRs; billing uses Stripe-hosted
redirect so no Stripe.js/CSP need).

---

## 7. Appendix — agent-3 security sweep (what was checked)
Direct read of the full `api/` layer (`chat.js`, `billing.js`, `stripe-webhook.js`, `auth.js`, `store.js`,
`_session.js`, `_entitlements.js`, `_kv.js`) and the client integration (`src/ai.js` transports +
`respond()`, `src/billing.js`, `src/ui.js` DOM sinks). Checked for: unauthenticated access (→ A4b),
error-detail leakage (→ S1), host-header trust / open-redirect (→ S2, low), XSS via AI/user free-text
(clean — `esc()` everywhere), session forgery / timing attacks (clean — timing-safe HMAC), cross-user
store access / key injection (clean — signed `uid` + charset), OAuth CSRF (clean — signed state),
webhook signature handling (correct approach; raw-body delivery is A3), secret exposure to the browser
(none), and KV TTL/counter edges (→ S3, informational). No SQL/NoSQL injection surface (KV is
key-scoped), no `eval`/`Function`/`document.write`, no external runtime fetches in `dist`.
