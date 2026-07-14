-- LORAMER_RECONCILE_ZERO_DELIVERY_V1 — add a per-ad-platform "delivery" signal to the readiness RPC.
-- READ-ONLY function change (no capture writer, no metrics_daily schema change, no backfill re-run). The reconcile
-- engine uses this to distinguish an honest-empty zero-delivery ad account (GREEN_WITH_CAVEAT) from a genuine
-- fetched-but-unpersisted defect (RED_OUR_DEFECT). delivery[platform] = TRUE iff any account-grain row for that
-- ad platform has spend>0 OR impressions>0. Ad platforms only (google/meta); store/ga are unaffected.
CREATE OR REPLACE FUNCTION public.get_client_readiness_signals(p_client_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
    -- LORAMER_RECONCILE_ZERO_DELIVERY_V1 — per-ad-platform delivery bool from account-grain spend/impressions.
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
$function$;
