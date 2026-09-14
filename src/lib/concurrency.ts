// LORAMER_FANOUT_BOUNDED_GUARD_V1 — THE ONE HOME OF BOUNDED FAN-OUT. Lifted from universe-coverage.ts (where
// LORAMER_COVERAGE_PROBE_BOUND_V1 first wrote it on 2026-09-14) so every data-width fan-out in the tree bounds
// itself through the SAME primitive, and tests/guards/fan-out-is-bounded.guard.mjs can demand it by name.
//
// ⛔ WHY A BOUND AT ALL, measured 2026-09-14 (fire-7621 class): `Promise.all(days.map(probe))` launched one PostgREST
// fetch per day of a 3,000–3,700-day span at once; the Vercel host's resolver/fd pool exhausted (`getaddrinfo EBUSY`,
// undici "TypeError: fetch failed"), the enumeration threw, the meter read null, and the three deepest accounts were
// starved for 19 h. A fan-out whose width is DATA — days, clients, surfaces, rows — has no ceiling but the host's.
// ⛔ WHY A SLIDING WINDOW AND NOT BATCHES (adversary, round 5): fixed batches pay the slowest member's latency per
// batch and discard the batch's siblings on a throw; a window keeps `limit` in flight continuously, same bound,
// ~2× less wall time, and the failure residual is ONE window rather than the rest of the span.
// ⛔ WHY NO RUNTIME RAIL AT THE FETCH SEAM (adversary, round 16 — ★ADMIN-FETCH-CLASS-RAIL): a per-invocation semaphore
// is not a tax, but it buys nothing the build guard doesn't and would need the `undici` package to bound the real
// substrate (sockets per origin). The rail's trigger is written on the queue item; the guard is the enforcer today.

/**
 * A sliding window over `items`: at most `limit` calls of `fn` in flight, the next launched as each completes.
 * Results are placed BY INDEX, so the caller's answer is byte-identical to the unbounded `Promise.all(items.map(fn))`.
 * ⛔ CANCEL-ON-FIRST-FAILURE: the first rejection sets `cancelled`; workers already in flight finish their one call
 * and stop, and NOTHING queued behind the failure is ever launched. Rejects with the FIRST error, exactly as
 * Promise.all did.
 */
export async function mapBounded<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length)
  const width = Math.max(1, Math.min(Math.floor(limit), items.length))
  let next = 0
  let cancelled = false
  let firstError: unknown = null
  const worker = async (): Promise<void> => {
    while (!cancelled) {
      const i = next++
      if (i >= items.length) return
      try {
        results[i] = await fn(items[i], i)
      } catch (e) {
        if (!cancelled) { cancelled = true; firstError = e }
        return
      }
    }
  }
  await Promise.all(Array.from({ length: width }, () => worker()))
  if (cancelled) throw firstError
  return results
}
