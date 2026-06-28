-- LORAMER_SELFSERVE_PRIORITY_LANE_V1 (build step 1 — ORDERING-ONLY)
-- Adds a backfill_priority column to platform_connections so the drain can run NEW-CLIENT backfills ahead of
-- steady-state background history-fill. This is an ADDITIVE column ONLY. It does NOT touch claim_backfill_cursor
-- (migration 014) or any lock/lease logic — the single-owner claim + 360s lease are byte-identical. Priority
-- affects ONLY which UNCLAIMED connection the drain tries first (sort order); the lock still guards every actual
-- claim, so this cannot introduce a double-claim.
--
-- Semantics: 0 = normal/background (default, every existing connection). 10 = HIGH (a just-connected client,
-- set on the OAuth callback in build step 2). The drain decays HIGH → 0 when the connection is fully onboarded
-- (onboard_steps_done ⊇ requiredSteps), written in the existing onboard_steps_done update.
--
-- Run manually in the Supabase SQL Editor. Safe + reversible (rollback: ALTER TABLE platform_connections DROP
-- COLUMN backfill_priority;). Deploy ORDER: apply this migration BEFORE (or with) the drain code that selects the
-- column, so the SELECT does not reference a missing column.

ALTER TABLE public.platform_connections
  ADD COLUMN IF NOT EXISTS backfill_priority smallint NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.platform_connections.backfill_priority IS
  'Drain ordering only (LORAMER_SELFSERVE_PRIORITY_LANE_V1): 0=normal/background, 10=new-client HIGH. Affects drain sort order, NOT the claim/lease lock. Set HIGH on connect; decayed to 0 when onboard complete.';
