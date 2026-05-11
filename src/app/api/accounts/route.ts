import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { listAccessibleAccounts } from '@/lib/google-ads'

export async function GET() {
  const session = await getServerSession(authOptions) as any
  
  console.log('Session data:', JSON.stringify({
    hasSession: !!session,
    hasRefreshToken: !!session?.refreshToken,
    refreshTokenPreview: session?.refreshToken?.substring(0, 20),
    user: session?.user?.email
  }))

  if (!session?.refreshToken) {
    return NextResponse.json({ error: 'Unauthorized - no refresh token' }, { status: 401 })
  }
  try {
    const accounts = await listAccessibleAccounts(session.refreshToken)
    return NextResponse.json({ accounts })
  } catch (error: any) {
    console.error('Accounts error:', error.message, error.code, error.details)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}