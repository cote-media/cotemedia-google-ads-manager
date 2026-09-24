#!/usr/bin/env node
// LORAMER_PAST_LINE_EMPTY_V1 — AN EMPTY ANSWER PAST THE 37-MONTH LINE IS RECORDED EMPTY, EXACTLY AS ABOVE IT.
// (Was wall-hold-never-retire.guard.mjs — LORAMER_WALL_HOLD_NEVER_RETIRE_V1, Q6 2026-09-18 — superseded for past-line
// silence by Russ's ruling of 2026-09-23: "If there's data go get it.")
//
// WHY THE FLIP IS MEASURED, NOT ARGUED (rounds 39–40, 2026-09-23): 716 daily asks 39 and 75 months back on two accounts
// were all SERVED or EMPTY — zero DateRangeErrors; Tri-Copy's 2016 daily rows reproduced (5,420 rows); 2,481 month-grain
// witness asks over every held window fleet-wide (12,790 windows) found ZERO months with monthly rows where every daily
// answer was empty. Google's daily silence past the line is emptiness; the only silent omission on the wire is reach and
// frequency (metric-level, 36 months / 92 days), which the walk does not capture. The line stays as the instrument's
// label and the canary keeps running as the enforcement detector; neither classifies an answer.
//   (a) PURE classifyEmptyAnswer: 'zero' for every rangeEnd (above, at, past the line) under every canary state
//   (b) PURE idleVerdict: an empty account answer past the line reads 'idle' exactly as above it
//   (c) the fire asks past-line windows (no canary refusal) and the missed lane re-asks past-line holes — unchanged
//   (d) no worker path emits UNRESOLVED_PAST_WALL any more; a past-line empty is COUNTED (onPastLineEmpty) and retired
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
    check(v === 'zero', `(a) ⛔ an empty answer PAST the line with canary '${c}' classified as '${v}' — LORAMER_PAST_LINE_EMPTY_V1: an empty answer is recorded empty wherever the day sits (measured: 0 omissions in 12,790 witnessed windows).`)
    const above = W.classifyEmptyAnswer({ rangeEnd: '2025-11-10', wallLine: wall, canary: c })
    check(above === 'zero', `(a) an empty answer ABOVE the wall with canary '${c}' classified as '${above}' — above the wall an empty is NO_DATA_OBSERVED, as always.`)
  }
  check(W.classifyEmptyAnswer({ rangeEnd: wall, wallLine: wall, canary: 'unknown' }) === 'zero', `(a) the boundary day (rangeEnd == wallLine) is not past the wall.`)
}
if (I) {
  for (const c of ['served', 'unknown']) {
    const v = I.idleVerdict({ windowStart: '2016-05-01', windowEnd: '2016-06-03', wallLine: '2023-08-18', canary: c, answer: { ok: true, activeDays: [] } })
    check(v.kind === 'idle', `(b) ⛔ past the line an empty account answer read '${v.kind}' under canary '${c}' — the account's own answer retires the window past the line exactly as above it.`)
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
  check(!/UNRESOLVED_PAST_WALL_MARKER/.test(w) && !/UNRESOLVED PAST WALL/.test(w) && !/unresolvedNote/.test(w), `(d) ${WORKER}: a worker path still emits UNRESOLVED_PAST_WALL — under LORAMER_PAST_LINE_EMPTY_V1 an empty past the line is outcome 'zero', never held.`)
  check(/opts\.onPastLineEmpty\?\.\(\)/.test(w) && /isPastWall\(range\.end, wallLine\)/.test(w), `(d) ${WORKER}: a past-line empty must be COUNTED (onPastLineEmpty on isPastWall) so the instrument stays loud while it retires.`)
}

if (findings.length) {
  console.error(`[past-line-empty] FAIL — ${findings.length} finding(s):`)
  for (const f of findings) console.error('  • ' + f)
  process.exit(1)
}
console.log('[past-line-empty] PASS — an empty answer past the line classifies zero under every canary state, the idle verdict applies past the line, the fire asks past-line windows and the missed lane re-asks holes, and no worker path emits UNRESOLVED_PAST_WALL (a past-line empty is counted and retired).')
