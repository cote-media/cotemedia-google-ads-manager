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
  /**
   * Days NO LONGER OWED after this step — committed with rows, or attested empty by an attesting lane. THE progress
   * signal (LORAMER_MAP §7: "days no longer owed, never rows written and never requests spent") — not rows, not
   * published, not "it returned 200", and not days-with-rows either: the first run counted those and read 0 on a
   * lane that retired 204 dormant windows (LORAMER_RUN_PROGRESS_SIGNAL_V1).
   */
  daysNoLongerOwed: number
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
  /** Consecutive steps that ASKED and retired nothing — informational (the universe_run column); the stop is time. */
  stepsWithoutProgress: number
  /** Wall time since the run started. THE CEILING is measured on this, never on `steps`. */
  runElapsedMs: number
  /**
   * Wall time since the first unanswered ask after the run's last progress, derived from the attempt ledger
   * (universe-coverage.ts askingWithoutProgressSince) — null when there is no unanswered ask. A hold opens no
   * attempt, so held time before the first ask never starts this clock (LORAMER_RUN_STOP_LIMITS_ARE_TIME_V1).
   */
  askingWithoutProgressMs: number | null
}

export type ChainVerdict =
  | { chain: true; reason: string }
  | { chain: false; status: 'done' | 'failed'; reason: string }

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────
// THE END KIND — LORAMER_RUN_END_KIND_V1 (flight 2, 2026-09-18)
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────
// ⛔ 'done' IS TWO THINGS: the floor arrival and the operator stop. A press after the operator stopped the run should
// continue the descent; a press after the floor must not start one (MAP §7: "when it is done, it is done"; forward
// capture and the rotation own the future). The two 'done' reasons therefore live HERE as constants — decideChain
// returns them, endKindOf reads them — so the reason a customer sees and the kind a press is judged by cannot drift.
export type RunEndKind = 'floor' | 'stopped' | 'failed'
export const RUN_END_REASON = {
  floor: 'the lane reached its floor — nothing is owed above inception',
  stopped: 'operator asked the run to stop; the step that was already running finished rather than being killed mid-work',
} as const
/**
 * PURE. null = the row is not ended (no finished_at, or a live status). 'floor' ONLY for the exact floor reason;
 * any other 'done' is 'stopped' (the safe kind: a press may continue); status 'failed' is 'failed'.
 */
export function endKindOf(row: { status: string; stopReason: string | null | undefined; finishedAt: string | null | undefined }): RunEndKind | null {
  if (!row.finishedAt) return null
  if (row.status === 'failed') return 'failed'
  if (row.status !== 'done') return null
  return row.stopReason === RUN_END_REASON.floor ? 'floor' : 'stopped'
}

/**
 * LORAMER_STATUS_RUN_FIELDS_V1 — THE STALL RULE. The pump ticks every minute (vercel.json) and a dead claim expires after
 * STEP_RESERVE_MS 320 s, so ten minutes with no step is at least ten ticks and three claim windows: the pump is not
 * running. Derived in the view from the row's own clocks; never written to the row (no new status exists).
 */
export const RUN_STALL_MINUTES = 10

export interface RunRowLike {
  status: string
  steps: number
  requests_opened: number
  days_committed: number
  started_at: string
  last_step_at: string | null
  finished_at: string | null
  stop_reason: string | null
  last_invocation?: string | null
}
export interface RunView {
  status: string; steps: number; requestsOpened: number
  /** The run's own days no longer owed (universe_run.days_committed) — named for what it measures, never 'committed'. */
  daysNoLongerOwed: number
  startedAt: string; lastStepAt: string | null; finishedAt: string | null; stopReason: string | null
  endKind: RunEndKind | null
  /** running or stopping with no finished_at. ⛔ finished_at WINS over a stale last_invocation left on an ended row. */
  live: boolean
  /** live ∧ max(last_step_at, started_at) older than RUN_STALL_MINUTES. */
  stalled: boolean
  stalledForMinutes: number | null
}
/** PURE. The customer-facing view of one run row. null row → null. */
export function runView(row: RunRowLike | null | undefined, nowMs: number): RunView | null {
  if (!row) return null
  const live = !row.finished_at && (row.status === 'running' || row.status === 'stopping')
  const lastClock = Date.parse(row.last_step_at ?? row.started_at)
  const idleMin = Number.isFinite(lastClock) ? (nowMs - lastClock) / 60_000 : null
  const stalled = live && idleMin !== null && idleMin > RUN_STALL_MINUTES
  return {
    status: row.status, steps: row.steps, requestsOpened: row.requests_opened, daysNoLongerOwed: row.days_committed,
    startedAt: row.started_at, lastStepAt: row.last_step_at, finishedAt: row.finished_at, stopReason: row.stop_reason,
    endKind: endKindOf({ status: row.status, stopReason: row.stop_reason, finishedAt: row.finished_at }),
    live, stalled, stalledForMinutes: stalled && idleMin !== null ? Math.floor(idleMin) : null,
  }
}

