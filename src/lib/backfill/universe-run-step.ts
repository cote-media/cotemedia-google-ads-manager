// LORAMER_CONTINUOUS_RUN_V1 / LORAMER_RUN_PUMP_V1 — ONE STEP OF A RUN, AS A FUNCTION. The route used to hold this inline
// and kick itself for the next step; the pump (universe-run-pump.ts) now calls it in a loop inside one invocation, and
// the route keeps a single-step action for an operator. NOTHING HERE MAKES AN HTTP REQUEST: the fire is injected and
// called in-process (universe-run-fire.ts). A fetch of our own deployment URL from a cron-invoked function met Vercel
// Authentication on the *.vercel.app origin and answered an SSO page (measured 2026-09-17 20:32Z, 159 steps read as
// "nothing asked"); a fetch of our own run route met the loop detector's 508 at the fourth hop (round 9).
//
// ⛔ PROGRESS IS DAYS NO LONGER OWED, COUNTED FROM `universe_attempt_log` under the LEDGER's spelling of the vendor
// (ledgerVendorFor), NOT from the step's own report — LORAMER_RUN_PROGRESS_SIGNAL_V1. A hold is only what the fire
// calls a hold (heldFromFireBody). The stop limits are time (LORAMER_RUN_STOP_LIMITS_ARE_TIME_V1): the ceiling from the
// run row's started_at, the asking clock from the ledger.
//
// ⛔ ONE RUN PER LANE, ENFORCED TWICE. The fire lease stops two FIRES of a lane overlapping; the compare-and-set on the
// run's step counter stops two PUMPS from both advancing one run — the loser reports casLost and its pump exits.
import { supabaseAdmin } from '@/lib/supabase'
import { decideChain, applyStep, heldFromFireBody, classifyFireAnswer, type StepOutcome, type RunState } from '@/lib/backfill/continuous-run'
import { daysNoLongerOwedSince, askingWithoutProgressSince } from '@/lib/backfill/universe-coverage'
import { ledgerVendorFor } from '@/lib/backfill/universe-vendor-spelling'
import type { PumpStepResult } from '@/lib/backfill/universe-run-pump'
import type { FireAnswer } from '@/lib/backfill/universe-run-fire'

export type RunRow = {
  status: 'running' | 'stopping' | 'done' | 'failed'
  started_at: string
  finished_at: string | null
  steps: number
  requests_opened: number
  days_committed: number
  steps_without_progress: number
}

export type StepReport = PumpStepResult & {
  step: number
  stepMs: number
  scanMs: number | null
  daysNoLongerOwed: number
  requestsOpened: number
  atFloor: boolean
  noRun?: boolean
}

/** -1 = UNREADABLE (the caller chains); never 0 from a failed read. */
async function daysNoLongerOwedThisStep(clientId: string, vendor: string, sinceIso: string, fireId: string | null): Promise<number> {
  try {
    // LORAMER_OWN_INVOCATION_METER_V1 — the run row counts ITS fire's days (rows stamped `${fireId}:%`); the rotation's
    // fire beside it is not this run's. A fire that did not answer with its id (an older deployment) counts unscoped.
    return await daysNoLongerOwedSince({ clientId, vendor: ledgerVendorFor(vendor) }, sinceIso, { invocationPrefix: fireId })
  } catch (e: any) {
    console.error(`[universe-run] progress unreadable for ${clientId}: ${e?.message ?? e}`)
    return -1
  }
}

/**
 * Run one step of the lane's run. Never throws. `fire` runs the existing fire for this client in-process and returns
 * its answer; the fire's own lease refuses a second fire of the lane while one runs.
 */
