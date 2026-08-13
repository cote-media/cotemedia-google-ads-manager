#!/usr/bin/env node
// LORAMER_UNIVERSE_DISCOVERED_FLOOR_V1 — A GLOBAL DATE MAY NOT BE AN ACCOUNT FLOOR ON THE GOOGLE v2 PATH.
//
// ⛔ THE DEFECT THIS EXISTS TO MAKE UNSHIPPABLE, and it is the FIFTH of its shape in this project:
// `VENDOR_FLOOR_DATE = '2022-03-05'` was ONE ACCOUNT'S measured floor (Foam OH, 2026-08-03) declared as a
// global constant and applied to every account. For an account a customer connects tomorrow — which nobody
// here has ever seen, and which is the only kind of account this engine is actually for — that date is not
// conservative and it is not approximate. It is a fabricated claim about someone else's history.
//
// ⛔ AND THE COST IS ASYMMETRIC, WHICH IS WHY IT IS A BUILD FAILURE AND NOT A LINT. Too-shallow: the walk
// stops early and history is sealed SILENTLY and PERMANENTLY — nothing downstream ever asks again. Too-deep:
// we spend one request learning the vendor says no. One of those is recoverable.
//
// ⛔ WHAT IT DOES NOT CHECK, STATED SO A GREEN RUN IS NOT OVER-READ: the v1 consumer
// (`src/app/api/queues/google-ads-universe/route.ts`) and `src/app/api/cron/universe-resume/route.ts` STILL
// import VENDOR_FLOOR_DATE and are NOT covered here. They were outside the 2026-08-10 flight's ceiling.
// QUEUE: ★V1-CONSUMER-STILL-ON-A-GLOBAL-FLOOR. This guard binds the v2 path only, and says so.
import { readFileSync, mkdtempSync, writeFileSync } from 'node:fs'
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

const ADAPTER = 'src/lib/backfill/capture-adapters/google-ads.adapter.ts'
const CONSUMER = 'src/app/api/queues/google-ads-universe-v2/route.ts'

// ── (a) BEHAVIOURAL — THE ADAPTER MUST DECLARE NO PRE-KNOWN WALL ─────────────────────────────────────
// Driven, not grepped: the adapter is CONSTRUCTED and its declared retention floor is read. A structural
// check would pass on a constant that is computed at runtime from a clock, which is the same defect wearing
// arithmetic.
const out = mkdtempSync(join(tmpdir(), 'loramer-floor-guard-'))
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
  const adapter = mod.googleAdsCaptureAdapter(() => (async function* () {})(), () => ({ resource: 'x', segment: null }))
  const floor = adapter?.retention?.floorDate
  if (floor !== null) {
    findings.push(`(a) the Google adapter declares retention.floorDate = ${JSON.stringify(floor)}. IT MUST BE null. ` +
      `There is no PRE-KNOWN wall for an arbitrary account: Google publishes a 37-month policy AND was measured serving daily ` +
      `vendor-reported rows 53 months back on 2026-08-04..08. A non-null floor here re-arms the constant that sealed 214 cursors.`)
  }
  if (adapter?.retention?.source !== 'none') {
    findings.push(`(a) the Google adapter's retention.source is ${JSON.stringify(adapter?.retention?.source)}, not 'none'. ` +
      `A null floor with a 'vendor-measured' provenance is a contradiction a reader will resolve in the wrong direction.`)
  }
} catch (e) {
  findings.push(`(a) could not DRIVE the adapter — ${e.message}. A guard that cannot run its subject FAILS rather than passing.`)
} finally {
  Module._resolveFilename = origResolve
}

// ── (b) STRUCTURAL — NO ISO DATE LITERAL MAY APPEAR IN CODE ON THE FLOOR-DECIDING PATH ───────────────
// ⛔ COMMENTS AND CITATIONS ARE STRIPPED FIRST. The whole point of the adapter's citation is to QUOTE the
// vendor's dates and our own measurement dates; a guard that forbade that would make the provenance
// unwritable, and an unwritable rule gets deleted (the 2026-07-29 quotation-is-not-assertion finding).
const stripped = (src) => src
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:])\/\/[^\n]*/g, '$1')
for (const rel of [ADAPTER, CONSUMER]) {
  const code = stripped(read(rel))
  const hits = code.match(/'\d{4}-\d{2}-\d{2}'|"\d{4}-\d{2}-\d{2}"/g)
  if (hits && hits.length) {
    findings.push(`(b) ${rel} contains ISO date literal(s) IN CODE: ${[...new Set(hits)].join(', ')}. ` +
      `On the floor-deciding path a hardcoded date is an account floor whatever it is named. The floor is DISCOVERED ` +
      `from the vendor's refusal and stored per (account, surface); it is never typed into a file.`)
  }
}

