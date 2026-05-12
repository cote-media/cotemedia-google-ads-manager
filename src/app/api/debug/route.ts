import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { GoogleAdsApi } from 'google-ads-api'

export async function GET(request: Request) {
  const session = await getServerSession(authOptions) as any
  if (!session?.refreshToken) return NextResponse.json({ error: 'no session' })
  const { searchParams } = new URL(request.url)
  const accountId = searchParams.get('accountId')
  if (!accountId) return NextResponse.json({ error: 'need accountId' })
  const client = new GoogleAdsApi({
    client_id: process.env.GOOGLE_CLIENT_ID!,
    client_secret: process.env.GOOGLE_CLIENT_SECRET!,
    developer_token: process.env.GOOGLE_ADS_DEVELOPER_TOKEN!,
  })
  const customer = client.Customer({
    customer_id: accountId,
    refresh_token: session.refreshToken,
    login_customer_id: process.env.GOOGLE_ADS_MANAGER_ACCOUNT_ID!,
  })
  const rows = await customer.query('SELECT campaign.name, campaign.status FROM campaign WHERE campaign.status != REMOVED LIMIT 5')
  return NextResponse.json(rows.map((r: any) => ({ name: r.campaign.name, status: r.campaign.status })))
}
