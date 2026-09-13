-- LORAMER_MISSED_FIRE_DURABILITY_V1 — migration 092: the missed lane's per-fire cursor facts ride the fire row.
--
-- WHY: missedCursorFrom / missedNextEntry / missedWrapped lived ONLY in the FIRE console line (Vercel, ~1 h retention)
-- and the response body nobody stores. Measured 2026-09-13: pending check (b′) — "the first live allowance-cut fire
-- followed by the next fire's missedCursorFrom equal to it" — could not be read for 136 of 144 fires because the hour
-- had passed; the first live cut then landed on Glenn Stearns (3111c7e1) at 18:15Z (cursor 0 → nextEntry 4 of 16) and
-- its resume read at the next rotation turn would have raced the same hour. The fire IS the unit and universe_fire_log
-- (migrations/068) already holds one row per fire, written by the one heartbeat in universe-resume/route.ts — three
-- scalars ride that row rather than a second table with a second writer and a join.
--
-- NULL MEANS "THE LANE DID NOT RUN" (refused: boundary or inception unknown; errored; a fire held before the lane —
-- lease-held, quota-hold, rotation-error). Never zero, never false, no default, and old rows are NOT backfilled: a fire
-- before this migration carries NULL honestly. The completed and meter-held heartbeats populate the three; the
-- enumeration and the durable cursor write (091) both happen BEFORE the meter gate, so a meter-held fire still records
-- where its enumeration reached.
--
-- READERS: tests/guards/missed-fire-durability.guard.mjs (α) reads the live columns through PostgREST; the (b′) pair
-- check reads consecutive rows per client: a row whose missed_next_entry < missed_cursor_from + MISSED_SURFACES_PER_RUN
-- is a cut, and the client's next row must carry missed_cursor_from = that missed_next_entry.
-- REVERT: alter table public.universe_fire_log drop column missed_cursor_from, drop column missed_next_entry,
--         drop column missed_wrapped;  (the heartbeat's insert would then fail on the unknown columns — revert the
--         route with it; fireHeartbeat is soft-fail by design and never kills a fire).

alter table public.universe_fire_log
  add column if not exists missed_cursor_from integer,
  add column if not exists missed_next_entry  integer,
  add column if not exists missed_wrapped     boolean;

comment on column public.universe_fire_log.missed_cursor_from is
  'LORAMER_MISSED_FIRE_DURABILITY_V1 — the catalogue entry index the missed lane''s enumeration STARTED from on this fire (the durable cursor as read, universe_missed_cursor). NULL = the lane did not enumerate on this fire.';
comment on column public.universe_fire_log.missed_next_entry is
  'LORAMER_MISSED_FIRE_DURABILITY_V1 — the first entry the enumeration did NOT reach (the enumerator''s own nextEntry): < missed_cursor_from + MISSED_SURFACES_PER_RUN is an allowance cut; NULL with missed_wrapped = true is the catalogue end; NULL with missed_wrapped NULL = the lane did not run.';
comment on column public.universe_fire_log.missed_wrapped is
  'LORAMER_MISSED_FIRE_DURABILITY_V1 — true when this fire''s enumeration reached the catalogue end and the cursor wrapped to 0 (sweep + 1). NULL = the lane did not run.';
