// LORAMER_COMPLETENESS_GATE_V1 F(a) — RECONCILE ENGINE (pure, read-only, side-effect-free).
// Per client×platform×step it compares REQUIRED (drain step-set) vs ACHIEVED (onboard_steps_done + sync_state cursor)
// vs REAL (metrics_daily persisted rows) vs the known_floors floor-of-record, and emits a status + cause per cell.
//
// PURE by construction: it takes already-fetched datasets (floors, connections, cursors, real-presence pairs, nowIso)
// and returns the matrix. No DB handle, no clock, no I/O → trivially runnable in a Gate harness AND behind an API
// route later (both just fetch the four inputs and call this). Writes NOTHING to live capture.

import { REQUIRED_STEPS, realPresent, type RealPair } from './required-steps'

export type FloorRow = {
  platform: string
  client_id: string | null
  floor_kind: 'relative_months' | 'absolute_date' | 'dynamic_merchant_start' | 'unbounded' | 'unknown'
  floor_months: number | null
  floor_date: string | null // 'YYYY-MM-DD'
  set_by: 'system' | 'investigated'
  source_note: string
}

export type ConnRow = {
  client_id: string
  platform: string
  account_id: string | null
  onboard_steps_done: string[] | null
  health: string | null
}

export type CursorRow = {
  client_id: string
  platform: string // the sync_state cursor key
  backfill_complete: boolean | null
  backfill_earliest_date: string | null
  backfill_target_date: string | null
  backfill_blocked: boolean | null
  backfill_block_reason: string | null
  backfill_block_window: string | null
  updated_at: string | null
}

// (client_id, platform) -> the set of persisted (entity_level, breakdown_type) pairs in metrics_daily.
export type RealAgg = Record<string, Record<string, RealPair[]>>

// LORAMER_RECONCILE_ZERO_DELIVERY_V1 — GREEN_WITH_CAVEAT: reached floor but the ad account never DELIVERED in-window,
// so there are legitimately no breakdown rows to persist (false-zero discipline). It is a GREEN (not a defect, not
// draining); the caveat carries the honest "zero delivery" note. Distinct from RED_OUR_DEFECT (empty DESPITE delivery).
export type Status = 'GREEN' | 'GREEN_TO_RECORDED_FLOOR' | 'GREEN_WITH_CAVEAT' | 'DRAINING' | 'RED_OUR_DEFECT' | 'UNKNOWN_BLOCK'

export type StepResult = {
  step: string
  cursorKey: string
  done: boolean
  cursorEarliest: string | null
  cursorComplete: boolean | null
  blocked: boolean
  floor: string // human-readable floor of record
  realPresent: boolean | null
  status: Status
  cause: string
  caveat?: string
}

export type PlatformResult = { platform: string; account_id: string | null; steps: StepResult[] }
export type ClientResult = { client_id: string; platforms: PlatformResult[] }

const DAY_MS = 86400000
const STALE_DAYS = 7 // a not-done, unblocked, short-of-floor cursor that has not advanced in this long = stalled defect

function isoMinusMonths(nowIso: string, months: number): string {
  const d = new Date(nowIso)
  d.setUTCMonth(d.getUTCMonth() - months)
  return d.toISOString().slice(0, 10)
}
function daysSince(nowIso: string, iso: string | null): number {
  if (!iso) return Infinity
  return (new Date(nowIso).getTime() - new Date(iso).getTime()) / DAY_MS
}
function reached(earliest: string | null, floorDate: string | null): boolean {
  return !!earliest && !!floorDate && earliest <= floorDate
}

