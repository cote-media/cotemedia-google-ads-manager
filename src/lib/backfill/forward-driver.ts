// LORAMER_FORWARD_DRIVER_V1 (1/2) — THE FORWARD DRIVER, ISOLATED AND CATALOGUE-ONLY. No caller, no cron, no route edit.
//
// DECISIONS LORAMER_SESSION_2026_09_05_RULINGS (A)(f)(m)(n)(p)(q) + QUEUE ★FORWARD-DRIVER-SHAPE, RESCOPED 2026-09-10 (Russ):
// ⛔ THE LEGACY PATH IS FROZEN FOR THE GOOGLE ADS STANDARD ACCESS RMF REVIEW (DECISIONS:2461, 2026-08-14/15) — cron/sync/ — history; Standard since 2026-09-15, the freeze is lifted, LORAMER_GOOGLE_ACCESS_STANDARD_V1
// route.ts's ten google builders, /dashboard, the session Google routes and the demo twin client are never built on,
// moved, split or re-pointed; useful work is COPIED to new. This driver therefore owns ONLY the 319 catalogue surfaces
// the legacy family never asks (HEAVY 50 + REST 269, forward-driver-slices.ts), every day, every active google customer
// except the frozen twin, each over the UNIFORM 31-day restate window ending at D (ruling p.1), clamped at the account's
// inception (readWalkStopAccountFacts — never resolveWalkStop, no descent). Ruling (n) — one writer per surface — holds by
// DISJOINTNESS: the route keeps its 30 catalogue surfaces, the driver its 319, no row is written twice.
//
// THE UNIT is (client, slice, D), claimed by CAS under DRIVER_CLAIM_LEASE_S in sync_state's PK namespace
// `__fwd_google:<slice>` (disjoint from '<platform>', '__fwd_google', '__drain_google', catchup's key; pseudo-rows
// `left(platform,2) = '__'` are excluded by check-frozen-cursors and the walk never reads sync_state). One invocation
// loops PENDING units — pending = the ledger holds no observation with window_end = D for some surface of the slice
// (ruling q: completeness is read from forward_observation_log, never the schedule) — and the door is checked PER
// UNIT before its claim (★BUDGET-CHECKED-ONCE-PER-FIRE-NOT-PER-UNIT-OF-WORK): estimate = last observed rows for the
// PENDING surfaces of the (client, slice) ÷ write rate + one round-trip per pending surface. LORAMER_DRIVER_PARTIAL_UNIT_V1
// (2026-09-13): the estimate no longer gates admission — a unit is admitted whenever ≥ MIN_PARTIAL_MS remains, cut at the
// deadline by runCatalogueUnit, and resumed from the ledger's pending remainder next fire (the old "estimate > remaining →
// skip" door refused Bath Fitter's REST slice on every fire once its own prior grew past the whole budget). Two units in
// one invocation is the packed case; ruling m's "heavy takes a fire alone" is a consequence of the cut, not of a name.
//
// WHAT IT WRITES: metrics_daily through captureSurfaceStreaming's ONE upsert path (upsertMetricsChunked) and
// forward_observation_log (one row per asked surface, producer `driver-<slice>`). ⛔ NEVER the walk's ledger (ruling b/f —
// tests/guards/driver-never-writes-attempt-log.guard.mjs). The ask is the walk's own (googleAdsCaptureAdapter.stream →
// buildGaql + ORDER_CLAUSE), so the row is the walk's row at the catalogue spelling.
//
// DRY RUN (Gate-A's shape): `dryRun.upsert` replaces the metrics_daily write with a counter, observations are counted
// instead of appended, and no unit is claimed. Measured 2026-09-10 on c39ee088 (registry src/lib/clients/canonical.ts):
// HEAVY 50/50 → 476,200 rows in 73 s · REST 269/269 → 234,766 rows in 196 s · 0 errors · zero warehouse writes.
import { supabaseAdmin } from '@/lib/supabase'
import { loadUniverse, selectableEntries, readWalkStopAccountFacts, type UniverseEntry } from '@/lib/backfill/google-ads-universe-writer'
import { googleAdsCaptureAdapter, surfaceOfEntry } from '@/lib/backfill/capture-adapters/google-ads.adapter'
import { captureEntityDimension, type DimensionCaptureReport } from '@/lib/backfill/entity-dimension-capture' // LORAMER_ENTITY_DIMENSION_V1
import { drainAliasFor, DEALIASED_BASE_SURFACES } from '@/lib/backfill/universe-surfaces' // LORAMER_WALK_BASE_DEALIAS_V1 — the four bases are two-writer-two-key
import { captureSurfaceStreaming } from '@/lib/backfill/universe-stream-capture'
import { googleAdsStreamFor } from '@/lib/backfill/universe-vendor-stream'
import { FORWARD_PRODUCER_SURFACES, observeForward, readSliceObservationState } from '@/lib/backfill/forward-observation-log'
import {
  DRIVER_SLICES, selectDriverSurfaces, sliceOf, surfaceKey, runCatalogueUnit, estimateUnitMs, decideUnit,
  type DriverSlice, type UnitDecision, type CatalogueUnitResult, type UnitObservation,
} from '@/lib/backfill/forward-driver-slices'

