// LORAMER_QUERY_COMPLETENESS_V1 (T0 #2) — the per-platform CONTRIBUTION flag + a top-level completeness verdict.
// SLICE 1 shipped this for query_metrics (Lora). SLICE 2 (this file's refactor) reuses the SAME logic for the
// -next metric routes: a PURE core (computeContribution) + a batch health reader, so portfolio-metrics can read
// platform_connections once for many clients instead of forking the logic.
//
// It answers, for every platform in scope for a window: did it CONTRIBUTE to this total, and if not, WHY — from
// signals that ALREADY exist (no new one invented):
//   · platform_connections.health='degraded' + consecutive_failures + first_failure_at (LORAMER_CONN_*_V1) →
//     capture is CURRENTLY failing → recent days missing → total UNDERSTATED.
//   · coverage.state + coverage.lastCaptured → trailing_gap / predates_capture / draining / not_connected, and
//     (SLICE 2 #4) the failing-window test keys on lastCaptured, so a window ending past the last captured day
//     while capture is failing is flagged even before the streak clock (the 07-19→07-23 sliver).
//   · else → 'ok' (healthy + covers the window): whatever rows exist are the TRUE picture, incl. a genuine zero.
// Shape mirrors money/route.ts:127 coverageComplete (a boolean verdict) + query_money's per-component reason.
import { supabaseAdmin } from '@/lib/supabase'
import type { CoverageResult } from './coverage'

export type ContributionStatus =
  | 'ok' | 'capture_failing' | 'stale_tail' | 'trailing_gap' | 'predates_capture' | 'draining' | 'not_connected'
export type PlatformContribution = { platform: string; status: ContributionStatus; contributed: boolean; detail: string; since?: string }
export type HealthRow = { health: string | null; consecutive_failures: number; first_failure_at: string | null }
export type CompletenessResult = {
  perWindow: PlatformContribution[][]
  completePerWindow: boolean[]
  overallComplete: boolean
  notes: string[]
}

const STORE_PLATFORMS: ReadonlySet<string> = new Set(['shopify', 'woocommerce'])
// A total is INCOMPLETE iff a platform is actively failing, has a stale tail, or a trailing gap — the understatement
// cases. predates_capture / not_connected / draining are honest absence (already in coverage.state) and do NOT alone
// make a total a wrong number.
const INCOMPLETE: ReadonlySet<ContributionStatus> = new Set<ContributionStatus>(['capture_failing', 'stale_tail', 'trailing_gap'])

// LORAMER_QUERY_COMPLETENESS_V1 slice 3 — the STALE-TAIL threshold. A platform whose last captured day is >= this many
// days behind the window's end is understated, INDEPENDENT of any failure streak (the slice-2 gate required a streak,
// so a stale tail on a healthy connection whose streak was not yet recorded rendered clean — the live defect). 1 day
// is normal fleet-wide capture lag and would false-alarm on every healthy client; >= 2 days catches a real stall.
const LAG_TOLERANCE_DAYS = 2
const daysBetween = (a: string, b: string): number => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000)

