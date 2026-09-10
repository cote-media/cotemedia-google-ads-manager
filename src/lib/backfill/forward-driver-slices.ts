// LORAMER_FORWARD_DRIVER_V1 — THE DRIVER'S PURE HALF: slice map, surface selection, the unit loop, the estimate.
//
// ⛔ NO IMPORTS, BY DESIGN. Two guards (driver-skips-alias-covered · every-unit-observed) compile this file standalone
// with `tsc --noResolve` and drive it with no network and no database. Everything that touches a vendor, a table or a
// clock lives in forward-driver.ts and is handed in here as a function.
//
// ⛔ THE DRIVER IS CATALOGUE-ONLY (Russ, 2026-09-10, round 9; DECISIONS:2461): the legacy path — cron/sync/route.ts's ten
// google builders and their 35 catalogue surfaces / 52 metrics_daily keys — is FROZEN for the Google Ads Standard Access
// RMF review and is never built on, moved, split or re-pointed. The driver owns the 319 surfaces the legacy family never
// asks, and nothing else. Ruling (n) holds by DISJOINTNESS: the two writers share no surface, so no row is written twice.
//
// THE SLICE MAP (DECISIONS LORAMER_SESSION_2026_09_05_RULINGS (m): the bound is ROWS WRITTEN; heavy slices take a
// fire alone) — derived from the Gate-A measurement of 2026-09-10 on client c39ee088 (registry: src/lib/clients/canonical.ts),
// 31-day window 2026-08-09..2026-09-08, write-free, N=319 surfaces, rows=722,260:
//   HEAVY  — the search-term / landing family: campaign_search_term_view · search_term_view · landing_page_view ·
//            expanded_landing_page_view · paid_organic_search_term_view — 50 surfaces, 485,336 rows (67% of the
//            catalogue's rows on 16% of its surfaces; expanded_landing_page_view alone ~3,700 rows/day ×3).
//            (Gate-A's family table read 41/437,312 because it filed search_term_view's 9 segments under
//            "same-resource"; the slice is BY RESOURCE, so they ride HEAVY — 48,024 rows.)
//   REST   — the remaining 269 catalogue surfaces, 236,924 rows; 254 of the 319 under 1,000 rows per 31 days.
// The 16 alias-covered keys (DRAIN_ALIAS: 4 identity + 12 geo aliases) and the 14 catalogue surfaces the legacy
// family already asks are EXCLUDED — one writer per surface (ruling n). 349 − 16 − 14 = 319 = 50 + 269.

export type DriverSlice = 'HEAVY' | 'REST'
export const DRIVER_SLICES: DriverSlice[] = ['HEAVY', 'REST']

/** A catalogue entry, as far as this module needs to see it. */
export interface SliceEntry { resource: string; segment?: string | null }

export const HEAVY_RESOURCES = new Set<string>([
  'campaign_search_term_view', 'search_term_view', 'landing_page_view', 'expanded_landing_page_view', 'paid_organic_search_term_view',
])

export const surfaceKey = (e: SliceEntry): string => `${e.resource}|${e.segment ?? ''}`

/** Which catalogue slice an entry belongs to. */
export function sliceOf(e: SliceEntry): DriverSlice {
  return HEAVY_RESOURCES.has(e.resource) ? 'HEAVY' : 'REST'
}

/**
 * The driver's catalogue: `entries` MINUS alias-covered MINUS legacy-asked. `isAliasCovered` is wired by the driver to
 * drainAliasFor(surfaceOfEntry(e)) and `legacyKeys` to FORWARD_PRODUCER_SURFACES (the frozen family's own manifest, read,
 * never edited) — this module never guesses at either.
 */
export function selectDriverSurfaces<T extends SliceEntry>(entries: T[], isAliasCovered: (e: T) => boolean, legacyKeys: Set<string>): T[] {
  return entries.filter((e) => !isAliasCovered(e) && !legacyKeys.has(surfaceKey(e)))
}

export type UnitOutcome = 'ok' | 'zero' | 'nongrain' | 'error'

export interface AskResult { apiRows: number; rowsWritten: number; rowsByDay: Record<string, number>; requests: number }

export interface UnitObservation {
  resource: string; segment: string
  requests: number; rowsByDay: Record<string, number>; rowsWritten: number; apiRows: number
  error: string | null; outcome: UnitOutcome
}

