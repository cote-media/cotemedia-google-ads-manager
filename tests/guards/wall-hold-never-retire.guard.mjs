#!/usr/bin/env node
// LORAMER_WALL_HOLD_NEVER_RETIRE_V1 — PAST THE WALL, SILENCE IS NOT EVIDENCE: AN EMPTY ANSWER IS HELD, NEVER RETIRED.
//
// Russ's Q6 ruling (2026-09-18): the walk stops when Google says this is the first day of anything (inception) or
// refuses the range (a vendor DateRangeError wall). A success-empty answer for any day older than the per-surface wall
// is recorded UNRESOLVED — re-askable by the missed lane, never retired — whatever the retention canary reads. The
// canary keeps running as the day-enforcement-begins detector; it no longer licenses retirement. This guard proves:
//   (a) PURE classifyEmptyAnswer: past the wall → 'unresolved' for EVERY canary state, 'served' included;
//       above the wall → 'zero' as always
//   (b) PURE idleVerdict: past the wall an empty account answer is 'unknown' (no idle verdict) whatever the canary
//   (c) the fire no longer REFUSES past-wall windows on the canary (they are asked in their own window — item 3's
//       clip) and the missed lane no longer drops past-wall holes on the canary
//   (d) the worker still routes every empty through classifyEmptyAnswer and records the unresolved marker loudly
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'

const ROOT = process.env.LORAMER_GUARD_ROOT || process.cwd()
const findings = []
const check = (c, m) => { if (!c) findings.push(m) }
const read = (rel) => { try { return readFileSync(resolve(ROOT, rel), 'utf8') } catch (e) { findings.push(`UNREADABLE ${rel} — ${e.message}. A guard that cannot read its evidence FAILS.`); return '' } }
const strip = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter((l) => !/^\s*(\/\/|\*)/.test(l)).join('\n')

const WALL = 'src/lib/backfill/retention-wall.ts'
const IDLE = 'src/lib/backfill/universe-idle-skip.ts'
const ROUTE = 'src/app/api/cron/universe-resume/route.ts'
const WORKER = 'src/lib/backfill/universe-v2-worker.ts'

let W = null, I = null
const tmp = mkdtempSync(join(tmpdir(), 'wall-hold-'))
try {
  const wall = read(WALL).replace(/import \{ retentionWarningLine \} from '[^']+'\n/, "const retentionWarningLine = (today) => { const d = new Date(today + 'T00:00:00Z'); d.setUTCMonth(d.getUTCMonth() - 37); return d.toISOString().slice(0, 10) }\n")
  writeFileSync(join(tmp, 'wall.ts'), wall)
  const idle = read(IDLE)
    .replace(/import type \{ CanaryState \} from '@\/lib\/backfill\/retention-wall'\n/, '')
    .replace(/import \{ isPastWall \} from '@\/lib\/backfill\/retention-wall'/, 'const isPastWall = (end, wall) => end < wall')
  writeFileSync(join(tmp, 'idle.ts'), idle)
  const r = spawnSync(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['tsc', '--noResolve', '--skipLibCheck', '--target', 'es2022', '--module', 'es2022', '--moduleResolution', 'node', '--outDir', tmp, join(tmp, 'wall.ts'), join(tmp, 'idle.ts')], { cwd: ROOT, encoding: 'utf8' })
  if (r.error) findings.push(`could not run tsc — ${r.error.message}`)
  W = await import(pathToFileURL(join(tmp, 'wall.js')).href)
  I = await import(pathToFileURL(join(tmp, 'idle.js')).href)
} catch (e) {
  findings.push(`the behavioural legs could not run — ${e.message}. A guard that cannot execute its subject FAILS.`)
} finally {
  rmSync(tmp, { recursive: true, force: true })
}

if (W) {
  const wall = '2023-08-18'
  for (const c of ['served', 'unknown', 'refused', 'silent', 'failed']) {
    const v = W.classifyEmptyAnswer({ rangeEnd: '2022-09-16', wallLine: wall, canary: c })
    check(v === 'unresolved', `(a) ⛔ an empty answer PAST the wall with canary '${c}' classified as '${v}' — Q6: silence past the wall is not evidence; it must be UNRESOLVED even under a SERVED canary.`)
    const above = W.classifyEmptyAnswer({ rangeEnd: '2025-11-10', wallLine: wall, canary: c })
    check(above === 'zero', `(a) an empty answer ABOVE the wall with canary '${c}' classified as '${above}' — above the wall an empty is NO_DATA_OBSERVED, as always.`)
  }
  check(W.classifyEmptyAnswer({ rangeEnd: wall, wallLine: wall, canary: 'unknown' }) === 'zero', `(a) the boundary day (rangeEnd == wallLine) is not past the wall.`)
}
if (I) {
  for (const c of ['served', 'unknown']) {
    const v = I.idleVerdict({ windowStart: '2016-05-01', windowEnd: '2016-06-03', wallLine: '2023-08-18', canary: c, answer: { ok: true, activeDays: [] } })
    check(v.kind === 'unknown', `(b) ⛔ past the wall an empty account answer read '${v.kind}' under canary '${c}' — no idle verdict is issued past the wall, whatever the canary.`)
  }
  const above = I.idleVerdict({ windowStart: '2025-11-10', windowEnd: '2025-12-13', wallLine: '2023-08-18', canary: 'unknown', answer: { ok: true, activeDays: [] } })
  check(above.kind === 'idle', `(b) above the wall an empty answer still reads 'idle' (got ${above.kind}).`)
}
{
  const r = strip(read(ROUTE))
  check(!/verdict: 'past-wall-unverified'/.test(r), `(c) ${ROUTE}: the descend lane must no longer refuse a past-wall window on the canary — past-wall ground is asked in its own window and its empties are held.`)
  check(!/missed\.filter\(\(m\) => !isPastWall\(m\.windowEnd, wallLine\)\)/.test(r), `(c) ${ROUTE}: the missed lane must no longer drop past-wall holes on the canary — an UNRESOLVED day is exactly what it re-asks.`)
  check(/retentionCanary: canary\.state/.test(r), `(c) ${ROUTE}: the fire instrument must still carry the canary state (the enforcement detector keeps running).`)
  const w = strip(read(WORKER))
  check(/classifyEmptyAnswer\(\{ rangeEnd: range\.end, wallLine, canary: canary\.state \}\)/.test(w) && /UNRESOLVED PAST WALL/.test(w), `(d) ${WORKER}: every empty must still route through classifyEmptyAnswer and log UNRESOLVED PAST WALL loudly.`)
}

if (findings.length) {
  console.error(`[wall-hold-never-retire] FAIL — ${findings.length} finding(s):`)
  for (const f of findings) console.error('  • ' + f)
  process.exit(1)
}
console.log('[wall-hold-never-retire] PASS — past the wall an empty answer is UNRESOLVED under every canary state (served included), no idle verdict is issued there, the fire asks past-wall windows and the missed lane re-asks past-wall holes; the walk stops only on inception or a vendor refusal.')
