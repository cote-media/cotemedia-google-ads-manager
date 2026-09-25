// LORAMER_GOOGLE_DELETE_JOB_V1 — THE DELETION JOB: one runner, two callers (the press via waitUntil, the pump via cron).
//
// ⛔ THE RUNNER OWNS NO STATE. Every count is written by the database inside the deleting transaction
// (google_delete_log_merge, migration 100); every cursor (steps done, months done) is read back from the row at the
// start of each step. This runner can die at any instant — the platform kill at maxDuration, a crash, a redeploy —
// and the next holder (the pump, a minute later) continues from the row. The pattern is the backfill run's
// (universe_run + universe-run-pump): a claim with a reserve window, one bounded invocation at a time, the row as
// the only truth. Read first, as asked; it fits, because the run row was already the shape of a job record.
// ⛔ THE ROW IS THE LOCK. google_delete_claim is a compare-and-set; a claim that fails means another holder is live
// and this caller must not run a step. A holder that stops (time budget) releases the claim so the pump can take it
// at once; a holder that dies leaves a claim that expires after CLAIM_RESERVE_S.
import { supabaseAdmin } from '@/lib/supabase'
// ⛔ LORAMER_FIRE_CEILING_600_V1 — the quiet-wait's windows are DERIVED from the walk's own contract, never
// copied. They were bare literals (330_000 / 320_000) taken from a 300 s ceiling; at any other ceiling
// waitForQuiet would declare the walk quiet while a fire was still writing and the wipe would start under it.
import { LEASE_TTL_S, CONSUMER_MAX_DURATION_S } from '@/lib/backfill/universe-v2-contract'
import { GOOGLE_DELETE_MAX_ROWS_PER_CALL, GOOGLE_DELETE_PLATFORM, GOOGLE_DELETE_TABLES } from '@/lib/google-delete/tables'
import { decideRevoke, revokeGoogleRefreshToken } from '@/lib/google-delete/revoke'

/** The pump ticks every minute and a step never exceeds the function budget; a claim older than this is a dead holder.
 *  ⇐ PUMP_MAX_DURATION_S + 20, the universe-run-pump's STEP_RESERVE derivation (route.ts:32), applied to this job. */
export const PUMP_MAX_DURATION_S = 800
export const CLAIM_RESERVE_S = PUMP_MAX_DURATION_S + 20
export const RUN_VENDOR = 'google_ads'
const LEASE_TTL_MS = LEASE_TTL_S * 1000
const RUN_RESERVE_MS = (CONSUMER_MAX_DURATION_S + 20) * 1000 // the pump's own STEP_RESERVE form — the same window, measured the same way
const QUIET_POLL_MS = 5_000

export type JobRow = {
  id: number; confirmation_code: string; client_id: string; user_email: string | null; status: string
  claimed_by: string | null; claimed_at: string | null; received_at: string; updated_at: string; detail: any; live?: boolean
}

const isoDay = (d: Date) => d.toISOString().slice(0, 10)
const addDays = (iso: string, n: number) => { const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return isoDay(d) }
const monthStart = (iso: string) => iso.slice(0, 7) + '-01'
const nextMonth = (iso: string) => { const d = new Date(iso.slice(0, 7) + '-01T00:00:00Z'); d.setUTCMonth(d.getUTCMonth() + 1); return isoDay(d) }

async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabaseAdmin.rpc(fn, args)
  if (error) throw new Error(`${fn}: ${error.message}`)
  return data as T
}

export async function readJob(code: string): Promise<JobRow | null> {
  const { data } = await supabaseAdmin.from('platform_compliance_log').select('*').eq('confirmation_code', code).eq('platform', GOOGLE_DELETE_PLATFORM).maybeSingle()
  return (data as JobRow) ?? null
}

/** Delete one date range [lo, hi) with the job code so the DB merges the count; halve on SPLIT; one retry on MISMATCH. */
async function deleteRange(clientId: string, code: string, lo: string, hi: string, log: (s: string) => void): Promise<void> {
  try {
    await rpc('google_delete_client_metrics', { p_client: clientId, p_lo: lo, p_hi: hi, p_max_rows: GOOGLE_DELETE_MAX_ROWS_PER_CALL, p_code: code })
  } catch (e: any) {
    const msg = String(e?.message ?? e)
    if (/SPLIT:/.test(msg)) {
      const days = Math.round((new Date(hi).getTime() - new Date(lo).getTime()) / 86_400_000)
      if (days <= 1) throw new Error(`a single day ${lo} exceeds the per-call row ceiling — raise GOOGLE_DELETE_MAX_ROWS_PER_CALL after measuring`)
      await rpc('google_delete_log_merge', { p_code: code, p_counts: { 'metrics_daily.splits': 1 } })
      const mid = addDays(lo, Math.floor(days / 2))
      await deleteRange(clientId, code, lo, mid, log)
      await deleteRange(clientId, code, mid, hi, log)
      return
    }
    if (/MISMATCH/.test(msg)) { log(`mismatch on ${lo}..${hi}, retrying once`); await rpc('google_delete_client_metrics', { p_client: clientId, p_lo: lo, p_hi: hi, p_max_rows: GOOGLE_DELETE_MAX_ROWS_PER_CALL, p_code: code }); return }
    throw e
  }
}

