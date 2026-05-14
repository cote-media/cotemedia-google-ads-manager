import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

export const supabase = createClient(supabaseUrl, supabaseAnonKey)

export type Client = {
  id: string
  user_email: string
  name: string
  created_at: string
}

export type PlatformConnection = {
  id: string
  client_id: string
  user_email: string
  platform: 'google' | 'meta'
  account_id: string
  account_name: string
  created_at: string
}
