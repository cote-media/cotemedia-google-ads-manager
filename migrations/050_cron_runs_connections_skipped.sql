-- 050_cron_runs_connections_skipped.sql — LORAMER_CONNECTION_OUTCOME_LEDGER_V1.
--
-- ✅ APPLIED 2026-07-31 (Supabase MCP, name `cron_runs_connections_skipped`; verified live: integer, NOT NULL,
-- default 0). Authored 2026-07-31. Additive only: ONE new column with a default.
-- No ALTER of an existing column, no DROP, no backfill, no touch to any other table.
-- REVERT = DROP COLUMN (bottom of this file).
--
-- ⛔ THE PROBLEM IT EXISTS FOR. cron_runs had three connection counters — attempted / succeeded / errored —
-- and succeeded was computed as `attempted - errored`. That arithmetic has no room for a THIRD outcome, so
-- a connection that was skipped had nowhere to go and was silently absorbed into succeeded. MEASURED
-- 2026-07-31: shopify catchup recorded `att 9 / ok 9 / err 0` on every run of 07-29 and 07-30 while two of
-- those nine connections could not authenticate at all and the forward lane recorded them as hard errors.
--
-- ⛔ WHY A COLUMN AND NOT A DERIVED VALUE. attempted - (succeeded + errored) would give the skip count only
-- while all three are honest, which is the thing that just failed. The skip is a MEASUREMENT, not a
-- remainder: per the denominator law (LORAMER_EMPTY_CARRIES_ITS_DENOMINATOR_V1) "we did not look" has to be
-- recorded where a reader looks for it, next to its two siblings, not reconstructed by the reader.
--
-- ⛔ ORDERING HAZARD, STATED. Every push to main auto-deploys. If the code that writes this column ships
-- BEFORE this migration runs, PostgREST rejects the whole UPDATE on an unknown column and finished_at stops
-- being stamped — which is the silent-hole signal, so a monitoring fix would have caused a monitoring
-- outage. cron-runs.ts therefore retries WITHOUT the column and logs loudly if it is missing. Apply this
-- first anyway; the fallback is a seatbelt, not the plan.

ALTER TABLE public.cron_runs
  ADD COLUMN IF NOT EXISTS connections_skipped integer NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.cron_runs.connections_skipped IS
  'LORAMER_CONNECTION_OUTCOME_LEDGER_V1 - connections ATTEMPTED that neither completed work nor recorded an error (e.g. catchup found no gap days, so it never reached the credential call). A skip is its own outcome: it is NOT a success and NOT an error, and before this column existed it was absorbed into connections_succeeded by the expression `attempted - errored`. attempted = succeeded + errored + skipped by construction from 2026-07-31 onward; rows written before that date have skipped=0 because the count did not exist, NOT because nothing was skipped.';

-- REVERT:
-- ALTER TABLE public.cron_runs DROP COLUMN IF EXISTS connections_skipped;
