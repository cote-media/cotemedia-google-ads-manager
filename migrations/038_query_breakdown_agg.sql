-- migration 038 — LORAMER_QUERY_BREAKDOWN_SQL_AGG_V1
-- Scoped, client-anchored GROUP BY for queryBreakdown's additive path (metrics-query.ts). Additive: CREATE
-- FUNCTION only — touches no data and no existing object; nothing reads it until the metrics-query.ts wiring
-- lands. Revert = DROP FUNCTION public.query_breakdown_agg(uuid,text,text,text,date,date,text,text).
-- Applied 2026-07-16 via MCP (Russ-approved). Uses idx_metrics_daily_client_platform_bt_level_date.
--
-- RETURNS jsonb (a single array), NOT setof rows: PostgREST caps a SETOF result at 1000 rows (max-rows), which
-- silently truncated high-cardinality aggregates (search_term = 3169 groups → 1000) AND returned them unordered,
-- so both distinctValueCount and the top-N could be wrong. A scalar jsonb return is one row → the cap can't bite;
-- the JS layer keeps sort/topN/distinct. (Divergence from the first-proposed SETOF signature — caught in Gate-A.)
create function public.query_breakdown_agg(
  p_client_id uuid, p_platform text, p_breakdown_type text, p_entity_level text,
  p_start date, p_end date, p_parent_entity_id text default null, p_entity_id text default null)
returns jsonb language sql stable as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'breakdown_value', bv, 'parent_entity_id', pe,
           'spend', s, 'impressions', im, 'clicks', ck,
           'conversions', cv, 'conversion_value', cval, 'revenue', rv)), '[]'::jsonb)
  from (
    select coalesce(breakdown_value,'') bv, parent_entity_id pe,
           sum(spend) s, sum(impressions) im, sum(clicks) ck,
           sum(conversions) cv, sum(conversion_value) cval, sum(revenue) rv
    from public.metrics_daily
    where client_id=p_client_id and platform=p_platform and breakdown_type=p_breakdown_type
      and entity_level=p_entity_level and date>=p_start and date<=p_end
      and (p_parent_entity_id is null or parent_entity_id=p_parent_entity_id)
      and (p_entity_id  is null or entity_id=p_entity_id)
    group by coalesce(breakdown_value,''), parent_entity_id
  ) g;
$$;
