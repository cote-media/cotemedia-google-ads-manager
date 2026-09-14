-- LORAMER_ROTATION_SKIP_SCAN_V1 — migration 094: universe_surface_rotation's BODY swapped to a recursive skip-scan +
-- LATERAL newest-row probe. SAME signature, SAME return type, SAME six columns, SAME filters — only the plan changes.
--
-- WHY (QUEUE ★ROTATION-INDEX-HEAP-FETCH, measured 2026-09-12 and again 2026-09-14): the 084 body is a DISTINCT ON over
-- every attempt_started row of the client's descend lane. universe_attempt_log_rotation_lane_idx (client_id, vendor,
-- lane, phase, resource, segment, recorded_at desc) carries none of the four window columns the SELECT returns, so every
-- one of the ~34,500 index entries a deep ledger holds becomes a HEAP FETCH to produce 349 rows. Measured on Foam OH
-- (the deepest ledger): 34,898 shared buffers, 49 ms WARM; pg_stat_statements since the 09-13 restart: 43 PostgREST
-- calls, mean 292 ms, max 4,256 ms, stddev 939, 16,180 disk reads — the tail is the same call with its ~10k pages
-- evicted, and it produced 14 'rotation-error' fires (statement timeout) in 48 h on 09-10/11. A fire that cannot read
-- its rotation refuses to scan (route.ts:347-359, the honest posture) — so the cold-cache tail is lost walk time.
--
-- THE SHAPE: (1) a recursive CTE walks the DISTINCT (resource, segment) keys through the same index — one index descent
-- per key, never a row walk (the "loose index scan" / skip scan, wiki.postgresql.org/wiki/Loose_indexscan); (2) one
-- LATERAL `order by recorded_at desc limit 1` per key returns the newest attempt_started row through the same index.
-- Measured on Foam OH: 3,270 buffers (3,254 hit + 16 read), 32.9 ms, Heap Fetches 62 — 10.7× less I/O, and the cold
-- cost is ~5 pages per surface instead of ~10k pages per call.
-- EQUALITY PROVEN BEFORE APPLY (2026-09-14): on all 17 clients with a live descent, (084 body EXCEPT this body) = 0 rows
-- and (this body EXCEPT 084 body) = 0 rows over all six columns including parent_known (349/349 ×14, 71, 240, 160).
--
-- READERS (seams): src/app/api/cron/universe-resume/route.ts:346 (every fire) · src/app/api/backfill/universe-drive/route.ts:118.
-- Both consume the row shape unchanged. No index is created or dropped; no table lock beyond the function catalog.
-- CHECK: scripts/check-rotation-buffers.mjs (check:data) EXPLAINs the call on Foam OH and fails above ROTATION_BUFFERS_CEILING.
--
-- ⛔ THERE IS NO STAGING DATABASE (LAW): this is proven where it is applied. CREATE OR REPLACE is the revert path.
-- REVERT: re-run `create or replace function public.universe_surface_rotation(uuid, text) …` with the 084 body:
--   select distinct on (l.resource, l.segment) l.resource, l.segment,
--          coalesce(l.parent_window_start, l.window_start), coalesce(l.parent_window_end, l.window_end),
--          l.recorded_at, (l.parent_window_start is not null and l.parent_window_end is not null)
--   from public.universe_attempt_log l
--   where l.client_id = p_client_id and l.vendor = p_vendor and l.phase = 'attempt_started'
--     and l.resource <> '__account_inception' and l.lane = 'descend'
--   order by l.resource, l.segment, l.recorded_at desc
-- (migrations/084_universe_attempt_lane.sql holds it verbatim; the grants below are unchanged either way).

set lock_timeout = '5s';

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
  with recursive keys as (
    (
      select l.resource, l.segment
      from public.universe_attempt_log l
      where l.client_id = p_client_id and l.vendor = p_vendor
        and l.lane = 'descend' and l.phase = 'attempt_started'
      order by l.resource, l.segment
      limit 1
    )
    union all
    (
      select n.resource, n.segment
      from keys k, lateral (
        select l.resource, l.segment
        from public.universe_attempt_log l
        where l.client_id = p_client_id and l.vendor = p_vendor
          and l.lane = 'descend' and l.phase = 'attempt_started'
          and (l.resource, l.segment) > (k.resource, k.segment)
        order by l.resource, l.segment
        limit 1
      ) n
    )
  )
  select k.resource,
         k.segment,
         coalesce(p.parent_window_start, p.window_start),
         coalesce(p.parent_window_end, p.window_end),
         p.recorded_at,
         (p.parent_window_start is not null and p.parent_window_end is not null)
  from keys k, lateral (
    -- the newest attempt_started row of THIS surface on the DESCEND lane — the same row 084's DISTINCT ON picked
    select l.window_start, l.window_end, l.parent_window_start, l.parent_window_end, l.recorded_at
    from public.universe_attempt_log l
    where l.client_id = p_client_id and l.vendor = p_vendor
      and l.lane = 'descend' and l.phase = 'attempt_started'
      and l.resource = k.resource and l.segment = k.segment
    order by l.recorded_at desc
    limit 1
  ) p
  where k.resource <> '__account_inception'
$$;

comment on function public.universe_surface_rotation(uuid, text) is
  'LORAMER_ROTATION_SKIP_SCAN_V1 (body; contract from LORAMER_TOP_EDGE_LANE_V1 / 084) — one row per (resource, segment): '
  'the last window the DESCENDING lane asked, and when. Recursive skip-scan over the distinct keys + one LATERAL '
  'newest-row probe per key, all through universe_attempt_log_rotation_lane_idx — ~5 pages per surface instead of a '
  'heap fetch per attempt row (34,898 buffers → 3,270 on Foam OH). parent_window_* preferred, RANGE bounds for legacy '
  'rows, parent_known says which. Output proven byte-equal to the 084 body on 17/17 clients before apply.';

-- grant posture unchanged (LORAMER_RPC_GRANT_POSTURE_V1): service_role only.
revoke all on function public.universe_surface_rotation(uuid, text) from public;
revoke all on function public.universe_surface_rotation(uuid, text) from anon;
revoke all on function public.universe_surface_rotation(uuid, text) from authenticated;
grant execute on function public.universe_surface_rotation(uuid, text) to service_role;
