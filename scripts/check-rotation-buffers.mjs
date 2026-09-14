#!/usr/bin/env node
// LORAMER_ROTATION_SKIP_SCAN_V1 — check:data leg: universe_surface_rotation's PLAN stays in the skip-scan cost class.
//
// WHAT IT READS: EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) of `select * from public.universe_surface_rotation($1, 'google')`
// on the DEEPEST ledger (Foam OH, 957d484e — the client the 09-10/11 rotation-error fires all belonged to) and sums the
// plan's Shared Hit Blocks + Shared Read Blocks. The 084 DISTINCT ON body measured 34,898 buffers there (a heap fetch per
// attempt row); the 094 skip-scan body measured 3,270. ROTATION_BUFFERS_CEILING = 5,000 ⇐ measured 2026-09-14 N=1:
// ~1.5× the skip-scan cost, so a regression toward the heap-fetch shape (or an index change that drops the skip path)
// FAILS here while normal ledger growth passes.
// ⛔ WHY BUFFERS AND NOT MILLISECONDS: the timeout class was COLD-CACHE (mean 292 ms, max 4,256 ms, 16,180 disk reads on
// 43 calls) — a warm timing reads 49 ms on the bad plan and says nothing. Buffers touched is the cold cost.
// ⛔ NEEDS THE DATABASE — check:data, never `npm run guard`. Read-only: EXPLAIN ANALYZE of a STABLE function.
//
//   node scripts/check-rotation-buffers.mjs          report
//   node scripts/check-rotation-buffers.mjs --gate   exit 1 on any finding
//   node scripts/check-rotation-buffers.mjs --self   drive the classifier on the two measured plans (no DB)
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const GATE = process.argv.includes('--gate')
const SELF = process.argv.includes('--self')
export const ROTATION_BUFFERS_CEILING = 5000
const DEEPEST_CLIENT = '957d484e-d0c4-4dd0-b382-d8499d556252' // Foam OH — 349/349 sealed, the deepest descend ledger

/** Sum every node's shared hit + read blocks. Pure; driven by --self on the two measured shapes. */
export function buffersOf(planJson) {
  let hit = 0, read = 0
  const walk = (n) => {
    if (!n || typeof n !== 'object') return
    if (typeof n['Shared Hit Blocks'] === 'number') hit = Math.max(hit, n['Shared Hit Blocks'])
    if (typeof n['Shared Read Blocks'] === 'number') read = Math.max(read, n['Shared Read Blocks'])
    for (const k of ['Plans', 'Plan']) { const v = n[k]; if (Array.isArray(v)) v.forEach(walk); else if (v) walk(v) }
  }
  const root = Array.isArray(planJson) ? planJson[0] : planJson
  walk(root?.Plan ?? root)
  return { hit, read, total: hit + read }
}
export function decideRotationBuffers({ total, ceiling = ROTATION_BUFFERS_CEILING }) {
  if (!Number.isFinite(total)) return { ok: false, reason: 'the plan carried no Shared Hit/Read Blocks — EXPLAIN (BUFFERS) did not run, a missing measurement is not a pass' }
  if (total > ceiling) return { ok: false, reason: `universe_surface_rotation touched ${total} shared buffers on the deepest ledger — ceiling ${ceiling}. The plan has left the skip-scan class (084's DISTINCT ON body measured 34,898): a heap fetch per attempt row, and the 4 s cold-cache tail that timed out 14 fires in 48 h is back.` }
  return { ok: true, reason: `universe_surface_rotation touched ${total} shared buffers on the deepest ledger (ceiling ${ceiling}) — skip-scan class.` }
}

// ── --self: the classifier on the two MEASURED plan shapes (Foam OH, 2026-09-14) ───────────────────────────
if (SELF) {
  const shape = (hit, read) => [{ Plan: { 'Node Type': 'Function Scan', 'Shared Hit Blocks': hit, 'Shared Read Blocks': read } }]
  const bad = decideRotationBuffers(buffersOf(shape(34898, 0)))   // the 084 body as measured
  const good = decideRotationBuffers(buffersOf(shape(3254, 16)))  // the 094 body as measured
  console.log(`[rotation-buffers --self] 084 body (34,898) → ${bad.ok ? 'PASS' : 'FAIL'} · 094 body (3,270) → ${good.ok ? 'PASS' : 'FAIL'}`)
  if (bad.ok || !good.ok) { console.error('✗ rotation-buffers SELF-TEST FAILED — the classifier does not separate the two measured plans.'); process.exit(2) }
  console.log('✓ rotation-buffers self-test: the heap-fetch plan is RED and the skip-scan plan is GREEN.')
  process.exit(0)
}

// ── LIVE ─────────────────────────────────────────────────────────────────────────────────────────────────
const env = Object.fromEntries(
  readFileSync(resolve(ROOT, '.env.local'), 'utf8').split('\n')
    .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()] }))
const { default: pg } = await import('pg')
const c = new pg.Client({ connectionString: env.SUPABASE_DB_URL })
await c.connect()
await c.query("SET statement_timeout='115s'")
const findings = []
try {
  const { rows } = await c.query(`explain (analyze, buffers, timing off, format json) select * from public.universe_surface_rotation($1::uuid, 'google')`, [DEEPEST_CLIENT])
  const plan = rows[0]['QUERY PLAN']
  const b = buffersOf(plan)
  const v = decideRotationBuffers({ total: b.total })
  const { rows: cnt } = await c.query(`select count(*)::int as n from public.universe_surface_rotation($1::uuid, 'google')`, [DEEPEST_CLIENT])
  console.log(`[rotation-buffers] Foam OH: ${cnt[0].n} rows · shared hit ${b.hit} + read ${b.read} = ${b.total} buffers · ceiling ${ROTATION_BUFFERS_CEILING} · ${v.ok ? 'OK' : 'FAIL'}`)
  if (!v.ok) findings.push(v.reason)
  if (cnt[0].n === 0) findings.push('universe_surface_rotation returned 0 rows for the deepest ledger — an empty rotation on a 349-surface account is a broken read, not a cheap one.')
} catch (e) {
  findings.push(`could not EXPLAIN universe_surface_rotation: ${e.message}`)
} finally { await c.end() }

if (findings.length) {
  console.error(`✗ ROTATION-BUFFERS ${GATE ? 'GATE ' : ''}FAILED — ${findings.length} finding(s):`)
  for (const f of findings) console.error(`  - ${f}`)
  process.exit(GATE ? 1 : 0)
}
console.log('✓ ROTATION-BUFFERS GATE PASSED — the rotation read stays in the skip-scan cost class on the deepest ledger.')
