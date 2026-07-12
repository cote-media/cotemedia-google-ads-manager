// LORAMER_NATIVE_AUTH_ALLOWLIST_V1 — the ONE shared invite-only gate predicate, used by BOTH doors:
// the Google signIn callback (src/lib/auth.ts) AND POST /api/auth/signup. signup_allowlist is the writable
// source of truth (manual seed + RBAC invites); existing owners/members are unioned as a SAFETY NET so an
// existing user is never locked out even if the backfill missed them. Normalization (trim + lowercase)
// matches slice-1 signup EXACTLY, so casing never bounces an allowlisted user.
import { supabaseAdmin } from '@/lib/supabase'

export async function isAllowed(rawEmail: string | null | undefined): Promise<boolean> {
  const email = (rawEmail || '').trim().toLowerCase()
  if (!email) return false

  // 1) explicit allowlist (seed + rbac_invite writes) — the primary gate.
  const { data: listed } = await supabaseAdmin
    .from('signup_allowlist').select('email').eq('email', email).maybeSingle()
  if (listed) return true

  // 2) safety net: an existing org owner (emails are stored lowercased on the write paths).
  const { data: owner } = await supabaseAdmin
    .from('organizations').select('owner_email').eq('owner_email', email).maybeSingle()
  if (owner) return true

  // 3) safety net: an existing org member.
  const { data: member } = await supabaseAdmin
    .from('org_members').select('member_email').eq('member_email', email).maybeSingle()
  if (member) return true

  return false
}
