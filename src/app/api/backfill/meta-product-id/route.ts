// LORAMER_META_PRODUCT_ID_ROUTE_V1
// CRON_SECRET-bearer GET wrapper over runMetaProductIdBackfill — the thin targeted-invoke twin that the
// product_id family was missing. MIRRORS /api/backfill/meta-asset (LORAMER_META_ASSET_DIRECT_ROUTE_V1)
// deliberately and completely: same auth block, same clientId/startDate/endDate/dryRun/plan params, same
// STATELESS bounded-range loop backward from endDate, same calendar-month sub-ranges, same resumeBefore
// chaining contract, same floor36 clamp. Additive backend, no UI; the drain, drain-registry.ts,
// meta-simple-breakdown-core.ts and meta-product-id-backfill.ts are all UNTOUCHED.
//
// ⚠ THE WRITER ALREADY EXISTED — this route is the ONLY thing that was missing, and saying so here is the
// point. meta-product-id-backfill.ts (LORAMER_META_BATCH_MG_V1) has been wired into BOTH forward capture
// (meta-breadth-forward.ts:93) and the drain (drain-registry.ts:409) all along, and has written 69,676 rows
// across five clients. The QUEUE entry that asked for this said "we hold zero product_id rows"; that was true
// of Foam OH ONLY, and honest-empty there behind a cursor at 2026-01-06. Building a writer would have
// duplicated shipped code — the second time the read-first existence check has caught exactly that.
//
// ⛔ STATELESS ON PURPOSE — NO CURSOR, NO sync_state WRITE. Settled at LORAMER_META_ASSET_DIRECT_ROUTE_V1 and
// not re-derived here: rangeLap does an unguarded read-modify-write on backfill_earliest_date and the
// '__drain_meta' claim leases the CONNECTION for drain laps only, so two writers on one cursor is a
// lost-update race in both directions. The accepted cost is that the drain re-walks covered ground — wasteful,
// not wrong, since every write is an idempotent upsert on the 7-col conflict key.
//
// ═══ THE ONE CONSTANT THAT IS NOT INHERITED, AND THE ARITHMETIC BEHIND IT ═══
// REPORTS_PER_CHUNK is 3 here, not 33. product_id runs ONE breakdown across THREE entity levels
// (campaign + ad_set + ad — account is derive-not-capture for this family, meta-simple-breakdown-core.ts:25-28),
// against assets' 11 breakdowns x 3 levels. The lap is ~11x lighter.
// FIRST_LAP_MS therefore had to be re-sized rather than inherited, because inheriting a constant without its
// assumption is precisely the defect that produced LORAMER_META_ASSET_BUDGET_HEADROOM_V1 in the first place:
//   · the asset evidence: a 33-report lap was observed overrunning ~51s of remaining budget (it began at
//     t=249s under a 250s budget and ran past maxDuration 300), and 90_000ms was chosen as a deliberately
//     generous cover for 33 reports. That implies a per-report ceiling of 90_000 / 33 ≈ 2,727ms.
//   · this family: 3 reports x 2,727ms ≈ 8,182ms.
//   · shipped value 30_000ms ≈ 3.7x that estimate. The asymmetry is the reason for the margin: over-reserving
//     costs ONE extra chained GET, under-reserving costs a 504 that destroys the resume contract entirely.
// Lowering the SHARED default was rejected — that would change the asset route's behaviour and re-open the
// class. shouldStartAnotherLap takes the reservation as a PARAMETER; callers that pass nothing are unchanged.
// ⚠ THE ESTIMATE IS DERIVED, NOT MEASURED. maxLapMs is returned on every live response precisely so the first
// real run can confirm or refute it. If observed laps approach 30s, raise it — do not lower it on a hunch.
import { NextResponse } from 'next/server'
import { runMetaProductIdBackfill } from '@/lib/backfill/meta-product-id-backfill'
import { shouldStartAnotherLap } from '@/lib/backfill/lap-budget'

export const maxDuration = 300
export const dynamic = 'force-dynamic'
export const fetchCache = 'force-no-store'

const BUDGET_MS = 250_000
const REPORTS_PER_CHUNK = 3 // 1 breakdown x 3 entity levels (campaign, ad_set, ad)
const FIRST_LAP_MS_PRODUCT_ID = 30_000 // see the arithmetic above

const iso = (d: Date) => d.toISOString().split('T')[0]
function addDays(s: string, n: number): string {
  const d = new Date(s + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return iso(d)
}
// "Yesterday" in US Eastern civil time — verbatim from the sibling so the default end never drifts between them.
function etYesterday(): string {
  const nowEt = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }))
  nowEt.setDate(nowEt.getDate() - 1)
  const y = nowEt.getFullYear(), m = String(nowEt.getMonth() + 1).padStart(2, '0'), d = String(nowEt.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}
