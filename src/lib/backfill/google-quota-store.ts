// LORAMER_GOOGLE_QUOTA_GUARD_V1 — DB read/write of the GLOBAL google-quota pause marker.
// Reuses the EXISTING sync_state circuit-breaker columns (migration 013: backfill_blocked /
// backfill_block_window / backfill_block_reason / backfill_block_at) on a SINGLE global sentinel row —
// NO schema change, no new table, no migration. One strike = immediate pause (unlike Woo's 2-strike
// breaker); auto-resume is clock-based (window elapsed → reads as not paused; no manual unblock).
import { supabaseAdmin } from '@/lib/supabase'
import {
  GOOGLE_QUOTA_SENTINEL_CLIENT,
  GOOGLE_QUOTA_PLATFORM,
  GoogleQuotaError,
  classifyGoogleAdsError,
} from './google-quota' // LORAMER_QUOTA_ARM_AT_ERROR_BOUNDARY_V1 — noteGoogleQuotaError needs both shapes

// LORAMER_QUOTA_READ_SPLIT_STATE_V1 — the read has THREE outcomes, not two.
//
// THE BUG THIS CLOSES (live since the guard shipped; measured 2026-07-28): this function destructured only
// `data` and threw `error` away. supabase-js NEVER throws — it returns { data, error } — so any read failure
// produced data === null, fell into `if (!data?.backfill_blocked)`, and returned paused:false. A FAILED READ
// WAS INDISTINGUISHABLE FROM A HEALTHY UNBLOCKED SENTINEL, silently, with no log. On 2026-07-28 the sentinel
// was armed at 11:28:45Z with a window to 07-29T08:03:57Z, and google catchup runs starting 11:29:11, 11:39:11,
// 11:49:11 and 11:59:11 still reported accounts_with_gaps=9 and days_filled=3/7/6/1 — counters that increment
// ONLY downstream of the `fillDays = googleQuotaPaused ? [] : …` gate. The gate, its scope and the deployed
// artifact were all correct; the gate variable was false anyway, and nothing logged why.
//
// WHY THREE STATES AND NOT A FAIL-CLOSED FLIP. This function has two KINDS of caller and they need OPPOSITE
// defaults when the answer is unknown:
//   · CAPTURE lanes (cron/drain, cron/catchup) turn the answer into "do I spend Google quota". Unknown must
//     HOLD — the cost of a false hold is one lap skipped and retried ten minutes later. Self-healing.
//   · THE ANSWER PATH (/api/intelligence) turns the answer into a USER-FACING CLAIM: buildGoogleQuotaLines
//     renders "⛔ GOOGLE PLATFORM API QUOTA EXHAUSTED … SAY THIS OUT LOUD". Unknown must attach NOTHING — a
//     Supabase blip must never make Lora announce a platform outage that is not happening. Flipping this one
//     closed would re-create the incident VERIFICATION LAW 1 was written from ("Lora: /api/intelligence
//     fail-closed on a network blip") and would break FAIL-PARTIAL READ-PATH LAW, which is do-not-relitigate.
// So `paused` keeps its EXACT existing meaning — the sentinel says Google work is blocked — and `state` carries
// the read outcome beside it. Unknown is paused:false + state:'unknown'. Capture lanes must call holdGoogleWork.
//
// Clock-based auto-resume is UNCHANGED: an elapsed window still reads paused:false (0b32f9f), same branch,
// same comparison, same position.
export type GoogleQuotaReadState = 'blocked' | 'not_blocked' | 'unknown'
export interface GoogleQuotaPause {
  paused: boolean            // the sentinel says Google work is blocked. UNCHANGED semantics; false when unknown.
  state: GoogleQuotaReadState // how we know — 'unknown' means the READ failed, not that the quota is fine.
  until: string | null
  since: string | null
  reason: string | null
}

// THE ONE PLACE the capture-lane rule lives. Every lane that spends Google quota gates on THIS, never on
// `.paused` directly — collapsing it here is what stops the next lane hand-rolling the disjunction and
// re-opening the hole in a file no guard is watching.
export function holdGoogleWork(qp: GoogleQuotaPause): boolean {
  return qp.paused || qp.state === 'unknown'
}

export async function readGoogleQuotaPause(): Promise<GoogleQuotaPause> {
  const { data, error } = await supabaseAdmin
    .from('sync_state')
    .select('backfill_blocked, backfill_block_window, backfill_block_reason, backfill_block_at')
    .eq('client_id', GOOGLE_QUOTA_SENTINEL_CLIENT)
    .eq('platform', GOOGLE_QUOTA_PLATFORM)
    .maybeSingle()

  // READ FAILURE — NOT a quota block, and it must never be reported as one. Loud on purpose: silence here is
  // precisely why the 2026-07-28 occurrence left no evidence and could not be attributed for a full day.
  if (error) {
    const detail = (error as { message?: string })?.message || String(error)
    console.error(
      '[google-quota] SENTINEL READ FAILURE — this is a DB read error, NOT a quota block. ' +
      'Capture lanes HOLD (holdGoogleWork=true); Lora\'s prompt is UNCHANGED (no outage claim). detail:',
      detail
    )
    return { paused: false, state: 'unknown', until: null, since: null, reason: `sentinel READ FAILURE (not a quota block): ${detail}` }
  }

  const until = ((data?.backfill_block_window as string) ?? null) || null
  const reason = ((data?.backfill_block_reason as string) ?? null) || null
  const since = ((data?.backfill_block_at as string) ?? null) || null
  if (!data?.backfill_blocked) return { paused: false, state: 'not_blocked', until, since, reason }
  if (until && Date.now() >= new Date(until).getTime()) return { paused: false, state: 'not_blocked', until, since, reason } // window elapsed → resumed
  return { paused: true, state: 'blocked', until, since, reason }
}

