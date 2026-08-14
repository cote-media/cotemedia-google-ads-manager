-- migration 067 — LORAMER_EXTRA_METRIC_REACHABILITY_V1
-- Makes the `extra` JSONB reachable through BOTH breakdown RPCs. ADDITIVE: adds ONE key ('extra_metrics') to
-- each returned row object and widens what p_rank_by accepts. Every pre-existing key keeps its exact value and
-- the signatures do not move, so existing callers are byte-identical without changing a line.
--
-- ⛔ WHY THIS EXISTS, MEASURED, NOT SUPPOSED. The 2026-08-14 full-100 eval baseline scored 56.1%, and its
-- single largest failing class was PRESENT_BUT_UNREACHABLE. Lora told Russ, in her own words, "the captured GA
-- metric set doesn't return sessions" and "sessions aren't in the captured store" — about data this table has
-- held for months. Every one of those numbers reproduces EXACTLY from metrics_daily (run 2026-08-14 against the
-- hand-certified eval truth pass):
--     ga_landing_page  Q2-2026  by sessions   → 2,742 / 2,033 / 1,315    (eval B2)
--     ga_event         Jun-2026 by eventCount → 5,603 / 3,252 / 2,423    (eval B6)
--     ga_device        Q2-2026  by sessions   → 10,567 / 5,766 / 889     (eval B7)
--     ga_channel       Jun-2026 by sessions   → 1,269 / 728              (eval B19)
-- The rows were never the problem. Both RPCs summed six fixed metric columns and never read `extra`, so the
-- query layer could not see them — and Lora, handed an honest-looking empty result, reported OUR gap as the
-- ACCOUNT's gap. A confident denial of the customer's own data is worse than a wrong number.
--
-- ⛔ CREATE OR REPLACE, NEVER DROP+CREATE — AND THE SIGNATURE IS FROZEN FOR THE SAME REASON. A dropped and
-- recreated function is a NEW pg_proc row carrying PostgreSQL's default EXECUTE grant to PUBLIC, which would
-- silently revert LORAMER_RPC_GRANT_POSTURE_V1 (migration 065, six days old) and hand `anon` execute rights on a
-- client-scoped reader. Replacing in place preserves the ACL. It is also why the key list lives in the FUNCTION
-- BODY and not in a new p_extra_keys parameter: CREATE OR REPLACE cannot change a signature — it creates an
-- OVERLOAD, which is a new pg_proc row, which is the same hole by another route.
--
-- ⛔ THE KEY LIST MIRRORS src/lib/breakdown-registry.ts (ADDITIVE_EXTRA_METRICS) AND THE MIRROR IS GUARDED.
-- SQL cannot import TypeScript, so the list is written twice — the two-hand-maintained-lists drift that made 54
-- tuples hard-blind in 2026-07. tests/guards/extra-metrics-reachable.guard.mjs parses the jsonb_typeof
-- expressions BELOW (the executable text, never a comment that can rot while the SQL moves) and fails the build
-- if they diverge. TS is the source; this is the copy.
--
-- ⛔ ONLY ADDITIVE KEYS ARE HERE, AND THE OMISSIONS ARE ARGUED. `extra` mixes four things: additive counts
-- (sessions, orders), additive money (eventValue), DEDUP counts (totalUsers, reach, customers — a user seen on
-- ten days is ONE user, not ten) and ratios/provenance (engagementRate, roas, netBasis, caveat). Only the first
-- two may be summed. The rest are named in DENIED_EXTRA_METRICS with reasons, because summing a deduplicated
-- user count across 365 days inflates it by the return rate and looks entirely plausible on the way out.
--
-- ⛔ jsonb_typeof(...)='number' IS LOAD-BEARING, NOT DEFENSIVE DECORATION. `extra` is written by five
-- independent adapters and the SAME column carries netBasis, caveat, tzBasis, provenance and semantics as TEXT.
-- A bare (extra->>'k')::numeric raises 22P02 on the first such row and takes the whole answer down for every
-- client on that platform. jsonb_typeof filters instead of throwing: one odd row degrades one value.
--
-- ⛔ COST, MEASURED BEFORE SHIPPING — heaviest real slice, Foam OH ga_landing_page 12 months, 279,048 rows →
-- 249,621 groups. PLAN UNCHANGED: per-partition Index Scan on idx_mdp_client_platform_bt_lvl_date then
-- HashAggregate; no index added, no seq scan, no partition pruning lost. Execution 3,208 ms before / 3,069 ms
-- after (the second run was cache-warm — that is noise, not a speedup; call it unchanged). The real cost is
-- MEMORY: the aggregate row widens 38 → 207 bytes and the hash spills harder, 74 MB → 125 MB of temp disk over
-- 61 → 117 batches. THAT is why every expression tests p_platform FIRST: AND short-circuits left to right, so a
-- google/meta/shopify/woo query never touches `extra` for a key it does not declare and pays nothing. It also
-- bounds the standing 8s statement_timeout risk (★READINESS-SIGNALS-RPC-TIMEOUT): the worst measured slice sits
-- at ~3.1s, and the bounded path (039) is the one high-cardinality families route through.
--
-- REVERT: re-apply migrations 038 and 039 verbatim. Both are CREATE OR REPLACE-compatible, so a revert disturbs
-- no ACL either.

