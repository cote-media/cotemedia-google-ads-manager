#!/usr/bin/env node
// LORAMER_RUN_END_KIND_V1 — EVERY WAY A RUN ENDS HAS A NAMED KIND, AND THE KIND DECIDES WHAT A PRESS MAY DO.
//
// The run row ends under two statuses ('done' | 'failed') and several reason strings (continuous-run.ts decideChain).
// 'done' is BOTH the floor arrival and the operator stop — a press after the operator stopped it should continue the
// descent; a press after the floor must not start one (MAP §7: "when it is done, it is done"). endKindOf is the ONE
// place a reason becomes a kind. This guard proves:
//   (a) PURE endKindOf: floor reason → 'floor'; operator-stop reason → 'stopped'; status 'failed' → 'failed';
//       a live run (running/stopping, or no finish) → null; an unknown 'done' reason → 'stopped' (never 'floor')
//   (b) the two 'done' reasons in decideChain are the RUN_END_REASON constants, not free strings, so the kind and the
//       reason cannot drift; every `status: 'failed'` return carries a reason
import { readFileSync, mkdtempSync, rmSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'

const ROOT = process.env.LORAMER_GUARD_ROOT || process.cwd()
const findings = []
const check = (c, m) => { if (!c) findings.push(m) }
const read = (rel) => { try { return readFileSync(resolve(ROOT, rel), 'utf8') } catch (e) { findings.push(`UNREADABLE ${rel} — ${e.message}. A guard that cannot read its evidence FAILS.`); return '' } }
const strip = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter((l) => !/^\s*(\/\/|\*)/.test(l)).join('\n')

const RUN = 'src/lib/backfill/continuous-run.ts'

const out = mkdtempSync(join(tmpdir(), 'run-end-kind-'))
try {
  const r = spawnSync(join(ROOT, 'node_modules', '.bin', 'tsc'), [
    resolve(ROOT, RUN), '--target', 'es2020', '--module', 'commonjs', '--moduleResolution', 'node',
    '--skipLibCheck', '--noResolve', '--rootDir', resolve(ROOT), '--outDir', out,
  ], { encoding: 'utf8' })
  if (r.error) throw new Error(`tsc did not run: ${r.error.message}`)
  const R = createRequire(import.meta.url)(join(out, 'src/lib/backfill/continuous-run.js'))
  if (typeof R.endKindOf !== 'function' || !R.RUN_END_REASON) throw new Error('endKindOf / RUN_END_REASON not exported')
  check(R.endKindOf({ status: 'done', stopReason: R.RUN_END_REASON.floor, finishedAt: '2026-09-18T03:20:45Z' }) === 'floor', `(a) the floor reason must read 'floor'`)
  check(R.endKindOf({ status: 'done', stopReason: R.RUN_END_REASON.stopped, finishedAt: '2026-09-18T03:20:45Z' }) === 'stopped', `(a) the operator-stop reason must read 'stopped'`)
  check(R.endKindOf({ status: 'failed', stopReason: 'step reported a fatal condition: step returned HTTP 508: null', finishedAt: '2026-09-17T18:50:35Z' }) === 'failed', `(a) status 'failed' must read 'failed'`)
  check(R.endKindOf({ status: 'running', stopReason: null, finishedAt: null }) === null, `(a) a live run has no end kind`)
  check(R.endKindOf({ status: 'stopping', stopReason: null, finishedAt: null }) === null, `(a) a stopping run has no end kind yet`)
  check(R.endKindOf({ status: 'done', stopReason: 'something new', finishedAt: '2026-09-18T00:00:00Z' }) === 'stopped', `(a) an unknown 'done' reason must never read 'floor' — 'stopped' is the safe kind (a press may continue)`)
  check(R.endKindOf({ status: 'done', stopReason: R.RUN_END_REASON.floor, finishedAt: null }) === null, `(a) without finished_at the row is not ended, whatever the text says`)
  // (b) the literals live in one place
  const src = strip(read(RUN))
  const doneReturns = src.match(/status: 'done', reason: [^\n]+/g) ?? []
  check(doneReturns.length === 2 && doneReturns.every((l) => /RUN_END_REASON\.(floor|stopped)/.test(l)), `(b) every \`status: 'done'\` return in decideChain must carry RUN_END_REASON.floor or .stopped, never a free string — found ${JSON.stringify(doneReturns)}`)
  const failedReturns = src.match(/status: 'failed'[\s\S]{0,40}reason:/g) ?? []
  check(failedReturns.length >= 3, `(b) expected the three failed exits (fatal, ceiling, no-progress) each with a reason — found ${failedReturns.length}`)
} catch (e) {
  findings.push(`could not drive endKindOf — ${e.message}. A guard that cannot run its subject FAILS.`)
} finally {
  rmSync(out, { recursive: true, force: true })
}

if (findings.length) {
  console.error(`[run-end-kind] FAIL — ${findings.length} finding(s):`)
  for (const f of findings) console.error('  • ' + f)
  process.exit(1)
}
console.log("[run-end-kind] PASS — endKindOf maps the floor reason to 'floor', the operator stop to 'stopped', status failed to 'failed', a live row to null; the two 'done' reasons are RUN_END_REASON constants.")
