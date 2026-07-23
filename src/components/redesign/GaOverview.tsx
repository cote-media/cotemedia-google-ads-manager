'use client'
// LORAMER_NEXT_GA_OVERVIEW_V1 — the -next Analytics (GA4) OVERVIEW: property-level engagement + revenue trends from
// CAPTURED account-grain rows (via /api/next/ga-overview). REAL data, NO dimensional tables (those are capture-gated
// N4 — an honest "coming soon" line sits BELOW, clearly separated). False-zero honest: a property with no GA data /
// all-zero in range shows an honest empty state, never fabricated numbers. Mobile-first.
import { useEffect, useState } from 'react'
import styles from './redesign.module.css'
import { deltaLabel, DEFAULT_PERIOD, type Delta } from '@/lib/next/portfolio-windows'

type Totals = { sessions: number; users: number; newUsers: number; conversions: number; revenue: number; transactions: number; engagementRate: number | null }
type Pt = { date: string; sessions: number; users: number; revenue: number }
type Resp = { hasGaEver: boolean; hasSignalInRange: boolean; totals: Totals; priorTotals: Totals; series: Pt[]; latestCapturedDate: string | null; current?: { startDate: string; endDate: string }; incompleteNote?: string /* LORAMER_QUERY_COMPLETENESS_V1 slice 3 */ }

const PERIOD_OPTIONS = [
  { value: 'TODAY', label: 'Today' }, { value: 'YESTERDAY', label: 'Yesterday' }, { value: 'THIS_WEEK', label: 'This week' },
  { value: 'LAST_WEEK', label: 'Last week' }, { value: 'THIS_MONTH', label: 'This month' }, { value: 'LAST_MONTH', label: 'Last month' },
  { value: 'LAST_7_DAYS', label: 'Last 7 days' }, { value: 'LAST_30_DAYS', label: 'Last 30 days' },
]
const num = (n: number) => Math.round(n).toLocaleString('en-US')
const money = (n: number) => '$' + Math.round(n).toLocaleString('en-US')
const pct = (n: number | null) => (n == null ? '—' : (n * 100).toFixed(1) + '%')

function Stat({ label, value, delta }: { label: string; value: string; delta: Delta | null }) {
  const cls = delta?.dir === 'up' ? styles.up : delta?.dir === 'down' ? styles.down : ''
  return (
    <div className={styles.stat}>
      <div className={styles.statK}>{label}</div>
      <div className={styles.statV}>{value}</div>
      {delta && delta.dir !== 'none'
        ? <div className={`${styles.statD} ${cls}`}>{delta.text} vs prior</div>
        : <div className={styles.statD} style={{ color: '#94a3b8' }}>{delta ? delta.text : '—'}</div>}
    </div>
  )
}

function Line({ series, metric }: { series: Pt[]; metric: 'sessions' | 'users' | 'revenue' }) {
  const pts = series.map((s) => s[metric] as number)
  if (pts.length < 2) return <div style={{ fontSize: 13, color: '#94a3b8', padding: '16px 2px' }}>Not enough captured days to chart.</div>
  const max = Math.max(...pts, 1)
  const n = pts.length
  const coords = pts.map((y, i) => `${((i / (n - 1)) * 100).toFixed(2)},${(100 - (y / max) * 100).toFixed(2)}`).join(' ')
  return (
    <svg viewBox="0 0 100 100" preserveAspectRatio="none" style={{ width: '100%', height: 150, border: '1px solid #e2e8f0', borderRadius: 12, background: '#fff', display: 'block' }} role="img" aria-label={`${metric} over time`}>
      <polyline points={coords} fill="none" stroke="#2563eb" strokeWidth={1.5} vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  )
}

