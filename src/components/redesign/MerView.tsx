'use client'
// LORAMER_NEXT_MER_VIEW_V1 — the Combined/blended MER view. REUSES the locked calc in /api/next/client-metrics
// (LORAMER_NEXT_CLIENT_OVERVIEW_V1, byte-identical to portfolio-metrics): revenue = store-wins (store if present
// else GA, NEVER summed); spend = Σ ads (google+meta); m.roas = the blended MER, ALREADY guarded (null on $0 spend
// or no revenue — never a divide). This view surfaces m.roas as the headline + the per-platform contribution
// breakdown from m.channels. It does NOT reinvent the math and does NOT compute per-platform ROAS (that stays the
// platform ROAS card's job — multi-source law: the blended figure never collapses the per-platform ones).
import { useEffect, useState } from 'react'
import styles from './redesign.module.css'
import { DEFAULT_PERIOD } from '@/lib/next/portfolio-windows'

type Channel = { platform: string; spend: number | null; revenue: number | null; conversions: number | null; hasDataEver: boolean }
type Metrics = {
  spend: number; revenue: number | null; revenueSource: string; roas: number | null
  latestCapturedDate: string | null; current?: { startDate: string; endDate: string }; channels?: Channel[]
}

const PERIOD_OPTIONS: { value: string; label: string }[] = [
  { value: 'TODAY', label: 'Today' }, { value: 'YESTERDAY', label: 'Yesterday' },
  { value: 'THIS_WEEK', label: 'This week' }, { value: 'LAST_WEEK', label: 'Last week' },
  { value: 'THIS_MONTH', label: 'This month' }, { value: 'LAST_MONTH', label: 'Last month' },
  { value: 'LAST_7_DAYS', label: 'Last 7 days' }, { value: 'LAST_30_DAYS', label: 'Last 30 days' },
]
const money = (n: number) => '$' + Math.round(n).toLocaleString('en-US')

