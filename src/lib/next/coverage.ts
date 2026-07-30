// LORAMER_LORA_COVERAGE_V1 (Fix #1 Part B — coverage) — THIN per-window coverage resolver.
// It hands Lora the STATE as a FACT so she stops guessing from ambiguous rowCount-0 zeros (which query_metrics
// returns identically for not-connected / pre-capture / true-zero).
//
// REUSE, NOT A 5TH COMPUTATION: it calls the SAME assembler the live client-profile page uses —
// get_client_readiness_signals RPC (floors/connections/cursors/realAgg/delivery) → reconcile() (the ONE floor/status
// engine). coverage.ts adds ONLY the window comparison + MIN/MAX(date) lookup. It never re-derives a floor or a status.
//
// LAW (LORAMER_CAPTURE_TRAILING_GAP_AUDIT_V1, SHA 3b218e5): Lora may say "we have no captured data before X" and
// "we have data and it is zero"; she may NEVER claim "the platform had no activity" outside a CONFIRMED capture floor.
// Only backfill_complete=TRUE on the account-grain cursor licenses a confirmed-floor claim. A trailing zero (past our
// last captured date) is NOT provable real from metrics_daily alone — that needs a live delivery check — so it is
// 'trailing_gap', never 'covered'.

import { supabaseAdmin } from '@/lib/supabase'
import { reconcile, type StepResult } from '@/lib/completeness/reconcile'
import { isConnectedForCoverage, type Health } from '@/lib/connection-health-view' // LORAMER_CONN_DEGRADED_STATE_V1

export type CoverageState = 'not_connected' | 'predates_capture' | 'covered' | 'draining_unknown' | 'trailing_gap'
export type CoverageResult = {
  platform: string
  connected: boolean
  isNA: boolean            // always false today — no DB flag exists (queued)
  captureFloor: string | null   // earliest captured date; "we have no captured data before this"
  floorConfirmed: boolean       // account-grain backfill_complete === true (only this licenses a confirmed-floor claim)
  coversWindow: boolean
  state: CoverageState
  lastCaptured: string | null   // LORAMER_QUERY_COMPLETENESS_V1 (slice 2) — most recent captured day for this platform (null=none). The failing-window test uses THIS, not only first_failure_at, so a window that ends past the last captured day while capture is failing is flagged even before the streak clock (07-19→07-23 sliver).
}

// account-grain step key per platform (required-steps.ts: shopify→shopify_deep, woo→woo, everything else→'account').
const ACCOUNT_STEP: Record<string, string> = { google: 'account', meta: 'account', ga: 'account', shopify: 'shopify_deep', woocommerce: 'woo' }
// LORAMER_CONN_DEGRADED_STATE_V1 — "connected for coverage" lives in connection-health-view now:
// isConnectedForCoverage(h) = !(reconnect||disconnected). 'degraded' is STILL connected (it IS connected, just
// failing) so it is not dropped from the coverage scope — its staleness is surfaced by readiness, not here.

// Pure window classifier — the ONLY new logic here. Everything upstream is reconcile's.
export function resolveCoverageState(
  step: StepResult | null,
  minDate: string | null,
  maxDate: string | null,
  win: { startDate: string; endDate: string },
): Pick<CoverageResult, 'captureFloor' | 'floorConfirmed' | 'coversWindow' | 'state'> {
  const floorConfirmed = step?.cursorComplete === true
  const captureFloor = minDate
  if (!minDate || !maxDate) {
    // connected but zero captured rows ever
    if (step?.status === 'DRAINING') return { captureFloor: null, floorConfirmed, coversWindow: false, state: 'draining_unknown' }
    return { captureFloor: null, floorConfirmed, coversWindow: floorConfirmed, state: floorConfirmed ? 'covered' : 'draining_unknown' }
  }
  if (win.startDate > maxDate) return { captureFloor, floorConfirmed, coversWindow: false, state: 'trailing_gap' }
  if (win.endDate < minDate) {
    if (floorConfirmed) return { captureFloor, floorConfirmed, coversWindow: false, state: 'predates_capture' }
    if (step?.status === 'DRAINING') return { captureFloor, floorConfirmed, coversWindow: false, state: 'draining_unknown' }
    return { captureFloor, floorConfirmed, coversWindow: false, state: 'predates_capture' } // inert cursor: MIN is our de-facto floor
  }
  return { captureFloor, floorConfirmed, coversWindow: true, state: 'covered' }
}

