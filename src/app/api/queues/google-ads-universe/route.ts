// LORAMER_GOOGLE_ADS_UNIVERSE_RUNNER_V1 — THE CONSUMER. ONE MESSAGE = ONE CLIENT × ONE ENTRY × ONE WINDOW.
//
// ⛔ WIRED, NOT FIRED. This route is a Vercel Queues consumer (`queue/v2beta` trigger in vercel.json), which
// makes it PRIVATE — it has no public URL and only Vercel's queue infrastructure can invoke it. With ZERO
// messages published it never runs. There is deliberately NO cron entry for this path: a cron would fire it,
// and this flight ships wired but not fired.
//
// ⛔ NO FIFO. Vercel Queues gives no ordering guarantee, so every message carries its FULL context and no
// handler may assume what ran before it. Delivery is AT-LEAST-ONCE, so the handler must be IDEMPOTENT —
// see the note on the upsert below, which is where that property actually lives.
//
// ⛔ RETENTION IS 24h BY DEFAULT (60s–7d max). A walk to 2022-03-05 is ~50 months and will outlive any TTL,
// so the whole walk is NEVER pre-published. THE PATTERN IS SELF-RE-PUBLISH: each message captures ONE window
// and, only if the vendor still had rows, publishes the NEXT window before acknowledging. The queue therefore
// holds O(1) messages per client instead of O(months), and no message ever waits long enough to expire.
import { NextResponse } from 'next/server'
import { handleCallback, send } from '@vercel/queue'
import { loadUniverse, captureUniverseEntry, refusalStamp, VENDOR_FLOOR_DATE, selectableEntries, catalogEligibleEntries, excludedFromWalk, type UniverseEntry } from '@/lib/backfill/google-ads-universe-writer'
import { recordEntryOutcome, readAllEntryStates, readEntryState, isClientComplete, writeCompletionNotice } from '@/lib/backfill/universe-run-state'
import { decidePublishFleetAware } from '@/lib/backfill/universe-governor'
// LORAMER_UNIVERSE_WINDOW_LOG_V1 — durable per-window progress, the hard disk floor, and the
// governor's CORRECTED spend read. See the module header for what each replaces and why.
import {
  checkDiskFloor, openWindow, closeWindow, readLaneSpendToday, windowAlreadyFinished, shouldRepublish, gb,
  type WindowKey, type WindowOutcome,
} from '@/lib/backfill/universe-window-log'

export const dynamic = 'force-dynamic'
// ⛔ LORAMER_NO_CACHED_DB_READ_V1 — this route reads google_tokens / platform_connections, and a read that
// GATES A WRITE may never be served from Next's Data Cache. A stale refresh token on an UNATTENDED 3am queue
// consumer is the exact silent failure: the fetch fails auth, the message retries, and nothing looks broken.
export const fetchCache = 'force-no-store'
export const maxDuration = 300

export const TOPIC = 'google-ads-universe'
/** Window size per message. Small enough that one message is one cheap request; the walk is the loop. */
export const WINDOW_DAYS = 30

/**
 * ⛔ HOW MANY DIED INVOCATIONS A SINGLE WINDOW MAY COST BEFORE IT IS ABANDONED AS OWED.
 * ⛔ THIS NUMBER IS OURS, NOT A VENDOR CONSTANT. Vercel Queues publishes no max-attempts and no dead-letter
 * queue — retries run until the message TTL expires — so the bound has to be one we count. The DLQ literature
 * gives 2–5 attempts as general guidance and argues for the LOW end on expensive/paid-API work; 3 sits inside
 * that and is a choice, not a measurement. Each attempt costs a full maxDuration of function time and one
 * Google Ads request.
 */
export const MAX_OPEN_ATTEMPTS = 3

