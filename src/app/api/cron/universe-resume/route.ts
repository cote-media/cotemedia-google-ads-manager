// LORAMER_UNIVERSE_RESUMER_V1 — THE WALK MOVES WITHOUT A HUMAN NAMING A ROW ID.
//
// ════════════════════════════════════════════════════════════════════════════════════════════════════════
// ⛔ SCHEDULED AS OF 2026-08-11 — LORAMER_WALK_SCHEDULED_V1, RUSS'S EXPLICIT GO. THE SEPARATE ACT HAPPENED.
// ════════════════════════════════════════════════════════════════════════════════════════════════════════
// EXACTLY ONE cron entry exists: Escential (c39ee088; identity per the registry, src/lib/clients/canonical.ts), `dryRun=0`, every 5 minutes — pinned byte-for-byte by
// `universe-stream-consumer.guard.mjs` leg (e), so a second entry, a faster cadence, a different client or a
// dropped `dryRun=0` is a red build. LORAMER_PROOF_LANE_V1 (2026-09-12) moved it from Foam OH (957d484e — sealed
// 349/349, asking only its 2-request lookback) to the cold-proof vehicle; Foam OH's entry was added on 2026-08-11
// only after all three pre-scheduling gates closed (meter · lane · cleanup; LORAMER_PRESCHEDULING_GATE_V1) and
// the Foam OH dormancy eyeball. The button (kickoff.ts:82) fires a client ONCE; only this entry continues it.
// ⛔ THE UNATTENDED-SPEND ARITHMETIC, derived from constants below rather than invented: 24 fires/day ×
// MAX_REQUESTS_PER_RUN (20, exact by boundedSelection) = worst case 480 requests/day of the 13,500 lane
// (3.6%). Vercel sends `Bearer $CRON_SECRET` on cron fires by its own contract; a manual hit WITHOUT
// `dryRun=0` stays dry (`dryRun !== '0'`), so the flip lives only in the cron path itself.
// ⛔ VERCEL'S OWN DELIVERY CAVEATS, designed-for rather than discovered: no retry on failure, occasional
// missed or DUPLICATED fires. Both are safe here BY CONSTRUCTION — coverage is DERIVED so a missed fire's
// work is simply re-found next hour, and a duplicated fire recomputes the same owed set and dedupes on the
// same idempotency key.
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
import { supabaseAdmin } from '@/lib/supabase'
// ⛔ LORAMER_WALK_STOP_ONE_RESOLVER_V1 — the resumer composes the SAME stop the consumer does, through the one
// resolver, and no longer clamps to VENDOR_FLOOR_DATE (which is deliberately NOT imported here any more).
import { loadUniverse, selectableEntries, readWalkStopAccountFacts, resolveWalkStop, type UniverseEntry } from '@/lib/backfill/google-ads-universe-writer'
import { googleAdsCaptureAdapter, surfaceOfEntry } from '@/lib/backfill/capture-adapters/google-ads.adapter'
import { mayFetchProgram } from '@/lib/backfill/capture-adapter'
import { rangesStillOwed } from '@/lib/backfill/universe-coverage'
// LORAMER_WALK_UNWEDGE_AND_HEARTBEAT_V1 — appendAttemptStarted joins: the covered-ground advance appends a
// started(0-requests)+finished('skipped') PAIR, because migrations/064's rotation reads phase='attempt_started'
// ONLY — the resumer's existing finished-only 'skipped' appends (the implausible path) provably advance
// nothing (two live rows on ad_group, 2026-08-12, rotation unmoved).
import { randomUUID } from 'node:crypto'
import { appendAttemptStarted, appendAttemptFinished, readAttemptsAtSpan, type AttemptKey, type WriteProvenance } from '@/lib/backfill/universe-attempt-log'
import { sizeNextWindow, dayDiff } from '@/lib/backfill/universe-sizing'
import {
  MAX_ATTEMPTS_AT_MIN_SPAN, LEASE_TTL_S, CONSUMER_MAX_DURATION_S,
  SCAN_ALLOWANCE_MS, CAPTURE_BUDGET_MS, UNIT_RESERVATION_FLOOR_MS,
  type UniverseMessageV2,
} from '@/lib/backfill/universe-v2-contract'
// ⛔ LORAMER_QUEUE_REMOVED_INLINE_WALK_V1 — THE FIRE EXECUTES ITS OWN SELECTION. `processMessage` is the
// SAME function every queue delivery ran (terminal row per unit, per-range capture, all nine exits); only
// who hands the work over changed. This route's OWN code still never fetches — the vendor reach lives in
// the worker behind the meter gate and the lease below, which is what the resumer guard's vendor-symbol
// ban continues to pin.
import { processMessage, type DeadlineOpts } from '@/lib/backfill/universe-v2-worker'
import { acquireFireLease, releaseFireLease } from '@/lib/backfill/universe-fire-lease'
import { shouldStartAnotherLap } from '@/lib/backfill/lap-budget'
// ⛔ LORAMER_V2_QUOTA_SENTINEL_WIRED_V1 — the SHARED predicate. `holdGoogleWork`, never `.paused`.
import { readGoogleQuotaPause, holdGoogleWork } from '@/lib/backfill/google-quota-store'
import { recordQuotaHold } from '@/lib/backfill/universe-quota-hold' // LORAMER_V2_QUOTA_HOLD_IS_DURABLE_V1
import {
  assessCoverage, decideRepublish, boundedSelection,
  deriveAnchorEnd, deriveWindow, orderForRotation, deriveBoundaryStrip, // LORAMER_LOOKBACK_LANE_V1 — deriveTopStrip is gone (ruling j)
  parseFloorSeal, floorSealHolds, // LORAMER_WALK_FLOOR_SEAL_V1 — the seal's pure deciders

  MAX_REQUESTS_PER_RUN, MAX_ENTRIES_SCANNED_PER_RUN, WINDOWS_PER_PUBLISHED_MESSAGE,
  LOOKBACK_REQUESTS_PER_RUN, LOOKBACK_WINDOW_DAYS_BASIC,
  SEALED_STRIP_DERIVATIONS_PER_RUN,
  type LastAttempt,
} from '@/lib/backfill/universe-resumer'
import { boundaryDaysFor } from '@/lib/backfill/lookback-boundary' // LORAMER_LOOKBACK_LANE_V1 — the boundary, read from the store per account per fire

export const dynamic = 'force-dynamic'
export const fetchCache = 'force-no-store'
// ⛔ THE CEILING IS THE CONTRACT'S — these routes are now the walk's EXECUTION HOSTS, so their ceiling is
// the one the budget reservation and the lease TTL are derived against. Never a literal (drive-ceiling-pin).
export const maxDuration = CONSUMER_MAX_DURATION_S

// ⛔ LORAMER_LOOKBACK_LANE_V1 — THE SECOND SLOT'S MODE. 'observe': derive the boundary windows, LOG them, send NOTHING,
// charge nothing. 'publish': execute them under lane 'lookback' — the first attesting terminal lands. The flip is
// STOP-and-confirm 2 (QUEUE ★LOOKBACK-LANE-OWNS-PROMOTION (7)); lookback-slot-mode-is-gated.guard.mjs refuses a
// 'publish' value without a dated ruling cite on this line or the line above it.
const LOOKBACK_SLOT_MODE = 'publish' as 'observe' | 'publish' // ruling: DECISIONS LORAMER_SESSION_2026_09_05_RULINGS (c) 2026-09-05 (:2539) — STOP-and-confirm 2 given by Russ 2026-09-10

const addDays = (iso: string, n: number) => {
  const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10)
}

