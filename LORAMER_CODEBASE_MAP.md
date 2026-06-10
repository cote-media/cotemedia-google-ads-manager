# LoraMer — Codebase Map

> **Orientation map — architecture and responsibilities only.** No line numbers, counts, or implementation specifics (those rot). Use it to understand the shape of the system and where things live; ALWAYS verify any specific line, function, or value against the live file. Claude Code reads files fresh — this map orients, the repo is truth.
> Map last verified: 2026-06-09 · tag: LORAMER_CODEBASE_MAP_STRIPE_PHASE3_V1
> Maintenance: at each handoff, if `git diff --name-status` since this map's last commit shows any added/deleted/renamed files, the changed area is updated here. Modified-only commits need no update.

## What LoraMer is
A Next.js business-intelligence app for marketing agencies and store owners. The customer connects their own data sources (Google Ads, Meta Ads, Shopify, WooCommerce, Google Analytics 4) and talks to **Lora**, an embedded AI analyst that reads across all of them with per-client memory. Underneath sits a permanent historical data engine: a nightly cron forward-captures every connected account's daily metrics into LoraMer's own database, and per-platform backfills pull history as deep as each platform will serve — so Lora can answer questions about periods the ad platforms themselves no longer retain.

## Stack
- Next.js 14 (App Router) + React 18 + TypeScript 5
- Supabase (Postgres) for all persistence; service-role access from API routes
- Vercel hosting + Vercel cron for the nightly sync
- Tailwind CSS 3 for styling; Recharts for dashboard charts
- Anthropic API (`@anthropic-ai/sdk`): Claude Sonnet for chat/follow-ups, Claude Haiku for the auto insight banner
- next-auth (Google OAuth) for sign-in; per-platform OAuth flows for connectors

## Directory map (src/)
- `src/app/` — pages (App Router) and `src/app/api/` route handlers
- `src/lib/` — all shared logic: the Lora brain (`intelligence/`), platform connectors, the historical data engine (`backfill/`, `metrics-query.ts`), auth/token helpers, Supabase client, billing/Stripe (`billing/`, `stripe.ts`), the welcome gate (`welcome-gate.ts`)
- `src/components/` — small shared UI components (error boundary, onboarding coachmark)
- Root-level docs: `LORAMER_HANDOFF.md` (lessons/protocol), `CONTINUE_HERE.md` (resume point), `ROADMAP.md`, this map; `migrations/` holds SQL run against Supabase

## Pages (user-facing routes)
- `/` (`app/page.tsx`) — marketing homepage; warm editorial style (serif headings); splits visitors to Agency/Business paths; Google sign-in
- `/agency` — marketing page pitching the multi-client agency use case
- `/business` — marketing page pitching the single-store owner use case
- `/welcome` — post-signup onboarding interstitial while first accounts connect
- `/dashboard` — the product: per-client analytics dashboard + all Lora surfaces (see "Dashboard internals")
- `/clients` — client management: clients grid, connection rows per platform, backfill controls, the "Mer" client deep-dive surface
- `/billing` — plan & billing: current tier, annual/monthly toggle, self-serve upgrade cards → Stripe Checkout, post-Checkout success polling (waits for the webhook to flip the tier). Linked from the dashboard account menu
- `/install/complete` — landing page after a Shopify-initiated app-store install
- `/reviewer-login` — app-store reviewer bypass login
- `/privacy`, `/terms` — legal pages (these keep the Anthropic/Claude engine credit verbatim)

## API routes
**Lora (model-calling):**
- `api/chat` — main chat endpoint (Sonnet); builds system prompt from intelligence, runs the shared tool loop
- `api/insight` — the insight banner: Haiku auto one-liner on load, Sonnet with tool loop for typed follow-ups
- `api/intelligence` — assembles the full per-client `ClientIntelligence` object every model call consumes (hybrid cache: platform data cached briefly, notes/conversations always fresh)
- `api/query-metrics` — headless proving route for the `query_metrics` tool path (curl-testable without the model)

**Client & memory:**
- `api/clients` (+ `/connections`, `/profiles`, `/metrics`) — client CRUD, platform-connection CRUD, profile completeness, and the honest per-client metrics rollup used by the clients grid
- `api/context` — client profile context (business type, KPI, user notes)
- `api/conversations` — persistent per-client conversation store shared by every Lora surface; also runs memory-proposal detection on user messages
- `api/memory` (+ `/bootstrap`) — structured client memory facts CRUD; bootstrap seeds memory candidates from existing notes/conversations

