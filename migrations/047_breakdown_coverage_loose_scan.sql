-- 047_breakdown_coverage_loose_scan.sql — LORAMER_COVERAGE_BREAKDOWN_GRAIN_V1, performance repair.
--
-- ⚠ APPLIED 2026-07-30, immediately after 046 failed its own first production call.
--
-- WHAT HAPPENED, MEASURED NOT PREDICTED. 046 shipped with `SELECT DISTINCT m.date` over the breakdown rows plus a
-- second grouped pass for per-family first/last. On the very first real call — Foam OH GA, 2023-07-01..2025-12-31,
-- ~2.3M breakdown rows — it took **8,698ms and 8,271ms** against the 8s PostgREST statement_timeout and returned
-- null. The resolver answered UNKNOWN, which is correct and is exactly why the fallback is UNKNOWN rather than an
-- optimistic COMPLETE — but an instrument that times out on the heaviest client is an instrument that goes quiet
-- precisely where it is most needed. 046's own header warned about this ceiling and then walked into it.
--
-- ROOT: PG15 has no skip-scan, so DISTINCT over (client, platform, date) reads EVERY breakdown row — one per
-- breakdown_VALUE per family per day — only to collapse ~2.3M rows to ~915 distinct dates. Same shape as the
-- realAgg timeout fixed in 037.
--
-- FIX: the pattern already banked in 037 (LORAMER_NEXT_READINESS_LOOSE_SCAN_V1) — a recursive LOOSE INDEX SCAN
-- over the EXISTING index idx_metrics_daily_client_platform_bt_level_date
-- (client_id, platform, breakdown_type, entity_level, date). Seek the first (breakdown_type, entity_level, date)
-- tuple, then repeatedly seek the next strictly-greater one. That reads one row per DISTINCT combo (~12 families
-- × 1 level × ~915 days ≈ 11k seeks) instead of 2.3M rows, and it yields BOTH result sets from ONE pass: the
-- distinct dates AND the per-family first/last/days. 046 needed two separate scans for those.
-- No new index, no schema change, no grant change, no write. Adapted, not invented — 037 is the precedent.
--
-- IDENTICAL-OUTPUT PROOF: metrics_daily.platform, entity_level and breakdown_type are all NOT NULL
-- (breakdown_type defaults ''), and date is NOT NULL, so a row-value skip-scan enumerates EXACTLY the DISTINCT
-- (breakdown_type, entity_level, date) set for the client+platform+range. The dates projected from it are
-- therefore exactly the DISTINCT dates 046 computed, and the per-family aggregates are computed over the same
-- set. Verified empirically against 046's output before this replaced it.
--
-- Blast radius: READ-ONLY, one CREATE OR REPLACE of a function nothing is wired to yet. No table, no ALTER,
-- no DROP, no GRANT, no write. REVERT = re-run 046.

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
  WITH RECURSIVE base AS (
    -- Base grain is small (one row per day) and already indexed — a plain scan is correct here.
    -- ⛔ The activity predicate is PER-PLATFORM per DECISIONS "ACTIVE DAYS ARE THE DENOMINATOR" (do not
    -- relitigate): ad platforms spend>0, stores revenue>0, GA4 sessions>0. A union would manufacture false gaps.
    -- ⛔ DISTINCT IS LOAD-BEARING, and it was missing in the first cut of this file. The account-row-per-day
    -- invariant is VIOLATED on real clients (733 baselined violations, ★ACCOUNT-ROW-PER-DAY), so a client can hold
    -- MORE THAN ONE account base row for the same day. MEASURED: Veterinary mastermind / meta returned 181 base
    -- rows over 173 distinct days — 8 duplicates — and the first fleet read reported "baseActive 181, breakdown
    -- 173, holes 0", which is arithmetically impossible and is what exposed this. The VERDICT was still right
    -- (every distinct day did carry breakdown rows) but the DENOMINATOR was inflated, and a completeness
    -- instrument that reports a number that cannot be reconciled is worse than one that reports nothing.
    SELECT DISTINCT m.date
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
            ELSE                    COALESCE(m.spend, 0) > 0
          END
  ),
  combos (breakdown_type, entity_level, date) AS (
    -- seed: the client's minimum (breakdown_type, entity_level, date) in range, one index seek
    (
      SELECT m.breakdown_type, m.entity_level, m.date
      FROM public.metrics_daily m
      WHERE m.client_id = p_client_id
        AND m.platform = p_platform
        AND m.breakdown_type <> ''
        AND m.date BETWEEN p_start AND p_end
      ORDER BY m.breakdown_type, m.entity_level, m.date
      LIMIT 1
    )
    UNION ALL
    -- step: the next strictly-greater tuple — one seek per DISTINCT combo, skipping every breakdown_value row
    SELECT n.breakdown_type, n.entity_level, n.date
    FROM combos t
    CROSS JOIN LATERAL (
      SELECT m.breakdown_type, m.entity_level, m.date
      FROM public.metrics_daily m
      WHERE m.client_id = p_client_id
        AND m.platform = p_platform
        AND m.breakdown_type <> ''
        AND m.date BETWEEN p_start AND p_end
        AND (m.breakdown_type, m.entity_level, m.date) > (t.breakdown_type, t.entity_level, t.date)
      ORDER BY m.breakdown_type, m.entity_level, m.date
      LIMIT 1
    ) n
  )
  SELECT
    COALESCE((SELECT array_agg(date ORDER BY date) FROM base), '{}'::date[]),
    COALESCE((SELECT array_agg(d ORDER BY d) FROM (SELECT DISTINCT date AS d FROM combos) x), '{}'::date[]),
    COALESCE((SELECT jsonb_agg(jsonb_build_object(
                'breakdown_type', breakdown_type, 'first_date', first_date,
                'last_date', last_date, 'days', days) ORDER BY breakdown_type)
              FROM (
                SELECT breakdown_type, MIN(date) AS first_date, MAX(date) AS last_date,
                       COUNT(DISTINCT date) AS days
                FROM combos GROUP BY breakdown_type
              ) f), '[]'::jsonb);
$$;

COMMENT ON FUNCTION public.breakdown_coverage_days(uuid, text, date, date) IS
  'LORAMER_COVERAGE_BREAKDOWN_GRAIN_V1 (047 loose-index-scan) - read-only. Returns the base-ACTIVE day set, the DISTINCT breakdown day set, and per-family first/last/days for one (client, platform, window), all from ONE recursive skip-scan over idx_metrics_daily_client_platform_bt_level_date. 046 used DISTINCT and hit the 8s statement_timeout on Foam OH (8698ms). The caller diffs the two arrays; a base-active day absent from the breakdown set is a hole.';

-- REVERT: re-run migrations/046_breakdown_coverage_rpc.sql
