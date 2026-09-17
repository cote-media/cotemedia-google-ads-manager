#!/usr/bin/env node
// LORAMER_RUN_PROGRESS_SIGNAL_V1 — THE CONTINUOUS RUN'S PROGRESS IS DAYS NO LONGER OWED, READ UNDER THE LEDGER'S
// OWN SPELLING, AND A HOLD IS ONLY WHAT THE FIRE CALLS A HOLD.
//
// ⛔ THE MEASURED DEFECTS, Tri-Copy, 2026-09-16/17 — the first continuous run ended itself after 3 steps on a
// false reading, all three halves of which were this engine's own:
//   (i)   the run was keyed `google_ads` (the universe's name) and passed that spelling straight into the
//         attempt ledger, which spells the vendor `google` (universe-v2-contract.ts). The progress query matched
//         NOTHING, on every step, so a lane that was moving read as still.
//   (ii)  progress counted `day_committed` rows — DAYS WITH ROWS. Of the run's 384 attempts, 204 returned
//         empty-and-attested and 180 were already covered, so zero days were "committed" while the lane genuinely
//         retired ground. The measure the done-done ruling names is DAYS NO LONGER OWED (LORAMER_MAP §7:
//         "a progress meter … measured in days no longer owed, never rows written and never requests spent").
//   (iii) the fire's `meter` field is its budget line and is present on EVERY completed fire; the route read it
//         as a hold, so every step's reason said "held: google: 19103 + 68 …" and the stop reason blamed a hold
//         that never existed.
//
// LEGS
//  (i)   BEHAVIOURAL: ledgerVendorFor(universe name) yields the ledger contract's own VENDOR, and any other
//        spelling passes through untouched; SOURCE: the route hands the ledger read ledgerVendorFor(vendor) and
//        never the raw run vendor.
//  (ii)  BEHAVIOURAL, on the real coverage module with a fake ledger: a day committed by the descent counts once;
//        a zero-attested descend window counts every day in it; a lookback record (re-asking covered ground for
//        restatement) counts nothing; a top-edge zero counts nothing (it never attests); an unreadable ledger is
//        an error, never zero.
//  (iii) BEHAVIOURAL: heldFromFireBody() returns the fire's `held` string and NEVER its `meter` line; SOURCE: the
//        route no longer falls back to body.meter for the hold.
//  (iv)  SOURCE: the chain rule's field is named for what it measures — daysNoLongerOwed, not daysCommitted.
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync, rmSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import Module from 'node:module'

const ROOT = process.env.LORAMER_GUARD_ROOT || process.cwd()
const findings = []
const check = (c, m) => { if (!c) findings.push(m) }
const read = (rel) => {
  try { return readFileSync(resolve(ROOT, rel), 'utf8') }
  catch (e) { findings.push(`UNREADABLE ${rel} — ${e.message}. A guard that cannot read its evidence FAILS.`); return '' }
}
const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter((l) => !/^\s*(\/\/|\*)/.test(l)).join('\n')

const RUN = 'src/lib/backfill/continuous-run.ts'
const ROUTE = 'src/app/api/backfill/universe-run/route.ts'
const SPELLING = 'src/lib/backfill/universe-vendor-spelling.ts'
const CONTRACT = 'src/lib/backfill/universe-v2-contract.ts'
const WINDOW_LOG = 'src/lib/backfill/universe-window-log.ts'
const QUOTA_WINDOW = 'src/lib/backfill/google-quota-window.ts'
const COVERAGE = 'src/lib/backfill/universe-coverage.ts'
const SURFACES = 'src/lib/backfill/universe-surfaces.ts'

