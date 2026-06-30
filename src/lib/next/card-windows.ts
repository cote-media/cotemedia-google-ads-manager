// LORAMER_NEXT_CARD_ENGINE_RESHAPE_V1 — pure window resolver for the card engine (client + server safe). Resolves
// the CURRENT window from a preset (via the ONE shared resolveDateWindow — Lesson 19) or an explicit custom range,
// and the COMPARISON window from a compare mode. No DB, no platform API.
import { resolveDateWindow, addDaysIso } from '@/lib/date-range'
import { etCivilDate } from '@/lib/next/portfolio-windows'

export type Win = { startDate: string; endDate: string }
export type ComparePreset = 'none' | 'prev_period' | 'prev_year' | 'prev_year_dow' | 'custom'

export const RANGE_PRESETS: { key: string; label: string }[] = [
  { key: 'TODAY', label: 'Today' },
  { key: 'YESTERDAY', label: 'Yesterday' },
  { key: 'LAST_7_DAYS', label: 'Last 7 days' },
  { key: 'LAST_14_DAYS', label: 'Last 14 days' },
  { key: 'LAST_30_DAYS', label: 'Last 30 days' },
  { key: 'LAST_90_DAYS', label: 'Last 90 days' },
  { key: 'THIS_MONTH', label: 'Month to date' },
]
export const COMPARE_PRESETS: { key: ComparePreset; label: string }[] = [
  { key: 'none', label: 'No comparison' },
  { key: 'prev_period', label: 'Previous period' },
  { key: 'prev_year', label: 'Previous year' },
  { key: 'prev_year_dow', label: 'Previous year (match day of week)' },
  { key: 'custom', label: 'Custom' },
]

function lenDays(w: Win): number {
  return Math.round((Date.parse(w.endDate + 'T00:00:00Z') - Date.parse(w.startDate + 'T00:00:00Z')) / 86400000) + 1
}
function shiftYears(d: string, years: number): string {
  const [y, m, dd] = d.split('-').map(Number)
  return new Date(Date.UTC(y - years, m - 1, dd)).toISOString().split('T')[0]
}

// Resolve { current, compare }. period | (start+end custom) → current; compare mode → comparison window (or null).
export function resolveCardWindows(opts: {
  period?: string; start?: string; end?: string;
  compare?: ComparePreset; cmpStart?: string; cmpEnd?: string;
}): { current: Win; compare: Win | null } {
  const base = etCivilDate()
  let current: Win
  if (opts.start && opts.end) current = { startDate: opts.start, endDate: opts.end }
  else { const w = resolveDateWindow(opts.period || 'LAST_30_DAYS', undefined, undefined, base); current = { startDate: w.startDate, endDate: w.endDate } }

  const mode: ComparePreset = opts.compare || 'none'
  let compare: Win | null = null
  if (mode === 'custom' && opts.cmpStart && opts.cmpEnd) compare = { startDate: opts.cmpStart, endDate: opts.cmpEnd }
  else if (mode === 'prev_period') { const n = lenDays(current); compare = { startDate: addDaysIso(current.startDate, -n), endDate: addDaysIso(current.endDate, -n) } }
  else if (mode === 'prev_year') compare = { startDate: shiftYears(current.startDate, 1), endDate: shiftYears(current.endDate, 1) }
  else if (mode === 'prev_year_dow') compare = { startDate: addDaysIso(current.startDate, -364), endDate: addDaysIso(current.endDate, -364) }
  return { current, compare }
}

// Short human label for a window, e.g. "Jun 1–29".
export function winLabel(w: Win): string {
  const fmt = (iso: string) => {
    const [y, m, d] = iso.split('-').map(Number)
    return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
  }
  return `${fmt(w.startDate)}–${fmt(w.endDate).replace(/^[A-Za-z]+ /, (s) => (w.startDate.slice(0, 7) === w.endDate.slice(0, 7) ? '' : s))}`
}
