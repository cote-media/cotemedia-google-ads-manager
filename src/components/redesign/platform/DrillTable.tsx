// LORAMER_NEXT_PLATFORM_PAGE_V1 — the drill table (ported from legacy DrillTable + ColumnPicker): sortable metric
// columns, a totals row, row-name click = drill down, a column picker, and a per-row Ask-Lora ✦. The ✦ dispatches
// the EXISTING 'loramer:open-chat' event with a rowContext + prompt in detail → the mounted ChatLauncher opens with
// that row loaded (rowContext flows to /api/chat, which already accepts it — /api/chat UNTOUCHED). Columns match the
// /api/next/entities response (base + derived); no legacy COLUMN_DEFS import.
'use client'
import { useState } from 'react'
import styles from './platform.module.css'

type Ent = { entityId: string; entityName: string; spend: number; impressions: number; clicks: number; conversions: number; conversionValue: number; revenue: number; derived: Record<string, number> }
type Totals = { spend: number; impressions: number; clicks: number; conversions: number; conversionValue: number; revenue: number; derived: Record<string, number> }
type Kind = 'money' | 'num' | 'pct' | 'x'
type Col = { id: string; label: string; kind: Kind; derived?: boolean; defaultOn: boolean }

const COLUMNS: Col[] = [
  { id: 'spend', label: 'Spend', kind: 'money', defaultOn: true },
  { id: 'clicks', label: 'Clicks', kind: 'num', defaultOn: true },
  { id: 'impressions', label: 'Impressions', kind: 'num', defaultOn: false },
  { id: 'conversions', label: 'Conversions', kind: 'num', defaultOn: true },
  { id: 'conversionValue', label: 'Conv. Value', kind: 'money', defaultOn: false },
  { id: 'ctr', label: 'CTR', kind: 'pct', derived: true, defaultOn: true },
  { id: 'roas', label: 'ROAS', kind: 'x', derived: true, defaultOn: true },
  { id: 'cpc', label: 'CPC', kind: 'money', derived: true, defaultOn: false },
  { id: 'cpa', label: 'CPA', kind: 'money', derived: true, defaultOn: false },
  { id: 'convRate', label: 'Conv. Rate', kind: 'pct', derived: true, defaultOn: false },
]
const cellVal = (row: any, c: Col): number | null => (c.derived ? (row.derived?.[c.id] ?? null) : (row[c.id] ?? null))
function fmt(v: number | null, kind: Kind): string {
  if (v == null) return '—'
  if (kind === 'money') return '$' + Math.round(v).toLocaleString('en-US')
  if (kind === 'pct') return v.toFixed(2) + '%'
  if (kind === 'x') return v.toFixed(2) + '×'
  return Math.round(v).toLocaleString('en-US')
}

export default function DrillTable({ rows, totals, nameLabel, canDrill, platform, onDrill }: {
  rows: Ent[]; totals: Totals; nameLabel: string; canDrill: boolean; platform: string; onDrill: (row: Ent) => void
}) {
  const [active, setActive] = useState<string[]>(() => COLUMNS.filter((c) => c.defaultOn).map((c) => c.id))
  const [pickerOpen, setPickerOpen] = useState(false)
  const [sortCol, setSortCol] = useState('spend')
  const [sortDir, setSortDir] = useState<'desc' | 'asc'>('desc')

  const cols = COLUMNS.filter((c) => active.includes(c.id))
  const sortDef = COLUMNS.find((c) => c.id === sortCol) || COLUMNS[0]
  const sorted = [...rows].sort((a, b) => {
    const av = Number(cellVal(a, sortDef) ?? 0), bv = Number(cellVal(b, sortDef) ?? 0)
    return sortDir === 'desc' ? bv - av : av - bv
  })
  const handleSort = (id: string) => { if (sortCol === id) setSortDir((d) => (d === 'desc' ? 'asc' : 'desc')); else { setSortCol(id); setSortDir('desc') } }
  const toggleCol = (id: string, on: boolean) => setActive((a) => (on ? [...a, id] : a.length > 1 ? a.filter((x) => x !== id) : a))

  const askLora = (row: Ent) => {
    const roas = row.derived?.roas ? `, ROAS ${row.derived.roas.toFixed(2)}×` : ''
    const ctx = `${platform === 'meta' ? 'Meta' : 'Google'} ${nameLabel}: "${row.entityName}" — spend $${Math.round(row.spend)}, ${Math.round(row.clicks)} clicks, ${Number(row.conversions).toFixed(1)} conversions${roas}.`
    window.dispatchEvent(new CustomEvent('loramer:open-chat', { detail: { rowContext: ctx, prompt: `How is "${row.entityName}" performing, and what should I do about it?` } }))
  }

  return (
    <div className={styles.tableCard}>
      <div className={styles.tableTop}>
        <div className={styles.colWrap}>
          <button type="button" className={styles.colBtn} onClick={() => setPickerOpen((o) => !o)}>Columns ▾</button>
          {pickerOpen && (
            <div className={styles.colMenu}>
              {COLUMNS.map((c) => (
                <label key={c.id} className={styles.colOpt}>
                  <input type="checkbox" checked={active.includes(c.id)} onChange={(e) => toggleCol(c.id, e.target.checked)} /> {c.label}
                </label>
              ))}
            </div>
          )}
        </div>
      </div>
      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th className={styles.nameCol}>{nameLabel}</th>
              {cols.map((c) => (
                <th key={c.id} className={styles.numCol} onClick={() => handleSort(c.id)}>{c.label}{sortCol === c.id ? (sortDir === 'desc' ? ' ↓' : ' ↑') : ''}</th>
              ))}
              <th className={styles.askCol} title="Ask Lora">✦</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((row) => (
              <tr key={row.entityId}>
                <td className={styles.nameCol}>
                  {canDrill
                    ? <button type="button" className={styles.drillName} onClick={() => onDrill(row)}>{row.entityName || '(unnamed)'}</button>
                    : <span>{row.entityName || '(unnamed)'}</span>}
                </td>
                {cols.map((c) => <td key={c.id} className={styles.numCol}>{fmt(cellVal(row, c), c.kind)}</td>)}
                <td className={styles.askCol}><button type="button" className={styles.askBtn} onClick={() => askLora(row)} title="Ask Lora about this">✦</button></td>
              </tr>
            ))}
          </tbody>
          {rows.length > 1 && (
            <tfoot>
              <tr className={styles.totalRow}>
                <td className={styles.nameCol}>Total</td>
                {cols.map((c) => <td key={c.id} className={styles.numCol}>{fmt(c.derived ? (totals.derived?.[c.id] ?? null) : ((totals as any)[c.id] ?? null), c.kind)}</td>)}
                <td className={styles.askCol} />
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  )
}
