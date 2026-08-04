-- LORAMER_UNIVERSE_WINDOW_LOG_V1 — DURABLE PER-WINDOW PROGRESS, EXPLICIT OUTCOME, HONEST SPEND.
--
-- ⛔ WHY A SECOND TABLE WHEN universe_run_state ALREADY EXISTS. universe_run_state is keyed
-- (client, vendor, resource, segment) — ONE ROW PER ENTRY, carrying a cursor and CUMULATIVE totals.
-- That shape cannot answer any of the four questions an unattended multi-day walk must answer:
--
--   (1) WHICH WINDOWS ARE DONE? A cursor says where we are, not what completed. Resuming from a
--       cursor re-walks the window the cursor sits on, or skips it — both are guesses.
--   (2) WHAT DID THIS LANE SPEND TODAY? `requests_spent` is CUMULATIVE per entry, and
--       readBackfillRequestsToday() summed it for every row whose updated_at fell today. On day 1
--       that is correct by accident. On day 2 every entry touched today reports its LIFETIME spend,
--       so the governor bills the walk for yesterday and stops publishing almost immediately.
--       MEASURED CONSEQUENCE: a 3-day walk halts on day 2 and reports "allowance EXHAUSTED" — a
--       correct-looking message for a walk that has spent nothing today.
--   (3) DID A WINDOW FINISH, OR DID IT DIE? There was no state for "started and never came back".
--   (4) WHY DID THE WALK STOP? A clean stop and a crash looked identical.
--
-- ⛔ OUTCOME IS AN EXPLICIT VALUE AND DEFAULTS TO 'running'. It is NEVER inferred from a timestamp.
-- This is the direct lesson of the drain (★DRAIN-CRON-RUNS-ORPHANED — a column NULL on success and
-- populated on failure) and of 2026-08-04's now()-vs-clock_timestamp() bug, where a 158-second job
-- logged finished_at identical to started_at because now() is TRANSACTION START. A row that never
-- reaches an outcome STAYS 'running' and reads as the failure it is.
--
-- ⛔ finished_at IS clock_timestamp(), NOT now(). Same bug, same table family, written down here so
-- it cannot come back through this door.

create table if not exists public.universe_window_log (
  id             bigint generated always as identity primary key,
  client_id      uuid        not null,
  vendor         text        not null default 'google_ads',   -- ⛔ NOT 'google' (LORAMER_CAPTURE_UNIVERSE_NAMED_FOR_THE_API_V1)
  resource       text        not null,
  segment        text        not null default '',
  window_start   date        not null,
  window_end     date        not null,

  -- ⛔ THE FIVE TERMINAL STATES PARTITION REALITY; 'running' is the sixth and is the DEFAULT.
  --   running   — opened, not yet closed. A crash leaves this. It is a FAILURE, not a pending state.
  --   ok        — the vendor answered and rows were written.
  --   zero      — the vendor answered and named nothing. ⛔ A FACT, NOT A SKIP (banked law).
  --   skipped   — never asked, and the requirement that stopped it is recorded.
  --   error     — asked and failed. The vendor's own words go in `error`.
  --   floor_stop— refused BEFORE spending, because disk headroom was below the floor.
  outcome        text        not null default 'running'
                 check (outcome in ('running','ok','zero','skipped','error','floor_stop')),

  rows_written   bigint      not null default 0,
  requests_spent integer     not null default 0,
  -- How many rows in this window carried a refusedMetrics stamp. ⛔ A refused metric reads 0 because
  -- the column is NOT NULL, and it is NOT a zero — this counter is how that stays visible at scale.
  refused_rows   bigint      not null default 0,
  -- Disk headroom READ AT THE MOMENT THIS WINDOW WAS AUTHORISED. Stored so a floor_stop can be
  -- audited after the fact rather than believed.
  disk_free_bytes bigint,
  error          text,
  started_at     timestamptz not null default clock_timestamp(),
  finished_at    timestamptz,

  -- ⛔ ONE ROW PER (entry, window). This is what makes the walk resumable: a finished window is a
  -- row with a terminal outcome, and it is never re-walked.
  constraint universe_window_log_uniq unique (client_id, vendor, resource, segment, window_start)
);

-- The governor's read: today's spend for this lane. Non-cumulative BY CONSTRUCTION — each row is one
-- window, so summing rows started today is today's spend and nothing else.
create index if not exists universe_window_log_spend_idx
  on public.universe_window_log (vendor, started_at) include (requests_spent);

-- The resume read: the unfinished / never-attempted work for a client.
create index if not exists universe_window_log_resume_idx
  on public.universe_window_log (client_id, vendor, outcome, window_start desc);

-- ⛔ RLS ON, ZERO POLICIES = DENY-ALL EXCEPT service_role. Same posture as universe_run_state. This
-- table records vendor spend and client identity; nothing in the browser has any business reading it.
alter table public.universe_window_log enable row level security;

comment on table public.universe_window_log is
  'LORAMER_UNIVERSE_WINDOW_LOG_V1 — one row per (entry, window) for the google_ads universe walk. outcome is explicit and defaults to running; a row still reading running is a window that died mid-flight. finished_at is clock_timestamp(), never now().';
