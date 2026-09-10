// LORAMER_FORWARD_DRIVER_V1 (2/2) — THE CALLER. One cron route, one bearer, one driver invocation per fire.
//
// The catalogue-only forward driver (src/lib/backfill/forward-driver.ts — HEAVY 50 + REST 269 surfaces per eligible
// google connection, the frozen legacy path untouched, DRIVER_EXCLUDED_CLIENTS filtered before any claim) has exactly
// this caller. Vercel fires it `*/10 11-16 * * *` UTC — a 36-slot window that opens after google sync (8-58/10 8-10)
// and catchup (9-59/10 8-11) have ended, so a driver fire never shares a host with the legacy pass (ruling m: the
// write rate fell 1,448–1,756 → 499 rows/s with three clients on one fire) — plus two make-up fires at 17:30Z and
// 21:30Z (ruling q's shape, shifted to sit after the window; an idle make-up costs one ledger read per connection).
// Completeness is READ FROM THE LEDGER at 17:00Z by check:data leg forward-driver-connection-day-complete, never from
// this schedule (ruling q). Vercel's delivery caveats (no retry, occasional missed or duplicated fires) are designed
// for: the pending predicate re-finds a missed fire's work, and the CAS lease (`__fwd_google:<slice>`, 900 s) makes a
// duplicated fire lose its claim rather than write twice.
//
// ⛔ AUTH IS universe-resume's: `Bearer $CRON_SECRET` or 401. tests/guards/driver-caller-is-cron-only.guard.mjs pins the
// check before the call, the single importer, and the three vercel.json entries.
// ⛔ ON BUDGET EXHAUSTION THIS RETURNS 200 WITH THE PENDING COUNT — the next slot continues. Nothing here throws to the
// platform: an error is a 500 JSON body AND a finished cron_runs row with error_count, never an unstamped row.
import { NextResponse } from 'next/server'
import { runForwardDriver, DRIVER_MAX_DURATION_S, DRIVER_EXCLUDED_CLIENTS } from '@/lib/backfill/forward-driver'
import { detectTrigger, startCronRuns, finishCronRun } from '@/lib/cron-runs'

export const dynamic = 'force-dynamic'
export const fetchCache = 'force-no-store'
// = DRIVER_MAX_DURATION_S (800): the driver's lease is derived from this ceiling; unit-lease-covers-max-duration pins the
// driver's constant to cron/sync's maxDuration and driver-caller-is-cron-only pins this literal to 800.
export const maxDuration = 800

const yesterdayUTC = (): string => { const d = new Date(); d.setUTCDate(d.getUTCDate() - 1); return d.toISOString().slice(0, 10) }

export async function GET(request: Request) {
  const envSecret = (process.env.CRON_SECRET ?? '').trim()
  const authHeader = request.headers.get('authorization') ?? ''
  const got = (authHeader.startsWith('Bearer ') ? authHeader.slice('Bearer '.length) : authHeader).trim()
  if (!envSecret || got !== envSecret) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  if (DRIVER_MAX_DURATION_S !== maxDuration) return NextResponse.json({ error: `maxDuration ${maxDuration} ≠ DRIVER_MAX_DURATION_S ${DRIVER_MAX_DURATION_S}` }, { status: 500 })

  const url = new URL(request.url)
  const dateParam = url.searchParams.get('date')
  const targetDate = dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam) ? dateParam : yesterdayUTC()
  // ?clientId= is the SMOKE/manual filter only (universe-resume's template carries the same param); the schedule
  // never passes it — every eligible connection is the driver's, minus DRIVER_EXCLUDED_CLIENTS.
  const clientId = url.searchParams.get('clientId')
  const trigger = detectTrigger(request)

  const ids = await startCronRuns({ mode: 'driver', platforms: ['google'], trigger, targetDate })
  const cronRunId = ids.google ?? null
  try {
    const report = await runForwardDriver({ targetDate, cronRunId, clientIds: clientId ? [clientId] : undefined })
    const ran = report.units.filter((u) => u.ran)
    const pending = report.units.filter((u) => !u.ran && u.pendingSurfaces > 0)
    const clientsRan = new Set(ran.map((u) => u.clientId)).size
    const rows = ran.reduce((s, u) => s + u.rows, 0)
    const errors = ran.reduce((s, u) => s + u.errors + u.observationFailures, 0)
    await finishCronRun(cronRunId, {
      connectionsAttempted: clientsRan, connectionsSucceeded: clientsRan, connectionsErrored: 0,
      rowsWritten: rows, errorCount: errors,
    })
    return NextResponse.json({
      ok: true, targetDate, cronRunId, trigger, elapsedMs: report.elapsedMs,
      catalogue: { surfaces: report.catalogueSurfaces, heavy: report.heavySurfaces, rest: report.restSurfaces },
      excludedClients: DRIVER_EXCLUDED_CLIENTS,
      unitsRan: ran.length, unitsPending: pending.length, clientsRan, rows, errors,
      units: report.units.map((u) => ({
        clientId: u.clientId, customerId: u.customerId, slice: u.slice, pendingSurfaces: u.pendingSurfaces, decision: u.decision,
        claimed: u.claimed, ran: u.ran, estimateMs: u.estimateMs, actualMs: u.actualMs, rows: u.rows, apiRows: u.apiRows,
        requests: u.requests, errors: u.errors, observationFailures: u.observationFailures, deferredForDeadline: u.deferredForDeadline,
        window: u.windowStart ? `${u.windowStart}..${u.windowEnd}` : null,
      })),
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`[forward-driver] fire FAILED target=${targetDate}: ${message}`)
    await finishCronRun(cronRunId, { connectionsAttempted: 0, connectionsSucceeded: 0, connectionsErrored: 0, rowsWritten: 0, errorCount: 1 })
    return NextResponse.json({ ok: false, targetDate, cronRunId, error: message }, { status: 500 })
  }
}