// First day of the calendar month containing `s` — what makes one sub-range == exactly one monthChunk.
function monthStart(s: string): string { return s.slice(0, 8) + '01' }
// Meta's ~37-month aggregate wall, computed the SAME way the drain computes it so the two cannot disagree.
function floor36(): string {
  const d = new Date(); d.setUTCMonth(d.getUTCMonth() - 36); return iso(d)
}
// The writer's chunker, mirrored for the plan estimate ONLY. Kept identical to
// meta-simple-breakdown-core.ts monthChunks — if that changes, the plan's report count is wrong and this
// comment is where to look.
function monthChunks(start: string, end: string): { from: string; to: string }[] {
  const chunks: { from: string; to: string }[] = []
  let cur = start
  while (cur <= end) {
    const d = new Date(cur + 'T00:00:00Z')
    const mEnd = iso(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)))
    const to = mEnd < end ? mEnd : end
    chunks.push({ from: cur, to })
    const next = new Date(to + 'T00:00:00Z'); next.setUTCDate(next.getUTCDate() + 1); cur = iso(next)
  }
  return chunks
}

export async function GET(request: Request) {
  const envSecret = (process.env.CRON_SECRET ?? '').trim()
  const authHeader = request.headers.get('authorization') ?? ''
  const got = (authHeader.startsWith('Bearer ') ? authHeader.slice('Bearer '.length) : authHeader).trim()
  if (!envSecret || got !== envSecret) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const clientId = searchParams.get('clientId')
  if (!clientId) return NextResponse.json({ error: 'Missing clientId' }, { status: 400 })
  const rawStart = searchParams.get('startDate')
  if (!rawStart) return NextResponse.json({ error: 'Missing startDate (YYYY-MM-DD)' }, { status: 400 })
  const endDate = searchParams.get('endDate') || etYesterday()
  const dryRun = searchParams.get('dryRun') === 'true'
  // PLAN mode is this route's own. The WRITER'S dryRun is NOT a plan — it still issues every Meta call and
  // only skips the DB write. plan=true never calls the writer, so boundaries/resume/termination are provable
  // with ZERO live Meta calls and zero writes.
  const plan = searchParams.get('plan') === 'true'

  const floor = floor36()
  const startDate = rawStart < floor ? floor : rawStart
  const clamped = startDate !== rawStart
  if (endDate < startDate) {
    return NextResponse.json({
      error: 'endDate is before startDate', startDate, endDate,
      ...(clamped ? { clampedToFloor36: floor, requestedStartDate: rawStart } : {}),
    }, { status: 400 })
  }

  const started = Date.now()
  let curEnd = endDate
  let complete = false
  let resumeBefore: string | null = null
  const subRanges: any[] = []
  let totalWritten = 0
  let plannedReports = 0
  let plannedChunks = 0
  let maxLapMs = 0
  const lapMs: number[] = []
  // LORAMER_META_BREAKDOWN_DEDUPE_V1 — the writer reports every merge it made; surface them so a recovered
  // day that needed a merge is visible in THIS response, not only in a log line that expires in an hour.
  const dedupe: any[] = []

  while (true) {
    if (curEnd < startDate) { complete = true; break }
    if (!plan && !shouldStartAnotherLap(Date.now() - started, maxLapMs, BUDGET_MS, FIRST_LAP_MS_PRODUCT_ID)) {
      complete = false; resumeBefore = curEnd; break
    }
    let subStart = monthStart(curEnd)
    if (subStart < startDate) subStart = startDate

    if (plan) {
      const chunks = monthChunks(subStart, curEnd)
      plannedChunks += chunks.length
      plannedReports += chunks.length * REPORTS_PER_CHUNK
      subRanges.push({ range: `${subStart}→${curEnd}`, monthChunks: chunks.map((c) => `${c.from}→${c.to}`), reports: chunks.length * REPORTS_PER_CHUNK })
    } else {
      const lapStart = Date.now()
      const { status, body } = await runMetaProductIdBackfill(clientId, subStart, curEnd, { dryRun })
      const thisLap = Date.now() - lapStart
      lapMs.push(thisLap)
      if (thisLap > maxLapMs) maxLapMs = thisLap
      if (status !== 200) {
        return NextResponse.json({ error: 'writer failed', subRange: `${subStart}→${curEnd}`, detail: body }, { status })
      }
      subRanges.push({ range: body.range, written: body.written, dedupeMerges: body.dedupeMerges ?? 0 })
      if (Array.isArray(body.dedupe)) dedupe.push(...body.dedupe)
      totalWritten += body.written || 0
    }

    if (subStart <= startDate) { complete = true; break }
    curEnd = addDays(subStart, -1)
  }

  return NextResponse.json({
    clientId, startDate, endDate, dryRun, plan, complete, resumeBefore,
    subRangeShape: 'calendar-month (one monthChunk == 3 reports: 1 breakdown x 3 entity levels)',
    floor36: floor,
    ...(clamped ? { clampedToFloor36: true, requestedStartDate: rawStart } : {}),
    ...(plan ? { plannedSubRanges: subRanges.length, plannedChunks, plannedReports, subRanges }
             : { totalWritten, subRanges, lapsRun: lapMs.length, maxLapMs, lapMs,
                 reportsIssued: lapMs.length * REPORTS_PER_CHUNK,
                 firstLapReservationMs: FIRST_LAP_MS_PRODUCT_ID,
                 dedupeMerges: dedupe.length, ...(dedupe.length ? { dedupe } : {}),
                 // Same known blind spot as the sibling: Meta's X-Business-Use-Case-Usage is consumed inside
                 // the writer and never returned, so this route cannot surface throttle status without
                 // changing the writer. Named rather than omitted.
                 butHeader: 'unavailable — writer does not expose Meta response headers' }),
  }, { status: 200 })
}
