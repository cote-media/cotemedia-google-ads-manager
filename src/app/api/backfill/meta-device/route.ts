// LORAMER_META_DEVICE_BREADTH_V1
// CRON_SECRET-bearer GET wrapper over runMetaDeviceBackfill. Mirrors /api/backfill/meta-placement (the generic
// range-shape invoker) — STATELESS bounded-range loop from endDate BACKWARD toward startDate within a wall-clock
// budget; NO cursor / NO sync_state (the drain's rangeLap owns the 'meta_device' cursor). WINDOW_DAYS=60 (NOT 365)
// because device runs 4 entity levels × 2 device fields = 8 reports/sub-range — keep each sub-range bounded.
import { NextResponse } from 'next/server'
import { runMetaDeviceBackfill } from '@/lib/backfill/meta-device-backfill'

export const maxDuration = 300
export const dynamic = 'force-dynamic'
export const fetchCache = 'force-no-store'

const BUDGET_MS = 250_000
const WINDOW_DAYS = 60

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
  const startDate = searchParams.get('startDate')
  if (!startDate) return NextResponse.json({ error: 'Missing startDate (YYYY-MM-DD)' }, { status: 400 })
  const endDate = searchParams.get('endDate') || etYesterday()
  const dryRun = searchParams.get('dryRun') === 'true'
  if (endDate < startDate) {
    return NextResponse.json({ error: 'endDate is before startDate' }, { status: 400 })
  }

  const writer = runMetaDeviceBackfill

  const started = Date.now()
  let curEnd = endDate
  let complete = false
  let resumeBefore: string | null = null
  const subRanges: any[] = []
  const flagged: any[] = []
  let totalWritten = 0, totalDaysFlagged = 0

  while (true) {
    if (curEnd < startDate) { complete = true; break }
    if (Date.now() - started > BUDGET_MS) { complete = false; resumeBefore = curEnd; break }
    let subStart = addDays(curEnd, -(WINDOW_DAYS - 1))
    if (subStart < startDate) subStart = startDate
    const { status, body } = await writer(clientId, subStart, curEnd, { dryRun })
    if (status !== 200) {
      return NextResponse.json({ error: 'writer failed', subRange: `${subStart}→${curEnd}`, detail: body }, { status })
    }
    subRanges.push({ range: body.range, written: body.written, daysFlagged: body.daysFlagged, reconcile: body.reconcile })
    totalWritten += body.written || 0
    totalDaysFlagged += body.daysFlagged || 0
    flagged.push(...(body.flagged || []))
    if (subStart <= startDate) { complete = true; break }
    curEnd = addDays(subStart, -1) // step to the next-older window
  }

  return NextResponse.json({
    clientId, startDate, endDate, dryRun, complete, resumeBefore,
    totalWritten, totalDaysFlagged,
    subRanges, flagged,
  }, { status: 200 })
}
