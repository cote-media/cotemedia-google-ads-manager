// LORAMER_GOOGLE_DELETE_JOB_V1 — POST records the job and answers at once; GET reads its progress.
//   POST /api/clients/google/delete-data?id=<client> · body { confirm: <client name> }
//   GET  /api/clients/google/delete-data?id=<client>
//
// ⛔ THE PRESS NEVER WAITS ON THE DELETION (round 6, 2026-09-21: a phone dropped the 82-second request and re-sent it,
// two runs overlapped, the record lost 307,153 rows). The press opens the log row (google_delete_open — one live job
// per client, migration 100), and:
//   · the row is COMPLETE → 200 with its confirmation code (idempotent, the original code);
//   · the row is LIVE (claimed inside the reserve) → 202 in_progress, and NOTHING runs — a re-send, a second tab or
//     a second press only reads progress;
//   · otherwise → the job is handed to runDeletionJob under waitUntil (in-process, no HTTP to self — LORAMER_NO_HTTP_
//     TO_SELF_V1) and the response returns at once with 202 processing. If this invocation ends before the job does,
//     /api/cron/google-delete-pump (every minute) claims the row and continues from its cursor.
// ⛔ THIS ROUTE DELETES NOTHING AND COUNTS NOTHING. Every delete runs in a definer function that merges its own count
// into the row (migration 100); the runner reads the row back for every cursor. tests/guards/google-delete-job.guard.mjs
// pins all of it.
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import crypto from 'crypto'
import { waitUntil } from '@vercel/functions'
import { authOptions } from '@/lib/auth'
import { supabaseAdmin } from '@/lib/supabase'
import { GOOGLE_DELETE_TABLES } from '@/lib/google-delete/tables'
import { runDeletionJob, CLAIM_RESERVE_S } from '@/lib/google-delete/job'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const fetchCache = 'force-no-store'
export const maxDuration = 800

/** The press's own budget: the function ceiling minus the room a last step needs to finish and release. */
const PRESS_BUDGET_MS = 700_000

async function owner(request: Request): Promise<{ email: string; id: string; name: string } | NextResponse> {
  const session = (await getServerSession(authOptions)) as any
  const email = String(session?.user?.email ?? '').trim().toLowerCase()
  if (!email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const id = new URL(request.url).searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })
  const { data: owned } = await supabaseAdmin.from('clients').select('id, name, user_email').eq('id', id).eq('user_email', email).maybeSingle()
  if (!owned) return NextResponse.json({ error: 'Client not found or not owner' }, { status: 404 })
  return { email, id, name: String(owned.name ?? '') }
}

async function statusOf(clientId: string) {
  const { data, error } = await supabaseAdmin.rpc('google_delete_status', { p_client: clientId, p_reserve_s: CLAIM_RESERVE_S })
  if (error) throw new Error(`google_delete_status: ${error.message}`)
  return (data as any) ?? null
}

const shape = (row: any) => row ? ({
  status: row.status, live: !!row.live, confirmation_code: row.confirmation_code, received_at: row.received_at, updated_at: row.updated_at,
  steps: row.detail?.steps ?? [], counts: row.detail?.counts ?? {}, counts_after: row.detail?.counts_after ?? null,
  months_done: row.detail?.metrics?.months_done?.length ?? 0, errors: row.detail?.errors ?? [], completed_at: row.detail?.completed_at ?? null,
  corrections: row.detail?.corrections ?? [], tables: GOOGLE_DELETE_TABLES.map((t) => t.table),
}) : null

export async function GET(request: Request) {
  const o = await owner(request)
  if (o instanceof NextResponse) return o
  try { return NextResponse.json({ job: shape(await statusOf(o.id)) }) } catch (e: any) { return NextResponse.json({ error: String(e?.message ?? e) }, { status: 500 }) }
}

export async function POST(request: Request) {
  const o = await owner(request)
  if (o instanceof NextResponse) return o
  let body: any = {}
  try { body = await request.json() } catch { /* no body */ }
  if (String(body?.confirm ?? '').trim() !== o.name.trim()) return NextResponse.json({ error: 'confirm must equal the client name exactly' }, { status: 400 })

  // OPEN THE ROW — the lock. One live job per client; a complete row answers with its original code.
  const { data: opened, error } = await supabaseAdmin.rpc('google_delete_open', { p_client: o.id, p_email: o.email })
  if (error || !opened) return NextResponse.json({ error: `could not open the deletion log: ${error?.message ?? 'no row'}` }, { status: 500 })
  const row = await statusOf(o.id)
  if (row?.status === 'complete') return NextResponse.json({ status: 'complete', job: shape(row), note: 'already complete — original confirmation code returned' })
  if (row?.live) return NextResponse.json({ status: 'in_progress', job: shape(row), note: 'a deletion is already running for this client; this press only reads its progress' }, { status: 202 })

  // HAND OFF AND RETURN. The runner claims the row itself; if another holder won the race it returns without a step.
  const holder = `press:${crypto.randomUUID()}`
  waitUntil(runDeletionJob({ code: row.confirmation_code, holder, budgetMs: PRESS_BUDGET_MS, log: (s) => console.log(`[google-delete ${row.confirmation_code.slice(0, 8)}] ${s}`) }))
  return NextResponse.json({ status: 'processing', job: shape(row), note: 'the deletion runs on the server; close the page if you like — reopen it for progress' }, { status: 202 })
}
