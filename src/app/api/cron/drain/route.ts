// LORAMER_ONBOARD_DRAIN_ROUTE_V1
// Onboarding auto-backfill DRAIN cron (per-platform). For each connection whose onboard_steps_done is missing
// a registry step, runs the next step ONE bounded lap (deepest-first), appends the step key on done; the
// connection drops out of the enumeration when its set ⊇ the platform registry.
//
// SAFETY:
//  • NO-CONNECTION NO-OP: acts ONLY on existing platform_connections rows (can't fabricate a connection).
//  • TWO-LEVEL anti-hammer: per-writer backoff (in the writers) + DRAIN-LEVEL per-tick per-platform cap N
//    (the throughput knob below) + per-platform staggered cron entries.
//  • CLAIM/LOCK: claim_backfill_cursor under a DISTINCT '__drain_'+platform key (migration 014 atomic CAS,
//    360s self-healing lease) → two overlapping ticks can never drain the same connection twice; the distinct
//    key avoids colliding with the woo writer's own ('woocommerce_backfill') claim. Round-robin = least-
//    recently-claimed first; no explicit release (the 360s lease both rotates fairness and auto-frees).
//  • RESUMABLE: cursor writers resume their sync_state cursor; range writers resume via the registry's cursor.
//    A half-drained connection = forward-complete + however-deep-so-far (idempotent, reconcile-gated) — correct.
import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { detectTrigger, startCronRuns, finishCronRun, type CronPlatform } from '@/lib/cron-runs'
import { DRAIN_REGISTRY, requiredSteps, GEO_WINDOW_DAYS, type DrainConn } from '@/lib/backfill/drain-registry'
import { BACKFILL_CONCURRENCY, clampConcurrency, runPool } from '@/lib/backfill/concurrency' // LORAMER_SELFSERVE_SPINE_V1 step 3
import { GoogleQuotaError, isLapFailure } from '@/lib/backfill/google-quota' // LORAMER_GOOGLE_QUOTA_GUARD_V1
import { readGoogleQuotaPause, writeGoogleQuotaPause, holdGoogleWork } from '@/lib/backfill/google-quota-store' // LORAMER_GOOGLE_QUOTA_GUARD_V1
import { getGoogleOpBudget, holdForBudget, recordLaneDeclined } from '@/lib/backfill/google-op-budget' // LORAMER_GOOGLE_OP_BUDGET_V1
import { orderStepsFairShare } from '@/lib/backfill/drain-step-order' // LORAMER_DRAIN_FAIR_SHARE_STEP_ORDER_V1
import { shouldStartAnotherLap } from '@/lib/backfill/lap-budget' // LORAMER_META_ASSET_BUDGET_HEADROOM_V1 — the rule, reused
import { googleForwardReserveDecision } from '@/lib/backfill/google-forward-reserve' // LORAMER_GOOGLE_FWD_QUOTA_RESERVE_V1

