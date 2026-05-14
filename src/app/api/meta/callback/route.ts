import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

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
    const tokenRes = await fetch(`https://graph.facebook.com/v18.0/oauth/access_token?client_id=${appId}&redirect_uri=${encodeURIComponent(redirectUri)}&client_secret=${appSecret}&code=${code}`)
    const tokenData = await tokenRes.json()
    if (!tokenData.access_token) return NextResponse.redirect(process.env.NEXTAUTH_URL + '/clients?meta_error=no_token')

    const longLivedRes = await fetch(`https://graph.facebook.com/v18.0/oauth/access_token?grant_type=fb_exchange_token&client_id=${appId}&client_secret=${appSecret}&fb_exchange_token=${tokenData.access_token}`)
    const longLivedData = await longLivedRes.json()
    const finalToken = longLivedData.access_token || tokenData.access_token

    const accountsRes = await fetch(`https://graph.facebook.com/v18.0/me/adaccounts?fields=id,name,account_status&access_token=${finalToken}`)
    const accountsData = await accountsRes.json()
    const adAccounts = accountsData.data || []

    await supabaseAdmin.from('meta_tokens').upsert({ user_email: stateData.email, access_token: finalToken, updated_at: new Date().toISOString() })

    const accountsEncoded = encodeURIComponent(JSON.stringify(adAccounts))
    return NextResponse.redirect(process.env.NEXTAUTH_URL + '/clients?meta_accounts=' + accountsEncoded + '&client_id=' + stateData.clientId)
  } catch (e: any) {
    console.error('Meta OAuth error:', e)
    return NextResponse.redirect(process.env.NEXTAUTH_URL + '/clients?meta_error=oauth_failed')
  }
}