-- ── 038's sibling: the ALL-GROUPS path (14 existing tool types at their default level) ────────────────────
create or replace function public.query_breakdown_agg(
  p_client_id uuid, p_platform text, p_breakdown_type text, p_entity_level text,
  p_start date, p_end date, p_parent_entity_id text default null, p_entity_id text default null)
returns jsonb language sql stable as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'breakdown_value', bv, 'parent_entity_id', pe,
           'spend', s, 'impressions', im, 'clicks', ck,
           'conversions', cv, 'conversion_value', cval, 'revenue', rv,
           -- jsonb_strip_nulls drops any key NO row in the group carried, so an absent metric is ABSENT rather
           -- than 0. A fabricated zero is the FALSE_ZERO class the same baseline counted eight times; the fix
           -- for the unreachability class must not introduce it.
           'extra_metrics', xm)), '[]'::jsonb)
  from (
    select coalesce(breakdown_value,'') bv, parent_entity_id pe,
           sum(spend) s, sum(impressions) im, sum(clicks) ck,
           sum(conversions) cv, sum(conversion_value) cval, sum(revenue) rv,
           jsonb_strip_nulls(jsonb_build_object(
             'sessions', sum(case when (p_platform='ga' and jsonb_typeof(extra->'sessions')='number') then (extra->>'sessions')::numeric end),
             'engagedSessions', sum(case when (p_platform='ga' and jsonb_typeof(extra->'engagedSessions')='number') then (extra->>'engagedSessions')::numeric end),
             'newUsers', sum(case when (p_platform='ga' and jsonb_typeof(extra->'newUsers')='number') then (extra->>'newUsers')::numeric end),
             'eventCount', sum(case when (p_platform='ga' and jsonb_typeof(extra->'eventCount')='number') then (extra->>'eventCount')::numeric end),
             'eventValue', sum(case when (p_platform='ga' and jsonb_typeof(extra->'eventValue')='number') then (extra->>'eventValue')::numeric end),
             'transactions', sum(case when (p_platform='ga' and jsonb_typeof(extra->'transactions')='number') then (extra->>'transactions')::numeric end),
             'refundAmount', sum(case when (p_platform='ga' and jsonb_typeof(extra->'refundAmount')='number') then (extra->>'refundAmount')::numeric end),
             'purchases', sum(case when (p_platform='meta' and jsonb_typeof(extra->'purchases')='number') then (extra->>'purchases')::numeric end),
             'addToCart', sum(case when (p_platform='meta' and jsonb_typeof(extra->'addToCart')='number') then (extra->>'addToCart')::numeric end),
             'initiateCheckout', sum(case when (p_platform='meta' and jsonb_typeof(extra->'initiateCheckout')='number') then (extra->>'initiateCheckout')::numeric end),
             'viewContent', sum(case when (p_platform='meta' and jsonb_typeof(extra->'viewContent')='number') then (extra->>'viewContent')::numeric end),
             'outboundClicks', sum(case when (p_platform='meta' and jsonb_typeof(extra->'outboundClicks')='number') then (extra->>'outboundClicks')::numeric end),
             'orders', sum(case when (p_platform='shopify' and jsonb_typeof(extra->'orders')='number') or (p_platform='woocommerce' and jsonb_typeof(extra->'orders')='number') then (extra->>'orders')::numeric end),
             'units', sum(case when (p_platform='shopify' and jsonb_typeof(extra->'units')='number') then (extra->>'units')::numeric end),
             'grossRevenue', sum(case when (p_platform='shopify' and jsonb_typeof(extra->'grossRevenue')='number') then (extra->>'grossRevenue')::numeric end),
             'refundedAmount', sum(case when (p_platform='shopify' and jsonb_typeof(extra->'refundedAmount')='number') then (extra->>'refundedAmount')::numeric end),
             'refundedOrderCount', sum(case when (p_platform='shopify' and jsonb_typeof(extra->'refundedOrderCount')='number') then (extra->>'refundedOrderCount')::numeric end),
             'newCustomers', sum(case when (p_platform='shopify' and jsonb_typeof(extra->'newCustomers')='number') then (extra->>'newCustomers')::numeric end),
             'abandonedCheckoutCount', sum(case when (p_platform='shopify' and jsonb_typeof(extra->'abandonedCheckoutCount')='number') then (extra->>'abandonedCheckoutCount')::numeric end),
             'abandonedCheckoutValue', sum(case when (p_platform='shopify' and jsonb_typeof(extra->'abandonedCheckoutValue')='number') then (extra->>'abandonedCheckoutValue')::numeric end)
           )) xm
    from public.metrics_daily
    where client_id=p_client_id and platform=p_platform and breakdown_type=p_breakdown_type
      and entity_level=p_entity_level and date>=p_start and date<=p_end
      and (p_parent_entity_id is null or parent_entity_id=p_parent_entity_id)
      and (p_entity_id  is null or entity_id=p_entity_id)
    group by coalesce(breakdown_value,''), parent_entity_id
  ) g;
