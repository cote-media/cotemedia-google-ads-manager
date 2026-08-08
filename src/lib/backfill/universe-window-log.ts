// LORAMER_UNIVERSE_WINDOW_LOG_V1 — DURABLE PER-WINDOW PROGRESS + THE HARD DISK FLOOR.
//
// ⛔ WHAT THIS EXISTS TO PREVENT, and it is not hypothetical. The measured cost of one 30-day window
// for one client is +4.53 GB of disk (LORAMER_UNIVERSE_ONE_WINDOW_MEASURED_V1: 832 B/row across
// 5,448,391 rows). The walk is 50 windows. Headroom above the floor on 2026-08-04 is 49 GB. The walk
// therefore REACHES THE FLOOR AROUND WINDOW 11 OF 50 — not as a risk, as arithmetic. Without a floor
// check the walk does not slow down or degrade; it fills the volume, and a full disk on Postgres is
// an outage, not a slow query. This module is the thing that makes that stop CLEAN and RECORDED.
//
// ⛔ THE FLOOR IS CHECKED BEFORE EVERY WINDOW, NOT ONCE AT THE START. A 3-day unattended walk shares
// the disk with the forward lane, the drain, WAL and autovacuum. Headroom measured on Monday is not
// a fact about Wednesday.
import { supabaseAdmin } from '@/lib/supabase'

export const VENDOR = 'google_ads' // ⛔ NOT 'google' — LORAMER_CAPTURE_UNIVERSE_NAMED_FOR_THE_API_V1.
const TABLE = 'universe_window_log'

// ⛔ PROVISIONED IS A STATED CONSTANT AND POSTGRES CANNOT SEE IT. **280 GB, raised by Russ 2026-08-04**
// (was 200 GB from 2026-08-03). scripts/partition-backfill.mjs carries the SAME number and the guard
// asserts they agree — one disk may have exactly one provisioned figure and exactly one floor, or one
// of them gets forgotten. If the volume is resized again this MUST move in BOTH places in the same
// commit: a stale value here authorises a walk against headroom that does not exist.
export const PROVISIONED_BYTES = 280 * 1024 ** 3
// max(15 GB, 20% of provisioned) = 56 GiB at the CURRENT 280 GB. Identical rule to the partition backfill,
// deliberately: two different floors for the same disk is how one of them gets forgotten.
// ⛔ THE NUMBER IN THIS COMMENT READ "40 GB" UNTIL 2026-08-07 — correct for the 200 GB provisioned it was
// written against, and stale from the moment Russ raised the volume to 280 GB on 2026-08-04. A wrong number
// stating the SAFETY FLOOR is the class this repo keeps paying for; the expression below was always right.
// If PROVISIONED_BYTES moves again, this sentence moves with it or it becomes a lie again.
// ⛔ AND THIS IS THE LIMIT THAT ACTUALLY BINDS THE WALK. migrations/059 adds an absolute 500 GiB ceiling
// inside universe_disk_headroom() as the OUTER authorization (LORAMER_UNIVERSE_DISK_CEILING_V1); it cannot
// trip while provisioned is 280 GB, because this floor stops the walk 276 GiB earlier.
export const FLOOR_BYTES = Math.max(15 * 1024 ** 3, Math.floor(PROVISIONED_BYTES * 0.2))

export const gb = (b: number) => (b / 1024 ** 3).toFixed(2) + ' GB'

export interface Headroom { usedBytes: number; freeBytes: number }

/**
 * ⛔ A FAILED READ IS A REFUSAL, NEVER AN ASSUMPTION OF HEADROOM. `.catch(() => [])` is the house
 * pathology and it would be lethal here: the one place a swallowed error buys you a full disk.
 */
