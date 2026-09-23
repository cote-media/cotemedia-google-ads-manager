#!/usr/bin/env node
// LORAMER_FIRE_PLANS_UNTIL_FULL_V1 — ONLY UNITS THAT OPENED A VENDOR ATTEMPT COUNT AS ASKING.
//
// The run step fed the no-progress clock with `requestsSelected` — units the fire SELECTED — so two fires whose
// units were all deferred for budget (0 started, 0 retired) read as "297 s of asking with nothing retired" and the
// run ended failed (Tri-Copy, 2026-09-23 16:35:56Z). The clock's input is now `executedOf`.
//   (a) SOURCE: universe-run-step.ts maps requestsOpened from inst.executedOf and never from inst.requestsSelected
//   (b) PURE: applyStep / decideChain on a step with requestsOpened 0 and nothing retired neither counts nor ends
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
const STEP = 'src/lib/backfill/universe-run-step.ts'
const RUN = 'src/lib/backfill/continuous-run.ts'

// (a)
{
  const s = strip(read(STEP))
  check(/requestsOpened:\s*Number\(inst\.executedOf \?\? 0\)/.test(s), `(a) ${STEP}: requestsOpened must be Number(inst.executedOf ?? 0)`)
  check(!/requestsOpened:\s*Number\(inst\.requestsSelected/.test(s), `(a) ${STEP}: requestsOpened still reads inst.requestsSelected — selected units are not asks`)
}

// (b)
{
  const out = mkdtempSync(join(tmpdir(), 'asking-executed-'))
  try {
    const r = spawnSync(join(ROOT, 'node_modules', '.bin', 'tsc'), [resolve(ROOT, RUN), '--target', 'es2020', '--module', 'commonjs',
      '--moduleResolution', 'node', '--skipLibCheck', '--noResolve', '--rootDir', ROOT, '--outDir', out], { encoding: 'utf8' })
    if (r.error) throw new Error(`tsc did not run: ${r.error.message}`)
    const R = createRequire(import.meta.url)(join(out, 'src/lib/backfill/continuous-run.js'))
    const state = { status: 'running', steps: 5, stepsWithoutProgress: 0, runElapsedMs: 600_000, askingWithoutProgressMs: 400_000 }
    const deferred = { requestsOpened: 0, daysNoLongerOwed: 0, atFloor: false, held: null, fatal: null }
    const next = R.applyStep(state, deferred)
    check(next.stepsWithoutProgress === 0, `(b) a step with 0 executed units was counted as a no-progress step`)
    const v = R.decideChain(state, deferred)
    check(v.chain === true, `(b) a step with 0 executed units ended the run: ${v.reason}`)
    const asked = { requestsOpened: 12, daysNoLongerOwed: 0, atFloor: false, held: null, fatal: null }
    const v2 = R.decideChain(state, asked)
    check(v2.chain === false && v2.status === 'failed', `(b) a step that ASKED 12 units and retired nothing for 400 s must still end the run — got ${JSON.stringify(v2)}`)
  } catch (e) { findings.push(`(b) could not drive continuous-run: ${e.message}`) }
  finally { rmSync(out, { recursive: true, force: true }) }
}

if (findings.length) { console.error(`[asking-counts-executed-only] FAIL — ${findings.length} finding(s):`); for (const f of findings) console.error(`  ✗ ${f}`); process.exit(1) }
console.log('[asking-counts-executed-only] PASS — the no-progress clock counts executed units only; deferred units neither count nor end a run')
