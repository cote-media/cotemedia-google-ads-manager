-- LORAMER_ANALYZE_MAINTENANCE_REAL_V1 — migration 093: the nightly parent ANALYZE gets the time it needs.
-- APPLIED 2026-09-13 via MCP apply_migration (the job alter is a catalog row, live the moment it is run; this
-- file is the record of it, the 053 pattern).
--
-- ⛔ WHAT WAS WRONG (read 2026-09-13, round 11 — cron.job_run_details, VERIFIED): the job
-- 'loramer-analyze-metrics-daily' (jobid 1, '30 3 * * *', `SELECT public.analyze_metrics_daily()`, role postgres)
-- FAILED 40 of 40 nightly runs from its first night 2026-08-05 to 2026-09-13, every one with
--   ERROR:  canceling statement due to statement timeout
--   CONTEXT:  SQL statement "ANALYZE public.metrics_daily"  PL/pgSQL function analyze_metrics_daily() line 17
-- ended 2:00–2:04 min after 03:30:00Z — the cluster's statement_timeout (120000 ms; the postgres role sets only
-- search_path) against a job measured at 158 s on 2026-08-04 at 145 partitions (the only two runs that ever
-- committed were the 08-04 hand runs, which is why maintenance_analyze_log stops there: the function's own
-- 'failed' row is written inside the transaction the timeout aborts and its RAISE rolls it back). The parent's
-- planner statistics have been the 2026-08-04 set since; check-parent-analyze read green the whole time
-- (a stale success row with no recency term + a pg_stat stamp PostgreSQL writes non-transactionally even for a
-- cancelled run). The instrument half is scripts/check-parent-analyze.mjs (legs (c') / (c'')).
--
-- ⛔ WHERE THE CEILING LIVES, AND WHY NOT ELSEWHERE: statement_timeout is armed when a top-level statement
-- STARTS, so `ALTER FUNCTION … SET statement_timeout` cannot help a statement already running the function;
-- `ALTER ROLE postgres SET statement_timeout` would lift the 120 s safety from everything that role runs
-- (the over-broad grant class docs/LORAMER_SECURITY_POSTURE.md forbids). The per-job command is the surgical
-- place: pg_cron sends the command string as ONE simple query, in which the SET takes effect before the
-- SELECT that follows begins and arms its own timer. 30 minutes = the measured 158 s × ~11 headroom for the
-- table's growth (pg_class.reltuples 179,962,480 on 2026-09-13; 145 partitions) — sized from the measurement,
-- not the clock; if a run ever needs more than that the finding is the growth, not the ceiling.
--
-- analyze_metrics_daily() is deliberately UNCHANGED (its ledger can only hold committed successes; the check now
-- asks it exactly that). Schedule unchanged. REVERT: select cron.alter_job(job_id := 1,
--   command := 'SELECT public.analyze_metrics_daily()');

select cron.alter_job(
  job_id  := (select jobid from cron.job where jobname = 'loramer-analyze-metrics-daily'),
  command := $cmd$SET statement_timeout = '30min'; SELECT public.analyze_metrics_daily()$cmd$
);
