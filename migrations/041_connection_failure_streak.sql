-- migration 041 — LORAMER_CONN_FAILURE_STREAK_V1
-- Per-connection CONSECUTIVE-FAILURE streak on platform_connections, so a PERSISTENT transient failure
-- (5xx / timeout / 429 / 406 — the class that by design NEVER flips health) stops being invisible.
-- Slice 1 = RECORDING ONLY: additive columns + one atomic increment function. NO reader, NO health-enum
-- change, NO constraint on existing rows, NO NOT-NULL backfill. Every existing row defaults to 0 / null / null.
-- NOT YET APPLIED (author + Gate-A slice). Apply via the Supabase SQL Editor / MCP, Russ-approved, BEFORE the
-- code that writes these fields is deployed. Revert = the DOWN block at the foot of this file.

-- UP ==================================================================================================
alter table public.platform_connections
  add column if not exists consecutive_failures int         not null default 0,
  add column if not exists first_failure_at     timestamptz null,
  add column if not exists last_failure_code    text        null;

-- Atomic increment. supabase-js cannot express `col = col + 1`, so the +1 lives in SQL. Increments EVERY
-- row matching the passed scope: a single connection when (client_id, account_id) are given; a shared
-- credential when only (user_email) is given (google/meta). first_failure_at is set ONLY on the 0->1
-- transition (COALESCE keeps the earliest). Non-null params AND together; a null param is not matched.
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
         last_failure_code    = p_code
   where platform = p_platform
     and (p_client_id  is null or client_id  = p_client_id)
     and (p_account_id is null or account_id = p_account_id)
     and (p_user_email is null or user_email = p_user_email);
$$;

comment on function public.bump_connection_failures is
  'LORAMER_CONN_FAILURE_STREAK_V1 — atomic per-connection consecutive-failure increment (supabase-js cannot do col+1). Scope = the non-null (client_id / account_id / user_email) params AND platform. Reset on success is a plain UPDATE from the app (consecutive_failures=0, first_failure_at=null, last_failure_code=null). See migration 041.';

-- DOWN / REVERT (commented — running this file performs UP only) =======================================
-- drop function if exists public.bump_connection_failures(text, uuid, text, text, text);
-- alter table public.platform_connections
--   drop column if exists consecutive_failures,
--   drop column if exists first_failure_at,
--   drop column if exists last_failure_code;