/**
 * ⛔ THE NO-PROGRESS STOP IS A WINDOW OF TIME SPENT ASKING — LORAMER_RUN_STOP_LIMITS_ARE_TIME_V1 (Russ, 2026-09-17).
 * The first cut was a STEP COUNT, MAX_STEPS_WITHOUT_PROGRESS = 3, and its own derivation priced it in time:
 *   "MEASURED on the shipped rotation (24 h, 287 fires): every wet fire committed days, so a single no-progress
 *    step is already abnormal. THREE is chosen as the smallest bound that tolerates a transient vendor refusal
 *    on two consecutive surfaces without letting a genuine loop run: at ~90 s/step a runaway costs at most
 *    ~4.5 minutes before it is ended, against the ~85 minutes the rotation used to take to notice nothing."
 * The chain then measured 2 s/step, and three steps became SIX SECONDS of tolerance — one vendor hiccup would end
 * a healthy run as failed. The tolerance the derivation actually chose was 3 × 90 s; that is the constant, in
 * the unit it was always about. A step count is the adjacent number.
 * ⛔ WHAT COUNTS: only a step that OPENED requests and retired no owed days. A held step never counts (a hold
 * clears on its own and opens no attempt); a step that asked nothing never counts. The clock runs from the first
 * unanswered ask after the last progress, read from the ledger, so held time before the ask is not charged.
 * ⚠ THE RESIDUAL, STATED: a lane whose every step asks nothing and is not held (candidates offered, every unit
 * deferred for bound) never trips this window; only the ceiling below ends it.
 */
export const NO_PROGRESS_WINDOW_MS = 270_000

/**
 * ⛔ AN ABSOLUTE CEILING ON A RUN'S ELAPSED TIME, so a defect in the stop conditions cannot spend forever.
 * The first cut was MAX_STEPS_PER_RUN = 2,000, and its derivation priced it in time too:
 *   "DERIVED from the measurement this flight exists to fix: a client's deepest floor was 32.7 days at ~17
 *    fires/day = ~556 fires. 2,000 is that worst case with ~3.6x headroom, and at ~90 s/step it is ~50 hours —
 *    longer than any measured client needs and short enough that a runaway is bounded by a number rather than
 *    by someone noticing."
 * At 2 s/step, 2,000 steps is 67 minutes — a run to the floor would hit the SAFETY BOUND and end as failed
 * while gaining ground. 2,000 × 90 s = 50 hours is the ceiling that was chosen; it is kept as elapsed time.
 * A run that hits it ends as `failed`, never silently as `done`: reaching a safety bound is not an arrival.
 */