export async function readHeadroom(): Promise<Headroom> {
  const { data, error } = await supabaseAdmin.rpc('universe_disk_headroom', {
    provisioned_bytes: PROVISIONED_BYTES,
  })
  if (error) {
    throw new Error(
      `REFUSING TO WALK BLIND — could not read disk headroom: ${error.message}. ` +
        `migrations/054_universe_window_log.sql (054b) creates universe_disk_headroom(); apply it before running.`
    )
  }
  const row = Array.isArray(data) ? data[0] : data
  const usedBytes = Number(row?.used_bytes)
  const freeBytes = Number(row?.free_bytes)
  if (!Number.isFinite(usedBytes) || !Number.isFinite(freeBytes) || usedBytes <= 0) {
    throw new Error(`REFUSING TO WALK BLIND — disk headroom read returned nothing usable: ${JSON.stringify(row)}`)
  }
  return { usedBytes, freeBytes }
}

export interface FloorVerdict {
  ok: boolean
  freeBytes: number
  usedBytes: number
  reason: string
}

/** THE GATE. Returns a verdict rather than throwing, so the caller can RECORD the stop before exiting. */
export async function checkDiskFloor(): Promise<FloorVerdict> {
  const { usedBytes, freeBytes } = await readHeadroom()
  if (freeBytes < FLOOR_BYTES) {
    return {
      ok: false, freeBytes, usedBytes,
      reason:
        `DISK FLOOR BREACHED: ${gb(freeBytes)} free, floor is ${gb(FLOOR_BYTES)} ` +
        `(used ${gb(usedBytes)} of ${gb(PROVISIONED_BYTES)}). Stopping cleanly BEFORE spending the request. ` +
        `The walk does not resume until headroom is restored — this is not a retryable error.`,
    }
  }
  return {
    ok: true, freeBytes, usedBytes,
    reason: `${gb(freeBytes)} free of ${gb(PROVISIONED_BYTES)} · floor ${gb(FLOOR_BYTES)} · ${gb(freeBytes - FLOOR_BYTES)} above it`,
  }
}

// ── LORAMER_UNIVERSE_BOUNDED_RUN_V1 — THE RE-PUBLISH DECISION, AS A PURE FUNCTION ─────────────────
// ⛔ IT IS PURE AND EXPORTED SO A GUARD CAN EXECUTE IT. Written inline in the route, the bound could
// only be guarded by searching the source for a variable name — and that check went GREEN against a
// break that replaced the whole expression with `false`, because the NAME survived. That is the third
// time in one day that a text-search guard passed over broken behaviour
// (★CODE-HYGIENE-SWEEP-KNOWN-HAZARDS item 3). A decision that must be guarded has to be callable.
export function shouldRepublish(args: { stillGoing: boolean; windowsRemaining?: number }): {
  republish: boolean
  nextWindowsRemaining?: number
  reason: string
} {
  if (!args.stillGoing) {
    return { republish: false, reason: 'the vendor is exhausted, or this window was skipped or errored — nothing to continue' }
  }
  // UNDEFINED = unbounded. That is the original behaviour and stays the default.
  if (typeof args.windowsRemaining !== 'number') {
    return { republish: true, reason: 'unbounded run — continue until the vendor, the governor or the disk floor stops it' }
  }
  if (args.windowsRemaining <= 1) {
    return { republish: false, reason: `bound reached (windowsRemaining=${args.windowsRemaining}) — this chain was asked for a fixed number of windows and has walked them. The vendor still had rows; that is not a reason to continue.` }
  }
  return { republish: true, nextWindowsRemaining: args.windowsRemaining - 1, reason: `bounded run, ${args.windowsRemaining - 1} window(s) left after this one` }
}

export interface WindowKey {
  clientId: string
  resource: string
  segment: string | null
  windowStart: string
  windowEnd: string
}
const seg = (s: string | null) => s ?? ''

/**
 * OPEN THE WINDOW AS `running` BEFORE THE VENDOR IS CALLED.
 * ⛔ THE ORDER IS THE POINT. Written first, so a process killed mid-request leaves a row that reads
 * `running` — the failure it actually is. A log written only on success cannot distinguish "never
 * started" from "died halfway", which is the exact ambiguity that made the drain unreadable.
 */
