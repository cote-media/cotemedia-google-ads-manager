// LORAMER_NEXT_CARD_ENGINE_V1 / _RESHAPE_V1 — the recharts viz set for a card. Mirrors the existing -next chart
// styling (CombinedPerformanceChart palette). Renders stat / bar / table here. COMPARE: stat + breakdown rows show
// a % delta (GREEN up / RED down via deltaLabel) vs the comparison window; the timeseries card draws the comparison
// period as a DASHED line under the solid current line with a dual-range legend (reuses the recharts line mechanism).
'use client'
import { useEffect, useState } from 'react'
import { BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts'
import CombinedPerformanceChart from '../CombinedPerformanceChart'
import MoneyWaterfall from '../MoneyWaterfall' // LORAMER_NEXT_MONEY_CARD_V1 — additive 'money' kind
import type { CardConfig } from './card-types'
import { statMetric } from './card-types'
import { useCardData, type BreakdownRow } from './useCardData'
import { deltaLabel } from '@/lib/next/portfolio-windows'
import { winLabel, type Win } from '@/lib/next/card-windows'
import styles from './cards.module.css'

const fmtMoney = (v: number) => '$' + Math.round(v).toLocaleString('en-US')
const fmtNum = (v: number) => Math.round(v).toLocaleString('en-US')
const deltaCls = (dir: string) => (dir === 'up' ? styles.up : dir === 'down' ? styles.down : styles.muted)

function StatBody({ clientId, cfg, current, compare }: { clientId: string; cfg: CardConfig; current: Win; compare: Win | null }) {
  const d = useCardData(clientId, cfg, current, compare)
  const m = statMetric(cfg.metric)
  if (d.loading) return <p className={styles.muted}>Loading…</p>
  if (d.error) return <p className={styles.err}>{d.error}</p>
  if (d.statValue == null) return <p className={styles.muted}>No data</p>
  const v = d.statValue
  const val = m.money ? fmtMoney(v) : m.suffix ? v.toFixed(2) + m.suffix : fmtNum(v)
  const dl = d.hasCompare ? deltaLabel(v, d.statCompare ?? null) : null
  return (
    <div className={styles.statBody}>
      <div className={styles.statV}>{val}</div>
      {dl ? <div className={deltaCls(dl.dir)}>{dl.text} vs {winLabel(compare!)}</div> : <div className={styles.muted}>{winLabel(current)}</div>}
    </div>
  )
}

function BreakdownBody({ clientId, cfg, current, compare }: { clientId: string; cfg: CardConfig; current: Win; compare: Win | null }) {
  const d = useCardData(clientId, cfg, current, compare)
  if (d.loading) return <p className={styles.muted}>Loading…</p>
  if (d.error) return <p className={styles.err}>{d.error}</p>
  const rows: BreakdownRow[] = d.rows || []
  // LORAMER_NEXT_KW_ST_CARD_V1 — a note is BLOCKING only when there are NO rows (unknown family / not-yet-exposed /
  // "no data captured"): show it in place of data. With rows present the note is ADVISORY (the truncation "subset"
  // note that keyword/search_term ALWAYS carry) → render the rows and drop the note to a small caption beneath them.
  if (rows.length === 0) return <p className={styles.muted}>{d.note || 'No data'}</p>
  const rankBy = cfg.rankBy || 'spend'
  const money = rankBy === 'spend' || rankBy === 'conversionValue' || rankBy === 'revenue'
  const val = (r: BreakdownRow) => (r as any)[rankBy] ?? r.spend
  const caption = d.note ? <p className={styles.muted}>{d.note}</p> : null
  // LORAMER_META_CONV_ACTION_ROAS_REVERT_V1 — the canonicalized Meta conversion-action card adds a $Value column
  // (conversionValue, additive). ROAS column REVERTED (the single-day figure was mislabeled against window totals)
  // → moving to a dedicated multi-source ROAS card. Table viz only. (metrics-query metaRoas carry left DORMANT.)
  const isAction = cfg.breakdownType === 'action_type'

  if (cfg.viz === 'table') {
    return (
      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead><tr><th>{isAction ? 'Action' : 'Value'}</th><th className={styles.numCol}>{rankBy}</th>{isAction && <th className={styles.numCol}>Value</th>}{d.hasCompare && <th className={styles.numCol}>Δ</th>}</tr></thead>
          <tbody>
            {rows.map((r) => {
              const dl = d.hasCompare ? deltaLabel(val(r), r.cmpRank ?? 0) : null
              return (
                <tr key={r.value}>
                  <td>{r.value || '(none)'}</td>
                  <td className={styles.numCol}>{money ? fmtMoney(val(r)) : fmtNum(val(r))}</td>
                  {isAction && <td className={styles.numCol}>{fmtMoney(r.conversionValue)}</td>}
                  {d.hasCompare && <td className={`${styles.numCol} ${deltaCls(dl!.dir)}`}>{dl!.text}</td>}
                </tr>
              )
            })}
          </tbody>
        </table>
        {caption}
      </div>
    )
  }
  const data = rows.map((r) => ({ name: (r.value || '(none)').slice(0, 18), v: val(r) }))
  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} layout="vertical" margin={{ top: 4, right: 12, left: 4, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#eef0f3" horizontal={false} />
          <XAxis type="number" tick={{ fontSize: 11 }} tickFormatter={(x) => (money ? fmtMoney(Number(x)) : fmtNum(Number(x)))} />
          <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={96} />
          <Tooltip formatter={(x: any) => (money ? fmtMoney(Number(x)) : fmtNum(Number(x)))} />
          <Bar dataKey="v" fill="#2563eb" radius={[0, 3, 3, 0]} />
        </BarChart>
      </ResponsiveContainer>
      {caption}
    </div>
  )
}

type DayPt = { spend: number; clicks: number; conversions: number }
type TsRow = { date: string; google: DayPt; meta: DayPt }
const TS_METRICS: { key: keyof DayPt; label: string }[] = [{ key: 'spend', label: 'Spend' }, { key: 'clicks', label: 'Clicks' }, { key: 'conversions', label: 'Conversions' }]

// Compare overlay: solid current-period line + DASHED comparison-period line of ONE metric (google+meta summed),
// aligned by day-index, with a legend showing BOTH date ranges (Shopify treatment).
function CompareLine({ clientId, current, compare }: { clientId: string; current: Win; compare: Win }) {
  const [cur, setCur] = useState<TsRow[] | null>(null)
  const [cmp, setCmp] = useState<TsRow[] | null>(null)
  const [metric, setMetric] = useState<keyof DayPt>('spend')
  useEffect(() => {
    let alive = true; setCur(null); setCmp(null)
    const f = (w: Win) => fetch(`/api/next/client-timeseries?clientId=${encodeURIComponent(clientId)}&period=LAST_30_DAYS&start=${w.startDate}&end=${w.endDate}`).then((r) => (r.ok ? r.json() : null)).then((d) => d?.series || [])
    f(current).then((s) => alive && setCur(s)); f(compare).then((s) => alive && setCmp(s))
    return () => { alive = false }
  }, [clientId, current.startDate, current.endDate, compare.startDate, compare.endDate])

  if (!cur || !cmp) return <p className={styles.muted}>Loading…</p>
  const sum = (rows: TsRow[], i: number) => { const r = rows[i]; return r ? (r.google[metric] || 0) + (r.meta[metric] || 0) : null }
  const n = Math.max(cur.length, cmp.length)
  const data = Array.from({ length: n }, (_, i) => ({ i: i + 1, current: sum(cur, i), compare: sum(cmp, i) }))
  const fmt = (v: number) => (metric === 'spend' ? fmtMoney(v) : fmtNum(v))
  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div className={styles.tsToggle}>
        {TS_METRICS.map((mt) => (
          <button key={mt.key} type="button" className={metric === mt.key ? styles.segOn : styles.segBtn} onClick={() => setMetric(mt.key)}>{mt.label}</button>
        ))}
      </div>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#eef0f3" />
          <XAxis dataKey="i" tick={{ fontSize: 11 }} minTickGap={24} />
          <YAxis tick={{ fontSize: 11 }} width={48} tickFormatter={fmt} />
          <Tooltip formatter={(v: any) => fmt(Number(v))} />
          <Legend />
          <Line type="monotone" dataKey="current" name={winLabel(current)} stroke="#2563eb" strokeWidth={2} dot={false} />
          <Line type="monotone" dataKey="compare" name={winLabel(compare)} stroke="#94a3b8" strokeWidth={2} strokeDasharray="5 4" dot={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}

// LORAMER_NEXT_MONEY_CARD_V1 — in-grid money waterfall. Obeys the shared date picker via the RESOLVED current
// window (bare mode: the grid Card supplies the outer chrome + title). Compare not applied to the waterfall (v1).
function MoneyBody({ clientId, current }: { clientId: string; current: Win }) {
  return <MoneyWaterfall clientId={clientId} start={current.startDate} end={current.endDate} bare />
}

export default function CardViz({ clientId, cfg, current, compare }: { clientId: string; cfg: CardConfig; current: Win; compare: Win | null }) {
  if (cfg.kind === 'timeseries') {
    return compare
      ? <CompareLine clientId={clientId} current={current} compare={compare} />
      : <CombinedPerformanceChart clientId={clientId} period="LAST_30_DAYS" start={current.startDate} end={current.endDate} />
  }
  if (cfg.kind === 'stat') return <StatBody clientId={clientId} cfg={cfg} current={current} compare={compare} />
  if (cfg.kind === 'money') return <MoneyBody clientId={clientId} current={current} />
  return <BreakdownBody clientId={clientId} cfg={cfg} current={current} compare={compare} />
}
