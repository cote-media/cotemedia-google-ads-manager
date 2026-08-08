// LORAMER_LORA_MODEL_CHAIN_V1 — retry + model fallback for Anthropic 529 overloaded_error.
//
// WHY: 2026-07-25 18:30:45Z and 18:32:08Z, two live prod chat turns died with HTTP 500 carrying Anthropic
// 529 overloaded_error (request_ids req_011CdPFcK7YASK1v3srLyHG9 / req_011CdPFidXysvSNLvB3XJu2s). The SDK had
// ALREADY retried twice (its documented default maxRetries=2, which covers 408/409/429/5xx + connection errors),
// so ~33s of retrying was spent and still failed. Retrying harder on ONE model is not enough when that model's
// capacity is the thing that is gone — hence a model chain.
//
// THE BUDGET IS THE DESIGN CONSTRAINT. ChatLauncher aborts at 120s (LORAMER_CHAT_CLIENT_ABORT_V1). A chain that
// out-waits the client is worse than no chain: the user sees a timeout string while the server keeps burning
// tokens on a turn nobody will read. So this does NOT do fixed arithmetic over per-hop retry counts — attempt
// duration is not knowable in advance (a 529 can return in 200ms or hang). It enforces a WALL-CLOCK DEADLINE and
// checks remaining budget before every hop. When the budget runs out the remaining hops are DROPPED and named in
// the result, which is exactly the "drop the Sonnet hop rather than blow the budget" instruction, enforced by the
// clock instead of by hope.
//
// SCOPED TO OVERLOAD ONLY. A 4xx, an auth failure, a bad request, a tool bug — none of those fall through to
// another model, because another model would fail identically and we would have burned the budget to learn it.
// Only `overloaded_error` (and its 529 status) advances the chain.

export interface ModelAttempt {
  model: string
  overloaded: boolean
  requestId: string | null
  detail: string
  elapsedMs: number
}

export interface ChainResult<T> {
  value: T
  modelUsed: string
  /** true when a NON-primary model produced the answer — drives the user-visible provenance line. */
  fellBack: boolean
  attempts: ModelAttempt[]
  /** hops never tried because the wall-clock budget ran out; named so a report can say what was skipped. */
  droppedModels: string[]
}

export class AllModelsOverloadedError extends Error {
  attempts: ModelAttempt[]
  droppedModels: string[]
  constructor(attempts: ModelAttempt[], droppedModels: string[]) {
    super(`all models overloaded: ${attempts.map((a) => a.model).join(' → ')}`)
    this.name = 'AllModelsOverloadedError'
    this.attempts = attempts
    this.droppedModels = droppedModels
  }
}

// ── BUDGET ────────────────────────────────────────────────────────────────────────────────────────────────────
// 95s against ChatLauncher's 120s abort leaves ~25s of headroom for the intelligence fetch that runs BEFORE the
// model call, the tool-loop's DB reads, and the response write. Raising this without raising the client abort
// converts a fallback into a timeout, which is strictly worse — the two numbers move together or not at all.
// ⛔ THE ORDERING IS THE RULE. THE NUMBER IS ONLY A SYMPTOM.
//     server budget (380s)  <  client total (440s)  <  route maxDuration (500s)   [2026-08-05]
//     was:            200s  <               240s    <                    300s
// Raising ONE of these without the others is the defect, not the value. On 2026-07-27 the client timer
// was raised 120s -> 240s and THIS was left at 95s, so the server gave up on a real multi-tool question
// ("Do you think our prices are good?") after 95 seconds while the client waited four minutes. The turn
// 500'd with the SDK's "Request timed out", no answer was ever produced, and the user was shown a
// connection story. The header of this file already warned that "the two numbers move together or not
// at all" — the comment did not stop it, so tests/guards/chat-timer-ordering.guard.mjs now does.
// ⛔ RAISED 200s → 380s ON 2026-08-05 WITH THE OTHER TWO, AND I DID NOT PLAN TO — `chat-timer-ordering`
// CAUGHT IT. The flight was scoped as "two lines: client 240→440, route 300→500". Raising those two
// alone would have re-created the 2026-07-27 defect ONE LAYER IN: the chain would give up at 200s while
// the client waited 440s, so every turn between them dies with no answer and the user is shown a
// connection story for a turn the server abandoned on purpose. **THERE ARE THREE NUMBERS, NOT TWO**,
// and the guard written after that incident is the only reason this commit is not the incident again.
// 380s holds the same ~86% budget:client ratio the pair had before (200/240), and keeps 60s of headroom
// for the intelligence fetch that runs BEFORE the model call, the tool-loop's DB reads and the response
// write — the same headroom argument the 95s→200s move made, at the new scale.
export const CHAIN_BUDGET_MS = 380_000
// A hop needs enough runway to be worth starting. Below this we drop it rather than begin an attempt we expect the
// clock to kill mid-flight — a half-run hop costs tokens and returns nothing.
export const MIN_HOP_MS = 18_000
// Per-attempt ceiling, so one wedged request cannot eat the whole chain budget.
// ⛔ THIS is what actually threw on 2026-07-27, not the chain budget. The SDK is handed
// `timeout: min(PER_ATTEMPT_TIMEOUT_MS, remaining)`, so EVERY individual model call was capped at 45s.
// A multi-tool turn survives by making several calls each under the cap — which is why 78s and 125s
// turns had succeeded — but a single heavy reasoning call over 45s throws "Request timed out" and
// 500s the turn no matter how large the budget is. Raising the budget alone would NOT have fixed it.
// 120s per attempt, inside a 200s chain budget: one slow call can now finish, and two cannot overrun
// the budget unnoticed.
export const PER_ATTEMPT_TIMEOUT_MS = 120_000

