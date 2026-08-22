#!/usr/bin/env node
// LORAMER_DRAIN_FITS_THE_INTERVAL_V1 — THE PAIR IDENTITY, EXECUTED INSTEAD OF DESCRIBED.
//
// ⛔ WHY THIS EXISTS, AND IT IS THE RULE-HOME LAW APPLIED TO ITSELF. The safety property that binds the
// walk's cadence to the consumer's concurrency has been written down THREE TIMES — in
// `universe-resumer.ts`'s MAX_REQUESTS_PER_RUN header, in `universe-stream-consumer.guard.mjs`'s leg (e)
// comment ("⛔ IT IS PAIRED WITH maxConcurrency AND THE PAIR IS THE SAFETY PROPERTY"), and in the DEPLOY-2
// decision — and **NOTHING HAS EVER ASSERTED IT.** Every one of those is prose, and prose in a doc is not a
// guard (banked law). Measured on 2026-08-19: changing the cron cadence from every 15 minutes to every 5
// WITHOUT raising concurrency passed all 133 guards, and would have backed the queue into the next fire by
// a factor of three.
//
// THE IDENTITY, and every term is READ FROM ITS OWN SOURCE rather than retyped — a second copy of any of
// these four numbers is the LORAMER_ADJACENT_NUMBER_V1 class, and this file exists precisely because the
// relationship between them was only ever a comment:
//
//     bite × WALK_BUDGET_MS ÷ maxConcurrency  ≤  cron interval
//
//   · bite            — `MAX_REQUESTS_PER_RUN`, src/lib/backfill/universe-resumer.ts. One owed range is one
//                       vendor request is one published message, so a fire publishes at most `bite` messages.
//   · WALK_BUDGET_MS  — src/lib/backfill/universe-v2-worker.ts. The WORST case a single consumer
//                       invocation may take before it defers. Not the typical case (~6s measured); the bound.
//   · maxConcurrency  — vercel.json, the `queue/v2beta` trigger on the v2 consumer ROUTE. How many of those
//                       invocations run at once.
//   · cron interval   — vercel.json, the `universe-resume` cron schedule. How long the drain has before the
//                       next fire adds another `bite` of messages on top.
//
// ⛔ WHAT BREAKING IT COSTS, STATED SO A FUTURE READER DOES NOT TRADE IT AWAY FOR THROUGHPUT: a backlog is
// SAFE for correctness — idempotency keys dedupe re-publishes and owed-ness is DERIVED, never stored — so
// nothing is lost. What is lost is SMOOTHNESS and, with it, every rate measurement taken from the fire log:
// requests appear to be spent long after the fire that authorised them, the meter's rolling window smears,
// and a genuine runaway becomes indistinguishable from a queue catching up. The bound is for legibility as
// much as for load.
//
// ⚠ LIMITS, so the green is not over-read: it asserts the WORST-CASE arithmetic, not observed drain time —
// a consumer that silently got slower than `WALK_BUDGET_MS` would still pass. It reads only the v2 topic's
// route entry. And it cannot see Vercel's own concurrency ceilings: a `maxConcurrency` the platform will not
// actually grant reads here exactly like one it will.
//
// USAGE: node tests/guards/queue-drain-fits-the-interval.guard.mjs
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const ROOT = process.env.LORAMER_GUARD_ROOT || process.cwd()
const VERCEL = 'vercel.json'
const RESUMER = 'src/lib/backfill/universe-resumer.ts'
const CONSUMER = 'src/lib/backfill/universe-v2-worker.ts'
const CRON_MATCH = /universe-resume/
const findings = []

const read = (rel) => {
  try { return readFileSync(resolve(ROOT, rel), 'utf8') }
  catch (e) { findings.push(`UNREADABLE ${rel} — ${e.message}. A guard that cannot read its evidence FAILS rather than passing.`); return null }
}

/**
 * ⛔ THE PURE DECISION, so the identity can be driven with no filesystem. Returns the worst-case drain in ms
 * and whether it fits. `null` for any term is UNKNOWN and must never be defaulted into a pass — the caller
 * turns a missing term into a finding before it gets here.
 */
