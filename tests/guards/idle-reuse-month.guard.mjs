#!/usr/bin/env node
// LORAMER_IDLE_REUSE_MONTH_V1 — AN ACCOUNT-ACTIVITY ANSWER IS KEYED BY CALENDAR MONTH AND REUSED, NEVER RE-ASKED IN A RUN.
//
// Measured 2026-09-18 (Tri-Copy): 49 idle checks bought 570 owed days — 7 answers were 'active' and retired nothing,
// and the memo was per WINDOW per FIRE, so surfaces sitting at their own windows rarely shared one and the next fire
// asked the same months again. An 'active'/'idle' answer for a month never changes (★IDLE-CHECK-REUSES-ITS-ANSWERS).
// This guard proves:
//   (a) PURE monthsOf / priorActivityFromLedger: a 'zero' answer marks every month it fully covers idle; an 'ok' answer
//       whose ledger text names its days marks those months with those days; a partially covered month is NOT reused
//   (b) MEMO: with a prior answer for a month, two entries in that month cost ZERO new requests and read the prior
//       verdict; a window touching an unanswered month asks once, and its months are then reusable inside the fire
//   (c) the worker's ledger text carries the named days (so the next fire can reuse them) and the fire builds the memo
//       from the ledger's prior answers
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

const LIB = 'src/lib/backfill/universe-idle-skip.ts'
const WORKER = 'src/lib/backfill/universe-v2-worker.ts'
const IDLE = 'src/lib/backfill/universe-idle-skip.ts'
const ROUTE = 'src/app/api/cron/universe-resume/route.ts'

let M = null
const tmp = mkdtempSync(join(tmpdir(), 'idle-reuse-'))
try {
  const src = read(LIB)
    .replace(/import type \{ CanaryState \} from '@\/lib\/backfill\/retention-wall'\n/, '')
    .replace(/import \{ isPastWall \} from '@\/lib\/backfill\/retention-wall'/, 'const isPastWall = (end, wall) => end < wall')
  writeFileSync(join(tmp, 'idle.ts'), src)
  const r = spawnSync(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['tsc', '--noResolve', '--skipLibCheck', '--target', 'es2022', '--module', 'es2022', '--moduleResolution', 'node', '--outDir', tmp, join(tmp, 'idle.ts')], { cwd: ROOT, encoding: 'utf8' })
  if (r.error) findings.push(`could not run tsc — ${r.error.message}`)
  M = await import(pathToFileURL(join(tmp, 'idle.js')).href)
  for (const fn of ['monthsOf', 'priorActivityFromLedger', 'createIdleMemo']) if (typeof M[fn] !== 'function') { findings.push(`(a) ${LIB} does not export ${fn}()`); M = null }
} catch (e) {
  findings.push(`the behavioural legs could not run — ${e.message}. A guard that cannot execute its subject FAILS.`)
} finally {
  rmSync(tmp, { recursive: true, force: true })
}