export async function runOneStep(a: { clientId: string; vendor: string; fire: () => Promise<FireAnswer>; log?: (s: string) => void }): Promise<StepReport> {
  const log = a.log ?? ((l: string) => console.log(l))
  const { clientId, vendor } = a
  const base: Omit<StepReport, 'chained' | 'status' | 'reason' | 'casLost'> = {
    step: 0, stepMs: 0, scanMs: null, daysNoLongerOwed: 0, requestsOpened: 0, atFloor: false,
  }
  const { data: row, error: rowErr } = await supabaseAdmin.from('universe_run')
    .select('status, started_at, finished_at, steps, requests_opened, days_committed, steps_without_progress')
    .eq('client_id', clientId).eq('vendor', vendor).maybeSingle()
  const run = row as RunRow | null
  if (rowErr || !run) {
    return { ...base, chained: false, status: 'failed', reason: rowErr ? `run row unreadable: ${rowErr.message}` : 'no run for this lane', casLost: false, noRun: !rowErr }
  }
  if (run.status === 'done' || run.status === 'failed' || run.finished_at) {
    return { ...base, step: run.steps, chained: false, status: run.status, reason: `run is already ${run.status}${run.finished_at ? ` (finished ${run.finished_at})` : ''}`, casLost: false }
  }

  const stepStartedAt = new Date().toISOString()
  const t0 = Date.now()
  const invocation = `${t0}-${Math.random().toString(36).slice(2, 8)}`

  // ⛔ CLAIM THE LANE AT STEP START — AND THE CLAIM IS `last_invocation`, CLEARED AT STEP END. The picker treats a lane
  // as busy only while a claim is LIVE (last_invocation set AND updated_at inside the reserve window); a lane whose step
  // has ENDED is free at once. The first cut keyed the busy window on updated_at alone, so every finished slice looked
  // busy for 320 s more and the START's own write cost the first step 5 min 49 s (measured 2026-09-17: 40% idle).
  // Under the same compare-and-set; a loser here exits before it fires anything.
  const { data: claimed, error: claimErr } = await supabaseAdmin.from('universe_run')
    .update({ updated_at: stepStartedAt, last_invocation: invocation })
    .eq('client_id', clientId).eq('vendor', vendor).eq('steps', run.steps)
    .select('steps')
  if (claimErr) return { ...base, step: run.steps, chained: false, status: 'failed', reason: `lane claim failed: ${claimErr.message}`, casLost: false }
  if (!claimed || claimed.length === 0) {
    return { ...base, step: run.steps, chained: false, status: run.status, reason: 'another chain advanced this run — exiting rather than racing it', casLost: true }
  }

  // THE STEP IS THE EXISTING FIRE, UNCHANGED, called in-process. Its answer is CLASSIFIED, never assumed: a non-JSON
  // answer is FATAL (it is not the fire), so a login page can never read as "nothing asked" again.
  let body: any = null
  let fatal: string | null = null
  try {
    const ans = await a.fire()
    body = ans.body
    fatal = classifyFireAnswer(ans.ok, ans.status, ans.body)
  } catch (e: any) {
    fatal = `step threw: ${e?.message ?? e}`
  }
  const stepMs = Date.now() - t0

  const fireId: string | null = typeof body?.invocationId === 'string' && body.invocationId.length > 0 ? body.invocationId : null
  const committed = fatal ? 0 : await daysNoLongerOwedThisStep(clientId, vendor, stepStartedAt, fireId)
  const inst = body?.instrument ?? {}
  // ⛔ AT FLOOR = NOTHING OWED ON ANY LANE, AND ONLY A FIRE THAT SCANNED CAN SAY SO. All three slots must be empty
  // AND the instrument must exist: a held or refused fire answers without one, and its "no candidates" is silence,
  // not the floor (LORAMER_ZERO_ROWS_IS_NOT_EXHAUSTION_V1's class, measured on this run 2026-09-17 21:54Z).
  const scanned = body?.instrument != null && typeof body.instrument === 'object'
  const atFloor = !fatal && body?.ok === true && scanned
    && (inst.candidates ?? 0) === 0 && (inst.lookbackCandidates ?? 0) === 0 && (inst.missedCandidates ?? 0) === 0
  const out: StepOutcome = {
    requestsOpened: Number(inst.requestsSelected ?? 0),
    daysNoLongerOwed: committed < 0 ? 1 : committed,
    atFloor,
    held: heldFromFireBody(body),
    fatal,
  }

  let askingWithoutProgressMs: number | null = null
  try {
    const clock = await askingWithoutProgressSince({ clientId, vendor: ledgerVendorFor(vendor) }, run.started_at)
    askingWithoutProgressMs = clock.askingSince ? Math.max(0, Date.now() - Date.parse(clock.askingSince)) : null
  } catch (e: any) {
    console.error(`[universe-run] asking clock unreadable for ${clientId}: ${e?.message ?? e} — treating as no clock`)
  }
  const state: RunState = {
    status: run.status, steps: run.steps, stepsWithoutProgress: run.steps_without_progress,
    runElapsedMs: Math.max(0, Date.now() - Date.parse(run.started_at)),
    askingWithoutProgressMs,
  }
  const next = applyStep(state, out)
  const verdict = decideChain(state, out)

  // ⛔ COMPARE-AND-SET ON `steps`. If another pump advanced this run while we were stepping, our update matches zero
  // rows and we report casLost — two pumps cannot both drive one lane.
  // ⛔ A CHAINING STEP NEVER WRITES `status`. Writing the status it READ at its start back at its end erased an
  // operator's `stopping` that landed in between (measured 2026-09-17 20:37Z: `?action=stop` returned ok and the row
  // read `running` a second later). Only an ENDING step writes status, and it writes the verdict's.
  const { data: updated, error: updErr } = await supabaseAdmin.from('universe_run')
    .update({
      steps: next.steps,
      steps_without_progress: next.stepsWithoutProgress,
      requests_opened: run.requests_opened + out.requestsOpened,
      // ⚠ COLUMN NAME OUTLIVES ITS MEANING: `days_committed` holds DAYS NO LONGER OWED (migration 096 predates
      // LORAMER_RUN_PROGRESS_SIGNAL_V1); renaming it is a migration and is not this flight's.
      days_committed: run.days_committed + Math.max(0, committed),
      updated_at: new Date().toISOString(),
      last_step_at: new Date().toISOString(),
      last_invocation: null, // the claim is released: the lane is free the moment the step ends
      ...(verdict.chain ? {} : { status: verdict.status, finished_at: new Date().toISOString(), stop_reason: verdict.reason }),
    })
    .eq('client_id', clientId).eq('vendor', vendor).eq('steps', run.steps)
    .select('steps')
  if (updErr) {
    return { ...base, step: run.steps, stepMs, chained: false, status: 'failed', reason: `run row update failed: ${updErr.message}`, casLost: false }
  }
  if (!updated || updated.length === 0) {
    return { ...base, step: run.steps, stepMs, chained: false, status: run.status, reason: 'another chain advanced this run — exiting rather than racing it', casLost: true }
  }

  log(`[universe-run] ${clientId}/${vendor} step ${next.steps}: ${stepMs}ms · scan ${inst.scanMs ?? '?'}ms · retired ${committed} owed day(s) · opened ${out.requestsOpened} · ${verdict.chain ? 'CHAINING' : `ENDED (${verdict.status})`} — ${verdict.reason}`)
  return {
    step: next.steps, stepMs, scanMs: inst.scanMs ?? null, daysNoLongerOwed: committed, requestsOpened: out.requestsOpened, atFloor,
    chained: verdict.chain, status: verdict.chain ? run.status : verdict.status, reason: verdict.reason, casLost: false,
  }
}
