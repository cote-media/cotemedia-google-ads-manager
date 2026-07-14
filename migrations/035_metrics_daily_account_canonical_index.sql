-- LORAMER_NEXT_PORTFOLIO_METRICS_INDEX_V1 — fix the portfolio-metrics 500 (statement timeout).
-- /api/next/portfolio-metrics scans metrics_daily for the ACCOUNT-CANONICAL rows
-- (entity_level='account' AND breakdown_type='' AND breakdown_value='') across all accessible clients.
-- On the grown table (33M rows / 27GB after GA-dimensional + geo/dimensional breadth) no existing index
-- isolates that subset — every index leads with (client_id, platform, …) and the query constrains all
-- platforms — so it degrades to a huge per-client scan and exceeds the 2-min statement timeout → the route's
-- `if (error) return 500` fires → the UI shows "—" for every client. This partial index contains ONLY the
-- account-canonical rows (~1 row per client×platform×day), leads with (client_id, date) to match the query,
-- and INCLUDEs platform/spend/revenue for an index-only scan.
--
-- Production form is CONCURRENTLY (non-blocking) — run this verbatim in the Supabase SQL Editor with
-- `SET statement_timeout = 0;` first if applying by hand. Applied here via MCP inside a single txn with the
-- statement timeout lifted (non-concurrent build) because CONCURRENTLY cannot run in a transaction block and
-- the 27GB build exceeds the pooled 2-min ceiling; the RESULTING INDEX (name + columns + predicate) is identical.
-- Store-forever / capture untouched: this is an index only — no metrics_daily rows, writers, reconcile or readiness touched.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_metrics_daily_account_canonical
  ON metrics_daily (client_id, date)
  INCLUDE (platform, spend, revenue)
  WHERE entity_level = 'account' AND breakdown_type = '' AND breakdown_value = '';
