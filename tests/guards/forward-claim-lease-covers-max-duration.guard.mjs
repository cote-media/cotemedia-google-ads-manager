#!/usr/bin/env node
// LORAMER_FORWARD_LANE_HYGIENE_V1 — THE FORWARD CLAIM LEASE IS DERIVED FROM maxDuration, NEVER A LITERAL.
//
// ⛔ THE DEFECT, MEASURED 2026-09-05 ON CLIENT c39ee088 (registry: src/lib/clients/canonical.ts): the forward pass on the heaviest google client runs
// 644-662 s; the claim lease was 480 s (migrations/021, a literal sized for a ~340 s Woo lap and never re-derived
// for google forward). The lease went stale mid-pass, the next 10-minute fire re-claimed the same client, and
// the 08:58Z and 09:08Z fires wrote Escential's rows concurrently (3,751 first-writes landed 14-62 s after the
// second claim). Not a holder outliving the platform — a lease shorter than the hold.
//
// ⛔ WHY A DERIVED LEASE IS SUFFICIENT HERE, AND WHY THIS GUARD PINS THE DERIVATION RATHER THAN A NUMBER: on
// Vercel an invocation is terminated at maxDuration, so a holder's hold from its claim is ≤ maxDuration. A lease
// of maxDuration + an in-flight margin therefore cannot lapse under a live holder. Heartbeat renewal and fencing
// tokens (the distributed-lock literature's answer) address a holder that can run past its lease with NO ceiling;
// this platform has one. What CAN re-break it is a maxDuration change that leaves the lease behind — which is
// exactly the 021 failure shape — so the lease is written as `maxDuration + N` in the SAME file and this guard
// refuses any other form.
//
// LEGS
//  (a) the claim_backfill_cursor call in cron/sync/route.ts passes p_lease_seconds: FORWARD_CLAIM_LEASE_S
//  (b) FORWARD_CLAIM_LEASE_S is declared in the SAME file as `export const maxDuration` as `maxDuration + N`,
//      N ≥ 60 (the in-flight margin: a write issued at 799.9 s lands at PostgREST within ~1 s)
//  (c) a migration defines the 4-arg signature `p_lease_seconds integer default 480` and uses
//      `make_interval(secs => p_lease_seconds)` — the 3-arg callers (drain, catchup, Woo backfill, Woo cohort)
//      keep 480 by default and are NOT changed by this flight
//  (d) this guard is registered in scripts/run-guards.mjs
//  INFORMATIONAL, NEVER GATING: the drain (cron/drain/route.ts) runs at maxDuration 1800 and still claims under
//  the 480 s default — its own header records "the invariant to preserve is LEASE > maxDuration, and it is NOT
//  true at 1800s either". Reported KNOWN-RED here so the class stays visible; fixing it is the drain's flight.
import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'

const ROOT = process.env.LORAMER_GUARD_ROOT || process.cwd()
const findings = []
const read = (p) => { try { return readFileSync(resolve(ROOT, p), 'utf8') } catch { return '' } }
const strip = (s) => s.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n')

const SYNC = 'src/app/api/cron/sync/route.ts'
const sync = strip(read(SYNC))
if (!sync) { console.error(`forward-claim-lease-covers-max-duration: CANNOT READ ${SYNC}`); process.exit(1) }

// (a) the call passes the lease
const callIdx = sync.indexOf("rpc('claim_backfill_cursor'")
if (callIdx === -1) findings.push(`(a) ${SYNC} no longer calls claim_backfill_cursor — the forward claim has moved; re-point this guard`)
else {
  const call = sync.slice(callIdx, callIdx + 400)
  if (!/p_lease_seconds:\s*FORWARD_CLAIM_LEASE_S/.test(call)) {
    findings.push(`(a) the claim_backfill_cursor call in ${SYNC} does not pass p_lease_seconds: FORWARD_CLAIM_LEASE_S — the forward claim runs on the RPC's 480 s default, which is shorter than a measured 644-662 s pass`)
  }
}

