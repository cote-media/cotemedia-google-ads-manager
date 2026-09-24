-- LORAMER_IMPLICIT_PRESENCE_REASK_V1 (2026-09-24, round 50) — THE DELETION FOLLOWS THE SCHEMA: universe_reask_queue (105) is
-- client + vendor scoped, so a customer's Google delete-my-data must take its queued re-asks with it, and the run's end must
-- re-count it at 0. Found by check:data's google-delete-tables leg on the round-50 tree ("the database says it is client+platform
-- scoped and the deletion does not list it (a customer's rows would be left behind)"). The two functions below are the 100
-- definitions plus one table each; the walk-state function still ends on universe_account_inception (the floor goes last).
create or replace function public.google_delete_client_walk_state(p_client uuid, p_code text default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare n bigint; out jsonb := '{}'::jsonb;
begin
  delete from public.universe_missed_cursor where client_id = p_client and vendor in ('google', 'google_ads');
  get diagnostics n = row_count; out := out || jsonb_build_object('universe_missed_cursor', n);
  delete from public.universe_reask_queue where client_id = p_client and vendor in ('google', 'google_ads');
  get diagnostics n = row_count; out := out || jsonb_build_object('universe_reask_queue', n);
  delete from public.universe_run_notice where client_id = p_client and vendor in ('google', 'google_ads');
  get diagnostics n = row_count; out := out || jsonb_build_object('universe_run_notice', n);
  delete from public.universe_run_state where client_id = p_client and vendor in ('google', 'google_ads');
  get diagnostics n = row_count; out := out || jsonb_build_object('universe_run_state', n);
  delete from public.universe_run where client_id = p_client and vendor in ('google', 'google_ads');
  get diagnostics n = row_count; out := out || jsonb_build_object('universe_run', n);
  delete from public.universe_fire_lease where client_id = p_client and vendor in ('google', 'google_ads');
  get diagnostics n = row_count; out := out || jsonb_build_object('universe_fire_lease', n);
  delete from public.universe_lane_hold where client_id = p_client and vendor in ('google', 'google_ads');
  get diagnostics n = row_count; out := out || jsonb_build_object('universe_lane_hold', n);
  delete from public.universe_account_floor where client_id = p_client and vendor in ('google', 'google_ads');
  get diagnostics n = row_count; out := out || jsonb_build_object('universe_account_floor', n);
  delete from public.universe_account_inception where client_id = p_client and vendor in ('google', 'google_ads');
  get diagnostics n = row_count; out := out || jsonb_build_object('universe_account_inception', n);
  if p_code is not null then perform public.google_delete_log_merge(p_code, out, 'walk_state'); end if;
  return out;
end $$;

create or replace function public.google_count_client_rows(p_client uuid)
returns jsonb
language sql security definer set search_path = public as $$
  select jsonb_build_object(
    'platform_connections', (select count(*) from public.platform_connections where client_id = p_client and platform = 'google'),
    'universe_attempt_log', (select count(*) from public.universe_attempt_log where client_id = p_client and vendor in ('google', 'google_ads')),
    'universe_window_log', (select count(*) from public.universe_window_log where client_id = p_client and vendor in ('google', 'google_ads')),
    'forward_observation_log', (select count(*) from public.forward_observation_log where client_id = p_client and vendor in ('google', 'google_ads')),
    'universe_fire_log', (select count(*) from public.universe_fire_log where client_id = p_client),
    'metrics_daily', (select count(*) from (select 1 from public.metrics_daily where client_id = p_client and platform = 'google' limit 100000) w),
    'capture_pass_log', (select count(*) from public.capture_pass_log where client_id = p_client and platform = 'google'),
    'entity_state_history', (select count(*) from public.entity_state_history where client_id = p_client and platform = 'google'),
    'google_entity_dimension', (select count(*) from public.google_entity_dimension where client_id = p_client and platform = 'google'),
    'known_floors', (select count(*) from public.known_floors where client_id = p_client and platform = 'google'),
    'sync_state', (select count(*) from public.sync_state where client_id = p_client and (platform = 'google' or platform like 'google\_%' escape '\' or platform like '\_\_%google%' escape '\')),
    'metrics_daily_hour_respell_manifest_20260826', (select count(*) from public.metrics_daily_hour_respell_manifest_20260826 where client_id = p_client and platform = 'google'),
    'metrics_daily_walkdupe_manifest_20260811', (select count(*) from public.metrics_daily_walkdupe_manifest_20260811 where client_id = p_client and platform = 'google'),
    'walk_prefixed_snapshot_20260821', (select count(*) from public.walk_prefixed_snapshot_20260821 where client_id = p_client and platform = 'google'),
    'store_order_line_items', (select count(*) from public.store_order_line_items where client_id = p_client and platform = 'google'),
    'store_orders', (select count(*) from public.store_orders where client_id = p_client and platform = 'google'),
    'store_bulk_operations', (select count(*) from public.store_bulk_operations where client_id = p_client and platform = 'google'),
    'universe_missed_cursor', (select count(*) from public.universe_missed_cursor where client_id = p_client and vendor in ('google', 'google_ads')),
    'universe_reask_queue', (select count(*) from public.universe_reask_queue where client_id = p_client and vendor in ('google', 'google_ads')),
    'universe_run_notice', (select count(*) from public.universe_run_notice where client_id = p_client and vendor in ('google', 'google_ads')),
    'universe_run_state', (select count(*) from public.universe_run_state where client_id = p_client and vendor in ('google', 'google_ads')),
    'universe_run', (select count(*) from public.universe_run where client_id = p_client and vendor in ('google', 'google_ads')),
    'universe_fire_lease', (select count(*) from public.universe_fire_lease where client_id = p_client and vendor in ('google', 'google_ads')),
    'universe_lane_hold', (select count(*) from public.universe_lane_hold where client_id = p_client and vendor in ('google', 'google_ads')),
    'universe_account_floor', (select count(*) from public.universe_account_floor where client_id = p_client and vendor in ('google', 'google_ads')),
    'universe_account_inception', (select count(*) from public.universe_account_inception where client_id = p_client and vendor in ('google', 'google_ads'))
  )
$$;

-- GRANT POSTURE (LORAMER_RPC_GRANT_POSTURE_V1), restated for the two re-created functions
revoke all on function public.google_delete_client_walk_state(uuid, text) from public;
revoke all on function public.google_delete_client_walk_state(uuid, text) from anon;
revoke all on function public.google_delete_client_walk_state(uuid, text) from authenticated;
grant execute on function public.google_delete_client_walk_state(uuid, text) to service_role;
revoke all on function public.google_count_client_rows(uuid) from public;
revoke all on function public.google_count_client_rows(uuid) from anon;
revoke all on function public.google_count_client_rows(uuid) from authenticated;
grant execute on function public.google_count_client_rows(uuid) to service_role;
