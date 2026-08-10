-- LORAMER_UNIVERSE_ACCOUNT_FLOOR_V1 — THE DISCOVERED FLOOR, PER (ACCOUNT, SURFACE).
--
-- ⛔ WHY A TABLE AND NOT `universe_attempt_log`. The attempt log is APPEND-ONLY EVENT HISTORY and a guard
-- enforces that (tests/guards/universe-attempt-append-only.guard.mjs). A floor is not an event — it is
-- SINGLE-VALUED DERIVED STATE with exactly one current answer per (account, surface). Deriving it by
-- scanning an append-only log on every window means re-reading growing history to answer a one-value
-- question, and it conflates "a refusal happened once" with "this is the floor now". One row, replaced when
-- a better observation arrives.
--
-- ⛔ ABSENCE OF A ROW MEANS **UNKNOWN**, AND THAT IS THE WHOLE DESIGN. There is no default, no sentinel
-- date, and no NOT NULL default that could be mistaken for a measurement. A surface with no row here has
-- never had a floor established, and the walk must say so rather than assume 'no history'.
--
-- ⛔ NOTHING IN THIS TABLE IS A CLOCK. The only writer is a VENDOR REFUSAL — Google answering
-- DateRangeError for a window it will not serve. today−37mo NEVER writes here; it is a reporting warning
-- line and it does not stop a walk (Google demonstrably served daily rows 53 months back on 2026-08-04..08;
-- docs/LORAMER_BACKFILL_FACT_REGISTRY.md holds that observation with its one-account limit stated).

CREATE TABLE IF NOT EXISTS public.universe_account_floor (
  client_id       uuid        NOT NULL,
  vendor          text        NOT NULL,
  -- The surface, at the SAME grain the walk asks at: the GAQL FROM resource plus its segment ('' for base).
  resource        text        NOT NULL,
  segment         text        NOT NULL DEFAULT '',

  -- ⛔ THE OLDEST DATE THE VENDOR WOULD NOT SERVE. This is the REFUSED window's start — the wall itself,
  -- not an inference from silence. NOT NULL because a row exists only when a wall was observed; a surface
  -- with no wall observed has NO ROW (see the absence rule above).
  wall_date       date        NOT NULL,

  -- 'vendor-refusal' is the only value the engine writes today. The column exists so a future source
  -- (an account-derived start date, say) cannot be smuggled in under the same name.
  source          text        NOT NULL CHECK (source IN ('vendor-refusal')),

  -- ⛔ THE VENDOR'S OWN WORDS, VERBATIM. A floor with no provenance is a guess (capture-adapter.ts:89).
  citation        text        NOT NULL,

  established_at  timestamptz NOT NULL DEFAULT now(),
  observed_count  integer     NOT NULL DEFAULT 1,

  PRIMARY KEY (client_id, vendor, resource, segment)
);

-- The walk reads this once per window, keyed exactly as it writes it. No other access pattern exists.
CREATE INDEX IF NOT EXISTS idx_universe_account_floor_lookup
  ON public.universe_account_floor (client_id, vendor, resource, segment);

COMMENT ON TABLE public.universe_account_floor IS
  'LORAMER_UNIVERSE_ACCOUNT_FLOOR_V1 — per (account, surface) vendor wall, DISCOVERED from a vendor refusal, never from a clock. Absence of a row = UNKNOWN, never "no history".';
COMMENT ON COLUMN public.universe_account_floor.wall_date IS
  'The START of the window the vendor REFUSED. The wall itself. Never derived from today minus a constant.';
COMMENT ON COLUMN public.universe_account_floor.citation IS
  'The serialized vendor error, verbatim. Provenance is mandatory: a floor without it is a guess.';

-- ⛔ THE WRITE IS AN RPC, NOT A READ-MODIFY-WRITE IN NODE. Two consumers walking two surfaces of the same
-- account can refuse in the same second; a Node-side "read then upsert" would lose one of them. The
-- conflict resolution belongs in one atomic statement.
--
-- ⛔ THE HIGHEST WALL WINS — `GREATEST(existing, incoming)`. A newer refusal at an OLDER date does not lower
-- a recorded wall: the vendor refusing 2020 does not un-refuse 2022. Keeping the SHALLOWEST refusal is the
-- conservative direction — it claims LESS history is unreachable, so the walk keeps asking for ground we
-- might still get rather than sealing it on one bad answer.
CREATE OR REPLACE FUNCTION public.universe_record_account_wall(
  p_client_id uuid, p_vendor text, p_resource text, p_segment text,
  p_wall_date date, p_citation text
) RETURNS void
LANGUAGE sql
AS $$
  INSERT INTO public.universe_account_floor
    (client_id, vendor, resource, segment, wall_date, source, citation, established_at, observed_count)
  VALUES
    (p_client_id, p_vendor, p_resource, p_segment, p_wall_date, 'vendor-refusal', p_citation, now(), 1)
  ON CONFLICT (client_id, vendor, resource, segment) DO UPDATE
  SET wall_date      = GREATEST(public.universe_account_floor.wall_date, EXCLUDED.wall_date),
      citation       = EXCLUDED.citation,
      established_at = now(),
      observed_count = public.universe_account_floor.observed_count + 1;
$$;

COMMENT ON FUNCTION public.universe_record_account_wall IS
  'LORAMER_UNIVERSE_ACCOUNT_FLOOR_V1 — atomic wall record. Highest wall wins; a newer refusal at an older date never lowers a recorded wall.';
