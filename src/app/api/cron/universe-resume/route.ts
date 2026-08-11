// LORAMER_UNIVERSE_RESUMER_V1 — THE WALK MOVES WITHOUT A HUMAN NAMING A ROW ID.
//
// ════════════════════════════════════════════════════════════════════════════════════════════════════════
// ⛔ NOT SCHEDULED. THIS ROUTE IS NOT IN `vercel.json` AND NOTHING INVOKES IT.
// ════════════════════════════════════════════════════════════════════════════════════════════════════════
// It is built, guarded, and reachable only by a `Bearer $CRON_SECRET` request somebody makes deliberately.
// Adding the cron entry is a SEPARATE, EXPLICIT act — and it is the act that finally wires the v2 topic,
// which is why it is not being done in the same commit as the code it would schedule.
//
// ⛔ WHY IT EXISTS. Every recovery on 2026-08-08 required a human to name a row id: 2871, 17959, 17966. A
// one-click product cannot work that way. **THE RESUMER REMOVES THE HUMAN — AND THAT IS EXACTLY WHAT MAKES
// IT THE MOST DANGEROUS COMPONENT IN THE REBUILD.** A scheduler over a wrong coverage answer publishes
// wrong work forever, unattended. Coverage has been proven for ONE entry, ONE month, ONE platform. So this
// route is written to REFUSE AND RECORD in preference to publishing, and `universe-resumer.ts` holds those
// refusals as pure functions the guard drives with no DB and no vendor.
//
// ⛔ THREE PROPERTIES CARRIED FORWARD FROM THE JUNE ENGINE — the only version of this that ever shipped as a
// button a person pressed, and which got two of them right before the walk did:
//   1. **THE NO-PROGRESS BOUND** (`BackfillControl.tsx:81-83`) — `decideRepublish()`. v2's attempts bound
//      fires on FAILURES; a lap that SUCCEEDS and covers zero new days is not a failure and would sail past.
//   2. **THE DRIVER OWNS THE LOOP** (`BackfillControl.tsx:64-86` — one lap per POST, driver re-reads
//      between laps). Every message this route publishes carries `windowsRemaining: 1` and therefore does
//      NOT self-republish. **The resumer is the loop.** That is what makes the bound EXACT rather than an
//      opening bid: with chain self-republish, publishing 4 messages starts 4 chains that walk to the floor.
//   3. **WRITE-THEN-ADVANCE-PER-UNIT** (`run-backfill.ts:242-260`) — v2 holds it at day grain in
//      `universe-stream-capture`'s `flush()`. This route CANNOT break that ordering because it never writes
//      a row or a day commit at all; it only publishes. Guarded, not asserted.
import { NextResponse } from 'next/server'
import { send } from '@vercel/queue'
import { supabaseAdmin } from '@/lib/supabase'
import { loadUniverse, selectableEntries, VENDOR_FLOOR_DATE, type UniverseEntry } from '@/lib/backfill/google-ads-universe-writer'
import { googleAdsCaptureAdapter, surfaceOfEntry } from '@/lib/backfill/capture-adapters/google-ads.adapter'
import { mayFetchProgram } from '@/lib/backfill/capture-adapter'
import { rangesStillOwed } from '@/lib/backfill/universe-coverage'
import { appendAttemptFinished, readAttemptsAtSpan, type AttemptKey } from '@/lib/backfill/universe-attempt-log'
import { sizeNextWindow, dayDiff } from '@/lib/backfill/universe-sizing'
import { TOPIC, MAX_ATTEMPTS_AT_MIN_SPAN, type UniverseMessageV2 } from '@/lib/backfill/universe-v2-contract'
// ⛔ LORAMER_V2_QUOTA_SENTINEL_WIRED_V1 — the SHARED predicate. `holdGoogleWork`, never `.paused`.
import { readGoogleQuotaPause, holdGoogleWork } from '@/lib/backfill/google-quota-store'
import { recordQuotaHold } from '@/lib/backfill/universe-quota-hold' // LORAMER_V2_QUOTA_HOLD_IS_DURABLE_V1
import {
  assessCoverage, decideRepublish, boundedSelection,
  MAX_REQUESTS_PER_RUN, MAX_ENTRIES_SCANNED_PER_RUN, WINDOWS_PER_PUBLISHED_MESSAGE,
  type LastAttempt,
} from '@/lib/backfill/universe-resumer'

