-- 019_onboard_backfill_marker.sql
-- LORAMER_ONBOARD_AUTOBACKFILL_MARKER_V1 (Onboarding auto-backfill, STEP 2A — marker only; fires nothing)
-- Adds the per-connection "which registry backfill steps are done" marker that a future drain cron reads.
-- New platform_connections rows DEFAULT '[]' (drain sees them needing every step) — so NO connect-route code
-- is touched: all 4 connection-creation sites only INSERT this table, and the column default does the marking.
-- The drain cron (STEP 2B, separately gated) is NOT built here. This migration only adds + seeds the marker.
--
-- SEED = DB REALITY (not assumption): each existing connection is seeded to exactly the CURRENT-registry steps
-- that are actually present-to-floor in metrics_daily. Anything genuinely missing stays out of the set → the
-- drain fills it. Conservative: when depth can't be confirmed from the warehouse (recent/indefinite-retention
-- grains), the step is left OUT → the drain re-probes (idempotent, cheap) rather than risk skipping a real gap.
--
-- DONE rules (per applicable step):
--   account  ({google,meta,ga} only — shopify/woo account rides shopify_deep/woo): earliest account row <= 2023-06-24
--            (demonstrably deep past the ~37mo granular cliff = a real backfill ran). Recent/young accounts -> drain re-probes.
--   google_campaign     : DONE for all google connections — VERIFIED this session (LORAMER_GOOGLE_CAMPAIGN_BACKFILL_V1
--            scaled every google client to floor/first-activity, residual 0). (One demo dup is forward-only; immaterial.)
--   google_dimensional  : search_term/keyword rows present (>0) = at its ~90d banked-and-growing floor.
--   meta_placement      : placement rows present AND earliest <= account-floor + 31d (scaled to the meta account floor).
--   shopify_deep        : shopify account deep (<=2023-06-24) AND product rows AND geo rows present.
--   woo                 : woo account deep (<=2023-06-24) AND product rows present.
--
-- REVERT (reversible): alter table public.platform_connections drop column onboard_steps_done;

alter table public.platform_connections
  add column if not exists onboard_steps_done jsonb not null default '[]'::jsonb;

-- One-time seed of existing rows from current warehouse depth (new rows keep the '[]' default).
update public.platform_connections pc
set onboard_steps_done = coalesce((
  select jsonb_agg(step order by step) from (
    select 'account' as step
      where pc.platform in ('google','meta','ga')
        and exists (select 1 from metrics_daily m
          where m.client_id = pc.client_id and m.platform = pc.platform
            and m.entity_level='account' and m.breakdown_type='' and m.date <= date '2023-06-24')
    union all
    select 'google_campaign'
      where pc.platform = 'google'
    union all
    select 'google_dimensional'
      where pc.platform = 'google'
        and exists (select 1 from metrics_daily m
          where m.client_id = pc.client_id and m.platform='google'
            and m.breakdown_type in ('search_term','keyword'))
    union all
    select 'meta_placement'
      where pc.platform = 'meta'
        and exists (select 1 from metrics_daily m
          where m.client_id = pc.client_id and m.platform='meta'
            and m.entity_level='campaign' and m.breakdown_type='placement'
            and m.date <= coalesce(
              (select min(a.date) + 31 from metrics_daily a
                 where a.client_id = pc.client_id and a.platform='meta'
                   and a.entity_level='account' and a.breakdown_type=''),
              date '2023-07-25'))
    union all
    select 'shopify_deep'
      where pc.platform = 'shopify'
        and exists (select 1 from metrics_daily m where m.client_id=pc.client_id and m.platform='shopify' and m.entity_level='account' and m.breakdown_type='' and m.date <= date '2023-06-24')
        and exists (select 1 from metrics_daily m where m.client_id=pc.client_id and m.platform='shopify' and m.entity_level='product')
        and exists (select 1 from metrics_daily m where m.client_id=pc.client_id and m.platform='shopify' and m.breakdown_type in ('geo_country','geo_region'))
    union all
    select 'woo'
      where pc.platform = 'woocommerce'
        and exists (select 1 from metrics_daily m where m.client_id=pc.client_id and m.platform='woocommerce' and m.entity_level='account' and m.breakdown_type='' and m.date <= date '2023-06-24')
        and exists (select 1 from metrics_daily m where m.client_id=pc.client_id and m.platform='woocommerce' and m.entity_level='product')
  ) steps
), '[]'::jsonb);
