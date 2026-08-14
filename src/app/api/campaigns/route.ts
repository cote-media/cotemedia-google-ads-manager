import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { getAccountSummary } from '@/lib/google-ads'

export async function GET(request: Request) {
  const session = await getServerSession(authOptions) as any
  if (!session?.refreshToken) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const { searchParams } = new URL(request.url)
  const accountId = searchParams.get('accountId')
  const dateRange = searchParams.get('dateRange') || 'LAST_30_DAYS'
  // LORAMER_GAQL_DATE_WINDOW_V1 — customs forwarded so a custom range reaches the query (the keywords route
  // had exactly this params-dropped defect until b1d8d3e).
  const customStart = searchParams.get('customStart') || undefined
  const customEnd = searchParams.get('customEnd') || undefined

  if (!accountId) {
    return NextResponse.json({ error: 'accountId required' }, { status: 400 })
  }
  try {
    const summary = await getAccountSummary(session.refreshToken, accountId, dateRange, customStart, customEnd)
    return NextResponse.json(summary)
  } catch (error: any) {
    console.error('Campaigns error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}