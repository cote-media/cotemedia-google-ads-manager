// LORAMER_UNIVERSE_CONSUMER_V2_V1 — THE STREAMING, DAY-RESUMABLE WALK CONSUMER.
//
// ════════════════════════════════════════════════════════════════════════════════════════════════════════
// ⛔ BLAST RADIUS — STATED PLAINLY, FIRST, BECAUSE IT IS THE FIRST THING A READER NEEDS
// ════════════════════════════════════════════════════════════════════════════════════════════════════════
// **THIS IS A NEW ROUTE ON A NEW TOPIC. The existing consumer at `/api/queues/google-ads-universe` is NOT
// edited, NOT deleted and NOT redirected.** Both exist side by side, and that is safe because Vercel Queues
// delivers by TOPIC: `universe-start/route.ts` publishes to the v1 `TOPIC` and the v1 consumer
// self-republishes to its own, so nothing on the v1 path can reach this handler.
//
// ⛔ **THE CLAIM CHANGED WHEN THE RESUMER LANDED, AND IT IS RESTATED HERE RATHER THAN LEFT STALE.** It used
// to read "no publisher anywhere in this repo sends to this topic". That is no longer true:
// `/api/cron/universe-resume` publishes to it, and it is the ONLY thing that does. The guard
// (`universe-stream-consumer.guard.mjs` leg (e)) forced this edit by failing the build the moment the
// resumer imported the topic — which is the guard working, not a nuisance.
//
// **THE INVARIANT NOW, and it is narrower rather than weaker:**
//   · the ONLY publisher to this topic is `/api/cron/universe-resume`;
//   · that route is **NOT IN `vercel.json`** — nothing invokes it on a schedule;
//   · it **DEFAULTS TO DRY-RUN** (`?dryRun=0` is required to publish at all);
//   · it is `Bearer $CRON_SECRET`-gated.
// So this handler is still reachable only by a message a human deliberately causes to exist. Scheduling the
// resumer is the act that wires the walk, and it is a separate, explicit decision.
//
// ROLLBACK is therefore "stop publishing to this topic", which is the whole of it. No data motion, no
// migration to undo. `universe_window_log` and `universe_run_state` are not written by this file at all —
// this consumer's bookkeeping lives entirely in `universe_attempt_log`.
// ════════════════════════════════════════════════════════════════════════════════════════════════════════
//
// WHAT IS DIFFERENT FROM V1, each one a settled decision rather than a preference:
//   · `queryStream`, not `query`. Buffering the whole window is what makes a kill lose everything.
//   · Rows are written AS THEY ARRIVE, ordered by `segments.date`, and a `day_committed` record is appended
//     after each day is durably upserted.
//   · Resume is DAY-GRANULAR from DERIVED coverage — `metrics_daily`, never the bookkeeping table, which was
//     measured wrong in BOTH directions on 2026-08-08.
//   · The BROKEN bound counts attempts AT THE MINIMUM WINDOW SIZE. `MAX_OPEN_ATTEMPTS = 3` as deployed in v1
//     conflates MIS-SIZED with BROKEN and would tell a customer "broken" when the truth is "we asked for too
//     much at once".
//   · Spend is charged at `attempt_started`, before the vendor call — so a hard kill is still billed and the
//     rate governor can see a poison loop forming.
import { NextResponse } from 'next/server'
import { handleCallback, send } from '@vercel/queue'
// ⛔ THE CATALOG LOADER IS DELIBERATELY NOT IMPORTED HERE, and the omission is load-bearing rather than
// tidy. The entry rides on the MESSAGE, exactly as in v1, so this route never reads
// docs/google-ads-capture-universe.json. A route that DOES read it must be listed in next.config's
// outputFileTracingIncludes alongside the artifact, or it ENOENTs on Vercel while passing every local check —
// which is how it shipped broken once already. `universe-runner.guard.mjs` leg (d) caught a dead import of it
// on this file within minutes of the file existing; that guard is the reason this comment is here.
import { VENDOR_FLOOR_DATE, type UniverseEntry } from '@/lib/backfill/google-ads-universe-writer'
import { captureSurfaceStreaming, serializeVendorError } from '@/lib/backfill/universe-stream-capture'
// ⛔ THE ADAPTER SUPPLIES EVERY GOOGLE FACT THE CORE USED TO HOLD: the GAQL, the ORDER BY, the retention
// floor, the operations meter, the sizing policy AND its cost direction, and the day-closure entitlement.
// This route now contains no vendor constant at all — `capture-adapter-seam.guard.mjs` enforces that.
import { googleAdsCaptureAdapter, surfaceOfEntry } from '@/lib/backfill/capture-adapters/google-ads.adapter'
import { mayFetch } from '@/lib/backfill/capture-adapter'
import { rangesStillOwed } from '@/lib/backfill/universe-coverage'
import { appendAttemptStarted, appendDayCommitted, appendAttemptFinished, readAttemptsAtSpan, readAttemptLaneSpendToday, type AttemptKey } from '@/lib/backfill/universe-attempt-log'
import { sizeNextWindow, dayDiff } from '@/lib/backfill/universe-sizing'
import { checkDiskFloor } from '@/lib/backfill/universe-window-log'
import { googleAdsStreamFor } from '@/lib/backfill/universe-vendor-stream'
// ⛔ THE TOPIC, THE MESSAGE SHAPE AND THE TWO BOUNDS LIVE IN A CONTRACT MODULE, NOT HERE. Next.js rejects
// any non-Route export from a route file ("TOPIC is not a valid Route export field") — and `tsc --noEmit`
// passes it clean, so only `npm run build` catches it. It is also the right shape: a publisher needs the
// topic and the message type without dragging a handler and its maxDuration into scope.
import { TOPIC, VENDOR, MAX_ATTEMPTS_AT_MIN_SPAN, NARROW_AFTER_ATTEMPTS, type UniverseMessageV2 } from '@/lib/backfill/universe-v2-contract'

