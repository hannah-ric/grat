# Diagnostic Sprint — AI Custom Furniture Build-Plan Platform

**Working name:** GRAT (Generate → Refine → Assemble → Track)
**Sprint scope:** 12-hour rapid diagnostic. Product concept analysis, bare-minimum stack isolation, third-party data nodes, and strict structural build layout.
**Date:** 2026-07-13
**Verdict up front:** BUILD — with one architectural non-negotiable (see §2.1).

---

## 1. Concept Diagnostic

### 1.1 The product in one sentence

A web app where a user types "walnut console table, 60 inches, mid-century, hides a litter box" and receives an engineering-sane, fully parametric build plan — interactive 3D model, cut list, hardware list, joinery callouts, and step-by-step assembly — then edits it conversationally ("make the legs tapered, drop height 2 inches") with the model and documents updating live.

### 1.2 Market position (verified 2026-07)

| Competitor | What it does | What it lacks (your wedge) |
|---|---|---|
| Flatma | Text → buildable 3D cabinets/furniture, blueprint export | Cabinet-centric; no conversational edit loop; thin structural reasoning |
| MakeByMe (mobile) | 3D furniture design with auto cut lists (2x4, ply, tube) | Manual CAD-style design, not AI-generated; mobile-only ergonomics |
| Pixelcut / getimg / Home Design AI | Text → furniture *images* | Pictures, not plans. Nothing buildable |
| SketchUp / Fusion 360 / SketchList 3D | Pro/prosumer parametric CAD, cut lists | Days of learning curve; no AI; DIYer abandons at install |
| SWOOD (SolidWorks) | Industrial woodworking CAM | $$$; manufacturers, not DIYers |

**The open lane:** nobody pairs (a) LLM-generated *parametric* plans with (b) deterministic structural validation and (c) a chat edit loop. Image generators are toys; CAD is homework. The buyer is the "aspirational intermediate" DIYer — owns a track saw, watched 40 hours of YouTube, fears wasting $180 of walnut.

### 1.3 The core architecture insight (this is the whole product)

**The LLM never draws geometry and never does load math.** It emits a constrained JSON document (the *Plan Schema*, §5). Three deterministic systems consume that JSON:

1. **Renderer** — every furniture part is a box/extrusion primitive; Three.js draws the parts array directly. No AI meshes, no NeRFs, no GLB generation. This is why 3D is cheap.
2. **Validator** — span/sag tables, fastener pull-out limits, aspect-ratio tip-over checks, BOM arithmetic. Plain code. The LLM proposes; the validator disposes. This is why "structural engineering understanding" is *credible* rather than vibes.
3. **Document generator** — cut-list optimizer (1D bin packing against stock lengths), PDF export, hardware list with SKUs.

AI = language ↔ parameters. Code = physics, geometry, money. Keeping that boundary is the "zero technical debt" guarantee: the only custom code in the whole system is one versioned component + one validator module.

---

## 2. Bare-Minimum Platform Stack

### 2.1 The non-negotiable

No visual no-code builder renders interactive parametric 3D natively — Bubble included (community plugins / HTML-element embeds only). The 3D viewport is therefore **one deliberate code island**: a single self-contained Three.js component (~400 lines) that takes Plan JSON in and emits click events out. Everything else is genuinely no-code. Budget it, isolate it, version it — do not let it metastasize.

### 2.2 The stack — 5 nodes, nothing else

| # | Node | Choice | Role | Cost at MVP |
|---|---|---|---|---|
| 1 | App shell | **Bubble** (Starter → Growth) | Auth, pages, editor UI, workflows, admin | $29–119/mo (175K–250K WU incl.; overage $0.30/1K WU) |
| 2 | System of record | **Supabase** (Pro) | Postgres for plans/versions/catalogs, file storage for PDFs, edge function hosting the validator + cut-list optimizer | $25/mo |
| 3 | AI engine | **Claude API** (Opus 4.8) | Plan generation + conversational edit, via structured JSON output | usage-based, see §6 |
| 4 | Payments | **Stripe** (Bubble plugin + webhook → Supabase entitlements) | Subscriptions + one-off plan unlocks | 2.9% + 30¢ |
| 5 | 3D island | **Three.js** in a Bubble HTML element / private plugin | Renders Plan JSON; exploded view; part-click → spec panel | $0 (OSS) |

**Fixed floor: ~$54–144/mo** before AI usage and Stripe fees. That is the entire platform bill.

### 2.3 Why these and not the alternatives

