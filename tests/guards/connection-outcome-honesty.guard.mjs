#!/usr/bin/env node
// LORAMER_CONNECTION_OUTCOME_LEDGER_V1 — guard SUCCESS IS COUNTED, NOT SUBTRACTED.
//
// WHAT WE HAD WAS SUCCESS-BY-ABSENCE. Both cron lanes computed
//     connectionsSucceeded = Math.max(0, attempted - erroredConns)
//     erroredConns         = new Set(errsForP.map(e => e.clientId)).size
// so a connection that was skipped without pushing an error became a success by arithmetic, and errors were
// counted per CLIENT while attempted counted CONNECTIONS. MEASURED 2026-07-31: shopify catchup reported
// `att 9 / ok 9 / err 0` on every run of 07-29 and 07-30 while two of those nine could not authenticate at
// all and the forward lane recorded them as hard errors.
//
// THREE FAILURES, each independent:
//  (a) connectionsSucceeded derived by SUBTRACTION anywhere in a lane
//  (b) a lane incrementing an attempted counter and then continuing without either an error push or an
//      explicit skip record — the skip vanishes and is absorbed by whatever the arithmetic says
//  (c) errors counted per CLIENT where attempted counts CONNECTIONS
//
// Drives the REAL transpiled ledger for the counting semantics; pins the lane wiring at source, because a
// route cannot be executed hermetically inside `npm run build`. That split is stated, not sold as a proof.
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import Module, { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const ROOT = process.env.LORAMER_GUARD_ROOT || process.cwd()
const fail = (m) => { console.error(`[connection-outcome-honesty] FAIL — ${m}`); process.exit(1) }
const findings = []
const check = (c, m) => { if (!c) findings.push(m) }
const read = (p) => { try { return readFileSync(resolve(ROOT, p), 'utf8') } catch { return '' } }
// ⚠ SCAN CODE, NOT PROSE. The first run of this guard went RED against correct code because the fix's own
// comment block QUOTES the defective expression verbatim ("WHAT WAS HERE: connectionsSucceeded: Math.max(0,
// attempted - erroredConns)"). A guard that cannot tell a defect from its own obituary is Lesson 60's sibling:
// the anchor matched documentation. Whole-line comments are blanked; LINE NUMBERS ARE PRESERVED so findings
// still point at the right line, and trailing comments on code lines are deliberately left in scope.
const stripCommentLines = (src) => src.split('\n').map((l) => (/^\s*(\/\/|\*|\/\*)/.test(l) ? '' : l)).join('\n')
const readCode = (p) => stripCommentLines(read(p))

const SRC = 'src/lib/cron-connection-outcome.ts'
const CATCHUP = 'src/app/api/cron/catchup/route.ts'
const RUNS = 'src/lib/cron-runs.ts'

if (!existsSync(resolve(ROOT, SRC))) {
  fail(`${SRC} is missing — there is no ledger, so connectionsSucceeded can only be arithmetic on the error list, which is exactly what reported 9/9 while two connections could not authenticate.`)
}

// ── DRIVE THE REAL COUNTING SEMANTICS ───────────────────────────────────────────────────────────────────
const out = mkdtempSync(join(tmpdir(), 'loramer-connoutcome-'))
const tsc = join(ROOT, 'node_modules', '.bin', 'tsc')
const r = spawnSync(tsc, [resolve(ROOT, SRC), '--target', 'es2020', '--module', 'commonjs', '--moduleResolution',
  'node', '--skipLibCheck', '--rootDir', resolve(ROOT), '--outDir', out], { encoding: 'utf8' })
if (r.error) { rmSync(out, { recursive: true, force: true }); fail(`could not run tsc — ${r.error.message}`) }
const stub = join(out, '__stub.js')
writeFileSync(stub, 'module.exports = {}\n')
const origResolve = Module._resolveFilename
Module._resolveFilename = function (q, ...rest) { return q.startsWith('@/lib/') ? stub : origResolve.call(this, q, ...rest) }
const mod = require(join(out, 'src/lib/cron-connection-outcome.js'))
Module._resolveFilename = origResolve

for (const n of ['createConnectionLedger', 'applyOutcome', 'tallyOutcomes', 'connectionKey']) {
  if (typeof mod[n] !== 'function') { rmSync(out, { recursive: true, force: true }); fail(`${SRC} does not export ${n}.`) }
}
const { createConnectionLedger, applyOutcome } = mod

// ── (b) A SKIP IS NEVER A SUCCESS ───────────────────────────────────────────────────────────────────────
{
  const led = createConnectionLedger()
  led.begin('shopify', 'client-A', 'shop-a.myshopify.com')  // attempted, then skipped: no gap days
  led.begin('shopify', 'client-B', 'shop-b.myshopify.com')  // ditto
  const t = led.tally('shopify')
  check(t.attempted === 2, `(b) two attempted connections tallied ${t.attempted}.`)
  check(t.ok === 0, `(b) a connection that never completed any work counted as a SUCCESS (ok=${t.ok}). That is the 9/9 defect verbatim.`)
  check(t.skipped === 2, `(b) skipped tallied ${t.skipped}, expected 2 — a skip that is not counted is a skip that gets absorbed.`)
  check(t.errored === 0, `(b) a skip was miscounted as an error (errored=${t.errored}) — over-counting errors is not the fix either.`)
  // POSITIVE CONTROL: the ledger CAN say success, so a green above is not just a gate that never speaks.
  const led2 = createConnectionLedger()
  led2.begin('shopify', 'client-A', 'shop-a.myshopify.com')
  led2.mark('shopify', 'client-A', 'shop-a.myshopify.com', 'ok')
  check(led2.tally('shopify').ok === 1, `POSITIVE CONTROL: a connection that DID complete work was not counted as a success.`)
}

// ── (c) ERRORS ARE PER CONNECTION, NOT PER CLIENT ───────────────────────────────────────────────────────
{
  const led = createConnectionLedger()
  // ONE client, THREE connections, all three failing. The old expression counted this as 1 errored against
  // 3 attempted and therefore invented 2 successes.
  for (const acct of ['act_1', 'act_2', 'act_3']) {
    led.begin('meta', 'client-A', acct)
    led.mark('meta', 'client-A', acct, 'error')
  }
  const t = led.tally('meta')
  check(t.errored === 3, `(c) one client failing on three connections tallied errored=${t.errored}, expected 3 — errors are being deduped by CLIENT while attempted counts CONNECTIONS, which invents ${3 - t.errored} success(es).`)
  check(t.ok === 0, `(c) ${t.ok} phantom success(es) survived a client whose every connection failed.`)
  check(t.attempted === 3, `(c) attempted tallied ${t.attempted}, expected 3.`)
  // the key must actually carry the account, or per-connection counting is not possible at all
  check(mod.connectionKey('meta', 'c', 'act_1') !== mod.connectionKey('meta', 'c', 'act_2'),
    `(c) connectionKey collapses two different accounts of the same client into one key — the ledger cannot count per connection.`)
}

// ── PARTITION + PRECEDENCE ──────────────────────────────────────────────────────────────────────────────
{
  const led = createConnectionLedger()
  led.begin('google', 'c1', 'a1'); led.mark('google', 'c1', 'a1', 'ok')
  led.begin('google', 'c2', 'a2'); led.mark('google', 'c2', 'a2', 'error')
  led.begin('google', 'c3', 'a3')
  led.begin('meta', 'c4', 'a4'); led.mark('meta', 'c4', 'a4', 'ok') // must not leak across platforms
  const t = led.tally('google')
  check(t.attempted === t.ok + t.errored + t.skipped,
    `(partition) attempted ${t.attempted} != ok ${t.ok} + errored ${t.errored} + skipped ${t.skipped}. The three states must partition the attempted set by construction; if they do not, the counters can drift apart again.`)
  check(t.attempted === 3, `(partition) another platform's connections leaked into this tally (attempted=${t.attempted}, expected 3).`)
  check(applyOutcome('ok', 'error') === 'error', `(precedence) a connection that wrote rows AND errored resolved to '${applyOutcome('ok', 'error')}' — a partial fill must not read green.`)
  check(applyOutcome('error', 'ok') === 'error', `(precedence) an error was overwritten by a later success on the same connection.`)
  check(applyOutcome('skipped', 'ok') === 'ok', `(precedence) a skip was not upgraded by work that actually completed.`)
  check(applyOutcome(undefined, 'skipped') === 'skipped', `(precedence) an unregistered connection did not default to skipped.`)
}

// ── (a) NO SUBTRACTION IN ANY LANE ──────────────────────────────────────────────────────────────────────
// ⚠ THE HELD-WORK WAIVER, and it is deliberately self-cleaning. cron/sync carries UNCOMMITTED held work
// (the Google Tier-1 breadth widen), so its identical expression is not being edited in this flight; the
// one-line change is banked as a precondition on that widen. To stop the waiver becoming permanent silently,
// the guard FAILS if the waived file no longer contains the defect — at which point the waiver is stale and
// must be deleted, not carried. A waiver nobody is forced to revisit is how allowlists rot.
const WAIVERS = [{
  file: 'src/app/api/cron/sync/route.ts',
  marker: 'connectionsSucceeded: Math.max(0, attempted - erroredConns)',
  why: 'held Google Tier-1 breadth widen is uncommitted in this file; the one-line fix is banked as a precondition on that widen',
}]
const LANES = [CATCHUP, 'src/app/api/cron/sync/route.ts', 'src/app/api/cron/drain/route.ts']
for (const f of LANES) {
  const src = readCode(f)
  if (!src.trim()) { check(f === 'src/app/api/cron/drain/route.ts', `(a) ${f} is unreadable.`); continue }
  const waiver = WAIVERS.find((w) => w.file === f)
  const subtracts = /connectionsSucceeded:\s*Math\.max\(0,\s*attempted\s*-/.test(src) ||
                    /connectionsSucceeded:\s*[A-Za-z0-9_.]+\s*-\s/.test(src)
  if (waiver) {
    check(src.includes(waiver.marker),
      `(a) STALE WAIVER — ${f} no longer contains the waived expression, so the waiver in this guard is dead weight. Delete the WAIVERS entry; a waiver nobody revisits is how an allowlist rots into a permanent exemption.`)
    if (src.includes(waiver.marker)) console.warn(`[connection-outcome-honesty] WAIVED — ${f} still derives connectionsSucceeded by subtraction (${waiver.why}).`)
    continue
  }
  check(!subtracts,
    `(a) ${f} derives connectionsSucceeded by SUBTRACTION. Success computed as "attempted minus errors" makes every unrecorded skip a phantom success — the exact expression that reported 9/9 while two connections could not authenticate.`)
  check(!/new Set\((?:errsForP|[A-Za-z0-9_]*errs?[A-Za-z0-9_]*)\.map\(\s*\w+\s*=>\s*\w+\.clientId\s*\)\)/.test(src),
    `(c) ${f} counts errored connections as the distinct CLIENT ids in its error list, while attempted counts CONNECTIONS. One client failing three connections then produces two phantom successes.`)
}

// ── (b) THE WIRING: EVERY ATTEMPT REGISTERED, EVERY ERROR MARKED ────────────────────────────────────────
{
  const src = readCode(CATCHUP)
  check(!!src.trim(), `(b) ${CATCHUP} is unreadable.`)
  if (src.trim()) {
    const lines = src.split('\n')
    // every attempt-counter increment must register the connection in the ledger within a few lines
    const ATTEMPT_INC = /summary\.(shopify|meta|google|woo|ga)Connections \+= 1/
    let increments = 0
    for (let i = 0; i < lines.length; i++) {
      if (!ATTEMPT_INC.test(lines[i])) continue
      increments += 1
      const window = lines.slice(i, Math.min(lines.length, i + 8)).join('\n')
      check(/connLedger\.begin\(/.test(window),
        `(b) ${CATCHUP}:${i + 1} increments an attempted counter without connLedger.begin() — the connection is counted as attempted but has no outcome, so whatever the tally does with it is a guess.`)
    }
    check(increments === 5, `(b) found ${increments} attempt-counter increments in ${CATCHUP}, expected 5 (one per platform) — a platform section was added or renamed and this check no longer covers it.`)

    // every error push must mark the ledger, or the error is invisible to the per-connection count
    let pushes = 0
    for (let i = 0; i < lines.length; i++) {
      if (!lines[i].includes('summary.errors.push(')) continue
      pushes += 1
      const window = lines.slice(Math.max(0, i - 4), i + 1).join('\n')
      check(/connLedger\.mark\(/.test(window),
        `(b) ${CATCHUP}:${i + 1} pushes an error without connLedger.mark(...,'error') — the connection stays counted as skipped or succeeded while an error was recorded against it.`)
    }
    check(pushes > 0, `(b) no error pushes found in ${CATCHUP} — the check anchored on nothing. (Lesson 60: a green is only as good as what it anchored to.)`)

    // the tally must actually reach cron_runs, and the skip must be one of the fields written
    check(/connectionsSucceeded:\s*tally\.ok\b/.test(src),
      `(a) ${CATCHUP} does not write connectionsSucceeded from the ledger's ok count.`)
    check(/connectionsErrored:\s*tally\.errored\b/.test(src),
      `(c) ${CATCHUP} does not write connectionsErrored from the ledger's per-connection error count.`)
    check(/connectionsSkipped:\s*tally\.skipped\b/.test(src),
      `(b) ${CATCHUP} computes a skip count but never records it. A skip that is not written down is absorbed, which is the ambiguity the denominator law removed on 2026-07-31.`)
  }
}

// ── THE SKIP MUST HAVE SOMEWHERE DURABLE TO GO ──────────────────────────────────────────────────────────
{
  const runs = readCode(RUNS)
  check(/connectionsSkipped\?:\s*number/.test(runs),
    `(b) finishCronRun does not accept connectionsSkipped — the third outcome has nowhere durable to go and collapses back into the other two.`)
  check(/connections_skipped:/.test(runs),
    `(b) finishCronRun accepts a skip count but never writes connections_skipped to cron_runs.`)
  const mig = read('migrations/050_cron_runs_connections_skipped.sql')
  check(/ADD COLUMN IF NOT EXISTS connections_skipped/.test(mig),
    `(b) cron_runs.connections_skipped has no migration — the column the code writes does not exist, and PostgREST rejects the whole UPDATE on an unknown column, which would stop finished_at being stamped.`)
}

rmSync(out, { recursive: true, force: true })
if (findings.length) {
  console.error(`[connection-outcome-honesty] FAIL — ${findings.length} finding(s):`)
  for (const f of findings) console.error(`  · ${f}`)
  process.exit(1)
}
console.log('[connection-outcome-honesty] PASS — success is counted where work completed (never attempted-minus-errors), errors are counted per CONNECTION, a skip is its own recorded state, and ok+errored+skipped partitions attempted by construction.')