export const dynamic = 'force-dynamic'
export const fetchCache = 'force-no-store'
export const maxDuration = 300

const addDays = (iso: string, n: number) => {
  const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10)
}

async function publishGoverned(
  adapter: ReturnType<typeof googleAdsCaptureAdapter>, next: UniverseMessageV2, days: number, idempotencyKey: string,
): Promise<{ published: boolean; reason: string }> {
  // ⛔ THE METER IS THE ADAPTER'S, IN THE ADAPTER'S OWN UNIT, AND AN UNREADABLE ONE HOLDS. There is no
  // shared constant on this path: `cap` and `costOf(days)` both come from the adapter, so nothing here can
  // be tuned into meaning "operations" — which is exactly what would break on GA4 tokens or Meta's BUC
  // percentage across three simultaneous meters.
  const gate = await mayFetch(adapter, days)
  if (!gate.ok) return { published: false, reason: gate.reason }
  await send(TOPIC, next satisfies UniverseMessageV2, { idempotencyKey } as any)
  return { published: true, reason: gate.reason }
}

// ⛔ THE CAST IS TYPE-ONLY AND IT IS NOT COSMETIC — READ THE REASON BEFORE REMOVING IT.
// `handleCallback` returns a handler whose first parameter is @vercel/queue's `CallbackRequestInput`
// (`{ request: Request }`), and Next's generated Route validator demands `Request | NextRequest`:
//   Type "CallbackRequestInput" is not a valid type for the function's first argument.
// At RUNTIME the shapes agree — Vercel Queues delivers by POSTing to this route, and `handleCallback` is
// what unwraps the message — so this is a declaration mismatch, not a behavioural one.
// ⚠ AND THE PART WORTH RECORDING: **the v1 consumer has the identical export and builds green**, because
// Next regenerates route validators only for routes that CHANGED. `.next/types/app/api/queues/` held a
// validator for v2 and none for v1 after a clean `rm -rf .next/types`. So v1 is not proven compliant — it
// is UNCHECKED, and would surface the same error the day it is edited. That is a latent trap for whoever
// touches it next, not a difference in correctness.
const handler = handleCallback(async (msg: UniverseMessageV2, _metadata: any) => {
  const { clientId, userEmail, customerId, entry, startDate, endDate } = msg
  const label = `${entry.resource}${entry.segment ? ' / ' + entry.segment : ''}`
  const floorDate = msg.floorDate ?? VENDOR_FLOOR_DATE
  // ⛔ THE ADAPTER IS CONSTRUCTED PER INVOCATION with the vendor stream it needs. Nothing about Google is
  // reachable from the core; the core only ever sees `adapter.*`.
  const streamFor = await googleAdsStreamFor(userEmail, customerId)
  const surface = surfaceOfEntry(entry)
  const adapter = googleAdsCaptureAdapter(streamFor, () => entry)
  const grain = { entityLevel: surface.entityLevel, breakdownType: surface.breakdownType }
  const MIN_WINDOW_DAYS = adapter.sizing.minDays
  const key: AttemptKey = {
    clientId, vendor: adapter.platform, resource: surface.resource, segment: surface.segment,
    windowStart: startDate, windowEnd: endDate,
  }

  // ══ 1 · WHAT IS STILL OWED — THE ONLY QUESTION, AND IT IS ASKED OF THE WAREHOUSE ══════════════════════
  // ⛔ THE WALK DECISION PATH READS **ONLY** THE COVERAGE MODULE. Not `universe_window_log`, not the attempt
  // log's outcomes. v1's resume asked the bookkeeping table whether a window was "finished"; on 2026-08-08
  // that table was measured wrong in BOTH directions on the very range it was consulted about.
  const owed = await rangesStillOwed(
    { clientId, platform: adapter.platform, entityLevel: grain.entityLevel, breakdownType: grain.breakdownType },
    startDate, endDate,
  )
  console.log(`[universe-v2] ${clientId} ${label} ${startDate}..${endDate}: ` +
    `${owed.coverage.covered.length} covered · ${owed.coverage.attestedEmpty.length} attested-empty · ` +
    `${owed.coverage.uncovered.length} owed in ${owed.ranges.length} range(s) · ${owed.coverage.probes} probes / ${owed.coverage.ms}ms`)

  if (owed.ranges.length === 0) {
    // ⛔ NOTHING OWED MEANS ADVANCE, NEVER STOP. v1's first version of this branch was a bare `return` and it
    // KILLED THE WALK ON MESSAGE ONE — 346 messages all landed on an already-walked window, all returned
    // early, and none re-published. The starter reported "started: true, published: 346" and the chain was
    // already dead. **A resume that does not advance is indistinguishable from one that worked, right up
    // until nothing happens.**
    const adv = await advance(msg, adapter, floorDate, 'already covered — nothing owed in this window')
    console.log(`[universe-v2] ADVANCE ${clientId} ${label}: ${JSON.stringify(adv)}`)
    return
  }

  // ══ 2 · THE DISK FLOOR, BEFORE ANY REQUEST IS SPENT ═══════════════════════════════════════════════════
  const floor = await checkDiskFloor()
  if (!floor.ok) {
    await appendAttemptFinished(key, await nextAttemptNoWithoutCharging(key), 'floor_stop',
      { rowsWritten: 0, requestsSpent: 0, diskFreeBytes: floor.freeBytes, error: floor.reason })
    console.error(`[universe-v2] FLOOR STOP ${clientId} ${label}: ${floor.reason}`)
    // ⛔ NO RE-PUBLISH. The lane goes quiet rather than hammering a full volume.
    return
  }

  // ══ 3 · THE BOUND — READ BEFORE CHARGING, AND EVALUATED AT THE SPAN ═══════════════════════════════════
  const spanDays = dayDiff(startDate, endDate) + 1
  const attemptsHere = await readAttemptsAtSpan(key)
  if (spanDays <= MIN_WINDOW_DAYS && attemptsHere >= MAX_ATTEMPTS_AT_MIN_SPAN) {
    // ⛔ **BROKEN**, and only here. One day of one entry could not complete in 300 seconds across
    // MAX_ATTEMPTS_AT_MIN_SPAN tries. There is nothing left to narrow, so this escalates to a human rather
    // than looping. The days stay UNCOVERED and derived owed-ness means the resumer will find them again —
    // self-healing, without anyone naming a row id.
    await appendAttemptFinished(key, attemptsHere + 1, 'abandoned_owed', {
      rowsWritten: 0, requestsSpent: 0, diskFreeBytes: floor.freeBytes,
      error: `BROKEN: ${attemptsHere} attempt(s) at the ${MIN_WINDOW_DAYS}-day minimum span. Not mis-sized — there is nothing left to narrow.`,
    })
    console.error(`[universe-v2] BROKEN ${clientId} ${label} ${startDate}..${endDate} — ${attemptsHere} attempt(s) at the ${MIN_WINDOW_DAYS}-day minimum. Escalate.`)
    return
  }
  if (spanDays > MIN_WINDOW_DAYS && attemptsHere >= NARROW_AFTER_ATTEMPTS) {
    // ⛔ **MIS-SIZED**, which is a completely different verdict and gets a completely different remedy:
    // re-publish this same ground at HALF the span. Nothing is abandoned and nobody is told anything is
    // broken, because nothing is.
    const half = Math.max(MIN_WINDOW_DAYS, Math.floor(spanDays / 2))
    const narrowedEnd = addDays(startDate, half - 1)
    const pub = await publishGoverned(adapter,
      { ...msg, startDate, endDate: narrowedEnd }, half,
      `${clientId}|${entry.resource}|${entry.segment ?? ''}|${startDate}|${narrowedEnd}|narrow`,
    )
    await appendAttemptFinished(key, attemptsHere + 1, 'skipped', {
      rowsWritten: 0, requestsSpent: 0, diskFreeBytes: floor.freeBytes,
      error: `MIS-SIZED, not broken: ${attemptsHere} attempt(s) at ${spanDays} days. Re-published at ${half} day(s). ${pub.reason}`,
    })
    console.log(`[universe-v2] MIS-SIZED ${clientId} ${label}: ${spanDays}d → ${half}d, published=${pub.published} (${pub.reason})`)
    return
  }

  // ══ 4 · WALK THE OWED RANGES, STREAMING, COMMITTING A DAY AT A TIME ═══════════════════════════════════
  let totalRows = 0, totalApi = 0, requests = 0
  const daysCommitted: string[] = []
  let lastError: string | null = null
  let orderViolation = false

  for (const range of owed.ranges) {
    const rangeKey: AttemptKey = { ...key, windowStart: range.start, windowEnd: range.end }
    // ⛔ THE ATTEMPT IS OPENED **BEFORE** THE VENDOR IS CALLED, AND THE REQUEST IS CHARGED HERE. v1 wrote
    // `requests_spent` only on close, so a killed invocation left 0 and burned quota INVISIBLY to the rate
    // governor — which is exactly how three poison loops persisted. This ordering is the fix.
    const opened = await appendAttemptStarted(rangeKey, 1)
    requests++
    try {
      const res = await captureSurfaceStreaming({
        adapter, surface,
        ctx: { clientId, userEmail, accountId: customerId },
        startDate: range.start, endDate: range.end,
        onDayCommitted: (day: string, rows: number) => appendDayCommitted(rangeKey, opened.attemptNo, day, rows),
      })
      totalRows += res.rowsWritten
      totalApi += res.apiRows
      daysCommitted.push(...res.daysCommitted)
      orderViolation = orderViolation || res.orderViolation
      lastError = res.error ?? lastError
      // ⛔ `zero` MEANS THE VENDOR ANSWERED AND NAMED NOTHING — a FACT about the data, and the only thing
      // that makes a dormant day distinguishable from a day never asked. `ok` at zero rows is NOT the same
      // claim (queue ★WALK-OK-MEANS-ZERO: 556 rows in the old log confused exactly these two), so the
      // outcome is derived from the count rather than hand-set.
      const outcome = res.error ? 'error' : res.skipped ? 'skipped' : res.apiRows === 0 ? 'zero' : 'ok'
      await appendAttemptFinished(rangeKey, opened.attemptNo, outcome, {
        rowsWritten: res.rowsWritten, requestsSpent: 1, diskFreeBytes: floor.freeBytes,
        error: res.error ?? (res.orderViolation ? 'ORDER VIOLATION: the vendor returned a row for an already-committed day, so this attempt\'s day commits do not prove closure' : res.skipped ? res.skipped.requirement : null),
      })
    } catch (e: any) {
      lastError = serializeVendorError(e)
      await appendAttemptFinished(rangeKey, opened.attemptNo, 'error',
        { rowsWritten: 0, requestsSpent: 1, diskFreeBytes: floor.freeBytes, error: lastError })
    }
  }

  console.log(`[universe-v2] ${clientId} ${label}: ${totalApi} api rows → ${totalRows} written across ` +
    `${daysCommitted.length} committed day(s), ${requests} request(s)${orderViolation ? ' ⚠ ORDER VIOLATION' : ''}${lastError ? ` — ${lastError}` : ''}`)

  const adv = await advance(msg, adapter, floorDate,
    `walked ${owed.ranges.length} owed range(s): ${totalRows} rows, ${daysCommitted.length} day(s) committed`)
  console.log(`[universe-v2] ADVANCE ${clientId} ${label}: ${JSON.stringify(adv)}`)
  return
})

