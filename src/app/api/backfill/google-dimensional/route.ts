// LORAMER_SEARCH_TERMS_BACKFILL_V1
// Thin CRON_SECRET-bearer GET wrapper over the dimensional (search-term/keyword) backfill lib.
// SEPARATE from /api/backfill/google (the account-level V2 path) — different grain, different cursor
// (sync_state platform='google_dimensional'). Opt-in, ONE clientId per call. No cron schedules it.

import { NextResponse } from 'next/server'
import { runGoogleDimensionalBackfill } from '@/lib/backfill/google-dimensional-backfill'

export const maxDuration = 60
// LORAMER_WOO_BACKFILL_ATOMIC_BREAKER_V1 (Lesson 52 defense-in-depth) — opt out of Next.js App Router
// fetch caching so supabase-js cursor reads/writes on this stateful resume path always hit the primary
// fresh. Preventative: a stale resume read here is idempotent (re-walks captured windows), not corrupting.
export const dynamic = 'force-dynamic'
export const fetchCache = 'force-no-store'

const DEFAULT_DAYS = 90

export async function GET(request: Request) {
  const envSecret = (process.env.CRON_SECRET ?? '').trim()
  const authHeader = request.headers.get('authorization') ?? ''
  const gotToken = (
    authHeader.startsWith('Bearer ') ? authHeader.slice('Bearer '.length) : authHeader
  ).trim()
  if (!envSecret || gotToken !== envSecret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { searchParams } = new URL(request.url)
  const clientId = searchParams.get('clientId')
  if (!clientId) {
    return NextResponse.json({ error: 'Missing clientId' }, { status: 400 })
  }
  const daysRaw = searchParams.get('days')
  const days = daysRaw ? Math.max(1, Math.min(400, parseInt(daysRaw, 10) || DEFAULT_DAYS)) : DEFAULT_DAYS

  const { status, body } = await runGoogleDimensionalBackfill(clientId, { days })
  return NextResponse.json(body, { status })
}
