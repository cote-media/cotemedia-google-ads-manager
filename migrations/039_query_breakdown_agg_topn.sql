-- migration 039 — LORAMER_BREAKDOWN_SQL_AGG_BOUNDED_V1 (G2 STEP 2B)
-- BOUNDED sibling of query_breakdown_agg (038) for HIGH-CARDINALITY / NEW breakdown types. Does the ORDER BY
-- <rankBy> + LIMIT topN INSIDE Postgres and returns { total_groups, rows:[topN] }, so the payload is KB-class
-- regardless of cardinality. STEP-2B measurement (12-month, heaviest clients): ga_landing_page all-groups = 32.4 MB
-- (80,638 groups) → bounded = 4.5 KB; geo_most_specific 9.58 MB → 4.1 KB. Aggregates to the VALUE grain (merging
-- parents), so total_groups is the TRUE distinct-VALUE count (the truncation disclosure depends on it — proven
-- equal to count(distinct breakdown_value): 80,638 and 30,337). parent_entity_id = the single non-empty parent iff
-- exactly one (matches the all-groups path's parents.size===1 rule). TIEBREAK: value-ASC on rank-ties happens here
-- in DB collation — Russ-accepted for NEW types (tied rows carry identical metrics, so the top-N answer is correct;
-- there is no OLD result to be byte-identical to). Applied 2026-07-16 via MCP (Russ-approved). Revert = DROP.
create function public.query_breakdown_agg_topn(
  p_client_id uuid, p_platform text, p_breakdown_type text, p_entity_level text,
  p_start date, p_end date, p_rank_by text, p_top_n int, p_order_dir text default 'desc',
  p_parent_entity_id text default null, p_entity_id text default null)
returns jsonb language sql stable as $$
  with per_value as (
    select coalesce(breakdown_value,'') bv,
           sum(spend) spend, sum(impressions) impressions, sum(clicks) clicks,
           sum(conversions) conversions, sum(conversion_value) conversion_value, sum(revenue) revenue,
           count(distinct parent_entity_id) filter (where coalesce(parent_entity_id,'') <> '') nparents,
           min(parent_entity_id) filter (where coalesce(parent_entity_id,'') <> '') one_parent
    from public.metrics_daily
    where client_id=p_client_id and platform=p_platform and breakdown_type=p_breakdown_type
      and entity_level=p_entity_level and date>=p_start and date<=p_end
      and (p_parent_entity_id is null or parent_entity_id=p_parent_entity_id)
      and (p_entity_id  is null or entity_id=p_entity_id)
    group by coalesce(breakdown_value,'')
  ), ranked as (
    select bv, spend, impressions, clicks, conversions, conversion_value, revenue,
           case when nparents=1 then one_parent else null end AS parent_entity_id,
           case p_rank_by
             when 'impressions' then impressions::numeric when 'clicks' then clicks::numeric
             when 'conversions' then conversions when 'conversionValue' then conversion_value
             when 'revenue' then revenue else spend end AS rk
    from per_value
  )
  select jsonb_build_object(
    'total_groups', (select count(*) from per_value),
    'rows', coalesce((
      select jsonb_agg(jsonb_build_object(
               'breakdown_value', bv, 'parent_entity_id', parent_entity_id,
               'spend', spend, 'impressions', impressions, 'clicks', clicks,
               'conversions', conversions, 'conversion_value', conversion_value, 'revenue', revenue))
      from (
        select * from ranked
        order by case when p_order_dir='asc' then rk end asc nulls last,
                 case when p_order_dir='asc' then null else rk end desc nulls last,
                 bv asc
        limit greatest(p_top_n, 1)
      ) t), '[]'::jsonb));
$$;
