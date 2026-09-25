-- 107_universe_fire_slot_and_witness.sql — LORAMER_FIRE_CEILING_600_V1
--
-- ⛔ WHAT THIS IS, AND WHY IT IS A COUNT RATHER THAN A MUTEX. Raising the fire ceiling to 600 s lets a five-minute
-- rotation start a second and third fire before the first ends. The per-(client, vendor) lease (085) already
-- makes two fires on ONE client impossible; nothing bounded how many DIFFERENT clients fire at once. This adds
-- that bound as a SLOT COUNT, seeded to MAX_CONCURRENT_FIRES.
-- A count is the right primitive here and a mutex is not: a TTL lease "guarantees mutual exclusion only as long
-- as the client holding the lock terminates its work within the lock validity time", and without fencing tokens
-- a paused holder can overrun it (Kleppmann, 2016-02-08). An over-count admits ONE EXTRA FIRE; it cannot corrupt
-- a row, because the row-level safety property is still the 085 lease's. Advisory locks were rejected for a
-- measured reason: we reach Postgres through PostgREST, which multiplexes its own pool, and a session-scoped
-- advisory lock "held until explicitly released or the session ends" is not addressable across that pooler
-- (PostgreSQL docs, Explicit Locking).
--
-- ⛔ ROTATION MAY NOT TAKE THE LAST SLOT. A pressed Backfill is a NAMED fire (`?clientId=` — the pump, the run
-- route and the button's kickoff all carry it; the five-minute rotation does not). Rotation therefore acquires with
-- p_leave_free = 1 and is refused when taking a slot would leave none, so a customer's press always finds one.
--
-- ⛔ COUNT AND GRAB HAPPEN UNDER ONE LOCK. The first cut counted free slots and then took one; two concurrent
-- rotation fires could both read "2 free" and both take, leaving zero. The function below locks EVERY slot row
-- for this vendor FOR UPDATE first, and counts and takes inside that lock.
--
-- ⛔ CLOCK-BASED, like 085 and 097: a holder that dies leaves a row that goes stale after p_ttl_seconds and is
-- retaken. No manual unblock is needed or exists.
--
-- REVERT: DROP FUNCTION public.universe_fire_slot_acquire(text,text,integer,integer);
--         DROP FUNCTION public.universe_fire_slot_release(text,text);
--         DROP TABLE public.universe_fire_slot;
--         ALTER TABLE public.universe_fire_log DROP COLUMN slot_no, … (all nine, additive).
-- ⛔ THERE IS NO STAGING DATABASE. This can only be proven where it is applied.

create table if not exists public.universe_fire_slot (
  slot_no              smallint    not null,
  vendor               text        not null,
  holder_invocation_id text        null,
  acquired_at          timestamptz null,
  primary key (slot_no, vendor)
);

-- RLS ON, ZERO POLICIES = deny-all except service_role. Same posture as universe_fire_lease (085).
alter table public.universe_fire_slot enable row level security;
grant select, insert, update, delete on public.universe_fire_slot to service_role;

-- MAX_CONCURRENT_FIRES = 3 (universe-v2-contract.ts). The vendor spelling is the one both execution hosts
-- already pass to acquireFireLease: 'google_ads'.
insert into public.universe_fire_slot (slot_no, vendor) values (1, 'google_ads'), (2, 'google_ads'), (3, 'google_ads')
  on conflict (slot_no, vendor) do nothing;

create or replace function public.universe_fire_slot_acquire(
  p_vendor text, p_holder text, p_ttl_seconds integer, p_leave_free integer default 0
) returns table (granted boolean, slot_no smallint, free_before integer)
language plpgsql security definer set search_path = public as $$
declare
  v_free  integer;
  v_slot  smallint;
begin
  -- ONE LOCK over the whole vendor's slots: count and grab cannot interleave with another acquirer.
  perform 1 from public.universe_fire_slot s where s.vendor = p_vendor order by s.slot_no for update;

  select count(*) into v_free
    from public.universe_fire_slot s
   where s.vendor = p_vendor
     and (s.holder_invocation_id is null
          or s.acquired_at is null
          or s.acquired_at < now() - make_interval(secs => p_ttl_seconds));

  if v_free <= p_leave_free then
    return query select false, null::smallint, v_free;
    return;
  end if;

  update public.universe_fire_slot s
     set holder_invocation_id = p_holder, acquired_at = now()
   where s.vendor = p_vendor
     and s.slot_no = (
       select s2.slot_no from public.universe_fire_slot s2
        where s2.vendor = p_vendor
          and (s2.holder_invocation_id is null
               or s2.acquired_at is null
               or s2.acquired_at < now() - make_interval(secs => p_ttl_seconds))
        order by s2.slot_no
        limit 1)
   returning s.slot_no into v_slot;

  return query select v_slot is not null, v_slot, v_free;
end $$;

create or replace function public.universe_fire_slot_release(p_vendor text, p_holder text)
returns integer language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  update public.universe_fire_slot
     set holder_invocation_id = null, acquired_at = null
   where vendor = p_vendor and holder_invocation_id = p_holder;
  get diagnostics n = row_count;
  return n;
end $$;

revoke all on function public.universe_fire_slot_acquire(text, text, integer, integer) from public;
revoke all on function public.universe_fire_slot_acquire(text, text, integer, integer) from anon;
revoke all on function public.universe_fire_slot_acquire(text, text, integer, integer) from authenticated;
grant execute on function public.universe_fire_slot_acquire(text, text, integer, integer) to service_role;
revoke all on function public.universe_fire_slot_release(text, text) from public;
revoke all on function public.universe_fire_slot_release(text, text) from anon;
revoke all on function public.universe_fire_slot_release(text, text) from authenticated;
grant execute on function public.universe_fire_slot_release(text, text) to service_role;

-- ── THE DURABLE WITNESS ─────────────────────────────────────────────────────────────────────────────────
-- ⛔ WHY: rounds 3-5 of 2026-09-25 cost four rounds to diagnose a 19-hour re-ask stall because every re-ask
-- counter lived ONLY in the HTTP response body and `deferredUnits` was a console line. universe_fire_log has no
-- reask column and cron_runs stores no body, so "was a unit planned and then deferred?" was unanswerable from
-- any durable row. These columns are that answer.
-- NULL means the exit never reached that stage — never 0 — the convention migrations/092 set for the missed columns.
alter table public.universe_fire_log
  add column if not exists slot_no                 smallint,
  add column if not exists slot_outcome            text,
  add column if not exists deferred_units          integer,
  add column if not exists reask_queued            integer,
  add column if not exists reask_selected          integer,
  add column if not exists reask_done              integer,
  add column if not exists reask_errored           integer,
  add column if not exists reask_settled_by_ledger integer,
  add column if not exists reask_skipped           integer;
