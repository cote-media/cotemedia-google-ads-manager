#!/usr/bin/env node
// LORAMER_GOOGLE_FORWARD_RESTATE_V1 — GOOGLE FORWARD CAPTURE MAY NOT ASK FOR ONE DAY.
//
// ⛔ THE DEFECT THIS EXISTS FOR, MEASURED 2026-08-24 against live vendor data (Round 17-PRE-B):
// Google restates AFTER capture, and not only conversions. Pooled over three clients × 90 days,
// comparing what forward capture stored at T+1 against what the vendor returns today:
//   share of client-days whose value CHANGED   spend 17-52% · clicks 11-48% · conversions 30-78%
//   net direction                              spend/clicks/impressions DOWN (invalid-traffic credits)
//                                              conversions/value UP (attribution lag)
//   largest single spend move                  $84.12 -> $415.59 at age ONE DAY (acct 6474303109)
//                                              $147.64 -> $124.76 (-15.5%) at age 31 (acct 5103888507)
// A single-day forward fetch therefore stores a number that is already wrong the morning after, and
// nothing in the forward path ever touches that day again. Shopify (21d), Meta (9d) and GA4 (7d) all
// re-walk a trailing window for exactly this reason; Google was the one platform with no window.
//
// ⛔ AND IT IS NOT A CONVERSIONS PROBLEM. Spend and clicks restate on accounts with NO counting
// conversion actions at all, so a depth derived from conversion windows would never re-ask those
// accounts and would leave their spend wrong. The depth is a PLATFORM property. This guard therefore
// refuses any per-account gate on the lookback as well as the missing lookback itself.
//
// THREE LEGS:
//   (a) NO SINGLE-DAY ASK. No Google forward writer may be handed captureDate as BOTH bounds, and no
//       *Day() single-day wrapper may be called in the forward block. Every fetcher named here already
//       has a range-capable Window twin that the backfill adapters use, so this costs no extra request.
//   (b) ONE NAMED DEPTH. The lookback may not appear as a bare numeric literal at a call site. It must
//       reference a single named source, the way META_RESTATE_LOOKBACK_DAYS and SHOPIFY_FWD_RESTATE_DAYS do.
//   (c) THE ACCOUNT GRAIN IS NOT EXEMPT. entity_level='account' is the grain the drift was measured on.
//       A widening that covers the breakdown families and leaves the account row single-day is a FALSE
//       GREEN — the headline number stays wrong while the guard reads clean. If the block still stamps
//       account rows from a period-aggregating fetch, this leg fails.
import { readFileSync, readdirSync } from 'node:fs'
import { resolve, join, relative } from 'node:path'

const ROOT = process.env.LORAMER_GUARD_ROOT || process.cwd()
const SYNC = 'src/app/api/cron/sync/route.ts'
const findings = []

// ⛔ STRIP COMMENTS BEFORE MATCHING. This guard's own explanatory prose contains the exact strings it
// hunts for (`campaign.status != 'REMOVED'`, `pushRow('account'`, `buildGoogleMetricsRows(`), and on its
// first green run it reported FOUR findings that were all its own paragraphs. A guard that reads comments
// is not reading the code — the same class as the Shopify guard that passed on a comment until it was
// made to read the GraphQL. Every read below goes through this.
const stripComments = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1')
const readCode = (file) => { try { return stripComments(readFileSync(resolve(ROOT, file), 'utf8')) } catch { return null } }


let src = ''
try { src = readFileSync(resolve(ROOT, SYNC), 'utf8') } catch (e) {
  console.error(`google-forward-must-restate: CANNOT READ ${SYNC} — ${e.message}`)
  process.exit(1)
}

