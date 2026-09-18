// LORAMER_IDLE_SKIP_V1 — AN IDLE WINDOW RETIRES ACROSS EVERY SURFACE FOR ONE REQUEST, AND ONLY ON GOOGLE'S OWN ANSWER.
//
// ⛔ THE WASTE THIS REMOVES (measured 2026-09-17 23:13–00:27Z, Tri-Copy): 840 descend requests, every one 'zero' —
// the account had been idle since 2025-10-21 and the walk asked all 349 surfaces about every idle window anyway.
// One account-level question per window answers it for all of them.
//
// ⛔ CORRECTNESS FIRST — AN IDLE VERDICT RESTS ON AN ANSWER, NEVER ON AN ABSENCE. The account query selects
// segments.date with a broad metric set on the `customer` resource; Google returns a row for every day on which
// ANY selected metric was nonzero and omits the rest ("Rows whose selected metrics are all zero won't be returned",
// developers.google.com/google-ads/api/docs/reporting/zero-metrics). A successful answer therefore NAMES the active
// days. A day named active is never idle. A failed, refused or missing answer yields NO verdict, and the window walks
// surface by surface exactly as before — the skip can only ever remove requests, never facts.
// ⛔ PAST THE RETENTION WALL an empty account answer has the same ambiguity as any other empty (retention-wall.ts),
// so no idle verdict is issued there unless the canary is green.
// ⛔ A MIXED WINDOW IS NEVER SKIPPED. Splitting the surfaces' request to the active range would save no operation
// (one request per surface either way) and would double the ledger, so a mixed window walks whole; the verdict still
// names the active range and the idle days so the fire's log says what was seen.
import type { CanaryState } from '@/lib/backfill/retention-wall'
import { isPastWall } from '@/lib/backfill/retention-wall'

/** The synthetic ledger resource the account-level request is charged under. Collides with no catalog surface. */
export const ACCOUNT_ACTIVITY_RESOURCE = '__account_activity'
/** The marker on a surface's 0-request 'zero' row retired by the account answer. */
export const IDLE_ATTESTED_MARKER = 'IDLE_ATTESTED_BY_ACCOUNT'
/** Account-level activity requests per fire. Each is one operation; each can retire up to every candidate in its window. */
export const IDLE_CHECKS_PER_FIRE = 4

/**
 * ⛔ THE METRIC SET IS BROAD ON PURPOSE. Spend alone would miss a day with conversions and no spend (view-through,
 * late-attributed); impressions alone would miss engagement on a paused campaign. Every metric here is legal on the
 * customer resource with segments.date (proven live 2026-09-18: 12 rows for 2025-10-10..25). `metrics.video_views`
 * is NOT legal there (query_error 32, same probe) and is deliberately absent.
 */
export const ACTIVITY_METRICS = [
  'metrics.cost_micros', 'metrics.impressions', 'metrics.clicks', 'metrics.conversions', 'metrics.conversions_value',
  'metrics.all_conversions', 'metrics.interactions', 'metrics.view_through_conversions', 'metrics.engagements',
] as const

export function activityGaql(windowStart: string, windowEnd: string): string {
  return `SELECT segments.date, ${ACTIVITY_METRICS.join(', ')} FROM customer WHERE segments.date BETWEEN '${windowStart}' AND '${windowEnd}'`
}

export type ActivityAnswer = { ok: true; activeDays: string[] } | { ok: false; error: string }

export type IdleVerdict =
  | { kind: 'unknown'; reason: string }
  | { kind: 'idle'; reason: string }
  | { kind: 'active'; activeStart: string; activeEnd: string; activeDays: number; idleDays: number; reason: string }

/**
 * Pure. The only function that may say 'idle', and it can say it only from a SUCCESSFUL answer that names no day
 * inside the window. Days the answer names are never idle, wherever they fall.
 */
export function idleVerdict(a: { windowStart: string; windowEnd: string; wallLine: string; canary: CanaryState; answer: ActivityAnswer }): IdleVerdict {
  if (!a.answer.ok) return { kind: 'unknown', reason: `account activity unanswered — ${a.answer.error}; the window walks surface by surface` }
  if (isPastWall(a.windowEnd, a.wallLine) && a.canary !== 'served') {
    return { kind: 'unknown', reason: `window ${a.windowStart}..${a.windowEnd} is past the retention wall ${a.wallLine} and the canary reads ${a.canary} — an empty account answer there cannot be told from expiry; no idle verdict` }
  }
  const inWindow = [...new Set(a.answer.activeDays)].filter((d) => d >= a.windowStart && d <= a.windowEnd).sort()
  if (inWindow.length === 0) {
    return { kind: 'idle', reason: `Google answered and named no active day in ${a.windowStart}..${a.windowEnd} (${ACTIVITY_METRICS.length} metrics, customer level)` }
  }
  const span = dayCount(a.windowStart, a.windowEnd)
  return {
    kind: 'active', activeStart: inWindow[0], activeEnd: inWindow[inWindow.length - 1], activeDays: inWindow.length, idleDays: span - inWindow.length,
    reason: `Google named ${inWindow.length} active day(s) ${inWindow[0]}..${inWindow[inWindow.length - 1]} in ${a.windowStart}..${a.windowEnd} — the window walks whole (a mixed window is never skipped)`,
  }
}

