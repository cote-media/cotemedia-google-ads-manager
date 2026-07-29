// LORAMER_META_ASSET_BUDGET_HEADROOM_V1 — the between-iteration budget rule, as a PURE function so it can be
// proven without a live lap and without a running server.
//
// THE DEFECT IT FIXES (two live 504s, 2026-07-28/29): /api/backfill/meta-asset checked only
// `elapsed > BUDGET_MS` between sub-ranges and reserved NOTHING for the lap it was about to begin. At t=249s
// under a 250s budget it passed the check, started a fresh 33-report calendar month, and ran past Vercel's
// maxDuration 300 — so the lambda was killed and the caller NEVER received `resumeBefore`. The chaining
// contract, which is the only thing that makes the route resumable in practice, could not work at all.
//
// WHY IT DID NOT SURFACE ON THE SIBLING ROUTES I COPIED: /api/backfill/meta-video runs ~4 reports per lap and
// meta-placement is similar. Assets run 33 (11 breakdowns × 3 entity levels). The same between-iteration check
// is safe at 4 reports and unsafe at 33 — I inherited the pattern without inheriting its assumption.
//
// ⛔ THE RULE, which is the part that outlives this route: A BETWEEN-ITERATION BUDGET CHECK IS ONLY SAFE IF ONE
// ITERATION CANNOT EXCEED THE REMAINING CEILING. If an iteration can be long, the check must RESERVE HEADROOM
// for it — measured from the iterations already run, with a conservative default before anything is measured.
// Lowering the constant does not fix this; it only moves the size of lap that still overruns.

// Assumed duration of a lap we have not measured yet. Deliberately generous: over-reserving costs one extra
// chained GET, under-reserving costs a 504 that destroys the resume contract.
export const FIRST_LAP_MS = 90_000

// LORAMER_META_PRODUCT_ID_ROUTE_V1 — the reservation is now a PARAMETER, defaulted to FIRST_LAP_MS.
// WHY: 90s was sized for a 33-report ASSET lap. A caller whose lap is an order of magnitude lighter would
// reserve for work it will never do and chain needlessly. Parameterising is deliberately preferred over
// lowering the shared constant: dropping the default would silently change the asset route's behaviour and
// re-open the exact 504 class this module exists to close. Callers that pass nothing are BYTE-IDENTICAL.
export function shouldStartAnotherLap(
  elapsedMs: number, maxLapMs: number, budgetMs: number, firstLapMs: number = FIRST_LAP_MS,
): boolean {
  return elapsedMs + Math.max(maxLapMs, firstLapMs) <= budgetMs
}
