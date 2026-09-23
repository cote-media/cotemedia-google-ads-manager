// LORAMER_WALK_QUOTA_SCOPE_V1 — THE WALK'S SCOPE-KEYED HOLD: ONE LANE OR THE FLEET, DECIDED BY WHAT GOOGLE SAID.
//
// ⛔ TWO RECORDS, ONE DECIDER. A DEVELOPER-scoped (or scope-less) refusal arms the SAME fleet sentinel row the
// live paths already read — `writeGoogleQuotaPause`, the unchanged export of google-quota-store.ts — so nothing
// about the fleet's behaviour moves. An ACCOUNT-scoped refusal writes `universe_lane_hold` (migration 097), keyed
// (client_id, vendor) exactly like the fire lease and the run, and ONLY the walk's own hold paths read it. The
// live and legacy importers never see a lane hold, which is what route R2 promised.
//
// ⛔ THE STORE IS DEPENDENCY-INJECTED so walk-quota-scope.guard.mjs can prove "ACCOUNT touches the lane record and
// not the fleet row" without a database. Production wires the two real writers below.
import { supabaseAdmin } from '@/lib/supabase'
import { writeGoogleQuotaPause } from './google-quota-store'
import { classifyWalkQuotaError, decideWalkHold, describeWalkQuota, WALK_QUOTA_BACKOFF_STREAK_WINDOW_MS, type WalkQuotaKind } from './walk-quota'

export interface WalkLane { clientId: string; vendor: string }

export interface LaneHoldRow {
  client_id: string
  vendor: string
  held_until: string
  rate_scope: string
  rate_name: string | null
  retry_delay_s: number | null
  backoff_tries: number
  reason: string
  armed_at: string
}

export interface WalkHoldDeps {
  writeFleet: (resetIso: string, detail: string) => Promise<void>
  upsertLane: (row: LaneHoldRow) => Promise<void>
  readLane: (lane: WalkLane) => Promise<LaneHoldRow | null>
  /** LORAMER_DESCEND_WINDOW_360_V1 — OTHER lanes' UNNAMED-scope holds armed at or after `sinceIso` (the second-account rule). */
  readRecentUnnamedHolds: (sinceIso: string, except: WalkLane) => Promise<LaneHoldRow[]>
}

const realDeps: WalkHoldDeps = {
  writeFleet: (resetIso, detail) => writeGoogleQuotaPause(resetIso, detail),
  upsertLane: async (row) => {
    const { error } = await supabaseAdmin.from('universe_lane_hold').upsert(row, { onConflict: 'client_id,vendor' })
    if (error) throw new Error(error.message)
  },
  readLane: async (lane) => {
    const { data, error } = await supabaseAdmin.from('universe_lane_hold').select('*')
      .eq('client_id', lane.clientId).eq('vendor', lane.vendor).maybeSingle()
    if (error) throw new Error(error.message)
    return (data as LaneHoldRow | null) ?? null
  },
  readRecentUnnamedHolds: async (sinceIso, except) => {
    const { data, error } = await supabaseAdmin.from('universe_lane_hold').select('*')
      .eq('vendor', except.vendor).eq('rate_scope', 'UNKNOWN').gte('armed_at', sinceIso).neq('client_id', except.clientId)
    if (error) throw new Error(error.message)
    return (data as LaneHoldRow[] | null) ?? []
  },
}

/**
 * Apply one classified failure. Returns what was done, for the caller's log. Best-effort at the boundary
 * (armWalkQuota wraps it); throws only through the injected writers.
 */
