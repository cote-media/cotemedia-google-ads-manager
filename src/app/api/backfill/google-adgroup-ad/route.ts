// LORAMER_GOOGLE_ADGROUP_AD_BACKFILL_ROUTE_V1
// CRON_SECRET-bearer GET wrapper over runGoogleAdGroupAdBackfill. MIRRORS /api/backfill/google-campaign:
// STATELESS year-window endDate→startDate loop with resumeBefore (no cursor / no sync_state), ~250s budget,
// force-no-store (L52), writer-agnostic loop control (status===200 + subStart<=startDate). Clamps startDate
// to the 36-month granular floor (Google DateRangeErrors on pre-floor daily granular) + a defense-in-depth
// DateRangeError graceful-stop for the fuzzy 37-mo boundary. The writer is UNCHANGED.
import { NextResponse } from 'next/server'
import { runGoogleAdGroupAdBackfill } from '@/lib/backfill/google-adgroup-ad-backfill'

export const maxDuration = 300
export const dynamic = 'force-dynamic'
export const fetchCache = 'force-no-store'

const BUDGET_MS = 250_000
const WINDOW_DAYS = 365

const iso = (d: Date) => d.toISOString().split('T')[0]
function addDays(s: string, n: number): string {
  const d = new Date(s + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return iso(d)
}
// "Yesterday" in US Eastern civil time (forward capture's target day; the default backfill end).
function etYesterday(): string {
  const nowEt = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }))
  nowEt.setDate(nowEt.getDate() - 1)
  const y = nowEt.getFullYear(), m = String(nowEt.getMonth() + 1).padStart(2, '0'), d = String(nowEt.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}
// 36-month granular floor (safety margin under Google's ~37-mo rolling cap). We NEVER request below this:
// pre-floor daily granular DateRangeErrors (it does NOT empty).
function googleGranularFloor(): string {
  const d = new Date()
  d.setUTCMonth(d.getUTCMonth() - 36)
  return iso(d)
}

const emptyTot = () => ({ grainDayRows: 0, written: 0, daysWritten: 0, daysFlagged: 0 })

export async function GET(request: Request) {
  const envSecret = (process.env.CRON_SECRET ?? '').trim()
  const authHeader = request.headers.get('authorization') ?? ''
  const got = (authHeader.startsWith('Bearer ') ? authHeader.slice('Bearer '.length) : authHeader).trim()
  if (!envSecret || got !== envSecret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { searchParams } = new URL(request.url)
  const clientId = searchParams.get('clientId')
  if (!clientId) return NextResponse.json({ error: 'Missing clientId' }, { status: 400 })
  const requestedStart = searchParams.get('startDate')
  if (!requestedStart) return NextResponse.json({ error: 'Missing startDate (YYYY-MM-DD)' }, { status: 400 })
  const endDate = searchParams.get('endDate') || etYesterday()
  const dryRun = searchParams.get('dryRun') === 'true'

  // FLOOR-CLAMP (primary guard, Google-specific): never request pre-floor granular.
  const floor = googleGranularFloor()
  const startDate = requestedStart < floor ? floor : requestedStart
  const clampedFrom = requestedStart < floor ? requestedStart : null

  if (endDate < startDate) {
    return NextResponse.json({ error: 'endDate is before the (clamped) startDate', startDate, endDate, floor }, { status: 400 })
  }

  const started = Date.now()
  let curEnd = endDate
  let complete = false
  let resumeBefore: string | null = null
  let floorHit = false
  const subRanges: any[] = []
  const flagged: any[] = []
  const totAdGroup = emptyTot()
  const totAd = emptyTot()
  let firstSampleRow: Record<string, unknown> | null = null

  const accumulate = (tot: ReturnType<typeof emptyTot>, g: any) => {
    if (!g) return
    tot.grainDayRows += g.grainDayRows || 0
    tot.written += g.written || 0
    tot.daysWritten += g.daysWritten || 0
    tot.daysFlagged += g.daysFlagged || 0
  }

  while (true) {
    if (curEnd < startDate) { complete = true; break }
    if (Date.now() - started > BUDGET_MS) { complete = false; resumeBefore = curEnd; break }
    let subStart = addDays(curEnd, -(WINDOW_DAYS - 1))
    if (subStart < startDate) subStart = startDate
    let body: any
    try {
      const res = await runGoogleAdGroupAdBackfill(clientId, subStart, curEnd, { dryRun })
      if (res.status !== 200) {
        return NextResponse.json({ error: 'writer failed', subRange: `${subStart}→${curEnd}`, detail: res.body }, { status: res.status })
      }
      body = res.body
    } catch (e: any) {
      const msg = String(e?.message ?? e ?? '')
      // DEFENSE-IN-DEPTH: a DateRangeError at the fuzzy 37-mo boundary = floor reached → stop gracefully (never a 500).
      if (/DateRangeError|date.?range|requested.*too far|segments\.date/i.test(msg)) {
        floorHit = true; complete = true; break
      }
      return NextResponse.json({ error: 'writer threw', subRange: `${subStart}→${curEnd}`, detail: msg }, { status: 500 })
    }
    accumulate(totAdGroup, body.adGroup)
    accumulate(totAd, body.ad)
    subRanges.push({ range: body.range, adGroup: body.adGroup, ad: body.ad })
    flagged.push(...(body.flagged || []))
    if (dryRun && !firstSampleRow && body.sampleRow) firstSampleRow = body.sampleRow
    if (subStart <= startDate) { complete = true; break }
    curEnd = addDays(subStart, -1) // step to the next-older window
  }

  return NextResponse.json({
    clientId,
    range: { requested: `${requestedStart}→${endDate}`, effective: `${startDate}→${endDate}`, floor, clampedFrom },
    dryRun, complete, resumeBefore, floorHit,
    totalWritten: totAdGroup.written + totAd.written,
    adGroup: totAdGroup, ad: totAd,
    subRanges, flagged,
    ...(dryRun && firstSampleRow ? { sampleRow: firstSampleRow } : {}),
  }, { status: 200 })
}