function dayCount(a: string, b: string): number {
  return Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86_400_000) + 1
}

/** Read the account's active days for a window through the injected stream. Never throws: a failure is an answer of kind ok:false. */
export async function askAccountActivity(stream: (gaql: string) => AsyncGenerator<any>, windowStart: string, windowEnd: string): Promise<ActivityAnswer> {
  const days = new Set<string>()
  try {
    for await (const row of stream(activityGaql(windowStart, windowEnd))) {
      const d = row?.segments?.date
      if (typeof d === 'string' && d.length >= 10) days.add(d.slice(0, 10))
    }
    return { ok: true, activeDays: [...days].sort() }
  } catch (e: any) {
    const err = e?.errors?.[0]
    const text = `${JSON.stringify(err?.error_code ?? err?.errorCode ?? {})} ${err?.message ?? e?.message ?? String(e)}`.slice(0, 400)
    return { ok: false, error: text }
  }
}

// ── THE PER-FIRE MEMO — ONE ACCOUNT REQUEST PER WINDOW, SHARED BY EVERY UNIT OF THAT WINDOW ─────────────────────────
/**
 * ⛔ THE FIRE ROUTE MAY NOT FETCH (universe-resumer.guard.mjs: "a scheduler that fetches is a scheduler that can spend
 * without a message ever being counted"), so the account request is made INSIDE the worker, by the first unit that
 * reaches a window, and memoised here for the units that follow — the memo carries no stream and no client; the worker
 * hands its own injected stream in at call time. Units run concurrently (twelve wide), so the memo stores the PROMISE:
 * the first caller creates it, the rest await it, and the window is asked exactly once per fire.
 * ⛔ BOUNDED: after IDLE_CHECKS_PER_FIRE distinct windows, every further window reads 'unknown' and walks as before.
 */
export interface IdleMemoStats { windowsAsked: number; requestsSpent: number; idle: number; active: number; unknown: number; surfacesRetired: number; daysRetired: number }
export interface IdleMemo {
  verdictFor(a: {
    windowStart: string; windowEnd: string
    stream: (gaql: string) => AsyncGenerator<any>
    /** Charges the one request under ACCOUNT_ACTIVITY_RESOURCE and records its answer. Never throws. */
    ledger: (window: { windowStart: string; windowEnd: string }, answer: ActivityAnswer) => Promise<void>
  }): Promise<IdleVerdict>
  noteRetired(surfaces: number, days: number): void
  readonly stats: IdleMemoStats
}

export function createIdleMemo(a: { wallLine: string; canary: CanaryState; maxWindows?: number }): IdleMemo {
  const max = a.maxWindows ?? IDLE_CHECKS_PER_FIRE
  const memo = new Map<string, Promise<IdleVerdict>>()
  const stats: IdleMemoStats = { windowsAsked: 0, requestsSpent: 0, idle: 0, active: 0, unknown: 0, surfacesRetired: 0, daysRetired: 0 }
  return {
    stats,
    noteRetired(surfaces, days) { stats.surfacesRetired += surfaces; stats.daysRetired += days },
    verdictFor(q) {
      const key = `${q.windowStart}..${q.windowEnd}`
      const have = memo.get(key)
      if (have) return have
      if (memo.size >= max) {
        stats.unknown++
        return Promise.resolve<IdleVerdict>({ kind: 'unknown', reason: `idle-check budget spent (${max} window(s) this fire) — ${key} walks surface by surface` })
      }
      const p = (async (): Promise<IdleVerdict> => {
        stats.windowsAsked++; stats.requestsSpent++
        const answer = await askAccountActivity(q.stream, q.windowStart, q.windowEnd)
        await q.ledger({ windowStart: q.windowStart, windowEnd: q.windowEnd }, answer)
        const v = idleVerdict({ windowStart: q.windowStart, windowEnd: q.windowEnd, wallLine: a.wallLine, canary: a.canary, answer })
        if (v.kind === 'idle') stats.idle++; else if (v.kind === 'active') stats.active++; else stats.unknown++
        return v
      })()
      memo.set(key, p)
      return p
    },
  }
}