- **Bubble over Lovable/Bolt-class AI builders:** you asked for *visual* no-code; Bubble's editor, workflow engine, and plugin marketplace are the mature path for a non-engineer operator. (If you later want the whole app as owned React code, Lovable + Supabase is the migration path — Supabase-as-system-of-record makes that swap cheap.)
- **Supabase over Xano:** $25/mo vs $85/mo entry; and it's plain Postgres — your data is portable on day one. Xano's fixed tiers buy cost predictability you don't need pre-revenue. **Supabase over Bubble's built-in DB** is the key anti-debt call: plan documents are fat JSON blobs read/written constantly; in Bubble DB that burns Workload Units *and* locks your core asset (the plan corpus) inside Bubble. Postgres `jsonb` costs nothing extra and leaves every exit door open.
- **No queue, no Redis, no vector DB, no LangChain, no separate auth provider.** Generation is a single synchronous streamed call (~20–60s). Add infrastructure only when a metric forces it.

### 2.4 Explicitly deferred (do not build in v1)

CNC/G-code export, AR view, mobile apps, community/marketplace, image-to-plan, multi-material pricing feeds, team seats, white-label. Each is a fast-follow, none is a wedge.

---

## 3. Third-Party Database Nodes (Supabase schema)

```
supabase/
├── users                 -- mirrors auth.users; display_name, skill_level
├── entitlements          -- user_id, tier(free|maker|pro), plan_credits, stripe_customer_id, status
├── projects              -- user_id, title, prompt_original, status, created_at
├── plans                 -- project_id, version_no, plan_json(jsonb), validator_report(jsonb),
│                            est_cost_usd, est_hours, is_current
├── plan_events           -- plan_id, actor(user|ai|validator), edit_prompt, json_patch(jsonb), tokens_in, tokens_out, model, latency_ms
├── materials_catalog     -- species/sheet goods: nominal dims, actual dims, density, E-modulus, Fb, price_per_bf, stock_lengths[]
├── hardware_catalog      -- sku, type(confirmat|pocket|dowel|slide|hinge), size, pack_qty, unit_price, affiliate_url
├── span_limits           -- material_id, orientation, max_span_mm per load class  ← powers the validator
├── exports               -- plan_id, kind(pdf|csv|glb), storage_path, paid(bool)
└── ai_usage_daily        -- user_id, date, calls, tokens, cost_usd  ← metering & abuse control
```

**External nodes wired to it:**
- **Stripe** → webhook → `entitlements` (single source of paywall truth; Bubble only *reads* entitlements).
- **Claude API** → called from Bubble API Connector (MVP) or a Supabase Edge Function (when you need retry/stream control); every call logged to `plan_events` + `ai_usage_daily`.
- **Supabase Storage** → generated PDFs/CSVs; signed URLs gate paid exports.

Seed data honestly scoped: ~20 materials, ~60 hardware SKUs, span table for pine/oak/maple/walnut/birch-ply/MDF. One afternoon of data entry; it powers the entire credibility layer.

---

## 4. Structural Text Layout of the Build (page tree + workflows)

### 4.1 Page tree

```
/
├── index                      -- promise, 20s demo loop, 3 sample plans (view-only), CTA
├── auth                       -- Supabase magic-link (via Bubble API Connector)
└── app/
    ├── dashboard              -- project cards: thumbnail, status chip, "duplicate/resume"
    ├── new                    -- INTAKE WIZARD (the money page)
    │     step 1: what        -- type (table/shelf/bench/desk/cabinet…), free-text intent
    │     step 2: constraints -- dims + sliders, room fit, load ("adult sits on it?")
    │     step 3: you         -- tools owned (checkbox), skill, budget band, style refs
    │     └── [Generate] ───────────► WF-1
    ├── editor/[plan_id]       -- THE PRODUCT. 3-pane layout:
    │     ├── viewport (60%)  -- Three.js island: orbit, exploded-view slider,
    │     │                      part-click highlight, dimension overlay toggle
    │     ├── chat rail (25%) -- text-to-edit box + version timeline (v1…vN, one-click revert)
    │     └── spec panel (15%)-- overall dims, per-part detail on click,
    │                            validator badges (✅ span ok · ⚠ racking risk),
    │                            est. material cost, est. build hours
    │     └── [Export ▾] ────────────► WF-3 (PAYWALL)
    ├── build/[plan_id]        -- step-by-step assembly mode: big type, one step per
    │                            screen, parts+tools for step, shop-friendly (large targets)
    ├── account                -- tier, usage meter, Stripe customer portal link
    └── admin                  -- funnel counts, gen success rate, validator-fail rate, AI spend/day
```

### 4.2 Workflow map (Bubble workflows + one edge function)

