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
// **THE INVARIANT CHANGED AGAIN ON 2026-08-11 — LORAMER_WALK_SCHEDULED_V1 — AND THE CHANGE IS THE POINT:
// THE WALK IS NOW SCHEDULED.** The separate, explicit decision the previous invariant reserved for Russ was
// TAKEN, with all three pre-scheduling gates closed (meter · lane · cleanup; LORAMER_PRESCHEDULING_GATE_V1)
// and the Foam OH dormancy eyeball done. The invariant now:
//   · the ONLY publisher to this topic is `/api/cron/universe-resume`;
//   · that route IS in `vercel.json` — **EXACTLY ONE entry: Foam OH, `dryRun=0`, `30 * * * *`**, pinned
//     byte-for-byte by `universe-stream-consumer.guard.mjs` leg (e); a second entry, a faster cadence, a
//     different client or a dropped `dryRun=0` is a red build, because each changes unattended spend
//     without a decision;
//   · every published message is BOUNDED — `MAX_REQUESTS_PER_RUN = 20`/run, `windowsRemaining: 1`, so the
//     worst hour is 20 vendor requests and the worst day 480 of the 13,500 lane;
//   · it is `Bearer $CRON_SECRET`-gated, and Vercel sends that header on cron fires by its own contract.
// So this handler is now reachable ON A SCHEDULE, unattended — which is why the quota sentinel sits at
// step 0, why every attempt is ledgered before the vendor is called, and why coverage is DERIVED: a missed
// or DUPLICATED cron fire (Vercel: delivery is best effort, duplicates possible, NO retry on failure)
// re-finds exactly the still-owed windows and re-publishing an owed window is idempotent by key.
//
// ROLLBACK is "delete the cron entry and redeploy" — leg (e) then goes red on ZERO entries, which forces the
// un-scheduling to be recorded as a decision too. No data motion, no migration to undo. `universe_window_log`
// and `universe_run_state` are not written by this file at all — this consumer's bookkeeping lives entirely
// in `universe_attempt_log`.
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
// ⛔ VENDOR_FLOOR_DATE IS DELIBERATELY NOT IMPORTED — LORAMER_UNIVERSE_DISCOVERED_FLOOR_V1. The floor is
// DISCOVERED per (account, surface) from the vendor's own refusal and resolved at EXECUTE time.
import { recordAccountWall, discoverAccountInception, readWalkStopAccountFacts, resolveWalkStop, type UniverseEntry } from '@/lib/backfill/google-ads-universe-writer'
import { captureSurfaceStreaming, serializeVendorError } from '@/lib/backfill/universe-stream-capture'
// ⛔ THE ADAPTER SUPPLIES EVERY GOOGLE FACT THE CORE USED TO HOLD: the GAQL, the ORDER BY, the retention
// floor, the operations meter, the sizing policy AND its cost direction, and the day-closure entitlement.
// This route now contains no vendor constant at all — `capture-adapter-seam.guard.mjs` enforces that.
import { googleAdsCaptureAdapter, surfaceOfEntry, isRetentionWallRefusal } from '@/lib/backfill/capture-adapters/google-ads.adapter'
import { mayFetch } from '@/lib/backfill/capture-adapter'
import { rangesStillOwed } from '@/lib/backfill/universe-coverage'
import { appendAttemptStarted, appendDayCommitted, appendAttemptFinished, appendMessageFinished, readAttemptsAtSpan, readAttemptLaneSpendToday, type AttemptKey, type WriteProvenance } from '@/lib/backfill/universe-attempt-log'
import { sizeNextWindow, dayDiff } from '@/lib/backfill/universe-sizing'
// ⛔ THE MIS-SIZED SPLIT IS A PURE DECISION AND LIVES WITH THE OTHER PURE DECISIONS — importing it rather
// than recomputing it here is what lets a guard DRIVE the "no day belongs to neither half" invariant.
import { planMisSizedSplit } from '@/lib/backfill/universe-resumer'
import { checkDiskFloor } from '@/lib/backfill/universe-window-log'
import { googleAdsStreamFor } from '@/lib/backfill/universe-vendor-stream'
// ⛔ THE TOPIC, THE MESSAGE SHAPE AND THE TWO BOUNDS LIVE IN A CONTRACT MODULE, NOT HERE. Next.js rejects
// any non-Route export from a route file ("TOPIC is not a valid Route export field") — and `tsc --noEmit`
// passes it clean, so only `npm run build` catches it. It is also the right shape: a publisher needs the
// topic and the message type without dragging a handler and its maxDuration into scope.
import { TOPIC, VENDOR, MAX_ATTEMPTS_AT_MIN_SPAN, NARROW_AFTER_ATTEMPTS, EMPTY_STRETCH_REPORT_AFTER, CONSUMER_MAX_DURATION_S, type UniverseMessageV2 } from '@/lib/backfill/universe-v2-contract'
// ⛔ LORAMER_V2_QUOTA_SENTINEL_WIRED_V1 — the SHARED predicate, imported, never re-derived. `holdGoogleWork`
// and not `.paused`: LORAMER_QUOTA_READ_SPLIT_STATE_V1 exists because an UNREADABLE sentinel returns
// paused:false, and a lane that tests `.paused` spends the fleet's quota against a pause it could not see.
import { readGoogleQuotaPause, holdGoogleWork } from '@/lib/backfill/google-quota-store'
import { recordQuotaHold } from '@/lib/backfill/universe-quota-hold' // LORAMER_V2_QUOTA_HOLD_IS_DURABLE_V1
// ⛔ LORAMER_V2_WALK_BUDGET_RESERVATION_V1 — the SHIPPED rule, not a second copy. lap-budget.ts:14-17:
// "A BETWEEN-ITERATION BUDGET CHECK IS ONLY SAFE IF ONE ITERATION CANNOT EXCEED THE REMAINING CEILING."
import { shouldStartAnotherLap } from '@/lib/backfill/lap-budget'
import { randomUUID } from 'node:crypto'