// LORAMER_DRAIN_FREEMAX_V1 — maxDuration raised to the Pro GA max (800s, free) so each fire runs ~10 connection
// sweeps instead of ~3. Memory is unaffected by duration — laps run sequentially, each releases; peak stays the
// per-lap working set.
// ⛔ THE ORIGINAL SAFETY ARGUMENT HERE WAS FALSIFIED 2026-08-01 AND IS RECORDED RATHER THAN DELETED. It read:
// "SAFE with the 5-min google cron + the 360s claim lease: one connection's full step-sweep (~150s) ≪ 360s lease,
// so overlapping fires pick DIFFERENT lease-expired connections, never double-claim the same one." BOTH numbers
// were stale — the lease is 480s (migration 021, not 360s), and the google geo sweep does not take ~150s, it runs
// to the ceiling and is killed. With the old */5 cadence a fire starting at t=0 still held its connection at
// t=800 while its lease expired at t=480, so the fire at t=600 could legitimately re-claim the SAME connection.
// Two invocations then wrote the same client's same rows concurrently. The google cron is now 4x/day
// (LORAMER_GOOGLE_DRAIN_THROTTLE_V1), which makes that overlap impossible by schedule — but the invariant to
// preserve is LEASE > maxDuration, and it is NOT true at 1800s either. Do not restore a frequent cadence for
// google without fixing the lease.
//
// LORAMER_DRAIN_EXTENDED_DURATION_V1 — 800 → 1800 as a MEASUREMENT, not a fix (★GOOGLE-GEO-STATEMENT-TIMEOUTS).
// The 2026-08-01T18:20:47Z fire ran the full 800s, failed NO statement, and still did not finish — so the cursor
// was never written. That is a second, independent blocker from the 8s statement timeout: the 40-day geo lap may
// simply not fit the function budget. 1800s is the cheapest test of whether TIME is the binding constraint.
// ⚠ IT IS NOT A FIX. The lap still rewrites rows it already holds (measured: three slices at 100% conflict).
// ELIGIBILITY, VERIFIED LIVE 2026-08-01 against the Vercel API, not assumed — extended duration is BETA:
//   · runtime nodejs24.x — in the beta-supported set (nodejs20.x/22.x/24.x, python3.12/3.13/3.14) ✓
//   · fluid compute — resourceConfig.fluid = true AND defaultResourceConfig.fluid = true ✓
//   · Secure Compute — /v1/connect/networks returned [] for the team; connectConfigurations null ✓
//   · Static IPs — /v1/projects/<id>/shared-connect-links returned 404 not_found ✓
//   Secure Compute and Static IPs DO NOT SUPPORT durations above 800s during the beta. If either is ever enabled,
//   this value must go back to 800 FIRST. tests/guards/drain-extended-duration.guard.mjs enforces what is
//   mechanically checkable and states plainly what is not.
// ⛔ PER-FUNCTION ONLY. "Project-level defaults above 800 seconds are not supported yet" (Vercel docs, beta) —
// so this stays a route-segment export and must never become a vercel.json project default.
export const maxDuration = 1800
export const dynamic = 'force-dynamic'
export const fetchCache = 'force-no-store'

// ⛔ RAISED WITH maxDuration ON PURPOSE — LEAVING IT AT 680_000 WOULD HAVE MADE THE WHOLE CHANGE A NO-OP.
// This is the budget that stops the route SCHEDULING new work; the platform ceiling only kills what is already
// running. At 680s the fire would still have stopped taking on work at ~11 minutes and returned cleanly, and the
// experiment would have measured nothing while looking like it ran.
// LORAMER_DRAIN_FAIR_SHARE_STEP_ORDER_V1 — the reservation a lap gets BEFORE this fire has measured one.
// ⛔ FIRST_LAP_MS (90s, lap-budget.ts) IS SIZED FOR A META-ASSET LAP AND IS AN ORDER OF MAGNITUDE TOO SMALL
// HERE — at elapsed 1500s it would wave through a lap that then runs to the kill. This is passed as the
// parameter that module already exposes precisely so a heavier caller does not lower the shared default and
// silently re-open the 504 class on the asset route.
// ⚠ 900s is DERIVED FROM ONE OBSERVATION, NOT MEASURED: Foam OH's google_geo lap on 2026-08-02 took ~853s,
// itself inferred from the 12:20:20Z fire start and the 12:34:33Z cursor write — there is no lap timer, so it
// is two stamps and a subtraction. Re-derive it the first time a lap is actually instrumented; the banked
// lesson from LORAMER_META_PRODUCT_ID_ROUTE_V1 is that a per-unit cost inferred from a sibling was wrong by
// ~47% in the unsafe direction. Erring HIGH costs one fewer step per fire; erring LOW costs a silent kill.
const DRAIN_FIRST_LAP_MS = 900_000
const BUDGET_MS = 1_680_000 // ~120s headroom under the 1800s maxDuration — the same margin the 800s value carried:
                          // a step that starts just under budget can finish before the platform ceiling → no 504 overrun