```
WF-1  GENERATE   intake form
                 → POST Claude /v1/messages (structured output = Plan Schema, streamed)
                 → edge fn: validate(plan_json)        [deterministic]
                 → if validator FAIL → one auto-repair round-trip to Claude with the
                   validator report appended → re-validate → else surface warnings
                 → INSERT plans v1 → redirect /app/editor/[id]
                 SLO: < 60s prompt-to-render

WF-2  EDIT       chat message + current plan_json
                 → Claude returns JSON Patch (RFC 6902) against the schema   [not a full re-gen]
                 → apply patch → validate → INSERT plans vN (never overwrite)
                 → viewport re-renders from new JSON (no AI in the render path)
                 SLO: < 15s

WF-3  EXPORT     check entitlements
                 → free tier: watermarked 3D snapshot only
                 → paid/credit: edge fn runs cut-list bin-packing against
                   materials_catalog stock lengths → PDF (plan + cut diagram +
                   hardware list w/ affiliate links) → storage → signed URL
                 → decrement plan_credits if one-off

WF-4  BILLING    Stripe checkout/portal → webhook → entitlements upsert

WF-5  METER      after every AI call: log plan_events + ai_usage_daily;
                 hard stop per-user daily token cap (abuse guard)
```

---

## 5. Plan Schema (the core IP — compact sketch)

```jsonc
{
  "meta":    { "name", "style", "difficulty": "beginner|intermediate|advanced",
               "est_cost_usd", "est_hours", "tools_required": [] },
  "units":   "mm",
  "overall": { "w", "d", "h" },
  "parts": [ { "id": "P1", "name": "Left leg", "material_ref": "walnut_8_4",
               "profile": { "thickness", "width" }, "length", "qty": 2,
               "grain": "long", "shaping": [ { "op": "taper", "params": {} } ],
               "position": [x,y,z], "rotation": [rx,ry,rz] } ],
  "joints": [ { "type": "mortise_tenon|pocket|dado|dowel|confirmat",
                "part_a": "P1", "part_b": "P5", "fasteners": [ { "sku_ref", "qty" } ] } ],
  "hardware":  [ { "sku_ref", "qty" } ],
  "assembly":  [ { "order": 1, "title", "instruction", "parts": [], "tools": [] } ],
  "load_spec": { "use_case", "design_load_kg", "critical_members": ["P7"] },
  "render_hints": { "exploded_vector_per_part", "palette" }
}
```

Because `parts[]` carries position/rotation/profile, the Three.js island is a dumb loop: `parts.map(p => boxOrExtrusion(p))`. Exploded view = lerp along `render_hints.exploded_vector_per_part`. **The schema is enforced by the API** (`output_config.format` with `json_schema` + `additionalProperties: false`), so malformed plans are impossible by construction, not by parsing heroics.

---

## 6. AI Layer — model choice and cost per call (verified pricing)

**Model: Claude Opus 4.8** (`claude-opus-4-8`) — $5 / $25 per M tokens (in/out). Structured outputs guarantee schema-valid JSON; prompt caching serves the fat system prompt (engineering rules, schema, catalogs digest ≈ 15K tokens) at ~0.1× on every call after the first.

| Call | Tokens (in cached / in fresh / out) | Cost on Opus 4.8 | Same call: Sonnet 5* | Haiku 4.5 |
|---|---|---|---|---|
| Generate plan (WF-1) | 15K / 1K / ~8K JSON | **~$0.22** | ~$0.10 | ~$0.05 |
| Auto-repair round (worst case, ~20% of gens) | 15K / 9K / 8K | ~$0.25 | ~$0.11 | — |
| Edit → JSON Patch (WF-2) | 15K / 9K / ~1.5K | **~$0.09** | ~$0.04 | — |
| Intake helper / title / tags | 2K / 0.3K / 0.2K | — | — | ~$0.003 |

\* Sonnet 5 intro pricing $2/$10 per MTok through 2026-08-31, then $3/$15. Start everything on Opus 4.8 for quality; A/B the *edit* path down-tier only after you have a validator-pass-rate baseline — plan quality is the product, and the delta is cents.

**Blended COGS per active maker-tier user** (4 plans + 25 edits/mo): ≈ **$3.40/mo** → ~80% gross margin at a $15 price point before platform fixed costs.

---

## 7. Monetization (day-one, not deferred)

| Tier | Price | Gets | Gate mechanics |
|---|---|---|---|
| Free | $0 | 2 generations, full 3D viewer, chat edits capped at 5 | No exports. The 3D *is* the demo — never paywall the wow |
| One-off | $7/plan | Single plan: unlimited edits + full export pack | `plan_credits` decrement — captures the "I just need this one table" majority |
| Maker | $15/mo | 8 gens/mo, unlimited edits, all exports, version history | `entitlements.tier` |
| Pro | $39/mo | 25 gens, commercial license to sell/teach from plans, priority model | Commercial license is pure-margin positioning |
| Affiliate layer | — | Hardware list links (Amazon/Rockler/Home Depot) | ~3–5% of a $150–400 BOM per exported plan; margin on plans you didn't even sell |

