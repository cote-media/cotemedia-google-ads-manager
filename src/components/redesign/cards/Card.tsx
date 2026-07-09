// LORAMER_NEXT_CARD_ENGINE_V1 / _RESHAPE_V1 — the card CONTAINER (piece 1). Header doubles as the react-grid-layout
// drag handle ('.cardDragHandle'). Affordances: pin / edit / remove. Body = CardViz (owns loading/empty/honest-error).
// The card RESOLVES its own window: by default it inherits the page GLOBAL range; if cfg.useCustomRange it pins to
// its own dateRange. The page-level compare mode applies to every card (compared against the card's own window).
'use client'
import type { CardConfig } from './card-types'
import { statMetric, breakdownOption } from './card-types'
import { resolveCardWindows, type ComparePreset, type Win } from '@/lib/next/card-windows'
import CardViz from './CardViz'
import styles from './cards.module.css'

function cardTitle(cfg: CardConfig): string {
  if (cfg.title) return cfg.title
  if (cfg.kind === 'stat') return statMetric(cfg.metric).label
  if (cfg.kind === 'breakdown') return breakdownOption(cfg.breakdownType)?.label || cfg.breakdownType || 'Breakdown'
  if (cfg.kind === 'roas') return 'ROAS — multi-source' // LORAMER_NEXT_ROAS_CARD_V1
  return 'Chart'
}

export default function Card({
  clientId, cfg, pinned, globalPeriod, globalCustom, compareMode, customCompare, onEdit, onRemove, onTogglePin,
}: {
  clientId: string
  cfg: CardConfig
  pinned: boolean
  globalPeriod: string
  globalCustom: Win | null
  compareMode: ComparePreset
  customCompare: Win | null
  onEdit: () => void
  onRemove: () => void
  onTogglePin: () => void
}) {
  const base = cfg.useCustomRange
    ? { period: cfg.dateRange }
    : { period: globalPeriod, start: globalCustom?.startDate, end: globalCustom?.endDate }
  const { current, compare } = resolveCardWindows({ ...base, compare: compareMode, cmpStart: customCompare?.startDate, cmpEnd: customCompare?.endDate })

  return (
    <div className={styles.card}>
      <div className={`${styles.cardHead} cardDragHandle`}>
        <i className={`ti ti-grip-vertical ${styles.grip}`} />
        <span className={styles.cardTitle}>{cardTitle(cfg)}{cfg.useCustomRange && <i className={`ti ti-calendar-pin ${styles.ovIcon}`} title="Custom range" />}</span>
        <div className={styles.cardActions}>
          <button type="button" title={pinned ? 'Unpin' : 'Pin'} className={pinned ? styles.actOn : styles.act} onClick={onTogglePin}><i className="ti ti-pin" /></button>
          <button type="button" title="Edit" className={styles.act} onClick={onEdit}><i className="ti ti-settings" /></button>
          <button type="button" title="Remove" className={styles.act} onClick={onRemove}><i className="ti ti-x" /></button>
        </div>
      </div>
      <div className={styles.cardBody}>
        <CardViz clientId={clientId} cfg={cfg} current={current} compare={compare} />
      </div>
    </div>
  )
}
