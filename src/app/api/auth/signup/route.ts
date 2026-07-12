// LORAMER_NATIVE_AUTH_V1 — email/password signup (slice 1). Mints ONLY the credential row; it does
// NOT create user_profiles or an org — the onboarding spine does that lazily at /welcome + first
// client-create (identical to the Google path). On success the client calls signIn('password', …)
// to establish the NextAuth session. NO email verification here (slice 2 — see TODO).
import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { hash } from 'bcryptjs'
import { isAllowed } from '@/lib/access/allowlist' // LORAMER_NATIVE_AUTH_ALLOWLIST_V1 — same gate as the Google door

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const MIN_PASSWORD = 8

export async function POST(request: Request) {
  let body: any
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'invalid body' }, { status: 400 })
  }

  const email = (body?.email || '').trim().toLowerCase()
  const password = typeof body?.password === 'string' ? body.password : ''
  const accountType = body?.account_type

  if (!EMAIL_RE.test(email)) {
    return NextResponse.json({ error: 'invalid email' }, { status: 400 })
  }
  if (password.length < MIN_PASSWORD) {
    return NextResponse.json({ error: `password must be at least ${MIN_PASSWORD} characters` }, { status: 400 })
  }

  // LORAMER_NATIVE_AUTH_ALLOWLIST_V1 — invite-only gate (SAME predicate as the Google door). Reject a
  // non-allowlisted email BEFORE any credential is written; the client routes a 403 not_invited to /request-access.
  if (!(await isAllowed(email))) {
    return NextResponse.json({ error: 'not_invited' }, { status: 403 })
  }

  // Reject an existing account (409). The unique PK also guards a race below.
  const { data: existing } = await supabaseAdmin
    .from('auth_credentials')
    .select('email')
    .eq('email', email)
    .maybeSingle()
  if (existing) {
    return NextResponse.json({ error: 'account exists' }, { status: 409 })
  }

  const password_hash = await hash(password, 10)
  const { error } = await supabaseAdmin.from('auth_credentials').insert({ email, password_hash })
  if (error) {
    if ((error as any).code === '23505') {
      // unique_violation — a concurrent signup won the race
      return NextResponse.json({ error: 'account exists' }, { status: 409 })
    }
    console.error('[signup] insert failed:', error)
    return NextResponse.json({ error: 'signup_failed' }, { status: 500 })
  }

  const res = NextResponse.json({ ok: true }) // no secrets in the response
  // Carry the two-door choice into /welcome exactly like the Google path (the spine reads this cookie).
  if (accountType === 'agency' || accountType === 'business') {
    res.cookies.set('signup_org_type', accountType, { path: '/', maxAge: 1800, sameSite: 'lax' })
  }
  // TODO(LORAMER_NATIVE_AUTH slice 2): send an email-verification link once a transactional sender
  // (e.g. Resend) is wired. Signup works without it — the password is set here.
  return res
}
