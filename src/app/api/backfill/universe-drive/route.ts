// LORAMER_SINGLE_SURFACE_DRIVE_V1 — THE DRIVE'S PUBLISH PRIMITIVE. ONE SURFACE, ONE WINDOW, ONE MESSAGE.
//
// ⛔ WHY THIS EXISTS AND WHY IT IS NOT A SECOND SCHEDULER. The walk advances one window per surface per
// 15-minute fire, and only when that surface wins one of 60 rotation slots out of 346 — so proving ONE
// surface to its inception floor by waiting for rotation would take days and prove it at fleet cost. This
// route lets an OPERATOR drive a single surface pass-by-pass and watch its frontier march. It publishes
// EXACTLY ONE message per call and has no loop of its own: **the driver owns the loop** (June's rule,
// BackfillControl.tsx:64-86), same as the resumer.
//
// ⛔ IT INVENTS NO WINDOW MATH. Anchor, sizing, stop and owed-ness all come from the SAME functions the
// scheduled resumer uses — `readWalkStopAccountFacts`/`resolveWalkStop`, `sizeNextWindow`,
// `universe_surface_rotation`, `deriveAnchorEnd`, `deriveWindow`, `rangesStillOwed`. If this route and the
// resumer ever disagreed about which window is next, the drive would be proving a different engine than the
// one that runs unattended, which is the only thing that would make it worthless.
//
// ⛔ THE ONE DELIBERATE DEVIATION, STATED BECAUSE IT IS A REAL DIFFERENCE: THE IDEMPOTENCY KEY CARRIES A RUN
// SCOPE. The resumer's key is `resume|client|resource|segment|start|end`, a pure function of the window, and
// Vercel dedupes an identical key for the message's lifetime. That is correct for a scheduler — two
// overlapping fires must not double-publish the same window. It is WRONG for a drive, whose entire purpose is
// to re-ask a window that needs several passes: the second pass would be silently dropped and the drive would
// report a stall that was really a dedupe. The key keeps the resumer's SHAPE and gains `drive|<runId>|`, so
// each operator pass is its own message. `runId` is required for exactly this reason.
//
// ⛔ BLAST RADIUS: ONE surface of ONE client. It does not touch the rotation, publishes no other entry, and
// writes nothing itself — the consumer does the work through the normal path, with the normal meter, the
// normal quota sentinel and the normal bounds. It is CRON_SECRET-gated and has no cron entry of its own.
//
// USAGE: GET /api/backfill/universe-drive?clientId=…&resource=…&segment=…&runId=…[&dryRun=0]
// ⛔ DRY-RUN IS THE DEFAULT, same as the resumer. `?dryRun=0` publishes.
import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { loadUniverse, selectableEntries, readWalkStopAccountFacts, resolveWalkStop, type UniverseEntry } from '@/lib/backfill/google-ads-universe-writer'
import { googleAdsCaptureAdapter, surfaceOfEntry } from '@/lib/backfill/capture-adapters/google-ads.adapter'
import { rangesStillOwed } from '@/lib/backfill/universe-coverage'
// ⛔ THE UNWEDGE NEEDS THE ATTEMPT LOG — the same import the RESUMER makes for the same reason. (The module
// bar is on `universe-coverage.ts`, which may never reach the spend-and-failure API; a publisher may.)
import { randomUUID } from 'node:crypto'
import { appendAttemptStarted, appendAttemptFinished, type AttemptKey, type WriteProvenance } from '@/lib/backfill/universe-attempt-log'
import { sizeNextWindow } from '@/lib/backfill/universe-sizing'
import { LEASE_TTL_S, CONSUMER_MAX_DURATION_S, type UniverseMessageV2 } from '@/lib/backfill/universe-v2-contract'
// ⛔ LORAMER_QUEUE_REMOVED_INLINE_WALK_V1 — the drive EXECUTES its one unit through the same function
// every queue delivery ran. It CASes the SAME (client, vendor) lease as the scheduled fire: a drive
// overlapping a fire is exactly the overlap the lease exists to exclude, and 'lease-held' is a normal,
// retryable answer to the operator, never an error.
import { processMessage } from '@/lib/backfill/universe-v2-worker'
import { acquireFireLease, releaseFireLease } from '@/lib/backfill/universe-fire-lease'
import { readGoogleQuotaPause, holdGoogleWork } from '@/lib/backfill/google-quota-store'
import { deriveAnchorEnd, deriveWindow, WINDOWS_PER_PUBLISHED_MESSAGE } from '@/lib/backfill/universe-resumer'

