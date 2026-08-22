-- 085_universe_fire_lease.sql — LORAMER_INLINE_FIRE_LEASE_V1 (C1 of the queue-removal flight).
--
-- ⛔ WHY A LEASE, AND WHY A ROW RATHER THAN AN ADVISORY LOCK. The inline walk's fire may outrun its
-- 5-minute interval, and the vendor documents all three overlap sources this table exists to exclude
-- (vercel.com/docs/cron-jobs/manage-cron-jobs, read 2026-08-22):
--   "If your cron job runs longer than the interval between invocations, Vercel can trigger a second
--    instance while the first is still running." · "Cron delivery can also occasionally invoke the same
--    scheduled run more than once." · "Creating a new deployment will not interrupt your running cron
--    jobs; they will continue until they finish."  (plus the fourth, ours: an operator drive vs the cron.)
-- Postgres session advisory locks are STRUCTURALLY UNAVAILABLE here: the app speaks PostgREST (no
-- session), and the pooler (aws-1-us-west-2.pooler.supabase.com) is the PgBouncer-class environment where
-- "the pg_advisory_unlock call in your finally block might run on a different backend... and it just does
-- nothing." A lease ROW with a TTL, granted by compare-and-set IN DB TIME, is the remaining answer — the
-- byte-pattern of migrations/021's claim-lease ("granted only if unclaimed or stale").
--
-- ⛔ ONE ROW PER (client, vendor) LANE — the fire's existing scope (universe-resume requires ?clientId=,
-- rotation RPC is per (client, vendor)). A global lease would serialize the future fleet; a per-lane
-- lease is exactly one fire per lane, which is the required concurrency (DECISIONS
-- LORAMER_QUEUE_CONCURRENCY_ABOVE_THE_BURST_V1: required concurrency is 1).
--
-- ⛔ TTL = 330s, DERIVED NOT CHOSEN: a holder cannot live past the platform kill at
-- CONSUMER_MAX_DURATION_S (300s — the code's constant, universe-v2-contract.ts, not restated as a live
-- value here) + 30s NAMED GRACE for the acquisition write landing after process start (argued ≪ 30s, not
-- measured). The INVARIANT the interval guard will pin in C2: LEASE_TTL_S > CONSUMER_MAX_DURATION_S —
-- a ceiling raise without a TTL raise must FAIL THE BUILD, never silently invert the lease.
-- ⛔ ALL LEASE ARITHMETIC IS IN DB TIME (now() inside the statement). Function clocks never touch it.
--
-- ⛔ THIS MIGRATION TOUCHES NOTHING THAT EXISTS. New table only — no constraint, no RPC, no existing
-- table. It is invisible to the running walk mid-deploy (contrast 083, whose RPC change needed a
-- DEFAULT-parameter disarm). Applied BEFORE the code that reads it ships (C2), never after.
--
-- APPLY: Supabase MCP / SQL Editor. This file is the record; applying it is the live moment.

create table if not exists public.universe_fire_lease (
  client_id             uuid        not null,
  vendor                text        not null,
  holder_invocation_id  text        null,
  acquired_at           timestamptz null,
  primary key (client_id, vendor)
);

-- RLS ON, ZERO POLICIES = deny-all except service_role. Same posture as universe_window_log (054:74)
-- and universe_run_state. The only writer is the server's service-role client.
alter table public.universe_fire_lease enable row level security;

-- ── THE CAS, AS SQL FUNCTIONS — AND WHY THE MIGRATION OWNS THEM RATHER THAN THE MODULE ──────────────
-- PostgREST filters compare columns to LITERALS: `acquired_at < now() - interval '330 seconds'` is not
-- expressible through supabase-js, and shipping the cutoff computed on the FUNCTION's clock would put
-- the one thing this design forbids (non-DB time) into the one statement that must not have it. The
-- house pattern for exactly this is a SQL function called by RPC — migrations/014/021
-- (claim_backfill_cursor: "granted only if unclaimed or stale") and 057 (lane-spend RPC).
--
-- ⛔ THE TTL LIVES HERE AS A DEFAULT PARAMETER (330) so the TS module passes ITS declared constant on
-- every call — the DB default is a fallback, the code's constant is the value of record, and the C2
-- interval guard pins the TS constant's relationship to the ceiling.

create or replace function public.universe_fire_lease_acquire(
  p_client_id uuid,
  p_vendor    text,
  p_holder    text,
  p_ttl_s     integer default 330
) returns table (won boolean, holder_invocation_id text, held_since timestamptz)
language sql
security definer
set search_path = public
as $$
  with attempt as (
    insert into public.universe_fire_lease as l (client_id, vendor, holder_invocation_id, acquired_at)
    values (p_client_id, p_vendor, p_holder, now())
    on conflict (client_id, vendor) do update
      set holder_invocation_id = excluded.holder_invocation_id,
          acquired_at          = excluded.acquired_at
      -- granted only if unclaimed or stale — 021's semantics, TTL parameterised
      where l.holder_invocation_id is null
         or l.acquired_at < now() - make_interval(secs => p_ttl_s)
    returning true as won, l.holder_invocation_id, l.acquired_at
  )
  select won, holder_invocation_id, acquired_at from attempt
  union all
  -- the loser's read: who actually holds it (runs only when the CTE returned no row)
  select false, l.holder_invocation_id, l.acquired_at
  from public.universe_fire_lease l
  where l.client_id = p_client_id and l.vendor = p_vendor
    and not exists (select 1 from attempt)
$$;

-- Release is HOLDER-CHECKED: a TTL-expired loser cannot release the winner's lease.
create or replace function public.universe_fire_lease_release(
  p_client_id uuid,
  p_vendor    text,
  p_holder    text
) returns boolean
language sql
security definer
set search_path = public
as $$
  with released as (
    update public.universe_fire_lease
      set holder_invocation_id = null, acquired_at = null
      where client_id = p_client_id and vendor = p_vendor
        and holder_invocation_id = p_holder
    returning 1
  )
  select exists (select 1 from released)
$$;

-- ── GRANT POSTURE — rpc-grant-posture.guard.mjs's law, and the 2026-08-13 lesson it encodes ─────────
-- ⛔ `revoke … from public` ALONE IS NOT ENOUGH: Supabase grants EXECUTE to anon and authenticated as
-- EXPLICIT role grants, so revoking PUBLIC leaves both in place (measured 2026-08-13: 15 of 21 public
-- functions anon-callable that way). Both functions here are SECURITY DEFINER writers into the lease —
-- service_role only.
revoke all on function public.universe_fire_lease_acquire(uuid, text, text, integer) from public;
revoke all on function public.universe_fire_lease_acquire(uuid, text, text, integer) from anon;
revoke all on function public.universe_fire_lease_acquire(uuid, text, text, integer) from authenticated;
grant execute on function public.universe_fire_lease_acquire(uuid, text, text, integer) to service_role;

revoke all on function public.universe_fire_lease_release(uuid, text, text) from public;
revoke all on function public.universe_fire_lease_release(uuid, text, text) from anon;
revoke all on function public.universe_fire_lease_release(uuid, text, text) from authenticated;
grant execute on function public.universe_fire_lease_release(uuid, text, text) to service_role;

-- ── ROLLBACK (NOT RUN — recorded so 2am has it) ─────────────────────────────────────────────────────
--   drop function if exists public.universe_fire_lease_acquire(uuid, text, text, integer);
--   drop function if exists public.universe_fire_lease_release(uuid, text, text);
--   drop table if exists public.universe_fire_lease;