// ── THE CONSTANTS, EACH WITH ITS DERIVATION ────────────────────────────────────────────────────────────────────
/** = cron/sync/route.ts `export const maxDuration` (800). A library module cannot import a route; tests/guards/unit-lease-covers-max-duration.guard.mjs pins the two equal. */
export const DRIVER_MAX_DURATION_S = 800
/** ⇐ maxDuration + 100 (LORAMER_FORWARD_LANE_HYGIENE_V1): a holder's hold is ≤ maxDuration on Vercel; +100 s covers a write issued in the last second. */
export const DRIVER_CLAIM_LEASE_S = DRIVER_MAX_DURATION_S + 100
/** ⇐ cron/sync/route.ts:91 FORWARD_BUDGET_MS — the same door, ~120 s under the 800 s kill. */
export const DRIVER_BUDGET_MS = 680_000
/** ⇐ ruling (m) DECISIONS:2552 — 1,448–1,756 rows/s single-client, measured on c39ee088; the FLOOR is the estimate's default. */
export const DEFAULT_WRITE_RATE_ROWS_PER_S = 1448
/** ⇐ measured 2026-09-10 N=319 (Gate-A): Σ latency 326.8 s over 319 surfaces ≈ 1,024 ms per catalogue ask. */
export const LATENCY_PER_SURFACE_MS = 1000
/** ⇐ cron/sync/route.ts:129 GOOGLE_RESTATE_LOOKBACK_DAYS — window = [D−30, D] = 31 days, ruling (p.1)'s uniform width. Read, never edited. */
export const RESTATE_LOOKBACK_DAYS = 30
/**
 * ⛔ CLIENTS THE DRIVER NEVER TOUCHES. 2617b163 is the demo twin — the exhibit in the open Google Ads Standard Access RMF — history; Standard since 2026-09-15, the freeze is lifted, LORAMER_GOOGLE_ACCESS_STANDARD_V1
 * review (DECISIONS:2461: "It covers legacy `/dashboard` and the demo twin `2617b163`"); ★TWIN-AD-NAMES-HELD-BY-FREEZE is the
 * precedent that a fleet metrics_daily write stops at this client while the freeze stands. Filtered BEFORE any claim.
 * Identity per the registry, src/lib/clients/canonical.ts. Comes off with the legacy pin, never before.
 */
export const DRIVER_EXCLUDED_CLIENTS: string[] = ['2617b163-f392-427e-9a29-f134acc51406']

export const unitClaimKey = (slice: DriverSlice): string => `__fwd_google:${slice}`

const addDaysUTC = (iso: string, n: number): string => { const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }

