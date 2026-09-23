-- 103_universe_coverage_dates.sql — LORAMER_FIRE_PLANS_UNTIL_FULL_V1 (2026-09-23)
--
-- ONE ROUND TRIP PER COVERAGE READ. windowCoverage (src/lib/backfill/universe-coverage.ts) used to ask metrics_daily
-- ONCE PER DAY of the window from the Vercel host (`.eq('date', day).limit(1)`, 64-way concurrent): a 360-day window
-- was 360 network round trips, two reads per candidate, 60 candidates per fire — 43,200 queries, and on a COLD
-- account (Tri-Copy, 2026-09-23) the fire's scan took 249–286 s of a 282 s budget and every unit was deferred.
-- This function performs the SAME per-day probe INSIDE Postgres: generate_series over the window, one LATERAL
-- limit-1 index lookup per day on the primary key and — only when that misses — one on the drain-alias key.
-- MEASURED (round 33, EXPLAIN ANALYZE, the fleet's ten heaviest keys at 360 days): 12–264 ms cold cache, 14–24 ms
-- warm, 361 index loops, plan = Nested Loop → generate_series → Limit 1 → runtime-pruned partition index probe.
-- REJECTED SHAPES, so nobody rewrites this: a ranged `select date … between` returns one row per ENTITY per day
-- (Foam OH campaign|user_geo_city: 1,903,429 rows in 360 days — 1,900× PostgREST's 1,000-row cap, i.e. false holes);
-- `select distinct date` scans every index entry (Bath Fitter 2,994 ms); `exists` per day let the planner choose a
-- scan (Foam OH 13,254 ms). The LATERAL limit-1 form is what forces the per-day probe.
-- THE ROW CAP: at most 900 dates come back (COVERAGE_WINDOW_MAX_DAYS), under PostgREST's default max-rows of 1,000;
-- a wider window is REFUSED with an exception, never silently truncated (a truncated answer is a false hole).
-- plpgsql, not sql: the parameterised query gets a cached generic plan after five calls, so the ~70–90 ms of
-- per-call planning over ~130 monthly partitions is paid once per connection, not once per read.

create or replace function public.universe_coverage_dates(
  p_client uuid,
  p_platform text,
  p_entity_level text,
  p_breakdown_type text,
  p_alias_entity_level text,
  p_alias_breakdown_type text,
  p_start date,
  p_end date
)
returns setof date
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if p_start is null or p_end is null or p_end < p_start then
    raise exception 'universe_coverage_dates: window % .. % is not a range', p_start, p_end;
  end if;
  if (p_end - p_start) + 1 > 900 then
    raise exception 'universe_coverage_dates: window % .. % is % days; at most 900 per call (COVERAGE_WINDOW_MAX_DAYS) — split it, never truncate it',
      p_start, p_end, (p_end - p_start) + 1;
  end if;
  return query
    select d::date
    from generate_series(p_start, p_end, interval '1 day') as d
    cross join lateral (
      select 1
      from (
        select 1
        from public.metrics_daily m
        where m.client_id = p_client
          and m.platform = p_platform
          and m.breakdown_type = p_breakdown_type
          and m.entity_level = p_entity_level
          and m.date = d::date
        limit 1
      ) p
      union all
      select 1
      from (
        select 1
        from public.metrics_daily a
        where p_alias_entity_level is not null
          and a.client_id = p_client
          and a.platform = p_platform
          and a.breakdown_type = p_alias_breakdown_type
          and a.entity_level = p_alias_entity_level
          and a.date = d::date
        limit 1
      ) q
      limit 1
    ) x
    order by 1;
end
$$;

comment on function public.universe_coverage_dates(uuid, text, text, text, text, text, date, date) is
  'LORAMER_FIRE_PLANS_UNTIL_FULL_V1 — the days in [p_start, p_end] that hold at least one metrics_daily row under '
  '(client, platform, entity_level, breakdown_type), else under the drain-alias key. One LATERAL limit-1 index probe '
  'per day inside Postgres; at most 900 days per call; a wider window raises. The per-day probe windowCoverage made '
  'over the network, moved server-side — semantics unchanged.';

-- ⛔ GRANT POSTURE — the four lines, because `revoke … from public` alone leaves Supabase's explicit anon and
-- authenticated EXECUTE grants in place (LORAMER_RPC_GRANT_POSTURE_V1; measured on 064, 2026-08-13).
revoke all on function public.universe_coverage_dates(uuid, text, text, text, text, text, date, date) from public;
revoke all on function public.universe_coverage_dates(uuid, text, text, text, text, text, date, date) from anon;
revoke all on function public.universe_coverage_dates(uuid, text, text, text, text, text, date, date) from authenticated;
grant execute on function public.universe_coverage_dates(uuid, text, text, text, text, text, date, date) to service_role;