/**
 * ⛔ LORAMER_UNIVERSE_FAILURE_IS_DURABLE_V1 — THIS IS AN RPC AND NOT AN UPSERT, AND THE REASON IS MECHANICAL.
 * PostgREST's `.upsert()` can only set a column to the value SUPPLIED, never to an expression over the
 * existing row, so `attempts = attempts + 1` is not expressible there. Worse, the payload this replaced wrote
 * `rows_written: 0, requests_spent: 0, refused_rows: 0, error: null, finished_at: null` on EVERY open — so an
 * attempts field written the same way would have RESET to 1 on every redelivery and counted BACKWARDS.
 *
 * ⛔ IT RETURNS THE ATTEMPT COUNT. The retry bound has nothing to bound on otherwise, and three separate
 * 300-second poison loops (ids 2871, 17959, 17966) are what a bound would have stopped.
 *
 * ⛔ `requestsSpentAtDispatch` DEFAULTS TO 1 — THE SPEND IS RECORDED BEFORE THE VENDOR IS CALLED, NOT AFTER.
 * `closeWindow` reconciles it DOWN to 0 when the vendor was demonstrably never called. Pessimistic on
 * purpose: an optimistic counter fails toward spending the fleet's quota against a pause nobody can see, and
 * this repo has already paid for that once (the governor reading 997 of 10,788). Pass 0 explicitly on the
 * paths that open a row only to record a refusal.
 * ⚠ THE MEANING OF universe_window_log.requests_spent IS THEREFORE "DISPATCHED", NOT "ANSWERED". Every reader
 * over-counts rather than under-counts, which is the safe direction: readLaneSpendToday (migrations/057),
 * google-op-budget's backfill lane, and scripts/universe-walk-progress.sql.
 */
export async function openWindow(k: WindowKey, diskFreeBytes: number, requestsSpentAtDispatch = 1): Promise<number> {
  const { data, error } = await supabaseAdmin.rpc('universe_window_open', {
    p_client_id: k.clientId,
    p_vendor: VENDOR,
    p_resource: k.resource,
    p_segment: seg(k.segment),
    p_window_start: k.windowStart,
    p_window_end: k.windowEnd,
    p_disk_free_bytes: diskFreeBytes,
    p_requests_spent: requestsSpentAtDispatch,
  })
  if (error) {
    throw new Error(
      `universe_window_log open failed: ${error.message}. ` +
        `migrations/060_universe_window_attempts.sql creates public.universe_window_open(); apply it before running.`
    )
  }
  const attempts = Number(Array.isArray(data) ? (data[0] as any)?.universe_window_open ?? data[0] : data)
  // ⛔ AN UNUSABLE COUNT IS A REFUSAL, NEVER A 1. Defaulting it would silently disarm the retry bound, which
  // is the one thing standing between a too-large window and an unbounded redelivery loop.
  if (!Number.isFinite(attempts) || attempts < 1) {
    throw new Error(`universe_window_open returned no usable attempt count: ${JSON.stringify(data)}`)
  }
  return attempts
}

/**
 * ⛔ `abandoned_owed` IS NOT `error`, AND THE DISTINCTION IS THE WHOLE POINT (migration 060).
 * `error` means WE ASKED AND IT FAILED — the vendor's own words go in `error`.
 * `abandoned_owed` means WE STOPPED ASKING AND THIS WINDOW IS STILL OWED. Both are terminal to
 * `windowAlreadyFinished` (its test is `outcome !== 'running'`), so both break a redelivery loop — but only
 * one of them is findable by `where outcome = 'abandoned_owed'`, which is how the system lists the work it
 * knows it owes. The first two orphans were stored as `error` and were invisible to their own owed-list.
 */
export type WindowOutcome = 'ok' | 'zero' | 'skipped' | 'error' | 'floor_stop' | 'quota_stop' | 'abandoned_owed'

