// LORAMER_META_ADSET_AD_BACKFILL_ROUTE_V1
// CRON_SECRET-bearer GET wrapper over runMetaAdSetAdBackfill. Mirrors /api/backfill/meta-campaign:
// stateless year-window endDate→startDate loop with resumeBefore (no cursor), ~250s budget, force-no-store,
// 36-mo floor-clamp (Lesson 61 Meta THROWS past floor) + defensive past-floor catch. Per-grain aggregation
// like /api/backfill/google-adgroup-ad. The writer reconciles account SPEND per day FLAG-NOT-BLOCK across
// BOTH grains (ad_set, ad); conversions are NOT gated (Meta account-level dedup).
import { NextResponse } from 'next/server'
import { runMetaAdSetAdBackfill } from '@/lib/backfill/meta-adset-ad-backfill'

export const maxDuration = 300
export const dynamic = 'force-dynamic'
export const fetchCache = 'force-no-store'

const BUDGET_MS = 250_000
const WINDOW_DAYS = 365

const iso = (d: Date) => d.toISOString().split('T')[0]
function addDays(s: string, n: number): string {
  const d = new Date(s + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return iso(d)
}
function etYesterday(): string {
  const nowEt = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }))
  nowEt.setDate(nowEt.getDate() - 1)
  const y = nowEt.getFullYear(), m = String(nowEt.getMonth() + 1).padStart(2, '0'), d = String(nowEt.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}
// 36-month granular floor (safety margin under Meta's ~37-mo rolling cap). We NEVER request below this:
// pre-floor granular THROWS on Meta (Lesson 61 — it does NOT empty).
function metaGranularFloor(): string {
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

  const floor = metaGranularFloor()
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
  const totAdSet = emptyTot()
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
      const res = await runMetaAdSetAdBackfill(clientId, subStart, curEnd, { dryRun })
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
    accumulate(totAdSet, body.adSet)
    accumulate(totAd, body.ad)
    subRanges.push({ range: body.range, adSet: body.adSet, ad: body.ad })
    flagged.push(...(body.flagged || []))
    if (dryRun && !firstSampleRow && body.sampleRow) firstSampleRow = body.sampleRow
    if (subStart <= startDate) { complete = true; break }
    curEnd = addDays(subStart, -1) // step to the next-older window
  }

  return NextResponse.json({
    clientId,
    range: { requested: `${requestedStart}→${endDate}`, effective: `${startDate}→${endDate}`, floor, clampedFrom },
    dryRun, complete, resumeBefore, floorHit,
    totalWritten: totAdSet.written + totAd.written,
    adSet: totAdSet, ad: totAd,
    subRanges, flagged,
    ...(dryRun && firstSampleRow ? { sampleRow: firstSampleRow } : {}),
  }, { status: 200 })
}