// ── A FAKE LEDGER shaped like the builder the coverage module uses ─────────────────────────────────────
function makeDb(state) {
  const builder = (table) => {
    const q = { table, filters: [], head: false, count: false }
    const b = {
      select(_cols, opts) { q.head = !!(opts && opts.head); q.count = !!(opts && opts.count); return b },
      eq(c, v) { q.filters.push((r) => r[c] === v); return b },
      neq(c, v) { q.filters.push((r) => r[c] !== v); return b },
      gte(c, v) { q.filters.push((r) => r[c] >= v); return b },
      lte(c, v) { q.filters.push((r) => r[c] <= v); return b },
      lt(c, v) { q.filters.push((r) => r[c] < v); return b },
      in(c, vs) { q.filters.push((r) => vs.includes(r[c])); return b },
      then(res) {
        if (state.fail) return Promise.resolve({ data: null, count: null, error: { message: state.fail } }).then(res)
        let rows = [...(state.tables[table] ?? [])]
        for (const f of q.filters) rows = rows.filter(f)
        state.reads.push({ table, n: rows.length, head: q.head })
        return Promise.resolve({ data: q.head ? null : rows, count: q.count ? rows.length : null, error: null }).then(res)
      },
    }
    return b
  }
  return { from: builder }
}

const out = mkdtempSync(join(tmpdir(), 'loramer-run-progress-'))
try {
  const tsc = join(ROOT, 'node_modules', '.bin', 'tsc')
  const files = [RUN, SPELLING, CONTRACT, WINDOW_LOG, QUOTA_WINDOW, COVERAGE, SURFACES, 'src/lib/concurrency.ts']
  const r = spawnSync(tsc, [...files.map((f) => resolve(ROOT, f)), '--target', 'es2020', '--module', 'commonjs',
    '--moduleResolution', 'node', '--skipLibCheck', '--noResolve', '--rootDir', resolve(ROOT), '--outDir', out], { encoding: 'utf8' })
  if (r.error) findings.push(`could not run tsc — ${r.error.message}`)
  const stubDir = join(out, 'stubs'); mkdirSync(stubDir, { recursive: true })
  writeFileSync(join(stubDir, 'supabase.js'), 'module.exports = { get supabaseAdmin() { return globalThis.__runDb } }\n')
  const compiled = (rel) => join(out, rel.replace(/\.ts$/, '.js'))
  const origResolve = Module._resolveFilename
  Module._resolveFilename = function (request, ...rest) {
    if (request === '@/lib/supabase') return join(stubDir, 'supabase.js')
    if (request === '@/lib/concurrency') return compiled('src/lib/concurrency.ts')
    if (request === '@/lib/backfill/universe-surfaces') return compiled(SURFACES)
    if (request === '@/lib/backfill/universe-window-log') return compiled(WINDOW_LOG)
    if (request === '@/lib/backfill/universe-v2-contract') return compiled(CONTRACT)
    if (request === '@/lib/backfill/google-quota-window') return compiled(QUOTA_WINDOW)
    return origResolve.call(this, request, ...rest)
  }
  let Run, Spelling, Contract, Coverage, WindowLog
  try {
    const req = createRequire(import.meta.url)
    Run = req(compiled(RUN))
    Spelling = req(compiled(SPELLING))
    Contract = req(compiled(CONTRACT))
    Coverage = req(compiled(COVERAGE))
    WindowLog = req(compiled(WINDOW_LOG))
  } finally { Module._resolveFilename = origResolve }

  // ── (i) THE LEDGER'S SPELLING ────────────────────────────────────────────────────────────────────────
  {
    const mapped = Spelling.ledgerVendorFor(WindowLog.VENDOR)
    check(mapped === Contract.VENDOR, `(i) ledgerVendorFor(${JSON.stringify(WindowLog.VENDOR)}) returned ${JSON.stringify(mapped)}, not the attempt ledger's own VENDOR ${JSON.stringify(Contract.VENDOR)}. A run keyed by the universe's name must read progress under the spelling the ledger actually writes, or the progress query matches nothing — the Tri-Copy false stop.`)
    check(Spelling.ledgerVendorFor('shopify') === 'shopify', '(i) a vendor with no second spelling did not pass through untouched — the map must be a translation, not a filter.')
  }

  // ── (ii) DAYS NO LONGER OWED, on the real coverage reader ────────────────────────────────────────────
  {
    const SINCE = '2026-09-17T10:00:00.000Z'
    const before = '2026-09-17T09:59:00.000Z'
    const after = '2026-09-17T10:00:05.000Z'
    const K = { clientId: 'client-a', vendor: 'v' } // fixture: not a uuid, and the vendor is deliberately not a platform word
    const started = (key, lane) => ({ client_id: K.clientId, vendor: K.vendor, phase: 'attempt_started', message_key: key, invocation_id: 'inv-' + key, lane, recorded_at: after })
    const committed = (day, lane, at = after) => ({ client_id: K.clientId, vendor: K.vendor, phase: 'day_committed', day, lane, recorded_at: at, resource: 'r', segment: '' })
    const zero = (key, s, e, outcome = 'zero') => ({ client_id: K.clientId, vendor: K.vendor, phase: 'attempt_finished', outcome, window_start: s, window_end: e, message_key: key, invocation_id: 'inv-' + key, lane: 'descend', recorded_at: after, resource: 'r', segment: '' })
    const run = async (rows, fail = null) => {
      const state = { tables: { universe_attempt_log: rows }, reads: [], fail }
      globalThis.__runDb = makeDb(state)
      return Coverage.daysNoLongerOwedSince(K, SINCE)
    }
    // a descent commit counts once; a lookback commit (restatement of covered ground) counts nothing
    check(await run([committed('2026-09-01', 'descend')]) === 1, '(ii) one day committed by the descent did not count as one day no longer owed.')
    check(await run([committed('2026-09-01', 'lookback')]) === 0, '(ii) a LOOKBACK commit counted as ground gained. The lookback re-asks days that are already covered (restatement); it retires nothing.')
    // a zero-attested descend window retires every day in it — this is the Tri-Copy case: 204 of 384 attempts
    check(await run([started('m1', 'descend'), zero('m1', '2026-09-01', '2026-09-03')]) === 3,
      '(ii) ⛔ A ZERO-ATTESTED WINDOW COUNTED AS NO PROGRESS. A dormant day the vendor attests empty is no longer owed — Tri-Copy retired 204 such attempts while the meter read 0 and the run ended itself.')
    check(await run([started('m2', 'descend'), zero('m2', '2026-09-01', '2026-09-02', 'nongrain')]) === 2, '(ii) a nongrain attestation did not count — it is the vendor answering, exactly as zero is (LORAMER_NONGRAIN_ATTESTS_V1).')
    check(await run([started('m3', 'top-edge'), zero('m3', '2026-09-10', '2026-09-12')]) === 0, '(ii) a TOP-EDGE zero counted as progress. The top edge never attests (a zero there is indistinguishable from a not-yet-served day), so nothing was retired.')
    check(await run([started('m4', 'missed'), zero('m4', '2026-09-05', '2026-09-05')]) === 1, '(ii) a missed-lane zero did not count; the missed lane attests exactly like the descent.')
    // only THIS step's records count
    check(await run([committed('2026-09-01', 'descend', before)]) === 0, '(ii) a commit recorded BEFORE the step was counted as this step\'s progress.')
    // mixed: 1 commit + a 3-day zero + a lookback commit = 4
    check(await run([committed('2026-09-01', 'descend'), started('m5', 'descend'), zero('m5', '2026-08-01', '2026-08-03'), committed('2026-09-15', 'lookback')]) === 4, '(ii) the mixed case did not sum to 4 (1 committed + 3 attested + 0 lookback).')
    // an unreadable ledger must not read as zero progress
    let threw = false
    try { await run([], 'connection refused') } catch { threw = true }
    check(threw, '(ii) an unreadable ledger returned a number instead of throwing. Zero from a failed read would let a broken read end a healthy run through the no-progress bound.')
    // the pure core is exported, so the rule is testable without a database
    check(typeof Coverage.daysNoLongerOwedFromClosures === 'function', '(ii) daysNoLongerOwedFromClosures is not exported — the counting rule must be a pure function, or it can only be proven against a live ledger.')
  }

  // ── (iii) A HOLD IS WHAT THE FIRE CALLS A HOLD ───────────────────────────────────────────────────────
  {
    const meterOnly = { ok: true, meter: 'google: 19103 + 68 (68 fetches) of no daily cap (Standard access)', instrument: {} }
    check(Run.heldFromFireBody(meterOnly) === null, `(iii) ⛔ A COMPLETED FIRE READ AS HELD. heldFromFireBody returned ${JSON.stringify(Run.heldFromFireBody(meterOnly))} for a body whose only budget line is \`meter\` — that line is present on EVERY completed fire, so every step reported "held" and the stop reason blamed a hold that never existed.`)
    const held = { ok: true, published: 0, held: 'quota paused until 2026-09-18T00:00Z', meter: 'x' }
    check(Run.heldFromFireBody(held) === 'quota paused until 2026-09-18T00:00Z', '(iii) a fire that said it was held was not reported as held.')
    check(Run.heldFromFireBody({ ok: true, held: '' }) === null, '(iii) an empty held string read as a hold.')
    check(Run.heldFromFireBody(null) === null, '(iii) a missing body threw or read as held.')
    // and the chain rule shows no hold when none exists
    const v = Run.decideChain({ status: 'running', steps: 1, stepsWithoutProgress: 0 }, { requestsOpened: 5, daysNoLongerOwed: 0, atFloor: false, held: null, fatal: null })
    check(!/held/i.test(v.reason), `(iii) a step with no hold still carries "held" in its reason: ${v.reason}`)
  }
} catch (e) {
  findings.push(`the behavioural legs could not run — ${e.message}. A guard that cannot execute its subject FAILS; it does not pass quietly.`)
} finally {
  rmSync(out, { recursive: true, force: true })
}