export const RUN_CEILING_MS = 180_000_000

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
    // ⛔ A STOPPED RUN ENDS TERMINAL. It used to end as 'stopping' with finished_at set — a status the pump's picker
    // still selects and the step still advances, so a stopped run was re-fired every ~6 minutes forever (measured
    // 2026-09-18 00:26Z, closed by hand at 00:29Z). 'done' is terminal; the reason says it was an operator's stop.
    return { chain: false, status: 'done', reason: RUN_END_REASON.stopped }
  }
  // ⛔ A HELD STEP IS NEVER THE FLOOR. Decided before atFloor on purpose: a lease-held or quota-held fire answers with
  // no instrument, and "no candidates" from a fire that did not scan is not "nothing owed" (measured 2026-09-17 21:54Z:
  // the second pump on a lane read its lease-held answer as the floor and ended a run that had 60 candidates).
  if (out.held) return { chain: true, reason: `held: ${out.held} — a hold clears on its own; not counted as no progress` }
  if (out.atFloor) {
    return { chain: false, status: 'done', reason: RUN_END_REASON.floor }
  }
  if (state.runElapsedMs >= RUN_CEILING_MS) {
    return { chain: false, status: 'failed', reason: `hit RUN_CEILING_MS (${RUN_CEILING_MS} ms elapsed, ${state.steps} steps). This is a SAFETY BOUND, not an arrival — the lane still owes ground and the stop conditions did not fire.` }
  }
  if (out.daysNoLongerOwed > 0) {
    return { chain: true, reason: `retired ${out.daysNoLongerOwed} owed day(s), ${out.requestsOpened} request(s) opened` }
  }
  // ⛔ A HELD STEP STILL CHAINS AND NEVER COUNTS. A quota or meter hold is a condition that CLEARS on its own,
  // and the next step re-reads it; ending the run would turn a pause into an abandonment the button would then
  // report as finished. It opens no attempt, so it does not start the asking clock either.
  if (out.requestsOpened <= 0) return { chain: true, reason: 'nothing asked this step (no requests opened) — not counted as no progress' }
  // A step that ASKED and retired nothing: the clock is how long the lane has been asking since its last progress.
  const asking = state.askingWithoutProgressMs ?? 0
  if (asking >= NO_PROGRESS_WINDOW_MS) {
    return {
      chain: false, status: 'failed',
      reason: `retired no owed days for ${Math.round(asking / 1000)} s of asking (window ${NO_PROGRESS_WINDOW_MS} ms, ${state.stepsWithoutProgress + 1} asking step(s)) and the lane is NOT at its floor. Ground was offered and not taken — ending rather than spinning.`,
    }
  }
  return { chain: true, reason: `no owed days retired (asking ${Math.round(asking / 1000)} s of ${NO_PROGRESS_WINDOW_MS / 1000} s window)` }
}

/** Fold a step's outcome into the run's counters. Pure, so the counters cannot drift from the rule above. */
export function applyStep(state: RunState, out: StepOutcome): RunState {
  const counted = out.daysNoLongerOwed <= 0 && !out.held && out.requestsOpened > 0
  return {
    ...state,
    steps: state.steps + 1,
    // progress resets the streak; a counted no-progress step extends it; a held or ask-nothing step leaves it alone
    stepsWithoutProgress: out.daysNoLongerOwed > 0 ? 0 : counted ? state.stepsWithoutProgress + 1 : state.stepsWithoutProgress,
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

/**
 * LORAMER_RUN_PROGRESS_SIGNAL_V1 — A HOLD IS WHAT THE FIRE SAYS IS A HOLD, NEVER ITS METER LINE.
 * The fire returns `held: <reason>` only on a held or refused fire (lease held, quota paused, rotation unreadable,
 * meter held). Its `meter` field is the budget line and is present on EVERY completed fire; the first cut read
 * `body.held ?? body.meter`, so every healthy step reported "held: google: 19103 + 68 …" and the run's stop
 * reason blamed a hold that never existed. Pure, so the rule is provable without a fire.
 */
/**
 * LORAMER_FIRE_PLANS_UNTIL_FULL_V1 — A LEASE-HELD ANSWER ENDS THE CHAIN. The fire answers `held: "FIRE LEASE HELD — …"`
 * when another fire owns the lane; a chain that keeps stepping on it spins at ~2 s per no-op (measured 2026-09-23:
 * 116 lease-held fire rows in five minutes while the other invocation's real fire ran). The step exits instead; the
 * next cron minute resumes when the lease is free. Pure.
 */
export function leaseHeldFromFireBody(body: unknown): boolean {
  const h = heldFromFireBody(body)
  return h !== null && /^FIRE LEASE HELD/.test(h)
}

export function heldFromFireBody(body: unknown): string | null {
  const h = (body as { held?: unknown } | null | undefined)?.held
  return typeof h === 'string' && h.length > 0 ? h : null
}

/**
 * LORAMER_RUN_PUMP_V1 — WHAT THE FIRE'S ANSWER MEANS. Pure. A fire that did not answer as the fire is FATAL, never
 * "nothing asked": on 2026-09-17 an SSO login page (HTTP 200, HTML) was read as a fire that opened no requests, and
 * 159 steps chained on it. The fire always returns a JSON object; anything else is not the fire.
 */
export function classifyFireAnswer(ok: boolean, status: number, body: unknown): string | null {
  if (!ok) return `step returned HTTP ${status}: ${JSON.stringify(body).slice(0, 200)}`
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    return `fire answered HTTP ${status} without a JSON object — this is not the fire (a redirect, a login page, or an empty body)`
  }
  return null
}
