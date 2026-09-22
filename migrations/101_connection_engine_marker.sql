-- LORAMER_CONNECTION_ENGINE_MARKER_V1 — EVERY CONNECTION SAYS WHICH ENGINE SERVES IT. NOTHING READS IT YET.
--
-- ⛔ THE LAW OF THE MARKER (Russ, round 8, 2026-09-22): it must never lie. A connection may say 'walk' ONLY when the
-- old engine cannot write for it. Today the old engine (cron/sync 30 d · cron/catchup 35 d · cron/drain 36 months)
-- iterates EVERY platform_connections row, so every row — and every row inserted before the take-over build lands —
-- is 'legacy'. That is why the DEFAULT is 'legacy', not 'walk': a connection made between this migration and the
-- one-engine build would otherwise be marked walk while the old engine still serves it (Russ's adversary, settled).
-- The one-engine build flips the default in its own migration, in the same commit that stops the old writers.
--
-- SHAPE: one text column, checked to two spellings, NOT NULL with a constant default. On PostgreSQL 11+ a column
-- added with a non-volatile default is a catalog change — no table rewrite (sql-altertable: "adding a column with a
-- volatile DEFAULT … will require the entire table to be rewritten"; a constant is not volatile). The CHECK scans
-- the table once (52 rows, 2026-09-22). Both take ACCESS EXCLUSIVE for the statement; the applying session sets
-- lock_timeout so a busy table refuses rather than queues behind readers.
--
-- READERS (2026-09-22, every one walked in round 8): 30 PostgREST embeds `platform_connections(*)` and one
-- `.select('*')` (intelligence route) receive one more key and read none of them; nine named-column selects are
-- untouched; five insert sites (connections route, ga/connect, shopify callback ×2, woocommerce callback) name their
-- columns and take the default; DB functions get_client_readiness_signals / bump_connection_failures /
-- google_count_client_rows / google_delete_client_connection name their columns; the RLS policy is on user_email.
-- The detector that keeps the marker honest before any reader exists: scripts/check-engine-marker.mjs (check:data).
alter table public.platform_connections
  add column if not exists engine text not null default 'legacy';
alter table public.platform_connections
  drop constraint if exists platform_connections_engine_check;
alter table public.platform_connections
  add constraint platform_connections_engine_check check (engine in ('legacy', 'walk'));
comment on column public.platform_connections.engine is
  'LORAMER_CONNECTION_ENGINE_MARKER_V1 — which capture engine serves this connection: legacy (cron sync/catchup/drain) or walk (the universe walk + forward driver). MUST NEVER LIE: walk only when the old engine cannot write for it. Default legacy until the one-engine build flips it.';
