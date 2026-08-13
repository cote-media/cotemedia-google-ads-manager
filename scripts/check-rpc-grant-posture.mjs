#!/usr/bin/env node
// LORAMER_RPC_GRANT_POSTURE_V1 — THE LIVE-ACL HALF. Reads pg_proc and fails if any function in `public` is
// callable by anon or authenticated without an explicit, reasoned allowlist entry.
//
// ⛔ WHY THIS IS SEPARATE FROM THE BUILD GUARD, AND IT IS NOT A STYLE SPLIT. `tests/guards/rpc-grant-posture`
// reads MIGRATION SOURCE and runs on Vercel, where there is no database. This half needs the database, so it
// lives in `check:data` — the same posture as universe-attempt-append-only's --db half and the reason
// check:data exists at all: DB and paid work stay off the build path.
//
// ⛔ AND THE SPLIT IS LOAD-BEARING RATHER THAN TIDY: a migration can be perfect and the database still wrong.
// A `GRANT EXECUTE … TO anon` typed once into the SQL editor leaves NO trace in migrations/, and the source
// guard would go green over it forever. **This is the half that can see that.** It is also the half that
// caught the original defect: 064's own comment claimed deny-all while the applied ACL read
// `{postgres=X,anon=X,authenticated=X,service_role=X}`.
import { readFileSync } from 'node:fs'

// Load .env.local the same way the rest of check:data does — no dependency, no dotenv on the build path.
try {
  const env = readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
  for (const line of env.split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
  }
} catch { /* env may already be present */ }

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !key) {
  console.error('[rpc-grant-posture-data] CANNOT RUN — NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing. A check that cannot reach its subject FAILS rather than passing.')
  process.exit(1)
}

// ⛔ THE ALLOWLIST IS EMPTY, AND THE EMPTINESS IS THE FINDING. Measured 2026-08-13: every one of the 23
// `.rpc(` call sites in src/ goes through `supabaseAdmin` (service_role); the browser anon client exported
// by src/lib/supabase.ts is imported by ZERO files. Nothing in this application calls a public function as
// anon or authenticated. An entry added here MUST carry the client-side call path that needs it — otherwise
// it is a hole with a name on it.
const ALLOW = new Map([
  // ['some_function', 'called from the browser by <path> — anon required because <reason>'],
])

// ⛔ THE READER IS ITSELF service_role-ONLY AND HELD TO THE RULE IT ENFORCES — migrations/066 carries the
// full four-line posture, so it passes the source guard for the right reason rather than by exemption.
// PostgREST cannot reach pg_catalog directly, which is why a reader function has to exist at all.
//
// ⛔ PLAIN fetch RATHER THAN supabase-js, AND THE REASON IS MEASURED NOT STYLISTIC: `createClient` builds a
// RealtimeClient, and on Node 20 that throws "Node.js 20 detected without native WebSocket support" before a
// single query runs. A check that cannot start is a check that does not exist, and adding `ws` to pull one
// catalog read is a dependency for nothing. PostgREST is an HTTP endpoint; this calls it as one.
let rows = null
let error = null
try {
  const res = await fetch(`${url}/rest/v1/rpc/rpc_grant_posture_audit`, {
    method: 'POST',
    headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: '{}',
  })
  if (!res.ok) error = { message: `HTTP ${res.status} ${(await res.text()).slice(0, 200)}` }
  else rows = await res.json()
} catch (e) {
  error = { message: String(e?.message ?? e) }
}

// ⛔ NO SILENT PASS WHEN THE INSTRUMENT CANNOT READ. An unreadable ACL is not an absent problem — same
// posture as `readHeadroom()`, where a failed read is a refusal rather than an assumption of headroom.
if (error || !Array.isArray(rows)) {
  console.error(`[rpc-grant-posture-data] CANNOT READ ACLs — ${error ? error.message : 'the audit RPC returned nothing usable'}.`)
  console.error('[rpc-grant-posture-data] migrations/066_rpc_grant_posture_audit.sql creates public.rpc_grant_posture_audit(); apply it before running.')
  console.error('[rpc-grant-posture-data] EQUIVALENT BY HAND — run in the Supabase SQL Editor and confirm ZERO ROWS:')
  console.error(`
select p.proname, p.prosecdef, p.proacl::text
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.prokind = 'f'
  and (has_function_privilege('anon', p.oid, 'execute')
    or has_function_privilege('authenticated', p.oid, 'execute'));`)
  process.exit(1)
}

const offenders = rows.filter((r) => (r.anon_x || r.auth_x) && !ALLOW.has(r.name))
const missingSvc = rows.filter((r) => !r.svc_x)

if (offenders.length || missingSvc.length) {
  console.error(`[rpc-grant-posture-data] FAIL — ${offenders.length} function(s) callable by anon/authenticated without an allowlist entry; ${missingSvc.length} not callable by service_role:`)
  for (const r of offenders) {
    console.error(`  ✗ ${r.name}${r.secdef ? '  [SECURITY DEFINER — runs as OWNER and BYPASSES RLS]' : ''}  acl=${r.acl}`)
  }
  for (const r of missingSvc) console.error(`  ✗ ${r.name} — service_role cannot execute it; the server's own calls will fail.`)
  console.error('  ⛔ `revoke … from public` DOES NOT REMOVE anon/authenticated — revoke them BY NAME (see migrations/065).')
  process.exit(1)
}

console.log(`[rpc-grant-posture-data] PASS — ${rows.length} public function(s): none callable by anon or authenticated, all callable by service_role, allowlist holds ${ALLOW.size} entr(ies). LIMIT: it checks WHO MAY CALL, not what a function does once called.`)
