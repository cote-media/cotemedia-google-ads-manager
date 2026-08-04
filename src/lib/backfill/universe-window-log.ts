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
// max(15 GB, 20% of provisioned) = 40 GB. Identical rule to the partition backfill, deliberately:
// two different floors for the same disk is how one of them gets forgotten.
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
export async function openWindow(k: WindowKey, diskFreeBytes: number): Promise<void> {
  const { error } = await supabaseAdmin.from(TABLE).upsert(
    {
      client_id: k.clientId, vendor: VENDOR, resource: k.resource, segment: seg(k.segment),
      window_start: k.windowStart, window_end: k.windowEnd,
      outcome: 'running', disk_free_bytes: diskFreeBytes,
      rows_written: 0, requests_spent: 0, refused_rows: 0, error: null, finished_at: null,
    },
    { onConflict: 'client_id,vendor,resource,segment,window_start' }
  )
  if (error) throw new Error(`universe_window_log open failed: ${error.message}`)
}

export type WindowOutcome = 'ok' | 'zero' | 'skipped' | 'error' | 'floor_stop'

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
 * ⛔ THE GOVERNOR'S INPUT, AND THE DEFECT IT REPLACES.
 * universe_run_state.requests_spent is CUMULATIVE PER ENTRY (upserted as prior + new), and the old
 * readBackfillRequestsToday() summed it across every row whose updated_at fell today. On day 1 that
 * is right by accident. On day 2 every entry touched today reports its LIFETIME spend, so the
 * governor bills the walk for yesterday's requests and refuses to publish — a 3-day walk halts on
 * day 2 reporting "allowance EXHAUSTED" while having spent nothing that day.
 * Here each row IS one window, so summing today's rows is today's spend BY CONSTRUCTION. There is no
 * accumulation to get wrong.
 */
export async function readLaneSpendToday(): Promise<number> {
  const since = new Date()
  since.setUTCHours(0, 0, 0, 0)
  const { data, error } = await supabaseAdmin
    .from(TABLE)
    .select('requests_spent')
    .eq('vendor', VENDOR)
    .gte('started_at', since.toISOString())
  if (error) throw new Error(`universe_window_log spend read failed: ${error.message}`)
  return (data || []).reduce((a: number, r: any) => a + Number(r.requests_spent || 0), 0)
}

/**
 * HAS THIS EXACT WINDOW ALREADY FINISHED? The resume test.
 * ⛔ TERMINAL ONLY. A row reading `running` is NOT finished — it is a window that died, and it must
 * be re-walked. Treating `running` as done is how a partial walk reports success.
 */
export async function windowAlreadyFinished(k: WindowKey): Promise<boolean> {
  const { data, error } = await supabaseAdmin
    .from(TABLE)
    .select('outcome')
    .eq('client_id', k.clientId).eq('vendor', VENDOR).eq('resource', k.resource)
    .eq('segment', seg(k.segment)).eq('window_start', k.windowStart)
    .maybeSingle()
  if (error) throw new Error(`universe_window_log resume read failed: ${error.message}`)
  const outcome = (data as any)?.outcome
  return !!outcome && outcome !== 'running'
}
