// LORAMER_NEXT_CARD_ENGINE_V1 / _RESHAPE_V1 — the GRID wrapper (piece 3). react-grid-layout (locked lib D).
// Responsive: desktop (lg/md, 12 cols) = drag + RESIZE on BOTH bottom corners (resizeHandles ['se','sw'] — a
// right-pinned card grows leftward in one drag); mobile (sm, 1 col) = drag-REORDER only, NO resize (locked C → no
// handles). Drag handle = each card header ('.cardDragHandle'). Pinned cards are static.
'use client'
import { useState } from 'react'
import { Responsive, WidthProvider, type Layout } from 'react-grid-layout'
import 'react-grid-layout/css/styles.css'
import 'react-resizable/css/styles.css'
import type { CardConfig, GridItem } from './card-types'
import type { ComparePreset, Win } from '@/lib/next/card-windows'
import Card from './Card'
import styles from './cards.module.css'

const Grid = WidthProvider(Responsive)

export default function CardGrid({
  clientId, cards, layout, pinned, customizing, globalPeriod, globalCustom, compareMode, customCompare,
  onLayoutChange, onEdit, onRemove, onTogglePin,
}: {
  clientId: string
  cards: CardConfig[]
  layout: GridItem[]
  pinned: Set<string>
  customizing: boolean
  globalPeriod: string
  globalCustom: Win | null
  compareMode: ComparePreset
  customCompare: Win | null
  onLayoutChange: (l: GridItem[]) => void
  onEdit: (id: string) => void
  onRemove: (id: string) => void
  onTogglePin: (id: string) => void
}) {
  const [bp, setBp] = useState<string>('lg')
  const isMobile = bp === 'sm'

  const rgl: Layout[] = layout.map((g) => ({ ...g, static: pinned.has(g.i) || !customizing }))
  // sm (mobile): stack FLUSH. STATIC items don't auto-compact, so place each card's y at the CUMULATIVE height of the
  // ones above it (not a fixed idx*step) → no dead vertical gaps regardless of compaction (FIX 1).
  let yAcc = 0
  const stacked: Layout[] = cards.map((c) => {
    const h = c.kind === 'stat' ? 2 : 5
    const item: Layout = { i: c.id, x: 0, y: yAcc, w: 1, h, static: !customizing }
    yAcc += h
    return item
  })

  return (
    <Grid
      className={styles.grid}
      layouts={{ lg: rgl, md: rgl, sm: stacked }}
      breakpoints={{ lg: 1100, md: 760, sm: 0 }}
      cols={{ lg: 12, md: 12, sm: 1 }}
      rowHeight={56}
      margin={[12, 12]}
      isDraggable={customizing}
      isResizable={customizing && !isMobile}
      compactType="vertical"
      resizeHandles={['se', 'sw']}
      draggableHandle=".cardDragHandle"
      onBreakpointChange={(b) => setBp(b)}
      onLayoutChange={(cur) => {
        if (!isMobile) onLayoutChange(cur.map((l) => ({ i: l.i, x: l.x, y: l.y, w: l.w, h: l.h })))
      }}
    >
      {cards.map((c) => (
        <div key={c.id} className={pinned.has(c.id) ? styles.pinnedWrap : undefined}>
          <Card
            clientId={clientId}
            cfg={c}
            pinned={pinned.has(c.id)}
            globalPeriod={globalPeriod}
            globalCustom={globalCustom}
            compareMode={compareMode}
            customCompare={customCompare}
            onEdit={() => onEdit(c.id)}
            onRemove={() => onRemove(c.id)}
            onTogglePin={() => onTogglePin(c.id)}
          />
        </div>
      ))}
    </Grid>
  )
}
