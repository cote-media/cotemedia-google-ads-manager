'use client'
import { signIn, useSession } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import { useEffect } from 'react'

export default function Home() {
  const { data: session, status } = useSession()
  const router = useRouter()

  useEffect(() => {
    if (session) router.push('/dashboard')
  }, [session, router])

  if (status === 'loading') {
    return (
      <div className="min-h-screen bg-paper flex items-center justify-center">
        <div className="w-1 h-8 bg-ink animate-pulse" />
      </div>
    )
  }

  return (
    <main className="min-h-screen bg-paper flex flex-col">
      {/* Top bar */}
      <div className="border-b border-border px-8 py-4 flex items-center justify-between">
        <span className="font-mono text-xs tracking-widest uppercase text-muted">Cote Media</span>
        <span className="font-mono text-xs tracking-widest uppercase text-muted">Ads Manager</span>
      </div>

      {/* Hero */}
      <div className="flex-1 flex flex-col items-center justify-center px-8 py-24">
        <div className="max-w-xl w-full">
          <div className="mb-2">
            <span className="font-mono text-xs tracking-widest uppercase text-accent">Beta</span>
          </div>
          <h1 className="font-display text-6xl text-ink leading-tight mb-6">
            Your ads,<br />
            <em>reimagined.</em>
          </h1>
          <p className="text-muted text-lg leading-relaxed mb-10 max-w-md">
            Manage campaigns, analyze performance, and execute changes across every platform and client account — through natural conversation with Claude.
          </p>

          <button
            onClick={() => signIn('google', { callbackUrl: '/dashboard' })}
            className="btn-primary flex items-center gap-3 w-fit"
          >
            <GoogleIcon />
            Sign in with Google
          </button>

          <p className="mt-6 text-xs text-muted font-mono">
            Access restricted to Cote Media organization accounts.
          </p>
        </div>
      </div>

      {/* Feature strip */}
      <div className="border-t border-border">
        <div className="grid grid-cols-3 divide-x divide-border">
          {[
            { label: 'Multi-Platform Intelligence', desc: 'Google, Meta, and more in one place. Ask questions, get answers across all your accounts.' },
            { label: 'AI-Powered Execution', desc: 'Claude recommends specific changes you can approve and push live in one click.' },
            { label: 'Agency-Ready', desc: 'Manage every client from a single dashboard. Switch accounts in seconds, never lose context.' },
          ].map((f) => (
            <div key={f.label} className="px-8 py-6">
              <div className="metric-label mb-2">{f.label}</div>
              <p className="text-sm text-muted leading-relaxed">{f.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </main>
  )
}

function GoogleIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
    </svg>
  )
}
