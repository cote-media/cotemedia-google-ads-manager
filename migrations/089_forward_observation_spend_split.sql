-- 089_forward_observation_spend_split.sql
-- LORAMER_ONE_CLICK_WALK_V1 (2/2 A) — THE FORWARD LEDGER'S SPEND, SPLIT BY PRODUCER FAMILY, SO THE DRIVER IS A LANE.
--
-- WHY: 087's forward_observation_spend_today() sums EVERY producer's requests (no producer filter). Since
-- LORAMER_FORWARD_DRIVER_V1 (2/2) the catalogue driver writes the same ledger under producer 'driver-<slice>' AND a
-- cron_runs row with mode='driver'. google-op-budget.ts read the ledger sum into byLane.forward and, not knowing the
-- mode, added each driver cron_runs row as unattributed × 67 — the driver's requests counted twice (measured
-- 2026-09-11 00:41Z: "[google-op-budget] cron_runs row with UNRECOGNISED mode='driver' — counted against the fleet cap,
-- attributed to no lane" on every consumer message). One function, two sums, one read: forward = every producer NOT
-- like 'driver-%', driver = producers like 'driver-%'. 087's function is left in place (guarded readers still call it).
--
-- CREATE-only; touches no existing object. REVERT: drop function if exists public.forward_observation_spend_split(text, timestamptz);
set lock_timeout = '5s';

create or replace function public.forward_observation_spend_split(p_vendor text, p_since timestamptz)
returns table (forward bigint, driver bigint)
language sql
stable
security definer
set search_path = public
as $$
  select
    coalesce(sum(requests_spent) filter (where producer not like 'driver-%'), 0)::bigint as forward,
    coalesce(sum(requests_spent) filter (where producer like 'driver-%'), 0)::bigint as driver
  from public.forward_observation_log
  where vendor = p_vendor
    and observed_at >= p_since;
$$;

revoke all on function public.forward_observation_spend_split(text, timestamptz) from public;
revoke all on function public.forward_observation_spend_split(text, timestamptz) from anon;
revoke all on function public.forward_observation_spend_split(text, timestamptz) from authenticated;
grant execute on function public.forward_observation_spend_split(text, timestamptz) to service_role;

comment on function public.forward_observation_spend_split(text, timestamptz) is
  'LORAMER_ONE_CLICK_WALK_V1 (2/2 A) — forward_observation_log requests since p_since for p_vendor, split forward (producer not like driver-%) / driver (producer like driver-%). Read only through src/lib/backfill/forward-observation-log.ts readForwardObservationSpendSplit; google-op-budget byLane.forward + byLane.driver come from this ONE read so no request is counted twice.';
