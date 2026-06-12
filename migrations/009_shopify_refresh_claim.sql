-- LORAMER_SHOPIFY_REFRESH_RACE_V1
-- Migration: claim-based compare-and-swap to serialize concurrent Shopify token refresh.
-- Run via Supabase MCP (apply_migration) on 2026-06-12.
--
-- Why CAS and not an advisory lock: the app reaches Postgres only through supabase-js
-- (PostgREST over HTTPS) behind Supavisor TRANSACTION pooling. A pg_*advisory_xact_lock taken
-- inside an RPC is released when that RPC's transaction commits — BEFORE the Node-side Shopify
-- fetch — so a lock cannot span the refresh. Instead we persist a claim timestamp on the row:
-- exactly one caller stamps refresh_claimed_at; losers wait for the winner's published token.
--
-- Atomicity: two concurrent claim UPDATEs row-lock the same row; in READ COMMITTED the loser
-- re-evaluates its WHERE against the winner's committed row version (EvalPlanQual), the claim is
-- now fresh, the predicate fails, and it matches 0 rows. Exactly one winner, no extra locking.

ALTER TABLE shopify_tokens ADD COLUMN IF NOT EXISTS refresh_claimed_at timestamptz;

CREATE OR REPLACE FUNCTION claim_shopify_refresh(
  p_user_email  text,
  p_shop_domain text,
  p_ttl_seconds int
) RETURNS boolean
LANGUAGE sql AS $$
  WITH upd AS (
    UPDATE shopify_tokens
       SET refresh_claimed_at = now()
     WHERE user_email  = p_user_email
       AND shop_domain = p_shop_domain
       AND (refresh_claimed_at IS NULL
            OR refresh_claimed_at < now() - make_interval(secs => p_ttl_seconds))
    RETURNING 1
  )
  SELECT EXISTS (SELECT 1 FROM upd);
$$;