export interface CatalogueUnitResult {
  surfacesAsked: number
  deferredForDeadline: number
  rows: number
  apiRows: number
  requests: number
  errors: number
  observationFailures: number
  /** per-surface, in ask order — the dry run prints these */
  observations: UnitObservation[]
}

/** The outcome vocabulary — the same derivation as forward-observation-log's observationOutcome, restated here so this file stays import-free. */
export function unitOutcome(a: { apiRows: number; rowsWritten: number; error?: string | null }): UnitOutcome {
  if (a.error) return 'error'
  if (a.apiRows === 0) return 'zero'
  if (a.rowsWritten === 0) return 'nongrain'
  return 'ok'
}

const describe = (err: unknown): string => {
  if (err instanceof Error) return err.message
  if (typeof err === 'string') return err
  try { return JSON.stringify(err) } catch { return String(err) }
}

/**
 * ⛔ ONE OBSERVATION PER ASKED SURFACE, WHATEVER CAME BACK (ruling (F): never a "didn't ask" day). `ask` may throw —
 * the surface is then observed as 'error' with the text. `observe` may throw — that is COUNTED (observationFailures)
 * and the unit continues; a failed append must never abort the other surfaces. A surface the deadline stops BEFORE
 * its ask is DEFERRED, not observed: it was not asked, and the pending predicate finds it again on the next fire.
 */
export async function runCatalogueUnit(a: {
  surfaces: SliceEntry[]
  ask: (s: SliceEntry) => Promise<AskResult>
  observe: (o: UnitObservation) => Promise<void>
  window: { start: string; end: string }
  deadlineAt: number
  now?: () => number
}): Promise<CatalogueUnitResult> {
  const now = a.now ?? (() => Date.now())
  const out: CatalogueUnitResult = { surfacesAsked: 0, deferredForDeadline: 0, rows: 0, apiRows: 0, requests: 0, errors: 0, observationFailures: 0, observations: [] }
  for (let i = 0; i < a.surfaces.length; i++) {
    if (now() > a.deadlineAt) { out.deferredForDeadline = a.surfaces.length - i; break }
    const s = a.surfaces[i]
    let obs: UnitObservation
    try {
      const r = await a.ask(s)
      obs = { resource: s.resource, segment: s.segment ?? '', requests: r.requests, rowsByDay: r.rowsByDay, rowsWritten: r.rowsWritten, apiRows: r.apiRows, error: null, outcome: unitOutcome(r) }
    } catch (err) {
      const message = describe(err)
      obs = { resource: s.resource, segment: s.segment ?? '', requests: 1, rowsByDay: {}, rowsWritten: 0, apiRows: 0, error: message, outcome: 'error' }
    }
    out.surfacesAsked += 1
    out.rows += obs.rowsWritten; out.apiRows += obs.apiRows; out.requests += obs.requests
    if (obs.outcome === 'error') out.errors += 1
    out.observations.push(obs)
    try { await a.observe(obs) } catch { out.observationFailures += 1 }
  }
  return out
}

/**
 * THE PER-UNIT ESTIMATE (★BUDGET-CHECKED-ONCE-PER-FIRE-NOT-PER-UNIT-OF-WORK): rows ÷ write rate + one vendor
 * round-trip per surface. `rateRowsPerSec` defaults to ruling m's floor (1,448) until the client carries its own
 * measurement; `latencyPerSurfaceMs` is the Gate-A mean (327 s over 319 surfaces ≈ 1,000 ms). A client with no
 * observation yet estimates rows = 0 (latency-only) — stated so a first-fire estimate is never read as a measurement.
 */
export function estimateUnitMs(a: { rows: number; surfaces: number; rateRowsPerSec: number; latencyPerSurfaceMs: number }): number {
  return Math.ceil((a.rows / a.rateRowsPerSec) * 1000 + a.surfaces * a.latencyPerSurfaceMs)
}

export type UnitDecision = 'run' | 'skip-over-budget'

/**
 * THE DOOR CHECK, PER UNIT, IN ORDER. A unit runs when its estimate fits the remaining budget; two units in one
 * invocation is the "packed" case, and it is decided by the same predicate, not a flag (ruling m: heavy takes a fire
 * alone follows from the estimate, never from a name).
 */
export function decideUnit(a: { estimateMs: number; remainingMs: number }): UnitDecision {
  return a.estimateMs > a.remainingMs ? 'skip-over-budget' : 'run'
}
