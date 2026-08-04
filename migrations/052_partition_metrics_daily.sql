-- LORAMER_PARTITION_METRICS_DAILY_V1 — Phase 2 DDL. Design: docs/LORAMER_PARTITION_METRICS_DAILY_DESIGN_V1.md
--
-- ⛔ THIS CREATES A NEW TABLE ALONGSIDE THE OLD ONE. It does NOT swap, does NOT rename, does NOT drop.
-- metrics_daily is untouched by this migration. The swap is a separate, later, human-gated step.
--
-- ⛔ THREE THINGS THAT MUST MATCH THE ORIGINAL EXACTLY, verified against the catalog after apply:
--   1. RLS ENABLED WITH ZERO POLICIES. relrowsecurity=true on metrics_daily today with an empty
--      pg_policy. That is deny-all except service_role — NOT "RLS off". A new table without it would
--      silently become readable by roles that cannot read it today. Most dangerous detail in the swap.
--   2. The 7-column UNIQUE conflict key, with `date` at position 5, unchanged — every writer
--      (upsertMetricsChunked) conflicts on it and must keep working byte-for-byte.
--   3. Column defaults and NOT NULL flags, all 34 columns.
--
-- ⛔ PRIMARY KEY IS (id, date), NOT (id). PostgreSQL 17 requires the partition key inside every unique
-- constraint and has no global indexes, so PRIMARY KEY (id) is illegal on a partitioned table. Russ
-- decided to keep `id` rather than drop it.
--
-- ⛔ `id` DRAWS FROM THE ORIGINAL TABLE'S SEQUENCE, deliberately. metrics_daily.id is GENERATED ALWAYS
-- AS IDENTITY (seq public.metrics_daily_id_seq, last_value 1,384,447,634 at authoring time). Sharing one
-- sequence means dual-write cannot collide, and the backfill can insert explicit historical ids — which
-- GENERATED ALWAYS would have refused without OVERRIDING SYSTEM VALUE.

CREATE TABLE IF NOT EXISTS public.metrics_daily_p (
  id                        bigint    NOT NULL DEFAULT nextval('public.metrics_daily_id_seq'),
  client_id                 uuid      NOT NULL,
  user_email                text      NOT NULL,
  platform                  text      NOT NULL,
  entity_level              text      NOT NULL,
  entity_id                 text      NOT NULL,
  entity_name               text,
  parent_entity_id          text,
  date                      date      NOT NULL,
  breakdown_type            text      NOT NULL DEFAULT ''::text,
  breakdown_value           text      NOT NULL DEFAULT ''::text,
  spend                     numeric   NOT NULL DEFAULT 0,
  impressions               bigint    NOT NULL DEFAULT 0,
  clicks                    bigint    NOT NULL DEFAULT 0,
  conversions               numeric   NOT NULL DEFAULT 0,
  conversion_value          numeric   NOT NULL DEFAULT 0,
  revenue                   numeric   NOT NULL DEFAULT 0,
  extra                     jsonb,
  raw                       jsonb,
  synced_at                 timestamptz NOT NULL DEFAULT now(),
  account_id                text,
  video_plays               numeric,
  video_thruplays           numeric,
  video_p25                 numeric,
  video_p50                 numeric,
  video_p75                 numeric,
  video_p95                 numeric,
  video_p100                numeric,
  video_30s                 numeric,
  video_avg_time_sec        numeric,
  cost_per_thruplay         numeric,
  all_conversions           numeric,
  all_conversions_value     numeric,
  view_through_conversions  numeric,
  CONSTRAINT metrics_daily_p_pkey PRIMARY KEY (id, date),
  CONSTRAINT metrics_daily_p_natural_key UNIQUE (client_id, platform, entity_level, entity_id, date, breakdown_type, breakdown_value)
) PARTITION BY RANGE (date);

-- ⛔ RLS: enable, and create NO policies. This reproduces metrics_daily exactly.
ALTER TABLE public.metrics_daily_p ENABLE ROW LEVEL SECURITY;