// (b) derived, same file, margin ≥ 60
const maxDur = sync.match(/export const maxDuration\s*=\s*(\d+)/)
if (!maxDur) findings.push(`(b) ${SYNC} declares no numeric \`export const maxDuration\` — nothing to derive the lease from`)
const lease = sync.match(/const FORWARD_CLAIM_LEASE_S\s*=\s*maxDuration\s*\+\s*(\d+)/)
if (!lease) {
  findings.push(`(b) ${SYNC} does not declare \`const FORWARD_CLAIM_LEASE_S = maxDuration + N\` — a lease that is not derived from maxDuration in the same file is a literal waiting to be left behind by the next maxDuration change (the 021 shape)`)
} else if (Number(lease[1]) < 60) {
  findings.push(`(b) FORWARD_CLAIM_LEASE_S margin is ${lease[1]} s; it must be ≥ 60 s so a write issued in the last second before the kill still lands inside the lease`)
}
if (/FORWARD_CLAIM_LEASE_S\s*=\s*\d+/.test(sync)) findings.push(`(b) FORWARD_CLAIM_LEASE_S is assigned a bare number somewhere in ${SYNC} — it must only ever be maxDuration + N`)

// (c) the migration defines the 4-arg signature
let migrationOk = false
try {
  for (const f of readdirSync(resolve(ROOT, 'migrations'))) {
    if (!f.endsWith('.sql')) continue
    const sql = read(`migrations/${f}`)
    if (/function public\.claim_backfill_cursor\s*\(\s*p_client_id uuid,\s*p_platform text,\s*p_token text,\s*p_lease_seconds integer default 480\s*\)/i.test(sql)
      && /make_interval\(\s*secs\s*=>\s*p_lease_seconds\s*\)/i.test(sql)) migrationOk = true
  }
} catch { /* readdir failure surfaces as the finding below */ }
if (!migrationOk) findings.push(`(c) no migration defines claim_backfill_cursor(p_client_id uuid, p_platform text, p_token text, p_lease_seconds integer default 480) using make_interval(secs => p_lease_seconds) — the RPC still carries the 480 s literal and cannot honour a per-lane lease`)

// (d) registered
const roster = read('scripts/run-guards.mjs')
if (roster && !roster.includes('tests/guards/forward-claim-lease-covers-max-duration.guard.mjs')) findings.push('(d) this guard is not registered in scripts/run-guards.mjs — an unregistered guard never runs')

// INFORMATIONAL — the drain's lease vs its own ceiling. Never gates.
const drain = strip(read('src/app/api/cron/drain/route.ts'))
const drainMax = drain.match(/export const maxDuration\s*=\s*(\d+)/)
const drainLease = drain.match(/p_lease_seconds:\s*([A-Za-z_][A-Za-z0-9_]*|\d+)/)
if (drainMax && !drainLease) {
  console.log(`  KNOWN-RED (informational, not gating): cron/drain/route.ts runs at maxDuration ${drainMax[1]} s and claims under the RPC's 480 s default — LEASE > maxDuration is still false on the drain lane (its own header says so at the LORAMER_DRAIN_FREEMAX_V1 block). The drain's flight owns that fix.`)
}

if (findings.length === 0) {
  console.log(`forward-claim-lease-covers-max-duration: PASSED — the forward claim passes FORWARD_CLAIM_LEASE_S = maxDuration + ${lease ? lease[1] : '?'} s (maxDuration ${maxDur ? maxDur[1] : '?'} s), derived in the same file, and a migration defines the 4-arg RPC with make_interval(secs => p_lease_seconds). 3-arg callers keep the 480 s default.`)
  process.exit(0)
}
console.error(`forward-claim-lease-covers-max-duration: FAILED — ${findings.length} finding(s)`)
for (const f of findings) console.error(`  ✗ ${f}`)
process.exit(1)
