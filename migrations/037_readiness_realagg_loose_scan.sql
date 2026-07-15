-- 037_readiness_realagg_loose_scan.sql — LORAMER_NEXT_READINESS_LOOSE_SCAN_V1.
-- Fixes the get_client_readiness_signals timeout on heavy clients. ROOT (verified, not hypothesis):
-- the 'realAgg' key used `SELECT DISTINCT platform, entity_level, breakdown_type FROM metrics_daily
-- WHERE client_id = p_client_id`. That is O(client-rows): PG15 has no skip-scan, so the planner reads
-- EVERY one of the client's rows (index-only scan for light clients; it escalates to a full Seq Scan of
-- the whole 35M-row table on multi-million-row clients) only to collapse them to <=~111 distinct combos.
-- On the LIVE path the statement runs under `authenticator` (statement_timeout = 8s; service_role adds no
-- override and role GUCs do not re-apply on SET ROLE), so on a heavy client (Bath Fitter measured >120,000ms)
-- it hits 8s -> PostgREST returns null -> client-profile renders NO readiness meter at all (a silent blank on
-- exactly the heaviest clients). The 120s cluster default is only visible to MCP/superuser sessions.
--
-- FIX: replace ONLY the realAgg subquery with a loose index scan (recursive skip-scan) over the EXISTING
-- index idx_metrics_daily_client_platform_bt_level_date (client_id, platform, breakdown_type, entity_level, date).
-- It seeks the first (platform, breakdown_type, entity_level) tuple for the client, then repeatedly seeks the
-- next strictly-greater tuple — reading only the distinct combos, not every row. Bath Fitter: >120,000ms -> 72ms.
-- No new index, no schema change, no grant change. The other 6 keys (floors, connections, cursors, delivery,
-- brain, docs, memory) are copied BYTE-FOR-BYTE from 034 — untouched.
--
-- IDENTICAL-OUTPUT PROOF (the gate): metrics_daily.platform, entity_level, breakdown_type are all NOT NULL
-- (breakdown_type default ''), so a row-value skip-scan enumerates EXACTLY the DISTINCT set — output is
-- provably identical to the old realAgg for every client. Corroborated empirically: OLD DISTINCT vs NEW
-- loose-scan compared with EXCEPT both ways over 15 clients (incl. the named light client Champion) — zero
-- diff, every batch. reconcile() consumes realAgg as a SET (realPresent membership), so array order is
-- irrelevant. The 13 heavy clients cannot run OLD DISTINCT to completion at all (that inability IS the bug);
-- the NOT-NULL theorem covers them.
--
-- TENANT SAFETY: unchanged from 032/034. EXECUTE revoked from public/anon/authenticated, granted only to
-- service_role; called only server-side (supabaseAdmin) from client-profile after owner-verifying p_client_id.
create or replace function get_client_readiness_signals(p_client_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with recursive realagg_distinct(platform, breakdown_type, entity_level) as (
    -- seed: the client's minimum (platform, breakdown_type, entity_level) via one index seek
    (
      select m.platform, m.breakdown_type, m.entity_level
      from metrics_daily m
      where m.client_id = p_client_id
      order by m.platform, m.breakdown_type, m.entity_level
      limit 1
    )
    union all
    -- step: the next strictly-greater tuple for the same client (one index seek per distinct combo)
    select n.platform, n.breakdown_type, n.entity_level
    from realagg_distinct t
    cross join lateral (
      select m.platform, m.breakdown_type, m.entity_level
      from metrics_daily m
      where m.client_id = p_client_id
        and (m.platform, m.breakdown_type, m.entity_level) > (t.platform, t.breakdown_type, t.entity_level)
      order by m.platform, m.breakdown_type, m.entity_level
      limit 1
    ) n
  )
  select jsonb_build_object(
    'floors', coalesce((select jsonb_agg(to_jsonb(f)) from known_floors f), '[]'::jsonb),
    'connections', coalesce((select jsonb_agg(jsonb_build_object(
        'client_id', pc.client_id, 'platform', pc.platform, 'account_id', pc.account_id,
        'onboard_steps_done', pc.onboard_steps_done, 'health', pc.health))
      from platform_connections pc where pc.client_id = p_client_id), '[]'::jsonb),
    'cursors', coalesce((select jsonb_agg(jsonb_build_object(
        'client_id', s.client_id, 'platform', s.platform,
        'backfill_complete', s.backfill_complete, 'backfill_earliest_date', s.backfill_earliest_date,
        'backfill_target_date', s.backfill_target_date, 'backfill_blocked', s.backfill_blocked,
        'backfill_block_reason', s.backfill_block_reason, 'backfill_block_window', s.backfill_block_window,
        'updated_at', s.updated_at))
      from sync_state s where s.client_id = p_client_id), '[]'::jsonb),
    -- LORAMER_NEXT_READINESS_LOOSE_SCAN_V1 — realAgg now reads the loose-index-scan CTE (was SELECT DISTINCT).
    'realAgg', coalesce((select jsonb_agg(jsonb_build_object(
        'platform', r.platform, 'entity_level', r.entity_level, 'breakdown_type', r.breakdown_type))
      from realagg_distinct r), '[]'::jsonb),
    'delivery', coalesce((select jsonb_object_agg(platform, has_delivery) from (
        select platform, bool_or(coalesce(spend,0) > 0 or coalesce(impressions,0) > 0) as has_delivery
        from metrics_daily
        where client_id = p_client_id and entity_level = 'account' and platform in ('google','meta')
        group by platform
      ) d), '{}'::jsonb),
    'brain', coalesce((select jsonb_build_object(
        'value_model', cc.value_model,
        'business_descriptor', cc.business_descriptor,
        'service_area', cc.service_area,
        'website', cc.website,
        'naics_codes', coalesce(cc.naics_codes, '[]'::jsonb))
      from client_context cc where cc.client_id = p_client_id), '{}'::jsonb),
    'docs', coalesce((select jsonb_build_object('count', count(*), 'words', coalesce(sum(word_count),0))
      from uploaded_docs where scope='client' and client_id = p_client_id and deleted_at is null), '{}'::jsonb),
    'memory', coalesce((select jsonb_build_object(
        'directive', count(*) filter (where category='directive'),
        'fact', count(*) filter (where category <> 'directive'))
      from client_memory where client_id = p_client_id and archived_at is null), '{}'::jsonb)
  );
$$;

-- Grants re-applied verbatim (idempotent; CREATE OR REPLACE preserves ACL, this makes it explicit).
revoke all on function get_client_readiness_signals(uuid) from public;
revoke all on function get_client_readiness_signals(uuid) from anon;
revoke all on function get_client_readiness_signals(uuid) from authenticated;
grant execute on function get_client_readiness_signals(uuid) to service_role;
