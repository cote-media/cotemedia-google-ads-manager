#!/usr/bin/env node
// LORAMER_REASK_ADMISSION_FITS_V1 — A RE-ASK UNIT IS SIZED AGAINST WHAT IS LEFT OF THE FIRE, NOT THE WHOLE CEILING.
//
// ⛔ THE DEFECT THIS EXISTS FOR, MEASURED 2026-09-25 (rounds 4 and 5) against live rows:
// The re-ask block sized its chunk with `timeCappedDays(..., consumerMaxS: CONSUMER_MAX_DURATION_S)` — the whole
// 300 s consumer ceiling — while admission (route.ts, `shouldStartAnotherLap(elapsed, maxUnitMs,
// FIRE_WORK_BUDGET_MS, c.reserveMs)`) tests what is LEFT of the fire. Two different clocks for one unit.
// The cap only bites above (300 − 18) ÷ (1.48 × 360) = 0.529 s/day, and every blocked row measured
// 0.030–0.346 s/day, so NONE was capped: each derived a full 360-day chunk reserving up to 202,429 ms against
// a fire whose remaining budget never exceeded 171,239 ms on 303 of 303 fires. The four rows at the head of
// `order(window_start asc)` therefore spent the whole REASK_REQUESTS_PER_RUN = 4 allowance on units the
// admission gate refused, every fire, and the 220 rows behind them were never reached: 234 rows pending with
// claimed_at NULL and tries 0 for 19 hours across 289 wet fires, while check:data's reask-queue-exhausted leg
// read GREEN because tries never incremented.
//
// ⛔ AND SLICING ALONE IS NOT THE FIX. A head that still cannot fit must be PASSED, not merely made smaller —
// the standard mitigation everywhere this is studied (HTTP/2 independent streams, RFC 9113; virtual output
// queues; QLM's reorder-and-evict; lane-broker's bounded capacity backfill). So the block both sizes to the
// remaining budget AND skips a row whose smallest chunk still cannot be admitted, without spending a slot.
//
// LEGS:
//  (i)   a re-ask unit sized against the REMAINING budget is admitted at the measured median headroom, and the
//        same row sized against the 300 s ceiling is REFUSED — the arithmetic of the defect, both directions.
//  (ii)  a row whose smallest chunk cannot fit is SKIPPED and does not consume the re-ask allowance.
//  (iii) a fitting row queued BEHIND a non-fitting head is selected.
//  (iv)  SOURCE: the re-ask block sizes from FIRE_WORK_BUDGET_MS − elapsed, not CONSUMER_MAX_DURATION_S, and
//        carries the skip.
//  (v)   SOURCE, THE FREEZE: the MISSED lane's own sizing call is UNCHANGED. The missed lane has the identical
//        shape and is NOT proven broken (its holes are small, so it survives); widening this fix into it is
//        engine work outside the proven break and this leg pins it shut.
import { readFileSync, mkdtempSync, rmSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'

const ROOT = process.env.LORAMER_GUARD_ROOT || process.cwd()
const findings = []
const check = (c, m) => { if (!c) findings.push(m) }
const read = (rel) => { try { return readFileSync(resolve(ROOT, rel), 'utf8') } catch (e) { findings.push(`UNREADABLE ${rel} — ${e.message}. A guard that cannot read its evidence FAILS.`); return '' } }

const ROUTE = 'src/app/api/cron/universe-resume/route.ts'
const ADAPTER = 'src/lib/backfill/capture-adapter.ts'
const LAP = 'src/lib/backfill/lap-budget.ts'
const CONTRACT = 'src/lib/backfill/universe-v2-contract.ts'

// ── MEASURED INPUTS, 2026-09-25 round 5 — live rows, not chosen ──────────────────────────────────────────
const FIRE_BUDGET_MS = 282_000          // universe-v2-contract.ts FIRE_WORK_BUDGET_MS
const MEDIAN_HEADROOM_MS = 149_331      // median (FIRE_WORK_BUDGET_MS − elapsed_ms) over 303 wet Tri-Copy fires
const MAX_HEADROOM_MS = 171_239         // the largest headroom any of those 303 fires ever had
const HEAD_SPD = 0.346                  // user_location_view/segments.ad_network_type, worst s/day over 12 attempts
const CHEAP_SPD = 0.030                 // detail_placement_view/segments.device — the row that would fit and is never offered
const MISSED_WINDOW_DAYS = 360          // universe-resumer.ts
const MIN_DAYS = 1                      // google adapter sizing.minDays
const ALLOWANCE = 4                     // REASK_REQUESTS_PER_RUN
const CONSUMER_MAX_S = 300              // universe-v2-contract.ts CONSUMER_MAX_DURATION_S

const out = mkdtempSync(join(tmpdir(), 'reask-admission-'))
try {
  const r = spawnSync(join(ROOT, 'node_modules', '.bin', 'tsc'), [
    resolve(ROOT, ADAPTER), resolve(ROOT, LAP), resolve(ROOT, CONTRACT),
    '--target', 'es2020', '--module', 'commonjs', '--moduleResolution', 'node',
    '--skipLibCheck', '--noResolve', '--rootDir', resolve(ROOT), '--outDir', out,
  ], { encoding: 'utf8' })
  if (r.error) throw new Error(`tsc did not run: ${r.error.message}`)
  const req = createRequire(import.meta.url)
  const A = req(join(out, 'src/lib/backfill/capture-adapter.js'))
  const L = req(join(out, 'src/lib/backfill/lap-budget.js'))
  const C = req(join(out, 'src/lib/backfill/universe-v2-contract.js'))
  for (const [n, f] of [['unitReserveMs', A.unitReserveMs], ['timeCappedDays', A.timeCappedDays], ['shouldStartAnotherLap', L.shouldStartAnotherLap]]) {
    if (typeof f !== 'function') findings.push(`${n} is not exported — this guard cannot drive the real function and therefore FAILS rather than passing.`)
  }
  check(C.FIRE_WORK_BUDGET_MS === FIRE_BUDGET_MS, `the contract's FIRE_WORK_BUDGET_MS is ${C.FIRE_WORK_BUDGET_MS}, not the ${FIRE_BUDGET_MS} this guard's measured headrooms were taken against — re-measure before trusting the legs below`)
  check(C.CONSUMER_MAX_DURATION_S === CONSUMER_MAX_S, `the contract's CONSUMER_MAX_DURATION_S is ${C.CONSUMER_MAX_DURATION_S}, not ${CONSUMER_MAX_S}`)

  if (!findings.length) {
    // The admission-relevant half of route.ts's re-ask loop, as a pure function. No ledger: `answeredSince`
    // only ever REMOVES chunks, so taking the first chunk of the full span is the largest unit the loop can
    // offer — the worst case admission has to survive.
    const chunkDays = (spanDays, width) => Math.min(spanDays, Math.max(1, Math.floor(width)))
    const planReask = (rows, { elapsedMs, sizeFromRemaining, skipUnfittable }) => {
      const cands = []; let requests = 0; let skipped = 0
      for (const row of rows) {
        if (requests >= ALLOWANCE) break
        const consumerMaxS = sizeFromRemaining ? Math.max(0, (FIRE_BUDGET_MS - elapsedMs) / 1000) : CONSUMER_MAX_S
        const days = A.timeCappedDays({ maxSecPerDay: row.spd, days: MISSED_WINDOW_DAYS, minDays: MIN_DAYS, consumerMaxS }).days
        const w = chunkDays(row.spanDays, days)
        const reserveMs = A.unitReserveMs({ maxSecPerDay: row.spd, days: w })
        if (skipUnfittable && !L.shouldStartAnotherLap(elapsedMs, 0, FIRE_BUDGET_MS, reserveMs)) { skipped++; continue }
        requests++; cands.push({ id: row.id, days: w, reserveMs })
      }
      return { cands, requests, skipped }
    }
    const admits = (elapsedMs, reserveMs) => L.shouldStartAnotherLap(elapsedMs, 0, FIRE_BUDGET_MS, reserveMs)
    const headRow = { id: 'head', spd: HEAD_SPD, spanDays: 360 }
    const elapsedAtMedian = FIRE_BUDGET_MS - MEDIAN_HEADROOM_MS

    // (i) both directions of the defect's arithmetic
    const fixed = planReask([headRow], { elapsedMs: elapsedAtMedian, sizeFromRemaining: true, skipUnfittable: true })
    check(fixed.cands.length === 1 && admits(elapsedAtMedian, fixed.cands[0].reserveMs),
      `(i) sized against the remaining budget, the head row must be ADMITTED at the measured median headroom ${MEDIAN_HEADROOM_MS} ms — got ${JSON.stringify(fixed)}`)
    const today = planReask([headRow], { elapsedMs: elapsedAtMedian, sizeFromRemaining: false, skipUnfittable: false })
    check(today.cands.length === 1 && !admits(elapsedAtMedian, today.cands[0].reserveMs),
      `(i) sized against the ${CONSUMER_MAX_S} s ceiling the same row must be REFUSED at that headroom — if this passes, the defect's arithmetic no longer holds and the measured inputs are stale: got ${JSON.stringify(today)}`)
    check(!admits(FIRE_BUDGET_MS - MAX_HEADROOM_MS, today.cands[0]?.reserveMs ?? 0),
      `(i) the ceiling-sized row must be refused even at the LARGEST headroom any of the 303 measured fires had (${MAX_HEADROOM_MS} ms) — that is what made the block permanent rather than intermittent`)

    // (ii) a row that cannot fit even at its minimum width is skipped and spends no slot
    const immovable = { id: 'immovable', spd: 200, spanDays: 360 }
    const skipRun = planReask([immovable], { elapsedMs: elapsedAtMedian, sizeFromRemaining: true, skipUnfittable: true })
    check(skipRun.skipped === 1 && skipRun.requests === 0 && skipRun.cands.length === 0,
      `(ii) a row whose smallest chunk cannot fit must be SKIPPED and consume none of the ${ALLOWANCE} re-ask requests — got ${JSON.stringify(skipRun)}`)

    // (iii) a fitting row BEHIND a non-fitting head is reached.
    // The live block was a FULL HEAD: four unfittable rows at the front of `order(window_start asc)` took all
    // four requests every fire, so the cheap row behind them was never offered. The head is therefore modelled
    // as ALLOWANCE rows, which is what it was.
    const cheapRow = { id: 'cheap', spd: CHEAP_SPD, spanDays: 360 }
    const head = Array.from({ length: ALLOWANCE }, (_, i) => ({ ...immovable, id: `immovable${i}` }))
    const behind = planReask([...head, cheapRow], { elapsedMs: elapsedAtMedian, sizeFromRemaining: true, skipUnfittable: true })
    check(behind.cands.some((c) => c.id === 'cheap') && behind.skipped === ALLOWANCE,
      `(iii) a fitting row queued behind a non-fitting head must still be selected — got ${JSON.stringify(behind)}`)
    const blocked = planReask([...head, cheapRow], { elapsedMs: elapsedAtMedian, sizeFromRemaining: true, skipUnfittable: false })
    check(!blocked.cands.some((c) => c.id === 'cheap') && blocked.requests === ALLOWANCE,
      `(iii) without the skip the head must still exhaust the allowance and block the fitting row — if this passes the model no longer reproduces the defect: got ${JSON.stringify(blocked)}`)
  }

  // ── SOURCE LEGS ────────────────────────────────────────────────────────────────────────────────────────
  const src = read(ROUTE)
  const start = src.indexOf('const rows = await readReaskQueue(')
  const end = src.indexOf("verdict: 'reask-read-error'")
  if (start < 0 || end <= start) findings.push(`(iv) cannot locate the re-ask block in ${ROUTE} — it is delimited by the readReaskQueue read and the reask-read-error refusal; if either moved, re-point this guard rather than deleting it.`)
  else {
    const block = src.slice(start, end)
    const tcd = block.match(/timeCappedDays\(\{[^}]*\}\)/)
    if (!tcd) findings.push('(iv) the re-ask block contains no timeCappedDays call — the chunk width is no longer sized at all.')
    else {
      check(!/consumerMaxS:\s*CONSUMER_MAX_DURATION_S/.test(tcd[0]),
        `(iv) the re-ask block still sizes its chunk against the whole consumer ceiling — \`${tcd[0].replace(/\s+/g, ' ')}\`. Admission tests FIRE_WORK_BUDGET_MS − elapsed; sizing must use the same clock.`)
      check(/FIRE_WORK_BUDGET_MS/.test(block) && /startedAt/.test(block),
        '(iv) the re-ask block must derive its sizing ceiling from FIRE_WORK_BUDGET_MS and the fire\'s own startedAt — no other clock is the one admission uses.')
    }
    check(/shouldStartAnotherLap\([^)]*\)/.test(block) && /continue/.test(block),
      '(v) the re-ask block must SKIP a row whose unit cannot be admitted this fire (a shouldStartAnotherLap test followed by continue) — slicing alone leaves a head that still does not fit blocking every row behind it.')
  }
  // (v) THE FREEZE — the missed lane keeps its own call, unchanged.
  const missedTail = src.slice(end)
  const missedCall = missedTail.match(/timeCappedDays\(\{[^}]*\}\)/)
  check(!!missedCall && /consumerMaxS:\s*CONSUMER_MAX_DURATION_S/.test(missedCall[0]),
    `(v) the MISSED lane's sizing call must remain unchanged (consumerMaxS: CONSUMER_MAX_DURATION_S) — it shares this shape but is NOT proven broken, and widening the fix into it is engine work this flight has no go for. Got \`${missedCall ? missedCall[0].replace(/\s+/g, ' ') : '(no call found)'}\``)
} catch (e) {
  findings.push(`reask-admission-fits-the-fire CANNOT RUN — ${e?.message ?? e}. A guard that cannot drive its subject FAILS rather than passing.`)
} finally {
  rmSync(out, { recursive: true, force: true })
}

if (findings.length) {
  console.error(`✗ reask-admission-fits-the-fire FAILED — ${findings.length} finding(s):`)
  for (const f of findings) console.error(`  - ${f}`)
  process.exit(1)
}
console.log('✓ reask-admission-fits-the-fire OK — the re-ask unit is sized against the fire\'s remaining budget (admitted at the measured median headroom 149,331 ms; the 300 s-ceiling sizing is refused even at the largest headroom ever measured, 171,239 ms), a row that still cannot fit is skipped without spending one of the 4 requests, a fitting row behind it is reached, and the missed lane is untouched.')
