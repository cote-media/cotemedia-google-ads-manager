// LORAMER_POLL_MODE_CUTOVER_V1 — DELIVERY IS NOW PULLED, NOT PUSHED.
//
// ⛔ WHY THIS ROUTE EXISTS, AND IT IS NOT A PREFERENCE. Push delivery to
// `/api/queues/google-ads-universe-v2` decayed to zero every 3–6 hours and was restored ONLY by a deploy —
// FIVE dark spans in 41 hours, five deploy-restores, measured from `universe_attempt_log` rather than from a
// dashboard. Across the same 41 hours the CRON PATH NEVER MISSED A SINGLE FIRE (12/hour, every hour, through
// every dark span). Whatever the push lane exhausts, it does not touch cron invocations. So delivery moves
// onto the transport that has never failed us, and the root cause of the push decay becomes a parallel
// question instead of a blocker. Poll mode is Vercel's own first-class answer for this: "Cron-triggered
// processing: use a Vercel Cron Job to invoke a function on a schedule that polls the queue and processes
// messages in batch."
//
// ⛔ THERE IS EXACTLY ONE DELIVERY LANE. The push trigger for this topic was REMOVED from `vercel.json` in
// the same commit that added this route, and `one-delivery-lane-per-topic.guard.mjs` fails the build if both
// ever exist again. Two lanes are two consumer groups, each receiving a COPY of every message, and the two
// copies would be processed CONCURRENTLY — both reading coverage before either commits, so both fetching.
// Coverage-before-fetch makes a SEQUENTIAL second pass cheap and does nothing about a concurrent one:
// the vendor ops would simply double, and the op meter (which sums `requests_spent`) would double with them.
//
// ⛔ THE WORK IS NOT DUPLICATED HERE. `processMessage` is the SAME function the push callback called, moved
// to `universe-v2-worker.ts` byte-identically so both transports call one implementation. Nothing about what
// a message DOES changed with this cutover; only who hands it over.
//
// ── THE BUDGET, AND WHY limit:1 RATHER THAN limit:10 ──────────────────────────────────────────────────────
// ⛔ THIS IS THE ONE PLACE THE SHIPPED SPEC WAS DEVIATED FROM, AND THE REASON IS A LAW THIS REPO ALREADY PAID
// FOR. `lap-budget.ts:14-17`: "A BETWEEN-ITERATION BUDGET CHECK IS ONLY SAFE IF ONE ITERATION CANNOT EXCEED
// THE REMAINING CEILING." A `receive(..., { limit: 10 })` batch invokes the handler ten times with no
// budget boundary we can honour: the handler's RETURN is what ACKNOWLEDGES the message, so a handler that
// declines work because the budget is spent would ACK work it did not do — silently losing it — and the only
// way to leave a message unacked is to THROW, which books a delivery failure for a message that was fine.
// A single message can legitimately run to the worker's own 180s internal ceiling, so a ten-message batch
// CAN exceed the remaining time. `limit: 1` makes every iteration exactly one message and every loop
// boundary a real one, which is what lets the shipped reservation rule apply unchanged.
// ⛔ AND IT COSTS NOTHING TO DO IT RIGHT: push today bills 35 Notify per cycle at the 2x rate that
// `maxConcurrency` triggers = 70 units. This bills 35 Receive + 35 Delete = 70 units. IDENTICAL, and the
// cheaper batched form is available later if the arithmetic ever matters.
//
// THE CEILING is the contract's, shared with everything else that had to guess at it (drive-ceiling-pin).
// THE BUDGET holds the SAME 120s of headroom under that ceiling as the push consumer did, for the same
// reason: the budget stops us TAKING ON another message; the platform ceiling only kills what is already
// running, so a budget at the ceiling would stop nothing.
import { PollingQueueClient } from '@vercel/queue'
import { NextResponse } from 'next/server'
import { shouldStartAnotherLap } from '@/lib/backfill/lap-budget'
import { TOPIC, CONSUMER_MAX_DURATION_S } from '@/lib/backfill/universe-v2-contract'
import { processMessage } from '@/lib/backfill/universe-v2-worker'

export const dynamic = 'force-dynamic'
export const fetchCache = 'force-no-store'
export const maxDuration = CONSUMER_MAX_DURATION_S

// 120s of headroom under the 300s ceiling — the same margin, and the same argument, the push consumer held.
const POLL_BUDGET_MS = 180_000

// ⛔ THE CAPACITY TERM, DECLARED RATHER THAN IMPLIED — and it exists because the cutover DELETED a number the
// drain-fits-the-interval inequality depended on. Push declared `maxConcurrency: 48`: a static, readable
// statement of how many messages could be in flight at once. A cron-driven poller at `limit: 1` is
// SINGLE-THREADED — its capacity is (budget ÷ how long a message takes), and how long a message takes is a
// RUNTIME fact no guard can read. Rather than let the inequality quietly lose a term, the assumption is
// written down here where `queue-drain-fits-the-interval.guard.mjs` can read it and fail the build when the
// arithmetic stops holding.
// THE NUMBER: messages measured on production 2026-08-21/22 ran 412ms–985ms end to end. 2,000ms is ~2x the
// worst observed, which yields floor(180000/2000) = 90 messages per invocation against the resumer's ~35 per
// fire — about 2.6x headroom on the same 5-minute cadence.
// ⛔ AND IT IS AN ASSUMPTION, NOT A MEASUREMENT, SO IT HAS A DETECTOR: this route reports `worstMessageMs`
// on every invocation. A run whose worst message exceeds this constant is the signal that the inequality is
// no longer true in the field, and it is visible without anyone opening a dashboard.
const ASSUMED_MAX_MESSAGE_MS = 2_000