export const dynamic = 'force-dynamic'
export const fetchCache = 'force-no-store'
// ⛔ THE CEILING IS THE CONTRACT'S, NOT A LITERAL — LORAMER_COMPLETION_SIGNAL_V1. An observer has to know how
// long an invocation may live, and Vercel's guarantee is "if a function runs for longer than its set maximum
// duration, Vercel will terminate it". Written as 300 here it was a number two other files had to guess at;
// `drive-ceiling-pin.guard.mjs` now pins this export, the contract and the drive to ONE value, because Pro
// permits 800s (1800s extended) and raising it is legal.
export const maxDuration = CONSUMER_MAX_DURATION_S

// ⛔ 120s OF HEADROOM UNDER THE 300s CEILING — the SAME margin the drain holds under its own
// (cron/drain/route.ts: 1,680,000 under 1800s). This is the budget that stops the route TAKING ON a range;
// the platform ceiling only kills what is already running, which is why a budget at or above the ceiling
// would stop nothing. A range dispatched just under this can still finish before Vercel kills the function.
const WALK_BUDGET_MS = 180_000

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
  // ⛔ THE KEY RIDES ON THE MESSAGE — LORAMER_COMPLETION_SIGNAL_V1. It is already minted for the queue's
  // own dedupe; writing it onto the payload is what makes it PERSISTABLE, and a durable row that cannot
  // name its publisher is what let a scheduled fire's requests be counted as a drive's.
  await send(TOPIC, { ...next, messageKey: idempotencyKey } satisfies UniverseMessageV2, { idempotencyKey } as any)
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
// ⛔ THE BODY IS A NAMED FUNCTION SO THE HANDLER CAN WRAP IT — LORAMER_COMPLETION_SIGNAL_V1. Every exit of
// this function, INCLUDING A THROW, passes through the handler's `finally` below. That is the whole design:
// the consumer has NINE exits (eight bare returns and an uncaught throw) and its only `try` wrapped one
// range, so a per-return write would have covered eight of nine — and the ninth is the one that matters,
// because `appendAttemptStarted`/`appendAttemptFinished` throw BY DESIGN and the paths most likely to end
// badly were the paths least likely to record it.
async function runOneMessage(msg: UniverseMessageV2, prov: WriteProvenance): Promise<void> {
  const started = Date.now() // LORAMER_V2_WALK_BUDGET_RESERVATION_V1 — the per-invocation clock the reservation reads
  const { clientId, userEmail, customerId, entry, startDate, endDate } = msg
  const label = `${entry.resource}${entry.segment ? ' / ' + entry.segment : ''}`

  // ══ 0 · THE VENDOR'S OWN REFUSAL, BEFORE ANYTHING ELSE ════════════════════════════════════════════════
  // ⛔ LORAMER_V2_QUOTA_SENTINEL_WIRED_V1 (★WALK-DOES-NOT-READ-OR-ARM-THE-QUOTA-SENTINEL). Placed FIRST, the
  // same position and for the same stated reason as cron/drain/route.ts:117-128 — "so a paused fire does zero
  // outbound Google work". It gates the ADVANCE too, not just the walk: publishing into an armed quota is
  // spending the fleet's tomorrow, one message later.
  // ⛔ THE METER DOES NOT COVER THIS. `mayFetch` reads the adapter's meter, which sums OUR OWN ledgers — our
  // accounting. The sentinel records THE VENDOR'S REFUSAL. Our count can be perfect while Google is refusing.
  // ⛔ NO RE-PUBLISH ON A HOLD, and no attempt record: nothing was asked, so nothing is owed differently.
  // Coverage is DERIVED, so the resumer re-finds this exact window once the clock-based window elapses.
  const qp = await readGoogleQuotaPause()
  if (holdGoogleWork(qp)) {
    // ⛔ DURABLE, NOT SILENT (sweep C6, LORAMER_V2_QUOTA_HOLD_IS_DURABLE_V1) — and this consumer is the one
    // that most needs it: a queue callback that returns quietly leaves NOTHING behind at all.
    await recordQuotaHold({ lane: 'consumer', clientId, qp, wouldHaveDone: `walk ${label} ${startDate}..${endDate} and advance` })
    console.warn(
      `[universe-v2] QUOTA HOLD ${clientId} ${label} ${startDate}..${endDate} — ` +
      (qp.state === 'unknown'
        ? `sentinel UNREADABLE, holding (NOT a confirmed pause): ${qp.reason}`
        : `google quota paused until ${qp.until}`) +
      ' · no vendor call, no publish. Owed-ness is derived, so this window is re-found when the window elapses.'
    )
    return
  }
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

  // ══ 0b · THE FLOOR, RESOLVED **HERE** AND NOWHERE ELSE ════════════════════════════════════════════════
  // ⛔ LORAMER_UNIVERSE_DISCOVERED_FLOOR_V1 — EXECUTE TIME, NOT PLAN TIME, AND NOT OFF THE MESSAGE.
  // This read `msg.floorDate ?? VENDOR_FLOOR_DATE`: a floor decided by the PUBLISHER, frozen onto a message,
  // and consumed by this CONSUMER an unknown time later. Two owners, one fact (G1). Our own record puts
  // queue messages at the default 24h TTL, and any rolling boundary moves ONE DAY PER DAY — so the drift is
  // exactly one boundary-day, the worst possible ratio. Resolving it here closes the gap by construction:
  // the value cannot be stale because it is read in the same invocation that uses it.
  // ⛔ THE WALL IS A **SURFACE** FACT, NEVER AN ACCOUNT FACT — LORAMER_SURFACE_SCOPED_WALL_V1, 2026-08-10,
  // from external adversarial review. It is scoped account × resource × segment × granularity, and every
  // one of those four is load-bearing: Google's retention rule is stated for GRANULAR segments specifically,
  // so a refusal on `segments.date` says nothing about `segments.month`, and a refusal on one resource says
  // nothing about another. **"The account's floor" is the sentence in which one resource's refusal becomes
  // an account-wide seal** — floor36's exact shape, which sealed 214 cursors across 18 clients.
  // ⚠ NAMING RESIDUAL, STATED RATHER THAN LEFT: `readAccountWall`/`recordAccountWall` still carry "Account"
  // in their names. They are keyed correctly (client × vendor × resource × segment) and the guard below
  // enforces that, but the NAME still invites the wrong reading. Renaming them to `readSurfaceWall` /
  // `recordSurfaceWall` requires editing `google-ads-universe-writer.ts`, which was outside this flight's
  // ceiling. QUEUE: ★WALL-HELPERS-STILL-NAMED-ACCOUNT.
  // ⛔ `null` MEANS **UNKNOWN — NO REFUSAL HAS BEEN OBSERVED FOR THIS SURFACE**. It does NOT mean "no
  // history" and it is NOT a default. `advance()` below refuses to stop on it; only a recorded vendor
  // refusal stops a walk. An unreadable store THROWS rather than answering null, because answering null
  // would convert a failed read into "no wall known" — a lie in the safe-looking direction.
  // ⛔ LORAMER_WALK_STOP_ONE_RESOLVER_V1 — the wall read and the composition moved into `resolveWalkStop`, so
  // the RESUMER can compose the SAME stop without a second `composeWalkStop(` call site. `inception-stop`
  // leg (c) still reads exactly one composition site and was NOT relaxed to allow this: the second caller was
  // shaped to fit the guard. Everything below reads identically to what this block computed inline.
  const stopFacts = await readWalkStopAccountFacts({
    clientId, vendor: adapter.platform,
    // ⛔ LORAMER_INCEPTION_EXECUTOR_V1 — FIRST TOUCH: no row = UNKNOWN = discover it NOW. One metered+ledgered
    // op through the writer's executor (the ONLY executor of INCEPTION_DISCOVERY_GAQL; guard leg (b3)). Every
    // failure path inside returns null — UNKNOWN never defaults, the composed stop stays honest, and a later
    // message retries. Sits BELOW the holdGoogleWork gate (step 0) by construction: a held fire never reaches
    // this line. The injected streamFor is the armed boundary-5 stream, so a quota refusal here arms the
    // fleet sentinel like every other vendor call on this route. THE RESUMER PASSES `null` HERE — it never
    // fetches, so it can never be the thing that triggers this.
    discover: () => discoverAccountInception({ clientId, vendor: adapter.platform, adapter, stream: streamFor, prov }),
  })
  const walkStop = await resolveWalkStop({
    clientId, vendor: adapter.platform, resource: surface.resource, segment: surface.segment, facts: stopFacts,
  })
  const surfaceWall = walkStop.surfaceWall
  console.log(`[universe-v2] SURFACE WALL ${clientId} ${label}: ` + (surfaceWall
    ? `DISCOVERED ${surfaceWall.wallDate} (${surfaceWall.source}) for THIS resource+segment only — ${surfaceWall.citation.slice(0, 120)}`
    : 'UNKNOWN — no vendor refusal has ever been observed for this resource+segment on this account. This says nothing about other surfaces. The walk continues until the vendor refuses; it does NOT stop on a clock.'))
  // ⛔ THE ONE COMPOSITION SITE — LORAMER_INCEPTION_STOP_V1. Surface wall (vendor refusal, per-surface store)
  // composed with the account inception stop (earliest campaign, per-account store) by composeWalkStop and
  // NOWHERE ELSE (inception-stop.guard.mjs leg (c)) — now reached through `resolveWalkStop` above, which is
  // itself that one site. The held-data min is the safeguard: rows we already hold outrank the inception
  // claim, so the stop can never orphan ground we can see. Date-only comparison in the ACCOUNT-TIMEZONE
  // frame — the registry's probe-op-6 row owns that caveat.
  const floorDate: string | null = walkStop.stopDate
  console.log(`[universe-v2] WALK STOP ${clientId} ${label}: ${walkStop.basis}` +
    (walkStop.inceptionKnown ? '' : ' · ⚠ INCEPTION UNKNOWN — an unbounded walk will REFUSE to advance (walkToEpoch is an explicit operator choice, never a fallback)'))

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
    // ── ⛔ THE UNWEDGE, HERE TOO — LORAMER_NOTHING_OWED_MUST_UNWEDGE_V1, FOUND BY THE GUARD WRITTEN FOR THE
    // DRIVE AND TRUE OF THIS ROUTE ALL ALONG. With `windowsRemaining: 1` the advance below is TERMINAL: it
    // publishes nothing and this branch wrote nothing, so a message delivered for an already-covered window
    // left NO `attempt_started` row, the rotation never saw that window as ASKED, and `deriveAnchorEnd` could
    // not recede past it. Rarer than the resumer's version — it needs coverage to change between publish and
    // consume — but the identical mechanism, and the third instance of it in three publishers.
    // Same shape as the resumer's block, deliberately: started(requests:0) + finished('skipped') with the
    // COVERED_SKIP marker, rowsWritten OMITTED so it never enters sizing history, and 'skipped' already
    // excluded from vendor attestation so it can never masquerade as coverage.
    const coveredKey: AttemptKey = { ...key, windowStart: startDate, windowEnd: endDate }
    // LORAMER_PARENT_WINDOW_IS_THE_UNIT_V1 — here the range IS the window, so the parent is trivially itself.
    // Stamped anyway rather than left null: a null parent reads as UNKNOWN and HOLDS the anchor, which would
    // re-wedge exactly the covered ground this branch exists to advance past.
    const coveredOpened = await appendAttemptStarted(coveredKey, 0, { startDate, endDate }, prov)
    await appendAttemptFinished(coveredKey, coveredOpened.attemptNo, 'skipped', {
      requestsSpent: 0,
      error: `COVERED_SKIP — LORAMER_WALK_UNWEDGE_V1: window ${startDate}..${endDate} fully covered/attested on delivery; advanced past it with ZERO vendor ops. NOT a vendor attestation — coverage derivation ignores 'skipped'.`,
    }, prov)
    const adv = await advance(msg, adapter, { stopDate: floorDate, inceptionKnown: walkStop.inceptionKnown }, 'already covered — nothing owed in this window')
    console.log(`[universe-v2] ADVANCE ${clientId} ${label}: ${JSON.stringify(adv)}`)
    return
  }

  // ══ 2 · THE DISK FLOOR, BEFORE ANY REQUEST IS SPENT ═══════════════════════════════════════════════════
  const floor = await checkDiskFloor()
  if (!floor.ok) {
    await appendAttemptFinished(key, await nextAttemptNoWithoutCharging(key), 'floor_stop',
      { rowsWritten: 0, requestsSpent: 0, diskFreeBytes: floor.freeBytes, error: floor.reason }, prov)
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
    }, prov)
    console.error(`[universe-v2] BROKEN ${clientId} ${label} ${startDate}..${endDate} — ${attemptsHere} attempt(s) at the ${MIN_WINDOW_DAYS}-day minimum. Escalate.`)
    return
  }
  if (spanDays > MIN_WINDOW_DAYS && attemptsHere >= NARROW_AFTER_ATTEMPTS) {
    // ⛔ **MIS-SIZED**, which is a completely different verdict and gets a completely different remedy:
    // re-publish this same ground at HALF the span. Nothing is abandoned and nobody is told anything is
    // broken, because nothing is.
    // ⛔ THE SPLIT IS A PURE FUNCTION AND NOT INLINE ARITHMETIC, DELIBERATELY — `planMisSizedSplit`
    // (universe-resumer.ts) so `mis-size-must-re-owe.guard.mjs` can DRIVE the property "no day of the window
    // belongs to neither half" instead of grepping for it. The inline version is what dropped the upper half.
    const split = planMisSizedSplit({ windowStart: startDate, windowEnd: endDate, minDays: MIN_WINDOW_DAYS })
    const half = split.halfDays
    const narrowedEnd = split.lower.end
    // ⛔ LORAMER_MISSIZE_REOWES_THE_UPPER_HALF_V1 — THE HALF THIS BRANCH USED TO THROW AWAY.
    // It narrowed to `[startDate, narrowedEnd]` — the OLDER half — and NOTHING ever republished
    // `[narrowedEnd+1, endDate]`. The resumer cannot rescue it: the anchor only moves DOWN, and the narrowed
    // window's own attempt rows drag the rotation below the dropped ground on the very next fire. So the upper
    // half was not "walked later", it was walked NEVER.
    // ⛔ MEASURED LIVE, 2026-08-18, BY `no-owed-day-left-behind.guard.mjs` — 270 owed days above the frontier
    // across 14 surfaces, and TWELVE of them report EXACTLY 15 days at 2026-03-24..2026-04-07: the upper half
    // of a 30-day window this branch narrowed to 15. The guard knows nothing about narrowing; it read the
    // warehouse and reproduced this arithmetic. 18 mis-sized events stand in the log.
    // ⛔ AND THE parent_window FIX DOES NOT CLOSE IT, WHICH IS WHY IT IS A SEPARATE MARKER: the narrowed
    // message's window genuinely IS the narrow one, so the parent stamp records it FAITHFULLY. The ground is
    // lost at the PUBLISH site, not at the anchor. A fix that closes a hole and leaves the CLASS alive is a
    // failure even shipped green.
    const hasUpper = split.upper !== null
    const upperStart = split.upper?.start ?? endDate
    // ⛔ THE UPPER HALF IS PUBLISHED **FIRST**, AND THE ORDER IS THE SAFETY PROPERTY, NOT A PREFERENCE.
    // The governor may refuse. If the lower half went out first and the upper were then refused, we would
    // have re-created the exact defect — the rotation would move down onto the narrowed window and the upper
    // half would be below no future ask. Publishing the endangered half first means a refusal costs us the
    // NARROWING (recoverable: the window is re-derived next fire and nothing was spent) instead of costing us
    // the DATA (unrecoverable). Fail-closed, in the direction the coverage module's own header names as the
    // catastrophic one.
    const upper = hasUpper
      ? await publishGoverned(adapter,
          { ...msg, startDate: upperStart, endDate }, dayDiff(upperStart, endDate) + 1,
          `${clientId}|${entry.resource}|${entry.segment ?? ''}|${upperStart}|${endDate}|narrow-upper`,
        )
      : { published: true, reason: 'no upper half — the narrow consumed the whole window' }
    if (!upper.published) {
      // ⛔ HOLD THE WHOLE WINDOW RATHER THAN SPLIT IT. Nothing is published and nothing is spent, so the
      // newest ASKED row for this surface stays the FULL window, the anchor holds at its top, and the resumer
      // re-derives all of it next fire. A quota refusal must never become a permanent hole.
      await appendAttemptFinished(key, attemptsHere + 1, 'skipped', {
        rowsWritten: 0, requestsSpent: 0, diskFreeBytes: floor.freeBytes,
        error: `MIS-SIZE HELD, NOT SPLIT: ${attemptsHere} attempt(s) at ${spanDays} days, but the upper half ${upperStart}..${endDate} could not be published (${upper.reason}). ` +
          `Publishing only the older half would drop the upper half permanently — LORAMER_MISSIZE_REOWES_THE_UPPER_HALF_V1. The whole window stays owed and is re-derived next fire.`,
      }, prov)
      console.warn(`[universe-v2] MIS-SIZE HELD ${clientId} ${label}: upper half ${upperStart}..${endDate} refused (${upper.reason}) — window NOT split, nothing dropped.`)
      return
    }
    const pub = await publishGoverned(adapter,
      { ...msg, startDate, endDate: narrowedEnd }, half,
      `${clientId}|${entry.resource}|${entry.segment ?? ''}|${startDate}|${narrowedEnd}|narrow`,
    )
    await appendAttemptFinished(key, attemptsHere + 1, 'skipped', {
      rowsWritten: 0, requestsSpent: 0, diskFreeBytes: floor.freeBytes,
      error: `MIS-SIZED, not broken: ${attemptsHere} attempt(s) at ${spanDays} days. Re-published at ${half} day(s). ${pub.reason}` +
        (hasUpper ? ` · UPPER HALF ${upperStart}..${endDate} RE-OWED as its own message (${upper.reason}) — LORAMER_MISSIZE_REOWES_THE_UPPER_HALF_V1.` : ''),
    }, prov)
    console.log(`[universe-v2] MIS-SIZED ${clientId} ${label}: ${spanDays}d → ${half}d, published=${pub.published} (${pub.reason})` +
      (hasUpper ? ` · upper ${upperStart}..${endDate} re-owed (${upper.reason})` : ''))
    return
  }

  // ══ 4 · WALK THE OWED RANGES, STREAMING, COMMITTING A DAY AT A TIME ═══════════════════════════════════
  let totalRows = 0, totalApi = 0, requests = 0
  const daysCommitted: string[] = []
  let lastError: string | null = null
  let orderViolation = false
  // ⛔ LORAMER_UNIVERSE_DISCOVERED_FLOOR_V1 — the WALL observed this invocation, if any. It carries the
  // REFUSED RANGE'S OWN START, never `startDate` of the whole message: the wall is where the vendor actually
  // said no, and an owed window can hold several ranges. Recorded AFTER the loop so a wall never short-
  // circuits ranges that might still be served — a refusal on one range is not a refusal on the others.
  let wallAt: { date: string; citation: string } | null = null
  const noteWall = (rangeStart: string, err: string | null) => {
    if (!isRetentionWallRefusal(err)) return
    // Keep the SHALLOWEST (highest) refusal seen this invocation; the DB write applies the same rule across
    // invocations. Refusing at 2020 does not un-refuse 2022.
    if (!wallAt || rangeStart > wallAt.date) wallAt = { date: rangeStart, citation: String(err) }
  }

  // ⛔ LORAMER_V2_WALK_BUDGET_RESERVATION_V1 — worst range observed THIS invocation, feeding the reservation.
  let maxRangeMs = 0
  let deferredForBudget = 0

  for (const range of owed.ranges) {
    // ⛔ RESERVATION, NOT A BARE ELAPSED CHECK — lap-budget.ts:14-17, the rule that outlives its own route.
    // HOW THE WALK'S ITERATION SATISFIES THE INVARIANT ("one iteration cannot exceed the remaining ceiling"):
    // one iteration is ONE vendor request over ONE contiguous owed range, and the reservation is
    // max(worst range already observed this invocation, the shared conservative FIRST_LAP_MS). The first range
    // of an invocation has no measurement, so it reserves the shipped 90s default — deliberately NOT lowered
    // (lap-budget.ts:23-27 records why the reservation is a parameter rather than a smaller shared constant).
    // ⚠ THE HONEST RESIDUAL: a range SLOWER than its reservation still overruns. What bounds that is the
    // consumer's own narrowing — a range that repeatedly fails at span is halved (MIS-SIZED), and at the
    // minimum span it becomes BROKEN and reportable rather than retried. The reservation removes the
    // dispatched-just-under-the-line class; it does not promise no range is ever too slow.
    if (!shouldStartAnotherLap(Date.now() - started, maxRangeMs, WALK_BUDGET_MS)) {
      deferredForBudget = owed.ranges.length - owed.ranges.indexOf(range)
      break
    }
    const rangeStartedAt = Date.now()
    const rangeKey: AttemptKey = { ...key, windowStart: range.start, windowEnd: range.end }
    // ⛔ THE ATTEMPT IS OPENED **BEFORE** THE VENDOR IS CALLED, AND THE REQUEST IS CHARGED HERE. v1 wrote
    // `requests_spent` only on close, so a killed invocation left 0 and burned quota INVISIBLY to the rate
    // governor — which is exactly how three poison loops persisted. This ordering is the fix.
    // ⛔ LORAMER_PARENT_WINDOW_IS_THE_UNIT_V1 — THE DEFECT WAS HERE AND IT WAS NEVER A LOST FACT.
    // `key` (the WINDOW, built from msg.startDate/endDate at :160) is still in scope four lines above, and
    // `rangeKey` spreads it and then overwrites exactly the two columns that carry the meaning. For a year
    // the log recorded the RANGE under a column named `window_start`, the rotation returned it as "the last
    // window asked", and the anchor receded by ONE DAY per pass. The window is passed, not re-derived.
    const opened = await appendAttemptStarted(rangeKey, 1, { startDate, endDate }, prov)
    requests++
    try {
      const res = await captureSurfaceStreaming({
        adapter, surface,
        ctx: { clientId, userEmail, accountId: customerId },
        startDate: range.start, endDate: range.end,
        onDayCommitted: (day: string, rows: number) => appendDayCommitted(rangeKey, opened.attemptNo, day, rows, prov),
      })
      totalRows += res.rowsWritten
      totalApi += res.apiRows
      daysCommitted.push(...res.daysCommitted)
      orderViolation = orderViolation || res.orderViolation
      lastError = res.error ?? lastError
      // ⛔ THE WALL SIGNAL, AND IT IS TAKEN FROM `res.error` — NOT FROM `res.apiRows === 0`. A successful
      // zero is DORMANCY and is already handled by `decideExhaustion` on the success path; only a REFUSAL
      // is a wall. `isRetentionWallRefusal` matches the vendor's own DateRangeError enum names and nothing else.
      noteWall(range.start, res.error)
      // ⛔ `zero` MEANS THE VENDOR ANSWERED AND THIS QUERY RETURNED NOTHING — **NO_DATA_OBSERVED**, which is
      // the only thing that makes it distinguishable from a day never asked. ⚠ It is NOT a claim that the
      // account was idle: it is scoped to this resource, this segment, this granularity. `ok` at zero rows is NOT the same
      // claim (queue ★WALK-OK-MEANS-ZERO: 556 rows in the old log confused exactly these two), so the
      // outcome is derived from the count rather than hand-set.
      // ⛔ LORAMER_NONGRAIN_ATTESTS_V1 — 'nongrain' SITS BETWEEN 'zero' AND 'ok', AND IT EXISTS BECAUSE
      // CONFLATING IT WITH EITHER ONE COSTS SOMETHING REAL. Folded into 'ok' (what shipped) the window can
      // never attest and is re-asked forever — 32 windows, 14 surfaces, 65 wasted requests, measured
      // 2026-08-17. Folded into 'zero' it becomes indistinguishable in the log from "the vendor returned
      // nothing", which is the very distinction that made this class findable. It attests like a zero and
      // reads apart from one.
      const outcome = res.error ? 'error' : res.skipped ? 'skipped'
        : res.apiRows === 0 ? 'zero'
        : res.nonGrainOnly ? 'nongrain'
        : 'ok'
      await appendAttemptFinished(rangeKey, opened.attemptNo, outcome, {
        rowsWritten: res.rowsWritten, requestsSpent: 1, diskFreeBytes: floor.freeBytes,
        error: res.error ?? (res.orderViolation ? 'ORDER VIOLATION: the vendor returned a row for an already-committed day, so this attempt\'s day commits do not prove closure' : res.skipped ? res.skipped.requirement : null),
      }, prov)
      maxRangeMs = Math.max(maxRangeMs, Date.now() - rangeStartedAt)
    } catch (e: any) {
      // ⛔ A RANGE THAT THREW STILL CONSUMED THE CLOCK — feed it to the reservation before any exit, or the
      // next dispatch reserves against a stale maximum and re-opens the overrun this change exists to close.
      // (Same ordering the drain arrived at at cron/drain/route.ts:332-335.)
      maxRangeMs = Math.max(maxRangeMs, Date.now() - rangeStartedAt)
      lastError = serializeVendorError(e)
      // A refusal can arrive as a throw rather than in `res.error` — the same signal, the same rule.
      noteWall(range.start, lastError)
      await appendAttemptFinished(rangeKey, opened.attemptNo, 'error',
        { rowsWritten: 0, requestsSpent: 1, diskFreeBytes: floor.freeBytes, error: lastError }, prov)
    }
  }

  console.log(`[universe-v2] ${clientId} ${label}: ${totalApi} api rows → ${totalRows} written across ` +
    `${daysCommitted.length} committed day(s), ${requests} request(s)${orderViolation ? ' ⚠ ORDER VIOLATION' : ''}${lastError ? ` — ${lastError}` : ''}`)

  // ══ 4b · THE DISCOVERED WALL, RECORDED BEFORE ANY EXIT ════════════════════════════════════════════════
  // ⛔ LORAMER_UNIVERSE_DISCOVERED_FLOOR_V1. A refusal is the one thing that ends a walk, so losing it costs
  // a full re-walk to the same refusal. It is written BEFORE the budget-stop return for exactly that reason:
  // every exit below this line is an exit that already knows what the vendor said.
  // The cast is required, not lazy: `wallAt` is only ever assigned inside `noteWall`, which TypeScript's
  // control-flow analysis cannot see through, so it narrows the variable to `null` here.
  const observedWall = wallAt as { date: string; citation: string } | null
  if (observedWall) {
    await recordAccountWall({
      clientId, vendor: adapter.platform, resource: surface.resource, segment: surface.segment,
      wallDate: observedWall.date, citation: observedWall.citation,
    })
    console.warn(`[universe-v2] SURFACE WALL DISCOVERED ${clientId} ${label} at ${observedWall.date} — the vendor REFUSED this range ` +
      `FOR THIS RESOURCE AND SEGMENT. Stored per (client, vendor, resource, segment); it seals nothing else and says nothing about the account. ` +
      `This is a REFUSAL, not a zero: a successful empty window is NO_DATA_OBSERVED and never reaches here.`)
  }
  // ⛔ THE FLOOR THE ADVANCE USES. A wall discovered THIS invocation binds immediately — advancing past a
  // refusal we just received would spend the next request re-learning it. max() against the composed stop:
  // a fresh refusal can only RAISE the stop, never lower it below the inception line.
  const effectiveFloor: string | null = observedWall === null ? floorDate
    : floorDate === null ? observedWall.date
    : (observedWall.date > floorDate ? observedWall.date : floorDate)

  // ⛔ THE DEFERRAL IS RECORDED DURABLY AND CHARGED NOTHING. A budget stop that lives only in a log line is a
  // stop nobody can act on (Vercel runtime logs expire in an hour), and LORAMER_EMPTY_CARRIES_ITS_DENOMINATOR_V1
  // applies to a partial pass exactly as it does to an empty one. `nextAttemptNoWithoutCharging` exists for
  // precisely this shape — a path that will NOT call the vendor must not bill a request for work it never did.
  if (deferredForBudget > 0) {
    const firstDeferred = owed.ranges[owed.ranges.length - deferredForBudget]
    const defKey: AttemptKey = { ...key, windowStart: firstDeferred.start, windowEnd: firstDeferred.end }
    await appendAttemptFinished(defKey, await nextAttemptNoWithoutCharging(defKey), 'skipped', {
      rowsWritten: 0, requestsSpent: 0, diskFreeBytes: floor.freeBytes,
      error: `BUDGET STOP, NOT A FAILURE: ${deferredForBudget} of ${owed.ranges.length} owed range(s) were not started — ` +
        `${Date.now() - started}ms elapsed of a ${WALK_BUDGET_MS}ms budget under maxDuration ${maxDuration}s, worst range ${maxRangeMs}ms. ` +
        `The days stay UNCOVERED and owed-ness is DERIVED, so the resumer re-finds them without anyone naming a row id.`,
    }, prov)
    console.warn(`[universe-v2] BUDGET STOP ${clientId} ${label}: deferred ${deferredForBudget}/${owed.ranges.length} range(s) — NOT advancing; the resumer re-derives what is still owed.`)
    // ⛔ NO ADVANCE ON A BUDGET STOP. Advancing to an older window while this one still owes ground would leave
    // a hole behind the walk that only a re-scan could find. THE DRIVER OWNS THE LOOP (June, BackfillControl.tsx:64-86).
    return
  }

  // ══ 4c · EMPTY-STRETCH VISIBILITY — LORAMER_EMPTY_STRETCH_VISIBILITY_V1 ═══════════════════════════════
  // ⛔ VISIBILITY, NEVER A STOP. The counter is chain-local (windowsRemaining's shape): rows anywhere this
  // invocation RESET it; an all-empty, error-free invocation INCREMENTS it. At EMPTY_STRETCH_REPORT_AFTER
  // (400 — above BusyBee's measured 2,267-day dormancy at any window size the sizer produces) it writes ONE
  // `abandoned_owed`-class record for the operator and the walk CONTINUES un-parked: a row's absence proves
  // nothing, so the only lawful output of a long empty stretch is a report. The record is charged NOTHING —
  // nextAttemptNoWithoutCharging, the same shape as the budget-stop record above.
  const allEmpty = totalApi === 0 && lastError === null && requests > 0
  const emptyStretch = allEmpty ? (msg.emptyStretch ?? 0) + 1 : 0
  if (allEmpty && emptyStretch === EMPTY_STRETCH_REPORT_AFTER) {
    await appendAttemptFinished(key, await nextAttemptNoWithoutCharging(key), 'abandoned_owed', {
      rowsWritten: 0, requestsSpent: 0, diskFreeBytes: floor.freeBytes,
      error: `EMPTY-STRETCH REPORT, NOT A STOP: ${emptyStretch} consecutive all-empty windows on this chain — ` +
        `longer than the longest dormancy ever measured (2,267 days ≈ 324 windows, BusyBee). The walk CONTINUES; ` +
        `nothing is parked and nothing is sealed. An operator should look at why this surface is empty at unprecedented depth.`,
    }, prov)
    console.warn(`[universe-v2] EMPTY-STRETCH ${clientId} ${label}: ${emptyStretch} consecutive all-empty windows — reported, NOT stopped. The walk continues.`)
  }

  const adv = await advance({ ...msg, emptyStretch }, adapter, { stopDate: effectiveFloor, inceptionKnown: walkStop.inceptionKnown },
    `walked ${owed.ranges.length} owed range(s): ${totalRows} rows, ${daysCommitted.length} day(s) committed`)
  console.log(`[universe-v2] ADVANCE ${clientId} ${label}: ${JSON.stringify(adv)}`)
  return
}

