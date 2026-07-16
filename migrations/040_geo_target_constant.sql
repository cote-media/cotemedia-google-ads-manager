-- migration 040 — LORAMER_GEO_TARGET_CONSTANT_V1
-- Google Ads geo target id→name REFERENCE table. Loaded by scripts/ingest-geo-target-constants.mjs from the
-- ZERO-QUOTA downloadable geotargets CSV (developers.google.com/google-ads/api/data/geotargets) — NOT the API.
-- Additive: nothing reads it until the geo-resolver STEP 2 (metrics-query.ts / build-claude-context.ts).
-- Applied 2026-07-16 via MCP (Russ-approved). Revert = DROP TABLE public.geo_target_constant.
create table if not exists public.geo_target_constant (
  criteria_id        text primary key,   -- matches the bare id parsed off breakdown_value ("geoTargetConstants/<id>[:<TYPE>]")
  name               text,
  canonical_name     text,
  parent_id          text,
  country_code       text,
  target_type        text,               -- City / State / Postal Code / County / Region / Country / … (NO Metro/DMA — see below)
  status             text,               -- CSV status: Active / Removal Planned
  first_seen_version text not null,       -- CSV version that first introduced this id (never overwritten)
  last_seen_version  text not null,       -- most recent CSV version that still carried this id
  ingested_at        timestamptz not null default now()
);
-- RETENTION LAW (enforced by the loader): this table ACCUMULATES — a UNION across CSV versions, NEVER a mirror of
-- the newest. Google phases ids out (Removal Planned) and drops them from later CSVs; geo ids are PERMANENT and
-- NEVER REUSED, so a retired mapping stays correct forever. NEVER DELETE A ROW — a historical metrics_daily geo
-- value pointing at a retired id must still resolve. An id present here but absent from the newest CSV is RETIRED:
-- keep the row, leave last_seen_version at its prior value. The PRIMARY KEY on criteria_id is the read-path lookup index.
-- KNOWN GAP (measured at ingest): the geotargets CSV has NO Metro/DMA target type — so geo_metro / user_geo_metro ids
-- (the 2xxxxx DMA range, e.g. 200500) do NOT resolve here. Every other grain resolves ~100%. A supplementary DMA list
-- (~210 US DMAs) closes it; decided in STEP 2.
comment on table public.geo_target_constant is
  'LORAMER_GEO_TARGET_CONSTANT_V1 — Google Ads geo id→name reference, loaded from the zero-quota geotargets CSV (NOT the API). ACCUMULATES across CSV versions; NEVER delete a row (retired ids must still resolve; ids are permanent + never reused). Metro/DMA ids are NOT in the CSV. See migration 040.';
