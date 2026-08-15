-- LORAMER_WALK_LIVENESS_ROWS_RPC_V1 — the walk-liveness rows counter, as a scalar the instrument can actually read.
--
-- ⛔ THE DEFECT THIS REPLACES (★WALK-LIVENESS-ROWS-COUNTER-IS-STRUCTURALLY-ZERO, measured 2026-08-15):
-- scripts/check-walk-liveness.mjs read `universe_attempt_log?select=rows_written.sum()` over PostgREST —
-- and AGGREGATES ARE DISABLED ON THIS PROJECT. The live response is HTTP 400 PGRST123 ("Use of aggregate
-- functions is not allowed"), the body is an error OBJECT rather than a row array, and
-- `Array.isArray(body) ? Number(body[0]?.sum ?? 0) : 0` turned that failure into a SILENT 0 on every run
-- since the check shipped. Every `rows=0` it ever printed was a failed read wearing a number. It is the
-- DEPLOY 2 GATE'S OWN INSTRUMENT (`rows_written > 0` opens Deploy 2), so on the day the walk finally wrote
-- rows the gate's instrument would still have said zero.
--
-- ⛔ WHY AN RPC AND NOT A NODE-SIDE SUM OVER ROWS — THE PAGE CAP, ALREADY MEASURED IN THIS REPO:
-- universe_attempt_log takes ~1,500 rows/24h at today's 960/day rate and 4× that after Deploy 2; a Node-side
-- sum truncates at PostgREST's 1,000-row page cap (measured on this very table: 10,788 rows, sum read as
-- 997 — universe-attempt-log.ts:193). A scalar cannot be page-capped; a row set can. Same design as its
-- siblings universe_lane_spend_today (057) and universe_attempt_lane_spend_today (061).
--
-- ⛔ IT SUMS `attempt_finished`, AND FOR THIS COUNTER THAT IS CORRECT — the mirror image of the spend
-- aggregate's choice. Spend is charged at attempt_started (a killed call still spent quota); rows_written is
-- only KNOWN at attempt_finished (the started row carries null). Summing started rows here would read null
-- as nothing and understate nothing today, but the phase whose column holds the fact is the phase to sum.
create or replace function public.universe_walk_rows_written(p_since timestamptz)
returns bigint
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(sum(rows_written), 0)::bigint
  from public.universe_attempt_log
  where phase = 'attempt_finished'
    and recorded_at >= p_since;
$$;

comment on function public.universe_walk_rows_written(timestamptz) is
  'LORAMER_WALK_LIVENESS_ROWS_RPC_V1 — sum of rows_written over attempt_finished since p_since. Replaces the disabled-PostgREST-aggregate read in check-walk-liveness (400 PGRST123 silently became rows=0). Summed in Postgres because the attempt log outruns the 1,000-row page cap.';

-- LORAMER_RPC_GRANT_POSTURE_V1 — the full four-line posture; `revoke from public` alone leaves anon callable.
revoke all on function public.universe_walk_rows_written(timestamptz) from public;
revoke all on function public.universe_walk_rows_written(timestamptz) from anon;
revoke all on function public.universe_walk_rows_written(timestamptz) from authenticated;
grant execute on function public.universe_walk_rows_written(timestamptz) to service_role;
