-- LORAMER_COVERAGE_DENSITY_V1 — 069: the distinct captured days inside a window, plus the capture floor.
--
-- ⛔ DISTINCT-DAY EXTRACTION HAPPENS IN POSTGRES, NEVER IN NODE. metrics_daily is partitioned and ~78M rows;
-- paging a year of one client's rows to count distinct dates is how the 8s statement-timeout law gets broken
-- (and how check-lora-named-entity's first cut produced a false green from a swallowed 57014). One indexed
-- scan, two scalars back. Same posture and shape as breakdown_coverage_days (migrations/046).
--
-- Returns present_days (ascending distinct dates in-window) and capture_floor (the earliest captured day for
-- this client+platform at ANY date — the floor test's own input, returned here so the caller needs one read
-- rather than two).
create or replace function public.coverage_density_days(
  p_client_id uuid,
  p_platform  text,
  p_start     date,
  p_end       date
)
returns table (present_days date[], capture_floor date)
language sql
stable
security definer
set search_path = public
as $$
  select
    coalesce((
      select array_agg(distinct d.date order by d.date)
      from public.metrics_daily d
      where d.client_id = p_client_id and d.platform = p_platform
        and d.entity_level = 'account' and d.breakdown_type = '' and d.breakdown_value = ''
        and d.date between p_start and p_end
    ), '{}'::date[]),
    (
      select min(d.date)
      from public.metrics_daily d
      where d.client_id = p_client_id and d.platform = p_platform
        and d.entity_level = 'account' and d.breakdown_type = '' and d.breakdown_value = ''
    );
$$;

comment on function public.coverage_density_days(uuid, text, date, date) is
  'LORAMER_COVERAGE_DENSITY_V1 — distinct captured days in-window + the capture floor, for the density leg '
  'of the coverage verdict. The FLOOR test asks "does capture reach back this far"; this supplies what the '
  'DENSITY test needs to ask "is every day IN the window present".';

-- Grant posture (the 065 lesson): revoke anon/authenticated BY NAME — revoking PUBLIC alone does not remove
-- them, because Supabase grants EXECUTE to those roles as explicit role grants.
revoke all on function public.coverage_density_days(uuid, text, date, date) from public;
revoke all on function public.coverage_density_days(uuid, text, date, date) from anon;
revoke all on function public.coverage_density_days(uuid, text, date, date) from authenticated;
grant execute on function public.coverage_density_days(uuid, text, date, date) to service_role;
