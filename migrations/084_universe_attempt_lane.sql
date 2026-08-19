-- LORAMER_TOP_EDGE_LANE_V1 — 084: the attempt log learns WHICH LANE asked, and the rotation ignores the
-- lane that does not descend.
--
-- ⛔ THE DEFECT THIS EXISTS TO PREVENT, AND IT IS NOT HYPOTHETICAL — IT IS ARITHMETIC ON THE SHIPPED VIEW.
-- `universe_surface_rotation` returns, per surface, the MOST RECENTLY RECORDED attempt:
--     select distinct on (l.resource, l.segment) … order by l.resource, l.segment, l.recorded_at desc
-- `deriveAnchorEnd` then recedes to `lastWindowStart − 1`. So the first time a TOP-EDGE window
-- (2026-08-13..2026-08-18) is asked, the very next scheduled fire hands the anchor that window and the
-- descent — currently around a 2026-04-30 frontier — is RESET FOUR MONTHS UPWARD. On a scheduled top-edge
-- lane it is reset every pass: **the descent would never get below the strip again.** No data is lost
-- (coverage is derived, so the re-walked windows find nothing owed and spend no vendor request) but the
-- walk's bite is consumed re-traversing covered ground and the descent stalls, permanently and quietly.
-- ⇒ A TOP-EDGE LANE IS AN ENGINE CHANGE, NOT A SCHEDULER CHANGE, and this migration is the engine half.
--
-- ⛔ WHY A COLUMN AND NOT A RE-ORDER OF THE VIEW. The no-schema alternative is `order by window_end asc`
-- (deepest, not newest), which needs no column at all. REJECTED, and the reason is blast radius rather than
-- taste: it changes the anchor derivation for EVERY surface and every historical row, and
-- ★ANCHOR-HOLD-BRANCH-IS-UNGATED is ALREADY OPEN on that exact function with a fix authored and held at
-- Gate-A. Changing the same derivation twice, for two reasons, in one flight is how a fix and a regression
-- become indistinguishable. `lane` defaults to 'descend', so every one of the ~4,700 existing rows keeps its
-- meaning and the descent is byte-identical the moment this applies.
--
-- ⛔ APPLY ORDER IS LOAD-BEARING: **THIS MIGRATION FIRST, THE DEPLOY SECOND.** The walk is running unattended
-- at ~10,400 requests/day and must not stop during the window. That is safe ONLY because `p_lane` carries a
-- DEFAULT: supabase-js calls this RPC by NAMED arguments, so the currently-deployed build — which sends the
-- eleven arguments it knows about and no `p_lane` — still resolves against the twelve-argument signature.
-- Without the default the live build's every `appendAttemptStarted` would fail to resolve (PGRST202) and the
-- walk would stop dead until the deploy landed. WITH it, rows written by the old build land as 'descend',
-- which is exactly what they are.
--
-- ⛔ AND THE SECOND HALF OF THE SAFETY, STATED SO THE ORDER IS NOT REVERSED "BECAUSE IT LOOKS FINE": applying
-- this migration under the OLD build changes NOTHING observable. Every row it writes is 'descend', the
-- rotation filter admits exactly those rows, and the descent sees the same view it saw yesterday. There is no
-- window in which the two halves disagree.

-- ── (1) THE COLUMN ────────────────────────────────────────────────────────────────────────────────────
-- NOT NULL DEFAULT is non-rewriting on PG11+, so this does not take a heavy lock on a table the walk is
-- writing to right now. The CHECK is a closed vocabulary on purpose: a third lane must arrive with a
-- decision, not with a typo.
alter table public.universe_attempt_log
  add column if not exists lane text not null default 'descend';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.universe_attempt_log'::regclass and conname = 'universe_attempt_log_lane_chk'
  ) then
    -- ⛔ SPELLED AS `= ANY (ARRAY[...])` RATHER THAN `IN (...)`, AND THE REASON IS A READER, NOT A STYLE.
    -- Postgres normalises IN to this form anyway (verified from pg_get_constraintdef after applying), but
    -- `db-enum-mirrors-ts.guard.mjs` reads the MIGRATION FILE and extracts the values with /ARRAY\s*\[…\]/.
    -- Written as IN, the constraint applies correctly and the guard reports "no migration ADDs this
    -- constraint" — the TS union and the DB CHECK would then be unmirrored with a green build. Caught by
    -- that guard on this very commit.
    alter table public.universe_attempt_log
      add constraint universe_attempt_log_lane_chk
      check (lane = ANY (ARRAY['descend'::text, 'top-edge'::text]));
    -- ⛔ AND `ARRAY` IS UPPERCASE FOR THE SAME READER: db-enum-mirrors-ts extracts with /ARRAY\s*\[…\]/ and
    -- that regex carries NO `i` flag, so a lowercase `array[` applies identically in Postgres and is INVISIBLE
    -- to the mirror check. Two red runs of the same guard to learn one lesson: the constraint's SPELLING is
    -- part of its contract with the reader, not just with the database.
  end if;