// ── DRAIN-LEVEL CONCURRENCY CAP — connections drained per platform PER TICK. THROUGHPUT KNOB: raise to drain
// the cohort faster (bounded by each platform's quota; each lap is backoff-gated). Woo lowest (live self-hosted).
const PER_PLATFORM_CAP: Record<string, number> = {
  google: 18, // LORAMER_DRAIN_FREEMAX_V1 — = cohort size so the 750s budget + 360s lease (not an artificial cap)
              // govern throughput; effective ~5 sweeps/fire (budget) × 5-min cron, each connection laps ~every
              // 360s (lease) → 36-mo backfill ~6-9h vs ~2-3mo at the old 6h/cap-4. Cost unchanged (work-bound).
  meta: 4,
  ga: 4,
  shopify: 4,
  woocommerce: 2,
}
const KNOWN = Object.keys(PER_PLATFORM_CAP)

export async function GET(request: Request) {
  const envSecret = (process.env.CRON_SECRET ?? '').trim()
  const authHeader = request.headers.get('authorization') ?? ''
  const got = (authHeader.startsWith('Bearer ') ? authHeader.slice('Bearer '.length) : authHeader).trim()
  if (!envSecret || got !== envSecret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { searchParams } = new URL(request.url)
  const platform = searchParams.get('platform') ?? ''
  if (!KNOWN.includes(platform)) {
    return NextResponse.json({ error: `platform must be one of ${KNOWN.join(', ')}` }, { status: 400 })
  }
  const dryRun = searchParams.get('dryRun') === 'true'
  const onlyClientId = searchParams.get('clientId') // optional: restrict to ONE connection (dry-run / targeted)
  const cap = PER_PLATFORM_CAP[platform]
  const required = requiredSteps(platform)
  const requiredSet = new Set(required)
  const trigger = detectTrigger(request)
  const started = Date.now()

  // LORAMER_GOOGLE_QUOTA_GUARD_V1 — the Google Ads quota is DEVELOPER-token scoped = GLOBAL across all google
  // clients. If a prior lap tripped the global pause, skip the ENTIRE google fire until the reset window
  // elapses (clock-based auto-resume in readGoogleQuotaPause — no manual unblock). Non-google platforms never
  // read it. Checked BEFORE the connection query so a paused fire does zero outbound Google work.
  if (platform === 'google') {
    // LORAMER_QUOTA_READ_SPLIT_STATE_V1 — gate on holdGoogleWork, NOT on .paused. An UNKNOWN read (the sentinel
    // query failed) must HOLD this lane: the cost is one lap skipped and retried in ~10 min, versus spending the
    // whole developer-scope quota against a pause we could not see. quotaState is surfaced in the JSON so an
    // operator can tell a real pause from an unreadable sentinel without digging through logs.
    const qp = await readGoogleQuotaPause()
    if (holdGoogleWork(qp)) {
      const note = qp.state === 'unknown'
        ? `google quota sentinel UNREADABLE — holding this lane (not a confirmed pause): ${qp.reason}`
        : `google quota paused until ${qp.until}`
      return NextResponse.json({ platform, dryRun, trigger, cap, ok: true, selected: 0, quotaPaused: qp.paused, quotaState: qp.state, quotaUntil: qp.until, note, results: [] }, { status: 200 })
    }
    // LORAMER_GOOGLE_FWD_QUOTA_RESERVE_V1 — reserve the daily forward slice: within N minutes of the ~08:03:57 UTC
    // quota reset, if today's google FORWARD pass has not finished, hold the deep-history drain OFF google so forward
    // gets first, uncontested access to the fresh 15k-op quota. Releases the instant forward finishes (forwardPending
    // flips) and never past the reset+N cap. Scoped to the broad scheduled fire — a targeted single-connection run
    // (onlyClientId: manual recovery / new-client onboarding kickoff) bypasses the polite hold. See ★GOOGLE-QUOTA-
    // PRIORITY-INVERSION; this is the ALLOCATE half the reactive LORAMER_GOOGLE_QUOTA_GUARD_V1 pause never had.
    // LORAMER_GOOGLE_OP_BUDGET_V1 — the drain spends from the RANKED side of the allocation (forward, geo lap,
    // deep history). It still gets a ceiling: without one, the deep-history drain can empty the cap just as
    // catchup did. A scoped run (onlyClientId = manual recovery / onboarding kickoff) KEEPS ITS BYPASS —
    // manual recovery must remain possible even when the automatic lanes are done for the day.
    if (!onlyClientId) {
      const budget = await getGoogleOpBudget('drain')
      if (holdForBudget(budget)) {
        await recordLaneDeclined({ lane: 'drain', platform: 'google', budget })
        return NextResponse.json({
          platform, dryRun, trigger, cap, ok: true, selected: 0,
          skipOpBudget: true, budgetState: budget.state, budgetRemaining: budget.remaining,
          // WHICH CHECK FIRED — 'lane_allocation' | 'fleet_cap' | 'unreadable'. Never inferred from the numbers.
          budgetBlockedBy: budget.blockedBy,
          budgetAllocation: budget.allocation, estimatedOpsSpentToday: budget.estimatedOpsSpentToday,
          rawRequestsToday: budget.rawRequestsToday, safetyMultiplier: budget.safetyMultiplier,
          // THE DENOMINATOR (LORAMER_EMPTY_CARRIES_ITS_DENOMINATOR_V1): this lane's spend AND the fleet's, plus
          // the per-lane split, so a decline never has to be reconstructed from a single total.
          fleetRawRequestsToday: budget.fleetRawRequestsToday,
          fleetEstimatedOpsToday: budget.fleetEstimatedOpsToday,
          byLaneRawRequests: budget.byLaneRawRequests,
          catchupAllocation: budget.catchupAllocation, rankedReserve: budget.reserve,
          note: `google op budget: ${budget.reason}`,
          results: [],
        }, { status: 200 })
      }
    }
    if (!onlyClientId) {
      const reserve = await googleForwardReserveDecision(Date.now())
      if (reserve.skip) {
        return NextResponse.json({
          platform, dryRun, trigger, cap, ok: true, selected: 0,
          skipQuotaReserve: true,
          reserveWindowMinutes: reserve.windowMinutes,
          minutesSinceReset: reserve.minutesSinceReset,
          resetTimeUtc: reserve.resetTimeUtc,
          captureDate: reserve.captureDate,
          forwardActiveClients: reserve.activeClients,
          forwardCompletedClients: reserve.completedClients,
          note: `google forward-reserve: ${reserve.minutesSinceReset}m after the ${reserve.resetTimeUtc} UTC reset (window ${reserve.windowMinutes}m) and forward not finished (${reserve.completedClients}/${reserve.activeClients} clients synced ${reserve.captureDate}) — holding drain off google so forward gets the fresh quota`,
          results: [],
        }, { status: 200 })
      }
    }
  }

  // LORAMER_GOOGLE_OP_BUDGET_LANE_ACCOUNTING_V2 — THE DRAIN NOW RECORDS ITS OWN SPEND.
  // ⛔ A LANE THAT CAN REQUEST BUDGET BUT CANNOT RECORD SPEND MUST NOT EXIST. This route calls
  // getGoogleOpBudget('drain') above; until this change it wrote NO cron_runs rows, so readGoogleSpendToday
  // could not see it and billed it for forward's and catchup's work instead (measured 2026-07-31).
  // ⛔ PLACEMENT IS DELIBERATE — AFTER the quota / op-budget / forward-reserve gates, so a DECLINED fire leaves
  // NO unfinished cron_runs row. An unstamped row is the silent-hole signal (LORAMER_CRON_RUNS_SENTINEL_V1),
  // and a monitoring fix must not manufacture the alarm it exists to make readable; the decline is already
  // recorded durably by recordLaneDeclined into capture_pass_log. From here EVERY exit stamps finished_at.
  const cronRunIds = await startCronRuns({
    mode: 'drain',
    platforms: [platform as CronPlatform],
    trigger,
  })
  const cronRunId = cronRunIds[platform] ?? null

  // 1) Existing connections for this platform (optionally one). NO-OP if none exist.
  let q = supabaseAdmin
    .from('platform_connections')
    .select('client_id, platform, account_id, onboard_steps_done, backfill_priority')
    .eq('platform', platform)
  if (onlyClientId) q = q.eq('client_id', onlyClientId)
  const { data: rows, error: connErr } = await q
  if (connErr) {
    await finishCronRun(cronRunId, { errorCount: 1 })
    return NextResponse.json({ error: 'connection query failed', detail: connErr.message }, { status: 500 })
  }

  // LORAMER_DELETE_CLIENT_V1 — stop FORWARD capture for ARCHIVED clients: their platform_connections rows still
  // exist (soft-delete touches nothing), so the drain must skip them. Existing captured history is untouched.
  const connClientIds = Array.from(new Set((rows ?? []).map((r: any) => r.client_id).filter(Boolean)))
  const archivedClientIds = new Set<string>()
  if (connClientIds.length) {
    const { data: arch } = await supabaseAdmin
      .from('clients').select('id').in('id', connClientIds).not('deleted_at', 'is', null)
    for (const a of arch || []) archivedClientIds.add((a as any).id as string)
  }

  // 2) Pending = required ⊄ done, real connection (account_id present), deduped by (client_id) for this platform.
  const seen = new Set<string>()
  const pending = (rows ?? []).filter((r: any) => {
    if (!r.account_id) return false
    if (archivedClientIds.has(r.client_id)) return false // LORAMER_DELETE_CLIENT_V1 — archived → no new capture
    if (seen.has(r.client_id)) return false
    const done: string[] = Array.isArray(r.onboard_steps_done) ? r.onboard_steps_done : []
    const isPending = [...requiredSet].some((k) => !done.includes(k))
    if (isPending) seen.add(r.client_id)
    return isPending
  })

  if (pending.length === 0) {
    // Ran, examined the connection set, found nothing to do. Zero attempted is a REAL reading, not an absence.
    await finishCronRun(cronRunId, { connectionsAttempted: 0, connectionsSucceeded: 0, connectionsErrored: 0, connectionsSkipped: 0 })
    return NextResponse.json({ platform, dryRun, trigger, cap, selected: 0, note: 'nothing pending — no-op', results: [] }, { status: 200 })
  }

  // 3) PRIORITY LANE then round-robin: backfill_priority DESC (HIGH new-clients first), then least-recently-claimed
  // (under the __drain_ key) first; never-claimed (null) first. ORDERING-ONLY — this does NOT touch the claim/lease
  // lock below (acquire+release timing is byte-identical); changing which UNCLAIMED connection is tried first
  // cannot introduce a double-claim (the lock still guards every actual claim).
  const drainKey = '__drain_' + platform
  const { data: claims } = await supabaseAdmin
    .from('sync_state')
    .select('client_id, backfill_claimed_at')
    .eq('platform', drainKey)
    .in('client_id', pending.map((p: any) => p.client_id))
  const claimedAt = new Map<string, string | null>()
  for (const c of claims ?? []) claimedAt.set((c as any).client_id, (c as any).backfill_claimed_at)
  pending.sort((a: any, b: any) => {
    const pa = Number(a.backfill_priority ?? 0) // higher = more urgent (new-client HIGH); default 0 = normal
    const pb = Number(b.backfill_priority ?? 0)
    if (pa !== pb) return pb - pa // priority DESC
    const ta = claimedAt.get(a.client_id) ?? '' // tie-break: null/absent → '' sorts first (least recent)
    const tb = claimedAt.get(b.client_id) ?? ''
    return ta < tb ? -1 : ta > tb ? 1 : 0
  })

  // 4) Drain up to `cap` connections, one step-lap each, under the atomic claim. BOUNDED-CONCURRENCY (step 3):
  // up to `concurrency` sweeps run in PARALLEL via runPool; each runner claims its OWN connection through the
  // SAME atomic CAS (migration 014) — distinct connections per runner + the CAS single-owner guard ⇒ no two
  // runners ever hold the same connection (double-claim-safe under concurrency; the lock is UNCHANGED).
  // `concurrency` is hard-capped to fit 2GB by clampConcurrency (reduces N rather than risk OOM).
  const concurrency = clampConcurrency(BACKFILL_CONCURRENCY, GEO_WINDOW_DAYS)
  const token = `drain-${platform}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const results: any[] = []
  const failedSteps: any[] = [] // LORAMER_GOOGLE_QUOTA_GUARD_V1 CHANGE 1 — durable, visible failures; a dead/non-advancing lap can never read as a green fire
  const quotaBox: { hit: { resetIso: string; detail: string } | null } = { hit: null } // CHANGE 3 — object box: a closure-mutated object prop stays its declared type (a plain `let` would CFA-narrow to null after the pool)
  let drained = 0
  let claimSkipped = 0
  // LORAMER_RANGELAP_COMPLETION_HONESTY_V1 — `written` is the universal rows key across all 22 rangeLap writers,
  // verified one by one. ⛔ A writer reporting NO count is UNKNOWN, never zero: reading a missing field as
  // "wrote nothing" would manufacture a false figure out of a schema gap.
  let rowsWrittenTally = 0
  // LORAMER_DRAIN_FAIR_SHARE_STEP_ORDER_V1 — worst lap observed THIS FIRE, shared across the pool. Feeds the
  // budget RESERVATION below. Fire-scoped rather than per-connection on purpose: BUDGET_MS is fire-scoped, and
  // under concurrency a heavy lap on one connection is exactly the thing that must make a sibling cautious.
  const lapBox = { maxMs: 0 }
  const overBudget = () => Date.now() - started > BUDGET_MS
  await runPool(pending, concurrency, async (row) => {
    if (quotaBox.hit) return // CHANGE 3 — quota tripped earlier this fire: do no more google work
    // Atomic single-owner claim (360s lease). Loser → skip (another tick/runner owns it).
    const { data: claimRows, error: claimErr } = await supabaseAdmin.rpc('claim_backfill_cursor', {
      p_client_id: row.client_id,
      p_platform: drainKey,
      p_token: token,
    })
    if (claimErr) { results.push({ client_id: row.client_id, error: 'claim failed', detail: claimErr.message }); return }
    const claim = Array.isArray(claimRows) ? (claimRows[0] as any) : (claimRows as any)
    if (!claim?.claimed) { claimSkipped++; return }

    const conn: DrainConn = { client_id: row.client_id, platform, account_id: row.account_id }
    let curDone: string[] = Array.isArray(row.onboard_steps_done) ? [...row.onboard_steps_done] : []
    const stepResults: any[] = []
    // (a) Run EVERY incomplete step for this connection, ONE lap each. A not-done step does NOT break the loop —
    // a stuck early step (e.g. account erroring) must never starve a later step (e.g. placement). Mark a step
    // done ONLY on lap.done (= reconciled-to-floor / empty-success).
    //
    // ═══ LORAMER_DRAIN_FAIR_SHARE_STEP_ORDER_V1 ══════════════════════════════════════════════════════════════
    // ⛔ THE ORDER IS NO LONGER RAW ARRAY POSITION. It was, on every fire, for every connection, forever — so a
    // SLOW step starved whatever sat behind it, always in the same direction, with no mechanism that could let
    // the starved step ever lead. And `break` exits the WHOLE loop, so it starves EVERY step behind it, not one.
    // Within a declared tier the least-recently-SUCCEEDED step now leads (sync_state.updated_at ASC, NULLS
    // FIRST). Across tiers nothing moves — the tier IS the dependency boundary the prose used to carry alone.
    const incomplete = DRAIN_REGISTRY.filter(
      (step) => step.platforms.includes(platform) && !curDone.includes(step.key),
    )
    // ONE bounded read per connection: every cursor row this client owns. `updated_at` moves ONLY on a
    // successful lap (writeRangeCursor is its sole writer on this path and rangeLap returns before it on any
    // non-200), so it already means "when did this step last actually succeed" — no new column, no migration.
    // ⚠ Looked up BY STEP KEY, which equals the cursor key for every rangeLap step. A step whose cursor key
    // differs (e.g. 'account', which rides the adapter's own platform cursor) resolves to null and would sort
    // first WITHIN ITS TIER — harmless while it is alone there, which the guard's single-shared-tier leg pins.
    const { data: cursorRows } = await supabaseAdmin
      .from('sync_state')
      .select('platform, updated_at')
      .eq('client_id', row.client_id)
    const lastSucceeded = new Map<string, string | null>()
    for (const c of cursorRows ?? []) lastSucceeded.set((c as any).platform, (c as any).updated_at ?? null)
    const orderedSteps = orderStepsFairShare(
      incomplete.map((step) => ({ step, key: step.key, tier: step.tier, lastSucceededAt: lastSucceeded.get(step.key) ?? null })),
    ).map((w) => w.step)

    for (const step of orderedSteps) {
      // ⛔ RESERVATION, NOT A BARE ELAPSED CHECK. The old `Date.now() - started > BUDGET_MS` reserved NOTHING
      // for the lap it was about to begin, so a lap dispatched just under the line ran past maxDuration and was
      // KILLED — no cursor, no log line, no cron_runs stamp, indistinguishable from never having run. That is
      // LORAMER_META_ASSET_BUDGET_HEADROOM_V1's rule ("a between-iteration budget check is only safe if ONE
      // ITERATION CANNOT EXCEED THE REMAINING CEILING") applied to the step loop, using its shipped function.
      if (!shouldStartAnotherLap(Date.now() - started, lapBox.maxMs, BUDGET_MS, DRAIN_FIRST_LAP_MS)) break
      const lapStartedAt = Date.now()
      let lap
      try {
        lap = await step.runLap(conn, { dryRun })
      } catch (e: any) {
        // A lap that THREW still consumed the fire's clock — feed it to the reservation before any exit, or the
        // next dispatch reserves against a stale maximum and re-opens the overrun this change exists to close.
        lapBox.maxMs = Math.max(lapBox.maxMs, Date.now() - lapStartedAt)
        if (e instanceof GoogleQuotaError) {
          // CHANGE 3 — developer-scope quota: pause ALL google work this fire; the global marker is written
          // after the pool drains. Recorded as a loud, distinct failure (NOT a green step).
          quotaBox.hit = { resetIso: e.resetIso, detail: e.message }
          stepResults.push({ step: step.key, error: 'google_quota', detail: e.message, resetIso: e.resetIso })
          failedSteps.push({ client_id: row.client_id, step: step.key, kind: 'google_quota', resetIso: e.resetIso, detail: e.message })
          console.error(`[drain] GOOGLE QUOTA (developer-scope) → pausing google until ${e.resetIso} | client=${row.client_id} step=${step.key}`)
          break
        }
        const detail = String(e?.message ?? e)
        stepResults.push({ step: step.key, error: 'lap threw', detail })
        failedSteps.push({ client_id: row.client_id, step: step.key, kind: 'threw', detail }) // CHANGE 1
        console.error(`[drain] LAP THREW | platform=${platform} client=${row.client_id} step=${step.key}: ${detail}`)
        continue
      }
      lapBox.maxMs = Math.max(lapBox.maxMs, Date.now() - lapStartedAt)
      let markedDone = false
      if (!dryRun && lap.done) {
        curDone = Array.from(new Set([...curDone, step.key]))
        // Priority DECAY: when this connection becomes fully onboarded (curDone ⊇ requiredSteps), drop it from the
        // new-client HIGH lane back to normal. Written in the SAME onboard_steps_done update (no extra round-trip,
        // does NOT touch the claim/lease). New-client HIGH is SET on connect (build step 2).
        const nowComplete = requiredSet.size > 0 && [...requiredSet].every((k) => curDone.includes(k))
        const upd = await supabaseAdmin
          .from('platform_connections')
          .update(nowComplete ? { onboard_steps_done: curDone, backfill_priority: 0 } : { onboard_steps_done: curDone })
          .eq('client_id', row.client_id)
          .eq('platform', platform)
          .eq('account_id', row.account_id)
        markedDone = !upd.error
      }
      const lapWritten = (lap as any)?.detail?.written
      if (typeof lapWritten === 'number' && Number.isFinite(lapWritten)) rowsWrittenTally += lapWritten
      stepResults.push({ step: step.key, lapDone: lap.done, markedDone, detail: lap.detail })
      if (isLapFailure(lap)) {
        // CHANGE 1 — a writer non-200 (rangeLap returns done:false + detail.error 'writer failed'). This is
        // exactly the silent stall: previously buried under a 200. Surface it loudly + durably.
        failedSteps.push({ client_id: row.client_id, step: step.key, kind: 'writer-failed', detail: lap.detail })
        console.error(`[drain] LAP FAILED | platform=${platform} client=${row.client_id} step=${step.key}: ${JSON.stringify(lap.detail).slice(0, 500)}`)
      }
    }
    drained++
    results.push({ client_id: row.client_id, steps: stepResults })

    // DRY-RUN cleanup: clear the lock we took so the dry-run leaves zero state. (Live relies on the 360s lease.)
    if (dryRun) {
      await supabaseAdmin.from('sync_state')
        .update({ backfill_claim_token: null, backfill_claimed_at: null })
        .eq('client_id', row.client_id).eq('platform', drainKey)
    }
  }, () => drained >= cap || overBudget() || quotaBox.hit !== null) // CHANGE 3 — stop scheduling once quota trips

  // CHANGE 3 — persist the GLOBAL pause so subsequent fires skip google until the reset window. Skipped on
  // dryRun (a diagnostic dry-run must not pause production). Best-effort; a failed write self-heals next fire.
  const qh = quotaBox.hit
  if (qh && !dryRun) {
    try { await writeGoogleQuotaPause(qh.resetIso, qh.detail) }
    catch (e: any) { console.error(`[drain] failed to persist google quota pause: ${String(e?.message ?? e)}`) }
  }

  // LORAMER_CONNECTION_OUTCOME_LEDGER_V1 — attempted = ok + errored + skipped, BY CONSTRUCTION, never by
  // subtraction. A connection that lost the atomic claim race is SKIPPED ("we did not look"), which is a
  // different fact from a connection that ran and wrote nothing. ⛔ PRECEDENCE error > ok: a connection with
  // ANY failed step is ERRORED even if other steps wrote rows — a partial fill must not read green.
  const erroredConnIds = new Set(failedSteps.map((f: any) => f.client_id))
  const connectionsErrored = erroredConnIds.size
  const connectionsSucceeded = Math.max(0, drained - connectionsErrored)
  await finishCronRun(cronRunId, {
    connectionsAttempted: drained + claimSkipped,
    connectionsSucceeded,
    connectionsErrored,
    connectionsSkipped: claimSkipped,
    rowsWritten: rowsWrittenTally,
    errorCount: failedSteps.length,
  })

  return NextResponse.json({
    platform, dryRun, trigger, cap, concurrency,
    pendingTotal: pending.length,
    selected: drained,
    claimSkipped,
    connectionsAttempted: drained + claimSkipped,
    connectionsSucceeded,
    connectionsErrored,
    rowsWritten: rowsWrittenTally,
    required,
    ok: failedSteps.length === 0, // CHANGE 1 — green ONLY when zero failed steps
    failed: failedSteps.length,
    failedSteps,
    ...(qh ? { quotaPaused: true, quotaUntil: qh.resetIso } : {}),
    results,
  }, { status: 200 })
}
