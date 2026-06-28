-- 021_backfill_lease_480.sql
-- LORAMER_SELFSERVE_SPINE_V1 step 4 — raise the claim lease 360s → 480s (TIMING ONLY).
-- WHY: the geo window moved 20d → 40d (step 4 free dial). The heaviest client's first-lap full sweep (all steps)
-- measured ~312-342s; the old 360s lease left only ~18-48s margin → a slow first lap could expire the lease
-- mid-sweep and let a concurrent fire re-claim (double-PROCESS). 480s gives ~140s margin over a ~340s heavy lap.
-- Steady-state laps (geo+user_geo only, ~165s) were already comfortably safe.
--
-- This is a CREATE OR REPLACE of claim_backfill_cursor with the SAME signature, SAME return type, and BYTE-IDENTICAL
-- CAS / single-owner logic as migration 014. The ONLY functional change is the staleness interval literal
-- '360 seconds' → '480 seconds'. The atomic INSERT ... ON CONFLICT DO UPDATE compare-and-set (the double-claim
-- guard) is unchanged — it still grants the claim only when unclaimed OR stale, in one primary-fresh transaction.
-- Reversible by re-running migration 014. bump_backfill_block is untouched. Run manually in the Supabase SQL Editor.

create or replace function public.claim_backfill_cursor(p_client_id uuid, p_platform text, p_token text)
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
  -- Atomic CAS claim. The UPDATE's RETURNING reads the row in the SAME transaction as the write, so every value
  -- the engine branches on is primary-fresh. On a fresh row the INSERT path fires; on an existing row the claim is
  -- granted only if unclaimed or stale (>480s) — identical to 014's semantics with the lease widened 360s → 480s.
  insert into public.sync_state (client_id, platform, backfill_claim_token, backfill_claimed_at, updated_at)
  values (p_client_id, p_platform, p_token, now(), now())
  on conflict (client_id, platform) do update
    set backfill_claim_token = p_token, backfill_claimed_at = now(), updated_at = now()
    where public.sync_state.backfill_claimed_at is null
       or public.sync_state.backfill_claimed_at < now() - interval '480 seconds'
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
    -- claimed=false → caller MUST NOT proceed.
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
