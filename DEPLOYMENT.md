# Deploying Blueprint Buddy — Vercel & v0

Blueprint Buddy is a **static single-file app plus one serverless function** — no
framework, no bundler, no runtime dependencies. That maps onto exactly one
Vercel application type and gives v0 everything its sandbox needs.

## Application type

| Where | Setting |
|---|---|
| Vercel Framework Preset | **Other** (`"framework": null` in `vercel.json`) |
| v0 sandbox | **Generic Node.js project** — v0 detects and runs the `dev` script from `package.json` |
| Architecture | Static output in `dist/` + Node serverless functions auto-detected from `api/` |

## Build settings (already pinned in `vercel.json`)

| Setting | Value | Why |
|---|---|---|
| Install Command | `npm install --ignore-scripts` | The build has **zero** dependencies; the only devDependency (Playwright) is test-only, and `--ignore-scripts` skips its browser download |
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
| `AUTH_SECRET` | For accounts | Server-side only (`api/auth.js`, `api/store.js`) | Signs stateless session cookies (`openssl rand -hex 32`). |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | No | Server-side only | Enables "Sign in with Google". |
| `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` | No | Server-side only | Enables "Sign in with GitHub". |
| `KV_REST_API_URL` / `KV_REST_API_TOKEN` | For cloud sync | Server-side only (`api/store.js`) | Upstash Redis REST endpoint — auto-injected by the Vercel Marketplace integration. Upstash-native names (`UPSTASH_REDIS_REST_URL`/`_TOKEN`) also work. |
| `APP_ORIGIN` | No | Server-side only | Override the derived origin for OAuth redirect URIs (normally unnecessary). |

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
direct Anthropic (claude.ai artifact hosting) → `window.claude.complete` →
built-in offline parser. On Vercel/v0 the proxy is the live path; on claude.ai
it 404s once and the artifact behavior is unchanged.
