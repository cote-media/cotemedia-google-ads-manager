// LORAMER_GOOGLE_FWD_QUOTA_RESERVE_V1 — reserve the daily FORWARD google quota slice ahead of the deep-history drain.
//
// PROBLEM (banked; ★GOOGLE-QUOTA-PRIORITY-INVERSION): the Google Ads dev-token quota (Basic = 15k ops/day,
// developer-scoped = GLOBAL across every google client) resets ~08:03:57 UTC. The deep-geo drain fires every 5 min
// (vercel.json google drain "*/5") so it hits the fresh quota at 08:05 — BEFORE the daily forward pass (first fire
// 08:08). Nothing sequences them (forward claims "__fwd_google", the drain claims "__drain_google" — different keys),
// and LORAMER_GOOGLE_QUOTA_GUARD_V1 only reacts AFTER exhaustion. So the drain can burn the day's quota before forward
// runs → forward capture is starved.
//
// THIS: a time-gated reserve consulted in the google drain path. Within RESET_WINDOW_MINUTES after the reset, if
// today's google FORWARD pass has NOT finished, the drain returns early (skipQuotaReserve) WITHOUT claiming any
// connection — leaving the fresh quota for forward. It releases EARLY the moment forward finishes (the forwardPending
// gate) and NEVER holds past the window cap (so an anomalous long forward run cannot freeze backfill all day).
//
// "forward finished" is forward's OWN authoritative signal, NOT a heuristic: every active google client's
// sync_state(platform='google').last_forward_sync_date === captureDate — the field cron/sync/route.ts writes on
// completion (:748) and reads in its own pendingForwardClients (:123). captureDate = resolveDateWindow('YESTERDAY')
// .startDate — the SAME call forward uses (cron/sync/route.ts:173) so the two never disagree on which day is "today".

import { supabaseAdmin } from '@/lib/supabase'
import { resolveDateWindow } from '@/lib/date-range'
import { GOOGLE_QUOTA_SENTINEL_CLIENT, GOOGLE_QUOTA_PLATFORM } from './google-quota'

// Window sized from the MEASURED forward span (cron_runs, mode=forward platform=google, 7 days to 2026-07-24): forward
// starts ~08:08 (≈4.5 min after the ~08:03:57 reset) and its TYPICAL last-finish is ~10:58 → ~175 min from the reset.
// 180 covers the FULL typical run (not just its start) with ~5 min margin. It is ALSO a hard cap: the forwardPending
// gate releases the drain the instant forward finishes on a normal day, so the cap only bites on an ANOMALOUS long run
// (e.g. 2026-07-18 ran to 17:37) — where releasing backfill at reset+180m is deliberate, so a stuck/anomalous forward
// can never starve backfill for the whole day. Raise it only if the outlier days must also be fully covered.
export const RESET_WINDOW_MINUTES = 180

// Fallback reset time-of-day (UTC) if the __google_quota marker is absent/unparseable. Matches the observed
// 08:03:57.345Z reset. The live value is read from the marker each fire so it tracks Google's actual reset.
const DEFAULT_RESET_UTC: ResetTimeOfDay = { h: 8, m: 3, s: 57 }

export interface ResetTimeOfDay { h: number; m: number; s: number }

// PURE: parse the UTC time-of-day from the marker's reset ISO (the date part is ignored — only the daily wall-clock
// matters, since the reset recurs at the same UTC time each day).
export function parseResetTimeOfDay(iso: string | null | undefined): ResetTimeOfDay {
  if (!iso) return DEFAULT_RESET_UTC
  const d = new Date(iso)
  if (isNaN(d.getTime())) return DEFAULT_RESET_UTC
  return { h: d.getUTCHours(), m: d.getUTCMinutes(), s: d.getUTCSeconds() }
}

// PURE: given now (ms epoch), the daily reset time-of-day (UTC), and the window length (min), locate now relative to
// TODAY's reset. inResetWindow = 0 ≤ (now − todaysReset) ≤ windowMinutes. Deterministic — the drain injects Date.now()
// and a dry-run injects any timestamp, so this is unit-provable at any boundary.
export function computeResetWindow(
  nowMs: number,
  reset: ResetTimeOfDay,
  windowMinutes: number,
): { todaysResetMs: number; minutesSinceReset: number; inResetWindow: boolean } {
  const n = new Date(nowMs)
  const todaysResetMs = Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate(), reset.h, reset.m, reset.s)
  const minutesSinceReset = (nowMs - todaysResetMs) / 60000
  const inResetWindow = minutesSinceReset >= 0 && minutesSinceReset <= windowMinutes
  return { todaysResetMs, minutesSinceReset, inResetWindow }
}

