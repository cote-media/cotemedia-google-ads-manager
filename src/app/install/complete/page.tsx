// LORAMER_SHOPIFY_INSTALL_V1
// src/app/install/complete/page.tsx
//
// Landing page after a Shopify-initiated install completes server-side.
// The /api/shopify/callback route signs a short-lived JWT containing the
// userEmail and redirects here with ?token=<jwt>. We call signIn() with
// the 'shopify-install' provider to create a NextAuth session, then push
// to the dashboard.
//
// This is the bridge between server-side OAuth completion and client-side
// session creation — analogous to how /reviewer-login works.

'use client'

import { Suspense, useEffect, useState } from 'react'
import { signIn } from 'next-auth/react'
import { useRouter, useSearchParams } from 'next/navigation'

function InstallCompleteInner() {
  const router = useRouter()
  const params = useSearchParams()
  const [error, setError] = useState('')

  useEffect(() => {
    const token = params.get('token')
    if (!token) {
      setError('Missing install token. Try installing LoraMer again from the Shopify App Store.')
      return
    }

    let cancelled = false
    ;(async () => {
      try {
        const result = await signIn('shopify-install', { token, redirect: false })
        if (cancelled) return
        if (result?.error) {
          setError('Install token invalid or expired. Try installing LoraMer again from the Shopify App Store.')
          return
        }
        router.push('/dashboard')
      } catch {
        if (!cancelled) {
          setError('Sign-in failed. Try installing LoraMer again from the Shopify App Store.')
        }
      }
    })()

    return () => { cancelled = true }
  }, [params, router])

  return (
    <div className="min-h-screen bg-paper flex items-center justify-center px-6">
      <div className="w-full max-w-md text-center">
        <h1 className="font-display text-4xl text-ink mb-2">LoraMer</h1>
        {error ? (
          <>
            <p className="text-sm text-red-600 font-sans bg-red-50 border border-red-200 rounded-lg px-4 py-3 mt-6">
              {error}
            </p>
            <a href="/" className="inline-block mt-6 text-sm font-mono text-accent hover:underline">
              Go to LoraMer home →
            </a>
          </>
        ) : (
          <>
            <p className="text-muted text-sm font-sans mt-6">Completing your install…</p>
            <div className="flex justify-center gap-1 mt-4">
              <span className="w-1.5 h-1.5 bg-muted rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
              <span className="w-1.5 h-1.5 bg-muted rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
              <span className="w-1.5 h-1.5 bg-muted rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
            </div>
          </>
        )}
      </div>
    </div>
  )
}

export default function InstallCompletePage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-paper flex items-center justify-center px-6">
        <div className="w-full max-w-md text-center">
          <h1 className="font-display text-4xl text-ink mb-2">LoraMer</h1>
          <p className="text-muted text-sm font-sans mt-6">Loading…</p>
        </div>
      </div>
    }>
      <InstallCompleteInner />
    </Suspense>
  )
}