export function reconcile(input: {
  floors: FloorRow[]
  connections: ConnRow[]
  cursors: CursorRow[]
  realAgg: RealAgg
  nowIso: string
  clientIds: string[]
  // LORAMER_RECONCILE_ZERO_DELIVERY_V1 — per (client_id → platform) "did this ad account actually deliver in-window"
  // (any account-grain row with spend>0 OR impressions>0). Ad platforms only (google/meta). Undefined/absent ⇒ no
  // delivery signal available → the gate stays inert (strict RED preserved), so store/ga behaviour is unchanged.
  delivery?: Record<string, Record<string, boolean>>
}): ClientResult[] {
  const { floors, connections, cursors, realAgg, nowIso, clientIds } = input

  const platformFloor = new Map<string, FloorRow>()   // platform -> default floor
  const clientFloor = new Map<string, FloorRow>()     // `${client}|${platform}` -> override floor
  for (const f of floors) {
    if (f.client_id == null) platformFloor.set(f.platform, f)
    else clientFloor.set(`${f.client_id}|${f.platform}`, f)
  }
  const cursorByKey = new Map<string, CursorRow>()
  for (const c of cursors) cursorByKey.set(`${c.client_id}|${c.platform}`, c)

  const out: ClientResult[] = []
  for (const clientId of clientIds) {
    const conns = connections.filter((c) => c.client_id === clientId && c.account_id)
    const platforms = Array.from(new Set(conns.map((c) => c.platform)))
    const pResults: PlatformResult[] = []

    for (const platform of platforms) {
      const steps = REQUIRED_STEPS[platform]
      if (!steps) continue // platform with no registry steps (shouldn't happen for the 5 known)
      const conn = conns.find((c) => c.platform === platform)!
      const done = new Set<string>(Array.isArray(conn.onboard_steps_done) ? conn.onboard_steps_done : [])
      const pairs = realAgg[clientId]?.[platform] ?? []
      const pFloor = platformFloor.get(platform)
      const override = clientFloor.get(`${clientId}|${platform}`) || null

      // LORAMER_RECONCILE_ZERO_DELIVERY_V1 — the zero-delivery gate is per (client, platform), constant across steps.
      // Ad platforms only; a connected-but-never-delivered account has honest-empty breakdowns, not a capture defect.
      const isAdPlatform = platform === 'google' || platform === 'meta'
      const hasDelivery = input.delivery?.[clientId]?.[platform] === true

      const stepResults: StepResult[] = steps.map((sd) => {
        const cur = cursorByKey.get(`${clientId}|${sd.cursor}`) || null
        const isDone = done.has(sd.key)
        const rp = realPresent(sd.real, pairs)

        // Resolve the floor-of-record (absolute date, or null for dynamic/merchant-start).
        let floorDate: string | null = null
        let floorLabel = 'unknown'
        if (pFloor) {
          if (pFloor.floor_kind === 'relative_months') {
            const months = sd.floorMonths ?? pFloor.floor_months ?? 0
            floorDate = isoMinusMonths(nowIso, months)
            floorLabel = `${months}mo → ${floorDate}`
          } else if (pFloor.floor_kind === 'absolute_date') {
            floorDate = pFloor.floor_date
            floorLabel = `${floorDate} (absolute)`
          } else if (pFloor.floor_kind === 'dynamic_merchant_start') {
            floorDate = null
            floorLabel = 'merchant-start (dynamic)'
          }
        }
        const overrideDate = override?.floor_date ?? null
        if (overrideDate) floorLabel = `${overrideDate} (recorded: ${override!.set_by})`

        const base = {
          step: sd.key, cursorKey: sd.cursor, done: isDone,
          cursorEarliest: cur?.backfill_earliest_date ?? null,
          cursorComplete: cur?.backfill_complete ?? null,
          blocked: cur?.backfill_blocked === true,
          floor: floorLabel, realPresent: rp,
        }

        // ── Classification (first match wins) ─────────────────────────────────────────────
        // 1) No cursor row.
        if (!cur) {
          if (rp === true) return { ...base, status: 'GREEN' as Status, cause: 'rows persisted', caveat: 'no drain cursor (pre-drain capture path); depth-to-floor unverified' }
          if (isDone) return { ...base, status: 'RED_OUR_DEFECT' as Status, cause: 'marked done but no cursor and no rows (fetched-but-unpersisted / skip)' }
          return { ...base, status: 'RED_OUR_DEFECT' as Status, cause: 'step never ran (no cursor, no rows)' }
        }
        // 2) Blocked.
        if (base.blocked) {
          const wall = cur.backfill_block_window
          const recordedWall = !!overrideDate && ((wall != null && wall <= overrideDate) || reached(cur.backfill_earliest_date, overrideDate) || (cur.backfill_earliest_date != null && new Date(cur.backfill_earliest_date).getTime() - new Date(overrideDate).getTime() <= 2 * DAY_MS))
          if (recordedWall) return { ...base, status: 'GREEN_TO_RECORDED_FLOOR' as Status, cause: `blocked at recorded wall ${overrideDate}: ${(cur.backfill_block_reason || '').slice(0, 60)} — accepted` }
          return { ...base, status: 'UNKNOWN_BLOCK' as Status, cause: `blocked, no recorded floor: ${(cur.backfill_block_reason || 'unknown').slice(0, 80)} — investigate` }
        }
        // 3) Cursor complete.
        if (cur.backfill_complete === true) {
          if (rp === false) {
            // LORAMER_RECONCILE_ZERO_DELIVERY_V1 — complete-to-floor but empty. LOAD-BEARING split: if the ad account
            // never delivered in-window, empty breakdowns are honest (nothing existed to persist) → GREEN_WITH_CAVEAT.
            // If it DID deliver, an empty breakdown is a genuine fetched-but-unpersisted defect → keep RED.
            if (isAdPlatform && !hasDelivery) return { ...base, status: 'GREEN_WITH_CAVEAT' as Status, cause: 'reached floor; account has zero delivery in window — empty breakdown is honest, not a defect', caveat: 'zero-delivery ad account: no rows to persist' }
            return { ...base, status: 'RED_OUR_DEFECT' as Status, cause: 'cursor complete but ZERO persisted rows (false-complete / fetched-but-unpersisted)' }
          }
          return { ...base, status: 'GREEN' as Status, cause: 'reached floor, rows present' }
        }
        // 4) Incomplete, not blocked.
        if (overrideDate && reached(cur.backfill_earliest_date, overrideDate)) {
          return { ...base, status: 'GREEN_TO_RECORDED_FLOOR' as Status, cause: `reached recorded wall ${overrideDate} (${override!.set_by})` }
        }
        if (reached(cur.backfill_earliest_date, floorDate)) {
          return { ...base, status: 'GREEN' as Status, cause: `earliest ${cur.backfill_earliest_date} at/below floor ${floorDate}` }
        }
        if (sd.platformLimited && rp !== false) {
          return { ...base, status: 'GREEN' as Status, cause: 'platform-limited grain (e.g. search_term ~90d); rows present', caveat: 'platform retention limit — not a defect' }
        }
        // Short of floor, not blocked, no reason → distinguish skip vs stall vs draining.
        if (isDone) {
          return { ...base, status: 'RED_OUR_DEFECT' as Status, cause: `onboard-divergence: marked done but cursor incomplete at ${cur.backfill_earliest_date} — short of floor, not blocked (skip)` }
        }
        if (daysSince(nowIso, cur.updated_at) <= STALE_DAYS) {
          return { ...base, status: 'DRAINING' as Status, cause: `backfilling: earliest ${cur.backfill_earliest_date}, floor ${floorLabel}, last advanced ${cur.updated_at}` }
        }
        // LORAMER_RECONCILE_ZERO_DELIVERY_V1 — incomplete + idle + empty on a zero-delivery ad account is NOT a stall
        // defect: there is no data to fetch, so an idle empty grain is honest. Keep RED only when the account delivered.
        if (isAdPlatform && !hasDelivery && rp === false) return { ...base, status: 'GREEN_WITH_CAVEAT' as Status, cause: `zero delivery in window; incomplete+idle at ${cur.backfill_earliest_date} — honest empty, not a stall`, caveat: 'zero-delivery ad account: no rows to persist' }
        return { ...base, status: 'RED_OUR_DEFECT' as Status, cause: `stalled: incomplete at ${cur.backfill_earliest_date}, no advance since ${cur.updated_at}, not blocked, no reason` }
      })

      pResults.push({ platform, account_id: conn.account_id, steps: stepResults })
    }
    out.push({ client_id: clientId, platforms: pResults })
  }
  return out
}