// DB read: the reset time-of-day from the __google_quota sentinel (backfill_block_window carries the reset ISO Google
// last reported). Fallback to DEFAULT_RESET_UTC when the marker is missing/unparseable.
export async function readResetTimeOfDay(): Promise<ResetTimeOfDay> {
  const { data } = await supabaseAdmin
    .from('sync_state')
    .select('backfill_block_window')
    .eq('client_id', GOOGLE_QUOTA_SENTINEL_CLIENT)
    .eq('platform', GOOGLE_QUOTA_PLATFORM)
    .maybeSingle()
  return parseResetTimeOfDay((data?.backfill_block_window as string | undefined) ?? null)
}

// DB read: is today's google FORWARD pass still pending? Mirrors cron/sync pendingForwardClients (:123) but scoped to
// the clients forward will ACTUALLY capture — a real google connection (account_id present) whose client is NOT
// archived — so a dead/archived/no-account client (which forward never syncs, so its cursor never advances) can never
// hold the reserve open forever. pending = any such client whose google forward cursor
// (sync_state.last_forward_sync_date) ≠ captureDate. Archived filter mirrors the drain's own (cron/drain/route.ts:93).
export async function googleForwardProgress(
  captureDate: string,
): Promise<{ activeClients: number; completedClients: number; pending: boolean }> {
  const { data: conns } = await supabaseAdmin
    .from('platform_connections')
    .select('client_id')
    .eq('platform', 'google')
    .not('account_id', 'is', null)
  const ids = Array.from(new Set((conns ?? []).map((r: any) => r.client_id as string).filter(Boolean)))
  if (ids.length === 0) return { activeClients: 0, completedClients: 0, pending: false }

  const { data: arch } = await supabaseAdmin
    .from('clients')
    .select('id')
    .in('id', ids)
    .not('deleted_at', 'is', null)
  const archived = new Set((arch ?? []).map((a: any) => a.id as string))
  const activeIds = ids.filter((id) => !archived.has(id))
  if (activeIds.length === 0) return { activeClients: 0, completedClients: 0, pending: false }

  const { data: ss } = await supabaseAdmin
    .from('sync_state')
    .select('client_id, last_forward_sync_date')
    .eq('platform', 'google')
    .in('client_id', activeIds)
  const doneByClient = new Map<string, string | null>()
  for (const r of ss ?? []) doneByClient.set((r as any).client_id, (r as any).last_forward_sync_date)
  const completedClients = activeIds.filter((id) => doneByClient.get(id) === captureDate).length
  return { activeClients: activeIds.length, completedClients, pending: completedClients < activeIds.length }
}

export interface ReserveDecision {
  skip: boolean
  inResetWindow: boolean
  forwardPending: boolean
  windowMinutes: number
  minutesSinceReset: number
  resetTimeUtc: string // "HH:MM:SS" (UTC) — the daily reset wall-clock in force this fire
  captureDate: string
  activeClients: number
  completedClients: number
}

// The full decision the google drain consults. `nowMs` is INJECTED (not read inside) so a Gate-A dry-run can prove the
// behavior at any timestamp. The forward-progress DB read is skipped outside the time window (cheap short-circuit).
export async function googleForwardReserveDecision(nowMs: number): Promise<ReserveDecision> {
  const reset = await readResetTimeOfDay()
  const { minutesSinceReset, inResetWindow } = computeResetWindow(nowMs, reset, RESET_WINDOW_MINUTES)
  const { startDate: captureDate } = resolveDateWindow('YESTERDAY')

  let activeClients = 0
  let completedClients = 0
  let forwardPending = false
  if (inResetWindow) {
    const p = await googleForwardProgress(captureDate)
    activeClients = p.activeClients
    completedClients = p.completedClients
    forwardPending = p.pending
  }

  const pad = (x: number) => String(x).padStart(2, '0')
  return {
    skip: inResetWindow && forwardPending,
    inResetWindow,
    forwardPending,
    windowMinutes: RESET_WINDOW_MINUTES,
    minutesSinceReset: Math.round(minutesSinceReset * 10) / 10,
    resetTimeUtc: `${pad(reset.h)}:${pad(reset.m)}:${pad(reset.s)}`,
    captureDate,
    activeClients,
    completedClients,
  }
}
