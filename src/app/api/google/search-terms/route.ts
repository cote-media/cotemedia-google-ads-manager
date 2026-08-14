// LORAMER_RMF_R70_SEARCH_TERMS_V1 — the R.70 (Search Term) data route for the legacy Search Terms tab.
// Cloned from /api/keywords (the sibling whose params-dropped defect was fixed in b1d8d3e): identical session
// refreshToken gate, and dateRange + customStart/customEnd FORWARDED from day one — never inert.
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { getSearchTerms } from '@/lib/google-ads'

// token-freshness guard requirement: a token-reading route must never be statically cached (a cached response
// would serve one user's data shape past its token's life). The baselined siblings predate the rule; new
// routes carry it from birth.
export const dynamic = 'force-dynamic'
export const fetchCache = 'force-no-store'

export async function GET(request: Request) {
  const session = await getServerSession(authOptions) as any
  if (!session?.refreshToken) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const { searchParams } = new URL(request.url)
  const accountId = searchParams.get('accountId')
  const dateRange = searchParams.get('dateRange') || 'LAST_30_DAYS'
  const customStart = searchParams.get('customStart') || undefined
  const customEnd = searchParams.get('customEnd') || undefined

  if (!accountId) {
    return NextResponse.json({ error: 'accountId required' }, { status: 400 })
  }
  try {
    const searchTerms = await getSearchTerms(session.refreshToken, accountId, dateRange, customStart, customEnd)
    return NextResponse.json({ searchTerms })
  } catch (error: any) {
    console.error('Search terms error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
