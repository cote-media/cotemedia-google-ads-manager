-- 083_universe_completion_signal.sql
-- LORAMER_COMPLETION_SIGNAL_V1 — THE TERMINAL FACT, AND THE TWO IDENTIFIERS THAT MAKE IT READABLE.
--
-- ⛔ NOT APPLIED. AUTHORED AT GATE-A AND HELD. There is no staging database (banked law), so this file is
-- proven only where it is applied, and applying it is the LIVE moment — a separate, confirmed act.
--
-- ════════════════════════════════════════════════════════════════════════════════════════════════════════
-- WHY, IN ONE SENTENCE: the consumer emits NO end-of-message signal — on the normal path `advance()` at
-- `WINDOWS_PER_PUBLISHED_MESSAGE = 1` returns "bounded run exhausted" and writes nothing — so every observer
-- INFERS completion from write activity, and write activity has gaps in the middle. Two instruments have now
-- been written wrong on that inference (`drive-one-surface.mjs` v1 returned on the first finished row; v2
-- quiesced on 10s of silence and read a stall over a window still being written, 16s open→finish).
-- Spec: DECISIONS LORAMER_COMPLETION_SIGNAL_DESIGN_V1. Do not re-derive it.
--
-- ⛔ THE PRIOR ART IS UNANIMOUS AND IT IS WHY THIS IS A ROW RATHER THAN A BETTER TIMEOUT:
--   Airbyte — a STATE MESSAGE echoed by the destination, per completed partition.
--   Temporal — "the Temporal Server doesn't detect failures when a Worker crashes"; a missed heartbeat means
--              the Activity "will be considered FAILED". Silence is never completion.
--   SQS     — an undeleted message becomes visible again. Silence means REDELIVERED, never done.
-- Three for three: COMPLETION IS A POSITIVE, DURABLE, EXPLICIT RECORD. We already had the heartbeat
-- (`day_committed`); only the terminal was missing.
--
-- ⛔ TWO IDENTIFIERS, AND THE SECOND IS NOT REDUNDANT — this was the finding that overturned a banked position.
--   `message_key`   PRODUCER-assigned. The idempotency key every publisher already mints and we threw away.
--                   Answers WHOSE WORK THIS IS. Enterprise Integration Patterns names exactly this as the
--                   minimum durable fact: "a producer-assigned message identifier … that identifies the
--                   specific logical operation". Without it a scheduled fire's requests are attributed to a
--                   drive's pass, which the earlier design banked as "an acceptable counting error" — the
--                   pattern does not offer that option.
--   `invocation_id` CONSUMER-assigned, minted once per handler entry. Answers WHICH EXECUTION wrote a row.
--                   ⛔ A MESSAGE KEY CANNOT DO THIS: Vercel Queues retries, and a REDELIVERY OF THE SAME
--                   MESSAGE CARRIES THE SAME KEY. Without a per-delivery id an observer still sees delivery
--                   #1's terminal row followed by delivery #2's range rows, and still cannot tell two terminal
--                   rows apart. One column closes neither case; two close both.
--
-- ⛔ THE TERMINAL ROW CARRIES **NO OUTCOME**, AND THAT IS A CONSTRAINT DECISION WITH ITS COST PRICED.
-- `universe_attempt_log_outcome_ck` binds `outcome` to `phase = 'attempt_finished'` BY STRUCTURE, so a new
-- phase is admitted only with `outcome IS NULL`. Carrying an outcome would mean rewriting that constraint's
-- SHAPE rather than its value list — a SECOND 23514-class change on the very constraint that produced a live
-- incident on 2026-08-17, for information that is already recorded: the exit reason goes in `error`, which is
-- free text and carries no CHECK. Cost avoided, nothing lost.
--
-- ⛔ SAFE BY CONSTRUCTION, LEG BY LEG:
--   · ADD COLUMN … text (nullable, no default) is CATALOG-ONLY in PG 11+ — no rewrite, no scan.
--   · WIDENING a CHECK cannot fail on stored rows, so there is no backfill and no data risk (the same
--     argument migrations/081 made for 'nongrain', and it held).
--   · DROP + CREATE of the RPC runs inside ONE transaction, so a concurrent caller BLOCKS on the lock and
--     then sees the new function. It never sees an absent one.
--   · NOTHING TOUCHES metrics_daily. Not one captured row lives in this table.
--
-- ⛔ AND THE ASSERTION SHAPE IS DELIBERATE, BECAUSE 082 GOT IT WRONG ONCE. Its assertion (6e) read
-- `information_schema.columns` for a FUNCTION — a catalog that lists TABLES AND VIEWS AND NOT FUNCTIONS — so
-- it returned 0 for a function that had existed for days and would have rolled the whole migration back on
-- its own. Every assertion below reads `pg_catalog` (`pg_proc`, `pg_constraint`, `pg_attribute`, `pg_index`),
-- and each one was checked against the LIVE pre-083 catalog first so its expected value is measured, not
-- assumed.
--
-- ════════════════════════════════════════════════════════════════════════════════════════════════════════
-- REVERT PATH — reverse order, complete because nothing outside this file changes
-- ════════════════════════════════════════════════════════════════════════════════════════════════════════
--   BEGIN;
--   DROP FUNCTION IF EXISTS public.universe_attempt_open(uuid,text,text,text,date,date,integer,date,date,text,text);
--   -- …re-run the 9-arg CREATE from migrations/082 (3), then its 3 revokes + 1 grant…
--   ALTER TABLE public.universe_attempt_log DROP CONSTRAINT universe_attempt_log_phase_ck;
--   ALTER TABLE public.universe_attempt_log ADD CONSTRAINT universe_attempt_log_phase_ck
--     CHECK (phase = ANY (ARRAY['attempt_started','day_committed','attempt_finished']));
--   ALTER TABLE public.universe_attempt_log DROP COLUMN invocation_id, DROP COLUMN message_key;
--   COMMIT;
--   NOTIFY pgrst, 'reload schema';
-- ⚠ A REVERT FAILS IF ANY 'message_finished' ROW EXISTS BY THEN — delete or re-classify those first. That is
-- the same caveat 081 carries for 'nongrain', and it is the price of a widened value list.

