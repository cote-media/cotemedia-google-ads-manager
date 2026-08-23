import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { safeReturnTo } from '@/lib/access/return-to' // LORAMER_NEXT_CONNECT_V1 F2b — same open-redirect guard as F2

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

  let stateData: { clientId: string; email: string; returnTo?: string }
  try {
    stateData = JSON.parse(Buffer.from(state, 'base64').toString())
  } catch {
    return NextResponse.redirect(process.env.NEXTAUTH_URL + '/clients?meta_error=invalid_state')
  }

  // LORAMER_NEXT_CONNECT_V1 F2b — POST-decode redirects honor a valid -next returnTo (carrying the same query the
  // legacy /clients redirect carries); absent/invalid → the existing /clients redirect, BYTE-IDENTICAL. Pre-decode
  // error redirects above stay /clients (returnTo not yet known). Same safeReturnTo guard as F2.
  const rt = safeReturnTo(stateData.returnTo)
  const metaDest = (qs: string) =>
    rt ? `${process.env.NEXTAUTH_URL}${rt}${rt.includes('?') ? '&' : '?'}${qs}`
       : `${process.env.NEXTAUTH_URL}/clients?${qs}`

  const appId = process.env.META_APP_ID!
  const appSecret = process.env.META_APP_SECRET!
  const redirectUri = process.env.NEXTAUTH_URL + '/api/meta/callback'

  try {
    // Exchange code for short-lived token
    const tokenRes = await fetch(`https://graph.facebook.com/v18.0/oauth/access_token?client_id=${appId}&redirect_uri=${encodeURIComponent(redirectUri)}&client_secret=${appSecret}&code=${code}`)
    const tokenData = await tokenRes.json()
    if (!tokenData.access_token) return NextResponse.redirect(metaDest('meta_error=no_token'))

    // Exchange for long-lived token
    const longLivedRes = await fetch(`https://graph.facebook.com/v18.0/oauth/access_token?grant_type=fb_exchange_token&client_id=${appId}&client_secret=${appSecret}&fb_exchange_token=${tokenData.access_token}`)
    const longLivedData = await longLivedRes.json()
    const finalToken = longLivedData.access_token || tokenData.access_token

    // Get ALL ad accounts (direct + BM owned + BM client)
    const adAccounts = await getAllMetaAccounts(finalToken)

    // LORAMER_META_FBUSERID_FOUNDATION_V1: capture the app-scoped Facebook
    // user id at connect time — Meta's deauthorize/data-deletion callbacks
    // identify the person only by this id. Best-effort: a /me failure must
    // never break connect (fb_user_id stays null until next reconnect).
    let fbUserId: string | null = null
    try {
      const meRes = await fetch(`https://graph.facebook.com/v18.0/me?fields=id&access_token=${finalToken}`)
      const meData = await meRes.json()
      if (meRes.ok && meData?.id) fbUserId = String(meData.id)
      else console.error('Meta /me fetch failed:', { status: meRes.status, body: meData })
    } catch (e) {
      console.error('Meta /me fetch threw:', e)
    }

    // Store token. LORAMER_META_CALLBACK_ONCONFLICT_V1: onConflict:'user_email' is REQUIRED — meta_tokens has
    // PK=id + UNIQUE(user_email); without the conflict target the upsert INSERTs and, for any EXISTING row, hits a
    // unique-violation on user_email → re-auth was a silent no-op (only the first-ever connect ever wrote; the
    // success redirect fired regardless). Mirror the google_tokens upsert (src/lib/auth.ts:80). CHECK the returned
    // error (no silent swallow — standing law): on failure, console.error + redirect with an error param instead of
    // the false-success redirect, so a failed write surfaces to the user rather than looking connected.
    const { error: tokenErr } = await supabaseAdmin.from('meta_tokens').upsert({
      user_email: stateData.email,
      access_token: finalToken,
      fb_user_id: fbUserId,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_email' })
    if (tokenErr) {
      console.error('Meta token upsert failed:', { email: stateData.email, detail: tokenErr.message })
      return NextResponse.redirect(metaDest('meta_error=token_store_failed'))
    }

    const accountsEncoded = encodeURIComponent(JSON.stringify(adAccounts))
    return NextResponse.redirect(
      metaDest('meta_accounts=' + accountsEncoded + '&client_id=' + stateData.clientId)
    )
  } catch (e: any) {
    console.error('Meta OAuth error:', e)
    return NextResponse.redirect(metaDest('meta_error=oauth_failed'))
  }
}
