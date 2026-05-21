-- Add columns to shopify_tokens for expiring offline tokens
-- Run this in Supabase SQL Editor

ALTER TABLE shopify_tokens
  ADD COLUMN IF NOT EXISTS refresh_token TEXT,
  ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS refresh_token_expires_at TIMESTAMPTZ;

-- Optional: index for faster lookups during refresh checks
CREATE INDEX IF NOT EXISTS shopify_tokens_expires_at_idx
  ON shopify_tokens (expires_at);
