'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'

export default function WelcomePage() {
  const router = useRouter()
  const [loading, setLoading] = useState(false)

  async function handleGetStarted() {
    setLoading(true)
    try {
      await fetch('/api/welcome', { method: 'POST' })
    } catch {
      // If write fails, still proceed - don't trap the user.
    }
    router.push('/clients')
  }

  return (
    <div className="min-h-screen bg-paper flex items-center justify-center px-4 py-8">
      <div className="w-full max-w-md">
        <div className="flex justify-center mb-8">
          <div className="w-16 h-16 rounded-xl bg-ink text-white flex items-center justify-center" style={{ fontFamily: 'Georgia, serif' }}>
            <span className="text-2xl font-bold">LM</span>
          </div>
        </div>

        <h1 className="text-center text-2xl font-bold text-ink mb-2" style={{ fontFamily: 'Georgia, serif' }}>
          Welcome to LoraMer
        </h1>
        <p className="text-center text-xs uppercase tracking-wider text-muted mb-8 font-sans font-medium">
          Deep knowledge for your business.
        </p>

        <div className="bg-white rounded-xl shadow-card p-6 mb-6">
          <p className="text-ink text-base leading-relaxed mb-5">
            Your Google Ads accounts are connecting now. In a moment, Claude will start reading across your campaigns and learning what matters to you.
          </p>

          <div className="border-t border-border pt-5">
            <p className="text-xs uppercase tracking-wider text-muted mb-3 font-medium">
              Your free plan includes
            </p>
            <ul className="space-y-2.5 text-sm text-ink font-sans">
              <li className="flex items-start gap-2.5">
                <span className="text-accent mt-0.5">&#10022;</span>
                <span>1 workspace</span>
              </li>
              <li className="flex items-start gap-2.5">
                <span className="text-accent mt-0.5">&#10022;</span>
                <span>Google Ads connected via your MCC</span>
              </li>
              <li className="flex items-start gap-2.5">
                <span className="text-accent mt-0.5">&#10022;</span>
                <span>5 AI questions per month</span>
              </li>
              <li className="flex items-start gap-2.5">
                <span className="text-accent mt-0.5">&#10022;</span>
                <span>30 days of data history</span>
              </li>
            </ul>
          </div>
        </div>

        <button
          onClick={handleGetStarted}
          disabled={loading}
          className="w-full bg-ink text-white rounded-xl py-3.5 font-sans font-medium text-base shadow-card hover:bg-ink/90 active:bg-ink/80 disabled:opacity-60 transition"
        >
          {loading ? 'Loading...' : "Let's go \u2192"}
        </button>

        <p className="text-center text-xs text-muted mt-6 font-sans">
          You can upgrade anytime to add Meta Ads, Shopify, more workspaces, and unlimited questions.
        </p>
      </div>
    </div>
  )
}
