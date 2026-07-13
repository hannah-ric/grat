# The AI-Assisted Development Workflow

**A complete, production-oriented workflow for building software with AI coding assistants and modern development platforms.**

This guide describes an end-to-end process — from planning through long-term maintenance — written from the perspective of a senior engineer who uses AI assistants daily. It is opinionated where opinions save time, and explicit about the one thing that matters most:

> **AI accelerates execution. Humans own architecture.**
> Every phase below is annotated with what to delegate to AI, what to keep in human hands, and the guardrails that keep the codebase clean while moving fast.

---

## Table of Contents

1. [Operating Principles](#1-operating-principles)
2. [Planning & Requirements](#2-planning--requirements)
3. [UI Design](#3-ui-design)
4. [Frontend Architecture](#4-frontend-architecture)
5. [Backend Systems](#5-backend-systems)
6. [Authentication & Authorization](#6-authentication--authorization)
7. [Databases & Data Modeling](#7-databases--data-modeling)
8. [API Design](#8-api-design)
9. [Third-Party Integrations](#9-third-party-integrations)
10. [Testing Strategy](#10-testing-strategy)
11. [Debugging](#11-debugging)
12. [CI/CD & Deployment](#12-cicd--deployment)
13. [Documentation](#13-documentation)
14. [Monitoring & Observability](#14-monitoring--observability)
15. [Maintenance & Evolution](#15-maintenance--evolution)
16. [Where AI Accelerates — Summary Matrix](#16-where-ai-accelerates--summary-matrix)
17. [Guardrails: Clean Architecture Under AI Velocity](#17-guardrails-clean-architecture-under-ai-velocity)
18. [Reference Stack](#18-reference-stack)

---

## 1. Operating Principles

Five rules govern everything that follows.

### 1.1 AI writes code; you write constraints

The quality of AI output is a function of the constraints you give it. A vague prompt produces plausible-looking code that satisfies no invariant. Investment goes into:

- **Repository rules files** (`CLAUDE.md`, `.cursorrules`, `AGENTS.md`) that encode conventions: naming, folder structure, error-handling idioms, forbidden patterns.
- **Type systems and schemas** (TypeScript strict mode, Zod, database constraints) that make wrong code fail to compile rather than fail in production.
- **Tests as specifications** — write the failing test first, then let AI make it pass.

### 1.2 Small, reviewable increments

AI can generate a 3,000-line change in one shot. Never accept one. Work in increments a human can review in under 15 minutes: one endpoint, one component, one migration. Velocity comes from the *cadence* of small verified steps, not the size of any single step.

### 1.3 The human review gate is non-negotiable

Every AI-generated change passes through the same gate as human code: lint, typecheck, tests, and a human reading the diff. AI code review tools (see §15) are a *pre-filter*, not a replacement for the gate.

### 1.4 Buy the undifferentiated, build the differentiated

Modern platforms (managed auth, managed Postgres, serverless deployment, payment APIs) eliminate entire categories of work. Default to managed services for anything that isn't your product's core value. AI assistants are exceptionally good at wiring up well-documented platforms — that's where their training data is deepest.

### 1.5 Everything reproducible, everything in git

AI-assisted work amplifies the cost of hidden state. Environment setup is scripted, infrastructure is declared as code, database changes are migrations, and decisions are written down (§13). If an AI agent — or a new teammate — can't reconstruct the system from the repo, the workflow is broken.

---

## 2. Planning & Requirements

**Goal:** a written, reviewable plan before any code exists.

### Process

1. **Draft the PRD with AI as a thinking partner.** Describe the problem, target user, and constraints in prose. Ask the assistant to challenge the framing: *"What's ambiguous here? What edge cases am I not seeing? What would you cut from a v1?"* AI is excellent at enumerating cases you'd find at implementation time — moving that discovery to hour one is one of its highest-leverage uses.
2. **Decompose into vertical slices.** Each slice is a thin end-to-end path (UI → API → DB) that ships independently. Ask AI to propose a slicing, then re-order it yourself by risk: build the slice most likely to invalidate the architecture *first*.
3. **Write Architecture Decision Records (ADRs)** for choices with lock-in: database, auth provider, hosting, API style. A useful prompt pattern: *"Compare Postgres-via-Neon vs. Supabase vs. PlanetScale for this workload. Produce an ADR with context, options considered, decision, and consequences."* AI drafts; you decide and sign.
4. **Estimate with reference-class thinking, not vibes.** AI-assisted work compresses implementation time dramatically but does *not* compress integration debugging, review, or product iteration. A working heuristic: cut coding estimates by ~50%, leave everything else alone.
5. **Plan the plan-mode.** Tools like Claude Code have an explicit plan mode: the agent researches the codebase and proposes an implementation plan you approve before it edits anything. For any task over ~an hour, require a plan first. Rejecting a bad plan costs minutes; rejecting a bad implementation costs hours.

### AI acceleration here

| Task | Delegate to AI? | Notes |
|---|---|---|
| PRD drafting & edge-case enumeration | ✅ Heavily | AI surfaces cases fast; you arbitrate scope |
| Competitive/technical research | ✅ With verification | Demand sources; verify claims about pricing & limits |
| Work breakdown into slices | ✅ First draft | Human re-orders by architectural risk |
| Architecture decisions | ⚠️ Draft only | ADRs are signed by a human — this is the "humans own architecture" rule in action |
| Estimation | ⚠️ Sanity-check only | AI is systematically optimistic about integration effort |

---

## 3. UI Design

**Goal:** a design system and screen designs that are cheap to change, established *before* heavy frontend investment.

### Process

1. **Start from a design system, not a blank canvas.** Pick a component foundation early — [shadcn/ui](https://ui.shadcn.com) (Radix primitives + Tailwind, code you own) is the current default for React apps; Material or Mantine are fine alternatives. AI assistants produce dramatically better UI code when targeting a known system because the vocabulary is constrained.
2. **Prototype with AI UI generators.** Tools like v0, or asking your coding assistant directly for a screen ("build the settings page: profile section, notification toggles, danger zone"), produce workable first drafts in minutes. Treat these as *sketches* — throw away freely.
3. **Define design tokens before screens.** Colors, spacing scale, typography, radii — as CSS variables or a Tailwind theme. Tokens are the contract that keeps AI-generated screens visually coherent. Put the token file's path in your rules file so every generation uses it.
4. **Design states, not just screens.** For every screen enumerate: loading, empty, error, partial-permission, and overflowing-content states. This is a great AI prompt: *"List every state this screen can be in, then implement the empty and error states."* Most AI-generated UIs are missing exactly these states unless asked.
5. **Accessibility is a requirement, not a pass.** Instruct the assistant (via rules file) to always emit semantic HTML, label form controls, and manage focus. Verify with automated checks (`eslint-plugin-jsx-a11y`, axe in Playwright tests).

### Where humans stay in the loop

Information architecture, interaction flow, and taste. AI reproduces the median design of its training data; a product that should feel distinct needs human design direction, captured as tokens and reference screenshots the AI can then follow.

---

## 4. Frontend Architecture

**Goal:** a frontend where AI can add features quickly *without* entropy accumulating.

### Recommended shape

- **Framework:** Next.js (App Router) or Remix for full-stack React; SvelteKit if the team prefers it. Pick boring and well-documented — AI assistance quality tracks documentation volume.
- **Language:** TypeScript, `strict: true`, no exceptions. The type checker is your highest-throughput reviewer of AI output.
- **Structure: feature folders, not layer folders.**

  ```
  src/
    features/
      billing/
        components/     # feature-private UI
        api.ts          # typed client calls for this feature
        hooks.ts
        types.ts
      projects/
        ...
    components/ui/      # design-system primitives only (owned, from shadcn)
    lib/                # true cross-cutting utilities (keep tiny)
    app/                # routes: thin — compose features, no logic
  ```

  Feature folders matter *more* in AI-assisted work: they bound the context an agent needs to load, and they localize the blast radius of a bad generation.
- **Server state vs. client state:** TanStack Query (or framework loaders) for anything from the server; keep client state minimal (Zustand or plain context). Never mirror server data into a client store — this is the most common architectural mistake in AI-generated frontends, so name it explicitly in your rules file as forbidden.
- **Validation at the boundary:** every API response parsed with Zod schemas shared with the backend (§8). AI-generated fetch code that "just casts" is rejected in review.

### AI workflow for frontend tasks

1. Point the assistant at an existing feature folder as the exemplar: *"Add a `notifications` feature following the structure and conventions of `features/billing`."* Imitation of in-repo patterns beats abstract instructions.
2. Generate the component with all states (§3.4), then the hook, then the tests — in that order, reviewing each.
3. Screenshot-driven iteration: agents that can run the app and take screenshots (Claude Code + Playwright) can self-correct visual issues. "Run the dev server, screenshot `/settings`, and fix the layout overflow" is a real, working prompt.

---

## 5. Backend Systems

**Goal:** a backend with explicit boundaries, where business logic is isolated from frameworks and AI can safely extend it.

### Recommended shape

- **Runtime/framework:** Node + Next.js API routes or Hono for TypeScript-native teams; FastAPI (Python) or Go with chi/echo where the domain demands it. Same rule: boring, documented, typed.
- **Layering — keep it to three, enforce it ruthlessly:**

  ```
  routes/       → HTTP concerns only: parse, validate, call service, map errors
  services/     → business logic: pure-ish functions, no HTTP, no raw SQL
  data/         → repository functions: all database access lives here
  ```

  This is deliberately simpler than hexagonal architecture — three layers are enough for most products, and a simple structure is one AI assistants reliably respect. The invariant to state in your rules file: **routes never touch the database; services never touch the request/response.**
- **Errors as values at boundaries:** define a small set of domain errors (`NotFoundError`, `ConflictError`, `ForbiddenError`) and one place that maps them to HTTP responses. AI-generated handlers then have an idiom to follow instead of inventing ad-hoc `try/catch` shapes.
- **Background work from day one:** anything slower than ~1s or fallible against a third party goes to a queue (Inngest, Trigger.dev, BullMQ, or the platform's native queue). AI is good at converting an inline call into a job *if* the job pattern already exists in the repo — so establish it with the first slice.

### AI workflow for backend tasks

- **Spec → test → implement.** Write (or have AI draft, then correct) the service-level test that encodes the business rule; then let the assistant implement until green. This inverts the failure mode where AI writes code and then writes tests that assert whatever the code does.
- **Idempotency and concurrency are human-specified.** AI will not spontaneously make your webhook handler idempotent or your balance update transactional. These invariants go in the task prompt, in the test, and in review checklists.

---

## 6. Authentication & Authorization

**Goal:** never hand-roll authentication; make authorization an explicit, testable layer.

### Authentication: buy it

Use a managed provider — Clerk, Auth0, WorkOS (for enterprise SSO), Supabase Auth, or your framework's blessed integration (e.g. Auth.js with a managed adapter). Reasons:

- Password storage, session fixation, token rotation, OAuth quirks, MFA, and breach response are all someone else's audited problem.
- AI assistants integrate these providers extremely well — official SDKs, abundant examples.

**Rule for AI usage:** it's fine to have AI write the *integration* (middleware, session helpers, sign-in pages). It is **not** fine to have AI write custom crypto, session token schemes, or password handling. If a diff contains `crypto.` or `jwt.sign` outside your provider's SDK, that's a review flag.

### Authorization: build it, small and central

- One module — `lib/authz.ts` or a `policies/` folder — containing every permission check: `can(user, action, resource)`. No inline role checks scattered through routes.
- Model roles/permissions in the database from the start (even if v1 has two roles). Retrofitting is much costlier than the one table it takes.
- **Test it exhaustively.** Authorization tests are the single best ROI for AI test generation: *"Enumerate every route in `routes/`, and generate a test matrix asserting each role's access to each one, including the unauthenticated case."* This is tedious for humans and mechanical for AI — a perfect delegation.
- Multi-tenant apps: tenancy checks live in the data layer (every repository function takes a tenant/org ID), optionally backed by Postgres row-level security. Never rely on the route layer remembering to filter.

---

## 7. Databases & Data Modeling

**Goal:** Postgres, migrations in git, schema as the strongest reviewer of AI code.

### Choices

- **Default to Postgres**, managed: Neon (serverless, branching), Supabase (Postgres + auth + storage + realtime), or RDS for teams already on AWS. Reach for anything else only with a written ADR justifying it.
- **ORM/query layer:** Drizzle or Prisma for TypeScript; SQLAlchemy for Python. Both give you typed schemas AI can read and migrations you can review.
- **Migrations are code-reviewed like code**, and they're forward-only in production. Every schema change is a migration file in git — never a hand-run `ALTER TABLE`.

### AI workflow for data modeling

1. **Schema design as a dialogue.** Describe entities and access patterns; ask AI for a schema *with rationale and the queries each index serves*. Then interrogate it: "What breaks at 10M rows? Where will we regret nullable columns?" AI is genuinely strong at normalization mechanics and index selection; it's weak at knowing your future product direction — that's the human contribution.
2. **Constraints over conventions.** Encode invariants in the schema: `NOT NULL`, `UNIQUE`, foreign keys, `CHECK` constraints, enums. Every constraint is a tripwire that catches bad AI-generated writes at the database instead of in production data.
3. **Migration safety review.** Before applying, ask the assistant: *"Will this migration lock the table? Is it safe against a running deployment of the previous version?"* — then verify the answer for anything touching large tables. Expand-migrate-contract (add new column → dual-write → backfill → switch reads → drop old) is the pattern to demand for renames and type changes.
4. **Query optimization.** Paste `EXPLAIN ANALYZE` output into the assistant. This is one of the best-performing AI debugging tasks in practice — plans are structured, and the fix space (index, rewrite, denormalize) is well understood.
5. **Use database branching for AI experiments.** Neon/Supabase branch databases pair perfectly with agent worktrees: an agent gets a real database it can migrate and seed without touching shared environments.

---

## 8. API Design

**Goal:** a typed contract between frontend and backend that both humans and AI treat as the source of truth.

### Choices

- **Same-repo TypeScript full-stack:** tRPC or Next.js server actions — end-to-end types with zero schema duplication.
- **Public or multi-client API:** REST with an OpenAPI spec, generated from code (e.g. Hono + `@hono/zod-openapi`, FastAPI's built-in generation) — never hand-maintained in parallel.
- **GraphQL** only with a concrete need (many heterogeneous clients composing data); it adds a caching and authorization complexity tax that most products never repay.

### Contract-first with AI

1. Define the resource's Zod/Pydantic schema first — request, response, and error shapes. This single artifact then drives validation, types, OpenAPI docs, and the frontend client.
2. Let AI generate the handler, client hook, and tests *from the schema*. Generation from a contract is far more reliable than generation from prose.
3. **Consistency is a lintable property.** Document your API conventions (naming, pagination shape, error envelope, versioning policy) in one markdown file, referenced by your rules file. When AI adds endpoint #40, it should be indistinguishable in style from endpoint #1.
4. Version pragmatically: additive changes freely; breaking changes behind `/v2` or a header, with a deprecation window. AI can audit this: *"Diff these two schema versions and list every breaking change."*

---

## 9. Third-Party Integrations

**Goal:** integrations that are isolated, fake-able in tests, and resilient to the third party's bad day.

### Process

1. **Wrap every external service in an adapter** — one module per provider (`integrations/stripe.ts`, `integrations/resend.ts`) exposing *your* domain's interface, not the provider's. The rest of the codebase imports the adapter, never the SDK. This keeps provider swaps and API-version bumps to one file, and gives tests one seam to fake.
2. **Standard resilience kit per adapter:** timeouts, retries with exponential backoff and jitter (idempotent operations only), and failure logging with enough context to replay. AI generates this boilerplate perfectly — make it part of the adapter template in your repo.
3. **Webhooks: verify, dedupe, defer.** Verify the signature, record the event ID for idempotency, enqueue for async processing, return 200 fast. This four-step shape should be a documented pattern AI copies for every new webhook.
4. **Secrets** live in the platform's secret manager (Vercel/Railway/Fly env vars, Doppler, AWS Secrets Manager). Never in git, never in AI chat context. `.env.example` documents shape without values.

### AI acceleration here

Integration work is where AI assistants shine brightest: SDK wiring, payload mapping, and webhook handlers are pattern-dense and heavily represented in training data. Two cautions: **(1)** AI may target an outdated API version — always cross-check against the provider's current docs (assistants with web/doc access, or an MCP server for the provider, mitigate this); **(2)** AI-drafted retry logic must be checked for idempotency assumptions — retrying a non-idempotent charge is a production incident.

---

## 10. Testing Strategy

**Goal:** a test suite that lets you accept AI-generated changes with confidence — the test suite *is* the safety system of an AI-assisted workflow.

### The shape

| Layer | Tooling (TS reference) | What it covers | Proportion |
|---|---|---|---|
| Static | TypeScript strict, ESLint, Zod at boundaries | Wrong shapes, dead code, convention drift | "free" |
| Unit | Vitest | Services & pure logic, exhaustive edge cases | most tests |
| Integration | Vitest + Testcontainers (real Postgres) | Repositories, route handlers, authz matrix | the confidence layer |
| End-to-end | Playwright | 5–15 critical user journeys only | few, stable |

### AI workflow for testing

1. **Tests-first for business logic** (§5). The failing test is the spec; the AI implements against it.
2. **AI-generated edge-case suites.** After a human writes the happy-path test, delegate: *"Generate edge-case tests: empty inputs, unicode, timezone boundaries, concurrent calls, permission denials."* Review generated tests for one specific failure mode: **assertions that encode the implementation's current behavior rather than the requirement.** A test asserting a wrong-but-current output is worse than no test.
3. **The authz matrix** (§6) and **the serializer/schema round-trip suite** are the two highest-value fully-delegable test categories.
4. **Coverage as a ratchet, not a target.** Enforce "coverage may not decrease" in CI rather than chasing a number — AI can trivially generate assertion-free tests that inflate coverage, which is why the number alone means nothing.
5. **E2E discipline:** keep Playwright specs few and semantic (`getByRole`, not CSS selectors). AI is good at writing these from a user-story prompt and even better at *repairing* them when the UI changes — paste the failure trace and the new DOM, get a fix.

---

## 11. Debugging

**Goal:** shorten the loop from symptom to root cause; use AI as the fastest hypothesis generator available.

### The loop

1. **Reproduce first.** Turn the bug report into a failing test *before* fixing (AI drafts the repro from the report). This converts every bug into a permanent regression guard.
2. **Feed AI real evidence, not summaries.** Full stack traces, the actual log lines, the relevant code, `git log -p` of the suspect file, the `EXPLAIN` plan. Structured evidence in → grounded hypotheses out; vibes in → hallucinated causes out.
3. **Let agentic tools drive the loop.** Claude Code-style agents can run the failing test, read output, instrument code, re-run, and iterate autonomously. For well-reproduced bugs this regularly one-shots root causes. Keep the human on: "is this the root cause or a symptom patch?"
4. **`git bisect` + AI** for regressions: bisect finds the commit mechanically; AI explains *why* the commit broke behavior and proposes the minimal fix.
5. **Production debugging** starts from observability (§14): trace ID → spans → logs. Paste the trace into the assistant with the relevant handler code; ask for ranked hypotheses with a discriminating test for each.

**Anti-pattern to ban:** letting an AI "fix" a bug it cannot reproduce, without a test. That's how symptom-patches and regressions enter the codebase — the repro-first rule (step 1) exists to prevent it.

---

## 12. CI/CD & Deployment

**Goal:** every merge is deployable; every deploy is boring, observable, and reversible.

### Pipeline (GitHub Actions reference)

```
PR opened   → lint + typecheck + unit/integration tests + build
            → preview deployment (Vercel/Railway/Fly per-PR environment)
            → AI code review pass (pre-filter for human review)
Merge       → full suite + E2E against preview
            → deploy to staging → smoke tests
            → deploy to production (gradual/canary where platform supports)
Always      → migrations run before app deploy; forward-only; rollback = redeploy previous app version
```

### Platform guidance

- **Frontend/full-stack JS:** Vercel or Netlify — preview deployments per PR are the killer feature for AI-assisted work: every agent-generated PR gets a URL a human can click and judge in seconds.
- **Containers/long-running services:** Fly.io, Railway, Render for speed; ECS/Cloud Run when organizational gravity demands a hyperscaler.
- **IaC:** the platform's declarative config (`fly.toml`, `vercel.json`) for simple setups; Terraform/OpenTofu or SST once you have real cloud resources. AI writes competent first-draft Terraform — *always* reviewed via `terraform plan` output, never applied blind.
- **Feature flags** (even a simple homegrown table) decouple deploy from release and make risky AI-built features safe to ship dark.

### AI acceleration here

CI configuration, Dockerfiles, and workflow YAML are prime AI territory — highly patterned and verifiable ("this workflow is failing, here's the log, fix it" works remarkably well). Agents that can watch CI (e.g. via a PR-watching session or GitHub MCP) close the loop: red build → agent reads logs → pushes fix — with a human approving the diff.

---

## 13. Documentation

**Goal:** documentation that serves *two* audiences — humans and AI agents — and stays true because it's generated or checked from source.

### The set that matters

| Artifact | Purpose | Maintained how |
|---|---|---|
| `README.md` | Setup in ≤10 minutes, architecture at a glance | Human-owned, AI-drafted |
| `CLAUDE.md` / `AGENTS.md` / `.cursorrules` | Conventions & constraints for AI assistants | **The highest-leverage doc in the repo** — every review comment you make twice becomes a line here |
| ADRs (`docs/adr/`) | Why decisions were made | Written at decision time; AI drafts from the discussion |
| API reference | Contract for clients | **Generated** from OpenAPI/schema — never hand-written |
| Runbooks (`docs/runbooks/`) | Incident response per failure mode | AI-drafted post-incident, human-verified |
| Onboarding walkthrough | Codebase tour | Regenerate with AI when stale — cheap enough to redo |

### Practices

- **Docs-from-diff:** at PR time, have the assistant check "does this change invalidate any doc?" — it's a cheap CI-adjacent step that catches drift at the moment it happens.
- **Comments explain *why*, never *what*.** AI-generated code arrives over-commented with narration; strip it in review. (State this in the rules file — most assistants comply.)
- The rules file deserves special emphasis in an AI workflow: it compounds. Every convention captured makes every future generation cheaper and cleaner. Treat it as a living style guide with an owner.

---

## 14. Monitoring & Observability

**Goal:** know about problems before users report them, with enough context that AI can help diagnose.

### The kit

- **Error tracking:** Sentry (frontend + backend, release-tagged, source maps uploaded in CI).
- **Structured logs:** JSON logs with a request/trace ID everywhere (`pino` for Node). Ship to the platform's log store or Axiom/Datadog. Structured logs matter doubly in an AI workflow — they paste cleanly into a debugging session.
- **Traces & metrics:** OpenTelemetry instrumentation from the start (framework auto-instrumentation is enough initially), exported wherever fits budget (Grafana Cloud, Honeycomb, Datadog).
- **Uptime & alerting:** external checks on key endpoints (BetterStack/Checkly); alerts routed to a channel humans actually watch.
- **The four signals to alert on:** error rate, p95 latency, queue depth/job failures, and the product's one core-funnel metric. Alert on symptoms, not causes; every alert links to its runbook (§13).

### AI acceleration here

- Instrumentation code (OTel setup, log fields, Sentry config) is boilerplate AI generates well.
- **Anomaly triage:** paste an alert + trace + recent deploy diff into the assistant for ranked hypotheses — this is the production mirror of §11's loop.
- Ask AI to *review your observability*: "Given this handler, what would we wish we'd logged when it fails at 2 a.m.?" — an unusually effective prompt.
- Platform AI features (Sentry's issue summaries and suggested fixes, Datadog's correlation) are useful pre-filters; treat their conclusions as hypotheses, exactly like any AI output.

---

## 15. Maintenance & Evolution

**Goal:** the codebase gets *easier* to work in over time, not harder — with AI doing the janitorial work it's uniquely suited to.

### The recurring loop

- **Dependencies:** Renovate or Dependabot, batched weekly, auto-merged when the full suite passes on a *trustworthy* test suite (§10 is what makes this safe). AI handles breaking-change upgrades well: feed it the release notes/codemod and the failing build; review the diff.
- **Scheduled refactoring:** budget ~10–15% of each cycle. AI turns formerly week-long chores into afternoon tasks — renames across hundreds of call sites, extracting a service from a bloated route, converting callbacks to async, deleting dead code found via coverage + usage analysis. Mechanical-but-sprawling changes are AI's single strongest category; **architectural** refactors (moving boundaries, splitting services) remain human-designed, AI-executed.
- **AI code review as standing infrastructure:** enable an AI reviewer on every PR (Claude Code `/review`-style, or GitHub's native tooling) tuned by your rules file. It reliably catches: convention drift, missing error handling, unawaited promises, N+1 queries, missing authz checks. Humans then review for: architecture fit, product correctness, and the things the rules file doesn't know yet.
- **Bug-fix hygiene:** every production bug ends as (1) a regression test, (2) a fix, and (3) where applicable, a new line in the rules file or a new lint rule so the *class* of bug is dead, not the instance. AI is good at proposing the generalization: "What lint rule or convention would have prevented this?"
- **Incident response:** humans command, AI accelerates — log archaeology, timeline reconstruction, drafting the post-mortem. Post-incident actions feed back into runbooks and alerts.
- **Periodic architecture health check:** quarterly, ask an agent to audit the repo against your own stated architecture (§17's rules): layering violations, feature-folder leaks, adapters bypassed. Entropy detection is cheap now; schedule it.

---

## 16. Where AI Accelerates — Summary Matrix

| Area | AI leverage | Delegate | Keep human |
|---|---|---|---|
| Planning | High | Edge-case discovery, PRD drafts, slicing | Scope, priorities, ADR sign-off |
| UI design | High | Screen drafts, states, a11y mechanics | Information architecture, taste |
| Frontend | High | Components, hooks, tests within established patterns | Folder/state architecture, pattern choices |
| Backend | High | Handlers, services against tests, boilerplate | Layer boundaries, concurrency & idempotency invariants |
| Auth | Medium | Provider integration, authz test matrix | Provider choice, permission model, **never custom crypto** |
| Database | High | Schema drafts, index/query tuning, migration mechanics | Data model direction, migration safety on hot tables |
| APIs | High | Handlers/clients/docs from schema | Contract design, versioning policy |
| Integrations | Very high | Adapters, webhooks, resilience boilerplate | Idempotency review, current-API-version verification |
| Testing | Very high | Edge-case suites, authz matrix, E2E repair | Happy-path specs as requirements, reviewing assertions |
| Debugging | High | Repro drafting, hypothesis generation, agentic fix loops | Root-cause vs. symptom judgment |
| CI/CD | Very high | Workflow YAML, Dockerfiles, red-build fixes | Deployment strategy, rollback policy |
| Docs | Very high | Drafts, generation from source, drift checks | Rules file curation, ADR decisions |
| Monitoring | High | Instrumentation, triage hypotheses | Alert policy, SLO choices |
| Maintenance | Very high | Upgrades, mechanical refactors, entropy audits | Architectural refactor design, incident command |

The pattern: **AI dominates wherever the work is patterned, verifiable, or sprawling-but-mechanical. Humans dominate wherever the work is choosing constraints, owning risk, or exercising taste.**

---

## 17. Guardrails: Clean Architecture Under AI Velocity

AI-assisted development fails in a specific way: not with dramatic bugs, but with **entropy** — six subtly different error-handling styles, duplicated helpers, business logic bleeding into route handlers. Each generation is locally plausible; the sum is unmaintainable. The countermeasures:

1. **The rules file is law** (`CLAUDE.md`/`AGENTS.md`): conventions, layer boundaries, forbidden patterns, exemplar files to imitate. Reviewed and versioned like code.
2. **Structural enforcement in CI**, not just prose: lint rules for import boundaries (`eslint-plugin-boundaries`, dependency-cruiser), strict types, formatting. What CI enforces, AI cannot drift.
3. **Exemplar-driven generation:** every new feature is prompted as "follow the structure of `features/billing`." The repo's best code becomes the template for its future code — which also means fixing bad patterns quickly, before they become the training set.
4. **Small diffs, always** (§1.2), with a human reading every one.
5. **"Search before create" rule** for AI: check whether a helper/component/adapter already exists before writing one. Duplication is AI's default failure mode; say so explicitly in the rules file.
6. **Scheduled entropy audits** (§15) to catch what review missed.
7. **Boundaries are the units of AI safety:** feature folders, service layers, and integration adapters each bound context and blast radius. Clean architecture isn't in *tension* with AI velocity — it's the thing that makes AI velocity sustainable.

---

## 18. Reference Stack

An opinionated, production-proven default for a new TypeScript product in 2026. Substitute per your constraints — the *workflow* above is stack-agnostic.

| Concern | Choice |
|---|---|
| Language | TypeScript (strict) everywhere |
| Framework | Next.js App Router |
| UI | Tailwind + shadcn/ui, tokens in CSS variables |
| Server state | TanStack Query / RSC loaders |
| Backend | Next.js route handlers + services layer (Hono if API-standalone) |
| Validation | Zod, schemas shared client/server |
| Database | Postgres on Neon (branching) or Supabase |
| ORM | Drizzle |
| Auth | Clerk (or Auth.js + provider; WorkOS for enterprise SSO) |
| Jobs/queues | Inngest or Trigger.dev |
| Payments | Stripe, behind an adapter |
| Email | Resend, behind an adapter |
| Testing | Vitest + Testcontainers + Playwright |
| CI/CD | GitHub Actions + Vercel preview deployments |
| Errors | Sentry |
| Logs/metrics | pino + OpenTelemetry → Axiom/Grafana Cloud |
| Uptime | Checkly / BetterStack |
| AI assistants | Claude Code (agentic implementation, review, CI babysitting) + inline-completion IDE assistant; AI reviewer on every PR |
| Dep hygiene | Renovate, weekly batch |

---

### Final word

The teams that get the most from AI assistants are not the ones that prompt best — they're the ones with the cleanest constraints: strict types, real tests, enforced boundaries, and written conventions. Every hour invested in those multiplies the value of every AI interaction that follows. Build the rails first; then let the machine run fast on them.
