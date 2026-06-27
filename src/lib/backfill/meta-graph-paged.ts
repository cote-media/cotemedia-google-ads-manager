// LORAMER_META_GRAPH_PAGED_V1
// Shared Meta Graph fetch+paging+retry primitive — extracted VERBATIM (zero behavior change) from the
// duplicate fetchAllWithRetry in meta-campaign / meta-placement / meta-adset-ad backfill writers. Owns ONLY
// the mechanical paging.next loop + transient retry + the RETRYABLE error-code taxonomy (single source).
// The insights URL (level/fields/filtering/limit) is built by the caller and the result is bucketed by the
// caller unchanged. The page-guard cap is a parameter (default 100; meta-adset-ad passes 200 — more pages).
//
// PRESERVED behavior (do NOT change here — separate decision): on a non-RETRYABLE code (incl. 100 / subcode
// 1487534 "reduce the amount of data") it THROWS — narrow-and-retry would live at the caller's chunk-loop
// (window narrowing), not here, and is a future behavior-change.
const RETRYABLE = new Set([1, 2, 4, 17, 32, 341, 613, 80000, 80004])

export async function metaFetchAllPaged(initialUrl: string, token: string, opts?: { guard?: number }): Promise<any[]> {
  const cap = opts?.guard ?? 100
  const out: any[] = []
  let url: string | null = initialUrl + (initialUrl.includes('?') ? '&' : '?') + 'access_token=' + token
  let guard = 0
  while (url && guard < cap) {
    guard++
    let j: any
    for (let i = 0; i < 4; i++) {
      const res = await fetch(url)
      j = await res.json()
      if (j.error) {
        if (RETRYABLE.has(j.error.code) && i < 3) { await new Promise((r) => setTimeout(r, 2000 * 2 ** i)); continue }
        throw new Error('Meta Graph error: ' + JSON.stringify(j.error))
      }
      break
    }
    if (j.data) out.push(...j.data)
    url = j.paging?.next || null // paging.next is a full URL w/ token — used as-is
  }
  return out
}
