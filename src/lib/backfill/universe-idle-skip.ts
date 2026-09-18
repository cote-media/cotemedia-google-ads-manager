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
// ⛔ PAST THE RETENTION WALL no idle verdict is issued at all (LORAMER_WALL_HOLD_NEVER_RETIRE_V1, Q6): silence there is
// not evidence, whatever the canary reads.
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
  // LORAMER_WALL_HOLD_NEVER_RETIRE_V1 (Q6, 2026-09-18): past the wall NO idle verdict is issued, whatever the canary —
  // silence there is not evidence. The window walks surface by surface and its empties are held unresolved.
  if (isPastWall(a.windowEnd, a.wallLine)) {
    return { kind: 'unknown', reason: `window ${a.windowStart}..${a.windowEnd} is past the retention wall ${a.wallLine} (canary ${a.canary}) — an empty account answer there is not evidence; no idle verdict (Q6)` }
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

// ── LORAMER_IDLE_REUSE_MONTH_V1 — AN ANSWER IS KEYED BY CALENDAR MONTH AND NEVER RE-ASKED IN A RUN ─────────────────────
// Measured 2026-09-18 (Tri-Copy): 49 checks bought 570 owed days; the memo was per WINDOW per FIRE, so 349 surfaces at
// their own windows rarely shared one, and the next fire asked the same months again. An 'active'/'idle' answer for a
// month never changes (★IDLE-CHECK-REUSES-ITS-ANSWERS): the ledger row carries the named days, the fire reads the prior
// rows once, and any window whose months are ALL answered is judged from them for zero requests.
/** 'YYYY-MM' for each calendar month the window touches, in order. Pure. */
export function monthsOf(windowStart: string, windowEnd: string): string[] {
  const out: string[] = []
  let y = Number(windowStart.slice(0, 4)), m = Number(windowStart.slice(5, 7))
  const endKey = windowEnd.slice(0, 7)
  for (let i = 0; i < 1200; i++) {
    const key = `${y}-${String(m).padStart(2, '0')}`
    out.push(key)
    if (key === endKey) break
    m++; if (m > 12) { m = 1; y++ }
  }
  return out
}
function monthBounds(key: string): { start: string; end: string } {
  const y = Number(key.slice(0, 4)), m = Number(key.slice(5, 7))
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate()
  return { start: `${key}-01`, end: `${key}-${String(last).padStart(2, '0')}` }
}
/** month 'YYYY-MM' → the active days Google named in it ([] = idle month). Only months an answer FULLY covers. */
export type PriorActivity = Map<string, string[]>
/** The days a ledger row's text names: `days=[2025-10-03,2025-10-20]` (written by the worker since 2026-09-18). null = not carried. */
export function namedDaysFromLedgerText(error: string | null | undefined): string[] | null {
  const m = String(error ?? '').match(/days=\[([^\]]*)\]/)
  if (!m) return null
  return m[1].split(',').map((d) => d.trim()).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d))
}
/**
 * Pure. Builds the reusable prior from finished __account_activity rows (newest first is fine; the first answer for a
 * month wins). A 'zero' row marks every month it fully covers idle; an 'ok' row marks the months it fully covers with
 * the days it names; an 'ok' row without named days (text from before 2026-09-18) is NOT reusable; a month only
 * partially inside the row's window is never marked — a partial answer cannot stand for the whole month.
 */
