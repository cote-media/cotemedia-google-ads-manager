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
import { loadUniverse, selectableEntries } from '@/lib/backfill/google-ads-universe-writer'
import { decidePublish } from '@/lib/backfill/universe-governor'
import { readBackfillRequestsToday } from '@/lib/backfill/universe-run-state'
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

  const entries = selectableEntries(loadUniverse())
  const spent = await readBackfillRequestsToday()
  const gov = decidePublish({ spentRequestsToday: spent, want: entries.length })

  // ⛔ THE GOVERNOR DECIDES BEFORE ANYTHING IS PUBLISHED. Zero is a valid answer and is reported, not retried.
  if (!gov.mayPublish) {
    return NextResponse.json({ started: false, published: 0, reason: gov.reason, denominator: gov.denominator }, { status: 200 })
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
  return NextResponse.json({
    started: !dryRun, dryRun, published, wouldPublish: toPublish.length,
    entriesSelectable: entries.length, window: { startDate, endDate, windowDays: WINDOW_DAYS },
    governor: { reason: gov.reason, denominator: gov.denominator },
  })
}