export function drainFits({ bite, walkBudgetMs, maxConcurrency, intervalMs }) {
  const worstCaseMs = Math.ceil((bite * walkBudgetMs) / maxConcurrency)
  return { worstCaseMs, fits: worstCaseMs <= intervalMs, headroomMs: intervalMs - worstCaseMs }
}

/**
 * ⛔ A SCHEDULE THIS CANNOT READ IS A FINDING, NOT A PASS. Only the two forms the repo has ever used are
 * parsed — `*​/N * * * *` and `M * * * *` (hourly at minute M). Anything else returns null and the caller
 * refuses, because silently treating an unparsed cron as "fine" is the false-all-clear class.
 */
export function cronIntervalMs(schedule) {
  const s = String(schedule || '').trim()
  let m = /^\*\/(\d+)\s+\*\s+\*\s+\*\s+\*$/.exec(s)
  if (m) return Number(m[1]) * 60_000
  m = /^(\d+)\s+\*\s+\*\s+\*\s+\*$/.exec(s)
  if (m) return 60 * 60_000
  return null
}

const vercelRaw = read(VERCEL)
const resumerSrc = read(RESUMER)
const consumerSrc = read(CONSUMER)

let bite = null, walkBudgetMs = null, maxConcurrency = null, intervalMs = null, schedule = null
// ⛔ PROVENANCE OF THE PER-MESSAGE TERM, CARRIED WITH THE VALUE. Under push it is the worker’s hard
// WALK_BUDGET_MS ceiling; under poll it is the lane’s declared ASSUMED_MAX_MESSAGE_MS. Reporting one
// label while having read the other is the adjacent-number class this guard exists to police.
let perMsgLabel = 'WALK_BUDGET_MS', perMsgSource = CONSUMER