// ── SOURCE LEGS ────────────────────────────────────────────────────────────────────────────────────────
{
  const route = stripComments(read(ROUTE))
  const run = stripComments(read(RUN))
  check(/daysNoLongerOwedSince\(\s*\{[^}]*vendor:\s*ledgerVendorFor\(vendor\)/.test(route), `(i) ${ROUTE} does not read progress through daysNoLongerOwedSince({ …, vendor: ledgerVendorFor(vendor) }). The raw run vendor is the universe's name; the ledger spells it differently.`)
  check(!/\.eq\('vendor',\s*vendor\)/.test(route.replace(/from\('universe_run'\)[\s\S]*?\n/g, '')) || !/universe_attempt_log/.test(route), `(i) ${ROUTE} still queries the attempt ledger with the raw run vendor.`)
  check(/held:\s*heldFromFireBody\(body\)/.test(route), `(iii) ${ROUTE} does not take the hold from heldFromFireBody(body).`)
  check(!/held:[^\n]*body\?*\.meter/.test(route), `(iii) ${ROUTE} still falls back to body.meter for the hold — the meter line is present on every completed fire.`)
  check(/daysNoLongerOwed:\s*number/.test(run) && !/daysCommitted:\s*number/.test(run), `(iv) ${RUN}'s StepOutcome is not named daysNoLongerOwed. A field called daysCommitted that carries attested days is the adjacent-number label this engine keeps paying for.`)
  check(/retired no owed days/.test(read(RUN)), `(iv) ${RUN}'s no-progress wording still says "committed no days"; the bound is about owed ground, and the stop reason must say so.`)
}

if (findings.length) {
  console.error(`[run-progress-signal] FAIL — ${findings.length} finding(s):`)
  for (const f of findings) console.error(`  - ${f}`)
  process.exit(1)
}
console.log('[run-progress-signal] PASS — the run reads the ledger under its own spelling · progress is days no longer owed (committed or attested, never lookback, never top-edge) and an unreadable ledger throws · a hold is only what the fire calls a hold · the field is named for what it measures.')
