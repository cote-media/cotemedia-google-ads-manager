-- LORAMER_BREAKDOWN_INDEX_V1 — fix the query_breakdown statement-timeout.
--
-- ROOT CAUSE: queryBreakdown filters (client_id, platform, breakdown_type, date) but NOT entity_level/entity_id.
-- The only usable index was the 7-col conflict key (client_id, platform, entity_level, entity_id, date,
-- breakdown_type, breakdown_value) — so the planner could SEEK only the (client_id, platform) prefix and then
-- SCAN the entire (client, platform) slice (huge for heavily-backfilled Google, from the geo/depth backfill),
-- applying breakdown_type + date as filters. That whole-partition scan (EXPLAIN cost ~140637) blew the Postgres
-- statement timeout for query_breakdown(hour, google) on Veterinary while Meta (smaller partition) squeaked under.
--
-- FIX: an index that positions breakdown_type to SEEK, then entity_level (for the upcoming entity-level scoping
-- fix that resolves the additive double-count) then date. Serves today's query (seek client/platform/breakdown_type
-- → the per-type slice is small) AND the follow-up scoping fix — one index, no redundant interim.
--
-- CONCURRENTLY: builds without locking the table (no downtime); must run OUTSIDE a transaction block. Applied to
-- prod via the Supabase MCP; this file is the repo record (docs-with-code). Additive: no column/schema/data change.
-- Verified with EXPLAIN before (conflict-key index, cost 140637) and after (this index, cheap seek).

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_metrics_daily_client_platform_bt_level_date
  ON metrics_daily (client_id, platform, breakdown_type, entity_level, date);
