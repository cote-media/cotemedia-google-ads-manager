-- 014_woo_backfill_atomic_breaker.sql
-- LORAMER_WOO_BACKFILL_ATOMIC_BREAKER_V1 (WS3 #7 — replica-lag-proof circuit breaker)
-- PRINCIPLE: no control-flow decision may depend on a standalone SELECT that could hit a lagging
-- replica/pooled snapshot. ALL cross-invocation state (claimed / blocked / block_fails / cursor) must
-- come from a PRIMARY write-returning operation in the SAME transaction as the write.
--
-- Two changes:
--   1) claim_backfill_cursor: was RETURNS boolean (claim won?) + the engine then did a standalone SELECT
--      for blocked/complete/earliest (the lagging read). Now RETURNS the full state row via the CAS
--      UPDATE's own RETURNING — the engine reads complete/blocked/block_fails/earliest straight off the
--      claim result, never a separate SELECT. The claim still SETs only the claim columns (token/at);
--      it RETURNS the breaker+cursor columns but never modifies them (sole-authority rule).
--   2) bump_backfill_block (NEW): atomic increment of the consecutive-failure counter. The trip decision
--      (blocked = fails+1 >= threshold) and the block window/reason/at are computed and committed inside
--      one UPDATE ... RETURNING. The engine decides halted-vs-blocked PURELY from the RETURNED values.
--      This is the SOLE writer of backfill_block_fails on the failure path (no read-then-write).
-- Applied via Supabase MCP 2026-06-16.

-- ── 1) State-returning CAS claim ───────────────────────────────────────────────────────────────────
-- Drop the old boolean version (return type change requires a drop).
drop function if exists public.claim_backfill_cursor(uuid, text, text);

create function public.claim_backfill_cursor(p_client_id uuid, p_platform text, p_token text)
returns table(
  claimed boolean,
  blocked boolean,
  block_fails integer,
  earliest date,
  complete boolean,
  block_window text,
  block_reason text
)
language plpgsql
as $function$
declare r record;
begin
  -- Atomic CAS claim. The UPDATE's RETURNING reads the row in the SAME transaction as the write, so
  -- every value the engine branches on is primary-fresh. On a fresh row the INSERT path fires; on an
  -- existing row the claim is granted only if unclaimed or stale (>360s) — exactly the prior semantics.
  insert into public.sync_state (client_id, platform, backfill_claim_token, backfill_claimed_at, updated_at)
  values (p_client_id, p_platform, p_token, now(), now())
  on conflict (client_id, platform) do update
    set backfill_claim_token = p_token, backfill_claimed_at = now(), updated_at = now()
    where public.sync_state.backfill_claimed_at is null
       or public.sync_state.backfill_claimed_at < now() - interval '360 seconds'
  returning
    backfill_blocked, backfill_block_fails, backfill_earliest_date,
    backfill_complete, backfill_block_window, backfill_block_reason
  into r;

  if found then
    -- We won (or created) the claim. r holds the post-write row state.
    return query select
      true,
      coalesce(r.backfill_blocked, false),
      coalesce(r.backfill_block_fails, 0),
      r.backfill_earliest_date,
      coalesce(r.backfill_complete, false),
      r.backfill_block_window,
      r.backfill_block_reason;
  else
    -- Claim is held by a live (non-stale) invocation. Surface current state for the caller's log, but
    -- claimed=false → caller MUST NOT proceed. This read is allowed: it drives no store-contact decision
    -- (the engine no-ops on claimed=false regardless of the other fields).
    select s.backfill_blocked, s.backfill_block_fails, s.backfill_earliest_date,
           s.backfill_complete, s.backfill_block_window, s.backfill_block_reason
      into r
      from public.sync_state s
      where s.client_id = p_client_id and s.platform = p_platform;
    return query select
      false,
      coalesce(r.backfill_blocked, false),
      coalesce(r.backfill_block_fails, 0),
      r.backfill_earliest_date,
      coalesce(r.backfill_complete, false),
      r.backfill_block_window,
      r.backfill_block_reason;
  end if;
end;
$function$;

-- ── 2) Atomic failure-counter bump (sole writer of block_fails on the failure path) ─────────────────
create or replace function public.bump_backfill_block(
  p_client_id uuid,
  p_platform text,
  p_threshold integer,
  p_window text,
  p_reason text,
  p_earliest date
)
returns table(block_fails integer, blocked boolean)
language plpgsql
as $function$
begin
  return query
  update public.sync_state s
    set backfill_block_fails  = s.backfill_block_fails + 1,
        backfill_blocked      = (s.backfill_block_fails + 1 >= p_threshold),
        backfill_block_window = case when s.backfill_block_fails + 1 >= p_threshold then p_window else s.backfill_block_window end,
        backfill_block_reason = case when s.backfill_block_fails + 1 >= p_threshold then p_reason else s.backfill_block_reason end,
        backfill_block_at     = case when s.backfill_block_fails + 1 >= p_threshold then now() else s.backfill_block_at end,
        backfill_earliest_date = p_earliest,
        backfill_complete     = false,
        updated_at            = now()
  where s.client_id = p_client_id and s.platform = p_platform
  returning s.backfill_block_fails, s.backfill_blocked;
end;
$function$;