// ── Slice the GOOGLE forward block: from its pendingForwardClients('google') to the next platform's ──
const startIdx = src.indexOf(`pendingForwardClients('google'`)
if (startIdx < 0) {
  console.error(`google-forward-must-restate: cannot locate the Google forward block in ${SYNC} — refusing to pass on a file I could not parse`)
  process.exit(1)
}
const after = src.slice(startIdx + 1)
const nextIdx = after.indexOf('pendingForwardClients(')
const blockRaw = nextIdx < 0 ? src.slice(startIdx) : src.slice(startIdx, startIdx + 1 + nextIdx)
const block = stripComments(blockRaw)
const lineOf = (offsetInBlock) => src.slice(0, startIdx + offsetInBlock).split('\n').length

// ── LEG (a): no single-day ask ───────────────────────────────────────────────────────────────────────
// captureDate handed as both bounds, in either spelling (same line, or one per line).
// ⚠ ONE NAMED EXEMPTION, WITH ITS REASON AND ITS COST STATED — never a silent pass.
// fetchGoogleIntelligence(captureDate, captureDate) stays single-day ON PURPOSE: it is the LIVE prompt
// fetch (Lora / /api/intelligence), and its stored output is now only the conversion-action and
// impression-share families, which ride that same GAQL for free. Widening it would need a ranged
// conversion-action query — a NEW fetch, not a swap. ⛔ THE COST, SO IT IS NOT LOST: those two families
// therefore DO NOT RESTATE yet. QUEUE owes ★GOOGLE-CONVACTION-IS-RESTATE. Everything else must be ranged.
const EXEMPT_SINGLE_DAY = ['fetchGoogleIntelligence', 'fetchGoogleDimensional(']
const bothBounds = /(\w+)\s*\([^()]{0,4000}?captureDate\s*,\s*(?:\/\/[^\n]*\n\s*)?captureDate/gs
for (let m; (m = bothBounds.exec(block)); ) {
  if (EXEMPT_SINGLE_DAY.some((e) => m[0].includes(e))) continue
  findings.push({ leg: 'a', line: lineOf(m.index), what: 'captureDate passed as BOTH start and end', snippet: m[0].replace(/\s+/g, ' ').slice(0, 140) })
}
// Single-day wrappers. Each has a Window twin already used by a backfill adapter.
const DAY_WRAPPERS = ['fetchDeviceGrainDay', 'fetchGeoGrainDay', 'fetchHourGrainDay', 'fetchDemographicDay']
for (const fn of DAY_WRAPPERS) {
  const re = new RegExp(`\\b${fn}\\s*\\(`, 'g')
  for (let m; (m = re.exec(block)); ) {
    findings.push({ leg: 'a', line: lineOf(m.index), what: `single-day wrapper ${fn}() in the forward path`, snippet: `${fn}(...) — use the range-capable ${fn.replace(/Day$/, 'Window')}() the backfill already uses` })
  }
}

// ── LEG (b): one named depth ─────────────────────────────────────────────────────────────────────────
// A bare integer inside an addDaysUTC(...) negation at a call site is a literal depth.
const literalDepth = /addDaysUTC\s*\([^)]*?,\s*-\s*(\d+)\s*\)/g
for (let m; (m = literalDepth.exec(block)); ) {
  findings.push({ leg: 'b', line: lineOf(m.index), what: `lookback depth written as the bare literal ${m[1]}`, snippet: m[0].replace(/\s+/g, ' ') })
}
// The named source must exist at module scope and be referenced inside the block.
const NAMED = 'GOOGLE_RESTATE_LOOKBACK_DAYS'
const declared = new RegExp(`const\\s+${NAMED}\\s*=\\s*\\d+`).test(src)
const referenced = block.includes(NAMED)
if (!declared) findings.push({ leg: 'b', line: 0, what: `no single named depth: \`const ${NAMED} = <n>\` is not declared in ${SYNC}`, snippet: `Meta declares META_RESTATE_LOOKBACK_DAYS; Shopify declares SHOPIFY_FWD_RESTATE_DAYS. Google declares nothing.` })
if (!referenced) findings.push({ leg: 'b', line: 0, what: `the Google forward block never references ${NAMED}`, snippet: 'a depth that is declared but unused is not a lookback' })

