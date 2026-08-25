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
        mustSay: 'State that this total is PARTIAL and NAME the platform and the reason from contribution[]. You may report partialTotals as the COVERED PORTION — never as the window total, and never as a whole number. A platform whose status is capture_failing / stale_tail / trailing_gap / extends_past_capture / predates_capture is NOT $0.',
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

// ═══ LORAMER_BREAKDOWN_MONEY_BINDING_V1 (2026-08-15) — THE SAME STRUCTURE, TWO MORE DOORS ═══════════════
//
// ⛔ WHY: the binding above gated query_metrics ONLY. query_breakdown returned its ranking + a verdict + a
// note — ADVICE — and query_money returned components with no verdict at all. A13/E7/C14 (the baseline's
// breakdown-grain trio) walked through those doors: the model quoted rankings while contradicting the
// attached note, exactly as it quoted totals while contradicting coverageNotes before LORAMER_BINDING_
// COVERAGE_V1. Same disease, same cure: the figure MOVES TO A KEY CARRYING ITS STANDING.
//
// ⛔ PURE AND IMPORT-FREE, like everything in this file, so the guard can DRIVE it rather than read it.
// The verdict inputs arrive as plain strings; the combination rules live here so they are testable:
//   · either input UNKNOWN  → UNKNOWN  (grain reason wins the narration — it is the more specific fact)
//   · else either PARTIAL   → PARTIAL
//   · else                  → COMPLETE
//   · EXCEPTION — grain UNKNOWN/no_activity_in_window is VENDOR-ATTESTED EMPTINESS, the one absence that
//     is a fact about the account (LORAMER_UNATTESTED_ABSENCE_V1). It binds as COMPLETE with
//     `attestedEmpty: true`: an attested-empty ranking is a REAL empty, and withholding it would be the
//     over-refusal defect the account-grain binding's zeroIsReal exists to prevent.
export type RankingBindDecision = {
  verdict: CoverageVerdict
  attestedEmpty?: boolean
  reason: string
  mustSay: string
}

export function combineRankingVerdict(i: {
  grainVerdict: string
  grainUnknownReason?: string
  grainDetail?: string
  densityVerdict?: string
  densityDetail?: string
}): RankingBindDecision {
  const g = i.grainVerdict, d = i.densityVerdict
  if (g === 'UNKNOWN' && i.grainUnknownReason === 'no_activity_in_window') {
    return {
      verdict: 'COMPLETE', attestedEmpty: true,
      reason: 'VENDOR-ATTESTED EMPTY WINDOW: the vendor was asked and answered with nothing for every day.',
      mustSay: 'This emptiness is vendor-attested — you may state plainly that the account had no activity in this window. An empty result here IS real.',
    }
  }
  if (g === 'UNKNOWN' || d === 'UNKNOWN' || d === undefined) {
    const reason = g === 'UNKNOWN'
      ? `UNMEASURABLE AT THE GRAIN (${i.grainUnknownReason ?? 'unknown'}): ${i.grainDetail ?? ''}`
      : `BASE DENSITY UNMEASURABLE: ${i.densityDetail ?? 'the base-grain density read did not run for this window.'}`
    const mustSay = i.grainUnknownReason === 'unattested_absence'
      ? 'Say this window is NOT CAPTURED and activity cannot be confirmed — it may be genuine inactivity or a capture hole, and nothing measured can tell them apart. NEVER assert the account was inactive, NEVER report a real zero, and report any figures only as UNVERIFIED.'
      : 'Say the completeness of this ranking could not be measured. Report figures only if you label them UNVERIFIED. Do NOT claim the window is complete and do NOT treat emptiness as a real zero.'
    return { verdict: 'UNKNOWN', reason, mustSay }
  }
  if (g === 'PARTIAL' || d === 'PARTIAL') {
    const parts = [
      ...(g === 'PARTIAL' ? [`grain holes: ${i.grainDetail ?? 'some base-active days carry no breakdown rows'}`] : []),
      ...(d === 'PARTIAL' ? [`base capture holes: ${i.densityDetail ?? 'a 7+-day run of days is missing from base capture'}`] : []),
    ]
    return {
      verdict: 'PARTIAL',
      reason: `PARTIAL COVERAGE — ${parts.join(' · ')}`,
      mustSay: 'State that this ranking/figure is PARTIAL and NAME the gap. You may report the partial values as the COVERED PORTION — never as the window total, and never treat a value missing from the list as proof it did not occur.',
    }
  }
  return { verdict: 'COMPLETE', reason: '', mustSay: '' }
}

// The ranking payload: `rows` moves exactly the way `totals` does one binding up.
//   COMPLETE → rows stay; attested-empty carries attestedEmpty:true + emptyIsReal.
//   PARTIAL  → NO `rows` key: `partialRows` + `withheld`.
//   UNKNOWN  → NO `rows` key: `unverifiedRows` + `withheld`.
export function bindRanking(result: any, decision: RankingBindDecision): any {
  if (decision.verdict === 'COMPLETE') {
    return {
      ...result,
      coverageVerdict: 'COMPLETE' as CoverageVerdict,
      answerable: true,
      ...(decision.attestedEmpty ? { attestedEmpty: true, emptyIsReal: true, withheld: undefined } : {}),
    }
  }
  const { rows, ...rest } = result ?? {}
  const key = decision.verdict === 'PARTIAL' ? 'partialRows' : 'unverifiedRows'
  return {
    ...rest,
    [key]: rows ?? [],
    coverageVerdict: decision.verdict,
    answerable: false,
    withheld: { reason: decision.reason, mustSay: decision.mustSay },
  }
}

// The money payload: `components` is its `totals`.
export function bindMoney(result: any, decision: RankingBindDecision): any {
  if (decision.verdict === 'COMPLETE') {
    return {
      ...result,
      coverageVerdict: 'COMPLETE' as CoverageVerdict,
      answerable: true,
      ...(decision.attestedEmpty ? { attestedEmpty: true, emptyIsReal: true } : {}),
    }
  }
  const { components, ...rest } = result ?? {}
  const key = decision.verdict === 'PARTIAL' ? 'partialComponents' : 'unverifiedComponents'
  return {
    ...rest,
    [key]: components ?? {},
    coverageVerdict: decision.verdict,
    answerable: false,
    withheld: { reason: decision.reason, mustSay: decision.mustSay },
  }
}