async function minMaxFor(clientId: string, platform: string): Promise<{ min: string | null; max: string | null }> {
  const where = (q: any) => q.eq('client_id', clientId).eq('platform', platform).eq('entity_level', 'account').eq('breakdown_type', '').eq('breakdown_value', '')
  const { data: mn } = await where(supabaseAdmin.from('metrics_daily').select('date')).order('date', { ascending: true }).limit(1).maybeSingle()
  const { data: mx } = await where(supabaseAdmin.from('metrics_daily').select('date')).order('date', { ascending: false }).limit(1).maybeSingle()
  return { min: (mn?.date as string) ?? null, max: (mx?.date as string) ?? null }
}

// LORAMER_LIVE_VS_CAPTURED_SOURCE_PARITY_V1 — the REAL "settled through" date per platform, for the source-parity
// block in Lora's prompt. Deliberately reuses minMaxFor rather than re-rolling the predicate: the account-grain
// triple (entity_level='account' AND breakdown_type='' AND breakdown_value='') is LOAD-BEARING, not redundant —
// it is what makes migration 035's PARTIAL index usable. Without all three the query degrades to a scan of the
// client's millions of rows, blows the 8s PostgREST statement_timeout, and returns null while looking correct
// (LORAMER_8S_CEILING_AUDIT_V1 / LORAMER_LATEST_DATE_ACCOUNT_GRAIN_V1 — six sites, three of them PARTIAL filters
// that looked right). Do not "simplify" these filters away. Per-platform reads are indexed (~0.15ms measured) and
// run in parallel; a failed read yields null, which the renderer states honestly rather than implying zero.
export async function capturedThroughByPlatform(
  clientId: string,
  platforms: string[],
): Promise<Record<string, string | null>> {
  const entries = await Promise.all(
    platforms.map(async (p) => {
      try {
        const { max } = await minMaxFor(clientId, p)
        return [p, max] as const
      } catch {
        return [p, null] as const
      }
    }),
  )
  return Object.fromEntries(entries)
}

