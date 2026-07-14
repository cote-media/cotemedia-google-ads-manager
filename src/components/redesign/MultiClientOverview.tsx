// LORAMER_REDESIGN_INCB / LORAMER_NEXT_DATAWIRE_PORTFOLIO_V1 / LORAMER_NEXT_PORTFOLIO_METRICS_V1 /
// LORAMER_NEXT_PORTFOLIO_DELTA_V1 — the Multi-Client Overview (agency portfolio landing). Real identity
// (membership-aware) + REAL Spend/Revenue with a page-level PERIOD PICKER (default Yesterday) driving every card
// via /api/next/portfolio-metrics, with honest like-for-like Δ% (reconciled to the current app on the 30d preset).
// Proactive status/"needs attention" analysis is still deferred (parity [LATER]) → neutral chip + neutral strip;
// never fabricated status beside real client names.
'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import styles from './redesign.module.css'
import Avatar from './Avatar'
import { deltaLabel, DEFAULT_PERIOD, type Delta } from '@/lib/next/portfolio-windows'

type ClientLite = { id: string; name: string }
type Metric = {
  clientId: string
  spend: number; revenue: number | null; revenueSource: string
  spendPrior: number; revenuePrior: number | null
}

const PERIOD_OPTIONS: { value: string; label: string }[] = [
  { value: 'TODAY', label: 'Today' },
  { value: 'YESTERDAY', label: 'Yesterday' },
  { value: 'THIS_WEEK', label: 'This week' },
  { value: 'LAST_WEEK', label: 'Last week' },
  { value: 'THIS_MONTH', label: 'This month' },
  { value: 'LAST_MONTH', label: 'Last month' },
  { value: 'LAST_7_DAYS', label: 'Last 7 days' },
  { value: 'LAST_30_DAYS', label: 'Last 30 days' },
]

const money = (n: number) => '$' + Math.round(n).toLocaleString('en-US')

function DeltaTag({ d }: { d: Delta }) {
  if (d.dir === 'none') return <span className={styles.metricK} style={{ marginTop: 1 }}>{d.text}</span>
  const color = d.dir === 'up' ? '#0f6e56' : d.dir === 'down' ? '#b91c1c' : '#64748b'
  return <span style={{ fontSize: 11, fontWeight: 500, color, marginTop: 1 }}>{d.text}</span>
}

