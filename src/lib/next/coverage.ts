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

export type CoverageState = 'not_connected' | 'predates_capture' | 'covered' | 'draining_unknown' | 'trailing_gap'
export type CoverageResult = {
  platform: string
  connected: boolean
  isNA: boolean            // always false today — no DB flag exists (queued)
  captureFloor: string | null   // earliest captured date; "we have no captured data before this"
  floorConfirmed: boolean       // account-grain backfill_complete === true (only this licenses a confirmed-floor claim)
  coversWindow: boolean
  state: CoverageState
}

// account-grain step key per platform (required-steps.ts: shopify→shopify_deep, woo→woo, everything else→'account').
const ACCOUNT_STEP: Record<string, string> = { google: 'account', meta: 'account', ga: 'account', shopify: 'shopify_deep', woocommerce: 'woo' }
const BAD_HEALTH = new Set(['reconnect', 'disconnected'])

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
  const connectedSet = new Set(connections.filter((c) => c.account_id && !BAD_HEALTH.has(c.health)).map((c) => c.platform))
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
    if (!pp.connected) return { platform: p, connected: false, isNA: false, captureFloor: null, floorConfirmed: false, coversWindow: false, state: 'not_connected' as CoverageState }
    const r = resolveCoverageState(stepOf(p), pp.min, pp.max, w)
    return { platform: p, connected: true, isNA: false, ...r }
  }))
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
