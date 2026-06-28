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
