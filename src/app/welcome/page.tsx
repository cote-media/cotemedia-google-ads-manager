'use client'

// LORAMER_ORG_TYPE_PERSIST_V1 — the welcome step is the SINGLE atomic onboarding gate: it records the
// two-door choice (account_type) together with welcome_seen_at in one POST. Two entry shapes converge here:
//   - homepage chooser  → signup_org_type cookie present → AUTO-SUBMIT that choice (buttons never shown)
//   - direct/cold visit → no cookie → render two buttons, require an explicit pick
// NEVER both (a ref guards the single submit). The write is AUTHORITATIVE: on failure we surface an error
// and DO NOT navigate onward — a failed write must block, so the gate can re-route here (no silent pass-through).

import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'

type Mode = 'init' | 'submitting' | 'choose' | 'error'
type Choice = 'agency' | 'business'

function readCookie(name: string): string | null {
  if (typeof document === 'undefined') return null
  const m = document.cookie.match(new RegExp('(?:^|; )' + name + '=([^;]*)'))
  return m ? decodeURIComponent(m[1]) : null
}
function clearCookie(name: string) {
  document.cookie = name + '=; path=/; max-age=0'
}

export default function WelcomePage() {
  const router = useRouter()
  const [mode, setMode] = useState<Mode>('init')
  const submittingRef = useRef(false)

  async function submit(choice: Choice) {
    if (submittingRef.current) return // guard: exactly one in-flight write, no double-POST
    submittingRef.current = true
    setMode('submitting')
    try {
      const res = await fetch('/api/welcome', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ account_type: choice }),
      })
      if (!res.ok) throw new Error('welcome write failed: ' + res.status)
      clearCookie('signup_org_type')
      // LORAMER_SIGNUP_FUNNEL_FIX_V1 — land directly on the -next portfolio (was '/clients', which the legacy-surface
      // middleware would then bounce to /dashboard-next/clients — a needless double-redirect during onboarding).
      router.push('/dashboard-next/clients')
    } catch {
      // AUTHORITATIVE: a failed write must NOT proceed. Surface the error + allow retry via the buttons.
      submittingRef.current = false
      setMode('error')
    }
  }

  useEffect(() => {
    const c = readCookie('signup_org_type')
    if (c === 'agency' || c === 'business') submit(c) // homepage chooser → auto-submit, buttons never render
    else setMode('choose')
    // run once on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const showButtons = mode === 'choose' || mode === 'error'

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
            One quick thing so Lora sets up the right workspace for you.
          </p>
          <p className="text-xs uppercase tracking-wider text-muted mb-3 font-medium">
            How will you use LoraMer?
          </p>

          {showButtons ? (
            <div className="grid grid-cols-1 gap-3">
              <button
                onClick={() => submit('agency')}
                className="border-2 border-border hover:border-accent p-4 text-left transition-all duration-200 group bg-white rounded-lg"
              >
                <div className="text-2xl mb-2">🏢</div>
                <div className="font-semibold text-ink mb-1 group-hover:text-accent transition-colors">I&apos;m an Agency</div>
                <p className="text-xs text-muted leading-relaxed">Managing multiple clients across platforms</p>
              </button>
              <button
                onClick={() => submit('business')}
                className="border-2 border-border hover:border-accent p-4 text-left transition-all duration-200 group bg-white rounded-lg"
              >
                <div className="text-2xl mb-2">🏪</div>
                <div className="font-semibold text-ink mb-1 group-hover:text-accent transition-colors">I&apos;m a Business</div>
                <p className="text-xs text-muted leading-relaxed">Running my own store and accounts</p>
              </button>
            </div>
          ) : (
            <div className="py-6 text-center text-sm text-muted font-sans">Setting up your workspace…</div>
          )}

          {mode === 'error' && (
            <p className="mt-4 text-sm text-red-600 font-sans" role="alert">
              Something went wrong saving your choice. Please try again.
            </p>
          )}
        </div>

        <p className="text-center text-xs text-muted font-sans">
          You can upgrade anytime to add Meta Ads, Shopify, more workspaces, and unlimited questions.
        </p>
      </div>
    </div>
  )
}
