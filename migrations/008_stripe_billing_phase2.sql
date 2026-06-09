-- Migration 008: Stripe billing Phase 2 — data + sync foundation
-- LORAMER_STRIPE_PHASE2_MIGRATION_V1
-- Adds the subscriptions mirror, the event-dedupe table, and the user->customer link.
-- All additive (one new nullable column + two new tables) — no risk to existing reads.
-- Stripe remains the source of truth; these tables are a fast-read mirror synced by the webhook.
-- Run via Supabase MCP apply_migration OR the SQL Editor.

-- 1. Link a LoraMer user (user_email) to its single Stripe customer. 1:1, hence UNIQUE.
ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS stripe_customer_id text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'user_profiles_stripe_customer_id_key'
  ) THEN
    ALTER TABLE public.user_profiles
      ADD CONSTRAINT user_profiles_stripe_customer_id_key UNIQUE (stripe_customer_id);
  END IF;
END $$;

-- 2. subscriptions — one row per Stripe subscription, mirrored from webhook events.
--    id = Stripe subscription id (sub_...). tier is the LoraMer tier this sub grants
--    (resolved from the price via plan_entitlements). null period/timestamps allowed.
CREATE TABLE IF NOT EXISTS public.subscriptions (
  id                   text PRIMARY KEY,                 -- Stripe sub_... id
  user_email           text NOT NULL,
  stripe_customer_id   text NOT NULL,
  status               text NOT NULL,                    -- active/trialing/past_due/canceled/unpaid/incomplete/incomplete_expired/paused
  tier                 text NOT NULL,                    -- LoraMer tier granted (from price)
  price_id             text,
  interval             text,                             -- month | year
  current_period_end   timestamptz,
  cancel_at_period_end boolean NOT NULL DEFAULT false,
  canceled_at          timestamptz,
  livemode             boolean NOT NULL DEFAULT false,   -- TEST vs LIVE separation in one shared DB
  last_stripe_event_at timestamptz,                      -- out-of-order event guard
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS subscriptions_user_email_idx ON public.subscriptions (user_email);
CREATE INDEX IF NOT EXISTS subscriptions_customer_idx   ON public.subscriptions (stripe_customer_id);

-- 3. stripe_events — webhook idempotency / dedupe. PK on the Stripe event id makes
--    re-delivered events a no-op (insert conflict => already processed).
CREATE TABLE IF NOT EXISTS public.stripe_events (
  id          text PRIMARY KEY,                          -- Stripe evt_... id
  type        text,
  received_at timestamptz NOT NULL DEFAULT now()
);
