-- LORAMER_MULTIACCOUNT_PHASE1_V1
-- Migration 005: add nullable account_id to metrics_daily + one-time backfill
-- Run via Supabase SQL Editor. Safe to re-run (idempotent).
--
-- Phase 1 of multi-account-per-client. Adds the account dimension WITHOUT
-- touching the unique/conflict index — forward capture and backfill keep
-- writing byte-identical rows on the existing conflict key. App code does
-- not read or write this column yet (that is Phase 2).
--
-- Why now: every client is still strictly ONE account per platform
-- (platform_connections has UNIQUE (client_id, platform)), so the mapping
-- from existing rows to their account is unambiguous. Verified 2026-06-05
-- against live data:
--   - all 19,404 metrics_daily rows join to exactly one connection
--     (zero orphans on (client_id, platform))
--   - every account-level row's entity_id equals its connection's
--     account_id on ALL FIVE platforms (google, meta, ga, shopify, woo)
-- So platform_connections.account_id is the single uniform source for
-- every platform — google/meta customer/account ids, ga property id,
-- shopify shop domain, woocommerce store. No per-platform special cases.

-- ---------------------------------------------------------------------------
-- 1) Add the column (nullable, no default; conflict key NOT altered)
-- ---------------------------------------------------------------------------

ALTER TABLE metrics_daily
  ADD COLUMN IF NOT EXISTS account_id TEXT;

COMMENT ON COLUMN metrics_daily.account_id IS
  'Platform account this row belongs to (google/meta account id, ga property id, shopify shop domain, woo store). Nullable in Phase 1; writers populate it from Phase 2. NOT part of the upsert conflict key yet.';

-- ---------------------------------------------------------------------------
-- 2) Backfill from platform_connections (all 5 platforms, one statement)
--    Idempotent: only touches rows still NULL, so it can be re-run any time
--    (e.g. to pick up rows the cron wrote after this migration but before
--    Phase 2 teaches the writers to populate the column).
-- ---------------------------------------------------------------------------

UPDATE metrics_daily m
SET account_id = pc.account_id
FROM platform_connections pc
WHERE pc.client_id = m.client_id
  AND pc.platform  = m.platform
  AND m.account_id IS NULL;

-- ---------------------------------------------------------------------------
-- 3) Verification (read-only; run after the UPDATE)
-- ---------------------------------------------------------------------------

-- 3a. Total rows (baseline 2026-06-05 was 19,404; will be higher after
--     nightly cron runs — that is expected).
SELECT count(*) AS total_rows FROM metrics_daily;

-- 3b. Rows still NULL by platform. Expected: 0 everywhere immediately after
--     running. Rows written later by cron/backfill will be NULL until
--     Phase 2 — re-running step 2 clears them.
SELECT platform,
       count(*)                                  AS rows,
       count(*) FILTER (WHERE account_id IS NULL) AS still_null
FROM metrics_daily
GROUP BY platform
ORDER BY platform;

-- 3c. No (client_id, platform) maps to more than one account_id.
--     MUST return zero rows today (single-account world).
SELECT client_id, platform,
       count(DISTINCT account_id) AS distinct_accounts
FROM metrics_daily
WHERE account_id IS NOT NULL
GROUP BY client_id, platform
HAVING count(DISTINCT account_id) > 1;

-- 3d. Cross-check: at entity_level='account', account_id must equal
--     entity_id (they are the same identifier today).
--     MUST return zero rows.
SELECT platform, count(*) AS mismatches
FROM metrics_daily
WHERE entity_level = 'account'
  AND account_id IS NOT NULL
  AND account_id <> entity_id
GROUP BY platform;
