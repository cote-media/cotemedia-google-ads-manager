// LORAMER_REVIEWER_BYPASS_V1
'use client'

import { useState } from 'react'
import { signIn } from 'next-auth/react'
import { useRouter, useSearchParams } from 'next/navigation'

export default function ReviewerLoginPage() {
  const router = useRouter()
  const params = useSearchParams()
  const [token, setToken] = useState(params.get('token') || '')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const result = await signIn('reviewer-token', { token, redirect: false })
      if (result?.error) {
        setError('Invalid token. Check the value and try again.')
        setLoading(false)
        return
      }
      router.push('/clients')
    } catch (err) {
      setError('Sign-in failed. Try again.')
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-paper flex items-center justify-center px-6">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <h1 className="font-display text-4xl text-ink mb-2">LoraMer</h1>
          <p className="text-muted text-sm font-sans">Reviewer access</p>
        </div>
        <div className="bg-white rounded-2xl shadow-card border border-border p-8">
          <p className="text-sm text-ink font-sans mb-6">
            Enter the access token provided in your testing instructions to sign in.
          </p>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-mono text-muted mb-2 uppercase tracking-wide">
                Access token
              </label>
              <input
                type="password"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                className="w-full px-4 py-3 rounded-xl border border-border bg-paper text-ink font-sans focus:outline-none focus:border-accent"
                placeholder="Paste the token here"
                autoFocus
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
              disabled={loading || !token}
              className="w-full bg-ink text-white rounded-xl py-3 font-sans font-medium hover:opacity-90 transition-opacity disabled:opacity-40"
            >
              {loading ? 'Signing in…' : 'Sign in'}
            </button>
          </form>
        </div>
        <p className="text-center text-xs text-muted font-sans mt-6">
          For Shopify App Store reviewers only.
        </p>
      </div>
    </div>
  )
}
