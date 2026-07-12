// LORAMER_NATIVE_AUTH_V1 — email/password login (slice 1). Mirrors reviewer-login/page.tsx:
// signIn('password', {redirect:false}) → push /clients on success, inline error + block on failure.
'use client'

import { useState } from 'react'
import { signIn } from 'next-auth/react'
import { useRouter } from 'next/navigation'

export default function LoginPage() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const result = await signIn('password', { email, password, redirect: false })
      if (result?.error) {
        setError('Invalid email or password.')
        setLoading(false)
        return
      }
      router.push('/clients')
    } catch {
      setError('Sign-in failed. Try again.')
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-paper flex items-center justify-center px-6">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <h1 className="font-display text-4xl text-ink mb-2">LoraMer</h1>
          <p className="text-muted text-sm font-sans">Sign in to your account</p>
        </div>
        <div className="bg-white rounded-2xl shadow-card border border-border p-8">
          <form onSubmit={handleSubmit} className="space-y-4">
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
                placeholder="Your password"
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
              {loading ? 'Signing in...' : 'Sign in'}
            </button>
          </form>
        </div>
        <p className="text-center text-xs text-muted font-sans mt-6">
          New here? <a href="/signup" className="text-accent hover:underline">Create an account</a>
        </p>
        {/* TODO(LORAMER_NATIVE_AUTH slice 2): "Forgot password?" reset link — needs a transactional email sender. */}
      </div>
    </div>
  )
}
