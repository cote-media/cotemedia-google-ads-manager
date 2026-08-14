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
  // LORAMER_RMF_REPORTING_DEFAULTS_V1 — the UI has ALWAYS sent ?dateRange= (dashboard/page.tsx KeywordsTab) and
  // this route has ALWAYS ignored it, so every Keywords request silently ran getKeywords' LAST_30_DAYS default
  // while the screen displayed the label the user had chosen. The date picker was inert. RMF asks for a
  // user-selectable range on each displayed level; it now actually reaches the query.
  const dateRange = searchParams.get('dateRange') || 'LAST_30_DAYS'
  const customStart = searchParams.get('customStart') || undefined
  const customEnd = searchParams.get('customEnd') || undefined

  if (!accountId) {
    return NextResponse.json({ error: 'accountId required' }, { status: 400 })
  }
  try {
    const keywords = await getKeywords(session.refreshToken, accountId, dateRange, customStart, customEnd)
    return NextResponse.json({ keywords })
  } catch (error: any) {
    console.error('Keywords error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}