export default function GaOverview({ clientId, clientName }: { clientId: string; clientName?: string }) {
  const [period, setPeriod] = useState<string>(DEFAULT_PERIOD)
  const [d, setD] = useState<Resp | null>(null)
  const [loading, setLoading] = useState(false)
  const [metric, setMetric] = useState<'sessions' | 'users' | 'revenue'>('sessions')

  useEffect(() => {
    if (!clientId) return
    let alive = true
    setLoading(true); setD(null)
    fetch('/api/next/ga-overview?clientId=' + encodeURIComponent(clientId) + '&period=' + encodeURIComponent(period))
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (alive) setD(j) })
      .catch(() => {})
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [clientId, period])

  const t = d?.totals, p = d?.priorTotals
  const dl = (cur?: number | null, pri?: number | null) => (t && p ? deltaLabel(cur ?? null, pri ?? null) : null)

  const header = (
    <div className={styles.clientsHeader}>
      <h1 className={styles.title}>Analytics (GA4)</h1>
      <select value={period} onChange={(e) => setPeriod(e.target.value)} aria-label="Period" className={styles.sortStub} style={{ cursor: 'pointer' }}>
        {PERIOD_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>
  )

  // Honest empty states — never fabricate numbers for a property with no data / no activity.
  if (d && !d.hasGaEver) {
    return <>{header}<p style={{ color: '#64748b', fontSize: 14, padding: '24px 2px', maxWidth: 520 }}>Google Analytics isn’t connected for this client — no GA data has been captured. <a href="/clients" style={{ color: '#2563eb' }}>Connect a property →</a></p></>
  }
  if (d && d.hasGaEver && !d.hasSignalInRange) {
    return <>{header}<p style={{ color: '#64748b', fontSize: 14, padding: '24px 2px', maxWidth: 520 }}>No Analytics activity captured in this range (0 sessions). Try a wider period{d.latestCapturedDate ? ` — captured through ${d.latestCapturedDate}` : ''}.</p></>
  }

  return (
    <>
      {header}
      <div>
        <div className={styles.secHead}><i className={`ti ti-grip-vertical ${styles.grip}`} /><span className={styles.lbl}>Top stats</span></div>
        <div className={styles.statGrid} style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(132px, 1fr))' }}>
          <Stat label="Sessions" value={loading && !d ? '…' : (t ? num(t.sessions) : '—')} delta={dl(t?.sessions, p?.sessions)} />
          <Stat label="Users" value={loading && !d ? '…' : (t ? num(t.users) : '—')} delta={dl(t?.users, p?.users)} />
          <Stat label="New users" value={loading && !d ? '…' : (t ? num(t.newUsers) : '—')} delta={dl(t?.newUsers, p?.newUsers)} />
          <Stat label="Engagement rate" value={loading && !d ? '…' : (t ? pct(t.engagementRate) : '—')} delta={dl(t?.engagementRate, p?.engagementRate)} />
          <Stat label="Conversions" value={loading && !d ? '…' : (t ? num(t.conversions) : '—')} delta={dl(t?.conversions, p?.conversions)} />
          <Stat label="Revenue" value={loading && !d ? '…' : (t ? money(t.revenue) : '—')} delta={dl(t?.revenue, p?.revenue)} />
          <Stat label="Transactions" value={loading && !d ? '…' : (t ? num(t.transactions) : '—')} delta={dl(t?.transactions, p?.transactions)} />
        </div>
        <div className={styles.metaLabel} style={{ marginTop: 6 }}>{d?.latestCapturedDate ? `Captured data through ${d.latestCapturedDate}` : 'Captured data (system of record)'}</div>
        {/* LORAMER_QUERY_COMPLETENESS_V1 slice 3 — stale/failing GA tail marker (mobile-safe wrap). */}
        {d?.incompleteNote ? <div className={styles.metaLabel} style={{ marginTop: 6, color: '#b45309', overflowWrap: 'anywhere' }}>⚠ {d.incompleteNote}</div> : null}
      </div>

      <div style={{ marginTop: 16, maxWidth: 720 }}>
        <div className={styles.secHead} style={{ justifyContent: 'space-between' }}>
          <span className={styles.lbl}>Trend</span>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {(['sessions', 'users', 'revenue'] as const).map((mk) => (
              <button key={mk} type="button" onClick={() => setMetric(mk)}
                style={{ fontSize: 12.5, padding: '5px 11px', borderRadius: 999, cursor: 'pointer', textTransform: 'capitalize',
                  border: metric === mk ? '1px solid #2563eb' : '1px solid #e2e8f0', background: metric === mk ? '#2563eb' : '#fff', color: metric === mk ? '#fff' : '#334155' }}>
                {mk}
              </button>
            ))}
          </div>
        </div>
        {d ? <Line series={d.series} metric={metric} /> : <div style={{ height: 150, borderRadius: 12, border: '1px solid #e2e8f0', background: '#fff' }} />}
      </div>

      {/* Capture-gated: the dimensional GA4 report tables (source/medium, channel, landing pages, device, geo,
          demographics) need the N4 breakdown-capture layer — NOT built. Kept as an honest, clearly-separated note
          BELOW the real Overview; never a fake table. */}
      <p style={{ marginTop: 20, fontSize: 12.5, color: '#94a3b8', maxWidth: 720 }}>
        Detailed GA reports (traffic sources, channels, landing pages, devices, geography, demographics) are coming soon — they need dimensional capture that isn’t collected yet, so they’re not shown rather than faked.
      </p>
    </>
  )
}
