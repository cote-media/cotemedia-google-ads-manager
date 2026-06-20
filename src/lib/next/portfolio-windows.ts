// LORAMER_NEXT_PORTFOLIO_DELTA_V1 — window-agnostic portfolio period engine: resolves the CURRENT window via the
// ONE shared resolver (Lesson 19) and derives the LIKE-FOR-LIKE PRIOR window at daily granularity, plus an honest
// Δ% label (never NaN/∞). Pure functions (no DB, no server-only) — safe to import in route handlers AND client UI.
import { resolveDateWindow, addDaysIso } from '@/lib/date-range'

export type Window = { startDate: string; endDate: string }
export const PORTFOLIO_PERIODS = [
  'TODAY', 'YESTERDAY', 'THIS_WEEK', 'LAST_WEEK', 'THIS_MONTH', 'LAST_MONTH', 'LAST_7_DAYS', 'LAST_30_DAYS',
] as const
export type PortfolioPeriod = (typeof PORTFOLIO_PERIODS)[number]
export const DEFAULT_PERIOD: PortfolioPeriod = 'YESTERDAY'

export function isPortfolioPeriod(p: string | null | undefined): p is PortfolioPeriod {
  return !!p && (PORTFOLIO_PERIODS as readonly string[]).includes(p)
}

// Fixed day-shift for clean rolling/complete periods. Month periods are calendar-aware (handled separately).
const SHIFT: Record<string, number> = {
  TODAY: 1, YESTERDAY: 1, THIS_WEEK: 7, LAST_WEEK: 7, LAST_7_DAYS: 7, LAST_30_DAYS: 30,
}

function iso(d: Date): string { return d.toISOString().split('T')[0] }
function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000)
}

// LORAMER_NEXT_ET_ANCHOR_V1 — civil "today" in US Eastern (America/New_York, DST-correct via Intl) returned as a
// Date whose UTC Y/M/D EQUAL the ET calendar date. The frozen resolveDateWindow derives "today" from its `now`
// arg's UTC components, so passing this anchors all -next windows to ET WITHOUT touching resolveDateWindow's
// behavior for frozen (now=undefined → server-UTC) callers. The -next user base is US/Eastern; this stops the
// post-UTC-midnight "Yesterday → not-yet-captured day → $0" off-by-one.
export function etCivilDate(at?: Date): Date {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(at || new Date())
  const v = (t: string) => Number(parts.find((p) => p.type === t)!.value)
  return new Date(Date.UTC(v('year'), v('month') - 1, v('day')))
}

// Current window for the period + the LIKE-FOR-LIKE prior window.
//  - complete periods (yesterday, last week, last month, last 7/30) → immediately-preceding complete period.
//  - to-date periods (today, this week, this month) → same number of elapsed days in the prior period.
// `now` defaults to the US-Eastern civil date (not the server/UTC clock) for the -next date path.
export function portfolioWindows(period: string, now?: Date): { current: Window; prior: Window } {
  const base = now || etCivilDate()
  const current = resolveDateWindow(period, undefined, undefined, base)

  // Month periods: prior = the calendar month BEFORE current.startDate's month (THIS_MONTH caps to elapsed days).
  if (period === 'THIS_MONTH' || period === 'LAST_MONTH') {
    const [y, m] = current.startDate.split('-').map(Number) // m = 1-based month of the current window's start
    const prev = new Date(Date.UTC(y, (m - 1) - 1, 1)) // first day of the month before that start month (wraps year)
    const py = prev.getUTCFullYear()
    const pmi = prev.getUTCMonth()
    const prevDays = new Date(Date.UTC(py, pmi + 1, 0)).getUTCDate()
    let endDay = prevDays
    if (period === 'THIS_MONTH') {
      const elapsed = Number(current.endDate.split('-')[2]) // today's day-of-month
      endDay = Math.min(elapsed, prevDays)
    }
    return {
      current,
      prior: { startDate: iso(new Date(Date.UTC(py, pmi, 1))), endDate: iso(new Date(Date.UTC(py, pmi, endDay))) },
    }
  }

  // Day-shift periods: shift both ends back by SHIFT (or the window length as a safe fallback).
  const shift = SHIFT[period] ?? (daysBetween(current.startDate, current.endDate) + 1)
  return {
    current,
    prior: { startDate: addDaysIso(current.startDate, -shift), endDate: addDaysIso(current.endDate, -shift) },
  }
}

export type Delta = { text: string; dir: 'up' | 'down' | 'flat' | 'none' }

// Honest Δ%. null current → '—'; both 0 → '—'; prior 0 & cur>0 → 'new'; cur 0 & prior>0 → ↓100%. Never NaN/∞.
export function deltaLabel(cur: number | null, prior: number | null): Delta {
  if (cur == null) return { text: '—', dir: 'none' }
  const p = prior ?? 0
  if (cur === 0 && p === 0) return { text: '—', dir: 'none' }
  if (p === 0 && cur > 0) return { text: 'new', dir: 'up' }
  if (cur === 0 && p > 0) return { text: '↓100%', dir: 'down' }
  const r = Math.round(((cur - p) / p) * 100)
  return { text: (r > 0 ? '↑' : r < 0 ? '↓' : '↕') + Math.abs(r) + '%', dir: r > 0 ? 'up' : r < 0 ? 'down' : 'flat' }
}
