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
  const scope = 'ads_read,ads_management,business_management'
  const state = Buffer.from(JSON.stringify({ clientId, email: session.user.email })).toString('base64')
  const authUrl = `https://www.facebook.com/v18.0/dialog/oauth?client_id=${appId}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${scope}&state=${state}&response_type=code`
  return NextResponse.redirect(authUrl)
}
