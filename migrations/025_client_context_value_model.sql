-- LORAMER_CLIENT_VALUE_MODEL_V1 — declared client value model (online-purchase / offline-sales / lead).
-- Additive, nullable jsonb array; existing rows keep value_model = NULL (no data backfill). Stored/read via the
-- generic /api/context spread (no route change); Lora reads it via intelligence.profile.valueModel →
-- build-claude-context "Client value model: …" (always-on, never suppressed by business_descriptor).
-- Applied to prod via Supabase MCP 2026-07-03.
ALTER TABLE public.client_context ADD COLUMN IF NOT EXISTS value_model jsonb;
