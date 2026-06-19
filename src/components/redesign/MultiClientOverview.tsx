// LORAMER_REDESIGN_INCB / LORAMER_NEXT_DATAWIRE_PORTFOLIO_V1 / LORAMER_NEXT_PORTFOLIO_METRICS_V1 — the
// Multi-Client Overview (agency portfolio landing). Client IDENTITY is real (membership-aware list from the
// server page) and each card navigates to that client's per-client page. Spend/Revenue are now REAL — fetched
// from /api/next/portfolio-metrics (batch), reconciled to the current app's /api/clients/metrics definition
// (LAST_30_DAYS; spend google+meta; revenue store>ga>null). The DELTA and the proactive status/"needs attention"
// analysis are NOT wired (the current app has no portfolio delta to reconcile to; proactive = parity [LATER]),
// so the status chip stays a neutral "insights coming" and the strip stays a neutral placeholder — never
// fabricated numbers/analysis beside real client names.
'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import styles from './redesign.module.css'
import Avatar from './Avatar'

type ClientLite = { id: string; name: string }
type Metric = { clientId: string; spend: number; revenue: number | null; revenueSource: string }

const money = (n: number) => '$' + Math.round(n).toLocaleString('en-US')

export default function MultiClientOverview({ clients }: { clients: ClientLite[] }) {
  const [metrics, setMetrics] = useState<Record<string, Metric>>({})
  useEffect(() => {
    let alive = true
    fetch('/api/next/portfolio-metrics')
      .then((r) => (r.ok ? r.json() : { metrics: [] }))
      .then((d) => {
        if (!alive) return
        const map: Record<string, Metric> = {}
        for (const m of d.metrics || []) map[m.clientId] = m
        setMetrics(map)
      })
      .catch(() => {})
    return () => { alive = false }
  }, [])

  return (
    <>
      {/* 1) Portfolio insights — NEUTRAL placeholder until the proactive engine lands (parity [LATER]). */}
      <div className={styles.loraStrip}>
        <div className={styles.loraStripHead}><i className="ti ti-sparkles" /> Portfolio insights</div>
        <p className={styles.loraStripText}>Proactive insights across your clients are coming soon.</p>
      </div>

      {/* 2) Header + sort/filter stub (visual only). */}
      <div className={styles.clientsHeader}>
        <h1 className={styles.clientsTitle}>Clients</h1>
        <button className={styles.sortStub} type="button">
          <i className="ti ti-adjustments-horizontal" /> Sort &amp; filter
        </button>
      </div>

      {/* 3) Real client cards: identity + real Spend/Revenue (30d). Status/delta deferred-neutral. */}
      {clients.length === 0 ? (
        <p style={{ color: '#64748b', fontFamily: 'monospace', fontSize: 13, padding: '8px 2px' }}>No clients yet.</p>
      ) : (
        <div className={styles.clientGrid}>
          {clients.map((c) => {
            const m = metrics[c.id]
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
                    <span className={styles.metricV}>{m ? money(m.spend) : '—'}</span>
                  </div>
                  <div className={styles.metricBox}>
                    <span className={styles.metricK}>Revenue</span>
                    <span className={styles.metricV}>{m ? (m.revenue != null ? money(m.revenue) : '—') : '—'}</span>
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
