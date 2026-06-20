// LORAMER_REDESIGN_INC1 / LORAMER_NEXT_CLIENT_OVERVIEW_V1 — the single-client Overview center. Top stats are now
// REAL captured numbers (Spend · Revenue · Conversions · ROAS) for the selected period via /api/next/client-metrics
// (the system-of-record / metrics_daily layer, reconciled to the portfolio + Lora), with honest like-for-like Δ and
// a "captured through <date>" freshness note. The Channels grid + drill pages need the LIVE route → kept NEUTRAL
// (no fabricated per-channel numbers, non-navigating "coming soon") until that slice. Drag/Add/Save = visual only.
'use client'
import { useEffect, useState } from 'react'
import styles from './redesign.module.css'
import ShopifyIcon from './ShopifyIcon'
import { deltaLabel, DEFAULT_PERIOD, type Delta } from '@/lib/next/portfolio-windows'

type Metrics = {
  spend: number; revenue: number | null; revenueSource: string
  conversions: number; conversionValue: number; roas: number | null
  spendPrior: number; revenuePrior: number | null; conversionsPrior: number
  latestCapturedDate: string | null
  current?: { startDate: string; endDate: string }
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
const num = (n: number) => Math.round(n).toLocaleString('en-US')

function Stat({ icon, label, value, delta }: { icon?: string; label: string; value: string; delta: Delta | null }) {
  const cls = delta?.dir === 'up' ? styles.up : delta?.dir === 'down' ? styles.down : ''
  return (
    <div className={styles.stat}>
      <div className={styles.statK}>{icon ? <i className={`ti ${icon}`} /> : null} {label}</div>
      <div className={styles.statV}>{value}</div>
      {delta && delta.dir !== 'none'
        ? <div className={`${styles.statD} ${cls}`}>{delta.text} vs prior</div>
        : <div className={styles.statD} style={{ color: '#94a3b8' }}>{delta ? delta.text : '—'}</div>}
    </div>
  )
}

export default function OverviewStatic({ clientId }: { clientId?: string; clientName?: string }) {
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

  const spendV = m ? money(m.spend) : (loading ? '…' : '—')
  const revV = m ? (m.revenue != null ? money(m.revenue) : '—') : (loading ? '…' : '—')
  const convV = m ? num(m.conversions) : (loading ? '…' : '—')
  const roasV = m ? (m.roas != null ? m.roas.toFixed(2) + '×' : '—') : (loading ? '…' : '—')
  const spendD = m ? deltaLabel(m.spend, m.spendPrior) : null
  const revD = m ? deltaLabel(m.revenue, m.revenuePrior) : null
  const convD = m ? deltaLabel(m.conversions, m.conversionsPrior) : null
  // Honest freshness: the selected window extends past the latest captured day (e.g. early-ET-morning pre-cron gap).
  const stale = !!(m && m.current && m.latestCapturedDate && m.current.endDate > m.latestCapturedDate)

  return (
    <>
      <h1 className={styles.title}>Overview</h1>

      {/* Top stats — REAL captured numbers for the selected period. */}
      <div>
        <div className={styles.secHead}>
          <i className={`ti ti-grip-vertical ${styles.grip}`} />
          <span className={styles.lbl}>Top stats</span>
          <select
            value={period}
            onChange={(e) => setPeriod(e.target.value)}
            aria-label="Period"
            className={styles.sortStub}
            style={{ cursor: 'pointer', marginLeft: 'auto' }}
          >
            {PERIOD_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
        <div className={styles.statGrid}>
          <Stat icon="ti-speakerphone" label="Total spend" value={spendV} delta={spendD} />
          <Stat label="Conversions" value={convV} delta={convD} />
          <Stat icon="ti-cash" label="Revenue" value={revV} delta={revD} />
          <Stat icon="ti-trending-up" label="ROAS" value={roasV} delta={null} />
        </div>
        <div className={styles.metaLabel} style={{ marginTop: 6, color: stale ? '#b45309' : undefined }}>
          {stale
            ? `Selected period runs to ${m!.current!.endDate}, but data is only captured through ${m!.latestCapturedDate} — recent day(s) not in yet.`
            : (m?.latestCapturedDate ? `Captured data through ${m.latestCapturedDate}` : 'Captured data (system of record)')}
        </div>
      </div>

      {/* Channels — NEUTRAL until the live per-platform route lands (no fabricated numbers; non-navigating). */}
      <div>
        <div className={styles.secHead}>
          <i className={`ti ti-grip-vertical ${styles.grip}`} />
          <span className={styles.lbl}>Channels</span>
          <span className={styles.metaLabel}>drill-downs coming soon</span>
        </div>
        <div className={styles.chanGrid}>
          <div className={styles.chan}>
            <i className={`ti ti-brand-google ${styles.chanLead}`} />
            <div><div className={styles.chanNm}>Google Ads</div><div className={styles.chanSub}>coming soon</div></div>
          </div>
          <div className={styles.chan}>
            <i className={`ti ti-brand-meta ${styles.chanLead}`} />
            <div><div className={styles.chanNm}>Meta Ads</div><div className={styles.chanSub}>coming soon</div></div>
          </div>
          <div className={styles.chan}>
            <i className={`ti ti-chart-bar ${styles.chanLead}`} />
            <div><div className={styles.chanNm}>Analytics</div><div className={styles.chanSub}>coming soon</div></div>
          </div>
          <div className={styles.chan}>
            <ShopifyIcon size={22} className={styles.chanLead} />
            <div><div className={styles.chanNm}>Shopify</div><div className={styles.chanSub}>coming soon</div></div>
          </div>
        </div>
      </div>

      {/* Foot cues (visual only) */}
      <div className={styles.footcues}>
        <span><i className="ti ti-plus" /> Add section</span>
        <span><i className="ti ti-device-floppy" /> Save view</span>
      </div>
    </>
  )
}