set lock_timeout = '5s';

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────────────────────────────────
-- (1) THE TWO IDENTIFIERS — additive, nullable, no default, no backfill
-- ─────────────────────────────────────────────────────────────────────────────────────────────────────────
-- ⛔ NOT IDENTITY, AND NEVER INDEXED UNIQUELY. Identity is still the RANGE. A unique index over either of
-- these would reintroduce an ON CONFLICT arbiter, which is the clobber class migrations/061 exists to end and
-- whose absence assertion (6a) re-checks below.
ALTER TABLE public.universe_attempt_log
  ADD COLUMN message_key   text,
  ADD COLUMN invocation_id text;

COMMENT ON COLUMN public.universe_attempt_log.message_key IS
  'LORAMER_COMPLETION_SIGNAL_V1 — the PRODUCER-assigned identifier: the idempotency key the publisher passed to send(). Answers WHOSE WORK THIS IS, so a scheduled fire''s requests can never be attributed to an operator drive''s pass. NULL on every pre-083 row and on any message published without one.';
COMMENT ON COLUMN public.universe_attempt_log.invocation_id IS
  'LORAMER_COMPLETION_SIGNAL_V1 — the CONSUMER-assigned identifier, minted once per handler entry. Answers WHICH EXECUTION wrote this row. ⛔ NOT a duplicate of message_key: a REDELIVERY carries the SAME message key, so only this column separates delivery #1''s terminal row from delivery #2''s later range rows.';

-- ─────────────────────────────────────────────────────────────────────────────────────────────────────────
-- (2) THE TERMINAL PHASE
-- ─────────────────────────────────────────────────────────────────────────────────────────────────────────
-- ⛔ INERT TO ALL SIX READERS, VERIFIED AT file:line RATHER THAN ASSUMED — every one filters on a phase it
-- names: universe_surface_rotation (064, phase='attempt_started') · readAttemptsAtSpan (attempt_started) ·
-- readLastAttempt (attempt_finished) · attestedEmptyDays (attempt_finished + outcome) · committedDays
-- (day_committed) · sizeNextWindow (attempt_finished + rows_written not null). Both aggregates too:
-- universe_attempt_lane_spend_today sums attempt_started; walk_rows_written reads rows_written, which a
-- terminal row leaves NULL.
-- ⛔ AND THE TS SIDE IS PINNED IN THE SAME COMMIT — `db-enum-mirrors-ts.guard.mjs` registers this pair. The
-- 2026-08-17 incident was a widened union with an unwidened CHECK; this is the same change in the opposite
-- order, and the guard is what stops the two drifting apart in either direction.
ALTER TABLE public.universe_attempt_log DROP CONSTRAINT universe_attempt_log_phase_ck;
ALTER TABLE public.universe_attempt_log ADD CONSTRAINT universe_attempt_log_phase_ck
  CHECK (phase = ANY (ARRAY['attempt_started', 'day_committed', 'attempt_finished', 'message_finished']));

