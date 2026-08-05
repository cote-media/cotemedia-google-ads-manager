-- LORAMER_LANE_SPEND_IS_SERVER_SIDE_V1 — THE GOVERNOR'S SPEND READ MOVES INTO POSTGRES.
--
-- ⛔ WHAT THIS FIXES, MEASURED ON THE REAL PATH 2026-08-05 13:00Z, NOT INFERRED.
-- readLaneSpendToday() summed `select('requests_spent')` in Node. PostgREST caps an un-ranged select at
-- 1,000 rows and says so ONLY in a header nobody reads:
--     content-range: 0-999/10788   →  1,000 rows returned, sum 997
-- The walk had spent 10,788 requests against a 6,000/day allowance and the governor saw 997, so it
-- authorised every single publish — ~10,800 consecutive yes answers and ZERO quota_stop rows ever
-- written. LORAMER_BACKFILL_YIELDS_TO_PRODUCT_V1 says the walk yields and the product never does; a
-- counter that saturates at 1,000 makes that law unenforceable no matter how correct the arithmetic
-- above it is.
--
-- ⛔ THE PAINFUL PART, RECORDED SO IT IS NOT REPEATED: THIS DEFECT WAS CREATED BY THE FIX FOR THE LAST
-- ONE. universe_run_state.requests_spent is cumulative per entry, so summing it billed day 2 for day 1;
-- the remedy was one row per (entry, window), which is correct — and which is exactly what pushed the
-- row count past the page cap. A row-per-unit-of-work table can never be summed a page at a time.
--
-- ⛔ WHY A FUNCTION AND NOT PAGINATION. The governor runs once per finished window — ~2,000 times an
-- hour at the observed rate. A .range() loop would cost 11 round trips per call today and grow with
-- the table. This is one indexed aggregate, and universe_window_log_spend_idx (vendor, started_at)
-- INCLUDE (requests_spent) already covers it index-only.
--
-- ⛔ p_since IS THE CALLER'S, DELIBERATELY. The day boundary is a POLICY question — our accounting day
-- starts 00:00Z while Google's developer-scope quota resets ~08:03:57Z, which is why the same walk
-- reads 10,788 on our clock and 6,190 on Google's. That misalignment is a SECOND defect with its own
-- flight (it must move in google-op-budget's fleet read at the same time, or the two disagree). Keeping
-- the boundary in the caller means that fix is a one-line change here and nothing in this function.
--
-- REVERT PATH: CREATE OR REPLACE with the prior body, or drop the function and restore the Node-side
-- sum. Nothing is written, no table is touched, no data can be lost by applying or reverting this.

create or replace function public.universe_lane_spend_today(p_vendor text, p_since timestamptz)
returns bigint
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(sum(requests_spent), 0)::bigint
  from public.universe_window_log
  where vendor = p_vendor
    and started_at >= p_since;
$$;

comment on function public.universe_lane_spend_today(text, timestamptz) is
  'LORAMER_LANE_SPEND_IS_SERVER_SIDE_V1 — today''s request spend for one universe-walk vendor lane, summed IN POSTGRES. The Node-side sum it replaces silently truncated at PostgREST''s 1,000-row page cap (measured: 10,788 rows, sum read as 997), which blinded the rate governor.';

-- ⛔ SAME POSTURE AS universe_disk_headroom (054b): the table is RLS deny-all except service_role, and
-- nothing in a browser has any business reading vendor spend.
revoke all on function public.universe_lane_spend_today(text, timestamptz) from public;
revoke all on function public.universe_lane_spend_today(text, timestamptz) from anon;
revoke all on function public.universe_lane_spend_today(text, timestamptz) from authenticated;
grant execute on function public.universe_lane_spend_today(text, timestamptz) to service_role;
