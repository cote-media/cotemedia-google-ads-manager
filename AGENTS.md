# AGENTS.md

This file provides guidance to Codex (Codex.ai/code) when working with code in this repository.

## Read these first

This is **LoraMer** — an active, multi-week, multi-hundred-commit build of a business intelligence platform for marketing agencies. The repo carries its own institutional memory; do not design or patch anything non-trivial before consulting:

1. **`LORAMER_HANDOFF.md`** — the operating manual: working relationship, discipline rules, and ~30 numbered "lessons" (failure modes that actually bit this project). If you make a new class of mistake, add it there before the session ends.
2. **`CONTINUE_HERE.md`** — the current resume point (what shipped last session, what's next).
3. **`ROADMAP.md`** — project-by-project status; **docs move with code**: a commit that ships a feature also flips its own ROADMAP checkbox in the same commit.
4. **`docs/*.md`** — design docs for shipped/planned features. Check here before designing anything; a prior Codex once rebuilt a feature whose design doc already existed.

The loose `*.py` files in the repo root are historical one-off patch scripts (the user applies changes by running generated patch scripts) — they are not part of the app.

## Working context

- **Russ (the user) does not touch code.** Deliver complete, paste-ready commands with the destination labeled (Cursor terminal / Supabase SQL Editor / Vercel dashboard). Never "edit line N of file X". Never multi-line code pastes through the terminal (heredocs silently drop characters — Lesson 29); deliver code as files.
- **RIGHT > FAST.** Verify against the actual current file before patching. Think as long as needed; keep output terse — no recaps, no apologies, just the next step.
- **Two machines, one repo:** iMac `~/Downloads/cotemedia-ads-manager/`, MacBook Air (user `russcote2`) `~/Downloads/cotemedia-google-ads-manager/`. Every session starts with `git pull`; GitHub `main` is the source of truth.
- **Every push to `main` auto-deploys to Vercel.** A push that breaks the Vercel build is a serious failure. Run `npm run build` locally before pushing (works on the iMac, which has `.env.local`). `npx tsc --noEmit` is NOT a full build — it misses webpack syntax errors and mangled string literals.
- **Commit convention:** `LORAMER_<FEATURE>_V1: description`. The same marker appears as a code comment at the change site (used for idempotency/traceability).
- **Platform extensibility:** `(client, platform, account)` is the universal key for every data source. New platforms (e.g., Triple Whale, Klaviyo) are added as a backfill adapter + platform-registry entry + a new `metrics_daily` platform value — never a schema change or core rewrite. Per-platform behavior lives in adapters/registry, never scattered conditionals.

## Commands

```bash
npm run dev        # local dev server at localhost:3000
npm run build      # full Next.js build — the pre-push gate (requires .env.local)
npm run lint       # next lint
npm run mcp        # standalone MCP server (mcp-server.js) for Codex Desktop
npx tsc --noEmit   # fast type check (NOT a substitute for npm run build)
```

There is no test suite. Verification = local build + production verification (headless `curl` against routes, or live Ask Codex read-back tests).

## Architecture

Next.js 14 App Router + TypeScript + Tailwind. Supabase (Postgres) for storage. NextAuth (Google OAuth) for auth. Anthropic API: `Codex-haiku-4-5` for the insight banner (`/api/insight`), `Codex-sonnet-4-6` for chat (`/api/chat`, 16k max_tokens, prompt caching via `cache_control` on the prefix block). Hosted on Vercel.

### The intelligence layer (the core of the product)

Per-platform fetchers in `src/lib/intelligence/` (`google-intelligence.ts`, `meta-intelligence.ts`, `shopify-intelligence.ts`, `ga-intelligence.ts`, `woocommerce-intelligence.ts`) pull live data → `build-Codex-context.ts` assembles Codex's system prompt as `{ prefix, suffix }` (prefix is cached). `/api/intelligence` is the master endpoint; results are cached ~15 min in `client_context.intelligence_cache` (a deployed fix may be invisible for up to 15 min — force a cache miss with a never-used date range).

Prompt-honesty rules baked in: connected-but-empty platforms emit an explicit empty-state header (never silently dropped); grounding/constraint text lives in code comments, not in user-rendered prompt text (Lesson 11 — prompt-as-mirror).

### Historical Data Engine

- **Forward capture:** nightly cron `/api/cron/sync` writes per-day rows for all 5 platforms into the `metrics_daily` Supabase table.
- **Backfill:** shared platform-agnostic engine in `src/lib/backfill/` (`run-backfill.ts` + `adapters.ts`). Adding a platform = daily fetch + shared row builder (must write byte-identical rows to forward capture, same conflict key) + adapter registration (optional V3 hooks: `resolveContext`, `buildRows`, `floorDate`) + thin CRON GET wrapper under `/api/backfill/<platform>` + `<BackfillControl>` mount on `/clients`. Backfills run in ONE invocation with an in-memory loop — never control the loop from a DB cursor re-read across requests (Lesson 26).
- **Query layer:** `src/lib/metrics-query.ts` (`queryMetrics`) reads `metrics_daily`; exposed to Codex as the `query_metrics` tool in `src/lib/Codex-tools.ts`. Two mutually exclusive modes: `baseRange`/`offsetsMonths` presets, or explicit `windows` (`{label, startDate, endDate}[]`) for arbitrary periods like "Q4 2024". Headless proving route: `/api/query-metrics`.

### Other key pieces

- `src/app/dashboard/page.tsx` — the main dashboard, 3000+ lines, the heart of the UI. For diagnosis in this file, investigate-only first, then write a tight fix.
- `src/lib/date-range.ts` — `resolveDateWindow()` is the ONLY date-window resolver. Never roll per-platform date math (Lesson 19). Some legacy Google paths are still being migrated to it.
- Platform OAuth/connector routes under `src/app/api/{meta,ga,shopify,woocommerce}/`; token helpers `src/lib/{shopify,ga}-token.ts`, `src/lib/meta-ads.ts`, `src/lib/google-ads.ts`.
- `src/app/api/chat`, `/api/insight`, `/api/conversations` (unified conversation storage), `/api/memory` (per-client memory layer injected into prompts).
- `mcp-server.js` — standalone MCP server exposing Google Ads tools to Codex Desktop.
- Supabase tables: `clients`, `platform_connections`, `{shopify,meta,ga}_tokens`, `client_context`, `client_conversations`, `client_memory`, `metrics_daily`, `shopify_compliance_log`. SQL migrations live in `migrations/` (run manually in the Supabase SQL Editor).

## Hard-won platform facts (do not relearn these)

- **Meta Insights API:** dimensional fields (publisher_platform, age, gender, …) go in `breakdowns=`, never `fields=` — wrong placement returns HTTP 400 that `.catch(() => [])` will silently swallow. Meta CTR is already a percentage — do not ×100. Read `effective_status`, not `status`.
- **GAQL:** there is no `LAST_90_DAYS` enum — use explicit `BETWEEN 'YYYY-MM-DD' AND 'YYYY-MM-DD'` via `resolveDateWindow`. Google Ads API v23: per-asset performance labels are UI-only; `asset_group_top_combination_view` is the API path.
- **Shopify:** revenue = NET via `currentSubtotalPriceSet`, never gross `totalPriceSet`. GraphQL Admin API version `'2025-01'`. REST is migrated away.
- **Silent `.catch(() => [])` is the house pathology** — instrument with `console.error` before concluding data is unavailable. Vercel free-tier logs expire in 1 hour; the surviving diagnostic is temporarily surfacing raw HTTP status/body into Codex's prompt (always with a planned cleanup patch).
- localStorage keys use the legacy `advar-` prefix. Platform type union is `'google' | 'meta' | 'combined'` (no Shopify/Woo member). JSX child comments must be `{/* */}` — `/* */` renders as visible text and tsc won't catch it.
