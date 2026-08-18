-- 082_universe_parent_window.sql
-- LORAMER_PARENT_WINDOW_IS_THE_UNIT_V1 — THE WINDOW THAT WAS ASKED, RECORDED AT THE ONE SITE THAT INSERTS IT.
--
-- ⛔ NOT APPLIED. AUTHORED AT GATE-A AND HELD. There is no staging database (banked law), so this file is
-- proven only where it is applied, and applying it is the LIVE moment — a separate, confirmed act.
--
-- ════════════════════════════════════════════════════════════════════════════════════════════════════════
-- WHY, IN ONE SENTENCE: `universe_attempt_log.window_start/window_end` means "the RANGE walked" or "the
-- WINDOW asked" depending on which of five writers touched the row last, and `universe_surface_rotation`
-- (064) returns whichever row is newest — so `deriveAnchorEnd` recedes by the width of the LAST RANGE
-- WRITTEN, usually ONE DAY. MEASURED 2026-08-17 by scripts/drive-one-surface.mjs over five consecutive
-- passes with zero variance: ~1,427 passes and ~2,854 vendor requests to floor ONE surface, ~4 years each,
-- 346 surfaces. THE WALK CANNOT REACH INCEPTION AS BUILT.
-- Spec: docs/LORAMER_WALK_REBUILD_ARCHITECTURE.md § PROGRESS-TRUTH. Do not re-derive it.
--
-- ⛔ THREE THINGS THE ADVERSARY PASS OF 2026-08-18 CHANGED ABOUT THE BANKED DESIGN, EACH LOAD-BEARING:
--   (a) THE ROW THE ROTATION READS IS NOT INSERTED IN NODE. `appendAttemptStarted` does not INSERT — it calls
--       `universe_attempt_open`, a SECURITY DEFINER function, and THAT function's INSERT is the only writer of
--       an `attempt_started` row. The parent must therefore be stamped HERE, in SQL, not "by the consumer".
--       ⇒ And it must be ONE signature, not an overload: `universe-attempt-append-only.guard.mjs` leg (h)
--       reads `select proname from pg_proc … in ('universe_attempt_open','universe_attempt_lane_spend_today')`
--       and FAILS unless it finds exactly 2 rows. pg_proc holds ONE ROW PER OVERLOAD, so adding two
--       defaulted parameters would make it 3 and turn the guard red — besides leaving PostgREST two
--       candidate signatures to disambiguate. DROP + CREATE, exactly as 061's own REVERT PATH is written.
--   (b) A NULL PARENT IS **UNKNOWN**, AND UNKNOWN MUST NOT AUTHORISE A RECESSION. Every one of the 5,967
--       existing `attempt_started` rows has no parent and none can be derived: the window that was asked is
--       recoverable from no stored fact, because sizing is adaptive and time-varying (`sizeNextWindow`,
--       row-budget driven, `{minDays:1,maxDays:30}`) — the same argument the spec already uses to rule out
--       recomputation, applied backwards. A guessed parent would be the range lie with a new column name.
--       ⇒ The rotation returns `parent_known`, and `deriveAnchorEnd` HOLDS when it is false.
--   (c) A CHECK IS OWED, IN THREE LEGS. Without it, `coalesce(parent_start, window_start)` and
--       `coalesce(parent_end, window_end)` are evaluated INDEPENDENTLY, so a row with one column set returns a
--       FRANKENSTEIN pair — a window's bottom with a range's top — straight into the anchor derivation.
--
-- ⛔ SAFE BY CONSTRUCTION, LEG BY LEG:
--   · ADD COLUMN … date (nullable, no default) is a CATALOG-ONLY change in PG 11+ — no table rewrite, no scan.
--   · The CHECK is added over columns that are NULL on every existing row, and every leg short-circuits on
--     NULL, so it cannot fail validation. The `__account_inception` pseudo-row (1970-01-01, writer :344)
--     passes for the same reason. VERIFY, DO NOT ASSUME: assertion (6f) re-validates it from the catalog.
--   · DROP + CREATE of the RPC runs inside ONE transaction, so a concurrent caller BLOCKS on the lock and
--     then sees the new function. It never sees an absent one.
--   · NOTHING TOUCHES metrics_daily. Not one captured row lives in this table. Russ's governing condition,
--     discharged mechanically rather than promised.
--
-- ⛔ POSTGREST SCHEMA CACHE — VERIFIED AGAINST THE VENDOR'S OWN DOC, NOT ASSUMED. Changing a function's
-- signature leaves PostgREST's cached schema stale and `.rpc()` fails until it reloads. The documented fix is
-- `NOTIFY pgrst, 'reload schema';` — https://supabase.com/docs/guides/troubleshooting/refresh-postgrest-schema
-- It is the LAST statement, after COMMIT, because a NOTIFY inside a transaction fires only at commit and the
-- point is to make the ordering visible rather than incidental.
--
-- ════════════════════════════════════════════════════════════════════════════════════════════════════════
-- REVERT PATH — reverse order, complete because nothing outside this file changes
-- ════════════════════════════════════════════════════════════════════════════════════════════════════════
--   BEGIN;
--   -- restore 064's rotation exactly (5 output columns, no parent_known)
--   DROP FUNCTION IF EXISTS public.universe_surface_rotation(uuid, text);
--   -- …re-run the CREATE from migrations/064_universe_surface_rotation.sql, then its 3 revokes + 1 grant…
--   DROP FUNCTION IF EXISTS public.universe_attempt_open(uuid,text,text,text,date,date,integer,date,date);
--   -- …re-run the CREATE from migrations/061_universe_attempt_log.sql (5a), then its 3 revokes + 1 grant…
--   ALTER TABLE public.universe_attempt_log DROP CONSTRAINT universe_attempt_log_parent_ck;
--   ALTER TABLE public.universe_attempt_log DROP COLUMN parent_window_end, DROP COLUMN parent_window_start;
--   COMMIT;
--   NOTIFY pgrst, 'reload schema';
-- ⚠ THE REVERT IS LOSSLESS FOR CAPTURED DATA AND LOSSY FOR PARENT STAMPS — dropping the columns discards
-- every parent recorded since the apply, and they are NOT re-derivable (see (b) above). A revert therefore
-- returns the walk to the 1-day step, which is the pre-fix behaviour and not a new failure.

