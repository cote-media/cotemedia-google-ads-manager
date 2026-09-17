-- 096_universe_run.sql — LORAMER_CONTINUOUS_RUN_V1
--
-- ⛔ WHAT THIS IS: the state of ONE continuous backfill run for ONE (client, vendor), and the thing build 3b's
-- per-platform Backfill button reads to say "running / done / how far". It is NOT a second fire log —
-- `universe_fire_log` still owns per-fire facts, and this table owns only what a fire cannot: whether a RUN is
-- in progress, and whether the next step should follow immediately.
--
-- ⛔ ONE ROW PER (client_id, vendor) LANE, matching `universe_fire_lease` (migration 085) exactly. The lease
-- already guarantees two FIRES of one lane never overlap; this key guarantees two RUNS never do. Two keys with
-- one shape is deliberate: a run outlives the fires inside it, so it cannot borrow the lease's row.
--
-- ⛔ VENDOR, NOT PLATFORM, AND NOT 'google'. The column is the capture universe's own name
-- (LORAMER_CAPTURE_UNIVERSE_NAMED_FOR_THE_API_V1: `google_ads`, not `google`), so a second platform gets a row
-- here by being started, never by a schema change. Nothing in this table knows which vendor it is holding.
--
-- REVERT: DROP TABLE public.universe_run;   (additive — nothing reads it until the orchestrator ships)
-- ⛔ THERE IS NO STAGING DATABASE. This can only be proven where it is applied.

CREATE TABLE IF NOT EXISTS public.universe_run (
  client_id       uuid        NOT NULL,
  vendor          text        NOT NULL,
  -- running: steps should chain · stopping: the operator asked it to stop, the current step finishes and ends
  -- done: the lane reached its stop condition · failed: a step ended the run and said why
  status          text        NOT NULL,
  started_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  finished_at     timestamptz NULL,
  -- ⛔ THE CHAIN'S OWN COUNTERS. `steps` is how many times the run has invoked a step; `requests_opened` is the
  -- vendor spend the run has caused, summed from what each step reports, so the run can be priced without
  -- joining anything.
  steps           integer     NOT NULL DEFAULT 0,
  requests_opened integer     NOT NULL DEFAULT 0,
  days_committed  integer     NOT NULL DEFAULT 0,
  -- ⛔ THE NO-PROGRESS BOUND, AS DATA RATHER THAN A HOPE. A run that keeps stepping while gaining no ground is
  -- the poison loop this engine has already paid for three times; the orchestrator ends the run when this
  -- crosses its bound, and the bound's derivation lives with the code, not here.
  steps_without_progress integer NOT NULL DEFAULT 0,
  last_step_at    timestamptz NULL,
  -- Why the run ended, in the ender's own words. NULL while running.
  stop_reason     text        NULL,
  -- The invocation that most recently owned a step, for matching against Vercel logs after the fact.
  last_invocation text        NULL,
  PRIMARY KEY (client_id, vendor)
);

-- The read build 3b's button makes: "is anything running for this client".
CREATE INDEX IF NOT EXISTS universe_run_status_idx
  ON public.universe_run (status, updated_at DESC);

COMMENT ON TABLE public.universe_run IS
  'LORAMER_CONTINUOUS_RUN_V1 — ONE row per (client, vendor) backfill RUN. Owns run-level state only: whether '
  'steps should chain, how far it has got, and why it stopped. Per-fire facts stay in universe_fire_log; the '
  'per-fire overlap guarantee stays in universe_fire_lease (085). Read by build 3b''s per-platform button.';
COMMENT ON COLUMN public.universe_run.status IS
  'running | stopping | done | failed. Only `running` chains a next step. `stopping` lets the current step '
  'finish rather than killing it mid-work — refuse-and-record, applied to the run.';
COMMENT ON COLUMN public.universe_run.steps_without_progress IS
  'Consecutive steps that committed no days. The orchestrator ends the run when this crosses its bound: a run '
  'that steps forever while gaining nothing is the poison loop, and a chain removes the cron delay that used '
  'to hide it.';

-- Grant posture (LORAMER_RPC_GRANT_POSTURE_V1): revoke the Supabase defaults BY NAME — revoking PUBLIC alone
-- does not remove them (measured, migration 065).
REVOKE ALL ON TABLE public.universe_run FROM public;
REVOKE ALL ON TABLE public.universe_run FROM anon;
REVOKE ALL ON TABLE public.universe_run FROM authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.universe_run TO service_role;
