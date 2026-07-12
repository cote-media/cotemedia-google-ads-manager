// LORAMER_NATIVE_AUTH_ALLOWLIST_V1 — invite-only screen. UNGATED by construction: a top-level sibling
// under src/app/ with no gating layout (not behind enforceWelcomeGate or the -next preview gate), reachable
// while unauthenticated. The Google signIn callback + the native signup 403 both redirect here (with ?email=).
// The form posts to /api/interest (Mailchimp interest capture) — it does NOT grant access.
'use client'

import { Suspense, useState } from 'react'
import { useSearchParams } from 'next/navigation'

function RequestAccessForm() {
  const params = useSearchParams()
  const [email, setEmail] = useState(params.get('email') || '')
  const [status, setStatus] = useState<'idle' | 'submitting' | 'done' | 'error'>('idle')
  const [error, setError] = useState('')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setStatus('submitting')
    try {
      const res = await fetch('/api/interest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      })
      if (!res.ok) {
        setError('Something went wrong. Please try again.')
        setStatus('error')
        return
      }
      setStatus('done')
    } catch {
      setError('Something went wrong. Please try again.')
      setStatus('error')
    }
  }

  if (status === 'done') {
    return (
      <div className="bg-white rounded-2xl shadow-card border border-border p-8 text-center">
        <div className="text-3xl mb-3">✉️</div>
        <p className="text-ink font-sans text-base">You&apos;re on the list — we&apos;ll be in touch.</p>
      </div>
    )
  }

  return (
    <div className="bg-white rounded-2xl shadow-card border border-border p-8">
      <p className="text-sm text-ink font-sans mb-6">
        LoraMer is invite-only right now. Leave your email and we&apos;ll reach out when a spot opens up.
      </p>
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
        {error && (
          <div className="text-sm text-red-600 font-sans bg-red-50 border border-red-200 rounded-lg px-3 py-2">
            {error}
          </div>
        )}
        <button
          type="submit"
          disabled={status === 'submitting' || !email}
          className="w-full bg-ink text-white rounded-xl py-3 font-sans font-medium hover:opacity-90 transition-opacity disabled:opacity-40"
        >
          {status === 'submitting' ? 'Adding you...' : 'Keep me posted'}
        </button>
      </form>
    </div>
  )
}

export default function RequestAccessPage() {
  return (
    <div className="min-h-screen bg-paper flex items-center justify-center px-6 py-8">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <h1 className="font-display text-4xl text-ink mb-2">LoraMer</h1>
          <p className="text-muted text-sm font-sans">Invite-only</p>
        </div>
        <Suspense fallback={<div className="bg-white rounded-2xl shadow-card border border-border p-8 text-sm text-muted">Loading...</div>}>
          <RequestAccessForm />
        </Suspense>
        <p className="text-center text-xs text-muted font-sans mt-6">
          Already invited? <a href="/login" className="text-accent hover:underline">Sign in</a>
        </p>
      </div>
    </div>
  )
}
