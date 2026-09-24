-- LORAMER_IDLE_SEED_RETRACTION_V1 (2026-09-24, round 45) — A WRONG ATTESTATION IS RETRACTED BY AN APPENDED ROW, NEVER BY
-- AN UPDATE, AND ONE VIEW OWNS "WHAT ATTESTS".
--
-- WHY. Between 2026-09-23 10:52Z (360-day windows, LORAMER_DESCEND_WINDOW_360_V1) and 2026-09-24 06:19Z the idle memo reused
-- __account_activity rows whose stored day list was CAPPED at 92 dates (universe-v2-worker.ts `slice(0, 92)`), so every month
-- after the 92nd named day read idle: 390 surface-windows on 20 account windows (Tri-Copy 19, Bath Fitter 1; 138,600
-- surface-days) were retired 'zero' on a false answer while the walk's own campaign rows inside them carry impressions.
-- The ledger is append-only (061 REVOKES update/delete) and every attestation reader was ANY-ROW, so a later row could not
-- un-attest a day. This migration adds the one outcome that can — 'retracted' — and the one view every attestation reader
-- reads from now on. Prior art: TigerBeetle voids a pending transfer by CREATING a new transfer, never modifying it;
-- Fowler's Retroactive Event keeps the rejected event in the log and every later reader ignores it.
--
-- (1) 'retracted' joins the outcome CHECK (081's list plus one). NOT VALID then VALIDATE — the 060 shape: the table keeps
--     accepting the walk's writes; VALIDATE takes SHARE UPDATE EXCLUSIVE and never blocks INSERT.
BEGIN;
ALTER TABLE public.universe_attempt_log DROP CONSTRAINT universe_attempt_log_outcome_ck;
ALTER TABLE public.universe_attempt_log ADD CONSTRAINT universe_attempt_log_outcome_ck
  CHECK (
    (phase = 'attempt_finished' AND outcome = ANY (ARRAY[
      'ok','zero','nongrain','skipped','error','quota_stop','floor_stop','abandoned_owed','retracted'
    ]))
    OR (phase <> 'attempt_finished' AND outcome IS NULL)
  ) NOT VALID;
ALTER TABLE public.universe_attempt_log VALIDATE CONSTRAINT universe_attempt_log_outcome_ck;

-- (2) THE ONE VIEW OF ATTESTING TERMINALS. A zero|nongrain terminal attests a day UNLESS a later 'retracted' row exists on
--     the SAME RANGE (client, vendor, resource, segment, window_start, window_end) with a higher attempt_no. The retraction
--     row is itself never a terminal any reader sees (outcome 'retracted' ∉ zero|nongrain) and carries message_key null, so
--     resolveTerminalLane never resolves it. Measured 2026-09-24 (round 44, EXPLAIN ANALYZE): the anti-join rides
--     universe_attempt_log_range_idx — Tri-Copy campaign 360-day read 4.2 ms → 5.2 ms; Bath Fitter 2.1 ms → 18.9 ms cold.
CREATE OR REPLACE VIEW public.universe_attesting_terminals
  WITH (security_invoker = on) AS
  SELECT l.*
    FROM public.universe_attempt_log l
   WHERE l.phase = 'attempt_finished'
     AND l.outcome IN ('zero', 'nongrain')
     AND NOT EXISTS (
       SELECT 1 FROM public.universe_attempt_log r
        WHERE r.client_id = l.client_id AND r.vendor = l.vendor AND r.resource = l.resource AND r.segment = l.segment
          AND r.window_start = l.window_start AND r.window_end = l.window_end
          AND r.phase = 'attempt_finished' AND r.outcome = 'retracted' AND r.attempt_no > l.attempt_no);
COMMENT ON VIEW public.universe_attesting_terminals IS
  'LORAMER_IDLE_SEED_RETRACTION_V1 — the ONLY source of vendor-attested empties (zero|nongrain terminals with no later retracted row on the same range). Every attestation reader reads this view; tests/guards/attesting-readers-use-the-view.guard.mjs pins it.';
GRANT SELECT ON public.universe_attesting_terminals TO anon, authenticated, service_role;
COMMIT;
