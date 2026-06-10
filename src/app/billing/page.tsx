// LORAMER_STRIPE_PHASE3_BILLING_UI_V1
'use client'

import { useSession } from 'next-auth/react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useCallback, useEffect, useState, Suspense } from 'react'
import { IconArrowLeft, IconCheck, IconLoader2 } from '@tabler/icons-react'
import { TIER_ORDER, flagLabel } from '@/lib/billing/plans'

type Entitlements = {
  tier: string
  display_name: string
  workspace_cap: number | null
  questions_per_month: number | null
  history_window_days: number | null
  feature_flags: string[]
}
type Plan = {
  tier: string
  display_name: string
  entitlements: Entitlements | null
  monthly: number
  annual: number
}
type BillingData = {
  currentTier: string
  currentPlan: { tier: string; display_name: string } & Partial<Entitlements>
  hasActiveSub: boolean
  isManual: boolean
  plans: Plan[]
}

function entitlementLines(e: Partial<Entitlements> | null | undefined): string[] {
  if (!e) return []
  const lines: string[] = []
  lines.push(e.workspace_cap == null ? 'Unlimited workspaces' : `${e.workspace_cap} workspace${e.workspace_cap === 1 ? '' : 's'}`)
  lines.push(e.questions_per_month == null ? 'Unlimited AI questions / month' : `${e.questions_per_month} AI questions / month`)
  if (e.history_window_days == null) lines.push('Full history')
  else if (e.history_window_days >= 365) lines.push(`${Math.round(e.history_window_days / 30)}-month history window`)
  else lines.push(`${e.history_window_days}-day history window`)
  const flags = Array.isArray(e.feature_flags) ? e.feature_flags : []
  for (const f of flags) lines.push(flagLabel(f))
  return lines
}

function tierRank(t: string): number {
  const i = TIER_ORDER.indexOf(t)
  return i === -1 ? 0 : i
}

