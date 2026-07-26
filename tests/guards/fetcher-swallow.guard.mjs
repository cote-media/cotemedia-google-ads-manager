#!/usr/bin/env node
// LORAMER_FETCHER_SWALLOW_GUARD_V1 — fail if a platform fetcher's top-level catch returns a SUCCESS-SHAPED
// object instead of throwing.
//
// THE BUG IT GUARDS, observed in production 2026-07-25: fetchWooCommerceIntelligence's catch returned
// { connected: true, totalOrders: 0, totalRevenue: 0, … } — a zero-filled SUCCESS object. Consequences, every one
// of them silent: forward wrote a $0 revenue row for a day the store actually had sales; `if (wb)` in the row
// builder was false so all eleven breadth families were skipped; sync_state.last_forward_sync_date still
// advanced; catchup's presence-based gap detection saw the row and never revisited it; the cron returned 200 and
// every gate read green. A MISSING day is honest and recoverable. A $0 day is a lie that also blocks its own
// repair. The rest of the fleet already gets this right — google's base campaigns query throws by explicit
// invariant, meta has no top-level catch, shopify's writers re-throw — so this guard holds the line they set.
//
// GUARDS THE CLASS: it reads EVERY *-intelligence.ts, not woocommerce alone, and encodes the REAL rule rather
// than an exception list — a success-shaped catch is a defect only when a WRITER can reach it.
//   · GATED behind a caller-supplied throwOnError (or equivalent) → PASS. Writers pass the flag and get a throw;
//     the render path omits it and gets empty data on purpose. Shopify does exactly this, deliberately.
//   · NOT reachable by any writer (no cron/* or backfill/* file imports the enclosing function) → PASS. A
//     read-path-only fetcher's zeros reach a UI, never a metrics_daily row.
//   · UNGATED **and** writer-reachable → FAIL. That was Woo: cron/sync and cron/catchup both called it, nothing
//     gated the swallow, and eight days of real revenue were written as $0.
// No named baselines and no allow-list: add a sixth platform, or make a read-only fetcher writer-reachable, and
// the rule re-evaluates on its own.
//
// ⚠ CEILING, stated rather than implied: this is STATIC. It proves catch SHAPE and GATING and writer
// REACHABILITY-BY-IMPORT. It does NOT prove the caller handles the throw correctly (that is Gate-A's job, and was
// proven there), and it cannot see a swallow expressed through a helper rather than an inline object literal.
// Deliberately NOT a database check: an earlier draft scanned metrics_daily fleet-wide and never completed
// (35M rows, statement timeout). A gate that hangs blocks every push and is worse than no gate.
// HERMETIC: filesystem only, completes instantly.
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve, join } from 'node:path'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const DIR = resolve(ROOT, 'src/lib/intelligence')
const failures = []

// A catch body is SUSPECT when it returns an object literal carrying success-shaped fields. `connected: true`
// alongside zeroed totals is the exact shape that caused this; a bare `connected: false` or a `fetchFailed: true`
// flag is the CORRECT degraded shape (LORAMER_CONN_DEGRADED_STATE_V1) and passes.
const SUCCESS_FIELDS = /(totalRevenue|totalOrders|totalSpend|sessions|avgOrderValue)\s*:\s*0/
const CONNECTED_TRUE = /connected\s*:\s*true/
const FLAGS_FAILURE = /fetchFailed\s*:\s*true|connected\s*:\s*false/

// Which functions do WRITERS import? cron routes and backfill writers are the only paths that reach a
// metrics_daily upsert. Anything they import can turn a swallowed failure into a persisted row.
const writerSrc = []
const collect = (dir) => { for (const e of readdirSync(dir, { withFileTypes: true })) {
  const p = join(dir, e.name)
  if (e.isDirectory()) collect(p); else if (p.endsWith('.ts')) writerSrc.push(readFileSync(p, 'utf8'))
} }
collect(resolve(ROOT, 'src/app/api/cron'))
collect(resolve(ROOT, 'src/lib/backfill'))
const writerBlob = writerSrc.join('\n')

let scanned = 0
for (const f of readdirSync(DIR).filter((x) => x.endsWith('-intelligence.ts'))) {
  const src = readFileSync(join(DIR, f), 'utf8')
  scanned++
  const clean = src.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '')
  // Index every exported function's start offset so a catch can be attributed to its enclosing function.
  const fns = [...clean.matchAll(/export\s+(?:async\s+)?function\s+(\w+)/g)].map((m) => ({ name: m[1], at: m.index }))
  for (const m of clean.matchAll(/catch\s*\([^)]*\)\s*\{/g)) {
    let i = m.index + m[0].length, depth = 1
    while (i < clean.length && depth > 0) { const c = clean[i]; if (c === '{') depth++; else if (c === '}') depth--; i++ }
    const body = clean.slice(m.index, i)
    if (!/return\s*\{/.test(body)) continue
    if (FLAGS_FAILURE.test(body)) continue
    if (!(CONNECTED_TRUE.test(body) && SUCCESS_FIELDS.test(body))) continue
    // GATED? a caller-supplied flag that re-throws before the swallow.
    if (/throwOnError[\s\S]{0,40}throw/.test(body)) continue
    // WRITER-REACHABLE? attribute the catch to its enclosing exported function, then look for that name in
    // cron/* or backfill/*.
    const owner = fns.filter((fn) => fn.at < m.index).pop()
    const name = owner?.name ?? '(unknown)'
    if (owner && !new RegExp(`\\b${name}\\b`).test(writerBlob)) continue // read-path only — zeros never persist
    failures.push(`${f}: ${name}() has an UNGATED success-shaped catch (connected:true with zeroed totals) AND is reachable from a writer (cron/* or backfill/*). Downstream cannot distinguish "the store made $0" from "we could not reach the store", so forward writes a false $0 row, the watermark advances, and catchup — which is presence-only — never revisits the day. Either throw, flag the failure, or gate the swallow behind a caller-supplied throwOnError.`)
  }
}

if (failures.length) {
  console.error('\n❌ LORAMER_FETCHER_SWALLOW_GUARD_V1 FAILED\n')
  failures.forEach((f) => console.error('  • ' + f))
  console.error('')
  process.exit(1)
}
console.log(`fetcher-swallow.guard: PASS — ${scanned} platform fetcher(s) scanned; no ungated writer-reachable swallow. (Static: proves shape + gating + import reachability, NOT caller handling — see header.)`)