-- The five non-constraint indexes, same shapes as the original. Created on the parent so every
-- partition inherits them; `date` is already in each one's trailing position.
CREATE INDEX IF NOT EXISTS idx_mdp_client_platform_date        ON public.metrics_daily_p (client_id, platform, date);
CREATE INDEX IF NOT EXISTS idx_mdp_client_platform_level_date  ON public.metrics_daily_p (client_id, platform, entity_level, date);
CREATE INDEX IF NOT EXISTS idx_mdp_client_platform_bt_lvl_date ON public.metrics_daily_p (client_id, platform, breakdown_type, entity_level, date);
CREATE INDEX IF NOT EXISTS idx_mdp_account_canonical           ON public.metrics_daily_p (client_id, date) INCLUDE (platform, spend, revenue)
  WHERE entity_level = 'account'::text AND breakdown_type = ''::text AND breakdown_value = ''::text;

-- ⛔ DEFAULT PARTITION: an out-of-range date is CAUGHT, never rejected. A write that would otherwise
-- fail with "no partition of relation found" lands here and is visible, which is the honest failure.
CREATE TABLE IF NOT EXISTS public.metrics_daily_p_default PARTITION OF public.metrics_daily_p DEFAULT;

CREATE TABLE IF NOT EXISTS public.metrics_daily_p_2016_01 PARTITION OF public.metrics_daily_p FOR VALUES FROM ('2016-01-01') TO ('2016-02-01');
CREATE TABLE IF NOT EXISTS public.metrics_daily_p_2016_02 PARTITION OF public.metrics_daily_p FOR VALUES FROM ('2016-02-01') TO ('2016-03-01');
CREATE TABLE IF NOT EXISTS public.metrics_daily_p_2016_03 PARTITION OF public.metrics_daily_p FOR VALUES FROM ('2016-03-01') TO ('2016-04-01');
CREATE TABLE IF NOT EXISTS public.metrics_daily_p_2016_04 PARTITION OF public.metrics_daily_p FOR VALUES FROM ('2016-04-01') TO ('2016-05-01');
CREATE TABLE IF NOT EXISTS public.metrics_daily_p_2016_05 PARTITION OF public.metrics_daily_p FOR VALUES FROM ('2016-05-01') TO ('2016-06-01');
CREATE TABLE IF NOT EXISTS public.metrics_daily_p_2016_06 PARTITION OF public.metrics_daily_p FOR VALUES FROM ('2016-06-01') TO ('2016-07-01');
CREATE TABLE IF NOT EXISTS public.metrics_daily_p_2016_07 PARTITION OF public.metrics_daily_p FOR VALUES FROM ('2016-07-01') TO ('2016-08-01');
CREATE TABLE IF NOT EXISTS public.metrics_daily_p_2016_08 PARTITION OF public.metrics_daily_p FOR VALUES FROM ('2016-08-01') TO ('2016-09-01');
CREATE TABLE IF NOT EXISTS public.metrics_daily_p_2016_09 PARTITION OF public.metrics_daily_p FOR VALUES FROM ('2016-09-01') TO ('2016-10-01');
CREATE TABLE IF NOT EXISTS public.metrics_daily_p_2016_10 PARTITION OF public.metrics_daily_p FOR VALUES FROM ('2016-10-01') TO ('2016-11-01');
CREATE TABLE IF NOT EXISTS public.metrics_daily_p_2016_11 PARTITION OF public.metrics_daily_p FOR VALUES FROM ('2016-11-01') TO ('2016-12-01');
CREATE TABLE IF NOT EXISTS public.metrics_daily_p_2016_12 PARTITION OF public.metrics_daily_p FOR VALUES FROM ('2016-12-01') TO ('2017-01-01');
CREATE TABLE IF NOT EXISTS public.metrics_daily_p_2017_01 PARTITION OF public.metrics_daily_p FOR VALUES FROM ('2017-01-01') TO ('2017-02-01');
CREATE TABLE IF NOT EXISTS public.metrics_daily_p_2017_02 PARTITION OF public.metrics_daily_p FOR VALUES FROM ('2017-02-01') TO ('2017-03-01');
CREATE TABLE IF NOT EXISTS public.metrics_daily_p_2017_03 PARTITION OF public.metrics_daily_p FOR VALUES FROM ('2017-03-01') TO ('2017-04-01');
CREATE TABLE IF NOT EXISTS public.metrics_daily_p_2017_04 PARTITION OF public.metrics_daily_p FOR VALUES FROM ('2017-04-01') TO ('2017-05-01');
CREATE TABLE IF NOT EXISTS public.metrics_daily_p_2017_05 PARTITION OF public.metrics_daily_p FOR VALUES FROM ('2017-05-01') TO ('2017-06-01');
CREATE TABLE IF NOT EXISTS public.metrics_daily_p_2017_06 PARTITION OF public.metrics_daily_p FOR VALUES FROM ('2017-06-01') TO ('2017-07-01');
CREATE TABLE IF NOT EXISTS public.metrics_daily_p_2017_07 PARTITION OF public.metrics_daily_p FOR VALUES FROM ('2017-07-01') TO ('2017-08-01');
CREATE TABLE IF NOT EXISTS public.metrics_daily_p_2017_08 PARTITION OF public.metrics_daily_p FOR VALUES FROM ('2017-08-01') TO ('2017-09-01');
CREATE TABLE IF NOT EXISTS public.metrics_daily_p_2017_09 PARTITION OF public.metrics_daily_p FOR VALUES FROM ('2017-09-01') TO ('2017-10-01');
CREATE TABLE IF NOT EXISTS public.metrics_daily_p_2017_10 PARTITION OF public.metrics_daily_p FOR VALUES FROM ('2017-10-01') TO ('2017-11-01');
CREATE TABLE IF NOT EXISTS public.metrics_daily_p_2017_11 PARTITION OF public.metrics_daily_p FOR VALUES FROM ('2017-11-01') TO ('2017-12-01');
CREATE TABLE IF NOT EXISTS public.metrics_daily_p_2017_12 PARTITION OF public.metrics_daily_p FOR VALUES FROM ('2017-12-01') TO ('2018-01-01');
CREATE TABLE IF NOT EXISTS public.metrics_daily_p_2018_01 PARTITION OF public.metrics_daily_p FOR VALUES FROM ('2018-01-01') TO ('2018-02-01');
CREATE TABLE IF NOT EXISTS public.metrics_daily_p_2018_02 PARTITION OF public.metrics_daily_p FOR VALUES FROM ('2018-02-01') TO ('2018-03-01');
CREATE TABLE IF NOT EXISTS public.metrics_daily_p_2018_03 PARTITION OF public.metrics_daily_p FOR VALUES FROM ('2018-03-01') TO ('2018-04-01');
CREATE TABLE IF NOT EXISTS public.metrics_daily_p_2018_04 PARTITION OF public.metrics_daily_p FOR VALUES FROM ('2018-04-01') TO ('2018-05-01');
CREATE TABLE IF NOT EXISTS public.metrics_daily_p_2018_05 PARTITION OF public.metrics_daily_p FOR VALUES FROM ('2018-05-01') TO ('2018-06-01');
CREATE TABLE IF NOT EXISTS public.metrics_daily_p_2018_06 PARTITION OF public.metrics_daily_p FOR VALUES FROM ('2018-06-01') TO ('2018-07-01');
CREATE TABLE IF NOT EXISTS public.metrics_daily_p_2018_07 PARTITION OF public.metrics_daily_p FOR VALUES FROM ('2018-07-01') TO ('2018-08-01');
CREATE TABLE IF NOT EXISTS public.metrics_daily_p_2018_08 PARTITION OF public.metrics_daily_p FOR VALUES FROM ('2018-08-01') TO ('2018-09-01');
CREATE TABLE IF NOT EXISTS public.metrics_daily_p_2018_09 PARTITION OF public.metrics_daily_p FOR VALUES FROM ('2018-09-01') TO ('2018-10-01');
CREATE TABLE IF NOT EXISTS public.metrics_daily_p_2018_10 PARTITION OF public.metrics_daily_p FOR VALUES FROM ('2018-10-01') TO ('2018-11-01');
CREATE TABLE IF NOT EXISTS public.metrics_daily_p_2018_11 PARTITION OF public.metrics_daily_p FOR VALUES FROM ('2018-11-01') TO ('2018-12-01');
CREATE TABLE IF NOT EXISTS public.metrics_daily_p_2018_12 PARTITION OF public.metrics_daily_p FOR VALUES FROM ('2018-12-01') TO ('2019-01-01');
CREATE TABLE IF NOT EXISTS public.metrics_daily_p_2019_01 PARTITION OF public.metrics_daily_p FOR VALUES FROM ('2019-01-01') TO ('2019-02-01');
CREATE TABLE IF NOT EXISTS public.metrics_daily_p_2019_02 PARTITION OF public.metrics_daily_p FOR VALUES FROM ('2019-02-01') TO ('2019-03-01');
CREATE TABLE IF NOT EXISTS public.metrics_daily_p_2019_03 PARTITION OF public.metrics_daily_p FOR VALUES FROM ('2019-03-01') TO ('2019-04-01');
CREATE TABLE IF NOT EXISTS public.metrics_daily_p_2019_04 PARTITION OF public.metrics_daily_p FOR VALUES FROM ('2019-04-01') TO ('2019-05-01');
CREATE TABLE IF NOT EXISTS public.metrics_daily_p_2019_05 PARTITION OF public.metrics_daily_p FOR VALUES FROM ('2019-05-01') TO ('2019-06-01');
CREATE TABLE IF NOT EXISTS public.metrics_daily_p_2019_06 PARTITION OF public.metrics_daily_p FOR VALUES FROM ('2019-06-01') TO ('2019-07-01');
CREATE TABLE IF NOT EXISTS public.metrics_daily_p_2019_07 PARTITION OF public.metrics_daily_p FOR VALUES FROM ('2019-07-01') TO ('2019-08-01');
CREATE TABLE IF NOT EXISTS public.metrics_daily_p_2019_08 PARTITION OF public.metrics_daily_p FOR VALUES FROM ('2019-08-01') TO ('2019-09-01');
CREATE TABLE IF NOT EXISTS public.metrics_daily_p_2019_09 PARTITION OF public.metrics_daily_p FOR VALUES FROM ('2019-09-01') TO ('2019-10-01');
CREATE TABLE IF NOT EXISTS public.metrics_daily_p_2019_10 PARTITION OF public.metrics_daily_p FOR VALUES FROM ('2019-10-01') TO ('2019-11-01');
CREATE TABLE IF NOT EXISTS public.metrics_daily_p_2019_11 PARTITION OF public.metrics_daily_p FOR VALUES FROM ('2019-11-01') TO ('2019-12-01');
CREATE TABLE IF NOT EXISTS public.metrics_daily_p_2019_12 PARTITION OF public.metrics_daily_p FOR VALUES FROM ('2019-12-01') TO ('2020-01-01');
CREATE TABLE IF NOT EXISTS public.metrics_daily_p_2020_01 PARTITION OF public.metrics_daily_p FOR VALUES FROM ('2020-01-01') TO ('2020-02-01');
CREATE TABLE IF NOT EXISTS public.metrics_daily_p_2020_02 PARTITION OF public.metrics_daily_p FOR VALUES FROM ('2020-02-01') TO ('2020-03-01');
CREATE TABLE IF NOT EXISTS public.metrics_daily_p_2020_03 PARTITION OF public.metrics_daily_p FOR VALUES FROM ('2020-03-01') TO ('2020-04-01');
CREATE TABLE IF NOT EXISTS public.metrics_daily_p_2020_04 PARTITION OF public.metrics_daily_p FOR VALUES FROM ('2020-04-01') TO ('2020-05-01');
CREATE TABLE IF NOT EXISTS public.metrics_daily_p_2020_05 PARTITION OF public.metrics_daily_p FOR VALUES FROM ('2020-05-01') TO ('2020-06-01');
CREATE TABLE IF NOT EXISTS public.metrics_daily_p_2020_06 PARTITION OF public.metrics_daily_p FOR VALUES FROM ('2020-06-01') TO ('2020-07-01');
CREATE TABLE IF NOT EXISTS public.metrics_daily_p_2020_07 PARTITION OF public.metrics_daily_p FOR VALUES FROM ('2020-07-01') TO ('2020-08-01');
CREATE TABLE IF NOT EXISTS public.metrics_daily_p_2020_08 PARTITION OF public.metrics_daily_p FOR VALUES FROM ('2020-08-01') TO ('2020-09-01');
CREATE TABLE IF NOT EXISTS public.metrics_daily_p_2020_09 PARTITION OF public.metrics_daily_p FOR VALUES FROM ('2020-09-01') TO ('2020-10-01');
CREATE TABLE IF NOT EXISTS public.metrics_daily_p_2020_10 PARTITION OF public.metrics_daily_p FOR VALUES FROM ('2020-10-01') TO ('2020-11-01');
CREATE TABLE IF NOT EXISTS public.metrics_daily_p_2020_11 PARTITION OF public.metrics_daily_p FOR VALUES FROM ('2020-11-01') TO ('2020-12-01');
CREATE TABLE IF NOT EXISTS public.metrics_daily_p_2020_12 PARTITION OF public.metrics_daily_p FOR VALUES FROM ('2020-12-01') TO ('2021-01-01');
CREATE TABLE IF NOT EXISTS public.metrics_daily_p_2021_01 PARTITION OF public.metrics_daily_p FOR VALUES FROM ('2021-01-01') TO ('2021-02-01');
CREATE TABLE IF NOT EXISTS public.metrics_daily_p_2021_02 PARTITION OF public.metrics_daily_p FOR VALUES FROM ('2021-02-01') TO ('2021-03-01');
CREATE TABLE IF NOT EXISTS public.metrics_daily_p_2021_03 PARTITION OF public.metrics_daily_p FOR VALUES FROM ('2021-03-01') TO ('2021-04-01');
CREATE TABLE IF NOT EXISTS public.metrics_daily_p_2021_04 PARTITION OF public.metrics_daily_p FOR VALUES FROM ('2021-04-01') TO ('2021-05-01');
CREATE TABLE IF NOT EXISTS public.metrics_daily_p_2021_05 PARTITION OF public.metrics_daily_p FOR VALUES FROM ('2021-05-01') TO ('2021-06-01');
CREATE TABLE IF NOT EXISTS public.metrics_daily_p_2021_06 PARTITION OF public.metrics_daily_p FOR VALUES FROM ('2021-06-01') TO ('2021-07-01');
CREATE TABLE IF NOT EXISTS public.metrics_daily_p_2021_07 PARTITION OF public.metrics_daily_p FOR VALUES FROM ('2021-07-01') TO ('2021-08-01');
CREATE TABLE IF NOT EXISTS public.metrics_daily_p_2021_08 PARTITION OF public.metrics_daily_p FOR VALUES FROM ('2021-08-01') TO ('2021-09-01');
CREATE TABLE IF NOT EXISTS public.metrics_daily_p_2021_09 PARTITION OF public.metrics_daily_p FOR VALUES FROM ('2021-09-01') TO ('2021-10-01');
CREATE TABLE IF NOT EXISTS public.metrics_daily_p_2021_10 PARTITION OF public.metrics_daily_p FOR VALUES FROM ('2021-10-01') TO ('2021-11-01');
CREATE TABLE IF NOT EXISTS public.metrics_daily_p_2021_11 PARTITION OF public.metrics_daily_p FOR VALUES FROM ('2021-11-01') TO ('2021-12-01');
CREATE TABLE IF NOT EXISTS public.metrics_daily_p_2021_12 PARTITION OF public.metrics_daily_p FOR VALUES FROM ('2021-12-01') TO ('2022-01-01');
CREATE TABLE IF NOT EXISTS public.metrics_daily_p_2022_01 PARTITION OF public.metrics_daily_p FOR VALUES FROM ('2022-01-01') TO ('2022-02-01');
CREATE TABLE IF NOT EXISTS public.metrics_daily_p_2022_02 PARTITION OF public.metrics_daily_p FOR VALUES FROM ('2022-02-01') TO ('2022-03-01');
CREATE TABLE IF NOT EXISTS public.metrics_daily_p_2022_03 PARTITION OF public.metrics_daily_p FOR VALUES FROM ('2022-03-01') TO ('2022-04-01');
CREATE TABLE IF NOT EXISTS public.metrics_daily_p_2022_04 PARTITION OF public.metrics_daily_p FOR VALUES FROM ('2022-04-01') TO ('2022-05-01');
CREATE TABLE IF NOT EXISTS public.metrics_daily_p_2022_05 PARTITION OF public.metrics_daily_p FOR VALUES FROM ('2022-05-01') TO ('2022-06-01');
CREATE TABLE IF NOT EXISTS public.metrics_daily_p_2022_06 PARTITION OF public.metrics_daily_p FOR VALUES FROM ('2022-06-01') TO ('2022-07-01');
CREATE TABLE IF NOT EXISTS public.metrics_daily_p_2022_07 PARTITION OF public.metrics_daily_p FOR VALUES FROM ('2022-07-01') TO ('2022-08-01');
CREATE TABLE IF NOT EXISTS public.metrics_daily_p_2022_08 PARTITION OF public.metrics_daily_p FOR VALUES FROM ('2022-08-01') TO ('2022-09-01');
CREATE TABLE IF NOT EXISTS public.metrics_daily_p_2022_09 PARTITION OF public.metrics_daily_p FOR VALUES FROM ('2022-09-01') TO ('2022-10-01');
CREATE TABLE IF NOT EXISTS public.metrics_daily_p_2022_10 PARTITION OF public.metrics_daily_p FOR VALUES FROM ('2022-10-01') TO ('2022-11-01');
CREATE TABLE IF NOT EXISTS public.metrics_daily_p_2022_11 PARTITION OF public.metrics_daily_p FOR VALUES FROM ('2022-11-01') TO ('2022-12-01');
CREATE TABLE IF NOT EXISTS public.metrics_daily_p_2022_12 PARTITION OF public.metrics_daily_p FOR VALUES FROM ('2022-12-01') TO ('2023-01-01');
CREATE TABLE IF NOT EXISTS public.metrics_daily_p_2023_01 PARTITION OF public.metrics_daily_p FOR VALUES FROM ('2023-01-01') TO ('2023-02-01');
CREATE TABLE IF NOT EXISTS public.metrics_daily_p_2023_02 PARTITION OF public.metrics_daily_p FOR VALUES FROM ('2023-02-01') TO ('2023-03-01');
CREATE TABLE IF NOT EXISTS public.metrics_daily_p_2023_03 PARTITION OF public.metrics_daily_p FOR VALUES FROM ('2023-03-01') TO ('2023-04-01');
CREATE TABLE IF NOT EXISTS public.metrics_daily_p_2023_04 PARTITION OF public.metrics_daily_p FOR VALUES FROM ('2023-04-01') TO ('2023-05-01');
CREATE TABLE IF NOT EXISTS public.metrics_daily_p_2023_05 PARTITION OF public.metrics_daily_p FOR VALUES FROM ('2023-05-01') TO ('2023-06-01');
CREATE TABLE IF NOT EXISTS public.metrics_daily_p_2023_06 PARTITION OF public.metrics_daily_p FOR VALUES FROM ('2023-06-01') TO ('2023-07-01');
CREATE TABLE IF NOT EXISTS public.metrics_daily_p_2023_07 PARTITION OF public.metrics_daily_p FOR VALUES FROM ('2023-07-01') TO ('2023-08-01');
CREATE TABLE IF NOT EXISTS public.metrics_daily_p_2023_08 PARTITION OF public.metrics_daily_p FOR VALUES FROM ('2023-08-01') TO ('2023-09-01');
CREATE TABLE IF NOT EXISTS public.metrics_daily_p_2023_09 PARTITION OF public.metrics_daily_p FOR VALUES FROM ('2023-09-01') TO ('2023-10-01');
CREATE TABLE IF NOT EXISTS public.metrics_daily_p_2023_10 PARTITION OF public.metrics_daily_p FOR VALUES FROM ('2023-10-01') TO ('2023-11-01');
CREATE TABLE IF NOT EXISTS public.metrics_daily_p_2023_11 PARTITION OF public.metrics_daily_p FOR VALUES FROM ('2023-11-01') TO ('2023-12-01');
CREATE TABLE IF NOT EXISTS public.metrics_daily_p_2023_12 PARTITION OF public.metrics_daily_p FOR VALUES FROM ('2023-12-01') TO ('2024-01-01');
CREATE TABLE IF NOT EXISTS public.metrics_daily_p_2024_01 PARTITION OF public.metrics_daily_p FOR VALUES FROM ('2024-01-01') TO ('2024-02-01');
CREATE TABLE IF NOT EXISTS public.metrics_daily_p_2024_02 PARTITION OF public.metrics_daily_p FOR VALUES FROM ('2024-02-01') TO ('2024-03-01');
CREATE TABLE IF NOT EXISTS public.metrics_daily_p_2024_03 PARTITION OF public.metrics_daily_p FOR VALUES FROM ('2024-03-01') TO ('2024-04-01');
CREATE TABLE IF NOT EXISTS public.metrics_daily_p_2024_04 PARTITION OF public.metrics_daily_p FOR VALUES FROM ('2024-04-01') TO ('2024-05-01');
CREATE TABLE IF NOT EXISTS public.metrics_daily_p_2024_05 PARTITION OF public.metrics_daily_p FOR VALUES FROM ('2024-05-01') TO ('2024-06-01');
CREATE TABLE IF NOT EXISTS public.metrics_daily_p_2024_06 PARTITION OF public.metrics_daily_p FOR VALUES FROM ('2024-06-01') TO ('2024-07-01');
CREATE TABLE IF NOT EXISTS public.metrics_daily_p_2024_07 PARTITION OF public.metrics_daily_p FOR VALUES FROM ('2024-07-01') TO ('2024-08-01');
CREATE TABLE IF NOT EXISTS public.metrics_daily_p_2024_08 PARTITION OF public.metrics_daily_p FOR VALUES FROM ('2024-08-01') TO ('2024-09-01');
CREATE TABLE IF NOT EXISTS public.metrics_daily_p_2024_09 PARTITION OF public.metrics_daily_p FOR VALUES FROM ('2024-09-01') TO ('2024-10-01');
CREATE TABLE IF NOT EXISTS public.metrics_daily_p_2024_10 PARTITION OF public.metrics_daily_p FOR VALUES FROM ('2024-10-01') TO ('2024-11-01');
CREATE TABLE IF NOT EXISTS public.metrics_daily_p_2024_11 PARTITION OF public.metrics_daily_p FOR VALUES FROM ('2024-11-01') TO ('2024-12-01');
CREATE TABLE IF NOT EXISTS public.metrics_daily_p_2024_12 PARTITION OF public.metrics_daily_p FOR VALUES FROM ('2024-12-01') TO ('2025-01-01');
CREATE TABLE IF NOT EXISTS public.metrics_daily_p_2025_01 PARTITION OF public.metrics_daily_p FOR VALUES FROM ('2025-01-01') TO ('2025-02-01');
CREATE TABLE IF NOT EXISTS public.metrics_daily_p_2025_02 PARTITION OF public.metrics_daily_p FOR VALUES FROM ('2025-02-01') TO ('2025-03-01');
CREATE TABLE IF NOT EXISTS public.metrics_daily_p_2025_03 PARTITION OF public.metrics_daily_p FOR VALUES FROM ('2025-03-01') TO ('2025-04-01');
CREATE TABLE IF NOT EXISTS public.metrics_daily_p_2025_04 PARTITION OF public.metrics_daily_p FOR VALUES FROM ('2025-04-01') TO ('2025-05-01');
CREATE TABLE IF NOT EXISTS public.metrics_daily_p_2025_05 PARTITION OF public.metrics_daily_p FOR VALUES FROM ('2025-05-01') TO ('2025-06-01');
CREATE TABLE IF NOT EXISTS public.metrics_daily_p_2025_06 PARTITION OF public.metrics_daily_p FOR VALUES FROM ('2025-06-01') TO ('2025-07-01');
CREATE TABLE IF NOT EXISTS public.metrics_daily_p_2025_07 PARTITION OF public.metrics_daily_p FOR VALUES FROM ('2025-07-01') TO ('2025-08-01');
CREATE TABLE IF NOT EXISTS public.metrics_daily_p_2025_08 PARTITION OF public.metrics_daily_p FOR VALUES FROM ('2025-08-01') TO ('2025-09-01');
CREATE TABLE IF NOT EXISTS public.metrics_daily_p_2025_09 PARTITION OF public.metrics_daily_p FOR VALUES FROM ('2025-09-01') TO ('2025-10-01');
CREATE TABLE IF NOT EXISTS public.metrics_daily_p_2025_10 PARTITION OF public.metrics_daily_p FOR VALUES FROM ('2025-10-01') TO ('2025-11-01');
CREATE TABLE IF NOT EXISTS public.metrics_daily_p_2025_11 PARTITION OF public.metrics_daily_p FOR VALUES FROM ('2025-11-01') TO ('2025-12-01');
CREATE TABLE IF NOT EXISTS public.metrics_daily_p_2025_12 PARTITION OF public.metrics_daily_p FOR VALUES FROM ('2025-12-01') TO ('2026-01-01');
CREATE TABLE IF NOT EXISTS public.metrics_daily_p_2026_01 PARTITION OF public.metrics_daily_p FOR VALUES FROM ('2026-01-01') TO ('2026-02-01');
CREATE TABLE IF NOT EXISTS public.metrics_daily_p_2026_02 PARTITION OF public.metrics_daily_p FOR VALUES FROM ('2026-02-01') TO ('2026-03-01');
CREATE TABLE IF NOT EXISTS public.metrics_daily_p_2026_03 PARTITION OF public.metrics_daily_p FOR VALUES FROM ('2026-03-01') TO ('2026-04-01');
CREATE TABLE IF NOT EXISTS public.metrics_daily_p_2026_04 PARTITION OF public.metrics_daily_p FOR VALUES FROM ('2026-04-01') TO ('2026-05-01');
CREATE TABLE IF NOT EXISTS public.metrics_daily_p_2026_05 PARTITION OF public.metrics_daily_p FOR VALUES FROM ('2026-05-01') TO ('2026-06-01');
CREATE TABLE IF NOT EXISTS public.metrics_daily_p_2026_06 PARTITION OF public.metrics_daily_p FOR VALUES FROM ('2026-06-01') TO ('2026-07-01');
CREATE TABLE IF NOT EXISTS public.metrics_daily_p_2026_07 PARTITION OF public.metrics_daily_p FOR VALUES FROM ('2026-07-01') TO ('2026-08-01');
CREATE TABLE IF NOT EXISTS public.metrics_daily_p_2026_08 PARTITION OF public.metrics_daily_p FOR VALUES FROM ('2026-08-01') TO ('2026-09-01');
CREATE TABLE IF NOT EXISTS public.metrics_daily_p_2026_09 PARTITION OF public.metrics_daily_p FOR VALUES FROM ('2026-09-01') TO ('2026-10-01');
CREATE TABLE IF NOT EXISTS public.metrics_daily_p_2026_10 PARTITION OF public.metrics_daily_p FOR VALUES FROM ('2026-10-01') TO ('2026-11-01');
CREATE TABLE IF NOT EXISTS public.metrics_daily_p_2026_11 PARTITION OF public.metrics_daily_p FOR VALUES FROM ('2026-11-01') TO ('2026-12-01');
CREATE TABLE IF NOT EXISTS public.metrics_daily_p_2026_12 PARTITION OF public.metrics_daily_p FOR VALUES FROM ('2026-12-01') TO ('2027-01-01');
CREATE TABLE IF NOT EXISTS public.metrics_daily_p_2027_01 PARTITION OF public.metrics_daily_p FOR VALUES FROM ('2027-01-01') TO ('2027-02-01');
CREATE TABLE IF NOT EXISTS public.metrics_daily_p_2027_02 PARTITION OF public.metrics_daily_p FOR VALUES FROM ('2027-02-01') TO ('2027-03-01');
CREATE TABLE IF NOT EXISTS public.metrics_daily_p_2027_03 PARTITION OF public.metrics_daily_p FOR VALUES FROM ('2027-03-01') TO ('2027-04-01');
CREATE TABLE IF NOT EXISTS public.metrics_daily_p_2027_04 PARTITION OF public.metrics_daily_p FOR VALUES FROM ('2027-04-01') TO ('2027-05-01');
CREATE TABLE IF NOT EXISTS public.metrics_daily_p_2027_05 PARTITION OF public.metrics_daily_p FOR VALUES FROM ('2027-05-01') TO ('2027-06-01');
CREATE TABLE IF NOT EXISTS public.metrics_daily_p_2027_06 PARTITION OF public.metrics_daily_p FOR VALUES FROM ('2027-06-01') TO ('2027-07-01');
CREATE TABLE IF NOT EXISTS public.metrics_daily_p_2027_07 PARTITION OF public.metrics_daily_p FOR VALUES FROM ('2027-07-01') TO ('2027-08-01');
CREATE TABLE IF NOT EXISTS public.metrics_daily_p_2027_08 PARTITION OF public.metrics_daily_p FOR VALUES FROM ('2027-08-01') TO ('2027-09-01');
CREATE TABLE IF NOT EXISTS public.metrics_daily_p_2027_09 PARTITION OF public.metrics_daily_p FOR VALUES FROM ('2027-09-01') TO ('2027-10-01');
CREATE TABLE IF NOT EXISTS public.metrics_daily_p_2027_10 PARTITION OF public.metrics_daily_p FOR VALUES FROM ('2027-10-01') TO ('2027-11-01');
CREATE TABLE IF NOT EXISTS public.metrics_daily_p_2027_11 PARTITION OF public.metrics_daily_p FOR VALUES FROM ('2027-11-01') TO ('2027-12-01');
CREATE TABLE IF NOT EXISTS public.metrics_daily_p_2027_12 PARTITION OF public.metrics_daily_p FOR VALUES FROM ('2027-12-01') TO ('2028-01-01');
