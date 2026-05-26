-- LORAMER_CONV_API_V1
-- Migration 002: client_conversations table
-- Run via Supabase SQL Editor on May 25, 2026.
--
-- Purpose: unified storage for all Claude conversations across all surfaces.
-- Replaces the JSONB blob at client_context.conversations.
--
-- Surfaces that write here:
--   - right-panel (✦ diamond on any row or card, slide-out panel)
--   - insight-chat (the blue Claude analysis banner with Reply button)
--   - ask-claude-tab (the dedicated ASK CLAUDE tab in left sidebar)
--
-- Scope is optional per-surface metadata:
--   - For card-diamond and right-panel: "<card-title-slug>:<platform>"
--     e.g. "campaign-performance:google", "customer-mix:meta"
--   - For insight-chat: "<location>-<platform>"
--     e.g. "overview-google", "shopify-meta"
--   - For ask-claude-tab: null (no scope; one conversation per client)
--
-- Hidden rows: When a user clicks the "Clear" button on the insight banner,
-- rows are soft-deleted (hidden_at set) instead of removed. The intelligence
-- layer still reads them so Claude preserves memory. The UI filters them out.
-- See migration 003 for the hidden_at column.

CREATE TABLE IF NOT EXISTS client_conversations (
  id BIGSERIAL PRIMARY KEY,
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  user_email TEXT NOT NULL,
  surface TEXT NOT NULL,
  scope TEXT,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_client_conversations_client_id
  ON client_conversations(client_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_client_conversations_surface
  ON client_conversations(client_id, surface, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_client_conversations_user_email
  ON client_conversations(user_email);

-- Migration tracking column on client_context (used by the one-time data
-- migration that flattened the JSONB conversations blob into rows here)
ALTER TABLE client_context
  ADD COLUMN IF NOT EXISTS conversations_migrated_at TIMESTAMPTZ;
