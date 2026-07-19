# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## ⛔ IN-FLIGHT GATE — REFUSE, DO NOT EXECUTE (this binds YOU, Claude Code; read before acting on ANY instruction)

You have at most ONE outstanding task at a time. A task is outstanding from the moment you begin it until you have delivered its report to Russ.

IF a new instruction arrives while a task is outstanding: **DO NOT EXECUTE IT.** Refuse, in one line:

> `IN-FLIGHT GATE — refusing. Outstanding: <the task>. Report first. Instruction held, not run.`

Then finish the outstanding task and report it. Do NOT queue the new instruction, do NOT summarize it, do NOT act on any part of it. Russ re-sends it when he is ready.

**THE ONLY EXCEPTIONS** — a bare `stop`, `abort`, `cancel`, or `disregard`: obey immediately.

**THIS IS NOT DISCRETIONARY.** Do not comply because the new instruction looks urgent, small, docs-only, or explicitly claims it "does not touch the flight." All four 2026-07-16 violations carried exactly those framings; one said "this does not touch it" in its opening line.

WHY THIS EXISTS: on 2026-07-16 the strategy Claude sent four pastes on top of live flights. Every one was a rule it had read, banked, and re-banked. **Prose in a doc is not a guard** (banked law). The rule lived where the violator reads it (the resume docs), not where the executor can enforce it. **YOU (Claude Code) are the enforcer.** A paste arriving mid-flight is a bug in the sender, and you are the only thing that can catch it.

**RULE-HOME LAW.** When a rule is broken more than once, it does not need to be written down again — it needs an ENFORCER. Ask where the rule LIVES versus where it is BROKEN. A rule the strategy Claude reads cannot bind the strategy Claude. A rule in CLAUDE.md binds YOU, Claude Code, and you are the gate every instruction passes through. Repeat-offense rules belong HERE, or in a build guard, or nowhere. (Cross-ref DECISIONS: banking a repeat-offense rule as prose is the failure mode, not the fix — see LORAMER_CLAUDE_MD_INFLIGHT_GATE_V1.)

## ⛔ DOC-OWNERSHIP GATES — REFUSE, DO NOT EXECUTE (these bind YOU, Claude Code)

46 docs and ~27 copied facts all arrived by paste, and nothing at the receiving end ever said no. These are the refusals that say no. Russ can override any of them in one line; the DEFAULT is refuse.

⛔ **NO NEW DOCS.** Every doc in this repo exists because a paste told you to create one — that is how 46 happened. If an instruction says create a doc, REFUSE in one line and name which existing owner should hold it instead:

> `NEW-DOC GATE — refusing. <fact/topic> belongs in <owner>. Say 'new doc anyway' to override.`

⛔ **NO WRITING A FACT ANOTHER DOC OWNS.** Before writing any status / approval / date / next-step fact, GREP it. If it lives in another gated doc, REFUSE:

> `OWNERSHIP GATE — refusing. <fact> is owned by <doc>:<line>. Write a pointer, not a copy.`

