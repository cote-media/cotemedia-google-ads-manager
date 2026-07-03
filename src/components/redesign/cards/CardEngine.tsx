// LORAMER_NEXT_CARD_ENGINE_V1 / _RESHAPE_V1 — the PAGE-AGNOSTIC engine. Takes { pageKey, clientId, defaultView };
// portfolio/client pages reuse it with a different pageKey (no rebuild). Owns: named saved views, the page GLOBAL
// date range (Shopify model — change once, all inheriting cards move), the page COMPARE mode (deltas + chart overlay),
// the single Customize toggle, add/edit/remove/pin, the side-panel config, full-screen, the grid. Renders REAL data only.
'use client'
import { useEffect, useState } from 'react'
import type { CardConfig, GridItem, SavedView } from './card-types'
import { defaultOverviewView, newCardId } from './card-types'
import { RANGE_PRESETS, COMPARE_PRESETS, type ComparePreset, type Win } from '@/lib/next/card-windows'
import { setSharedPeriod } from '@/lib/next/period-bus' // LORAMER_NEXT_CHAT_POLISH_V1 — publish the page period to the Ask-Lora chat
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

  // RESHAPE state: page-level global range + compare + full-screen.
  const [globalPeriod, setGlobalPeriod] = useState(fallback.globalPeriod || 'LAST_30_DAYS')
  const [globalCustom, setGlobalCustom] = useState<Win | null>(fallback.globalCustom || null)
  const [compareMode, setCompareMode] = useState<ComparePreset>(fallback.compareMode || 'none')
  const [customCompare, setCustomCompare] = useState<Win | null>(fallback.customCompare || null)
  const [fullscreen, setFullscreen] = useState(false)
  const [moreOpen, setMoreOpen] = useState(false)
  const [rangeDraft, setRangeDraft] = useState<Win>({ startDate: '', endDate: '' })
  const [cmpDraft, setCmpDraft] = useState<Win>({ startDate: '', endDate: '' })
  const [customRangeOpen, setCustomRangeOpen] = useState(false)

  // LORAMER_NEXT_CHAT_POLISH_V1 — publish the page's shared date range so the Ask-Lora chat's ambient window follows it.
  useEffect(() => {
    setSharedPeriod({ dateRange: globalPeriod, customStart: globalCustom?.startDate, customEnd: globalCustom?.endDate })
  }, [globalPeriod, globalCustom])

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

  const applyView = (v: SavedView) => {
    setCards(v.cards); setLayout(v.layout); setPinned(new Set(v.pinned || []))
    setGlobalPeriod(v.globalPeriod || 'LAST_30_DAYS'); setGlobalCustom(v.globalCustom || null)
    setCompareMode(v.compareMode || 'none'); setCustomCompare(v.customCompare || null)
  }
  const switchView = (i: number) => { setActive(i); applyView(views[i]); setEditing(null) }

  const editingCfg: CardConfig | null =
    editing === 'new' ? { id: newCardId(), kind: 'stat', viz: 'stat', metric: 'spend', dateRange: 'LAST_30_DAYS', useCustomRange: false }
    : editing ? cards.find((c) => c.id === editing) || null : null

  const applyCfg = (cfg: CardConfig) => {
    if (editing === 'new') {
      setCards((cs) => [...cs, cfg])
      setLayout((l) => [...l, { i: cfg.id, x: 0, y: Infinity as unknown as number, w: cfg.kind === 'stat' ? 3 : 5, h: cfg.kind === 'stat' ? 2 : 5 }])
    } else setCards((cs) => cs.map((c) => (c.id === cfg.id ? cfg : c)))
    setEditing(null)
  }
  const removeCard = (id: string) => { setCards((cs) => cs.filter((c) => c.id !== id)); setLayout((l) => l.filter((g) => g.i !== id)) }
  const togglePin = (id: string) => setPinned((p) => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n })

  const saveView = async () => {
    const name = window.prompt('Save view as:', views[active]?.name || 'My view')
    if (!name) return
    const view: SavedView = { name, cards, layout, pinned: Array.from(pinned), globalPeriod, globalCustom, compareMode, customCompare }
    setSaveMsg('Saving…')
    try {
      const r = await fetch('/api/next/layouts', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ pageKey, clientId, view, setDefault: true }) })
      if (!r.ok) throw new Error()
      setSaveMsg('Saved')
      setViews((vs) => { const i = vs.findIndex((v) => v.name === name); const next = [...vs]; i >= 0 ? (next[i] = view) : next.push(view); return next })
    } catch { setSaveMsg('Couldn’t save') }
    setTimeout(() => setSaveMsg(null), 4000)
  }

  // FIX 2 — persist the page settings into the active view (dashboard_layouts jsonb) ON CHANGE → survives refresh.
  const persistSettings = (over: Partial<SavedView>) => {
    const view: SavedView = { name: views[active]?.name || 'Default', cards, layout, pinned: Array.from(pinned), globalPeriod, globalCustom, compareMode, customCompare, ...over }
    setViews((vs) => { const i = vs.findIndex((v) => v.name === view.name); const next = [...vs]; i >= 0 ? (next[i] = view) : next.push(view); return next })
    fetch('/api/next/layouts', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ pageKey, clientId, view, setDefault: true }) }).catch(() => {})
  }
  const onRange = (key: string) => {
    if (key === 'CUSTOM') { setCustomRangeOpen(true); return } // reveal the date inputs; apply on Apply
    setCustomRangeOpen(false); setGlobalCustom(null); setGlobalPeriod(key); persistSettings({ globalPeriod: key, globalCustom: null })
  }
  const applyCustomRange = () => { if (rangeDraft.startDate && rangeDraft.endDate) { const w = { ...rangeDraft }; setGlobalCustom(w); persistSettings({ globalCustom: w }) } }
  const onCompare = (key: ComparePreset) => { setCompareMode(key); const cc = key === 'custom' ? customCompare : null; if (key !== 'custom') setCustomCompare(null); persistSettings({ compareMode: key, customCompare: cc }) }
  const applyCustomCompare = () => { if (cmpDraft.startDate && cmpDraft.endDate) { const w = { ...cmpDraft }; setCustomCompare(w); persistSettings({ customCompare: w }) } }

  return (
    <div className={`${styles.engine} ${fullscreen ? styles.fullscreen : ''}`}>
      <div className={styles.toolbar}>
        {views.length > 1 && (
          <select className={styles.viewSel} value={active} onChange={(e) => switchView(Number(e.target.value))}>
            {views.map((v, i) => <option key={v.name + i} value={i}>{v.name}</option>)}
          </select>
        )}
        <div className={styles.toolRight}>
          {/* GLOBAL date range (page-level — every inheriting card moves) */}
          <select className={styles.viewSel} value={globalCustom ? 'CUSTOM' : globalPeriod} onChange={(e) => onRange(e.target.value)}>
            {RANGE_PRESETS.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}
            <option value="CUSTOM">Custom range…</option>
          </select>
          <CustomRow show={customRangeOpen} draft={rangeDraft} setDraft={setRangeDraft} onApply={applyCustomRange} />

          {/* COMPARE (page-level — deltas + chart overlay) */}
          <select className={styles.viewSel} value={compareMode} onChange={(e) => onCompare(e.target.value as ComparePreset)}>
            {COMPARE_PRESETS.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
          </select>
          <CustomRow show={compareMode === 'custom'} draft={cmpDraft} setDraft={setCmpDraft} onApply={applyCustomCompare} />

          <button type="button" className={customizing ? styles.toolOn : styles.tool} onClick={() => setCustomizing((c) => !c)}>
            <i className="ti ti-adjustments" /> {customizing ? 'Done' : 'Customize'}
          </button>
          {customizing && <button type="button" className={styles.tool} onClick={() => setEditing('new')}><i className="ti ti-plus" /> Add card</button>}
          {customizing && <button type="button" className={styles.tool} onClick={saveView}><i className="ti ti-device-floppy" /> Save view</button>}
          {saveMsg && <span className={styles.saveMsg}>{saveMsg}</span>}

          {/* overflow: full screen */}
          <div className={styles.moreWrap}>
            <button type="button" className={styles.tool} aria-label="More" onClick={() => setMoreOpen((o) => !o)}><i className="ti ti-dots" /></button>
            {moreOpen && (
              <div className={styles.moreMenu}>
                <button type="button" className={styles.moreItem} onClick={() => { setFullscreen((f) => !f); setMoreOpen(false) }}>
                  <i className={fullscreen ? 'ti ti-arrows-minimize' : 'ti ti-arrows-maximize'} /> {fullscreen ? 'Exit full screen' : 'Expand to full screen'}
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      <CardGrid
        clientId={clientId} cards={cards} layout={layout} pinned={pinned} customizing={customizing}
        globalPeriod={globalPeriod} globalCustom={globalCustom} compareMode={compareMode} customCompare={customCompare}
        onLayoutChange={setLayout} onEdit={(id) => setEditing(id)} onRemove={removeCard} onTogglePin={togglePin}
      />

      {editingCfg && <CardConfigPanel initial={editingCfg} onApply={applyCfg} onClose={() => setEditing(null)} />}
    </div>
  )
}

function CustomRow({ show, draft, setDraft, onApply }: { show: boolean; draft: Win; setDraft: (w: Win) => void; onApply: () => void }) {
  if (!show) return null
  return (
    <span className={styles.customRow}>
      <input type="date" className={styles.dateIn} value={draft.startDate} onChange={(e) => setDraft({ ...draft, startDate: e.target.value })} />
      <span className={styles.muted}>→</span>
      <input type="date" className={styles.dateIn} value={draft.endDate} onChange={(e) => setDraft({ ...draft, endDate: e.target.value })} />
      <button type="button" className={styles.tool} onClick={onApply}>Apply</button>
    </span>
  )
}