export function priorActivityFromLedger(rows: Array<{ window_start: string; window_end: string; outcome: string; error?: string | null }>): PriorActivity {
  const prior: PriorActivity = new Map()
  for (const r of rows) {
    const ws = String(r.window_start).slice(0, 10), we = String(r.window_end).slice(0, 10)
    let days: string[] | null
    if (r.outcome === 'zero') days = []
    else if (r.outcome === 'ok') { days = namedDaysFromLedgerText(r.error); if (days === null) continue }
    else continue
    for (const key of monthsOf(ws, we)) {
      const b = monthBounds(key)
      if (ws > b.start || we < b.end) continue // partially covered month — never reused
      if (!prior.has(key)) prior.set(key, days.filter((d) => d.slice(0, 7) === key).sort())
    }
  }
  return prior
}
/** The months of a window that `prior` answers; null when any month is unanswered (no partial synthesis). */
export function priorAnswerFor(prior: PriorActivity | undefined, windowStart: string, windowEnd: string): ActivityAnswer | null {
  if (!prior) return null
  const days: string[] = []
  for (const key of monthsOf(windowStart, windowEnd)) {
    const have = prior.get(key)
    if (!have) return null
    days.push(...have)
  }
  return { ok: true, activeDays: [...new Set(days)].sort() }
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
export interface IdleMemoStats { windowsAsked: number; requestsSpent: number; idle: number; active: number; unknown: number; surfacesRetired: number; daysRetired: number; reused: number }
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

export function createIdleMemo(a: { wallLine: string; canary: CanaryState; maxWindows?: number; prior?: PriorActivity }): IdleMemo {
  const max = a.maxWindows ?? IDLE_CHECKS_PER_FIRE
  const memo = new Map<string, Promise<IdleVerdict>>()
  // LORAMER_IDLE_REUSE_MONTH_V1 — the month-keyed prior: seeded from the ledger by the fire, grown by every live answer.
  const prior: PriorActivity = a.prior ?? new Map()
  const stats: IdleMemoStats = { windowsAsked: 0, requestsSpent: 0, idle: 0, active: 0, unknown: 0, surfacesRetired: 0, daysRetired: 0, reused: 0 }
  const learn = (windowStart: string, windowEnd: string, answer: ActivityAnswer) => {
    if (!answer.ok) return
    for (const key of monthsOf(windowStart, windowEnd)) {
      const b = monthBounds(key)
      if (windowStart > b.start || windowEnd < b.end) continue
      if (!prior.has(key)) prior.set(key, answer.activeDays.filter((d) => d.slice(0, 7) === key).sort())
    }
  }
  return {
    stats,
    noteRetired(surfaces, days) { stats.surfacesRetired += surfaces; stats.daysRetired += days },
    verdictFor(q) {
      const key = `${q.windowStart}..${q.windowEnd}`
      const have = memo.get(key)
      if (have) return have
      // ⛔ REUSE BEFORE ASKING: every month of the window already answered → judged from the prior, zero requests.
      const reused = priorAnswerFor(prior, q.windowStart, q.windowEnd)
      if (reused) {
        stats.reused++
        const v = idleVerdict({ windowStart: q.windowStart, windowEnd: q.windowEnd, wallLine: a.wallLine, canary: a.canary, answer: reused })
        if (v.kind === 'idle') stats.idle++; else if (v.kind === 'active') stats.active++; else stats.unknown++
        const p = Promise.resolve<IdleVerdict>({ ...v, reason: `${v.reason} [reused: every month of this window was already answered]` } as IdleVerdict)
        memo.set(key, p)
        return p
      }
      // The budget counts LIVE asks only — a reused answer costs nothing and must not spend it (LORAMER_IDLE_REUSE_MONTH_V1).
      if (stats.windowsAsked >= max) {
        stats.unknown++
        return Promise.resolve<IdleVerdict>({ kind: 'unknown', reason: `idle-check budget spent (${max} window(s) this fire) — ${key} walks surface by surface` })
      }
      const p = (async (): Promise<IdleVerdict> => {
        stats.windowsAsked++; stats.requestsSpent++
        const answer = await askAccountActivity(q.stream, q.windowStart, q.windowEnd)
        await q.ledger({ windowStart: q.windowStart, windowEnd: q.windowEnd }, answer)
        learn(q.windowStart, q.windowEnd, answer)
        const v = idleVerdict({ windowStart: q.windowStart, windowEnd: q.windowEnd, wallLine: a.wallLine, canary: a.canary, answer })
        if (v.kind === 'idle') stats.idle++; else if (v.kind === 'active') stats.active++; else stats.unknown++
        return v
      })()
      memo.set(key, p)
      return p
    },
  }
}