/**
 * CLOSE THE WINDOW WITH AN EXPLICIT OUTCOME.
 * ⛔ `outcome` IS A PARAMETER, NEVER DERIVED FROM A TIMESTAMP OR FROM rows>0. Zero rows can mean the
 * vendor answered and named nothing ('zero' — a FACT) or that we never asked ('skipped'); those are
 * different facts and no amount of inspecting the row count can tell them apart afterwards.
 * ⛔ finished_at USES THE DATABASE'S clock_timestamp(), NOT now() AND NOT THE NODE CLOCK — the
 * 2026-08-04 bug where a 158-second job logged finished_at == started_at came from now() meaning
 * TRANSACTION START.
 */
export async function closeWindow(
  k: WindowKey,
  fields: { outcome: WindowOutcome; rowsWritten: number; requestsSpent: number; refusedRows: number; error: string | null }
): Promise<void> {
  const { error } = await supabaseAdmin
    .from(TABLE)
    .update({
      outcome: fields.outcome,
      rows_written: fields.rowsWritten,
      requests_spent: fields.requestsSpent,
      refused_rows: fields.refusedRows,
      error: fields.error,
      finished_at: new Date().toISOString(),
    })
    .eq('client_id', k.clientId).eq('vendor', VENDOR).eq('resource', k.resource)
    .eq('segment', seg(k.segment)).eq('window_start', k.windowStart)
  if (error) throw new Error(`universe_window_log close failed: ${error.message}`)
}

/**
 * ⛔ THE GOVERNOR'S INPUT, AND THE TWO DEFECTS IT REPLACES. BOTH WERE SILENT AND BOTH BILLED THE
 * WRONG NUMBER — in opposite directions, which is why only the second one was dangerous.
 *
 * (1) universe_run_state.requests_spent is CUMULATIVE PER ENTRY, and readBackfillRequestsToday()
 *     summed it across every row touched today. From day 2 the governor bills the walk for day 1 and
 *     refuses to publish — a 3-day walk halts reporting "allowance EXHAUSTED" having spent nothing.
 *     That over-read stopped the walk, so it announced itself. Fixed by one row per (entry, window).
 *
 * (2) ⛔ LORAMER_LANE_SPEND_IS_SERVER_SIDE_V1 — AND THE FIX FOR (1) IS WHAT CAUSED IT. A
 *     row-per-window table crosses PostgREST's 1,000-row page cap on day one, and an un-ranged
 *     select is TRUNCATED THERE WITH NO ERROR — the only signal is a response header:
 *         content-range: 0-999/10788   →  1,000 rows returned, sum 997
 *     MEASURED ON THE REAL PATH 2026-08-05 13:00Z, through the same PostgREST endpoint supabaseAdmin
 *     uses. The walk had spent 10,788 requests against a 6,000/day allowance; the governor read 997,
 *     said yes ~10,800 times in a row, and wrote ZERO quota_stop rows while eating the reserve that
 *     LORAMER_BACKFILL_YIELDS_TO_PRODUCT_V1 holds for forward and drain. An UNDER-read does not stop
 *     anything, which is exactly why it ran for eleven hours unnoticed.
 *
 * ⛔ THE SUM IS NOW POSTGRES'S JOB. universe_lane_spend_today() (migrations/057) is one indexed
 * aggregate over universe_window_log_spend_idx — no page cap can apply to a scalar, and the read
 * costs one round trip at ~2,000 governor calls an hour rather than eleven and climbing.
 *
 * ⛔ FAIL CLOSED, TWICE. A failed read THROWS (the message fails, nothing publishes), and a reply that
 * is not a finite number THROWS TOO — `Number(null)` is 0, and a spend of 0 is the one value that
 * authorises the maximum possible publish. "I could not read it" must never arrive as "nothing spent".
 *
 * ⚠ THE DAY BOUNDARY IS OURS AND IT IS NOT GOOGLE'S. This counts from 00:00Z; the developer-scope
 * quota resets ~08:03:57Z, which is why the same walk reads 11,130 on our clock and 6,190 on
 * Google's. Deliberately left alone HERE: the fleet read in google-op-budget uses the same 00:00Z
 * boundary, and moving one without the other makes the two lanes disagree about what day it is.
 *
 * ⛔ `since` IS OPTIONAL AND ADDITIVE — LORAMER_GOOGLE_OP_BUDGET_BACKFILL_LANE_COUNTED_V3 (flight 2).
 * The walk's own governor still calls this with NO argument and its behaviour is byte-for-byte
 * unchanged. The parameter exists because the FLEET read in google-op-budget must bill this same
 * number against the same day, and it computes its own 00:00Z boundary for the cron_runs lanes —
 * passing that boundary in is what makes the two reads provably the same day rather than two
 * independently-computed midnights that agree by luck. It is also what lets the guard evaluate this
 * function over a REAL PAST WINDOW (2026-08-05) instead of a synthetic one.
 */
