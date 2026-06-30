// LORAMER_NEXT_CARD_ENGINE_V1 — the recharts viz set for a card. Mirrors the existing -next chart styling
// (CombinedPerformanceChart palette + redesign.module.css), NOT a new viz language. stat / bar / table render
// here; the 'line' / timeseries card reuses the existing CombinedPerformanceChart unchanged.
'use client'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'
import CombinedPerformanceChart from '../CombinedPerformanceChart'
import type { CardConfig } from './card-types'
import { statMetric } from './card-types'
import { useCardData, type BreakdownRow } from './useCardData'
import styles from './cards.module.css'

const fmtMoney = (v: number) => '$' + Math.round(v).toLocaleString('en-US')
const fmtNum = (v: number) => Math.round(v).toLocaleString('en-US')

function StatBody({ clientId, cfg }: { clientId: string; cfg: CardConfig }) {
  const d = useCardData(clientId, cfg)
  const m = statMetric(cfg.metric)
  if (d.loading) return <p className={styles.muted}>Loading…</p>
  if (d.error) return <p className={styles.err}>{d.error}</p>
  if (d.statValue == null) return <p className={styles.muted}>No data</p>
  const v = d.statValue
  const val = m.money ? fmtMoney(v) : m.suffix ? v.toFixed(2) + m.suffix : fmtNum(v)
  let delta: { text: string; up: boolean } | null = null
  if (d.statPrior != null && d.statPrior !== 0) {
    const pct = ((v - d.statPrior) / Math.abs(d.statPrior)) * 100
    delta = { text: (pct >= 0 ? '+' : '') + pct.toFixed(0) + '%', up: pct >= 0 }
  }
  return (
    <div className={styles.statBody}>
      <div className={styles.statV}>{val}</div>
      {delta ? <div className={delta.up ? styles.up : styles.down}>{delta.text} vs prior</div> : <div className={styles.muted}>—</div>}
    </div>
  )
}

function BreakdownBody({ clientId, cfg }: { clientId: string; cfg: CardConfig }) {
  const d = useCardData(clientId, cfg)
  if (d.loading) return <p className={styles.muted}>Loading…</p>
  if (d.error) return <p className={styles.err}>{d.error}</p>
  if (d.note) return <p className={styles.muted}>{d.note}</p>
  const rows: BreakdownRow[] = d.rows || []
  if (rows.length === 0) return <p className={styles.muted}>No data</p>
  const rankBy = cfg.rankBy || 'spend'
  const money = rankBy === 'spend' || rankBy === 'conversionValue' || rankBy === 'revenue'
  const val = (r: BreakdownRow) => (r as any)[rankBy] ?? r.spend

  if (cfg.viz === 'table') {
    return (
      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead><tr><th>Value</th><th className={styles.numCol}>{rankBy}</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.value}><td>{r.value || '(none)'}</td><td className={styles.numCol}>{money ? fmtMoney(val(r)) : fmtNum(val(r))}</td></tr>
            ))}
          </tbody>
        </table>
      </div>
    )
  }
  const data = rows.map((r) => ({ name: (r.value || '(none)').slice(0, 18), v: val(r) }))
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} layout="vertical" margin={{ top: 4, right: 12, left: 4, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#eef0f3" horizontal={false} />
        <XAxis type="number" tick={{ fontSize: 11 }} tickFormatter={(v) => (money ? fmtMoney(Number(v)) : fmtNum(Number(v)))} />
        <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={96} />
        <Tooltip formatter={(v: any) => (money ? fmtMoney(Number(v)) : fmtNum(Number(v)))} />
        <Bar dataKey="v" fill="#2563eb" radius={[0, 3, 3, 0]} />
      </BarChart>
    </ResponsiveContainer>
  )
}

export default function CardViz({ clientId, cfg, period }: { clientId: string; cfg: CardConfig; period: string }) {
  if (cfg.kind === 'timeseries') return <CombinedPerformanceChart clientId={clientId} period={cfg.dateRange || period} />
  if (cfg.kind === 'stat') return <StatBody clientId={clientId} cfg={cfg} />
  return <BreakdownBody clientId={clientId} cfg={cfg} />
}
