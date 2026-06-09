-- Migration 007: Stripe billing foundation
-- LORAMER_STRIPE_PHASE1_V1
-- Creates the DB-driven entitlement source of truth (plan_entitlements) and
-- reconciles the tier vocabulary (solo -> business) per STRIPE_BILLING_PLAN.md.
-- Dollar PRICES live in Stripe; this table holds caps/quotas/flags + Stripe price IDs.
-- Run in the Supabase SQL Editor OR via the Supabase MCP apply_migration.

-- 1. Tier reconcile: rename solo -> business everywhere, then tighten the CHECK.
--    (No 'solo' rows exist today; the UPDATE is a safe no-op kept for re-runnability.)
UPDATE public.user_profiles SET tier = 'business' WHERE tier = 'solo';

ALTER TABLE public.user_profiles DROP CONSTRAINT IF EXISTS user_profiles_tier_check;
ALTER TABLE public.user_profiles ADD CONSTRAINT user_profiles_tier_check
  CHECK (tier IN ('free','business','agency','scale','enterprise','beta_unlimited'));

-- 2. plan_entitlements — single source of truth for caps/quotas/flags per tier.
--    null in a cap/quota/window column = unlimited. feature_flags = jsonb array of enabled flags.
CREATE TABLE IF NOT EXISTS public.plan_entitlements (
  tier                 text PRIMARY KEY,
  display_name         text NOT NULL,
  workspace_cap        int,                              -- null = unlimited
  questions_per_month  int,                              -- null = unlimited
  history_window_days  int,                              -- null = full history
  feature_flags        jsonb NOT NULL DEFAULT '[]'::jsonb,
  stripe_price_monthly text,                             -- filled by the Stripe sync script
  stripe_price_annual  text,                             -- filled by the Stripe sync script
  updated_at           timestamptz NOT NULL DEFAULT now()
);

-- 3. Seed all 6 tiers from the LOCKED entitlement matrix. Price IDs stay null until the
--    Stripe product/price script runs (free/enterprise/beta_unlimited have no self-serve price).
INSERT INTO public.plan_entitlements
  (tier, display_name, workspace_cap, questions_per_month, history_window_days, feature_flags) VALUES
  ('free',           'Free',       1,    5,    30,   '[]'::jsonb),
  ('business',       'Business',   1,    100,  365,  '[]'::jsonb),
  ('agency',         'Agency',     10,   500,  NULL, '["wyws","priority_support"]'::jsonb),
  ('scale',          'Scale',      50,   2500, NULL, '["wyws","priority_support","automations","white_label","bulk_export","sla"]'::jsonb),
  ('enterprise',     'Enterprise', NULL, NULL, NULL, '["wyws","priority_support","automations","white_label","bulk_export","sla"]'::jsonb),
  ('beta_unlimited', 'Founding',   NULL, NULL, NULL, '["wyws","priority_support","automations","white_label","bulk_export","sla"]'::jsonb)
ON CONFLICT (tier) DO NOTHING;
