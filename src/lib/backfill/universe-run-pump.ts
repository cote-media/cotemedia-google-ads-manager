// LORAMER_RUN_PUMP_V1 — THE LOOP THAT STEPS A RUN INSIDE ONE INVOCATION. PURE: the step, the clock and the deadline
// are injected, so the loop's four exits are provable without a fire, a database or a platform.
//
// ⛔ WHY A PUMP AND NOT A SELF-KICK — measured 2026-09-17 (round 9). The first continuous run chained by having each
// step fetch its own route through waitUntil(fetch(same deployment)). Vercel's loop detector refused the FOURTH hop
// with HTTP 508 INFINITE_LOOP_DETECTED: `x-vercel-id` "contains a list of Vercel regions your request hit … It also
// allows Vercel to automatically prevent infinite loops" (docs/headers/request-headers); the error page names "an
// infinite number of requests to itself" and publishes NO threshold; a community case (thread 37450) died at the
// same fourth hop with minutes between hops. Spacing hops is tuning against an undocumented detector. A chain of
// self-requests can therefore never be deeper than ~3 on this platform and can never reach a floor.
//
// THE SHAPE THAT SURVIVES IT: the platform's cron invokes the pump (depth 0); the pump claims ONE active lane and runs
// step after step inside its own invocation — each step's only outbound call is the fire (depth 1, the shape the
// forward driver has always used) — with NO delay between steps, until the run ends, another pump wins the lane's
// compare-and-set, or the invocation's deadline reserve is reached; the next minute's cron invocation resumes.
// The step gap inside an invocation is the fire's own duration; the gap between invocations is at most the cron
// minute (Pro: "Minimum interval: once per minute · Scheduling precision: per-minute").
//
// ⛔ THE RESERVE IS DERIVED, NOT CHOSEN: a step awaits a fire whose own ceiling is CONSUMER_MAX_DURATION_S (300 s), so
// the pump must not start a step it cannot finish before its deadline. Reserve = that ceiling + a margin; the route
// passes it. With maxDuration 800 that leaves ~480 s of stepping per invocation — measured fires run 40–100 s, so
// 5–12 steps per invocation, then a ≤60 s gap. That gap is the cost of not requesting our own deployment.
//
// ⛔ AND THE PUMP DOES NOT DECIDE ANYTHING ABOUT THE RUN. Progress, holds, the time-based stop limits, fatal and the
// floor are the step's (continuous-run.ts decideChain, universe-run-step.ts); the pump only asks "did the step chain?"
// and "is there time for another?". A shape that re-decided the run here would be a second owner of the chain rule.

export type PumpStepResult = {
  /** True when the step's chain rule said another step follows. */
  chained: boolean
  /** The run's status after the step (running while chaining; done/failed/stopping when ended). */
  status: 'running' | 'stopping' | 'done' | 'failed'
  /** The chain rule's reason, verbatim — a fatal or a stop limit carries out of the loop unchanged. */
  reason: string
  /** True when the step lost the compare-and-set on the run row: another pump owns this lane. */
  casLost: boolean
}

export type PumpDeps = {
  /** Run ONE step of the claimed lane (the fire fetch + the chain rule + the CAS write). Never throws. */
  step: () => Promise<PumpStepResult>
  /** Wall clock in ms — injected so the loop is provable with a fake clock. */
  now: () => number
  /** Absolute deadline in ms on the same clock: the invocation's own kill time. */
  deadlineMs: number
  /** How much time a step may need — no step starts unless now + reserve <= deadline. */
  reserveMs: number
  log?: (line: string) => void
}

export type PumpOutcome = {
  steps: number
  stoppedBecause: 'deadline' | 'run-ended' | 'cas-lost'
  status: 'running' | 'stopping' | 'done' | 'failed'
  reason: string
}

export async function pumpLane(deps: PumpDeps): Promise<PumpOutcome> {
  const log = deps.log ?? (() => {})
  let steps = 0
  let last: PumpStepResult | null = null
  while (deps.now() + deps.reserveMs <= deps.deadlineMs) {
    // ⛔ NO DELAY. The next step starts the moment the last one returns.
    last = await deps.step()
    steps++
    if (last.casLost) {
      log(`[universe-run-pump] step ${steps}: another pump owns this lane — exiting rather than racing it`)
      return { steps, stoppedBecause: 'cas-lost', status: last.status, reason: last.reason }
    }
    if (!last.chained) {
      log(`[universe-run-pump] step ${steps}: run ended (${last.status}) — ${last.reason}`)
      return { steps, stoppedBecause: 'run-ended', status: last.status, reason: last.reason }
    }
  }
  log(`[universe-run-pump] ${steps} step(s) this invocation; deadline reserve reached — the next cron minute resumes`)
  return { steps, stoppedBecause: 'deadline', status: last?.status ?? 'running', reason: last?.reason ?? 'no step ran: the invocation had less than one reserve of time left' }
}