export const POST = handler as unknown as (req: Request) => Promise<Response>

/**
 * ⛔ THE ONLY PLACE THE WALK ADVANCES. Both callers use it — the nothing-owed path and the after-capture
 * path — because v1's resume branch originally had no advance at all and killed the walk on message one.
 *
 * Order is load-bearing: BOUND (were we asked for another window) → FLOOR (is there ground left below the
 * vendor wall) → SIZE (how much to ask for) → GOVERNOR (may we afford it).
 */
async function advance(msg: UniverseMessageV2, adapter: ReturnType<typeof googleAdsCaptureAdapter>, floorDate: string, why: string) {
  const { clientId, entry, startDate } = msg
  const remaining = msg.windowsRemaining
  if (remaining !== undefined && remaining <= 1) {
    return { ok: true, advanced: false, reason: `bounded run exhausted (windowsRemaining=${remaining})`, why }
  }
  // ⛔ THE VENDOR FLOOR. Below it Google serves nothing, so walking past it spends quota to learn what the
  // artifact already recorded. ⚠ `VENDOR_FLOOR_DATE` is Foam OH's MEASURED floor and is per-account; the
  // universal replacement is the documented 37-month wall, carried on the message as `floorDate`.
  const nextEnd = addDays(startDate, -1)
  if (nextEnd < floorDate) {
    return { ok: true, advanced: false, reason: `floor reached — next window would end ${nextEnd}, below ${floorDate}`, why }
  }
  // ⛔ SIZE ON MAX, REPORT PREV. Under-prediction is the direction that costs a request; over-prediction
  // costs a window that finishes early. See universe-sizing.ts for the measurement that ranked them.
  const sizing = await sizeNextWindow(adapter, { clientId, resource: entry.resource, segment: entry.segment ?? '' })
  const nextStart = (() => {
    const s = addDays(nextEnd, -(sizing.days - 1))
    return s < floorDate ? floorDate : s
  })()
  const pub = await publishGoverned(adapter,
    { ...msg, startDate: nextStart, endDate: nextEnd,
      ...(remaining !== undefined ? { windowsRemaining: remaining - 1 } : {}) },
    sizing.days,
    `${clientId}|${entry.resource}|${entry.segment ?? ''}|${nextStart}|${nextEnd}`,
  )
  return {
    ok: true, advanced: pub.published, why,
    next: { startDate: nextStart, endDate: nextEnd, days: sizing.days },
    sizing: { basis: sizing.basis, sizedOnRowsPerDay: sizing.sizedOnRowsPerDay, estimateRowsPerDay: sizing.estimateRowsPerDay, reason: sizing.reason },
    governor: pub.reason,
  }
}

/**
 * The attempt number for a path that will NOT call the vendor (floor stop). It reads rather than opens, so
 * the request is not charged for work that never happens — dispatch cost is 0 on these paths and billing one
 * would be the mirror image of v1's defect, over-counting instead of under-counting.
 */
async function nextAttemptNoWithoutCharging(key: AttemptKey): Promise<number> {
  return (await readAttemptsAtSpan(key)) + 1
}

// ⛔ NO `GET` HERE, AND THE REASON IS A BUILD FACT WORTH RECORDING. An informational GET was written first;
// adding it made Next generate a full Route validator for this file, which then rejected the POST that
// `handleCallback` produces:
//   Type '{ __tag__: "POST"; __param_position__: "first"; __param_type__: CallbackRequestInput; }'
//   does not satisfy the constraint 'ParamCheck<Request | NextRequest>'
// The v1 consumer has no GET either and is therefore never validated that way. **`npx tsc --noEmit` passed
// the file at every step of this; only `npm run build` found it — twice, for two different reasons.**
// The wiring facts a GET would have reported are asserted mechanically by
// `tests/guards/universe-stream-consumer.guard.mjs` leg (e), which is a better home for them anyway: a
// guard fails the build, an endpoint has to be visited by someone who already suspects something.
