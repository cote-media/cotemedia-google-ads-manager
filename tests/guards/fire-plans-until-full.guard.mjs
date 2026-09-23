#!/usr/bin/env node
// LORAMER_FIRE_PLANS_UNTIL_FULL_V1 — A FIRE ON AN ALL-FRESH CANDIDATE SET MUST START ASKS.
//
// The scan used to derive owed ranges for all 60 candidates before executing any; on a cold account at 360-day
// windows that derivation alone consumed the fire budget (Tri-Copy 2026-09-23: scan 249–286 s of 282 s, 0 units
// started, run failed). Planning now stops once the reserves already planned, plus the next candidate's, no longer
// fit before the fire deadline (shouldDeriveNext, capture-adapter.ts).
//   (a) PURE: 60 all-fresh candidates, each derivation costing 4 s of clock and reserving the floor: the planner
//       stops inside the budget, plans ≥ 1 unit, and the planned reserve still fits the remaining budget
//   (b) PLACEMENT: the resume route asks shouldDeriveNext before resolveWalkStop and again after sizeNextWindow,
//       and the FIRE instrument carries plannedReserveMs and derivedOf
import { readFileSync, mkdtempSync, rmSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'

const ROOT = process.env.LORAMER_GUARD_ROOT || process.cwd()
const findings = []
const check = (c, m) => { if (!c) findings.push(m) }
const read = (rel) => { try { return readFileSync(resolve(ROOT, rel), 'utf8') } catch (e) { findings.push(`UNREADABLE ${rel} — ${e.message}`); return '' } }
const strip = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter((l) => !/^\s*(\/\/|\*)/.test(l)).join('\n')
const ADAPTER = 'src/lib/backfill/capture-adapter.ts'
const ROUTE = 'src/app/api/cron/universe-resume/route.ts'

// (a)
{
  const out = mkdtempSync(join(tmpdir(), 'fire-plans-'))
  try {
    const r = spawnSync(join(ROOT, 'node_modules', '.bin', 'tsc'), [resolve(ROOT, ADAPTER), '--target', 'es2020', '--module', 'commonjs',
      '--moduleResolution', 'node', '--skipLibCheck', '--noResolve', '--rootDir', ROOT, '--outDir', out], { encoding: 'utf8' })
    if (r.error) throw new Error(`tsc did not run: ${r.error.message}`)
    const A = createRequire(import.meta.url)(join(out, 'src/lib/backfill/capture-adapter.js'))
    if (typeof A.shouldDeriveNext !== 'function') throw new Error('shouldDeriveNext not exported')
    const BUDGET = 282_000, DERIVE_MS = 4_000, FLOOR = A.PLAN_STOP_RESERVE_MS
    check(FLOOR === A.UNIT_RESERVE_FLOOR_MS && FLOOR === 18_000, `(a) PLAN_STOP_RESERVE_MS must equal UNIT_RESERVE_FLOOR_MS (18,000) — got ${FLOOR}`)
    let now = 0, planned = 0, derived = 0
    const deadlineAt = now + BUDGET
    for (let i = 0; i < 60; i++) {
      if (!A.shouldDeriveNext({ plannedReserveMs: planned, nextReserveMs: FLOOR, nowMs: now, deadlineAt })) break
      now += DERIVE_MS; planned += FLOOR; derived++
    }
    check(derived >= 1, `(a) the planner derived nothing on an all-fresh set — a fire that plans nothing asks nothing`)
    check(derived < 60, `(a) the planner derived all 60 candidates (${derived}) — it never stopped for the budget`)
    check(now + planned <= deadlineAt, `(a) the planned reserve (${planned} ms) no longer fits the remaining budget (${deadlineAt - now} ms) — the plan outran the fire`)
    // a fire that has already spent its budget plans nothing more
    check(!A.shouldDeriveNext({ plannedReserveMs: 0, nextReserveMs: FLOOR, nowMs: BUDGET - 1000, deadlineAt: BUDGET }), `(a) shouldDeriveNext admitted a candidate with 1 s left`)
    // a sized candidate is judged by its exact reserve, never below the floor
    check(!A.shouldDeriveNext({ plannedReserveMs: 0, nextReserveMs: 300_000, nowMs: 0, deadlineAt: BUDGET }), `(a) a 300 s reserve was admitted into a 282 s budget`)
    check(A.shouldDeriveNext({ plannedReserveMs: 0, nextReserveMs: 1, nowMs: 0, deadlineAt: BUDGET }), `(a) a fresh fire refused its first candidate`)
    // execution is 12 lanes wide: 60 cold candidates each reserving 127 s (a 2016 window with rows) must plan MANY, not two,
    // and the plan's worst-case wall time (Σ ÷ 12) must still fit the fire
    { let now2 = 0, planned2 = 0, derived2 = 0
      for (let i = 0; i < 60; i++) {
        if (!A.shouldDeriveNext({ plannedReserveMs: planned2, nextReserveMs: 127_000, nowMs: now2, deadlineAt: BUDGET, lanes: 12 })) break
        now2 += DERIVE_MS; planned2 += 127_000; derived2++
      }
      check(derived2 >= 15, `(a) at 12 lanes and 127 s reserves the planner admitted only ${derived2} unit(s) — the fire starves again`)
      check(now2 + Math.ceil(planned2 / 12) <= BUDGET, `(a) the 12-lane plan's worst-case wall time (${now2 + Math.ceil(planned2 / 12)} ms) exceeds the fire budget`)
      const serial = []
      { let n = 0, pl = 0; for (let i = 0; i < 60; i++) { if (!A.shouldDeriveNext({ plannedReserveMs: pl, nextReserveMs: 127_000, nowMs: n, deadlineAt: BUDGET })) break; n += DERIVE_MS; pl += 127_000; serial.push(i) } }
      check(serial.length < derived2, `(a) lanes must widen the plan: serial planned ${serial.length}, 12-lane planned ${derived2}`)
    }
  } catch (e) { findings.push(`(a) could not drive shouldDeriveNext: ${e.message}`) }
  finally { rmSync(out, { recursive: true, force: true }) }
}

// (b)
{
  const src = strip(read(ROUTE))
  const loop = src.indexOf('for (const entry of rotated)')
  const stopIdx = src.indexOf('stop = await resolveWalkStop(', loop) // the SCAN's stop read (the sealed-strip block above it has its own)
  const firstAsk = src.indexOf('shouldDeriveNext(', loop)
  check(loop >= 0 && stopIdx >= 0, `(b) ${ROUTE}: the scan loop or resolveWalkStop not found`)
  check(firstAsk >= 0 && firstAsk < stopIdx, `(b) ${ROUTE}: shouldDeriveNext must be asked in the scan loop BEFORE resolveWalkStop (found ${firstAsk >= 0 ? 'after' : 'never'})`)
  check(/shouldDeriveNext\(\{[^}]*lanes: UNIT_CONCURRENCY/.test(src), `(b) ${ROUTE}: the planner must be told the execution width (lanes: UNIT_CONCURRENCY)`)
  const sizingIdx = src.indexOf('await sizeNextWindow(adapter, { clientId, resource: surface.resource', loop)
  const secondAsk = sizingIdx >= 0 ? src.indexOf('shouldDeriveNext(', sizingIdx) : -1
  check(secondAsk >= 0, `(b) ${ROUTE}: shouldDeriveNext must be asked again with the exact reserve after sizeNextWindow`)
  check(/plannedReserveMs/.test(src) && /derivedOf/.test(src), `(b) ${ROUTE}: the FIRE instrument must carry plannedReserveMs and derivedOf`)
}


// (c) LORAMER_FIRE_PLANS_UNTIL_FULL_V1 — THE RESERVE'S PER-DAY RATE IS MEASURED ON WINDOWS ≥ SPD_MIN_WINDOW_DAYS ONLY.
// A request's fixed latency is not a per-day cost: Tri-Copy's 7-day cold asks (≈1.5 s) read as 0.21 s/day and inflated a
// 360-day reserve to 130 s for a unit that takes 1–4 s, so the planner could admit two units per fire.
{
  const a = strip(read(ADAPTER))
  const m = a.match(/export const SPD_MIN_WINDOW_DAYS = (\d+)/)
  check(m && Number(m[1]) === 30, `(c) ${ADAPTER}: SPD_MIN_WINDOW_DAYS must be exported as 30 — found ${m ? m[1] : 'none'}`)
  const z = strip(read('src/lib/backfill/universe-sizing.ts'))
  check(/days\s*<\s*SPD_MIN_WINDOW_DAYS/.test(z) && /SPD_MIN_WINDOW_DAYS/.test(z.split('\n').filter((l) => /^import/.test(l)).join('\n')),
    `(c) src/lib/backfill/universe-sizing.ts: maxSecPerDay must skip attempts whose window is shorter than SPD_MIN_WINDOW_DAYS (imported from capture-adapter)`)
}

if (findings.length) { console.error(`[fire-plans-until-full] FAIL — ${findings.length} finding(s):`); for (const f of findings) console.error(`  ✗ ${f}`); process.exit(1) }
console.log('[fire-plans-until-full] PASS — the planner stops when the budget is committed (≥1 unit planned, plan fits the remaining fire), asked before the stop read and after sizing')
