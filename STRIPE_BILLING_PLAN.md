# LoraMer — Stripe Billing Plan
Status: 2026-06-08. Source of truth = this file + repo. Supersedes any "Shopify Managed Pricing" references in ROADMAP.

## Decisions (LOCKED)
- Processor: Stripe. Shopify path is data-connector + free install funnel only — never touches money.
- Stripe account: a SEPARATE dedicated LoraMer account owned by russ@loramer.com (NOT the cotebrandmarketing@gmail / FreshBooks / Cote Media account). Standalone signup, not the account-switcher. Why: own statement descriptor ("LoraMer" on customer cards), clean financial separation, transferable if LoraMer becomes its own entity/raises/sells. Build entirely in TEST mode; bank/legal activation only needed at go-live (Phase 6).

## Account model (Phase 0 recon, confirmed)
- Billing key = user_email (text, threaded everywhere). No agency/account/workspace table.
- Hierarchy: user_email -> clients[] (a "client" row = a workspace) -> platform connections/data. 1 user = 1 account = many workspaces. Stripe customer maps 1:1 to user_email.
- user_profiles already exists: user_email PK, tier text CHECK in (free,solo,agency,scale,enterprise,beta_unlimited), welcome_seen_at, timestamps. tier is READ NOWHERE today — zero enforcement.
- anthropic_spend_log exists (per-call cost log, not a quota). No Stripe columns/tables/env anywhere — greenfield.
- beta_unlimited = founding-cohort mechanism (uncapped, hand-onboarded, bypasses gating).

## Entitlement matrix (LOCKED — from published landing pricing)
- free / Free / $0 / 1 workspace / 5 Q-mo / 30-day view window / no flags
- business / Business / $79-mo / $758-yr / 1 workspace / 100 Q-mo / 12-month (365d) view window / no flags
- agency / Agency / $199-mo / $1910-yr / 10 workspaces / 500 Q-mo / full history / flags: wyws, priority_support
- scale / Scale / $999-mo / $9590-yr / 50 workspaces / 2500 Q-mo / full history / flags: wyws, priority_support, automations, white_label, bulk_export, sla
- enterprise / Enterprise / custom (manual invoice, no Stripe self-serve) / unlimited / custom Q / full history / all flags
- beta_unlimited / Founding / intro pricing (manual) / unlimited / unlimited Q / full history / all flags; bypasses gating
Flags: wyws (While You Were Sleeping digest) = agency+; automations/white_label/bulk_export/sla = scale+. Annual = 20% off; founding gets extended intro pricing.

## Design decisions (LOCKED)
1. Retention = VIEW WINDOW, not deletion. Capture stays permanent forever (core "system of record" promise intact); tier only limits how far back a user can SEE (date filter on queries). Doubles as upgrade lever.
2. Tier naming: rename solo -> business everywhere. ONE paid entry tier (defining trait = 1 workspace = just you). Internal key DECOUPLED from display_name — relabel anytime via config, no migration.
3. "AI question" = one user message to Lora (a chat turn); tool calls within a turn don't each count. Monthly reset.
4. Entitlements are DB-DRIVEN: plan_entitlements table (one row per tier) is the single source of truth for caps/quotas/flags. Changing a cap = one row UPDATE via Supabase MCP — live, no deploy. Optional per-user override column on user_profiles for one-off bumps. Caps/quotas/flags = instant DB edits; dollar PRICES live in Stripe and change deliberately (never silently re-price existing subscribers).

## Architecture
- Stripe holds plans + processes cards via HOSTED Checkout (card data never touches the app).
- Stripe Customer Portal handles upgrade/downgrade/cancel/card + proration + annual (we don't build that UI).
- Webhooks sync Stripe -> Supabase (Stripe = source of truth; a subscriptions mirror enables fast checks).
- Gating: server reads plan_entitlements by the user's tier and enforces caps/quotas/flags.

## plan_entitlements table
tier (PK), display_name, workspace_cap int (null=unlimited), questions_per_month int (null=unlimited), history_window_days int (null=unlimited), feature_flags jsonb, stripe_price_monthly text (null), stripe_price_annual text (null), updated_at. Seed all 6 tiers from matrix; free/enterprise/beta_unlimited have null price IDs.

## Phased build
- Phase 0 Recon + decisions — DONE 2026-06-08.
- Phase 1 Foundation (TEST mode, $0 moved):
  (Russ) Create LoraMer Stripe account under russ@loramer.com, Test mode, grab test secret key sk_test_...; set as STRIPE_SECRET_KEY in Vercel env + local env — value NEVER in chat.
  (Claude Code) Migration: create+seed plan_entitlements; reconcile tier (migrate solo->business, update user_profiles.tier CHECK to canonical set). Committed migration file (prior ad-hoc tables had none).
  (Claude Code) Idempotent script: create Stripe products Business/Agency/Scale each with monthly+annual price (annual=20% off), TEST mode; write price IDs back into plan_entitlements. Re-runnable for live.
  Done-when: plan_entitlements seeded w/ price IDs; products live in Stripe test; key in env; $0 moved.
- Phase 2 Data+sync — DONE 2026-06-09 (TEST mode, verified end-to-end). Migration 008 (subscriptions mirror + stripe_events dedupe + user_profiles.stripe_customer_id). ensureStripeCustomer wired into /api/welcome (best-effort, never throws, skips @loramer.app synthetic accounts). Webhook POST /api/stripe/webhook (signature-verified, livemode-gated, event-id dedupe, out-of-order guard) handles checkout.session.completed + customer.subscription.created/updated/deleted -> upserts subscriptions + writes user_profiles.tier. STRIPE_SECRET_KEY + STRIPE_WEBHOOK_SECRET in Vercel Production; endpoint registered (we_1TgXCr...). Verified: bad-sig->400; created->business; cancel_at_period_end->still business (grace); canceled->free; resend dedup no-op; checkout.session.completed received/acked. invoice.* intentionally NOT handled in Phase 2 (entitlement rides on subscription.* status; dunning deferred).
  - LOCKED answers (this build): customer hook = /api/welcome (best-effort). Manual-tier guard = webhook NEVER overrides beta_unlimited/enterprise. past_due = entitled (grace). No trial configured; trialing = entitled. TEST/LIVE kept separate via event.livemode gate + a livemode column (one mode active per environment).
- Phase 3 Checkout: Upgrade buttons -> server-created Checkout session -> success/cancel -> user lands on paid tier. Preview-test.
- Phase 4 Customer Portal: enable in Stripe (Settings > Billing > Customer portal, allow plan switching); "Manage billing" -> portal session.
- Phase 5 Gating: enforce matrix (workspace cap at client-creation; monthly question counter; history-window date filter; feature flags) + upgrade prompts.
- Phase 6 Go live: finish account activation (bank/legal), flip test->live keys, register live webhook, smoke test. Times with ~July 14 soft launch.

## Soft-launch sequencing
Founding cohort = beta_unlimited bypasses gating, so July 14 needs only the MONEY PATH (Phases 1-3ish), not full enforcement. Heavy enforcement (Phase 5) can be pre-public-launch (Q4).

## Open items to confirm next session
- Annual price rounding: SHIPPED marketing-rounded in Phase 1 — Business $750 / Agency $1900 / Scale $9500 (Stripe TEST prices live). (Superseded the $758/$1910/$9590 proposal.)
- Free trial? DECIDED for now: NO trial configured (Free tier IS the trial). Webhook already treats `trialing` as entitled, so adding a trial later is config-only, no code change.
- Landing copy fix: Enterprise card still says "Contract billing outside Shopify" (stale); reconcile "Business" label vs DB key. (Still open.)
