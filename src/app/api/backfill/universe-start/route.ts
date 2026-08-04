// LORAMER_GOOGLE_ADS_UNIVERSE_RUNNER_V1 — THE STARTER. ⛔ MANUAL, AUTHENTICATED, AND ON NO SCHEDULE.
//
// ⛔ THERE IS DELIBERATELY NO CRON ENTRY FOR THIS ROUTE. A cron would start the run, and this flight ships
// WIRED BUT NOT FIRED. Russ starts it explicitly. Nothing in vercel.json fires either this or the consumer.
//
// WHAT IT DOES ON THE FIRST CALL, stated so the first invocation holds no surprises:
//   1. asserts the CRON_SECRET (same posture as every other backfill route),
//   2. loads the universe artifact and selects the entries that DELIVER and are date-combinable,
//   3. asks the governor how many messages it may publish — and publishes NOTHING if the answer is zero,
//   4. publishes ONE message per allowed entry for the MOST RECENT window only.
// From there each consumer re-publishes its own next window, so the queue holds O(1) messages per entry
// rather than O(months) — the retention pattern, not a pre-published walk.
import { NextResponse } from 'next/server'
import { send } from '@vercel/queue'
import { loadUniverse, selectableEntries, deferredEntries, entityLevelFor } from '@/lib/backfill/google-ads-universe-writer'
import { decidePublish } from '@/lib/backfill/universe-governor'
import { checkDiskFloor, readLaneSpendToday, gb, FLOOR_BYTES, PROVISIONED_BYTES } from '@/lib/backfill/universe-window-log'
import { TOPIC, WINDOW_DAYS, type UniverseMessage } from '@/app/api/queues/google-ads-universe/route'
import { supabaseAdmin } from '@/lib/supabase'

export const dynamic = 'force-dynamic'
// ⛔ LORAMER_NO_CACHED_DB_READ_V1 — this route reads google_tokens / platform_connections, and a read that
// GATES A WRITE may never be served from Next's Data Cache. A stale refresh token on an UNATTENDED 3am queue
// consumer is the exact silent failure: the fetch fails auth, the message retries, and nothing looks broken.
export const fetchCache = 'force-no-store'
export const maxDuration = 300