**Historical data engine:**
- `api/cron/sync` — nightly forward-capture: writes yesterday's per-platform rows into `metrics_daily` for every connection
- `api/backfill/run`, `/status`, `/probe`, `/probe-ga` — session-authed backfill engine entry points (ownership-gated) + read-only probes
- `api/backfill/google`, `/meta`, `/ga` — thin CRON-style wrappers per platform

**Per-platform data (live fetch for dashboard views):**
- Google Ads: `api/accounts`, `api/campaigns`, `api/daily`, `api/keywords`, `api/google/adgroups`, `api/google/adgroups/daily`, `api/google/ads`
- Meta: `api/meta/auth`, `/callback`, `/campaigns`, `/adsets`, `/ads`, `/daily`, `/debug`
- Shopify: `api/shopify/auth`, `/callback`, `/install`, `/daily`, `/migrate` (token migration), `/webhooks` (mandatory GDPR/CCPA topics)
- WooCommerce: `api/woocommerce/auth`, `/callback`, `/return`, `/daily`
- GA4: `api/ga/start`, `/connect`, `/callback`, `/properties`, `/daily`
- `api/platform` — unified cross-platform campaign/totals fetch the dashboard tabs consume (google / meta / combined)

**Billing (Stripe):**
- `api/billing` — reads the caller's current plan + the self-serve plan list (powers `/billing` and its success polling)
- `api/billing/checkout` — server-validated Stripe Checkout session creator (free→paid only; `mode=subscription`, `client_reference_id=user_email`; rejects manual tiers / an existing active subscription)
- `api/stripe/webhook` — Stripe→Supabase sync engine: signature-verified, event-deduped (`stripe_events`), livemode-gated; UPSERTs the `subscriptions` mirror and the user's `user_profiles.tier`

**Misc:** `api/auth/[...nextauth]` (sign-in), `api/upload` (file upload), `api/welcome` (creates/marks the `user_profiles` row + ensures the Stripe customer), `api/test` (Google token debug)

## The Lora brain (intelligence + context)
- `lib/intelligence/build-claude-context.ts` — the universal system-prompt builder. Every Lora call goes through it. Order: HARD CONSTRAINTS (user directives + profile notes) first, then the Lora identity line ("You are Lora… powered by Anthropic's Claude"), client profile, honest per-platform data sections (focus-aware slicing by tab/drill), memory block, prior conversations, analysis rules. Split into cacheable prefix + dynamic suffix for Anthropic prompt caching.
- `lib/claude-tools.ts` — single source of truth for the model's tools and the capped tool-use loop shared by chat and insight follow-ups; defines `query_metrics` (explicit date windows or rolling comparisons). clientId is injected server-side, never model-controlled.
- `lib/intelligence/{google,meta,shopify,woocommerce,ga}-intelligence.ts` — per-platform builders that fetch + shape that platform's slice of `ClientIntelligence`
- `lib/intelligence/intelligence-types.ts` — the shared `ClientIntelligence` type tree
- `lib/intelligence/ga-metrics-row.ts` — shared GA daily-row builder used by both forward-capture and backfill
- `lib/anomaly-filter.ts` — filters the dashboard's hardcoded "attention needed" alerts against user directives so suppressed metrics don't get flagged
- `lib/date-range.ts` — single source of truth converting date-selector presets to YYYY-MM-DD windows (UTC)
- `lib/spend-logger.ts` — fire-and-forget Anthropic spend logging to `anthropic_spend_log`, priced per model

