-- LORAMER_NATIVE_AUTH_ALLOWLIST_V1 — invite-only signup gate (slice 2).
--
-- signup_allowlist is the single WRITE target (manual seed here + RBAC invites going forward). The READ
-- predicate (src/lib/access/allowlist.ts isAllowed) unions this table with existing owners/members so no
-- existing user is ever locked out of login. SEPARATE from Mailchimp interest capture — a subscriber is a
-- lead, NEVER allowlisted. Reversible: DROP TABLE public.signup_allowlist;

CREATE TABLE IF NOT EXISTS public.signup_allowlist (
  email      text PRIMARY KEY,
  source     text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Seed the founding cohort (lowercased).
INSERT INTO public.signup_allowlist (email, source) VALUES
  ('tbains@busybee-solutions.com', 'seed'),
  ('wcannon@thoughtstreams.com',   'seed'),
  ('jeff@royallinksgolftours.com', 'seed')
ON CONFLICT (email) DO NOTHING;

-- Backfill existing users (owners ∪ org members ∪ client owners), lowercased, so nobody is locked out.
INSERT INTO public.signup_allowlist (email, source)
  SELECT DISTINCT lower(owner_email),  'backfill_owner'  FROM public.organizations
  UNION
  SELECT DISTINCT lower(member_email), 'backfill_member' FROM public.org_members
  UNION
  SELECT DISTINCT lower(user_email),   'backfill_client' FROM public.clients
ON CONFLICT (email) DO NOTHING;