async function waitForQuiet(clientId: string, deadlineMs: number): Promise<boolean> {
  const t0 = Date.now()
  while (Date.now() - t0 < deadlineMs) {
    const now = Date.now()
    const { data: lease } = await supabaseAdmin.from('universe_fire_lease').select('holder_invocation_id, acquired_at').eq('client_id', clientId).eq('vendor', RUN_VENDOR).maybeSingle()
    const leaseLive = !!lease?.holder_invocation_id && !!lease?.acquired_at && now - new Date(lease.acquired_at).getTime() < LEASE_TTL_MS
    const { data: run } = await supabaseAdmin.from('universe_run').select('status, updated_at, last_invocation').eq('client_id', clientId).eq('vendor', RUN_VENDOR).maybeSingle()
    const runLive = !!run && (run.status === 'running' || run.status === 'stopping') && !!run.last_invocation && !!run.updated_at && now - new Date(run.updated_at).getTime() < RUN_RESERVE_MS
    if (!leaseLive && !runLive) return true
    await new Promise((r) => setTimeout(r, QUIET_POLL_MS))
  }
  return false
}

export type JobOutcome = { ran: boolean; status: string; reason: string; code: string }

/**
 * Run the job identified by `code` for as long as `budgetMs` allows, then release. Every step re-reads the row.
 * Returns without throwing; the row carries the truth.
 */
