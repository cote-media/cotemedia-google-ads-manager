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

// LORAMER_COVERAGE_UNKNOWN_REASON_V1 — ⛔ A DISCRIMINATOR, NOT A FOURTH STATE.
//
// THE VERDICT ANSWERS ONE QUESTION — "can I make a completeness claim about this window?" — and UNKNOWN is the
// honest no. THIS answers the different question the reader needs next: WHY not. Keeping them separate is why
// no fourth verdict is added: the three states are the quota vocabulary borrowed verbatim
// (google-quota-store.ts:34), every future reader must handle exactly three, and a fourth would make an
// unmeasurable window look like a distinct kind of ANSWER rather than a distinct kind of SILENCE.
//
// MEASURED 2026-07-30, and it is why this exists: `getBreakdownCoverage` returned UNKNOWN for Thought Streams
// meta (genuinely dormant — correct and useful) and for Foam OH meta (the RPC TIMED OUT at 8,215ms against the
// 8s PostgREST ceiling — "we could not measure"), with the SAME detail string. A reader cannot act on those
// identically: one is a fact about the account, the other is a broken instrument, and paging on the pair would
// alarm hardest exactly where the data is heaviest.
//   'not_connected'         — no platform_connections row. There is no window to have activity in.
//   'never_captured'        — connected, but this (client, platform) has never captured a single row, ever.
//   'no_activity_in_window' — connected AND has captured before, but reported nothing inside THIS window.
//                             The only one of the four that is a fact about the ACCOUNT rather than about us.
//   'read_failed'           — we could not measure: the RPC errored, threw, returned no row, or the connection
//                             denominator was not supplied so the emptiness cannot be attributed.
export type BreakdownUnknownReason =
  | 'not_connected' | 'never_captured' | 'no_activity_in_window' | 'read_failed'

export type BreakdownCoverage = {
  platform: string
  verdict: BreakdownCoverageVerdict
  // ⛔ PRESENT IF AND ONLY IF verdict === 'UNKNOWN'. A silent UNKNOWN is the defect this closes.
  unknownReason?: BreakdownUnknownReason
  baseActiveDays: number            // days in-window where the platform DID report (sessions/spend > 0)
  breakdownDays: number             // distinct in-window days carrying at least one breakdown row
  holeDays: string[]                // base-active days with ZERO breakdown rows — the actual finding
  families: Record<string, { first: string; last: string; days: number }>
  detail: string
}

