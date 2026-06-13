-- LORAMER_CONNECTION_HEALTH_V1
-- Additive per-connection health signal on platform_connections.
-- NO BACKFILL: null last_ok_at / null health = "not yet observed" = treated
-- healthy-until-observed by the UI, so nothing flips to a scary state on deploy.
-- The cron + live-fetch paths populate these via src/lib/connection-health.ts.
--   health: 'healthy' | 'reconnect' | 'disconnected' | NULL(unobserved)
ALTER TABLE platform_connections
  ADD COLUMN IF NOT EXISTS last_ok_at      timestamptz,
  ADD COLUMN IF NOT EXISTS last_error_at   timestamptz,
  ADD COLUMN IF NOT EXISTS last_error_code text,
  ADD COLUMN IF NOT EXISTS health          text;
