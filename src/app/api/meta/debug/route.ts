import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { supabaseAdmin } from '@/lib/supabase'

export async function GET(request: Request) {
  const session = await getServerSession(authOptions) as any
  if (!session?.user?.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { searchParams } = new URL(request.url)
  const accountId = searchParams.get('accountId') || ''
  const { data: tokenRow } = await supabaseAdmin.from('meta_tokens').select('access_token').eq('user_email', session.user.email).single()
  if (!tokenRow?.access_token) return NextResponse.json({ error: 'No token' }, { status: 401 })
  const token = tokenRow.access_token
  const id = accountId.startsWith('act_') ? accountId : 'act_' + accountId
  const url = `https://graph.facebook.com/v18.0/${id}/campaigns?fields=name,status,effective_status,insights.date_preset(this_month){spend,clicks,impressions}&limit=10&access_token=${token}`
  const res: Response = await fetch(url)
  const data = await res.json()
  return NextResponse.json(data)
}
