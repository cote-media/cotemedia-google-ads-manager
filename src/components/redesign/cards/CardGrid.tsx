// LORAMER_NEXT_CARD_ENGINE_V1 / _RESHAPE_V1 — the GRID wrapper (piece 3). react-grid-layout (locked lib D).
// Responsive: desktop (lg/md, 12 cols) = drag + RESIZE on BOTH bottom corners (resizeHandles ['se','sw'] — a
// right-pinned card grows leftward in one drag); mobile (sm, 1 col) = drag-REORDER only, NO resize (locked C → no
// handles). Drag handle = each card header ('.cardDragHandle'). Pinned cards are static.
// LORAMER_NEXT_MOBILE_LAYOUT_V1 — the mobile (sm) reorder now PERSISTS into a SEPARATE slot (view.layoutSm) via
// onLayoutSmChange; it never writes the desktop lg/md layout. Desktop + mobile arrangements are independent by design.
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
  clientId, cards, layout, layoutSm, pinned, customizing, globalPeriod, globalCustom, compareMode, customCompare,
  onLayoutChange, onLayoutSmChange, onEdit, onRemove, onTogglePin,
}: {
  clientId: string
  cards: CardConfig[]
  layout: GridItem[]
  layoutSm: GridItem[]
  pinned: Set<string>
  customizing: boolean
  globalPeriod: string
  globalCustom: Win | null
  compareMode: ComparePreset
  customCompare: Win | null
  onLayoutChange: (l: GridItem[]) => void
  onLayoutSmChange: (l: GridItem[]) => void
  onEdit: (id: string) => void
  onRemove: (id: string) => void
  onTogglePin: (id: string) => void
}) {
  const [bp, setBp] = useState<string>('lg')
  const isMobile = bp === 'sm'

  const rgl: Layout[] = layout.map((g) => ({ ...g, static: pinned.has(g.i) || !customizing }))
  // sm (mobile): ORDER from the PERSISTED mobile layout (layoutSm) if present, else today's cards[] order — so a
  // layoutSm-less row renders identically to before. Cards absent from layoutSm (newly added, or a legacy row) append
  // at the end in cards[] order; layoutSm ids no longer in cards[] are dropped. y is ALWAYS recomputed as the
  // CUMULATIVE height of the cards above it (STATIC items don't auto-compact) → no dead vertical gaps (FIX 1).
  const byId = new Map(cards.map((c) => [c.id, c]))
  const smOrderIds = layoutSm && layoutSm.length
    ? [...layoutSm].sort((a, b) => a.y - b.y).map((g) => g.i).filter((id) => byId.has(id))
    : []
  const seenSm = new Set(smOrderIds)
  const orderedIds = [...smOrderIds, ...cards.filter((c) => !seenSm.has(c.id)).map((c) => c.id)]
  let yAcc = 0
  const stacked: Layout[] = orderedIds.map((id) => {
    const c = byId.get(id)!
    const h = c.kind === 'stat' ? 2 : 5
    const item: Layout = { i: id, x: 0, y: yAcc, w: 1, h, static: !customizing }
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
        if (!isMobile) { onLayoutChange(cur.map((l) => ({ i: l.i, x: l.x, y: l.y, w: l.w, h: l.h }))); return }
        // MOBILE (LORAMER_NEXT_MOBILE_LAYOUT_V1): capture a genuine reorder into the SEPARATE mobile slot — NEVER the
        // desktop lg/md layout. Skip spurious fires (mount, breakpoint change, static-flag toggle) where the order is
        // unchanged, so a layoutSm-less row stays layoutSm-less until the user actually drags on mobile.
        const incoming = [...cur].sort((a, b) => a.y - b.y).map((l) => l.i)
        if (incoming.length && incoming.join('|') !== orderedIds.join('|')) {
          onLayoutSmChange(cur.map((l) => ({ i: l.i, x: l.x, y: l.y, w: l.w, h: l.h })))
        }
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
