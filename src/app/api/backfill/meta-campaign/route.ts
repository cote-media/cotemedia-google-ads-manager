// LORAMER_META_CAMPAIGN_BACKFILL_ROUTE_V1
// CRON_SECRET-bearer GET wrapper over runMetaCampaignBackfill. MIRRORS /api/backfill/google-campaign:
// STATELESS year-window endDate→startDate loop with resumeBefore (no cursor / no sync_state), ~250s budget,
// force-no-store (L52), writer-agnostic loop control (status===200 + subStart<=startDate). Clamps startDate
// to the 36-month granular floor — per Lesson 61 Meta THROWS past its ~37-mo granular retention (it does
// NOT empty), so we never request below the floor; a defensive past-floor catch graceful-stops as backstop.
// The writer reconciles account-grain SPEND per day FLAG-NOT-BLOCK (V2: always writes, records divergence;
// conversions are NOT gated — Meta account-level dedup → account conversions ≠ Σcampaign conversions).
import { NextResponse } from 'next/server'
import { runMetaCampaignBackfill } from '@/lib/backfill/meta-campaign-backfill'

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
// 36-month granular floor (safety margin under Meta's ~37-mo rolling cap). We NEVER request below this:
// pre-floor granular THROWS on Meta (Lesson 61 — it does NOT empty like a clean boundary).
function metaGranularFloor(): string {
  const d = new Date()
  d.setUTCMonth(d.getUTCMonth() - 36)
  return iso(d)
}

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

  // FLOOR-CLAMP (primary guard): never request pre-floor granular.
  const floor = metaGranularFloor()
  const startDate = requestedStart < floor ? floor : requestedStart
  const clampedFrom = requestedStart < floor ? requestedStart : null

  if (endDate < startDate) {
    return NextResponse.json({ error: 'endDate is before the (clamped) startDate', startDate, endDate, floor }, { status: 400 })
  }

  const writer = runMetaCampaignBackfill

  const started = Date.now()
  let curEnd = endDate
  let complete = false
  let resumeBefore: string | null = null
  let floorHit = false
  const subRanges: any[] = []
  const flagged: any[] = []
  let totalWritten = 0, totalDaysWritten = 0, totalDaysFlagged = 0, totalCampaignDayRows = 0
  const totalOtherDeltas = { clicks: 0, impressions: 0, conversions: 0 }

  while (true) {
    if (curEnd < startDate) { complete = true; break }
    if (Date.now() - started > BUDGET_MS) { complete = false; resumeBefore = curEnd; break }
    let subStart = addDays(curEnd, -(WINDOW_DAYS - 1))
    if (subStart < startDate) subStart = startDate
    let body: any
    try {
      const res = await writer(clientId, subStart, curEnd, { dryRun })
      if (res.status !== 200) {
        return NextResponse.json({ error: 'writer failed', subRange: `${subStart}→${curEnd}`, detail: res.body }, { status: res.status })
      }
      body = res.body
    } catch (e: any) {
      const msg = String(e?.message ?? e ?? '')
      // DEFENSE-IN-DEPTH: a Meta "data too old / time range" error at the fuzzy 37-mo boundary = floor
      // reached → stop gracefully (never a 500). The clamp above normally prevents reaching this.
      if (/too old|time.?range|reduce the amount|date.?range|3018|cannot.*older/i.test(msg)) {
        floorHit = true; complete = true; break
      }
      return NextResponse.json({ error: 'writer threw', subRange: `${subStart}→${curEnd}`, detail: msg }, { status: 500 })
    }
    subRanges.push({ range: body.range, written: body.written, daysWritten: body.daysWritten, daysFlagged: body.daysFlagged, otherDeltas: body.otherDeltas })
    totalWritten += body.written || 0
    totalDaysWritten += body.daysWritten || 0
    totalDaysFlagged += body.daysFlagged || 0
    totalCampaignDayRows += body.campaignDayRows || 0
    totalOtherDeltas.clicks += body.otherDeltas?.clicks || 0
    totalOtherDeltas.impressions += body.otherDeltas?.impressions || 0
    totalOtherDeltas.conversions += body.otherDeltas?.conversions || 0
    flagged.push(...(body.flagged || []))
    if (subStart <= startDate) { complete = true; break }
    curEnd = addDays(subStart, -1) // step to the next-older window
  }

  return NextResponse.json({
    clientId,
    range: { requested: `${requestedStart}→${endDate}`, effective: `${startDate}→${endDate}`, floor, clampedFrom },
    dryRun, complete, resumeBefore, floorHit,
    totalWritten, totalDaysWritten, totalDaysFlagged, totalCampaignDayRows,
    totalOtherDeltas: {
      clicks: Math.round(totalOtherDeltas.clicks),
      impressions: Math.round(totalOtherDeltas.impressions),
      conversions: Number(totalOtherDeltas.conversions.toFixed(2)),
    },
    subRanges, flagged,
  }, { status: 200 })
}
