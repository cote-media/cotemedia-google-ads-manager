-- migration 042 — LORAMER_CONN_DEGRADED_STATE_V1  (SLICE 2 — NOT APPLIED; live-path, Russ confirms before ship)
-- Promote a PERSISTENT failure to a VISIBLE health = 'degraded' once the current failure streak has run
-- >= 24h with zero successes. first_failure_at (set on the 0->1 bump, CLEARED by a success) is the clock, so
-- "first_failure_at <= now()-24h" means "failing continuously for >= 24h" — which already implies zero
-- successes in that window (a success would have reset it). Time-based, NOT a count (cron cadence differs
-- per platform). 'degraded' = login ALIVE, capture persistently failing (usually the store's own server) —
-- DISTINCT from 'reconnect' (a dead credential the user must re-auth). health is plain text (no enum
-- constraint), so the new VALUE needs no column change; only bump_connection_failures gains the CASE.
-- Reset stays app-side (recordConnectionSuccess sets health='healthy' + clears the streak → un-degrades).

-- UP ==================================================================================================
create or replace function public.bump_connection_failures(
  p_platform   text,
  p_client_id  uuid    default null,
  p_account_id text    default null,
  p_user_email text    default null,
  p_code       text    default null
) returns void
language sql
as $$
  update public.platform_connections
     set consecutive_failures = consecutive_failures + 1,
         first_failure_at     = coalesce(first_failure_at, now()),
         last_failure_code    = p_code,
         -- promotion reads the OLD first_failure_at (SET exprs all see the pre-UPDATE row): on 0->1 it is
         -- null -> coalesce(now()) -> not <= now()-24h -> stays; a streak begun >=24h ago -> 'degraded'.
         health = case
           when health in ('reconnect', 'disconnected') then health                        -- never downgrade a worse verdict
           when coalesce(first_failure_at, now()) <= now() - interval '24 hours' then 'degraded'
           else health                                                                       -- < 24h persistent: unchanged (healthy / null)
         end
   where platform = p_platform
     and (p_client_id  is null or client_id  = p_client_id)
     and (p_account_id is null or account_id = p_account_id)
     and (p_user_email is null or user_email = p_user_email);
$$;

comment on function public.bump_connection_failures is
  'LORAMER_CONN_DEGRADED_STATE_V1 (migration 042) — atomic streak increment + promote healthy/null -> degraded once first_failure_at <= now()-24h (never touches reconnect/disconnected). Reset on success is app-side. Supersedes the migration-041 body.';

-- DOWN / REVERT (commented) — restore the migration-041 body (no health CASE):
-- create or replace function public.bump_connection_failures(p_platform text, p_client_id uuid default null,
--   p_account_id text default null, p_user_email text default null, p_code text default null) returns void
--   language sql as $$
--   update public.platform_connections set consecutive_failures = consecutive_failures + 1,
--     first_failure_at = coalesce(first_failure_at, now()), last_failure_code = p_code
--   where platform = p_platform and (p_client_id is null or client_id = p_client_id)
--     and (p_account_id is null or account_id = p_account_id) and (p_user_email is null or user_email = p_user_email); $$;
-- Any row already promoted stays 'degraded' until its next success clears it (recordConnectionSuccess).
