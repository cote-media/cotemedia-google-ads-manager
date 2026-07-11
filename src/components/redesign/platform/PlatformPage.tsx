// LORAMER_NEXT_PLATFORM_PAGE_V1 — the per-platform page body (client). Owns the page date range (a preset dropdown)
// and pushes it to the period-bus so BOTH the drill and the shared Ask-Lora window follow it (the CardEngine period
// mechanism, reused). Renders <DrillView> for entity-supported platforms (google/meta); ga/shopify get an honest
// note (no campaign hierarchy). -next only; ZERO backend change (reads /api/next/entities, already built).
'use client'
import { useState } from 'react'
import { setSharedPeriod } from '@/lib/next/period-bus'
import DrillView from './DrillView'
import styles from './platform.module.css'

const PRESETS = [
  { key: 'LAST_7_DAYS', label: 'Last 7 days' },
  { key: 'LAST_14_DAYS', label: 'Last 14 days' },
  { key: 'LAST_30_DAYS', label: 'Last 30 days' },
  { key: 'LAST_90_DAYS', label: 'Last 90 days' },
]
const HAS_DRILL = new Set(['google', 'meta'])

export default function PlatformPage({ platform, label, clientId, clientName }: { platform: string; label: string; clientId: string; clientName: string }) {
  const [period, setPeriod] = useState('LAST_30_DAYS')
  const onPeriod = (p: string) => { setPeriod(p); setSharedPeriod({ dateRange: p }) } // drives the drill + the shared Ask-Lora window

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <h1 className={styles.title}>{label}</h1>
        <select className={styles.dateSel} value={period} onChange={(e) => onPeriod(e.target.value)} aria-label="Date range">
          {PRESETS.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
        </select>
      </div>
      {HAS_DRILL.has(platform)
        ? <DrillView platform={platform} clientId={clientId} clientName={clientName} period={period} />
        : <p className={styles.note}>No campaign hierarchy to drill on this channel. Store money lives on the Store page; Analytics breakdowns are a later increment.</p>}
    </div>
  )
}
