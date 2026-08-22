#!/usr/bin/env node
// LORAMER_QUEUE_REMOVED_INLINE_WALK_V1 — THE FIRE'S TIME IDENTITY, EXECUTED INSTEAD OF DESCRIBED.
//
// ⛔ THE SUCCESSOR TO queue-drain-fits-the-interval (retired with the queue). That guard bound the walk's
// cadence to a consumer concurrency the platform enforced; the inline fire has no consumer and no
// concurrency — its safety property is that ONE INVOCATION'S PHASES FIT UNDER THE PLATFORM KILL, and that
// the overlap lease OUTLIVES any possible holder. Both are RELATIONSHIPS between constants that live in
// ONE file (universe-v2-contract.ts) and are read from it, never retyped here (LORAMER_ADJACENT_NUMBER_V1).
//
// THE TWO IDENTITIES:
//   (a)  SCAN_ALLOWANCE_MS + CAPTURE_BUDGET_MS + UNIT_RESERVATION_FLOOR_MS  ≤  CONSUMER_MAX_DURATION_S × 1000
//        — the scan, the unit loop, and the one-reservation kill-margin fit under the ceiling. The margin
//        IS the reservation floor: after the loop stops admitting, one worst-case unit plus the post-loop
//        writes (heartbeat + lease release, measured ≤82ms at pdx1) still land before the kill.
//   (b)  LEASE_TTL_S > CONSUMER_MAX_DURATION_S
//        — a lease holder cannot live past the platform kill, so TTL beyond the ceiling covers every
//        possible holder lifetime. ⛔ THE INVERSION THIS PREVENTS: raise maxDuration to Pro's 800/1800
//        without moving the TTL and a LIVE fire's lease expires mid-run — the next fire steals the lane
//        and the vendor spend doubles. That must be a RED BUILD, never a silent behaviour change.
//   (c)  both EXECUTION HOSTS (universe-resume, universe-drive) export maxDuration = CONSUMER_MAX_DURATION_S
//        — the ceiling is the contract's, in the routes that actually die at it (drive-ceiling-pin's law,
//        extended to the hosts the cutover created).
//   (d)  the resume route's ORDER: lease acquire → SCAN marker → EXECUTE marker → mayFetchProgram gate →
//        exactly ONE processMessage call site — execution is lease-gated and meter-gated BY POSITION,
//        which is the half of the no-fetch invariant a static guard can still see.
//
// ⚠ LIMITS: (a) asserts the CONSTANTS' arithmetic, not observed durations — a scan that outgrows its
// allowance shows up in the fire log, not here. (d) reads text order, not the call graph.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const ROOT = process.env.LORAMER_GUARD_ROOT || process.cwd()
const CONTRACT = 'src/lib/backfill/universe-v2-contract.ts'
const RESUME = 'src/app/api/cron/universe-resume/route.ts'
const DRIVE = 'src/app/api/backfill/universe-drive/route.ts'
const findings = []

const read = (rel) => {
  try { return readFileSync(resolve(ROOT, rel), 'utf8') }
  catch (e) { findings.push(`UNREADABLE ${rel} — ${e.message}. A guard that cannot read its evidence FAILS rather than passing.`); return null }
}
const nocomment = (s) => s.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n')

// ── PURE CORE, self-tested below ────────────────────────────────────────────────────────────────────────
export function fireFits(a) {
  const { scanMs, captureMs, floorMs, ceilingS } = a
  if ([scanMs, captureMs, floorMs, ceilingS].some((x) => typeof x !== 'number' || !isFinite(x))) return { ok: false, why: 'a term is UNKNOWN — unknown never defaults to a pass' }
  const total = scanMs + captureMs + floorMs
  const cap = ceilingS * 1000
  return total <= cap
    ? { ok: true, why: `${scanMs} + ${captureMs} + ${floorMs} = ${total}ms ≤ ${cap}ms` }
    : { ok: false, why: `${scanMs} + ${captureMs} + ${floorMs} = ${total}ms EXCEEDS the ${cap}ms ceiling` }
}

const SELF = [
  [{ scanMs: 55_000, captureMs: 235_000, floorMs: 10_000, ceilingS: 300 }, true],
  [{ scanMs: 55_000, captureMs: 236_000, floorMs: 10_000, ceilingS: 300 }, false],
  [{ scanMs: 55_000, captureMs: NaN, floorMs: 10_000, ceilingS: 300 }, false],
]
for (const [input, want] of SELF) {
  const got = fireFits(input).ok
  if (got !== want) { console.error(`[inline-fire-fits-the-ceiling] SELF-TEST FAILED on ${JSON.stringify(input)} — got ${got}, want ${want}`); process.exitCode = 2; process.exit() }
}

