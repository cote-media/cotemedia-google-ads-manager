// LORAMER_NEXT_CARD_ENGINE_V1 — the PAGE-AGNOSTIC engine (piece 7). Takes { pageKey, clientId, defaultView }; it
// does NOT know about Overview specifically — portfolio + client pages reuse it by passing a different pageKey +
// default view (no rebuild). Owns: named saved views (load/save via /api/next/layouts), the customize toggle, the
// add/edit/remove/pin actions, the side-panel config, and the grid. Layout persistence = named views (locked A).
// Renders REAL data only (default view uses query-exposed families); "coming" families are picker-disabled.
'use client'
import { useEffect, useState } from 'react'
import type { CardConfig, GridItem, SavedView } from './card-types'
import { defaultOverviewView, newCardId } from './card-types'
import CardGrid from './CardGrid'
import CardConfigPanel from './CardConfigPanel'
import styles from './cards.module.css'

export default function CardEngine({ pageKey, clientId, defaultView }: { pageKey: string; clientId: string; defaultView?: SavedView }) {
  const fallback = defaultView || defaultOverviewView()
  const [views, setViews] = useState<SavedView[]>([fallback])
  const [active, setActive] = useState(0)
  const [cards, setCards] = useState<CardConfig[]>(fallback.cards)
  const [layout, setLayout] = useState<GridItem[]>(fallback.layout)
  const [pinned, setPinned] = useState<Set<string>>(new Set(fallback.pinned || []))
  const [customizing, setCustomizing] = useState(false)
  const [editing, setEditing] = useState<string | 'new' | null>(null)
  const [saveMsg, setSaveMsg] = useState<string | null>(null)

  // Load this user's saved views for this page (owner-gated route). Empty → keep the built-in default.
  useEffect(() => {
    let alive = true
    fetch(`/api/next/layouts?pageKey=${encodeURIComponent(pageKey)}&clientId=${encodeURIComponent(clientId)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!alive || !d || !Array.isArray(d.views) || d.views.length === 0) return
        const vs: SavedView[] = d.views
        const idx = Math.max(0, vs.findIndex((v) => v.name === d.defaultName))
        setViews(vs); applyView(vs[idx] || vs[0]); setActive(idx < 0 ? 0 : idx)
      })
      .catch(() => {})
    return () => { alive = false }
  }, [pageKey, clientId])

  const applyView = (v: SavedView) => { setCards(v.cards); setLayout(v.layout); setPinned(new Set(v.pinned || [])) }
  const switchView = (i: number) => { setActive(i); applyView(views[i]); setEditing(null) }

  const editingCfg: CardConfig | null =
    editing === 'new' ? { id: newCardId(), kind: 'stat', viz: 'stat', metric: 'spend', dateRange: 'LAST_30_DAYS' }
    : editing ? cards.find((c) => c.id === editing) || null : null

  const applyCfg = (cfg: CardConfig) => {
    if (editing === 'new') {
      setCards((cs) => [...cs, cfg])
      setLayout((l) => [...l, { i: cfg.id, x: 0, y: Infinity as unknown as number, w: cfg.kind === 'stat' ? 3 : 5, h: cfg.kind === 'stat' ? 2 : 5 }])
    } else {
      setCards((cs) => cs.map((c) => (c.id === cfg.id ? cfg : c)))
    }
    setEditing(null)
  }
  const removeCard = (id: string) => { setCards((cs) => cs.filter((c) => c.id !== id)); setLayout((l) => l.filter((g) => g.i !== id)) }
  const togglePin = (id: string) => setPinned((p) => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n })

  const saveView = async () => {
    const name = window.prompt('Save view as:', views[active]?.name || 'My view')
    if (!name) return
    const view: SavedView = { name, cards, layout, pinned: Array.from(pinned) }
    setSaveMsg('Saving…')
    try {
      const r = await fetch('/api/next/layouts', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ pageKey, clientId, view, setDefault: true }),
      })
      if (!r.ok) throw new Error()
      setSaveMsg('Saved')
      setViews((vs) => { const i = vs.findIndex((v) => v.name === name); const next = [...vs]; i >= 0 ? (next[i] = view) : next.push(view); return next })
    } catch {
      setSaveMsg('Couldn’t save (layouts table not provisioned yet)')
    }
    setTimeout(() => setSaveMsg(null), 4000)
  }

  return (
    <div className={styles.engine}>
      <div className={styles.toolbar}>
        {views.length > 1 && (
          <select className={styles.viewSel} value={active} onChange={(e) => switchView(Number(e.target.value))}>
            {views.map((v, i) => <option key={v.name + i} value={i}>{v.name}</option>)}
          </select>
        )}
        <div className={styles.toolRight}>
          <button type="button" className={customizing ? styles.toolOn : styles.tool} onClick={() => setCustomizing((c) => !c)}>
            <i className="ti ti-adjustments" /> {customizing ? 'Done' : 'Customize'}
          </button>
          {customizing && <button type="button" className={styles.tool} onClick={() => setEditing('new')}><i className="ti ti-plus" /> Add card</button>}
          {customizing && <button type="button" className={styles.tool} onClick={saveView}><i className="ti ti-device-floppy" /> Save view</button>}
          {saveMsg && <span className={styles.saveMsg}>{saveMsg}</span>}
        </div>
      </div>

      <CardGrid
        clientId={clientId}
        cards={cards}
        layout={layout}
        pinned={pinned}
        customizing={customizing}
        onLayoutChange={setLayout}
        onEdit={(id) => setEditing(id)}
        onRemove={removeCard}
        onTogglePin={togglePin}
      />

      {editingCfg && <CardConfigPanel initial={editingCfg} onApply={applyCfg} onClose={() => setEditing(null)} />}
    </div>
  )
}
