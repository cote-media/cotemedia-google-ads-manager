#!/usr/bin/env node
// LORAMER_V2_QUOTA_SENTINEL_WIRED_V1 — THE WALK MAY NOT REACH A VENDOR CALL WITHOUT PASSING THE SENTINEL,
// AND THE ONE PLACE IT TOUCHES THE VENDOR MUST ARM IT.
//
// ⛔ THE DEFECT THIS CLOSES, MEASURED 2026-08-09 (★WALK-DOES-NOT-READ-OR-ARM-THE-QUOTA-SENTINEL, sweep C2).
// `universe-vendor-stream.ts:39` called `customer.queryStream(gaql)` with no retry wrapper and no
// `noteGoogleQuotaError`, and a grep for `holdGoogleWork` / `readGoogleQuotaPause` across every `universe-*`,
// `capture-adapter*`, `capture-adapters/` and both v2 routes returned ONE hit — a COMMENT at
// `universe-governor.ts:6`. The consequence ran both ways: an armed sentinel stopped forward, drain and
// catchup and did NOT stop the walk; a quota refusal the walk observed armed nothing for anyone else.
//
// ⛔ THE ADAPTER METER IS NOT A SUBSTITUTE AND THE GUARD EXISTS PARTLY TO SAY SO. The meter
// (`google-ads.adapter.ts` `spentSoFar`) sums OUR OWN LEDGERS — it is our accounting. The sentinel records THE
// VENDOR'S REFUSAL. They are two different facts and neither can stand in for the other: our count can be
// perfect while Google is refusing, and Google can be serving while our count is broken.
//
// ⛔ WHY THE ARM LIVES IN THE VENDOR MODULE AND NOT IN THE CORE. `universe-stream-capture.ts` is
// platform-neutral by contract and `capture-adapter-seam.guard.mjs` fails the build if the core names a
// platform. The error also arrives from the ASYNC ITERATOR, not from the call — verified against the vendor
// library, whose `handleStreamError` converts a streamed error object into a GoogleAdsFailure and rejects — so
// the boundary must wrap CONSUMPTION, which is exactly what the vendor stream module does.
//
// ⛔ WHAT IT CANNOT DO: it cannot prove the sentinel is armed at RUNTIME (that needs a live quota refusal), and
// it cannot prove the read is placed before every future vendor call — it proves the read exists, is the
// SHARED predicate, and precedes the walk loop in source order. Same honest limit as
// quota-sentinel-armed.guard.mjs, which owns the fleet-wide version of this check.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const ROOT = process.env.LORAMER_GUARD_ROOT || process.cwd()
const findings = []
const read = (p) => { try { return readFileSync(resolve(ROOT, p), 'utf8') } catch { return null } }
// QUOTATION IS NOT ASSERTION — every check runs against comment-stripped source, the same rule
// quota-sentinel-armed.guard.mjs learned the hard way.
const strip = (s) => s.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n')

const CONSUMER = 'src/app/api/queues/google-ads-universe-v2/route.ts'
const RESUMER = 'src/app/api/cron/universe-resume/route.ts'
const VENDOR = 'src/lib/backfill/universe-vendor-stream.ts'

// ── (a) + (b) BOTH v2 ENTRY POINTS READ THE SENTINEL, WITH THE SHARED PREDICATE ───────────────────────────
// ⛔ `holdGoogleWork`, NEVER `.paused` — LORAMER_QUOTA_READ_SPLIT_STATE_V1. A failed sentinel read returns
// paused:false with state:'unknown', so a lane that tests `.paused` spends the fleet's quota against a pause
// it could not see. That is not a style preference; it is the 2026-07-28 incident.
for (const [file, what] of [[CONSUMER, 'the v2 consumer, which walks owed ranges against the vendor'],
                            [RESUMER, 'the resumer, which publishes work that becomes vendor calls']]) {
  const raw = read(file)
  if (raw === null) { findings.push(`${file} is MISSING — the v2 path cannot be checked.`); continue }
  const src = strip(raw)
  if (!/import\s*\{[^}]*\breadGoogleQuotaPause\b[^}]*\}\s*from\s*['"][^'"]*google-quota-store['"]/s.test(src)) {
    findings.push(`${file} DOES NOT IMPORT readGoogleQuotaPause — ${what}. cron/drain/route.ts:122-123 has gated on it since the quota guard shipped; the walk is the one Google lane that never did.`)
  }
  if (!/\bholdGoogleWork\s*\(/.test(src)) {
    findings.push(`${file} NEVER CALLS holdGoogleWork(...) — ${what}. Import the SHARED predicate from google-quota-store; do not test \`.paused\` and do not re-derive it (LORAMER_QUOTA_READ_SPLIT_STATE_V1: an UNREADABLE sentinel must HOLD, and \`.paused\` is false when the read failed).`)
  }
}

