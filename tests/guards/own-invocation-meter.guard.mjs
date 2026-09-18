#!/usr/bin/env node
// LORAMER_OWN_INVOCATION_METER_V1 — THE RUN ROW COUNTS ITS OWN FIRE'S DAYS; THE ROTATION'S DAYS BESIDE IT ARE NOT ITS.
//
// The 5-minute rotation fires the same lane beside a run (measured interleaving, 2026-09-17). daysNoLongerOwedSince
// counted day_committed rows by (client, vendor, since) — any producer — so a rotation fire landing inside a step's
// window inflated the run's days_committed. The customer's meter stays client-scoped (any producer: ground covered is
// ground covered); the RUN ROW's counters are its own. This guard proves:
//   (a) PURE mintUnitInvocationId: with a fire id → `${fireId}:${uuid}` (unique per delivery, prefixed); without → the uuid
//   (b) BEHAVIOUR daysNoLongerOwedSince over a scripted ledger: with invocationPrefix 'F1' only F1's day_committed rows and
//       F1's attesting terminals count; without a prefix every producer counts (the customer's meter, unchanged)
//   (c) PLACEMENT: the fire body carries `invocationId: fireInvocationId`; the published message carries `fireInvocationId`;
//       the worker mints the unit id through mintUnitInvocationId(msg.fireInvocationId …); the step passes the fire body's
//       invocation id into the count; the contract declares the field
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import { createRequire, Module } from 'node:module'
import { pathToFileURL } from 'node:url'

const ROOT = process.env.LORAMER_GUARD_ROOT || process.cwd()
const findings = []
const check = (c, m) => { if (!c) findings.push(m) }
const read = (rel) => { try { return readFileSync(resolve(ROOT, rel), 'utf8') } catch (e) { findings.push(`UNREADABLE ${rel} — ${e.message}. A guard that cannot read its evidence FAILS.`); return '' } }
const strip = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter((l) => !/^\s*(\/\/|\*)/.test(l)).join('\n')

const CONTRACT = 'src/lib/backfill/universe-v2-contract.ts'
const COVERAGE = 'src/lib/backfill/universe-coverage.ts'
const SURFACES = 'src/lib/backfill/universe-surfaces.ts'
const WORKER = 'src/lib/backfill/universe-v2-worker.ts'
const STEP = 'src/lib/backfill/universe-run-step.ts'
const ROUTE = 'src/app/api/cron/universe-resume/route.ts'

// (a) pure — the contract compiles standalone (its one import is a type)
{
  const tmp = mkdtempSync(join(tmpdir(), 'own-inv-a-'))
  try {
    const src = read(CONTRACT).replace(/import type \{ UniverseEntry \} from '@\/lib\/backfill\/google-ads-universe-writer'\n/, 'type UniverseEntry = any\n')
    writeFileSync(join(tmp, 'contract.ts'), src)
    const r = spawnSync(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['tsc', '--noResolve', '--skipLibCheck', '--target', 'es2022', '--module', 'es2022', '--moduleResolution', 'node', '--outDir', tmp, join(tmp, 'contract.ts')], { cwd: ROOT, encoding: 'utf8' })
    if (r.error) throw new Error(r.error.message)
    const C = await import(pathToFileURL(join(tmp, 'contract.js')).href)
    if (typeof C.mintUnitInvocationId !== 'function') throw new Error('mintUnitInvocationId is not exported from the contract')
    const withFire = C.mintUnitInvocationId('fire-abc', () => 'u-1')
    check(withFire === 'fire-abc:u-1', `(a) with a fire id the unit id is prefixed — got ${withFire}`)
    check(C.mintUnitInvocationId(null, () => 'u-2') === 'u-2' && C.mintUnitInvocationId(undefined, () => 'u-3') === 'u-3', `(a) without a fire id the unit id is the bare uuid`)
    check(/fireInvocationId\?: string/.test(strip(read(CONTRACT))), `(c) ${CONTRACT}: UniverseMessageV2 must declare fireInvocationId?: string`)
  } catch (e) {
    findings.push(`(a) could not drive mintUnitInvocationId — ${e.message}. A guard that cannot run its subject FAILS.`)
  } finally { rmSync(tmp, { recursive: true, force: true }) }
}

