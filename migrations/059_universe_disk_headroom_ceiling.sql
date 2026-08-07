-- LORAMER_UNIVERSE_DISK_CEILING_V1 — the walk's disk governor, REWRITTEN FROM THE CALLER'S CONTRACT,
-- and COMMITTED TO THE REPO for the first time.
--
-- ⛔ WHY THIS FILE EXISTS AT ALL — ★UNIVERSE-HEADROOM-BODY-NEVER-COMMITTED, CLOSED HERE.
-- `universe_disk_headroom()` is the ONLY thing standing between an unattended multi-day walk and a full
-- disk, and until this migration its body existed NOWHERE except inside the live database. It was created
-- out-of-band (054b, referenced by the caller's own error string, never written down), then overwritten on
-- 2026-08-05 by a bare `raise exception` to halt the walk. The halt message asserted the original body had
-- been "captured verbatim … from pg_get_functiondef before the halt". IT HAD NOT BEEN — migrations/,
-- scripts/, src/ and docs/ were searched and none of them contain it. So this is a REWRITE from the
-- caller's contract, not a re-apply, and it is labelled as one.
--
-- ⛔ THE CALLER'S CONTRACT, QUOTED FROM src/lib/backfill/universe-window-log.ts SO A FUTURE REWRITE HAS A
-- SOURCE (readHeadroom, :36-53):
--     supabaseAdmin.rpc('universe_disk_headroom', { provisioned_bytes: PROVISIONED_BYTES })
--     const usedBytes = Number(row?.used_bytes); const freeBytes = Number(row?.free_bytes)
--     if (!Number.isFinite(usedBytes) || !Number.isFinite(freeBytes) || usedBytes <= 0) throw
--   ⇒ name `universe_disk_headroom`, ONE bigint arg named `provisioned_bytes`, returning columns named
--     EXACTLY `used_bytes` and `free_bytes`; `used_bytes` MUST be > 0 or the caller refuses to walk.
--
-- ⛔ IT DOES NOT RAISE, AND THAT IS THE DESIGN RATHER THAN A SOFTENING. A RAISE ABORTS THE TRANSACTION, SO
-- ANY ROW THIS FUNCTION INSERTED TO ANNOUNCE ITS OWN HALT WOULD BE ROLLED BACK BY THE VERY RAISE THAT
-- ANNOUNCED IT — insert-then-raise records nothing. Returning a `free_bytes` below the caller's floor makes
-- the EXISTING, already-durable stop path fire instead: checkDiskFloor() returns ok:false, and the queue
-- consumer writes openWindow(...) + closeWindow(..., outcome:'floor_stop', error:<reason>) into
-- universe_window_log before exiting (src/app/api/queues/google-ads-universe/route.ts:155-159). A halt is
-- therefore a ROW, never a silence, which is what makes it distinguishable from a stall.
-- ⚠ THE ONE THING THAT ROW DOES NOT CARRY, stated rather than glossed: it does not LABEL which of the two
-- ceilings bound, because the caller builds its reason string from the two bigints alone and src/ was out
-- of scope for this flight. It is derivable — free_bytes = provisioned − used means the provisioned floor
-- bound, free_bytes = 500 GB − used means the ceiling did — but it is derived, not stated.
--
-- ⛔ WHICH LIMIT ACTUALLY BINDS, ON THE FACE OF THE FUNCTION, BECAUSE A CEILING THAT CANNOT TRIP READS
-- GREEN FOREVER AND THAT IS THE SHAPE OF THE 2026-08-05 DEFECT (a page-capped counter presented as a
-- limit):
--   · BINDING TODAY — the CALLER's floor. PROVISIONED_BYTES = 280 GiB (a STATED constant; Postgres cannot
--     see provisioned disk) and FLOOR_BYTES = max(15 GiB, 20% of provisioned) = 56 GiB, so the walk stops
--     at ~224 GiB used. THIS IS THE LIMIT THAT WILL FIRE.
--   · OUTER AUTHORIZATION — 536870912000 bytes (500 GiB), ABSOLUTE, approved by Russ 2026-08-07 as the
--     ceiling for a continuous run. It is deliberately NOT a percentage: provisioned disk is not readable
--     from Postgres, so any percentage here would be computed against a number this function cannot see.
--     ⛔ AT TODAY'S 280 GiB PROVISIONED THIS CEILING CANNOT TRIP — the caller stops 276 GiB earlier. It
--     becomes the binding limit only if PROVISIONED_BYTES is raised above 500 GiB, and it is recorded now
--     so that raise cannot silently authorise an unbounded walk.
--   · `least(...)` IS "WHICHEVER COMES FIRST" WITH NO BRANCH TO GET WRONG. Both terms are always computed
--     and the smaller wins, so neither ceiling can be bypassed by editing the other.
--
-- ⚠ NEGATIVE `free_bytes` IS DELIBERATE AND MUST NOT BE CLAMPED TO ZERO. If the disk is already past a
-- ceiling the honest answer is how far past; clamping would report "0 free" for both a disk exactly at the
-- limit and one 40 GB beyond it. The caller's test is `freeBytes < FLOOR_BYTES`, which is satisfied either
-- way, so the clamp buys nothing and costs the magnitude.
--
-- MEASURED, SO THE NEXT READER DOES NOT RE-DERIVE IT (2026-08-07, from universe_window_log.disk_free_bytes
-- across the 08-04→08-05 run): 54.36 GB consumed over 13,239 windows = ~3.9 MB/window, ~1,067 bytes/row.
-- ⛔ THE PREVIOUSLY BANKED "~1.67 GB/window" WAS A PROJECTION AND IS WRONG BY ~430×. 136 entries and ~4,509
-- windows remain ⇒ ~17.6 GB projected, against ~63 GiB of headroom before the caller's floor.
--
-- REVERT PATH: `create or replace` with the prior body. Nothing is written by this function, no table is
-- touched, and no data can be lost by applying or reverting it.

create or replace function public.universe_disk_headroom(provisioned_bytes bigint)
returns table(used_bytes bigint, free_bytes bigint)
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $function$
declare
  -- LORAMER_UNIVERSE_DISK_CEILING_V1 — 500 GiB, ABSOLUTE BYTES, NEVER A PERCENTAGE. See the header for why
  -- a percentage is not expressible here and why this is the OUTER authorization, not the binding limit.
  v_ceiling_bytes constant bigint := 536870912000;
  v_used bigint;
begin
  v_used := pg_database_size(current_database());
  return query
    select v_used,
           -- WHICHEVER COMES FIRST: the caller's provisioned headroom, or the absolute 500 GiB ceiling.
           least(provisioned_bytes - v_used, v_ceiling_bytes - v_used)::bigint;
end;
$function$;

comment on function public.universe_disk_headroom(bigint) is
  'LORAMER_UNIVERSE_DISK_CEILING_V1 — real disk headroom for the universe walk. used_bytes = pg_database_size. free_bytes = least(provisioned - used, 536870912000 - used): the caller''s 280 GiB/56 GiB floor is the BINDING limit today, the 500 GiB absolute ceiling is the outer authorization and cannot trip until provisioned disk exceeds it. Never raises — a value below the caller''s floor makes checkDiskFloor() write a durable floor_stop row instead, because a raise would roll back its own announcement.';

-- ⛔ SAME POSTURE AS 057: the walk's tables are RLS deny-all except service_role, and nothing in a browser
-- has any business reading database size.
revoke all on function public.universe_disk_headroom(bigint) from public;