// Retries PER HOP, on top of the attempt itself. The primary gets more budget than the fallbacks: it is the model
// we actually want, and a transient overload usually clears in seconds. Fallbacks get one retry — if a second
// model is also overloaded, spending the budget there instead of moving on is the wrong trade.
export const PRIMARY_MAX_RETRIES = 3
export const FALLBACK_MAX_RETRIES = 1

// ── CLASSIFIER ────────────────────────────────────────────────────────────────────────────────────────────────
// Reads the SDK's typed error surface, NOT err.message string-matching. `overloaded_error` is the documented
// retryable-overload type; 529 is its HTTP status. Both are checked because a transport-level failure can surface
// the status without the parsed body.
export function isOverloadedError(err: any): boolean {
  if (!err) return false
  if (err.status === 529) return true
  const t = err?.error?.error?.type ?? err?.error?.type
  return t === 'overloaded_error'
}

export function requestIdOf(err: any): string | null {
  return (err?.requestID as string) || (err?.request_id as string) || (err?.error?.request_id as string) || null
}

// ── THE CHAIN ─────────────────────────────────────────────────────────────────────────────────────────────────
// `run` receives the model to try and the per-request options (maxRetries + timeout) to hand the SDK, so the
// caller keeps ownership of what the request actually is; this module owns only WHICH model and HOW LONG.
// `nowMs` is injected so a Gate-A can drive the deadline deterministically instead of sleeping.
export async function runWithModelChain<T>(opts: {
  models: string[]
  run: (model: string, requestOptions: { maxRetries: number; timeout: number }) => Promise<T>
  onOverload?: (a: ModelAttempt) => void
  budgetMs?: number
  nowMs?: () => number
}): Promise<ChainResult<T>> {
  const now = opts.nowMs ?? (() => Date.now())
  const budget = opts.budgetMs ?? CHAIN_BUDGET_MS
  const started = now()
  const deadline = started + budget
  const attempts: ModelAttempt[] = []
  const models = opts.models.filter(Boolean)

  for (let i = 0; i < models.length; i++) {
    const model = models[i]
    const remaining = deadline - now()
    if (remaining < MIN_HOP_MS) {
      // Budget exhausted — every remaining hop is dropped, by the clock, not by a guess.
      return Promise.reject(new AllModelsOverloadedError(attempts, models.slice(i)))
    }
    const hopStart = now()
    try {
      const value = await opts.run(model, {
        maxRetries: i === 0 ? PRIMARY_MAX_RETRIES : FALLBACK_MAX_RETRIES,
        timeout: Math.min(PER_ATTEMPT_TIMEOUT_MS, remaining),
      })
      return { value, modelUsed: model, fellBack: i > 0, attempts, droppedModels: [] }
    } catch (err: any) {
      const overloaded = isOverloadedError(err)
      const attempt: ModelAttempt = {
        model,
        overloaded,
        requestId: requestIdOf(err),
        detail: String(err?.message ?? err).slice(0, 300),
        elapsedMs: now() - hopStart,
      }
      attempts.push(attempt)
      // NOT an overload → do not advance the chain. Another model fails the same way; surface the real error.
      if (!overloaded) throw err
      opts.onOverload?.(attempt)
    }
  }
  throw new AllModelsOverloadedError(attempts, [])
}

// ── PROVENANCE ────────────────────────────────────────────────────────────────────────────────────────────────
// Deterministic, code-authored, prepended to the answer — NOT an instruction asking the model to disclose its own
// identity. Which model answered is a FACT about the request, and per the determinism law a fact belongs in code:
// the model cannot forget it, soften it, or be argued out of it. It also means the PRIMARY path's prompt is
// byte-identical to before this change, so the eval baseline stays comparable.
// Same law as live-vs-captured (LORAMER_LIVE_VS_CAPTURED_ARE_TWO_SOURCES_V1): never silently substitute a source.
export function provenanceNote(modelUsed: string, primary: string): string {
  const label = modelUsed === 'claude-opus-4-8' ? 'Claude Opus 4.8' : modelUsed === 'claude-sonnet-4-6' ? 'Claude Sonnet 4.6' : modelUsed
  const extra = modelUsed === 'claude-sonnet-4-6'
    ? ' Sonnet is a lower-capability model than the one this account normally runs, so treat this answer as more provisional than usual and re-ask when the primary model is back.'
    : ''
  return `_Answered by **${label}** — the primary model (${primary}) was overloaded and this request fell back.${extra}_\n\n`
}