if (resumerSrc) {
  const m = /export const MAX_REQUESTS_PER_RUN\s*=\s*([\d_]+)/.exec(resumerSrc)
  if (!m) findings.push(`MAX_REQUESTS_PER_RUN not found in ${RESUMER}. The bite is one of the four terms of the identity; it is not being guessed.`)
  else bite = Number(m[1].replace(/_/g, ''))
}
if (consumerSrc) {
  const m = /WALK_BUDGET_MS\s*=\s*([\d_]+)/.exec(consumerSrc)
  if (!m) findings.push(`WALK_BUDGET_MS not found in ${CONSUMER}. The per-message worst case is one of the four terms; it is not being guessed.`)
  else walkBudgetMs = Number(m[1].replace(/_/g, ''))
}
if (vercelRaw) {
  let parsed = null
  try { parsed = JSON.parse(vercelRaw) }
  catch (e) { findings.push(`${VERCEL} is not valid JSON — ${e.message}.`) }
  if (parsed) {
    const crons = (parsed.crons || []).filter((c) => CRON_MATCH.test(String(c.path || '')))
    if (crons.length !== 1) {
      findings.push(`${VERCEL} holds ${crons.length} cron entr(ies) matching ${CRON_MATCH} — this identity is written for EXACTLY ONE publisher on ONE cadence. (The one-entry rule itself is owned by universe-stream-consumer.guard.mjs leg (e); this leg needs it to be true before its arithmetic means anything.)`)
    } else {
      schedule = String(crons[0].schedule || '')
      intervalMs = cronIntervalMs(schedule)
      if (intervalMs === null) findings.push(`the universe-resume cron schedule "${schedule}" is not a form this guard can parse. ⛔ AN UNPARSED SCHEDULE IS NOT A PASS — teach the parser in the same commit that introduces the form, or the identity silently stops being checked.`)
    }
    // ⛔ THE LANE MAY BE PUSH **OR** POLL, AND EXACTLY ONE OF THEM MUST EXIST — LORAMER_POLL_MODE_CUTOVER_V1.
    // The registration half of this guard is UNCHANGED in strength: ★V2-CONSUMER-HAS-NO-TRIGGER-REGISTRATION
    // is the failure of publishing into a topic nothing reads, and that is just as true when the missing
    // reader is a cron poller as when it is a queue trigger. What changed is only WHICH declaration counts.
    // ⚠ THE CAPACITY HALF IS HONESTLY WEAKER AND SAYS SO. Push declared `maxConcurrency` — a static number
    // the platform enforced. A single-threaded poller has no such number: its parallelism is 1 and its
    // per-message cost is a RUNTIME fact. So the poll form of the identity substitutes the poll route's
    // DECLARED `ASSUMED_MAX_MESSAGE_MS` for the worker's hard `WALK_BUDGET_MS` ceiling, at parallelism 1.
    // That is an assumption where there used to be a guarantee. It is not papered over: the poll route
    // reports `worstMessageMs` and `capacityAssumptionHeld` on EVERY invocation, so the moment the
    // assumption stops being true in the field it is visible without a dashboard. Static proof lost a term;
    // a runtime detector took it. Both are named rather than one quietly standing in for the other.
    const fn = (parsed.functions || {})[CONSUMER]
    const trig = ((fn || {}).experimentalTriggers || []).find((t) => String(t.topic || '').endsWith('google-ads-universe-v2'))
    const POLL_LANE = 'src/app/api/cron/universe-drain-poll/route.ts'
    let pollSrc = ''
    try { pollSrc = readFileSync(resolve(ROOT, POLL_LANE), 'utf8') } catch { pollSrc = '' }
    const pollCron = (parsed.crons || []).some((c) => /^\/api\/cron\/universe-drain-poll\b/.test(String(c.path || '')))
    const assumedMs = (pollSrc.match(/const\s+ASSUMED_MAX_MESSAGE_MS\s*=\s*([\d_]+)/) || [])[1]
    if (trig && pollCron) {
      findings.push(`${VERCEL} registers BOTH a queue trigger and the poll cron for this topic. Two lanes are two consumer groups, each receiving a COPY of every message and processing it CONCURRENTLY — the vendor ops double and the op meter doubles with them. (Owned in detail by one-delivery-lane-per-topic.guard.mjs; refused here too because this guard is where the registration is read.)`)
    } else if (!trig && !pollCron) {
      findings.push(`${VERCEL} registers NEITHER a queue trigger for ${CONSUMER} nor the poll cron ${POLL_LANE}. The consumer is unregistered and the walk publishes into a topic nothing reads (★V2-CONSUMER-HAS-NO-TRIGGER-REGISTRATION).`)
    } else if (pollCron) {
      if (!assumedMs) findings.push(`${POLL_LANE} declares no ASSUMED_MAX_MESSAGE_MS. A single-threaded poller's capacity IS that number; without it the identity has an unknown term and this guard would be asserting nothing.`)
      else { maxConcurrency = 1; walkBudgetMs = Number(String(assumedMs).replace(/_/g, '')); perMsgLabel = 'ASSUMED_MAX_MESSAGE_MS'; perMsgSource = POLL_LANE }
    }
    if (trig && typeof trig.maxConcurrency !== "number") findings.push(`the v2 consumer trigger declares no numeric maxConcurrency. It is one of the four terms of the identity; an absent one is UNKNOWN, not a pass.`)
    else if (trig) maxConcurrency = trig.maxConcurrency
  }
}