// WRITE the global pause. block_window carries the reset ISO the quota error reported.
export async function writeGoogleQuotaPause(resetIso: string, detail: string): Promise<void> {
  const nowIso = new Date().toISOString()
  await supabaseAdmin.from('sync_state').upsert(
    {
      client_id: GOOGLE_QUOTA_SENTINEL_CLIENT,
      platform: GOOGLE_QUOTA_PLATFORM,
      backfill_blocked: true,
      backfill_block_window: resetIso,
      backfill_block_reason: ('google_quota: ' + detail).slice(0, 500),
      backfill_block_at: nowIso,
      updated_at: nowIso,
    },
    { onConflict: 'client_id,platform' }
  )
}

// LORAMER_QUOTA_ARM_AT_ERROR_BOUNDARY_V1 — ARM THE SENTINEL WHERE THE ERROR IS OBSERVED.
//
// ⛔ THE DEFECT THIS CLOSES, MEASURED 2026-07-31: `writeGoogleQuotaPause` had EXACTLY ONE caller in the whole
// codebase — cron/drain/route.ts:314 — while FOUR modules read the sentinel. So a quota error arriving in
// catchup, in forward, or on the live path could never arm it. On 2026-07-31 that is exactly what happened:
// catchup burned 13,869 of the fleet's 15,075 raw requests between 11:19Z and 11:59Z, the developer-scope token
// was exhausted, and the sentinel still read NOT BLOCKED at 23:55Z because the ONE lane that can write it (the
// drain) was the ONE lane that made no Google calls that day — the op budget declined it 180 times before it
// reached the API. THE SINGLE WRITER WAS THE SINGLE LANE THAT COULD NOT OBSERVE THE EVENT.
//
// RULE-HOME LAW applied: the rule "a quota error arms the sentinel" lived in a ROUTE and was broken in three
// other routes. It belongs at the ERROR BOUNDARY, which every lane necessarily passes through. This function is
// that home; the retry wrappers and the swallow point call it, and no route has to remember anything.
//
// ⚠ NOT A UNIVERSAL FUNNEL, AND THE HONEST VERSION MATTERS: there is no single wrapper every Google call
// passes through. `withGoogleRetry` (backfill/retry.ts) is NOT it — the live path and the forward path both
// bypass it entirely, and it did not classify quota errors at all. The actual boundaries are **FIVE**, and all
// five call this: withGaqlRetry (lib/google-retry.ts), gaqlWithRetry (backfill/gaql-with-retry.ts),
// withGoogleRetry (backfill/retry.ts), safeQuery (intelligence/google-intelligence.ts) and — added 2026-08-09 —
// armingStream (backfill/universe-vendor-stream.ts). The guard asserts all five, by name and by count.
// ⛔ IT READ "FOUR" UNTIL 2026-08-09 AND THE FIFTH IS THE ONE THIS COMMENT SAID WOULD NOT BE CAUGHT. The v2
// universe walk called `customer.queryStream(gaql)` bare — no wrapper, no arm — for the whole of its life, so
// an armed sentinel stopped forward/drain/catchup and did NOT stop the walk, and a refusal the walk observed
// taught the fleet nothing. Found by the 2026-08-09 sweep (★WALK-DOES-NOT-READ-OR-ARM-THE-QUOTA-SENTINEL), by
// reading, not by the guard. THE COUNT IS DELIBERATELY EXACT rather than "at least N": the value of the list is
// that the number of places a refusal can be observed is KNOWN, and a sixth must cost someone an edit here.
//
// IDEMPOTENT BY CONSTRUCTION: the write is an upsert on one sentinel row, so two boundaries observing the same
// error (withGaqlRetry throws GoogleQuotaError → safeQuery catches it) write the same value twice, harmlessly.
// Best-effort on purpose — a failed arm must never convert a fetch error into a 500.
export async function noteGoogleQuotaError(
  err: unknown,
  site: string
): Promise<{ quota: boolean; resetIso?: string; detail?: string }> {
  // Accept BOTH shapes: the typed GoogleQuotaError a retry wrapper already threw (carries resetIso), and the raw
  // GoogleAdsFailure. Reading only one of them is how a re-thrown error stops being recognisable.
  let resetIso: string | undefined
  let detail: string | undefined
  if (err instanceof GoogleQuotaError) {
    resetIso = err.resetIso
    detail = err.message
  } else {
    const k = classifyGoogleAdsError(err)
    if (!k.quota) return { quota: false }
    resetIso = k.resetIso
    detail = k.detail
  }
  if (!resetIso) return { quota: false } // a quota classification with no reset is not actionable as a pause

  try {
    await writeGoogleQuotaPause(resetIso, `${detail ?? 'developer-scope quota'} [armed at ${site}]`)
    console.error(
      `[google-quota] SENTINEL ARMED at ${site} — developer-scope quota exhausted, pause until ${resetIso}. ` +
      'Every google lane now holds until that window elapses (clock-based auto-resume, no manual unblock).'
    )
  } catch (e: any) {
    // LOUD. A silent failure here is the 2026-07-31 defect all over again, one level down.
    console.error(`[google-quota] SENTINEL ARM FAILED at ${site} (${String(e?.message ?? e)}) — the pause was NOT persisted; lanes will keep firing into an exhausted token.`)
  }
  return { quota: true, resetIso, detail }
}
