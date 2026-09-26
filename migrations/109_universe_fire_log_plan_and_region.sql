-- 109_universe_fire_log_plan_and_region.sql — LORAMER_PLAN_PHASE_REGION_INDEX_V1
--
-- ⛔ THE FIRE ROW SAYS WHERE IT RAN AND HOW LONG IT PLANNED. Rounds 352–353 of 2026-09-26 had to reconstruct a fire's
-- plan time from attempt-row timestamps and read its region off a deployment manifest: the scan time lived only in the
-- FIRE console line (scanMs, gone in an hour) and the region nowhere. The region is what separated "slow reads" from
-- "reads across the country" — the pressed Backfill ran in iad1 against a us-west-2 database.
--
--   plan_ms  — fire start → end of planning (captureStartedAt − startedAt, the instrument's scanMs). NULL on exits that
--              never planned (lease-held, quota-hold, rotation-error) and on rows written before this migration.
--   region   — process.env.VERCEL_REGION at runtime (Vercel system env, "the ID of the Region where the app is
--              running"). NULL off-Vercel and on rows written before this migration.
-- Nullable, no default: NULL means "not measured", never a value (the migrations/092 convention).
--
-- REVERT: ALTER TABLE public.universe_fire_log DROP COLUMN plan_ms, DROP COLUMN region;
alter table public.universe_fire_log add column if not exists plan_ms integer;
alter table public.universe_fire_log add column if not exists region text;
