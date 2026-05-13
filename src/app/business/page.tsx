'use client'
import { signIn } from 'next-auth/react'

export default function BusinessPage() {
  return (
    <main className="min-h-screen bg-paper flex flex-col">
      {/* Nav */}
      <div className="border-b border-border px-8 py-4 flex items-center justify-between">
        <a href="/" className="font-mono text-xs tracking-widest uppercase text-muted hover:text-ink transition-colors">← Cote Media Ads Manager</a>
        <span className="font-mono text-xs tracking-widest uppercase text-accent">For Business Owners</span>
      </div>

      <div className="flex-1 max-w-2xl mx-auto px-8 py-20 w-full">
        {/* Hero */}
        <div className="mb-16">
          <div className="text-4xl mb-6">🏪</div>
          <h1 className="font-display text-5xl text-ink leading-tight mb-6">
            Your own AI<br />
            <em>ads strategist.</em>
          </h1>
          <p className="text-muted text-lg leading-relaxed">
            CMAM connects to your Google Ads account and gives you a senior strategist on demand — one that knows your campaigns inside out and tells you exactly what to do next.
          </p>
        </div>

        {/* What you get */}
        <div className="mb-16">
          <h2 className="font-mono text-xs tracking-widest uppercase text-muted mb-6">What you get</h2>
          <div className="space-y-6">
            {[
              { icon: '💬', title: 'Ask anything in plain English', desc: 'No more decoding Google Ads dashboards. Just ask — "Which keywords are wasting my budget?" — and get a straight answer.' },
              { icon: '🔍', title: 'Deep account analysis', desc: 'CMAM reads your campaigns, keywords, and search terms to surface what\'s working and what\'s not — instantly.' },
              { icon: '🚩', title: 'Proactive problem spotting', desc: 'Claude flags wasted spend, underperforming campaigns, and missed opportunities before they cost you more.' },
              { icon: '✅', title: 'Actionable next steps', desc: 'Every analysis ends with a clear priority list. No vague advice — specific actions ranked by impact.' },
            ].map(f => (
              <div key={f.title} className="flex gap-4 p-6 bg-white border border-border">
                <div className="text-2xl">{f.icon}</div>
                <div>
                  <div className="font-semibold text-ink mb-1">{f.title}</div>
                  <p className="text-sm text-muted leading-relaxed">{f.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* What you need */}
        <div className="mb-16 p-6 bg-surface border border-border">
          <h2 className="font-mono text-xs tracking-widest uppercase text-muted mb-4">What you'll need</h2>
          <ul className="space-y-2 text-sm text-ink">
            <li className="flex items-center gap-2"><span className="text-green-600">✓</span> A Google account linked to your Google Ads account</li>
            <li className="flex items-center gap-2"><span className="text-green-600">✓</span> An active Google Ads account (any size)</li>
            <li className="flex items-center gap-2"><span className="text-green-600">✓</span> That's it — CMAM connects automatically</li>
          </ul>
        </div>

        {/* CTA */}
        <div>
          <button
            onClick={() => signIn('google', { callbackUrl: '/dashboard?type=business' })}
            className="btn-primary flex items-center gap-3 w-fit mb-4"
          >
            <GoogleIcon />
            Connect with Google
          </button>
          <p className="text-xs text-muted font-mono">Free during beta. No credit card required.</p>
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
      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05"/>
      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
    </svg>
  )
}