// (b) behaviour over a scripted ledger
const out = mkdtempSync(join(tmpdir(), 'own-inv-b-'))
const origResolve = Module._resolveFilename
try {
  const tsc = join(ROOT, 'node_modules', '.bin', 'tsc')
  const r = spawnSync(tsc, [resolve(ROOT, COVERAGE), resolve(ROOT, SURFACES), resolve(ROOT, 'src/lib/concurrency.ts'),
    '--target', 'es2020', '--module', 'commonjs', '--moduleResolution', 'node',
    '--skipLibCheck', '--noResolve', '--rootDir', resolve(ROOT), '--outDir', out], { encoding: 'utf8' })
  if (r.error) findings.push(`could not run tsc — ${r.error.message}`)
  const stub = join(out, '__supabase_stub.js')
  writeFileSync(stub, `
class Q {
  constructor(rows) { this.rows = rows; this.conds = []; this.cols = null; this.head = false }
  select(cols, opts) { this.cols = String(cols).split(',').map((s) => s.trim()); this.head = !!(opts && opts.head); return this }
  eq(c, v) { this.conds.push((r) => String(r[c]) === String(v)); return this }
  neq(c, v) { this.conds.push((r) => String(r[c]) !== String(v)); return this }
  in(c, vs) { const set = new Set(vs.map(String)); this.conds.push((r) => set.has(String(r[c]))); return this }
  gte(c, v) { this.conds.push((r) => String(r[c]) >= String(v)); return this }
  like(c, pat) { const re = new RegExp('^' + String(pat).replace(/[.*+?^\${}()|[\\]\\\\]/g, '\\\\$&').replace(/%/g, '.*') + '$'); this.conds.push((r) => re.test(String(r[c] ?? ''))); return this }
  order() { return this } limit() { return this }
  then(res) { const hit = this.rows.filter((r) => this.conds.every((f) => f(r))); if (this.head) return res({ count: hit.length, data: null, error: null }); return res({ data: hit.map((r) => Object.fromEntries(this.cols.map((c) => [c, r[c]]))), error: null }) }
}
globalThis.__LEDGER = []
module.exports = { supabaseAdmin: { from: () => new Q(globalThis.__LEDGER) }, drainAliasFor: () => null, breakdownTypeForSurface: () => '', mapBounded: async (xs, n, f) => Promise.all(xs.map(f)) }
`)
  Module._resolveFilename = function (request, ...rest) {
    if (request === '@/lib/backfill/universe-surfaces') return join(out, 'src/lib/backfill/universe-surfaces.js')
    if (request === '@/lib/concurrency') return join(out, 'src/lib/concurrency.js')
    if (request.startsWith('@/')) return stub
    return origResolve.call(this, request, ...rest)
  }
  const req = createRequire(import.meta.url)
  const cov = req(join(out, 'src/lib/backfill/universe-coverage.js'))
  if (typeof cov.daysNoLongerOwedSince !== 'function') throw new Error('daysNoLongerOwedSince not exported')
  const SINCE = '2026-09-18T15:00:00Z'
  const dc = (inv, n) => Array.from({ length: n }, (_, i) => ({ client_id: 'c', vendor: 'google', phase: 'day_committed', lane: 'descend', invocation_id: inv, recorded_at: '2026-09-18T15:10:00Z', day: `2026-01-0${i + 1}` }))
  globalThis.__LEDGER = [
    ...dc('F1:u1', 3),                       // the run's own fire
    ...dc('F2:u9', 2),                       // the rotation's fire, same window
    { client_id: 'c', vendor: 'google', phase: 'attempt_finished', outcome: 'zero', lane: 'descend', invocation_id: 'F1:u2', message_key: 'k1', window_start: '2025-01-01', window_end: '2025-01-10', recorded_at: '2026-09-18T15:12:00Z' },
    { client_id: 'c', vendor: 'google', phase: 'attempt_started', lane: 'descend', invocation_id: 'F1:u2', message_key: 'k1', recorded_at: '2026-09-18T15:11:00Z' },
    { client_id: 'c', vendor: 'google', phase: 'attempt_finished', outcome: 'zero', lane: 'descend', invocation_id: 'F2:u8', message_key: 'k2', window_start: '2025-02-01', window_end: '2025-02-05', recorded_at: '2026-09-18T15:13:00Z' },
    { client_id: 'c', vendor: 'google', phase: 'attempt_started', lane: 'descend', invocation_id: 'F2:u8', message_key: 'k2', recorded_at: '2026-09-18T15:12:30Z' },
  ]
  const all = await cov.daysNoLongerOwedSince({ clientId: 'c', vendor: 'google' }, SINCE)
  check(all === 3 + 2 + 10 + 5, `(b) without a prefix every producer counts (the customer's meter): expected 20 — got ${all}`)
  const own = await cov.daysNoLongerOwedSince({ clientId: 'c', vendor: 'google' }, SINCE, { invocationPrefix: 'F1' })
  check(own === 3 + 10, `(b) with prefix F1 only F1's committed days and F1's attesting terminal count: expected 13 — got ${own}`)
  const none = await cov.daysNoLongerOwedSince({ clientId: 'c', vendor: 'google' }, SINCE, { invocationPrefix: 'F9' })
  check(none === 0, `(b) a prefix nobody stamped counts nothing — got ${none}`)
} catch (e) {
  findings.push(`(b) could not drive daysNoLongerOwedSince — ${e.message}. A guard that cannot run its subject FAILS.`)
} finally {
  Module._resolveFilename = origResolve
  rmSync(out, { recursive: true, force: true })
}

