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

// LORAMER_GOOGLE_CAMPAIGN_ANCHOR_MISSING_V1 — the ACCOUNT-ANCHORED variant of the caller-kept anchorMissing
// rule, collapsed to ONE source per FIX-WITH-GUARD (we fix files, we do not enforce conventions).
//
// ⛔ THE DEFECT THIS ENDS, measured live 2026-08-26: google-campaign-backfill — the only posture:'block'
// caller in the fleet — read its single account-row anchor as `fin(acctRow?.spend)`, which maps BOTH
// "no row" and "$0.00" to 0. On exactly the days the anchor was MISSING (9 of 18 google connections on
// 2026-08-25), the block gate compared 0-vs-0, reported within, and wrote campaign rows against an anchor
// that did not exist. Every campaign-anchored caller (adgroup-ad :187, device :95, demographic :121,
// hour :95) already ANDs `anchorMissing === 0` into within; the account-anchored caller was the one without
// the rule. For a single anchor row the count is 0 or 1 — absent row ≠ $0.00 row, and only the caller's
// fetch (maybeSingle → null) can tell them apart, which is why this takes the ROW, not a number.
// Tolerance and posture semantics are reconcileDay's own, unchanged — this wraps, it does not re-derive.
export function reconcileDayAgainstAnchorRow(
  grainMetric: number,
  anchorRow: { spend?: unknown } | null | undefined,
  opts?: { abs?: number; pct?: number | null; posture?: ReconcilePosture }
): ReconcileResult & { anchorMissing: number; anchorMetric: number } {
  const anchorMissing = anchorRow == null ? 1 : 0
  const n = Number(anchorRow?.spend)
  const anchorMetric = Number.isFinite(n) ? n : 0
  const base = reconcileDay(grainMetric, anchorMetric, opts)
  const within = anchorMissing === 0 && base.within
  const posture = opts?.posture ?? 'flag'
  const action: ReconcileResult['action'] = within ? 'write' : posture === 'block' ? 'skip' : posture === 'halt' ? 'halt' : 'write'
  return { within, delta: base.delta, action, anchorMissing, anchorMetric }
}
