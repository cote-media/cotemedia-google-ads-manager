# LoraMer — Stripe Billing Plan
Status: 2026-06-08. Source of truth = this file + repo. Supersedes any "Shopify Managed Pricing" references in ROADMAP.

## Decisions (LOCKED)
- Processor: Stripe. Shopify path is data-connector + free install funnel only — never touches money.
- Stripe account: a SEPARATE dedicated LoraMer account owned by russ@loramer.com (NOT the cotebrandmarketing@gmail / FreshBooks / Cote Media account). Standalone signup, not the account-switcher. Why: own statement descriptor ("LoraMer" on customer cards), clean financial separation, transferable if LoraMer becomes its own entity/raises/sells. Build entirely in TEST mode; bank/legal activation only needed at go-live (Phase 6).

## Account model (Phase 0 recon, confirmed)
- Billing key = user_email (text, threaded everywhere). No agency/account/workspace table.
- Hierarchy: user_email -> clients[] (a "client" row = a workspace) -> platform connections/data. 1 user = 1 account = many workspaces. Stripe customer maps 1:1 to user_email.
- user_profiles already exists: user_email PK, tier text CHECK in (free,solo,agency,scale,enterprise,beta_unlimited), welcome_seen_at, timestamps. ENFORCEMENT STATUS (updated 2026-06-29): Stripe Phases 0–4 (recon→data/sync→checkout→portal) SHIPPED 2026-06-08..10 — tier is now WRITTEN by the Stripe webhook and read by the billing UI; full caps/quotas/flags enforcement = Phase 5 (PENDING; founding cohort = beta_unlimited bypasses it).
- anthropic_spend_log exists (per-call cost log, not a quota). No Stripe columns/tables/env anywhere — greenfield.
- beta_unlimited = founding-cohort mechanism (uncapped, hand-onboarded, bypasses gating).

## Entitlement matrix (LOCKED — mirror of the canonical matrix)
> CANONICAL PRICING SOURCE = **LORAMER_DECISIONS.md** (§LOCKED PRODUCT/POLICY/DATA DECISIONS → the "Entitlement matrix LOCKED" line). The rows below MIRROR it for context; on any discrepancy, LORAMER_DECISIONS.md wins. This is a one-way pointer (the old "source of truth = each other" DECISIONS↔STRIPE loop was broken 2026-07-05). A PROPOSED successor matrix (soft-locked 2026-07-05, NOT enforced) lives in **docs/PRICING_MODEL_2026_07.md** — do not enforce until Phase-5 gating ships.
- free / Free / $0 / 1 workspace / 5 Q-mo / 30-day view window / no flags
- business / Business / $79-mo / $750-yr / 1 workspace / 100 Q-mo / 12-month (365d) view window / no flags
- agency / Agency / $199-mo / $1900-yr / 10 workspaces / 500 Q-mo / full history / flags: wyws, priority_support
- scale / Scale / $999-mo / $9500-yr / 50 workspaces / 2500 Q-mo / full history / flags: wyws, priority_support, automations, white_label, bulk_export, sla
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
- Phase 3 Checkout — DONE 2026-06-09 (TEST mode, full click-test verified on prod). New `/billing` page (current plan, annual/monthly toggle default annual w/ "save 20%", self-serve plan cards, human-readable feature labels, success-poll) + "Billing & Plan" link in the dashboard account menu. `POST /api/billing/checkout` (auth + server-side validation: self-serve tier only, interval, price non-null, not a manual tier, no existing active sub) -> ensureStripeCustomer backstop -> Stripe hosted Checkout (mode=subscription, client_reference_id=user_email, success/cancel on NEXTAUTH_URL). `GET /api/billing` powers the UI + success polling. Verified end-to-end: 4242 card -> Business annual -> webhook flips tier.
  - TWO FIXES found in the click-test (both shipped + verified): (FIX A, LORAMER_STRIPE_PHASE3_FIX_UPSERT_V1) all billing writes to user_profiles are now UPSERTs — UPDATE silently no-op'd for users with no profile row, so tier landed nowhere; manual-tier guard preserved, stripe_customer_id set only when null, affected-row count checked + logged on 0. (FIX B, LORAMER_STRIPE_PHASE3_FIX_WELCOMEGATE_V1) the welcome/profile-creation gate now covers /dashboard + /clients + /billing (shared enforceWelcomeGate), not /clients only — a sign-in landing on /dashboard had bypassed row creation entirely.
  - Verified: created->business, cancel_at_period_end->business (grace), canceled->free; welcome gate fires on /dashboard + /billing for a profile-less user. Lessons 39 (check affected-row count; UPSERT when row may be absent) + 40 (never show internal flag/enum keys to users) logged in LORAMER_HANDOFF.md.
- Phase 4 Customer Portal — DONE + VERIFIED 2026-06-10 (LORAMER_STRIPE_PHASE4_PORTAL_V1 33fca5c + LORAMER_STRIPE_PHASE4_VERIFIED_V1 c479cb3). POST /api/billing/portal (src/app/api/billing/portal/route.ts) → billingPortal session (configuration=STRIPE_PORTAL_CONFIG_ID, return_url=/billing); plan switch/cancel ride the existing webhook handlers. TEST portal config bpc_… created via API (configs don't cross modes — Phase 6 must re-create in LIVE). Verified end-to-end on prod TEST.
- Phase 5 Gating: enforce matrix (workspace cap at client-creation; monthly question counter; history-window date filter; feature flags) + upgrade prompts.
- Phase 6 Go live: finish account activation (bank/legal), flip test->live keys, register live webhook, smoke test. Times with ~July 14 soft launch.

## Soft-launch sequencing
Founding cohort = beta_unlimited bypasses gating, so July 14 needs only the MONEY PATH (Phases 1-3ish), not full enforcement. Heavy enforcement (Phase 5) can be pre-public-launch (Q4).

## Open items to confirm next session
- Annual price rounding: SHIPPED marketing-rounded in Phase 1 — Business $750 / Agency $1900 / Scale $9500 (Stripe TEST prices live). (Superseded the $758/$1910/$9590 proposal.)
- Free trial? DECIDED for now: NO trial configured (Free tier IS the trial). Webhook already treats `trialing` as entitled, so adding a trial later is config-only, no code change.
- Landing copy fix: Enterprise card still says "Contract billing outside Shopify" (stale); reconcile "Business" label vs DB key. (Still open.)
