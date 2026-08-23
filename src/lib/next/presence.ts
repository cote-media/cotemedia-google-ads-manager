// LORAMER_FAILURE_IS_NOT_A_FACT_V1 — THE THIRD STATE. A failed read is not a negative fact.
//
// ⛔ WHY THIS EXISTS, measured 2026-08-23 across nine reads: every one asked a three-state question — "did
// the read succeed, and what did it say" — and forced it into a boolean by discarding `error`. A timeout, a
// permission fault or a dropped connection then arrives as `data: null`, `!!data` is `false`, and the
// product tells a paying customer "not connected" about a platform holding years of rows. The comment
// directly above one of them even names the mechanism: "blows the 8s live statement_timeout → 57014 →
// swallowed → silent null."
//
// ⛔ NOT A NULLABLE BOOLEAN, AND THAT IS THE WHOLE POINT OF THE SHAPE. `!!null === false`, and this defect
// IS a `!!data`. A `boolean | null` invites the same collapse at every call site that forgets the null
// check — silently, and at compile time nothing complains. The union makes the third case unskippable:
// there is no implicit conversion to a boolean, and `isYes()` is the ONLY sanctioned narrowing, so the
// decision to treat unknown as "no" has to be written down somewhere a reader can find it.
//
// THE CONVENTION IS NOT INVENTED HERE. Kubernetes conditions are True | False | Unknown, and "the absence
// of a condition should be interpreted the same as Unknown" — an open-world assumption, because a component
// that has not observed something must not imply a known-false. Monitoring plugins carry the same split as
// a separate exit code: 2 CRITICAL means the thing is bad, 3 UNKNOWN means the CHECK could not run. Both
// pair the unknown with a reason rather than leaving it bare, which is why `reason` is required below.
//   https://github.com/kubernetes/community/blob/main/contributors/devel/sig-architecture/api-conventions.md
//   https://www.monitoring-plugins.org/doc/guidelines.html

export type Presence = 'yes' | 'no' | 'unknown'

/** A three-state answer. `reason` is present exactly when the state is 'unknown'. */
export type Probe<T = unknown> =
  | { state: 'yes'; value: T }
  | { state: 'no' }
  | { state: 'unknown'; reason: string }

export const probeYes = <T>(value: T): Probe<T> => ({ state: 'yes', value })
export const probeNo = <T>(): Probe<T> => ({ state: 'no' })
/** ⛔ `reason` is REQUIRED by the signature: an unknown nobody can act on is barely better than a wrong no. */
export const probeUnknown = <T>(reason: string): Probe<T> => ({ state: 'unknown', reason })

/** The ONLY sanctioned narrowing to a boolean. Written out so "unknown counts as no" is always a visible choice. */
export const isYes = (p: Probe<unknown>): boolean => p.state === 'yes'
export const isUnknown = (p: Probe<unknown>): boolean => p.state === 'unknown'
export const reasonOf = (p: Probe<unknown>): string | null => (p.state === 'unknown' ? p.reason : null)
export const valueOf = <T>(p: Probe<T>): T | null => (p.state === 'yes' ? p.value : null)

/**
 * Wrap a supabase read so a thrown or returned error becomes an explicit unknown instead of a silent null.
 * The `what` string lands in the reason, so an unknown names the read that produced it.
 */
export async function probeRead<T>(
  what: string,
  // PromiseLike, not Promise: a PostgREST query builder is thenable and awaits correctly but is not a Promise.
  run: () => PromiseLike<{ data: T | null; error: { message?: string } | null }>,
  present: (data: T) => boolean,
): Promise<Probe<T>> {
  try {
    const { data, error } = await run()
    if (error) return probeUnknown<T>(`${what}: read failed — ${error.message ?? 'unknown database error'}`)
    if (data === null || data === undefined) return probeNo<T>()
    return present(data) ? probeYes<T>(data) : probeNo<T>()
  } catch (e: any) {
    return probeUnknown<T>(`${what}: read threw — ${e?.message ?? String(e)}`)
  }
}
