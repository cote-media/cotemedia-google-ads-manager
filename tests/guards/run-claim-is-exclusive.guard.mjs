#!/usr/bin/env node
// LORAMER_FIRE_PLANS_UNTIL_FULL_V1 — ONE CHAIN PER RUN.
//
// The step's claim was a compare-and-set on `steps` alone, and a step releases the claim the instant it ends; a cron
// invocation reading in that gap claimed the same step, both chains ran, and the loser spun 116 lease-held steps at
// 2 s each while the other's real fire lost its accounting (Tri-Copy, 2026-09-23 15:59–16:04Z).
//   (a) SOURCE: the claim update carries `.is('last_invocation', null)` — a live claim cannot be taken
//   (b) SOURCE: a lease-held fire answer ends the chain (`leaseHeldFromFireBody` → `chained: false`)
//   (c) PURE: leaseHeldFromFireBody reads the fire's held line and nothing else
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

// (a)(b)
{
  const s = strip(read(STEP))
  const claim = s.indexOf("last_invocation: invocation })")
  const sel = claim >= 0 ? s.indexOf(".select('steps')", claim) : -1
  const chain = claim >= 0 && sel > claim ? s.slice(claim, sel) : ''
  check(claim >= 0, `(a) ${STEP}: the claim update was not found`)
  check(/\.is\('last_invocation',\s*null\)/.test(chain), `(a) ${STEP}: the claim CAS must carry .is('last_invocation', null) — a live claim can otherwise be taken by a second invocation`)
  check(/leaseHeldFromFireBody\(/.test(s), `(b) ${STEP}: the step does not read leaseHeldFromFireBody`)
  const lh = s.indexOf('leaseHeldFromFireBody(')
  const after = lh >= 0 ? s.slice(lh, lh + 900) : ''
  check(/chained:\s*false/.test(after), `(b) ${STEP}: a lease-held answer must return chained: false (exit the chain)`)
}

// (c)
{
  const out = mkdtempSync(join(tmpdir(), 'run-claim-'))
  try {
    const r = spawnSync(join(ROOT, 'node_modules', '.bin', 'tsc'), [resolve(ROOT, RUN), '--target', 'es2020', '--module', 'commonjs',
      '--moduleResolution', 'node', '--skipLibCheck', '--noResolve', '--rootDir', ROOT, '--outDir', out], { encoding: 'utf8' })
    if (r.error) throw new Error(`tsc did not run: ${r.error.message}`)
    const R = createRequire(import.meta.url)(join(out, 'src/lib/backfill/continuous-run.js'))
    if (typeof R.leaseHeldFromFireBody !== 'function') throw new Error('leaseHeldFromFireBody not exported')
    check(R.leaseHeldFromFireBody({ ok: true, held: 'FIRE LEASE HELD — another fire (or an operator drive) is running this lane: holder x since y' }) === true, `(c) the fire's lease-held line was not recognised`)
    check(R.leaseHeldFromFireBody({ ok: true, held: 'google quota: RESOURCE_EXHAUSTED — lane held' }) === false, `(c) a quota hold was read as a lease hold`)
    check(R.leaseHeldFromFireBody({ ok: true }) === false && R.leaseHeldFromFireBody(null) === false, `(c) an answer with no held line was read as a lease hold`)
  } catch (e) { findings.push(`(c) could not drive continuous-run: ${e.message}`) }
  finally { rmSync(out, { recursive: true, force: true }) }
}

if (findings.length) { console.error(`[run-claim-is-exclusive] FAIL — ${findings.length} finding(s):`); for (const f of findings) console.error(`  ✗ ${f}`); process.exit(1) }
console.log('[run-claim-is-exclusive] PASS — the claim CAS refuses a live claim and a lease-held answer ends the chain')
