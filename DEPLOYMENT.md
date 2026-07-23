# Deploying Blueprint Buddy — Vercel & v0

Blueprint Buddy is a **static single-file app plus a few small serverless
functions** (`api/chat`, `api/auth`, `api/store`, `api/billing`,
`api/stripe-webhook`) — no framework, no bundler, **no runtime dependencies**
(Stripe's few REST calls are hand-rolled over `fetch` + `node:crypto`). That maps
onto exactly one Vercel application type and gives v0 everything its sandbox needs.

## Application type

| Where | Setting |
|---|---|
| Vercel Framework Preset | **Other** (`"framework": null` in `vercel.json`) |
| v0 sandbox | **Generic Node.js project** — v0 detects and runs the `dev` script from `package.json` |
| Architecture | Static output in `dist/` + Node serverless functions auto-detected from `api/` |

## Build settings (already pinned in `vercel.json`)

| Setting | Value | Why |
|---|---|---|
| Install Command | `npm install --omit=dev --ignore-scripts` | The build has **zero** runtime dependencies; `--omit=dev` skips the one devDependency (Playwright, test-only) and `--ignore-scripts` skips its browser download, so deploys install nothing and stay fast |
| Build Command | `node build.js` | Inlines `src/` + fonts + Three.js into one self-contained `dist/index.html` |
| Output Directory | `dist` | Where `build.js` writes; Vercel serves it statically |
| Development Command (`npm run dev`) | `node serve.js` | Builds, serves on `$PORT` (default 3000), watch-rebuilds `src/`/`vendor/`, and mounts `/api/chat` — production-identical behavior for local dev and the v0 preview |
| Node.js version | 18+ (`engines` field) | `api/chat.js` and `serve.js` use the built-in `fetch` |

Because `vercel.json` is committed, importing the repo on Vercel or v0 requires
**no dashboard overrides** — the settings travel with the repo.

## Environment variables

Set in **Vercel → Project → Settings → Environment Variables** (v0 inherits
them from the connected Vercel project), or via CLI:

```
vercel env add ANTHROPIC_API_KEY production
vercel env add ANTHROPIC_API_KEY preview
vercel env add ANTHROPIC_API_KEY development
```

| Variable | Required | Scope | Purpose |
|---|---|---|---|
| `ANTHROPIC_API_KEY` | For AI features | Server-side only (`api/chat.js`) | Auth for the Anthropic API. The browser never sees it — the client calls the same-origin `/api/chat` proxy. Without it, the app degrades gracefully to its built-in offline intent parser. |
| `ANTHROPIC_MODEL` | No | Server-side only | Override the model (default `claude-sonnet-5`). |
| `AUTH_SECRET` | Required for accounts & subscriptions | Server-side only (`api/auth.js`, `api/store.js`) | Signs stateless session cookies (`openssl rand -hex 32`). **Stored as a sensitive (encrypted) var on Vercel — not written by `vercel env pull`.** |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | No | Server-side only | Enables "Sign in with Google". |
| `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` | No | Server-side only | Enables "Sign in with GitHub". |
| `KV_REST_API_URL` / `KV_REST_API_TOKEN` | For cloud sync **and** subscriptions | Server-side only (`api/store.js`, `api/_entitlements.js`) | Upstash Redis REST endpoint — auto-injected by the Vercel Marketplace integration. Upstash-native names (`UPSTASH_REDIS_REST_URL`/`_TOKEN`) also work. Entitlements + AI usage counters live here too. |
| `STRIPE_SECRET_KEY` | For subscriptions | Server-side only (`api/billing.js`, `api/stripe-webhook.js`) | Stripe secret key. Enables the Free→Pro upgrade flow. Absent → billing endpoints return 503 and the app stays fully usable on Free. |
| `STRIPE_PRO_MONTHLY_PRICE_ID` / `STRIPE_PRO_YEARLY_PRICE_ID` | For subscriptions | Server-side only | The recurring Price IDs for Blueprint Buddy Pro (create one monthly, one yearly). |
| `STRIPE_WEBHOOK_SECRET` | For subscriptions | Server-side only (`api/stripe-webhook.js`) | Signing secret (`whsec_…`) for the webhook endpoint — without it, paid upgrades never activate. **Stored as a sensitive (encrypted) var on Vercel.** See the Subscriptions section below. |
| `APP_ORIGIN` | **Recommended in production** | Server-side only | Canonical origin (e.g. `https://your-app.com`) for OAuth redirect URIs and Stripe success/cancel URLs. When unset these are derived from the `Host`/`X-Forwarded-Host` header; **set `APP_ORIGIN` in production** so a spoofed header can never influence a redirect target. |
| `BB_SIGNUP_IP_CAP` | No | Server-side only (`api/_credits.js`) | Max free signup credits granted per client IP per rolling 30 days (default `5`; `0` disables). Damps throwaway-OAuth-account farming; the IP is salted-hashed, never stored, and a capped account can still sign in, save, and buy packs. For volume abuse, pair with a Vercel WAF rate-limit rule on `/api/auth`. |

## Accounts & cloud persistence (optional)

Everything above the line works with **zero** of this configured: the app
persists projects, prices, and preferences to the browser (`localStorage`)
on any static host, and to `window.storage` on claude.ai. Configure accounts
when you want projects to **follow the user across devices**:

1. **Storage** — in Vercel: *Marketplace → Upstash → Redis*, attach it to the
   project. Vercel injects `KV_REST_API_URL` + `KV_REST_API_TOKEN`
   automatically. (Any Upstash Redis works — set the two env vars by hand.)
2. **Session secret** — `vercel env add AUTH_SECRET` with the output of
   `openssl rand -hex 32`.
3. **Login providers** (either or both):
   - **Google**: Google Cloud Console → Credentials → OAuth client
     (*Web application*), authorized redirect URI
     `https://YOUR-APP.vercel.app/api/auth`. Set
     `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`.
   - **GitHub**: Settings → Developer settings → OAuth Apps, callback URL
     `https://YOUR-APP.vercel.app/api/auth`. Set
     `GITHUB_CLIENT_ID`/`GITHUB_CLIENT_SECRET`.
4. Redeploy. The **More** menu now offers *Sign in with…*; on first sign-in
   the device's existing projects migrate to the account (cloud data, when
   present, always wins — the migration never overwrites).