// ── LEG (c): the account grain is not exempt ─────────────────────────────────────────────────────────
// The forward block must reach the account grain through the dedicated RANGED per-day writer.
if (!/fetchGoogleAccountWindow\s*\(/.test(block) || !/buildGoogleAccountRows\s*\(/.test(block)) {
  findings.push({ leg: 'c', line: 0, what: 'the Google forward block does not build account rows from the ranged per-day writer', snippet: 'expected fetchGoogleAccountWindow(...) + buildGoogleAccountRows(...)' })
}
if (/buildGoogleMetricsRows\s*\(/.test(block)) {
  const m = /buildGoogleMetricsRows\s*\(/.exec(block)
  findings.push({ leg: 'c', line: lineOf(m.index), what: 'forward still writes base rows from the period-AGGREGATING intelligence fetch', snippet: 'fetchGoogleIntelligence() sums a range and buildGoogleMetricsRows() stamps ONE date — the base grains come from the ranged writers now' })
}

// ── LEG (a2): no per-account gate on whether the lookback runs ───────────────────────────────────────
// The depth is a platform property (spend restates on accounts with zero counting conversion actions).
const GATE = /(conversion_action|countingConversion|hasConversions|primary_for_goal)[^\n]*\b(if|\?|&&)\b/g
for (let m; (m = GATE.exec(block)); ) {
  findings.push({ leg: 'a2', line: lineOf(m.index), what: 'lookback appears gated on conversion setup', snippet: m[0].replace(/\s+/g, ' ').slice(0, 120) })
}


// ── LEG (d): EXACTLY ONE PRODUCER OF google entity_level='account' ROWS — SCANNED AS A CLASS ──────────
// Russ's ruling, 2026-08-24: an account total INCLUDES campaigns that were later deleted, because the
// spend really happened. Two consequences a guard can hold:
//   · ONE producer only — two paths writing google entity_level='account' on the same conflict key is the
//     ad-name-blank class: they agree until they don't, and nothing says which one is right;
//   · NO campaign-status filter upstream of whatever produces that STORED row.
//
// ⛔ THIS LEG WAS A HARDCODED FOUR-FILE LIST AND IT READ GREEN OVER A LIVE SECOND PRODUCER.
// `run-backfill.ts`'s DEFAULT row builder writes `platform: adapter.platform` + `entity_level: 'account'`
// on the IDENTICAL 7-column conflict key, reachable from /api/backfill/google, /api/backfill/run, the
// drain's tier-1 'account' step and the one-click Backfill button. The list did not contain it, so
// "expected exactly 1" was counted over a candidate set that EXCLUDED the offender — a number correct
// about what it measured and irrelevant to what it claimed (LORAMER_ADJACENT_NUMBER_V1). FIX-WITH-GUARD
// says guard the CLASS, not today's instance; this is that rewrite.
//
// WHAT IS SCANNED: every .ts/.tsx under src/, comments stripped. A candidate is a metrics_daily ROW
// LITERAL, and the test is the ENCLOSING OBJECT LITERAL rather than a character window — the window
// version false-flagged twice on its first run (a `entity_level: 'account' | 'campaign'` TYPE UNION and a
// LEVELS config entry in meta-simple-breakdown-core.ts, both of which merely sat near an unrelated
// `client_id:`). The row test is therefore structural: the SAME literal must carry `client_id:`,
// `platform:` and `date:`, which every metrics_daily row does and no config table does.
// GOOGLE-CAPABLE means that literal's `platform:` is 'google' OR a NON-LITERAL expression
// (`adapter.platform`, a variable) that a google adapter can reach. A row pinned to another vendor by a
// STRING LITERAL ('meta' | 'ga' | 'shopify' | 'woocommerce') is not ours and is skipped.
// ⛔ THE UNIVERSE WALK IS EXCLUDED BY CONSTRUCTION, NOT BY NAME — the fragile kind of exclusion is a
// filename. It writes `entity_level: level` (google-ads-universe-writer.ts) where level = entry.resource,
// so its account-grain fact lands as entity_level='customer' / breakdown_type='customer': a DISJOINT key
// space, mapped to account/'' at READ time only (universe-surfaces.ts DRAIN_ALIAS → universe-coverage.ts).
// There is no 'account' literal to match, so no exemption is needed and none is written.
const PRODUCER = 'src/lib/intelligence/google-account-row.ts'
const ADAPTERS = 'src/lib/backfill/adapters.ts'
const GENERIC_BUILDER_HOST = 'src/lib/backfill/run-backfill.ts'
const NON_GOOGLE_PLATFORM = /^(meta|ga|shopify|woocommerce)$/

// The google backfill adapter must declare a buildRows that routes through the single producer. Without
// it, google falls through to the shared DEFAULT account-row builder — the second producer above.
function googleAdapterRoutesThroughProducer() {
  const t = readCode(ADAPTERS)
  if (t === null) return false
  const i = t.indexOf(`platform: 'google'`)
  if (i < 0) return false
  const rest = t.slice(i)
  const j = rest.indexOf('export const')
  const blk = j < 0 ? rest : rest.slice(0, j)
  return /buildRows\s*:/.test(blk) && /buildGoogleAccountRows\s*\(/.test(blk)
}

function tsFilesUnder(dir, out = []) {
  let entries
  try { entries = readdirSync(dir, { withFileTypes: true }) } catch { return out }
  for (const e of entries) {
    const p = join(dir, e.name)
    if (e.isDirectory()) { if (e.name !== 'node_modules' && e.name !== '.next') tsFilesUnder(p, out) }
    else if (e.name.endsWith('.ts') || e.name.endsWith('.tsx')) out.push(p)
  }
  return out
}

/** The object literal that ENCLOSES this offset — nearest unmatched `{` back, to its matching `}`. */
function enclosingLiteral(t, idx) {
  let depth = 0, start = -1
  for (let i = idx; i >= 0; i--) {
    const c = t[i]
    if (c === '}') depth++
    else if (c === '{') { if (depth === 0) { start = i; break } depth-- }
  }
  if (start < 0) return null
  let d = 0
  for (let i = start; i < t.length; i++) {
    const c = t[i]
    if (c === '{') d++
    else if (c === '}') { d--; if (d === 0) return t.slice(start, i + 1) }
  }
  return t.slice(start)
}

const routesThroughProducer = googleAdapterRoutesThroughProducer()
const producers = []
const offenders = []
const googleAccountWriters = []
for (const abs of tsFilesUnder(resolve(ROOT, 'src'))) {
  const file = relative(resolve(ROOT), abs).split('\\').join('/')
  const t = readCode(file)
  if (t === null) continue
  // The trailing (?=[,}\s]) rejects a TYPE UNION (`entity_level: 'account' | 'campaign'`), which is a
  // declaration and not a written row.
  const re = /entity_level:\s*'account'\s*(?=[,}])/g
  for (let m; (m = re.exec(t)); ) {
    const lit = enclosingLiteral(t, m.index)
    if (lit === null) continue
    // A metrics_daily ROW carries client_id, platform and date in the SAME literal. `.eq('client_id', …)`
    // is a READ and never matches — the colon form is the object key, which is what a writer has.
    if (!/client_id\s*:/.test(lit) || !/date\s*:/.test(lit)) continue
    const p = /platform\s*:\s*(?:'([^']*)'|([A-Za-z_$][\w.$]*))/.exec(lit)
    if (!p) continue // no platform key in the row literal — not a metrics_daily write (the column is NOT NULL)
    if (p[1] && NON_GOOGLE_PLATFORM.test(p[1])) continue // another vendor's account row
    const line = t.slice(0, m.index).split('\n').length
    const platformExpr = p[1] ? `'${p[1]}'` : p[2]
    if (file === PRODUCER) { producers.push(file); googleAccountWriters.push(file); continue }
    googleAccountWriters.push(file)
    if (/buildGoogleAccountRows\s*\(/.test(t)) continue // routes through the producer in-file
    // A GENERIC builder (platform is an expression, not a google literal) is allowed ONLY while the google
    // adapter routes around it. The moment that buildRows is removed, this becomes a second producer again.
    if (!p[1] && routesThroughProducer) continue
    offenders.push({ file, line, platformExpr })
  }
}
if (producers.length !== 1) {
  findings.push({ leg: 'd', line: 0, what: `${producers.length} file(s) ARE the google account-row producer — expected exactly 1 (${PRODUCER})`, snippet: (producers.join('  +  ') || '(none found)') })
}
for (const o of offenders) {
  findings.push({ leg: 'd', line: 0, what: `${o.file}:${o.line} writes a GOOGLE-CAPABLE entity_level='account' row without routing through the single producer`, snippet: `platform: ${o.platformExpr} — same 7-column conflict key as ${PRODUCER}; it must call buildGoogleAccountRows()` })
}
if (!routesThroughProducer) {
  findings.push({ leg: 'd', line: 0, what: `the google backfill adapter in ${ADAPTERS} declares no buildRows routing through the single producer`, snippet: `google therefore falls through to the shared DEFAULT account-row builder in ${GENERIC_BUILDER_HOST} — reachable from /api/backfill/google, /api/backfill/run, the drain tier-1 'account' step and the one-click Backfill button` })
}
// The retired producer must be gone from BOTH cron callers, and must not come back in google-metrics-row.
for (const file of ['src/app/api/cron/sync/route.ts', 'src/app/api/cron/catchup/route.ts']) {
  const t = readCode(file)
  if (t === null) continue
  if (!/buildGoogleAccountRows\s*\(/.test(t)) {
    findings.push({ leg: 'd', line: 0, what: `${file} does not use the single account-row producer`, snippet: 'every cron path that writes a google account row must call buildGoogleAccountRows()' })
  }
}
const retired = readCode('src/lib/intelligence/google-metrics-row.ts')
if (retired !== null && /pushRow\s*\(\s*'account'/.test(retired)) {
  findings.push({ leg: 'd', line: 0, what: 'the retired account producer is back in src/lib/intelligence/google-metrics-row.ts', snippet: "pushRow('account', …) derives the account row from a campaign reduce filtered campaign.status != 'REMOVED' and stamps ONE captureDate — both defects this flight removed" })
}
// No campaign status filter inside anything that produces the stored google account row.
for (const file of [...new Set(googleAccountWriters)]) {
  const t = readCode(file)
  if (t === null) continue
  const m = /campaign\.status\s*!=\s*'REMOVED'/.exec(t)
  if (m) findings.push({ leg: 'd', line: 0, what: `${file}:${t.slice(0, m.index).split('\n').length} filters campaign.status != 'REMOVED' inside an account-row producer`, snippet: "Russ's ruling: deleted campaigns' spend really happened and must be counted" })
}
// ⚠ NAMED AND NOT GUARDED, because it is a DIFFERENT decision that Russ has not made:
// google-intelligence.ts still filters `campaign.status != 'REMOVED'` for data.totals, which now feeds ONLY
// the LIVE prompt (/api/intelligence, Lora) and no longer any stored row. So Lora's live account total and
// the stored account row can DIVERGE the first time a client deletes a campaign. Measured 2026-08-24: zero
// removed campaigns fleet-wide over 30 days, so the divergence is $0.00 today. QUEUE owes the ruling.

if (findings.length === 0) {
  console.log('google-forward-must-restate: PASSED — Google forward asks for a range from a single named depth, account grain included, ungated by conversion setup.')
  process.exit(0)
}
console.error(`google-forward-must-restate: FAILED — ${findings.length} finding(s) in ${SYNC} (Google forward block)\n`)
for (const f of findings) {
  console.error(`  [leg ${f.leg}] ${SYNC}:${f.line || '?'}  ${f.what}`)
  console.error(`      ${f.snippet}\n`)
}
process.exit(1)
