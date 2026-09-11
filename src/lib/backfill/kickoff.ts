// LORAMER_SELFSERVE_SPINE_V1 step 2 — connect-kickoff (transport A: @vercel/functions waitUntil).
import { waitUntil } from '@vercel/functions'

// Fire-and-forget: trigger an IMMEDIATE backfill drain for a just-connected client instead of waiting for the */5
// cron tick. SAFETY: it goes through the drain's EXISTING claim/lease — if the cron already claimed this client,
// the drain no-ops (no double-fire, no lock bypass). It NEVER throws — a kickoff failure leaves the client
// connected and the */5 cron (HIGH-priority first, set via backfill_priority on the connection row) as the
// guaranteed fallback.
//
// waitUntil keeps the OAuth/connect callback alive ~8s (AbortSignal.timeout) to GUARANTEE the request reaches
// Vercel, then detaches; the drain runs to completion on its OWN invocation (up to 800s), independent of the
// aborted caller connection. (Even if Vercel ever cancelled the callee on caller-abort, the drain is idempotent +
// resumable and the cron resumes it — graceful either way.)
export function kickoffBackfill(origin: string, clientId: string, platform: string): void {
  const secret = process.env.CRON_SECRET
  if (!secret) {
    console.error(`[kickoff] CRON_SECRET missing — skipping immediate kickoff (client=${clientId} platform=${platform}); */5 cron fallback covers it`)
    return
  }
  const url = `${origin}/api/cron/drain?platform=${encodeURIComponent(platform)}&clientId=${encodeURIComponent(clientId)}`
  waitUntil(
    fetch(url, {
      headers: { Authorization: `Bearer ${secret}` },
      signal: AbortSignal.timeout(8000),
    })
      .then((r) => {
        // The drain runs for minutes; it won't return inside the 8s window in practice. If it DOES return fast
        // with a non-2xx (e.g. 401/405), that's a real failure — log loudly.
        if (!r.ok) console.error(`[kickoff] drain returned ${r.status} (client=${clientId} platform=${platform}) — */5 cron fallback will cover`)
      })
      .catch((err: any) => {
        // TimeoutError is EXPECTED: we intentionally abort at 8s after delivery and let the drain run on its own
        // invocation. Anything else (network/DNS) is a real delivery failure — log loudly. (Deviation from the
        // literal spec, which would log every kickoff as "failed" because the 8s abort always rejects.)
        if (err?.name === 'TimeoutError') return
        console.error(`[kickoff] failed, */5 cron fallback will cover (client=${clientId} platform=${platform}):`, err?.message ?? err)
      })
  )
}

// LORAMER_DELETE_CLIENT_V1 slice 2 — RESTORE gap-fill kickoff. Fires the catchup cron in RESTORE mode for ONE client
// across [since, today] (ALL its platforms, floor-clamped per platform), on the SAME metered __catchup_ lane. Same
// fire-and-forget waitUntil + 8s-abort + never-throws contract as kickoffBackfill; the */10 catchup cron is the
// fallback (though it won't re-enter restore mode — a very deep gap needs a re-kick, logged below).
export function kickoffGapBackfill(origin: string, clientId: string, sinceDate: string): void {
  const secret = process.env.CRON_SECRET
  if (!secret) {
    console.error(`[kickoff-gap] CRON_SECRET missing — skipping restore gap-fill (client=${clientId}); forward capture still resumes`)
    return
  }
  const url = `${origin}/api/cron/catchup?clientId=${encodeURIComponent(clientId)}&since=${encodeURIComponent(sinceDate)}`
  waitUntil(
    fetch(url, {
      headers: { Authorization: `Bearer ${secret}` },
      signal: AbortSignal.timeout(8000),
    })
      .then((r) => {
        if (!r.ok) console.error(`[kickoff-gap] catchup returned ${r.status} (client=${clientId} since=${sinceDate})`)
      })
      .catch((err: any) => {
        if (err?.name === 'TimeoutError') return
        console.error(`[kickoff-gap] failed (client=${clientId} since=${sinceDate}):`, err?.message ?? err)
      })
  )
}

// LORAMER_ONE_CLICK_WALK_V1 (2/2 A) — THE WALK'S FIRST TOUCH, FIRED THE SAME WAY. The -next Backfill button fires the
// resumer ONCE for its client. The resumer executes the worker INLINE (universe-resume/route.ts processMessage) and the
// worker discovers the account's inception on first touch (universe-v2-worker.ts discoverAccountInception), so one fire
// on a cold client writes universe_account_inception + the first descend attempts — the v2 ledgers the readout reads.
// (Round 15's publish through universe-start's core fed the V1 topic consumer instead: universe_window_log, no
// inception, no attempt rows — corrected round 16.) Same contract as kickoffBackfill: CRON_SECRET never leaves the
// server, waitUntil + 8 s abort, never throws; the resumer's own lease (universe_fire_lease per client/vendor, TTL 330)
// makes a repeat click a no-op against an active fire. `dryRun=0` is REQUIRED — the resumer's default is dry.
// vercel.json still schedules only the pinned client; per-client scheduling is 2/2 B (STOP-and-confirm 4).
export function kickoffWalk(origin: string, clientId: string): void {
  const secret = process.env.CRON_SECRET
  if (!secret) {
    console.error(`[kickoff-walk] CRON_SECRET missing — skipping walk kick (client=${clientId}); the scheduled resumer is the only fallback`)
    return
  }
  const url = `${origin}/api/cron/universe-resume?clientId=${encodeURIComponent(clientId)}&dryRun=0`
  waitUntil(
    fetch(url, {
      headers: { Authorization: `Bearer ${secret}` },
      signal: AbortSignal.timeout(8000),
    })
      .then((r) => {
        if (!r.ok) console.error(`[kickoff-walk] universe-resume returned ${r.status} (client=${clientId})`)
      })
      .catch((err: any) => {
        if (err?.name === 'TimeoutError') return
        console.error(`[kickoff-walk] failed (client=${clientId}):`, err?.message ?? err)
      })
  )
}