export interface DriverUnitReport {
  clientId: string
  customerId: string
  slice: DriverSlice
  surfaces: number
  pendingSurfaces: number
  estimateMs: number
  estimateRows: number
  decision: UnitDecision | 'claim-lost' | 'not-pending'
  claimed: boolean
  ran: boolean
  actualMs: number | null
  rows: number
  apiRows: number
  requests: number
  errors: number
  observationFailures: number
  deferredForDeadline: number
  windowStart: string | null
  windowEnd: string
  note?: string
  /** dry run only: per-surface observations, in ask order */
  observations?: UnitObservation[]
}

export interface DriverRunReport {
  targetDate: string
  dryRun: boolean
  startedAt: string
  elapsedMs: number
  catalogueSurfaces: number
  heavySurfaces: number
  restSurfaces: number
  excludedClients: string[]
  units: DriverUnitReport[]
  /** LORAMER_ENTITY_DIMENSION_V1 — one entry per client whose dimension was refreshed this run. */
  entityDimension: DimensionCaptureReport[]
}

export interface RunForwardDriverOpts {
  targetDate: string
  clientIds?: string[]
  cronRunId?: number | null
  budgetMs?: number
  rateRowsPerSec?: number
  dryRun?: { upsert: (rows: Record<string, unknown>[]) => Promise<{ written: number }> }
  log?: (line: string) => void
}

type ClientRow = { id: string; user_email: string | null; platform_connections: Array<{ platform: string; account_id: string; account_name?: string | null; user_email?: string | null }> | null }

