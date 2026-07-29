// LORAMER_META_ASSET_ROUTE_V1
// CRON_SECRET-bearer GET wrapper over runMetaAssetBackfill — the thin targeted-invoke TWIN that every other Meta
// breadth writer already has and assets alone were missing (nine siblings exist under /api/backfill/meta-*; grep
// showed runMetaAssetBackfill imported in exactly ONE place, drain-registry.ts:30, so the 4-fires-a-day drain was
// the only way to reach it). MIRRORS /api/backfill/meta-video and /api/backfill/meta-placement EXACTLY: same auth
// block, same clientId/startDate/endDate/dryRun params, same STATELESS bounded-range loop from endDate BACKWARD
// within a wall-clock budget, same { complete, resumeBefore, subRanges, totalWritten } response contract.
// Freeze-safe backend, no UI, additive only — the drain, drain-registry, meta-asset-backfill.ts, the 9-day drain
// window and the meta:4 per-fire cap are all UNTOUCHED.
//
// ⛔ STATELESS ON PURPOSE — NO CURSOR, NO sync_state WRITE. Both siblings say this in as many words ("NO cursor /
// NO sync_state — the drain's rangeLap owns the 'meta_video' cursor"). Sharing the drain's `meta_asset` cursor
// was considered and REJECTED: rangeLap (drain-registry.ts:189-205) does an unguarded read-modify-write on
// backfill_earliest_date, and the '__drain_meta' claim leases the CONNECTION for drain laps only — it would not
// exclude this route. Two writers on one cursor is a lost-update race in both directions (this route could rewind
// the drain's frontier, or the drain could rewind this route's). Staying stateless removes the shared mutable
// state entirely, which is the only race-free option that does not touch the drain. THE ACCEPTED COST, stated
// rather than discovered later: the drain's cursor does NOT learn what this route captured, so the drain will
// re-walk ground already covered. That is WASTEFUL, NOT WRONG — every write is an idempotent upsert on
// METRICS_DAILY_CONFLICT, so a re-walk rewrites byte-identical rows. Reconciling the cursor afterwards is a
// separate decision, deliberately not made here.
//
// FLOOR36 IS ENFORCED HERE, not inherited. The siblings take startDate on trust; assets ride Meta's ~37-month
// aggregate wall (drain-registry.ts:127), so a caller-supplied startDate older than the wall is CLAMPED and the
// clamp is reported. Fetching past the wall returns nothing and burns calls.
// spend>0 filtering needs nothing added — runMetaAssetBackfill:161 already filters GREATER_THAN 0, so dormant
// months cost one cheap empty report each.
//
// SUB-RANGES ARE CALENDAR MONTHS, NOT A ROLLING DAY COUNT — and this is a CORRECTION, banked in the file so the
// reasoning cannot drift back. The first version used a rolling 30-day window on the theory that it would match
// the WRITER'S OWN internal monthChunks() (meta-asset-backfill.ts:40-51) at one chunk per sub-range. Gate-A
// REFUTED that: a rolling 30-day window STRADDLES month boundaries, so every sub-range produced TWO chunks and
// 66 reports — double the drain's proven per-lap load, while the header claimed parity with it. Aligning each
// sub-range to a single calendar month makes monthChunks() emit exactly ONE chunk, i.e. 33 reports
// (11 breakdowns × 3 entity levels), which IS the load the drain already runs and has proven
// (drain-registry.ts:129-131, "33 reports/lap ... SLIGHTLY UNDER the proven load"). This route therefore invents
// no new call shape at all — it runs the SAME shaped lap repeatedly inside one invocation until the wall-clock
// budget, instead of once per cron fire. THE LESSON, since it cost a Gate-A to find: a window that is 'about a
// month' is not a month, and the chunker downstream is what decides the real load.
import { NextResponse } from 'next/server'
import { runMetaAssetBackfill } from '@/lib/backfill/meta-asset-backfill'
// LORAMER_META_ASSET_BUDGET_HEADROOM_V1 — the headroom rule lives in its own module so it is provable without a
// server (a Next route file may not export arbitrary symbols).
import { shouldStartAnotherLap } from '@/lib/backfill/lap-budget'

export const maxDuration = 300
export const dynamic = 'force-dynamic'
export const fetchCache = 'force-no-store'

const BUDGET_MS = 250_000
const REPORTS_PER_CHUNK = 33 // 11 breakdowns × 3 entity levels — drain-registry.ts:130, for the plan estimate only

const iso = (d: Date) => d.toISOString().split('T')[0]
function addDays(s: string, n: number): string {
  const d = new Date(s + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return iso(d)
}
// "Yesterday" in US Eastern civil time (forward capture's target day; the default backfill end). Verbatim from
// the sibling routes so the default end never drifts between them.
function etYesterday(): string {
  const nowEt = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }))
  nowEt.setDate(nowEt.getDate() - 1)
  const y = nowEt.getFullYear(), m = String(nowEt.getMonth() + 1).padStart(2, '0'), d = String(nowEt.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}
