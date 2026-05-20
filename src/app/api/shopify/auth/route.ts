import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'

export async function GET(request: Request) {
  const session = await getServerSession(authOptions) as any
  if (!session?.user?.email) return NextResponse.redirect(new URL('/auth/signin', request.url))

  const { searchParams } = new URL(request.url)
  const clientId = searchParams.get('clientId')
  const shop = searchParams.get('shop') // e.g. my-store.myshopify.com

  if (!clientId || !shop) {
    return NextResponse.json({ error: 'clientId and shop required' }, { status: 400 })
  }

  // Normalize shop domain
  const shopDomain = shop.replace('https://', '').replace('http://', '').replace(/\/$/, '')
  if (!shopDomain.includes('.myshopify.com')) {
    return NextResponse.json({ error: 'Invalid shop domain. Must be in format: your-store.myshopify.com' }, { status: 400 })
  }

  const scopes = 'read_orders,read_products,read_customers'
  const redirectUri = `${process.env.NEXTAUTH_URL}/api/shopify/callback`
  const state = Buffer.from(JSON.stringify({ clientId, userEmail: session.user.email })).toString('base64')

  const authUrl = `https://${shopDomain}/admin/oauth/authorize?client_id=${process.env.SHOPIFY_CLIENT_ID}&scope=${scopes}&redirect_uri=${encodeURIComponent(redirectUri)}&state=${state}`

  return NextResponse.redirect(authUrl)
}
