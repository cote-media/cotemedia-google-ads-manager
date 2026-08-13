-- LORAMER_RPC_GRANT_POSTURE_V1 — 065: every public-schema function becomes service_role-only.
--
-- ⛔ WHY THIS EXISTS, AND IT WAS FOUND BY READING THE DATABASE RATHER THAN THE MIGRATIONS. While applying
-- 064 the ACL was read back and did not match what 064's own comment claimed: the function was executable
-- by `anon`. `revoke ... from public` DOES NOT REMOVE anon/authenticated — Supabase grants EXECUTE to those
-- roles as EXPLICIT role grants, not through PUBLIC, so revoking PUBLIC leaves both in place. 057 already
-- knew this and revokes all three by name; every migration that copied the single-line revoke inherited the
-- hole. **A posture asserted in a comment is not a posture.**
--
-- ⛔ MEASURED 2026-08-13 ACROSS THE WHOLE SCHEMA, not extrapolated from the two already found:
-- 21 functions in `public`, of which **15 were anon-callable**. Four of those are SECURITY DEFINER, which is
-- the escalation class because SECDEF runs as the OWNER and therefore BYPASSES RLS:
--   · universe_window_open      — SECDEF, INSERT/UPSERT into universe_window_log. THE SHARPEST ONE: that
--     table is what the Google backfill lane sources its spend from, so forged rows distort lane accounting
--     and can make the walk decline or overspend. An unauthenticated caller holding the public anon key
--     could write them.
--   · analyze_metrics_daily     — SECDEF, runs ANALYZE over a 127 GB partitioned table. Repeated anon calls
--     are a resource-burn lever, not a data leak.
--   · metrics_daily_mirror      — SECDEF trigger function.
--   · rls_auto_enable           — SECDEF event-trigger function.
-- The other eleven are SECURITY INVOKER, so they run as the CALLER and stay behind RLS. That is mitigation,
-- NOT safety: RLS is what is holding them, and RLS is one `create policy` away from changing.
--
-- ⛔ WHY A BLANKET REVOKE IS SAFE HERE, PROVEN BEFORE IT WAS RUN RATHER THAN ASSUMED (this is the trap the
-- flight was warned about — breaking a live client path with a blanket revoke):
--   · EVERY `.rpc(` call site in src/ goes through `supabaseAdmin`, i.e. **service_role**. Enumerated: 23
--     call sites across 13 files, zero exceptions.
--   · `src/lib/supabase.ts` DOES export a browser anon client, and **no file imports it** — 126 files import
--     from that module and every one takes `supabaseAdmin`.
--   · The one RPC in a `dashboard-next` page is a SERVER component (`export default async function`,
--     `getServerSession`, `supabaseAdmin`) — not a browser call.
--   · Login is NextAuth/Google OAuth, and Supabase's own auth objects live in the `auth` schema. This
--     migration touches ONLY `public`, so no sign-in path is in its blast radius.
--   · RLS is enabled on 196 of 196 public tables with 2 policies, both keyed to a JWT email claim that an
--     anon caller does not have.
--
-- ⛔ TRIGGER FUNCTIONS ARE INCLUDED DELIBERATELY. PostgreSQL checks EXECUTE on a trigger function at CREATE
-- TRIGGER time; the docs do not state a fire-time re-check, and the behaviour is not something to take on
-- faith — so the safety here does not depend on that question at all: the writers are service_role, and
-- service_role KEEPS EXECUTE below. Verified after applying by performing a real write that fires one.
--
-- ⛔ CATALOG-DRIVEN ON PURPOSE. Hand-typing 15 signatures is how one gets typo'd and silently skipped. The
-- DO block enumerates `pg_proc` and asserts a final count, so the migration cannot half-apply and read green.

do $$
declare
  r record;
  n_revoked int := 0;
  n_remaining int;
  -- ⛔ THE ALLOWLIST IS EMPTY, AND THAT IS THE FINDING: nothing in this application is called by anon or
  -- authenticated. An entry here must carry the call path that needs it, in a comment, or it is a hole
  -- with a name. `check-rpc-grant-posture.mjs` reads this same list.
  allow text[] := array[]::text[];
begin
  for r in
    select p.oid::regprocedure::text as sig, p.proname
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prokind = 'f'
      and (has_function_privilege('anon', p.oid, 'execute')
        or has_function_privilege('authenticated', p.oid, 'execute'))
      and not (p.proname = any(allow))
    order by p.proname
  loop
    execute format('revoke all on function %s from public', r.sig);
    execute format('revoke all on function %s from anon', r.sig);
    execute format('revoke all on function %s from authenticated', r.sig);
    execute format('grant execute on function %s to service_role', r.sig);
    n_revoked := n_revoked + 1;
  end loop;

  -- ⛔ ASSERT THE END STATE FROM THE CATALOG, NOT FROM THE LOOP COUNTER. A loop that ran is not a posture
  -- that holds; this is the same "verify the instrument" rule the rest of the subsystem is built on.
  select count(*) into n_remaining
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.prokind = 'f'
    and (has_function_privilege('anon', p.oid, 'execute')
      or has_function_privilege('authenticated', p.oid, 'execute'))
    and not (p.proname = any(allow));
  if n_remaining <> 0 then
    raise exception 'LORAMER_RPC_GRANT_POSTURE_V1 FAILED: % function(s) still anon/authenticated-callable after revoking %', n_remaining, n_revoked;
  end if;

  raise notice 'LORAMER_RPC_GRANT_POSTURE_V1: revoked % function(s); 0 remain anon/authenticated-callable', n_revoked;
end $$;