export const dynamic = 'force-dynamic'
export const fetchCache = 'force-no-store'
export const maxDuration = 300

const addDays = (iso: string, n: number) => {
  const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10)
}

export async function GET(request: Request) {
  const envSecret = (process.env.CRON_SECRET ?? '').trim()
  const authHeader = request.headers.get('authorization') ?? ''
  const got = (authHeader.startsWith('Bearer ') ? authHeader.slice('Bearer '.length) : authHeader).trim()
  if (!envSecret || got !== envSecret) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const url = new URL(request.url)
  const clientId = url.searchParams.get('clientId')
  const dryRun = url.searchParams.get('dryRun') !== '0'   // ⛔ DRY-RUN IS THE DEFAULT. `?dryRun=0` publishes.
  if (!clientId) return NextResponse.json({ error: 'clientId required' }, { status: 400 })

  // ⛔ THE VENDOR'S REFUSAL GATES THE SCHEDULER TOO — LORAMER_V2_QUOTA_SENTINEL_WIRED_V1.
  // This route never fetches, so it cannot OBSERVE a quota error; but everything it publishes BECOMES a vendor
  // call, and a scheduler that keeps publishing into an armed quota is spending the fleet's tomorrow one
  // message at a time. Checked BEFORE the catalog load and the coverage scan, so a held run also costs no DB
  // work — the same reason cron/drain/route.ts checks before its connection query.
  // ⛔ THE METER DOES NOT COVER THIS: `mayFetchProgram` reads OUR ledgers; the sentinel is GOOGLE'S refusal.
  const qp = await readGoogleQuotaPause()
  if (holdGoogleWork(qp)) {
    // ⛔ DURABLE, NOT SILENT (sweep C6, LORAMER_V2_QUOTA_HOLD_IS_DURABLE_V1). A cron whose only trace is a JSON
    // response nobody reads and a log line that expires in an hour is a lane nobody can tell apart from one
    // that never fired. Recorded BEFORE the return, and it charges nothing: nothing was asked.
    await recordQuotaHold({ lane: 'resumer', clientId, qp, wouldHaveDone: 'scan the catalog and publish owed windows' })
    return NextResponse.json({
      ok: true, published: 0, scanned: 0,
      held: qp.state === 'unknown'
        ? `google quota sentinel UNREADABLE — holding this lane (NOT a confirmed pause): ${qp.reason}`
        : `google quota paused until ${qp.until}`,
      quotaState: qp.state, quotaUntil: qp.until,
      note: 'Nothing published and nothing scanned. Owed-ness is DERIVED, so no state is lost by holding — the next run after the clock-based window elapses re-computes exactly the same answer.',
      refusals: [],
    })
  }

  const { data: client } = await supabaseAdmin
    .from('clients').select('id, user_email, platform_connections(*)').eq('id', clientId).single()
  const conn = ((client?.platform_connections ?? []) as any[]).find((c) => c.platform === 'google')
  if (!client || !conn) return NextResponse.json({ error: 'no google connection for this client' }, { status: 400 })
  const userEmail = conn.user_email || client.user_email
  const customerId = conn.account_id

  // ⛔ THE ADAPTER SUPPLIES THE FLOOR, THE METER AND THE SIZING POLICY. The resumer holds no vendor constant.
  // ⚠ THE STREAM IS NEVER CONSTRUCTED HERE — this route publishes; it does not fetch. `googleAdsStreamFor`
  // is not imported, so there is no path from a resumer run to a vendor call.
  const adapter = googleAdsCaptureAdapter(
    () => { throw new Error('the resumer never fetches — it publishes. A stream here would be a vendor call from a scheduler.') },
    (s) => byKey.get(`${s.resource}|${s.segment}`)!,
  )
  const floorDate = adapter.retention.floorDate ?? VENDOR_FLOOR_DATE

  // ── THE DENOMINATOR, NOT A LIST ───────────────────────────────────────────────────────────────────────
  // ⛔ THE CANDIDATES COME FROM THE CATALOG — the DECLARED universe — and owed-ness is RECOMPUTED for every
  // one of them, every run. There is no stored list of pending work and no cursor. That is not a style
  // choice: a list is a claim that goes stale, and on 2026-08-08 the walk's own owed list was measured
  // WRONG IN BOTH DIRECTIONS on the very range it was consulted about.
  const doc = loadUniverse()
  const entries = selectableEntries(doc)
  const byKey = new Map<string, UniverseEntry>(entries.map((e) => [`${e.resource}|${e.segment ?? ''}`, e]))

  const yesterday = addDays(new Date().toISOString().slice(0, 10), -1)

  type Candidate = {
    entry: UniverseEntry; label: string; ranges: number; owedDays: number
    windowStart: string; windowEnd: string; sizingBasis: string
    // ⛔ ONE ENTRY PER VENDOR REQUEST THIS CANDIDATE WILL MAKE, each carrying that request's own day span.
    // LORAMER_V2_METER_CHARGES_THE_PROGRAM_V1 — `ranges` is the COUNT and was all the meter ever saw; the
    // spans are what `costOf` is defined over, and they were being computed here and thrown away.
    rangeSpans: number[]
  }
  const candidates: Candidate[] = []
  const refusals: Array<{ label: string; verdict: string; reason: string }> = []
  let scanned = 0

  for (const entry of entries) {
    if (scanned >= MAX_ENTRIES_SCANNED_PER_RUN) break
    scanned++
    const surface = surfaceOfEntry(entry)
    const label = `${surface.resource}${surface.segment ? ' / ' + surface.segment : ''}`

    // ⛔ THE WINDOW IS SIZED BY THE ADAPTER'S POLICY AND ITS COST DIRECTION, then anchored at the newest
    // ground. Newest-first is the design: the user has the most recent months within hours and depth
    // accrues over days.
    const sizing = await sizeNextWindow(adapter, { clientId, resource: surface.resource, segment: surface.segment })
    const windowEnd = yesterday
    const windowStart = (() => { const s = addDays(windowEnd, -(sizing.days - 1)); return s < floorDate ? floorDate : s })()

    let owed
    try {
      owed = await rangesStillOwed(
        { clientId, platform: adapter.platform, entityLevel: surface.entityLevel, breakdownType: surface.breakdownType },
        windowStart, windowEnd,
      )
    } catch (e: any) {
      // ⛔ A COVERAGE READ THAT THREW IS NOT AN EMPTY OWED SET. Publishing on it would be publishing on a
      // guess; treating it as "nothing owed" would be a silent all-clear. Record and move on.
      refusals.push({ label, verdict: 'coverage-error', reason: String(e?.message ?? e) })
      continue
    }

    // ── ⛔ IMPLAUSIBLE COVERAGE — REFUSE AND RECORD, NEVER PUBLISH ───────────────────────────────────────
    const anyRow = await supabaseAdmin.from('metrics_daily').select('date')
      .eq('client_id', clientId).eq('platform', adapter.platform)
      .eq('entity_level', surface.entityLevel).eq('breakdown_type', surface.breakdownType).limit(1)
    const plaus = assessCoverage({
      windowStart, windowEnd, coverage: owed.coverage,
      floorDate: adapter.retention.floorDate,
      entryHasAnyRows: (anyRow.data?.length ?? 0) > 0,
    })
    if (!plaus.plausible) {
      // ⛔ THE REFUSAL IS DURABLE. A refusal that lives only in a log line is a refusal nobody can act on,
      // and Vercel's runtime logs expire in an hour. It goes in the append-only attempt log as a terminal
      // record so the reporting surface can name it.
      const key: AttemptKey = { clientId, vendor: adapter.platform, resource: surface.resource, segment: surface.segment, windowStart, windowEnd }
      if (!dryRun) {
        await appendAttemptFinished(key, (await readAttemptsAtSpan(key)) + 1, 'skipped', {
          rowsWritten: 0, requestsSpent: 0,
          error: `RESUMER REFUSED — IMPLAUSIBLE COVERAGE: ${plaus.reason}`,
        })
      }
      refusals.push({ label, verdict: 'implausible', reason: plaus.reason })
      continue
    }

    // ── THE REPUBLISH DECISION: BROKEN · NO-PROGRESS · NOTHING-OWED ─────────────────────────────────────
    const key: AttemptKey = { clientId, vendor: adapter.platform, resource: surface.resource, segment: surface.segment, windowStart, windowEnd }
    const spanDays = dayDiff(windowStart, windowEnd) + 1
    const attemptsHere = await readAttemptsAtSpan(key)
    const last = await readLastAttempt(key)
    const verdict = decideRepublish({
      owedDays: owed.coverage.uncovered.length,
      attemptsAtMinSpan: attemptsHere,
      maxAttemptsAtMinSpan: MAX_ATTEMPTS_AT_MIN_SPAN,
      spanDays, minSpanDays: adapter.sizing.minDays, last,
    })
    if (!verdict.publish) { refusals.push({ label, verdict: verdict.verdict, reason: verdict.reason }); continue }

    candidates.push({
      entry, label, ranges: owed.ranges.length, owedDays: owed.coverage.uncovered.length,
      windowStart, windowEnd, sizingBasis: sizing.basis,
      // ⛔ ONE OWED RANGE IS ONE VENDOR REQUEST (universe-resumer.ts:201-203), so this is the program the
      // meter must be charged for — not its length, which is what it used to be handed.
      rangeSpans: owed.ranges.map((r) => dayDiff(r.start, r.end) + 1),
    })
  }

  // ── BOUNDED BY CONSTRUCTION, IN THE UNIT THAT GETS SPENT ────────────────────────────────────────────
  const sel = boundedSelection(candidates, MAX_REQUESTS_PER_RUN)

  // ── THE METER — THE ADAPTER'S, IN ITS OWN UNIT, AND IT HOLDS WHEN UNREADABLE ────────────────────────
  // ⛔ THE PRODUCT RESERVE IS RESPECTED BECAUSE THE METER'S CAP *IS* THE BACKFILL ALLOWANCE: 6,000 = the
  // 15,000 daily cap MINUS 4,000 forward and 5,000 drain (`universe-governor.ts:40-42`). The walk cannot
  // reach the product lanes' 9,000 through this path — not by policy, but because the number it is measured
  // against never included them. THE WALK YIELDS TO PRODUCT, ALWAYS.
  // ⛔ LORAMER_V2_METER_CHARGES_THE_PROGRAM_V1, 2026-08-11. THIS READ `mayFetch(adapter, sel.requests)` — a
  // REQUEST COUNT handed to a parameter that means DAYS. Google's `costOf` is flat and discards `days`, so
  // the mislabelling was invisible and the gate charged ONE for a twenty-request program: both watched wet
  // runs printed `0 + 1 of 6000` while authorising 20. It failed SAFE only because MAX_REQUESTS_PER_RUN is
  // the real bound — which means the meter was not holding the line it appeared to be holding.
  // ⛔ THE PROGRAM IS THE UNIT: one entry per vendor request, each with its own span, summed by the
  // ADAPTER'S OWN costOf. Nothing here is expressed in operations (capture-adapter.ts:354-357).
  const gate = await mayFetchProgram(adapter, sel.taken.flatMap((c) => c.rangeSpans))
  if (!gate.ok) {
    return NextResponse.json({
      ok: true, published: 0, held: gate.reason, scanned,
      wouldHavePublished: sel.taken.map((c) => c.label), refusals,
    })
  }

  const published: any[] = []
  for (const c of sel.taken) {
    const msg: UniverseMessageV2 = {
      clientId, userEmail, customerId, entry: c.entry,
      startDate: c.windowStart, endDate: c.windowEnd,
      // ⛔ ONE WINDOW, NO SELF-REPUBLISH. June's driver shape: the loop belongs to the driver, not the work.
      windowsRemaining: WINDOWS_PER_PUBLISHED_MESSAGE,
      floorDate,
    }
    // ⛔ IDEMPOTENCY, AND THE MECHANISM STATED RATHER THAN ASSUMED. Two overlapping resumer runs compute the
    // SAME key for the same owed window — it is a pure function of (client, resource, segment, window) with
    // no timestamp and no run id in it — so Vercel Queues' idempotency dedupe drops the second for the
    // message TTL. **AND THE DEEPER GUARANTEE DOES NOT DEPEND ON THAT AT ALL:** owed-ness is DERIVED, so a
    // second run that somehow did publish would land on a consumer that recomputes coverage and finds the
    // days already covered — one indexed read, no vendor request. Dedupe is the optimisation; derived
    // coverage is the correctness.
    const idempotencyKey = `resume|${clientId}|${c.entry.resource}|${c.entry.segment ?? ''}|${c.windowStart}|${c.windowEnd}`
    if (!dryRun) await send(TOPIC, msg satisfies UniverseMessageV2, { idempotencyKey } as any)
    published.push({ label: c.label, window: `${c.windowStart}..${c.windowEnd}`, ranges: c.ranges, owedDays: c.owedDays, sizing: c.sizingBasis, idempotencyKey })
  }

  return NextResponse.json({
    ok: true, dryRun, clientId, scanned,
    entriesInCatalog: entries.length,
    bound: { maxRequestsPerRun: MAX_REQUESTS_PER_RUN, maxEntriesScanned: MAX_ENTRIES_SCANNED_PER_RUN, requestsSelected: sel.requests, droppedForBound: sel.droppedForBound },
    meter: gate.reason,
    published, refusals,
  })
}