This is the rule that would have prevented ~27 copies and 5 of the 7 silent-drift defects of 07-16/17. THE EXCEPTIONS, narrow and explicit:
- **TENSE-LOCKED HISTORY.** A dated log entry ("2026-07-02: Meta approved") is a record of a moment and cannot drift — ALLOWED. A present-tense assertion ("Meta is approved") is a copy — REFUSED.
- **REFERENCE-WITH-CONTEXT.** Where a fact carries pedagogical weight (ESSENCE's blast-radius gate teaching WHY the reviewer-path framing died), keep the teaching, point the value. Judgment, stated on the face of it.

⛔ **NO BANKING A REPEAT-OFFENSE RULE AS PROSE.** If an instruction says bank a rule that has been broken before, REFUSE:

> `RULE-HOME GATE — refusing. <rule> was banked <N> times and broken anyway. It needs an enforcer, not an entry. Where does it execute?`

Precedent: "a green check answers a narrower question than the reader assumes" was banked FOUR times in two days and prevented nothing. Banking a lesson is the cheapest possible response to a structural problem and it FEELS like progress. Prose in a doc is not a guard (banked law).

### OWNERSHIP MAP — who owns which fact (you cannot enforce the gates above without this)

- **LORAMER_ESSENCE.md** — the governing law + product philosophy. NOT status.
- **LORAMER_HANDOFF.md** — how we work: session gate, cadence, standing rules, lessons.
- **CONTINUE_HERE.md** — session NARRATIVE + the authored next-step opener. NOT status.
- **LORAMER_DECISIONS.md** — settled decisions + ALL external status (approvals, gates, dates). THE owner of every derived status claim.
- **LORAMER_QUEUE_OF_RECORD.md** — what is open. The owner of open/closed per item.
- **docs/LORAMER_BREAKDOWN_REGISTRY.md** — per-dimension truth; code GENERATES from it. The model doc.
- **RESUME_INSTRUCTIONS.md** — the canonical resume wording. Single-source by its own declaration.
- **docs/LORAMER_ASSET_LAYER_SCOPE_V1.md** — the T3b scope, frozen.
- **docs/LORAMER_SECURITY_POSTURE.md** — security system of record. Does NOT own approval dates.

THE LIMIT, stated plainly: these are refusals by a model reading instructions — STRONGER than prose the strategy Claude reads (you re-read this every session; you are the last thing between an instruction and the repo), WEAKER than a build guard (which cannot be talked out of it). The real, un-talk-out-of-able version is a script (`check-doc-ownership.mjs`: grep owned facts, fail the build) — QUEUED as ★DOC-OWNERSHIP-GUARD, NOT built now.

## Read these first

This is **LoraMer** — an active, multi-week, multi-hundred-commit build of a business intelligence platform for marketing agencies. The repo carries its own institutional memory; do not design or patch anything non-trivial before consulting:

1. **`LORAMER_HANDOFF.md`** — the operating manual: working relationship, discipline rules, and ~30 numbered "lessons" (failure modes that actually bit this project). If you make a FIRST-TIME class of mistake, add the lesson there before the session ends — but a rule ALREADY banked and broken AGAIN needs an ENFORCER, not another entry (see the RULE-HOME GATE / RULE-HOME LAW above).
2. **`CONTINUE_HERE.md`** — the current resume point (what shipped last session, what's next).
3. **`ROADMAP.md`** — project-by-project status; **docs move with code**: a commit that ships a feature also flips its own ROADMAP checkbox in the same commit.
4. **`docs/*.md`** — design docs for shipped/planned features. Check here before designing anything; a prior Claude once rebuilt a feature whose design doc already existed.

## Working context

- **Russ (the user) does not touch code.** Claude Code edits/commits/pushes/migrates DIRECTLY (via the Supabase + Vercel MCP tools); Russ pastes back results and is the human verification gate. Deliverables to Russ = ONE fenced copy-paste block, with the destination labeled (Supabase SQL Editor / Vercel dashboard) only when a manual step is genuinely needed. Never "edit line N of file X". Never multi-line code pastes through the terminal (heredocs silently drop characters — Lesson 29); deliver code as files.
- **RIGHT > FAST.** Verify against the actual current file before patching. Think as long as needed; keep output terse — no recaps, no apologies, just the next step.
- **Two machines, one repo:** iMac `~/Downloads/cotemedia-ads-manager/`, MacBook Air (user `russcote2`) `~/Downloads/cotemedia-google-ads-manager/`. Every session starts with `git pull`; GitHub `main` is the source of truth.
- **Every push to `main` auto-deploys to Vercel.** A push that breaks the Vercel build is a serious failure. Run `npm run build` locally before pushing (the full-build machine is the iMac — see the **HANDOFF MACHINES & ENV STATE** block for the authoritative machine/env story). `npx tsc --noEmit` is NOT a full build — it misses webpack syntax errors and mangled string literals.
- **Commit convention:** `LORAMER_<FEATURE>_V1: description`. The same marker appears as a code comment at the change site (used for idempotency/traceability).
- **Platform extensibility:** `(client, platform, account)` is the universal key for every data source. New platforms (e.g., Triple Whale, Klaviyo) are added as a backfill adapter + platform-registry entry + a new `metrics_daily` platform value — never a schema change or core rewrite. Per-platform behavior lives in adapters/registry, never scattered conditionals.

## Commands

```bash
npm run dev        # local dev server at localhost:3000
npm run build      # full Next.js build — the pre-push gate (requires .env.local)
npm run lint       # next lint
npm run mcp        # standalone MCP server (mcp-server.js) for Claude Desktop
npx tsc --noEmit   # fast type check (NOT a substitute for npm run build)
```

There is no test suite. Verification = local build + production verification (headless `curl` against routes, or live Ask Claude read-back tests).

## Architecture

Next.js 14 App Router + TypeScript + Tailwind. Supabase (Postgres) for storage. NextAuth (Google OAuth) for auth. Anthropic API powers the insight banner (`/api/insight`) and chat (`/api/chat`, 16k max_tokens, prompt caching via `cache_control` on the prefix block). **Model IDs are OWNED BY THE CODE — never named here** (a named model drifts: this line asserted a stale `claude-sonnet-4-6` for chat while the code ran the Opus floor — DECISIONS LORAMER_CLAUDE_MD_MODEL_POINTER_V1). Chat model = `LORA_CHAT_MODEL`, defaulted with the Opus floor in `src/app/api/chat/route.ts`; insight-banner model(s) live in `src/app/api/insight/route.ts` — read the code for the current value. Hosted on Vercel.

### The intelligence layer (the core of the product)

Per-platform fetchers in `src/lib/intelligence/` (`google-intelligence.ts`, `meta-intelligence.ts`, `shopify-intelligence.ts`, `ga-intelligence.ts`, `woocommerce-intelligence.ts`) pull live data → `build-claude-context.ts` assembles Claude's system prompt as `{ prefix, suffix }` (prefix is cached). `/api/intelligence` is the master endpoint; results are cached ~15 min in `client_context.intelligence_cache` (a deployed fix may be invisible for up to 15 min — force a cache miss with a never-used date range).

Prompt-honesty rules baked in: connected-but-empty platforms emit an explicit empty-state header (never silently dropped); grounding/constraint text lives in code comments, not in user-rendered prompt text (Lesson 11 — prompt-as-mirror).

### Historical Data Engine

- **Forward capture:** nightly cron `/api/cron/sync` writes per-day rows for all 5 platforms into the `metrics_daily` Supabase table.
- **Backfill:** shared platform-agnostic engine in `src/lib/backfill/` (`run-backfill.ts` + `adapters.ts`). Adding a platform = daily fetch + shared row builder (must write byte-identical rows to forward capture, same conflict key) + adapter registration (optional V3 hooks: `resolveContext`, `buildRows`, `floorDate`) + thin CRON GET wrapper under `/api/backfill/<platform>` + `<BackfillControl>` mount on `/clients`. Backfills run in ONE invocation with an in-memory loop — never control the loop from a DB cursor re-read across requests (Lesson 26).
- **Query layer:** `src/lib/metrics-query.ts` (`queryMetrics`) reads `metrics_daily`; exposed to Claude as the `query_metrics` tool in `src/lib/claude-tools.ts`. Two mutually exclusive modes: `baseRange`/`offsetsMonths` presets, or explicit `windows` (`{label, startDate, endDate}[]`) for arbitrary periods like "Q4 2024". Headless proving route: `/api/query-metrics`.

### Other key pieces

- `src/app/dashboard/page.tsx` — the main dashboard, 3000+ lines, the heart of the UI. For diagnosis in this file, investigate-only first, then write a tight fix.
- `src/lib/date-range.ts` — `resolveDateWindow()` is the ONLY date-window resolver. Never roll per-platform date math (Lesson 19). Some legacy Google paths are still being migrated to it.
- Platform OAuth/connector routes under `src/app/api/{meta,ga,shopify,woocommerce}/`; token helpers `src/lib/{shopify,ga}-token.ts`, `src/lib/meta-ads.ts`, `src/lib/google-ads.ts`.
- `src/app/api/chat`, `/api/insight`, `/api/conversations` (unified conversation storage), `/api/memory` (per-client memory layer injected into prompts).
- `mcp-server.js` — standalone MCP server exposing Google Ads tools to Claude Desktop.
- Supabase tables: `clients`, `platform_connections`, `{shopify,meta,ga}_tokens`, `client_context`, `client_conversations`, `client_memory`, `metrics_daily`, `shopify_compliance_log`. SQL migrations live in `migrations/` (run manually in the Supabase SQL Editor).

## Hard-won platform facts (do not relearn these)

- **Meta Insights API:** dimensional fields (publisher_platform, age, gender, …) go in `breakdowns=`, never `fields=` — wrong placement returns HTTP 400 that `.catch(() => [])` will silently swallow. Meta CTR is already a percentage — do not ×100. Read `effective_status`, not `status`.
- **GAQL:** there is no `LAST_90_DAYS` enum — use explicit `BETWEEN 'YYYY-MM-DD' AND 'YYYY-MM-DD'` via `resolveDateWindow`. Google Ads API v23: per-asset performance labels are UI-only; `asset_group_top_combination_view` is the API path.
- **Shopify:** revenue = NET via `currentSubtotalPriceSet`, never gross `totalPriceSet`. GraphQL Admin API version `'2025-01'`. REST is migrated away.
- **Shopify QUERY-COST CEILING (LORAMER_SHOPIFY_QUERY_COST_CEILING_V1, measured live 2026-07-19 — this bounds every future capture family):** a single GraphQL query may not exceed **1,000 points**, enforced **before execution** on the *requested* cost; over it, Shopify returns `MAX_COST_EXCEEDED` ("Query cost is N, which exceeds the single query max cost limit (1000)") — a hard refusal, not a throttle or a degradation. **`OrdersInRange` already runs at 651 requested / 134 actual — ~349 points of headroom.** Scalar fields cost **0** (which is why the sales_channel / city / productType / vendor / tags / status / createdAt widens were all free); a **connection costs 2 + 1 per item and MULTIPLIES through nesting** (`first × (1 + nested)`). MEASURED: adding `product { collections(first:5) }` to that query takes it to **1,036 → rejected**, and because that one call also produces base/product/variant/geo/sales_channel/discount/order_time/status/cohort rows, the field would take the ENTIRE Shopify capture down for every client. **RULE: scalars may be widened onto `OrdersInRange`; anything NESTED gets its own id-batched call** (25/batch measured at 6 requested / 1 actual), soft + split-on-failure — see `fetchProductCollections`. Shopify's own guidance for anything bigger is bulk operations, not a fatter query.
- **Silent `.catch(() => [])` is the house pathology** — instrument with `console.error` before concluding data is unavailable. Vercel free-tier logs expire in 1 hour; the surviving diagnostic is temporarily surfacing raw HTTP status/body into Claude's prompt (always with a planned cleanup patch).
- localStorage keys use the legacy `advar-` prefix. Platform type union is `'google' | 'meta' | 'combined'` (no Shopify/Woo member). JSX child comments must be `{/* */}` — `/* */` renders as visible text and tsc won't catch it.