const handler = handleCallback(async (msg: UniverseMessageV2, _metadata: any) => {
  // ⛔ THE PROVENANCE IS MINTED BEFORE ANYTHING CAN FAIL. `messageKey` is the PUBLISHER's idempotency key,
  // riding on the message — the fact we already had and threw away. `invocationId` is THIS DELIVERY's, and it
  // is a second fact rather than a duplicate: a redelivery carries the SAME message key, so nothing keyed on
  // the message alone can tell delivery #1's terminal row from delivery #2's later range rows.
  const prov: WriteProvenance = {
    messageKey: msg.messageKey ?? null,
    invocationId: randomUUID(),
  }
  // ⛔ THE TERMINAL KEY IS BUILT FROM THE MESSAGE ALONE, and that is not tidiness. The quota-hold exit fires
  // at :154 — BEFORE `key` exists at :160 and before `surface`/`adapter` — so a key derived from those
  // variables could not be written on the earliest exit path there is.
  const termKey: AttemptKey = {
    clientId: msg.clientId, vendor: VENDOR,
    resource: msg.entry.resource, segment: msg.entry.segment ?? '',
    windowStart: msg.startDate, windowEnd: msg.endDate,
  }
  let ended = 'returned'
  try {
    await runOneMessage(msg, prov)
  } catch (e: any) {
    // ⛔ RECORD AND RETHROW. Swallowing here would convert a crash into a silent success and hand the queue a
    // 2xx for work that did not happen — the exact inversion of what this row exists to prevent.
    ended = `THREW: ${String(e?.message ?? e).slice(0, 400)}`
    throw e
  } finally {
    // ⛔ THE TERMINAL WRITE MAY NOT MASK THE ORIGINAL ERROR. A throw from inside a `finally` REPLACES the
    // exception in flight, so a failed bookkeeping write would erase the real fault and send the next reader
    // to the wrong subsystem. It is caught, logged loudly, and dropped — the ONE place in this codebase where
    // swallowing is correct, and it is stated rather than assumed.
    try {
      await appendMessageFinished(termKey, { error: `MESSAGE ${ended}` }, prov)
    } catch (termErr: any) {
      console.error(`[universe-v2] TERMINAL ROW FAILED for ${msg.clientId} ${msg.entry.resource}/${msg.entry.segment ?? ''} ` +
        `${msg.startDate}..${msg.endDate}: ${String(termErr?.message ?? termErr)}. ⛔ The pass is now INDETERMINATE to every ` +
        `observer — it did not fail, it became unreadable. NOT rethrown: a throw from finally would replace the real error.`)
    }
  }
})