end $$;

-- The rotation filters on lane inside a DISTINCT ON that already range-scans this index shape; carrying the
-- lane in the index keeps it a range scan rather than a filter-after-fetch.
create index if not exists universe_attempt_log_rotation_lane_idx
  on public.universe_attempt_log (client_id, vendor, lane, phase, resource, segment, recorded_at desc);

-- ── (2) THE WRITER — DROP + CREATE, BECAUSE ADDING A PARAMETER IS A NEW SIGNATURE ─────────────────────
-- ⛔ `CREATE OR REPLACE` CANNOT BE USED HERE AND THAT IS NOT A STYLE CHOICE: a function's identity includes
-- its argument list, so a REPLACE with an extra parameter creates an OVERLOAD rather than replacing —
-- and two overloads reachable by named arguments is an ambiguity that resolves differently depending on
-- which arguments a caller happens to send. DROP first. (082's own header records the same lesson one
-- column over: "HINT: Use DROP FUNCTION … first.")
-- ⛔ THE BODY BELOW IS THE LIVE BODY, READ BACK FROM `pg_get_functiondef` RATHER THAN RE-TYPED FROM 082 —
-- 083 had already added `p_message_key` and `p_invocation_id`, and re-typing from the older migration would
-- have silently dropped the provenance stamps that LORAMER_PROVENANCE_ON_EVERY_APPEND_V1 exists to keep.
-- ⛔ NO EXPLICIT BEGIN/COMMIT HERE. `apply_migration` already runs this file inside ONE transaction, and a
-- nested BEGIN would make the COMMIT below end the tool's transaction early — the DROP would land and the
-- rest of the file would run outside it. The atomicity that matters (drop and create are never separately
-- visible) is the TOOL's, and it is not re-implemented here.
drop function public.universe_attempt_open(uuid,text,text,text,date,date,integer,date,date,text,text);

create function public.universe_attempt_open(
  p_client_id uuid,
  p_vendor text,
  p_resource text,
  p_segment text,
  p_window_start date,
  p_window_end date,
  p_requests integer default 1,
  p_parent_window_start date default null::date,
  p_parent_window_end date default null::date,
  p_message_key text default null::text,
  p_invocation_id text default null::text,
  -- ⛔ THE DEFAULT IS THE MIGRATION-BEFORE-DEPLOY SAFETY. See the header: without it the live build stops.
  p_lane text default 'descend'
)
returns table(attempt_no integer, attempts_at_this_span integer)
language plpgsql
security definer
set search_path to 'public'
as $function$
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
     parent_window_start, parent_window_end, message_key, invocation_id, lane)
  values
    (p_client_id, p_vendor, p_resource, p_segment, p_window_start, p_window_end, v_next,
     'attempt_started', greatest(coalesce(p_requests, 1), 0),
     p_parent_window_start, p_parent_window_end, p_message_key, p_invocation_id,
     -- ⛔ NULL COLLAPSES TO 'descend', NOT TO AN ERROR. A caller that forgets the lane gets the SAFE answer:
     -- 'descend' is the lane the rotation reads, so a mislabelled row can only ever make the descent
     -- CONSERVATIVE (it holds), never make it skip. The reverse default would let a forgotten field hide a
     -- window from the anchor.
     coalesce(p_lane, 'descend'));

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
$function$;

