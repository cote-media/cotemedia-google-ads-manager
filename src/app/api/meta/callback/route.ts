import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

async function getAllMetaAccounts(accessToken: string): Promise<any[]> {
  const accounts: any[] = []

  // 1. Get direct ad accounts
  let url: string | null = `https://graph.facebook.com/v18.0/me/adaccounts?fields=id,name,account_status,business&limit=100&access_token=${accessToken}`
  while (url) {
    const res: Response = await fetch(url)
    const data = await res.json()
    if (data.data) accounts.push(...data.data)
    url = data.paging?.next || null
  }

  // 2. Get Business Managers
  const bizRes = await fetch(`https://graph.facebook.com/v18.0/me/businesses?fields=id,name&limit=100&access_token=${accessToken}`)
  const bizData = await bizRes.json()
  const businesses = bizData.data || []

  // 3. For each BM, get owned and client ad accounts
  for (const biz of businesses) {
    // Owned accounts
    let ownedUrl: string | null = `https://graph.facebook.com/v18.0/${biz.id}/owned_ad_accounts?fields=id,name,account_status&limit=100&access_token=${accessToken}`
    while (ownedUrl) {
      const res: Response = await fetch(ownedUrl)
      const data = await res.json()
      if (data.data) accounts.push(...data.data)
      ownedUrl = data.paging?.next || null
    }

    // Client accounts
    let clientUrl: string | null = `https://graph.facebook.com/v18.0/${biz.id}/client_ad_accounts?fields=id,name,account_status&limit=100&access_token=${accessToken}`
    while (clientUrl) {
      const res: Response = await fetch(clientUrl)
      const data = await res.json()
      if (data.data) accounts.push(...data.data)
      clientUrl = data.paging?.next || null
    }
  }

  // Deduplicate by id
  const seen = new Set<string>()
  return accounts.filter(a => {
    if (seen.has(a.id)) return false
    seen.add(a.id)
    return true
  })
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const code = searchParams.get('code')
  const state = searchParams.get('state')
  const error = searchParams.get('error')

  if (error) return NextResponse.redirect(process.env.NEXTAUTH_URL + '/clients?meta_error=' + error)
  if (!code || !state) return NextResponse.redirect(process.env.NEXTAUTH_URL + '/clients?meta_error=missing_params')

  let stateData: { clientId: string; email: string }
  try {
    stateData = JSON.parse(Buffer.from(state, 'base64').toString())
  } catch {
    return NextResponse.redirect(process.env.NEXTAUTH_URL + '/clients?meta_error=invalid_state')
  }

  const appId = process.env.META_APP_ID!
  const appSecret = process.env.META_APP_SECRET!
  const redirectUri = process.env.NEXTAUTH_URL + '/api/meta/callback'

  try {
    // Exchange code for short-lived token
    const tokenRes = await fetch(`https://graph.facebook.com/v18.0/oauth/access_token?client_id=${appId}&redirect_uri=${encodeURIComponent(redirectUri)}&client_secret=${appSecret}&code=${code}`)
    const tokenData = await tokenRes.json()
    if (!tokenData.access_token) return NextResponse.redirect(process.env.NEXTAUTH_URL + '/clients?meta_error=no_token')

    // Exchange for long-lived token
    const longLivedRes = await fetch(`https://graph.facebook.com/v18.0/oauth/access_token?grant_type=fb_exchange_token&client_id=${appId}&client_secret=${appSecret}&fb_exchange_token=${tokenData.access_token}`)
    const longLivedData = await longLivedRes.json()
    const finalToken = longLivedData.access_token || tokenData.access_token

    // Get ALL ad accounts (direct + BM owned + BM client)
    const adAccounts = await getAllMetaAccounts(finalToken)

    // Store token
    await supabaseAdmin.from('meta_tokens').upsert({
      user_email: stateData.email,
      access_token: finalToken,
      updated_at: new Date().toISOString(),
    })

    const accountsEncoded = encodeURIComponent(JSON.stringify(adAccounts))
    return NextResponse.redirect(
      process.env.NEXTAUTH_URL + '/clients?meta_accounts=' + accountsEncoded + '&client_id=' + stateData.clientId
    )
  } catch (e: any) {
    console.error('Meta OAuth error:', e)
    return NextResponse.redirect(process.env.NEXTAUTH_URL + '/clients?meta_error=oauth_failed')
  }
}
