// LORAMER_NATIVE_AUTH_V1 — email/password signup (slice 1). Mirrors reviewer-login/page.tsx's
// authoritative pattern: POST /api/auth/signup → on success signIn('password') → push /welcome; on
// failure show inline error and DO NOT navigate. If the two-door choice was already carried from
// /agency|/business (signup_org_type cookie), the choice UI is hidden; otherwise the user picks here,
// and the choice rides the SAME cookie into /welcome (identical to the Google path).
'use client'

import { useEffect, useState } from 'react'
import { signIn } from 'next-auth/react'
import { useRouter } from 'next/navigation'

type Choice = 'agency' | 'business'

function readCookie(name: string): string | null {
  if (typeof document === 'undefined') return null
  const m = document.cookie.match(new RegExp('(?:^|; )' + name + '=([^;]*)'))
  return m ? decodeURIComponent(m[1]) : null
}

export default function SignupPage() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [choice, setChoice] = useState<Choice | ''>('')
  const [cookieChoice, setCookieChoice] = useState<Choice | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    const c = readCookie('signup_org_type')
    if (c === 'agency' || c === 'business') setCookieChoice(c)
  }, [])

  const needChoice = !cookieChoice
  const effectiveType: Choice | '' = cookieChoice || choice

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    if (needChoice && effectiveType !== 'agency' && effectiveType !== 'business') {
      setError('Please choose Agency or Business.')
      return
    }
    if (password.length < 8) {
      setError('Password must be at least 8 characters.')
      return
    }
    setLoading(true)
    try {
      const res = await fetch('/api/auth/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, account_type: effectiveType || undefined }),
      })
      if (res.status === 409) {
        setError('An account with that email already exists. Try signing in.')
        setLoading(false)
        return
      }
      if (!res.ok) {
        const j = await res.json().catch(() => ({} as any))
        setError(j.error || 'Sign-up failed. Try again.')
        setLoading(false)
        return
      }
      // Belt-and-suspenders: also set the cookie client-side so /welcome auto-submits reliably.
      if (effectiveType === 'agency' || effectiveType === 'business') {
        document.cookie = `signup_org_type=${effectiveType}; path=/; max-age=1800; samesite=lax`
      }
      const result = await signIn('password', { email, password, redirect: false })
      if (result?.error) {
        setError('Account created, but sign-in failed. Try signing in.')
        setLoading(false)
        return
      }
      router.push('/welcome')
    } catch {
      setError('Sign-up failed. Try again.')
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-paper flex items-center justify-center px-6 py-8">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <h1 className="font-display text-4xl text-ink mb-2">LoraMer</h1>
          <p className="text-muted text-sm font-sans">Create your account</p>
        </div>
        <div className="bg-white rounded-2xl shadow-card border border-border p-8">
          <form onSubmit={handleSubmit} className="space-y-4">
            {needChoice && (
              <div>
                <label className="block text-xs font-mono text-muted mb-2 uppercase tracking-wide">How will you use LoraMer?</label>
                <div className="grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => setChoice('agency')}
                    className={'border-2 p-3 rounded-lg text-left transition-colors ' + (choice === 'agency' ? 'border-accent' : 'border-border')}
                  >
                    <div className="text-xl mb-1">🏢</div>
                    <div className="text-sm font-semibold text-ink">Agency</div>
                  </button>
                  <button
                    type="button"
                    onClick={() => setChoice('business')}
                    className={'border-2 p-3 rounded-lg text-left transition-colors ' + (choice === 'business' ? 'border-accent' : 'border-border')}
                  >
                    <div className="text-xl mb-1">🏪</div>
                    <div className="text-sm font-semibold text-ink">Business</div>
                  </button>
                </div>
              </div>
            )}
            <div>
              <label className="block text-xs font-mono text-muted mb-2 uppercase tracking-wide">Email</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full px-4 py-3 rounded-xl border border-border bg-paper text-ink font-sans focus:outline-none focus:border-accent"
                placeholder="you@company.com"
                autoFocus
                required
              />
            </div>
            <div>
              <label className="block text-xs font-mono text-muted mb-2 uppercase tracking-wide">Password</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-4 py-3 rounded-xl border border-border bg-paper text-ink font-sans focus:outline-none focus:border-accent"
                placeholder="At least 8 characters"
                required
              />
            </div>
            {error && (
              <div className="text-sm text-red-600 font-sans bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                {error}
              </div>
            )}
            <button
              type="submit"
              disabled={loading || !email || !password}
              className="w-full bg-ink text-white rounded-xl py-3 font-sans font-medium hover:opacity-90 transition-opacity disabled:opacity-40"
            >
              {loading ? 'Creating account...' : 'Create account'}
            </button>
          </form>
        </div>
        <p className="text-center text-xs text-muted font-sans mt-6">
          Already have an account? <a href="/login" className="text-accent hover:underline">Sign in</a>
        </p>
      </div>
    </div>
  )
}
