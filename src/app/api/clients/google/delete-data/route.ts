// LORAMER_GOOGLE_DELETE_MY_DATA_V1 — POST /api/clients/google/delete-data?id=<client> · body { confirm: <client name> }
//
// A customer deletes ALL of one client's Google Ads data: every google-scoped and client-scoped row (the list is
// src/lib/google-delete/tables.ts, proven against the database by check:data), the connection FIRST so nothing
// re-enumerates the client, the intelligence cache nulled, and the Google grant revoked only when this was the user's
// last google client. Same properties as src/app/api/meta/data-deletion/route.ts: LOGGED FIRST (a crash leaves a
// trace), IDEMPOTENT (a complete request answers with its original code), RESUMABLE (press again; the log row carries
// the cursor), PER-TABLE COUNTS, a CONFIRMATION CODE.
// ⛔ THIS ROUTE DELETES NOTHING ITSELF. Every DELETE runs inside a definer function in migrations/099 whose body pins
// `client_id = p_client` and the platform/vendor literal; the route can only choose WHICH client. The one write it
// makes directly is the cache null (an UPDATE) and, on the last-client branch, the google_tokens row.
// ⛔ EIGHT SECONDS PER CALL: PostgREST's statement_timeout. Metrics go one month at a time; a month over the row
// ceiling comes back 'SPLIT:<n>' and is halved by day until it fits. The route stops itself at TIME_BUDGET_MS and
// reports partial; the next press continues from the cursor.
// ⛔ A FIRE IN FLIGHT IS WAITED OUT, NEVER DELETED UNDERNEATH: after the connection is gone the pump can still step a
// live run for one reserve window; the route waits for the fire lease and the run row to go quiet (the lease TTL is
// 330 s — migration 085; the pump's reserve is 320 s) before it removes the walk state.
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import crypto from 'crypto'
import { authOptions } from '@/lib/auth'
import { supabaseAdmin } from '@/lib/supabase'
import { GOOGLE_DELETE_MAX_ROWS_PER_CALL, GOOGLE_DELETE_PLATFORM, GOOGLE_DELETE_TABLES } from '@/lib/google-delete/tables'
import { decideRevoke, revokeGoogleRefreshToken } from '@/lib/google-delete/revoke'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const fetchCache = 'force-no-store'
export const maxDuration = 800

const RUN_VENDOR = 'google_ads'          // universe_run / universe_fire_lease spell the walk's vendor this way (measured 2026-09-21)
const LEASE_TTL_MS = 330_000             // migration 085 — a holder cannot live past the platform kill
const RUN_RESERVE_MS = 320_000           // universe-run-pump STEP_RESERVE_MS — a live claim is updated_at inside this window
const QUIET_POLL_MS = 5_000
const QUIET_WAIT_MAX_MS = 400_000        // inside maxDuration with room for the deletes; otherwise partial → press again
const TIME_BUDGET_MS = 700_000
const SCOPE_DONE = 'scope_done'

type Counts = Record<string, number>
type Detail = {
  steps: string[]                      // completed steps, in order
  counts: Counts                       // per-table rows deleted, summed across presses
  metrics: { months_done: string[]; splits: number; calls: number; bounds?: { min: string | null; max: string | null } }
  resweep?: Counts
  revoke?: { decided: boolean; other_google_clients: number; status?: number; ok?: boolean; tokens_deleted?: number; error?: string }
  waited_ms?: number
  counts_after?: Counts
  presses: number
  errors: string[]
}

const addCounts = (into: Counts, from: Counts | null | undefined) => { for (const [k, v] of Object.entries(from ?? {})) into[k] = (into[k] ?? 0) + Number(v || 0); return into }
const isoDay = (d: Date) => d.toISOString().slice(0, 10)
const addDays = (iso: string, n: number) => { const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return isoDay(d) }
const monthStart = (iso: string) => iso.slice(0, 7) + '-01'
const nextMonth = (iso: string) => { const d = new Date(iso.slice(0, 7) + '-01T00:00:00Z'); d.setUTCMonth(d.getUTCMonth() + 1); return isoDay(d) }

async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabaseAdmin.rpc(fn, args)
  if (error) throw new Error(`${fn}: ${error.message}`)
  return data as T
}

