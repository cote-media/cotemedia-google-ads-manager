-- LORAMER_RPC_GRANT_POSTURE_V1 — 066: the audit function that lets check:data READ the posture.
--
-- ⛔ WHY THIS FUNCTION HAS TO EXIST. `scripts/check-rpc-grant-posture.mjs` must read `pg_proc` ACLs, and the
-- Supabase client speaks PostgREST, which cannot reach the catalog directly. Without a reader the DB half of
-- the guard can only print "run this by hand", which is a check nobody runs — the exact shape this repo
-- keeps paying for.
--
-- ⛔ AND IT IS ITSELF THE FIRST MIGRATION HELD TO THE NEW RULE, which is the point: it carries the full
-- four-line posture below, so `rpc-grant-posture.guard.mjs` leg (a) passes on it for the right reason rather
-- than by exemption. A function whose job is to enforce a posture must not be the exception to it.
--
-- ⚠ SECURITY DEFINER is REQUIRED here and is stated rather than glossed: reading another role's function
-- privileges needs owner rights. It is service_role-only, it takes NO arguments, and it returns only catalog
-- metadata — names, flags and ACL strings. It reads no customer data and writes nothing.

create or replace function public.rpc_grant_posture_audit()
returns table (
  name text,
  secdef boolean,
  acl text,
  anon_x boolean,
  auth_x boolean,
  svc_x boolean
)
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select p.proname::text,
         p.prosecdef,
         coalesce(p.proacl::text, '(null: owner default — PUBLIC has EXECUTE)'),
         has_function_privilege('anon', p.oid, 'execute'),
         has_function_privilege('authenticated', p.oid, 'execute'),
         has_function_privilege('service_role', p.oid, 'execute')
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.prokind = 'f'
  order by p.proname
$$;

comment on function public.rpc_grant_posture_audit() is
  'LORAMER_RPC_GRANT_POSTURE_V1 — one row per public function with its live ACL and per-role executability. '
  'Read-only catalog metadata for check:data; reads no customer data and writes nothing.';

-- ⛔ THE FOUR LINES, IN FULL. `revoke ... from public` ALONE DOES NOT REMOVE anon/authenticated: Supabase
-- grants EXECUTE to those roles as EXPLICIT role grants, not through PUBLIC. That is how 15 of 21 public
-- functions came to be anon-callable (measured 2026-08-13, swept by 065).
revoke all on function public.rpc_grant_posture_audit() from public;
revoke all on function public.rpc_grant_posture_audit() from anon;
revoke all on function public.rpc_grant_posture_audit() from authenticated;
grant execute on function public.rpc_grant_posture_audit() to service_role;
