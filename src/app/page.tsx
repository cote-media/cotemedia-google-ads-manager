'use client'
import { signIn, useSession } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import { useEffect } from 'react'

export default function Home() {
  const { data: session } = useSession()
  const router = useRouter()

  useEffect(() => {
    if (session) router.push('/dashboard')
  }, [session, router])

  return (
    <main className="min-h-screen bg-paper flex flex-col">
      {/* Nav */}
      <div className="border-b border-border px-6 md:px-8 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <LoraMerIcon />
          <span style={{ fontFamily: "Georgia, 'Times New Roman', serif" }} className="text-xl text-ink">LoraMer</span>
        </div>
        <span className="font-mono text-xs tracking-widest uppercase text-muted">Beta</span>
      </div>

      {/* Hero */}
      <div className="flex-1 flex flex-col items-center justify-center px-6 md:px-8 py-10 md:py-24">
        <div className="max-w-xl w-full">
          <div className="mb-2">
            <span className="font-mono text-xs tracking-widest uppercase text-accent">Business intelligence, reimagined</span>
          </div>
          <h1 style={{ fontFamily: "Georgia, 'Times New Roman', serif" }} className="text-4xl md:text-6xl text-ink leading-tight mb-6">
            Your whole business,<br />
            <em>in one conversation.</em>
          </h1>
          <p className="text-muted text-base md:text-lg leading-relaxed mb-8 md:mb-10 max-w-md">
            Connect every data source you use — ads, sales, customers, products — and ask Lora anything. LoraMer reads across all of it to surface what&apos;s working, what&apos;s broken, and what to do next.
          </p>

          {/* Split cards */}
          <div className="grid grid-cols-2 gap-3 md:gap-4 mb-8 max-w-lg">
            <button
              onClick={() => window.location.href = '/agency'}
              className="border-2 border-border hover:border-accent p-4 md:p-6 text-left transition-all duration-200 group bg-white"
            >
              <div className="text-2xl mb-3">🏢</div>
              <div className="font-semibold text-ink mb-1 group-hover:text-accent transition-colors">I&apos;m an Agency</div>
              <p className="text-xs text-muted leading-relaxed">Managing multiple clients across platforms</p>
            </button>
            <button
              onClick={() => window.location.href = '/business'}
              className="border-2 border-border hover:border-accent p-4 md:p-6 text-left transition-all duration-200 group bg-white"
            >
              <div className="text-2xl mb-3">🏪</div>
              <div className="font-semibold text-ink mb-1 group-hover:text-accent transition-colors">I&apos;m a Business</div>
              <p className="text-xs text-muted leading-relaxed">Running my own store and accounts</p>
            </button>
          </div>

          {/* Returning user */}
          <div className="flex items-center gap-4 max-w-lg">
            <div className="flex-1 h-px bg-border"></div>
            <span className="text-xs text-muted font-mono">returning user?</span>
            <div className="flex-1 h-px bg-border"></div>
          </div>
          <button
            onClick={() => signIn('google', { callbackUrl: '/dashboard' })}
            className="btn-primary flex items-center gap-3 mt-4 w-fit"
          >
            <GoogleIcon />
            Sign in with Google
          </button>
        </div>
      </div>

      {/* Feature strip */}
      <div className="border-t border-border">
        <div className="grid grid-cols-1 md:grid-cols-3 md:divide-x divide-border">
          {[
            { label: 'Deep Knowledge', desc: 'Google, Meta, Shopify and more — Lora reads across every data source and remembers what you told it last week.' },
            { label: 'A Real Human, Always', desc: 'Every customer can reach a real person, on every plan. No bot-only support. No phone trees. Ever.' },
            { label: 'Built for Real Operators', desc: 'Whether you manage one store or fifty client accounts, LoraMer keeps context separate per account and answers in plain language.' },
          ].map((f, i) => (
            <div key={f.label} className={'px-6 md:px-8 py-5 md:py-6 ' + (i > 0 ? 'border-t md:border-t-0 border-border' : '')}>
              <div className="metric-label mb-2">{f.label}</div>
              <p className="text-sm text-muted leading-relaxed">{f.desc}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Footer */}
      <div className="border-t border-border px-6 md:px-8 py-5 flex flex-col md:flex-row items-center justify-between gap-3">
        <span className="text-xs font-mono text-muted">© 2026 LoraMer</span>
        <div className="flex items-center gap-5">
          <a href="/privacy" className="text-xs font-mono text-muted hover:text-ink transition-colors">Privacy</a>
          <a href="/terms" className="text-xs font-mono text-muted hover:text-ink transition-colors">Terms</a>
          <a href="mailto:support@cotemedia.com" className="text-xs font-mono text-muted hover:text-ink transition-colors">Support</a>
        </div>
      </div>
    </main>
  )
}

function LoraMerIcon() {
  return (
    <svg width="32" height="32" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg" aria-label="LoraMer">
      <rect width="32" height="32" rx="6.4" fill="#0f172a"/>
      <text x="16" y="21.9" fontFamily="Georgia, 'Times New Roman', serif" fontSize="19.2" fontWeight="400" fill="#ffffff" textAnchor="middle">LM</text>
    </svg>
  )
}

function GoogleIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05"/>
      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
    </svg>
  )
}
