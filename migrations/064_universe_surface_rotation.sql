-- LORAMER_RESUMER_SCAN_ROTATES_V1 — 064: the rotation index, as ONE grouped read.
--
-- ⛔ WHY AN RPC AND NOT A CLIENT-SIDE REDUCE, WITH THE ARITHMETIC THAT DECIDED IT. The resumer needs, per
-- (resource, segment): the LAST window it asked for, and WHEN it last asked. Reducing that in TypeScript
-- means fetching the rows. `universe_attempt_log` writes one `day_committed` row PER DAY COMMITTED, so at
-- Foam OH's full depth that table holds ~346 surfaces × 1,622 days ≈ 561,000 rows for ONE client — fetched
-- every fire, 24 times a day. Filtering to `attempt_started` bounds it to ~19,000, which is better and still
-- absurd. DISTINCT ON returns exactly ONE ROW PER SURFACE (≤346) and the index below makes it a range scan.
--
-- ⛔ WHAT THIS IS NOT, because `universe-resumer.guard.mjs` leg (a) is right to forbid it: this is NOT a
-- cursor and NOT a stored list of pending work. It reads the APPEND-ONLY attempt log for "what did we ask,
-- and when" — a fact about OUR actions. Owed-ness is still recomputed from `metrics_daily` by
-- `universe-coverage` every fire, for every candidate, and from nothing else. The same boundary
-- `universe-sizing.ts` already states in its header: the attempt log may answer what we asked and what came
-- back; ONLY the coverage module may answer whether a range is captured.
--
-- ⛔ `__account_inception` IS EXCLUDED BY NAME. It is a SYNTHETIC ledger key (writer :310) with a
-- 1970-01-01 window, not a catalog surface; letting it into the rotation would rank a pseudo-surface against
-- real ones and hand a 1970 window to the anchor derivation. `inception-stop.guard.mjs` leg (e) already pins
-- that key against colliding with a real surface — this is the same fact, enforced at the read.

create index if not exists universe_attempt_log_rotation_idx
  on public.universe_attempt_log (client_id, vendor, phase, resource, segment, recorded_at desc);

create or replace function public.universe_surface_rotation(
  p_client_id uuid,
  p_vendor text
)
returns table (
  resource text,
  segment text,
  last_window_start date,
  last_window_end date,
  last_attempt_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select distinct on (l.resource, l.segment)
         l.resource,
         l.segment,
         l.window_start,
         l.window_end,
         l.recorded_at
  from public.universe_attempt_log l
  where l.client_id = p_client_id
    and l.vendor = p_vendor
    and l.phase = 'attempt_started'
    and l.resource <> '__account_inception'
  order by l.resource, l.segment, l.recorded_at desc
$$;

comment on function public.universe_surface_rotation(uuid, text) is
  'LORAMER_RESUMER_SCAN_ROTATES_V1 — one row per (resource, segment): the last window ASKED and when. '
  'An ordering read over the append-only attempt log, never a cursor and never an owed list; coverage is '
  'still derived from metrics_daily by universe-coverage on every fire.';

-- ⛔ SAME POSTURE AS universe_disk_headroom (054b) and universe_lane_spend (057): RLS is deny-all except
-- service_role, so the function is revoked from public and granted only to the role the server uses.
revoke all on function public.universe_surface_rotation(uuid, text) from public;
grant execute on function public.universe_surface_rotation(uuid, text) to service_role;
