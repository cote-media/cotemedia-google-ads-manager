-- LORAMER_NATIVE_AUTH_V1 — email/password credential store (slice 1 of native auth).
--
-- Additive + isolated: a NEW table holding ONLY the hashed password, keyed by email. It is NOT the
-- user record (that stays user_profiles, created lazily at /welcome) and NOT an identity table — login
-- identity is still session.user.email via NextAuth (JWT sessions, no adapter). Keeping the hash off the
-- widely-SELECTed user_profiles row is deliberate. bcrypt hash stored (bcryptjs, cost 10).
--
-- NO Supabase Auth (auth.users) is used or touched — LoraMer login is purely NextAuth. Reversible: DROP TABLE.

CREATE TABLE IF NOT EXISTS public.auth_credentials (
  email         text PRIMARY KEY,
  password_hash text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);
