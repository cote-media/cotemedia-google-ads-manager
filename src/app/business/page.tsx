'use client'
import { signIn } from 'next-auth/react'

export default function BusinessPage() {
  return (
    <main className="min-h-screen bg-paper flex flex-col">
      {/* Nav */}
      <div className="border-b border-border px-6 md:px-8 py-4 flex items-center justify-between">
        <a href="/" className="flex items-center gap-3 hover:opacity-80 transition-opacity">
          <LoraMerIcon />
          <span style={{ fontFamily: "Georgia, 'Times New Roman', serif" }} className="text-lg md:text-xl text-ink">LoraMer</span>
        </a>
        <span className="font-mono text-xs tracking-widest uppercase text-accent">For Business Owners</span>
      </div>

      <div className="flex-1 max-w-2xl mx-auto px-6 md:px-8 py-10 md:py-20 w-full">
        {/* Hero */}
        <div className="mb-12 md:mb-16">
          <div className="text-3xl md:text-4xl mb-6">🏪</div>
          <h1 style={{ fontFamily: "Georgia, 'Times New Roman', serif" }} className="text-3xl md:text-5xl text-ink leading-tight mb-6">
            Finally — one place<br />
            <em>that understands your whole business.</em>
          </h1>
          <p className="text-muted text-base md:text-lg leading-relaxed">
            Stop switching between Shopify, Google Ads, Meta, and four other dashboards trying to piece things together. Connect them once. LoraMer reads across all of it and tells you what&apos;s working, what&apos;s broken, and what to do next — in plain language you don&apos;t have to be an analyst to read.
          </p>
        </div>

        {/* What you get */}
        <div className="mb-12 md:mb-16">
          <h2 className="font-mono text-xs tracking-widest uppercase text-muted mb-6">What you get</h2>
          <div className="space-y-4 md:space-y-6">
            {[
              {
                icon: '🌊',
                title: 'One view across every data source',
                desc: 'Sales from Shopify, ad spend from Google and Meta, customers, products — all connected. See the patterns that only show up when you connect the dots.'
              },
              {
                icon: '🧠',
                title: 'AI that actually knows your business',
                desc: 'Tell LoraMer your goals once. It remembers. The longer you use it, the more it understands what matters to you and the smarter the answers get.'
              },
              {
                icon: '💬',
                title: 'Ask anything in plain English',
                desc: '"Why did revenue drop last week?" "Which Meta ads are actually working?" "What should I do about my abandoned cart rate?" Just ask. Get a straight answer.'
              },
              {
                icon: '🤝',
                title: 'A real human, always reachable',
                desc: 'Stuck? Confused? Need to push back on what Lora said? You can reach a real person on every plan. No bot-only support. No phone trees. Ever.'
              },
            ].map(f => (
              <div key={f.title} className="flex gap-4 p-5 md:p-6 bg-white border border-border">
                <div className="text-2xl flex-shrink-0">{f.icon}</div>
                <div>
                  <div className="font-semibold text-ink mb-1">{f.title}</div>
                  <p className="text-sm text-muted leading-relaxed">{f.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* What you need */}
        <div className="mb-12 md:mb-16 p-5 md:p-6 bg-surface border border-border">
          <h2 className="font-mono text-xs tracking-widest uppercase text-muted mb-4">What you&apos;ll need</h2>
          <ul className="space-y-2 text-sm text-ink">
            <li className="flex items-start gap-2"><span className="text-green-600 flex-shrink-0">✓</span> A Google account to sign in</li>
            <li className="flex items-start gap-2"><span className="text-green-600 flex-shrink-0">✓</span> Access to whichever platforms you actually use — Google Ads, Meta Ads, Shopify, or any combination. You don&apos;t need all of them.</li>
            <li className="flex items-start gap-2"><span className="text-green-600 flex-shrink-0">✓</span> That&apos;s it. LoraMer connects automatically once you sign in.</li>
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

function LoraMerIcon() {
  return (
    <svg width="28" height="28" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg" aria-label="LoraMer">
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
