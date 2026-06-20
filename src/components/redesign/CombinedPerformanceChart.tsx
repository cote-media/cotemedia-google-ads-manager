// LORAMER_NEXT_COMBINED_CHART_V1 — -next-only Combined Performance chart. Daily Google (solid) / Meta (dashed)
// lines over the selected ET window, with a Spend/Clicks/Conversions toggle. Imports recharts directly — does NOT
// import or modify the frozen live CombinedChart. Mobile-first: ResponsiveContainer + compact ticks, honest
// empty-state when there's no Google/Meta activity. Reads /api/next/client-timeseries (captured, reconciled).
'use client'
import { useEffect, useState } from 'react'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts'
import styles from './redesign.module.css'

type Pt = { spend: number; clicks: number; conversions: number }
type Row = { date: string; google: Pt; meta: Pt }
type Metric = 'spend' | 'clicks' | 'conversions'
const METRICS: { key: Metric; label: string }[] = [
  { key: 'spend', label: 'Spend' },
  { key: 'clicks', label: 'Clicks' },
  { key: 'conversions', label: 'Conversions' },
]

export default function CombinedPerformanceChart({ clientId, period }: { clientId: string; period: string }) {
  const [series, setSeries] = useState<Row[] | null>(null)
  const [metric, setMetric] = useState<Metric>('spend')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!clientId) return
    let alive = true
    setLoading(true); setSeries(null)
    fetch('/api/next/client-timeseries?clientId=' + encodeURIComponent(clientId) + '&period=' + encodeURIComponent(period))
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (alive) setSeries(d?.series || []) })
      .catch(() => { if (alive) setSeries([]) })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [clientId, period])

  const rows = series || []
  const data = rows.map((r) => ({ date: r.date.slice(5), google: r.google[metric], meta: r.meta[metric] }))
  const hasAny = rows.some((r) =>
    r.google.spend || r.google.clicks || r.google.conversions || r.meta.spend || r.meta.clicks || r.meta.conversions)
  const fmt = (v: number) => (metric === 'spend' ? '$' + Math.round(v).toLocaleString('en-US') : Math.round(v).toLocaleString('en-US'))

  return (
    <div>
      <div className={styles.secHead}>
        <i className={`ti ti-grip-vertical ${styles.grip}`} />
        <span className={styles.lbl}>Combined performance</span>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {METRICS.map((mt) => (
            <button
              key={mt.key}
              type="button"
              onClick={() => setMetric(mt.key)}
              className={styles.sortStub}
              style={{ cursor: 'pointer', fontWeight: metric === mt.key ? 600 : 400, color: metric === mt.key ? '#0f172a' : undefined }}
            >
              {mt.label}
            </button>
          ))}
        </div>
      </div>
      {loading ? (
        <p className={styles.metaLabel} style={{ padding: '8px 2px' }}>Loading…</p>
      ) : !hasAny ? (
        <p className={styles.metaLabel} style={{ padding: '8px 2px' }}>No Google/Meta activity in this period.</p>
      ) : (
        <ResponsiveContainer width="100%" height={240}>
          <LineChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#eef0f3" />
            <XAxis dataKey="date" tick={{ fontSize: 11 }} interval="preserveStartEnd" minTickGap={24} />
            <YAxis tick={{ fontSize: 11 }} width={48} tickFormatter={fmt} />
            <Tooltip formatter={(value: any) => fmt(Number(value))} />
            <Legend />
            <Line type="monotone" dataKey="google" name="Google" stroke="#2563eb" strokeWidth={2} dot={data.length < 3} />
            <Line type="monotone" dataKey="meta" name="Meta" stroke="#7c3aed" strokeWidth={2} strokeDasharray="5 4" dot={data.length < 3} />
          </LineChart>
        </ResponsiveContainer>
      )}
    </div>
  )
}
