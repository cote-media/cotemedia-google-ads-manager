-- LORAMER_META_FBUSERID_FOUNDATION_V1
-- Migration 006: Meta compliance foundation (Phase 1).
-- Run via Supabase SQL Editor. Safe to re-run (idempotent).
--
-- Adds the app-scoped Facebook user id to meta_tokens so that Meta's
-- deauthorize + data-deletion callbacks (Phase 2), which identify the person
-- ONLY by signed_request user_id, can be mapped back to a LoraMer user.
-- Also creates meta_compliance_log (mirror of shopify_compliance_log) as the
-- audit/idempotency store for those callbacks.
--
-- Does NOT touch metrics_daily or any of its constraints.

ALTER TABLE meta_tokens ADD COLUMN IF NOT EXISTS fb_user_id text;

CREATE INDEX IF NOT EXISTS idx_meta_tokens_fb_user_id ON meta_tokens(fb_user_id);

CREATE TABLE IF NOT EXISTS meta_compliance_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL CHECK (kind IN ('deauthorize','data_deletion')),
  fb_user_id text,
  user_email text,
  confirmation_code text,
  status text,
  detail jsonb,
  received_at timestamptz DEFAULT now()
);
