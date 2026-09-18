// LORAMER_ONE_CLICK_WALK_V1 → LORAMER_STATUS_RUN_FIELDS_V1 — THE GOOGLE READOUT, IN A LIB SO TWO ROUTES READ ONE TRUTH.
//
// Moved verbatim out of /api/backfill/status/route.ts (flight 2, 2026-09-18) because the Backfill button's route must
// judge a press by the SAME readout the meter shows (restart only when the readout is no longer 'complete'), and a
// Next.js route module may export only its handlers. Nothing about googleWalkStatus changed in the move.
// googleRunStatus is the ADDITIVE half: the run row through runView (finished_at wins; RUN_STALL_MINUTES), the
// customer's progress (client-scoped days no longer owed since the run started, any producer — the customer wants
// ground covered, not bookkeeping), and the denominator (catalogue × days inception..yesterday; null until inception).
import { supabaseAdmin } from '@/lib/supabase'
import { readWalkStopAccountFacts } from '@/lib/backfill/google-ads-universe-writer'
import { runView, type RunView } from '@/lib/backfill/continuous-run'
import { daysNoLongerOwedSince } from '@/lib/backfill/universe-coverage'
import { ledgerVendorFor } from '@/lib/backfill/universe-vendor-spelling' // the ledger's spelling of the vendor, via the map — not the contract (universe-stream-consumer leg (e): reaching the contract is reaching the topic)

/** The run row's own vendor spelling (universe_run.vendor, migration 096) — the capture universe's name. */
export const RUN_VENDOR = 'google_ads'

export type GoogleWalkState = 'not-started' | 'complete' | 'partial'

/**
 * THE WALK'S ANSWER FOR ONE CLIENT. Reads the same facts the resumer composes its stop from (readWalkStopAccountFacts,
 * discover: null — this route never fetches), the same seals the resumer excludes on (universe_attempt_log
 * attempt_finished/floor_stop on lane 'descend', newest per surface), and the catalogue size the latest completed fire
 * recorded (universe_fire_log.catalog_size — no artifact read on this route, so no tracing entry is needed).
 *   not-started — no universe_account_inception row (UNKNOWN never defaults; the worker's first message discovers it)
 *   complete    — sealed surfaces ≥ the catalogue size the last fire saw; earliestDate = the account floor
 *                 (min(inception, earliest held day) — the stop the seals were written at)
 *   partial     — anything else; earliestDate = the walk's earliest descend window start (real surfaces only)
 */
export async function googleWalkStatus(clientId: string): Promise<{ state: GoogleWalkState; earliestDate: string | null; complete: boolean; sealed: number; catalogSize: number | null; inception: string | null }> {
  const facts = await readWalkStopAccountFacts({ clientId, vendor: 'google', discover: null })
  if (!facts.inceptionDate) return { state: 'not-started', earliestDate: null, complete: false, sealed: 0, catalogSize: null, inception: null }

  const { data: sealRows } = await supabaseAdmin.from('universe_attempt_log')
    .select('resource, segment')
    .eq('client_id', clientId).eq('vendor', 'google')
    .eq('phase', 'attempt_finished').eq('outcome', 'floor_stop').eq('lane', 'descend')
    .limit(5000)
  const sealed = new Set((sealRows ?? []).map((r: any) => `${r.resource}|${r.segment ?? ''}`)).size

  // LORAMER_STATUS_WET_FIRES_ONLY_V1 — WET fires only: a dry (diagnostic) completed fire carries the catalogue it was
  // run against (Foam OH's three dry completed rows say 346 where the wet answer is 349), and the "complete" verdict
  // below divides by this number. tests/guards/fire-log-readers-wet-only.guard.mjs pins the filter on every reader.
  const { data: fire } = await supabaseAdmin.from('universe_fire_log')
    .select('catalog_size')
    .eq('client_id', clientId).eq('dry_run', false).eq('fire_outcome', 'completed')
    .order('fired_at', { ascending: false }).limit(1).maybeSingle()
  const catalogSize = fire?.catalog_size != null ? Number(fire.catalog_size) : null

  if (catalogSize !== null && catalogSize > 0 && sealed >= catalogSize) {
    const floor = facts.earliestHeldDate && facts.earliestHeldDate < facts.inceptionDate ? facts.earliestHeldDate : facts.inceptionDate
    return { state: 'complete', earliestDate: floor, complete: true, sealed, catalogSize, inception: facts.inceptionDate }
  }

  const { data: earliest } = await supabaseAdmin.from('universe_attempt_log')
    .select('window_start')
    .eq('client_id', clientId).eq('vendor', 'google').eq('lane', 'descend')
    .neq('resource', '__account_inception').gt('window_start', '2000-01-01')
    .order('window_start', { ascending: true }).limit(1).maybeSingle()
  return { state: 'partial', earliestDate: earliest?.window_start ? String(earliest.window_start) : null, complete: false, sealed, catalogSize, inception: facts.inceptionDate }
}

export interface GoogleRunStatus {
  run: RunView | null
  progress: { daysNoLongerOwed: number | null; denominator: number | null }
  stalled: boolean
}

/** Days in [inception, yesterday], inclusive; 0 when inception is after yesterday. */
export function daysInceptionToYesterday(inceptionIso: string, todayIso: string): number {
  const y = new Date(todayIso + 'T00:00:00Z'); y.setUTCDate(y.getUTCDate() - 1)
  const n = Math.round((y.getTime() - Date.parse(inceptionIso + 'T00:00:00Z')) / 86_400_000) + 1
  return Math.max(0, n)
}

/**
 * The additive half of the google readout. Never throws: an unreadable run row or ledger reads as null progress —
 * "unknown", never zero (LORAMER_EMPTY_CARRIES_ITS_DENOMINATOR_V1).
 */
export async function googleRunStatus(
  clientId: string,
  walk: { inception: string | null; catalogSize: number | null },
  nowMs = Date.now(),
): Promise<GoogleRunStatus> {
  const { data: row, error } = await supabaseAdmin.from('universe_run')
    .select('status, steps, requests_opened, days_committed, started_at, last_step_at, finished_at, stop_reason, last_invocation')
    .eq('client_id', clientId).eq('vendor', RUN_VENDOR).maybeSingle()
  if (error) console.error(`[google-walk-status] run row unreadable for ${clientId}: ${error.message}`)
  const run = runView(error ? null : (row as any), nowMs)
  let daysNoLongerOwed: number | null = null
  if (run) {
    try { daysNoLongerOwed = await daysNoLongerOwedSince({ clientId, vendor: ledgerVendorFor(RUN_VENDOR) }, run.startedAt) }
    catch (e: any) { console.error(`[google-walk-status] progress unreadable for ${clientId}: ${e?.message ?? e}`) }
  }
  const denominator = walk.inception && walk.catalogSize
    ? walk.catalogSize * daysInceptionToYesterday(walk.inception, new Date(nowMs).toISOString().slice(0, 10))
    : null
  return { run, progress: { daysNoLongerOwed, denominator }, stalled: run?.stalled ?? false }
}
