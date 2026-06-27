// LORAMER_RECONCILE_DAY_V1
// Shared per-day reconcile primitive — extracted (ZERO behavior change) from the 5 ad-grain backfill writers
// (google-campaign BLOCK, google-adgroup-ad FLAG, meta-campaign FLAG, meta-adset-ad FLAG, meta-placement FLAG).
// It owns ONLY the tolerance math (delta + within) + an advisory `action`. Each caller KEEPS its own
// flag-payload push, otherDeltas tracking, anchorMissing guard, and explicit control flow
// (continue / break / fall-through) — none of that is absorbed here (that is where a regression would hide).
//
// Default tolerance = $0.01 absolute OR 0.1% relative — byte-identical to the writers' RECON_ABS/RECON_PCT.
// pct = null DISABLES the relative branch (abs-only mode, e.g. the shopify-dimensional HALT check — NOT a
// caller of this primitive in v1, kept as-is). The two documented per-writer divergences are preserved IN THE
// CALLERS, never here: google-adgroup-ad ANDs `anchorMissing === 0` onto within; shopify uses abs-only/revenue/HALT.
export type ReconcilePosture = 'block' | 'flag' | 'halt'
export interface ReconcileResult { within: boolean; delta: number; action: 'write' | 'skip' | 'halt' }

export function reconcileDay(
  grainMetric: number,
  anchorMetric: number,
  opts?: { abs?: number; pct?: number | null; posture?: ReconcilePosture }
): ReconcileResult {
  const abs = opts?.abs ?? 0.01
  const pct = opts?.pct === undefined ? 0.001 : opts.pct
  const delta = Math.abs(grainMetric - anchorMetric)
  const within = delta <= abs || (pct != null && anchorMetric > 0 && delta / anchorMetric <= pct)
  const posture = opts?.posture ?? 'flag'
  const action: ReconcileResult['action'] = within ? 'write' : posture === 'block' ? 'skip' : posture === 'halt' ? 'halt' : 'write'
  return { within, delta, action }
}
