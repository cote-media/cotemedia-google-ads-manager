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
import { detectTrigger } from '@/lib/cron-runs'
import { DRAIN_REGISTRY, requiredSteps, type DrainConn } from '@/lib/backfill/drain-registry'

// LORAMER_DRAIN_FREEMAX_V1 — maxDuration raised to the Pro GA max (800s, free) so each fire runs ~10 connection
// sweeps instead of ~3. SAFE with the 5-min google cron + the 360s claim lease: one connection's full step-sweep
// (~150s: geo 84s + device/hour/dimensional) ≪ 360s lease, so a connection is processed and released well within
// its lease → overlapping fires (800s > 300s cron) pick DIFFERENT lease-expired connections, never double-claim
// the same one. (If a single-connection sweep ever approaches 360s, raise the lease in migration 014.) Memory is
// unaffected by duration — laps run sequentially, each releases; peak stays the per-lap working set.
export const maxDuration = 800
export const dynamic = 'force-dynamic'
export const fetchCache = 'force-no-store'

const BUDGET_MS = 750_000 // ~50s headroom under the 800s maxDuration for the final lap + response

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

  // 1) Existing connections for this platform (optionally one). NO-OP if none exist.
  let q = supabaseAdmin
    .from('platform_connections')
    .select('client_id, platform, account_id, onboard_steps_done, backfill_priority')
    .eq('platform', platform)
  if (onlyClientId) q = q.eq('client_id', onlyClientId)
  const { data: rows, error: connErr } = await q
  if (connErr) return NextResponse.json({ error: 'connection query failed', detail: connErr.message }, { status: 500 })

  // 2) Pending = required ⊄ done, real connection (account_id present), deduped by (client_id) for this platform.
  const seen = new Set<string>()
  const pending = (rows ?? []).filter((r: any) => {
    if (!r.account_id) return false
    if (seen.has(r.client_id)) return false
    const done: string[] = Array.isArray(r.onboard_steps_done) ? r.onboard_steps_done : []
    const isPending = [...requiredSet].some((k) => !done.includes(k))
    if (isPending) seen.add(r.client_id)
    return isPending
  })

  if (pending.length === 0) {
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

  // 4) Drain up to `cap` connections, one step-lap each, under the atomic claim.
  const token = `drain-${platform}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const results: any[] = []
  let drained = 0
  let claimSkipped = 0
  for (const row of pending) {
    if (drained >= cap) break
    if (Date.now() - started > BUDGET_MS) break

    // Atomic single-owner claim (360s lease). Loser → skip (another tick owns it).
    const { data: claimRows, error: claimErr } = await supabaseAdmin.rpc('claim_backfill_cursor', {
      p_client_id: row.client_id,
      p_platform: drainKey,
      p_token: token,
    })
    if (claimErr) { results.push({ client_id: row.client_id, error: 'claim failed', detail: claimErr.message }); continue }
    const claim = Array.isArray(claimRows) ? (claimRows[0] as any) : (claimRows as any)
    if (!claim?.claimed) { claimSkipped++; continue }

    const conn: DrainConn = { client_id: row.client_id, platform, account_id: row.account_id }
    let curDone: string[] = Array.isArray(row.onboard_steps_done) ? [...row.onboard_steps_done] : []
    const stepResults: any[] = []
    // (a) Run EVERY incomplete step for this connection (registry deepest-first order), ONE lap each. A
    // not-done step does NOT break the loop — a stuck early step (e.g. account erroring) must never starve a
    // later step (e.g. placement). Mark a step done ONLY on lap.done (= reconciled-to-floor / empty-success).
    for (const step of DRAIN_REGISTRY) {
      if (!step.platforms.includes(platform)) continue
      if (curDone.includes(step.key)) continue
      if (Date.now() - started > BUDGET_MS) break
      let lap
      try {
        lap = await step.runLap(conn, { dryRun })
      } catch (e: any) {
        stepResults.push({ step: step.key, error: 'lap threw', detail: String(e?.message ?? e) })
        continue
      }
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
      stepResults.push({ step: step.key, lapDone: lap.done, markedDone, detail: lap.detail })
    }
    drained++
    results.push({ client_id: row.client_id, steps: stepResults })

    // DRY-RUN cleanup: clear the lock we took so the dry-run leaves zero state. (Live relies on the 360s lease.)
    if (dryRun) {
      await supabaseAdmin.from('sync_state')
        .update({ backfill_claim_token: null, backfill_claimed_at: null })
        .eq('client_id', row.client_id).eq('platform', drainKey)
    }
  }

  return NextResponse.json({
    platform, dryRun, trigger, cap,
    pendingTotal: pending.length,
    selected: drained,
    claimSkipped,
    required,
    results,
  }, { status: 200 })
}
