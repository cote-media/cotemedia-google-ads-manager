-- 049_capture_pass_log.sql — LORAMER_EMPTY_CARRIES_ITS_DENOMINATOR_V1.
--
-- ✅ APPLIED TO PRODUCTION (verified live 2026-07-31 by object existence, not by memory).
-- ⛔ THIS HEADER USED TO SAY "NOT APPLIED" AND IT WAS WRONG. A migration file asserting its own applied-state is a
-- doc restating a fact the DATABASE owns (LORAMER_DOCS_NEVER_RESTATE_LIVE_STATE_V1), and six of these were stale at
-- once — read by the next session deciding whether to run them. The applied-state is now checked mechanically in
-- `npm run check:data` (doc-ownership guard), in BOTH directions. Do not restate it here again; if you must note
-- something, note the DATE it was applied, which is tense-locked history and cannot drift.
-- (Historical: authored 2026-07-31 for Russ's approval; APPLIED 2026-07-31 — I authored this header saying NOT APPLIED and it was stale within hours.) Additive only: one NEW table + two indexes.
-- No ALTER, no DROP, no touch to metrics_daily, cron_runs or entity_state_history.
-- REVERT = DROP TABLE (bottom of this file).
--
-- ⛔ THE PROBLEM IT EXISTS FOR, and it is the defining failure of 2026-07-30.
-- `entity_state_history` holding ZERO rows tomorrow is AMBIGUOUS: the writer may have run and correctly found
-- nothing changed, or the lane may have visited no clients at all. Those two states are indistinguishable
-- from the data, and the standing answer — "check the Vercel logs before concluding" — is a HUMAN
-- INSTRUCTION. Human instructions are exactly what failed all day: four separate silent losses (1,223 GA
-- days, a dead credential behind an HTTP 200, twelve 401s reported as skips, ten days of search-term absence
-- on a spending client) each produced a plausible empty that nobody was told to doubt. Vercel free-tier logs
-- also expire in ONE HOUR, so the instruction is often impossible to follow even when remembered.
--
-- ⛔ THE RULE, general and not specific to this writer: AN EMPTY RESULT MUST CARRY ITS OWN DENOMINATOR.
-- A pass writes a row here EVERY time it runs — including when it examined nothing, including when it was
-- skipped, including when it threw. Zero rows in the OUTPUT table plus a pass row saying
-- `facts_examined = 412, rows_opened = 0` means "nothing changed", and is a completely different fact from
-- NO pass row at all, which means "nothing ran". Both are now readable from the data alone.
--
-- WHY NOT cron_runs: its counters are metrics-row semantics (connections_attempted / rows_written /
-- days_filled) written once per (mode, platform) by the cron shell, and it has no jsonb column. Overloading
-- `rows_written` with a second meaning would make the existing monitor lie. This is a different grain — one
-- row per WRITER INVOCATION — and it deserves its own table rather than a borrowed column.

CREATE TABLE IF NOT EXISTS public.capture_pass_log (
  id                bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  pass_marker       text        NOT NULL,   -- 'entity_state_slice1' — which writer, so one table serves many
  mode              text        NOT NULL,   -- 'forward' | 'catchup' | 'manual'
  platform          text        NOT NULL,
  client_id         uuid        REFERENCES public.clients(id) ON DELETE CASCADE,
  account_id        text,
  observation_date  date,                   -- the day the pass was observing, not the day it ran

  -- THE DENOMINATOR. Recorded even when everything below it is zero — that is the entire point.
  entities_examined integer     NOT NULL DEFAULT 0,
  facts_examined    integer     NOT NULL DEFAULT 0,
  -- THE NUMERATOR.
  rows_opened       integer     NOT NULL DEFAULT 0,
  rows_closed       integer     NOT NULL DEFAULT 0,
  rows_touched      integer     NOT NULL DEFAULT 0,

  -- outcome: 'ok' | 'skipped' | 'error'. A skipped pass STILL writes a row — "we could not look" is a
  -- different fact from "we looked and saw nothing", and collapsing them is the ambiguity this table removes.
  outcome           text        NOT NULL,
  detail            text,                   -- the skip/error reason, verbatim
  ran_at            timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT capture_pass_log_outcome_chk CHECK (outcome IN ('ok', 'skipped', 'error'))
);

-- "did this writer run at all today, and what did it examine" — the query that resolves the ambiguity.
CREATE INDEX IF NOT EXISTS capture_pass_log_marker_ran
  ON public.capture_pass_log (pass_marker, ran_at DESC);
-- per-client history of a writer.
CREATE INDEX IF NOT EXISTS capture_pass_log_client
  ON public.capture_pass_log (client_id, pass_marker, ran_at DESC);

COMMENT ON TABLE public.capture_pass_log IS
  'LORAMER_EMPTY_CARRIES_ITS_DENOMINATOR_V1 - one row per capture-writer INVOCATION, written even when the pass examined nothing, was skipped, or threw. Zero output rows PLUS a pass row = nothing changed. NO pass row = nothing ran. Without this the two are indistinguishable and the only recourse is a Vercel log that expires in an hour.';

-- REVERT:
-- DROP TABLE IF EXISTS public.capture_pass_log;
