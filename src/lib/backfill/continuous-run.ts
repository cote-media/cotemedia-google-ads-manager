// LORAMER_CONTINUOUS_RUN_V1 — A BACKFILL RUN THAT DOES NOT WAIT AND DOES NOT TAKE TURNS.
//
// ⛔ THE MEASURED PROBLEM, Round 8. A press buys ONE fire and the client then waits ~85 minutes for its next
// turn (17 fires/client/day, avg gap 85.3 min, worst 90.7). Each fire runs ~90 s of a 300 s ceiling, so the
// rest of every 5-minute slot is idle. The engine is not slow — it is STOPPED for most of the day.
//
// ⛔ WHY THIS IS NOT A VERCEL WORKFLOW, decided against the alternative rather than by default.
// Vercel Workflows is real, GA-documented, and installable (`npm i workflow`, 4.8.9) with 'use workflow' /
// 'use step' and durable state "for minutes to months without duration limits". It would work. It loses here
// on four counts, and the first is the one that decides it:
//   1. THE DURABILITY IT SELLS IS THE DURABILITY THIS ENGINE ALREADY HAS. A crash or deploy mid-run already
//      resumes without duplicating, because rows are written THEN the cursor advances, per unit, and the
//      conflict key makes a re-capture an UPDATE. Workflows would durably remember a position the warehouse
//      already knows better — coverage is DERIVED from metrics_daily, never from a cursor we kept.
//   2. IT WOULD BE A THIRD EXECUTION MODEL beside the retired v1 queue and the inline v2 fire, with ~193
//      guards written against the fire's shape and none against a workflow's.
//   3. IT IS A NEW DEPENDENCY AND A NEW PRODUCT SURFACE on a Pro plan, needing a `vercel.ts` entry and a
//      `/.well-known/workflow/v1/step` route, with its own billing we have never measured.
//   4. ITS PAUSE-FOR-MONTHS STRENGTH IS DEAD WEIGHT HERE. This run never waits on anything external; it is
//      continuous by definition. We would be paying for the one feature we do not use.
// ⇒ THE CHAIN IS THE SMALLER CORRECT THING: a step finishes and immediately starts the next, using the kick
//   pattern this repo already runs (`kickoffWalk`, CRON_SECRET, waitUntil) and the lease it already trusts.
//
// ⛔ AND IT IS NOT THE RETIRED QUEUE EITHER. LORAMER_QUEUE_REMOVED_INLINE_WALK_V1 removed the queue from the
// v2 walk deliberately; re-introducing it to chain steps would reverse a banked decision to solve a problem
// the decision did not cause.
//
// PURE BY CONSTRUCTION: every function here is input → output, no database and no network, so the chain rule,
// the stop conditions and the no-progress bound are provable without starting a run.

/** What one step reported back, as the orchestrator sees it. */
export type StepOutcome = {
  /** Vendor requests this step actually opened. Spend, not intent. */
  requestsOpened: number
  /** Days the step committed. THE progress signal — not rows, not published, not "it returned 200". */
  daysCommitted: number
  /** True when the lane has nothing left to ask for: the floor is reached or every surface is sealed. */
  atFloor: boolean
  /** Set when the step refused to work for a reason that will still hold next step (quota hold, meter held). */
  held: string | null
  /** Set when the step errored in a way the run should not retry blindly. */
  fatal: string | null
}

export type RunState = {
  status: 'running' | 'stopping' | 'done' | 'failed'
  steps: number
  stepsWithoutProgress: number
}

export type ChainVerdict =
  | { chain: true; reason: string }
  | { chain: false; status: 'done' | 'failed' | 'stopping'; reason: string }

/**
 * ⛔ HOW MANY CONSECUTIVE NO-PROGRESS STEPS END A RUN. DERIVED, and the derivation is the point rather than
 * the number: a step commits no days when (a) the lane is genuinely finished, (b) every candidate it was
 * offered was refused, or (c) it is held. (a) is caught by `atFloor` and (c) by `held`, so a no-progress step
 * that is NEITHER is case (b) — real ground offered and not taken.
 * MEASURED on the shipped rotation (24 h, 287 fires): every wet fire committed days, so a single no-progress
 * step is already abnormal. THREE is chosen as the smallest bound that tolerates a transient vendor refusal
 * on two consecutive surfaces without letting a genuine loop run: at ~90 s/step a runaway costs at most
 * ~4.5 minutes before it is ended, against the ~85 minutes the rotation used to take to notice nothing.
 * ⛔ THIS BOUND MATTERS MORE IN A CHAIN THAN IT EVER DID ON A CRON. The 5-minute wait used to hide a
 * no-progress loop behind its own slowness; a chain removes the wait, so the loop would spin as fast as the
 * engine can go. The bound is the thing that makes removing the wait safe.
 */