async function claimUnit(clientId: string, slice: DriverSlice): Promise<boolean> {
  const token = `fwd-driver-${slice}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const { data, error } = await supabaseAdmin.rpc('claim_backfill_cursor', {
    p_client_id: clientId,
    p_platform: unitClaimKey(slice),
    p_token: token,
    p_lease_seconds: DRIVER_CLAIM_LEASE_S, // LORAMER_FORWARD_LANE_HYGIENE_V1 — migration 086's parameter
  })
  if (error) { console.error(`[forward-driver] claim failed client=${clientId} slice=${slice}: ${error.message}`); return false }
  const claim = Array.isArray(data) ? (data[0] as { claimed?: boolean }) : (data as { claimed?: boolean })
  return Boolean(claim?.claimed)
}

/** The legacy family's own manifest (FORWARD_PRODUCER_SURFACES, read never edited) as `resource|segment` keys — the surfaces the driver must NOT ask. */
export function legacySurfaceKeys(): Set<string> {
  return new Set(Object.values(FORWARD_PRODUCER_SURFACES).flat().map((s) => surfaceKey(s)))
}

/**
 * The driver's catalogue: selectable − alias-covered (drainAliasFor) − legacy-asked (FORWARD_PRODUCER_SURFACES)
 * + the four DE-ALIASED base surfaces. LORAMER_WALK_BASE_DEALIAS_V1 (2026-09-12): forward keeps writing those four
 * at '' (its manifest is read, never edited), and the driver now ALSO asks them at the walk spelling so the
 * lookback lane has walk rows to restate — two writers, two keys (ruling (n), amended 2026-09-12). 17 × 323.
 */
export function driverCatalogue(root = process.cwd()): { heavy: UniverseEntry[]; rest: UniverseEntry[] } {
  const legacyMinusDealiased = new Set([...legacySurfaceKeys()].filter((k) => !DEALIASED_BASE_SURFACES.has(k)))
  const all = selectDriverSurfaces(
    selectableEntries(loadUniverse(root)),
    (e) => { const s = surfaceOfEntry(e); return drainAliasFor(s.entityLevel, s.breakdownType) !== null },
    legacyMinusDealiased,
  )
  return { heavy: all.filter((e) => sliceOf(e) === 'HEAVY'), rest: all.filter((e) => sliceOf(e) === 'REST') }
}

export async function runForwardDriver(opts: RunForwardDriverOpts): Promise<DriverRunReport> {
  const started = Date.now()
  const log = opts.log ?? ((l: string) => console.log(l))
  const budgetMs = opts.budgetMs ?? DRIVER_BUDGET_MS
  const rate = opts.rateRowsPerSec ?? DEFAULT_WRITE_RATE_ROWS_PER_S
  const dry = Boolean(opts.dryRun)
  const D = opts.targetDate
  const catalogue = driverCatalogue()
  const report: DriverRunReport = {
    targetDate: D, dryRun: dry, startedAt: new Date(started).toISOString(), elapsedMs: 0,
    catalogueSurfaces: catalogue.heavy.length + catalogue.rest.length, heavySurfaces: catalogue.heavy.length, restSurfaces: catalogue.rest.length,
    excludedClients: [...DRIVER_EXCLUDED_CLIENTS], units: [], entityDimension: [],
  }

  let q = supabaseAdmin.from('clients').select('id, user_email, platform_connections(*)').is('deleted_at', null)
  if (opts.clientIds && opts.clientIds.length) q = q.in('id', opts.clientIds)
  const { data: clients, error: clientsError } = await q
  if (clientsError) throw new Error(`[forward-driver] failed to load clients: ${clientsError.message}`)
  // ⛔ THE FROZEN TWIN IS FILTERED HERE, BEFORE ANY CLAIM OR ASK — DECISIONS:2461.
  const excluded = new Set(DRIVER_EXCLUDED_CLIENTS)
  const eligible = ((clients ?? []) as ClientRow[]).filter((c) => !excluded.has(c.id))
  for (const c of (clients ?? []) as ClientRow[]) if (excluded.has(c.id)) log(`[forward-driver] ${c.id}: EXCLUDED (frozen for the Standard Access review, DECISIONS:2461) — no claim, no ask`)

  let unitsRun = 0
  const deadlineAt = started + budgetMs

  outer: for (const client of eligible) {
    for (const conn of (client.platform_connections ?? []).filter((c) => c.platform === 'google')) {
      const customerId = conn.account_id
      const userEmail = conn.user_email || client.user_email || ''
      const state = await readSliceObservationState({ clientId: client.id, vendor: 'google', windowEnd: D })

      // ⛔ LORAMER_ENTITY_DIMENSION_V1 — ONCE PER CLIENT PER DRIVER RUN, BESIDE THE CAPTURE LOOP.
      // Three UN-SEGMENTED queries refresh this account's current names and its real parent chain. It runs
      // HERE and not in the walk because the write path is the measured ceiling and this flight may not slow
      // capture: a fire's cost is unchanged because a fire does not do this.
      // ⛔ SOFT BY CONSTRUCTION — it never throws and its failure never costs the driver a row of real work.
      // An unchanged account writes NOTHING, so the steady-state cost is 3 reads and 0 writes.
      if (!dry) {
        try {
          const dim = await captureEntityDimension({ clientId: client.id, userEmail, customerId, log })
          report.entityDimension.push(dim)
        } catch (e: any) {
          log(`[forward-driver] ${client.id}: entity dimension threw (work unaffected): ${e?.message ?? e}`)
        }
      }

      for (const slice of DRIVER_SLICES) {
        const entries = slice === 'HEAVY' ? catalogue.heavy : catalogue.rest
        const surfaces = entries.map((e) => ({ resource: e.resource, segment: e.segment ?? '' }))
        const pendingOnly = surfaces.filter((s) => !state.observedAtWindowEnd.has(surfaceKey(s)))
        // LORAMER_DRIVER_PARTIAL_UNIT_V1 — the estimate is over the PENDING remainder, both terms. Over the whole slice a
        // unit that ran 112 of 273 re-estimated at the full 768 s next fire; the number printed below is what is left to do.
        const estimateRows = pendingOnly.reduce((sum, s) => sum + (state.lastRowsBySurface.get(surfaceKey(s)) ?? 0), 0)
        const estimateMs = estimateUnitMs({ rows: estimateRows, surfaces: pendingOnly.length, rateRowsPerSec: rate, latencyPerSurfaceMs: LATENCY_PER_SURFACE_MS })
        const unit: DriverUnitReport = {
          clientId: client.id, customerId, slice, surfaces: surfaces.length, pendingSurfaces: pendingOnly.length, estimateMs, estimateRows,
          decision: 'not-pending', claimed: false, ran: false, actualMs: null, rows: 0, apiRows: 0, requests: 0, errors: 0,
          observationFailures: 0, deferredForDeadline: 0, windowStart: null, windowEnd: D,
        }
        report.units.push(unit)
        if (pendingOnly.length === 0) { log(`[forward-driver] ${client.id} ${slice}: complete for ${D} (${surfaces.length}/${surfaces.length} observed) — not pending`); continue }
        const remainingMs = deadlineAt - Date.now()
        unit.decision = decideUnit({ estimateMs, remainingMs })
        log(`[forward-driver] ${client.id} ${slice}: pending ${pendingOnly.length}/${surfaces.length} · estimate ${estimateRows} rows ≈ ${Math.round(estimateMs / 1000)} s vs remaining ${Math.round(remainingMs / 1000)} s → ${unit.decision}`)
        if (unit.decision !== 'run') continue
        if (!dry) {
          unit.claimed = await claimUnit(client.id, slice)
          if (!unit.claimed) { unit.decision = 'claim-lost'; log(`[forward-driver] ${client.id} ${slice}: claim lost (another fire holds it) — skipped`); continue }
        } else {
          unit.note = 'dry run: not claimed'
        }

        const t0 = Date.now()
        const facts = await readWalkStopAccountFacts({ clientId: client.id, vendor: 'google', discover: null })
        const rawStart = addDaysUTC(D, -RESTATE_LOOKBACK_DAYS)
        const windowStart = facts.inceptionDate && facts.inceptionDate > rawStart ? facts.inceptionDate : rawStart
        unit.windowStart = windowStart
        const streamFor = await googleAdsStreamFor(userEmail, customerId)
        const byKey = new Map(entries.map((e) => [surfaceKey(e), e]))
        const producer = `driver-${slice}`
        const window = { start: windowStart, end: D }
        const res: CatalogueUnitResult = await runCatalogueUnit({
          surfaces: pendingOnly,
          window,
          deadlineAt,
          ask: async (s) => {
            const entry = byKey.get(surfaceKey(s))!
            const surface = surfaceOfEntry(entry)
            const adapter = googleAdsCaptureAdapter(streamFor, () => entry)
            const rowsByDay: Record<string, number> = {}
            const r = await captureSurfaceStreaming({
              adapter, surface, ctx: { clientId: client.id, userEmail, accountId: customerId },
              startDate: windowStart, endDate: D,
              onDayCommitted: async (day, rows) => { rowsByDay[day] = (rowsByDay[day] ?? 0) + rows },
              ...(opts.dryRun ? { upsert: opts.dryRun.upsert } : {}),
            })
            if (r.error) throw new Error(r.error)
            return { apiRows: r.apiRows, rowsWritten: r.rowsWritten, rowsByDay, requests: 1 }
          },
          observe: async (o) => {
            if (dry) return
            await observeForward(producer, client.id, window, [o], {
              cronRunId: opts.cronRunId ?? null,
              onError: (message) => { throw new Error(message) },
            })
          },
        })
        unit.ran = true; unit.actualMs = Date.now() - t0
        unit.rows = res.rows; unit.apiRows = res.apiRows; unit.requests = res.requests; unit.errors = res.errors
        unit.observationFailures = res.observationFailures; unit.deferredForDeadline = res.deferredForDeadline
        if (dry) unit.observations = res.observations
        unitsRun += 1
        log(`[forward-driver] ${client.id} ${slice}: ran in ${Math.round(unit.actualMs / 1000)} s (estimate ${Math.round(estimateMs / 1000)} s) · asked ${res.surfacesAsked} · rows ${res.rows} · api ${res.apiRows} · errors ${res.errors} · deferred ${res.deferredForDeadline}`)
        if (Date.now() > deadlineAt) break outer
      }
    }
  }
  report.elapsedMs = Date.now() - started
  return report
}
