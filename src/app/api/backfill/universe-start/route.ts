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
import { decidePublishFleetAware } from '@/lib/backfill/universe-governor'
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
  // ⛔ LORAMER_UNIVERSE_BOUNDED_RUN_V1 — `?windows=N` bounds the whole chain to N windows per entry.
  // Omitted = unbounded, the original behaviour. `windows=1` is the PROOF run: one window, measured, and the
  // consumer will not re-publish afterwards even though quota and disk would allow it.
  // ── LORAMER_UNIVERSE_FAILURE_IS_DURABLE_V1 — THE ARBITRARY-WINDOW PUBLISHER. ────────────────────────────
  // ⛔ ALL THREE ARE ADDITIVE AND THE ROUTE IS BYTE-IDENTICAL WHEN THEY ARE OMITTED. They exist because three
  // windows are recorded as `abandoned_owed` and NOTHING will re-walk them: the chain only ever moves
  // backward from where it is, and there was no way to say "that window, that size, once".
  //
  // ⛔ ?resource= AND ?segment= ARE THE REAL GAP. `endDate` has ALWAYS been explicit here (see the validation
  // below — "the first window is explicit, never inferred from a clock"), so targeting a historical DATE was
  // never the missing piece. What was missing is targeting ONE ENTRY: without it, re-walking one window fans
  // out to all 346 selectable entries and starts 346 backward chains.
  const onlyResource = url.searchParams.get('resource')
  const onlySegment = url.searchParams.get('segment')
  // ⛔ ?windowDays= sizes the FIRST window and rides the message so every successor inherits it. The three
  // owed windows died at 30; re-walking them at 30 would simply reproduce the death.
  const windowDaysParam = url.searchParams.get('windowDays')
  const windowDays = windowDaysParam === null ? WINDOW_DAYS : Number(windowDaysParam)
  if (!Number.isInteger(windowDays) || windowDays < 1 || windowDays > WINDOW_DAYS) {
    return NextResponse.json({ error: `windowDays must be an integer in 1..${WINDOW_DAYS} if supplied; got "${windowDaysParam}"` }, { status: 400 })
  }
  // ⛔ ?rewalk=N IS THE IDEMPOTENCY DISCRIMINATOR, AND WITHOUT IT A DELIBERATE RE-WALK IS SILENTLY DROPPED.
  // Vercel's dedup window "lasts for the entire lifetime of the original message (up to its TTL)", and we set
  // no per-message TTL, so the 24h default applies. Re-publishing a window whose original message is still
  // live reuses the same key and vanishes with no error. CALLER-SUPPLIED on purpose rather than a timestamp,
  // so the same operator command issued twice by mistake is still idempotent.
  const rewalkParam = url.searchParams.get('rewalk')
  if (rewalkParam !== null && !/^\d+$/.test(rewalkParam)) {
    return NextResponse.json({ error: `rewalk must be a non-negative integer if supplied; got "${rewalkParam}"` }, { status: 400 })
  }
  const windowsParam = url.searchParams.get('windows')
  const windowsRemaining = windowsParam === null ? undefined : Number(windowsParam)
  if (windowsRemaining !== undefined && (!Number.isInteger(windowsRemaining) || windowsRemaining < 1)) {
    return NextResponse.json({ error: `windows must be a positive integer if supplied; got "${windowsParam}"` }, { status: 400 })
  }
  if (!clientId || !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
    return NextResponse.json({ error: 'clientId and endDate=YYYY-MM-DD are required — the first window is explicit, never inferred from a clock' }, { status: 400 })
  }

  const { data: conn, error } = await supabaseAdmin.from('platform_connections')
    .select('account_id, user_email').eq('client_id', clientId).eq('platform', 'google').maybeSingle()
  if (error || !conn?.account_id || !conn?.user_email) {
    return NextResponse.json({ error: `no google connection for ${clientId}: ${error?.message ?? 'not found'}` }, { status: 404 })
  }

  // ⛔ LORAMER_WALK_STARTS_AT_LAST_ACTIVE_V1 — THE START WINDOW MUST NOT BE DEAD GROUND.
  // This has now cost TWO releases. The walk began at the most recent calendar window, Foam OH's account had
  // been dormant since 2026-04-05, and the first window returned zero rows for every entry — which the old
  // seal rule read as "no history below this date" and used to end the walk (LORAMER_ZERO_ROWS_IS_NOT_
  // EXHAUSTION_V1). The seal is fixed, but starting on dead ground is STILL wrong on its own terms: it spends
  // a full window of vendor quota (346 requests) to learn something metrics_daily already knows for free.
  // ⛔ THE RULE: start at the account's LAST ACTIVE DATE — the newest day it actually had clicks or
  // impressions — never at today. Everything above that date is known-empty and does not need asking.
  const { data: activeRow } = await supabaseAdmin
    .from('metrics_daily')
    .select('date')
    .eq('client_id', clientId).eq('platform', 'google')
    .eq('entity_level', 'account').eq('breakdown_type', '')
    .gt('impressions', 0)
    .order('date', { ascending: false })
    .limit(1)
    .maybeSingle()
  const lastActive = (activeRow as { date?: string } | null)?.date ?? null
  if (lastActive && endDate > lastActive && url.searchParams.get('allowDeadStart') !== '1') {
    return NextResponse.json({
      started: false, published: 0,
      error: `REFUSING TO START ON DEAD GROUND. endDate=${endDate} is above this account's last ACTIVE day (${lastActive}) — every window between them is known-empty and would spend ${346} requests each to rediscover that. Start at endDate=${lastActive}, or pass &allowDeadStart=1 if you genuinely mean to walk the dormant period.`,
      lastActiveDate: lastActive,
      suggestedEndDate: lastActive,
    }, { status: 400 })
  }

  const doc = loadUniverse()
  // ⛔ THE FILTER IS APPLIED TO THE SELECTABLE SET, NEVER TO THE CATALOG — a targeted re-walk may only ever
  // ask for something the walk would legitimately have asked for on its own.
  const allSelectable = selectableEntries(doc)
  const entries = onlyResource
    ? allSelectable.filter((e) => e.resource === onlyResource && (onlySegment === null || (e.segment ?? '') === onlySegment))
    : allSelectable
  if (onlyResource && entries.length === 0) {
    return NextResponse.json({
      started: false, published: 0,
      error: `no SELECTABLE entry matches resource='${onlyResource}'${onlySegment === null ? '' : ` segment='${onlySegment}'`}. It may be deferred, derived-time, or non-delivering — all three are recorded in the artifact, and none is a thing this route may publish.`,
      selectableTotal: allSelectable.length,
    }, { status: 400 })
  }
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
  // ⛔ LORAMER_BACKFILL_YIELDS_TO_PRODUCT_V1 — the starter yields on the same rule as the consumer. A walk
  // that could not be STARTED without eating the product reserve must not be started.
  const { readGoogleSpendToday } = await import('@/lib/backfill/google-op-budget')
  const gov = decidePublishFleetAware({ spentRequestsToday: spent, fleet: await readGoogleSpendToday(), want: entries.length })

  // ⛔ THE GOVERNOR DECIDES BEFORE ANYTHING IS PUBLISHED. Zero is a valid answer and is reported, not retried.
  if (!gov.mayPublish) {
    return NextResponse.json({ started: false, published: 0, reason: gov.reason, denominator: gov.denominator, disk }, { status: 200 })
  }

  const startDate = addDays(endDate, -(windowDays - 1))
  const toPublish = entries.slice(0, gov.allowance)
  let published = 0
  if (!dryRun) {
    for (const entry of toPublish) {
      const label = `${entry.resource}${entry.segment ? '/' + entry.segment : ''}`
      const msg: UniverseMessage = { clientId, userEmail: conn.user_email, customerId: String(conn.account_id), entry, startDate, endDate,
        // ⛔ OMITTED WHEN IT IS THE DEFAULT, so a normal start publishes a byte-identical message to before.
        ...(windowDays !== WINDOW_DAYS ? { windowDays } : {}),
        ...(windowsRemaining !== undefined ? { windowsRemaining } : {}) }
      await send(TOPIC, msg, {
        idempotencyKey: `${clientId}|${label}|${startDate}${rewalkParam === null ? '' : `|rw${rewalkParam}`}`,
      } as any)
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
    entriesSelectable: entries.length, window: { startDate, endDate, windowDays },
    // ⛔ THE TARGETING IS REPORTED, NOT INFERRED. A scoped re-walk and a full start return the same shape, so
    // the response has to say which one just happened or a dry run cannot be checked.
    scope: onlyResource
      ? { resource: onlyResource, segment: onlySegment, matched: entries.length, ofSelectable: allSelectable.length }
      : { resource: null, segment: null, matched: entries.length, ofSelectable: allSelectable.length },
    rewalk: rewalkParam === null ? null : { generation: rewalkParam, note: 'idempotency key carries |rw<generation> so a deliberate re-publish is not deduped against the original message for the life of its TTL' },
    bound: windowsRemaining === undefined
      ? { marker: 'LORAMER_UNIVERSE_BOUNDED_RUN_V1', windows: null, note: 'UNBOUNDED — each consumer re-publishes its next window until the vendor is exhausted, the governor holds, or the disk floor stops it.' }
      : { marker: 'LORAMER_UNIVERSE_BOUNDED_RUN_V1', windows: windowsRemaining, note: `BOUNDED to ${windowsRemaining} window(s) per entry. The consumer will NOT re-publish past the bound even if quota and disk allow it.` },
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
