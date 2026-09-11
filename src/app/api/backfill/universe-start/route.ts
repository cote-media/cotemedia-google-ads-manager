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
//
// LORAMER_ONE_CLICK_WALK_V1 (1/2) — steps 2–4 now live in src/lib/backfill/universe-start-publish.ts (publishWalkStart),
// the ONE publish core this route and the -next Backfill button share. This file is the HTTP shell: auth, query parsing,
// the 400s for malformed params — byte-identical in behaviour to the inline version it replaced (every literal moved
// verbatim; `rewalk`, `windows`, `resource`/`segment`, `allEntries`, `allowDeadStart`, `dryRun` all still honoured).
import { NextResponse } from 'next/server'
import { WINDOW_DAYS } from '@/app/api/queues/google-ads-universe/route'
import { publishWalkStart } from '@/lib/backfill/universe-start-publish'

export const dynamic = 'force-dynamic'
export const fetchCache = 'force-no-store'
export const maxDuration = 300

export async function POST(request: Request) {
  const auth = request.headers.get('authorization')
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  const url = new URL(request.url)
  const clientId = url.searchParams.get('clientId')
  const endDate = url.searchParams.get('endDate') || ''
  const dryRun = url.searchParams.get('dryRun') === '1'
  const onlyResource = url.searchParams.get('resource')
  const onlySegment = url.searchParams.get('segment')
  const windowDaysParam = url.searchParams.get('windowDays')
  const windowDays = windowDaysParam === null ? WINDOW_DAYS : Number(windowDaysParam)
  if (!Number.isInteger(windowDays) || windowDays < 1 || windowDays > WINDOW_DAYS) {
    return NextResponse.json({ error: `windowDays must be an integer in 1..${WINDOW_DAYS} if supplied; got "${windowDaysParam}"` }, { status: 400 })
  }
  const rewalkParam = url.searchParams.get('rewalk')
  if (rewalkParam !== null && !/^\d+$/.test(rewalkParam)) {
    return NextResponse.json({ error: `rewalk must be a non-negative integer if supplied; got "${rewalkParam}"` }, { status: 400 })
  }
  const allEntries = url.searchParams.get('allEntries') === '1'
  const windowsParam = url.searchParams.get('windows')
  const windowsRemaining = windowsParam === null ? undefined : Number(windowsParam)
  if (windowsRemaining !== undefined && (!Number.isInteger(windowsRemaining) || windowsRemaining < 1)) {
    return NextResponse.json({ error: `windows must be a positive integer if supplied; got "${windowsParam}"` }, { status: 400 })
  }
  if (!clientId || !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
    return NextResponse.json({ error: 'clientId and endDate=YYYY-MM-DD are required — the first window is explicit, never inferred from a clock' }, { status: 400 })
  }

  const { status, body } = await publishWalkStart({
    clientId, endDate, dryRun, onlyResource, onlySegment, windowDays, windowsRemaining, rewalkParam, allEntries,
    allowDeadStart: url.searchParams.get('allowDeadStart') === '1',
  })
  return NextResponse.json(body, { status })
}
