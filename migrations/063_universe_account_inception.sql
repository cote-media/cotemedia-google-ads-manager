-- LORAMER_UNIVERSE_ACCOUNT_INCEPTION_V1 — THE ACCOUNT'S EARLIEST-CAMPAIGN DATE, PER ACCOUNT.
--
-- ⛔ NOT A COLUMN ON universe_account_floor, AND THE REFUSAL IS THE POINT. That table is PER-SURFACE by law
-- (wall-is-surface-scoped.guard.mjs) and its source CHECK ('vendor-refusal') REFUSED 'earliest-campaign' —
-- which is the constraint doing its job: an ACCOUNT-scoped fact stored in a surface-scoped table is either
-- 346 copies or a sentinel row, and both are the scope defect this arc exists to end.
--
-- ⛔ ABSENCE OF A ROW MEANS **UNKNOWN**, and the walk REFUSES TO RUN UNBOUNDED on UNKNOWN. No default, no
-- sentinel, no epoch fallback. Walk-to-epoch survives only as an EXPLICIT operator choice on the message.
--
-- ⛔ PROVENANCE IS MANDATORY: the RAW vendor datetime is stored beside the derived date, because the derived
-- date is a .slice(0,10) of an ACCOUNT-TIMEZONE datetime (measured 2026-08-10, probe op 6:
-- "2022-03-04 13:49:44", no timezone designator — docs/LORAMER_BACKFILL_FACT_REGISTRY.md owns the row).

CREATE TABLE IF NOT EXISTS public.universe_account_inception (
  client_id            uuid        NOT NULL,
  vendor               text        NOT NULL,
  -- Derived: raw_start_date_time.slice(0,10). Account-timezone frame, same frame as segments.date days.
  inception_date       date        NOT NULL,
  -- The vendor's own string, verbatim (e.g. '2022-03-04 13:49:44'). The derived date must be reproducible.
  raw_start_date_time  text        NOT NULL,
  source               text        NOT NULL CHECK (source IN ('earliest-campaign')),
  discovered_at        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (client_id, vendor)
);

COMMENT ON TABLE public.universe_account_inception IS
  'LORAMER_UNIVERSE_ACCOUNT_INCEPTION_V1 — earliest campaign.start_date_time per (client, vendor), discovered by ONE op at walk start (no status filter: removed campaigns included by API default). Absence = UNKNOWN, and UNKNOWN refuses an unbounded walk.';

-- ⛔ THE EARLIEST WINS — LEAST(), the mirror of the wall''s GREATEST(). A re-discovery that returns a LATER
-- date (a purged earliest campaign — the banked, unpublished vendor risk) must not RAISE the stop and orphan
-- ground below it. Claiming MORE history is walkable is the recoverable direction.
CREATE OR REPLACE FUNCTION public.universe_record_account_inception(
  p_client_id uuid, p_vendor text, p_inception_date date, p_raw text
) RETURNS void
LANGUAGE sql
AS $$
  INSERT INTO public.universe_account_inception
    (client_id, vendor, inception_date, raw_start_date_time, source, discovered_at)
  VALUES (p_client_id, p_vendor, p_inception_date, p_raw, 'earliest-campaign', now())
  ON CONFLICT (client_id, vendor) DO UPDATE
  SET inception_date      = LEAST(public.universe_account_inception.inception_date, EXCLUDED.inception_date),
      raw_start_date_time = CASE WHEN EXCLUDED.inception_date < public.universe_account_inception.inception_date
                                 THEN EXCLUDED.raw_start_date_time
                                 ELSE public.universe_account_inception.raw_start_date_time END,
      discovered_at       = now();
$$;
