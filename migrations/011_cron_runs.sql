-- 011_cron_runs.sql
-- LORAMER_CRON_RUNS_SENTINEL_V1 (WS1b-1)
-- Append-only completion sentinel for the nightly forward + catchup crons.
-- ONE row per fired invocation, per platform. started_at lands BEFORE heavy work;
-- finished_at stays NULL until clean completion (started-without-finished = crashed /
-- timed-out — the silent-hole signal that the maxDuration kill can never self-report).
-- Lets /api/cron/status answer: "did each platform's <mode> cron fully complete its most
-- recent expected run, and was it clean or degraded?" durably and re-run-safely.
--
-- NOTE: column named trigger_source, NOT trigger (reserved word in Postgres).
-- NOTE: append-only by design; a WS1b-2 prune keeps ~90 days (see CONTINUE_HERE).

create table if not exists public.cron_runs (
  id                    bigint generated always as identity primary key,
  mode                  text        not null,                    -- 'forward' | 'catchup'
  platform              text        not null,                    -- 'shopify'|'meta'|'google'|'woocommerce'|'ga'
  trigger_source        text        not null default 'cron',     -- 'cron' (Vercel schedule) | 'manual'
  target_date           date,                                    -- forward: the captured day (yesterday)
  window_start          date,                                    -- catchup: gap-scan window start
  window_end            date,                                    -- catchup: gap-scan window end (yesterday)
  started_at            timestamptz not null default now(),      -- stamped before the clients query
  finished_at           timestamptz,                             -- NULL until clean completion
  connections_attempted integer     not null default 0,
  connections_succeeded integer     not null default 0,
  connections_errored   integer     not null default 0,
  accounts_with_gaps    integer,                                 -- catchup only (NULL for forward)
  days_filled           integer,                                 -- catchup only (NULL for forward)
  rows_written          integer     not null default 0,
  error_count           integer     not null default 0,
  created_at            timestamptz not null default now()
);

-- "latest row per (mode, platform)" lookups for /api/cron/status + the WS1b-2 monitor.
create index if not exists cron_runs_mode_platform_started_idx
  on public.cron_runs (mode, platform, started_at desc);

-- Service-role-only table (written/read via supabaseAdmin). Enable RLS with no policies so
-- anon/authenticated have no access; the service role bypasses RLS. No anon path exists.
alter table public.cron_runs enable row level security;
