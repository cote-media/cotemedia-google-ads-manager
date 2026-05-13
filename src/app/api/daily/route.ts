import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { getDailyMetrics } from '@/lib/google-ads'

export async function GET(request: Request) {
  const session = await getServerSession(authOptions) as any
  if (!session?.refreshToken) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const { searchParams } = new URL(request.url)
  const accountId = searchParams.get('accountId')
  const dateRange = searchParams.get('dateRange') || 'LAST_30_DAYS'
  if (!accountId) {
    return NextResponse.json({ error: 'accountId required' }, { status: 400 })
  }
  try {
    const data = await getDailyMetrics(session.refreshToken, accountId, dateRange)
    return NextResponse.json({ daily: data })
  } catch (error: any) {
    console.error('Daily metrics error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
