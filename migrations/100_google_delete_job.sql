-- LORAMER_GOOGLE_DELETE_JOB_V1 — THE DELETION IS A JOB ON THE LOG ROW: claimed, stepped, counted and finished BY THE DATABASE.
--
-- ⛔ WHY (round 6, 2026-09-21): the first Tri-Copy press ran 82 s; the phone's browser gave up at ~60 s, re-sent the
-- POST, and two runs overlapped. Each run held `detail` in memory and wrote it back whole, so the log recorded
-- 2,751,248 metrics rows deleted where the before-snapshot held 3,058,401. The rows were gone; the record was wrong.
-- Three rules follow, all enforced here rather than in the app:
--   (1) THE ROW IS THE LOCK — google_delete_claim is a compare-and-set on (claimed_by, claimed_at) with a reserve
--       window, the fire lease's shape (085). A second press, a re-send or a second tab finds the claim live and is
--       told "in progress"; it never runs a step.
--   (2) COUNTS ARE WRITTEN BY THE DATABASE, PER STEP, IN THE DELETING TRANSACTION — every delete function takes the
--       job code and merges its own counts into the row with jsonb arithmetic (google_delete_log_merge). Nothing in
--       the app ever adds two counts together or writes `detail` whole.
--   (3) A RUN THAT ENDS MID-JOB LEAVES A RESUMABLE ROW — steps done and months done live on the row; a claim whose
--       holder died expires with the reserve; the pump (cron, every minute) picks the row up where it stopped.
-- Containment is unchanged from 099: every DELETE pins client_id = p_client and a platform/vendor literal.

alter table public.platform_compliance_log
  add column if not exists claimed_by   text        null,
  add column if not exists claimed_at   timestamptz null;
create index if not exists platform_compliance_log_live_idx on public.platform_compliance_log (platform, status, claimed_at);

