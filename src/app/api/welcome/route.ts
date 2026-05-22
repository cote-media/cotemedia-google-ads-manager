import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { supabaseAdmin } from '@/lib/supabase'

export async function POST() {
  const session = await getServerSession(authOptions)
  const email = session?.user?.email

  if (!email) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })
  }

  const { error } = await supabaseAdmin
    .from('user_profiles')
    .upsert(
      {
        user_email: email,
        welcome_seen_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_email' }
    )

  if (error) {
    console.error('[welcome] failed to set welcome_seen_at:', error)
    return NextResponse.json({ error: 'db_error' }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