// The connection denominator. ⛔ IT DOES NOT COME FROM metrics_daily — a client that never captured has no rows
// to be absent from, so the store cannot tell "never captured" from "captured nothing here". The declaring
// table is clients(deleted_at IS NULL) JOIN platform_connections, which is what cron/sync itself uses to decide
// who to capture. resolveBreakdownCoverage stays PURE, so the CALLER measures this and passes it in; the pure
// function only classifies. `null` means NOT MEASURED and is never silently treated as false.
export type ConnectionFacts = {
  connected?: boolean | null
  everCaptured?: boolean | null
  readError?: string | null
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
  conn: ConnectionFacts = {},
): BreakdownCoverage {
  const unknown = (unknownReason: BreakdownUnknownReason, detail: string, bd = 0): BreakdownCoverage =>
    ({ platform, verdict: 'UNKNOWN', unknownReason, baseActiveDays: 0, breakdownDays: bd, holeDays: [], families, detail })

  // ── read_failed FIRST, and it carries the REASON TEXT rather than discarding it. The old code checked
  // `error` and threw the message away, so a timeout and an idle account produced the identical string.
  if (conn.readError) {
    return unknown('read_failed', `could not measure breakdown coverage — the read failed: ${conn.readError}. NOT a completeness claim, and NOT a statement about the account.`)
  }
  if (baseActiveDays == null || breakdownDays == null) {
    return unknown('read_failed', 'could not read base or breakdown days for this window — NOT a completeness claim')
  }
  if (baseActiveDays.length === 0) {
    // ⛔ THE THREE-WAY SPLIT. All three of these used to return the SAME sentence — "no base-grain activity in
    // this window" — which is FALSE for the first two: a connection that never captured anything has no
    // activity in ANY window, and one that is not connected has no window to have activity in.
    if (conn.connected === false) {
      return unknown('not_connected', `${platform} is not connected for this client — there is no window for it to have activity in. This is not a gap in capture.`)
    }
    if (conn.connected === true && conn.everCaptured === false) {
      return unknown('never_captured', `${platform} is connected but has NEVER captured a row for this client, in any window — so this window's emptiness says nothing about the window. Capture has not started.`)
    }
    if (conn.connected === true && conn.everCaptured === true) {
      return unknown('no_activity_in_window', `${platform} is connected and has captured before, but reported no base-grain activity inside this window — there is no denominator to judge breakdown coverage against. This is a fact about the account, not about our capture.`, breakdownDays.length)
    }
    // ⛔ THE DENOMINATOR WAS NOT SUPPLIED, so the emptiness CANNOT BE ATTRIBUTED. Reporting
    // 'no_activity_in_window' here is exactly the defect being closed — it asserts the connection exists and
    // has captured before, neither of which was measured. Classified as read_failed because "we could not
    // measure" is what actually happened, and the detail says which input was missing.
    return unknown('read_failed', `no base-grain activity in this window AND the connection denominator was not supplied (connected=${String(conn.connected)}, everCaptured=${String(conn.everCaptured)}), so this emptiness cannot be attributed to the account or to us.`, breakdownDays.length)
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
// ✅ MIGRATIONS 046 AND 047 ARE APPLIED TO PRODUCTION (verified 2026-07-30 — 046 the read-only RPC, 047 the
// loose-index-scan that took Foam OH GA from 8,698ms to ~2,000ms). This comment previously said the RPC was
// "NOT APPLIED YET, authored not run", which was true when written and wrong for a day — a doc misstating the
// system it documents, in the file the next reader trusts. Corrected in place rather than left to rot.
// ⚠ WHAT REMAINS TRUE: a failure here still answers UNKNOWN rather than an optimistic COMPLETE, and Foam OH
// meta still exceeds the 8s ceiling on this RPC (★BREAKDOWN-COVERAGE-UNKNOWN-CONFLATES-TIMEOUT is why the
// reason is now carried — that timeout must not read as an idle account).
export async function getBreakdownCoverage(
  clientId: string,
  platform: string,
  win: { startDate: string; endDate: string },
): Promise<BreakdownCoverage> {
  try {
    const { data, error } = await supabaseAdmin.rpc('breakdown_coverage_days', {
      p_client_id: clientId, p_platform: platform, p_start: win.startDate, p_end: win.endDate,
    })
    // ⛔ THE ERROR TEXT IS PRESERVED, NOT DISCARDED. `if (error || !data)` used to collapse a statement timeout,
    // an absent RPC and an empty result into one silent UNKNOWN — which is how a 8,215ms timeout on the largest
    // client read identically to a dormant one.
    if (error) return resolveBreakdownCoverage(platform, null, null, {}, { readError: error.message })
    if (!data) return resolveBreakdownCoverage(platform, null, null, {}, { readError: 'RPC breakdown_coverage_days returned no data' })
    const row: any = Array.isArray(data) ? data[0] : data
    if (!row) return resolveBreakdownCoverage(platform, null, null, {}, { readError: 'RPC breakdown_coverage_days returned an empty result set' })
    const fams: Record<string, { first: string; last: string; days: number }> = {}
    for (const f of row.families || []) fams[f.breakdown_type] = { first: f.first_date, last: f.last_date, days: f.days }
    const baseDays: string[] = row.base_active_days || []
    // The connection denominator is measured ONLY when it can change the answer — i.e. when there is no base
    // activity to judge against. On the COMPLETE/PARTIAL paths it is irrelevant, so this costs nothing there.
    const conn = baseDays.length === 0 ? await readConnectionFacts(clientId, platform) : {}
    return resolveBreakdownCoverage(platform, baseDays, row.breakdown_days || [], fams, conn)
  } catch (e: any) {
    return resolveBreakdownCoverage(platform, null, null, {}, { readError: `RPC breakdown_coverage_days threw: ${e?.message ?? e}` })
  }
}

// THE DECLARING TABLE, not metrics_daily. `clients(deleted_at IS NULL) JOIN platform_connections` is what
// cron/sync uses to decide who to capture, so it is the same denominator capture itself works from. A read
// failure here returns nulls — NOT MEASURED — and resolveBreakdownCoverage then answers read_failed rather
// than inventing an attribution.
async function readConnectionFacts(clientId: string, platform: string): Promise<ConnectionFacts> {
  try {
    const { data: client, error: cErr } = await supabaseAdmin
      .from('clients').select('id').eq('id', clientId).is('deleted_at', null).maybeSingle()
    if (cErr) return { readError: `connection denominator unreadable: ${cErr.message}` }
    if (!client) return { connected: false, everCaptured: false }
    const { data: conn, error: pErr } = await supabaseAdmin
      .from('platform_connections').select('client_id').eq('client_id', clientId).eq('platform', platform).maybeSingle()
    if (pErr) return { readError: `connection denominator unreadable: ${pErr.message}` }
    if (!conn) return { connected: false, everCaptured: false }
    // "Ever captured" is a PRESENCE question, so it is a limit-1 existence probe on the account triple — the
    // same predicate migration 035's partial index serves, never a count over millions of rows.
    const { data: anyRow, error: mErr } = await supabaseAdmin
      .from('metrics_daily').select('date')
      .eq('client_id', clientId).eq('platform', platform)
      .eq('entity_level', 'account').eq('breakdown_type', '').eq('breakdown_value', '')
      .limit(1).maybeSingle()
    if (mErr) return { connected: true, readError: `capture-history probe unreadable: ${mErr.message}` }
    return { connected: true, everCaptured: !!anyRow }
  } catch (e: any) {
    return { readError: `connection denominator threw: ${e?.message ?? e}` }
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
