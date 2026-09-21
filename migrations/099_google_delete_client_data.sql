-- LORAMER_GOOGLE_DELETE_MY_DATA_V1 — a customer deletes ALL of one client's Google Ads data, through the database's
-- own functions, and nothing else can ever be touched by those functions.
--
-- ⛔ WHY DEFINER FUNCTIONS AND NOT THE SERVICE ROLE: two ledgers are append-only for every application role —
-- universe_attempt_log (061) and forward_observation_log revoke UPDATE/DELETE from service_role (measured 2026-09-21:
-- has_table_privilege(service_role, …, 'DELETE') = false). A deletion the app cannot perform is a deletion the app
-- cannot own. These functions run as their owner (postgres) and are the ONLY door.
-- ⛔ CONTAINMENT IS IN THE BODIES, NEVER IN A PARAMETER. Every DELETE below carries `client_id = p_client` AND a
-- platform/vendor predicate written as a LITERAL ('google' / 'google_ads'). No dynamic SQL, no table-name parameter,
-- no platform parameter: a caller can name WHICH client, never WHAT ELSE. tests/guards/google-delete-scope.guard.mjs
-- pins every predicate in this file.
-- ⛔ THE 8-SECOND LIMIT IS THE UNIT. PostgREST runs as `authenticator` with statement_timeout = 8 s (ESSENCE law), and
-- every call here must fit under it: metrics are deleted one date range at a time with a row ceiling the caller
-- halves on 'SPLIT:'; the ledgers and the small tables are one call each (measured 2026-09-21 on Tri-Copy, the
-- rolled-back proof in the DECISIONS entry).
-- ⛔ COUNT-THEN-DELETE-THEN-COMPARE, IN ONE TRANSACTION, ABORT ON INEQUALITY — the WIPE-DRAFT's abort rule (round 11,
-- 2026-09-18), as a function. An inequality means a writer landed rows mid-delete; the caller re-runs the range.
-- ⛔ ORDER: the CONNECTION first (every writer enumerates platform_connections, so nothing re-enumerates the client),
-- then ledgers, then metrics, then capture tables, then the walk state with the INCEPTION row LAST — the row whose
-- absence is what starts a re-descent on reconnect.

