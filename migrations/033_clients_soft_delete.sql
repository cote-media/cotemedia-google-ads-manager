-- 033_clients_soft_delete.sql — LORAMER_DELETE_CLIENT_V1 slice 1. APPLIED to prod 2026-07-13 via MCP.
-- Additive soft-delete marker. STORE-FOREVER: archive sets this timestamp; NOTHING is ever row-deleted.
-- No FK/cascade change (soft-delete issues no DELETE, so the existing child ON DELETE CASCADEs stay dormant).
-- No backfill (existing clients stay live). Partial index keeps active-client lookups fast.
alter table public.clients add column if not exists deleted_at timestamptz null;
create index if not exists clients_active_idx on public.clients (user_email) where deleted_at is null;
