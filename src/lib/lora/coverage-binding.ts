// LORAMER_BINDING_COVERAGE_V1 — THE VERDICT GATES THE ANSWER STRUCTURALLY. IT IS NOT ADVICE.
//
// ⛔ PURE, AND IN ITS OWN FILE WITH ZERO IMPORTS, for the same reason `universe-resumer.ts` is: a decision a
// guard cannot DRIVE is a decision that gets asserted about instead of tested. It was first written inside
// claude-tools.ts and the guard could not load it — that module's `@/` path aliases do not resolve under a
// bare tsc+require, so the harness could only ever have read its source. Moved here, the real function runs.
//
// ⛔ WHAT THE 2026-08-14 BASELINE PROVED, and it is why this is a SHAPE change rather than more prose: the
// coverage signal WAS present, WAS correct, and was taught at length in the tool description — and 17 answers
// broke the rule anyway. Three of them QUOTE the signal while contradicting it (A13 opens "Google `covered`
// and `complete: true`" and then fabricates a state ranking for a grain whose floor postdates the window).
// ★SEMANTIC-LAYER banked the reason in advance: semantic-layer failures are REFUSALS, text-to-SQL failures are
// CONFIDENT WRONG NUMBERS, and the difference is ARCHITECTURAL — "no amount of prompt work closes it."
//
// ⛔ THE MECHANISM, AND WHY IT IS NOT "WITHHOLD THE NUMBER". Withholding over-refuses, and over-refusing is its
// own failure: a PARTIAL window still holds a real figure for the part that IS covered, and a dormant
// account's zero is a TRUE zero the user is entitled to. So nothing is deleted — the figure MOVES TO A KEY
// WHOSE NAME CARRIES ITS STANDING:
//   COMPLETE  → `totals` / `canonical` stay exactly where they are. Byte-identical to today.
//   PARTIAL   → NO `totals` KEY. Numbers live on `partialTotals` / `partialCanonical` + a `withheld` object.
//   UNKNOWN   → NO `totals` KEY. Numbers live on `unverifiedTotals` / `unverifiedCanonical` + `withheld`.
// The model cannot emit a bare total for a non-COMPLETE window because THE KEY THAT HELD ONE NO LONGER
// EXISTS. That is structural. The figure is still reachable and still discussable — under a name that cannot
// be quoted without quoting its standing.
//
// ⛔ AND THE OVER-REFUSAL GUARD, which matters as much as the binding: a COMPLETE window holding zero rows is
// a REAL ZERO and stays fully answerable — `zeroIsReal: true` says so — so "the account genuinely spent
// nothing" never degrades into "we cannot tell you". Teaching the model to disbelieve every zero would trade
// one honesty failure for another. The three verdicts are the quota vocabulary already in use
// (next/coverage.ts:213-219), not a new dialect.

export type CoverageVerdict = 'COMPLETE' | 'PARTIAL' | 'UNKNOWN'

export type BindOpts = {
  /** The completeness verdict for THIS window, or undefined when it could not be computed. */
  complete: boolean | undefined
  /** Did the coverage measurement itself succeed? false ⇒ UNKNOWN, never a bare total. */
  measured: boolean
  measureError?: string
}

export function bindWindow(w: any, opts: BindOpts): any {
  const rowCount = Number(w?.totals?.rowCount ?? 0)

  // FAIL LOUD. A coverage read that could not run is UNKNOWN with the existing `read_failed` vocabulary —
  // never an uncaveated total. The shape this replaces (`catch { return result }`) returned the bare figure
  // with no completeness field at all, so "coverage says fine" and "coverage never ran" were
  // indistinguishable BY ABSENCE, and nothing tells a reader to notice an absence.
  if (!opts.measured) {
    const { totals, canonical, ...rest } = w
    return {
      ...rest,
      unverifiedTotals: totals,
      unverifiedCanonical: canonical,
      coverageVerdict: 'UNKNOWN' as CoverageVerdict,
      unknownReason: 'read_failed',
      answerable: false,
      withheld: {
        reason: `COVERAGE COULD NOT BE MEASURED: ${opts.measureError || 'the coverage read failed'}`,
        mustSay: 'Say the completeness of this window could not be measured. Give a figure only if you label it UNVERIFIED. Do NOT claim the window is complete, and do NOT report a zero here as a real zero — a failed measurement is not a clean bill of health.',
      },
    }
  }

  if (opts.complete === false) {
    const { totals, canonical, ...rest } = w
    return {
      ...rest,
      partialTotals: totals,
      partialCanonical: canonical,
      coverageVerdict: 'PARTIAL' as CoverageVerdict,
      answerable: false,
      withheld: {
        reason: 'PARTIAL COVERAGE: at least one platform in this window is not fully captured (see contribution[] for which and why).',
        mustSay: 'State that this total is PARTIAL and NAME the platform and the reason from contribution[]. You may report partialTotals as the COVERED PORTION — never as the window total, and never as a whole number. A platform whose status is capture_failing / trailing_gap / predates_capture is NOT $0.',
      },
    }
  }

  return {
    ...w,
    coverageVerdict: 'COMPLETE' as CoverageVerdict,
    answerable: true,
    // A COMPLETE window with no rows is a TRUE zero and must stay statable. Over-refusal is its own defect.
    ...(rowCount === 0 ? { zeroIsReal: true } : {}),
  }
}