const addDays = (iso: string, n: number) => {
  const d = new Date(`${iso}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10)
}

export async function POST(request: Request) {
  const auth = request.headers.get('authorization')
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  const url = new URL(request.url)
  const clientId = url.searchParams.get('clientId')
  const endDate = url.searchParams.get('endDate') || ''
  const dryRun = url.searchParams.get('dryRun') === '1'
  if (!clientId || !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
    return NextResponse.json({ error: 'clientId and endDate=YYYY-MM-DD are required — the first window is explicit, never inferred from a clock' }, { status: 400 })
  }

  const { data: conn, error } = await supabaseAdmin.from('platform_connections')
    .select('account_id, user_email').eq('client_id', clientId).eq('platform', 'google').maybeSingle()
  if (error || !conn?.account_id || !conn?.user_email) {
    return NextResponse.json({ error: `no google connection for ${clientId}: ${error?.message ?? 'not found'}` }, { status: 404 })
  }

  const doc = loadUniverse()
  const entries = selectableEntries(doc)
  const deferred = deferredEntries(doc)

  // ⛔ THE DISK FLOOR IS A START GATE TOO, NOT ONLY A PER-WINDOW ONE. Starting a walk that must stop
  // three windows in is worse than not starting: it spends vendor quota, writes partial history, and
  // leaves the operator reading a "started" response for a run that cannot finish.
  // ⛔ PROJECTION, NOT JUST THE INSTANTANEOUS READ. The measured cost is 4.53 GB/window
  // (LORAMER_UNIVERSE_ONE_WINDOW_MEASURED_V1: 5,448,391 rows at 832 B/row). Reporting how many of the
  // 50 windows actually FIT is the difference between "there is disk right now" and "this walk can
  // complete", and only the second one is a reason to start.
  const floor = await checkDiskFloor()
  const MEASURED_BYTES_PER_WINDOW = Math.round(4.53 * 1024 ** 3)
  const usable = Math.max(0, floor.freeBytes - FLOOR_BYTES)
  const windowsAffordable = Math.floor(usable / MEASURED_BYTES_PER_WINDOW)
  const disk = {
    freeBytes: floor.freeBytes, free: gb(floor.freeBytes), used: gb(floor.usedBytes),
    provisioned: gb(PROVISIONED_BYTES), floor: gb(FLOOR_BYTES), usableAboveFloor: gb(usable),
    measuredBytesPerWindow: gb(MEASURED_BYTES_PER_WINDOW),
    windowsAffordable, windowsInWalk: 50,
    verdict: windowsAffordable >= 50
      ? `the full 50-window walk fits above the floor`
      : `⛔ ONLY ${windowsAffordable} OF 50 WINDOWS FIT above the floor — this walk CANNOT complete on the current volume. It will stop cleanly at the floor partway through.`,
  }
  if (!floor.ok) {
    return NextResponse.json({ started: false, published: 0, reason: floor.reason, disk }, { status: 200 })
  }

  const spent = await readLaneSpendToday()
  const gov = decidePublish({ spentRequestsToday: spent, want: entries.length })

  // ⛔ THE GOVERNOR DECIDES BEFORE ANYTHING IS PUBLISHED. Zero is a valid answer and is reported, not retried.
  if (!gov.mayPublish) {
    return NextResponse.json({ started: false, published: 0, reason: gov.reason, denominator: gov.denominator, disk }, { status: 200 })
  }

  const startDate = addDays(endDate, -(WINDOW_DAYS - 1))
  const toPublish = entries.slice(0, gov.allowance)
  let published = 0
  if (!dryRun) {
    for (const entry of toPublish) {
      const label = `${entry.resource}${entry.segment ? '/' + entry.segment : ''}`
      const msg: UniverseMessage = { clientId, userEmail: conn.user_email, customerId: String(conn.account_id), entry, startDate, endDate }
      await send(TOPIC, msg, { idempotencyKey: `${clientId}|${label}|${startDate}` } as any)
      published++
    }
  }
  // ⛔ THE FAN-OUT IS REPORTED, NOT LEFT TO BE INFERRED (LORAMER_UNIVERSE_ENTITY_AXIS_V1). Before the entity
  // axis every entry landed at one flat level, so there was nothing to report and nothing to check; now the
  // grain is the VENDOR'S FROM RESOURCE and a dry run that did not state it would hide the entire change.
  // This is computed from the ARTIFACT ALONE — no vendor call, no DB read — so it costs nothing to ask for.
  const perGrain: Record<string, number> = {}
  for (const e of entries) perGrain[entityLevelFor(e)] = (perGrain[entityLevelFor(e)] || 0) + 1
  const grains = Object.keys(perGrain).sort()

  return NextResponse.json({
    started: !dryRun, dryRun, published, wouldPublish: toPublish.length,
    entriesSelectable: entries.length, window: { startDate, endDate, windowDays: WINDOW_DAYS },
    entityAxis: {
      marker: 'LORAMER_UNIVERSE_ENTITY_AXIS_V1',
      distinctGrains: grains.length,
      note: 'entity_level is the GAQL FROM resource; entity_id is its resource_name. Vendor-named, not mapped. ZERO extra requests — the identity is already in every response (verified live 2026-08-03: same query with and without campaign.id returned 418 rows both times).',
      perGrain,
    },
    governor: { reason: gov.reason, denominator: gov.denominator },
    disk,
    // ⛔ THE DEFERRED SET RIDES ON EVERY START RESPONSE, WITH REASONS. A narrowed walk that did not say what
    // it narrowed would be indistinguishable from a walk that silently lost 12 slots — and six months from
    // now nobody could tell which. ALL-MEANS-ALL is not repealed; this is sequencing under a disk constraint.
    deferred: {
      marker: 'LORAMER_UNIVERSE_NARROWED_SET_V1',
      count: deferred.length,
      savedGBPerWalk: Number(deferred.reduce((a, d) => a + d.note.measuredGBPerWalk, 0).toFixed(2)),
      note: 'DEFERRED, NOT DROPPED. Every entry keeps its declaration and its already-landed rows; only the REQUEST is postponed. No declared family became unreachable — each deferred segment still lands at another entity_level.',
      entries: deferred.map((d) => ({
        entry: `${d.entry.resource}${d.entry.segment ? '/' + d.entry.segment : ''}`,
        reason: d.note.reason,
        measuredRowsPerRequest: d.note.measuredRowsPerRequest,
        measuredGBPerWalk: d.note.measuredGBPerWalk,
        loraLoses: d.note.loraLoses,
      })),
    },
  })
}
