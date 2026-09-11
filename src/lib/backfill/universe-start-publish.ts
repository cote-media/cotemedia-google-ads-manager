// LORAMER_ONE_CLICK_WALK_V1 (1/2) — THE WALK'S PUBLISH CORE, EXTRACTED FROM universe-start/route.ts SO THE BACKFILL
// BUTTON AND THE OPERATOR ROUTE SHARE ONE PUBLISHER.
//
// Everything below is universe-start's POST body from the connection lookup to the response object, moved verbatim in
// behaviour: the dead-ground refusal, the scope/ceiling refusals, the disk floor, the fleet-aware governor, the
// 30-day first window, the idempotency key `${clientId}|${label}|${startDate}[|rw<n>]`, the response shape. The route
// keeps its HTTP shell (auth, query parsing, the 400s for malformed params) and returns { status, body } from here.
//
// ⛔ THE ONE ADDITION — `idempotent: true` (the button's mode): a client that already holds a universe_account_inception
// row or any universe_attempt_log row is a WALKED client; the button publishes NOTHING for it and answers
// 'already-started'. universe-start (the operator) does not pass it, so a deliberate re-walk (`rewalk=<n>`) still works.
// The worker's first-touch discovery (universe-v2-worker.ts:234 discoverAccountInception) remains the ONLY writer of
// universe_account_inception — this module reads it and never writes it.
import { send } from '@vercel/queue'
import { loadUniverse, selectableEntries, deferredEntries, entityLevelFor, readAccountInception } from '@/lib/backfill/google-ads-universe-writer'
import { decidePublishFleetAware } from '@/lib/backfill/universe-governor'
import { checkDiskFloor, readLaneSpendToday, gb, FLOOR_BYTES, PROVISIONED_BYTES } from '@/lib/backfill/universe-window-log'
import { TOPIC, WINDOW_DAYS, type UniverseMessage } from '@/app/api/queues/google-ads-universe/route'
import { supabaseAdmin } from '@/lib/supabase'