export default function MerView({ clientId, clientName }: { clientId: string; clientName?: string }) {
  const [period, setPeriod] = useState<string>(DEFAULT_PERIOD)
  const [m, setM] = useState<Metrics | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!clientId) return
    let alive = true
    setLoading(true); setM(null)
    fetch('/api/next/client-metrics?clientId=' + encodeURIComponent(clientId) + '&period=' + encodeURIComponent(period))
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (alive) setM(d) })
      .catch(() => {})
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [clientId, period])

  const spend = m?.spend ?? 0
  const revenue = m?.revenue ?? null
  const merUndefined = !m || m.roas == null // the endpoint returns null on $0 spend or no revenue — NEVER a divide
  const merValue = loading && !m ? '…' : (m && m.roas != null ? m.roas.toFixed(2) + '×' : '—')
  const revSource = m?.revenueSource === 'store' ? 'store' : m?.revenueSource === 'ga' ? 'GA' : null
  const ch = (p: string) => m?.channels?.find((x) => x.platform === p)
  const google = ch('google'), meta = ch('meta'), shopify = ch('shopify'), woo = ch('woocommerce'), ga = ch('ga')
  const share = (s: number | null | undefined) => (spend > 0 && s != null ? Math.round((s / spend) * 100) + '%' : '—')
  const stale = !!(m && m.current && m.latestCapturedDate && m.current.endDate > m.latestCapturedDate)

  // Why MER is "—": distinguish "$0 ad spend" from "no revenue" so the empty state is honest, never a fake number.
  const merNote = merUndefined
    ? (spend <= 0 ? 'No ad spend in this range — MER is undefined (nothing to divide by).' : 'No store/GA revenue captured in this range yet.')
    : `${revSource === 'store' ? 'Store' : revSource === 'GA' ? 'GA' : ''} revenue ÷ total ad spend (blended across all ad platforms).`

  const cardStyle: React.CSSProperties = { border: '1px solid #e2e8f0', borderRadius: 12, padding: '14px 16px', background: '#fff' }

  return (
    <>
      <div className={styles.clientsHeader}>
        <h1 className={styles.title}>Mer — blended efficiency</h1>
        <select value={period} onChange={(e) => setPeriod(e.target.value)} aria-label="Period" className={styles.sortStub} style={{ cursor: 'pointer' }}>
          {PERIOD_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </div>

      {/* HEADLINE — the locked blended MER (m.roas). Undefined → "—", never a fabricated number. Mobile-first. */}
      <div style={{ ...cardStyle, marginBottom: 16, maxWidth: 720 }}>
        <div style={{ fontSize: 13, color: '#64748b', marginBottom: 4 }}>Blended MER (Marketing Efficiency Ratio)</div>
        <div style={{ fontSize: 44, fontWeight: 700, color: merUndefined ? '#94a3b8' : '#0f172a', lineHeight: 1.1 }}>{merValue}</div>
        <div style={{ fontSize: 13, color: '#64748b', marginTop: 6 }}>{merNote}</div>
        <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', marginTop: 14 }}>
          <div>
            <div style={{ fontSize: 12, color: '#94a3b8' }}>Revenue{revSource ? ` (${revSource})` : ''}</div>
            <div style={{ fontSize: 18, fontWeight: 600, color: '#0f172a' }}>{loading && !m ? '…' : (revenue != null ? money(revenue) : '—')}</div>
          </div>
          <div style={{ fontSize: 22, color: '#cbd5e1', alignSelf: 'center' }}>÷</div>
          <div>
            <div style={{ fontSize: 12, color: '#94a3b8' }}>Total ad spend</div>
            <div style={{ fontSize: 18, fontWeight: 600, color: '#0f172a' }}>{loading && !m ? '…' : money(spend)}</div>
          </div>
        </div>
      </div>

      {/* CONTRIBUTION BREAKDOWN — the real blended picture: each ad platform's spend + share, plus every revenue
          source labeled separately (multi-source law: store + GA shown distinctly, never merged). */}
      <div style={{ maxWidth: 720 }}>
        <div className={styles.secHead}><span className={styles.lbl}>Spend contribution</span></div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10, marginBottom: 16 }}>
          {[{ k: 'google', label: 'Google Ads', c: google }, { k: 'meta', label: 'Meta Ads', c: meta }].map(({ k, label, c }) => (
            <div key={k} style={cardStyle}>
              <div style={{ fontSize: 13, color: '#64748b' }}>{label}</div>
              <div style={{ fontSize: 18, fontWeight: 600, color: '#0f172a' }}>{!c ? (loading ? '…' : '—') : c.hasDataEver ? money(c.spend ?? 0) : 'not connected'}</div>
              {c?.hasDataEver && <div style={{ fontSize: 12, color: '#94a3b8' }}>{share(c.spend)} of ad spend</div>}
            </div>
          ))}
        </div>
        <div className={styles.secHead}><span className={styles.lbl}>Revenue sources</span> <span className={styles.metaLabel}>each stands on its own — MER uses store-wins precedence</span></div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10 }}>
          {[{ label: 'Shopify', c: shopify }, { label: 'WooCommerce', c: woo }, { label: 'Analytics (GA)', c: ga }].filter(({ c }) => c?.hasDataEver).map(({ label, c }) => (
            <div key={label} style={cardStyle}>
              <div style={{ fontSize: 13, color: '#64748b' }}>{label}</div>
              <div style={{ fontSize: 18, fontWeight: 600, color: '#0f172a' }}>{money(c!.revenue ?? 0)}</div>
              <div style={{ fontSize: 12, color: '#94a3b8' }}>revenue</div>
            </div>
          ))}
          {![shopify, woo, ga].some((c) => c?.hasDataEver) && <div style={{ fontSize: 13, color: '#94a3b8', padding: '4px 2px' }}>{loading ? '…' : 'No store or Analytics revenue captured for this client.'}</div>}
        </div>
        <div className={styles.metaLabel} style={{ marginTop: 10, color: stale ? '#b45309' : undefined }}>
          {stale
            ? `Selected period runs to ${m!.current!.endDate}, but data is captured only through ${m!.latestCapturedDate}.`
            : (m?.latestCapturedDate ? `Captured data through ${m.latestCapturedDate}` : 'Captured data (system of record)')}
          {' · '}Per-platform ROAS lives on each platform tab — this view is the blended cross-platform ratio.
        </div>
      </div>
    </>
  )
}
