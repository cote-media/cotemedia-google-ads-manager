// LORAMER_REDESIGN_INCB / LORAMER_NEXT_DATAWIRE_PORTFOLIO_V1 / LORAMER_NEXT_PORTFOLIO_METRICS_V1 /
// LORAMER_NEXT_PORTFOLIO_DELTA_V1 — the Multi-Client Overview (agency portfolio landing). Real identity
// (membership-aware) + REAL Spend/Revenue with a page-level PERIOD PICKER (default Yesterday) driving every card
// via /api/next/portfolio-metrics, with honest like-for-like Δ% (reconciled to the current app on the 30d preset).
// Proactive status/"needs attention" analysis is still deferred (parity [LATER]) → neutral chip + neutral strip;
// never fabricated status beside real client names.
'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
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

export default function MultiClientOverview({ clients }: { clients: ClientLite[] }) {
  const [period, setPeriod] = useState<string>(DEFAULT_PERIOD)
  const [metrics, setMetrics] = useState<Record<string, Metric>>({})
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    let alive = true
    setLoading(true)
    setMetrics({})
    fetch('/api/next/portfolio-metrics?period=' + encodeURIComponent(period))
      .then((r) => (r.ok ? r.json() : { metrics: [] }))
      .then((d) => {
        if (!alive) return
        const map: Record<string, Metric> = {}
        for (const m of d.metrics || []) map[m.clientId] = m
        setMetrics(map)
      })
      .catch(() => {})
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [period])

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
      </div>

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
    </>
  )
}