// getCoverageForWindows — per requested window, an array of per-platform coverage. requestedPlatforms=[] means 'all'
// → every connected platform. A specific requested platform is ALWAYS resolved (not_connected if it isn't connected).
export async function getCoverageForWindows(
  clientId: string,
  requestedPlatforms: string[],
  windows: Array<{ startDate: string; endDate: string }>,
): Promise<CoverageResult[][]> {
  // LIGHT input assembly (NOT the heavy get_client_readiness_signals RPC — it does a full realAgg dimensional scan and
  // TIMES OUT for dimensional-heavy clients on this hot path). Small tables + indexed MIN/MAX only. reconcile() (the
  // ONE floor/status computation) is still what classifies the account step — only its INPUTS are fetched cheaply here.
  const [{ data: floors }, { data: connsRaw }, { data: cursorsRaw }] = await Promise.all([
    supabaseAdmin.from('known_floors').select('platform,client_id,floor_kind,floor_months,floor_date,set_by,source_note'),
    supabaseAdmin.from('platform_connections').select('client_id,platform,account_id,onboard_steps_done,health').eq('client_id', clientId),
    supabaseAdmin.from('sync_state').select('client_id,platform,backfill_complete,backfill_earliest_date,backfill_target_date,backfill_blocked,backfill_block_reason,backfill_block_window,updated_at').eq('client_id', clientId),
  ])
  const connections: any[] = connsRaw || []
  const connectedSet = new Set(connections.filter((c) => c.account_id && isConnectedForCoverage(c.health as Health)).map((c) => c.platform))
  const scope = requestedPlatforms.length ? requestedPlatforms : Array.from(connectedSet)

  // MIN/MAX per scope platform (indexed) — also derives the account-presence realAgg reconcile needs (min!=null ⇒ account rows).
  const perPlatform: Record<string, { connected: boolean; min: string | null; max: string | null }> = {}
  const realByPlatform: Record<string, { entity_level: string; breakdown_type: string }[]> = {}
  for (const p of scope) {
    const connected = connectedSet.has(p)
    let min: string | null = null, max: string | null = null
    if (connected) { const mm = await minMaxFor(clientId, p); min = mm.min; max = mm.max }
    perPlatform[p] = { connected, min, max }
    if (min) realByPlatform[p] = [{ entity_level: 'account', breakdown_type: '' }]
  }

  // reconcile() — the reused logic. Cheap realAgg (account presence only); delivery empty (not needed for coverage).
  const [clientResult] = reconcile({
    floors: (floors as any) || [], connections, cursors: (cursorsRaw as any) || [],
    realAgg: { [clientId]: realByPlatform }, nowIso: new Date().toISOString(), clientIds: [clientId], delivery: { [clientId]: {} },
  })
  const stepOf = (p: string): StepResult | null => {
    const pr = (clientResult?.platforms || []).find((x) => x.platform === p) || null
    return pr ? pr.steps.find((s) => s.step === (ACCOUNT_STEP[p] || 'account')) || null : null
  }

  return windows.map((w) => scope.map((p) => {
    const pp = perPlatform[p]
    if (!pp.connected) return { platform: p, connected: false, isNA: false, captureFloor: null, floorConfirmed: false, coversWindow: false, state: 'not_connected' as CoverageState, lastCaptured: null }
    const r = resolveCoverageState(stepOf(p), pp.min, pp.max, w)
    return { platform: p, connected: true, isNA: false, ...r, lastCaptured: pp.max } // LORAMER_QUERY_COMPLETENESS_V1 slice 2
  }))
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════
// LORAMER_COVERAGE_BREAKDOWN_GRAIN_V1 — BREAKDOWN-GRAIN COMPLETENESS, ALONGSIDE base grain, never instead of it.
//
// ⛔ THE DEFECT, AND IT IS WIDER THAN "BREAKDOWN ROWS ARE NOT INSPECTED".
// `minMaxFor` above reads the account BASE triple only (entity_level='account', breakdown_type='',
// breakdown_value=''), and `resolveCoverageState` then compares the window against TWO ENDPOINTS. That is a RANGE
// test, not a coverage test: any window falling between min and max returns 'covered' regardless of what is or is
// not inside it. So the blindness is TWO defects stacked —
//   (1) breakdown rows are never looked at, at all; and
//   (2) even at base grain, an INTERIOR missing day inside [min,max] reads 'covered'.
// MEASURED 2026-07-30, Foam OH GA: base grain min 2022-02-02, max 2026-07-29 — so a question about
// 2023-07-01..2025-12-31 returned state 'covered', while that window held ZERO dimensional rows across all 12
// families. 915 days, ~30 months, reported as covered. 1,223 days were recovered fleet-wide that day and NOT ONE
// of them would have moved `coversWindow`, because every one was a breakdown row.
//
// THE METHOD IS A LEFT JOIN AGAINST BASE ACTIVITY, NOT ARITHMETIC ON ENDPOINTS. That distinction is not academic:
// on 2026-07-30 a min/max reading of Influential Drones said its dimensional coverage ran 2024-02-01→2026-07-29,
// and the LEFT JOIN found two interior days (2026-07-14, 2026-07-16) sitting inside it. Endpoints cannot see a
// hole; only a per-day set difference can.
//
// BASE GRAIN IS THE DENOMINATOR AND STAYS EXACTLY AS IT IS. "Did this platform report at all on this day" is the
// right question for base rows, and the account triple is LOAD-BEARING for the migration-035 partial index (see
// the note on capturedThroughByPlatform). Nothing above this line changes; nothing below it is called by any
// existing caller.

export type BreakdownCoverageVerdict = 'COMPLETE' | 'PARTIAL' | 'UNKNOWN'

export type BreakdownCoverage = {
  platform: string
  verdict: BreakdownCoverageVerdict
  baseActiveDays: number            // days in-window where the platform DID report (sessions/spend > 0)
  breakdownDays: number             // distinct in-window days carrying at least one breakdown row
  holeDays: string[]                // base-active days with ZERO breakdown rows — the actual finding
  families: Record<string, { first: string; last: string; days: number }>
  detail: string
}

// THE THREE STATES, and they are the quota vocabulary deliberately (google-quota-store.ts:34
// `'blocked' | 'not_blocked' | 'unknown'`) rather than a fourth dialect invented here:
//   COMPLETE — base reported on N days in-window and every one of those N carries breakdown rows.
//   PARTIAL  — base reported, breakdown did not, on at least one day. holeDays NAMES them.
//   UNKNOWN  — we could not measure. No base activity to compare against (no denominator), or the read failed.
// ⛔ UNKNOWN NEVER DEGRADES TO COMPLETE. That is the whole point of the quota pattern being reused: an unreadable
// instrument must not be able to speak as a clean bill of health. A window with base activity and zero breakdown
// rows is PARTIAL with every day listed — never COMPLETE, and never silently UNKNOWN either.
export function resolveBreakdownCoverage(
  platform: string,
  baseActiveDays: string[] | null,
  breakdownDays: string[] | null,
  families: Record<string, { first: string; last: string; days: number }> = {},
): BreakdownCoverage {
  if (baseActiveDays == null || breakdownDays == null) {
    return { platform, verdict: 'UNKNOWN', baseActiveDays: 0, breakdownDays: 0, holeDays: [], families,
      detail: 'could not read base or breakdown days for this window — NOT a completeness claim' }
  }
  if (baseActiveDays.length === 0) {
    return { platform, verdict: 'UNKNOWN', baseActiveDays: 0, breakdownDays: breakdownDays.length, holeDays: [], families,
      detail: 'no base-grain activity in this window, so there is no denominator to judge breakdown coverage against' }
  }
  const have = new Set(breakdownDays)
  const holeDays = baseActiveDays.filter((d) => !have.has(d)).sort()
  if (holeDays.length === 0) {
    return { platform, verdict: 'COMPLETE', baseActiveDays: baseActiveDays.length, breakdownDays: breakdownDays.length,
      holeDays: [], families, detail: `all ${baseActiveDays.length} base-active day(s) carry breakdown rows` }
  }
  return { platform, verdict: 'PARTIAL', baseActiveDays: baseActiveDays.length, breakdownDays: breakdownDays.length,
    holeDays, families,
    detail: `${holeDays.length} of ${baseActiveDays.length} base-active day(s) carry NO breakdown rows: ${holeDays.slice(0, 12).join(', ')}${holeDays.length > 12 ? ` … +${holeDays.length - 12} more` : ''}` }
}

// Data access for the above. Distinct-day extraction MUST happen in Postgres: a client like Foam OH holds ~2.3M
// GA breakdown rows in a single window, and pulling dates client-side to de-dup them would blow the 8s PostgREST
// statement_timeout on exactly the biggest clients — the LORAMER_8S_CEILING_AUDIT_V1 failure mode, which returns
// null while looking correct. So this calls an RPC, and when the RPC is absent or errors it returns UNKNOWN.
// ⚠ THE RPC IS NOT APPLIED YET (migrations/046_breakdown_coverage_rpc.sql, authored not run — same posture as 045).
// Until it is, every call here answers UNKNOWN, which is the safe direction and is why the fallback is UNKNOWN
// rather than an optimistic COMPLETE.
export async function getBreakdownCoverage(
  clientId: string,
  platform: string,
  win: { startDate: string; endDate: string },
): Promise<BreakdownCoverage> {
  try {
    const { data, error } = await supabaseAdmin.rpc('breakdown_coverage_days', {
      p_client_id: clientId, p_platform: platform, p_start: win.startDate, p_end: win.endDate,
    })
    if (error || !data) return resolveBreakdownCoverage(platform, null, null)
    const row: any = Array.isArray(data) ? data[0] : data
    if (!row) return resolveBreakdownCoverage(platform, null, null)
    const fams: Record<string, { first: string; last: string; days: number }> = {}
    for (const f of row.families || []) fams[f.breakdown_type] = { first: f.first_date, last: f.last_date, days: f.days }
    return resolveBreakdownCoverage(platform, row.base_active_days || [], row.breakdown_days || [], fams)
  } catch {
    return resolveBreakdownCoverage(platform, null, null)
  }
}

// Human-directive notes for the tool result — one per distinct (platform,state) that is NOT 'covered'.
export function coverageNotes(cov: CoverageResult[][]): string[] {
  const seen = new Set<string>()
  const notes: string[] = []
  for (const win of cov) for (const c of win) {
    if (c.state === 'covered') continue
    const key = `${c.platform}|${c.state}`
    if (seen.has(key)) continue
    seen.add(key)
    if (c.state === 'not_connected') notes.push(`COVERAGE: ${c.platform} is NOT connected for this client — say ${c.platform} isn't connected; NEVER report zeros and do NOT call it "no data".`)
    else if (c.state === 'predates_capture') notes.push(`COVERAGE: ${c.platform} — the asked window is before our earliest captured data${c.captureFloor ? ` (${c.captureFloor})` : ''}. Say we have NO captured ${c.platform} data before ${c.captureFloor || 'our records begin'}; NEVER report $0 as a measured figure; do NOT claim the account had no activity.`)
    else if (c.state === 'draining_unknown') notes.push(`COVERAGE: ${c.platform} — history is still importing (backfill incomplete); you CANNOT confirm a zero for that period yet — say so, do not report $0 as real.`)
    else if (c.state === 'trailing_gap') notes.push(`COVERAGE: ${c.platform} — the asked window extends PAST our latest captured ${c.platform} data. Say the period is beyond our latest capture; a zero there is UNCONFIRMED (needs a live check), not a proven real zero.`)
  }
  return notes
}