Implementation notes — all zero-dependency, in keeping with the repo rule:

- `api/auth.js` runs the standard OAuth 2.0 code flow itself and issues
  **stateless HMAC-signed cookies** (`api/_session.js`); no auth SDK, no
  vendor `<script>` (the single-file build stays self-contained), nothing
  stored server-side, sessions survive deploys.
- `api/store.js` is a per-user JSON document store over the Upstash REST
  API via plain `fetch`. Documents are namespaced `bb:{userId}:{doc}` and
  size-capped; users can only ever touch their own keys.
- The client (`src/store.js`) runs a driver chain — artifact → cloud →
  device → memory — and **writes through to device storage even when cloud
  is live**, so a network blip or an expired session never loses work.
- Local dev: `serve.js` mounts the same handlers and stores documents in
  `.data/kv.json` (gitignored). Add `BB_DEV_LOGIN=1` to `.env` for a
  one-click fake login while developing the signed-in experience.

**v0-specific caveats (from Vercel's docs):**

- The v0 preview sandbox can only read variables from the **Development**
  environment — add `ANTHROPIC_API_KEY` to Development (not just Production)
  if you want live AI inside v0's preview.
- Variables marked **Sensitive** are hidden from v0 previews. Use a separate,
  spend-capped development key for the Development environment and keep the
  production key Sensitive.
- Never use a `NEXT_PUBLIC_`/client-exposed variable for the key; the whole
  point of `api/chat.js` is that the key stays server-side.

Local development: `cp .env.example .env`, add your key, `npm run dev` —
`serve.js` reads `.env` itself (no dotenv dependency). `.env` is gitignored.

## Subscriptions & billing

Blueprint Buddy ships a Free/Pro model (`api/_entitlements.js` is the authority:
Free = 3 saved projects + 25 AI messages/mo + core drawing and cut-list exports;
Pro = unlimited projects + 500 messages/mo + premium exports (print plans, 3D,
SketchUp) + advanced workshop tools including full-screen Build Mode). The client
gates the Pro-only surfaces via `BB.Billing.gate('advancedFeatures'|'premiumExports')`.
All of it is optional — with no Stripe env vars the billing endpoints return 503
and everyone is on Free. To enable upgrades:

1. **Prices** — in Stripe, create a Product "Blueprint Buddy Pro" with a monthly
   and a yearly recurring Price. Set `STRIPE_PRO_MONTHLY_PRICE_ID` /
   `STRIPE_PRO_YEARLY_PRICE_ID` and `STRIPE_SECRET_KEY`.
2. **Webhook** — add an endpoint at `https://YOUR-APP/api/stripe-webhook`
   subscribed to `customer.subscription.created`, `.updated`, and `.deleted`.
   Put its signing secret in `STRIPE_WEBHOOK_SECRET`. The webhook flips a user to
   Pro when their subscription activates — **without it, checkout succeeds but the
   account is never upgraded.**
3. **Storage** — entitlements and usage counters live in the same KV as cloud
   sync, so `KV_REST_API_URL`/`_TOKEN` (or the Upstash-native names) are required
   for subscriptions to persist.
4. **Verify the webhook on the real deploy.** Because signature verification
   needs the *raw* request body, confirm it end-to-end before launch:
   `stripe listen --forward-to https://YOUR-APP/api/stripe-webhook` then
   `stripe trigger customer.subscription.created`. A `200` with the subscription
   stored is success; a `raw_body_unavailable` 400 means the platform pre-parsed
   the body (the handler surfaces that distinctly, on purpose, so a misconfigured
   runtime is obvious instead of failing every upgrade silently).

### Current production state (as of 2026-07-16)

All the above steps have been completed for `https://hannah-ric-grat.vercel.app`:

| Item | Status | Value |
|---|---|---|
| Stripe Product | Created | "Blueprint Buddy Pro" |
| Monthly Price | Created & set | `price_1Ttv6QDmAsGr64ouadZUalOQ` — $15.00/mo |
| Yearly Price | Created & set | `price_1Ttv6QDmAsGr64ouvKGZa3wR` — $144.00/yr |
| Webhook endpoint | Registered | `https://hannah-ric-grat.vercel.app/api/stripe-webhook` |
| Webhook events | Subscribed | `customer.subscription.created/updated/deleted` |
| `STRIPE_WEBHOOK_SECRET` | Set on Vercel (encrypted) | confirmed via `.vercel-env-manifest.json` |
| `AUTH_SECRET` | Set on Vercel (encrypted) | confirmed via `.vercel-env-manifest.json` |
| `KV_REST_API_URL` / `KV_REST_API_TOKEN` | Set on Vercel | Upstash Redis (all environments) |
| `APP_ORIGIN` | Set on Vercel (production) | `https://hannah-ric-grat.vercel.app` |

Run the production-readiness check at any time:

```bash
node --env-file-if-exists=/vercel/share/.env.project scripts/verify-production.js
# or simply:
npm run verify
```

This checks every integration end-to-end (Stripe key, price IDs, webhook
registration, KV connectivity) and exits 0 only when all pass. Update
`.vercel-env-manifest.json` whenever you rotate or add a sensitive env var.

### Go-live with real payments

The project currently uses **live Stripe keys** (`sk_live_...`) and **live prices**.
To accept real payments:
- Ensure your Stripe account is fully activated (bank account, business details).
- Verify the webhook end-to-end: `stripe trigger customer.subscription.created`.
- Optionally restrict the API key to the minimum permissions (Customers: write,
  Checkout Sessions: write, Billing Portal: write, Webhook Endpoints: read).

The complete pre-launch checklist of outstanding **human** inputs — decisions,
console configuration, and verification steps no script can perform — is
maintained in [`docs/audit/09-launch-human-inputs.md`](docs/audit/09-launch-human-inputs.md).

Zero-dependency, in keeping with the repo rule: `api/_stripe.js` hand-rolls the
four Stripe REST calls used (customer create, checkout session, billing-portal
session, webhook signature verification) over `fetch` + `node:crypto` — no
`stripe` SDK, no client-side Stripe.js (checkout is a Stripe-hosted redirect, so
the single-file build stays self-contained). The browser never holds a Stripe key.

AI usage is metered on `api/chat.js` for **every** request — signed-in users by
account, anonymous users by a hashed client IP, plus a small in-memory burst
limit — so the Anthropic key can't be burned unmetered and the Free cap can't be
dodged by signing out.

## Importing into v0

1. Push this repo to GitHub (default branch or any branch).
2. In v0: **New Chat → Import from GitHub** and pick `hannah-ric/grat`
   (grant the v0 GitHub app access to the repo if prompted).
3. v0 clones into its sandbox, runs `npm install --ignore-scripts`-equivalent
   dependency install, detects the generic Node project, and starts
   `npm run dev` — the preview is the real app on the real dev server.
4. Connect the chat to a Vercel project (**Project Settings → Vercel**) so
   env vars sync and **Deploy** publishes through Vercel.
5. v0 works on its own branch and commits per change; merge its PRs back.

`AGENTS.md` gives v0's agent the repo's ground rules (the AI-proposes /
code-owns-the-numbers architecture, build/test commands, where things live),
so its edits land in the right layer.

## Importing into Vercel directly

**Add New → Project → Import** `hannah-ric/grat`. The committed `vercel.json`
fills in every setting; just add the environment variables and deploy.

## Request flow in production

```
browser ──POST /api/chat──▶ api/chat.js (holds ANTHROPIC_API_KEY)
                              └──▶ api.anthropic.com /v1/messages
```

The client tries transports in order: injected (tests) → same-origin proxy →
direct Anthropic (**non-browser hosts only** — a browser never holds the key and
CORS blocks it, so this is skipped in the app) → `window.claude.complete`
(claude.ai artifact hosting) → built-in offline parser. On Vercel/v0 the proxy is
the live path; on claude.ai the proxy 404s once and `window.claude.complete`
serves the model. The proxy enforces AI usage metering (see the billing section);
the other transports are for hosts where no server proxy exists.