comment on function public.universe_attempt_open(uuid,text,text,text,date,date,integer,date,date,text,text,text) is
  'LORAMER_TOP_EDGE_LANE_V1 — the only INSERT that writes an attempt_started row. p_lane defaults to '
  '''descend'' so a build that predates the lane still resolves this signature by named arguments; that '
  'default is what lets the migration land BEFORE the deploy without stopping the walk.';

-- ⛔ THE THREE REVOKES AND THE GRANT, VERBATIM, BECAUSE DROP+CREATE RESETS THE ACL AND SUPABASE RE-GRANTS
-- anon/authenticated AS EXPLICIT ROLE GRANTS RATHER THAN THROUGH PUBLIC — `revoke … from public` ALONE DOES
-- NOT REMOVE THEM. 064's header records this being caught by reading `proacl` back rather than trusting the
-- script, on a SECURITY DEFINER function over the walk's scheduling state. Read it back after applying.
revoke all on function public.universe_attempt_open(uuid,text,text,text,date,date,integer,date,date,text,text,text) from public;
revoke all on function public.universe_attempt_open(uuid,text,text,text,date,date,integer,date,date,text,text,text) from anon;
revoke all on function public.universe_attempt_open(uuid,text,text,text,date,date,integer,date,date,text,text,text) from authenticated;
grant execute on function public.universe_attempt_open(uuid,text,text,text,date,date,integer,date,date,text,text,text) to service_role;

-- ── (3) THE ROTATION — CREATE OR REPLACE, NO DROP ────────────────────────────────────────────────────
-- ⛔ THE SIGNATURE AND RETURN TYPE ARE UNCHANGED, so REPLACE is legal here and is the right tool: it leaves
-- the ACL in place and leaves NO WINDOW in which the function does not exist. (082 had to DROP because it
-- was ADDING an output column, which changes the return type — a different situation, not a precedent.)
-- The revokes and grant are re-applied below anyway: asserting a posture costs nothing and the one time this
-- repo assumed it, the function was reachable by anon.
create or replace function public.universe_surface_rotation(
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
         coalesce(l.parent_window_end, l.window_end),
         l.recorded_at,
         (l.parent_window_start is not null and l.parent_window_end is not null)
  from public.universe_attempt_log l
  where l.client_id = p_client_id
    and l.vendor = p_vendor
    and l.phase = 'attempt_started'
    and l.resource <> '__account_inception'
    -- ⛔ LORAMER_TOP_EDGE_LANE_V1 — THE ONE LINE THIS MIGRATION EXISTS FOR. The rotation answers "where is
    -- the DESCENT", and a top-edge attempt is not part of the descent. Without this filter the newest
    -- top-edge row wins the DISTINCT ON and the anchor is dragged to the top of the calendar every pass.
    and l.lane = 'descend'
  order by l.resource, l.segment, l.recorded_at desc
$$;

comment on function public.universe_surface_rotation(uuid, text) is
  'LORAMER_TOP_EDGE_LANE_V1 (was LORAMER_PARENT_WINDOW_IS_THE_UNIT_V1) — one row per (resource, segment): '
  'the last window the DESCENDING lane asked, and when. Rows written by the top-edge lane are excluded: they '
  'are not part of the descent and would otherwise win the DISTINCT ON and reset the anchor to today. '
  'parent_window_* is preferred where the row carries it, falling back to the RANGE bounds for legacy rows, '
  'with parent_known saying which. parent_known = false is UNKNOWN, not "the range is the window" — '
  'deriveAnchorEnd HOLDS on it. An ordering read over the append-only attempt log, never a cursor.';

revoke all on function public.universe_surface_rotation(uuid, text) from public;
revoke all on function public.universe_surface_rotation(uuid, text) from anon;
revoke all on function public.universe_surface_rotation(uuid, text) from authenticated;
grant execute on function public.universe_surface_rotation(uuid, text) to service_role;

-- ── (4) ASSERTIONS — THE MIGRATION PROVES ITSELF OR RAISES ────────────────────────────────────────────
do $$
declare n integer;
begin
  select count(*) into n from information_schema.columns
   where table_schema='public' and table_name='universe_attempt_log' and column_name='lane';
  if n <> 1 then raise exception 'ASSERT (1) FAILED: universe_attempt_log has no lane column.'; end if;

  select count(*) into n from public.universe_attempt_log where lane is null;
  if n <> 0 then raise exception 'ASSERT (1b) FAILED: % row(s) carry a NULL lane; the default did not take.', n; end if;

  select count(*) into n from pg_proc p
   where p.pronamespace='public'::regnamespace and p.proname='universe_attempt_open'
     and pg_get_function_identity_arguments(p.oid) like '%p_lane text%';
  if n <> 1 then raise exception 'ASSERT (2) FAILED: universe_attempt_open does not carry p_lane (found % matching overload(s)).', n; end if;

  select count(*) into n from pg_proc p
   where p.pronamespace='public'::regnamespace and p.proname='universe_attempt_open';
  if n <> 1 then raise exception 'ASSERT (2b) FAILED: % overload(s) of universe_attempt_open exist; named-argument calls would resolve ambiguously.', n; end if;

  select count(*) into n from pg_proc p
   where p.pronamespace='public'::regnamespace and p.proname='universe_surface_rotation'
     and pg_get_functiondef(p.oid) like '%l.lane = ''descend''%';
  if n <> 1 then raise exception 'ASSERT (3) FAILED: universe_surface_rotation does not filter lane = descend — a top-edge row would reset the anchor.'; end if;
end $$;
