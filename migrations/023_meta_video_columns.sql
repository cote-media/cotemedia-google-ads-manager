-- LORAMER_META_VIDEO_CAPTURE_V1 (T1.4) — migration 023
-- Layer-1 dedicated VIDEO metric columns on metrics_daily (Russ-approved storage model: high-value
-- query/ranking axes get columns, not jsonb). Each is NULLABLE numeric — NULL on every non-video row;
-- populated ONLY on breakdown_type='video' rows written by runMetaVideoBackfill (meta-video-backfill.ts).
--
-- SAFETY: adding a NULLABLE column with NO default is a metadata-only change in Postgres (no table rewrite,
-- no row-by-row update, no long lock) — safe on the live metrics_daily even at ~1.5M+ rows. Idempotent via
-- IF NOT EXISTS. Run in the Supabase SQL Editor (NOT auto-run by the app).
--
-- Column ← Meta insights field (all return as arrays [{action_type:'video_view', value}] → Σ.value):
--   video_plays        ← video_play_actions
--   video_thruplays    ← video_thruplay_watched_actions
--   video_p25..p100    ← video_p25/p50/p75/p95/p100_watched_actions
--   video_30s          ← video_30_sec_watched_actions
--   video_avg_time_sec ← video_avg_time_watched_actions   (seconds)
--   cost_per_thruplay  ← cost_per_thruplay                (currency)

ALTER TABLE metrics_daily
  ADD COLUMN IF NOT EXISTS video_plays         numeric,
  ADD COLUMN IF NOT EXISTS video_thruplays     numeric,
  ADD COLUMN IF NOT EXISTS video_p25           numeric,
  ADD COLUMN IF NOT EXISTS video_p50           numeric,
  ADD COLUMN IF NOT EXISTS video_p75           numeric,
  ADD COLUMN IF NOT EXISTS video_p95           numeric,
  ADD COLUMN IF NOT EXISTS video_p100          numeric,
  ADD COLUMN IF NOT EXISTS video_30s           numeric,
  ADD COLUMN IF NOT EXISTS video_avg_time_sec  numeric,
  ADD COLUMN IF NOT EXISTS cost_per_thruplay   numeric;
