// LORAMER_META_FBUSERID_FOUNDATION_V1
// ONE-OFF backfill: populate meta_tokens.fb_user_id for rows connected
// before the callback started capturing it. Must run while tokens are still
// alive — the id CANNOT be recovered at deauthorize time (token already
// revoked by Meta). CRON_SECRET-bearer GET, same auth as the backfill driver.
//
// Naturally idempotent: only touches rows where fb_user_id IS NULL, so once
// all rows are populated it is a no-op. PLANNED CLEANUP: remove this route
// in the Phase 2 commit after the prod run is confirmed.

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

export const maxDuration = 60

export async function GET(request: Request) {
  const envSecret = (process.env.CRON_SECRET ?? '').trim()
  const authHeader = request.headers.get('authorization') ?? ''
  const gotToken = (
    authHeader.startsWith('Bearer ') ? authHeader.slice('Bearer '.length) : authHeader
  ).trim()
  if (!envSecret || gotToken !== envSecret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { data: rows, error } = await supabaseAdmin
    .from('meta_tokens')
    .select('user_email, access_token')
    .is('fb_user_id', null)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  let updated = 0
  const failed: Array<{ user_email: string; error: string }> = []

  for (const row of rows ?? []) {
    try {
      const meRes = await fetch(`https://graph.facebook.com/v18.0/me?fields=id&access_token=${row.access_token}`)
      const meData = await meRes.json()
      if (!meRes.ok || !meData?.id) {
        failed.push({ user_email: row.user_email, error: meData?.error?.message || `HTTP ${meRes.status}` })
        continue
      }
      const { error: updateError } = await supabaseAdmin
        .from('meta_tokens')
        .update({ fb_user_id: String(meData.id) })
        .eq('user_email', row.user_email)
      if (updateError) {
        failed.push({ user_email: row.user_email, error: updateError.message })
        continue
      }
      updated++
    } catch (e: any) {
      failed.push({ user_email: row.user_email, error: e?.message || 'fetch threw' })
    }
  }

  return NextResponse.json({
    candidates: rows?.length ?? 0,
    updated,
    failed,
  })
}
