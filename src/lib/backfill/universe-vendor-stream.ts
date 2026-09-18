// LORAMER_UNIVERSE_STREAM_CAPTURE_V1 — the STREAMING vendor client the v2 consumer injects.
//
// ⛔ SEPARATE FILE, FOR THE SAME REASON `universe-vendor-client.ts` IS ONE. The capture function takes
// `stream` as a PARAMETER so it stays drivable with no network — that is what lets the guard prove the
// day-commit boundary, the order check and the mid-day-kill behaviour without spending a single request.
// Constructing the Google client inside the capture path would destroy that property.
//
// ⛔ `queryStream` HAS BEEN THERE THE WHOLE TIME. google-ads-api 23.0.0, `customer.d.ts:22`:
//     queryStream<T = services.IGoogleAdsRow>(gaqlQuery: string, requestOptions?): AsyncGenerator<T>
// v1 calls `customer.query(gaql)`, which returns `Promise<T[]>` and therefore BUFFERS THE WHOLE WINDOW
// before a single row is written. A killed invocation loses everything it fetched, having already spent the
// request. Nothing about that was a constraint — it was an unexamined default.
//
// ⛔ AND IT COSTS THE SAME. Google's rate sheet, already quoted in `universe-governor.ts`: a query or report
// is ONE operation whether streamed via SearchStream or paged via Search, and paginated requests carrying a
// valid next_page_token are not counted at all. Streaming is strictly better here — same price, and the rows
// become durable as they arrive instead of at the end.
//
// ── LORAMER_V2_QUOTA_SENTINEL_WIRED_V1, 2026-08-09 — THIS IS THE WALK'S ARMING BOUNDARY, AND IT IS THE FIFTH ──
// ⛔ WHAT WAS WRONG (★WALK-DOES-NOT-READ-OR-ARM-THE-QUOTA-SENTINEL, sweep C2). `google-quota-store.ts` names
// FOUR Google error boundaries and says on its own face that "a new Google call site that invents a fifth
// wrapper is NOT caught". This file WAS that fifth: a bare `customer.queryStream(gaql)` with no retry wrapper
// and no `noteGoogleQuotaError`. A quota refusal the walk observed taught the fleet nothing.
//
// ⛔ WHY THE ARM WRAPS **CONSUMPTION** AND NOT THE CALL — VERIFIED AGAINST THE VENDOR LIBRARY, NOT ASSUMED.
// `queryStream` returns an AsyncGenerator; the rejection surfaces when the iterator is pulled, not when the
// function is invoked. The library's own `handleStreamError` reads the first error object off the error stream,
// converts it to a **GoogleAdsFailure** and rejects — the SAME shape a unary `query` throws, which is why
// `classifyGoogleAdsError` (which reads `err.errors[0].error_code.quota_error`, never `err.message`) works
// unchanged on this path. An arm placed around the CALL would never fire.
//
// ⛔ IT RE-THROWS, ALWAYS. Arming is a side effect, never a swallow: the caller's own catch
// (`universe-stream-capture.ts`) still records the attempt's error and still keeps every day already committed.
// ⚠ AND THE ONE THING THIS DOES **NOT** FIX, named rather than folded in: `classifyGoogleAdsError` treats ANY
// `quota_error` code as a developer-scope exhaustion. Google documents TWO — `RESOURCE_EXHAUSTED` (the daily
// operation limit; do not retry until reset) and `RESOURCE_TEMPORARILY_EXHAUSTED` (short-term QPS throttling;
// retry with backoff) — so a transient rate limit currently arms a fleet-wide pause. That fails SAFE, it is
// shared with all four existing boundaries, and changing it is a live-path behaviour change for the drain and
// catchup. Banked as ★QUOTA-CLASSIFIER-CONFLATES-DAILY-EXHAUSTION-WITH-RATE-LIMITING; deliberately NOT done here.
// ⛔ CONSTRUCTED THROUGH THE CHOKE POINT — LORAMER_GOOGLE_CLIENT_CHOKE_POINT_V1 (inert path, migrated first).
import { withGoogleAdsStream } from '@/lib/google-ads-client' // LORAMER_DIRECT_ACCESS_CUSTOMER_V1 — manager first, direct only on a pre-first-row permission refusal
import { supabaseAdmin } from '@/lib/supabase'
// LORAMER_WALK_QUOTA_SCOPE_V1 — boundary 5 of 5 arms through the WALK's scope-keyed hold (route R2): an ACCOUNT-scoped
// refusal holds ONE lane, DEVELOPER/scope-less arms the same fleet row noteGoogleQuotaError always did. The shared
// google-quota modules are untouched and byte-identical (walk-quota-scope.guard.mjs pins them).
import { armWalkQuota, type WalkLane } from './walk-quota-store'

export async function googleAdsStreamFor(
  userEmail: string, customerId: string, lane?: WalkLane | null,
): Promise<(gaql: string) => AsyncGenerator<any>> {
  const { data, error } = await supabaseAdmin
    .from('google_tokens').select('refresh_token').eq('user_email', userEmail).single()
  if (error || !data?.refresh_token) {
    throw new Error(`No Google refresh token for ${userEmail}: ${error?.message ?? 'not found'}`)
  }
  const key = { refreshToken: data.refresh_token as string, customerId }
  // ⛔ THE GENERATOR IS WRAPPED SO THE ERROR BOUNDARY SITS AROUND THE PULL, WHERE THE REJECTION ACTUALLY
  // ARRIVES. `yield*` delegates every row through unchanged — no buffering is introduced, so the streaming
  // property the whole rebuild rests on is untouched — and the catch arms the sentinel before re-throwing.
  return (gaql: string) => armingStream(() => withGoogleAdsStream(key, (c) => c.queryStream(gaql) as AsyncGenerator<any>), lane ?? null)
}

/**
 * ⛔ ARM, THEN RE-THROW. Never swallow: the caller decides what an error means for the attempt; this only makes
 * sure the FLEET learns that Google refused. `noteGoogleQuotaError` is best-effort and idempotent by
 * construction (one upsert on one sentinel row), so a failed arm can never turn a fetch error into a 500.
 */
export async function* armingStream<T>(open: () => AsyncGenerator<T>, lane: WalkLane | null = null): AsyncGenerator<T> {
  try {
    yield* open()
  } catch (e) {
    // ⛔ SCOPE-KEYED (LORAMER_WALK_QUOTA_SCOPE_V1): reads details.quota_error_details; ACCOUNT → this lane only,
    // DEVELOPER / message-only → the fleet row as before, no delay anywhere → 10/20/40 s on this lane.
    await armWalkQuota(e, 'universe-vendor-stream:queryStream', lane)
    throw e
  }
}
