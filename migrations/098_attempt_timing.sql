-- 098_attempt_timing.sql — LORAMER_ATTEMPT_TIMING_V1
--
-- ⛔ WHAT THIS IS: three nullable timing columns on the attempt ledger's finished row, so a request's wall time can be
-- split into the vendor's share and ours. Round 3 (2026-09-18) could not say whether Google or the write path
-- dominated a heavy request — "NOT INSTRUMENTED: the ledger holds attempt start/finish only" — and round 4's
-- reservation predictor needs seconds-per-day per surface without a second read.
--   stream_ms   — milliseconds spent awaiting the vendor's iterator (pulls), summed over the attempt
--   upsert_ms   — milliseconds spent awaiting metrics_daily upserts (flush-per-day), summed over the attempt
--   duration_ms — wall time from attempt open to attempt close (the range's whole life), the number the
--                 per-surface reservation (LORAMER_UNIT_RESERVE_PER_SURFACE_V1) reads
--
-- ⛔ ADDITIVE, NULLABLE, NO CHECK CONSTRAINT — a row written by an older invocation (or by a path that does not
-- capture, e.g. floor_stop / skipped) carries NULL, and every reader treats NULL as "not measured", never as 0.
--
-- ⛔ ONE-TIME BACKFILL OF duration_ms FOR HISTORY: finished rows of the last 30 days get their duration from
-- their own started row (same client/vendor/resource/segment/window/attempt_no), so the reservation predictor
-- has a history on its first night rather than reserving the bare floor for every surface. stream_ms/upsert_ms
-- cannot be reconstructed and stay NULL for history.
--
-- READERS: universe-sizing.ts (seconds-per-day for the reservation), scripts (analysis). WRITER: universe-attempt-log.ts
-- appendAttemptFinished (values from universe-stream-capture.ts via universe-v2-worker.ts).
-- REVERT: ALTER TABLE public.universe_attempt_log DROP COLUMN stream_ms, DROP COLUMN upsert_ms, DROP COLUMN duration_ms;
-- ⛔ THERE IS NO STAGING DATABASE. This can only be proven where it is applied.

ALTER TABLE public.universe_attempt_log
  ADD COLUMN IF NOT EXISTS stream_ms   integer,
  ADD COLUMN IF NOT EXISTS upsert_ms   integer,
  ADD COLUMN IF NOT EXISTS duration_ms integer;

COMMENT ON COLUMN public.universe_attempt_log.stream_ms   IS 'LORAMER_ATTEMPT_TIMING_V1 — ms awaiting the vendor iterator over this attempt; NULL = not measured';
COMMENT ON COLUMN public.universe_attempt_log.upsert_ms   IS 'LORAMER_ATTEMPT_TIMING_V1 — ms awaiting metrics_daily upserts over this attempt; NULL = not measured';
COMMENT ON COLUMN public.universe_attempt_log.duration_ms IS 'LORAMER_ATTEMPT_TIMING_V1 — ms from attempt open to close; NULL = not measured (history before 2026-08-19)';

-- One-time backfill: the last 30 days of finished rows, from their own started rows.
UPDATE public.universe_attempt_log f
SET duration_ms = GREATEST(0, LEAST(2147483647, (EXTRACT(EPOCH FROM (f.recorded_at - s.recorded_at)) * 1000)::bigint))::integer
FROM public.universe_attempt_log s
WHERE f.phase = 'attempt_finished'
  AND f.duration_ms IS NULL
  AND f.recorded_at > now() - interval '30 days'
  AND s.phase = 'attempt_started'
  AND s.client_id = f.client_id AND s.vendor = f.vendor AND s.resource = f.resource AND s.segment = f.segment
  AND s.window_start = f.window_start AND s.window_end = f.window_end AND s.attempt_no = f.attempt_no
  AND s.recorded_at <= f.recorded_at
  AND s.recorded_at > now() - interval '31 days';
