// LORAMER_BACKFILL_META_0B_V2
// Thin CRON wrapper over the shared backfill engine. CRON_SECRET-bearer GET.
// Engine + per-platform logic live in src/lib/backfill/*. Behavior unchanged
// from V1.

import { NextResponse } from 'next/server'
import { runBackfill } from '@/lib/backfill/run-backfill'
import { metaBackfillAdapter } from '@/lib/backfill/adapters'

export const maxDuration = 60

export async function GET(request: Request) {
  const envSecret = (process.env.CRON_SECRET ?? '').trim()
  const authHeader = request.headers.get('authorization') ?? ''
  const gotToken = (
    authHeader.startsWith('Bearer ')
      ? authHeader.slice('Bearer '.length)
      : authHeader
  ).trim()
  if (!envSecret || gotToken !== envSecret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { searchParams } = new URL(request.url)
  const clientId = searchParams.get('clientId')
  if (!clientId) {
    return NextResponse.json({ error: 'Missing clientId' }, { status: 400 })
  }

  const { status, body } = await runBackfill(clientId, metaBackfillAdapter)
  return NextResponse.json(body, { status })
}
