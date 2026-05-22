import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { supabaseAdmin } from '@/lib/supabase'
import { redirect } from 'next/navigation'

export default async function ClientsLayout({ children }: { children: React.ReactNode }) {
  const session = await getServerSession(authOptions)
  const email = session?.user?.email

  if (email) {
    try {
      const { data, error } = await supabaseAdmin
        .from('user_profiles')
        .select('welcome_seen_at')
        .eq('user_email', email)
        .maybeSingle()

      if (!error && (!data || data.welcome_seen_at === null)) {
        redirect('/welcome')
      }
    } catch (e: any) {
      if (e?.digest?.startsWith?.('NEXT_REDIRECT')) throw e
      console.error('[clients layout] welcome check failed, continuing:', e)
    }
  }

  return <>{children}</>
}
