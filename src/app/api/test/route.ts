import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'

export async function GET() {
  const session = await getServerSession(authOptions) as any
  if (!session?.refreshToken) {
    return NextResponse.json({ error: 'no session' })
  }
  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      refresh_token: session.refreshToken,
      grant_type: 'refresh_token',
    }),
  })
  const tokenData = await tokenRes.json()
  if (!tokenData.access_token) {
    return NextResponse.json({ error: 'token failed', details: tokenData })
  }
  const apiRes = await fetch(
    'https://googleads.googleapis.com/v19/customers/' + process.env.GOOGLE_ADS_MANAGER_ACCOUNT_ID + '/googleAds:search',
    {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + tokenData.access_token,
        'developer-token': process.env.GOOGLE_ADS_DEVELOPER_TOKEN!,
        'login-customer-id': process.env.GOOGLE_ADS_MANAGER_ACCOUNT_ID!,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query: 'SELECT customer.id, customer.descriptive_name FROM customer LIMIT 1' }),
    }
  )
  const responseText = await apiRes.text()
  return NextResponse.json({ status: apiRes.status, response: responseText.substring(0, 1000) })
}
