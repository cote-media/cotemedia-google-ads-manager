-- LORAMER_MISSED_CURSOR_V1 — migration 091: the missed lane's durable enumeration cursor, one row per (client, vendor).
--
-- WHY A TABLE AND NOT A ROW SOMEWHERE ELSE: no existing per-client state row fits. universe_run_state is per SURFACE
-- (PK client, vendor, resource, segment) and has eleven readers — a pseudo-surface row would enter every one of them;
-- universe_fire_log is append-only per fire; universe_fire_lease is the fire lease; universe_run_notice is a completed-run
-- notice. Two integers and a timestamp behind a primary key, read and written only by src/lib/backfill/universe-missed-cursor.ts.
-- WHY IT EXISTS (measured 2026-09-13 01:10Z): the lane's enumeration paged by the five-minute clock; page 7/22 was cut by
-- the allowance at entry 103 and the next fire moved to page 8, leaving entries 103–111 unenumerated for the whole sweep.
-- A deterministic cut starves the same entries every sweep. The cursor resumes from nextEntry — page boundaries stop mattering.
-- REVERT: drop table if exists public.universe_missed_cursor; (the lane falls back to cursor 0 on a missing row).

create table if not exists public.universe_missed_cursor (
  client_id   uuid        not null,
  vendor      text        not null,
  cursor      integer     not null default 0 check (cursor >= 0),
  sweep       integer     not null default 0 check (sweep >= 0),
  updated_at  timestamptz not null default now(),
  primary key (client_id, vendor)
);

alter table public.universe_missed_cursor enable row level security;

revoke all on public.universe_missed_cursor from public;
revoke all on public.universe_missed_cursor from anon;
revoke all on public.universe_missed_cursor from authenticated;
revoke all on public.universe_missed_cursor from service_role;
grant select, insert, update on public.universe_missed_cursor to service_role;

comment on table public.universe_missed_cursor is
  'LORAMER_MISSED_CURSOR_V1 — where the missed lane''s hole-map enumeration resumes next fire (catalogue entry index) and how many full sweeps it has completed. One row per (client, vendor); written only by universe-missed-cursor.ts after an enumeration that was not refused.';