// ── THE SELF-TEST — GUARD-ON-GUARD, ALWAYS, BEFORE THE REAL VALUES ARE JUDGED ────────────────────────
// ⛔ A DETECTOR THAT CANNOT SEE THE DEFECT READS EXACTLY LIKE A CLEAN BILL OF HEALTH. The fixture that
// matters is THE ONE THIS FILE WAS WRITTEN FOR — a 5-minute cadence still at concurrency 8 — and if the
// decision ever calls it fitting, this exits 2 BROKEN rather than 0 or 1.
{
  const cases = [
    { name: 'the shape this guard exists for: 5-minute cadence, concurrency 8', a: { bite: 40, walkBudgetMs: 180_000, maxConcurrency: 8, intervalMs: 300_000 }, fits: false },
    { name: 'the same cadence at concurrency 24', a: { bite: 40, walkBudgetMs: 180_000, maxConcurrency: 24, intervalMs: 300_000 }, fits: true },
    { name: 'DEPLOY-2 as shipped: 15-minute cadence, concurrency 8', a: { bite: 40, walkBudgetMs: 180_000, maxConcurrency: 8, intervalMs: 900_000 }, fits: true },
    { name: 'the original hourly cadence at concurrency 2', a: { bite: 40, walkBudgetMs: 180_000, maxConcurrency: 2, intervalMs: 3_600_000 }, fits: true },
    { name: 'a bite raised without concurrency', a: { bite: 112, walkBudgetMs: 180_000, maxConcurrency: 24, intervalMs: 300_000 }, fits: false },
  ]
  const bad = cases.filter((c) => drainFits(c.a).fits !== c.fits)
  const cronBad = cronIntervalMs('*/5 * * * *') !== 300_000 || cronIntervalMs('*/15 * * * *') !== 900_000
    || cronIntervalMs('30 * * * *') !== 3_600_000 || cronIntervalMs('0 0,6,12,18 * * *') !== null
  if (bad.length || cronBad) {
    console.error(`[queue-drain-fits-the-interval] CANNOT RUN — the decision failed its own self-test` +
      (bad.length ? ` on ${bad.length} fixture(s): ${bad.map((c) => `${c.name} → fits=${drainFits(c.a).fits}, expected ${c.fits}`).join(' · ')}` : '') +
      (cronBad ? ` · the cron parser mis-read a known schedule form` : '') +
      `. ⛔ A BROKEN INSTRUMENT, NOT A PASS.`)
    process.exitCode = 2
    process.exit()
  }
  console.log(`[queue-drain-fits-the-interval] self-test PASS — 5/5 identity fixtures and 4/4 cron forms, including the exact configuration this guard was written to refuse (5-minute cadence at concurrency 8).`)
}

if (bite !== null && walkBudgetMs !== null && maxConcurrency !== null && intervalMs !== null) {
  const r = drainFits({ bite, walkBudgetMs, maxConcurrency, intervalMs })
  const fmt = (ms) => `${(ms / 1000).toFixed(0)}s`
  console.log(`[queue-drain-fits-the-interval] read: bite=${bite} (${RESUMER}) · ${perMsgLabel}=${walkBudgetMs} (${perMsgSource}) · maxConcurrency=${maxConcurrency} (${VERCEL}) · schedule="${schedule}" = ${fmt(intervalMs)} interval. ` +
    `worst-case drain ${bite} × ${fmt(walkBudgetMs)} ÷ ${maxConcurrency} = ${fmt(r.worstCaseMs)}.`)
  if (!r.fits) {
    findings.push(
      `⛔ THE QUEUE CANNOT DRAIN INSIDE ITS OWN FIRE INTERVAL. Worst case ${bite} × ${fmt(walkBudgetMs)} ÷ ${maxConcurrency} = ${fmt(r.worstCaseMs)}, ` +
      `against a "${schedule}" interval of ${fmt(intervalMs)} — over by ${fmt(-r.headroomMs)} (${(r.worstCaseMs / intervalMs).toFixed(2)}×). ` +
      `A fire's messages would still be draining when the next fire adds another ${bite}. ` +
      `⇒ RAISE maxConcurrency to at least ${Math.ceil((bite * walkBudgetMs) / intervalMs)}, or slow the cadence, or cut the bite — and whichever you change, change its DERIVATION in the same commit. ` +
      `Correctness is not at risk (idempotency keys dedupe re-publishes and owed-ness is derived); what breaks is every rate measurement taken from the fire log, and a runaway stops being distinguishable from a backlog.`)
  }
}

if (findings.length) {
  console.error(`[queue-drain-fits-the-interval] FAIL — ${findings.length} finding(s):`)
  for (const f of findings) console.error(`  ✗ ${f}`)
  console.error(`  ⇒ SPEC: DECISIONS LORAMER_WALK_BITE_40_V1 + LORAMER_DRAIN_FITS_THE_INTERVAL_V1. The four terms live in three files and NONE of them is retyped here — fix the source, never this guard.`)
  process.exitCode = 1
} else {
  console.log(`[queue-drain-fits-the-interval] PASS — the queue's worst-case drain fits inside the cron interval, with every term read from its own source.`)
}
