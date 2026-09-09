-- LORAMER_LOOKBACK_LANE_V1 — migration 088: the THIRD lane value, 'lookback'.
--
-- ⛔ ALTERS THE CONSTRAINT 084 CREATED (migrations/084_universe_attempt_lane.sql:56-57 added
-- universe_attempt_log_lane_chk with two values, 'descend' and 'top-edge'). 088 is THIS commit's number; the
-- "084" in the 2026-09-05 docs named the constraint's ORIGIN, not a free slot (corrected 2026-09-08).
-- REVERT = re-add the two-value CHECK (valid only while no 'lookback' row exists — the lookback slot ships
-- OBSERVE-ONLY, so none does until STOP-and-confirm 2 flips it):
--   alter table public.universe_attempt_log drop constraint universe_attempt_log_lane_chk;
--   alter table public.universe_attempt_log add constraint universe_attempt_log_lane_chk
--     check (lane = ANY (ARRAY['descend'::text, 'top-edge'::text]));
--
-- WHY THIS SHAPE (QUEUE ★LOOKBACK-LANE-OWNS-PROMOTION (3); DECISIONS LORAMER_SESSION_2026_09_05_RULINGS (c)(j)):
--   · `set lock_timeout = '5s'` — DROP/ADD CONSTRAINT take ACCESS EXCLUSIVE on the table for an instant. A long
--     holder (a walk fire mid-insert, a catchup pass) would otherwise queue this statement AND every insert behind
--     it. With the timeout the migration ABORTS instead of queueing — re-run it. Worst case for a live writer: one
--     insert waits ≤ 5 s. (PostgreSQL explicit-locking docs: ALTER TABLE … ADD CONSTRAINT acquires ACCESS EXCLUSIVE;
--     VALIDATE CONSTRAINT acquires SHARE UPDATE EXCLUSIVE only.)
--   · `ADD … NOT VALID` — the constraint binds NEW rows immediately; existing rows are not scanned under the lock.
--   · `VALIDATE CONSTRAINT` — SHARE UPDATE EXCLUSIVE; inserts proceed; the ~157k-row scan takes tens of ms.
--   · uppercase `ARRAY[` — tests/guards/db-enum-mirrors-ts.guard.mjs reads this constraint's values from the LAST
--     migration that ADDs it, with /ARRAY\s*\[([^\]]*)\]/; a lowercase array[ is invisible to it (084:49-59).
--   · universe_attempt_open(p_lane text) is UNCHANGED — p_lane is text, coalesced to 'descend' (084:127-131), so the
--     RPC passes 'lookback' through untouched.
-- ORDER OF OPERATIONS (the 2026-09-08 adversary collision): apply 088 BEFORE the code that can write 'lookback'
-- deploys, so no writer can ever meet the two-value CHECK. Applied by hand in the Supabase SQL Editor;
-- STOP-and-confirm 1 sits in front of it. There is no staging database; CREATE OR REPLACE / the revert above is
-- the rollback path.

set lock_timeout = '5s';

alter table public.universe_attempt_log
  drop constraint if exists universe_attempt_log_lane_chk;

alter table public.universe_attempt_log
  add constraint universe_attempt_log_lane_chk
  check (lane = ANY (ARRAY['descend'::text, 'top-edge'::text, 'lookback'::text])) not valid;

alter table public.universe_attempt_log
  validate constraint universe_attempt_log_lane_chk;

-- CATALOG ASSERTION — all three values present, constraint validated. Raises (and rolls the migration back in
-- the SQL Editor's single transaction) rather than reporting a green that is not one.
do $$
declare
  def text;
  ok boolean;
begin
  select pg_get_constraintdef(c.oid), c.convalidated
    into def, ok
    from pg_constraint c
   where c.conrelid = 'public.universe_attempt_log'::regclass
     and c.conname = 'universe_attempt_log_lane_chk';
  if def is null then
    raise exception '088: universe_attempt_log_lane_chk is missing after ADD';
  end if;
  if def not like '%''descend''%' or def not like '%''top-edge''%' or def not like '%''lookback''%' then
    raise exception '088: universe_attempt_log_lane_chk does not carry all three lanes: %', def;
  end if;
  if not ok then
    raise exception '088: universe_attempt_log_lane_chk is NOT VALID after VALIDATE: %', def;
  end if;
  raise notice '088 OK — universe_attempt_log_lane_chk = %', def;
end $$;

reset lock_timeout;