export interface UniverseMessage {
  clientId: string
  userEmail: string
  customerId: string
  entry: UniverseEntry
  /** Inclusive window this message must capture. The message carries it — nothing is inferred from order. */
  startDate: string
  endDate: string
  /**
   * ⛔ LORAMER_UNIVERSE_BOUNDED_RUN_V1 — HOW MANY WINDOWS THIS CHAIN MAY STILL WALK, INCLUDING THIS ONE.
   * UNDEFINED means unbounded, which is the original behaviour and stays the default.
   *
   * WHY IT EXISTS: this consumer SELF-RE-PUBLISHES its next window, which is what keeps the queue at O(1)
   * messages — and it means "fire one window" is not expressible without a bound. Firing the starter would
   * publish 346 messages, each of which would publish its own next window, and the walk would run until the
   * governor or the disk floor stopped it. "One window is a proof; fifty is a commitment" (Russ, 2026-08-04)
   * cannot be honoured by intention alone; it needs a number that travels WITH the message.
   * ⛔ IT RIDES ON THE MESSAGE, NOT IN A CONFIG. Vercel Queues gives no ordering and at-least-once delivery,
   * so a bound held anywhere else could not be trusted by a handler that must assume nothing about what ran
   * before it — the same reason every message already carries its own full window.
   */
  windowsRemaining?: number
  /**
   * ⛔ LORAMER_UNIVERSE_FAILURE_IS_DURABLE_V1 — HOW MANY DAYS THIS WINDOW AND ITS SUCCESSORS COVER.
   * UNDEFINED means WINDOW_DAYS, which is the original behaviour and stays the default — the same posture
   * `windowsRemaining` above takes, and the reason an OLD-shape message published before this field existed
   * cannot break: `handleCallback` performs NO runtime validation (UniverseMessage is a TypeScript interface,
   * erased at build), so an absent field arrives as `undefined` and hits the `?? WINDOW_DAYS` default.
   *
   * WHY IT RIDES ON THE MESSAGE: when a window dies at 30 days it is re-published AS ITSELF at half length,
   * and the successor must inherit the smaller size. Derived from the module constant instead, the remedy
   * would survive exactly one hop and then re-enter the size that killed it.
   */
  windowDays?: number
}

