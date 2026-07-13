import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'

export async function GET(request: Request) {
  const session = await getServerSession(authOptions) as any
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const { searchParams } = new URL(request.url)
  const clientId = searchParams.get('clientId')
  const appId = process.env.META_APP_ID!
  const redirectUri = process.env.NEXTAUTH_URL + '/api/meta/callback'
  // LORAMER_META_SCOPE_READONLY_V1: read-only launch posture. Dropped the
  // unused write scope (ads_management — product makes zero mutate calls);
  // kept business_management (needed to enumerate BM owned/client ad accounts
  // in the callback). Affects NEW authorizations only; existing tokens unchanged.
  const scope = 'ads_read,business_management'
  // LORAMER_NEXT_CONNECT_V1 F2b — carry an OPTIONAL returnTo in the state (absent → state shape identical to before).
  const returnTo = searchParams.get('returnTo') || undefined
  const state = Buffer.from(JSON.stringify({ clientId, email: session.user.email, ...(returnTo ? { returnTo } : {}) })).toString('base64')
  const authUrl = `https://www.facebook.com/v18.0/dialog/oauth?client_id=${appId}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${scope}&state=${state}&response_type=code`
  return NextResponse.redirect(authUrl)
}