set lock_timeout = '5s';

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────────────────────────────────
-- (1) THE COLUMNS — additive, nullable, no default, no backfill
-- ─────────────────────────────────────────────────────────────────────────────────────────────────────────
-- ⛔ THEY ARE NOT IDENTITY AND MUST NEVER BECOME IT. Identity is still the RANGE
-- `(client_id, vendor, resource, segment, window_start, window_end)`; the parent is a PROPERTY of the attempt
-- describing what it was a part of. Indexing or uniquing them would reintroduce an ON CONFLICT arbiter, which
-- is the clobber class 061 exists to end (its assertion (6a) enforces this and is re-run below).
ALTER TABLE public.universe_attempt_log
  ADD COLUMN parent_window_start date,
  ADD COLUMN parent_window_end   date;

COMMENT ON COLUMN public.universe_attempt_log.parent_window_start IS
  'LORAMER_PARENT_WINDOW_IS_THE_UNIT_V1 — the START of the WINDOW THAT WAS ASKED (the message''s own startDate), of which this row''s window_start..window_end is one walked RANGE. NULL = UNKNOWN, never "same as the range": a NULL parent must not authorise a recession, because the window it belonged to is recoverable from no stored fact (sizing is adaptive and time-varying).';
COMMENT ON COLUMN public.universe_attempt_log.parent_window_end IS
  'LORAMER_PARENT_WINDOW_IS_THE_UNIT_V1 — the END of the window that was asked. The anchor recedes to parent_window_start - 1 and ONLY when that whole window is answered.';

-- ─────────────────────────────────────────────────────────────────────────────────────────────────────────
-- (2) THE THREE-LEG CHECK — the constraint the 2026-08-18 adversary pass said was owed
-- ─────────────────────────────────────────────────────────────────────────────────────────────────────────
-- LEG 1 · BOTH-OR-NEITHER. Without it a half-set pair survives every existing constraint and the rotation's
--          two independent COALESCEs return a window's bottom with a range's top.
-- LEG 2 · ORDERING. The mirror of `universe_attempt_log_range_ck`; a reversed pair would reach deriveAnchorEnd.
-- LEG 3 · CONTAINMENT — ⛔ THE ONE THAT WOULD HAVE CAUGHT THE ORIGINAL DEFECT'S INVERSE. "The range lies
--          inside the window it was asked under" stops being a convention five writers each have to remember
--          and becomes a fact Postgres refuses to store otherwise.
ALTER TABLE public.universe_attempt_log
  ADD CONSTRAINT universe_attempt_log_parent_ck CHECK (
    ((parent_window_start IS NULL) = (parent_window_end IS NULL))
    AND (parent_window_start IS NULL OR parent_window_end >= parent_window_start)
    AND (parent_window_start IS NULL OR (window_start >= parent_window_start AND window_end <= parent_window_end))
  );