-- ── OPEN: one live job per (platform, client). Returns the row that stands for the request. ──
create or replace function public.google_delete_open(p_client uuid, p_email text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare r public.platform_compliance_log%rowtype; v_code text;
begin
  select * into r from public.platform_compliance_log
   where platform = 'google' and kind = 'data_deletion' and client_id = p_client
   order by received_at desc limit 1;
  if found and r.status in ('processing', 'partial', 'complete') then
    return to_jsonb(r);
  end if;
  v_code := gen_random_uuid()::text;
  insert into public.platform_compliance_log (platform, kind, client_id, user_email, confirmation_code, status, detail)
  values ('google', 'data_deletion', p_client, p_email, v_code, 'processing',
          jsonb_build_object('steps', '[]'::jsonb, 'counts', '{}'::jsonb, 'metrics', jsonb_build_object('months_done', '[]'::jsonb, 'calls', 0, 'splits', 0), 'errors', '[]'::jsonb, 'presses', 0))
  returning * into r;
  return to_jsonb(r);
end $$;

-- ── CLAIM: compare-and-set on the row; true = this holder owns the job for p_reserve_s ──
create or replace function public.google_delete_claim(p_code text, p_holder text, p_reserve_s integer)
returns boolean
language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  update public.platform_compliance_log
     set claimed_by = p_holder, claimed_at = now(), status = 'processing', updated_at = now(),
         detail = jsonb_set(detail, '{presses}', to_jsonb(coalesce((detail->>'presses')::int, 0) + 1))
   where confirmation_code = p_code and platform = 'google'
     and status in ('processing', 'partial')
     and (claimed_by is null or claimed_at is null or claimed_at < now() - make_interval(secs => p_reserve_s));
  get diagnostics n = row_count;
  return n = 1;
end $$;

-- ── MERGE: the ONLY writer of counts and cursors. Numeric add per key; step and month appended once. ──
create or replace function public.google_delete_log_merge(p_code text, p_counts jsonb, p_step text default null, p_month text default null)
returns void
language plpgsql security definer set search_path = public as $$
declare k text; v numeric; cur jsonb;
begin
  select detail into cur from public.platform_compliance_log where confirmation_code = p_code and platform = 'google' for update;
  if cur is null then raise exception 'no google deletion log row for %', p_code; end if;
  if p_counts is not null then
    for k, v in select key, value::numeric from jsonb_each_text(p_counts) loop
      cur := jsonb_set(cur, array['counts', k], to_jsonb(coalesce((cur->'counts'->>k)::numeric, 0) + v), true);
    end loop;
  end if;
  if p_step is not null and not (cur->'steps') ? p_step then
    cur := jsonb_set(cur, '{steps}', (cur->'steps') || to_jsonb(p_step), true);
  end if;
  if p_month is not null and not (cur->'metrics'->'months_done') ? p_month then
    cur := jsonb_set(cur, '{metrics,months_done}', (cur->'metrics'->'months_done') || to_jsonb(p_month), true);
  end if;
  update public.platform_compliance_log set detail = cur, updated_at = now(), claimed_at = now()
   where confirmation_code = p_code and platform = 'google';
end $$;

-- ── FINISH / RELEASE: end the claim; complete only when the caller has re-counted to zero ──
create or replace function public.google_delete_finish(p_code text, p_holder text, p_status text, p_counts_after jsonb default null, p_error text default null)
returns void
language plpgsql security definer set search_path = public as $$
declare cur jsonb;
begin
  select detail into cur from public.platform_compliance_log where confirmation_code = p_code and platform = 'google' for update;
  if cur is null then raise exception 'no google deletion log row for %', p_code; end if;
  if p_counts_after is not null then cur := jsonb_set(cur, '{counts_after}', p_counts_after, true); end if;
  if p_error is not null then cur := jsonb_set(cur, '{errors}', coalesce(cur->'errors', '[]'::jsonb) || to_jsonb(p_error), true); end if;
  if p_status = 'complete' then cur := jsonb_set(cur, '{completed_at}', to_jsonb(now()), true); end if;
  update public.platform_compliance_log
     set detail = cur, status = p_status, claimed_by = null, claimed_at = null, updated_at = now()
   where confirmation_code = p_code and platform = 'google' and (claimed_by = p_holder or claimed_by is null);
end $$;

-- ── CORRECT: a stamped correction, never a silent overwrite (Tri-Copy's row, round 6) ──
create or replace function public.google_delete_correct(p_code text, p_path text[], p_to jsonb, p_source text, p_reason text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare cur jsonb; prev jsonb;
begin
  select detail into cur from public.platform_compliance_log where confirmation_code = p_code and platform = 'google' for update;
  if cur is null then raise exception 'no google deletion log row for %', p_code; end if;
  prev := cur #> p_path;
  cur := jsonb_set(cur, p_path, p_to, true);
  cur := jsonb_set(cur, '{corrections}', coalesce(cur->'corrections', '[]'::jsonb) ||
           jsonb_build_object('at', now(), 'path', array_to_string(p_path, '.'), 'from', prev, 'to', p_to, 'source', p_source, 'reason', p_reason), true);
  update public.platform_compliance_log set detail = cur, updated_at = now() where confirmation_code = p_code and platform = 'google';
  return cur;
end $$;


-- ── REARM: after a non-zero re-count, drop the delete steps from the row so the next holder re-runs them (idempotent) ──
create or replace function public.google_delete_rearm(p_code text, p_holder text)
returns void
language plpgsql security definer set search_path = public as $$
declare cur jsonb;
begin
  select detail into cur from public.platform_compliance_log where confirmation_code = p_code and platform = 'google' for update;
  if cur is null then raise exception 'no google deletion log row for %', p_code; end if;
  cur := jsonb_set(cur, '{steps}', coalesce((select jsonb_agg(s) from jsonb_array_elements(cur->'steps') s where s #>> '{}' not in ('ledgers', 'metrics', 'capture', 'walk_state', 'resweep')), '[]'::jsonb), true);
  cur := jsonb_set(cur, '{metrics,months_done}', '[]'::jsonb, true);
  update public.platform_compliance_log set detail = cur, updated_at = now() where confirmation_code = p_code and platform = 'google';
end $$;

-- ── STATUS: what the page shows, whenever it is opened ──
create or replace function public.google_delete_status(p_client uuid, p_reserve_s integer default 320)
returns jsonb
language sql security definer set search_path = public as $$
  select case when r.id is null then null else
    to_jsonb(r) || jsonb_build_object('live', r.claimed_by is not null and r.claimed_at is not null and r.claimed_at > now() - make_interval(secs => p_reserve_s))
  end
  from (select * from public.platform_compliance_log where platform = 'google' and kind = 'data_deletion' and client_id = p_client order by received_at desc limit 1) r
$$;

-- ── THE DELETE FUNCTIONS, NOW TAKING THE JOB CODE: counts are merged in the same transaction as the delete ──
drop function if exists public.google_delete_client_metrics(uuid, date, date, bigint);
create or replace function public.google_delete_client_metrics(p_client uuid, p_lo date, p_hi date, p_max_rows bigint default 300000, p_code text default null)
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
  if p_code is not null then perform public.google_delete_log_merge(p_code, jsonb_build_object('metrics_daily', v_deleted)); end if;
  return query select v_expected, v_deleted;
end $$;

drop function if exists public.google_delete_client_connection(uuid);
create or replace function public.google_delete_client_connection(p_client uuid, p_code text default null)
returns bigint
language plpgsql security definer set search_path = public as $$
declare n bigint;
begin
  delete from public.platform_connections where client_id = p_client and platform = 'google';
  get diagnostics n = row_count;
  if p_code is not null then perform public.google_delete_log_merge(p_code, jsonb_build_object('platform_connections', n), 'connection'); end if;
  return n;
end $$;

drop function if exists public.google_delete_client_ledgers(uuid);
create or replace function public.google_delete_client_ledgers(p_client uuid, p_code text default null)
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
  delete from public.universe_fire_log where client_id = p_client;
  get diagnostics n = row_count; out := out || jsonb_build_object('universe_fire_log', n);
  if p_code is not null then perform public.google_delete_log_merge(p_code, out, 'ledgers'); end if;
  return out;
end $$;

drop function if exists public.google_delete_client_capture(uuid);
create or replace function public.google_delete_client_capture(p_client uuid, p_code text default null)
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
  delete from public.sync_state where client_id = p_client
     and (platform = 'google' or platform like 'google\_%' escape '\' or platform like '\_\_%google%' escape '\');
  get diagnostics n = row_count; out := out || jsonb_build_object('sync_state', n);
  delete from public.metrics_daily_hour_respell_manifest_20260826 where client_id = p_client and platform = 'google';
  get diagnostics n = row_count; out := out || jsonb_build_object('metrics_daily_hour_respell_manifest_20260826', n);
  delete from public.metrics_daily_walkdupe_manifest_20260811 where client_id = p_client and platform = 'google';
  get diagnostics n = row_count; out := out || jsonb_build_object('metrics_daily_walkdupe_manifest_20260811', n);
  delete from public.walk_prefixed_snapshot_20260821 where client_id = p_client and platform = 'google';
  get diagnostics n = row_count; out := out || jsonb_build_object('walk_prefixed_snapshot_20260821', n);
  delete from public.store_order_line_items where client_id = p_client and platform = 'google';
  get diagnostics n = row_count; out := out || jsonb_build_object('store_order_line_items', n);
  delete from public.store_orders where client_id = p_client and platform = 'google';
  get diagnostics n = row_count; out := out || jsonb_build_object('store_orders', n);
  delete from public.store_bulk_operations where client_id = p_client and platform = 'google';
  get diagnostics n = row_count; out := out || jsonb_build_object('store_bulk_operations', n);
  if p_code is not null then perform public.google_delete_log_merge(p_code, out, 'capture'); end if;
  return out;
end $$;

drop function if exists public.google_delete_client_walk_state(uuid);
create or replace function public.google_delete_client_walk_state(p_client uuid, p_code text default null)
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
  if p_code is not null then perform public.google_delete_log_merge(p_code, out, 'walk_state'); end if;
  return out;
end $$;

-- ── GRANT POSTURE (LORAMER_RPC_GRANT_POSTURE_V1) ──
revoke all on function public.google_delete_open(uuid, text) from public;
revoke all on function public.google_delete_open(uuid, text) from anon;
revoke all on function public.google_delete_open(uuid, text) from authenticated;
revoke all on function public.google_delete_claim(text, text, integer) from public;
revoke all on function public.google_delete_claim(text, text, integer) from anon;
revoke all on function public.google_delete_claim(text, text, integer) from authenticated;
revoke all on function public.google_delete_log_merge(text, jsonb, text, text) from public;
revoke all on function public.google_delete_log_merge(text, jsonb, text, text) from anon;
revoke all on function public.google_delete_log_merge(text, jsonb, text, text) from authenticated;
revoke all on function public.google_delete_finish(text, text, text, jsonb, text) from public;
revoke all on function public.google_delete_finish(text, text, text, jsonb, text) from anon;
revoke all on function public.google_delete_finish(text, text, text, jsonb, text) from authenticated;
revoke all on function public.google_delete_correct(text, text[], jsonb, text, text) from public;
revoke all on function public.google_delete_correct(text, text[], jsonb, text, text) from anon;
revoke all on function public.google_delete_correct(text, text[], jsonb, text, text) from authenticated;
revoke all on function public.google_delete_rearm(text, text) from public;
revoke all on function public.google_delete_rearm(text, text) from anon;
revoke all on function public.google_delete_rearm(text, text) from authenticated;
revoke all on function public.google_delete_status(uuid, integer) from public;
revoke all on function public.google_delete_status(uuid, integer) from anon;
revoke all on function public.google_delete_status(uuid, integer) from authenticated;
revoke all on function public.google_delete_client_metrics(uuid, date, date, bigint, text) from public;
revoke all on function public.google_delete_client_metrics(uuid, date, date, bigint, text) from anon;
revoke all on function public.google_delete_client_metrics(uuid, date, date, bigint, text) from authenticated;
revoke all on function public.google_delete_client_connection(uuid, text) from public;
revoke all on function public.google_delete_client_connection(uuid, text) from anon;
revoke all on function public.google_delete_client_connection(uuid, text) from authenticated;
revoke all on function public.google_delete_client_ledgers(uuid, text) from public;
revoke all on function public.google_delete_client_ledgers(uuid, text) from anon;
revoke all on function public.google_delete_client_ledgers(uuid, text) from authenticated;
revoke all on function public.google_delete_client_capture(uuid, text) from public;
revoke all on function public.google_delete_client_capture(uuid, text) from anon;
revoke all on function public.google_delete_client_capture(uuid, text) from authenticated;
revoke all on function public.google_delete_client_walk_state(uuid, text) from public;
revoke all on function public.google_delete_client_walk_state(uuid, text) from anon;
revoke all on function public.google_delete_client_walk_state(uuid, text) from authenticated;
grant execute on function public.google_delete_open(uuid, text) to service_role;
grant execute on function public.google_delete_claim(text, text, integer) to service_role;
grant execute on function public.google_delete_log_merge(text, jsonb, text, text) to service_role;
grant execute on function public.google_delete_finish(text, text, text, jsonb, text) to service_role;
grant execute on function public.google_delete_correct(text, text[], jsonb, text, text) to service_role;
grant execute on function public.google_delete_rearm(text, text) to service_role;
grant execute on function public.google_delete_status(uuid, integer) to service_role;
grant execute on function public.google_delete_client_metrics(uuid, date, date, bigint, text) to service_role;
grant execute on function public.google_delete_client_connection(uuid, text) to service_role;
grant execute on function public.google_delete_client_ledgers(uuid, text) to service_role;
grant execute on function public.google_delete_client_capture(uuid, text) to service_role;
grant execute on function public.google_delete_client_walk_state(uuid, text) to service_role;
