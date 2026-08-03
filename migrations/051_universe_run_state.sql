-- 051_universe_run_state.sql — LORAMER_GOOGLE_ADS_UNIVERSE_RUNNER_V1.
--
-- ✅ APPLIED 2026-08-03 (Supabase MCP, name `universe_run_state`; verified live: universe_run_state 13 columns,
-- universe_run_notice 11 columns). Authored 2026-08-03. Applying the SCHEMA is not starting the RUN — the
-- tables are empty and nothing publishes to them until Russ fires the starter. The runner still FAILS LOUDLY
-- by name if they are ever absent, rather than degrading to a memory-only walk that forgets on restart.
-- Additive only: TWO new tables. No ALTER of an existing column, no DROP, no backfill, no touch to
-- metrics_daily, sync_state, cron_runs or any other table. REVERT = DROP TABLE (bottom of this file).
--
-- ⛔ WHY A NEW TABLE AND NOT sync_state.backfill_complete. That column's meaning is COMPROMISED: on
-- 2026-08-03 it read TRUE on 214 cursors across 18 clients while Google still served years more data, because
-- the drain seals it from a 36-month clock (LORAMER_GOOGLE_CAPTURE_DENOMINATOR_2026_08_03_V1). This path must
-- not inherit a column whose TRUE cannot be trusted. `vendor_exhausted_below` here is a DATE, not a boolean,
-- and it is only ever written with the response that proved it — so the claim carries its evidence.
--
-- GRAIN: one row per (client_id, vendor, resource, segment). `segment` is '' for a resource-only entry so the
-- natural key has no NULL member — the same reason metrics_daily uses '' rather than NULL in its 7-column key.

create table if not exists universe_run_state (
  client_id             uuid        not null,
  vendor                text        not null,           -- 'google_ads'. NOT 'google' — LORAMER_CAPTURE_UNIVERSE_NAMED_FOR_THE_API_V1.
  resource              text        not null,
  segment               text        not null default '',
  -- THE WALK. cursor_date is the deepest date requested so far; it moves backward.
  cursor_date           date,
  -- ⛔ COMPLETION IS A DATE PLUS ITS PROOF, NEVER A BARE BOOLEAN. Non-null means the vendor returned zero rows
  -- below this date. `exhaustion_proof` carries the literal request that produced the zero.
  vendor_exhausted_below date,
  exhaustion_proof      text,
  -- OBSERVED ZERO is a FACT, not a skip: a surface that answered with nothing is recorded, so "we asked and
  -- there was nothing" stays distinguishable from "nobody asked".
  observed_zero_at      timestamptz,
  -- SKIPPED AND RECORDED. An entry whose structural filter we cannot supply is never silently dropped.
  skipped_reason        text,
  rows_written          bigint      not null default 0,
  requests_spent        integer     not null default 0,
  last_error            text,
  updated_at            timestamptz not null default now(),
  primary key (client_id, vendor, resource, segment)
);

-- The runner asks "what is still owed for this client" on every message; this index answers it without a scan.
create index if not exists idx_universe_run_state_client_open
  on universe_run_state (client_id, vendor)
  where vendor_exhausted_below is null;

-- ── THE NOTICE (item 5): a QUERYABLE completion record, not an email. One row per client per completed run.
create table if not exists universe_run_notice (
  id                bigserial   primary key,
  client_id         uuid        not null,
  vendor            text        not null,
  completed_at      timestamptz not null default now(),
  entries_total     integer     not null,
  entries_exhausted integer     not null,
  entries_zero      integer     not null,
  entries_skipped   integer     not null,
  rows_written      bigint      not null,
  requests_spent    integer     not null,
  -- Per-surface detail, so "what was captured" is answerable without re-deriving it from metrics_daily.
  detail            jsonb       not null default '{}'::jsonb
);
create index if not exists idx_universe_run_notice_client on universe_run_notice (client_id, completed_at desc);

-- REVERT:
--   drop index if exists idx_universe_run_notice_client;
--   drop table if exists universe_run_notice;
--   drop index if exists idx_universe_run_state_client_open;
--   drop table if exists universe_run_state;