-- ─────────────────────────────────────────────────────────────────────────────────────────────────────────
-- (3) THE OPEN HELPER — ONE signature, replaced, carrying the two identifiers through
-- ─────────────────────────────────────────────────────────────────────────────────────────────────────────
-- ⛔ DROP + CREATE, NEVER CREATE OR REPLACE, and the reason is measured rather than stylistic:
-- `universe-attempt-append-only.guard.mjs` leg (h) counts `pg_proc` rows for the two helpers and FAILS unless
-- it finds exactly 2. pg_proc holds ONE ROW PER OVERLOAD, so defaulted extra parameters would make it 3.
-- (082 also learned the harder half: `create or replace` REFUSES to change a return type at all — 42P13.)
-- ⛔ EVERYTHING ELSE IN THIS BODY IS UNCHANGED, AND EACH UNCHANGED PART IS KEYED ON THE RANGE ON PURPOSE:
-- the advisory-lock key, v_span, attempt_no, and attempts_at_this_span. The identifiers describe WHO AND
-- WHICH EXECUTION; they never change WHAT AN ATTEMPT IS.
DROP FUNCTION public.universe_attempt_open(uuid,text,text,text,date,date,integer,date,date);

CREATE FUNCTION public.universe_attempt_open(
  p_client_id           uuid,
  p_vendor              text,
  p_resource            text,
  p_segment             text,
  p_window_start        date,
  p_window_end          date,
  p_requests            integer default 1,
  p_parent_window_start date default null,
  p_parent_window_end   date default null,
  p_message_key         text default null,
  p_invocation_id       text default null
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
    (client_id, vendor, resource, segment, window_start, window_end, attempt_no, phase, requests_spent,
     parent_window_start, parent_window_end, message_key, invocation_id)
  values
    (p_client_id, p_vendor, p_resource, p_segment, p_window_start, p_window_end, v_next,
     'attempt_started', greatest(coalesce(p_requests, 1), 0),
     p_parent_window_start, p_parent_window_end, p_message_key, p_invocation_id);

  -- ⛔ THE BOUND IS COUNTED AT THIS SPAN, NOT OVERALL (plan §16.3). Three failures at 30 days is MIS-SIZED;
  -- three at the 1-day minimum is BROKEN.
  return query
  select v_next,
         (select count(*)::integer from public.universe_attempt_log l2
           where l2.client_id = p_client_id and l2.vendor = p_vendor and l2.resource = p_resource
             and l2.segment = p_segment and l2.phase = 'attempt_started'
             and (l2.window_end - l2.window_start) = v_span
             and l2.window_start = p_window_start);
end;
$$;

-- ⛔ A NEW FUNCTION IS GRANTED TO anon/authenticated BY SUPABASE'S DEFAULT PRIVILEGES, and 064 recorded
-- MEASURING exactly that leak after its own first apply. Re-applying the posture is not ceremony.
revoke all on function public.universe_attempt_open(uuid,text,text,text,date,date,integer,date,date,text,text) from public;
revoke all on function public.universe_attempt_open(uuid,text,text,text,date,date,integer,date,date,text,text) from anon;
revoke all on function public.universe_attempt_open(uuid,text,text,text,date,date,integer,date,date,text,text) from authenticated;
grant execute on function public.universe_attempt_open(uuid,text,text,text,date,date,integer,date,date,text,text) to service_role;

-- ─────────────────────────────────────────────────────────────────────────────────────────────────────────
-- (4) ASSERTIONS — pg_catalog ONLY. Never information_schema for a function (082's (6e) mistake).
-- ─────────────────────────────────────────────────────────────────────────────────────────────────────────
do $$
declare
  n integer;
  b text;
begin
  -- (7a) 061's load-bearing assertion, RE-RUN: exactly ONE unique index and it is the PK on `id`.
  select count(*) into n
  from pg_index i where i.indrelid = 'public.universe_attempt_log'::regclass and i.indisunique;
  if n <> 1 then
    raise exception 'ASSERT (7a) FAILED: % unique indexes on universe_attempt_log, expected exactly 1 (the PK). The identifiers are PROPERTIES, never identity.', n;
  end if;

  -- (7b) append-only is still a PRIVILEGE, not a convention
  select count(*) into n
  from information_schema.role_table_grants
  where table_schema = 'public' and table_name = 'universe_attempt_log'
    and privilege_type in ('UPDATE', 'DELETE', 'TRUNCATE')
    and grantee in ('anon', 'authenticated', 'service_role', 'PUBLIC');
  if n <> 0 then
    raise exception 'ASSERT (7b) FAILED: % mutation grant(s) survive on universe_attempt_log.', n;
  end if;

  -- (7c) BOTH columns exist, from pg_attribute rather than information_schema
  select count(*) into n from pg_attribute
  where attrelid = 'public.universe_attempt_log'::regclass and attnum > 0 and not attisdropped
    and attname in ('message_key', 'invocation_id');
  if n <> 2 then
    raise exception 'ASSERT (7c) FAILED: % of 2 identifier columns present on universe_attempt_log.', n;
  end if;

  -- (7d) the phase CHECK admits the terminal value AND is VALIDATED. `convalidated = false` would mean it
  -- passes new rows without ever having been proven against the stored ones — enforced-looking and not.
  select count(*) into n from pg_constraint
  where conrelid = 'public.universe_attempt_log'::regclass
    and conname = 'universe_attempt_log_phase_ck' and contype = 'c' and convalidated
    and pg_get_constraintdef(oid) like '%message_finished%';
  if n <> 1 then
    raise exception 'ASSERT (7d) FAILED: universe_attempt_log_phase_ck is missing, NOT VALIDATED, or does not admit message_finished.';
  end if;

  -- (7e) outcome_ck is UNCHANGED and still refuses an outcome on any non-finished phase. This is the
  -- assertion that proves the terminal row was designed AROUND the constraint rather than through it.
  select count(*) into n from pg_constraint
  where conrelid = 'public.universe_attempt_log'::regclass
    and conname = 'universe_attempt_log_outcome_ck' and convalidated
    and pg_get_constraintdef(oid) like '%outcome IS NULL%';
  if n <> 1 then
    raise exception 'ASSERT (7e) FAILED: universe_attempt_log_outcome_ck no longer binds outcome to attempt_finished. A terminal row carrying an outcome is a SECOND 23514-class change and is not what this migration does.';
  end if;

  -- (7f) EXACTLY TWO helper functions — what universe-attempt-append-only leg (h) counts. A third row means
  -- an overload survived the DROP and the guard is red on the next check:data.
  select count(*) into n from pg_proc
  where pronamespace = 'public'::regnamespace
    and proname in ('universe_attempt_open', 'universe_attempt_lane_spend_today');
  if n <> 2 then
    raise exception 'ASSERT (7f) FAILED: pg_proc holds % row(s) for the two helpers, expected exactly 2. An overload of universe_attempt_open fails universe-attempt-append-only leg (h) and leaves PostgREST two signatures to disambiguate.', n;
  end if;

  -- (7g) the helper still APPENDS ONLY, and now carries the identifiers — read from the catalog's own copy
  select pg_get_functiondef(p.oid) into b
  from pg_proc p where p.proname = 'universe_attempt_open' and p.pronamespace = 'public'::regnamespace;
  if b is null then
    raise exception 'ASSERT (7g) FAILED: universe_attempt_open does not exist after the replace.';
  end if;
  if b ~* '(update|delete\s+from|truncate)\s+.*universe_attempt_log' or b ~* 'on\s+conflict' then
    raise exception 'ASSERT (7g) FAILED: universe_attempt_open contains a mutation or an ON CONFLICT clause.';
  end if;
  if b !~ 'message_key' or b !~ 'invocation_id' then
    raise exception 'ASSERT (7g) FAILED: the new universe_attempt_open does not mention both identifiers — the stamp did not land and every attempt_started row would keep writing NULL, which reads exactly like today.';
  end if;

  raise notice 'universe_completion_signal: all assertions passed (7a unique-index=PK-only, 7b no mutation grants, 7c both identifier columns, 7d phase_ck admits message_finished and is validated, 7e outcome_ck UNCHANGED, 7f pg_proc=2, 7g helper appends and stamps both identifiers).';
end $$;

COMMIT;

-- ⛔ LAST, AND OUTSIDE THE TRANSACTION ON PURPOSE. PostgREST caches the schema; a changed FUNCTION SIGNATURE
-- and two new columns are exactly what goes stale, and `.rpc('universe_attempt_open', …)` would fail until it
-- reloads. Vendor's own documented remedy:
-- https://supabase.com/docs/guides/troubleshooting/refresh-postgrest-schema
NOTIFY pgrst, 'reload schema';
