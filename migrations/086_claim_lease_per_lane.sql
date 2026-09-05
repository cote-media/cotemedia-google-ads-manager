-- 086_claim_lease_per_lane.sql
-- LORAMER_FORWARD_LANE_HYGIENE_V1 — the claim lease becomes a PARAMETER of claim_backfill_cursor, so each lane
-- can size it from its OWN maxDuration. The 480 s literal (migration 021) was sized for a ~340 s Woo lap and never
-- re-derived for google forward, whose heaviest pass measured 644-662 s on 2026-09-05: the lease went stale
-- mid-pass and the next 10-minute fire re-claimed the same client (Escential c39ee088, processed by the 08:38Z,
-- 08:58Z and 09:08Z fires; 3,751 rows first-written by the 08:58Z fire AFTER the 09:08Z claim).
--
-- WHY A DERIVED LEASE IS ENOUGH: a Vercel invocation is terminated at maxDuration, so a holder's hold from its
-- claim is ≤ maxDuration. A lease of maxDuration + margin cannot lapse under a live holder. The forward route
-- passes maxDuration + 100 (cron/sync/route.ts, FORWARD_CLAIM_LEASE_S, guarded by
-- tests/guards/forward-claim-lease-covers-max-duration.guard.mjs).
--
-- ⛔ THE 3-ARG SIGNATURE IS DROPPED, NOT KEPT BESIDE THE NEW ONE. PostgREST resolves an RPC by the set of named
-- arguments the caller sends; with BOTH a 3-arg function and a 4-arg function whose fourth has a default, a
-- 3-arg call matches both and PostgREST refuses ("could not choose the best candidate function"). Migration 084
-- did the same for universe_attempt_open (its 11-arg callers resolve against the 12-arg signature via the
-- default). The 3-arg callers — cron/drain, cron/catchup, woocommerce-backfill, woo-cohort-backfill — send no
-- p_lease_seconds and therefore get the 480 s default: BYTE-IDENTICAL BEHAVIOUR to 021 for them.
--
-- The CAS body is the live function's body as read from pg_get_functiondef on 2026-09-05 (021 as applied), with
-- ONE change: `interval '480 seconds'` → `make_interval(secs => p_lease_seconds)`. Same return table, same
-- single-owner logic, same primary-fresh RETURNING.
--
-- REVERT (exact, in this order — the drop first, or the re-created 3-arg overload is ambiguous to PostgREST):
--   drop function if exists public.claim_backfill_cursor(uuid, text, text, integer);
--   then re-run migrations/021_backfill_lease_480.sql (create or replace of the 3-arg signature).
--
-- Run manually in the Supabase SQL Editor (or via the gated migration path). bump_backfill_block is untouched.

drop function if exists public.claim_backfill_cursor(uuid, text, text);

create function public.claim_backfill_cursor(p_client_id uuid, p_platform text, p_token text, p_lease_seconds integer default 480)
returns table(
  claimed boolean,
  blocked boolean,
  block_fails integer,
  earliest date,
  complete boolean,
  block_window text,
  block_reason text
)
language plpgsql
as $function$
declare r record;
begin
  -- Atomic CAS claim (014/021 semantics, unchanged): on a fresh row the INSERT path fires; on an existing row the
  -- claim is granted only if unclaimed or stale — stale now meaning older than the CALLER'S lease, not 480 s.
  insert into public.sync_state (client_id, platform, backfill_claim_token, backfill_claimed_at, updated_at)
  values (p_client_id, p_platform, p_token, now(), now())
  on conflict (client_id, platform) do update
    set backfill_claim_token = p_token, backfill_claimed_at = now(), updated_at = now()
    where public.sync_state.backfill_claimed_at is null
       or public.sync_state.backfill_claimed_at < now() - make_interval(secs => p_lease_seconds)
  returning
    backfill_blocked, backfill_block_fails, backfill_earliest_date,
    backfill_complete, backfill_block_window, backfill_block_reason
  into r;

  if found then
    return query select
      true,
      coalesce(r.backfill_blocked, false),
      coalesce(r.backfill_block_fails, 0),
      r.backfill_earliest_date,
      coalesce(r.backfill_complete, false),
      r.backfill_block_window,
      r.backfill_block_reason;
  else
    select s.backfill_blocked, s.backfill_block_fails, s.backfill_earliest_date,
           s.backfill_complete, s.backfill_block_window, s.backfill_block_reason
      into r
      from public.sync_state s
      where s.client_id = p_client_id and s.platform = p_platform;
    return query select
      false,
      coalesce(r.backfill_blocked, false),
      coalesce(r.backfill_block_fails, 0),
      r.backfill_earliest_date,
      coalesce(r.backfill_complete, false),
      r.backfill_block_window,
      r.backfill_block_reason;
  end if;
end;
$function$;

-- LORAMER_RPC_GRANT_POSTURE_V1 — a DROP + CREATE resets the function's ACL to Supabase's default (EXECUTE for
-- PUBLIC, anon and authenticated as EXPLICIT grants). Lock it the way 065 locked its siblings: only service_role
-- (the capture lanes' supabaseAdmin) may call the claim. `revoke … from public` alone leaves anon/authenticated.
revoke all on function public.claim_backfill_cursor(uuid, text, text, integer) from public;
revoke all on function public.claim_backfill_cursor(uuid, text, text, integer) from anon;
revoke all on function public.claim_backfill_cursor(uuid, text, text, integer) from authenticated;
grant execute on function public.claim_backfill_cursor(uuid, text, text, integer) to service_role;

-- Read back from the catalog: exactly ONE claim_backfill_cursor, and it is the 4-arg one.
do $$
declare n integer; sig text;
begin
  select count(*) into n from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public' and p.proname = 'claim_backfill_cursor';
  if n <> 1 then
    raise exception 'ASSERT FAILED: % claim_backfill_cursor overload(s), expected exactly 1 — a second overload makes every 3-arg PostgREST call ambiguous', n;
  end if;
  select pg_get_function_identity_arguments(p.oid) into sig from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public' and p.proname = 'claim_backfill_cursor';
  if sig not like '%p_lease_seconds integer%' then
    raise exception 'ASSERT FAILED: claim_backfill_cursor signature is (%) — p_lease_seconds is missing', sig;
  end if;
end $$;