const addDays = (iso: string, n: number) => {
  const d = new Date(`${iso}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10)
}

/**
 * ⛔ THIS NUMBER IS OURS, NOT A VENDOR CONSTANT (universe-start's own ceiling, moved with the core). Google publishes no
 * per-command limit; the only vendor bound is the daily op cap. On 2026-08-08 an approval for ONE message published
 * FIFTEEN because `?resource=campaign_search_term_view` carried no `&segment=`; anything above this ceiling needs
 * `allEntries` said on purpose.
 */
export const MAX_PUBLISH_WITHOUT_FLAG = 4

export interface PublishWalkStartOpts {
  clientId: string
  /** the FIRST window's end, explicit (YYYY-MM-DD) — never inferred from a clock inside the core */
  endDate: string
  dryRun: boolean
  onlyResource: string | null
  onlySegment: string | null
  windowDays: number
  windowsRemaining: number | undefined
  rewalkParam: string | null
  allEntries: boolean
  allowDeadStart: boolean
  /** the Backfill button's mode: publish nothing for a client that already holds an inception row or attempt rows */
  idempotent?: boolean
}

export interface PublishWalkStartResult { status: number; body: Record<string, unknown> }

export async function publishWalkStart(o: PublishWalkStartOpts): Promise<PublishWalkStartResult> {
  const { clientId, endDate, dryRun, onlyResource, onlySegment, windowDays, windowsRemaining, rewalkParam, allEntries } = o

  const { data: conn, error } = await supabaseAdmin.from('platform_connections')
    .select('account_id, user_email').eq('client_id', clientId).eq('platform', 'google').maybeSingle()
  if (error || !conn?.account_id || !conn?.user_email) {
    return { status: 404, body: { error: `no google connection for ${clientId}: ${error?.message ?? 'not found'}` } }
  }

  // LORAMER_ONE_CLICK_WALK_V1 — the button's idempotency: a walked client is never re-started by a click.
  if (o.idempotent) {
    const inception = await readAccountInception({ clientId, vendor: 'google' })
    const { data: anyAttempt } = await supabaseAdmin.from('universe_attempt_log')
      .select('id').eq('client_id', clientId).eq('vendor', 'google').limit(1).maybeSingle()
    if (inception || anyAttempt) {
      return { status: 200, body: { started: false, published: 0, walk: 'already-started', inception: inception?.inceptionDate ?? null, hasAttemptRows: Boolean(anyAttempt) } }
    }
  }

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
  if (lastActive && endDate > lastActive && !o.allowDeadStart) {
    return { status: 400, body: {
      started: false, published: 0,
      error: `REFUSING TO START ON DEAD GROUND. endDate=${endDate} is above this account's last ACTIVE day (${lastActive}) — every window between them is known-empty and would spend ${346} requests each to rediscover that. Start at endDate=${lastActive}, or pass &allowDeadStart=1 if you genuinely mean to walk the dormant period.`,
      lastActiveDate: lastActive,
      suggestedEndDate: lastActive,
    } }
  }

  const doc = loadUniverse()
  const allSelectable = selectableEntries(doc)
  const entries = onlyResource
    ? allSelectable.filter((e) => e.resource === onlyResource && (onlySegment === null || (e.segment ?? '') === onlySegment))
    : allSelectable
  if (onlyResource && entries.length === 0) {
    return { status: 400, body: {
      started: false, published: 0,
      error: `no SELECTABLE entry matches resource='${onlyResource}'${onlySegment === null ? '' : ` segment='${onlySegment}'`}. It may be deferred, derived-time, or non-delivering — all three are recorded in the artifact, and none is a thing this route may publish.`,
      selectableTotal: allSelectable.length,
    } }
  }
  const deferred = deferredEntries(doc)

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
    return { status: 200, body: { started: false, published: 0, reason: floor.reason, disk } }
  }

  const spent = await readLaneSpendToday()
  const { readGoogleSpendToday } = await import('@/lib/backfill/google-op-budget')
  const gov = decidePublishFleetAware({ spentRequestsToday: spent, fleet: await readGoogleSpendToday(), want: entries.length })

  if (!gov.mayPublish) {
    return { status: 200, body: { started: false, published: 0, reason: gov.reason, denominator: gov.denominator, disk } }
  }

  const startDate = addDays(endDate, -(windowDays - 1))
  const toPublish = entries.slice(0, gov.allowance)

  const matchedEntries = entries.map((e) => `${e.resource}${e.segment ? '/' + e.segment : ''}`)
  const wouldRefuse: string | null =
    allEntries
      ? null
      : onlyResource && onlySegment === null && entries.length > 1
        ? `SCOPE MATCHED ${entries.length} ENTRIES, NOT 1. '?resource=${onlyResource}' with no '&segment=' matches the base entry AND every segment variant of that resource. If you meant the base entry alone, pass '&segment=' (empty). If you meant one variant, name it. If you genuinely mean all ${entries.length}, pass '&allEntries=1'.`
        : entries.length > MAX_PUBLISH_WITHOUT_FLAG
          ? `THIS CALL WOULD PUBLISH ${entries.length} MESSAGES, ABOVE THE CEILING OF ${MAX_PUBLISH_WITHOUT_FLAG}. Each message costs at least one Google Ads request, and an UNBOUNDED one walks to the vendor floor at ~1 request per window. Narrow it with '?resource=&segment=', bound it with '&windows=N', or say the fan-out out loud with '&allEntries=1'.`
          : null

  if (dryRun) {
    return { status: 200, body: {
      started: false, dryRun: true, published: 0,
      wouldPublish: wouldRefuse ? 0 : toPublish.length,
      wouldRefuse,
      matched: entries.length, matchedEntries,
      scope: { resource: onlyResource, segment: onlySegment, matched: entries.length, ofSelectable: allSelectable.length },
      window: { startDate, endDate, windowDays },
      bound: windowsRemaining === undefined ? { windows: null, note: 'UNBOUNDED — each consumer re-publishes its next window until the vendor, the governor or the disk floor stops it.' } : { windows: windowsRemaining },
      rewalk: rewalkParam === null ? null : { generation: rewalkParam },
      allEntries,
      governor: { reason: gov.reason, allowance: gov.allowance, denominator: gov.denominator },
      disk,
    } }
  }

  if (wouldRefuse) {
    return { status: 400, body: {
      started: false, published: 0, refused: true, error: wouldRefuse,
      matched: entries.length, matchedEntries,
      scope: { resource: onlyResource, segment: onlySegment, matched: entries.length, ofSelectable: allSelectable.length },
      escapes: {
        segment: "&segment=<name> targets one variant; &segment= (empty) targets the BASE entry only",
        allEntries: '&allEntries=1 publishes the whole matched set deliberately',
        dryRun: '&dryRun=1 prints wouldPublish and the full matched entry list without sending anything',
      },
    } }
  }

  let published = 0
  if (!dryRun) {
    for (const entry of toPublish) {
      const label = `${entry.resource}${entry.segment ? '/' + entry.segment : ''}`
      const msg: UniverseMessage = { clientId, userEmail: conn.user_email, customerId: String(conn.account_id), entry, startDate, endDate,
        ...(windowDays !== WINDOW_DAYS ? { windowDays } : {}),
        ...(windowsRemaining !== undefined ? { windowsRemaining } : {}) }
      await send(TOPIC, msg, {
        idempotencyKey: `${clientId}|${label}|${startDate}${rewalkParam === null ? '' : `|rw${rewalkParam}`}`,
      } as any)
      published++
    }
  }
  const perGrain: Record<string, number> = {}
  for (const e of entries) perGrain[entityLevelFor(e)] = (perGrain[entityLevelFor(e)] || 0) + 1
  const grains = Object.keys(perGrain).sort()

  return { status: 200, body: {
    started: !dryRun, dryRun, published, wouldPublish: toPublish.length,
    entriesSelectable: entries.length, window: { startDate, endDate, windowDays },
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
  } }
}
