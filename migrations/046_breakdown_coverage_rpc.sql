-- LORAMER_COVERAGE_BREAKDOWN_GRAIN_V1 (migration 046) — distinct-day sets for breakdown-grain completeness.
--
-- ✅ APPLIED TO PRODUCTION (verified live 2026-07-31 by object existence, not by memory).
-- ⛔ THIS HEADER USED TO SAY "NOT APPLIED" AND IT WAS WRONG. A migration file asserting its own applied-state is a
-- doc restating a fact the DATABASE owns (LORAMER_DOCS_NEVER_RESTATE_LIVE_STATE_V1), and six of these were stale at
-- once — read by the next session deciding whether to run them. The applied-state is now checked mechanically in
-- `npm run check:data` (doc-ownership guard), in BOTH directions. Do not restate it here again; if you must note
-- something, note the DATE it was applied, which is tense-locked history and cannot drift.
-- (Historical: authored 2026-07-30 for Russ's approval; APPLIED 2026-07-30 alongside 047.) There is no staging DB (banked law), so this runs
-- against PRODUCTION or not at all. Blast radius: ADDITIVE ONLY — one READ-ONLY function, no table, no ALTER,
-- no DROP of anything existing, no backfill, no write of any kind. Nothing calls it until getBreakdownCoverage
-- is wired to a caller, and today nothing is: the resolver answers UNKNOWN while this is unapplied.
-- REVERT = DROP FUNCTION (bottom of this file).
--
-- WHY IT MUST BE SQL AND NOT CLIENT-SIDE. The question is "which base-active days carry zero breakdown rows",
-- which needs DISTINCT dates over the breakdown rows. Foam OH alone holds ~2.3M GA breakdown rows in the window
-- recovered on 2026-07-30; pulling those dates to de-dup in JS would blow the 8s PostgREST statement_timeout on
-- exactly the largest clients and return null while looking correct — LORAMER_8S_CEILING_AUDIT_V1, the same
-- failure mode the account-grain triple in coverage.ts exists to avoid.
--
-- ⛔ THE BASE PREDICATE IS THE ACCOUNT TRIPLE, DELIBERATELY IDENTICAL to minMaxFor in coverage.ts
-- (entity_level='account' AND breakdown_type='' AND breakdown_value=''). It is what makes migration 035's PARTIAL
-- index usable. Do not "simplify" it — dropping any leg degrades this to a full scan of the client's rows.
--
-- ⛔ THE ACTIVITY PREDICATE IS PER-PLATFORM, AND IT IS NOT MINE TO CHOOSE. DECISIONS 2026-07-30
-- "ACTIVE DAYS ARE THE DENOMINATOR, NEVER ALL CAPTURED DAYS" settles it, do-not-relitigate:
--   Meta / Google (ad platforms) = account-grain spend > 0
--   Shopify / WooCommerce (stores) = account-grain revenue > 0
--   GA4 = account-grain (extra->>'sessions') > 0   [GA4 has no spend; sessions is the only delivery signal]
-- I first wrote this as a UNION of all four signals. That is WRONG and the law says why: counting inactive days
-- MANUFACTURES false gaps by the thousand — the 2026-07-19 Shopify geo false alarm, where geo "lagged" on every
-- store purely because geo rows only exist on days with orders. The union would also have mis-scored the dormant
-- tails the law names explicitly (Foam OH Meta dead from 2025-09-30, Influential Drones from 2025-08-27): a
-- conversions>0 day with spend=0 would enter the denominator and be reported as a hole it is not.
-- A day the platform genuinely did not serve is not a hole; it is not in the denominator at all, which is what
-- makes a dormant account answer UNKNOWN rather than PARTIAL.

CREATE OR REPLACE FUNCTION public.breakdown_coverage_days(
  p_client_id uuid,
  p_platform  text,
  p_start     date,
  p_end       date
)
RETURNS TABLE (
  base_active_days date[],
  breakdown_days   date[],
  families         jsonb
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH base AS (
    SELECT m.date
    FROM public.metrics_daily m
    WHERE m.client_id = p_client_id
      AND m.platform = p_platform
      AND m.entity_level = 'account'
      AND m.breakdown_type = ''
      AND m.breakdown_value = ''
      AND m.date BETWEEN p_start AND p_end
      AND CASE p_platform
            WHEN 'ga'          THEN COALESCE((m.extra->>'sessions')::numeric, 0) > 0
            WHEN 'shopify'     THEN COALESCE(m.revenue, 0) > 0
            WHEN 'woocommerce' THEN COALESCE(m.revenue, 0) > 0
            ELSE                    COALESCE(m.spend, 0) > 0   -- google | meta
          END
  ),
  dims AS (
    SELECT DISTINCT m.date
    FROM public.metrics_daily m
    WHERE m.client_id = p_client_id
      AND m.platform = p_platform
      AND m.breakdown_type IS NOT NULL
      AND m.breakdown_type <> ''
      AND m.date BETWEEN p_start AND p_end
  ),
  fams AS (
    SELECT m.breakdown_type,
           MIN(m.date) AS first_date,
           MAX(m.date) AS last_date,
           COUNT(DISTINCT m.date) AS days
    FROM public.metrics_daily m
    WHERE m.client_id = p_client_id
      AND m.platform = p_platform
      AND m.breakdown_type IS NOT NULL
      AND m.breakdown_type <> ''
      AND m.date BETWEEN p_start AND p_end
    GROUP BY m.breakdown_type
  )
  SELECT
    COALESCE((SELECT array_agg(date ORDER BY date) FROM base), '{}'::date[]),
    COALESCE((SELECT array_agg(date ORDER BY date) FROM dims), '{}'::date[]),
    COALESCE((SELECT jsonb_agg(jsonb_build_object(
                'breakdown_type', breakdown_type, 'first_date', first_date,
                'last_date', last_date, 'days', days) ORDER BY breakdown_type)
              FROM fams), '[]'::jsonb);
$$;

COMMENT ON FUNCTION public.breakdown_coverage_days(uuid, text, date, date) IS
  'LORAMER_COVERAGE_BREAKDOWN_GRAIN_V1 — read-only. Returns the base-ACTIVE day set, the DISTINCT breakdown day set, and per-family first/last/days for one (client, platform, window). The caller diffs the two arrays; a base-active day absent from the breakdown set is a hole. Endpoints cannot see interior holes — this is why the sets are returned whole rather than min/max.';

-- REVERT:
-- DROP FUNCTION IF EXISTS public.breakdown_coverage_days(uuid, text, date, date);
