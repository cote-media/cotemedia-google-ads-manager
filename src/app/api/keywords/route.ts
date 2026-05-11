import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { getKeywords } from '@/lib/google-ads'

export async function GET(request: Request) {
  const session = await getServerSession(authOptions) as any
  if (!session?.refreshToken) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const { searchParams } = new URL(request.url)
  const accountId = searchParams.get('accountId')

  if (!accountId) {
    return NextResponse.json({ error: 'accountId required' }, { status: 400 })
  }
  try {
    const keywords = await getKeywords(session.refreshToken, accountId)
    return NextResponse.json({ keywords })
  } catch (error: any) {
    console.error('Keywords error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}