-- LORAMER_IMPLICIT_PRESENCE_REASK_V1 (2026-09-24, round 50) — THE RE-ASK QUEUE: named surface-windows the FIRE asks.
--
-- WHY. Two repairs need surface-windows re-asked that the lanes will not derive on their own: (1) the five asset-interaction entries
-- whose false side the writer dropped (the days read COVERED by the true rows, so no lane sees a hole) and (2) Tri-Copy's 388
-- retracted idle windows (the missed lane reaches them only as its cursor sweeps). A script that asked Google itself would bypass
-- the fire's claim, holds, budget and pacing; so a script only INSERTS rows here and the fire consumes them inside its missed slot
-- (route.ts; universe-reask-queue.ts is the consumer). A row is done when its range is answered; an error terminal adds a try
-- (REASK_MAX_TRIES = 3, then the row stays visible to check:data); a deferred unit leaves it untouched.
create table if not exists public.universe_reask_queue (
  id            bigserial primary key,
  client_id     uuid        not null,
  vendor        text        not null default 'google',
  resource      text        not null,
  segment       text        not null default '',
  window_start  date        not null,
  window_end    date        not null,
  reason        text        not null,
  invocation    text,
  tries         integer     not null default 0,
  enqueued_at   timestamptz not null default now(),
  claimed_at    timestamptz,
  done_at       timestamptz,
  last_error    text,
  constraint universe_reask_queue_range_ck check (window_end >= window_start),
  constraint universe_reask_queue_tries_ck check (tries >= 0)
);
create index if not exists universe_reask_queue_pending_idx on public.universe_reask_queue (client_id, done_at, window_start);
create unique index if not exists universe_reask_queue_range_uq on public.universe_reask_queue (client_id, vendor, resource, segment, window_start, window_end, reason);
comment on table public.universe_reask_queue is
  'LORAMER_IMPLICIT_PRESENCE_REASK_V1 — named surface-windows the fire re-asks inside its missed slot (consumer: src/lib/backfill/universe-reask-queue.ts + universe-resume/route.ts; producer: scripts/enqueue-reask.mjs). done_at set when the range is answered; tries counts error terminals; a row at REASK_MAX_TRIES with done_at null is a check:data finding.';
revoke all on public.universe_reask_queue from public;
revoke all on public.universe_reask_queue from anon;
revoke all on public.universe_reask_queue from authenticated;
grant select, insert, update on public.universe_reask_queue to service_role;
grant usage, select on sequence public.universe_reask_queue_id_seq to service_role;