-- ─────────────────────────────────────────────────────────────────────────────────────────────────────────
-- (3) THE OPEN HELPER — ONE signature, replaced. Body byte-identical except the INSERT's two new columns.
-- ─────────────────────────────────────────────────────────────────────────────────────────────────────────
-- ⛔ EVERYTHING ELSE IN THIS BODY IS UNCHANGED ON PURPOSE, AND EACH UNCHANGED PART WAS RE-READ BEFORE THIS
-- WAS WRITTEN, because all four are keyed on the RANGE and the RANGE is what still identifies an attempt:
--   · the advisory-lock key hashes the RANGE bounds — two invocations racing on the same RANGE still serialise;
--   · `v_span` is the RANGE's width — the BROKEN-vs-MIS-SIZED bound must keep counting at the span it failed at;
--   · `attempt_no` is max+1 over the RANGE — a re-walk of the same range is still try N+1;
--   · `attempts_at_this_span` filters on the RANGE's width — unchanged, deliberately.
-- Stamping the parent changes WHAT WE RECORD ABOUT an attempt, never WHAT AN ATTEMPT IS.
DROP FUNCTION public.universe_attempt_open(uuid,text,text,text,date,date,integer);

CREATE FUNCTION public.universe_attempt_open(
  p_client_id           uuid,
  p_vendor              text,
  p_resource            text,
  p_segment             text,
  p_window_start        date,
  p_window_end          date,
  p_requests            integer default 1,
  p_parent_window_start date default null,
  p_parent_window_end   date default null
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
     parent_window_start, parent_window_end)
  values
    (p_client_id, p_vendor, p_resource, p_segment, p_window_start, p_window_end, v_next,
     'attempt_started', greatest(coalesce(p_requests, 1), 0),
     p_parent_window_start, p_parent_window_end);

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

-- ⛔ A NEW FUNCTION IS GRANTED TO anon/authenticated BY SUPABASE'S DEFAULT PRIVILEGES. Re-applying 061's
-- posture is NOT ceremony — 064 recorded measuring exactly this leak after its own first apply, and a
-- SECURITY DEFINER writer over the walk's ledger reachable by an anon caller is the same class.
revoke all on function public.universe_attempt_open(uuid,text,text,text,date,date,integer,date,date) from public;
revoke all on function public.universe_attempt_open(uuid,text,text,text,date,date,integer,date,date) from anon;
revoke all on function public.universe_attempt_open(uuid,text,text,text,date,date,integer,date,date) from authenticated;
grant execute on function public.universe_attempt_open(uuid,text,text,text,date,date,integer,date,date) to service_role;

-- ─────────────────────────────────────────────────────────────────────────────────────────────────────────
-- (4) THE ROTATION — PREFERS the parent, and says whether it HAS one
-- ─────────────────────────────────────────────────────────────────────────────────────────────────────────
-- ⛔ THE `DISTINCT ON` KEY AND THE `ORDER BY` ARE BYTE-IDENTICAL TO 064, AND THAT IS THE WHOLE CORRECTNESS
-- ARGUMENT FOR THIS STATEMENT. Row selection is decided by the ORDER BY alone; the select list is evaluated
-- ON the already-chosen row, so adding COALESCE changes the returned BOUNDS and cannot change WHICH ROW WINS.
-- ⛔ AND THE IMPLEMENTATION THAT WOULD BREAK IT, NAMED SO IT IS NEVER REACHED FOR: any
-- `where parent_window_start is not null`, or any ORDER BY term naming the new columns. Either turns "prefer"
-- into a FILTER — and on a transitional surface it would prefer an OLDER parent-stamped row over a NEWER
-- legacy one, walking the anchor BACKWARDS.
-- ⛔ DROP-THEN-CREATE, AND POSTGRES TAUGHT US THIS ONE ON THE FIRST APPLY ATTEMPT (2026-08-18, rolled back
-- with nothing landed). `create or replace` REFUSES to change a function's return type:
--   ERROR 42P13: cannot change return type of existing function
--   DETAIL: Row type defined by OUT parameters is different.
--   HINT: Use DROP FUNCTION universe_surface_rotation(uuid,text) first.
-- Adding `parent_known` to the RETURNS TABLE is exactly that change. ⛔ IT IS THE SAME LESSON THE HELPER
-- ABOVE ALREADY CARRIES — a signature change is a DROP + CREATE — and it was applied there and missed here,
-- which is what a second instance of a rule in one file is for. The DROP is inside this transaction, so a
-- concurrent caller BLOCKS on the lock and never sees an absent function.
DROP FUNCTION public.universe_surface_rotation(uuid, text);