-- ── THE LOG — logged FIRST, idempotent, resumable, per-table counts, a confirmation code (Meta's shape, generalised) ──
create table if not exists public.platform_compliance_log (
  id                bigserial primary key,
  platform          text        not null,                 -- 'google' here; Meta keeps meta_compliance_log
  kind              text        not null default 'data_deletion',
  client_id         uuid        null,
  user_email        text        null,
  confirmation_code text        not null unique,
  status            text        not null,                 -- processing | partial | complete | no_data
  detail            jsonb       not null default '{}'::jsonb,
  received_at       timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index if not exists platform_compliance_log_client_idx on public.platform_compliance_log (platform, client_id, received_at desc);
alter table public.platform_compliance_log enable row level security;
revoke all on table public.platform_compliance_log from public;
revoke all on table public.platform_compliance_log from anon;
revoke all on table public.platform_compliance_log from authenticated;
grant select, insert, update on table public.platform_compliance_log to service_role;
grant usage, select on sequence public.platform_compliance_log_id_seq to service_role;
comment on table public.platform_compliance_log is
  'LORAMER_GOOGLE_DELETE_MY_DATA_V1 — one row per data-deletion request per (platform, client). Written BEFORE any delete so a crash leaves a trace; detail carries per-table counts and the resume cursor; a complete row answers a repeat request with its original code.';

-- ── BOUNDS AND COUNTS (read-only helpers; the caller sizes its ranges from these) ──
create or replace function public.google_client_metrics_bounds(p_client uuid)
returns table (min_date date, max_date date)
language sql security definer set search_path = public as $$
  select (select date from public.metrics_daily where client_id = p_client and platform = 'google' order by date asc  limit 1),
         (select date from public.metrics_daily where client_id = p_client and platform = 'google' order by date desc limit 1)
$$;

create or replace function public.google_count_client_metrics(p_client uuid, p_lo date, p_hi date)
returns bigint
language sql security definer set search_path = public as $$
  select count(*) from public.metrics_daily
   where client_id = p_client and platform = 'google' and date >= p_lo and date < p_hi
$$;

-- ── METRICS — one date range per call, a row ceiling the caller halves on SPLIT, count = deleted or abort ──
create or replace function public.google_delete_client_metrics(p_client uuid, p_lo date, p_hi date, p_max_rows bigint default 300000)
returns table (expected bigint, deleted bigint)
language plpgsql security definer set search_path = public as $$
declare v_expected bigint; v_deleted bigint;
begin
  select count(*) into v_expected from public.metrics_daily
   where client_id = p_client and platform = 'google' and date >= p_lo and date < p_hi;
  if v_expected > p_max_rows then
    raise exception 'SPLIT:%', v_expected using errcode = 'P0001';
  end if;
  delete from public.metrics_daily
   where client_id = p_client and platform = 'google' and date >= p_lo and date < p_hi;
  get diagnostics v_deleted = row_count;
  if v_deleted <> v_expected then
    raise exception 'MISMATCH: expected % deleted %', v_expected, v_deleted using errcode = 'P0002';
  end if;
  return query select v_expected, v_deleted;
end $$;

-- ── THE CONNECTION — first, so no writer re-enumerates the client ──
create or replace function public.google_delete_client_connection(p_client uuid)
returns bigint
language plpgsql security definer set search_path = public as $$
declare n bigint;
begin
  delete from public.platform_connections where client_id = p_client and platform = 'google';
  get diagnostics n = row_count;
  return n;
end $$;

-- ── THE LEDGERS — append-only for the app; deletable only here ──
create or replace function public.google_delete_client_ledgers(p_client uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare n bigint; out jsonb := '{}'::jsonb;
begin
  delete from public.universe_attempt_log where client_id = p_client and vendor in ('google', 'google_ads');
  get diagnostics n = row_count; out := out || jsonb_build_object('universe_attempt_log', n);
  delete from public.universe_window_log where client_id = p_client and vendor in ('google', 'google_ads');
  get diagnostics n = row_count; out := out || jsonb_build_object('universe_window_log', n);
  delete from public.forward_observation_log where client_id = p_client and vendor in ('google', 'google_ads');
  get diagnostics n = row_count; out := out || jsonb_build_object('forward_observation_log', n);
  -- universe_fire_log carries client_id only (no vendor column): the walk is Google-only, the table is walk-owned.
  delete from public.universe_fire_log where client_id = p_client;
  get diagnostics n = row_count; out := out || jsonb_build_object('universe_fire_log', n);
  return out;
end $$;

-- ── THE CAPTURE TABLES — platform-keyed, one call ──
create or replace function public.google_delete_client_capture(p_client uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare n bigint; out jsonb := '{}'::jsonb;
begin
  delete from public.capture_pass_log where client_id = p_client and platform = 'google';
  get diagnostics n = row_count; out := out || jsonb_build_object('capture_pass_log', n);
  delete from public.entity_state_history where client_id = p_client and platform = 'google';
  get diagnostics n = row_count; out := out || jsonb_build_object('entity_state_history', n);
  delete from public.google_entity_dimension where client_id = p_client and platform = 'google';
  get diagnostics n = row_count; out := out || jsonb_build_object('google_entity_dimension', n);
  delete from public.known_floors where client_id = p_client and platform = 'google';
  get diagnostics n = row_count; out := out || jsonb_build_object('known_floors', n);
  -- sync_state spells the Google lanes three ways (measured 2026-09-21 on Tri-Copy): 'google', 'google_<family>' and
  -- '__<lane>_google[:slice]'. All three, this client only.
  delete from public.sync_state where client_id = p_client
     and (platform = 'google' or platform like 'google\_%' escape '\' or platform like '\_\_%google%' escape '\');
  get diagnostics n = row_count; out := out || jsonb_build_object('sync_state', n);
  -- rollback manifests and snapshots carry client_id + platform; a client's Google rows leave them too.
  delete from public.metrics_daily_hour_respell_manifest_20260826 where client_id = p_client and platform = 'google';
  get diagnostics n = row_count; out := out || jsonb_build_object('metrics_daily_hour_respell_manifest_20260826', n);
  delete from public.metrics_daily_walkdupe_manifest_20260811 where client_id = p_client and platform = 'google';
  get diagnostics n = row_count; out := out || jsonb_build_object('metrics_daily_walkdupe_manifest_20260811', n);
  delete from public.walk_prefixed_snapshot_20260821 where client_id = p_client and platform = 'google';
  get diagnostics n = row_count; out := out || jsonb_build_object('walk_prefixed_snapshot_20260821', n);
  -- store tables carry a platform column too; they never hold 'google' rows, and the guard's class rule lists them.
  delete from public.store_order_line_items where client_id = p_client and platform = 'google';
  get diagnostics n = row_count; out := out || jsonb_build_object('store_order_line_items', n);
  delete from public.store_orders where client_id = p_client and platform = 'google';
  get diagnostics n = row_count; out := out || jsonb_build_object('store_orders', n);
  delete from public.store_bulk_operations where client_id = p_client and platform = 'google';
  get diagnostics n = row_count; out := out || jsonb_build_object('store_bulk_operations', n);
  return out;
end $$;

-- ── THE WALK STATE — children first, the INCEPTION row last ──
create or replace function public.google_delete_client_walk_state(p_client uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare n bigint; out jsonb := '{}'::jsonb;
begin
  delete from public.universe_missed_cursor where client_id = p_client and vendor in ('google', 'google_ads');
  get diagnostics n = row_count; out := out || jsonb_build_object('universe_missed_cursor', n);
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
  return out;
end $$;


-- ── THE RE-COUNT — every listed table, the same predicates, so a run can END with every table read back at 0 ──
create or replace function public.google_count_client_rows(p_client uuid)
returns jsonb
language sql security definer set search_path = public as $$
  select jsonb_build_object(
    'platform_connections', (select count(*) from public.platform_connections where client_id = p_client and platform = 'google'),
    'universe_attempt_log', (select count(*) from public.universe_attempt_log where client_id = p_client and vendor in ('google', 'google_ads')),
    'universe_window_log', (select count(*) from public.universe_window_log where client_id = p_client and vendor in ('google', 'google_ads')),
    'forward_observation_log', (select count(*) from public.forward_observation_log where client_id = p_client and vendor in ('google', 'google_ads')),
    'universe_fire_log', (select count(*) from public.universe_fire_log where client_id = p_client),
    -- metrics_daily is counted through a 100,000-row window so the call stays under 8 s on a client that still holds
    -- millions of rows (measured 2026-09-21: an uncapped count timed out at 8.19 s on Tri-Copy's 3.06 M): exact below
    -- 100,000, reads 100000 above it, and 0 is exactly 0 — which is the only value the run's end needs.
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
    'universe_run_notice', (select count(*) from public.universe_run_notice where client_id = p_client and vendor in ('google', 'google_ads')),
    'universe_run_state', (select count(*) from public.universe_run_state where client_id = p_client and vendor in ('google', 'google_ads')),
    'universe_run', (select count(*) from public.universe_run where client_id = p_client and vendor in ('google', 'google_ads')),
    'universe_fire_lease', (select count(*) from public.universe_fire_lease where client_id = p_client and vendor in ('google', 'google_ads')),
    'universe_lane_hold', (select count(*) from public.universe_lane_hold where client_id = p_client and vendor in ('google', 'google_ads')),
    'universe_account_floor', (select count(*) from public.universe_account_floor where client_id = p_client and vendor in ('google', 'google_ads')),
    'universe_account_inception', (select count(*) from public.universe_account_inception where client_id = p_client and vendor in ('google', 'google_ads'))
  )
$$;

-- ── GRANT POSTURE (LORAMER_RPC_GRANT_POSTURE_V1): revoke by name, then service_role only ──
revoke all on function public.google_client_metrics_bounds(uuid) from public;
revoke all on function public.google_client_metrics_bounds(uuid) from anon;
revoke all on function public.google_client_metrics_bounds(uuid) from authenticated;
revoke all on function public.google_count_client_metrics(uuid, date, date) from public;
revoke all on function public.google_count_client_metrics(uuid, date, date) from anon;
revoke all on function public.google_count_client_metrics(uuid, date, date) from authenticated;
revoke all on function public.google_delete_client_metrics(uuid, date, date, bigint) from public;
revoke all on function public.google_delete_client_metrics(uuid, date, date, bigint) from anon;
revoke all on function public.google_delete_client_metrics(uuid, date, date, bigint) from authenticated;
revoke all on function public.google_delete_client_connection(uuid) from public;
revoke all on function public.google_delete_client_connection(uuid) from anon;
revoke all on function public.google_delete_client_connection(uuid) from authenticated;
revoke all on function public.google_delete_client_ledgers(uuid) from public;
revoke all on function public.google_delete_client_ledgers(uuid) from anon;
revoke all on function public.google_delete_client_ledgers(uuid) from authenticated;
revoke all on function public.google_delete_client_capture(uuid) from public;
revoke all on function public.google_delete_client_capture(uuid) from anon;
revoke all on function public.google_delete_client_capture(uuid) from authenticated;
revoke all on function public.google_delete_client_walk_state(uuid) from public;
revoke all on function public.google_delete_client_walk_state(uuid) from anon;
revoke all on function public.google_delete_client_walk_state(uuid) from authenticated;
revoke all on function public.google_count_client_rows(uuid) from public;
revoke all on function public.google_count_client_rows(uuid) from anon;
revoke all on function public.google_count_client_rows(uuid) from authenticated;
grant execute on function public.google_client_metrics_bounds(uuid) to service_role;
grant execute on function public.google_count_client_metrics(uuid, date, date) to service_role;
grant execute on function public.google_delete_client_metrics(uuid, date, date, bigint) to service_role;
grant execute on function public.google_delete_client_connection(uuid) to service_role;
grant execute on function public.google_delete_client_ledgers(uuid) to service_role;
grant execute on function public.google_delete_client_capture(uuid) to service_role;
grant execute on function public.google_delete_client_walk_state(uuid) to service_role;
grant execute on function public.google_count_client_rows(uuid) to service_role;