$$;

-- ── 039's sibling: the BOUNDED top-N path — EVERY GA family routes here, so this is the one the six failing
-- eval questions actually go through. It also has to RANK by an extra metric: B2 asked for "top ten landing
-- pages BY SESSIONS", and reaching the number is only half that question. The ORDER BY happens in SQL, so a
-- rankBy the CASE does not know silently falls through to the default anchor and returns the top pages by
-- SPEND while the answer calls them top by sessions — a wrong answer that looks right, which is the worst kind.
create or replace function public.query_breakdown_agg_topn(
  p_client_id uuid, p_platform text, p_breakdown_type text, p_entity_level text,
  p_start date, p_end date, p_rank_by text, p_top_n int, p_order_dir text default 'desc',
  p_parent_entity_id text default null, p_entity_id text default null)
returns jsonb language sql stable as $$
  with per_value as (
    select coalesce(breakdown_value,'') bv,
           sum(spend) spend, sum(impressions) impressions, sum(clicks) clicks,
           sum(conversions) conversions, sum(conversion_value) conversion_value, sum(revenue) revenue,
           count(distinct parent_entity_id) filter (where coalesce(parent_entity_id,'') <> '') nparents,
           min(parent_entity_id) filter (where coalesce(parent_entity_id,'') <> '') one_parent,
           jsonb_strip_nulls(jsonb_build_object(
             'sessions', sum(case when (p_platform='ga' and jsonb_typeof(extra->'sessions')='number') then (extra->>'sessions')::numeric end),
             'engagedSessions', sum(case when (p_platform='ga' and jsonb_typeof(extra->'engagedSessions')='number') then (extra->>'engagedSessions')::numeric end),
             'newUsers', sum(case when (p_platform='ga' and jsonb_typeof(extra->'newUsers')='number') then (extra->>'newUsers')::numeric end),
             'eventCount', sum(case when (p_platform='ga' and jsonb_typeof(extra->'eventCount')='number') then (extra->>'eventCount')::numeric end),
             'eventValue', sum(case when (p_platform='ga' and jsonb_typeof(extra->'eventValue')='number') then (extra->>'eventValue')::numeric end),
             'transactions', sum(case when (p_platform='ga' and jsonb_typeof(extra->'transactions')='number') then (extra->>'transactions')::numeric end),
             'refundAmount', sum(case when (p_platform='ga' and jsonb_typeof(extra->'refundAmount')='number') then (extra->>'refundAmount')::numeric end),
             'purchases', sum(case when (p_platform='meta' and jsonb_typeof(extra->'purchases')='number') then (extra->>'purchases')::numeric end),
             'addToCart', sum(case when (p_platform='meta' and jsonb_typeof(extra->'addToCart')='number') then (extra->>'addToCart')::numeric end),
             'initiateCheckout', sum(case when (p_platform='meta' and jsonb_typeof(extra->'initiateCheckout')='number') then (extra->>'initiateCheckout')::numeric end),
             'viewContent', sum(case when (p_platform='meta' and jsonb_typeof(extra->'viewContent')='number') then (extra->>'viewContent')::numeric end),
             'outboundClicks', sum(case when (p_platform='meta' and jsonb_typeof(extra->'outboundClicks')='number') then (extra->>'outboundClicks')::numeric end),
             'orders', sum(case when (p_platform='shopify' and jsonb_typeof(extra->'orders')='number') or (p_platform='woocommerce' and jsonb_typeof(extra->'orders')='number') then (extra->>'orders')::numeric end),
             'units', sum(case when (p_platform='shopify' and jsonb_typeof(extra->'units')='number') then (extra->>'units')::numeric end),
             'grossRevenue', sum(case when (p_platform='shopify' and jsonb_typeof(extra->'grossRevenue')='number') then (extra->>'grossRevenue')::numeric end),
             'refundedAmount', sum(case when (p_platform='shopify' and jsonb_typeof(extra->'refundedAmount')='number') then (extra->>'refundedAmount')::numeric end),
             'refundedOrderCount', sum(case when (p_platform='shopify' and jsonb_typeof(extra->'refundedOrderCount')='number') then (extra->>'refundedOrderCount')::numeric end),
             'newCustomers', sum(case when (p_platform='shopify' and jsonb_typeof(extra->'newCustomers')='number') then (extra->>'newCustomers')::numeric end),
             'abandonedCheckoutCount', sum(case when (p_platform='shopify' and jsonb_typeof(extra->'abandonedCheckoutCount')='number') then (extra->>'abandonedCheckoutCount')::numeric end),
             'abandonedCheckoutValue', sum(case when (p_platform='shopify' and jsonb_typeof(extra->'abandonedCheckoutValue')='number') then (extra->>'abandonedCheckoutValue')::numeric end)
           )) xm
    from public.metrics_daily
    where client_id=p_client_id and platform=p_platform and breakdown_type=p_breakdown_type
      and entity_level=p_entity_level and date>=p_start and date<=p_end
      and (p_parent_entity_id is null or parent_entity_id=p_parent_entity_id)
      and (p_entity_id  is null or entity_id=p_entity_id)
    group by coalesce(breakdown_value,'')
  ), ranked as (
    select bv, spend, impressions, clicks, conversions, conversion_value, revenue, xm,
           case when nparents=1 then one_parent else null end AS parent_entity_id,
           -- The six COLUMN metrics keep their exact prior expressions, so every existing rankBy ranks
           -- byte-identically. Anything else is looked up in the group's own extra_metrics: present → rank by
           -- it; absent → NULL, which the ORDER BY sinks with `nulls last`. Deliberately NOT coalesced to
           -- spend: a silent fallback would rank by money and label it sessions.
           case when p_rank_by in ('spend','impressions','clicks','conversions','conversionValue','revenue')
                then (case p_rank_by
                        when 'impressions' then impressions::numeric when 'clicks' then clicks::numeric
                        when 'conversions' then conversions when 'conversionValue' then conversion_value
                        when 'revenue' then revenue else spend end)
                when jsonb_typeof(xm -> p_rank_by) = 'number' then (xm ->> p_rank_by)::numeric
                else null end AS rk
    from per_value
  )
  select jsonb_build_object(
    'total_groups', (select count(*) from per_value),
    'rows', coalesce((
      select jsonb_agg(jsonb_build_object(
               'breakdown_value', bv, 'parent_entity_id', parent_entity_id,
               'spend', spend, 'impressions', impressions, 'clicks', clicks,
               'conversions', conversions, 'conversion_value', conversion_value, 'revenue', revenue,
               'extra_metrics', xm))
      from (
        select * from ranked
        order by case when p_order_dir='asc' then rk end asc nulls last,
                 case when p_order_dir='asc' then null else rk end desc nulls last,
                 bv asc
        limit greatest(p_top_n, 1)
      ) t), '[]'::jsonb));