if (M) {
  // (a)
  check(M.monthsOf('2025-11-12', '2025-12-11').join(',') === '2025-11,2025-12', `(a) monthsOf must list the calendar months a window touches — got ${M.monthsOf('2025-11-12', '2025-12-11')}`)
  const prior = M.priorActivityFromLedger([
    { window_start: '2025-11-01', window_end: '2025-11-30', outcome: 'zero', error: 'ACCOUNT_ACTIVITY — 0 active day(s) named by the vendor in 2025-11-01..2025-11-30 days=[]' },
    { window_start: '2025-09-15', window_end: '2025-10-31', outcome: 'ok', error: 'ACCOUNT_ACTIVITY — 2 active day(s) named by the vendor in 2025-09-15..2025-10-31 days=[2025-10-03,2025-10-20]' },
    { window_start: '2025-08-01', window_end: '2025-08-31', outcome: 'ok', error: 'ACCOUNT_ACTIVITY — 1 active day(s) named by the vendor in 2025-08-01..2025-08-31' },
  ])
  check(prior.has('2025-11') && prior.get('2025-11').length === 0, `(a) a 'zero' answer fully covering November must mark 2025-11 idle (empty day list) — got ${JSON.stringify([...prior.entries()])}`)
  check(prior.has('2025-10') && prior.get('2025-10').join(',') === '2025-10-03,2025-10-20', `(a) an 'ok' answer fully covering October must mark 2025-10 with its named days — got ${JSON.stringify(prior.get('2025-10'))}`)
  check(!prior.has('2025-09'), `(a) September was only PARTIALLY covered (from the 15th) and must NOT be reusable — got ${JSON.stringify(prior.get('2025-09'))}`)
  check(!prior.has('2025-08'), `(a) an 'ok' answer WITHOUT named days (legacy text) cannot be reused — got ${JSON.stringify(prior.get('2025-08'))}`)

  // (b)
  const asked = []
  const stream = (gaql) => (async function* () { asked.push(gaql); yield { segments: { date: '2025-12-05' } } })()
  const ledger = async () => {}
  const memo = M.createIdleMemo({ wallLine: '2023-08-18', canary: 'served', maxWindows: 4, prior })
  const v1 = await memo.verdictFor({ windowStart: '2025-11-03', windowEnd: '2025-11-20', stream, ledger })
  const v2 = await memo.verdictFor({ windowStart: '2025-11-21', windowEnd: '2025-11-30', stream, ledger })
  check(v1.kind === 'idle' && v2.kind === 'idle' && asked.length === 0 && memo.stats.requestsSpent === 0 && memo.stats.reused === 2, `(b) two entries inside an answered idle month must read 'idle' with ZERO new requests — got ${v1.kind}/${v2.kind}, asked ${asked.length}, reused ${memo.stats.reused}`)
  const v3 = await memo.verdictFor({ windowStart: '2025-10-05', windowEnd: '2025-10-25', stream, ledger })
  check(v3.kind === 'active' && asked.length === 0, `(b) an entry inside an answered ACTIVE month must read 'active' from the prior days with no request — got ${v3.kind}, asked ${asked.length}`)
  // December is unanswered: one live ask, then the whole December window's months become reusable
  const v4 = await memo.verdictFor({ windowStart: '2025-12-01', windowEnd: '2025-12-31', stream, ledger })
  const v5 = await memo.verdictFor({ windowStart: '2025-12-01', windowEnd: '2025-12-10', stream, ledger })
  check(v4.kind === 'active' && asked.length === 1 && v5.kind === 'active' && memo.stats.requestsSpent === 1 && memo.stats.reused === 4, `(b) an unanswered month is asked ONCE and then reused within the fire (the named day 2025-12-05 falls in both windows) — got ${v4.kind}/${v5.kind}, asked ${asked.length}, spent ${memo.stats.requestsSpent}, reused ${memo.stats.reused}`)
  const v5b = await memo.verdictFor({ windowStart: '2025-12-10', windowEnd: '2025-12-20', stream, ledger })
  check(v5b.kind === 'idle' && asked.length === 1, `(b) a reused month judged over a window that holds none of its named days reads 'idle' with no request — got ${v5b.kind}, asked ${asked.length}`)
  // a window spanning two unanswered months asks (no partial synthesis); the fixture stream names no day in it → idle, ONE request
  const v6 = await memo.verdictFor({ windowStart: '2026-01-15', windowEnd: '2026-02-14', stream, ledger })
  check(asked.length === 2 && v6.kind === 'idle', `(b) a window touching an unanswered month must ask — got asked ${asked.length}, ${v6.kind}`)
}

// (c) placement
{
  const w = strip(read(WORKER))
  check(/days=\[\$\{answer\.activeDays\.join\(','\)\}\]/.test(w) && !/activeDays\.slice\(0,\s*\d+\)/.test(w), `(c) ${WORKER}: the __account_activity row must carry EVERY named day (days=[${'${answer.activeDays.join(\',\')}'}]) — LORAMER_IDLE_SEED_RETRACTION_V1: a capped list (slice(0, 92)) let 360-day windows read every month past the 92nd day as idle; 390 surface-windows were retired false on 2026-09-24.`)
  const I = strip(read(IDLE))
  check(/named\s*!==?\s*[a-z]+\.length|\.length\s*!==?\s*named/.test(I) && /active day\(s\)/.test(I), `(c) ${IDLE}: namedDaysFromLedgerText must refuse a list whose length differs from the row's named count ("N active day(s)") — a short list is not the answer; the 1,026 capped seeds must read NOT REUSABLE.`)
  const r = strip(read(ROUTE))
  check(/priorActivityFromLedger\(/.test(r) && /createIdleMemo\(\{ wallLine, canary: canary\.state, prior: idlePrior \}\)/.test(r), `(c) ${ROUTE}: the fire must build the memo from the ledger's prior __account_activity answers (priorActivityFromLedger → createIdleMemo({ …, prior })).`)
}

if (findings.length) {
  console.error(`[idle-reuse-month] FAIL — ${findings.length} finding(s):`)
  for (const f of findings) console.error('  • ' + f)
  process.exit(1)
}
console.log('[idle-reuse-month] PASS — account-activity answers are keyed by calendar month: a fully answered month is reused (zero requests) by every entry that lands in it, within the fire and across fires via the ledger; a partially covered or day-less answer is never synthesised.')
