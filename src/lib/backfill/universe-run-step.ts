// LORAMER_CONTINUOUS_RUN_V1 / LORAMER_RUN_PUMP_V1 — ONE STEP OF A RUN, AS A FUNCTION. The route used to hold this inline
// and kick itself for the next step; the pump (universe-run-pump.ts) now calls it in a loop inside one invocation, and
// the route keeps a single-step action for an operator. Nothing here requests our own deployment except THE FIRE, which
// is the existing `/api/cron/universe-resume` (depth 1 — the same call the driver and the button have always made).
//
// ⛔ PROGRESS IS DAYS NO LONGER OWED, COUNTED FROM `universe_attempt_log` under the LEDGER's spelling of the vendor
// (ledgerVendorFor), NOT from the step's own report — LORAMER_RUN_PROGRESS_SIGNAL_V1. A hold is only what the fire
// calls a hold (heldFromFireBody). The stop limits are time (LORAMER_RUN_STOP_LIMITS_ARE_TIME_V1): the ceiling from the
// run row's started_at, the asking clock from the ledger.
//
// ⛔ ONE RUN PER LANE, ENFORCED TWICE. The fire lease stops two FIRES of a lane overlapping; the compare-and-set on the
// run's step counter stops two PUMPS from both advancing one run — the loser reports casLost and its pump exits.
import { supabaseAdmin } from '@/lib/supabase'
import { decideChain, applyStep, heldFromFireBody, type StepOutcome, type RunState } from '@/lib/backfill/continuous-run'
import { daysNoLongerOwedSince, askingWithoutProgressSince } from '@/lib/backfill/universe-coverage'
import { ledgerVendorFor } from '@/lib/backfill/universe-vendor-spelling'
import type { PumpStepResult } from '@/lib/backfill/universe-run-pump'

export type RunRow = {
  status: 'running' | 'stopping' | 'done' | 'failed'
  started_at: string
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
async function daysNoLongerOwedThisStep(clientId: string, vendor: string, sinceIso: string): Promise<number> {
  try {
    return await daysNoLongerOwedSince({ clientId, vendor: ledgerVendorFor(vendor) }, sinceIso)
  } catch (e: any) {
    console.error(`[universe-run] progress unreadable for ${clientId}: ${e?.message ?? e}`)
    return -1
  }
}

/**
 * Run one step of the lane's run. Never throws. `origin` + `secret` are how the fire is reached (the existing
 * CRON_SECRET kick); the fire's own lease refuses a second fire of the lane while one runs.
 */
export async function runOneStep(a: { clientId: string; vendor: string; origin: string; secret: string; log?: (s: string) => void }): Promise<StepReport> {
  const log = a.log ?? ((l: string) => console.log(l))
  const { clientId, vendor } = a
  const base: Omit<StepReport, 'chained' | 'status' | 'reason' | 'casLost'> = {
    step: 0, stepMs: 0, scanMs: null, daysNoLongerOwed: 0, requestsOpened: 0, atFloor: false,
  }
  const { data: row, error: rowErr } = await supabaseAdmin.from('universe_run')
    .select('status, started_at, steps, requests_opened, days_committed, steps_without_progress')
    .eq('client_id', clientId).eq('vendor', vendor).maybeSingle()
  const run = row as RunRow | null
  if (rowErr || !run) {
    return { ...base, chained: false, status: 'failed', reason: rowErr ? `run row unreadable: ${rowErr.message}` : 'no run for this lane', casLost: false, noRun: !rowErr }
  }
  if (run.status === 'done' || run.status === 'failed') {
    return { ...base, step: run.steps, chained: false, status: run.status, reason: `run is already ${run.status}`, casLost: false }
  }

  const stepStartedAt = new Date().toISOString()
  const t0 = Date.now()
  const invocation = `${t0}-${Math.random().toString(36).slice(2, 8)}`

  // THE STEP IS THE EXISTING FIRE, UNCHANGED — the one outbound request, depth 1.
  let body: any = null
  let fatal: string | null = null
  try {
    const r = await fetch(`${a.origin}/api/cron/universe-resume?clientId=${encodeURIComponent(clientId)}&dryRun=0`,
      { headers: { Authorization: `Bearer ${a.secret}` } })
    body = await r.json().catch(() => null)
    if (!r.ok) fatal = `step returned HTTP ${r.status}: ${JSON.stringify(body).slice(0, 200)}`
  } catch (e: any) {
    fatal = `step threw: ${e?.message ?? e}`
  }
  const stepMs = Date.now() - t0

  const committed = fatal ? 0 : await daysNoLongerOwedThisStep(clientId, vendor, stepStartedAt)
  const inst = body?.instrument ?? {}
  // ⛔ AT FLOOR = NOTHING OWED ON ANY LANE. All three slots must be empty; one empty slot is a lane that had
  // nothing this step, which is not the same as a lane with nothing left.
  const atFloor = !fatal && body?.ok === true
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
  const { data: updated, error: updErr } = await supabaseAdmin.from('universe_run')
    .update({
      status: verdict.chain ? run.status : verdict.status,
      steps: next.steps,
      steps_without_progress: next.stepsWithoutProgress,
      requests_opened: run.requests_opened + out.requestsOpened,
      // ⚠ COLUMN NAME OUTLIVES ITS MEANING: `days_committed` holds DAYS NO LONGER OWED (migration 096 predates
      // LORAMER_RUN_PROGRESS_SIGNAL_V1); renaming it is a migration and is not this flight's.
      days_committed: run.days_committed + Math.max(0, committed),
      updated_at: new Date().toISOString(),
      last_step_at: new Date().toISOString(),
      last_invocation: invocation,
      ...(verdict.chain ? {} : { finished_at: new Date().toISOString(), stop_reason: verdict.reason }),
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