export const MAX_STEPS_WITHOUT_PROGRESS = 3

/**
 * ⛔ AN ABSOLUTE CEILING ON STEPS PER RUN, so a defect in the stop conditions cannot spend forever.
 * DERIVED from the measurement this flight exists to fix: a client's deepest floor was 32.7 days at ~17
 * fires/day = ~556 fires. 2,000 is that worst case with ~3.6x headroom, and at ~90 s/step it is ~50 hours —
 * longer than any measured client needs and short enough that a runaway is bounded by a number rather than by
 * someone noticing. A run that hits it ends as `failed`, never silently as `done`: reaching a safety bound is
 * not the same as arriving.
 */
export const MAX_STEPS_PER_RUN = 2_000

/**
 * THE CHAIN RULE. Given the run's state and what the step just reported, say whether another step follows.
 *
 * ⛔ ORDER IS SEMANTIC. `fatal` beats everything; an operator `stopping` is honoured before progress is
 * considered, so a stop request cannot be outvoted by the run doing well; `atFloor` is the only ending that
 * is `done`. Everything else that ends is `failed` WITH a reason, because a run that stops for an unnamed
 * cause is the silent-empty shape this repo refuses.
 */
export function decideChain(state: RunState, out: StepOutcome): ChainVerdict {
  if (out.fatal) return { chain: false, status: 'failed', reason: `step reported a fatal condition: ${out.fatal}` }
  if (state.status === 'stopping') {
    return { chain: false, status: 'stopping', reason: 'operator asked the run to stop; the step that was already running finished rather than being killed mid-work' }
  }
  if (out.atFloor) {
    return { chain: false, status: 'done', reason: 'the lane reached its floor — nothing is owed above inception' }
  }
  if (state.steps >= MAX_STEPS_PER_RUN) {
    return { chain: false, status: 'failed', reason: `hit MAX_STEPS_PER_RUN (${MAX_STEPS_PER_RUN}). This is a SAFETY BOUND, not an arrival — the lane still owes ground and the stop conditions did not fire.` }
  }
  // ⛔ A HELD STEP STILL CHAINS, AND THAT IS DELIBERATE. A quota or meter hold is a condition that CLEARS on
  // its own, and the next step re-reads it; ending the run would turn a pause into an abandonment the button
  // would then report as finished. It counts as no progress, so a hold that never clears still ends the run
  // through the bound below rather than spinning forever.
  if (out.daysCommitted <= 0) {
    const n = state.stepsWithoutProgress + 1
    if (n >= MAX_STEPS_WITHOUT_PROGRESS) {
      return {
        chain: false, status: 'failed',
        reason: `${n} consecutive steps committed no days${out.held ? ` (last held: ${out.held})` : ''} and the lane is NOT at its floor. Ground was offered and not taken — ending rather than spinning.`,
      }
    }
    return { chain: true, reason: `no days committed (${n}/${MAX_STEPS_WITHOUT_PROGRESS} without progress)${out.held ? ` — held: ${out.held}` : ''}` }
  }
  return { chain: true, reason: `committed ${out.daysCommitted} day(s), ${out.requestsOpened} request(s) opened` }
}

/** Fold a step's outcome into the run's counters. Pure, so the counters cannot drift from the rule above. */
export function applyStep(state: RunState, out: StepOutcome): RunState {
  return {
    status: state.status,
    steps: state.steps + 1,
    stepsWithoutProgress: out.daysCommitted > 0 ? 0 : state.stepsWithoutProgress + 1,
  }
}

/**
 * ⛔ THE RUN IS ADDRESSED BY (client, vendor) AND NOTHING ELSE. No platform name appears in this module, and
 * `continuous-run-is-platform-neutral.guard.mjs` fails the build if one does: the whole point of Round 1's
 * finding is that the core is neutral and only the ADAPTER knows which vendor it serves.
 */
export function runKey(clientId: string, vendor: string): string {
  return `${clientId}|${vendor}`
}