// ── (c) THE READ PRECEDES THE WALK LOOP IN THE CONSUMER ───────────────────────────────────────────────────
{
  const raw = read(CONSUMER)
  if (raw !== null) {
    const src = strip(raw)
    const hold = src.indexOf('holdGoogleWork')
    const loop = src.search(/for\s*\(\s*const\s+range\s+of\s+owed\.ranges/)
    if (hold !== -1 && loop !== -1 && hold > loop) {
      findings.push(`${CONSUMER}: the sentinel check appears AFTER the owed-range loop. A gate downstream of the spend is not a gate. drain/route.ts checks BEFORE its connection query "so a paused fire does zero outbound Google work" — same ordering here.`)
    }
    if (hold !== -1 && loop === -1) {
      findings.push(`${CONSUMER}: the owed-range loop shape changed (\`for (const range of owed.ranges\` not found), so this guard can no longer prove the gate precedes the spend. Re-point the check rather than deleting it.`)
    }
  }
}

// ── (d) THE VENDOR MODULE ARMS ────────────────────────────────────────────────────────────────────────────
{
  const raw = read(VENDOR)
  if (raw === null) {
    findings.push(`${VENDOR} is MISSING — the walk's only vendor boundary cannot be checked.`)
  } else {
    const src = strip(raw)
    if (!/import[^\n]*\bnoteGoogleQuotaError\b/.test(src)) {
      findings.push(`${VENDOR} DOES NOT IMPORT noteGoogleQuotaError — this is the FIFTH Google error boundary and the only one that never armed. google-quota-store.ts's own header names four and says a fifth "is NOT caught"; this is that fifth.`)
    }
    if (!/\bnoteGoogleQuotaError\s*\(/.test(src)) {
      findings.push(`${VENDOR} NEVER CALLS noteGoogleQuotaError(...). A quota refusal observed here must teach the whole fleet, or the walk is the one lane that can burn the developer-scope token silently.`)
    }
    // The error arrives from the ITERATOR, not the call — so the arm must wrap consumption.
    if (/\bnoteGoogleQuotaError\s*\(/.test(src) && !/catch\s*\(/.test(src)) {
      findings.push(`${VENDOR} calls noteGoogleQuotaError but has NO catch block. The vendor library rejects from the async iterator (its handleStreamError converts the streamed error to a GoogleAdsFailure), so an arm that is not inside a catch around CONSUMPTION never runs.`)
    }
  }
}

// ── (e) NOTHING ELSE IN THE v2 PATH TOUCHES THE VENDOR DIRECTLY ───────────────────────────────────────────
// One boundary is checkable; two is a boundary and a hole.
for (const file of [CONSUMER, RESUMER, 'src/lib/backfill/universe-stream-capture.ts',
                    'src/lib/backfill/capture-adapters/google-ads.adapter.ts']) {
  const raw = read(file)
  if (raw === null) continue
  if (/\.queryStream\s*\(|\bcustomer\.query\s*\(/.test(strip(raw))) {
    findings.push(`${file} CALLS THE VENDOR DIRECTLY. The walk has exactly ONE vendor boundary (${VENDOR}) and that is what makes arming checkable at all — a second call site is a second place to forget.`)
  }
}

if (findings.length) {
  console.error(`\n❌ LORAMER_V2_QUOTA_SENTINEL_WIRED_V1 FAILED — ${findings.length} finding(s)\n`)
  findings.forEach((f) => console.error('  • ' + f + '\n'))
  console.error('  ⛔ THE METER IS OUR ACCOUNTING. THE SENTINEL IS THE VENDOR\'S REFUSAL. Neither substitutes for')
  console.error('     the other, and the walk needs both.\n')
  process.exit(1)
}
console.log(
  'v2-quota-sentinel-wired.guard: PASS — both v2 entry points read the sentinel through the SHARED holdGoogleWork ' +
  'predicate before any vendor work, the single vendor boundary arms it inside a catch around consumption, and no ' +
  'other v2 file touches the vendor. LIMIT: wiring only — a runtime arm needs a live quota refusal.'
)