## Historical Data Engine (data layer)
- **Supabase tables:** `metrics_daily` (the permanent per-day metrics store, all platforms), `sync_state` (backfill cursors/completion), `clients`, `platform_connections`, `client_context`, `client_conversations`, `client_memory`, `user_profiles`, token tables per connector (`google_tokens`, `meta_tokens`, `ga_tokens`, `shopify_tokens`, `woocommerce_tokens`, `shopify_installs`), `anthropic_spend_log`, `shopify_compliance_log`, `meta_compliance_log` (Meta deauthorize/data-deletion audit + idempotency, migration 006); `meta_tokens` also carries `fb_user_id` (app-scoped FB user id captured at connect, migration 006)
- **Forward capture:** `api/cron/sync` runs nightly (Vercel cron) and writes YESTERDAY's rows per connection — a change gated on cron output can only be verified after the next UTC-midnight-crossing run (see handoff Lesson on cron-gated verification)
- **Backfill:** `lib/backfill/run-backfill.ts` is the platform-agnostic engine (probe → chunked daily fetch → shared row builder → write + cursor); `lib/backfill/adapters.ts` registers per-platform adapters (token loading, daily fetch, chunking, floors). Adding a platform = daily fetch + row builder + adapter + CRON wrapper + mount `BackfillControl` on its `/clients` row
- **Connectors:** `lib/google-ads.ts` + `lib/platforms/google.ts` (Google Ads API via the google-ads-api Node client, GAQL), `lib/meta-ads.ts` + `lib/platforms/meta.ts` (Meta Graph API — version hardcoded at each call site across the meta routes and libs, not centrally pinned; grep `graph.facebook.com` for the current value — paginated daily insights), Shopify/Woo/GA via their OAuth routes + token helpers (`shopify-token.ts`, `shopify-install-token.ts`, `ga-token.ts`)
- `lib/metrics-query.ts` — the query layer over `metrics_daily` powering both the `query_metrics` tool and `api/clients/metrics`, so model answers and UI rollups agree
- `lib/platforms/types.ts` — shared dashboard-facing platform types + column definitions
- **Off-site backup:** `.github/workflows/db-backup.yml` — nightly GitHub Action `pg_dump` of the Supabase DB → Cloudflare R2 (off-site complement to Supabase's in-platform backups)

## Billing & monetization (Stripe)
Stripe (TEST mode for now) processes cards via hosted Checkout; entitlements are DB-driven and Stripe is the source of truth, mirrored into Supabase by the webhook.
- `lib/stripe.ts` — lazy Stripe client singleton + `stripeLivemode()` (mode inferred from the secret-key prefix; used to gate TEST vs LIVE webhook events)
- `lib/billing/plans.ts` — self-serve tiers, display-only prices, and the feature-flag → human-label map (raw flag keys never reach a user surface)
- `lib/billing/ensure-customer.ts` — idempotent one-Stripe-customer-per-`user_email`; UPSERTs the `user_profiles` link, never duplicates a customer, never throws (signup-safe)
- `lib/billing/tier-from-price.ts` — resolve a Stripe price id → LoraMer tier via `plan_entitlements`
- `lib/welcome-gate.ts` — shared `enforceWelcomeGate()` mounted via server layouts on `/dashboard`, `/clients`, AND `/billing`; sends a profile-less / unwelcomed user to `/welcome` (the single place the `user_profiles` row is created and the Stripe customer ensured). All billing writes to `user_profiles` UPSERT, so a paying user always lands the right tier even if they bypass onboarding
- **Supabase tables:** `plan_entitlements` (per-tier caps/quotas/flags + Stripe price ids — migration 007), `subscriptions` (per-subscription mirror) + `stripe_events` (webhook idempotency) — migration 008; `user_profiles.stripe_customer_id` links a user to Stripe
- Sync helper: `scripts/stripe-sync-products.mjs` — idempotent Stripe product/price creator that writes price ids back into `plan_entitlements` (re-runnable for LIVE at go-live)

## Dashboard internals (src/app/dashboard/page.tsx)
One large client-side file containing the whole dashboard. Major in-file areas, top to bottom by responsibility:
- Constants: date-range presets, `NAV_ITEMS` (sidebar/bottom tab definitions — the "Lora" chat tab lives here), chart color palette
- Shared warm chart theme: `ChartTooltip` (the custom Recharts tooltip — currency-aware via `CURRENCY_KEYS`) and `AXIS_TICK` (shared axis typography). All platform charts point at these
- Metric-definition arrays (Google / Meta / Combined / Shopify / GA chart metrics; money metrics carry a `currency` flag feeding `CURRENCY_KEYS`)
- The platform chart components (Google, Meta, Combined overlay, ad-group multi-line, ad bar/line, Shopify, GA) — all share the theme above
- `RightPanel` — the slide-in "Ask Lora" panel (desktop right panel + mobile bottom sheet), persisted per client via `api/conversations`
- `AskClaudeButton` / `AskClaudeCardButton` (identifiers keep the legacy name; rendered text says Lora) — the ✦ diamond entry points on rows and cards
- `DrillTable` + `Breadcrumb` — campaigns → ad groups/ad sets → ads drill-down with column picker and totals row
- `InsightChat` — the "Lora Analysis" banner (auto insight + expandable reply thread + profile-fact save suggestions)
- Tab components: Overview, Campaigns, Keywords, Shopify/WooCommerce (shared component), Google Analytics, Chat ("Ask Lora" full tab with transcript download/upload — upload still parses legacy "Claude:" transcripts)
- `MemoryProposalToast` — "save to memory?" toast driven by `api/conversations` proposals
- `DashboardContent` — all top-level state (client/platform/tab/date-range selection, panel state), the desktop sidebar, mobile header/bottom nav, and tab routing

## Clients page (src/app/clients/page.tsx)
Client management grid: per-client cards with honest metrics from `api/clients/metrics` (sums match the query layer Lora uses), the "Mer" client deep-dive overlay surface, per-platform connection rows (connect/disconnect flows), the structured memory editor, and `BackfillControl.tsx` mounted per connection row (probe + run + honest "complete back to DATE" status).

## Naming & brand
- **Lora** = the in-app AI analyst persona. UI labels, prompt identity, marketing copy all say Lora.
- **Mer** = the client deep-dive surface on the clients page. (LoraMer = Lora + Mer.)
- **"Powered by Claude" / Anthropic references** = engine credit only — legal pages and the identity line's "powered by Anthropic's Claude" stay verbatim; never rename those.
- Engine: Claude Sonnet for chat and insight follow-ups, Claude Haiku for the auto insight banner one-liner.
- Code identifiers deliberately keep legacy names (`buildClaudeContext`, `runClaudeToolLoop`, `AskClaudeButton`, the legacy `advar-*` localStorage keys; newer keys use `loramer-*`) — rendered/prompt text is what got renamed.

## Conventions (full lessons in LORAMER_HANDOFF.md)
- Russ never edits code directly — Claude Code makes all edits, commits, and pushes. Hand him complete copyable blocks and label every paste destination (Cursor terminal / Supabase SQL Editor / Vercel).
- Verify with `npx tsc --noEmit` before committing; Vercel deploys from main.
- Session work is tagged `LORAMER_*_V1`-style in commit messages; handoffs anchor on TAGS + deliverable files, never commit hashes.
- Single-source-of-truth files are deliberate: `date-range.ts` (date windows), `claude-tools.ts` (model tools), `metrics-query.ts` (historical sums), `build-claude-context.ts` (prompt). Change behavior there, not at call sites.
- Raw macOS Terminal: keep pastes to single commands or a small script — long multi-line terminal pastes can drop characters. The Cursor Agents window takes full multi-line task pastes — that's how all code work is delivered.

## If you're changing X, look here
| Change | Where |
|---|---|
| What Lora knows / says about a client | `lib/intelligence/build-claude-context.ts` (+ `api/intelligence` for the data it receives) |
| Lora's tools or tool-loop behavior | `lib/claude-tools.ts` |
| Which model / token caps per surface | `api/chat/route.ts`, `api/insight/route.ts` |
| Chart look & feel (tooltip, axes, currency) | `ChartTooltip` / `AXIS_TICK` / `CURRENCY_KEYS` in `app/dashboard/page.tsx` |
| Sidebar / bottom nav tabs | `NAV_ITEMS` + nav render blocks in `app/dashboard/page.tsx` |
| A platform's dashboard data | that platform's routes under `api/<platform>/` + `lib/platforms/` |
| Historical sums / period comparisons | `lib/metrics-query.ts` (UI and model both flow through it) |
| Backfill behavior or a new platform backfill | `lib/backfill/run-backfill.ts` + `lib/backfill/adapters.ts` + thin route wrapper + `BackfillControl` mount |
| Nightly capture | `api/cron/sync/route.ts` (remember: it writes yesterday; verification is cron-gated) |
| Client cards / connections / Mer overlay | `app/clients/page.tsx` (+ `api/clients/*`) |
| Per-client memory behavior | `api/memory/*`, `api/conversations` (proposal detection), memory section of the prompt builder |
| Date-range semantics | `lib/date-range.ts` (single source of truth) |
| Billing / plans / Checkout / entitlements | `app/billing/page.tsx` + `api/billing/*`, `api/stripe/webhook`, `lib/billing/*`, `lib/stripe.ts`; onboarding gate in `lib/welcome-gate.ts` |
| Brand/type tokens | `src/app/globals.css` + `tailwind.config` |