export default function MultiClientOverview({ clients, canAddClient }: { clients: ClientLite[]; canAddClient: boolean }) {
  // LORAMER_NEXT_ADD_CLIENT_V1 — manual add-client, REUSING the existing POST /api/clients (org_id +
  // account_type provisioning). Authoritative: on failure show inline error and DO NOT close/navigate.
  const router = useRouter()
  const [addOpen, setAddOpen] = useState(false)
  const [newName, setNewName] = useState('')
  const [creating, setCreating] = useState(false)
  const [addError, setAddError] = useState('')

  async function createClient() {
    const name = newName.trim()
    if (!name) return
    setCreating(true)
    setAddError('')
    try {
      const res = await fetch('/api/clients', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({} as any))
        setAddError(j.error || 'Could not create the client. Try again.')
        setCreating(false)
        return
      }
      // Success — reveal the new client in the portfolio (the server component re-runs with the new list).
      setNewName('')
      setAddOpen(false)
      setCreating(false)
      router.refresh()
    } catch {
      setAddError('Could not create the client. Try again.')
      setCreating(false)
    }
  }

  const [period, setPeriod] = useState<string>(DEFAULT_PERIOD)
  const [metrics, setMetrics] = useState<Record<string, Metric>>({})
  const [fresh, setFresh] = useState<{ end: string | null; latest: string | null }>({ end: null, latest: null })
  const [loading, setLoading] = useState(false)
  // LORAMER_NEXT_PORTFOLIO_METRICS_INDEX_V1 — HONEST error state: a non-200 (e.g. the old query-timeout 500) must
  // NOT silently collapse every card to "—" as if the data were empty. On failure we flag `loadError` and show a
  // neutral "couldn't load — retry" banner; `reloadKey` re-runs the fetch on Retry. Genuine $0/$0 stays honest.
  const [loadError, setLoadError] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    let alive = true
    setLoading(true)
    setLoadError(false)
    setMetrics({})
    fetch('/api/next/portfolio-metrics?period=' + encodeURIComponent(period))
      .then((r) => {
        if (!r.ok) throw new Error('portfolio-metrics ' + r.status)
        return r.json()
      })
      .then((d) => {
        if (!alive) return
        const map: Record<string, Metric> = {}
        for (const m of d.metrics || []) map[m.clientId] = m
        setMetrics(map)
        setFresh({ end: d.current?.endDate || null, latest: d.latestCapturedDate || null })
      })
      .catch(() => { if (alive) setLoadError(true) })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [period, reloadKey])

  // Honest freshness: selected window runs past the latest captured day (e.g. early-ET-morning pre-cron gap).
  const stale = !!(fresh.end && fresh.latest && fresh.end > fresh.latest)

  return (
    <>
      {/* 1) Portfolio insights — NEUTRAL placeholder until the proactive engine lands (parity [LATER]). */}
      <div className={styles.loraStrip}>
        <div className={styles.loraStripHead}><i className="ti ti-sparkles" /> Portfolio insights</div>
        <p className={styles.loraStripText}>Proactive insights across your clients are coming soon.</p>
      </div>

      {/* 2) Header + period picker (drives every card) + sort/filter stub. */}
      <div className={styles.clientsHeader}>
        <h1 className={styles.clientsTitle}>Clients</h1>
        <select
          value={period}
          onChange={(e) => setPeriod(e.target.value)}
          aria-label="Period"
          className={styles.sortStub}
          style={{ cursor: 'pointer' }}
        >
          {PERIOD_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <button className={styles.sortStub} type="button">
          <i className="ti ti-adjustments-horizontal" /> Sort &amp; filter
        </button>
        {/* LORAMER_NEXT_ADD_CLIENT_V1 — owner-only entry (hidden for members via canAddClient). */}
        {canAddClient && (
          <button className={styles.sortStub} type="button" onClick={() => { setAddError(''); setNewName(''); setAddOpen(true) }}>
            <i className="ti ti-plus" /> Add client
          </button>
        )}
      </div>

      {stale && (
        <div className={styles.metaLabel} style={{ color: '#b45309', marginBottom: 4 }}>
          Selected period runs to {fresh.end}, but data is only captured through {fresh.latest} — recent day(s) not in yet.
        </div>
      )}

      {/* LORAMER_NEXT_PORTFOLIO_METRICS_INDEX_V1 — honest load-failure state (never masquerade a 500 as empty "—"). */}
      {loadError && (
        <div className={styles.metaLabel} style={{ color: '#b91c1c', marginBottom: 4, display: 'flex', alignItems: 'center', gap: 8 }}>
          Couldn&rsquo;t load metrics for this period.
          <button
            type="button"
            onClick={() => setReloadKey((k) => k + 1)}
            style={{ padding: '2px 10px', borderRadius: 8, border: '1px solid #fecaca', background: '#fff', color: '#b91c1c', fontSize: 12, cursor: 'pointer' }}
          >
            Retry
          </button>
        </div>
      )}

      {/* 3) Real client cards: identity + real Spend/Revenue + honest Δ for the selected period. */}
      {clients.length === 0 ? (
        <p style={{ color: '#64748b', fontFamily: 'monospace', fontSize: 13, padding: '8px 2px' }}>No clients yet.</p>
      ) : (
        <div className={styles.clientGrid}>
          {clients.map((c) => {
            const m = metrics[c.id]
            const spendD = m ? deltaLabel(m.spend, m.spendPrior) : null
            const revD = m ? deltaLabel(m.revenue, m.revenuePrior) : null
            return (
              <Link key={c.id} href={`/dashboard-next/client-profile?clientId=${c.id}`} className={styles.clientCard}>
                <div className={styles.cardTop}>
                  <Avatar name={c.name} kind="client" className={styles.cardAvatar} />
                  <span className={styles.cardName}>{c.name}</span>
                  <i className={`ti ti-pin ${styles.cardPin}`} aria-hidden="true" />
                </div>

                <div className={styles.cardMetrics}>
                  <div className={styles.metricBox}>
                    <span className={styles.metricK}>Spend</span>
                    <span className={styles.metricV}>{m ? money(m.spend) : (loading ? '…' : '—')}</span>
                    {spendD && <DeltaTag d={spendD} />}
                  </div>
                  <div className={styles.metricBox}>
                    <span className={styles.metricK}>Revenue</span>
                    <span className={styles.metricV}>{m ? (m.revenue != null ? money(m.revenue) : '—') : (loading ? '…' : '—')}</span>
                    {revD && <DeltaTag d={revD} />}
                  </div>
                </div>

                {/* Neutral status placeholder — proactive working/needs-attention is deferred (no fabricated status). */}
                <span className={styles.chip} style={{ background: '#eef0f3', color: '#64748b' }}>
                  <i className="ti ti-clock" /> insights coming
                </span>
              </Link>
            )
          })}
        </div>
      )}

      {/* LORAMER_NEXT_ADD_CLIENT_V1 — add-client modal (name-only, matching legacy's required set). Mobile-clean:
          max-width 420, full-width input + tap targets. Authoritative: failure keeps the modal open with an inline error. */}
      {addOpen && (
        <div
          onClick={() => { if (!creating) setAddOpen(false) }}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, zIndex: 50 }}
        >
          <div onClick={(e) => e.stopPropagation()} style={{ background: '#fff', width: '100%', maxWidth: 420, borderRadius: 16, padding: 24, boxShadow: '0 10px 40px rgba(0,0,0,0.2)' }}>
            <h3 style={{ fontSize: 18, fontWeight: 600, color: '#0f172a', marginBottom: 12 }}>Add a client</h3>
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') createClient() }}
              placeholder="Client name"
              autoFocus
              style={{ width: '100%', padding: '10px 12px', border: '1px solid #e2e8f0', borderRadius: 10, fontSize: 14, marginBottom: 12, outline: 'none' }}
            />
            {addError && (
              <div style={{ fontSize: 13, color: '#b91c1c', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, padding: '6px 10px', marginBottom: 12 }}>{addError}</div>
            )}
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button type="button" onClick={() => setAddOpen(false)} disabled={creating} style={{ padding: '9px 14px', borderRadius: 10, border: '1px solid #e2e8f0', background: '#fff', fontSize: 14, cursor: 'pointer' }}>Cancel</button>
              <button type="button" onClick={createClient} disabled={creating || !newName.trim()} style={{ padding: '9px 14px', borderRadius: 10, border: 'none', background: '#0f172a', color: '#fff', fontSize: 14, fontWeight: 500, cursor: 'pointer', opacity: creating || !newName.trim() ? 0.5 : 1 }}>
                {creating ? 'Creating…' : 'Create client'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
