-- LORAMER_ORG_TYPE_PERSIST_V1 — persist the two-door (agency vs business) onboarding choice.
--
-- Additive + safe: a NULLABLE text column, NO check constraint. Stores the USER-FACING value
-- ('agency' | 'business'). The business -> 'solo' mapping into organizations.org_type happens ONLY
-- in app code (POST /api/clients), so the organizations.org_type CHECK ('solo','agency') is never
-- fed 'business'.
--
-- BACKFILL (required companion to the forced-choice gate + the null-is-error consume path):
-- existing OWNERS already have an org from migration 026 but no account_type; without this they would
-- hit the null-account_type error (409) on their next Add-client. Map their existing org_type back to
-- the user-facing value so they pass through untouched, never re-onboarded:
--     org_type 'agency' -> account_type 'agency'   ;   org_type 'solo' -> account_type 'business'.
-- user_profiles rows with NO matching org (a profile that never created a client) stay NULL and are
-- correctly forced to choose. Shopify synthetic owners keep their own (unchanged) 'solo' provisioning.
--
-- Reversible:  ALTER TABLE public.user_profiles DROP COLUMN account_type;

ALTER TABLE public.user_profiles ADD COLUMN IF NOT EXISTS account_type text;

UPDATE public.user_profiles up
SET account_type = CASE WHEN o.org_type = 'agency' THEN 'agency' ELSE 'business' END
FROM public.organizations o
WHERE o.owner_email = up.user_email
  AND up.account_type IS NULL;
