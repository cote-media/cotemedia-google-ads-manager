// LORAMER_DATE_RANGE_CANONICAL_V1
// Single source of truth: date selector -> YYYY-MM-DD window (UTC).

function formatUtcDate(d: Date): string {
  const y = d.getUTCFullYear()
  const m = String(d.getUTCMonth() + 1).padStart(2, '0')
  const day = String(d.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function utcCalendarDate(y: number, monthIndex: number, day: number): Date {
  return new Date(Date.UTC(y, monthIndex, day))
}

function addUtcDays(d: Date, delta: number): Date {
  const next = new Date(d.getTime())
  next.setUTCDate(next.getUTCDate() + delta)
  return next
}

export function addDaysIso(iso: string, n: number): string {
  const d = new Date(iso + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().split('T')[0]
}

export function resolveDateWindow(
  dateRange: string,
  customStart?: string,
  customEnd?: string,
  now?: Date
): { startDate: string; endDate: string } {
  if ((customStart && customEnd) || dateRange === 'CUSTOM') {
    return {
      startDate: customStart!,
      endDate: customEnd!,
    }
  }

  const baseNow = now || new Date()
  const today = utcCalendarDate(
    baseNow.getUTCFullYear(),
    baseNow.getUTCMonth(),
    baseNow.getUTCDate()
  )
  const yesterday = addUtcDays(today, -1)
  const todayStr = formatUtcDate(today)
  const yesterdayStr = formatUtcDate(yesterday)

  switch (dateRange) {
    case 'TODAY':
      return { startDate: todayStr, endDate: todayStr }
    case 'YESTERDAY':
      return { startDate: yesterdayStr, endDate: yesterdayStr }
    case 'LAST_7_DAYS':
      return {
        startDate: formatUtcDate(addUtcDays(yesterday, -6)),
        endDate: yesterdayStr,
      }
    case 'LAST_14_DAYS':
      return {
        startDate: formatUtcDate(addUtcDays(yesterday, -13)),
        endDate: yesterdayStr,
      }
    case 'LAST_30_DAYS':
      return {
        startDate: formatUtcDate(addUtcDays(yesterday, -29)),
        endDate: yesterdayStr,
      }
    case 'LAST_90_DAYS':
      return {
        startDate: formatUtcDate(addUtcDays(yesterday, -89)),
        endDate: yesterdayStr,
      }
    case 'THIS_MONTH': {
      const start = utcCalendarDate(baseNow.getUTCFullYear(), baseNow.getUTCMonth(), 1)
      return { startDate: formatUtcDate(start), endDate: todayStr }
    }
    case 'LAST_MONTH': {
      const y = baseNow.getUTCFullYear()
      const m = baseNow.getUTCMonth()
      const start = utcCalendarDate(y, m - 1, 1)
      const end = utcCalendarDate(y, m, 0)
      return { startDate: formatUtcDate(start), endDate: formatUtcDate(end) }
    }
    case 'THIS_WEEK': {
      // ADDITIVE (LORAMER_NEXT_PORTFOLIO_DELTA_V1). Monday-start week, to-date.
      const dow = today.getUTCDay() // 0=Sun..6=Sat
      const monday = addUtcDays(today, -((dow + 6) % 7))
      return { startDate: formatUtcDate(monday), endDate: todayStr }
    }
    case 'LAST_WEEK': {
      // ADDITIVE (LORAMER_NEXT_PORTFOLIO_DELTA_V1). Previous complete Monday..Sunday.
      const dow = today.getUTCDay()
      const thisMonday = addUtcDays(today, -((dow + 6) % 7))
      const lastMonday = addUtcDays(thisMonday, -7)
      const lastSunday = addUtcDays(thisMonday, -1)
      return { startDate: formatUtcDate(lastMonday), endDate: formatUtcDate(lastSunday) }
    }
    default:
      return {
        startDate: formatUtcDate(addUtcDays(yesterday, -29)),
        endDate: yesterdayStr,
      }
  }
}