export const POST = handler as unknown as (req: Request) => Promise<Response>

/**
 * ⛔ THE ONLY PLACE THE WALK ADVANCES. Both callers use it — the nothing-owed path and the after-capture
 * path — because v1's resume branch originally had no advance at all and killed the walk on message one.
 *
 * Order is load-bearing: BOUND (were we asked for another window) → FLOOR (is there ground left below the
 * vendor wall) → SIZE (how much to ask for) → GOVERNOR (may we afford it).
 */
async function advance(msg: UniverseMessageV2, adapter: ReturnType<typeof googleAdsCaptureAdapter>, stop: { stopDate: string | null; inceptionKnown: boolean }, why: string) {
  const { clientId, entry, startDate } = msg
  const floorDate = stop.stopDate
  const remaining = msg.windowsRemaining
  if (remaining !== undefined && remaining <= 1) {
    return { ok: true, advanced: false, reason: `bounded run exhausted (windowsRemaining=${remaining})`, why }
  }
  // ⛔ UNKNOWN REFUSES AN UNBOUNDED WALK — LORAMER_INCEPTION_STOP_V1. With no inception discovered and no
  // bound on the chain, "keep walking" means walking empty 30-day windows toward the year 2000, ~316 windows
  // per surface of pure quota. That walk happens only when an OPERATOR says so, on the message, explicitly.
  // It never happens because a discovery query failed and something defaulted.
  if (!stop.inceptionKnown && remaining === undefined && msg.walkToEpoch !== true) {
    return {
      ok: true, advanced: false,
      reason: `REFUSED-UNBOUNDED: account inception is UNKNOWN for ${clientId} and this chain has no windowsRemaining bound. ` +
        `Discovery (${'INCEPTION_DISCOVERY_GAQL'}) either failed or has not run — store a row in universe_account_inception, ` +
        `or re-publish with walkToEpoch:true as an explicit operator choice. Nothing is defaulted.`,
      why,
    }
  }
  // ⛔ THE DISCOVERED WALL — LORAMER_UNIVERSE_DISCOVERED_FLOOR_V1. `floorDate` is the date the VENDOR
  // REFUSED for THIS (account, surface), resolved at execute time by the caller. It is never a clock, never
  // a global constant, and never carried on the message.
  // ⛔ `null` IS **UNKNOWN**, AND UNKNOWN DOES NOT STOP A WALK. No wall has been observed for this surface,
  // so there is nothing to be below. The walk is bounded instead by `windowsRemaining` above and by the
  // MIS-SIZED → BROKEN no-progress bound at the minimum span — the same bounds that already exist. Treating
  // UNKNOWN as a stop would be inferring a wall from silence, which is the defect
  // LORAMER_ZERO_ROWS_IS_NOT_EXHAUSTION_V1 forbids and which sealed 214 cursors once already.
  const nextEnd = addDays(startDate, -1)
  if (floorDate !== null && nextEnd < floorDate) {
    return { ok: true, advanced: false, reason: `wall reached — next window would end ${nextEnd}, below the DISCOVERED vendor refusal at ${floorDate}`, why }
  }
  // ⛔ SIZE ON MAX, REPORT PREV. Under-prediction is the direction that costs a request; over-prediction
  // costs a window that finishes early. See universe-sizing.ts for the measurement that ranked them.
  const sizing = await sizeNextWindow(adapter, { clientId, resource: entry.resource, segment: entry.segment ?? '' })
  const nextStart = (() => {
    const s = addDays(nextEnd, -(sizing.days - 1))
    // ⛔ CLAMP ONLY AGAINST A KNOWN WALL. With `floorDate === null` there is nothing to clamp to, and
    // inventing a bound here would reintroduce the constant this change removed.
    if (floorDate === null) return s
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