export const dynamic = 'force-dynamic'
export const fetchCache = 'force-no-store'
// ⛔ THE CEILING IS THE CONTRACT'S — these routes are now the walk's EXECUTION HOSTS, so their ceiling is
// the one the budget reservation and the lease TTL are derived against. Never a literal (drive-ceiling-pin).
export const maxDuration = CONSUMER_MAX_DURATION_S

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
  const prov: WriteProvenance = { messageKey: null, invocationId: randomUUID() }
  const envSecret = (process.env.CRON_SECRET ?? '').trim()
  const authHeader = request.headers.get('authorization') ?? ''
  const got = (authHeader.startsWith('Bearer ') ? authHeader.slice('Bearer '.length) : authHeader).trim()
  if (!envSecret || got !== envSecret) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const url = new URL(request.url)
  const clientId = url.searchParams.get('clientId')
  const resource = url.searchParams.get('resource')
  const segment = url.searchParams.get('segment') ?? ''
  const runId = url.searchParams.get('runId')
  const dryRun = url.searchParams.get('dryRun') !== '0'
  if (!clientId || !resource) return NextResponse.json({ error: 'clientId and resource required' }, { status: 400 })
  if (!runId) return NextResponse.json({ error: 'runId required — it scopes the idempotency key so a multi-pass drive is not deduped into a false stall' }, { status: 400 })

  // ⛔ THE SENTINEL GATES THE OPERATOR TOO. A drive publishing into an armed quota spends the fleet's
  // tomorrow exactly as a scheduler would, and an operator is not a reason to skip the vendor's own refusal.
  const qp = await readGoogleQuotaPause()
  if (holdGoogleWork(qp)) {
    return NextResponse.json({
      ok: true, published: 0,
      held: qp.state === 'unknown' ? `google quota sentinel UNREADABLE — holding (NOT a confirmed pause): ${qp.reason}` : `google quota paused until ${qp.until}`,
    })
  }

  const { data: client } = await supabaseAdmin
    .from('clients').select('id, user_email, platform_connections(*)').eq('id', clientId).single()
  const conn = ((client?.platform_connections ?? []) as any[]).find((c) => c.platform === 'google')
  if (!client || !conn) return NextResponse.json({ error: 'no google connection for this client' }, { status: 400 })
  const userEmail = conn.user_email || client.user_email
  const customerId = conn.account_id

  const doc = loadUniverse()
  const entries = selectableEntries(doc)
  const byKey = new Map<string, UniverseEntry>(entries.map((e) => [`${e.resource}|${e.segment ?? ''}`, e]))
  const entry = byKey.get(`${resource}|${segment}`)
  if (!entry) return NextResponse.json({ error: `no selectable catalog entry for ${resource}|${segment}` }, { status: 400 })

  // ⛔ NO STREAM. This route publishes; it never fetches. Identical posture to the resumer, and the throw is
  // the proof rather than a comment.
  const adapter = googleAdsCaptureAdapter(
    () => { throw new Error('the drive never fetches — it publishes.') },
    (s) => byKey.get(`${s.resource}|${s.segment}`)!,
  )
  const surface = surfaceOfEntry(entry)
  const coverageKey = { clientId, platform: adapter.platform, entityLevel: surface.entityLevel, breakdownType: surface.breakdownType }

  const stopFacts = await readWalkStopAccountFacts({ clientId, vendor: adapter.platform, discover: null })
  const stop = await resolveWalkStop({ clientId, vendor: adapter.platform, resource: surface.resource, segment: surface.segment, facts: stopFacts })

  const { data: rotRows, error: rotErr } = await supabaseAdmin
    .rpc('universe_surface_rotation', { p_client_id: clientId, p_vendor: adapter.platform })
  if (rotErr) return NextResponse.json({ error: `rotation index unreadable: ${rotErr.message}` }, { status: 500 })
  // `parent_known` per migrations/082 — false on a pre-082 row, and an unknown window HOLDS rather than recedes.
  type RotRow = { resource: string; segment: string; last_window_start: string; last_window_end: string; parent_known: boolean }
  const rot = ((rotRows ?? []) as RotRow[]).find((r) => r.resource === resource && (r.segment ?? '') === segment) ?? null

  const sizing = await sizeNextWindow(adapter, { clientId, resource: surface.resource, segment: surface.segment })
  // ⛔ THE RECEDE GATE, OVER THE **PARENT WINDOW** — `rot.last_window_*` is the window ASKED after
  // migrations/082, not the last range walked. Both halves of LORAMER_PARENT_WINDOW_IS_THE_UNIT_V1 move
  // together here exactly as they do in the resumer; recording the window while this still measured the range
  // is the configuration that skips owed days silently.
  const lastCoverage = rot
    ? await rangesStillOwed(coverageKey, String(rot.last_window_start), String(rot.last_window_end))
    : null
  const anchor = deriveAnchorEnd({
    newestGround: addDays(new Date().toISOString().slice(0, 10), -1),
    lastWindowStart: rot ? String(rot.last_window_start) : null,
    lastWindowEnd: rot ? String(rot.last_window_end) : null,
    lastWindowFullyAnswered: lastCoverage === null ? true : lastCoverage.coverage.uncovered.length === 0,
    lastWindowKnown: rot ? rot.parent_known === true : false,
  })
  const win = deriveWindow({ anchorEnd: anchor.anchorEnd, sizingDays: sizing.days, stopDate: stop.stopDate })
  if (win === null) {
    // ⛔ NOT A FAILURE — THE SURFACE IS DONE. The drive's PROVEN halt.
    return NextResponse.json({
      ok: true, published: 0, floorReached: true,
      reason: `anchor ${anchor.anchorEnd} is below the resolved stop (${stop.basis}) — this surface has been walked to its floor`,
      anchorBasis: anchor.basis, stopBasis: stop.basis, stopDate: stop.stopDate,
    })
  }
  const { windowStart, windowEnd } = win

  const owed = (lastCoverage !== null && !anchor.receded &&
    windowStart === String(rot!.last_window_start) && windowEnd === String(rot!.last_window_end))
    ? lastCoverage
    : await rangesStillOwed(coverageKey, windowStart, windowEnd)

  if (owed.ranges.length === 0) {
    // ── ⛔ THE UNWEDGE — LORAMER_WALK_UNWEDGE_AND_HEARTBEAT_V1, CARRIED OVER FROM THE RESUMER RATHER THAN
    // RE-DERIVED (universe-resume/route.ts:334-345; the shape below is that block, byte-for-byte in its
    // effect: appendAttemptStarted(key, 0) then appendAttemptFinished(..., 'skipped', {requestsSpent: 0, …})).
    // ⛔ THE DEFECT IT CLOSES, MEASURED IN THIS ROUTE ON 2026-08-17: this branch returned `nothingOwed` and
    // wrote NOTHING, so no `attempt_started` row existed, so `universe_surface_rotation` never saw the window
    // as ASKED, so `deriveAnchorEnd` never receded past it — and the drive re-derived the SAME covered window
    // **566 consecutive times**. That is ★WALK-WEDGES-AT-COVERED-GROUND exactly, reintroduced in a new
    // publisher by omitting the one thing that makes derivation terminate. The route claimed to "invent no
    // window math" and then left out the unwedge, which is the same failure with better manners.
    // ⛔ rowsWritten deliberately OMITTED (null): `sizeNextWindow` filters `.not('rows_written','is',null)`,
    // so a skip never enters sizing history — a skip is a fact about OUR bookkeeping, not a vendor answer.
    // ⛔ 'skipped' is ALREADY excluded from vendor attestation (attestedEmptyDays takes 'zero'/'nongrain'
    // only), so this can never masquerade as coverage. requests_spent = 0 keeps every spend aggregate honest.
    const key: AttemptKey = { clientId, vendor: adapter.platform, resource: surface.resource, segment: surface.segment, windowStart, windowEnd }
    if (!dryRun) {
      // LORAMER_PARENT_WINDOW_IS_THE_UNIT_V1 — same shape as the resumer's block, carried over rather than
      // re-derived: the covered-skip's parent is the derived window it is advancing past.
      const opened = await appendAttemptStarted(key, 0, { startDate: windowStart, endDate: windowEnd }, prov)
      await appendAttemptFinished(key, opened.attemptNo, 'skipped', {
        requestsSpent: 0,
        error: `COVERED_SKIP — LORAMER_WALK_UNWEDGE_V1: window ${windowStart}..${windowEnd} fully covered/attested; advanced past it with ZERO vendor ops. NOT a vendor attestation — coverage derivation ignores 'skipped'.`,
      }, prov)
    }
    return NextResponse.json({
      ok: true, published: 0, nothingOwed: true, advancedCovered: !dryRun, window: `${windowStart}..${windowEnd}`,
      anchorBasis: anchor.basis, receded: anchor.receded, stopBasis: stop.basis, stopDate: stop.stopDate,
      coverage: { covered: owed.coverage.covered.length, attestedEmpty: owed.coverage.attestedEmpty.length, uncovered: 0 },
    })
  }

  const msg: UniverseMessageV2 = {
    clientId, userEmail, customerId, entry,
    startDate: windowStart, endDate: windowEnd,
    windowsRemaining: WINDOWS_PER_PUBLISHED_MESSAGE,
  }
  // The resumer's shape, scoped by runId — see the header for why the scope is required rather than optional.
  const idempotencyKey = `drive|${runId}|${clientId}|${entry.resource}|${entry.segment ?? ''}|${windowStart}|${windowEnd}`
  // ⛔ THE KEY RIDES ON THE UNIT — LORAMER_COMPLETION_SIGNAL_V1, unchanged: the producer-assigned
  // identifier the terminal row persists, minted exactly as before.
  if (!dryRun) {
    // ⛔ THE SAME LEASE AS THE SCHEDULED FIRE — one lane, one lease. Held = a fire (or another drive) is
    // running; the operator retries after it releases (or after TTL). No spend happened.
    const lease = await acquireFireLease(clientId, 'google_ads', prov.invocationId as string, LEASE_TTL_S)
    if (!lease.won) {
      return NextResponse.json({
        ok: true, published: 0, leaseHeld: true,
        held: `FIRE LEASE HELD — the lane is running (holder ${lease.holder ?? 'unknown'} since ${lease.heldSince ?? 'unknown'}). Retry after release or TTL ${LEASE_TTL_S}s. Nothing spent.`,
        window: `${windowStart}..${windowEnd}`,
      })
    }
    try {
      // No fire deadline on the drive's single unit: the worker's own WALK_BUDGET_MS bounds it, as it
      // always has for one message under the 300s ceiling.
      await processMessage({ ...msg, messageKey: idempotencyKey } satisfies UniverseMessageV2)
    } finally {
      await releaseFireLease(clientId, 'google_ads', prov.invocationId as string, LEASE_TTL_S)
    }
  }

  return NextResponse.json({
    ok: true, published: dryRun ? 0 : 1, executed: dryRun ? 0 : 1, dryRun,
    window: `${windowStart}..${windowEnd}`, ranges: owed.ranges.length, owedDays: owed.coverage.uncovered.length,
    sizing: { days: sizing.days, basis: sizing.basis },
    anchorBasis: anchor.basis, receded: anchor.receded, stopBasis: stop.basis, stopDate: stop.stopDate, idempotencyKey,
  })
}