export async function runDeletionJob(a: { code: string; holder: string; budgetMs: number; log?: (s: string) => void }): Promise<JobOutcome> {
  const log = a.log ?? (() => {})
  const started = Date.now()
  const left = () => a.budgetMs - (Date.now() - started)
  const claimed = await rpc<boolean>('google_delete_claim', { p_code: a.code, p_holder: a.holder, p_reserve_s: CLAIM_RESERVE_S })
  if (!claimed) return { ran: false, status: 'in_progress', reason: 'another holder has the claim, or the job is finished', code: a.code }
  let row = await readJob(a.code)
  if (!row) return { ran: false, status: 'missing', reason: 'no row', code: a.code }
  const clientId = row.client_id
  const email = String(row.user_email ?? '').toLowerCase()
  const done = (s: string) => Array.isArray(row?.detail?.steps) && row!.detail.steps.includes(s)
  const step = async (s: string) => { await rpc('google_delete_log_merge', { p_code: a.code, p_counts: null, p_step: s }); row = await readJob(a.code) }
  const pause = async (why: string): Promise<JobOutcome> => { await rpc('google_delete_finish', { p_code: a.code, p_holder: a.holder, p_status: 'processing' }); return { ran: true, status: 'processing', reason: why, code: a.code } }
  try {
    if (!done('quiet_before')) { if (!(await waitForQuiet(clientId, Math.min(400_000, left())))) return pause('a walk fire was still live; the pump continues'); await step('quiet_before') }
    if (!done('connection')) { await rpc('google_delete_client_connection', { p_client: clientId, p_code: a.code }); row = await readJob(a.code) }
    if (!done('quiet')) { if (!(await waitForQuiet(clientId, Math.min(400_000, left())))) return pause('a walk fire was still live after the connection was removed; the pump continues'); await step('quiet') }
    if (!done('ledgers')) { await rpc('google_delete_client_ledgers', { p_client: clientId, p_code: a.code }); row = await readJob(a.code) }
    if (!done('metrics')) {
      const b = await rpc<Array<{ min_date: string | null; max_date: string | null }>>('google_client_metrics_bounds', { p_client: clientId })
      const min = b?.[0]?.min_date ?? null, max = b?.[0]?.max_date ?? null
      if (min && max) {
        for (let m = monthStart(min); m <= max; m = nextMonth(m)) {
          const key = m.slice(0, 7)
          if (Array.isArray(row?.detail?.metrics?.months_done) && row!.detail.metrics.months_done.includes(key)) continue
          if (left() < 60_000) return pause(`time budget reached at ${key}; the pump continues`)
          await deleteRange(clientId, a.code, m, nextMonth(m), log)
          await rpc('google_delete_log_merge', { p_code: a.code, p_counts: null, p_month: key })
          row = await readJob(a.code)
        }
      }
      await step('metrics')
    }
    if (!done('capture')) { await rpc('google_delete_client_capture', { p_client: clientId, p_code: a.code }); row = await readJob(a.code) }
    if (!done('walk_state')) { await rpc('google_delete_client_walk_state', { p_client: clientId, p_code: a.code }); row = await readJob(a.code) }
    if (!done('resweep')) {
      await rpc('google_delete_client_ledgers', { p_client: clientId, p_code: a.code })
      const b = await rpc<Array<{ min_date: string | null; max_date: string | null }>>('google_client_metrics_bounds', { p_client: clientId })
      const min = b?.[0]?.min_date ?? null, max = b?.[0]?.max_date ?? null
      if (min && max) for (let m = monthStart(min); m <= max; m = nextMonth(m)) await deleteRange(clientId, a.code, m, nextMonth(m), log)
      await rpc('google_delete_client_capture', { p_client: clientId, p_code: a.code })
      await rpc('google_delete_client_walk_state', { p_client: clientId, p_code: a.code })
      await step('resweep')
    }
    if (!done('cache')) {
      const { count } = await supabaseAdmin.from('client_context').update({ intelligence_cache: null }, { count: 'exact' }).eq('client_id', clientId)
      await rpc('google_delete_log_merge', { p_code: a.code, p_counts: { 'client_context.intelligence_cache_nulled': Number(count ?? 0) }, p_step: 'cache' }); row = await readJob(a.code)
    }
    if (!done('revoke')) {
      const { count: others } = await supabaseAdmin.from('platform_connections').select('id', { count: 'exact', head: true }).eq('user_email', email).eq('platform', GOOGLE_DELETE_PLATFORM)
      const otherGoogleConnections = Number(others ?? 0)
      const decided = decideRevoke({ otherGoogleConnections })
      let tokensDeleted = 0, revokeStatus: number | null = null
      if (decided) {
        const { data: tok } = await supabaseAdmin.from('google_tokens').select('refresh_token').eq('user_email', email).maybeSingle()
        if (tok?.refresh_token) {
          try { revokeStatus = (await revokeGoogleRefreshToken(tok.refresh_token as string)).status } catch (e: any) { log(`revoke call failed: ${e?.message ?? e}`) }
          const { count: td } = await supabaseAdmin.from('google_tokens').delete({ count: 'exact' }).eq('user_email', email)
          tokensDeleted = Number(td ?? 0)
        }
      }
      await rpc('google_delete_log_merge', { p_code: a.code, p_counts: { google_tokens: tokensDeleted, 'revoke.other_google_clients': otherGoogleConnections, 'revoke.decided': decided ? 1 : 0, 'revoke.status': revokeStatus ?? 0 }, p_step: 'revoke' }); row = await readJob(a.code)
    }
    // THE END: every table re-counted by the database; complete only at all-zero.
    const after = await rpc<Record<string, number>>('google_count_client_rows', { p_client: clientId })
    const nonZero = Object.entries(after ?? {}).filter(([, n]) => Number(n) > 0)
    const unlisted = GOOGLE_DELETE_TABLES.map((t) => t.table).filter((t) => !(t in (after ?? {})))
    if (nonZero.length || unlisted.length) {
      // re-arm the delete steps for the next holder; the deletes are idempotent
      await rpc('google_delete_finish', { p_code: a.code, p_holder: a.holder, p_status: 'partial', p_counts_after: after, p_error: `re-count not zero: ${nonZero.map(([t, n]) => `${t}=${n}`).join(', ')}${unlisted.length ? ` · uncounted: ${unlisted.join(', ')}` : ''}` })
      await rpc('google_delete_rearm', { p_code: a.code, p_holder: a.holder })
      return { ran: true, status: 'partial', reason: 'a table still held rows after the run; the pump retries', code: a.code }
    }
    await rpc('google_delete_finish', { p_code: a.code, p_holder: a.holder, p_status: 'complete', p_counts_after: after })
    return { ran: true, status: 'complete', reason: 'every table re-counted at 0', code: a.code }
  } catch (e: any) {
    await rpc('google_delete_finish', { p_code: a.code, p_holder: a.holder, p_status: 'partial', p_error: String(e?.message ?? e) }).catch(() => {})
    return { ran: true, status: 'partial', reason: String(e?.message ?? e), code: a.code }
  }
}
