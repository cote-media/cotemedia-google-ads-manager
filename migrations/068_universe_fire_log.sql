-- LORAMER_WALK_UNWEDGE_AND_HEARTBEAT_V1 — 068: the resumer's per-fire heartbeat, durable and append-only.
--
-- ⛔ THE HOLE THIS CLOSES, MEASURED 2026-08-14: the walk was WEDGED for 21+ hours — every hourly fire ran to
-- completion, computed 60 refusals, printed one console line (expires in an hour on Vercel), returned a JSON
-- body nothing reads, and wrote NOTHING durable. A wedged walk and a healthy-but-quiet walk were
-- indistinguishable from every table we keep. 85 seconds of computed-then-discarded work per hour.
--
-- ONE ROW PER FIRE. Tiny, append-only, no updates ever. The refusal HISTOGRAM (verdict -> count) rides as
-- jsonb so the wedge signal (scripts/check-walk-liveness.mjs) can tell 'nothing-owed' silence (a WEDGE)
-- from 'floor-reached' silence (the walk's DONE state) without re-deriving either.
create table if not exists public.universe_fire_log (
  id bigint generated always as identity primary key,
  client_id uuid not null,
  fired_at timestamptz not null default now(),
  dry_run boolean not null default false,
  -- 'completed' | 'quota-hold' | 'rotation-error' | 'meter-held' — which return path the fire took.
  fire_outcome text not null,
  scanned integer not null default 0,
  scan_completed boolean not null default false,
  catalog_size integer not null default 0,
  candidates integer not null default 0,
  published integer not null default 0,
  requests_selected integer not null default 0,
  -- covered-ground advances this fire (the unwedge skips). 0 vendor ops each, by construction.
  advanced integer not null default 0,
  refusals jsonb not null default '{}'::jsonb,
  elapsed_ms integer not null default 0,
  held text null
);

create index if not exists universe_fire_log_client_fired_idx
  on public.universe_fire_log (client_id, fired_at desc);

comment on table public.universe_fire_log is
  'LORAMER_WALK_UNWEDGE_AND_HEARTBEAT_V1 — one append-only row per resumer fire (including held/error fires). '
  'The liveness invariant reads the trailing 24h: fires present + published=0 + rows_written=0 + not-at-floor '
  'is a WEDGE; refusals dominated by floor-reached is the DONE state. Written by service_role only.';

-- Grant posture (LORAMER_RPC_GRANT_POSTURE_V1 lesson, applied to a table): revoke the Supabase default
-- anon/authenticated grants BY NAME — revoking PUBLIC alone does not remove them (measured, 065).
revoke all on table public.universe_fire_log from public;
revoke all on table public.universe_fire_log from anon;
revoke all on table public.universe_fire_log from authenticated;
grant select, insert on table public.universe_fire_log to service_role;
