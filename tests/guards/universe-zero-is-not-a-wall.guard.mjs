#!/usr/bin/env node
// LORAMER_UNIVERSE_DISCOVERED_FLOOR_V1 — A SUCCESSFUL ZERO IS DORMANCY. ONLY A REFUSAL IS A WALL.
//
// ⛔ THE TWO ANSWERS THAT LOOK IDENTICAL DOWNSTREAM AND MEAN OPPOSITE THINGS:
//   · the vendor was ASKED and NAMED NOTHING  → DORMANCY. The account ran no ads that month. KEEP WALKING.
//   · the vendor was ASKED and SAID NO        → WALL. `DateRangeError`. History ends here. STOP.
// Collapsing them in the DORMANT→WALL direction seals real history permanently and silently: nothing
// downstream ever asks again, and no report can tell the gap from a genuine absence of spend.
// `LORAMER_ZERO_ROWS_IS_NOT_EXHAUSTION_V1` is that rule; 214 cursors read `backfill_complete=true` over
// live data because a CLOCK was allowed to answer this question.
//
// ⛔ AND THE HALF THAT NEVER EXISTED, WHICH IS WHY THIS GUARD IS NEW: `decideExhaustion`
// (capture-adapter.ts:234) takes `rowsReturned: number` and **cannot represent a refusal at all** — the
// capture path returns early on an error (universe-stream-capture.ts:155-160), so it has structurally never
// seen one. The WALL signal had no path into the engine. `isRetentionWallRefusal` is that path, and this
// guard is what stops it from being widened into "any error ends the walk".
import { readFileSync, mkdtempSync, writeFileSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import Module from 'node:module'

const ROOT = process.env.LORAMER_GUARD_ROOT || process.cwd()
const findings = []
const ADAPTER = 'src/lib/backfill/capture-adapters/google-ads.adapter.ts'
const CONSUMER = 'src/lib/backfill/universe-v2-worker.ts'
let droveNotWalls = 0, droveWalls = 0

// ── (a) BEHAVIOURAL — DRIVE THE DISCRIMINATOR WITH BOTH POLES AND THE NEAR-MISSES ────────────────────
const out = mkdtempSync(join(tmpdir(), 'loramer-wall-guard-'))
const origResolve = Module._resolveFilename
try {
  const tsc = join(ROOT, 'node_modules', '.bin', 'tsc')
  const r = spawnSync(tsc, [resolve(ROOT, ADAPTER), '--target', 'es2020', '--module', 'commonjs',
    '--moduleResolution', 'node', '--skipLibCheck', '--noResolve', '--rootDir', resolve(ROOT), '--outDir', out], { encoding: 'utf8' })
  if (r.error) findings.push(`could not run tsc — ${r.error.message}`)
  const stub = join(out, '__stub.js')
  writeFileSync(stub, `module.exports = new Proxy({}, { get: () => (() => {}) })`)
  Module._resolveFilename = function (request, ...rest) {
    if (request.startsWith('@/') || request.startsWith('./') || request.startsWith('../')) return stub
    return origResolve.call(this, request, ...rest)
  }
  const mod = createRequire(import.meta.url)(join(out, 'src/lib/backfill/capture-adapters/google-ads.adapter.js'))
  const isWall = mod.isRetentionWallRefusal
  if (typeof isWall !== 'function') {
    findings.push(`(a) the adapter exports no isRetentionWallRefusal(). Without it the engine has no way to tell a refusal from a zero.`)
  } else {
    // ⛔ MUST BE FALSE — every one of these is either a SUCCESS or a TRANSIENT failure. If any reads as a
    // wall, that surface is sealed for this account permanently on a bad afternoon.
    const NOT_WALLS = [
      [null, 'no error at all — the ordinary successful path'],
      [undefined, 'no error at all'],
      ['', 'empty error string'],
      ['vendor returned 0 rows for [2019-03-01] — dormancy, the walk continues', 'A SUCCESSFUL ZERO. THE CENTRAL CASE.'],
      ['{"quota_error":"RESOURCE_EXHAUSTED"} Quota exceeded', 'a QUOTA refusal — retry tomorrow, do not seal history'],
      ['{"authentication_error":"OAUTH_TOKEN_EXPIRED"} token expired', 'an AUTH failure — fix the token, do not seal history'],
      ['DEADLINE_EXCEEDED', 'a TIMEOUT — ask again, do not seal history'],
      ['{"query_error":"UNRECOGNIZED_FIELD"} bad field', 'OUR bug, not a vendor wall'],
      ['request failed: INVALID_DATE was not the problem here', 'the enum NAME in free text with no date_range_error key'],
      // ⛔ THE gRPC STATUS CODES, ADDED 2026-08-10 FROM EXTERNAL ADVERSARIAL REVIEW. Two reviewers
      // independently named `GoogleAdsFailure ⇒ WALL` as too broad. The function was already narrow; these
      // cases are the PROOF of that, so the claim rests on a driven check rather than on reading the regex.
      ['RESOURCE_EXHAUSTED', 'the bare gRPC status — rate limited, not a wall'],
      ['UNAVAILABLE', 'the bare gRPC status — the service is down, not a wall'],
      ['INTERNAL', 'the bare gRPC status — a vendor-side fault, not a wall'],
      ['UNKNOWN', 'the bare gRPC status — unclassified, and unclassified must never seal history'],
      ['ABORTED', 'the bare gRPC status — a transient conflict, not a wall'],
      ['INVALID_ARGUMENT', 'the bare gRPC status — very likely OUR malformed query, not a wall'],
      ['FAILED_PRECONDITION', 'the bare gRPC status — account state, not a retention boundary'],
      ['{"authorization_error":"USER_PERMISSION_DENIED"} no access', 'a PERMISSION failure — access, not history'],
    ]
    // ⛔ COUNTED, NOT TYPED. The PASS line quoted "9 non-walls" for one commit after the list grew to 17 —
    // a guard whose own summary is stale is the same defect class it exists to hunt.
    droveNotWalls = NOT_WALLS.length
    for (const [input, why] of NOT_WALLS) {
      if (isWall(input) === true) {
        findings.push(`(a) isRetentionWallRefusal(${JSON.stringify(input)}) === true — but this is ${why}. ` +
          `A wall claim here seals this surface for this account and nothing ever asks again.`)
      }
    }
    // ⛔ MUST BE TRUE — the vendor's own date-range refusals, both the current and the v24+ enum.
    const WALLS = [
      ['{"date_range_error":"INVALID_DATE"} Date is not valid.', 'the error Google returns today, per its 2026-05-01 announcement'],
      ['{"date_range_error":"REQUESTED_DATE_GRANULARITY_NOT_SUPPORTED"} granularity not supported', 'the v24+ error per developers.google.com/google-ads/api/docs/reporting/segmentation'],
    ]
    droveWalls = WALLS.length
    for (const [input, why] of WALLS) {
      if (isWall(input) !== true) {
        findings.push(`(a) isRetentionWallRefusal(${JSON.stringify(input)}) !== true — this IS ${why}. ` +
          `Missing the wall means the walk re-asks a refused range forever, paying an operation each time (a rejected request still counts against quota).`)
      }
    }
  }

  // ── (b) BEHAVIOURAL — THE GOOGLE ADAPTER'S FLOOR MUST MAKE A ZERO STRUCTURALLY UNABLE TO COMPLETE ──
  const adapter = mod.googleAdsCaptureAdapter(() => (async function* () {})(), () => ({ resource: 'x', segment: null }))
  if (adapter?.retention?.floorDate !== null) {
    findings.push(`(b) the Google adapter declares a non-null retention floor (${JSON.stringify(adapter?.retention?.floorDate)}). ` +
      `With a non-null floor, decideExhaustion COMPLETES on zero rows at or below it — i.e. a SUCCESSFUL ZERO becomes a wall, ` +
      `which is exactly what this guard forbids and exactly what a clock-derived floor does.`)
  }
} catch (e) {
  findings.push(`(a) could not DRIVE the discriminator — ${e.message}. A guard that cannot run its subject FAILS rather than passing.`)
} finally {
  Module._resolveFilename = origResolve
}

// ── (c) STRUCTURAL — THE WALL WRITER MAY NOT BE REACHED FROM A ROW COUNT ─────────────────────────────
// ⛔ The behavioural legs prove the DISCRIMINATOR is right. This proves the CALLER feeds it the right thing:
// a wall is recorded from an ERROR string, never from `apiRows === 0`, `observedZero`, or `rowsWritten === 0`.
{
  let code = ''
  try { code = readFileSync(resolve(ROOT, CONSUMER), 'utf8') }
  catch (e) { findings.push(`(c) UNREADABLE ${CONSUMER} — ${e.message}.`) }
  const stripped = code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1')
  if (stripped) {
    if (!/noteWall\s*\([^)]*,\s*(res\.error|lastError)\s*\)/.test(stripped)) {
      findings.push(`(c) ${CONSUMER} does not feed the wall discriminator from an ERROR (res.error / lastError). ` +
        `The wall signal is the vendor's refusal string and nothing else.`)
    }
    for (const [re, what] of [
      [/isRetentionWallRefusal\s*\(\s*[^)]*apiRows/, '`apiRows` — a ROW COUNT'],
      [/isRetentionWallRefusal\s*\(\s*[^)]*observedZero/, '`observedZero` — a SUCCESSFUL ZERO'],
      [/isRetentionWallRefusal\s*\(\s*[^)]*rowsWritten/, '`rowsWritten` — a ROW COUNT'],
    ]) {
      if (re.test(stripped)) {
        findings.push(`(c) ${CONSUMER} passes ${what} to the wall discriminator. A zero is DORMANCY. Only a refusal is a wall.`)
      }
    }
    if (/if\s*\([^)]*apiRows\s*===\s*0[^)]*\)[\s\S]{0,200}?recordAccountWall/.test(stripped)) {
      findings.push(`(c) ${CONSUMER} records a WALL inside an \`apiRows === 0\` branch. That is a successful zero being written ` +
        `to the floor store — the exact DORMANT→WALL collapse this guard exists to prevent.`)
    }
  }
}

if (findings.length) {
  console.error(`[universe-zero-is-not-a-wall] FAIL — ${findings.length} finding(s):`)
  for (const f of findings) console.error(`  - ${f}`)
  process.exit(1)
}
console.log(`[universe-zero-is-not-a-wall] PASS — the discriminator was DRIVEN: ${droveNotWalls} non-walls all read false (a successful zero, quota, auth, permission, timeout, our own query bug, the enum name in bare free text, and the bare gRPC statuses RESOURCE_EXHAUSTED / UNAVAILABLE / INTERNAL / UNKNOWN / ABORTED / INVALID_ARGUMENT / FAILED_PRECONDITION) and ${droveWalls} of Google's date-range refusal enums read true · the Google adapter's null floor leaves decideExhaustion structurally unable to complete on a zero · and the v2 consumer feeds the discriminator an ERROR string, never a row count.`)
