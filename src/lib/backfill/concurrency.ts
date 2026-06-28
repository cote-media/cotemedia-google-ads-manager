// LORAMER_SELFSERVE_SPINE_V1 step 3 — bounded-concurrency runner (the N-dial) + HARD memory cap.
//
// The drain runs up to N client-sweeps CONCURRENTLY instead of serial. N is one runtime config constant
// (BACKFILL_CONCURRENCY, env-overridable). A hard memory cap clamps N down so N × peak-sweep(window) always fits
// the 2GB instance — the runner reduces N rather than risk OOM, NEVER the reverse.

// Per-sweep PEAK rss as a function of the geo window (linear, measured 2026-06-27: 20d=544MB, 40d=690MB →
// ~398 + 7.3/day). NOTE: the measured peak INCLUDES the process base (~286MB), so N×peak double-counts the shared
// base → this is a CONSERVATIVE over-estimate (real N-concurrent peak is lower). Conservative is correct for an
// OOM guard. Geo is the memory-dominant step, so the geo window drives the whole sweep's peak.
export function peakSweepMB(windowDays: number): number {
  return Math.round(398 + 7.3 * windowDays)
}

export const INSTANCE_MB = 2048      // Vercel Standard fluid instance (verified)
export const MEMORY_MARGIN_MB = 256  // headroom reserved for base/GC

// Default N, env-overridable in ONE place. Free-N table (peak×N ≤ 2048−256 = 1792MB):
//   N=2@40d (1380 ✓, ~668 margin) · N=3@20d (1632 ✓) · N=2@60d (1672 ✓). Default 2.
export const BACKFILL_CONCURRENCY = Math.max(1, Math.floor(Number(process.env.BACKFILL_CONCURRENCY ?? 2)) || 2)

// HARD MEMORY CAP: clamp the configured N so peak(window) × N ≤ INSTANCE_MB − MARGIN. Returns ≥ 1 always.
// This is the OOM guard: no matter what N is configured (or env-set), the runner never spawns more sweeps than
// physically fit the instance.
export function clampConcurrency(configN: number, windowDays: number): number {
  const peak = peakSweepMB(windowDays)
  const maxSafe = Math.max(1, Math.floor((INSTANCE_MB - MEMORY_MARGIN_MB) / peak))
  const want = Math.max(1, Math.floor(configN) || 1)
  return Math.min(want, maxSafe)
}

// Bounded-concurrency pool. Runs `worker(item, index)` over `items` with AT MOST `n` runners in flight (NOT
// unbounded Promise.all). Each runner pulls the next item IN ORDER (so the upstream priority sort + cap are
// honored) and runs it to completion before pulling again. Stops pulling new work as soon as `shouldStop()` is
// true (budget/cap); in-flight runners (≤ n) finish. Completion order is whatever finishes first.
export async function runPool<T>(
  items: T[],
  n: number,
  worker: (item: T, index: number) => Promise<void>,
  shouldStop: () => boolean = () => false,
): Promise<void> {
  let cursor = 0
  const runner = async (): Promise<void> => {
    while (true) {
      if (shouldStop()) return
      const idx = cursor++
      if (idx >= items.length) return
      await worker(items[idx], idx)
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, Math.floor(n)) }, () => runner()))
}
