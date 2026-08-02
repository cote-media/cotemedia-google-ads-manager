// LORAMER_DRAIN_FAIR_SHARE_STEP_ORDER_V1 — the drain's per-connection step ORDER, as a PURE function so the
// decision is drivable without a DB, a token, a lap or a running server. Extraction-before-fix is the move that
// worked on decideRangeLapCompletion, resolveGaDimWindowEnd and shouldStartAnotherLap, and it is the reason each
// of those booleans could be guarded at all.
//
// ═══ THE DEFECT THIS EXISTS TO CLOSE ═══════════════════════════════════════════════════════════════════════════
// `for (const step of DRAIN_REGISTRY)` iterates a module-level literal array. Nothing sorted, offset or rotated
// it, so the order was identical on every fire, for every connection, forever. A step that is SLOW therefore
// starves whatever sits behind it — every fire, in the same direction, with no mechanism that could ever let the
// starved step lead.
//
// ⛔ AND `break` EXITS THE WHOLE STEP LOOP, NOT ONE ITERATION. This is the part that reads as a pair problem and
// is not: a slow step starves EVERY step behind it for that connection. On google the tail behind google_geo is
// user_geo → hour → age → gender → dimensional; on meta a slow meta_campaign sits ahead of FOURTEEN steps.
// Measured 2026-08-02: Foam OH's google_geo lap took ~853s (DERIVED from the 12:20:20Z fire start and the
// 12:34:33Z cursor write — there is no lap timer, so this is an inference from two stamps, not an instrument
// reading). google_user_geo was dispatched into the remainder and killed at maxDuration with no cursor and no
// log line, which is why it sat 35 days while every gate read green.
//
// ═══ WHY A TIER AND NOT A BARE SORT ════════════════════════════════════════════════════════════════════════════
// ⛔ THE REGISTRY'S ORDER CARRIES REAL DEPENDENCIES AND THEY LIVED ONLY IN PROSE. google_geo is "after
// google_campaign for grouping"; google_hour is "After google_campaign so the anchor exists". Those are load-
// bearing and they were expressed as ARRAY POSITION plus a comment — nothing machine-readable, nothing a
// reordering could consult. Any sort that ignored them would silently run a step before its anchor and the
// failure would look like a data gap rather than an ordering bug.
// `tier` is what makes the dependency legible to code. Same tier ⇒ order-independent among themselves. A step may
// only be reordered against a step in its OWN tier, so the prose constraints survive by construction rather than
// by anyone remembering them.
//
// ⛐ DAY ONE IS DELIBERATELY ALMOST A NO-OP. Every step is alone in its tier EXCEPT google_geo and
// google_user_geo, which share one. So the only pair that can reorder anywhere in the fleet is the pair this was
// built for, and `tests/guards/drain-fair-share-order.guard.mjs` FAILS if any other tier gains a second member —
// widening this is a deliberate act with a guard edit attached, never a side effect.
// WHY THOSE TWO ARE SAFE TO SHARE, from their own registry entries: both are stateless-range, WRITE-ONLY, NO
// reconcile, separate cursors, separate vendor views (geographic_view vs user_location_view). Neither is the
// other's anchor.
//
// ═══ THE ORDERING RULE ═════════════════════════════════════════════════════════════════════════════════════════
// Within a tier: LEAST-RECENTLY-SUCCEEDED LEADS — `sync_state.updated_at ASC, NULLS FIRST`.
// ⛐ NO NEW STORAGE, AND THAT IS THE POINT. `updated_at` on the step's own cursor row already exists and already
// moves ONLY on a successful lap (writeRangeCursor is its sole writer on this path, and rangeLap returns before
// it on any non-200). So the column already means exactly "when did this step last actually succeed", which is
// the signal fair-share needs. Nothing is migrated and nothing new is written.
// It is SELF-CORRECTING: the moment the starved step lands, it becomes the most recent and its sibling leads the
// next fire.
//
// ⚠ THE FAILURE MODE, STATED RATHER THAN DISCOVERED LATER: a step that can NEVER succeed keeps the oldest
// updated_at and therefore keeps leading, which would starve its sibling in the opposite direction. That is a
// real inversion and this function does not prevent it. What bounds it in practice is the budget reservation at
// the dispatch site (LORAMER_META_ASSET_BUDGET_HEADROOM_V1's rule, now applied to the step loop): a lap that
// cannot fit is NOT dispatched, so the fire ends early and the sibling leads on the next one rather than being
// consumed. If BOTH steps are permanently unaffordable, ordering cannot help and the honest signal is that
// neither cursor ever moves — which is what LORAMER_FROZEN_CURSOR_DETECTOR_V1 is for.

export interface StepOrderInput {
  key: string
  tier: number
  /** sync_state.updated_at for THIS step's cursor row. null = never succeeded (or no cursor row yet). */
  lastSucceededAt: string | null
}

/**
 * Order incomplete steps for one connection: tier ASC, then least-recently-succeeded first (nulls first),
 * then original array position. STABLE and TOTAL — equal inputs never reorder, so a caller cannot get a
 * different answer on a re-run with unchanged data (the determinism law applied to a scheduler).
 *
 * PURE: no DB, no clock, no I/O. The caller supplies lastSucceededAt; this function never reads it.
 */
export function orderStepsFairShare<T extends StepOrderInput>(steps: readonly T[]): T[] {
  return steps
    .map((step, index) => ({ step, index }))
    .sort((a, b) => {
      // 1) TIER — the declared dependency boundary. Never crossed.
      if (a.step.tier !== b.step.tier) return a.step.tier - b.step.tier
      // 2) LEAST-RECENTLY-SUCCEEDED LEADS. null (never succeeded) is the most starved case and sorts first.
      const at = a.step.lastSucceededAt
      const bt = b.step.lastSucceededAt
      if (at === null && bt !== null) return -1
      if (at !== null && bt === null) return 1
      if (at !== null && bt !== null && at !== bt) return at < bt ? -1 : 1
      // 3) ORIGINAL POSITION — explicit rather than relying on sort stability, so the contract is in the code.
      return a.index - b.index
    })
    .map((w) => w.step)
}