create function public.universe_surface_rotation(
  p_client_id uuid,
  p_vendor text
)
returns table (
  resource text,
  segment text,
  last_window_start date,
  last_window_end date,
  last_attempt_at timestamptz,
  parent_known boolean
)
language sql
stable
security definer
set search_path = public
as $$
  select distinct on (l.resource, l.segment)
         l.resource,
         l.segment,
         coalesce(l.parent_window_start, l.window_start),
         coalesce(l.parent_window_end,   l.window_end),
         l.recorded_at,
         (l.parent_window_start is not null)
  from public.universe_attempt_log l
  where l.client_id = p_client_id
    and l.vendor = p_vendor
    and l.phase = 'attempt_started'
    and l.resource <> '__account_inception'
  order by l.resource, l.segment, l.recorded_at desc
$$;

comment on function public.universe_surface_rotation(uuid, text) is
  'LORAMER_PARENT_WINDOW_IS_THE_UNIT_V1 (was LORAMER_RESUMER_SCAN_ROTATES_V1) — one row per (resource, segment): '
  'the last window ASKED and when. It now RETURNS what its name always claimed: parent_window_* when the row '
  'carries them, falling back to the RANGE bounds for legacy rows, with parent_known saying which. '
  '⛔ parent_known = false is UNKNOWN, not "the range is the window" — deriveAnchorEnd HOLDS on it and must '
  'never recede, because the window a legacy row belonged to is recoverable from no stored fact. '
  'Still an ordering read over the append-only log, never a cursor and never an owed list; coverage is still '
  'derived from metrics_daily by universe-coverage on every fire.';

revoke all on function public.universe_surface_rotation(uuid, text) from public;
revoke all on function public.universe_surface_rotation(uuid, text) from anon;
revoke all on function public.universe_surface_rotation(uuid, text) from authenticated;
grant execute on function public.universe_surface_rotation(uuid, text) to service_role;

-- ─────────────────────────────────────────────────────────────────────────────────────────────────────────
-- (5) ASSERTIONS — read back FROM THE CATALOG, not from what this file says it did
-- ─────────────────────────────────────────────────────────────────────────────────────────────────────────
do $$
declare
  n integer;
  b text;
