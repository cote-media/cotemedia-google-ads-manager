#!/usr/bin/env node
// LORAMER_UNIVERSE_FAILURE_IS_DURABLE_V1 — THE WALK MUST RECORD WHAT DIDN'T WORK, NOT ONLY WHAT DID.
//
// ⛔ THE CLASS THIS GUARDS, and it is not one bug. The audit (docs/LORAMER_BACKFILL_COMPLETE_AUDIT.md §3b)
// counted 15 of 22 defects that wrote durable state ONLY on the success path or on neither. Three separate
// 300-second poison loops formed on campaign_search_term_view (ids 2871, 17959, 17966), each invisible to the
// rate governor because `requests_spent` stayed 0 — the column is written only by closeWindow, which a killed
// invocation never reaches. Every leg below asserts a property of the CLASS: an open path that cannot count,
// an exit that writes nothing, a denominator that silently means less than it says.
//
// STATIC LEGS run in `npm run guard` (inside next build). The --db legs run in `npm run check:data` ONLY:
// a DB read in the deploy path is the posture this repo already rejected.
// ⛔ --db FAILS, NEVER SKIPS, when credentials are absent. A skipped check reads exactly like a passing one.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const ROOT = process.env.LORAMER_GUARD_ROOT || process.cwd()
const WITH_DB = process.argv.includes('--db')
const findings = []
const read = (rel) => {
  try { return readFileSync(resolve(ROOT, rel), 'utf8') }
  catch (e) { findings.push(`UNREADABLE ${rel} under ROOT ${ROOT} — ${e.message}. A guard that cannot read its evidence FAILS.`); return '' }
}
const strip = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

const LOG = 'src/lib/backfill/universe-window-log.ts'
const ROUTE = 'src/app/api/queues/google-ads-universe/route.ts'
const START = 'src/app/api/backfill/universe-start/route.ts'
const STATE = 'src/lib/backfill/universe-run-state.ts'
const MIG = 'migrations/060_universe_window_attempts.sql'

const logSrc = strip(read(LOG))
const routeSrc = strip(read(ROUTE))
const startSrc = strip(read(START))
const stateSrc = strip(read(STATE))
const migSrc = read(MIG) // comments are the evidence here, do NOT strip