// (c) placement
{
  const route = strip(read(ROUTE))
  check(/invocationId: fireInvocationId,/.test(route), `(c) ${ROUTE}: the fire body must carry invocationId: fireInvocationId`)
  check(/fireInvocationId,\s*\n?\s*(\/\/[^\n]*\n\s*)?lane,/.test(route) || /fireInvocationId, lane/.test(route) || /lane,[\s\S]{0,400}fireInvocationId,/.test(route), `(c) ${ROUTE}: the published message must carry fireInvocationId`)
  const w = strip(read(WORKER))
  check(/invocationId: mintUnitInvocationId\(msg\.fireInvocationId \?\? null, randomUUID\)/.test(w), `(c) ${WORKER}: the unit's provenance must mint through mintUnitInvocationId(msg.fireInvocationId ?? null, randomUUID)`)
  check(!/invocationId: randomUUID\(\)/.test(w), `(c) ${WORKER}: the bare randomUUID mint must be gone from the provenance`)
  const s = strip(read(STEP))
  check(/daysNoLongerOwedThisStep\(clientId, vendor, stepStartedAt, fireId\)/.test(s) && /body\?\.invocationId/.test(s), `(c) ${STEP}: the step must read the fire body's invocationId and pass it into the count`)
  check(/invocationPrefix/.test(s), `(c) ${STEP}: the count must be scoped by invocationPrefix`)
}

if (findings.length) {
  console.error(`[own-invocation-meter] FAIL — ${findings.length} finding(s):`)
  for (const f of findings) console.error('  • ' + f)
  process.exit(1)
}
console.log("[own-invocation-meter] PASS — the fire id rides the fire body and the message, the unit's id is prefixed with it, and the run's step counts only its own fire's days (the customer's client-scoped meter is unchanged).")
