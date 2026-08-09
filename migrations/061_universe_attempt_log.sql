-- 061_universe_attempt_log.sql
-- LORAMER_UNIVERSE_ATTEMPT_LOG_V1 — WALK REBUILD, STEP 5. The append-only attempt log that replaces the
-- mutate-one-row-per-window bookkeeping. DB half + the two aggregates; the TypeScript helpers ship with it,
-- but NOTHING publishes to a new consumer in this step.
--
-- ⛔ WHY THIS EXISTS, IN ONE SENTENCE: `universe_window_log` UPSERTS ONE ROW PER WINDOW, so every write
-- destroys the previous state, and that single property produced three 300-second poison loops, a clobbered
-- `abandoned_owed` record, a 15× overspend and a false coverage claim. Identity here is the RANGE and
-- nothing is ever overwritten, so a failure becomes a FACT rather than a state that the next attempt erases.
--
-- ════════════════════════════════════════════════════════════════════════════════════════════════════════
-- ⛔ NO STAGING DATABASE. Stated before applying, per the 060 discipline: this project has ONE database.
-- An RPC or a migration can only be proven where it is applied. Everything below is therefore ordered so
-- that each statement is independently revertible, and the assertions read back FROM THE CATALOG rather
-- than from what this file says it did.
-- ════════════════════════════════════════════════════════════════════════════════════════════════════════
--
-- MEASURED BEFORE APPLYING (2026-08-08, live):
--   universe_window_log     17,892 rows / 9,608 kB   ← NOT MIGRATED, NOT DROPPED, NOT WRITTEN BY THIS STEP
--   universe_run_state         346 rows /   552 kB   ← NOT MIGRATED, NOT DROPPED, NOT WRITTEN BY THIS STEP
--   universe_run_notice          0 rows /    24 kB   ← untouched
--   universe_attempt_log     does not exist          ← created here
--   server_version           17.6
--
-- ⛔ THE OLD TABLES STAY. They hold the only record of the walk's history and the negative-coverage subset
-- (plan §11). They are read ONCE at seed time and never again. Rollback for the whole rebuild remains
-- "stop publishing to the new consumer" — there is no data motion to undo, in either direction.
--
-- ════════════════════════════════════════════════════════════════════════════════════════════════════════
-- STATEMENTS, IN ORDER, WITH THEIR LOCKS — every one of them on a table that is EMPTY or does not yet exist
-- ════════════════════════════════════════════════════════════════════════════════════════════════════════
--   (0) lock_timeout = 5s                          — session GUC, no lock
--   (1) row counts reported BEFORE anything        — read-only  (run separately; results above)
--   (2) CREATE TABLE universe_attempt_log          — ACCESS EXCLUSIVE on a relation that DOES NOT EXIST;
--                                                    no concurrent reader can be waiting on it
--   (3) CREATE INDEX ×3                            — ACCESS EXCLUSIVE, on an EMPTY table: catalog-time only.
--                                                    Deliberately NOT CONCURRENTLY — there is nothing to
--                                                    scan and CONCURRENTLY cannot run in a transaction block
--   (4) REVOKE / GRANT                             — ACCESS EXCLUSIVE on the table ACL, catalog only
--   (5) CREATE FUNCTION ×2                         — catalog only, takes NO lock on any table
--   (6) assertions                                 — read-only, FROM pg_catalog
--
-- ⛔ NOTHING HERE TOUCHES A TABLE THAT IS UNDER LIVE WRITE. `universe_window_log` is written every 2-4
-- minutes when a walk is running; this migration does not name it in any DDL statement. Grep proof is in the
-- guard (`universe-attempt-append-only.guard.mjs`, leg (f)).
--
-- ════════════════════════════════════════════════════════════════════════════════════════════════════════
-- REVERT PATH — reverse order of apply, and it is complete because nothing outside this file changed
-- ════════════════════════════════════════════════════════════════════════════════════════════════════════
--   drop function if exists public.universe_attempt_open(uuid,text,text,text,date,date,integer);
--   drop function if exists public.universe_attempt_lane_spend_today(text,timestamptz);
--   drop table if exists public.universe_attempt_log;   -- indexes and grants go with it
-- ⛔ THE REVERT IS LOSSLESS FOR CAPTURED DATA BY CONSTRUCTION: this table holds BOOKKEEPING ONLY. Not one
-- captured row lives here. `metrics_daily` is not named anywhere in this file. That is Russ's governing
-- condition discharged mechanically rather than promised.

set lock_timeout = '5s';