$$;

-- ── GRANT POSTURE, RE-ASSERTED (LORAMER_RPC_GRANT_POSTURE_V1, migration 065) ──────────────────────────────
-- ⛔ A NO-OP TODAY AND WRITTEN ANYWAY, ON PURPOSE. CREATE OR REPLACE preserves the existing ACL, so these two
-- functions already stand at `postgres=X | service_role=X` (verified against pg_proc.proacl immediately after
-- this migration applied). The block is here because the posture guard's rule is not "prove it is fine now" —
-- it is "every migration that touches a public function states the end state it wants", so that a later hand
-- edit, a revert to 038/039, or a DROP typed straight into the SQL editor cannot leave a client-scoped reader
-- anon-callable with nothing in migrations/ recording that it ever should not have been.
-- ⛔ REVOKING FROM public IS NOT ENOUGH: Supabase grants EXECUTE to anon and authenticated as EXPLICIT role
-- grants, which a PUBLIC revoke does not touch. Measured 2026-08-13 — that is precisely how 15 of 21 public
-- functions came to be anon-callable. All three revokes, then the one grant that is actually wanted.
revoke all on function public.query_breakdown_agg(uuid,text,text,text,date,date,text,text) from public;
revoke all on function public.query_breakdown_agg(uuid,text,text,text,date,date,text,text) from anon;
revoke all on function public.query_breakdown_agg(uuid,text,text,text,date,date,text,text) from authenticated;
grant execute on function public.query_breakdown_agg(uuid,text,text,text,date,date,text,text) to service_role;
revoke all on function public.query_breakdown_agg_topn(uuid,text,text,text,date,date,text,int,text,text,text) from public;
revoke all on function public.query_breakdown_agg_topn(uuid,text,text,text,date,date,text,int,text,text,text) from anon;
revoke all on function public.query_breakdown_agg_topn(uuid,text,text,text,date,date,text,int,text,text,text) from authenticated;
grant execute on function public.query_breakdown_agg_topn(uuid,text,text,text,date,date,text,int,text,text,text) to service_role;
