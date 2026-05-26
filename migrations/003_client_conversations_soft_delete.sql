-- LORAMER_CONV_SOFT_DELETE_V1
-- Migration 003: hidden_at column on client_conversations
-- Run via Supabase SQL Editor on May 25, 2026.
--
-- Purpose: implement soft-delete semantics for the Clear button in InsightChat
-- (and any future Clear UI on other surfaces). When user hides a conversation,
-- we set hidden_at = NOW() instead of deleting rows.
--
-- Why soft delete (this is core to LoraMer's brand promise):
--   LoraMer means "deep knowledge that accumulates." A Clear button that
--   wipes memory contradicts the brand. Users clearing the UI are saying
--   "I don't want to look at this anymore," not "forget this happened."
--   Claude's intelligence layer (build-claude-context.ts) reads ALL rows
--   including hidden ones so memory is preserved.
--
-- UI behavior:
--   - GET /api/conversations defaults to hidden_at IS NULL (UI hides them)
--   - GET /api/conversations?includeHidden=true returns everything (used
--     by the prompt builder context fetch)
--   - DELETE /api/conversations performs UPDATE hidden_at = NOW(), not row delete

ALTER TABLE client_conversations
  ADD COLUMN IF NOT EXISTS hidden_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_client_conversations_hidden_at
  ON client_conversations(client_id, hidden_at);
