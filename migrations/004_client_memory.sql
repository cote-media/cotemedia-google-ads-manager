-- LORAMER_MEMORY_V1
-- Migration 004: client_memory table
-- Run via Supabase SQL Editor.
--
-- The structured-facts layer for Project 9 Phase 2. Stores durable knowledge
-- about each client: directives, facts, observations, preferences, context.
-- Read by build-claude-context.ts and injected into Claude's system prompt
-- above conversation history.
--
-- Source-of-truth boundary:
--   - client_context.user_notes = free-text the user typed into the profile form
--   - client_conversations      = every message ever sent
--   - client_memory             = structured facts Claude "knows"
--
-- Phase 2 = user-explicit facts only (manual UI + regex auto-detect of
--           "Remember:", "Always", "Never"). Phase 2.5 = Claude-observed
--           extraction via Haiku background job.
--
-- Soft-delete semantics: archive, never hard-delete. Matches LoraMer's
-- "deep knowledge accumulates" brand promise (same logic as conversations).

CREATE TABLE IF NOT EXISTS client_memory (
  id BIGSERIAL PRIMARY KEY,
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  user_email TEXT NOT NULL,

  -- The fact itself
  content TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN (
    'directive',   -- binding rule from the user (e.g. "ignore ROAS")
    'fact',        -- durable truth (e.g. "no e-commerce on this site")
    'observation', -- Claude noticed; needs confirmation (Phase 2.5)
    'preference',  -- how user wants responses (e.g. "prefers tables")
    'context'      -- background (e.g. "B2B SaaS, targeting facility managers")
  )),
  confidence REAL NOT NULL DEFAULT 1.0 CHECK (confidence >= 0.0 AND confidence <= 1.0),

  -- Provenance
  source TEXT NOT NULL CHECK (source IN (
    'user_explicit',       -- user added via memory editor UI
    'user_conversation',   -- detected from chat ("Remember: X")
    'claude_extracted',    -- Phase 2.5: Haiku extracted from conversation
    'claude_observed',     -- Phase 2.5: Claude pattern observation
    'bootstrap_legacy'     -- migrated from existing user_notes / directives
  )),
  source_conversation_id BIGINT REFERENCES client_conversations(id) ON DELETE SET NULL,

  -- Metadata
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  archived_at TIMESTAMPTZ,
  pinned BOOLEAN NOT NULL DEFAULT FALSE,
  last_referenced_at TIMESTAMPTZ
);

-- Default fetch: active facts for a client, pinned first, then by confidence,
-- then most recent
CREATE INDEX IF NOT EXISTS idx_client_memory_client_active
  ON client_memory(client_id, archived_at, pinned DESC, confidence DESC, created_at DESC);

-- Lookup by category (for the UI grouping)
CREATE INDEX IF NOT EXISTS idx_client_memory_category
  ON client_memory(client_id, category, archived_at);

-- Per-user audits (Project 20 prep)
CREATE INDEX IF NOT EXISTS idx_client_memory_user_email
  ON client_memory(user_email);

-- Trigger to keep updated_at in sync
CREATE OR REPLACE FUNCTION update_client_memory_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_client_memory_updated_at ON client_memory;
CREATE TRIGGER trg_client_memory_updated_at
  BEFORE UPDATE ON client_memory
  FOR EACH ROW
  EXECUTE FUNCTION update_client_memory_updated_at();

SELECT 'client_memory created' AS status
WHERE EXISTS (
  SELECT 1 FROM information_schema.tables
  WHERE table_name = 'client_memory'
);