// ── (a) THE OPEN PATH IS THE RPC, NOT A LITERAL-PAYLOAD UPSERT ──────────────────────────────────────────
// PostgREST's upsert can only set a column to the value supplied, never to an expression over the existing
// row, so `attempts = attempts + 1` is not expressible there — and the old payload wrote requests_spent: 0
// on every open, which is exactly how a redelivery counted backwards.
if (logSrc) {
  if (!/rpc\(\s*'universe_window_open'/.test(logSrc)) {
    findings.push(`(a) ${LOG} does not open through the universe_window_open RPC. A literal-payload upsert cannot increment an attempt counter and cannot record spend at dispatch — the two properties that make a killed invocation visible at all.`)
  }
  const openBody = logSrc.slice(logSrc.indexOf('export async function openWindow'), logSrc.indexOf('export type WindowOutcome'))
  if (/\.upsert\(/.test(openBody)) {
    findings.push(`(a) openWindow still contains a .upsert( — the pre-fix literal payload. It RESETS rows_written/requests_spent/refused_rows/error/finished_at on every open, so an attempts field written that way counts backwards on redelivery.`)
  }
  if (!/Promise<number>/.test(openBody)) {
    findings.push(`(a) openWindow does not return a number. The attempt count must reach the caller, or the retry bound has nothing to bound on.`)
  }
}

// ── (b) AMENDMENT 1 — A LAWFUL EARLY RETURN MUST NOT COUNT AS AN ATTEMPT ────────────────────────────────
// quota_stop (the governor) and floor_stop (the disk floor) are those systems working. Three quota pauses on
// one window is routine under the 15,000/day cap and must never abandon a window that never failed.
if (migSrc) {
  const hasConditional = /attempts\s*=\s*universe_window_log\.attempts\s*\+\s*case\s+when\s+universe_window_log\.outcome\s*=\s*'running'\s+then\s+1\s+else\s+0\s+end/i.test(migSrc)
  if (!hasConditional) {
    findings.push(`(b) ${MIG} does not increment attempts CONDITIONALLY on the previous outcome being 'running'. Without that exact conditional, quota_stop and floor_stop — lawful early returns — each charge an attempt, and three quota pauses abandon a window that never failed.`)
  }
  const unconditional = /attempts\s*=\s*universe_window_log\.attempts\s*\+\s*1\s*(,|$)/im.test(migSrc)
  if (unconditional) {
    findings.push(`(b) ${MIG} contains an UNCONDITIONAL 'attempts + 1'. Every open would charge an attempt regardless of why the window re-opened.`)
  }
}

// ── (c) THE SUCCESSOR SIZE COMES FROM THE MESSAGE, NOT THE MODULE CONSTANT ─────────────────────────────
// A halved window whose successor reverts to the global size survives exactly one hop and then re-enters the
// size that killed it.
if (routeSrc) {
  if (!/windowDays\?\s*:\s*number/.test(routeSrc)) {
    findings.push(`(c) UniverseMessage does not declare 'windowDays?: number'. The halved size cannot travel with the chain, so a reactive halving reverts to WINDOW_DAYS on the next hop.`)
  }
  const advance = routeSrc.slice(routeSrc.indexOf('async function advanceToNextWindow'), routeSrc.indexOf('export const POST'))
  if (advance && !/msg\.windowDays\s*\?\?\s*WINDOW_DAYS/.test(advance)) {
    findings.push(`(c) advanceToNextWindow does not derive its successor from 'msg.windowDays ?? WINDOW_DAYS'. Deriving from the module constant is what makes the split non-sticky.`)
  }
}

// ── (d) EXACTLY ONE SUCCESSOR PER INVOCATION ───────────────────────────────────────────────────────────
// ⛔ THE REJECTED DESIGN, PINNED SO IT CANNOT RETURN. Splitting a dying window into TWO messages is fatal:
// the successor is derived from startDate alone, so BOTH halves advance and every split produces two
// overlapping backward chains that never merge. The idempotency key is per-nextStart and dedupes none of it.
if (routeSrc) {
  const sends = (routeSrc.match(/await send\(\s*TOPIC/g) || []).length
  if (sends > 2) {
    findings.push(`(d) ${ROUTE} contains ${sends} 'await send(TOPIC' call sites. At most TWO are legitimate — the normal successor and the halved re-publish — and neither may fan out. More than that is the rejected split-into-two design returning.`)
  }
  const advance = routeSrc.slice(routeSrc.indexOf('async function advanceToNextWindow'), routeSrc.indexOf('export const POST'))
  if (advance && (advance.match(/await send\(/g) || []).length > 1) {
    findings.push(`(d) advanceToNextWindow publishes more than one message. ONE window in, ONE successor out — anything else forks the chain.`)
  }
}

// ── (e) NO EXIT MAY RETURN WITHOUT WRITING A TERMINAL RECORD ───────────────────────────────────────────
// The FLOOR-REACHED path returned writing NOTHING — no window row, no seal — which is the mechanical reason
// 249 of 253 unsealed entries had already walked to the floor.
if (routeSrc) {
  const i = routeSrc.indexOf('nextEnd < VENDOR_FLOOR_DATE')
  if (i === -1) {
    findings.push(`(e) the VENDOR_FLOOR_DATE publish-stop is gone from ${ROUTE}. It is the only thing preventing the walk spending quota below the measured floor.`)
  } else {
    const branch = routeSrc.slice(i, i + 900)
    const ret = branch.indexOf('return')
    if (ret === -1 || !/recordEntryOutcome\(/.test(branch.slice(0, ret))) {
      findings.push(`(e) the FLOOR-REACHED branch returns WITHOUT calling recordEntryOutcome. An entry that reaches its floor with rows in the last window exits unsealed forever — measured at 249 of 253 unsealed entries, and it is also why universe_run_notice has never been written.`)
    }
  }
}

// ── (f) THE DONE-SIGNAL DENOMINATOR MUST BE THE PUBLISHED SET ──────────────────────────────────────────
// route.ts counted 559 (the catalog filter) while the starter publishes selectableEntries = 346. 346 < 559
// makes isClientComplete unsatisfiable BY CONSTRUCTION, independently of the seal.
if (routeSrc) {
  if (/const total = doc\.entries\.filter\(/.test(routeSrc)) {
    findings.push(`(f) the done-signal denominator in ${ROUTE} is still the raw catalog filter (559), not selectableEntries (346, what the starter actually publishes). isClientComplete requires states.length >= totalEntries, so the notice can NEVER fire.`)
  }
  if (!/selectableEntries\(/.test(routeSrc)) {
    findings.push(`(f) ${ROUTE} does not use selectableEntries for its denominator. The published set is the only honest denominator for 'is this client done'.`)
  }
}

// ── (g) AMENDMENT 4 — A NOTICE MAY NOT CARRY ONE DENOMINATOR WITHOUT THE OTHER ─────────────────────────
// 'complete' over 346 while 213 catalog entries are excluded is a green flag over a hole. The catalog is NOT
// narrowed — VENDOR_CATALOG_IS_THE_DENOMINATOR stands; the debt is made visible instead.
if (stateSrc) {
  const hasCatalog = /entries_catalog_total\s*:/.test(stateSrc)
  const hasExcluded = /entries_excluded\s*:/.test(stateSrc)
  if (hasCatalog !== hasExcluded) {
    findings.push(`(g) writeCompletionNotice writes ${hasCatalog ? 'entries_catalog_total WITHOUT entries_excluded' : 'entries_excluded WITHOUT entries_catalog_total'}. One number without the other is exactly the half-truth this leg exists to stop.`)
  }
  if (!hasCatalog || !hasExcluded) {
    findings.push(`(g) writeCompletionNotice does not populate BOTH entries_catalog_total and entries_excluded. A completion notice that states only what it walked, and not what the vendor serves, reports 346 of 559 as 'complete'.`)
  }
  if (!/exclusions/.test(stateSrc)) {
    findings.push(`(g) the notice carries no per-entry exclusion list. "213 excluded" without WHICH ones and WHY is a number nobody can act on.`)
  }
}

// ── (h) THE ARBITRARY-WINDOW PUBLISHER'S PARAMS ARE ADDITIVE ───────────────────────────────────────────
// The three orphaned windows cannot be re-walked without them, and every param must leave today's behaviour
// byte-identical when omitted.
if (startSrc) {
  for (const [p, why] of [
    ['resource', 'without an entry filter a re-walk of one window fans out to all 346 entries'],
    ['windowDays', 'without it the first window of a re-walk is always 30 days — the size that died'],
    ['rewalk', 'without a discriminator the idempotency key collides with the original publish and Queues drops it silently for the life of the message TTL'],
  ]) {
    if (!new RegExp(`searchParams\\.get\\('${p}'\\)`).test(startSrc)) {
      findings.push(`(h) ${START} does not read ?${p}= — ${why}.`)
    }
  }
}

// ── (m) A SCOPING PARAMETER MAY NEVER PUBLISH MORE THAN THE OPERATOR PICTURED ──────────────────────────
// ⛔ THE RECORDED INSTANCE, 2026-08-08 19:57:43Z: an approval for ONE message published FIFTEEN. The command
// carried `?resource=campaign_search_term_view` with no `segment=`, and that resource has a base entry plus
// 14 segment variants — so "one resource" silently meant "every entry on that resource". Rows 18017-18031 in
// universe_window_log are the fifteen, each with requests_spent 1. The route COMPUTED the matched count and
// REPORTED it in the response; it did not REFUSE on it, and by the time the number was readable the messages
// were sent.
// ⛔ THIS LEG GUARDS THE CLASS, NOT THE SEGMENT CASE: any scoping parameter that matches more than one entry,
// and any call that would publish more than the ceiling, must refuse rather than report.
if (startSrc) {
  if (!/allEntries/.test(startSrc)) {
    findings.push(`(m) ${START} has no 'allEntries' escape. A fan-out larger than the operator asked for must require an EXPLICIT flag — the same shape as the existing allowDeadStart=1 — or the only thing between an approval for one message and fifteen is the operator reading a number in a response that has already fired.`)
  }
  if (!/MAX_PUBLISH_WITHOUT_FLAG/.test(startSrc)) {
    findings.push(`(m) ${START} has no publish ceiling constant. The resource filter is ONE instance of "a scoping parameter matched more than I pictured"; the ceiling is the class guard that catches the instances nobody has thought of yet.`)
  }
  // The refusal must be keyed on the MATCHED COUNT and must sit BEFORE the send loop.
  const iSend = startSrc.indexOf('await send(TOPIC')
  const beforeSend = iSend === -1 ? '' : startSrc.slice(0, iSend)
  if (iSend !== -1 && !/refus/i.test(beforeSend)) {
    findings.push(`(m) ${START} contains no refusal path before its send loop. Reporting a scope AFTER publishing is not a control.`)
  }
  if (!/matched > 1|matched !== 1|entries\.length > 1/.test(startSrc)) {
    findings.push(`(m) ${START} never tests the matched count against 1 for a resource-only filter. That exact shape published 15 messages against an approval for 1 (rows 18017-18031, 2026-08-08).`)
  }
  // dryRun must reach the SAME reporting path, so checking is cheaper than firing.
  if (!/wouldPublish/.test(startSrc) || !/dryRun/.test(startSrc)) {
    findings.push(`(m) ${START} does not report wouldPublish under dryRun. The dry run is the thing that must be hard to skip; it existed tonight and was not read.`)
  }
  if (!/matchedEntries|wouldRefuse/.test(startSrc)) {
    findings.push(`(m) ${START} does not return the MATCHED ENTRY LIST (and whether the call would be refused). A count alone is what made 15 look like 1 — the operator needs the names, before anything is sent.`)
  }
}

// ── LIVE LEGS ──────────────────────────────────────────────────────────────────────────────────────────
if (WITH_DB) {
  for (const line of read('.env.local').split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
  }
  if (!process.env.SUPABASE_DB_URL) {
    console.error(`[universe-failure-is-durable] FAIL — --db requested but SUPABASE_DB_URL is missing (.env.local). REFUSING TO PASS QUIETLY: a skipped stale-window check reads exactly like a passing one, which is the failure mode this file exists to prevent.`)
    process.exit(1)
  }
  const pg = (await import('pg')).default
  const db = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } })
  await db.connect()
  const q = async (sql, params) => (await db.query(sql, params)).rows

  // (i) NO `running` ROW MAY OUTLIVE ONE maxDuration. This is the poison loop, stated as an invariant.
  const maxDurationMatch = /export const maxDuration = (\d+)/.exec(read(ROUTE))
  const maxDuration = maxDurationMatch ? Number(maxDurationMatch[1]) : 300
  const stale = await q(
    `select id, resource, window_start, started_at, now() - started_at as age
       from public.universe_window_log
      where outcome = 'running' and started_at < now() - ($1 || ' seconds')::interval
      order by started_at`, [String(maxDuration)])
  const runningTotal = (await q(`select count(*)::int as n from public.universe_window_log where outcome = 'running'`))[0].n
  if (stale.length) {
    findings.push(`(i) ${stale.length} window(s) have read 'running' for longer than one maxDuration (${maxDuration}s) — an invocation cannot be alive past its own ceiling, so each is a DEAD window being redelivered forever: ${stale.map((r) => `${r.id}:${r.resource} ${r.window_start} age ${r.age}`).join(' · ')}`)
  }

  // (j) EVERY ORPHAN IS ENUMERABLE. 'error' means "asked and failed"; a window we STOPPED ASKING about is a
  // different fact and must be findable by one query, or the first orphans are the ones nobody can list.
  const owed = await q(`select id, resource, window_start from public.universe_window_log where outcome = 'abandoned_owed' order by window_start`)
  const haltedAsError = await q(
    `select id, resource, window_start from public.universe_window_log
      where outcome = 'error' and (error ilike '%TIMEOUT_LOOP_HALT%' or error ilike '%stopped asking%' or error ilike '%operator%')`)
  if (haltedAsError.length) {
    findings.push(`(j) ${haltedAsError.length} window(s) were halted by an operator but stored as 'error', not 'abandoned_owed': ${haltedAsError.map((r) => `${r.id}:${r.resource} ${r.window_start}`).join(' · ')}. They are invisible to the owed enumeration, which means the system cannot list the work it knows it owes.`)
  }

  // (k) THE CHECK MUST ACCEPT THE OWED STATE, or nothing can ever be recorded as owed.
  const chk = await q(
    `select pg_get_constraintdef(oid) as def from pg_constraint
      where conrelid = 'public.universe_window_log'::regclass and contype = 'c'`)
  if (!chk.some((c) => /abandoned_owed/.test(c.def))) {
    findings.push(`(k) the universe_window_log outcome CHECK does not accept 'abandoned_owed'. migration 060 has not been applied, so the owed state cannot be written at all.`)
  }
  const cols = await q(
    `select column_name from information_schema.columns
      where table_schema='public' and table_name='universe_window_log' and column_name='attempts'`)
  if (!cols.length) {
    findings.push(`(k) universe_window_log has no 'attempts' column. migration 060 has not been applied; the retry bound has nothing to read.`)
  }
  const rpc = await q(
    `select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='public' and p.proname='universe_window_open'`)
  if (!rpc.length) {
    findings.push(`(k) public.universe_window_open does not exist. The open path cannot be atomic.`)
  }

  // (l) AMENDMENT 4, ENFORCED ON THE DATA — a notice may not carry one denominator without the other.
  const halfNotice = await q(
    `select id, client_id from public.universe_run_notice
      where (entries_catalog_total is null) <> (entries_excluded is null)
         or (entries_catalog_total is not null and entries_catalog_total < entries_total)`)
  if (halfNotice.length) {
    findings.push(`(l) ${halfNotice.length} completion notice(s) carry one denominator without the other, or a catalog total smaller than what was walked. A notice that states only the published set reports 346 of 559 as complete.`)
  }

  // ⛔ EMPTY CARRIES ITS DENOMINATOR (LORAMER_EMPTY_CARRIES_ITS_DENOMINATOR_V1).
  console.log(`[universe-failure-is-durable] live legs examined: ${runningTotal} running row(s) (${stale.length} stale beyond ${maxDuration}s) · ${owed.length} owed · ${haltedAsError.length} operator-halted-as-error · notices checked: ${(await q(`select count(*)::int n from public.universe_run_notice`))[0].n}`)
  await db.end()
}

if (findings.length) {
  console.error(`[universe-failure-is-durable] FAIL — ${findings.length} finding(s):`)
  for (const f of findings) console.error(`  - ${f}`)
  process.exit(1)
}
console.log(`[universe-failure-is-durable] PASS — the open path is the atomic RPC and returns its attempt count · a lawful early return (quota_stop/floor_stop) never charges an attempt · the successor size travels on the message · one window in, one successor out · no exit returns without a terminal record · the done-signal denominator is the published set · a notice carries BOTH denominators with its exclusions · the re-walk publisher's params exist${WITH_DB ? ' · and no running row outlives its own ceiling' : ' (static legs only — run with --db for the live invariants)'}.`)
