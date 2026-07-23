-- ⛔⛔⛔ DO NOT APPLY. INCOMPLETE. ⛔⛔⛔
-- Flight 1 Part 2 (the WRITER FAN-OUT) is NOT built. Applying this migration WITHOUT that code sets
-- sync_state.account_id NOT NULL and swaps the sync_state + platform_connections uniques to 3 columns while all 10
-- sync_state upsert sites still use a 2-COLUMN `onConflict: 'client_id,platform'`. PostgREST requires the onConflict
-- to match a unique constraint EXACTLY, so EVERY sync_state write on EVERY platform (cron + backfill, all 5) fails
-- immediately → ALL CAPTURE STOPS FLEET-WIDE. Do not run this until the writer fan-out lands.
-- TRACKED AS: META-MULTIACCOUNT-FLIGHT1-PART2 (LORAMER_QUEUE_OF_RECORD.md). Apply ONLY back-to-back with that code.
--
-- LORAMER_MULTIACCOUNT_FLIGHT1_V1
-- Migration 043: allow MULTIPLE ad accounts per (client, platform) at the CONNECTION + CURSOR layer.
-- Widens platform_connections + sync_state uniqueness to include account_id.
-- ⛔ AUTHORED, NOT APPLIED. Run manually in the Supabase SQL Editor, back-to-back with the code commit.
--
-- ── DEVIATION FROM docs/scoping/multi-account-phase2.md (cited) ─────────────────────────────────────────────
-- phase2.md sequences the metrics_daily CONFLICT-KEY widening (its Phase 2c: drop the 7-field key, add an 8-field
-- key incl. account_id) FIRST, and defers platform_connections + sync_state to "Phase 3+, AFTER the storage layer
-- is proven under the widened key" (§6). THIS FLIGHT does platform_connections + sync_state WITHOUT touching the
-- metrics_daily conflict key, confined to META ONLY (code gate: src/app/api/clients/connections/route.ts).
-- WHY THAT IS SAFE — and why it sidesteps phase2.md's §5.1 NULL-in-unique hazard entirely:
--   Meta campaign/ad_set/ad entity_ids are GLOBALLY UNIQUE, and account-grain rows carry entity_id == the account
--   id. So two Meta accounts under one client already write NON-COLLIDING metrics_daily rows under the EXISTING
--   7-field key (every row's entity_id differs). The metrics_daily key only needs account_id when two accounts
--   could SHARE an entity_id — that is the UNSETTLED Google question, which the Meta-only gate keeps out. We
--   therefore do NOT add account_id to the metrics_daily key at all here, so §5.1's "silent duplicate rows" hazard
--   cannot occur. When Google's collision question is settled, THAT widening ships per phase2.md, unchanged.
--
-- ── ORDERING RULE (phase2.md §4) ───────────────────────────────────────────────────────────────────────────
-- Every unique change is ADD-then-DROP — never a window where NEITHER exists (a gap would let a duplicate through).
-- Each ALTER is its own statement; a failure stops before the matching drop.

-- ═══ PART 1 — platform_connections: (client_id, platform) → (client_id, platform, account_id) ═══════════════
-- account_id is already NOT NULL here (verified live), so there is no NULL-in-unique hazard on this table.

-- 1a. ADD the wider unique FIRST. The old key (client_id, platform) is a STRICTER subset, so no current row can
--     violate the wider key — the ADD cannot fail on today's data (every pair is already unique on 2 cols).
ALTER TABLE platform_connections
  ADD CONSTRAINT platform_connections_client_platform_account_unique
  UNIQUE (client_id, platform, account_id);

-- 1b. DROP the old 2-column unique — only AFTER the wider one exists.
ALTER TABLE platform_connections
  DROP CONSTRAINT platform_connections_client_platform_unique;

-- ═══ PART 2 — sync_state: add account_id, backfill it, then swap the unique ═════════════════════════════════
-- NOTE: sync_state.platform holds CURSOR KEYS, not bare platform names — e.g. 'meta', 'meta_campaign',
--   'meta_adset_ad', 'meta_device', 'google_adgroup_ad', 'shopify_deep', 'woo', 'ga_dimensional'. The backfill maps
--   each cursor key to its BASE platform to find the connection's account_id.

-- 2a. Add the column (nullable during backfill; locked NOT NULL in 2d).
ALTER TABLE sync_state ADD COLUMN IF NOT EXISTS account_id text;

-- 2b. Backfill from platform_connections. Map the cursor-key namespace → base platform. Every cursor for a client
--     resolves to that client's single connection of the mapped platform (all clients are 1-account TODAY).
UPDATE sync_state s
SET account_id = pc.account_id
FROM platform_connections pc
WHERE pc.client_id = s.client_id
  AND pc.platform = CASE
        WHEN s.platform LIKE 'meta%'    THEN 'meta'
        WHEN s.platform LIKE 'google%'  THEN 'google'
        WHEN s.platform LIKE 'shopify%' THEN 'shopify'
        WHEN s.platform LIKE 'woo%'     THEN 'woocommerce'
        WHEN s.platform LIKE 'ga%'      THEN 'ga'
        ELSE s.platform
      END
  AND s.account_id IS NULL;

-- 2c. UNRESOLVABLE ROWS — never left silently NULL (phase2.md §5.1: NULL is DISTINCT in a unique index → a future
--     duplicate). An unresolved row is an ORPHAN cursor: its (client, base-platform) has no live connection (the
--     platform was disconnected — DELETE removes platform_connections but keeps sync_state so a reconnect resumes).
--     Stamp them with a LOUD sentinel so they are visible, 2d succeeds, and the new unique stays satisfiable.
--     Verification 3 below reports them; an operator decides whether to purge orphan cursors.
UPDATE sync_state
SET account_id = '__ORPHAN_NO_CONNECTION__'
WHERE account_id IS NULL;

-- 2d. LOCK IT — now that no row is NULL, forbid a future writer from silently reintroducing the hazard. This is the
--     structural defense (phase2.md §5.1 applied to sync_state): it makes a writer that forgets account_id fail
--     LOUD (insert rejected) instead of silently writing a NULL that a later widen would duplicate.
--     ⚠ CONSEQUENCE (intended): every sync_state upsert MUST now populate account_id AND use the 3-column onConflict
--       — the code commit that ships with this migration updates all 10 write sites (see SYNC_STATE_CONFLICT).
ALTER TABLE sync_state ALTER COLUMN account_id SET NOT NULL;

-- 2e. Swap the unique: ADD wider first, then DROP old (add-then-drop; no gap).
ALTER TABLE sync_state
  ADD CONSTRAINT sync_state_client_platform_account_key
  UNIQUE (client_id, platform, account_id);
ALTER TABLE sync_state
  DROP CONSTRAINT sync_state_client_id_platform_key;

-- ═══ VERIFICATION (read-only; run after the ALTERs) ════════════════════════════════════════════════════════
-- 1. platform_connections now keyed by 3 columns:
SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint
 WHERE conrelid='public.platform_connections'::regclass AND contype='u';
-- 2. sync_state now keyed by 3 columns; account_id NOT NULL:
SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint
 WHERE conrelid='public.sync_state'::regclass AND contype='u';
SELECT is_nullable FROM information_schema.columns WHERE table_name='sync_state' AND column_name='account_id';
-- 3. Orphan cursors that took the sentinel (review/purge; expected small or zero):
SELECT client_id, platform FROM sync_state WHERE account_id='__ORPHAN_NO_CONNECTION__' ORDER BY 1,2;
-- 4. metrics_daily conflict key MUST be UNCHANGED (this Flight does not touch it — deviation note above):
SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint
 WHERE conrelid='public.metrics_daily'::regclass AND contype='u';

-- REVERT PATH (there is no staging DB — CREATE OR REPLACE / ADD-then-DROP is the revert):
--   platform_connections: ADD CONSTRAINT platform_connections_client_platform_unique UNIQUE (client_id, platform);
--                         DROP CONSTRAINT platform_connections_client_platform_account_unique;  (only safe while 1-account)
--   sync_state:           ADD CONSTRAINT sync_state_client_id_platform_key UNIQUE (client_id, platform);
--                         DROP CONSTRAINT sync_state_client_platform_account_key;  ALTER COLUMN account_id DROP NOT NULL;
