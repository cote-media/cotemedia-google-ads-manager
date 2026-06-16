// LORAMER_WOO_BACKFILL_SAFE_V1 (WS3 #7 live-store safety)
// PURE adaptive-window fetch — no DB, no network: the order fetcher is INJECTED, so this is fully
// unit-testable with a mock. On a window error, de-escalate the window size down a coarse ladder
// (21 → 7 → 1 day floor), capturing the largest contiguous NEWEST range that succeeds and reporting
// the day that fails at the per-day floor. NEVER silently skips a day (the failed day is surfaced as a
// hard boundary → the caller trips the circuit-breaker; deeper history isn't attempted past it).

export type WooFetchFn = (afterDay: string, beforeDay: string) => Promise<any[]>

export interface AdaptiveResult {
  ok: boolean // true = the entire [windowStart, windowEnd] was fetched
  orders: any[] // contiguous orders captured from windowEnd back to (failedDay+1 when !ok)
  failedDay?: string // the per-day window that errored at the floor (only when !ok)
  reason?: string
}

// Coarse de-escalation ladder (days). RUNGS[0] should match the engine's CHUNK_DAYS.
export const WOO_SUBCHUNK_LADDER = [21, 7, 1] as const

function fmt(d: Date): string {
  return d.toISOString().split('T')[0]
}
function addDays(iso: string, n: number): string {
  const d = new Date(iso + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() + n)
  return fmt(d)
}

// Try [start,end] as one fetch; on error, split into next-rung-sized sub-windows processed BACKWARD
// from `end`, accumulating captured orders until one sub-window fails at the per-day floor.
async function tryRange(
  fetchOrders: WooFetchFn,
  start: string,
  end: string,
  rungIdx: number
): Promise<AdaptiveResult> {
  try {
    const orders = await fetchOrders(start, end)
    return { ok: true, orders }
  } catch (e: any) {
    const size = WOO_SUBCHUNK_LADDER[rungIdx]
    if (size <= 1) {
      // a 1-day window failed → this day is the hard boundary (no silent skip)
      return { ok: false, orders: [], failedDay: start, reason: String(e?.message ?? e) }
    }
    const nextRung = rungIdx + 1
    const subSize = WOO_SUBCHUNK_LADDER[nextRung]
    const acc: any[] = []
    let cur = end
    while (cur >= start) {
      let subStart = addDays(cur, -(subSize - 1))
      if (subStart < start) subStart = start
      const r = await tryRange(fetchOrders, subStart, cur, nextRung)
      acc.push(...r.orders)
      if (!r.ok) {
        // propagate the boundary; keep everything captured contiguously above it
        return { ok: false, orders: acc, failedDay: r.failedDay, reason: r.reason }
      }
      cur = addDays(subStart, -1)
    }
    return { ok: true, orders: acc }
  }
}

// Public entry: adaptively fetch [windowStart, windowEnd] via the injected fetcher.
export async function adaptiveFetchWindow(
  fetchOrders: WooFetchFn,
  windowStart: string,
  windowEnd: string
): Promise<AdaptiveResult> {
  return tryRange(fetchOrders, windowStart, windowEnd, 0)
}