// PURE — no I/O. Given a pre-fetched health map + coverage, compute the contribution + verdicts. Exported so a
// multi-client caller (portfolio-metrics) batches the platform_connections read once and calls this per client.
export function computeContribution(
  health: Map<string, HealthRow>,
  windows: { startDate: string; endDate: string }[],
  coveragePerWindow: CoverageResult[][],
): CompletenessResult {
  const perWindow: PlatformContribution[][] = []
  const completePerWindow: boolean[] = []
  const noteSet = new Set<string>()

  windows.forEach((w, i) => {
    const row: PlatformContribution[] = (coveragePerWindow[i] || []).map((c) => {
      const p = c.platform
      const h = health.get(p)
      const firstFailDay = h?.first_failure_at ? String(h.first_failure_at).slice(0, 10) : null
      const streakActive = !!h && (h.consecutive_failures > 0 || h.health === 'degraded')
      // Failing for THIS window iff capture is currently failing AND the window extends past the last captured day
      // (recent days missing) OR overlaps the failure clock. lastCaptured closes the sliver first_failure_at missed.
      const failing = streakActive && (
        (c.lastCaptured != null && w.endDate > c.lastCaptured) ||
        (!!firstFailDay && w.endDate >= firstFailDay)
      )
      // stale_tail — window ends >= LAG_TOLERANCE_DAYS past the last captured day. INDEPENDENT of the streak: this is
      // the fact a stale-but-not-yet-flagged connection carries (Shelley's woo, lastCaptured 2+ days behind the window
      // end while her streak had not yet fired). Distinct from capture_failing (a KNOWN failing connection).
      const staleTail = c.lastCaptured != null && daysBetween(c.lastCaptured, w.endDate) >= LAG_TOLERANCE_DAYS

      if (!c.connected || c.state === 'not_connected') {
        return { platform: p, status: 'not_connected', contributed: false, detail: `${p} is not connected for this client.` }
      }
      if (failing) { // a KNOWN failure (streak) wins over a mere stale tail
        const stopped = c.lastCaptured || firstFailDay
        return { platform: p, status: 'capture_failing', contributed: false, since: h!.first_failure_at || undefined,
          detail: `${p} capture is CURRENTLY FAILING${stopped ? ` (last captured ${stopped})` : ''}${h!.health === 'degraded' ? ' — flagged degraded (over a day)' : ''}; this window's ${p} total is UNDERSTATED — recent days were not captured. Not $0, not disconnected.` }
      }
      if (staleTail) {
        return { platform: p, status: 'stale_tail', contributed: true,
          detail: `${p} is captured only through ${c.lastCaptured}; this window ends ${w.endDate}, so its last ${daysBetween(c.lastCaptured!, w.endDate)} day(s) are not yet captured — the ${p} total is UNDERSTATED (not $0). This is a stale tail (capture is behind), distinct from a failing connection.` }
      }
      if (c.state === 'trailing_gap') {
        return { platform: p, status: 'trailing_gap', contributed: false,
          detail: `${p} capture stops before this window ends${c.lastCaptured ? ` (last captured ${c.lastCaptured})` : ''}, so the ${p} total is understated. Not $0.` }
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

    completePerWindow.push(!row.some((r) => INCOMPLETE.has(r.status)))
    perWindow.push(row)
    for (const r of row) {
      if (r.status === 'capture_failing') noteSet.add(`${r.platform} capture is CURRENTLY FAILING${r.since ? ' (since ' + String(r.since).slice(0, 10) + ')' : ''} — any total that includes ${r.platform} is INCOMPLETE. State it AS partial and NAME ${r.platform}; never present it as a whole number and never as $0 for ${r.platform} (its recent data simply has not been captured — not $0, not disconnected).`)
      if (r.status === 'trailing_gap') noteSet.add(`${r.platform} has no captured data for the most recent part of the window — the ${r.platform} total is understated; say so and do not present it as complete.`)
      if (r.status === 'stale_tail') noteSet.add(`${r.platform} capture is BEHIND (its most recent days in this window are not yet captured) — the ${r.platform} total is understated. Say the ${r.platform} figure covers only through the last captured day; do NOT present it as complete and never as $0 for the missing tail.`)
    }
  })

  return { perWindow, completePerWindow, overallComplete: completePerWindow.every(Boolean), notes: Array.from(noteSet) }
}

// Read the real-time capture-health signal (LORAMER_CONN_FAILURE_STREAK_V1 / _DEGRADED_STATE_V1) for MANY clients
// in ONE query. Read-only. Returns clientId → (platform → HealthRow).
export async function readHealthForClients(clientIds: string[]): Promise<Map<string, Map<string, HealthRow>>> {
  const out = new Map<string, Map<string, HealthRow>>()
  if (!clientIds.length) return out
  const { data } = await supabaseAdmin
    .from('platform_connections')
    .select('client_id, platform, health, consecutive_failures, first_failure_at')
    .in('client_id', clientIds)
  for (const c of data || []) {
    const cid = (c as any).client_id as string
    if (!out.has(cid)) out.set(cid, new Map())
    out.get(cid)!.set((c as any).platform as string, {
      health: (c as any).health ?? null,
      consecutive_failures: Number((c as any).consecutive_failures || 0),
      first_failure_at: (c as any).first_failure_at ?? null,
    })
  }
  return out
}

// Single-client convenience (query_metrics + client-metrics): read health, then compute. Reads platform_connections.
export async function annotateContribution(
  clientId: string,
  windows: { startDate: string; endDate: string }[],
  coveragePerWindow: CoverageResult[][],
): Promise<CompletenessResult> {
  const byClient = await readHealthForClients([clientId])
  return computeContribution(byClient.get(clientId) || new Map(), windows, coveragePerWindow)
}

// BATCH (portfolio-metrics, many clients): one health query for all clients, then computeContribution per client
// over a LIGHT coverage input (each connected platform assumed 'covered') — computeContribution's health branch
// flags the FAILING platforms, which is the grid's concern. This reuses computeContribution (no forked scoring);
// it is lighter than the single-client route's full getCoverageForWindows (per-client-heavy) by design.
export async function annotateContributionBatch(
  clientIds: string[],
  window: { startDate: string; endDate: string },
): Promise<Map<string, CompletenessResult>> {
  const byClient = await readHealthForClients(clientIds)
  const out = new Map<string, CompletenessResult>()
  for (const cid of clientIds) {
    const health = byClient.get(cid) || new Map<string, HealthRow>()
    const cov: CoverageResult[][] = [Array.from(health.keys()).map((p) => ({
      platform: p, connected: true, isNA: false, captureFloor: null, floorConfirmed: false, coversWindow: true,
      state: 'covered' as CoverageResult['state'], lastCaptured: null,
    }))]
    out.set(cid, computeContribution(health, [window], cov))
  }
  return out
}

// LORAMER_QUERY_COMPLETENESS_V1 slice 2 #3 — settleRevenue precedence is store > ga > none, so when store rows are
// ABSENT the settle silently falls back to GA. If the store is absent because its capture is FAILING (not genuinely
// empty), that substitution must be LABELED, not silent. Returns the failing store platform, else null.
export function substitutedStorePlatform(revenueSource: string, contributionForWindow: PlatformContribution[]): string | null {
  if (revenueSource !== 'ga') return null
  const failingStore = contributionForWindow.find((c) => STORE_PLATFORMS.has(c.platform) && (c.status === 'capture_failing' || c.status === 'trailing_gap' || c.status === 'stale_tail'))
  return failingStore ? failingStore.platform : null
}

// THE ONE caption builder — every metric ROUTE computes the partial-total caption here (server-side) and returns
// it ready as `incompleteNote`, so every -next render (stat cards, ROAS card, store cards, MerView) just DISPLAYS
// d.incompleteNote — one pattern, no client import of this server-only module.
const PLABEL: Record<string, string> = { google: 'Google', meta: 'Meta', shopify: 'Shopify', woocommerce: 'WooCommerce', ga: 'GA' }
export function buildIncompleteNote(contribution: PlatformContribution[] | undefined, revenueSourceSubstituted?: string | null): string | undefined {
  // Failing (a KNOWN-broken connection) and stale (capture merely BEHIND) are DIFFERENT facts — wording them the
  // same ("capture is failing") states a false thing about a healthy-but-lagging connection (prompt-honesty). Split.
  const failing = (contribution || []).filter((c) => c.status === 'capture_failing' || c.status === 'trailing_gap')
  const stale = (contribution || []).filter((c) => c.status === 'stale_tail')
  if (!failing.length && !stale.length && !revenueSourceSubstituted) return undefined
  const nm = (arr: PlatformContribution[]) => Array.from(new Set(arr.map((c) => PLABEL[c.platform] || c.platform)))
  const parts: string[] = []
  if (failing.length) parts.push(`${nm(failing).join(', ')} capture is failing, so this total is understated (not $0)`)
  if (stale.length) parts.push(`${nm(stale).join(', ')} capture is behind — its most recent days aren't captured yet, so this total is understated (not $0)`)
  let note = parts.length ? `Partial — ${parts.join('; ')}` : undefined
  if (revenueSourceSubstituted) note = (note ? note + '. ' : '') + `Revenue shown is GA — the ${PLABEL[revenueSourceSubstituted] || revenueSourceSubstituted} store total is missing (its capture is failing, not $0, not disconnected)`
  return note
}