export async function applyWalkHold(
  a: { kind: WalkQuotaKind; lane: WalkLane | null; site: string; nowMs?: number },
  deps: WalkHoldDeps = realDeps,
): Promise<{ applied: 'none' | 'fleet' | 'lane' | 'lane+fleet'; untilIso: string | null; reason: string }> {
  const nowMs = a.nowMs ?? Date.now()
  // The fallback streak is read from the lane record: tries inside the window continue the schedule.
  let priorBackoffTries = 0
  if (a.lane && a.kind.quota && a.kind.retryDelayS === null) {
    const prior = await deps.readLane(a.lane).catch(() => null)
    if (prior && nowMs - Date.parse(prior.armed_at) <= WALK_QUOTA_BACKOFF_STREAK_WINDOW_MS) priorBackoffTries = prior.backoff_tries ?? 0
  }
  const d = decideWalkHold({ kind: a.kind, nowMs, priorBackoffTries })
  if (d.kind === 'none') return { applied: 'none', untilIso: null, reason: d.reason }
  const untilIso = new Date(d.untilMs).toISOString()
  const detail = `${d.reason} [armed at ${a.site}] ${describeWalkQuota(a.kind)}`
  // ⛔ A LANE HOLD WITH NO LANE CONTEXT FALLS BACK TO THE FLEET — today's behaviour, never a dropped hold.
  if (d.kind === 'lane' && a.lane) {
    await deps.upsertLane({
      client_id: a.lane.clientId, vendor: a.lane.vendor, held_until: untilIso,
      rate_scope: a.kind.rateScope, rate_name: a.kind.rateName, retry_delay_s: a.kind.retryDelayS,
      backoff_tries: d.backoffTries, reason: detail.slice(0, 900), armed_at: new Date(nowMs).toISOString(),
    })
    // LORAMER_DESCEND_WINDOW_360_V1 — THE SECOND-ACCOUNT RULE. An unnamed refusal with a delay holds its lane; if ANOTHER
    // account's lane was armed by an unnamed refusal inside the same delay window, the bucket was the project's, not
    // the customer's — arm the fleet for the delay too. Bounded: one refused request per active lane before the fleet holds.
    if (a.kind.rateScope === 'UNKNOWN' && a.kind.retryDelayS !== null) {
      const sinceIso = new Date(nowMs - a.kind.retryDelayS * 1000).toISOString()
      const others = await deps.readRecentUnnamedHolds(sinceIso, a.lane).catch(() => [] as LaneHoldRow[])
      if (others.length > 0) {
        const who = others.map((o) => o.client_id).slice(0, 5).join(', ')
        await deps.writeFleet(untilIso, `${detail.slice(0, 380)} · SECOND ACCOUNT refused inside the ${a.kind.retryDelayS} s delay (${who}) — the bucket is the project's; fleet held`)
        return { applied: 'lane+fleet', untilIso, reason: `${d.reason} · a second account (${who}) was refused inside the delay — fleet held too` }
      }
    }
    return { applied: 'lane', untilIso, reason: d.reason }
  }
  await deps.writeFleet(untilIso, detail.slice(0, 480))
  return { applied: 'fleet', untilIso, reason: d.reason + (d.kind === 'lane' ? ' — no lane context at this boundary, so the fleet row was armed instead' : '') }
}

/**
 * THE WALK BOUNDARY'S ARM. Classify, decide, record. Best-effort and loud: a recording failure must never turn a
 * vendor refusal into a second failure, but it must not be silent either.
 */
export async function armWalkQuota(err: unknown, site: string, lane: WalkLane | null): Promise<{ quota: boolean; applied: 'none' | 'fleet' | 'lane' | 'lane+fleet'; untilIso: string | null; described: string | null }> {
  const kind = classifyWalkQuotaError(err)
  if (!kind.quota) return { quota: false, applied: 'none', untilIso: null, described: null }
  try {
    const r = await applyWalkHold({ kind, lane, site })
    console.warn(`[walk-quota] ${r.applied.toUpperCase()} HOLD until ${r.untilIso} (${site}${lane ? ` · lane ${lane.clientId}/${lane.vendor}` : ''}): ${r.reason}`)
    return { quota: true, applied: r.applied, untilIso: r.untilIso, described: describeWalkQuota(kind) }
  } catch (e: any) {
    console.error(`[walk-quota] HOLD NOT RECORDED at ${site}: ${String(e?.message ?? e)} — the refusal is real and now invisible; ${describeWalkQuota(kind)}`)
    return { quota: true, applied: 'none', untilIso: null, described: describeWalkQuota(kind) }
  }
}

export interface WalkLaneHold {
  held: boolean
  /** 'held' | 'clear' | 'unknown' — unknown means the READ failed, not that the lane is clear. */
  state: 'held' | 'clear' | 'unknown'
  until: string | null
  reason: string | null
}

/** The lane's own hold. Clock-based like the fleet row: an elapsed held_until reads clear. An unreadable store reads unknown. */
export async function readWalkLaneHold(lane: WalkLane, deps: Pick<WalkHoldDeps, 'readLane'> = realDeps, nowMs = Date.now()): Promise<WalkLaneHold> {
  try {
    const row = await deps.readLane(lane)
    if (!row) return { held: false, state: 'clear', until: null, reason: null }
    if (Date.parse(row.held_until) <= nowMs) return { held: false, state: 'clear', until: row.held_until, reason: row.reason }
    return { held: true, state: 'held', until: row.held_until, reason: row.reason }
  } catch (e: any) {
    return { held: false, state: 'unknown', until: null, reason: `lane hold READ FAILURE (not a confirmed hold): ${String(e?.message ?? e)}` }
  }
}

/** The capture-lane rule for the lane record, mirroring holdGoogleWork: held OR unreadable → hold. */
export function holdWalkLane(h: WalkLaneHold): boolean {
  return h.held || h.state === 'unknown'
}
