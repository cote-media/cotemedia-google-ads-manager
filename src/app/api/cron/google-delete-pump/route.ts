// LORAMER_GOOGLE_DELETE_JOB_V1 — THE DELETION PUMP. Vercel's cron invokes this every minute (vercel.json). It picks ONE
// google deletion row that is processing or partial and not held by a live claim, and runs it for up to its budget.
// The press (delete-data POST) starts a job under waitUntil; this route is what makes the job survive the press's
// invocation ending, a redeploy, or a holder dying mid-run — the universe-run-pump's shape, applied to the log row.
// ⛔ AUTH IS THE CRON SECRET, like every cron route here: `Bearer $CRON_SECRET` or 401.
import { NextResponse } from 'next/server'
import crypto from 'crypto'
import { supabaseAdmin } from '@/lib/supabase'
import { runDeletionJob, CLAIM_RESERVE_S, PUMP_MAX_DURATION_S } from '@/lib/google-delete/job'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const fetchCache = 'force-no-store'
export const maxDuration = 800
/** ⇐ PUMP_MAX_DURATION_S (800) − 100 s for the last step and the release; the job's own budget check pauses earlier. */
const PUMP_BUDGET_MS = (PUMP_MAX_DURATION_S - 100) * 1000

const auth = (request: Request): boolean => {
  const secret = process.env.CRON_SECRET
  const got = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '')
  return !!secret && got === secret
}

export async function GET(request: Request) {
  if (!auth(request)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const startedAt = Date.now()
  const freeBefore = new Date(startedAt - CLAIM_RESERVE_S * 1000).toISOString()
  const { data: rows, error } = await supabaseAdmin.from('platform_compliance_log')
    .select('confirmation_code, client_id, status, claimed_by, claimed_at, received_at')
    .eq('platform', 'google').eq('kind', 'data_deletion').in('status', ['processing', 'partial'])
    .or(`claimed_by.is.null,claimed_at.is.null,claimed_at.lt.${freeBefore}`)
    .order('received_at', { ascending: true }).limit(1)
  if (error) return NextResponse.json({ ok: false, error: `job read failed: ${error.message}` }, { status: 500 })
  const job = (rows ?? [])[0] as { confirmation_code: string; client_id: string; status: string } | undefined
  if (!job) return NextResponse.json({ ok: true, picked: null, note: 'no google deletion waiting', elapsedMs: Date.now() - startedAt })
  const holder = `pump:${crypto.randomUUID()}`
  const out = await runDeletionJob({ code: job.confirmation_code, holder, budgetMs: PUMP_BUDGET_MS, log: (s) => console.log(`[google-delete-pump ${job.confirmation_code.slice(0, 8)}] ${s}`) })
  return NextResponse.json({ ok: true, picked: { code: job.confirmation_code, client_id: job.client_id, was: job.status }, outcome: out, elapsedMs: Date.now() - startedAt })
}
