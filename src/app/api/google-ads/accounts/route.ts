// LORAMER_NEXT_CONNECT_V1 F3b — accessible Google Ads accounts sourced from the STORED owner token (google_tokens),
// NOT session.refreshToken. This is the decoupler's completion: after F3 captures the owner adwords token, the -next
// per-client account picker needs the account list even for NATIVE (email/password) owners who have no Google session.
// Legacy /api/accounts (session.refreshToken) is left untouched. Owner-keyed on the session email = the authorizing
// owner (mirrors the owner-only POST /api/clients/connections gate). Fails LOUD + structured (never silent []).
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { supabaseAdmin } from '@/lib/supabase'
import { listAccessibleAccounts } from '@/lib/google-ads'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  const session = (await getServerSession(authOptions)) as any
  const email = session?.user?.email
  if (!email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: tok } = await supabaseAdmin
    .from('google_tokens').select('refresh_token').eq('user_email', email).maybeSingle()
  const refreshToken = (tok?.refresh_token as string) || ''
  if (!refreshToken) return NextResponse.json({ error: 'not_authorized' }, { status: 409 })

  try {
    const accounts = await listAccessibleAccounts(refreshToken)
    return NextResponse.json({ accounts })
  } catch (e: any) {
    console.error('[gads-accounts] listAccessibleAccounts failed:', e?.message || e)
    return NextResponse.json({ error: e?.message || 'Could not list Google Ads accounts.' }, { status: 500 })
  }
}
