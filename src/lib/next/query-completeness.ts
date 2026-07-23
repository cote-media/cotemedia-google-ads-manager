// LORAMER_LORA_INCOMPLETE_TOTAL_V1 (T0 #2 SLICE 1) — the per-platform CONTRIBUTION flag + a top-level
// completeness verdict for query_metrics. It answers, for every platform in scope for a window: did it
// CONTRIBUTE to this total, and if not, WHY — reading ONLY signals that already exist (no new signal invented):
//   · platform_connections.health='degraded' + consecutive_failures + first_failure_at (LORAMER_CONN_*_V1) →
//     capture is CURRENTLY failing; a total including this platform is UNDERSTATED (the SEV-1 case coverage misses:
//     coverage.state reads 'covered' for a window that STARTS in-capture but ends past the last captured day).
//   · coverage.state (getCoverageForWindows) → predates_capture / trailing_gap / draining_unknown / not_connected.
//   · else → 'ok' (healthy + covers the window): whatever rows exist are the TRUE picture, including a genuine zero.
// Shape mirrors money/route.ts:127 coverageComplete (a boolean verdict) + query_money's per-component reason.
// READ-ONLY (one select on platform_connections); never throws to the caller (the tool wraps it best-effort).
import { supabaseAdmin } from '@/lib/supabase'
import type { CoverageResult } from './coverage'

export type ContributionStatus =
  | 'ok'              // healthy + covers the window → rows present are the true picture (incl. a genuine zero)
  | 'capture_failing' // health degraded / active failure streak → recent days missing → total UNDERSTATED
  | 'trailing_gap'    // window ends past our last captured day for this platform → recent days not captured
  | 'predates_capture'// window is before our earliest captured data → honest absence, not a failure
  | 'draining'        // backfill still importing this window
  | 'not_connected'   // platform not connected for this client

export type PlatformContribution = { platform: string; status: ContributionStatus; contributed: boolean; detail: string; since?: string }

type HealthRow = { health: string | null; consecutive_failures: number; first_failure_at: string | null }

export type CompletenessResult = {
  perWindow: PlatformContribution[][]  // [windowIndex][platform]
  completePerWindow: boolean[]         // is THIS window's total complete (no failing / trailing-gap platform)?
  overallComplete: boolean             // are ALL windows complete?
  notes: string[]                      // human notes for the tool payload (what Lora must say)
}

// A window is INCOMPLETE (as a TOTAL) iff a platform is actively FAILING or has a trailing gap — the two
// understatement cases. predates_capture / not_connected / draining are honest absence already carried by
// coverage.state and do NOT, by themselves, make a total a wrong number.
const INCOMPLETE_STATUSES: ReadonlySet<ContributionStatus> = new Set<ContributionStatus>(['capture_failing', 'trailing_gap'])

export async function annotateContribution(
  clientId: string,
  windows: { startDate: string; endDate: string }[],
  coveragePerWindow: CoverageResult[][],
): Promise<CompletenessResult> {
  // The real-time capture-health signal (LORAMER_CONN_FAILURE_STREAK_V1 / _DEGRADED_STATE_V1). Read-only.
  const health = new Map<string, HealthRow>()
  const { data: conns } = await supabaseAdmin
    .from('platform_connections')
    .select('platform, health, consecutive_failures, first_failure_at')
    .eq('client_id', clientId)
  for (const c of conns || []) {
    health.set(c.platform as string, {
      health: (c as any).health ?? null,
      consecutive_failures: Number((c as any).consecutive_failures || 0),
      first_failure_at: (c as any).first_failure_at ?? null,
    })
  }

  const perWindow: PlatformContribution[][] = []
  const completePerWindow: boolean[] = []
  const noteSet = new Set<string>()

  windows.forEach((w, i) => {
    const cov = coveragePerWindow[i] || []
    const row: PlatformContribution[] = cov.map((c) => {
      const p = c.platform
      const h = health.get(p)
      const firstFailDay = h?.first_failure_at ? String(h.first_failure_at).slice(0, 10) : null
      // Capture is FAILING for THIS window iff there is an active streak (or a degraded verdict) AND the window
      // overlaps the failure period (its end is on/after the day the streak began). A window entirely before the
      // failure is unaffected.
      const failing = !!h && (h.consecutive_failures > 0 || h.health === 'degraded') && !!firstFailDay && w.endDate >= firstFailDay

      if (!c.connected || c.state === 'not_connected') {
        return { platform: p, status: 'not_connected', contributed: false, detail: `${p} is not connected for this client.` }
      }
      if (failing) {
        return { platform: p, status: 'capture_failing', contributed: false, since: h!.first_failure_at || undefined,
          detail: `${p} capture has been FAILING since ${firstFailDay}${h!.health === 'degraded' ? ' (over a day — flagged degraded)' : ''}; this window's ${p} total is UNDERSTATED — recent days were not captured. Not $0, not disconnected.` }
      }
      if (c.state === 'trailing_gap') {
        return { platform: p, status: 'trailing_gap', contributed: false,
          detail: `${p} has no captured data for the most recent part of this window (capture stops before it ends), so the ${p} total is understated. Not $0.` }
      }
      if (c.state === 'predates_capture') {
        return { platform: p, status: 'predates_capture', contributed: false,
          detail: `this window is before our earliest captured ${p} data${c.captureFloor ? ' (' + c.captureFloor + ')' : ''} — ${p} genuinely has no rows to show for it; do not report $0.` }
      }
      if (c.state === 'draining_unknown') {
        return { platform: p, status: 'draining', contributed: false,
          detail: `${p} history is still importing for this window — the ${p} total may rise as backfill completes.` }
      }
      return { platform: p, status: 'ok', contributed: true, detail: `${p} capture is healthy and covers this window — the rows shown (including a genuine zero) are the true picture.` }
    })

    const incomplete = row.some((r) => INCOMPLETE_STATUSES.has(r.status))
    completePerWindow.push(!incomplete)
    perWindow.push(row)
    for (const r of row) {
      if (r.status === 'capture_failing') noteSet.add(`${r.platform} capture is CURRENTLY FAILING${r.since ? ' (since ' + String(r.since).slice(0, 10) + ')' : ''} — any total that includes ${r.platform} is INCOMPLETE. State it AS partial and NAME ${r.platform}; never present it as a whole number and never as $0 for ${r.platform} (its recent data simply has not been captured — not $0, not disconnected).`)
      if (r.status === 'trailing_gap') noteSet.add(`${r.platform} has no captured data for the most recent part of the window — the ${r.platform} total is understated; say so and do not present it as complete.`)
    }
  })

  return { perWindow, completePerWindow, overallComplete: completePerWindow.every(Boolean), notes: Array.from(noteSet) }
}