function BillingInner() {
  const { status } = useSession()
  const router = useRouter()
  const params = useSearchParams()
  const checkoutStatus = params.get('status') // 'success' | 'cancel' | null

  const [data, setData] = useState<BillingData | null>(null)
  const [loading, setLoading] = useState(true)
  const [interval, setIntervalState] = useState<'monthly' | 'annual'>('annual')
  const [busyTier, setBusyTier] = useState<string | null>(null)
  const [busyPortal, setBusyPortal] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [activating, setActivating] = useState(checkoutStatus === 'success')

  const load = useCallback(async () => {
    const r = await fetch('/api/billing').then((res) => res.json()).catch(() => null)
    if (r && !r.error) setData(r)
    setLoading(false)
    return r as BillingData | null
  }, [])

  useEffect(() => {
    if (status === 'unauthenticated') router.push('/')
  }, [status, router])

  useEffect(() => { void load() }, [load])

  // After Checkout returns success, the webhook flips the tier asynchronously — poll until it lands.
  useEffect(() => {
    if (checkoutStatus !== 'success') return
    let tries = 0
    let stop = false
    setActivating(true)
    const iv = setInterval(async () => {
      tries += 1
      const r = await load()
      if (stop) return
      if (r && (r.hasActiveSub || r.currentTier !== 'free')) {
        setActivating(false)
        clearInterval(iv)
      } else if (tries >= 10) {
        setActivating(false)
        clearInterval(iv)
      }
    }, 2000)
    return () => { stop = true; clearInterval(iv) }
  }, [checkoutStatus, load])

  async function manageBilling() {
    setError(null)
    setBusyPortal(true)
    try {
      const res = await fetch('/api/billing/portal', { method: 'POST' })
      const body = await res.json().catch(() => ({}))
      if (res.ok && body.url) {
        window.location.href = body.url
        return
      }
      setError("Couldn't open billing — please try again.")
    } catch {
      setError("Couldn't open billing — please try again.")
    } finally {
      setBusyPortal(false)
    }
  }

  async function upgrade(tier: string) {
    setError(null)
    setBusyTier(tier)
    try {
      const res = await fetch('/api/billing/checkout', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ tier, interval }),
      })
      const body = await res.json().catch(() => ({}))
      if (res.ok && body.url) {
        window.location.href = body.url
        return
      }
      setError(
        body.error === 'already_subscribed'
          ? 'You already have an active plan. Plan changes are coming soon.'
          : "Couldn't start checkout — please try again."
      )
    } catch {
      setError("Couldn't start checkout — please try again.")
    } finally {
      setBusyTier(null)
    }
  }

  return (
    <main className="min-h-screen bg-paper">
      <div className="border-b border-border px-6 md:px-8 py-4 flex items-center justify-between">
        <a href="/dashboard" className="flex items-center gap-2 text-sm text-ink hover:opacity-80 transition-opacity">
          <IconArrowLeft size={18} className="flex-shrink-0 text-muted" />
          Back to dashboard
        </a>
        <span className="font-mono text-xs tracking-widest uppercase text-accent">Billing &amp; Plan</span>
      </div>

      <div className="max-w-3xl mx-auto px-6 md:px-8 py-10 w-full">
        <h1 className="text-2xl md:text-3xl text-ink mb-6" style={{ fontFamily: "Georgia, 'Times New Roman', serif" }}>
          Your plan
        </h1>

        {checkoutStatus === 'success' && (
          <div className="mb-6 rounded-xl border border-accent/40 bg-accent/5 p-4 flex items-center gap-3">
            {activating
              ? <><IconLoader2 size={18} className="animate-spin text-accent flex-shrink-0" /><span className="text-sm text-ink">Activating your plan… this takes a moment.</span></>
              : <><IconCheck size={18} className="text-accent flex-shrink-0" /><span className="text-sm text-ink">You&apos;re all set — your new plan is active.</span></>}
          </div>
        )}
        {checkoutStatus === 'cancel' && (
          <div className="mb-6 rounded-xl border border-border bg-surface p-4 text-sm text-muted">Checkout canceled — no changes were made.</div>
        )}
        {error && <div className="mb-6 rounded-xl border border-red-300 bg-red-50 p-4 text-sm text-red-700">{error}</div>}

        {loading || !data ? (
          <div className="flex items-center gap-2 text-muted text-sm"><IconLoader2 size={18} className="animate-spin" /> Loading…</div>
        ) : (
          <>
            {/* Current plan */}
            <div className="rounded-xl border border-border bg-white shadow-card p-5 mb-8">
              <p className="font-mono text-xs uppercase tracking-wider text-muted mb-1">Current plan</p>
              <p className="text-xl text-ink mb-3" style={{ fontFamily: "Georgia, 'Times New Roman', serif" }}>{data.currentPlan.display_name}</p>
              <ul className="space-y-1">
                {entitlementLines(data.currentPlan).map((l, i) => (
                  <li key={i} className="flex items-center gap-2 text-sm text-ink"><IconCheck size={14} className="text-accent flex-shrink-0" />{l}</li>
                ))}
              </ul>
            </div>

            {data.isManual ? (
              <div className="rounded-xl border border-border bg-surface p-5 text-sm text-ink">
                {data.currentTier === 'beta_unlimited'
                  ? "You're on the Founding plan — everything's unlocked. No action needed."
                  : 'Enterprise plans are billed directly. Contact us to make changes.'}
              </div>
            ) : data.hasActiveSub ? (
              <div className="rounded-xl border border-border bg-surface p-5">
                <p className="text-sm text-ink mb-1">You have an active subscription.</p>
                <p className="text-sm text-muted mb-4">Switch plans, change billing interval, or cancel anytime.</p>
                <button onClick={manageBilling} disabled={busyPortal}
                  className="py-2 px-4 rounded-md bg-ink text-white text-sm hover:opacity-90 transition-opacity disabled:opacity-50 inline-flex items-center justify-center gap-2">
                  {busyPortal ? <><IconLoader2 size={16} className="animate-spin" /> Opening…</> : 'Manage billing'}
                </button>
              </div>
            ) : (
              <>
                {/* Interval toggle */}
                <div className="flex items-center justify-center gap-1 mb-6">
                  <div className="inline-flex rounded-lg border border-border bg-white p-1">
                    <button onClick={() => setIntervalState('annual')}
                      className={`px-3 py-1.5 text-sm rounded-md transition-colors ${interval === 'annual' ? 'bg-ink text-white' : 'text-muted hover:text-ink'}`}>
                      Annual <span className={interval === 'annual' ? 'text-white/80' : 'text-accent'}>· save 20%</span>
                    </button>
                    <button onClick={() => setIntervalState('monthly')}
                      className={`px-3 py-1.5 text-sm rounded-md transition-colors ${interval === 'monthly' ? 'bg-ink text-white' : 'text-muted hover:text-ink'}`}>
                      Monthly
                    </button>
                  </div>
                </div>

                {/* Plan cards */}
                <div className="grid gap-4 md:grid-cols-3">
                  {data.plans.map((p) => {
                    const isCurrent = p.tier === data.currentTier
                    const isUpgrade = tierRank(p.tier) > tierRank(data.currentTier)
                    const price = interval === 'annual' ? p.annual : p.monthly
                    return (
                      <div key={p.tier} className="rounded-xl border border-border bg-white shadow-card p-5 flex flex-col">
                        <p className="text-lg text-ink mb-1" style={{ fontFamily: "Georgia, 'Times New Roman', serif" }}>{p.display_name}</p>
                        <p className="mb-1">
                          <span className="text-2xl text-ink">${price.toLocaleString()}</span>
                          <span className="text-sm text-muted">/{interval === 'annual' ? 'yr' : 'mo'}</span>
                        </p>
                        {interval === 'annual' && (
                          <p className="text-xs text-muted mb-3">${(p.annual / 12).toFixed(0)}/mo billed annually</p>
                        )}
                        {interval === 'monthly' && <div className="mb-3" />}
                        <ul className="space-y-1 mb-5 flex-1">
                          {entitlementLines(p.entitlements).map((l, i) => (
                            <li key={i} className="flex items-start gap-2 text-sm text-ink"><IconCheck size={14} className="text-accent flex-shrink-0 mt-0.5" />{l}</li>
                          ))}
                        </ul>
                        {isCurrent ? (
                          <span className="text-center text-sm text-muted py-2">Current plan</span>
                        ) : isUpgrade ? (
                          <button onClick={() => upgrade(p.tier)} disabled={busyTier !== null}
                            className="w-full py-2 rounded-md bg-ink text-white text-sm hover:opacity-90 transition-opacity disabled:opacity-50 flex items-center justify-center gap-2">
                            {busyTier === p.tier ? <><IconLoader2 size={16} className="animate-spin" /> Redirecting…</> : `Upgrade to ${p.display_name}`}
                          </button>
                        ) : (
                          <span className="text-center text-sm text-muted py-2">—</span>
                        )}
                      </div>
                    )
                  })}
                </div>
              </>
            )}
          </>
        )}
      </div>
    </main>
  )
}

export default function BillingPage() {
  return (
    <Suspense fallback={null}>
      <BillingInner />
    </Suspense>
  )
}
