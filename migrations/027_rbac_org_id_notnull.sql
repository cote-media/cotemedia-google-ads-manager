-- LORAMER_RBAC_ORG_ID_NOTNULL_V1 — lock clients.org_id NOT NULL + make org provisioning race-SAFE.
--
-- ✅ APPLIED LIVE 2026-07-12 (via Supabase MCP; preconditions re-verified at apply: 0 null org_id of 28,
--    0 dup owner_email). Post-apply confirmed: clients.org_id is_nullable=NO · organizations_owner_email_unique
--    present. Gate-B (b) closed by the Cozy Foam Factory live Shopify App Store install (B-NEW, callback Branch B).
--
-- PRECONDITIONS (must ALL hold before running — see Gate-A / STEP 4 re-verify):
--   1. Every existing clients row has a non-null org_id  (SELECT count(*) FROM clients WHERE org_id IS NULL  = 0).
--   2. Every client-create path resolves-or-creates an org first (ensureOrgForOwner) — shipped LORAMER_RBAC_ORG_PROVISION_V1:
--        POST /api/clients (defaultType 'agency') and shopify/callback Branch B install (defaultType 'solo').
--   3. No duplicate owner_email in organizations (the unique index below would otherwise fail):
--        SELECT owner_email, count(*) FROM organizations GROUP BY owner_email HAVING count(*) > 1  = 0 rows.
--
-- Run in the Supabase SQL Editor. Reversible: DROP the unique index + ALTER COLUMN org_id DROP NOT NULL.

-- (a) Make the provisioner fully race-SAFE: one org per owner_email. ensureOrgForOwner already tolerates a lost race
--     by re-selecting; this constraint guarantees the loser's re-select finds the winner's row instead of a dup.
CREATE UNIQUE INDEX IF NOT EXISTS organizations_owner_email_unique ON organizations (owner_email);

-- (b) The lock itself: no client may exist without an org.
ALTER TABLE clients ALTER COLUMN org_id SET NOT NULL;