/** Delete one date range [lo, hi); on SPLIT halve by day and recurse. Returns rows deleted and calls made. */
async function deleteRange(clientId: string, lo: string, hi: string, acc: { deleted: number; calls: number; splits: number }): Promise<void> {
  try {
    acc.calls += 1
    const rows = await rpc<Array<{ expected: number; deleted: number }>>('google_delete_client_metrics', { p_client: clientId, p_lo: lo, p_hi: hi, p_max_rows: GOOGLE_DELETE_MAX_ROWS_PER_CALL })
    acc.deleted += Number(rows?.[0]?.deleted ?? 0)
  } catch (e: any) {
    const msg = String(e?.message ?? e)
    if (/SPLIT:/.test(msg)) {
      const days = Math.round((new Date(hi).getTime() - new Date(lo).getTime()) / 86_400_000)
      if (days <= 1) throw new Error(`a single day ${lo} exceeds the per-call row ceiling — raise GOOGLE_DELETE_MAX_ROWS_PER_CALL after measuring`)
      acc.splits += 1
      const mid = addDays(lo, Math.floor(days / 2))
      await deleteRange(clientId, lo, mid, acc)
      await deleteRange(clientId, mid, hi, acc)
      return
    }
    if (/MISMATCH/.test(msg)) { // a writer landed rows mid-delete: one retry of the same range
      acc.calls += 1
      const rows = await rpc<Array<{ expected: number; deleted: number }>>('google_delete_client_metrics', { p_client: clientId, p_lo: lo, p_hi: hi, p_max_rows: GOOGLE_DELETE_MAX_ROWS_PER_CALL })
      acc.deleted += Number(rows?.[0]?.deleted ?? 0)
      return
    }
    throw e
  }
}

async function waitForQuiet(clientId: string, deadlineMs: number): Promise<{ quiet: boolean; waitedMs: number }> {
  const t0 = Date.now()
  while (Date.now() - t0 < deadlineMs) {
    const now = Date.now()
    const { data: lease } = await supabaseAdmin.from('universe_fire_lease').select('holder_invocation_id, acquired_at')
      .eq('client_id', clientId).eq('vendor', RUN_VENDOR).maybeSingle()
    const leaseLive = !!lease?.holder_invocation_id && !!lease?.acquired_at && now - new Date(lease.acquired_at).getTime() < LEASE_TTL_MS
    const { data: run } = await supabaseAdmin.from('universe_run').select('status, updated_at, last_invocation')
      .eq('client_id', clientId).eq('vendor', RUN_VENDOR).maybeSingle()
    const runLive = !!run && (run.status === 'running' || run.status === 'stopping') && !!run.last_invocation && !!run.updated_at && now - new Date(run.updated_at).getTime() < RUN_RESERVE_MS
    if (!leaseLive && !runLive) return { quiet: true, waitedMs: Date.now() - t0 }
    await new Promise((r) => setTimeout(r, QUIET_POLL_MS))
  }
  return { quiet: false, waitedMs: Date.now() - t0 }
}