begin
  -- (6a) 061's load-bearing assertion, RE-RUN: still exactly ONE unique index, still the PK on `id`.
  select count(*) into n
  from pg_index i where i.indrelid = 'public.universe_attempt_log'::regclass and i.indisunique;
  if n <> 1 then
    raise exception 'ASSERT (6a) FAILED: % unique indexes on universe_attempt_log, expected exactly 1 (the PK). The parent columns are a PROPERTY, never identity.', n;
  end if;

  -- (6b) append-only is still a PRIVILEGE
  select count(*) into n
  from information_schema.role_table_grants
  where table_schema = 'public' and table_name = 'universe_attempt_log'
    and privilege_type in ('UPDATE', 'DELETE', 'TRUNCATE')
    and grantee in ('anon', 'authenticated', 'service_role', 'PUBLIC');
  if n <> 0 then
    raise exception 'ASSERT (6b) FAILED: % mutation grant(s) survive on universe_attempt_log.', n;
  end if;

  -- (6c) ⛔ EXACTLY TWO HELPER FUNCTIONS, WHICH IS WHAT `universe-attempt-append-only.guard.mjs` leg (h)
  -- COUNTS. A third row here means an OVERLOAD survived the DROP and the guard is red in the next check:data.
  select count(*) into n from pg_proc
  where pronamespace = 'public'::regnamespace
    and proname in ('universe_attempt_open', 'universe_attempt_lane_spend_today');
  if n <> 2 then
    raise exception 'ASSERT (6c) FAILED: pg_proc holds % row(s) for the two helpers, expected exactly 2. An overload of universe_attempt_open would fail universe-attempt-append-only leg (h) and leave PostgREST two signatures to disambiguate.', n;
  end if;

  -- (6d) the helper still APPENDS ONLY — the catalog's own copy of the body, not this file's claim
  select pg_get_functiondef(p.oid) into b
  from pg_proc p where p.proname = 'universe_attempt_open' and p.pronamespace = 'public'::regnamespace;
  if b is null then
    raise exception 'ASSERT (6d) FAILED: universe_attempt_open does not exist after the replace.';
  end if;
  if b ~* '(update|delete\s+from|truncate)\s+.*universe_attempt_log' or b ~* 'on\s+conflict' then
    raise exception 'ASSERT (6d) FAILED: universe_attempt_open contains a mutation or an ON CONFLICT clause.';
  end if;
  if b !~ 'parent_window_start' then
    raise exception 'ASSERT (6d) FAILED: the new universe_attempt_open does not mention parent_window_start — the stamp did not land and every row would keep writing NULL, which reads exactly like today.';
  end if;

  -- (6e) the rotation returns SIX columns, and one of them is named parent_known.
  -- ⛔ THIS ASSERTION WAS WRONG IN ITS FIRST FORM AND WOULD HAVE ROLLED THE WHOLE MIGRATION BACK: it read
  -- `information_schema.columns`, which lists TABLES AND VIEWS AND NOT FUNCTIONS, so it returned 0 for a
  -- function that has existed and been called for days. MEASURED LIVE BEFORE THIS REPLACEMENT WAS WRITTEN:
  -- the pg_proc form below returns 5 against the pre-082 rotation, which is the number it should return.
  -- A count alone is also not enough — six columns of the wrong names would pass it — so the NAME is checked.
  select count(*) into n
  from pg_proc p, unnest(coalesce(p.proargmodes, '{}'::"char"[])) m
  where p.pronamespace = 'public'::regnamespace and p.proname = 'universe_surface_rotation'
    and m in ('t', 'o');
  if n <> 6 then
    raise exception 'ASSERT (6e) FAILED: universe_surface_rotation returns % output column(s), expected 6 (…, parent_known).', n;
  end if;
  select count(*) into n from pg_proc p
  where p.pronamespace = 'public'::regnamespace and p.proname = 'universe_surface_rotation'
    and 'parent_known' = any(p.proargnames);
  if n <> 1 then
    raise exception 'ASSERT (6e) FAILED: universe_surface_rotation has no output column named parent_known. Every caller would read undefined and an UNKNOWN window would silently authorise a recession.';
  end if;

  -- (6f) ⛔ THE CHECK IS VALIDATED, NOT MERELY PRESENT. `convalidated = false` would mean it passes new rows
  -- and was never proven against the 16,576 already stored — a constraint that looks enforced and is not.
  select count(*) into n from pg_constraint
  where conrelid = 'public.universe_attempt_log'::regclass
    and conname = 'universe_attempt_log_parent_ck' and contype = 'c' and convalidated;
  if n <> 1 then
    raise exception 'ASSERT (6f) FAILED: universe_attempt_log_parent_ck is missing or NOT VALIDATED.';
  end if;

  raise notice 'universe_parent_window: all assertions passed (6a unique-index=PK-only, 6b no mutation grants, 6c pg_proc=2, 6d helper appends and stamps the parent, 6e rotation returns parent_known, 6f the 3-leg CHECK is validated).';
end $$;

COMMIT;

-- ⛔ LAST, AND OUTSIDE THE TRANSACTION ON PURPOSE. PostgREST caches the schema; a changed FUNCTION SIGNATURE
-- is exactly what goes stale, and `.rpc('universe_attempt_open', …)` would fail until it reloads.
-- Vendor's own documented remedy: https://supabase.com/docs/guides/troubleshooting/refresh-postgrest-schema
NOTIFY pgrst, 'reload schema';
