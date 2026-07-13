-- 032_client_readiness_signals_rpc.sql — LORAMER_COMPLETENESS_GATE_V1 F(b). APPLIED to prod 2026-07-13 via MCP.
-- ONE read-only call returning every raw signal the per-client readiness meter needs (incl. the metrics_daily
-- DISTINCT group-by supabase-js can't express). ZERO writes. STABLE. Additive.
--
-- TENANT SAFETY (three independent locks):
--  1) EXECUTE revoked from public/anon/authenticated, granted ONLY to service_role -> PostgREST can never expose
--     it to a browser JWT; reachable only with the server-only service-role key.
--  2) Called ONLY server-side (supabaseAdmin) from the client-profile page, which resolves p_client_id EXCLUSIVELY
--     from clients WHERE user_email = caller (owner-owned) BEFORE calling -> never receives an id the caller can't access.
--  3) The function performs no internal auth by design; (1)+(2) are the gate. Not a public API.
create or replace function get_client_readiness_signals(p_client_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
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
    'realAgg', coalesce((select jsonb_agg(jsonb_build_object(
        'platform', m.platform, 'entity_level', m.entity_level, 'breakdown_type', m.breakdown_type))
      from (select distinct platform, entity_level, breakdown_type from metrics_daily where client_id = p_client_id) m), '[]'::jsonb),
    'brain', coalesce((select jsonb_build_object(
        'value_model', cc.value_model, 'business_descriptor', cc.business_descriptor,
        'service_area', cc.service_area, 'website', cc.website,
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

revoke all on function get_client_readiness_signals(uuid) from public;
revoke all on function get_client_readiness_signals(uuid) from anon;
revoke all on function get_client_readiness_signals(uuid) from authenticated;
grant execute on function get_client_readiness_signals(uuid) to service_role;