export async function POST(request: Request) {
  const started = Date.now()
  const session = (await getServerSession(authOptions)) as any
  const email = String(session?.user?.email ?? '').trim().toLowerCase()
  if (!email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const url = new URL(request.url)
  const id = url.searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })
  let body: any = {}
  try { body = await request.json() } catch { /* no body */ }

  // OWNER ONLY (members/editors/viewers rejected). An archived client may still have its Google data deleted.
  const { data: owned } = await supabaseAdmin.from('clients').select('id, name, user_email').eq('id', id).eq('user_email', email).maybeSingle()
  if (!owned) return NextResponse.json({ error: 'Client not found or not owner' }, { status: 404 })
  if (String(body?.confirm ?? '').trim() !== String(owned.name ?? '').trim()) {
    return NextResponse.json({ error: 'confirm must equal the client name exactly' }, { status: 400 })
  }

  // IDEMPOTENCY FIRST — a finished prior request answers with its original code instead of re-running.
  const { data: prior } = await supabaseAdmin.from('platform_compliance_log').select('confirmation_code, status, detail')
    .eq('platform', GOOGLE_DELETE_PLATFORM).eq('kind', 'data_deletion').eq('client_id', id)
    .order('received_at', { ascending: false }).limit(1).maybeSingle()
  if (prior?.status === 'complete') {
    return NextResponse.json({ status: 'complete', confirmation_code: prior.confirmation_code, counts: prior.detail?.counts ?? {}, note: 'already complete — original confirmation code returned', tables: GOOGLE_DELETE_TABLES.map((t) => t.table) })
  }

  // LOG FIRST — resume a processing/partial row, or open a new one, BEFORE any delete.
  let code = prior?.confirmation_code as string | undefined
  let detail: Detail = (prior?.detail as Detail | undefined) ?? { steps: [], counts: {}, metrics: { months_done: [], splits: 0, calls: 0 }, presses: 0, errors: [] }
  detail.presses = (detail.presses ?? 0) + 1
  if (!code) {
    code = crypto.randomUUID()
    const { error } = await supabaseAdmin.from('platform_compliance_log').insert({
      platform: GOOGLE_DELETE_PLATFORM, kind: 'data_deletion', client_id: id, user_email: email, confirmation_code: code, status: 'processing', detail,
    })
    if (error) return NextResponse.json({ error: `could not open the deletion log: ${error.message}` }, { status: 500 })
  }
  const save = async (status: 'processing' | 'partial' | 'complete') => {
    await supabaseAdmin.from('platform_compliance_log').update({ status, detail, updated_at: new Date().toISOString() }).eq('confirmation_code', code!)
  }
  const done = (s: string) => detail.steps.includes(s)
  const mark = (s: string) => { if (!done(s)) detail.steps.push(s) }
  const outOfTime = () => Date.now() - started > TIME_BUDGET_MS

  try {
    // 1. WAIT OUT A FIRE IN FLIGHT BEFORE THE FIRST DELETE (Russ, 2026-09-21) — nothing is removed under a running step.
    const quietOr = async (step: string) => {
      const q = await waitForQuiet(id, Math.min(QUIET_WAIT_MAX_MS, TIME_BUDGET_MS - (Date.now() - started)))
      detail.waited_ms = (detail.waited_ms ?? 0) + q.waitedMs
      if (!q.quiet) { detail.errors.push(`a walk fire was still live after the ${step} wait — press again`); await save('partial'); return false }
      mark(step); await save('processing'); return true
    }
    if (!done('quiet_before')) {
      if (!(await quietOr('quiet_before'))) return NextResponse.json({ status: 'partial', confirmation_code: code, counts: detail.counts, note: 'a fire was still in flight; nothing was deleted; press again', detail }, { status: 202 })
    }
    // 2. THE CONNECTION — first delete, so sync / catchup / drain / driver / the resume roster never see this client again.
    if (!done('connection')) {
      const n = await rpc<number>('google_delete_client_connection', { p_client: id })
      addCounts(detail.counts, { platform_connections: Number(n ?? 0) })
      mark('connection'); await save('processing')
    }
    // 2b. QUIET AGAIN — a fire that started between the wait and the connection delete is waited out here (cheap when already quiet).
    if (!done('quiet')) {
      if (!(await quietOr('quiet'))) return NextResponse.json({ status: 'partial', confirmation_code: code, counts: detail.counts, note: 'a fire was still in flight after the connection was removed; press again to continue', detail }, { status: 202 })
    }
    // 3. THE LEDGERS.
    if (!done('ledgers')) {
      addCounts(detail.counts, await rpc<Counts>('google_delete_client_ledgers', { p_client: id }))
      mark('ledgers'); await save('processing')
    }
    // 4. THE WAREHOUSE — month by month from the client's own bounds, halving on SPLIT, resumable per month.
    if (!done('metrics')) {
      const b = await rpc<Array<{ min_date: string | null; max_date: string | null }>>('google_client_metrics_bounds', { p_client: id })
      const min = b?.[0]?.min_date ?? null, max = b?.[0]?.max_date ?? null
      detail.metrics.bounds = { min, max }
      if (min && max) {
        for (let m = monthStart(min); m <= max; m = nextMonth(m)) {
          const key = m.slice(0, 7)
          if (detail.metrics.months_done.includes(key)) continue
          if (outOfTime()) { await save('partial'); return NextResponse.json({ status: 'partial', confirmation_code: code, counts: detail.counts, note: `time budget reached at ${key}; press again to continue`, detail }, { status: 202 }) }
          const acc = { deleted: 0, calls: 0, splits: 0 }
          await deleteRange(id, m, nextMonth(m), acc)
          addCounts(detail.counts, { metrics_daily: acc.deleted })
          detail.metrics.calls += acc.calls; detail.metrics.splits += acc.splits
          detail.metrics.months_done.push(key)
          await save('processing')
        }
      }
      mark('metrics'); await save('processing')
    }
    // 5. THE CAPTURE TABLES.
    if (!done('capture')) {
      addCounts(detail.counts, await rpc<Counts>('google_delete_client_capture', { p_client: id }))
      mark('capture'); await save('processing')
    }
    // 6. THE WALK STATE — children first, inception last (inside the function).
    if (!done('walk_state')) {
      addCounts(detail.counts, await rpc<Counts>('google_delete_client_walk_state', { p_client: id }))
      mark('walk_state'); await save('processing')
    }
    // 7. RE-SWEEP — anything a writer landed between steps 1 and 6 (idempotent; expected all zeros).
    if (!done('resweep')) {
      const sweep: Counts = {}
      addCounts(sweep, await rpc<Counts>('google_delete_client_ledgers', { p_client: id }))
      const b = await rpc<Array<{ min_date: string | null; max_date: string | null }>>('google_client_metrics_bounds', { p_client: id })
      const min = b?.[0]?.min_date ?? null, max = b?.[0]?.max_date ?? null
      if (min && max) { const acc = { deleted: 0, calls: 0, splits: 0 }; for (let m = monthStart(min); m <= max; m = nextMonth(m)) await deleteRange(id, m, nextMonth(m), acc); sweep.metrics_daily = acc.deleted }
      addCounts(sweep, await rpc<Counts>('google_delete_client_capture', { p_client: id }))
      addCounts(sweep, await rpc<Counts>('google_delete_client_walk_state', { p_client: id }))
      detail.resweep = sweep; addCounts(detail.counts, sweep)
      mark('resweep'); await save('processing')
    }
    // 8. THE CACHE — the intelligence cache bundles every platform per entry; null it, keep the row.
    if (!done('cache')) {
      const { count } = await supabaseAdmin.from('client_context').update({ intelligence_cache: null }, { count: 'exact' }).eq('client_id', id)
      addCounts(detail.counts, { 'client_context.intelligence_cache_nulled': Number(count ?? 0) })
      mark('cache'); await save('processing')
    }
    // 9. REVOKE — only when this was the user's LAST google client (the token is user-scoped and shared).
    if (!done('revoke')) {
      const { count: others } = await supabaseAdmin.from('platform_connections').select('id', { count: 'exact', head: true }).eq('user_email', email).eq('platform', GOOGLE_DELETE_PLATFORM)
      const otherGoogleConnections = Number(others ?? 0)
      const decided = decideRevoke({ otherGoogleConnections })
      detail.revoke = { decided, other_google_clients: otherGoogleConnections }
      if (decided) {
        const { data: tok } = await supabaseAdmin.from('google_tokens').select('refresh_token').eq('user_email', email).maybeSingle()
        if (tok?.refresh_token) {
          try {
            const r = await revokeGoogleRefreshToken(tok.refresh_token as string)
            detail.revoke.status = r.status; detail.revoke.ok = r.ok
          } catch (e: any) { detail.revoke.error = String(e?.message ?? e) }
          const { count: td } = await supabaseAdmin.from('google_tokens').delete({ count: 'exact' }).eq('user_email', email)
          detail.revoke.tokens_deleted = Number(td ?? 0)
        } else detail.revoke.tokens_deleted = 0
      }
      mark('revoke'); await save('processing')
    }
    // 10. RE-COUNT EVERY TABLE — the run ends only when each listed table reads 0 for this client (Russ, 2026-09-21).
    const after = await rpc<Counts>('google_count_client_rows', { p_client: id })
    detail.counts_after = after
    const nonZero = Object.entries(after ?? {}).filter(([, n]) => Number(n) > 0)
    const unlisted = GOOGLE_DELETE_TABLES.map((t) => t.table).filter((t) => !(t in (after ?? {})))
    if (nonZero.length || unlisted.length) {
      detail.errors.push(`re-count not zero: ${nonZero.map(([t, n]) => `${t}=${n}`).join(', ')}${unlisted.length ? ` · uncounted: ${unlisted.join(', ')}` : ''}`)
      detail.steps = detail.steps.filter((s) => !['ledgers', 'metrics', 'capture', 'walk_state', 'resweep'].includes(s)) // the next press re-runs the deletes (idempotent)
      await save('partial')
      return NextResponse.json({ status: 'partial', confirmation_code: code, counts: detail.counts, counts_after: after, note: 'a table still holds rows after the run; press again', detail }, { status: 202 })
    }
    await save('complete')
    return NextResponse.json({ status: 'complete', confirmation_code: code, counts: detail.counts, counts_after: after, detail, tables: GOOGLE_DELETE_TABLES.map((t) => t.table) })
  } catch (e: any) {
    detail.errors.push(String(e?.message ?? e))
    await save('partial')
    return NextResponse.json({ status: 'partial', confirmation_code: code, counts: detail.counts, error: String(e?.message ?? e), note: 'press again to continue from the last completed step', detail }, { status: 500 })
  }
}