const contract = read(CONTRACT)
if (contract) {
  const num = (name) => {
    const m = contract.match(new RegExp(`export const ${name} = ([0-9_]+)`))
    return m ? Number(m[1].replace(/_/g, '')) : null
  }
  const ceilingS = num('CONSUMER_MAX_DURATION_S')
  const scanMs = num('SCAN_ALLOWANCE_MS')
  const floorMs = num('UNIT_RESERVATION_FLOOR_MS')
  // (a) CAPTURE_BUDGET must be DERIVED — the textual relationship, not a retyped number.
  const capForm = /export const CAPTURE_BUDGET_MS = \(CONSUMER_MAX_DURATION_S \* 1000\) - SCAN_ALLOWANCE_MS - UNIT_RESERVATION_FLOOR_MS/.test(contract)
  if (!capForm) findings.push(`(a) ${CONTRACT}: CAPTURE_BUDGET_MS is not derived as (CONSUMER_MAX_DURATION_S * 1000) - SCAN_ALLOWANCE_MS - UNIT_RESERVATION_FLOOR_MS. A literal here is a second copy of the ceiling that drifts silently.`)
  if (ceilingS === null || scanMs === null || floorMs === null) {
    findings.push(`(a) ${CONTRACT}: could not read CONSUMER_MAX_DURATION_S / SCAN_ALLOWANCE_MS / UNIT_RESERVATION_FLOOR_MS — unknown never defaults to a pass.`)
  } else {
    const captureMs = (ceilingS * 1000) - scanMs - floorMs
    const v = fireFits({ scanMs, captureMs, floorMs, ceilingS })
    if (!v.ok) findings.push(`(a) the fire identity FAILS: ${v.why}`)
  }
  // (b) the TTL is ceiling + positive grace, BY FORM — a literal or a subtraction is the inversion risk.
  if (!/export const LEASE_TTL_S = CONSUMER_MAX_DURATION_S \+ [0-9_]+/.test(contract)) {
    findings.push(`(b) ${CONTRACT}: LEASE_TTL_S is not CONSUMER_MAX_DURATION_S + <grace>. The TTL must outlive every possible holder BY CONSTRUCTION — a raise of the ceiling that does not move the TTL must fail this build, and only the additive form guarantees it.`)
  }
}

// (c) both execution hosts pin their ceiling to the contract
for (const host of [RESUME, DRIVE]) {
  const src = read(host)
  if (!src) continue
  if (!/export const maxDuration = CONSUMER_MAX_DURATION_S/.test(src)) {
    findings.push(`(c) ${host} does not export maxDuration = CONSUMER_MAX_DURATION_S — the platform kill this route dies at is not the ceiling its budgets are derived against.`)
  }
}

// (d) the resume route's order: lease → SCAN marker → EXECUTE marker → meter gate → ONE processMessage site
const resume = read(RESUME)
if (resume) {
  const code = nocomment(resume)
  const iLease = code.indexOf('acquireFireLease(')
  const iMeter = code.indexOf('mayFetchProgram(')
  const iCall = code.indexOf('processMessage(')
  const scanMark = resume.indexOf('══ SCAN —')
  const execMark = resume.indexOf('══ EXECUTE —')
  const callCount = (code.match(/processMessage\(/g) || []).length
  if (scanMark < 0 || execMark < 0 || scanMark >= execMark) findings.push(`(d) ${RESUME}: the SCAN/EXECUTE markers are missing or out of order — the guard anchors on MARKERS, never variable names (the 3636a1a lesson), and without them the split is unpoliceable.`)
  if (iLease < 0) findings.push(`(d) ${RESUME} never acquires the fire lease — the vendor documents cron overlap, duplicate invocation and deploy-straddle, and an unleased inline fire double-spends on all three.`)
  if (callCount !== 1) findings.push(`(d) ${RESUME} has ${callCount} processMessage call site(s) — the execute loop is exactly one site; a second is a second lane inside the same file.`)
  if (iLease >= 0 && iCall >= 0 && iLease > iCall) findings.push(`(d) ${RESUME}: processMessage appears before the lease acquire — execution outside the lease is the overlap the lease exists to exclude.`)
  if (iMeter >= 0 && iCall >= 0 && iMeter > iCall) findings.push(`(d) ${RESUME}: processMessage appears before the mayFetchProgram gate — execution outside the meter.`)
}

if (findings.length) {
  console.error(`[inline-fire-fits-the-ceiling] FAIL — ${findings.length} finding(s):`)
  for (const f of findings) console.error(`  ✗ ${f}`)
  console.error('  ⇒ SPEC: LORAMER_QUEUE_REMOVED_INLINE_WALK_V1 (the cutover commit). The constants live in universe-v2-contract.ts with their derivations — fix the source, never this guard.')
  process.exitCode = 1
} else {
  console.log('[inline-fire-fits-the-ceiling] self-test PASS (3/3) · identity holds · TTL outlives the ceiling by form · both hosts pin the contract ceiling · lease→meter→one-call order verified.')
}
