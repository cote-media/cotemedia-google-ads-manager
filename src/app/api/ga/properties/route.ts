// LORAMER_GA_PROPERTY_PICKER_V1
// GA Phase 3 — list the Google Analytics properties the just-authorized user can
// access. Reads the access token stashed in the ga_oauth_tokens cookie (set by the
// OAuth callback) and calls the GA Admin API accountSummaries.list. Read-only.

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const GA_ADMIN_ACCOUNT_SUMMARIES =
  'https://analyticsadmin.googleapis.com/v1beta/accountSummaries?pageSize=200'

type PropertySummary = {
  property?: string
  displayName?: string
}

type AccountSummary = {
  account?: string
  displayName?: string
  propertySummaries?: PropertySummary[]
}

type AccountSummariesResponse = {
  accountSummaries?: AccountSummary[]
}

type StashedTokens = {
  access_token?: string
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const session = (await getServerSession(authOptions)) as any
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const cookie = request.cookies.get('ga_oauth_tokens')?.value
  if (!cookie) {
    return NextResponse.json(
      { error: 'No pending Google Analytics authorization. Please reconnect.' },
      { status: 400 }
    )
  }

  let accessToken = ''
  try {
    const parsed = JSON.parse(cookie) as StashedTokens
    accessToken = parsed.access_token || ''
  } catch {
    accessToken = ''
  }
  if (!accessToken) {
    return NextResponse.json(
      { error: 'Authorization expired. Please reconnect.' },
      { status: 400 }
    )
  }

  try {
    const res = await fetch(GA_ADMIN_ACCOUNT_SUMMARIES, {
      headers: { Authorization: 'Bearer ' + accessToken },
    })
    if (!res.ok) {
      const detail = await res.text()
      return NextResponse.json(
        {
          error: 'Could not list Google Analytics properties.',
          status: res.status,
          detail: detail.slice(0, 300),
        },
        { status: 502 }
      )
    }

    const data = (await res.json()) as AccountSummariesResponse
    const properties: Array<{
      account_id: string
      account_name: string
      property_id: string
      property_name: string
    }> = []

    for (const acc of data.accountSummaries || []) {
      for (const prop of acc.propertySummaries || []) {
        if (prop.property) {
          properties.push({
            account_id: acc.account || '',
            account_name: acc.displayName || '',
            property_id: prop.property,
            property_name: prop.displayName || prop.property,
          })
        }
      }
    }

    return NextResponse.json({ properties })
  } catch {
    return NextResponse.json(
      { error: 'Could not reach Google Analytics.' },
      { status: 502 }
    )
  }
}
