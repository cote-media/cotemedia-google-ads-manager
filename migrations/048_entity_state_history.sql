-- 048_entity_state_history.sql — LORAMER_ENTITY_STATE_SCD2_V1, SLICE 1.
--
-- ✅ APPLIED TO PRODUCTION (verified live 2026-07-31 by object existence, not by memory).
-- ⛔ THIS HEADER USED TO SAY "NOT APPLIED" AND IT WAS WRONG. A migration file asserting its own applied-state is a
-- doc restating a fact the DATABASE owns (LORAMER_DOCS_NEVER_RESTATE_LIVE_STATE_V1), and six of these were stale at
-- once — read by the next session deciding whether to run them. The applied-state is now checked mechanically in
-- `npm run check:data` (doc-ownership guard), in BOTH directions. Do not restate it here again; if you must note
-- something, note the DATE it was applied, which is tense-locked history and cannot drift.
-- (Historical: authored 2026-07-31 for Russ's approval; APPLIED 2026-07-31 — I authored this header saying NOT APPLIED and it was stale within hours.) Same posture as 045 (order grain) and the 046/047
-- pair. There is no staging DB (banked law), so this runs against PRODUCTION or not at all.
-- Blast radius: ADDITIVE ONLY — one NEW table + its indexes. No ALTER, no DROP, no backfill, no change to
-- metrics_daily or any existing table. Nothing reads or writes it until the writer is wired AND this is
-- applied; today the writer is present but every persist is a no-op against a missing table.
-- REVERT = DROP TABLE (bottom of this file).
--
-- WHY IT EXISTS (★NON-METRIC-STORAGE-SHAPE). Every capture writer targets metrics_daily — 64 call sites — and
-- a metrics_daily row is keyed by (client, platform, date, entity, breakdown). Configuration, entity-state
-- SETS and change events have no shape that fits, so for two months they read as OUT OF SCOPE rather than as
-- MISSING. This table is the missing shape. It is deliberately NOT a second metrics store: nothing here is
-- summable and nothing here is keyed by day.
--
-- ADAPTED, NOT INVENTED — SCD Type 2, the pattern the ELT vendors already ship. Fivetran's History Mode adds
-- start/end/active columns and appends a new row per change, closing the prior one; Airbyte writes _scd tables
-- where records are never deleted and effective date ranges denote validity. Both track history only for a
-- DECLARED set of tables, and both warn that frequently-changing tables inflate row counts. This table follows
-- all three of those: append-on-change, validity ranges, declared set (SLICE 1 = two fields).
--
-- ⛔ change_source IS THE HONESTY COLUMN AND IT IS NOT OPTIONAL.
-- Polling tells us the date we OBSERVED a value, NEVER the date it CHANGED. If capture begins in November,
-- every first row reads valid_from = November — an artifact of us, not a fact about the account. That is
-- exactly Fivetran's caveat that _fivetran_start REPLACES the source timestamp, and Airbyte's "history begins
-- when history mode is enabled". Without this column the table would confidently assert change dates it
-- invented, which is the ESSENCE law-6 failure (a confident answer over an uncaptured window) reproduced in a
-- new place. Three values, and the reader must surface which one it got:
--   'first_observation' — our FIRST sighting. The actual start is UNKNOWN and must be reported as unknown.
--   'poll_transition'   — we saw A, then B. The change happened inside the polling window.
--   'event'             — a vendor change event gave the exact timestamp. valid_from is truth. (Not slice 1.)

CREATE TABLE IF NOT EXISTS public.entity_state_history (
  client_id      uuid        NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  platform       text        NOT NULL,   -- 'google' | 'meta' | 'ga' | 'shopify' | 'woocommerce'
  account_id     text        NOT NULL,   -- third leg of the universal key (CLAUDE.md)
  entity_level   text        NOT NULL,   -- 'account'|'campaign'|'ad_group'|'conversion_action'|'property'
  entity_id      text        NOT NULL,
  entity_name    text,                   -- readability only; NEVER an identity column

  state_key      text        NOT NULL,   -- 'advertising_channel_type' | 'campaign_status' | …
  state_value    text        NOT NULL,   -- the scalar value, OR the set MEMBER when is_set
  value_json     jsonb,                  -- structured payloads (e.g. meta attribution_spec), not slice 1

  -- ⛔ is_set DECIDES WHICH UNIQUENESS RULE APPLIES, and it exists because the design report said this
  -- invariant could not be enforced in the schema. It can — this column is what makes it enforceable, which
  -- is strictly better than leaving it to the writer plus a nightly check.
  --   is_set=false (SCALAR)  → at most ONE open row per (entity, state_key). A change closes and reopens.
  --   is_set=true  (SET)     → MANY open rows per (entity, state_key), one per member; removal closes one.
  is_set         boolean     NOT NULL DEFAULT false,

  valid_from     date        NOT NULL,   -- the OBSERVATION date, not necessarily the change date (see above)
  valid_to       date,                   -- NULL = currently open
  change_source  text        NOT NULL,
  first_seen_at  timestamptz NOT NULL DEFAULT now(),
  last_seen_at   timestamptz NOT NULL DEFAULT now(),  -- proves we were still LOOKING; distinguishes
                                                      -- "unchanged" from "we stopped observing"

  CONSTRAINT entity_state_history_change_source_chk
    CHECK (change_source IN ('first_observation', 'poll_transition', 'event')),
  CONSTRAINT entity_state_history_validity_chk
    CHECK (valid_to IS NULL OR valid_to >= valid_from),
  CONSTRAINT entity_state_history_pk
    PRIMARY KEY (client_id, platform, account_id, entity_level, entity_id, state_key, state_value, valid_from)
);

-- SCALAR invariant, enforced by the DB rather than by discipline: one open row per (entity, state_key).
CREATE UNIQUE INDEX IF NOT EXISTS entity_state_history_one_open_scalar
  ON public.entity_state_history (client_id, platform, account_id, entity_level, entity_id, state_key)
  WHERE valid_to IS NULL AND is_set = false;

-- SET invariant: one open row per member.
CREATE UNIQUE INDEX IF NOT EXISTS entity_state_history_one_open_member
  ON public.entity_state_history (client_id, platform, account_id, entity_level, entity_id, state_key, state_value)
  WHERE valid_to IS NULL AND is_set = true;

-- Point-in-time seek: "what was X on date D" is a prefix scan, and "current state" is the same prefix with
-- valid_to IS NULL. ⚠ Any future DISTINCT over this table must use the loose-index-scan pattern from
-- migrations 037/047 — a plain DISTINCT over a large negative-keyword set will hit the 8s statement_timeout,
-- which is the mistake 046 already made once.
CREATE INDEX IF NOT EXISTS entity_state_history_point_in_time
  ON public.entity_state_history (client_id, platform, entity_level, entity_id, state_key, valid_from DESC);

COMMENT ON TABLE public.entity_state_history IS
  'LORAMER_ENTITY_STATE_SCD2_V1 — SCD Type 2 for NON-METRIC state: configuration scalars and entity-state sets. Not summable, not keyed by day. valid_from is the OBSERVATION date; change_source says whether that is also the change date. An absent row means UNKNOWN, never false.';

-- REVERT:
-- DROP TABLE IF EXISTS public.entity_state_history;