export async function readLaneSpendToday(since?: Date): Promise<number> {
  const from = since ? new Date(since) : new Date()
  if (!since) from.setUTCHours(0, 0, 0, 0)
  const { data, error } = await supabaseAdmin.rpc('universe_lane_spend_today', {
    p_vendor: VENDOR,
    p_since: from.toISOString(),
  })
  if (error) {
    throw new Error(
      `REFUSING TO PUBLISH BLIND — lane spend read failed: ${error.message}. ` +
        `migrations/057_universe_lane_spend_fn.sql creates universe_lane_spend_today(); apply it before running.`
    )
  }
  // ⛔ ABSENCE IS CHECKED BEFORE CONVERSION, AND THIS GUARD LEG CAUGHT ME WRITING IT THE OTHER WAY
  // ROUND. `Number(null)` is 0 — a finite, non-negative, entirely plausible spend — so converting
  // first turns "the function returned nothing" into "the walk has spent nothing today", which is the
  // single most permissive answer the governor can be given. The check must reject the ABSENCE, not
  // the number it silently becomes.
  const raw = Array.isArray(data) ? data[0] : data
  const spent = raw === null || raw === undefined ? NaN : Number(raw)
  if (!Number.isFinite(spent) || spent < 0) {
    throw new Error(
      `REFUSING TO PUBLISH BLIND — lane spend read returned ${JSON.stringify(data)}, which is not a spend. ` +
        `Treating an unreadable counter as zero would authorise the largest possible publish at the exact ` +
        `moment the governor has gone blind.`
    )
  }
  return spent
}

/**
 * HAS THIS EXACT WINDOW ALREADY FINISHED? The resume test.
 * ⛔ TERMINAL ONLY. A row reading `running` is NOT finished — it is a window that died, and it must
 * be re-walked. Treating `running` as done is how a partial walk reports success.
 */
export interface ResumeVerdict {
  /** Skip the capture and advance. */
  skip: boolean
  /** Why — stated so a skip is auditable rather than inferred from a quiet log line. */
  reason: string
}

