-- 013_woo_backfill_circuit_breaker.sql
-- LORAMER_WOO_BACKFILL_SAFE_V1 (WS3 #7 live-store safety)
-- Caller-proof circuit-breaker state on the backfill cursor (sync_state). When a frontier window still
-- errors at the per-day floor on the Nth (=2) consecutive attempt, the backfill is BLOCKED: every
-- subsequent invocation no-ops with ZERO outbound store requests until deliberately unblocked
-- (?unblock=true). Applied via Supabase MCP 2026-06-16.
alter table public.sync_state
  add column if not exists backfill_blocked boolean not null default false,
  add column if not exists backfill_block_window text,
  add column if not exists backfill_block_reason text,
  add column if not exists backfill_block_fails integer not null default 0,
  add column if not exists backfill_block_at timestamptz;
