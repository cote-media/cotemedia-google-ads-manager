-- 081_universe_attempt_outcome_nongrain.sql
-- LORAMER_NONGRAIN_ATTESTS_V1 — THE DATABASE HALF OF THE OUTCOME WIDENING.
-- APPLIED LIVE 2026-08-17 via the Supabase MCP, read back from pg_constraint before this file was written.
--
-- ⛔ WHY THIS EXISTS AND IT IS NOT A TIDY-UP: aadec18 widened the TypeScript `AttemptOutcome` union to admit
-- 'nongrain' and NEVER WIDENED THIS CHECK. Postgres rejected every nongrain write with 23514, the consumer's
-- `appendAttemptFinished` threw, and the pass recorded outcome='error' instead — so the fix was INERT and it
-- DEGRADED the record on every pass over the 14 affected surfaces. Two windows had already taken it before it
-- was caught (campaign / segments.travel_destination_city, 2026-03-12 and 2026-03-19..20, both attempt_no 5).
--
-- ⛔ AND THE PART THAT MATTERS FOR EVERY FUTURE CHANGE: `npm run build`, 124/124 guards AND a full check:data
-- were ALL GREEN throughout, because none of them writes a nongrain row. Only production could see it, and it
-- saw it in 21 minutes. That is LORAMER_SEAMS_PROOF_V1 exactly — a value another system already constrains,
-- changed without walking that reader. The enforcer is `db-enum-mirrors-ts.guard.mjs`, shipped alongside.
--
-- 'nongrain' MEANS: the vendor answered and NOTHING it returned was a grain at this surface — the segment does
-- not apply here, or every metric was zero. It ATTESTS like 'zero' (universe-coverage reads
-- .in('outcome', ['zero','nongrain'])) and READS APART from it, which is the distinction that made the class
-- findable at all. ⛔ It is NOT 'skipped': that is US declining to ask, and it must never attest.
--
-- SAFE BY CONSTRUCTION: widening a CHECK cannot fail on stored rows, so there is no backfill and no data risk.
-- REVERT (there is no staging database — banked law; this is the only revert there is):
--   BEGIN;
--   ALTER TABLE universe_attempt_log DROP CONSTRAINT universe_attempt_log_outcome_ck;
--   ALTER TABLE universe_attempt_log ADD CONSTRAINT universe_attempt_log_outcome_ck
--     CHECK ((phase = 'attempt_finished' AND outcome = ANY (ARRAY[
--       'ok','zero','skipped','error','quota_stop','floor_stop','abandoned_owed'
--     ])) OR (phase <> 'attempt_finished' AND outcome IS NULL));
--   COMMIT;
--   ⚠ A revert would fail if any 'nongrain' row exists by then — delete or re-classify those first.

BEGIN;
ALTER TABLE universe_attempt_log DROP CONSTRAINT universe_attempt_log_outcome_ck;
ALTER TABLE universe_attempt_log ADD CONSTRAINT universe_attempt_log_outcome_ck
  CHECK (
    (phase = 'attempt_finished' AND outcome = ANY (ARRAY[
      'ok','zero','nongrain','skipped','error','quota_stop','floor_stop','abandoned_owed'
    ]))
    OR (phase <> 'attempt_finished' AND outcome IS NULL)
  );
COMMIT;
