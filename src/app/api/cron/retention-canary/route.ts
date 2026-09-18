// LORAMER_RETENTION_WALL_CANARY_V1 — THE CANARY. Once a day, ONE request past the published retention wall on an account
// whose rows there are KNOWN (retention-wall.ts: RETENTION_CANARY, measured 2026-09-18). Its answer is the only thing
// that lets an empty answer past the wall retire a day: while it reads 'served', the vendor demonstrably still serves
// that ground; the moment it reads 'refused' (the documented DateRangeError), 'silent' (rows gone with no error — the
// dangerous shape) or 'failed', every fire holds past the wall and every empty there is recorded UNRESOLVED. That is how
// we know within a day that enforcement began, and why a silent wall cannot seal history as empty.
//
// ⛔ ONE REQUEST A DAY, THROUGH THE WALK'S OWN STREAM (universe-vendor-stream.ts — the arming boundary, the choke-point
// client), recorded in capture_pass_log (no new table). AUTH IS THE CRON SECRET like every cron route here.
import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { googleAdsStreamFor } from '@/lib/backfill/universe-vendor-stream'
import { RETENTION_CANARY, RETENTION_CANARY_GAQL, canaryVerdict, recordRetentionCanary, wallLineFor } from '@/lib/backfill/retention-wall'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const fetchCache = 'force-no-store' // reads google_tokens through the stream factory; a cached credential read is the 2026-07-30 class
export const maxDuration = 60

const auth = (request: Request): boolean => {
  const secret = process.env.CRON_SECRET
  const got = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '')
  return !!secret && got === secret
}

export async function GET(request: Request) {
  if (!auth(request)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const t0 = Date.now()
  const wallLine = wallLineFor(new Date().toISOString().slice(0, 10))
  // The canary account's token owner, read the way every Google touch resolves it: the connection's user, else the client's.
  const { data: conn, error: connErr } = await supabaseAdmin.from('platform_connections')
    .select('account_id, user_email, clients!inner(user_email)')
    .eq('client_id', RETENTION_CANARY.clientId).eq('platform', 'google').maybeSingle()
  const userEmail = (conn as any)?.user_email || (conn as any)?.clients?.user_email
  if (connErr || !conn || !userEmail || String((conn as any).account_id) !== RETENTION_CANARY.customerId) {
    const error = connErr?.message ?? `canary account ${RETENTION_CANARY.customerId} is not connected under client ${RETENTION_CANARY.clientId} (found ${(conn as any)?.account_id ?? 'nothing'})`
    const rec = await recordRetentionCanary({ state: 'failed', rows: 0, dates: [], error, wallLine, elapsedMs: Date.now() - t0 })
    console.error(`[retention-canary] FAILED before asking: ${error}`)
    return NextResponse.json({ ok: false, state: 'failed', error, recordError: rec.error, wallLine })
  }
  let rows = 0
  const dates = new Set<string>()
  let ok = true
  let error: string | null = null
  try {
    const stream = await googleAdsStreamFor(userEmail, RETENTION_CANARY.customerId)
    for await (const row of stream(RETENTION_CANARY_GAQL)) {
      rows++
      const d = row?.segments?.date
      if (typeof d === 'string') dates.add(d.slice(0, 10))
    }
  } catch (e: any) {
    ok = false
    const err = e?.errors?.[0]
    error = `${JSON.stringify(err?.error_code ?? err?.errorCode ?? {})} ${err?.message ?? e?.message ?? String(e)}`.slice(0, 400)
  }
  const state = canaryVerdict({ ok, rows, error })
  const rec = await recordRetentionCanary({ state, rows, dates: [...dates].sort(), error, wallLine, elapsedMs: Date.now() - t0 })
  const line = `[retention-canary] ${state.toUpperCase()}: ${rows} row(s) for ${RETENTION_CANARY.probeStart}..${RETENTION_CANARY.probeEnd} past the wall ${wallLine}${error ? ` — ${error}` : ''}${rec.error ? ` · RECORD FAILED: ${rec.error}` : ''}`
  if (state === 'served') console.log(line); else console.error(line)
  return NextResponse.json({ ok: state === 'served', state, rows, dates: [...dates].sort(), error, wallLine, recordError: rec.error, elapsedMs: Date.now() - t0 })
}