const addDays = (iso: string, n: number) => {
  const d = new Date(`${iso}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10)
}


/**
 * ⛔ THE ONLY PLACE A MESSAGE IS PUBLISHED. Every caller goes through here — the normal successor AND the
 * halved re-publish after a death — and the reason is not tidiness: a second `send` call site is a second
 * place the GOVERNOR can be forgotten, and the walk has already been through one incident where a duplicated
 * advance path lost the governor, the bound and the stand-down record. `universe-window-log.guard.mjs` leg
 * (i) pins the single call site, and it CAUGHT exactly that mistake in this flight.
 *
 * ⛔ A HOLD IS RECORDED AS `quota_stop`, NEVER SILENTLY DROPPED — the window we decline to publish gets a row
 * carrying the governor's own arithmetic, so "the walk stood down" is queryable rather than inferred from
 * absence. `quota_stop` does NOT settle the entry, so a walk that yielded all day still reads as OWED.
 */
async function publishGoverned(a: {
  msg: UniverseMessage; clientId: string; label: string; entry: UniverseEntry
  startDate: string; endDate: string; windowDays?: number
  windowsRemaining?: number; idempotencyKey: string
}): Promise<boolean> {
  const { msg, clientId, label, entry, startDate, endDate, windowDays, windowsRemaining, idempotencyKey } = a
  // ⛔ SPEND COMES FROM THE WINDOW LOG, NOT universe_run_state (whose per-entry counter is CUMULATIVE and
  // billed day 2 for day 1). ⛔ LORAMER_BACKFILL_YIELDS_TO_PRODUCT_V1 — the FLEET decides, not just this lane;
  // readGoogleSpendToday() is READ from google-op-budget (unmodified), and a null reading HOLDS.
  const { readGoogleSpendToday } = await import('@/lib/backfill/google-op-budget')
  const gov = decidePublishFleetAware({
    spentRequestsToday: await readLaneSpendToday(),
    fleet: await readGoogleSpendToday(),
    want: 1,
  })
  if (gov.mayPublish) {
    // ⛔ IDEMPOTENCY KEY: a redelivered message must not fan out a second walk.
    await send(TOPIC, {
      ...msg, startDate, endDate,
      ...(windowDays !== undefined ? { windowDays } : {}),
      ...(windowsRemaining !== undefined ? { windowsRemaining } : {}),
    } satisfies UniverseMessage, { idempotencyKey } as any)
    return true
  }
  // ⛔ NO SILENT SUCCESS AND NO SILENT SKIP. Dispatch cost 0 — the vendor is not called on this path.
  const held: WindowKey = { clientId, resource: entry.resource, segment: entry.segment, windowStart: startDate, windowEnd: endDate }
  const disk = await checkDiskFloor()
  await openWindow(held, disk.freeBytes, 0)
  await closeWindow(held, { outcome: 'quota_stop', rowsWritten: 0, requestsSpent: 0, refusedRows: 0, error: gov.reason })
  console.log(`[universe] STAND-DOWN ${clientId} ${label} ${startDate}..${endDate}: ${gov.reason}`)
  return false
}

/**
 * ⛔ THE ONLY PLACE THE WALK ADVANCES. Both callers use it: the fresh-window path after a capture, and the
 * already-finished path when resuming over ground we have covered. Keeping ONE implementation is not tidiness
 * — the resume path originally had no advance at all and killed the walk on message one.
 *
 * Order is load-bearing: BOUND first (were we asked for another window), then FLOOR (is there ground left),
 * then GOVERNOR (may we afford one) — the last of which now lives in publishGoverned above.
 */
async function advanceToNextWindow(a: {
  msg: UniverseMessage; clientId: string; label: string; startDate: string; entry: UniverseEntry
}): Promise<void> {
  const { msg, clientId, label, startDate, entry } = a
  const bound = shouldRepublish({ stillGoing: true, windowsRemaining: msg.windowsRemaining })
  if (!bound.republish) {
    console.log(`[universe] NOT RE-PUBLISHING ${clientId} ${label}: ${bound.reason}`)
    return
  }
  // ⛔ THE SIZE COMES FROM THE MESSAGE, NOT THE MODULE CONSTANT (LORAMER_UNIVERSE_FAILURE_IS_DURABLE_V1).
  // A window halved after a death must hand its smaller size to its successor, or the remedy lasts one hop.
  const windowDays = msg.windowDays ?? WINDOW_DAYS
  const nextEnd = addDays(startDate, -1)
  const nextStart = addDays(nextEnd, -(windowDays - 1))
  // ⛔ THE VENDOR FLOOR. Below it Google serves nothing, so walking past it spends quota to learn what the
  // artifact already recorded. The writer still owns the EXHAUSTION verdict; this only stops the publish.
  if (nextEnd < VENDOR_FLOOR_DATE) {
    // ⛔ THE SEAL IS WRITTEN HERE, AND ITS ABSENCE WAS THE DEFECT. This branch used to `return` having written
    // NOTHING — no window row, no entry state — because the seal was only ever written by the WRITER's
    // exhaustion verdict, which requires ZERO rows at/below the floor. Any entry whose deepest window returned
    // rows therefore exited unsealed FOREVER: measured 2026-08-08 at 253 unsealed of 346, of which 249 had
    // ALREADY walked to at or below the floor. It is also why `universe_run_notice` had never been written —
    // isClientComplete cannot settle an entry that nothing ever seals.
    // ⛔ REUSING recordEntryOutcome RATHER THAN ADDING A SECOND SEAL WRITER IS DELIBERATE: two writers for one
    // verdict is how the walk got two definitions of "done" in the first place.
    await recordEntryOutcome({
      key: { clientId, resource: entry.resource, segment: entry.segment },
      cursorDate: startDate,
      exhaustion: {
        complete: true,
        exhaustedBelow: startDate,
        proof: `PUBLISH-SIDE FLOOR REACHED: the next window would end ${nextEnd}, below the measured vendor floor ${VENDOR_FLOOR_DATE}. This entry walked its full reachable range and stopped BY DESIGN — not by failure, and not by the vendor returning zero.`,
      },
      observedZero: false,
      skippedReason: null,
      rowsWritten: 0,
      requestsSpent: 0,
      error: null,
    })
    console.log(`[universe] FLOOR REACHED ${clientId} ${label}: next window would end ${nextEnd}, below the ${VENDOR_FLOOR_DATE} vendor floor — sealed and not publishing`)
    return
  }
  await publishGoverned({
    msg, clientId, label, entry,
    startDate: nextStart, endDate: nextEnd,
    windowDays: msg.windowDays,
    windowsRemaining: bound.nextWindowsRemaining,
    idempotencyKey: `${clientId}|${label}|${nextStart}`,
  })
}

export const POST = handleCallback(async (msg: UniverseMessage, metadata: any) => {
  const { clientId, userEmail, customerId, entry, startDate, endDate } = msg
  const label = `${entry.resource}${entry.segment ? '/' + entry.segment : ''}`

  const wk: WindowKey = { clientId, resource: entry.resource, segment: entry.segment, windowStart: startDate, windowEnd: endDate }

  // ── RESUME: NEVER RE-WALK A FINISHED WINDOW ──────────────────────────────────────────────────────────────
  // ⛔ TERMINAL OUTCOMES ONLY. A row reading `running` is a window that DIED, not one that finished, so it
  // falls through and is walked again. Delivery is at-least-once, so this is also the cheap path for a
  // redelivered message: it costs one indexed read instead of one vendor request.
  // ⛔ ALREADY-FINISHED MEANS SKIP THE WORK AND ADVANCE — NEVER STOP. The first version of this branch was a
  // bare `return`, and it KILLED THE WALK ON MESSAGE ONE: releasing the full walk publishes 346 messages at
  // the most recent window, that window had already been walked as the proof run, so all 346 returned early
  // and NONE re-published. The starter reported "started: true, published: 346" and the chain was already
  // dead. ⛔ A RESUME THAT DOES NOT ADVANCE IS INDISTINGUISHABLE FROM A RESUME THAT WORKED, right up until
  // nothing happens — which is the silent-success failure this runner exists to avoid.
  if (await windowAlreadyFinished(wk)) {
    console.log(`[universe] ALREADY-FINISHED ${clientId} ${label} ${startDate}..${endDate} — advancing without re-walking`)
    // The entry's vendor-exhaustion seal is the ONLY thing that may end a walk (the writer owns that verdict).
    // If this entry is sealed we stop; otherwise we continue from here exactly as a fresh window would.
    const prior = await readEntryState({ clientId, resource: entry.resource, segment: entry.segment })
    const sealed = !!prior?.vendor_exhausted_below
    if (sealed) {
      console.log(`[universe] ${clientId} ${label} is vendor-exhausted below ${prior?.vendor_exhausted_below} — walk complete for this entry`)
      return
    }
    await advanceToNextWindow({ msg, clientId, label, startDate, entry })
    return
  }

  // ── ⛔ THE HARD DISK FLOOR, CHECKED BEFORE EVERY WINDOW AND BEFORE SPENDING THE REQUEST ───────────────────
  // The measured cost is +4.53 GB per window. This is not a precaution against an unlikely event — at
  // 49 GB of headroom the walk REACHES the floor around window 11 of 50 by arithmetic. Below the floor the
  // walk stops CLEANLY, records WHY, and does NOT re-publish: no next message, so the lane goes quiet
  // instead of hammering a full volume.
  const floor = await checkDiskFloor()
  if (!floor.ok) {
    // ⛔ DISPATCH COST 0 — the vendor is not called on this path, so it must not be billed for one.
    await openWindow(wk, floor.freeBytes, 0)
    await closeWindow(wk, { outcome: 'floor_stop', rowsWritten: 0, requestsSpent: 0, refusedRows: 0, error: floor.reason })
    console.error(`[universe] FLOOR STOP ${clientId} ${label} ${startDate}..${endDate}: ${floor.reason}`)
    return
  }

  // ⛔ OPENED AS `running` BEFORE THE VENDOR IS CALLED, AND THE SPEND IS RECORDED AT DISPATCH. A process
  // killed mid-request leaves this row reading `running`, which is the failure it actually is — and now it
  // also leaves the request COUNTED, which is what the rate governor could never see before.
  const attempts = await openWindow(wk, floor.freeBytes)

  // ── ⛔ THE RETRY BOUND. THE DEAD-LETTER QUEUE VERCEL DOES NOT GIVE US. ────────────────────────────────────
  // Vercel Queues has NO DLQ and retries until the message TTL expires; the only bound available is one we
  // count ourselves. `attempts > 1` means a PREVIOUS invocation opened this window and died without closing
  // it — and ONLY that, because the RPC charges an attempt exclusively when the prior outcome was `running`
  // (quota_stop and floor_stop are the governor and the disk floor working, and never count).
  //
  // ⛔ REACTIVE ONLY, AND THE NUMBERS SAY SO. Measured across 17,819 finished windows: 99.58% complete inside
  // 25% of the ceiling, p50 0.7s, and only THREE rows have ever crossed 75%. A proactive "halve the successor
  // if the parent ran long" rule was tested against the only three deaths on record and got 1 of 3 recall
  // with a false positive — because elapsed is a measurement of the PARENT's row count (seasonal ad volume,
  // 115k → 619k → 148k between adjacent months), and a quantity that is not autocorrelated cannot forecast
  // itself. The window immediately before the first death was a ZERO that finished in 0.5s.
  if (attempts > 1) {
    const prevDays = msg.windowDays ?? WINDOW_DAYS
    const half = Math.max(1, Math.floor(prevDays / 2))
    if (attempts >= MAX_OPEN_ATTEMPTS || half >= prevDays) {
      // ⛔ OWED, NOT `error`. `error` means "asked and failed"; this means "we STOPPED ASKING and this window
      // is still owed", and the distinction is what makes every orphan the system has ever created findable
      // by one query. The first two orphans were stored as `error` and were invisible to their own owed-list.
      await closeWindow(wk, {
        outcome: 'abandoned_owed', rowsWritten: 0, requestsSpent: 0, refusedRows: 0,
        error: `ABANDONED OWED after ${attempts} died invocation(s) at windowDays=${prevDays}${half >= prevDays ? ' (already at the 1-day floor — cannot halve further)' : ''}. NOT captured. Re-walk it deliberately; nothing will pick it up on its own.`,
      })
      console.error(`[universe] ABANDONED OWED ${clientId} ${label} ${startDate}..${endDate} after ${attempts} attempt(s) at windowDays=${prevDays}`)
      return
    }
    // ⛔ THE SAME WINDOW, RE-PUBLISHED AS ITSELF AT HALF LENGTH — ONE MESSAGE, ONE SUCCESSOR. The END is kept
    // and the START moves forward, so the uncovered older half is exactly what this window's own successor
    // will cover at the new smaller size. Splitting into TWO messages was considered and REJECTED: the
    // successor is derived from startDate, so both halves would advance and every split would leave two
    // overlapping backward chains that never merge.
    const retryStart = addDays(endDate, -(half - 1))
    await closeWindow(wk, {
      outcome: 'skipped', rowsWritten: 0, requestsSpent: 0, refusedRows: 0,
      error: `not asked at windowDays=${prevDays}: a previous invocation died on this window. Re-published as ${retryStart}..${endDate} at windowDays=${half}; the remainder is covered by that window's own successor.`,
    })
    // ⛔ THROUGH THE GOVERNOR, LIKE EVERY OTHER PUBLISH. A retry is still a vendor request, and the first
    // draft of this branch called send() directly — universe-window-log.guard.mjs leg (i) caught it as a
    // second call site, which is exactly the class it was written for.
    const republished = await publishGoverned({
      msg, clientId, label, entry,
      startDate: retryStart, endDate, windowDays: half,
      windowsRemaining: msg.windowsRemaining,
      idempotencyKey: `${clientId}|${label}|${retryStart}|w${half}`,
    })
    console.warn(`[universe] HALVED ${clientId} ${label} ${startDate}..${endDate} died at windowDays=${prevDays} → ${republished ? `re-published ${retryStart}..${endDate} at windowDays=${half}` : 'governor held the re-publish; recorded as quota_stop and still owed'}`)
    return
  }

  // ⛔ THE QUERY IS INJECTED, NOT IMPORTED HERE. Flight 1's writer takes `query` as a parameter precisely so
  // it stays drivable with no network; the vendor client is constructed by the caller below.
  const { googleAdsQueryFor } = await import('@/lib/backfill/universe-vendor-client')

  let result: Awaited<ReturnType<typeof captureUniverseEntry>>
  try {
    const query = await googleAdsQueryFor(userEmail, customerId)
    result = await captureUniverseEntry({
      entry, ctx: { clientId, userEmail, customerId }, startDate, endDate, query,
    })
  } catch (e) {
    // ⛔ A THROW MUST REACH AN OUTCOME. Without this the row would stay `running` forever and the walk
    // would look mid-flight when it had already failed. `running` is reserved for processes that DIED,
    // not for ones that returned an error we could see.
    const message = e instanceof Error ? e.message : String(e)
    await closeWindow(wk, { outcome: 'error', rowsWritten: 0, requestsSpent: 1, refusedRows: 0, error: message.slice(0, 500) })
    throw e
  }

  // ⛔ THE OUTCOME IS CHOSEN EXPLICITLY, NEVER INFERRED FROM rows>0. Zero rows can mean the vendor answered
  // and named nothing ('zero' — a FACT) or that we never asked ('skipped'); no later inspection of the row
  // count can tell those apart, which is precisely why they are decided here and written down.
  const outcome: WindowOutcome =
    result.error ? 'error' : result.skipped ? 'skipped' : result.observedZero ? 'zero' : 'ok'
  // Every row of a partial entry carries the refusal stamp, so the count is exact rather than sampled.
  const refusedRows = refusalStamp(entry) ? result.rowsWritten : 0
  await closeWindow(wk, {
    outcome,
    rowsWritten: result.rowsWritten,
    requestsSpent: result.gaql ? 1 : 0,
    refusedRows,
    error: result.error,
  })

  // ⛔ IDEMPOTENCY LIVES IN THE UPSERT, NOT IN A FLAG. captureUniverseEntry writes through
  // upsertMetricsChunked, which conflicts on the 7-column natural key
  // (client_id, platform, entity_level, entity_id, date, breakdown_type, breakdown_value). A redelivered
  // message re-fetches the SAME window and re-upserts the SAME keys, so the second delivery produces the
  // same rows rather than duplicates. That is a property of the conflict key, verified by the guard driving
  // the same message twice — not an assumption about Queues' delivery semantics.
  await recordEntryOutcome({
    key: { clientId, resource: entry.resource, segment: entry.segment },
    cursorDate: startDate,
    exhaustion: result.exhaustion,
    observedZero: result.observedZero,
    skippedReason: result.skipped ? result.skipped.requirement : null,
    rowsWritten: result.rowsWritten,
    requestsSpent: result.gaql ? 1 : 0,
    error: result.error,
  })

  // ── SELF-RE-PUBLISH, GOVERNED ────────────────────────────────────────────────────────────────────────────
  // ⛔ THE BOUND IS DECIDED BEFORE THE GOVERNOR, DELIBERATELY. The governor answers "may we AFFORD another
  // window"; the bound answers "were we ASKED for another window at all", and a run asked for exactly one
  // must stop even when quota and disk would happily allow more.
  // ⛔ ONE HELPER SERVES BOTH THE FRESH-WINDOW PATH AND THE ALREADY-FINISHED PATH. A second copy of this
  // logic is how the resume path came to skip the governor, the bound and the stand-down record entirely.
  const stillGoing = !!(result.exhaustion && !result.exhaustion.complete && !result.skipped && !result.error)
  if (stillGoing) {
    await advanceToNextWindow({ msg, clientId, label, startDate, entry })
  }

  // ── DONE SIGNAL ──────────────────────────────────────────────────────────────────────────────────────────
  // ⛔ THE DENOMINATOR IS THE SET WE ACTUALLY PUBLISH, AND IT USED NOT TO BE. This counted the raw catalog
  // filter — 559 entries — while the starter publishes `selectableEntries` (346, which is exactly how many
  // rows universe_run_state holds). isClientComplete requires states.length >= totalEntries, so 346 < 559
  // made the done signal UNSATISFIABLE BY CONSTRUCTION and `universe_run_notice` had never been written once.
  const doc = loadUniverse()
  const published = selectableEntries(doc)
  const total = published.length
  // ⛔ AND FIXING IT ALONE WOULD HAVE BEEN WORSE THAN LEAVING IT. 'complete' over 346 while 213 catalog
  // entries are excluded is a green flag over a hole, which the governing law forbids outright. The notice
  // therefore carries BOTH denominators and the exclusions with their reasons.
  // ⛔ THE CATALOG IS NOT NARROWED — LORAMER_VENDOR_CATALOG_IS_THE_DENOMINATOR_V1 STANDS. This is the
  // visible-debt form: the vendor's number is reported alongside ours, so the gap can never read as zero.
  const catalogTotal = catalogEligibleEntries(doc).length
  const exclusions = excludedFromWalk(doc)
  const states = await readAllEntryStates(clientId)
  const done = isClientComplete({ totalEntries: total, states })
  if (done.done) await writeCompletionNotice(clientId, states, total, { catalogTotal, exclusions })

  // ⛔ THE GRAIN AND THE DECLINES ARE ON THE LOG LINE ON PURPOSE (LORAMER_UNIVERSE_ENTITY_AXIS_V1). A run
  // that silently wrote everything at one level is indistinguishable from a run that wrote at vendor grain
  // unless the level is stated per message; `declines` is the third state — vendor answered, named no entity.
  console.log(`[universe] ${clientId} ${label} ${startDate}..${endDate} outcome=${outcome} level=${result.entityLevel} apiRows=${result.apiRows} rows=${result.rowsWritten} refused=${refusedRows} declines=${result.grainDeclines} zero=${result.observedZero} skipped=${!!result.skipped} disk=${gb(floor.freeBytes)} msg=${metadata?.messageId} | ${done.reason}`)
})

export async function GET() {
  return NextResponse.json({ error: 'This route is a Vercel Queues consumer and has no public GET.' }, { status: 405 })
}