// ⛔ A NEW GROUP, NEVER THE PUSH GROUP. A consumer group tracks ONE position in the log, so polling the
// group the push trigger registered under (`src_Sapp_Sapi_Squeues_Sgoogle-ads-universe-v2_Sroute_Dts`, read
// off production) would COMPETE for the same messages rather than replace them. Vercel documents per-GROUP
// mode selection and says nothing about polling a push-registered group in either direction.
// ⛔ A NEW GROUP REPLAYS FROM THE BEGINNING OF THE TOPIC — and for this lane that is ZERO messages, because
// topics are partitioned by deployment id and the deployment that first runs this route has published
// nothing at the moment it goes live. The replay exposure people fear here belongs to a DEPLOYMENTLESS
// backlog drain, which is a separate flight and is blocked on a consumer-side op gate that does not exist
// yet (`readAttemptLaneSpendToday` is imported by the worker and never called).
const GROUP = 'universe-v2-poll'

// ⛔ REGION IS REQUIRED BY THE SDK — "messages can only be received from the region they were sent to" — and
// it is the fact this codebase never recorded. `VERCEL_REGION` is the region the FUNCTION runs in; the
// producer publishes with the SDK's auto-detection, which reads the same variable, so the two agree by
// construction rather than by luck. `iad1` is the documented platform default and the value every
// `[consumer-meta]` line has ever carried, so it is the fallback rather than a guess.
const REGION = process.env.QUEUE_REGION || process.env.VERCEL_REGION || 'iad1'

export async function GET() {
  const started = Date.now()
  const { receive } = new PollingQueueClient({ region: REGION })

  let processed = 0
  let empty = false
  let worstMs = 0
  let stopped = 'budget'
  const errors: string[] = []

  // ⛔ THE RESERVATION, NOT A BARE ELAPSED CHECK. `shouldStartAnotherLap` reserves the WORST message observed
  // this invocation (90s before anything is measured) so we never START a message we cannot finish. A message
  // dispatched just under this line can still complete before Vercel kills the function.
  while (shouldStartAnotherLap(Date.now() - started, worstMs, POLL_BUDGET_MS)) {
    const msgStartedAt = Date.now()
    let result
    try {
      result = await receive(TOPIC, GROUP, async (msg: any, metadata: any) => {
        // ⛔ THE SAME FUNCTION THE PUSH CALLBACK CALLED. It mints the provenance, opens the attempt, walks the
        // owed ranges and writes the terminal row in its own `finally` — every exit of every lane passes
        // through that one site, which is what `completion-signal-on-every-exit.guard.mjs` enforces.
        await processMessage(msg, metadata)
      }, { limit: 1 })
    } catch (e: any) {
      // ⛔ A POLL THAT THREW IS NOT AN EMPTY QUEUE, AND THE DIFFERENCE IS THE WHOLE POINT OF THIS ROUTE.
      // Recording it and stopping is honest; treating it as "nothing to do" would rebuild the exact silence
      // the push lane failed in — a lane that reports success while delivering nothing.
      errors.push(String(e?.message ?? e).slice(0, 300))
      stopped = 'threw'
      break
    }
    worstMs = Math.max(worstMs, Date.now() - msgStartedAt)
    if (!result?.ok && result?.reason === 'empty') { empty = true; stopped = 'empty'; break }
    processed++
  }

  // ⛔ THE INSTRUMENT REPORTS CONSUMPTION AND ITS DENOMINATOR — LORAMER_EMPTY_CARRIES_ITS_DENOMINATOR_V1.
  // `processed: 0` is meaningless without knowing whether the topic was EMPTY, the BUDGET ran out, or a poll
  // THREW; those are three different faults and a bare zero names none of them. This is the number that
  // replaces `publishedOf` as the walk's health signal: it counts messages this route actually handed to the
  // worker, not messages a producer handed to a queue.
  const body = {
    ok: errors.length === 0,
    topic: TOPIC, group: GROUP, region: REGION,
    processed, stopped, empty, worstMessageMs: worstMs,
    // ⛔ THE ASSUMPTION, CHECKED AGAINST THE RUN THAT JUST HAPPENED. `queue-drain-fits-the-interval` proves
    // the arithmetic at build time from ASSUMED_MAX_MESSAGE_MS; this proves it against reality, on every
    // invocation, and names the breach instead of leaving it to be inferred from falling behind.
    assumedMaxMessageMs: ASSUMED_MAX_MESSAGE_MS,
    capacityAssumptionHeld: worstMs <= ASSUMED_MAX_MESSAGE_MS,
    elapsedMs: Date.now() - started, budgetMs: POLL_BUDGET_MS, maxDurationS: CONSUMER_MAX_DURATION_S,
    errors,
  }
  console.log('[universe-poll]', JSON.stringify(body))
  return NextResponse.json(body, { status: errors.length ? 500 : 200 })
}
