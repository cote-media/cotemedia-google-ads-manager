// LORAMER_NEXT_CARD_ENGINE_V1 — the card CONTAINER (piece 1). Header doubles as the react-grid-layout drag handle
// (className 'cardDragHandle' is the grid's draggableHandle). Affordances: pin (exclude from drag-reorder), edit
// (opens the side-panel config), remove. Body = CardViz (which owns loading / empty / honest-error states — never
// a silent blank). Resize is desktop-only (the grid hides resize handles at the mobile breakpoint).
'use client'
import type { CardConfig } from './card-types'
import { statMetric, breakdownOption } from './card-types'
import CardViz from './CardViz'
import styles from './cards.module.css'

function cardTitle(cfg: CardConfig): string {
  if (cfg.title) return cfg.title
  if (cfg.kind === 'stat') return statMetric(cfg.metric).label
  if (cfg.kind === 'breakdown') return breakdownOption(cfg.breakdownType)?.label || cfg.breakdownType || 'Breakdown'
  return 'Chart'
}

export default function Card({
  clientId, cfg, period, pinned, onEdit, onRemove, onTogglePin,
}: {
  clientId: string
  cfg: CardConfig
  period: string
  pinned: boolean
  onEdit: () => void
  onRemove: () => void
  onTogglePin: () => void
}) {
  return (
    <div className={styles.card}>
      <div className={`${styles.cardHead} cardDragHandle`}>
        <i className={`ti ti-grip-vertical ${styles.grip}`} />
        <span className={styles.cardTitle}>{cardTitle(cfg)}</span>
        <div className={styles.cardActions}>
          <button type="button" title={pinned ? 'Unpin' : 'Pin'} className={pinned ? styles.actOn : styles.act} onClick={onTogglePin}>
            <i className="ti ti-pin" />
          </button>
          <button type="button" title="Edit" className={styles.act} onClick={onEdit}><i className="ti ti-settings" /></button>
          <button type="button" title="Remove" className={styles.act} onClick={onRemove}><i className="ti ti-x" /></button>
        </div>
      </div>
      <div className={styles.cardBody}>
        <CardViz clientId={clientId} cfg={cfg} period={period} />
      </div>
    </div>
  )
}
