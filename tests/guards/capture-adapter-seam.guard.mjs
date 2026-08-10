#!/usr/bin/env node
// LORAMER_CAPTURE_ADAPTER_CONTRACT_V1 — THE SEAM IS REAL, MECHANICALLY.
//
// ⛔ WHY THIS GUARD IS THE WHOLE POINT OF STEP 0. Copying is how one defect ships four times and gets fixed
// once — but a shared core held together by conditionals is WORSE than four honest engines. The only thing
// that keeps the difference honest over four adapters is a check that the core cannot name a platform, and
// that every per-platform fact is DECLARED rather than assumed. Prose in a file is not a guard (banked law).
//
// ⛔ THE FOUR THINGS THAT ONLY *LOOKED* NEUTRAL, each of which is a leg here:
//   (a) the core naming a platform at all — the conditional-soup failure, caught at the first word
//   (b) an adapter claiming ordered delivery without a MECHANISM — a closure claim that is wrong only
//       sometimes is worse than one that is always wrong
//   (c) a null-floor adapter reaching an exhaustion claim — three of five platforms have NO vendor wall,
//       and inferring one from silence is LORAMER_ZERO_ROWS_IS_NOT_EXHAUSTION_V1 exactly
//   (d) a Google-shaped constant satisfying the meter — five incomparable units, and a bare daily cap is
//       the Google one wearing an interface
import { readFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import Module from 'node:module'

const ROOT = process.env.LORAMER_GUARD_ROOT || process.cwd()
const findings = []
const read = (rel) => {
  try { return readFileSync(resolve(ROOT, rel), 'utf8') }
  catch (e) { findings.push(`UNREADABLE ${rel} — ${e.message}. A guard that cannot read its evidence FAILS.`); return '' }
}

const CONTRACT = 'src/lib/backfill/capture-adapter.ts'
// ⛔ THE CORE. Every file here is claimed to be platform-neutral, so every file here is checked.
// `LORAMER_CORE_FILES` lets the red proof point the leg at a file that is NOT neutral and watch it fail.
const CORE = (process.env.LORAMER_CORE_FILES || [
  CONTRACT,
  'src/lib/backfill/universe-coverage.ts',
  'src/lib/backfill/universe-sizing.ts',
  'src/lib/backfill/universe-stream-capture.ts',
  'src/lib/backfill/universe-attempt-log.ts',
].join(',')).split(',').filter(Boolean)

// ── (a) THE CORE MUST NOT NAME A PLATFORM ────────────────────────────────────────────────────────────
// ⛔ COMMENTS ARE STRIPPED FIRST, DELIBERATELY. A comment EXPLAINING why GA4's cost curve is different is
// the documentation working; the same word in an expression is the assumption leaking back in. (Learned the
// hard way one guard ago, when a check read a migration's prose as code — plan §24.)
const PLATFORM_WORDS = /\b(google|googleads|gaql|shopify|woocommerce|ga4|facebook|meta_)\b|segments\./i
const stripComments = (src) => src
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n').filter((l) => !/^\s*(\/\/|\*)/.test(l)).join('\n')

for (const f of CORE) {
  const src = read(f); if (!src) continue
  const code = stripComments(src)
  code.split('\n').forEach((line, i) => {
    // an import PATH may name the adapter directory; an import of an adapter MODULE may not (checked below)
    const bare = line.replace(/from\s+'[^']*'/g, '')
    const m = PLATFORM_WORDS.exec(bare)
    if (m) {
      findings.push(`(a) ${f}:${i + 1} names a platform in CODE — "${m[0]}" in \`${line.trim().slice(0, 100)}\`. THE CORE MUST NOT KNOW WHICH VENDOR IT IS SERVING. A per-platform fact belongs in the adapter as DATA, or as a DECLARED CAPABILITY the core dispatches on — never as a name here.`)
    }
  })
  if (/from\s+'@\/lib\/backfill\/capture-adapters\//.test(code)) {
    findings.push(`(a) ${f} imports a concrete ADAPTER. The dependency runs adapter → core, never core → adapter; the reverse edge is how "one core" becomes four cores in a trench coat.`)
  }
}

// ── (b) ORDERED-DELIVERY ENTITLEMENT MUST BE DECLARED, WITH A MECHANISM ──────────────────────────────
// ── (c) A NULL FLOOR MUST BE STRUCTURALLY UNABLE TO REACH AN EXHAUSTION CLAIM ────────────────────────
// ── (d) THE METER CANNOT BE SATISFIED BY A GOOGLE-SHAPED CONSTANT ────────────────────────────────────
const out = mkdtempSync(join(tmpdir(), 'loramer-seam-guard-'))
const origResolve = Module._resolveFilename
try {
  const tsc = join(ROOT, 'node_modules', '.bin', 'tsc')
  const r = spawnSync(tsc, [resolve(ROOT, CONTRACT), '--target', 'es2020', '--module', 'commonjs',
    '--moduleResolution', 'node', '--skipLibCheck', '--noResolve', '--rootDir', resolve(ROOT), '--outDir', out], { encoding: 'utf8' })
  if (r.error) findings.push(`could not run tsc — ${r.error.message}`)
  const stub = join(out, '__stub.js')
  writeFileSync(stub, `module.exports = new Proxy({}, { get: () => (() => {}) })`)
  Module._resolveFilename = function (request, ...rest) {
    if (request.startsWith('@/') || request.startsWith('./') || request.startsWith('../')) return stub
    return origResolve.call(this, request, ...rest)
  }
  const core = createRequire(import.meta.url)(join(out, 'src/lib/backfill/capture-adapter.js'))

  // (b) ── entitlement
  const entitled = { dayClosure: { rule: 'later-day-closes', mechanism: 'ORDER BY x, verified at runtime', runtimeChecked: true } }
  const claimsWithout = { dayClosure: { rule: 'later-day-closes', mechanism: '   ', runtimeChecked: false } }
  const fallback = { dayClosure: { rule: 'explicit-commit-only', why: 'opaque cursor, no ordering guarantee' } }
  if (core.mayInferClosureFromOrder(entitled) !== true) findings.push(`(b) an adapter declaring later-day-closes WITH a mechanism was refused the entitlement.`)
  if (core.mayInferClosureFromOrder(claimsWithout) !== false) {
    findings.push(`(b) an adapter CLAIMED later-day-closes with an EMPTY mechanism and was granted it. "The vendor sorts" is not a mechanism; a closure claim that is wrong only sometimes is worse than one that is always wrong.`)
  }
  if (core.mayInferClosureFromOrder(fallback) !== false) findings.push(`(b) an explicit-commit-only adapter was granted the ordering entitlement.`)

  // (c) ── null floor cannot reach exhaustion
  const NO_WALL = { floorDate: null, source: 'none', citation: 'GA4 Data API is not bound by the retention setting; Shopify and WooCommerce are the merchant’s own database' }
  const WALL = { floorDate: '2022-03-05', source: 'vendor-documented', citation: '37 months' }
  const nullDeep = core.decideExhaustion({ windowStart: '1990-01-01', rowsReturned: 0, floor: NO_WALL, asked: 'x' })
  if (nullDeep.complete !== false || nullDeep.exhaustedBelow !== null) {
    findings.push(`(c) a NULL-FLOOR adapter reached an exhaustion claim on zero rows (${JSON.stringify(nullDeep)}). THREE OF FIVE PLATFORMS HAVE NO VENDOR WALL — inferring one from silence is LORAMER_ZERO_ROWS_IS_NOT_EXHAUSTION_V1 exactly, and it is what produced 214 false completions.`)
  }
  if (!/NOT claimable|NOT CLAIMABLE/i.test(nullDeep.proof || '')) findings.push(`(c) the null-floor verdict does not SAY that exhaustion is unclaimable — a reader would take it for ordinary dormancy.`)
  const above = core.decideExhaustion({ windowStart: '2025-01-01', rowsReturned: 0, floor: WALL, asked: 'x' })
  if (above.complete !== false) findings.push(`(c) zero rows ABOVE the floor was read as exhaustion rather than dormancy.`)
  const atFloor = core.decideExhaustion({ windowStart: '2022-03-05', rowsReturned: 0, floor: WALL, asked: 'x' })
  if (atFloor.complete !== true || atFloor.exhaustedBelow !== '2022-03-05') findings.push(`(c) zero rows AT the documented floor did not complete — the walk would never end.`)
  const yielding = core.decideExhaustion({ windowStart: '1990-01-01', rowsReturned: 7, floor: WALL, asked: 'x' })
  if (yielding.complete !== false) findings.push(`(c) ROWS-RETURNED DID NOT BEAT THE FLOOR. A walk still yielding must never be truncated by an over-tight floor.`)

  // (d) ── the meter cannot be a bare constant, and an unreadable meter HOLDS
  const bareConstant = { platform: 'x', meter: { cap: 15000, spentSoFar: async () => 0 } }
  let threw = false
  try { await core.mayFetch(bareConstant, 30) } catch { threw = true }
  if (!threw) {
    findings.push(`(d) a meter with only a CAP and a SPEND satisfied mayFetch(). That is the GOOGLE unit wearing an interface — no \`unit\`, no \`costOf(days)\`, no \`costDirection\`. GA4 charges variable TOKENS that rise with range length; Meta charges a BUC PERCENTAGE per ad account across three simultaneous meters; Shopify does not charge bulk execution at all. A shape that cannot express those is not a meter.`)
  }
  const unreadable = { platform: 'x', meter: { unit: 't', cap: 10, costDirection: 'flat-per-request', costOf: () => 1, spentSoFar: async () => null } }
  const held = await core.mayFetch(unreadable, 7)
  if (held.ok !== false || !/HOLD/i.test(held.reason)) {
    findings.push(`(d) an UNREADABLE meter did not HOLD (${JSON.stringify(held)}). Reading null as zero spend is a governor granting itself unlimited quota because its own gauge broke.`)
  }
  const ok = { platform: 'x', meter: { unit: 't', cap: 10, costDirection: 'flat-per-request', costOf: () => 1, spentSoFar: async () => 5 } }
  if ((await core.mayFetch(ok, 7)).ok !== true) findings.push(`(d) a readable meter with headroom refused.`)
  const full = { ...ok, meter: { ...ok.meter, spentSoFar: async () => 10 } }
  if ((await core.mayFetch(full, 7)).ok !== false) findings.push(`(d) a meter AT its cap granted permission.`)

  // (d2) ── SIZING DIRECTION IS OBEYED, and this is the GA4 defect caught before GA4 exists
  const policy = { rowBudget: 300_000, coldStartDays: 7, minDays: 1, maxDays: 30 }
  const flat = core.sizeFromPolicy(policy, 'flat-per-request', [1000, 500], [30000, 15000])
  const rises = core.sizeFromPolicy(policy, 'rises-with-range', [1000, 500], [30000, 15000])
  if (!(flat.days > policy.coldStartDays)) findings.push(`(d2) under flat-per-request the sizer did not size UP (got ${flat.days}d) — a bigger window is CHEAPER per day there.`)
  if (rises.days !== policy.coldStartDays) {
    findings.push(`(d2) under rises-with-range the sizer sized to ${rises.days}d instead of holding at the cold-start ${policy.coldStartDays}d. ON GA4 COST RISES WITH DATE-RANGE LENGTH, so "size up to the row budget" is ACTIVELY WRONG — and refusing to guess is the correct behaviour, not a limitation.`)
  }
  const cold = core.sizeFromPolicy(policy, 'flat-per-request', [], [])
  if (cold.basis !== 'cold-start-no-history') findings.push(`(d2) no history did not fall back to cold start.`)
  const intermittent = core.sizeFromPolicy(policy, 'flat-per-request', [0, 0, 0, 500], [0, 0, 0, 15000])
  if (intermittent.basis !== 'intermittent-fixed') {
    findings.push(`(d2) a series that was ZERO in 3 of 4 windows was modelled rather than fixed. The median of an intermittent series is zero by construction — that is a different failure from inaccuracy, and reading it as inaccuracy is how it gets a wrong fix.`)
  }
  // (d3) ── INTERMITTENT WIDENS UNDER FLAT COST — LORAMER_INTERMITTENT_WIDENS_UNDER_FLAT_COST_V1.
  // Empty ground is where the window must be WIDEST when a request costs the same at any span. The pin to
  // coldStartDays priced BusyBee's measured 2,267-day dormancy at 4.3× (≈324 seven-day windows against ≈76
  // thirty-day ones). Under rises-with-range the pin stays CORRECT — widening there costs more by construction.
  if (intermittent.days !== policy.maxDays) {
    findings.push(`(d3) an intermittent series under FLAT-PER-REQUEST cost sized to ${intermittent.days}d instead of maxDays (${policy.maxDays}d). ` +
      `Empty ground gets the widest window: one request costs the same at any span, and the pin priced a real 2,267-day dormancy crossing at 4.3×.`)
  }
  const intermittentRises = core.sizeFromPolicy(policy, 'rises-with-range', [0, 0, 0, 500], [0, 0, 0, 15000])
  if (intermittentRises.days !== policy.coldStartDays) {
    findings.push(`(d3) an intermittent series under RISES-WITH-RANGE cost sized to ${intermittentRises.days}d instead of the cold-start ${policy.coldStartDays}d. ` +
      `Widening is only cheap under flat cost; on GA4 it is actively wrong, and the widen must not leak across the direction.`)
  }
} catch (e) {
  findings.push(`(b)(c)(d) behavioural legs could not run — ${e.message}. A guard that cannot execute its subject FAILS; it does not pass quietly.`)
} finally {
  Module._resolveFilename = origResolve
  rmSync(out, { recursive: true, force: true })
}

// ── (e) THE ADAPTER DECLARES EVERY PER-PLATFORM FACT, AND THE GUARD NAMES WHICH ───────────────────────
{
  const g = read('src/lib/backfill/capture-adapters/google-ads.adapter.ts')
  if (g) {
    for (const [field, why] of [
      ['retention', 'the floor is adapter data and is NULL for three of five platforms'],
      ['dayClosure', 'ordering entitlement is a declaration, never an assumption'],
      ['meter', 'five incomparable units'],
      ['sizing', 'rowBudget and coldStartDays are ours AND the cost curve’s, not universal'],
      ['fetchShape', 'stream is the degenerate one-phase case of the job shape'],
      ['platform', 'the metrics_daily platform and the attempt log vendor'],
    ]) {
      if (!new RegExp(`\\b${field}\\b`).test(g)) findings.push(`(e) the Google adapter declares no \`${field}\` — ${why}.`)
    }
    if (!/ORDER BY segments\.date/.test(g)) findings.push(`(e) the Google adapter does not hold its own ORDER BY clause — it is GAQL syntax and belongs nowhere else.`)
  }
}

if (findings.length) {
  console.error(`[capture-adapter-seam] FAIL — ${findings.length} finding(s):`)
  for (const f of findings) console.error(`  - ${f}`)
  process.exit(1)
}
console.log(`[capture-adapter-seam] PASS — ${CORE.length} core file(s) name no platform in code and import no concrete adapter · an ordered-delivery entitlement requires a stated mechanism · a null-floor adapter is structurally unable to claim exhaustion and rows-returned always beats the floor · the meter refuses a bare cap-and-spend constant and HOLDS when unreadable · and the sizer obeys the adapter's cost direction instead of always sizing up.`)