-- ─────────────────────────────────────────────────────────────────────────────────────────────────────────
-- (2) THE TABLE
-- ─────────────────────────────────────────────────────────────────────────────────────────────────────────
-- ⛔ IDENTITY IS THE RANGE. `(client_id, vendor, resource, segment, window_start, window_end)` identifies
-- WHAT WAS ATTEMPTED. `attempt_no` is a COLUMN describing WHICH TRY, never part of identity. This is the
-- Meltano/Singer state-partitioning shape, and it is the exact inversion of 054, where the range WAS the row.
--
-- ⛔⛔ THE CONSTRAINT THAT IS DELIBERATELY ABSENT, NAMED SO ITS ABSENCE IS AUDITABLE:
-- **THERE IS NO UNIQUE CONSTRAINT AND NO UNIQUE INDEX OVER ANY OF THE IDENTITY COLUMNS.** 054 had
-- `unique (client_id, vendor, resource, segment, window_start)` and THAT IS THE DEFECT THAT STARTED THE
-- TEARDOWN: re-walking the older half of a window matched on `window_start` alone and UPSERTED INTO ROW
-- 2871 ITSELF, destroying an `abandoned_owed` record and silently dropping the owed enumeration 3→2.
-- Adding `window_end` would have fixed that one instance and left the CLASS untouched. The class is fixed
-- by having no arbiter at all.
--
-- ⛔ PROOF THAT NO `ON CONFLICT` OVERWRITE IS REACHABLE — four independent legs, all mechanically checkable:
--   1. `ON CONFLICT (cols) DO UPDATE` REQUIRES a unique index covering exactly `cols`. Assertion (6a) reads
--      `pg_index` and fails unless the ONLY unique index on this table is the primary key on `id`.
--   2. `id` is `bigserial` — DEFAULT `nextval()`. The helpers never supply it. A sequence value is never
--      reissued, so an INSERT CANNOT COLLIDE with an existing row: the one arbiter that exists is
--      unreachable.
--   3. Therefore `on conflict (client_id, resource, …)` raises SQLSTATE 42P10 ("there is no unique or
--      exclusion constraint matching the ON CONFLICT specification") — a hard error, not a silent clobber.
--      PostgREST `.upsert()` defaults to the primary key, i.e. leg 2.
--   4. ⛔ AND THE BELT-AND-BRACES, WHICH IS THE STRONGEST OF THE FOUR BECAUSE IT DOES NOT DEPEND ON ANYONE
--      WRITING CORRECT SQL: statement (4) REVOKES `UPDATE`, `DELETE` and `TRUNCATE` from every application
--      role. **A helper that tried to mutate a row would be refused by POSTGRES, not merely by a guard.**
--      Append-only becomes a PRIVILEGE rather than a convention. (The table owner retains rights, as owners
--      always do; the application connects as `service_role`, which does not.)
create table public.universe_attempt_log (
  id              bigserial primary key,

  -- identity — the RANGE
  client_id       uuid        not null,
  vendor          text        not null,
  resource        text        not null,
  segment         text        not null,   -- '' for the base entry, matching 054's convention exactly
  window_start    date        not null,
  window_end      date        not null,

  attempt_no      integer     not null,   -- a COLUMN. Never identity.

  -- ⛔ THREE PHASES, AND THE MIDDLE ONE IS WHY STREAMING IS SAFE. `attempt_started` is written BEFORE the
  -- vendor call, so a hard kill still leaves a record and still charges the governor. `day_committed` is
  -- written after each day's rows are durably upserted, which is what stops a partially-written day from
  -- reading as covered (plan §10 — partial-coverage-reads-as-complete, one grain down). `attempt_finished`
  -- is written after, and NEITHER OF THE FIRST TWO IS EVER UPDATED BY IT.
  phase           text        not null,

  -- day_committed only
  day             date,

  -- ⛔ SPEND IS CHARGED AT `attempt_started`, NOT AT FINISH. THIS IS THE POINT OF THE WHOLE REBUILD:
  -- 054 wrote `requests_spent` only in `closeWindow`, so a killed invocation left 0 and three poison loops
  -- burned quota INVISIBLY TO THE RATE GOVERNOR. Here the request is charged before it is made.
  requests_spent  integer,
  rows_written    bigint,
  refused_rows    bigint,
  disk_free_bytes bigint,

  -- attempt_finished only
  outcome         text,
  error           text,

  recorded_at     timestamptz not null default now(),

  constraint universe_attempt_log_phase_ck
    check (phase in ('attempt_started', 'day_committed', 'attempt_finished')),
  constraint universe_attempt_log_range_ck
    check (window_end >= window_start),
  constraint universe_attempt_log_attempt_no_ck
    check (attempt_no >= 1),
  -- a committed day must be a day OF THE WINDOW IT CLAIMS, and no other phase may carry one
  constraint universe_attempt_log_day_ck
    check (
      (phase = 'day_committed' and day is not null and day between window_start and window_end)
      or (phase <> 'day_committed' and day is null)
    ),
  -- ⛔ AN OUTCOME EXISTS ONLY ON A FINISHED ATTEMPT. A phase that carries an outcome without having
  -- finished is exactly the ambiguity 054 could not express, and it is refused at the schema.
  constraint universe_attempt_log_outcome_ck
    check (
      (phase = 'attempt_finished'
        and outcome in ('ok', 'zero', 'skipped', 'error', 'quota_stop', 'floor_stop', 'abandoned_owed'))
      or (phase <> 'attempt_finished' and outcome is null)
    )
);

comment on table public.universe_attempt_log is
  'LORAMER_UNIVERSE_ATTEMPT_LOG_V1 — APPEND-ONLY. Identity is the RANGE (client, vendor, resource, segment, window_start, window_end); attempt_no is a COLUMN. Three phases: attempt_started (written BEFORE the vendor call, and where spend is charged), day_committed (written after each day is durably upserted), attempt_finished. NOTHING IS EVER UPDATED: UPDATE/DELETE/TRUNCATE are revoked from every application role, and there is no unique index over the identity columns, so no ON CONFLICT can arbitrate an overwrite. Replaces the mutate-one-row-per-window bookkeeping of migrations/054, whose upsert destroyed its own history.';

comment on column public.universe_attempt_log.requests_spent is
  'Charged at attempt_started, BEFORE the vendor call. migrations/054 wrote this only on close, so a killed invocation left 0 and burned quota invisibly to the rate governor — three poison loops formed that way.';
comment on column public.universe_attempt_log.attempt_no is
  'WHICH TRY. Never part of identity. The bound that decides BROKEN-vs-MIS-SIZED counts attempts AT THE MINIMUM WINDOW SIZE, which is why the span is recoverable from window_end - window_start on every row.';

-- ─────────────────────────────────────────────────────────────────────────────────────────────────────────
-- (3) INDEXES — ⛔ ALL THREE ARE NON-UNIQUE, BY REQUIREMENT. A unique index here would reintroduce an
-- ON CONFLICT arbiter and with it the clobber class. Assertion (6a) enforces that this stays true.
-- ─────────────────────────────────────────────────────────────────────────────────────────────────────────
-- the attempt timeline for one range — what `universe_incident` (plan §16.4) reads, and what took six turns
-- to reconstruct by hand on 2026-08-08
create index universe_attempt_log_range_idx
  on public.universe_attempt_log (client_id, vendor, resource, segment, window_start, window_end, attempt_no, id);

-- the live check: no `attempt_started` older than one maxDuration without its `attempt_finished`. PARTIAL,
-- so it stays small — started rows are a minority of the table once day_committed rows accumulate.
create index universe_attempt_log_open_idx
  on public.universe_attempt_log (recorded_at)
  where phase = 'attempt_started';

-- the lane spend aggregate below, and the per-vendor rate reads
create index universe_attempt_log_spend_idx
  on public.universe_attempt_log (vendor, recorded_at)
  where phase = 'attempt_started';

-- ─────────────────────────────────────────────────────────────────────────────────────────────────────────
-- (4) ⛔ APPEND-ONLY AS A PRIVILEGE, NOT A CONVENTION
-- ─────────────────────────────────────────────────────────────────────────────────────────────────────────
-- This is the single most load-bearing statement in the file. A guard can be deleted; a build can be
-- bypassed; a helper can be written wrong by a future session that never reads this comment. A revoked
-- privilege refuses at the database, every time, with no way to be talked out of it.
revoke all on public.universe_attempt_log from public;
revoke all on public.universe_attempt_log from anon;
revoke all on public.universe_attempt_log from authenticated;
revoke all on public.universe_attempt_log from service_role;
grant select, insert on public.universe_attempt_log to service_role;
grant usage, select on sequence public.universe_attempt_log_id_seq to service_role;

-- ─────────────────────────────────────────────────────────────────────────────────────────────────────────
-- (5a) THE OPEN HELPER — one INSERT, and the attempt number is derived, never carried in
-- ─────────────────────────────────────────────────────────────────────────────────────────────────────────
-- ⛔ WHY AN RPC RATHER THAN A PLAIN INSERT FROM NODE: `attempt_no` must be `max(prior) + 1` for this range,
-- and with `maxConcurrency: 2` two invocations can read the same max. A transaction-scoped ADVISORY LOCK on
-- the range's hash serialises exactly the two writers that could collide and is released at commit — no row
-- to lock, because there is no row to mutate.
-- ⛔ AND IT IS STILL APPEND-ONLY: the body contains one INSERT and nothing else. No UPDATE, no DELETE, no
-- ON CONFLICT. Assertion (6c) greps the catalog's own copy of this body to prove it.
--
-- ⛔ IT RETURNS SPEND AND ATTEMPT COUNTS — NEVER COVERAGE. Per plan §3, the attempt log is a SPEND +
-- FAILURE record and must never be consulted to decide what to walk. Nothing in this signature can be
-- mistaken for "is this range captured": `attempt_no` and `attempts_at_this_span` answer "how many times
-- have we tried", which is a question about US, not about the data.
create or replace function public.universe_attempt_open(
  p_client_id      uuid,
  p_vendor         text,
  p_resource       text,
  p_segment        text,
  p_window_start   date,
  p_window_end     date,
  p_requests       integer default 1
)
returns table (attempt_no integer, attempts_at_this_span integer)
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_key  text := p_client_id::text || '|' || p_vendor || '|' || p_resource || '|' || p_segment
                 || '|' || p_window_start::text || '|' || p_window_end::text;
  v_next integer;
  v_span integer := p_window_end - p_window_start;
begin
  -- serialise only the writers that could race on THIS range; released at commit
  perform pg_advisory_xact_lock(hashtextextended(v_key, 0));

  select coalesce(max(l.attempt_no), 0) + 1 into v_next
  from public.universe_attempt_log l
  where l.client_id = p_client_id and l.vendor = p_vendor and l.resource = p_resource
    and l.segment = p_segment and l.window_start = p_window_start and l.window_end = p_window_end
    and l.phase = 'attempt_started';

  insert into public.universe_attempt_log
    (client_id, vendor, resource, segment, window_start, window_end, attempt_no, phase, requests_spent)
  values
    (p_client_id, p_vendor, p_resource, p_segment, p_window_start, p_window_end, v_next,
     'attempt_started', greatest(coalesce(p_requests, 1), 0));

  -- ⛔ THE BOUND IS COUNTED AT THIS SPAN, NOT OVERALL (plan §16.3). Three failures at 30 days is
  -- MIS-SIZED; three at the 1-day minimum is BROKEN. Telling a customer "broken" when the truth is "we
  -- asked for too much at once" is the product lying about itself, so the counter has to know the span.
  return query
  select v_next,
         (select count(*)::integer from public.universe_attempt_log l2
           where l2.client_id = p_client_id and l2.vendor = p_vendor and l2.resource = p_resource
             and l2.segment = p_segment and l2.phase = 'attempt_started'
             and (l2.window_end - l2.window_start) = v_span
             and l2.window_start = p_window_start);
end;
$$;

revoke all on function public.universe_attempt_open(uuid,text,text,text,date,date,integer) from public;
revoke all on function public.universe_attempt_open(uuid,text,text,text,date,date,integer) from anon;
revoke all on function public.universe_attempt_open(uuid,text,text,text,date,date,integer) from authenticated;
grant execute on function public.universe_attempt_open(uuid,text,text,text,date,date,integer) to service_role;

-- ─────────────────────────────────────────────────────────────────────────────────────────────────────────
-- (5b) THE SIBLING SPEND AGGREGATE — required IN THIS COMMIT by plan §7
-- ─────────────────────────────────────────────────────────────────────────────────────────────────────────
-- ⛔ `google-op-budget.ts` sources the fleet backfill lane from `universe_lane_spend_today` (migrations/057),
-- which sums `universe_window_log`. Without a sibling reading the NEW log, forward/catchup/drain would
-- measure against a denominator missing the walk — a governor blind in exactly the way that produced the
-- 15× overspend. Both aggregates coexist while the old consumer still runs; the caller sums them.
-- ⛔ IT READS `attempt_started`, NOT `attempt_finished`. That is the entire improvement over 057: spend that
-- was charged and then killed is still counted, because the charge happened before the call.
create or replace function public.universe_attempt_lane_spend_today(p_vendor text, p_since timestamptz)
returns bigint
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(sum(requests_spent), 0)::bigint
  from public.universe_attempt_log
  where vendor = p_vendor
    and phase = 'attempt_started'
    and recorded_at >= p_since;
$$;

comment on function public.universe_attempt_lane_spend_today(text, timestamptz) is
  'LORAMER_UNIVERSE_ATTEMPT_LOG_V1 — sibling of universe_lane_spend_today (057) reading the append-only log. Sums attempt_started, so quota burned by an invocation that was killed before it could close is STILL COUNTED. Summed in Postgres: the Node-side sum it replaces truncated at PostgREST''s 1,000-row page cap.';

revoke all on function public.universe_attempt_lane_spend_today(text, timestamptz) from public;
revoke all on function public.universe_attempt_lane_spend_today(text, timestamptz) from anon;
revoke all on function public.universe_attempt_lane_spend_today(text, timestamptz) from authenticated;
grant execute on function public.universe_attempt_lane_spend_today(text, timestamptz) to service_role;

-- ─────────────────────────────────────────────────────────────────────────────────────────────────────────
-- (6) ASSERTIONS — read back FROM THE CATALOG, not from what this file claims it did
-- ─────────────────────────────────────────────────────────────────────────────────────────────────────────
do $$
declare
  n integer;
  b text;
begin
  -- (6a) ⛔ THE LOAD-BEARING ONE: exactly ONE unique index, and it is the primary key on `id`.
  select count(*) into n
  from pg_index i join pg_class c on c.oid = i.indexrelid
  where i.indrelid = 'public.universe_attempt_log'::regclass and i.indisunique;
  if n <> 1 then
    raise exception 'ASSERT (6a) FAILED: % unique indexes on universe_attempt_log, expected exactly 1 (the PK). A second unique index is an ON CONFLICT arbiter and reintroduces the clobber class.', n;
  end if;
  select count(*) into n
  from pg_index i join pg_attribute a on a.attrelid = i.indrelid and a.attnum = any(i.indkey)
  where i.indrelid = 'public.universe_attempt_log'::regclass and i.indisunique and a.attname <> 'id';
  if n <> 0 then
    raise exception 'ASSERT (6a) FAILED: the unique index covers % column(s) other than id. Identity must have NO arbiter.', n;
  end if;

  -- (6b) UPDATE / DELETE / TRUNCATE are not granted to any application role
  select count(*) into n
  from information_schema.role_table_grants
  where table_schema = 'public' and table_name = 'universe_attempt_log'
    and privilege_type in ('UPDATE', 'DELETE', 'TRUNCATE')
    and grantee in ('anon', 'authenticated', 'service_role', 'PUBLIC');
  if n <> 0 then
    raise exception 'ASSERT (6b) FAILED: % mutation grant(s) survive on universe_attempt_log. Append-only must be a privilege, not a convention.', n;
  end if;

  -- (6c) the open helper's body, AS THE CATALOG HOLDS IT, contains no mutation of this table
  select pg_get_functiondef(p.oid) into b
  from pg_proc p where p.proname = 'universe_attempt_open' and p.pronamespace = 'public'::regnamespace;
  if b is null then
    raise exception 'ASSERT (6c) FAILED: universe_attempt_open does not exist.';
  end if;
  if b ~* '(update|delete\s+from|truncate)\s+.*universe_attempt_log' or b ~* 'on\s+conflict' then
    raise exception 'ASSERT (6c) FAILED: universe_attempt_open contains a mutation or an ON CONFLICT clause. The helper APPENDS; a correction is another append.';
  end if;

  -- (6d) the four CHECK constraints are present
  select count(*) into n from pg_constraint
  where conrelid = 'public.universe_attempt_log'::regclass and contype = 'c'
    and conname in ('universe_attempt_log_phase_ck','universe_attempt_log_range_ck',
                    'universe_attempt_log_attempt_no_ck','universe_attempt_log_day_ck',
                    'universe_attempt_log_outcome_ck');
  if n <> 5 then
    raise exception 'ASSERT (6d) FAILED: % of 5 CHECK constraints present.', n;
  end if;

  -- (6e) the old tables are untouched and still hold their rows
  select count(*) into n from public.universe_window_log;
  if n < 17892 then
    raise exception 'ASSERT (6e) FAILED: universe_window_log holds % rows, was 17,892 before this migration. THIS MIGRATION MUST NOT WRITE TO IT.', n;
  end if;
  select count(*) into n from public.universe_run_state;
  if n <> 346 then
    raise exception 'ASSERT (6e) FAILED: universe_run_state holds % rows, expected 346 untouched.', n;
  end if;

  raise notice 'universe_attempt_log: all assertions passed (6a unique-index=PK-only, 6b no mutation grants, 6c helper appends only, 6d 5 checks, 6e old tables untouched).';
end $$;
