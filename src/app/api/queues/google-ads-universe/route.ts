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
import { loadUniverse, captureUniverseEntry, type UniverseEntry } from '@/lib/backfill/google-ads-universe-writer'
import { recordEntryOutcome, readAllEntryStates, isClientComplete, writeCompletionNotice, readBackfillRequestsToday } from '@/lib/backfill/universe-run-state'
import { decidePublish } from '@/lib/backfill/universe-governor'

export const dynamic = 'force-dynamic'
// ⛔ LORAMER_NO_CACHED_DB_READ_V1 — this route reads google_tokens / platform_connections, and a read that
// GATES A WRITE may never be served from Next's Data Cache. A stale refresh token on an UNATTENDED 3am queue
// consumer is the exact silent failure: the fetch fails auth, the message retries, and nothing looks broken.
export const fetchCache = 'force-no-store'
export const maxDuration = 300

export const TOPIC = 'google-ads-universe'
/** Window size per message. Small enough that one message is one cheap request; the walk is the loop. */
export const WINDOW_DAYS = 30

export interface UniverseMessage {
  clientId: string
  userEmail: string
  customerId: string
  entry: UniverseEntry
  /** Inclusive window this message must capture. The message carries it — nothing is inferred from order. */
  startDate: string
  endDate: string
}

const addDays = (iso: string, n: number) => {
  const d = new Date(`${iso}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10)
}

export const POST = handleCallback(async (msg: UniverseMessage, metadata: any) => {
  const { clientId, userEmail, customerId, entry, startDate, endDate } = msg
  const label = `${entry.resource}${entry.segment ? '/' + entry.segment : ''}`

  // ⛔ THE QUERY IS INJECTED, NOT IMPORTED HERE. Flight 1's writer takes `query` as a parameter precisely so
  // it stays drivable with no network; the vendor client is constructed by the caller below.
  const { googleAdsQueryFor } = await import('@/lib/backfill/universe-vendor-client')
  const query = await googleAdsQueryFor(userEmail, customerId)

  const result = await captureUniverseEntry({
    entry, ctx: { clientId, userEmail, customerId }, startDate, endDate, query,
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
  const stillGoing = result.exhaustion && !result.exhaustion.complete && !result.skipped && !result.error
  if (stillGoing) {
    const gov = decidePublish({ spentRequestsToday: await readBackfillRequestsToday(), want: 1 })
    if (gov.mayPublish) {
      const nextEnd = addDays(startDate, -1)
      const nextStart = addDays(nextEnd, -(WINDOW_DAYS - 1))
      // ⛔ IDEMPOTENCY KEY on the republish: a redelivered message must not fan out a second walk. Any
      // republish with the same key inside the retention window is deduplicated by Vercel.
      await send(TOPIC, { ...msg, startDate: nextStart, endDate: nextEnd } satisfies UniverseMessage,
        { idempotencyKey: `${clientId}|${label}|${nextStart}` } as any)
    } else {
      console.log(`[universe] HOLDING publish for ${clientId} ${label}: ${gov.reason}`)
    }
  }

  // ── DONE SIGNAL ──────────────────────────────────────────────────────────────────────────────────────────
  const doc = loadUniverse()
  const total = doc.entries.filter((e) => e.delivers === true && (e.segment === null || e.dateCombinable === true)).length
  const states = await readAllEntryStates(clientId)
  const done = isClientComplete({ totalEntries: total, states })
  if (done.done) await writeCompletionNotice(clientId, states, total)

  // ⛔ THE GRAIN AND THE DECLINES ARE ON THE LOG LINE ON PURPOSE (LORAMER_UNIVERSE_ENTITY_AXIS_V1). A run
  // that silently wrote everything at one level is indistinguishable from a run that wrote at vendor grain
  // unless the level is stated per message; `declines` is the third state — vendor answered, named no entity.
  console.log(`[universe] ${clientId} ${label} ${startDate}..${endDate} level=${result.entityLevel} apiRows=${result.apiRows} rows=${result.rowsWritten} declines=${result.grainDeclines} zero=${result.observedZero} skipped=${!!result.skipped} msg=${metadata?.messageId} | ${done.reason}`)
})

export async function GET() {
  return NextResponse.json({ error: 'This route is a Vercel Queues consumer and has no public GET.' }, { status: 405 })
}