// ── (c) STRUCTURAL — THE v2 CONSUMER MAY NOT IMPORT THE LEGACY GLOBAL AT ALL ─────────────────────────
{
  const code = read(CONSUMER)
  if (/\bVENDOR_FLOOR_DATE\b/.test(stripped(code))) {
    findings.push(`(c) ${CONSUMER} references VENDOR_FLOOR_DATE in code. That constant survives ONLY for the v1 consumer. ` +
      `The v2 path resolves a DISCOVERED floor per (account, surface); reaching for the global re-introduces the defect this replaced.`)
  }
  // ⛔ MOVED 2026-08-13 WITH THE CALL SITE (LORAMER_WALK_STOP_ONE_RESOLVER_V1), SEEN RED FIRST. The consumer
  // now resolves through `resolveWalkStop`, which performs the wall read and the composition, so the RESUMER
  // could compose the SAME stop without a second `composeWalkStop(` site. The assertion this leg makes is
  // unchanged — SOMETHING must resolve the floor from the discovered per-(account,surface) wall, and if it
  // is not that, it is a constant. Only a NAMED alternative is admitted; the resolver's own body is asserted
  // by `universe-floor-execute-time` leg (b), so a resolver that stopped reading the wall still goes red.
  if (!/readAccountWall\s*\(/.test(code) && !/resolveWalkStop\s*\(/.test(code)) {
    findings.push(`(c) ${CONSUMER} calls neither readAccountWall() nor resolveWalkStop(). Something must resolve the floor, ` +
      `and if it is not the discovered per-account wall it is a constant — there is no third option.`)
  }
}

// ── (d) NO REACH-FAMILY METRIC MAY ENTER A QUERY — LORAMER_REACH_FAMILY_UNREACHABLE_V1 ───────────────
// ⛔ WHY THIS LIVES IN THE FLOOR GUARD: reach/frequency metrics retire at 3 YEARS while granular stats run
// 37 months (support.google.com/google-ads/answer/15188209), and Google's DateRangeError does NOT say which
// boundary was hit. A reach-metric refusal at 3y recorded into universe_account_floor would seal a surface
// 13 months early for every non-reach query on it — FOREVER, because GREATEST() never lowers a wall.
// Migration 062 deliberately has NO metric-family column, and this leg is what makes that omission safe:
// it proves NO query the walk can construct selects a reach metric. Verified 2026-08-10: the ENTIRE metric
// universe across all three inputs is five performance counters. The catalog is REGENERABLE data — a future
// regeneration that admits a reach metric re-arms the poisoning silently, which is why this reads the
// ARTIFACT on every run rather than trusting the 2026-08-10 measurement.
{
  const REACH_FAMILY = /reach|frequen|unique_users|impression_freq|cookie/i
  const ARTIFACT = 'docs/google-ads-capture-universe.json'
  let doc = null
  try { doc = JSON.parse(readFileSync(resolve(ROOT, ARTIFACT), 'utf8')) }
  catch (e) { findings.push(`(d) UNREADABLE ${ARTIFACT} — ${e.message}. The metric universe cannot be verified, so it is not verified.`) }
  if (doc) {
    const offenders = []
    for (const entry of doc.entries || []) {
      for (const m of entry.servesMetrics || []) {
        if (REACH_FAMILY.test(m)) offenders.push(`${entry.resource}|${entry.segment ?? ''} servesMetrics: ${m}`)
      }
      if (entry.metricShape && REACH_FAMILY.test(entry.metricShape)) {
        offenders.push(`${entry.resource}|${entry.segment ?? ''} metricShape: ${entry.metricShape}`)
      }
    }
    for (const o of offenders) {
      findings.push(`(d) REACH-FAMILY METRIC IN THE CATALOG: ${o}. A 3-year reach refusal is indistinguishable from a ` +
        `37-month granular refusal at the error level, so this metric can poison universe_account_floor 13 months early — ` +
        `and GREATEST() never lowers a wall. Either drop the metric or give 062 a metric-family key BEFORE this ships.`)
    }
    // The writer's own default set is the third input to buildGaql and gets the same test.
    const writerSrc = read('src/lib/backfill/google-ads-universe-writer.ts')
    const dm = writerSrc.match(/DEFAULT_METRICS\s*=\s*\[([\s\S]*?)\]/)
    if (!dm) findings.push(`(d) DEFAULT_METRICS not found in the writer — the default metric set cannot be verified, so it is not verified.`)
    else if (REACH_FAMILY.test(dm[1])) findings.push(`(d) DEFAULT_METRICS contains a reach-family metric: ${dm[1].replace(/\s+/g, ' ').trim()}`)
  }
}

if (findings.length) {
  console.error(`[google-account-floor] FAIL — ${findings.length} finding(s):`)
  for (const f of findings) console.error(`  - ${f}`)
  process.exit(1)
}
console.log(`[google-account-floor] PASS — the Google adapter DRIVES to retention.floorDate === null with source 'none' · no ISO date literal appears in code on the adapter or the v2 consumer · the v2 consumer resolves a discovered per-(account,surface) wall instead of a global constant · and the ENTIRE metric universe (catalog servesMetrics + metricShape + writer DEFAULT_METRICS) contains NO reach-family metric, which is what makes 062's key safe without a metric-family column. ⚠ SCOPE: the v1 consumer and cron/universe-resume are NOT covered and still import VENDOR_FLOOR_DATE (★V1-CONSUMER-STILL-ON-A-GLOBAL-FLOOR).`)
