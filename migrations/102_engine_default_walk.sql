-- LORAMER_ONE_ENGINE_V1 (2026-09-22) — A NEW CONNECTION IS THE WALK'S. The default flips to 'walk'.
--
-- ⛔ WHY NOW AND NOT AT 101: the marker must never lie (LORAMER_CONNECTION_ENGINE_MARKER_V1). A row may say walk only when
-- the old engine cannot write for it. This migration lands in the SAME commit that makes every old-engine google writer
-- refuse a walk-marked connection before it claims or writes (cron/sync, cron/catchup, cron/drain, the manual run-backfill
-- engines) — so from this commit a new row marked walk is true the moment it is inserted.
--
-- SHAPE: catalog-only. "The new default value will only apply in subsequent INSERT or UPDATE commands; it does not cause
-- rows already in the table to change" (PostgreSQL, ALTER TABLE … SET DEFAULT). The 52 existing rows stay 'legacy'; the
-- CHECK (engine in ('legacy','walk')) stands; no rewrite; the applying session sets lock_timeout.
--
-- THE RECONNECT THAT MARKS TRI-COPY WALK IS THE INSERT ITSELF (clients/connections POST) taking this default — no update.
alter table public.platform_connections
  alter column engine set default 'walk';
comment on column public.platform_connections.engine is
  'LORAMER_CONNECTION_ENGINE_MARKER_V1 / LORAMER_ONE_ENGINE_V1 — which capture engine serves this connection: legacy (cron sync/catchup/drain) or walk (the universe walk + forward driver). MUST NEVER LIE: walk only when the old engine cannot write for it. Default walk since migration 102 (2026-09-22): every old-engine writer refuses a walk-marked connection before it claims or writes; existing rows stayed legacy.';
