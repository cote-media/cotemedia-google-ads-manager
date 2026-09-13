-- LORAMER_MISSED_DAY_WALK_V1 — migration 090: the FOURTH lane value, 'missed'.
--
-- ⛔ ALTERS THE CONSTRAINT 084 CREATED AND 088 WIDENED (universe_attempt_log_lane_chk: 'descend','top-edge' in 084;
-- + 'lookback' in 088). Same shape as 088 — additive only, lock_timeout, ADD … NOT VALID then VALIDATE, uppercase
-- ARRAY[ so tests/guards/db-enum-mirrors-ts.guard.mjs reads the values from THIS file (the last migration that ADDs
-- the constraint wins). universe_attempt_open(p_lane text) is UNCHANGED — p_lane is text, coalesced to 'descend'
-- (084:127-131), so the RPC passes 'missed' through untouched.
-- REVERT = re-add the three-value CHECK (valid only while no 'missed' row exists):
--   alter table public.universe_attempt_log drop constraint universe_attempt_log_lane_chk;
--   alter table public.universe_attempt_log add constraint universe_attempt_log_lane_chk
--     check (lane = ANY (ARRAY['descend'::text, 'top-edge'::text, 'lookback'::text]));
-- ORDER OF OPERATIONS: apply 090 BEFORE the code that can write 'missed' deploys (applied via the Supabase MCP
-- apply_migration in the same round, before the push — DECISIONS LORAMER_MISSED_DAY_WALK_V1).
-- WHY A FOURTH VALUE AND NOT 'lookback' REUSED: the route's lookback frontier read keys lane='lookback' max window_end
-- per surface; a hole window below the descent's top would become that frontier and starve the strip.

set lock_timeout = '5s';

alter table public.universe_attempt_log
  drop constraint if exists universe_attempt_log_lane_chk;

alter table public.universe_attempt_log
  add constraint universe_attempt_log_lane_chk
  check (lane = ANY (ARRAY['descend'::text, 'top-edge'::text, 'lookback'::text, 'missed'::text])) not valid;

alter table public.universe_attempt_log
  validate constraint universe_attempt_log_lane_chk;

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
    raise exception '090: universe_attempt_log_lane_chk is missing after ADD';
  end if;
  if def not like '%''descend''%' or def not like '%''top-edge''%' or def not like '%''lookback''%' or def not like '%''missed''%' then
    raise exception '090: universe_attempt_log_lane_chk does not carry all four lanes: %', def;
  end if;
  if not ok then
    raise exception '090: universe_attempt_log_lane_chk is NOT VALID after VALIDATE: %', def;
  end if;
  raise notice '090 OK — universe_attempt_log_lane_chk = %', def;
end $$;

reset lock_timeout;
