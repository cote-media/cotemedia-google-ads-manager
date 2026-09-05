-- 087_forward_observation_log.sql
-- LORAMER_FORWARD_OBSERVATION_LOG_V1 — THE FORWARD LANE'S OWN APPEND-ONLY OBSERVATION STORE.
--
-- WHAT IT RECORDS: one row per (client, catalogue surface, producer, fire) — what forward ASKED (the window, the
-- request count) and what CAME BACK (rows per day, outcome ok|zero|nongrain|error, the error text). Ruling (F),
-- DECISIONS 2026-09-04: never a "didn't ask" day. Before this table an empty grain left NO row (every breadth
-- builder skips all-zero rows), so a dormant day and a day nobody asked were the same absence, and a fire's 16
-- vendor errors survived only as a count in cron_runs.error_count and a Vercel log that expired in an hour.
--
-- WHY ITS OWN TABLE AND NOT A THIRD LANE IN universe_attempt_log (settled 2026-09-05, round 1): a forward record
-- is an OBSERVATION, not an ATTEST. windowCoverage needs none of it — COVERED comes from metrics_daily rows,
-- which forward writes either way, and ATTESTED-EMPTY may never come from a forward zero (yesterday is a lagging
-- day, not an empty one; the top-edge lane's 12 sealed surface-days are the precedent). Keeping the records
-- here means universe-coverage.ts, universe-resumer.ts, the rotation view, the lane-spend RPC and the walk's
-- check:data legs cannot see them BY CONSTRUCTION — no lane predicate, no branch, nothing to forget.
-- universe_attempt_log is NOT touched by this migration; 084's lane CHECK keeps exactly two values.
-- Promotion (observation → attest after the vendor's restatement window) is the LOOKBACK lane's job, not this.
--
-- POSTURE (061's, verbatim in spirit): append-only as a PRIVILEGE — UPDATE/DELETE/TRUNCATE are revoked from
-- every application role; there is NO unique index over the identity columns, so no ON CONFLICT can ever
-- arbitrate an overwrite (the 054 clobber class); observed_at is clock_timestamp(), never now() (084's lesson:
-- now() is transaction start). The two enums are NAMED constraints spelled `= ANY (ARRAY[...])` because
-- db-enum-mirrors-ts.guard reads exactly that form.
--
-- NO STAGING DATABASE: this is applied where it runs. CREATE-only — it touches no existing object, which is what
-- makes it backend-writer rather than live-path.
-- REVERT PATH (exact, in this order):
--   drop function if exists public.forward_observation_spend_today(text, timestamptz);
--   drop table if exists public.forward_observation_log;
-- Run through the gated migration path or manually in the Supabase SQL Editor.

set lock_timeout = '5s';

create table public.forward_observation_log (
  id              bigint generated always as identity primary key,
  client_id       uuid not null,
  vendor          text not null,
  resource        text not null,
  segment         text not null default '',
  lane            text not null,
  producer        text not null,
  cron_run_id     bigint,
  window_start    date not null,
  window_end      date not null,
  observed_at     timestamptz not null default clock_timestamp(),
  requests_spent  integer not null default 1,
  rows_by_day     jsonb not null default '{}'::jsonb,
  rows_written    bigint not null default 0,
  outcome         text not null,
  error           text
);

alter table public.forward_observation_log
  add constraint forward_observation_log_lane_chk
  check (lane = ANY (ARRAY['forward'::text]));

alter table public.forward_observation_log
  add constraint forward_observation_log_outcome_chk
  check (outcome = ANY (ARRAY['ok'::text, 'zero'::text, 'nongrain'::text, 'error'::text]));

-- The NEED readers ask "what did forward observe on this surface over these days" — (client, vendor, surface),
-- newest window first. The fleet meter asks "how many requests since" — observed_at.
create index forward_observation_log_surface_idx
  on public.forward_observation_log (client_id, vendor, resource, segment, window_end desc);
create index forward_observation_log_observed_idx
  on public.forward_observation_log (observed_at);

alter table public.forward_observation_log enable row level security;

revoke all on public.forward_observation_log from public;
revoke all on public.forward_observation_log from anon;
revoke all on public.forward_observation_log from authenticated;
revoke all on public.forward_observation_log from service_role;
grant select, insert on public.forward_observation_log to service_role;
grant usage, select on sequence public.forward_observation_log_id_seq to service_role;

comment on table public.forward_observation_log is
  'LORAMER_FORWARD_OBSERVATION_LOG_V1 — APPEND-ONLY. One row per (client, catalogue surface, producer, forward fire): what forward ASKED (window, requests) and what CAME BACK (rows_by_day, outcome, error). An OBSERVATION, never an attest: no walk reader (universe_attempt_log, windowCoverage, the rotation) reads this table. Promotion to attest after the vendor restatement window is the lookback lane''s job. Read only through src/lib/backfill/forward-observation-log.ts.';

-- The fleet meter's forward witness: requests recorded since a moment, in REQUESTS (never multiplied).
create or replace function public.forward_observation_spend_today(p_vendor text, p_since timestamptz)
returns bigint
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(sum(requests_spent), 0)::bigint
  from public.forward_observation_log
  where vendor = p_vendor
    and observed_at >= p_since;
$$;

revoke all on function public.forward_observation_spend_today(text, timestamptz) from public;
revoke all on function public.forward_observation_spend_today(text, timestamptz) from anon;
revoke all on function public.forward_observation_spend_today(text, timestamptz) from authenticated;
grant execute on function public.forward_observation_spend_today(text, timestamptz) to service_role;

-- ASSERTIONS — read back FROM THE CATALOG, not from what this file claims it did (the 086 lesson: a DROP+CREATE
-- resets an ACL to the Supabase default and nothing but the catalog says so).
do $$
declare n integer; acl text; rls boolean;
begin
  select count(*) into n
  from pg_index i join pg_class c on c.oid = i.indexrelid
  where i.indrelid = 'public.forward_observation_log'::regclass and i.indisunique;
  if n <> 1 then
    raise exception 'ASSERT FAILED: % unique index(es) on forward_observation_log, expected exactly 1 (the PK) — a second unique index is an ON CONFLICT arbiter', n;
  end if;
  select relrowsecurity into rls from pg_class where oid = 'public.forward_observation_log'::regclass;
  if not rls then raise exception 'ASSERT FAILED: row level security is not enabled on forward_observation_log'; end if;
  select coalesce(relacl::text, '') into acl from pg_class where oid = 'public.forward_observation_log'::regclass;
  if acl like '%anon=%' or acl like '%authenticated=%' then
    raise exception 'ASSERT FAILED: forward_observation_log ACL still grants anon/authenticated: %', acl;
  end if;
  if acl not like '%service_role=ar/%' then
    raise exception 'ASSERT FAILED: service_role does not hold exactly SELECT+INSERT (ar) on forward_observation_log: %', acl;
  end if;
  select coalesce(p.proacl::text, '') into acl from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public' and p.proname = 'forward_observation_spend_today';
  if acl like '%anon=%' or acl like '%authenticated=%' or acl like '{=X%' then
    raise exception 'ASSERT FAILED: forward_observation_spend_today ACL still open: %', acl;
  end if;
  if acl not like '%service_role=X%' then
    raise exception 'ASSERT FAILED: service_role lost EXECUTE on forward_observation_spend_today: %', acl;
  end if;
end $$;
