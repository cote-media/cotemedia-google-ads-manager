-- LORAMER_SHOPIFY_INSTALL_V1
-- Migration: shopify_installs table
-- Run once via Supabase SQL Editor on May 25, 2026.
--
-- Purpose: maps a Shopify shop domain back to the LoraMer user and client
-- that owns it. Used by the Shopify-initiated install flow in
-- /api/shopify/callback to make reinstalls idempotent — if a merchant
-- uninstalls and reinstalls, we find the existing user/client and just
-- reattach tokens, rather than creating a duplicate.
--
-- Keyed on shop_domain (primary key) because a shop can only be owned by
-- one Shopify-install-created user at a time. The shopify_tokens table is
-- still keyed on (user_email, shop_domain) since one user could connect
-- multiple stores.

CREATE TABLE IF NOT EXISTS shopify_installs (
  shop_domain TEXT PRIMARY KEY,
  user_email TEXT NOT NULL,
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_shopify_installs_user_email
  ON shopify_installs(user_email);