/**
 * ⛔ LORAMER_UNIVERSE_RESUME_IS_COVERAGE_V1, 2026-08-08 — A ROW MAY ONLY SKIP A WINDOW IT ACTUALLY COVERED.
 *
 * THE DEFECT THIS REPLACES: the old test selected on the UNIQUE KEY
 * `(client_id, vendor, resource, segment, window_start)` and returned `outcome !== 'running'`. **`window_end`
 * is in NEITHER the key nor the test**, so a window was matched by its START ALONE regardless of its LENGTH,
 * and ANY terminal outcome counted as "finished" — including outcomes that captured nothing.
 * OBSERVED LIVE 2026-08-08 20:53Z: the 15-day window `2022-02-26..2022-03-12` was skipped against row 18016,
 * whose window is `2022-02-26..2022-03-27` — thirty days. That skip happened to be CORRECT (the 30-day row
 * is a strict superset and had outcome `ok`), which is exactly why it was invisible: the test was right by
 * accident, on evidence it never actually checked.
 *
 * ⛔ THE CASE THAT IS NOT AN ACCIDENT, and it blocks a repair we owe: owed row 2871 covers
 * `2025-12-07..2026-01-05` with outcome `abandoned_owed` — captured NOTHING. Re-walking its older half means
 * publishing `2025-12-07..2025-12-21`, whose start is IDENTICAL. Under the old test that re-walk was matched
 * by 2871 and SILENTLY SKIPPED, so the half could never be recovered.
 *
 * ⛔ TWO TESTS, NOT ONE, AND THE SPLIT IS THE WHOLE DESIGN:
 *  (1) COVERAGE — CONTAINMENT, not exact match, and ONLY from an outcome that actually captured:
 *      `outcome IN ('ok','zero') AND window_start <= wanted.start AND window_end >= wanted.end`.
 *      Containment is the correct semantic: a 30-day `ok` row genuinely did capture every 15-day sub-range
 *      inside it, and re-asking would spend a vendor request to re-learn it. `zero` counts because the vendor
 *      ANSWERED and named nothing — a fact, not an absence (migrations/054's own words).
 *      ⛔ `abandoned_owed`, `error`, `skipped`, `floor_stop` and `quota_stop` CAN NEVER COVER ANYTHING. None
 *      of them means the range was captured; treating them as coverage is what made an owed window
 *      unrecoverable.
 *  (2) THE REDELIVERY SHORT-CIRCUIT — EXACT range only. At-least-once delivery means the same message can
 *      arrive twice, and a non-capturing terminal row for the IDENTICAL window must still stop the loop —
 *      that is what broke the three poison loops of 2026-08-08 and it must not regress. But it stops the
 *      loop for THAT window and nothing else: a different length, or a different start, is a different
 *      window and gets walked.
 *
 * ⛔ NO MIGRATION IS REQUIRED AND THE UNIQUE CONSTRAINT IS UNTOUCHED. The constraint governs the UPSERT
 * conflict target — one row per (entry, window_start) — and that is still exactly the shape we want:
 * re-opening a window overwrites its own row rather than accumulating duplicates. This is a READ-SIDE fix.
 * `universe_window_log_resume_idx (client_id, vendor, outcome, window_start DESC)` already serves the
 * filtered scan, and the table is 9.5 MB.
 */
export async function windowResumeVerdict(k: WindowKey): Promise<ResumeVerdict> {
  const { data, error } = await supabaseAdmin
    .from(TABLE)
    .select('outcome, window_start, window_end')
    .eq('client_id', k.clientId).eq('vendor', VENDOR).eq('resource', k.resource)
    .eq('segment', seg(k.segment))
    .lte('window_start', k.windowStart)
  if (error) throw new Error(`universe_window_log resume read failed: ${error.message}`)
  const rows = (data ?? []) as Array<{ outcome: string; window_start: string; window_end: string }>

  const covering = rows.find(
    (r) => (r.outcome === 'ok' || r.outcome === 'zero') && r.window_start <= k.windowStart && r.window_end >= k.windowEnd
  )
  if (covering) {
    return {
      skip: true,
      reason: `COVERED by a captured window ${covering.window_start}..${covering.window_end} (outcome ${covering.outcome}) — re-asking would spend a vendor request to re-learn ground already held`,
    }
  }
  const exactTerminal = rows.find(
    (r) => r.window_start === k.windowStart && r.window_end === k.windowEnd && r.outcome !== 'running'
  )
  if (exactTerminal) {
    return {
      skip: true,
      reason: `TERMINAL for this exact window (outcome ${exactTerminal.outcome}) — the redelivery short-circuit. ⛔ NOT a coverage claim: this range was not captured and, if the outcome is abandoned_owed, it is still OWED`,
    }
  }
  return {
    skip: false,
    reason: `not covered — ${rows.length} earlier-or-equal row(s) for this entry, none of them a captured window containing ${k.windowStart}..${k.windowEnd}`,
  }
}

