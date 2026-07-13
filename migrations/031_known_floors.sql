-- 031_known_floors.sql — LORAMER_COMPLETENESS_GATE_V1 F(a). APPLIED to prod 2026-07-13 via MCP apply_migration.
-- Per-(platform[,client override]) capture floor-of-record read by the read-only reconcile engine
-- (src/lib/completeness/reconcile.ts) to distinguish "reached floor" from an our-defect short-of-floor.
-- Additive ONLY; zero touch to metrics_daily / sync_state / platform_connections / capture. Floors below are
-- VERIFIED FROM CODE (cited per row), never guessed.
create table if not exists known_floors (
  id uuid primary key default gen_random_uuid(),
  platform text not null,
  client_id uuid null,                 -- NULL = platform default; non-null = per-client override
  floor_kind text not null check (floor_kind in ('relative_months','absolute_date','dynamic_merchant_start','unbounded','unknown')),
  floor_months integer null,           -- for relative_months
  floor_date date null,                -- for absolute_date, or an investigated per-client wall
  source_note text not null,
  set_by text not null check (set_by in ('system','investigated')),
  set_at timestamptz not null default now()
);
create unique index if not exists known_floors_platform_default_uidx on known_floors (platform) where client_id is null;
create unique index if not exists known_floors_platform_client_uidx  on known_floors (platform, client_id) where client_id is not null;

insert into known_floors (platform, client_id, floor_kind, floor_months, floor_date, source_note, set_by) values
 ('google', null, 'relative_months', 132, null,
  'run-backfill.ts:91 GRANULAR_MONTHS=132 -> account step floor = today-132mo (no floorDate). Depth/breadth clamp to floor36()=36mo (drain-registry.ts:61) BY DESIGN; a depth grain at 36mo is at-floor. search_term/keyword genuinely ~90d (platform limit).', 'system'),
 ('meta', null, 'relative_months', 36, null,
  'adapters.ts:49 granularMonths=36 (Meta insights ~37mo retention; clamp 36 safety). All depth/breadth via floor36()=36mo.', 'system'),
 ('ga', null, 'absolute_date', null, '2015-08-14',
  'adapters.ts:75 floorDate=2015-08-14; run-backfill.ts:187 clamp -> GA floor = max(today-132mo, 2015-08-14) = 2015-08-14 while today-132mo < 2015-08-14.', 'system'),
 ('shopify', null, 'dynamic_merchant_start', null, null,
  'shopify-dimensional-backfill.ts:191 runShopifyDeepBackfill floors at the store first-order UTC date (probe); complete=true == reached merchant start.', 'system'),
 ('woocommerce', null, 'dynamic_merchant_start', null, null,
  'woocommerce-backfill.ts:32 DEFAULT_DAYS=4000 (~11y cap) + empty-chunk completeness -> merchant first-order date.', 'system')
on conflict do nothing;

insert into known_floors (platform, client_id, floor_kind, floor_months, floor_date, source_note, set_by) values
 ('woocommerce', '23c697bb-5255-4289-9329-659544ba8e6e', 'absolute_date', null, '2018-12-10',
  'host 500 critical-error wall — investigated 2026-07-13, accepted', 'investigated')
on conflict do nothing;