export async function GET(request: Request) {
// ⛔ LORAMER_PROVENANCE_ON_EVERY_APPEND_V1 — PRODUCER-SIDE ROWS CARRY AN INVOCATION, NOT A MESSAGE KEY.
// A covered-skip / refusal row is written by the PUBLISHER and no message was ever sent for it, so
// `message_key` — documented as "the idempotency key the publisher passed to send()" — stays NULL here on
// purpose. Filling it with a synthesised value would make one column mean two different things, which is
// LORAMER_ADJACENT_NUMBER_V1 in a schema. `invocation_id` is still exactly right: this row was written by
// THIS execution, and that is the question it answers.
  const fireInvocationId = randomUUID()
  const prov: WriteProvenance = { messageKey: null, invocationId: fireInvocationId }
  const envSecret = (process.env.CRON_SECRET ?? '').trim()
  const authHeader = request.headers.get('authorization') ?? ''
  const got = (authHeader.startsWith('Bearer ') ? authHeader.slice('Bearer '.length) : authHeader).trim()
  if (!envSecret || got !== envSecret) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const url = new URL(request.url)
  const clientId = url.searchParams.get('clientId')
  const dryRun = url.searchParams.get('dryRun') !== '0'   // ⛔ DRY-RUN IS THE DEFAULT. `?dryRun=0` publishes.
  if (!clientId) return NextResponse.json({ error: 'clientId required' }, { status: 400 })

  // ── THE HEARTBEAT — LORAMER_WALK_UNWEDGE_AND_HEARTBEAT_V1 ──────────────────────────────────────────────
  // ⛔ ONE DURABLE ROW PER FIRE, ON EVERY RETURN PATH — including held and errored fires. The wedge ran 21+
  // hours invisible because a completed fire's only traces were a console line (gone in an hour) and a JSON
  // body nothing reads. ⚠ SOFT-FAIL BY DESIGN: a heartbeat that cannot write (table not yet migrated, DB
  // blip) must never kill the fire it describes — the failure is RETURNED in the response as heartbeatError
  // and logged, never thrown. migrations/068 creates universe_fire_log.
  const fireHeartbeat = async (h: {
    fireOutcome: 'completed' | 'quota-hold' | 'rotation-error' | 'meter-held' | 'lease-held'
    scanned?: number; scanCompleted?: boolean; catalogSize?: number; candidates?: number
    published?: number; requestsSelected?: number; advanced?: number
    refusals?: Array<{ verdict: string }>; elapsedMs?: number; held?: string | null
  }): Promise<string | null> => {
    try {
      const histogram: Record<string, number> = {}
      for (const r of h.refusals ?? []) histogram[r.verdict] = (histogram[r.verdict] ?? 0) + 1
      const { error } = await supabaseAdmin.from('universe_fire_log').insert({
        client_id: clientId, dry_run: dryRun, fire_outcome: h.fireOutcome,
        scanned: h.scanned ?? 0, scan_completed: h.scanCompleted ?? false, catalog_size: h.catalogSize ?? 0,
        candidates: h.candidates ?? 0, published: h.published ?? 0, requests_selected: h.requestsSelected ?? 0,
        advanced: h.advanced ?? 0, refusals: histogram, elapsed_ms: h.elapsedMs ?? 0, held: h.held ?? null,
      })
      if (error) { console.error('[universe-resume] HEARTBEAT WRITE FAILED (fire unaffected):', error.message); return error.message }
      return null
    } catch (e: any) {
      console.error('[universe-resume] HEARTBEAT WRITE THREW (fire unaffected):', e?.message ?? e)
      return String(e?.message ?? e)
    }
  }

  // ══ THE FIRE LEASE — LORAMER_QUEUE_REMOVED_INLINE_WALK_V1, FIRST DB ACT OF A WET FIRE ═══════════════
  // ⛔ WHY FIRST: the vendor documents cron overlap, duplicate invocation, AND deploy-straddle
  // (migrations/085 quotes all three), and an operator drive shares this lane. The loser exits HERE,
  // before the sentinel read, the catalog load and the 47s scan — visible ('lease-held' heartbeat),
  // never silent. ⛔ A DRY RUN TAKES NO LEASE: it executes nothing, so it may not block the fire that does.
  // ⛔ RELEASE LIVES IN THE `finally` AT THE BOTTOM OF THIS HANDLER — every return path between here and
  // there releases through it; a hard kill releases nothing and the TTL (LEASE_TTL_S, DB-time CAS)
  // recovers the lane within one skipped fire.
  let leaseWon = false
  if (!dryRun) {
    const lease = await acquireFireLease(clientId, 'google_ads', fireInvocationId, LEASE_TTL_S)
    if (!lease.won) {
      const hbErr = await fireHeartbeat({ fireOutcome: 'lease-held', held: `fire lease held by ${lease.holder ?? 'unknown'} since ${lease.heldSince ?? 'unknown'}` })
      return NextResponse.json({
        ok: true, published: 0, executed: 0, scanned: 0, heartbeatError: hbErr,
        held: `FIRE LEASE HELD — another fire (or an operator drive) is running this lane: holder ${lease.holder ?? 'unknown'} since ${lease.heldSince ?? 'unknown'}. ` +
          `Nothing scanned, nothing spent. Owed-ness is derived; the next fire after release (or TTL ${LEASE_TTL_S}s) recomputes the same answer.`,
        refusals: [],
      })
    }
    leaseWon = true
  }
  // ⛔ FLAT-INDENT try/finally, DELIBERATE: the shell below wraps ~400 existing lines so the lease is
  // released on EVERY return path; re-indenting the whole body would bury this cutover's real diff in
  // whitespace. The `finally` is at the bottom of the handler.
  try {

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
    const hbErr = await fireHeartbeat({ fireOutcome: 'quota-hold', held: qp.state === 'unknown' ? `sentinel unreadable: ${qp.reason}` : `quota paused until ${qp.until}` })
    return NextResponse.json({
      ok: true, published: 0, scanned: 0, heartbeatError: hbErr,
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
  // ⛔ LORAMER_WALK_STOP_ONE_RESOLVER_V1 — THE FLOOR THIS LINE USED TO INVENT. It read
  // `adapter.retention.floorDate ?? VENDOR_FLOOR_DATE` = `null ?? '2022-03-05'`: ONE GLOBAL CONSTANT clamping
  // every window of every account, which is the exact defect the adapter's own `retention` header records
  // ("one account's measured floor, applied to every account") re-introduced one layer up by a `??`.
  // MEASURED: Foam OH's DISCOVERED inception is 2022-03-04 — one day BELOW that constant, so a receding walk
  // would have stopped one day above the floor it holds provenance for, forever, on every surface.
  // The per-ACCOUNT half is read ONCE here; the per-SURFACE wall is composed per candidate below.
  // ⚠ `discover: null` — the resumer NEVER fetches (the stream above throws), so it may never be the thing
  // that triggers a discovery vendor call. First-touch discovery stays the consumer's, on the message path.
  const stopFacts = await readWalkStopAccountFacts({ clientId, vendor: adapter.platform, discover: null })

  // ── ⛔ THE LOOKBACK BOUNDARY — LORAMER_LOOKBACK_LANE_V1, PER ACCOUNT, READ EVERY FIRE, NEVER TYPED ──────────
  // DECISIONS (i): boundary(account) = max(click-through, view-through, COST_HORIZON_DAYS) from stored conversion_action
  // state. UNKNOWN REFUSES: an account with no row gets no lookback windows this fire (recorded below as a refusal,
  // once), never a default. The width is the access tier's (QUEUE (4)): Basic → one 7-day window per surface per week;
  // Standard (pending) → one day per window, by ruling when it clears.
  const boundary = await boundaryDaysFor(clientId, customerId)
  const lookbackWidth = LOOKBACK_WINDOW_DAYS_BASIC
  // THE LOOKBACK FRONTIER — the lane's own FINISHED windows per surface, newest first, one read per fire. A window
  // finished ok|zero|nongrain is asked once and never again; 'skipped' (the consumer's COVERED_SKIP) is finished too
  // — every day of it was already covered or attested — so the frontier moves past it; 'error' is NOT finished and
  // is re-derived. Terminal rows carry the lane on the provenance (attempt-writers-carry-the-lane), so the filter
  // reads the row's own column here. A failed read fails OPEN to "never asked" (the frontier is re-derived from the
  // descent's top), which can only re-ask, never skip.
  const lookbackFrontier = new Map<string, string>()
  let lookbackFrontierReadFailed: string | null = null
  {
    const { data: lbRows, error: lbErr } = await supabaseAdmin.from('universe_attempt_log')
      .select('resource, segment, window_end')
      .eq('client_id', clientId).eq('vendor', adapter.platform)
      .eq('phase', 'attempt_finished').eq('lane', 'lookback').in('outcome', ['ok', 'zero', 'nongrain', 'skipped'])
      .order('window_end', { ascending: false }).limit(2000)
    if (lbErr) {
      lookbackFrontierReadFailed = lbErr.message
      console.error(`[universe-resume] lookback-frontier read failed — deriving from the descent's top this fire (fail-open to re-asking): ${lbErr.message}`)
    } else {
      for (const r of lbRows ?? []) {
        const k = `${r.resource}|${r.segment ?? ''}`
        if (!lookbackFrontier.has(k)) lookbackFrontier.set(k, String(r.window_end))
      }
    }
  }

  // ══ SCAN — LORAMER_QUEUE_REMOVED_INLINE_WALK_V1 marker; the resumer guard splits the file HERE. ═════
  // ⛔ NOTHING BETWEEN THIS MARKER AND `EXECUTE` MAY REACH THE VENDOR. The scan derives and selects; the
  // vendor is reached only inside processMessage, below the EXECUTE marker, behind the meter and the lease.
  // ── THE DENOMINATOR, NOT A LIST ───────────────────────────────────────────────────────────────────────
  // ⛔ THE CANDIDATES COME FROM THE CATALOG — the DECLARED universe — and owed-ness is RECOMPUTED for every
  // one of them, every run. There is no stored list of pending work and no cursor. That is not a style
  // choice: a list is a claim that goes stale, and on 2026-08-08 the walk's own owed list was measured
  // WRONG IN BOTH DIRECTIONS on the very range it was consulted about.
  const doc = loadUniverse()
  const entries = selectableEntries(doc)
  const byKey = new Map<string, UniverseEntry>(entries.map((e) => [`${e.resource}|${e.segment ?? ''}`, e]))

  const yesterday = addDays(new Date().toISOString().slice(0, 10), -1)
  const startedAt = Date.now()

  // ── THE ROTATION — LORAMER_RESUMER_SCAN_ROTATES_V1 ────────────────────────────────────────────────────
  // ⛔ WHAT THIS FIXES, MEASURED BEFORE IT WAS CHANGED. The scan ran the catalog IN ORDER and broke at
  // MAX_ENTRIES_SCANNED_PER_RUN, so entries 61..346 were unreachable BY CONSTRUCTION. Live attempt log,
  // 2026-08-13: 61 distinct surfaces ever touched (60 real + the __account_inception pseudo-row) of 346
  // selectable — 286 surfaces had NEVER been asked once in the engine's entire scheduled life. The cap was
  // doing its job; the ORDER silently turned it into a filter.
  // ⛔ ONE GROUPED READ, NOT 346 — migrations/064. Returns one row per surface: the last window ASKED and
  // when. An ordering read over the append-only log; owed-ness is still derived from metrics_daily below.
  const { data: rotRows, error: rotErr } = await supabaseAdmin
    .rpc('universe_surface_rotation', { p_client_id: clientId, p_vendor: adapter.platform })
  if (rotErr) {
    // ⛔ AN UNREADABLE ROTATION INDEX IS NOT AN EMPTY ONE. Falling through with an empty map would make every
    // surface look never-attempted, which re-anchors the whole catalog at the newest ground — the exact
    // horizon defect this flight exists to remove, restored by a swallowed error.
    const hbErr = await fireHeartbeat({ fireOutcome: 'rotation-error', held: `rotation index unreadable: ${rotErr.message}` })
    return NextResponse.json({
      ok: true, published: 0, scanned: 0, heartbeatError: hbErr,
      held: `REFUSING TO SCAN BLIND — the rotation index is unreadable: ${rotErr.message}. ` +
        `migrations/064_universe_surface_rotation.sql creates universe_surface_rotation(); apply it before running. ` +
        `An empty map would make every surface read as never-attempted and re-anchor the entire catalog at the newest ground.`,
      refusals: [],
    }, { status: 200 })
  }
  // ⛔ `parent_known` (migrations/082) IS NOT OPTIONAL METADATA — it is the difference between "the window we
  // asked for" and "the last range we happened to write". Pre-082 rows return false and must HOLD the anchor.
  type RotRow = { resource: string; segment: string; last_window_start: string; last_window_end: string; last_attempt_at: string; parent_known: boolean }
  const rotation = new Map<string, RotRow>()
  for (const r of (rotRows ?? []) as RotRow[]) rotation.set(`${r.resource}|${r.segment ?? ''}`, r)
  const lastAttemptedAt = new Map<string, string>()
  for (const [k, r] of rotation) lastAttemptedAt.set(k, String(r.last_attempt_at))
  const rotated = orderForRotation(entries, (e) => `${e.resource}|${e.segment ?? ''}`, lastAttemptedAt)

  // ── ⛔ THE FLOOR SEALS — LORAMER_WALK_FLOOR_SEAL_V1 (★WALK-WEDGES-AT-FLOOR-REACHED) ──────────────────
  // ONE read per fire: the newest descend 'floor_stop' seal per surface. A surface whose seal (i) is its
  // latest descend action AND (ii) was written against the SAME resolved stop it resolves to now is skipped
  // WITHOUT consuming a scan slot — that is what frees the 60 slots for the surfaces that still owe.
  // Ordered newest-first and reduced to first-per-key so the comparison always runs against the newest seal.
  // ⛔ A FAILED SEAL READ FAILS OPEN TO SCANNING (empty map): one fire behaves exactly like today — sealed
  // surfaces are re-derived and re-refused — which is wedge-shaped but write-free and self-heals next fire.
  // Failing open to EXCLUSION would seal surfaces on an unreadable instrument.
  const floorSeals = new Map<string, { error: string | null; recordedAt: string }>()
  let sealReadFailed: string | null = null
  {
    const { data: sealRows, error: sealErr } = await supabaseAdmin.from('universe_attempt_log')
      .select('resource, segment, error, recorded_at')
      .eq('client_id', clientId).eq('vendor', adapter.platform)
      .eq('phase', 'attempt_finished').eq('outcome', 'floor_stop').eq('lane', 'descend')
      .order('recorded_at', { ascending: false }).limit(2000)
    if (sealErr) {
      sealReadFailed = sealErr.message
      console.error(`[universe-resume] floor-seal read failed — scanning WITHOUT exclusion this fire (fail-open to scanning): ${sealErr.message}`)
    } else {
      for (const r of sealRows ?? []) {
        const k = `${r.resource}|${r.segment ?? ''}`
        if (!floorSeals.has(k)) floorSeals.set(k, { error: r.error ?? null, recordedAt: String(r.recorded_at) })
      }
    }
  }

  type Candidate = {
    entry: UniverseEntry; label: string; ranges: number; owedDays: number
    windowStart: string; windowEnd: string; sizingBasis: string
    anchorBasis: string; receded: boolean; stopBasis: string
    // ⛔ ONE ENTRY PER VENDOR REQUEST THIS CANDIDATE WILL MAKE, each carrying that request's own day span.
    // LORAMER_V2_METER_CHARGES_THE_PROGRAM_V1 — `ranges` is the COUNT and was all the meter ever saw; the
    // spans are what `costOf` is defined over, and they were being computed here and thrown away.
    rangeSpans: number[]
  }
  const candidates: Candidate[] = []
  // ⛔ THE SECOND LANE — LORAMER_LOOKBACK_LANE_V1 (the top-edge lane of LORAMER_TOP_EDGE_LANE_V1 CONVERTED, ruling
  // (j)). Same scan, same catalog, same coverage module, same fetcher, same writer, same meter. What differs is ONE
  // flag on the message and TWO bounds instead of one — and now the strip anchors to the BOUNDARY, not to yesterday,
  // so its terminal may attest. A second catalog or a second engine is exactly what this shape refuses to become.
  const lookback: Candidate[] = []
  let lookbackWaiting = 0      // surfaces whose next full window still ends inside the boundary
  let lookbackNone = 0         // surfaces the descent never asked (no strip — the descending lane's history)
  let earliestAskable: string | null = null
  const refusals: Array<{ label: string; verdict: string; reason: string }> = []
  if (!boundary.known) refusals.push({ label: '(lookback lane)', verdict: 'lookback-boundary-unknown', reason: boundary.reason })
  let scanned = 0
  let advancedCovered = 0 // LORAMER_WALK_UNWEDGE_AND_HEARTBEAT_V1 — covered-ground advances this fire (0 vendor ops each)
  let sealedHeld = 0     // LORAMER_WALK_FLOOR_SEAL_V1 — sealed surfaces skipped WITHOUT a scan slot this fire
  let sealedThisFire = 0 // LORAMER_WALK_FLOOR_SEAL_V1 — seals WRITTEN this fire (each is once-only evidence)
  let sealedStripDerived = 0 // LORAMER_SEALED_STRIP_PASS_V1 — bounded strip derivations for floor-sealed surfaces this fire

  for (const entry of rotated) {
    if (scanned >= MAX_ENTRIES_SCANNED_PER_RUN) break

    // ── ⛔ SEALED SURFACES LEAVE THE SCAN SET — LORAMER_WALK_FLOOR_SEAL_V1 ──────────────────────────────
    // BEFORE the slot is consumed, on purpose: the seal's whole point is that a finished surface stops
    // spending the 60-entry budget. The seal holds ONLY when (i) it is the surface's latest descend action
    // (the pair's own started row stamps the rotation ms before the seal, so a NEWER rotation timestamp
    // means a real attempt landed after it) and (ii) the stop it was written against is the stop the ONE
    // composition site resolves to now. Anything else — stop moved, basis changed, seal unparseable, stop
    // now UNKNOWN, resolver threw — falls through to the normal scan: RE-ADMISSION IS AUTOMATIC AND
    // DERIVED, never a manual un-seal.
    // ⛔ LORAMER_SEALED_STRIP_PASS_V1 — THE RESIDUAL THAT KILLED THE LANE, NOW CLOSED. The comment that
    // stood here predicted this branch's failure verbatim — "at fleet-terminal (ALL surfaces sealed) the
    // scan goes empty and no strip candidates are derived at all; the strip scan needs its own bounded
    // pass by then (queued)" — AND THE "(queued)" WAS FALSE: no queue item existed, fleet-terminal arrived
    // unwatched on 2026-08-25 ~20:00Z (349/349 floor-sealed by 06:00Z next morning), and the top-edge lane
    // published ZERO for 24+ hours while its backlog grew 349 days/day. The bounded pass now lives INSIDE
    // the sealed branch, before its `continue`, so the strip block's own placement law (below: "computed
    // BEFORE every `continue` the descent can take") finally holds for the branch that finished surfaces
    // actually take. Same catalog, same strip derivation (deriveTopStrip then, deriveBoundaryStrip since 2026-09-08), same rangesStillOwed, same second-lane selection, same
    // writer, same meter — no second engine. Bound: SEALED_STRIP_DERIVATIONS_PER_RUN (measured basis on the
    // constant). Rotation order carries through `rotated`, and each published ask advances the surface's
    // rotation, so the front drains at the publication rate exactly like the scanned path.
    // ⚠ KNOWN CHURN, accepted and self-healing: a top-edge ask stamps the rotation NEWER than the seal, so
    // that surface's NEXT fire fails `sealIsLatest`, falls through to the normal scan, is re-refused at the
    // floor and RE-SEALED — one scan slot and one append-only seal row per asked surface per day, no vendor
    // ops. The alternative (teaching sealIsLatest about lanes) touches the rotation contract and is not the
    // smallest change.
    const sealKey = `${entry.resource}|${entry.segment ?? ''}`
    const priorSeal = floorSeals.get(sealKey)
    if (priorSeal) {
      const rotPrior = rotation.get(sealKey) ?? null
      const sealIsLatest = rotPrior === null ||
        Date.parse(String(rotPrior.last_attempt_at)) <= Date.parse(priorSeal.recordedAt)
      if (sealIsLatest) {
        try {
          const currentStop = await resolveWalkStop({
            clientId, vendor: adapter.platform, resource: entry.resource, segment: entry.segment ?? '', facts: stopFacts,
          })
          if (floorSealHolds(parseFloorSeal(priorSeal.error), { stopDate: currentStop.stopDate, basis: currentStop.basis })) {
            sealedHeld++
            refusals.push({
              label: `${entry.resource}${entry.segment ? ' / ' + entry.segment : ''}`, verdict: 'floor-sealed',
              reason: `sealed at stop ${currentStop.stopDate} (${currentStop.basis}) — skipped without a scan slot; re-admits the moment the stop facts change`,
            })
            // THE BOUNDED SEALED-STRIP PASS — before the `continue`, per the placement law above.
            // LORAMER_LOOKBACK_LANE_V1: the strip is the BOUNDARY strip (deriveBoundaryStrip), never yesterday's.
            // 'waiting'/'none' cost no DB read and no derivation slot; only a real window consumes the bound.
            if (boundary.known && sealedStripDerived < SEALED_STRIP_DERIVATIONS_PER_RUN) {
              const sealedSurface = surfaceOfEntry(entry)
              const sealedLabel = `${sealedSurface.resource}${sealedSurface.segment ? ' / ' + sealedSurface.segment : ''}`
              const sealedStrip = deriveBoundaryStrip({
                descendTopEnd: rotPrior ? String(rotPrior.last_window_end) : null,
                lastLookbackEnd: lookbackFrontier.get(sealKey) ?? null,
                newestServable: yesterday, boundaryDays: boundary.days, widthDays: lookbackWidth,
              })
              if (sealedStrip.kind === 'waiting') {
                lookbackWaiting++
                if (earliestAskable === null || sealedStrip.askableOn < earliestAskable) earliestAskable = sealedStrip.askableOn
              } else if (sealedStrip.kind === 'none') {
                lookbackNone++
              } else {
                sealedStripDerived++
                try {
                  const sealedKey = { clientId, platform: adapter.platform, entityLevel: sealedSurface.entityLevel, breakdownType: sealedSurface.breakdownType }
                  const sealedOwed = await rangesStillOwed(sealedKey, sealedStrip.windowStart, sealedStrip.windowEnd)
                  // ⛔ PUSHED EVEN WHEN NOTHING IS OWED (ranges 0, free under the bound): a fully covered/attested window
                  // must still be SENT when published so the consumer writes its COVERED_SKIP pair and the frontier
                  // moves past it — otherwise this surface re-derives the same window every fire (the wedge class).
                  lookback.push({
                    entry, label: sealedLabel, ranges: sealedOwed.ranges.length, owedDays: sealedOwed.coverage.uncovered.length,
                    windowStart: sealedStrip.windowStart, windowEnd: sealedStrip.windowEnd, sizingBasis: 'lookback-boundary',
                    anchorBasis: `boundary window above the SEALED descent's last window ${rotPrior ? String(rotPrior.last_window_end) : '(none)'} / lookback frontier ${lookbackFrontier.get(sealKey) ?? '(none)'}; ends ≤ T−${boundary.days} = ${sealedStrip.boundaryEnd}`,
                    receded: false, stopBasis: `boundary T−${boundary.days} — ${boundary.basis}`,
                    rangeSpans: sealedOwed.ranges.map((r) => dayDiff(r.start, r.end) + 1),
                  })
                } catch (e: any) {
                  refusals.push({ label: sealedLabel, verdict: 'lookback-coverage-error', reason: String(e?.message ?? e) })
                }
              }
            }
            continue
          }
        } catch {
          // A stop that cannot resolve must not hold a seal — fall through to the normal scan, whose own
          // stop-error branch records the failure durably.
        }
      }
    }

    scanned++
    const surface = surfaceOfEntry(entry)
    const label = `${surface.resource}${surface.segment ? ' / ' + surface.segment : ''}`
    const coverageKey = { clientId, platform: adapter.platform, entityLevel: surface.entityLevel, breakdownType: surface.breakdownType }

    // ⛔ THE STOP IS RESOLVED PER (ACCOUNT, SURFACE), THROUGH THE ONE COMPOSITION SITE — never a global
    // constant. `null` stays UNKNOWN and clamps nothing; inventing a floor from silence is the defect
    // LORAMER_ZERO_ROWS_IS_NOT_EXHAUSTION_V1 forbids and which sealed 214 cursors once already.
    let stop
    try {
      stop = await resolveWalkStop({
        clientId, vendor: adapter.platform, resource: surface.resource, segment: surface.segment, facts: stopFacts,
      })
    } catch (e: any) {
      refusals.push({ label, verdict: 'stop-error', reason: String(e?.message ?? e) })
      continue
    }

    // ⛔ THE WINDOW IS SIZED BY THE ADAPTER'S POLICY AND ITS COST DIRECTION, then anchored by the HORIZON —
    // newest ground on first touch, and one window lower each time the last one is fully answered
    // (LORAMER_WALK_HORIZON_RECEDES_V1). Newest-first is still the design: the user has the most recent
    // months within hours. What changed is that depth now actually accrues instead of re-buying day one.
    const sizing = await sizeNextWindow(adapter, { clientId, resource: surface.resource, segment: surface.segment })
    const rot = rotation.get(`${entry.resource}|${entry.segment ?? ''}`) ?? null

    // ── ⛔ THE BOUNDARY STRIP — LORAMER_LOOKBACK_LANE_V1 (the top strip of LORAMER_TOP_EDGE_LANE_V1, converted) ──
    // The descent's anchor only ever moves DOWN, so the ground between its top window and the restatement boundary
    // is held by NOTHING once the descent has passed it. The lookback lane asks each surface's past-boundary ground
    // ONCE, in full windows of `lookbackWidth` days ending ≤ T−B, and its terminal ATTESTS (universe-coverage.ts).
    // The live strip [T−B+1 … yesterday] is the DRIVER's under ruling (A) — not this lane's, not any lane's today.
    // ⛔ COMPUTED HERE, BEFORE EVERY `continue` THE DESCENT CAN TAKE, and that placement is the point: a surface
    // whose DESCENT is floor-reached, wedged, refused as implausible or bounded still has past-boundary ground.
    if (boundary.known) {
      const strip = deriveBoundaryStrip({
        descendTopEnd: rot ? String(rot.last_window_end) : null,
        lastLookbackEnd: lookbackFrontier.get(`${entry.resource}|${entry.segment ?? ''}`) ?? null,
        newestServable: yesterday, boundaryDays: boundary.days, widthDays: lookbackWidth,
      })
      if (strip.kind === 'waiting') {
        lookbackWaiting++
        if (earliestAskable === null || strip.askableOn < earliestAskable) earliestAskable = strip.askableOn
      } else if (strip.kind === 'none') {
        lookbackNone++
      } else {
        try {
          const stripOwed = await rangesStillOwed(coverageKey, strip.windowStart, strip.windowEnd)
          lookback.push({
            entry, label, ranges: stripOwed.ranges.length, owedDays: stripOwed.coverage.uncovered.length,
            windowStart: strip.windowStart, windowEnd: strip.windowEnd, sizingBasis: 'lookback-boundary',
            anchorBasis: `boundary window above the descent's last window ${rot ? String(rot.last_window_end) : '(none)'} / lookback frontier ${lookbackFrontier.get(`${entry.resource}|${entry.segment ?? ''}`) ?? '(none)'}; ends ≤ T−${boundary.days} = ${strip.boundaryEnd}`,
            receded: false, stopBasis: `boundary T−${boundary.days} — ${boundary.basis}`,
            rangeSpans: stripOwed.ranges.map((r) => dayDiff(r.start, r.end) + 1),
          })
        } catch (e: any) {
          // ⛔ A COVERAGE READ THAT THREW IS NOT AN EMPTY STRIP. Record it and let the DESCENT continue — the
          // two lanes fail independently on purpose; a strip probe that cannot answer must not cost the
          // descent its pass.
          refusals.push({ label, verdict: 'lookback-coverage-error', reason: String(e?.message ?? e) })
        }
      }
    }

    // ⛔ THE RECEDE GATE: the last window asked must owe NOTHING before the anchor may move below it.
    // One coverage read, bounded by the window's own span — never the whole walked band (that shape was
    // rejected on arithmetic: one probe per day × 1,622 days × 60 surfaces).
    // ⛔ AND IT NOW EVALUATES OVER THE **PARENT WINDOW**, BECAUSE THAT IS WHAT `rot.last_window_*` RETURNS
    // AFTER migrations/082 — the two halves of LORAMER_PARENT_WINDOW_IS_THE_UNIT_V1 move together, on
    // purpose. Recording the window while this gate still answered over the RANGE is the CATASTROPHIC
    // configuration named by the 2026-08-18 adversary pass: the anchor would recede a full window on the
    // evidence of one answered day and skip the rest permanently and silently. Neither half ships alone.
    let lastCoverage: Awaited<ReturnType<typeof rangesStillOwed>> | null = null
    if (rot) {
      try {
        lastCoverage = await rangesStillOwed(coverageKey, String(rot.last_window_start), String(rot.last_window_end))
      } catch (e: any) {
        refusals.push({ label, verdict: 'coverage-error', reason: `recede gate: ${String(e?.message ?? e)}` })
        continue
      }
    }
    const anchor = deriveAnchorEnd({
      newestGround: yesterday,
      lastWindowStart: rot ? String(rot.last_window_start) : null,
      lastWindowEnd: rot ? String(rot.last_window_end) : null,
      lastWindowFullyAnswered: lastCoverage === null ? true : lastCoverage.coverage.uncovered.length === 0,
      lastWindowKnown: rot ? rot.parent_known === true : false,
    })
    const win = deriveWindow({ anchorEnd: anchor.anchorEnd, sizingDays: sizing.days, stopDate: stop.stopDate })
    if (win === null) {
      // ⛔ NOT A FAILURE — THE SURFACE IS DONE. The anchor has receded below the RESOLVED stop, so there is no
      // ground left to ask for. Recorded so a completion can be told apart from a silence.
      // ── ⛔ THE SEAL — LORAMER_WALK_FLOOR_SEAL_V1 (★WALK-WEDGES-AT-FLOOR-REACHED, measured 2026-08-24:
      // top-60 = 60/60 floor-reached, best owing rank 61, descend silent ~15h). This branch used to write
      // NOTHING, so a finished surface's recency froze at the FRONT of the rotation and monopolised the
      // scan forever. The seal is UNWEDGE_V1's proven pair shape with a terminal outcome:
      //  · RE-STAMPS rot's existing last window — NEVER a synthesized stop-day window, because
      //    the strip derivation (deriveBoundaryStrip; deriveTopStrip before 2026-09-08) reads rot.last_window_end as descendTopEnd and a new bottom window would drag the
      //    top-edge strip derivation to 2022. The re-stamp holds the anchor AND the strip; only recency moves.
      //  · outcome 'floor_stop' (already in AttemptOutcome and universe_attempt_log_outcome_ck via 081 —
      //    NO migration) — attestedEmptyDays filters outcome='zero' only, so a seal can NEVER attest a day.
      //  · requestsSpent 0 (spend meters sum requests_spent — a seal adds nothing) and rowsWritten OMITTED
      //    (null keeps it out of sizing history, whose read filters `.not('rows_written','is',null)`).
      //  · the error text carries `stop=<date> basis=«<basis>»` — the machine half the exclusion above
      //    compares against, which is what makes the seal ONCE-ONLY and the re-admission DERIVED.
      // ⛔ rot === null → plain refusal, NO pair: a never-asked surface has no window to re-stamp, and
      // sealing on silence is the LORAMER_ZERO_ROWS_IS_NOT_EXHAUSTION_V1 defect class.
      if (!dryRun && rot) {
        const key: AttemptKey = {
          clientId, vendor: adapter.platform, resource: surface.resource, segment: surface.segment,
          windowStart: String(rot.last_window_start), windowEnd: String(rot.last_window_end),
        }
        const opened = await appendAttemptStarted(key, 0, { startDate: key.windowStart, endDate: key.windowEnd }, prov)
        await appendAttemptFinished(key, opened.attemptNo, 'floor_stop', {
          requestsSpent: 0,
          error: `FLOOR_STOP — LORAMER_WALK_FLOOR_SEAL_V1: anchor ${anchor.anchorEnd} below resolved stop stop=${stop.stopDate} basis=«${stop.basis}»; sealed — excluded from the descend scan until the stop facts change. NOT a vendor attestation — attestedEmptyDays filters outcome='zero' only.`,
        }, prov)
        sealedThisFire++
      }
      refusals.push({ label, verdict: 'floor-reached', reason: `anchor ${anchor.anchorEnd} is below the resolved stop (${stop.basis}) — this surface has been walked to its floor${!dryRun && rot ? '; SEALED (floor_stop pair) and excluded from the scan until the stop facts change' : ''}` })
      continue
    }
    const { windowStart, windowEnd } = win

    let owed
    if (lastCoverage !== null && !anchor.receded && windowStart === String(rot!.last_window_start) && windowEnd === String(rot!.last_window_end)) {
      // The recede gate already answered this exact window — do not pay for the same probes twice.
      owed = lastCoverage
    } else {
      try {
        owed = await rangesStillOwed(coverageKey, windowStart, windowEnd)
      } catch (e: any) {
        // ⛔ A COVERAGE READ THAT THREW IS NOT AN EMPTY OWED SET. Publishing on it would be publishing on a
        // guess; treating it as "nothing owed" would be a silent all-clear. Record and move on.
        refusals.push({ label, verdict: 'coverage-error', reason: String(e?.message ?? e) })
        continue
      }
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
        // ⛔ LORAMER_NONPUBLISH_ADVANCES_ROTATION_V1 — a PAIR now, not a finished-only append: 064's rotation
        // reads phase='attempt_started' ONLY, so the old finished-only skip provably advanced nothing (two
        // live rows on ad_group, 2026-08-12) and an implausible surface pinned its scan slot every fire.
        // ⛔ PARENT DELIBERATELY OMITTED: parent_known=false makes deriveAnchorEnd HOLD (:434 — UNKNOWN is
        // "do not move"), so recency advances but the anchor can NEVER recede past coverage this branch just
        // refused to trust — receding here would be the silent all-clear the refusal exists to prevent.
        // ⛔ rowsWritten OMITTED (null) — walk-unwedge leg (b): sizeNextWindow filters
        // `.not('rows_written','is',null)`; a 0 here would feed "the vendor served nothing" into sizing
        // from a call that never happened.
        const opened = await appendAttemptStarted(key, 0, undefined, prov)
        await appendAttemptFinished(key, opened.attemptNo, 'skipped', {
          requestsSpent: 0,
          error: `RESUMER REFUSED — IMPLAUSIBLE COVERAGE: ${plaus.reason}`,
        }, prov)
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
    // ── ⛔ THE UNWEDGE — LORAMER_WALK_UNWEDGE_AND_HEARTBEAT_V1 (★WALK-WEDGES-AT-COVERED-GROUND) ─────────
    // A derived window owing NOTHING used to be refused and NOTHING appended — but the anchor recedes only
    // past a window the rotation has seen ASKED (deriveAnchorEnd reads rot.last_window; 064 reads
    // phase='attempt_started'), so a refusal pinned the rotation and the SAME covered window was re-derived
    // and re-refused every fire, forever. MEASURED: all 346 surfaces wedged by 2026-08-13 23:30Z; 21+ hours
    // of hourly fires with candidates:0; reproduced live 2026-08-14 (refusals: {'nothing-owed': 60}).
    // THE FIX: a fully-covered window is ADVANCED PAST, durably — a started(requests:0)+finished('skipped')
    // pair for the derived window, so next fire's rotation sees it as the last window asked, the recede gate
    // reads it fully answered (covered/attested), and the anchor moves below it. ZERO vendor ops.
    // ⛔ rowsWritten is deliberately OMITTED (null): sizeNextWindow filters `.not('rows_written','is',null)`,
    // so a skip never enters sizing history — a skip is a fact about OUR bookkeeping, not a vendor answer.
    // ⛔ outcome 'skipped' is ALREADY excluded from vendor attestation: attestedEmptyDays filters
    // outcome='zero' only (universe-coverage.ts:207). The COVERED_SKIP marker makes the row's nature
    // grep-able; requests_spent=0 keeps every spend aggregate honest.
    if (!verdict.publish && verdict.verdict === 'nothing-owed') {
      if (!dryRun) {
        // LORAMER_PARENT_WINDOW_IS_THE_UNIT_V1 — the covered-skip advances past the DERIVED window, so the
        // parent is that window. Stamped rather than left null: a null parent HOLDS the anchor, which would
        // reinstate ★WALK-WEDGES-AT-COVERED-GROUND through the very branch built to end it.
        const opened = await appendAttemptStarted(key, 0, { startDate: windowStart, endDate: windowEnd }, prov)
        await appendAttemptFinished(key, opened.attemptNo, 'skipped', {
          requestsSpent: 0,
          error: `COVERED_SKIP — LORAMER_WALK_UNWEDGE_V1: window ${windowStart}..${windowEnd} fully covered/attested (${plaus.reason}); advanced past it with ZERO vendor ops. NOT a vendor attestation — coverage derivation ignores 'skipped'.`,
        }, prov)
      }
      advancedCovered++
      refusals.push({ label, verdict: 'advanced-covered', reason: `window ${windowStart}..${windowEnd} owes nothing — ${dryRun ? 'DRY: would advance' : 'advanced'} past covered ground (0 vendor ops); the anchor recedes below it next fire` })
      continue
    }
    if (!verdict.publish) {
      // ⛔ LORAMER_NONPUBLISH_ADVANCES_ROTATION_V1 — the ROTATION KICK. broken/no-progress used to write
      // NOTHING, which is the identical wedge shape one branch over: a refused surface's recency froze and it
      // pinned a scan slot every fire. The kick is a 0-request pair that ONLY moves recency:
      //  · PARENT OMITTED → parent_known=false → deriveAnchorEnd HOLDS (:434) — the anchor cannot move on a
      //    refusal, so no ground is skipped and the same window is re-derived (and re-judged) next cycle.
      //  · decideRepublish CANNOT see the kick: readAttemptsAtSpan counts requests_spent>0 only and
      //    readLastAttempt excludes 'skipped'/'floor_stop' — bookkeeping rows never enter vendor-behavior
      //    decisions, so the verdict next cycle is judged on the same vendor evidence as today.
      //  · one pair per rotation cycle while the refusal persists — bounded, and each carries its verdict.
      if (!dryRun) {
        const opened = await appendAttemptStarted(key, 0, undefined, prov)
        await appendAttemptFinished(key, opened.attemptNo, 'skipped', {
          requestsSpent: 0,
          error: `ROTATION_KICK — LORAMER_NONPUBLISH_ADVANCES_ROTATION_V1: verdict '${verdict.verdict}' (${verdict.reason.slice(0, 300)}). Recency advanced with ZERO vendor ops so this refusal cannot pin a scan slot; parent omitted so the anchor HOLDS. NOT a vendor attestation.`,
        }, prov)
      }
      refusals.push({ label, verdict: verdict.verdict, reason: verdict.reason }); continue
    }

    candidates.push({
      entry, label, ranges: owed.ranges.length, owedDays: owed.coverage.uncovered.length,
      windowStart, windowEnd, sizingBasis: sizing.basis,
      anchorBasis: anchor.basis, receded: anchor.receded, stopBasis: stop.basis,
      // ⛔ ONE OWED RANGE IS ONE VENDOR REQUEST (universe-resumer.ts:201-203), so this is the program the
      // meter must be charged for — not its length, which is what it used to be handed.
      rangeSpans: owed.ranges.map((r) => dayDiff(r.start, r.end) + 1),
    })
  }

  // ── BOUNDED BY CONSTRUCTION, IN THE UNIT THAT GETS SPENT ────────────────────────────────────────────
  const sel = boundedSelection(candidates, MAX_REQUESTS_PER_RUN)
  // ⛔ A SEPARATE BOUND, NOT A SHARE OF THE 40 — LORAMER_LOOKBACK_LANE_V1 (was LORAMER_TOP_EDGE_LANE_V1). Folding the
  // boundary strip into the descending bite would let a fragmented descent starve the lookback, or the lookback
  // starve the descent, depending only on scan order. Two lanes, two bounds, ONE meter (the program below sums both).
  // Derivation of the 2 lives beside the constant in universe-resumer.ts: demand is 349/W requests/day, capacity is
  // 288 fires × k, and k=1 is below demand under W=1.
  const selLook = boundedSelection(lookback, LOOKBACK_REQUESTS_PER_RUN)
  // ⛔ OBSERVE-ONLY (LOOKBACK_SLOT_MODE): the selected windows are LOGGED, not sent, and the meter is charged
  // for the descent alone — nothing is asked, so nothing is spent.
  const lookbackToSend = LOOKBACK_SLOT_MODE === 'publish' ? selLook.taken : []
  // LORAMER_FIRE_LOG_WITNESS_BOTH_SLOTS_V1 — the second slot's request count, from the SAME mode switch, so the
  // heartbeat can witness what this fire actually sends. Measured 2026-09-09: the heartbeat carried the descent
  // slot only, the meter counted both, and check-fleet-meter-visibility read DRIFT −190 on 190 real top-edge asks.
  const lookbackRequestsToSend = LOOKBACK_SLOT_MODE === 'publish' ? selLook.requests : 0

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
  // ⛔ ONE METER FOR BOTH LANES, AND THE PROGRAM IS THEIR UNION. The top edge is not a new budget line: it
  // spends from LANE_ALLOCATIONS.backfill exactly as the descent does, so the lane table (five lanes since the driver, 2/2 A) still sums to
  // the cap and FORWARD_UNGATED_RESERVE is untouched. A second allocation key would have been a second
  // governor over the same pool — the shape LORAMER_GOOGLE_LANE_ALLOCATION_V1 replaced.
  // ⛔ AND THE QUOTA SENTINEL NEEDS NO CHANGE AT ALL: it is checked at :125-126, BEFORE the catalog load, so
  // a vendor pause holds BOTH lanes for free and neither can publish into an armed quota.
  const gate = await mayFetchProgram(adapter, [...sel.taken, ...lookbackToSend].flatMap((c) => c.rangeSpans))
  if (!gate.ok) {
    const hbErr = await fireHeartbeat({
      fireOutcome: 'meter-held', scanned, scanCompleted: scanned >= MAX_ENTRIES_SCANNED_PER_RUN || scanned === entries.length,
      catalogSize: entries.length, candidates: candidates.length, advanced: advancedCovered, refusals,
      elapsedMs: Date.now() - startedAt, held: gate.reason,
    })
    return NextResponse.json({
      ok: true, published: 0, held: gate.reason, scanned, heartbeatError: hbErr,
      wouldHavePublished: [...sel.taken.map((c) => c.label), ...lookbackToSend.map((c) => `${c.label} [lookback]`)], refusals,
    })
  }

  // ══ EXECUTE — LORAMER_QUEUE_REMOVED_INLINE_WALK_V1 marker; vendor reach is legal below this line. ═══
  // ⛔ THE FIRE RUNS ITS OWN SELECTION, unit by unit, where it used to publish. `processMessage` is the
  // queue consumer's function, byte-for-byte — terminal row per unit, per-range capture, the meter, the
  // quota sentinel — with ONE addition: the fire's absolute deadline rides down so a mis-size continuation
  // can never outrun the ceiling. THE DESCENT EXECUTES FIRST AND THE LOOKBACK SECOND, same reason as when
  // this loop published: what gets deferred is the newest work (re-derived from scratch every fire), not
  // the deepest (which costs the pass).
  const published: any[] = []
  const executed: Array<{ label: string; lane: string; window: string; ms: number }> = []
  const unitErrors: Array<{ label: string; error: string }> = []
  let deferredUnits = 0
  let maxUnitMs = 0
  const captureStartedAt = Date.now()
  // ⛔ THE DEADLINE IS ABSOLUTE AND SHARED: capture start + CAPTURE_BUDGET_MS. Unit admission here, range
  // admission inside the unit, and every mis-size continuation all reserve against THIS one number.
  const unitOpts: DeadlineOpts = { deadlineAt: captureStartedAt + CAPTURE_BUDGET_MS }
  // ── ⛔ THE LOOKBACK SLOT — LORAMER_LOOKBACK_LANE_V1, OBSERVE-ONLY UNTIL STOP-AND-CONFIRM 2 ─────────────────
  // Every derived window is logged with the boundary it was derived against and where that boundary came from, so
  // a real tick can be read against the docs before anything is sent. The instrument below carries the tallies.
  const lookbackObserved = selLook.taken.map((c) => ({
    label: c.label, window: `${c.windowStart}..${c.windowEnd}`, ranges: c.ranges, owedDays: c.owedDays,
    boundaryDays: boundary.known ? boundary.days : null, boundarySource: boundary.known ? boundary.basis : boundary.reason,
    wouldBe: c.ranges === 0 ? 'covered-skip (0 requests)' : `${c.ranges} request(s)`,
  }))
  for (const o of lookbackObserved) {
    console.log(`[universe-resume] LOOKBACK ${LOOKBACK_SLOT_MODE === 'observe' ? 'OBSERVE' : 'PUBLISH'} ${clientId}: ${o.label} ${o.window} owed ${o.owedDays} day(s) → ${o.wouldBe} · boundary T−${o.boundaryDays ?? '?'} (${o.boundarySource})`)
  }
  console.log(`[universe-resume] LOOKBACK ${clientId}: mode=${LOOKBACK_SLOT_MODE} boundary=${boundary.known ? `${boundary.days}d` : 'UNKNOWN'} width=${lookbackWidth} frontier=${lookbackFrontier.size}${lookbackFrontierReadFailed ? ' (READ FAILED)' : ''} candidates=${lookback.length} selected=${selLook.taken.length} waiting=${lookbackWaiting} (earliest askable ${earliestAskable ?? 'n/a'}) none=${lookbackNone}`)
  const toSend: Array<{ c: Candidate; lane: 'descend' | 'lookback' }> = [
    ...sel.taken.map((c) => ({ c, lane: 'descend' as const })),
    ...lookbackToSend.map((c) => ({ c, lane: 'lookback' as const })),
  ]
  for (let unitIdx = 0; unitIdx < toSend.length; unitIdx++) {
    const { c, lane } = toSend[unitIdx]
    // ⛔ ADMISSION BEFORE EVERY UNIT — lap-budget's reservation rule at the fire grain. The first unit is
    // always admitted (elapsed 0 + max(0, FLOOR) ≤ budget); a deferred unit costs NOTHING and is re-derived
    // next fire — it opened no attempt and the anchor has not moved for it.
    if (!dryRun && !shouldStartAnotherLap(Date.now() - captureStartedAt, maxUnitMs, CAPTURE_BUDGET_MS, UNIT_RESERVATION_FLOOR_MS)) {
      deferredUnits = toSend.length - unitIdx
      console.warn(`[universe-resume] FIRE BUDGET STOP: deferred ${deferredUnits}/${toSend.length} unit(s) — ` +
        `${Date.now() - captureStartedAt}ms of ${CAPTURE_BUDGET_MS}ms capture budget, worst unit ${maxUnitMs}ms. ` +
        `Nothing lost: deferred units opened no attempt and are re-derived next fire.`)
      break
    }
    const msg: UniverseMessageV2 = {
      clientId, userEmail, customerId, entry: c.entry,
      startDate: c.windowStart, endDate: c.windowEnd,
      // ⛔ THE LANE RIDES THE MESSAGE — LORAMER_TOP_EDGE_LANE_V1. It decides the lane stamped on
      // `attempt_started` (which the rotation filters on, so a strip cannot drag the descending anchor to
      // the top of the calendar) AND whether the consumer calls `advance()` at all. A top-edge message must
      // never self-chain: `advance` derives its successor as `startDate − 1`, which would start a SECOND
      // descent through ground the walk has already covered.
      lane,
      // ⛔ ONE WINDOW, NO SELF-REPUBLISH. June's driver shape: the loop belongs to the driver, not the work.
      windowsRemaining: WINDOWS_PER_PUBLISHED_MESSAGE,
      // ⛔ NO `floorDate` ON THE MESSAGE — REMOVED 2026-08-13, AND IT WAS ALREADY DEAD. The consumer is
      // FORBIDDEN to read it (`universe-floor-execute-time.guard.mjs` leg (a): "THE FLOOR MAY NOT RIDE THE
      // MESSAGE"), so this field was a publisher's opinion nothing consumed — and it carried the globalised
      // VENDOR_FLOOR_DATE this flight removed. A dead field holding a wrong value is how the wrong value
      // comes back: someone reads the message, sees a floor, and wires it.
    }
    // ⛔ IDEMPOTENCY, AND THE MECHANISM STATED RATHER THAN ASSUMED. Two overlapping resumer runs compute the
    // SAME key for the same owed window — it is a pure function of (client, resource, segment, window) with
    // no timestamp and no run id in it — so Vercel Queues' idempotency dedupe drops the second for the
    // message TTL. **AND THE DEEPER GUARANTEE DOES NOT DEPEND ON THAT AT ALL:** owed-ness is DERIVED, so a
    // second run that somehow did publish would land on a consumer that recomputes coverage and finds the
    // days already covered — one indexed read, no vendor request. Dedupe is the optimisation; derived
    // coverage is the correctness.
    // ⛔ THE LANE IS IN THE KEY. Without it a strip and a descending window that happened to share bounds
    // would dedupe against each other — different work, different lane stamp, one of them silently dropped.
    const idempotencyKey = `resume|${lane}|${clientId}|${c.entry.resource}|${c.entry.segment ?? ''}|${c.windowStart}|${c.windowEnd}`
  // ⛔ THE KEY RIDES ON THE UNIT — LORAMER_COMPLETION_SIGNAL_V1, unchanged by the cutover: it is the
  // producer-assigned identifier the terminal row persists, minted here exactly as it was for the queue's
  // dedupe. A durable row that cannot name its publisher is what let a scheduled fire's requests be
  // counted as a drive's.
    published.push({ lane, label: c.label, window: `${c.windowStart}..${c.windowEnd}`, ranges: c.ranges, owedDays: c.owedDays, sizing: c.sizingBasis, receded: c.receded, anchor: c.anchorBasis, stop: c.stopBasis, idempotencyKey })
    if (!dryRun) {
      // ⛔ PER-UNIT EXECUTION, PER-UNIT ISOLATION. processMessage writes the unit's terminal row on EVERY
      // exit including a throw (its own try/finally); a unit that throws here has already recorded itself,
      // so the fire RECORDS AND CONTINUES — one broken surface must not cost the other 41 their pass.
      const unitStartedAt = Date.now()
      try {
        await processMessage({ ...msg, messageKey: idempotencyKey } satisfies UniverseMessageV2, unitOpts)
        executed.push({ label: c.label, lane, window: `${c.windowStart}..${c.windowEnd}`, ms: Date.now() - unitStartedAt })
      } catch (e: any) {
        unitErrors.push({ label: c.label, error: String(e?.message ?? e).slice(0, 300) })
        console.error(`[universe-resume] UNIT THREW ${c.label} ${c.windowStart}..${c.windowEnd}: ${String(e?.message ?? e)} — terminal row already written by processMessage; continuing to the next unit.`)
      }
      maxUnitMs = Math.max(maxUnitMs, Date.now() - unitStartedAt)
    }
  }

  // ── THE FIRE INSTRUMENT — LORAMER_RESUMER_FIRE_INSTRUMENT_V1 ─────────────────────────────────────────
  // ⛔ THE HOLE IT CLOSES, NAMED: a resumer that DIES MID-SCAN publishes a truncated prefix that reads in the
  // log EXACTLY like a complete fire that found little. Nothing distinguished them. `scanCompleted` is the
  // whole point — it is true only when the loop reached the cap or exhausted the rotation, so a fire that
  // ended any other way cannot be read as a survey of the catalog.
  // ⛔ AND IT IS A CONSOLE LINE, NOT A TABLE. It reports the SHAPE of a decision the durable records already
  // carry (attempts, refusals, published) — inventing a row for it would add a second account of the same
  // fire, which is the two-owners shape this subsystem keeps paying for.
  const elapsedMs = Date.now() - startedAt
  const instrument = {
    scanned, scanCap: MAX_ENTRIES_SCANNED_PER_RUN, catalogSize: entries.length,
    scanCompleted: scanned >= MAX_ENTRIES_SCANNED_PER_RUN || scanned === entries.length,
    rotationKnown: rotation.size, neverAttempted: entries.length - rotation.size,
    candidates: candidates.length, publishedOf: published.length,
    requestsSelected: sel.requests, droppedForBound: sel.droppedForBound,
    // LORAMER_LOOKBACK_LANE_V1 — the second lane reports its own numbers rather than being summed into the
    // descent's, so a report can never say "the walk spent N" and mean two different things.
    lookbackMode: LOOKBACK_SLOT_MODE, lookbackBoundaryDays: boundary.known ? boundary.days : null,
    lookbackCandidates: lookback.length, lookbackSelected: selLook.taken.length, lookbackSent: lookbackToSend.length,
    lookbackRequestsSelected: selLook.requests, lookbackDroppedForBound: selLook.droppedForBound,
    lookbackOwedDays: lookback.reduce((n, c) => n + c.owedDays, 0),
    lookbackWaiting, lookbackEarliestAskable: earliestAskable, lookbackNone,
    // LORAMER_QUEUE_REMOVED_INLINE_WALK_V1 — the fire now EXECUTES: these three are the execution half.
    // ⚠ COLUMN-SEMANTICS NOTE for readers of universe_fire_log: `published` now means UNITS SELECTED FOR
    // EXECUTION (the wet ones all execute or error in-fire), and `elapsed_ms` now spans SCAN + CAPTURE
    // (~75-125s typical) where it used to span scan+publish (~48s). Same columns, wider meaning.
    executedOf: executed.length, unitErrorCount: unitErrors.length, deferredUnits,
    advancedCovered, // LORAMER_WALK_UNWEDGE_AND_HEARTBEAT_V1 — covered-ground advances (0 vendor ops each)
    // LORAMER_WALK_FLOOR_SEAL_V1 — sealedHeld = sealed surfaces skipped WITHOUT a slot; sealedThisFire =
    // seals WRITTEN (once-only evidence pairs). sealReadFailed non-null = exclusion failed open to scanning.
    sealedHeld, sealedThisFire, sealReadFailed,
    receded: published.filter((p) => p.receded).length,
    oldestWindowStart: published.reduce<string | null>((m, p) => {
      const s = String(p.window).slice(0, 10); return m === null || s < m ? s : m
    }, null),
    elapsedMs, maxDurationS: maxDuration,
  }
  console.log(`[universe-resume] FIRE ${clientId}${dryRun ? ' (DRY)' : ''}: ${JSON.stringify(instrument)}`)
  // LORAMER_WALK_UNWEDGE_AND_HEARTBEAT_V1 — the durable copy of the line above. rows_written stays derivable
  // from the attempt log; the heartbeat records the FIRE's decisions, not the consumer's results.
  const hbErr = await fireHeartbeat({
    fireOutcome: 'completed', scanned, scanCompleted: instrument.scanCompleted, catalogSize: entries.length,
    // LORAMER_FIRE_LOG_WITNESS_BOTH_SLOTS_V1 — ONE integer, ONE meaning: units / requests this fire selected to SEND,
    // across BOTH slots (descent + lookback). The per-lane split stays in the response body above. A witness that
    // carries one slot while the meter counts both is the 2026-09-09 −190 drift, and would return on the first
    // publish-mode fire.
    // ⛔ ★FIRE-LOG-PUBLISHED-DOUBLE-COUNTS-LOOKBACK (fixed 2026-09-10): `published` ALREADY holds every executed unit of
    // BOTH lanes — the lookback units enter the executed set at the `...lookbackToSend.map(…)` spread above and are
    // pushed at `published.push(…)` with its lane — so the f75d8aa sum `published.length + lookbackToSend.length` counted
    // each lookback unit twice (fire 6688: published 4 vs publishedOf 2; the 24 h witness 68 vs 34 attempts → a FALSE
    // EXECUTION-DARK in check-walk-liveness). ONE addend: the witness equals publishedOf by construction.
    candidates: candidates.length, published: published.length, requestsSelected: sel.requests + lookbackRequestsToSend,
    advanced: advancedCovered, refusals, elapsedMs,
  })

  return NextResponse.json({
    ok: true, dryRun, clientId, scanned, heartbeatError: hbErr,
    entriesInCatalog: entries.length,
    bound: { maxRequestsPerRun: MAX_REQUESTS_PER_RUN, maxEntriesScanned: MAX_ENTRIES_SCANNED_PER_RUN, requestsSelected: sel.requests, droppedForBound: sel.droppedForBound,
      lookbackRequestsPerRun: LOOKBACK_REQUESTS_PER_RUN, lookbackRequestsSelected: selLook.requests, lookbackDroppedForBound: selLook.droppedForBound, lookbackMode: LOOKBACK_SLOT_MODE },
    meter: gate.reason,
    instrument,
    published, executed, unitErrors, deferredUnits, refusals,
    lookback: { mode: LOOKBACK_SLOT_MODE, boundary, width: lookbackWidth, observed: lookbackObserved, waiting: lookbackWaiting, earliestAskable, none: lookbackNone },
  })

  } finally {
    // ⛔ THE LEASE RELEASE — every return path above runs through here. Holder-checked in the DB, so a
    // TTL-expired loser can never release a newer winner. A failed release logs inside the module and the
    // TTL recovers the lane; nothing here may throw over the fire's real result.
    if (leaseWon) await releaseFireLease(clientId, 'google_ads', fireInvocationId, LEASE_TTL_S)
  }
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
    // ⛔ LORAMER_NONPUBLISH_ADVANCES_ROTATION_V1 — VENDOR ANSWERS ONLY. 'skipped' and 'floor_stop' are OUR
    // bookkeeping (covered-skips, seals, rotation kicks). Returning one as "the last attempt" flips
    // decideRepublish's `completed` to false and it REPUBLISHES a known-stalled window — vendor spend
    // re-bought on the exact ground the refusal existed to protect.
    .not('outcome', 'in', '("skipped","floor_stop")')
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
