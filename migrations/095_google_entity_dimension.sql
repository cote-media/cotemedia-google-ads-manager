-- 095_google_entity_dimension.sql — LORAMER_ENTITY_DIMENSION_V1
--
-- ⛔ WHAT THIS IS, AND WHAT IT DELIBERATELY IS NOT.
-- This is a SLOWLY CHANGING DIMENSION, TYPE 1: one row per entity, holding its CURRENT name and its real
-- parent, overwritten when either changes. Russ's ruling, 2026-09-15: what a customer sees is the CURRENT
-- name, LOOKED UP — never a name stamped onto dated fact rows.
--
-- ⛔ IT IS **NOT** A NAME HISTORY, AND THAT IS AN OWNERSHIP DECISION RATHER THAN A PREFERENCE.
-- `entity_state_history` (migration 048, LORAMER_ENTITY_STATE_SCD2_V1) ALREADY owns the Type-2 half: it
-- carries `entityName` on its observed fact, it has the transition invariant (an unchanged value writes
-- NOTHING), and it already refuses the row-inflation this table would otherwise re-create. A second table
-- recording when a name changed would be a SECOND OWNER of one fact, which is the defect this repo pays for
-- most often. If name history is ever wanted, it is an entity_state_history stateKey, not a column here.
--
-- ⛔ AND THE GOVERNING LAW DOES NOT DEMAND TYPE 2 HERE, for a reason that is about the VENDOR and not about us:
-- the law's only stated exception is that the platform genuinely does not serve a thing. Google's reporting
-- API serves the CURRENT name on every row at query time — ask for `campaign.name` against a 2024 date today
-- and you are handed TODAY'S name. A per-day name history is not something Google withholds from us; it is
-- something that does not exist to fetch. Manufacturing one from our own observation cadence would be OUR
-- artifact wearing the law's authority, and its resolution would be however often we happened to look.
--
-- NATURAL KEY = (client_id, platform, entity_level, entity_id). One row per entity, forever, overwritten.
-- ⚠ NO DATE COLUMN, BY CONSTRUCTION. A date here would make this a fact table and re-open Type 2 by accident.
--
-- REVERT: DROP TABLE public.google_entity_dimension;   (it is additive — nothing reads it until the writer ships)
-- ⛔ THERE IS NO STAGING DATABASE. This can only be proven where it is applied.

CREATE TABLE IF NOT EXISTS public.google_entity_dimension (
  client_id        uuid        NOT NULL,
  platform         text        NOT NULL,
  -- The GAQL `FROM` resource, exactly as `entityLevelFor` spells it on the fact rows. Same vocabulary on
  -- both sides or the join silently returns nothing — the failure mode this table exists to end.
  entity_level     text        NOT NULL,
  -- The vendor's own identity for the entity, spelled EXACTLY as metrics_daily.entity_id spells it.
  entity_id        text        NOT NULL,
  -- The CURRENT name. Nullable: an entity we have seen referenced but not yet named is UNKNOWN, never ''.
  entity_name      text        NULL,
  -- The entity's real parent, in the same spelling. NULL at the top of the chain (a campaign's parent is the
  -- account, which is the customer_id column, not a row here).
  parent_entity_id text        NULL,
  -- The account this entity belongs to, so a client with two connected accounts cannot collide.
  customer_id      text        NOT NULL,
  first_seen_at    timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (client_id, platform, entity_level, entity_id)
);

-- The read this table exists to serve: "give me every name and parent for this client's level" in one hit.
CREATE INDEX IF NOT EXISTS google_entity_dimension_client_level_idx
  ON public.google_entity_dimension (client_id, platform, entity_level);

-- The walk-up: "who is this entity's parent" and, transitively, the chain.
CREATE INDEX IF NOT EXISTS google_entity_dimension_parent_idx
  ON public.google_entity_dimension (client_id, platform, parent_entity_id)
  WHERE parent_entity_id IS NOT NULL;

COMMENT ON TABLE public.google_entity_dimension IS
  'LORAMER_ENTITY_DIMENSION_V1 — SCD TYPE 1. One row per (client, platform, entity_level, entity_id) holding '
  'the CURRENT name and the REAL parent, overwritten on change. Russ 2026-09-15: screens show the current '
  'name, looked up. Name HISTORY is owned by entity_state_history (048) and must never be duplicated here — '
  'there is deliberately no date column, because one would make this a fact table.';
COMMENT ON COLUMN public.google_entity_dimension.entity_level IS
  'The GAQL FROM resource, spelled exactly as metrics_daily.entity_level spells it (entityLevelFor). Same '
  'vocabulary on both sides or the join returns nothing.';
COMMENT ON COLUMN public.google_entity_dimension.entity_name IS
  'CURRENT name. NULL means UNKNOWN (seen as a parent, not yet named) — never an empty string, so a reader '
  'can tell "we have not looked" from "the vendor says it has no name".';
COMMENT ON COLUMN public.google_entity_dimension.parent_entity_id IS
  'The real parent in the same spelling. NULL at the top of the chain. An ad_group_ad points at its ad_group; '
  'an ad_group at its campaign; a campaign has NULL because its parent is the account (customer_id).';

-- Grant posture (LORAMER_RPC_GRANT_POSTURE_V1): revoke the Supabase defaults BY NAME — revoking PUBLIC alone
-- does not remove them (measured, migration 065).
REVOKE ALL ON TABLE public.google_entity_dimension FROM public;
REVOKE ALL ON TABLE public.google_entity_dimension FROM anon;
REVOKE ALL ON TABLE public.google_entity_dimension FROM authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.google_entity_dimension TO service_role;