**Break-even at fixed floor:** ~10 Maker subs. Realistic 90-day target: 100 one-offs + 40 Maker ≈ $1,300/mo revenue against ≈ $300 total costs.

---

## 8. The 12-Hour Sprint Plan

| Hours | Deliverable |
|---|---|
| 0–1 | Supabase project: schema above, seed materials/hardware/span tables (CSV import) |
| 1–2 | Plan Schema v1 frozen; system prompt drafted (rules + schema + catalog digest); 3 golden prompts picked |
| 2–4 | Claude wired via API Connector; generate 10 plans across the 3 golden prompts; eyeball JSON sanity |
| 4–6 | Three.js island: JSON → boxes, orbit, exploded slider (this is the deep-work block) |
| 6–8 | Bubble shell: auth, dashboard, intake wizard, editor 3-pane layout, WF-1 end-to-end |
| 8–9 | WF-2 edit loop (JSON Patch path) + version timeline |
| 9–10 | Validator edge function v1: BOM math, span check, tip-over ratio; badges in spec panel |
| 10–11 | Stripe checkout (one-off + Maker), entitlements webhook, export PDF v1 (cut list as table; diagram in v1.1) |
| 11–12 | Smoke test the 3 golden paths; record the 20s demo loop for the landing page; write kill/continue metrics |

**Continue/kill gate (2 weeks post-launch):** ≥25% of visitors who generate a plan return to edit it, and ≥8% of exporters pay. Below both → the wedge is wrong; the corpus and schema survive to pivot (pro maker tooling, kit-brand licensing).

---

## 9. Top Risks

1. **Plan trust** — one collapsed bookshelf on Reddit ends the brand. Mitigation: validator is load-bearing (literally); v1 ships only 6 furniture archetypes whose failure modes are fully covered by the span/tip/fastener tables; visible "engineering check" badges; TOS + design-load disclosure on every export.
2. **3D island scope creep** — the one code asset tempts endless polish. Mitigation: freeze its contract (JSON in, click events out); any feature that changes the contract is deferred.
3. **Bubble WU burn** — chatty editor workflows can spike overage ($0.30/1K WU). Mitigation: plan JSON lives in Supabase; Bubble stores only IDs; renderer talks to Supabase directly.
4. **AI cost abuse** — free-tier generation farming. Mitigation: WF-5 daily caps + Turnstile on `/new`.
5. **Model dependency** — schema + validator + plan corpus are portable across model versions by design; `plan_events` history doubles as an eval set for every future model swap.

---

## Sources

- Bubble pricing & WU model: [bubble.io/pricing](https://bubble.io/pricing), [Bubble Docs — pricing plans](https://manual.bubble.io/account-and-marketplace/account-and-billing/pricing-plans), [Goodspeed — Bubble pricing 2026](https://goodspeed.studio/blog/understanding-bubble-new-pricing-model), [LowCode Agency — Bubble plans](https://www.lowcode.agency/blog/bubble-pricing-plans)
- Bubble 3D/Three.js state: [Bubble forum — 3D app design](https://forum.bubble.io/t/building-a-3d-app-design/135643), [3D Viewer plugin](https://bubble.io/plugin/3d-viewer-1718041534766x890775403563581400), [RapidDev — 3D product view in Bubble](https://www.rapidevelopers.com/bubble-tutorial/create-a-3d-product-view-in-bubble)
- Backend comparison: [Softr — Xano vs Supabase 2026](https://www.softr.io/blog/xano-vs-supabase), [Kreante — Supabase vs Xano](https://www.kreante.co/post/supabase-vs-xano-choosing-the-right-backend-for-your-project), [Xano — vs Supabase](https://www.xano.com/versus/xano-vs-supabase/)
- Competitive scan: [Flatma AI 3D generator](https://flatma.com/en/articles/ai-3d-model-generator/), [MakeByMe](https://play.google.com/store/apps/details?id=me.by.make&hl=en_US), [Shapr3D — furniture design software 2026](https://www.shapr3d.com/content-library/furniture-design-software), [SWOOD 2026](https://swood.eficad.com/blog/whats-new-in-swood-2026/), [Woodwork Handbook — CAD tools 2026](https://www.woodworkhandbook.com/woodworking-design-software/)
- Claude API pricing & structured outputs: platform.claude.com docs (verified via bundled API reference, 2026-06)