/**
 * The most recent `attempt_finished` for THIS EXACT RANGE, and how many days its attempt committed.
 * ⛔ TWO READS AND NO NEW COLUMN, because the log is APPEND-ONLY and adding a `days_committed` field to the
 * finish record would be a schema change to answer a question the records already answer.
 */
async function readLastAttempt(k: AttemptKey): Promise<LastAttempt> {
  const { data } = await supabaseAdmin.from('universe_attempt_log')
    .select('attempt_no, outcome')
    .eq('client_id', k.clientId).eq('vendor', k.vendor).eq('resource', k.resource).eq('segment', k.segment)
    .eq('window_start', k.windowStart).eq('window_end', k.windowEnd).eq('phase', 'attempt_finished')
    .order('attempt_no', { ascending: false }).limit(1)
  const row = data?.[0]
  if (!row) return { outcome: null, attemptNo: null, daysCommitted: 0 }
  const { count } = await supabaseAdmin.from('universe_attempt_log')
    .select('id', { count: 'exact', head: true })
    .eq('client_id', k.clientId).eq('vendor', k.vendor).eq('resource', k.resource).eq('segment', k.segment)
    .eq('window_start', k.windowStart).eq('window_end', k.windowEnd)
    .eq('phase', 'day_committed').eq('attempt_no', row.attempt_no)
  return { outcome: String(row.outcome), attemptNo: Number(row.attempt_no), daysCommitted: typeof count === 'number' ? count : 0 }
}
