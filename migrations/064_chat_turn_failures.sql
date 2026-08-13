-- LORAMER_CHAT_TURN_FAILED_DURABLE_V1 — the durable failed-turn instrument.
-- Migration 064: chat_turn_failures. Applied via Supabase MCP 2026-08-12.
--
-- WHY: ★CHAT-TURN-FAILED-TELEMETRY-INVISIBLE — the `[chat] TURN FAILED` line is a console.error in a
-- CLIENT component, so it prints to the browser and never reaches a server log (proven 2026-08-05:
-- Vercel returned "No logs found" over the exact window). And since LORAMER_CHAT_TURN_PAIR_WRITE_V1
-- (86bb230) a failed turn leaves ZERO conversation rows BY DESIGN — so this table is the ONLY durable
-- witness for "did the user ask something and get nothing?", the exact instrument the pair-write
-- decision deferred here.
--
-- APPEND-ONLY TELEMETRY. Three phases, correlated by correlation_key:
--   turn-failed       — the client's catch branch: what threw, whether our own abort fired
--   recovery-verdict  — what the in-turn 90s recovery poll concluded (found/ambiguous/nothing)
--   mount-recovery    — the died-browser class's only witness: what the next mount found
-- recovered='nothing' on a verdict row IS "asked and got nothing".
--
-- ⛔ NO question text, NO answer text — failure metadata only. err_message is the ERROR string,
-- truncated at the route; user content never travels through this instrument.
--
-- REVERT PATH: drop table public.chat_turn_failures; (telemetry only — no captured data lives here,
-- metrics_daily is not named in this file).
-- NO STAGING DATABASE: applied directly to the live project, like every migration in this repo.

set lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS public.chat_turn_failures (
  id BIGSERIAL PRIMARY KEY,
  client_id UUID,
  user_email TEXT NOT NULL,
  surface TEXT NOT NULL,
  phase TEXT NOT NULL CHECK (phase IN ('turn-failed', 'recovery-verdict', 'mount-recovery')),
  branch TEXT,
  err_name TEXT,
  err_message TEXT,
  signal_aborted BOOLEAN,
  elapsed_ms INTEGER,
  correlation_key TEXT NOT NULL,
  recovered TEXT CHECK (recovered IN ('found', 'ambiguous', 'nothing') OR recovered IS NULL),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_chat_turn_failures_created
  ON public.chat_turn_failures (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_chat_turn_failures_key
  ON public.chat_turn_failures (correlation_key);

-- RLS ON, ZERO POLICIES — deny-all except service_role, the metrics_daily posture. A new table created
-- without this silently becomes readable by roles that cannot read its siblings (the partition swap's
-- BLOCKER 3 lesson): a security regression dressed as a telemetry table.
ALTER TABLE public.chat_turn_failures ENABLE ROW LEVEL SECURITY;