// First day of the calendar month containing `s`. This is what makes one sub-range == one monthChunk.
function monthStart(s: string): string {
  return s.slice(0, 8) + '01'
}
// Meta's ~37-month aggregate wall, computed the SAME way the drain computes it (drain-registry.ts:68-72) so the
// two can never disagree about where the wall is.
function floor36(): string {
  const d = new Date()
  d.setUTCMonth(d.getUTCMonth() - 36)
  return iso(d)
}
// The writer's own chunker, mirrored for the plan estimate. Kept identical to meta-asset-backfill.ts:40-51 —
// if that ever changes, the plan's report count is wrong and this comment is where to look.
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
  if (!envSecret || got !== envSecret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { searchParams } = new URL(request.url)
  const clientId = searchParams.get('clientId')
  if (!clientId) return NextResponse.json({ error: 'Missing clientId' }, { status: 400 })
  const rawStart = searchParams.get('startDate')
  if (!rawStart) return NextResponse.json({ error: 'Missing startDate (YYYY-MM-DD)' }, { status: 400 })
  const endDate = searchParams.get('endDate') || etYesterday()
  const dryRun = searchParams.get('dryRun') === 'true'
  // PLAN mode is this route's own, and it exists because the WRITER'S dryRun is not a plan: it still issues every
  // Meta call and only skips the DB write (meta-asset-backfill.ts:211). plan=true never calls the writer at all,
  // so Gate-A can prove boundaries, resume and termination with ZERO live Meta calls and zero writes.
  const plan = searchParams.get('plan') === 'true'

  // FLOOR CLAMP — never fetch past the retention wall.
  const floor = floor36()
  const startDate = rawStart < floor ? floor : rawStart
  const clamped = startDate !== rawStart
  if (endDate < startDate) {
    return NextResponse.json({
      error: 'endDate is before startDate', startDate, endDate,
      ...(clamped ? { clampedToFloor36: floor, requestedStartDate: rawStart } : {}),
    }, { status: 400 })
  }

  const writer = runMetaAssetBackfill

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

  while (true) {
    if (curEnd < startDate) { complete = true; break }
    // LORAMER_META_ASSET_BUDGET_HEADROOM_V1 — reserve headroom for the lap we are ABOUT to run, measured from
    // the laps already run this invocation. Breaking here is the SUCCESS path: it returns resumeBefore so the
    // caller can chain, which is exactly what the 504 was destroying.
    if (!plan && !shouldStartAnotherLap(Date.now() - started, maxLapMs, BUDGET_MS)) { complete = false; resumeBefore = curEnd; break }
    let subStart = monthStart(curEnd)
    if (subStart < startDate) subStart = startDate

    if (plan) {
      const chunks = monthChunks(subStart, curEnd)
      plannedChunks += chunks.length
      plannedReports += chunks.length * REPORTS_PER_CHUNK
      subRanges.push({ range: `${subStart}→${curEnd}`, monthChunks: chunks.map((c) => `${c.from}→${c.to}`), reports: chunks.length * REPORTS_PER_CHUNK })
    } else {
      const lapStart = Date.now()
      const { status, body } = await writer(clientId, subStart, curEnd, { dryRun })
      const thisLap = Date.now() - lapStart
      lapMs.push(thisLap)
      if (thisLap > maxLapMs) maxLapMs = thisLap
      if (status !== 200) {
        return NextResponse.json({ error: 'writer failed', subRange: `${subStart}→${curEnd}`, detail: body }, { status })
      }
      subRanges.push({ range: body.range, written: body.written, levels: body.levelsQueried ?? body.levels })
      totalWritten += body.written || 0
    }

    if (subStart <= startDate) { complete = true; break }
    curEnd = addDays(subStart, -1) // step to the next-older window
  }

  return NextResponse.json({
    clientId, startDate, endDate, dryRun, plan, complete, resumeBefore,
    subRangeShape: 'calendar-month (one monthChunk == 33 reports)',
    floor36: floor,
    ...(clamped ? { clampedToFloor36: true, requestedStartDate: rawStart } : {}),
    ...(plan ? { plannedSubRanges: subRanges.length, plannedChunks, plannedReports, subRanges }
             : { totalWritten, subRanges, lapsRun: lapMs.length, maxLapMs, lapMs,
                 reportsIssued: lapMs.length * REPORTS_PER_CHUNK,
                 // NOT AVAILABLE, stated rather than omitted: Meta's X-Business-Use-Case-Usage is consumed inside
                 // runMetaAssetBackfill and never returned, so this route cannot surface it without changing the
                 // writer. Throttle status therefore remains observable only via a writer error or the Vercel
                 // error clusters. Named as a known blind spot.
                 butHeader: 'unavailable — writer does not expose Meta response headers' }),
  }, { status: 200 })
}
